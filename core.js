// Module: NewZoneCore Bootstrap
// Description: Unified entry point for NewZoneCore. Performs startup checks,
//              initializes cryptographic identity, supervisor, HTTP and IPC APIs,
//              loads local services and starts their lifecycle.
// Run: nzcore start
// File: core.js

import path from 'path';
import { fileURLToPath } from 'url';

// Resolve project root relative to this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname);

// --- Lazy import helper -----------------------------------------------------
async function safeImport(relPath) {
  try {
    return await import(path.join(ROOT, relPath));
  } catch (err) {
    console.error('[import] Failed to import', relPath, err.message);
    return null;
  }
}

// --- Main entry point -------------------------------------------------------
export async function startCore() {
  console.log('[NewZoneCore] bootstrapping…');

  // --- 0. Initialize Observability -----------------------------------------
  const { getMetrics, getHealthChecker, registerDefaultHealthChecks } = 
    await safeImport('./core/observability/metrics.js');
  const { getTracer, createTraceMiddleware } = 
    await safeImport('./core/observability/tracing.js');
  const { getAlertManager, registerSystemAlerts, registerSecurityAlerts } = 
    await safeImport('./core/observability/alerts.js');
  const { getBackupManager, createBackupScheduler } = 
    await safeImport('./core/observability/backup.js');
  const { getRecoveryManager, getCrashReporter } = 
    await safeImport('./core/observability/recovery.js');
  const { getShutdownManager, registerDefaultCleanup } = 
    await safeImport('./core/observability/shutdown.js');

  // Initialize crash reporter
  const crashReporter = await getCrashReporter({ enabled: true });
  
  // Initialize metrics
  const metrics = getMetrics();
  
  // Initialize health checker
  const healthChecker = getHealthChecker();
  
  // Initialize tracer
  const tracer = getTracer({ 
    samplingRate: process.env.TRACING_SAMPLE_RATE || 0.1 
  });
  
  // Initialize alert manager
  const alertManager = getAlertManager();
  registerSystemAlerts(alertManager);
  registerSecurityAlerts(alertManager);
  
  console.log('[observability] Crash reporter, metrics, health checker initialized');

  // --- 1. Startup checks ----------------------------------------------------
  const checksMod = await safeImport('./core/startup/checks.js');
  const bootstrapMod = await safeImport('./core/startup/bootstrap.js');

  if (checksMod?.runStartupChecks) {
    const report = await checksMod.runStartupChecks();

    if (!report.ok && bootstrapMod?.interactiveBootstrap) {
      console.log('[NewZoneCore] Startup checks failed. Running bootstrap…');
      await bootstrapMod.interactiveBootstrap(report);
    }
  } else {
    console.log('[startup] No startup checks found (skipped)');
  }

  // --- 2. Cryptographic identity -------------------------------------------
  const masterMod = await safeImport('./core/crypto/master.js');
  const trustMod = await safeImport('./core/crypto/trust.js');
  const keysMod = await safeImport('./core/crypto/keys.js');

  const masterKey = masterMod?.initMasterKey
    ? await masterMod.initMasterKey()
    : new Uint8Array(32); // fallback: zero-key (dev mode)

  const trust = trustMod?.loadTrustStore
    ? await trustMod.loadTrustStore()
    : { peers: [] };

  const keys = keysMod?.loadAllKeys
    ? await keysMod.loadAllKeys(path.join(ROOT, 'env'))
    : { identity: null, ecdh: null };

  console.log('[crypto] master key loaded');
  console.log('[crypto] trust store loaded');
  console.log('[crypto] identity keys loaded');

  // --- 3. Supervisor --------------------------------------------------------
  const supervisorMod = await safeImport('./core/supervisor/process.js');

  const supervisor = supervisorMod?.startSupervisor
    ? await supervisorMod.startSupervisor({
        masterKey,
        trust,
        identity: keys.identity,
        ecdh: keys.ecdh
      })
    : {
        status: 'supervisor-placeholder',
        trust,
        identity: keys.identity,
        ecdh: keys.ecdh
      };

  console.log('[supervisor] ready');

  // --- 4. Register Health Checks -------------------------------------------
  registerDefaultHealthChecks(supervisor);
  console.log('[health] Default health checks registered');

  // --- 5. Initialize Recovery Manager --------------------------------------
  const recoveryManager = await getRecoveryManager();
  recoveryManager.start(supervisor);
  console.log('[recovery] Recovery manager started');

  // --- 6. Initialize Backup Manager ----------------------------------------
  const backupManager = await getBackupManager({
    backupDir: process.env.BACKUP_DIR || './backups',
    envDir: process.env.ENV_DIR || './env',
    encryptionKey: masterKey
  });
  
  // Start scheduled backups if enabled
  if (process.env.BACKUP_ENABLED !== 'false') {
    const backupScheduler = createBackupScheduler(backupManager, {
      enabled: true,
      fullBackupInterval: 7 * 24 * 60 * 60 * 1000, // 7 days
      incrementalInterval: 24 * 60 * 60 * 1000 // 1 day
    });
    backupScheduler.start();
    console.log('[backup] Scheduled backups enabled');
  }

  // --- 7. Load local services ----------------------------------------------
  const loaderMod = await safeImport('./core/services/loader.js');

  if (loaderMod?.loadLocalServices) {
    await loaderMod.loadLocalServices({ supervisor, ROOT });
    console.log('[services] local services loaded');
  } else {
    console.log('[services] no service loader found (skipped)');
  }

  // --- 8. HTTP API ----------------------------------------------------------
  const httpMod = await safeImport('./core/api/http.js');

  if (httpMod?.startHttpApi) {
    const httpServer = await httpMod.startHttpApi({ supervisor });
    
    // Add observability endpoints
    const { addObservabilityEndpoints } = 
      await safeImport('./core/observability/endpoint.js');
    
    if (addObservabilityEndpoints) {
      addObservabilityEndpoints(httpServer, supervisor);
      console.log('[observability] Metrics and health endpoints added');
    }
    
    console.log('[http] HTTP API online');
  } else {
    console.log('[http] placeholder HTTP API started');
  }

  // --- 9. IPC API -----------------------------------------------------------
  const ipcMod = await safeImport('./core/api/ipc.js');

  if (ipcMod?.startIpcServer) {
    await ipcMod.startIpcServer({ supervisor });
    console.log('[ipc] IPC server online');
  } else {
    console.log('[ipc] placeholder IPC server started');
  }

  // --- 10. Register Shutdown Cleanup ---------------------------------------
  const shutdownManager = getShutdownManager();
  registerDefaultCleanup(supervisor);
  
  // Add recovery manager cleanup
  shutdownManager.register('recovery', async () => {
    recoveryManager.stop();
  }, 1);
  
  // Add backup manager cleanup
  shutdownManager.register('backup', async () => {
    await backupManager.createBackup({
      type: 'incremental',
      description: 'Pre-shutdown backup',
      tags: ['shutdown']
    });
  }, 2);
  
  // Add tracer shutdown
  shutdownManager.register('tracing', async () => {
    await tracer.shutdown();
  }, 3);
  
  console.log('[shutdown] Cleanup handlers registered');

  // --- 11. Final state ------------------------------------------------------
  console.log('[NewZoneCore] online.');
  
  // Emit startup event
  metrics.inc('uptime_seconds');
  tracer.startSpan('core.startup').end();
}

// --- Auto-start when executed directly -------------------------------------
if (import.meta.main) {
  startCore().catch(err => {
    console.error('[FATAL] Unhandled error:', err);
    process.exit(1);
  });
}

