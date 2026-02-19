// Module: Connection
// Description: Base connection class for all transport types.
// File: network/transport/connection.js

import { EventEmitter } from 'events';

/**
 * Connection states
 */
export const ConnectionState = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
  DISCONNECTED: 'disconnected',
  ERROR: 'error'
};

/**
 * Connection events
 */
export const ConnectionEvents = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  DATA: 'data',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  DRAIN: 'drain'
};

/**
 * Default connection options
 */
const DEFAULT_OPTIONS = {
  timeout: 30000,         // Connection timeout (ms)
  keepAlive: true,        // Enable TCP keep-alive
  keepAliveInterval: 30000, // Keep-alive interval (ms)
  noDelay: true,          // Disable Nagle's algorithm
  highWaterMark: 65536,   // Buffer size
  maxRetries: 3,          // Max reconnection attempts
  retryDelay: 1000,       // Initial retry delay (ms)
  retryBackoff: 2         // Backoff multiplier
};

/**
 * Connection class - represents a single connection to a peer
 */
export class Connection extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.id = options.id || generateConnectionId();
    this.peerId = options.peerId || null;
    this.transportType = options.transportType || 'unknown';
    
    // Addresses
    this.localAddress = options.localAddress || null;
    this.localPort = options.localPort || null;
    this.remoteAddress = options.remoteAddress || null;
    this.remotePort = options.remotePort || null;
    
    // State
    this.state = ConnectionState.DISCONNECTED;
    this.createdAt = Date.now();
    this.connectedAt = null;
    this.lastActivity = null;
    this.bytesReceived = 0;
    this.bytesSent = 0;
    this.messagesReceived = 0;
    this.messagesSent = 0;
    
    // Options
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Internal
    this._socket = options.socket || null;
    this._reconnectAttempts = 0;
    this._isReconnecting = false;
    this._destroyed = false;
    
    // Bind methods
    this._handleError = this._handleError.bind(this);
    this._handleClose = this._handleClose.bind(this);
    this._handleData = this._handleData.bind(this);
    this._handleDrain = this._handleDrain.bind(this);
    this._handleTimeout = this._handleTimeout.bind(this);
  }

  /**
   * Check if connection is active
   */
  get isConnected() {
    return this.state === ConnectionState.CONNECTED;
  }

  /**
   * Check if connection is connecting
   */
  get isConnecting() {
    return this.state === ConnectionState.CONNECTING;
  }

  /**
   * Get connection latency estimate
   */
  get latency() {
    return this._latency || 0;
  }

  /**
   * Get connection duration in seconds
   */
  get uptime() {
    if (!this.connectedAt) return 0;
    return Math.floor((Date.now() - this.connectedAt) / 1000);
  }

  /**
   * Attach an existing socket to this connection
   */
  attachSocket(socket, isServer = false) {
    if (this._socket) {
      this._detachSocket();
    }
    
    this._socket = socket;
    this._isServer = isServer;
    
    // Set socket options
    if (socket.setNoDelay && this.options.noDelay) {
      socket.setNoDelay(true);
    }
    
    if (socket.setKeepAlive && this.options.keepAlive) {
      socket.setKeepAlive(true, this.options.keepAliveInterval);
    }
    
    if (socket.setTimeout) {
      socket.setTimeout(this.options.timeout);
    }
    
    // Attach event handlers
    socket.on('error', this._handleError);
    socket.on('close', this._handleClose);
    socket.on('data', this._handleData);
    socket.on('drain', this._handleDrain);
    socket.on('timeout', this._handleTimeout);
    
    // Update state
    this.state = ConnectionState.CONNECTED;
    this.connectedAt = Date.now();
    this.lastActivity = Date.now();
    
    // Update addresses
    if (socket.localAddress) {
      this.localAddress = socket.localAddress;
      this.localPort = socket.localPort;
    }
    if (socket.remoteAddress) {
      this.remoteAddress = socket.remoteAddress;
      this.remotePort = socket.remotePort;
    }
    
    this.emit(ConnectionEvents.CONNECTED, {
      connectionId: this.id,
      peerId: this.peerId,
      remoteAddress: this.remoteAddress,
      remotePort: this.remotePort
    });
  }

  /**
   * Send data through the connection
   */
  async send(data) {
    if (!this.isConnected) {
      throw new Error(`Connection ${this.id} is not connected`);
    }
    
    if (!this._socket) {
      throw new Error(`Connection ${this.id} has no socket`);
    }
    
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    
    return new Promise((resolve, reject) => {
      const canWrite = this._socket.write(buffer, (err) => {
        if (err) {
          this.bytesSent += buffer.length;
          this.messagesSent++;
          this.lastActivity = Date.now();
          reject(err);
        } else {
          this.bytesSent += buffer.length;
          this.messagesSent++;
          this.lastActivity = Date.now();
          resolve(buffer.length);
        }
      });
      
      // If buffer is full, wait for drain
      if (!canWrite) {
        this.once(ConnectionEvents.DRAIN, () => {
          resolve(buffer.length);
        });
      }
    });
  }

  /**
   * Close the connection
   */
  async close(reason = 'normal') {
    if (this.state === ConnectionState.DISCONNECTED || this._destroyed) {
      return;
    }
    
    this.state = ConnectionState.DISCONNECTING;
    
    if (this._socket) {
      this._detachSocket();
      this._socket.destroy();
      this._socket = null;
    }
    
    this.state = ConnectionState.DISCONNECTED;
    this._destroyed = true;
    
    this.emit(ConnectionEvents.DISCONNECTED, {
      connectionId: this.id,
      peerId: this.peerId,
      reason
    });
  }

  /**
   * Ping the connection for latency measurement
   */
  async ping() {
    if (!this.isConnected) {
      throw new Error('Cannot ping disconnected connection');
    }
    
    const start = Date.now();
    // Send a ping message (implementation depends on protocol)
    // For now, we'll use a simple approach
    const latency = Date.now() - start;
    this._latency = latency;
    return latency;
  }

  /**
   * Get connection statistics
   */
  getStats() {
    return {
      id: this.id,
      peerId: this.peerId,
      transportType: this.transportType,
      state: this.state,
      localAddress: this.localAddress,
      localPort: this.localPort,
      remoteAddress: this.remoteAddress,
      remotePort: this.remotePort,
      createdAt: this.createdAt,
      connectedAt: this.connectedAt,
      uptime: this.uptime,
      lastActivity: this.lastActivity,
      bytesReceived: this.bytesReceived,
      bytesSent: this.bytesSent,
      messagesReceived: this.messagesReceived,
      messagesSent: this.messagesSent,
      latency: this.latency
    };
  }

  /**
   * Detach socket handlers
   */
  _detachSocket() {
    if (this._socket) {
      this._socket.removeListener('error', this._handleError);
      this._socket.removeListener('close', this._handleClose);
      this._socket.removeListener('data', this._handleData);
      this._socket.removeListener('drain', this._handleDrain);
      this._socket.removeListener('timeout', this._handleTimeout);
    }
  }

  /**
   * Handle socket error
   */
  _handleError(err) {
    this.state = ConnectionState.ERROR;
    this.emit(ConnectionEvents.ERROR, {
      connectionId: this.id,
      error: err.message,
      code: err.code
    });
  }

  /**
   * Handle socket close
   */
  _handleClose(hadError) {
    const previousState = this.state;
    this.state = ConnectionState.DISCONNECTED;
    
    this.emit(ConnectionEvents.DISCONNECTED, {
      connectionId: this.id,
      peerId: this.peerId,
      reason: hadError ? 'error' : 'closed_remotely'
    });
  }

  /**
   * Handle socket data
   */
  _handleData(data) {
    this.bytesReceived += data.length;
    this.messagesReceived++;
    this.lastActivity = Date.now();
    
    this.emit(ConnectionEvents.DATA, {
      connectionId: this.id,
      peerId: this.peerId,
      data,
      size: data.length
    });
  }

  /**
   * Handle socket drain
   */
  _handleDrain() {
    this.emit(ConnectionEvents.DRAIN, {
      connectionId: this.id
    });
  }

  /**
   * Handle socket timeout
   */
  _handleTimeout() {
    this.emit(ConnectionEvents.TIMEOUT, {
      connectionId: this.id
    });
  }
}

/**
 * Generate unique connection ID
 */
function generateConnectionId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `conn_${timestamp}_${random}`;
}

export default Connection;
