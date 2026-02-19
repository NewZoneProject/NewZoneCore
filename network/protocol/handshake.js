// Module: Handshake Protocol
// Description: Node handshake and authentication protocol.
// File: network/protocol/handshake.js

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { WireMessage, WireMessageType, PROTOCOL_VERSION } from './wire-format.js';

/**
 * Handshake States
 */
export const HandshakeState = {
  IDLE: 'idle',
  HELLO_SENT: 'hello_sent',
  HELLO_RECEIVED: 'hello_received',
  AUTH_SENT: 'auth_sent',
  AUTHENTICATED: 'authenticated',
  FAILED: 'failed'
};

/**
 * Handshake Events
 */
export const HandshakeEvents = {
  COMPLETE: 'complete',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  ERROR: 'error'
};

/**
 * Authentication Methods
 */
export const AuthMethod = {
  NONE: 0x00,
  SHARED_SECRET: 0x01,
  PUBLIC_KEY: 0x02,
  TOKEN: 0x03
};

/**
 * Default Handshake Options
 */
const DEFAULT_OPTIONS = {
  timeout: 30000,
  protocolVersion: PROTOCOL_VERSION,
  supportedVersions: [PROTOCOL_VERSION],
  authMethod: AuthMethod.PUBLIC_KEY,
  requireAuth: true,
  maxRetries: 3
};

/**
 * HandshakeManager class - manages handshake protocol
 */
