/** SvelteKit-only hooks into the recovered client. Fail loudly if upstream
 * chunks change rather than silently serving mismatched geometry/physics. */
export function tunnelAssetTransform(rel, source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Tunnel override anchor changed in ${rel}: ${before}`);
    source = source.replace(before, after);
  };
  if (rel === 'world/assets/tile.worker-Ai2ZdmRL.js') {
    source = "import { finishTunnelApproaches as $tunnelFinish } from './tunnels.js';\n" + source;
    replace('Rr(p,c,d,s),Hr(p,d,s),f.rasterize(c.pos,c.idx.slice(_),c.aA,1/0);',
      'Rr(p,c,d,s),$tunnelFinish(c,d,s,m,$profiles),Hr(p,d,s),f.rasterize(c.pos,c.idx,c.aA,1/0);');
    replace('-Sr)),{meshes:[pi(c.build())', '-Sr)),$tunnelCut(u,$profiles),{meshes:[pi(c.build())');
  } else if (rel === 'world/assets/ramps.js') {
    source = "import { approachProfile } from './tunnels.js';\n" + source;
    replace('return profiles.get(road.id) ?? baseProfile(env, road);',
      'return approachProfile(env, road, profiles.get(road.id) ?? baseProfile(env, road));');
  } else if (rel === 'world/assets/foundations.js') {
    // The highest roof is now below ground, so buildings stay on their lots.
    replace('0.025 + TUNNEL_CLEARANCE + 0.4', '0');
  } else if (rel === 'world/assets/environment-WQwLg8tn.js') {
    replace('x.has(t)?-3.6:-.25', 'x.has(t)?-100:-.25');
    // Water cuts use map coordinates. Keep their plane fixed, with enough
    // coverage for the entire city and its distant water horizon.
    replace('new l(26e3,26e3,1,1)', 'new l(52e3,52e3,1,1)');
    replace('x.position.x=e.position.x,x.position.z=e.position.z,x.updateMatrixWorld(),N=r',
      'x.position.x=0,x.position.z=0,x.updateMatrixWorld(),N=r');
  }
  return source;
}

export const tunnelAssetPaths = new Set([
  'world/assets/tile.worker-Ai2ZdmRL.js', 'world/assets/ramps.js',
  'world/assets/foundations.js', 'world/assets/environment-WQwLg8tn.js',
]);
