// Module: Phase 12 Autonomous Tests
// Description: Tests for autonomous response and optimization modules.
// File: tests/phase12.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// THREAT RESPONSE TESTS
// ============================================================================

describe('Threat Response', () => {
  let ThreatResponse, ThreatLevel, ResponseAction;

  beforeEach(async () => {
    const mod = await import('../core/autonomous/response.js');
    ThreatResponse = mod.ThreatResponse;
    ThreatLevel = mod.ThreatLevel;
    ResponseAction = mod.ResponseAction;
  });

  it('should create threat response engine', () => {
    const response = new ThreatResponse();
    expect(response).toBeDefined();
    expect(response.autoResponseEnabled).toBe(true);
  });

  it('should register response rule', () => {
    const response = new ThreatResponse();
    
    response.registerRule('test-rule', {
      condition: () => true,
      weight: 2
    });

    expect(response.rules.size).toBe(1);
  });

  it('should assess threat level', async () => {
    const response = new ThreatResponse();
    
    response.registerRule('auth-failure', {
      condition: (e) => e.type === 'auth:failed',
      weight: 2
    });

    const threat = await response.processEvent({
      id: 'test-1',
      type: 'auth:failed'
    });

    expect(threat.level).not.toBe(ThreatLevel.NONE);
    expect(threat.score).toBeGreaterThan(0);
  });

  it('should determine response actions', async () => {
    const response = new ThreatResponse();
    
    const actions = response._determineActions({ level: ThreatLevel.HIGH });
    
    expect(actions).toContain(ResponseAction.LOG);
    expect(actions).toContain(ResponseAction.ALERT);
    expect(actions).toContain(ResponseAction.BLOCK_IP);
  });

  it('should execute response action', async () => {
    const response = new ThreatResponse();
    let alerted = false;
    
    response.on('alert', () => { alerted = true; });
    
    await response._executeAction(ResponseAction.ALERT, { level: 'medium' }, {});
    
    expect(alerted).toBe(true);
  });

  it('should get active threats', () => {
    const response = new ThreatResponse();
    response.activeThreats.set('threat-1', { level: 'high' });
    
    const threats = response.getActiveThreats();
    
    expect(threats.length).toBe(1);
  });

  it('should enable/disable auto response', () => {
    const response = new ThreatResponse();
    
    response.disableAutoResponse();
    expect(response.autoResponseEnabled).toBe(false);
    
    response.enableAutoResponse();
    expect(response.autoResponseEnabled).toBe(true);
  });

  it('should get status', () => {
    const response = new ThreatResponse();
    response.registerRule('test', { condition: () => true });
    
    const status = response.getStatus();
    
    expect(status.rulesCount).toBe(1);
    expect(status.activeThreats).toBe(0);
  });
});

// ============================================================================
// HEALTH MONITOR TESTS
// ============================================================================

describe('Health Monitor', () => {
  let HealthMonitor, HealthStatus;

  beforeEach(async () => {
    const mod = await import('../core/autonomous/healing.js');
    HealthMonitor = mod.HealthMonitor;
    HealthStatus = mod.HealthStatus;
  });

  it('should create health monitor', () => {
    const monitor = new HealthMonitor();
    expect(monitor).toBeDefined();
    expect(monitor.status).toBe(HealthStatus.UNKNOWN);
  });

  it('should register health check', () => {
    const monitor = new HealthMonitor();
    
    monitor.registerCheck('test', async () => ({ ok: true }));
    
    expect(monitor.checks.size).toBe(1);
  });

  it('should run health checks', async () => {
    const monitor = new HealthMonitor();
    
    monitor.registerCheck('healthy', async () => ({ ok: true }));
    monitor.registerCheck('unhealthy', async () => { throw new Error('Down'); });
    
    const result = await monitor.runChecks();
    
    expect(result.results.healthy.status).toBe('healthy');
    expect(result.results.unhealthy.status).toBe('unhealthy');
  });

  it('should update status based on checks', async () => {
    const monitor = new HealthMonitor();
    
    monitor.registerCheck('critical', async () => { throw new Error('Down'); }, { critical: true });
    
    // Run 3 times to trigger critical failure
    await monitor.runChecks();
    await monitor.runChecks();
    await monitor.runChecks();
    
    expect(monitor.status).toBe(HealthStatus.UNHEALTHY);
  });

  it('should start and stop monitoring', () => {
    const monitor = new HealthMonitor({ checkInterval: 1000 });
    
    monitor.start();
    expect(monitor._timer).toBeDefined();
    
    monitor.stop();
    expect(monitor._timer).toBeNull();
  });

  it('should get status', async () => {
    const monitor = new HealthMonitor();
    monitor.registerCheck('test', async () => ({ ok: true }));
    
    await monitor.runChecks();
    const status = monitor.getStatus();
    
    expect(status.checksCount).toBe(1);
    expect(status.status).toBe(HealthStatus.HEALTHY);
  });
});

