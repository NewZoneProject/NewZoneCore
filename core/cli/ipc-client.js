// Module: IPC Client
// Description: Cross-platform IPC client for NewZoneCore daemon.
// File: core/cli/ipc-client.js

import net from 'net';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

// ---------------------------------------------------------------------------
// Universal IPC socket path (must match core/api/ipc.js)
// ---------------------------------------------------------------------------

const RUNTIME_DIR = path.join(process.cwd(), 'runtime', 'ipc');

const SOCKET_PATH =
  os.platform() === 'win32'
    ? '\\\\.\\pipe\\nzcore'
    : path.join(RUNTIME_DIR, 'nzcore.sock');

// Ensure runtime/ipc directory exists (client-side safety)
async function ensureRuntimeDir() {
  try {
    await fs.mkdir(RUNTIME_DIR, { recursive: true });
  } catch {}
}

/**
 * Send a raw command string to the IPC server and return the response.
 * @param {string} cmd - Command to send (e.g. "state")
 * @returns {Promise<string>} - Raw response from daemon
 */
export async function sendIpcCommand(cmd) {
  await ensureRuntimeDir();

  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH);

    let buffer = '';

    client.on('connect', () => {
      client.write(cmd);
    });

    client.on('data', (chunk) => {
      buffer += chunk.toString();
    });

    client.on('end', () => {
      resolve(buffer.trim());
    });

    client.on('error', (err) => {
      reject(new Error(`IPC connection failed: ${err.message}`));
    });
  });
}

/**
 * Request daemon state via IPC and return parsed JSON.
 * @returns {Promise<object>}
 */
export async function requestState() {
  const raw = await sendIpcCommand('state');

  try {
    return JSON.parse(raw);
  } catch {
    return { error: 'invalid_json', raw };
  }
}

