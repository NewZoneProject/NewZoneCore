// Module: Behavioral Analysis
// Description: User and entity behavior analysis for NewZoneCore.
//              Creates behavior profiles and detects deviations.
// File: core/ml/behavior.js

import { EventEmitter } from 'events';

// ============================================================================
// BEHAVIOR PROFILE
// ============================================================================

export class BehaviorProfile extends EventEmitter {
  constructor(entityId, entityType = 'user', options = {}) {
    super();

    this.entityId = entityId;
    this.entityType = entityType;
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
    
    // Activity patterns
    this.activityHours = new Array(24).fill(0);
    this.activityDays = new Array(7).fill(0);
    
    // Action frequencies
    this.actionCounts = new Map();
    this.totalActions = 0;
    
    // Location/IP patterns
    this.locations = new Map();
    this.ips = new Map();
    
    // Session patterns
    this.sessionDurations = [];
    this.avgSessionDuration = 0;
    
    // Risk score
    this.riskScore = 0;
    this.riskFactors = [];
    
    // Configuration
    this.windowSize = options.windowSize || 1000;
    this.decayFactor = options.decayFactor || 0.99;
  }

  /**
   * Record activity.
   */
  record(activity) {
    const timestamp = new Date(activity.timestamp || Date.now());
    
    // Update activity patterns
    this._updateActivityPatterns(timestamp);
    
    // Update action counts
    this._updateActionCounts(activity);
    
    // Update location/IP
    this._updateLocation(activity);
    
    // Update session
    if (activity.sessionDuration) {
      this._updateSession(activity.sessionDuration);
    }
    
    // Update risk score
    this._updateRiskScore(activity);
    
    this.updatedAt = new Date().toISOString();
    this.emit('updated', { entity: this.entityId, activity });
  }

  /**
   * Update activity patterns.
   */
  _updateActivityPatterns(timestamp) {
    const hour = timestamp.getHours();
    const day = timestamp.getDay();
    
    // Increment with decay
    this.activityHours[hour] = (this.activityHours[hour] || 0) * this.decayFactor + 1;
    this.activityDays[day] = (this.activityDays[day] || 0) * this.decayFactor + 1;
    
    // Normalize
    this._normalizeArray(this.activityHours);
    this._normalizeArray(this.activityDays);
  }

  /**
   * Update action counts.
   */
  _updateActionCounts(activity) {
    const action = activity.type || 'unknown';
    const count = this.actionCounts.get(action) || 0;
    this.actionCounts.set(action, (count + 1) * this.decayFactor);
    this.totalActions = this.totalActions * this.decayFactor + 1;
    
    // Trim if too large
    if (this.actionCounts.size > 100) {
      const sorted = Array.from(this.actionCounts.entries())
        .sort((a, b) => b[1] - a[1]);
      this.actionCounts = new Map(sorted.slice(0, 50));
    }
  }

  /**
   * Update location/IP.
   */
  _updateLocation(activity) {
    if (activity.ip) {
      const count = this.ips.get(activity.ip) || 0;
      this.ips.set(activity.ip, (count + 1) * this.decayFactor);
      
      // Keep top IPs
      if (this.ips.size > 20) {
        const sorted = Array.from(this.ips.entries()).sort((a, b) => b[1] - a[1]);
        this.ips = new Map(sorted.slice(0, 10));
      }
    }
    
    if (activity.location) {
      const count = this.locations.get(activity.location) || 0;
      this.locations.set(activity.location, (count + 1) * this.decayFactor);
    }
  }

  /**
   * Update session duration.
   */
  _updateSession(duration) {
    this.sessionDurations.push(duration);
    
    if (this.sessionDurations.length > 100) {
      this.sessionDurations.shift();
    }
    
    this.avgSessionDuration = this.sessionDurations.reduce((a, b) => a + b, 0) / 
      this.sessionDurations.length;
  }

  /**
   * Update risk score.
   */
  _updateRiskScore(activity) {
    const riskFactors = [];
    let riskScore = 0;
    
    // Check for unusual hour
    const hour = new Date(activity.timestamp || Date.now()).getHours();
    if (this.activityHours[hour] < 0.05 && this.totalActions > 50) {
      riskFactors.push('unusual_hour');
      riskScore += 20;
    }
    
    // Check for new IP
    if (activity.ip && !this.ips.has(activity.ip) && this.ips.size > 0) {
      riskFactors.push('new_ip');
      riskScore += 15;
    }
    
    // Check for unusual action
    const action = activity.type;
    if (action && this.actionCounts.has(action)) {
      const freq = this.actionCounts.get(action) / this.totalActions;
      if (freq < 0.01 && this.totalActions > 100) {
        riskFactors.push('unusual_action');
        riskScore += 10;
      }
    }
    
    // Check for rapid actions
    if (activity.rapidActions > 10) {
      riskFactors.push('rapid_actions');
      riskScore += 25;
    }
    
    this.riskFactors = riskFactors;
    this.riskScore = Math.min(100, riskScore);
    
    if (this.riskScore > 50) {
      this.emit('high_risk', { 
        entity: this.entityId, 
        score: this.riskScore, 
        factors: riskFactors 
      });
    }
  }

