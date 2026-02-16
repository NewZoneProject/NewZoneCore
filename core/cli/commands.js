// Module: CLI Command Router
// Description: Dispatches nzcore CLI commands using the registry.
// Run: nzcore <command>
// File: core/cli/commands.js

import { commands } from './registry.js';
import { printHelp, printCommandHelp } from './help.js';

export async function runCli(args) {
  const cmd = args[0];

  // No command → show help
  if (!cmd) {
    printHelp();
    return;
  }

  // help command
  if (cmd === 'help') {
    const target = args[1];
    if (target && commands[target]) {
      printCommandHelp(target);
    } else {
      printHelp();
    }
    return;
  }

  // Unknown command
  if (!commands[cmd]) {
    console.log(`[nzcore] unknown command: ${cmd}`);
    printHelp();
    return;
  }

  const entry = commands[cmd];

  // Missing handler → safe fallback
  if (!entry.handler || typeof entry.handler !== 'function') {
    console.log(`[nzcore] command "${cmd}" has no handler.`);
    return;
  }

  // Execute command
  try {
    await entry.handler(args.slice(1));
  } catch (err) {
    console.log(`[nzcore] command failed: ${cmd}`);
    console.log(err);
  }
}