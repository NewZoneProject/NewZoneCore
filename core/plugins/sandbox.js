// Module: Plugin Sandbox
// Description: Sandboxed execution environment for NewZoneCore plugins.
//              Provides security isolation and resource limits.
// File: core/plugins/sandbox.js

import { EventEmitter } from 'events';
import { PluginError, PluginPermission } from './api.js';

// ============================================================================
// SANDBOX CONFIGURATION
// ============================================================================

export const SandboxLevel = {
  NONE: 'none',           // No sandbox (full access)
  STANDARD: 'standard',   // Standard isolation
  STRICT: 'strict',       // Strict isolation
  CUSTOM: 'custom'        // Custom configuration
};

export const ResourceLimits = {
  MAX_MEMORY: 128 * 1024 * 1024, // 128 MB
  MAX_CPU: 50,                   // 50%
  MAX_DISK: 1024 * 1024 * 1024,  // 1 GB
  MAX_NETWORK_CONNECTIONS: 10,
  MAX_FILE_DESCRIPTORS: 100,
  TIMEOUT: 30000                 // 30 seconds
};

// ============================================================================
// SANDBOXED CONTEXT
// ============================================================================

/**
 * Creates a sandboxed context for plugin execution.
 */
export class PluginSandbox extends EventEmitter {
  constructor(options = {}) {
    super();

    this.pluginId = options.pluginId;
    this.level = options.level || SandboxLevel.STANDARD;
    this.limits = { ...ResourceLimits, ...options.limits };
    this.permissions = options.permissions || [];

    this.vm = null;
    this.resources = {
      memory: 0,
      cpu: 0,
      disk: 0,
      network: 0
    };

    this._createSandbox();
  }

  /**
   * Create sandboxed environment.
   */
  _createSandbox() {
    switch (this.level) {
      case SandboxLevel.NONE:
        this.vm = this._createNoSandbox();
        break;
      case SandboxLevel.STANDARD:
        this.vm = this._createStandardSandbox();
        break;
      case SandboxLevel.STRICT:
        this.vm = this._createStrictSandbox();
        break;
      case SandboxLevel.CUSTOM:
        this.vm = this._createCustomSandbox();
        break;
    }

    this.emit('created', { level: this.level });
  }

  /**
   * Create no sandbox (full access).
   * Use only for trusted plugins.
   */
  _createNoSandbox() {
    return {
      run: async (code, context) => {
        // Direct execution (not recommended)
        const fn = new Function('context', code);
        return fn(context);
      }
    };
  }

  /**
   * Create standard sandbox.
   * Balanced security and functionality.
   */
  _createStandardSandbox() {
    const sandbox = {
      console: {
        log: (...args) => this.emit('console:log', args),
        warn: (...args) => this.emit('console:warn', args),
        error: (...args) => this.emit('console:error', args),
        info: (...args) => this.emit('console:info', args)
      },
      setTimeout: global.setTimeout.bind(global),
      clearTimeout: global.clearTimeout.bind(global),
      setInterval: global.setInterval.bind(global),
      clearInterval: global.clearInterval.bind(global),
      Buffer: Buffer,
      process: {
        env: {},
        version: process.version,
        platform: process.platform
      }
    };

    return {
      run: async (code, context) => {
        try {
          // Use Node.js vm module for basic isolation
          const vm = await import('vm');
          const contextObject = { ...sandbox, ...context };
          vm.createContext(contextObject);
          
          const result = vm.runInContext(code, contextObject, {
            timeout: this.limits.TIMEOUT,
            displayErrors: true
          });
          
          return result;
        } catch (error) {
          throw new PluginError(`Sandbox execution failed: ${error.message}`, {
            pluginId: this.pluginId,
            code: 'SANDBOX_EXECUTION_ERROR'
          });
        }
      }
    };
  }

