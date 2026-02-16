# NewZoneCore

**Autonomous Trust and Process Core for Distributed Systems**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node: >=18](https://img.shields.io/badge/Node.js->=18-green.svg)](https://nodejs.org/)
[![Security: Hardened](https://img.shields.io/badge/Security-Hardened-blue.svg)]()
[![GitHub](https://img.shields.io/badge/GitHub-NewZoneProject-black.svg)](https://github.com/NewZoneProject/NewZoneCore)

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Cryptography](#cryptography)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Documentation](#api-documentation)
- [Security](#security)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Modules](#modules)
- [Development](#development)
- [License](#license)

---

## Overview

**NewZoneCore** is an autonomous kernel for building distributed trust systems. The project provides a complete toolkit for identity management, trusted connections between nodes, secure routing, and autonomous services.

The primary goal is to create a secure, decentralized infrastructure where each node can independently function and interact with other nodes without a central trust authority.

### Key Characteristics

- **Full Autonomy**: Each node is independent and self-sufficient
- **Cryptographic Protection**: Modern algorithms Ed25519, X25519, ChaCha20-Poly1305
- **Distributed Trust**: Web-of-trust model without central certificate authority
- **Multi-hop Routing**: TTL, hop-by-hop signatures, route discovery
- **Secure Storage**: Data encryption with HKDF key derivation

---

## Key Features

### 🔐 Identity Management

- Deterministic key generation from BIP-39 mnemonic
- Ed25519 for signatures and authentication
- X25519 for secure key exchange (ECDH)
- Seed phrase encryption with ChaCha20-Poly1305
- Secure key storage with automatic memory cleanup

### 🤝 Trust System

- Distributed trust synchronization between nodes
- Signed trust updates with replay attack protection
- Trust levels: UNKNOWN, LOW, MEDIUM, HIGH, ULTIMATE
- Trust rights delegation
- Hash chain for update integrity

### 🛣️ Routing v2

- Multi-hop routing with TTL (Time-To-Live)
- Hop-by-hop signatures for path verification
- Automatic route discovery
- Routing table with expiration
- Broadcast and flood message support

### 🔍 Node Discovery

- Local discovery via broadcast
- QR code for identity exchange
- Peer introduction protocol
- Node information caching

### 💾 Secure Storage

- File encryption with ChaCha20-Poly1305
- HKDF key derivation (instead of insecure SHA256)
- Encrypted KV-store with key hashing
- Encrypted event logs with rotation
- Size limits for attack protection

### 🤖 Autonomous Services

- Auto-start with policies (always, on-failure, on-demand)
- Crash recovery with exponential backoff
- Health checks with configurable thresholds
- Dependency graph for startup order

### 🔌 API and Interfaces

- HTTP API with JWT authentication
- IPC (Inter-Process Communication) with tokens
- Rate limiting for brute-force protection
- API keys for programmatic access

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NewZoneCore                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   HTTP API  │  │   IPC API   │  │       CLI Interface     │ │
│  │  (JWT Auth) │  │ (Token Auth)│  │      (nzcore CLI)       │ │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬────────────┘ │
│         │                │                      │               │
│  ┌──────┴────────────────┴──────────────────────┴────────────┐ │
│  │                    Supervisor / Core                        │ │
│  └──────────────────────────────┬─────────────────────────────┘ │
│                                 │                               │
│  ┌──────────────────────────────┴─────────────────────────────┐ │
│  │                    Service Container (DI)                   │ │
│  └──────────────────────────────┬─────────────────────────────┘ │
│                                 │                               │
│  ┌──────────────┬───────────────┼───────────────┬─────────────┐ │
│  │   Identity   │  Trust Sync   │   Routing     │  Discovery  │ │
│  │   Manager    │   Protocol    │    Layer      │    Module   │ │
│  └──────────────┴───────────────┴───────────────┴─────────────┘ │
│  ┌──────────────┬───────────────┬───────────────┬─────────────┐ │
│  │    Event     │   Channel     │   Secure      │ Autonomous  │ │
│  │     Bus      │   Manager     │   Storage     │  Services   │ │
│  └──────────────┴───────────────┴───────────────┴─────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Crypto Layer                             │ │
│  │  Ed25519 │ X25519 │ ChaCha20-Poly1305 │ BLAKE2b │ scrypt  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Architecture Principles

1. **Dependency Injection**: Global singletons replaced with DI container
2. **Event-Driven**: All modules interact through EventBus
3. **Defense in Depth**: Multi-layer protection: authentication, validation, encryption
4. **Fail-Safe**: Automatic recovery after failures

---

## Cryptography

### Algorithms

| Purpose | Algorithm | Key Size |
|----------|----------|--------------|
| Signatures | Ed25519 | 32 bytes |
| Key Exchange | X25519 | 32 bytes |
| Symmetric Encryption | ChaCha20-Poly1305 | 32 bytes |
| Hashing | BLAKE2b | 32 bytes |
| Key Derivation | scrypt + HKDF | 32 bytes |
| Mnemonic | BIP-39 | 12/24 words |

### Key Derivation

```
Mnemonic (BIP-39)
       │
       ▼
    seed.js → 64 bytes seed
       │
       ├─► deriveSubKey(seed, 'identity') → Ed25519 private key
       │
       └─► deriveSubKey(seed, 'ecdh') → X25519 key pair
```

### Data Encryption

```
Master Key + Nonce
       │
       ▼
    HKDF-Extract(salt=nonce, ikm=master_key) → PRK
       │
       ▼
    HKDF-Expand(PRK, context) → Derived Key
       │
       ▼
    ChaCha20-Poly1305(nonce, derived_key, plaintext) → ciphertext + tag
```

---

## Installation

### Requirements

- Node.js >= 18.0.0
- npm or bun

### From Source

```bash
# Clone repository
git clone https://github.com/NewZoneProject/NewZoneCore.git
cd NewZoneCore

# Install dependencies
npm install

# Initialize
npm run bootstrap
```

---

## Quick Start

### 1. Node Initialization

```bash
# Create new configuration
nzcore init --password YOUR_PASSWORD

# Or restore from mnemonic
nzcore restore --mnemonic "word1 word2 ... word12"
```

### 2. Start

```bash
# Start the core
nzcore start

# Start with configuration
nzcore start --config ./custom-config.json
```

### 3. Using API

```bash
# Get token
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_PASSWORD"}'

# Get state
curl http://localhost:3000/api/state \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. IPC Interface

```bash
# Connect to IPC
nzcore ipc

# Authentication
AUTH your_ipc_token

# Commands
state
trust:list
identity
services
```

---

## API Documentation

### HTTP API

#### Authentication

```
POST /api/auth/login
  Body: { "password": "string" }
  Response: { "accessToken": "...", "refreshToken": "...", "expiresIn": 900 }

POST /api/auth/refresh
  Body: { "refreshToken": "string" }
  Response: { "accessToken": "...", "expiresIn": 900 }
```

#### State

```
GET /api/state
  Auth: Bearer token
  Response: { "startedAt": "...", "node_id": "...", "trust": {...}, "services": [...] }
```

#### Trust

```
GET /api/trust
  Response: { "peers": [...] }

POST /api/trust
  Body: { "id": "peer_id", "pubkey": "base64_public_key" }
  Response: { "ok": true }

DELETE /api/trust?id=peer_id
  Response: { "ok": true, "removed": 1 }
```

#### Identity

```
GET /api/identity
  Response: { "node_id": "...", "ed25519_public": "...", "x25519_public": "..." }
```

#### Services

```
GET /api/services
  Response: { "services": [...] }
```

#### Routing

```
GET /api/routing
  Response: { "routes": [...] }

POST /api/routing
  Body: { "peerId": "...", "pubkey": "..." }
  Response: { "ok": true }
```

#### Storage

```
GET /api/storage/files
  Response: { "files": [...] }

POST /api/storage/kv
  Body: { "key": "string", "value": "any" }
  Response: { "success": true }

GET /api/storage/kv?key=string
  Response: { "value": "any" }
```

### IPC Commands

| Command | Description |
|---------|-------------|
| `AUTH <token>` | Authentication |
| `state` | Node state |
| `identity` | Identity information |
| `trust:list` | List trusted nodes |
| `trust:add <id> <pubkey>` | Add trusted node |
| `trust:remove <id>` | Remove trusted node |
| `services` | List services |
| `router:routes` | List routes |
| `router:add <peerId> <pubkey>` | Add route |
| `router:send <peerId> <json>` | Send message |
| `router:ping <peerId>` | Ping node |
| `LOGOUT` | End session |

---

## Security

### Implemented Security Measures

#### Cryptography

- ✅ **Unique scrypt salt**: Each user has a unique 32-byte salt
- ✅ **Seed phrase encryption**: Seed stored encrypted, not in plaintext
- ✅ **HKDF derivation**: Proper key derivation instead of insecure SHA256(key||nonce)
- ✅ **SecureBuffer**: Automatic cleanup of secret data from memory

#### Authentication

- ✅ **JWT tokens**: Access tokens with limited lifetime (15 min)
- ✅ **API Keys**: Ability to create keys with limited permissions
- ✅ **Rate Limiting**: Lockout after 5 failed login attempts
- ✅ **IPC tokens**: Mandatory authentication for IPC connections

#### Network Security

- ✅ **CORS whitelist**: Limit allowed origins
- ✅ **Localhost binding**: API only available locally by default
- ✅ **Input validation**: Validation of all incoming parameters
- ✅ **Size limits**: Size restrictions for DoS protection

#### Trust Sync

- ✅ **Replay protection**: Sequence numbers and nonce for each operation
- ✅ **Ed25519 signatures**: All trust updates are signed
- ✅ **Hash chain**: Integrity of update chain

### Security Recommendations

1. **Use a strong password** for master key (minimum 12 characters)
2. **Store mnemonic** in a safe place (never transmit electronically)
3. **Restrict access** to files in `env/` directory (permissions 0o600)
4. **Regularly rotate** API keys
5. **Monitor logs** for suspicious activity

---

## Testing

### Running Tests

```bash
# All tests
npm test

# Security tests
node tests/security.test.js

# Cryptographic tests
node tests/crypto.test.js
```

### Test Coverage

```
============================================================
NewZoneCore Security Test Suite
============================================================

[Master Key Tests]
  ✓ should generate unique salt
  ✓ should derive key with unique salt
  ✓ should derive same key from same password and salt
  ✓ should derive different keys from different passwords
  ✓ should wipe key from memory

[Encrypted Seed Tests]
  ✓ should encrypt and decrypt seed phrase
  ✓ should fail decryption with wrong key
  ✓ should securely wipe SecureBuffer

[Secure Storage Tests]
  ✓ should create SecureStorage
  ✓ should encrypt and decrypt files
  ✓ should use HKDF for key derivation
  ✓ should enforce size limits

[Auth Manager Tests]
  ✓ should generate and validate JWT tokens
  ✓ should reject invalid tokens
  ✓ should generate and validate API keys
  ✓ should reject wrong API key
  ✓ should implement rate limiting for logins

[Trust Sync Tests]
  ✓ should create TrustUpdate with replay protection
  ✓ should detect duplicate updates
  ✓ should enforce sequence ordering

[Routing Layer Tests]
  ✓ should create RoutedMessage with TTL
  ✓ should add hops and decrement TTL
  ✓ should detect expired TTL

============================================================
Results: 27 passed, 0 failed
============================================================
```

---

## Project Structure

```
NewZoneCore/
├── core/
│   ├── crypto/              # Cryptographic modules
│   │   ├── auth.js          # JWT and API Keys
│   │   ├── box.js           # X25519 ECDH
│   │   ├── derive.js        # HKDF derivation
│   │   ├── keys.js          # Key management
│   │   ├── master.js        # Master key (scrypt)
│   │   ├── seed.js          # BIP-39 mnemonic
│   │   └── sign.js          # Ed25519 signatures
│   │
│   ├── api/                 # Interfaces
│   │   ├── http.js          # HTTP API server
│   │   └── ipc.js           # IPC server
│   │
│   ├── trust/               # Trust system
│   │   └── sync.js          # Trust Sync Protocol
│   │
│   ├── routing/             # Routing
│   │   └── layer.js         # Routing Layer v2
│   │
│   ├── discovery/           # Node discovery
│   │   └── index.js         # Node Discovery
│   │
│   ├── storage/             # Storage
│   │   └── secure.js        # Secure Storage
│   │
│   ├── autonomous/          # Autonomous services
│   │   └── manager.js       # Service Manager
│   │
│   ├── eventbus/            # Event Bus
│   │   └── index.js         # Pub/Sub system
│   │
│   ├── lifecycle/           # Lifecycle
│   │   └── manager.js       # Service Lifecycle
│   │
│   ├── channel/             # Communication channels
│   │   └── manager.js       # Channel Manager
│   │
│   ├── container.js         # Dependency Injection
│   ├── logger.js            # Structured Logger
│   └── core.js              # Main entry point
│
├── tests/                   # Tests
│   ├── security.test.js
│   ├── crypto.test.js
│   └── seed-restore.test.js
│
├── bin/
│   └── nzcore               # CLI executable
│
├── docs/                    # Documentation
│   ├── CORE_CONCEPT.md
│   ├── THREAT_MODEL.md
│   └── KERNEL_SCOPE.md
│
├── spec/                    # Specifications
│   ├── crypto.md
│   ├── env.md
│   └── core.md
│
├── ROADMAP.md               # Roadmap
├── ARCHITECTURE.md          # Architecture
├── package.json
└── LICENSE
```

---

## Modules

### EventBus

Central event system for inter-module communication.

```javascript
import { getEventBus, EventTypes } from './eventbus/index.js';

const bus = getEventBus();

// Subscribe
bus.on(EventTypes.TRUST_PEER_ADDED, (data) => {
  console.log('New peer:', data.peerId);
});

// Publish
bus.emit(EventTypes.TRUST_PEER_ADDED, { peerId: 'peer-123' });
```

### TrustSyncProtocol

Managing trusted relationships between nodes.

```javascript
import { TrustSyncProtocol, TrustLevel } from './trust/sync.js';

const protocol = new TrustSyncProtocol({ identity });

// Add trusted node
const update = await protocol.createPeerAdd('peer-123', publicKey, TrustLevel.HIGH);
await protocol.broadcastUpdate(update, peers);
```

### RoutingLayer

Multi-hop message routing.

```javascript
import { RoutingLayer } from './routing/layer.js';

const router = new RoutingLayer({ identity, trustStore });

// Add route
router.addRoute('peer-123', 'next-hop-id', { metric: 2 });

// Send message
const message = await router.sendRouted('peer-123', { type: 'ping' });
```

### SecureStorage

Encrypted data storage.

```javascript
import { SecureStorage } from './storage/secure.js';

const storage = new SecureStorage({ 
  basePath: './data',
  masterKey 
});

await storage.init();

// Write
await storage.writeFile('config.json', { setting: 'value' });

// Read
const config = await storage.readFile('config.json');

// KV Store
await storage.set('user:123', { name: 'Alice' });
const user = await storage.get('user:123');
```

### AuthManager

Authentication and authorization.

```javascript
import { AuthManager } from './crypto/auth.js';

const auth = new AuthManager({ masterKey });

// Login
const result = await auth.login(password, clientIp);

// Generate API key
const apiKey = await auth.generateApiKey('my-app', ['read', 'write']);

// Validate
const validation = auth.validateToken(token);
```

---

## Development

### Scripts

```bash
npm start          # Start core
npm test           # Run tests
npm run lint       # Code check
```

### Adding a New Module

1. Create file in appropriate directory
2. Import EventBus for events
3. Use Dependency Injection
4. Add tests to `tests/`

### Code Style

- ES Modules (ESM)
- JSDoc comments
- Async functions where possible
- Error handling with try-catch

---

## Roadmap

### ✅ Phase 0: Foundation
- [x] Crypto primitives
- [x] Key derivation
- [x] Seed management

### ✅ Phase 1: Core
- [x] EventBus
- [x] Service Lifecycle
- [x] Identity
- [x] Channel Manager

### ✅ Phase 2: Network
- [x] Distributed Trust Sync
- [x] Routing Layer v2
- [x] Node Discovery

### ✅ Phase 3: Autonomous
- [x] Autonomous Services
- [x] Secure Storage Layer

### 🔜 Phase 4: Production
- [ ] DHT Integration
- [ ] NAT Traversal
- [ ] Network Bridging

---

## License

MIT License

Copyright (c) 2024 NewZoneProject

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Contact

- **GitHub**: [github.com/NewZoneProject/NewZoneCore](https://github.com/NewZoneProject/NewZoneCore)
- **Issues**: [github.com/NewZoneProject/NewZoneCore/issues](https://github.com/NewZoneProject/NewZoneCore/issues)
- **Organization**: [github.com/NewZoneProject](https://github.com/NewZoneProject)

---

*Built with ❤️ by the [NewZoneProject](https://github.com/NewZoneProject) Team*
