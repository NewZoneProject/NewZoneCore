// Module: Bootstrap Nodes
// Description: Bootstrap node client for initial network connection.
// File: network/discovery/bootstrap-nodes.js

import { EventEmitter } from 'events';
import { NodeID } from '../dht/node-id.js';

/**
 * Bootstrap Events
 */
export const BootstrapEvents = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
  ALL_FAILED: 'all_failed',
  BOOTSTRAPPED: 'bootstrapped'
};

/**
 * Default Bootstrap Nodes
 * These are well-known nodes in the NewZoneCore network
 */
export const DEFAULT_BOOTSTRAP_NODES = [
  // Format: { id, address, port }
  // In production, these would be actual bootstrap nodes
  // { id: 'node1...', address: 'bootstrap1.newzone.io', port: 9030 },
  // { id: 'node2...', address: 'bootstrap2.newzone.io', port: 9030 },
];

/**
 * Bootstrap Node Options
 */
const DEFAULT_OPTIONS = {
  timeout: 10000,          // Connection timeout per node
  maxConcurrent: 3,        // Max concurrent connection attempts
  retryDelay: 5000,        // Delay between retry cycles
  maxRetries: 3,           // Max retry cycles
  requiredNodes: 1,        // Minimum nodes needed for bootstrap
  connectionTimeout: 30000 // Overall bootstrap timeout
};

/**
 * BootstrapManager class - manages bootstrap node connections
 */
