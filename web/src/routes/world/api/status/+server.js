/**
 * GET /world/api/status — a JSON view of the live world.
 *
 * Not part of the client's wire protocol: this is what the SvelteKit pages poll,
 * and it exists because the pages share a process with the simulation and can
 * read it directly instead of opening a second WebSocket.
 */
import { json } from '@sveltejs/kit';

import { getWorld } from '$lib/server/runtime.js';

export function GET() {
  const world = getWorld();
  if (!world) return json({ running: false }, { status: 503, headers: { 'cache-control': 'no-store' } });
  return json({ running: true, ...world.status() }, { headers: { 'cache-control': 'no-store' } });
}
