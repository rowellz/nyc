/** Apply traffic changes only to the SvelteKit client; retain the shared mirror. */
export const trafficAssetPaths = new Set(['world/assets/vehicles-_zJz3z3J.js']);

export function trafficAssetTransform(rel, source) {
  if (!trafficAssetPaths.has(rel)) return source;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Traffic override anchor changed in ${rel}: ${before}`);
    source = source.replace(before, after);
  };
  source = "import { spawnTraffic as $spawnTraffic, trafficRadius as $trafficRadius } from './traffic-distribution.js';\n" + source;
  const start = source.indexOf('      this.spawnClock = 0.25;');
  const end = source.indexOf('    // Spatial broad phase for queues.', start);
  if (start < 0 || end < 0) throw new Error(`Traffic spawn block changed in ${rel}`);
  replace(source.slice(start, end), `      this.spawnClock = 0.25;
      $spawnTraffic(this, obstacles, { lanePoint, hash01, KINDS, ground, trafficHeight, makeCar });
    }
`);
  replace('distance2(c, focus) > 450 ** 2', 'distance2(c, focus) > ($trafficRadius(ctx) + 70) ** 2');
  // iOS previously allocated no far instances and sent all visible cars to a
  // 64-instance detailed pool. Give it a real inexpensive distant fleet.
  replace('e()?64:200,e()?0:Et', 'e()?128:320,e()?400:Et');
  replace('r.write(e.kind,u,n||l<d*d?0:140)', 'r.write(e.kind,u,l<d*d?0:140)');
  replace('Math.min(520,t.quality.drawDistance)**2', 'Math.min(640,t.quality.drawDistance)**2');
  return source;
}
