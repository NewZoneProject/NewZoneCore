// Module: Security Audit Logger
// Description: Dedicated security audit logging for compliance and forensics.
//              Logs authentication events, authorization failures, and security incidents.
// File: core/utils/security-audit.js

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';

// ============================================================================
// AUDIT EVENT TYPES
// ============================================================================

export const AuditEventType = {
  // Authentication
  AUTH_LOGIN_SUCCESS: 'auth:login:success',
  AUTH_LOGIN_FAILED: 'auth:login:failed',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_TOKEN_REFRESH: 'auth:token:refresh',
  AUTH_TOKEN_REVOKED: 'auth:token:revoked',
  
  // Authorization
  AUTH_ACCESS_GRANTED: 'auth:access:granted',
  AUTH_ACCESS_DENIED: 'auth:access:denied',
  AUTH_PERMISSION_CHANGED: 'auth:permission:changed',
  
  // Account Management
  ACCOUNT_CREATED: 'account:created',
  ACCOUNT_UPDATED: 'account:updated',
  ACCOUNT_DELETED: 'account:deleted',
  ACCOUNT_LOCKED: 'account:locked',
  ACCOUNT_UNLOCKED: 'account:unlocked',
  
  // Key Management
  KEY_GENERATED: 'key:generated',
  KEY_IMPORTED: 'key:imported',
  KEY_EXPORTED: 'key:exported',
  KEY_ROTATED: 'key:rotated',
  KEY_REVOKED: 'key:revoked',
  
  // Trust Management
  TRUST_PEER_ADDED: 'trust:peer:added',
  TRUST_PEER_REMOVED: 'trust:peer:removed',
  TRUST_PEER_UPDATED: 'trust:peer:updated',
  TRUST_SYNC: 'trust:sync',
  
  // Security Incidents
  SECURITY_RATE_LIMIT: 'security:rate:limit',
  SECURITY_BRUTE_FORCE: 'security:brute:force',
  SECURITY_INVALID_INPUT: 'security:invalid:input',
  SECURITY_TAMPERING: 'security:tampering',
  SECURITY_ANOMALY: 'security:anomaly',
  
  // System
  SYSTEM_STARTUP: 'system:startup',
  SYSTEM_SHUTDOWN: 'system:shutdown',
  SYSTEM_CONFIG_CHANGED: 'system:config:changed',
  SYSTEM_BACKUP: 'system:backup',
  SYSTEM_RESTORE: 'system:restore'
};

// ============================================================================
// AUDIT SEVERITY LEVELS
// ============================================================================

export const AuditSeverity = {
  LOW: 'low',           // Informational
  MEDIUM: 'medium',     // Potentially important
  HIGH: 'high',         // Security relevant
  CRITICAL: 'critical'  // Immediate attention required
};

// ============================================================================
// DEFAULT SEVERITY MAPPING
// ============================================================================

const DEFAULT_SEVERITY_MAP = {
  [AuditEventType.AUTH_LOGIN_SUCCESS]: AuditSeverity.LOW,
  [AuditEventType.AUTH_LOGIN_FAILED]: AuditSeverity.MEDIUM,
  [AuditEventType.AUTH_LOGOUT]: AuditSeverity.LOW,
  [AuditEventType.AUTH_TOKEN_REFRESH]: AuditSeverity.LOW,
  [AuditEventType.AUTH_TOKEN_REVOKED]: AuditSeverity.MEDIUM,
  
  [AuditEventType.AUTH_ACCESS_GRANTED]: AuditSeverity.LOW,
  [AuditEventType.AUTH_ACCESS_DENIED]: AuditSeverity.MEDIUM,
  [AuditEventType.AUTH_PERMISSION_CHANGED]: AuditSeverity.HIGH,
  
  [AuditEventType.ACCOUNT_CREATED]: AuditSeverity.LOW,
  [AuditEventType.ACCOUNT_UPDATED]: AuditSeverity.LOW,
  [AuditEventType.ACCOUNT_DELETED]: AuditSeverity.HIGH,
  [AuditEventType.ACCOUNT_LOCKED]: AuditSeverity.HIGH,
  [AuditEventType.ACCOUNT_UNLOCKED]: AuditSeverity.MEDIUM,
  
  [AuditEventType.KEY_GENERATED]: AuditSeverity.HIGH,
  [AuditEventType.KEY_IMPORTED]: AuditSeverity.HIGH,
  [AuditEventType.KEY_EXPORTED]: AuditSeverity.HIGH,
  [AuditEventType.KEY_ROTATED]: AuditSeverity.HIGH,
  [AuditEventType.KEY_REVOKED]: AuditSeverity.CRITICAL,
  
  [AuditEventType.TRUST_PEER_ADDED]: AuditSeverity.MEDIUM,
  [AuditEventType.TRUST_PEER_REMOVED]: AuditSeverity.MEDIUM,
  [AuditEventType.TRUST_PEER_UPDATED]: AuditSeverity.MEDIUM,
  [AuditEventType.TRUST_SYNC]: AuditSeverity.LOW,
  
  [AuditEventType.SECURITY_RATE_LIMIT]: AuditSeverity.MEDIUM,
  [AuditEventType.SECURITY_BRUTE_FORCE]: AuditSeverity.CRITICAL,
  [AuditEventType.SECURITY_INVALID_INPUT]: AuditSeverity.MEDIUM,
  [AuditEventType.SECURITY_TAMPERING]: AuditSeverity.CRITICAL,
  [AuditEventType.SECURITY_ANOMALY]: AuditSeverity.HIGH,
  
  [AuditEventType.SYSTEM_STARTUP]: AuditSeverity.LOW,
  [AuditEventType.SYSTEM_SHUTDOWN]: AuditSeverity.MEDIUM,
  [AuditEventType.SYSTEM_CONFIG_CHANGED]: AuditSeverity.HIGH,
  [AuditEventType.SYSTEM_BACKUP]: AuditSeverity.LOW,
  [AuditEventType.SYSTEM_RESTORE]: AuditSeverity.HIGH
};