  /**
   * Normalize array.
   */
  _normalizeArray(arr) {
    const sum = arr.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] /= sum;
      }
    }
  }

  /**
   * Get profile summary.
   */
  getSummary() {
    return {
      entityId: this.entityId,
      entityType: this.entityType,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      totalActions: Math.round(this.totalActions),
      actionTypes: Array.from(this.actionCounts.keys()).slice(0, 10),
      topIps: Array.from(this.ips.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ip]) => ip),
      avgSessionDuration: Math.round(this.avgSessionDuration),
      riskScore: this.riskScore,
      riskFactors: this.riskFactors,
      activityPattern: {
        peakHours: this._getTopIndices(this.activityHours, 3),
        peakDays: this._getTopIndices(this.activityDays, 3)
      }
    };
  }

  /**
   * Get top indices from array.
   */
  _getTopIndices(arr, n) {
    return arr.map((v, i) => ({ value: v, index: i }))
      .sort((a, b) => b.value - a.value)
      .slice(0, n)
      .map(x => x.index);
  }

  /**
   * Check if activity is anomalous.
   */
  isAnomalous(activity) {
    const anomalies = [];
    
    // Check hour
    const hour = new Date(activity.timestamp || Date.now()).getHours();
    if (this.activityHours[hour] < 0.02 && this.totalActions > 100) {
      anomalies.push('unusual_hour');
    }
    
    // Check IP
    if (activity.ip && !this.ips.has(activity.ip) && this.ips.size >= 5) {
      anomalies.push('new_ip');
    }
    
    // Check action type
    const action = activity.type;
    if (action && !this.actionCounts.has(action) && this.totalActions > 50) {
      anomalies.push('new_action_type');
    }
    
    return {
      isAnomalous: anomalies.length > 0,
      anomalies,
      confidence: anomalies.length / 5
    };
  }
}

// ============================================================================
// BEHAVIOR ANALYZER
// ============================================================================

export class BehaviorAnalyzer extends EventEmitter {
  constructor(options = {}) {
    super();

    this.profiles = new Map();
    this.options = options;
    this.autoTrain = options.autoTrain !== false;
    
    this.stats = {
      profilesCreated: 0,
      activitiesRecorded: 0,
      anomaliesDetected: 0
    };
  }

  /**
   * Get or create profile.
   */
  getProfile(entityId, entityType = 'user') {
    const key = `${entityType}:${entityId}`;
    
    if (!this.profiles.has(key)) {
      const profile = new BehaviorProfile(entityId, entityType, this.options);
      
      profile.on('high_risk', (data) => {
        this.emit('high_risk', data);
      });
      
      this.profiles.set(key, profile);
      this.stats.profilesCreated++;
      
      console.log(`[ml] Created behavior profile: ${key}`);
    }
    
    return this.profiles.get(key);
  }

  /**
   * Record activity.
   */
  recordActivity(entityId, activity, entityType = 'user') {
    const profile = this.getProfile(entityId, entityType);
    profile.record(activity);
    
    this.stats.activitiesRecorded++;
    
    // Check for anomalies
    const anomalyResult = profile.isAnomalous(activity);
    if (anomalyResult.isAnomalous) {
      this.stats.anomaliesDetected++;
      
      this.emit('anomaly', {
        entityId,
        entityType,
        activity,
        anomalies: anomalyResult.anomalies,
        confidence: anomalyResult.confidence,
        timestamp: new Date().toISOString()
      });
    }
    
    return { profile, anomaly: anomalyResult };
  }

  /**
   * Get all profiles.
   */
  getProfiles() {
    return Array.from(this.profiles.values()).map(p => p.getSummary());
  }

  /**
   * Get profile by ID.
   */
  getProfileById(entityId, entityType = 'user') {
    const key = `${entityType}:${entityId}`;
    const profile = this.profiles.get(key);
    return profile ? profile.getSummary() : null;
  }

  /**
   * Delete profile.
   */
  deleteProfile(entityId, entityType = 'user') {
    const key = `${entityType}:${entityId}`;
    const deleted = this.profiles.delete(key);
    if (deleted) {
      console.log(`[ml] Deleted behavior profile: ${key}`);
    }
    return deleted;
  }

  /**
   * Get analyzer status.
   */
  getStatus() {
    return {
      ...this.stats,
      activeProfiles: this.profiles.size,
      options: this.options
    };
  }

