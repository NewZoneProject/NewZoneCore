// Module: Master Key Manager
// Description: Loads, validates and derives the master key used for all
//              cryptographic operations in NewZoneCore.
// File: core/crypto/master.js

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const ENV = path.join(ROOT, 'env');
const MASTER_FILE = path.join(ENV, 'master.key');

// --- Derive master key from password ----------------------------------------
export function deriveMasterKey(password) {
  // 32-byte key using scrypt
  return crypto.scryptSync(password, 'nzcore-master-salt', 32);
}

// --- Load master key from disk ----------------------------------------------
export async function loadMasterKey() {
  try {
    const data = await fs.readFile(MASTER_FILE);
    if (data.length !== 32) {
      throw new Error('Invalid master.key length');
    }
    return data;
  } catch {
    return null; // bootstrap will handle missing key
  }
}

// --- Save master key --------------------------------------------------------
export async function saveMasterKey(keyBytes) {
  if (!(keyBytes instanceof Uint8Array) || keyBytes.length !== 32) {
    throw new Error('Master key must be a 32-byte Uint8Array');
  }
  await fs.writeFile(MASTER_FILE, keyBytes);
}

// --- Verify password against stored master key ------------------------------
export async function verifyPassword(password) {
  const stored = await loadMasterKey();
  if (!stored) return false;

  const derived = deriveMasterKey(password);
  return crypto.timingSafeEqual(stored, derived);
}

// --- Initialize master key (used by core.js) --------------------------------
export async function initMasterKey() {
  const key = await loadMasterKey();
  if (key) {
    return key;
  }

  // No master.key — return placeholder for dev mode
  // (bootstrap will create a real one)
  return crypto.randomBytes(32);
}