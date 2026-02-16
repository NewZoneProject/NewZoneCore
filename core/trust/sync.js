// Module: Distributed Trust Sync
// Description: Implements signed trust updates, trust replication protocol,
//              and peer trust validation for distributed trust management.
//              Now with replay protection and proper update storage.
// File: core/trust/sync.js

import { EventTypes, getEventBus } from '../eventbus/index.js';
import { randomBytes, createHash } from 'crypto';

// ============================================================================
// TRUST UPDATE TYPES
// ============================================================================

export const TrustUpdateType = {
  PEER_ADD: 'peer:add',
  PEER_REMOVE: 'peer:remove',
  PEER_UPDATE: 'peer:update',
  TRUST_LEVEL: 'trust:level',
  DELEGATION: 'trust:delegate',
  REVOCATION: 'trust:revoke'
};

// ============================================================================
// TRUST LEVELS
// ============================================================================

export const TrustLevel = {
  UNKNOWN: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  ULTIMATE: 4
};

// ============================================================================
// TRUST UPDATE
// ============================================================================

export class TrustUpdate {
  constructor(options = {}) {
    // Unique ID with sequence number for replay protection
    this.id = options.id || this._generateId();
    this.type = options.type || TrustUpdateType.PEER_ADD;
    this.peerId = options.peerId;
    this.peerKey = options.peerKey;
    this.trustLevel = options.trustLevel || TrustLevel.MEDIUM;
    this.metadata = options.metadata || {};
    this.timestamp = options.timestamp || new Date().toISOString();
    this.expiresAt = options.expiresAt || null;
    this.nonce = options.nonce || randomBytes(16).toString('hex');
    
    // Sequence number for replay protection
    this.sequence = options.sequence || 0;
    
    // Previous hash for chain integrity
    this.prevHash = options.prevHash || null;
    
    // Signature (can be passed for deserialization)
    this.signature = options.signature || null;
    this.signerId = options.signerId || null;
    this.signerKey = options.signerKey || null;
  }
  
  /**
   * Generate unique ID with timestamp and random component
   */
  _generateId() {
    const ts = Date.now().toString(36);
    const rand = randomBytes(8).toString('hex');
    return `tu:${ts}:${rand}`;
  }
  
  /**
   * Sign the trust update
   */
  async sign(identity) {
    const payload = this._getSignPayload();
    
    const result = await identity.sign(payload);
    
    this.signature = result.signature;
    this.signerId = identity.getNodeId();
    this.signerKey = result.publicKey;
    
    return this;
  }
  
