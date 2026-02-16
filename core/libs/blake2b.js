// Module: BLAKE2b Hash (RFC 7693)
// Description: Minimal BLAKE2b wrapper using node:crypto backend.
// Provides: blake2b(input, outLen = 64, key?)
// File: core/libs/blake2b.js

import crypto from 'crypto';

// Normalize input to Uint8Array
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (typeof input === 'string') return new Uint8Array(Buffer.from(input, 'utf8'));
  throw new Error('blake2b: unsupported input type');
}

/**
 * BLAKE2b hash (RFC 7693), using node:crypto "blake2b512" as backend.
 *
 * @param {Uint8Array|Buffer|string} input - message to hash
 * @param {number} outLen - output length in bytes (1..64)
 * @param {Uint8Array|Buffer|null} [key] - optional key (0..64 bytes)
 * @returns {Uint8Array} hash output of length outLen
 */
export function blake2b(input, outLen = 64, key = null) {
  if (outLen <= 0 || outLen > 64) {
    throw new Error('blake2b: outLen must be between 1 and 64 bytes');
  }

  const msg = toBytes(input);
  const keyBuf = key ? Buffer.from(key) : undefined;

  const h = crypto.createHash('blake2b512', { key: keyBuf });
  h.update(Buffer.from(msg));
  const full = h.digest();

  return new Uint8Array(full.subarray(0, outLen));
}