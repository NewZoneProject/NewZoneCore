// Module: Trust Store Manager
// Description: Loads, validates and updates the trust store used for
//              cryptographic routing and node identity verification.
//              Now with encrypted storage for security.
// File: core/crypto/trust.js

import fs from 'fs/promises';
import path from 'path';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const ENV = path.join(ROOT, 'env');
const TRUST_FILE = path.join(ENV, 'trust.json');

// DoS protection limits
const MAX_PEERS = 1000; // Maximum number of trusted peers
const MAX_TRUST_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Encryption constants
const ALGORITHM = 'chacha20-poly1305';
const KEY_SIZE = 32;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;

// --- Default trust store structure ------------------------------------------
const DEFAULT_TRUST = {
  peers: [],            // array of { id, pubkey, addedAt }
  updatedAt: null
};

// ============================================================================
// ENCRYPTION HELPERS
// ============================================================================

/**
 * Derive encryption key from master key using HKDF-like construction.
 * @param {Buffer} masterKey - Master key (32 bytes)
 * @param {Buffer} nonce - Nonce for this encryption
 * @returns {Buffer} Derived encryption key (32 bytes)
 */
function deriveEncryptionKey(masterKey, nonce) {
  // HKDF-Extract: PRK = HMAC-SHA256(nonce, masterKey)
  const prk = crypto.createHmac('sha256', nonce)
    .update(masterKey)
    .digest();
  
  // HKDF-Expand: OKM = HMAC-SHA256(PRK, context)
  const okm = crypto.createHmac('sha256', prk)
    .update(Buffer.from('nzcore:trust:v2', 'utf8'))
    .digest();
  
  return okm;
}

/**
 * Encrypt trust store data.
 * @param {Object} data - Trust store data
 * @param {Buffer} masterKey - Master encryption key
 * @returns {Buffer} Encrypted data with header
 */
function encryptTrustData(data, masterKey) {
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const nonce = randomBytes(NONCE_SIZE);
  
  // Derive encryption key
  const key = deriveEncryptionKey(masterKey, nonce);
  
  // Encrypt using ChaCha20-Poly1305
  const cipher = createCipheriv(ALGORITHM, key, nonce, {
    authTagLength: TAG_SIZE
  });
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);
  
  const tag = cipher.getAuthTag();
  
  // Format: [version (4)] [nonce (12)] [tag (16)] [ciphertext (variable)]
  const header = Buffer.alloc(4);
  header.writeUInt32BE(2, 0); // Version 2 = encrypted
  
  return Buffer.concat([header, nonce, tag, encrypted]);
}

/**
 * Decrypt trust store data.
 * @param {Buffer} encryptedData - Encrypted data with header
 * @param {Buffer} masterKey - Master encryption key
 * @returns {Object} Decrypted trust store data
 */
function decryptTrustData(encryptedData, masterKey) {
  // Read header
  const version = encryptedData.readUInt32BE(0);
  
  if (version !== 2) {
    throw new Error(`Unsupported trust file version: ${version}`);
  }
  
  // Extract components
  const nonce = encryptedData.slice(4, 4 + NONCE_SIZE);
  const tag = encryptedData.slice(4 + NONCE_SIZE, 4 + NONCE_SIZE + TAG_SIZE);
  const ciphertext = encryptedData.slice(4 + NONCE_SIZE + TAG_SIZE);
  
  // Derive decryption key
  const key = deriveEncryptionKey(masterKey, nonce);
  
  // Decrypt
  const decipher = createDecipheriv(ALGORITHM, key, nonce, {
    authTagLength: TAG_SIZE
  });
  decipher.setAuthTag(tag);
  
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);
  
  return JSON.parse(plaintext.toString('utf8'));
}

// ============================================================================
// MASTER KEY MANAGEMENT
// ============================================================================

let cachedMasterKey = null;

/**
 * Get master key for encryption/decryption.
 * @returns {Promise<Buffer|null>} Master key or null
 */
async function getMasterKey() {
  if (cachedMasterKey) {
    return cachedMasterKey;
  }
  
  try {
    const { loadMasterKey } = await import('./master.js');
    const key = await loadMasterKey();
    cachedMasterKey = key;
    return key;
  } catch {
    return null;
  }
}

/**
 * Clear cached master key (for security).
 */
export function clearMasterKeyCache() {
  if (cachedMasterKey) {
    cachedMasterKey.fill(0);
    cachedMasterKey = null;
  }
}

// ============================================================================
// TRUST STORE OPERATIONS
// ============================================================================

/**
 * Load trust store from disk (with decryption if encrypted).
 * @returns {Promise<Object>} Trust store data
 */
