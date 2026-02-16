// Module: Router Service
// Description: Initializes the distributed router and registers it
//              as a module in the module registry.
// File: core/services/router.js

import { createService } from './lifecycle.js';
import { createRouter } from '../modules/router.js';

export function createLocalService({ supervisor }) {
  return createService({
    name: 'router',
    meta: { version: '1.0.0', description: 'Distributed message router' },
    supervisor,

    async onInit(ctx) {
      ctx.router = createRouter({ supervisor });
      ctx.emit('router:init');
      console.log('[router] initialized');
    },

    async onStart(ctx) {
      if (!supervisor.modules) {
        console.log('[router] module registry not ready');
        return;
      }

      supervisor.modules.registerModule('router', ctx.router);

      ctx.emit('router:start');
      console.log('[router] ready');
    },

    async onStop(ctx) {
      ctx.emit('router:stop');
      console.log('[router] stopped');
    }
  });
}

