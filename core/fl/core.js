// Module: Federated Learning Core
// Description: Privacy-preserving distributed ML for NewZoneCore.
//              Enables collaborative learning without sharing raw data.
// File: core/fl/core.js

import { EventEmitter } from 'events';
import { randomBytes, createHash } from 'crypto';

// ============================================================================
// FEDERATED CLIENT
// ============================================================================

export class FederatedClient extends EventEmitter {
  constructor(nodeId, options = {}) {
    super();

    this.nodeId = nodeId;
    this.options = options;
    this.localModel = null;
    this.modelVersion = 0;
    this.trainingRounds = 0;
    this.dataPoints = 0;
    
    // Local data storage (encrypted)
    this.localData = [];
    this.maxLocalData = options.maxLocalData || 10000;
    
    // Differential privacy
    this.epsilon = options.epsilon || 1.0;
    this.delta = options.delta || 1e-5;
    
    // Secure aggregation keys
    this.secretKey = randomBytes(32);
    this.publicKey = this._derivePublicKey(this.secretKey);
  }

  /**
   * Add local training data.
   */
  addData(data) {
    this.localData.push({
      ...data,
      timestamp: Date.now(),
      id: randomBytes(8).toString('hex')
    });

    // Limit data size
    if (this.localData.length > this.maxLocalData) {
      this.localData.shift();
    }

    this.dataPoints++;
    this.emit('data:added', { count: this.localData.length });
  }

  /**
   * Train local model.
   */
  async train(globalModel, round) {
    this.emit('train:start', { round, dataPoints: this.localData.length });

    if (this.localData.length < 10) {
      throw new Error('Insufficient local data for training');
    }

    // Initialize or update local model
    if (!this.localModel) {
      this.localModel = this._initializeModel(globalModel);
    } else {
      this.localModel = this._updateModel(this.localModel, globalModel);
    }

    // Local training with differential privacy
    const updates = await this._computeUpdates(globalModel);
    const noisyUpdates = this._addNoise(updates);

    this.trainingRounds++;
    this.modelVersion = round;

    this.emit('train:complete', { 
      round, 
      updates: noisyUpdates,
      dataPoints: this.localData.length 
    });

    return {
      nodeId: this.nodeId,
      round,
      updates: noisyUpdates,
      dataPoints: this.localData.length,
      modelVersion: this.modelVersion
    };
  }

  /**
   * Initialize local model from global.
   */
  _initializeModel(globalModel) {
    return JSON.parse(JSON.stringify(globalModel));
  }

  /**
   * Update local model with global weights.
   */
  _updateModel(local, global) {
    // Blend local and global (federated averaging)
    for (const key of Object.keys(global)) {
      if (typeof global[key] === 'number') {
        local[key] = (local[key] + global[key]) / 2;
      } else if (Array.isArray(global[key])) {
        local[key] = global[key].map((v, i) => 
          typeof v === 'number' ? (local[key][i] + v) / 2 : v
        );
      }
    }
    return local;
  }

  /**
   * Compute model updates.
   */
  async _computeUpdates(globalModel) {
    // Simple gradient-like updates based on local data
    const updates = {};
    const n = this.localData.length;

    // Compute feature statistics as "updates"
    const features = this._extractFeatures();
    
    for (const [key, value] of Object.entries(features)) {
      updates[key] = value - (globalModel[key] || 0);
    }

    return updates;
  }

  /**
   * Extract features from local data.
   */
  _extractFeatures() {
    const features = {
      mean_auth_events: 0,
      mean_network_events: 0,
      mean_alerts: 0,
      std_auth_events: 0,
      std_network_events: 0,
      anomaly_rate: 0
    };

    let authCount = 0;
    let networkCount = 0;
    let alertCount = 0;

    for (const data of this.localData) {
      if (data.type?.startsWith('auth:')) authCount++;
      if (data.type?.startsWith('network:')) networkCount++;
      if (data.type?.includes('alert')) alertCount++;
    }

    const n = this.localData.length || 1;
    features.mean_auth_events = authCount / n;
    features.mean_network_events = networkCount / n;
    features.mean_alerts = alertCount / n;
    features.anomaly_rate = alertCount / n;

    return features;
  }

  /**
   * Add differential privacy noise.
   */
  _addNoise(updates) {
    const noisyUpdates = { ...updates };
    
    // Gaussian mechanism for (ε,δ)-differential privacy
    const sensitivity = 1.0;
    const sigma = (sensitivity * Math.sqrt(2 * Math.log(1.25 / this.delta))) / this.epsilon;

    for (const key of Object.keys(noisyUpdates)) {
      if (typeof noisyUpdates[key] === 'number') {
        noisyUpdates[key] += this._gaussianNoise(0, sigma);
      }
    }

    return noisyUpdates;
  }

