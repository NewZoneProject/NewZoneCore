// Module: Transport Tests
// Description: Unit tests for transport layer components.
// File: tests/network/transport.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Import components
import { 
  Connection, 
  ConnectionState, 
  ConnectionEvents,
  Frame, 
  FrameParser, 
  MessageType, 
  MessageFlags,
  FRAME_MAGIC,
  FRAME_HEADER_SIZE,
  MAX_FRAME_SIZE,
  ConnectionPool,
  PoolEvents
} from '../../network/transport/main.js';

// ============================================
// Frame Tests
// ============================================

describe('Frame', () => {
  describe('constructor', () => {
    it('should create a frame with default values', () => {
      const frame = new Frame();
      expect(frame.type).toBe(MessageType.DATA);
      expect(frame.flags).toBe(MessageFlags.NONE);
      expect(frame.payload.length).toBe(0);
    });

    it('should create a frame with custom values', () => {
      const payload = Buffer.from('test data');
      const frame = new Frame(MessageType.DATA, MessageFlags.PRIORITY, payload);
      expect(frame.type).toBe(MessageType.DATA);
      expect(frame.flags).toBe(MessageFlags.PRIORITY);
      expect(frame.payload).toEqual(payload);
    });
  });

  describe('toBuffer', () => {
    it('should serialize frame to buffer', () => {
      const payload = Buffer.from('hello');
      const frame = new Frame(MessageType.DATA, MessageFlags.NONE, payload);
      const buffer = frame.toBuffer();
      
      expect(buffer.length).toBe(FRAME_HEADER_SIZE + payload.length);
      expect(buffer.readUInt32BE(0)).toBe(FRAME_MAGIC);
      expect(buffer.readUInt8(8)).toBe(MessageType.DATA);
      expect(buffer.readUInt8(9)).toBe(MessageFlags.NONE);
    });

    it('should include payload in buffer', () => {
      const payload = Buffer.from('test payload');
      const frame = new Frame(MessageType.DATA, MessageFlags.NONE, payload);
      const buffer = frame.toBuffer();
      
      const payloadFromBuffer = buffer.slice(FRAME_HEADER_SIZE);
      expect(payloadFromBuffer).toEqual(payload);
    });
  });

  describe('static factories', () => {
    it('should create data frame', () => {
      const payload = Buffer.from('data');
      const frame = Frame.data(payload, MessageFlags.ENCRYPTED);
      expect(frame.type).toBe(MessageType.DATA);
      expect(frame.hasFlag(MessageFlags.ENCRYPTED)).toBe(true);
    });

    it('should create ping frame with timestamp', () => {
      const frame = Frame.ping();
      expect(frame.type).toBe(MessageType.PING);
      expect(frame.payload.length).toBe(8); // 64-bit timestamp
    });

    it('should create pong frame', () => {
      const pingPayload = Buffer.alloc(8);
      const frame = Frame.pong(pingPayload);
      expect(frame.type).toBe(MessageType.PONG);
      expect(frame.payload).toEqual(pingPayload);
    });

    it('should create handshake frame', () => {
      const payload = Buffer.from('handshake data');
      const frame = Frame.handshake(payload);
      expect(frame.type).toBe(MessageType.HANDSHAKE);
      expect(frame.hasFlag(MessageFlags.PRIORITY)).toBe(true);
    });

    it('should create disconnect frame', () => {
      const frame = Frame.disconnect('shutdown');
      expect(frame.type).toBe(MessageType.DISCONNECT);
      expect(frame.payload.toString()).toBe('shutdown');
    });

    it('should create error frame', () => {
      const frame = Frame.error(500, 'Internal error');
      expect(frame.type).toBe(MessageType.ERROR);
      const payload = JSON.parse(frame.payload.toString());
      expect(payload.code).toBe(500);
      expect(payload.message).toBe('Internal error');
    });
  });

  describe('hasFlag', () => {
    it('should return true when flag is set', () => {
      const frame = new Frame(MessageType.DATA, MessageFlags.ENCRYPTED | MessageFlags.PRIORITY);
      expect(frame.hasFlag(MessageFlags.ENCRYPTED)).toBe(true);
      expect(frame.hasFlag(MessageFlags.PRIORITY)).toBe(true);
    });

    it('should return false when flag is not set', () => {
      const frame = new Frame(MessageType.DATA, MessageFlags.ENCRYPTED);
      expect(frame.hasFlag(MessageFlags.PRIORITY)).toBe(false);
    });
  });

  describe('addFlag/removeFlag', () => {
    it('should add flag', () => {
      const frame = new Frame();
      frame.addFlag(MessageFlags.ENCRYPTED);
      expect(frame.hasFlag(MessageFlags.ENCRYPTED)).toBe(true);
    });

    it('should remove flag', () => {
      const frame = new Frame(MessageType.DATA, MessageFlags.ENCRYPTED);
      frame.removeFlag(MessageFlags.ENCRYPTED);
      expect(frame.hasFlag(MessageFlags.ENCRYPTED)).toBe(false);
    });

    it('should be chainable', () => {
      const frame = new Frame();
      frame.addFlag(MessageFlags.ENCRYPTED).addFlag(MessageFlags.PRIORITY);
      expect(frame.hasFlag(MessageFlags.ENCRYPTED)).toBe(true);
      expect(frame.hasFlag(MessageFlags.PRIORITY)).toBe(true);
    });
  });
});

