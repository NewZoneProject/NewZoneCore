// Module: DHT Exports
// Description: Main entry point for DHT components.
// File: network/dht/index.js

// Node ID
export { NodeID, NODE_ID_LENGTH, compareDistances, sortByDistance } from './node-id.js';

// K-Buckets
export { 
  KBucket, 
  KBucketList, 
  Contact, 
  K,
  KBucketEvents 
} from './kbuckets.js';

// Routing Table
export { RoutingTable, RoutingTableEvents } from './routing-table.js';

// Kademlia DHT
export { KademliaDHT, DHTEvents, RPCCommand } from './kademlia.js';

/**
 * Create a new DHT node
 */
import { NodeID } from './node-id.js';
import { KademliaDHT } from './kademlia.js';

export function createDHT(options = {}) {
  return new KademliaDHT(options);
}

export default KademliaDHT;
