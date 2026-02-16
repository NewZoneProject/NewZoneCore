// Module: Distributed Router
// Description: Envelope-based encrypted router for NewZoneCore.
//              Uses secure-channel module and envelope module to
//              send/receive signed, encrypted messages.
// File: core/modules/router.js

/**
 * Create a distributed router.
 *
 * @param {Object} options
 * @param {Object} options.supervisor
 */
export function createRouter({ supervisor }) {
  if (!supervisor) {
    throw new Error('Router requires supervisor');
  }

  const routes = {}; // { peerId: { peerId, pubkey } }

  // -------------------------------------------------------------------------
  // Route management
  // -------------------------------------------------------------------------

  function addRoute(peerId, pubkey) {
    routes[peerId] = { peerId, pubkey };
    supervisor.emit('router:route-added', { peerId });
  }

  function removeRoute(peerId) {
    delete routes[peerId];
    supervisor.emit('router:route-removed', { peerId });
  }

  function listRoutes() {
    return Object.values(routes);
  }

  // -------------------------------------------------------------------------
  // Envelope helpers
  // -------------------------------------------------------------------------

  function getEnvelopeModule() {
    return supervisor.modules?.getModule
      ? supervisor.modules.getModule('envelope')
      : null;
  }

  function getSecureModule() {
    return supervisor.modules?.getModule
      ? supervisor.modules.getModule('secure-channel')
      : null;
  }

  // -------------------------------------------------------------------------
  // SEND
  // -------------------------------------------------------------------------

  async function send(peerId, payload) {
    const route = routes[peerId];
    if (!route) {
      throw new Error(`No route for peer ${peerId}`);
    }

    const envelope = getEnvelopeModule();
    const secure = getSecureModule();

    if (!envelope) throw new Error('envelope module not available');
    if (!secure) throw new Error('secure-channel module not available');

    // Create or reuse secure channel
    const channel =
      secure.getChannel(peerId) ||
      (await secure.createChannel(peerId, route.pubkey));

    // Build envelope
    const env = await envelope.create({
      type: 'msg',
      to: peerId,
      from: supervisor.getNodeId(),
      body: payload,
      sign: async (data) => secure.sign(data)
    });

    // Serialize envelope
    const encoded = new TextEncoder().encode(JSON.stringify(env));

    // Encrypt
    const encrypted = await secure.encrypt(channel, encoded);

    supervisor.emit('router:send', {
      peerId,
      size: encrypted.length
    });

    // Phase 2.x: actual network transport goes here
    return encrypted;
  }

  // -------------------------------------------------------------------------
  // RECEIVE
  // -------------------------------------------------------------------------

  async function receive(peerId, encrypted) {
    const envelope = getEnvelopeModule();
    const secure = getSecureModule();

    if (!envelope) throw new Error('envelope module not available');
    if (!secure) throw new Error('secure-channel module not available');

    const channel = secure.getChannel(peerId);
    if (!channel) {
      throw new Error(`No channel for peer ${peerId}`);
    }

    // Decrypt
    const decrypted = await secure.decrypt(channel, encrypted);
    const json = new TextDecoder().decode(decrypted);

    // Parse envelope
    const env = JSON.parse(json);

    // Validate envelope
    const ok = await envelope.verify(env, async (data, sig, pub) =>
      secure.verify(data, sig, pub)
    );

    if (!ok) {
      supervisor.emit('router:invalid', { peerId });
      throw new Error('Invalid envelope signature');
    }

    supervisor.emit('router:receive', {
      peerId,
      size: encrypted.length
    });

    // Emit high-level message event
    supervisor.emit('router:message', {
      from: env.from,
      to: env.to,
      type: env.type,
      body: env.body
    });

    return env;
  }

  // -------------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------------

  return {
    addRoute,
    removeRoute,
    listRoutes,
    send,
    receive
  };
}

