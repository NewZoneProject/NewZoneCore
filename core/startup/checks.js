// Module: Startup Checks
// Description: Validation of env/ structure, master key, seed phrase,
//              trust store and deterministic key files.
// File: core/startup/checks.js

import fs from 'fs/promises';
import path from 'path';

// Resolve project root relative to this file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../');
const ENV = path.join(ROOT, 'env');
const KEYS = path.join(ENV, 'keys');

// Helper: check file exists and is non-empty
async function existsNonEmpty(file) {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

// Helper: check valid JSON
async function loadJson(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function runStartupChecks() {
  const report = {
    envExists: false,
    keysDirExists: false,

    masterKeyExists: false,
    masterKeyValid: false,

    seedExists: false,
    seedValid: false,

    trustExists: false,
    trustValid: false,

    keyFiles: {
      identity: false,
      ecdh: false
    },

    keyFilesValid: {
      identity: false,
      ecdh: false
    },

    ok: false,
    errors: []
  };

  // --- env/ directory -------------------------------------------------------
  try {
    const stat = await fs.stat(ENV);
    if (stat.isDirectory()) report.envExists = true;
  } catch {}

  if (!report.envExists) {
    report.errors.push('env/ directory missing');
    return report;
  }

  // --- env/keys/ directory --------------------------------------------------
  try {
    const stat = await fs.stat(KEYS);
    if (stat.isDirectory()) report.keysDirExists = true;
  } catch {
    report.errors.push('env/keys/ directory missing');
  }

  // --- master.key -----------------------------------------------------------
  const masterKeyFile = path.join(ENV, 'master.key');
  if (await existsNonEmpty(masterKeyFile)) {
    report.masterKeyExists = true;

    try {
      const buf = await fs.readFile(masterKeyFile);
      if (buf.length === 32) {
        report.masterKeyValid = true;
      } else {
        report.errors.push('master.key must be exactly 32 bytes');
      }
    } catch {
      report.errors.push('master.key unreadable');
    }
  } else {
    report.errors.push('master.key missing or empty');
  }

  // --- seed.txt -------------------------------------------------------------
  const seedFile = path.join(ENV, 'seed.txt');
  if (await existsNonEmpty(seedFile)) {
    report.seedExists = true;

    const seed = (await fs.readFile(seedFile, 'utf8')).trim();
    const words = seed.split(/\s+/);

    // Accept all valid BIP-39 lengths
    const validLengths = [12, 15, 18, 21, 24];

    if (validLengths.includes(words.length)) {
      report.seedValid = true;
    } else {
      report.errors.push(
        `seed.txt must contain 12/15/18/21/24 words (got ${words.length})`
      );
    }
  } else {
    report.errors.push('seed.txt missing or empty');
  }

  // --- trust.json -----------------------------------------------------------
  const trustFile = path.join(ENV, 'trust.json');
  if (await existsNonEmpty(trustFile)) {
    report.trustExists = true;

    const trust = await loadJson(trustFile);
    if (trust && typeof trust === 'object' && Array.isArray(trust.peers)) {
      report.trustValid = true;
    } else {
      report.errors.push('trust.json exists but is invalid or missing "peers" array');
    }
  } else {
    report.errors.push('trust.json missing or empty');
  }

  // --- deterministic key files ---------------------------------------------
  const keyNames = ['identity', 'ecdh'];

  for (const name of keyNames) {
    const file = path.join(KEYS, `${name}.json`);

    if (await existsNonEmpty(file)) {
      report.keyFiles[name] = true;

      const json = await loadJson(file);
      if (json && typeof json === 'object') {
        // minimal validation
        if (json.public && typeof json.public === 'string') {
          report.keyFilesValid[name] = true;
        } else {
          report.errors.push(`${name}.json missing required "public" field`);
        }
      } else {
        report.errors.push(`${name}.json exists but is invalid JSON`);
      }
    } else {
      report.errors.push(`${name}.json missing or empty`);
    }
  }

  // --- Final OK flag --------------------------------------------------------
  report.ok =
    report.envExists &&
    report.keysDirExists &&
    report.masterKeyExists &&
    report.masterKeyValid &&
    report.seedExists &&
    report.seedValid &&
    report.trustExists &&
    report.trustValid &&
    Object.values(report.keyFiles).every(Boolean) &&
    Object.values(report.keyFilesValid).every(Boolean);

  return report;
}