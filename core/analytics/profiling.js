// Module: Performance Profiling
// Description: Performance monitoring and profiling for NewZoneCore.
//              Provides metrics, profiling, and optimization insights.
// File: core/analytics/profiling.js

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

// ============================================================================
// PERFORMANCE METRICS
// ============================================================================

export class PerformanceMetrics extends EventEmitter {
  constructor(options = {}) {
    super();

    this.samples = options.samples || 100;
    this.interval = options.interval || 5000; // 5 seconds
    this.metrics = {
      cpu: [],
      memory: [],
      eventLoop: [],
      gc: [],
      handles: []
    };
    this._timer = null;
  }

  /**
   * Start collecting metrics.
   */
  start() {
    this._timer = setInterval(() => {
      this._collectMetrics();
    }, this.interval);

    console.log('[profiling] Performance metrics collection started');
    return this;
  }

  /**
   * Stop collecting metrics.
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log('[profiling] Performance metrics collection stopped');
  }

  /**
   * Collect current metrics.
   */
  _collectMetrics() {
    const timestamp = Date.now();

    // Memory metrics
    const memUsage = process.memoryUsage();
    this.metrics.memory.push({
      timestamp,
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external
    });

    // Event loop lag (approximate)
    const start = performance.now();
    setImmediate(() => {
      const lag = performance.now() - start;
      this.metrics.eventLoop.push({ timestamp, lag });
    });

    // Active handles
    this.metrics.handles.push({
      timestamp,
      handles: process._getActiveHandles?.().length || 0,
      requests: process._getActiveRequests?.().length || 0
    });

    // Trim old samples
    this._trimSamples();

    this.emit('collected', this.getCurrent());
  }

  /**
   * Trim old samples.
   */
  _trimSamples() {
    for (const key of Object.keys(this.metrics)) {
      if (this.metrics[key].length > this.samples) {
        this.metrics[key] = this.metrics[key].slice(-this.samples);
      }
    }
  }

  /**
   * Get current metrics.
   */
  getCurrent() {
    const latest = {
      timestamp: Date.now()
    };

    for (const [key, values] of Object.entries(this.metrics)) {
      if (values.length > 0) {
        const last = values[values.length - 1];
        latest[key] = last;
        latest[`${key}Avg`] = this._calculateAverage(values.map(v => 
          typeof v === 'object' ? Object.values(v).filter(n => typeof n === 'number')[0] || 0 : v
        ));
      }
    }

    return latest;
  }

  /**
   * Calculate average.
   */
  _calculateAverage(values) {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Get all metrics history.
   */
  getHistory() {
    return this.metrics;
  }

  /**
   * Get performance summary.
   */
  getSummary() {
    const current = this.getCurrent();
    
    return {
      memory: {
        rss: current.memory?.rss || 0,
        heapUsed: current.memory?.heapUsed || 0,
        heapUtilization: current.memory?.heapUsed / current.memory?.heapTotal || 0
      },
      eventLoop: {
        lag: current.eventLoop?.lag || 0
      },
      handles: {
        active: current.handles?.handles || 0
      },
      averages: {
        memoryAvg: current.memoryAvg || 0,
        eventLoopAvg: current.eventLoopAvg || 0
      },
      timestamp: current.timestamp
    };
  }
}

// ============================================================================
// FUNCTION PROFILER
// ============================================================================

export class FunctionProfiler {
  constructor() {
    this.profiles = new Map();
    this.spans = new Map();
  }

