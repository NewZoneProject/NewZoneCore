// Module: Service Registry
// Description: Service registration and discovery for NewZoneCore network.
// File: network/discovery/service-registry.js

import { EventEmitter } from 'events';
import { NodeID } from '../dht/node-id.js';

/**
 * Service Registry Events
 */
export const ServiceRegistryEvents = {
  SERVICE_REGISTERED: 'service_registered',
  SERVICE_UNREGISTERED: 'service_unregistered',
  SERVICE_FOUND: 'service_found',
  SERVICE_EXPIRED: 'service_expired',
  HEARTBEAT: 'heartbeat'
};

/**
 * Service Info structure
 */
export class ServiceInfo {
  constructor(options) {
    this.id = options.id || this._generateId();
    this.type = options.type;           // Service type (e.g., 'trust-node', 'storage')
    this.name = options.name || this.id;
    this.nodeId = options.nodeId;       // Node ID hosting the service
    this.address = options.address;
    this.port = options.port;
    this.metadata = options.metadata || {};
    this.tags = options.tags || [];
    this.priority = options.priority || 0;
    this.weight = options.weight || 0;
    this.createdAt = options.createdAt || Date.now();
    this.updatedAt = options.updatedAt || Date.now();
    this.ttl = options.ttl || 3600;     // Time-to-live in seconds
    this.healthStatus = options.healthStatus || 'unknown'; // unknown, healthy, unhealthy
    this.lastHeartbeat = options.lastHeartbeat || Date.now();
  }

