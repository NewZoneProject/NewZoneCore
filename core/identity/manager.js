// Module: Multi-Identity Support
// Description: Identity profiles and switching for NewZoneCore.
//              Allows multiple identities on single node.
// File: core/identity/manager.js

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';

// ============================================================================
// IDENTITY PROFILE
// ============================================================================

export class IdentityProfile {
  constructor(id, options = {}) {
    this.id = id;
    this.name = options.name || `Profile ${id.substring(0, 8)}`;
    this.description = options.description || '';
    this.createdAt = options.createdAt || new Date().toISOString();
    this.updatedAt = options.updatedAt || new Date().toISOString();
    this.lastUsedAt = options.lastUsedAt || null;
    this.active = options.active !== false;
    this.default = options.default || false;

    // Identity keys
    this.ed25519Public = options.ed25519Public || null;
    this.ed25519Secret = options.ed25519Secret || null; // Encrypted
    this.x25519Public = options.x25519Public || null;
    this.x25519Secret = options.x25519Secret || null; // Encrypted

    // Derivation path
    this.derivationPath = options.derivationPath || `m/44'/0'/0'/${options.index || 0}`;

    // Metadata
    this.metadata = options.metadata || {};
    this.tags = options.tags || [];
  }

  /**
   * Get node ID from ed25519 public key.
   */
  getNodeId() {
    if (!this.ed25519Public) {
      return null;
    }
    // Node ID is hash of public key
    const { createHash } = require('crypto');
    return createHash('blake2b512')
      .update(this.ed25519Public, 'base64')
      .digest('hex')
      .substring(0, 64);
  }

  /**
   * Serialize profile to JSON.
   */
  toJSON(includeSecrets = false) {
    const data = {
      id: this.id,
      name: this.name,
      description: this.description,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastUsedAt: this.lastUsedAt,
      active: this.active,
      default: this.default,
      ed25519Public: this.ed25519Public,
      x25519Public: this.x25519Public,
      derivationPath: this.derivationPath,
      metadata: this.metadata,
      tags: this.tags,
      nodeId: this.getNodeId()
    };

    if (includeSecrets) {
      data.ed25519Secret = this.ed25519Secret;
      data.x25519Secret = this.x25519Secret;
    }

    return data;
  }
}

// ============================================================================
// IDENTITY MANAGER
// ============================================================================

