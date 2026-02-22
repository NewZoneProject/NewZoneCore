// Module: Alert System
// Description: Real-time alerting and notification system for NewZoneCore.
//              Monitors metrics, health checks, and security events.
// File: core/observability/alerts.js

import { EventEmitter } from 'events';

// ============================================================================
// ALERT SEVERITY
// ============================================================================

export const AlertSeverity = {
  CRITICAL: 'critical',  // Immediate action required
  HIGH: 'high',          // Action required soon
  MEDIUM: 'medium',      // Should be addressed
  LOW: 'low',            // Informational
  INFO: 'info'           // For tracking only
};

export const AlertStatus = {
  FIRING: 'firing',
  RESOLVED: 'resolved',
  PENDING: 'pending',
  SILENCED: 'silenced'
};

// ============================================================================
// ALERT DEFINITION
// ============================================================================

export class AlertDefinition {
  constructor(name, options = {}) {
    this.name = name;
    this.description = options.description || '';
    this.severity = options.severity || AlertSeverity.MEDIUM;
    this.condition = options.condition; // Function that returns boolean
    this.resolveCondition = options.resolveCondition; // Optional separate resolve condition
    this.for = options.for || 0; // Duration condition must be true before firing
    this.labels = options.labels || {};
    this.annotations = options.annotations || {};
    this.cooldown = options.cooldown || 300000; // 5 minutes between alerts
    
    // State
    this.currentState = AlertStatus.PENDING;
    this.lastTriggered = null;
    this.lastResolved = null;
    this.activeSince = null;
    this.triggerCount = 0;
  }

  /**
   * Check if alert should fire.
   */
  check(context) {
    if (!this.condition) return false;
    
    try {
      return this.condition(context);
    } catch (error) {
      console.error(`[alert] Condition check failed for ${this.name}:`, error.message);
      return false;
    }
  }

  /**
   * Check if alert should resolve.
   */
  shouldResolve(context) {
    if (this.resolveCondition) {
      return this.resolveCondition(context);
    }
    // Default: resolve when condition is false
    return !this.check(context);
  }

  /**
   * Get alert data.
   */
  getData() {
    return {
      name: this.name,
      description: this.description,
      severity: this.severity,
      status: this.currentState,
      activeSince: this.activeSince,
      lastTriggered: this.lastTriggered,
      lastResolved: this.lastResolved,
      triggerCount: this.triggerCount,
      labels: this.labels,
      annotations: this.annotations
    };
  }
}

// ============================================================================
// ALERT MANAGER
// ============================================================================