  /**
   * Export profiles.
   */
  exportProfiles() {
    const data = {};
    for (const [key, profile] of this.profiles) {
      data[key] = {
        ...profile.getSummary(),
        activityHours: profile.activityHours,
        activityDays: profile.activityDays,
        actionCounts: Object.fromEntries(profile.actionCounts),
        ips: Object.fromEntries(profile.ips),
        locations: Object.fromEntries(profile.locations)
      };
    }
    return JSON.stringify(data, null, 2);
  }

  /**
   * Import profiles.
   */
  importProfiles(jsonData) {
    try {
      const data = JSON.parse(jsonData);
      
      for (const [key, profileData] of Object.entries(data)) {
        const [entityType, entityId] = key.split(':');
        const profile = this.getProfile(entityId, entityType);
        
        // Restore data
        profile.activityHours = profileData.activityHours || profile.activityHours;
        profile.activityDays = profileData.activityDays || profile.activityDays;
        profile.actionCounts = new Map(Object.entries(profileData.actionCounts || {}));
        profile.ips = new Map(Object.entries(profileData.ips || {}));
        profile.locations = new Map(Object.entries(profileData.locations || {}));
        profile.totalActions = profileData.totalActions || 0;
        profile.riskScore = profileData.riskScore || 0;
      }
      
      console.log(`[ml] Imported ${Object.keys(data).length} profiles`);
      return true;
    } catch (error) {
      console.error('[ml] Failed to import profiles:', error.message);
      return false;
    }
  }
}

// ============================================================================
// ENTITY RISK SCORER
// ============================================================================

export class EntityRiskScorer extends EventEmitter {
  constructor(options = {}) {
    super();

    this.scores = new Map(); // entityId -> { score, factors, history }
    this.weights = options.weights || {
      authentication: 0.3,
      network: 0.25,
      resource: 0.25,
      temporal: 0.2
    };
    this.decayRate = options.decayRate || 0.95;
  }

  /**
   * Update entity risk score.
   */
  update(entityId, factors) {
    if (!this.scores.has(entityId)) {
      this.scores.set(entityId, {
        score: 0,
        factors: {},
        history: [],
        updatedAt: Date.now()
      });
    }

    const entity = this.scores.get(entityId);
    
    // Apply decay
    entity.score *= this.decayRate;
    
    // Add new factors
    for (const [category, value] of Object.entries(factors)) {
      entity.factors[category] = value;
    }
    
    // Calculate weighted score
    let weightedScore = 0;
    for (const [category, weight] of Object.entries(this.weights)) {
      const factorValue = entity.factors[category] || 0;
      weightedScore += factorValue * weight;
    }
    
    entity.score = Math.min(100, Math.max(0, entity.score + weightedScore));
    entity.updatedAt = Date.now();
    entity.history.push({
      score: entity.score,
      timestamp: Date.now()
    });
    
    // Keep history size
    if (entity.history.length > 100) {
      entity.history.shift();
    }
    
    // Emit if high risk
    if (entity.score > 70) {
      this.emit('high_risk', {
        entityId,
        score: entity.score,
        factors: entity.factors
      });
    }
    
    return entity.score;
  }

  /**
   * Get risk score.
   */
  getScore(entityId) {
    const entity = this.scores.get(entityId);
    if (!entity) return null;
    
    return {
      entityId,
      score: entity.score,
      factors: entity.factors,
      updatedAt: new Date(entity.updatedAt).toISOString()
    };
  }

  /**
   * Get all scores.
   */
  getAllScores() {
    const result = {};
    for (const [entityId, entity] of this.scores) {
      result[entityId] = this.getScore(entityId);
    }
    return result;
  }

  /**
   * Get high-risk entities.
   */
  getHighRiskEntities(threshold = 70) {
    const result = [];
    for (const [entityId, entity] of this.scores) {
      if (entity.score >= threshold) {
        result.push({
          entityId,
          score: entity.score,
          factors: entity.factors
        });
      }
    }
    return result.sort((a, b) => b.score - a.score);
  }

  /**
   * Reset entity score.
   */
  reset(entityId) {
    if (this.scores.has(entityId)) {
      this.scores.delete(entityId);
      return true;
    }
    return false;
  }

  /**
   * Get scorer status.
   */
  getStatus() {
    return {
      entities: this.scores.size,
      highRisk: this.getHighRiskEntities().length,
      weights: this.weights
    };
  }
}

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

let globalBehaviorAnalyzer = null;
let globalRiskScorer = null;

export function getBehaviorAnalyzer(options = {}) {
  if (!globalBehaviorAnalyzer) {
    globalBehaviorAnalyzer = new BehaviorAnalyzer(options);
  }
  return globalBehaviorAnalyzer;
}

export function getEntityRiskScorer(options = {}) {
  if (!globalRiskScorer) {
    globalRiskScorer = new EntityRiskScorer(options);
  }
  return globalRiskScorer;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  BehaviorProfile,
  BehaviorAnalyzer,
  EntityRiskScorer,
  getBehaviorAnalyzer,
  getEntityRiskScorer
};
