// Module: DHT Tests
// Description: Unit tests for DHT components.
// File: tests/network/dht.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import components
import { 
  NodeID, 
  NODE_ID_LENGTH, 
  compareDistances,
  sortByDistance
} from '../../network/dht/node-id.js';

import { 
  KBucket, 
  KBucketList, 
  Contact, 
  K,
  KBucketEvents 
} from '../../network/dht/kbuckets.js';

import { RoutingTable, RoutingTableEvents } from '../../network/dht/routing-table.js';
import { KademliaDHT, DHTEvents, RPCCommand } from '../../network/dht/kademlia.js';

// ============================================
// NodeID Tests
// ============================================

describe('NodeID', () => {
  describe('constructor', () => {
    it('should create NodeID from buffer', () => {
      const buffer = Buffer.alloc(NODE_ID_LENGTH, 0x42);
      const id = new NodeID(buffer);
      expect(id.buffer.length).toBe(NODE_ID_LENGTH);
    });

    it('should create NodeID from hex string', () => {
      const hex = '0'.repeat(NODE_ID_LENGTH * 2);
      const id = new NodeID(hex);
      expect(id.hex).toBe(hex);
    });

    it('should reject invalid length', () => {
      expect(() => new NodeID(Buffer.alloc(10))).toThrow();
    });
  });

  describe('static methods', () => {
    it('should create random NodeID', () => {
      const id1 = NodeID.random();
      const id2 = NodeID.random();
      
      expect(id1.buffer.length).toBe(NODE_ID_LENGTH);
      expect(id1.equals(id2)).toBe(false);
    });

    it('should create NodeID from string', () => {
      const id = NodeID.fromString('test string');
      expect(id.buffer.length).toBe(NODE_ID_LENGTH);
      
      // Same string should produce same ID
      const id2 = NodeID.fromString('test string');
      expect(id.equals(id2)).toBe(true);
    });
  });

  describe('distance', () => {
    it('should calculate XOR distance', () => {
      const id1 = new NodeID(Buffer.alloc(NODE_ID_LENGTH, 0x00));
      const id2 = new NodeID(Buffer.alloc(NODE_ID_LENGTH, 0xFF));
      
      const distance = id1.distance(id2);
      
      // All bytes should be 0xFF
      for (let i = 0; i < NODE_ID_LENGTH; i++) {
        expect(distance[i]).toBe(0xFF);
      }
    });

    it('should return zero distance for identical IDs', () => {
      const id = NodeID.random();
      const distance = id.distance(id);
      
      for (let i = 0; i < NODE_ID_LENGTH; i++) {
        expect(distance[i]).toBe(0);
      }
    });
  });

  describe('compare', () => {
    it('should compare NodeIDs correctly', () => {
      const id1 = new NodeID(Buffer.alloc(NODE_ID_LENGTH, 0x00));
      const id2 = new NodeID(Buffer.alloc(NODE_ID_LENGTH, 0x01));
      
      expect(id1.compare(id2)).toBeLessThan(0);
      expect(id2.compare(id1)).toBeGreaterThan(0);
      expect(id1.compare(id1)).toBe(0);
    });
  });

  describe('bucketIndex', () => {
    it('should calculate bucket index correctly', () => {
      // IDs that differ in high bits should have low bucket index
      const id1 = NodeID.fromString('a');
      const id2 = NodeID.fromString('b');
      
      const bucketIndex = id1.bucketIndex(id2);
      expect(bucketIndex).toBeGreaterThanOrEqual(0);
      expect(bucketIndex).toBeLessThan(256);
    });
  });

  describe('getBit/setBit', () => {
    it('should get and set bits correctly', () => {
      const id = NodeID.random();
      const bit0 = id.getBit(0);
      const newId = id.setBit(0, bit0 ? 0 : 1);
      
      expect(newId.getBit(0)).toBe(bit0 ? 0 : 1);
      expect(newId.equals(id)).toBe(false);
    });
  });

  describe('commonPrefixLength', () => {
    it('should return full length for identical IDs', () => {
      const id = NodeID.random();
      expect(id.commonPrefixLength(id)).toBe(256);
    });

    it('should return correct prefix length for different IDs', () => {
      // Create IDs that differ at specific positions
      const buffer1 = Buffer.alloc(NODE_ID_LENGTH, 0x00);
      const buffer2 = Buffer.alloc(NODE_ID_LENGTH, 0x00);
      buffer2[0] = 0x80; // Differ at bit 0
      
      const id1 = new NodeID(buffer1);
      const id2 = new NodeID(buffer2);
      
      expect(id1.commonPrefixLength(id2)).toBe(0);
    });
  });

  describe('equals', () => {
    it('should return true for identical IDs', () => {
      const id1 = NodeID.random();
      const id2 = new NodeID(id1.buffer);
      expect(id1.equals(id2)).toBe(true);
    });

    it('should return false for different IDs', () => {
      const id1 = NodeID.random();
      const id2 = NodeID.random();
      expect(id1.equals(id2)).toBe(false);
    });
  });
});

