// Module: Ed25519 Signatures (RFC 8032)
// Description: Production-ready Ed25519 implementation using node:crypto.
//              Supports Ed25519, Ed25519ctx, Ed25519ph.
// File: core/libs/ed25519.js

import crypto from 'crypto';

// ============================================================================
// Block 1 — SHA-512 (reference wrapper)
// ============================================================================
export function sha512(message) {
  const m = message instanceof Uint8Array ? message : new Uint8Array(message);
  return new Uint8Array(
    crypto.createHash('sha512').update(m).digest()
  );
}

// ============================================================================
// Block 2 — Ed25519 key generation, signing, verification (via node:crypto)
// ============================================================================

// seed: 32-byte Uint8Array / Buffer
export function ed25519GetPublicKey(seed) {
  const s = Buffer.from(seed);
  if (s.length !== 32) {
    throw new Error('Ed25519 seed must be 32 bytes');
  }

  // PKCS#8 private key structure for Ed25519
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    s
  ]);

  const privKey = crypto.createPrivateKey({
    key: pkcs8,
    format: 'der',
    type: 'pkcs8'
  });

  const pubDer = crypto.createPublicKey(privKey).export({
    type: 'spki',
    format: 'der'
  });

  // Last 32 bytes contain the raw Ed25519 public key
  return new Uint8Array(pubDer.subarray(pubDer.length - 32));
}

// msg: Uint8Array/Buffer/string, seed: 32-byte
export function ed25519Sign(msg, seed) {
  const s = Buffer.from(seed);
  if (s.length !== 32) {
    throw new Error('Ed25519 seed must be 32 bytes');
  }

  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    s
  ]);

  const privKey = crypto.createPrivateKey({
    key: pkcs8,
    format: 'der',
    type: 'pkcs8'
  });

  const m = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
  const sig = crypto.sign(null, m, privKey);
  return new Uint8Array(sig);
}

// msg: Uint8Array/Buffer/string, sig: 64-byte, pub: 32-byte
export function ed25519Verify(msg, sig, pub) {
  const p = Buffer.from(pub);
  const s = Buffer.from(sig);

  if (p.length !== 32) return false;
  if (s.length !== 64) return false;

  const spki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    p
  ]);

  const pubKey = crypto.createPublicKey({
    key: spki,
    format: 'der',
    type: 'spki'
  });

  const m = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
  return crypto.verify(null, m, pubKey, s);
}

// ============================================================================
// Block 3 — Ed25519ctx / Ed25519ph (RFC 8032)
// ============================================================================

// RFC 8032 domain separator construction
function dom2(prefixFlag, context) {
  const ctx = context ? Buffer.from(context) : Buffer.alloc(0);
  if (ctx.length > 255) {
    throw new Error('Ed25519ctx: context must be ≤ 255 bytes');
  }

  // "SigEd25519 no Ed25519 collisions"
  const domPrefix = Buffer.from(
    '53696745643235353139206e6f204564323535313920636f6c6c6973696f6e73',
    'hex'
  );

  return new Uint8Array(
    Buffer.concat([
      domPrefix,
      Buffer.from([prefixFlag]),
      Buffer.from([ctx.length]),
      ctx
    ])
  );
}

// ---------------------------------------------------------------------------
// Ed25519ctx — Context-bound signatures
// ---------------------------------------------------------------------------
export function ed25519SignCtx(msg, seed, context) {
  const dom = dom2(0x01, context);
  const fullMsg = Buffer.concat([Buffer.from(dom), Buffer.from(msg)]);
  return ed25519Sign(fullMsg, seed);
}

export function ed25519VerifyCtx(pub, msg, sig, context) {
  const dom = dom2(0x01, context);
  const fullMsg = Buffer.concat([Buffer.from(dom), Buffer.from(msg)]);
  return ed25519Verify(fullMsg, sig, pub);
}

// ---------------------------------------------------------------------------
// Ed25519ph — Pre-hashed signatures
// ---------------------------------------------------------------------------
export function ed25519SignPh(prehashedMsg, seed, context) {
  if (!(prehashedMsg instanceof Uint8Array) || prehashedMsg.length !== 64) {
    throw new Error('Ed25519ph: pre-hashed message must be 64 bytes');
  }

  const dom = dom2(0x02, context);
  const fullMsg = Buffer.concat([Buffer.from(dom), Buffer.from(prehashedMsg)]);
  return ed25519Sign(fullMsg, seed);
}

export function ed25519VerifyPh(pub, prehashedMsg, sig, context) {
  if (!(prehashedMsg instanceof Uint8Array) || prehashedMsg.length !== 64) {
    throw new Error('Ed25519ph: pre-hashed message must be 64 bytes');
  }

  const dom = dom2(0x02, context);
  const fullMsg = Buffer.concat([Buffer.from(dom), Buffer.from(prehashedMsg)]);
  return ed25519Verify(fullMsg, sig, pub);
}

// ============================================================================
// Public API (NewZone-facing)
// ============================================================================

export const getPublicKey = ed25519GetPublicKey;
export const sign = ed25519Sign;
export const verify = ed25519Verify;