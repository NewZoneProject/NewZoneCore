// Module: Event Bus
// Description: Advanced event system with subscriptions, routing, middleware,
//              and supervisor-level notifications for NewZoneCore.
// File: core/eventbus/index.js

// ============================================================================
// EVENT TYPES
// ============================================================================

export const EventTypes = {
  // Core events
  CORE_STARTED: 'core:started',
  CORE_STOPPING: 'core:stopping',
  CORE_ERROR: 'core:error',
  
  // Service events
  SERVICE_REGISTERED: 'service:registered',
  SERVICE_STARTED: 'service:started',
  SERVICE_STOPPED: 'service:stopped',
  SERVICE_ERROR: 'service:error',
  SERVICE_CRASHED: 'service:crashed',
  
  // Module events
  MODULE_LOADED: 'module:loaded',
  MODULE_UNLOADED: 'module:unloaded',
  MODULE_ERROR: 'module:error',
  
  // Identity events
  IDENTITY_CREATED: 'identity:created',
  IDENTITY_IMPORTED: 'identity:imported',
  IDENTITY_EXPORTED: 'identity:exported',
  
  // Trust events
  TRUST_PEER_ADDED: 'trust:peer:added',
  TRUST_PEER_REMOVED: 'trust:peer:removed',
  TRUST_PEER_UPDATED: 'trust:peer:updated',
  TRUST_SYNC: 'trust:sync',
  
  // Channel events
  CHANNEL_OPENED: 'channel:opened',
  CHANNEL_CLOSED: 'channel:closed',
  CHANNEL_MESSAGE: 'channel:message',
  CHANNEL_ERROR: 'channel:error',
  CHANNEL_REKEY: 'channel:rekey',
  
  // Routing events
  ROUTE_ADDED: 'route:added',
  ROUTE_REMOVED: 'route:removed',
  ROUTE_MESSAGE: 'route:message',
  ROUTE_PING: 'route:ping',
  ROUTE_PONG: 'route:pong',
  
  // System events
  SYSTEM_WARNING: 'system:warning',
  SYSTEM_INFO: 'system:info',
  SYSTEM_DEBUG: 'system:debug'
};

// ============================================================================
// EVENT CLASS
// ============================================================================

export class Event {
  constructor(type, payload = {}, options = {}) {
    this.id = `${type}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    this.type = type;
    this.payload = payload;
    this.timestamp = new Date().toISOString();
    this.source = options.source || 'unknown';
    this.priority = options.priority || 'normal';
    this.cancelled = false;
  }
  
  cancel() {
    this.cancelled = true;
  }
  
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      payload: this.payload,
      timestamp: this.timestamp,
      source: this.source
    };
  }
}

// ============================================================================
// EVENT BUS
// ============================================================================

export class EventBus {
  constructor(options = {}) {
    this.options = {
      maxQueueSize: options.maxQueueSize || 1000,
      historySize: options.historySize || 100,
      enableHistory: options.enableHistory !== false,
      ...options
    };
    
    this.subscribers = new Map();
    this.wildcardSubscribers = new Set();
    this.queue = [];
    this.processing = false;
    this.history = [];
    this.middleware = [];
    this.errorHandlers = new Set();
    this.stats = { emitted: 0, processed: 0, errors: 0, subscribers: 0 };
  }
  
  subscribe(eventType, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    
    const subscription = {
      id: `sub:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      handler,
      once: options.once || false,
      priority: options.priority || 'normal',
      filter: options.filter || null
    };
    
    if (eventType === '*') {
      this.wildcardSubscribers.add(subscription);
    } else {
      if (!this.subscribers.has(eventType)) {
        this.subscribers.set(eventType, new Set());
      }
      this.subscribers.get(eventType).add(subscription);
    }
    
