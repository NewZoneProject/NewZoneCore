// Module: Crash Recovery
// Description: Automatic crash recovery and state restoration for NewZoneCore.
//              Preserves state and recovers from unexpected shutdowns.
// File: core/observability/recovery.js

import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';

// ============================================================================
// STATE SNAPSHOT
// ============================================================================

export class StateSnapshot {
  constructor(options = {}) {
    this.id = options.id || randomBytes(8).toString('hex');
    this.timestamp = options.timestamp || new Date().toISOString();
    this.version = options.version || '1.0';
    
    // Core state
    this.supervisor = options.supervisor || null;
    this.services = options.services || [];
    this.channels = options.channels || [];
    this.routing = options.routing || null;
    this.trust = options.trust || null;
    
    // Metadata
    this.uptime = options.uptime || 0;
    this.reason = options.reason || 'periodic';
    this.checksum = options.checksum || null;
  }

  /**
   * Calculate snapshot checksum.
   */
  calculateChecksum() {
    const { createHash } = require('crypto');
    const data = JSON.stringify({
      supervisor: this.supervisor,
      services: this.services,
      channels: this.channels,
      routing: this.routing,
      trust: this.trust
    });
    
    this.checksum = createHash('sha256').update(data).digest('hex');
    return this.checksum;
  }

  /**
   * Verify snapshot integrity.
   */
  verify() {
    const { createHash } = require('crypto');
    const data = JSON.stringify({
      supervisor: this.supervisor,
      services: this.services,
      channels: this.channels,
      routing: this.routing,
      trust: this.trust
    });
    
    const checksum = createHash('sha256').update(data).digest('hex');
    return checksum === this.checksum;
  }

  toJSON() {
    return {
      id: this.id,
      timestamp: this.timestamp,
      version: this.version,
      supervisor: this.supervisor,
      services: this.services,
      channels: this.channels,
      routing: this.routing,
      trust: this.trust,
      uptime: this.uptime,
      reason: this.reason,
      checksum: this.checksum
    };
  }
}

// ============================================================================
// RECOVERY MANAGER
// ============================================================================

