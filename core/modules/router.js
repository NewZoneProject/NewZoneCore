// Module: Distributed Router
// Description: Minimal message router for NewZoneCore. Uses secure-channel
//              module to send encrypted messages to trusted peers.
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

  async function send(peerId, payload) {
    const route = routes[peerId];
    if (!route) {
      throw new Error(`No route for peer ${peerId}`);
    }

    const secure = supervisor.modules?.getModule
      ? supervisor.modules.getModule('secure-channel')
      : null;

    if (!secure) {
      throw new Error('secure-channel module not available');
    }

    const channel =
      secure.getChannel(peerId) ||
      (await secure.createChannel(peerId, route.pubkey));

    const data = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = await secure.encrypt(channel, data);

    supervisor.emit('router:send', {
      peerId,
      size: encrypted.length
    });

    // Phase 2.x: here we would actually transmit encrypted bytes over network.
    // For now, this is a local-only placeholder.
    return encrypted;
  }

  async function receive(peerId, encrypted) {
    const secure = supervisor.modules?.getModule
      ? supervisor.modules.getModule('secure-channel')
      : null;

    if (!secure) {
      throw new Error('secure-channel module not available');
    }

    const channel = secure.getChannel(peerId);
    if (!channel) {
      throw new Error(`No channel for peer ${peerId}`);
    }

    const decrypted = await secure.decrypt(channel, encrypted);
    const json = new TextDecoder().decode(decrypted);
    const payload = JSON.parse(json);

    supervisor.emit('router:receive', {
      peerId,
      size: encrypted.length
    });

    return payload;
  }

  return {
    addRoute,
    removeRoute,
    listRoutes,
    send,
    receive
  };
}

