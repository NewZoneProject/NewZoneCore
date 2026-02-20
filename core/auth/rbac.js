// Module: Role-Based Access Control (RBAC)
// Description: Granular permission system for NewZoneCore.
//              Roles, permissions, and access control enforcement.
// File: core/auth/rbac.js

import { EventEmitter } from 'events';
import { getEventBus, EventTypes } from '../eventbus/index.js';
import { getLogger } from '../logger.js';

// ============================================================================
// PREDEFINED ROLES
// ============================================================================

export const PredefinedRoles = {
  // Full access
  ADMIN: {
    id: 'admin',
    name: 'Administrator',
    description: 'Full system access',
    permissions: ['*'],
    isSystem: true
  },
  
  // Read-only access
  READONLY: {
    id: 'readonly',
    name: 'Read Only',
    description: 'Read-only access to all resources',
    permissions: ['read:*'],
    isSystem: true
  },
  
  // Standard user access
  USER: {
    id: 'user',
    name: 'User',
    description: 'Standard user access',
    permissions: [
      'read:state',
      'read:identity',
      'read:trust',
      'write:trust:self',
      'execute:service'
    ],
    isSystem: true
  },
  
  // Service account
  SERVICE: {
    id: 'service',
    name: 'Service',
    description: 'Service account with limited access',
    permissions: [
      'read:state',
      'execute:service',
      'send:network'
    ],
    isSystem: true
  },
  
  // Guest access (minimal)
  GUEST: {
    id: 'guest',
    name: 'Guest',
    description: 'Minimal guest access',
    permissions: [
      'read:health'
    ],
    isSystem: true
  }
};

// ============================================================================
// PERMISSION CATALOG
// ============================================================================

export const PermissionCatalog = {
  // State permissions
  'read:state': 'Read supervisor state',
  'write:state': 'Modify supervisor state',
  
  // Identity permissions
  'read:identity': 'Read identity information',
  'write:identity': 'Modify identity',
  'read:identity:self': 'Read own identity',
  
  // Trust permissions
  'read:trust': 'Read trust store',
  'write:trust': 'Modify trust store',
  'write:trust:self': 'Modify own trust entries',
  
  // Service permissions
  'read:service': 'Read service information',
  'execute:service': 'Execute services',
  'manage:service': 'Manage services (start/stop)',
  
  // Network permissions
  'read:network': 'Read network data',
  'send:network': 'Send network messages',
  'manage:network': 'Manage network connections',
  
  // Storage permissions
  'read:storage': 'Read from storage',
  'write:storage': 'Write to storage',
  'delete:storage': 'Delete from storage',
  
  // Channel permissions
  'read:channel': 'Read channel data',
  'write:channel': 'Write to channel',
  'manage:channel': 'Manage channels',
  
  // Plugin permissions
  'read:plugin': 'Read plugin information',
  'manage:plugin': 'Manage plugins (load/unload)',
  
  // Admin permissions
  'admin:users': 'Manage users and roles',
  'admin:config': 'Manage system configuration',
  'admin:audit': 'Access audit logs',
  
  // Health permissions
  'read:health': 'Read health status',
  
  // Wildcard
  '*': 'All permissions'
};

// ============================================================================
// ROLE
// ============================================================================

export class Role {
  constructor(options = {}) {
    this.id = options.id || 'unknown';
    this.name = options.name || 'Unknown Role';
    this.description = options.description || '';
    this.permissions = options.permissions || [];
    this.isSystem = options.isSystem || false;
    this.createdAt = options.createdAt || new Date().toISOString();
    this.updatedAt = options.updatedAt || new Date().toISOString();
  }
  
  /**
   * Check if role has permission.
   */
  hasPermission(permission) {
    // Wildcard permission
    if (this.permissions.includes('*')) {
      return true;
    }
    
    // Direct permission
    if (this.permissions.includes(permission)) {
      return true;
    }
    
    // Wildcard prefix (e.g., 'read:*' matches 'read:state')
    const prefix = permission.split(':')[0] + ':*';
    if (this.permissions.includes(prefix)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Add permission to role.
   */
  addPermission(permission) {
    if (!this.permissions.includes(permission)) {
      this.permissions.push(permission);
      this.updatedAt = new Date().toISOString();
    }
  }
  
  /**
   * Remove permission from role.
   */
  removePermission(permission) {
    const index = this.permissions.indexOf(permission);
    if (index !== -1) {
      this.permissions.splice(index, 1);
      this.updatedAt = new Date().toISOString();
    }
  }
  
  /**
   * Serialize role to JSON.
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      permissions: this.permissions,
      isSystem: this.isSystem,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
  
  /**
   * Deserialize role from JSON.
   */
  static fromJSON(data) {
    return new Role(data);
  }
}

// ============================================================================
// RBAC MANAGER
// ============================================================================

export class RBACManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.eventBus = getEventBus();
    this.logger = getLogger({ module: 'rbac' });
    
    this.roles = new Map(); // id -> Role
    this.userRoles = new Map(); // userId -> [roleId]
    this.rolePermissions = new Map(); // roleId -> Set(permissions)
    
    // Initialize with predefined roles
    this._initPredefinedRoles();
  }
  
  /**
   * Initialize predefined roles.
   */
  _initPredefinedRoles() {
    for (const roleData of Object.values(PredefinedRoles)) {
      const role = new Role(roleData);
      this.roles.set(role.id, role);
    }
    
    this.logger.info('Initialized predefined roles', {
      count: this.roles.size
    });
  }
  
