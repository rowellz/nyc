import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';

const { clearanceProfile, MAX_ROAD_GRADE, ROAD_PROFILE_REACH } = await import(new URL('ramps.js', assets));
const tunnels = await import(new URL('tunnels.js', assets));
const { roadDeckHeight, roadDeckTriangles, triangleHeight } = await import(new URL('supports.js', assets));
const { deckEdges } = await import(new URL('edges.js', assets));
const scope = { console, performance, self: { postMessage: r => { scope.response = r; } } };
const worker = readFileSync(new URL('tile.worker-Ai2ZdmRL.js', assets), 'utf8');
for (const match of worker.matchAll(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?$/gm)) {
  const module = await import(new URL(match[2], assets));
  for (const binding of match[1].split(',')) {
    const [name, alias = name] = binding.trim().split(/\s+as\s+/); scope[alias] = module[name];
  }
}
vm.createContext(scope);
vm.runInContext(worker.replace(/^import .*$/gm, '').replace('return buildBridges;',
  'globalThis.nativeProfile=baseDeckProfile;return buildBridges;'), scope);
const makeEnv = roads => ({ tile: { roads }, ctx: { world: { roadsNear: () => roads } } });
const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 8, lanes: 2, oneway: true,
  bridge: true, layer: 1, tunnel: false, ...extra });
const length = r => r.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0]-r.pts[i][0], p[1]-r.pts[i][1]), 0);
const flat = (_env, r) => ({ hw: r.width / 2, H: 7, hAt: () => 7 });
const sameLayer = [road(1, [[-300,0],[300,0]]), road(2, [[0,-300],[0,300]]), road(3, [[-300,-300],[300,300]])];
const synthetic = makeEnv(sameLayer);
const levels = sameLayer.map(r => clearanceProfile(synthetic, r, flat).hAt(length(r)/2)).sort((a,b) => a-b);
assert.equal(levels[0], 7, 'keep the lower motorway in place');
for(let i=1;i<levels.length;i++) assert(levels[i]-levels[i-1] >= 6.04, 'same-layer crossing decks need clearance');
const untagged=sameLayer.slice(0,2).map(r=>({...r,bridge:false,layer:0})),untaggedEnv=makeEnv(untagged);
assert(Math.abs(clearanceProfile(untaggedEnv,untagged[0],flat).hAt(300)
  -clearanceProfile(untaggedEnv,untagged[1],flat).hAt(300))>=6.04,'untagged motorway connectors also need clearance');
const merge = [road(4, [[-300,0],[0,0]]), road(5, [[0,0],[300,30]]), road(6, [[0,0],[300,-30]])];
const mergeEnv = makeEnv(merge);
for (const r of merge) assert.equal(clearanceProfile(mergeEnv,r,flat).hAt(r.id===4?300:0), 7, 'a real merge stays connected');
const split=[road(7,[[0,0],[200,8]]),road(8,[[0,0],[200,-8]])],splitEnv=makeEnv(split);
const forkBase=(_e,r)=>({hw:4,H:r.id===7?13:7,hAt:()=>r.id===7?13:7});
const splitProfiles=split.map(r=>clearanceProfile(splitEnv,r,forkBase));
assert(Math.abs(splitProfiles[0].hAt(20)-splitProfiles[1].hAt(20))<1e-6,
  'overlapping fork lanes share a surface while one branch climbs');
const alreadyClear = [sameLayer[0], {...sameLayer[1],layer:3}];
const clearEnv = makeEnv(alreadyClear), stacked = (_e,r) => ({hw:4,H:r.layer*7,hAt:()=>r.layer*7});
assert.equal(clearanceProfile(clearEnv,alreadyClear[0],stacked).hAt(300),7);
assert.equal(clearanceProfile(clearEnv,alreadyClear[1],stacked).hAt(300),21);
console.log('PASS same-layer stacks separate, real merges stay connected, and clear crossings retain their heights');

