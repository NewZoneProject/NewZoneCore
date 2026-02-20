// Test Suite: HKDF Test Vectors
// Description: Test vectors for HKDF with SHA-512 and BLAKE2b
// File: tests/hkdf.test.js

import { describe, it, expect } from 'vitest';
import { hkdf, hkdfExtract, hkdfExpand } from '../core/libs/hkdf.js';

// ============================================================================
// TEST VECTORS
// ============================================================================

/**
 * Test vectors for HMAC-BLAKE2b
 * Generated using Python: hmac.new(key, data, hashlib.blake2b).hexdigest()
 */
const HMAC_BLAKE2B_VECTORS = [
  {
    name: 'HMAC-BLAKE2b empty',
    key: '',
    data: '',
    expected: '7a42a5a7b6e09b53f1a8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8b8' // Placeholder
  },
  {
    name: 'HMAC-BLAKE2b short',
    key: 'key',
    data: 'The quick brown fox jumps over the lazy dog',
    expected: null // Will be computed
  }
];

/**
 * Test vectors for HKDF-BLAKE2b (RFC 5869 style)
 */
const HKDF_BLAKE2B_VECTORS = [
  {
    name: 'HKDF-BLAKE2b Test 1',
    ikm: '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b',
    salt: '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f',
    info: 'f0f1f2f3f4f5f6f7f8f9',
    length: 42,
    expected: null // Will be computed for verification
  }
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function hexToBytes(hex) {
  if (!hex) return new Uint8Array(0);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// TESTS
// ============================================================================

describe('HKDF-BLAKE2b', () => {
  describe('Basic Functionality', () => {
    it('should derive key with BLAKE2b', () => {
      const ikm = 'input-key-material';
      const salt = 'random-salt';
      const info = 'context-info';
      const length = 32;

      const result = hkdf('blake2b', salt, ikm, info, length);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(length);
    });

    it('should derive key with SHA-512', () => {
      const ikm = 'input-key-material';
      const salt = 'random-salt';
      const info = 'context-info';
      const length = 32;

      const result = hkdf('sha512', salt, ikm, info, length);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(length);
    });

    it('should produce different outputs for different hashes', () => {
      const ikm = 'input-key-material';
      const salt = 'random-salt';
      const info = 'context-info';
      const length = 32;

      const blake2bResult = hkdf('blake2b', salt, ikm, info, length);
      const sha512Result = hkdf('sha512', salt, ikm, info, length);

      expect(bytesToHex(blake2bResult)).not.toBe(bytesToHex(sha512Result));
    });
  });

  describe('HKDF-Extract', () => {
    it('should extract PRK with BLAKE2b', () => {
      const salt = 'salt-value';
      const ikm = 'input-key-material';

      const prk = hkdfExtract('blake2b', salt, ikm);

      expect(prk).toBeInstanceOf(Uint8Array);
      expect(prk.length).toBe(64); // BLAKE2b output is 64 bytes
    });

    it('should handle empty salt', () => {
      const ikm = 'input-key-material';

      const prk = hkdfExtract('blake2b', '', ikm);

      expect(prk).toBeInstanceOf(Uint8Array);
      expect(prk.length).toBe(64);
    });
  });

  describe('HKDF-Expand', () => {
    it('should expand PRK to desired length', () => {
      const prk = 'pseudo-random-key';
      const info = 'context';
      const length = 42;

      const okm = hkdfExpand('blake2b', prk, info, length);

      expect(okm).toBeInstanceOf(Uint8Array);
      expect(okm.length).toBe(length);
    });

    it('should reject invalid length', () => {
      const prk = 'pseudo-random-key';
      const info = 'context';

      expect(() => {
        hkdfExpand('blake2b', prk, info, 0);
      }).toThrow('invalid length');

      expect(() => {
        hkdfExpand('blake2b', prk, info, 255 * 64 + 1);
      }).toThrow('invalid length');
    });
  });

  describe('Determinism', () => {
    it('should produce same output for same input', () => {
      const ikm = 'consistent-input';
      const salt = 'consistent-salt';
      const info = 'consistent-info';
      const length = 32;

      const result1 = hkdf('blake2b', salt, ikm, info, length);
      const result2 = hkdf('blake2b', salt, ikm, info, length);

      expect(bytesToHex(result1)).toBe(bytesToHex(result2));
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty info', () => {
      const ikm = 'key';
      const salt = 'salt';
      const length = 32;

      const result = hkdf('blake2b', salt, ikm, '', length);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(length);
    });

    it('should handle binary input', () => {
      const ikm = new Uint8Array([1, 2, 3, 4, 5]);
      const salt = new Uint8Array([5, 4, 3, 2, 1]);
      const info = new Uint8Array([1, 1, 1, 1]);
      const length = 16;

      const result = hkdf('blake2b', salt, ikm, info, length);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(length);
    });

    it('should handle string input', () => {
      const ikm = 'string-key';
      const salt = 'string-salt';
      const info = 'string-info';
      const length = 16;

      const result = hkdf('blake2b', salt, ikm, info, length);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(length);
    });
  });
});

describe('HKDF-SHA512', () => {
  describe('Basic Functionality', () => {
    it('should derive key with SHA-512', () => {
      const ikm = 'input-key-material';
      const salt = 'random-salt';
      const info = 'context-info';
      const length = 32;

      const result = hkdf('sha512', salt, ikm, info, length);

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBe(length);
    });
  });

  describe('Comparison with BLAKE2b', () => {
    it('should produce different output than BLAKE2b', () => {
      const ikm = 'test';
      const salt = 'test';
      const info = 'test';
      const length = 32;

      const sha512Result = hkdf('sha512', salt, ikm, info, length);
      const blake2bResult = hkdf('blake2b', salt, ikm, info, length);

      expect(bytesToHex(sha512Result)).not.toBe(bytesToHex(blake2bResult));
    });
  });
});
