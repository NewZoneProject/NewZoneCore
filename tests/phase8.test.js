// Module: Phase 8 Tests
// Description: Tests for Advanced Analytics modules.
// File: tests/phase8.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// STREAMING TESTS
// ============================================================================

describe('Event Streaming', () => {
  let EventStream, StreamingServer;

  beforeEach(async () => {
    const mod = await import('../core/analytics/streaming.js');
    EventStream = mod.EventStream;
    StreamingServer = mod.StreamingServer;
  });

  it('should create event stream', () => {
    const stream = new EventStream({ maxBuffer: 500 });
    
    expect(stream).toBeDefined();
    expect(stream.maxBuffer).toBe(500);
    expect(stream.subscriptions.size).toBe(0);
  });

  it('should subscribe to events', () => {
    const stream = new EventStream();
    
    stream.subscribe('client-1', ['auth:login', 'auth:logout']);
    
    expect(stream.subscriptions.size).toBe(1);
    expect(stream.subscriptions.get('client-1').eventTypes).toHaveLength(2);
  });

  it('should unsubscribe from events', () => {
    const stream = new EventStream();
    
    stream.subscribe('client-1', ['auth:login']);
    stream.unsubscribe('client-1');
    
    expect(stream.subscriptions.size).toBe(0);
  });

  it('should broadcast events', () => {
    const stream = new EventStream();
    
    const event = stream.broadcast('auth:login', { userId: 'user-123' });
    
    expect(event.type).toBe('auth:login');
    expect(event.payload.userId).toBe('user-123');
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
  });

  it('should buffer events', () => {
    const stream = new EventStream({ maxBuffer: 10 });
    
    for (let i = 0; i < 15; i++) {
      stream.broadcast('test:event', { index: i });
    }
    
    expect(stream.buffer.length).toBe(10);
    expect(stream.buffer[0].payload.index).toBe(5);
  });

  it('should get buffered events', () => {
    const stream = new EventStream();
    
    stream.broadcast('event:1', {});
    stream.broadcast('event:2', {});
    stream.broadcast('event:3', {});
    
    const buffer = stream.getBuffer(null, 2);
    
    expect(buffer.length).toBe(2);
    expect(buffer[0].type).toBe('event:2');
    expect(buffer[1].type).toBe('event:3');
  });

  it('should filter events', () => {
    const stream = new EventStream();
    
    stream.subscribe('client-1', ['auth:*'], { severity: 'high' });
    
    const applies = stream._applyFilter(
      { payload: { severity: 'high', userId: '123' } },
      { severity: 'high' }
    );
    
    const notApplies = stream._applyFilter(
      { payload: { severity: 'low', userId: '123' } },
      { severity: 'high' }
    );
    
    expect(applies).toBe(true);
    expect(notApplies).toBe(false);
  });

  it('should get stream stats', () => {
    const stream = new EventStream();
    
    stream.subscribe('client-1', ['event']);
    stream.broadcast('event', {});
    
    const stats = stream.getStats();
    
    expect(stats.subscribers).toBe(1);
    expect(stats.bufferSize).toBe(1);
  });
});

// ============================================================================
// PROFILING TESTS
// ============================================================================

describe('Performance Profiling', () => {
  let PerformanceMetrics, FunctionProfiler, ProfilerManager;

  beforeEach(async () => {
    const mod = await import('../core/analytics/profiling.js');
    PerformanceMetrics = mod.PerformanceMetrics;
    FunctionProfiler = mod.FunctionProfiler;
    ProfilerManager = mod.ProfilerManager;
  });

  it('should create performance metrics collector', () => {
    const metrics = new PerformanceMetrics({ samples: 50, interval: 1000 });
    
    expect(metrics).toBeDefined();
    expect(metrics.samples).toBe(50);
    expect(metrics.interval).toBe(1000);
  });

  it('should collect memory metrics', () => {
    const metrics = new PerformanceMetrics();
    metrics._collectMetrics();
    
    const current = metrics.getCurrent();
    
    expect(current.memory).toBeDefined();
    expect(current.memory.rss).toBeDefined();
    expect(current.memory.heapUsed).toBeDefined();
  });

  it('should calculate average', () => {
    const metrics = new PerformanceMetrics();
    
    const avg = metrics._calculateAverage([1, 2, 3, 4, 5]);
    
    expect(avg).toBe(3);
  });

  it('should create function profiler', () => {
    const profiler = new FunctionProfiler();
    
    expect(profiler).toBeDefined();
    expect(profiler.profiles.size).toBe(0);
  });

  it('should profile synchronous function', () => {
    const profiler = new FunctionProfiler();
    
    const id = profiler.start('test-function');
    // Simulate work
    const result = 1 + 1;
    const profile = profiler.end(id);
    
    expect(profile.name).toBe('test-function');
    expect(profile.duration).toBeGreaterThanOrEqual(0);
  });

  it('should profile async function', async () => {
    const profiler = new FunctionProfiler();
    
    const { result, profile } = await profiler.profile('async-function', async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return 'done';
    });
    
    expect(result).toBe('done');
    expect(profile.name).toBe('async-function');
    expect(profile.duration).toBeGreaterThanOrEqual(5);
  });

  it('should get profile statistics', () => {
    const profiler = new FunctionProfiler();
    
    for (let i = 0; i < 5; i++) {
      const id = profiler.start('test-fn');
      profiler.end(id);
    }
    
    const stats = profiler.getStats('test-fn');
    
    expect(stats.count).toBe(5);
    expect(stats.duration.min).toBeDefined();
    expect(stats.duration.max).toBeDefined();
    expect(stats.duration.avg).toBeDefined();
  });

  it('should create profiler manager', () => {
    const manager = new ProfilerManager();
    
    expect(manager).toBeDefined();
    expect(manager.enabled).toBe(false);
  });

  it('should start and stop profiling', () => {
    const manager = new ProfilerManager();
    
    manager.start();
    expect(manager.enabled).toBe(true);
    
    manager.stop();
    expect(manager.enabled).toBe(false);
  });

  it('should get profiler status', () => {
    const manager = new ProfilerManager();
    
    const status = manager.getStatus();
    
    expect(status).toBeDefined();
    expect(status.enabled).toBe(false);
    expect(status.metrics).toBeDefined();
  });
});

