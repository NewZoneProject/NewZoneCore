// Module: Distributed Tracing
// Description: OpenTelemetry-compatible distributed tracing for NewZoneCore.
//              Provides request tracing, span management, and context propagation.
// File: core/observability/tracing.js

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';

// ============================================================================
// TRACE CONTEXT
// ============================================================================

/**
 * W3C Trace Context format.
 * @see https://www.w3.org/TR/trace-context/
 */
export class TraceContext {
  constructor(options = {}) {
    // Trace ID: 16-byte hex string (32 chars)
    this.traceId = options.traceId || randomBytes(16).toString('hex');
    
    // Parent ID: 8-byte hex string (16 chars)
    this.parentId = options.parentId || null;
    
    // Span ID: 8-byte hex string (16 chars)
    this.spanId = options.spanId || randomBytes(8).toString('hex');
    
    // Trace flags: 1 byte (00 = not sampled, 01 = sampled)
    this.traceFlags = options.traceFlags || 0x01;
    
    // Trace state: vendor-specific data
    this.traceState = options.traceState || '';
    
    // Start time
    this.startTime = options.startTime || Date.now();
  }

  /**
   * Create child context.
   */
  child(options = {}) {
    return new TraceContext({
      traceId: this.traceId,
      parentId: this.spanId,
      spanId: randomBytes(8).toString('hex'),
      traceFlags: this.traceFlags,
      traceState: this.traceState,
      startTime: options.startTime || Date.now()
    });
  }

  /**
   * Serialize to W3C traceparent header.
   */
  toTraceparent() {
    const version = '00';
    const flags = this.traceFlags.toString(16).padStart(2, '0');
    return `${version}-${this.traceId}-${this.spanId}-${flags}`;
  }

  /**
   * Parse from W3C traceparent header.
   */
  static fromTraceparent(header) {
    if (!header || header.length < 55) return null;
    
    const parts = header.split('-');
    if (parts.length !== 4) return null;
    
    const [version, traceId, spanId, flags] = parts;
    if (version !== '00') return null;
    
    return new TraceContext({
      traceId,
      spanId,
      traceFlags: parseInt(flags, 16)
    });
  }

  /**
   * Serialize to JSON.
   */
  toJSON() {
    return {
      traceId: this.traceId,
      parentId: this.parentId,
      spanId: this.spanId,
      traceFlags: this.traceFlags,
      traceState: this.traceState,
      startTime: this.startTime
    };
  }
}

// ============================================================================
// SPAN
// ============================================================================

export const SpanKind = {
  INTERNAL: 'INTERNAL',
  SERVER: 'SERVER',
  CLIENT: 'CLIENT',
  PRODUCER: 'PRODUCER',
  CONSUMER: 'CONSUMER'
};

export const SpanStatus = {
  UNSET: 'UNSET',
  OK: 'OK',
  ERROR: 'ERROR'
};

export class Span extends EventEmitter {
  constructor(name, context, options = {}) {
    super();
    
    this.name = name;
    this.context = context;
    this.kind = options.kind || SpanKind.INTERNAL;
    this.attributes = new Map();
    this.events = [];
    this.links = [];
    this.status = SpanStatus.UNSET;
    this.statusMessage = '';
    this.endTime = null;
    this.startTime = context.startTime;
    
    // Parent reference
    if (context.parentId) {
      this.links.push({ traceId: context.traceId, spanId: context.parentId });
    }
  }

  /**
   * Set span attribute.
   */
  setAttribute(key, value) {
    if (this.endTime) return; // Span already ended
    this.attributes.set(key, value);
    this.emit('attribute', { key, value });
    return this;
  }

