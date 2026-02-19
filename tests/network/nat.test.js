// Module: NAT Tests
// Description: Unit tests for NAT traversal components.
// File: tests/network/nat.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import components
import {
  NATType,
  NATBehavior,
  NATEvents,
  STUNMessageType,
  STUNAttribute,
  STUN_MAGIC_COOKIE,
  DEFAULT_STUN_SERVERS
} from '../../network/nat/constants.js';

import { STUNClient } from '../../network/nat/stun-client.js';
import { NATDetector } from '../../network/nat/nat-detector.js';
import { UPnPClient, UPnPEvents } from '../../network/nat/upnp-client.js';
import { HolePuncher, HolePunchEvents } from '../../network/nat/hole-puncher.js';

// ============================================
// Constants Tests
// ============================================

describe('NAT Constants', () => {
  describe('NATType', () => {
    it('should define all NAT types', () => {
      expect(NATType.UNKNOWN).toBe('unknown');
      expect(NATType.NO_NAT).toBe('no_nat');
      expect(NATType.FULL_CONE).toBe('full_cone');
      expect(NATType.RESTRICTED_CONE).toBe('restricted_cone');
      expect(NATType.PORT_RESTRICTED).toBe('port_restricted');
      expect(NATType.SYMMETRIC).toBe('symmetric');
      expect(NATType.BLOCKED).toBe('blocked');
    });
  });

  describe('STUNMessageType', () => {
    it('should define STUN message types', () => {
      expect(STUNMessageType.BINDING_REQUEST).toBe(0x0001);
      expect(STUNMessageType.BINDING_SUCCESS).toBe(0x0101);
      expect(STUNMessageType.BINDING_ERROR).toBe(0x0111);
    });
  });

  describe('STUNAttribute', () => {
    it('should define STUN attributes', () => {
      expect(STUNAttribute.MAPPED_ADDRESS).toBe(0x0001);
      expect(STUNAttribute.XOR_MAPPED_ADDRESS).toBe(0x0020);
      expect(STUNAttribute.SOFTWARE).toBe(0x8022);
    });
  });

  describe('STUN_MAGIC_COOKIE', () => {
    it('should have correct magic cookie value', () => {
      expect(STUN_MAGIC_COOKIE).toBe(0x2112A442);
    });
  });

  describe('DEFAULT_STUN_SERVERS', () => {
    it('should have default STUN servers', () => {
      expect(DEFAULT_STUN_SERVERS.length).toBeGreaterThan(0);
      expect(DEFAULT_STUN_SERVERS[0]).toHaveProperty('host');
      expect(DEFAULT_STUN_SERVERS[0]).toHaveProperty('port');
    });
  });
});

// ============================================
// STUN Client Tests
// ============================================