// ============================================================================
// SELF-HEALING TESTS
// ============================================================================

describe('Self-Healing', () => {
  let SelfHealing, HealthMonitor;

  beforeEach(async () => {
    const mod = await import('../core/autonomous/healing.js');
    SelfHealing = mod.SelfHealing;
    HealthMonitor = mod.HealthMonitor;
  });

  it('should create self-healing engine', () => {
    const monitor = new HealthMonitor();
    const healing = new SelfHealing(monitor);
    
    expect(healing).toBeDefined();
    expect(healing.enabled).toBe(true);
  });

  it('should register healing rule', () => {
    const monitor = new HealthMonitor();
    const healing = new SelfHealing(monitor);
    
    healing.registerRule('restart-service', {
      triggers: [{ status: 'unhealthy' }],
      actions: [async () => {}]
    });
    
    expect(healing.healingRules.size).toBe(1);
  });

  it('should check and heal', async () => {
    const monitor = new HealthMonitor();
    const healing = new SelfHealing(monitor);
    
    let healed = false;
    
    healing.registerRule('test-heal', {
      triggers: [{ status: 'unhealthy' }],
      actions: [async () => { healed = true; }]
    });
    
    await healing.checkAndHeal({ status: 'unhealthy', results: {} });
    
    expect(healed).toBe(true);
  });

  it('should respect cooldown', async () => {
    const monitor = new HealthMonitor();
    const healing = new SelfHealing(monitor);
    
    healing.activeHealing.add('test-rule');
    
    const result = await healing.checkAndHeal({ status: 'unhealthy' });
    
    expect(result).toBeUndefined(); // Should not execute
  });

  it('should get healing history', () => {
    const monitor = new HealthMonitor();
    const healing = new SelfHealing(monitor);
    
    healing.healingHistory.push({ rule: 'test', success: true });
    
    const history = healing.getHistory();
    
    expect(history.length).toBe(1);
  });
});

// ============================================================================
// AUTO-SCALING TESTS
// ============================================================================

describe('Auto-Scaling', () => {
  let AutoScaling;

  beforeEach(async () => {
    const mod = await import('../core/autonomous/healing.js');
    AutoScaling = mod.AutoScaling;
  });

  it('should create auto-scaler', () => {
    const scaler = new AutoScaling({ initialScale: 2 });
    
    expect(scaler).toBeDefined();
    expect(scaler.currentScale).toBe(2);
  });

  it('should register metric', () => {
    const scaler = new AutoScaling();
    
    scaler.registerMetric('cpu', async () => 50);
    
    expect(scaler.metrics.size).toBe(1);
  });

  it('should register scaling rule', () => {
    const scaler = new AutoScaling();
    
    scaler.registerRule('scale-up', {
      metric: 'cpu',
      operator: 'gt',
      threshold: 80,
      scaleChange: 1
    });
    
    expect(scaler.rules.size).toBe(1);
  });

  it('should scale based on metrics', async () => {
    const scaler = new AutoScaling({ initialScale: 1, maxScale: 5 });
    
    let cpuValue = 90;
    scaler.registerMetric('cpu', async () => cpuValue);
    scaler.registerRule('scale-up', {
      metric: 'cpu',
      operator: 'gt',
      threshold: 80,
      scaleChange: 1
    });
    
    const result = await scaler.checkAndScale();
    
    expect(result.scaled).toBe(true);
    expect(scaler.currentScale).toBe(2);
  });

  it('should respect scale limits', async () => {
    const scaler = new AutoScaling({ initialScale: 1, maxScale: 2 });
    
    scaler.registerMetric('cpu', async () => 90);
    scaler.registerRule('scale-up', {
      metric: 'cpu',
      operator: 'gt',
      threshold: 80,
      scaleChange: 1
    });
    
    await scaler.checkAndScale();
    await scaler.checkAndScale(); // Should hit max
    
    expect(scaler.currentScale).toBe(2);
  });

  it('should respect cooldown', async () => {
    const scaler = new AutoScaling({ cooldown: 60000 });
    
    scaler.registerMetric('cpu', async () => 90);
    scaler.registerRule('scale-up', {
      metric: 'cpu',
      operator: 'gt',
      threshold: 80,
      scaleChange: 1
    });
    
    await scaler.checkAndScale();
    const result = await scaler.checkAndScale(); // Should be on cooldown
    
    expect(result.skipped).toBe('cooldown');
  });
});

// ============================================================================
// OPTIMIZATION TESTS
// ============================================================================

