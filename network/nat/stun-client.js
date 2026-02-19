// Module: STUN Client
// Description: STUN protocol client for NAT traversal.
// File: network/nat/stun-client.js

import dgram from 'dgram';
import { EventEmitter } from 'events';
import {
  STUNMessageType,
  STUNAttribute,
  STUN_MAGIC_COOKIE,
  STUNErrorCode
} from './constants.js';

/**
 * STUN Client Options
 */
const DEFAULT_OPTIONS = {
  timeout: 5000,
  retries: 3,
  software: 'NewZoneCore STUN Client 0.2.0'
};

/**
 * STUN Client class - implements STUN protocol (RFC 5389)
 */
export class STUNClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this._socket = null;
    this._pendingRequests = new Map();
    this._isRunning = false;
  }

  /**
   * Start the STUN client
   */
  async start() {
    if (this._isRunning) return;
    
    this._socket = dgram.createSocket('udp4');
    
    this._socket.on('message', (message, rinfo) => {
      this._handleMessage(message, rinfo);
    });
    
    this._socket.on('error', (err) => {
      this.emit('error', err);
    });
    
    return new Promise((resolve) => {
      this._socket.bind(() => {
        this._isRunning = true;
        resolve();
      });
    });
  }

  /**
   * Stop the STUN client
   */
  async stop() {
    if (!this._isRunning) return;
    
    // Reject all pending requests
    for (const [id, { reject }] of this._pendingRequests) {
      reject(new Error('STUN client stopped'));
    }
    this._pendingRequests.clear();
    
    return new Promise((resolve) => {
      this._socket.close(() => {
        this._isRunning = false;
        resolve();
      });
    });
  }

  /**
   * Get binding from STUN server
   */
  async getBinding(server, port) {
    if (!this._isRunning) {
      await this.start();
    }
    
    return new Promise((resolve, reject) => {
      const transactionId = this._generateTransactionId();
      const request = this._createBindingRequest(transactionId);
      
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(transactionId);
        reject(new Error('STUN request timeout'));
      }, this.options.timeout);
      
      this._pendingRequests.set(transactionId, {
        resolve: (result) => {
          clearTimeout(timeout);
          this._pendingRequests.delete(transactionId);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeout);
          this._pendingRequests.delete(transactionId);
          reject(err);
        }
      });
      
      this._socket.send(request, port, server, (err) => {
        if (err) {
          clearTimeout(timeout);
          this._pendingRequests.delete(transactionId);
          reject(err);
        }
      });
    });
  }

  /**
   * Get external address (public IP and port)
   */
  async getExternalAddress(server, port) {
    const result = await this.getBinding(server, port);
    return result.mappedAddress;
  }

  /**
   * Create STUN Binding Request
   */
  _createBindingRequest(transactionId) {
    const buffers = [];
    
    // Message type (2 bytes) - Binding Request
    const messageType = Buffer.alloc(2);
    messageType.writeUInt16BE(STUNMessageType.BINDING_REQUEST, 0);
    buffers.push(messageType);
    
    // Message length (2 bytes) - will be updated
    const messageLength = Buffer.alloc(2);
    buffers.push(messageLength);
    
    // Magic cookie (4 bytes)
    const magicCookie = Buffer.alloc(4);
    magicCookie.writeUInt32BE(STUN_MAGIC_COOKIE, 0);
    buffers.push(magicCookie);
    
    // Transaction ID (12 bytes)
    buffers.push(transactionId);
    
    // Add SOFTWARE attribute
    if (this.options.software) {
      const softwareAttr = this._createSoftwareAttribute(this.options.software);
      buffers.push(softwareAttr);
    }
    
    // Calculate total attribute length
    const totalLength = buffers.slice(4).reduce((sum, buf) => sum + buf.length, 0);
    
    // Update message length (excluding 20-byte header)
    messageLength.writeUInt16BE(totalLength, 0);
    
    return Buffer.concat(buffers);
  }

  /**
   * Create SOFTWARE attribute
   */
  _createSoftwareAttribute(software) {
    const value = Buffer.from(software);
    const paddedLength = Math.ceil(value.length / 4) * 4;
    
    const buffer = Buffer.alloc(4 + paddedLength);
    
    // Attribute type
    buffer.writeUInt16BE(STUNAttribute.SOFTWARE, 0);
    
    // Attribute length
    buffer.writeUInt16BE(value.length, 2);
    
    // Value
    value.copy(buffer, 4);
    
    return buffer;
  }

  /**
   * Parse STUN response
   */
  _parseResponse(message) {
    if (message.length < 20) {
      throw new Error('Invalid STUN response: too short');
    }
    
    const messageType = message.readUInt16BE(0);
    const messageLength = message.readUInt16BE(2);
    const magicCookie = message.readUInt32BE(4);
    const transactionId = message.slice(8, 20);
    
    // Verify magic cookie
    if (magicCookie !== STUN_MAGIC_COOKIE) {
      throw new Error('Invalid STUN response: bad magic cookie');
    }
    
    const result = {
      messageType,
      transactionId,
      attributes: {}
    };
    
    // Parse attributes
    let offset = 20;
    while (offset < 20 + messageLength) {
      const attrType = message.readUInt16BE(offset);
      const attrLength = message.readUInt16BE(offset + 2);
      const attrValue = message.slice(offset + 4, offset + 4 + attrLength);
      
      const attr = this._parseAttribute(attrType, attrValue, transactionId);
      if (attr) {
        result.attributes[attr.name] = attr.value;
      }
      
      // Move to next attribute (with padding)
      offset += 4 + Math.ceil(attrLength / 4) * 4;
    }
    
    return result;
  }

  /**
   * Parse STUN attribute
   */
  _parseAttribute(type, value, transactionId) {
    switch (type) {
      case STUNAttribute.XOR_MAPPED_ADDRESS:
        return {
          name: 'xorMappedAddress',
          value: this._parseXorMappedAddress(value, transactionId)
        };
        
      case STUNAttribute.MAPPED_ADDRESS:
        return {
          name: 'mappedAddress',
          value: this._parseMappedAddress(value)
        };
        
      case STUNAttribute.ERROR_CODE:
        return {
          name: 'errorCode',
          value: this._parseErrorCode(value)
        };
        
      case STUNAttribute.SOFTWARE:
        return {
          name: 'software',
          value: value.toString('utf8')
        };
        
      default:
        return null;
    }
  }

  /**
   * Parse MAPPED-ADDRESS attribute
   */
  _parseMappedAddress(value) {
    const family = value.readUInt8(1);
    const port = value.readUInt16BE(2);
    
    let address;
    if (family === 1) { // IPv4
      address = `${value.readUInt8(4)}.${value.readUInt8(5)}.${value.readUInt8(6)}.${value.readUInt8(7)}`;
    } else if (family === 2) { // IPv6
      const parts = [];
      for (let i = 0; i < 16; i += 2) {
        parts.push(value.readUInt16BE(4 + i).toString(16));
      }
      address = parts.join(':');
    }
    
    return { family, address, port };
  }

  /**
   * Parse XOR-MAPPED-ADDRESS attribute
   */
  _parseXorMappedAddress(value, transactionId) {
    const family = value.readUInt8(1);
    
    // XOR port with magic cookie
    const xoredPort = value.readUInt16BE(2);
    const port = xoredPort ^ (STUN_MAGIC_COOKIE >> 16);
    
    let address;
    if (family === 1) { // IPv4
      // XOR address with magic cookie
      const magicCookieBuffer = Buffer.alloc(4);
      magicCookieBuffer.writeUInt32BE(STUN_MAGIC_COOKIE, 0);
      
      const xoredAddress = Buffer.alloc(4);
      for (let i = 0; i < 4; i++) {
        xoredAddress[i] = value[4 + i] ^ magicCookieBuffer[i];
      }
      
      address = `${xoredAddress[0]}.${xoredAddress[1]}.${xoredAddress[2]}.${xoredAddress[3]}`;
    } else if (family === 2) { // IPv6
      // XOR address with magic cookie + transaction ID
      const xorMask = Buffer.concat([
        Buffer.from([0x21, 0x12, 0xA4, 0x42]), // Magic cookie
        transactionId
      ]);
      
      const parts = [];
      for (let i = 0; i < 16; i += 2) {
        const xored = (value[4 + i] ^ xorMask[i]) << 8 | (value[5 + i] ^ xorMask[i + 1]);
        parts.push(xored.toString(16));
      }
      address = parts.join(':');
    }
    
    return { family, address, port };
  }

  /**
   * Parse ERROR-CODE attribute
   */
  _parseErrorCode(value) {
    const code = (value.readUInt8(2) & 0x07) * 100 + value.readUInt8(3);
    const reason = value.slice(4).toString('utf8');
    return { code, reason };
  }

  /**
   * Handle incoming STUN message
   */
  _handleMessage(message, rinfo) {
    try {
      const response = this._parseResponse(message);
      
      // Check for error response
      if (response.messageType === STUNMessageType.BINDING_ERROR) {
        const error = response.attributes.errorCode;
        const pending = this._pendingRequests.get(response.transactionId.toString('hex'));
        if (pending) {
          pending.reject(new Error(`STUN error ${error.code}: ${error.reason}`));
        }
        return;
      }
      
      // Find pending request
      const transactionIdHex = response.transactionId.toString('hex');
      const pending = this._pendingRequests.get(transactionIdHex);
      
      if (pending) {
        // Prefer XOR-MAPPED-ADDRESS, fallback to MAPPED-ADDRESS
        const mappedAddress = response.attributes.xorMappedAddress || 
                             response.attributes.mappedAddress;
        
        pending.resolve({
          transactionId: response.transactionId,
          mappedAddress,
          serverAddress: rinfo.address,
          serverPort: rinfo.port,
          software: response.attributes.software
        });
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  /**
   * Generate random transaction ID
   */
  _generateTransactionId() {
    const id = Buffer.alloc(12);
    for (let i = 0; i < 12; i++) {
      id[i] = Math.floor(Math.random() * 256);
    }
    return id;
  }
}

export default STUNClient;