describe('STUNClient', () => {
  let client;

  beforeEach(() => {
    client = new STUNClient();
  });

  afterEach(async () => {
    if (client) {
      await client.stop().catch(() => {});
    }
  });

  describe('constructor', () => {
    it('should create client with default options', () => {
      expect(client.options.timeout).toBe(5000);
      expect(client.options.retries).toBe(3);
    });

    it('should accept custom options', () => {
      const customClient = new STUNClient({ timeout: 10000, retries: 5 });
      expect(customClient.options.timeout).toBe(10000);
      expect(customClient.options.retries).toBe(5);
    });
  });

  describe('_generateTransactionId', () => {
    it('should generate 12-byte transaction ID', () => {
      const id = client._generateTransactionId();
      expect(id.length).toBe(12);
    });

    it('should generate unique IDs', () => {
      const id1 = client._generateTransactionId();
      const id2 = client._generateTransactionId();
      expect(id1.equals(id2)).toBe(false);
    });
  });

  describe('_createBindingRequest', () => {
    it('should create valid binding request', () => {
      const transactionId = client._generateTransactionId();
      const request = client._createBindingRequest(transactionId);
      
      // Check message type
      expect(request.readUInt16BE(0)).toBe(STUNMessageType.BINDING_REQUEST);
      
      // Check magic cookie
      expect(request.readUInt32BE(4)).toBe(STUN_MAGIC_COOKIE);
      
      // Check transaction ID
      expect(request.slice(8, 20).equals(transactionId)).toBe(true);
    });
  });

  describe('_parseMappedAddress', () => {
    it('should parse IPv4 address', () => {
      const value = Buffer.alloc(8);
      value.writeUInt8(0, 0); // reserved
      value.writeUInt8(1, 1); // family = IPv4
      value.writeUInt16BE(12345, 2); // port
      value.writeUInt8(192, 4);
      value.writeUInt8(168, 5);
      value.writeUInt8(1, 6);
      value.writeUInt8(100, 7);
      
      const result = client._parseMappedAddress(value);
      
      expect(result.family).toBe(1);
      expect(result.port).toBe(12345);
      expect(result.address).toBe('192.168.1.100');
    });
  });

  describe('_parseXorMappedAddress', () => {
    it('should parse XOR-mapped IPv4 address', () => {
      const transactionId = client._generateTransactionId();
      
      // Create XOR'd address
      const originalPort = 12345;
      const originalIP = [192, 168, 1, 100];
      
      const value = Buffer.alloc(8);
      value.writeUInt8(0, 0); // reserved
      value.writeUInt8(1, 1); // family = IPv4
      
      // XOR port with magic cookie
      const xoredPort = originalPort ^ (STUN_MAGIC_COOKIE >> 16);
      value.writeUInt16BE(xoredPort, 2);
      
      // XOR address with magic cookie
      const magicBuffer = Buffer.alloc(4);
      magicBuffer.writeUInt32BE(STUN_MAGIC_COOKIE, 0);
      
      for (let i = 0; i < 4; i++) {
        value[4 + i] = originalIP[i] ^ magicBuffer[i];
      }
      
      const result = client._parseXorMappedAddress(value, transactionId);
      
      expect(result.family).toBe(1);
      expect(result.port).toBe(originalPort);
      expect(result.address).toBe('192.168.1.100');
    });
  });

  describe('start/stop', () => {
    it('should start and stop client', async () => {
      await client.start();
      expect(client._isRunning).toBe(true);
      
      await client.stop();
      expect(client._isRunning).toBe(false);
    });
  });
});

// ============================================
// NAT Detector Tests
// ============================================

describe('NATDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new NATDetector();
  });

  describe('constructor', () => {
    it('should create detector with default options', () => {
      expect(detector.options.timeout).toBe(5000);
      expect(detector.options.stunServers.length).toBeGreaterThan(0);
    });
  });

  describe('_isPublicIP', () => {
    it('should identify private IP addresses', () => {
      expect(detector._isPublicIP('10.0.0.1')).toBe(false);
      expect(detector._isPublicIP('10.255.255.255')).toBe(false);
      expect(detector._isPublicIP('172.16.0.1')).toBe(false);
      expect(detector._isPublicIP('172.31.255.255')).toBe(false);
      expect(detector._isPublicIP('192.168.1.1')).toBe(false);
      expect(detector._isPublicIP('127.0.0.1')).toBe(false);
      expect(detector._isPublicIP('169.254.1.1')).toBe(false);
    });

    it('should identify public IP addresses', () => {
      expect(detector._isPublicIP('8.8.8.8')).toBe(true);
      expect(detector._isPublicIP('1.1.1.1')).toBe(true);
      expect(detector._isPublicIP('93.184.216.34')).toBe(true);
    });
  });

  describe('_canHolePunch', () => {
    it('should return true for cone NATs', () => {
      expect(detector._canHolePunch(NATType.NO_NAT)).toBe(true);
      expect(detector._canHolePunch(NATType.FULL_CONE)).toBe(true);
      expect(detector._canHolePunch(NATType.RESTRICTED_CONE)).toBe(true);
      expect(detector._canHolePunch(NATType.PORT_RESTRICTED)).toBe(true);
    });

    it('should return false for symmetric NAT', () => {
      expect(detector._canHolePunch(NATType.SYMMETRIC)).toBe(false);
    });

    it('should return false for unknown/blocked', () => {
      expect(detector._canHolePunch(NATType.UNKNOWN)).toBe(false);
      expect(detector._canHolePunch(NATType.BLOCKED)).toBe(false);
    });
  });
});

// ============================================
// UPnP Client Tests
// ============================================

