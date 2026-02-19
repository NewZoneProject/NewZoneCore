// Module: Network Integration Tests
// Description: End-to-end integration tests for the network layer.
// File: tests/network/integration.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import all components
import { NodeID } from '../../network/dht/node-id.js';
import { Frame, FrameParser, MessageType, MessageFlags } from '../../network/transport/message-framing.js';
import { Connection, ConnectionState } from '../../network/transport/connection.js';
import { ConnectionPool } from '../../network/transport/connection-pool.js';
import { TCPTransport } from '../../network/transport/tcp-transport.js';
import { KademliaDHT } from '../../network/dht/kademlia.js';
import { PeerDiscovery, PeerInfo } from '../../network/discovery/peer-discovery.js';
import { ServiceRegistry, ServiceInfo } from '../../network/discovery/service-registry.js';
import { BootstrapManager } from '../../network/discovery/bootstrap-nodes.js';
import { NATManager, NATType } from '../../network/nat/index.js';
import { NetworkManager, NetworkManagerEvents } from '../../network/index.js';

// ============================================
// Frame Integration Tests
// ============================================

describe('Frame Integration', () => {
  it('should encode and decode messages correctly', () => {
    const payload = Buffer.from('Hello, NewZoneCore Network!');
    const frame = Frame.data(payload, MessageFlags.ENCRYPTED);
    
    // Encode
    const buffer = frame.toBuffer();
    expect(buffer.length).toBeGreaterThan(payload.length);
    
    // Decode
    const parser = new FrameParser();
    const { frames, error } = parser.feed(buffer);
    
    expect(error).toBeNull();
    expect(frames.length).toBe(1);
    expect(frames[0].type).toBe(MessageType.DATA);
    expect(frames[0].hasFlag(MessageFlags.ENCRYPTED)).toBe(true);
    expect(frames[0].payload.toString()).toBe('Hello, NewZoneCore Network!');
  });

  it('should handle multiple frames in sequence', () => {
    const frames = [
      Frame.data(Buffer.from('message 1')),
      Frame.ping(),
      Frame.data(Buffer.from('message 2')),
      Frame.disconnect('test complete')
    ];
    
    const buffers = frames.map(f => f.toBuffer());
    const combined = Buffer.concat(buffers);
    
    const parser = new FrameParser();
    const { frames: parsed } = parser.feed(combined);
    
    expect(parsed.length).toBe(4);
    expect(parsed[0].type).toBe(MessageType.DATA);
    expect(parsed[1].type).toBe(MessageType.PING);
    expect(parsed[2].type).toBe(MessageType.DATA);
    expect(parsed[3].type).toBe(MessageType.DISCONNECT);
  });

  it('should handle fragmented frames across multiple feeds', () => {
    const payload = Buffer.from('This is a test message for fragmentation');
    const frame = Frame.data(payload);
    const buffer = frame.toBuffer();
    
    // Split into small chunks
    const chunkSize = 5;
    const parser = new FrameParser();
    let allFrames = [];
    
    for (let i = 0; i < buffer.length; i += chunkSize) {
      const chunk = buffer.slice(i, Math.min(i + chunkSize, buffer.length));
      const { frames } = parser.feed(chunk);
      allFrames = allFrames.concat(frames);
    }
    
    expect(allFrames.length).toBe(1);
    expect(allFrames[0].payload.toString()).toBe('This is a test message for fragmentation');
  });
});

// ============================================
// Connection Pool Integration Tests
// ============================================

