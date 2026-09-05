/**
 * WebSocket transport for the world.
 *
 * SvelteKit's request handler only speaks HTTP, so the game socket is attached
 * to the Node http server underneath it: server.js in production, Vite's dev
 * server in development. `noServer: true` matters — a WebSocketServer built with
 * `{ server, path }` aborts every upgrade that does not match its path, which
 * would kill Vite's own HMR socket. Handling `upgrade` ourselves leaves other
 * listeners alone.
 */
import { WebSocketServer } from 'ws';

/**
 * @param {import('node:http').Server} httpServer
 * @param {{ world: ReturnType<import('./world.js').createWorld>, basePath?: string }} options
 */
export function attachWorldSocket(httpServer, { world, basePath = '/world' }) {
  const wsPath = `${basePath}/ws`;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  wss.on('connection', (ws) => world.addConnection(ws));

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`).pathname;
    } catch {
      return;
    }
    // Not ours (Vite HMR, anything else): leave the socket for another listener.
    if (pathname !== wsPath) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return wss;
}