export class RecoveryManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.stateDir = options.stateDir || './env/state';
    this.maxSnapshots = options.maxSnapshots || 10;
    this.snapshotInterval = options.snapshotInterval || 60000; // 1 minute
    this.autoRecover = options.autoRecover !== false;
    
    this._snapshotTimer = null;
    this._lastSnapshot = null;
  }

  /**
   * Initialize recovery manager.
   */
  async init() {
    await fs.mkdir(this.stateDir, { recursive: true });
    
    console.log('[recovery] Recovery manager initialized');
    return this;
  }

  /**
   * Start periodic snapshots.
   */
  start(supervisor) {
    if (!supervisor) {
      throw new Error('Supervisor is required');
    }
    
    this.supervisor = supervisor;
    
    // Create initial snapshot
    this.takeSnapshot('startup');
    
    // Start periodic snapshots
    this._snapshotTimer = setInterval(() => {
      this.takeSnapshot('periodic').catch(console.error);
    }, this.snapshotInterval);
    
    console.log('[recovery] Periodic snapshots started');
    
    // Check for crash recovery
    if (this.autoRecover) {
      this.checkForRecovery();
    }
  }

  /**
   * Stop snapshots.
   */
  stop() {
    if (this._snapshotTimer) {
      clearInterval(this._snapshotTimer);
      this._snapshotTimer = null;
    }
    
    // Final snapshot
    this.takeSnapshot('shutdown').catch(console.error);
    
    console.log('[recovery] Snapshots stopped');
  }

  /**
   * Take state snapshot.
   */
  async takeSnapshot(reason = 'manual') {
    if (!this.supervisor) {
      throw new Error('Supervisor not available');
    }
    
    try {
      const state = this.supervisor.getState();
      const services = this.supervisor.getServiceStatus?.() || { services: [] };
      const channels = this.supervisor.getChannelStatus?.() || { channels: [] };
      const routing = this.supervisor.getRouting?.() || null;
      const trust = this.supervisor.getTrust?.() || null;
      
      const snapshot = new StateSnapshot({
        supervisor: {
          startedAt: state.startedAt,
          nodeId: state.nodeId,
          status: state.status
        },
        services: services.services || [],
        channels: channels.channels || [],
        routing,
        trust,
        uptime: Date.now() - new Date(state.startedAt).getTime(),
        reason
      });
      
      snapshot.calculateChecksum();
      
      // Save snapshot
      const snapshotFile = path.join(this.stateDir, `snapshot-${snapshot.id}.json`);
      await fs.writeFile(
        snapshotFile,
        JSON.stringify(snapshot.toJSON(), null, 2),
        'utf-8'
      );
      
      // Update last snapshot marker
      await fs.writeFile(
        path.join(this.stateDir, 'latest.json'),
        JSON.stringify({ id: snapshot.id, timestamp: snapshot.timestamp }),
        'utf-8'
      );
      
      this._lastSnapshot = snapshot;
      
      // Cleanup old snapshots
      await this._cleanupOldSnapshots();
      
      this.emit('snapshot', { snapshot, reason });
      console.log(`[recovery] Snapshot created: ${snapshot.id} (${reason})`);
      
      return snapshot;
      
    } catch (error) {
      console.error('[recovery] Snapshot failed:', error.message);
      this.emit('error', { error, reason: 'snapshot' });
      throw error;
    }
  }

  /**
   * Check if recovery is needed.
   */
  async checkForRecovery() {
    try {
      const latestFile = path.join(this.stateDir, 'latest.json');
      
      try {
        const data = await fs.readFile(latestFile, 'utf-8');
        const latest = JSON.parse(data);
        
        // Check if there was an unclean shutdown
        const snapshotFile = path.join(this.stateDir, `snapshot-${latest.id}.json`);
        const snapshotData = await fs.readFile(snapshotFile, 'utf-8');
        const snapshot = JSON.parse(snapshotData);
        
        // Verify checksum
        if (!snapshot.verify()) {
          console.warn('[recovery] Latest snapshot corrupted, skipping recovery');
          this.emit('recovery:skipped', { reason: 'corrupted' });
          return null;
        }
        
        // Check if shutdown was clean
        if (snapshot.reason === 'shutdown') {
          console.log('[recovery] Clean shutdown detected, no recovery needed');
          return null;
        }
        
        // Recovery needed
        console.log('[recovery] Unclean shutdown detected, recovery available');
        this.emit('recovery:available', { snapshot });
        
        return snapshot;
        
      } catch (error) {
        if (error.code === 'ENOENT') {
          console.log('[recovery] No previous state found, skipping recovery');
          return null;
        }
        throw error;
      }
      
    } catch (error) {
      console.error('[recovery] Recovery check failed:', error.message);
      this.emit('error', { error, reason: 'recovery_check' });
      return null;
    }
  }

  /**
   * Recover from snapshot.
   */
  async recover(snapshotId = null) {
    try {
      let snapshot;
      
      if (snapshotId) {
        const snapshotFile = path.join(this.stateDir, `snapshot-${snapshotId}.json`);
        const data = await fs.readFile(snapshotFile, 'utf-8');
        snapshot = new StateSnapshot(JSON.parse(data));
      } else {
        // Use latest
        const latestFile = path.join(this.stateDir, 'latest.json');
        const latest = JSON.parse(await fs.readFile(latestFile, 'utf-8'));
        return this.recover(latest.id);
      }
      
      // Verify snapshot
      if (!snapshot.verify()) {
        throw new Error('Snapshot verification failed');
      }
      
      console.log(`[recovery] Recovering from snapshot: ${snapshot.id}`);
      this.emit('recovery:start', { snapshot });
      
      // Restore state
      const results = {
        snapshot: snapshot.id,
        timestamp: snapshot.timestamp,
        services: [],
        channels: [],
        errors: []
      };
      
      // Restore services
      for (const service of snapshot.services || []) {
        try {
          if (service.state === 'running') {
            await this.supervisor.startService?.(service.name, {
              recover: true,
              initialState: service.state
            });
            results.services.push({ name: service.name, status: 'restored' });
          }
        } catch (error) {
          results.errors.push({ service: service.name, error: error.message });
          console.error(`[recovery] Failed to restore service ${service.name}:`, error.message);
        }
      }
      
      // Restore channels
      for (const channel of snapshot.channels || []) {
        try {
          if (channel.state === 'open') {
            await this.supervisor.restoreChannel?.(channel);
            results.channels.push({ peerId: channel.peerId, status: 'restored' });
          }
        } catch (error) {
          results.errors.push({ channel: channel.peerId, error: error.message });
        }
      }
      
      this.emit('recovery:complete', results);
      console.log(`[recovery] Recovery complete: ${results.services.length} services, ${results.channels.length} channels`);
      
      return results;
      
    } catch (error) {
      console.error('[recovery] Recovery failed:', error.message);
      this.emit('recovery:error', { error });
      throw error;
    }
  }

  /**
   * List available snapshots.
   */
  async listSnapshots() {
    const files = await fs.readdir(this.stateDir);
    const snapshots = [];
    
    for (const file of files) {
      if (file.startsWith('snapshot-') && file.endsWith('.json')) {
        const filePath = path.join(this.stateDir, file);
        const data = await fs.readFile(filePath, 'utf-8');
        const snapshot = JSON.parse(data);
        snapshots.push(snapshot);
      }
    }
    
    return snapshots.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  }

  /**
   * Delete old snapshots.
   */
  async _cleanupOldSnapshots() {
    const snapshots = await this.listSnapshots();
    
    if (snapshots.length <= this.maxSnapshots) {
      return;
    }
    
    const toDelete = snapshots.slice(this.maxSnapshots);
    
    for (const snapshot of toDelete) {
      try {
        const snapshotFile = path.join(this.stateDir, `snapshot-${snapshot.id}.json`);
        await fs.unlink(snapshotFile);
        console.log(`[recovery] Deleted old snapshot: ${snapshot.id}`);
      } catch (error) {
        console.error('[recovery] Failed to delete snapshot:', snapshot.id, error.message);
      }
    }
  }
}

