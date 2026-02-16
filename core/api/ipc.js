// Module: IPC Server
// Description: Cross-platform, self-contained IPC server for NewZoneCore.
//              Now with token-based authentication for security.
// File: core/api/ipc.js

import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

const RUNTIME_DIR = path.join(process.cwd(), 'runtime', 'ipc');
const TOKEN_FILE = path.join(process.cwd(), 'env', '.ipc_token');

const SOCKET_PATH =
  os.platform() === 'win32'
    ? '\\\\.\\pipe\\nzcore'
    : path.join(RUNTIME_DIR, 'nzcore.sock');

// ============================================================================
// IPC AUTHENTICATION
// ============================================================================

/**
 * Generate a new IPC access token.
 */
function generateIpcToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Save IPC token to file with secure permissions.
 */
async function saveIpcToken(token) {
  const envPath = path.join(process.cwd(), 'env');
  await fs.mkdir(envPath, { recursive: true });
  await fs.writeFile(TOKEN_FILE, token, { mode: 0o600 });
}

/**
 * Load IPC token from file.
 */
async function loadIpcToken() {
  try {
    const token = await fs.readFile(TOKEN_FILE, 'utf8');
    return token.trim();
  } catch {
    return null;
  }
}

/**
 * Validate IPC token.
 */
function validateIpcToken(providedToken, expectedToken) {
  if (!providedToken || !expectedToken) return false;
  
  return crypto.timingSafeEqual(
    Buffer.from(providedToken, 'utf8'),
    Buffer.from(expectedToken, 'utf8')
  );
}

// ============================================================================
// IPC SERVER
// ============================================================================

export async function startIpcServer({ supervisor, authManager }) {
  // Ensure runtime/ipc directory exists
  try {
    await fs.mkdir(RUNTIME_DIR, { recursive: true });
  } catch {}

  // Remove stale socket file (UNIX only)
  if (os.platform() !== 'win32') {
    try { await fs.unlink(SOCKET_PATH); } catch {}
  }
  
  // Generate and save IPC token
  const ipcToken = generateIpcToken();
  await saveIpcToken(ipcToken);
  console.log('[api:ipc] IPC token generated and saved');

  const server = net.createServer(async (socket) => {
    let isAuthenticated = false;
    let buffer = '';
    
    socket.on('data', async (data) => {
      buffer += data.toString();
      
      // Process complete lines (newline-delimited protocol)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const result = await processCommand(line, supervisor, isAuthenticated, ipcToken, authManager);
        
        if (result.authenticated) {
          isAuthenticated = true;
        }
        
        if (result.response) {
          socket.write(JSON.stringify(result.response) + '\n');
        }
        
        if (result.close) {
          socket.end();
          return;
        }
      }
    });
    
    socket.on('error', (err) => {
      // Ignore socket errors (client disconnected)
    });
  });
  
  // Set socket permissions on Unix
  server.listen(SOCKET_PATH, () => {
    if (os.platform() !== 'win32') {
      // Set socket permissions to owner only
      fs.chmod(SOCKET_PATH, 0o600).catch(() => {});
    }
    console.log(`[api:ipc] listening on ${SOCKET_PATH}`);
    console.log('[api:ipc] IPC token stored in env/.ipc_token');
  });

  return server;
}

// ============================================================================
// COMMAND PROCESSOR
// ============================================================================

