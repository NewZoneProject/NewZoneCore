// Module: Bootstrap Wizard
// Description: Interactive first-time setup for NewZoneCore.
//              Generates master key, seed phrase and deterministic keys.
// File: core/startup/bootstrap.js

import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';

import { generateMnemonic, mnemonicToSeed } from '../crypto/seed.js';
import { deriveMasterKey } from '../crypto/master.js';
import { loadAllKeys } from '../crypto/keys.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const ENV = path.join(ROOT, 'env');
const KEYS = path.join(ENV, 'keys');
const MASTER_KEY_FILE = path.join(ENV, 'master.key');
const SEED_FILE = path.join(ENV, 'seed.txt');
const TRUST_FILE = path.join(ENV, 'trust.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ask(question, { silent = false } = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: silent ? undefined : process.stdout,
    terminal: true
  });

  return new Promise(resolve => {
    if (silent) process.stdout.write(question);
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function ensureEnvStructure() {
  await fs.mkdir(ENV, { recursive: true });
  await fs.mkdir(KEYS, { recursive: true });
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Bootstrap entry
// ---------------------------------------------------------------------------

export async function interactiveBootstrap(report) {
  console.log('\n[bootstrap] NewZoneCore environment is not initialized.');
  console.log('[bootstrap] Choose an option:\n');
  console.log('  1) Generate new seed + keys');
  console.log('  2) Restore from existing seed\n');

  let choice;
  while (choice !== '1' && choice !== '2') {
    choice = await ask('[bootstrap] Enter choice (1 or 2): ');
  }

  await ensureEnvStructure();

  if (choice === '1') {
    await handleGenerateFlow();
  } else {
    await handleRestoreFlow();
  }

  console.log('\n[bootstrap] Environment initialized.');
}

// ---------------------------------------------------------------------------
// Generate new seed + master key + deterministic keys
// ---------------------------------------------------------------------------

async function handleGenerateFlow() {
  console.log('\n[bootstrap] Generating new identity...');

  // --- Password → master.key ----------------------------------------------
  const password = await ask('[bootstrap] Enter password for master key: ');
  if (!password) {
    console.log('[bootstrap] Empty password is not allowed.');
    process.exit(1);
  }

  const masterKey = await deriveMasterKey(password);
  await fs.writeFile(MASTER_KEY_FILE, masterKey);

  // --- Generate BIP-39 seed phrase ----------------------------------------
  const mnemonic = await generateMnemonic();
  await fs.writeFile(SEED_FILE, mnemonic + '\n', 'utf8');

  // --- Deterministic keys --------------------------------------------------
  await loadAllKeys(ENV);

  // --- Trust store ---------------------------------------------------------
  await writeJson(TRUST_FILE, {
    peers: [],
    updatedAt: new Date().toISOString()
  });

  console.log('\n[bootstrap] New identity created.');
  console.log('[bootstrap] IMPORTANT: write down your seed phrase:\n');
  console.log(mnemonic + '\n');
}

// ---------------------------------------------------------------------------
// Restore from existing seed phrase
// ---------------------------------------------------------------------------

async function handleRestoreFlow() {
  console.log('\n[bootstrap] Restoring from existing seed...');

  const mnemonic = await ask('[bootstrap] Enter your seed phrase (12–24 words): ');
  const words = mnemonic.trim().split(/\s+/);

  const validLengths = [12, 15, 18, 21, 24];

  if (!validLengths.includes(words.length)) {
    console.log(`[bootstrap] Invalid seed phrase length (got ${words.length}, expected 12/15/18/21/24).`);
    process.exit(1);
  }

  // --- Password → master.key ----------------------------------------------
  const password = await ask('[bootstrap] Enter password for master key: ');
  if (!password) {
    console.log('[bootstrap] Empty password is not allowed.');
    process.exit(1);
  }

  const masterKey = await deriveMasterKey(password);
  await fs.writeFile(MASTER_KEY_FILE, masterKey);

  // --- Save seed phrase ----------------------------------------------------
  await fs.writeFile(SEED_FILE, mnemonic.trim() + '\n', 'utf8');

  // --- Deterministic keys --------------------------------------------------
  await loadAllKeys(ENV);

  // --- Trust store ---------------------------------------------------------
  await writeJson(TRUST_FILE, {
    peers: [],
    updatedAt: new Date().toISOString()
  });

  console.log('\n[bootstrap] Identity restored from seed.');
  console.log('[bootstrap] Seed phrase stored in env/seed.txt');
}