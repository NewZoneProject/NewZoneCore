// Module: Dependency Injection Container
// Description: Replaces global singletons with proper dependency injection
//              for better testability, configurability, and memory management.
// File: core/container.js

import { EventEmitter } from 'events';

// ============================================================================
// SERVICE LIFECYCLE
// ============================================================================

export const ServiceLifetime = {
  SINGLETON: 'singleton',    // One instance for the lifetime of the container
  SCOPED: 'scoped',          // One instance per scope
  TRANSIENT: 'transient'     // New instance every time
};

// ============================================================================
// SERVICE DESCRIPTOR
// ============================================================================

class ServiceDescriptor {
  constructor(options) {
    this.token = options.token;
    this.factory = options.factory;
    this.lifetime = options.lifetime || ServiceLifetime.SINGLETON;
    this.instance = null;
    this.disposing = false;
  }
  
  async create(container) {
    if (this.lifetime === ServiceLifetime.SINGLETON && this.instance) {
      return this.instance;
    }
    
    const instance = await this.factory(container);
    
    if (this.lifetime === ServiceLifetime.SINGLETON) {
      this.instance = instance;
    }
    
    return instance;
  }
  
  async dispose() {
    if (this.instance && typeof this.instance.dispose === 'function') {
      await this.instance.dispose();
    }
    this.instance = null;
  }
}

// ============================================================================
// SERVICE CONTAINER
// ============================================================================

export class ServiceContainer extends EventEmitter {
  constructor(parent = null) {
    super();
    this._services = new Map();
    this._instances = new Map();
    this._parent = parent;
    this._disposed = false;
  }
  
  // ==========================================================================
  // REGISTRATION
  // ==========================================================================
  
  /**
   * Register a service with the container
   * @param {string} token - Service identifier
   * @param {Function} factory - Factory function that creates the service
   * @param {string} lifetime - Service lifetime (singleton, scoped, transient)
   */
  register(token, factory, lifetime = ServiceLifetime.SINGLETON) {
    if (this._disposed) {
      throw new Error('Container has been disposed');
    }
    
    const descriptor = new ServiceDescriptor({
      token,
      factory,
      lifetime
    });
    
    this._services.set(token, descriptor);
    
    this.emit('service:registered', { token, lifetime });
    
    return this; // Fluent API
  }
  
  /**
   * Register a singleton service
   */
  registerSingleton(token, factory) {
    return this.register(token, factory, ServiceLifetime.SINGLETON);
  }
  
  /**
   * Register a scoped service
   */
  registerScoped(token, factory) {
    return this.register(token, factory, ServiceLifetime.SCOPED);
  }
  
  /**
   * Register a transient service
   */
  registerTransient(token, factory) {
    return this.register(token, factory, ServiceLifetime.TRANSIENT);
  }
  
  /**
   * Register an existing instance
   */
  registerInstance(token, instance) {
    if (this._disposed) {
      throw new Error('Container has been disposed');
    }
    
    this._instances.set(token, instance);
    
    this.emit('service:registered', { token, lifetime: 'instance' });
    
    return this;
  }
  
  // ==========================================================================
  // RESOLUTION
  // ==========================================================================
  
  /**
   * Resolve a service by token
   * @param {string} token - Service identifier
   * @returns {Promise<any>} Service instance
   */
  async resolve(token) {
    if (this._disposed) {
      throw new Error('Container has been disposed');
    }
    
    // Check for direct instance
    if (this._instances.has(token)) {
      return this._instances.get(token);
    }
    
    // Check for registered service
    const descriptor = this._services.get(token);
    
    if (descriptor) {
      const instance = await descriptor.create(this);
      this.emit('service:resolved', { token });
      return instance;
    }
    
    // Check parent container
    if (this._parent) {
      return this._parent.resolve(token);
    }
    
    throw new Error(`Service not found: ${token}`);
  }
  
  /**
   * Try to resolve a service, returns null if not found
   */
  async tryResolve(token) {
    try {
      return await this.resolve(token);
    } catch {
      return null;
    }
  }
  
  /**
   * Check if a service is registered
   */
  has(token) {
    return this._services.has(token) || 
           this._instances.has(token) ||
           (this._parent?.has(token) ?? false);
  }
  
  // ==========================================================================
  // SCOPE
  // ==========================================================================
  