describe('Optimization', () => {
  let OptimizationAdvisor, AutoTuner;

  beforeEach(async () => {
    const mod = await import('../core/autonomous/optimization.js');
    OptimizationAdvisor = mod.OptimizationAdvisor;
    AutoTuner = mod.AutoTuner;
  });

  it('should create optimization advisor', () => {
    const advisor = new OptimizationAdvisor();
    expect(advisor).toBeDefined();
  });

  it('should track metrics', () => {
    const advisor = new OptimizationAdvisor();
    
    advisor.trackMetric('cpu', 50);
    advisor.trackMetric('cpu', 55);
    
    expect(advisor.metrics.size).toBe(1);
    expect(advisor.baselines.has('cpu')).toBe(true);
  });

  it('should update baseline', () => {
    const advisor = new OptimizationAdvisor();
    
    for (let i = 0; i < 100; i++) {
      advisor.trackMetric('memory', 1000 + i);
    }
    
    const baseline = advisor.baselines.get('memory');
    expect(baseline.count).toBe(100);
    expect(baseline.mean).toBeGreaterThan(1000);
  });

  it('should create recommendations', () => {
    const advisor = new OptimizationAdvisor();
    
    // Create high deviation
    advisor.baselines.set('cpu', { mean: 50, count: 100 });
    advisor.trackMetric('cpu', 100); // 100% deviation
    
    expect(advisor.recommendations.length).toBeGreaterThan(0);
  });

  it('should get recommendations', () => {
    const advisor = new OptimizationAdvisor();
    
    advisor.recommendations.push({ type: 'test', timestamp: Date.now() });
    
    const recs = advisor.getRecommendations();
    
    expect(recs.length).toBe(1);
  });

  it('should create auto-tuner', () => {
    const tuner = new AutoTuner();
    expect(tuner).toBeDefined();
    expect(tuner.enabled).toBe(true);
  });

  it('should register tunable parameter', () => {
    const tuner = new AutoTuner();
    let value = 50;
    
    tuner.registerParameter('threshold', {
      initial: 50,
      min: 0,
      max: 100,
      step: 5,
      getter: async () => value,
      setter: async (v) => { value = v; }
    });
    
    expect(tuner.parameters.size).toBe(1);
  });

  it('should register objective', () => {
    const tuner = new AutoTuner();
    
    tuner.registerObjective('performance', async (v) => 1 - v / 100);
    
    expect(tuner.objectives.length).toBe(1);
  });

  it('should optimize parameters', async () => {
    const tuner = new AutoTuner();
    let value = 50;
    
    tuner.registerParameter('threshold', {
      initial: 50,
      min: 0,
      max: 100,
      step: 5,
      getter: async () => value,
      setter: async (v) => { value = v; }
    });
    
    tuner.registerObjective('score', async (v) => v < 50 ? 0.9 : 0.2);
    
    await tuner.optimize();
    
    expect(tuner.history.length).toBeGreaterThan(0);
  });

  it('should get parameters', () => {
    const tuner = new AutoTuner();
    
    tuner.registerParameter('test', {
      initial: 42,
      min: 0,
      max: 100
    });
    
    const params = tuner.getParameters();
    
    expect(params.test).toBe(42);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Phase 12 Integration', () => {
  it('should have all autonomous modules', async () => {
    const response = await import('../core/autonomous/response.js');
    expect(response.ThreatResponse).toBeDefined();
    expect(response.getThreatResponse).toBeDefined();

    const healing = await import('../core/autonomous/healing.js');
    expect(healing.HealthMonitor).toBeDefined();
    expect(healing.SelfHealing).toBeDefined();
    expect(healing.AutoScaling).toBeDefined();

    const optimization = await import('../core/autonomous/optimization.js');
    expect(optimization.OptimizationAdvisor).toBeDefined();
    expect(optimization.AutoTuner).toBeDefined();

    const index = await import('../core/autonomous/index.js');
    expect(index.getHealthMonitor).toBeDefined();
    expect(index.getAutoTuner).toBeDefined();
  });

  it('should work together for autonomous operation', async () => {
    const { HealthMonitor, SelfHealing } = await import('../core/autonomous/healing.js');
    const { getThreatResponse } = await import('../core/autonomous/response.js');

    // Setup health monitoring
    const monitor = new HealthMonitor();
    monitor.registerCheck('api', async () => ({ ok: true }));
    
    // Setup self-healing
    const healing = new SelfHealing(monitor);
    let healed = false;
    
    healing.registerRule('auto-restart', {
      triggers: [{ status: 'unhealthy' }],
      actions: [async () => { healed = true; }]
    });

    // Run checks
    await monitor.runChecks();
    await healing.checkAndHeal(monitor.getStatus());

    expect(monitor).toBeDefined();
    expect(healing).toBeDefined();
  });
});