export class BootstrapManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Bootstrap nodes list
    this._nodes = new Map(); // id -> { node info, status }
    
    // Connected bootstrap nodes
    this._connected = new Map();
    
    // State
    this._isBootstrapped = false;
    this._isBootstrapping = false;
  }

  /**
   * Add a bootstrap node
   */
  addNode(nodeInfo) {
    const id = nodeInfo.id || NodeID.random().hex;
    
    this._nodes.set(id, {
      id,
      address: nodeInfo.address,
      port: nodeInfo.port || 9030,
      status: 'pending',
      addedAt: Date.now(),
      lastAttempt: null,
      attempts: 0
    });
    
    return id;
  }

  /**
   * Add multiple bootstrap nodes
   */
  addNodes(nodes) {
    for (const node of nodes) {
      this.addNode(node);
    }
  }

  /**
   * Remove a bootstrap node
   */
  removeNode(nodeId) {
    this._nodes.delete(nodeId);
    this._connected.delete(nodeId);
  }

  /**
   * Get all bootstrap nodes
   */
  getNodes() {
    return Array.from(this._nodes.values());
  }

  /**
   * Get connected bootstrap nodes
   */
  getConnectedNodes() {
    return Array.from(this._connected.values());
  }

  /**
   * Check if bootstrapped
   */
  get isBootstrapped() {
    return this._isBootstrapped;
  }

  /**
   * Bootstrap to the network
   */
  async bootstrap(transport) {
    if (this._isBootstrapping) {
      throw new Error('Bootstrap already in progress');
    }
    
    this._isBootstrapping = true;
    this._transport = transport;
    
    const nodes = this.getNodes();
    
    if (nodes.length === 0) {
      this._isBootstrapping = false;
      this.emit(BootstrapEvents.ALL_FAILED, { reason: 'no_nodes' });
      throw new Error('No bootstrap nodes configured');
    }
    
    try {
      // Try to connect to bootstrap nodes
      const result = await this._attemptConnections(nodes);
      
      if (result.connected >= this.options.requiredNodes) {
        this._isBootstrapped = true;
        this.emit(BootstrapEvents.BOOTSTRAPPED, {
          connectedNodes: result.connected,
          totalNodes: nodes.length
        });
        
        return {
          success: true,
          connectedNodes: result.connected,
          totalNodes: nodes.length
        };
      } else {
        this.emit(BootstrapEvents.ALL_FAILED, {
          reason: 'insufficient_nodes',
          connected: result.connected,
          required: this.options.requiredNodes
        });
        
        return {
          success: false,
          connectedNodes: result.connected,
          error: 'Insufficient bootstrap connections'
        };
      }
    } finally {
      this._isBootstrapping = false;
    }
  }

  /**
   * Attempt connections to bootstrap nodes
   */
  async _attemptConnections(nodes) {
    const results = {
      connected: 0,
      failed: 0,
      connections: []
    };
    
    // Process in batches
    for (let i = 0; i < nodes.length; i += this.options.maxConcurrent) {
      const batch = nodes.slice(i, i + this.options.maxConcurrent);
      
      const promises = batch.map(node => this._connectToNode(node));
      const batchResults = await Promise.allSettled(promises);
      
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const node = batch[j];
        
        if (result.status === 'fulfilled' && result.value.success) {
          results.connected++;
          results.connections.push(result.value.connection);
          this._connected.set(node.id, {
            node,
            connection: result.value.connection,
            connectedAt: Date.now()
          });
          
          this.emit(BootstrapEvents.CONNECTED, {
            nodeId: node.id,
            address: node.address,
            port: node.port
          });
        } else {
          results.failed++;
          this._updateNodeStatus(node.id, 'failed');
          
          this.emit(BootstrapEvents.ERROR, {
            nodeId: node.id,
            error: result.reason?.message || 'Connection failed'
          });
        }
      }
      
      // Stop if we have enough connections
      if (results.connected >= this.options.requiredNodes) {
        break;
      }
    }
    
    return results;
  }

  /**
   * Connect to a single bootstrap node
   */
  async _connectToNode(node) {
    this._updateNodeStatus(node.id, 'connecting');
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout to ${node.address}:${node.port}`));
      }, this.options.timeout);
      
      this._transport.connect(node.address, node.port)
        .then(connection => {
          clearTimeout(timeout);
          this._updateNodeStatus(node.id, 'connected');
          
          // Setup disconnect handler
          connection.on('disconnect', () => {
            this._handleDisconnect(node.id);
          });
          
          resolve({
            success: true,
            connection,
            node
          });
        })
        .catch(err => {
          clearTimeout(timeout);
          this._updateNodeStatus(node.id, 'failed');
          reject(err);
        });
    });
  }

  /**
   * Update node status
   */
  _updateNodeStatus(nodeId, status) {
    const node = this._nodes.get(nodeId);
    if (node) {
      node.status = status;
      node.lastAttempt = Date.now();
      if (status === 'connecting') {
        node.attempts++;
      }
    }
  }

  /**
   * Handle bootstrap node disconnect
   */
  _handleDisconnect(nodeId) {
    this._connected.delete(nodeId);
    this._updateNodeStatus(nodeId, 'disconnected');
    
    this.emit(BootstrapEvents.DISCONNECTED, { nodeId });
    
    // Try to reconnect if we fall below required
    if (this._connected.size < this.options.requiredNodes) {
      this._reconnect(nodeId);
    }
  }

  /**
   * Attempt to reconnect to a node
   */
  async _reconnect(nodeId) {
    const node = this._nodes.get(nodeId);
    if (!node || node.attempts >= this.options.maxRetries) {
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
    
    try {
      await this._connectToNode(node);
    } catch (e) {
      // Will be handled by retry logic
    }
  }

  /**
   * Get bootstrap status
   */
  getStatus() {
    return {
      isBootstrapped: this._isBootstrapped,
      isBootstrapping: this._isBootstrapping,
      totalNodes: this._nodes.size,
      connectedNodes: this._connected.size,
      requiredNodes: this.options.requiredNodes,
      nodes: this.getNodes().map(n => ({
        id: n.id,
        address: n.address,
        port: n.port,
        status: n.status,
        attempts: n.attempts
      }))
    };
  }

  /**
   * Reset bootstrap state
   */
  reset() {
    this._isBootstrapped = false;
    this._isBootstrapping = false;
    this._connected.clear();
    
    for (const node of this._nodes.values()) {
      node.status = 'pending';
    }
  }
}

export default BootstrapManager;
