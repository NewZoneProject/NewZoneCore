// Module: Node Key Generator
// Description: Auto-generate Ed25519 seed + public key + node_id on first launch.
// File: core/crypto/node-keys.js

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ed25519GetPublicKey } from '../libs/ed25519.js';

export async function generateNodeKeysIfMissing(baseDir) {
  const keysDir = path.join(baseDir, 'keys');
  const keyFile = path.join(keysDir, 'node.json');

  // Try to load existing keys
  try {
    const raw = await fs.readFile(keyFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    // Missing or corrupted — regenerate
  }

  // Ensure keys/ directory exists
  try {
    await fs.mkdir(keysDir, { recursive: true });
  } catch {}

  // Generate 32-byte Ed25519 seed
  const seed = crypto.randomBytes(32);
  const pub = ed25519GetPublicKey(seed);

  // Generate node_id (serviceName.randomHex)
  const serviceName = path.basename(baseDir);
  const node_id = `${serviceName}.${crypto.randomBytes(4).toString('hex')}`;

  const nodeKeys = {
    node_id,
    ed25519_seed: Buffer.from(seed).toString('base64'),
    ed25519_public: Buffer.from(pub).toString('base64')
  };

  await fs.writeFile(keyFile, JSON.stringify(nodeKeys, null, 2));

  return nodeKeys;
}