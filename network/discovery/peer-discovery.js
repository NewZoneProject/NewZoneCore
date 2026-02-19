// Module: Peer Discovery
// Description: Peer discovery through DHT and other mechanisms.
// File: network/discovery/peer-discovery.js

import { EventEmitter } from 'events';
import { NodeID } from '../dht/node-id.js';

/**
 * Peer Discovery Events
 */
export const PeerDiscoveryEvents = {
  PEER_FOUND: 'peer_found',
  PEER_LOST: 'peer_lost',
  DISCOVERY_STARTED: 'discovery_started',
  DISCOVERY_COMPLETE: 'discovery_complete',
  ERROR: 'error'
};

/**
 * Peer Info structure
 */
export class PeerInfo {
  constructor(options) {
    this.id = options.id instanceof NodeID ? options.id : new NodeID(options.id);
    this.address = options.address;
    this.port = options.port;
    this.services = options.services || [];
    this.metadata = options.metadata || {};
    this.lastSeen = options.lastSeen || Date.now();
    this.source = options.source || 'unknown'; // dht, mdns, bootstrap, manual
    this.latency = options.latency || null;
    this.isVerified = options.isVerified || false;
  }

  /**
   * Update last seen timestamp
   */
  touch() {
    this.lastSeen = Date.now();
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      id: this.id.hex,
      address: this.address,
      port: this.port,
      services: this.services,
      metadata: this.metadata,
      lastSeen: this.lastSeen,
      source: this.source,
      latency: this.latency,
      isVerified: this.isVerified
    };
  }

  /**
   * Create from JSON
   */
  static fromJSON(data) {
    return new PeerInfo({
      id: NodeID.fromJSON(data.id),
      address: data.address,
      port: data.port,
      services: data.services,
      metadata: data.metadata,
      lastSeen: data.lastSeen,
      source: data.source,
      latency: data.latency,
      isVerified: data.isVerified
    });
  }
}

/**
 * Peer Discovery Options
 */
const DEFAULT_OPTIONS = {
  maxPeers: 1000,
  discoveryInterval: 60000,     // Run discovery every minute
  peerTimeout: 300000,          // Consider peer lost after 5 min
  maxConcurrentLookups: 3,
  targetCount: 20               // Target number of peers to discover
};

/**
 * PeerDiscovery class - discovers and manages peers
 */
