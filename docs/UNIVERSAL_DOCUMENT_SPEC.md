# NewZoneCore — Universal Document Specification

This document defines the canonical structure of all documents in NewZoneCore.
Every document consists of:

- **metadata** — universal, type‑independent
- **payload** — structured semantic content
- **proof** — cryptographic evidence

This specification is minimal, stable, and fully reproducible.

---

# 1. Metadata (Universal Layer)

Metadata describes the document as an object in time.

| Field | Description |
|-------|-------------|
| `type` | Ontological class: `entity`, `delegation`, `ownership`, `revocation`, `fact` |
| `version` | Schema version |
| `id` | Unique document identifier |
| `created_at` | Moment of birth of the document (nonce) |
| `issuer.key_id` | Key that signs the document |
| `subject.key_id` | Key to which the document refers |
| `constraints.not_before` | Document becomes valid after this moment |
| `constraints.expires_at` | Document becomes invalid after this moment |

`created_at` is part of the signed content and prevents replay attacks.

---

# 2. Payload (Structured Semantics)

Payload expresses the meaning of the document.  
Its structure depends on `type`, but fields are standardized.

---

## 2.1 Entity Payload

```json
{
  "entity_type": "user | device | service | agent | other",
  "metrics": { "...": "..." },
  "attributes": { "...": "..." }
}
```

## 2.2 Delegation Payload

```json
{
  "delegation_type": "access | role | capability | session | other",
  "rights": ["string"],
  "scope": { "...": "..." },
  "context": { "...": "..." }
}
```

## 2.3 Ownership Payload

```json
{
  "parent_key_id": "string",
  "origin": "master | delegated | external",
  "lineage": ["key_id"],
  "attributes": { "...": "..." }
}
```

## 2.4 Revocation Payload

```json
{
  "target_type": "key | document | delegation | entity",
  "target_id": "string",
  "reason": "string",
  "severity": "low | medium | high | critical"
}
```

## 2.5 Fact Payload

```json
{
  "fact_type": "event | measurement | state | other",
  "data": { "...": "..." },
  "context": { "...": "..." }
}
```

# 3. Proof (Cryptographic Evidence)

```json
{
  "algo": "string",
  "hash": "string",
  "signature": "string"
}
```

  `hash` is computed from canonical encoding of the entire document except `proof`.
  `signature` is created using `issuer.key_id`.

# 4. Canonical Encoding
Canonical encoding is defined in the core specification and is not part of the document itself.

# 5. Trust Model
All trust is derived from documents.
Master‑key never resides on the device.
Delegated identity key is the root of local trust.

This specification is the foundation of NewZoneCore.
