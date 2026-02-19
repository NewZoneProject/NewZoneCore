// Module: TURN Client
// Description: TURN relay client for NAT traversal (RFC 5766).
// File: network/nat/turn-client.js

import dgram from 'dgram';
import { EventEmitter } from 'events';
import {
  STUN_MAGIC_COOKIE,
  STUNMessageType,
  STUNAttribute
} from './constants.js';

/**
 * TURN Methods (RFC 5766)
 */
export const TURNMethod = {
  ALLOCATE: 0x0003,
  REFRESH: 0x0004,
  SEND: 0x0006,
  DATA: 0x0007,
  CREATE_PERMISSION: 0x0008,
  CHANNEL_BIND: 0x0009
};

/**
 * TURN Message Types (Method + Class)
 */
export const TURNMessageType = {
  ALLOCATE_REQUEST: 0x0003,
  ALLOCATE_SUCCESS: 0x0103,
  ALLOCATE_ERROR: 0x0113,
  REFRESH_REQUEST: 0x0004,
  REFRESH_SUCCESS: 0x0104,
  REFRESH_ERROR: 0x0114,
  SEND_INDICATION: 0x0016,
  DATA_INDICATION: 0x0017,
  CREATE_PERMISSION_REQUEST: 0x0008,
  CREATE_PERMISSION_SUCCESS: 0x0108,
  CREATE_PERMISSION_ERROR: 0x0118,
  CHANNEL_BIND_REQUEST: 0x0009,
  CHANNEL_BIND_SUCCESS: 0x0109,
  CHANNEL_BIND_ERROR: 0x0119
};

/**
 * TURN Attributes
 */
export const TURNAttribute = {
  CHANNEL_NUMBER: 0x000C,
  LIFETIME: 0x000D,
  XOR_PEER_ADDRESS: 0x0012,
  DATA: 0x0013,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
  DONT_FRAGMENT: 0x001A,
  RESERVATION_TOKEN: 0x0022,
  EVEN_PORT: 0x001B,
  REQUESTED_ADDRESS_FAMILY: 0x0017
};

/**
 * TURN Errors
 */
export const TURNError = {
  FORBIDDEN: 403,
  ALLOCATION_MISMATCH: 437,
  STALE_NONCE: 438,
  ADDRESS_FAMILY_NOT_SUPPORTED: 440,
  PEER_ADDRESS_FAMILY_MISMATCH: 443,
  CONNECTION_TIMEOUT_OR_FAILURE: 447,
  ALLOCATION_QUOTA_REACHED: 486,
  INSUFFICIENT_CAPACITY: 508
};

/**
 * TURN Client Events
 */
export const TURNEvents = {
  ALLOCATED: 'allocated',
  REFRESHED: 'refreshed',
  DATA: 'data',
  ERROR: 'error',
  DISCONNECTED: 'disconnected',
  PERMISSION_CREATED: 'permission_created',
  CHANNEL_BOUND: 'channel_bound'
};

/**
 * Default TURN Options
 */
const DEFAULT_TURN_OPTIONS = {
  timeout: 10000,
  lifetime: 600,          // 10 minutes default allocation
  maxRetries: 3,
  retryDelay: 1000,
  channelMin: 0x4000,     // Channel numbers 0x4000 - 0x7FFF
  channelMax: 0x7FFF
};

/**
 * Allocation State
 */
const AllocationState = {
  NONE: 'none',
  PENDING: 'pending',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  FAILED: 'failed'
};

/**
 * TURNClient class - implements TURN relay protocol
 */
