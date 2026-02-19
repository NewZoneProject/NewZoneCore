// Module: TCP Transport
// Description: TCP-based transport implementation for NewZoneCore.
// File: network/transport/tcp-transport.js

import net from 'net';
import { EventEmitter } from 'events';
import { Transport, TransportType, TransportEvents, Connection, ConnectionState } from './index.js';
import { Frame, FrameParser, MessageType } from './message-framing.js';

/**
 * TCP Transport specific options
 */
const DEFAULT_TCP_OPTIONS = {
  port: 9030,
  host: '0.0.0.0',
  backlog: 511,
  maxConnections: 1000,
  connectionTimeout: 30000,
  keepAlive: true,
  keepAliveInterval: 30000,
  noDelay: true,
  highWaterMark: 65536,
  reuseAddr: true,
  ipv6Only: false
};

/**
 * TCPTransport class - TCP implementation of Transport
 */
export class TCPTransport extends Transport {
  constructor(options = {}) {
    super({ ...DEFAULT_TCP_OPTIONS, ...options, type: TransportType.TCP });
    
    this._server = null;
    this._address = null;
    this._port = null;
    
    // Pending connections
    this._pendingConnections = new Map();
    
    // Connection parsers
    this._parsers = new Map();
  }

  /**
   * Start listening for incoming connections
   */
  async listen(port = this.options.port, host = this.options.host) {
    if (this.isListening) {
      throw new Error('Transport is already listening');
    }
    
    return new Promise((resolve, reject) => {
      this._server = net.createServer({
        keepAlive: this.options.keepAlive,
        noDelay: this.options.noDelay,
        highWaterMark: this.options.highWaterMark,
        allowHalfOpen: false
      });
      
      // Handle new connections
      this._server.on('connection', (socket) => {
        this._handleIncomingConnection(socket);
      });
      
      // Handle server errors
      this._server.on('error', (err) => {
        if (!this.isListening) {
          reject(err);
        } else {
          this.emit(TransportEvents.ERROR, {
            type: 'server_error',
            error: err.message,
            code: err.code
          });
        }
      });
      
      // Handle server close
      this._server.on('close', () => {
        this.isListening = false;
        this.emit(TransportEvents.CLOSE, { type: 'server_closed' });
      });
      
      // Start listening
      this._server.listen({
        port,
        host,
        backlog: this.options.backlog,
        exclusive: false,
        ipv6Only: this.options.ipv6Only
      }, () => {
        const address = this._server.address();
        this._address = address.address;
        this._port = address.port;
        this.isListening = true;
        this.isStarted = true;
        this.startedAt = Date.now();
        
        this.emit(TransportEvents.LISTENING, {
          type: this.type,
          address: this._address,
          port: this._port
        });
        
        resolve({
          address: this._address,
          port: this._port
        });
      });
    });
  }

  /**
   * Connect to a remote peer
   */
  async connect(address, port) {
    if (!this.isStarted && !this.isListening) {
      // Auto-start if not started
      await this.listen(0);
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout to ${address}:${port}`));
      }, this.options.connectionTimeout);
      
      const socket = net.createConnection({
        host: address,
        port: port,
        noDelay: this.options.noDelay,
        keepAlive: this.options.keepAlive,
        highWaterMark: this.options.highWaterMark
      });
      
      socket.once('connect', () => {
        clearTimeout(timeout);
        
        const connection = this._createConnection(socket, false);
        this._registerConnection(connection);
        
        // Setup parser for this connection
        const parser = new FrameParser({ maxFrameSize: this.options.maxFrameSize });
        this._parsers.set(connection.id, parser);
        
        resolve(connection);
      });
      
      socket.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Close the transport
   */
  async close() {
    // Close all parsers
    this._parsers.clear();
    
    // Close all pending connections
    for (const [id, socket] of this._pendingConnections) {
      socket.destroy();
    }
    this._pendingConnections.clear();
    
    // Close server
    if (this._server) {
      await new Promise((resolve) => {
        this._server.close(() => resolve());
      });
      this._server = null;
    }
    
    // Call parent close
    await super.close();
  }

  /**
   * Send a frame through a connection
   */
  async sendFrame(connectionId, frame) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }
    
    const buffer = frame.toBuffer();
    return connection.send(buffer);
  }

  /**
   * Send data through a connection
   */
  async send(connectionId, data, type = MessageType.DATA, flags = 0) {
    const frame = new Frame(type, flags, Buffer.isBuffer(data) ? data : Buffer.from(data));
    return this.sendFrame(connectionId, frame);
  }

  /**
   * Handle incoming connection
   */
  _handleIncomingConnection(socket) {
    try {
      const connection = this._createConnection(socket, true);
      this._registerConnection(connection);
      
      // Setup parser for this connection
      const parser = new FrameParser({ maxFrameSize: this.options.maxFrameSize });
      this._parsers.set(connection.id, parser);
      
      // Emit connection event
      this.emit(TransportEvents.CONNECTION, {
        connection,
        type: 'incoming',
        remoteAddress: connection.remoteAddress,
        remotePort: connection.remotePort
      });
    } catch (err) {
      // Max connections reached or other error
      socket.destroy();
    }
  }

  /**
   * Create connection from socket
   */
  _createConnection(socket, isServer) {
    const connection = new Connection(this._createConnectionOptions({
      id: `tcp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      socket,
      transportType: TransportType.TCP
    }));
    
    connection.attachSocket(socket, isServer);
    
    // Handle incoming data
    socket.on('data', (data) => {
      this._handleData(connection, data);
    });
    
    return connection;
  }

  /**
   * Handle incoming data
   */
  _handleData(connection, data) {
    const parser = this._parsers.get(connection.id);
    if (!parser) {
      // Parser not found, emit raw data
      connection.emit('rawData', data);
      return;
    }
    
    const { frames, error } = parser.feed(data);
    
    if (error) {
      connection.emit('frameError', error);
      connection.close('frame_error');
      return;
    }
    
    for (const frame of frames) {
      // Handle special frames internally
      if (frame.type === MessageType.PING) {
        // Auto-respond to ping
        const pong = Frame.pong(frame.payload);
        this.sendFrame(connection.id, pong).catch(() => {});
      } else if (frame.type === MessageType.DISCONNECT) {
        connection.close('remote_disconnect');
      } else {
        // Emit frame to handler
        connection.emit('frame', {
          connectionId: connection.id,
          frame,
          type: frame.type,
          flags: frame.flags,
          payload: frame.payload
        });
      }
    }
  }
}

export default TCPTransport;
