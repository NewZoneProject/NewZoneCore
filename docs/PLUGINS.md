# NewZoneCore Plugin Developer Guide

**Version:** 1.0.0  
**Last Updated:** 20 февраля 2026 г.  
**Status:** Beta

---

## Table of Contents

- [Introduction](#introduction)
- [Quick Start](#quick-start)
- [Plugin Architecture](#plugin-architecture)
- [Plugin API](#plugin-api)
- [Capabilities](#capabilities)
- [Permissions](#permissions)
- [Plugin Lifecycle](#plugin-lifecycle)
- [Examples](#examples)
- [Best Practices](#best-practices)
- [Publishing Plugins](#publishing-plugins)

---

## Introduction

NewZoneCore plugins allow you to extend the functionality of your NewZoneCore node without modifying the core codebase.

**What you can do with plugins:**

- Add custom HTTP endpoints
- Add IPC commands
- Listen to and react to events
- Store persistent data
- Run background services
- Integrate with external systems

---

## Quick Start

### 1. Create Plugin Directory

```bash
cd plugins
mkdir my-plugin
cd my-plugin
```

### 2. Create plugin.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My awesome plugin",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.js",
  "engines": {
    "nzcore": ">=1.0.0"
  },
  "capabilities": ["event:handler"],
  "permissions": ["read:state"]
}
```

### 3. Create index.js

```javascript
import { Plugin } from '../../core/plugins/api.js';

export default class MyPlugin extends Plugin {
  constructor() {
    super();
    this.name = 'my-plugin';
    this.version = '1.0.0';
  }
  
  async init(context) {
    await super.init(context);
    this.context.log('info', 'My plugin initialized!');
  }
  
  async start() {
    await super.start();
    this.context.log('info', 'My plugin started!');
  }
}
```

### 4. Enable Plugin

```bash
# Plugins are auto-loaded from the plugins/ directory
# Just restart NewZoneCore
nzcore restart
```

---

## Plugin Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    NewZoneCore Core                      │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────┐  │
│  │              Plugin Loader                        │  │
│  │  - Load plugins from plugins/ directory          │  │
│  │  - Validate manifests                            │  │
│  │  - Manage lifecycle                              │  │
│  └──────────────────────────────────────────────────┘  │
│                         │                               │
│  ┌──────────────────────┴──────────────────────────┐  │
│  │              Plugin Sandbox                     │  │
│  │  - Isolated execution                          │  │
│  │  - Resource limits                             │  │
│  │  - Permission enforcement                      │  │
│  └─────────────────────────────────────────────────┘  │
│                         │                               │
│  ┌──────────────────────┴──────────────────────────┐  │
│  │              Plugin Context                     │  │
│  │  - Logger                                       │  │
│  │  - Storage                                      │  │
│  │  - Event Bus                                    │  │
│  │  - Supervisor access                            │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## Plugin API

### Base Plugin Class

All plugins must extend the base `Plugin` class:

```javascript
import { Plugin } from '../../core/plugins/api.js';

export default class MyPlugin extends Plugin {
  constructor() {
    super();
    
    // Required metadata
    this.name = 'my-plugin';
    this.version = '1.0.0';
    this.description = 'My plugin description';
    this.author = 'Your Name';
    this.license = 'MIT';
  }
  
  async init(context) {
    await super.init(context);
    // Initialization code
  }
  
  async start() {
    await super.start();
    // Start code
  }
  
  async stop() {
    await super.stop();
    // Cleanup code
  }
}
```

### Plugin Context

The `context` object provides access to NewZoneCore functionality:

```javascript
// Logging
this.context.log('info', 'Message', { data: 'value' });
this.context.log('error', 'Error message', error);

// Get supervisor state
const state = await this.context.getState();

// Emit events
this.context.emitEvent('my:custom:event', { data: 'value' });

// Listen to events
this.context.onEvent('core:started', (data) => {
  console.log('Core started:', data);
});

// Storage
await this.context.set('key', 'value');
const value = await this.context.get('key');

// Register HTTP endpoint
this.context.registerEndpoint('/api/my-plugin', handler);

// Register IPC command
this.context.registerCommand('my:command', handler);
```

---

## Capabilities

Capabilities declare what your plugin can do:

| Capability | Description |
|------------|-------------|
| `service` | Run as a background service |
| `http:endpoint` | Register HTTP endpoints |
| `ipc:command` | Register IPC commands |
| `cli:command` | Register CLI commands |
| `event:handler` | Listen to events |
| `storage` | Use persistent storage |
| `network:transport` | Custom network transport |
| `network:protocol` | Custom network protocol |
| `crypto:algorithm` | Custom crypto algorithm |

---

## Permissions

Permissions control what your plugin is allowed to do:

| Permission | Description |
|------------|-------------|
| `read:state` | Read supervisor state |
| `read:events` | Listen to events |
| `read:storage` | Read from storage |
| `read:network` | Read network data |
| `write:state` | Modify state |
| `write:storage` | Write to storage |
| `send:network` | Send network messages |
| `execute:service` | Execute services |
| `register:endpoint` | Register HTTP endpoints |
| `register:command` | Register commands |
| `admin` | Full admin access |

---

## Plugin Lifecycle

```
UNLOADED → LOADING → LOADED → STARTING → RUNNING → STOPPING → STOPPED
                ↑                                        │
                └────────────────────────────────────────┘
```

### Lifecycle Methods

```javascript
async init(context) {
  // Called once when plugin is loaded
  // Initialize resources, register handlers
}

async start() {
  // Called when plugin should start
  // Start background tasks, open connections
}

async stop() {
  // Called when plugin should stop
  // Cleanup resources, close connections
}
```

---

## Examples

### HTTP Endpoint Plugin

```javascript
import { Plugin, PluginCapability } from '../../core/plugins/api.js';

export default class ApiPlugin extends Plugin {
  constructor() {
    super();
    this.name = 'api-plugin';
    this.capabilities = [PluginCapability.HTTP_ENDPOINT];
  }
  
  async init(context) {
    await super.init(context);
    
    // Register REST endpoint
    this.context.registerEndpoint('/api/my-plugin/status', async (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString()
      }));
    });
  }
}
```

### Event Handler Plugin

```javascript
import { Plugin } from '../../core/plugins/api.js';

export default class EventPlugin extends Plugin {
  constructor() {
    super();
    this.name = 'event-plugin';
  }
  
  async init(context) {
    await super.init(context);
    
    // Listen to authentication events
    this.context.onEvent('auth:login:success', (data) => {
      this.context.log('info', 'User logged in', data);
    });
    
    // Listen to security events
    this.context.onEvent('security:brute:force', (data) => {
      this.context.log('warn', 'Brute force detected!', data);
      // Send alert, etc.
    });
  }
}
```

### Background Service Plugin

```javascript
import { Plugin, PluginCapability } from '../../core/plugins/api.js';

export default class BackupPlugin extends Plugin {
  constructor() {
    super();
    this.name = 'backup-plugin';
    this.capabilities = [PluginCapability.SERVICE];
  }
  
  async start() {
    await super.start();
    
    // Run backup every hour
    this._interval = setInterval(async () => {
      await this.runBackup();
    }, 3600000);
  }
  
  async stop() {
    if (this._interval) {
      clearInterval(this._interval);
    }
    await super.stop();
  }
  
  async runBackup() {
    this.context.log('info', 'Running backup...');
    // Backup logic here
  }
}
```

---

## Best Practices

### 1. Error Handling

```javascript
async start() {
  try {
    await super.start();
    // Your code
  } catch (error) {
    this.context.log('error', 'Failed to start', error);
    throw error;
  }
}
```

### 2. Resource Cleanup

```javascript
async stop() {
  // Clear intervals
  if (this._interval) clearInterval(this._interval);
  
  // Close connections
  if (this._connection) await this._connection.close();
  
  await super.stop();
}
```

### 3. Logging

```javascript
// Use appropriate log levels
this.context.log('debug', 'Debug info');
this.context.log('info', 'General info');
this.context.log('warn', 'Warning');
this.context.log('error', 'Error', error);
```

### 4. Storage

```javascript
// Use namespaced keys
await this.context.set('my-plugin:config', config);
const config = await this.context.get('my-plugin:config');
```

### 5. Permissions

```javascript
// Check permissions before using capabilities
if (this.context.permissions.includes('register:endpoint')) {
  this.context.registerEndpoint('/api/...', handler);
}
```

---

## Publishing Plugins

### 1. Package Your Plugin

```bash
# Create plugin package
tar -czf my-plugin-1.0.0.tar.gz my-plugin/
```

### 2. Publish to npm (optional)

```json
{
  "name": "nzcore-my-plugin",
  "version": "1.0.0",
  "keywords": ["nzcore", "plugin", "newzonecore"]
}
```

```bash
npm publish
```

### 3. Share on GitHub

```bash
# Add nzcore-plugin topic
gh repo create my-nzcore-plugin
```

---

## Troubleshooting

### Plugin Not Loading

1. Check `plugin.json` is valid JSON
2. Verify `main` entry point exists
3. Check logs for errors: `nzcore logs`

### Plugin Crashes

1. Enable debug logging
2. Check error messages in logs
3. Verify permissions are sufficient

### Storage Issues

1. Check storage permission
2. Verify key format is correct
3. Check storage limits

---

## API Reference

### Plugin Class

| Method | Description |
|--------|-------------|
| `constructor()` | Initialize plugin metadata |
| `init(context)` | Initialize plugin |
| `start()` | Start plugin |
| `stop()` | Stop plugin |
| `getInfo()` | Get plugin info |

### PluginContext Class

| Method | Description |
|--------|-------------|
| `log(level, message, ...args)` | Log a message |
| `getState()` | Get supervisor state |
| `emitEvent(type, payload)` | Emit an event |
| `onEvent(type, handler)` | Subscribe to event |
| `set(key, value)` | Store data |
| `get(key)` | Get stored data |
| `registerEndpoint(path, handler)` | Register HTTP endpoint |
| `registerCommand(name, handler)` | Register IPC command |

---

*Plugin Developer Guide v1.0*  
*Last Updated: 20 февраля 2026 г.*
