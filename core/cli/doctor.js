// Module: Environment Doctor
// Description: Performs diagnostics of NewZoneCore environment, files,
//              global installation, IPC socket and HTTP API.
// File: core/cli/doctor.js

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import net from 'net';
import http from 'http';
import { color } from './colors.js';

export async function runDoctor() {
  console.log(color.bold('\n[doctor] NewZoneCore Diagnostics\n'));

  // PREFIX (Termux or other)
  const prefix = process.env.PREFIX || '(none)';
  console.log(color.gray(`PREFIX: ${prefix}`));
  console.log(color.gray(`Node:   ${process.version}`));
  console.log(color.gray(`OS:     ${os.platform()} ${os.arch()}\n`));

  // 1. Check global installation (Termux only)
  if (prefix.includes('com.termux')) {
    const globalPath = path.join(prefix, 'lib/node_modules/nzcore');
    const binPath = path.join(prefix, 'bin/nzcore');

    console.log(color.bold('[doctor] Global installation:'));
    console.log('  module:', await exists(globalPath) ? color.green('OK') : color.red('Missing'));
    console.log('  binary:', await exists(binPath) ? color.green('OK') : color.red('Missing'));
    console.log('');
  }

  // 2. Check env/ structure
  console.log(color.bold('[doctor] env/ structure:'));

  const checks = {
    'env/': './env',
    'master.key': './env/master.key',
    'seed.txt': './env/seed.txt',
    'trust.json': './env/trust.json',
    'keys/': './env/keys',
    'logging.key': './env/keys/logging.key',
    'event.key': './env/keys/event.key',
    'queue.key': './env/keys/queue.key'
  };

  for (const [label, file] of Object.entries(checks)) {
    const ok = await exists(file);
    console.log(`  ${label.padEnd(12)} ${ok ? color.green('OK') : color.red('Missing')}`);
  }

  console.log('');

  // 3. Check IPC socket
  const socketPath =
    os.platform() === 'win32'
      ? '\\\\.\\pipe\\nzcore'
      : '/tmp/nzcore.sock';

  console.log(color.bold('[doctor] IPC socket:'));
  console.log('  path:', socketPath);

  const ipcOk = await checkIpc(socketPath);
  console.log('  status:', ipcOk ? color.green('OK') : color.red('Not responding'));
  console.log('');

  // 4. Check HTTP API
  console.log(color.bold('[doctor] HTTP API:'));

  const httpOk = await checkHttp('http://127.0.0.1:3000/health');
  console.log('  /health:', httpOk ? color.green('OK') : color.red('Not responding'));

  console.log('\n[doctor] Done.\n');
}

// --- helpers --------------------------------------------------------------

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function checkIpc(socketPath) {
  return new Promise((resolve) => {
    const client = net.createConnection(socketPath);

    client.on('connect', () => {
      client.end();
      resolve(true);
    });

    client.on('error', () => resolve(false));
  });
}

async function checkHttp(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => resolve(false));
    req.setTimeout(500, () => resolve(false));
  });
}