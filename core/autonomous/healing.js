// Module: Self-Healing Systems
// Description: Automatic system recovery and self-healing capabilities.
//              Detects and fixes issues without human intervention.
// File: core/autonomous/healing.js

import { EventEmitter } from 'events';

// ============================================================================
// HEALTH MONITOR
// ============================================================================

export const HealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown'
};

export class HealthMonitor extends EventEmitter {
  constructor(options = {}) {
    super();

    this.checks = new Map();
    this.status = HealthStatus.UNKNOWN;
    this.lastCheck = null;
    this.checkInterval = options.checkInterval || 30000;
    this._timer = null;
  }

  /**
   * Register health check.
   */
  registerCheck(id, checkFn, options = {}) {
    this.checks.set(id, {
      id,
      fn: checkFn,
      timeout: options.timeout || 5000,
      critical: options.critical || false,
      lastResult: null,
      lastError: null,
      consecutiveFailures: 0
    });
  }

  /**
   * Run all health checks.
   */
  async runChecks() {
    const results = {};
    let healthyCount = 0;
    let unhealthyCount = 0;
    let criticalFailure = false;

    for (const [id, check] of this.checks) {
      try {
        const result = await Promise.race([
          check.fn(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), check.timeout)
          )
        ]);

        check.lastResult = result;
        check.lastError = null;
        check.consecutiveFailures = 0;
        healthyCount++;

        results[id] = { status: 'healthy', result };
      } catch (error) {
        check.lastError = error.message;
        check.consecutiveFailures++;
        unhealthyCount++;

        if (check.critical && check.consecutiveFailures >= 3) {
          criticalFailure = true;
        }

        results[id] = { status: 'unhealthy', error: error.message };
        this.emit('check:failed', { id, error, failures: check.consecutiveFailures });
      }
    }

    this.lastCheck = new Date().toISOString();

    // Update overall status
    if (criticalFailure) {
      this.status = HealthStatus.UNHEALTHY;
    } else if (unhealthyCount > 0) {
      this.status = HealthStatus.DEGRADED;
    } else {
      this.status = HealthStatus.HEALTHY;
    }

    this.emit('status:change', { status: this.status, results });
    return { status: this.status, results, timestamp: this.lastCheck };
  }

  /**
   * Start monitoring.
   */
  start() {
    if (this._timer) return;
    
    this._timer = setInterval(() => {
      this.runChecks().catch(console.error);
    }, this.checkInterval);

    this.emit('started');
  }

  /**
   * Stop monitoring.
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this.emit('stopped');
  }

  /**
   * Get current status.
   */
  getStatus() {
    return {
      status: this.status,
      lastCheck: this.lastCheck,
      checksCount: this.checks.size,
      checks: Array.from(this.checks.entries()).map(([id, check]) => ({
        id,
        status: check.lastError ? 'unhealthy' : 'healthy',
        consecutiveFailures: check.consecutiveFailures,
        critical: check.critical
      }))
    };
  }
}

// ============================================================================
// SELF-HEALING ENGINE
// ============================================================================

export class SelfHealing extends EventEmitter {
  constructor(healthMonitor, options = {}) {
    super();

    this.healthMonitor = healthMonitor;
    this.options = options;
    this.healingRules = new Map();
    this.activeHealing = new Set();
    this.healingHistory = [];
    this.enabled = options.enabled !== false;
  }

  /**
   * Register healing rule.
   */
  registerRule(id, rule) {
    this.healingRules.set(id, {
      id,
      ...rule,
      triggers: rule.triggers || [],
      actions: rule.actions || [],
      cooldown: rule.cooldown || 60000
    });
  }

  /**
   * Check and execute healing.
   */
  async checkAndHeal(healthStatus) {
    if (!this.enabled) return;

    for (const [id, rule] of this.healingRules) {
      if (this._shouldTrigger(healthStatus, rule)) {
        await this._executeHealing(rule, healthStatus);
      }
    }
  }

  /**
   * Check if healing should trigger.
   */
  _shouldTrigger(healthStatus, rule) {
    if (this.activeHealing.has(rule.id)) return false;

    return rule.triggers.some(trigger => {
      if (trigger.status && healthStatus.status !== trigger.status) return false;
      if (trigger.checkId && !healthStatus.results[trigger.checkId]) return false;
      if (trigger.minFailures) {
        const check = Array.from(this.healthMonitor.checks.values())
          .find(c => c.consecutiveFailures >= trigger.minFailures);
        if (!check) return false;
      }
      return true;
    });
  }

