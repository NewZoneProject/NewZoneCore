// Module: Network Layer Main Export
// Description: Main entry point for NewZoneCore network layer.
// File: network/index.js

import { EventEmitter } from 'events';

// Transport Layer
export * from './transport/main.js';
export { TCPTransport } from './transport/tcp-transport.js';
export { WebSocketTransport } from './transport/websocket-transport.js';

// NAT Traversal
export * from './nat/index.js';

// DHT
export * from './dht/index.js';

// Discovery
export { BootstrapManager, BootstrapEvents } from './discovery/bootstrap-nodes.js';
export { PeerDiscovery, PeerDiscoveryEvents, PeerInfo } from './discovery/peer-discovery.js';
export { ServiceRegistry, ServiceRegistryEvents, ServiceInfo } from './discovery/service-registry.js';
export { mDNSResponder, MDNSEvents } from './discovery/mdns-responder.js';

// Import for NetworkManager
import { TCPTransport } from './transport/tcp-transport.js';
import { WebSocketTransport } from './transport/websocket-transport.js';
import { ConnectionPool } from './transport/connection-pool.js';
import { Frame, MessageType } from './transport/message-framing.js';
import { NATManager, NATType } from './nat/index.js';
import { KademliaDHT } from './dht/kademlia.js';
import { NodeID } from './dht/node-id.js';
import { BootstrapManager } from './discovery/bootstrap-nodes.js';
import { PeerDiscovery } from './discovery/peer-discovery.js';
import { ServiceRegistry } from './discovery/service-registry.js';
import { mDNSResponder } from './discovery/mdns-responder.js';

/**
 * Network Manager Events
 */
export const NetworkManagerEvents = {
  STARTED: 'started',
  STOPPED: 'stopped',
  READY: 'ready',
  PEER_CONNECTED: 'peer_connected',
  PEER_DISCONNECTED: 'peer_disconnected',
  PEER_DISCOVERED: 'peer_discovered',
  MESSAGE: 'message',
  ERROR: 'error',
  NAT_DETECTED: 'nat_detected',
  DHT_READY: 'dht_ready'
};

/**
 * Default Network Manager Options
 */
const DEFAULT_NETWORK_OPTIONS = {
  // Transport
  transports: ['tcp'],
  tcp: {
    port: 9030,
    host: '0.0.0.0'
  },
  websocket: {
    port: 9031,
    host: '0.0.0.0',
    path: '/nz'
  },
  
  // Connection Pool
  pool: {
    maxSize: 1000,
    idleTimeout: 300000
  },
  
  // NAT Traversal
  nat: {
    enabled: true,
    stunServers: [
      { host: 'stun.l.google.com', port: 19302 }
    ],
    useUPnP: true,
    autoMap: false
  },
  
  // DHT
  dht: {
    enabled: true,
    k: 20,
    alpha: 3
  },
  
  // Discovery
  discovery: {
    enabled: true,
    bootstrapNodes: [],
    mdns: true,
    serviceName: '_newzone._tcp'
  },
  
  // Service Registry
  registry: {
    enabled: true
  }
};

/**
 * NetworkManager class - unified API for all network operations
 */
