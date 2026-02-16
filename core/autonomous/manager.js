// Module: Autonomous Services Manager
// Description: Manages autonomous services with automatic startup, crash recovery,
//              health checks, and dependency graph for self-managing runtime.
// File: core/autonomous/manager.js

import { EventTypes, getEventBus } from '../eventbus/index.js';
import { ServiceState, Service } from '../lifecycle/manager.js';

// ============================================================================
// AUTONOMOUS SERVICE OPTIONS
// ============================================================================

export const AutoStartPolicy = {
  ALWAYS: 'always',
  ON_FAILURE: 'on-failure',
  NEVER: 'never',
  ON_DEMAND: 'on-demand'
};

export const RestartPolicy = {
  NO: 'no',
  ALWAYS: 'always',
  ON_FAILURE: 'on-failure',
  ON_ABORT: 'on-abort'
};

// ============================================================================
// AUTONOMOUS SERVICE
// ============================================================================

export class AutonomousService extends Service {
  constructor(name, options = {}) {
    super(name, options);

    // Autonomous options
    this.autoStartPolicy = options.autoStartPolicy || AutoStartPolicy.ON_DEMAND;
    this.restartPolicy = options.restartPolicy || RestartPolicy.ON_FAILURE;
    this.maxRestarts = options.maxRestarts || 5;
    this.restartDelay = options.restartDelay || 1000;
    this.restartBackoff = options.restartBackoff || 'exponential';
    this.healthCheckInterval = options.healthCheckInterval || 30000;
    this.healthCheckTimeout = options.healthCheckTimeout || 5000;
    this.unhealthyThreshold = options.unhealthyThreshold || 3;

    // State tracking
    this.consecutiveFailures = 0;
    this.unhealthyCount = 0;
    this.lastHealthStatus = null;
    this.lastRestartTime = null;
    this.totalRestarts = 0;
    this.totalStarts = 0;
    this.totalUptime = 0;

    // Health check
    this.healthCheckTimer = null;
    this.healthCheckHandler = options.onHealthCheck || null;

    // Startup dependencies
    this.dependencies = options.dependencies || [];
    this.dependents = [];

    // Startup order
    this.startupPriority = options.startupPriority || 100;
  }

  // ==========================================================================
  // AUTONOMOUS LIFECYCLE
  // ==========================================================================

  /**
   * Autonomous start with health check setup
   */
  async start(context = {}) {
    const result = await super.start(context);

    if (result.success) {
      this.totalStarts++;
      this.consecutiveFailures = 0;

      // Start health checks
      this._startHealthChecks();
    }

    return result;
  }

  /**
   * Autonomous stop with cleanup
   */
  async stop(reason = 'manual') {
    this._stopHealthChecks();
    const result = await super.stop(reason);

    if (result.success && this.startTime) {
      this.totalUptime += this.getUptime();
    }

    return result;
  }

  /**
   * Handle service crash
   */
  async crash(error) {
    this.consecutiveFailures++;
    this.totalRestarts++;
    this.lastRestartTime = new Date().toISOString();

    this._stopHealthChecks();

    this.eventBus.emit(EventTypes.SERVICE_CRASHED, {
      service: this.name,
      error: error?.message || 'Unknown error',
      consecutiveFailures: this.consecutiveFailures,
      totalRestarts: this.totalRestarts
    });

    // Check restart policy
    if (this._shouldRestart()) {
      const delay = this._calculateRestartDelay();

      this.eventBus.emit(EventTypes.SYSTEM_INFO, {
        service: this.name,
        action: 'auto_restart_scheduled',
        delay,
        attempt: this.consecutiveFailures
      });

      setTimeout(() => this._attemptRestart(), delay);
    }
  }

  /**
   * Attempt automatic restart
   */
  async _attemptRestart() {
    if (this.state === ServiceState.RUNNING) {
      return;
    }

    try {
      // Reset state
      this.state = ServiceState.READY;
      this.lastError = null;

      await this.start({ reason: 'auto-restart' });
    } catch (error) {
      this.eventBus.emit(EventTypes.SERVICE_ERROR, {
        service: this.name,
        error: error.message,
        phase: 'auto-restart'
      });
    }
  }

  // ==========================================================================
  // HEALTH CHECKS
  // ==========================================================================

