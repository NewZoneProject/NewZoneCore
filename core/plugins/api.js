// Module: Plugin API
// Description: Plugin system API definition for NewZoneCore.
//              Allows third-party extensions with sandboxed execution.
// File: core/plugins/api.js

import { EventEmitter } from 'events';

// ============================================================================
// PLUGIN LIFECYCLE
// ============================================================================

export const PluginState = {
  UNLOADED: 'unloaded',
  LOADING: 'loading',
  LOADED: 'loaded',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error'
};

// ============================================================================
// PLUGIN CAPABILITIES
// ============================================================================

export const PluginCapability = {
  // Service extensions
  SERVICE: 'service',
  
  // API extensions
  HTTP_ENDPOINT: 'http:endpoint',
  IPC_COMMAND: 'ipc:command',
  CLI_COMMAND: 'cli:command',
  
  // Event handlers
  EVENT_HANDLER: 'event:handler',
  
  // Storage
  STORAGE: 'storage',
  
  // Network
  NETWORK_TRANSPORT: 'network:transport',
  NETWORK_PROTOCOL: 'network:protocol',
  
  // Crypto
  CRYPTO_ALGORITHM: 'crypto:algorithm'
};

// ============================================================================
// PLUGIN PERMISSIONS
// ============================================================================

export const PluginPermission = {
  // Read permissions
  READ_STATE: 'read:state',
  READ_EVENTS: 'read:events',
  READ_STORAGE: 'read:storage',
  READ_NETWORK: 'read:network',
  
  // Write permissions
  WRITE_STATE: 'write:state',
  WRITE_STORAGE: 'write:storage',
  SEND_NETWORK: 'send:network',
  
  // Execute permissions
  EXECUTE_SERVICE: 'execute:service',
  REGISTER_ENDPOINT: 'register:endpoint',
  REGISTER_COMMAND: 'register:command',
  
  // Admin permissions
  ADMIN: 'admin'
};

// ============================================================================
// PLUGIN CONTEXT
// ============================================================================

export class PluginContext extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.pluginId = options.pluginId;
    this.pluginName = options.pluginName;
    this.config = options.config || {};
    this.state = PluginState.UNLOADED;
    this.capabilities = options.capabilities || [];
    this.permissions = options.permissions || [];
    
    // Injected dependencies (set by plugin loader)
    this.supervisor = options.supervisor || null;
    this.logger = options.logger || null;
    this.storage = options.storage || null;
    this.eventBus = options.eventBus || null;
  }
  
  /**
   * Log a message.
   */
  log(level, message, ...args) {
    if (this.logger) {
      this.logger[level](message, ...args);
    } else {
      console.log(`[${this.pluginName}] ${message}`, ...args);
    }
  }
  
  /**
   * Get supervisor state.
   */
  async getState() {
    if (!this.supervisor) {
      throw new Error('Supervisor not available');
    }
    return this.supervisor.getState();
  }
  
  /**
   * Emit an event.
   */
  emitEvent(type, payload) {
    if (!this.eventBus) {
      throw new Error('Event bus not available');
    }
    this.eventBus.emit(type, payload);
  }
  
  /**
   * Subscribe to events.
   */
  onEvent(type, handler) {
    if (!this.eventBus) {
      throw new Error('Event bus not available');
    }
    return this.eventBus.subscribe(type, handler);
  }
  
  /**
   * Store data.
   */
  async set(key, value) {
    if (!this.storage) {
      throw new Error('Storage not available');
    }
    return this.storage.set(`plugin:${this.pluginId}:${key}`, value);
  }
  
  /**
   * Get stored data.
   */
  async get(key) {
    if (!this.storage) {
      throw new Error('Storage not available');
    }
    return this.storage.get(`plugin:${this.pluginId}:${key}`);
  }
  
  /**
   * Register HTTP endpoint.
   */
  registerEndpoint(path, handler, options = {}) {
    // Will be implemented by plugin loader
    this.emit('endpoint:register', { path, handler, options });
  }
  
  /**
   * Register IPC command.
   */
  registerCommand(name, handler, options = {}) {
    // Will be implemented by plugin loader
    this.emit('command:register', { name, handler, options });
  }
  
  /**
   * Update plugin state.
   */
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    this.emit('state:change', { oldState, newState });
    this.log('debug', `State changed: ${oldState} → ${newState}`);
  }
}

// ============================================================================
// PLUGIN INTERFACE
// ============================================================================

/**
 * Plugin interface that all plugins must implement.
 */
export class Plugin {
  constructor() {
    this.name = 'unnamed';
    this.version = '0.0.0';
    this.description = '';
    this.author = '';
    this.license = 'MIT';
    
    this.context = null;
    this.state = PluginState.UNLOADED;
  }
  
  /**
   * Initialize the plugin.
   * Called once when plugin is loaded.
   */
  async init(context) {
    this.context = context;
    this.state = PluginState.LOADED;
  }
  
  /**
   * Start the plugin.
   * Called when plugin should start running.
   */
  async start() {
    this.state = PluginState.RUNNING;
  }
  
  /**
   * Stop the plugin.
   * Called when plugin should stop.
   */
  async stop() {
    this.state = PluginState.STOPPED;
  }
  
  /**
   * Get plugin info.
   */
  getInfo() {
    return {
      name: this.name,
      version: this.version,
      description: this.description,
      author: this.author,
      license: this.license,
      state: this.state
    };
  }
}

// ============================================================================
// PLUGIN MANIFEST
// ============================================================================

export class PluginManifest {
  constructor(data = {}) {
    this.name = data.name || 'unnamed-plugin';
    this.version = data.version || '0.0.0';
    this.description = data.description || '';
    this.author = data.author || '';
    this.license = data.license || 'MIT';
    this.main = data.main || 'index.js';
    this.engines = data.engines || { nzcore: '>=1.0.0' };
    this.capabilities = data.capabilities || [];
    this.permissions = data.permissions || [];
    this.config = data.config || {};
    this.dependencies = data.dependencies || [];
  }
  
  /**
   * Validate manifest.
   */
  validate() {
    const errors = [];
    
    if (!this.name || typeof this.name !== 'string') {
      errors.push('Invalid or missing name');
    }
    
    if (!this.version || typeof this.version !== 'string') {
      errors.push('Invalid or missing version');
    }
    
    if (!this.main || typeof this.main !== 'string') {
      errors.push('Invalid or missing main entry point');
    }
    
    // Validate capabilities
    const validCapabilities = Object.values(PluginCapability);
    for (const cap of this.capabilities) {
      if (!validCapabilities.includes(cap)) {
        errors.push(`Invalid capability: ${cap}`);
      }
    }
    
    // Validate permissions
    const validPermissions = Object.values(PluginPermission);
    for (const perm of this.permissions) {
      if (!validPermissions.includes(perm)) {
        errors.push(`Invalid permission: ${perm}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Load manifest from JSON.
   */
  static fromJSON(json) {
    return new PluginManifest(json);
  }
}

// ============================================================================
// PLUGIN ERROR
// ============================================================================

export class PluginError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'PluginError';
    this.pluginId = options.pluginId || null;
    this.code = options.code || 'PLUGIN_ERROR';
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  Plugin,
  PluginContext,
  PluginManifest,
  PluginState,
  PluginCapability,
  PluginPermission,
  PluginError
};
