// Module: FL Index
// Description: Export surface for NewZoneCore Federated Learning modules.
// File: core/fl/index.js

export {
  FederatedClient,
  FederatedServer,
  FederatedLearningManager,
  getFederatedLearningManager,
  createFederatedLearningManager
} from './core.js';

export {
  ThreatIndicator,
  ThreatIntelligence,
  PrivacyAnalytics,
  getThreatIntelligence,
  getPrivacyAnalytics
} from './threat-intel.js';
