// Module: Secure Channel Service
// Description: Initializes the secure channel manager and registers it
//              as a module in the module registry.
// File: core/services/secure-channel.js

import { createService } from './lifecycle.js';
import { createSecureChannelManager } from '../modules/secure-channel.js';

export function createLocalService({ supervisor }) {
  return createService({
    name: 'secure-channel',
    meta: { version: '1.0.0', description: 'Secure channel manager' },
    supervisor,

    async onInit(ctx) {
      ctx.manager = createSecureChannelManager({ supervisor });
      ctx.emit('secure-channel:init');
      console.log('[secure-channel] initialized');
    },

    async onStart(ctx) {
      if (!supervisor.modules) {
        console.log('[secure-channel] module registry not ready');
        return;
      }

      supervisor.modules.registerModule('secure-channel', ctx.manager);

      ctx.emit('secure-channel:start');
      console.log('[secure-channel] ready');
    },

    async onStop(ctx) {
      ctx.emit('secure-channel:stop');
      console.log('[secure-channel] stopped');
    }
  });
}

