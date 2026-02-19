// Module: Hole Puncher
// Description: UDP/TCP hole punching for NAT traversal.
// File: network/nat/hole-puncher.js

import dgram from 'dgram';
import net from 'net';
import { EventEmitter } from 'events';
import { NATType } from './constants.js';

/**
 * Hole Puncher Options
 */
const DEFAULT_OPTIONS = {
  timeout: 30000,
  punchInterval: 100,
  maxPunches: 100,
  stunServers: []
};

/**
 * Hole Puncher Events
 */
export const HolePunchEvents = {
  CONNECTED: 'connected',
  FAILED: 'failed',
  PROGRESS: 'progress',
  ERROR: 'error'
};

/**
 * HolePuncher class - implements hole punching techniques
 */
export class HolePuncher extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // State
    this._socket = null;
    this._isPunching = false;
    this._punchAttempts = 0;
  }

  /**
   * Perform UDP hole punch
   * 
   * @param {Object} localInfo - Local endpoint info
   * @param {Object} remoteInfo - Remote endpoint info { address, port }
   * @param {Object} signallingChannel - Channel to exchange endpoints
   */
  async punchUDP(localInfo, remoteInfo, signallingChannel) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._isPunching = false;
        if (this._socket) {
          this._socket.close();
        }
        this.emit(HolePunchEvents.FAILED, { reason: 'timeout' });
        reject(new Error('Hole punch timeout'));
      }, this.options.timeout);
      
      this._socket = dgram.createSocket('udp4');
      
      // Bind to specified port or random
      this._socket.bind(localInfo.port || 0, () => {
        const address = this._socket.address();
        
        // Notify remote of our endpoint
        if (signallingChannel && signallingChannel.sendEndpoint) {
          signallingChannel.sendEndpoint({
            address: localInfo.externalAddress || address.address,
            port: localInfo.externalPort || address.port
          });
        }
        
        // Start punching
        this._isPunching = true;
        this._punchAttempts = 0;
        
        this._punchLoop(remoteInfo, timeout, resolve);
      });
      
      // Handle incoming connection
      this._socket.on('message', (msg, rinfo) => {
        // Check if it's from our target
        if (rinfo.address === remoteInfo.address && 
            rinfo.port === remoteInfo.port) {
          clearTimeout(timeout);
          this._isPunching = false;
          
          this.emit(HolePunchEvents.CONNECTED, {
            socket: this._socket,
            remoteAddress: rinfo.address,
            remotePort: rinfo.port
          });
          
          resolve({
            socket: this._socket,
            remoteAddress: rinfo.address,
            remotePort: rinfo.port
          });
        }
      });
      
      this._socket.on('error', (err) => {
        clearTimeout(timeout);
        this._isPunching = false;
        this.emit(HolePunchEvents.ERROR, err);
        reject(err);
      });
    });
  }

  /**
   * Punch loop - send packets at interval
   */
  _punchLoop(remoteInfo, timeout, resolve) {
    if (!this._isPunching || this._punchAttempts >= this.options.maxPunches) {
      return;
    }
    
    const punchPacket = Buffer.from('NZPUNCH');
    
    this._socket.send(
      punchPacket,
      remoteInfo.port,
      remoteInfo.address,
      (err) => {
        if (err) {
          this.emit(HolePunchEvents.ERROR, err);
        }
      }
    );
    
    this._punchAttempts++;
    
    this.emit(HolePunchEvents.PROGRESS, {
      attempts: this._punchAttempts,
      maxAttempts: this.options.maxPunches
    });
    
    // Schedule next punch
    setTimeout(() => {
      this._punchLoop(remoteInfo, timeout, resolve);
    }, this.options.punchInterval);
  }

  /**
   * Stop punching
   */
  stop() {
    this._isPunching = false;
    if (this._socket) {
      this._socket.close();
      this._socket = null;
    }
  }

  /**
   * TCP simultaneous open for NAT traversal
   */
  async simultaneousTCPOpen(localPort, remoteInfo) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('TCP simultaneous open timeout'));
      }, this.options.timeout);
      
      const server = net.createServer((socket) => {
        clearTimeout(timeout);
        server.close();
        
        resolve({
          socket,
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort
        });
      });
      
      server.listen(localPort, () => {
        // Simultaneously try to connect
        const client = net.createConnection({
          host: remoteInfo.address,
          port: remoteInfo.port,
          localPort: localPort
        }, () => {
          clearTimeout(timeout);
          server.close();
          
          resolve({
            socket: client,
            remoteAddress: remoteInfo.address,
            remotePort: remoteInfo.port
          });
        });
        
        client.on('error', () => {
          // Ignore connection errors during simultaneous open
          // The server connection might succeed
        });
      });
      
      server.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Check if hole punching is likely to succeed
   */
  canPunch(localNATType, remoteNATType) {
    // Both symmetric NATs usually can't punch
    if (localNATType === NATType.SYMMETRIC && 
        remoteNATType === NATType.SYMMETRIC) {
      return {
        possible: false,
        reason: 'Both endpoints have symmetric NAT - relay required'
      };
    }
    
    // At least one endpoint needs non-symmetric NAT
    if (localNATType === NATType.SYMMETRIC) {
      return {
        possible: true,
        difficulty: 'hard',
        reason: 'Local has symmetric NAT - remote must initiate'
      };
    }
    
    if (remoteNATType === NATType.SYMMETRIC) {
      return {
        possible: true,
        difficulty: 'hard',
        reason: 'Remote has symmetric NAT - local must initiate'
      };
    }
    
    // Both have cone NATs - easy
    return {
      possible: true,
      difficulty: 'easy',
      reason: 'Both endpoints have cone NAT - bidirectional punch possible'
    };
  }
}

/**
 * Coordinate hole punch between two peers
 */
export class PunchCoordinator extends EventEmitter {
  constructor(signallingChannel) {
    super();
    
    this._channel = signallingChannel;
    this._localInfo = null;
    this._remoteInfo = null;
    this._puncher = new HolePuncher();
    
    this._setupChannel();
  }

  /**
   * Setup signalling channel handlers
   */
  _setupChannel() {
    if (this._channel) {
      this._channel.on('endpoint', (endpoint) => {
        this._remoteInfo = endpoint;
        this.emit('remote_endpoint', endpoint);
      });
    }
  }

  /**
   * Start coordinated punch
   */
  async coordinate(localEndpoint, remotePeerId) {
    // Announce our endpoint
    this._localInfo = localEndpoint;
    
    if (this._channel && this._channel.sendEndpoint) {
      await this._channel.sendEndpoint(localEndpoint, remotePeerId);
    }
    
    // Wait for remote endpoint with timeout
    if (!this._remoteInfo) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Remote endpoint timeout'));
        }, 10000);
        
        this.once('remote_endpoint', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    
    // Perform punch
    return this._puncher.punchUDP(
      this._localInfo,
      this._remoteInfo,
      this._channel
    );
  }

  /**
   * Stop coordination
   */
  stop() {
    this._puncher.stop();
  }
}

export default HolePuncher;
