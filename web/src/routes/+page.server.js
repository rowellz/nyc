import { getWorld } from '$lib/server/runtime.js';

/**
 * The pages share a process with the simulation, so the overview is rendered
 * from the live world directly — no HTTP hop, no second WebSocket.
 */
export function load() {
  const world = getWorld();
  return { status: world ? world.status() : null };
}