// ============================================================================
// REPORTING TESTS
// ============================================================================

describe('Automated Reporting', () => {
  let ReportGenerator, ReportScheduler, ReportType, ReportFormat;

  beforeEach(async () => {
    const mod = await import('../core/analytics/reporting.js');
    ReportGenerator = mod.ReportGenerator;
    ReportScheduler = mod.ReportScheduler;
    ReportType = mod.ReportType;
    ReportFormat = mod.ReportFormat;
  });

  it('should create report generator', () => {
    const generator = new ReportGenerator();
    
    expect(generator).toBeDefined();
    expect(generator.outputDir).toBe('./reports');
  });

  it('should register template', async () => {
    const generator = new ReportGenerator({ outputDir: './env_test/reports' });
    await generator.init();
    
    generator.registerTemplate('test-report', async () => ({
      title: 'Test Report',
      data: 'test'
    }));
    
    expect(generator.templates.size).toBe(1);
  });

  it('should generate JSON report', async () => {
    const generator = new ReportGenerator({ outputDir: './env_test/reports' });
    await generator.init();
    
    generator.registerTemplate('json-report', async () => ({
      title: 'JSON Report',
      value: 42
    }));
    
    const result = await generator.generate('json-report', { format: ReportFormat.JSON });
    
    expect(result.type).toBe('json-report');
    expect(result.format).toBe('json');
    expect(result.filename).toContain('report-json-report');
  });

  it('should generate HTML report', async () => {
    const generator = new ReportGenerator({ outputDir: './env_test/reports' });
    await generator.init();
    
    generator.registerTemplate('html-report', async () => ({
      title: 'HTML Report',
      metrics: [{ name: 'cpu', value: 50 }]
    }));
    
    const result = await generator.generate('html-report', { format: ReportFormat.HTML });
    
    expect(result.format).toBe('html');
    expect(result.data.title).toBe('HTML Report');
  });

  it('should generate Markdown report', async () => {
    const generator = new ReportGenerator({ outputDir: './env_test/reports' });
    await generator.init();
    
    generator.registerTemplate('md-report', async () => ({
      title: 'Markdown Report',
      summary: 'Test summary'
    }));
    
    const result = await generator.generate('md-report', { format: ReportFormat.MARKDOWN });
    
    expect(result.format).toBe('markdown');
  });

  it('should list reports', async () => {
    const generator = new ReportGenerator({ outputDir: './env_test/reports' });
    await generator.init();
    
    const reports = await generator.listReports();
    
    expect(Array.isArray(reports)).toBe(true);
  });

  it('should create report scheduler', async () => {
    const generator = new ReportGenerator({ outputDir: './env_test/reports' });
    await generator.init();
    
    const scheduler = new ReportScheduler(generator);
    
    expect(scheduler).toBeDefined();
    expect(scheduler.schedules.size).toBe(0);
  });

  it('should schedule report', async () => {
    const generator = new ReportGenerator({ outputDir: './env_test/reports' });
    await generator.init();
    
    const scheduler = new ReportScheduler(generator);
    
    scheduler.schedule('daily-test', 'daily', 'daily', { format: 'json' });
    
    expect(scheduler.schedules.size).toBe(1);
    expect(scheduler.getSchedules()['daily-test']).toBeDefined();
    
    scheduler.cancel('daily-test');
  });

  it('should parse schedule strings', async () => {
    const generator = new ReportGenerator();
    const scheduler = new ReportScheduler(generator);
    
    expect(scheduler._parseSchedule('hourly')).toBe(3600000);
    expect(scheduler._parseSchedule('daily')).toBe(86400000);
    expect(scheduler._parseSchedule('weekly')).toBe(604800000);
    expect(scheduler._parseSchedule(5000)).toBe(5000);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Phase 8 Integration', () => {
  it('should have all Phase 8 modules', async () => {
    // Streaming
    const streaming = await import('../core/analytics/streaming.js');
    expect(streaming.EventStream).toBeDefined();
    expect(streaming.StreamingServer).toBeDefined();

    // Profiling
    const profiling = await import('../core/analytics/profiling.js');
    expect(profiling.PerformanceMetrics).toBeDefined();
    expect(profiling.FunctionProfiler).toBeDefined();
    expect(profiling.ProfilerManager).toBeDefined();

    // Reporting
    const reporting = await import('../core/analytics/reporting.js');
    expect(reporting.ReportGenerator).toBeDefined();
    expect(reporting.ReportScheduler).toBeDefined();
    expect(reporting.ReportType).toBeDefined();
    expect(reporting.ReportFormat).toBeDefined();
  });

  it('should have OpenAPI documentation', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const openapiPath = path.join(__dirname, '../docs/api/openapi.yaml');
    
    const content = await fs.readFile(openapiPath, 'utf-8');
    
    expect(content).toContain('openapi: 3.0');
    expect(content).toContain('NewZoneCore API');
    expect(content).toContain('/api/auth/login');
    expect(content).toContain('/api/identity');
    expect(content).toContain('/health');
    expect(content).toContain('/metrics');
  });
});
