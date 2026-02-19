// Module: K-Buckets
// Description: Kademlia k-bucket implementation for routing table.
// File: network/dht/kbuckets.js

import { EventEmitter } from 'events';
import { NodeID, compareDistances } from './node-id.js';

/**
 * Default k-bucket size (Kademlia constant)
 */
export const K = 20;

/**
 * KBucket Events
 */
export const KBucketEvents = {
  ADDED: 'added',
  REMOVED: 'removed',
  UPDATED: 'updated',
  FULL: 'full',
  PING: 'ping'
};

/**
 * Contact information for a node in the bucket
 */
export class Contact {
  constructor(options) {
    this.id = options.id instanceof NodeID ? options.id : new NodeID(options.id);
    this.address = options.address;
    this.port = options.port;
    this.lastSeen = options.lastSeen || Date.now();
    this.vectorClock = options.vectorClock || 0;
  }

  /**
   * Update last seen timestamp
   */
  touch() {
    this.lastSeen = Date.now();
    this.vectorClock++;
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      id: this.id.hex,
      address: this.address,
      port: this.port,
      lastSeen: this.lastSeen,
      vectorClock: this.vectorClock
    };
  }

  /**
   * Create from JSON
   */
  static fromJSON(data) {
    return new Contact({
      id: NodeID.fromJSON(data.id),
      address: data.address,
      port: data.port,
      lastSeen: data.lastSeen,
      vectorClock: data.vectorClock
    });
  }
}

/**
 * KBucket class - stores contacts for a specific distance range
 */
export class KBucket extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.localNodeId = options.localNodeId;
    this.bucketIndex = options.bucketIndex || 0;
    this.k = options.k || K;
    
    // Contacts in this bucket
    this._contacts = [];
    
    // Pending contact (for LRU replacement)
    this._pending = null;
  }

  /**
   * Get number of contacts in bucket
   */
  get size() {
    return this._contacts.length;
  }

  /**
   * Check if bucket is full
   */
  get isFull() {
    return this._contacts.length >= this.k;
  }

  /**
   * Get all contacts
   */
  get contacts() {
    return [...this._contacts];
  }

  /**
   * Add a contact to the bucket
   */
  add(contact) {
    if (!(contact instanceof Contact)) {
      throw new Error('add() requires a Contact instance');
    }
    
    // Check if contact already exists
    const existingIndex = this._findContactIndex(contact.id);
    
    if (existingIndex !== -1) {
      // Move to end (most recently seen)
      const existing = this._contacts.splice(existingIndex, 1)[0];
      existing.touch();
      this._contacts.push(existing);
      
      this.emit(KBucketEvents.UPDATED, { contact: existing, bucket: this });
      return { added: false, updated: true };
    }
    
    // New contact
    if (this.isFull) {
      // Bucket is full, add to pending
      this._pending = contact;
      this.emit(KBucketEvents.FULL, { contact, bucket: this });
      return { added: false, pending: true };
    }
    
    // Add to end
    this._contacts.push(contact);
    this.emit(KBucketEvents.ADDED, { contact, bucket: this });
    return { added: true };
  }

  /**
   * Remove a contact from the bucket
   */
  remove(nodeId) {
    const index = this._findContactIndex(nodeId);
    
    if (index === -1) {
      return false;
    }
    
    const removed = this._contacts.splice(index, 1)[0];
    
    // Add pending contact if available
    if (this._pending) {
      this._contacts.push(this._pending);
      this.emit(KBucketEvents.ADDED, { contact: this._pending, bucket: this });
      this._pending = null;
    }
    
    this.emit(KBucketEvents.REMOVED, { contact: removed, bucket: this });
    return true;
  }

  /**
   * Get a contact by ID
   */
  get(nodeId) {
    const index = this._findContactIndex(nodeId);
    return index === -1 ? null : this._contacts[index];
  }

  /**
   * Check if contact exists
   */
  has(nodeId) {
    return this._findContactIndex(nodeId) !== -1;
  }

  /**
   * Get closest contacts to a target
   */
  getClosest(targetId, count = this.k) {
    const sorted = [...this._contacts].sort((a, b) => {
      const distA = targetId.distance(a.id);
      const distB = targetId.distance(b.id);
      return compareDistances(distA, distB);
    });
    
    return sorted.slice(0, count);
  }

  /**
   * Get oldest contact (least recently seen)
   */
  getOldest() {
    return this._contacts.length > 0 ? this._contacts[0] : null;
  }

  /**
   * Check if the oldest contact should be pinged
   */
  shouldPingOldest(maxAge = 15 * 60 * 1000) { // 15 minutes
    const oldest = this.getOldest();
    if (!oldest) return false;
    
    return Date.now() - oldest.lastSeen > maxAge;
  }

  /**
   * Find contact index by NodeID
   */
  _findContactIndex(nodeId) {
    const id = nodeId instanceof NodeID ? nodeId : new NodeID(nodeId);
    return this._contacts.findIndex(c => c.id.equals(id));
  }

  /**
   * Clear the bucket
   */
  clear() {
    this._contacts = [];
    this._pending = null;
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      bucketIndex: this.bucketIndex,
      contacts: this._contacts.map(c => c.toJSON()),
      pending: this._pending ? this._pending.toJSON() : null
    };
  }
}

