// Module: Key Management
// Description: Deterministic generation and loading of persistent keys
//              based on seed phrase + master key.
// File: core/crypto/keys.js

import fs from 'fs/promises';
import path from 'path';
import { mnemonicToSeed } from './seed.js';
import { deriveSubKey } from './derive.js';
import { getPublicKey } from './sign.js';
import { generateKeyPair } from './box.js';

// --- Helpers ---------------------------------------------------------------

async function ensureDir(dir) {
  try { await fs.mkdir(dir, { recursive: true }); } catch {}
}

async function loadJson(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

// --- Deterministic Ed25519 identity ---------------------------------------

function deriveIdentityKey(seedBytes) {
  const identitySeed = deriveSubKey(seedBytes, 'identity', 32);
  const pub = getPublicKey(identitySeed);

  return {
    private: Buffer.from(identitySeed).toString('base64'),
    public: Buffer.from(pub).toString('base64')
  };
}

// --- Deterministic X25519 ECDH key ----------------------------------------

function deriveECDHKey(seedBytes) {
  const ecdhSeed = deriveSubKey(seedBytes, 'ecdh', 32);
  const { publicKey, privateKey } = generateKeyPair(ecdhSeed);

  return {
    private: Buffer.from(privateKey).toString('base64'),
    public: Buffer.from(publicKey).toString('base64')
  };
}

// --- Load or derive all keys ----------------------------------------------

export async function loadAllKeys(envPath) {
  const keysDir = path.join(envPath, 'keys');
  await ensureDir(keysDir);

  const seedPhrase = (await fs.readFile(path.join(envPath, 'seed.txt'), 'utf8')).trim();
  const seedBytes = await mnemonicToSeed(seedPhrase);

  const identityFile = path.join(keysDir, 'identity.json');
  const ecdhFile = path.join(keysDir, 'ecdh.json');

  let identity = await loadJson(identityFile);
  let ecdh = await loadJson(ecdhFile);

  if (!identity) {
    identity = deriveIdentityKey(seedBytes);
    await saveJson(identityFile, identity);
  }

  if (!ecdh) {
    ecdh = deriveECDHKey(seedBytes);
    await saveJson(ecdhFile, ecdh);
  }

  return { identity, ecdh };
}