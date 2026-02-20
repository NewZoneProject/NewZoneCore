// Module: Graceful Shutdown
// Description: Handles graceful shutdown of NewZoneCore with proper cleanup.
// File: core/observability/shutdown.js

import { EventEmitter } from 'events';

// ============================================================================
// SHUTDOWN MANAGER
// ============================================================================

export class ShutdownManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.timeout = options.timeout || 30000; // 30 seconds
    this.cleanupHandlers = new Map();
    this.isShuttingDown = false;
    this.isShutdown = false;
    this.shutdownReason = null;
    this.startTime = null;
    
    // Register signal handlers
    this._registerSignalHandlers();
  }
  
  /**
   * Register a cleanup handler.
   * @param {string} name - Handler name
   * @param {Function} handler - Async cleanup function
   * @param {number} priority - Lower number = higher priority (run first on shutdown)
   */
  register(name, handler, priority = 10) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }
    
    this.cleanupHandlers.set(name, { handler, priority });
    this.emit('handler:registered', { name, priority });
  }
  
  /**
   * Unregister a cleanup handler.
   */
  unregister(name) {
    return this.cleanupHandlers.delete(name);
  }
  
  /**
   * Initiate graceful shutdown.
   * @param {string} reason - Shutdown reason
   */
  async shutdown(reason = 'manual') {
    if (this.isShuttingDown) {
      console.log('[shutdown] Shutdown already in progress');
      return;
    }
    
    if (this.isShutdown) {
      console.log('[shutdown] Already shutdown');
      return;
    }
    
    this.isShuttingDown = true;
    this.shutdownReason = reason;
    this.startTime = Date.now();
    
    this.emit('shutdown:start', { reason });
    console.log(`[shutdown] Initiating graceful shutdown: ${reason}`);
    
    try {
      // Sort handlers by priority (lower = first)
      const handlers = Array.from(this.cleanupHandlers.entries())
        .sort((a, b) => a[1].priority - b[1].priority);
      
      const results = [];
      
      // Run all cleanup handlers
      for (const [name, { handler, priority }] of handlers) {
        try {
          const start = Date.now();
          await Promise.race([
            handler(),
            this._timeout(this.timeout / handlers.length)
          ]);
          const duration = Date.now() - start;
          
          results.push({ name, status: 'ok', duration });
          this.emit('handler:completed', { name, duration });
          console.log(`[shutdown] ${name} cleaned up in ${duration}ms`);
        } catch (error) {
          results.push({ name, status: 'error', error: error.message });
          this.emit('handler:error', { name, error });
          console.error(`[shutdown] ${name} cleanup failed:`, error.message);
        }
      }
      
      // Final cleanup
      this.isShutdown = true;
      this.isShuttingDown = false;
      
      const totalDuration = Date.now() - this.startTime;
      
      this.emit('shutdown:complete', { reason, results, duration: totalDuration });
      console.log(`[shutdown] Graceful shutdown complete in ${totalDuration}ms`);
      
      return { success: true, results, duration: totalDuration };
      
    } catch (error) {
      this.emit('shutdown:error', { error });
      console.error('[shutdown] Shutdown failed:', error.message);
      throw error;
    }
  }
  
  /**
   * Force shutdown after timeout.
   */
  async forceShutdown(reason = 'timeout') {
    console.log(`[shutdown] Force shutdown: ${reason}`);
    
    // Emit force shutdown event
    this.emit('shutdown:force', { reason });
    
    // Exit process
    process.exit(1);
  }
  
  /**
   * Get shutdown status.
   */
  getStatus() {
    return {
      isShuttingDown: this.isShuttingDown,
      isShutdown: this.isShutdown,
      reason: this.shutdownReason,
      handlers: this.cleanupHandlers.size,
      uptime: this.startTime ? Date.now() - this.startTime : 0
    };
  }
  
  /**
   * Register signal handlers.
   */
  _registerSignalHandlers() {
    // SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      console.log('[shutdown] Received SIGINT');
      await this.shutdown('SIGINT');
      process.exit(0);
    });
    
    // SIGTERM (docker stop, systemctl stop)
    process.on('SIGTERM', async () => {
      console.log('[shutdown] Received SIGTERM');
      await this.shutdown('SIGTERM');
      process.exit(0);
    });
    
    // SIGHUP (reload configuration)
    process.on('SIGHUP', () => {
      console.log('[shutdown] Received SIGHUP - configuration reload requested');
      this.emit('reload', {});
    });
    
    // Uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('[shutdown] Uncaught exception:', error.message);
      this.emit('error', { error });
      
      // Try graceful shutdown
      await this.shutdown(`uncaught_exception: ${error.message}`);
      process.exit(1);
    });
    
    // Unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      console.error('[shutdown] Unhandled rejection:', reason);
      this.emit('rejection', { reason, promise });
      
      // Try graceful shutdown
      await this.shutdown(`unhandled_rejection: ${reason}`);
      process.exit(1);
    });
    
    // Before exit
    process.on('beforeExit', () => {
      this.emit('beforeExit', {});
    });
  }
  
  /**
   * Create a timeout promise.
   */
  _timeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalShutdown = null;

export function getShutdownManager(options = {}) {
  if (!globalShutdown) {
    globalShutdown = new ShutdownManager(options);
  }
  return globalShutdown;
}

export function createShutdownManager(options = {}) {
  return new ShutdownManager(options);
}

// ============================================================================
// DEFAULT CLEANUP HANDLERS
// ============================================================================

/**
 * Register default cleanup handlers.
 */
export function registerDefaultCleanup(supervisor, options = {}) {
  const shutdown = getShutdownManager(options);
  
  // Close HTTP server
  if (supervisor?.httpServer) {
    shutdown.register('http_server', async () => {
      return new Promise((resolve, reject) => {
        supervisor.httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }, 1);
  }
  
  // Close IPC server
  if (supervisor?.ipcServer) {
    shutdown.register('ipc_server', async () => {
      return new Promise((resolve, reject) => {
        supervisor.ipcServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }, 2);
  }
  
  // Stop services
  if (supervisor?.serviceManager) {
    shutdown.register('services', async () => {
      const status = supervisor.serviceManager.getStatus();
      for (const [name, service] of Object.entries(status.services || {})) {
        if (service.state === 'running') {
          try {
            await supervisor.serviceManager.stop(name, 'shutdown');
          } catch (error) {
            console.error(`[shutdown] Failed to stop service ${name}:`, error.message);
          }
        }
      }
    }, 3);
  }
  
  // Close channels
  if (supervisor?.channelManager) {
    shutdown.register('channels', async () => {
      const channels = supervisor.channelManager.list();
      for (const channel of channels) {
        try {
          await supervisor.channelManager.close(channel.peerId, 'shutdown');
        } catch (error) {
          console.error(`[shutdown] Failed to close channel ${channel.peerId}:`, error.message);
        }
      }
    }, 4);
  }
  
  // Flush logs
  shutdown.register('logs', async () => {
    // Flush any buffered logs
    if (global.auditLogger) {
      await global.auditLogger.close();
    }
  }, 5);
  
  // Cleanup crypto
  shutdown.register('crypto', async () => {
    // Clear any cached keys
    const { clearMasterKeyCache } = await import('../crypto/trust.js');
    clearMasterKeyCache();
  }, 6);
  
  return shutdown;
}
