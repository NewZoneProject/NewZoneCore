// Module: IPC Server
// Description: Cross-platform, self-contained IPC server for NewZoneCore.
//              Now with token-based authentication for security.
// File: core/api/ipc.js

import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import {
  validatePeerId,
  validateEd25519PublicKey,
  validateMessageSize,
  sanitizeString
} from '../utils/validator.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const RUNTIME_DIR = path.join(process.cwd(), 'runtime', 'ipc');
const TOKEN_FILE = path.join(process.cwd(), 'env', '.ipc_token');

const SOCKET_PATH =
  os.platform() === 'win32'
    ? '\\\\.\\pipe\\nzcore'
    : path.join(RUNTIME_DIR, 'nzcore.sock');

// Rate limiting configuration
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Rate limiting state
const authAttempts = new Map(); // IP -> { count, firstAttempt, lockedUntil }

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
 * Validate IPC token with constant-time comparison.
 * SECURITY: Uses timing-safe comparison to prevent timing attacks.
 */
function validateIpcToken(providedToken, expectedToken) {
  if (!providedToken || !expectedToken) {
    // Constant-time return to prevent timing analysis
    crypto.randomBytes(1);
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(String(providedToken), 'utf8'),
      Buffer.from(String(expectedToken), 'utf8')
    );
  } catch {
    return false;
  }
}

/**
 * Check rate limit for authentication attempts.
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const attempts = authAttempts.get(ip);

  if (!attempts) {
    return { allowed: true };
  }

  // Check if locked
  if (attempts.lockedUntil && now < attempts.lockedUntil) {
    const remaining = Math.ceil((attempts.lockedUntil - now) / 60000);
    return {
      allowed: false,
      error: `Too many failed attempts. Try again in ${remaining} minutes.`
    };
  }

  // Reset if window expired
  if (now - attempts.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    authAttempts.delete(ip);
    return { allowed: true };
  }

  // Check if max attempts exceeded
  if (attempts.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    attempts.lockedUntil = now + RATE_LIMIT_WINDOW_MS;
    authAttempts.set(ip, attempts);
    return {
      allowed: false,
      error: 'Too many failed attempts. Account locked for 15 minutes.'
    };
  }

  return { allowed: true };
}

/**
 * Record failed authentication attempt.
 */
function recordFailedAttempt(ip) {
  const now = Date.now();
  let attempts = authAttempts.get(ip);

  if (!attempts) {
    attempts = { count: 0, firstAttempt: now };
  }

  attempts.count++;
  attempts.firstAttempt = now;
  authAttempts.set(ip, attempts);
}

/**
 * Clear failed attempts on successful authentication.
 */
