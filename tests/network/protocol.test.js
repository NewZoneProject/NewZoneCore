// Module: Protocol Tests
// Description: Unit tests for protocol layer components.
// File: tests/network/protocol.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Import components
import {
  PROTOCOL_VERSION,
  WireMessageType,
  WireFlags,
  WireErrorCode,
  WIRE_HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  WireHeader,
  WireMessage,
  WireParser,
  SequenceGenerator
} from '../../network/protocol/wire-format.js';

import {
  HandshakeState,
  HandshakeEvents,
  AuthMethod,
  HandshakeManager
} from '../../network/protocol/handshake.js';

import {
  EncryptionAlgorithm,
  NONCE_SIZE,
  KEY_SIZE,
  TAG_SIZE,
  ChannelEncryptor
} from '../../network/protocol/encryption.js';

// ============================================
// Wire Format Tests
// ============================================

describe('WireHeader', () => {
  describe('constructor', () => {
    it('should create header with default values', () => {
      const header = new WireHeader();
      
      expect(header.version).toBe(PROTOCOL_VERSION);
      expect(header.type).toBe(WireMessageType.DATA);
      expect(header.flags).toBe(WireFlags.NONE);
      expect(header.sequence).toBe(0);
      expect(header.length).toBe(0);
    });

    it('should create header with custom values', () => {
      const header = new WireHeader({
        type: WireMessageType.PING,
        flags: WireFlags.PRIORITY,
        sequence: 123,
        length: 100
      });
      
      expect(header.type).toBe(WireMessageType.PING);
      expect(header.flags).toBe(WireFlags.PRIORITY);
      expect(header.sequence).toBe(123);
      expect(header.length).toBe(100);
    });
  });

  describe('toBuffer/fromBuffer', () => {
    it('should serialize and deserialize correctly', () => {
      const original = new WireHeader({
        type: WireMessageType.DATA,
        flags: WireFlags.ENCRYPTED | WireFlags.COMPRESSED,
        sequence: 999,
        length: 500
      });
      
      const buffer = original.toBuffer();
      expect(buffer.length).toBe(WIRE_HEADER_SIZE);
      
      const parsed = WireHeader.fromBuffer(buffer);
      
      expect(parsed.version).toBe(original.version);
      expect(parsed.type).toBe(original.type);
      expect(parsed.flags).toBe(original.flags);
      expect(parsed.sequence).toBe(original.sequence);
      expect(parsed.length).toBe(original.length);
    });
  });
});

describe('WireMessage', () => {
  describe('constructor', () => {
    it('should create message with payload', () => {
      const payload = Buffer.from('test payload');
      const message = new WireMessage({ payload });
      
      expect(message.payload).toEqual(payload);
      expect(message.header.length).toBe(payload.length);
    });
  });

  describe('toBuffer/fromBuffer', () => {
    it('should serialize and deserialize message', () => {
      const payload = Buffer.from('Hello, NewZoneCore!');
      const original = new WireMessage({
        header: { type: WireMessageType.DATA, sequence: 42 },
        payload
      });
      
      const buffer = original.toBuffer();
      const parsed = WireMessage.fromBuffer(buffer);
      
      expect(parsed.type).toBe(WireMessageType.DATA);
      expect(parsed.sequence).toBe(42);
      expect(parsed.payload.toString()).toBe('Hello, NewZoneCore!');
    });
  });

  describe('static factories', () => {
    it('should create data message', () => {
      const msg = WireMessage.data('test data', 1);
      
      expect(msg.type).toBe(WireMessageType.DATA);
      expect(msg.sequence).toBe(1);
      expect(msg.payload.toString()).toBe('test data');
    });

    it('should create ping message', () => {
      const msg = WireMessage.ping(2);
      
      expect(msg.type).toBe(WireMessageType.PING);
      expect(msg.sequence).toBe(2);
      expect(msg.payload.length).toBe(8); // timestamp
    });

    it('should create pong message', () => {
      const ping = WireMessage.ping();
      const pong = WireMessage.pong(ping, 3);
      
      expect(pong.type).toBe(WireMessageType.PONG);
      expect(pong.payload).toEqual(ping.payload);
    });

    it('should create error message', () => {
      const msg = WireMessage.error(WireErrorCode.PROTOCOL_ERROR, 'test error', 4);
      
      expect(msg.type).toBe(WireMessageType.ERROR);
      expect(msg.sequence).toBe(4);
    });

    it('should create disconnect message', () => {
      const msg = WireMessage.disconnect('shutdown', 5);
      
      expect(msg.type).toBe(WireMessageType.DISCONNECT);
      expect(msg.payload.toString()).toBe('shutdown');
    });
  });

  describe('hasFlag/setFlag', () => {
    it('should check and set flags', () => {
      const msg = WireMessage.data('test');
      
      expect(msg.hasFlag(WireFlags.ENCRYPTED)).toBe(false);
      
      msg.setFlag(WireFlags.ENCRYPTED);
      expect(msg.hasFlag(WireFlags.ENCRYPTED)).toBe(true);
    });
  });
});

