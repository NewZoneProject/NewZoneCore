// Module: Authenticated Handshake (X25519 + Ed25519)
// Description: Transport-agnostic authenticated key exchange.
// File: core/crypto/handshake.js

import { randomSeed } from './random.js';
import { x25519, x25519Base } from '../libs/x25519.js';
import { sign as edSign, verify as edVerify } from './sign.js';

/**
 * Normalize input to Uint8Array.
 */
function toBytes(input) {
  if (input == null) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (typeof input === 'string') return new Uint8Array(Buffer.from(input, 'utf8'));
  throw new Error('handshake: unsupported input type');
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const HANDSHAKE_LABEL = 'NZ-CRYPTO-02/handshake/v1';

function buildTranscriptLabel() {
  return toBytes(HANDSHAKE_LABEL);
}

/**
 * Alice → start handshake
 *
 * @param {Uint8Array} aliceIdentitySeed - 32-byte Ed25519 seed
 */
export function aliceStartHandshake(aliceIdentitySeed) {
  const aliceEphemeralSecret = randomSeed();
  const aliceEphemeralPub = x25519Base(aliceEphemeralSecret);

  const label = buildTranscriptLabel();
  const toSign = concatBytes(label, aliceEphemeralPub);

  const aliceSig = edSign(toSign, aliceIdentitySeed);

  return {
    aliceEphemeralSecret,
    aliceEphemeralPub,
    aliceSig
  };
}

/**
 * Bob → respond to AliceHello
 */
export function bobRespondHandshake(params) {
  const {
    aliceEphemeralPub,
    aliceSig,
    aliceIdentityPublicKey,
    bobIdentitySeed
  } = params;

  const label = buildTranscriptLabel();
  const toVerify = concatBytes(label, aliceEphemeralPub);

  const ok = edVerify(toVerify, aliceSig, aliceIdentityPublicKey);
  if (!ok) {
    return { ok: false, error: 'Alice identity signature invalid' };
  }

  const bobEphemeralSecret = randomSeed();
  const bobEphemeralPub = x25519Base(bobEphemeralSecret);

  const toSignBob = concatBytes(label, bobEphemeralPub);
  const bobSig = edSign(toSignBob, bobIdentitySeed);

  const sharedSecretBob = x25519(bobEphemeralSecret, aliceEphemeralPub);

  return {
    ok: true,
    bobEphemeralSecret,
    bobEphemeralPub,
    bobSig,
    sharedSecretBob
  };
}

/**
 * Alice → finish handshake after receiving BobHello
 */
export function aliceFinishHandshake(params) {
  const {
    aliceEphemeralSecret,
    bobEphemeralPub,
    bobSig,
    bobIdentityPublicKey
  } = params;

  const label = buildTranscriptLabel();
  const toVerifyBob = concatBytes(label, bobEphemeralPub);

  const ok = edVerify(toVerifyBob, bobSig, bobIdentityPublicKey);
  if (!ok) {
    return { ok: false, error: 'Bob identity signature invalid' };
  }

  const sharedSecretAlice = x25519(aliceEphemeralSecret, bobEphemeralPub);

  return {
    ok: true,
    sharedSecretAlice
  };
}