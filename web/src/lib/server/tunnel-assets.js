/** SvelteKit-only hooks into the recovered client. Fail loudly if upstream
 * chunks change rather than silently serving mismatched geometry/physics. */
export function tunnelAssetTransform(rel, source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Tunnel override anchor changed in ${rel}: ${before}`);
    source = source.replace(before, after);
  };
  if (rel === 'world/assets/tile.worker-Ai2ZdmRL.js') {
    source = "import { finishTunnelApproaches as $tunnelFinish, surfaceMarkingAllowed as $tunnelSurfaceMarking } from './tunnels.js';\n" + source;
    replace('const paving = Math.max(0, baseAt(x, z) - deckAt(x, z));',
      'if(!$tunnelSurfaceMarking(env.tile.roads,currentRoad,x,z))return;const paving = Math.max(0, baseAt(x, z) - deckAt(x, z));');
    replace('const h = hash2(seed, x + z);',
      'if(!$tunnelSurfaceMarking(env.tile.roads,currentRoad,x,z))return;const h = hash2(seed, x + z);');
    replace('Rr(p,c,d,s),Hr(p,d,s),f.rasterize(c.pos,c.idx.slice(_),c.aA,1/0);',
      'Rr(p,c,d,s),$tunnelFinish(c,d,s,m,$profiles),Hr(p,d,s),f.rasterize(c.pos,c.idx,c.aA,1/0);');
    replace('-Sr)),{meshes:[pi(c.build())', '-Sr)),$tunnelCut(u,$profiles),{meshes:[pi(c.build())');
    replace('const $profiles=$tunnelNetwork(r);',
      'const $profileRoad=r.find(r=>!r.tunnel&&dr.has(r.cls)&&r.pts.length>1);if($profileRoad)$clearanceProfile(p,$profileRoad,$baseDeckProfile);const $profiles=$tunnelNetwork(r);');
    replace('decks:s.decks,colliders:', 'decks:s.decks,approachProfiles:s.approachProfiles,colliders:');
  } else if (rel === 'world/assets/streets-CfYSUqyW.js') {
    replace('n.decks=i.decks,$tunnelTerrain(e,n.tile)',
      'n.decks=i.decks,n.tile.approachProfiles=i.approachProfiles,$tunnelTerrain(e,n.tile)');
    replace('e.events.on(`tileUnloaded`,ee)',
      'e.events.on(`tileUnloaded`,t=>{ee(t);$tunnelTerrain(e)})');
  } else if (rel === 'world/assets/lane-layout.js') {
    source = "import { taperGore } from './lane-transitions.js';\n" + source;
    // A fan shifts the whole lane envelope sideways. Carry the outside shoulder
    // with it too; shifting only the shared edge can invert a narrow ramp's deck.
    replace('let v=sign*hw,own=sign*hw;',
      'const lateral=offset(s,0)-base(s,0);let v=sign*hw+lateral,own=v;');
    replace('pts.push({...pointAt(record,s,l.base(s,q)),d:from+d})',
      'pts.push({...pointAt(record,s,l.base(s,q)),d:from+d,laneSpan:l.count*l.width})');
    replace('const tables=(links,side,other,paints)=>{\n    let from=0;',
      `const tables=(links,side,other,paints)=>{
    // Only sibling segments within GORE_NEAR can win the nearest-point test.
    // Index their bounds once instead of scanning the entire sampled sibling
    // for every lane station (quadratic on long interchange ramps).
    const cells=new Map();
    for(let i=1;i<other.length;i++){
      const a=other[i-1],b=other[i];
      for(let x=Math.floor((Math.min(a.x,b.x)-GORE_NEAR)/GORE_NEAR);x<=Math.floor((Math.max(a.x,b.x)+GORE_NEAR)/GORE_NEAR);x++){
        for(let z=Math.floor((Math.min(a.z,b.z)-GORE_NEAR)/GORE_NEAR);z<=Math.floor((Math.max(a.z,b.z)+GORE_NEAR)/GORE_NEAR);z++){
          const key=\`\${x},\${z}\`,bucket=cells.get(key)??[];
          bucket.push(i);cells.set(key,bucket);
        }
      }
    }
    const taper=[];let from=0;`);
    replace('        for(let i=1;i<other.length;i++){',
      '        for(const i of cells.get(`${Math.floor(p.x/GORE_NEAR)},${Math.floor(p.z/GORE_NEAR)}`)??[]){');
    replace('record.gores[side].push({gaps,paints,end:link?-1:end});',
      'record.gores[side].push({gaps,paints,end:link?-1:end});taper.push({gaps,from,end,length:record.length,laneSpan:l.count*l.width});');
    replace('from+=record.length;\n    }\n  };\n  for(const [left,right] of fans)',
      'from+=record.length;\n    }\n    taperGore(taper,GORE_STEP,GORE_NEAR,Math.max(...other.map(p=>p.laneSpan)));\n  };\n  for(const [left,right] of fans)');
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
  'world/assets/tile.worker-Ai2ZdmRL.js', 'world/assets/streets-CfYSUqyW.js', 'world/assets/lane-layout.js',
  'world/assets/foundations.js', 'world/assets/environment-WQwLg8tn.js',
]);
