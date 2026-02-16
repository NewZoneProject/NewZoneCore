// Module: ChaCha20-Poly1305 AEAD (RFC 8439)
// Description: Minimal AEAD wrapper using node:crypto backend.
// Provides: encrypt(key, nonce, plaintext, aad?), decrypt(...)
// File: core/libs/chacha20poly1305.js

import crypto from 'crypto';

// Normalize input to Uint8Array
function toBytes(input) {
  if (input == null) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (typeof input === 'string') return new Uint8Array(Buffer.from(input, 'utf8'));
  throw new Error('chacha20poly1305: unsupported input type');
}

/**
 * Encrypt using ChaCha20-Poly1305 AEAD (RFC 8439).
 *
 * @param {Uint8Array|Buffer} key - 32-byte key
 * @param {Uint8Array|Buffer} nonce - 12-byte nonce
 * @param {Uint8Array|Buffer|string} plaintext
 * @param {Uint8Array|Buffer|string} [aad]
 * @returns {{ ciphertext: Uint8Array, tag: Uint8Array }}
 */
export function encrypt(key, nonce, plaintext, aad = null) {
  const k = Buffer.from(toBytes(key));
  const n = Buffer.from(toBytes(nonce));
  const pt = Buffer.from(toBytes(plaintext));
  const a = Buffer.from(toBytes(aad));

  if (k.length !== 32) throw new Error('chacha20poly1305: key must be 32 bytes');
  if (n.length !== 12) throw new Error('chacha20poly1305: nonce must be 12 bytes');

  const cipher = crypto.createCipheriv('chacha20-poly1305', k, n, { authTagLength: 16 });
  if (a.length > 0) cipher.setAAD(a, { plaintextLength: pt.length });

  const c1 = cipher.update(pt);
  const c2 = cipher.final();
  const tag = cipher.getAuthTag();

  return {
    ciphertext: new Uint8Array(Buffer.concat([c1, c2])),
    tag: new Uint8Array(tag)
  };
}

/**
 * Decrypt using ChaCha20-Poly1305 AEAD (RFC 8439).
 *
 * @param {Uint8Array|Buffer} key - 32-byte key
 * @param {Uint8Array|Buffer} nonce - 12-byte nonce
 * @param {Uint8Array|Buffer} ciphertext
 * @param {Uint8Array|Buffer} tag - 16-byte auth tag
 * @param {Uint8Array|Buffer|string} [aad]
 * @returns {Uint8Array|null} plaintext or null on auth failure
 */
export function decrypt(key, nonce, ciphertext, tag, aad = null) {
  const k = Buffer.from(toBytes(key));
  const n = Buffer.from(toBytes(nonce));
  const ct = Buffer.from(toBytes(ciphertext));
  const t = Buffer.from(toBytes(tag));
  const a = Buffer.from(toBytes(aad));

  if (k.length !== 32) throw new Error('chacha20poly1305: key must be 32 bytes');
  if (n.length !== 12) throw new Error('chacha20poly1305: nonce must be 12 bytes');
  if (t.length !== 16) throw new Error('chacha20poly1305: tag must be 16 bytes');

  try {
    const decipher = crypto.createDecipheriv('chacha20-poly1305', k, n, { authTagLength: 16 });
    if (a.length > 0) decipher.setAAD(a, { plaintextLength: ct.length });
    decipher.setAuthTag(t);

    const p1 = decipher.update(ct);
    const p2 = decipher.final();
    return new Uint8Array(Buffer.concat([p1, p2]));
  } catch {
    return null;
  }
}