const tiles=[];
for(let x=12;x<=23;x++)for(let z=-45;z<=-37;z++) {
  try { tiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`,import.meta.url))))); }
  catch(e) { if(e.code!=='ENOENT')throw e; }
}
const roads=[...new Map(tiles.flatMap(t=>t.roads).map(r=>[r.id,r])).values()];
const env=makeEnv(roads), profiles=new Map();
for(const r of roads.filter(r=>!r.tunnel&&['motorway','trunk'].includes(r.cls))) profiles.set(r.id,clearanceProfile(env,r,scope.nativeProfile));
// Crossings from the reported interchanges, including the GWB lower-level exit
// and the neighboring decks whose stacking order it depends on. Each tuple is a pair of ways
// followed by distances along them and the actual centreline intersection.
const crossings=[
  [121772577000,8119552000,255.311702,29.817406,4426.424047,-10214.971035],
  [121772578000,8119542000,238.872862,63.911932,4398.237254,-10197.276870],
  [121772578000,8119552000,278.778451,5.611846,4437.895902,-10193.745978],
  [121772578000,1504753150000,192.671951,20.488635,4355.435780,-10214.149330],
  [1081036136000,1504753159000,75.007397,9.739333,4394.897992,-10255.105563],
  [8119552000,1081036137000,51.067475,50.198878,4412.369661,-10230.849426],
  [42435675000,46593913000,13.823282,94.463379,4469.850273,-10200.308764],
  [46593913000,1081036134000,112.736787,77.998116,4473.030904,-10218.220965],
  [46593913000,1303990618000,50.584794,10.232304,4442.708185,-10166.917916],
  [46593913000,1303990901000,46.148619,8.698957,4438.784878,-10164.853504],
  [46593913000,1303991946000,28.585312,34.580940,4422.339018,-10158.842716],
  [46593913000,1303991948000,35.405122,30.282930,4428.911538,-10160.641033],
  [33117572000,46620623000,17.458550,79.730744,4888.981816,-10090.228865],
  [33117572000,46620634001,7.509076,97.868917,4898.834663,-10088.846307],
  [121787381000,46620623000,242.313827,64.077272,4886.837762,-10074.761360],
  [121787381000,46620634001,252.431486,82.134370,4896.843024,-10073.259065]
];
const gwbCrossings=[
  [8119579000,46617679000,228.964944209,39.033656624,3379.941960408,-10629.788990052],
  [8119592000,1303147022000,332.982248283,15.040036526,3446.107556827,-10623.398565045],
  [16586045000,1087557588000,160.378681111,29.998362145,3372.504907431,-10640.905519055],
  [16586045000,1087557589000,156.261316152,30.647376998,3376.491110747,-10639.874559631],
  [44763891000,1087557588000,79.313060820,19.349850823,3370.831257886,-10630.389355754],
  [44763891000,1087557589000,84.372981214,19.895814588,3375.742453581,-10629.171590903],
  [46588491000,1087557588000,92.997375159,42.399482025,3374.454018252,-10653.152508126],
  [46588491000,1087557589000,90.977539219,43.417973545,3376.409028094,-10652.644892384],
  [46588494000,1303147022000,59.049774380,26.584642879,3434.937223058,-10626.314311831],
  [46590816000,1087557588000,169.215827625,34.920802467,3373.278578018,-10645.766779442],
  [46590816000,1087557589000,166.040870000,36.512092192,3376.453415453,-10645.739153681],
  [46617679000,1087557588000,29.909993936,20.950392823,3371.082818532,-10631.970004968],
  [46617679000,1087557589000,34.915369452,21.510205854,3375.943074041,-10630.773468113],
  [46617791000,1087557588000,36.230150103,31.559909708,3372.750339237,-10642.447658485],
  [46617791000,1087557589000,32.377381593,32.257304117,3376.480762985,-10641.484453495],
  [46618200000,1087557588000,30.944201357,15.469368643,3370.221354112,-10626.557103240],
  [46618200000,1087557589000,36.462593601,14.641879450,3375.089546876,-10623.958381981]
];
const cases=[...crossings,...gwbCrossings];
for(const [a,b,s,t] of cases) assert(Math.abs(profiles.get(a).hAt(s)-profiles.get(b).hAt(t)) >= 5.9, `intersecting profiles ${a}/${b}`);
let grades=0;const joins=new Map();
for(const r of roads.filter(r=>profiles.has(r.id))) {
  const p=profiles.get(r.id),size=length(r);
  for(let s=0;s<size;s+=1) { const t=Math.min(size,s+1); assert(Math.abs(p.hAt(t)-p.hAt(s))<=MAX_ROAD_GRADE*(t-s)+1e-6,`grade on ${r.id}`); grades++; }
  for(const [xy,s]of[[r.pts[0],0],[r.pts.at(-1),size]]) {
    const key=xy.map(v=>Math.round(v*2)).join(','),heights=joins.get(key)??[];
    heights.push(p.hAt(s));joins.set(key,heights);
  }
}
for(const heights of joins.values()) assert(Math.max(...heights)-Math.min(...heights)<1e-6,'shared endpoints agree');
console.log(`PASS ${cases.length} reported-area crossings, ${grades} road grade samples, and every shared motorway endpoint`);
const reverse=makeEnv([...roads].reverse());
for(const [a,b,s,t]of cases)for(const [id,station]of[[a,s],[b,t]])
  assert(Math.abs(clearanceProfile(reverse,roads.find(r=>r.id===id),scope.nativeProfile).hAt(station)-profiles.get(id).hAt(station))<1e-6,'road arrival order cannot change the stack');

// Each job sees its normal streamed halo, not the entire city.
const local=(tile)=>{
  const x=tile.tx*256,z=tile.tz*256,reach=ROAD_PROFILE_REACH;
  return roads.filter(r=>r.pts.some(p=>p[0]>=x-reach&&p[0]<=x+256+reach&&p[1]>=z-reach&&p[1]<=z+256+reach));
};
let seams=0;
for(const [tx,tz] of [[13,-42],[16,-41],[17,-41],[18,-40],[19,-40]]) {
  const a=makeEnv(local({tx,tz})), b=makeEnv(local({tx:tx+1,tz})),x=(tx+1)*256;
  for(const r of roads.filter(r=>profiles.has(r.id))) {
    let along=0;
    for(let i=1;i<r.pts.length;i++) {
      const p=r.pts[i-1],q=r.pts[i],size=Math.hypot(q[0]-p[0],q[1]-p[1]);
      const t=(x-p[0])/(q[0]-p[0]),z=p[1]+(q[1]-p[1])*t;
      if(t>=0&&t<=1&&z>=tz*256&&z<(tz+1)*256) {
        const s=along+t*size;
        assert(Math.abs(clearanceProfile(a,r,scope.nativeProfile).hAt(s)-clearanceProfile(b,r,scope.nativeProfile).hAt(s))<1e-6,`tile seam on ${r.id}`);
        seams++;
      }
      along+=size;
    }
  }
}
assert(seams>10);
console.log(`PASS ${seams} motorway elevations agree across independently planned tile boundaries`);
const built=new Map(),colliders=new Map();
for(const key of ['13_-42','17_-40','17_-41','19_-40']) {
  const original=tiles.find(t=>t.key===key),near=local(original);
  const tile={...original,buildings:[],roadbeds:[],sidewalks:[],medians:[],parks:[],water:[],parking:[],plazas:[],crossings:[],trees:[],props:[]};
  await scope.self.onmessage({data:{id:1,input:{tile,roads:near,pedestrianTiles:[tile],quality:{level:'mobile',shadows:false}}}});
  assert(!scope.response.error,scope.response.error); built.set(key,scope.response.built);
  const cells=new Map(),{colliderPos:positions,colliderIdx:indices}=scope.response.built;
  for(let i=0;i<indices.length;i+=3) {
    const tri=[0,1,2].map(j=>Array.from(positions.slice(indices[i+j]*3,indices[i+j]*3+3)));
    for(let x=Math.floor(Math.min(...tri.map(p=>p[0]))/16);x<=Math.floor(Math.max(...tri.map(p=>p[0]))/16);x++)
      for(let z=Math.floor(Math.min(...tri.map(p=>p[2]))/16);z<=Math.floor(Math.max(...tri.map(p=>p[2]))/16);z++) {
        const key=`${x},${z}`,bucket=cells.get(key)??[];bucket.push(tri);cells.set(key,bucket);
      }
  }
  colliders.set(key,cells);
  original.approachProfiles=scope.response.built.approachProfiles;
}
const world={tiles:new Map(tiles.map(t=>[t.key,t]))};
let samples=0,passageSamples=0;
for(const crossing of cases) {
  const [a,b,,,x,z]=crossing;
  const tile=built.get(`${Math.floor(x/256)}_${Math.floor(z/256)}`);
  const surfaces=[a,b].map(id=>roadDeckTriangles(tile.decks,id));
  for(let dx=-6;dx<=6;dx+=1)for(let dz=-6;dz<=6;dz+=1) {
    const heights=surfaces.map(faces=>faces.map(tri=>triangleHeight(tri,x+dx,z+dz)).find(h=>h?.inside)?.height);
    if(heights.some(h=>h===undefined))continue;
    assert(Math.abs(heights[0]-heights[1])-1 >= 4.8,`mesh headroom ${a}/${b} at ${x+dx},${z+dz}: ${heights}`);
    const key=`${Math.floor(x/256)}_${Math.floor(z/256)}`;
    const physical=(colliders.get(key).get(`${Math.floor((x+dx)/16)},${Math.floor((z+dz)/16)}`)??[])
      .map(tri=>triangleHeight(tri,x+dx,z+dz)).filter(h=>h?.inside).map(h=>h.height);
    const floor=Math.min(...heights);
    // The shoulder's own parapet is expected at the ribbon boundary. Passage
    // clearance applies to the interior, away from either road's edge.
    const interior=surfaces.every(faces=>[[.8,0],[-.8,0],[0,.8],[0,-.8]].every(([ox,oz])=>
      faces.some(tri=>triangleHeight(tri,x+dx+ox,z+dz+oz)?.inside)));
    if(interior&&!gwbCrossings.includes(crossing)) {
      assert(!physical.some(h=>h>floor+.15&&h<floor+4.8),`collider blocks crossing ${a}/${b} at ${x+dx},${z+dz}: floors ${heights}; physical ${physical}`);
      passageSamples++;
    }
    for(const [i,id]of[a,b].entries()) {
      const r=roads.find(r=>r.id===id),fallback=roadDeckHeight(tile.decks,id,x+dx,z+dz);
      assert(Math.abs(tunnels.trafficHeight(world,r,x+dx,z+dz,fallback)-heights[i])<.03,'traffic uses its own corrected deck');
      // GWB's additional stacked carriageways overlap parts of this grid too.
      // Check its driving lanes below, rather than treating every overlapping
      // shoulder as a vehicle route through the entire stack.
      if(interior&&!gwbCrossings.includes(crossing)) {
        const supported=tunnels.tunnelSupport(world,x+dx,z+dz,heights[i]+.3,Math.max(...heights));
        assert(Math.abs(supported-heights[i])<.25,`player support on ${id} at ${x+dx},${z+dz}: ${supported} != ${heights[i]}`);
      }
      assert(physical.some(h=>Math.abs(h-heights[i])<.04),'the corrected pavement has a matching collider');
    }
    samples++;
  }
}
assert(samples>100&&passageSamples>100);
console.log(`PASS ${samples} overlapping pavement samples and ${passageSamples} collider passages in independently built worker tiles`);
let laneSamples=0;
for(const [a,b,s,t]of gwbCrossings)for(const [id,at]of[[a,s],[b,t]]) {
  const r=roads.find(r=>r.id===id),edges=deckEdges(r,roads,Math.max(3.2,r.width/2));
  const count=edges.layout?.count??r.lanes,width=edges.layout?.width??r.width/count;
  for(let station=Math.max(0,at-8);station<=Math.min(length(r),at+8);station+=2)for(let lane=0;lane<count;lane++) {
    // The driven SUV's rounded collider has half-width 1.86 * .46 = .8556 m.
    // Sample beyond that body with extra headroom along the reported route.
    for(const offset of [-.9,0,.9]) {
      const [x,z]=edges.line(station,(lane+.5-count/2)*width+offset);
      const key=`${Math.floor(x/256)}_${Math.floor(z/256)}`,tile=built.get(key);
      assert(tile,`missing GWB test tile ${key}`);
      const floor=roadDeckHeight(tile.decks,id,x,z);
      const physical=(colliders.get(key).get(`${Math.floor(x/16)},${Math.floor(z/16)}`)??[])
        .map(tri=>triangleHeight(tri,x,z)).filter(h=>h?.inside).map(h=>h.height);
      assert(physical.some(h=>Math.abs(h-floor)<.04),`missing driving floor on ${id}`);
      assert(!physical.some(h=>h>floor+.3&&h<floor+2.1),`blocked passenger lane on ${id} at ${station}: ${floor}; ${physical}`);
      assert(Math.abs(tunnels.trafficHeight(world,r,x,z,floor)-floor)<.03,`GWB traffic support on ${id}`);
      const supported=tunnels.tunnelSupport(world,x,z,floor+.3,floor);
      assert(Math.abs(supported-floor)<.3,`GWB player support on ${id} at ${station}, ${lane}, ${offset}: ${floor} -> ${supported}`);
      laneSamples++;
    }
  }
}
assert(laneSamples>1000);
console.log(`PASS ${laneSamples} GWB passenger-lane floor, body-clearance, and support samples`);
// Each tile owns its portion of a way. A neighboring job may carry a different
// height estimate outside its tile, and must not overwrite the owner's section.
const approach=road(90,[[-100,128],[600,128]],{bridge:false,layer:0});
const bore=road(91,[[-200,128],[-100,128]],{bridge:false,tunnel:true,layer:-1});
const streamed=[0,1].map(tx=>({tx,tz:0,roads:[bore,approach],approachProfiles:[{id:90,
  points:[0,200,450,700].map(s=>({s,x:s-100,z:128,h:tx?20:5}))}]}));
const streamedWorld={tiles:new Map(streamed.map(t=>[t.tx,t]))};
let profile=tunnels.worldTunnels(streamedWorld).get(90);
assert.equal(tunnels.tunnelHeight(profile,200),5);
assert.equal(tunnels.tunnelHeight(profile,450),20);
const reversedWorld={tiles:new Map([...streamedWorld.tiles].reverse())};
assert.deepEqual(tunnels.worldTunnels(reversedWorld).get(90).elevation,profile.elevation);
streamed[0].approachProfiles=[{id:90,points:streamed[0].approachProfiles[0].points.map(p=>({...p,h:p.h+1}))}];
profile=tunnels.worldTunnels(streamedWorld).get(90);
assert.equal(tunnels.tunnelHeight(profile,200),6);
assert.equal(tunnels.tunnelHeight(profile,450),20);
console.log('PASS streamed approach heights respect tile ownership, arrival order, and geometry replacement');
