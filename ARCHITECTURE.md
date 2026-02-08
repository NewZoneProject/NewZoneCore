# NewZoneCore Architecture
A minimal, autonomous, cryptographically anchored runtime designed to operate entirely on a personal device.
This document describes the internal structure of the NewZoneCore kernel and the relationships between its components.

---

## 1. High‑Level Overview

NewZoneCore is a local daemon that:

- initializes and maintains the node’s cryptographic identity
- manages the environment directory (`env/`)
- runs the supervisor as the central state and service manager
- exposes APIs via HTTP and IPC
- provides a CLI as a thin client to the running daemon

The kernel is intentionally minimal, dependency‑free, and portable across Linux, Termux/Android, and other Unix‑like environments.

---

## 2. Layered Architecture

NewZoneCore is organized into the following layers:

1. **Crypto Primitives (`core/libs/`)**
 Low‑level cryptographic building blocks.

2. **Crypto Kernel (`core/crypto/`)**
 Identity, key derivation, handshake, secure channels, packet crypto, trust.

3. **Environment Layer (`env/`, `env_test/`)**
 Persistent storage for keys, seed, master key, and trust store.

4. **Supervisor (`core/supervisor/`)**
 Central state manager and service registry.

5. **API Layer (`core/api/`)**
 HTTP and IPC interfaces exposing supervisor state.

6. **CLI Layer (`core/cli/`)**
 User‑facing command interface.

7. **Startup Layer (`core/startup/`, `core.js`)**
 Bootstrap, recovery, and daemon initialization.

---

## 3. Crypto Layer

### 3.1. Primitives (`core/libs/`)
These modules provide raw cryptographic operations:

- `blake2b.js` — BLAKE2b hashing
- `chacha20poly1305.js` — ChaCha20‑Poly1305 AEAD
- `ed25519.js` — Ed25519 signatures (sign/verify, ctx, ph)
- `hkdf.js` — HKDF (SHA‑512 / BLAKE2b)
- `x25519.js` — pure X25519 scalar multiplication

They contain no NewZoneCore‑specific logic.

### 3.2. Crypto Kernel (`core/crypto/`)
High‑level cryptographic functionality:

- **Random utilities**: `random.js`
- **Key derivation**: `derive.js`
- **Seed & mnemonic (BIP‑39)**: `seed.js`
- **Ed25519 signing**: `sign.js`
- **Crypto box (X25519 + AEAD)**: `box.js`
- **SecureChannel** with epoch‑based rekeying: `channel.js`
- **Authenticated handshake**: `handshake.js`
- **Signed & encrypted packets**: `packets.js`
- **Routing packet crypto**: `routing.js`
- **Trust store**: `trust.js`
- **Master key management**: `master.js`
- **Deterministic identity & ECDH keys**: `keys.js`
- **Node‑level keys for services**: `node-keys.js`
- **Unified export surface**: `index.js`

This layer defines the cryptographic identity and secure communication model of the node.

---

## 4. Environment Model

### 4.1. Directory Structure

`env/` contains all persistent state:

- `master.key` — 32‑byte master key
- `seed.txt` — BIP‑39 mnemonic
- `trust.json` — trust store
- `keys/identity.json` — Ed25519 identity
- `keys/ecdh.json` — X25519 ECDH keys

`env_test/` mirrors this structure for automated tests.

### 4.2. Lifecycle

- **Bootstrap** creates a new environment or restores from seed.
- **Reset** wipes and recreates the environment.
- **Recovery** rebuilds keys deterministically from the mnemonic.

The environment is designed to be portable and reproducible.

---

## 5. Supervisor

File: `core/supervisor/process.js`

The supervisor is the in‑memory state container of the kernel.
It maintains:

- startup timestamp
- identity keys
- ECDH keys
- master key status
- trust store
- registered services

It exposes:

- `registerService(name, meta)`
- `getState()`
- `getNodeId()`
- `getIdentity()`
- `getECDH()`
- `getTrust()`

The supervisor is transport‑agnostic and does not depend on HTTP or IPC.

---

## 6. API Layer

### 6.1. HTTP API (`core/api/http.js`)
A minimal HTTP server exposing:

- `GET /health` — daemon health
- `GET /state` — sanitized supervisor state

Used for introspection and future UI integrations.

### 6.2. IPC API (`core/api/ipc.js`)
A local IPC socket server providing:

- `state` — supervisor state

Used by the CLI and internal services for fast local communication.

---

## 7. CLI Layer

Files: `core/cli/*`

The CLI is a thin wrapper around the daemon:

- `commands.js` — command dispatcher
- `registry.js` — command definitions
- `help.js` — auto‑generated help
- `doctor.js` — environment diagnostics
- `complete.js` — bash completion (Termux)
- `docgen.js` — CLI documentation generator
- `colors.js` — ANSI color utilities

The CLI does not contain kernel logic; it communicates with the daemon via IPC.

---

## 8. Startup Layer

### 8.1. `core.js`
The unified entry point:

1. Run startup checks
2. Trigger bootstrap if needed
3. Load master key, trust store, identity keys
4. Start supervisor
5. Start HTTP API
6. Start IPC API

### 8.2. Startup Modules
- `checks.js` — validate environment
- `bootstrap.js` — interactive setup
- `recovery.js` — reset and restore flows

This layer ensures the kernel can initialize itself on any device.

---

## 9. Test Suite

Files: `tests/*.test.js`

- `crypto.test.js` — BIP‑39, seed, deterministic keys
- `seed-restore.test.js` — master key restoration consistency

Tests rely on the built‑in `node:test` runner and require no external dependencies.

---

## 10. Architectural Evolution

This document describes the current architecture.
Future evolution is defined in `ROADMAP.md`, including:

- supervisor lifecycle
- event bus
- module system
- secure channel manager
- distributed trust sync
- routing v2
- autonomous services
- plugin system
- formal specifications

NewZoneCore remains minimal, portable, and self‑sovereign as it evolves.