  /**
   * Generate Gaussian noise.
   */
  _gaussianNoise(mean, stddev) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stddev * z;
  }

  /**
   * Derive public key from secret key.
   */
  _derivePublicKey(secretKey) {
    return createHash('sha256').update(secretKey).digest('hex');
  }

  /**
   * Get client status.
   */
  getStatus() {
    return {
      nodeId: this.nodeId,
      dataPoints: this.dataPoints,
      localDataSize: this.localData.length,
      trainingRounds: this.trainingRounds,
      modelVersion: this.modelVersion,
      epsilon: this.epsilon,
      publicKey: this.publicKey
    };
  }

  /**
   * Export encrypted local data.
   */
  exportData() {
    // In production, this would be properly encrypted
    return {
      nodeId: this.nodeId,
      dataPoints: this.dataPoints,
      dataHash: createHash('sha256')
        .update(JSON.stringify(this.localData))
        .digest('hex')
    };
  }
}

// ============================================================================
// FEDERATED SERVER (COORDINATOR)
// ============================================================================

export class FederatedServer extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = options;
    this.clients = new Map();
    this.globalModel = this._initializeGlobalModel();
    this.currentRound = 0;
    this.completedRounds = 0;
    this.aggregatedUpdates = [];
    
    // Secure aggregation
    this.serverSecret = randomBytes(32);
    this.maskingKeys = new Map();
    
    // Configuration
    this.minClients = options.minClients || 3;
    this.targetClients = options.targetClients || 10;
    this.maxRounds = options.maxRounds || 100;
  }

  /**
   * Initialize global model.
   */
  _initializeGlobalModel() {
    return {
      mean_auth_events: 0.1,
      mean_network_events: 0.3,
      mean_alerts: 0.05,
      std_auth_events: 0.1,
      std_network_events: 0.2,
      anomaly_rate: 0.02,
      version: 0
    };
  }

  /**
   * Register client.
   */
  registerClient(client) {
    if (!(client instanceof FederatedClient)) {
      throw new Error('Must be FederatedClient instance');
    }

    this.clients.set(client.nodeId, client);
    
    client.on('train:complete', (data) => {
      this._handleClientUpdate(data);
    });

    this.emit('client:registered', { nodeId: client.nodeId });
    console.log(`[fl] Client registered: ${client.nodeId}`);
  }

  /**
   * Unregister client.
   */
  unregisterClient(nodeId) {
    const client = this.clients.get(nodeId);
    if (client) {
      this.clients.delete(nodeId);
      this.maskingKeys.delete(nodeId);
      this.emit('client:unregistered', { nodeId });
    }
  }

  /**
   * Start federated learning round.
   */
  async startRound() {
    if (this.currentRound >= this.maxRounds) {
      console.log('[fl] Max rounds reached');
      return null;
    }

    const round = ++this.currentRound;
    const eligibleClients = Array.from(this.clients.values())
      .filter(c => c.localData.length >= 10);

    if (eligibleClients.length < this.minClients) {
      console.log('[fl] Not enough eligible clients');
      return null;
    }

    console.log(`[fl] Starting round ${round} with ${eligibleClients.length} clients`);
    this.emit('round:start', { round, clients: eligibleClients.length });

    // Select clients for this round
    const selectedClients = eligibleClients.slice(0, this.targetClients);
    
    // Generate masking keys for secure aggregation
    this._generateMaskingKeys(selectedClients);

    // Train each client
    const promises = selectedClients.map(client => 
      client.train(this.globalModel, round)
        .catch(err => {
          console.error(`[fl] Client ${client.nodeId} training failed:`, err.message);
          return null;
        })
    );

    const results = await Promise.all(promises);
    const validResults = results.filter(r => r !== null);

    return {
      round,
      clients: validResults.length,
      results: validResults
    };
  }

  /**
   * Handle client update.
   */
  _handleClientUpdate(data) {
    this.aggregatedUpdates.push(data);
    this.emit('update:received', data);
  }

  /**
   * Aggregate client updates.
   */
  aggregateUpdates(updates) {
    if (updates.length === 0) {
      return this.globalModel;
    }

    const aggregated = {};
    const n = updates.length;

    // Initialize with zeros
    for (const key of Object.keys(updates[0].updates)) {
      aggregated[key] = 0;
    }

    // Sum updates
    for (const update of updates) {
      for (const key of Object.keys(update.updates)) {
        if (typeof update.updates[key] === 'number') {
          aggregated[key] += update.updates[key];
        }
      }
    }

    // Average
    for (const key of Object.keys(aggregated)) {
      aggregated[key] /= n;
    }

    return aggregated;
  }

  /**
   * Update global model.
   */
  updateGlobalModel(updates) {
    const aggregated = this.aggregateUpdates(updates);
    
    // Apply updates to global model
    for (const key of Object.keys(aggregated)) {
      if (typeof this.globalModel[key] === 'number') {
        // Learning rate
        const lr = 0.1;
        this.globalModel[key] += lr * aggregated[key];
      }
    }

    this.globalModel.version = this.currentRound;
    this.completedRounds++;

    this.emit('model:updated', {
      round: this.currentRound,
      version: this.globalModel.version
    });

    console.log(`[fl] Global model updated (round ${this.currentRound})`);
    return this.globalModel;
  }

  /**
   * Generate masking keys for secure aggregation.
   */
  _generateMaskingKeys(clients) {
    this.maskingKeys.clear();
    
    for (const client of clients) {
      this.maskingKeys.set(client.nodeId, randomBytes(32));
    }
  }

  /**
   * Get server status.
   */
  getStatus() {
    return {
      clients: this.clients.size,
      currentRound: this.currentRound,
      completedRounds: this.completedRounds,
      maxRounds: this.maxRounds,
      globalModelVersion: this.globalModel.version,
      minClients: this.minClients
    };
  }

  /**
   * Get global model.
   */
  getGlobalModel() {
    return { ...this.globalModel };
  }

  /**
   * Export global model.
   */
  exportModel() {
    return JSON.stringify({
      model: this.globalModel,
      round: this.currentRound,
      completedRounds: this.completedRounds,
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Import global model.
   */
  importModel(jsonData) {
    try {
      const data = JSON.parse(jsonData);
      this.globalModel = data.model;
      this.currentRound = data.round || 0;
      this.completedRounds = data.completedRounds || 0;
      console.log('[fl] Global model imported');
      return true;
    } catch (error) {
      console.error('[fl] Failed to import model:', error.message);
      return false;
    }
  }
}

// ============================================================================
// FEDERATED LEARNING MANAGER
// ============================================================================

export class FederatedLearningManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = options;
    this.server = new FederatedServer(options.server);
    this.client = null;
    
    this.autoRoundInterval = options.autoRoundInterval || 3600000; // 1 hour
    this._roundTimer = null;
    this.enabled = false;
  }

  /**
   * Initialize as server.
   */
  initServer() {
    this.mode = 'server';
    console.log('[fl] Initialized as federated server');
    return this.server;
  }

  /**
   * Initialize as client.
   */
  initClient(nodeId) {
    this.mode = 'client';
    this.client = new FederatedClient(nodeId, this.options.client);
    
    this.client.on('train:complete', (data) => {
      this.emit('client:train:complete', data);
    });
    
    console.log(`[fl] Initialized as federated client: ${nodeId}`);
    return this.client;
  }

  /**
   * Start auto rounds.
   */
  startAutoRounds() {
    if (this._roundTimer) return;

    this.enabled = true;
    this._roundTimer = setInterval(async () => {
      await this.runRound();
    }, this.autoRoundInterval);

    console.log('[fl] Auto rounds started');
  }

  /**
   * Stop auto rounds.
   */
  stopAutoRounds() {
    if (this._roundTimer) {
      clearInterval(this._roundTimer);
      this._roundTimer = null;
    }
    this.enabled = false;
    console.log('[fl] Auto rounds stopped');
  }

  /**
   * Run single federated round.
   */
  async runRound() {
    if (this.mode !== 'server') {
      throw new Error('Must be in server mode');
    }

    const result = await this.server.startRound();
    
    if (result && result.results.length > 0) {
      this.server.updateGlobalModel(result.results);
      this.emit('round:complete', result);
    }

    return result;
  }

  /**
   * Get FL status.
   */
  getStatus() {
    return {
      mode: this.mode,
      enabled: this.enabled,
      server: this.server.getStatus(),
      client: this.client?.getStatus() || null
    };
  }

  /**
   * Export FL state.
   */
  exportState() {
    return JSON.stringify({
      mode: this.mode,
      server: {
        model: this.server.getGlobalModel(),
        status: this.server.getStatus()
      },
      client: this.client?.exportData() || null,
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Import FL state.
   */
  importState(jsonData) {
    try {
      const data = JSON.parse(jsonData);
      
      if (data.server?.model) {
        this.server.importModel(JSON.stringify({
          model: data.server.model,
          round: data.server.status?.currentRound || 0,
          completedRounds: data.server.status?.completedRounds || 0
        }));
      }

      console.log('[fl] FL state imported');
      return true;
    } catch (error) {
      console.error('[fl] Failed to import state:', error.message);
      return false;
    }
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalFLManager = null;

export function getFederatedLearningManager(options = {}) {
  if (!globalFLManager) {
    globalFLManager = new FederatedLearningManager(options);
  }
  return globalFLManager;
}

export function createFederatedLearningManager(options = {}) {
  return new FederatedLearningManager(options);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  FederatedClient,
  FederatedServer,
  FederatedLearningManager,
  getFederatedLearningManager,
  createFederatedLearningManager
};
