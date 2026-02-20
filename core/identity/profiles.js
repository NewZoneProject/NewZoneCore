// Module: Identity Profiles
// Description: Multi-identity support for NewZoneCore.
//              Allows multiple identity profiles per node with isolation.
// File: core/identity/profiles.js

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getEventBus, EventTypes } from '../eventbus/index.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const PROFILES_DIR = 'profiles';
const ACTIVE_PROFILE_FILE = 'active-profile.json';

// ============================================================================
// IDENTITY PROFILE
// ============================================================================

export class IdentityProfile {
  constructor(options = {}) {
    this.id = options.id || crypto.randomBytes(16).toString('hex');
    this.name = options.name || 'Default';
    this.description = options.description || '';
    this.createdAt = options.createdAt || new Date().toISOString();
    this.updatedAt = options.updatedAt || new Date().toISOString();
    this.isActive = options.isActive || false;
    
    // Identity keys (encrypted)
    this.ed25519 = options.ed25519 || null;
    this.x25519 = options.x25519 || null;
    
    // Profile-specific settings
    this.settings = options.settings || {};
    
    // Metadata
    this.metadata = options.metadata || {};
  }
  
  /**
   * Get public identity info (without private keys).
   */
  getPublicInfo() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      isActive: this.isActive,
      ed25519Public: this.ed25519?.public || null,
      x25519Public: this.x25519?.public || null,
      metadata: this.metadata
    };
  }
  
  /**
   * Serialize profile to JSON.
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      isActive: this.isActive,
      ed25519: this.ed25519,
      x25519: this.x25519,
      settings: this.settings,
      metadata: this.metadata
    };
  }
  
  /**
   * Deserialize profile from JSON.
   */
  static fromJSON(data) {
    return new IdentityProfile(data);
  }
}

// ============================================================================
// PROFILE MANAGER
// ============================================================================

export class ProfileManager {
  constructor(options = {}) {
    this.basePath = options.basePath || './env';
    this.profilesPath = path.join(this.basePath, PROFILES_DIR);
    this.eventBus = getEventBus();
    
    this.profiles = new Map(); // id -> IdentityProfile
    this.activeProfileId = null;
  }
  
  /**
   * Initialize profile manager.
   */
  async init() {
    await fs.mkdir(this.profilesPath, { recursive: true });
    await this._loadProfiles();
    await this._loadActiveProfile();
    
    this.eventBus.emit(EventTypes.SYSTEM_INFO, {
      component: 'identity',
      action: 'profiles_initialized',
      count: this.profiles.size
    });
    
    return this;
  }
  
  /**
   * Create a new profile.
   */
  async createProfile(options = {}) {
    const profile = new IdentityProfile(options);
    
    // Generate keys if not provided
    if (!profile.ed25519 && options.generateKeys) {
      const { generateKeyPair } = await import('../crypto/box.js');
      const { getPublicKey } = await import('../crypto/sign.js');
      const { deriveSubKey } = await import('../crypto/derive.js');
      
      // Generate seed
      const seed = crypto.randomBytes(32);
      
      // Derive Ed25519 key
      const identitySeed = deriveSubKey(seed, 'identity', 32);
      profile.ed25519 = {
        private: identitySeed.toString('base64'),
        public: getPublicKey(identitySeed).toString('base64')
      };
      
      // Derive X25519 key
      const ecdhSeed = deriveSubKey(seed, 'ecdh', 32);
      const ecdhKeys = generateKeyPair(ecdhSeed);
      profile.x25519 = {
        private: ecdhKeys.privateKey.toString('base64'),
        public: ecdhKeys.publicKey.toString('base64')
      };
    }
    
    this.profiles.set(profile.id, profile);
    await this._saveProfile(profile);
    
    this.eventBus.emit(EventTypes.IDENTITY_CREATED, {
      profileId: profile.id,
      name: profile.name
    });
    
    return profile;
  }
  
  /**
   * Get profile by ID.
   */
  getProfile(profileId) {
    return this.profiles.get(profileId);
  }
  
  /**
   * Get active profile.
   */
  getActiveProfile() {
    if (!this.activeProfileId) {
      return null;
    }
    return this.profiles.get(this.activeProfileId);
  }
  
  /**
   * List all profiles.
   */
  listProfiles() {
    const list = [];
    for (const profile of this.profiles.values()) {
      list.push(profile.getPublicInfo());
    }
    return list;
  }
  
