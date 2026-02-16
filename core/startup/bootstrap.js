// Module: Bootstrap Wizard
// Description: Interactive first-time setup for NewZoneCore.
//              Generates master key, seed phrase and deterministic keys.
//              Now with secure seed storage (encrypted).
// File: core/startup/bootstrap.js

import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import crypto from 'crypto';

import { generateMnemonic, mnemonicToSeed } from '../crypto/seed.js';
import { deriveMasterKey, saveMasterKey, saveSalt, generateSalt, wipeKey } from '../crypto/master.js';
import { loadAllKeys } from '../crypto/keys.js';
import { 
  saveEncryptedSeed, 
  loadEncryptedSeed, 
  migrateToEncryptedSeed,
  hasEncryptedSeed 
} from '../crypto/seed-protector.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const ENV = path.join(ROOT, 'env');
const KEYS = path.join(ENV, 'keys');
const MASTER_KEY_FILE = path.join(ENV, 'master.key');
const SALT_FILE = path.join(ENV, 'master.salt');
const SEED_FILE = path.join(ENV, 'seed.txt');
const SEED_ENCRYPTED_FILE = path.join(ENV, 'seed.enc');
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

async function askPassword(prompt = 'Enter password: ') {
  // Try to hide password input
  let password = '';
  
  if (process.stdin.isTTY) {
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    
    password = await new Promise(resolve => {
      let input = '';
      process.stdin.on('data', (char) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(input);
        } else if (char === '\u0003') {
          process.exit();
        } else if (char === '\u007F' || char === '\b') {
          input = input.slice(0, -1);
        } else {
          input += char;
        }
      });
    });
  } else {
    password = await ask(prompt);
  }
  
  return password;
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

  // --- Password with confirmation -------------------------------------------
  const password = await askPassword('[bootstrap] Enter password for master key: ');
  
  if (!password || password.length < 8) {
    console.log('[bootstrap] Password must be at least 8 characters.');
    process.exit(1);
  }
  
  const confirmPassword = await askPassword('[bootstrap] Confirm password: ');
  
  if (password !== confirmPassword) {
    console.log('[bootstrap] Passwords do not match.');
    process.exit(1);
  }

  // --- Generate unique salt for this user -----------------------------------
  const salt = generateSalt();
  await saveSalt(salt);
  console.log('[bootstrap] Generated unique encryption salt');

  // --- Derive master key with unique salt ------------------------------------
  const { key: masterKey } = await deriveMasterKey(password, salt);
  await saveMasterKey(masterKey);
  
  // Wipe password from memory (best effort)
  // Note: strings are immutable in JS, this is best-effort
  console.log('[bootstrap] Master key derived with unique salt');

  // --- Generate BIP-39 seed phrase ------------------------------------------
  const mnemonic = await generateMnemonic();
  
  // --- Save ENCRYPTED seed phrase -------------------------------------------
  // CRITICAL FIX: Seed is now encrypted before storage
  await saveEncryptedSeed(SEED_ENCRYPTED_FILE, mnemonic, masterKey);
  
  // Wipe master key from memory
  wipeKey(masterKey);

  // --- Deterministic keys ---------------------------------------------------
  await loadAllKeys(ENV);

  // --- Trust store ----------------------------------------------------------
  await writeJson(TRUST_FILE, {
    peers: [],
    delegations: [],
    updatedAt: new Date().toISOString()
  });

  console.log('\n[bootstrap] New identity created securely.');
  console.log('[bootstrap] ================================================');
  console.log('[bootstrap] IMPORTANT: Write down your seed phrase!');
  console.log('[bootstrap] This is the ONLY time it will be shown.');
  console.log('[bootstrap] ================================================\n');
  console.log(mnemonic + '\n');
  console.log('[bootstrap] Seed phrase has been encrypted and stored.');
  console.log('[bootstrap] You will need your password to decrypt it.\n');
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

  // Validate seed phrase checksum
  try {
    const { mnemonicToEntropy } = await import('../crypto/seed.js');
    await mnemonicToEntropy(mnemonic.trim());
    console.log('[bootstrap] Seed phrase validated successfully.');
  } catch (error) {
    console.log(`[bootstrap] Invalid seed phrase: ${error.message}`);
    process.exit(1);
  }

  // --- Password with confirmation -------------------------------------------
  const password = await askPassword('[bootstrap] Enter password for master key: ');
  
  if (!password || password.length < 8) {
    console.log('[bootstrap] Password must be at least 8 characters.');
    process.exit(1);
  }
  
  const confirmPassword = await askPassword('[bootstrap] Confirm password: ');
  
  if (password !== confirmPassword) {
    console.log('[bootstrap] Passwords do not match.');
    process.exit(1);
  }

  // --- Generate unique salt for this user -----------------------------------
  const salt = generateSalt();
  await saveSalt(salt);
  console.log('[bootstrap] Generated unique encryption salt');

  // --- Derive master key with unique salt ------------------------------------
  const { key: masterKey } = await deriveMasterKey(password, salt);
  await saveMasterKey(masterKey);
  console.log('[bootstrap] Master key derived with unique salt');

  // --- Save ENCRYPTED seed phrase -------------------------------------------
  await saveEncryptedSeed(SEED_ENCRYPTED_FILE, mnemonic.trim(), masterKey);
  
  // Wipe master key from memory
  wipeKey(masterKey);

  // --- Deterministic keys ---------------------------------------------------
  await loadAllKeys(ENV);

  // --- Trust store ----------------------------------------------------------
  await writeJson(TRUST_FILE, {
    peers: [],
    delegations: [],
    updatedAt: new Date().toISOString()
  });

  console.log('\n[bootstrap] Identity restored from seed.');
  console.log('[bootstrap] Seed phrase has been encrypted and stored.');
}

