// Module: Packet Signing & Encryption
// Description: High-level helpers for signed & encrypted packets.
// File: core/crypto/packets.js

import crypto from 'crypto';
import { sign as edSign, verify as edVerify } from './sign.js';
import { randomBytes } from './random.js';
import { encrypt as aeadEncrypt, decrypt as aeadDecrypt } from '../libs/chacha20poly1305.js';

const te = new TextEncoder();
const td = new TextDecoder();

// --- Utils ------------------------------------------------------------------

function sha256(bytes) {
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from(bytes));
  return new Uint8Array(hash.digest());
}

function sha256Hex(obj) {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
  const data = te.encode(json);
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from(data));
  return hash.digest('hex');
}

function canonicalize(obj) {
  const keys = Object.keys(obj).sort();
  const res = {};
  for (const k of keys) {
    if (obj[k] !== undefined) res[k] = obj[k];
  }
  return res;
}

function u8ToB64(u8) {
  return Buffer.from(u8).toString('base64');
}

function b64ToU8(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// --- Signed packets ---------------------------------------------------------

export async function buildSignedPacket({ nodeId, privateSeed, body }) {
  const bodyHash = sha256Hex(body);

  const auth = {
    node_id: nodeId,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: randomBytes(16).toString('hex'),
    body_hash: bodyHash,
  };

  const canonicalAuth = canonicalize(auth);
  const authHashHex = sha256Hex(canonicalAuth);
  const msgBytes = te.encode(authHashHex);

  const sigBytes = edSign(msgBytes, privateSeed);
  const signature = u8ToB64(sigBytes);

  return {
    auth: { ...auth, signature },
    body,
  };
}

export async function verifySignedPacket({
  packet,
  getPublicKeyByNodeId,
  maxSkewSec = 300,
  isNonceSeen,
}) {
  const { auth, body } = packet || {};
  if (!auth || !body) return { ok: false, reason: 'missing_auth_or_body' };

  const { node_id, timestamp, nonce, body_hash, signature } = auth;
  if (!node_id || !timestamp || !nonce || !body_hash || !signature) {
    return { ok: false, reason: 'missing_auth_fields' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > maxSkewSec) {
    return { ok: false, reason: 'timestamp_out_of_range' };
  }

  if (isNonceSeen) {
    const replay = await isNonceSeen(node_id, nonce);
    if (replay) return { ok: false, reason: 'replay_nonce' };
  }

  const realBodyHash = sha256Hex(body);
  if (realBodyHash !== body_hash) {
    return { ok: false, reason: 'body_hash_mismatch' };
  }

  const { signature: _, ...authWithoutSig } = auth;
  const canonicalAuth = canonicalize(authWithoutSig);
  const authHashHex = sha256Hex(canonicalAuth);
  const msgBytes = te.encode(authHashHex);

  const pubKey = await getPublicKeyByNodeId(node_id);
  if (!pubKey) return { ok: false, reason: 'unknown_node' };

  const sigBytes = b64ToU8(signature);
  const ok = edVerify(msgBytes, sigBytes, pubKey);
  if (!ok) return { ok: false, reason: 'invalid_signature' };

  return { ok: true, node_id };
}

// --- Encrypted packets ------------------------------------------------------

export function encryptPacket({
  packet,
  sessionKey,
  senderNodeId,
  receiverNodeId,
  baseContext = 'NZ-CRYPTO-01/packet',
}) {
  const json = JSON.stringify(packet);
  const plaintext = te.encode(json);

  const nonce = randomBytes(12);
  const aad = te.encode(`${senderNodeId}->${receiverNodeId}`);

  const { ciphertext, tag } = aeadEncrypt(sessionKey, nonce, plaintext, aad);

  return {
    version: 'nz-crypto-01',
    cipher: 'chacha20-poly1305',
    sender_node_id: senderNodeId,
    receiver_node_id: receiverNodeId,
    nonce: u8ToB64(nonce),
    tag: u8ToB64(tag),
    ciphertext: u8ToB64(ciphertext),
    context: baseContext,
  };
}

export function decryptPacket({ packet, sessionKey }) {
  if (packet.version !== 'nz-crypto-01') {
    throw new Error(`Unsupported crypto version: ${packet.version}`);
  }
  if (packet.cipher !== 'chacha20-poly1305') {
    throw new Error(`Unsupported cipher: ${packet.cipher}`);
  }

  const nonce = b64ToU8(packet.nonce);
  const tag = b64ToU8(packet.tag);
  const ciphertext = b64ToU8(packet.ciphertext);
  const aad = te.encode(`${packet.sender_node_id}->${packet.receiver_node_id}`);

  const plaintext = aeadDecrypt(sessionKey, nonce, ciphertext, tag, aad);
  if (plaintext === null) {
    throw new Error('Packet authentication failed');
  }

  const json = td.decode(plaintext);
  return JSON.parse(json);
}