  /**
   * Set multiple attributes.
   */
  setAttributes(attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(key, value);
    }
    return this;
  }

  /**
   * Add span event.
   */
  addEvent(name, attributes = {}) {
    if (this.endTime) return;
    
    this.events.push({
      name,
      attributes,
      timestamp: Date.now()
    });
    
    this.emit('event', { name, attributes });
    return this;
  }

  /**
   * Add link to another span.
   */
  addLink(context, attributes = {}) {
    this.links.push({
      traceId: context.traceId,
      spanId: context.spanId,
      attributes
    });
    return this;
  }

  /**
   * Set span status.
   */
  setStatus(status, message = '') {
    if (this.endTime) return;
    
    this.status = status;
    this.statusMessage = message;
    this.emit('status', { status, message });
    return this;
  }

  /**
   * Record exception.
   */
  recordException(exception, attributes = {}) {
    this.addEvent('exception', {
      'exception.type': exception.constructor?.name || 'Error',
      'exception.message': exception.message,
      'exception.stacktrace': exception.stack?.split('\n').join('\n    '),
      ...attributes
    });
    
    this.setStatus(SpanStatus.ERROR, exception.message);
    return this;
  }

  /**
   * End span.
   */
  end() {
    if (this.endTime) return;
    
    this.endTime = Date.now();
    this.emit('end', { duration: this.duration });
    return this;
  }

  /**
   * Get span duration in ms.
   */
  get duration() {
    return this.endTime ? this.endTime - this.startTime : Date.now() - this.startTime;
  }

  /**
   * Serialize span to JSON.
   */
  toJSON() {
    return {
      name: this.name,
      context: this.context.toJSON(),
      kind: this.kind,
      attributes: Object.fromEntries(this.attributes),
      events: this.events,
      links: this.links,
      status: this.status,
      statusMessage: this.statusMessage,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration
    };
  }
}

// ============================================================================
// TRACER
// ============================================================================

export class Tracer extends EventEmitter {
  constructor(serviceName, options = {}) {
    super();
    
    this.serviceName = serviceName;
    this.version = options.version || '0.3.0';
    this.sampler = options.sampler || this._defaultSampler;
    this.processors = options.processors || [];
    this.activeSpans = new Map();
    this.contextStore = new Map(); // Async context storage
    
    // Sampling configuration
    this.samplingRate = options.samplingRate || 1.0;
    this.samplingPriority = options.samplingPriority || new Set();
  }

  /**
   * Start a new span.
   */
  startSpan(name, options = {}) {
    const parent = options.parent || this.getCurrentContext();
    const context = parent ? parent.child() : new TraceContext();
    
    // Check sampling
    if (!this.sampler(context, name, options)) {
      return null;
    }
    
    const span = new Span(name, context, {
      kind: options.kind,
      attributes: options.attributes
    });
    
    // Add service attributes
    span.setAttributes({
      'service.name': this.serviceName,
      'service.version': this.version
    });
    
    // Store active span
    this.activeSpans.set(context.spanId, span);
    
    span.on('end', () => {
      this.activeSpans.delete(context.spanId);
      this._processSpan(span);
    });
    
    this.emit('span:start', { span, name });
    return span;
  }

