/**
 * POST /world/api/telemetry — the client's boot/crash beacons.
 *
 * telemetry.ts posts these with `keepalive`, ignores the body and only checks
 * `r.ok`, so the answer is an empty 204. With VERBOSE=1 the stage is logged,
 * which is the quickest way to see how far a browser got before it died.
 */
import { getWorld } from '$lib/server/runtime.js';

export async function POST({ request }) {
  const world = getWorld();
  const verbose = world ? world.verbose : process.env.VERBOSE === '1';
  if (verbose) {
    try {
      const body = (await request.text()).slice(0, 8192);
      if (body) {
        const b = JSON.parse(body);
        console.log(`[telemetry] ${b.stage}${b.detail ? ` - ${b.detail}` : ''}`);
      }
    } catch { /* ignore malformed beacons */ }
  }
  return new Response(null, { status: 204 });
}
