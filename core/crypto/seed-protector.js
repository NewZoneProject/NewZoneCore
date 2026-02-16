// Module: Seed Protection
// Description: Secure storage for BIP-39 seed phrases with ChaCha20-Poly1305 encryption.
//              Seed phrase is encrypted with a key derived from the master key.
// File: core/crypto/seed-protector.js

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ALGORITHM = 'chacha20-poly1305';
const KEY_SIZE = 32;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;

// ============================================================================
// SEED ENCRYPTION
// ============================================================================

/**
 * Encrypt seed phrase using ChaCha20-Poly1305.
 * 
 * @param {string} seedPhrase - BIP-39 mnemonic (12-24 words)
 * @param {Buffer} encryptionKey - 32-byte encryption key (derived from master key)
 * @returns {{ ciphertext: string, nonce: string, tag: string }}
 */
export function encryptSeed(seedPhrase, encryptionKey) {
  if (!seedPhrase || typeof seedPhrase !== 'string') {
    throw new Error('Seed phrase must be a non-empty string');
  }
  
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== KEY_SIZE) {
    throw new Error(`Encryption key must be a ${KEY_SIZE}-byte Buffer`);
  }
  
  // Generate random nonce
  const nonce = randomBytes(NONCE_SIZE);
  
  // Create cipher
  const cipher = createCipheriv(ALGORITHM, encryptionKey, nonce, {
    authTagLength: TAG_SIZE
  });
  
  // Encrypt
  const plaintext = Buffer.from(seedPhrase.trim(), 'utf8');
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);
  
  const tag = cipher.getAuthTag();
  
  return {
    ciphertext: encrypted.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64')
  };
}

/**
 * Decrypt seed phrase using ChaCha20-Poly1305.
 * 
 * @param {{ ciphertext: string, nonce: string, tag: string }} encryptedData
 * @param {Buffer} encryptionKey - 32-byte encryption key
 * @returns {string} Decrypted seed phrase
 */
export function decryptSeed(encryptedData, encryptionKey) {
  if (!encryptedData || !encryptedData.ciphertext || !encryptedData.nonce || !encryptedData.tag) {
    throw new Error('Invalid encrypted data structure');
  }
  
  if (!Buffer.isBuffer(encryptionKey) || encryptionKey.length !== KEY_SIZE) {
    throw new Error(`Encryption key must be a ${KEY_SIZE}-byte Buffer`);
  }
  
  const nonce = Buffer.from(encryptedData.nonce, 'base64');
  const ciphertext = Buffer.from(encryptedData.ciphertext, 'base64');
  const tag = Buffer.from(encryptedData.tag, 'base64');
  
  if (nonce.length !== NONCE_SIZE) {
    throw new Error(`Invalid nonce size: expected ${NONCE_SIZE}, got ${nonce.length}`);
  }
  
  if (tag.length !== TAG_SIZE) {
    throw new Error(`Invalid tag size: expected ${TAG_SIZE}, got ${tag.length}`);
  }
  
  // Create decipher
  const decipher = createDecipheriv(ALGORITHM, encryptionKey, nonce, {
    authTagLength: TAG_SIZE
  });
  
  decipher.setAuthTag(tag);
  
  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error('Decryption failed: invalid key or corrupted data');
  }
}

// ============================================================================
// DERIVE ENCRYPTION KEY FROM MASTER KEY
// ============================================================================

/**
 * Derive seed encryption key from master key using HKDF.
 * This ensures the seed encryption key is unique and derived
 * from the master key, not directly using the master key.
 * 
 * @param {Buffer} masterKey - 32-byte master key
 * @param {Buffer} salt - Optional salt for key derivation
 * @returns {Buffer} 32-byte encryption key
 */
export function deriveSeedEncryptionKey(masterKey, salt = null) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== KEY_SIZE) {
    throw new Error(`Master key must be a ${KEY_SIZE}-byte Buffer`);
  }
  
  // Use HKDF to derive a unique key for seed encryption
  // Context: "nzcore:seed:v1" prevents key reuse
  const info = Buffer.from('nzcore:seed:v1', 'utf8');
  const actualSalt = salt || Buffer.alloc(32, 0); // Zero salt if not provided
  
  // Simple HKDF-like derivation using SHA-256
  // PRK = HMAC-SHA256(salt, masterKey)
  const prk = crypto.createHmac('sha256', actualSalt)
    .update(masterKey)
    .digest();
  
  // OKM = HMAC-SHA256(PRK, info || 0x01)
  const infoWithCounter = Buffer.concat([info, Buffer.from([0x01])]);
  const okm = crypto.createHmac('sha256', prk)
    .update(infoWithCounter)
    .digest();
  
  return okm;
}

