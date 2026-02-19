// Module: Transport Exports
// Description: Export all transport-related modules.
// File: network/transport/main.js

// Base classes - from index.js
export { 
  Transport, 
  Connection, 
  ConnectionState, 
  ConnectionEvents, 
  TransportType, 
  TransportEvents 
} from './index.js';

// TCP Transport
export { TCPTransport } from './tcp-transport.js';

// WebSocket Transport
export { WebSocketTransport } from './websocket-transport.js';

// Message Framing
export { 
  Frame, 
  FrameParser, 
  FRAME_MAGIC, 
  FRAME_HEADER_SIZE, 
  MAX_FRAME_SIZE,
  MessageType,
  MessageFlags,
  ParseResult,
  ParseError
} from './message-framing.js';

// Connection Pool
export { ConnectionPool, PoolEvents } from './connection-pool.js';
