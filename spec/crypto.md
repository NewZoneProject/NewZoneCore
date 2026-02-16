# NewZoneCore Crypto Specification

## 1. Scope

This document specifies the cryptographic primitives and constructions used by NewZoneCore:

- hashing and MAC
- key derivation
- signatures
- key agreement
- AEAD
- seed and mnemonic handling
- packet and routing crypto
- trust store model

---

## 2. Primitives

### 2.1 Hash Functions

- **BLAKE2b‑512**
  - Implementation: `core/libs/blake2b.js` via `node:crypto` `"blake2b512"`.
  - Output truncated to requested length (1–64 bytes).

- **SHA‑256 / SHA‑512**
  - Implementation: `node:crypto` hash functions.
  - Used for BIP‑39 checksum and internal utilities.

### 2.2 HKDF

File: `core/libs/hkdf.js`

- Supported PRFs:
  - `sha512` (HMAC‑SHA‑512)
  - `blake2b` (HMAC‑BLAKE2b with 128‑byte block size)
- Functions:
  - `hkdfExtract(hash, salt, ikm) → prk`
  - `hkdfExpand(hash, prk, info, length) → okm`
  - `hkdf(hash, salt, ikm, info, length) → okm`

NewZoneCore uses `blake2b` as the default PRF.

---

## 3. Key Derivation

File: `core/crypto/derive.js`

### 3.1 Seed Master Key

- `deriveSeedMasterKey(seed)`
  - Input: arbitrary seed bytes
  - Output: 32‑byte master key
  - Construction: `BLAKE2b‑256(seed)`

### 3.2 Subkeys

- `deriveSubKey(masterKey, context, length, salt?)`
  - HKDF with `blake2b` PRF
  - `info = context`
  - `salt` optional
  - Output length: `length` bytes

- `deriveNamedKey(masterKey, label)`
  - `context = "nzcore:key:" + label`
  - Output: 32‑byte key

- `deriveNonceBase(masterKey, label)`
  - `context = "nzcore:nonce:" + label`
  - Output: 12‑byte nonce base

- `deriveSessionKeys(masterKey, sessionId)`
  - `context = "nzcore:session:" + sessionId + 0x01` → send
  - `context = "nzcore:session:" + sessionId + 0x02` → recv
  - Output: `{ send: 32 bytes, recv: 32 bytes }`

---

## 4. Signatures (Ed25519)

Files: `core/libs/ed25519.js`, `core/crypto/sign.js`

### 4.1 Key Material

- Private seed: 32 bytes
- Public key: 32 bytes
- Signature: 64 bytes

### 4.2 Operations

- `getPublicKey(seed)`
  - Derives Ed25519 public key from 32‑byte seed.

- `sign(message, seed)`
  - Signs arbitrary message bytes with 32‑byte seed.
  - Returns 64‑byte signature.

- `verify(message, signature, publicKey)`
  - Verifies signature against 32‑byte public key.
  - Returns boolean.

Ed25519ctx and Ed25519ph variants are available internally but not required by the core API.

---

## 5. Key Agreement (X25519)

File: `core/libs/x25519.js`

- Curve: Curve25519 in Montgomery form.
- Scalar: 32 bytes, clamped per RFC 7748.
- u‑coordinate: 32 bytes, masked per RFC 7748.

Operations:

- `x25519(scalar, u) → sharedSecret (32 bytes)`
- `x25519Base(scalar) → publicKey (32 bytes)`

Used by:

- `core/crypto/box.js`
- `core/crypto/handshake.js`
- `core/crypto/channel.js`

---

## 6. AEAD (ChaCha20‑Poly1305)

File: `core/libs/chacha20poly1305.js`

- Cipher: `chacha20-poly1305` (IETF, 12‑byte nonce).
- Tag length: 16 bytes.

Operations:

- `encrypt(key, nonce, plaintext, aad?) → { ciphertext, tag }`
- `decrypt(key, nonce, ciphertext, tag, aad?) → plaintext | null`

Constraints:

- `key`: 32 bytes
- `nonce`: 12 bytes
- `tag`: 16 bytes

---

## 7. Seed & Mnemonic (BIP‑39 Variant)

File: `core/crypto/seed.js`

### 7.1 Wordlist

- File: `core/libs/bip-39-english.txt`
- MUST contain exactly 2048 words.

### 7.2 Conversions

- `entropyToMnemonic(entropy)`
  - Entropy length: 128, 160, 192, 224, or 256 bits.
  - Uses SHA‑256 checksum per BIP‑39.
  - Returns space‑separated mnemonic.

- `mnemonicToEntropy(mnemonic)`
  - Validates wordlist and checksum.
  - Returns entropy bytes.

- `mnemonicToSeed(mnemonic)`
  - `seed = BLAKE2b‑256(entropy)`
  - Returns 32‑byte seed.

- `generateMnemonic()`
  - Generates 256‑bit entropy.
  - Returns 24‑word mnemonic.

- `mnemonicToMasterKey(mnemonic)`
  - `seed = mnemonicToSeed(mnemonic)`
  - `masterKey = deriveSeedMasterKey(seed)`
  - Returns 32‑byte master key.

---

## 8. Persistent Keys

File: `core/crypto/keys.js`

### 8.1 Deterministic Identity

- Input: `seedBytes = mnemonicToSeed(seedPhrase)`
- Identity seed: `deriveSubKey(seedBytes, "identity", 32)`
- Public key: `getPublicKey(identitySeed)`
- Stored as `env/keys/identity.json`:
  - `private`: base64(32‑byte seed)
  - `public`: base64(32‑byte public key)

### 8.2 Deterministic ECDH

