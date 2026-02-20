// Example Plugin for NewZoneCore
// This plugin demonstrates the plugin API capabilities.
// File: plugins/example/index.js

import { Plugin, PluginCapability, PluginPermission } from '../../core/plugins/api.js';

export default class ExamplePlugin extends Plugin {
  constructor() {
    super();
    
    this.name = 'example-plugin';
    this.version = '1.0.0';
    this.description = 'Example plugin demonstrating NewZoneCore plugin API';
    this.author = 'NewZoneCore Team';
    this.license = 'MIT';
  }
  
  /**
   * Initialize the plugin.
   */
  async init(context) {
    await super.init(context);
    
    this.context.log('info', 'Example plugin initialized');
    
    // Register event handler
    this.context.onEvent('core:started', (data) => {
      this.context.log('info', 'Core started event received', data);
    });
    
    // Register HTTP endpoint (if permitted)
    if (this.context.permissions.includes(PluginPermission.REGISTER_ENDPOINT)) {
      this.context.registerEndpoint('/api/plugins/example', async (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          plugin: this.name,
          version: this.version,
          state: this.state,
          message: 'Hello from Example Plugin!'
        }));
      });
    }
    
    // Store some data
    await this.context.set('initializedAt', new Date().toISOString());
    await this.context.set('counter', 0);
    
    this.context.log('info', 'Example plugin setup complete');
  }
  
  /**
   * Start the plugin.
   */
  async start() {
    await super.start();
    
    this.context.log('info', 'Example plugin started');
    
    // Start a background task
    this._interval = setInterval(async () => {
      const counter = await this.context.get('counter') || 0;
      await this.context.set('counter', counter + 1);
      this.context.log('debug', 'Background task running', { counter: counter + 1 });
    }, 60000); // Every minute
  }
  
  /**
   * Stop the plugin.
   */
  async stop() {
    // Clear background task
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    
    await super.stop();
    this.context.log('info', 'Example plugin stopped');
  }
  
  /**
   * Custom plugin method.
   */
  async getStats() {
    const initializedAt = await this.context.get('initializedAt');
    const counter = await this.context.get('counter');
    
    return {
      name: this.name,
      version: this.version,
      state: this.state,
      initializedAt,
      counter,
      uptime: Date.now() - this._startTime
    };
  }
}
