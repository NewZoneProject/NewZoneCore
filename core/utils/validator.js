// Module: Input Validation
// Description: Centralized input validation for NewZoneCore with strict
//              whitelist-based validation for security.
// File: core/utils/validator.js

import { createHash } from 'crypto';

// ============================================================================
// VALIDATION CONSTANTS
// ============================================================================

const MAX_PEER_ID_LENGTH = 256;
const MAX_NODE_ID_LENGTH = 256;
const MAX_MESSAGE_SIZE = 64 * 1024; // 64 KB
const MAX_JSON_PAYLOAD_SIZE = 100 * 1024; // 100 KB
const ED25519_PUBLIC_KEY_SIZE = 32;
const X25519_PUBLIC_KEY_SIZE = 32;

// Whitelist for peer ID: alphanumeric, dash, underscore
const PEER_ID_REGEX = /^[a-zA-Z0-9_-]{1,256}$/;

// Whitelist for node ID: alphanumeric, dash, underscore, colon
const NODE_ID_REGEX = /^[a-zA-Z0-9_:-]{1,256}$/;

// Base64 regex (standard and URL-safe)
const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL_REGEX = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2}==|[A-Za-z0-9_-]{3}=)?$/;

// ============================================================================
// VALIDATION ERRORS
// ============================================================================

export class ValidationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ValidationError';
    this.code = options.code || 'VALIDATION_ERROR';
    this.field = options.field || null;
    this.value = options.value || null;
  }

  toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      field: this.field,
      value: this.value
    };
  }
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate peer ID format
 * @param {string} peerId - Peer ID to validate
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validatePeerId(peerId) {
  if (peerId === undefined || peerId === null) {
    throw new ValidationError('Peer ID is required', { code: 'PEER_ID_REQUIRED', field: 'peerId' });
  }

  if (typeof peerId !== 'string') {
    throw new ValidationError('Peer ID must be a string', { code: 'PEER_ID_NOT_STRING', field: 'peerId', value: typeof peerId });
  }

  if (peerId.length === 0) {
    throw new ValidationError('Peer ID cannot be empty', { code: 'PEER_ID_EMPTY', field: 'peerId' });
  }

  if (peerId.length > MAX_PEER_ID_LENGTH) {
    throw new ValidationError(
      `Peer ID too long (max ${MAX_PEER_ID_LENGTH} characters)`,
      { code: 'PEER_ID_TOO_LONG', field: 'peerId', value: peerId.length }
    );
  }

  if (!PEER_ID_REGEX.test(peerId)) {
    throw new ValidationError(
      'Peer ID contains invalid characters (only alphanumeric, dash, underscore allowed)',
      { code: 'PEER_ID_INVALID_CHARS', field: 'peerId', value: peerId }
    );
  }

  return true;
}