  /**
   * Create a scoped container
   */
  createScope() {
    const scope = new ServiceContainer(this);
    this.emit('scope:created', { scope });
    return scope;
  }
  
  // ==========================================================================
  // DISPOSAL
  // ==========================================================================
  
  /**
   * Dispose all services
   */
  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    
    this.emit('container:disposing');
    
    // Dispose all service descriptors
    for (const descriptor of this._services.values()) {
      try {
        await descriptor.dispose();
      } catch (error) {
        this.emit('error', { token: descriptor.token, error });
      }
    }
    
    // Dispose direct instances
    for (const [token, instance] of this._instances) {
      if (instance && typeof instance.dispose === 'function') {
        try {
          await instance.dispose();
        } catch (error) {
          this.emit('error', { token, error });
        }
      }
    }
    
    this._services.clear();
    this._instances.clear();
    
    this.emit('container:disposed');
  }
  
  // ==========================================================================
  // UTILITIES
  // ==========================================================================
  
  /**
   * Get all registered service tokens
   */
  getRegisteredServices() {
    const tokens = [...this._services.keys(), ...this._instances.keys()];
    if (this._parent) {
      tokens.push(...this._parent.getRegisteredServices());
    }
    return [...new Set(tokens)];
  }
  
  /**
   * Get service descriptors
   */
  getServiceDescriptors() {
    return new Map(this._services);
  }
}

// ============================================================================
// SERVICE TOKENS
// ============================================================================

export const ServiceTokens = {
  // Core services
  EVENT_BUS: 'EventBus',
  CONFIG: 'Config',
  LOGGER: 'Logger',
  
  // Crypto services
  MASTER_KEY: 'MasterKey',
  IDENTITY: 'Identity',
  KEY_MANAGER: 'KeyManager',
  AUTH_MANAGER: 'AuthManager',
  
  // Storage services
  SECURE_STORAGE: 'SecureStorage',
  KV_STORE: 'KVStore',
  LOG_STORE: 'LogStore',
  
  // Network services
  CHANNEL_MANAGER: 'ChannelManager',
  ROUTING_LAYER: 'RoutingLayer',
  TRUST_SYNC: 'TrustSync',
  NODE_DISCOVERY: 'NodeDiscovery',
  
  // API services
  HTTP_API: 'HttpApi',
  IPC_API: 'IpcApi',
  
  // Lifecycle
  SERVICE_MANAGER: 'ServiceManager',
  SUPERVISOR: 'Supervisor'
};

// ============================================================================
// CONTAINER BUILDER
// ============================================================================

export class ContainerBuilder {
  constructor() {
    this._registrations = [];
  }
  
  /**
   * Add a singleton service
   */
  addSingleton(token, factory) {
    this._registrations.push({ token, factory, lifetime: ServiceLifetime.SINGLETON });
    return this;
  }
  
  /**
   * Add a scoped service
   */
  addScoped(token, factory) {
    this._registrations.push({ token, factory, lifetime: ServiceLifetime.SCOPED });
    return this;
  }
  
  /**
   * Add a transient service
   */
  addTransient(token, factory) {
    this._registrations.push({ token, factory, lifetime: ServiceLifetime.TRANSIENT });
    return this;
  }
  
  /**
   * Add an instance
   */
  addInstance(token, instance) {
    this._registrations.push({ token, instance, isInstance: true });
    return this;
  }
  
  /**
   * Build the container
   */
  build() {
    const container = new ServiceContainer();
    
    for (const reg of this._registrations) {
      if (reg.isInstance) {
        container.registerInstance(reg.token, reg.instance);
      } else {
        container.register(reg.token, reg.factory, reg.lifetime);
      }
    }
    
    return container;
  }
}

// ============================================================================
// MODULE EXPORTS
// ============================================================================

let globalContainer = null;

/**
 * Get the global container (use sparingly, prefer DI)
 */
export function getContainer() {
  if (!globalContainer) {
    globalContainer = new ServiceContainer();
  }
  return globalContainer;
}

/**
 * Create a new container
 */
export function createContainer() {
  return new ServiceContainer();
}

/**
 * Reset the global container (for testing)
 */
export function resetContainer() {
  if (globalContainer) {
    globalContainer.dispose().catch(() => {});
  }
  globalContainer = null;
}
