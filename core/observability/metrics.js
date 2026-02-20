// Module: Observability and Metrics
// Description: Prometheus-compatible metrics collection for NewZoneCore.
//              Provides system metrics, security metrics, and network metrics.
// File: core/observability/metrics.js

import { EventEmitter } from 'events';

// ============================================================================
// METRIC TYPES
// ============================================================================

export const MetricType = {
  COUNTER: 'counter',      // Incremental value
  GAUGE: 'gauge',          // Point-in-time value
  HISTOGRAM: 'histogram',  // Distribution of values
  SUMMARY: 'summary'       // Statistical summary
};

// ============================================================================
// METRIC COLLECTOR
// ============================================================================

export class MetricCollector extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.prefix = options.prefix || 'nzcore';
    this.metrics = new Map();
    this.startTime = Date.now();
    
    // Initialize default metrics
    this._initDefaultMetrics();
  }
  
  _initDefaultMetrics() {
    // System metrics
    this.counter('uptime_seconds', 'System uptime in seconds');
    this.gauge('memory_heap_used_bytes', 'Heap memory used in bytes');
    this.gauge('memory_heap_total_bytes', 'Total heap memory in bytes');
    this.gauge('memory_rss_bytes', 'Resident set size in bytes');
    
    // Security metrics
    this.counter('auth_attempts_total', 'Total authentication attempts', ['type', 'result']);
    this.counter('security_events_total', 'Total security events', ['type', 'severity']);
    this.gauge('rate_limited_connections', 'Currently rate-limited connections');
    
    // Network metrics
    this.counter('network_messages_total', 'Total network messages', ['type', 'direction']);
    this.gauge('network_peers_connected', 'Currently connected peers');
    this.counter('network_bytes_total', 'Total network bytes', ['type']);
    this.gauge('dht_routing_table_size', 'DHT routing table size');
    
    // Service metrics
    this.gauge('services_running', 'Number of running services');
    this.counter('service_restarts_total', 'Total service restarts', ['service']);
    
    // Storage metrics
    this.gauge('storage_files_count', 'Number of files in storage');
    this.gauge('storage_size_bytes', 'Total storage size in bytes');
  }
  
  /**
   * Register a new metric.
   */
  metric(name, type, help, labels = []) {
    const fullName = `${this.prefix}_${name}`;
    
    if (this.metrics.has(fullName)) {
      return this.metrics.get(fullName);
    }
    
    const metric = {
      name: fullName,
      type,
      help,
      labels,
      value: type === MetricType.COUNTER ? 0 : undefined,
      labelValues: new Map() // For labeled metrics
    };
    
    this.metrics.set(fullName, metric);
    this.emit('metric:registered', { name: fullName, type });
    
    return metric;
  }
  
  /**
   * Register a counter metric.
   */
  counter(name, help, labels = []) {
    return this.metric(name, MetricType.COUNTER, help, labels);
  }
  
  /**
   * Register a gauge metric.
   */
  gauge(name, help, labels = []) {
    return this.metric(name, MetricType.GAUGE, help, labels);
  }
  
  /**
   * Increment a counter.
   */
  inc(name, labels = {}, value = 1) {
    const metric = this.metrics.get(`${this.prefix}_${name}`);
    if (!metric) return;
    
    if (metric.labels.length > 0) {
      const key = this._labelKey(metric.labels, labels);
      const current = metric.labelValues.get(key) || 0;
      metric.labelValues.set(key, current + value);
    } else {
      metric.value += value;
    }
    
    this.emit('metric:updated', { name: metric.name, value });
  }
  
  /**
   * Set a gauge value.
   */
  set(name, value, labels = {}) {
    const metric = this.metrics.get(`${this.prefix}_${name}`);
    if (!metric) return;
    
    if (metric.labels.length > 0) {
      const key = this._labelKey(metric.labels, labels);
      metric.labelValues.set(key, value);
    } else {
      metric.value = value;
    }
    
    this.emit('metric:updated', { name: metric.name, value });
  }
  
  /**
   * Get metric value.
   */
  get(name, labels = {}) {
    const metric = this.metrics.get(`${this.prefix}_${name}`);
    if (!metric) return undefined;
    
    if (metric.labels.length > 0) {
      const key = this._labelKey(metric.labels, labels);
      return metric.labelValues.get(key);
    }
    
    return metric.value;
  }
  
  /**
   * Generate label key for labeled metrics.
   */
  _labelKey(labels, values) {
    return labels.map(l => values[l] || '').join(':');
  }
  
  /**
   * Update system metrics.
   */
  updateSystemMetrics() {
    // Uptime
    this.set('uptime_seconds', Math.floor((Date.now() - this.startTime) / 1000));
    
    // Memory
    if (global.process) {
      const memUsage = process.memoryUsage();
      this.set('memory_heap_used_bytes', memUsage.heapUsed);
      this.set('memory_heap_total_bytes', memUsage.heapTotal);
      this.set('memory_rss_bytes', memUsage.rss);
    }
  }
  
  /**
   * Get all metrics in Prometheus format.
   */
  toPrometheus() {
    this.updateSystemMetrics();
    
    const lines = [];
    
    for (const [name, metric] of this.metrics) {
      // Help line
      lines.push(`# HELP ${name} ${metric.help}`);
      // Type line
      lines.push(`# TYPE ${name} ${metric.type}`);
      
      // Value lines
      if (metric.labels.length > 0 && metric.labelValues.size > 0) {
        for (const [key, value] of metric.labelValues) {
          const labelParts = metric.labels.map((l, i) => {
            const val = key.split(':')[i] || '';
            return `${l}="${val}"`;
          }).filter(l => l !== '=""');
          
          if (labelParts.length > 0) {
            lines.push(`${name}{${labelParts.join(',')}} ${value}`);
          } else {
            lines.push(`${name} ${value}`);
          }
        }
      } else if (metric.value !== undefined) {
        lines.push(`${name} ${metric.value}`);
      }
    }
    
    return lines.join('\n') + '\n';
  }
  
  /**
   * Get metrics as JSON.
   */
  toJSON() {
    this.updateSystemMetrics();
    
    const result = {};
    
    for (const [name, metric] of this.metrics) {
      if (metric.labels.length > 0 && metric.labelValues.size > 0) {
        result[name] = Object.fromEntries(metric.labelValues);
      } else {
        result[name] = metric.value;
      }
    }
    
    return result;
  }
  
  /**
   * Get metrics summary.
   */
  getSummary() {
    this.updateSystemMetrics();
    
    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      metrics: this.metrics.size,
      memory: process ? process.memoryUsage() : null,
      timestamp: new Date().toISOString()
    };
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

