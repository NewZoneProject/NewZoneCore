// Module: Observability Tests
// Description: Test suite for metrics, tracing, alerts, backup, and recovery.
// File: tests/observability.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ============================================================================
// METRICS TESTS
// ============================================================================

describe('Metrics', () => {
  let MetricCollector;

  beforeEach(async () => {
    const mod = await import('../core/observability/metrics.js');
    MetricCollector = mod.MetricCollector;
  });

  it('should create metric collector', () => {
    const collector = new MetricCollector({ prefix: 'test' });
    expect(collector).toBeDefined();
    expect(collector.prefix).toBe('test');
  });

  it('should register counter metric', () => {
    const collector = new MetricCollector();
    const metric = collector.counter('test_counter', 'Test counter description');
    
    expect(metric).toBeDefined();
    expect(metric.name).toBe('nzcore_test_counter');
    expect(metric.type).toBe('counter');
  });

  it('should register gauge metric', () => {
    const collector = new MetricCollector();
    const metric = collector.gauge('test_gauge', 'Test gauge description');
    
    expect(metric).toBeDefined();
    expect(metric.name).toBe('nzcore_test_gauge');
    expect(metric.type).toBe('gauge');
  });

  it('should increment counter', () => {
    const collector = new MetricCollector();
    collector.counter('requests', 'Total requests');
    
    collector.inc('requests', {}, 1);
    expect(collector.get('requests')).toBe(1);
    
    collector.inc('requests', {}, 5);
    expect(collector.get('requests')).toBe(6);
  });

  it('should set gauge value', () => {
    const collector = new MetricCollector();
    collector.gauge('temperature', 'Current temperature');
    
    collector.set('temperature', 25);
    expect(collector.get('temperature')).toBe(25);
    
    collector.set('temperature', 30);
    expect(collector.get('temperature')).toBe(30);
  });

  it('should handle labeled metrics', () => {
    const collector = new MetricCollector();
    collector.counter('http_requests', 'HTTP requests', ['method', 'status']);
    
    collector.inc('http_requests', { method: 'GET', status: '200' }, 1);
    collector.inc('http_requests', { method: 'POST', status: '200' }, 1);
    collector.inc('http_requests', { method: 'GET', status: '404' }, 1);
    
    expect(collector.get('http_requests', { method: 'GET', status: '200' })).toBe(1);
    expect(collector.get('http_requests', { method: 'POST', status: '200' })).toBe(1);
    expect(collector.get('http_requests', { method: 'GET', status: '404' })).toBe(1);
  });

  it('should generate Prometheus format', () => {
    const collector = new MetricCollector();
    collector.counter('requests', 'Total requests');
    collector.inc('requests', {}, 10);
    
    const prometheus = collector.toPrometheus();
    
    expect(prometheus).toContain('# HELP nzcore_requests Total requests');
    expect(prometheus).toContain('# TYPE nzcore_requests counter');
    expect(prometheus).toContain('nzcore_requests 10');
  });

  it('should update system metrics', () => {
    const collector = new MetricCollector();
    collector.updateSystemMetrics();
    
    expect(collector.get('uptime_seconds')).toBeDefined();
    expect(collector.get('memory_heap_used_bytes')).toBeDefined();
    expect(collector.get('memory_rss_bytes')).toBeDefined();
  });
});

// ============================================================================
// HEALTH CHECKER TESTS
// ============================================================================

describe('HealthChecker', () => {
  let HealthChecker;

  beforeEach(async () => {
    const mod = await import('../core/observability/metrics.js');
    HealthChecker = mod.HealthChecker;
  });

  it('should create health checker', () => {
    const checker = new HealthChecker({ interval: 60000 });
    expect(checker).toBeDefined();
    expect(checker.interval).toBe(60000);
  });

  it('should register health check', () => {
    const checker = new HealthChecker();
    
    checker.register('test', async () => ({ ok: true }));
    
    expect(checker.checks.has('test')).toBe(true);
  });

  it('should run health checks', async () => {
    const checker = new HealthChecker();
    
    checker.register('healthy', async () => {
      return { ok: true };
    });
    
    checker.register('unhealthy', async () => {
      throw new Error('Service down');
    });
    
    const results = await checker.runChecks();
    
    expect(results.healthy.status).toBe('healthy');
    expect(results.unhealthy.status).toBe('unhealthy');
  });

  it('should get overall health status', async () => {
    const checker = new HealthChecker();
    
    checker.register('service1', async () => ({ ok: true }));
    checker.register('service2', async () => ({ ok: true }));
    checker.register('service3', async () => { throw new Error('Down'); });
    
    await checker.runChecks();
    
    const status = checker.getStatus();
    
    expect(status.status).toBe('degraded');
    expect(status.summary.total).toBe(3);
    expect(status.summary.healthy).toBe(2);
    expect(status.summary.unhealthy).toBe(1);
  });

  it('should handle check timeout', async () => {
    const checker = new HealthChecker({ timeout: 100 });
    
    checker.register('slow', async () => {
      return new Promise(resolve => setTimeout(resolve, 1000));
    });
    
    const results = await checker.runChecks();
    
    expect(results.slow.status).toBe('unhealthy');
    expect(results.slow.error).toContain('Timeout');
  });
});

