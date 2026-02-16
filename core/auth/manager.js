// Module: Authentication Manager
// Description: JWT-based authentication for HTTP API and IPC.
//              Implements secure token generation, validation, and refresh.
// File: core/auth/manager.js

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================

const TOKEN_EXPIRY = 3600000;        // 1 hour in milliseconds
const REFRESH_TOKEN_EXPIRY = 604800000; // 7 days in milliseconds
const MIN_PASSWORD_LENGTH = 8;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 300000;    // 5 minutes in milliseconds

// ============================================================================
// TOKEN STRUCTURE (Simple JWT-like format without external dependencies)
// ============================================================================

/**
 * Create a simple signed token.
 * Format: base64(header).base64(payload).base64(signature)
 */
function createToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8');
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  
  const headerB64 = header.toString('base64url');
  const payloadB64 = payloadBuf.toString('base64url');
  
  const signature = crypto.createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');
  
  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify and decode a token.
 * Returns payload if valid, null if invalid.
 */
function verifyToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [headerB64, payloadB64, signature] = parts;
    
    // Verify signature
    const expectedSig = crypto.createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
    
    if (!crypto.timingSafeEqual(
      Buffer.from(signature, 'base64url'),
      Buffer.from(expectedSig, 'base64url')
    )) {
      return null;
    }
    
    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    
    // Check expiration
    if (payload.exp && Date.now() > payload.exp) {
      return { expired: true, payload };
    }
    
    return { valid: true, payload };
  } catch {
    return null;
  }
}

// ============================================================================
// AUTHENTICATION MANAGER
// ============================================================================

export class AuthManager {
  constructor(options = {}) {
    this.secretKey = options.secretKey || null;
    this.tokenExpiry = options.tokenExpiry || TOKEN_EXPIRY;
    this.refreshTokenExpiry = options.refreshTokenExpiry || REFRESH_TOKEN_EXPIRY;
    
    // Rate limiting
    this.loginAttempts = new Map(); // IP -> { count, lockoutUntil }
    
    // Token blacklist (for logout)
    this.blacklistedTokens = new Set();
    
    // API keys (for programmatic access)
    this.apiKeys = new Map();
    
    // Paths
    this.envPath = options.envPath || './env';
    this.apiKeysFile = path.join(this.envPath, 'api-keys.json');
  }
  
  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  
  /**
   * Initialize auth manager with secret key.
   * Uses master key to derive auth secret.
   */
  async init(masterKey) {
    if (!masterKey) {
      throw new Error('Master key required for auth initialization');
    }
    
    // Derive auth secret from master key using HKDF-like derivation
    const info = Buffer.from('nzcore:auth:v1', 'utf8');
    this.secretKey = crypto.createHmac('sha256', masterKey)
      .update(info)
      .digest();
    
    // Load API keys
    await this._loadApiKeys();
    
    return this;
  }
  
  /**
   * Load API keys from file.
   */
  async _loadApiKeys() {
    try {
      const data = await fs.readFile(this.apiKeysFile, 'utf8');
      const keys = JSON.parse(data);
      
      for (const key of keys) {
        this.apiKeys.set(key.key, {
          id: key.id,
          name: key.name,
          permissions: key.permissions || ['read'],
          createdAt: key.createdAt,
          lastUsed: key.lastUsed
        });
      }
      
      console.log(`[auth] Loaded ${this.apiKeys.size} API keys`);
    } catch {
      // No API keys file yet
    }
  }
  
  // ==========================================================================
  // LOGIN / AUTHENTICATION
  // ==========================================================================
  
  /**
   * Authenticate user with password.
   * Returns tokens if successful.
   */
  async login(password, clientIp = 'unknown') {
    // Check rate limiting
    if (this._isLockedOut(clientIp)) {
      const attempts = this.loginAttempts.get(clientIp);
      const remaining = Math.ceil((attempts.lockoutUntil - Date.now()) / 1000);
      return {
        success: false,
        error: `Too many login attempts. Try again in ${remaining} seconds.`
      };
    }
    
    // Verify password
    const { verifyPassword } = await import('../crypto/master.js');
    const valid = await verifyPassword(password);
    
    if (!valid) {
      this._recordFailedLogin(clientIp);
      return { success: false, error: 'Invalid password' };
    }
    
    // Reset failed attempts on successful login
    this.loginAttempts.delete(clientIp);
    
    // Generate tokens
    const accessToken = this._generateAccessToken();
    const refreshToken = this._generateRefreshToken();
    
    return {
      success: true,
      accessToken,
      refreshToken,
      expiresIn: this.tokenExpiry
    };
  }
  
  /**
   * Generate access token.
   */
  _generateAccessToken() {
    const payload = {
      type: 'access',
      iat: Date.now(),
      exp: Date.now() + this.tokenExpiry,
      jti: crypto.randomBytes(16).toString('hex')
    };
    
    return createToken(payload, this.secretKey);
  }
  
  /**
   * Generate refresh token.
   */
  _generateRefreshToken() {
    const payload = {
      type: 'refresh',
      iat: Date.now(),
      exp: Date.now() + this.refreshTokenExpiry,
      jti: crypto.randomBytes(16).toString('hex')
    };
    
    return createToken(payload, this.secretKey);
  }
  
  // ==========================================================================
  // TOKEN VALIDATION
  // ==========================================================================
  