// ============================================
// Contact Tests
// ============================================

describe('Contact', () => {
  it('should create contact with required fields', () => {
    const id = NodeID.random();
    const contact = new Contact({
      id,
      address: '127.0.0.1',
      port: 9030
    });
    
    expect(contact.id.equals(id)).toBe(true);
    expect(contact.address).toBe('127.0.0.1');
    expect(contact.port).toBe(9030);
    expect(contact.lastSeen).toBeDefined();
  });

  it('should update last seen on touch', () => {
    const contact = new Contact({
      id: NodeID.random(),
      address: '127.0.0.1',
      port: 9030
    });
    
    const oldSeen = contact.lastSeen;
    
    // Wait a bit
    const start = Date.now();
    while (Date.now() === start) {}
    
    contact.touch();
    expect(contact.lastSeen).toBeGreaterThan(oldSeen);
  });

  it('should serialize to JSON', () => {
    const contact = new Contact({
      id: NodeID.random(),
      address: '127.0.0.1',
      port: 9030
    });
    
    const json = contact.toJSON();
    expect(json.id).toBe(contact.id.hex);
    expect(json.address).toBe('127.0.0.1');
    expect(json.port).toBe(9030);
  });
});

// ============================================
// KBucket Tests
// ============================================

describe('KBucket', () => {
  let bucket;
  let localNodeId;

  beforeEach(() => {
    localNodeId = NodeID.random();
    bucket = new KBucket({ localNodeId, k: 3 });
  });

  it('should start empty', () => {
    expect(bucket.size).toBe(0);
    expect(bucket.isFull).toBe(false);
  });

  it('should add contacts', () => {
    const contact = new Contact({
      id: NodeID.random(),
      address: '127.0.0.1',
      port: 9030
    });
    
    const result = bucket.add(contact);
    expect(result.added).toBe(true);
    expect(bucket.size).toBe(1);
  });

  it('should update existing contacts', () => {
    const id = NodeID.random();
    const contact = new Contact({
      id,
      address: '127.0.0.1',
      port: 9030
    });
    
    bucket.add(contact);
    
    // Add same contact again
    const result = bucket.add(contact);
    expect(result.updated).toBe(true);
    expect(bucket.size).toBe(1);
  });

  it('should mark as full when k contacts added', () => {
    for (let i = 0; i < 3; i++) {
      bucket.add(new Contact({
        id: NodeID.random(),
        address: '127.0.0.1',
        port: 9030 + i
      }));
    }
    
    expect(bucket.isFull).toBe(true);
    
    // Adding more should be pending
    const result = bucket.add(new Contact({
      id: NodeID.random(),
      address: '127.0.0.1',
      port: 9999
    }));
    
    expect(result.pending).toBe(true);
  });

  it('should remove contacts', () => {
    const id = NodeID.random();
    bucket.add(new Contact({
      id,
      address: '127.0.0.1',
      port: 9030
    }));
    
    expect(bucket.size).toBe(1);
    
    bucket.remove(id);
    expect(bucket.size).toBe(0);
  });
});

// ============================================
// KBucketList Tests
// ============================================

describe('KBucketList', () => {
  let bucketList;
  let localNodeId;

  beforeEach(() => {
    localNodeId = NodeID.random();
    bucketList = new KBucketList({ localNodeId, k: 3 });
  });

  it('should start empty', () => {
    expect(bucketList.size).toBe(0);
  });

  it('should add contacts to correct bucket', () => {
    const contact = new Contact({
      id: NodeID.random(),
      address: '127.0.0.1',
      port: 9030
    });
    
    bucketList.add(contact);
    expect(bucketList.size).toBe(1);
  });

  it('should get closest nodes', () => {
    // Add some contacts
    for (let i = 0; i < 10; i++) {
      bucketList.add(new Contact({
        id: NodeID.random(),
        address: '127.0.0.1',
        port: 9030 + i
      }));
    }
    
    const target = NodeID.random();
    const closest = bucketList.getClosest(target, 3);
    
    expect(closest.length).toBeLessThanOrEqual(3);
  });
});

