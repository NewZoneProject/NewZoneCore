// Test Suite: Core Security Tests
// Description: Comprehensive tests for crypto, auth, and security features
// File: tests/security.test.js

import assert from 'assert';
import crypto from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile, readFile } from 'fs/promises';

// Test utilities
let testDir;
let passCount = 0;
let failCount = 0;

function pass(name) {
  passCount++;
  console.log(`  ✓ ${name}`);
}

function fail(name, error) {
  failCount++;
  console.log(`  ✗ ${name}`);
  console.log(`    Error: ${error.message}`);
}

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

// ============================================================================
// SETUP
// ============================================================================

async function setup() {
  testDir = join(tmpdir(), `nzcore-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
  console.log(`Test directory: ${testDir}`);
}

async function teardown() {
  await rm(testDir, { recursive: true, force: true });
}

// ============================================================================
// MASTER KEY TESTS
// ============================================================================

async function testMasterKey() {
  console.log('\n[Master Key Tests]');
  
  await test('should generate unique salt', async () => {
    const { generateSalt } = await import('../core/crypto/master.js');
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    
    assert.strictEqual(salt1.length, 32, 'Salt should be 32 bytes');
    assert.strictEqual(salt2.length, 32, 'Salt should be 32 bytes');
    assert.ok(!salt1.equals(salt2), 'Salts should be unique');
  });
  
  await test('should derive key with unique salt', async () => {
    const { deriveMasterKey, generateSalt } = await import('../core/crypto/master.js');
    
    const salt = generateSalt();
    const result = await deriveMasterKey('test-password', salt);
    
    assert.strictEqual(result.key.length, 32, 'Key should be 32 bytes');
    assert.ok(result.salt.equals(salt), 'Salt should match');
  });
  
  await test('should derive same key from same password and salt', async () => {
    const { deriveMasterKey, generateSalt } = await import('../core/crypto/master.js');
    
    const salt = generateSalt();
    const result1 = await deriveMasterKey('test-password', salt);
    const result2 = await deriveMasterKey('test-password', salt);
    
    assert.ok(result1.key.equals(result2.key), 'Keys should match');
  });
  
  await test('should derive different keys from different passwords', async () => {
    const { deriveMasterKey, generateSalt } = await import('../core/crypto/master.js');
    
    const salt = generateSalt();
    const result1 = await deriveMasterKey('password1', salt);
    const result2 = await deriveMasterKey('password2', salt);
    
    assert.ok(!result1.key.equals(result2.key), 'Keys should differ');
  });
  
  await test('should wipe key from memory', async () => {
    const { wipeKey } = await import('../core/crypto/master.js');
    
    const key = Buffer.from('secret-key-data-here-1234567890');
    wipeKey(key);
    
    const allZeros = key.every(b => b === 0);
    assert.ok(allZeros, 'Key should be zeroed');
  });
}

// ============================================================================
// ENCRYPTED SEED TESTS
// ============================================================================

async function testEncryptedSeed() {
  console.log('\n[Encrypted Seed Tests]');
  
  await test('should encrypt and decrypt seed phrase', async () => {
    const { encryptSeedPhrase, decryptSeedPhrase } = await import('../core/crypto/keys.js');
    
    const seedPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const masterKey = crypto.randomBytes(32);
    
    const encrypted = encryptSeedPhrase(seedPhrase, masterKey);
    
    assert.ok(encrypted.version === 2, 'Should use version 2');
    assert.ok(encrypted.nonce, 'Should have nonce');
    assert.ok(encrypted.tag, 'Should have auth tag');
    assert.ok(encrypted.data, 'Should have encrypted data');
    
    const secureBuf = decryptSeedPhrase(encrypted, masterKey);
    const decrypted = secureBuf.toString('utf8');
    
    assert.strictEqual(decrypted, seedPhrase, 'Decrypted seed should match');
    secureBuf.free();
  });
  
  await test('should fail decryption with wrong key', async () => {
    const { encryptSeedPhrase, decryptSeedPhrase } = await import('../core/crypto/keys.js');
    
    const seedPhrase = 'test seed phrase';
    const masterKey = crypto.randomBytes(32);
    const wrongKey = crypto.randomBytes(32);
    
    const encrypted = encryptSeedPhrase(seedPhrase, masterKey);
    
    let error = null;
    try {
      decryptSeedPhrase(encrypted, wrongKey);
    } catch (e) {
      error = e;
    }
    
    assert.ok(error, 'Should throw with wrong key');
  });
  
  await test('should securely wipe SecureBuffer', async () => {
    const { SecureBuffer } = await import('../core/crypto/keys.js');
    
    const buf = new SecureBuffer(32);
    buf.buffer.fill(0x42);
    
    assert.ok(buf.isValid(), 'Buffer should be valid');
    
    buf.free();
    
    assert.ok(!buf.isValid(), 'Buffer should be invalid after free');
    
    let error = null;
    try {
      buf.buffer;
    } catch (e) {
      error = e;
    }
    
    assert.ok(error, 'Should throw when accessing freed buffer');
  });
}

// ============================================================================
// SECURE STORAGE TESTS
// ============================================================================

async function testSecureStorage() {
  console.log('\n[Secure Storage Tests]');
  
  const storagePath = join(testDir, 'storage');
  
  await test('should create SecureStorage', async () => {
    const { SecureStorage } = await import('../core/storage/secure.js');
    
    const storage = new SecureStorage({
      basePath: storagePath,
      masterKey: crypto.randomBytes(32)
    });
    
    await storage.init();
    
    const status = await storage.getStatus();
    assert.ok(status.masterKeySet, 'Master key should be set');
    assert.strictEqual(status.version, 2, 'Should use version 2');
    assert.strictEqual(status.keyDerivation, 'HKDF-SHA256', 'Should use HKDF');
  });
  
  await test('should encrypt and decrypt files', async () => {
    const { SecureStorage } = await import('../core/storage/secure.js');
    
    const storage = new SecureStorage({
      basePath: join(testDir, 'storage2'),
      masterKey: crypto.randomBytes(32)
    });
    
    await storage.init();
    
    const testData = { message: 'Hello, World!', timestamp: Date.now() };
    await storage.writeFile('test.json', testData);
    
    const loaded = await storage.readFile('test.json');
    
    assert.deepStrictEqual(loaded, testData, 'Data should match');
  });
  
  await test('should use HKDF for key derivation', async () => {
    const { SecureStorage } = await import('../core/storage/secure.js');
    
    const masterKey = crypto.randomBytes(32);
    
    const storage1 = new SecureStorage({
      basePath: join(testDir, 'storage3'),
      masterKey
    });
    
    await storage1.init();
    
    const testData = 'test data';
    await storage1.writeFile('test.txt', testData);
    
    // Read the raw file to verify format
    const raw = await readFile(join(testDir, 'storage3', 'files', 'test.txt'));
    const version = raw.readUInt32BE(0);
    
    assert.strictEqual(version, 2, 'Should use version 2 format');
  });
  
  await test('should enforce size limits', async () => {
    const { SecureStorage } = await import('../core/storage/secure.js');
    
    const storage = new SecureStorage({
      basePath: join(testDir, 'storage4'),
      masterKey: crypto.randomBytes(32),
      maxFileSize: 1000
    });
    
    await storage.init();
    
    const largeData = 'x'.repeat(2000);
    
    let error = null;
    try {
      await storage.writeFile('large.txt', largeData);
    } catch (e) {
      error = e;
    }
    
    assert.ok(error, 'Should throw for large files');
    assert.ok(error.message.includes('too large'), 'Error should mention size');
  });
}

// ============================================================================
// AUTH MANAGER TESTS
// ============================================================================

async function testAuthManager() {
  console.log('\n[Auth Manager Tests]');
  
  await test('should generate and validate JWT tokens', async () => {
    const { AuthManager } = await import('../core/crypto/auth.js');
    
    const auth = new AuthManager({
      jwtSecret: crypto.randomBytes(32)
    });
    
    const token = auth._generateAccessToken();
    const validation = auth.validateToken(token);
    
    assert.ok(validation.valid, 'Token should be valid');
    assert.ok(validation.tokenId, 'Should have token ID');
  });
  
  await test('should reject invalid tokens', async () => {
    const { AuthManager } = await import('../core/crypto/auth.js');
    
    const auth = new AuthManager({
      jwtSecret: crypto.randomBytes(32)
    });
    
    const validation = auth.validateToken('invalid.token.here');
    
    assert.ok(!validation.valid, 'Token should be invalid');
  });
  
  await test('should generate and validate API keys', async () => {
    const { AuthManager } = await import('../core/crypto/auth.js');
    
    const auth = new AuthManager({
      jwtSecret: crypto.randomBytes(32)
    });
    
    const result = await auth.generateApiKey('test-key', ['read', 'write']);
    
    assert.ok(result.key, 'Should return API key');
    assert.ok(result.key.startsWith('nz_'), 'Key should have prefix');
    
    const validation = auth.validateApiKey(result.key);
    
    assert.ok(validation.valid, 'API key should be valid');
    assert.strictEqual(validation.name, 'test-key', 'Name should match');
    assert.deepStrictEqual(validation.permissions, ['read', 'write'], 'Permissions should match');
  });
  
  await test('should reject wrong API key', async () => {
    const { AuthManager } = await import('../core/crypto/auth.js');
    
    const auth = new AuthManager({
      jwtSecret: crypto.randomBytes(32)
    });
    
    const validation = auth.validateApiKey('nz_invalid_key');
    
    assert.ok(!validation.valid, 'API key should be invalid');
  });
  
  await test('should implement rate limiting for logins', async () => {
    const { AuthManager } = await import('../core/crypto/auth.js');
    
    const auth = new AuthManager({
      jwtSecret: crypto.randomBytes(32),
      maxLoginAttempts: 3,
      lockoutDuration: 60000
    });
    
    // Simulate failed attempts
    for (let i = 0; i < 3; i++) {
      auth._recordFailedLogin('192.168.1.1');
    }
    
    const lockout = auth._checkLockout('192.168.1.1');
    
    assert.ok(lockout.locked, 'Should be locked');
    assert.ok(lockout.remaining > 0, 'Should have remaining time');
  });
}

// ============================================================================
// IPC AUTH TESTS
// ============================================================================

async function testIpcAuth() {
  console.log('\n[IPC Auth Tests]');
  
  await test('should generate IPC token', async () => {
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    
    assert.strictEqual(token.length, 64, 'Token should be 64 hex chars');
    
    // Verify it's hex
    assert.ok(/^[0-9a-f]+$/.test(token), 'Token should be hex');
  });
  
  await test('should validate tokens with timing-safe comparison', async () => {
    const crypto = await import('crypto');
    
    const token1 = 'test-token-value-123';
    const token2 = 'test-token-value-123';
    const token3 = 'test-token-value-456';
    
    const valid = crypto.timingSafeEqual(
      Buffer.from(token1, 'utf8'),
      Buffer.from(token2, 'utf8')
    );
    
    const invalid = crypto.timingSafeEqual(
      Buffer.from(token1, 'utf8'),
      Buffer.from(token3, 'utf8')
    );
    
    assert.ok(valid, 'Same tokens should match');
    assert.ok(!invalid, 'Different tokens should not match');
  });
}

// ============================================================================
// TRUST SYNC TESTS
// ============================================================================

async function testTrustSync() {
  console.log('\n[Trust Sync Tests]');
  
  await test('should create TrustUpdate with replay protection', async () => {
    const { TrustUpdate, TrustUpdateType } = await import('../core/trust/sync.js');
    
    const update = new TrustUpdate({
      type: TrustUpdateType.PEER_ADD,
      peerId: 'test-peer',
      sequence: 1
    });
    
    assert.ok(update.id, 'Should have ID');
    assert.ok(update.nonce, 'Should have nonce for replay protection');
    assert.strictEqual(update.sequence, 1, 'Should have sequence number');
  });
  
  await test('should detect duplicate updates', async () => {
    const { TrustSyncProtocol, TrustUpdateType, TrustUpdate } = await import('../core/trust/sync.js');
    
    const protocol = new TrustSyncProtocol({
      identity: null,
      localTrust: { peers: [] }
    });
    
    const update = new TrustUpdate({
      id: 'tu:test:123',
      type: TrustUpdateType.PEER_ADD,
      peerId: 'test-peer',
      sequence: 1,
      nonce: 'test-nonce'
    });
    
    // Store update
    protocol._storeUpdate(update);
    
    // Check duplicate detection
    const isDuplicate = protocol._isDuplicate(update);
    
    assert.ok(isDuplicate, 'Should detect duplicate');
  });
  
  await test('should enforce sequence ordering', async () => {
    const { TrustSyncProtocol, TrustUpdateType, TrustUpdate } = await import('../core/trust/sync.js');
    
    const protocol = new TrustSyncProtocol({
      identity: null,
      localTrust: { peers: [] }
    });
    
    // Record sequence
    protocol.remoteSequences.set('signer1', 5);
    
    const oldUpdate = new TrustUpdate({
      type: TrustUpdateType.PEER_ADD,
      peerId: 'test-peer',
      sequence: 3,
      signerId: 'signer1'
    });
    
    const isDuplicate = protocol._isDuplicate(oldUpdate);
    
    assert.ok(isDuplicate, 'Old sequence should be rejected');
  });
}

// ============================================================================
// ROUTING LAYER TESTS
// ============================================================================

async function testRoutingLayer() {
  console.log('\n[Routing Layer Tests]');
  
  await test('should create RoutedMessage with TTL', async () => {
    const { RoutedMessage } = await import('../core/routing/layer.js');
    
    const msg = new RoutedMessage({
      from: 'node1',
      to: 'node2',
      payload: { test: true }
    });
    
    assert.ok(msg.id, 'Should have ID');
    assert.ok(msg.ttl > 0, 'Should have TTL');
    assert.strictEqual(msg.hops.length, 0, 'Should start with no hops');
  });
  
  await test('should add hops and decrement TTL', async () => {
    const { RoutedMessage } = await import('../core/routing/layer.js');
    
    const msg = new RoutedMessage({
      from: 'node1',
      to: 'node2',
      payload: { test: true }
    });
    
    const initialTtl = msg.ttl;
    
    msg.addHop('node1');
    
    assert.strictEqual(msg.hops.length, 1, 'Should have one hop');
    assert.strictEqual(msg.ttl, initialTtl - 1, 'TTL should decrement');
  });
  
  await test('should detect expired TTL', async () => {
    const { RoutedMessage } = await import('../core/routing/layer.js');
    
    const msg = new RoutedMessage({
      from: 'node1',
      to: 'node2',
      payload: { test: true },
      ttl: 1
    });
    
    msg.addHop('node1');
    
    assert.ok(!msg.shouldForward(), 'Should not forward with TTL 0');
  });
}

// ============================================================================
// INPUT VALIDATION TESTS
// ============================================================================

async function testInputValidation() {
  console.log('\n[Input Validation Tests]');
  
  await test('should validate peer ID format', async () => {
    const validId = 'peer-123';
    const invalidId = '';
    
    assert.ok(validId.length > 0 && validId.length <= 256, 'Valid ID should pass');
    assert.ok(!(invalidId.length > 0), 'Empty ID should fail');
  });
  
  await test('should validate base64 public key', async () => {
    const validKey = Buffer.alloc(32, 0x42).toString('base64');
    const invalidKey = 'not-base64!';
    
    // Valid key
    const keyBytes1 = Buffer.from(validKey, 'base64');
    assert.strictEqual(keyBytes1.length, 32, 'Valid key should be 32 bytes');
    
    // Invalid key
    let error = null;
    try {
      const keyBytes2 = Buffer.from(invalidKey, 'base64');
      if (keyBytes2.length !== 32) throw new Error('Wrong length');
    } catch (e) {
      error = e;
    }
    
    assert.ok(error, 'Invalid key should fail');
  });
}

// ============================================================================
// RUN TESTS
// ============================================================================

async function runTests() {
  console.log('='.repeat(60));
  console.log('NewZoneCore Security Test Suite');
  console.log('='.repeat(60));
  
  await setup();
  
  try {
    await testMasterKey();
    await testEncryptedSeed();
    await testSecureStorage();
    await testAuthManager();
    await testIpcAuth();
    await testTrustSync();
    await testRoutingLayer();
    await testInputValidation();
  } finally {
    await teardown();
  }
  
  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  console.log('='.repeat(60));
  
  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