  /**
   * Create a new role.
   */
  async createRole(options) {
    const { id, name, description, permissions } = options;
    
    if (this.roles.has(id)) {
      throw new Error(`Role already exists: ${id}`);
    }
    
    const role = new Role({
      id,
      name,
      description,
      permissions: permissions || []
    });
    
    this.roles.set(id, role);
    
    this.eventBus.emit(EventTypes.SYSTEM_INFO, {
      component: 'rbac',
      action: 'role_created',
      roleId: id
    });
    
    this.logger.info('Role created', { id, name });
    return role;
  }
  
  /**
   * Get role by ID.
   */
  getRole(roleId) {
    return this.roles.get(roleId);
  }
  
  /**
   * List all roles.
   */
  listRoles() {
    const list = [];
    for (const role of this.roles.values()) {
      list.push(role.toJSON());
    }
    return list;
  }
  
  /**
   * Update role.
   */
  async updateRole(roleId, updates) {
    const role = this.roles.get(roleId);
    if (!role) {
      throw new Error(`Role not found: ${roleId}`);
    }
    
    if (role.isSystem) {
      throw new Error('Cannot modify system role');
    }
    
    if (updates.name) role.name = updates.name;
    if (updates.description) role.description = updates.description;
    if (updates.permissions) {
      role.permissions = updates.permissions;
    }
    
    role.updatedAt = new Date().toISOString();
    
    this.eventBus.emit(EventTypes.SYSTEM_INFO, {
      component: 'rbac',
      action: 'role_updated',
      roleId: roleId
    });
    
    return role;
  }
  
  /**
   * Delete role.
   */
  async deleteRole(roleId) {
    const role = this.roles.get(roleId);
    if (!role) {
      throw new Error(`Role not found: ${roleId}`);
    }
    
    if (role.isSystem) {
      throw new Error('Cannot delete system role');
    }
    
    this.roles.delete(roleId);
    
    // Remove role from all users
    for (const [userId, roles] of this.userRoles) {
      const index = roles.indexOf(roleId);
      if (index !== -1) {
        roles.splice(index, 1);
      }
    }
    
    this.eventBus.emit(EventTypes.SYSTEM_INFO, {
      component: 'rbac',
      action: 'role_deleted',
      roleId: roleId
    });
    
    this.logger.info('Role deleted', { id: roleId });
    return true;
  }
  
  /**
   * Assign role to user.
   */
  async assignRole(userId, roleId) {
    if (!this.roles.has(roleId)) {
      throw new Error(`Role not found: ${roleId}`);
    }
    
    if (!this.userRoles.has(userId)) {
      this.userRoles.set(userId, []);
    }
    
    const userRoles = this.userRoles.get(userId);
    if (!userRoles.includes(roleId)) {
      userRoles.push(roleId);
    }
    
    this.eventBus.emit(EventTypes.SYSTEM_INFO, {
      component: 'rbac',
      action: 'role_assigned',
      userId,
      roleId
    });
    
    this.logger.info('Role assigned', { userId, roleId });
    return true;
  }
  
  /**
   * Remove role from user.
   */
  async removeRole(userId, roleId) {
    if (!this.userRoles.has(userId)) {
      return false;
    }
    
    const userRoles = this.userRoles.get(userId);
    const index = userRoles.indexOf(roleId);
    
    if (index !== -1) {
      userRoles.splice(index, 1);
      
      this.eventBus.emit(EventTypes.SYSTEM_INFO, {
        component: 'rbac',
        action: 'role_removed',
        userId,
        roleId
      });
      
      this.logger.info('Role removed', { userId, roleId });
      return true;
    }
    
    return false;
  }
  
  /**
   * Get user roles.
   */
  getUserRoles(userId) {
    const roleIds = this.userRoles.get(userId) || [];
    return roleIds.map(id => this.roles.get(id)).filter(Boolean);
  }
  
  /**
   * Check if user has permission.
   */
  hasPermission(userId, permission) {
    const userRoles = this.getUserRoles(userId);
    
    for (const role of userRoles) {
      if (role.hasPermission(permission)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Authorize user action.
   */
  authorize(userId, permission, resource) {
    const hasPermission = this.hasPermission(userId, permission);
    
    if (!hasPermission) {
      this.logger.warn('Authorization denied', {
        userId,
        permission,
        resource
      });
      
      this.eventBus.emit(EventTypes.SYSTEM_WARNING, {
        component: 'rbac',
        action: 'authorization_denied',
        userId,
        permission,
        resource
      });
      
      return {
        authorized: false,
        reason: 'Permission denied',
        userId,
        permission
      };
    }
    
    this.logger.debug('Authorization granted', {
      userId,
      permission,
      resource
    });
    
    return {
      authorized: true,
      userId,
      permission
    };
  }
  
  /**
   * Get permission catalog.
   */
  getPermissionCatalog() {
    return { ...PermissionCatalog };
  }
  
  /**
   * Get RBAC status.
   */
  getStatus() {
    const userRoleCounts = {};
    for (const [userId, roles] of this.userRoles) {
      userRoleCounts[userId] = roles.length;
    }
    
    return {
      totalRoles: this.roles.size,
      totalUsers: this.userRoles.size,
      userRoleCounts,
      roles: this.listRoles()
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
