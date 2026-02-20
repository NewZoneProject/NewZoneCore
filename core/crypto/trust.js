// Module: Trust Store Manager
// Description: Loads, validates and updates the trust store used for
//              cryptographic routing and node identity verification.
//              Now with DoS protection (max peers limit).
// File: core/crypto/trust.js

import fs from 'fs/promises';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const ENV = path.join(ROOT, 'env');
const TRUST_FILE = path.join(ENV, 'trust.json');

// DoS protection limits
const MAX_PEERS = 1000; // Maximum number of trusted peers
const MAX_TRUST_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// --- Default trust store structure ------------------------------------------
const DEFAULT_TRUST = {
  peers: [],            // array of { id, pubkey, addedAt }
  updatedAt: null
};

// --- Load trust store --------------------------------------------------------
export async function loadTrustStore() {
  try {
    // Check file size before reading (DoS protection)
    const stats = await fs.stat(TRUST_FILE);
    if (stats.size > MAX_TRUST_FILE_SIZE) {
      throw new Error(`trust.json too large (${stats.size} bytes, max ${MAX_TRUST_FILE_SIZE})`);
    }

    const raw = await fs.readFile(TRUST_FILE, 'utf8');
    const json = JSON.parse(raw);

    // Validate structure
    if (!json || typeof json !== 'object') throw new Error('Invalid trust.json');
    if (!Array.isArray(json.peers)) throw new Error('Invalid peers array');

    // Validate peer count (DoS protection)
    if (json.peers.length > MAX_PEERS) {
      throw new Error(`Too many peers (${json.peers.length}, max ${MAX_PEERS})`);
    }

    return json;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Missing trust.json → return empty trust store
      return { ...DEFAULT_TRUST, updatedAt: new Date().toISOString() };
    }
    throw error;
  }
}

// --- Save trust store --------------------------------------------------------
export async function saveTrustStore(store) {
  if (!store || typeof store !== 'object') {
    throw new Error('Trust store must be an object');
  }

  // Check peer count before saving (DoS protection)
  if (store.peers && store.peers.length > MAX_PEERS) {
    throw new Error(`Cannot save: too many peers (${store.peers.length}, max ${MAX_PEERS})`);
  }

  store.updatedAt = new Date().toISOString();
  await fs.writeFile(TRUST_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// --- Add peer to trust store with limit check --------------------------------
export async function addTrustedPeer(peer) {
  const store = await loadTrustStore();

  if (!peer || !peer.id || !peer.pubkey) {
    throw new Error('Peer must contain id and pubkey');
  }

  // Avoid duplicates
  if (store.peers.some(p => p.id === peer.id)) {
    return store; // already trusted
  }

  // Check max peers limit (DoS protection)
  if (store.peers.length >= MAX_PEERS) {
    throw new Error(`Maximum peer limit reached (${MAX_PEERS})`);
  }

  store.peers.push({
    id: peer.id,
    pubkey: peer.pubkey,
    addedAt: new Date().toISOString()
  });

  await saveTrustStore(store);
  return store;
}

// --- Remove peer -------------------------------------------------------------
export async function removeTrustedPeer(id) {
  const store = await loadTrustStore();
  store.peers = store.peers.filter(p => p.id !== id);
  await saveTrustStore(store);
  return store;
}

// --- Check if peer is trusted ------------------------------------------------
export async function isTrusted(id) {
  const store = await loadTrustStore();
  return store.peers.some(p => p.id === id);
}