describe('Connection Pool Integration', () => {
  let pool;

  beforeEach(() => {
    pool = new ConnectionPool({ maxSize: 10 });
  });

  afterEach(async () => {
    await pool.stop();
  });

  it('should manage connections efficiently', async () => {
    await pool.start();
    
    // Add multiple connections
    const connections = [];
    for (let i = 0; i < 5; i++) {
      const conn = new Connection({
        id: `conn-${i}`,
        peerId: `peer-${i}`,
        transportType: 'tcp'
      });
      conn.state = ConnectionState.CONNECTED;
      pool.add(conn);
      connections.push(conn);
    }
    
    expect(pool.size).toBe(5);
    
    // Get stats
    const stats = pool.getStats();
    expect(stats.size).toBe(5);
    expect(stats.activeCount).toBe(5);
  });

  it('should broadcast to all connections', async () => {
    await pool.start();
    
    // Add mock connections
    for (let i = 0; i < 3; i++) {
      const conn = new Connection({ id: `conn-${i}` });
      conn.state = ConnectionState.CONNECTED;
      conn.send = vi.fn().mockResolvedValue(10);
      pool.add(conn);
    }
    
    const result = await pool.broadcast(Buffer.from('broadcast test'));
    
    expect(result.total).toBe(3);
    expect(result.successful).toBe(3);
  });

  it('should handle connection removal', async () => {
    await pool.start();
    
    const conn = new Connection({ id: 'conn-1' });
    conn.state = ConnectionState.CONNECTED;
    pool.add(conn);
    
    expect(pool.size).toBe(1);
    
    await pool.remove('conn-1');
    
    expect(pool.size).toBe(0);
  });
});

// ============================================
// DHT Integration Tests
// ============================================

describe('DHT Integration', () => {
  it('should create DHT with node ID', () => {
    const nodeId = NodeID.random();
    const dht = new KademliaDHT({ nodeId });
    
    expect(dht.nodeId.equals(nodeId)).toBe(true);
  });

  it('should handle RPC messages', () => {
    const dht = new KademliaDHT();
    const from = { address: '127.0.0.1', port: 9030 };
    
    // Handle PING
    dht.handleRPC({
      command: 'ping',
      rpcId: 'test-123',
      data: { nodeId: NodeID.random().hex }
    }, from);
    
    // Should not throw
    expect(dht.isReady).toBe(false);
  });

  it('should bootstrap correctly', async () => {
    const dht = new KademliaDHT();
    const result = await dht.bootstrap();
    
    expect(result.nodeId).toBe(dht.nodeId.hex);
    expect(dht.isReady).toBe(true);
  });

  it('should handle local storage', async () => {
    const dht = new KademliaDHT();
    await dht.bootstrap();
    
    // Store value directly (simulating receiving STORE RPC)
    const key = NodeID.fromString('test-key');
    dht._storage.set(key.hex, {
      value: 'test-value',
      storedAt: Date.now()
    });
    
    expect(dht.storageSize).toBe(1);
  });
});

// ============================================
// Peer Discovery Integration Tests
// ============================================

describe('Peer Discovery Integration', () => {
  let discovery;

  beforeEach(() => {
    discovery = new PeerDiscovery({ maxPeers: 100 });
  });

  afterEach(() => {
    discovery.stop();
  });

  it('should integrate with DHT', () => {
    const dht = new KademliaDHT();
    discovery.setDHT(dht);
    
    expect(discovery._dht).toBe(dht);
  });

  it('should track peers from multiple sources', () => {
    // Add peers from different sources
    discovery.addPeer({
      id: NodeID.random(),
      address: '192.168.1.1',
      port: 9030,
      source: 'dht'
    });
    
    discovery.addPeer({
      id: NodeID.random(),
      address: '192.168.1.2',
      port: 9030,
      source: 'mdns'
    });
    
    discovery.addPeer({
      id: NodeID.random(),
      address: '192.168.1.3',
      port: 9030,
      source: 'bootstrap'
    });
    
    const stats = discovery.getStats();
    
    expect(stats.totalPeers).toBe(3);
    expect(stats.bySource['dht']).toBe(1);
    expect(stats.bySource['mdns']).toBe(1);
    expect(stats.bySource['bootstrap']).toBe(1);
  });

  it('should find closest peers for routing', () => {
    // Add many peers
    for (let i = 0; i < 50; i++) {
      discovery.addPeer({
        id: NodeID.random(),
        address: `192.168.1.${i % 256}`,
        port: 9030
      });
    }
    
    const target = NodeID.random();
    const closest = discovery.getClosestPeers(target, 10);
    
    expect(closest.length).toBe(10);
    
    // Verify they're sorted by distance
    for (let i = 1; i < closest.length; i++) {
      const dist1 = target.distance(closest[i - 1].id);
      const dist2 = target.distance(closest[i].id);
      expect(dist1.compare(dist2)).toBeLessThanOrEqual(0);
    }
  });
});

