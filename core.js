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

  // --- 4. Load local services ----------------------------------------------
  const loaderMod = await safeImport('./core/services/loader.js');

  if (loaderMod?.loadLocalServices) {
    await loaderMod.loadLocalServices({ supervisor, ROOT });
    console.log('[services] local services loaded');
  } else {
    console.log('[services] no service loader found (skipped)');
  }

  // --- 5. HTTP API ----------------------------------------------------------
  const httpMod = await safeImport('./core/api/http.js');

  if (httpMod?.startHttpApi) {
    await httpMod.startHttpApi({ supervisor });
    console.log('[http] HTTP API online');
  } else {
    console.log('[http] placeholder HTTP API started');
  }

  // --- 6. IPC API -----------------------------------------------------------
  const ipcMod = await safeImport('./core/api/ipc.js');

  if (ipcMod?.startIpcServer) {
    await ipcMod.startIpcServer({ supervisor });
    console.log('[ipc] IPC server online');
  } else {
    console.log('[ipc] placeholder IPC server started');
  }

  // --- 7. Final state -------------------------------------------------------
  console.log('[NewZoneCore] online.');
}

// --- Auto-start when executed directly -------------------------------------
if (import.meta.main) {
  startCore().catch(err => {
    console.error('[FATAL] Unhandled error:', err);
    process.exit(1);
  });
}

