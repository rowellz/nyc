import { pedestrianClearance } from '../../public/world/assets/pedestrian-clearance.js';
import { resolveRoadOverlaps } from '../../public/world/assets/road-overlap.js';
import { roadFootprints } from '../../public/world/assets/fixtures.js';
import { deckEdges, barrierRuns } from '../../public/world/assets/edges.js';
import { MAX_ROAD_GRADE, MAX_ROAD_HEIGHT, ROAD_PROFILE_REACH, limitRoadGrades, clearanceProfile } from '../../public/world/assets/ramps.js';
import { carriagewayIndex, pathHalfWidth, pathPieceClear } from '../../public/world/assets/carriageway.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import * as tunnels from '../../public/world/assets/tunnels.js';
import { supportPlanner, roadDeckHeight, roadDeckTriangles, triangleHeight } from '../../public/world/assets/supports.js';

const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 12, lanes: 3, oneway: true,
  layer: 1, bridge: true, tunnel: false, ...extra });
const makeTile = (roads, extra = {}) => ({ key: '0_0', tx: 0, tz: 0, roads, buildings: [], roadbeds: [], sidewalks: [], medians: [], parks: [], water: [],
  parking: [], plazas: [], crossings: [], trees: [], props: [], groundElev: 0, ...extra });
let result;
const sandbox = { console, performance, self: { postMessage: r => { result = r; } }, $roadFootprints: roadFootprints, $deckEdges: deckEdges, $barrierRuns: barrierRuns, $clearanceProfile: clearanceProfile, $roadDeckTriangles: roadDeckTriangles, $triangleHeight: triangleHeight, $roadDeckHeight: roadDeckHeight, $supportPlanner: supportPlanner,
  $tunnelBuild: tunnels.buildTunnels, $tunnelNetwork: tunnels.tunnelNetwork, $tunnelCut: tunnels.cutBuilder, $carriagewayIndex: carriagewayIndex, $pathHalfWidth: pathHalfWidth, $pathPieceClear: pathPieceClear, $resolveRoadOverlaps: resolveRoadOverlaps, $pedestrianClearance: pedestrianClearance };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../../public/world/assets/tile.worker-Ai2ZdmRL.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace('return buildBridges;', 'globalThis.nativeProfile = baseDeckProfile; return buildBridges;'), sandbox);
async function build(roads, extra = {}) {
  await sandbox.self.onmessage({ data: { id: 1, input: { tile: makeTile(roads, extra), roads, quality: { level: 'mobile', shadows: false } } } });
  assert(!result.error, result.error);
  return result.built;
}


