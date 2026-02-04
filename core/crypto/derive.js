// Module: Key Derivation Primitives
// Description: HKDF-based key derivation for NewZoneCore.
// File: core/crypto/derive.js

import { blake2b } from '../libs/blake2b.js';
import { hkdf } from '../libs/hkdf.js';

/**
 * Normalize input to Uint8Array.
 * Accepts: Uint8Array | Buffer | string | null
 */
function toBytes(input) {
  if (input == null) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (typeof input === 'string') return new Uint8Array(Buffer.from(input, 'utf8'));
  throw new Error('derive: unsupported input type');
}

/**
 * Derive a master key from seed entropy using BLAKE2b.
 * This is the "seed master key" used for deterministic key generation.
 *
 * Output: 32-byte master key.
 *
 * @param {Uint8Array|Buffer|string} seed
 * @returns {Uint8Array} 32-byte master key
 */
export function deriveSeedMasterKey(seed) {
  const s = toBytes(seed);
  return blake2b(s, 32); // BLAKE2b-256(seed)
}

/**
 * Generic HKDF-based subkey derivation from a master key.
 * Uses HKDF with BLAKE2b as PRF.
 *
 * @param {Uint8Array|Buffer|string} masterKey - input keying material
 * @param {Uint8Array|Buffer|string} context   - domain/context string
 * @param {number} length                     - output length in bytes
 * @param {Uint8Array|Buffer|string} [salt]   - optional salt
 * @returns {Uint8Array} derived key
 */
export function deriveSubKey(masterKey, context, length, salt = null) {
  const ikm = toBytes(masterKey);
  const info = toBytes(context);
  const s = toBytes(salt);
  return hkdf('blake2b', s, ikm, info, length);
}

/**
 * Derive a 32-byte key for a specific purpose.
 * Convenience wrapper over deriveSubKey.
 *
 * @param {Uint8Array|Buffer|string} masterKey
 * @param {string} label - e.g. "identity", "ecdh", "sign", "box"
 * @returns {Uint8Array} 32-byte derived key
 */
export function deriveNamedKey(masterKey, label) {
  return deriveSubKey(masterKey, `nzcore:key:${label}`, 32);
}

/**
 * Derive a 12-byte nonce base for AEAD (ChaCha20-Poly1305).
 * Nonce = base (12 bytes) XOR counter/sequence (encoded separately).
 *
 * @param {Uint8Array|Buffer|string} masterKey
 * @param {string} label - e.g. "ipc", "queue", "session"
 * @returns {Uint8Array} 12-byte nonce base
 */
export function deriveNonceBase(masterKey, label) {
  const full = deriveSubKey(masterKey, `nzcore:nonce:${label}`, 12);
  return full.subarray(0, 12);
}

/**
 * Derive a pair of send/recv keys for a session.
 * Symmetric, context-bound.
 *
 * @param {Uint8Array|Buffer|string} masterKey
 * @param {Uint8Array|Buffer|string} sessionId
 * @returns {{ send: Uint8Array, recv: Uint8Array }}
 */
export function deriveSessionKeys(masterKey, sessionId) {
  const baseContext = Buffer.from('nzcore:session:', 'utf8');
  const sid = toBytes(sessionId);

  const ctxSend = new Uint8Array(baseContext.length + sid.length + 1);
  ctxSend.set(baseContext, 0);
  ctxSend.set(sid, baseContext.length);
  ctxSend[ctxSend.length - 1] = 0x01;

  const ctxRecv = new Uint8Array(baseContext.length + sid.length + 1);
  ctxRecv.set(baseContext, 0);
  ctxRecv.set(sid, baseContext.length);
  ctxRecv[ctxRecv.length - 1] = 0x02;

  const send = deriveSubKey(masterKey, ctxSend, 32);
  const recv = deriveSubKey(masterKey, ctxRecv, 32);

  return { send, recv };
}