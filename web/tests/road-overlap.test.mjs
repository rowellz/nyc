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


const near=(actual,expected,tolerance=1e-5)=>assert(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected}`);
const mesh=()=>({pos:[],nrm:[],aA:[],aB:[],idx:[]});
function quad(g,x0,z0,x1,z1,height=()=>.02){
 const base=g.pos.length/3;
 for(const [x,z] of [[x0,z0],[x1,z0],[x1,z1],[x0,z1]]) {
  g.pos.push(x,height(x,z),z);g.nrm.push(0,1,0);g.aA.push(x,z,0,1);g.aB.push(1,0,0,.5);
 }
 g.idx.push(base,base+2,base+1,base,base+3,base+2);
}
function area(g){let total=0;for(let i=0;i<g.idx.length;i+=3){const [a,b,c]=g.idx.slice(i,i+3).map(v=>v*3);total+=Math.abs((g.pos[b]-g.pos[a])*(g.pos[c+2]-g.pos[a+2])-(g.pos[c]-g.pos[a])*(g.pos[b+2]-g.pos[a+2]))/2;}return total;}
{
 const g=mesh();quad(g,0,0,10,10);quad(g,5,0,15,10);
 near(resolveRoadOverlaps(g),50);near(area(g),150);near(resolveRoadOverlaps(g),0);
 for(const v of g.idx){near(g.aA[v*4],g.pos[v*3]);near(g.aA[v*4+1],g.pos[v*3+2]);}
}
{
 const g=mesh();quad(g,0,0,10,10);quad(g,0,0,10,10,()=>7.02);
 near(resolveRoadOverlaps(g),0);near(area(g),200);
}
{
 const g=mesh();quad(g,4000,-10000,4010,-9990,x=>.02+(x-4000)*.1);quad(g,4005,-10000,4015,-9990,x=>.02+(x-4000)*.1);
 near(resolveRoadOverlaps(g,4000,-10000),50);near(area(g),150);
}
{
 const g=mesh();quad(g,0,0,10,10,x=>x*.1);quad(g,0,0,10,10,x=>1-x*.1);
 near(resolveRoadOverlaps(g),0);near(area(g),200);
}
console.log('PASS overlapping road faces are clipped once; material coordinates, elevated decks and distinct ramp slopes are preserved');
const unpack=built=>{const m=built.meshes[0],a=m.attributes;return {pos:Array.from(a.position.data),nrm:Array.from(a.normal.data),aA:Array.from(a.aA.data),aB:Array.from(a.aB.data),idx:Array.from(m.index)};};
for(const key of ['16_-41','17_-41','18_-40']) {
 const tile=JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${key}.json.gz`,import.meta.url))));
 sandbox.$resolveRoadOverlaps=()=>0;
 const before=await build(tile.roads,tile), raw=unpack(before);
 const removed=resolveRoadOverlaps(raw,tile.tx*256,tile.tz*256);
 assert(removed>1,`${key} must reproduce coplanar road overlap`);
 sandbox.$resolveRoadOverlaps=resolveRoadOverlaps;
 const after=await build(tile.roads,tile),clean=unpack(after);
 const remaining=resolveRoadOverlaps(clean,tile.tx*256,tile.tz*256);
 assert(remaining<.5,`${key} still has ${remaining} m2 of duplicate faces`);
 near(area(unpack(after)),area(raw),.5);
 assert.deepEqual(after.decks,before.decks,'road heights and traffic support are unchanged');
 assert.deepEqual(after.colliderPos,before.colliderPos,'physical road geometry is unchanged');
 assert.deepEqual(after.meshes[2],before.meshes[2],'lane markings are unchanged');
 console.log(`PASS ${key}: removed ${removed.toFixed(1)} m2 of duplicate road surface; ${remaining.toFixed(3)} m2 remaining after GPU precision conversion`);
}
assert.equal(readFileSync(new URL('../../public/world/assets/road-overlap.js',import.meta.url),'utf8'),readFileSync(new URL('../../src/client/src/streets/road-overlap.js',import.meta.url),'utf8'));