// ---------------------------------------------------------------------------
// Migration from old format (plaintext seed)
// ---------------------------------------------------------------------------

export async function checkAndMigrateSeed(masterKey) {
  // Check if plaintext seed exists
  let plaintextExists = false;
  try {
    await fs.access(SEED_FILE);
    plaintextExists = true;
  } catch {}
  
  // Check if encrypted seed already exists
  let encryptedExists = await hasEncryptedSeed(SEED_ENCRYPTED_FILE);
  
  if (plaintextExists && !encryptedExists) {
    console.log('[bootstrap] Migrating plaintext seed to encrypted format...');
    
    const { key } = await deriveMasterKey('', await fs.readFile(SALT_FILE)); // Dummy - need actual password
    
    // Migration will be handled when user provides password
    return { needsMigration: true, plaintextExists };
  }
  
  return { needsMigration: false, plaintextExists, encryptedExists };
}

/**
 * Migrate plaintext seed to encrypted format.
 * Should be called after user authentication.
 */
export async function migratePlaintextSeed(password) {
  // Load salt
  let salt;
  try {
    salt = await fs.readFile(SALT_FILE);
  } catch {
    console.log('[bootstrap] No salt file found for migration');
    return false;
  }
  
  // Derive master key
  const { key: masterKey } = await deriveMasterKey(password, salt);
  
  // Perform migration
  const migrated = await migrateToEncryptedSeed(SEED_FILE, SEED_ENCRYPTED_FILE, masterKey);
  
  // Wipe master key
  wipeKey(masterKey);
  
  if (migrated) {
    console.log('[bootstrap] ✓ Plaintext seed migrated and deleted');
  }
  
  return migrated;
}

// ---------------------------------------------------------------------------
// Load seed (decrypt if encrypted, fallback to plaintext for migration)
// ---------------------------------------------------------------------------

export async function loadSeed(masterKey) {
  // Try encrypted seed first
  if (await hasEncryptedSeed(SEED_ENCRYPTED_FILE)) {
    return loadEncryptedSeed(SEED_ENCRYPTED_FILE, masterKey);
  }
  
  // Fallback to plaintext (for migration path)
  try {
    const plaintext = await fs.readFile(SEED_FILE, 'utf8');
    console.log('[bootstrap] WARNING: Using plaintext seed. Run migration to encrypt.');
    return plaintext.trim();
  } catch {
    return null;
  }
}
