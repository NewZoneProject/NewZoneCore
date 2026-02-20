// Module: Plugin Loader
// Description: Dynamic plugin loader with sandboxed execution for NewZoneCore.
// File: core/plugins/loader.js

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import {
  Plugin,
  PluginContext,
  PluginManifest,
  PluginState,
  PluginError
} from './api.js';
import { getEventBus } from '../eventbus/index.js';
import { getLogger } from '../logger.js';

// ============================================================================
// PLUGIN LOADER
// ============================================================================

export class PluginLoader extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.pluginsDir = options.pluginsDir || './plugins';
    this.supervisor = options.supervisor || null;
    this.storage = options.storage || null;
    this.eventBus = getEventBus();
    this.logger = getLogger({ module: 'plugin-loader' });
    
    this.plugins = new Map(); // id -> plugin instance
    this.pluginPaths = new Map(); // id -> plugin path
  }
  
  /**
   * Initialize plugin loader.
   */
  async init() {
    this.logger.info('Initializing plugin loader');
    
    // Ensure plugins directory exists
    try {
      await fs.mkdir(this.pluginsDir, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create plugins directory', { error: error.message });
    }
    
    this.emit('initialized');
  }
  
  /**
   * Load all plugins from plugins directory.
   */
  async loadAll() {
    this.logger.info('Loading all plugins');
    
    try {
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await this.loadPlugin(entry.name);
        }
      }
      
      this.logger.info('All plugins loaded', { count: this.plugins.size });
      this.emit('all:loaded');
    } catch (error) {
      this.logger.error('Failed to load plugins', { error: error.message });
      throw error;
    }
  }
  
  /**
   * Load a single plugin.
   */
  async loadPlugin(pluginId) {
    const pluginPath = path.join(this.pluginsDir, pluginId);
    
    try {
      this.logger.info('Loading plugin', { pluginId });
      
      // Load manifest
      const manifestPath = path.join(pluginPath, 'plugin.json');
      const manifestData = await fs.readFile(manifestPath, 'utf8');
      const manifest = PluginManifest.fromJSON(JSON.parse(manifestData));
      
      // Validate manifest
      const validation = manifest.validate();
      if (!validation.valid) {
        throw new PluginError(`Invalid manifest: ${validation.errors.join(', ')}`, { pluginId });
      }
      
      // Load plugin module
      const mainPath = path.join(pluginPath, manifest.main);
      const PluginClass = (await import(mainPath)).default;
      
      if (!PluginClass || !(PluginClass.prototype instanceof Plugin)) {
        throw new PluginError('Plugin must extend base Plugin class', { pluginId });
      }
      
      // Create plugin instance
      const plugin = new PluginClass();
      
      // Create plugin context
      const context = new PluginContext({
        pluginId,
        pluginName: manifest.name,
        config: manifest.config,
        capabilities: manifest.capabilities,
        permissions: manifest.permissions,
        supervisor: this.supervisor,
        logger: getLogger({ module: `plugin:${pluginId}` }),
        storage: this.storage,
        eventBus: this.eventBus
      });
      
      // Initialize plugin
      await plugin.init(context);
      
      // Store plugin
      this.plugins.set(pluginId, plugin);
      this.pluginPaths.set(pluginId, pluginPath);
      
      this.logger.info('Plugin loaded', { pluginId, version: manifest.version });
      this.emit('plugin:loaded', { pluginId, manifest });
      
      return plugin;
      
    } catch (error) {
      this.logger.error('Failed to load plugin', { pluginId, error: error.message });
      this.emit('plugin:error', { pluginId, error });
      throw error;
    }
  }
  
  /**
   * Start a plugin.
   */
  async startPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    
    if (!plugin) {
      throw new PluginError(`Plugin not found: ${pluginId}`, { pluginId });
    }
    
    try {
      this.logger.info('Starting plugin', { pluginId });
      plugin.setState(PluginState.STARTING);
      
      await plugin.start();
      
      this.logger.info('Plugin started', { pluginId });
      this.emit('plugin:started', { pluginId });
    } catch (error) {
      this.logger.error('Failed to start plugin', { pluginId, error: error.message });
      plugin.setState(PluginState.ERROR);
      throw error;
    }
  }
  
  /**
   * Stop a plugin.
   */
  async stopPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    
    if (!plugin) {
      throw new PluginError(`Plugin not found: ${pluginId}`, { pluginId });
    }
    
    try {
      this.logger.info('Stopping plugin', { pluginId });
      plugin.setState(PluginState.STOPPING);
      
      await plugin.stop();
      
      this.logger.info('Plugin stopped', { pluginId });
      this.emit('plugin:stopped', { pluginId });
    } catch (error) {
      this.logger.error('Failed to stop plugin', { pluginId, error: error.message });
      throw error;
    }
  }
  
  /**
   * Unload a plugin.
   */
  async unloadPlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    
    if (!plugin) {
      throw new PluginError(`Plugin not found: ${pluginId}`, { pluginId });
    }
    
    try {
      // Stop if running
      if (plugin.state === PluginState.RUNNING) {
        await this.stopPlugin(pluginId);
      }
      
      // Remove from registry
      this.plugins.delete(pluginId);
      this.pluginPaths.delete(pluginId);
      
      this.logger.info('Plugin unloaded', { pluginId });
      this.emit('plugin:unloaded', { pluginId });
    } catch (error) {
      this.logger.error('Failed to unload plugin', { pluginId, error: error.message });
      throw error;
    }
  }
  
  /**
   * Get plugin by ID.
   */
  getPlugin(pluginId) {
    return this.plugins.get(pluginId);
  }
  
  /**
   * List all plugins.
   */
  listPlugins() {
    const list = [];
    
    for (const [id, plugin] of this.plugins) {
      list.push({
        id,
        ...plugin.getInfo(),
        path: this.pluginPaths.get(id)
      });
    }
    
    return list;
  }
  
  /**
   * Get plugin status.
   */
  getStatus() {
    const status = {
      total: this.plugins.size,
      running: 0,
      stopped: 0,
      error: 0,
      plugins: []
    };
    
    for (const [id, plugin] of this.plugins) {
      status.plugins.push({
        id,
        state: plugin.state,
        ...plugin.getInfo()
      });
      
      if (plugin.state === PluginState.RUNNING) status.running++;
      else if (plugin.state === PluginState.ERROR) status.error++;
      else status.stopped++;
    }
    
    return status;
  }
  
  /**
   * Reload all plugins.
   */
  async reloadAll() {
    this.logger.info('Reloading all plugins');
    
    // Stop all
    for (const pluginId of this.plugins.keys()) {
      await this.stopPlugin(pluginId);
    }
    
    // Unload all
    this.plugins.clear();
    this.pluginPaths.clear();
    
    // Load all
    await this.loadAll();
    
    this.emit('all:reloaded');
  }
  
  /**
   * Shutdown plugin loader.
   */
  async shutdown() {
    this.logger.info('Shutting down plugin loader');
    
    // Stop all plugins
    for (const pluginId of this.plugins.keys()) {
      try {
        await this.stopPlugin(pluginId);
      } catch (error) {
        this.logger.error('Error stopping plugin during shutdown', { pluginId, error: error.message });
      }
    }
    
    // Clear registries
    this.plugins.clear();
    this.pluginPaths.clear();
    
    this.emit('shutdown');
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalLoader = null;

export function getPluginLoader(options = {}) {
  if (!globalLoader) {
    globalLoader = new PluginLoader(options);
  }
  return globalLoader;
}

export function createPluginLoader(options = {}) {
  return new PluginLoader(options);
}
