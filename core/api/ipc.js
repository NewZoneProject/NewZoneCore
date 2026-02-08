// Module: IPC Server
// Description: Cross-platform, self-contained IPC server for NewZoneCore.
// File: core/api/ipc.js

import fs from 'fs/promises';
import net from 'net';
import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Universal IPC socket path (cross-platform, auto-created)
// ---------------------------------------------------------------------------

const RUNTIME_DIR = path.join(process.cwd(), 'runtime', 'ipc');

const SOCKET_PATH =
  os.platform() === 'win32'
    ? '\\\\.\\pipe\\nzcore'
    : path.join(RUNTIME_DIR, 'nzcore.sock');

// ---------------------------------------------------------------------------
// Start IPC server
// ---------------------------------------------------------------------------

export async function startIpcServer({ supervisor }) {
  // Ensure runtime/ipc directory exists
  try {
    await fs.mkdir(RUNTIME_DIR, { recursive: true });
  } catch {}

  // Remove stale socket file (UNIX only)
  if (os.platform() !== 'win32') {
    try { await fs.unlink(SOCKET_PATH); } catch {}
  }

  const server = net.createServer(async (socket) => {
    socket.on('data', async (data) => {
      const cmd = data.toString().trim();

      // Helper: write + end
      const reply = (obj) => {
        socket.write(JSON.stringify(obj));
        socket.end();
      };

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

        return reply(state);
      }

      // --- trust:list ------------------------------------------------------
      if (cmd === 'trust:list') {
        const store = supervisor.trust || { peers: [] };
        return reply({ peers: store.peers || [] });
      }

      // --- trust:add <id> <pubkey> ----------------------------------------
      if (cmd.startsWith('trust:add ')) {
        const parts = cmd.split(' ');
        if (parts.length !== 3) {
          return reply({ error: 'usage: trust:add <id> <pubkey>' });
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

          return reply({ ok: true });
        } catch (err) {
          return reply({ ok: false, error: err.message });
        }
      }

      // --- trust:remove <id> ----------------------------------------------
      if (cmd.startsWith('trust:remove ')) {
        const parts = cmd.split(' ');
        if (parts.length !== 2) {
          return reply({ error: 'usage: trust:remove <id>' });
        }

        const id = parts[1];

        try {
          const before = supervisor.trust.peers?.length || 0;
          supervisor.trust.peers = (supervisor.trust.peers || []).filter(
            (p) => p.id !== id
          );
          const after = supervisor.trust.peers.length;

          return reply({
            ok: true,
            removed: before - after
          });
        } catch (err) {
          return reply({ ok: false, error: err.message });
        }
      }

      // --- identity --------------------------------------------------------
      if (cmd === 'identity') {
        const id = supervisor.identity?.public || null;
        const ecdh = supervisor.ecdh?.public || null;

        return reply({
          node_id: id,
          ed25519_public: id,
          x25519_public: ecdh
        });
      }

      // --- services --------------------------------------------------------
      if (cmd === 'services') {
        const list = supervisor.services || [];
        return reply({ services: list });
      }

      // --- router:routes ---------------------------------------------------
      if (cmd === 'router:routes') {
        const router = supervisor.modules?.getModule
          ? supervisor.modules.getModule('router')
          : null;

        if (!router) {
          return reply({ error: 'router module not available' });
        }

        try {
          const routes = router.listRoutes();
          return reply({ routes });
        } catch (err) {
          return reply({ error: err.message });
        }
      }

      // --- router:add <peerId> <pubkey> -----------------------------------
      if (cmd.startsWith('router:add ')) {
        const parts = cmd.split(' ');
        if (parts.length !== 3) {
          return reply({ error: 'usage: router:add <peerId> <pubkey>' });
        }

        const peerId = parts[1];
        const pubkey = parts[2];

        const router = supervisor.modules?.getModule
          ? supervisor.modules.getModule('router')
          : null;

        if (!router) {
          return reply({ error: 'router module not available' });
        }

        try {
          router.addRoute(peerId, pubkey);
          return reply({ ok: true });
        } catch (err) {
          return reply({ ok: false, error: err.message });
        }
      }

      // --- router:remove <peerId> -----------------------------------------
      if (cmd.startsWith('router:remove ')) {
        const parts = cmd.split(' ');
        if (parts.length !== 2) {
          return reply({ error: 'usage: router:remove <peerId>' });
        }

        const peerId = parts[1];

        const router = supervisor.modules?.getModule
          ? supervisor.modules.getModule('router')
          : null;

        if (!router) {
          return reply({ error: 'router module not available' });
        }

        try {
          router.removeRoute(peerId);
          return reply({ ok: true });
        } catch (err) {
          return reply({ ok: false, error: err.message });
        }
      }

      // --- router:send <peerId> <json> ------------------------------------
      if (cmd.startsWith('router:send ')) {
        const parts = cmd.split(' ');
        const peerId = parts[1];
        const json = parts.slice(2).join(' ');

        if (!peerId || !json) {
          return reply({ error: 'usage: router:send <peerId> <json>' });
        }

        const router = supervisor.modules?.getModule
          ? supervisor.modules.getModule('router')
          : null;

        if (!router) {
          return reply({ error: 'router module not available' });
        }

        try {
          const payload = JSON.parse(json);
          await router.send(peerId, payload);
          return reply({ ok: true });
        } catch (err) {
          return reply({ ok: false, error: err.message });
        }
      }

      // --- router:ping <peerId> -------------------------------------------
      if (cmd.startsWith('router:ping ')) {
        const parts = cmd.split(' ');
        if (parts.length !== 2) {
          return reply({ error: 'usage: router:ping <peerId>' });
        }

        const peerId = parts[1];

        const router = supervisor.modules?.getModule
          ? supervisor.modules.getModule('router')
          : null;

        if (!router) {
          return reply({ error: 'router module not available' });
        }

        try {
          await router.send(peerId, {
            type: 'ping',
            body: { ts: Date.now() }
          });

          return reply({ ok: true });
        } catch (err) {
          return reply({ ok: false, error: err.message });
        }
      }

      // --- fallback --------------------------------------------------------
      return reply({ error: 'unknown command' });
    });
  });

  server.listen(SOCKET_PATH, () => {
    console.log(`[api:ipc] listening on ${SOCKET_PATH}`);
  });

  return server;
}

