// Module: Kademlia DHT
// Description: Main Kademlia DHT implementation.
// File: network/dht/kademlia.js

import { EventEmitter } from 'events';
import { NodeID } from './node-id.js';
import { RoutingTable, RoutingTableEvents } from './routing-table.js';
import { Contact, K } from './kbuckets.js';

/**
 * DHT Events
 */
export const DHTEvents = {
  READY: 'ready',
  NODE_FOUND: 'node_found',
  NODE_JOINED: 'node_joined',
  VALUE_STORED: 'value_stored',
  VALUE_FOUND: 'value_found',
  ERROR: 'error'
};

/**
 * Kademlia RPC Commands
 */
export const RPCCommand = {
  PING: 'ping',
  PONG: 'pong',
  FIND_NODE: 'find_node',
  FIND_VALUE: 'find_value',
  STORE: 'store'
};

/**
 * DHT Options
 */
const DEFAULT_OPTIONS = {
  k: K,
  alpha: 3, // Concurrency factor
  replication: 20, // Number of nodes to replicate data to
  timeout: 5000, // RPC timeout
  refreshInterval: 3600000, // Bucket refresh interval
  republishInterval: 86400000 // Data republish interval (24 hours)
};

/**
 * Kademlia DHT implementation
 */
export class KademliaDHT extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Generate local node ID
    this.localNodeId = options.nodeId || NodeID.random();
    
    // Routing table
    this._routingTable = new RoutingTable(this.localNodeId, {
      k: this.options.k
    });
    
    // Local key-value store
    this._storage = new Map();
    
    // RPC transport
    this._transport = options.transport || null;
    
    // State
    this._isReady = false;
    this._startedAt = null;
    
    // Pending RPC calls
    this._pendingCalls = new Map();
    
    // Setup event handlers
    this._setupEvents();
  }

  /**
   * Get node ID
   */
  get nodeId() {
    return this.localNodeId;
  }

  /**
   * Get routing table
   */
  get routingTable() {
    return this._routingTable;
  }

  /**
   * Get storage size
   */
  get storageSize() {
    return this._storage.size;
  }

  /**
   * Check if DHT is ready
   */
  get isReady() {
    return this._isReady;
  }

  /**
   * Setup event handlers
   */
  _setupEvents() {
    this._routingTable.on(RoutingTableEvents.PING_REQUIRED, async ({ contact, reason }) => {
      // Send ping to verify node is still alive
      try {
        await this.ping(contact);
        this._routingTable.handlePong(contact.id);
      } catch (e) {
        this._routingTable.handlePingTimeout(contact.id);
      }
    });
  }

  /**
   * Initialize the DHT with bootstrap nodes
   */
  async bootstrap(bootstrapNodes = []) {
    // Start routing table refresh
    this._startRefresh();
    
    // Add bootstrap nodes
    for (const node of bootstrapNodes) {
      try {
        await this.addNode(node);
      } catch (e) {
        // Ignore bootstrap errors
      }
    }
    
    // Perform lookup for ourselves to populate routing table
    if (bootstrapNodes.length > 0) {
      await this.findNode(this.localNodeId);
    }
    
    this._isReady = true;
    this._startedAt = Date.now();
    
    this.emit(DHTEvents.READY, {
      nodeId: this.localNodeId.hex,
      knownNodes: this._routingTable.size
    });
    
    return {
      nodeId: this.localNodeId.hex,
      knownNodes: this._routingTable.size
    };
  }

  /**
   * Add a node to the routing table
   */
  async addNode(nodeInfo) {
    return this._routingTable.addNode(nodeInfo);
  }

  /**
   * Send PING to a node
   */
  async ping(nodeInfo) {
    const rpcId = this._generateRpcId();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._pendingCalls.delete(rpcId);
        reject(new Error('PING timeout'));
      }, this.options.timeout);
      
      this._pendingCalls.set(rpcId, { resolve, reject, timeout });
      
      // Send PING via transport
      this._sendRPC(nodeInfo, RPCCommand.PING, {
        rpcId,
        nodeId: this.localNodeId.hex
      });
    });
  }

  /**
   * Find a node by ID (iterative lookup)
   */
  async findNode(targetId) {
    const target = targetId instanceof NodeID ? targetId : new NodeID(targetId);
    
    // Get initial closest nodes from routing table
    const closest = this._routingTable.getClosestNodes(target, this.options.alpha);
    
    if (closest.length === 0) {
      return [];
    }
    
    // Iterative lookup
    const seen = new Set([this.localNodeId.hex]);
    const results = new Map();
    
    // Add initial nodes to results
    for (const node of closest) {
      results.set(node.id.hex, node);
      seen.add(node.id.hex);
    }
    
    let activeQueries = this.options.alpha;
    const queried = new Set();
    
    while (activeQueries > 0) {
      // Get closest unqueried nodes
      const toQuery = [...results.values()]
        .filter(n => !queried.has(n.id.hex))
        .sort((a, b) => {
          const distA = target.distance(a.id);
          const distB = target.distance(b.id);
          return distA.compare(distB);
        })
        .slice(0, this.options.alpha);
      
      if (toQuery.length === 0) {
        break;
      }
      
      // Query nodes
      const queryPromises = toQuery.map(async (node) => {
        queried.add(node.id.hex);
        
        try {
          const found = await this._findNodeRPC(node, target);
          return { node, found, error: null };
        } catch (e) {
          return { node, found: [], error: e };
        }
      });
      
      const queryResults = await Promise.all(queryPromises);
      
      // Process results
      let added = 0;
      for (const { node, found, error } of queryResults) {
        if (error) {
          results.delete(node.id.hex);
          continue;
        }
        
        // Add found nodes
        for (const contact of found) {
          if (!seen.has(contact.id.hex)) {
            seen.add(contact.id.hex);
            results.set(contact.id.hex, contact);
            added++;
            
            // Try to add to routing table
            this._routingTable.addNode(contact);
          }
        }
      }
      
      // Check if we found the target
      if (results.has(target.hex)) {
        this.emit(DHTEvents.NODE_FOUND, { targetId: target.hex, found: true });
        break;
      }
      
      // If no new nodes added, we're done
      if (added === 0) {
        activeQueries--;
      }
    }
    
    // Return K closest nodes
    return [...results.values()]
      .sort((a, b) => {
        const distA = target.distance(a.id);
        const distB = target.distance(b.id);
        return distA.compare(distB);
      })
      .slice(0, this.options.k);
  }

  /**
   * Store a value in the DHT
   */
  async put(key, value) {
    const keyId = key instanceof NodeID ? key : NodeID.fromString(key);
    
    // Find K closest nodes to the key
    const closest = await this.findNode(keyId);
    
    if (closest.length === 0) {
      throw new Error('No nodes available for storage');
    }
    
    // Store on closest nodes
    const storePromises = closest.map(node => this._storeRPC(node, keyId, value));
    const results = await Promise.allSettled(storePromises);
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    this.emit(DHTEvents.VALUE_STORED, {
      key: keyId.hex,
      value,
      replicas: successful
    });
    
    return {
      key: keyId.hex,
      replicas: successful,
      total: closest.length
    };
  }

  /**
   * Get a value from the DHT
   */
  async get(key) {
    const keyId = key instanceof NodeID ? key : NodeID.fromString(key);
    
    // Check local storage first
    const local = this._storage.get(keyId.hex);
    if (local) {
      return { value: local.value, from: 'local' };
    }
    
    // Find nodes that might have the value
    const closest = await this.findNode(keyId);
    
    // Query each node
    for (const node of closest) {
      try {
        const result = await this._findValueRPC(node, keyId);
        if (result.value) {
          this.emit(DHTEvents.VALUE_FOUND, {
            key: keyId.hex,
            value: result.value,
            from: node.id.hex
          });
          return { value: result.value, from: node.id.hex };
        }
      } catch (e) {
        // Continue to next node
      }
    }
    
    return null;
  }

  /**
   * Handle incoming RPC message
   */
  handleRPC(message, from) {
    const { command, rpcId, data } = message;
    
    switch (command) {
      case RPCCommand.PING:
        this._handlePing(rpcId, data, from);
        break;
        
      case RPCCommand.PONG:
        this._handlePong(rpcId, data);
        break;
        
      case RPCCommand.FIND_NODE:
        this._handleFindNode(rpcId, data, from);
        break;
        
      case RPCCommand.FIND_VALUE:
        this._handleFindValue(rpcId, data, from);
        break;
        
      case RPCCommand.STORE:
        this._handleStore(rpcId, data, from);
        break;
    }
  }

  /**
   * Get DHT statistics
   */
  getStats() {
    return {
      nodeId: this.localNodeId.hex,
      isReady: this._isReady,
      startedAt: this._startedAt,
      knownNodes: this._routingTable.size,
      storedValues: this._storage.size,
      pendingCalls: this._pendingCalls.size,
      routingTable: this._routingTable.getStats()
    };
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Send RPC to a node
   */
  _sendRPC(nodeInfo, command, data) {
    if (this._transport && this._transport.send) {
      this._transport.send(nodeInfo.address, nodeInfo.port, {
        command,
        ...data
      });
    }
  }

  /**
   * Generate random RPC ID
   */
  _generateRpcId() {
    return Math.random().toString(36).substring(2, 10);
  }

  /**
   * Send FIND_NODE RPC
   */
  async _findNodeRPC(node, target) {
    return new Promise((resolve, reject) => {
      const rpcId = this._generateRpcId();
      
      const timeout = setTimeout(() => {
        this._pendingCalls.delete(rpcId);
        reject(new Error('FIND_NODE timeout'));
      }, this.options.timeout);
      
      this._pendingCalls.set(rpcId, {
        resolve: (data) => {
          resolve(data.nodes || []);
        },
        reject,
        timeout
      });
      
      this._sendRPC(node, RPCCommand.FIND_NODE, {
        rpcId,
        target: target.hex,
        nodeId: this.localNodeId.hex
      });
    });
  }

  /**
   * Send STORE RPC
   */
  async _storeRPC(node, key, value) {
    return new Promise((resolve, reject) => {
      const rpcId = this._generateRpcId();
      
      const timeout = setTimeout(() => {
        this._pendingCalls.delete(rpcId);
        reject(new Error('STORE timeout'));
      }, this.options.timeout);
      
      this._pendingCalls.set(rpcId, { resolve, reject, timeout });
      
      this._sendRPC(node, RPCCommand.STORE, {
        rpcId,
        key: key.hex,
        value,
        nodeId: this.localNodeId.hex
      });
    });
  }

  /**
   * Send FIND_VALUE RPC
   */
  async _findValueRPC(node, key) {
    return new Promise((resolve, reject) => {
      const rpcId = this._generateRpcId();
      
      const timeout = setTimeout(() => {
        this._pendingCalls.delete(rpcId);
        reject(new Error('FIND_VALUE timeout'));
      }, this.options.timeout);
      
      this._pendingCalls.set(rpcId, {
        resolve: (data) => {
          resolve(data);
        },
        reject,
        timeout
      });
      
      this._sendRPC(node, RPCCommand.FIND_VALUE, {
        rpcId,
        key: key.hex,
        nodeId: this.localNodeId.hex
      });
    });
  }

  /**
   * Handle PING message
   */
  _handlePing(rpcId, data, from) {
    // Add sender to routing table
    if (data.nodeId) {
      this._routingTable.addNode({
        id: new NodeID(data.nodeId),
        address: from.address,
        port: from.port
      });
    }
    
    // Send PONG
    this._sendRPC({ address: from.address, port: from.port }, RPCCommand.PONG, {
      rpcId,
      nodeId: this.localNodeId.hex
    });
  }

  /**
   * Handle PONG message
   */
  _handlePong(rpcId, data) {
    const pending = this._pendingCalls.get(rpcId);
    if (pending) {
      clearTimeout(pending.timeout);
      this._pendingCalls.delete(rpcId);
      pending.resolve({ nodeId: data.nodeId });
      
      // Add to routing table
      if (data.nodeId) {
        this._routingTable.handlePong(new NodeID(data.nodeId));
      }
    }
  }

  /**
   * Handle FIND_NODE message
   */
  _handleFindNode(rpcId, data, from) {
    const target = new NodeID(data.target);
    
    // Add sender to routing table
    if (data.nodeId) {
      this._routingTable.addNode({
        id: new NodeID(data.nodeId),
        address: from.address,
        port: from.port
      });
    }
    
    // Find closest nodes
    const closest = this._routingTable.getClosestNodes(target, this.options.k);
    
    // Send response
    this._sendRPC({ address: from.address, port: from.port }, RPCCommand.FIND_NODE, {
      rpcId,
      nodes: closest.map(n => n.toJSON())
    });
  }

  /**
   * Handle FIND_VALUE message
   */
  _handleFindValue(rpcId, data, from) {
    const key = new NodeID(data.key);
    
    // Add sender to routing table
    if (data.nodeId) {
      this._routingTable.addNode({
        id: new NodeID(data.nodeId),
        address: from.address,
        port: from.port
      });
    }
    
    // Check local storage
    const stored = this._storage.get(key.hex);
    
    if (stored) {
      // Send value
      this._sendRPC({ address: from.address, port: from.port }, RPCCommand.FIND_VALUE, {
        rpcId,
        value: stored.value
      });
    } else {
      // Send closest nodes
      const closest = this._routingTable.getClosestNodes(key, this.options.k);
      this._sendRPC({ address: from.address, port: from.port }, RPCCommand.FIND_VALUE, {
        rpcId,
        nodes: closest.map(n => n.toJSON())
      });
    }
  }

  /**
   * Handle STORE message
   */
  _handleStore(rpcId, data, from) {
    const key = new NodeID(data.key);
    const value = data.value;
    
    // Add sender to routing table
    if (data.nodeId) {
      this._routingTable.addNode({
        id: new NodeID(data.nodeId),
        address: from.address,
        port: from.port
      });
    }
    
    // Store value
    this._storage.set(key.hex, {
      value,
      storedAt: Date.now(),
      storedBy: data.nodeId
    });
    
    // Send acknowledgment
    this._sendRPC({ address: from.address, port: from.port }, RPCCommand.STORE, {
      rpcId,
      success: true
    });
  }

  /**
   * Start bucket refresh
   */
  _startRefresh() {
    // Periodically refresh buckets
    setInterval(() => {
      const staleBuckets = this._routingTable.getStaleBuckets();
      for (const bucket of staleBuckets) {
        const node = this._routingTable.getNodeForRefresh(bucket.index);
        if (node) {
          this.findNode(node.id).catch(() => {});
        }
        this._routingTable.markBucketRefreshed(bucket.index);
      }
    }, this.options.refreshInterval);
  }
}

export default KademliaDHT;
