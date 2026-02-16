// Module: Secure Storage Layer
// Description: Provides encrypted file storage, encrypted KV store,
//              and encrypted event logs for secure data persistence.
//              Now uses proper HKDF for key derivation.
// File: core/storage/secure.js

import { EventTypes, getEventBus } from '../eventbus/index.js';
import { randomBytes, createCipheriv, createDecipheriv, createHash, createHmac } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

// ============================================================================
// STORAGE CONSTANTS
// ============================================================================

const ALGORITHM = 'chacha20-poly1305';
const KEY_SIZE = 32;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;

// Security limits
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_KEY_SIZE = 10 * 1024 * 1024;   // 10 MB for KV values
const MAX_LOG_SIZE = 50 * 1024 * 1024;   // 50 MB for logs

// ============================================================================
// KEY DERIVATION (Using HKDF)
// ============================================================================

/**
 * Derive encryption key using HKDF-Extract-Expand.
 * 
 * CRITICAL FIX: Previously used SHA256(key || nonce) which is not secure.
 * Now uses proper HKDF construction with separate extract and expand steps.
 * 
 * @param {Buffer} masterKey - Master encryption key (32 bytes)
 * @param {Buffer} nonce - Nonce for this encryption (12 bytes)
 * @param {string} context - Context string for domain separation
 * @returns {Buffer} Derived encryption key (32 bytes)
 */
function deriveEncryptionKey(masterKey, nonce, context = 'nzcore:storage:v2') {
  if (!Buffer.isBuffer(masterKey) || masterKey.length < 16) {
    throw new Error('Master key must be at least 16 bytes');
  }
  
  if (!Buffer.isBuffer(nonce) || nonce.length < 8) {
    throw new Error('Nonce must be at least 8 bytes');
  }
  
  // HKDF-Extract: PRK = HMAC-Hash(salt, IKM)
  // Using nonce as salt and master key as input key material
  const prk = createHmac('sha256', nonce)
    .update(masterKey)
    .digest();
  
  // HKDF-Expand: OKM = HMAC-Hash(PRK, info || 0x01)
  // info = context + derivation counter
  const info = Buffer.concat([
    Buffer.from(context, 'utf8'),
    Buffer.from([0x01])
  ]);
  
  const okm = createHmac('sha256', prk)
    .update(info)
    .digest();
  
  // Wipe PRK from memory (best effort)
  prk.fill(0);
  
  return okm;
}

// ============================================================================
// SECURE STORAGE
// ============================================================================

export class SecureStorage {
  constructor(options = {}) {
    this.eventBus = getEventBus();
    this.basePath = options.basePath || './data';
    this.masterKey = options.masterKey || null;
    this.identity = options.identity || null;

    // Cache
    this.cache = new Map();
    this.cacheMaxSize = options.cacheMaxSize || 1000;
    this.cacheEnabled = options.cacheEnabled !== false;

    // Options
    this.options = {
      autoCreate: options.autoCreate !== false,
      compress: options.compress || false,
      maxFileSize: options.maxFileSize || MAX_FILE_SIZE,
      maxKeySize: options.maxKeySize || MAX_KEY_SIZE,
      ...options
    };
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  /**
   * Initialize storage
   */
  async init() {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
      await fs.mkdir(path.join(this.basePath, 'files'), { recursive: true });
      await fs.mkdir(path.join(this.basePath, 'kv'), { recursive: true });
      await fs.mkdir(path.join(this.basePath, 'logs'), { recursive: true });

      this.eventBus.emit(EventTypes.SYSTEM_INFO, {
        component: 'storage',
        action: 'initialized',
        path: this.basePath
      });

      return { success: true };
    } catch (error) {
      this.eventBus.emit(EventTypes.CORE_ERROR, {
        component: 'storage',
        error: error.message
      });
      throw error;
    }
  }

  // ==========================================================================
  // ENCRYPTED FILES
  // ==========================================================================

