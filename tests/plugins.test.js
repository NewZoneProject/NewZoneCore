// Test Suite: Plugin System Tests
// Description: Tests for NewZoneCore plugin API and loader
// File: tests/plugins.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import {
  Plugin,
  PluginContext,
  PluginManifest,
  PluginState,
  PluginCapability,
  PluginPermission,
  PluginError
} from '../core/plugins/api.js';
import { PluginLoader } from '../core/plugins/loader.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

let testDir;

async function createTestPlugin(name, manifest, code) {
  const pluginDir = path.join(testDir, name);
  await fs.mkdir(pluginDir, { recursive: true });
  
  await fs.writeFile(
    path.join(pluginDir, 'plugin.json'),
    JSON.stringify(manifest, null, 2)
  );
  
  await fs.writeFile(
    path.join(pluginDir, manifest.main || 'index.js'),
    code
  );
  
  return pluginDir;
}

// ============================================================================
// PLUGIN API TESTS
// ============================================================================

describe('Plugin API', () => {
  describe('Plugin Class', () => {
    it('should create plugin with metadata', () => {
      const plugin = new Plugin();
      
      expect(plugin.name).toBe('unnamed');
      expect(plugin.version).toBe('0.0.0');
      expect(plugin.state).toBe(PluginState.UNLOADED);
    });
    
    it('should initialize plugin', async () => {
      class TestPlugin extends Plugin {
        constructor() {
          super();
          this.name = 'test-plugin';
          this.version = '1.0.0';
        }
      }
      
      const plugin = new TestPlugin();
      const context = { pluginId: 'test' };
      
      await plugin.init(context);
      
      expect(plugin.context).toBe(context);
      expect(plugin.state).toBe(PluginState.LOADED);
    });
    
    it('should start and stop plugin', async () => {
      class TestPlugin extends Plugin {
        constructor() {
          super();
          this.name = 'test-plugin';
        }
      }
      
      const plugin = new TestPlugin();
      await plugin.init({});
      await plugin.start();
      
      expect(plugin.state).toBe(PluginState.RUNNING);
      
      await plugin.stop();
      expect(plugin.state).toBe(PluginState.STOPPED);
    });
    
    it('should get plugin info', () => {
      class TestPlugin extends Plugin {
        constructor() {
          super();
          this.name = 'test-plugin';
          this.version = '1.0.0';
          this.description = 'Test plugin';
        }
      }
      
      const plugin = new TestPlugin();
      const info = plugin.getInfo();
      
      expect(info.name).toBe('test-plugin');
      expect(info.version).toBe('1.0.0');
      expect(info.description).toBe('Test plugin');
    });
  });
  
  describe('PluginManifest', () => {
    it('should create manifest with defaults', () => {
      const manifest = new PluginManifest();
      
      expect(manifest.name).toBe('unnamed-plugin');
      expect(manifest.version).toBe('0.0.0');
      expect(manifest.license).toBe('MIT');
    });
    
    it('should create manifest from data', () => {
      const manifest = new PluginManifest({
        name: 'my-plugin',
        version: '2.0.0',
        description: 'My plugin'
      });
      
      expect(manifest.name).toBe('my-plugin');
      expect(manifest.version).toBe('2.0.0');
      expect(manifest.description).toBe('My plugin');
    });
    
    it('should validate valid manifest', () => {
      const manifest = new PluginManifest({
        name: 'valid-plugin',
        version: '1.0.0',
        main: 'index.js'
      });
      
      const result = manifest.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('should reject invalid manifest', () => {
      const manifest = new PluginManifest({
        name: '',  // Invalid: empty name
        version: '',  // Invalid: empty version
        main: ''  // Invalid: empty main
      });

      const result = manifest.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
    
    it('should load from JSON', () => {
      const json = {
        name: 'json-plugin',
        version: '1.0.0'
      };
      
      const manifest = PluginManifest.fromJSON(json);
      
      expect(manifest.name).toBe('json-plugin');
      expect(manifest.version).toBe('1.0.0');
    });
  });
  
  describe('PluginState', () => {
    it('should have all state values', () => {
      expect(PluginState.UNLOADED).toBe('unloaded');
      expect(PluginState.LOADING).toBe('loading');
      expect(PluginState.LOADED).toBe('loaded');
      expect(PluginState.STARTING).toBe('starting');
      expect(PluginState.RUNNING).toBe('running');
      expect(PluginState.STOPPING).toBe('stopping');
      expect(PluginState.STOPPED).toBe('stopped');
      expect(PluginState.ERROR).toBe('error');
    });
  });
  
  describe('PluginCapability', () => {
    it('should have all capabilities', () => {
      expect(PluginCapability.SERVICE).toBe('service');
      expect(PluginCapability.HTTP_ENDPOINT).toBe('http:endpoint');
      expect(PluginCapability.IPC_COMMAND).toBe('ipc:command');
      expect(PluginCapability.EVENT_HANDLER).toBe('event:handler');
      expect(PluginCapability.STORAGE).toBe('storage');
    });
  });
  
  describe('PluginPermission', () => {
    it('should have all permissions', () => {
      expect(PluginPermission.READ_STATE).toBe('read:state');
      expect(PluginPermission.WRITE_STORAGE).toBe('write:storage');
      expect(PluginPermission.REGISTER_ENDPOINT).toBe('register:endpoint');
      expect(PluginPermission.ADMIN).toBe('admin');
    });
  });
  
  describe('PluginError', () => {
    it('should create error with pluginId', () => {
      const error = new PluginError('Test error', { pluginId: 'test' });
      
      expect(error.name).toBe('PluginError');
      expect(error.message).toBe('Test error');
      expect(error.pluginId).toBe('test');
    });
  });
});

// ============================================================================
// PLUGIN LOADER TESTS
// ============================================================================

describe('PluginLoader', () => {
  beforeEach(async () => {
    testDir = path.join(tmpdir(), `nzcore-plugin-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });
  
  it('should initialize loader', async () => {
    const loader = new PluginLoader({ pluginsDir: testDir });
    await loader.init();
    
    expect(loader.plugins.size).toBe(0);
  });
  
  it('should load plugin from directory', async () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      main: 'index.js'
    };

    const code = `
import { Plugin } from 'nzcore/plugins';

export default class TestPlugin extends Plugin {
  constructor() {
    super();
    this.name = 'test-plugin';
    this.version = '1.0.0';
  }
};
`;
    
    await createTestPlugin('test-plugin', manifest, code);
    
    const loader = new PluginLoader({ pluginsDir: testDir });
    await loader.init();
    await loader.loadAll();
    
    expect(loader.plugins.size).toBe(1);
    expect(loader.getPlugin('test-plugin')).toBeDefined();
  });
  
  it('should start and stop plugin', async () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      main: 'index.js'
    };
    
    const code = `
import { Plugin } from 'nzcore/plugins';

export default class TestPlugin extends Plugin {
  constructor() {
    super();
    this.name = 'test-plugin';
  }
};
`;
    
    await createTestPlugin('test-plugin', manifest, code);
    
    const loader = new PluginLoader({ pluginsDir: testDir });
    await loader.init();
    await loader.loadAll();
    await loader.startPlugin('test-plugin');
    
    const plugin = loader.getPlugin('test-plugin');
    expect(plugin.state).toBe(PluginState.RUNNING);
    
    await loader.stopPlugin('test-plugin');
    expect(plugin.state).toBe(PluginState.STOPPED);
  });
  
  it('should list plugins', async () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      main: 'index.js'
    };
    
    const code = `
import { Plugin } from 'nzcore/plugins';
export default class TestPlugin extends Plugin {
  constructor() {
    super();
    this.name = 'test-plugin';
  }
};
`;
    
    await createTestPlugin('test-plugin', manifest, code);
    
    const loader = new PluginLoader({ pluginsDir: testDir });
    await loader.init();
    await loader.loadAll();
    
    const plugins = loader.listPlugins();
    expect(plugins.length).toBe(1);
    expect(plugins[0].name).toBe('test-plugin');
  });
  
  it('should get plugin status', async () => {
    const loader = new PluginLoader({ pluginsDir: testDir });
    await loader.init();
    
    const status = loader.getStatus();
    
    expect(status.total).toBe(0);
    expect(status.running).toBe(0);
    expect(status.stopped).toBe(0);
    expect(status.error).toBe(0);
  });
  
  it('should reject invalid plugin', async () => {
    const manifest = {
      name: 'invalid-plugin',
      version: '1.0.0',
      main: 'nonexistent.js'
    };
    
    await createTestPlugin('invalid-plugin', manifest, '');
    
    const loader = new PluginLoader({ pluginsDir: testDir });
    await loader.init();
    
    await expect(loader.loadAll()).rejects.toThrow();
  });
  
  it('should unload plugin', async () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      main: 'index.js'
    };
    
    const code = `
import { Plugin } from 'nzcore/plugins';
export default class TestPlugin extends Plugin {
  constructor() {
    super();
    this.name = 'test-plugin';
  }
};
`;
    
    await createTestPlugin('test-plugin', manifest, code);
    
    const loader = new PluginLoader({ pluginsDir: testDir });
    await loader.init();
    await loader.loadAll();
    await loader.unloadPlugin('test-plugin');
    
    expect(loader.getPlugin('test-plugin')).toBeUndefined();
  });
  
  it('should shutdown gracefully', async () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      main: 'index.js'
    };
    
    const code = `
import { Plugin } from 'nzcore/plugins';
export default class TestPlugin extends Plugin {
  constructor() {
    super();
    this.name = 'test-plugin';
  }
};
`;
    
    await createTestPlugin('test-plugin', manifest, code);
    
    const loader = new PluginLoader({ pluginsDir: testDir });
    await loader.init();
    await loader.loadAll();
    await loader.startPlugin('test-plugin');
    
    await loader.shutdown();
    
    expect(loader.plugins.size).toBe(0);
  });
});

// ============================================================================
// PLUGIN CONTEXT TESTS
// ============================================================================

describe('PluginContext', () => {
  it('should create context with options', () => {
    const context = new PluginContext({
      pluginId: 'test',
      pluginName: 'Test Plugin',
      config: { key: 'value' }
    });
    
    expect(context.pluginId).toBe('test');
    expect(context.pluginName).toBe('Test Plugin');
    expect(context.config.key).toBe('value');
  });
  
  it('should update state', () => {
    const context = new PluginContext({ pluginId: 'test' });
    
    context.setState(PluginState.LOADED);
    expect(context.state).toBe(PluginState.LOADED);
    
    context.setState(PluginState.RUNNING);
    expect(context.state).toBe(PluginState.RUNNING);
  });
  
  it('should emit state change event', () => {
    const context = new PluginContext({ pluginId: 'test' });
    let stateChanged = false;
    
    context.on('state:change', () => {
      stateChanged = true;
    });
    
    context.setState(PluginState.RUNNING);
    expect(stateChanged).toBe(true);
  });
});
