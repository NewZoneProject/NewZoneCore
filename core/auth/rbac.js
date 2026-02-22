// Module: Role-Based Access Control (RBAC)
// Description: Fine-grained access control system for NewZoneCore.
//              Supports roles, permissions, and policies.
// File: core/auth/rbac.js

import { EventEmitter } from 'events';
import { createHash } from 'crypto';

// ============================================================================
// PERMISSIONS
// ============================================================================

export const Permission = {
  // Core permissions
  CORE_READ: 'core:read',
  CORE_WRITE: 'core:write',
  CORE_ADMIN: 'core:admin',

  // Identity permissions
  IDENTITY_READ: 'identity:read',
  IDENTITY_WRITE: 'identity:write',
  IDENTITY_MANAGE: 'identity:manage',

  // Trust permissions
  TRUST_READ: 'trust:read',
  TRUST_WRITE: 'trust:write',
  TRUST_MANAGE: 'trust:manage',

  // Network permissions
  NETWORK_READ: 'network:read',
  NETWORK_WRITE: 'network:write',
  NETWORK_MANAGE: 'network:manage',

  // Storage permissions
  STORAGE_READ: 'storage:read',
  STORAGE_WRITE: 'storage:write',
  STORAGE_MANAGE: 'storage:manage',

  // Service permissions
  SERVICE_READ: 'service:read',
  SERVICE_START: 'service:start',
  SERVICE_STOP: 'service:stop',
  SERVICE_MANAGE: 'service:manage',

  // Plugin permissions
  PLUGIN_READ: 'plugin:read',
  PLUGIN_INSTALL: 'plugin:install',
  PLUGIN_MANAGE: 'plugin:manage',

  // Backup permissions
  BACKUP_READ: 'backup:read',
  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_MANAGE: 'backup:manage',

  // Admin permissions
  ADMIN_READ: 'admin:read',
  ADMIN_WRITE: 'admin:write',
  ADMIN_USERS: 'admin:users',
  ADMIN_ROLES: 'admin:roles',
  ADMIN_AUDIT: 'admin:audit'
};

// ============================================================================
// PREDEFINED ROLES
// ============================================================================

export const BuiltInRole = {
  SUPERADMIN: 'superadmin',  // Full access
  ADMIN: 'admin',            // Administrative access
  OPERATOR: 'operator',      // Operational access
  DEVELOPER: 'developer',    // Development access
  ANALYST: 'analyst',        // Read-only access
  SERVICE: 'service',        // Service account access
  PLUGIN: 'plugin',          // Plugin access
  GUEST: 'guest'             // Minimal access
};

// ============================================================================
// ROLE DEFINITION
// ============================================================================

export class Role {
  constructor(name, options = {}) {
    this.name = name;
    this.description = options.description || '';
    this.permissions = new Set(options.permissions || []);
    this.inherits = options.inherits || [];
    this.createdAt = options.createdAt || new Date().toISOString();
    this.updatedAt = options.updatedAt || new Date().toISOString();
    this.builtIn = options.builtIn || false;
  }