export class IdentityManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.basePath = options.basePath || './env/identities';
    this.masterKey = options.masterKey || null;
    this.profiles = new Map();
    this.activeProfileId = null;
    this.currentIdentity = null;
  }

  /**
   * Initialize identity manager.
   */
  async init() {
    await fs.mkdir(this.basePath, { recursive: true });
    await this._loadProfiles();
    console.log('[identity] Identity manager initialized');
    return this;
  }

  /**
   * Load all profiles.
   */
  async _loadProfiles() {
    try {
      const files = await fs.readdir(this.basePath);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.basePath, file);
          const data = await fs.readFile(filePath, 'utf-8');
          const profile = new IdentityProfile(file.replace('.json', ''), JSON.parse(data));
          this.profiles.set(profile.id, profile);

          if (profile.default && !this.activeProfileId) {
            this.activeProfileId = profile.id;
          }
        }
      }

      // If no default, use first active profile
      if (!this.activeProfileId && this.profiles.size > 0) {
        const activeProfile = Array.from(this.profiles.values()).find(p => p.active);
        if (activeProfile) {
          this.activeProfileId = activeProfile.id;
        }
      }

      this.emit('profiles:loaded', { count: this.profiles.size });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[identity] Failed to load profiles:', error.message);
      }
    }
  }

  /**
   * Save profile.
   */
  async _saveProfile(profile) {
    const filePath = path.join(this.basePath, `${profile.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(profile.toJSON(false), null, 2), 'utf-8');
  }

  /**
   * Create new identity profile.
   */
  async createProfile(options = {}) {
    const id = randomBytes(16).toString('hex');
    const profile = new IdentityProfile(id, {
      ...options,
      index: this.profiles.size
    });

    // Generate identity keys
    const { generateIdentityKeys } = await import('../crypto/keys.js');
    const keys = await generateIdentityKeys();

    profile.ed25519Public = keys.ed25519.public.toString('base64');
    profile.ed25519Secret = keys.ed25519.secret.toString('base64'); // Should be encrypted
    profile.x25519Public = keys.x25519.public.toString('base64');
    profile.x25519Secret = keys.x25519.secret.toString('base64'); // Should be encrypted

    // Encrypt secrets if master key available
    if (this.masterKey) {
      const { chacha20poly1305 } = await import('../libs/chacha20poly1305.js');
      const nonce = randomBytes(12);
      profile.ed25519Secret = chacha20poly1305.encrypt(
        this.masterKey,
        nonce,
        Buffer.from(profile.ed25519Secret, 'base64')
      ).toString('base64');
      // Store nonce with encrypted data
      profile.ed25519Secret = `${nonce.toString('base64')}:${profile.ed25519Secret}`;
    }

    this.profiles.set(profile.id, profile);
    await this._saveProfile(profile);

    this.emit('profile:created', { profile });
    console.log(`[identity] Created profile: ${profile.name}`);

    return profile;
  }

  /**
   * Get profile by ID.
   */
  getProfile(profileId) {
    return this.profiles.get(profileId);
  }

  /**
   * List all profiles.
   */
  listProfiles() {
    return Array.from(this.profiles.values()).map(p => p.toJSON(false));
  }

  /**
   * Set active profile.
   */
  async setActiveProfile(profileId) {
    const profile = this.profiles.get(profileId);

    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    if (!profile.active) {
      throw new Error(`Profile is not active: ${profileId}`);
    }

    // Update last used
    const oldProfileId = this.activeProfileId;
    this.activeProfileId = profileId;
    profile.lastUsedAt = new Date().toISOString();
    profile.updatedAt = new Date().toISOString();

    // Update default
    if (oldProfileId) {
      const oldProfile = this.profiles.get(oldProfileId);
      if (oldProfile) {
        oldProfile.default = false;
        await this._saveProfile(oldProfile);
      }
    }
    profile.default = true;
    await this._saveProfile(profile);

    // Load identity
    await this._loadIdentity(profile);

    this.emit('profile:switched', { profile, oldProfileId });
    console.log(`[identity] Switched to profile: ${profile.name}`);

    return profile;
  }

  /**
   * Load identity from profile.
   */
  async _loadIdentity(profile) {
    let ed25519Secret = profile.ed25519Secret;
    let x25519Secret = profile.x25519Secret;

    // Decrypt secrets if master key available
    if (this.masterKey && ed25519Secret?.includes(':')) {
      const { chacha20poly1305 } = await import('../libs/chacha20poly1305.js');
      const [nonceBase64, encryptedBase64] = ed25519Secret.split(':');
      const nonce = Buffer.from(nonceBase64, 'base64');
      const encrypted = Buffer.from(encryptedBase64, 'base64');
      const decrypted = chacha20poly1305.decrypt(this.masterKey, nonce, encrypted);
      ed25519Secret = decrypted.toString('base64');

      if (x25519Secret?.includes(':')) {
        const [nonceBase64, encryptedBase64] = x25519Secret.split(':');
        const nonce = Buffer.from(nonceBase64, 'base64');
        const encrypted = Buffer.from(encryptedBase64, 'base64');
        const decrypted = chacha20poly1305.decrypt(this.masterKey, nonce, encrypted);
        x25519Secret = decrypted.toString('base64');
      }
    }

    this.currentIdentity = {
      nodeId: profile.getNodeId(),
      ed25519: {
        publicKey: Buffer.from(profile.ed25519Public, 'base64'),
        secretKey: Buffer.from(ed25519Secret, 'base64')
      },
      x25519: {
        publicKey: Buffer.from(profile.x25519Public, 'base64'),
        secretKey: Buffer.from(x25519Secret, 'base64')
      },
      profileId: profile.id
    };

    this.emit('identity:loaded', { identity: this.currentIdentity });
  }

  /**
   * Get current identity.
   */
  getCurrentIdentity() {
    return this.currentIdentity;
  }

  /**
   * Get current profile.
   */
  getCurrentProfile() {
    if (!this.activeProfileId) {
      return null;
    }
    return this.profiles.get(this.activeProfileId);
  }

  /**
   * Update profile.
   */
  async updateProfile(profileId, updates) {
    const profile = this.profiles.get(profileId);

    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    Object.assign(profile, updates);
    profile.updatedAt = new Date().toISOString();

    await this._saveProfile(profile);
    this.emit('profile:updated', { profile });

    return profile;
  }

  /**
   * Delete profile.
   */
  async deleteProfile(profileId) {
    const profile = this.profiles.get(profileId);

    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    if (profile.default) {
      throw new Error('Cannot delete default profile');
    }

    const filePath = path.join(this.basePath, `${profileId}.json`);
    await fs.unlink(filePath);

    this.profiles.delete(profileId);
    this.emit('profile:deleted', { profileId });

    console.log(`[identity] Deleted profile: ${profileId}`);
  }

  /**
   * Export profile.
   */
  async exportProfile(profileId, password) {
    const profile = this.profiles.get(profileId);

    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    // Derive key from password
    const { scrypt } = await import('crypto');
    const salt = randomBytes(16);
    const key = scrypt(password, salt, 32);

    // Encrypt secrets
    const { chacha20poly1305 } = await import('../libs/chacha20poly1305.js');
    const nonce = randomBytes(12);

    const exportData = {
      version: '1.0',
      profile: profile.toJSON(true), // Include secrets
      encrypted: true,
      kdf: 'scrypt',
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64')
    };

    const plaintext = Buffer.from(JSON.stringify(exportData), 'utf-8');
    const ciphertext = chacha20poly1305.encrypt(key, nonce, plaintext);

    return {
      version: '1.0',
      ciphertext: ciphertext.toString('base64'),
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64')
    };
  }

  /**
   * Import profile.
   */
  async importProfile(exportData, password) {
    const { chacha20poly1305 } = await import('../libs/chacha20poly1305.js');
    const { scrypt } = await import('crypto');

    const salt = Buffer.from(exportData.salt, 'base64');
    const nonce = Buffer.from(exportData.nonce, 'base64');
    const ciphertext = Buffer.from(exportData.ciphertext, 'base64');

    // Derive key from password
    const key = scrypt(password, salt, 32);

    // Decrypt
    const plaintext = chacha20poly1305.decrypt(key, nonce, ciphertext);
    const data = JSON.parse(plaintext.toString('utf-8'));

    // Create profile
    const profile = new IdentityProfile(data.profile.id, data.profile);
    this.profiles.set(profile.id, profile);
    await this._saveProfile(profile);

    this.emit('profile:imported', { profile });
    console.log(`[identity] Imported profile: ${profile.name}`);

    return profile;
  }

  /**
   * Get status.
   */
  getStatus() {
    const currentProfile = this.getCurrentProfile();

    return {
      totalProfiles: this.profiles.size,
      activeProfileId: this.activeProfileId,
      currentProfile: currentProfile ? currentProfile.toJSON(false) : null,
      currentIdentity: this.currentIdentity ? {
        nodeId: this.currentIdentity.nodeId,
        profileId: this.currentIdentity.profileId
      } : null
    };
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalIdentityManager = null;

export async function getIdentityManager(options = {}) {
  if (!globalIdentityManager) {
    globalIdentityManager = new IdentityManager(options);
    await globalIdentityManager.init();
  }
  return globalIdentityManager;
}

export function createIdentityManager(options = {}) {
  return new IdentityManager(options);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  IdentityProfile,
  IdentityManager,
  getIdentityManager,
  createIdentityManager
};
