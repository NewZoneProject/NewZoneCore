// Module: mDNS Responder
// Description: mDNS/Bonjour service discovery for local network.
// File: network/discovery/mdns-responder.js

import dgram from 'dgram';
import { EventEmitter } from 'events';

/**
 * mDNS Constants
 */
const MDNS_PORT = 5353;
const MDNS_GROUP = '224.0.0.251';
const MDNS_TTL = 255;

/**
 * DNS Record Types
 */
const DNSRecordType = {
  A: 1,           // IPv4 address
  AAAA: 28,       // IPv6 address
  PTR: 12,        // Pointer record
  TXT: 16,        // Text record
  SRV: 33         // Service record
};

/**
 * DNS Classes
 */
const DNSClass = {
  IN: 1,
  IN_CACHE_FLUSH: 0x8001
};

/**
 * mDNS Events
 */
export const MDNSEvents = {
  SERVICE_FOUND: 'service_found',
  SERVICE_LOST: 'service_lost',
  ANNOUNCED: 'announced',
  ERROR: 'error'
};

/**
 * mDNS Responder Options
 */
const DEFAULT_OPTIONS = {
  serviceName: '_newzone._tcp',
  serviceDomain: 'local',
  port: 9030,
  interval: 60000,     // Re-announce interval
  ttl: 4500,           // Record TTL in seconds
  txtRecords: {}
};

/**
 * mDNSResponder class - implements mDNS/Bonjour discovery
 */
