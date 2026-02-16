// Module: Crypto Wrapper
// Description: Unified export surface for all NewZoneCore crypto primitives.
// File: core/crypto/index.js

// --- Random ---------------------------------------------------------------
export { randomBytes, randomSeed, randomNonce, randomHex } from './random.js';

// --- Signatures (Ed25519) -------------------------------------------------
export { getPublicKey, sign, verify } from './sign.js';

// --- Key Derivation (HKDF + BLAKE2b) --------------------------------------
export {
  deriveMasterKey,
  deriveSubKey,
  deriveNamedKey,
  deriveNonceBase,
  deriveSessionKeys
} from './derive.js';

// --- Crypto Box (X25519 + ChaCha20-Poly1305) ------------------------------
export {
  generateKeyPair,
  deriveSharedSecret,
  deriveBoxKey,
  boxEncrypt,
  boxDecrypt
} from './box.js';

// --- Seed & Mnemonic (BIP-39) ---------------------------------------------
export {
  generateMnemonic,
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  mnemonicToMasterKey
} from './seed.js';

// --- Persistent Keys (env/keys/) ------------------------------------------
export {
  loadIdentityKeys,
  loadECDHKeys,
  loadAllKeys
} from './keys.js';

// --- Master Key ------------------------------------------------------------
export {
  deriveMasterKey as deriveMasterKeyFromPassword,
  loadMasterKey,
  saveMasterKey,
  verifyPassword,
  initMasterKey
} from './master.js';

// --- Trust Store -----------------------------------------------------------
export {
  loadTrustStore,
  saveTrustStore,
  addTrustedPeer,
  removeTrustedPeer,
  isTrusted
} from './trust.js';

// --- Authenticated Handshake ----------------------------------------------
export {
  aliceStartHandshake,
  bobRespondHandshake,
  aliceFinishHandshake
} from './handshake.js';

// --- Secure Channel (X25519 + HKDF + AEAD) --------------------------------
export { SecureChannel } from './channel.js';

// --- High-level Packet Crypto ---------------------------------------------
export {
  buildSignedPacket,
  verifySignedPacket,
  encryptPacket,
  decryptPacket
} from './packets.js';

// --- Routing Packet Crypto -------------------------------------------------
export {
  signRoutingPacket,
  verifyRoutingPacket
} from './routing.js';