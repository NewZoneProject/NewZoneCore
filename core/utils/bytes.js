// Module: Byte Utilities
// Description: Common byte manipulation utilities used across NewZoneCore.
// File: core/utils/bytes.js

import { Buffer } from 'buffer';

// ============================================================================
// TYPE CONVERSION
// ============================================================================

/**
 * Normalize input to Uint8Array.
 * Accepts: Uint8Array | Buffer | string | null
 */
export function toBytes(input) {
  if (input == null) return new Uint8Array(0);
  if (input instanceof Uint8Array) return input;
  if (Buffer.isBuffer(input)) return new Uint8Array(input);
  if (typeof input === 'string') {
    return new Uint8Array(Buffer.from(input, 'utf8'));
  }
  throw new Error('toBytes: unsupported input type');
}

/**
 * Convert to Buffer.
 */
export function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  throw new Error('toBuffer: unsupported input type');
}

/**
 * Convert bytes to hex string.
 */
export function toHex(bytes) {
  const buf = toBuffer(bytes);
  return buf.toString('hex');
}

/**
 * Convert bytes to base64 string.
 */
export function toBase64(bytes) {
  const buf = toBuffer(bytes);
  return buf.toString('base64');
}

/**
 * Convert hex string to bytes.
 */
export function fromHex(hex) {
  return Buffer.from(hex, 'hex');
}

/**
 * Convert base64 string to bytes.
 */
export function fromBase64(base64) {
  return Buffer.from(base64, 'base64');
}

// ============================================================================
// CONCATENATION
// ============================================================================

/**
 * Concatenate multiple byte arrays.
 */
export function concatBytes(...arrays) {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

/**
 * Concatenate Buffers.
 */
export function concatBuffers(...buffers) {
  return Buffer.concat(buffers.map(b => toBuffer(b)));
}

// ============================================================================
// COMPARISON
// ============================================================================

import { timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison of two byte arrays.
 */
export function constantTimeEquals(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  try {
    return timingSafeEqual(toBuffer(a), toBuffer(b));
  } catch {
    return false;
  }
}

/**
 * Simple comparison (not constant-time).
 */
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

// ============================================================================
// MANIPULATION
// ============================================================================

/**
 * XOR two byte arrays in place.
 */
export function xorInPlace(a, b, output = a) {
  if (a.length !== b.length) {
    throw new Error('Arrays must have same length');
  }

  for (let i = 0; i < a.length; i++) {
    output[i] = a[i] ^ b[i];
  }

  return output;
}

/**
 * XOR two byte arrays (returns new array).
 */
export function xor(a, b) {
  const result = new Uint8Array(a.length);
  xorInPlace(a, b, result);
  return result;
}

/**
 * Zero-fill a buffer (for secure wiping).
 */
export function zeroFill(buffer) {
  if (Buffer.isBuffer(buffer)) {
    buffer.fill(0);
  } else if (buffer instanceof Uint8Array) {
    buffer.fill(0);
  }
}

/**
 * Secure wipe (alias for zeroFill).
 */
export function wipe(buffer) {
  zeroFill(buffer);
}

// ============================================================================
// RANDOM
// ============================================================================

import { randomBytes } from 'crypto';

/**
 * Generate random bytes.
 */
export function randomBytesSync(length) {
  return new Uint8Array(randomBytes(length));
}

/**
 * Generate random hex string.
 */
export function randomHex(length) {
  return randomBytes(length).toString('hex');
}

/**
 * Generate random base64 string.
 */
export function randomBase64(length) {
  return randomBytes(length).toString('base64');
}

// ============================================================================
// PARSING
// ============================================================================

/**
 * Parse hex or base64 string to bytes.
 * Auto-detects format based on length and characters.
 */
export function parseBytes(str) {
  const trimmed = str.trim();

  // Check if hex (even length, only hex chars)
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return fromHex(trimmed);
  }

  // Try base64
  try {
    return fromBase64(trimmed);
  } catch {
    throw new Error('Invalid byte string (not hex or base64)');
  }
}

// ============================================================================
// INSPECTION
// ============================================================================

/**
 * Get byte array as formatted hex string with spaces.
 */
export function toHexSpaced(bytes, groupSize = 4) {
  const hex = toHex(bytes);
  let result = '';

  for (let i = 0; i < hex.length; i += groupSize) {
    if (result) result += ' ';
    result += hex.slice(i, i + groupSize);
  }

  return result;
}

/**
 * Get byte array as formatted dump.
 */
export function hexDump(bytes, bytesPerLine = 16) {
  const buf = toBuffer(bytes);
  let result = '';

  for (let i = 0; i < buf.length; i += bytesPerLine) {
    const line = buf.slice(i, i + bytesPerLine);

    // Offset
    result += i.toString(16).padStart(8, '0') + '  ';

    // Hex
    for (let j = 0; j < bytesPerLine; j++) {
      if (j > 0 && j % 8 === 0) result += ' ';
      if (j < line.length) {
        result += line[j].toString(16).padStart(2, '0') + ' ';
      } else {
        result += '   ';
      }
    }

    // ASCII
    result += ' |';
    for (let j = 0; j < line.length; j++) {
      const byte = line[j];
      result += (byte >= 32 && byte < 127) ? String.fromCharCode(byte) : '.';
    }
    result += '|\n';
  }

  return result;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  toBytes,
  toBuffer,
  toHex,
  toBase64,
  fromHex,
  fromBase64,
  concatBytes,
  concatBuffers,
  constantTimeEquals,
  bytesEqual,
  xor,
  xorInPlace,
  zeroFill,
  wipe,
  randomBytesSync,
  randomHex,
  randomBase64,
  parseBytes,
  toHexSpaced,
  hexDump
};
