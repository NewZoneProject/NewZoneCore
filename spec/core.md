# NewZoneCore Core Specification

## 1. Scope

This document specifies the behavior of the NewZoneCore kernel as a local daemon:

- startup and bootstrap flow
- environment expectations
- supervisor lifecycle
- API exposure (HTTP, IPC)
- CLI interaction model

It does **not** define higher‑level protocols or application logic.

---

## 2. Process Model

### 2.1 Entry Point

- File: `core.js`
- Export: `startCore(): Promise<void>`
- CLI entry: `nzcore start` → `startCore()`

### 2.2 Startup Sequence

`startCore()` MUST perform the following steps in order:

1. **Startup checks**
   - Call `runStartupChecks()` from `core/startup/checks.js`.
   - If `report.ok === false` and `interactiveBootstrap()` exists, call `interactiveBootstrap(report)`.

2. **Cryptographic identity**
   - Call `initMasterKey()` from `core/crypto/master.js`.
   - Call `loadTrustStore()` from `core/crypto/trust.js`.
   - Call `loadAllKeys(ROOT/env)` from `core/crypto/keys.js`.
   - Log successful loading of master key, trust store, and identity keys.

3. **Supervisor**
   - Call `startSupervisor({ masterKey, trust, identity, ecdh })`.
   - Store returned supervisor object.

4. **HTTP API**
   - If `startHttpApi()` exists, call it with `{ supervisor }`.
   - HTTP server MUST listen on `0.0.0.0:3000`.

5. **IPC API**
   - If `startIpcServer()` exists, call it with `{ supervisor }`.
   - IPC server MUST listen on the platform‑specific socket path defined in `core/api/ipc.js`.

6. **Final state**
   - Log `[NewZoneCore] online.` when all components are initialized.

### 2.3 Direct Execution

When `core.js` is executed directly:

- `startCore()` MUST be invoked.
- Any unhandled error MUST be logged as `[FATAL]` and terminate the process with exit code `1`.

---

## 3. Supervisor Specification

File: `core/supervisor/process.js`
Export: `startSupervisor(params): Promise<Supervisor>`

### 3.1 Input

`params` MUST contain:

- `masterKey: Uint8Array | Buffer | null`
- `trust: object | null`
- `identity: { private: string, public: string } | null`
- `ecdh: { private: string, public: string } | null`

### 3.2 Internal State

Supervisor MUST maintain:

- `startedAt: string (ISO 8601)`
- `identity` — as provided or `null`
- `ecdh` — as provided or `null`
- `masterKeyLoaded: boolean`
- `masterKey: Uint8Array | Buffer | null`
- `trustLoaded: boolean`
- `trust: object` (at least `{ peers: [] }`)
- `services: Array<{ name: string, meta: object, registeredAt: string }>`

### 3.3 Public API

Supervisor object MUST expose:

- `registerService(name: string, meta?: object): void`
- `getState(): Promise<object>` — returns full internal state
- `getNodeId(): string | null` — returns `identity.public` or `null`
- `getIdentity(): object | null`
- `getECDH(): object | null`
- `getTrust(): object`

No other mutation of state is allowed outside these functions.

---

## 4. HTTP API Specification

File: `core/api/http.js`
Export: `startHttpApi({ supervisor }): Promise<http.Server>`

### 4.1 Endpoints

- `GET /health`
  - Response: `200 OK`
  - Body: `{"status":"ok","core":"NewZoneCore"}`

- `GET /state`
  - MUST call `supervisor.getState()`.
  - Response: `200 OK`
  - Body: JSON object with fields:
    - `startedAt: string | undefined`
    - `node_id: string | null`
    - `ecdh_public: string | null`
    - `trust: object`
    - `services: array`
  - Private fields (e.g. master key, private keys) MUST NOT be exposed.

- Any other path:
  - Response: `404 Not Found` (plain text).

### 4.2 Server

- MUST listen on `0.0.0.0:3000`.
- MUST log `[api:http] listening on http://0.0.0.0:3000`.

---

## 5. IPC API Specification

File: `core/api/ipc.js`
Export: `startIpcServer({ supervisor }): Promise<net.Server>`

### 5.1 Socket Path

- On Windows: `\\\\.\\pipe\\nzcore`
- On Unix/Termux: `${TMPDIR || '/data/data/com.termux/files/usr/tmp'}/nzcore.sock`

Server MUST:

- remove stale socket file on Unix before binding
- ensure parent directory exists

### 5.2 Commands

- `state`
  - MUST call `supervisor.getState()`.
  - Response: JSON string with the same shape as HTTP `/state`.

- Unknown command:
  - Response: `unknown command` (plain text).

---

## 6. CLI Specification (Core Behavior)

File: `core/cli/commands.js` + `core/cli/registry.js`

- `runCli(args: string[])` MUST:
  - route to `commands[cmd].handler` if defined
  - print help on missing/unknown command
  - handle `help` subcommand

Command registry MUST define at least:

- `start` — start daemon via `startCore()`
- `state` — reserved for future IPC client
- `doctor` — environment diagnostics
- `reset` — environment reset
- `recover` — full recovery
- `completion` — bash completion installer
- `help` — help text
- `version` — version info

---

## 7. Error Handling

- All fatal startup errors MUST be logged and terminate the process.
- Non‑fatal errors (e.g. missing optional modules) MAY fall back to placeholders but MUST log a clear message.
- No cryptographic secret (keys, master key) MUST be logged.