  /**
   * Verify the trust update signature
   */
  async verify(signerKey = null) {
    if (!this.signature) {
      return { valid: false, error: 'No signature' };
    }
    
    const payload = this._getSignPayload();
    
    // Use provided key or stored signer key
    const publicKey = signerKey || this.signerKey;
    
    if (!publicKey) {
      return { valid: false, error: 'No public key to verify' };
    }
    
    try {
      const sign = await import('../crypto/sign.js');
      
      const valid = sign.verify(
        Buffer.from(payload, 'utf8'),
        Buffer.from(this.signature, 'base64'),
        Buffer.from(publicKey, 'base64')
      );
      
      return { valid };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
  
  /**
   * Check if update is expired
   */
  isExpired() {
    if (!this.expiresAt) return false;
    return new Date() > new Date(this.expiresAt);
  }
  
  /**
   * Calculate hash for chain integrity
   */
  calculateHash() {
    return createHash('sha256')
      .update(this._getSignPayload())
      .update(this.signature || '')
      .digest('hex');
  }
  
  /**
   * Get payload for signing
   */
  _getSignPayload() {
    return JSON.stringify({
      type: this.type,
      peerId: this.peerId,
      peerKey: this.peerKey,
      trustLevel: this.trustLevel,
      metadata: this.metadata,
      timestamp: this.timestamp,
      sequence: this.sequence,
      prevHash: this.prevHash,
      nonce: this.nonce
    });
  }
  
  /**
   * Serialize to JSON
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      peerId: this.peerId,
      peerKey: this.peerKey,
      trustLevel: this.trustLevel,
      metadata: this.metadata,
      timestamp: this.timestamp,
      expiresAt: this.expiresAt,
      sequence: this.sequence,
      prevHash: this.prevHash,
      signature: this.signature,
      signerId: this.signerId,
      signerKey: this.signerKey
    };
  }
  
  /**
   * Create from JSON
   */
  static fromJSON(data) {
    const update = new TrustUpdate({
      id: data.id,
      type: data.type,
      peerId: data.peerId,
      peerKey: data.peerKey,
      trustLevel: data.trustLevel,
      metadata: data.metadata,
      timestamp: data.timestamp,
      expiresAt: data.expiresAt,
      sequence: data.sequence,
      prevHash: data.prevHash,
      nonce: data.nonce
    });
    
    update.signature = data.signature;
    update.signerId = data.signerId;
    update.signerKey = data.signerKey;
    
    return update;
  }
}

// ============================================================================
// TRUST SYNC PROTOCOL
// ============================================================================

export class TrustSyncProtocol {
  constructor(options = {}) {
    this.eventBus = getEventBus();
    this.identity = options.identity || null;
    this.localTrust = options.localTrust || { peers: [] };
    
    // Protocol settings
    this.options = {
      maxUpdatesPerSync: options.maxUpdatesPerSync || 100,
      syncInterval: options.syncInterval || 60000,
      updateTTL: options.updateTTL || 86400000, // 24 hours
      requireSignature: options.requireSignature !== false,
      maxUpdateSize: options.maxUpdateSize || 1024 * 1024, // 1MB
      ...options
    };
    
    // Update storage with full data
    this.updateStore = new Map(); // id -> TrustUpdate
    this.updateLog = []; // ordered list of update IDs
    
    // Sequence tracking for replay protection
    this.localSequence = 0;
    this.remoteSequences = new Map(); // nodeId -> lastSeenSequence
    
    // Hash chain
    this.lastHash = null;
    
    // Pending updates (not yet acknowledged)
    this.pendingUpdates = new Map();
    
    // Sync state per peer
    this.syncState = new Map();
  }
  
  // ==========================================================================
  // UPDATE CREATION
  // ==========================================================================
  
  /**
   * Create a peer add update
   */
  async createPeerAdd(peerId, peerKey, trustLevel = TrustLevel.MEDIUM, metadata = {}) {
    // Validate peer ID
    if (!peerId || typeof peerId !== 'string' || peerId.length > 256) {
      throw new Error('Invalid peer ID');
    }
    
    // Validate public key
    if (peerKey) {
      try {
        const keyBytes = Buffer.from(peerKey, 'base64');
        if (keyBytes.length !== 32) {
          throw new Error('Public key must be 32 bytes (Ed25519)');
        }
      } catch {
        throw new Error('Invalid base64 encoding for public key');
      }
    }
    
    const update = new TrustUpdate({
      type: TrustUpdateType.PEER_ADD,
      peerId,
      peerKey,
      trustLevel,
      sequence: ++this.localSequence,
      prevHash: this.lastHash,
      metadata: {
        ...metadata,
        addedBy: this.identity?.getNodeId(),
        addedAt: new Date().toISOString()
      }
    });
    
    if (this.identity) {
      await update.sign(this.identity);
    }
    
    // Update hash chain
    this.lastHash = update.calculateHash();
    
    this._storeUpdate(update);
    this.eventBus.emit(EventTypes.TRUST_PEER_ADDED, { peerId, peerKey, trustLevel });
    
    return update;
  }
  
  /**
   * Create a peer remove update
   */
  async createPeerRemove(peerId, reason = '') {
    const update = new TrustUpdate({
      type: TrustUpdateType.PEER_REMOVE,
      peerId,
      sequence: ++this.localSequence,
      prevHash: this.lastHash,
      metadata: {
        reason,
        removedBy: this.identity?.getNodeId(),
        removedAt: new Date().toISOString()
      }
    });
    
    if (this.identity) {
      await update.sign(this.identity);
    }
    
    this.lastHash = update.calculateHash();
    
    this._storeUpdate(update);
    this.eventBus.emit(EventTypes.TRUST_PEER_REMOVED, { peerId, reason });
    
    return update;
  }
  
  /**
   * Create a trust level update
   */
  async createTrustLevelUpdate(peerId, trustLevel, reason = '') {
    const update = new TrustUpdate({
      type: TrustUpdateType.TRUST_LEVEL,
      peerId,
      trustLevel,
      sequence: ++this.localSequence,
      prevHash: this.lastHash,
      metadata: {
        reason,
        updatedBy: this.identity?.getNodeId(),
        updatedAt: new Date().toISOString()
      }
    });
    
    if (this.identity) {
      await update.sign(this.identity);
    }
    
    this.lastHash = update.calculateHash();
    
    this._storeUpdate(update);
    this.eventBus.emit(EventTypes.TRUST_PEER_UPDATED, { peerId, trustLevel });
    
    return update;
  }
  
  // ==========================================================================
  // SYNC PROTOCOL
  // ==========================================================================
  
  /**
   * Create sync request message
   */
  createSyncRequest(lastSyncTime = null) {
    return {
      type: 'trust:sync:request',
      from: this.identity?.getNodeId(),
      lastSyncTime: lastSyncTime || this._getLastSyncTime(),
      lastSequence: this.localSequence,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Process incoming sync request
   */
  async processSyncRequest(request) {
    // Get updates since last sync
    const updates = this._getUpdatesSince(request.lastSyncTime, request.lastSequence);
    
    return {
      type: 'trust:sync:response',
      from: this.identity?.getNodeId(),
      to: request.from,
      updates: updates.slice(0, this.options.maxUpdatesPerSync),
      lastSequence: this.localSequence,
      timestamp: new Date().toISOString(),
      more: updates.length > this.options.maxUpdatesPerSync
    };
  }
  
  /**
   * Process incoming sync response
   */
  async processSyncResponse(response) {
    const results = {
      applied: 0,
      rejected: 0,
      duplicates: 0,
      errors: []
    };
    
    for (const updateData of response.updates) {
      // Check size
      const jsonStr = JSON.stringify(updateData);
      if (jsonStr.length > this.options.maxUpdateSize) {
        results.rejected++;
        results.errors.push({
          updateId: updateData.id,
          reason: 'Update too large'
        });
        continue;
      }
      
      const update = TrustUpdate.fromJSON(updateData);
      
      try {
        const validation = await this.validateUpdate(update);
        
        if (validation.duplicate) {
          results.duplicates++;
          continue;
        }
        
        if (validation.valid) {
          await this.applyUpdate(update);
          results.applied++;
        } else {
          results.rejected++;
          results.errors.push({
            updateId: update.id,
            reason: validation.reason
          });
        }
      } catch (error) {
        results.rejected++;
        results.errors.push({
          updateId: update.id,
          reason: error.message
        });
      }
    }
    
    // Update remote sequence tracking
    if (response.lastSequence) {
      this.remoteSequences.set(response.from, response.lastSequence);
    }
    
    this.eventBus.emit(EventTypes.TRUST_SYNC, {
      from: response.from,
      applied: results.applied,
      rejected: results.rejected,
      duplicates: results.duplicates
    });
    
    return results;
  }
  
  /**
   * Broadcast update to peers
   */
  async broadcastUpdate(update, peers) {
    const message = {
      type: 'trust:update',
      from: this.identity?.getNodeId(),
      update: update.toJSON(),
      sequence: this.localSequence,
      timestamp: new Date().toISOString()
    };
    
    // In a real implementation, this would send to connected peers
    // For now, we emit an event that can be handled by the transport layer
    this.eventBus.emit('trust:broadcast', { message, peers });
    
    return message;
  }
  
  // ==========================================================================
  // VALIDATION
  // ==========================================================================
  
  /**
   * Validate a trust update
   */
  async validateUpdate(update) {
    // Check expiration
    if (update.isExpired()) {
      return { valid: false, reason: 'Update expired' };
    }
    
    // Check signature if required
    if (this.options.requireSignature && !update.signature) {
      return { valid: false, reason: 'Missing signature' };
    }
    
    // Verify signature
    if (update.signature) {
      const verify = await update.verify();
      if (!verify.valid) {
        return { valid: false, reason: `Invalid signature: ${verify.error}` };
      }
    }
    
    // Check if signer is trusted
    if (update.signerId && !this._isTrustedSigner(update.signerId)) {
      return { valid: false, reason: 'Signer not trusted' };
    }
    
    // CRITICAL: Replay protection
    if (this._isDuplicate(update)) {
      return { valid: false, duplicate: true, reason: 'Duplicate update' };
    }
    
    // Check sequence number (if provided)
    if (update.sequence !== undefined && update.sequence !== 0) {
      const lastSeq = this.remoteSequences.get(update.signerId) || 0;
      if (update.sequence <= lastSeq) {
        return { valid: false, duplicate: true, reason: 'Old sequence number' };
      }
    }
    
    // Check for conflicts
    const conflict = this._checkConflict(update);
    if (conflict) {
      return { valid: false, reason: `Conflict with existing update: ${conflict}` };
    }
    
    return { valid: true };
  }
  
  /**
   * Check if update is a duplicate
   */
  _isDuplicate(update) {
    // Check by ID
    if (this.updateStore.has(update.id)) {
      return true;
    }
    
    // Check by sequence if available
    if (update.sequence !== undefined && update.signerId) {
      const lastSeq = this.remoteSequences.get(update.signerId);
      if (lastSeq !== undefined && update.sequence <= lastSeq) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Apply an update to local trust store
   */
  async applyUpdate(update) {
    switch (update.type) {
      case TrustUpdateType.PEER_ADD:
        await this._applyPeerAdd(update);
        break;
        
      case TrustUpdateType.PEER_REMOVE:
        await this._applyPeerRemove(update);
        break;
        
      case TrustUpdateType.TRUST_LEVEL:
        await this._applyTrustLevel(update);
        break;
        
      case TrustUpdateType.DELEGATION:
        await this._applyDelegation(update);
        break;
        
      case TrustUpdateType.REVOCATION:
        await this._applyRevocation(update);
        break;
        
      default:
        throw new Error(`Unknown update type: ${update.type}`);
    }
    
    this._storeUpdate(update);
    
    // Update sequence tracking
    if (update.sequence !== undefined && update.signerId) {
      const lastSeq = this.remoteSequences.get(update.signerId) || 0;
      if (update.sequence > lastSeq) {
        this.remoteSequences.set(update.signerId, update.sequence);
      }
    }
  }
  
  // ==========================================================================
  // UPDATE APPLICATION
  // ==========================================================================
  
  async _applyPeerAdd(update) {
    if (!this.localTrust.peers) {
      this.localTrust.peers = [];
    }
    
    // Check for existing
    const existing = this.localTrust.peers.find(p => p.id === update.peerId);
    if (existing) {
      throw new Error(`Peer already exists: ${update.peerId}`);
    }
    
    this.localTrust.peers.push({
      id: update.peerId,
      pubkey: update.peerKey,
      trustLevel: update.trustLevel,
      addedAt: update.timestamp,
      addedBy: update.signerId,
      metadata: update.metadata
    });
  }
  
  async _applyPeerRemove(update) {
    if (!this.localTrust.peers) return;
    
    const index = this.localTrust.peers.findIndex(p => p.id === update.peerId);
    if (index !== -1) {
      this.localTrust.peers.splice(index, 1);
    }
  }
  
  async _applyTrustLevel(update) {
    if (!this.localTrust.peers) return;
    
    const peer = this.localTrust.peers.find(p => p.id === update.peerId);
    if (peer) {
      peer.trustLevel = update.trustLevel;
      peer.updatedAt = update.timestamp;
      peer.updatedBy = update.signerId;
    }
  }
  
  async _applyDelegation(update) {
    // Delegation allows a peer to make trust decisions on behalf of the delegator
    if (!this.localTrust.delegations) {
      this.localTrust.delegations = [];
    }
    
    this.localTrust.delegations.push({
      from: update.signerId,
      to: update.peerId,
      level: update.trustLevel,
      createdAt: update.timestamp,
      expiresAt: update.expiresAt
    });
  }
  
  async _applyRevocation(update) {
    // Revoke a previous update or delegation
    if (update.metadata.revokes) {
      // Remove from store
      this.updateStore.delete(update.metadata.revokes);
      this.updateLog = this.updateLog.filter(id => id !== update.metadata.revokes);
      
      // Revoke delegation if applicable
      if (this.localTrust.delegations) {
        this.localTrust.delegations = this.localTrust.delegations.filter(
          d => d.to !== update.peerId
        );
      }
    }
  }
  
  // ==========================================================================
  // UPDATE STORAGE
  // ==========================================================================
  
  /**
   * Store update with full data
   */
  _storeUpdate(update) {
    // Store full update
    this.updateStore.set(update.id, update);
    
    // Add to ordered log
    this.updateLog.push(update.id);
    
    // Trim log
    while (this.updateLog.length > this.options.maxUpdatesPerSync * 2) {
      const oldestId = this.updateLog.shift();
      this.updateStore.delete(oldestId);
    }
  }
  
  /**
   * Get updates since timestamp/sequence (returns full data)
   */
  _getUpdatesSince(timestamp, sequence) {
    let updates = [];
    
    for (const id of this.updateLog) {
      const update = this.updateStore.get(id);
      if (!update) continue;
      
      let include = true;
      
      // Filter by timestamp
      if (timestamp) {
        const since = new Date(timestamp);
        if (new Date(update.timestamp) <= since) {
          include = false;
        }
      }
      
      // Filter by sequence
      if (sequence !== undefined && update.sequence !== undefined) {
        if (update.sequence <= sequence) {
          include = false;
        }
      }
      
      if (include) {
        updates.push(update.toJSON());
      }
    }
    
    return updates;
  }
  
  _getLastSyncTime() {
    if (this.updateLog.length === 0) return null;
    
    const lastId = this.updateLog[this.updateLog.length - 1];
    const update = this.updateStore.get(lastId);
    return update?.timestamp || null;
  }
  
  _isTrustedSigner(signerId) {
    // Check if signer is in trust store
    if (this.localTrust.peers) {
      const peer = this.localTrust.peers.find(p => p.id === signerId);
      if (peer && peer.trustLevel >= TrustLevel.MEDIUM) {
        return true;
      }
    }
    
    // Self-signed is always trusted
    if (this.identity && this.identity.getNodeId() === signerId) {
      return true;
    }
    
    return false;
  }
  
  _checkConflict(update) {
    // Check for conflicting updates in recent log
    const recent = [];
    for (const id of this.updateLog.slice(-100)) {
      const u = this.updateStore.get(id);
      if (u && u.peerId === update.peerId && u.type === update.type && u.id !== update.id) {
        recent.push(u);
      }
    }
    
    if (recent.length > 0) {
      // Check timestamps - newer wins
      const newer = recent.find(u => 
        new Date(u.timestamp) > new Date(update.timestamp)
      );
      
      if (newer) {
        return newer.id;
      }
    }
    
    return null;
  }
  
  // ==========================================================================
  // STATUS
  // ==========================================================================
  
  /**
   * Get sync status
   */
  getSyncStatus() {
    return {
      updateCount: this.updateLog.length,
      storedUpdates: this.updateStore.size,
      lastUpdate: this._getLastSyncTime(),
      pendingCount: this.pendingUpdates.size,
      peers: this.localTrust.peers?.length || 0,
      localSequence: this.localSequence,
      remoteSequences: Object.fromEntries(this.remoteSequences)
    };
  }
  
  /**
   * Export trust state
   */
  exportTrust() {
    return {
      peers: this.localTrust.peers || [],
      delegations: this.localTrust.delegations || [],
      updateLog: this.updateLog.slice(-100),
      exportedAt: new Date().toISOString()
    };
  }
  
  /**
   * Import trust state
   */
  async importTrust(data) {
    if (data.peers) {
      this.localTrust.peers = data.peers;
    }
    
    if (data.delegations) {
      this.localTrust.delegations = data.delegations;
    }
    
    if (data.updateLog) {
      this.updateLog = data.updateLog;
    }
    
    this.eventBus.emit(EventTypes.TRUST_SYNC, {
      type: 'import',
      peers: this.localTrust.peers?.length || 0
    });
  }
}

// ============================================================================
// TRUST VALIDATOR
// ============================================================================

export class TrustValidator {
  constructor(options = {}) {
    this.protocol = options.protocol;
    this.minTrustLevel = options.minTrustLevel || TrustLevel.MEDIUM;
  }
  
  /**
   * Validate peer trust level
   */
  validatePeer(peerId) {
    const peers = this.protocol?.localTrust?.peers || [];
    const peer = peers.find(p => p.id === peerId);
    
    if (!peer) {
      return { trusted: false, reason: 'Peer not in trust store' };
    }
    
    if (peer.trustLevel < this.minTrustLevel) {
      return { 
        trusted: false, 
        reason: `Trust level too low: ${peer.trustLevel} < ${this.minTrustLevel}` 
      };
    }
    
    return { trusted: true, level: peer.trustLevel };
  }
  
  /**
   * Validate message from peer
   */
  async validateMessage(message, signature, peerId) {
    // First check peer trust
    const trustResult = this.validatePeer(peerId);
    if (!trustResult.trusted) {
      return trustResult;
    }
    
    // Then verify signature
    const peers = this.protocol?.localTrust?.peers || [];
    const peer = peers.find(p => p.id === peerId);
    
    if (!peer || !peer.pubkey) {
      return { trusted: false, reason: 'No public key for peer' };
    }
    
    const sign = await import('../crypto/sign.js');
    
    const valid = sign.verify(
      Buffer.from(message, 'utf8'),
      Buffer.from(signature, 'base64'),
      Buffer.from(peer.pubkey, 'base64')
    );
    
    if (!valid) {
      return { trusted: false, reason: 'Invalid signature' };
    }
    
    return { trusted: true, level: peer.trustLevel };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

let globalSync = null;

export function getTrustSync(options = {}) {
  if (!globalSync) {
    globalSync = new TrustSyncProtocol(options);
  }
  return globalSync;
}

export function createTrustSync(options = {}) {
  return new TrustSyncProtocol(options);
}
