// Module: NAT Types and Constants
// Description: NAT type definitions and constants.
// File: network/nat/constants.js

/**
 * NAT Types according to RFC 3489
 */
export const NATType = {
  UNKNOWN: 'unknown',
  NO_NAT: 'no_nat',               // No NAT detected (public IP)
  FULL_CONE: 'full_cone',          // Full Cone NAT (easiest)
  RESTRICTED_CONE: 'restricted_cone', // Restricted Cone NAT
  PORT_RESTRICTED: 'port_restricted', // Port Restricted Cone NAT
  SYMMETRIC: 'symmetric',          // Symmetric NAT (hardest)
  BLOCKED: 'blocked'               // UDP blocked
};

/**
 * NAT Behavior Types (RFC 4787 / RFC 5382)
 */
export const NATBehavior = {
  ENDPOINT_INDEPENDENT: 'endpoint_independent',
  ADDRESS_DEPENDENT: 'address_dependent',
  ADDRESS_PORT_DEPENDENT: 'address_port_dependent'
};

/**
 * NAT Filtering Types (RFC 4787 / RFC 5382)
 */
export const NATFiltering = {
  ENDPOINT_INDEPENDENT: 'endpoint_independent',
  ADDRESS_DEPENDENT: 'address_dependent',
  ADDRESS_PORT_DEPENDENT: 'address_port_dependent'
};

/**
 * NAT Events
 */
export const NATEvents = {
  DETECTED: 'nat_detected',
  MAPPING_CHANGED: 'mapping_changed',
  TIMEOUT: 'nat_timeout',
  ERROR: 'nat_error'
};

/**
 * STUN Message Types (RFC 5389)
 */
export const STUNMessageType = {
  BINDING_REQUEST: 0x0001,
  BINDING_SUCCESS: 0x0101,
  BINDING_ERROR: 0x0111,
  SHARED_SECRET_REQUEST: 0x0002,
  SHARED_SECRET_SUCCESS: 0x0102,
  SHARED_SECRET_ERROR: 0x0112
};

/**
 * STUN Attributes (RFC 5389)
 */
export const STUNAttribute = {
  MAPPED_ADDRESS: 0x0001,
  RESPONSE_ADDRESS: 0x0002,
  CHANGE_REQUEST: 0x0003,
  SOURCE_ADDRESS: 0x0004,
  CHANGED_ADDRESS: 0x0005,
  USERNAME: 0x0006,
  PASSWORD: 0x0007,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  UNKNOWN_ATTRIBUTES: 0x000A,
  REFLECTED_FROM: 0x000B,
  XOR_MAPPED_ADDRESS: 0x0020,
  SOFTWARE: 0x8022,
  ALTERNATE_SERVER: 0x8023,
  FINGERPRINT: 0x8028
};

/**
 * STUN Error Codes
 */
export const STUNErrorCode = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  UNKNOWN_ATTRIBUTE: 420,
  STALE_CREDENTIALS: 430,
  INTEGRITY_CHECK_FAILURE: 431,
  MISSING_USERNAME: 432,
  USE_TLS: 433,
  SERVER_ERROR: 500,
  GLOBAL_FAILURE: 600
};

/**
 * TURN Methods (RFC 5766)
 */
export const TURNMethod = {
  ALLOCATE: 0x0003,
  REFRESH: 0x0004,
  SEND: 0x0006,
  DATA: 0x0007,
  CREATE_PERMISSION: 0x0008,
  CHANNEL_BIND: 0x0009
};

/**
 * TURN Attributes
 */
export const TURNAttribute = {
  CHANNEL_NUMBER: 0x000C,
  LIFETIME: 0x000D,
  XOR_PEER_ADDRESS: 0x0012,
  DATA: 0x0013,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
  DONT_FRAGMENT: 0x001A,
  RESERVATION_TOKEN: 0x0022
};

/**
 * Default STUN servers
 */
export const DEFAULT_STUN_SERVERS = [
  { host: 'stun.l.google.com', port: 19302 },
  { host: 'stun1.l.google.com', port: 19302 },
  { host: 'stun2.l.google.com', port: 19302 },
  { host: 'stun3.l.google.com', port: 19302 },
  { host: 'stun4.l.google.com', port: 19302 }
];

/**
 * NAT detection timeout (ms)
 */
export const NAT_DETECTION_TIMEOUT = 5000;

/**
 * STUN Magic Cookie (RFC 5389)
 */
export const STUN_MAGIC_COOKIE = 0x2112A442;

export default {
  NATType,
  NATBehavior,
  NATFiltering,
  NATEvents,
  STUNMessageType,
  STUNAttribute,
  STUNErrorCode,
  TURNMethod,
  TURNAttribute,
  DEFAULT_STUN_SERVERS,
  NAT_DETECTION_TIMEOUT,
  STUN_MAGIC_COOKIE
};
