// Module: DHT NodeID
// Description: Node identifier with XOR distance metric for Kademlia DHT.
// File: network/dht/node-id.js

import crypto from 'crypto';

/**
 * NodeID length in bytes (256-bit)
 */
export const NODE_ID_LENGTH = 32;

/**
 * NodeID class - represents a node identifier in Kademlia DHT
 */
export class NodeID {
  /**
   * Create NodeID from buffer or hex string
   */
  constructor(id) {
    if (typeof id === 'string') {
      this._buffer = Buffer.from(id, 'hex');
    } else if (Buffer.isBuffer(id)) {
      this._buffer = id;
    } else {
      throw new Error('NodeID must be Buffer or hex string');
    }
    
    if (this._buffer.length !== NODE_ID_LENGTH) {
      throw new Error(`NodeID must be ${NODE_ID_LENGTH} bytes, got ${this._buffer.length}`);
    }
  }

  /**
   * Get buffer representation
   */
  get buffer() {
    return this._buffer;
  }

  /**
   * Get hex string representation
   */
  get hex() {
    return this._buffer.toString('hex');
  }

  /**
   * Get length in bits
   */
  get bitLength() {
    return NODE_ID_LENGTH * 8;
  }

  /**
   * Create random NodeID
   */
  static random() {
    const buffer = crypto.randomBytes(NODE_ID_LENGTH);
    return new NodeID(buffer);
  }

  /**
   * Create NodeID from public key (deterministic)
   */
  static fromPublicKey(publicKey) {
    const hash = crypto.createHash('sha256').update(publicKey).digest();
    return new NodeID(hash);
  }

  /**
   * Create NodeID from string (hash)
   */
  static fromString(str) {
    const hash = crypto.createHash('sha256').update(str).digest();
    return new NodeID(hash);
  }

  /**
   * Calculate XOR distance to another NodeID
   * Returns a Buffer representing the distance
   */
  distance(other) {
    if (!other || !(other instanceof NodeID)) {
      throw new Error('distance() requires a NodeID argument');
    }
    
    const result = Buffer.alloc(NODE_ID_LENGTH);
    
    for (let i = 0; i < NODE_ID_LENGTH; i++) {
      result[i] = this._buffer[i] ^ other._buffer[i];
    }
    
    return result;
  }

  /**
   * Compare distance to another NodeID
   * Returns: negative if this < other, 0 if equal, positive if this > other
   */
  compare(other) {
    if (!other || !(other instanceof NodeID)) {
      throw new Error('compare() requires a NodeID argument');
    }
    
    for (let i = 0; i < NODE_ID_LENGTH; i++) {
      if (this._buffer[i] < other._buffer[i]) return -1;
      if (this._buffer[i] > other._buffer[i]) return 1;
    }
    
    return 0;
  }

  /**
   * Find the bucket index for a given NodeID relative to this one
   * Returns the index of the most significant differing bit (0-255)
   */
  bucketIndex(other) {
    const distance = this.distance(other);
    
    for (let i = 0; i < NODE_ID_LENGTH; i++) {
      if (distance[i] === 0) continue;
      
      // Find the position of the highest set bit in this byte
      for (let j = 7; j >= 0; j--) {
        if ((distance[i] >> j) & 1) {
          return (NODE_ID_LENGTH - 1 - i) * 8 + (7 - j);
        }
      }
    }
    
    return 0; // Same node
  }

  /**
   * Get the bit at a specific position
   */
  getBit(position) {
    if (position < 0 || position >= this.bitLength) {
      throw new Error('Bit position out of range');
    }
    
    const byteIndex = Math.floor(position / 8);
    const bitIndex = 7 - (position % 8);
    
    return (this._buffer[byteIndex] >> bitIndex) & 1;
  }

  /**
   * Set the bit at a specific position (returns new NodeID)
   */
  setBit(position, value) {
    if (position < 0 || position >= this.bitLength) {
      throw new Error('Bit position out of range');
    }
    
    const newBuffer = Buffer.from(this._buffer);
    const byteIndex = Math.floor(position / 8);
    const bitIndex = 7 - (position % 8);
    
    if (value) {
      newBuffer[byteIndex] |= (1 << bitIndex);
    } else {
      newBuffer[byteIndex] &= ~(1 << bitIndex);
    }
    
    return new NodeID(newBuffer);
  }

  /**
   * Get common prefix length with another NodeID
   */
  commonPrefixLength(other) {
    const distance = this.distance(other);
    
    for (let i = 0; i < NODE_ID_LENGTH; i++) {
      if (distance[i] !== 0) {
        // Count leading zeros in this byte
        let leadingZeros = 0;
        for (let j = 7; j >= 0; j--) {
          if ((distance[i] >> j) & 1) {
            break;
          }
          leadingZeros++;
        }
        return i * 8 + leadingZeros;
      }
    }
    
    return this.bitLength; // Identical
  }

  /**
   * Check if this NodeID is equal to another
   */
  equals(other) {
    if (!other || !(other instanceof NodeID)) {
      return false;
    }
    return this._buffer.equals(other._buffer);
  }

  /**
   * Convert to string (hex)
   */
  toString() {
    return this.hex;
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return this.hex;
  }

  /**
   * Create from JSON
   */
  static fromJSON(hex) {
    return new NodeID(hex);
  }

  /**
   * Check if a NodeID is in a specific range
   */
  inRange(start, end) {
    return this.compare(start) >= 0 && this.compare(end) < 0;
  }

  /**
   * Generate NodeID with specific prefix (for testing)
   */
  static withPrefix(prefix, prefixBits) {
    const buffer = crypto.randomBytes(NODE_ID_LENGTH);
    const bytesToSet = Math.ceil(prefixBits / 8);
    
    for (let i = 0; i < bytesToSet; i++) {
      buffer[i] = prefix[i] || 0;
    }
    
    // Clear remaining bits of the last partial byte
    if (prefixBits % 8 !== 0) {
      const lastByte = Math.floor(prefixBits / 8);
      const mask = 0xFF << (8 - (prefixBits % 8));
      buffer[lastByte] &= mask;
    }
    
    return new NodeID(buffer);
  }
}

/**
 * Compare two distances (as Buffers)
 */
export function compareDistances(a, b) {
  for (let i = 0; i < NODE_ID_LENGTH; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * Sort NodeIDs by distance from a reference point
 */
export function sortByDistance(nodes, reference) {
  return nodes.sort((a, b) => {
    const distA = reference.distance(a.id);
    const distB = reference.distance(b.id);
    return compareDistances(distA, distB);
  });
}

export default NodeID;
