// Module: Pretty CLI Output
// Description: Beautiful, human-readable output formatting for NewZoneCore CLI
// File: core/cli/pretty-output.js

import { color } from './colors.js';

// Terminal width detection
const TERM_WIDTH = process.stdout.columns || 80;

// ============================================================================
// BASIC FORMATTING
// ============================================================================

/**
 * Print a section header
 */
export function printHeader(title) {
  const line = '─'.repeat(TERM_WIDTH - 4);
  console.log();
  console.log(color.bold(color.blue(`┌${line}┐`)));
  console.log(color.bold(color.blue(`│  ${title.padEnd(TERM_WIDTH - 6)}  │`)));
  console.log(color.bold(color.blue(`└${line}┘`)));
  console.log();
}

/**
 * Print a sub-header
 */
export function printSubHeader(title) {
  console.log();
  console.log(color.bold(color.blue(`▶ ${title}`)));
  console.log(color.gray('─'.repeat(40)));
}

/**
 * Print a key-value pair
 */
export function printKeyValue(key, value, indent = 0) {
  const padding = ' '.repeat(indent);
  const keyStr = color.gray(`${padding}${key}:`);
  
  if (value === null || value === undefined) {
    console.log(`${keyStr} ${color.gray('N/A')}`);
  } else if (typeof value === 'boolean') {
    const valStr = value ? color.green('✓ yes') : color.red('✗ no');
    console.log(`${keyStr} ${valStr}`);
  } else if (typeof value === 'number') {
    console.log(`${keyStr} ${color.blue(value)}`);
  } else {
    console.log(`${keyStr} ${value}`);
  }
}

/**
 * Print a success message
 */
export function printSuccess(message) {
  console.log(color.green(`✓ ${message}`));
}

/**
 * Print an error message
 */
export function printError(message) {
  console.log(color.red(`✗ ${message}`));
}

/**
 * Print a warning message
 */
export function printWarning(message) {
  console.log(color.bold(color.red(`⚠ ${message}`)));
}

/**
 * Print an info message
 */
export function printInfo(message) {
  console.log(color.blue(`ℹ ${message}`));
}

// ============================================================================
// TABLES
// ============================================================================

/**
 * Print a table with headers and rows
 */
export function printTable(headers, rows, options = {}) {
  const { indent = 0, compact = false } = options;
  const padding = ' '.repeat(indent);
  
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRowLen = Math.max(...rows.map(r => String(r[i] || '').length));
    return Math.max(h.length, maxRowLen);
  });
  
  // Header separator
  const separator = widths.map(w => '─'.repeat(w + 2)).join('┼');
  
  // Print header
  const headerRow = headers.map((h, i) => ` ${h.padEnd(widths[i])} `).join('│');
  console.log(`${padding}┌${widths.map(w => '─'.repeat(w + 2)).join('┬')}┐`);
  console.log(`${padding}│${color.bold(headerRow)}│`);
  console.log(`${padding}├${separator}┤`);
  
  // Print rows
  rows.forEach((row, rowIndex) => {
    const rowStr = row.map((cell, i) => {
      const val = String(cell || '');
      return ` ${val.padEnd(widths[i])} `;
    }).join('│');
    console.log(`${padding}│${rowStr}│`);
    
    if (!compact && rowIndex < rows.length - 1) {
      console.log(`${padding}├${widths.map(w => '─'.repeat(w + 2)).join('┼')}┤`);
    }
  });
  
  // Footer
  console.log(`${padding}└${widths.map(w => '─'.repeat(w + 2)).join('┴')}┘`);
}

// ============================================================================
// SPECIAL FORMATTING
// ============================================================================

/**
 * Format uptime in human-readable form
 */
export function formatUptime(ms) {
  if (!ms || ms < 0) return 'N/A';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours % 24 > 0) parts.push(`${hours % 24}h`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);
  if (seconds % 60 > 0 && parts.length < 2) parts.push(`${seconds % 60}s`);
  
  return parts.join(' ') || '< 1s';
}

/**
 * Format a timestamp
 */
export function formatTimestamp(iso) {
  if (!iso) return 'N/A';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Truncate a key/hash for display
 */
export function truncateKey(key, maxLen = 32) {
  if (!key) return 'N/A';
  if (key.length <= maxLen) return key;
  return `${key.slice(0, maxLen / 2)}...${key.slice(-maxLen / 2)}`;
}

/**
 * Print a node ID with visual decoration
 */
export function printNodeId(nodeId) {
  if (!nodeId) {
    console.log(color.gray('Node ID: Not available'));
    return;
  }
  
  console.log();
  console.log(color.bold('Node ID:'));
  console.log(color.blue('┌──────────────────────────────────────────────────────────────┐'));
  console.log(color.blue('│') + '  ' + color.green(nodeId.slice(0, 28)) + '  ' + color.blue('│'));
  console.log(color.blue('│') + '  ' + color.green(nodeId.slice(28)) + '  ' + color.blue('│'));
  console.log(color.blue('└──────────────────────────────────────────────────────────────┘'));
  console.log();
}

/**
 * Print a seed phrase in a nice grid
 */
export function printSeedPhrase(phrase) {
  if (!phrase) {
    console.log(color.gray('Seed phrase not available'));
    return;
  }
  
  const words = phrase.split(' ');
  const cols = 4;
  const rows = Math.ceil(words.length / cols);
  
  console.log();
  console.log(color.bold(color.yellow('Recovery Seed Phrase:')));
  console.log(color.yellow('┌' + '──────────────'.repeat(cols) + '┐'));
  
  for (let r = 0; r < rows; r++) {
    const rowWords = [];
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const word = words[idx] || '';
      const num = color.gray(`${String(idx + 1).padStart(2)}. `);
      rowWords.push(`${num}${word.padEnd(8)}`);
    }
    console.log(color.yellow('│') + rowWords.join('  ') + color.yellow('│'));
  }
  
  console.log(color.yellow('└' + '──────────────'.repeat(cols) + '┘'));
  console.log();
  console.log(color.red('⚠ Keep this phrase safe and secret!'));
  console.log();
}