  /**
   * Generate service ID
   */
  _generateId() {
    return `svc_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Check if service is expired
   */
  isExpired() {
    const age = (Date.now() - this.lastHeartbeat) / 1000;
    return age > this.ttl;
  }

  /**
   * Update heartbeat
   */
  heartbeat(status = 'healthy') {
    this.lastHeartbeat = Date.now();
    this.updatedAt = Date.now();
    this.healthStatus = status;
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      nodeId: this.nodeId,
      address: this.address,
      port: this.port,
      metadata: this.metadata,
      tags: this.tags,
      priority: this.priority,
      weight: this.weight,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      ttl: this.ttl,
      healthStatus: this.healthStatus,
      lastHeartbeat: this.lastHeartbeat
    };
  }

  /**
   * Create from JSON
   */
  static fromJSON(data) {
    return new ServiceInfo(data);
  }
}

/**
 * Service Registry Options
 */
const DEFAULT_OPTIONS = {
  maxServices: 10000,
  heartbeatInterval: 30000,      // Check heartbeats every 30s
  defaultTTL: 3600,              // Default TTL 1 hour
  expiryCheckInterval: 60000,    // Check for expired services every minute
  enableHealthChecks: true,
  healthCheckTimeout: 5000
};

/**
 * ServiceRegistry class - manages service registration and discovery
 */
export class ServiceRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Services by ID
    this._services = new Map();
    
    // Services by type
    this._byType = new Map();
    
    // Services by node
    this._byNode = new Map();
    
    // Local services (owned by this node)
    this._localServices = new Set();
    
    // Timers
    this._expiryTimer = null;
    
    // DHT reference for distributed registry
    this._dht = null;
  }

  /**
   * Get total number of services
   */
  get serviceCount() {
    return this._services.size;
  }

  /**
   * Set DHT reference
   */
  setDHT(dht) {
    this._dht = dht;
  }

  /**
   * Start the registry
   */
  start() {
    // Start expiry checker
    this._expiryTimer = setInterval(() => {
      this._checkExpiredServices();
    }, this.options.expiryCheckInterval);
  }

  /**
   * Stop the registry
   */
  stop() {
    if (this._expiryTimer) {
      clearInterval(this._expiryTimer);
      this._expiryTimer = null;
    }
  }

  /**
   * Register a service
   */
  async register(serviceInfo) {
    const service = serviceInfo instanceof ServiceInfo 
      ? serviceInfo 
      : new ServiceInfo(serviceInfo);
    
    // Validate required fields
    if (!service.type) {
      throw new Error('Service type is required');
    }
    if (!service.address) {
      throw new Error('Service address is required');
    }
    if (!service.port) {
      throw new Error('Service port is required');
    }
    
    // Check capacity
    if (this._services.size >= this.options.maxServices && 
        !this._services.has(service.id)) {
      throw new Error('Service registry is full');
    }
    
    // Store service
    this._services.set(service.id, service);
    
    // Index by type
    if (!this._byType.has(service.type)) {
      this._byType.set(service.type, new Set());
    }
    this._byType.get(service.type).add(service.id);
    
    // Index by node
    if (service.nodeId) {
      if (!this._byNode.has(service.nodeId)) {
        this._byNode.set(service.nodeId, new Set());
      }
      this._byNode.get(service.nodeId).add(service.id);
    }
    
    // Store in DHT if available
    if (this._dht) {
      await this._storeInDHT(service);
    }
    
    this.emit(ServiceRegistryEvents.SERVICE_REGISTERED, service);
    
    return service;
  }

  /**
   * Register a local service
   */
  async registerLocal(serviceInfo) {
    const service = await this.register(serviceInfo);
    this._localServices.add(service.id);
    return service;
  }

  /**
   * Unregister a service
   */
  async unregister(serviceId) {
    const service = this._services.get(serviceId);
    
    if (!service) {
      return false;
    }
    
    // Remove from indexes
    this._services.delete(serviceId);
    
    const typeSet = this._byType.get(service.type);
    if (typeSet) {
      typeSet.delete(serviceId);
      if (typeSet.size === 0) {
        this._byType.delete(service.type);
      }
    }
    
    if (service.nodeId) {
      const nodeSet = this._byNode.get(service.nodeId);
      if (nodeSet) {
        nodeSet.delete(serviceId);
        if (nodeSet.size === 0) {
          this._byNode.delete(service.nodeId);
        }
      }
    }
    
    this._localServices.delete(serviceId);
    
    this.emit(ServiceRegistryEvents.SERVICE_UNREGISTERED, service);
    
    return true;
  }

  /**
   * Get a service by ID
   */
  get(serviceId) {
    return this._services.get(serviceId);
  }

  /**
   * Find services by type
   */
  findByType(type, options = {}) {
    const ids = this._byType.get(type);
    if (!ids) return [];
    
    let services = Array.from(ids)
      .map(id => this._services.get(id))
      .filter(s => s && !s.isExpired());
    
    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      services = services.filter(s => 
        options.tags.every(tag => s.tags.includes(tag))
      );
    }
    
    // Filter by health status
    if (options.healthStatus) {
      services = services.filter(s => s.healthStatus === options.healthStatus);
    }
    
    // Sort by priority and weight
    services.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return b.weight - a.weight;
    });
    
    // Limit results
    if (options.limit) {
      services = services.slice(0, options.limit);
    }
    
    return services;
  }

  /**
   * Find services by node
   */
  findByNode(nodeId) {
    const ids = this._byNode.get(nodeId);
    if (!ids) return [];
    
    return Array.from(ids)
      .map(id => this._services.get(id))
      .filter(s => s && !s.isExpired());
  }

  /**
   * Find all services
   */
  findAll(options = {}) {
    let services = Array.from(this._services.values())
      .filter(s => !s.isExpired());
    
    // Filter by type
    if (options.type) {
      services = services.filter(s => s.type === options.type);
    }
    
    // Filter by health
    if (options.healthStatus) {
      services = services.filter(s => s.healthStatus === options.healthStatus);
    }
    
    return services;
  }

  /**
   * Send heartbeat for a service
   */
  heartbeat(serviceId, status = 'healthy') {
    const service = this._services.get(serviceId);
    
    if (!service) {
      return false;
    }
    
    service.heartbeat(status);
    
    this.emit(ServiceRegistryEvents.HEARTBEAT, {
      serviceId,
      status
    });
    
    return true;
  }

  /**
   * Get a random service of a type
   */
  getRandomByType(type) {
    const services = this.findByType(type, { healthStatus: 'healthy' });
    
    if (services.length === 0) {
      return null;
    }
    
    return services[Math.floor(Math.random() * services.length)];
  }

  /**
   * Get a weighted random service (for load balancing)
   */
  getWeightedByType(type) {
    const services = this.findByType(type, { healthStatus: 'healthy' });
    
    if (services.length === 0) {
      return null;
    }
    
    // Calculate total weight
    const totalWeight = services.reduce((sum, s) => sum + s.weight + 1, 0);
    
    // Select based on weight
    let random = Math.random() * totalWeight;
    
    for (const service of services) {
      random -= (service.weight + 1);
      if (random <= 0) {
        return service;
      }
    }
    
    return services[0];
  }

  /**
   * Check for expired services
   */
  _checkExpiredServices() {
    const expired = [];
    
    for (const [id, service] of this._services) {
      // Don't expire local services automatically
      if (this._localServices.has(id)) {
        continue;
      }
      
      if (service.isExpired()) {
        expired.push(id);
      }
    }
    
    for (const id of expired) {
      const service = this._services.get(id);
      
      this.emit(ServiceRegistryEvents.SERVICE_EXPIRED, service);
      this.unregister(id);
    }
  }

  /**
   * Store service in DHT
   */
  async _storeInDHT(service) {
    if (!this._dht) return;
    
    try {
      const key = `service:${service.type}:${service.id}`;
      await this._dht.put(key, service.toJSON());
    } catch (e) {
      // DHT storage failed, continue
    }
  }

  /**
   * Discover services from DHT
   */
  async discoverFromDHT(type) {
    if (!this._dht) return [];
    
    try {
      const key = `service:${type}`;
      const result = await this._dht.get(key);
      
      if (result && result.value) {
        const service = ServiceInfo.fromJSON(result.value);
        
        if (!service.isExpired()) {
          this.register(service);
          return [service];
        }
      }
    } catch (e) {
      // DHT lookup failed
    }
    
    return [];
  }

  /**
   * Get registry statistics
   */
  getStats() {
    const byType = {};
    for (const [type, ids] of this._byType) {
      byType[type] = ids.size;
    }
    
    const byHealth = {
      healthy: 0,
      unhealthy: 0,
      unknown: 0
    };
    
    for (const service of this._services.values()) {
      byHealth[service.healthStatus]++;
    }
    
    return {
      totalServices: this._services.size,
      localServices: this._localServices.size,
      maxServices: this.options.maxServices,
      types: Object.keys(byType).length,
      byType,
      byHealth
    };
  }

  /**
   * Export services for persistence
   */
  export() {
    return Array.from(this._services.values()).map(s => s.toJSON());
  }

  /**
   * Import services from persistence
   */
  import(services) {
    for (const data of services) {
      try {
        const service = ServiceInfo.fromJSON(data);
        this.register(service);
      } catch (e) {
        // Skip invalid services
      }
    }
  }
}

export default ServiceRegistry;
