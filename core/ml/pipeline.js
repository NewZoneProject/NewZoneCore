// Module: ML Pipeline
// Description: Machine learning pipeline orchestration for NewZoneCore.
//              Coordinates anomaly detection, behavior analysis, and prediction.
// File: core/ml/pipeline.js

import { EventEmitter } from 'events';
import { getAnomalyManager, createAnomalyManager } from './anomaly.js';
import { getBehaviorAnalyzer, getEntityRiskScorer } from './behavior.js';
import { getFailurePredictor, getCapacityPlanner } from './prediction.js';

// ============================================================================
// ML PIPELINE
// ============================================================================

export class MLPipeline extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = options;
    this.enabled = false;
    
    // Initialize components
    this.anomalyManager = createAnomalyManager(options.anomaly);
    this.behaviorAnalyzer = getBehaviorAnalyzer(options.behavior);
    this.riskScorer = getEntityRiskScorer(options.risk);
    this.failurePredictor = getFailurePredictor(options.prediction);
    this.capacityPlanner = getCapacityPlanner(options.capacity);
    
    // Event correlations
    this.eventBuffer = [];
    this.maxBuffer = options.maxBuffer || 1000;
    
    // Auto-training
    this.autoTrainInterval = options.autoTrainInterval || 3600000; // 1 hour
    this._trainTimer = null;
    
    this._setupEventHandlers();
  }

  /**
   * Setup event handlers.
   */
  _setupEventHandlers() {
    // Anomaly events
    this.anomalyManager.on('alert', (alert) => {
      this._handleAlert(alert);
    });

    // Behavior events
    this.behaviorAnalyzer.on('anomaly', (data) => {
      this._handleBehaviorAnomaly(data);
    });

    this.behaviorAnalyzer.on('high_risk', (data) => {
      this._handleHighRisk(data);
    });

    // Failure prediction events
    this.failurePredictor.on('failure_warning', (data) => {
      this._handleFailureWarning(data);
    });

    // Capacity events
    this.capacityPlanner.on('capacity_warning', (data) => {
      this._handleCapacityWarning(data);
    });
  }

  /**
   * Start the pipeline.
   */
  start() {
    if (this.enabled) return;

    this.enabled = true;
    
    // Start auto-training
    this._trainTimer = setInterval(() => {
      this.train();
    }, this.autoTrainInterval);

    console.log('[ml] ML Pipeline started');
    this.emit('started');
  }

  /**
   * Stop the pipeline.
   */
  stop() {
    if (!this.enabled) return;

    this.enabled = false;
    
    if (this._trainTimer) {
      clearInterval(this._trainTimer);
      this._trainTimer = null;
    }

    console.log('[ml] ML Pipeline stopped');
    this.emit('stopped');
  }

  /**
   * Process event through pipeline.
   */
  async processEvent(event) {
    if (!this.enabled) return event;

    const enrichedEvent = {
      ...event,
      processedAt: new Date().toISOString(),
      mlResults: {}
    };

    // Add to buffer
    this.eventBuffer.push(enrichedEvent);
    if (this.eventBuffer.length > this.maxBuffer) {
      this.eventBuffer.shift();
    }

    // Process through anomaly detection
    if (event.type?.startsWith('security:') || event.type?.startsWith('auth:')) {
      this.anomalyManager.recordSecurityEvent(event);
    }

    // Process through behavior analysis
    if (event.entityId) {
      const result = this.behaviorAnalyzer.recordActivity(
        event.entityId,
        event,
        event.entityType || 'user'
      );
      enrichedEvent.mlResults.behavior = result.anomaly;
    }

    // Process metrics through failure prediction
    if (event.metric !== undefined) {
      const prediction = this.failurePredictor.record(event.metric, event.metric);
      enrichedEvent.mlResults.failure = prediction;
    }

    // Process resource usage through capacity planning
    if (event.resource && event.usage !== undefined) {
      this.capacityPlanner.record(event.resource, event.usage, event.capacity || 100);
    }

    // Update risk score
    if (event.entityId && event.riskFactors) {
      const score = this.riskScorer.update(event.entityId, event.riskFactors);
      enrichedEvent.mlResults.riskScore = score;
    }

    this.emit('processed', enrichedEvent);
    return enrichedEvent;
  }

  /**
   * Handle anomaly alert.
   */
  _handleAlert(alert) {
    console.log(`[ml] Anomaly alert: ${alert.source} - ${alert.severity}`);
    this.emit('alert', alert);
  }

  /**
   * Handle behavior anomaly.
   */
  _handleBehaviorAnomaly(data) {
    console.log(`[ml] Behavior anomaly: ${data.entityId} - ${data.anomalies.join(', ')}`);
    this.emit('behavior_anomaly', data);
  }

  /**
   * Handle high risk entity.
   */
  _handleHighRisk(data) {
    console.log(`[ml] High risk entity: ${data.entity} - score: ${data.score}`);
    this.emit('high_risk', data);
  }

  /**
   * Handle failure warning.
   */
  _handleFailureWarning(data) {
    console.log(`[ml] Failure warning: ${data.metric} - risk: ${data.risk.toFixed(1)}%`);
    this.emit('failure_warning', data);
  }

  /**
   * Handle capacity warning.
   */
  _handleCapacityWarning(data) {
    console.log(`[ml] Capacity warning: ${data.resource} - ${(data.utilization * 100).toFixed(1)}%`);
    this.emit('capacity_warning', data);
  }

  /**
   * Train all ML models.
   */
  train() {
    console.log('[ml] Training ML models...');
    
    const results = {
      anomaly: this.anomalyManager.train(),
      behavior: this.behaviorAnalyzer.getStatus().profilesCreated > 0,
      failure: this.failurePredictor.getStatus().metrics > 0
    };

    this.emit('trained', results);
    console.log('[ml] Training complete', results);
    
    return results;
  }

  /**
   * Get pipeline status.
   */
  getStatus() {
    return {
      enabled: this.enabled,
      anomaly: this.anomalyManager.getStatus(),
      behavior: this.behaviorAnalyzer.getStatus(),
      risk: this.riskScorer.getStatus(),
      failure: this.failurePredictor.getStatus(),
      capacity: this.capacityPlanner.getStatus(),
      eventBuffer: this.eventBuffer.length
    };
  }

  /**
   * Get comprehensive report.
   */
  getReport() {
    return {
      timestamp: new Date().toISOString(),
      summary: {
        totalEvents: this.eventBuffer.length,
        activeProfiles: this.behaviorAnalyzer.getStatus().profilesCreated,
        highRiskEntities: this.riskScorer.getHighRiskEntities().length,
        failureWarnings: this.failurePredictor.getHighRiskMetrics().length,
        capacityWarnings: this.capacityPlanner.getRecommendations()
          .filter(r => r.priority === 'critical').length
      },
      details: {
        anomaly: this.anomalyManager.getAlerts(10),
        highRisk: this.riskScorer.getHighRiskEntities(10),
        failurePredictions: this.failurePredictor.getHighRiskMetrics(10),
        capacityRecommendations: this.capacityPlanner.getRecommendations()
      }
    };
  }

  /**
   * Export ML state.
   */
  exportState() {
    return JSON.stringify({
      behavior: JSON.parse(this.behaviorAnalyzer.exportProfiles()),
      risk: this.riskScorer.getAllScores(),
      failure: {
        thresholds: this.failurePredictor.thresholds
      },
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Import ML state.
   */
  importState(jsonData) {
    try {
      const data = JSON.parse(jsonData);
      
      if (data.behavior) {
        this.behaviorAnalyzer.importProfiles(JSON.stringify(data.behavior));
      }
      
      console.log('[ml] State imported successfully');
      return true;
    } catch (error) {
      console.error('[ml] Failed to import state:', error.message);
      return false;
    }
  }
}

// ============================================================================
// ML API
// ============================================================================

/**
 * Create ML API handlers.
 */
export function createMLAPI(pipeline) {
  return {
    /**
     * Get ML status.
     */
    getStatus: () => pipeline.getStatus(),

    /**
     * Get ML report.
     */
    getReport: () => pipeline.getReport(),

    /**
     * Process event.
     */
    processEvent: (event) => pipeline.processEvent(event),

    /**
     * Train models.
     */
    train: () => pipeline.train(),

    /**
     * Export state.
     */
    exportState: () => pipeline.exportState(),

    /**
     * Import state.
     */
    importState: (data) => pipeline.importState(data)
  };
}

// ============================================================================
// HTTP API INTEGRATION
// ============================================================================

/**
 * Add ML endpoints to HTTP server.
 */
export function addMLEndpoints(server, pipeline) {
  const api = createMLAPI(pipeline);

  server.on('request', (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    // ML Status
    if (path === '/api/ml/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(api.getStatus()));
      return;
    }

    // ML Report
    if (path === '/api/ml/report' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(api.getReport()));
      return;
    }

    // Train
    if (path === '/api/ml/train' && req.method === 'POST') {
      const result = api.train();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, result }));
      return;
    }

    // Export
    if (path === '/api/ml/export' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(api.exportState());
      return;
    }

    // Import
    if (path === '/api/ml/import' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const success = api.importState(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success }));
      });
      return;
    }
  });

  console.log('[ml] ML API endpoints added');
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalPipeline = null;

export function getMLPipeline(options = {}) {
  if (!globalPipeline) {
    globalPipeline = new MLPipeline(options);
  }
  return globalPipeline;
}

export function createMLPipeline(options = {}) {
  return new MLPipeline(options);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  MLPipeline,
  createMLAPI,
  addMLEndpoints,
  getMLPipeline,
  createMLPipeline
};
