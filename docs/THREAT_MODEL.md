# Threat Model (High-Level)

## In Scope
- Key compromise
- Device loss
- Malicious applications
- Rogue services
- Offline attacks
- Replay attacks on documents

## Out of Scope
- User negligence
- Legal disputes resolution
- Service misbehavior
- Network-level censorship

## Assumptions
- The user controls the device at initialization
- Cryptographic primitives are secure
- Reference implementations are correctly audited

## Design Response
- Key revocation mechanisms
- Two-phase ownership transfer
- Signed, timestamped documents
- Local immutable fact log
