// Module: Discovery Tests
// Description: Unit tests for discovery components.
// File: tests/network/discovery.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import components
import { 
  BootstrapManager, 
  BootstrapEvents, 
  DEFAULT_BOOTSTRAP_NODES 
} from '../../network/discovery/bootstrap-nodes.js';

import { 
  PeerDiscovery, 
  PeerDiscoveryEvents, 
  PeerInfo 
} from '../../network/discovery/peer-discovery.js';

import { 
  ServiceRegistry, 
  ServiceRegistryEvents, 
  ServiceInfo 
} from '../../network/discovery/service-registry.js';

import { NodeID } from '../../network/dht/node-id.js';

// ============================================
// Bootstrap Manager Tests
// ============================================

describe('BootstrapManager', () => {
  let manager;

  beforeEach(() => {
    manager = new BootstrapManager({ timeout: 1000, maxRetries: 1 });
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  describe('constructor', () => {
    it('should create manager with default options', () => {
      expect(manager.options.timeout).toBe(1000);
      expect(manager.options.maxConcurrent).toBe(3);
      expect(manager.isBootstrapped).toBe(false);
    });

    it('should accept custom options', () => {
      const custom = new BootstrapManager({ timeout: 5000, requiredNodes: 2 });
      expect(custom.options.timeout).toBe(5000);
      expect(custom.options.requiredNodes).toBe(2);
    });
  });

  describe('addNode', () => {
    it('should add bootstrap node', () => {
      const id = manager.addNode({
        address: 'bootstrap.example.com',
        port: 9030
      });
      
      expect(id).toBeDefined();
      expect(manager.getNodes().length).toBe(1);
    });

    it('should add node with custom ID', () => {
      const customId = 'custom-bootstrap-1';
      const id = manager.addNode({
        id: customId,
        address: 'bootstrap.example.com',
        port: 9030
      });
      
      expect(id).toBe(customId);
    });
  });

  describe('addNodes', () => {
    it('should add multiple nodes', () => {
      manager.addNodes([
        { address: 'node1.example.com', port: 9030 },
        { address: 'node2.example.com', port: 9030 }
      ]);
      
      expect(manager.getNodes().length).toBe(2);
    });
  });

  describe('removeNode', () => {
    it('should remove node', () => {
      const id = manager.addNode({ address: 'test.example.com', port: 9030 });
      manager.removeNode(id);
      
      expect(manager.getNodes().length).toBe(0);
    });
  });

  describe('getConnectedNodes', () => {
    it('should return empty array initially', () => {
      expect(manager.getConnectedNodes()).toEqual([]);
    });
  });

  describe('getStatus', () => {
    it('should return status object', () => {
      manager.addNode({ address: 'test.example.com', port: 9030 });
      
      const status = manager.getStatus();
      
      expect(status.isBootstrapped).toBe(false);
      expect(status.totalNodes).toBe(1);
      expect(status.connectedNodes).toBe(0);
      expect(status.nodes).toHaveLength(1);
    });
  });

  describe('reset', () => {
    it('should reset bootstrap state', () => {
      manager.addNode({ address: 'test.example.com', port: 9030 });
      manager._isBootstrapped = true;
      
      manager.reset();
      
      expect(manager.isBootstrapped).toBe(false);
      expect(manager._isBootstrapping).toBe(false);
    });
  });

  describe('events', () => {
    it('should have BootstrapEvents defined', () => {
      expect(BootstrapEvents.CONNECTED).toBe('connected');
      expect(BootstrapEvents.DISCONNECTED).toBe('disconnected');
      expect(BootstrapEvents.ERROR).toBe('error');
      expect(BootstrapEvents.ALL_FAILED).toBe('all_failed');
      expect(BootstrapEvents.BOOTSTRAPPED).toBe('bootstrapped');
    });
  });
});

// ============================================
// PeerInfo Tests
// ============================================

describe('PeerInfo', () => {
  it('should create peer info with required fields', () => {
    const peer = new PeerInfo({
      id: NodeID.random(),
      address: '192.168.1.1',
      port: 9030
    });
    
    expect(peer.id).toBeDefined();
    expect(peer.address).toBe('192.168.1.1');
    expect(peer.port).toBe(9030);
    expect(peer.lastSeen).toBeDefined();
  });

  it('should default to empty services array', () => {
    const peer = new PeerInfo({
      id: NodeID.random(),
      address: '192.168.1.1',
      port: 9030
    });
    
    expect(peer.services).toEqual([]);
  });

  it('should update lastSeen on touch', () => {
    const peer = new PeerInfo({
      id: NodeID.random(),
      address: '192.168.1.1',
      port: 9030
    });
    
    const oldSeen = peer.lastSeen;
    peer.touch();
    
    expect(peer.lastSeen).toBeGreaterThanOrEqual(oldSeen);
  });

  it('should serialize to JSON', () => {
    const id = NodeID.random();
    const peer = new PeerInfo({
      id,
      address: '192.168.1.1',
      port: 9030,
      services: ['trust', 'storage']
    });
    
    const json = peer.toJSON();
    
    expect(json.id).toBe(id.hex);
    expect(json.address).toBe('192.168.1.1');
    expect(json.services).toEqual(['trust', 'storage']);
  });

  it('should create from JSON', () => {
    const id = NodeID.random();
    const peer = PeerInfo.fromJSON({
      id: id.hex,
      address: '192.168.1.1',
      port: 9030,
      services: ['trust']
    });
    
    expect(peer.id.hex).toBe(id.hex);
    expect(peer.address).toBe('192.168.1.1');
  });
});

// ============================================
// PeerDiscovery Tests
// ============================================

describe('PeerDiscovery', () => {
  let discovery;

  beforeEach(() => {
    discovery = new PeerDiscovery({ maxPeers: 100 });
  });

  afterEach(() => {
    discovery.stop();
  });

  describe('constructor', () => {
    it('should create discovery with default options', () => {
      expect(discovery.options.maxPeers).toBe(100);
      expect(discovery.peerCount).toBe(0);
    });
  });

  describe('addPeer', () => {
    it('should add a peer', () => {
      const peer = new PeerInfo({
        id: NodeID.random(),
        address: '192.168.1.1',
        port: 9030
      });
      
      const result = discovery.addPeer(peer);
      
      expect(result).toBe(true);
      expect(discovery.peerCount).toBe(1);
    });

    it('should update existing peer', () => {
      const id = NodeID.random();
      const peer1 = new PeerInfo({
        id,
        address: '192.168.1.1',
        port: 9030
      });
      
      discovery.addPeer(peer1);
      
      const peer2 = new PeerInfo({
        id,
        address: '192.168.1.2',
        port: 9031
      });
      
      discovery.addPeer(peer2);
      
      expect(discovery.peerCount).toBe(1);
      const stored = discovery.getPeer(id);
      expect(stored.address).toBe('192.168.1.2');
    });

    it('should emit PEER_FOUND event', () => {
      const handler = vi.fn();
      discovery.on(PeerDiscoveryEvents.PEER_FOUND, handler);
      
      discovery.addPeer({
        id: NodeID.random(),
        address: '192.168.1.1',
        port: 9030
      });
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('removePeer', () => {
    it('should remove a peer', () => {
      const id = NodeID.random();
      discovery.addPeer({
        id,
        address: '192.168.1.1',
        port: 9030
      });
      
      discovery.removePeer(id);
      
      expect(discovery.peerCount).toBe(0);
    });

    it('should emit PEER_LOST event', () => {
      const handler = vi.fn();
      discovery.on(PeerDiscoveryEvents.PEER_LOST, handler);
      
      const id = NodeID.random();
      discovery.addPeer({
        id,
        address: '192.168.1.1',
        port: 9030
      });
      
      discovery.removePeer(id);
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('getPeer', () => {
    it('should return peer by ID', () => {
      const id = NodeID.random();
      discovery.addPeer({
        id,
        address: '192.168.1.1',
        port: 9030
      });
      
      const peer = discovery.getPeer(id);
      
      expect(peer).toBeDefined();
      expect(peer.id.hex).toBe(id.hex);
    });

    it('should return undefined for unknown ID', () => {
      const peer = discovery.getPeer(NodeID.random());
      expect(peer).toBeUndefined();
    });
  });

  describe('hasPeer', () => {
    it('should return true for existing peer', () => {
      const id = NodeID.random();
      discovery.addPeer({ id, address: '192.168.1.1', port: 9030 });
      
      expect(discovery.hasPeer(id)).toBe(true);
    });

    it('should return false for unknown peer', () => {
      expect(discovery.hasPeer(NodeID.random())).toBe(false);
    });
  });

  describe('getPeersByService', () => {
    it('should filter peers by service', () => {
      discovery.addPeer({
        id: NodeID.random(),
        address: '192.168.1.1',
        port: 9030,
        services: ['trust', 'storage']
      });
      
      discovery.addPeer({
        id: NodeID.random(),
        address: '192.168.1.2',
        port: 9030,
        services: ['storage']
      });
      
      const trustPeers = discovery.getPeersByService('trust');
      expect(trustPeers.length).toBe(1);
      
      const storagePeers = discovery.getPeersByService('storage');
      expect(storagePeers.length).toBe(2);
    });
  });

  describe('getRandomPeers', () => {
    it('should return random subset of peers', () => {
      for (let i = 0; i < 10; i++) {
        discovery.addPeer({
          id: NodeID.random(),
          address: `192.168.1.${i}`,
          port: 9030
        });
      }
      
      const random = discovery.getRandomPeers(5);
      expect(random.length).toBe(5);
    });
  });

  describe('getClosestPeers', () => {
    it('should return closest peers to target', () => {
      for (let i = 0; i < 20; i++) {
        discovery.addPeer({
          id: NodeID.random(),
          address: `192.168.1.${i}`,
          port: 9030
        });
      }
      
      const target = NodeID.random();
      const closest = discovery.getClosestPeers(target, 10);
      
      expect(closest.length).toBe(10);
    });
  });

  describe('getStats', () => {
    it('should return discovery statistics', () => {
      discovery.addPeer({
        id: NodeID.random(),
        address: '192.168.1.1',
        port: 9030,
        source: 'dht'
      });
      
      const stats = discovery.getStats();
      
      expect(stats.totalPeers).toBe(1);
      expect(stats.bySource['dht']).toBe(1);
    });
  });

  describe('export/import', () => {
    it('should export and import peers', () => {
      discovery.addPeer({
        id: NodeID.random(),
        address: '192.168.1.1',
        port: 9030
      });
      
      const exported = discovery.exportPeers();
      expect(exported.length).toBe(1);
      
      const newDiscovery = new PeerDiscovery();
      newDiscovery.importPeers(exported);
      
      expect(newDiscovery.peerCount).toBe(1);
    });
  });
});

// ============================================
// ServiceInfo Tests
// ============================================

describe('ServiceInfo', () => {
  it('should create service info with required fields', () => {
    const service = new ServiceInfo({
      type: 'trust-node',
      address: '192.168.1.1',
      port: 9030
    });
    
    expect(service.id).toBeDefined();
    expect(service.type).toBe('trust-node');
    expect(service.address).toBe('192.168.1.1');
    expect(service.port).toBe(9030);
  });

  it('should generate ID automatically', () => {
    const service = new ServiceInfo({
      type: 'trust-node',
      address: '192.168.1.1',
      port: 9030
    });
    
    expect(service.id).toMatch(/^svc_/);
  });

  it('should check expiration', () => {
    const service = new ServiceInfo({
      type: 'trust-node',
      address: '192.168.1.1',
      port: 9030,
      ttl: 1
    });
    
    service.lastHeartbeat = Date.now() - 2000;
    
    expect(service.isExpired()).toBe(true);
  });

  it('should update heartbeat', () => {
    const service = new ServiceInfo({
      type: 'trust-node',
      address: '192.168.1.1',
      port: 9030
    });
    
    service.heartbeat('healthy');
    
    expect(service.healthStatus).toBe('healthy');
  });

  it('should serialize to JSON', () => {
    const service = new ServiceInfo({
      type: 'trust-node',
      address: '192.168.1.1',
      port: 9030
    });
    
    const json = service.toJSON();
    
    expect(json.type).toBe('trust-node');
    expect(json.address).toBe('192.168.1.1');
  });
});

// ============================================
// ServiceRegistry Tests
// ============================================

describe('ServiceRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new ServiceRegistry({ maxServices: 100 });
  });

  afterEach(() => {
    registry.stop();
  });

  describe('constructor', () => {
    it('should create registry with default options', () => {
      expect(registry.options.maxServices).toBe(100);
      expect(registry.serviceCount).toBe(0);
    });
  });

  describe('register', () => {
    it('should register a service', async () => {
      const service = await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      expect(service.id).toBeDefined();
      expect(registry.serviceCount).toBe(1);
    });

    it('should require type', async () => {
      await expect(registry.register({
        address: '192.168.1.1',
        port: 9030
      })).rejects.toThrow('Service type is required');
    });

    it('should require address', async () => {
      await expect(registry.register({
        type: 'trust-node',
        port: 9030
      })).rejects.toThrow('Service address is required');
    });

    it('should require port', async () => {
      await expect(registry.register({
        type: 'trust-node',
        address: '192.168.1.1'
      })).rejects.toThrow('Service port is required');
    });

    it('should emit SERVICE_REGISTERED event', async () => {
      const handler = vi.fn();
      registry.on(ServiceRegistryEvents.SERVICE_REGISTERED, handler);
      
      await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('unregister', () => {
    it('should unregister a service', async () => {
      const service = await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      await registry.unregister(service.id);
      
      expect(registry.serviceCount).toBe(0);
    });

    it('should emit SERVICE_UNREGISTERED event', async () => {
      const handler = vi.fn();
      registry.on(ServiceRegistryEvents.SERVICE_UNREGISTERED, handler);
      
      const service = await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      await registry.unregister(service.id);
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('should return service by ID', async () => {
      const registered = await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      const service = registry.get(registered.id);
      
      expect(service).toBeDefined();
      expect(service.id).toBe(registered.id);
    });
  });

  describe('findByType', () => {
    it('should find services by type', async () => {
      await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      await registry.register({
        type: 'storage',
        address: '192.168.1.2',
        port: 9030
      });
      
      const trustServices = registry.findByType('trust-node');
      expect(trustServices.length).toBe(1);
      
      const storageServices = registry.findByType('storage');
      expect(storageServices.length).toBe(1);
    });

    it('should filter by tags', async () => {
      await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030,
        tags: ['fast', 'reliable']
      });
      
      await registry.register({
        type: 'trust-node',
        address: '192.168.1.2',
        port: 9030,
        tags: ['reliable']
      });
      
      const fast = registry.findByType('trust-node', { tags: ['fast'] });
      expect(fast.length).toBe(1);
    });
  });

  describe('heartbeat', () => {
    it('should update service heartbeat', async () => {
      const service = await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      registry.heartbeat(service.id, 'healthy');
      
      const updated = registry.get(service.id);
      expect(updated.healthStatus).toBe('healthy');
    });

    it('should emit HEARTBEAT event', async () => {
      const handler = vi.fn();
      registry.on(ServiceRegistryEvents.HEARTBEAT, handler);
      
      const service = await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      registry.heartbeat(service.id);
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('getRandomByType', () => {
    it('should return random service of type', async () => {
      await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      const service = registry.getRandomByType('trust-node');
      expect(service).toBeDefined();
    });

    it('should return null if no services', () => {
      const service = registry.getRandomByType('nonexistent');
      expect(service).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return registry statistics', async () => {
      await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      const stats = registry.getStats();
      
      expect(stats.totalServices).toBe(1);
      expect(stats.types).toBe(1);
    });
  });

  describe('export/import', () => {
    it('should export and import services', async () => {
      await registry.register({
        type: 'trust-node',
        address: '192.168.1.1',
        port: 9030
      });
      
      const exported = registry.export();
      expect(exported.length).toBe(1);
      
      const newRegistry = new ServiceRegistry();
      newRegistry.import(exported);
      
      expect(newRegistry.serviceCount).toBe(1);
    });
  });
});

// ============================================
// Integration Tests
// ============================================

describe('Discovery Integration', () => {
  it('should work together: discovery + registry', async () => {
    const discovery = new PeerDiscovery();
    const registry = new ServiceRegistry();
    
    // Register a service
    const service = await registry.register({
      type: 'trust-node',
      address: '192.168.1.1',
      port: 9030
    });
    
    // Add peer with that service
    discovery.addPeer({
      id: NodeID.random(),
      address: service.address,
      port: service.port,
      services: [service.type]
    });
    
    // Verify connection
    const peers = discovery.getPeersByService('trust-node');
    expect(peers.length).toBe(1);
    
    discovery.stop();
    registry.stop();
  });

  it('should filter services by health status', async () => {
    const registry = new ServiceRegistry();
    
    await registry.register({
      type: 'trust-node',
      address: '192.168.1.1',
      port: 9030
    });
    
    const service2 = await registry.register({
      type: 'trust-node',
      address: '192.168.1.2',
      port: 9030
    });
    
    // Mark one as healthy
    registry.heartbeat(service2.id, 'healthy');
    
    const healthy = registry.findByType('trust-node', { healthStatus: 'healthy' });
    expect(healthy.length).toBe(1);
    
    registry.stop();
  });
});
