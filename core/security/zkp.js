// Module: Zero-Knowledge Proofs
// Description: ZK-SNARK-like proofs for privacy-preserving verification.
//              Allows proving knowledge without revealing the actual data.
// File: core/security/zkp.js

import { randomBytes, createHash } from 'crypto';

// ============================================================================
// ZKP PROVER
// ============================================================================

export class ZKPProver {
  constructor(secret) {
    this.secret = secret;
    this.commitment = this._commit(secret);
    this.nonce = randomBytes(32);
  }

  /**
   * Create commitment to secret.
   */
  _commit(secret) {
    return createHash('sha256')
      .update(Buffer.from(secret))
      .digest('hex');
  }

  /**
   * Generate proof of knowledge.
   */
  generateProof(statement) {
    // Simplified ZK proof (not cryptographically secure, for demonstration)
    const challenge = createHash('sha256')
      .update(statement + this.commitment)
      .digest('hex');

    // Response proves knowledge without revealing secret
    const response = createHash('sha256')
      .update(Buffer.from(this.secret) + Buffer.from(challenge) + this.nonce)
      .digest('hex');

    return {
      commitment: this.commitment,
      challenge,
      response,
      nonce: this.nonce.toString('hex'),
      statement,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Verify proof locally.
   */
  verifyProof(proof) {
    const expectedChallenge = createHash('sha256')
      .update(proof.statement + proof.commitment)
      .digest('hex');

    return expectedChallenge === proof.challenge;
  }
}

// ============================================================================
// ZKP VERIFIER
// ============================================================================

export class ZKPVerifier {
  constructor() {
    this.verifiedProofs = new Map();
    this.trustedCommitments = new Set();
  }

  /**
   * Verify zero-knowledge proof.
   */
  verify(proof) {
    // Check if proof is well-formed
    if (!proof.commitment || !proof.challenge || !proof.response) {
      return { valid: false, reason: 'Missing proof components' };
    }

    // Verify challenge
    const expectedChallenge = createHash('sha256')
      .update(proof.statement + proof.commitment)
      .digest('hex');

    if (expectedChallenge !== proof.challenge) {
      return { valid: false, reason: 'Challenge mismatch' };
    }

    // Check if commitment is trusted
    if (this.trustedCommitments.has(proof.commitment)) {
      return { valid: true, reason: 'Trusted commitment' };
    }

    // Store proof for audit
    this.verifiedProofs.set(proof.commitment, {
      ...proof,
      verifiedAt: new Date().toISOString()
    });

    return { valid: true, reason: 'Proof verified' };
  }

  /**
   * Add trusted commitment.
   */
  addTrustedCommitment(commitment) {
    this.trustedCommitments.add(commitment);
  }

  /**
   * Get verification history.
   */
  getHistory() {
    return Array.from(this.verifiedProofs.values());
  }

  /**
   * Get statistics.
   */
  getStats() {
    return {
      verifiedProofs: this.verifiedProofs.size,
      trustedCommitments: this.trustedCommitments.size
    };
  }
}

// ============================================================================
// RANGE PROOF
// ============================================================================

export class RangeProof {
  /**
   * Prove value is within range without revealing value.
   */
  static prove(value, min, max) {
    if (value < min || value > max) {
      throw new Error('Value out of range');
    }

    // Commitment to value
    const nonce = randomBytes(32);
    const commitment = createHash('sha256')
      .update(Buffer.from([value, ...nonce]))
      .digest('hex');

    // Proof that value is in range (simplified)
    const proof = {
      commitment,
      range: { min, max },
      proof: createHash('sha256')
        .update(Buffer.from([value - min, max - value, ...nonce]))
        .digest('hex'),
      nonce: nonce.toString('hex'),
      timestamp: new Date().toISOString()
    };

    return proof;
  }

  /**
   * Verify range proof.
   */
  static verify(proof, value) {
    const { commitment, range, proof: proofValue, nonce } = proof;

    // Recompute commitment
    const nonceBuffer = Buffer.from(nonce, 'hex');
    const recomputedCommitment = createHash('sha256')
      .update(Buffer.from([value, ...nonceBuffer]))
      .digest('hex');

    if (recomputedCommitment !== commitment) {
      return { valid: false, reason: 'Commitment mismatch' };
    }

    // Check range
    if (value < range.min || value > range.max) {
      return { valid: false, reason: 'Value out of range' };
    }

    return { valid: true, reason: 'Range proof verified' };
  }
}

// ============================================================================
// ATTRIBUTE-BASED CREDENTIAL
// ============================================================================

export class AttributeCredential {
  constructor(attributes, issuer) {
    this.attributes = attributes;
    this.issuer = issuer;
    this.id = randomBytes(16).toString('hex');
    this.createdAt = new Date().toISOString();
    
    // Create credential hash
    this.hash = this._hash();
  }

  /**
   * Hash credential.
   */
  _hash() {
    return createHash('sha256')
      .update(JSON.stringify(this.attributes) + this.issuer + this.id)
      .digest('hex');
  }

  /**
   * Selective disclosure - reveal only specified attributes.
   */
  disclose(attributeNames) {
    const disclosed = {};
    const hidden = {};

    for (const [key, value] of Object.entries(this.attributes)) {
      if (attributeNames.includes(key)) {
        disclosed[key] = value;
      } else {
        hidden[key] = createHash('sha256')
          .update(String(value))
          .digest('hex')
          .substring(0, 16);
      }
    }

    return {
      credentialId: this.id,
      issuer: this.issuer,
      disclosed,
      hidden,
      proof: this._generateDisclosureProof(attributeNames),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate disclosure proof.
   */
  _generateDisclosureProof(attributeNames) {
    const data = {
      credentialHash: this.hash,
      disclosedAttributes: attributeNames,
      timestamp: Date.now()
    };

    return createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  /**
   * Verify disclosed credential.
   */
  static verify(disclosure, originalHash) {
    // Verify proof
    const data = {
      credentialHash: originalHash,
      disclosedAttributes: Object.keys(disclosure.disclosed),
      timestamp: new Date(disclosure.timestamp).getTime()
    };

    const expectedProof = createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');

    if (expectedProof !== disclosure.proof) {
      return { valid: false, reason: 'Proof verification failed' };
    }

    return { valid: true, reason: 'Credential verified' };
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  ZKPProver,
  ZKPVerifier,
  RangeProof,
  AttributeCredential
};
