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
 * CRITICAL FIX: Uses per-user unique salt instead of hardcoded constant.
 * This prevents rainbow table attacks and significantly increases
 * the cost of brute-force attacks.
 * 
 * @param {string} password - User password
 * @param {Buffer|Uint8Array|null} salt - 32-byte salt (will be generated if null)
 * @returns {Promise<{key: Buffer, salt: Buffer}>}
 */
export async function deriveMasterKey(password, salt = null) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  
  // Use provided salt or generate new one
  const actualSalt = salt || generateSalt();
  
  if (actualSalt.length !== SALT_LENGTH) {
    throw new Error(`Salt must be ${SALT_LENGTH} bytes, got ${actualSalt.length}`);
  }
  
  // Derive key using scrypt with configurable parameters
  const key = crypto.scryptSync(password, actualSalt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM
  });
  
  return {
    key: Buffer.from(key),
    salt: Buffer.from(actualSalt)
  };
}

/**
 * Legacy function for backward compatibility.
 * WARNING: This uses a deterministic salt and should NOT be used for new code.
 * @deprecated Use deriveMasterKey() with unique salt instead.
 */
export function deriveMasterKeyLegacy(password) {
  // 32-byte key using scrypt with deterministic salt
  // Kept only for migration purposes
  return crypto.scryptSync(password, 'nzcore-master-salt', 32);
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
 * @param {string} password - User password
 * @param {Buffer} salt - Stored salt
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, salt = null) {
  const storedKey = await loadMasterKey();
  if (!storedKey) return false;
  
  // Load salt if not provided
  const actualSalt = salt || await loadOrCreateSalt(false);
  if (!actualSalt) {
    // Fallback to legacy verification for migration
    const derivedLegacy = deriveMasterKeyLegacy(password);
    return crypto.timingSafeEqual(storedKey, derivedLegacy);
  }
  
  const { key: derivedKey } = await deriveMasterKey(password, actualSalt);
  
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
 * Creates new key if none exists.
 * @returns {Promise<Buffer>} 32-byte master key
 */
export async function initMasterKey() {
  // Try to load existing key
  const existingKey = await loadMasterKey();
  if (existingKey) {
    console.log('[crypto] Master key loaded from disk');
    return existingKey;
  }
  
  // No master.key exists - return placeholder for dev mode
  // Bootstrap will create a real one with user password
  console.log('[crypto] No master key found, returning placeholder');
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

/**
 * Migrate from legacy (hardcoded salt) to new (unique salt) format.
 * This re-derives the key with a new salt.
 * @param {string} password - User password
 * @returns {Promise<boolean>} Success status
 */
export async function migrateToUniqueSalt(password) {
  const legacyKey = deriveMasterKeyLegacy(password);
  const storedKey = await loadMasterKey();
  
  if (!storedKey) {
    console.log('[crypto] No key to migrate');
    return false;
  }
  
  // Check if legacy key matches stored
  if (!crypto.timingSafeEqual(legacyKey, storedKey)) {
    console.log('[crypto] Key doesn\'t match legacy format');
    return false;
  }
  
  // Re-derive with unique salt
  const { key: newKey, salt } = await deriveMasterKey(password);
  
  // Save new key and salt
  await saveMasterKey(newKey);
  await saveSalt(salt);
  
  // Wipe temporary keys
  wipeKey(newKey);
  wipeKey(legacyKey);
  
  console.log('[crypto] Successfully migrated to unique salt');
  return true;
}
