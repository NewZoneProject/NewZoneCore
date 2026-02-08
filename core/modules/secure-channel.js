// Module: Secure Channel Manager
// Description: Minimal secure channel module for NewZoneCore. Provides
//              X25519 ECDH shared secrets, Ed25519 signatures, and
//              trusted peer verification.
// File: core/modules/secure-channel.js

import { subtle } from 'crypto';

/**
 * Create a secure channel manager.
 *
 * @param {Object} options
 * @param {Object} options.supervisor
 */
export function createSecureChannelManager({ supervisor }) {
  if (!supervisor) {
    throw new Error('SecureChannelManager requires supervisor');
  }

  const channels = {}; // { peerId: { sharedSecret, peerPubKey } }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function isTrusted(peerId) {
    const trust = supervisor.getTrust();
    return trust.peers.some(p => p.id === peerId);
  }

  async function deriveSharedSecret(peerPubKey) {
    const localECDH = supervisor.getECDH();
    if (!localECDH?.private) {
      throw new Error('Local ECDH private key missing');
    }

    const privateKey = await subtle.importKey(
      'raw',
      localECDH.private,
      { name: 'ECDH', namedCurve: 'X25519' },
      false,
      ['deriveBits']
    );

    const publicKey = await subtle.importKey(
      'raw',
      peerPubKey,
      { name: 'ECDH', namedCurve: 'X25519' },
      false,
      []
    );

    const bits = await subtle.deriveBits(
      { name: 'ECDH', public: publicKey },
      privateKey,
      256
    );

    return new Uint8Array(bits);
  }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  async function createChannel(peerId, peerPubKey) {
    if (!isTrusted(peerId)) {
      throw new Error(`Peer ${peerId} is not trusted`);
    }

    const sharedSecret = await deriveSharedSecret(peerPubKey);

    channels[peerId] = {
      peerId,
      peerPubKey,
      sharedSecret
    };

    supervisor.emit('secure-channel:created', { peerId });

    return channels[peerId];
  }

  function getChannel(peerId) {
    return channels[peerId] || null;
  }

  async function encrypt(channel, data) {
    // Minimal XOR-based placeholder encryption (Phase 2.x will replace)
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      out[i] = data[i] ^ channel.sharedSecret[i % channel.sharedSecret.length];
    }
    return out;
  }

  async function decrypt(channel, data) {
    // XOR is symmetric
    return encrypt(channel, data);
  }

  async function sign(data) {
    const identity = supervisor.getIdentity();
    if (!identity?.seed) {
      throw new Error('Ed25519 private key missing');
    }

    const privateKey = await subtle.importKey(
      'raw',
      identity.seed,
      { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
      false,
      ['sign']
    );

    return new Uint8Array(
      await subtle.sign('NODE-ED25519', privateKey, data)
    );
  }

  async function verify(data, signature, pubkey) {
    const publicKey = await subtle.importKey(
      'raw',
      pubkey,
      { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' },
      false,
      ['verify']
    );

    return subtle.verify('NODE-ED25519', publicKey, signature, data);
  }

  return {
    createChannel,
    getChannel,
    encrypt,
    decrypt,
    sign,
    verify
  };
}