  /**
   * Start and end span around async function.
   */
  async trace(name, fn, options = {}) {
    const span = this.startSpan(name, options);
    
    if (!span) {
      return fn();
    }
    
    try {
      const result = await fn(span);
      span.setStatus(SpanStatus.OK);
      return result;
    } catch (error) {
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Set context for current async execution.
   */
  withContext(context, fn) {
    const asyncId = AsyncLocalStorage ? asyncLocalStorage.getStore() : 'default';
    this.contextStore.set(asyncId, context);
    
    try {
      return fn();
    } finally {
      this.contextStore.delete(asyncId);
    }
  }

  /**
   * Get current context.
   */
  getCurrentContext() {
    const asyncId = 'default'; // Simplified for now
    return this.contextStore.get(asyncId) || null;
  }

  /**
   * Extract context from headers.
   */
  extract(headers) {
    const traceparent = headers?.traceparent || headers?.['traceparent'];
    if (traceparent) {
      return TraceContext.fromTraceparent(traceparent);
    }
    return null;
  }

  /**
   * Inject context into headers.
   */
  inject(context, headers = {}) {
    headers.traceparent = context.toTraceparent();
    if (context.traceState) {
      headers.tracestate = context.traceState;
    }
    return headers;
  }

  /**
   * Default sampler.
   */
  _defaultSampler(context, name, options) {
    // Always sample priority spans
    if (options.priority) return true;
    
    // Sample based on rate
    return Math.random() < this.samplingRate;
  }

  /**
   * Process span through all processors.
   */
  _processSpan(span) {
    for (const processor of this.processors) {
      try {
        processor.onEnd(span);
      } catch (error) {
        console.error('[tracer] Processor error:', error.message);
      }
    }
    
    this.emit('span:end', { span });
  }

  /**
   * Add span processor.
   */
  addProcessor(processor) {
    this.processors.push(processor);
    return this;
  }

  /**
   * Force flush all processors.
   */
  async forceFlush() {
    for (const processor of this.processors) {
      if (processor.forceFlush) {
        await processor.forceFlush();
      }
    }
  }

  /**
   * Shutdown tracer.
   */
  async shutdown() {
    await this.forceFlush();
    this.emit('shutdown');
  }
}

// ============================================================================
// SPAN PROCESSORS
// ============================================================================

/**
 * Console span processor (for debugging).
 */
export class ConsoleSpanProcessor {
  constructor(options = {}) {
    this.pretty = options.pretty || true;
  }

  onEnd(span) {
    const json = span.toJSON();
    console.log('[trace]', this.pretty ? JSON.stringify(json, null, 2) : json);
  }

  async forceFlush() {}
}

/**
 * Batch span processor (for production).
 */
export class BatchSpanProcessor {
  constructor(exporter, options = {}) {
    this.exporter = exporter;
    this.maxQueueSize = options.maxQueueSize || 2048;
    this.maxBatchSize = options.maxBatchSize || 512;
    this.scheduledDelayMs = options.scheduledDelayMs || 5000;
    this.exportTimeoutMs = options.exportTimeoutMs || 30000;
    
    this.queue = [];
    this._scheduled = false;
  }

  onEnd(span) {
    if (this.queue.length >= this.maxQueueSize) {
      // Drop oldest if queue full
      this.queue.shift();
    }
    
    this.queue.push(span);
    
    if (!this._scheduled && this.queue.length >= this.maxBatchSize) {
      this._scheduleExport();
    }
  }

  _scheduleExport() {
    if (this._scheduled) return;
    
    this._scheduled = true;
    setTimeout(() => this._export(), this.scheduledDelayMs);
  }

  async _export() {
    if (this.queue.length === 0) {
      this._scheduled = false;
      return;
    }
    
    const batch = this.queue.splice(0, this.maxBatchSize);
    
    try {
      await Promise.race([
        this.exporter.export(batch),
        this._timeout(this.exportTimeoutMs)
      ]);
    } catch (error) {
      console.error('[tracer] Export failed:', error.message);
    }
    
    this._scheduled = false;
    
    // Export remaining
    if (this.queue.length > 0) {
      this._scheduleExport();
    }
  }

  _timeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), ms);
    });
  }

  async forceFlush() {
    await this._export();
  }
}

/**
 * HTTP span exporter.
 */
export class HttpSpanExporter {
  constructor(options = {}) {
    this.url = options.url || 'http://localhost:4318/v1/traces';
    this.headers = options.headers || {};
  }

