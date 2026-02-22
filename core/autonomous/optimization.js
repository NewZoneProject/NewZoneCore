// Module: AI-Driven Optimization
// Description: Machine learning-based system optimization.
//              Automatically optimizes performance and resource usage.
// File: core/autonomous/optimization.js

import { EventEmitter } from 'events';

// ============================================================================
// OPTIMIZATION ADVISOR
// ============================================================================

export class OptimizationAdvisor extends EventEmitter {
  constructor(options = {}) {
    super();

    this.metrics = new Map();
    this.baselines = new Map();
    this.recommendations = [];
    this.options = options;
    this.learningRate = options.learningRate || 0.1;
  }

  /**
   * Track metric.
   */
  trackMetric(name, value, context = {}) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const data = {
      value,
      context,
      timestamp: Date.now()
    };

    const metricData = this.metrics.get(name);
    metricData.push(data);

    // Keep last 1000 data points
    if (metricData.length > 1000) {
      metricData.shift();
    }

    // Update baseline
    this._updateBaseline(name, value);

    // Check for optimization opportunities
    this._analyzeForOptimization(name, data);
  }

  /**
   * Update baseline.
   */
  _updateBaseline(name, value) {
    if (!this.baselines.has(name)) {
      this.baselines.set(name, {
        mean: value,
        min: value,
        max: value,
        count: 1
      });
      return;
    }

    const baseline = this.baselines.get(name);
    baseline.count++;
    
    // Exponential moving average
    baseline.mean = baseline.mean * (1 - this.learningRate) + value * this.learningRate;
    baseline.min = Math.min(baseline.min, value);
    baseline.max = Math.max(baseline.max, value);
  }

  /**
   * Analyze for optimization.
   */
  _analyzeForOptimization(name, data) {
    const baseline = this.baselines.get(name);
    if (!baseline || baseline.count < 100) return;

    const deviation = (data.value - baseline.mean) / baseline.mean;

    // Check for optimization opportunities
    if (deviation > 0.5) {
      this._createRecommendation({
        type: 'performance_degradation',
        metric: name,
        currentValue: data.value,
        baseline: baseline.mean,
        deviation,
        suggestion: `Consider optimizing ${name} - currently ${Math.round(deviation * 100)}% above baseline`
      });
    }

    if (name.includes('memory') && data.value > baseline.max * 0.9) {
      this._createRecommendation({
        type: 'memory_pressure',
        metric: name,
        currentValue: data.value,
        baseline: baseline.max,
        suggestion: 'Memory usage approaching maximum - consider cleanup or scaling'
      });
    }

    if (name.includes('cpu') && data.value > baseline.max * 0.9) {
      this._createRecommendation({
        type: 'cpu_pressure',
        metric: name,
        currentValue: data.value,
        baseline: baseline.max,
        suggestion: 'CPU usage approaching maximum - consider optimization or scaling'
      });
    }
  }

  /**
   * Create recommendation.
   */
  _createRecommendation(rec) {
    // Avoid duplicates
    const exists = this.recommendations.some(
      r => r.type === rec.type && r.metric === rec.metric &&
      Date.now() - r.timestamp < 3600000 // 1 hour cooldown
    );

    if (!exists) {
      rec.timestamp = Date.now();
      rec.priority = this._calculatePriority(rec);
      this.recommendations.push(rec);
      this.emit('recommendation', rec);
    }
  }

  /**
   * Calculate priority.
   */
  _calculatePriority(rec) {
    if (rec.type.includes('pressure')) return 'high';
    if (rec.deviation > 1.0) return 'high';
    if (rec.deviation > 0.5) return 'medium';
    return 'low';
  }

  /**
   * Get recommendations.
   */
  getRecommendations(limit = 20) {
    return this.recommendations
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Clear old recommendations.
   */
  clearOldRecommendations(maxAge = 86400000) {
    const now = Date.now();
    this.recommendations = this.recommendations.filter(
      r => now - r.timestamp < maxAge
    );
  }

  /**
   * Get status.
   */
  getStatus() {
    return {
      metricsTracked: this.metrics.size,
      baselinesCount: this.baselines.size,
      recommendationsCount: this.recommendations.length
    };
  }
}

// ============================================================================
// AUTO-TUNER
// ============================================================================

export class AutoTuner extends EventEmitter {
  constructor(options = {}) {
    super();

    this.parameters = new Map();
    this.objectives = [];
    this.history = [];
    this.options = options;
    this.enabled = options.enabled !== false;
  }

  /**
   * Register tunable parameter.
   */
  registerParameter(name, config) {
    this.parameters.set(name, {
      name,
      current: config.initial,
      min: config.min,
      max: config.max,
      step: config.step || 1,
      getter: config.getter,
      setter: config.setter
    });
  }

  /**
   * Register optimization objective.
   */
  registerObjective(name, fn, weight = 1) {
    this.objectives.push({ name, fn, weight });
  }

