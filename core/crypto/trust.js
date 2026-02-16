// Module: Trust Store Manager
// Description: Loads, validates and updates the trust store used for
//              cryptographic routing and node identity verification.
// File: core/crypto/trust.js

import fs from 'fs/promises';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const ENV = path.join(ROOT, 'env');
const TRUST_FILE = path.join(ENV, 'trust.json');

// --- Default trust store structure ------------------------------------------
const DEFAULT_TRUST = {
  peers: [],            // array of { id, pubkey, addedAt }
  updatedAt: null
};

// --- Load trust store --------------------------------------------------------
export async function loadTrustStore() {
  try {
    const raw = await fs.readFile(TRUST_FILE, 'utf8');
    const json = JSON.parse(raw);

    // Validate structure
    if (!json || typeof json !== 'object') throw new Error('Invalid trust.json');
    if (!Array.isArray(json.peers)) throw new Error('Invalid peers array');

    return json;
  } catch {
    // Missing or invalid trust.json → return empty trust store
    return { ...DEFAULT_TRUST, updatedAt: new Date().toISOString() };
  }
}

// --- Save trust store --------------------------------------------------------
export async function saveTrustStore(store) {
  if (!store || typeof store !== 'object') {
    throw new Error('Trust store must be an object');
  }

  store.updatedAt = new Date().toISOString();
  await fs.writeFile(TRUST_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// --- Add peer to trust store -------------------------------------------------
export async function addTrustedPeer(peer) {
  const store = await loadTrustStore();

  if (!peer || !peer.id || !peer.pubkey) {
    throw new Error('Peer must contain id and pubkey');
  }

  // Avoid duplicates
  if (store.peers.some(p => p.id === peer.id)) {
    return store; // already trusted
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