/**
 * Validate node ID format
 * @param {string} nodeId - Node ID to validate
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validateNodeId(nodeId) {
  if (nodeId === undefined || nodeId === null) {
    throw new ValidationError('Node ID is required', { code: 'NODE_ID_REQUIRED', field: 'nodeId' });
  }

  if (typeof nodeId !== 'string') {
    throw new ValidationError('Node ID must be a string', { code: 'NODE_ID_NOT_STRING', field: 'nodeId', value: typeof nodeId });
  }

  if (nodeId.length === 0) {
    throw new ValidationError('Node ID cannot be empty', { code: 'NODE_ID_EMPTY', field: 'nodeId' });
  }

  if (nodeId.length > MAX_NODE_ID_LENGTH) {
    throw new ValidationError(
      `Node ID too long (max ${MAX_NODE_ID_LENGTH} characters)`,
      { code: 'NODE_ID_TOO_LONG', field: 'nodeId', value: nodeId.length }
    );
  }

  if (!NODE_ID_REGEX.test(nodeId)) {
    throw new ValidationError(
      'Node ID contains invalid characters',
      { code: 'NODE_ID_INVALID_CHARS', field: 'nodeId', value: nodeId }
    );
  }

  return true;
}

/**
 * Validate Ed25519 public key (base64 encoded, 32 bytes)
 * @param {string} publicKey - Base64 encoded public key
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validateEd25519PublicKey(publicKey) {
  if (publicKey === undefined || publicKey === null) {
    throw new ValidationError('Public key is required', { code: 'PUBLIC_KEY_REQUIRED', field: 'publicKey' });
  }

  if (typeof publicKey !== 'string') {
    throw new ValidationError('Public key must be a string', { code: 'PUBLIC_KEY_NOT_STRING', field: 'publicKey', value: typeof publicKey });
  }

  // Validate base64 format
  if (!BASE64_REGEX.test(publicKey)) {
    throw new ValidationError(
      'Public key is not valid base64',
      { code: 'PUBLIC_KEY_INVALID_BASE64', field: 'publicKey', value: publicKey }
    );
  }

  // Decode and check length
  try {
    const keyBytes = Buffer.from(publicKey, 'base64');
    if (keyBytes.length !== ED25519_PUBLIC_KEY_SIZE) {
      throw new ValidationError(
        `Public key must be ${ED25519_PUBLIC_KEY_SIZE} bytes (Ed25519)`,
        { code: 'PUBLIC_KEY_WRONG_LENGTH', field: 'publicKey', value: keyBytes.length }
      );
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(
      'Failed to decode public key',
      { code: 'PUBLIC_KEY_DECODE_FAILED', field: 'publicKey', value: publicKey }
    );
  }

  return true;
}

/**
 * Validate X25519 public key (base64 encoded, 32 bytes)
 * @param {string} publicKey - Base64 encoded public key
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validateX25519PublicKey(publicKey) {
  // Same validation as Ed25519 (both are 32 bytes)
  return validateEd25519PublicKey(publicKey);
}

/**
 * Validate base64 encoded data
 * @param {string} data - Base64 encoded data
 * @param {Object} options - Validation options
 * @param {number} options.expectedLength - Expected decoded length (optional)
 * @param {number} options.maxLength - Maximum decoded length (optional)
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validateBase64(data, options = {}) {
  if (data === undefined || data === null) {
    throw new ValidationError('Base64 data is required', { code: 'BASE64_REQUIRED', field: 'data' });
  }

  if (typeof data !== 'string') {
    throw new ValidationError('Data must be a string', { code: 'BASE64_NOT_STRING', field: 'data', value: typeof data });
  }

  if (!BASE64_REGEX.test(data) && !BASE64URL_REGEX.test(data)) {
    throw new ValidationError(
      'Data is not valid base64',
      { code: 'BASE64_INVALID_FORMAT', field: 'data', value: data }
    );
  }

  if (options.expectedLength || options.maxLength) {
    try {
      const decoded = Buffer.from(data, 'base64');

      if (options.expectedLength && decoded.length !== options.expectedLength) {
        throw new ValidationError(
          `Data length must be ${options.expectedLength} bytes`,
          { code: 'BASE64_WRONG_LENGTH', field: 'data', value: decoded.length }
        );
      }

      if (options.maxLength && decoded.length > options.maxLength) {
        throw new ValidationError(
          `Data too large (max ${options.maxLength} bytes)`,
          { code: 'BASE64_TOO_LARGE', field: 'data', value: decoded.length }
        );
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        'Failed to decode base64 data',
        { code: 'BASE64_DECODE_FAILED', field: 'data', value: data }
      );
    }
  }

  return true;
}

/**
 * Validate JSON payload size
 * @param {string|Object} payload - JSON payload (string or object)
 * @param {number} maxSize - Maximum size in bytes
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validateJsonPayload(payload, maxSize = MAX_JSON_PAYLOAD_SIZE) {
  let size;

  if (typeof payload === 'string') {
    size = Buffer.byteLength(payload, 'utf8');
  } else if (typeof payload === 'object') {
    const str = JSON.stringify(payload);
    size = Buffer.byteLength(str, 'utf8');
  } else {
    throw new ValidationError(
      'Payload must be a string or object',
      { code: 'PAYLOAD_INVALID_TYPE', field: 'payload', value: typeof payload }
    );
  }

  if (size > maxSize) {
    throw new ValidationError(
      `Payload too large (${size} bytes, max ${maxSize})`,
      { code: 'PAYLOAD_TOO_LARGE', field: 'payload', value: size }
    );
  }

  return true;
}

/**
 * Validate message size
 * @param {string|Buffer} message - Message to validate
 * @param {number} maxSize - Maximum size in bytes
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validateMessageSize(message, maxSize = MAX_MESSAGE_SIZE) {
  let size;

  if (Buffer.isBuffer(message)) {
    size = message.length;
  } else if (typeof message === 'string') {
    size = Buffer.byteLength(message, 'utf8');
  } else {
    throw new ValidationError(
      'Message must be a string or Buffer',
      { code: 'MESSAGE_INVALID_TYPE', field: 'message', value: typeof message }
    );
  }

  if (size > maxSize) {
    throw new ValidationError(
      `Message too large (${size} bytes, max ${maxSize})`,
      { code: 'MESSAGE_TOO_LARGE', field: 'message', value: size }
    );
  }

  return true;
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @param {Object} options - Validation options
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validatePassword(password, options = {}) {
  const {
    minLength = 8,
    maxLength = 128,
    requireUppercase = true,
    requireLowercase = true,
    requireNumbers = true,
    requireSymbols = false
  } = options;

  if (!password || typeof password !== 'string') {
    throw new ValidationError('Password is required', { code: 'PASSWORD_REQUIRED', field: 'password' });
  }

  if (password.length < minLength) {
    throw new ValidationError(
      `Password must be at least ${minLength} characters`,
      { code: 'PASSWORD_TOO_SHORT', field: 'password', value: password.length }
    );
  }

  if (password.length > maxLength) {
    throw new ValidationError(
      `Password must be at most ${maxLength} characters`,
      { code: 'PASSWORD_TOO_LONG', field: 'password', value: password.length }
    );
  }

  if (requireUppercase && !/[A-Z]/.test(password)) {
    throw new ValidationError(
      'Password must contain at least one uppercase letter',
      { code: 'PASSWORD_NO_UPPERCASE', field: 'password' }
    );
  }

  if (requireLowercase && !/[a-z]/.test(password)) {
    throw new ValidationError(
      'Password must contain at least one lowercase letter',
      { code: 'PASSWORD_NO_LOWERCASE', field: 'password' }
    );
  }

  if (requireNumbers && !/[0-9]/.test(password)) {
    throw new ValidationError(
      'Password must contain at least one number',
      { code: 'PASSWORD_NO_NUMBERS', field: 'password' }
    );
  }

  if (requireSymbols && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    throw new ValidationError(
      'Password must contain at least one special character',
      { code: 'PASSWORD_NO_SYMBOLS', field: 'password' }
    );
  }

  return true;
}

/**
 * Validate trust level
 * @param {number} trustLevel - Trust level to validate
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validateTrustLevel(trustLevel) {
  const validLevels = [0, 1, 2, 3, 4]; // UNKNOWN, LOW, MEDIUM, HIGH, ULTIMATE

  if (trustLevel === undefined || trustLevel === null) {
    throw new ValidationError('Trust level is required', { code: 'TRUST_LEVEL_REQUIRED', field: 'trustLevel' });
  }

  if (!Number.isInteger(trustLevel)) {
    throw new ValidationError('Trust level must be an integer', { code: 'TRUST_LEVEL_NOT_INTEGER', field: 'trustLevel', value: trustLevel });
  }

  if (!validLevels.includes(trustLevel)) {
    throw new ValidationError(
      `Invalid trust level (must be one of: ${validLevels.join(', ')})`,
      { code: 'TRUST_LEVEL_INVALID', field: 'trustLevel', value: trustLevel }
    );
  }

  return true;
}

/**
 * Sanitize string input (remove control characters, trim)
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string
 */