/**
 * KBucketList - manages all k-buckets for a node
 */
export class KBucketList extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.localNodeId = options.localNodeId;
    this.k = options.k || K;
    this.maxBuckets = options.maxBuckets || 256; // 256 bits = 32 bytes
    
    // Create buckets
    this._buckets = new Array(this.maxBuckets);
    for (let i = 0; i < this.maxBuckets; i++) {
      this._buckets[i] = new KBucket({
        localNodeId: this.localNodeId,
        bucketIndex: i,
        k: this.k
      });
      
      // Forward bucket events
      this._buckets[i].on(KBucketEvents.PING, (data) => {
        this.emit(KBucketEvents.PING, data);
      });
    }
  }

  /**
   * Get total number of contacts
   */
  get size() {
    return this._buckets.reduce((sum, bucket) => sum + bucket.size, 0);
  }

  /**
   * Get bucket for a specific NodeID
   */
  getBucketFor(nodeId) {
    const index = this.localNodeId.bucketIndex(nodeId);
    return this._buckets[Math.min(index, this.maxBuckets - 1)];
  }

  /**
   * Add a contact to the appropriate bucket
   */
  add(contact) {
    const bucket = this.getBucketFor(contact.id);
    return bucket.add(contact);
  }

  /**
   * Remove a contact from its bucket
   */
  remove(nodeId) {
    const bucket = this.getBucketFor(nodeId);
    return bucket.remove(nodeId);
  }

  /**
   * Get a contact by ID
   */
  get(nodeId) {
    const bucket = this.getBucketFor(nodeId);
    return bucket.get(nodeId);
  }

  /**
   * Check if contact exists
   */
  has(nodeId) {
    const bucket = this.getBucketFor(nodeId);
    return bucket.has(nodeId);
  }

  /**
   * Get the K closest contacts to a target
   */
  getClosest(targetId, count = this.k) {
    const allContacts = [];
    
    // Collect all contacts
    for (const bucket of this._buckets) {
      allContacts.push(...bucket.contacts);
    }
    
    // Sort by distance to target
    const targetNodeId = targetId instanceof NodeID ? targetId : new NodeID(targetId);
    
    allContacts.sort((a, b) => {
      const distA = targetNodeId.distance(a.id);
      const distB = targetNodeId.distance(b.id);
      return compareDistances(distA, distB);
    });
    
    // Return closest K
    return allContacts.slice(0, count);
  }

  /**
   * Get all contacts
   */
  getAllContacts() {
    const contacts = [];
    for (const bucket of this._buckets) {
      contacts.push(...bucket.contacts);
    }
    return contacts;
  }

  /**
   * Get non-empty buckets
   */
  getNonEmptyBuckets() {
    return this._buckets.filter(b => b.size > 0);
  }

  /**
   * Get bucket statistics
   */
  getStats() {
    const bucketStats = this._buckets.map((bucket, i) => ({
      index: i,
      size: bucket.size
    })).filter(b => b.size > 0);
    
    return {
      totalContacts: this.size,
      totalBuckets: this._buckets.length,
      nonEmptyBuckets: bucketStats.length,
      buckets: bucketStats
    };
  }

  /**
   * Clear all buckets
   */
  clear() {
    for (const bucket of this._buckets) {
      bucket.clear();
    }
  }

  /**
   * Convert to JSON
   */
  toJSON() {
    return {
      localNodeId: this.localNodeId.hex,
      buckets: this.getNonEmptyBuckets().map(b => ({
        index: b.index,
        contacts: this._buckets[b.index].toJSON().contacts
      }))
    };
  }
}

export default KBucketList;
