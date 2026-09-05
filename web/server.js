/**
 * Production entry: SvelteKit's adapter-node handler, plus the game socket.
 *
 * SvelteKit answers every HTTP route — the mirrored client and tiles under
 * /world/*, the REST endpoints under /world/api/*, and the pages — while the
 * WebSocket upgrade needs the raw http server, which is the one thing the
 * adapter's own entry point will not give us. So we own the server and mount
 * the handler on it.
 */
import http from 'node:http';

import { handler } from './build/handler.js';
import { BASE_PATH, bootWorld, rewriteBasePath } from './src/lib/server/boot.js';
import { PUBLIC_DIR } from './src/lib/server/static.js';
import { GAME_VERSION, PROTOCOL_VERSION } from './src/lib/shared/protocol.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer((req, res) => {
  rewriteBasePath(req);
  handler(req, res);
});

const world = bootWorld(server);

server.listen(PORT, HOST, () => {
  console.log(`[server] New York listening on http://localhost:${PORT}/`);
  console.log(`[server] game at ${BASE_PATH}/  static=${PUBLIC_DIR}  ws=${BASE_PATH}/ws`);
  console.log(`[server] protocol=v${PROTOCOL_VERSION} game=v${GAME_VERSION} admin=${world.admin}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    world.stop();
    server.close(() => process.exit(0));
    // Open WebSockets keep the server alive; do not wait forever for them.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