export function sanitizeString(str) {
  if (typeof str !== 'string') {
    return str;
  }

  // Remove control characters except newline and tab
  let sanitized = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Trim whitespace
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Hash data for comparison (constant-time safe)
 * @param {string|Buffer} data - Data to hash
 * @returns {string} SHA-256 hash (hex)
 */
export function hashForComparison(data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validate file path (prevent directory traversal)
 * @param {string} filePath - File path to validate
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validateFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new ValidationError('File path is required', { code: 'FILE_PATH_REQUIRED', field: 'filePath' });
  }

  // Check for directory traversal attempts
  if (filePath.includes('..') || filePath.startsWith('/') || filePath.includes('\\')) {
    throw new ValidationError(
      'Invalid file path (directory traversal not allowed)',
      { code: 'FILE_PATH_INVALID', field: 'filePath', value: filePath }
    );
  }

  // Check for null bytes
  if (filePath.includes('\0')) {
    throw new ValidationError(
      'Invalid file path (null byte detected)',
      { code: 'FILE_PATH_NULL_BYTE', field: 'filePath', value: filePath }
    );
  }

  return true;
}

/**
 * Validate IP address format
 * @param {string} ip - IP address to validate
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validateIpAddress(ip) {
  if (!ip || typeof ip !== 'string') {
    throw new ValidationError('IP address is required', { code: 'IP_ADDRESS_REQUIRED', field: 'ip' });
  }

  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipv4Match = ip.match(ipv4Pattern);

  if (ipv4Match) {
    const valid = ipv4Match.slice(1).every(octet => parseInt(octet, 10) <= 255);
    if (!valid) {
      throw new ValidationError(
        'Invalid IPv4 address',
        { code: 'IP_ADDRESS_INVALID', field: 'ip', value: ip }
      );
    }
    return true;
  }

  // IPv6 pattern (simplified)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  if (ipv6Pattern.test(ip) || ip === '::1' || ip === '::') {
    return true;
  }

  throw new ValidationError(
    'Invalid IP address format',
    { code: 'IP_ADDRESS_INVALID', field: 'ip', value: ip }
  );
}

// ============================================================================
// VALIDATION UTILITIES
// ============================================================================

/**
 * Validate object properties against schema
 * @param {Object} obj - Object to validate
 * @param {Object} schema - Validation schema
 * @returns {boolean} True if valid
 * @throws {ValidationError} If invalid
 */