  /**
   * Update profile.
   */
  async updateProfile(profileId, updates) {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    
    // Update fields
    if (updates.name) profile.name = updates.name;
    if (updates.description) profile.description = updates.description;
    if (updates.settings) profile.settings = { ...profile.settings, ...updates.settings };
    if (updates.metadata) profile.metadata = { ...profile.metadata, ...updates.metadata };
    
    profile.updatedAt = new Date().toISOString();
    
    await this._saveProfile(profile);
    
    this.eventBus.emit(EventTypes.IDENTITY_UPDATED, {
      profileId: profile.id
    });
    
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
    
    // Cannot delete active profile
    if (profile.isActive) {
      throw new Error('Cannot delete active profile');
    }
    
    // Delete profile file
    const profileFile = path.join(this.profilesPath, `${profileId}.json`);
    await fs.unlink(profileFile);
    
    this.profiles.delete(profileId);
    
    this.eventBus.emit(EventTypes.IDENTITY_DELETED, {
      profileId: profile.id
    });
    
    return true;
  }
  
  /**
   * Switch to a different profile.
   */
  async switchProfile(profileId) {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    
    // Deactivate current active profile
    if (this.activeProfileId) {
      const currentProfile = this.profiles.get(this.activeProfileId);
      if (currentProfile) {
        currentProfile.isActive = false;
        await this._saveProfile(currentProfile);
      }
    }
    
    // Activate new profile
    profile.isActive = true;
    this.activeProfileId = profileId;
    
    await this._saveProfile(profile);
    await this._saveActiveProfile();
    
    this.eventBus.emit(EventTypes.IDENTITY_UPDATED, {
      profileId: profile.id,
      action: 'switched'
    });
    
    return profile;
  }
  
  /**
   * Export profile (without private keys).
   */
  async exportProfile(profileId) {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Profile not found: ${profileId}`);
    }
    
    return {
      ...profile.getPublicInfo(),
      exportedAt: new Date().toISOString()
    };
  }
  
  /**
   * Import profile.
   */
  async importProfile(data) {
    const profile = IdentityProfile.fromJSON(data);
    profile.id = crypto.randomBytes(16).toString('hex'); // New ID
    profile.isActive = false;
    
    this.profiles.set(profile.id, profile);
    await this._saveProfile(profile);
    
    this.eventBus.emit(EventTypes.IDENTITY_IMPORTED, {
      profileId: profile.id,
      name: profile.name
    });
    
    return profile;
  }
  
  /**
   * Load all profiles from disk.
   */
  async _loadProfiles() {
    try {
      const files = await fs.readdir(this.profilesPath);
      
      for (const file of files) {
        if (file.endsWith('.json') && file !== ACTIVE_PROFILE_FILE) {
          const filePath = path.join(this.profilesPath, file);
          const data = await fs.readFile(filePath, 'utf8');
          const profile = IdentityProfile.fromJSON(JSON.parse(data));
          
          this.profiles.set(profile.id, profile);
          
          if (profile.isActive) {
            this.activeProfileId = profile.id;
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    // Create default profile if none exists
    if (this.profiles.size === 0) {
      await this.createProfile({
        name: 'Default',
        generateKeys: true
      });
    }
  }
  
  /**
   * Save profile to disk.
   */
  async _saveProfile(profile) {
    const profileFile = path.join(this.profilesPath, `${profile.id}.json`);
    await fs.writeFile(
      profileFile,
      JSON.stringify(profile.toJSON(), null, 2),
      { mode: 0o600 }
    );
  }
  
  /**
   * Load active profile info.
   */
  async _loadActiveProfile() {
    try {
      const data = await fs.readFile(
        path.join(this.basePath, ACTIVE_PROFILE_FILE),
        'utf8'
      );
      const { activeProfileId } = JSON.parse(data);
      
      if (this.profiles.has(activeProfileId)) {
        this.activeProfileId = activeProfileId;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      
      // Set first profile as active
      if (this.profiles.size > 0) {
        const firstProfile = this.profiles.values().next().value;
        this.activeProfileId = firstProfile.id;
        await this._saveActiveProfile();
      }
    }
  }
  
  /**
   * Save active profile info.
   */
  async _saveActiveProfile() {
    await fs.writeFile(
      path.join(this.basePath, ACTIVE_PROFILE_FILE),
      JSON.stringify({ activeProfileId: this.activeProfileId }, null, 2),
      { mode: 0o600 }
    );
  }
  
  /**
   * Get profile manager status.
   */
  getStatus() {
    return {
      total: this.profiles.size,
      activeProfileId: this.activeProfileId,
      activeProfile: this.getActiveProfile()?.getPublicInfo() || null
    };
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalProfileManager = null;

export function getProfileManager(options = {}) {
  if (!globalProfileManager) {
    globalProfileManager = new ProfileManager(options);
  }
  return globalProfileManager;
}

export function createProfileManager(options = {}) {
  return new ProfileManager(options);
}
