// Module: Supervisor Process Manager
// Description: Core supervisor for NewZoneCore. Holds cryptographic identity,
//              trust store, master key, service registry, event bus and exposes
//              unified state API. Now with full lifecycle, channel and plugin support.
// File: core/supervisor/process.js

import { EventBus, EventTypes, getEventBus } from '../eventbus/index.js';
import { ServiceManager, ServiceState, getServiceManager } from '../lifecycle/manager.js';
import { Identity, IdentityManager } from '../identity/unified.js';
import { ChannelManager, getChannelManager } from '../channel/manager.js';
import { getPluginLoader } from '../plugins/loader.js';

// ============================================================================
// SUPERVISOR
// ============================================================================

export async function startSupervisor({ masterKey, trust, identity, ecdh, envPath }) {
  // Initialize event bus
  const eventBus = getEventBus();
  
  // Internal state
  const state = {
    startedAt: new Date().toISOString(),
    
    // Cryptographic identity
    identity: identity || null,
    ecdh: ecdh || null,
    
    // Master key & trust store
    masterKeyLoaded: Boolean(masterKey),
    masterKey: masterKey || null,
    trustLoaded: Boolean(trust),
    trust: trust || { peers: [] },
    
    // Services (legacy, will be migrated to ServiceManager)
    services: []
  };
  
  // =========================================================================
  // EVENT BUS
  // =========================================================================
  
  // Log all events in debug mode
  if (process.env.NZCORE_DEBUG === 'true') {
    eventBus.subscribe('*', (event) => {
      console.log(`[event] ${event.type}`, event.payload);
    });
  }
  
  // Emit core started event
  eventBus.emit(EventTypes.CORE_STARTED, {
    startedAt: state.startedAt,
    version: '1.0.0'
  });
  
  // =========================================================================
  // SERVICE MANAGER
  // =========================================================================
  
  const serviceManager = getServiceManager();
  
  // Sync legacy services array with ServiceManager
  const syncServices = () => {
    const status = serviceManager.getStatus();
    state.services = Object.entries(status.services).map(([name, svc]) => ({
      name,
      meta: svc.metadata || {},
      status: svc.state,
      registeredAt: svc.startTime || svc.createdAt
    }));
  };
  
  // Subscribe to service events
  eventBus.subscribe(EventTypes.SERVICE_REGISTERED, ({ service, metadata }) => {
    state.services.push({
      name: service,
      meta: metadata || {},
      status: ServiceState.READY,
      registeredAt: new Date().toISOString()
    });
  });
  
  eventBus.subscribe(EventTypes.SERVICE_STARTED, ({ service, startTime }) => {
    const svc = state.services.find(s => s.name === service);
    if (svc) {
      svc.status = ServiceState.RUNNING;
      svc.startedAt = startTime;
    }
  });
  
  eventBus.subscribe(EventTypes.SERVICE_STOPPED, ({ service }) => {
    const svc = state.services.find(s => s.name === service);
    if (svc) {
      svc.status = ServiceState.STOPPED;
    }
  });
  
  // =========================================================================
  // MODULE REGISTRY
  // =========================================================================
  
  const moduleStore = {};
  
  function registerModule(name, instance) {
    moduleStore[name] = instance;
    eventBus.emit(EventTypes.MODULE_LOADED, { name, module: instance });
  }
  
  function getModule(name) {
    return moduleStore[name] || null;
  }
  
  function listModules() {
    return Object.keys(moduleStore);
  }
  
  // =========================================================================
  // IDENTITY MANAGER
  // =========================================================================
  
  let identityManager = null;
  let unifiedIdentity = null;
  
  if (identity && ecdh) {
    unifiedIdentity = new Identity({
      ed25519: identity,
      x25519: ecdh,
      masterKey
    });
  }
  
  // =========================================================================
  // CHANNEL MANAGER
  // =========================================================================
  
  const channelManager = getChannelManager({
    identity: unifiedIdentity
  });
  
  // =========================================================================
  // TRUST STORE
  // =========================================================================
  
  function getTrust() {
    return state.trust || { peers: [] };
  }
  
  function addPeer(id, pubkey) {
    if (!state.trust.peers) {
      state.trust.peers = [];
    }
    
    // Check for duplicate
    const existing = state.trust.peers.find(p => p.id === id);
    if (existing) {
      return { success: false, error: 'Peer already exists' };
    }
    
    state.trust.peers.push({
      id,
      pubkey,
      addedAt: new Date().toISOString()
    });
    
    eventBus.emit(EventTypes.TRUST_PEER_ADDED, { id, pubkey });
    
    return { success: true, id };
  }
  
  function removePeer(id) {
    if (!state.trust.peers) {
      return { success: false, error: 'No peers' };
    }
    
    const index = state.trust.peers.findIndex(p => p.id === id);
    if (index === -1) {
      return { success: false, error: 'Peer not found' };
    }
    
    state.trust.peers.splice(index, 1);
    eventBus.emit(EventTypes.TRUST_PEER_REMOVED, { id });
    
    return { success: true, id };
  }
  
  // =========================================================================
  // IDENTITY / CRYPTO
  // =========================================================================
  
  function getNodeId() {
    return unifiedIdentity?.getNodeId() || state.identity?.public || null;
  }
  
  function getIdentity() {
    return state.identity;
  }
  
  function getECDH() {
    return state.ecdh;
  }
  
  function getIdentityInfo() {
    return {
      node_id: getNodeId(),
      ed25519_public: state.identity?.public || null,
      x25519_public: state.ecdh?.public || null
    };
  }
  
  // =========================================================================
  // RUNTIME INFO
  // =========================================================================
  
  function getRuntimeInfo() {
    const now = Date.now();
    const started = new Date(state.startedAt).getTime();
    const serviceStatus = serviceManager.getStatus();
    
    return {
      startedAt: state.startedAt,
      uptime_ms: now - started,
      serviceCount: state.services.length,
      servicesRunning: serviceStatus.running,
      servicesStopped: serviceStatus.stopped,
      channelCount: channelManager.list().length,
      eventStats: eventBus.getStats()
    };
  }
  
  // =========================================================================
  // SERVICE REGISTRY (legacy support)
  // =========================================================================
  
  function registerService(name, meta = {}) {
    // Register with ServiceManager
    serviceManager.register(name, {
      metadata: meta,
      autoStart: false
    });
    
    // Also update legacy array
    state.services.push({
      name,
      meta,
      registeredAt: new Date().toISOString()
    });
    
    eventBus.emit(EventTypes.SERVICE_REGISTERED, { name, meta });
  }
  
  function getServices() {
    return state.services;
  }
  
  // =========================================================================
  // PLUGIN LOADER
  // =========================================================================

  const pluginLoader = getPluginLoader({ supervisor: null, storage: null });

  async function initPlugins() {
    await pluginLoader.init();
    await pluginLoader.loadAll();
    return pluginLoader;
  }

  async function startPlugins() {
    const plugins = pluginLoader.listPlugins();
    for (const plugin of plugins) {
      try {
        await pluginLoader.startPlugin(plugin.id);
      } catch (error) {
        console.error(`[supervisor] Failed to start plugin ${plugin.id}:`, error.message);
      }
    }
  }

  async function stopPlugins() {
    await pluginLoader.shutdown();
  }

  function getPluginLoader() {
    return pluginLoader;
  }

  function getPluginStatus() {
    return pluginLoader.getStatus();
  }

  // =========================================================================
  // UNIFIED STATE API
  // =========================================================================

  async function getState() {
    const serviceStatus = serviceManager.getStatus();
    const channelStatus = channelManager.getStatus();
    const pluginStatus = pluginLoader.getStatus();

    return {
      startedAt: state.startedAt,
      runtime: getRuntimeInfo(),
      identity: getIdentityInfo(),
      ecdh: state.ecdh,
      trust: getTrust(),
      services: state.services,
      serviceStats: {
        total: serviceStatus.total,
        running: serviceStatus.running,
        stopped: serviceStatus.stopped
      },
      channels: {
        total: channelStatus.total,
        open: channelStatus.open
      },
      plugins: {
        total: pluginStatus.total,
        running: pluginStatus.running,
        stopped: pluginStatus.stopped,
        error: pluginStatus.error
      },
      masterKeyLoaded: state.masterKeyLoaded,
      trustLoaded: state.trustLoaded
    };
  }
  
  // =========================================================================
  // PUBLIC API
  // =========================================================================

  return {
    // Event bus
    eventBus,
    emit: eventBus.emit.bind(eventBus),
    subscribe: eventBus.subscribe.bind(eventBus),
    unsubscribe: eventBus.unsubscribe.bind(eventBus),

    // Service manager
    serviceManager,
    registerService,
    getServices,

    // Service lifecycle
    startService: (name, context) => serviceManager.start(name, context),
    stopService: (name, reason) => serviceManager.stop(name, reason),
    restartService: (name, reason) => serviceManager.restart(name, reason),
    getServiceStatus: () => serviceManager.getStatus(),

    // Module registry
    modules: {
      registerModule,
      getModule,
      listModules
    },

    // Identity
    identity: unifiedIdentity,
    getNodeId,
    getIdentity,
    getECDH,
    getIdentityInfo,

    // Trust
    getTrust,
    addPeer,
    removePeer,

    // Channels
    channelManager,
    openChannel: (peerId, options) => channelManager.open(peerId, options),
    closeChannel: (peerId, reason) => channelManager.close(peerId, reason),
    getChannelStatus: () => channelManager.getStatus(),

    // Plugins
    pluginLoader,
    initPlugins,
    startPlugins,
    stopPlugins,
    getPluginStatus,

    // Runtime
    getRuntimeInfo,

    // Unified state
    getState
  };
}