  /**
   * Start periodic health checks
   */
  _startHealthChecks() {
    if (this.healthCheckTimer || !this.healthCheckHandler) return;

    this.healthCheckTimer = setInterval(async () => {
      await this._performHealthCheck();
    }, this.healthCheckInterval);
  }

  /**
   * Stop health checks
   */
  _stopHealthChecks() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Perform a health check
   */
  async _performHealthCheck() {
    if (this.state !== ServiceState.RUNNING) return;

    try {
      const result = await this._executeWithTimeout(
        this.healthCheckHandler,
        [],
        this.healthCheckTimeout
      );

      this.lastHealthStatus = result;

      if (!result || result.healthy === false) {
        this._handleUnhealthy(result);
      } else {
        this.unhealthyCount = 0;
      }
    } catch (error) {
      this.lastHealthStatus = { healthy: false, error: error.message };
      this._handleUnhealthy(this.lastHealthStatus);
    }
  }

  /**
   * Handle unhealthy status
   */
  _handleUnhealthy(result) {
    this.unhealthyCount++;

    this.eventBus.emit(EventTypes.SYSTEM_WARNING, {
      service: this.name,
      warning: 'Health check failed',
      unhealthyCount: this.unhealthyCount,
      threshold: this.unhealthyThreshold,
      result
    });

    if (this.unhealthyCount >= this.unhealthyThreshold) {
      this.eventBus.emit(EventTypes.SERVICE_ERROR, {
        service: this.name,
        error: 'Service unhealthy - threshold exceeded',
        unhealthyCount: this.unhealthyCount
      });

      // Trigger restart or crash
      this.crash(new Error('Health check threshold exceeded'));
    }
  }

  // ==========================================================================
  // RESTART LOGIC
  // ==========================================================================

  /**
   * Check if service should auto-restart
   */
  _shouldRestart() {
    if (this.restartPolicy === RestartPolicy.NO) {
      return false;
    }

    if (this.totalRestarts >= this.maxRestarts) {
      return false;
    }

    switch (this.restartPolicy) {
      case RestartPolicy.ALWAYS:
        return true;

      case RestartPolicy.ON_FAILURE:
        return this.consecutiveFailures > 0;

      case RestartPolicy.ON_ABORT:
        return this.state === ServiceState.CRASHED;

      default:
        return false;
    }
  }

  /**
   * Calculate restart delay with backoff
   */
  _calculateRestartDelay() {
    const baseDelay = this.restartDelay;

    switch (this.restartBackoff) {
      case 'exponential':
        return Math.min(baseDelay * Math.pow(2, this.consecutiveFailures - 1), 60000);

      case 'linear':
        return Math.min(baseDelay * this.consecutiveFailures, 60000);

      case 'constant':
      default:
        return baseDelay;
    }
  }

  // ==========================================================================
  // STATUS
  // ==========================================================================

  getStatus() {
    const base = super.getStatus();

    return {
      ...base,
      autoStartPolicy: this.autoStartPolicy,
      restartPolicy: this.restartPolicy,
      consecutiveFailures: this.consecutiveFailures,
      totalRestarts: this.totalRestarts,
      totalStarts: this.totalStarts,
      totalUptime: this.totalUptime,
      lastHealthStatus: this.lastHealthStatus,
      unhealthyCount: this.unhealthyCount,
      dependencies: this.dependencies,
      startupPriority: this.startupPriority
    };
  }
}

// ============================================================================
// AUTONOMOUS MANAGER
// ============================================================================

export class AutonomousManager {
  constructor(options = {}) {
    this.eventBus = getEventBus();
    this.services = new Map();
    this.dependencyGraph = new Map();

    // State
    this.isRunning = false;
    this.startupOrder = [];
    this.shutdownOrder = [];

    // Options
    this.options = {
      startupTimeout: options.startupTimeout || 60000,
      shutdownTimeout: options.shutdownTimeout || 30000,
      parallelStartup: options.parallelStartup || false,
      ...options
    };

    // Register event handlers
    this._setupEventHandlers();
  }

  // ==========================================================================
  // SERVICE REGISTRATION
  // ==========================================================================

