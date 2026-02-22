// Module: Anomaly Detection
// Description: Machine learning-based anomaly detection for NewZoneCore.
//              Detects unusual patterns in security, performance, and behavior.
// File: core/ml/anomaly.js

import { EventEmitter } from 'events';

// ============================================================================
// STATISTICAL ANOMALY DETECTOR
// ============================================================================

export class StatisticalAnomalyDetector extends EventEmitter {
  constructor(options = {}) {
    super();

    this.sensitivity = options.sensitivity || 3; // Standard deviations
    this.minSamples = options.minSamples || 30;
    this.windowSize = options.windowSize || 1000;
    
    this.baselines = new Map(); // metric -> { mean, stddev, samples }
    this.anomalies = [];
  }

  /**
   * Record metric value.
   */
  record(metric, value) {
    if (!this.baselines.has(metric)) {
      this.baselines.set(metric, {
        values: [],
        mean: 0,
        stddev: 0,
        updatedAt: Date.now()
      });
    }

    const baseline = this.baselines.get(metric);
    baseline.values.push(value);

    // Keep window size
    if (baseline.values.length > this.windowSize) {
      baseline.values.shift();
    }

    // Update statistics
    if (baseline.values.length >= this.minSamples) {
      this._updateStatistics(baseline);
      
      // Check for anomaly
      const zScore = this._calculateZScore(value, baseline.mean, baseline.stddev);
      
      if (Math.abs(zScore) > this.sensitivity) {
        const anomaly = {
          type: 'statistical',
          metric,
          value,
          zScore,
          mean: baseline.mean,
          stddev: baseline.stddev,
          severity: this._calculateSeverity(zScore),
          timestamp: new Date().toISOString()
        };
        
        this.anomalies.push(anomaly);
        this.emit('anomaly', anomaly);
        
        return anomaly;
      }
    }

    return null;
  }

  /**
   * Update baseline statistics.
   */
  _updateStatistics(baseline) {
    const values = baseline.values;
    const n = values.length;
    
    // Calculate mean
    baseline.mean = values.reduce((a, b) => a + b, 0) / n;
    
    // Calculate standard deviation
    const squaredDiffs = values.map(v => Math.pow(v - baseline.mean, 2));
    baseline.stddev = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / n);
    
    baseline.updatedAt = Date.now();
  }

  /**
   * Calculate Z-score.
   */
  _calculateZScore(value, mean, stddev) {
    if (stddev === 0) return 0;
    return (value - mean) / stddev;
  }

  /**
   * Calculate severity based on Z-score.
   */
  _calculateSeverity(zScore) {
    const absZ = Math.abs(zScore);
    if (absZ > 5) return 'critical';
    if (absZ > 4) return 'high';
    if (absZ > 3) return 'medium';
    return 'low';
  }

  /**
   * Get baseline for metric.
   */
  getBaseline(metric) {
    const baseline = this.baselines.get(metric);
    if (!baseline) return null;
    
    return {
      metric,
      mean: baseline.mean,
      stddev: baseline.stddev,
      samples: baseline.values.length,
      updatedAt: baseline.updatedAt
    };
  }

  /**
   * Get all baselines.
   */
  getBaselines() {
    const result = {};
    for (const [metric, baseline] of this.baselines) {
      result[metric] = this.getBaseline(metric);
    }
    return result;
  }

  /**
   * Get recent anomalies.
   */
  getAnomalies(limit = 100, since = null) {
    let anomalies = this.anomalies;
    
    if (since) {
      const sinceTime = new Date(since).getTime();
      anomalies = anomalies.filter(a => new Date(a.timestamp).getTime() > sinceTime);
    }
    
    return anomalies.slice(-limit);
  }

  /**
   * Clear anomalies.
   */
  clearAnomalies() {
    this.anomalies = [];
  }

  /**
   * Reset baseline for metric.
   */
  resetBaseline(metric) {
    this.baselines.delete(metric);
  }

  /**
   * Get detector status.
   */
  getStatus() {
    return {
      metrics: this.baselines.size,
      anomaliesDetected: this.anomalies.length,
      sensitivity: this.sensitivity,
      minSamples: this.minSamples
    };
  }
}

// ============================================================================
// ISOLATION FOREST (Simplified)
// ============================================================================

export class IsolationForest {
  constructor(options = {}) {
    this.numTrees = options.numTrees || 100;
    this.sampleSize = options.sampleSize || 256;
    this.threshold = options.threshold || 0.6;
    
    this.trees = [];
    this.trained = false;
  }

