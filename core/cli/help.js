// Module: CLI Help Generator
// Description: Auto-generates help text from command registry.
// File: core/cli/help.js

import { commands } from './registry.js';

// Print global help
export function printHelp() {
  console.log('\nNewZoneCore CLI');
  console.log('----------------');
  console.log('Usage: nzcore <command> [options]\n');

  console.log('Available commands:');

  // Determine padding dynamically
  const longest = Math.max(...Object.keys(commands).map(k => k.length));

  for (const [name, meta] of Object.entries(commands)) {
    const desc = meta?.desc || '';
    console.log(`  ${name.padEnd(longest + 2)} ${desc}`);
  }

  console.log('\nUse: nzcore help <command> for details.\n');
}

// Print help for a specific command
export function printCommandHelp(name) {
  const meta = commands[name];

  if (!meta) {
    console.log(`[nzcore] unknown command: ${name}`);
    printHelp();
    return;
  }

  console.log(`\nCommand: ${name}`);
  console.log('----------------');

  console.log(`Description: ${meta.desc || 'No description available.'}`);
  console.log(`Usage:      ${meta.usage || 'No usage available.'}\n`);

  if (meta.details) {
    console.log(meta.details + '\n');
  }
}