// ============================================================================
// TRACING TESTS
// ============================================================================

describe('Tracing', () => {
  let TraceContext, Span, Tracer, SpanKind, SpanStatus;

  beforeEach(async () => {
    const mod = await import('../core/observability/tracing.js');
    TraceContext = mod.TraceContext;
    Span = mod.Span;
    Tracer = mod.Tracer;
    SpanKind = mod.SpanKind;
    SpanStatus = mod.SpanStatus;
  });

  it('should create trace context', () => {
    const context = new TraceContext();
    
    expect(context.traceId).toHaveLength(32);
    expect(context.spanId).toHaveLength(16);
    expect(context.traceFlags).toBe(0x01);
  });

  it('should create child context', () => {
    const parent = new TraceContext();
    const child = parent.child();
    
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentId).toBe(parent.spanId);
    expect(child.spanId).not.toBe(parent.spanId);
  });

  it('should serialize to W3C traceparent', () => {
    const context = new TraceContext({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 0x01
    });
    
    const traceparent = context.toTraceparent();
    
    expect(traceparent).toBe('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  });

  it('should parse W3C traceparent', () => {
    const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const context = TraceContext.fromTraceparent(header);
    
    expect(context.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(context.spanId).toBe('00f067aa0ba902b7');
    expect(context.traceFlags).toBe(0x01);
  });

  it('should create span', () => {
    const context = new TraceContext();
    const span = new Span('test-operation', context, { kind: SpanKind.SERVER });
    
    expect(span.name).toBe('test-operation');
    expect(span.kind).toBe('SERVER');
    expect(span.status).toBe('UNSET');
  });

  it('should set span attributes', () => {
    const context = new TraceContext();
    const span = new Span('test', context);
    
    span.setAttribute('http.method', 'GET');
    span.setAttribute('http.url', 'http://example.com');
    
    expect(span.attributes.get('http.method')).toBe('GET');
    expect(span.attributes.get('http.url')).toBe('http://example.com');
  });

  it('should add span events', () => {
    const context = new TraceContext();
    const span = new Span('test', context);
    
    span.addEvent('request_received', { size: 1024 });
    span.addEvent('response_sent', { status: 200 });
    
    expect(span.events).toHaveLength(2);
    expect(span.events[0].name).toBe('request_received');
  });

  it('should record exception', () => {
    const context = new TraceContext();
    const span = new Span('test', context);
    
    const error = new Error('Test error');
    span.recordException(error);
    
    expect(span.status).toBe('ERROR');
    expect(span.events.some(e => e.name === 'exception')).toBe(true);
  });

  it('should create tracer', () => {
    const tracer = new Tracer('test-service', { version: '1.0.0' });
    
    expect(tracer.serviceName).toBe('test-service');
    expect(tracer.version).toBe('1.0.0');
  });

  it('should start and end span', () => {
    const tracer = new Tracer('test-service');
    
    const span = tracer.startSpan('test-operation');
    
    expect(span).toBeDefined();
    expect(span.endTime).toBeNull();
    
    span.end();
    
    expect(span.endTime).toBeDefined();
    expect(span.duration).toBeGreaterThanOrEqual(0);
  });

  it('should trace async function', async () => {
    const tracer = new Tracer('test-service');
    
    const result = await tracer.trace('test-op', async (span) => {
      span.setAttribute('test', 'value');
      return 'success';
    });
    
    expect(result).toBe('success');
  });

  it('should handle exception in traced function', async () => {
    const tracer = new Tracer('test-service');
    
    await expect(
      tracer.trace('test-op', async () => {
        throw new Error('Test error');
      })
    ).rejects.toThrow('Test error');
  });
});

// ============================================================================
// ALERTS TESTS
// ============================================================================

describe('Alerts', () => {
  let AlertManager, AlertDefinition, AlertSeverity, AlertStatus;

  beforeEach(async () => {
    const mod = await import('../core/observability/alerts.js');
    AlertManager = mod.AlertManager;
    AlertDefinition = mod.AlertDefinition;
    AlertSeverity = mod.AlertSeverity;
    AlertStatus = mod.AlertStatus;
  });

  it('should create alert definition', () => {
    const alert = new AlertDefinition('HighCPU', {
      description: 'CPU usage is high',
      severity: AlertSeverity.HIGH,
      condition: (ctx) => ctx.cpu > 0.8
    });
    
    expect(alert.name).toBe('HighCPU');
    expect(alert.severity).toBe('high');
    expect(alert.currentState).toBe('pending');
  });

  it('should check alert condition', () => {
    const alert = new AlertDefinition('HighCPU', {
      condition: (ctx) => ctx.cpu > 0.8
    });
    
    expect(alert.check({ cpu: 0.9 })).toBe(true);
    expect(alert.check({ cpu: 0.5 })).toBe(false);
  });

  it('should create alert manager', () => {
    const manager = new AlertManager();
    expect(manager).toBeDefined();
    expect(manager.alerts.size).toBe(0);
  });

  it('should register alert', () => {
    const manager = new AlertManager();
    
    const alert = new AlertDefinition('TestAlert', {
      condition: () => false
    });
    
    manager.registerAlert(alert);
    
    expect(manager.alerts.has('TestAlert')).toBe(true);
  });

  it('should fire alert when condition is met', async () => {
    const manager = new AlertManager({ checkInterval: 1000 });
    
    let conditionMet = false;
    manager.registerAlert(new AlertDefinition('TestAlert', {
      condition: () => conditionMet
    }));
    
    // Initially no alerts
    expect(manager.getActive()).toHaveLength(0);
    
    // Met condition
    conditionMet = true;
    await manager.checkAlerts();
    
    expect(manager.getActive()).toHaveLength(1);
    expect(manager.getActive()[0].status).toBe('firing');
  });

  it('should resolve alert when condition clears', async () => {
    const manager = new AlertManager({ checkInterval: 1000 });
    
    let conditionMet = true;
    manager.registerAlert(new AlertDefinition('TestAlert', {
      condition: () => conditionMet
    }));
    
    // Fire alert
    await manager.checkAlerts();
    expect(manager.getActive()).toHaveLength(1);
    
    // Clear condition
    conditionMet = false;
    await manager.checkAlerts();
    
    expect(manager.getActive()).toHaveLength(0);
  });

  it('should silence alert', () => {
    const manager = new AlertManager();
    
    const alert = new AlertDefinition('TestAlert', {
      condition: () => true
    });
    
    manager.registerAlert(alert);
    manager.silence('TestAlert', { duration: 3600000 });
    
    expect(manager.isSilenced(alert)).toBeDefined();
  });

  it('should register context provider', async () => {
    const manager = new AlertManager();
    
    manager.registerContextProvider('metrics', async () => ({
      cpu: 0.9,
      memory: 0.8
    }));
    
    const context = await manager.getContext();
    
    expect(context.cpu).toBe(0.9);
    expect(context.memory).toBe(0.8);
  });
});

// ============================================================================
// BACKUP TESTS
// ============================================================================

describe('Backup', () => {
  let BackupManager, BackupType, BackupStatus;

  beforeEach(async () => {
    const mod = await import('../core/observability/backup.js');
    BackupManager = mod.BackupManager;
    BackupType = mod.BackupType;
    BackupStatus = mod.BackupStatus;
  });

  it('should create backup manager', async () => {
    const manager = new BackupManager({
      backupDir: './env_test/backups',
      envDir: './env_test'
    });
    
    await manager.init();
    
    expect(manager).toBeDefined();
    expect(manager.backupDir).toBe('./env_test/backups');
  });

  it('should create backup metadata', () => {
    const { BackupMetadata } = require('../core/observability/backup.js');
    
    const metadata = new BackupMetadata({
      type: BackupType.FULL,
      description: 'Test backup'
    });
    
    expect(metadata.type).toBe('full');
    expect(metadata.description).toBe('Test backup');
    expect(metadata.status).toBe('pending');
  });

  it('should list backups', async () => {
    const manager = new BackupManager({
      backupDir: './env_test/backups',
      envDir: './env_test'
    });
    
    await manager.init();
    
    const backups = manager.listBackups();
    expect(Array.isArray(backups)).toBe(true);
  });
});

// ============================================================================
// RECOVERY TESTS
// ============================================================================

describe('Recovery', () => {
  let RecoveryManager, StateSnapshot;

  beforeEach(async () => {
    const mod = await import('../core/observability/recovery.js');
    RecoveryManager = mod.RecoveryManager;
    StateSnapshot = mod.StateSnapshot;
  });

  it('should create state snapshot', () => {
    const snapshot = new StateSnapshot({
      supervisor: { status: 'running' },
      services: [{ name: 'test', state: 'running' }]
    });
    
    expect(snapshot.id).toBeDefined();
    expect(snapshot.supervisor.status).toBe('running');
    expect(snapshot.services).toHaveLength(1);
  });

  it('should calculate and verify checksum', () => {
    const snapshot = new StateSnapshot({
      supervisor: { status: 'running' },
      services: [{ name: 'test', state: 'running' }]
    });
    
    snapshot.calculateChecksum();
    
    expect(snapshot.checksum).toBeDefined();
    expect(snapshot.verify()).toBe(true);
  });

  it('should detect corrupted snapshot', () => {
    const snapshot = new StateSnapshot({
      supervisor: { status: 'running' }
    });
    
    snapshot.calculateChecksum();
    
    // Tamper with data
    snapshot.supervisor.status = 'stopped';
    
    expect(snapshot.verify()).toBe(false);
  });

  it('should create recovery manager', async () => {
    const manager = new RecoveryManager({
      stateDir: './env_test/state'
    });
    
    await manager.init();
    
    expect(manager).toBeDefined();
    expect(manager.stateDir).toBe('./env_test/state');
  });
});

// ============================================================================
// SHUTDOWN TESTS
// ============================================================================

describe('Shutdown', () => {
  let ShutdownManager;

  beforeEach(async () => {
    const mod = await import('../core/observability/shutdown.js');
    ShutdownManager = mod.ShutdownManager;
  });

  it('should create shutdown manager', () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    expect(manager).toBeDefined();
    expect(manager.timeout).toBe(5000);
    expect(manager.isShuttingDown).toBe(false);
  });

  it('should register cleanup handler', () => {
    const manager = new ShutdownManager();
    
    manager.register('test', async () => {
      console.log('Cleanup');
    });
    
    expect(manager.cleanupHandlers.size).toBe(1);
  });

  it('should run cleanup handlers on shutdown', async () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    
    let cleanupCalled = false;
    
    manager.register('test', async () => {
      cleanupCalled = true;
    });
    
    await manager.shutdown('test');
    
    expect(cleanupCalled).toBe(true);
    expect(manager.isShutdown).toBe(true);
  });

  it('should respect handler priority', async () => {
    const manager = new ShutdownManager();
    
    const order = [];
    
    manager.register('first', async () => order.push(1), 1);
    manager.register('second', async () => order.push(2), 2);
    manager.register('third', async () => order.push(3), 3);
    
    await manager.shutdown('test');
    
    expect(order).toEqual([1, 2, 3]);
  });

  it('should handle cleanup errors', async () => {
    const manager = new ShutdownManager({ timeout: 5000 });
    
    manager.register('failing', async () => {
      throw new Error('Cleanup failed');
    });
    
    // Should not throw
    await expect(manager.shutdown('test')).resolves.toBeDefined();
  });

  it('should timeout slow handlers', async () => {
    const manager = new ShutdownManager({ timeout: 100 });
    
    manager.register('slow', async () => {
      return new Promise(resolve => setTimeout(resolve, 1000));
    });
    
    const result = await manager.shutdown('test');
    
    expect(result.results[0].status).toBe('error');
    expect(result.results[0].error).toContain('Timeout');
  });

  it('should get shutdown status', () => {
    const manager = new ShutdownManager();
    
    const status = manager.getStatus();
    
    expect(status.isShuttingDown).toBe(false);
    expect(status.isShutdown).toBe(false);
    expect(status.handlers).toBe(0);
  });
});
