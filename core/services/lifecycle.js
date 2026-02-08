// Module: Service Lifecycle
// Description: Minimal service lifecycle helper for NewZoneCore.
//              Provides a common contract for local services with
//              init/start/stop/status and optional integration with
//              the supervisor event bus.
// File: core/services/lifecycle.js

/**
 * Create a managed service instance.
 *
 * @param {Object} options
 * @param {string} options.name          - Service name (unique within node).
 * @param {Object} [options.meta]        - Optional metadata.
 * @param {Object} [options.supervisor]  - Optional supervisor instance.
 * @param {Function} [options.onInit]    - async (ctx) => void
 * @param {Function} [options.onStart]   - async (ctx) => void
 * @param {Function} [options.onStop]    - async (ctx) => void
 *
 * @returns {Object} service
 */
export function createService({
  name,
  meta = {},
  supervisor = null,
  onInit = null,
  onStart = null,
  onStop = null
}) {
  if (!name) {
    throw new Error('Service name is required');
  }

  const state = {
    name,
    meta,
    status: 'created', // created | initialized | running | stopped | error
    error: null,
    startedAt: null,
    stoppedAt: null
  };

  // Context passed to hooks
  const ctx = {
    name,
    meta,
    supervisor,
    emit: (event, payload = {}) => {
      if (supervisor?.emit) {
        supervisor.emit(event, { service: name, ...payload });
      }
    },
    subscribe: (event, handler) => {
      if (supervisor?.subscribe) {
        supervisor.subscribe(event, handler);
      }
    }
  };

  async function init() {
    if (state.status !== 'created' && state.status !== 'stopped') return;

    try {
      if (onInit) {
        await onInit(ctx);
      }
      state.status = 'initialized';
      state.error = null;

      if (supervisor?.emit) {
        supervisor.emit('service:init', { name, meta });
      }

      if (supervisor?.registerService) {
        supervisor.registerService(name, meta);
      }
    } catch (err) {
      state.status = 'error';
      state.error = err.message || String(err);
      if (supervisor?.emit) {
        supervisor.emit('service:error', { name, stage: 'init', error: state.error });
      }
      throw err;
    }
  }

  async function start() {
    if (state.status !== 'initialized' && state.status !== 'stopped') return;

    try {
      if (onStart) {
        await onStart(ctx);
      }
      state.status = 'running';
      state.error = null;
      state.startedAt = new Date().toISOString();
      state.stoppedAt = null;

      if (supervisor?.emit) {
        supervisor.emit('service:start', { name, meta });
      }
    } catch (err) {
      state.status = 'error';
      state.error = err.message || String(err);
      if (supervisor?.emit) {
        supervisor.emit('service:error', { name, stage: 'start', error: state.error });
      }
      throw err;
    }
  }

  async function stop() {
    if (state.status !== 'running' && state.status !== 'initialized') return;

    try {
      if (onStop) {
        await onStop(ctx);
      }
      state.status = 'stopped';
      state.error = null;
      state.stoppedAt = new Date().toISOString();

      if (supervisor?.emit) {
        supervisor.emit('service:stop', { name, meta });
      }
    } catch (err) {
      state.status = 'error';
      state.error = err.message || String(err);
      if (supervisor?.emit) {
        supervisor.emit('service:error', { name, stage: 'stop', error: state.error });
      }
      throw err;
    }
  }

  function status() {
    return { ...state };
  }

  return {
    name,
    meta,
    init,
    start,
    stop,
    status
  };
}

