// Module: Seed Restore Test
// Description: Verifies that master key restored from mnemonic matches
//              the original master key derived from the same mnemonic.
// Run: node --test tests/seed-restore.test.js
// File: tests/seed-restore.test.js

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateMnemonic, mnemonicToMasterKey } from "../core/crypto/seed.js";
import { saveMasterKey, loadMasterKey } from "../core/crypto/master.js";

// ---------------------------------------------------------------------------
// Resolve project root (portable on Android/Termux/Linux/Windows)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const ENV = path.join(ROOT, "env");
const MASTER_FILE = path.join(ENV, "master.key");

// ---------------------------------------------------------------------------
// Test: mnemonic → master key → save → delete → restore → compare
// ---------------------------------------------------------------------------

test("seed restore: restored master key must match original", async () => {
  // Ensure env/ directory exists
  await fs.mkdir(ENV, { recursive: true });

  // 1. Generate mnemonic
  const mnemonic = await generateMnemonic();

  // 2. Derive master key from mnemonic (original)
  const master1 = await mnemonicToMasterKey(mnemonic);

  // 3. Save master key to disk
  await saveMasterKey(master1);

  // 4. Load stored key (sanity check)
  const stored1 = await loadMasterKey();
  assert.ok(stored1, "master.key must exist after save");
  assert.equal(
    Buffer.from(stored1).toString("hex"),
    Buffer.from(master1).toString("hex"),
    "stored master key must match derived master key"
  );

  // 5. Delete master.key to simulate fresh start
  await fs.unlink(MASTER_FILE);

  // 6. Restore master key from mnemonic
  const master2 = await mnemonicToMasterKey(mnemonic);

  // 7. Save restored key
  await saveMasterKey(master2);

  // 8. Load stored key again
  const stored2 = await loadMasterKey();
  assert.ok(stored2, "master.key must exist after restore");

  // 9. Compare original vs restored
  assert.equal(
    Buffer.from(master1).toString("hex"),
    Buffer.from(master2).toString("hex"),
    "restored master key must match original master key"
  );

  // 10. Compare stored1 vs stored2
  assert.equal(
    Buffer.from(stored1).toString("hex"),
    Buffer.from(stored2).toString("hex"),
    "stored master keys must match before and after restore"
  );
});