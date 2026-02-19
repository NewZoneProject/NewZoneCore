// Module: WebSocket Transport
// Description: WebSocket-based transport implementation for NewZoneCore.
// File: network/transport/websocket-transport.js

import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import { Transport, TransportType, TransportEvents, Connection, ConnectionState } from './index.js';
import { Frame, FrameParser, MessageType } from './message-framing.js';

/**
 * WebSocket Transport specific options
 */
const DEFAULT_WS_OPTIONS = {
  port: 9031,
  host: '0.0.0.0',
  path: '/nz',
  maxConnections: 1000,
  connectionTimeout: 30000,
  pingInterval: 30000,
  pingTimeout: 10000,
  maxPayload: 16 * 1024 * 1024, // 16 MB
  perMessageDeflate: false,
  clientTracking: true,
  // SSL/TLS options
  ssl: false,
  cert: null,
  key: null,
  ca: null,
  rejectUnauthorized: true
};

/**
 * WebSocketTransport class - WebSocket implementation of Transport
 */
export class WebSocketTransport extends Transport {
  constructor(options = {}) {
    super({ ...DEFAULT_WS_OPTIONS, ...options, type: TransportType.WEBSOCKET });
    
    this._server = null;
    this._address = null;
    this._port = null;
    
    // Connection parsers
    this._parsers = new Map();
    
    // Ping/pong tracking
    this._pingTimers = new Map();
  }