  async export(spans) {
    if (spans.length === 0) return;
    
    const payload = {
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'NewZoneCore' } },
            { key: 'service.version', value: { stringValue: '0.3.0' } }
          ]
        },
        scopeSpans: [{
          scope: { name: 'nzcore' },
          spans: spans.map(s => this._spanToOtlp(s))
        }]
      }]
    };
    
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`Export failed: ${response.status}`);
    }
  }

  _spanToOtlp(span) {
    return {
      traceId: span.context.traceId,
      spanId: span.context.spanId,
      parentSpanId: span.context.parentId,
      name: span.name,
      kind: this._kindToOtlp(span.kind),
      startTimeUnixNano: span.startTime * 1_000_000,
      endTimeUnixNano: span.endTime * 1_000_000,
      attributes: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        value: this._valueToOtlp(value)
      })),
      events: span.events.map(e => ({
        timeUnixNano: e.timestamp * 1_000_000,
        name: e.name,
        attributes: Object.entries(e.attributes).map(([key, value]) => ({
          key,
          value: this._valueToOtlp(value)
        }))
      })),
      status: {
        code: span.status === SpanStatus.ERROR ? 2 : 
              span.status === SpanStatus.OK ? 1 : 0,
        message: span.statusMessage
      }
    };
  }

  _kindToOtlp(kind) {
    const kinds = {
      [SpanKind.INTERNAL]: 0,
      [SpanKind.SERVER]: 1,
      [SpanKind.CLIENT]: 2,
      [SpanKind.PRODUCER]: 3,
      [SpanKind.CONSUMER]: 4
    };
    return kinds[kind] || 0;
  }

  _valueToOtlp(value) {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') return { doubleValue: value };
    if (typeof value === 'boolean') return { boolValue: value };
    return { stringValue: String(value) };
  }
}

// ============================================================================
// GLOBAL TRACER
// ============================================================================

let globalTracer = null;

export function getTracer(options = {}) {
  if (!globalTracer) {
    globalTracer = new Tracer('NewZoneCore', options);
    
    // Add console processor in development
    if (process.env.NODE_ENV !== 'production') {
      globalTracer.addProcessor(new ConsoleSpanProcessor());
    }
  }
  return globalTracer;
}

export function createTracer(options = {}) {
  return new Tracer('NewZoneCore', options);
}

// ============================================================================
// INSTRUMENTATION HELPERS
// ============================================================================

/**
 * Instrument HTTP request.
 */
export function instrumentHttpRequest(tracer, url, options = {}) {
  return tracer.trace('HTTP', async (span) => {
    span.setAttributes({
      'http.url': url,
      'http.method': options.method || 'GET',
      'http.target': new URL(url).pathname
    });
    
    // Inject trace context into headers
    const headers = tracer.inject(tracer.getCurrentContext(), options.headers || {});
    
    const response = await fetch(url, { ...options, headers });
    
    span.setAttributes({
      'http.status_code': response.status
    });
    
    return response;
  }, { kind: SpanKind.CLIENT });
}

/**
 * Instrument async function.
 */
export function instrumentFunction(tracer, name, fn) {
  return function(...args) {
    return tracer.trace(name, async (span) => {
      span.setAttributes({
        'function.name': name,
        'function.arguments': args.length
      });
      
      const result = await fn(...args);
      
      span.setAttributes({
        'function.result': typeof result
      });
      
      return result;
    }, { kind: SpanKind.INTERNAL });
  };
}

/**
 * Create trace middleware for HTTP server.
 */
export function createTraceMiddleware(tracer) {
  return (req, res, next) => {
    // Extract incoming context
    const parent = tracer.extract(req.headers);
    
    // Create span
    const span = tracer.startSpan(`${req.method} ${req.url}`, {
      kind: SpanKind.SERVER,
      parent,
      attributes: {
        'http.method': req.method,
        'http.url': req.url,
        'http.host': req.headers.host
      }
    });
    
    if (!span) {
      return next();
    }
    
    // Store span in request
    req.span = span;
    req.traceContext = span.context;
    
    // Inject response headers
    const originalEnd = res.end;
    res.end = function(...args) {
      span.setAttributes({
        'http.status_code': res.statusCode
      });
      span.setStatus(res.statusCode < 500 ? SpanStatus.OK : SpanStatus.ERROR);
      span.end();
      
      return originalEnd.apply(res, args);
    };
    
    next();
  };
}