// ============================================
// RoutingTable Tests
// ============================================

describe('RoutingTable', () => {
  let routingTable;
  let localNodeId;

  beforeEach(() => {
    localNodeId = NodeID.random();
    routingTable = new RoutingTable(localNodeId);
  });

  it('should start empty', () => {
    expect(routingTable.size).toBe(0);
  });

  it('should not add self', () => {
    const result = routingTable.addNode({
      id: localNodeId,
      address: '127.0.0.1',
      port: 9030
    });
    
    expect(result.added).toBe(false);
    expect(result.reason).toBe('self');
  });

  it('should add nodes', () => {
    const result = routingTable.addNode({
      id: NodeID.random(),
      address: '127.0.0.1',
      port: 9030
    });
    
    expect(result.added).toBe(true);
    expect(routingTable.size).toBe(1);
  });

  it('should get closest nodes', () => {
    for (let i = 0; i < 10; i++) {
      routingTable.addNode({
        id: NodeID.random(),
        address: '127.0.0.1',
        port: 9030 + i
      });
    }
    
    const closest = routingTable.getClosestNodes(NodeID.random());
    expect(closest.length).toBeLessThanOrEqual(K);
  });

  it('should get stats', () => {
    routingTable.addNode({
      id: NodeID.random(),
      address: '127.0.0.1',
      port: 9030
    });
    
    const stats = routingTable.getStats();
    expect(stats.totalNodes).toBe(1);
    expect(stats.localNodeId).toBe(localNodeId.hex);
  });
});

// ============================================
// KademliaDHT Tests
// ============================================

describe('KademliaDHT', () => {
  let dht;

  beforeEach(() => {
    dht = new KademliaDHT();
  });

  describe('constructor', () => {
    it('should create DHT with random node ID', () => {
      expect(dht.nodeId).toBeDefined();
      expect(dht.nodeId.buffer.length).toBe(NODE_ID_LENGTH);
    });

    it('should accept custom node ID', () => {
      const customId = NodeID.random();
      const customDht = new KademliaDHT({ nodeId: customId });
      expect(customDht.nodeId.equals(customId)).toBe(true);
    });
  });

  describe('bootstrap', () => {
    it('should bootstrap without nodes', async () => {
      const result = await dht.bootstrap();
      expect(result.nodeId).toBe(dht.nodeId.hex);
      expect(dht.isReady).toBe(true);
    });
  });

  describe('storage', () => {
    it('should have empty storage initially', () => {
      expect(dht.storageSize).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return DHT statistics', () => {
      const stats = dht.getStats();
      
      expect(stats.nodeId).toBe(dht.nodeId.hex);
      expect(stats.isReady).toBe(false);
      expect(stats.knownNodes).toBe(0);
      expect(stats.storedValues).toBe(0);
    });
  });

  describe('handleRPC', () => {
    it('should handle PING message', () => {
      const from = { address: '127.0.0.1', port: 9030 };
      const message = {
        command: RPCCommand.PING,
        rpcId: 'test123',
        data: { nodeId: NodeID.random().hex }
      };
      
      // Should not throw
      expect(() => dht.handleRPC(message, from)).not.toThrow();
    });
  });
});

// ============================================
// Utility Functions Tests
// ============================================

describe('Utility Functions', () => {
  describe('compareDistances', () => {
    it('should compare distance buffers', () => {
      const dist1 = Buffer.alloc(NODE_ID_LENGTH, 0x00);
      const dist2 = Buffer.alloc(NODE_ID_LENGTH, 0x01);
      
      expect(compareDistances(dist1, dist2)).toBeLessThan(0);
      expect(compareDistances(dist2, dist1)).toBeGreaterThan(0);
      expect(compareDistances(dist1, dist1)).toBe(0);
    });
  });

  describe('sortByDistance', () => {
    it('should sort nodes by distance', () => {
      const reference = NodeID.random();
      const nodes = [
        { id: NodeID.random() },
        { id: NodeID.random() },
        { id: NodeID.random() }
      ];
      
      const sorted = sortByDistance([...nodes], reference);
      
      // Verify sorted order
      for (let i = 1; i < sorted.length; i++) {
        const dist0 = reference.distance(sorted[i - 1].id);
        const dist1 = reference.distance(sorted[i].id);
        expect(compareDistances(dist0, dist1)).toBeLessThanOrEqual(0);
      }
    });
  });
});
