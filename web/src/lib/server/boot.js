/**
 * Brings the world up and wires it to whichever Node http server is hosting
 * SvelteKit: server.js in production, Vite's own server in development. Both
 * entries go through here so there is one place that reads the environment.
 */
import { attachWorldSocket } from './net.js';
import { getWorld, setWorld } from './runtime.js';
import { createWorld } from './world.js';

/**
 * The client is built with BASE_URL=/world/, so BASE_PATH normally stays
 * /world. It is still configurable, and rewriteBasePath() maps a different
 * prefix onto the /world routes on the way in.
 */
export const BASE_PATH = normalize(process.env.BASE_PATH || '/world');

function normalize(base) {
  let b = base.trim();
  if (!b.startsWith('/')) b = `/${b}`;
  while (b.endsWith('/') && b.length > 1) b = b.slice(0, -1);
  return b;
}

/**
 * @param {import('node:http').Server | null} httpServer
 * @returns the running world
 */
export function bootWorld(httpServer) {
  const world = getWorld() ?? setWorld(createWorld({
    admin: process.env.ADMIN === '1',
    verbose: process.env.VERBOSE === '1',
  }));
  world.start();
  if (httpServer) attachWorldSocket(httpServer, { world, basePath: BASE_PATH });
  return world;
}

/**
 * Map `${BASE_PATH}/...` onto the `/world/...` routes. A no-op in the default
 * configuration, which is why it runs before SvelteKit sees the request rather
 * than as a reroute hook (the prefix is server-side configuration and must not
 * leak into the client bundle).
 * @param {{ url?: string }} req
 */
export function rewriteBasePath(req) {
  if (BASE_PATH === '/world' || !req.url) return;
  const cut = req.url.search(/[?#]/);
  const pathname = cut === -1 ? req.url : req.url.slice(0, cut);
  const rest = cut === -1 ? '' : req.url.slice(cut);
  if (pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`)) {
    req.url = `/world${pathname.slice(BASE_PATH.length)}${rest}`;
  }
}
