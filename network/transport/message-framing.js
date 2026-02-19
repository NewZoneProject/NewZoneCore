// Module: Message Framing
// Description: Message framing for transport layer - handles message boundaries.
// File: network/transport/message-framing.js

/**
 * Message frame format:
 * 
 * [Magic: 4 bytes][Length: 4 bytes][Type: 1 byte][Flags: 1 byte][Payload: N bytes]
 * 
 * - Magic: 0x4E5A434F ("NZCO" - NewZoneCore)
 * - Length: Total frame length (excluding magic)
 * - Type: Message type
 * - Flags: Message flags
 * - Payload: Actual message data
 */

/**
 * Frame magic bytes "NZCO"
 */
export const FRAME_MAGIC = 0x4E5A434F;

/**
 * Frame header size
 */
export const FRAME_HEADER_SIZE = 10; // 4 (magic) + 4 (length) + 1 (type) + 1 (flags)

/**
 * Maximum frame size (16 MB)
 */
export const MAX_FRAME_SIZE = 16 * 1024 * 1024;

/**
 * Message types
 */
export const MessageType = {
  DATA: 0x01,           // Regular data message
  CONTROL: 0x02,        // Control message
  PING: 0x03,           // Ping request
  PONG: 0x04,           // Ping response
  HANDSHAKE: 0x05,      // Handshake message
  ACK: 0x06,            // Acknowledgment
  ERROR: 0x07,          // Error message
  DISCONNECT: 0x08,     // Disconnect notification
  FRAGMENTED: 0x09,     // Fragmented message part
  COMPRESSED: 0x0A      // Compressed message
};

/**
 * Message flags
 */
export const MessageFlags = {
  NONE: 0x00,
  COMPRESSED: 0x01,     // Payload is compressed
  ENCRYPTED: 0x02,      // Payload is encrypted
  PRIORITY: 0x04,       // High priority message
  REQUEST_ACK: 0x08,    // Request acknowledgment
  LAST_FRAGMENT: 0x10,  // Last fragment in sequence
  FIRST_FRAGMENT: 0x20  // First fragment in sequence
};

/**
 * Frame parsing result
 */
export const ParseResult = {
  NEED_MORE: 'need_more',       // Need more data
  COMPLETE: 'complete',         // Frame is complete
  ERROR: 'error'                // Parse error
};

/**
 * Parse error codes
 */
export const ParseError = {
  INVALID_MAGIC: 'invalid_magic',
  FRAME_TOO_LARGE: 'frame_too_large',
  INVALID_TYPE: 'invalid_type',
  INVALID_LENGTH: 'invalid_length',
  CORRUPTED: 'corrupted'
};

/**
 * Frame class - represents a single message frame
 */
export class Frame {
  constructor(type = MessageType.DATA, flags = MessageFlags.NONE, payload = Buffer.alloc(0)) {
    this.type = type;
    this.flags = flags;
    this.payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  }

  /**
   * Get frame length (header + payload)
   */
  get length() {
    return FRAME_HEADER_SIZE + this.payload.length;
  }

  /**
   * Check if frame has a specific flag
   */
  hasFlag(flag) {
    return (this.flags & flag) !== 0;
  }

  /**
   * Add a flag
   */
  addFlag(flag) {
    this.flags |= flag;
    return this;
  }

  /**
   * Remove a flag
   */
  removeFlag(flag) {
    this.flags &= ~flag;
    return this;
  }

  /**
   * Serialize frame to buffer
   */
  toBuffer() {
    const totalLength = this.length;
    const buffer = Buffer.alloc(totalLength);
    
    // Write magic (4 bytes, big endian)
    buffer.writeUInt32BE(FRAME_MAGIC, 0);
    
    // Write length (4 bytes, big endian) - length of rest of frame
    buffer.writeUInt32BE(totalLength - 4, 4);
    
    // Write type (1 byte)
    buffer.writeUInt8(this.type, 8);
    
    // Write flags (1 byte)
    buffer.writeUInt8(this.flags, 9);
    
    // Write payload
    if (this.payload.length > 0) {
      this.payload.copy(buffer, FRAME_HEADER_SIZE);
    }
    
    return buffer;
  }

  /**
   * Create a data frame
   */
  static data(payload, flags = MessageFlags.NONE) {
    return new Frame(MessageType.DATA, flags, payload);
  }

  /**
   * Create a ping frame
   */
  static ping(payload = Buffer.alloc(8)) {
    // Include timestamp
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(BigInt(Date.now()), 0);
    return new Frame(MessageType.PING, MessageFlags.NONE, buffer);
  }

