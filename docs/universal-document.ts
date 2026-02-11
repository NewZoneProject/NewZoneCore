/**
 * Module: Universal Document Types
 * Description: Canonical TypeScript interfaces for NewZoneCore document system.
 * Run: Import into any module that needs to work with documents.
 * File: universal-document.ts
 */

/* ---------------------------------------------
 * Metadata (universal for all document types)
 * --------------------------------------------- */

export type DocumentType =
  | "entity"
  | "delegation"
  | "ownership"
  | "revocation"
  | "fact";

export interface DocumentIssuer {
  key_id: string;
}

export interface DocumentSubject {
  key_id: string;
}

export interface DocumentConstraints {
  not_before?: string;   // ISO 8601
  expires_at?: string;   // ISO 8601
}

export interface DocumentProof {
  algo: string;
  hash: string;
  signature: string;
}

/* ---------------------------------------------
 * Payloads (structured semantics)
 * --------------------------------------------- */

/** Entity */
export interface EntityPayload {
  entity_type: "user" | "device" | "service" | "agent" | "other";
  metrics: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

/** Delegation */
export interface DelegationPayload {
  delegation_type: "access" | "role" | "capability" | "session" | "other";
  rights: string[];
  scope: Record<string, unknown>;
  context?: Record<string, unknown>;
}

/** Ownership */
export interface OwnershipPayload {
  parent_key_id: string;
  origin: "master" | "delegated" | "external";
  lineage: string[];
  attributes?: Record<string, unknown>;
}

/** Revocation */
export interface RevocationPayload {
  target_type: "key" | "document" | "delegation" | "entity";
  target_id: string;
  reason: string;
  severity: "low" | "medium" | "high" | "critical";
}

/** Fact */
export interface FactPayload {
  fact_type: "event" | "measurement" | "state" | "other";
  data: Record<string, unknown>;
  context?: Record<string, unknown>;
}

/* ---------------------------------------------
 * Union of all payloads
 * --------------------------------------------- */

export type DocumentPayload =
  | EntityPayload
  | DelegationPayload
  | OwnershipPayload
  | RevocationPayload
  | FactPayload;

/* ---------------------------------------------
 * Universal Document
 * --------------------------------------------- */

export interface UniversalDocument {
  type: DocumentType;
  version: string;
  id: string;
  created_at: string; // ISO 8601

  issuer: DocumentIssuer;
  subject: DocumentSubject;

  constraints: DocumentConstraints;

  payload: DocumentPayload;

  proof: DocumentProof;
}

