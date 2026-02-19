// Module: Wire Format
// Description: Wire protocol format for NewZoneCore network.
// File: network/protocol/wire-format.js

import { EventEmitter } from 'events';

/**
 * Protocol Version
 */
export const PROTOCOL_VERSION = 1;

/**
 * Message Types
 */
export const WireMessageType = {
  // Handshake
  HELLO: 0x01,
  HELLO_ACK: 0x02,
  AUTH: 0x03,
  AUTH_ACK: 0x04,
  
  // Data
  DATA: 0x10,
  DATA_ACK: 0x11,
  DATA_FRAGMENT: 0x12,
  
  // Control
  PING: 0x20,
  PONG: 0x21,
  DISCONNECT: 0x22,
  
  // DHT
  DHT_FIND_NODE: 0x30,
  DHT_FIND_NODE_RESP: 0x31,
  DHT_FIND_VALUE: 0x32,
  DHT_FIND_VALUE_RESP: 0x33,
  DHT_STORE: 0x34,
  DHT_STORE_ACK: 0x35,
  
  // Discovery
  PEER_ANNOUNCE: 0x40,
  PEER_REQUEST: 0x41,
  PEER_RESPONSE: 0x42,
  
  // Error
  ERROR: 0xFF
};

/**
 * Message Flags
 */
export const WireFlags = {
  NONE: 0x00,
  COMPRESSED: 0x01,
  ENCRYPTED: 0x02,
  PRIORITY: 0x04,
  REQUEST_ACK: 0x08,
  FRAGMENT_MORE: 0x10,
  FRAGMENT_LAST: 0x20,
  BROADCAST: 0x40
};

/**
 * Error Codes
 */
export const WireErrorCode = {
  UNKNOWN: 0x0000,
  PROTOCOL_ERROR: 0x0001,
  VERSION_MISMATCH: 0x0002,
  AUTH_FAILED: 0x0003,
  MESSAGE_TOO_LARGE: 0x0004,
  INVALID_MESSAGE: 0x0005,
  TIMEOUT: 0x0006,
  SHUTDOWN: 0x0007,
  RATE_LIMITED: 0x0008
};

/**
 * Wire Header Size
 */
export const WIRE_HEADER_SIZE = 16;

/**
 * Max Message Size (1 MB)
 */
export const MAX_MESSAGE_SIZE = 1024 * 1024;

/**
 * Wire Header Structure
 * 
 * [0-1]   Protocol Version (uint16)
 * [2-3]   Message Type (uint16)
 * [4-5]   Flags (uint16)
 * [6-9]   Sequence Number (uint32)
 * [10-13] Payload Length (uint32)
 * [14-15] Reserved (uint16)
 * [16+]   Payload
 */
export class WireHeader {
  constructor(options = {}) {
    this.version = options.version || PROTOCOL_VERSION;
    this.type = options.type || WireMessageType.DATA;
    this.flags = options.flags || WireFlags.NONE;
    this.sequence = options.sequence || 0;
    this.length = options.length || 0;
    this.reserved = options.reserved || 0;
  }

  /**
   * Serialize header to buffer
   */
  toBuffer() {
    const buffer = Buffer.alloc(WIRE_HEADER_SIZE);
    
    buffer.writeUInt16BE(this.version, 0);
    buffer.writeUInt16BE(this.type, 2);
    buffer.writeUInt16BE(this.flags, 4);
    buffer.writeUInt32BE(this.sequence, 6);
    buffer.writeUInt32BE(this.length, 10);
    buffer.writeUInt16BE(this.reserved, 14);
    
    return buffer;
  }

  /**
   * Parse header from buffer
   */
  static fromBuffer(buffer) {
    if (buffer.length < WIRE_HEADER_SIZE) {
      throw new Error('Buffer too small for wire header');
    }
    
    return new WireHeader({
      version: buffer.readUInt16BE(0),
      type: buffer.readUInt16BE(2),
      flags: buffer.readUInt16BE(4),
      sequence: buffer.readUInt32BE(6),
      length: buffer.readUInt32BE(10),
      reserved: buffer.readUInt16BE(14)
    });
  }
}

/**
 * Wire Message
 */
export class WireMessage {
  constructor(options = {}) {
    this.header = options.header instanceof WireHeader 
      ? options.header 
      : new WireHeader(options.header || {});
    
    this.payload = options.payload || Buffer.alloc(0);
    
    // Update header length
    this.header.length = this.payload.length;
  }