// ============================================================================
// CRASH REPORTER
// ============================================================================

export class CrashReporter extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.reportsDir = options.reportsDir || './logs/crashes';
    this.enabled = options.enabled !== false;
  }

  /**
   * Initialize crash reporter.
   */
  async init() {
    await fs.mkdir(this.reportsDir, { recursive: true });
    
    // Register error handlers
    this._registerHandlers();
    
    console.log('[crash] Crash reporter initialized');
    return this;
  }

  /**
   * Register error handlers.
   */
  _registerHandlers() {
    if (!this.enabled) return;
    
    // Uncaught exceptions
    process.on('uncaughtException', async (error, origin) => {
      console.error('[crash] Uncaught exception:', error.message);
      await this.reportCrash({
        type: 'uncaught_exception',
        origin,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      });
      
      process.exit(1);
    });
    
    // Unhandled rejections
    process.on('unhandledRejection', async (reason, promise) => {
      console.error('[crash] Unhandled rejection:', reason);
      await this.reportCrash({
        type: 'unhandled_rejection',
        error: {
          message: reason?.message || String(reason),
          stack: reason?.stack,
          name: reason?.name || 'PromiseRejection'
        }
      });
    });
    
    // Warning events
    process.on('warning', (warning) => {
      this.emit('warning', { warning });
    });
  }

  /**
   * Report crash.
   */
  async reportCrash(report) {
    const crashReport = {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      ...report
    };
    
    // Add environment info
    crashReport.env = {
      NODE_ENV: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cwd: process.cwd()
    };
    
    // Save report
    const reportFile = path.join(
      this.reportsDir,
      `crash-${Date.now()}-${crashReport.type}.json`
    );
    
    try {
      await fs.writeFile(
        reportFile,
        JSON.stringify(crashReport, null, 2),
        'utf-8'
      );
      
      this.emit('crash', { report: crashReport, file: reportFile });
      console.log(`[crash] Crash report saved: ${reportFile}`);
      
      return reportFile;
      
    } catch (error) {
      console.error('[crash] Failed to save crash report:', error.message);
      throw error;
    }
  }

  /**
   * List crash reports.
   */
  async listReports() {
    const files = await fs.readdir(this.reportsDir);
    const reports = [];
    
    for (const file of files) {
      if (file.startsWith('crash-') && file.endsWith('.json')) {
        const filePath = path.join(this.reportsDir, file);
        const data = await fs.readFile(filePath, 'utf-8');
        reports.push(JSON.parse(data));
      }
    }
    
    return reports.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  }

  /**
   * Get crash report.
   */
  async getReport(filename) {
    const reportFile = path.join(this.reportsDir, filename);
    const data = await fs.readFile(reportFile, 'utf-8');
    return JSON.parse(data);
  }

  /**
   * Delete old reports.
   */
  async cleanupReports(maxAge = 7 * 24 * 60 * 60 * 1000) {
    const files = await fs.readdir(this.reportsDir);
    const now = Date.now();
    
    for (const file of files) {
      if (!file.startsWith('crash-')) continue;
      
      const filePath = path.join(this.reportsDir, file);
      const stat = await fs.stat(filePath);
      
      if (now - stat.mtimeMs > maxAge) {
        await fs.unlink(filePath);
        console.log(`[crash] Deleted old report: ${file}`);
      }
    }
  }
}

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

let globalRecovery = null;
let globalCrashReporter = null;

export async function getRecoveryManager(options = {}) {
  if (!globalRecovery) {
    globalRecovery = new RecoveryManager(options);
    await globalRecovery.init();
  }
  return globalRecovery;
}

export async function getCrashReporter(options = {}) {
  if (!globalCrashReporter) {
    globalCrashReporter = new CrashReporter(options);
    await globalCrashReporter.init();
  }
  return globalCrashReporter;
}

export function createRecoveryManager(options = {}) {
  return new RecoveryManager(options);
}

export function createCrashReporter(options = {}) {
  return new CrashReporter(options);
}
