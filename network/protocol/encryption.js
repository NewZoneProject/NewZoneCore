// Module: Channel Encryption
// Description: Encryption for secure channel communication.
// File: network/protocol/encryption.js

import crypto from 'crypto';

/**
 * Encryption Algorithm
 */
export const EncryptionAlgorithm = {
  CHACHA20_POLY1305: 'chacha20-poly1305',
  AES_256_GCM: 'aes-256-gcm'
};

/**
 * Key Derivation
 */
export const KDFAlgorithm = {
  HKDF_SHA256: 'hkdf-sha256',
  HKDF_SHA512: 'hkdf-sha512'
};

/**
 * Nonce Size (bytes)
 */
export const NONCE_SIZE = 12;

/**
 * Key Size (bytes)
 */
export const KEY_SIZE = 32;

/**
 * Tag Size (bytes) - for AEAD
 */
export const TAG_SIZE = 16;

/**
 * Default Encryption Options
 */
const DEFAULT_OPTIONS = {
  algorithm: EncryptionAlgorithm.AES_256_GCM,
  kdf: KDFAlgorithm.HKDF_SHA256,
  nonceSize: NONCE_SIZE,
  keySize: KEY_SIZE,
  tagSize: TAG_SIZE,
  rotationInterval: 3600000 // Rotate keys every hour
};

/**
 * ChannelEncryptor class - handles channel encryption
 */
export class ChannelEncryptor {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Keys
    this._encryptKey = null;
    this._decryptKey = null;
    
    // Nonce counters
    this._encryptNonce = Buffer.alloc(this.options.nonceSize, 0);
    this._decryptNonce = Buffer.alloc(this.options.nonceSize, 0);
    
    // Key rotation
    this._keyRotationTimer = null;
    this._keyCreatedAt = null;
    
