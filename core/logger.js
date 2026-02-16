// Module: Structured Logger
// Description: Centralized logging with levels, formatting, and output targets.
//              Supports redaction of sensitive data and structured output.
// File: core/logger.js

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';

// ============================================================================
// LOG LEVELS
// ============================================================================

export const LogLevel = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5
};

const LEVEL_NAMES = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

// ============================================================================
// SENSITIVE DATA PATTERNS
// ============================================================================

const SENSITIVE_PATTERNS = [
  /seed/i,
  /password/i,
  /secret/i,
  /key/i,
  /token/i,
  /private/i,
  /mnemonic/i,
  /passphrase/i
];

const SENSITIVE_KEYS = new Set([
  'seed', 'password', 'secret', 'key', 'token', 'privateKey', 'publicKey',
  'mnemonic', 'passphrase', 'accessToken', 'refreshToken', 'apiKey',
  'masterKey', 'encryptionKey', 'private', 'seedPhrase'
]);

// ============================================================================
// LOGGER
// ============================================================================

export class Logger extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.module = options.module || 'core';
    this.level = options.level ?? LogLevel.INFO;
    this.format = options.format || 'json'; // 'json' or 'pretty'
    
    // Output targets
    this.targets = [];
    
    if (options.console !== false) {
      this.targets.push(this._consoleTarget.bind(this));
    }
    
    if (options.file) {
      this._setupFileTarget(options.file);
    }
    
    // Redaction settings
    this.redactEnabled = options.redact !== false;
    this.redactPlaceholder = options.redactPlaceholder || '[REDACTED]';
    
    // Context
    this.defaultContext = options.context || {};
  }
  
  // ==========================================================================
  // LOGGING METHODS
  // ==========================================================================
  
  trace(message, context = {}) {
    this._log(LogLevel.TRACE, message, context);
  }
  
  debug(message, context = {}) {
    this._log(LogLevel.DEBUG, message, context);
  }
  
  info(message, context = {}) {
    this._log(LogLevel.INFO, message, context);
  }
  
  warn(message, context = {}) {
    this._log(LogLevel.WARN, message, context);
  }
  
  error(message, context = {}) {
    if (context instanceof Error) {
      context = { error: context.message, stack: context.stack };
    }
    this._log(LogLevel.ERROR, message, context);
  }
  
  fatal(message, context = {}) {
    if (context instanceof Error) {
      context = { error: context.message, stack: context.stack };
    }
    this._log(LogLevel.FATAL, message, context);
  }
  
  // ==========================================================================
  // CHILD LOGGERS
  // ==========================================================================
  
  child(module, context = {}) {
    return new Logger({
      module: `${this.module}:${module}`,
      level: this.level,
      format: this.format,
      console: false, // Don't add another console target
      redact: this.redactEnabled,
      context: { ...this.defaultContext, ...context }
    });
  }
  
  // ==========================================================================
  // INTERNAL
  // ==========================================================================
  
  _log(level, message, context) {
    if (level < this.level) return;
    
    const entry = {
      timestamp: new Date().toISOString(),
      level: LEVEL_NAMES[level],
      module: this.module,
      message,
      ...this.defaultContext,
      ...this._redact(context)
    };
    
    for (const target of this.targets) {
      try {
        target(entry);
      } catch (error) {
        // Fallback to console if target fails
        console.error('Logger target error:', error);
      }
    }
    
    this.emit('log', entry);
  }
  
  _consoleTarget(entry) {
    if (this.format === 'pretty') {
      const ts = entry.timestamp.split('T')[1].slice(0, 12);
      const level = entry.level.padEnd(5);
      const module = `[${entry.module}]`.padEnd(20);
      
      let output = `${ts} ${level} ${module} ${entry.message}`;
      
      const contextKeys = Object.keys(entry).filter(
        k => !['timestamp', 'level', 'module', 'message'].includes(k)
      );
      
      if (contextKeys.length > 0) {
        const contextStr = contextKeys.map(k => `${k}=${JSON.stringify(entry[k])}`).join(' ');
        output += ` ${contextStr}`;
      }
      
      const color = this._getColor(entry.level);
      console.log(color(output));
    } else {
      console.log(JSON.stringify(entry));
    }
  }
  
  _getColor(level) {
    const colors = {
      TRACE: '\x1b[90m',  // Gray
      DEBUG: '\x1b[36m',  // Cyan
      INFO: '\x1b[32m',   // Green
      WARN: '\x1b[33m',   // Yellow
      ERROR: '\x1b[31m',  // Red
      FATAL: '\x1b[35m'   // Magenta
    };
    const reset = '\x1b[0m';
    
    return (str) => `${colors[level] || ''}${str}${reset}`;
  }
  
  async _setupFileTarget(filePath) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    
    this.targets.push(async (entry) => {
      await fs.appendFile(filePath, JSON.stringify(entry) + '\n');
    });
  }
  
  // ==========================================================================
  // REDACTION
  // ==========================================================================
  
  _redact(obj, depth = 0) {
    if (depth > 10) return obj; // Prevent infinite recursion
    
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (typeof obj !== 'object') {
      return obj;
    }
    
    if (Buffer.isBuffer(obj)) {
      return `<Buffer:${obj.length}b>`;
    }
    
    if (obj instanceof Error) {
      return {
        name: obj.name,
        message: obj.message,
        stack: obj.stack
      };
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this._redact(item, depth + 1));
    }
    
    const result = {};
    
    for (const [key, value] of Object.entries(obj)) {
      if (this._isSensitive(key)) {
        result[key] = this.redactPlaceholder;
      } else if (typeof value === 'object' && value !== null) {
        result[key] = this._redact(value, depth + 1);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }
  
  _isSensitive(key) {
    if (!this.redactEnabled) return false;
    
    const lowerKey = key.toLowerCase();
    
    // Check exact matches
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(lowerKey)) {
      return true;
    }
    
    // Check patterns
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(key)) {
        return true;
      }
    }
    
    return false;
  }
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    
    this.name = 'AppError';
    this.code = options.code || 'UNKNOWN';
    this.statusCode = options.statusCode || 500;
    this.details = options.details || {};
    this.cause = options.cause || null;
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
  
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      stack: this.stack
    };
  }
}

