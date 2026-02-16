// Module: CLI Completion Generator
// Description: Generates and installs bash completion for nzcore.
// Run: nzcore completion
// File: core/cli/complete.js

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { commands } from './registry.js';
import { color } from './colors.js';

export async function generateCompletion() {
  console.log(color.blue('[complete] generating bash completion…'));

  // Termux environment check
  const prefix = process.env.PREFIX || '';
  if (!prefix.includes('com.termux')) {
    console.log(color.red('[complete] ERROR: This environment is not Termux.'));
    console.log(color.gray('Completion installation is only supported in Termux.'));
    return;
  }

  // Collect command names
  const names = Object.keys(commands || {}).join(' ');

  // Completion script content
  const script = `# NewZoneCore CLI completion

_nzcore_complete() {
  local cur opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  opts="${names}"

  COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
}

complete -F _nzcore_complete nzcore
`;

  // Temporary local file
  const localFile = path.resolve('nzcore-completion.sh');
  await fs.writeFile(localFile, script, 'utf8');
  console.log(color.green('[complete] created nzcore-completion.sh'));

  // Ensure ~/nzcore-dev exists
  const home = os.homedir();
  const devDir = path.join(home, 'nzcore-dev');

  try {
    await fs.mkdir(devDir, { recursive: true });
    console.log(color.green('[complete] ensured ~/nzcore-dev exists'));
  } catch (err) {
    console.log(color.red('[complete] ERROR: cannot create ~/nzcore-dev'));
    console.log(err);
    return;
  }

  // Move script into ~/nzcore-dev
  const devFile = path.join(devDir, 'nzcore-completion.sh');

  try {
    await fs.rename(localFile, devFile);
    console.log(color.green('[complete] moved completion script to ~/nzcore-dev/'));
  } catch {
    try {
      await fs.copyFile(localFile, devFile);
      await fs.rm(localFile);
      console.log(color.yellow('[complete] rename failed, copied instead'));
    } catch (err) {
      console.log(color.red('[complete] ERROR: cannot install completion script'));
      console.log(err);
      return;
    }
  }

  // Ensure ~/.bashrc exists
  const bashrc = path.join(home, '.bashrc');
  let bashrcContent = '';

  try {
    bashrcContent = await fs.readFile(bashrc, 'utf8');
  } catch {
    await fs.writeFile(bashrc, '', 'utf8');
    console.log(color.yellow('[complete] created new ~/.bashrc'));
  }

  // Add source line if missing
  const sourceLine = 'source ~/nzcore-dev/nzcore-completion.sh';

  if (!bashrcContent.includes(sourceLine)) {
    try {
      await fs.appendFile(bashrc, `\n${sourceLine}\n`);
      console.log(color.green('[complete] added source line to ~/.bashrc'));
    } catch (err) {
      console.log(color.red('[complete] ERROR: cannot modify ~/.bashrc'));
      console.log(err);
      return;
    }
  } else {
    console.log(color.gray('[complete] source line already exists in ~/.bashrc'));
  }

  console.log(color.blue('[complete] run: source ~/.bashrc'));
}