// ============================================================================
// FILE STORAGE
// ============================================================================

/**
 * Save encrypted seed to file.
 * Format: JSON { version, ciphertext, nonce, tag, checksum }
 * 
 * @param {string} filepath - Path to save encrypted seed
 * @param {string} seedPhrase - BIP-39 mnemonic
 * @param {Buffer} masterKey - Master key for encryption
 */
export async function saveEncryptedSeed(filepath, seedPhrase, masterKey) {
  // Derive encryption key
  const encryptionKey = deriveSeedEncryptionKey(masterKey);
  
  // Encrypt seed
  const encrypted = encryptSeed(seedPhrase, encryptionKey);
  
  // Create storage object with version and checksum
  const storage = {
    version: 1,
    algorithm: 'chacha20-poly1305',
    created: new Date().toISOString(),
    ...encrypted,
    // Checksum of plaintext for integrity verification after decryption
    checksum: crypto.createHash('sha256')
      .update(seedPhrase.trim())
      .digest('hex')
      .substring(0, 16)
  };
  
  // Write with secure permissions
  await fs.writeFile(filepath, JSON.stringify(storage, null, 2), {
    mode: 0o600,
    encoding: 'utf8'
  });
  
  // Wipe encryption key from memory
  encryptionKey.fill(0);
  
  console.log('[crypto] Encrypted seed saved securely');
}

/**
 * Load encrypted seed from file.
 * 
 * @param {string} filepath - Path to encrypted seed file
 * @param {Buffer} masterKey - Master key for decryption
 * @returns {Promise<string>} Decrypted seed phrase
 */
export async function loadEncryptedSeed(filepath, masterKey) {
  let rawContent;
  try {
    rawContent = await fs.readFile(filepath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  
  const storage = JSON.parse(rawContent);
  
  // Validate structure
  if (!storage.version || !storage.ciphertext || !storage.nonce || !storage.tag) {
    throw new Error('Invalid encrypted seed file structure');
  }
  
  if (storage.version !== 1) {
    throw new Error(`Unsupported encrypted seed version: ${storage.version}`);
  }
  
  // Derive encryption key
  const encryptionKey = deriveSeedEncryptionKey(masterKey);
  
  // Decrypt
  const seedPhrase = decryptSeed(storage, encryptionKey);
  
  // Verify checksum if present
  if (storage.checksum) {
    const actualChecksum = crypto.createHash('sha256')
      .update(seedPhrase.trim())
      .digest('hex')
      .substring(0, 16);
    
    if (actualChecksum !== storage.checksum) {
      // Wipe key before throwing
      encryptionKey.fill(0);
      throw new Error('Seed checksum verification failed');
    }
  }
  
  // Wipe encryption key from memory
  encryptionKey.fill(0);
  
  return seedPhrase;
}

/**
 * Check if encrypted seed file exists.
 */
export async function hasEncryptedSeed(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrate from plaintext seed to encrypted seed.
 * 
 * @param {string} plaintextPath - Path to plaintext seed.txt
 * @param {string} encryptedPath - Path for encrypted seed
 * @param {Buffer} masterKey - Master key for encryption
 * @returns {Promise<boolean>} Success status
 */
export async function migrateToEncryptedSeed(plaintextPath, encryptedPath, masterKey) {
  try {
    // Check if plaintext exists
    await fs.access(plaintextPath);
  } catch {
    // No plaintext to migrate
    return false;
  }
  
  // Check if encrypted already exists
  if (await hasEncryptedSeed(encryptedPath)) {
    console.log('[crypto] Encrypted seed already exists, skipping migration');
    return false;
  }
  
  // Read plaintext
  const plaintext = await fs.readFile(plaintextPath, 'utf8');
  const seedPhrase = plaintext.trim();
  
  // Save encrypted
  await saveEncryptedSeed(encryptedPath, seedPhrase, masterKey);
  
  // Delete plaintext file
  await fs.unlink(plaintextPath);
  
  console.log('[crypto] Successfully migrated seed to encrypted format');
  console.log('[crypto] Plaintext seed file deleted');
  
  return true;
}

// ============================================================================
// SECURE WIPE UTILITIES
// ============================================================================

/**
 * Securely wipe a buffer containing sensitive data.
 */
export function wipeBuffer(buffer) {
  if (Buffer.isBuffer(buffer)) {
    buffer.fill(0);
  } else if (buffer instanceof Uint8Array) {
    buffer.fill(0);
  }
}

/**
 * Securely wipe a string from memory by creating and wiping a buffer.
 * Note: JavaScript strings are immutable, so this is best-effort.
 */
export function wipeString(str) {
  // Create a buffer copy and wipe it
  const buf = Buffer.from(str, 'utf8');
  buf.fill(0);
}