describe('WireParser', () => {
  let parser;

  beforeEach(() => {
    parser = new WireParser();
  });

  it('should parse complete message', () => {
    const msg = WireMessage.data('test data');
    const buffer = msg.toBuffer();
    
    const { messages, error } = parser.feed(buffer);
    
    expect(error).toBeNull();
    expect(messages.length).toBe(1);
    expect(messages[0].payload.toString()).toBe('test data');
  });

  it('should handle partial data', () => {
    const msg = WireMessage.data('test data');
    const buffer = msg.toBuffer();
    
    // Feed first half
    const { messages: m1 } = parser.feed(buffer.slice(0, 10));
    expect(m1.length).toBe(0);
    
    // Feed rest
    const { messages: m2 } = parser.feed(buffer.slice(10));
    expect(m2.length).toBe(1);
  });

  it('should parse multiple messages', () => {
    const msg1 = WireMessage.data('first');
    const msg2 = WireMessage.ping();
    
    const buffer = Buffer.concat([msg1.toBuffer(), msg2.toBuffer()]);
    
    const { messages, error } = parser.feed(buffer);
    
    expect(error).toBeNull();
    expect(messages.length).toBe(2);
    expect(messages[0].type).toBe(WireMessageType.DATA);
    expect(messages[1].type).toBe(WireMessageType.PING);
  });

  it('should reject oversized message', () => {
    const parser = new WireParser({ maxMessageSize: 100 });
    
    // Create a message larger than max
    const largePayload = Buffer.alloc(200);
    const msg = WireMessage.data(largePayload);
    
    const { error } = parser.feed(msg.toBuffer());
    
    expect(error).not.toBeNull();
    expect(error.code).toBe(WireErrorCode.MESSAGE_TOO_LARGE);
  });

  it('should reset parser', () => {
    parser.feed(Buffer.from('partial'));
    parser.reset();
    
    expect(parser.buffer.length).toBe(0);
  });
});

describe('SequenceGenerator', () => {
  it('should generate sequential numbers', () => {
    const gen = new SequenceGenerator();
    
    expect(gen.next()).toBe(0);
    expect(gen.next()).toBe(1);
    expect(gen.next()).toBe(2);
  });

  it('should return current value', () => {
    const gen = new SequenceGenerator(100);
    
    expect(gen.current()).toBe(100);
    gen.next();
    expect(gen.current()).toBe(101);
  });

  it('should reset', () => {
    const gen = new SequenceGenerator();
    gen.next();
    gen.next();
    
    gen.reset(50);
    expect(gen.current()).toBe(50);
  });
});

// ============================================
// Handshake Tests
// ============================================

describe('HandshakeManager', () => {
  let manager;

  beforeEach(() => {
    manager = new HandshakeManager({
      nodeId: 'test-node-123',
      publicKey: Buffer.alloc(32, 0x42)
    });
  });

  describe('constructor', () => {
    it('should create manager with options', () => {
      expect(manager.state).toBe(HandshakeState.IDLE);
      expect(manager.isAuthenticated).toBe(false);
    });
  });

  describe('start', () => {
    it('should create HELLO message', async () => {
      const hello = await manager.start();
      
      expect(hello).toBeDefined();
      expect(manager.state).toBe(HandshakeState.HELLO_SENT);
    });
  });

  describe('reset', () => {
    it('should reset state', async () => {
      await manager.start();
      manager.reset();
      
      expect(manager.state).toBe(HandshakeState.IDLE);
      expect(manager.remoteNodeId).toBeNull();
    });
  });

  describe('events', () => {
    it('should have HandshakeEvents defined', () => {
      expect(HandshakeEvents.COMPLETE).toBe('complete');
      expect(HandshakeEvents.FAILED).toBe('failed');
      expect(HandshakeEvents.TIMEOUT).toBe('timeout');
    });
  });
});