export class HandshakeManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Identity
    this._nodeId = options.nodeId;
    this._publicKey = options.publicKey;
    this._privateKey = options.privateKey;
    
    // State
    this._state = HandshakeState.IDLE;
    this._remoteNodeId = null;
    this._remotePublicKey = null;
    this._sessionKey = null;
    this._nonce = null;
    this._remoteNonce = null;
    
    // Challenge
    this._challenge = null;
    this._remoteChallenge = null;
    
    // Timeout
    this._timeout = null;
  }

  /**
   * Get current state
   */
  get state() {
    return this._state;
  }

  /**
   * Check if authenticated
   */
  get isAuthenticated() {
    return this._state === HandshakeState.AUTHENTICATED;
  }

  /**
   * Get session key
   */
  get sessionKey() {
    return this._sessionKey;
  }

  /**
   * Get remote node ID
   */
  get remoteNodeId() {
    return this._remoteNodeId;
  }

  /**
   * Start handshake as initiator
   */
  async start() {
    this._setState(HandshakeState.HELLO_SENT);
    this._startTimeout();
    
    // Generate nonce
    this._nonce = crypto.randomBytes(32);
    
    return this._createHelloMessage();
  }

  /**
   * Process incoming message
   */
  async processMessage(message) {
    switch (message.type) {
      case WireMessageType.HELLO:
        return this._handleHello(message);
      
      case WireMessageType.HELLO_ACK:
        return this._handleHelloAck(message);
      
      case WireMessageType.AUTH:
        return this._handleAuth(message);
      
      case WireMessageType.AUTH_ACK:
        return this._handleAuthAck(message);
      
      default:
        throw new Error(`Unexpected message type during handshake: ${message.type}`);
    }
  }

  /**
   * Handle HELLO message
   */
  async _handleHello(message) {
    if (this._state !== HandshakeState.IDLE) {
      throw new Error('Received HELLO in invalid state');
    }
    
    this._setState(HandshakeState.HELLO_RECEIVED);
    
    // Parse HELLO
    const hello = this._parseHello(message.payload);
    
    // Check protocol version
    if (!this.options.supportedVersions.includes(hello.version)) {
      this._fail('Protocol version not supported');
      return null;
    }
    
    // Store remote info
    this._remoteNodeId = hello.nodeId;
    this._remotePublicKey = hello.publicKey;
    this._remoteNonce = hello.nonce;
    
    // Generate our nonce
    this._nonce = crypto.randomBytes(32);
    
    // Generate challenge
    this._challenge = crypto.randomBytes(32);
    
    // Create response
    return this._createHelloAckMessage();
  }

  /**
   * Handle HELLO_ACK message
   */
  async _handleHelloAck(message) {
    if (this._state !== HandshakeState.HELLO_SENT) {
      throw new Error('Received HELLO_ACK in invalid state');
    }
    
    // Parse HELLO_ACK
    const helloAck = this._parseHelloAck(message.payload);
    
    // Check protocol version
    if (!this.options.supportedVersions.includes(helloAck.version)) {
      this._fail('Protocol version not supported');
      return null;
    }
    
    // Store remote info
    this._remoteNodeId = helloAck.nodeId;
    this._remotePublicKey = helloAck.publicKey;
    this._remoteNonce = helloAck.nonce;
    this._remoteChallenge = helloAck.challenge;
    
    // Generate challenge response
    this._challenge = crypto.randomBytes(32);
    
    this._setState(HandshakeState.AUTH_SENT);
    
    // Create AUTH message with challenge response
    return this._createAuthMessage();
  }

  /**
   * Handle AUTH message
   */
  async _handleAuth(message) {
    if (this._state !== HandshakeState.HELLO_RECEIVED) {
      throw new Error('Received AUTH in invalid state');
    }
    
    // Parse AUTH
    const auth = this._parseAuth(message.payload);
    
    // Verify challenge response
    if (!this._verifyChallengeResponse(auth.challengeResponse, this._challenge)) {
      this._fail('Challenge verification failed');
      return null;
    }
    
    // Store remote challenge
    this._remoteChallenge = auth.challenge;
    
    // Derive session key
    this._deriveSessionKey();
    
    this._setState(HandshakeState.AUTHENTICATED);
    this._clearTimeout();
    
    this.emit(HandshakeEvents.COMPLETE, {
      nodeId: this._remoteNodeId,
      sessionKey: this._sessionKey
    });
    
    // Create AUTH_ACK
    return this._createAuthAckMessage();
  }

  /**
   * Handle AUTH_ACK message
   */
  async _handleAuthAck(message) {
    if (this._state !== HandshakeState.AUTH_SENT) {
      throw new Error('Received AUTH_ACK in invalid state');
    }
    
    // Parse AUTH_ACK
    const authAck = this._parseAuthAck(message.payload);
    
    // Verify challenge response
    if (!this._verifyChallengeResponse(authAck.challengeResponse, this._challenge)) {
      this._fail('Challenge verification failed');
      return null;
    }
    
    // Derive session key
    this._deriveSessionKey();
    
    this._setState(HandshakeState.AUTHENTICATED);
    this._clearTimeout();
    
    this.emit(HandshakeEvents.COMPLETE, {
      nodeId: this._remoteNodeId,
      sessionKey: this._sessionKey
    });
    
    return null;
  }

  /**
   * Create HELLO message
   */
  _createHelloMessage() {
    const payload = Buffer.concat([
      Buffer.from([this.options.protocolVersion]),
      Buffer.from([this.options.authMethod]),
      Buffer.from([this._nodeId.length]),
      Buffer.from(this._nodeId, 'hex'),
      this._nonce,
      Buffer.from([this._publicKey.length]),
      this._publicKey
    ]);
    
    return WireMessage.fromBuffer(Buffer.concat([
      Buffer.from([WireMessageType.HELLO, 0]),
      Buffer.alloc(14), // Rest of header
      payload
    ]));
  }

  /**
   * Create HELLO_ACK message
   */
  _createHelloAckMessage() {
    const payload = Buffer.concat([
      Buffer.from([this.options.protocolVersion]),
      Buffer.from([this.options.authMethod]),
      Buffer.from([this._nodeId.length]),
      Buffer.from(this._nodeId, 'hex'),
      this._nonce,
      Buffer.from([this._publicKey.length]),
      this._publicKey,
      this._challenge
    ]);
    
    return WireMessage.fromBuffer(Buffer.concat([
      Buffer.from([WireMessageType.HELLO_ACK >> 8, WireMessageType.HELLO_ACK & 0xFF]),
      Buffer.alloc(14),
      payload
    ]));
  }

  /**
   * Create AUTH message
   */
  _createAuthMessage() {
    // Sign remote challenge
    const challengeResponse = this._signChallenge(this._remoteChallenge);
    
    const payload = Buffer.concat([
      Buffer.from([challengeResponse.length]),
      challengeResponse,
      this._challenge
    ]);
    
    return WireMessage.fromBuffer(Buffer.concat([
      Buffer.from([WireMessageType.AUTH >> 8, WireMessageType.AUTH & 0xFF]),
      Buffer.alloc(14),
      payload
    ]));
  }

  /**
   * Create AUTH_ACK message
   */
  _createAuthAckMessage() {
    // Sign remote challenge
    const challengeResponse = this._signChallenge(this._remoteChallenge);
    
    const payload = Buffer.concat([
      Buffer.from([challengeResponse.length]),
      challengeResponse
    ]);
    
    return WireMessage.fromBuffer(Buffer.concat([
      Buffer.from([WireMessageType.AUTH_ACK >> 8, WireMessageType.AUTH_ACK & 0xFF]),
      Buffer.alloc(14),
      payload
    ]));
  }

  /**
   * Parse HELLO message
   */
  _parseHello(payload) {
    let offset = 0;
    
    const version = payload.readUInt8(offset++);
    const authMethod = payload.readUInt8(offset++);
    const nodeIdLength = payload.readUInt8(offset++);
    const nodeId = payload.slice(offset, offset + nodeIdLength).toString('hex');
    offset += nodeIdLength;
    
    const nonce = payload.slice(offset, offset + 32);
    offset += 32;
    
    const publicKeyLength = payload.readUInt8(offset++);
    const publicKey = payload.slice(offset, offset + publicKeyLength);
    
    return { version, authMethod, nodeId, nonce, publicKey };
  }

  /**
   * Parse HELLO_ACK message
   */
  _parseHelloAck(payload) {
    let offset = 0;
    
    const version = payload.readUInt8(offset++);
    const authMethod = payload.readUInt8(offset++);
    const nodeIdLength = payload.readUInt8(offset++);
    const nodeId = payload.slice(offset, offset + nodeIdLength).toString('hex');
    offset += nodeIdLength;
    
    const nonce = payload.slice(offset, offset + 32);
    offset += 32;
    
    const publicKeyLength = payload.readUInt8(offset++);
    const publicKey = payload.slice(offset, offset + publicKeyLength);
    offset += publicKeyLength;
    
    const challenge = payload.slice(offset, offset + 32);
    
    return { version, authMethod, nodeId, nonce, publicKey, challenge };
  }

  /**
   * Parse AUTH message
   */
  _parseAuth(payload) {
    let offset = 0;
    
    const responseLength = payload.readUInt8(offset++);
    const challengeResponse = payload.slice(offset, offset + responseLength);
    offset += responseLength;
    
    const challenge = payload.slice(offset, offset + 32);
    
    return { challengeResponse, challenge };
  }

  /**
   * Parse AUTH_ACK message
   */
  _parseAuthAck(payload) {
    const responseLength = payload.readUInt8(0);
    const challengeResponse = payload.slice(1, 1 + responseLength);
    
    return { challengeResponse };
  }

  /**
   * Sign challenge with private key
   */
  _signChallenge(challenge) {
    if (!this._privateKey) {
      // If no private key, just return hash (for testing)
      return crypto.createHash('sha256').update(challenge).digest();
    }
    
    return crypto.sign('sha256', challenge, this._privateKey);
  }

  /**
   * Verify challenge response
   */
  _verifyChallengeResponse(response, challenge) {
    if (!this._remotePublicKey) {
      // If no public key, verify hash (for testing)
      const expected = crypto.createHash('sha256').update(challenge).digest();
      return response.equals(expected);
    }
    
    return crypto.verify('sha256', challenge, this._remotePublicKey, response);
  }

  /**
   * Derive session key
   */
  _deriveSessionKey() {
    // Combine nonces and derive key using HKDF
    const combined = Buffer.concat([this._nonce, this._remoteNonce]);
    this._sessionKey = crypto.createHash('sha256')
      .update(combined)
      .update(this._nodeId || '')
      .update(this._remoteNodeId || '')
      .digest();
  }

  /**
   * Set state
   */
  _setState(state) {
    this._state = state;
  }

  /**
   * Fail handshake
   */
  _fail(reason) {
    this._setState(HandshakeState.FAILED);
    this._clearTimeout();
    this.emit(HandshakeEvents.FAILED, { reason });
  }

  /**
   * Start timeout
   */
  _startTimeout() {
    this._timeout = setTimeout(() => {
      this._fail('Handshake timeout');
      this.emit(HandshakeEvents.TIMEOUT);
    }, this.options.timeout);
  }

  /**
   * Clear timeout
   */
  _clearTimeout() {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
  }

  /**
   * Reset handshake
   */
  reset() {
    this._clearTimeout();
    this._state = HandshakeState.IDLE;
    this._remoteNodeId = null;
    this._remotePublicKey = null;
    this._sessionKey = null;
    this._nonce = null;
    this._remoteNonce = null;
    this._challenge = null;
    this._remoteChallenge = null;
  }
}

export default HandshakeManager;
