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
    details: 'Queries the running daemon via IPC (planned).',
    handler: async () => {
      console.log('[nzcore] requesting state…');
      // IPC client will be added later
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
  }
};