async function processCommand(line, supervisor, isAuthenticated, ipcToken, authManager) {
  const cmd = line.trim();
  
  // Helper: write + end
  const reply = (obj) => ({ response: obj });
  const close = () => ({ close: true });
  
  // --- Authentication command -----------------------------------------------
  if (cmd.startsWith('AUTH ')) {
    const token = cmd.substring(5).trim();
    
    if (validateIpcToken(token, ipcToken)) {
      return { authenticated: true, response: { ok: true, message: 'Authenticated' } };
    }
    
    return reply({ error: 'Authentication failed' });
  }
  
  // --- Require authentication for all other commands -----------------------
  if (!isAuthenticated) {
    return reply({ error: 'Authentication required. Send: AUTH <token>' });
  }
  
  // --- State ---------------------------------------------------------------
  if (cmd === 'state') {
    let raw = {};

    try {
      raw = await supervisor.getState();
    } catch {
      raw = { error: 'state_unavailable' };
    }

    const state = {
      startedAt: raw.startedAt,
      node_id: raw.identity?.public || null,
      ecdh_public: raw.ecdh?.public || null,
      trust: raw.trust || {},
      services: raw.services || []
    };

    return reply(state);
  }

  // --- Trust list ----------------------------------------------------------
  if (cmd === 'trust:list') {
    const store = supervisor.trust || { peers: [] };
    return reply({ peers: store.peers || [] });
  }

  // --- Trust add with validation --------------------------------------------
  if (cmd.startsWith('trust:add ')) {
    const parts = cmd.split(' ');
    if (parts.length !== 3) {
      return reply({ error: 'usage: trust:add <id> <pubkey>' });
    }

    const id = parts[1];
    const pubkey = parts[2];
    
    // Validate ID
    if (!id || typeof id !== 'string' || id.length > 256) {
      return reply({ error: 'Invalid peer ID' });
    }
    
    // Validate public key (base64, 32 bytes)
    try {
      const keyBytes = Buffer.from(pubkey, 'base64');
      if (keyBytes.length !== 32) {
        return reply({ error: 'Public key must be 32 bytes (Ed25519)' });
      }
    } catch {
      return reply({ error: 'Invalid base64 encoding for public key' });
    }

    try {
      if (!supervisor.trust.peers) supervisor.trust.peers = [];

      supervisor.trust.peers.push({
        id,
        pubkey,
        addedAt: new Date().toISOString()
      });

      return reply({ ok: true });
    } catch (err) {
      return reply({ ok: false, error: err.message });
    }
  }

  // --- Trust remove --------------------------------------------------------
  if (cmd.startsWith('trust:remove ')) {
    const parts = cmd.split(' ');
    if (parts.length !== 2) {
      return reply({ error: 'usage: trust:remove <id>' });
    }

    const id = parts[1];

    try {
      const before = supervisor.trust.peers?.length || 0;
      supervisor.trust.peers = (supervisor.trust.peers || []).filter(
        (p) => p.id !== id
      );
      const after = supervisor.trust.peers.length;

      return reply({
        ok: true,
        removed: before - after
      });
    } catch (err) {
      return reply({ ok: false, error: err.message });
    }
  }

  // --- Identity ------------------------------------------------------------
  if (cmd === 'identity') {
    const id = supervisor.identity?.public || null;
    const ecdh = supervisor.ecdh?.public || null;

    return reply({
      node_id: id,
      ed25519_public: id,
      x25519_public: ecdh
    });
  }

  // --- Services ------------------------------------------------------------
  if (cmd === 'services') {
    const list = supervisor.services || [];
    return reply({ services: list });
  }

  // --- Router: routes ------------------------------------------------------
  if (cmd === 'router:routes') {
    const router = supervisor.modules?.getModule
      ? supervisor.modules.getModule('router')
      : null;

    if (!router) {
      return reply({ error: 'router module not available' });
    }

    try {
      const routes = router.listRoutes();
      return reply({ routes });
    } catch (err) {
      return reply({ error: err.message });
    }
  }

  // --- Router: add with validation -----------------------------------------
  if (cmd.startsWith('router:add ')) {
    const parts = cmd.split(' ');
    if (parts.length !== 3) {
      return reply({ error: 'usage: router:add <peerId> <pubkey>' });
    }

    const peerId = parts[1];
    const pubkey = parts[2];
    
    // Validate peer ID
    if (!peerId || typeof peerId !== 'string') {
      return reply({ error: 'Invalid peer ID' });
    }
    
    // Validate public key
    try {
      const keyBytes = Buffer.from(pubkey, 'base64');
      if (keyBytes.length !== 32) {
        return reply({ error: 'Public key must be 32 bytes' });
      }
    } catch {
      return reply({ error: 'Invalid base64 encoding for public key' });
    }

    const router = supervisor.modules?.getModule
      ? supervisor.modules.getModule('router')
      : null;

    if (!router) {
      return reply({ error: 'router module not available' });
    }

    try {
      router.addRoute(peerId, pubkey);
      return reply({ ok: true });
    } catch (err) {
      return reply({ ok: false, error: err.message });
    }
  }

  // --- Router: remove ------------------------------------------------------
  if (cmd.startsWith('router:remove ')) {
    const parts = cmd.split(' ');
    if (parts.length !== 2) {
      return reply({ error: 'usage: router:remove <peerId>' });
    }

    const peerId = parts[1];

    const router = supervisor.modules?.getModule
      ? supervisor.modules.getModule('router')
      : null;

    if (!router) {
      return reply({ error: 'router module not available' });
    }

    try {
      router.removeRoute(peerId);
      return reply({ ok: true });
    } catch (err) {
      return reply({ ok: false, error: err.message });
    }
  }

  // --- Router: send with size limit ----------------------------------------
  if (cmd.startsWith('router:send ')) {
    const parts = cmd.split(' ');
    const peerId = parts[1];
    const json = parts.slice(2).join(' ');

    if (!peerId || !json) {
      return reply({ error: 'usage: router:send <peerId> <json>' });
    }
    
    // Validate JSON size (prevent memory exhaustion)
    if (json.length > 65536) {
      return reply({ error: 'Payload too large (max 64KB)' });
    }

    const router = supervisor.modules?.getModule
      ? supervisor.modules.getModule('router')
      : null;

    if (!router) {
      return reply({ error: 'router module not available' });
    }

    try {
      const payload = JSON.parse(json);
      await router.send(peerId, payload);
      return reply({ ok: true });
    } catch (err) {
      return reply({ ok: false, error: err.message });
    }
  }

  // --- Router: ping --------------------------------------------------------
  if (cmd.startsWith('router:ping ')) {
    const parts = cmd.split(' ');
    if (parts.length !== 2) {
      return reply({ error: 'usage: router:ping <peerId>' });
    }

    const peerId = parts[1];

    const router = supervisor.modules?.getModule
      ? supervisor.modules.getModule('router')
      : null;

    if (!router) {
      return reply({ error: 'router module not available' });
    }

    try {
      await router.send(peerId, {
        type: 'ping',
        body: { ts: Date.now() }
      });

      return reply({ ok: true });
    } catch (err) {
      return reply({ ok: false, error: err.message });
    }
  }
  
  // --- Logout (end session) ------------------------------------------------
  if (cmd === 'LOGOUT') {
    return { response: { ok: true, message: 'Session ended' }, close: true };
  }

  // --- Fallback ------------------------------------------------------------
  return reply({ error: 'unknown command' });
}
