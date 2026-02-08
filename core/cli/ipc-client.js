// Module: IPC Client
// Description: Minimal IPC client for communicating with the NewZoneCore daemon.
// File: core/cli/ipc-client.js

import net from 'net';
import os from 'os';
import path from 'path';

// Resolve IPC socket path (same logic as core/api/ipc.js)
const SOCKET_PATH =
  os.platform() === 'win32'
    ? '\\\\.\\pipe\\nzcore'
    : path.join(
        process.env.TMPDIR || '/data/data/com.termux/files/usr/tmp',
        'nzcore.sock'
      );

/**
 * Send a raw command string to the IPC server and return the response.
 * @param {string} cmd - Command to send (e.g. "state")
 * @returns {Promise<string>} - Raw response from daemon
 */
export function sendIpcCommand(cmd) {
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

