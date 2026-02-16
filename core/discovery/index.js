// Module: Node Discovery
// Description: Local network discovery, peer introduction protocol,
//              and QR-based identity exchange for NewZoneCore.
// File: core/discovery/index.js

import { EventTypes, getEventBus } from '../eventbus/index.js';
import { randomBytes } from 'crypto';

// ============================================================================
// DISCOVERY CONSTANTS
// ============================================================================

export const DiscoveryMethod = {
  LOCAL: 'local',
  QR: 'qr',
  INTRODUCTION: 'introduction',
  DHT: 'dht',
  MANUAL: 'manual'
};

export const DiscoveryState = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  ADVERTISING: 'advertising',
  CONNECTING: 'connecting',
  ERROR: 'error'
};

// ============================================================================
// PEER INFO
// ============================================================================

export class PeerInfo {
  constructor(options = {}) {
    this.nodeId = options.nodeId;
    this.publicKey = options.publicKey;
    this.ecdhKey = options.ecdhKey;
    this.addresses = options.addresses || [];
    this.port = options.port || 7468;
    this.name = options.name || '';
    this.version = options.version || '1.0.0';
    this.capabilities = options.capabilities || [];
    this.metadata = options.metadata || {};
    this.discoveredAt = new Date().toISOString();
    this.discoveredBy = options.discoveredBy || DiscoveryMethod.MANUAL;
    this.lastSeen = null;
  }

  /**
   * Update last seen timestamp
   */
  touch() {
    this.lastSeen = new Date().toISOString();
  }

  /**
   * Get primary address
   */
  getPrimaryAddress() {
    return this.addresses[0] || null;
  }

  /**
   * Export for sharing
   */
  export() {
    return {
      nodeId: this.nodeId,
      publicKey: this.publicKey,
      ecdhKey: this.ecdhKey,
      addresses: this.addresses,
      port: this.port,
      name: this.name,
      version: this.version,
      capabilities: this.capabilities,
      metadata: this.metadata
    };
  }

  /**
   * Create from exported data
   */
  static fromExported(data, method = DiscoveryMethod.MANUAL) {
    return new PeerInfo({
      ...data,
      discoveredBy: method
    });
  }

  /**
   * Encode for QR code
   */
  encodeForQR() {
    const data = this.export();
    // Compact encoding for QR
    const compact = {
      v: 1, // version
      id: this.nodeId,
      pk: this.publicKey,
      ek: this.ecdhKey,
      a: this.addresses[0] || '',
      p: this.port
    };
    return JSON.stringify(compact);
  }

  /**
   * Decode from QR code data
   */
  static decodeFromQR(qrData) {
    try {
      const compact = JSON.parse(qrData);

      if (compact.v !== 1) {
        throw new Error(`Unsupported QR version: ${compact.v}`);
      }

      return new PeerInfo({
        nodeId: compact.id,
        publicKey: compact.pk,
        ecdhKey: compact.ek,
        addresses: compact.a ? [compact.a] : [],
        port: compact.p || 7468,
        discoveredBy: DiscoveryMethod.QR
      });
    } catch (error) {
      throw new Error(`Invalid QR data: ${error.message}`);
    }
  }
}

// ============================================================================
// DISCOVERY MESSAGE
// ============================================================================

export class DiscoveryMessage {
  constructor(options = {}) {
    this.type = options.type || 'announce';
    this.from = options.from;
    this.peerInfo = options.peerInfo;
    this.nonce = options.nonce || randomBytes(16).toString('hex');
    this.timestamp = new Date().toISOString();
    this.signature = null;
  }

  async sign(identity) {
    const payload = this._getSignPayload();
    const result = await identity.sign(payload);
    this.signature = result.signature;
    return this;
  }

  async verify(publicKey) {
    if (!this.signature) {
      return { valid: false, error: 'No signature' };
    }

    const payload = this._getSignPayload();
    const sign = await import('../crypto/sign.js');

    const valid = sign.verify(
      Buffer.from(payload, 'utf8'),
      Buffer.from(this.signature, 'base64'),
      Buffer.from(publicKey, 'base64')
    );

    return { valid };
  }

  _getSignPayload() {
    return JSON.stringify({
      type: this.type,
      from: this.from,
      peerInfo: this.peerInfo?.export(),
      nonce: this.nonce,
      timestamp: this.timestamp
    });
  }

  toJSON() {
    return {
      type: this.type,
      from: this.from,
      peerInfo: this.peerInfo?.export(),
      nonce: this.nonce,
      timestamp: this.timestamp,
      signature: this.signature
    };
  }