  /**
   * Create strict sandbox.
   * Maximum security isolation.
   */
  _createStrictSandbox() {
    const sandbox = {
      console: {
        log: (...args) => this.emit('console:log', args),
        warn: (...args) => this.emit('console:warn', args),
        error: (...args) => this.emit('console:error', args),
        info: (...args) => this.emit('console:info', args)
      },
      setTimeout: global.setTimeout.bind(global),
      clearTimeout: global.clearTimeout.bind(global),
      process: {
        env: {},
        version: process.version,
        platform: process.platform,
        pid: undefined,
        ppid: undefined
      }
    };

    return {
      run: async (code, context) => {
        try {
          const vm = await import('vm');
          const contextObject = { ...sandbox, ...context };
          vm.createContext(contextObject);
          
          const result = vm.runInContext(code, contextObject, {
            timeout: this.limits.TIMEOUT / 2,
            displayErrors: true
          });
          
          return result;
        } catch (error) {
          throw new PluginError(`Strict sandbox execution failed: ${error.message}`, {
            pluginId: this.pluginId,
            code: 'SANDBOX_STRICT_ERROR'
          });
        }
      }
    };
  }

  /**
   * Create custom sandbox.
   * Configurable isolation.
   */
  _createCustomSandbox() {
    const sandbox = {
      console: {
        log: (...args) => this.emit('console:log', args),
        warn: (...args) => this.emit('console:warn', args),
        error: (...args) => this.emit('console:error', args),
        info: (...args) => this.emit('console:info', args)
      }
    };

    // Add allowed globals
    if (this.permissions.includes(PluginPermission.EXECUTE_SERVICE)) {
      sandbox.setTimeout = global.setTimeout.bind(global);
      sandbox.setInterval = global.setInterval.bind(global);
    }

    if (this.permissions.includes(PluginPermission.WRITE_STORAGE)) {
      sandbox.Buffer = Buffer;
    }

    return {
      run: async (code, context) => {
        try {
          const vm = await import('vm');
          const contextObject = { ...sandbox, ...context };
          vm.createContext(contextObject);
          
          const result = vm.runInContext(code, contextObject, {
            timeout: this.limits.TIMEOUT,
            displayErrors: true
          });
          
          return result;
        } catch (error) {
          throw new PluginError(`Custom sandbox execution failed: ${error.message}`, {
            pluginId: this.pluginId,
            code: 'SANDBOX_CUSTOM_ERROR'
          });
        }
      }
    };
  }

  /**
   * Run code in sandbox.
   */
  async run(code, context = {}) {
    this.emit('run:start', { code: code.substring(0, 100) + '...' });

    const startTime = Date.now();
    let result;

    try {
      result = await this.vm.run(code, context);
      this.emit('run:success', { duration: Date.now() - startTime });
      return result;
    } catch (error) {
      this.emit('run:error', { error, duration: Date.now() - startTime });
      throw error;
    }
  }

  /**
   * Get resource usage.
   */
  getResourceUsage() {
    return {
      ...this.resources,
      memoryPercent: (this.resources.memory / this.limits.MAX_MEMORY) * 100,
      cpuPercent: (this.resources.cpu / this.limits.MAX_CPU) * 100,
      diskPercent: (this.resources.disk / this.limits.MAX_DISK) * 100
    };
  }

  /**
   * Check if resource limit exceeded.
   */
  checkLimits() {
    const violations = [];

    if (this.resources.memory > this.limits.MAX_MEMORY) {
      violations.push(`Memory limit exceeded: ${this.resources.memory} > ${this.limits.MAX_MEMORY}`);
    }

    if (this.resources.cpu > this.limits.MAX_CPU) {
      violations.push(`CPU limit exceeded: ${this.resources.cpu}% > ${this.limits.MAX_CPU}%`);
    }

    if (this.resources.disk > this.limits.MAX_DISK) {
      violations.push(`Disk limit exceeded: ${this.resources.disk} > ${this.limits.MAX_DISK}`);
    }

    return {
      ok: violations.length === 0,
      violations
    };
  }

  /**
   * Destroy sandbox.
   */
  destroy() {
    this.vm = null;
    this.resources = { memory: 0, cpu: 0, disk: 0, network: 0 };
    this.emit('destroyed');
  }
}

