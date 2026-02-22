// Module: Collaborative Threat Intelligence
// Description: Privacy-preserving threat sharing between nodes.
//              Enables collaborative defense without exposing sensitive data.
// File: core/fl/threat-intel.js

import { EventEmitter } from 'events';
import { createHash, randomBytes } from 'crypto';

// ============================================================================
// THREAT INDICATOR
// ============================================================================

export class ThreatIndicator {
  constructor(data) {
    this.id = data.id || randomBytes(8).toString('hex');
    this.type = data.type; // ip, hash, domain, pattern
    this.value = data.value;
    this.severity = data.severity || 'medium';
    this.confidence = data.confidence || 0.5;
    this.source = data.source || 'unknown';
    this.createdAt = data.createdAt || new Date().toISOString();
    this.expiresAt = data.expiresAt || null;
    this.tags = data.tags || [];
    
    // Privacy: hash the actual value
    this.hash = this._hashValue(data.value);
  }

  /**
   * Hash indicator value for privacy.
   */
  _hashValue(value) {
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * Check if indicator is expired.
   */
  isExpired() {
    if (!this.expiresAt) return false;
    return new Date(this.expiresAt) < new Date();
  }

  /**
   * Get public (shareable) representation.
   */
  toShareable() {
    return {
      id: this.id,
      type: this.type,
      hash: this.hash,
      severity: this.severity,
      confidence: this.confidence,
      tags: this.tags,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt
    };
  }

  /**
   * Serialize to JSON.
   */
  toJSON(includeValue = false) {
    const data = this.toShareable();
    if (includeValue) {
      data.value = this.value;
    }
    return data;
  }
}

// ============================================================================
// THREAT INTELLIGENCE SHARING
// ============================================================================

export class ThreatIntelligence extends EventEmitter {
  constructor(nodeId, options = {}) {
    super();

    this.nodeId = nodeId;
    this.options = options;
    this.indicators = new Map();
    this.sharedIndicators = new Set();
    this.receivedIndicators = new Map();
    
    // Peer connections
    this.peers = new Map();
    
    // Privacy settings
    this.shareConfidenceThreshold = options.shareConfidenceThreshold || 0.7;
    this.maxIndicators = options.maxIndicators || 10000;
    
    // Statistics
    this.stats = {
      indicatorsCreated: 0,
      indicatorsShared: 0,
      indicatorsReceived: 0,
      threatsBlocked: 0
    };
  }

  /**
   * Add threat indicator.
   */
  addIndicator(data) {
    const indicator = new ThreatIndicator({
      ...data,
      source: this.nodeId
    });

    this.indicators.set(indicator.hash, indicator);
    this.stats.indicatorsCreated++;

    // Cleanup if over limit
    if (this.indicators.size > this.maxIndicators) {
      this._cleanupOldIndicators();
    }

    this.emit('indicator:add', indicator);
    return indicator;
  }

  /**
   * Share indicator with peers.
   */
  shareIndicator(indicator) {
    if (indicator.confidence < this.shareConfidenceThreshold) {
      return false;
    }

    const shareable = indicator.toShareable();
    this.sharedIndicators.add(indicator.hash);
    this.stats.indicatorsShared++;

    this.emit('indicator:share', shareable);
    
    // Notify peers
    for (const [peerId, peer] of this.peers) {
      peer.send('threat:indicator', shareable);
    }

    return true;
  }

  /**
   * Receive indicator from peer.
   */
  receiveIndicator(data, peerId) {
    // Verify peer is trusted
    if (!this.peers.has(peerId)) {
      console.warn('[threat] Received indicator from untrusted peer');
      return null;
    }

    const indicator = new ThreatIndicator({
      ...data,
      source: peerId
    });

    // Check if we already have this indicator
    if (this.receivedIndicators.has(indicator.hash)) {
      return null;
    }

    this.receivedIndicators.set(indicator.hash, {
      indicator,
      receivedFrom: peerId,
      receivedAt: new Date().toISOString()
    });

    this.stats.indicatorsReceived++;
    this.emit('indicator:receive', indicator);

    return indicator;
  }

  /**
   * Check if value matches any indicator.
   */
  checkValue(value) {
    const hash = createHash('sha256').update(value).digest('hex');
    
    // Check local indicators
    if (this.indicators.has(hash)) {
      const indicator = this.indicators.get(hash);
      if (!indicator.isExpired()) {
        this.stats.threatsBlocked++;
        return {
          match: true,
          indicator: indicator.toJSON(true),
          source: 'local'
        };
      }
    }

    // Check received indicators
    if (this.receivedIndicators.has(hash)) {
      const { indicator } = this.receivedIndicators.get(hash);
      if (!indicator.isExpired()) {
        this.stats.threatsBlocked++;
        return {
          match: true,
          indicator: indicator.toJSON(),
          source: 'shared'
        };
      }
    }

    return { match: false };
  }

  /**
   * Add peer connection.
   */
  addPeer(peerId, peer) {
    this.peers.set(peerId, peer);
    this.emit('peer:add', peerId);
  }

  /**
   * Remove peer connection.
   */
  removePeer(peerId) {
    this.peers.delete(peerId);
    this.emit('peer:remove', peerId);
  }

  /**
   * Cleanup old/expired indicators.
   */
  _cleanupOldIndicators() {
    const now = Date.now();
    let removed = 0;

    for (const [hash, indicator] of this.indicators) {
      if (indicator.isExpired() || removed > 100) {
        this.indicators.delete(hash);
        removed++;
      }
    }

    console.log(`[threat] Cleaned up ${removed} old indicators`);
  }

