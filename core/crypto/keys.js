// Module: Key Management
// Description: Deterministic generation and loading of persistent keys
//              based on seed phrase + master key.
//              Now with encrypted seed storage and secure memory handling.
// File: core/crypto/keys.js

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { mnemonicToSeed } from './seed.js';
import { deriveSubKey } from './derive.js';
import { getPublicKey } from './sign.js';
import { generateKeyPair } from './box.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const SEED_FILE = 'seed.enc';  // Encrypted seed file
const SEED_LEGACY_FILE = 'seed.txt';  // Legacy plaintext (for migration)
const ALGORITHM = 'chacha20-poly1305';
const NONCE_SIZE = 12;
const KEY_SIZE = 32;

// ============================================================================
// SECURE MEMORY BUFFER
// ============================================================================

/**
 * SecureBuffer wraps a Buffer and provides automatic zeroing on cleanup.
 * Used to hold sensitive key material in memory.
 */
export class SecureBuffer {
  constructor(size) {
    this._buffer = Buffer.alloc(size);
    this._freed = false;
  }
  
  get buffer() {
    if (this._freed) {
      throw new Error('SecureBuffer has been freed');
    }
    return this._buffer;
  }
  
  get length() {
    return this._buffer.length;
  }
  
  fill(value) {
    this._buffer.fill(value);
    return this;
  }
  
  copy(target, targetStart, sourceStart, sourceEnd) {
    return this._buffer.copy(target, targetStart, sourceStart, sourceEnd);
  }
  
  slice(start, end) {
    return this._buffer.slice(start, end);
  }
  
  toString(encoding) {
    return this._buffer.toString(encoding);
  }
  
  /**
   * Securely wipe the buffer from memory
   */
  free() {
    if (!this._freed) {
      this._buffer.fill(0);
      // Overwrite multiple times for added security
      for (let i = 0; i < 3; i++) {
        crypto.randomFillSync(this._buffer);
        this._buffer.fill(0);
      }
      this._freed = true;
    }
  }
  
