// Module: CLI Command Registry
// Description: Centralized registry of all nzcore CLI commands.
// File: core/cli/registry.js

// Lazy import helper — avoids loading heavy modules until needed
async function lazy(path) {
  try {
    return await import(path);
  } catch {
    return null;
  }
}

export const commands = {
  start: {
    desc: 'start the core daemon',
    usage: 'nzcore start',
    details: 'Bootstraps NewZoneCore and launches the daemon.',
    handler: async () => {
      const mod = await lazy('../../core.js');
      if (mod?.startCore) {
        await mod.startCore();
      } else {
        console.log('[nzcore] startCore() unavailable.');
      }
    }
  },

  state: {
    desc: 'request current daemon state',
    usage: 'nzcore state',
    details: 'Queries the running daemon via IPC.',
    handler: async () => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.requestState) {
        console.log('[nzcore] IPC client unavailable.');
        return;
      }

      try {
        const state = await mod.requestState();
        console.log(JSON.stringify(state, null, 2));
      } catch (err) {
        console.log('[nzcore] IPC request failed.');
        console.log(err.message);
      }
    }
  },

  doctor: {
    desc: 'run environment diagnostics',
    usage: 'nzcore doctor',
    details: 'Checks env/, global module, binary and IPC socket.',
    handler: async () => {
      const mod = await lazy('./doctor.js');
      if (mod?.runDoctor) {
        await mod.runDoctor();
      } else {
        console.log('[nzcore] doctor unavailable.');
      }
    }
  },

  reset: {
    desc: 'remove env/ and recreate structure',
    usage: 'nzcore reset',
    details: 'Deletes env/ and recreates a clean environment.',
    handler: async () => {
      const mod = await lazy('../startup/recovery.js');
      if (mod?.resetEnvironment) {
        await mod.resetEnvironment();
      } else {
        console.log('[nzcore] reset unavailable.');
      }
    }
  },

  recover: {
    desc: 'restore env/ from seed phrase',
    usage: 'nzcore recover',
    details: 'Performs full recovery of env/ using a seed phrase.',
    handler: async () => {
      const mod = await lazy('../startup/recovery.js');
      if (mod?.fullRecovery) {
        await mod.fullRecovery();
      } else {
        console.log('[nzcore] recovery unavailable.');
      }
    }
  },

  completion: {
    desc: 'generate and install bash completion',
    usage: 'nzcore completion',
    details: 'Creates completion script and installs it into Termux.',
    handler: async () => {
      const mod = await lazy('./complete.js');
      if (mod?.generateCompletion) {
        await mod.generateCompletion();
      } else {
        console.log('[nzcore] completion unavailable.');
      }
    }
  },

  help: {
    desc: 'show help message',
    usage: 'nzcore help [command]',
    details: 'Shows general help or detailed info for a specific command.',
    handler: async () => {}
  },

  version: {
    desc: 'show nzcore version information',
    usage: 'nzcore version',
    details: 'Prints core version, environment and Node.js version.',
    handler: async () => {
      console.log('NewZoneCore');
      console.log('Version: 0.1.0-dev');
      console.log(`Node: ${process.version}`);
      console.log(`Platform: ${process.platform}`);
    }
  },

  trust: {
    desc: 'manage trust store',
    usage: 'nzcore trust <list|add|remove> [...]',
    details: 'Trust management via IPC.',
    handler: async (args) => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        console.log('[nzcore] IPC client unavailable.');
        return;
      }

      const sub = args[0];

      // nzcore trust list
      if (sub === 'list') {
        try {
          const raw = await mod.sendIpcCommand('trust:list');
          const data = JSON.parse(raw);
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          console.log('[nzcore] trust:list failed');
          console.log(err.message);
        }
        return;
      }

      // nzcore trust add <id> <pubkey>
      if (sub === 'add') {
        const id = args[1];
        const pubkey = args[2];

        if (!id || !pubkey) {
          console.log('Usage: nzcore trust add <id> <pubkey>');
          return;
        }

        try {
          const raw = await mod.sendIpcCommand(`trust:add ${id} ${pubkey}`);
          const data = JSON.parse(raw);
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          console.log('[nzcore] trust:add failed');
          console.log(err.message);
        }
        return;
      }

      // nzcore trust remove <id>
      if (sub === 'remove') {
        const id = args[1];

        if (!id) {
          console.log('Usage: nzcore trust remove <id>');
          return;
        }

        try {
          const raw = await mod.sendIpcCommand(`trust:remove ${id}`);
          const data = JSON.parse(raw);
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          console.log('[nzcore] trust:remove failed');
          console.log(err.message);
        }
        return;
      }

      // fallback
      console.log('Usage: nzcore trust <list|add|remove>');
    }
  },

  identity: {
    desc: 'show node identity information',
    usage: 'nzcore identity',
    details: 'Displays Ed25519 and X25519 public keys via IPC.',
    handler: async () => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        console.log('[nzcore] IPC client unavailable.');
        return;
      }

      try {
        const raw = await mod.sendIpcCommand('identity');
        const data = JSON.parse(raw);
        console.log(JSON.stringify(data, null, 2));
      } catch (err) {
        console.log('[nzcore] identity request failed');
        console.log(err.message);
      }
    }
  },

  services: {
    desc: 'list registered services',
    usage: 'nzcore services',
    details: 'Displays all services registered in the supervisor.',
    handler: async () => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        console.log('[nzcore] IPC client unavailable.');
        return;
      }

      try {
        const raw = await mod.sendIpcCommand('services');
        const data = JSON.parse(raw);
        console.log(JSON.stringify(data, null, 2));
      } catch (err) {
        console.log('[nzcore] services request failed');
        console.log(err.message);
      }
    }
  },

  // -------------------------------------------------------------------------
  // ROUTER COMMANDS (Phase 2.0)
  // -------------------------------------------------------------------------

  routes: {
    desc: 'list routing table',
    usage: 'nzcore routes',
    details: 'Shows all known routes in the distributed router.',
    handler: async () => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        console.log('[nzcore] IPC client unavailable.');
        return;
      }

      try {
        const raw = await mod.sendIpcCommand('router:routes');
        const data = JSON.parse(raw);
        console.log(JSON.stringify(data, null, 2));
      } catch (err) {
        console.log('[nzcore] routes request failed');
        console.log(err.message);
      }
    }
  },

  route: {
    desc: 'manage routing table',
    usage: 'nzcore route <add|remove> [...]',
    details: 'Add or remove routes in the distributed router.',
    handler: async (args) => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        console.log('[nzcore] IPC client unavailable.');
        return;
      }

      const sub = args[0];

      // nzcore route add <peerId> <pubkey>
      if (sub === 'add') {
        const peerId = args[1];
        const pubkey = args[2];

        if (!peerId || !pubkey) {
          console.log('Usage: nzcore route add <peerId> <pubkey>');
          return;
        }

        try {
          const raw = await mod.sendIpcCommand(`router:add ${peerId} ${pubkey}`);
          const data = JSON.parse(raw);
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          console.log('[nzcore] route:add failed');
          console.log(err.message);
        }
        return;
      }

      // nzcore route remove <peerId>
      if (sub === 'remove') {
        const peerId = args[1];

        if (!peerId) {
          console.log('Usage: nzcore route remove <peerId>');
          return;
        }

        try {
          const raw = await mod.sendIpcCommand(`router:remove ${peerId}`);
          const data = JSON.parse(raw);
          console.log(JSON.stringify(data, null, 2));
        } catch (err) {
          console.log('[nzcore] route:remove failed');
          console.log(err.message);
        }
        return;
      }

      console.log('Usage: nzcore route <add|remove>');
    }
  },

  send: {
    desc: 'send message to peer',
    usage: 'nzcore send <peerId> <json>',
    details: 'Sends a JSON payload to a peer via the distributed router.',
    handler: async (args) => {
      const mod = await lazy('./ipc-client.js');
      if (!mod?.sendIpcCommand) {
        console.log('[nzcore] IPC client unavailable.');
        return;
      }

      const peerId = args[0];
      const json = args.slice(1).join(' ');

      if (!peerId || !json) {
        console.log('Usage: nzcore send <peerId> <json>');
        return;
      }

      try {
        const raw = await mod.sendIpcCommand(`router:send ${peerId} ${json}`);
        const data = JSON.parse(raw);
        console.log(JSON.stringify(data, null, 2));
      } catch (err) {
        console.log('[nzcore] send failed');
        console.log(err.message);
      }
    }
  }

};