export async function loadTrustStore() {
  try {
    // Check file size before reading (DoS protection)
    const stats = await fs.stat(TRUST_FILE);
    if (stats.size > MAX_TRUST_FILE_SIZE) {
      throw new Error(`trust.json too large (${stats.size} bytes, max ${MAX_TRUST_FILE_SIZE})`);
    }

    const encryptedData = await fs.readFile(TRUST_FILE);
    
    // Check if file is encrypted (version header)
    const version = encryptedData.readUInt32BE(0);
    
    if (version === 2) {
      // Encrypted format
      const masterKey = await getMasterKey();
      if (!masterKey) {
        throw new Error('Master key required to decrypt trust store');
      }
      
      const data = decryptTrustData(encryptedData, masterKey);
      
      // Validate structure
      if (!data || typeof data !== 'object') throw new Error('Invalid trust.json');
      if (!Array.isArray(data.peers)) throw new Error('Invalid peers array');

      // Validate peer count (DoS protection)
      if (data.peers.length > MAX_PEERS) {
        throw new Error(`Too many peers (${data.peers.length}, max ${MAX_PEERS})`);
      }

      return data;
    } else {
      // Legacy plaintext format (for migration)
      const json = encryptedData.toString('utf8');
      const data = JSON.parse(json);
      
      console.warn('[trust] WARNING: trust.json is not encrypted. Consider re-saving to encrypt.');
      
      // Validate structure
      if (!data || typeof data !== 'object') throw new Error('Invalid trust.json');
      if (!Array.isArray(data.peers)) throw new Error('Invalid peers array');

      return data;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Missing trust.json → return empty trust store
      return { ...DEFAULT_TRUST, updatedAt: new Date().toISOString() };
    }
    throw error;
  }
}

/**
 * Save trust store to disk (with encryption).
 * @param {Object} store - Trust store data
 * @param {Buffer} [masterKey] - Optional master key (will be loaded if not provided)
 */
export async function saveTrustStore(store, masterKey = null) {
  if (!store || typeof store !== 'object') {
    throw new Error('Trust store must be an object');
  }

  // Check peer count before saving (DoS protection)
  if (store.peers && store.peers.length > MAX_PEERS) {
    throw new Error(`Cannot save: too many peers (${store.peers.length}, max ${MAX_PEERS})`);
  }

  store.updatedAt = new Date().toISOString();
  
  // Get master key for encryption
  const key = masterKey || await getMasterKey();
  
  if (key) {
    // Encrypt and save
    const encryptedData = encryptTrustData(store, key);
    await fs.writeFile(TRUST_FILE, encryptedData, { mode: 0o600 });
  } else {
    // No master key - save as plaintext (legacy format)
    console.warn('[trust] WARNING: No master key available. Saving trust.json unencrypted.');
    await fs.writeFile(TRUST_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  }
}

/**
 * Add peer to trust store with limit check.
 * @param {Object} peer - Peer data { id, pubkey }
 * @returns {Promise<Object>} Updated trust store
 */
export async function addTrustedPeer(peer) {
  const store = await loadTrustStore();

  if (!peer || !peer.id || !peer.pubkey) {
    throw new Error('Peer must contain id and pubkey');
  }

  // Avoid duplicates
  if (store.peers.some(p => p.id === peer.id)) {
    return store; // already trusted
  }

  // Check max peers limit (DoS protection)
  if (store.peers.length >= MAX_PEERS) {
    throw new Error(`Maximum peer limit reached (${MAX_PEERS})`);
  }

  store.peers.push({
    id: peer.id,
    pubkey: peer.pubkey,
    addedAt: new Date().toISOString()
  });

  await saveTrustStore(store);
  return store;
}

/**
 * Remove peer from trust store.
 * @param {string} id - Peer ID to remove
 * @returns {Promise<Object>} Updated trust store
 */
export async function removeTrustedPeer(id) {
  const store = await loadTrustStore();
  store.peers = store.peers.filter(p => p.id !== id);
  await saveTrustStore(store);
  return store;
}

/**
 * Check if peer is trusted.
 * @param {string} id - Peer ID to check
 * @returns {Promise<boolean>} True if trusted
 */
export async function isTrusted(id) {
  const store = await loadTrustStore();
  return store.peers.some(p => p.id === id);
}

/**
 * Get peer by ID.
 * @param {string} id - Peer ID
 * @returns {Promise<Object|null>} Peer data or null
 */
export async function getPeer(id) {
  const store = await loadTrustStore();
  return store.peers.find(p => p.id === id) || null;
}

/**
 * Get all trusted peers.
 * @returns {Promise<Array>} Array of peers
 */
export async function getAllPeers() {
  const store = await loadTrustStore();
  return store.peers || [];
}

/**
 * Export trust store (without sensitive data).
 * @returns {Promise<Object>} Exportable trust data
 */
export async function exportTrust() {
  const store = await loadTrustStore();
  return {
    peers: store.peers.map(p => ({
      id: p.id,
      pubkey: p.pubkey,
      addedAt: p.addedAt
    })),
    exportedAt: new Date().toISOString()
  };
}

/**
 * Import trust store.
 * @param {Object} data - Trust data to import
 * @returns {Promise<void>}
 */
export async function importTrust(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid trust data');
  }
  
  if (!Array.isArray(data.peers)) {
    throw new Error('Invalid peers array');
  }
  
  const store = {
    peers: data.peers,
    updatedAt: new Date().toISOString()
  };
  
  await saveTrustStore(store);
}