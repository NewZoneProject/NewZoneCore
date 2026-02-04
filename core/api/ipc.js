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

      // --- fallback --------------------------------------------------------
      socket.write('unknown command');
    });
  });

  server.listen(SOCKET_PATH, () => {
    console.log(`[api:ipc] listening on ${SOCKET_PATH}`);
  });

  return server;
}