export class mDNSResponder extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_OPTIONS, ...options };
    
    // Service info
    this._serviceName = this.options.serviceName;
    this._instanceName = this.options.instanceName || `newzone-${Date.now().toString(36)}`;
    this._port = this.options.port;
    this._txtRecords = this.options.txtRecords;
    
    // Socket
    this._socket = null;
    
    // Discovered services
    this._services = new Map();
    
    // State
    this._isRunning = false;
    this._announceTimer = null;
  }

  /**
   * Get service name
   */
  get serviceName() {
    return this._serviceName;
  }

  /**
   * Get instance name
   */
  get instanceName() {
    return this._instanceName;
  }

  /**
   * Get discovered services
   */
  get services() {
    return Array.from(this._services.values());
  }

  /**
   * Set instance name
   */
  setInstanceName(name) {
    this._instanceName = name;
  }

  /**
   * Set TXT records
   */
  setTxtRecords(records) {
    this._txtRecords = { ...this._txtRecords, ...records };
  }

  /**
   * Start mDNS responder
   */
  async start() {
    if (this._isRunning) return;
    
    return new Promise((resolve, reject) => {
      this._socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      
      this._socket.on('error', (err) => {
        this.emit(MDNSEvents.ERROR, err);
        reject(err);
      });
      
      this._socket.on('message', (msg, rinfo) => {
        this._handleMessage(msg, rinfo);
      });
      
      this._socket.bind(MDNS_PORT, () => {
        // Join multicast group
        this._socket.addMembership(MDNS_GROUP);
        this._socket.setMulticastTTL(MDNS_TTL);
        this._socket.setMulticastLoopback(true);
        
        this._isRunning = true;
        
        // Announce service
        this._announce();
        
        // Start periodic announcements
        this._announceTimer = setInterval(() => {
          this._announce();
        }, this.options.interval);
        
        resolve();
      });
    });
  }

  /**
   * Stop mDNS responder
   */
  async stop() {
    if (!this._isRunning) return;
    
    // Send goodbye packet
    this._goodbye();
    
    if (this._announceTimer) {
      clearInterval(this._announceTimer);
      this._announceTimer = null;
    }
    
    return new Promise((resolve) => {
      this._socket.close(() => {
        this._isRunning = false;
        this._socket = null;
        resolve();
      });
    });
  }

  /**
   * Check if running
   */
  get isRunning() {
    return this._isRunning;
  }

  /**
   * Announce service
   */
  _announce() {
    const packet = this._createAnnouncePacket();
    this._sendPacket(packet);
    
    this.emit(MDNSEvents.ANNOUNCED, {
      instanceName: this._instanceName,
      serviceName: this._serviceName,
      port: this._port
    });
  }

  /**
   * Send goodbye packet
   */
  _goodbye() {
    const packet = this._createGoodbyePacket();
    this._sendPacket(packet);
  }

  /**
   * Create announce packet
   */
  _createAnnouncePacket() {
    const buffers = [];
    
    // DNS Header
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0, 0);     // Transaction ID (0 for mDNS)
    header.writeUInt16BE(0x8400, 2); // Flags: Response, Authoritative
    header.writeUInt16BE(0, 4);     // Questions
    header.writeUInt16BE(4, 6);     // Answers (PTR, SRV, TXT, A)
    header.writeUInt16BE(0, 8);     // Authority
    header.writeUInt16BE(0, 10);    // Additional
    buffers.push(header);
    
    // PTR record
    buffers.push(this._createPTRRecord());
    
    // SRV record
    buffers.push(this._createSRVRecord());
    
    // TXT record
    buffers.push(this._createTXTRecord());
    
    // A record (IP address)
    buffers.push(this._createARecord());
    
    return Buffer.concat(buffers);
  }

  /**
   * Create goodbye packet
   */
  _createGoodbyePacket() {
    const buffers = [];
    
    // DNS Header
    const header = Buffer.alloc(12);
    header.writeUInt16BE(0, 0);
    header.writeUInt16BE(0x8400, 2);
    header.writeUInt16BE(0, 4);
    header.writeUInt16BE(1, 6);     // Just PTR for goodbye
    header.writeUInt16BE(0, 8);
    header.writeUInt16BE(0, 10);
    buffers.push(header);
    
    // PTR record with TTL 0
    buffers.push(this._createPTRRecord(0));
    
    return Buffer.concat(buffers);
  }

  /**
   * Create PTR record
   */
  _createPTRRecord(ttl = this.options.ttl) {
    const parts = [];
    
    // Name: _service._proto.local
    parts.push(this._encodeName(`${this._serviceName}.${this.options.serviceDomain}`));
    
    // Type (PTR = 12)
    const type = Buffer.alloc(2);
    type.writeUInt16BE(DNSRecordType.PTR);
    parts.push(type);
    
    // Class
    const cls = Buffer.alloc(2);
    cls.writeUInt16BE(DNSClass.IN);
    parts.push(cls);
    
    // TTL
    const ttlBuffer = Buffer.alloc(4);
    ttlBuffer.writeUInt32BE(ttl);
    parts.push(ttlBuffer);
    
    // Data length (will be calculated)
    const instanceFQDN = `${this._instanceName}.${this._serviceName}.${this.options.serviceDomain}`;
    const instanceName = this._encodeName(instanceFQDN);
    
    const rdlength = Buffer.alloc(2);
    rdlength.writeUInt16BE(instanceName.length);
    parts.push(rdlength);
    
    // RDATA
    parts.push(instanceName);
    
    return Buffer.concat(parts);
  }

  /**
   * Create SRV record
   */
  _createSRVRecord() {
    const parts = [];
    
    // Name
    parts.push(this._encodeName(`${this._instanceName}.${this._serviceName}.${this.options.serviceDomain}`));
    
    // Type (SRV = 33)
    const type = Buffer.alloc(2);
    type.writeUInt16BE(DNSRecordType.SRV);
    parts.push(type);
    
    // Class
    const cls = Buffer.alloc(2);
    cls.writeUInt16BE(DNSClass.IN_CACHE_FLUSH);
    parts.push(cls);
    
    // TTL
    const ttl = Buffer.alloc(4);
    ttl.writeUInt32BE(this.options.ttl);
    parts.push(ttl);
    
    // Data
    const target = this._encodeName(`${this._instanceName}.${this.options.serviceDomain}`);
    const rdlength = Buffer.alloc(2);
    rdlength.writeUInt16BE(6 + target.length); // priority + weight + port + target
    parts.push(rdlength);
    
    // Priority
    const priority = Buffer.alloc(2);
    priority.writeUInt16BE(0);
    parts.push(priority);
    
    // Weight
    const weight = Buffer.alloc(2);
    weight.writeUInt16BE(0);
    parts.push(weight);
    
    // Port
    const port = Buffer.alloc(2);
    port.writeUInt16BE(this._port);
    parts.push(port);
    
    // Target
    parts.push(target);
    
    return Buffer.concat(parts);
  }

  /**
   * Create TXT record
   */
  _createTXTRecord() {
    const parts = [];
    
    // Name
    parts.push(this._encodeName(`${this._instanceName}.${this._serviceName}.${this.options.serviceDomain}`));
    
    // Type (TXT = 16)
    const type = Buffer.alloc(2);
    type.writeUInt16BE(DNSRecordType.TXT);
    parts.push(type);
    
    // Class
    const cls = Buffer.alloc(2);
    cls.writeUInt16BE(DNSClass.IN_CACHE_FLUSH);
    parts.push(cls);
    
    // TTL
    const ttl = Buffer.alloc(4);
    ttl.writeUInt32BE(this.options.ttl);
    parts.push(ttl);
    
    // TXT data
    const txtData = this._encodeTXTData(this._txtRecords);
    const rdlength = Buffer.alloc(2);
    rdlength.writeUInt16BE(txtData.length);
    parts.push(rdlength);
    parts.push(txtData);
    
    return Buffer.concat(parts);
  }

  /**
   * Create A record
   */
  _createARecord() {
    const parts = [];
    
    // Name
    parts.push(this._encodeName(`${this._instanceName}.${this.options.serviceDomain}`));
    
    // Type (A = 1)
    const type = Buffer.alloc(2);
    type.writeUInt16BE(DNSRecordType.A);
    parts.push(type);
    
    // Class
    const cls = Buffer.alloc(2);
    cls.writeUInt16BE(DNSClass.IN_CACHE_FLUSH);
    parts.push(cls);
    
    // TTL
    const ttl = Buffer.alloc(4);
    ttl.writeUInt32BE(this.options.ttl);
    parts.push(ttl);
    
    // RDLength
    const rdlength = Buffer.alloc(2);
    rdlength.writeUInt16BE(4);
    parts.push(rdlength);
    
    // IP address (127.0.0.1 for now - should be actual IP)
    const ip = Buffer.alloc(4);
    ip.writeUInt8(127, 0);
    ip.writeUInt8(0, 1);
    ip.writeUInt8(0, 2);
    ip.writeUInt8(1, 3);
    parts.push(ip);
    
    return Buffer.concat(parts);
  }

  /**
   * Encode DNS name
   */
  _encodeName(name) {
    const parts = name.split('.');
    const buffers = [];
    
    for (const part of parts) {
      const label = Buffer.alloc(1 + part.length);
      label.writeUInt8(part.length, 0);
      Buffer.from(part).copy(label, 1);
      buffers.push(label);
    }
    
    // Null terminator
    buffers.push(Buffer.alloc(1));
    
    return Buffer.concat(buffers);
  }

  /**
   * Encode TXT data
   */
  _encodeTXTData(records) {
    const buffers = [];
    
    for (const [key, value] of Object.entries(records)) {
      const str = `${key}=${value}`;
      const len = Buffer.alloc(1);
      len.writeUInt8(str.length);
      buffers.push(len);
      buffers.push(Buffer.from(str));
    }
    
    // Empty if no records
    if (buffers.length === 0) {
      buffers.push(Buffer.from([0]));
    }
    
    return Buffer.concat(buffers);
  }

  /**
   * Send packet
   */
  _sendPacket(packet) {
    if (!this._socket) return;
    
    this._socket.send(packet, MDNS_PORT, MDNS_GROUP, (err) => {
      if (err) {
        this.emit(MDNSEvents.ERROR, err);
      }
    });
  }

  /**
   * Handle incoming mDNS message
   */
  _handleMessage(msg, rinfo) {
    // Skip our own messages
    if (rinfo.address === this._getLocalIP()) {
      return;
    }
    
    try {
      const parsed = this._parseMessage(msg);
      
      // Look for our service type
      for (const answer of parsed.answers) {
        if (answer.name && answer.name.includes(this._serviceName)) {
          this._handleServiceAnswer(answer, rinfo);
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  /**
   * Handle service answer
   */
  _handleServiceAnswer(answer, rinfo) {
    if (answer.type === DNSRecordType.PTR) {
      // Found a service
      const instanceName = answer.data;
      
      if (!this._services.has(instanceName)) {
        const service = {
          name: instanceName,
          address: rinfo.address,
          port: null,
          discovered: Date.now(),
          lastSeen: Date.now()
        };
        
        this._services.set(instanceName, service);
        
        this.emit(MDNSEvents.SERVICE_FOUND, service);
      } else {
        // Update last seen
        this._services.get(instanceName).lastSeen = Date.now();
      }
    } else if (answer.type === DNSRecordType.SRV) {
      // SRV record with port info
      // Update existing service or store for later
    }
  }

  /**
   * Parse DNS message
   */
  _parseMessage(msg) {
    // Simplified parser
    const header = {
      id: msg.readUInt16BE(0),
      flags: msg.readUInt16BE(2),
      qdcount: msg.readUInt16BE(4),
      ancount: msg.readUInt16BE(6),
      nscount: msg.readUInt16BE(8),
      arcount: msg.readUInt16BE(10)
    };
    
    return {
      header,
      questions: [],
      answers: [],
      authorities: [],
      additional: []
    };
  }

  /**
   * Get local IP (simplified)
   */
  _getLocalIP() {
    return '127.0.0.1';
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      isRunning: this._isRunning,
      serviceName: this._serviceName,
      instanceName: this._instanceName,
      port: this._port,
      discoveredServices: this._services.size
    };
  }
}

export default mDNSResponder;
