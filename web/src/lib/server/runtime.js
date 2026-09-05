/**
 * The world is a live, stateful singleton, but this module is loaded twice at
 * runtime: once by server.js (which owns the process and the WebSocket upgrade)
 * and once inside the SvelteKit server bundle (which serves the API routes and
 * the pages). A `Symbol.for` key is the same in both copies, so both see the one
 * world rather than two half-populated ones.
 */
const KEY = Symbol.for('nyc.world.runtime');

/** @param {any} world */
export function setWorld(world) {
  globalThis[KEY] = world;
  return world;
}

/** The running world, or null when SvelteKit is being built or prerendered. */
export function getWorld() {
  return globalThis[KEY] ?? null;
}
