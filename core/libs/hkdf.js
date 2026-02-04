// Module: HKDF (RFC 5869)
// Description: HKDF-Extract / HKDF-Expand with SHA-512 and BLAKE2b PRFs.
// File: core/libs/hkdf.js

import crypto from 'crypto';
import { blake2b } from './blake2b.js';

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
function hmacSha512(key, data) {
  const h = crypto.createHmac('sha512', Buffer.from(key));
  h.update(Buffer.from(data));
  return new Uint8Array(h.digest());
}

// HMAC-BLAKE2b with 128-byte block size
function hmacBlake2b(key, data) {
  const blockSize = 128;
  let k = new Uint8Array(key);

  if (k.length > blockSize) {
    k = blake2b(k, 64);
  }
  if (k.length < blockSize) {
    const tmp = new Uint8Array(blockSize);
    tmp.set(k);
    k = tmp;
  }

  const oKeyPad = new Uint8Array(blockSize);
  const iKeyPad = new Uint8Array(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = k[i] ^ 0x5c;
    iKeyPad[i] = k[i] ^ 0x36;
  }

  const inner = blake2b(concatBytes(iKeyPad, data), 64);
  const outer = blake2b(concatBytes(oKeyPad, inner), 64);
  return outer;
}

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