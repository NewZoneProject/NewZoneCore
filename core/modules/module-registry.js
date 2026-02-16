// Module: Module Registry Service
// Description: Local service that initializes the module registry and exposes
//              it to other services via supervisor.
// File: core/services/module-registry.js

import { createService } from './lifecycle.js';
import { createModuleRegistry } from '../modules/registry.js';

export function createLocalService({ supervisor }) {
  return createService({
    name: 'module-registry',
    meta: { version: '1.0.0', description: 'Core module registry service' },
    supervisor,

    async onInit(ctx) {
      ctx.registry = createModuleRegistry({ supervisor });
      ctx.emit('module-registry:init');
      console.log('[module-registry] initialized');
    },

    async onStart(ctx) {
      // Expose registry to supervisor for global access
      supervisor.modules = ctx.registry;

      ctx.emit('module-registry:start');
      console.log('[module-registry] ready');
    },

    async onStop(ctx) {
      ctx.emit('module-registry:stop');
      console.log('[module-registry] stopped');
    }
  });
}

