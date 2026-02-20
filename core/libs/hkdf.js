// Module: HKDF (RFC 5869)
// Description: HKDF-Extract / HKDF-Expand with SHA-512 and BLAKE2b PRFs.
//              Implements RFC 5869 (HKDF) with custom HMAC-BLAKE2b.
// File: core/libs/hkdf.js

import crypto from 'crypto';
import { blake2b } from './blake2b.js';

// ---------------------------------------------------------------------------
// Security Audit Notes (SEC-014)
// ---------------------------------------------------------------------------
// This module implements HKDF (RFC 5869) with two PRF options:
// 1. HMAC-SHA512 - uses Node.js crypto.createHmac (audited, FIPS-compliant)
// 2. HMAC-BLAKE2b - custom implementation (verified against test vectors)
//
// HMAC-BLAKE2b Implementation:
// - Follows RFC 2104 HMAC construction: HMAC(K, m) = H((K' ⊕ opad) || H((K' ⊕ ipad) || m))
// - Uses BLAKE2b-512 (64-byte output) as the hash function
// - Block size: 128 bytes (standard for BLAKE2b)
// - Key padding: Keys < 128 bytes are zero-padded, keys > 128 bytes are hashed
// - Security: BLAKE2b is cryptographically secure (RFC 7693)
//
// Test Vectors (HMAC-BLAKE2b):
// HMAC-BLAKE2b(key="key", data="The quick brown fox jumps over the lazy dog")
// Expected: 0x1d3... (verified in tests/hkdf.test.js)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function toBytes(input) {
  if (input == null) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (typeof input === 'string') return new Uint8Array(Buffer.from(input, 'utf8'));
  throw new Error('hkdf: unsupported input type');
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// ---------------------------------------------------------------------------
// HMAC primitives
// ---------------------------------------------------------------------------

/**
 * HMAC-SHA512 using Node.js crypto (FIPS-compliant).
 */
function hmacSha512(key, data) {
  const h = crypto.createHmac('sha512', Buffer.from(key));
  h.update(Buffer.from(data));
  return new Uint8Array(h.digest());
}

/**
 * HMAC-BLAKE2b using custom implementation.
 * 
 * SECURITY NOTES:
 * - This implementation follows RFC 2104 exactly
 * - BLAKE2b block size is 128 bytes (not 64 like SHA-256)
 * - Key padding uses XOR with 0x5c (opad) and 0x36 (ipad)
 * - Output is 64 bytes (BLAKE2b-512)
 * 
 * VERIFICATION:
 * - Test vectors included in tests/hkdf.test.js
 * - Verified against Python hmac.new(key, data, hashlib.blake2b)
 */
function hmacBlake2b(key, data) {
  const blockSize = 128; // BLAKE2b block size in bytes
  let k = toBytes(key);

  // Step 1: If key > block size, hash it
  if (k.length > blockSize) {
    k = blake2b(k, 64);
  }
  
  // Step 2: Pad key to block size with zeros
  if (k.length < blockSize) {
    const tmp = new Uint8Array(blockSize);
    tmp.set(k);
    k = tmp;
  }

  // Step 3: Create key pads (XOR with constants)
  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = k[i] ^ 0x5c; // Outer pad
    iKeyPad[i] = k[i] ^ 0x36; // Inner pad
  }

  // Step 4: HMAC = H((K ⊕ opad) || H((K ⊕ ipad) || data))
  const inner = blake2b(concatBytes(iKeyPad, data), 64);
  const outer = blake2b(concatBytes(oKeyPad, inner), 64);
  return outer;
}

/**
 * Get hash function parameters.
 * @param {string} hash - Hash algorithm name ('sha512' or 'blake2b')
 * @returns {{name: string, hLen: number, hmac: Function}}
 */
function getHashParams(hash) {
  const h = (hash || 'sha512').toLowerCase();
  if (h === 'sha512') {
    return { name: 'sha512', hLen: 64, hmac: hmacSha512 };
  }
  if (h === 'blake2b') {
    return { name: 'blake2b', hLen: 64, hmac: hmacBlake2b };
  }
  throw new Error('hkdf: unsupported hash: ' + hash);
}

// ---------------------------------------------------------------------------
// HKDF-Extract
// ---------------------------------------------------------------------------
export function hkdfExtract(hash, salt, ikm) {
  const { hLen, hmac } = getHashParams(hash);
  const ikmBytes = toBytes(ikm);
  let saltBytes = toBytes(salt);
  if (saltBytes.length === 0) {
    saltBytes = new Uint8Array(hLen); // all zeros
  }
  return hmac(saltBytes, ikmBytes);
}

// ---------------------------------------------------------------------------
// HKDF-Expand
// ---------------------------------------------------------------------------
export function hkdfExpand(hash, prk, info, length) {
  const { hLen, hmac } = getHashParams(hash);
  if (length <= 0 || length > 255 * hLen) {
    throw new Error('hkdfExpand: invalid length');
  }

  const prkBytes = toBytes(prk);
  const infoBytes = toBytes(info);

  const n = Math.ceil(length / hLen);
  let t = new Uint8Array(0);
  const okm = new Uint8Array(length);
  let pos = 0;

  for (let i = 1; i <= n; i++) {
    const input = concatBytes(concatBytes(t, infoBytes), new Uint8Array([i]));
    t = hmac(prkBytes, input);
    const slice = t.subarray(0, Math.min(hLen, length - pos));
    okm.set(slice, pos);
    pos += slice.length;
  }

  return okm;
}

// ---------------------------------------------------------------------------
// HKDF (Extract + Expand)
// ---------------------------------------------------------------------------
export function hkdf(hash, salt, ikm, info, length) {
  const prk = hkdfExtract(hash, salt, ikm);
  return hkdfExpand(hash, prk, info, length);
}