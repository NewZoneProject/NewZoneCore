// Module: Protocol Service
// Description: High-level protocol layer for NewZoneCore. Handles envelope
//              validation, message dispatching and protocol events.
// File: core/services/protocol.js

import { createService } from './lifecycle.js';
import { createEnvelopeModule } from '../modules/envelope.js';

export function createLocalService({ supervisor }) {
  return createService({
    name: 'protocol',
    meta: { version: '1.1.0', description: 'Protocol layer with message types' },
    supervisor,

    async onInit(ctx) {
      ctx.envelope = await createEnvelopeModule();

      // Outgoing API
      ctx.send = async (peerId, type, body) => {
        const router = supervisor.modules.getModule('router');
        if (!router) throw new Error('router module not available');

        return router.send(peerId, {
          type,
          body
        });
      };

      ctx.emit('protocol:init');
      console.log('[protocol] initialized');
    },

    async onStart(ctx) {
      if (!supervisor.modules) {
        console.log('[protocol] module registry not ready');
        return;
      }

      // Register envelope module
      supervisor.modules.registerModule('envelope', ctx.envelope);

      // Subscribe to router messages
      supervisor.subscribe('router:message', async (msg) => {
        const { from, type, body } = msg;

        // Dispatch by type
        switch (type) {
          case 'ping':
            await handlePing(ctx, from, body);
            break;

          case 'pong':
            await handlePong(ctx, from, body);
            break;

          case 'hello':
            await handleHello(ctx, from, body);
            break;

          case 'welcome':
            await handleWelcome(ctx, from, body);
            break;

          case 'announce':
            await handleAnnounce(ctx, from, body);
            break;

          case 'gossip':
            await handleGossip(ctx, from, body);
            break;

          case 'request':
            await handleRequest(ctx, from, body);
            break;

          case 'response':
            await handleResponse(ctx, from, body);
            break;

          default:
            supervisor.emit('protocol:unknown', { from, type, body });
            console.log(`[protocol] unknown message type: ${type}`);
        }
      });

      ctx.emit('protocol:start');
      console.log('[protocol] ready');
    },

    async onStop(ctx) {
      ctx.emit('protocol:stop');
      console.log('[protocol] stopped');
    }
  });
}

// ---------------------------------------------------------------------------
// Message Handlers
// ---------------------------------------------------------------------------

async function handlePing(ctx, from, body) {
  console.log(`[protocol] ping from ${from}`);

  await ctx.send(from, 'pong', {
    ts: Date.now()
  });

  ctx.supervisor.emit('protocol:ping', { from, body });
}

async function handlePong(ctx, from, body) {
  console.log(`[protocol] pong from ${from}`);
  ctx.supervisor.emit('protocol:pong', { from, body });
}

async function handleHello(ctx, from, body) {
  console.log(`[protocol] hello from ${from}`);

  await ctx.send(from, 'welcome', {
    node: ctx.supervisor.getNodeId(),
    services: ctx.supervisor.getServices(),
    ts: Date.now()
  });

  ctx.supervisor.emit('protocol:hello', { from, body });
}

async function handleWelcome(ctx, from, body) {
  console.log(`[protocol] welcome from ${from}`);
  ctx.supervisor.emit('protocol:welcome', { from, body });
}

async function handleAnnounce(ctx, from, body) {
  console.log(`[protocol] announce from ${from}`);
  ctx.supervisor.emit('protocol:announce', { from, body });
}

async function handleGossip(ctx, from, body) {
  console.log(`[protocol] gossip from ${from}`);
  ctx.supervisor.emit('protocol:gossip', { from, body });
}

async function handleRequest(ctx, from, body) {
  console.log(`[protocol] request from ${from}`);

  // Body: { id, method, params }
  const { id, method, params } = body;

  ctx.supervisor.emit('protocol:request', { from, id, method, params });

  // Placeholder: echo response
  await ctx.send(from, 'response', {
    id,
    result: { ok: true }
  });
}

async function handleResponse(ctx, from, body) {
  console.log(`[protocol] response from ${from}`);
  ctx.supervisor.emit('protocol:response', { from, body });
}

