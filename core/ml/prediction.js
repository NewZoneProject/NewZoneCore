// Module: Predictive Failure Analysis
// Description: Predict system failures before they occur using ML.
//              Analyzes patterns leading to failures.
// File: core/ml/prediction.js

import { EventEmitter } from 'events';

// ============================================================================
// FAILURE PREDICTOR
// ============================================================================

export class FailurePredictor extends EventEmitter {
  constructor(options = {}) {
    super();

    this.metrics = new Map(); // metric -> values[]
    this.failures = []; // Historical failures
    this.thresholds = options.thresholds || {};
    this.windowSize = options.windowSize || 500;
    this.predictionWindow = options.predictionWindow || 3600000; // 1 hour
    
    this.weights = {
      trend: 0.3,
      volatility: 0.25,
      threshold: 0.25,
      correlation: 0.2
    };
  }

  /**
   * Record metric value.
   */
  record(metric, value, timestamp = Date.now()) {
    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }

    const values = this.metrics.get(metric);
    values.push({ value, timestamp });

    // Keep window size
    if (values.length > this.windowSize) {
      values.shift();
    }

    // Check for potential failure
    const prediction = this._predict(metric);
    
    if (prediction.risk > 0.7) {
      this.emit('failure_warning', {
        metric,
        ...prediction,
        timestamp: new Date().toISOString()
      });
    }

