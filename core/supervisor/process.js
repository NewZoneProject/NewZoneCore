// Module: Supervisor Process Manager
// Description: Core supervisor for NewZoneCore. Holds cryptographic identity,
//              trust store, master key, service registry and exposes state API.
// File: core/supervisor/process.js

export async function startSupervisor({ masterKey, trust, identity, ecdh }) {
  const state = {
    startedAt: new Date().toISOString(),

    // --- Cryptographic identity -------------------------------------------
    identity: identity || null,   // { seed, public }
    ecdh: ecdh || null,           // { private, public }

    // --- Master key & trust store -----------------------------------------
    masterKeyLoaded: Boolean(masterKey),
    masterKey: masterKey || null,

    trustLoaded: Boolean(trust),
    trust: trust || { peers: [] },

    // --- Local services ----------------------------------------------------
    services: []
  };

  // Register a local microservice
  function registerService(name, meta = {}) {
    state.services.push({
      name,
      meta,
      registeredAt: new Date().toISOString()
    });
  }

  // Return full supervisor state
  async function getState() {
    return state;
  }

  // Return node identity (public key)
  function getNodeId() {
    return state.identity?.public || null;
  }

  // Return Ed25519 identity keys
  function getIdentity() {
    return state.identity;
  }

  // Return X25519 ECDH keys
  function getECDH() {
    return state.ecdh;
  }

  // Return trust store
  function getTrust() {
    return state.trust;
  }

  return {
    registerService,
    getState,
    getNodeId,
    getIdentity,
    getECDH,
    getTrust
  };
}