# NewZoneCore Environment Specification

## 1. Scope

This document specifies the on‑disk environment layout for NewZoneCore:

- directory structure
- file formats
- lifecycle (bootstrap, reset, recovery)
- test environment

The environment is the single source of truth for node identity and trust.

---

## 2. Directory Layout

### 2.1 Production Environment

Root: `env/`

Required entries:

- `env/master.key`
- `env/seed.txt`
- `env/trust.json`
- `env/keys/identity.json`
- `env/keys/ecdh.json`

### 2.2 Test Environment

Root: `env_test/`

- Mirrors the structure of `env/` but is used only by tests.
- MUST NOT be used by the running daemon.

---

## 3. Files

### 3.1 `env/master.key`

- Type: binary file
- Size: exactly 32 bytes
- Content: master key used for cryptographic operations.
- Source:
  - derived from password via `deriveMasterKey(password)`
  - or derived from mnemonic via `mnemonicToMasterKey(mnemonic)` in tests

Validation:

- `runStartupChecks()` MUST verify length is 32 bytes.
- Invalid length MUST be treated as an error.

---

### 3.2 `env/seed.txt`

- Type: UTF‑8 text file
- Content: BIP‑39 mnemonic (12, 15, 18, 21, or 24 words).
- Trailing newline is allowed.

Usage:

- Input to `mnemonicToSeed()` → 32‑byte seed.
- Used to deterministically derive identity and ECDH keys.

Validation:

- `runStartupChecks()` MUST:
  - ensure file is non‑empty
  - split by whitespace
  - verify word count is one of the allowed lengths

---

### 3.3 `env/trust.json`

- Type: UTF‑8 JSON file
- Structure:

```json
{
  "peers": [
    {
      "id": "string",
      "pubkey": "base64",
      "addedAt": "ISO-8601 string"
    }
  ],
  "updatedAt": "ISO-8601 string or null"
}
```

Behavior:

- Missing or invalid file:
  - `loadTrustStore()` MUST return a default store:
    - `peers: []`
    - `updatedAt: now`

- `saveTrustStore()` MUST:
  - update `updatedAt` to current time
  - write formatted JSON

Validation:

- `runStartupChecks()` MUST:
  - ensure file is non‑empty
  - parse JSON
  - verify `peers` is an array

---

### 3.4 `env/keys/identity.json`

- Type: UTF‑8 JSON file
- Structure:

```json
{
  "private": "base64-encoded 32-byte Ed25519 seed",
  "public": "base64-encoded 32-byte Ed25519 public key"
}
```

Behavior:

- If missing:
  - `loadAllKeys(envPath)` MUST derive and create it deterministically from `seed.txt`.

Validation:

- `runStartupChecks()` MUST:
  - ensure file is non‑empty
  - parse JSON
  - verify `public` exists and is a string

---

### 3.5 `env/keys/ecdh.json`

- Type: UTF‑8 JSON file
- Structure:

```json
{
  "private": "base64-encoded 32-byte X25519 private key",
  "public": "base64-encoded 32-byte X25519 public key"
}
```

Behavior:

- If missing:
  - `loadAllKeys(envPath)` MUST derive and create it deterministically from `seed.txt`.

Validation:

- `runStartupChecks()` MUST:
  - ensure file is non‑empty
  - parse JSON
  - verify `public` exists and is a string

---

## 4. Startup Checks

File: `core/startup/checks.js`

`runStartupChecks()` MUST produce a report with:

- `envExists: boolean`
- `keysDirExists: boolean`
- `masterKeyExists: boolean`
- `masterKeyValid: boolean`
- `seedExists: boolean`
- `seedValid: boolean`
- `trustExists: boolean`
- `trustValid: boolean`
- `keyFiles: { identity: boolean, ecdh: boolean }`
- `keyFilesValid: { identity: boolean, ecdh: boolean }`
- `ok: boolean`
- `errors: string[]`

`ok` MUST be `true` only if:

- `env/` exists
- `env/keys/` exists
- `master.key` exists and is valid
- `seed.txt` exists and is valid
- `trust.json` exists and is valid
- `identity.json` and `ecdh.json` exist and are valid

---

## 5. Bootstrap and Recovery

### 5.1 Bootstrap

File: `core/startup/bootstrap.js`

`interactiveBootstrap(report)` MUST:

1. Prompt user to either:
   - generate new seed and keys, or
   - restore from existing seed.

2. Ensure `env/` and `env/keys/` exist.

3. For **generate** flow:
   - ask for password
   - derive and save `master.key`
   - generate mnemonic and save to `seed.txt`
   - call `loadAllKeys(ENV)` to create deterministic keys
   - create `trust.json` with empty peers

4. For **restore** flow:
   - ask for existing mnemonic
   - validate word count
   - ask for password
   - derive and save `master.key`
   - save mnemonic to `seed.txt`
   - call `loadAllKeys(ENV)`
   - create `trust.json` with empty peers

Bootstrap MUST NOT proceed with empty password or invalid mnemonic length.

---

### 5.2 Recovery

File: `core/startup/recovery.js`

- `resetEnvironment()` MUST:
  - remove `env/` recursively
  - recreate `env/keys/` directory

- `fullRecovery()` MUST:
  - prompt for seed phrase
  - call `resetEnvironment()`
  - reconstruct `master.key`, `seed.txt`, `trust.json`, and key files
  - (current implementation is a placeholder and will be aligned with deterministic derivation in future phases)

---

## 6. Test Environment

Files: `tests/*.test.js`

- `crypto.test.js` MUST:
  - use `env_test/` as temporary environment
  - verify deterministic key generation from `seed.txt`

- `seed-restore.test.js` MUST:
  - use `env/`
  - verify that master key derived from mnemonic is stable across save/delete/restore cycles

Tests MUST NOT modify production data outside `env/` and `env_test/`.

---

## 7. Portability Requirements

- Paths MUST be resolved using `path` and `fileURLToPath` where needed.
- No hard‑coded absolute paths inside the core.
- `env/` MUST be relative to project root, not to platform‑specific locations.

The environment MUST remain portable across devices and operating systems.