export class AlertManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.alerts = new Map();
    this.notifications = options.notifications || [];
    this.silences = new Map();
    this.inhibitionRules = [];
    
    this.checkInterval = options.checkInterval || 10000; // 10 seconds
    this.contextProviders = new Map();
    
    this._startCheckLoop();
  }

  /**
   * Register alert definition.
   */
  registerAlert(alert) {
    if (!(alert instanceof AlertDefinition)) {
      throw new Error('Must be AlertDefinition instance');
    }
    
    this.alerts.set(alert.name, alert);
    this.emit('alert:registered', { name: alert.name });
    
    console.log(`[alert] Registered alert: ${alert.name} (${alert.severity})`);
    return alert;
  }

  /**
   * Unregister alert.
   */
  unregisterAlert(name) {
    return this.alerts.delete(name);
  }

  /**
   * Register context provider (supplies data for condition checks).
   */
  registerContextProvider(name, providerFn) {
    this.contextProviders.set(name, providerFn);
  }

  /**
   * Get current context from all providers.
   */
  async getContext() {
    const context = {
      timestamp: new Date().toISOString(),
      metrics: {},
      health: {},
      security: {}
    };
    
    for (const [name, provider] of this.contextProviders) {
      try {
        const data = await provider();
        Object.assign(context, data);
      } catch (error) {
        console.error(`[alert] Context provider ${name} failed:`, error.message);
      }
    }
    
    return context;
  }

  /**
   * Register notification channel.
   */
  addNotification(channel) {
    this.notifications.push(channel);
    return this;
  }

  /**
   * Remove notification channel.
   */
  removeNotification(channel) {
    const index = this.notifications.indexOf(channel);
    if (index > -1) {
      this.notifications.splice(index, 1);
    }
  }

  /**
   * Add silence (temporarily suppress alerts).
   */
  silence(name, options = {}) {
    const silence = {
      name: options.name || `silence-${Date.now()}`,
      matchers: options.matchers || { alertname: name },
      startsAt: options.startsAt || new Date().toISOString(),
      endsAt: options.endsAt || new Date(Date.now() + options.duration || 3600000).toISOString(),
      createdBy: options.createdBy || 'system',
      comment: options.comment || ''
    };
    
    this.silences.set(silence.name, silence);
    this.emit('silence:added', silence);
    
    console.log(`[alert] Added silence: ${silence.name}`);
    return silence;
  }

  /**
   * Remove silence.
   */
  unsilence(name) {
    return this.silences.delete(name);
  }

  /**
   * Check if alert is silenced.
   */
  isSilenced(alert) {
    const now = new Date().toISOString();
    
    for (const silence of this.silences.values()) {
      if (now < silence.startsAt || now > silence.endsAt) {
        continue;
      }
      
      // Check matchers
      const matches = Object.entries(silence.matchers).every(([key, value]) => {
        return alert.labels[key] === value || key === 'alertname' && alert.name === value;
      });
      
      if (matches) {
        return silence;
      }
    }
    
    return null;
  }

  /**
   * Add inhibition rule (alert A suppresses alert B).
   */
  addInhibitionRule(rule) {
    this.inhibitionRules.push(rule);
  }

  /**
   * Check if alert is inhibited by another.
   */
  isInhibited(alert, activeAlerts) {
    for (const rule of this.inhibitionRules) {
      // Check if source alert is active
      const sourceActive = activeAlerts.some(a => 
        a.name === rule.sourceMatch.alertname &&
        a.severity === rule.sourceMatch.severity
      );
      
      if (!sourceActive) continue;
      
      // Check if target matches
      const targetMatches = alert.name === rule.targetMatch.alertname;
      
      if (sourceActive && targetMatches) {
        return rule;
      }
    }
    
    return null;
  }

  /**
   * Check all alerts.
   */
  async checkAlerts() {
    const context = await this.getContext();
    const activeAlerts = [];
    
    for (const alert of this.alerts.values()) {
      // Skip if silenced
      const silence = this.isSilenced(alert);
      if (silence) {
        continue;
      }
      
      const shouldFire = alert.check(context);
      const shouldResolve = alert.shouldResolve(context);
      
      // Handle state transitions
      if (shouldFire && alert.currentState !== AlertStatus.FIRING) {
        // Check cooldown
        if (alert.lastTriggered && Date.now() - alert.lastTriggered < alert.cooldown) {
          continue;
        }
        
        // Check inhibition
        if (this.isInhibited(alert.getData(), activeAlerts)) {
          continue;
        }
        
        // Fire alert
        alert.currentState = AlertStatus.FIRING;
        alert.activeSince = new Date().toISOString();
        alert.lastTriggered = Date.now();
        alert.triggerCount++;
        
        this.emit('alert:firing', alert.getData());
        this._sendNotification(alert, 'firing', context);
        
        activeAlerts.push(alert.getData());
        
        console.warn(`[alert] FIRING: ${alert.name} (${alert.severity})`);
        
      } else if (shouldResolve && alert.currentState === AlertStatus.FIRING) {
        // Resolve alert
        alert.currentState = AlertStatus.RESOLVED;
        alert.lastResolved = Date.now();
        alert.activeSince = null;
        
        this.emit('alert:resolved', alert.getData());
        this._sendNotification(alert, 'resolved', context);
        
        console.log(`[alert] RESOLVED: ${alert.name}`);
      }
    }
    
    return activeAlerts;
  }

  /**
   * Send notification through all channels.
   */
  async _sendNotification(alert, action, context) {
    const notification = {
      alert: alert.getData(),
      action,
      context: {
        timestamp: new Date().toISOString(),
        ...context
      }
    };
    
    for (const channel of this.notifications) {
      try {
        await channel.send(notification);
      } catch (error) {
        console.error(`[alert] Notification channel ${channel.name} failed:`, error.message);
      }
    }
  }

  /**
   * Start periodic check loop.
   */
  _startCheckLoop() {
    setInterval(() => {
      this.checkAlerts().catch(console.error);
    }, this.checkInterval);
  }

  /**
   * Get all alert statuses.
   */
  getStatus() {
    const alerts = {};
    
    for (const [name, alert] of this.alerts) {
      alerts[name] = alert.getData();
    }
    
    return {
      alerts,
      silences: Array.from(this.silences.values()),
      total: this.alerts.size,
      firing: Array.from(this.alerts.values()).filter(a => a.currentState === AlertStatus.FIRING).length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get active (firing) alerts.
   */
  getActive() {
    return Array.from(this.alerts.values())
      .filter(a => a.currentState === AlertStatus.FIRING)
      .map(a => a.getData());
  }
}

// ============================================================================
// NOTIFICATION CHANNELS
// ============================================================================

/**
 * Console notification channel (for development).
 */
export class ConsoleNotification {
  constructor(options = {}) {
    this.name = 'console';
    this.severities = options.severities || Object.values(AlertSeverity);
  }

  async send(notification) {
    const { alert, action } = notification;
    
    if (!this.severities.includes(alert.severity)) {
      return;
    }
    
    const emoji = {
      [AlertSeverity.CRITICAL]: '🔴',
      [AlertSeverity.HIGH]: '🟠',
      [AlertSeverity.MEDIUM]: '🟡',
      [AlertSeverity.LOW]: '🔵',
      [AlertSeverity.INFO]: '⚪'
    }[alert.severity] || '⚪';
    
    const actionEmoji = action === 'firing' ? '🚨' : '✅';
    
    console.log(
      `${actionEmoji} ${emoji} [${alert.severity.toUpperCase()}] ${alert.name}: ${alert.description}`,
      action === 'resolved' ? '(RESOLVED)' : ''
    );
  }
}

/**
 * Webhook notification channel.
 */
export class WebhookNotification {
  constructor(options = {}) {
    this.name = 'webhook';
    this.url = options.url;
    this.headers = options.headers || {};
    this.severities = options.severities || [
      AlertSeverity.CRITICAL,
      AlertSeverity.HIGH
    ];
  }

  async send(notification) {
    const { alert, action, context } = notification;
    
    if (!this.severities.includes(alert.severity)) {
      return;
    }
    
    const payload = {
      alertname: alert.name,
      status: action,
      severity: alert.severity,
      description: alert.description,
      activeSince: alert.activeSince,
      labels: alert.labels,
      annotations: alert.annotations,
      context
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
      throw new Error(`Webhook failed: ${response.status}`);
    }
  }
}

/**
 * Log file notification channel.
 */
export class LogNotification {
  constructor(options = {}) {
    this.name = 'log';
    this.logger = options.logger || console;
    this.severities = options.severities || Object.values(AlertSeverity);
  }

  async send(notification) {
    const { alert, action } = notification;
    
    if (!this.severities.includes(alert.severity)) {
      return;
    }
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: 'alert',
      action,
      ...alert
    };
    
    if (alert.severity === AlertSeverity.CRITICAL || alert.severity === AlertSeverity.HIGH) {
      this.logger.error('[ALERT]', logEntry);
    } else {
      this.logger.warn('[ALERT]', logEntry);
    }
  }
}