export class NetworkManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_NETWORK_OPTIONS, ...options };
    
    // Components
    this._transports = new Map();
    this._pool = null;
    this._nat = null;
    this._dht = null;
    this._bootstrap = null;
    this._discovery = null;
    this._registry = null;
    this._mdns = null;
    
    // State
    this._isStarted = false;
    this._isReady = false;
    this._startedAt = null;
    
    // Node identity
    this.nodeId = options.nodeId || NodeID.random();
  }

  /**
   * Get local node ID
   */
  get localNodeId() {
    return this.nodeId;
  }

  /**
   * Check if network is started
   */
  get isStarted() {
    return this._isStarted;
  }

  /**
   * Check if network is ready
   */
  get isReady() {
    return this._isReady;
  }

  /**
   * Get uptime in seconds
   */
  get uptime() {
    if (!this._startedAt) return 0;
    return Math.floor((Date.now() - this._startedAt) / 1000);
  }

  /**
   * Get connection count
   */
  get connectionCount() {
    return this._pool ? this._pool.size : 0;
  }

  /**
   * Get known peers count
   */
  get peerCount() {
    return this._discovery ? this._discovery.peerCount : 0;
  }

  /**
   * Start the network manager
   */
  async start() {
    if (this._isStarted) {
      throw new Error('Network manager is already started');
    }
    
    try {
      // 1. Initialize connection pool
      this._pool = new ConnectionPool(this.options.pool);
      await this._pool.start();
      
      // 2. Start transports
      await this._startTransports();
      
      // 3. Initialize NAT traversal
      if (this.options.nat.enabled) {
        await this._initializeNAT();
      }
      
      // 4. Initialize DHT
      if (this.options.dht.enabled) {
        await this._initializeDHT();
      }
      
      // 5. Initialize discovery
      if (this.options.discovery.enabled) {
        await this._initializeDiscovery();
      }
      
      // 6. Initialize service registry
      if (this.options.registry.enabled) {
        await this._initializeRegistry();
      }
      
      // 7. Start mDNS
      if (this.options.discovery.mdns) {
        await this._startMDNS();
      }
      
      // 8. Bootstrap
      await this._doBootstrap();
      
      this._isStarted = true;
      this._isReady = true;
      this._startedAt = Date.now();
      
      this.emit(NetworkManagerEvents.READY, {
        nodeId: this.nodeId.hex,
        uptime: 0
      });
      
      return {
        nodeId: this.nodeId.hex,
        transports: this._getTransportInfo(),
        nat: this._nat ? this._nat.getInfo() : null,
        dht: this._dht ? this._dht.getStats() : null
      };
    } catch (err) {
      this.emit(NetworkManagerEvents.ERROR, err);
      throw err;
    }
  }

  /**
   * Stop the network manager
   */
  async stop() {
    if (!this._isStarted) return;
    
    this._isStarted = false;
    this._isReady = false;
    
    // Stop mDNS
    if (this._mdns) {
      await this._mdns.stop();
    }
    
    // Stop discovery
    if (this._discovery) {
      this._discovery.stop();
    }
    
    // Stop registry
    if (this._registry) {
      this._registry.stop();
    }
    
    // Cleanup NAT
    if (this._nat) {
      await this._nat.cleanup();
    }
    
    // Stop transports
    for (const transport of this._transports.values()) {
      await transport.close();
    }
    this._transports.clear();
    
    // Stop pool
    if (this._pool) {
      await this._pool.stop();
    }
    
    this.emit(NetworkManagerEvents.STOPPED);
  }

  /**
   * Connect to a peer
   */
  async connect(address, port, options = {}) {
    const transportType = options.transport || 'tcp';
    const transport = this._transports.get(transportType);
    
    if (!transport) {
      throw new Error(`Transport ${transportType} not available`);
    }
    
    const connection = await transport.connect(address, port);
    
    // Add to pool
    this._pool.add(connection);
    
    // Setup handlers
    this._setupConnectionHandlers(connection);
    
    // Add to discovery
    if (this._discovery && options.nodeId) {
      this._discovery.addPeer({
        id: options.nodeId,
        address,
        port,
        source: 'manual'
      });
    }
    
    this.emit(NetworkManagerEvents.PEER_CONNECTED, {
      connectionId: connection.id,
      address,
      port
    });
    
    return connection;
  }

  /**
   * Disconnect from a peer
   */
  async disconnect(connectionId) {
    await this._pool.remove(connectionId);
  }

  /**
   * Send data to a peer
   */
  async send(connectionId, data, options = {}) {
    const connection = this._pool.get(connectionId);
    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }
    
    const frame = Frame.data(
      Buffer.isBuffer(data) ? data : Buffer.from(data),
      options.flags || 0
    );
    
    return connection.send(frame.toBuffer());
  }

  /**
   * Broadcast to all peers
   */
  async broadcast(data, exclude = []) {
    const frame = Frame.data(Buffer.isBuffer(data) ? data : Buffer.from(data));
    return this._pool.broadcast(frame.toBuffer(), exclude);
  }

  /**
   * Find a peer by ID
   */
  async findPeer(peerId) {
    if (this._dht) {
      const nodes = await this._dht.findNode(peerId);
      return nodes.length > 0 ? nodes[0] : null;
    }
    return null;
  }

  /**
   * Store a value in DHT
   */
  async put(key, value) {
    if (!this._dht) {
      throw new Error('DHT not enabled');
    }
    return this._dht.put(key, value);
  }

  /**
   * Get a value from DHT
   */
  async get(key) {
    if (!this._dht) {
      throw new Error('DHT not enabled');
    }
    return this._dht.get(key);
  }

  /**
   * Register a service
   */
  async registerService(serviceInfo) {
    if (!this._registry) {
      throw new Error('Service registry not enabled');
    }
    return this._registry.register(serviceInfo);
  }

  /**
   * Find services by type
   */
  findServices(type, options = {}) {
    if (!this._registry) {
      return [];
    }
    return this._registry.findByType(type, options);
  }

  /**
   * Get connection by ID
   */
  getConnection(id) {
    return this._pool.get(id);
  }

  /**
   * Get all connections
   */
  getConnections() {
    return this._pool.getAll();
  }

  /**
   * Get peer by ID
   */
  getPeer(peerId) {
    return this._discovery ? this._discovery.getPeer(peerId) : null;
  }

  /**
   * Get all peers
   */
  getPeers() {
    return this._discovery ? this._discovery.peers : [];
  }

  /**
   * Get network statistics
   */
  getStats() {
    return {
      nodeId: this.nodeId.hex,
      isStarted: this._isStarted,
      isReady: this._isReady,
      startedAt: this._startedAt,
      uptime: this.uptime,
      transports: this._getTransportInfo(),
      connections: {
        total: this.connectionCount,
        pool: this._pool ? this._pool.getStats() : null
      },
      peers: {
        total: this.peerCount,
        discovery: this._discovery ? this._discovery.getStats() : null
      },
      nat: this._nat ? this._nat.getInfo() : null,
      dht: this._dht ? this._dht.getStats() : null,
      registry: this._registry ? this._registry.getStats() : null
    };
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Start transports
   */
  async _startTransports() {
    for (const type of this.options.transports) {
      let transport;
      
      if (type === 'tcp') {
        transport = new TCPTransport(this.options.tcp);
        await transport.listen();
        this._transports.set('tcp', transport);
      } else if (type === 'websocket') {
        transport = new WebSocketTransport(this.options.websocket);
        await transport.listen();
        this._transports.set('websocket', transport);
      }
      
      if (transport) {
        transport.on('connection', (event) => {
          this._handleIncomingConnection(event);
        });
      }
    }
  }

  /**
   * Initialize NAT traversal
   */
  async _initializeNAT() {
    this._nat = new NATManager(this.options.nat);
    
    try {
      await this._nat.initialize();
      
      this.emit(NetworkManagerEvents.NAT_DETECTED, {
        type: this._nat.natType,
        externalAddress: this._nat.externalAddress
      });
    } catch (e) {
      // NAT initialization failed, continue
    }
  }

  /**
   * Initialize DHT
   */
  async _initializeDHT() {
    this._dht = new KademliaDHT({
      nodeId: this.nodeId,
      ...this.options.dht
    });
    
    // Set transport for DHT RPC
    if (this._transports.has('tcp')) {
      this._dht._transport = this._transports.get('tcp');
    }
  }

  /**
   * Initialize discovery
   */
  async _initializeDiscovery() {
    this._bootstrapManager = new BootstrapManager();
    this._discovery = new PeerDiscovery();
    
    // Link DHT to discovery
    if (this._dht) {
      this._discovery.setDHT(this._dht);
    }
    
    // Add bootstrap nodes
    for (const node of this.options.discovery.bootstrapNodes) {
      this._bootstrapManager.addNode(node);
    }
  }

  /**
   * Initialize service registry
   */
  async _initializeRegistry() {
    this._registry = new ServiceRegistry();
    this._registry.start();
    
    if (this._dht) {
      this._registry.setDHT(this._dht);
    }
  }

  /**
   * Start mDNS
   */
  async _startMDNS() {
    const tcpTransport = this._transports.get('tcp');
    
    this._mdns = new mDNSResponder({
      port: tcpTransport ? tcpTransport.port : this.options.tcp.port,
      serviceName: this.options.discovery.serviceName,
      instanceName: `node-${this.nodeId.hex.substring(0, 8)}`,
      txtRecords: {
        nodeid: this.nodeId.hex.substring(0, 16),
        version: '0.2.0'
      }
    });
    
    try {
      await this._mdns.start();
    } catch (e) {
      // mDNS not available, continue
    }
  }

  /**
   * Bootstrap to network
   */
  async _doBootstrap() {
    if (this._bootstrapManager && this._transports.has('tcp')) {
      try {
        await this._bootstrapManager.bootstrap(this._transports.get('tcp'));
      } catch (e) {
        // Bootstrap failed, continue
      }
    }
    
    // Start discovery
    if (this._discovery) {
      this._discovery.start();
    }
    
    // Bootstrap DHT
    if (this._dht) {
      const bootstrapNodes = this._bootstrapManager ? 
        this._bootstrapManager.getConnectedNodes().map(n => ({
          id: n.node.id,
          address: n.node.address,
          port: n.node.port
        })) : [];
      
      await this._dht.bootstrap(bootstrapNodes);
      
      this.emit(NetworkManagerEvents.DHT_READY);
    }
  }

  /**
   * Handle incoming connection
   */
  _handleIncomingConnection(event) {
    const { connection } = event;
    
    try {
      this._pool.add(connection);
      this._setupConnectionHandlers(connection);
      
      this.emit(NetworkManagerEvents.PEER_CONNECTED, {
        connectionId: connection.id,
        type: 'incoming',
        remoteAddress: connection.remoteAddress,
        remotePort: connection.remotePort
      });
    } catch (e) {
      connection.close('pool_full');
    }
  }

  /**
   * Setup connection event handlers
   */
  _setupConnectionHandlers(connection) {
    connection.on('frame', (event) => {
      this.emit(NetworkManagerEvents.MESSAGE, {
        connectionId: event.connectionId,
        type: event.type,
        payload: event.payload
      });
    });
    
    connection.on('disconnect', () => {
      this.emit(NetworkManagerEvents.PEER_DISCONNECTED, {
        connectionId: connection.id
      });
    });
  }

  /**
   * Get transport info
   */
  _getTransportInfo() {
    const info = {};
    for (const [name, transport] of this._transports) {
      info[name] = {
        address: transport.address,
        port: transport.port,
        isListening: transport.isListening
      };
    }
    return info;
  }
}

// Default export
export default NetworkManager;
