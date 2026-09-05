import { getWorld } from '$lib/server/runtime.js';

export function load() {
  const world = getWorld();
  return { status: world ? world.status() : null };
}
