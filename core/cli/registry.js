// Module: CLI Command Registry
// Description: Centralized registry of all nzcore CLI commands with beautiful output
// File: core/cli/registry.js

import {
  printHeader,
  printSubHeader,
  printKeyValue,
  printSuccess,
  printError,
  printWarning,
  printInfo,
  printStatusOverview,
  printTrustStore,
  printServicesList,
  printNodeId,
  printSeedPhrase,
  truncateKey,
  formatUptime,
  formatTimestamp,
  printMainHelp,
  printCommandHelp,
  showSpinner
} from './pretty-output.js';
import { color } from './colors.js';

// Lazy import helper
async function lazy(path) {
  try {
    return await import(path);
  } catch {
    return null;
  }
}

// ============================================================================
// COMMAND DEFINITIONS
// ============================================================================

export const commands = {
  // ---------------------------------------------------------------------------
  // CORE COMMANDS
  // ---------------------------------------------------------------------------

  start: {
    desc: 'Start the core daemon',
    usage: 'nzcore start',
    details: 'Bootstraps NewZoneCore and launches the daemon with HTTP and IPC APIs.',
    examples: ['nzcore start'],
    handler: async () => {
      printHeader('Starting NewZoneCore');
      
      const mod = await lazy('../../core.js');
      if (mod?.startCore) {
        printInfo('Initializing daemon...');
        await mod.startCore();
      } else {
        printError('startCore() unavailable');
      }
    }
  },

  status: {
    desc: 'Show daemon status',
    usage: 'nzcore status',
    details: 'Displays current daemon status including node ID, uptime, and services.',
    examples: ['nzcore status'],
    handler: async () => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.requestState) {
        printError('IPC client unavailable. Is the daemon running?');
        return;
      }

      const stopSpinner = showSpinner('Fetching status');
      
      try {
        const state = await mod.requestState();
        stopSpinner();
        printStatusOverview(state);
      } catch (err) {
        stopSpinner();
        printError('Failed to get daemon status');
        printError(err.message);
        printInfo('Make sure the daemon is running: nzcore start');
      }
    }
  },

  // ---------------------------------------------------------------------------
  // IDENTITY COMMANDS
  // ---------------------------------------------------------------------------

  identity: {
    desc: 'Show node identity',
    usage: 'nzcore identity [--full]',
    details: 'Displays Ed25519 and X25519 public keys. Use --full to show complete keys.',
    examples: ['nzcore identity', 'nzcore identity --full'],
    handler: async (args) => {
      const showFull = args.includes('--full') || args.includes('-f');
      
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        printError('IPC client unavailable');
        return;
      }

      try {
        const raw = await mod.sendIpcCommand('identity');
        const data = JSON.parse(raw);
        
        printHeader('Node Identity');
        
        if (data.node_id) {
          printNodeId(showFull ? data.node_id : truncateKey(data.node_id, 48));
        }
        
        printSubHeader('Cryptographic Keys');
        printKeyValue('Ed25519 (Signing)', showFull ? data.ed25519_public : truncateKey(data.ed25519_public), 2);
        printKeyValue('X25519 (ECDH)', showFull ? data.x25519_public : truncateKey(data.x25519_public), 2);
        
        console.log();
      } catch (err) {
        printError('Failed to get identity');
        printError(err.message);
      }
    }
  },

  seed: {
    desc: 'Show recovery seed phrase',
    usage: 'nzcore seed',
    details: 'Displays the BIP-39 seed phrase for identity recovery. KEEP IT SECRET!',
    examples: ['nzcore seed'],
    handler: async () => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        printError('IPC client unavailable');
        return;
      }

      try {
        // Read seed directly from file (IPC doesn't expose it for security)
        const fs = await import('fs/promises');
        const path = await import('path');
        
        const seedPath = path.join(process.cwd(), 'env', 'seed.txt');
        const seed = (await fs.readFile(seedPath, 'utf8')).trim();
        
        printHeader('Recovery Seed Phrase');
        printSeedPhrase(seed);
        printWarning('Anyone with this phrase can recover your identity!');
        printWarning('Store it safely offline.');
        
      } catch (err) {
        printError('Failed to read seed phrase');
        printError(err.message);
      }
    }
  },

  // ---------------------------------------------------------------------------
  // TRUST COMMANDS
  // ---------------------------------------------------------------------------

  trust: {
    desc: 'Manage trust store',
    usage: 'nzcore trust <list|add|remove> [args]',
    details: 'View and manage trusted peers in the trust store.',
    examples: [
      'nzcore trust list',
      'nzcore trust add alice <pubkey>',
      'nzcore trust remove alice'
    ],
    handler: async (args) => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        printError('IPC client unavailable');
        return;
      }

      const sub = args[0];

      // trust list
      if (sub === 'list' || !sub) {
        try {
          const raw = await mod.sendIpcCommand('trust:list');
          const data = JSON.parse(raw);
          printTrustStore({ peers: data.peers });
        } catch (err) {
          printError('Failed to list trust store');
          printError(err.message);
        }
        return;
      }

      // trust add <id> <pubkey>
      if (sub === 'add') {
        const id = args[1];
        const pubkey = args[2];

        if (!id || !pubkey) {
          printError('Usage: nzcore trust add <id> <pubkey>');
          return;
        }

        try {
          const raw = await mod.sendIpcCommand(`trust:add ${id} ${pubkey}`);
          const data = JSON.parse(raw);
          
          if (data.ok) {
            printSuccess(`Peer "${id}" added to trust store`);
          } else {
            printError(data.error || 'Failed to add peer');
          }
        } catch (err) {
          printError('Failed to add peer');
          printError(err.message);
        }
        return;
      }

      // trust remove <id>
      if (sub === 'remove' || sub === 'rm') {
        const id = args[1];

        if (!id) {
          printError('Usage: nzcore trust remove <id>');
          return;
        }

        try {
          const raw = await mod.sendIpcCommand(`trust:remove ${id}`);
          const data = JSON.parse(raw);
          
          if (data.ok) {
            printSuccess(`Peer "${id}" removed from trust store`);
          } else {
            printError(data.error || 'Failed to remove peer');
          }
        } catch (err) {
          printError('Failed to remove peer');
          printError(err.message);
        }
        return;
      }

      // Unknown subcommand
      printError(`Unknown subcommand: ${sub}`);
      printInfo('Available: list, add, remove');
    }
  },

  // ---------------------------------------------------------------------------
  // SERVICE COMMANDS
  // ---------------------------------------------------------------------------

  services: {
    desc: 'List registered services',
    usage: 'nzcore services',
    details: 'Displays all services registered in the supervisor.',
    examples: ['nzcore services'],
    handler: async () => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        printError('IPC client unavailable');
        return;
      }

      try {
        const raw = await mod.sendIpcCommand('services');
        const data = JSON.parse(raw);
        printServicesList(data.services);
      } catch (err) {
        printError('Failed to list services');
        printError(err.message);
      }
    }
  },

  // ---------------------------------------------------------------------------
  // SYSTEM COMMANDS
  // ---------------------------------------------------------------------------

  doctor: {
    desc: 'Run diagnostics',
    usage: 'nzcore doctor',
    details: 'Runs environment diagnostics and checks for common issues.',
    examples: ['nzcore doctor'],
    handler: async () => {
      printHeader('NewZoneCore Diagnostics');
      
      const mod = await lazy('./doctor.js');
      if (mod?.runDoctor) {
        await mod.runDoctor();
      } else {
        printError('Doctor module unavailable');
      }
    }
  },

  reset: {
    desc: 'Reset environment',
    usage: 'nzcore reset [--force]',
    details: 'Deletes env/ and recreates a clean environment. WARNING: Destroys all keys!',
    examples: ['nzcore reset --force'],
    handler: async (args) => {
      const force = args.includes('--force') || args.includes('-f');
      
      if (!force) {
        printWarning('This will destroy all keys and trust data!');
        printInfo('Run with --force to confirm');
        return;
      }
      
      printHeader('Resetting Environment');
      
      const mod = await lazy('../startup/recovery.js');
      if (mod?.resetEnvironment) {
        await mod.resetEnvironment();
        printSuccess('Environment reset complete');
      } else {
        printError('Reset module unavailable');
      }
    }
  },

  recover: {
    desc: 'Recover from seed',
    usage: 'nzcore recover',
    details: 'Restores env/ from a seed phrase.',
    examples: ['nzcore recover'],
    handler: async () => {
      printHeader('Recovery Mode');
      
      const mod = await lazy('../startup/recovery.js');
      if (mod?.fullRecovery) {
        await mod.fullRecovery();
      } else {
        printError('Recovery module unavailable');
      }
    }
  },

  // ---------------------------------------------------------------------------
  // ROUTING COMMANDS
  // ---------------------------------------------------------------------------

  routes: {
    desc: 'List routing table',
    usage: 'nzcore routes',
    details: 'Shows all known routes in the distributed router.',
    examples: ['nzcore routes'],
    handler: async () => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        printError('IPC client unavailable');
        return;
      }

      try {
        const raw = await mod.sendIpcCommand('router:routes');
        const data = JSON.parse(raw);
        
        printHeader('Routing Table');
        
        if (data.error) {
          printError(data.error);
          return;
        }
        
        if (!data.routes || data.routes.length === 0) {
          printInfo('No routes configured');
          return;
        }
        
        data.routes.forEach((route, i) => {
          console.log(`  ${color.blue(`${i + 1}.`)} ${color.bold(route.peerId || route.id)}`);
          console.log(`     ${color.gray('Public Key:')} ${truncateKey(route.pubkey, 40)}`);
        });
        
      } catch (err) {
        printError('Failed to list routes');
        printError(err.message);
      }
    }
  },

  route: {
    desc: 'Manage routing table',
    usage: 'nzcore route <add|remove> [args]',
    details: 'Add or remove routes in the distributed router.',
    examples: [
      'nzcore route add <peerId> <pubkey>',
      'nzcore route remove <peerId>'
    ],
    handler: async (args) => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        printError('IPC client unavailable');
        return;
      }

      const sub = args[0];

      if (sub === 'add') {
        const peerId = args[1];
        const pubkey = args[2];

        if (!peerId || !pubkey) {
          printError('Usage: nzcore route add <peerId> <pubkey>');
          return;
        }

        try {
          const raw = await mod.sendIpcCommand(`router:add ${peerId} ${pubkey}`);
          const data = JSON.parse(raw);
          
          if (data.ok) {
            printSuccess(`Route to "${peerId}" added`);
          } else {
            printError(data.error || 'Failed to add route');
          }
        } catch (err) {
          printError('Failed to add route');
          printError(err.message);
        }
        return;
      }

      if (sub === 'remove' || sub === 'rm') {
        const peerId = args[1];

        if (!peerId) {
          printError('Usage: nzcore route remove <peerId>');
          return;
        }

        try {
          const raw = await mod.sendIpcCommand(`router:remove ${peerId}`);
          const data = JSON.parse(raw);
          
          if (data.ok) {
            printSuccess(`Route to "${peerId}" removed`);
          } else {
            printError(data.error || 'Failed to remove route');
          }
        } catch (err) {
          printError('Failed to remove route');
          printError(err.message);
        }
        return;
      }

      printError(`Unknown subcommand: ${sub}`);
      printInfo('Available: add, remove');
    }
  },

  // ---------------------------------------------------------------------------
  // MESSAGING COMMANDS
  // ---------------------------------------------------------------------------

  send: {
    desc: 'Send message to peer',
    usage: 'nzcore send <peerId> <json>',
    details: 'Sends a JSON payload to a peer via the distributed router.',
    examples: ['nzcore send alice \'{"type":"ping"}\''],
    handler: async (args) => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        printError('IPC client unavailable');
        return;
      }

      const peerId = args[0];
      const json = args.slice(1).join(' ');

      if (!peerId || !json) {
        printError('Usage: nzcore send <peerId> <json>');
        return;
      }

      try {
        const raw = await mod.sendIpcCommand(`router:send ${peerId} ${json}`);
        const data = JSON.parse(raw);
        
        if (data.ok) {
          printSuccess(`Message sent to "${peerId}"`);
        } else {
          printError(data.error || 'Failed to send message');
        }
      } catch (err) {
        printError('Failed to send message');
        printError(err.message);
      }
    }
  },

  ping: {
    desc: 'Ping a peer',
    usage: 'nzcore ping <peerId>',
    details: 'Sends a ping message to a peer.',
    examples: ['nzcore ping alice'],
    handler: async (args) => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        printError('IPC client unavailable');
        return;
      }

      const peerId = args[0];

      if (!peerId) {
        printError('Usage: nzcore ping <peerId>');
        return;
      }

      const stopSpinner = showSpinner(`Pinging ${peerId}`);
      
      try {
        const raw = await mod.sendIpcCommand(`router:ping ${peerId}`);
        stopSpinner();
        const data = JSON.parse(raw);
        
        if (data.ok) {
          printSuccess(`Ping sent to "${peerId}"`);
        } else {
          printError(data.error || 'Ping failed');
        }
      } catch (err) {
        stopSpinner();
        printError('Ping failed');
        printError(err.message);
      }
    }
  },

  // ---------------------------------------------------------------------------
  // HELP & VERSION
  // ---------------------------------------------------------------------------

  help: {
    desc: 'Show help',
    usage: 'nzcore help [command]',
    details: 'Shows general help or detailed info for a specific command.',
    examples: ['nzcore help', 'nzcore help trust'],
    handler: async (args) => {
      const target = args[0];
      
      if (target && commands[target]) {
        printCommandHelp(target, commands[target]);
      } else {
        printMainHelp(commands);
      }
    }
  },

  version: {
    desc: 'Show version',
    usage: 'nzcore version',
    details: 'Prints core version, environment and Node.js version.',
    examples: ['nzcore version'],
    handler: async () => {
      printHeader('NewZoneCore Version');
      printKeyValue('Core', '0.1.0-dev', 2);
      printKeyValue('Node.js', process.version, 2);
      printKeyValue('Platform', process.platform, 2);
      printKeyValue('Architecture', process.arch, 2);
      console.log();
    }
  },

  // ---------------------------------------------------------------------------
  // COMPLETION
  // ---------------------------------------------------------------------------

  completion: {
    desc: 'Generate bash completion',
    usage: 'nzcore completion',
    details: 'Creates completion script and installs it into Termux.',
    examples: ['nzcore completion'],
    handler: async () => {
      const mod = await lazy('./complete.js');
      if (mod?.generateCompletion) {
        await mod.generateCompletion();
        printSuccess('Completion script generated');
      } else {
        printError('Completion module unavailable');
      }
    }
  }
};