export class TURNClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_TURN_OPTIONS, ...options };
    
    // Server info
    this._server = options.server;
    this._port = options.port || 3478;
    this._username = options.username;
    this._password = options.password;
    this._realm = options.realm || '';
    this._nonce = options.nonce || '';
    
    // Socket
    this._socket = null;
    
    // Allocation
    this._allocation = null;
    this._allocationState = AllocationState.NONE;
    this._relayedAddress = null;
    this._relayedPort = null;
    this._lifetime = this.options.lifetime;
    
    // Permissions and channels
    this._permissions = new Map(); // peer address -> permission
    this._channels = new Map();     // channel number -> peer address
    this._nextChannel = this.options.channelMin;
    
    // Pending requests
    this._pendingRequests = new Map();
    
    // Refresh timer
    this._refreshTimer = null;
    
    // State
    this._isRunning = false;
  }

  /**
   * Get relayed address
   */
  get relayedAddress() {
    return this._relayedAddress;
  }

  /**
   * Get relayed port
   */
  get relayedPort() {
    return this._relayedPort;
  }

  /**
   * Check if allocated
   */
  get isAllocated() {
    return this._allocationState === AllocationState.ACTIVE;
  }

  /**
   * Get allocation state
   */
  get allocationState() {
    return this._allocationState;
  }

  /**
   * Connect to TURN server
   */
  async connect() {
    if (this._isRunning) return;
    
    return new Promise((resolve, reject) => {
      this._socket = dgram.createSocket('udp4');
      
      const timeout = setTimeout(() => {
        reject(new Error('TURN connection timeout'));
      }, this.options.timeout);
      
      this._socket.on('message', (msg, rinfo) => {
        this._handleMessage(msg, rinfo);
      });
      
      this._socket.on('error', (err) => {
        this.emit(TURNEvents.ERROR, err);
      });
      
      this._socket.bind(() => {
        clearTimeout(timeout);
        this._isRunning = true;
        resolve();
      });
    });
  }

  /**
   * Disconnect from TURN server
   */
  async disconnect() {
    if (!this._isRunning) return;
    
    // Clear refresh timer
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    
    // Refresh with lifetime 0 to delete allocation
    if (this.isAllocated) {
      try {
        await this._sendRefresh(0);
      } catch (e) {
        // Ignore errors on cleanup
      }
    }
    
    return new Promise((resolve) => {
      if (this._socket) {
        this._socket.close(() => {
          this._socket = null;
          this._isRunning = false;
          this._allocationState = AllocationState.NONE;
          this.emit(TURNEvents.DISCONNECTED);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Allocate a relay address
   */
  async allocate(lifetime = this._lifetime) {
    if (!this._isRunning) {
      await this.connect();
    }
    
    if (this._allocationState === AllocationState.ACTIVE) {
      return {
        address: this._relayedAddress,
        port: this._relayedPort
      };
    }
    
    this._allocationState = AllocationState.PENDING;
    
    return new Promise((resolve, reject) => {
      const transactionId = this._generateTransactionId();
      
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(transactionId.toString('hex'));
        this._allocationState = AllocationState.FAILED;
        reject(new Error('ALLOCATE timeout'));
      }, this.options.timeout);
      
      this._pendingRequests.set(transactionId.toString('hex'), {
        resolve: (result) => {
          clearTimeout(timeout);
          this._allocationState = AllocationState.ACTIVE;
          this._relayedAddress = result.address;
          this._relayedPort = result.port;
          this._lifetime = result.lifetime;
          
          // Start refresh timer
          this._scheduleRefresh();
          
          this.emit(TURNEvents.ALLOCATED, result);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeout);
          this._allocationState = AllocationState.FAILED;
          reject(err);
        }
      });
      
      this._sendAllocate(transactionId, lifetime);
    });
  }

  /**
   * Create permission for a peer
   */
  async createPermission(peerAddress, peerPort) {
    if (!this.isAllocated) {
      throw new Error('No active allocation');
    }
    
    const transactionId = this._generateTransactionId();
    const peerKey = `${peerAddress}:${peerPort}`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(transactionId.toString('hex'));
        reject(new Error('CREATE_PERMISSION timeout'));
      }, this.options.timeout);
      
      this._pendingRequests.set(transactionId.toString('hex'), {
        resolve: () => {
          clearTimeout(timeout);
          this._permissions.set(peerKey, {
            address: peerAddress,
            port: peerPort,
            createdAt: Date.now()
          });
          
          this.emit(TURNEvents.PERMISSION_CREATED, {
            address: peerAddress,
            port: peerPort
          });
          
          resolve();
        },
        reject
      });
      
      this._sendCreatePermission(transactionId, peerAddress, peerPort);
    });
  }

  /**
   * Bind a channel to a peer (more efficient than SEND)
   */
  async bindChannel(peerAddress, peerPort) {
    if (!this.isAllocated) {
      throw new Error('No active allocation');
    }
    
    const peerKey = `${peerAddress}:${peerPort}`;
    
    // Check if already bound
    for (const [channel, peer] of this._channels) {
      if (peer === peerKey) {
        return channel;
      }
    }
    
    const channelNumber = this._nextChannel++;
    if (this._nextChannel > this.options.channelMax) {
      this._nextChannel = this.options.channelMin;
    }
    
    const transactionId = this._generateTransactionId();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(transactionId.toString('hex'));
        reject(new Error('CHANNEL_BIND timeout'));
      }, this.options.timeout);
      
      this._pendingRequests.set(transactionId.toString('hex'), {
        resolve: () => {
          clearTimeout(timeout);
          this._channels.set(channelNumber, peerKey);
          
          this.emit(TURNEvents.CHANNEL_BOUND, {
            channel: channelNumber,
            address: peerAddress,
            port: peerPort
          });
          
          resolve(channelNumber);
        },
        reject
      });
      
      this._sendChannelBind(transactionId, channelNumber, peerAddress, peerPort);
    });
  }

  /**
   * Send data to a peer via relay
   */
  async send(peerAddress, peerPort, data) {
    if (!this.isAllocated) {
      throw new Error('No active allocation');
    }
    
    const peerKey = `${peerAddress}:${peerPort}`;
    
    // Check for channel binding (more efficient)
    for (const [channel, peer] of this._channels) {
      if (peer === peerKey) {
        return this._sendChannelData(channel, data);
      }
    }
    
    // Check permission
    if (!this._permissions.has(peerKey)) {
      await this.createPermission(peerAddress, peerPort);
    }
    
    // Send via SEND indication
    return this._sendSendIndication(peerAddress, peerPort, data);
  }

  /**
   * Refresh allocation
   */
  async refresh(lifetime = this._lifetime) {
    if (!this.isAllocated) {
      throw new Error('No active allocation');
    }
    
    return this._sendRefresh(lifetime);
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Generate transaction ID
   */
  _generateTransactionId() {
    const id = Buffer.alloc(12);
    for (let i = 0; i < 12; i++) {
      id[i] = Math.floor(Math.random() * 256);
    }
    return id;
  }

  /**
   * Send ALLOCATE request
   */
  _sendAllocate(transactionId, lifetime) {
    const buffers = [];
    
    // Message type
    const messageType = Buffer.alloc(2);
    messageType.writeUInt16BE(TURNMessageType.ALLOCATE_REQUEST);
    buffers.push(messageType);
    
    // Message length (placeholder)
    const messageLength = Buffer.alloc(2);
    buffers.push(messageLength);
    
    // Magic cookie
    const magicCookie = Buffer.alloc(4);
    magicCookie.writeUInt32BE(STUN_MAGIC_COOKIE);
    buffers.push(magicCookie);
    
    // Transaction ID
    buffers.push(transactionId);
    
    // REQUESTED-TRANSPORT attribute (UDP = 17)
    const transportAttr = Buffer.alloc(4);
    transportAttr.writeUInt16BE(TURNAttribute.REQUESTED_TRANSPORT, 0);
    transportAttr.writeUInt16BE(4, 2); // Length
    buffers.push(transportAttr);
    
    const transportValue = Buffer.alloc(4);
    transportValue.writeUInt8(17, 0); // UDP protocol number
    buffers.push(transportValue);
    
    // LIFETIME attribute
    const lifetimeAttr = Buffer.alloc(4);
    lifetimeAttr.writeUInt16BE(TURNAttribute.LIFETIME, 0);
    lifetimeAttr.writeUInt16BE(4, 2);
    buffers.push(lifetimeAttr);
    
    const lifetimeValue = Buffer.alloc(4);
    lifetimeValue.writeUInt32BE(lifetime);
    buffers.push(lifetimeValue);
    
    // Update message length
    const totalLength = buffers.slice(4).reduce((sum, buf) => sum + buf.length, 0);
    messageLength.writeUInt16BE(totalLength);
    
    const packet = Buffer.concat(buffers);
    this._socket.send(packet, this._port, this._server);
  }

  /**
   * Send CREATE_PERMISSION request
   */
  _sendCreatePermission(transactionId, peerAddress, peerPort) {
    const buffers = [];
    
    // Message type
    const messageType = Buffer.alloc(2);
    messageType.writeUInt16BE(TURNMessageType.CREATE_PERMISSION_REQUEST);
    buffers.push(messageType);
    
    // Message length (placeholder)
    const messageLength = Buffer.alloc(2);
    buffers.push(messageLength);
    
    // Magic cookie
    const magicCookie = Buffer.alloc(4);
    magicCookie.writeUInt32BE(STUN_MAGIC_COOKIE);
    buffers.push(magicCookie);
    
    // Transaction ID
    buffers.push(transactionId);
    
    // XOR-PEER-ADDRESS attribute
    buffers.push(this._createXorPeerAddress(peerAddress, peerPort, transactionId));
    
    // Update message length
    const totalLength = buffers.slice(4).reduce((sum, buf) => sum + buf.length, 0);
    messageLength.writeUInt16BE(totalLength);
    
    const packet = Buffer.concat(buffers);
    this._socket.send(packet, this._port, this._server);
  }

  /**
   * Send CHANNEL_BIND request
   */
  _sendChannelBind(transactionId, channelNumber, peerAddress, peerPort) {
    const buffers = [];
    
    // Message type
    const messageType = Buffer.alloc(2);
    messageType.writeUInt16BE(TURNMessageType.CHANNEL_BIND_REQUEST);
    buffers.push(messageType);
    
    // Message length (placeholder)
    const messageLength = Buffer.alloc(2);
    buffers.push(messageLength);
    
    // Magic cookie
    const magicCookie = Buffer.alloc(4);
    magicCookie.writeUInt32BE(STUN_MAGIC_COOKIE);
    buffers.push(magicCookie);
    
    // Transaction ID
    buffers.push(transactionId);
    
    // CHANNEL-NUMBER attribute
    const channelAttr = Buffer.alloc(8);
    channelAttr.writeUInt16BE(TURNAttribute.CHANNEL_NUMBER, 0);
    channelAttr.writeUInt16BE(4, 2);
    channelAttr.writeUInt16BE(channelNumber, 4);
    buffers.push(channelAttr);
    
    // XOR-PEER-ADDRESS attribute
    buffers.push(this._createXorPeerAddress(peerAddress, peerPort, transactionId));
    
    // Update message length
    const totalLength = buffers.slice(4).reduce((sum, buf) => sum + buf.length, 0);
    messageLength.writeUInt16BE(totalLength);
    
    const packet = Buffer.concat(buffers);
    this._socket.send(packet, this._port, this._server);
  }

  /**
   * Send SEND indication
   */
  _sendSendIndication(peerAddress, peerPort, data) {
    const buffers = [];
    
    // Message type
    const messageType = Buffer.alloc(2);
    messageType.writeUInt16BE(TURNMessageType.SEND_INDICATION);
    buffers.push(messageType);
    
    // Message length (placeholder)
    const messageLength = Buffer.alloc(2);
    buffers.push(messageLength);
    
    // Magic cookie
    const magicCookie = Buffer.alloc(4);
    magicCookie.writeUInt32BE(STUN_MAGIC_COOKIE);
    buffers.push(magicCookie);
    
    // Transaction ID (random for indications)
    buffers.push(this._generateTransactionId());
    
    // XOR-PEER-ADDRESS attribute
    buffers.push(this._createXorPeerAddress(peerAddress, peerPort));
    
    // DATA attribute
    const dataAttr = Buffer.alloc(4 + data.length);
    dataAttr.writeUInt16BE(TURNAttribute.DATA, 0);
    dataAttr.writeUInt16BE(data.length, 2);
    Buffer.from(data).copy(dataAttr, 4);
    buffers.push(dataAttr);
    
    // Update message length
    const totalLength = buffers.slice(4).reduce((sum, buf) => sum + buf.length, 0);
    messageLength.writeUInt16BE(totalLength);
    
    const packet = Buffer.concat(buffers);
    this._socket.send(packet, this._port, this._server);
    
    return data.length;
  }

  /**
   * Send channel data (more efficient)
   */
  _sendChannelData(channelNumber, data) {
    const buffers = [];
    
    // Channel number (2 bytes)
    const channel = Buffer.alloc(2);
    channel.writeUInt16BE(channelNumber);
    buffers.push(channel);
    
    // Length (2 bytes)
    const length = Buffer.alloc(2);
    length.writeUInt16BE(data.length);
    buffers.push(length);
    
    // Data
    buffers.push(Buffer.from(data));
    
    const packet = Buffer.concat(buffers);
    this._socket.send(packet, this._port, this._server);
    
    return data.length;
  }

  /**
   * Send REFRESH request
   */
  _sendRefresh(lifetime) {
    const transactionId = this._generateTransactionId();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(transactionId.toString('hex'));
        reject(new Error('REFRESH timeout'));
      }, this.options.timeout);
      
      this._pendingRequests.set(transactionId.toString('hex'), {
        resolve: (result) => {
          clearTimeout(timeout);
          if (lifetime > 0) {
            this._lifetime = result.lifetime;
          }
          this.emit(TURNEvents.REFRESHED, { lifetime: result.lifetime });
          resolve(result);
        },
        reject
      });
      
      const buffers = [];
      
      // Message type
      const messageType = Buffer.alloc(2);
      messageType.writeUInt16BE(TURNMessageType.REFRESH_REQUEST);
      buffers.push(messageType);
      
      // Message length (placeholder)
      const messageLength = Buffer.alloc(2);
      buffers.push(messageLength);
      
      // Magic cookie
      const magicCookie = Buffer.alloc(4);
      magicCookie.writeUInt32BE(STUN_MAGIC_COOKIE);
      buffers.push(magicCookie);
      
      // Transaction ID
      buffers.push(transactionId);
      
      // LIFETIME attribute
      const lifetimeAttr = Buffer.alloc(4);
      lifetimeAttr.writeUInt16BE(TURNAttribute.LIFETIME, 0);
      lifetimeAttr.writeUInt16BE(4, 2);
      buffers.push(lifetimeAttr);
      
      const lifetimeValue = Buffer.alloc(4);
      lifetimeValue.writeUInt32BE(lifetime);
      buffers.push(lifetimeValue);
      
      // Update message length
      const totalLength = buffers.slice(4).reduce((sum, buf) => sum + buf.length, 0);
      messageLength.writeUInt16BE(totalLength);
      
      const packet = Buffer.concat(buffers);
      this._socket.send(packet, this._port, this._server);
    });
  }

  /**
   * Create XOR-PEER-ADDRESS attribute
   */
  _createXorPeerAddress(address, port, transactionId = null) {
    const parts = address.split('.').map(Number);
    const buffer = Buffer.alloc(12);
    
    // Attribute type
    buffer.writeUInt16BE(TURNAttribute.XOR_PEER_ADDRESS, 0);
    
    // Attribute length
    buffer.writeUInt16BE(8, 2);
    
    // Reserved + Family (IPv4 = 1)
    buffer.writeUInt8(0, 4);
    buffer.writeUInt8(1, 5);
    
    // XOR port with magic cookie
    const xoredPort = port ^ (STUN_MAGIC_COOKIE >> 16);
    buffer.writeUInt16BE(xoredPort, 6);
    
    // XOR address with magic cookie
    const magicBuffer = Buffer.alloc(4);
    magicBuffer.writeUInt32BE(STUN_MAGIC_COOKIE);
    
    for (let i = 0; i < 4; i++) {
      buffer[8 + i] = parts[i] ^ magicBuffer[i];
    }
    
    return buffer;
  }

  /**
   * Handle incoming message
   */
  _handleMessage(msg, rinfo) {
    if (msg.length < 20) return;
    
    const messageType = msg.readUInt16BE(0);
    const magicCookie = msg.readUInt32BE(4);
    const transactionId = msg.slice(8, 20);
    
    // Verify magic cookie
    if (magicCookie !== STUN_MAGIC_COOKIE) return;
    
    // Check for DATA indication
    if (messageType === TURNMessageType.DATA_INDICATION) {
      this._handleDataIndication(msg);
      return;
    }
    
    // Check for channel data
    if (messageType >= 0x4000 && messageType <= 0x7FFF) {
      this._handleChannelData(messageType, msg);
      return;
    }
    
    // Find pending request
    const transactionIdHex = transactionId.toString('hex');
    const pending = this._pendingRequests.get(transactionIdHex);
    
    if (!pending) return;
    
    this._pendingRequests.delete(transactionIdHex);
    
    // Check for error
    if ((messageType & 0x0100) === 0x0100 && (messageType & 0x0010) === 0x0010) {
      // Error response
      const error = this._parseError(msg);
      pending.reject(new Error(`TURN error ${error.code}: ${error.reason}`));
      return;
    }
    
    // Success response
    const result = this._parseSuccessResponse(msg, messageType);
    pending.resolve(result);
  }

  /**
   * Handle DATA indication
   */
  _handleDataIndication(msg) {
    const data = this._extractAttribute(msg, TURNAttribute.DATA);
    const peerAddress = this._extractXorPeerAddress(msg);
    
    if (data && peerAddress) {
      this.emit(TURNEvents.DATA, {
        data: data.value,
        peerAddress: peerAddress.address,
        peerPort: peerAddress.port
      });
    }
  }

  /**
   * Handle channel data
   */
  _handleChannelData(channelNumber, msg) {
    const length = msg.readUInt16BE(2);
    const data = msg.slice(4, 4 + length);
    
    const peerKey = this._channels.get(channelNumber);
    if (peerKey) {
      const [address, port] = peerKey.split(':');
      this.emit(TURNEvents.DATA, {
        data,
        peerAddress: address,
        peerPort: parseInt(port)
      });
    }
  }

  /**
   * Parse success response
   */
  _parseSuccessResponse(msg, messageType) {
    const result = {};
    
    // Extract XOR-RELAYED-ADDRESS
    const relayed = this._extractXorRelayedAddress(msg);
    if (relayed) {
      result.address = relayed.address;
      result.port = relayed.port;
    }
    
    // Extract LIFETIME
    const lifetime = this._extractAttribute(msg, TURNAttribute.LIFETIME);
    if (lifetime) {
      result.lifetime = lifetime.value.readUInt32BE(0);
    }
    
    return result;
  }

  /**
   * Parse error response
   */
  _parseError(msg) {
    const errorCode = this._extractAttribute(msg, STUNAttribute.ERROR_CODE);
    if (errorCode) {
      const code = (errorCode.value.readUInt8(2) & 0x07) * 100 + errorCode.value.readUInt8(3);
      const reason = errorCode.value.slice(4).toString('utf8');
      return { code, reason };
    }
    return { code: 0, reason: 'Unknown error' };
  }

  /**
   * Extract attribute from message
   */
  _extractAttribute(msg, type) {
    let offset = 20;
    const messageLength = msg.readUInt16BE(2);
    
    while (offset < 20 + messageLength) {
      const attrType = msg.readUInt16BE(offset);
      const attrLength = msg.readUInt16BE(offset + 2);
      
      if (attrType === type) {
        return {
          type: attrType,
          length: attrLength,
          value: msg.slice(offset + 4, offset + 4 + attrLength)
        };
      }
      
      offset += 4 + Math.ceil(attrLength / 4) * 4;
    }
    
    return null;
  }

  /**
   * Extract XOR-RELAYED-ADDRESS
   */
  _extractXorRelayedAddress(msg) {
    const attr = this._extractAttribute(msg, TURNAttribute.XOR_RELAYED_ADDRESS);
    if (!attr) return null;
    
    const family = attr.value.readUInt8(1);
    const xoredPort = attr.value.readUInt16BE(2);
    const port = xoredPort ^ (STUN_MAGIC_COOKIE >> 16);
    
    const magicBuffer = Buffer.alloc(4);
    magicBuffer.writeUInt32BE(STUN_MAGIC_COOKIE);
    
    const address = [];
    for (let i = 0; i < 4; i++) {
      address.push(attr.value[4 + i] ^ magicBuffer[i]);
    }
    
    return {
      family,
      address: address.join('.'),
      port
    };
  }

  /**
   * Extract XOR-PEER-ADDRESS
   */
  _extractXorPeerAddress(msg) {
    const attr = this._extractAttribute(msg, TURNAttribute.XOR_PEER_ADDRESS);
    if (!attr) return null;
    
    const family = attr.value.readUInt8(1);
    const xoredPort = attr.value.readUInt16BE(2);
    const port = xoredPort ^ (STUN_MAGIC_COOKIE >> 16);
    
    const magicBuffer = Buffer.alloc(4);
    magicBuffer.writeUInt32BE(STUN_MAGIC_COOKIE);
    
    const address = [];
    for (let i = 0; i < 4; i++) {
      address.push(attr.value[4 + i] ^ magicBuffer[i]);
    }
    
    return {
      family,
      address: address.join('.'),
      port
    };
  }

  /**
   * Schedule automatic refresh
   */
  _scheduleRefresh() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
    }
    
    // Refresh at 80% of lifetime
    const refreshTime = this._lifetime * 800;
    
    this._refreshTimer = setTimeout(async () => {
      try {
        await this.refresh();
      } catch (e) {
        this.emit(TURNEvents.ERROR, e);
      }
    }, refreshTime);
  }
}

export default TURNClient;