// ============================================================================
// SECURITY AUDIT LOGGER
// ============================================================================

export class SecurityAuditLogger extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.enabled = options.enabled !== false;
    this.logPath = options.logPath || './logs/security-audit.log';
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10 MB
    this.maxFiles = options.maxFiles || 5;
    this.includeStackTrace = options.includeStackTrace ?? false;
    this.severityMap = { ...DEFAULT_SEVERITY_MAP, ...options.severityMap };
    
    // Buffer for batch writing
    this.buffer = [];
    this.bufferSize = options.bufferSize || 10;
    this.flushTimeout = options.flushTimeout || 5000; // 5 seconds
    
    // Initialize
    this._init();
  }
  
  async _init() {
    // Ensure log directory exists
    const dir = path.dirname(this.logPath);
    await fs.mkdir(dir, { recursive: true });
    
    // Start flush timer
    this._startFlushTimer();
  }
  
  _startFlushTimer() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
    }
    
    this._flushTimer = setTimeout(() => {
      this._flush().catch(console.error);
    }, this.flushTimeout);
  }
  
  async _flush() {
    if (this.buffer.length === 0) return;
    
    const lines = this.buffer.map(entry => JSON.stringify(entry));
    this.buffer = [];
    
    try {
      await fs.appendFile(this.logPath, lines.join('\n') + '\n');
      this.emit('flushed', { count: lines.length });
    } catch (error) {
      this.emit('error', { error, message: 'Failed to flush audit log' });
    }
  }
  
  /**
   * Log a security audit event.
   * @param {string} eventType - Event type from AuditEventType
   * @param {Object} details - Event details
   * @param {Object} context - Additional context (ip, userAgent, etc.)
   */
  async log(eventType, details = {}, context = {}) {
    if (!this.enabled) return;
    
    const entry = {
      timestamp: new Date().toISOString(),
      event: eventType,
      severity: this.severityMap[eventType] || AuditSeverity.MEDIUM,
      details: this._sanitize(details),
      context: {
        ip: context.ip || null,
        userAgent: context.userAgent || null,
        sessionId: context.sessionId || null,
        userId: context.userId || null
      },
      checksum: null // Will be computed after entry is complete
    };
    
    // Compute checksum for integrity
    entry.checksum = this._computeChecksum(entry);
    
    // Add to buffer
    this.buffer.push(entry);
    this.emit('logged', { eventType, details });
    
    // Flush if buffer is full
    if (this.buffer.length >= this.bufferSize) {
      await this._flush();
    }
    
    // Emit for real-time monitoring
    this.emit('event', entry);
    
    return entry;
  }
  
  /**
   * Log authentication success.
   */
  async logAuthSuccess(options = {}) {
    return this.log(AuditEventType.AUTH_LOGIN_SUCCESS, {
      userId: options.userId,
      method: options.method || 'password',
      mfa: options.mfa || false
    }, {
      ip: options.ip,
      userAgent: options.userAgent,
      sessionId: options.sessionId
    });
  }
  
  /**
   * Log authentication failure.
   */
  async logAuthFailure(options = {}) {
    return this.log(AuditEventType.AUTH_LOGIN_FAILED, {
      userId: options.userId || 'unknown',
      method: options.method || 'password',
      reason: options.reason || 'invalid_credentials',
      attemptNumber: options.attemptNumber
    }, {
      ip: options.ip,
      userAgent: options.userAgent
    });
  }
  
  /**
   * Log authorization denial.
   */
  async logAccessDenied(options = {}) {
    return this.log(AuditEventType.AUTH_ACCESS_DENIED, {
      resource: options.resource,
      action: options.action,
      userId: options.userId,
      reason: options.reason || 'insufficient_permissions'
    }, {
      ip: options.ip,
      userId: options.userId
    });
  }
  
  /**
   * Log security incident.
   */
  async logSecurityIncident(options = {}) {
    return this.log(AuditEventType.SECURITY_ANOMALY, {
      type: options.type,
      description: options.description,
      severity: options.severity || AuditSeverity.HIGH,
      evidence: options.evidence,
      source: options.source
    }, {
      ip: options.ip,
      userId: options.userId
    });
  }
  
  /**
   * Log rate limit triggered.
   */
  async logRateLimit(options = {}) {
    return this.log(AuditEventType.SECURITY_RATE_LIMIT, {
      endpoint: options.endpoint,
      limit: options.limit,
      windowMs: options.windowMs,
      currentCount: options.currentCount
    }, {
      ip: options.ip,
      userId: options.userId
    });
  }
  
  /**
   * Sanitize data for logging (remove sensitive info).
   */
  _sanitize(obj) {
    const sensitive = new Set([
      'password', 'secret', 'token', 'key', 'private',
      'accessToken', 'refreshToken', 'apiKey', 'mnemonic'
    ]);
    
    const sanitizeValue = (value) => {
      if (typeof value === 'string') {
        // Truncate long strings
        return value.length > 100 ? value.slice(0, 100) + '...' : value;
      }
      return value;
    };
    
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (sensitive.some(s => lowerKey.includes(s))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this._sanitize(value);
      } else {
        result[key] = sanitizeValue(value);
      }
    }
    return result;
  }
  
  /**
   * Compute checksum for entry integrity.
   */
  _computeChecksum(entry) {
    const data = JSON.stringify({
      timestamp: entry.timestamp,
      event: entry.event,
      details: entry.details
    });
    return createHash('sha256').update(data).digest('hex').slice(0, 16);
  }
  
  /**
   * Verify log integrity.
   */
  async verifyLogIntegrity() {
    try {
      const content = await fs.readFile(this.logPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      const results = {
        total: lines.length,
        valid: 0,
        invalid: 0,
        errors: []
      };
      
      for (let i = 0; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]);
          const expectedChecksum = this._computeChecksum(entry);
          
          if (entry.checksum === expectedChecksum) {
            results.valid++;
          } else {
            results.invalid++;
            results.errors.push({ line: i + 1, error: 'Checksum mismatch' });
          }
        } catch (error) {
          results.invalid++;
          results.errors.push({ line: i + 1, error: error.message });
        }
      }
      
      return results;
    } catch (error) {
      return { error: error.message };
    }
  }
  
  /**
   * Rotate log files.
   */
  async rotate() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = `${this.logPath}.${timestamp}`;
    
    try {
      await fs.rename(this.logPath, rotatedPath);
      this.emit('rotated', { path: rotatedPath });
      return { success: true, path: rotatedPath };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: true }; // No file to rotate
      }
      throw error;
    }
  }
  
  /**
   * Get audit statistics.
   */
  async getStats(timeRange = {}) {
    try {
      const content = await fs.readFile(this.logPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      const stats = {
        total: lines.length,
        byType: {},
        bySeverity: {},
        timeRange: {
          start: null,
          end: null
        }
      };
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          
          // Count by type
          stats.byType[entry.event] = (stats.byType[entry.event] || 0) + 1;
          
          // Count by severity
          stats.bySeverity[entry.severity] = (stats.bySeverity[entry.severity] || 0) + 1;
          
          // Track time range
          if (!stats.timeRange.start || entry.timestamp < stats.timeRange.start) {
            stats.timeRange.start = entry.timestamp;
          }
          if (!stats.timeRange.end || entry.timestamp > stats.timeRange.end) {
            stats.timeRange.end = entry.timestamp;
          }
        } catch {
          // Skip malformed entries
        }
      }
      
      return stats;
    } catch (error) {
      return { error: error.message };
    }
  }
  
  /**
   * Search audit logs.
   */
  async search(query = {}) {
    try {
      const content = await fs.readFile(this.logPath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const results = [];
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          
          // Apply filters
          if (query.eventType && entry.event !== query.eventType) continue;
          if (query.severity && entry.severity !== query.severity) continue;
          if (query.userId && entry.context.userId !== query.userId) continue;
          if (query.ip && entry.context.ip !== query.ip) continue;
          
          results.push(entry);
        } catch {
          // Skip malformed entries
        }
      }
      
      return results;
    } catch (error) {
      return { error: error.message };
    }
  }
  
  /**
   * Close the logger and flush remaining entries.
   */
  async close() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
    }
    await this._flush();
    this.emit('closed');
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalAuditLogger = null;

export function getSecurityAuditLogger(options = {}) {
  if (!globalAuditLogger) {
    globalAuditLogger = new SecurityAuditLogger(options);
  }
  return globalAuditLogger;
}

export function createSecurityAuditLogger(options = {}) {
  return new SecurityAuditLogger(options);
}
