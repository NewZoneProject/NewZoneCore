// Module: Secure Channel Manager
// Description: Manages encrypted communication channels with automatic rekeying,
//              peer session management, and message send/receive API.
// File: core/channel/manager.js

import { randomBytes } from 'crypto';
import { EventTypes, getEventBus } from '../eventbus/index.js';

// ============================================================================
// CHANNEL STATE
// ============================================================================

export const ChannelState = {
  INITIALIZING: 'initializing',
  OPEN: 'open',
  REKEYING: 'rekeying',
  CLOSED: 'closed',
  ERROR: 'error'
};

// ============================================================================
// SECURE CHANNEL
// ============================================================================

export class SecureChannel {
  constructor(peerId, options = {}) {
    this.id = `ch:${peerId}:${Date.now()}`;
    this.peerId = peerId;
    this.peerPublicKey = options.peerPublicKey;
    
    this.state = ChannelState.INITIALIZING;
    this.createdAt = new Date().toISOString();
    this.lastActivity = null;
    
    // Encryption
    this.sharedKey = null;
    this.nonceCounter = 0;
    this.epoch = 0;
    
    // Rekeying
    this.rekeyInterval = options.rekeyInterval || 3600000; // 1 hour
    this.messageCount = 0;
    this.messagesPerEpoch = options.messagesPerEpoch || 10000;
    this.rekeyTimer = null;
    
    // Session
    this.sessionKeys = [];
    this.currentKey = null;
    
    // Options
    this.options = options;
    this.identity = options.identity;
    this.eventBus = getEventBus();
    
    // Message queue
    this.messageQueue = [];
    this.maxQueueSize = options.maxQueueSize || 100;
  }
  
  // =========================================================================
  // LIFECYCLE
  // =========================================================================
  
  /**
   * Open the channel
   */
  async open() {
    if (this.state === ChannelState.OPEN) {
      return { success: true, message: 'Channel already open' };
    }
    
    try {
      // Derive shared key
      if (this.identity && this.peerPublicKey) {
        const result = await this.identity.deriveSharedKey(this.peerPublicKey);
        this.sharedKey = result.sharedKey;
      }
      
      this.state = ChannelState.OPEN;
      this.lastActivity = new Date().toISOString();
      
      // Start rekey timer
      this._startRekeyTimer();
      
      this.eventBus.emit(EventTypes.CHANNEL_OPENED, {
        channelId: this.id,
        peerId: this.peerId,
        epoch: this.epoch
      });
      
      return { success: true, channelId: this.id };
    } catch (error) {
      this.state = ChannelState.ERROR;
      this.eventBus.emit(EventTypes.CHANNEL_ERROR, {
        channelId: this.id,
        error: error.message,
        phase: 'open'
      });
      throw error;
    }
  }
  
  /**
   * Close the channel
   */
  async close(reason = 'manual') {
    if (this.state === ChannelState.CLOSED) {
      return { success: true };
    }
    
    this._stopRekeyTimer();
    this.state = ChannelState.CLOSED;
    
    // Clear sensitive data
    this.sharedKey = null;
    this.currentKey = null;
    this.sessionKeys = [];
    
    this.eventBus.emit(EventTypes.CHANNEL_CLOSED, {
      channelId: this.id,
      peerId: this.peerId,
      reason,
      uptime: this._getUptime()
    });
    
    return { success: true };
  }
  
  // =========================================================================
  // MESSAGING
  // =========================================================================
  
  /**
   * Send a message
   */
  async send(message) {
    if (this.state !== ChannelState.OPEN) {
      throw new Error(`Channel not open: ${this.state}`);
    }
    
    if (!this.sharedKey) {
      throw new Error('No shared key established');
    }
    
    // Check if rekey needed
    if (this._needsRekey()) {
      await this.rekey();
    }
    
    try {
      const box = await import('../crypto/box.js');
      
      // Serialize message
      const plaintext = typeof message === 'string' 
        ? message 
        : JSON.stringify(message);
      
      // Generate nonce
      const nonce = this._generateNonce();
      
      // Encrypt
      const encrypted = box.seal(
        Buffer.from(plaintext, 'utf8'),
        nonce,
        Buffer.from(this.sharedKey, 'base64')
      );
      
      const envelope = {
        channelId: this.id,
        epoch: this.epoch,
        nonce: Buffer.from(nonce).toString('base64'),
        ciphertext: Buffer.from(encrypted).toString('base64'),
        timestamp: new Date().toISOString()
      };
      
      this.messageCount++;
      this.lastActivity = new Date().toISOString();
      
      this.eventBus.emit(EventTypes.CHANNEL_MESSAGE, {
        channelId: this.id,
        direction: 'outbound',
        epoch: this.epoch,
        messageCount: this.messageCount
      });
      
      return envelope;
    } catch (error) {
      this.eventBus.emit(EventTypes.CHANNEL_ERROR, {
        channelId: this.id,
        error: error.message,
        phase: 'send'
      });
      throw error;
    }
  }
  