export class PeerDiscovery extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Known peers
    this._peers = new Map(); // id -> PeerInfo
    
    // DHT reference
    this._dht = options.dht || null;
    
    // Discovery state
    this._isDiscovering = false;
    this._discoveryTimer = null;
    this._started = false;
  }

  /**
   * Get number of known peers
   */
  get peerCount() {
    return this._peers.size;
  }

  /**
   * Get all peers
   */
  get peers() {
    return Array.from(this._peers.values());
  }

  /**
   * Set DHT reference
   */
  setDHT(dht) {
    this._dht = dht;
  }

  /**
   * Start peer discovery
   */
  start() {
    if (this._started) return;
    
    this._started = true;
    
    // Start periodic discovery
    this._discoveryTimer = setInterval(() => {
      this.discover();
    }, this.options.discoveryInterval);
    
    // Run initial discovery
    this.discover();
  }

  /**
   * Stop peer discovery
   */
  stop() {
    this._started = false;
    
    if (this._discoveryTimer) {
      clearInterval(this._discoveryTimer);
      this._discoveryTimer = null;
    }
  }

  /**
   * Run peer discovery
   */
  async discover() {
    if (this._isDiscovering) return;
    
    this._isDiscovering = true;
    this.emit(PeerDiscoveryEvents.DISCOVERY_STARTED);
    
    try {
      // Discover via DHT
      if (this._dht) {
        await this._discoverViaDHT();
      }
      
      // Clean up stale peers
      this._cleanupStalePeers();
      
      this.emit(PeerDiscoveryEvents.DISCOVERY_COMPLETE, {
        peerCount: this._peers.size
      });
    } catch (err) {
      this.emit(PeerDiscoveryEvents.ERROR, { error: err.message });
    } finally {
      this._isDiscovering = false;
    }
  }

  /**
   * Discover peers via DHT
   */
  async _discoverViaDHT() {
    if (!this._dht) return;
    
    // Find nodes close to our own ID
    const localId = this._dht.nodeId;
    const closest = await this._dht.findNode(localId);
    
    for (const contact of closest) {
      this.addPeer(new PeerInfo({
        id: contact.id,
        address: contact.address,
        port: contact.port,
        source: 'dht'
      }));
    }
    
    // Also find nodes close to random IDs for diversification
    for (let i = 0; i < this.options.maxConcurrentLookups; i++) {
      const randomId = NodeID.random();
      const nodes = await this._dht.findNode(randomId);
      
      for (const contact of nodes) {
        this.addPeer(new PeerInfo({
          id: contact.id,
          address: contact.address,
          port: contact.port,
          source: 'dht'
        }));
      }
    }
  }

  /**
   * Add a peer
   */
  addPeer(peerInfo) {
    if (!(peerInfo instanceof PeerInfo)) {
      peerInfo = new PeerInfo(peerInfo);
    }
    
    // Don't add if we're at capacity and this is a new peer
    if (this._peers.size >= this.options.maxPeers && !this._peers.has(peerInfo.id.hex)) {
      return false;
    }
    
    const existing = this._peers.get(peerInfo.id.hex);
    
    if (existing) {
      // Update existing peer
      existing.touch();
      existing.address = peerInfo.address;
      existing.port = peerInfo.port;
      existing.services = peerInfo.services || existing.services;
      existing.metadata = { ...existing.metadata, ...peerInfo.metadata };
    } else {
      // Add new peer
      this._peers.set(peerInfo.id.hex, peerInfo);
      
      this.emit(PeerDiscoveryEvents.PEER_FOUND, {
        peer: peerInfo,
        totalPeers: this._peers.size
      });
    }
    
    return true;
  }

  /**
   * Remove a peer
   */
  removePeer(peerId) {
    const id = peerId instanceof NodeID ? peerId.hex : peerId;
    const peer = this._peers.get(id);
    
    if (peer) {
      this._peers.delete(id);
      
      this.emit(PeerDiscoveryEvents.PEER_LOST, {
        peerId: id,
        reason: 'removed',
        totalPeers: this._peers.size
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * Get a peer by ID
   */
  getPeer(peerId) {
    const id = peerId instanceof NodeID ? peerId.hex : peerId;
    return this._peers.get(id);
  }

  /**
   * Check if peer exists
   */
  hasPeer(peerId) {
    const id = peerId instanceof NodeID ? peerId.hex : peerId;
    return this._peers.has(id);
  }

  /**
   * Get peers by service
   */
  getPeersByService(service) {
    return this.peers.filter(p => p.services.includes(service));
  }

  /**
   * Get random peers
   */
  getRandomPeers(count) {
    const peers = this.peers;
    const result = [];
    const used = new Set();
    
    while (result.length < count && result.length < peers.length) {
      const index = Math.floor(Math.random() * peers.length);
      if (!used.has(index)) {
        used.add(index);
        result.push(peers[index]);
      }
    }
    
    return result;
  }

  /**
   * Get closest peers to a target
   */
  getClosestPeers(targetId, count = this.options.targetCount) {
    const target = targetId instanceof NodeID ? targetId : new NodeID(targetId);
    
    const sorted = [...this.peers].sort((a, b) => {
      const distA = target.distance(a.id);
      const distB = target.distance(b.id);
      return distA.compare(distB);
    });
    
    return sorted.slice(0, count);
  }

  /**
   * Update peer latency
   */
  updateLatency(peerId, latency) {
    const peer = this.getPeer(peerId);
    if (peer) {
      peer.latency = latency;
      peer.touch();
    }
  }

  /**
   * Mark peer as verified
   */
  verifyPeer(peerId) {
    const peer = this.getPeer(peerId);
    if (peer) {
      peer.isVerified = true;
      peer.touch();
    }
  }

  /**
   * Cleanup stale peers
   */
  _cleanupStalePeers() {
    const now = Date.now();
    const staleThreshold = this.options.peerTimeout;
    
    for (const [id, peer] of this._peers) {
      if (now - peer.lastSeen > staleThreshold) {
        this._peers.delete(id);
        
        this.emit(PeerDiscoveryEvents.PEER_LOST, {
          peerId: id,
          reason: 'timeout',
          totalPeers: this._peers.size
        });
      }
    }
  }

  /**
   * Get discovery statistics
   */
  getStats() {
    const peers = this.peers;
    const bySource = {};
    const byService = {};
    
    for (const peer of peers) {
      bySource[peer.source] = (bySource[peer.source] || 0) + 1;
      
      for (const service of peer.services) {
        byService[service] = (byService[service] || 0) + 1;
      }
    }
    
    return {
      totalPeers: peers.length,
      maxPeers: this.options.maxPeers,
      isDiscovering: this._isDiscovering,
      bySource,
      byService,
      verifiedCount: peers.filter(p => p.isVerified).length
    };
  }

  /**
   * Export peers for persistence
   */
  exportPeers() {
    return this.peers.map(p => p.toJSON());
  }

  /**
   * Import peers from persistence
   */
  importPeers(peers) {
    for (const data of peers) {
      try {
        const peer = PeerInfo.fromJSON(data);
        this.addPeer(peer);
      } catch (e) {
        // Skip invalid peers
      }
    }
  }
}

export default PeerDiscovery;
