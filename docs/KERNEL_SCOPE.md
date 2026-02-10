# Kernel Scope Definition

## Included Responsibilities
- Master key generation and recovery
- Hierarchical deterministic key derivation
- Key issuance and revocation
- Trust registry (local)
- Signing of ownership and revocation documents
- Local append-only fact log
- CLI and local IPC access
- Reference crypto libraries (Node.js, Web, Native)

## Explicitly Excluded
- Network routing
- Message delivery
- Service lifecycle management
- Data storage for services
- Behavioral validation
- Content filtering
- Policy enforcement beyond key validity

## Stability
This scope is intended to be extremely stable.
Any change requires an Architecture Decision Record (ADR).