  /**
   * Get indicators by type.
   */
  getIndicators(type = null, limit = 100) {
    let indicators = Array.from(this.indicators.values());

    if (type) {
      indicators = indicators.filter(i => i.type === type);
    }

    // Remove expired
    indicators = indicators.filter(i => !i.isExpired());

    // Sort by confidence
    indicators.sort((a, b) => b.confidence - a.confidence);

    return indicators.slice(0, limit).map(i => i.toJSON(false));
  }

  /**
   * Get statistics.
   */
  getStats() {
    return {
      ...this.stats,
      localIndicators: this.indicators.size,
      receivedIndicators: this.receivedIndicators.size,
      sharedIndicators: this.sharedIndicators.size,
      peers: this.peers.size
    };
  }

  /**
   * Export indicators.
   */
  exportIndicators(format = 'json') {
    const indicators = this.getIndicators(null, 1000);

    if (format === 'stix') {
      return this._toSTIX(indicators);
    }

    return JSON.stringify({
      nodeId: this.nodeId,
      count: indicators.length,
      exportedAt: new Date().toISOString(),
      indicators
    }, null, 2);
  }

  /**
   * Convert to STIX format.
   */
  _toSTIX(indicators) {
    return {
      type: 'bundle',
      id: `bundle--${randomBytes(16).toString('hex')}`,
      objects: indicators.map(i => ({
        type: 'indicator',
        spec_version: '2.1',
        id: `indicator--${i.id}`,
        created: i.createdAt,
        modified: i.createdAt,
        name: `${i.type}:${i.hash.substring(0, 16)}`,
        indicator_types: ['malicious-activity'],
        pattern: `[file:hashes.'SHA-256' = '${i.hash}']`,
        pattern_type: 'stix',
        valid_from: i.createdAt,
        external_references: [{
          source_name: i.source,
          external_id: i.id
        }]
      }))
    };
  }
}

// ============================================================================
// PRIVACY-PRESERVING ANALYTICS
// ============================================================================

export class PrivacyAnalytics extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = options;
    this.epsilon = options.epsilon || 1.0;
    this.aggregations = new Map();
    
    // Secure multi-party computation simulation
    this.shares = new Map();
  }

  /**
   * Add data share (secret sharing).
   */
  addShare(nodeId, share) {
    if (!this.shares.has(nodeId)) {
      this.shares.set(nodeId, []);
    }
    this.shares.get(nodeId).push(share);
  }

  /**
   * Compute differentially private aggregation.
   */
  aggregate(metric, values) {
    if (!values || values.length === 0) {
      return null;
    }

    // Add Laplace noise for differential privacy
    const sensitivity = 1.0;
    const scale = sensitivity / this.epsilon;
    
    const sum = values.reduce((a, b) => a + b, 0);
    const count = values.length;
    const mean = sum / count;
    
    // Add noise to mean
    const noisyMean = mean + this._laplaceNoise(0, scale);

    const result = {
      metric,
      count,
      mean: noisyMean,
      epsilon: this.epsilon,
      timestamp: new Date().toISOString()
    };

    this.aggregations.set(metric, result);
    this.emit('aggregate', result);

    return result;
  }

  /**
   * Compute histogram with differential privacy.
   */
  histogram(values, bins = 10) {
    if (!values || values.length === 0) {
      return null;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const binSize = (max - min) / bins;
    
    const counts = new Array(bins).fill(0);
    
    for (const value of values) {
      const binIndex = Math.min(
        bins - 1,
        Math.floor((value - min) / binSize)
      );
      counts[binIndex]++;
    }

    // Add noise to each bin
    const sensitivity = 1.0;
    const scale = sensitivity / this.epsilon;
    
    const noisyCounts = counts.map(c => 
      Math.max(0, c + this._laplaceNoise(0, scale))
    );

    const result = {
      bins: Array.from({ length: bins }, (_, i) => 
        min + i * binSize
      ),
      counts: noisyCounts,
      epsilon: this.epsilon,
      timestamp: new Date().toISOString()
    };

    this.emit('histogram', result);
    return result;
  }

  /**
   * Generate Laplace noise.
   */
  _laplaceNoise(mean, scale) {
    const u = Math.random() - 0.5;
    const sign = u >= 0 ? 1 : -1;
    return mean - sign * scale * Math.log(1 - 2 * Math.abs(u));
  }

  /**
   * Get aggregation result.
   */
  getAggregation(metric) {
    return this.aggregations.get(metric) || null;
  }

  /**
   * Get all aggregations.
   */
  getAllAggregations() {
    return Object.fromEntries(this.aggregations);
  }
}

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

let globalThreatIntel = null;
let globalPrivacyAnalytics = null;

export function getThreatIntelligence(nodeId, options = {}) {
  if (!globalThreatIntel) {
    globalThreatIntel = new ThreatIntelligence(nodeId, options);
  }
  return globalThreatIntel;
}

export function getPrivacyAnalytics(options = {}) {
  if (!globalPrivacyAnalytics) {
    globalPrivacyAnalytics = new PrivacyAnalytics(options);
  }
  return globalPrivacyAnalytics;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  ThreatIndicator,
  ThreatIntelligence,
  PrivacyAnalytics,
  getThreatIntelligence,
  getPrivacyAnalytics
};
