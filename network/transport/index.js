// Module: Transport Interface
// Description: Abstract transport interface for all transport types.
// File: network/transport/index.js

import { EventEmitter } from 'events';
import { Connection, ConnectionState, ConnectionEvents } from './connection.js';

/**
 * Transport types
 */
export const TransportType = {
  TCP: 'tcp',
  WEBSOCKET: 'websocket',
  QUIC: 'quic',
  MEMORY: 'memory'
};

/**
 * Transport events
 */
export const TransportEvents = {
  LISTENING: 'listening',
  CONNECTION: 'connection',
  ERROR: 'error',
  CLOSE: 'close'
};

/**
 * Default transport options
 */
const DEFAULT_TRANSPORT_OPTIONS = {
  maxConnections: 1000,
  connectionTimeout: 30000,
  keepAlive: true,
  keepAliveInterval: 30000,
  noDelay: true,
  highWaterMark: 65536
};

/**
 * Abstract Transport class - base for all transport implementations
 */
export class Transport extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.type = options.type || 'unknown';
    this.options = { ...DEFAULT_TRANSPORT_OPTIONS, ...options };
    
    // State
    this.isListening = false;
    this.isStarted = false;
    this.startedAt = null;
    
    // Connections
    this.connections = new Map();
    
    // Bind methods
    this._handleConnectionError = this._handleConnectionError.bind(this);
    this._handleConnectionClose = this._handleConnectionClose.bind(this);
  }

  /**
   * Get number of active connections
   */
  get connectionCount() {
    return this.connections.size;
  }

  /**
   * Get local address info
   */
  get address() {
    return this._address || null;
  }

  /**
   * Get local port
   */
  get port() {
    return this._port || null;
  }

  /**
   * Start listening for incoming connections
   * Must be implemented by subclass
   */
  async listen(port, host = '0.0.0.0') {
    throw new Error('Transport.listen() must be implemented by subclass');
  }

  /**
   * Connect to a remote peer
   * Must be implemented by subclass
   */
  async connect(address, port) {
    throw new Error('Transport.connect() must be implemented by subclass');
  }

  /**
   * Stop the transport and close all connections
   */
  async close() {
    // Close all connections
    const closePromises = [];
    for (const [id, connection] of this.connections) {
      closePromises.push(connection.close('transport_shutdown'));
    }
    await Promise.allSettled(closePromises);
    
    this.connections.clear();
    this.isListening = false;
    this.isStarted = false;
    
    this.emit(TransportEvents.CLOSE, {
      type: this.type,
      timestamp: Date.now()
    });
  }

  /**
   * Get connection by ID
   */
  getConnection(id) {
    return this.connections.get(id);
  }

  /**
   * Get all connections
   */
  getConnections() {
    return Array.from(this.connections.values());
  }

  /**
   * Get connections by peer ID
   */
  getConnectionsByPeerId(peerId) {
    return this.getConnections().filter(conn => conn.peerId === peerId);
  }

  /**
   * Get transport statistics
   */
  getStats() {
    const connections = this.getConnections();
    let totalBytesReceived = 0;
    let totalBytesSent = 0;
    let totalMessagesReceived = 0;
    let totalMessagesSent = 0;
    
    for (const conn of connections) {
      totalBytesReceived += conn.bytesReceived;
      totalBytesSent += conn.bytesSent;
      totalMessagesReceived += conn.messagesReceived;
      totalMessagesSent += conn.messagesSent;
    }
    
    return {
      type: this.type,
      isListening: this.isListening,
      isStarted: this.isStarted,
      startedAt: this.startedAt,
      address: this.address,
      port: this.port,
      connectionCount: this.connectionCount,
      maxConnections: this.options.maxConnections,
      totalBytesReceived,
      totalBytesSent,
      totalMessagesReceived,
      totalMessagesSent,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0
    };
  }

  /**
   * Register a connection
   */
  _registerConnection(connection) {
    // Check connection limit
    if (this.connections.size >= this.options.maxConnections) {
      connection.close('max_connections_reached');
      throw new Error('Maximum connections reached');
    }
    
    this.connections.set(connection.id, connection);
    
    // Attach event handlers
    connection.on(ConnectionEvents.ERROR, this._handleConnectionError);
    connection.on(ConnectionEvents.DISCONNECTED, this._handleConnectionClose);
    
    return connection;
  }

  /**
   * Unregister a connection
   */
  _unregisterConnection(connectionId) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.removeListener(ConnectionEvents.ERROR, this._handleConnectionError);
      connection.removeListener(ConnectionEvents.DISCONNECTED, this._handleConnectionClose);
      this.connections.delete(connectionId);
    }
  }

  /**
   * Handle connection error
   */
  _handleConnectionError(event) {
    // Log error, could emit transport-level event
    console.error(`[Transport] Connection ${event.connectionId} error:`, event.error);
  }

  /**
   * Handle connection close
   */
  _handleConnectionClose(event) {
    this._unregisterConnection(event.connectionId);
  }

  /**
   * Create connection options
   */
  _createConnectionOptions(overrides = {}) {
    return {
      transportType: this.type,
      timeout: this.options.connectionTimeout,
      keepAlive: this.options.keepAlive,
      keepAliveInterval: this.options.keepAliveInterval,
      noDelay: this.options.noDelay,
      highWaterMark: this.options.highWaterMark,
      ...overrides
    };
  }
}

// Re-export
export { Connection, ConnectionState, ConnectionEvents };
export default Transport;