  /**
   * Run optimization cycle.
   */
  async optimize() {
    if (!this.enabled) return { skipped: 'disabled' };

    const results = {};

    for (const [name, param] of this.parameters) {
      const currentValue = param.getter ? await param.getter() : param.current;
      const score = await this._calculateScore(currentValue);
      
      // Determine adjustment direction
      const adjustment = this._determineAdjustment(param, score);
      
      if (adjustment !== 0) {
        const newValue = Math.max(
          param.min,
          Math.min(param.max, currentValue + adjustment)
        );

        if (param.setter) {
          await param.setter(newValue);
        }
        param.current = newValue;

        results[name] = {
          oldValue: currentValue,
          newValue,
          adjustment,
          score
        };

        this.emit('parameter:tuned', { name, oldValue: currentValue, newValue, score });
      }
    }

    this.history.push({
      parameters: results,
      timestamp: Date.now()
    });

    return { optimized: true, results };
  }

  /**
   * Calculate optimization score.
   */
  async _calculateScore(currentValue) {
    let totalScore = 0;
    let totalWeight = 0;

    for (const objective of this.objectives) {
      const score = await objective.fn(currentValue);
      totalScore += score * objective.weight;
      totalWeight += objective.weight;
    }

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Determine parameter adjustment.
   */
  _determineAdjustment(param, score) {
    // Simple hill climbing
    if (score < 0.3) return param.step; // Low score, increase
    if (score > 0.8) return -param.step; // High score, decrease
    return 0; // Optimal range
  }

  /**
   * Get parameter values.
   */
  getParameters() {
    const result = {};
    for (const [name, param] of this.parameters) {
      result[name] = param.current;
    }
    return result;
  }

  /**
   * Get tuning history.
   */
  getHistory(limit = 100) {
    return this.history.slice(-limit);
  }

  /**
   * Get status.
   */
  getStatus() {
    return {
      enabled: this.enabled,
      parametersCount: this.parameters.size,
      objectivesCount: this.objectives.length,
      historySize: this.history.length
    };
  }
}

// ============================================================================
// RESOURCE OPTIMIZER
// ============================================================================

export class ResourceOptimizer extends EventEmitter {
  constructor(options = {}) {
    super();

    this.resources = new Map();
    this.strategies = new Map();
    this.options = options;
  }

  /**
   * Register resource.
   */
  registerResource(name, config) {
    this.resources.set(name, {
      name,
      ...config,
      currentUsage: 0,
      history: []
    });
  }

  /**
   * Register optimization strategy.
   */
  registerStrategy(name, strategy) {
    this.strategies.set(name, strategy);
  }

  /**
   * Update resource usage.
   */
  updateUsage(name, usage) {
    const resource = this.resources.get(name);
    if (!resource) return;

    resource.currentUsage = usage;
    resource.history.push({ usage, timestamp: Date.now() });

    // Keep last 100 data points
    if (resource.history.length > 100) {
      resource.history.shift();
    }

    // Check if optimization needed
    this._checkOptimization(name, resource);
  }

  /**
   * Check if optimization is needed.
   */
  _checkOptimization(name, resource) {
    if (resource.currentUsage > resource.threshold || 0.8) {
      this._applyStrategy(name, resource);
    }
  }

  /**
   * Apply optimization strategy.
   */
  async _applyStrategy(name, resource) {
    const strategy = this.strategies.get(resource.strategy || 'default');
    if (!strategy) return;

    try {
      await strategy(resource);
      this.emit('optimized', { name, strategy: resource.strategy });
    } catch (error) {
      this.emit('optimization:error', { name, error });
    }
  }

  /**
   * Get resource status.
   */
  getResourceStatus(name) {
    const resource = this.resources.get(name);
    if (!resource) return null;

    return {
      name: resource.name,
      currentUsage: resource.currentUsage,
      threshold: resource.threshold,
      optimized: resource.currentUsage <= (resource.threshold || 0.8)
    };
  }

  /**
   * Get all resources status.
   */
  getAllStatus() {
    const result = {};
    for (const [name] of this.resources) {
      result[name] = this.getResourceStatus(name);
    }
    return result;
  }
}

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

let globalAdvisor = null;
let globalTuner = null;
let globalOptimizer = null;

export function getOptimizationAdvisor(options = {}) {
  if (!globalAdvisor) {
    globalAdvisor = new OptimizationAdvisor(options);
  }
  return globalAdvisor;
}

export function getAutoTuner(options = {}) {
  if (!globalTuner) {
    globalTuner = new AutoTuner(options);
  }
  return globalTuner;
}

export function getResourceOptimizer(options = {}) {
  if (!globalOptimizer) {
    globalOptimizer = new ResourceOptimizer(options);
  }
  return globalOptimizer;
}

export default {
  OptimizationAdvisor,
  AutoTuner,
  ResourceOptimizer,
  getOptimizationAdvisor,
  getAutoTuner,
  getResourceOptimizer
};
