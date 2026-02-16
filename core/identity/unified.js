// Module: Unified Identity Layer
// Description: Consolidated identity management with unified signing API,
//              ECDH API, and identity export/import functionality.
// File: core/identity/unified.js

import { EventTypes, getEventBus } from '../eventbus/index.js';

// ============================================================================
// IDENTITY CLASS
// ============================================================================

export class Identity {
  constructor(options = {}) {
    this.eventBus = getEventBus();
    
    // Ed25519 signing key
    this.ed25519 = {
      private: options.ed25519?.private || null,
      public: options.ed25519?.public || null
    };
    
    // X25519 ECDH key
    this.x25519 = {
      private: options.x25519?.private || null,
      public: options.x25519?.public || null
    };
    
    // Master key
    this.masterKey = options.masterKey || null;
    
    // Seed phrase (BIP-39)
    this.seedPhrase = options.seedPhrase || null;
    
    // Metadata
    this.createdAt = options.createdAt || new Date().toISOString();
    this.version = options.version || '1.0';
    
    // Node ID (derived from Ed25519 public key)
    this.nodeId = this.ed25519.public ? this._deriveNodeId(this.ed25519.public) : null;
  }
  
  // =========================================================================
  // NODE ID
  // =========================================================================
  
  getNodeId() {
    return this.nodeId;
  }
  
  _deriveNodeId(publicKey) {
    if (!publicKey) return null;
    if (Buffer.isBuffer(publicKey)) {
      return publicKey.toString('base64');
    }
    return publicKey;
  }
  
  // =========================================================================
  // SIGNING API (Ed25519)
  // =========================================================================
  
  async sign(data) {
    if (!this.ed25519.private) {
      throw new Error('No Ed25519 private key available');
    }
    
    const sign = await import('../crypto/sign.js');
    const dataBytes = this._toBytes(data);
    
    const privateKey = this._keyToBytes(this.ed25519.private);
    const signature = sign.sign(dataBytes, privateKey);
    
    return {
      data: data,
      signature: this._toBase64(signature),
      publicKey: this.ed25519.public,
      algorithm: 'Ed25519',
      timestamp: new Date().toISOString()
    };
  }
  
  async verify(data, signature, publicKey = null) {
    const sign = await import('../crypto/sign.js');
    
    const dataBytes = this._toBytes(data);
    const sigBytes = this._keyToBytes(signature);
    const pubKey = this._keyToBytes(publicKey || this.ed25519.public);
    
    return sign.verify(dataBytes, sigBytes, pubKey);
  }
  
  // =========================================================================
  // ECDH API (X25519)
  // =========================================================================
  
  async deriveSharedKey(theirPublicKey) {
    if (!this.x25519.private) {
      throw new Error('No X25519 private key available');
    }
    
    const box = await import('../crypto/box.js');
    
    const myPrivateKey = this._keyToBytes(this.x25519.private);
    const theirPubKey = this._keyToBytes(theirPublicKey);
    
    const sharedSecret = box.before(theirPubKey, myPrivateKey);
    
    return {
      sharedKey: this._toBase64(sharedSecret),
      algorithm: 'X25519-ChaCha20-Poly1305'
    };
  }
  
  async encrypt(data, theirPublicKey, options = {}) {
    const box = await import('../crypto/box.js');
    
    const theirPubKey = this._keyToBytes(theirPublicKey);
    const myPrivateKey = this._keyToBytes(this.x25519.private);
    const dataBytes = this._toBytes(data);
    
    const nonce = options.nonce || box.generateNonce();
    const encrypted = box.seal(dataBytes, nonce, theirPubKey, myPrivateKey);
    
    return {
      ciphertext: this._toBase64(encrypted),
      nonce: this._toBase64(nonce),
      algorithm: 'X25519-ChaCha20-Poly1305',
      timestamp: new Date().toISOString()
    };
  }
  
  async decrypt(ciphertext, nonce, theirPublicKey) {
    const box = await import('../crypto/box.js');
    
    const theirPubKey = this._keyToBytes(theirPublicKey);
    const myPrivateKey = this._keyToBytes(this.x25519.private);
    const cipherBytes = this._keyToBytes(ciphertext);
    const nonceBytes = this._keyToBytes(nonce);
    
    const decrypted = box.open(cipherBytes, nonceBytes, theirPubKey, myPrivateKey);
    
    if (!decrypted) {
      throw new Error('Decryption failed - invalid ciphertext or key');
    }
    
    return Buffer.from(decrypted);
  }
  