// ============================================
// FrameParser Tests
// ============================================

describe('FrameParser', () => {
  let parser;

  beforeEach(() => {
    parser = new FrameParser();
  });

  describe('feed', () => {
    it('should parse complete frame', () => {
      const payload = Buffer.from('hello world');
      const frame = new Frame(MessageType.DATA, MessageFlags.NONE, payload);
      const buffer = frame.toBuffer();
      
      const { frames, error } = parser.feed(buffer);
      
      expect(error).toBeNull();
      expect(frames.length).toBe(1);
      expect(frames[0].type).toBe(MessageType.DATA);
      expect(frames[0].payload.toString()).toBe('hello world');
    });

    it('should handle partial data', () => {
      const payload = Buffer.from('test');
      const frame = new Frame(MessageType.DATA, MessageFlags.NONE, payload);
      const buffer = frame.toBuffer();
      
      // Feed first half
      const { frames: frames1 } = parser.feed(buffer.slice(0, 5));
      expect(frames1.length).toBe(0);
      
      // Feed rest
      const { frames: frames2 } = parser.feed(buffer.slice(5));
      expect(frames2.length).toBe(1);
    });

    it('should parse multiple frames', () => {
      const frame1 = new Frame(MessageType.DATA, MessageFlags.NONE, Buffer.from('first'));
      const frame2 = new Frame(MessageType.PING, MessageFlags.NONE, Buffer.alloc(8));
      
      const buffer = Buffer.concat([frame1.toBuffer(), frame2.toBuffer()]);
      const { frames, error } = parser.feed(buffer);
      
      expect(error).toBeNull();
      expect(frames.length).toBe(2);
      expect(frames[0].type).toBe(MessageType.DATA);
      expect(frames[1].type).toBe(MessageType.PING);
    });

    it('should reject invalid magic', () => {
      const buffer = Buffer.alloc(FRAME_HEADER_SIZE);
      buffer.writeUInt32BE(0xDEADBEEF, 0); // Invalid magic
      
      const { frames, error } = parser.feed(buffer);
      
      expect(error).not.toBeNull();
      expect(error.code).toBe('invalid_magic');
    });

    it('should reject oversized frame', () => {
      const parser = new FrameParser({ maxFrameSize: 100 });
      
      // Create a frame larger than max
      const largePayload = Buffer.alloc(200);
      const frame = new Frame(MessageType.DATA, MessageFlags.NONE, largePayload);
      const buffer = frame.toBuffer();
      
      const { frames, error } = parser.feed(buffer);
      
      expect(error).not.toBeNull();
      expect(error.code).toBe('frame_too_large');
    });

    it('should reject invalid message type', () => {
      const buffer = Buffer.alloc(FRAME_HEADER_SIZE);
      buffer.writeUInt32BE(FRAME_MAGIC, 0);
      buffer.writeUInt32BE(6, 4); // length
      buffer.writeUInt8(0xFF, 8); // Invalid type
      
      const { frames, error } = parser.feed(buffer);
      
      expect(error).not.toBeNull();
      expect(error.code).toBe('invalid_type');
    });
  });

  describe('reset', () => {
    it('should reset parser state', () => {
      const partialData = Buffer.alloc(5);
      parser.feed(partialData);
      
      parser.reset();
      
      expect(parser.buffer.length).toBe(0);
      expect(parser.state).toBe('magic');
    });
  });
});

