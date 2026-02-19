// Module: Connection Pool
// Description: Connection pooling and management for transports.
// File: network/transport/connection-pool.js

import { EventEmitter } from 'events';
import { ConnectionEvents } from './index.js';

/**
 * Pool events
 */
export const PoolEvents = {
  CONNECTION_ADDED: 'connection_added',
  CONNECTION_REMOVED: 'connection_removed',
  CONNECTION_ERROR: 'connection_error',
  POOL_FULL: 'pool_full',
  POOL_READY: 'pool_ready'
};

/**
 * Default pool options
 */
const DEFAULT_POOL_OPTIONS = {
  maxSize: 1000,            // Maximum connections
  minSize: 0,               // Minimum connections (for keep-alive)
  idleTimeout: 300000,      // 5 minutes - close idle connections
  checkInterval: 60000,     // Check idle connections every minute
  acquireTimeout: 30000,    // Timeout for acquiring connection
  evictionRunIntervalMillis: 60000,
  numTestsPerEvictionRun: 10,
  softIdleTimeout: 180000,  // Soft timeout before eviction candidate
  lifo: true                // Last in, first out for resource allocation
};

/**
 * ConnectionPool class - manages a pool of connections
 */
export class ConnectionPool extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_POOL_OPTIONS, ...options };
    
    // Connection storage
    this._connections = new Map();      // id -> connection
    this._connectionsByPeer = new Map(); // peerId -> Set of connection ids
    
    // State
    this._isRunning = false;
    this._checkTimer = null;
    
    // Metrics
    this._totalCreated = 0;
    this._totalDestroyed = 0;
    this._totalAcquired = 0;
    this._totalReleased = 0;
    this._acquireErrors = 0;
  }

  /**
   * Get current pool size
   */
  get size() {
    return this._connections.size;
  }

  /**
   * Check if pool is full
   */
  get isFull() {
    return this._connections.size >= this.options.maxSize;
  }

  /**
   * Check if pool is empty
   */
  get isEmpty() {
    return this._connections.size === 0;
  }

  /**
   * Start the pool
   */
  async start() {
    if (this._isRunning) return;
    
    this._isRunning = true;
    
    // Start idle check timer
    if (this.options.checkInterval > 0) {
      this._checkTimer = setInterval(() => {
        this._checkIdleConnections();
      }, this.options.checkInterval);
    }
    
    this.emit(PoolEvents.POOL_READY, { pool: this });
  }

  /**
   * Stop the pool and close all connections
   */
  async stop() {
    this._isRunning = false;
    
    if (this._checkTimer) {
      clearInterval(this._checkTimer);
      this._checkTimer = null;
    }
    
    // Close all connections
    const closePromises = [];
    for (const [id, connection] of this._connections) {
      closePromises.push(this.remove(id));
    }
    
    await Promise.allSettled(closePromises);
    
    this._connections.clear();
    this._connectionsByPeer.clear();
  }

  /**
   * Add a connection to the pool
   */
  add(connection) {
    if (this.isFull) {
      this.emit(PoolEvents.POOL_FULL, { pool: this });
      throw new Error('Connection pool is full');
    }
    
    // Add to main map
    this._connections.set(connection.id, connection);
    
    // Add to peer index
    if (connection.peerId) {
      if (!this._connectionsByPeer.has(connection.peerId)) {
        this._connectionsByPeer.set(connection.peerId, new Set());
      }
      this._connectionsByPeer.get(connection.peerId).add(connection.id);
    }
    
    // Track connection events
    connection.on(ConnectionEvents.DISCONNECTED, (event) => {
      this.remove(connection.id);
    });
    
    connection.on(ConnectionEvents.ERROR, (event) => {
      this.emit(PoolEvents.CONNECTION_ERROR, {
        connectionId: connection.id,
        error: event.error
      });
    });
    
    this._totalCreated++;
    
    this.emit(PoolEvents.CONNECTION_ADDED, {
      connectionId: connection.id,
      peerId: connection.peerId,
      poolSize: this.size
    });
    
    return connection;
  }

  /**
   * Remove a connection from the pool
   */
  async remove(connectionId) {
    const connection = this._connections.get(connectionId);
    if (!connection) return false;
    
    // Remove from main map
    this._connections.delete(connectionId);
    
    // Remove from peer index
    if (connection.peerId) {
      const peerConnections = this._connectionsByPeer.get(connection.peerId);
      if (peerConnections) {
        peerConnections.delete(connectionId);
        if (peerConnections.size === 0) {
          this._connectionsByPeer.delete(connection.peerId);
        }
      }
    }
    
    // Close connection
    if (connection.isConnected) {
      await connection.close('pool_removed');
    }
    
    this._totalDestroyed++;
    
    this.emit(PoolEvents.CONNECTION_REMOVED, {
      connectionId,
      peerId: connection.peerId,
      poolSize: this.size
    });
    
    return true;
  }

  /**
   * Get a connection by ID
   */
  get(connectionId) {
    return this._connections.get(connectionId);
  }

  /**
   * Get all connections
   */
  getAll() {
    return Array.from(this._connections.values());
  }

  /**
   * Get connections by peer ID
   */
  getByPeerId(peerId) {
    const ids = this._connectionsByPeer.get(peerId);
    if (!ids || ids.size === 0) return [];
    
    return Array.from(ids)
      .map(id => this._connections.get(id))
      .filter(conn => conn !== undefined);
  }

  /**
   * Check if connection exists
   */
  has(connectionId) {
    return this._connections.has(connectionId);
  }

  /**
   * Get a connection to a peer (any available)
   */
  acquire(peerId, options = {}) {
    const timeout = options.timeout || this.options.acquireTimeout;
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._acquireErrors++;
        reject(new Error(`Acquire timeout for peer ${peerId}`));
      }, timeout);
      
      // Find available connection
      const connections = this.getByPeerId(peerId);
      const available = connections.find(c => c.isConnected);
      
      clearTimeout(timer);
      
      if (available) {
        this._totalAcquired++;
        resolve(available);
      } else {
        this._acquireErrors++;
        reject(new Error(`No available connection to peer ${peerId}`));
      }
    });
  }

  /**
   * Release a connection back to the pool
   */
  release(connectionId) {
    const connection = this._connections.get(connectionId);
    if (!connection) return false;
    
    this._totalReleased++;
    return true;
  }

  /**
   * Get pool statistics
   */
  getStats() {
    const connections = this.getAll();
    let activeCount = 0;
    let idleCount = 0;
    let totalBytesReceived = 0;
    let totalBytesSent = 0;
    
    for (const conn of connections) {
      if (conn.isConnected) activeCount++;
      else idleCount++;
      totalBytesReceived += conn.bytesReceived;
      totalBytesSent += conn.bytesSent;
    }
    
    return {
      size: this.size,
      maxSize: this.options.maxSize,
      activeCount,
      idleCount,
      peerCount: this._connectionsByPeer.size,
      totalCreated: this._totalCreated,
      totalDestroyed: this._totalDestroyed,
      totalAcquired: this._totalAcquired,
      totalReleased: this._totalReleased,
      acquireErrors: this._acquireErrors,
      totalBytesReceived,
      totalBytesSent,
      isRunning: this._isRunning
    };
  }

  /**
   * Broadcast message to all connections
   */
  async broadcast(data, exclude = []) {
    const excludeSet = new Set(exclude);
    const promises = [];
    
    for (const [id, connection] of this._connections) {
      if (excludeSet.has(id)) continue;
      if (!connection.isConnected) continue;
      
      promises.push(connection.send(data).catch(() => {}));
    }
    
    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    return {
      total: promises.length,
      successful,
      failed: promises.length - successful
    };
  }

  /**
   * Broadcast to all connections of a specific peer
   */
  async broadcastToPeer(peerId, data) {
    const connections = this.getByPeerId(peerId);
    const promises = connections
      .filter(c => c.isConnected)
      .map(c => c.send(data).catch(() => {}));
    
    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    return {
      total: promises.length,
      successful,
      failed: promises.length - successful
    };
  }

  /**
   * Check and close idle connections
   */
  _checkIdleConnections() {
    const now = Date.now();
    const toEvict = [];
    
    for (const [id, connection] of this._connections) {
      if (!connection.lastActivity) continue;
      
      const idleTime = now - connection.lastActivity;
      
      // Check if over idle timeout
      if (idleTime > this.options.idleTimeout) {
        toEvict.push(id);
      }
    }
    
    // Evict idle connections (respecting minSize)
    const excessCount = Math.max(0, this.size - this.options.minSize);
    const toRemove = toEvict.slice(0, excessCount);
    
    for (const id of toRemove) {
      this.remove(id).catch(() => {});
    }
  }

  /**
   * Get a random connection
   */
  getRandom() {
    if (this.isEmpty) return null;
    
    const connections = this.getAll();
    const connected = connections.filter(c => c.isConnected);
    
    if (connected.length === 0) return null;
    
    return connected[Math.floor(Math.random() * connected.length)];
  }

  /**
   * Get connections matching filter
   */
  filter(predicate) {
    const connections = this.getAll();
    return connections.filter(predicate);
  }

  /**
   * Find first connection matching predicate
   */
  find(predicate) {
    const connections = this.getAll();
    return connections.find(predicate);
  }
}

export default ConnectionPool;
