// Module: Protocol Layer
// Description: Export all protocol components.
// File: network/protocol/index.js

// Wire Format
export {
  PROTOCOL_VERSION,
  WireMessageType,
  WireFlags,
  WireErrorCode,
  WIRE_HEADER_SIZE,
  MAX_MESSAGE_SIZE,
  WireHeader,
  WireMessage,
  WireParser,
  SequenceGenerator
} from './wire-format.js';

// Handshake
export {
  HandshakeState,
  HandshakeEvents,
  AuthMethod,
  HandshakeManager
} from './handshake.js';

// Encryption
export {
  EncryptionAlgorithm,
  KDFAlgorithm,
  NONCE_SIZE,
  KEY_SIZE,
  TAG_SIZE,
  ChannelEncryptor,
  createEncryptedMessage,
  decryptMessage
} from './encryption.js';

/**
 * Create protocol handler
 */
import { WireParser, SequenceGenerator } from './wire-format.js';
import { HandshakeManager } from './handshake.js';
import { ChannelEncryptor } from './encryption.js';

export function createProtocolHandler(options = {}) {
  const parser = new WireParser(options);
  const sequence = new SequenceGenerator();
  const handshake = new HandshakeManager(options);
  const encryptor = new ChannelEncryptor(options);
  
  return {
    parser,
    sequence,
    handshake,
    encryptor,
    
    /**
     * Process incoming data
     */
    process(data) {
      const { messages, error } = parser.feed(data);
      return { messages, error };
    },
    
    /**
     * Create message
     */
    createMessage(type, payload, flags = 0) {
      const WireMessage = require('./wire-format.js').WireMessage;
      return new WireMessage({
        header: { type, flags, sequence: sequence.next() },
        payload
      });
    },
    
    /**
     * Encrypt payload
     */
    encrypt(payload) {
      return encryptor.encrypt(payload);
    },
    
    /**
     * Decrypt payload
     */
    decrypt(ciphertext) {
      return encryptor.decrypt(ciphertext);
    },
    
    /**
     * Cleanup
     */
    destroy() {
      encryptor.destroy();
      handshake.reset();
    }
  };
}

export default {
  createProtocolHandler
};