    return prediction;
  }

  /**
   * Record failure event.
   */
  recordFailure(metric, timestamp = Date.now()) {
    this.failures.push({ metric, timestamp });
    
    // Keep last 100 failures
    if (this.failures.length > 100) {
      this.failures.shift();
    }

    // Analyze pre-failure patterns
    this._analyzePreFailurePatterns(metric, timestamp);
  }

  /**
   * Predict failure probability.
   */
  _predict(metric) {
    const values = this.metrics.get(metric);
    
    if (!values || values.length < 50) {
      return { risk: 0, confidence: 0, reasons: [] };
    }

    const reasons = [];
    let risk = 0;

    // Trend analysis
    const trend = this._calculateTrend(values);
    if (trend > 0.5) {
      risk += this.weights.trend * 100;
      reasons.push('increasing_trend');
    }

    // Volatility analysis
    const volatility = this._calculateVolatility(values);
    if (volatility > 0.3) {
      risk += this.weights.volatility * 100;
      reasons.push('high_volatility');
    }

    // Threshold analysis
    const threshold = this.thresholds[metric] || this._getDynamicThreshold(values);
    const currentValue = values[values.length - 1].value;
    const thresholdRatio = currentValue / threshold;
    
    if (thresholdRatio > 0.9) {
      risk += this.weights.threshold * 100 * thresholdRatio;
      reasons.push('approaching_threshold');
    }

    // Correlation with other metrics
    const correlatedRisk = this._checkCorrelations(metric);
    if (correlatedRisk > 0.5) {
      risk += this.weights.correlation * 100 * correlatedRisk;
      reasons.push('correlated_failures');
    }

    return {
      risk: Math.min(100, risk),
      confidence: this._calculateConfidence(values),
      reasons,
      trend,
      volatility,
      threshold,
      currentValue,
      estimatedTimeToFailure: this._estimateTimeToFailure(metric, trend)
    };
  }

  /**
   * Calculate trend.
   */
  _calculateTrend(values) {
    const n = values.length;
    const half = Math.floor(n / 2);
    
    const firstHalf = values.slice(0, half).reduce((a, b) => a + b.value, 0) / half;
    const secondHalf = values.slice(half).reduce((a, b) => a + b.value, 0) / (n - half);
    
    if (firstHalf === 0) return 0;
    return (secondHalf - firstHalf) / firstHalf;
  }

  /**
   * Calculate volatility.
   */
  _calculateVolatility(values) {
    const mean = values.reduce((a, b) => a + b.value, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v.value - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    const stddev = Math.sqrt(variance);
    
    return mean > 0 ? stddev / mean : 0;
  }

  /**
   * Get dynamic threshold.
   */
  _getDynamicThreshold(values) {
    const sorted = [...values].sort((a, b) => a.value - b.value);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    return p95 ? p95.value * 1.2 : 100;
  }

  /**
   * Check correlations with other metrics.
   */
  _checkCorrelations(targetMetric) {
    let maxCorrelation = 0;
    
    for (const [metric, values] of this.metrics) {
      if (metric === targetMetric) continue;
      
      const targetValues = this.metrics.get(targetMetric);
      if (!targetValues || targetValues.length !== values.length) continue;
      
      const correlation = this._calculateCorrelation(
        targetValues.map(v => v.value),
        values.map(v => v.value)
      );
      
      if (Math.abs(correlation) > maxCorrelation) {
        maxCorrelation = Math.abs(correlation);
      }
    }
    
    return maxCorrelation;
  }

  /**
   * Calculate correlation coefficient.
   */
  _calculateCorrelation(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 10) return 0;
    
    const xSlice = x.slice(-n);
    const ySlice = y.slice(-n);
    
    const xMean = xSlice.reduce((a, b) => a + b, 0) / n;
    const yMean = ySlice.reduce((a, b) => a + b, 0) / n;
    
    let numerator = 0;
    let xVar = 0;
    let yVar = 0;
    
    for (let i = 0; i < n; i++) {
      const xDiff = xSlice[i] - xMean;
      const yDiff = ySlice[i] - yMean;
      numerator += xDiff * yDiff;
      xVar += xDiff * xDiff;
      yVar += yDiff * yDiff;
    }
    
    const denominator = Math.sqrt(xVar * yVar);
    return denominator > 0 ? numerator / denominator : 0;
  }

  /**
   * Calculate prediction confidence.
   */
  _calculateConfidence(values) {
    const dataQuality = Math.min(1, values.length / this.windowSize);
    const recentData = values.filter(v => Date.now() - v.timestamp < 3600000).length;
    const recencyQuality = Math.min(1, recentData / 10);
    
    return (dataQuality + recencyQuality) / 2;
  }

  /**
   * Estimate time to failure.
   */
  _estimateTimeToFailure(metric, trend) {
    if (trend <= 0) return null;
    
    const threshold = this.thresholds[metric] || 100;
    const values = this.metrics.get(metric);
    const currentValue = values[values.length - 1].value;
    
    const remaining = threshold - currentValue;
    const ratePerMs = (currentValue * trend) / this.windowSize;
    
    if (ratePerMs <= 0) return null;
    
    return remaining / ratePerMs;
  }

  /**
   * Analyze pre-failure patterns.
   */
  _analyzePreFailurePatterns(metric, failureTime) {
    const values = this.metrics.get(metric);
    if (!values) return;
    
    const preFailureWindow = 3600000; // 1 hour before failure
    const preFailureValues = values.filter(
      v => v.timestamp >= failureTime - preFailureWindow && v.timestamp < failureTime
    );
    
    if (preFailureValues.length < 10) return;
    
    // Analyze patterns
    const pattern = {
      metric,
      avgValue: preFailureValues.reduce((a, b) => a + b.value, 0) / preFailureValues.length,
      trend: this._calculateTrend(preFailureValues),
      volatility: this._calculateVolatility(preFailureValues)
    };
    
    this.emit('pattern_learned', { metric, pattern });
  }

  /**
   * Set threshold for metric.
   */
  setThreshold(metric, threshold) {
    this.thresholds[metric] = threshold;
  }

  /**
   * Get predictions for all metrics.
   */
  getPredictions() {
    const predictions = {};
    
    for (const metric of this.metrics.keys()) {
      predictions[metric] = this._predict(metric);
    }
    
    return predictions;
  }

  /**
   * Get high-risk metrics.
   */
  getHighRiskMetrics(threshold = 0.7) {
    const highRisk = [];
    
    for (const [metric, prediction] of Object.entries(this.getPredictions())) {
      if (prediction.risk >= threshold * 100) {
        highRisk.push({ metric, ...prediction });
      }
    }
    
    return highRisk.sort((a, b) => b.risk - a.risk);
  }

  /**
   * Get predictor status.
   */
  getStatus() {
    return {
      metrics: this.metrics.size,
      failures: this.failures.length,
      thresholds: Object.keys(this.thresholds).length
    };
  }
}

