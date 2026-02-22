// Module: Event Streaming
// Description: Real-time event streaming for NewZoneCore.
//              Provides WebSocket-based event subscriptions.
// File: core/analytics/streaming.js

import { EventEmitter } from 'events';
import { WebSocketServer } from 'ws';
import { getEventBus } from '../eventbus/index.js';

// ============================================================================
// EVENT STREAM
// ============================================================================

export class EventStream extends EventEmitter {
  constructor(options = {}) {
    super();

    this.eventBus = getEventBus();
    this.subscriptions = new Map();
    this.buffer = [];
    this.maxBuffer = options.maxBuffer || 1000;
    this.filters = new Map();
  }

  /**
   * Subscribe to event types.
   */
  subscribe(clientId, eventTypes, filter = null) {
    const subscription = {
      clientId,
      eventTypes,
      filter,
      createdAt: new Date().toISOString()
    };

    this.subscriptions.set(clientId, subscription);

    if (filter) {
      this.filters.set(clientId, filter);
    }

    this.emit('subscribe', { clientId, eventTypes });
    console.log(`[stream] Client ${clientId} subscribed to ${eventTypes.length} events`);

    return subscription;
  }

  /**
   * Unsubscribe client.
   */
  unsubscribe(clientId) {
    this.subscriptions.delete(clientId);
    this.filters.delete(clientId);
    this.emit('unsubscribe', { clientId });
    console.log(`[stream] Client ${clientId} unsubscribed`);
  }

  /**
   * Send event to client.
   */
  send(clientId, event) {
    this.emit('send', { clientId, event });
  }

  /**
   * Broadcast event to all subscribers.
   */
  broadcast(eventType, payload) {
    const event = {
      type: eventType,
      payload,
      timestamp: new Date().toISOString(),
      id: `${eventType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    // Add to buffer
    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift();
    }

    // Send to subscribers
    for (const [clientId, subscription] of this.subscriptions) {
      if (subscription.eventTypes.includes(eventType) || 
          subscription.eventTypes.includes('*')) {
        
        // Apply filter if exists
        if (subscription.filter && !this._applyFilter(event, subscription.filter)) {
          continue;
        }

        this.send(clientId, event);
      }
    }

    return event;
  }

  /**
   * Apply filter to event.
   */
  _applyFilter(event, filter) {
    for (const [key, value] of Object.entries(filter)) {
      if (event.payload[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get buffered events.
   */
  getBuffer(since = null, limit = 100) {
    let events = this.buffer;

    if (since) {
      const sinceTime = new Date(since).getTime();
      events = events.filter(e => new Date(e.timestamp).getTime() > sinceTime);
    }

    return events.slice(-limit);
  }

  /**
   * Clear buffer.
   */
  clearBuffer() {
    this.buffer = [];
    this.emit('buffer:clear');
  }

  /**
   * Get stream stats.
   */
  getStats() {
    return {
      subscribers: this.subscriptions.size,
      bufferSize: this.buffer.length,
      maxBuffer: this.maxBuffer,
      filters: this.filters.size
    };
  }
}

// ============================================================================
// STREAMING SERVER
// ============================================================================

export class StreamingServer extends EventEmitter {
  constructor(options = {}) {
    super();

    this.port = options.port || 3001;
    this.path = options.path || '/events';
    this.stream = new EventStream(options);
    this.wss = null;
    this.clients = new Map();
  }

  /**
   * Start streaming server.
   */
  start() {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({
          port: this.port,
          path: this.path
        });

        this.wss.on('connection', (ws, req) => {
          this._handleConnection(ws, req);
        });

        this.wss.on('listening', () => {
          console.log(`[stream] WebSocket server listening on port ${this.port}`);
          resolve(this);
        });

        this.wss.on('error', (error) => {
          console.error('[stream] WebSocket server error:', error.message);
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle new connection.
   */
  _handleConnection(ws, req) {
    const clientId = req.url.split('?')[0].split('/').pop() || `client-${Date.now()}`;
    
    console.log(`[stream] Client connected: ${clientId}`);

    this.clients.set(clientId, { ws, connectedAt: new Date().toISOString() });

    ws.on('message', (data) => {
      this._handleMessage(clientId, data);
    });

    ws.on('close', () => {
      this._handleClose(clientId);
    });

    ws.on('error', (error) => {
      console.error(`[stream] Client ${clientId} error:`, error.message);
    });

    // Send welcome message
    this._send(clientId, {
      type: 'welcome',
      clientId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle incoming message.
   */
  _handleMessage(clientId, data) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'subscribe':
          this.stream.subscribe(clientId, message.eventTypes, message.filter);
          this._send(clientId, {
            type: 'subscribed',
            eventTypes: message.eventTypes,
            timestamp: new Date().toISOString()
          });
          break;

        case 'unsubscribe':
          this.stream.unsubscribe(clientId);
          this._send(clientId, {
            type: 'unsubscribed',
            timestamp: new Date().toISOString()
          });
          break;

        case 'get_buffer':
          const events = this.stream.getBuffer(message.since, message.limit);
          this._send(clientId, {
            type: 'buffer',
            events,
            timestamp: new Date().toISOString()
          });
          break;

        default:
          this._send(clientId, {
            type: 'error',
            message: `Unknown message type: ${message.type}`
          });
      }
    } catch (error) {
      this._send(clientId, {
        type: 'error',
        message: error.message
      });
    }
  }

  /**
   * Handle client disconnect.
   */
  _handleClose(clientId) {
    this.stream.unsubscribe(clientId);
    this.clients.delete(clientId);
    console.log(`[stream] Client disconnected: ${clientId}`);
  }

  /**
   * Send message to client.
   */
  _send(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === 1) { // WebSocket.OPEN
      client.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast to all clients.
   */
  broadcast(eventType, payload) {
    const event = this.stream.broadcast(eventType, payload);
    
    // Send to all connected clients
    for (const clientId of this.stream.subscriptions.keys()) {
      this._send(clientId, event);
    }

    return event;
  }

  /**
   * Stop streaming server.
   */
  stop() {
    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => {
          console.log('[stream] WebSocket server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server stats.
   */
  getStats() {
    return {
      port: this.port,
      clients: this.clients.size,
      stream: this.stream.getStats()
    };
  }
}

// ============================================================================
// EVENT BUS INTEGRATION
// ============================================================================

/**
 * Connect event bus to streaming server.
 */
export function connectEventBusToStream(eventBus, stream) {
  // Forward all events to stream
  eventBus.on('*', (eventType, payload) => {
    stream.broadcast(eventType, payload);
  });

  console.log('[stream] Event bus connected to stream');
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalStreamServer = null;

export async function getStreamingServer(options = {}) {
  if (!globalStreamServer) {
    globalStreamServer = new StreamingServer(options);
    await globalStreamServer.start();
    
    // Connect to event bus
    const eventBus = getEventBus();
    connectEventBusToStream(eventBus, globalStreamServer.stream);
  }
  return globalStreamServer;
}

export function createStreamingServer(options = {}) {
  return new StreamingServer(options);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  EventStream,
  StreamingServer,
  getStreamingServer,
  createStreamingServer,
  connectEventBusToStream
};