  /**
   * Train isolation forest.
   */
  train(data) {
    this.trees = [];
    
    for (let i = 0; i < this.numTrees; i++) {
      const sample = this._bootstrapSample(data);
      const tree = this._buildTree(sample);
      this.trees.push(tree);
    }
    
    this.trained = true;
    return this;
  }

  /**
   * Create bootstrap sample.
   */
  _bootstrapSample(data) {
    const sample = [];
    for (let i = 0; i < Math.min(this.sampleSize, data.length); i++) {
      sample.push(data[Math.floor(Math.random() * data.length)]);
    }
    return sample;
  }

  /**
   * Build isolation tree.
   */
  _buildTree(data, height = 0, maxHeight = Math.ceil(Math.log2(this.sampleSize))) {
    if (height >= maxHeight || data.length <= 1) {
      return { type: 'leaf', size: data.length };
    }

    // Select random feature
    const features = Object.keys(data[0] || {});
    const feature = features[Math.floor(Math.random() * features.length)];
    
    // Select random split value
    const values = data.map(d => d[feature]).filter(v => typeof v === 'number');
    if (values.length === 0) {
      return { type: 'leaf', size: data.length };
    }
    
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const splitValue = minVal + Math.random() * (maxVal - minVal);

    // Split data
    const left = data.filter(d => (d[feature] || 0) < splitValue);
    const right = data.filter(d => (d[feature] || 0) >= splitValue);

    return {
      type: 'node',
      feature,
      splitValue,
      left: this._buildTree(left, height + 1, maxHeight),
      right: this._buildTree(right, height + 1, maxHeight)
    };
  }

  /**
   * Calculate anomaly score.
   */
  score(point) {
    if (!this.trained) {
      throw new Error('Model not trained');
    }

    const avgPathLength = this.trees.reduce((sum, tree) => {
      return sum + this._pathLength(point, tree, 0);
    }, 0) / this.trees.length;

    const n = this.sampleSize;
    const c = 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n;
    
    return Math.pow(2, -avgPathLength / c);
  }

  /**
   * Calculate path length in tree.
   */
  _pathLength(point, node, height) {
    if (node.type === 'leaf') {
      return height + this._c(node.size);
    }

    const value = point[node.feature] || 0;
    if (value < node.splitValue) {
      return this._pathLength(point, node.left, height + 1);
    } else {
      return this._pathLength(point, node.right, height + 1);
    }
  }

  /**
   * Average path length adjustment.
   */
  _c(n) {
    if (n <= 1) return 0;
    return 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n;
  }

  /**
   * Predict if point is anomaly.
   */
  predict(point) {
    const score = this.score(point);
    return {
      isAnomaly: score > this.threshold,
      score,
      threshold: this.threshold
    };
  }
}

// ============================================================================
// SECURITY ANOMALY DETECTOR
// ============================================================================

export class SecurityAnomalyDetector extends EventEmitter {
  constructor(options = {}) {
    super();

    this.statsDetector = new StatisticalAnomalyDetector(options);
    this.isolationForest = new IsolationForest(options);
    
    this.events = [];
    this.maxEvents = options.maxEvents || 10000;
    this.trained = false;
    
    // Connect statistical anomalies
    this.statsDetector.on('anomaly', (anomaly) => {
      this.emit('security_anomaly', {
        ...anomaly,
        category: 'security'
      });
    });
  }

  /**
   * Record security event.
   */
  recordEvent(event) {
    const enrichedEvent = {
      ...event,
      timestamp: event.timestamp || Date.now()
    };

    this.events.push(enrichedEvent);
    
    // Keep max events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // Record metrics for statistical analysis
    this._recordMetrics(enrichedEvent);

    // Check for anomalies if trained
    if (this.trained) {
      this._checkAnomalies(enrichedEvent);
    }

    return enrichedEvent;
  }

  /**
   * Record metrics from event.
   */
  _recordMetrics(event) {
    // Login attempts per IP
    if (event.type === 'auth:login:failed') {
      this.statsDetector.record('auth_failures_per_minute', 1);
    }

    // Request rate
    if (event.type?.startsWith('http:')) {
      this.statsDetector.record('requests_per_second', 1);
    }

    // Data transfer
    if (event.bytes) {
      this.statsDetector.record('bytes_transferred', event.bytes);
    }
  }