  /**
   * Execute healing actions.
   */
  async _executeHealing(rule, healthStatus) {
    this.activeHealing.add(rule.id);
    this.emit('healing:start', { rule, healthStatus });

    try {
      for (const action of rule.actions) {
        await action(healthStatus);
      }
      
      this.healingHistory.push({
        rule: rule.id,
        healthStatus,
        timestamp: new Date().toISOString(),
        success: true
      });
      
      this.emit('healing:complete', { rule, healthStatus });
    } catch (error) {
      this.healingHistory.push({
        rule: rule.id,
        healthStatus,
        timestamp: new Date().toISOString(),
        success: false,
        error: error.message
      });
      
      this.emit('healing:error', { rule, healthStatus, error });
    } finally {
      this.activeHealing.delete(rule.id);
    }
  }

  /**
   * Get healing history.
   */
  getHistory(limit = 50) {
    return this.healingHistory.slice(-limit);
  }

  /**
   * Get status.
   */
  getStatus() {
    return {
      enabled: this.enabled,
      activeHealing: this.activeHealing.size,
      rulesCount: this.healingRules.size,
      historySize: this.healingHistory.length
    };
  }
}

// ============================================================================
// AUTO-SCALING
// ============================================================================

export class AutoScaling extends EventEmitter {
  constructor(options = {}) {
    super();

    this.metrics = new Map();
    this.rules = new Map();
    this.currentScale = options.initialScale || 1;
    this.minScale = options.minScale || 1;
    this.maxScale = options.maxScale || 10;
    this.cooldown = options.cooldown || 300000;
    this.lastScaleAction = null;
  }

  /**
   * Register metric to monitor.
   */
  registerMetric(name, getterFn) {
    this.metrics.set(name, {
      name,
      getter: getterFn,
      history: []
    });
  }

  /**
   * Register scaling rule.
   */
  registerRule(id, rule) {
    this.rules.set(id, {
      id,
      ...rule,
      metric: rule.metric,
      threshold: rule.threshold,
      scaleChange: rule.scaleChange
    });
  }

  /**
   * Check and scale.
   */
  async checkAndScale() {
    if (Date.now() - this.lastScaleAction < this.cooldown) {
      return { skipped: 'cooldown' };
    }

    // Collect metrics
    for (const [name, metric] of this.metrics) {
      const value = await metric.getter();
      metric.history.push({ value, timestamp: Date.now() });
      
      // Keep last 100 values
      if (metric.history.length > 100) {
        metric.history.shift();
      }
    }

    // Check scaling rules
    for (const [id, rule] of this.rules) {
      const metric = this.metrics.get(rule.metric);
      if (!metric || metric.history.length === 0) continue;

      const latest = metric.history[metric.history.length - 1].value;
      
      if (this._shouldScale(latest, rule)) {
        return this._executeScale(rule.scaleChange, rule.id);
      }
    }

    return { scaled: false };
  }

  /**
   * Check if scaling should occur.
   */
  _shouldScale(value, rule) {
    if (rule.operator === 'gt' && value > rule.threshold) return true;
    if (rule.operator === 'lt' && value < rule.threshold) return true;
    if (rule.operator === 'gte' && value >= rule.threshold) return true;
    if (rule.operator === 'lte' && value <= rule.threshold) return true;
    return false;
  }

  /**
   * Execute scaling.
   */
  _executeScale(change, reason) {
    const newScale = this.currentScale + change;
    
    if (newScale < this.minScale || newScale > this.maxScale) {
      return { scaled: false, reason: 'limits' };
    }

    this.currentScale = newScale;
    this.lastScaleAction = Date.now();
    
    this.emit('scale:change', { 
      newScale, 
      previousScale: this.currentScale - change,
      reason 
    });

    return { scaled: true, newScale, reason };
  }

  /**
   * Get current scale.
   */
  getScale() {
    return {
      current: this.currentScale,
      min: this.minScale,
      max: this.maxScale
    };
  }
}

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

let globalHealthMonitor = null;
let globalSelfHealing = null;
let globalAutoScaling = null;

export function getHealthMonitor(options = {}) {
  if (!globalHealthMonitor) {
    globalHealthMonitor = new HealthMonitor(options);
  }
  return globalHealthMonitor;
}

export function getSelfHealing(options = {}) {
  if (!globalSelfHealing && globalHealthMonitor) {
    globalSelfHealing = new SelfHealing(globalHealthMonitor, options);
  }
  return globalSelfHealing;
}

export function getAutoScaling(options = {}) {
  if (!globalAutoScaling) {
    globalAutoScaling = new AutoScaling(options);
  }
  return globalAutoScaling;
}

export default {
  HealthMonitor,
  SelfHealing,
  AutoScaling,
  HealthStatus,
  getHealthMonitor,
  getSelfHealing,
  getAutoScaling
};
