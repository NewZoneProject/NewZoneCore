// Module: Crypto Routing (nz-routing-crypto-01)
// Description: Signed routing packets for inter-service communication.
// File: core/crypto/routing.js

import { sign as edSign, verify as edVerify } from './sign.js';
import { randomHex } from './random.js';

const te = new TextEncoder();

// --- Canonical JSON ---------------------------------------------------------

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(v => stableStringify(v)).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k]));
  return '{' + entries.join(',') + '}';
}

function buildSigningPayload(packet) {
  const { version, node_id, ts, nonce, payload } = packet;
  const canonical = { version, node_id, ts, nonce, payload };
  return te.encode(stableStringify(canonical));
}

// --- Sign -------------------------------------------------------------------

export function signRoutingPacket({ nodeId, privateSeed, payload }) {
  const packet = {
    version: 'nz-routing-crypto-01',
    node_id: nodeId,
    ts: Date.now(),
    nonce: randomHex(8),
    payload
  };

  const signingPayload = buildSigningPayload(packet);
  const sig = edSign(signingPayload, privateSeed);

  packet.signature = Buffer.from(sig).toString('base64');
  return packet;
}

// --- Verify -----------------------------------------------------------------

export async function verifyRoutingPacket({
  packet,
  getPublicKeyByNodeId,
  maxSkewSec = 300
}) {
  if (!packet || packet.version !== 'nz-routing-crypto-01') {
    return { ok: false, reason: 'unsupported-version' };
  }

  const { node_id, ts, nonce, payload, signature } = packet;

  if (!node_id) return { ok: false, reason: 'missing-node-id' };
  if (typeof ts !== 'number') return { ok: false, reason: 'invalid-ts' };
  if (!nonce) return { ok: false, reason: 'invalid-nonce' };
  if (!signature) return { ok: false, reason: 'missing-signature' };

  const now = Date.now();
  if (Math.abs(now - ts) > maxSkewSec * 1000) {
    return { ok: false, reason: 'ts-skew' };
  }

  const pub = await getPublicKeyByNodeId(node_id);
  if (!pub) return { ok: false, reason: 'unknown-node' };

  const signingPayload = buildSigningPayload(packet);
  const sigBytes = new Uint8Array(Buffer.from(signature, 'base64'));

  const ok = edVerify(signingPayload, sigBytes, pub);
  if (!ok) return { ok: false, reason: 'invalid-signature' };

  return { ok: true, node_id, payload };
}