// ============================================================================
// PREDEFINED ALERTS
// ============================================================================

/**
 * Register system health alerts.
 */
export function registerSystemAlerts(manager, options = {}) {
  // High memory usage
  manager.registerAlert(new AlertDefinition('HighMemoryUsage', {
    description: 'Memory usage exceeds threshold',
    severity: AlertSeverity.HIGH,
    condition: (ctx) => {
      const memory = ctx.metrics?.memory || {};
      const threshold = options.memoryThreshold || 0.85;
      return (memory.heapUsed / memory.heapTotal) > threshold;
    },
    labels: { category: 'system' },
    annotations: {
      runbook: 'Check for memory leaks, consider restarting services'
    }
  }));

  // High CPU usage
  manager.registerAlert(new AlertDefinition('HighCPUUsage', {
    description: 'CPU usage exceeds threshold',
    severity: AlertSeverity.HIGH,
    condition: (ctx) => {
      const cpu = ctx.metrics?.cpu || {};
      const threshold = options.cpuThreshold || 0.90;
      return cpu.usage > threshold;
    },
    labels: { category: 'system' }
  }));

  // Low disk space
  manager.registerAlert(new AlertDefinition('LowDiskSpace', {
    description: 'Disk space below threshold',
    severity: AlertSeverity.MEDIUM,
    condition: (ctx) => {
      const storage = ctx.metrics?.storage || {};
      const threshold = options.diskThreshold || 0.10;
      return storage.freePercent < threshold;
    },
    labels: { category: 'system' }
  }));

  // Service down
  manager.registerAlert(new AlertDefinition('ServiceDown', {
    description: 'Critical service is not running',
    severity: AlertSeverity.CRITICAL,
    condition: (ctx) => {
      const services = ctx.health?.services || {};
      return Object.values(services).some(s => s.status === 'stopped' && s.critical);
    },
    labels: { category: 'services' }
  }));

  return manager;
}