- ECDH seed: `deriveSubKey(seedBytes, "ecdh", 32)`
- Keypair: `generateKeyPair(ecdhSeed)`
- Stored as `env/keys/ecdh.json`:
  - `private`: base64(32‑byte private key)
  - `public`: base64(32‑byte public key)

### 8.3 Loader

- `loadAllKeys(envPath)` MUST:
  - read `envPath/seed.txt`
  - derive identity and ECDH keys if missing
  - persist them
  - return `{ identity, ecdh }`

---

## 9. Master Key

File: `core/crypto/master.js`

- `deriveMasterKey(password)`
  - `scryptSync(password, "nzcore-master-salt", 32)`
  - Returns 32‑byte key.

- `loadMasterKey()`
  - Reads `env/master.key`.
  - Returns 32‑byte buffer or `null`.

- `saveMasterKey(keyBytes)`
  - Writes 32‑byte key to `env/master.key`.

- `verifyPassword(password)`
  - Derives key from password.
  - Compares with stored master key using `timingSafeEqual`.

- `initMasterKey()`
  - Returns stored master key if present.
  - Otherwise returns random 32‑byte placeholder (dev mode).

---

## 10. Handshake and Secure Channel

### 10.1 Handshake

File: `core/crypto/handshake.js`

- Label: `"NZ-CRYPTO-02/handshake/v1"`
- Transcript: `label || ephemeralPublicKey`

Flow:

- **Alice**:
  - Generates ephemeral X25519 keypair.
  - Signs transcript with Ed25519 identity seed.
  - Sends `{ aliceEphemeralPub, aliceSig }`.

- **Bob**:
  - Verifies Alice’s signature using her public key.
  - Generates ephemeral X25519 keypair.
  - Signs transcript with his Ed25519 identity seed.
  - Computes shared secret via X25519.
  - Returns `{ ok, bobEphemeralPub, bobSig, sharedSecretBob }`.

- **Alice**:
  - Verifies Bob’s signature.
  - Computes `sharedSecretAlice`.
  - Both sides MUST obtain identical shared secrets.

### 10.2 SecureChannel

File: `core/crypto/channel.js`

- Input: `{ sharedSecret, baseContext, role: "alice" | "bob" }`
- Derives:
  - send/recv keys via `deriveSessionKeys(sharedSecret, ctx)`
  - nonce bases via `deriveNonceBase(sharedSecret, ctx)`

Features:

- Epoch‑based rekeying via `rekey()`
- Monotonic send/recv counters
- AEAD encryption via `boxEncrypt` / `boxDecrypt`

---

## 11. Packet Crypto

File: `core/crypto/packets.js`

### 11.1 Signed Packets

- `buildSignedPacket({ nodeId, privateSeed, body })`
  - Computes `body_hash = sha256Hex(body)`
  - Builds `auth` with:
    - `node_id`
    - `timestamp` (seconds)
    - `nonce` (16‑byte hex)
    - `body_hash`
  - Canonicalizes `auth` (sorted keys, no `undefined`).
  - Signs `sha256Hex(canonicalAuth)` with Ed25519 seed.
  - Returns `{ auth: { ...auth, signature }, body }`.

- `verifySignedPacket({ packet, getPublicKeyByNodeId, maxSkewSec, isNonceSeen? })`
  - Validates presence of fields.
  - Checks timestamp skew.
  - Optionally checks replay via `isNonceSeen`.
  - Verifies `body_hash`.
  - Rebuilds canonical auth without signature.
  - Verifies signature using node’s public key.
  - Returns `{ ok: boolean, reason?: string, node_id?: string }`.

### 11.2 Encrypted Packets

- `encryptPacket({ packet, sessionKey, senderNodeId, receiverNodeId, baseContext })`
  - Serializes packet to JSON.
  - Generates random 12‑byte nonce.
  - AAD: `"senderNodeId->receiverNodeId"`.
  - Encrypts with ChaCha20‑Poly1305.
  - Returns envelope with:
    - `version: "nz-crypto-01"`
    - `cipher: "chacha20-poly1305"`
    - `sender_node_id`
    - `receiver_node_id`
    - `nonce`, `tag`, `ciphertext` (base64)
    - `context`

- `decryptPacket({ packet, sessionKey })`
  - Validates `version` and `cipher`.
  - Reconstructs nonce, tag, ciphertext, AAD.
  - Decrypts and parses JSON.
  - Throws on authentication failure.

---

## 12. Routing Crypto

File: `core/crypto/routing.js`

- Version: `"nz-routing-crypto-01"`

- `signRoutingPacket({ nodeId, privateSeed, payload })`
  - Builds packet with:
    - `version`
    - `node_id`
    - `ts` (ms)
    - `nonce` (8‑byte hex)
    - `payload`
  - Canonicalizes `{ version, node_id, ts, nonce, payload }` via stable JSON.
  - Signs with Ed25519 seed.
  - Adds base64 `signature`.

- `verifyRoutingPacket({ packet, getPublicKeyByNodeId, maxSkewSec })`
  - Validates version and required fields.
  - Checks timestamp skew.
  - Fetches public key by node id.
  - Rebuilds signing payload and verifies signature.
  - Returns `{ ok, reason?, node_id?, payload? }`.

---

## 13. Trust Store

File: `core/crypto/trust.js`

- File: `env/trust.json`
- Structure:
  - `peers: Array<{ id: string, pubkey: string, addedAt: string }>`
  - `updatedAt: string | null`

Operations:

- `loadTrustStore()`
  - Returns valid store or default empty store.

- `saveTrustStore(store)`
  - Updates `updatedAt` and writes JSON.

- `addTrustedPeer(peer)`
  - Adds `{ id, pubkey, addedAt }` if not present.

- `removeTrustedPeer(id)`
  - Removes peer by id.

- `isTrusted(id)`
  - Returns boolean.

Trust decisions are local and never delegated to external authorities.

