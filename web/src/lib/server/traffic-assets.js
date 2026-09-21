/** Apply traffic changes only to the SvelteKit client; retain the shared mirror. */
export const trafficAssetPaths = new Set(['world/assets/vehicles-_zJz3z3J.js']);

export function trafficAssetTransform(rel, source) {
  if (!trafficAssetPaths.has(rel)) return source;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Traffic override anchor changed in ${rel}: ${before}`);
    source = source.replace(before, after);
  };
  source = "import { spawnTraffic as $spawnTraffic, trafficRadius as $trafficRadius, vehicleDrawDistance as $vehicleDrawDistance } from './traffic-distribution.js';\n" + source;
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
  replace('e()?64:200,e()?0:Et', 'e()?128:320,e()?800:Et');
  replace('r.write(e.kind,u,n||l<d*d?0:140)', 'r.write(e.kind,u,l<d*d?0:140)');
  replace('Math.min(520,t.quality.drawDistance)**2', '$vehicleDrawDistance(t)**2');
  // Keep distant parked cars in the inexpensive fleet; physics remains local.
  replace('function se(){', 'let $parkingRange=-1;function se(){');
  replace('n&&$(r,t.camera.position)>6400||m.has(r.key)', 'm.has(r.key)');
  replace('oe(e)&&!_.has(e.key)&&(!n||$(e,t.camera.position)<=6400)', 'oe(e)&&!_.has(e.key)');
  replace('$(e,C)<580**2&&x.push(e)', '$(e,C)<(t.quality.level===`mobile`?$parkingRange+60:580)**2&&x.push(e)');
  replace('I=!1}function ce(', 't.quality.level===`mobile`&&x.sort((a,b)=>$(a,C)-$(b,C));I=!1}function ce(');
  replace('for(let e of x)!_.has(e.key)&&(!n||$(e,t.camera.position)<=6400)&&he(e,0,0)',
    'for(let e of x)!_.has(e.key)&&he(e,0,0)');
  // Rebuild the parked draw list immediately when the user changes range.
  replace('I||$(C,t.camera.position)>2500', 'I||$parkingRange!==$vehicleDrawDistance(t)||$(C,t.camera.position)>2500');
  return source;
}