// ============================================================================
// CAPACITY PLANNER
// ============================================================================

export class CapacityPlanner extends EventEmitter {
  constructor(options = {}) {
    super();

    this.resources = new Map(); // resource -> { history[], capacity }
    this.growthRates = new Map();
    this.options = options;
  }

  /**
   * Record resource usage.
   */
  record(resource, usage, capacity) {
    if (!this.resources.has(resource)) {
      this.resources.set(resource, {
        history: [],
        capacity
      });
    }

    const data = this.resources.get(resource);
    data.history.push({
      usage,
      capacity,
      utilization: usage / capacity,
      timestamp: Date.now()
    });

    // Keep last 1000 data points
    if (data.history.length > 1000) {
      data.history.shift();
    }

    // Update growth rate
    this._updateGrowthRate(resource);

    // Check for capacity warning
    if (usage / capacity > 0.8) {
      this.emit('capacity_warning', {
        resource,
        usage,
        capacity,
        utilization: usage / capacity,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Update growth rate.
   */
  _updateGrowthRate(resource) {
    const data = this.resources.get(resource);
    if (data.history.length < 100) return;

    const recent = data.history.slice(-30);
    const older = data.history.slice(-60, -30);

    const recentAvg = recent.reduce((a, b) => a + b.utilization, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b.utilization, 0) / older.length;

    const growthRate = olderAvg > 0 ? (recentAvg - olderAvg) / olderAvg : 0;
    this.growthRates.set(resource, growthRate);
  }

  /**
   * Predict when capacity will be reached.
   */
  predictExhaustion(resource, threshold = 0.95) {
    const data = this.resources.get(resource);
    if (!data || data.history.length < 100) return null;

    const growthRate = this.growthRates.get(resource) || 0;
    if (growthRate <= 0) return null;

    const current = data.history[data.history.length - 1];
    const remaining = threshold - current.utilization;
    
    // Time per data point (assume 1 minute)
    const timePerPoint = 60000;
    const pointsToExhaustion = remaining / (growthRate * current.utilization);
    
    return {
      resource,
      currentUtilization: current.utilization,
      threshold,
      estimatedTimeMs: pointsToExhaustion * timePerPoint,
      estimatedDate: new Date(Date.now() + pointsToExhaustion * timePerPoint).toISOString(),
      growthRate
    };
  }

  /**
   * Get recommendations.
   */
  getRecommendations() {
    const recommendations = [];

    for (const [resource, data] of this.resources) {
      const current = data.history[data.history.length - 1];
      const prediction = this.predictExhaustion(resource);

      if (current.utilization > 0.8) {
        recommendations.push({
          resource,
          type: 'high_utilization',
          priority: 'high',
          message: `${resource} utilization is ${(current.utilization * 100).toFixed(1)}%`,
          action: 'Consider scaling up or optimizing usage'
        });
      }

      if (prediction) {
        recommendations.push({
          resource,
          type: 'capacity_exhaustion',
          priority: prediction.estimatedTimeMs < 86400000 ? 'critical' : 'medium',
          message: `${resource} will reach capacity by ${prediction.estimatedDate}`,
          action: 'Plan capacity increase'
        });
      }
    }

    return recommendations;
  }

  /**
   * Get planner status.
   */
  getStatus() {
    const status = {
      resources: this.resources.size,
      details: {}
    };

    for (const [resource, data] of this.resources) {
      const current = data.history[data.history.length - 1];
      status.details[resource] = {
        utilization: current?.utilization || 0,
        growthRate: this.growthRates.get(resource) || 0,
        capacity: data.capacity
      };
    }

    return status;
  }
}

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

let globalFailurePredictor = null;
let globalCapacityPlanner = null;

export function getFailurePredictor(options = {}) {
  if (!globalFailurePredictor) {
    globalFailurePredictor = new FailurePredictor(options);
  }
  return globalFailurePredictor;
}

export function getCapacityPlanner(options = {}) {
  if (!globalCapacityPlanner) {
    globalCapacityPlanner = new CapacityPlanner(options);
  }
  return globalCapacityPlanner;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  FailurePredictor,
  CapacityPlanner,
  getFailurePredictor,
  getCapacityPlanner
};
