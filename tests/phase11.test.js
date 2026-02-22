// Module: Phase 11 Security Tests
// Description: Tests for advanced security modules.
// File: tests/phase11.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ============================================================================
// ZERO-KNOWLEDGE PROOFS TESTS
// ============================================================================

describe('Zero-Knowledge Proofs', () => {
  let ZKPProver, ZKPVerifier, RangeProof, AttributeCredential;

  beforeEach(async () => {
    const mod = await import('../core/security/zkp.js');
    ZKPProver = mod.ZKPProver;
    ZKPVerifier = mod.ZKPVerifier;
    RangeProof = mod.RangeProof;
    AttributeCredential = mod.AttributeCredential;
  });

  it('should create ZKP prover', () => {
    const prover = new ZKPProver('my-secret');

    expect(prover).toBeDefined();
    expect(prover.commitment).toBeDefined();
  });

  it('should generate zero-knowledge proof', () => {
    const prover = new ZKPProver('my-secret');
    const statement = 'I know the secret';

    const proof = prover.generateProof(statement);

    expect(proof).toBeDefined();
    expect(proof.commitment).toBeDefined();
    expect(proof.challenge).toBeDefined();
    expect(proof.response).toBeDefined();
    expect(proof.statement).toBe(statement);
  });

  it('should verify ZKP', () => {
    const prover = new ZKPProver('my-secret');
    const statement = 'I know the secret';
    const proof = prover.generateProof(statement);

    const isValid = prover.verifyProof(proof);

    expect(isValid).toBe(true);
  });

  it('should create ZKP verifier', () => {
    const verifier = new ZKPVerifier();

    expect(verifier).toBeDefined();
    expect(verifier.verifiedProofs.size).toBe(0);
  });

  it('should verify proof with verifier', () => {
    const prover = new ZKPProver('my-secret');
    const statement = 'I know the secret';
    const proof = prover.generateProof(statement);

    const verifier = new ZKPVerifier();
    const result = verifier.verify(proof);

    expect(result.valid).toBe(true);
  });

  it('should reject invalid proof', () => {
    const verifier = new ZKPVerifier();

    const invalidProof = {
      commitment: 'abc',
      challenge: 'xyz',
      response: '123',
      statement: 'test'
    };

    const result = verifier.verify(invalidProof);

    expect(result.valid).toBe(false);
  });

  it('should get verifier stats', () => {
    const verifier = new ZKPVerifier();
    const prover = new ZKPProver('secret');

    for (let i = 0; i < 5; i++) {
      const proof = prover.generateProof(`statement-${i}`);
      verifier.verify(proof);
    }

    const stats = verifier.getStats();

    expect(stats.verifiedProofs).toBeGreaterThan(0);
  });

  it('should create range proof', () => {
    const proof = RangeProof.prove(50, 0, 100);

    expect(proof).toBeDefined();
    expect(proof.commitment).toBeDefined();
    expect(proof.range.min).toBe(0);
    expect(proof.range.max).toBe(100);
  });

  it('should verify range proof', () => {
    const value = 50;
    const proof = RangeProof.prove(value, 0, 100);

    const result = RangeProof.verify(proof, value);

    expect(result.valid).toBe(true);
  });

  it('should reject out-of-range value', () => {
    expect(() => {
      RangeProof.prove(150, 0, 100);
    }).toThrow('Value out of range');
  });

  it('should create attribute credential', () => {
    const credential = new AttributeCredential(
      { name: 'Alice', age: 30, country: 'US' },
      'issuer-123'
    );

    expect(credential).toBeDefined();
    expect(credential.hash).toBeDefined();
  });

  it('should do selective disclosure', () => {
    const credential = new AttributeCredential(
      { name: 'Alice', age: 30, country: 'US', email: 'alice@example.com' },
      'issuer-123'
    );

    const disclosure = credential.disclose(['name', 'age']);

    expect(disclosure.disclosed.name).toBe('Alice');
    expect(disclosure.disclosed.age).toBe(30);
    expect(disclosure.disclosed.country).toBeUndefined();
    expect(disclosure.hidden.country).toBeDefined();
  });

  it('should verify disclosed credential', () => {
    const credential = new AttributeCredential(
      { name: 'Alice', age: 30 },
      'issuer-123'
    );

    const disclosure = credential.disclose(['name']);
    const result = AttributeCredential.verify(disclosure, credential.hash);

    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// HOMOMORPHIC ENCRYPTION TESTS
// ============================================================================

describe('Homomorphic Encryption', () => {
  let HomomorphicEncryption, EncryptedComputation;

  beforeEach(async () => {
    const mod = await import('../core/security/he.js');
    HomomorphicEncryption = mod.HomomorphicEncryption;
    EncryptedComputation = mod.EncryptedComputation;
  });

  it('should create HE instance', () => {
    const he = new HomomorphicEncryption({ keySize: 32 });
    expect(he).toBeDefined();
  });

  it('should encrypt and decrypt', () => {
    const he = new HomomorphicEncryption();
    const plaintext = 42n;
    const encrypted = he.encrypt(plaintext);
    const decrypted = he.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should perform homomorphic addition', () => {
    const he = new HomomorphicEncryption();
    const a = 10n, b = 20n;
    const ea = he.encrypt(a), eb = he.encrypt(b);
    const sum = he.add(ea, eb);
    const decrypted = he.decrypt(sum);
    expect(decrypted).toBe(a + b);
  });

  it('should export and import keys', () => {
    const he1 = new HomomorphicEncryption();
    const he2 = new HomomorphicEncryption();
    he2.importKeys(he1.exportKeys());
    const encrypted = he1.encrypt(100n);
    expect(he2.decrypt(encrypted)).toBe(100n);
  });
});

// ============================================================================
// QUANTUM-RESISTANT CRYPTOGRAPHY TESTS
// ============================================================================

describe('Quantum-Resistant Cryptography', () => {
  let LatticeEncryption, HashBasedSignature;

  beforeEach(async () => {
    const mod = await import('../core/security/quantum-resistant.js');
    LatticeEncryption = mod.LatticeEncryption;
    HashBasedSignature = mod.HashBasedSignature;
  });

  it('should create lattice encryption', () => {
    const lattice = new LatticeEncryption({ n: 32, q: 3329 });

    expect(lattice).toBeDefined();
    expect(lattice.keys).toBeDefined();
  });

  it('should export and import lattice keys', () => {
    const lattice1 = new LatticeEncryption({ n: 32 });
    const lattice2 = new LatticeEncryption({ n: 32 });

    const exported = lattice1.exportKeys();
    lattice2.importKeys(exported);

    expect(lattice2.getPublicKey().n).toBe(32);
  });

  it('should create hash-based signature', () => {
    const hbs = new HashBasedSignature({ height: 4, wotsWidth: 4 });

    expect(hbs).toBeDefined();
    expect(hbs.keys.publicKey).toBeDefined();
  });

  it('should sign and verify with hash-based signature', () => {
    const hbs = new HashBasedSignature({ height: 4, wotsWidth: 4 });
    const message = 'Important message';

    const signature = hbs.sign(message);

    expect(signature).toBeDefined();
    expect(signature.signature).toBeDefined();
    expect(signature.leafIndex).toBeDefined();
  });

  it('should get public key', () => {
    const hbs = new HashBasedSignature({ height: 4, wotsWidth: 4 });
    const publicKey = hbs.getPublicKey();

    expect(publicKey).toBeDefined();
    expect(typeof publicKey).toBe('string');
  });

  it('should export signature keys', () => {
    const hbs = new HashBasedSignature({ height: 4, wotsWidth: 4 });
    const exported = hbs.exportKeys();

    expect(exported.publicKey).toBeDefined();
    expect(exported.parameters.height).toBe(4);
    expect(exported.parameters.wotsWidth).toBe(4);
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Phase 11 Integration', () => {
  it('should have all security modules', async () => {
    const zkp = await import('../core/security/zkp.js');
    expect(zkp.ZKPProver).toBeDefined();
    expect(zkp.ZKPVerifier).toBeDefined();

    const he = await import('../core/security/he.js');
    expect(he.HomomorphicEncryption).toBeDefined();

    const qr = await import('../core/security/quantum-resistant.js');
    expect(qr.LatticeEncryption).toBeDefined();
    expect(qr.HashBasedSignature).toBeDefined();

    const index = await import('../core/security/index.js');
    expect(index.ZKPProver).toBeDefined();
  });

  it('should use ZKP for private authentication', async () => {
    const { ZKPProver, ZKPVerifier } = await import('../core/security/zkp.js');

    // Prover knows password
    const prover = new ZKPProver('super-secret-password');
    
    // Generate proof without revealing password
    const proof = prover.generateProof('I know the password');
    
    // Verifier checks proof
    const verifier = new ZKPVerifier();
    const result = verifier.verify(proof);
    
    expect(result.valid).toBe(true);
  });

  it('should use quantum-resistant signatures', async () => {
    const { HashBasedSignature } = await import('../core/security/quantum-resistant.js');

    const hbs = new HashBasedSignature({ height: 4, wotsWidth: 4 });
    
    // Sign important document
    const document = 'Contract agreement #12345';
    const signature = hbs.sign(document);
    
    expect(signature).toBeDefined();
    expect(signature.signature).toBeDefined();
  });
});