  static fromJSON(data) {
    const msg = new DiscoveryMessage({
      type: data.type,
      from: data.from,
      nonce: data.nonce
    });

    if (data.peerInfo) {
      msg.peerInfo = PeerInfo.fromExported(data.peerInfo);
    }

    msg.timestamp = data.timestamp;
    msg.signature = data.signature;

    return msg;
  }
}

// ============================================================================
// NODE DISCOVERY
// ============================================================================

export class NodeDiscovery {
  constructor(options = {}) {
    this.eventBus = getEventBus();
    this.identity = options.identity || null;
    this.nodeId = options.nodeId || options.identity?.getNodeId();

    // Peer cache
    this.peers = new Map();

    // Settings
    this.options = {
      broadcastPort: options.broadcastPort || 7468,
      broadcastInterval: options.broadcastInterval || 30000,
      peerTimeout: options.peerTimeout || 180000, // 3 minutes
      maxPeers: options.maxPeers || 100,
      enableLocal: options.enableLocal !== false,
      ...options
    };

    // State
    this.state = DiscoveryState.IDLE;
    this.broadcastTimer = null;
    this.cleanupTimer = null;

    // Pending introductions
    this.pendingIntroductions = new Map();
  }

  // ==========================================================================
  // LOCAL DISCOVERY
  // ==========================================================================

  /**
   * Start local network discovery
   */
  async startLocalDiscovery() {
    if (this.state === DiscoveryState.SCANNING) {
      return { success: true, message: 'Already scanning' };
    }

    this.state = DiscoveryState.SCANNING;

    // Start broadcast announcements
    this._startBroadcast();

    // Start cleanup timer
    this._startCleanup();

    this.eventBus.emit(EventTypes.SYSTEM_INFO, {
      component: 'discovery',
      action: 'started',
      method: DiscoveryMethod.LOCAL
    });

    return { success: true };
  }

  /**
   * Stop local discovery
   */
  async stopLocalDiscovery() {
    this._stopBroadcast();
    this._stopCleanup();
    this.state = DiscoveryState.IDLE;

    this.eventBus.emit(EventTypes.SYSTEM_INFO, {
      component: 'discovery',
      action: 'stopped'
    });

    return { success: true };
  }

  /**
   * Create announcement message
   */
  async createAnnouncement() {
    const message = new DiscoveryMessage({
      type: 'announce',
      from: this.nodeId,
      peerInfo: this._getLocalPeerInfo()
    });

    if (this.identity) {
      await message.sign(this.identity);
    }

    return message;
  }

  /**
   * Process incoming discovery message
   */
  async processDiscovery(messageData, remoteAddress) {
    const message = DiscoveryMessage.fromJSON(messageData);

    // Validate message
    if (message.from === this.nodeId) {
      return { action: 'self', nodeId: message.from };
    }

    // Verify signature if present
    if (message.signature && message.peerInfo?.publicKey) {
      const valid = await message.verify(message.peerInfo.publicKey);
      if (!valid.valid) {
        return { action: 'invalid', error: valid.error };
      }
    }

    switch (message.type) {
      case 'announce':
        return this._handleAnnounce(message, remoteAddress);

      case 'introduction':
        return this._handleIntroduction(message, remoteAddress);

      case 'introduction_response':
        return this._handleIntroductionResponse(message);

      case 'ping':
        return this._handlePing(message, remoteAddress);

      default:
        return { action: 'unknown', type: message.type };
    }
  }

  /**
   * Handle announce message
   */
  _handleAnnounce(message, remoteAddress) {
    const peerInfo = message.peerInfo;

    if (!peerInfo) {
      return { action: 'invalid', error: 'No peer info' };
    }

    // Add remote address if not present
    if (remoteAddress && !peerInfo.addresses.includes(remoteAddress)) {
      peerInfo.addresses.unshift(remoteAddress);
    }

    peerInfo.discoveredBy = DiscoveryMethod.LOCAL;
    peerInfo.touch();

    // Update or add peer
    this._addOrUpdatePeer(peerInfo);

    return {
      action: 'discovered',
      nodeId: peerInfo.nodeId,
      isNew: !this.peers.has(peerInfo.nodeId)
    };
  }

  /**
   * Handle introduction message
   */
  _handleIntroduction(message, remoteAddress) {
    const peerInfo = message.peerInfo;

    if (!peerInfo) {
      return { action: 'invalid', error: 'No peer info' };
    }

    // Add to pending
    this.pendingIntroductions.set(peerInfo.nodeId, {
      peerInfo,
      remoteAddress,
      timestamp: new Date().toISOString()
    });

    return {
      action: 'introduction_pending',
      nodeId: peerInfo.nodeId
    };
  }

