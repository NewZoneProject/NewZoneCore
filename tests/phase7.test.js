// Module: Phase 7 Tests
// Description: Tests for Plugin System, RBAC, Multi-Identity, and SDK.
// File: tests/phase7.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// ============================================================================
// PLUGIN SANDBOX TESTS
// ============================================================================

describe('Plugin Sandbox', () => {
  let PluginSandbox, SandboxLevel, CapabilityChecker;

  beforeEach(async () => {
    const mod = await import('../core/plugins/sandbox.js');
    PluginSandbox = mod.PluginSandbox;
    SandboxLevel = mod.SandboxLevel;
    CapabilityChecker = mod.CapabilityChecker;
  });

  it('should create sandbox with different levels', () => {
    const sandbox = new PluginSandbox({
      pluginId: 'test-plugin',
      level: SandboxLevel.STANDARD
    });

    expect(sandbox).toBeDefined();
    expect(sandbox.level).toBe('standard');
    expect(sandbox.pluginId).toBe('test-plugin');
  });

  it('should create capability checker', () => {
    const checker = new CapabilityChecker(['read:state', 'write:storage']);

    expect(checker.can('read:state')).toBe(true);
    expect(checker.can('write:storage')).toBe(true);
    expect(checker.can('admin')).toBe(false);
  });

  it('should check multiple capabilities', () => {
    const checker = new CapabilityChecker(['read:state', 'write:storage']);

    expect(checker.canAll(['read:state', 'write:storage'])).toBe(true);
    expect(checker.canAll(['read:state', 'admin'])).toBe(false);
    expect(checker.canAny(['admin', 'read:state'])).toBe(true);
  });

  it('should require capability or throw', () => {
    const checker = new CapabilityChecker(['read:state']);

    expect(() => checker.require('read:state')).not.toThrow();
    expect(() => checker.require('admin')).toThrow();
  });
});

// ============================================================================
// RBAC TESTS
// ============================================================================

