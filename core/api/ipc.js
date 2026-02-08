// Module: IPC Server
// Description: Minimal UNIX/Windows socket IPC server for NewZoneCore.
// File: core/api/ipc.js

import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// IPC socket path (Windows named pipe or UNIX socket)
// Termux fix: use $TMPDIR or Termux tmp directory instead of /tmp
// ---------------------------------------------------------------------------

const SOCKET_PATH =
  os.platform() === 'win32'
    ? '\\\\.\\pipe\\nzcore'
    : path.join(
        process.env.TMPDIR || '/data/data/com.termux/files/usr/tmp',
        'nzcore.sock'
      );

// ---------------------------------------------------------------------------
// Start IPC server
// ---------------------------------------------------------------------------

export async function startIpcServer({ supervisor }) {
  // Remove stale socket file (UNIX only)
  if (os.platform() !== 'win32') {
    try { await fs.unlink(SOCKET_PATH); } catch {}
  }

  // Ensure directory exists
  if (os.platform() !== 'win32') {
    const dir = path.dirname(SOCKET_PATH);
    try { await fs.mkdir(dir, { recursive: true }); } catch {}
  }

  const server = net.createServer(async (socket) => {
    socket.on('data', async (data) => {
      const cmd = data.toString().trim();

      // --- state -----------------------------------------------------------
      if (cmd === 'state') {
        let raw = {};

        try {
          raw = await supervisor.getState();
        } catch {
          raw = { error: 'state_unavailable' };
        }

        const state = {
          startedAt: raw.startedAt,
          node_id: raw.identity?.public || null,
          ecdh_public: raw.ecdh?.public || null,
          trust: raw.trust || {},
          services: raw.services || []
        };

        socket.write(JSON.stringify(state));
        return;
      }

      // --- trust:list ------------------------------------------------------
      if (cmd === 'trust:list') {
        const store = supervisor.trust || { peers: [] };
        socket.write(JSON.stringify({ peers: store.peers || [] }));
        return;
      }

      // --- trust:add <id> <pubkey> ----------------------------------------
      if (cmd.startsWith('trust:add ')) {
        const parts = cmd.split(' ');
        if (parts.length !== 3) {
          socket.write(JSON.stringify({ error: 'usage: trust:add <id> <pubkey>' }));
          return;
        }

        const id = parts[1];
        const pubkey = parts[2];

        try {
          if (!supervisor.trust.peers) supervisor.trust.peers = [];

          supervisor.trust.peers.push({
            id,
            pubkey,
            addedAt: new Date().toISOString()
          });

          socket.write(JSON.stringify({ ok: true }));
        } catch (err) {
          socket.write(JSON.stringify({ ok: false, error: err.message }));
        }

        return;
      }

      // --- trust:remove <id> ----------------------------------------------
      if (cmd.startsWith('trust:remove ')) {
        const parts = cmd.split(' ');
        if (parts.length !== 2) {
          socket.write(JSON.stringify({ error: 'usage: trust:remove <id>' }));
          return;
        }

        const id = parts[1];

        try {
          const before = supervisor.trust.peers?.length || 0;
          supervisor.trust.peers = (supervisor.trust.peers || []).filter(
            (p) => p.id !== id
          );
          const after = supervisor.trust.peers.length;

          socket.write(JSON.stringify({
            ok: true,
            removed: before - after
          }));
        } catch (err) {
          socket.write(JSON.stringify({ ok: false, error: err.message }));
        }

        return;
      },

      // --- identity --------------------------------------------------------
      if (cmd === 'identity') {
        const id = supervisor.identity?.public || null;
        const ecdh = supervisor.ecdh?.public || null;

        socket.write(JSON.stringify({
          node_id: id,
          ed25519_public: id,
          x25519_public: ecdh
        }));
        return;
      },

      // --- services --------------------------------------------------------
      if (cmd === 'services') {
        const list = supervisor.services || [];
        socket.write(JSON.stringify({ services: list }));
        return;
      }

      // --- fallback --------------------------------------------------------
      socket.write('unknown command');
    });
  });

  server.listen(SOCKET_PATH, () => {
    console.log(`[api:ipc] listening on ${SOCKET_PATH}`);
  });

  return server;
}