describe('UPnPClient', () => {
  let client;

  beforeEach(() => {
    client = new UPnPClient();
  });

  describe('constructor', () => {
    it('should create client with default options', () => {
      expect(client.options.searchTimeout).toBe(5000);
      expect(client.options.portMappingLease).toBe(3600);
    });
  });

  describe('getMappings', () => {
    it('should return empty array initially', () => {
      expect(client.getMappings()).toEqual([]);
    });
  });

  describe('events', () => {
    it('should have UPnP events defined', () => {
      expect(UPnPEvents.GATEWAY_FOUND).toBe('gateway_found');
      expect(UPnPEvents.MAPPING_ADDED).toBe('mapping_added');
      expect(UPnPEvents.MAPPING_REMOVED).toBe('mapping_removed');
      expect(UPnPEvents.ERROR).toBe('error');
    });
  });
});

// ============================================
// Hole Puncher Tests
// ============================================

describe('HolePuncher', () => {
  let puncher;

  beforeEach(() => {
    puncher = new HolePuncher();
  });

  afterEach(() => {
    puncher.stop();
  });

  describe('constructor', () => {
    it('should create puncher with default options', () => {
      expect(puncher.options.timeout).toBe(30000);
      expect(puncher.options.punchInterval).toBe(100);
      expect(puncher.options.maxPunches).toBe(100);
    });
  });

  describe('canPunch', () => {
    it('should return false for two symmetric NATs', () => {
      const result = puncher.canPunch(NATType.SYMMETRIC, NATType.SYMMETRIC);
      expect(result.possible).toBe(false);
      expect(result.reason).toContain('relay');
    });

    it('should return true for cone NATs', () => {
      const result = puncher.canPunch(NATType.FULL_CONE, NATType.PORT_RESTRICTED);
      expect(result.possible).toBe(true);
      expect(result.difficulty).toBe('easy');
    });

    it('should return hard for one symmetric NAT', () => {
      const result = puncher.canPunch(NATType.SYMMETRIC, NATType.FULL_CONE);
      expect(result.possible).toBe(true);
      expect(result.difficulty).toBe('hard');
    });
  });

  describe('stop', () => {
    it('should stop punching', () => {
      puncher._isPunching = true;
      puncher.stop();
      expect(puncher._isPunching).toBe(false);
    });
  });

  describe('events', () => {
    it('should have hole punch events defined', () => {
      expect(HolePunchEvents.CONNECTED).toBe('connected');
      expect(HolePunchEvents.FAILED).toBe('failed');
      expect(HolePunchEvents.PROGRESS).toBe('progress');
      expect(HolePunchEvents.ERROR).toBe('error');
    });
  });
});

// ============================================
// Integration Tests
// ============================================

describe('NAT Integration', () => {
  it('should correctly identify NAT types hierarchy', () => {
    const natDifficulty = [
      { type: NATType.NO_NAT, canPunch: true },
      { type: NATType.FULL_CONE, canPunch: true },
      { type: NATType.RESTRICTED_CONE, canPunch: true },
      { type: NATType.PORT_RESTRICTED, canPunch: true },
      { type: NATType.SYMMETRIC, canPunch: true } // One symmetric can still punch if remote is cone
    ];
    
    const puncher = new HolePuncher();
    
    for (const nat of natDifficulty) {
      const result = puncher.canPunch(nat.type, NATType.FULL_CONE);
      expect(result.possible).toBe(true);
    }
    
    // Two symmetric NATs cannot punch
    const symmetricResult = puncher.canPunch(NATType.SYMMETRIC, NATType.SYMMETRIC);
    expect(symmetricResult.possible).toBe(false);
  });

  it('should create valid STUN request structure', () => {
    const client = new STUNClient();
    const transactionId = client._generateTransactionId();
    const request = client._createBindingRequest(transactionId);
    
    // Verify structure
    expect(request.length).toBeGreaterThanOrEqual(20); // Minimum STUN header
    
    // Verify magic cookie at correct position
    expect(request.readUInt32BE(4)).toBe(STUN_MAGIC_COOKIE);
    
    // Verify transaction ID
    const extractedId = request.slice(8, 20);
    expect(extractedId.equals(transactionId)).toBe(true);
  });
});