    // State
    this._isInitialized = false;
  }

  /**
   * Check if initialized
   */
  get isInitialized() {
    return this._isInitialized;
  }

  /**
   * Initialize with session key
   */
  init(sessionKey, options = {}) {
    // Derive separate keys for encryption and decryption
    const direction = options.isInitiator ? 'initiator' : 'responder';
    
    if (options.isInitiator) {
      this._encryptKey = this._deriveKey(sessionKey, 'encrypt-' + direction);
      this._decryptKey = this._deriveKey(sessionKey, 'decrypt-' + direction);
    } else {
      this._encryptKey = this._deriveKey(sessionKey, 'decrypt-' + direction);
      this._decryptKey = this._deriveKey(sessionKey, 'encrypt-' + direction);
    }
    
    // Reset nonces
    this._encryptNonce = Buffer.alloc(this.options.nonceSize, 0);
    this._decryptNonce = Buffer.alloc(this.options.nonceSize, 0);
    
    this._keyCreatedAt = Date.now();
    this._isInitialized = true;
    
    // Start key rotation if enabled
    if (this.options.rotationInterval > 0) {
      this._startKeyRotation(sessionKey, direction);
    }
  }

  /**
   * Encrypt data
   */
  encrypt(plaintext) {
    if (!this._isInitialized) {
      throw new Error('Encryptor not initialized');
    }
    
    const nonce = this._getNextEncryptNonce();
    
    if (this.options.algorithm === EncryptionAlgorithm.AES_256_GCM) {
      return this._encryptAESGCM(plaintext, nonce);
    } else {
      // Fallback to simple XOR for environments without native ChaCha20
      return this._encryptSimple(plaintext, nonce);
    }
  }

  /**
   * Decrypt data
   */
  decrypt(ciphertext) {
    if (!this._isInitialized) {
      throw new Error('Encryptor not initialized');
    }
    
    // Extract nonce from ciphertext (first 12 bytes)
    const nonce = ciphertext.slice(0, this.options.nonceSize);
    const data = ciphertext.slice(this.options.nonceSize);
    
    // Update decrypt nonce
    nonce.copy(this._decryptNonce);
    
    if (this.options.algorithm === EncryptionAlgorithm.AES_256_GCM) {
      return this._decryptAESGCM(data, nonce);
    } else {
      return this._decryptSimple(data, nonce);
    }
  }

  /**
   * Encrypt with AES-256-GCM
   */
  _encryptAESGCM(plaintext, nonce) {
    const iv = nonce.slice(0, 12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._encryptKey, iv, {
      authTagLength: this.options.tagSize
    });
    
    const encrypted = Buffer.concat([
      cipher.update(plaintext),
      cipher.final()
    ]);
    
    const tag = cipher.getAuthTag();
    
    return Buffer.concat([nonce, encrypted, tag]);
  }

  /**
   * Decrypt with AES-256-GCM
   */
  _decryptAESGCM(ciphertext, nonce) {
    // Split ciphertext and tag
    const tag = ciphertext.slice(-this.options.tagSize);
    const encrypted = ciphertext.slice(0, -this.options.tagSize);
    
    const iv = nonce.slice(0, 12);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this._decryptKey, iv, {
      authTagLength: this.options.tagSize
    });
    
    decipher.setAuthTag(tag);
    
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
  }

  /**
   * Simple encryption fallback (XOR with keystream)
   */
  _encryptSimple(plaintext, nonce) {
    const keystream = this._generateKeystream(this._encryptKey, nonce, plaintext.length);
    const encrypted = Buffer.alloc(plaintext.length);
    
    for (let i = 0; i < plaintext.length; i++) {
      encrypted[i] = plaintext[i] ^ keystream[i];
    }
    
    return Buffer.concat([nonce, encrypted]);
  }

  /**
   * Simple decryption fallback
   */
  _decryptSimple(ciphertext, nonce) {
    const keystream = this._generateKeystream(this._decryptKey, nonce, ciphertext.length);
    const decrypted = Buffer.alloc(ciphertext.length);
    
    for (let i = 0; i < ciphertext.length; i++) {
      decrypted[i] = ciphertext[i] ^ keystream[i];
    }
    
    return decrypted;
  }

  /**
   * Generate keystream (simplified)
   */
  _generateKeystream(key, nonce, length) {
    const keystream = Buffer.alloc(length);
    const counter = Buffer.alloc(4);
    
    let offset = 0;
    let blockCount = 0;
    
    while (offset < length) {
      // Create block input
      const input = Buffer.concat([nonce, counter]);
      const block = crypto.createHmac('sha256', key).update(input).digest();
      
      const copyLength = Math.min(32, length - offset);
      block.copy(keystream, offset, 0, copyLength);
      
      offset += copyLength;
      blockCount++;
      counter.writeUInt32BE(blockCount);
    }
    
    return keystream;
  }

  /**
   * Derive key using HKDF
   */
  _deriveKey(masterKey, info) {
    const salt = Buffer.alloc(32, 0); // Zero salt
    
    // Simplified HKDF
    const prk = crypto.createHmac('sha256', salt).update(masterKey).digest();
    const okm = crypto.createHmac('sha256', prk)
      .update(Buffer.from(info))
      .update(Buffer.from([1]))
      .digest();
    
    return okm;
  }

  /**
   * Get next encrypt nonce
   */
  _getNextEncryptNonce() {
    const nonce = Buffer.from(this._encryptNonce);
    this._incrementNonce(this._encryptNonce);
    return nonce;
  }

  /**
   * Increment nonce
   */
  _incrementNonce(nonce) {
    for (let i = nonce.length - 1; i >= 0; i--) {
      nonce[i]++;
      if (nonce[i] !== 0) break;
    }
  }

  /**
   * Start key rotation
   */
  _startKeyRotation(masterKey, direction) {
    this._keyRotationTimer = setInterval(() => {
      // Re-derive keys with timestamp
      const timestamp = Date.now().toString();
      const newMasterKey = crypto.createHash('sha256')
        .update(masterKey)
        .update(timestamp)
        .digest();
      
      this.init(newMasterKey, { isInitiator: direction === 'initiator' });
    }, this.options.rotationInterval);
  }

  /**
   * Stop key rotation
   */
  stopKeyRotation() {
    if (this._keyRotationTimer) {
      clearInterval(this._keyRotationTimer);
      this._keyRotationTimer = null;
    }
  }

  /**
   * Get encryption stats
   */
  getStats() {
    return {
      isInitialized: this._isInitialized,
      algorithm: this.options.algorithm,
      keySize: this.options.keySize,
      keyAge: this._keyCreatedAt ? Date.now() - this._keyCreatedAt : 0,
      rotationEnabled: this._keyRotationTimer !== null
    };
  }

  /**
   * Clean up
   */
  destroy() {
    this.stopKeyRotation();
    
    // Secure wipe keys
    if (this._encryptKey) {
      this._encryptKey.fill(0);
      this._encryptKey = null;
    }
    if (this._decryptKey) {
      this._decryptKey.fill(0);
      this._decryptKey = null;
    }
    
    this._isInitialized = false;
  }
}

/**
 * Create encrypted message
 */
export function createEncryptedMessage(encryptor, payload) {
  return encryptor.encrypt(payload);
}

/**
 * Decrypt message
 */
export function decryptMessage(encryptor, ciphertext) {
  return encryptor.decrypt(ciphertext);
}

export default ChannelEncryptor;
