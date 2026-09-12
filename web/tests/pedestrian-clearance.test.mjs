import { pedestrianClearance } from '../../public/world/assets/pedestrian-clearance.js';
import { resolveRoadOverlaps } from '../../public/world/assets/road-overlap.js';
import { roadFootprints } from '../../public/world/assets/fixtures.js';
import { deckEdges, barrierRuns } from '../../public/world/assets/edges.js';
import { clearanceProfile } from '../../public/world/assets/ramps.js';
import { carriagewayIndex, pathHalfWidth, pathPieceClear } from '../../public/world/assets/carriageway.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import * as tunnels from '../../public/world/assets/tunnels.js';
import { supportPlanner, roadDeckHeight, roadDeckTriangles, triangleHeight } from '../../public/world/assets/supports.js';

const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 12, lanes: 3, oneway: true,
  layer: 1, bridge: true, tunnel: false, ...extra });
const lower = road(11, [[-128, 128], [384, 128]]);
const upper = road(12, [[128, -128], [128, 384]], { layer: 3 });
const surface = road(13, [[-128, 80], [384, 80]], { cls: 'primary', bridge: false, layer: 0, lanes: 2, width: 8 });
const makeTile = (roads, extra = {}) => ({ key: '0_0', tx: 0, tz: 0, roads, buildings: [], roadbeds: [], sidewalks: [], medians: [], parks: [], water: [],
  parking: [], plazas: [], crossings: [], trees: [], props: [], groundElev: 0, ...extra });
let result;
const sandbox = { console, performance, self: { postMessage: r => { result = r; } }, $roadFootprints: roadFootprints, $deckEdges: deckEdges, $barrierRuns: barrierRuns, $clearanceProfile: clearanceProfile, $roadDeckTriangles: roadDeckTriangles, $triangleHeight: triangleHeight, $roadDeckHeight: roadDeckHeight, $supportPlanner: supportPlanner,
  $tunnelBuild: tunnels.buildTunnels, $tunnelNetwork: tunnels.tunnelNetwork, $tunnelCut: tunnels.cutBuilder, $carriagewayIndex: carriagewayIndex, $pathHalfWidth: pathHalfWidth, $pathPieceClear: pathPieceClear, $resolveRoadOverlaps: resolveRoadOverlaps, $pedestrianClearance: pedestrianClearance };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../../public/world/assets/tile.worker-Ai2ZdmRL.js', import.meta.url), 'utf8').replace(/^import .*$/gm, ''), sandbox);
async function build(roads, extra = {}) {
  await sandbox.self.onmessage({ data: { id: 1, input: { tile: makeTile(roads, extra), roads, quality: { level: 'mobile', shadows: false } } } });
  assert(!result.error, result.error);
  return result.built;
}


