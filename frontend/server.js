/**
 * Production entry for the SvelteKit frontend.
 *
 * SvelteKit owns the site routes; everything under /world belongs to the game
 * service and is proxied there — static client, tiles, textures, the JSON APIs,
 * and the WebSocket upgrade at /world/ws.
 *
 * Proxying rather than duplicating matters: the client computes its socket URL as
 * `${location.host}/world/ws` (src/client/src/core/net.ts) and loads its chunks
 * from absolute /world/assets/* paths baked in at build time. Serving both halves
 * from one origin is what lets the game mount inside a Svelte route unmodified.
 */
import http from 'node:http';
import httpProxy from 'http-proxy';
import { handler } from './build/handler.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const GAME_ORIGIN = process.env.GAME_ORIGIN || 'http://127.0.0.1:8080';
const BASE_PATH = process.env.GAME_BASE_PATH || '/world';

const proxy = httpProxy.createProxyServer({
  target: GAME_ORIGIN,
  ws: true,
  xfwd: true,
  changeOrigin: true,
  // Tiles and textures are large; give slow cold starts room.
  proxyTimeout: 60_000,
  timeout: 60_000,
});

proxy.on('error', (err, req, res) => {
  const where = req && req.url ? ` ${req.method ?? ''} ${req.url}` : '';
  console.error(`[proxy]${where} -> ${err?.code ?? 'ERR'}: ${err?.message ?? err}`);
  if (res && typeof res.writeHead === 'function') {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('game service unavailable');
    } else {
      res.end();
    }
  } else if (res && typeof res.destroy === 'function') {
    res.destroy(); // WebSocket upgrades hand back a raw socket
  }
});

const isGamePath = (url = '') => url === BASE_PATH || url.startsWith(`${BASE_PATH}/`);

const server = http.createServer((req, res) => {
  if (isGamePath(req.url)) {
    proxy.web(req, res);
    return;
  }
  handler(req, res);
});

server.on('upgrade', (req, socket, head) => {
  if (isGamePath(req.url)) {
    proxy.ws(req, socket, head);
    return;
  }
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`[frontend] SvelteKit listening on http://localhost:${PORT}`);
  console.log(`[frontend] proxying ${BASE_PATH}/* (http + ws) -> ${GAME_ORIGIN}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
