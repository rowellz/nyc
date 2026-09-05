/** GET /world/api/admin/me — the client asks once at boot whether it may fly. */
import { json } from '@sveltejs/kit';

import { getWorld } from '$lib/server/runtime.js';

export function GET() {
  const world = getWorld();
  const admin = world ? world.admin : process.env.ADMIN === '1';
  return json({ admin }, { headers: { 'cache-control': 'no-store' } });
}
