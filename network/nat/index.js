// Module: NAT Traversal
// Description: Main entry point for NAT traversal components.
// File: network/nat/index.js

// Constants
export * from './constants.js';

// STUN Client
export { STUNClient } from './stun-client.js';

// TURN Client
export { TURNClient, TURNEvents, TURNMethod, TURNMessageType, TURNAttribute, TURNError } from './turn-client.js';

// NAT Detector
export { NATDetector } from './nat-detector.js';

// UPnP Client
export { UPnPClient, UPnPEvents } from './upnp-client.js';

// Hole Puncher
export { HolePuncher, PunchCoordinator, HolePunchEvents } from './hole-puncher.js';

/**
 * NAT Manager - unified API for NAT traversal
 */
import { EventEmitter } from 'events';
import { NATType, NATEvents, DEFAULT_STUN_SERVERS } from './constants.js';
import { STUNClient } from './stun-client.js';
import { NATDetector } from './nat-detector.js';
import { UPnPClient, UPnPEvents } from './upnp-client.js';
import { HolePuncher, HolePunchEvents } from './hole-puncher.js';

/**
 * NAT Manager Events
 */
export const NATManagerEvents = {
  READY: 'ready',
  NAT_DETECTED: 'nat_detected',
  MAPPING_CREATED: 'mapping_created',
  CONNECTION_ESTABLISHED: 'connection_established',
  ERROR: 'error'
};

/**
 * Default NAT Manager Options
 */
const DEFAULT_MANAGER_OPTIONS = {
  stunServers: DEFAULT_STUN_SERVERS,
  useUPnP: true,
  useSTUN: true,
  autoDetect: true,
  autoMap: false,
  portRange: { min: 10000, max: 20000 }
};

/**
 * NATManager class - unified NAT traversal API
 */
export class NATManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_MANAGER_OPTIONS, ...options };
    
    // Components
    this._stunClient = new STUNClient({ stunServers: this.options.stunServers });
    this._detector = new NATDetector({ stunServers: this.options.stunServers });
    this._upnpClient = new UPnPClient();
    this._puncher = new HolePuncher();
    
    // State
    this._natType = NATType.UNKNOWN;
    this._externalAddress = null;
    this._localAddress = null;
    this._isReady = false;
    
    // Mappings
    this._mappings = new Map();
  }

  /**
   * Get NAT type
   */
  get natType() {
    return this._natType;
  }

  /**
   * Get external address
   */
  get externalAddress() {
    return this._externalAddress;
  }

  /**
   * Check if NAT traversal is ready
   */
  get isReady() {
    return this._isReady;
  }

  /**
   * Initialize NAT manager
   */
  async initialize() {
    try {
      // Detect NAT type
      if (this.options.autoDetect) {
        this._natType = await this._detector.detect();
        const info = await this._detector.getInfo();
        this._externalAddress = info.externalAddress;
        this._localAddress = info.localAddress;
        
        this.emit(NATManagerEvents.NAT_DETECTED, {
          type: this._natType,
          externalAddress: this._externalAddress
        });
      }
      
      // Setup UPnP if available and requested
      if (this.options.useUPnP) {
        const upnpAvailable = await this._upnpClient.isAvailable();
        if (upnpAvailable && this.options.autoMap) {
          await this._setupUPnPMapping();
        }
      }
      
      this._isReady = true;
      this.emit(NATManagerEvents.READY, {
        natType: this._natType,
        externalAddress: this._externalAddress
      });
      
      return {
        natType: this._natType,
        externalAddress: this._externalAddress,
        upnpAvailable: await this._upnpClient.isAvailable().catch(() => false)
      };
    } catch (err) {
      this.emit(NATManagerEvents.ERROR, err);
      throw err;
    }
  }

  /**
   * Get public IP via STUN
   */
  async getPublicIP() {
    const server = this.options.stunServers[0];
    await this._stunClient.start();
    try {
      const addr = await this._stunClient.getExternalAddress(server.host, server.port);
      return addr;
    } finally {
      await this._stunClient.stop();
    }
  }

  /**
   * Create port mapping
   */
  async createMapping(internalPort, options = {}) {
    const externalPort = options.externalPort || internalPort;
    
    // Try UPnP first
    if (this.options.useUPnP) {
      try {
        const mapping = await this._upnpClient.addPortMapping(
          internalPort,
          externalPort,
          options
        );
        
        this._mappings.set(mapping.externalPort, mapping);
        this.emit(NATManagerEvents.MAPPING_CREATED, mapping);
        
        return mapping;
      } catch (err) {
        // UPnP failed, continue
      }
    }
    
    // No mapping available
    return null;
  }

  /**
   * Remove port mapping
   */
  async removeMapping(externalPort, protocol = 'TCP') {
    if (this._mappings.has(externalPort)) {
      await this._upnpClient.removePortMapping(externalPort, protocol);
      this._mappings.delete(externalPort);
    }
  }

  /**
   * Establish P2P connection via hole punching
   */
  async establishConnection(remoteInfo, localPort) {
    const punchResult = this._puncher.canPunch(
      this._natType,
      remoteInfo.natType
    );
    
    if (!punchResult.possible) {
      throw new Error(punchResult.reason);
    }
    
    return this._puncher.punchUDP(
      { port: localPort },
      remoteInfo
    );
  }

  /**
   * Get NAT info
   */
  getInfo() {
    return {
      natType: this._natType,
      externalAddress: this._externalAddress,
      localAddress: this._localAddress,
      isReady: this._isReady,
      mappings: Array.from(this._mappings.values()),
      canPunch: this._natType !== NATType.SYMMETRIC,
      requiresRelay: this._natType === NATType.SYMMETRIC
    };
  }

  /**
   * Setup default UPnP mapping
   */
  async _setupUPnPMapping() {
    const port = this._getRandomPort();
    await this.createMapping(port, {
      externalPort: port,
      description: 'NewZoneCore Default'
    });
  }

  /**
   * Get random port from range
   */
  _getRandomPort() {
    const { min, max } = this.options.portRange;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Cleanup
   */
  async cleanup() {
    // Remove all mappings
    for (const [port, mapping] of this._mappings) {
      await this.removeMapping(port, mapping.protocol);
    }
    
    this._puncher.stop();
    await this._stunClient.stop();
  }
}

export default NATManager;
