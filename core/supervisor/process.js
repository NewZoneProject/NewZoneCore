// Module: Supervisor Process Manager
// Description: Core supervisor for NewZoneCore. Holds cryptographic identity,
//              trust store, master key, service registry, event bus and exposes
//              unified state API.
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

  // -------------------------------------------------------------------------
  // Event Bus (Phase 1.1)
  // -------------------------------------------------------------------------

  const subscribers = {};   // { eventName: [handler, ...] }
  const queue = [];         // FIFO event queue
  let processing = false;

  function subscribe(event, handler) {
    if (!subscribers[event]) subscribers[event] = [];
    subscribers[event].push(handler);
  }

  function unsubscribe(event, handler) {
    if (!subscribers[event]) return;
    subscribers[event] = subscribers[event].filter(h => h !== handler);
  }

  function emit(event, payload = {}) {
    queue.push({ event, payload });
    processQueue();
  }

  async function processQueue() {
    if (processing) return;
    processing = true;

    while (queue.length > 0) {
      const { event, payload } = queue.shift();
      const handlers = subscribers[event] || [];

      for (const h of handlers) {
        try {
          await h(payload);
        } catch (err) {
          console.log(`[eventbus] handler error for ${event}:`, err);
        }
      }
    }

    processing = false;
  }

  // Emit core startup event
  emit('core:started', { startedAt: state.startedAt });

  // -------------------------------------------------------------------------
  // Service Registry (Phase 0.3)
  // -------------------------------------------------------------------------

  function registerService(name, meta = {}) {
    state.services.push({
      name,
      meta,
      registeredAt: new Date().toISOString()
    });

    emit('service:registered', { name, meta });
  }

  function getServices() {
    return state.services;
  }

  // -------------------------------------------------------------------------
  // Module Registry (Phase 2.0)
  // -------------------------------------------------------------------------

  const moduleStore = {}; // { name: moduleInstance }

  function registerModule(name, instance) {
    moduleStore[name] = instance;
    emit('module:registered', { name });
  }

  function getModule(name) {
    return moduleStore[name] || null;
  }

  function listModules() {
    return Object.keys(moduleStore);
  }

  // -------------------------------------------------------------------------
  // Identity / Crypto
  // -------------------------------------------------------------------------

  function getNodeId() {
    return state.identity?.public || null;
  }

  function getIdentity() {
    return state.identity;
  }

  function getECDH() {
    return state.ecdh;
  }

  function getIdentityInfo() {
    return {
      node_id: state.identity?.public || null,
      ed25519_public: state.identity?.public || null,
      x25519_public: state.ecdh?.public || null
    };
  }

  // -------------------------------------------------------------------------
  // Trust Store
  // -------------------------------------------------------------------------

  function getTrust() {
    return state.trust || { peers: [] };
  }

  // -------------------------------------------------------------------------
  // Runtime Info
  // -------------------------------------------------------------------------

  function getRuntimeInfo() {
    const now = Date.now();
    const started = new Date(state.startedAt).getTime();
    return {
      startedAt: state.startedAt,
      uptime_ms: now - started,
      serviceCount: state.services.length
    };
  }

  // -------------------------------------------------------------------------
  // Unified State API
  // -------------------------------------------------------------------------

  async function getState() {
    return {
      startedAt: state.startedAt,
      runtime: getRuntimeInfo(),
      identity: getIdentityInfo(),
      ecdh: state.ecdh,
      trust: getTrust(),
      services: getServices(),
      masterKeyLoaded: state.masterKeyLoaded,
      trustLoaded: state.trustLoaded
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  return {
    // event bus
    emit,
    subscribe,
    unsubscribe,

    // service registry
    registerService,
    getServices,

    // module registry
    modules: {
      registerModule,
      getModule,
      listModules
    },

    // identity / crypto
    getNodeId,
    getIdentity,
    getECDH,
    getIdentityInfo,

    // trust
    getTrust,

    // runtime
    getRuntimeInfo,

    // unified state
    getState
  };
}