// ============================================================================
// STATUS DISPLAYS
// ============================================================================

/**
 * Print daemon status overview
 */
export function printStatusOverview(state) {
  printHeader('NewZoneCore Status');
  
  // Core info
  printSubHeader('Core');
  printKeyValue('Status', color.green('Online'), 2);
  printKeyValue('Started', formatTimestamp(state.startedAt), 2);
  printKeyValue('Uptime', formatUptime(state.uptime_ms || state.runtime?.uptime_ms), 2);
  
  // Identity
  if (state.identity || state.node_id) {
    printSubHeader('Identity');
    const nodeId = state.node_id || state.identity?.node_id || state.identity?.ed25519_public;
    printKeyValue('Node ID', truncateKey(nodeId), 2);
    printKeyValue('Ed25519', truncateKey(state.identity?.ed25519_public), 2);
    printKeyValue('X25519', truncateKey(state.identity?.x25519_public || state.ecdh_public), 2);
  }
  
  // Trust
  if (state.trust) {
    printSubHeader('Trust Store');
    const peersCount = state.trust.peers?.length || 0;
    printKeyValue('Trusted Peers', peersCount, 2);
  }
  
  // Services
  if (state.services) {
    printSubHeader('Services');
    printKeyValue('Registered', state.services.length, 2);
  }
}

/**
 * Print trust store contents
 */
export function printTrustStore(trust) {
  printHeader('Trust Store');
  
  const peers = trust.peers || [];
  
  if (peers.length === 0) {
    console.log(color.gray('No trusted peers configured.'));
    console.log();
    console.log('To add a peer: nzcore trust add <id> <pubkey>');
    return;
  }
  
  console.log(`Found ${color.green(peers.length)} trusted peer(s):\n`);
  
  peers.forEach((peer, index) => {
    console.log(`  ${color.blue(`${index + 1}.`)} ${color.bold(peer.id)}`);
    console.log(`     ${color.gray('Public Key:')} ${truncateKey(peer.pubkey, 40)}`);
    if (peer.addedAt) {
      console.log(`     ${color.gray('Added:')} ${formatTimestamp(peer.addedAt)}`);
    }
    console.log();
  });
}

/**
 * Print services list
 */
export function printServicesList(services) {
  printHeader('Registered Services');
  
  if (!services || services.length === 0) {
    console.log(color.gray('No services registered.'));
    return;
  }
  
  const rows = services.map((s, i) => [
    String(i + 1),
    s.name || 'unnamed',
    s.status || 'unknown',
    s.registeredAt ? formatTimestamp(s.registeredAt) : 'N/A'
  ]);
  
  printTable(['#', 'Name', 'Status', 'Registered'], rows);
}

// ============================================================================
// PROGRESS & ANIMATION
// ============================================================================

/**
 * Create a simple progress bar
 */
export function progressBar(current, total, width = 30) {
  const percent = Math.min(100, Math.max(0, (current / total) * 100));
  const filled = Math.round(width * (current / total));
  const empty = width - filled;
  
  const bar = color.green('█'.repeat(filled)) + color.gray('░'.repeat(empty));
  return `[${bar}] ${percent.toFixed(1)}%`;
}

/**
 * Show a loading spinner (returns stop function)
 */
export function showSpinner(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  
  const interval = setInterval(() => {
    const frame = color.blue(frames[i]);
    process.stdout.write(`\r${frame} ${message}...`);
    i = (i + 1) % frames.length;
  }, 80);
  
  return () => {
    clearInterval(interval);
    process.stdout.write('\r' + ' '.repeat(message.length + 10) + '\r');
  };
}

// ============================================================================
// HELP SCREENS
// ============================================================================

/**
 * Print main help
 */
export function printMainHelp(commands) {
  printHeader('NewZoneCore CLI');
  
  console.log('Usage: nzcore <command> [options]\n');
  
  console.log(color.bold('Commands:\n'));
  
  const commandList = Object.entries(commands)
    .filter(([_, cmd]) => cmd.desc)
    .map(([name, cmd]) => [name, cmd.desc]);
  
  printTable(['Command', 'Description'], commandList, { compact: true });
  
  console.log();
  console.log(`Run ${color.blue('nzcore help <command>')} for detailed information.`);
  console.log();
}

/**
 * Print command-specific help
 */
export function printCommandHelp(name, cmd) {
  printHeader(`nzcore ${name}`);
  
  if (cmd.usage) {
    console.log(color.bold('Usage:'));
    console.log(`  ${color.blue(cmd.usage)}`);
    console.log();
  }
  
  if (cmd.details) {
    console.log(color.bold('Description:'));
    console.log(`  ${cmd.details}`);
    console.log();
  }
  
  if (cmd.examples && cmd.examples.length > 0) {
    console.log(color.bold('Examples:'));
    cmd.examples.forEach(ex => {
      console.log(`  ${color.gray('$')} ${ex}`);
    });
    console.log();
  }
}