export function validateObject(obj, schema) {
  if (!obj || typeof obj !== 'object') {
    throw new ValidationError('Input must be an object', { code: 'INPUT_NOT_OBJECT' });
  }

  for (const [field, rules] of Object.entries(schema)) {
    const value = obj[field];

    if (rules.required && (value === undefined || value === null)) {
      throw new ValidationError(
        `Field '${field}' is required`,
        { code: 'FIELD_REQUIRED', field }
      );
    }

    if (value !== undefined && value !== null) {
      if (rules.type && typeof value !== rules.type) {
        throw new ValidationError(
          `Field '${field}' must be of type ${rules.type}`,
          { code: 'FIELD_WRONG_TYPE', field, value: typeof value }
        );
      }

      if (rules.minLength && typeof value === 'string' && value.length < rules.minLength) {
        throw new ValidationError(
          `Field '${field}' must be at least ${rules.minLength} characters`,
          { code: 'FIELD_TOO_SHORT', field, value: value.length }
        );
      }

      if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
        throw new ValidationError(
          `Field '${field}' must be at most ${rules.maxLength} characters`,
          { code: 'FIELD_TOO_LONG', field, value: value.length }
        );
      }

      if (rules.min !== undefined && typeof value === 'number' && value < rules.min) {
        throw new ValidationError(
          `Field '${field}' must be at least ${rules.min}`,
          { code: 'FIELD_TOO_SMALL', field, value }
        );
      }

      if (rules.max !== undefined && typeof value === 'number' && value > rules.max) {
        throw new ValidationError(
          `Field '${field}' must be at most ${rules.max}`,
          { code: 'FIELD_TOO_LARGE', field, value }
        );
      }

      if (rules.pattern && typeof value === 'string' && !rules.pattern.test(value)) {
        throw new ValidationError(
          `Field '${field}' has invalid format`,
          { code: 'FIELD_INVALID_FORMAT', field, value }
        );
      }

      if (rules.enum && !rules.enum.includes(value)) {
        throw new ValidationError(
          `Field '${field}' must be one of: ${rules.enum.join(', ')}`,
          { code: 'FIELD_INVALID_ENUM', field, value }
        );
      }

      if (rules.validate && typeof rules.validate === 'function') {
        rules.validate(value, field);
      }
    }
  }

  return true;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  ValidationError,
  validatePeerId,
  validateNodeId,
  validateEd25519PublicKey,
  validateX25519PublicKey,
  validateBase64,
  validateJsonPayload,
  validateMessageSize,
  validatePassword,
  validateTrustLevel,
  sanitizeString,
  hashForComparison,
  validateFilePath,
  validateIpAddress,
  validateObject,
  MAX_PEER_ID_LENGTH,
  MAX_NODE_ID_LENGTH,
  MAX_MESSAGE_SIZE,
  MAX_JSON_PAYLOAD_SIZE
};