  /**
   * Receive and decrypt a message
   */
  async receive(envelope) {
    if (this.state !== ChannelState.OPEN && this.state !== ChannelState.REKEYING) {
      throw new Error(`Channel not ready: ${this.state}`);
    }
    
    if (!this.sharedKey) {
      throw new Error('No shared key established');
    }
    
    try {
      const box = await import('../crypto/box.js');
      
      // Check epoch
      if (envelope.epoch !== undefined && envelope.epoch < this.epoch - 1) {
        throw new Error('Message from expired epoch');
      }
      
      // Decrypt
      const decrypted = box.open(
        Buffer.from(envelope.ciphertext, 'base64'),
        Buffer.from(envelope.nonce, 'base64'),
        Buffer.from(this.sharedKey, 'base64')
      );
      
      if (!decrypted) {
        throw new Error('Decryption failed');
      }
      
      const plaintext = Buffer.from(decrypted).toString('utf8');
      let message;
      
      try {
        message = JSON.parse(plaintext);
      } catch {
        message = plaintext;
      }
      
      this.lastActivity = new Date().toISOString();
      
      this.eventBus.emit(EventTypes.CHANNEL_MESSAGE, {
        channelId: this.id,
        direction: 'inbound',
        epoch: envelope.epoch
      });
      
      return message;
    } catch (error) {
      this.eventBus.emit(EventTypes.CHANNEL_ERROR, {
        channelId: this.id,
        error: error.message,
        phase: 'receive'
      });
      throw error;
    }
  }
  
  // =========================================================================
  // REKEYING
  // =========================================================================
  
  /**
   * Perform key rotation
   */
  async rekey() {
    const previousState = this.state;
    this.state = ChannelState.REKEYING;
    
    this.eventBus.emit(EventTypes.CHANNEL_REKEY, {
      channelId: this.id,
      previousEpoch: this.epoch,
      phase: 'start'
    });
    
    try {
      // Derive new key from existing key
      const hkdf = await import('../crypto/derive.js');
      
      const newKey = hkdf.deriveSubKey(
        Buffer.from(this.sharedKey, 'base64'),
        `epoch-${this.epoch + 1}`,
        32
      );
      
      // Store old key for transition period
      this.sessionKeys.push({
        key: this.sharedKey,
        epoch: this.epoch,
        retiredAt: new Date().toISOString()
      });
      
      // Activate new key
      this.sharedKey = Buffer.from(newKey).toString('base64');
      this.epoch++;
      this.messageCount = 0;
      this.nonceCounter = 0;
      
      this.state = ChannelState.OPEN;
      
      this.eventBus.emit(EventTypes.CHANNEL_REKEY, {
        channelId: this.id,
        newEpoch: this.epoch,
        phase: 'complete'
      });
      
      return { success: true, epoch: this.epoch };
    } catch (error) {
      this.state = ChannelState.ERROR;
      this.eventBus.emit(EventTypes.CHANNEL_ERROR, {
        channelId: this.id,
        error: error.message,
        phase: 'rekey'
      });
      throw error;
    }
  }
  
  _needsRekey() {
    // Rekey based on message count
    if (this.messageCount >= this.messagesPerEpoch) {
      return true;
    }
    
    // Rekey based on time
    if (this.lastActivity) {
      const elapsed = Date.now() - new Date(this.lastActivity).getTime();
      if (elapsed >= this.rekeyInterval) {
        return true;
      }
    }
    
    return false;
  }
  