// ============================================================================
// CAPABILITY CHECKER
// ============================================================================

export class CapabilityChecker {
  constructor(permissions) {
    this.permissions = new Set(permissions);
  }

  /**
   * Check if capability is allowed.
   */
  can(capability) {
    return this.permissions.has(capability);
  }

  /**
   * Check multiple capabilities.
   */
  canAll(capabilities) {
    return capabilities.every(cap => this.can(cap));
  }

  /**
   * Check if any capability is allowed.
   */
  canAny(capabilities) {
    return capabilities.some(cap => this.can(cap));
  }

  /**
   * Require capability or throw error.
   */
  require(capability, message) {
    if (!this.can(capability)) {
      throw new PluginError(
        message || `Required capability: ${capability}`,
        { code: 'MISSING_CAPABILITY' }
      );
    }
  }

  /**
   * Get all permissions.
   */
  getPermissions() {
    return Array.from(this.permissions);
  }
}

// ============================================================================
// API GATEWAY FOR PLUGINS
// ============================================================================

export class PluginAPIGateway {
  constructor(options = {}) {
    this.supervisor = options.supervisor;
    this.storage = options.storage;
    this.eventBus = options.eventBus;
    this.registeredEndpoints = new Map();
    this.registeredCommands = new Map();
  }

  /**
   * Register HTTP endpoint for plugin.
   */
  registerEndpoint(pluginId, path, handler, options = {}) {
    const key = `${pluginId}:${path}`;

    if (this.registeredEndpoints.has(key)) {
      throw new PluginError(`Endpoint already registered: ${path}`, {
        pluginId,
        code: 'ENDPOINT_EXISTS'
      });
    }

    // Wrap handler with security checks
    const wrappedHandler = async (req, res) => {
      try {
        await handler(req, res);
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: error.message }));
      }
    };

    this.registeredEndpoints.set(key, {
      pluginId,
      path,
      handler: wrappedHandler,
      options,
      registeredAt: new Date().toISOString()
    });

    return wrappedHandler;
  }

  /**
   * Unregister HTTP endpoint.
   */
  unregisterEndpoint(pluginId, path) {
    const key = `${pluginId}:${path}`;
    return this.registeredEndpoints.delete(key);
  }

  /**
   * Register IPC command for plugin.
   */
  registerCommand(pluginId, name, handler, options = {}) {
    const key = `${pluginId}:${name}`;

    if (this.registeredCommands.has(key)) {
      throw new PluginError(`Command already registered: ${name}`, {
        pluginId,
        code: 'COMMAND_EXISTS'
      });
    }

    // Wrap handler with security checks
    const wrappedHandler = async (args, context) => {
      try {
        return await handler(args, context);
      } catch (error) {
        throw new PluginError(`Command execution failed: ${error.message}`, {
          pluginId,
          code: 'COMMAND_EXECUTION_ERROR'
        });
      }
    };

    this.registeredCommands.set(key, {
      pluginId,
      name,
      handler: wrappedHandler,
      options,
      registeredAt: new Date().toISOString()
    });

    return wrappedHandler;
  }

  /**
   * Unregister IPC command.
   */
  unregisterCommand(pluginId, name) {
    const key = `${pluginId}:${name}`;
    return this.registeredCommands.delete(key);
  }

  /**
   * Get all registered endpoints.
   */
  getEndpoints() {
    return Array.from(this.registeredEndpoints.values());
  }

  /**
   * Get all registered commands.
   */
  getCommands() {
    return Array.from(this.registeredCommands.values());
  }

  /**
   * Clear all registrations for plugin.
   */
  clearPluginRegistrations(pluginId) {
    for (const [key, value] of this.registeredEndpoints) {
      if (value.pluginId === pluginId) {
        this.registeredEndpoints.delete(key);
      }
    }

    for (const [key, value] of this.registeredCommands) {
      if (value.pluginId === pluginId) {
        this.registeredCommands.delete(key);
      }
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  PluginSandbox,
  CapabilityChecker,
  PluginAPIGateway,
  SandboxLevel,
  ResourceLimits
};