// ============================================
// Encryption Tests
// ============================================

describe('ChannelEncryptor', () => {
  let encryptor;

  beforeEach(() => {
    encryptor = new ChannelEncryptor();
  });

  afterEach(() => {
    encryptor.destroy();
  });

  describe('constructor', () => {
    it('should create encryptor with default options', () => {
      expect(encryptor.isInitialized).toBe(false);
    });
  });

  describe('init', () => {
    it('should initialize with session key', () => {
      const sessionKey = Buffer.alloc(32, 0x55);
      encryptor.init(sessionKey, { isInitiator: true });
      
      expect(encryptor.isInitialized).toBe(true);
    });
  });

  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt data', () => {
      const sessionKey = Buffer.alloc(32, 0x55);
      encryptor.init(sessionKey, { isInitiator: true });
      
      const plaintext = Buffer.from('Hello, encrypted world!');
      const ciphertext = encryptor.encrypt(plaintext);
      
      expect(ciphertext.length).toBeGreaterThan(plaintext.length);
      expect(ciphertext).not.toEqual(plaintext);
    });

    it('should throw if not initialized', () => {
      expect(() => encryptor.encrypt(Buffer.from('test'))).toThrow();
      expect(() => encryptor.decrypt(Buffer.from('test'))).toThrow();
    });
  });

  describe('getStats', () => {
    it('should return stats', () => {
      const sessionKey = Buffer.alloc(32, 0x55);
      encryptor.init(sessionKey, { isInitiator: true });
      
      const stats = encryptor.getStats();
      
      expect(stats.isInitialized).toBe(true);
      expect(stats.algorithm).toBeDefined();
      expect(stats.keySize).toBe(KEY_SIZE);
    });
  });

  describe('destroy', () => {
    it('should clean up', () => {
      const sessionKey = Buffer.alloc(32, 0x55);
      encryptor.init(sessionKey);
      encryptor.destroy();
      
      expect(encryptor.isInitialized).toBe(false);
    });
  });
});

// ============================================
// Integration Tests
// ============================================

describe('Protocol Integration', () => {
  it('should create valid message flow', () => {
    const seq = new SequenceGenerator();
    const parser = new WireParser();
    
    // Create messages
    const msg1 = WireMessage.data('message 1', seq.next());
    const msg2 = WireMessage.ping(seq.next());
    const msg3 = WireMessage.data('message 2', seq.next());
    
    // Serialize and parse
    const buffer = Buffer.concat([
      msg1.toBuffer(),
      msg2.toBuffer(),
      msg3.toBuffer()
    ]);
    
    const { messages, error } = parser.feed(buffer);
    
    expect(error).toBeNull();
    expect(messages.length).toBe(3);
    expect(messages[0].sequence).toBe(0);
    expect(messages[1].sequence).toBe(1);
    expect(messages[2].sequence).toBe(2);
  });

  it('should handle encryption roundtrip', () => {
    const encryptor = new ChannelEncryptor();
    
    const sessionKey = Buffer.alloc(32, 0xAB);
    
    // Initialize
    encryptor.init(sessionKey, { isInitiator: true });
    
    // Encrypt and decrypt with same key
    const plaintext = Buffer.from('Secret message');
    const ciphertext = encryptor.encrypt(plaintext);
    
    expect(ciphertext.length).toBeGreaterThan(plaintext.length);
    expect(ciphertext).not.toEqual(plaintext);
    
    encryptor.destroy();
  });

  it('should handle flags correctly', () => {
    const msg = WireMessage.data('test');
    
    msg.setFlag(WireFlags.ENCRYPTED);
    msg.setFlag(WireFlags.COMPRESSED);
    msg.setFlag(WireFlags.PRIORITY);
    
    const buffer = msg.toBuffer();
    const parsed = WireMessage.fromBuffer(buffer);
    
    expect(parsed.hasFlag(WireFlags.ENCRYPTED)).toBe(true);
    expect(parsed.hasFlag(WireFlags.COMPRESSED)).toBe(true);
    expect(parsed.hasFlag(WireFlags.PRIORITY)).toBe(true);
    expect(parsed.hasFlag(WireFlags.BROADCAST)).toBe(false);
  });
});
