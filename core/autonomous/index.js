// Module: Autonomous Index
// Description: Export surface for NewZoneCore autonomous modules.
// File: core/autonomous/index.js

export {
  ThreatResponse,
  AutoRemediation,
  ThreatLevel,
  ResponseAction,
  getThreatResponse,
  getAutoRemediation
} from './response.js';

export {
  HealthMonitor,
  SelfHealing,
  AutoScaling,
  HealthStatus,
  getHealthMonitor,
  getSelfHealing,
  getAutoScaling
} from './healing.js';

export {
  OptimizationAdvisor,
  AutoTuner,
  ResourceOptimizer,
  getOptimizationAdvisor,
  getAutoTuner,
  getResourceOptimizer
} from './optimization.js';