  /**
   * Write encrypted file
   */
  async writeFile(filename, data, options = {}) {
    const filePath = path.join(this.basePath, 'files', filename);

    try {
      // Serialize data
      const plaintext = typeof data === 'string' 
        ? Buffer.from(data, 'utf8')
        : Buffer.from(JSON.stringify(data), 'utf8');

      // Check size limit
      if (plaintext.length > this.options.maxFileSize) {
        throw new Error(`File too large: ${plaintext.length} > ${this.options.maxFileSize}`);
      }

      // Encrypt
      const encrypted = await this._encrypt(plaintext, options.key, options.context || 'file');

      // Add header (version 2 for new format)
      const header = Buffer.alloc(8);
      header.writeUInt32BE(2, 0); // Version 2 = HKDF
      header.writeUInt32BE(encrypted.length, 4);

      const output = Buffer.concat([header, encrypted]);

      // Write atomically with secure permissions
      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, output, { mode: 0o600 });
      await fs.rename(tempPath, filePath);

      // Update cache
      if (this.cacheEnabled) {
        this._cacheSet(`file:${filename}`, data);
      }

      this.eventBus.emit(EventTypes.SYSTEM_INFO, {
        component: 'storage',
        action: 'file_written',
        filename,
        size: encrypted.length
      });

      return { success: true, path: filePath };
    } catch (error) {
      this.eventBus.emit(EventTypes.CORE_ERROR, {
        component: 'storage',
        action: 'write_file',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Read encrypted file
   */
  async readFile(filename, options = {}) {
    // Check cache first
    if (this.cacheEnabled) {
      const cached = this._cacheGet(`file:${filename}`);
      if (cached !== undefined) {
        return cached;
      }
    }

    const filePath = path.join(this.basePath, 'files', filename);

    try {
      const data = await fs.readFile(filePath);

      // Read header
      const header = data.slice(0, 8);
      const version = header.readUInt32BE(0);
      const encryptedSize = header.readUInt32BE(4);

      if (version === 1) {
        // Legacy format - warn and attempt migration
        console.warn(`[storage] File ${filename} uses legacy encryption. Consider re-encrypting.`);
        const encrypted = data.slice(4);
        const plaintext = await this._decryptLegacy(encrypted, options.key);
        return this._parsePlaintext(plaintext);
      }
      
      if (version !== 2) {
        throw new Error(`Unsupported file version: ${version}`);
      }

      // Decrypt with HKDF
      const encrypted = data.slice(8);
      const plaintext = await this._decrypt(encrypted, options.key, options.context || 'file');

      const result = this._parsePlaintext(plaintext);

      // Update cache
      if (this.cacheEnabled) {
        this._cacheSet(`file:${filename}`, result);
      }

      return result;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Parse plaintext to string or JSON
   */
  _parsePlaintext(plaintext) {
    const str = plaintext.toString('utf8');
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  /**
   * Delete file
   */
  async deleteFile(filename) {
    const filePath = path.join(this.basePath, 'files', filename);

    try {
      await fs.unlink(filePath);
      this._cacheDelete(`file:${filename}`);

      return { success: true };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: true };
      }
      throw error;
    }
  }

  /**
   * List files
   */
  async listFiles() {
    const filesPath = path.join(this.basePath, 'files');
    try {
      return await fs.readdir(filesPath);
    } catch {
      return [];
    }
  }

  // ==========================================================================
  // ENCRYPTED KV STORE
  // ==========================================================================

  /**
   * Set key-value pair
   */
  async set(key, value, options = {}) {
    // Validate key
    if (!key || typeof key !== 'string' || key.length > 256) {
      throw new Error('Invalid key: must be non-empty string <= 256 chars');
    }

    const keyHash = this._hashKey(key);
    const filePath = path.join(this.basePath, 'kv', `${keyHash}.dat`);

    try {
      const serialized = JSON.stringify({
        key,
        value,
        timestamp: new Date().toISOString(),
        metadata: options.metadata || {}
      });
      
      const plaintext = Buffer.from(serialized, 'utf8');
      
      // Check size limit
      if (plaintext.length > this.options.maxKeySize) {
        throw new Error(`Value too large: ${plaintext.length} > ${this.options.maxKeySize}`);
      }

      const encrypted = await this._encrypt(plaintext, options.key, 'kv');

      const tempPath = `${filePath}.tmp`;
      await fs.writeFile(tempPath, encrypted, { mode: 0o600 });
      await fs.rename(tempPath, filePath);

      if (this.cacheEnabled) {
        this._cacheSet(`kv:${key}`, value);
      }

      return { success: true, key };
    } catch (error) {
      this.eventBus.emit(EventTypes.CORE_ERROR, {
        component: 'storage',
        action: 'kv_set',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get value by key
   */
  async get(key, options = {}) {
    if (this.cacheEnabled) {
      const cached = this._cacheGet(`kv:${key}`);
      if (cached !== undefined) {
        return cached;
      }
    }

    const keyHash = this._hashKey(key);
    const filePath = path.join(this.basePath, 'kv', `${keyHash}.dat`);

    try {
      const encrypted = await fs.readFile(filePath);
      const plaintext = await this._decrypt(encrypted, options.key, 'kv');
      const data = JSON.parse(plaintext.toString('utf8'));

      if (this.cacheEnabled) {
        this._cacheSet(`kv:${key}`, data.value);
      }

      return data.value;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete key
   */
  async delete(key) {
    const keyHash = this._hashKey(key);
    const filePath = path.join(this.basePath, 'kv', `${keyHash}.dat`);

    try {
      await fs.unlink(filePath);
      this._cacheDelete(`kv:${key}`);
      return { success: true };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: true };
      }
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  async has(key) {
    const keyHash = this._hashKey(key);
    const filePath = path.join(this.basePath, 'kv', `${keyHash}.dat`);

    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // ENCRYPTED EVENT LOGS
  // ==========================================================================

  /**
   * Append to event log
   */
  async appendLog(logName, event, options = {}) {
    const logPath = path.join(this.basePath, 'logs', `${logName}.log`);

    try {
      const entry = {
        timestamp: new Date().toISOString(),
        event,
        metadata: options.metadata || {}
      };

      const plaintext = Buffer.from(JSON.stringify(entry) + '\n', 'utf8');
      const encrypted = await this._encrypt(plaintext, options.key, 'log');

      // Check log size
      try {
        const stats = await fs.stat(logPath);
        if (stats.size > MAX_LOG_SIZE) {
          await this.rotateLog(logName);
        }
      } catch {}

      // Append to log
      await fs.appendFile(logPath, encrypted);

      return { success: true };
    } catch (error) {
      this.eventBus.emit(EventTypes.CORE_ERROR, {
        component: 'storage',
        action: 'append_log',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Read event log
   */
  async readLog(logName, options = {}) {
    const logPath = path.join(this.basePath, 'logs', `${logName}.log`);

    try {
      const data = await fs.readFile(logPath);
      
      // Parse entries (each entry is: 4-byte length + encrypted data)
      const events = [];
      let offset = 0;
      
      while (offset < data.length) {
        try {
          const entryLen = data.readUInt32BE(offset);
          offset += 4;
          
          const encrypted = data.slice(offset, offset + entryLen);
          offset += entryLen;
          
          const plaintext = await this._decrypt(encrypted, options.key, 'log');
          const entry = JSON.parse(plaintext.toString('utf8'));
          events.push(entry);
        } catch {
          // Skip malformed entries
          break;
        }
      }

      // Apply filters
      if (options.since) {
        const since = new Date(options.since);
        return events.filter(e => new Date(e.timestamp) >= since);
      }

      if (options.limit) {
        return events.slice(-options.limit);
      }

      return events;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Rotate log
   */
  async rotateLog(logName) {
    const logPath = path.join(this.basePath, 'logs', `${logName}.log`);
    const archivePath = path.join(
      this.basePath, 
      'logs', 
      `${logName}.${new Date().toISOString().replace(/[:.]/g, '-')}.log`
    );

    try {
      await fs.rename(logPath, archivePath);
      return { success: true, archivePath };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: true };
      }
      throw error;
    }
  }

  // ==========================================================================
  // ENCRYPTION
  // ==========================================================================

  /**
   * Encrypt data using HKDF-derived key
   */
  async _encrypt(plaintext, keyOverride = null, context = 'default') {
    const key = keyOverride || this.masterKey;

    if (!key) {
      throw new Error('No encryption key available');
    }

    const keyBuffer = typeof key === 'string' 
      ? Buffer.from(key, 'base64') 
      : key;

    // Generate nonce
    const nonce = randomBytes(NONCE_SIZE);

    // Derive encryption key using HKDF
    const derivedKey = deriveEncryptionKey(keyBuffer, nonce, `nzcore:storage:${context}`);

    // Encrypt using ChaCha20-Poly1305
    const cipher = createCipheriv('chacha20-poly1305', derivedKey, nonce, {
      authTagLength: TAG_SIZE
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final()
    ]);

    const tag = cipher.getAuthTag();

    // Wipe derived key from memory
    derivedKey.fill(0);

    // Return length + nonce + tag + ciphertext
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(NONCE_SIZE + TAG_SIZE + encrypted.length);
    
    return Buffer.concat([lenBuf, nonce, tag, encrypted]);
  }

  /**
   * Decrypt data using HKDF-derived key
   */
  async _decrypt(encrypted, keyOverride = null, context = 'default') {
    const key = keyOverride || this.masterKey;

    if (!key) {
      throw new Error('No decryption key available');
    }

    const keyBuffer = typeof key === 'string' 
      ? Buffer.from(key, 'base64') 
      : key;

    // Extract length
    const len = encrypted.readUInt32BE(0);
    
    // Extract components
    const nonce = encrypted.slice(4, 4 + NONCE_SIZE);
    const tag = encrypted.slice(4 + NONCE_SIZE, 4 + NONCE_SIZE + TAG_SIZE);
    const ciphertext = encrypted.slice(4 + NONCE_SIZE + TAG_SIZE);

    // Derive decryption key using HKDF
    const derivedKey = deriveEncryptionKey(keyBuffer, nonce, `nzcore:storage:${context}`);

    // Decrypt
    const decipher = createDecipheriv('chacha20-poly1305', derivedKey, nonce, {
      authTagLength: TAG_SIZE
    });

    decipher.setAuthTag(tag);

    try {
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]);

      return plaintext;
    } catch (error) {
      throw new Error('Decryption failed - invalid key or corrupted data');
    } finally {
      // Wipe derived key from memory
      derivedKey.fill(0);
    }
  }

  /**
   * Legacy decrypt for migration (SHA256(key || nonce) - deprecated)
   */
  async _decryptLegacy(encrypted, keyOverride = null) {
    const key = keyOverride || this.masterKey;

    if (!key) {
      throw new Error('No decryption key available');
    }

    const keyBuffer = typeof key === 'string' 
      ? Buffer.from(key, 'base64') 
      : key;

    // Extract components
    const nonce = encrypted.slice(0, NONCE_SIZE);
    const tag = encrypted.slice(NONCE_SIZE, NONCE_SIZE + TAG_SIZE);
    const ciphertext = encrypted.slice(NONCE_SIZE + TAG_SIZE);

    // Legacy derivation (insecure)
    const derivedKey = createHash('sha256')
      .update(keyBuffer)
      .update(nonce)
      .digest();

    const decipher = createDecipheriv('chacha20-poly1305', derivedKey, nonce, {
      authTagLength: TAG_SIZE
    });

    decipher.setAuthTag(tag);

    try {
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]);
    } catch (error) {
      throw new Error('Legacy decryption failed');
    } finally {
      derivedKey.fill(0);
    }
  }

  /**
   * Hash key for filename
   */
  _hashKey(key) {
    return createHash('sha256')
      .update(key)
      .digest('hex')
      .slice(0, 32);
  }

  // ==========================================================================
  // CACHE
  // ==========================================================================

  _cacheSet(key, value) {
    if (this.cache.size >= this.cacheMaxSize) {
      // Remove oldest entries
      const keys = [...this.cache.keys()].slice(0, Math.floor(this.cacheMaxSize / 2));
      for (const k of keys) {
        this.cache.delete(k);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  _cacheGet(key) {
    const cached = this.cache.get(key);
    return cached?.value;
  }

  _cacheDelete(key) {
    this.cache.delete(key);
  }

  clearCache() {
    this.cache.clear();
  }

  // ==========================================================================
  // STATUS
  // ==========================================================================

  async getStatus() {
    const files = await this.listFiles();

    return {
      basePath: this.basePath,
      cacheSize: this.cache.size,
      cacheEnabled: this.cacheEnabled,
      fileCount: files.length,
      masterKeySet: !!this.masterKey,
      version: 2, // Encryption version
      keyDerivation: 'HKDF-SHA256'
    };
  }
}

// ============================================================================
// SECURE KV STORE
// ============================================================================

export class SecureKVStore {
  constructor(options = {}) {
    this.storage = options.storage || new SecureStorage(options);
    this.namespace = options.namespace || 'default';
    this.cache = new Map();
  }

  async init() {
    return this.storage.init();
  }

  async get(key) {
    const namespacedKey = `${this.namespace}:${key}`;
    return this.storage.get(namespacedKey);
  }

  async set(key, value, options = {}) {
    const namespacedKey = `${this.namespace}:${key}`;
    return this.storage.set(namespacedKey, value, options);
  }

  async delete(key) {
    const namespacedKey = `${this.namespace}:${key}`;
    return this.storage.delete(namespacedKey);
  }

  async has(key) {
    const namespacedKey = `${this.namespace}:${key}`;
    return this.storage.has(namespacedKey);
  }

  async clear() {
    this.cache.clear();
    return { success: true };
  }
}

// ============================================================================
// SECURE LOG
// ============================================================================

export class SecureLog {
  constructor(options = {}) {
    this.storage = options.storage || new SecureStorage(options);
    this.logName = options.logName || 'events';
    this.maxEntries = options.maxEntries || 10000;
    this.maxSize = options.maxSize || MAX_LOG_SIZE;
  }

  async init() {
    return this.storage.init();
  }

  async append(event, metadata = {}) {
    return this.storage.appendLog(this.logName, event, { metadata });
  }

  async read(options = {}) {
    return this.storage.readLog(this.logName, options);
  }

  async rotate() {
    return this.storage.rotateLog(this.logName);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

let globalStorage = null;

export function getSecureStorage(options = {}) {
  if (!globalStorage) {
    globalStorage = new SecureStorage(options);
  }
  return globalStorage;
}

export function createSecureStorage(options = {}) {
  return new SecureStorage(options);
}
