// Module: Phase 10 FL Tests
// Description: Tests for Federated Learning modules.
// File: tests/phase10.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// FEDERATED LEARNING CORE TESTS
// ============================================================================

describe('Federated Learning Core', () => {
  let FederatedClient, FederatedServer, FederatedLearningManager;

  beforeEach(async () => {
    const mod = await import('../core/fl/core.js');
    FederatedClient = mod.FederatedClient;
    FederatedServer = mod.FederatedServer;
    FederatedLearningManager = mod.FederatedLearningManager;
  });

  it('should create federated client', () => {
    const client = new FederatedClient('node-1');

    expect(client).toBeDefined();
    expect(client.nodeId).toBe('node-1');
    expect(client.publicKey).toBeDefined();
  });

  it('should add local data', () => {
    const client = new FederatedClient('node-1');

    client.addData({ type: 'auth:login', timestamp: Date.now() });
    client.addData({ type: 'network:connect', timestamp: Date.now() });

    expect(client.dataPoints).toBe(2);
    expect(client.localData.length).toBe(2);
  });

  it('should limit local data size', () => {
    const client = new FederatedClient('node-1', { maxLocalData: 10 });

    for (let i = 0; i < 20; i++) {
      client.addData({ type: 'event', index: i });
    }

    expect(client.localData.length).toBe(10);
  });

  it('should create federated server', () => {
    const server = new FederatedServer();

    expect(server).toBeDefined();
    expect(server.globalModel).toBeDefined();
    expect(server.currentRound).toBe(0);
  });

  it('should register client with server', () => {
    const server = new FederatedServer();
    const client = new FederatedClient('node-1');

    server.registerClient(client);

    expect(server.clients.size).toBe(1);
  });

  it('should initialize global model', () => {
    const server = new FederatedServer();
    const model = server.getGlobalModel();

    expect(model).toBeDefined();
    expect(model.mean_auth_events).toBeDefined();
    expect(model.anomaly_rate).toBeDefined();
  });

  it('should aggregate updates from multiple clients', () => {
    const server = new FederatedServer();

    const updates = [
      { nodeId: 'node-1', updates: { mean_auth_events: 0.1, mean_alerts: 0.05 } },
      { nodeId: 'node-2', updates: { mean_auth_events: 0.2, mean_alerts: 0.1 } },
      { nodeId: 'node-3', updates: { mean_auth_events: 0.15, mean_alerts: 0.07 } }
    ];

    const aggregated = server.aggregateUpdates(updates);

    expect(aggregated.mean_auth_events).toBeCloseTo(0.15, 2);
    expect(aggregated.mean_alerts).toBeCloseTo(0.073, 2);
  });

  it('should update global model', () => {
    const server = new FederatedServer();
    const initialModel = { ...server.globalModel };

    const updates = [
      { nodeId: 'node-1', updates: { mean_auth_events: 0.5 } },
      { nodeId: 'node-2', updates: { mean_auth_events: 0.5 } }
    ];

    const aggregated = server.aggregateUpdates(updates);
    server.updateGlobalModel([{ nodeId: 'test', updates: aggregated }]);

    expect(server.completedRounds).toBe(1);
    // Model should be updated (different from initial)
    expect(server.globalModel.mean_auth_events).not.toBe(initialModel.mean_auth_events);
  });

  it('should export and import model', () => {
    const server = new FederatedServer();
    
    // Modify model
    server.globalModel.mean_auth_events = 0.5;
    server.currentRound = 10;

    const exported = server.exportModel();
    const imported = server.importModel(exported);

    expect(imported).toBe(true);
    expect(server.globalModel.mean_auth_events).toBe(0.5);
  });

  it('should create FL manager', () => {
    const manager = new FederatedLearningManager();

    expect(manager).toBeDefined();
    expect(manager.server).toBeDefined();
  });

  it('should initialize as server', () => {
    const manager = new FederatedLearningManager();
    const server = manager.initServer();

    expect(manager.mode).toBe('server');
    expect(server).toBeDefined();
  });

  it('should initialize as client', () => {
    const manager = new FederatedLearningManager();
    const client = manager.initClient('node-1');

    expect(manager.mode).toBe('client');
    expect(client).toBeDefined();
    expect(client.nodeId).toBe('node-1');
  });

  it('should get FL status', () => {
    const manager = new FederatedLearningManager();
    manager.initServer();

    const status = manager.getStatus();

    expect(status.mode).toBe('server');
    expect(status.server).toBeDefined();
  });

  it('should add differential privacy noise', () => {
    const client = new FederatedClient('node-1', { epsilon: 1.0 });

    const updates = { mean: 0.5, count: 10 };
    const noisyUpdates = client._addNoise(updates);

    expect(noisyUpdates).toBeDefined();
    expect(noisyUpdates.mean).not.toBe(0.5); // Noise added
  });

  it('should extract features from local data', () => {
    const client = new FederatedClient('node-1');

    for (let i = 0; i < 50; i++) {
      client.addData({ type: 'auth:login' });
    }
    for (let i = 0; i < 30; i++) {
      client.addData({ type: 'network:connect' });
    }
    for (let i = 0; i < 5; i++) {
      client.addData({ type: 'security:alert' });
    }

    const features = client._extractFeatures();

    expect(features.mean_auth_events).toBeGreaterThan(0);
    expect(features.mean_network_events).toBeGreaterThan(0);
    expect(features.anomaly_rate).toBeGreaterThan(0);
  });
});