const tiles = [], roads = new Map();
for (let x = 15; x <= 21; x++) for (let z = -42; z <= -39; z++) {
  try { const t = JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`, import.meta.url)))); tiles.push(t); for (const r of t.roads) roads.set(r.id, r); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
const allRoads = [...roads.values()];
const env = {tile: {roads: allRoads}, ctx: {world: {roadsNear: () => allRoads}}};
let before = 0, after = 0, maxHeight = 0, checked = 0;

for (const road of allRoads) {
  if (road.tunnel || !['motorway','trunk','primary','secondary','tertiary','residential','service'].includes(road.cls)) continue;
  const raw = sandbox.nativeProfile(env, road), profile = clearanceProfile(env, road, sandbox.nativeProfile);
  const length = road.pts.slice(1).reduce((s,p,i) => s + Math.hypot(p[0]-road.pts[i][0],p[1]-road.pts[i][1]),0);
  let prev = profile.hAt(0), native = raw.hAt(0);
  for (let s=1;s<=length;s++) {
    const h = profile.hAt(s), n = raw.hAt(s);
    before = Math.max(before,Math.abs(n-native)); after=Math.max(after,Math.abs(h-prev));
    native=n;prev=h;maxHeight=Math.max(h,maxHeight);
  }
  checked++;
  assert(profile.H <= MAX_ROAD_HEIGHT, `${road.name}: height ceiling`);
}
assert(checked > 300, 'exercise the real interchange road network');
assert(before > 1, 'the fixture reproduces extreme native ramps');
assert(after <= MAX_ROAD_GRADE + 1e-7, `final grade ${after} exceeds the ceiling`);
assert(maxHeight <= MAX_ROAD_HEIGHT);
console.log(`PASS ${checked} Highbridge/Washington Bridge road profiles: maximum grade ${(before*100).toFixed(1)}% → ${(after*100).toFixed(1)}%`);
const near=(x,z,r)=>allRoads.filter(road=>{
 const xs=road.pts.map(p=>p[0]),zs=road.pts.map(p=>p[1]);
 return Math.max(...xs)>=x-r&&Math.min(...xs)<=x+r&&Math.max(...zs)>=z-r&&Math.min(...zs)<=z+r;
});
const local=(tx,tz,halo)=>{
 const rs=new Map(near((tx+.5)*256,(tz+.5)*256,128+halo).map(r=>[r.id,r]));
 for(const r of tiles.find(t=>t.tx===tx&&t.tz===tz)?.roads??[])rs.set(r.id,r);
 for(const r of [...rs.values()])if(r.bridge||r.tunnel)for(const p of [r.pts[0],r.pts.at(-1)])for(const q of near(...p,3))rs.set(q.id,q);
 const roads=[...rs.values()];return{tile:{roads},ctx:{world:{roadsNear:()=>roads}}};
};
for(const halo of [ROAD_PROFILE_REACH]){
 let gap=0,at;
 for(let tx=16;tx<20;tx++)for(let tz=-41;tz<-39;tz++){
 const a=local(tx,tz,halo), b=local(tx+1,tz,halo),x=(tx+1)*256;
 for(const r of allRoads){if(!r.bridge||r.tunnel)continue;
 let s=0;
 for(let i=1;i<r.pts.length;i++){
 const p=r.pts[i-1],q=r.pts[i],l=Math.hypot(q[0]-p[0],q[1]-p[1]),t=(x-p[0])/(q[0]-p[0]),z=p[1]+t*(q[1]-p[1]);
 if(t>=0&&t<=1&&z>=tz*256&&z<tz*256+256){
 const d=Math.abs(clearanceProfile(a,r,sandbox.nativeProfile).hAt(s+t*l)-clearanceProfile(b,r,sandbox.nativeProfile).hAt(s+t*l));
 if(d>gap){gap=d;at=[tx,tz,r.name,r.id];}
 }s+=l;
 }
 }
 }
 assert(gap < 1e-6, `neighbouring tile profiles disagree by ${gap} m at ${at}`);
 console.log('PASS real roads share elevations across eight independently planned tile seams');
}

// The total height, including the native crown, must obey the grade limit.
const approach = road(901, [[-300,128],[100,128]], {bridge:false,layer:0});
const steep = road(902, [[100,128],[120,128]], {layer:3});
const departure = road(903, [[120,128],[520,128]], {bridge:false,layer:0});
const rampRoads = [approach,steep,departure];
const rampEnv = {tile:{roads:rampRoads},ctx:{world:{roadsNear:()=>rampRoads}}};
const sampled = rampRoads.map(r=>clearanceProfile(rampEnv,r,sandbox.nativeProfile));
assert(sampled[0].hAt(400) > 15, 'a short tag must extend the climb into its approach');
assert.equal(sampled[0].hAt(400),sampled[1].hAt(0));
assert.equal(sampled[1].hAt(20),sampled[2].hAt(0));
assert.equal(sampled[0].hAt(0),0);
assert.equal(sampled[2].hAt(400),0);
const rampTile = await build(rampRoads);
for(const deck of rampTile.decks) for(let i=1;i<deck.pts.length;i++) {
 const a=deck.pts[i-1], b=deck.pts[i];
 const run=Math.hypot(b.x-a.x,b.z-a.z);
 assert(Math.abs(b.h-a.h)<=run*MAX_ROAD_GRADE+1e-6,'rendered ramp samples obey the ceiling');
}
console.log('PASS short steep spans extend into both approaches, retain their crown and meet without steps');

const chain = [
 {base:0,links:[[1,10]],crossings:[[1,5.95,'inconsistent merge']]},
 {base:7,links:[[0,10],[2,100]],crossings:[]},
 {base:0,minimum:3.8,links:[[1,100]],crossings:[]},
];
const safe = limitRoadGrades(chain);
assert(safe[1]>=7 && safe[2]>=3.8,'keep native height and pedestrian headroom');
for(let i=0;i<chain.length;i++)for(const [j,distance] of chain[i].links)
 assert(Math.abs(safe[i]-safe[j])<=MAX_ROAD_GRADE*distance+1e-6,'contradictory topology cannot relax the grade');
assert(Math.max(...safe)<8,'a contradictory junction cannot generate a tower');
assert.equal(limitRoadGrades([{base:100,links:[],crossings:[]}])[0],MAX_ROAD_HEIGHT);
assert(ROAD_PROFILE_REACH>MAX_ROAD_HEIGHT/MAX_ROAD_GRADE,'streamed context contains the longest possible approach');
assert.equal(readFileSync(new URL('../../src/client/src/streets/ramps.js',import.meta.url),'utf8'),readFileSync(new URL('../../public/world/assets/ramps.js',import.meta.url),'utf8'));
console.log('PASS contradictory crossings retain hard limits; source and served planners match');

function paintFaces(tile) {
 const mesh=tile.meshes[2],p=mesh.attributes.position.data,faces=[];
 for(let i=0;i<mesh.index.length;i+=3)
  faces.push(Array.from(mesh.index.slice(i,i+3),v=>Array.from(p.slice(v*3,v*3+3))));
 return faces;
}
function assertLineCovered(faces,tile,r,x,z) {
 const height=roadDeckHeight(tile.decks,r.id,x,z)+.032;
 assert(faces.some(face=>{
  const sample=triangleHeight(face,x,z);
  return sample?.inside&&Math.abs(sample.height-height)<.003;
 }),`solid line on road ${r.id} missing at ${x},${z},${height}`);
}
const bend=road(904,[[10,45],[90,45],[170,160],[245,160]],{layer:3});
const bendTile=await build([bend]);
const bendFaces=paintFaces(bendTile),bendEdges=deckEdges(bend,[bend],6);
const bendLength=80+Math.hypot(80,115)+75;
let paintSamples=0;
for(let s=.37;s<bendLength;s+=1)for(const offset of [-4.95,4.95]) {
 const [x,z]=bendEdges.line(s,offset);
 assertLineCovered(bendFaces,bendTile,bend,x,z);paintSamples++;
}
const thin=road(905,[[5,128],[128,128]],{width:8,lanes:2});
const wide=road(906,[[128,128],[250,128]],{width:18,lanes:2});
const pair=[thin,wide],pairTile=await build(pair),pairFaces=paintFaces(pairTile);
for(let x=115.37;x<140;x+=.5)for(const offset of [-3.3,3.3])
 assertLineCovered(pairFaces,pairTile,x<128?thin:wide,x,128+offset);
console.log(`PASS ${paintSamples} solid-line samples cover rising bends and crests; shoulder-width joins retain lane spacing`);
