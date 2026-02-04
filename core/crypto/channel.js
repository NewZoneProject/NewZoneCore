// Module: Secure Channel
// Description: Bidirectional secure channel over X25519 shared secret.
// File: core/crypto/channel.js

import { deriveSessionKeys, deriveNonceBase } from './derive.js';
import { boxEncrypt, boxDecrypt } from './box.js';

/**
 * Normalize input to Uint8Array.
 */
function toBytes(input) {
  if (input == null) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (typeof input === 'string') return new Uint8Array(Buffer.from(input, 'utf8'));
  throw new Error('channel: unsupported input type');
}

function makeNonce(nonceBase, counter) {
  if (nonceBase.length !== 12) {
    throw new Error('channel: nonceBase must be 12 bytes');
  }
  const nonce = new Uint8Array(12);
  nonce.set(nonceBase);
  nonce[8]  = (counter >>> 24) & 0xff;
  nonce[9]  = (counter >>> 16) & 0xff;
  nonce[10] = (counter >>> 8) & 0xff;
  nonce[11] = counter & 0xff;
  return nonce;
}

export class SecureChannel {
  /**
   * @param {Object} params
   * @param {Uint8Array|Buffer} params.sharedSecret - X25519 shared secret
   * @param {string} params.baseContext - base protocol context
   * @param {"alice"|"bob"} params.role - local role
   */
  constructor(params) {
    const {
      sharedSecret,
      baseContext,
      role,
    } = params || {};

    if (!sharedSecret) throw new Error('SecureChannel: sharedSecret is required');
    if (!baseContext) throw new Error('SecureChannel: baseContext is required');
    if (role !== 'alice' && role !== 'bob') {
      throw new Error('SecureChannel: role must be "alice" or "bob"');
    }

    this._role = role;
    this._baseContext = baseContext;
    this._sharedSecret = toBytes(sharedSecret);

    this._epoch = 0;
    this._sendCounter = 1;
    this._recvCounter = 1;

    this._deriveKeysForEpoch();
  }

  _deriveKeysForEpoch() {
    const epochContext = `${this._baseContext}/epoch-${this._epoch}`;

    const ctxAB = `${epochContext}/alice->bob`;
    const ctxBA = `${epochContext}/bob->alice`;

    const keysAB = deriveSessionKeys(this._sharedSecret, ctxAB);
    const keysBA = deriveSessionKeys(this._sharedSecret, ctxBA);

    const nonceBaseAB = deriveNonceBase(this._sharedSecret, ctxAB);
    const nonceBaseBA = deriveNonceBase(this._sharedSecret, ctxBA);

    if (this._role === 'alice') {
      this._sendKey = keysAB.send;
      this._recvKey = keysBA.send;
      this._sendNonceBase = nonceBaseAB;
      this._recvNonceBase = nonceBaseBA;
    } else {
      this._sendKey = keysBA.send;
      this._recvKey = keysAB.send;
      this._sendNonceBase = nonceBaseBA;
      this._recvNonceBase = nonceBaseAB;
    }
  }

  /**
   * Rekey the channel: increment epoch and derive fresh keys.
   * Counters are reset to 1.
   */
  rekey() {
    this._epoch += 1;
    this._sendCounter = 1;
    this._recvCounter = 1;
    this._deriveKeysForEpoch();
  }

  /**
   * Encrypt a message to the peer.
   *
   * @param {Uint8Array|Buffer|string} plaintext
   * @param {Uint8Array|Buffer|string} [aad]
   * @returns {{ nonce: Uint8Array, ciphertext: Uint8Array, tag: Uint8Array, counter: number, epoch: number }}
   */
  encryptToPeer(plaintext, aad = null) {
    const pt = toBytes(plaintext);
    const a = aad != null ? toBytes(aad) : null;
    const counter = this._sendCounter++;
    const nonce = makeNonce(this._sendNonceBase, counter);
    const { ciphertext, tag } = boxEncrypt(this._sendKey, nonce, pt, a);
    return { nonce, ciphertext, tag, counter, epoch: this._epoch };
  }

  /**
   * Decrypt a message from the peer.
   *
   * @param {Uint8Array|Buffer} nonce
   * @param {Uint8Array|Buffer} ciphertext
   * @param {Uint8Array|Buffer} tag
   * @param {Uint8Array|Buffer|string} [aad]
   * @returns {Uint8Array|null} plaintext or null on auth failure
   */
  decryptFromPeer(nonce, ciphertext, tag, aad = null) {
    const ct = toBytes(ciphertext);
    const t = toBytes(tag);
    const a = aad != null ? toBytes(aad) : null;
    const pt = boxDecrypt(this._recvKey, toBytes(nonce), ct, t, a);
    if (pt !== null) {
      this._recvCounter++;
    }
    return pt;
  }
}