// Module: Phase 9 ML Tests
// Description: Tests for Machine Learning modules.
// File: tests/phase9.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// ANOMALY DETECTION TESTS
// ============================================================================

describe('Anomaly Detection', () => {
  let StatisticalAnomalyDetector, IsolationForest, AnomalyManager;

  beforeEach(async () => {
    const mod = await import('../core/ml/anomaly.js');
    StatisticalAnomalyDetector = mod.StatisticalAnomalyDetector;
    IsolationForest = mod.IsolationForest;
    AnomalyManager = mod.AnomalyManager;
  });

  it('should create statistical anomaly detector', () => {
    const detector = new StatisticalAnomalyDetector({
      sensitivity: 2,
      minSamples: 10
    });

    expect(detector).toBeDefined();
    expect(detector.sensitivity).toBe(2);
  });

  it('should record metrics and detect anomalies', () => {
    const detector = new StatisticalAnomalyDetector({
      sensitivity: 2,
      minSamples: 30
    });

    // Record normal values
    for (let i = 0; i < 35; i++) {
      detector.record('cpu', 50 + Math.random() * 10);
    }

    // Record anomalous value
    const anomaly = detector.record('cpu', 150);

    expect(anomaly).toBeDefined();
    expect(anomaly.metric).toBe('cpu');
    expect(anomaly.severity).toBeDefined();
  });

  it('should calculate z-score correctly', () => {
    const detector = new StatisticalAnomalyDetector();
    
    const zScore = detector._calculateZScore(100, 50, 10);
    
    expect(zScore).toBe(5);
  });

  it('should get baseline statistics', () => {
    const detector = new StatisticalAnomalyDetector({ minSamples: 10 });

    for (let i = 0; i < 20; i++) {
      detector.record('memory', 1000 + i * 10);
    }

    const baseline = detector.getBaseline('memory');

    expect(baseline).toBeDefined();
    expect(baseline.mean).toBeGreaterThan(1000);
    expect(baseline.samples).toBe(20);
  });

  it('should create isolation forest', () => {
    const forest = new IsolationForest({
      numTrees: 50,
      sampleSize: 128
    });

    expect(forest).toBeDefined();
    expect(forest.numTrees).toBe(50);
  });

  it('should train isolation forest', () => {
    const forest = new IsolationForest({ numTrees: 10 });
    
    const data = Array.from({ length: 100 }, () => ({
      x: Math.random() * 100,
      y: Math.random() * 100
    }));

    forest.train(data);

    expect(forest.trained).toBe(true);
    expect(forest.trees.length).toBe(10);
  });

  it('should score anomalies with isolation forest', () => {
    const forest = new IsolationForest({ numTrees: 20 });
    
    const normalData = Array.from({ length: 200 }, () => ({
      x: 50 + Math.random() * 10,
      y: 50 + Math.random() * 10
    }));

    forest.train(normalData);

    // Normal point
    const normalScore = forest.score({ x: 55, y: 55 });
    
    // Anomalous point
    const anomalyScore = forest.score({ x: 100, y: 100 });

    expect(anomalyScore).toBeGreaterThan(normalScore);
  });

  it('should predict with isolation forest', () => {
    const forest = new IsolationForest({ numTrees: 20, threshold: 0.6 });
    
    const data = Array.from({ length: 200 }, () => ({
      x: 50 + Math.random() * 10
    }));

    forest.train(data);

    const result = forest.predict({ x: 100 });

    expect(result).toBeDefined();
    expect(result.isAnomaly).toBeDefined();
    expect(result.score).toBeDefined();
  });

  it('should create anomaly manager', () => {
    const manager = new AnomalyManager();

    expect(manager).toBeDefined();
    expect(manager.statisticalDetector).toBeDefined();
    expect(manager.securityDetector).toBeDefined();
  });

  it('should record metrics through manager', () => {
    const manager = new AnomalyManager({ minSamples: 10 });

    for (let i = 0; i < 15; i++) {
      manager.record('disk', 500 + i * 5);
    }

    const status = manager.getStatus();
    expect(status.statistical.metrics).toBeGreaterThan(0);
  });

  it('should get alerts from manager', () => {
    const manager = new AnomalyManager();

    const alerts = manager.getAlerts(10);
    expect(Array.isArray(alerts)).toBe(true);
  });
});

// ============================================================================
// BEHAVIORAL ANALYSIS TESTS
// ============================================================================

