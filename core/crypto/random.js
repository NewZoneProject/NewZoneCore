// Module: Secure Random Utilities
// Description: Cryptographically secure random bytes & helpers.
// File: core/crypto/random.js

import crypto from 'crypto';

/**
 * Generate cryptographically secure random bytes.
 *
 * @param {number} length - number of bytes
 * @returns {Uint8Array}
 */
export function randomBytes(length) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('random: length must be a positive integer');
  }
  return new Uint8Array(crypto.randomBytes(length));
}

/**
 * Generate a random 32-byte seed.
 *
 * @returns {Uint8Array}
 */
export function randomSeed() {
  return randomBytes(32);
}

/**
 * Generate a random 12-byte nonce for AEAD.
 * (ChaCha20-Poly1305 standard nonce size)
 *
 * @returns {Uint8Array}
 */
export function randomNonce() {
  return randomBytes(12);
}

/**
 * Generate a random hex string.
 *
 * @param {number} length - number of bytes
 * @returns {string} hex string
 */
export function randomHex(length) {
  return Buffer.from(randomBytes(length)).toString('hex');
}