const approach=road(501,[[0,128],[100,128]],{bridge:false,layer:0});
const ramp=road(502,[[100,128],[240,128]]);
const path=road(503,[[105,100],[105,156]],{cls:'footway',bridge:false,layer:0,width:3,lanes:0});
const ready=await build([approach,ramp,path]);
for(const x of [103.5,105,106.5])for(const z of [123,128,133]){
 const h=roadDeckHeight(ready.decks,ramp.id,x,z);
 assert(h+.02-1-.15>=2.5,`footpath under ramp only has ${h+.02-1-.15} m headroom`);
}
const landing=roadDeckHeight(ready.decks,approach.id,100,128);
assert(landing>3.6,'the ramp must stay elevated through its original landing');
assert(Math.abs(landing-roadDeckHeight(ready.decks,ramp.id,100,128))<1e-4,'approach and bridge remain continuous');
assert.equal(roadDeckHeight(ready.decks,approach.id,5,128),0,'extended approach eventually returns to ground');
console.log('PASS footpath clearance extends the landing onto the connected approach');
const square=(x0,z0,x1,z1)=>[[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]];
const polygonTile=await build([approach,ramp],{sidewalks:[square(103,100,107,156)]});
assert(roadDeckHeight(polygonTile.decks,ramp.id,105,128)>3.6,'polygon-only sidewalks receive clearance');
const edge=await build([approach,ramp],{sidewalks:[square(103,133,107,140)]});
assert(roadDeckHeight(edge.decks,ramp.id,105,133)>3.6,'an overlap only at the deck edge receives clearance');
const clear=await build([approach,ramp],{sidewalks:[square(103,142,107,150)]});
const noPath=await build([approach,ramp]);
assert.equal(roadDeckHeight(clear.decks,ramp.id,105,128),roadDeckHeight(noPath.decks,ramp.id,105,128),'an adjacent sidewalk does not add lift to the grade-limited ramp');
console.log('PASS polygon sidewalks and outside-edge overlaps are protected; adjacent sidewalks remain unchanged');
for(const key of ['17_-40','18_-40','19_-40']) {
 let tile;try{tile=JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${key}.json.gz`,import.meta.url))));}catch{continue;}
 const neighbourhood=[];const rs=new Map();
 for(let x=tile.tx-1;x<=tile.tx+1;x++)for(let z=tile.tz-1;z<=tile.tz+1;z++){
  try{const t=JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`,import.meta.url))));neighbourhood.push(t);for(const r of t.roads)rs.set(r.id,r);}catch{}
 }
 const input={tile,roads:[...rs.values()],pedestrianTiles:neighbourhood,quality:{level:'mobile',shadows:false}};
 sandbox.$pedestrianClearance=()=>({intersects:()=>false});
 await sandbox.self.onmessage({data:{id:1,input}});assert(!result.error,result.error);const before=result.built;
 let obstacles; sandbox.$pedestrianClearance=(...args)=>obstacles=pedestrianClearance(...args);
 await sandbox.self.onmessage({data:{id:2,input}});assert(!result.error,result.error);const after=result.built;
 let lifted=0;const ids=new Set();
 for(const d of after.decks)for(const p of d.pts){
  const old=roadDeckHeight(before.decks,d.roadId,p.x,p.z);
  if(p.h>old+.1){lifted++;ids.add(d.roadId);}
 }
 let low=0, overlaps=0;
 for(const d of after.decks){const r=rs.get(d.roadId);if(!r?.bridge||!['motorway','trunk','primary','secondary','tertiary','residential','service'].includes(r.cls))continue;
  const slab=['motorway','trunk'].includes(r.cls)?1:1.4;
  for(let i=0;i+11<d.surface.length;i+=6){const poly=[0,3,9,6].map(j=>[d.surface[i+j],d.surface[i+j+2]]);
   if(!obstacles.intersects(poly))continue;
   overlaps++;
   const h=Math.min(...[0,3,9,6].map(j=>d.surface[i+j+1]));
   if(h+.02-slab-.15<2.5-1e-3)low++;
  }
 }
 assert.equal(low,0,`${key}: all overlapping motorway slabs must clear the walking surface`);
 assert(overlaps>0,`${key}: the fixture must contain pedestrian crossings`);
 console.log(`PASS ${key}: ${ids.size} roads adjusted; all mapped pedestrian overlaps have headroom`);
}

{
 const a=road(601,[[140,128],[260,128]]),b=road(602,[[260,128],[420,128]],{bridge:false,layer:0});
 const left=makeTile([a,b],{sidewalks:[square(252,100,256,156)]});
 const right=makeTile([a,b],{key:'1_0',tx:1});
 const values=[];
 for(const tile of [left,right]){
  await sandbox.self.onmessage({data:{id:1,input:{tile,roads:[a,b],pedestrianTiles:[left,right],quality:{level:'mobile',shadows:false}}}});
  assert(!result.error,result.error);
  values.push(roadDeckHeight(result.built.decks,a.id,256,128));
 }
 assert(values[0]>3.6);
 assert(Math.abs(values[0]-values[1])<.001,'both tiles must agree on the extended ramp height at their shared boundary');
}
{
 const tri=poly=>({verts:poly[0].flat(),tris:[0,1,2,0,2,3]});
 const pedestrians=pedestrianClearance([makeTile([],{sidewalks:[square(110,120,115,136)]})],[],tri);
 const plan=supportPlanner({tile:{roads:[ramp]},pedestrians},()=>({hw:6,H:7,hAt:()=>7}));
 const station={x:112.5,z:128,dx:1,dz:0};
 const high=plan(ramp,station,6,6,1,.55);
 assert(high&&high.offsets.every(off=>Math.abs(off)>9),'columns move out of the pedestrian corridor');
 assert.equal(plan(ramp,station,6,2.82,1,.55),null,'omit a support whose crossbeam would block pedestrian headroom');
}
for(const file of ['pedestrian-clearance.js','ramps.js','supports.js'])assert.equal(readFileSync(new URL('../../public/world/assets/'+file,import.meta.url),'utf8'),readFileSync(new URL('../../src/client/src/streets/'+file,import.meta.url),'utf8'));
console.log('PASS ramp continuity across tile boundaries; clear support columns and beams; source/runtime parity');
