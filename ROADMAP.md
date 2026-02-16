# NewZoneCore Kernel Roadmap
Minimal, autonomous, cryptographically anchored evolution plan for the NewZoneCore kernel.
Each phase represents a structural milestone in the development of a self‑sovereign runtime.

---

## Phase 0 — Stabilization (current → stable base)
Goal: formalize the existing architecture and prepare the kernel for structured evolution.

### 0.1. Architecture Formalization
- Create `ARCHITECTURE.md`
- Create `MANIFEST.md`
- Create `spec/core.md`
- Create `spec/crypto.md`
- Create `spec/env.md`

### 0.2. CLI ↔ IPC Integration
- Implement IPC client for CLI
- Implement `nzcore state`
- Implement trust management commands
- Implement identity inspection commands
- Implement service inspection commands

### 0.3. Supervisor Foundation
- Add service registry
- Add service metadata
- Add supervisor state API extensions

### 0.4. HTTP & IPC API Completion
- Add trust management endpoints
- Add handshake endpoints
- Add packet crypto endpoints
- Add service management endpoints

---

## Phase 1 — Kernel v1.0 (runtime foundation)
Goal: transform supervisor into a real runtime with lifecycle and internal communication.

### 1.1. Event Bus
- Internal event queue
- Subscriptions
- Event routing
- Supervisor‑level notifications

### 1.2. Service Lifecycle
- `init()`, `start()`, `stop()`, `status()`
- Automatic registration
- Supervisor‑controlled lifecycle

### 1.3. Module Registry
- `modules/` directory
- Module manifests
- Dynamic module loading
- Supervisor integration

### 1.4. Unified Identity Layer
- Consolidated identity object
- Unified signing API
- Unified ECDH API
- Identity export/import

### 1.5. Secure Channel Manager
- Channel registry
- Automatic rekeying
- Message send/receive API
- Peer session management

---

## Phase 2 — Kernel v1.5 (distributed autonomy)
Goal: enable trust propagation and secure routing between autonomous nodes.

### 2.1. Distributed Trust Sync
- Signed trust updates
- Trust replication protocol
- Peer trust validation

### 2.2. Routing Layer v2
- Multi‑hop routing
- TTL
- Hop‑by‑hop signatures
- Routing table

### 2.3. Node Discovery (optional)
- Local discovery
- Peer introduction protocol
- QR‑based identity exchange

---

## Phase 3 — Kernel v2.0 (autonomous services)
Goal: turn NewZoneCore into a self‑managing autonomous runtime.

### 3.1. Autonomous Services
- Automatic startup
- Crash recovery
- Health checks
- Dependency graph

### 3.2. Secure Storage Layer
- Encrypted files
- Encrypted KV store
- Encrypted event logs

### 3.3. Distributed Message Fabric
- Lightweight message bus
- Peer‑to‑peer message routing
- Service‑to‑service messaging

---

## Phase 4 — Kernel v2.5 (ecosystem)
Goal: enable modular expansion and external integrations.

### 4.1. Plugin System
- Module API
- CLI extension API
- HTTP extension API
- Service extension API

### 4.2. WASM Sandbox (optional)
- Isolated execution
- Capability‑based permissions

### 4.3. Multi‑Identity Support
- Multiple identities per node
- Identity switching
- Identity isolation

---

## Phase 5 — Kernel v3.0 (maturity)
Goal: finalize the kernel as a stable, documented, interoperable system.

### 5.1. Formal Specifications
- NZ‑CRYPTO‑01
- NZ‑ROUTING‑01
- NZ‑HANDSHAKE‑01
- NZ‑CHANNEL‑01

### 5.2. Test Vectors & Compliance
- Cryptographic test vectors
- Protocol compliance tests
- Interoperability tests

### 5.3. Stable API & ABI
- Versioned kernel API
- Backward compatibility
- Long‑term stability guarantees

---

## Philosophy
NewZoneCore evolves as a minimal, portable, self‑sovereign kernel.
Each phase strengthens autonomy, reduces external dependencies, and expands the node’s ability to operate independently in a distributed environment.


