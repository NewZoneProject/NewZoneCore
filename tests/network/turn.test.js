// Module: TURN Client Tests
// Description: Unit tests for TURN relay client.
// File: tests/network/turn.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import components
import {
  TURNClient,
  TURNEvents,
  TURNMethod,
  TURNMessageType,
  TURNAttribute,
  TURNError
} from '../../network/nat/turn-client.js';

// ============================================
// TURN Client Tests
// ============================================

describe('TURNClient', () => {
  let client;

  beforeEach(() => {
    client = new TURNClient({
      server: 'turn.example.com',
      port: 3478,
      username: 'testuser',
      password: 'testpass'
    });
  });

  afterEach(async () => {
    if (client) {
      await client.disconnect().catch(() => {});
    }
  });

  describe('constructor', () => {
    it('should create client with options', () => {
      expect(client.options.timeout).toBe(10000);
      expect(client.options.lifetime).toBe(600);
      expect(client._server).toBe('turn.example.com');
      expect(client._port).toBe(3478);
    });

    it('should accept custom options', () => {
      const customClient = new TURNClient({
        timeout: 5000,
        lifetime: 1200
      });
      
      expect(customClient.options.timeout).toBe(5000);
      expect(customClient.options.lifetime).toBe(1200);
    });
  });

  describe('properties', () => {
    it('should have correct initial state', () => {
      expect(client.isAllocated).toBe(false);
      expect(client.allocationState).toBe('none');
      expect(client.relayedAddress).toBeNull();
      expect(client.relayedPort).toBeNull();
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

  describe('_createXorPeerAddress', () => {
    it('should create XOR peer address', () => {
      const addr = client._createXorPeerAddress('192.168.1.1', 12345);
      
      expect(addr.length).toBe(12);
      expect(addr.readUInt16BE(0)).toBe(TURNAttribute.XOR_PEER_ADDRESS);
    });
  });

  describe('events', () => {
    it('should have TURNEvents defined', () => {
      expect(TURNEvents.ALLOCATED).toBe('allocated');
      expect(TURNEvents.REFRESHED).toBe('refreshed');
      expect(TURNEvents.DATA).toBe('data');
      expect(TURNEvents.ERROR).toBe('error');
      expect(TURNEvents.DISCONNECTED).toBe('disconnected');
      expect(TURNEvents.PERMISSION_CREATED).toBe('permission_created');
      expect(TURNEvents.CHANNEL_BOUND).toBe('channel_bound');
    });
  });

  describe('methods (without server)', () => {
    it('should check allocation state', async () => {
      // Just check the initial state, don't try to allocate
      expect(client.isAllocated).toBe(false);
      expect(client.allocationState).toBe('none');
    });

    it('should reject createPermission without allocation', async () => {
      await expect(client.createPermission('192.168.1.1', 9030))
        .rejects.toThrow('No active allocation');
    });

    it('should reject bindChannel without allocation', async () => {
      await expect(client.bindChannel('192.168.1.1', 9030))
        .rejects.toThrow('No active allocation');
    });

    it('should reject send without allocation', async () => {
      await expect(client.send('192.168.1.1', 9030, 'data'))
        .rejects.toThrow('No active allocation');
    });

    it('should reject refresh without allocation', async () => {
      await expect(client.refresh()).rejects.toThrow('No active allocation');
    });
  });
});

// ============================================
// TURN Message Types Tests
// ============================================

describe('TURN Constants', () => {
  describe('TURNMethod', () => {
    it('should define all methods', () => {
      expect(TURNMethod.ALLOCATE).toBe(0x0003);
      expect(TURNMethod.REFRESH).toBe(0x0004);
      expect(TURNMethod.SEND).toBe(0x0006);
      expect(TURNMethod.DATA).toBe(0x0007);
      expect(TURNMethod.CREATE_PERMISSION).toBe(0x0008);
      expect(TURNMethod.CHANNEL_BIND).toBe(0x0009);
    });
  });

  describe('TURNMessageType', () => {
    it('should define all message types', () => {
      expect(TURNMessageType.ALLOCATE_REQUEST).toBe(0x0003);
      expect(TURNMessageType.ALLOCATE_SUCCESS).toBe(0x0103);
      expect(TURNMessageType.ALLOCATE_ERROR).toBe(0x0113);
      expect(TURNMessageType.SEND_INDICATION).toBe(0x0016);
      expect(TURNMessageType.DATA_INDICATION).toBe(0x0017);
    });
  });

  describe('TURNAttribute', () => {
    it('should define all attributes', () => {
      expect(TURNAttribute.CHANNEL_NUMBER).toBe(0x000C);
      expect(TURNAttribute.LIFETIME).toBe(0x000D);
      expect(TURNAttribute.XOR_PEER_ADDRESS).toBe(0x0012);
      expect(TURNAttribute.DATA).toBe(0x0013);
      expect(TURNAttribute.XOR_RELAYED_ADDRESS).toBe(0x0016);
      expect(TURNAttribute.REQUESTED_TRANSPORT).toBe(0x0019);
    });
  });

  describe('TURNError', () => {
    it('should define error codes', () => {
      expect(TURNError.FORBIDDEN).toBe(403);
      expect(TURNError.ALLOCATION_MISMATCH).toBe(437);
      expect(TURNError.STALE_NONCE).toBe(438);
      expect(TURNError.ALLOCATION_QUOTA_REACHED).toBe(486);
      expect(TURNError.INSUFFICIENT_CAPACITY).toBe(508);
    });
  });
});

// ============================================
// TURN Internal Methods Tests
// ============================================

describe('TURN Client Internals', () => {
  let client;

  beforeEach(() => {
    client = new TURNClient();
  });

  describe('_extractAttribute', () => {
    it('should return null for missing attribute', () => {
      const msg = Buffer.alloc(20);
      const result = client._extractAttribute(msg, 0x1234);
      expect(result).toBeNull();
    });
  });

  describe('_parseError', () => {
    it('should return default error for invalid message', () => {
      const msg = Buffer.alloc(20);
      const error = client._parseError(msg);
      expect(error.code).toBe(0);
      expect(error.reason).toBe('Unknown error');
    });
  });

  describe('channel management', () => {
    it('should track channel numbers', () => {
      expect(client._nextChannel).toBe(0x4000);
      
      client._nextChannel++;
      expect(client._nextChannel).toBe(0x4001);
    });
  });
});