function clearFailedAttempts(ip) {
  authAttempts.delete(ip);
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
  const remoteAddress = 'ipc'; // IPC connections don't have remote IP

  // Helper: write + end
  const reply = (obj) => ({ response: obj });
  const close = () => ({ close: true });

  // --- Authentication command with rate limiting ----------------------------
  if (cmd.startsWith('AUTH ')) {
    const token = cmd.substring(5).trim();

    // Check rate limit
    const rateLimit = checkRateLimit(remoteAddress);
    if (!rateLimit.allowed) {
      recordFailedAttempt(remoteAddress);
      return reply({ error: rateLimit.error });
    }

    // Validate token format before comparison
    if (!token || typeof token !== 'string' || token.length !== 64) {
      recordFailedAttempt(remoteAddress);
      return reply({ error: 'Invalid token format' });
    }

    // Constant-time validation
    if (validateIpcToken(token, ipcToken)) {
      clearFailedAttempts(remoteAddress);
      return { authenticated: true, response: { ok: true, message: 'Authenticated' } };
    }

    recordFailedAttempt(remoteAddress);
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

  // --- Trust add with strict validation ------------------------------------
  if (cmd.startsWith('trust:add ')) {
    const parts = cmd.split(' ');
    if (parts.length !== 3) {
      return reply({ error: 'Usage: trust:add <id> <pubkey>' });
    }

    // Sanitize inputs
    const id = sanitizeString(parts[1]);
    const pubkey = sanitizeString(parts[2]);

    // Validate peer ID using validator
    try {
      validatePeerId(id);
    } catch (error) {
      return reply({ error: `Invalid peer ID: ${error.message}` });
    }

    // Validate public key using validator
    try {
      validateEd25519PublicKey(pubkey);
    } catch (error) {
      return reply({ error: `Invalid public key: ${error.message}` });
    }

    try {
      if (!supervisor.trust.peers) supervisor.trust.peers = [];

      supervisor.trust.peers.push({
        id,
        pubkey,
        addedAt: new Date().toISOString()
      });

      return reply({ ok: true, id });
    } catch (err) {
      return reply({ ok: false, error: err.message });
    }
  }

  // --- Trust remove with validation ----------------------------------------
  if (cmd.startsWith('trust:remove ')) {
    const parts = cmd.split(' ');
    if (parts.length !== 2) {
      return reply({ error: 'Usage: trust:remove <id>' });
    }

    const id = sanitizeString(parts[1]);

    // Validate peer ID
    try {
      validatePeerId(id);
    } catch (error) {
      return reply({ error: `Invalid peer ID: ${error.message}` });
    }

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
      return reply({ error: 'Usage: router:add <peerId> <pubkey>' });
    }

    const peerId = sanitizeString(parts[1]);
    const pubkey = sanitizeString(parts[2]);

    // Validate peer ID
    try {
      validatePeerId(peerId);
    } catch (error) {
      return reply({ error: `Invalid peer ID: ${error.message}` });
    }

    // Validate public key
    try {
      validateEd25519PublicKey(pubkey);
    } catch (error) {
      return reply({ error: `Invalid public key: ${error.message}` });
    }

    const router = supervisor.modules?.getModule
      ? supervisor.modules.getModule('router')
      : null;

    if (!router) {
      return reply({ error: 'Router module not available' });
    }

    try {
      router.addRoute(peerId, pubkey);
      return reply({ ok: true, peerId });
    } catch (err) {
      return reply({ ok: false, error: err.message });
    }
  }

  // --- Router: remove ------------------------------------------------------
  if (cmd.startsWith('router:remove ')) {
    const parts = cmd.split(' ');
    if (parts.length !== 2) {
      return reply({ error: 'Usage: router:remove <peerId>' });
    }

    const peerId = sanitizeString(parts[1]);

    // Validate peer ID
    try {
      validatePeerId(peerId);
    } catch (error) {
      return reply({ error: `Invalid peer ID: ${error.message}` });
    }

    const router = supervisor.modules?.getModule
      ? supervisor.modules.getModule('router')
      : null;

    if (!router) {
      return reply({ error: 'Router module not available' });
    }

    try {
      router.removeRoute(peerId);
      return reply({ ok: true, peerId });
    } catch (err) {
      return reply({ ok: false, error: err.message });
    }
  }

  // --- Router: send with strict size limit ---------------------------------
  if (cmd.startsWith('router:send ')) {
    const parts = cmd.split(' ');
    const peerId = sanitizeString(parts[1]);
    const json = parts.slice(2).join(' ');

    if (!peerId || !json) {
      return reply({ error: 'Usage: router:send <peerId> <json>' });
    }

    // Validate peer ID
    try {
      validatePeerId(peerId);
    } catch (error) {
      return reply({ error: `Invalid peer ID: ${error.message}` });
    }

    // Validate JSON size (prevent memory exhaustion - DoS protection)
    try {
      validateMessageSize(json, 64 * 1024); // 64KB max
    } catch (error) {
      return reply({ error: error.message });
    }

    const router = supervisor.modules?.getModule
      ? supervisor.modules.getModule('router')
      : null;

    if (!router) {
      return reply({ error: 'Router module not available' });
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
