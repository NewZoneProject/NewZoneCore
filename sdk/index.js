// Module: NewZoneCore SDK
// Description: JavaScript/TypeScript SDK for NewZoneCore.
//              Provides convenient API for building applications.
// File: sdk/index.js

import { EventEmitter } from 'events';

// ============================================================================
// NZCORE CLIENT
// ============================================================================

export class NZCoreClient extends EventEmitter {
  constructor(options = {}) {
    super();

    this.baseUrl = options.baseUrl || 'http://127.0.0.1:3000';
    this.apiKey = options.apiKey || null;
    this.accessToken = options.accessToken || null;
    this.timeout = options.timeout || 30000;

    this.identity = null;
    this.connected = false;
  }

  /**
   * Connect to NewZoneCore.
   */
  async connect() {
    try {
      const response = await this._request('/api/state');
      this.connected = true;
      this.emit('connected', { state: response });
      return response;
    } catch (error) {
      this.emit('error', { error });
      throw error;
    }
  }

  /**
   * Disconnect from NewZoneCore.
   */
  disconnect() {
    this.connected = false;
    this.emit('disconnected');
  }

  /**
   * Authenticate with password.
   */
  async login(password) {
    const response = await this._request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password })
    });

    this.accessToken = response.accessToken;
    this.emit('login', { user: response.user });

    return response;
  }

  /**
   * Logout.
   */
  async logout() {
    await this._request('/api/auth/logout', { method: 'POST' });
    this.accessToken = null;
    this.emit('logout');
  }

  /**
   * Make HTTP request.
   */
  async _request(path, options = {}) {
    const url = new URL(path, this.baseUrl);

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    } else if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        ...options,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      this.emit('request:error', { error, path });
      throw error;
    }
  }

  // ============================================================================
  // IDENTITY API
  // ============================================================================

  /**
   * Get current identity.
   */
  async getIdentity() {
    return this._request('/api/identity');
  }

  /**
   * List identity profiles.
   */
  async listProfiles() {
    return this._request('/api/identity/profiles');
  }

  /**
   * Create identity profile.
   */
  async createProfile(options = {}) {
    return this._request('/api/identity/profiles', {
      method: 'POST',
      body: JSON.stringify(options)
    });
  }

  /**
   * Switch to profile.
   */
  async switchProfile(profileId) {
    return this._request(`/api/identity/profiles/${profileId}/switch`, {
      method: 'POST'
    });
  }

  // ============================================================================
  // TRUST API
  // ============================================================================

  /**
   * Get trust store.
   */
  async getTrust() {
    return this._request('/api/trust');
  }

  /**
   * Add trusted peer.
   */
  async addPeer(peerId, publicKey, trustLevel = 'MEDIUM') {
    return this._request('/api/trust', {
      method: 'POST',
      body: JSON.stringify({ id: peerId, pubkey: publicKey, trustLevel })
    });
  }

  /**
   * Remove trusted peer.
   */
  async removePeer(peerId) {
    return this._request(`/api/trust?id=${peerId}`, {
      method: 'DELETE'
    });
  }

  /**
   * List trusted peers.
   */
  async listPeers() {
    const trust = await this.getTrust();
    return trust.peers || [];
  }

  // ============================================================================
  // NETWORK API
  // ============================================================================

  /**
   * Get network status.
   */
  async getNetworkStatus() {
    return this._request('/api/network/status');
  }

  /**
   * Get routing table.
   */
  async getRoutingTable() {
    return this._request('/api/routing');
  }

  /**
   * Send message to peer.
   */
  async sendMessage(peerId, message) {
    return this._request('/api/routing/send', {
      method: 'POST',
      body: JSON.stringify({ peerId, message })
    });
  }

  /**
   * Ping peer.
   */
  async pingPeer(peerId) {
    return this._request('/api/routing/ping', {
      method: 'POST',
      body: JSON.stringify({ peerId })
    });
  }

  // ============================================================================
  // STORAGE API
  // ============================================================================

  /**
   * List files.
   */
  async listFiles() {
    return this._request('/api/storage/files');
  }

  /**
   * Read file.
   */
  async readFile(filePath) {
    return this._request(`/api/storage/files?path=${encodeURIComponent(filePath)}`);
  }

  /**
   * Write file.
   */
  async writeFile(filePath, content) {
    return this._request('/api/storage/files', {
      method: 'POST',
      body: JSON.stringify({ path: filePath, content })
    });
  }

  /**
   * Delete file.
   */
  async deleteFile(filePath) {
    return this._request(`/api/storage/files?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE'
    });
  }

  /**
   * Get KV value.
   */
  async getKV(key) {
    return this._request(`/api/storage/kv?key=${encodeURIComponent(key)}`);
  }

  /**
   * Set KV value.
   */
  async setKV(key, value) {
    return this._request('/api/storage/kv', {
      method: 'POST',
      body: JSON.stringify({ key, value })
    });
  }

  /**
   * Delete KV value.
   */
  async deleteKV(key) {
    return this._request(`/api/storage/kv?key=${encodeURIComponent(key)}`, {
      method: 'DELETE'
    });
  }

  // ============================================================================
  // SERVICE API
  // ============================================================================

  /**
   * List services.
   */
  async listServices() {
    return this._request('/api/services');
  }

  /**
   * Start service.
   */
  async startService(serviceId) {
    return this._request(`/api/services/${serviceId}/start`, {
      method: 'POST'
    });
  }

  /**
   * Stop service.
   */
  async stopService(serviceId) {
    return this._request(`/api/services/${serviceId}/stop`, {
      method: 'POST'
    });
  }

  /**
   * Get service status.
   */
  async getServiceStatus(serviceId) {
    return this._request(`/api/services/${serviceId}`);
  }

  // ============================================================================
  // BACKUP API
  // ============================================================================

  /**
   * List backups.
   */
  async listBackups() {
    return this._request('/api/backup/list');
  }

  /**
   * Create backup.
   */
  async createBackup(options = {}) {
    return this._request('/api/backup/create', {
      method: 'POST',
      body: JSON.stringify(options)
    });
  }

  /**
   * Restore backup.
   */
  async restoreBackup(backupId) {
    return this._request('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ backupId })
    });
  }

  /**
   * Delete backup.
   */
  async deleteBackup(backupId) {
    return this._request('/api/backup/delete', {
      method: 'POST',
      body: JSON.stringify({ backupId })
    });
  }

  // ============================================================================
  // ADMIN API
  // ============================================================================

  /**
   * Get system status.
   */
  async getStatus() {
    return this._request('/api/status');
  }

  /**
   * Get metrics.
   */
  async getMetrics() {
    return this._request('/metrics', {
      headers: { 'Accept': 'text/plain' }
    });
  }

  /**
   * Get health.
   */
  async getHealth() {
    return this._request('/health');
  }

  /**
   * Shutdown node.
   */
  async shutdown() {
    return this._request('/api/admin/shutdown', { method: 'POST' });
  }

  /**
   * Restart node.
   */
  async restart() {
    return this._request('/api/admin/restart', { method: 'POST' });
  }
}

// ============================================================================
// PLUGIN SDK
// ============================================================================

export class PluginSDK {
  constructor(context) {
    this.context = context;
    this.logger = context.logger;
    this.storage = context.storage;
    this.eventBus = context.eventBus;
  }

  /**
   * Log message.
   */
  log(level, message, ...args) {
    this.logger[level](message, ...args);
  }

  /**
   * Store data.
   */
  async set(key, value) {
    return this.storage.set(key, value);
  }

  /**
   * Get data.
   */
  async get(key) {
    return this.storage.get(key);
  }

  /**
   * Emit event.
   */
  emit(type, payload) {
    this.eventBus.emit(type, payload);
  }

  /**
   * Subscribe to event.
   */
  on(type, handler) {
    return this.eventBus.subscribe(type, handler);
  }

  /**
   * Call supervisor API.
   */
  async call(action, params = {}) {
    return this.context.supervisor.call(action, params);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create client with API key.
 */
export function createClient(options = {}) {
  return new NZCoreClient(options);
}

/**
 * Create client and connect.
 */
export async function connect(options = {}) {
  const client = new NZCoreClient(options);
  await client.connect();
  return client;
}

/**
 * Create plugin SDK.
 */
export function createPluginSDK(context) {
  return new PluginSDK(context);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  NZCoreClient,
  PluginSDK,
  createClient,
  connect,
  createPluginSDK
};