/**
 * Register security alerts.
 */
export function registerSecurityAlerts(manager, options = {}) {
  // Brute force attack
  manager.registerAlert(new AlertDefinition('BruteForceAttack', {
    description: 'Multiple failed authentication attempts detected',
    severity: AlertSeverity.CRITICAL,
    condition: (ctx) => {
      const security = ctx.security || {};
      const threshold = options.authFailuresThreshold || 10;
      return security.failedAuthAttempts > threshold;
    },
    labels: { category: 'security' },
    cooldown: 60000 // 1 minute
  }));

  // Rate limiting triggered
  manager.registerAlert(new AlertDefinition('RateLimitTriggered', {
    description: 'Rate limiting has been triggered',
    severity: AlertSeverity.MEDIUM,
    condition: (ctx) => {
      const security = ctx.security || {};
      return security.rateLimitedConnections > 0;
    },
    labels: { category: 'security' }
  }));

  // Security event spike
  manager.registerAlert(new AlertDefinition('SecurityEventSpike', {
    description: 'Unusual spike in security events',
    severity: AlertSeverity.HIGH,
    condition: (ctx) => {
      const security = ctx.security || {};
      const threshold = options.securityEventsThreshold || 100;
      return security.eventsPerMinute > threshold;
    },
    labels: { category: 'security' }
  }));

  // Invalid input detected
  manager.registerAlert(new AlertDefinition('InvalidInputDetected', {
    description: 'Multiple invalid input attempts detected',
    severity: AlertSeverity.MEDIUM,
    condition: (ctx) => {
      const security = ctx.security || {};
      return security.validationFailures > 20;
    },
    labels: { category: 'security' }
  }));

  return manager;
}

/**
 * Register network alerts.
 */
export function registerNetworkAlerts(manager, options = {}) {
  // High network latency
  manager.registerAlert(new AlertDefinition('HighNetworkLatency', {
    description: 'Network latency exceeds threshold',
    severity: AlertSeverity.MEDIUM,
    condition: (ctx) => {
      const network = ctx.metrics?.network || {};
      const threshold = options.latencyThreshold || 500; // ms
      return network.avgLatency > threshold;
    },
    labels: { category: 'network' }
  }));

  // Peer disconnection
  manager.registerAlert(new AlertDefinition('PeerDisconnection', {
    description: 'Multiple peers disconnected',
    severity: AlertSeverity.MEDIUM,
    condition: (ctx) => {
      const network = ctx.metrics?.network || {};
      const threshold = options.peerDisconnectThreshold || 5;
      return network.disconnectionsPerMinute > threshold;
    },
    labels: { category: 'network' }
  }));

  // DHT routing table small
  manager.registerAlert(new AlertDefinition('SmallRoutingTable', {
    description: 'DHT routing table below healthy size',
    severity: AlertSeverity.LOW,
    condition: (ctx) => {
      const network = ctx.metrics?.network || {};
      const threshold = options.routingTableThreshold || 20;
      return network.dhtSize < threshold;
    },
    labels: { category: 'network' }
  }));

  return manager;
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalAlertManager = null;

export function getAlertManager(options = {}) {
  if (!globalAlertManager) {
    globalAlertManager = new AlertManager(options);
    
    // Add console notification by default in development
    if (process.env.NODE_ENV !== 'production') {
      globalAlertManager.addNotification(new ConsoleNotification());
    }
  }
  return globalAlertManager;
}

export function createAlertManager(options = {}) {
  return new AlertManager(options);
}