  /**
   * Start profiling a function.
   */
  start(name, metadata = {}) {
    const id = `${name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    this.spans.set(id, {
      name,
      metadata,
      startTime: performance.now(),
      startMemory: process.memoryUsage().heapUsed
    });

    return id;
  }

  /**
   * End profiling.
   */
  end(id) {
    const span = this.spans.get(id);
    if (!span) {
      throw new Error(`Profile span not found: ${id}`);
    }

    const endTime = performance.now();
    const endMemory = process.memoryUsage().heapUsed;

    const profile = {
      name: span.name,
      metadata: span.metadata,
      duration: endTime - span.startTime,
      memoryUsed: endMemory - span.startMemory,
      startMemory: span.startMemory,
      endMemory,
      timestamp: new Date().toISOString()
    };

    // Store profile
    if (!this.profiles.has(span.name)) {
      this.profiles.set(span.name, []);
    }
    this.profiles.get(span.name).push(profile);

    this.spans.delete(id);

    return profile;
  }

  /**
   * Profile async function.
   */
  async profile(name, fn, metadata = {}) {
    const id = this.start(name, metadata);
    
    try {
      const result = await fn();
      const profile = this.end(id);
      return { result, profile };
    } catch (error) {
      this.spans.delete(id); // Clean up on error
      throw error;
    }
  }

  /**
   * Get profiles by name.
   */
  getProfiles(name) {
    return this.profiles.get(name) || [];
  }

  /**
   * Get all profiles.
   */
  getAllProfiles() {
    return Object.fromEntries(this.profiles);
  }

  /**
   * Get statistics for function.
   */
  getStats(name) {
    const profiles = this.getProfiles(name);
    
    if (profiles.length === 0) {
      return null;
    }

    const durations = profiles.map(p => p.duration);
    const memories = profiles.map(p => p.memoryUsed);

    return {
      name,
      count: profiles.length,
      duration: {
        min: Math.min(...durations),
        max: Math.max(...durations),
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        p95: this._percentile(durations, 95),
        p99: this._percentile(durations, 99)
      },
      memory: {
        min: Math.min(...memories),
        max: Math.max(...memories),
        avg: memories.reduce((a, b) => a + b, 0) / memories.length
      }
    };
  }

  /**
   * Calculate percentile.
   */
  _percentile(values, percentile) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor((percentile / 100) * sorted.length);
    return sorted[index];
  }

  /**
   * Clear profiles.
   */
  clear(name = null) {
    if (name) {
      this.profiles.delete(name);
    } else {
      this.profiles.clear();
    }
  }
}

// ============================================================================
// BOTTLENECK DETECTOR
// ============================================================================

export class BottleneckDetector extends EventEmitter {
  constructor(options = {}) {
    super();

    this.thresholds = {
      memoryUtilization: options.memoryThreshold || 0.85,
      eventLoopLag: options.lagThreshold || 100, // ms
      functionDuration: options.durationThreshold || 1000, // ms
      ...options.thresholds
    };

    this.issues = [];
  }

  /**
   * Analyze metrics for bottlenecks.
   */
  analyze(metrics, profiles) {
    const issues = [];

    // Check memory utilization
    if (metrics.memory?.heapUtilization > this.thresholds.memoryUtilization) {
      issues.push({
        type: 'high_memory',
        severity: 'warning',
        message: `High memory utilization: ${(metrics.memory.heapUtilization * 100).toFixed(1)}%`,
        value: metrics.memory.heapUtilization,
        threshold: this.thresholds.memoryUtilization
      });
    }

    // Check event loop lag
    if (metrics.eventLoop?.lag > this.thresholds.eventLoopLag) {
      issues.push({
        type: 'event_loop_lag',
        severity: 'warning',
        message: `High event loop lag: ${metrics.eventLoop.lag.toFixed(2)}ms`,
        value: metrics.eventLoop.lag,
        threshold: this.thresholds.eventLoopLag
      });
    }

    // Check function durations
    for (const [name, profileList] of Object.entries(profiles)) {
      const lastProfile = profileList[profileList.length - 1];
      if (lastProfile && lastProfile.duration > this.thresholds.functionDuration) {
        issues.push({
          type: 'slow_function',
          severity: 'info',
          function: name,
          message: `Slow function: ${name} took ${lastProfile.duration.toFixed(2)}ms`,
          value: lastProfile.duration,
          threshold: this.thresholds.functionDuration
        });
      }
    }

    this.issues = issues;
    this.emit('analyzed', { issues });

    if (issues.length > 0) {
      console.warn('[profiling] Bottlenecks detected:', issues.length);
    }

    return { issues, timestamp: new Date().toISOString() };
  }

  /**
   * Get current issues.
   */
  getIssues() {
    return this.issues;
  }

  /**
   * Clear issues.
   */
  clearIssues() {
    this.issues = [];
  }
}

// ============================================================================
// PROFILER MANAGER
// ============================================================================

export class ProfilerManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.metrics = new PerformanceMetrics(options.metrics);
    this.profiler = new FunctionProfiler();
    this.detector = new BottleneckDetector(options.detector);
    
    this.enabled = false;
  }

  /**
   * Start profiling.
   */
  start() {
    if (this.enabled) {
      return;
    }

    this.enabled = true;
    this.metrics.start();

    // Periodic analysis
    this._analysisTimer = setInterval(() => {
      this._runAnalysis();
    }, 30000); // Every 30 seconds

    console.log('[profiling] Profiler started');
    return this;
  }

  /**
   * Stop profiling.
   */
  stop() {
    if (!this.enabled) {
      return;
    }

    this.enabled = false;
    this.metrics.stop();

    if (this._analysisTimer) {
      clearInterval(this._analysisTimer);
    }

    console.log('[profiling] Profiler stopped');
  }

  /**
   * Run analysis.
   */
  _runAnalysis() {
    const metrics = this.metrics.getCurrent();
    const profiles = this.profiler.getAllProfiles();
    
    const result = this.detector.analyze(metrics, profiles);
    
    if (result.issues.length > 0) {
      this.emit('bottleneck', result);
    }
  }

  /**
   * Profile function.
   */
  async profile(name, fn, metadata = {}) {
    return this.profiler.profile(name, fn, metadata);
  }

  /**
   * Get profiling status.
   */
  getStatus() {
    return {
      enabled: this.enabled,
      metrics: this.metrics.getSummary(),
      issues: this.detector.getIssues()
    };
  }

  /**
   * Get detailed stats.
   */
  getStats() {
    return {
      metrics: this.metrics.getSummary(),
      profiles: this.profiler.getAllProfiles(),
      issues: this.detector.getIssues()
    };
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalProfiler = null;

export function getProfiler(options = {}) {
  if (!globalProfiler) {
    globalProfiler = new ProfilerManager(options);
  }
  return globalProfiler;
}

export function createProfiler(options = {}) {
  return new ProfilerManager(options);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  PerformanceMetrics,
  FunctionProfiler,
  BottleneckDetector,
  ProfilerManager,
  getProfiler,
  createProfiler
};