// ============================================
// Connection Tests
// ============================================

describe('Connection', () => {
  let connection;

  beforeEach(() => {
    connection = new Connection({
      id: 'test-conn-1',
      peerId: 'peer-123',
      transportType: 'tcp'
    });
  });

  describe('constructor', () => {
    it('should create connection with options', () => {
      expect(connection.id).toBe('test-conn-1');
      expect(connection.peerId).toBe('peer-123');
      expect(connection.transportType).toBe('tcp');
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should generate ID if not provided', () => {
      const conn = new Connection();
      expect(conn.id).toMatch(/^conn_/);
    });
  });

  describe('isConnected', () => {
    it('should return false initially', () => {
      expect(connection.isConnected).toBe(false);
    });

    it('should return true when connected', () => {
      connection.state = ConnectionState.CONNECTED;
      expect(connection.isConnected).toBe(true);
    });
  });

  describe('uptime', () => {
    it('should return 0 if not connected', () => {
      expect(connection.uptime).toBe(0);
    });

    it('should return seconds since connection', () => {
      connection.connectedAt = Date.now() - 5000;
      expect(connection.uptime).toBeGreaterThanOrEqual(4);
    });
  });

  describe('getStats', () => {
    it('should return connection statistics', () => {
      const stats = connection.getStats();
      
      expect(stats.id).toBe('test-conn-1');
      expect(stats.peerId).toBe('peer-123');
      expect(stats.state).toBe(ConnectionState.DISCONNECTED);
      expect(stats.bytesReceived).toBe(0);
      expect(stats.bytesSent).toBe(0);
    });
  });

  describe('events', () => {
    it('should emit events', () => {
      const handler = vi.fn();
      connection.on(ConnectionEvents.DATA, handler);
      
      connection.emit(ConnectionEvents.DATA, { data: Buffer.from('test') });
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should update state on close', async () => {
      await connection.close('test');
      
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should emit disconnected event when closing from connected state', async () => {
      const handler = vi.fn();
      connection.on(ConnectionEvents.DISCONNECTED, handler);
      
      // Simulate connected state
      connection.state = ConnectionState.CONNECTED;
      connection._destroyed = false;
      
      await connection.close('test');
      
      // Event should be called with connectionId and reason
      expect(handler).toHaveBeenCalled();
      const callArgs = handler.mock.calls[0][0];
      expect(callArgs.connectionId).toBe('test-conn-1');
      expect(callArgs.reason).toBe('test');
    });
  });
});

// ============================================
// ConnectionPool Tests
// ============================================