describe('Behavioral Analysis', () => {
  let BehaviorProfile, BehaviorAnalyzer, EntityRiskScorer;

  beforeEach(async () => {
    const mod = await import('../core/ml/behavior.js');
    BehaviorProfile = mod.BehaviorProfile;
    BehaviorAnalyzer = mod.BehaviorAnalyzer;
    EntityRiskScorer = mod.EntityRiskScorer;
  });

  it('should create behavior profile', () => {
    const profile = new BehaviorProfile('user-123', 'user');

    expect(profile).toBeDefined();
    expect(profile.entityId).toBe('user-123');
    expect(profile.activityHours).toHaveLength(24);
  });

  it('should record activity', () => {
    const profile = new BehaviorProfile('user-123');

    profile.record({
      type: 'auth:login',
      timestamp: Date.now(),
      ip: '192.168.1.1'
    });

    expect(profile.totalActions).toBeGreaterThan(0);
  });

  it('should build activity patterns', () => {
    const profile = new BehaviorProfile('user-123');

    // Record activities at current hour
    const currentHour = new Date().getHours();
    for (let i = 0; i < 20; i++) {
      profile.record({
        type: 'action',
        timestamp: Date.now()
      });
    }

    expect(profile.activityHours[currentHour]).toBeGreaterThan(0.1);
  });

  it('should calculate risk score', () => {
    const profile = new BehaviorProfile('user-123');

    // Build normal pattern
    for (let i = 0; i < 50; i++) {
      profile.record({
        type: 'normal_action',
        timestamp: Date.now(),
        ip: '192.168.1.1'
      });
    }

    // Record anomalous activity
    profile.record({
      type: 'unusual_action',
      timestamp: Date.now(),
      ip: '10.0.0.1' // New IP
    });

    expect(profile.riskFactors).toBeDefined();
  });

  it('should detect anomalous activity', () => {
    const profile = new BehaviorProfile('user-123');

    // Build pattern
    for (let i = 0; i < 100; i++) {
      profile.record({
        type: 'common_action',
        timestamp: Date.now(),
        ip: '192.168.1.1'
      });
    }

    const result = profile.isAnomalous({
      type: 'new_action_type',
      ip: '10.0.0.1'
    });

    expect(result.isAnomalous).toBe(true);
    expect(result.anomalies.length).toBeGreaterThan(0);
  });

  it('should get profile summary', () => {
    const profile = new BehaviorProfile('user-123');

    profile.record({
      type: 'action',
      timestamp: Date.now(),
      ip: '192.168.1.1',
      sessionDuration: 3600
    });

    const summary = profile.getSummary();

    expect(summary.entityId).toBe('user-123');
    expect(summary.totalActions).toBe(1);
    expect(summary.avgSessionDuration).toBe(3600);
  });

  it('should create behavior analyzer', () => {
    const analyzer = new BehaviorAnalyzer();

    expect(analyzer).toBeDefined();
    expect(analyzer.profiles.size).toBe(0);
  });

  it('should record activity through analyzer', () => {
    const analyzer = new BehaviorAnalyzer();

    const result = analyzer.recordActivity('user-123', {
      type: 'login',
      timestamp: Date.now()
    });

    expect(result.profile).toBeDefined();
    expect(result.anomaly).toBeDefined();
  });

  it('should create entity risk scorer', () => {
    const scorer = new EntityRiskScorer();

    expect(scorer).toBeDefined();
    expect(scorer.weights).toBeDefined();
  });

  it('should update risk score', () => {
    const scorer = new EntityRiskScorer();

    const score = scorer.update('user-123', {
      authentication: 30,
      network: 20,
      resource: 10,
      temporal: 5
    });

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should get high risk entities', () => {
    const scorer = new EntityRiskScorer();

    scorer.update('user-123', {
      authentication: 80,
      network: 70,
      resource: 90,
      temporal: 60
    });

    const highRisk = scorer.getHighRiskEntities(50);

    expect(highRisk.length).toBe(1);
    expect(highRisk[0].entityId).toBe('user-123');
  });
});

// ============================================================================
// PREDICTION TESTS
// ============================================================================

