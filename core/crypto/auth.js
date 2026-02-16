// Module: Authentication Manager
// Description: JWT-based authentication with API key support,
//              rate limiting, and session management.
// File: core/crypto/auth.js

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

// ============================================================================
// CONFIGURATION
// ============================================================================

const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'newzonecore';
const JWT_AUDIENCE = 'nzcore-api';
const ACCESS_TOKEN_EXPIRY = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
const API_KEY_LENGTH = 32;

// Rate limiting
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

// ============================================================================
// AUTHENTICATION MANAGER
// ============================================================================

export class AuthManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.masterKey = options.masterKey;
    this.jwtSecret = options.jwtSecret || this._deriveJwtSecret(options.masterKey);
    
    // Token storage
    this.refreshTokens = new Map(); // tokenId -> { userId, expiresAt, createdAt }
    this.apiKeys = new Map(); // keyId -> { name, permissions, createdAt, lastUsed }
    
    // Rate limiting
    this.loginAttempts = new Map(); // ip -> { count, firstAttempt, lockedUntil }
    
    // Options
    this.options = {
      accessTokenExpiry: options.accessTokenExpiry || ACCESS_TOKEN_EXPIRY,
      refreshTokenExpiry: options.refreshTokenExpiry || REFRESH_TOKEN_EXPIRY,
      maxLoginAttempts: options.maxLoginAttempts || MAX_LOGIN_ATTEMPTS,
      lockoutDuration: options.lockoutDuration || LOCKOUT_DURATION,
      requireStrongPassword: options.requireStrongPassword !== false,
      ...options
    };
    
    // Storage path for persistence
    this.storagePath = options.storagePath || null;
  }
  
  // ==========================================================================
  // JWT SECRET DERIVATION
  // ==========================================================================
  
  /**
   * Derive JWT secret from master key using HKDF
   */
  _deriveJwtSecret(masterKey) {
    if (!masterKey) {
      // Generate random secret for dev mode
      return crypto.randomBytes(32);
    }
    
    const keyBuffer = Buffer.isBuffer(masterKey) 
      ? masterKey 
      : Buffer.from(masterKey, 'base64');
    
    // Use HKDF to derive a separate key for JWT signing
    return crypto.createHmac('sha256', 'nzcore:jwt:v1')
      .update(keyBuffer)
      .digest();
  }
  
  // ==========================================================================
  // PASSWORD VERIFICATION
  // ==========================================================================
  
  /**
   * Verify password and create session
   */
  async login(password, clientIp = 'unknown') {
    // Check rate limiting
    const lockout = this._checkLockout(clientIp);
    if (lockout.locked) {
      this.emit('login:blocked', { ip: clientIp, remaining: lockout.remaining });
      return {
        success: false,
        error: `Too many login attempts. Try again in ${Math.ceil(lockout.remaining / 60000)} minutes.`
      };
    }
    
    // Import password verification
    const { verifyPassword } = await import('./master.js');
    const { loadOrCreateSalt } = await import('./master.js');
    
    const salt = await loadOrCreateSalt(false);
    const valid = await verifyPassword(password, salt);
    
    if (!valid) {
      this._recordFailedLogin(clientIp);
      this.emit('login:failed', { ip: clientIp });
      return { success: false, error: 'Invalid password' };
    }
    
    // Reset failed attempts on successful login
    this._clearFailedLogins(clientIp);
    
    // Generate tokens
    const accessToken = this._generateAccessToken();
    const refreshToken = this._generateRefreshToken();
    
    this.emit('login:success', { ip: clientIp });
    
    return {
      success: true,
      accessToken,
      refreshToken,
      expiresIn: this.options.accessTokenExpiry
    };
  }
  
  // ==========================================================================
  // TOKEN MANAGEMENT
  // ==========================================================================
  
  /**
   * Generate access token (JWT)
   */
  _generateAccessToken() {
    const now = Date.now();
    const expiresAt = now + this.options.accessTokenExpiry;
    
    const payload = {
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: Math.floor(now / 1000),
      exp: Math.floor(expiresAt / 1000),
      jti: crypto.randomBytes(16).toString('hex'),
      type: 'access'
    };
    
    return this._signJwt(payload);
  }
  
  /**
   * Generate refresh token
   */
  _generateRefreshToken() {
    const tokenId = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    
    this.refreshTokens.set(tokenId, {
      createdAt: now,
      expiresAt: now + this.options.refreshTokenExpiry
    });
    
    return tokenId;
  }
  
  /**
   * Refresh access token
   */
  refreshToken(refreshToken) {
    const stored = this.refreshTokens.get(refreshToken);
    
    if (!stored) {
      return { success: false, error: 'Invalid refresh token' };
    }
    
    if (Date.now() > stored.expiresAt) {
      this.refreshTokens.delete(refreshToken);
      return { success: false, error: 'Refresh token expired' };
    }
    
    const accessToken = this._generateAccessToken();
    
    return {
      success: true,
      accessToken,
      expiresIn: this.options.accessTokenExpiry
    };
  }
  
  /**
   * Validate access token
   */
  validateToken(token) {
    try {
      const payload = this._verifyJwt(token);
      
      if (!payload || payload.type !== 'access') {
        return { valid: false, error: 'Invalid token type' };
      }
      
      return {
        valid: true,
        tokenId: payload.jti,
        expiresAt: payload.exp * 1000
      };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
  
  /**
   * Logout - invalidate refresh token
   */
  logout(refreshToken) {
    if (refreshToken) {
      this.refreshTokens.delete(refreshToken);
    }
    return { success: true };
  }
  
  // ==========================================================================
  // JWT HELPERS
  // ==========================================================================
  
  /**
   * Sign JWT payload
   */
  _signJwt(payload) {
    const header = {
      alg: JWT_ALGORITHM,
      typ: 'JWT'
    };
    
    const headerB64 = this._base64UrlEncode(JSON.stringify(header));
    const payloadB64 = this._base64UrlEncode(JSON.stringify(payload));
    
    const signature = crypto.createHmac('sha256', this.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    
    const signatureB64 = this._base64UrlEncode(signature);
    
    return `${headerB64}.${payloadB64}.${signatureB64}`;
  }
  
  /**
   * Verify JWT signature and decode payload
   */
  _verifyJwt(token) {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }
    
    const [headerB64, payloadB64, signatureB64] = parts;
    
    // Verify signature
    const expectedSignature = crypto.createHmac('sha256', this.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    
    const actualSignature = this._base64UrlDecode(signatureB64);
    
    if (!crypto.timingSafeEqual(expectedSignature, actualSignature)) {
      throw new Error('Invalid JWT signature');
    }
    
    // Decode payload
    const payload = JSON.parse(this._base64UrlDecode(payloadB64).toString('utf8'));
    
    // Check expiration
    if (payload.exp && Date.now() > payload.exp * 1000) {
      throw new Error('JWT expired');
    }
    
    return payload;
  }
  
  /**
   * Base64URL encode
   */
  _base64UrlEncode(data) {
    let buf;
    if (Buffer.isBuffer(data)) {
      buf = data;
    } else if (typeof data === 'string') {
      buf = Buffer.from(data, 'utf8');
    } else {
      buf = Buffer.from(JSON.stringify(data), 'utf8');
    }
    
    return buf.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
  
  /**
   * Base64URL decode
   */
  _base64UrlDecode(str) {
    const base64 = str
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    const padding = base64.length % 4;
    const padded = padding ? base64 + '='.repeat(4 - padding) : base64;
    
    return Buffer.from(padded, 'base64');
  }
  
  // ==========================================================================
  // API KEY MANAGEMENT
  // ==========================================================================
  
  /**
   * Generate API key
   */
  async generateApiKey(name, permissions = []) {
    if (!name || typeof name !== 'string') {
      throw new Error('API key name is required');
    }
    
    const keyId = crypto.randomBytes(16).toString('hex');
    const keyValue = crypto.randomBytes(API_KEY_LENGTH).toString('base64');
    const keyHash = crypto.createHash('sha256').update(keyValue).digest('hex');
    
    this.apiKeys.set(keyId, {
      name,
      keyHash,
      permissions: permissions || [],
      createdAt: Date.now(),
      lastUsed: null
    });
    
    // Return the actual key only once
    return {
      id: keyId,
      key: `nz_${keyId}_${keyValue}`,
      name,
      permissions,
      createdAt: new Date().toISOString()
    };
  }
  
  /**
   * Validate API key
   */
  validateApiKey(key) {
    if (!key || !key.startsWith('nz_')) {
      return { valid: false, error: 'Invalid API key format' };
    }
    
    const parts = key.split('_');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid API key format' };
    }
    
    const [, keyId, keyValue] = parts;
    const stored = this.apiKeys.get(keyId);
    
    if (!stored) {
      return { valid: false, error: 'API key not found' };
    }
    
    const keyHash = crypto.createHash('sha256').update(keyValue).digest('hex');
    
    if (!crypto.timingSafeEqual(
      Buffer.from(stored.keyHash, 'hex'),
      Buffer.from(keyHash, 'hex')
    )) {
      return { valid: false, error: 'Invalid API key' };
    }
    
    // Update last used
    stored.lastUsed = Date.now();
    
    return {
      valid: true,
      keyId,
      name: stored.name,
      permissions: stored.permissions
    };
  }
  
  /**
   * List API keys (without the actual key values)
   */
  listApiKeys() {
    const keys = [];
    
    for (const [id, data] of this.apiKeys) {
      keys.push({
        id,
        name: data.name,
        permissions: data.permissions,
        createdAt: new Date(data.createdAt).toISOString(),
        lastUsed: data.lastUsed ? new Date(data.lastUsed).toISOString() : null
      });
    }
    
    return keys;
  }
  
  /**
   * Revoke API key
   */
  revokeApiKey(keyId) {
    const deleted = this.apiKeys.delete(keyId);
    return { success: deleted, keyId };
  }
  
  // ==========================================================================
  // RATE LIMITING
  // ==========================================================================
  
  /**
   * Check if IP is locked out
   */
  _checkLockout(ip) {
    const attempts = this.loginAttempts.get(ip);
    
    if (!attempts) {
      return { locked: false };
    }
    
    if (attempts.lockedUntil && Date.now() < attempts.lockedUntil) {
      return {
        locked: true,
        remaining: attempts.lockedUntil - Date.now()
      };
    }
    
    // Clear expired lockout
    if (attempts.lockedUntil) {
      this.loginAttempts.delete(ip);
      return { locked: false };
    }
    
    return { locked: false };
  }
  
  /**
   * Record failed login attempt
   */
  _recordFailedLogin(ip) {
    const attempts = this.loginAttempts.get(ip) || {
      count: 0,
      firstAttempt: Date.now()
    };
    
    attempts.count++;
    
    if (attempts.count >= this.options.maxLoginAttempts) {
      attempts.lockedUntil = Date.now() + this.options.lockoutDuration;
      this.emit('login:locked', { ip, duration: this.options.lockoutDuration });
    }
    
    this.loginAttempts.set(ip, attempts);
  }
  
  /**
   * Clear failed login attempts
   */
  _clearFailedLogins(ip) {
    this.loginAttempts.delete(ip);
  }
  
  // ==========================================================================
  // PERSISTENCE
  // ==========================================================================
  
  /**
   * Save state to disk
   */
  async save() {
    if (!this.storagePath) return;
    
    const state = {
      apiKeys: Object.fromEntries(this.apiKeys),
      refreshTokens: Object.fromEntries(this.refreshTokens)
    };
    
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    await fs.writeFile(this.storagePath, JSON.stringify(state), { mode: 0o600 });
  }
  
  /**
   * Load state from disk
   */
  async load() {
    if (!this.storagePath) return;
    
    try {
      const data = await fs.readFile(this.storagePath, 'utf8');
      const state = JSON.parse(data);
      
      if (state.apiKeys) {
        this.apiKeys = new Map(Object.entries(state.apiKeys));
      }
      
      // Filter out expired refresh tokens
      const now = Date.now();
      if (state.refreshTokens) {
        for (const [id, token] of Object.entries(state.refreshTokens)) {
          if (token.expiresAt > now) {
            this.refreshTokens.set(id, token);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  
  // ==========================================================================
  // CLEANUP
  // ==========================================================================
  
  /**
   * Cleanup expired tokens and old rate limit entries
   */
  cleanup() {
    const now = Date.now();
    let cleaned = { tokens: 0, rateLimits: 0 };
    
    // Cleanup expired refresh tokens
    for (const [id, token] of this.refreshTokens) {
      if (token.expiresAt < now) {
        this.refreshTokens.delete(id);
        cleaned.tokens++;
      }
    }
    
    // Cleanup old rate limit entries
    for (const [ip, attempts] of this.loginAttempts) {
      if (attempts.lockedUntil && attempts.lockedUntil < now) {
        this.loginAttempts.delete(ip);
        cleaned.rateLimits++;
      } else if (attempts.firstAttempt && now - attempts.firstAttempt > this.options.lockoutDuration * 2) {
        this.loginAttempts.delete(ip);
        cleaned.rateLimits++;
      }
    }
    
    return cleaned;
  }
  
  /**
   * Get authentication statistics
   */
  getStats() {
    return {
      activeRefreshTokens: this.refreshTokens.size,
      apiKeys: this.apiKeys.size,
      lockedIps: [...this.loginAttempts.values()].filter(a => a.lockedUntil && a.lockedUntil > Date.now()).length
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createAuthManager(options = {}) {
  return new AuthManager(options);
}