  _startRekeyTimer() {
    if (this.rekeyTimer) return;
    
    this.rekeyTimer = setInterval(async () => {
      if (this.state === ChannelState.OPEN && this._needsRekey()) {
        try {
          await this.rekey();
        } catch (error) {
          console.error(`[channel] Rekey failed: ${error.message}`);
        }
      }
    }, 60000); // Check every minute
  }
  
  _stopRekeyTimer() {
    if (this.rekeyTimer) {
      clearInterval(this.rekeyTimer);
      this.rekeyTimer = null;
    }
  }
  
  // =========================================================================
  // STATUS
  // =========================================================================
  
  getStatus() {
    return {
      id: this.id,
      peerId: this.peerId,
      state: this.state,
      epoch: this.epoch,
      messageCount: this.messageCount,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      uptime: this._getUptime()
    };
  }
  
  _getUptime() {
    return Date.now() - new Date(this.createdAt).getTime();
  }
  
  _generateNonce() {
    // Increment nonce counter for uniqueness
    this.nonceCounter++;
    
    // Create 12-byte nonce from counter and random bytes
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.nonceCounter, 0);
    
    const random = randomBytes(8);
    
    return Buffer.concat([counter, random]);
  }
}

// ============================================================================
// CHANNEL MANAGER
// ============================================================================

export class ChannelManager {
  constructor(options = {}) {
    this.channels = new Map();
    this.identity = options.identity || null;
    this.eventBus = getEventBus();
    this.options = options;
  }
  
  // =========================================================================
  // CHANNEL MANAGEMENT
  // =========================================================================
  
  /**
   * Open a channel to a peer
   */
  async open(peerId, options = {}) {
    if (this.channels.has(peerId)) {
      const existing = this.channels.get(peerId);
      if (existing.state === ChannelState.OPEN) {
        return existing;
      }
    }
    
    const channel = new SecureChannel(peerId, {
      ...this.options,
      ...options,
      identity: this.identity
    });
    
    await channel.open();
    this.channels.set(peerId, channel);
    
    return channel;
  }
  
  /**
   * Close a channel
   */
  async close(peerId, reason = 'manual') {
    const channel = this.channels.get(peerId);
    if (!channel) {
      return { success: true, message: 'Channel not found' };
    }
    
    await channel.close(reason);
    this.channels.delete(peerId);
    
    return { success: true };
  }
  
  /**
   * Close all channels
   */
  async closeAll(reason = 'shutdown') {
    const results = {};
    
    for (const [peerId, channel] of this.channels) {
      try {
        await channel.close(reason);
        results[peerId] = { success: true };
      } catch (error) {
        results[peerId] = { success: false, error: error.message };
      }
    }
    
    this.channels.clear();
    return results;
  }
  
  /**
   * Get a channel by peer ID
   */
  get(peerId) {
    return this.channels.get(peerId) || null;
  }
  
  /**
   * Check if channel exists
   */
  has(peerId) {
    return this.channels.has(peerId);
  }
  
  // =========================================================================
  // MESSAGING
  // =========================================================================
  
  /**
   * Send a message to a peer
   */
  async send(peerId, message) {
    let channel = this.channels.get(peerId);
    
    if (!channel) {
      throw new Error(`No channel to peer: ${peerId}`);
    }
    
    return channel.send(message);
  }
  
  /**
   * Receive a message from a peer
   */
  async receive(peerId, envelope) {
    let channel = this.channels.get(peerId);
    
    if (!channel) {
      throw new Error(`No channel from peer: ${peerId}`);
    }
    
    return channel.receive(envelope);
  }
  
  // =========================================================================
  // STATUS
  // =========================================================================
  
  getStatus() {
    const channels = {};
    
    for (const [peerId, channel] of this.channels) {
      channels[peerId] = channel.getStatus();
    }
    
    return {
      total: this.channels.size,
      open: this._countByState(ChannelState.OPEN),
      closed: this._countByState(ChannelState.CLOSED),
      error: this._countByState(ChannelState.ERROR),
      channels
    };
  }
  
  list() {
    return Array.from(this.channels.keys());
  }
  
  _countByState(state) {
    let count = 0;
    for (const channel of this.channels.values()) {
      if (channel.state === state) count++;
    }
    return count;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let globalManager = null;

export function getChannelManager(options = {}) {
  if (!globalManager) {
    globalManager = new ChannelManager(options);
  }
  return globalManager;
}

export function createChannelManager(options = {}) {
  return new ChannelManager(options);
}
