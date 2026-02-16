// setup-nzcore.js
// Installer for the nzcore CLI in Termux
// Auto-detects project location, creates launcher, updates PATH

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

// --- Colored output ---------------------------------------------------------

function ok(msg) {
  console.log(`\x1b[32m✔\x1b[0m ${msg}`);
}

function warn(msg) {
  console.log(`\x1b[33m⚠\x1b[0m ${msg}`);
}

function err(msg) {
  console.log(`\x1b[31m✖\x1b[0m ${msg}`);
}

// --- 1. Auto-detect project root -------------------------------------------

const possibleRoots = [
  '/storage/emulated/0/git/NewZoneCore',
  '/sdcard/git/NewZoneCore',
  '/storage/self/primary/git/NewZoneCore'
];

let projectRoot = null;

for (const p of possibleRoots) {
  if (fs.existsSync(p) && fs.existsSync(path.join(p, 'core', 'main.js'))) {
    projectRoot = p;
    break;
  }
}

if (!projectRoot) {
  err('NewZoneCore project not found on SD card.');
  console.log('Checked paths:');
  possibleRoots.forEach(p => console.log('  - ' + p));
  process.exit(1);
}

ok(`Project detected: ${projectRoot}`);

const cliPath = path.join(projectRoot, 'core/cli/commands.js');

// --- 2. Validate CLI presence ----------------------------------------------

if (!fs.existsSync(cliPath)) {
  err('core/cli/commands.js not found — cannot install CLI.');
  process.exit(1);
}

ok('CLI file found: core/cli/commands.js');

// --- 3. Ensure ~/bin exists -------------------------------------------------

const home = os.homedir();
const binDir = path.join(home, 'bin');

if (!fs.existsSync(binDir)) {
  fs.mkdirSync(binDir, { recursive: true });
  ok('Created ~/bin directory');
} else {
  ok('~/bin directory already exists');
}

// --- 4. Create ~/bin/nzcore launcher ---------------------------------------

const nzcoreBin = path.join(binDir, 'nzcore');

const launcher = `#!/data/data/com.termux/files/usr/bin/env node
import { runCli } from '${cliPath}';
runCli(process.argv.slice(2));
`;

try {
  fs.writeFileSync(nzcoreBin, launcher, 'utf8');
  ok('Created ~/bin/nzcore launcher');
} catch (e) {
  err('Failed to create ~/bin/nzcore');
  console.error(e);
  process.exit(1);
}

// --- 5. Make launcher executable -------------------------------------------

try {
  fs.chmodSync(nzcoreBin, 0o755);
  ok('Set executable permissions');
} catch (e) {
  err('Failed to set executable permissions');
  console.error(e);
  process.exit(1);
}

// --- 6. Add ~/bin to PATH ---------------------------------------------------

const bashrc = path.join(home, '.bashrc');
const exportLine = `export PATH="$HOME/bin:$PATH"`;

let bashrcContent = fs.existsSync(bashrc)
  ? fs.readFileSync(bashrc, 'utf8')
  : '';

if (!bashrcContent.includes(exportLine)) {
  try {
    fs.appendFileSync(bashrc, '\n' + exportLine + '\n');
    ok('Added ~/bin to PATH via .bashrc');
  } catch (e) {
    warn('Failed to update .bashrc — add manually:');
    console.log(exportLine);
  }
} else {
  ok('PATH already contains ~/bin');
}

// --- 7. Attempt to reload shell config -------------------------------------

console.log('[setup] Reloading shell configuration...');

try {
  execSync(`bash -c "source ~/.bashrc"`);
  ok('Shell configuration loaded');
} catch {
  warn('Could not execute "source ~/.bashrc" — Termux limitation');
}

warn('Restart Termux completely to apply PATH changes.');

// --- 8. Final message -------------------------------------------------------

console.log('\n\x1b[36mInstallation complete.\x1b[0m');
console.log('You can now run: \x1b[32mnzcore start\x1b[0m\n');