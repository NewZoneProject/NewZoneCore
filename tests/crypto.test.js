// Module: Crypto Test Suite
// Description: Automated tests for BIP-39, entropy, seed derivation,
//              and deterministic key generation in NewZoneCore.
// Run: node --test tests/crypto.test.js
// File: tests/crypto.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';

import { generateMnemonic, entropyToMnemonic, mnemonicToEntropy, mnemonicToSeed } from '../core/crypto/seed.js';
import { loadAllKeys } from '../core/crypto/keys.js';

// Temporary test environment
const TMP = path.join(process.cwd(), 'env_test');

// Clean test env before each run
async function resetEnv() {
  await fs.rm(TMP, { recursive: true, force: true });
  await fs.mkdir(path.join(TMP, 'keys'), { recursive: true });
}

test('BIP-39: generate 24-word mnemonic', async () => {
  const m = await generateMnemonic();
  const words = m.trim().split(/\s+/);

  assert.equal(words.length, 24, 'mnemonic must contain 24 words');
});

test('BIP-39: mnemonic → entropy → mnemonic (round-trip)', async () => {
  const m1 = await generateMnemonic();
  const entropy = await mnemonicToEntropy(m1);
  const m2 = await entropyToMnemonic(entropy);

  assert.equal(m1, m2, 'mnemonic must be stable after round-trip');
});

test('Seed: mnemonic → 32-byte seed', async () => {
  const m = await generateMnemonic();
  const seed = await mnemonicToSeed(m);

  assert.equal(seed.length, 32, 'seed must be 32 bytes');
});

test('Deterministic keys: identity/ecdh must be stable', async () => {
  await resetEnv();

  const m = await generateMnemonic();
  await fs.writeFile(path.join(TMP, 'seed.txt'), m);

  const keys1 = await loadAllKeys(TMP);
  const keys2 = await loadAllKeys(TMP);

  assert.equal(
    keys1.identity.public,
    keys2.identity.public,
    'identity public key must be deterministic'
  );

  assert.equal(
    keys1.ecdh.public,
    keys2.ecdh.public,
    'ecdh public key must be deterministic'
  );

  assert.ok(keys1.identity.private, 'identity private key must exist');
  assert.ok(keys1.ecdh.private, 'ecdh private key must exist');
});