  /**
   * Register an autonomous service
   */
  register(name, options = {}) {
    if (this.services.has(name)) {
      throw new Error(`Service already registered: ${name}`);
    }

    const service = new AutonomousService(name, options);
    this.services.set(name, service);

    // Build dependency graph
    if (options.dependencies && options.dependencies.length > 0) {
      this.dependencyGraph.set(name, options.dependencies);

      // Add as dependent to dependencies
      for (const dep of options.dependencies) {
        const depService = this.services.get(dep);
        if (depService) {
          depService.dependents.push(name);
        }
      }
    }

    this.eventBus.emit(EventTypes.SERVICE_REGISTERED, {
      service: name,
      metadata: options.metadata,
      autonomous: true
    });

    return service;
  }

  /**
   * Unregister a service
   */
  async unregister(name) {
    const service = this.services.get(name);
    if (!service) return false;

    // Stop if running
    if (service.isRunning()) {
      await service.stop('unregister');
    }

    // Remove from dependency graph
    this.dependencyGraph.delete(name);

    // Remove from dependents
    for (const svc of this.services.values()) {
      svc.dependents = svc.dependents.filter(d => d !== name);
    }

    this.services.delete(name);
    return true;
  }

  /**
   * Get a service
   */
  get(name) {
    return this.services.get(name) || null;
  }

  // ==========================================================================
  // AUTONOMOUS STARTUP
  // ==========================================================================

  /**
   * Start all services with auto-start policy
   */
  async startAll(context = {}) {
    if (this.isRunning) {
      return { success: true, message: 'Already running' };
    }

    this.isRunning = true;

    // Calculate startup order
    this.startupOrder = this._calculateStartupOrder();

    const results = {
      started: [],
      failed: [],
      skipped: []
    };

    if (this.options.parallelStartup) {
      // Start services in parallel (grouped by priority level)
      const groups = this._groupServicesByPriority(this.startupOrder);

      for (const group of groups) {
        const groupResults = await Promise.all(
          group.map(name => this._startService(name, context))
        );

        for (let i = 0; i < group.length; i++) {
          if (groupResults[i].success) {
            results.started.push(group[i]);
          } else {
            results.failed.push({ name: group[i], error: groupResults[i].error });
          }
        }
      }
    } else {
      // Start services sequentially
      for (const name of this.startupOrder) {
        const result = await this._startService(name, context);

        if (result.success) {
          results.started.push(name);
        } else if (result.skipped) {
          results.skipped.push(name);
        } else {
          results.failed.push({ name, error: result.error });
        }
      }
    }

    this.eventBus.emit(EventTypes.CORE_STARTED, {
      services: results.started.length,
      failed: results.failed.length
    });

    return results;
  }

  /**
   * Start a single service
   */
  async _startService(name, context = {}) {
    const service = this.services.get(name);

    if (!service) {
      return { success: false, error: 'Service not found' };
    }

    // Check auto-start policy
    if (service.autoStartPolicy === AutoStartPolicy.NEVER) {
      return { success: false, skipped: true, reason: 'Auto-start disabled' };
    }

    // Check dependencies
    const deps = this.dependencyGraph.get(name) || [];
    for (const dep of deps) {
      const depService = this.services.get(dep);
      if (depService && !depService.isRunning()) {
        return { success: false, skipped: true, reason: `Dependency not running: ${dep}` };
      }
    }

    try {
      await service.init(context);
      await service.start(context);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==========================================================================
  // AUTONOMOUS SHUTDOWN
  // ==========================================================================

  /**
   * Stop all services gracefully
   */
  async stopAll(reason = 'shutdown') {
    if (!this.isRunning) {
      return { success: true, message: 'Not running' };
    }

    // Calculate shutdown order (reverse of startup)
    this.shutdownOrder = [...this.startupOrder].reverse();

    const results = {
      stopped: [],
      failed: []
    };

    for (const name of this.shutdownOrder) {
      const service = this.services.get(name);

      if (service && service.isRunning()) {
        try {
          await service.stop(reason);
          results.stopped.push(name);
        } catch (error) {
          results.failed.push({ name, error: error.message });
        }
      }
    }

    this.isRunning = false;

    this.eventBus.emit(EventTypes.CORE_STOPPING, {
      services: results.stopped.length,
      reason
    });

    return results;
  }

  // ==========================================================================
  // SERVICE MANAGEMENT
  // ==========================================================================

  /**
   * Restart a service and its dependents
   */
  async restartService(name, reason = 'manual') {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }

    // Get all dependents to restart after
    const dependents = this._getAllDependents(name);

    // Stop dependents first (reverse order)
    for (const dep of [...dependents].reverse()) {
      const depService = this.services.get(dep);
      if (depService?.isRunning()) {
        await depService.stop(`dependency_restart:${name}`);
      }
    }

    // Restart the service
    await service.restart(reason);

    // Restart dependents
    for (const dep of dependents) {
      const depService = this.services.get(dep);
      if (depService && depService.autoStartPolicy !== AutoStartPolicy.NEVER) {
        try {
          await depService.start({ reason: 'dependency_restart' });
        } catch (error) {
          this.eventBus.emit(EventTypes.SERVICE_ERROR, {
            service: dep,
            error: error.message,
            phase: 'dependency_restart'
          });
        }
      }
    }

    return { success: true, dependents: dependents.length };
  }

  /**
   * Get all dependents recursively
   */
  _getAllDependents(name, visited = new Set()) {
    const result = [];
    const service = this.services.get(name);

    if (!service) return result;

    for (const dependent of service.dependents) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        result.push(dependent);
        result.push(...this._getAllDependents(dependent, visited));
      }
    }