  /**
   * Get message type
   */
  get type() {
    return this.header.type;
  }

  /**
   * Get flags
   */
  get flags() {
    return this.header.flags;
  }

  /**
   * Get sequence number
   */
  get sequence() {
    return this.header.sequence;
  }

  /**
   * Get total size
   */
  get size() {
    return WIRE_HEADER_SIZE + this.payload.length;
  }

  /**
   * Check flag
   */
  hasFlag(flag) {
    return (this.header.flags & flag) !== 0;
  }

  /**
   * Set flag
   */
  setFlag(flag) {
    this.header.flags |= flag;
    return this;
  }

  /**
   * Serialize message to buffer
   */
  toBuffer() {
    const headerBuffer = this.header.toBuffer();
    return Buffer.concat([headerBuffer, this.payload]);
  }

  /**
   * Parse message from buffer
   */
  static fromBuffer(buffer) {
    const header = WireHeader.fromBuffer(buffer);
    const payload = buffer.slice(WIRE_HEADER_SIZE, WIRE_HEADER_SIZE + header.length);
    
    return new WireMessage({ header, payload });
  }

  /**
   * Create data message
   */
  static data(payload, sequence = 0) {
    return new WireMessage({
      header: {
        type: WireMessageType.DATA,
        sequence
      },
      payload: Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
    });
  }

  /**
   * Create ping message
   */
  static ping(sequence = 0) {
    const payload = Buffer.alloc(8);
    payload.writeBigInt64BE(BigInt(Date.now()), 0);
    
    return new WireMessage({
      header: {
        type: WireMessageType.PING,
        sequence
      },
      payload
    });
  }

  /**
   * Create pong message
   */
  static pong(pingMessage, sequence = 0) {
    return new WireMessage({
      header: {
        type: WireMessageType.PONG,
        sequence
      },
      payload: pingMessage.payload
    });
  }

  /**
   * Create error message
   */
  static error(code, message, sequence = 0) {
    const payload = Buffer.alloc(4 + Buffer.byteLength(message));
    payload.writeUInt16BE(code, 0);
    payload.writeUInt16BE(Buffer.byteLength(message), 2);
    Buffer.from(message).copy(payload, 4);
    
    return new WireMessage({
      header: {
        type: WireMessageType.ERROR,
        sequence
      },
      payload
    });
  }

  /**
   * Create disconnect message
   */
  static disconnect(reason = '', sequence = 0) {
    return new WireMessage({
      header: {
        type: WireMessageType.DISCONNECT,
        sequence
      },
      payload: Buffer.from(reason)
    });
  }
}

/**
 * Wire Message Parser
 */
export class WireParser {
  constructor(options = {}) {
    this.maxMessageSize = options.maxMessageSize || MAX_MESSAGE_SIZE;
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Feed data to parser
   */
  feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    
    const messages = [];
    
    while (this.buffer.length >= WIRE_HEADER_SIZE) {
      // Peek header to get message length
      const length = this.buffer.readUInt32BE(10);
      const totalSize = WIRE_HEADER_SIZE + length;
      
      // Check max size
      if (totalSize > this.maxMessageSize) {
        this.buffer = Buffer.alloc(0);
        return {
          messages,
          error: { code: WireErrorCode.MESSAGE_TOO_LARGE, message: 'Message exceeds max size' }
        };
      }
      
      // Check if complete
      if (this.buffer.length < totalSize) {
        break;
      }
      
      // Extract message
      const messageBuffer = this.buffer.slice(0, totalSize);
      this.buffer = this.buffer.slice(totalSize);
      
      try {
        const message = WireMessage.fromBuffer(messageBuffer);
        messages.push(message);
      } catch (e) {
        return {
          messages,
          error: { code: WireErrorCode.INVALID_MESSAGE, message: e.message }
        };
      }
    }
    
    return { messages, error: null };
  }

  /**
   * Reset parser
   */
  reset() {
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * Sequence Number Generator
 */
export class SequenceGenerator {
  constructor(start = 0) {
    this._sequence = start;
  }

  /**
   * Get next sequence number
   */
  next() {
    const seq = this._sequence;
    this._sequence = (this._sequence + 1) >>> 0; // Wrap at 32-bit
    return seq;
  }

  /**
   * Get current sequence
   */
  current() {
    return this._sequence;
  }

  /**
   * Reset sequence
   */
  reset(start = 0) {
    this._sequence = start;
  }
}

export default {
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
};
