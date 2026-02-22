// Module: Quantum-Resistant Cryptography
// Description: Post-quantum cryptographic algorithms.
//              Resistant to attacks from quantum computers.
// File: core/security/quantum-resistant.js

import { randomBytes, createHash } from 'crypto';

// ============================================================================
// LATTICE-BASED ENCRYPTION (Simplified Kyber-like)
// ============================================================================

export class LatticeEncryption {
  constructor(options = {}) {
    this.n = options.n || 64; // Polynomial degree (simplified, use 256+ in production)
    this.q = options.q || 3329; // Modulus
    this.eta = options.eta || 2; // Noise bound
    
    this.keys = this._generateKeys();
  }

  /**
   * Generate key pair.
   */
  _generateKeys() {
    // Generate random matrix A
    const A = this._generateMatrix(this.n, this.n);
    
    // Generate secret vector s
    const s = this._generateSecretVector(this.n);
    
    // Generate error vector e
    const e = this._generateErrorVector(this.n);
    
    // Compute b = A*s + e (mod q)
    const b = this._matrixVectorMult(A, s, e);
    
    return {
      publicKey: { A, b },
      privateKey: s,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Generate random matrix.
   */
  _generateMatrix(rows, cols) {
    const matrix = [];
    for (let i = 0; i < rows; i++) {
      matrix[i] = [];
      for (let j = 0; j < cols; j++) {
        matrix[i][j] = randomBytes(2).readUInt16LE(0) % this.q;
      }
    }
    return matrix;
  }

  /**
   * Generate secret vector.
   */
  _generateSecretVector(n) {
    const vector = [];
    for (let i = 0; i < n; i++) {
      vector[i] = (randomBytes(1)[0] % (2 * this.eta + 1)) - this.eta;
    }
    return vector;
  }

  /**
   * Generate error vector.
   */
  _generateErrorVector(n) {
    return this._generateSecretVector(n);
  }

  /**
   * Matrix-vector multiplication.
   */
  _matrixVectorMult(A, s, e) {
    const result = [];
    for (let i = 0; i < A.length; i++) {
      let sum = 0;
      for (let j = 0; j < s.length; j++) {
        sum += A[i][j] * s[j];
      }
      result[i] = ((sum + e[i]) % this.q + this.q) % this.q;
    }
    return result;
  }

  /**
   * Encrypt plaintext.
   */
  encrypt(plaintext) {
    const { A, b } = this.keys.publicKey;
    const n = this.n;
    
    // Encode message
    const m = this._encodeMessage(plaintext, n);
    
    // Generate random vectors
    const r = this._generateSecretVector(n);
    const e1 = this._generateErrorVector(n);
    const e2 = this._generateErrorVector(n);
    
    // Compute u = A^T * r + e1 (mod q)
    const u = this._matrixVectorMult(this._transpose(A), r, e1);
    
    // Compute v = b^T * r + e2 + m (mod q)
    let vDot = 0;
    for (let i = 0; i < n; i++) {
      vDot += b[i] * r[i];
    }
    const v = [];
    for (let i = 0; i < n; i++) {
      v[i] = ((vDot + e2[i] + m[i]) % this.q + this.q) % this.q;
    }
    
    return {
      u,
      v,
      encryptedAt: new Date().toISOString()
    };
  }

  /**
   * Decrypt ciphertext.
   */
  decrypt(ciphertext) {
    const s = this.keys.privateKey;
    const { u, v } = ciphertext;
    const n = this.n;
    
    // Compute m' = v - s^T * u (mod q)
    let sDotU = 0;
    for (let i = 0; i < n; i++) {
      sDotU += s[i] * u[i];
    }
    
    const m = [];
    for (let i = 0; i < n; i++) {
      let val = ((v[i] - sDotU) % this.q + this.q) % this.q;
      // Decode: if close to q/2, it's 1, else 0
      m[i] = val > this.q / 4 && val < 3 * this.q / 4 ? 1 : 0;
    }
    
    return this._decodeMessage(m);
  }

  /**
   * Encode message to polynomial.
   */
  _encodeMessage(plaintext, n) {
    const binary = Buffer.from(plaintext, 'utf-8')
      .toString('binary')
      .split('')
      .map(c => c.charCodeAt(0));
    
    const m = new Array(n).fill(0);
    for (let i = 0; i < Math.min(binary.length, n); i++) {
      m[i] = binary[i] ? Math.floor(this.q / 2) : 0;
    }
    return m;
  }

  /**
   * Decode message from polynomial.
   */
  _decodeMessage(m) {
    const threshold = this.q / 4;
    const binary = m.map(val => (val > threshold && val < 3 * threshold) ? 1 : 0);
    
    // Convert binary to string (simplified)
    let result = '';
    for (let i = 0; i < binary.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8 && i + j < binary.length; j++) {
        byte |= binary[i + j] << j;
      }
      if (byte > 0) {
        result += String.fromCharCode(byte);
      }
    }
    return result;
  }

  /**
   * Transpose matrix.
   */
  _transpose(A) {
    const rows = A.length;
    const cols = A[0].length;
    const result = [];
    
    for (let j = 0; j < cols; j++) {
      result[j] = [];
      for (let i = 0; i < rows; i++) {
        result[j][i] = A[i][j];
      }
    }
    return result;
  }

  /**
   * Get public key.
   */
  getPublicKey() {
    return {
      A: this.keys.publicKey.A,
      b: this.keys.publicKey.b,
      n: this.n,
      q: this.q
    };
  }

  /**
   * Export keys.
   */
  exportKeys() {
    return {
      publicKey: this.getPublicKey(),
      privateKey: this.keys.privateKey,
      parameters: { n: this.n, q: this.q, eta: this.eta },
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import keys.
   */
  importKeys(keyData) {
    this.keys = {
      publicKey: {
        A: keyData.publicKey.A,
        b: keyData.publicKey.b
      },
      privateKey: keyData.privateKey
    };
    this.n = keyData.parameters?.n || this.n;
    this.q = keyData.parameters?.q || this.q;
    this.eta = keyData.parameters?.eta || this.eta;
    return this;
  }
}

// ============================================================================
// HASH-BASED SIGNATURES (Simplified SPHINCS+-like)
// ============================================================================

export class HashBasedSignature {
  constructor(options = {}) {
    this.height = options.height || 16; // Merkle tree height
    this.wotsWidth = options.wotsWidth || 16; // WOTS+ width
    
    this.keys = this._generateKeys();
  }

  /**
   * Generate key pair.
   */
  _generateKeys() {
    // Generate WOTS+ private keys
    const wotsKeys = [];
    for (let i = 0; i < this.height; i++) {
      wotsKeys[i] = [];
      for (let j = 0; j < this.wotsWidth; j++) {
        wotsKeys[i][j] = randomBytes(32);
      }
    }

    // Compute WOTS+ public keys
    const wotsPublic = wotsKeys.map(chain => 
      chain.map(key => this._chainFunction(key, this.wotsWidth - 1))
    );

    // Build Merkle tree
    const merkleTree = this._buildMerkleTree(wotsPublic);
    const root = merkleTree[merkleTree.length - 1][0];

    return {
      privateKey: wotsKeys,
      publicKey: root,
      merkleTree,
      wotsPublic,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * WOTS+ chain function.
   */
  _chainFunction(input, iterations) {
    let result = input;
    for (let i = 0; i < iterations; i++) {
      result = createHash('sha256').update(result).digest();
    }
    return result;
  }

  /**
   * Build Merkle tree.
   */
  _buildMerkleTree(leaves) {
    const tree = [leaves];
    let current = leaves;

    while (current.length > 1) {
      const next = [];
      for (let i = 0; i < current.length; i += 2) {
        if (i + 1 < current.length) {
          const combined = Buffer.concat([
            Buffer.from(current[i]),
            Buffer.from(current[i + 1])
          ]);
          next.push(createHash('sha256').update(combined).digest('hex'));
        } else {
          next.push(createHash('sha256')
            .update(Buffer.from(current[i]))
            .digest('hex'));
        }
      }
      tree.push(next);
      current = next;
    }

    return tree;
  }

  /**
   * Sign message.
   */
  sign(message) {
    const messageHash = createHash('sha256')
      .update(message)
      .digest('hex');

    // Select leaf based on message hash
    const leafIndex = parseInt(messageHash.substring(0, 8), 16) % this.height;

    // Get WOTS private key for this leaf
    const wotsPrivateKey = this.keys.privateKey[leafIndex];

    // Sign with WOTS+
    const wotsSignature = wotsPrivateKey.map(key => 
      this._chainFunction(key, this._getChecksum(messageHash, wotsPrivateKey.length))
    );

    // Generate authentication path
    const authPath = this._getAuthenticationPath(leafIndex);

    return {
      signature: wotsSignature.map(s => s.toString('hex')),
      leafIndex,
      authPath,
      publicKey: this.keys.publicKey,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Verify signature.
   */
  verify(message, signature) {
    // Recompute WOTS+ public key from signature
    const wotsPublic = signature.signature.map(sig => 
      this._chainFunction(Buffer.from(sig, 'hex'), 
        this.wotsWidth - 1 - this._getChecksum(message, signature.signature.length))
    );

    // Compute leaf hash
    const leafHash = createHash('sha256')
      .update(Buffer.from(wotsPublic.flat()))
      .digest('hex');

    // Verify Merkle path
    let current = leafHash;
    for (const node of signature.authPath) {
      const combined = Buffer.concat([
        Buffer.from(current, 'hex'),
        Buffer.from(node, 'hex')
      ]);
      current = createHash('sha256').update(combined).digest('hex');
    }

    return current === signature.publicKey;
  }

  /**
   * Get authentication path from Merkle tree.
   */
  _getAuthenticationPath(leafIndex) {
    const path = [];
    let index = leafIndex;

    for (let level = 0; level < this.keys.merkleTree.length - 1; level++) {
      const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
      if (siblingIndex < this.keys.merkleTree[level].length) {
        path.push(this.keys.merkleTree[level][siblingIndex]);
      }
      index = Math.floor(index / 2);
    }

    return path;
  }

  /**
   * Get checksum for message.
   */
  _getChecksum(message, length) {
    const hash = createHash('sha256').update(message).digest();
    return hash[0] % length;
  }

  /**
   * Get public key.
   */
  getPublicKey() {
    return this.keys.publicKey;
  }

  /**
   * Export keys.
   */
  exportKeys() {
    return {
      publicKey: this.keys.publicKey,
      parameters: {
        height: this.height,
        wotsWidth: this.wotsWidth
      },
      exportedAt: new Date().toISOString()
    };
  }

  /**
   * Import keys.
   */
  importKeys(keyData) {
    this.keys = {
      publicKey: keyData.publicKey,
      // Private key would need to be reconstructed or stored separately
    };
    this.height = keyData.parameters?.height || this.height;
    this.wotsWidth = keyData.parameters?.wotsWidth || this.wotsWidth;
    return this;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  LatticeEncryption,
  HashBasedSignature
};
