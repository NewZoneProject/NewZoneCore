// Module: Routing Table
// Description: Kademlia routing table implementation.
// File: network/dht/routing-table.js

import { EventEmitter } from 'events';
import { NodeID } from './node-id.js';
import { KBucketList, KBucketEvents, Contact, K } from './kbuckets.js';

/**
 * Routing Table Events
 */
export const RoutingTableEvents = {
  NODE_ADDED: 'node_added',
  NODE_REMOVED: 'node_removed',
  NODE_UPDATED: 'node_updated',
  BUCKET_REFRESH: 'bucket_refresh',
  PING_REQUIRED: 'ping_required'
};

/**
 * Routing Table Options
 */
const DEFAULT_OPTIONS = {
  k: K,
  refreshInterval: 3600000, // 1 hour
  staleTimeout: 900000, // 15 minutes
  maxPendingPings: 3
};

/**
 * RoutingTable class - manages the Kademlia routing table
 */
export class RoutingTable extends EventEmitter {
  constructor(localNodeId, options = {}) {
    super();
    
    this.localNodeId = localNodeId instanceof NodeID ? localNodeId : new NodeID(localNodeId);
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // K-buckets
    this._buckets = new KBucketList({
      localNodeId: this.localNodeId,
      k: this.options.k
    });
    
    // Pending pings (nodes to verify before removal)
    this._pendingPings = new Map();
    
    // Refresh tracking
    this._lastRefresh = new Map();
    
    // Setup event forwarding
    this._setupBucketEvents();
  }

  /**
   * Get total number of nodes in routing table
   */
  get size() {
    return this._buckets.size;
  }

  /**
   * Get local node ID
   */
  get nodeId() {
    return this.localNodeId;
  }

  /**
   * Setup bucket event handlers
   */
  _setupBucketEvents() {
    this._buckets.on(KBucketEvents.PING, async ({ contact, bucket }) => {
      this.emit(RoutingTableEvents.PING_REQUIRED, {
        contact,
        reason: 'stale_check'
      });
    });
  }

  /**
   * Add a node to the routing table
   */
  addNode(nodeInfo) {
    const contact = nodeInfo instanceof Contact ? nodeInfo : new Contact(nodeInfo);
    
    // Don't add ourselves
    if (contact.id.equals(this.localNodeId)) {
      return { added: false, reason: 'self' };
    }
    
    const result = this._buckets.add(contact);
    
    if (result.added) {
      this.emit(RoutingTableEvents.NODE_ADDED, { contact });
    } else if (result.updated) {
      this.emit(RoutingTableEvents.NODE_UPDATED, { contact });
    }
    
    return result;
  }

  /**
   * Remove a node from the routing table
   */
  removeNode(nodeId) {
    const result = this._buckets.remove(nodeId);
    
    if (result) {
      this.emit(RoutingTableEvents.NODE_REMOVED, { nodeId });
    }
    
    return result;
  }

  /**
   * Get a node by ID
   */
  getNode(nodeId) {
    return this._buckets.get(nodeId);
  }

  /**
   * Check if a node exists in the routing table
   */
  hasNode(nodeId) {
    return this._buckets.has(nodeId);
  }

  /**
   * Get the K closest nodes to a target
   */
  getClosestNodes(targetId, count = this.options.k) {
    return this._buckets.getClosest(targetId, count);
  }

  /**
   * Get all nodes in the routing table
   */
  getAllNodes() {
    return this._buckets.getAllContacts();
  }

  /**
   * Update the last seen time for a node
   */
  touchNode(nodeId) {
    const contact = this._buckets.get(nodeId);
    if (contact) {
      contact.touch();
      this.emit(RoutingTableEvents.NODE_UPDATED, { contact });
      return true;
    }
    return false;
  }

  /**
   * Handle a successful ping response
   */
  handlePong(nodeId) {
    // Remove from pending pings
    this._pendingPings.delete(nodeId.hex);
    
    // Update last seen
    this.touchNode(nodeId);
  }

  /**
   * Handle a failed ping (timeout)
   */
  handlePingTimeout(nodeId) {
    const hex = nodeId.hex;
    const pending = this._pendingPings.get(hex) || 0;
    
    if (pending >= this.options.maxPendingPings - 1) {
      // Remove the node
      this.removeNode(nodeId);
      this._pendingPings.delete(hex);
    } else {
      this._pendingPings.set(hex, pending + 1);
    }
  }

  /**
   * Get nodes that need to be refreshed
   */
  getStaleBuckets() {
    const now = Date.now();
    const stale = [];
    
    for (const bucket of this._buckets.getNonEmptyBuckets()) {
      const lastRefresh = this._lastRefresh.get(bucket.index) || 0;
      
      if (now - lastRefresh > this.options.refreshInterval) {
        stale.push(bucket);
      }
    }
    
    return stale;
  }

  /**
   * Mark a bucket as refreshed
   */
  markBucketRefreshed(bucketIndex) {
    this._lastRefresh.set(bucketIndex, Date.now());
  }

  /**
   * Find a node that can be used to refresh a bucket
   */
  getNodeForRefresh(bucketIndex) {
    // Generate a random ID in the bucket's range
    const randomId = this._generateIdForBucket(bucketIndex);
    
    // Find closest node to this random ID
    const closest = this.getClosestNodes(randomId, 1);
    
    return closest.length > 0 ? closest[0] : null;
  }

  /**
   * Generate a random ID that falls within a specific bucket's range
   */
  _generateIdForBucket(bucketIndex) {
    const localBytes = this.localNodeId.buffer;
    const randomBytes = Buffer.alloc(32);
    
    // Copy prefix from local ID up to the bucket index
    const bytesToCopy = Math.floor(bucketIndex / 8);
    localBytes.copy(randomBytes, 0, 0, bytesToCopy);
    
    // Set the differing bit
    const bitPosition = bucketIndex % 8;
    const differingBit = 1 - ((localBytes[bytesToCopy] >> (7 - bitPosition)) & 1);
    randomBytes[bytesToCopy] = (localBytes[bytesToCopy] & (0xFF << (8 - bitPosition))) | 
                               (differingBit << (7 - bitPosition));
    
    // Fill the rest with random bytes
    for (let i = bytesToCopy + 1; i < 32; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
    
    return new NodeID(randomBytes);
  }

  /**
   * Get routing table statistics
   */
  getStats() {
    const bucketStats = this._buckets.getStats();
    
    return {
      localNodeId: this.localNodeId.hex,
      totalNodes: this.size,
      nonEmptyBuckets: bucketStats.nonEmptyBuckets,
      pendingPings: this._pendingPings.size,
      buckets: bucketStats.buckets
    };
  }

  /**
   * Clear the routing table
   */
  clear() {
    this._buckets.clear();
    this._pendingPings.clear();
    this._lastRefresh.clear();
  }

  /**
   * Serialize routing table to JSON
   */
  toJSON() {
    return {
      localNodeId: this.localNodeId.hex,
      nodes: this.getAllNodes().map(n => n.toJSON())
    };
  }

  /**
   * Load routing table from JSON
   */
  static fromJSON(data, options = {}) {
    const localNodeId = new NodeID(data.localNodeId);
    const table = new RoutingTable(localNodeId, options);
    
    if (data.nodes) {
      for (const nodeData of data.nodes) {
        try {
          table.addNode(Contact.fromJSON(nodeData));
        } catch (e) {
          // Skip invalid nodes
        }
      }
    }
    
    return table;
  }
}

export default RoutingTable;
