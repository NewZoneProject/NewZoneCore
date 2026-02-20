// Module: Master Key Manager
// Description: Loads, validates and derives the master key used for all
//              cryptographic operations in NewZoneCore.
//              Now with per-user unique salt for scrypt.
// File: core/crypto/master.js

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const ENV = path.join(ROOT, 'env');
const MASTER_FILE = path.join(ENV, 'master.key');
const SALT_FILE = path.join(ENV, 'master.salt');

// Scrypt parameters (N, r, p)
// Note: Using conservative values for compatibility
// For production, consider increasing N to 2^17 or higher
const SCRYPT_N = 2**14;  // CPU/memory cost parameter (16384)
const SCRYPT_R = 8;       // Block size
const SCRYPT_P = 1;       // Parallelization parameter
const KEY_LENGTH = 32;    // Output key length in bytes
const SALT_LENGTH = 32;   // Salt length in bytes
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2; // Double the minimum

// ============================================================================
// SALT MANAGEMENT
// ============================================================================

/**
 * Generate a cryptographically secure random salt.
 * @returns {Uint8Array} 32-byte salt
 */
export function generateSalt() {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * Load salt from disk or generate a new one.
 * @param {boolean} createIfMissing - Generate new salt if file doesn't exist
 * @returns {Promise<Buffer|null>} 32-byte salt or null
 */
export async function loadOrCreateSalt(createIfMissing = true) {
  try {
    const saltData = await fs.readFile(SALT_FILE);
    if (saltData.length !== SALT_LENGTH) {
      throw new Error(`Invalid salt length: expected ${SALT_LENGTH}, got ${saltData.length}`);
    }
    return saltData;
  } catch (error) {
    if (error.code === 'ENOENT' && createIfMissing) {
      // Generate and save new salt
      const newSalt = generateSalt();
      await fs.mkdir(ENV, { recursive: true });
      await fs.writeFile(SALT_FILE, newSalt);
      console.log('[crypto] Generated new master salt');
      return newSalt;
    }
    return null;
  }
}

/**
 * Save salt to disk.
 * @param {Buffer|Uint8Array} salt - 32-byte salt
 */
export async function saveSalt(salt) {
  if (!Buffer.isBuffer(salt) && !(salt instanceof Uint8Array)) {
    throw new Error('Salt must be a Buffer or Uint8Array');
  }
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`Salt must be ${SALT_LENGTH} bytes`);
  }
  await fs.mkdir(ENV, { recursive: true });
  await fs.writeFile(SALT_FILE, salt);
}

// ============================================================================
// MASTER KEY DERIVATION
// ============================================================================

/**
 * Derive master key from password using scrypt with unique salt.
 *
 * SECURITY: Uses per-user unique salt to prevent rainbow table attacks.
 * This significantly increases the cost of brute-force attacks.
 *
 * @param {string} password - User password
 * @param {Buffer|Uint8Array} salt - 32-byte salt (required for security)
 * @returns {Promise<{key: Buffer, salt: Buffer}>}
 */
export async function deriveMasterKey(password, salt) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  if (!salt) {
    throw new Error('Salt is required for secure key derivation');
  }

  if (!Buffer.isBuffer(salt) && !(salt instanceof Uint8Array)) {
    throw new Error('Salt must be a Buffer or Uint8Array');
  }

  if (salt.length !== SALT_LENGTH) {
    throw new Error(`Salt must be ${SALT_LENGTH} bytes, got ${salt.length}`);
  }

  // Derive key using scrypt with configurable parameters
  const key = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  });

  return {
    key: Buffer.from(key),
    salt: Buffer.from(salt)
  };
}

// ============================================================================
// MASTER KEY STORAGE
// ============================================================================

/**
 * Load master key from disk.
 * @returns {Promise<Buffer|null>} 32-byte key or null if not found
 */
export async function loadMasterKey() {
  try {
    const data = await fs.readFile(MASTER_FILE);
    if (data.length !== KEY_LENGTH) {
      throw new Error(`Invalid master.key length: expected ${KEY_LENGTH}, got ${data.length}`);
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Save master key to disk with secure file permissions.
 * @param {Buffer|Uint8Array} keyBytes - 32-byte key
 */
export async function saveMasterKey(keyBytes) {
  if (!Buffer.isBuffer(keyBytes) && !(keyBytes instanceof Uint8Array)) {
    throw new Error('Master key must be a Buffer or Uint8Array');
  }
  if (keyBytes.length !== KEY_LENGTH) {
    throw new Error(`Master key must be ${KEY_LENGTH} bytes`);
  }
  
  await fs.mkdir(ENV, { recursive: true });
  await fs.writeFile(MASTER_FILE, keyBytes, { mode: 0o600 }); // Owner read/write only
  
  console.log('[crypto] Master key saved with secure permissions');
}

/**
 * Securely wipe key from memory.
 * Overwrites the buffer with zeros.
 * @param {Buffer|Uint8Array} keyBuffer
 */
export function wipeKey(keyBuffer) {
  if (Buffer.isBuffer(keyBuffer)) {
    keyBuffer.fill(0);
  } else if (keyBuffer instanceof Uint8Array) {
    keyBuffer.fill(0);
  }
}

// ============================================================================
// PASSWORD VERIFICATION
// ============================================================================

/**
 * Verify password against stored master key.
 * SECURITY: Requires salt to be provided - no fallback to insecure methods.
 * @param {string} password - User password
 * @param {Buffer} salt - Stored salt (required)
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, salt) {
  if (!salt) {
    throw new Error('Salt is required for password verification');
  }

  const storedKey = await loadMasterKey();
  if (!storedKey) return false;

  const { key: derivedKey } = await deriveMasterKey(password, salt);

  try {
    return crypto.timingSafeEqual(storedKey, derivedKey);
  } finally {
    // Wipe derived key from memory
    wipeKey(derivedKey);
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Initialize master key (used by core.js).
 * SECURITY: Throws error in production mode if no master key exists.
 * @returns {Promise<Buffer>} 32-byte master key
 * @throws {Error} If no master key exists in production mode
 */
export async function initMasterKey() {
  // Try to load existing key
  const existingKey = await loadMasterKey();
  if (existingKey) {
    console.log('[crypto] Master key loaded from disk');
    return existingKey;
  }

  // Check if we're in production mode
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    // SECURITY: In production, we require a master key to be set
    const error = new Error(
      'No master key found. In production mode, the master key must be pre-configured. ' +
      'Please run bootstrap first or set NZCORE_MASTER_KEY environment variable.'
    );
    error.code = 'MASTER_KEY_MISSING';
    throw error;
  }

  // Development mode: generate a temporary key for testing
  // WARNING: This key will not persist across restarts
  console.warn('[crypto] WARNING: No master key found. Generated temporary key for development.');
  console.warn('[crypto] WARNING: Run bootstrap to create a persistent master key.');
  
  return crypto.randomBytes(KEY_LENGTH);
}

/**
 * Check if master key and salt exist.
 * @returns {Promise<{hasKey: boolean, hasSalt: boolean}>}
 */
export async function checkMasterKeyExists() {
  let hasKey = false;
  let hasSalt = false;

  try {
    await fs.access(MASTER_FILE);
    hasKey = true;
  } catch {}

  try {
    await fs.access(SALT_FILE);
    hasSalt = true;
  } catch {}

  return { hasKey, hasSalt };
}
