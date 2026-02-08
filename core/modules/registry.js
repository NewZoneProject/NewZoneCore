// Module: Module Registry
// Description: Minimal module registry for NewZoneCore. Allows services and
//              internal components to register and retrieve modules by name.
// File: core/modules/registry.js

/**
 * Create a module registry instance.
 *
 * @param {Object} options
 * @param {Object} [options.supervisor] - Optional supervisor for event bus integration.
 */
export function createModuleRegistry({ supervisor = null } = {}) {
  const modules = {}; // { name: moduleObject }

  function registerModule(name, mod) {
    if (!name) throw new Error('Module name is required');
    if (!mod) throw new Error('Module object is required');

    modules[name] = mod;

    if (supervisor?.emit) {
      supervisor.emit('module:registered', { name });
    }
  }

  function getModule(name) {
    return modules[name] || null;
  }

  function listModules() {
    return Object.keys(modules);
  }

  return {
    registerModule,
    getModule,
    listModules
  };
}

