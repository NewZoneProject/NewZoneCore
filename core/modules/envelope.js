// Module: Message Envelope
// Description: Creates and verifies signed message envelopes for NewZoneCore.
// File: core/modules/envelope.js

/**
 * Create a message envelope.
 *
 * @param {Object} options
 * @param {string} options.type
 * @param {string} options.from
 * @param {string} options.to
 * @param {Object} options.body
 * @param {Function} options.sign - async (Uint8Array) => Uint8Array
 */
export async function createEnvelopeModule() {
  function randomNonce() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Buffer.from(arr).toString('hex');
  }

  function encode(obj) {
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  function decode(bytes) {
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function create({ type, from, to, body, sign }) {
    const env = {
      version: 1,
      type,
      from,
      to,
      ts: Date.now(),
      nonce: randomNonce(),
      body
    };

    const encoded = encode(env);
    const signature = await sign(encoded);

    return {
      ...env,
      signature: Buffer.from(signature).toString('base64')
    };
  }

  async function verify(env, verifyFn) {
    if (!env.signature) return false;

    const sig = Uint8Array.from(Buffer.from(env.signature, 'base64'));

    const unsigned = {
      version: env.version,
      type: env.type,
      from: env.from,
      to: env.to,
      ts: env.ts,
      nonce: env.nonce,
      body: env.body
    };

    const encoded = encode(unsigned);

    return verifyFn(encoded, sig, env.from);
  }

  return {
    create,
    verify,
    encode,
    decode
  };
}

