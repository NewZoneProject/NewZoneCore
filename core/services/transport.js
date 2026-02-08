// Module: Transport Service
// Description: Binds network transport to the distributed router.
// File: core/services/transport.js

import { createService } from './lifecycle.js';
import { createTransport } from '../modules/transport.js';

export function createLocalService({ supervisor }) {
  return createService({
    name: 'transport',
    meta: { version: '1.0.0', description: 'TCP transport service' },
    supervisor,

    async onInit(ctx) {
      ctx.transport = createTransport({ supervisor, port: 9030 });
      ctx.emit('transport:init');
      console.log('[transport] initialized');
    },

    async onStart(ctx) {
      if (!supervisor.modules) {
        console.log('[transport] module registry not ready');
        return;
      }

      // Register module
      supervisor.modules.registerModule('transport', ctx.transport);

      // Bind incoming bytes to router.receive
      const router = supervisor.modules.getModule('router');
      if (!router) {
        console.log('[transport] router module not available');
      } else {
        ctx.transport.onMessage = async (peerId, bytes) => {
          try {
            await router.receive(peerId, bytes);
          } catch (err) {
            console.log('[transport] router.receive failed:', err.message);
          }
        };
      }

      ctx.emit('transport:start');
      console.log('[transport] ready');
    },

    async onStop(ctx) {
      if (ctx.transport) {
        ctx.transport.close();
      }
      ctx.emit('transport:stop');
      console.log('[transport] stopped');
    }
  });
}

