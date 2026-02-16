// Module: Network Transport
// Description: Minimal TCP-based transport for NewZoneCore.
// File: core/modules/transport.js

import net from 'net';

export function createTransport({ supervisor, port = 9030 }) {
  if (!supervisor) {
    throw new Error('Transport requires supervisor');
  }

  const peers = {}; // { peerId: socket }

  const server = net.createServer((socket) => {
    const peerId = `${socket.remoteAddress}:${socket.remotePort}`;
    peers[peerId] = socket;

    supervisor.emit('transport:connect', { peerId });

    socket.on('data', (chunk) => {
      supervisor.emit('transport:raw', {
        peerId,
        size: chunk.length
      });

      if (typeof transport.onMessage === 'function') {
        transport.onMessage(peerId, chunk);
      }
    });

    socket.on('close', () => {
      delete peers[peerId];
      supervisor.emit('transport:disconnect', { peerId });
    });

    socket.on('error', (err) => {
      supervisor.emit('transport:error', { peerId, error: err.message });
    });
  });

  server.listen(port, () => {
    supervisor.emit('transport:listen', { port });
    console.log(`[transport] listening on ${port}`);
  });

  async function send(peerId, bytes) {
    const socket = peers[peerId];
    if (!socket) {
      throw new Error(`No socket for peer ${peerId}`);
    }
    socket.write(bytes);
  }

  const transport = {
    send,
    onMessage: null,
    listPeers() {
      return Object.keys(peers);
    },
    close() {
      server.close();
      Object.values(peers).forEach(s => s.destroy());
    }
  };

  return transport;
}