  /**
   * Handle introduction response
   */
  _handleIntroductionResponse(message) {
    const pending = this.pendingIntroductions.get(message.from);

    if (!pending) {
      return { action: 'invalid', error: 'No pending introduction' };
    }

    // Accept introduction
    pending.peerInfo.discoveredBy = DiscoveryMethod.INTRODUCTION;
    this._addOrUpdatePeer(pending.peerInfo);
    this.pendingIntroductions.delete(message.from);

    return {
      action: 'introduced',
      nodeId: message.from
    };
  }

  /**
   * Handle ping message
   */
  async _handlePing(message, remoteAddress) {
    const peer = this.peers.get(message.from);

    if (peer) {
      peer.touch();
    }

    return {
      action: 'pong',
      nodeId: message.from
    };
  }

  // ==========================================================================
  // QR-BASED DISCOVERY
  // ==========================================================================

  /**
   * Generate QR code data for identity sharing
   */
  async generateQRData() {
    const peerInfo = this._getLocalPeerInfo();

    if (this.identity) {
      // Sign the QR data
      const payload = peerInfo.encodeForQR();
      const result = await this.identity.sign(payload);

      return {
        payload,
        signature: result.signature,
        publicKey: result.publicKey,
        timestamp: new Date().toISOString()
      };
    }

    return {
      payload: peerInfo.encodeForQR(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Process QR code scan result
   */
  async processQRScan(qrData) {
    try {
      // Try to parse full signed format first
      let peerInfo;
      let signature = null;

      if (typeof qrData === 'string') {
        // Simple format
        peerInfo = PeerInfo.decodeFromQR(qrData);
      } else {
        // Signed format
        peerInfo = PeerInfo.decodeFromQR(qrData.payload);
        signature = qrData.signature;
      }

      // Verify signature if present
      if (signature && peerInfo.publicKey) {
        const sign = await import('../crypto/sign.js');
        const valid = sign.verify(
          Buffer.from(qrData.payload || qrData, 'utf8'),
          Buffer.from(signature, 'base64'),
          Buffer.from(peerInfo.publicKey, 'base64')
        );

        if (!valid) {
          throw new Error('Invalid QR signature');
        }
      }

      // Add peer
      peerInfo.discoveredBy = DiscoveryMethod.QR;
      this._addOrUpdatePeer(peerInfo);

      this.eventBus.emit(EventTypes.SYSTEM_INFO, {
        component: 'discovery',
        action: 'qr_scanned',
        nodeId: peerInfo.nodeId
      });

      return {
        success: true,
        peerInfo,
        isNew: !this.peers.has(peerInfo.nodeId)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // ==========================================================================
  // PEER INTRODUCTION PROTOCOL
  // ==========================================================================

  /**
   * Request introduction to a peer through another peer
   */
  async requestIntroduction(throughPeerId, targetNodeId) {
    const peer = this.peers.get(throughPeerId);
    if (!peer) {
      throw new Error(`Peer not found: ${throughPeerId}`);
    }

    const message = new DiscoveryMessage({
      type: 'introduction_request',
      from: this.nodeId,
      peerInfo: {
        targetNodeId,
        introducerId: throughPeerId
      }
    });

    if (this.identity) {
      await message.sign(this.identity);
    }

    this.eventBus.emit(EventTypes.SYSTEM_INFO, {
      component: 'discovery',
      action: 'introduction_request',
      through: throughPeerId,
      target: targetNodeId
    });

    return message;
  }

  /**
   * Accept introduction from a peer
   */
  async acceptIntroduction(peerId) {
    const pending = this.pendingIntroductions.get(peerId);

    if (!pending) {
      throw new Error(`No pending introduction from: ${peerId}`);
    }

    const response = new DiscoveryMessage({
      type: 'introduction_response',
      from: this.nodeId,
      peerInfo: this._getLocalPeerInfo()
    });

    if (this.identity) {
      await response.sign(this.identity);
    }

    // Add peer to our list
    pending.peerInfo.discoveredBy = DiscoveryMethod.INTRODUCTION;
    this._addOrUpdatePeer(pending.peerInfo);
    this.pendingIntroductions.delete(peerId);

    return response;
  }

  // ==========================================================================
  // MANUAL PEER ADDITION
  // ==========================================================================

  /**
   * Manually add a peer
   */
  addPeerManually(peerData) {
    const peerInfo = PeerInfo.fromExported(peerData, DiscoveryMethod.MANUAL);
    this._addOrUpdatePeer(peerInfo);

    this.eventBus.emit(EventTypes.TRUST_PEER_ADDED, {
      peerId: peerInfo.nodeId,
      method: DiscoveryMethod.MANUAL
    });

    return peerInfo;
  }

  /**
   * Remove a peer
   */
  removePeer(nodeId) {
    const peer = this.peers.get(nodeId);
    if (peer) {
      this.peers.delete(nodeId);
      this.eventBus.emit(EventTypes.TRUST_PEER_REMOVED, { peerId: nodeId });
      return true;
    }
    return false;
  }

  // ==========================================================================
  // PEER MANAGEMENT
  // ==========================================================================

  /**
   * Get all discovered peers
   */
  getPeers() {
    const result = [];
    for (const peer of this.peers.values()) {
      result.push(peer.export());
    }
    return result;
  }

  /**
   * Get peer by ID
   */
  getPeer(nodeId) {
    return this.peers.get(nodeId) || null;
  }

  /**
   * Check if peer is known
   */
  hasPeer(nodeId) {
    return this.peers.has(nodeId);
  }

  /**
   * Add or update peer in cache
   */
  _addOrUpdatePeer(peerInfo) {
    const existing = this.peers.get(peerInfo.nodeId);

    if (existing) {
      // Update existing
      existing.addresses = peerInfo.addresses;
      existing.port = peerInfo.port;
      existing.lastSeen = new Date().toISOString();
      existing.metadata = { ...existing.metadata, ...peerInfo.metadata };
    } else {
      // Check max peers
      if (this.peers.size >= this.options.maxPeers) {
        // Remove oldest peer
        this._removeOldestPeer();
      }

      peerInfo.touch();
      this.peers.set(peerInfo.nodeId, peerInfo);

      this.eventBus.emit(EventTypes.SYSTEM_INFO, {
        component: 'discovery',
        action: 'peer_discovered',
        nodeId: peerInfo.nodeId,
        method: peerInfo.discoveredBy
      });
    }
  }

  /**
   * Remove oldest peer
   */
  _removeOldestPeer() {
    let oldest = null;
    let oldestTime = Date.now();

    for (const [nodeId, peer] of this.peers) {
      const time = peer.lastSeen ? new Date(peer.lastSeen).getTime() : 0;
      if (time < oldestTime) {
        oldestTime = time;
        oldest = nodeId;
      }
    }

    if (oldest) {
      this.peers.delete(oldest);
    }
  }

  /**
   * Get local peer info
   */
  _getLocalPeerInfo() {
    return new PeerInfo({
      nodeId: this.nodeId,
      publicKey: this.identity?.ed25519?.public || null,
      ecdhKey: this.identity?.x25519?.public || null,
      addresses: [], // Should be filled by transport layer
      port: this.options.broadcastPort,
      version: '1.0.0',
      capabilities: ['trust', 'routing', 'discovery']
    });
  }

  // ==========================================================================
  // BROADCAST
  // ==========================================================================

  _startBroadcast() {
    if (this.broadcastTimer) return;

    // Send initial announcement
    this._sendAnnouncement();

    // Schedule periodic announcements
    this.broadcastTimer = setInterval(() => {
      this._sendAnnouncement();
    }, this.options.broadcastInterval);
  }

  _stopBroadcast() {
    if (this.broadcastTimer) {
      clearInterval(this.broadcastTimer);
      this.broadcastTimer = null;
    }
  }

  async _sendAnnouncement() {
    try {
      const message = await this.createAnnouncement();
      // Emit event for transport layer to handle
      this.eventBus.emit('discovery:broadcast', message.toJSON());
    } catch (error) {
      this.eventBus.emit(EventTypes.SYSTEM_WARNING, {
        component: 'discovery',
        warning: 'Announcement failed',
        error: error.message
      });
    }
  }

  // ==========================================================================
  // CLEANUP
  // ==========================================================================

  _startCleanup() {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this._cleanupExpiredPeers();
    }, 60000); // Every minute
  }

  _stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  _cleanupExpiredPeers() {
    const now = Date.now();
    const timeout = this.options.peerTimeout;

    for (const [nodeId, peer] of this.peers) {
      const lastSeen = peer.lastSeen ? new Date(peer.lastSeen).getTime() : 0;

      if (now - lastSeen > timeout) {
        this.peers.delete(nodeId);

        this.eventBus.emit(EventTypes.SYSTEM_INFO, {
          component: 'discovery',
          action: 'peer_expired',
          nodeId
        });
      }
    }
  }

  // ==========================================================================
  // STATUS
  // ==========================================================================

  getStatus() {
    return {
      state: this.state,
      peerCount: this.peers.size,
      pendingIntroductions: this.pendingIntroductions.size,
      maxPeers: this.options.maxPeers,
      broadcastPort: this.options.broadcastPort,
      localDiscovery: this.options.enableLocal
    };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

let globalDiscovery = null;

export function getNodeDiscovery(options = {}) {
  if (!globalDiscovery) {
    globalDiscovery = new NodeDiscovery(options);
  }
  return globalDiscovery;
}

export function createNodeDiscovery(options = {}) {
  return new NodeDiscovery(options);
}