describe('ConnectionPool', () => {
  let pool;

  beforeEach(() => {
    pool = new ConnectionPool({ maxSize: 10 });
  });

  afterEach(async () => {
    await pool.stop();
  });

  describe('constructor', () => {
    it('should create pool with options', () => {
      expect(pool.size).toBe(0);
      expect(pool.isFull).toBe(false);
      expect(pool.isEmpty).toBe(true);
    });
  });

  describe('add', () => {
    it('should add connection to pool', () => {
      const conn = new Connection({ id: 'conn-1', peerId: 'peer-1' });
      pool.add(conn);
      
      expect(pool.size).toBe(1);
      expect(pool.has('conn-1')).toBe(true);
    });

    it('should index by peer ID', () => {
      const conn = new Connection({ id: 'conn-1', peerId: 'peer-1' });
      pool.add(conn);
      
      const peerConns = pool.getByPeerId('peer-1');
      expect(peerConns.length).toBe(1);
      expect(peerConns[0].id).toBe('conn-1');
    });

    it('should reject when pool is full', () => {
      const smallPool = new ConnectionPool({ maxSize: 2 });
      
      smallPool.add(new Connection({ id: 'conn-1' }));
      smallPool.add(new Connection({ id: 'conn-2' }));
      
      expect(() => smallPool.add(new Connection({ id: 'conn-3' })))
        .toThrow('Connection pool is full');
    });

    it('should emit connection_added event', () => {
      const handler = vi.fn();
      pool.on(PoolEvents.CONNECTION_ADDED, handler);
      
      pool.add(new Connection({ id: 'conn-1' }));
      
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should remove connection from pool', async () => {
      const conn = new Connection({ id: 'conn-1', peerId: 'peer-1' });
      pool.add(conn);
      
      await pool.remove('conn-1');
      
      expect(pool.size).toBe(0);
      expect(pool.has('conn-1')).toBe(false);
    });

    it('should update peer index', async () => {
      const conn = new Connection({ id: 'conn-1', peerId: 'peer-1' });
      pool.add(conn);
      
      await pool.remove('conn-1');
      
      expect(pool.getByPeerId('peer-1').length).toBe(0);
    });
  });

  describe('get', () => {
    it('should return connection by ID', () => {
      const conn = new Connection({ id: 'conn-1' });
      pool.add(conn);
      
      expect(pool.get('conn-1')).toBe(conn);
    });

    it('should return undefined for unknown ID', () => {
      expect(pool.get('unknown')).toBeUndefined();
    });
  });

  describe('broadcast', () => {
    it('should send to all connections', async () => {
      // Create mock connections
      const conn1 = new Connection({ id: 'conn-1' });
      const conn2 = new Connection({ id: 'conn-2' });
      
      conn1.state = ConnectionState.CONNECTED;
      conn2.state = ConnectionState.CONNECTED;
      
      conn1.send = vi.fn().mockResolvedValue(10);
      conn2.send = vi.fn().mockResolvedValue(10);
      
      pool.add(conn1);
      pool.add(conn2);
      
      const result = await pool.broadcast(Buffer.from('test'));
      
      expect(result.total).toBe(2);
      expect(result.successful).toBe(2);
    });

    it('should exclude specified connections', async () => {
      const conn1 = new Connection({ id: 'conn-1' });
      const conn2 = new Connection({ id: 'conn-2' });
      
      conn1.state = ConnectionState.CONNECTED;
      conn2.state = ConnectionState.CONNECTED;
      
      conn1.send = vi.fn().mockResolvedValue(10);
      conn2.send = vi.fn().mockResolvedValue(10);
      
      pool.add(conn1);
      pool.add(conn2);
      
      const result = await pool.broadcast(Buffer.from('test'), ['conn-1']);
      
      expect(result.total).toBe(1);
      expect(conn1.send).not.toHaveBeenCalled();
      expect(conn2.send).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return pool statistics', () => {
      pool.add(new Connection({ id: 'conn-1' }));
      
      const stats = pool.getStats();
      
      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(10);
      expect(stats.totalCreated).toBe(1);
    });
  });
});

// ============================================
// Integration Tests
// ============================================

describe('Transport Integration', () => {
  it('should encode and decode frame correctly', () => {
    const originalPayload = Buffer.from('Hello, NewZoneCore!');
    const originalFrame = new Frame(MessageType.DATA, MessageFlags.ENCRYPTED, originalPayload);
    
    // Encode
    const buffer = originalFrame.toBuffer();
    
    // Decode
    const parser = new FrameParser();
    const { frames, error } = parser.feed(buffer);
    
    expect(error).toBeNull();
    expect(frames.length).toBe(1);
    expect(frames[0].type).toBe(MessageType.DATA);
    expect(frames[0].hasFlag(MessageFlags.ENCRYPTED)).toBe(true);
    expect(frames[0].payload.toString()).toBe('Hello, NewZoneCore!');
  });

  it('should handle large payloads', () => {
    const largePayload = Buffer.alloc(10000, 'x');
    const frame = new Frame(MessageType.DATA, MessageFlags.NONE, largePayload);
    
    const buffer = frame.toBuffer();
    
    expect(buffer.length).toBe(FRAME_HEADER_SIZE + largePayload.length);
    
    const parser = new FrameParser();
    const { frames } = parser.feed(buffer);
    
    expect(frames[0].payload.length).toBe(10000);
  });

  it('should handle fragmented data correctly', () => {
    const payload = Buffer.from('fragmented data test');
    const frame = new Frame(MessageType.DATA, MessageFlags.NONE, payload);
    const buffer = frame.toBuffer();
    
    const parser = new FrameParser();
    
    // Feed in small chunks
    const chunkSize = 3;
    let allFrames = [];
    
    for (let i = 0; i < buffer.length; i += chunkSize) {
      const chunk = buffer.slice(i, Math.min(i + chunkSize, buffer.length));
      const { frames } = parser.feed(chunk);
      allFrames = allFrames.concat(frames);
    }
    
    expect(allFrames.length).toBe(1);
    expect(allFrames[0].payload.toString()).toBe('fragmented data test');
  });
});