// ============================================
// Service Registry Integration Tests
// ============================================

describe('Service Registry Integration', () => {
  let registry;

  beforeEach(() => {
    registry = new ServiceRegistry();
  });

  afterEach(() => {
    registry.stop();
  });

  it('should register and discover services', async () => {
    registry.start();
    
    // Register services
    await registry.register({
      type: 'trust-node',
      address: '192.168.1.1',
      port: 9030,
      tags: ['primary']
    });
    
    await registry.register({
      type: 'trust-node',
      address: '192.168.1.2',
      port: 9030,
      tags: ['backup']
    });
    
    await registry.register({
      type: 'storage',
      address: '192.168.1.3',
      port: 9031
    });
    
    // Find by type
    const trustNodes = registry.findByType('trust-node');
    expect(trustNodes.length).toBe(2);
    
    const storageNodes = registry.findByType('storage');
    expect(storageNodes.length).toBe(1);
  });

  it('should handle health status', async () => {
    registry.start();
    
    const service = await registry.register({
      type: 'trust-node',
      address: '192.168.1.1',
      port: 9030
    });
    
    // Mark as healthy
    registry.heartbeat(service.id, 'healthy');
    
    const healthy = registry.findByType('trust-node', { healthStatus: 'healthy' });
    expect(healthy.length).toBe(1);
    
    const unhealthy = registry.findByType('trust-node', { healthStatus: 'unhealthy' });
    expect(unhealthy.length).toBe(0);
  });

  it('should support weighted load balancing', async () => {
    registry.start();
    
    const svc1 = await registry.register({
      type: 'api',
      address: '192.168.1.1',
      port: 9030,
      weight: 10
    });
    
    const svc2 = await registry.register({
      type: 'api',
      address: '192.168.1.2',
      port: 9030,
      weight: 1
    });
    
    // Mark services as healthy
    registry.heartbeat(svc1.id, 'healthy');
    registry.heartbeat(svc2.id, 'healthy');
    
    // Get weighted random - higher weight should be more likely
    const selections = {};
    for (let i = 0; i < 100; i++) {
      const service = registry.getWeightedByType('api');
      if (service) {
        selections[service.address] = (selections[service.address] || 0) + 1;
      }
    }
    
    // Both services should be selected
    expect(Object.keys(selections).length).toBe(2);
    expect(selections['192.168.1.1']).toBeDefined();
    expect(selections['192.168.1.2']).toBeDefined();
  });
});

// ============================================
// Bootstrap Manager Integration Tests
// ============================================

describe('Bootstrap Manager Integration', () => {
  it('should manage bootstrap nodes', () => {
    const manager = new BootstrapManager();
    
    manager.addNodes([
      { address: 'bootstrap1.example.com', port: 9030 },
      { address: 'bootstrap2.example.com', port: 9030 },
      { address: 'bootstrap3.example.com', port: 9030 }
    ]);
    
    const status = manager.getStatus();
    expect(status.totalNodes).toBe(3);
    expect(status.connectedNodes).toBe(0);
  });

  it('should track connection attempts', () => {
    const manager = new BootstrapManager({ maxRetries: 3 });
    
    manager.addNode({ address: 'test.example.com', port: 9030 });
    
    // Simulate connection attempt
    manager._updateNodeStatus(manager.getNodes()[0].id, 'connecting');
    
    const nodes = manager.getNodes();
    expect(nodes[0].attempts).toBe(1);
  });
});

