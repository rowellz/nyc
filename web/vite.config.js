import { sveltekit } from '@sveltejs/kit/vite';

import { BASE_PATH, bootWorld, rewriteBasePath } from './src/lib/server/boot.js';

/**
 * `vite dev` and `vite preview` get the same world and the same game socket that
 * server.js gives production, so the recovered client is fully playable against
 * the dev server. The socket is attached with `noServer: true` (see net.js), so
 * Vite's HMR upgrade is left alone.
 */
function worldServer() {
  /** @param {{ httpServer: import('node:http').Server | null, middlewares: any }} server */
  const attach = (server) => {
    server.middlewares.use((req, _res, next) => { rewriteBasePath(req); next(); });
    bootWorld(server.httpServer);
    console.log(`[world] simulation live, game socket at ${BASE_PATH}/ws`);
  };
  return {
    name: 'nyc-world-server',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}

export default {
  plugins: [sveltekit(), worldServer()],
};
