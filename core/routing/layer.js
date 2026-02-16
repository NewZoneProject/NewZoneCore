// Module: Routing Layer v2
// Description: Advanced multi-hop routing with TTL, hop-by-hop signatures,
//              routing tables, and message delivery guarantees.
// File: core/routing/layer.js

import { EventTypes, getEventBus } from '../eventbus/index.js';

// ============================================================================
// ROUTING CONSTANTS
// ============================================================================

export const RouteState = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  INVALID: 'invalid',
  PENDING: 'pending'
};

export const MessageType = {
  DIRECT: 'direct',
  BROADCAST: 'broadcast',
  FLOOD: 'flood',
  ROUTED: 'routed'
};

export const DEFAULT_TTL = 10;
export const MAX_HOPS = 15;
export const ROUTE_EXPIRY = 3600000; // 1 hour

// ============================================================================
// ROUTING TABLE ENTRY
// ============================================================================

export class RouteEntry {
  constructor(options = {}) {
    this.destination = options.destination;
    this.nextHop = options.nextHop;
    this.metric = options.metric || 1;
    this.hops = options.hops || [];
    this.state = RouteState.ACTIVE;
    this.createdAt = new Date().toISOString();
    this.lastUsed = null;
    this.expiresAt = options.expiresAt || new Date(Date.now() + ROUTE_EXPIRY).toISOString();
    this.metadata = options.metadata || {};
  }

  isExpired() {
    return new Date() > new Date(this.expiresAt);
  }

  use() {
    this.lastUsed = new Date().toISOString();
  }

  toJSON() {
    return {
      destination: this.destination,
      nextHop: this.nextHop,
      metric: this.metric,
      hops: this.hops,
      state: this.state,
      createdAt: this.createdAt,
      lastUsed: this.lastUsed,
      expiresAt: this.expiresAt
    };
  }
}

// ============================================================================
// ROUTED MESSAGE
// ============================================================================