  /**
   * Check if buffer is still valid
   */
  isValid() {
    return !this._freed;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

async function ensureDir(dir) {
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
}

async function loadJson(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ============================================================================
// ENCRYPTED SEED STORAGE
// ============================================================================

/**
 * Encrypt seed phrase using master key
 * @param {string} seedPhrase - BIP-39 mnemonic
 * @param {Buffer} masterKey - 32-byte master key
 * @returns {Object} Encrypted seed data
 */
export function encryptSeedPhrase(seedPhrase, masterKey) {
  const nonce = crypto.randomBytes(NONCE_SIZE);
  
  // Derive encryption key from master key using HKDF
  const encKey = crypto.createHmac('sha256', nonce)
    .update(masterKey)
    .update(Buffer.from('nzcore:seed:v2', 'utf8'))
    .digest();
  
  const cipher = crypto.createCipheriv(ALGORITHM, encKey, nonce, {
    authTagLength: 16
  });
  
  const plaintext = Buffer.from(seedPhrase, 'utf8');
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);
  
  const tag = cipher.getAuthTag();
  
  // Wipe derived key
  encKey.fill(0);
  
  return {
    version: 2,
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
    createdAt: new Date().toISOString()
  };
}

/**
 * Decrypt seed phrase using master key
 * @param {Object} encData - Encrypted seed data
 * @param {Buffer} masterKey - 32-byte master key
 * @returns {SecureBuffer} Decrypted seed phrase in secure buffer
 */
export function decryptSeedPhrase(encData, masterKey) {
  const nonce = Buffer.from(encData.nonce, 'base64');
  const tag = Buffer.from(encData.tag, 'base64');
  const encrypted = Buffer.from(encData.data, 'base64');
  
  // Derive decryption key
  const decKey = crypto.createHmac('sha256', nonce)
    .update(masterKey)
    .update(Buffer.from('nzcore:seed:v2', 'utf8'))
    .digest();
  
  const decipher = crypto.createDecipheriv(ALGORITHM, decKey, nonce, {
    authTagLength: 16
  });
  
  decipher.setAuthTag(tag);
  
  try {
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    // Create secure buffer for the seed
    const secureBuf = new SecureBuffer(plaintext.length);
    plaintext.copy(secureBuf.buffer);
    
    // Wipe intermediate buffer
    plaintext.fill(0);
    
    return secureBuf;
  } finally {
    // Wipe derived key
    decKey.fill(0);
  }
}

// ============================================================================
// LEGACY MIGRATION
// ============================================================================

/**
 * Check for legacy plaintext seed file and migrate to encrypted format
 * @param {string} envPath - Path to env directory
 * @param {Buffer} masterKey - Master key for encryption
 * @returns {Promise<boolean>} True if migration was performed
 */
async function migrateLegacySeed(envPath, masterKey) {
  const legacyPath = path.join(envPath, SEED_LEGACY_FILE);
  
  try {
    const data = await fs.readFile(legacyPath, 'utf8');
    const seedPhrase = data.trim();
    
    if (!seedPhrase) {
      return false;
    }
    
    console.log('[crypto] Migrating plaintext seed to encrypted format...');
    
    // Encrypt and save
    const encData = encryptSeedPhrase(seedPhrase, masterKey);
    const encPath = path.join(envPath, SEED_FILE);
    await saveJson(encPath, encData);
    
    // Securely delete legacy file
    // Overwrite with random data before deletion
    const randomData = crypto.randomBytes(data.length);
    await fs.writeFile(legacyPath, randomData);
    await fs.unlink(legacyPath);
    
    console.log('[crypto] Seed migration complete. Legacy file removed.');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false; // No legacy file, nothing to migrate
    }
    throw error;
  }
}

// ============================================================================
// KEY DERIVATION
// ============================================================================

/**
 * Derive Ed25519 identity key from seed
 */
function deriveIdentityKey(seedBytes) {
  const identitySeed = deriveSubKey(seedBytes, 'identity', 32);
  const pub = getPublicKey(identitySeed);

  const result = {
    private: Buffer.from(identitySeed).toString('base64'),
    public: Buffer.from(pub).toString('base64')
  };
  
  // Wipe intermediate seed
  identitySeed.fill(0);
  
  return result;
}

/**
 * Derive X25519 ECDH key from seed
 */
function deriveECDHKey(seedBytes) {
  const ecdhSeed = deriveSubKey(seedBytes, 'ecdh', 32);
  const { publicKey, privateKey } = generateKeyPair(ecdhSeed);

  const result = {
    private: Buffer.from(privateKey).toString('base64'),
    public: Buffer.from(publicKey).toString('base64')
  };
  
  // Wipe intermediate seed
  ecdhSeed.fill(0);
  
  return result;
}

// ============================================================================
// MAIN KEY LOADER
// ============================================================================

/**
 * Load or create all keys with encrypted seed storage
 * @param {string} envPath - Path to env directory
 * @param {Buffer} masterKey - 32-byte master key for encryption
 * @returns {Promise<{identity: Object, ecdh: Object}>}
 */
export async function loadAllKeys(envPath, masterKey) {
  const keysDir = path.join(envPath, 'keys');
  await ensureDir(keysDir);
  
  // Try to migrate legacy plaintext seed first
  if (masterKey) {
    await migrateLegacySeed(envPath, masterKey);
  }
  
  // Load encrypted seed
  const encPath = path.join(envPath, SEED_FILE);
  let seedBytes = null;
  let secureSeedBuf = null;
  
  try {
    const encData = await loadJson(encPath);
    
    if (encData && encData.version === 2 && masterKey) {
      // Decrypt seed phrase
      secureSeedBuf = decryptSeedPhrase(encData, masterKey);
      const seedPhrase = secureSeedBuf.toString('utf8');
      seedBytes = await mnemonicToSeed(seedPhrase);
    } else if (encData && encData.version === 1) {
      // Handle version 1 (if needed)
      throw new Error('Unsupported seed file version: 1');
    } else {
      // Check for legacy plaintext file (no master key provided)
      const legacyPath = path.join(envPath, SEED_LEGACY_FILE);
      try {
        const seedPhrase = (await fs.readFile(legacyPath, 'utf8')).trim();
        seedBytes = await mnemonicToSeed(seedPhrase);
        console.warn('[crypto] WARNING: Using plaintext seed file. Provide master key for encryption.');
      } catch {
        throw new Error('No seed file found. Run bootstrap first.');
      }
    }
    
    const identityFile = path.join(keysDir, 'identity.json');
    const ecdhFile = path.join(keysDir, 'ecdh.json');
    
    let identity = await loadJson(identityFile);
    let ecdh = await loadJson(ecdhFile);
    
    // Derive keys if not already cached
    if (!identity) {
      identity = deriveIdentityKey(seedBytes);
      await saveJson(identityFile, identity);
    }
    
    if (!ecdh) {
      ecdh = deriveECDHKey(seedBytes);
      await saveJson(ecdhFile, ecdh);
    }
    
    return { identity, ecdh };
  } finally {
    // Securely wipe seed bytes
    if (seedBytes) {
      seedBytes.fill(0);
    }
    
    // Free secure buffer
    if (secureSeedBuf) {
      secureSeedBuf.free();
    }
  }
}

// ============================================================================
// SEED CREATION (for bootstrap)
// ============================================================================

/**
 * Create and save encrypted seed phrase
 * @param {string} envPath - Path to env directory
 * @param {string} seedPhrase - BIP-39 mnemonic
 * @param {Buffer} masterKey - 32-byte master key
 */
export async function saveSeedPhrase(envPath, seedPhrase, masterKey) {
  await ensureDir(envPath);
  
  if (!masterKey) {
    throw new Error('Master key required for seed encryption');
  }
  
  const encData = encryptSeedPhrase(seedPhrase, masterKey);
  const encPath = path.join(envPath, SEED_FILE);
  await saveJson(encPath, encData);
  
  console.log('[crypto] Seed phrase encrypted and saved');
}

/**
 * Check if seed file exists
 * @param {string} envPath - Path to env directory
 * @returns {Promise<{encrypted: boolean, legacy: boolean}>}
 */
export async function checkSeedExists(envPath) {
  const encPath = path.join(envPath, SEED_FILE);
  const legacyPath = path.join(envPath, SEED_LEGACY_FILE);
  
  let encrypted = false;
  let legacy = false;
  
  try {
    await fs.access(encPath);
    encrypted = true;
  } catch {}
  
  try {
    await fs.access(legacyPath);
    legacy = true;
  } catch {}
  
  return { encrypted, legacy };
}