  /**
   * Start listening for incoming connections
   */
  async listen(port = this.options.port, host = this.options.host) {
    if (this.isListening) {
      throw new Error('Transport is already listening');
    }
    
    return new Promise((resolve, reject) => {
      const wsOptions = {
        port,
        host,
        path: this.options.path,
        maxPayload: this.options.maxPayload,
        perMessageDeflate: this.options.perMessageDeflate,
        clientTracking: this.options.clientTracking
      };
      
      // Add SSL options if provided
      if (this.options.ssl && this.options.cert && this.options.key) {
        wsOptions.server = this._createHttpsServer();
      }
      
      this._server = new WebSocketServer(wsOptions);
      
      // Handle new connections
      this._server.on('connection', (ws, req) => {
        this._handleIncomingConnection(ws, req);
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
      
      // Get address info
      if (this._server.address) {
        const address = this._server.address();
        if (address) {
          this._address = address.address || host;
          this._port = address.port || port;
        }
      } else {
        this._address = host;
        this._port = port;
      }
      
      this.isListening = true;
      this.isStarted = true;
      this.startedAt = Date.now();
      
      this.emit(TransportEvents.LISTENING, {
        type: this.type,
        address: this._address,
        port: this._port,
        path: this.options.path
      });
      
      resolve({
        address: this._address,
        port: this._port,
        path: this.options.path
      });
    });
  }

  /**
   * Connect to a remote peer
   */
  async connect(address, port, path = this.options.path) {
    if (!this.isStarted && !this.isListening) {
      // Can't auto-start WebSocket client without server
      this.isStarted = true;
      this.startedAt = Date.now();
    }
    
    return new Promise((resolve, reject) => {
      const protocol = this.options.ssl ? 'wss' : 'ws';
      const url = `${protocol}://${address}:${port}${path}`;
      
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error(`Connection timeout to ${url}`));
      }, this.options.connectionTimeout);
      
      const wsOptions = {
        maxPayload: this.options.maxPayload,
        perMessageDeflate: this.options.perMessageDeflate,
        rejectUnauthorized: this.options.rejectUnauthorized,
        ca: this.options.ca
      };
      
      const ws = new WebSocket(url, wsOptions);
      
      ws.once('open', () => {
        clearTimeout(timeout);
        
        const connection = this._createConnection(ws, false);
        this._registerConnection(connection);
        
        // Setup parser for this connection
        const parser = new FrameParser({ maxFrameSize: this.options.maxPayload });
        this._parsers.set(connection.id, parser);
        
        // Setup ping timer
        this._setupPingTimer(connection);
        
        resolve(connection);
      });
      
      ws.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Close the transport
   */
  async close() {
    // Clear all ping timers
    for (const [id, timer] of this._pingTimers) {
      clearInterval(timer);
    }
    this._pingTimers.clear();
    
    // Close all parsers
    this._parsers.clear();
    
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
    return this._sendWebSocket(connection, buffer);
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
  _handleIncomingConnection(ws, req) {
    try {
      const connection = this._createConnection(ws, true, req);
      this._registerConnection(connection);
      
      // Setup parser for this connection
      const parser = new FrameParser({ maxFrameSize: this.options.maxPayload });
      this._parsers.set(connection.id, parser);
      
      // Setup ping timer
      this._setupPingTimer(connection);
      
      // Emit connection event
      this.emit(TransportEvents.CONNECTION, {
        connection,
        type: 'incoming',
        remoteAddress: connection.remoteAddress,
        remotePort: connection.remotePort
      });
    } catch (err) {
      // Max connections reached or other error
      ws.terminate();
    }
  }

  /**
   * Create connection from WebSocket
   */
  _createConnection(ws, isServer, req = null) {
    // Extract remote address
    let remoteAddress = 'unknown';
    let remotePort = 0;
    
    if (req) {
      remoteAddress = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
      remotePort = req.socket.remotePort || 0;
    } else if (ws._socket) {
      remoteAddress = ws._socket.remoteAddress || 'unknown';
      remotePort = ws._socket.remotePort || 0;
    }
    
    const connection = new Connection(this._createConnectionOptions({
      id: `ws_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      transportType: TransportType.WEBSOCKET,
      remoteAddress,
      remotePort
    }));
    
    // Store WebSocket reference
    connection._ws = ws;
    connection._isServer = isServer;
    
    // Update state
    connection.state = ConnectionState.CONNECTED;
    connection.connectedAt = Date.now();
    
    // Handle incoming messages
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        this._handleData(connection, data);
      }
    });
    
    // Handle close
    ws.on('close', (code, reason) => {
      connection.emit('disconnect', { code, reason: reason.toString() });
      connection.state = ConnectionState.DISCONNECTED;
    });
    
    // Handle error
    ws.on('error', (err) => {
      connection.emit('error', { error: err.message });
    });
    
    // Handle ping/pong
    ws.on('pong', (data) => {
      connection._lastPong = Date.now();
    });
    
    return connection;
  }

  /**
   * Handle incoming data
   */
  _handleData(connection, data) {
    const parser = this._parsers.get(connection.id);
    if (!parser) {
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
      if (frame.type === MessageType.PING) {
        const pong = Frame.pong(frame.payload);
        this.sendFrame(connection.id, pong).catch(() => {});
      } else if (frame.type === MessageType.DISCONNECT) {
        connection.close('remote_disconnect');
      } else {
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

  /**
   * Send data via WebSocket
   */
  async _sendWebSocket(connection, buffer) {
    return new Promise((resolve, reject) => {
      const ws = connection._ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not open'));
        return;
      }
      
      ws.send(buffer, { binary: true }, (err) => {
        if (err) {
          reject(err);
        } else {
          connection.bytesSent += buffer.length;
          connection.messagesSent++;
          connection.lastActivity = Date.now();
          resolve(buffer.length);
        }
      });
    });
  }

  /**
   * Setup ping timer for connection
   */
  _setupPingTimer(connection) {
    if (!this.options.pingInterval) return;
    
    const timer = setInterval(() => {
      const ws = connection._ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        clearInterval(timer);
        this._pingTimers.delete(connection.id);
        return;
      }
      
      // Check for pong timeout
      if (connection._lastPong) {
        const elapsed = Date.now() - connection._lastPong;
        if (elapsed > this.options.pingInterval + this.options.pingTimeout) {
          connection.close('ping_timeout');
          clearInterval(timer);
          this._pingTimers.delete(connection.id);
          return;
        }
      }
      
      // Send ping
      ws.ping();
    }, this.options.pingInterval);
    
    this._pingTimers.set(connection.id, timer);
  }

  /**
   * Create HTTPS server for secure WebSocket
   */
  _createHttpsServer() {
    // Would need to import https module
    // For now, throw error if SSL requested without pre-setup
    throw new Error('SSL WebSocket requires pre-configured HTTPS server');
  }
}

export default WebSocketTransport;