  // =========================================================================
  // EXPORT/IMPORT
  // =========================================================================
  
  export(options = {}) {
    const includePrivate = options.includePrivate || false;
    
    const exported = {
      version: this.version,
      createdAt: this.createdAt,
      exportedAt: new Date().toISOString(),
      nodeId: this.nodeId,
      
      ed25519: {
        publicKey: this.ed25519.public,
        privateKey: includePrivate ? this.ed25519.private : undefined
      },
      
      x25519: {
        publicKey: this.x25519.public,
        privateKey: includePrivate ? this.x25519.private : undefined
      },
      
      seedPhrase: includePrivate ? this.seedPhrase : undefined
    };
    
    this.eventBus.emit(EventTypes.IDENTITY_EXPORTED, {
      nodeId: this.nodeId,
      includePrivate
    });
    
    return exported;
  }
  
  static fromExported(data) {
    const identity = new Identity({
      ed25519: {
        public: data.ed25519?.publicKey,
        private: data.ed25519?.privateKey
      },
      x25519: {
        public: data.x25519?.publicKey,
        private: data.x25519?.privateKey
      },
      seedPhrase: data.seedPhrase,
      version: data.version,
      createdAt: data.createdAt
    });
    
    identity.eventBus.emit(EventTypes.IDENTITY_IMPORTED, {
      nodeId: identity.nodeId
    });
    
    return identity;
  }
  
  async exportToFile(filepath, includePrivate = false) {
    const fs = await import('fs/promises');
    const data = this.export(includePrivate);
    await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    return filepath;
  }
  
  static async importFromFile(filepath) {
    const fs = await import('fs/promises');
    const data = JSON.parse(await fs.readFile(filepath, 'utf8'));
    return Identity.fromExported(data);
  }
  
  // =========================================================================
  // SERIALIZATION
  // =========================================================================
  
  toJSON() {
    return this.export({ includePrivate: false });
  }
  
  toSecureJSON() {
    return this.export({ includePrivate: true });
  }
  
  // =========================================================================
  // HELPERS
  // =========================================================================
  
  _toBytes(data) {
    if (Buffer.isBuffer(data)) return data;
    if (typeof data === 'string') return Buffer.from(data, 'utf8');
    return Buffer.from(JSON.stringify(data), 'utf8');
  }
  
  _toBase64(data) {
    if (typeof data === 'string') return data;
    return Buffer.from(data).toString('base64');
  }
  
  _keyToBytes(key) {
    if (!key) return null;
    if (Buffer.isBuffer(key)) return key;
    return Buffer.from(key, 'base64');
  }
}

// ============================================================================
// IDENTITY MANAGER
// ============================================================================

export class IdentityManager {
  constructor(envPath) {
    this.envPath = envPath;
    this.identity = null;
    this.eventBus = getEventBus();
  }
  
  async load() {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const identityPath = path.join(this.envPath, 'keys', 'identity.json');
    const ecdhPath = path.join(this.envPath, 'keys', 'ecdh.json');
    const seedPath = path.join(this.envPath, 'seed.txt');
    
    let identity = null;
    let ecdh = null;
    let seedPhrase = null;
    
    try {
      identity = JSON.parse(await fs.readFile(identityPath, 'utf8'));
    } catch {}
    
    try {
      ecdh = JSON.parse(await fs.readFile(ecdhPath, 'utf8'));
    } catch {}
    
    try {
      seedPhrase = (await fs.readFile(seedPath, 'utf8')).trim();
    } catch {}
    
    this.identity = new Identity({
      ed25519: identity,
      x25519: ecdh,
      seedPhrase
    });
    
    return this.identity;
  }
  
  getIdentity() {
    return this.identity;
  }
  
  getNodeId() {
    return this.identity?.getNodeId() || null;
  }
  
  getPublicKeys() {
    if (!this.identity) return null;
    
    return {
      ed25519: this.identity.ed25519.public,
      x25519: this.identity.x25519.public
    };
  }
  
  async sign(data) {
    if (!this.identity) {
      throw new Error('Identity not loaded');
    }
    return this.identity.sign(data);
  }
  
  async encrypt(data, theirPublicKey) {
    if (!this.identity) {
      throw new Error('Identity not loaded');
    }
    return this.identity.encrypt(data, theirPublicKey);
  }
  
  async decrypt(ciphertext, nonce, theirPublicKey) {
    if (!this.identity) {
      throw new Error('Identity not loaded');
    }
    return this.identity.decrypt(ciphertext, nonce, theirPublicKey);
  }
}

export default Identity;
