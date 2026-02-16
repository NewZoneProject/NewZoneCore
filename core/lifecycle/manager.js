// Module: Service Lifecycle Manager
// Description: Manages service lifecycle (init, start, stop, status) with
//              automatic registration, crash recovery, health checks, and
//              dependency graph support.
// File: core/lifecycle/manager.js

import { EventTypes, getEventBus } from '../eventbus/index.js';

// ============================================================================
// SERVICE STATES
// ============================================================================

export const ServiceState = {
  CREATED: 'created',
  INITIALIZING: 'initializing',
  READY: 'ready',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
  CRASHED: 'crashed'
};

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class Service {
  constructor(name, options = {}) {
    this.id = `svc:${name}:${Date.now()}`;
    this.name = name;
    this.state = ServiceState.CREATED;
    this.options = {
      autoStart: options.autoStart || false,
      restartOnCrash: options.restartOnCrash || false,
      maxRestarts: options.maxRestarts || 3,
      healthCheckInterval: options.healthCheckInterval || 30000,
      timeout: options.timeout || 10000,
      dependencies: options.dependencies || [],
      ...options
    };
    
    this.metadata = options.metadata || {};
    this.startTime = null;
    this.stopTime = null;
    this.restartCount = 0;
    this.lastError = null;
    this.healthCheckTimer = null;
    
    // Lifecycle hooks
    this.hooks = {
      init: options.onInit || null,
      start: options.onStart || null,
      stop: options.onStop || null,
      healthCheck: options.onHealthCheck || null
    };
    
    this.eventBus = getEventBus();
  }
  
  // =========================================================================
  // LIFECYCLE METHODS
  // =========================================================================
  
  /**
   * Initialize the service
   */
  async init(context = {}) {
    if (this.state !== ServiceState.CREATED) {
      throw new Error(`Cannot init service in state: ${this.state}`);
    }
    
    this.state = ServiceState.INITIALIZING;
    this.eventBus.emit(EventTypes.SYSTEM_INFO, { service: this.name, action: 'init' });
    
    try {
      if (this.hooks.init) {
        await this._executeWithTimeout(this.hooks.init, [context], this.options.timeout);
      }
      this.state = ServiceState.READY;
      return { success: true };
    } catch (error) {
      this.state = ServiceState.ERROR;
      this.lastError = error.message;
      this.eventBus.emit(EventTypes.SERVICE_ERROR, { service: this.name, error: error.message });
      throw error;
    }
  }
  
  /**
   * Start the service
   */
  async start(context = {}) {
    if (this.state === ServiceState.RUNNING) {
      return { success: true, message: 'Already running' };
    }
    
    if (this.state !== ServiceState.READY && this.state !== ServiceState.STOPPED) {
      throw new Error(`Cannot start service in state: ${this.state}`);
    }
    
    this.state = ServiceState.STARTING;
    this.eventBus.emit(EventTypes.SERVICE_STARTED, { service: this.name, starting: true });
    
    try {
      if (this.hooks.start) {
        await this._executeWithTimeout(this.hooks.start, [context], this.options.timeout);
      }
      
      this.state = ServiceState.RUNNING;
      this.startTime = new Date().toISOString();
      this.stopTime = null;
      
      // Start health check if defined
      if (this.hooks.healthCheck) {
        this._startHealthCheck();
      }
      
      this.eventBus.emit(EventTypes.SERVICE_STARTED, { 
        service: this.name, 
        startTime: this.startTime 
      });
      
      return { success: true, startTime: this.startTime };
    } catch (error) {
      this.state = ServiceState.ERROR;
      this.lastError = error.message;
      this.eventBus.emit(EventTypes.SERVICE_ERROR, { service: this.name, error: error.message, phase: 'start' });
      throw error;
    }
  }
  
  /**
   * Stop the service
   */
  async stop(reason = 'manual') {
    if (this.state !== ServiceState.RUNNING) {
      return { success: true, message: 'Not running' };
    }
    
    this.state = ServiceState.STOPPING;
    this._stopHealthCheck();
    
    this.eventBus.emit(EventTypes.SERVICE_STOPPED, { service: this.name, reason, stopping: true });
    
    try {
      if (this.hooks.stop) {
        await this._executeWithTimeout(this.hooks.stop, [{ reason }], this.options.timeout);
      }
      
      this.state = ServiceState.STOPPED;
      this.stopTime = new Date().toISOString();
      
      this.eventBus.emit(EventTypes.SERVICE_STOPPED, { 
        service: this.name, 
        reason,
        stopTime: this.stopTime,
        uptime: this.getUptime()
      });
      
      return { success: true, stopTime: this.stopTime };
    } catch (error) {
      this.state = ServiceState.ERROR;
      this.lastError = error.message;
      this.eventBus.emit(EventTypes.SERVICE_ERROR, { service: this.name, error: error.message, phase: 'stop' });
      throw error;
    }
  }
  
  /**
   * Restart the service
   */
  async restart(reason = 'manual') {
    if (this.state === ServiceState.RUNNING) {
      await this.stop(`restart:${reason}`);
    }
    
    // Reset state for restart
    if (this.state === ServiceState.STOPPED || this.state === ServiceState.ERROR) {
      this.state = ServiceState.READY;
    }
    
    return this.start({ reason: 'restart' });
  }
  
  // =========================================================================
  // STATUS & INFO
  // =========================================================================
  
  /**
   * Get current status
   */
  getStatus() {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      startTime: this.startTime,
      stopTime: this.stopTime,
      uptime: this.getUptime(),
      restartCount: this.restartCount,
      lastError: this.lastError,
      metadata: this.metadata,
      dependencies: this.options.dependencies
    };
  }
  
  /**
   * Get uptime in milliseconds
   */
  getUptime() {
    if (!this.startTime) return 0;
    const end = this.stopTime ? new Date(this.stopTime) : new Date();
    return end.getTime() - new Date(this.startTime).getTime();
  }
  
  /**
   * Check if service is healthy
   */
  isHealthy() {
    return this.state === ServiceState.RUNNING && !this.lastError;
  }
  
  /**
   * Check if service is running
   */
  isRunning() {
    return this.state === ServiceState.RUNNING;
  }
  
  // =========================================================================
  // HEALTH CHECK
  // =========================================================================
  
  _startHealthCheck() {
    if (this.healthCheckTimer) return;
    
    this.healthCheckTimer = setInterval(async () => {
      if (this.state !== ServiceState.RUNNING) return;
      
      try {
        const result = await this.hooks.healthCheck();
        if (!result || result.healthy === false) {
          this.eventBus.emit(EventTypes.SYSTEM_WARNING, {
            service: this.name,
            warning: 'Health check failed',
            result
          });
        }
      } catch (error) {
        this.eventBus.emit(EventTypes.SERVICE_ERROR, {
          service: this.name,
          error: error.message,
          phase: 'healthcheck'
        });
      }
    }, this.options.healthCheckInterval);
  }
  
  _stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
  
  // =========================================================================
  // CRASH HANDLING
  // =========================================================================
  
  /**
   * Mark service as crashed and potentially restart
   */
  async crash(error) {
    this.state = ServiceState.CRASHED;
    this.lastError = error?.message || 'Unknown error';
    this._stopHealthCheck();
    
    this.restartCount++;
    
    this.eventBus.emit(EventTypes.SERVICE_CRASHED, {
      service: this.name,
      error: this.lastError,
      restartCount: this.restartCount
    });
    
    // Auto-restart if enabled
    if (this.options.restartOnCrash && this.restartCount <= this.options.maxRestarts) {
      try {
        this.state = ServiceState.READY;
        await this.start({ reason: 'auto-restart' });
      } catch (restartError) {
        this.eventBus.emit(EventTypes.SERVICE_ERROR, {
          service: this.name,
          error: restartError.message,
          phase: 'auto-restart'
        });
      }
    }
  }
  
  // =========================================================================
  // HELPERS
  // =========================================================================
  
  async _executeWithTimeout(fn, args, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeout}ms`));
      }, timeout);
      
      Promise.resolve(fn(...args))
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

// ============================================================================
// SERVICE MANAGER
// ============================================================================

export class ServiceManager {
  constructor(options = {}) {
    this.services = new Map();
    this.dependencyGraph = new Map();
    this.eventBus = getEventBus();
    this.options = {
      autoStartDependencies: options.autoStartDependencies !== false,
      ...options
    };
  }
  
  // =========================================================================
  // REGISTRATION
  // =========================================================================
  
  /**
   * Register a new service
   */
  register(name, options = {}) {
    if (this.services.has(name)) {
      throw new Error(`Service already registered: ${name}`);
    }
    
    const service = new Service(name, options);
    this.services.set(name, service);
    
    // Build dependency graph
    if (options.dependencies && options.dependencies.length > 0) {
      this.dependencyGraph.set(name, options.dependencies);
    }
    
    this.eventBus.emit(EventTypes.SERVICE_REGISTERED, {
      service: name,
      metadata: options.metadata
    });
    
    return service;
  }
  
  /**
   * Unregister a service
   */
  async unregister(name) {
    const service = this.services.get(name);
    if (!service) return false;
    
    if (service.isRunning()) {
      await service.stop('unregister');
    }
    
    this.services.delete(name);
    this.dependencyGraph.delete(name);
    
    return true;
  }
  
  /**
   * Get a service by name
   */
  get(name) {
    return this.services.get(name) || null;
  }
  
  /**
   * Check if service exists
   */
  has(name) {
    return this.services.has(name);
  }
  
  // =========================================================================
  // LIFECYCLE MANAGEMENT
  // =========================================================================
  
  /**
   * Initialize all services (respecting dependencies)
   */
  async initAll(context = {}) {
    const order = this._getInitializationOrder();
    const results = {};
    
    for (const name of order) {
      const service = this.services.get(name);
      if (service && service.state === ServiceState.CREATED) {
        try {
          await service.init(context);
          results[name] = { success: true };
        } catch (error) {
          results[name] = { success: false, error: error.message };
        }
      }
    }
    
    return results;
  }
  
  /**
   * Start all services (respecting dependencies)
   */
  async startAll(context = {}) {
    const order = this._getInitializationOrder();
    const results = {};
    
    for (const name of order) {
      const service = this.services.get(name);
      if (service && (service.state === ServiceState.READY || service.state === ServiceState.STOPPED)) {
        try {
          await service.start(context);
          results[name] = { success: true };
        } catch (error) {
          results[name] = { success: false, error: error.message };
        }
      }
    }
    
    return results;
  }
  
  /**
   * Stop all services (reverse dependency order)
   */
  async stopAll(reason = 'shutdown') {
    const order = this._getInitializationOrder().reverse();
    const results = {};
    
    for (const name of order) {
      const service = this.services.get(name);
      if (service && service.isRunning()) {
        try {
          await service.stop(reason);
          results[name] = { success: true };
        } catch (error) {
          results[name] = { success: false, error: error.message };
        }
      }
    }
    
    return results;
  }
  
  /**
   * Start a single service (with dependencies)
   */
  async start(name, context = {}) {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }
    
    // Start dependencies first
    if (this.options.autoStartDependencies) {
      const deps = this.dependencyGraph.get(name) || [];
      for (const dep of deps) {
        const depService = this.services.get(dep);
        if (depService && !depService.isRunning()) {
          await this.start(dep, context);
        }
      }
    }
    
    return service.start(context);
  }
  
  /**
   * Stop a single service
   */
  async stop(name, reason = 'manual') {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }
    
    return service.stop(reason);
  }
  
  /**
   * Restart a service
   */
  async restart(name, reason = 'manual') {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`Service not found: ${name}`);
    }
    
    return service.restart(reason);
  }
  
  // =========================================================================
  // STATUS & INFO
  // =========================================================================
  
  /**
   * Get all services status
   */
  getStatus() {
    const services = {};
    
    for (const [name, service] of this.services) {
      services[name] = service.getStatus();
    }
    
    return {
      total: this.services.size,
      running: this._countByState(ServiceState.RUNNING),
      stopped: this._countByState(ServiceState.STOPPED),
      error: this._countByState(ServiceState.ERROR) + this._countByState(ServiceState.CRASHED),
      services
    };
  }
  
  /**
   * Get service names by state
   */
  getByState(state) {
    const names = [];
    for (const [name, service] of this.services) {
      if (service.state === state) {
        names.push(name);
      }
    }
    return names;
  }
  
  /**
   * List all service names
   */
  list() {
    return Array.from(this.services.keys());
  }
  
  // =========================================================================
  // DEPENDENCY GRAPH
  // =========================================================================
  
  /**
   * Get initialization order (topological sort)
   */
  _getInitializationOrder() {
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
    
    for (const name of this.services.keys()) {
      visit(name);
    }
    
    return order;
  }
  
  _countByState(state) {
    let count = 0;
    for (const service of this.services.values()) {
      if (service.state === state) count++;
    }
    return count;
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let globalManager = null;

export function getServiceManager(options = {}) {
  if (!globalManager) {
    globalManager = new ServiceManager(options);
  }
  return globalManager;
}

export function createServiceManager(options = {}) {
  return new ServiceManager(options);
}