  /**
   * Validate access token.
   */
  validateToken(token) {
    // Check blacklist
    if (this.blacklistedTokens.has(token)) {
      return { valid: false, error: 'Token revoked' };
    }
    
    const result = verifyToken(token, this.secretKey);
    
    if (!result) {
      return { valid: false, error: 'Invalid token' };
    }
    
    if (result.expired) {
      return { valid: false, error: 'Token expired', expired: true };
    }
    
    return { valid: true, payload: result.payload };
  }
  
  /**
   * Validate API key.
   */
  validateApiKey(key) {
    const keyData = this.apiKeys.get(key);
    
    if (!keyData) {
      return { valid: false, error: 'Invalid API key' };
    }
    
    // Update last used
    keyData.lastUsed = new Date().toISOString();
    
    return { valid: true, ...keyData };
  }
  
  /**
   * Refresh access token using refresh token.
   */
  refreshToken(refreshToken) {
    const result = verifyToken(refreshToken, this.secretKey);
    
    if (!result || !result.valid) {
      return { success: false, error: 'Invalid refresh token' };
    }
    
    if (result.payload.type !== 'refresh') {
      return { success: false, error: 'Not a refresh token' };
    }
    
    // Check blacklist
    if (this.blacklistedTokens.has(refreshToken)) {
      return { success: false, error: 'Token revoked' };
    }
    
    // Generate new access token
    const newAccessToken = this._generateAccessToken();
    
    return {
      success: true,
      accessToken: newAccessToken,
      expiresIn: this.tokenExpiry
    };
  }
  
  /**
   * Logout - invalidate tokens.
   */
  logout(token) {
    // Add to blacklist
    this.blacklistedTokens.add(token);
    
    // Clean up old blacklisted tokens periodically
    this._cleanupBlacklist();
    
    return { success: true };
  }
  
  // ==========================================================================
  // API KEY MANAGEMENT
  // ==========================================================================
  
  /**
   * Generate new API key.
   */
  async generateApiKey(name, permissions = ['read']) {
    const key = `nz_${crypto.randomBytes(24).toString('base64url')}`;
    const id = crypto.randomBytes(8).toString('hex');
    
    this.apiKeys.set(key, {
      id,
      name,
      permissions,
      createdAt: new Date().toISOString(),
      lastUsed: null
    });
    
    await this._saveApiKeys();
    
    return { key, id, name, permissions };
  }
  
  /**
   * Revoke API key.
   */
  async revokeApiKey(key) {
    if (this.apiKeys.has(key)) {
      this.apiKeys.delete(key);
      await this._saveApiKeys();
      return { success: true };
    }
    return { success: false, error: 'Key not found' };
  }
  
  /**
   * List all API keys (without the actual keys).
   */
  listApiKeys() {
    const keys = [];
    for (const [key, data] of this.apiKeys) {
      keys.push({
        id: data.id,
        name: data.name,
        permissions: data.permissions,
        createdAt: data.createdAt,
        lastUsed: data.lastUsed,
        prefix: key.substring(0, 10) + '...'
      });
    }
    return keys;
  }
  
  async _saveApiKeys() {
    const keys = [];
    for (const [key, data] of this.apiKeys) {
      keys.push({ key, ...data });
    }
    await fs.mkdir(this.envPath, { recursive: true });
    await fs.writeFile(this.apiKeysFile, JSON.stringify(keys, null, 2), 'utf8');
  }
  
  // ==========================================================================
  // RATE LIMITING
  // ==========================================================================
  
  _isLockedOut(clientIp) {
    const attempts = this.loginAttempts.get(clientIp);
    if (!attempts) return false;
    
    if (attempts.lockoutUntil && Date.now() < attempts.lockoutUntil) {
      return true;
    }
    
    return false;
  }
  
  _recordFailedLogin(clientIp) {
    const attempts = this.loginAttempts.get(clientIp) || { count: 0 };
    attempts.count++;
    
    if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
      attempts.lockoutUntil = Date.now() + LOCKOUT_DURATION;
      attempts.count = 0;
    }
    
    this.loginAttempts.set(clientIp, attempts);
  }
  
  _cleanupBlacklist() {
    // Keep blacklist manageable
    if (this.blacklistedTokens.size > 10000) {
      // Remove oldest half
      const tokens = [...this.blacklistedTokens];
      for (let i = 0; i < tokens.length / 2; i++) {
        this.blacklistedTokens.delete(tokens[i]);
      }
    }
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let globalAuthManager = null;

export function getAuthManager(options = {}) {
  if (!globalAuthManager) {
    globalAuthManager = new AuthManager(options);
  }
  return globalAuthManager;
}

export function createAuthManager(options = {}) {
  return new AuthManager(options);
}

// ============================================================================
// EXPRESS/HTTP COMPATIBILITY
// ============================================================================

/**
 * Express-compatible middleware factory.
 */
export function createAuthMiddleware(authManager) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    
    // Bearer token
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match) {
      const result = authManager.validateToken(match[1]);
      if (!result.valid) {
        return res.status(401).json({ error: result.error });
      }
      req.auth = result.payload;
      return next();
    }
    
    // API key
    const keyMatch = authHeader.match(/^ApiKey\s+(.+)$/i);
    if (keyMatch) {
      const result = authManager.validateApiKey(keyMatch[1]);
      if (!result.valid) {
        return res.status(401).json({ error: result.error });
      }
      req.auth = result;
      return next();
    }
    
    res.status(401).json({ error: 'Invalid authorization' });
  };
}
