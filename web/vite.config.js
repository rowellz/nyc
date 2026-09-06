import path from 'node:path';

import { sveltekit } from '@sveltejs/kit/vite';

import { BASE_PATH, bootWorld, rewriteBasePath } from './src/lib/server/boot.js';
import { PUBLIC_DIR } from './src/lib/server/static.js';

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

/**
 * Live reload for the mirrored client.
 *
 * public/ is outside the Vite project and is served as bytes by the /world route,
 * not through the module graph, so Vite neither watches it nor knows how to patch
 * it — and the client is one big compiled bundle regardless, with no HMR
 * boundaries to swap a module across. What it can do is notice the file changed
 * and reload the page, which for a worker rebuilding its tiles from scratch is
 * the same thing. Pair it with the no-store headers in static.js, or the browser
 * hands the old bundle straight back.
 *
 * Only the client is watched, not the 3,697 world tiles beside it: they are the
 * bulk of the tree, they do not change while developing, and chokidar would sit
 * on all of them.
 */
function worldReload() {
  const watch = ['world/index.html', 'world/safe.html', 'world/assets']
    .map((rel) => path.join(PUBLIC_DIR, rel));
  const owns = (file) => watch.some((w) => file === w || file.startsWith(w + path.sep));
  return {
    name: 'nyc-world-reload',
    apply: 'serve',
    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
      server.watcher.add(watch);
      // one save is often several events (write, rename, chmod); coalesce them
      // so the page reloads once rather than three times
      let pending = null;
      const reload = (/** @type {string} */ file) => {
        if (!owns(file)) return;
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          pending = null;
          server.config.logger.info(`[world] ${path.relative(PUBLIC_DIR, file)} changed — reloading`);
          server.ws.send({ type: 'full-reload', path: '*' });
        }, 80);
      };
      server.watcher.on('change', reload);
      server.watcher.on('add', reload);
    },
  };
}

export default {
  plugins: [sveltekit(), worldServer(), worldReload()],
  server: {
    // Bind mounts (the web-dev container) do not always deliver inotify events.
    watch: { usePolling: process.env.VITE_POLL === '1', interval: 400 },
  },
};