export class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      details
    });
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, {
      code: 'AUTHENTICATION_ERROR',
      statusCode: 401
    });
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Permission denied') {
    super(message, {
      code: 'AUTHORIZATION_ERROR',
      statusCode: 403
    });
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, {
      code: 'NOT_FOUND',
      statusCode: 404
    });
    this.name = 'NotFoundError';
  }
}

export class CryptoError extends AppError {
  constructor(message, details = {}) {
    super(message, {
      code: 'CRYPTO_ERROR',
      statusCode: 500,
      details
    });
    this.name = 'CryptoError';
  }
}

// ============================================================================
// ERROR HANDLER
// ============================================================================

export class ErrorHandler {
  constructor(options = {}) {
    this.logger = options.logger || new Logger({ module: 'error-handler' });
    this.includeStackTrace = options.includeStackTrace ?? (process.env.NODE_ENV !== 'production');
  }
  
  /**
   * Handle an error and return a safe response object
   */
  handle(error, context = {}) {
    // Log the error
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        this.logger.error(error.message, { ...context, code: error.code });
      } else {
        this.logger.warn(error.message, { ...context, code: error.code });
      }
    } else {
      this.logger.error('Unhandled error', {
        ...context,
        error: error.message,
        stack: error.stack
      });
    }
    
    // Build response
    const response = {
      success: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'An unexpected error occurred'
      }
    };
    
    if (error instanceof AppError) {
      response.error.code = error.code;
      response.statusCode = error.statusCode;
      
      if (Object.keys(error.details).length > 0) {
        response.error.details = error.details;
      }
    } else {
      response.statusCode = 500;
    }
    
    if (this.includeStackTrace && error.stack) {
      response.error.stack = error.stack;
    }
    
    return response;
  }
  
  /**
   * Express-like error middleware
   */
  middleware() {
    return (err, req, res, next) => {
      const response = this.handle(err, {
        method: req.method,
        url: req.url,
        ip: req.ip
      });
      
      res.status(response.statusCode || 500).json(response);
    };
  }
}

// ============================================================================
// GLOBAL LOGGER INSTANCE
// ============================================================================

let globalLogger = null;

export function getLogger(options = {}) {
  if (!globalLogger) {
    globalLogger = new Logger(options);
  }
  return globalLogger;
}

export function createLogger(options = {}) {
  return new Logger(options);
}
