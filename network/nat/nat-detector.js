// Module: NAT Detector
// Description: Detect NAT type and behavior.
// File: network/nat/nat-detector.js

import { EventEmitter } from 'events';
import { STUNClient } from './stun-client.js';
import { NATType, NATBehavior, NATEvents, DEFAULT_STUN_SERVERS } from './constants.js';

/**
 * NAT Detector Options
 */
const DEFAULT_OPTIONS = {
  stunServers: DEFAULT_STUN_SERVERS,
  timeout: 5000,
  retries: 2
};

/**
 * NATDetector class - detects NAT type using STUN
 */
export class NATDetector extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this._stunClient = new STUNClient(this.options);
    
    // Cached results
    this._natType = NATType.UNKNOWN;
    this._externalAddress = null;
    this._lastDetection = null;
  }

  /**
   * Get detected NAT type
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
   * Detect NAT type
   * 
   * Algorithm based on RFC 3489 (classic STUN)
   * Uses multiple STUN servers to determine NAT behavior
   */
  async detect() {
    // Start STUN client
    await this._stunClient.start();
    
    try {
      const servers = this.options.stunServers;
      
      // Step 1: Get binding from primary server
      const primaryServer = servers[0];
      const binding1 = await this._stunClient.getBinding(primaryServer.host, primaryServer.port);
      
      if (!binding1.mappedAddress) {
        this._natType = NATType.BLOCKED;
        this._emitResult();
        return this._natType;
      }
      
      // Store external address
      this._externalAddress = binding1.mappedAddress;
      
      // Step 2: Compare with local address
      const localAddress = this._stunClient._socket.address();
      const isPublicIP = this._isPublicIP(binding1.mappedAddress.address);
      
      if (isPublicIP && 
          binding1.mappedAddress.address === localAddress.address) {
        this._natType = NATType.NO_NAT;
        this._emitResult();
        return this._natType;
      }
      
      // Step 3: Get binding from secondary server to check if NAT is symmetric
      if (servers.length > 1) {
        const secondaryServer = servers[1];
        const binding2 = await this._stunClient.getBinding(secondaryServer.host, secondaryServer.port);
        
        if (binding2.mappedAddress) {
          // Compare mapped addresses
          const sameIP = binding1.mappedAddress.address === binding2.mappedAddress.address;
          const samePort = binding1.mappedAddress.port === binding2.mappedAddress.port;
          
          if (!sameIP || !samePort) {
            // Different mapping for different destination = Symmetric NAT
            this._natType = NATType.SYMMETRIC;
            this._emitResult();
            return this._natType;
          }
        }
      }
      
      // Step 4: For non-symmetric NAT, determine cone type
      // This requires STUN server support for CHANGE_REQUEST
      // Simplified detection: assume Port Restricted (most common)
      this._natType = NATType.PORT_RESTRICTED;
      
      this._emitResult();
      return this._natType;
      
    } finally {
      await this._stunClient.stop();
    }
  }

  /**
   * Quick check if NAT exists
   */
  async hasNAT() {
    const type = await this.detect();
    return type !== NATType.NO_NAT && type !== NATType.UNKNOWN;
  }

  /**
   * Get detailed NAT info
   */
  async getInfo() {
    const type = await this.detect();
    
    return {
      type,
      externalAddress: this._externalAddress,
      localAddress: this._getLocalAddress(),
      isPublicIP: type === NATType.NO_NAT,
      requiresTraversal: type !== NATType.NO_NAT && type !== NATType.UNKNOWN,
      holePunchingPossible: this._canHolePunch(type),
      relayRequired: type === NATType.SYMMETRIC,
      detected: true,
      timestamp: Date.now()
    };
  }

  /**
   * Check if NAT type supports hole punching
   */
  _canHolePunch(natType) {
    switch (natType) {
      case NATType.NO_NAT:
      case NATType.FULL_CONE:
      case NATType.RESTRICTED_CONE:
      case NATType.PORT_RESTRICTED:
        return true;
      case NATType.SYMMETRIC:
        return false; // Requires relay
      default:
        return false;
    }
  }

  /**
   * Check if IP is public (not private/reserved)
   */
  _isPublicIP(ip) {
    // Check for private IP ranges
    const parts = ip.split('.').map(Number);
    
    // 10.0.0.0/8
    if (parts[0] === 10) return false;
    
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return false;
    
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return false;
    
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return false;
    
    return true;
  }

  /**
   * Get local address
   */
  _getLocalAddress() {
    // This is a simplified version
    // In production, would need to enumerate network interfaces
    return {
      address: '0.0.0.0',
      family: 4
    };
  }

  /**
   * Emit detection result
   */
  _emitResult() {
    this._lastDetection = Date.now();
    
    this.emit(NATEvents.DETECTED, {
      type: this._natType,
      externalAddress: this._externalAddress,
      timestamp: this._lastDetection
    });
  }
}

export default NATDetector;
