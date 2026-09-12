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
  } else if (rel === 'world/assets/lane-layout.js') {
    source = "import { taperGore } from './lane-transitions.js';\n" + source;
    // A fan shifts the whole lane envelope sideways. Carry the outside shoulder
    // with it too; shifting only the shared edge can invert a narrow ramp's deck.
    replace('let v=sign*hw,own=sign*hw;',
      'const lateral=offset(s,0)-base(s,0);let v=sign*hw+lateral,own=v;');
    replace('pts.push({...pointAt(record,s,l.base(s,q)),d:from+d})',
      'pts.push({...pointAt(record,s,l.base(s,q)),d:from+d,laneSpan:l.count*l.width})');
    replace('const tables=(links,side,other,paints)=>{\n    let from=0;',
      'const tables=(links,side,other,paints)=>{\n    const taper=[];let from=0;');
    replace('record.gores[side].push({gaps,paints,end:link?-1:end});',
      'record.gores[side].push({gaps,paints,end:link?-1:end});taper.push({gaps,from,end,length:record.length,laneSpan:l.count*l.width});');
    replace('from+=record.length;\n    }\n  };\n  for(const [left,right] of fans)',
      'from+=record.length;\n    }\n    taperGore(taper,GORE_STEP,GORE_NEAR,Math.max(...other.map(p=>p.laneSpan)));\n  };\n  for(const [left,right] of fans)');
  } else if (rel === 'world/assets/ramps.js') {
    source = "import { approachProfile, APPROACH_REACH } from './tunnels.js';\n" + source;
    replace('Math.ceil((MAX_ROAD_HEIGHT / MAX_ROAD_GRADE + STEP * 2) / 256) * 256',
      'Math.ceil(Math.max(MAX_ROAD_HEIGHT / MAX_ROAD_GRADE + STEP * 2, APPROACH_REACH) / 256) * 256');
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
  'world/assets/tile.worker-Ai2ZdmRL.js', 'world/assets/ramps.js', 'world/assets/lane-layout.js',
  'world/assets/foundations.js', 'world/assets/environment-WQwLg8tn.js',
]);
