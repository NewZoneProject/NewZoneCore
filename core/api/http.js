// Module: HTTP API Server
// Description: Secure HTTP API for NewZoneCore daemon with authentication.
// File: core/api/http.js

import http from 'http';
import { URL } from 'url';
import {
  validatePeerId,
  validateEd25519PublicKey,
  validateJsonPayload,
  validatePassword
} from '../utils/validator.js';
import { getSecurityAuditLogger, AuditEventType } from '../utils/security-audit.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_PORT = 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

// Rate limiting for login attempts
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

// Get security audit logger instance
const auditLogger = getSecurityAuditLogger();

// ============================================================================
// HTTP API SERVER
// ============================================================================

export async function startHttpApi({ supervisor, authManager }) {
  const server = http.createServer(async (req, res) => {
    // Set CORS headers based on allowed origins
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Content-Type', 'application/json');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    
    // --- Public endpoints (no auth required) -------------------------------
    
    // Health check
    if (path === '/health') {
      res.writeHead(200);
      return res.end(JSON.stringify({ status: 'ok', core: 'NewZoneCore' }));
    }
    
    // Login endpoint
    if (path === '/api/auth/login' && req.method === 'POST') {
      return handleLogin(req, res, authManager);
    }
    
    // Token refresh
    if (path === '/api/auth/refresh' && req.method === 'POST') {
      return handleRefresh(req, res, authManager);
    }
    
    // --- Protected endpoints (auth required) -------------------------------
    
    // Validate auth for all other endpoints
    const authResult = await validateAuth(req, authManager);
    
    if (!authResult.valid) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: authResult.error }));
    }
    
    // Attach auth info to request
    req.auth = authResult;
    
    // --- State endpoint ----------------------------------------------------
    if (path === '/api/state') {
      return handleState(req, res, supervisor);
    }
    
    // --- Trust endpoints ---------------------------------------------------
    if (path === '/api/trust' && req.method === 'GET') {
      return handleTrustList(req, res, supervisor);
    }
    
    if (path === '/api/trust' && req.method === 'POST') {
      return handleTrustAdd(req, res, supervisor);
    }
    
    if (path.startsWith('/api/trust?') && req.method === 'DELETE') {
      return handleTrustRemove(req, res, supervisor, url);
    }
    
    // --- Identity endpoint -------------------------------------------------
    if (path === '/api/identity') {
      return handleIdentity(req, res, supervisor, req.method);
    }
    
    // --- Services endpoint -------------------------------------------------
    if (path === '/api/services') {
      return handleServices(req, res, supervisor);
    }
    
    // --- API Key management (admin only) ----------------------------------
    if (path === '/api/admin/keys' && req.method === 'GET') {
      return handleListApiKeys(req, res, authManager);
    }
    
    if (path === '/api/admin/keys' && req.method === 'POST') {
      return handleGenerateApiKey(req, res, authManager);
    }
    
    // --- Fallback ---------------------------------------------------------
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  const port = process.env.API_PORT || DEFAULT_PORT;
  
  // Only listen on localhost by default (security fix)
  const host = process.env.API_HOST || '127.0.0.1';

  server.listen(port, host, () => {
    console.log(`[api:http] listening on http://${host}:${port}`);
    console.log(`[api:http] CORS allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  });

  return server;
}

// ============================================================================
// AUTH HANDLERS
// ============================================================================

/**
 * Check rate limit for login attempts.
 */
function checkLoginRateLimit(ip) {
  const now = Date.now();
  const attempts = loginAttempts.get(ip);

  if (!attempts) {
    return { allowed: true };
  }

  // Check if locked
  if (attempts.lockedUntil && now < attempts.lockedUntil) {
    const remaining = Math.ceil((attempts.lockedUntil - now) / 60000);
    return {
      allowed: false,
      error: `Too many login attempts. Try again in ${remaining} minutes.`
    };
  }

  // Reset if window expired
  if (now - attempts.firstAttempt > LOCKOUT_DURATION) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  // Check if max attempts exceeded
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    attempts.lockedUntil = now + LOCKOUT_DURATION;
    loginAttempts.set(ip, attempts);
    return {
      allowed: false,
      error: 'Too many login attempts. Account locked for 15 minutes.'
    };
  }

  return { allowed: true };
}

/**
 * Record failed login attempt.
 */
function recordFailedLogin(ip) {
  const now = Date.now();
  let attempts = loginAttempts.get(ip);

  if (!attempts) {
    attempts = { count: 0, firstAttempt: now };
  }

  attempts.count++;
  attempts.firstAttempt = now;
  loginAttempts.set(ip, attempts);
}

/**
 * Clear failed login attempts on success.
 */
function clearFailedLogin(ip) {
  loginAttempts.delete(ip);
}

async function validateAuth(req, authManager) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return { valid: false, error: 'Authorization required' };
  }

  // Bearer token
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (match) {
    return authManager.validateToken(match[1]);
  }

  // API key
  const keyMatch = authHeader.match(/^ApiKey\s+(.+)$/i);
  if (keyMatch) {
    return authManager.validateApiKey(keyMatch[1]);
  }

  return { valid: false, error: 'Invalid authorization format' };
}

async function handleLogin(req, res, authManager) {
  const clientIp = req.socket.remoteAddress || 'unknown';

  try {
    // Check rate limit first
    const rateLimit = checkLoginRateLimit(clientIp);
    if (!rateLimit.allowed) {
      recordFailedLogin(clientIp);
      
      // Log security incident
      await auditLogger.logRateLimit({
        endpoint: '/api/auth/login',
        limit: MAX_LOGIN_ATTEMPTS,
        windowMs: LOCKOUT_DURATION,
        currentCount: loginAttempts.get(clientIp)?.count || 0,
        ip: clientIp
      });
      
      res.writeHead(429);
      return res.end(JSON.stringify({ error: rateLimit.error }));
    }

    const body = await readBody(req);
    const { password } = JSON.parse(body);

    // Validate password
    try {
      validatePassword(password, {
        minLength: 8,
        maxLength: 128,
        requireUppercase: false,
        requireLowercase: false,
        requireNumbers: false,
        requireSymbols: false
      });
    } catch (error) {
      recordFailedLogin(clientIp);
      
      // Log invalid input
      await auditLogger.log(AuditEventType.SECURITY_INVALID_INPUT, {
        field: 'password',
        reason: error.message
      }, {
        ip: clientIp
      });
      
      res.writeHead(400);
      return res.end(JSON.stringify({ error: error.message }));
    }

    const result = await authManager.login(password, clientIp);

    if (result.success) {
      clearFailedLogin(clientIp);
      
      // Log successful authentication
      await auditLogger.logAuthSuccess({
        method: 'password',
        ip: clientIp
      });
      
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } else {
      recordFailedLogin(clientIp);
      
      // Log authentication failure
      await auditLogger.logAuthFailure({
        method: 'password',
        reason: result.error || 'unknown',
        ip: clientIp
      });
      
      res.writeHead(401);
      res.end(JSON.stringify({ error: result.error }));
    }
  } catch (error) {
    recordFailedLogin(clientIp);
    
    // Log error
    await auditLogger.logSecurityIncident({
      type: 'login_error',
      description: error.message,
      ip: clientIp
    });
    
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

async function handleRefresh(req, res, authManager) {
  try {
    const body = await readBody(req);
    const { refreshToken } = JSON.parse(body);
    
    if (!refreshToken) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'Refresh token required' }));
    }
    
    const result = authManager.refreshToken(refreshToken);
    
    if (result.success) {
      res.writeHead(200);
      res.end(JSON.stringify(result));
    } else {
      res.writeHead(401);
      res.end(JSON.stringify({ error: result.error }));
    }
  } catch (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

// ============================================================================
// STATE HANDLERS
// ============================================================================

async function handleState(req, res, supervisor) {
  let raw = {};

  try {
    raw = await supervisor.getState();
  } catch {
    raw = { error: 'state_unavailable' };
  }

  // Sanitize private fields - only return public information
  const state = {
    startedAt: raw.startedAt,
    node_id: raw.identity?.public || null,
    ecdh_public: raw.ecdh?.public || null,
    trust: raw.trust || {},
    services: raw.services || []
  };

  res.writeHead(200);
  res.end(JSON.stringify(state));
}

// ============================================================================
// TRUST HANDLERS
// ============================================================================

async function handleTrustList(req, res, supervisor) {
  const store = supervisor.trust || { peers: [] };
  res.writeHead(200);
  res.end(JSON.stringify({ peers: store.peers || [] }));
}

async function handleTrustAdd(req, res, supervisor) {
  try {
    // Validate payload size first
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > 1024 * 1024) { // 1MB max
      res.writeHead(413);
      return res.end(JSON.stringify({ error: 'Payload too large' }));
    }

    const body = await readBody(req);

    // Validate JSON size
    try {
      validateJsonPayload(body, 10 * 1024); // 10KB max for trust add
    } catch (error) {
      res.writeHead(413);
      return res.end(JSON.stringify({ error: error.message }));
    }

    const { id, pubkey } = JSON.parse(body);

    // Validate peer ID using validator
    try {
      validatePeerId(id);
    } catch (error) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: `Invalid peer ID: ${error.message}` }));
    }

    // Validate public key using validator
    try {
      validateEd25519PublicKey(pubkey);
    } catch (error) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: `Invalid public key: ${error.message}` }));
    }

    if (!supervisor.trust.peers) supervisor.trust.peers = [];

    supervisor.trust.peers.push({
      id,
      pubkey,
      addedAt: new Date().toISOString()
    });

    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, id }));
  } catch (error) {
    if (error instanceof SyntaxError) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
}

async function handleTrustRemove(req, res, supervisor, url) {
  const id = url.searchParams.get('id');

  // Validate peer ID
  try {
    validatePeerId(id);
  } catch (error) {
    res.writeHead(400);
    return res.end(JSON.stringify({ error: `Invalid peer ID: ${error.message}` }));
  }

  const before = supervisor.trust.peers?.length || 0;
  supervisor.trust.peers = (supervisor.trust.peers || []).filter(
    (p) => p.id !== id
  );
  const after = supervisor.trust.peers.length;

  res.writeHead(200);
  res.end(JSON.stringify({
    ok: true,
    removed: before - after
  }));
}

// ============================================================================
// IDENTITY HANDLERS
// ============================================================================

async function handleIdentity(req, res, supervisor, method) {
  if (method === 'POST') {
    // Export identity
    const body = await readBody(req);
    const data = JSON.parse(body);
    
    if (data.export) {
      // Return exportable identity (without private keys)
      const exported = {
        ed25519_public: supervisor.identity?.public || null,
        x25519_public: supervisor.ecdh?.public || null,
        exportedAt: new Date().toISOString()
      };
      
      res.writeHead(200);
      return res.end(JSON.stringify(exported));
    }
  }
  
  // GET - return identity info
  const id = supervisor.identity?.public || null;
  const ecdh = supervisor.ecdh?.public || null;

  res.writeHead(200);
  res.end(JSON.stringify({
    node_id: id,
    ed25519_public: id,
    x25519_public: ecdh
  }));
}

// ============================================================================
// SERVICES HANDLERS
// ============================================================================

async function handleServices(req, res, supervisor) {
  const list = supervisor.services || [];
  res.writeHead(200);
  res.end(JSON.stringify({ services: list }));
}

// ============================================================================
// API KEY HANDLERS
// ============================================================================

async function handleListApiKeys(req, res, authManager) {
  // Check if user has admin permission
  if (req.auth.permissions && !req.auth.permissions.includes('admin')) {
    res.writeHead(403);
    return res.end(JSON.stringify({ error: 'Admin permission required' }));
  }
  
  const keys = authManager.listApiKeys();
  res.writeHead(200);
  res.end(JSON.stringify({ keys }));
}

async function handleGenerateApiKey(req, res, authManager) {
  // Check if user has admin permission
  if (req.auth.permissions && !req.auth.permissions.includes('admin')) {
    res.writeHead(403);
    return res.end(JSON.stringify({ error: 'Admin permission required' }));
  }
  
  try {
    const body = await readBody(req);
    const { name, permissions } = JSON.parse(body);
    
    if (!name) {
      res.writeHead(400);
      return res.end(JSON.stringify({ error: 'API key name required' }));
    }
    
    const result = await authManager.generateApiKey(name, permissions);
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
