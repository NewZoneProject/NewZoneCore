// Module: Signature Primitives
// Description: Ed25519 signing & verification using raw 32-byte seeds.
// File: core/crypto/sign.js

import { ed25519GetPublicKey, ed25519Sign, ed25519Verify } from '../libs/ed25519.js';

/**
 * Normalize input to Uint8Array.
 */
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (typeof input === 'string') return new Uint8Array(Buffer.from(input, 'utf8'));
  throw new Error('sign: unsupported input type');
}

/**
 * Derive public key from 32-byte seed.
 *
 * @param {Uint8Array|Buffer} seed
 * @returns {Uint8Array} 32-byte public key
 */
export function getPublicKey(seed) {
  return ed25519GetPublicKey(toBytes(seed));
}

/**
 * Sign message using 32-byte seed.
 *
 * @param {Uint8Array|Buffer|string} message
 * @param {Uint8Array|Buffer} seed - 32 bytes
 * @returns {Uint8Array} 64-byte signature
 */
export function sign(message, seed) {
  const msg = toBytes(message);
  const s = toBytes(seed);
  return ed25519Sign(msg, s);
}

/**
 * Verify signature using 32-byte public key.
 *
 * @param {Uint8Array|Buffer|string} message
 * @param {Uint8Array|Buffer} signature - 64 bytes
 * @param {Uint8Array|Buffer} publicKey - 32 bytes
 * @returns {boolean}
 */
export function verify(message, signature, publicKey) {
  const msg = toBytes(message);
  const sig = toBytes(signature);
  const pub = toBytes(publicKey);
  return ed25519Verify(msg, sig, pub);
}