describe('RBAC', () => {
  let RBACManager, Role, User, Policy, Permission, BuiltInRole;

  beforeEach(async () => {
    const mod = await import('../core/auth/rbac.js');
    RBACManager = mod.RBACManager;
    Role = mod.Role;
    User = mod.User;
    Policy = mod.Policy;
    Permission = mod.Permission;
    BuiltInRole = mod.BuiltInRole;
  });

  it('should create RBAC manager with built-in roles', () => {
    const rbac = new RBACManager();

    expect(rbac.roles.size).toBeGreaterThan(0);
    expect(rbac.getRole(BuiltInRole.SUPERADMIN)).toBeDefined();
    expect(rbac.getRole(BuiltInRole.ADMIN)).toBeDefined();
    expect(rbac.getRole(BuiltInRole.GUEST)).toBeDefined();
  });

  it('should create custom role', () => {
    const rbac = new RBACManager();

    const role = new Role('custom', {
      description: 'Custom role',
      permissions: [Permission.CORE_READ, Permission.IDENTITY_READ]
    });

    rbac.createRole(role);

    expect(rbac.getRole('custom')).toBeDefined();
    expect(role.hasPermission(Permission.CORE_READ)).toBe(true);
  });

  it('should create user with roles', () => {
    const rbac = new RBACManager();

    const user = new User('user-123', {
      username: 'alice',
      roles: [BuiltInRole.ANALYST]
    });

    rbac.createUser(user);

    expect(rbac.getUser('user-123')).toBeDefined();
    expect(user.roles.has(BuiltInRole.ANALYST)).toBe(true);
  });

  it('should check user permissions', () => {
    const rbac = new RBACManager();

    const user = new User('user-123', {
      username: 'alice',
      roles: [BuiltInRole.ANALYST]
    });

    rbac.createUser(user);

    // Analyst has read permissions
    expect(user.hasPermission(Permission.CORE_READ, rbac.roles)).toBe(true);
    expect(user.hasPermission(Permission.CORE_WRITE, rbac.roles)).toBe(false);
    expect(user.hasPermission(Permission.ADMIN_WRITE, rbac.roles)).toBe(false);
  });

  it('should create and check policies', () => {
    const rbac = new RBACManager();

    // Create user first
    const user = new User('user-123', {
      username: 'test-user',
      roles: [BuiltInRole.OPERATOR]
    });
    rbac.createUser(user);

    const policy = new Policy('allow-storage-read', {
      description: 'Allow storage read access',
      effect: 'allow',
      principals: ['user-123'],
      resources: ['storage'],
      actions: ['read']
    });

    rbac.createPolicy(policy);

    const result = rbac.authorize('user-123', 'storage', 'read');

    expect(result.allowed).toBe(true);
  });

  it('should deny based on policy', () => {
    const rbac = new RBACManager();

    const denyPolicy = new Policy('deny-admin', {
      description: 'Deny admin access',
      effect: 'deny',
      principals: ['user-123'],
      resources: ['*'],
      actions: ['*']
    });

    rbac.createPolicy(denyPolicy);

    const result = rbac.authorize('user-123', 'admin', 'write');

    expect(result.allowed).toBe(false);
  });

  it('should handle role inheritance', () => {
    const role = new Role('senior-analyst', {
      description: 'Senior analyst',
      inherits: [BuiltInRole.ANALYST]
    });

    const roles = new Map([[BuiltInRole.ANALYST, new Role(BuiltInRole.ANALYST, {
      permissions: [Permission.CORE_READ, Permission.STORAGE_READ]
    })]]);

    const allPermissions = role.getAllPermissions(roles);

    expect(allPermissions.has(Permission.CORE_READ)).toBe(true);
  });

  it('should handle explicit deny', () => {
    const user = new User('user-123', {
      username: 'bob',
      roles: [BuiltInRole.OPERATOR],
      permissions: [Permission.STORAGE_WRITE],
      deniedPermissions: [Permission.STORAGE_WRITE]
    });

    // Explicit deny takes precedence
    expect(user.hasPermission(Permission.STORAGE_WRITE, new Map())).toBe(false);
  });

  it('should get RBAC status', () => {
    const rbac = new RBACManager();

    const status = rbac.getStatus();

    expect(status.roles).toBeGreaterThan(0);
    expect(status.builtInRoles).toBeDefined();
    expect(status.builtInRoles.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// MULTI-IDENTITY TESTS
// ============================================================================

describe('Multi-Identity', () => {
  let IdentityManager, IdentityProfile;

  beforeEach(async () => {
    const mod = await import('../core/identity/manager.js');
    IdentityManager = mod.IdentityManager;
    IdentityProfile = mod.IdentityProfile;
  });

  it('should create identity profile', () => {
    const profile = new IdentityProfile('profile-123', {
      name: 'Test Profile',
      description: 'Test description'
    });

    expect(profile.id).toBe('profile-123');
    expect(profile.name).toBe('Test Profile');
    expect(profile.active).toBe(true);
  });

  it('should get node ID from profile', () => {
    const profile = new IdentityProfile('profile-123', {
      ed25519Public: Buffer.from('test-public-key').toString('base64')
    });

    const nodeId = profile.getNodeId();

    expect(nodeId).toBeDefined();
    expect(nodeId.length).toBe(64);
  });

  it('should create identity manager', async () => {
    const manager = new IdentityManager({
      basePath: './env_test/identities'
    });

    await manager.init();

    expect(manager).toBeDefined();
    expect(manager.profiles.size).toBeGreaterThanOrEqual(0);
  });

  it('should list profiles', async () => {
    const manager = new IdentityManager({
      basePath: './env_test/identities'
    });

    await manager.init();

    const profiles = manager.listProfiles();

    expect(Array.isArray(profiles)).toBe(true);
  });

  it('should get status', async () => {
    const manager = new IdentityManager({
      basePath: './env_test/identities'
    });

    await manager.init();

    const status = manager.getStatus();

    expect(status).toBeDefined();
    expect(typeof status.totalProfiles).toBe('number');
  });
});

// ============================================================================
// SDK TESTS
// ============================================================================

describe('SDK', () => {
  let NZCoreClient, createClient;

  beforeEach(async () => {
    const mod = await import('../sdk/index.js');
    NZCoreClient = mod.NZCoreClient;
    createClient = mod.createClient;
  });

  it('should create client', () => {
    const client = new NZCoreClient({
      baseUrl: 'http://localhost:3000'
    });

    expect(client).toBeDefined();
    expect(client.baseUrl).toBe('http://localhost:3000');
    expect(client.connected).toBe(false);
  });

  it('should create client with factory', () => {
    const client = createClient({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-api-key'
    });

    expect(client).toBeDefined();
    expect(client.apiKey).toBe('test-api-key');
  });

  it('should emit events', () => {
    const client = new NZCoreClient();

    let connected = false;
    client.on('connected', () => { connected = true; });
    client.emit('connected');

    expect(connected).toBe(true);
  });

  it('should have all API methods', () => {
    const client = new NZCoreClient();

    // Identity API
    expect(client.getIdentity).toBeDefined();
    expect(client.listProfiles).toBeDefined();

    // Trust API
    expect(client.getTrust).toBeDefined();
    expect(client.addPeer).toBeDefined();
    expect(client.removePeer).toBeDefined();

    // Network API
    expect(client.getNetworkStatus).toBeDefined();
    expect(client.sendMessage).toBeDefined();

    // Storage API
    expect(client.listFiles).toBeDefined();
    expect(client.readFile).toBeDefined();
    expect(client.writeFile).toBeDefined();
    expect(client.getKV).toBeDefined();
    expect(client.setKV).toBeDefined();

    // Service API
    expect(client.listServices).toBeDefined();
    expect(client.startService).toBeDefined();
    expect(client.stopService).toBeDefined();

    // Backup API
    expect(client.listBackups).toBeDefined();
    expect(client.createBackup).toBeDefined();
    expect(client.restoreBackup).toBeDefined();

    // Admin API
    expect(client.getStatus).toBeDefined();
    expect(client.getHealth).toBeDefined();
    expect(client.shutdown).toBeDefined();
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Phase 7 Integration', () => {
  it('should have all Phase 7 modules', async () => {
    // Plugin sandbox
    const sandbox = await import('../core/plugins/sandbox.js');
    expect(sandbox.PluginSandbox).toBeDefined();
    expect(sandbox.CapabilityChecker).toBeDefined();

    // RBAC
    const rbac = await import('../core/auth/rbac.js');
    expect(rbac.RBACManager).toBeDefined();
    expect(rbac.Permission).toBeDefined();
    expect(rbac.BuiltInRole).toBeDefined();

    // Multi-identity
    const identity = await import('../core/identity/manager.js');
    expect(identity.IdentityManager).toBeDefined();
    expect(identity.IdentityProfile).toBeDefined();

    // SDK
    const sdk = await import('../sdk/index.js');
    expect(sdk.NZCoreClient).toBeDefined();
    expect(sdk.createClient).toBeDefined();
  });
});