  /**
   * Create a pong frame
   */
  static pong(pingPayload) {
    return new Frame(MessageType.PONG, MessageFlags.NONE, pingPayload);
  }

  /**
   * Create a handshake frame
   */
  static handshake(payload) {
    return new Frame(MessageType.HANDSHAKE, MessageFlags.PRIORITY, payload);
  }

  /**
   * Create a disconnect frame
   */
  static disconnect(reason = '') {
    return new Frame(MessageType.DISCONNECT, MessageFlags.NONE, Buffer.from(reason));
  }

  /**
   * Create an error frame
   */
  static error(code, message) {
    const payload = JSON.stringify({ code, message });
    return new Frame(MessageType.ERROR, MessageFlags.NONE, payload);
  }
}

/**
 * FrameParser class - parses incoming data into frames
 */
export class FrameParser {
  constructor(options = {}) {
    this.maxFrameSize = options.maxFrameSize || MAX_FRAME_SIZE;
    this.buffer = Buffer.alloc(0);
    this.expectedLength = 0;
    this.state = 'magic'; // magic, header, payload
  }

  /**
   * Feed data to the parser
   * Returns array of complete frames and/or error
   */
  feed(data) {
    // Append new data to buffer
    this.buffer = Buffer.concat([this.buffer, data]);
    
    const frames = [];
    let error = null;
    
    while (true) {
      const result = this._parseNext();
      
      if (result.status === ParseResult.COMPLETE) {
        frames.push(result.frame);
        // Remove parsed data from buffer
        this.buffer = this.buffer.slice(result.bytesConsumed);
      } else if (result.status === ParseResult.NEED_MORE) {
        break;
      } else if (result.status === ParseResult.ERROR) {
        error = result.error;
        // Reset parser on error
        this.reset();
        break;
      }
    }
    
    return { frames, error };
  }

  /**
   * Reset parser state
   */
  reset() {
    this.buffer = Buffer.alloc(0);
    this.expectedLength = 0;
    this.state = 'magic';
  }

  /**
   * Parse next frame from buffer
   */
  _parseNext() {
    // Check for magic + length header
    if (this.buffer.length < 8) {
      return { status: ParseResult.NEED_MORE };
    }
    
    // Verify magic
    const magic = this.buffer.readUInt32BE(0);
    if (magic !== FRAME_MAGIC) {
      return {
        status: ParseResult.ERROR,
        error: {
          code: ParseError.INVALID_MAGIC,
          message: `Invalid frame magic: expected 0x${FRAME_MAGIC.toString(16)}, got 0x${magic.toString(16)}`
        }
      };
    }
    
    // Get frame length (after magic)
    const frameLength = this.buffer.readUInt32BE(4);
    
    // Validate frame length
    if (frameLength > this.maxFrameSize) {
      return {
        status: ParseResult.ERROR,
        error: {
          code: ParseError.FRAME_TOO_LARGE,
          message: `Frame too large: ${frameLength} bytes (max: ${this.maxFrameSize})`
        }
      };
    }
    
    // Check if we have complete frame
    const totalLength = 4 + frameLength; // magic + rest
    if (this.buffer.length < totalLength) {
      return { status: ParseResult.NEED_MORE };
    }
    
    // Parse frame
    const type = this.buffer.readUInt8(8);
    const flags = this.buffer.readUInt8(9);
    
    // Validate type
    if (!Object.values(MessageType).includes(type)) {
      return {
        status: ParseResult.ERROR,
        error: {
          code: ParseError.INVALID_TYPE,
          message: `Invalid message type: ${type}`
        }
      };
    }
    
    // Extract payload
    const payload = this.buffer.slice(FRAME_HEADER_SIZE, totalLength);
    
    const frame = new Frame(type, flags, payload);
    
    return {
      status: ParseResult.COMPLETE,
      frame,
      bytesConsumed: totalLength
    };
  }
}

/**
 * Utility functions
 */

/**
 * Check if buffer starts with valid frame magic
 */
export function isValidFrameStart(buffer) {
  if (buffer.length < 4) return null;
  return buffer.readUInt32BE(0) === FRAME_MAGIC;
}

/**
 * Calculate frame overhead
 */
export function getFrameOverhead() {
  return FRAME_HEADER_SIZE;
}

/**
 * Calculate max payload size
 */
export function getMaxPayloadSize(maxFrameSize = MAX_FRAME_SIZE) {
  return maxFrameSize - FRAME_HEADER_SIZE;
}

export default {
  Frame,
  FrameParser,
  FRAME_MAGIC,
  FRAME_HEADER_SIZE,
  MAX_FRAME_SIZE,
  MessageType,
  MessageFlags,
  ParseResult,
  ParseError
};