export class RoutedMessage {
  constructor(options = {}) {
    this.id = options.id || `msg:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    this.type = options.type || MessageType.ROUTED;
    this.from = options.from;
    this.to = options.to;
    this.payload = options.payload;
    this.ttl = options.ttl || DEFAULT_TTL;
    this.hops = options.hops || [];
    this.signatures = [];
    this.createdAt = new Date().toISOString();
    this.metadata = options.metadata || {};
  }

  /**
   * Add hop to the message
   */
  addHop(nodeId) {
    if (this.hops.length >= MAX_HOPS) {
      throw new Error('Maximum hops exceeded');
    }

    this.hops.push({
      node: nodeId,
      timestamp: new Date().toISOString()
    });

    this.ttl--;
  }

  /**
   * Add signature for current hop
   */
  async addSignature(identity) {
    const hopIndex = this.hops.length - 1;
    const payload = this._getSignPayload(hopIndex);

    const result = await identity.sign(payload);

    this.signatures.push({
      hopIndex,
      nodeId: identity.getNodeId(),
      signature: result.signature,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Verify hop signatures
   */
  async verifySignatures(getPublicKey) {
    for (const sig of this.signatures) {
      const hop = this.hops[sig.hopIndex];
      if (!hop) {
        return { valid: false, error: `Invalid hop index: ${sig.hopIndex}` };
      }

      const publicKey = await getPublicKey(hop.node);
      if (!publicKey) {
        return { valid: false, error: `No public key for node: ${hop.node}` };
      }

      const sign = await import('../crypto/sign.js');

      const payload = this._getSignPayload(sig.hopIndex);
      const valid = sign.verify(
        Buffer.from(payload, 'utf8'),
        Buffer.from(sig.signature, 'base64'),
        Buffer.from(publicKey, 'base64')
      );

      if (!valid) {
        return { valid: false, error: `Invalid signature at hop ${sig.hopIndex}` };
      }
    }

    return { valid: true };
  }

  /**
   * Check if message is for this node
   */
  isForMe(myNodeId) {
    return this.to === myNodeId || this.to === '*';
  }

  /**
   * Check if message should be forwarded
   */
  shouldForward() {
    return this.ttl > 0 && this.hops.length < MAX_HOPS;
  }

  /**
   * Get payload for signing at specific hop
   */
  _getSignPayload(hopIndex) {
    return JSON.stringify({
      id: this.id,
      from: this.from,
      to: this.to,
      payload: this.payload,
      ttl: this.ttl,
      hopIndex,
      hopNode: this.hops[hopIndex]?.node
    });
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      from: this.from,
      to: this.to,
      payload: this.payload,
      ttl: this.ttl,
      hops: this.hops,
      signatures: this.signatures,
      createdAt: this.createdAt,
      metadata: this.metadata
    };
  }

  static fromJSON(data) {
    const msg = new RoutedMessage({
      id: data.id,
      type: data.type,
      from: data.from,
      to: data.to,
      payload: data.payload,
      ttl: data.ttl,
      metadata: data.metadata
    });

    msg.hops = data.hops || [];
    msg.signatures = data.signatures || [];
    msg.createdAt = data.createdAt;

    return msg;
  }
}

// ============================================================================
// ROUTING TABLE
// ============================================================================

export class RoutingTable {
  constructor(options = {}) {
    this.entries = new Map();
    this.eventBus = getEventBus();
    this.maxEntries = options.maxEntries || 1000;
    this.defaultExpiry = options.defaultExpiry || ROUTE_EXPIRY;
  }

  /**
   * Add or update a route
   */
  addRoute(destination, nextHop, options = {}) {
    const existing = this.entries.get(destination);

    const entry = new RouteEntry({
      destination,
      nextHop,
      metric: options.metric || 1,
      hops: options.hops || [],
      expiresAt: options.expiresAt || new Date(Date.now() + this.defaultExpiry).toISOString(),
      metadata: options.metadata
    });

    // Keep existing if it has better metric
    if (existing && existing.metric < entry.metric) {
      return existing;
    }

    this.entries.set(destination, entry);

    this.eventBus.emit(EventTypes.ROUTE_ADDED, {
      destination,
      nextHop,
      metric: entry.metric
    });

    return entry;
  }

  /**
   * Remove a route
   */
  removeRoute(destination) {
    const entry = this.entries.get(destination);

    if (entry) {
      this.entries.delete(destination);

      this.eventBus.emit(EventTypes.ROUTE_REMOVED, {
        destination,
        nextHop: entry.nextHop
      });

      return true;
    }

    return false;
  }

  /**
   * Get route to destination
   */
  getRoute(destination) {
    const entry = this.entries.get(destination);

    if (entry && !entry.isExpired()) {
      entry.use();
      return entry;
    }

    return null;
  }

  /**
   * Get next hop for destination
   */
  getNextHop(destination) {
    const route = this.getRoute(destination);
    return route?.nextHop || null;
  }

  /**
   * Check if route exists
   */
  hasRoute(destination) {
    const entry = this.entries.get(destination);
    return entry && !entry.isExpired();
  }

  /**
   * Find best route through multiple hops
   */
  findPath(destination, visited = new Set()) {
    const direct = this.getRoute(destination);
    if (direct) {
      return [direct];
    }

    // Look for multi-hop paths
    for (const [dest, entry] of this.entries) {
      if (visited.has(dest) || entry.isExpired()) continue;

      visited.add(dest);
      const rest = this.findPath(destination, visited);

      if (rest.length > 0) {
        return [entry, ...rest];
      }
    }

    return [];
  }

  /**
   * Cleanup expired routes
   */
  cleanup() {
    const now = new Date();
    let removed = 0;

    for (const [destination, entry] of this.entries) {
      if (entry.isExpired()) {
        this.entries.delete(destination);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Get all routes
   */
  getAllRoutes() {
    const routes = [];

    for (const entry of this.entries.values()) {
      if (!entry.isExpired()) {
        routes.push(entry.toJSON());
      }
    }

    return routes;
  }

  /**
   * Get table stats
   */
  getStats() {
    let active = 0;
    let expired = 0;

    for (const entry of this.entries.values()) {
      if (entry.isExpired()) {
        expired++;
      } else {
        active++;
      }
    }

    return {
      total: this.entries.size,
      active,
      expired,
      maxEntries: this.maxEntries
    };
  }
}

// ============================================================================
// ROUTING LAYER
// ============================================================================

export class RoutingLayer {
  constructor(options = {}) {
    this.eventBus = getEventBus();
    this.identity = options.identity || null;
    this.nodeId = options.nodeId || options.identity?.getNodeId();
    this.trustStore = options.trustStore || null;
    this.discovery = options.discovery || null;

    this.table = new RoutingTable(options);

    // Message handlers
    this.handlers = new Map();

    // Pending messages (awaiting ACK)
    this.pending = new Map();
    this.pendingTimeout = options.pendingTimeout || 30000;

    // Settings
    this.options = {
      enableForwarding: options.enableForwarding !== false,
      requireSignatures: options.requireSignatures !== false,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      ...options
    };

    // Seen messages (for deduplication)
    this.seen = new Map();
    this.maxSeenAge = options.maxSeenAge || 300000; // 5 minutes
  }

  // ==========================================================================
  // MESSAGE SENDING
  // ==========================================================================

  /**
   * Send a direct message
   */
  async sendDirect(to, payload, options = {}) {
    const message = new RoutedMessage({
      type: MessageType.DIRECT,
      from: this.nodeId,
      to,
      payload,
      ttl: options.ttl || DEFAULT_TTL,
      metadata: options.metadata
    });

    message.addHop(this.nodeId);

    if (this.identity && this.options.requireSignatures) {
      await message.addSignature(this.identity);
    }

    this.eventBus.emit(EventTypes.ROUTE_MESSAGE, {
      messageId: message.id,
      to,
      type: 'direct'
    });

    return message;
  }

  /**
   * Send a routed message (multi-hop)
   */
  async sendRouted(to, payload, options = {}) {
    const route = this.table.getRoute(to);

    if (!route) {
      throw new Error(`No route to destination: ${to}`);
    }

    const message = new RoutedMessage({
      type: MessageType.ROUTED,
      from: this.nodeId,
      to,
      payload,
      ttl: options.ttl || DEFAULT_TTL,
      metadata: {
        ...options.metadata,
        route: route.hops
      }
    });

    message.addHop(this.nodeId);

    if (this.identity && this.options.requireSignatures) {
      await message.addSignature(this.identity);
    }

    // Store as pending if we need ACK
    if (options.requireAck) {
      this._addPending(message, options);
    }

    this.eventBus.emit(EventTypes.ROUTE_MESSAGE, {
      messageId: message.id,
      to,
      nextHop: route.nextHop,
      type: 'routed'
    });

    return message;
  }

  /**
   * Broadcast to all connected peers
   */
  async broadcast(payload, options = {}) {
    const message = new RoutedMessage({
      type: MessageType.BROADCAST,
      from: this.nodeId,
      to: '*',
      payload,
      ttl: options.ttl || DEFAULT_TTL,
      metadata: options.metadata
    });

    message.addHop(this.nodeId);

    if (this.identity && this.options.requireSignatures) {
      await message.addSignature(this.identity);
    }

    this.eventBus.emit(EventTypes.ROUTE_MESSAGE, {
      messageId: message.id,
      type: 'broadcast'
    });

    return message;
  }

  /**
   * Flood the network (for discovery)
   */
  async flood(payload, options = {}) {
    const message = new RoutedMessage({
      type: MessageType.FLOOD,
      from: this.nodeId,
      to: '*',
      payload,
      ttl: options.ttl || DEFAULT_TTL,
      metadata: options.metadata
    });

    message.addHop(this.nodeId);

    if (this.identity && this.options.requireSignatures) {
      await message.addSignature(this.identity);
    }

    this.eventBus.emit(EventTypes.ROUTE_MESSAGE, {
      messageId: message.id,
      type: 'flood'
    });

    return message;
  }

  // ==========================================================================
  // MESSAGE RECEIVING
  // ==========================================================================

  /**
   * Receive and process a message
   */
  async receive(messageData) {
    const message = RoutedMessage.fromJSON(messageData);

    // Check for duplicates
    if (this._isSeen(message.id)) {
      return { action: 'duplicate', messageId: message.id };
    }

    this._markSeen(message.id);

    // Check TTL
    if (message.ttl <= 0) {
      return { action: 'expired', messageId: message.id };
    }

    // Verify signatures if required
    if (this.options.requireSignatures && message.signatures.length > 0) {
      const valid = await message.verifySignatures(this._getPublicKey.bind(this));
      if (!valid.valid) {
        return { action: 'invalid', messageId: message.id, error: valid.error };
      }
    }

    // Check if message is for us
    if (message.isForMe(this.nodeId)) {
      return this._deliverLocal(message);
    }

    // Forward if enabled
    if (this.options.enableForwarding && message.shouldForward()) {
      return this._forward(message);
    }

    return { action: 'dropped', messageId: message.id };
  }

  /**
   * Deliver message to local handler
   */
  _deliverLocal(message) {
    const handler = this.handlers.get(message.type) || this.handlers.get('*');

    if (handler) {
      try {
        handler(message);
      } catch (error) {
        this.eventBus.emit(EventTypes.SYSTEM_WARNING, {
          warning: 'Handler error',
          messageId: message.id,
          error: error.message
        });
      }
    }

    // Send ACK if required
    this.eventBus.emit(EventTypes.ROUTE_MESSAGE, {
      messageId: message.id,
      from: message.from,
      type: 'delivered'
    });

    return {
      action: 'delivered',
      messageId: message.id,
      from: message.from
    };
  }

  /**
   * Forward message to next hop
   */
  async _forward(message) {
    const route = this.table.getRoute(message.to);

    if (!route) {
      // No route, try broadcast
      return { action: 'no_route', messageId: message.id };
    }

    message.addHop(this.nodeId);

    if (this.identity && this.options.requireSignatures) {
      await message.addSignature(this.identity);
    }

    this.eventBus.emit(EventTypes.ROUTE_MESSAGE, {
      messageId: message.id,
      to: message.to,
      nextHop: route.nextHop,
      type: 'forwarded'
    });

    return {
      action: 'forwarded',
      messageId: message.id,
      nextHop: route.nextHop
    };
  }

  // ==========================================================================
  // HANDLERS
  // ==========================================================================

  /**
   * Register message handler
   */
  onMessage(type, handler) {
    this.handlers.set(type, handler);
    return () => this.handlers.delete(type);
  }

  // ==========================================================================
  // ROUTE MANAGEMENT
  // ==========================================================================

  /**
   * Add a route
   */
  addRoute(destination, nextHop, options = {}) {
    return this.table.addRoute(destination, nextHop, options);
  }

  /**
   * Remove a route
   */
  removeRoute(destination) {
    return this.table.removeRoute(destination);
  }

  /**
   * Discover route to destination
   */
  async discoverRoute(destination, options = {}) {
    // Send route discovery message
    const discovery = await this.flood({
      type: 'route:discover',
      destination,
      timestamp: new Date().toISOString()
    }, {
      ttl: options.ttl || DEFAULT_TTL,
      metadata: { purpose: 'discovery' }
    });

    return discovery;
  }

  // ==========================================================================
  // PING/PONG
  // ==========================================================================

  /**
   * Send ping to peer
   */
  async ping(to) {
    const message = await this.sendDirect(to, {
      type: 'ping',
      timestamp: new Date().toISOString()
    });

    this.eventBus.emit(EventTypes.ROUTE_PING, {
      to,
      messageId: message.id
    });

    return message;
  }

  /**
   * Send pong response
   */
  async pong(to, pingId) {
    const message = await this.sendDirect(to, {
      type: 'pong',
      pingId,
      timestamp: new Date().toISOString()
    });

    this.eventBus.emit(EventTypes.ROUTE_PONG, {
      to,
      pingId
    });

    return message;
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  _isSeen(messageId) {
    const seen = this.seen.get(messageId);
    if (!seen) return false;

    // Check age
    if (Date.now() - seen > this.maxSeenAge) {
      this.seen.delete(messageId);
      return false;
    }

    return true;
  }

  _markSeen(messageId) {
    this.seen.set(messageId, Date.now());

    // Cleanup old entries
    if (this.seen.size > 10000) {
      const now = Date.now();
      for (const [id, time] of this.seen) {
        if (now - time > this.maxSeenAge) {
          this.seen.delete(id);
        }
      }
    }
  }

  _addPending(message, options) {
    const timeout = setTimeout(() => {
      this._handleTimeout(message.id, options);
    }, this.pendingTimeout);

    this.pending.set(message.id, {
      message,
      timeout,
      retries: 0,
      maxRetries: options.maxRetries || this.options.maxRetries
    });
  }

  _handleTimeout(messageId, options) {
    const pending = this.pending.get(messageId);
    if (!pending) return;

    if (pending.retries < pending.maxRetries) {
      pending.retries++;
      // Retry sending
      pending.timeout = setTimeout(() => {
        this._handleTimeout(messageId, options);
      }, this.pendingTimeout);
    } else {
      this.pending.delete(messageId);
      this.eventBus.emit(EventTypes.SYSTEM_WARNING, {
        warning: 'Message delivery failed',
        messageId
      });
    }
  }

  async _getPublicKey(nodeId) {
    // 1. Check trust store first
    if (this.trustStore) {
      const peer = this.trustStore.getPeer(nodeId);
      if (peer && peer.publicKey) {
        return peer.publicKey;
      }
    }

    // 2. Check discovery module
    if (this.discovery) {
      const peer = this.discovery.getPeer(nodeId);
      if (peer && peer.publicKey) {
        return peer.publicKey;
      }
    }

    // 3. Check peers in trust store (legacy format)
    if (this.trustStore?.peers) {
      const peer = this.trustStore.peers.find(p => p.id === nodeId);
      if (peer && peer.pubkey) {
        return peer.pubkey;
      }
    }

    // 4. Check identity for self
    if (this.nodeId === nodeId && this.identity) {
      return this.identity.getPublicKey();
    }

    return null;
  }
  
  /**
   * Set trust store reference
   */
  setTrustStore(trustStore) {
    this.trustStore = trustStore;
  }
  
  /**
   * Set discovery reference
   */
  setDiscovery(discovery) {
    this.discovery = discovery;
  }

  // ==========================================================================
  // STATUS
  // ==========================================================================

  getStatus() {
    return {
      nodeId: this.nodeId,
      routing: this.table.getStats(),
      pending: this.pending.size,
      handlers: this.handlers.size,
      seen: this.seen.size
    };
  }

  getRoutes() {
    return this.table.getAllRoutes();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

let globalRouter = null;

export function getRoutingLayer(options = {}) {
  if (!globalRouter) {
    globalRouter = new RoutingLayer(options);
  }
  return globalRouter;
}

export function createRoutingLayer(options = {}) {
  return new RoutingLayer(options);
}