    return result;
  }

  // ==========================================================================
  // STATUS & MONITORING
  // ==========================================================================

  /**
   * Get overall status
   */
  getStatus() {
    const services = {};
    let running = 0;
    let stopped = 0;
    let unhealthy = 0;

    for (const [name, service] of this.services) {
      services[name] = service.getStatus();

      if (service.isRunning()) {
        running++;
      } else {
        stopped++;
      }

      if (service.lastHealthStatus?.healthy === false) {
        unhealthy++;
      }
    }

    return {
      isRunning: this.isRunning,
      serviceCount: this.services.size,
      running,
      stopped,
      unhealthy,
      services
    };
  }

  /**
   * Get services by state
   */
  getServicesByState(state) {
    const result = [];
    for (const [name, service] of this.services) {
      if (service.state === state) {
        result.push(name);
      }
    }
    return result;
  }

  /**
   * Get unhealthy services
   */
  getUnhealthyServices() {
    const result = [];
    for (const [name, service] of this.services) {
      if (service.lastHealthStatus?.healthy === false) {
        result.push({
          name,
          status: service.lastHealthStatus,
          unhealthyCount: service.unhealthyCount
        });
      }
    }
    return result;
  }

  // ==========================================================================
  // DEPENDENCY GRAPH
  // ==========================================================================

  /**
   * Calculate startup order (topological sort)
   */
  _calculateStartupOrder() {
    const visited = new Set();
    const order = [];

    const visit = (name) => {
      if (visited.has(name)) return;
      visited.add(name);

      const deps = this.dependencyGraph.get(name) || [];
      for (const dep of deps) {
        if (this.services.has(dep)) {
          visit(dep);
        }
      }

      order.push(name);
    };

    // Sort by priority first
    const sorted = [...this.services.entries()]
      .sort((a, b) => a[1].startupPriority - b[1].startupPriority);

    for (const [name] of sorted) {
      visit(name);
    }

    return order;
  }

  /**
   * Group services by priority level
   */
  _groupServicesByPriority(order) {
    const groups = [];
    let currentGroup = [];
    let currentPriority = -1;

    for (const name of order) {
      const service = this.services.get(name);
      if (service.startupPriority !== currentPriority) {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [name];
        currentPriority = service.startupPriority;
      } else {
        currentGroup.push(name);
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================

  _setupEventHandlers() {
    // Listen for service crashes
    this.eventBus.subscribe(EventTypes.SERVICE_CRASHED, async ({ service, error }) => {
      const svc = this.services.get(service);
      if (svc && svc.restartPolicy !== RestartPolicy.NO) {
        // Already handled by AutonomousService.crash()
      }
    });

    // Listen for system warnings
    this.eventBus.subscribe(EventTypes.SYSTEM_WARNING, ({ service, warning }) => {
      // Could implement alerting here
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

let globalAutonomous = null;

export function getAutonomousManager(options = {}) {
  if (!globalAutonomous) {
    globalAutonomous = new AutonomousManager(options);
  }
  return globalAutonomous;
}

export function createAutonomousManager(options = {}) {
  return new AutonomousManager(options);
}