// ============================================
// Full Stack Integration Tests
// ============================================

describe('Full Stack Integration', () => {
  it('should create network manager with all components', async () => {
    const manager = new NetworkManager({
      transports: ['tcp'],
      tcp: { port: 0 }, // Random port
      nat: { enabled: false }, // Disable for test
      mdns: false // Disable for test
    });
    
    expect(manager.nodeId).toBeDefined();
    expect(manager.isStarted).toBe(false);
  });

  it('should start and stop cleanly', async () => {
    const manager = new NetworkManager({
      transports: ['tcp'],
      tcp: { port: 0 },
      nat: { enabled: false },
      discovery: { mdns: false },
      dht: { enabled: true }
    });
    
    await manager.start();
    
    expect(manager.isStarted).toBe(true);
    expect(manager.isReady).toBe(true);
    expect(manager.uptime).toBeGreaterThanOrEqual(0);
    
    const stats = manager.getStats();
    expect(stats.nodeId).toBeDefined();
    expect(stats.transports.tcp).toBeDefined();
    
    await manager.stop();
    
    expect(manager.isStarted).toBe(false);
  });

  it('should emit events correctly', async () => {
    const manager = new NetworkManager({
      transports: ['tcp'],
      tcp: { port: 0 },
      nat: { enabled: false },
      discovery: { mdns: false }
    });
    
    const readyHandler = vi.fn();
    manager.on(NetworkManagerEvents.READY, readyHandler);
    
    await manager.start();
    
    expect(readyHandler).toHaveBeenCalled();
    
    await manager.stop();
  });

  it('should handle peer discovery through DHT', async () => {
    const manager = new NetworkManager({
      transports: ['tcp'],
      tcp: { port: 0 },
      nat: { enabled: false },
      discovery: { mdns: false },
      dht: { enabled: true }
    });
    
    await manager.start();
    
    // DHT should be ready
    expect(manager._dht).toBeDefined();
    expect(manager._dht.isReady).toBe(true);
    
    await manager.stop();
  });

  it('should manage services through registry', async () => {
    const manager = new NetworkManager({
      transports: ['tcp'],
      tcp: { port: 0 },
      nat: { enabled: false },
      discovery: { mdns: false }
    });
    
    await manager.start();
    
    // Register a service
    const service = await manager.registerService({
      type: 'test-service',
      address: '127.0.0.1',
      port: 9999
    });
    
    expect(service.id).toBeDefined();
    
    // Find the service
    const services = manager.findServices('test-service');
    expect(services.length).toBe(1);
    
    await manager.stop();
  });
});

// ============================================
// NodeID Distance Tests
// ============================================

describe('NodeID Distance Integration', () => {
  it('should calculate distances for routing', () => {
    const ids = Array.from({ length: 10 }, () => NodeID.random());
    const target = NodeID.random();
    
    // Sort by distance
    const sorted = [...ids].sort((a, b) => {
      const distA = target.distance(a);
      const distB = target.distance(b);
      return distA.compare(distB);
    });
    
    // Verify ordering
    for (let i = 1; i < sorted.length; i++) {
      const distPrev = target.distance(sorted[i - 1]);
      const distCurr = target.distance(sorted[i]);
      expect(distPrev.compare(distCurr)).toBeLessThanOrEqual(0);
    }
  });

  it('should determine bucket indices correctly', () => {
    const localId = NodeID.random();
    
    for (let i = 0; i < 100; i++) {
      const remoteId = NodeID.random();
      const bucketIndex = localId.bucketIndex(remoteId);
      
      expect(bucketIndex).toBeGreaterThanOrEqual(0);
      expect(bucketIndex).toBeLessThan(256);
    }
  });
});
