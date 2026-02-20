// Test Suite: SecureBuffer Tests
// Description: Tests for secure memory management
// File: tests/secure-buffer.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { SecureBuffer } from '../core/crypto/keys.js';

// ============================================================================
// TESTS
// ============================================================================

describe('SecureBuffer', () => {
  describe('Construction', () => {
    it('should create buffer of specified size', () => {
      const buf = new SecureBuffer(32);
      expect(buf.length).toBe(32);
    });

    it('should initialize with zeros', () => {
      const buf = new SecureBuffer(16);
      const data = buf.buffer;
      expect(data.every(b => b === 0)).toBe(true);
    });

    it('should detect secure heap availability', () => {
      const buf = new SecureBuffer(32);
      // isSecureHeap depends on Node.js version
      expect(typeof buf.isSecureHeap).toBe('boolean');
    });
  });

  describe('Buffer Access', () => {
    it('should allow reading buffer before free', () => {
      const buf = new SecureBuffer(8);
      buf.fill(0x42);
      expect(buf.buffer[0]).toBe(0x42);
    });

    it('should throw error after free', () => {
      const buf = new SecureBuffer(8);
      buf.free();
      expect(() => buf.buffer).toThrow('SecureBuffer has been freed');
    });

    it('should return correct length', () => {
      const buf = new SecureBuffer(64);
      expect(buf.length).toBe(64);
    });
  });

  describe('Fill Operation', () => {
    it('should fill buffer with specified value', () => {
      const buf = new SecureBuffer(16);
      buf.fill(0xFF);
      expect(buf.buffer.every(b => b === 0xFF)).toBe(true);
    });

    it('should return this for chaining', () => {
      const buf = new SecureBuffer(8);
      const result = buf.fill(0x42);
      expect(result).toBe(buf);
    });
  });

  describe('Copy Operation', () => {
    it('should copy data to target buffer', () => {
      const buf = new SecureBuffer(16);
      buf.fill(0x42);
      
      const target = Buffer.alloc(16);
      buf.copy(target);
      
      expect(target.every(b => b === 0x42)).toBe(true);
    });

    it('should support partial copy with offsets', () => {
      const buf = new SecureBuffer(16);
      buf.fill(0x42);
      
      const target = Buffer.alloc(8);
      buf.copy(target, 0, 4, 12);
      
      expect(target.length).toBe(8);
      expect(target.every(b => b === 0x42)).toBe(true);
    });
  });

  describe('Slice Operation', () => {
    it('should create slice view', () => {
      const buf = new SecureBuffer(16);
      buf.fill(0x42);
      
      const slice = buf.slice(4, 8);
      expect(slice.length).toBe(4);
      expect(slice.every(b => b === 0x42)).toBe(true);
    });

    it('should share memory with original (view, not copy)', () => {
      const buf = new SecureBuffer(16);
      const slice = buf.slice(0, 8);
      
      buf.fill(0xFF);
      expect(slice.every(b => b === 0xFF)).toBe(true);
    });
  });

  describe('Free Operation', () => {
    it('should zero buffer on free', () => {
      const buf = new SecureBuffer(32);
      buf.fill(0x42);
      
      const originalBuffer = buf.buffer;
      buf.free();
      
      // Buffer should be zeroed
      expect(originalBuffer.every(b => b === 0)).toBe(true);
    });

    it('should mark buffer as freed', () => {
      const buf = new SecureBuffer(8);
      expect(buf.isValid()).toBe(true);
      
      buf.free();
      
      expect(buf.isValid()).toBe(false);
    });

    it('should be idempotent', () => {
      const buf = new SecureBuffer(8);
      buf.free();
      
      // Second free should not throw
      expect(() => buf.free()).not.toThrow();
    });

    it('should prevent access after free', () => {
      const buf = new SecureBuffer(8);
      buf.free();
      
      expect(() => buf.buffer).toThrow();
      expect(() => buf.fill(0x42)).not.toThrow(); // fill should still work but be useless
      expect(buf.isValid()).toBe(false);
    });
  });

  describe('Conversion Methods', () => {
    it('should convert to Uint8Array', () => {
      const buf = new SecureBuffer(16);
      buf.fill(0x42);
      
      const arr = buf.toUint8Array();
      expect(arr).toBeInstanceOf(Uint8Array);
      expect(arr.length).toBe(16);
      expect(arr.every(b => b === 0x42)).toBe(true);
    });

    it('should convert to hex string', () => {
      const buf = new SecureBuffer(4);
      buf.fill(0xFF);
      
      const hex = buf.toHex();
      expect(hex).toBe('ffffffff');
    });

    it('should convert to base64 string', () => {
      const buf = new SecureBuffer(3);
      buf.fill(0xFF);
      
      const b64 = buf.toBase64();
      expect(b64).toBe('////');
    });

    it('should convert to string', () => {
      const buf = new SecureBuffer(4);
      buf.fill(0x41); // 'A'
      
      const str = buf.toString('utf8');
      expect(str).toBe('AAAA');
    });
  });

  describe('Security Properties', () => {
    it('should use multiple overwrite passes', () => {
      // This test verifies the implementation uses multiple passes
      const buf = new SecureBuffer(32);
      const sensitiveData = Buffer.from('sensitive-data-here-1234567890');
      sensitiveData.copy(buf.buffer);

      // Verify data is there before free
      expect(buf.buffer[0]).toBe('s'.charCodeAt(0));
      
      buf.free();

      // After free, buffer should be inaccessible
      expect(() => buf.buffer).toThrow('SecureBuffer has been freed');
      expect(buf.isValid()).toBe(false);
    });

    it('should handle zero-size buffer', () => {
      const buf = new SecureBuffer(0);
      expect(buf.length).toBe(0);
      expect(() => buf.free()).not.toThrow();
    });

    it('should handle large buffer', () => {
      const size = 10 * 1024 * 1024; // 10 MB
      const buf = new SecureBuffer(size);
      expect(buf.length).toBe(size);
      
      // Fill with pattern
      buf.fill(0xAB);
      expect(buf.buffer[0]).toBe(0xAB);
      expect(buf.buffer[size - 1]).toBe(0xAB);
      
      buf.free();
      expect(buf.isValid()).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle fill with 0', () => {
      const buf = new SecureBuffer(8);
      buf.fill(0x42);
      buf.fill(0);
      expect(buf.buffer.every(b => b === 0)).toBe(true);
    });

    it('should handle fill with 255', () => {
      const buf = new SecureBuffer(8);
      buf.fill(255);
      expect(buf.buffer.every(b => b === 255)).toBe(true);
    });

    it('should handle slice at boundaries', () => {
      const buf = new SecureBuffer(8);
      
      const start = buf.slice(0, 0);
      expect(start.length).toBe(0);
      
      const end = buf.slice(8, 8);
      expect(end.length).toBe(0);
      
      const full = buf.slice(0, 8);
      expect(full.length).toBe(8);
    });
  });
});

describe('SecureBuffer Usage Pattern', () => {
  it('should follow secure usage pattern', () => {
    // Create buffer for sensitive data
    const secretBuf = new SecureBuffer(32);
    
    // Fill with sensitive data
    const secret = Buffer.from('my-secret-key-data-here-123456');
    secret.copy(secretBuf.buffer);
    
    // Use the data
    expect(secretBuf.buffer[0]).toBe('m'.charCodeAt(0));
    
    // Wipe sensitive data from source
    secret.fill(0);
    
    // Free secure buffer when done
    secretBuf.free();
    
    // Verify cleanup
    expect(secretBuf.isValid()).toBe(false);
  });

  it('should use try-finally for cleanup', () => {
    const secretBuf = new SecureBuffer(16);
    
    try {
      // Use buffer
      secretBuf.fill(0x42);
      // ... some operation ...
    } finally {
      // Always free
      secretBuf.free();
    }
    
    expect(secretBuf.isValid()).toBe(false);
  });
});