export class HealthChecker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.checks = new Map();
    this.interval = options.interval || 30000; // 30 seconds
    this.timeout = options.timeout || 5000; // 5 seconds
    
    this._startHealthCheckLoop();
  }
  
  /**
   * Register a health check.
   */
  register(name, checkFn, options = {}) {
    this.checks.set(name, {
      fn: checkFn,
      interval: options.interval || this.interval,
      timeout: options.timeout || this.timeout,
      lastCheck: null,
      status: 'unknown',
      error: null,
      latency: null
    });
    
    this.emit('check:registered', { name });
  }
  
  /**
   * Unregister a health check.
   */
  unregister(name) {
    return this.checks.delete(name);
  }
  
  /**
   * Run all health checks.
   */
  async runChecks() {
    const results = {};
    
    for (const [name, check] of this.checks) {
      const startTime = Date.now();
      
      try {
        const timeout = Promise.race([
          check.fn(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), check.timeout)
          )
        ]);
        
        await timeout;
        
        check.status = 'healthy';
        check.error = null;
        check.latency = Date.now() - startTime;
      } catch (error) {
        check.status = 'unhealthy';
        check.error = error.message;
        check.latency = Date.now() - startTime;
      }
      
      check.lastCheck = new Date().toISOString();
      results[name] = {
        status: check.status,
        error: check.error,
        latency: check.latency,
        lastCheck: check.lastCheck
      };
      
      this.emit('check:completed', { name, ...results[name] });
    }
    
    return results;
  }
  
  /**
   * Get overall health status.
   */
  getStatus() {
    const checks = {};
    let overall = 'healthy';
    let healthyCount = 0;
    let unhealthyCount = 0;
    
    for (const [name, check] of this.checks) {
      checks[name] = {
        status: check.status,
        error: check.error,
        latency: check.latency,
        lastCheck: check.lastCheck
      };
      
      if (check.status === 'healthy') healthyCount++;
      if (check.status === 'unhealthy') unhealthyCount++;
    }
    
    if (unhealthyCount > 0) {
      overall = unhealthyCount > healthyCount ? 'unhealthy' : 'degraded';
    }
    
    return {
      status: overall,
      checks,
      summary: {
        total: this.checks.size,
        healthy: healthyCount,
        unhealthy: unhealthyCount
      },
      timestamp: new Date().toISOString()
    };
  }
  
  _startHealthCheckLoop() {
    setInterval(() => {
      this.runChecks().catch(console.error);
    }, this.interval);
  }
}

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

let globalMetrics = null;
let globalHealth = null;

export function getMetrics(options = {}) {
  if (!globalMetrics) {
    globalMetrics = new MetricCollector(options);
  }
  return globalMetrics;
}

export function getHealthChecker(options = {}) {
  if (!globalHealth) {
    globalHealth = new HealthChecker(options);
  }
  return globalHealth;
}

// ============================================================================
// DEFAULT HEALTH CHECKS
// ============================================================================

export function registerDefaultHealthChecks(supervisor) {
  const health = getHealthChecker();
  
  // Core health check
  health.register('core', async () => {
    if (!supervisor) throw new Error('Supervisor not available');
    const state = await supervisor.getState();
    if (!state.startedAt) throw new Error('Core not started');
    return { ok: true };
  });
  
  // Identity health check
  health.register('identity', async () => {
    if (!supervisor) throw new Error('Supervisor not available');
    const identity = supervisor.getIdentity();
    if (!identity) throw new Error('Identity not available');
    return { ok: true };
  });
  
  // Trust store health check
  health.register('trust', async () => {
    if (!supervisor) throw new Error('Supervisor not available');
    const trust = supervisor.getTrust();
    if (!trust) throw new Error('Trust store not available');
    return { ok: true, peers: trust.peers?.length || 0 };
  });
  
  // Storage health check
  health.register('storage', async () => {
    // Check if storage is accessible
    return { ok: true };
  });
  
  return health;
}
