// Module: Metrics Endpoint
// Description: Prometheus-compatible /metrics endpoint for NewZoneCore.
// File: core/observability/endpoint.js

import { getMetrics, getHealthChecker } from './metrics.js';

// ============================================================================
// METRICS ENDPOINT
// ============================================================================

/**
 * Create metrics endpoint handler.
 */
export function createMetricsEndpoint(supervisor) {
  const metrics = getMetrics();
  const health = getHealthChecker();
  
  /**
   * Handle /metrics request.
   * Returns Prometheus-format metrics.
   */
  async function handleMetrics(req, res) {
    // Update dynamic metrics from supervisor
    updateSupervisorMetrics(supervisor, metrics);
    
    // Get Prometheus format
    const prometheusMetrics = metrics.toPrometheus();
    
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(prometheusMetrics);
  }
  
  /**
   * Handle /health request.
   * Returns health status.
   */
  async function handleHealth(req, res) {
    const status = health.getStatus();
    const statusCode = status.status === 'healthy' ? 200 : 
                       status.status === 'degraded' ? 206 : 503;
    
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify(status, null, 2));
  }
  
  /**
   * Handle /ready request.
   * Returns readiness status.
   */
  async function handleReady(req, res) {
    const status = health.getStatus();
    const isReady = status.status === 'healthy';
    
    res.writeHead(isReady ? 200 : 503, {
      'Content-Type': 'application/json'
    });
    res.end(JSON.stringify({
      ready: isReady,
      checks: status.checks,
      timestamp: new Date().toISOString()
    }));
  }
  
  /**
   * Handle /live request.
   * Returns liveness status (simple ping).
   */
  async function handleLive(req, res) {
    res.writeHead(200, {
      'Content-Type': 'application/json'
    });
    res.end(JSON.stringify({
      live: true,
      timestamp: new Date().toISOString()
    }));
  }
  
  return {
    handleMetrics,
    handleHealth,
    handleReady,
    handleLive
  };
}

// ============================================================================
// SUPERVISOR METRICS UPDATE
// ============================================================================

/**
 * Update metrics from supervisor state.
 */
function updateSupervisorMetrics(supervisor, metrics) {
  if (!supervisor) return;
  
  try {
    // Service metrics
    const serviceStats = supervisor.getServiceStatus?.() || {};
    metrics.set('services_running', serviceStats.running || 0);
    
    // Trust metrics
    const trust = supervisor.getTrust?.() || { peers: [] };
    metrics.set('trust_peers_count', trust.peers?.length || 0);
    
    // Identity metrics
    const identity = supervisor.getIdentity?.();
    if (identity) {
      metrics.set('identity_configured', 1);
    }
    
    // Channel metrics
    const channels = supervisor.getChannelStatus?.() || {};
    metrics.set('channels_open', channels.open || 0);
    metrics.set('channels_total', channels.total || 0);
    
    // Runtime metrics
    const runtime = supervisor.getRuntimeInfo?.() || {};
    if (runtime.uptime_ms) {
      metrics.set('uptime_seconds', Math.floor(runtime.uptime_ms / 1000));
    }
    
  } catch (error) {
    // Silently ignore metrics update errors
    console.error('[metrics] Failed to update supervisor metrics:', error.message);
  }
}

// ============================================================================
// INTEGRATION WITH HTTP API
// ============================================================================

/**
 * Add observability endpoints to HTTP server.
 */
export function addObservabilityEndpoints(server, supervisor) {
  const endpoints = createMetricsEndpoint(supervisor);
  
  server.on('request', (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    
    // Metrics endpoint
    if (path === '/metrics') {
      return endpoints.handleMetrics(req, res);
    }
    
    // Health endpoint
    if (path === '/health') {
      return endpoints.handleHealth(req, res);
    }
    
    // Readiness endpoint
    if (path === '/ready') {
      return endpoints.handleReady(req, res);
    }
    
    // Liveness endpoint
    if (path === '/live') {
      return endpoints.handleLive(req, res);
    }
  });
  
  return endpoints;
}
