// Module: HTTP API Server
// Description: Minimal HTTP API for NewZoneCore daemon.
// File: core/api/http.js

import http from 'http';

export async function startHttpApi({ supervisor }) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    // --- /health -----------------------------------------------------------
    if (req.url === '/health') {
      res.writeHead(200);
      return res.end(JSON.stringify({ status: 'ok', core: 'NewZoneCore' }));
    }

    // --- /state ------------------------------------------------------------
    if (req.url === '/state') {
      let raw = {};

      try {
        raw = await supervisor.getState();
      } catch {
        raw = { error: 'state_unavailable' };
      }

      // sanitize private fields
      const state = {
        startedAt: raw.startedAt,
        node_id: raw.identity?.public || null,
        ecdh_public: raw.ecdh?.public || null,
        trust: raw.trust || {},
        services: raw.services || []
      };

      res.writeHead(200);
      return res.end(JSON.stringify(state));
    }

    // --- fallback ----------------------------------------------------------
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  const port = 3000;

  server.listen(port, '0.0.0.0', () => {
    console.log(`[api:http] listening on http://0.0.0.0:${port}`);
  });

  return server;
}