    this.stats.subscribers++;
    return () => this.unsubscribe(eventType, subscription);
  }
  
  once(eventType, handler, options = {}) {
    return this.subscribe(eventType, handler, { ...options, once: true });
  }
  
  unsubscribe(eventType, subscription) {
    if (eventType === '*') {
      this.wildcardSubscribers.delete(subscription);
    } else if (this.subscribers.has(eventType)) {
      this.subscribers.get(eventType).delete(subscription);
    }
    this.stats.subscribers--;
  }
  
  emit(type, payload = {}, options = {}) {
    const event = type instanceof Event ? type : new Event(type, payload, options);
    
    if (this.queue.length >= this.options.maxQueueSize) {
      this.handleError(new Error('Event queue overflow'), event);
      return event;
    }
    
    for (const mw of this.middleware) {
      try {
        mw(event);
        if (event.cancelled) return event;
      } catch (err) {
        this.handleError(err, event);
      }
    }
    
    this.queue.push(event);
    this.stats.emitted++;
    
    if (this.options.enableHistory) {
      this.history.push(event);
      if (this.history.length > this.options.historySize) {
        this.history.shift();
      }
    }
    
    this.processQueue();
    return event;
  }
  
  emitSync(type, payload = {}, options = {}) {
    const event = type instanceof Event ? type : new Event(type, payload, options);
    
    for (const mw of this.middleware) {
      try {
        mw(event);
        if (event.cancelled) return event;
      } catch (err) {
        this.handleError(err, event);
      }
    }
    
    this.deliver(event);
    this.stats.emitted++;
    this.stats.processed++;
    return event;
  }
  
  async processQueue() {
    if (this.processing) return;
    this.processing = true;
    
    while (this.queue.length > 0) {
      const event = this.queue.shift();
      
      if (!event.cancelled) {
        try {
          await this.deliver(event);
          this.stats.processed++;
        } catch (err) {
          this.handleError(err, event);
        }
      }
    }
    
    this.processing = false;
  }
  
  async deliver(event) {
    const handlers = [];
    
    if (this.subscribers.has(event.type)) {
      for (const sub of this.subscribers.get(event.type)) {
        if (!sub.filter || sub.filter(event)) {
          handlers.push(sub);
        }
      }
    }
    
    for (const sub of this.wildcardSubscribers) {
      if (!sub.filter || sub.filter(event)) {
        handlers.push(sub);
      }
    }
    
    handlers.sort((a, b) => {
      const priorities = { high: 0, normal: 1, low: 2 };
      return priorities[a.priority] - priorities[b.priority];
    });
    
    const toRemove = [];
    
    for (const sub of handlers) {
      if (event.cancelled) break;
      
      try {
        await sub.handler(event);
        if (sub.once) toRemove.push(sub);
      } catch (err) {
        this.handleError(err, event);
      }
    }
    
    for (const sub of toRemove) {
      this.unsubscribe(event.type, sub);
    }
  }
  
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }
    this.middleware.push(middleware);
  }
  
  onError(handler) {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }
  
  handleError(error, event) {
    this.stats.errors++;
    
    if (event.type !== EventTypes.CORE_ERROR) {
      this.emitSync(EventTypes.CORE_ERROR, { originalEvent: event, error: error.message });
    }
    
    for (const handler of this.errorHandlers) {
      try {
        handler(error, event);
      } catch {}
    }
  }
  
  getHistory(filter = null) {
    if (!filter) return [...this.history];
    return this.history.filter(event => {
      if (typeof filter === 'string') {
        return event.type === filter || event.type.startsWith(filter);
      }
      if (typeof filter === 'function') {
        return filter(event);
      }
      return true;
    });
  }
  
  getStats() {
    return {
      ...this.stats,
      queueSize: this.queue.length,
      historySize: this.history.length,
      eventTypes: Array.from(this.subscribers.keys())
    };
  }
  
  namespace(ns) {
    return {
      emit: (type, payload, options) => this.emit(`${ns}:${type}`, payload, { ...options, source: ns }),
      emitSync: (type, payload, options) => this.emitSync(`${ns}:${type}`, payload, { ...options, source: ns }),
      subscribe: (type, handler, options) => this.subscribe(`${ns}:${type}`, handler, options),
      once: (type, handler, options) => this.once(`${ns}:${type}`, handler, options)
    };
  }
}

let globalBus = null;

export function getEventBus(options = {}) {
  if (!globalBus) {
    globalBus = new EventBus(options);
  }
  return globalBus;
}

export function createEventBus(options = {}) {
  return new EventBus(options);
}
