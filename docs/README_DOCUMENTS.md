# NewZoneCore — Document System Overview

NewZoneCore operates entirely on documents.  
Every object in the system is represented as a signed document with:

- universal metadata
- structured payload
- cryptographic proof

There are five canonical document types:

1. **Entity** — describes a subject (user, device, service)
2. **Delegation** — grants rights from one key to another
3. **Ownership** — expresses lineage and origin of keys
4. **Revocation** — cancels keys or documents
5. **Fact** — records events in an append‑only log

All documents share the same universal structure defined in:

`universal-document-schema.json`

Full human‑readable specification:

`UNIVERSAL_DOCUMENT_SPEC.md`

This system ensures:

- minimalism
- reproducibility
- cryptographic integrity
- complete autonomy
- no master‑key storage on device

Add these files to the repository as the canonical foundation of the document layer.
