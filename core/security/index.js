// Module: Security Index
// Description: Export surface for NewZoneCore advanced security modules.
// File: core/security/index.js

export {
  ZKPProver,
  ZKPVerifier,
  RangeProof,
  AttributeCredential
} from './zkp.js';

export {
  HomomorphicEncryption,
  EncryptedComputation
} from './he.js';

export {
  LatticeEncryption,
  HashBasedSignature
} from './quantum-resistant.js';