  /**
   * Add permission to role.
   */
  addPermission(permission) {
    this.permissions.add(permission);
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Remove permission from role.
   */
  removePermission(permission) {
    this.permissions.delete(permission);
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Check if role has permission.
   */
  hasPermission(permission) {
    return this.permissions.has(permission);
  }

  /**
   * Check if role has any of the permissions.
   */
  hasAnyPermission(permissions) {
    return permissions.some(p => this.hasPermission(p));
  }

  /**
   * Check if role has all permissions.
   */
  hasAllPermissions(permissions) {
    return permissions.every(p => this.hasPermission(p));
  }

  /**
   * Get all permissions including inherited.
   */
  getAllPermissions(roles) {
    const allPermissions = new Set(this.permissions);

    for (const inheritedRoleName of this.inherits) {
      const inheritedRole = roles.get(inheritedRoleName);
      if (inheritedRole) {
        inheritedRole.permissions.forEach(p => allPermissions.add(p));
      }
    }

    return allPermissions;
  }

  /**
   * Serialize role to JSON.
   */
  toJSON() {
    return {
      name: this.name,
      description: this.description,
      permissions: Array.from(this.permissions),
      inherits: this.inherits,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      builtIn: this.builtIn
    };
  }
}

// ============================================================================
// USER
// ============================================================================

export class User {
  constructor(id, options = {}) {
    this.id = id;
    this.username = options.username || '';
    this.email = options.email || '';
    this.roles = new Set(options.roles || []);
    this.permissions = new Set(options.permissions || []);
    this.deniedPermissions = new Set(options.deniedPermissions || []);
    this.createdAt = options.createdAt || new Date().toISOString();
    this.updatedAt = options.updatedAt || new Date().toISOString();
    this.lastLoginAt = options.lastLoginAt || null;
    this.active = options.active !== false;
    this.metadata = options.metadata || {};
  }

  /**
   * Assign role to user.
   */
  assignRole(roleName) {
    this.roles.add(roleName);
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Remove role from user.
   */
  removeRole(roleName) {
    this.roles.delete(roleName);
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Grant permission to user.
   */
  grantPermission(permission) {
    this.permissions.add(permission);
    this.deniedPermissions.delete(permission);
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Deny permission to user.
   */
  denyPermission(permission) {
    this.deniedPermissions.add(permission);
    this.permissions.delete(permission);
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Check if user has permission.
   */
  hasPermission(permission, roles) {
    // Explicit deny takes precedence
    if (this.deniedPermissions.has(permission)) {
      return false;
    }

    // Direct permission
    if (this.permissions.has(permission)) {
      return true;
    }

    // Role-based permission
    for (const roleName of this.roles) {
      const role = roles.get(roleName);
      if (role && role.hasPermission(permission)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all effective permissions.
   */
  getAllPermissions(roles) {
    const allPermissions = new Set(this.permissions);

    for (const roleName of this.roles) {
      const role = roles.get(roleName);
      if (role) {
        role.getAllPermissions(roles).forEach(p => allPermissions.add(p));
      }
    }

    // Remove denied permissions
    this.deniedPermissions.forEach(p => allPermissions.delete(p));

    return allPermissions;
  }

  /**
   * Serialize user to JSON.
   */
  toJSON(includeSensitive = false) {
    const data = {
      id: this.id,
      username: this.username,
      email: this.email,
      roles: Array.from(this.roles),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      lastLoginAt: this.lastLoginAt,
      active: this.active,
      metadata: this.metadata
    };

    if (includeSensitive) {
      data.permissions = Array.from(this.permissions);
      data.deniedPermissions = Array.from(this.deniedPermissions);
    }

    return data;
  }
}

// ============================================================================
// POLICY
// ============================================================================

export class Policy {
  constructor(name, options = {}) {
    this.name = name;
    this.description = options.description || '';
    this.effect = options.effect || 'allow'; // 'allow' or 'deny'
    this.principals = options.principals || []; // Users or roles
    this.resources = options.resources || ['*'];
    this.actions = options.actions || ['*'];
    this.conditions = options.conditions || {};
    this.createdAt = options.createdAt || new Date().toISOString();
  }

  /**
   * Check if policy applies to request.
   */
  appliesTo(principal, resource, action, context = {}) {
    // Check principal
    if (!this.principals.includes('*') && !this.principals.includes(principal)) {
      return false;
    }

    // Check resource
    if (!this.matchesPattern(resource, this.resources)) {
      return false;
    }

    // Check action
    if (!this.matchesPattern(action, this.actions)) {
      return false;
    }

    // Check conditions
    for (const [key, value] of Object.entries(this.conditions)) {
      if (context[key] !== value) {
        return false;
      }
    }

    return true;
  }

  /**
   * Match pattern with wildcards.
   */
  matchesPattern(value, patterns) {
    if (patterns.includes('*')) {
      return true;
    }

    return patterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(value);
      }
      return pattern === value;
    });
  }

  /**
   * Serialize policy to JSON.
   */
  toJSON() {
    return {
      name: this.name,
      description: this.description,
      effect: this.effect,
      principals: this.principals,
      resources: this.resources,
      actions: this.actions,
      conditions: this.conditions,
      createdAt: this.createdAt
    };
  }
}

// ============================================================================
// RBAC MANAGER
// ============================================================================

export class RBACManager extends EventEmitter {
  constructor(options = {}) {
    super();

    this.roles = new Map();
    this.users = new Map();
    this.policies = new Map();
    this.storage = options.storage || null;

    this._initializeBuiltInRoles();
  }

  /**
   * Initialize built-in roles.
   */
  _initializeBuiltInRoles() {
    // Super Admin - Full access
    this.createRole(new Role(BuiltInRole.SUPERADMIN, {
      description: 'Full system access',
      permissions: Object.values(Permission),
      builtIn: true
    }));

    // Admin - Administrative access
    this.createRole(new Role(BuiltInRole.ADMIN, {
      description: 'Administrative access',
      permissions: [
        Permission.CORE_READ, Permission.CORE_WRITE,
        Permission.IDENTITY_READ, Permission.IDENTITY_WRITE, Permission.IDENTITY_MANAGE,
        Permission.TRUST_READ, Permission.TRUST_WRITE, Permission.TRUST_MANAGE,
        Permission.NETWORK_READ, Permission.NETWORK_WRITE,
        Permission.STORAGE_READ, Permission.STORAGE_WRITE, Permission.STORAGE_MANAGE,
        Permission.SERVICE_READ, Permission.SERVICE_MANAGE,
        Permission.PLUGIN_READ, Permission.PLUGIN_MANAGE,
        Permission.BACKUP_READ, Permission.BACKUP_CREATE, Permission.BACKUP_RESTORE,
        Permission.ADMIN_READ, Permission.ADMIN_USERS
      ],
      builtIn: true
    }));

    // Operator - Operational access
    this.createRole(new Role(BuiltInRole.OPERATOR, {
      description: 'Operational access',
      permissions: [
        Permission.CORE_READ,
        Permission.IDENTITY_READ,
        Permission.TRUST_READ, Permission.TRUST_WRITE,
        Permission.NETWORK_READ, Permission.NETWORK_WRITE,
        Permission.STORAGE_READ, Permission.STORAGE_WRITE,
        Permission.SERVICE_READ, Permission.SERVICE_START, Permission.SERVICE_STOP,
        Permission.BACKUP_READ, Permission.BACKUP_CREATE
      ],
      builtIn: true
    }));

    // Developer - Development access
    this.createRole(new Role(BuiltInRole.DEVELOPER, {
      description: 'Development access',
      permissions: [
        Permission.CORE_READ, Permission.CORE_WRITE,
        Permission.IDENTITY_READ,
        Permission.TRUST_READ,
        Permission.NETWORK_READ,
        Permission.STORAGE_READ, Permission.STORAGE_WRITE,
        Permission.SERVICE_READ, Permission.SERVICE_START, Permission.SERVICE_STOP,
        Permission.PLUGIN_READ, Permission.PLUGIN_INSTALL
      ],
      builtIn: true
    }));

    // Analyst - Read-only access
    this.createRole(new Role(BuiltInRole.ANALYST, {
      description: 'Read-only access',
      permissions: [
        Permission.CORE_READ,
        Permission.IDENTITY_READ,
        Permission.TRUST_READ,
        Permission.NETWORK_READ,
        Permission.STORAGE_READ,
        Permission.SERVICE_READ,
        Permission.PLUGIN_READ,
        Permission.BACKUP_READ
      ],
      builtIn: true
    }));

    // Service - Service account access
    this.createRole(new Role(BuiltInRole.SERVICE, {
      description: 'Service account access',
      permissions: [
        Permission.CORE_READ,
        Permission.SERVICE_READ, Permission.SERVICE_START, Permission.SERVICE_STOP
      ],
      builtIn: true
    }));

    // Plugin - Plugin access
    this.createRole(new Role(BuiltInRole.PLUGIN, {
      description: 'Plugin access',
      permissions: [
        Permission.CORE_READ,
        Permission.STORAGE_READ, Permission.STORAGE_WRITE
      ],
      builtIn: true
    }));

    // Guest - Minimal access
    this.createRole(new Role(BuiltInRole.GUEST, {
      description: 'Minimal access',
      permissions: [
        Permission.CORE_READ
      ],
      builtIn: true
    }));
  }

  /**
   * Create role.
   */
  createRole(role) {
    if (!(role instanceof Role)) {
      throw new Error('Must be Role instance');
    }

    this.roles.set(role.name, role);
    this.emit('role:created', { role });

    if (this.storage) {
      this.storage.set(`rbac:role:${role.name}`, role.toJSON());
    }

    return role;
  }

  /**
   * Get role by name.
   */
  getRole(name) {
    return this.roles.get(name);
  }

  /**
   * List all roles.
   */
  listRoles() {
    return Array.from(this.roles.values()).map(r => r.toJSON());
  }

  /**
   * Delete role.
   */
  deleteRole(name) {
    const role = this.getRole(name);
    if (!role) {
      throw new Error(`Role not found: ${name}`);
    }

    if (role.builtIn) {
      throw new Error('Cannot delete built-in role');
    }

    this.roles.delete(name);
    this.emit('role:deleted', { name });

    if (this.storage) {
      this.storage.delete(`rbac:role:${name}`);
    }
  }

  /**
   * Create user.
   */
  createUser(user) {
    if (!(user instanceof User)) {
      throw new Error('Must be User instance');
    }

    this.users.set(user.id, user);
    this.emit('user:created', { user });

    if (this.storage) {
      this.storage.set(`rbac:user:${user.id}`, user.toJSON(true));
    }

    return user;
  }

  /**
   * Get user by ID.
   */
  getUser(id) {
    return this.users.get(id);
  }

  /**
   * List all users.
   */
  listUsers() {
    return Array.from(this.users.values()).map(u => u.toJSON(false));
  }

  /**
   * Delete user.
   */
  deleteUser(id) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error(`User not found: ${id}`);
    }

    this.users.delete(id);
    this.emit('user:deleted', { id });

    if (this.storage) {
      this.storage.delete(`rbac:user:${id}`);
    }
  }

  /**
   * Create policy.
   */
  createPolicy(policy) {
    if (!(policy instanceof Policy)) {
      throw new Error('Must be Policy instance');
    }

    this.policies.set(policy.name, policy);
    this.emit('policy:created', { policy });

    if (this.storage) {
      this.storage.set(`rbac:policy:${policy.name}`, policy.toJSON());
    }

    return policy;
  }

  /**
   * Get policy by name.
   */
  getPolicy(name) {
    return this.policies.get(name);
  }

  /**
   * List all policies.
   */
  listPolicies() {
    return Array.from(this.policies.values()).map(p => p.toJSON());
  }

  /**
   * Delete policy.
   */
  deletePolicy(name) {
    const policy = this.policies.get(name);
    if (!policy) {
      throw new Error(`Policy not found: ${name}`);
    }

    this.policies.delete(name);
    this.emit('policy:deleted', { name });

    if (this.storage) {
      this.storage.delete(`rbac:policy:${name}`);
    }
  }

  /**
   * Check if user has permission.
   */
  hasPermission(userId, permission) {
    const user = this.getUser(userId);
    if (!user) {
      return false;
    }

    return user.hasPermission(permission, this.roles);
  }

  /**
   * Check if user has any permission.
   */
  hasAnyPermission(userId, permissions) {
    const user = this.getUser(userId);
    if (!user) {
      return false;
    }

    return permissions.some(p => user.hasPermission(p, this.roles));
  }

  /**
   * Check if user has all permissions.
   */
  hasAllPermissions(userId, permissions) {
    const user = this.getUser(userId);
    if (!user) {
      return false;
    }

    return permissions.every(p => user.hasPermission(p, this.roles));
  }

  /**
   * Authorize action.
   */
  authorize(userId, resource, action, context = {}) {
    const user = this.getUser(userId);
    if (!user) {
      return { allowed: false, reason: 'User not found' };
    }

    // Check policies first
    for (const policy of this.policies.values()) {
      if (policy.appliesTo(userId, resource, action, context)) {
        if (policy.effect === 'deny') {
          return { allowed: false, reason: `Denied by policy: ${policy.name}` };
        } else if (policy.effect === 'allow') {
          return { allowed: true, reason: `Allowed by policy: ${policy.name}` };
        }
      }
    }

    // Fall back to role-based permissions
    const permission = this._resourceActionToPermission(resource, action);
    if (user.hasPermission(permission, this.roles)) {
      return { allowed: true, reason: 'Role-based permission' };
    }

    return { allowed: false, reason: 'No permission' };
  }

  /**
   * Convert resource+action to permission string.
   */
  _resourceActionToPermission(resource, action) {
    return `${resource}:${action}`;
  }

  /**
   * Load RBAC state from storage.
   */
  async load() {
    if (!this.storage) {
      return;
    }

    try {
      // Load roles
      const roleKeys = await this.storage.keys('rbac:role:*');
      for (const key of roleKeys) {
        const data = await this.storage.get(key);
        const role = new Role(data.name, data);
        this.roles.set(role.name, role);
      }

      // Load users
      const userKeys = await this.storage.keys('rbac:user:*');
      for (const key of userKeys) {
        const data = await this.storage.get(key);
        const user = new User(data.id, data);
        this.users.set(user.id, user);
      }

      // Load policies
      const policyKeys = await this.storage.keys('rbac:policy:*');
      for (const key of policyKeys) {
        const data = await this.storage.get(key);
        const policy = new Policy(data.name, data);
        this.policies.set(policy.name, policy);
      }

      this.emit('loaded');
    } catch (error) {
      this.emit('error', { error });
    }
  }

  /**
   * Save RBAC state to storage.
   */
  async save() {
    if (!this.storage) {
      return;
    }

    try {
      // Save roles
      for (const role of this.roles.values()) {
        await this.storage.set(`rbac:role:${role.name}`, role.toJSON());
      }

      // Save users
      for (const user of this.users.values()) {
        await this.storage.set(`rbac:user:${user.id}`, user.toJSON(true));
      }

      // Save policies
      for (const policy of this.policies.values()) {
        await this.storage.set(`rbac:policy:${policy.name}`, policy.toJSON());
      }

      this.emit('saved');
    } catch (error) {
      this.emit('error', { error });
    }
  }

  /**
   * Get RBAC status.
   */
  getStatus() {
    return {
      roles: this.roles.size,
      users: this.users.size,
      policies: this.policies.size,
      builtInRoles: Array.from(this.roles.values())
        .filter(r => r.builtIn)
        .map(r => r.name)
    };
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalRBAC = null;

export function getRBACManager(options = {}) {
  if (!globalRBAC) {
    globalRBAC = new RBACManager(options);
  }
  return globalRBAC;
}

export function createRBACManager(options = {}) {
  return new RBACManager(options);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  Permission,
  BuiltInRole,
  Role,
  User,
  Policy,
  RBACManager,
  getRBACManager,
  createRBACManager
};
