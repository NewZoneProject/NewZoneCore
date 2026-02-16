// Module: Example Local Service
// Description: Minimal demonstration service for NewZoneCore lifecycle.
// File: core/services/example.js

import { createService } from './lifecycle.js';

export function createLocalService({ supervisor }) {
  return createService({
    name: 'example',
    meta: { version: '1.0.0', description: 'Example heartbeat service' },
    supervisor,

    // Called once on startup
    async onInit(ctx) {
      ctx.emit('example:init');
      console.log('[example] initialized');
    },

    // Called when service starts running
    async onStart(ctx) {
      ctx.emit('example:start');
      console.log('[example] running');

      // Heartbeat every 5 seconds
      ctx.timer = setInterval(() => {
        ctx.emit('example:heartbeat', { ts: Date.now() });
        console.log('[example] heartbeat');
      }, 5000);
    },

    // Called when service stops
    async onStop(ctx) {
      if (ctx.timer) clearInterval(ctx.timer);
      ctx.emit('example:stop');
      console.log('[example] stopped');
    }
  });
}