// ============================================================================
// THREAT INTELLIGENCE TESTS
// ============================================================================

describe('Threat Intelligence', () => {
  let ThreatIndicator, ThreatIntelligence, PrivacyAnalytics;

  beforeEach(async () => {
    const mod = await import('../core/fl/threat-intel.js');
    ThreatIndicator = mod.ThreatIndicator;
    ThreatIntelligence = mod.ThreatIntelligence;
    PrivacyAnalytics = mod.PrivacyAnalytics;
  });

  it('should create threat indicator', () => {
    const indicator = new ThreatIndicator({
      type: 'ip',
      value: '192.168.1.100',
      severity: 'high'
    });

    expect(indicator).toBeDefined();
    expect(indicator.type).toBe('ip');
    expect(indicator.hash).toBeDefined();
  });

  it('should hash indicator value', () => {
    const indicator1 = new ThreatIndicator({
      type: 'ip',
      value: '192.168.1.100'
    });

    const indicator2 = new ThreatIndicator({
      type: 'ip',
      value: '192.168.1.100'
    });

    expect(indicator1.hash).toBe(indicator2.hash);
  });

  it('should create shareable indicator', () => {
    const indicator = new ThreatIndicator({
      type: 'hash',
      value: 'abc123',
      severity: 'critical',
      confidence: 0.9
    });

    const shareable = indicator.toShareable();

    expect(shareable.value).toBeUndefined(); // Value not included
    expect(shareable.hash).toBeDefined();
    expect(shareable.severity).toBe('critical');
  });

  it('should create threat intelligence', () => {
    const ti = new ThreatIntelligence('node-1');

    expect(ti).toBeDefined();
    expect(ti.nodeId).toBe('node-1');
  });

  it('should add threat indicator', () => {
    const ti = new ThreatIntelligence('node-1');

    const indicator = ti.addIndicator({
      type: 'domain',
      value: 'malicious.example.com',
      severity: 'high'
    });

    expect(ti.stats.indicatorsCreated).toBe(1);
    expect(ti.indicators.size).toBe(1);
  });

  it('should check value against indicators', () => {
    const ti = new ThreatIntelligence('node-1');

    ti.addIndicator({
      type: 'ip',
      value: '10.0.0.1',
      severity: 'high',
      confidence: 0.95
    });

    const result = ti.checkValue('10.0.0.1');

    expect(result.match).toBe(true);
    expect(result.source).toBe('local');
  });

  it('should share indicator with confidence threshold', () => {
    const ti = new ThreatIntelligence('node-1', {
      shareConfidenceThreshold: 0.7
    });

    const lowConf = ti.addIndicator({
      type: 'ip',
      value: '1.1.1.1',
      confidence: 0.5
    });

    const highConf = ti.addIndicator({
      type: 'ip',
      value: '2.2.2.2',
      confidence: 0.9
    });

    expect(ti.shareIndicator(lowConf)).toBe(false);
    expect(ti.shareIndicator(highConf)).toBe(true);
  });

  it('should receive indicator from peer', () => {
    const ti = new ThreatIntelligence('node-1');
    
    // Add mock peer
    ti.peers.set('node-2', { send: () => {} });

    const indicator = ti.receiveIndicator({
      type: 'hash',
      value: 'abc123',
      confidence: 0.8
    }, 'node-2');

    expect(indicator).toBeDefined();
    expect(ti.stats.indicatorsReceived).toBe(1);
  });

  it('should get indicators by type', () => {
    const ti = new ThreatIntelligence('node-1');

    ti.addIndicator({ type: 'ip', value: '1.1.1.1' });
    ti.addIndicator({ type: 'ip', value: '2.2.2.2' });
    ti.addIndicator({ type: 'domain', value: 'evil.com' });

    const ips = ti.getIndicators('ip');
    const all = ti.getIndicators();

    expect(ips.length).toBe(2);
    expect(all.length).toBe(3);
  });

  it('should get threat intelligence stats', () => {
    const ti = new ThreatIntelligence('node-1');

    ti.addIndicator({ type: 'ip', value: '1.1.1.1' });
    ti.checkValue('1.1.1.1');

    const stats = ti.getStats();

    expect(stats.indicatorsCreated).toBe(1);
    expect(stats.threatsBlocked).toBe(1);
    expect(stats.localIndicators).toBe(1);
  });

  it('should export indicators to STIX format', () => {
    const ti = new ThreatIntelligence('node-1');

    ti.addIndicator({ type: 'hash', value: 'abc123' });

    const stix = ti.exportIndicators('stix');
    const data = typeof stix === 'string' ? JSON.parse(stix) : stix;

    expect(data.type).toBe('bundle');
    expect(data.objects).toBeDefined();
    expect(data.objects.length).toBe(1);
  });

  it('should create privacy analytics', () => {
    const analytics = new PrivacyAnalytics({ epsilon: 0.5 });

    expect(analytics).toBeDefined();
    expect(analytics.epsilon).toBe(0.5);
  });

  it('should aggregate with differential privacy', () => {
    const analytics = new PrivacyAnalytics({ epsilon: 1.0 });

    const values = [10, 20, 30, 40, 50];
    const result = analytics.aggregate('test_metric', values);

    expect(result).toBeDefined();
    expect(result.count).toBe(5);
    expect(result.epsilon).toBe(1.0);
    // Mean should be around 30 (with noise)
    expect(result.mean).toBeGreaterThan(20);
    expect(result.mean).toBeLessThan(40);
  });

  it('should compute histogram with differential privacy', () => {
    const analytics = new PrivacyAnalytics({ epsilon: 1.0 });

    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const histogram = analytics.histogram(values, 5);

    expect(histogram).toBeDefined();
    expect(histogram.bins.length).toBe(5);
    expect(histogram.counts.length).toBe(5);
    expect(histogram.epsilon).toBe(1.0);
  });

  it('should add Laplace noise', () => {
    const analytics = new PrivacyAnalytics({ epsilon: 0.5 });

    const noise1 = analytics._laplaceNoise(0, 1);
    const noise2 = analytics._laplaceNoise(0, 1);

    // Noise should be different each time
    expect(noise1).not.toBe(noise2);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Phase 10 Integration', () => {
  it('should have all FL modules', async () => {
    const core = await import('../core/fl/core.js');
    expect(core.FederatedClient).toBeDefined();
    expect(core.FederatedServer).toBeDefined();
    expect(core.FederatedLearningManager).toBeDefined();

    const threatIntel = await import('../core/fl/threat-intel.js');
    expect(threatIntel.ThreatIndicator).toBeDefined();
    expect(threatIntel.ThreatIntelligence).toBeDefined();
    expect(threatIntel.PrivacyAnalytics).toBeDefined();

    const index = await import('../core/fl/index.js');
    expect(index.getFederatedLearningManager).toBeDefined();
    expect(index.getThreatIntelligence).toBeDefined();
  });

  it('should run federated learning round', async () => {
    const { FederatedClient, FederatedServer } = await import('../core/fl/core.js');

    const server = new FederatedServer();

    // Add clients
    for (let i = 0; i < 5; i++) {
      const client = new FederatedClient(`node-${i}`);

      // Add training data
      for (let j = 0; j < 20; j++) {
        client.addData({
          type: j % 2 === 0 ? 'auth:login' : 'network:connect',
          timestamp: Date.now()
        });
      }

      server.registerClient(client);
    }

    // Run round
    const result = await server.startRound();

    expect(result).toBeDefined();
    expect(result.round).toBe(1);
    expect(result.clients).toBeGreaterThan(0);
  });

  it('should share threat intelligence between nodes', async () => {
    const { ThreatIntelligence } = await import('../core/fl/threat-intel.js');

    const node1 = new ThreatIntelligence('node-1');
    const node2 = new ThreatIntelligence('node-2');

    // Add indicator to node1
    const indicator = node1.addIndicator({
      type: 'ip',
      value: 'malicious.ip.address',
      severity: 'high',
      confidence: 0.95
    });

    // Share indicator
    node1.shareIndicator(indicator);

    // Node2 receives indicator (simulated)
    node2.peers.set('node-1', { send: () => {} });
    node2.receiveIndicator({
      type: 'ip',
      value: 'malicious.ip.address',
      severity: 'high',
      confidence: 0.95,
      hash: indicator.hash
    }, 'node-1');

    // Node2 checks value
    const result = node2.checkValue('malicious.ip.address');

    expect(result.match).toBe(true);
    expect(result.source).toBe('shared');
  });
});