  /**
   * Check for anomalies.
   */
  _checkAnomalies(event) {
    // Use isolation forest for multivariate anomaly detection
    const features = this._extractFeatures(event);
    const result = this.isolationForest.predict(features);

    if (result.isAnomaly) {
      this.emit('security_anomaly', {
        type: 'multivariate',
        event,
        score: result.score,
        severity: this._calculateSeverity(result.score),
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Extract features from event.
   */
  _extractFeatures(event) {
    return {
      hour: new Date(event.timestamp).getHours(),
      eventType: this._hashEvent(event.type),
      sourceIp: this._hashIp(event.ip || '0.0.0.0'),
      bytes: event.bytes || 0,
      duration: event.duration || 0
    };
  }

  /**
   * Simple hash for categorical features.
   */
  _hashEvent(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) / 2147483648;
  }

  /**
   * Hash IP address.
   */
  _hashIp(ip) {
    return ip.split('.').reduce((acc, octet) => acc + parseInt(octet), 0) / 1020;
  }

  /**
   * Calculate severity.
   */
  _calculateSeverity(score) {
    if (score > 0.8) return 'critical';
    if (score > 0.7) return 'high';
    if (score > 0.6) return 'medium';
    return 'low';
  }

  /**
   * Train the model.
   */
  train() {
    if (this.events.length < 100) {
      console.warn('[ml] Not enough events for training');
      return false;
    }

    const features = this.events.map(e => this._extractFeatures(e));
    this.isolationForest.train(features);
    this.trained = true;

    console.log(`[ml] Security anomaly detector trained on ${this.events.length} events`);
    return true;
  }

  /**
   * Get detector status.
   */
  getStatus() {
    return {
      eventsRecorded: this.events.length,
      trained: this.trained,
      statisticalBaseline: this.statsDetector.getStatus(),
      isolationForest: {
        trees: this.isolationForest.trees.length,
        threshold: this.isolationForest.threshold
      }
    };
  }
}

// ============================================================================
// ANOMALY MANAGER
// ============================================================================

export class AnomalyManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.statisticalDetector = new StatisticalAnomalyDetector(options);
    this.securityDetector = new SecurityAnomalyDetector(options);
    
    this.detectors = new Map();
    this.alerts = [];
    this.maxAlerts = options.maxAlerts || 1000;
  }

  /**
   * Register custom detector.
   */
  registerDetector(name, detectorFn) {
    const detector = detectorFn();
    this.detectors.set(name, detector);
    
    detector.on('anomaly', (anomaly) => {
      this._handleAnomaly(name, anomaly);
    });
    
    console.log(`[ml] Registered detector: ${name}`);
  }

  /**
   * Handle anomaly from any detector.
   */
  _handleAnomaly(source, anomaly) {
    const alert = {
      source,
      ...anomaly,
      acknowledged: false,
      createdAt: new Date().toISOString()
    };

    this.alerts.push(alert);
    
    // Keep max alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts.shift();
    }

    this.emit('alert', alert);
  }

  /**
   * Record metric.
   */
  record(metric, value) {
    return this.statisticalDetector.record(metric, value);
  }

  /**
   * Record security event.
   */
  recordSecurityEvent(event) {
    return this.securityDetector.recordEvent(event);
  }

  /**
   * Train all detectors.
   */
  train() {
    const results = {
      security: this.securityDetector.train()
    };

    for (const [name, detector] of this.detectors) {
      if (detector.train) {
        results[name] = detector.train();
      }
    }

    return results;
  }

  /**
   * Get alerts.
   */
  getAlerts(limit = 100, filters = {}) {
    let alerts = this.alerts;

    if (filters.source) {
      alerts = alerts.filter(a => a.source === filters.source);
    }

    if (filters.severity) {
      alerts = alerts.filter(a => a.severity === filters.severity);
    }

    if (filters.acknowledged !== undefined) {
      alerts = alerts.filter(a => a.acknowledged === filters.acknowledged);
    }

    return alerts.slice(-limit);
  }

  /**
   * Acknowledge alert.
   */
  acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * Get manager status.
   */
  getStatus() {
    return {
      detectors: this.detectors.size,
      alerts: this.alerts.length,
      unacknowledged: this.alerts.filter(a => !a.acknowledged).length,
      statistical: this.statisticalDetector.getStatus(),
      security: this.securityDetector.getStatus()
    };
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalAnomalyManager = null;

export function getAnomalyManager(options = {}) {
  if (!globalAnomalyManager) {
    globalAnomalyManager = new AnomalyManager(options);
  }
  return globalAnomalyManager;
}

export function createAnomalyManager(options = {}) {
  return new AnomalyManager(options);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  StatisticalAnomalyDetector,
  IsolationForest,
  SecurityAnomalyDetector,
  AnomalyManager,
  getAnomalyManager,
  createAnomalyManager
};