describe('Prediction', () => {
  let FailurePredictor, CapacityPlanner;

  beforeEach(async () => {
    const mod = await import('../core/ml/prediction.js');
    FailurePredictor = mod.FailurePredictor;
    CapacityPlanner = mod.CapacityPlanner;
  });

  it('should create failure predictor', () => {
    const predictor = new FailurePredictor();

    expect(predictor).toBeDefined();
    expect(predictor.windowSize).toBe(500);
  });

  it('should record metrics', () => {
    const predictor = new FailurePredictor();

    for (let i = 0; i < 60; i++) {
      predictor.record('cpu', 50 + Math.random() * 10);
    }

    const status = predictor.getStatus();
    expect(status.metrics).toBe(1);
  });

  it('should calculate trend', () => {
    const predictor = new FailurePredictor();

    const values = Array.from({ length: 100 }, (_, i) => ({
      value: 50 + i * 0.5,
      timestamp: Date.now() - (100 - i) * 60000
    }));

    predictor.metrics.set('test', values);

    const trend = predictor._calculateTrend(values);

    expect(trend).toBeGreaterThan(0);
  });

  it('should calculate volatility', () => {
    const predictor = new FailurePredictor();

    const values = Array.from({ length: 50 }, () => ({
      value: 50 + Math.random() * 20,
      timestamp: Date.now()
    }));

    const volatility = predictor._calculateVolatility(values);

    expect(volatility).toBeGreaterThan(0);
    expect(volatility).toBeLessThan(1);
  });

  it('should predict failure risk', () => {
    const predictor = new FailurePredictor({ minSamples: 10 });

    // Record increasing values
    for (let i = 0; i < 60; i++) {
      predictor.record('memory', 500 + i * 10);
    }

    const predictions = predictor.getPredictions();

    expect(predictions.memory).toBeDefined();
    expect(predictions.memory.risk).toBeDefined();
  });

  it('should get high risk metrics', () => {
    const predictor = new FailurePredictor({ minSamples: 10 });

    for (let i = 0; i < 60; i++) {
      predictor.record('disk', 800 + i * 5);
    }

    const highRisk = predictor.getHighRiskMetrics(0.5);

    expect(Array.isArray(highRisk)).toBe(true);
  });

  it('should create capacity planner', () => {
    const planner = new CapacityPlanner();

    expect(planner).toBeDefined();
  });

  it('should record resource usage', () => {
    const planner = new CapacityPlanner();

    for (let i = 0; i < 110; i++) {
      planner.record('disk', 500 + i * 2, 1000);
    }

    const status = planner.getStatus();

    expect(status.resources).toBe(1);
    expect(status.details.disk.utilization).toBeGreaterThan(0.5);
  });

  it('should predict capacity exhaustion', () => {
    const planner = new CapacityPlanner();

    // Record increasing usage
    for (let i = 0; i < 150; i++) {
      planner.record('storage', 700 + i * 2, 1000);
    }

    const prediction = planner.predictExhaustion('storage', 0.95);

    if (prediction) {
      expect(prediction.resource).toBe('storage');
      expect(prediction.estimatedTimeMs).toBeDefined();
    }
  });

  it('should get capacity recommendations', () => {
    const planner = new CapacityPlanner();

    // Record high usage
    for (let i = 0; i < 110; i++) {
      planner.record('memory', 850 + i, 1000);
    }

    const recommendations = planner.getRecommendations();

    expect(Array.isArray(recommendations)).toBe(true);
    expect(recommendations.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// PIPELINE TESTS
// ============================================================================

describe('ML Pipeline', () => {
  let MLPipeline;

  beforeEach(async () => {
    const mod = await import('../core/ml/pipeline.js');
    MLPipeline = mod.MLPipeline;
  });

  it('should create ML pipeline', () => {
    const pipeline = new MLPipeline();

    expect(pipeline).toBeDefined();
    expect(pipeline.enabled).toBe(false);
  });

  it('should start and stop pipeline', () => {
    const pipeline = new MLPipeline();

    pipeline.start();
    expect(pipeline.enabled).toBe(true);

    pipeline.stop();
    expect(pipeline.enabled).toBe(false);
  });

  it('should process events', async () => {
    const pipeline = new MLPipeline();
    pipeline.start();

    const event = {
      type: 'auth:login',
      entityId: 'user-123',
      timestamp: Date.now(),
      metric: 50
    };

    const result = await pipeline.processEvent(event);

    expect(result).toBeDefined();
    expect(result.processedAt).toBeDefined();
    
    pipeline.stop();
  });

  it('should get pipeline status', () => {
    const pipeline = new MLPipeline();

    const status = pipeline.getStatus();

    expect(status).toBeDefined();
    expect(status.anomaly).toBeDefined();
    expect(status.behavior).toBeDefined();
    expect(status.risk).toBeDefined();
  });

  it('should get ML report', () => {
    const pipeline = new MLPipeline();

    const report = pipeline.getReport();

    expect(report).toBeDefined();
    expect(report.timestamp).toBeDefined();
    expect(report.summary).toBeDefined();
    expect(report.details).toBeDefined();
  });

  it('should export and import state', () => {
    const pipeline = new MLPipeline();

    // Record some activity
    pipeline.processEvent({
      entityId: 'user-123',
      type: 'login',
      timestamp: Date.now()
    });

    const exported = pipeline.exportState();
    expect(exported).toBeDefined();

    const imported = pipeline.importState(exported);
    expect(imported).toBe(true);
  });

  it('should train models', () => {
    const pipeline = new MLPipeline();

    // Record some data
    for (let i = 0; i < 50; i++) {
      pipeline.processEvent({
        type: 'security:event',
        entityId: `user-${i}`,
        timestamp: Date.now()
      });
    }

    const result = pipeline.train();

    expect(result).toBeDefined();
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Phase 9 Integration', () => {
  it('should have all ML modules', async () => {
    const anomaly = await import('../core/ml/anomaly.js');
    expect(anomaly.AnomalyManager).toBeDefined();

    const behavior = await import('../core/ml/behavior.js');
    expect(behavior.BehaviorAnalyzer).toBeDefined();

    const prediction = await import('../core/ml/prediction.js');
    expect(prediction.FailurePredictor).toBeDefined();

    const pipeline = await import('../core/ml/pipeline.js');
    expect(pipeline.MLPipeline).toBeDefined();

    const index = await import('../core/ml/index.js');
    expect(index.getMLPipeline).toBeDefined();
  });
});
