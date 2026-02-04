// Module: Seed & Mnemonic Utilities
// Description: BIP-39 mnemonic → entropy → seed → seed-master-key.
// File: core/crypto/seed.js

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { blake2b } from '../libs/blake2b.js';
import { deriveSeedMasterKey } from './derive.js';

// ---------------------------------------------------------------------------
// Resolve directory of this file (portable on Android, Termux, Linux, Windows)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Wordlist loader (cached)
// ---------------------------------------------------------------------------

let WORDLIST = null;

async function loadWordlist() {
  if (WORDLIST) return WORDLIST;

  // Correct, portable path to core/libs/bip-39-english.txt
  const file = path.join(__dirname, '../libs/bip-39-english.txt');
  const raw = await fs.readFile(file, 'utf8');

  WORDLIST = raw.split(/\r?\n/).map(w => w.trim()).filter(Boolean);

  if (WORDLIST.length !== 2048) {
    throw new Error('seed: invalid BIP-39 wordlist (expected 2048 words)');
  }

  return WORDLIST;
}

// ---------------------------------------------------------------------------
// entropy → mnemonic
// ---------------------------------------------------------------------------

export async function entropyToMnemonic(entropy) {
  const e = entropy instanceof Uint8Array ? entropy : new Uint8Array(entropy);
  const bits = e.length * 8;

  if (![128, 160, 192, 224, 256].includes(bits)) {
    throw new Error('seed: entropy must be 128–256 bits');
  }

  const wordlist = await loadWordlist();

  // SHA-256 checksum
  const hash = crypto.createHash('sha256').update(e).digest();
  const checksumBits = bits / 32;

  // Build bitstring
  let bitstr = '';
  for (const b of e) bitstr += b.toString(2).padStart(8, '0');
  bitstr += hash[0].toString(2).padStart(8, '0').slice(0, checksumBits);

  // Split into 11-bit words
  const words = [];
  for (let i = 0; i < bitstr.length; i += 11) {
    const idx = parseInt(bitstr.slice(i, i + 11), 2);
    words.push(wordlist[idx]);
  }

  return words.join(' ');
}

// ---------------------------------------------------------------------------
// mnemonic → entropy
// ---------------------------------------------------------------------------

export async function mnemonicToEntropy(mnemonic) {
  const wordlist = await loadWordlist();
  const words = mnemonic.trim().split(/\s+/);

  if (words.length % 3 !== 0) {
    throw new Error('seed: invalid mnemonic length');
  }

  const bits = words.length * 11;
  const divider = Math.floor(bits * 32 / 33); // entropy bits
  const checksumBits = bits - divider;

  let bitstr = '';
  for (const w of words) {
    const idx = wordlist.indexOf(w);
    if (idx < 0) throw new Error(`seed: invalid mnemonic word "${w}"`);
    bitstr += idx.toString(2).padStart(11, '0');
  }

  const entropyBits = bitstr.slice(0, divider);
  const checksumBitsActual = bitstr.slice(divider);

  const entropy = new Uint8Array(divider / 8);
  for (let i = 0; i < entropy.length; i++) {
    entropy[i] = parseInt(entropyBits.slice(i * 8, i * 8 + 8), 2);
  }

  // Validate checksum
  const hash = crypto.createHash('sha256').update(entropy).digest();
  const expected = hash[0].toString(2).padStart(8, '0').slice(0, checksumBits);

  if (expected !== checksumBitsActual) {
    throw new Error('seed: checksum mismatch');
  }

  return entropy;
}

// ---------------------------------------------------------------------------
// mnemonic → 32-byte seed (NewZoneCore variant)
// ---------------------------------------------------------------------------

export async function mnemonicToSeed(mnemonic) {
  const entropy = await mnemonicToEntropy(mnemonic);
  return blake2b(entropy, 32); // BLAKE2b-256(entropy)
}

// ---------------------------------------------------------------------------
// Generate new mnemonic (128-bit entropy)
// ---------------------------------------------------------------------------

export async function generateMnemonic() {
  const entropy = crypto.randomBytes(32); // 256 bits → 24 words
  return entropyToMnemonic(entropy);
}

// ---------------------------------------------------------------------------
// mnemonic → seed-master-key (deterministic)
// ---------------------------------------------------------------------------

export async function mnemonicToMasterKey(mnemonic) {
  const seed = await mnemonicToSeed(mnemonic);
  return deriveSeedMasterKey(seed);
}