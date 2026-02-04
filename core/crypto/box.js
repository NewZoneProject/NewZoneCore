// Module: Crypto Box (X25519 + ChaCha20-Poly1305)
// Description: Secure symmetric channel using ECDH + AEAD.
// File: core/crypto/box.js

import { x25519, x25519Base } from '../libs/x25519.js';
import { encrypt as aeadEncrypt, decrypt as aeadDecrypt } from '../libs/chacha20poly1305.js';
import { deriveSubKey } from './derive.js';

/**
 * Normalize input to Uint8Array.
 */
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (typeof input === 'string') return new Uint8Array(Buffer.from(input, 'utf8'));
  throw new Error('box: unsupported input type');
}

/**
 * Generate an X25519 keypair from a 32-byte seed.
 *
 * @param {Uint8Array|Buffer} seed - 32 bytes
 * @returns {{ publicKey: Uint8Array, privateKey: Uint8Array }}
 */
export function generateKeyPair(seed) {
  const priv = toBytes(seed);
  if (priv.length !== 32) {
    throw new Error('box: private key seed must be 32 bytes');
  }
  const pub = x25519Base(priv);
  return { publicKey: pub, privateKey: priv };
}

/**
 * Perform X25519 ECDH.
 *
 * @param {Uint8Array} privateKey - 32 bytes
 * @param {Uint8Array} peerPublicKey - 32 bytes
 * @returns {Uint8Array} 32-byte shared secret
 */
export function deriveSharedSecret(privateKey, peerPublicKey) {
  const priv = toBytes(privateKey);
  const pub = toBytes(peerPublicKey);

  if (priv.length !== 32) throw new Error('box: private key must be 32 bytes');
  if (pub.length !== 32) throw new Error('box: public key must be 32 bytes');

  return x25519(priv, pub);
}

/**
 * Derive symmetric AEAD key from shared secret.
 *
 * @param {Uint8Array} sharedSecret
 * @param {string} label
 * @returns {Uint8Array} 32-byte key
 */
export function deriveBoxKey(sharedSecret, label = 'box') {
  return deriveSubKey(sharedSecret, `nzcore:box:${label}`, 32);
}

/**
 * Encrypt message using AEAD (ChaCha20-Poly1305).
 *
 * @param {Uint8Array} key - 32 bytes
 * @param {Uint8Array} nonce - 12 bytes
 * @param {Uint8Array|string} plaintext
 * @param {Uint8Array|string|null} aad
 * @returns {{ ciphertext: Uint8Array, tag: Uint8Array }}
 */
export function boxEncrypt(key, nonce, plaintext, aad = null) {
  const k = toBytes(key);
  const n = toBytes(nonce);
  const pt = toBytes(plaintext);
  const a = aad ? toBytes(aad) : null;

  if (k.length !== 32) throw new Error('box: key must be 32 bytes');
  if (n.length !== 12) throw new Error('box: nonce must be 12 bytes');

  return aeadEncrypt(k, n, pt, a);
}

/**
 * Decrypt message using AEAD (ChaCha20-Poly1305).
 *
 * @param {Uint8Array} key - 32 bytes
 * @param {Uint8Array} nonce - 12 bytes
 * @param {Uint8Array} ciphertext
 * @param {Uint8Array} tag - 16 bytes
 * @param {Uint8Array|string|null} aad
 * @returns {Uint8Array|null}
 */
export function boxDecrypt(key, nonce, ciphertext, tag, aad = null) {
  const k = toBytes(key);
  const n = toBytes(nonce);
  const ct = toBytes(ciphertext);
  const t = toBytes(tag);
  const a = aad ? toBytes(aad) : null;

  if (k.length !== 32) throw new Error('box: key must be 32 bytes');
  if (n.length !== 12) throw new Error('box: nonce must be 12 bytes');
  if (t.length !== 16) throw new Error('box: tag must be 16 bytes');

  return aeadDecrypt(k, n, ct, t, a);
}