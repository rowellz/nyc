import { stripTypeScriptTypes } from 'node:module';
import { highwayLayout, isHighway, laneCount, laneWidth } from '../../public/world/assets/lane-layout.js';
import { highwayLanePath, lanePoint } from '../../public/world/assets/lane-paths.js';
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



const left=road(1001,[[10,80],[120,128]] ,{lanes:2,width:10});
const right=road(1002,[[10,170],[120,128]],{lanes:2,width:10});
const joined=road(1003,[[120,128],[245,128]],{lanes:4,width:15});
const network=[left,right,joined];
function endpoints(r,roads,end){
 const layout=highwayLayout(r,roads),edges=deckEdges(r,roads,Math.max(3.2,r.width/2));
 return Array.from({length:r.lanes},(_,i)=>edges.line(end?layout.length:0,(i+.5-r.lanes/2)*layout.width));
}
const targets=endpoints(joined,network,false);
const source=[...endpoints(left,network,true),...endpoints(right,network,true)];
assert.equal(new Set(source.map(p=>p.join(','))).size,4,'two incoming carriageways must retain four distinct lanes');
for(const p of source)assert(targets.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-6),'every incoming lane lands on an outgoing centre');
for(const r of network)assert.deepEqual(endpoints(r,network,true),endpoints(r,[...network].reverse(),true),'arrival order cannot change lane assignments');
const mesh=await build(network);
for(const r of [left,right]){
 const layout=highwayLayout(r,network),edges=deckEdges(r,network,r.width/2);
 for(let i=0;i<r.lanes;i++){
  const offset=(i+.5-r.lanes/2)*layout.width;
  const path=highwayLanePath(r,network,0,offset);
  for(const p of path.path){
   assert(roadDeckTriangles(mesh.decks,r.id).some(t=>triangleHeight(t,p.x,p.z)?.inside),'traffic guide stays on its owning asphalt through the merge');
  }
  const end=lanePoint(path,path.length);
  assert(targets.some(q=>Math.hypot(end.x-q[0],end.z-q[1])<1e-6));
 }
}
console.log('PASS two-to-four lane merge: unique assignments, continuous traffic guides and matching asphalt');
const drop=road(1004,[[245,128],[380,128]],{lanes:3,width:11});
const dropping=[joined,drop];
for(const p of endpoints(joined,dropping,true))assert(endpoints(drop,dropping,false).some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-6),'a dropped lane merges into a surviving lane');
console.log('PASS lane drops join surviving lanes without endpoint jumps');
const cityRoads=new Map(),cityTiles=[];
for(let x=15;x<=20;x++)for(let z=-42;z<=-39;z++){
 try{const t=JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`,import.meta.url))));cityTiles.push(t);for(const r of t.roads)cityRoads.set(r.id,r);}catch(e){if(e.code!=='ENOENT')throw e;}
}
const real=[...cityRoads.values()];
for(const [incoming,outgoing] of [[[42435675000,1504770029000],[49036327000]],[[46593907000],[1081036134000,1081036135000]]]){
 const ins=incoming.map(id=>cityRoads.get(id)),outs=outgoing.map(id=>cityRoads.get(id));
 assert(ins.every(Boolean)&&outs.every(Boolean));
 const a=ins.flatMap(r=>endpoints(r,real,true)),b=outs.flatMap(r=>endpoints(r,real,false));
 for(const p of a)assert(b.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-6),`real Trans-Manhattan incoming lane must connect: ${incoming} ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
 for(const p of b)assert(a.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-6),'real Trans-Manhattan outgoing lane must connect');
}
console.log('PASS actual Trans-Manhattan upper/lower carriageway merge and split have connected lanes');
// Check the visible top of the connected carriageways, not just each road in isolation.
let hidden=0,checked=0;
const group=[42435675000,1504770029000,49036327000].map(id=>cityRoads.get(id));
const tile=cityTiles.find(t=>t.key==='17_-40');assert(tile);
await sandbox.self.onmessage({data:{id:9,input:{tile,roads:real,pedestrianTiles:cityTiles,quality:{level:'mobile',shadows:false}}}});
assert(!result.error,result.error);
const realBuilt=result.built;
for(const r of group){
 const layout=highwayLayout(r,real),edges=deckEdges(r,real,r.width/2);
 const own=roadDeckTriangles(realBuilt.decks,r.id);
 for(let s=.4;s<layout.length;s+=1)for(let q=.5;q<r.lanes;q++){
  const [x,z]=edges.line(s,(q-r.lanes/2)*layout.width);
  const y=own.map(t=>triangleHeight(t,x,z)).filter(t=>t?.inside).map(t=>t.height);
  if(!y.length)continue;checked++;
  for(const other of group)if(other!==r){
   const above=roadDeckTriangles(realBuilt.decks,other.id).map(t=>triangleHeight(t,x,z)).filter(t=>t?.inside).map(t=>t.height);
   if(above.some(h=>h>Math.max(...y)+.012))hidden++;
  }
 }
}
assert(checked>500);assert.equal(hidden,0,'connected asphalt must not bury a neighbouring lane');
console.log(`PASS ${checked} real merge lane samples stay on the visible surface`);

function sourceModule(relative, injected, exports) {
  let source = readFileSync(new URL('../../src/client/src/' + relative, import.meta.url), 'utf8');
  source = source.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
  source = source.replace('constructor(private ctx: GameContext) {}', 'constructor(ctx: GameContext) { this.ctx = ctx; }')
    .replace('constructor(private ctx: GameContext, private roads: Roads) {}', 'constructor(ctx: GameContext, roads: Roads) { this.ctx = ctx; this.roads = roads; }');
  const js = stripTypeScriptTypes(source);
  return vm.runInNewContext(`(function(){${js};return {${exports}}})()`, injected);
}
const spec = { width: 1.8, length: 4, front: 2, rear: 2, wheelRadius: 0.3, parkedWeight: 0 };
const sourceGround = sourceModule('vehicles/model.ts', {}, 'ground').ground;
const common = { console, highwayLanePath, lanePoint, isHighway, laneCount, laneWidth, KINDS: { sedan: spec, taxi: spec }, hash01: (a, b = 0, c = 0) => ((a * 73 + b * 31 + c * 17) % 997) / 997,
  pickKind: () => 'sedan', ground: sourceGround, removeBody: () => {}, poseMatrix: () => {}, createObstacle: () => {},
  makeCar: (key, kind, x, y, z, yaw) => ({ key, kind, x, y, z, yaw, speed: 0, spin: 0 }), isIOS: () => false, TILE_SIZE: 256,
  trafficHeight: tunnels.trafficHeight, tunnelConnections: tunnels.tunnelConnections,
  distance2: (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 };
const { Roads, isAvenue } = sourceModule('vehicles/roads.ts', common, 'Roads,isAvenue');
const { Traffic } = sourceModule('vehicles/traffic.ts', { ...common, Roads, isAvenue }, 'Traffic');

const shipped=readFileSync(new URL('../../public/world/assets/vehicles-_zJz3z3J.js',import.meta.url),'utf8');
const a=shipped.indexOf('ln=(e,t,n)=>'),b=shipped.indexOf(';function wn(',a);
const actual=vm.runInNewContext(`(function(){let ${shipped.slice(a,b)};return {Roads:vn,Traffic:Cn}})()`,{
 console,$highwayLanePath:highwayLanePath,$lanePoint:lanePoint,$isHighway:isHighway,$laneCount:laneCount,$laneWidth:laneWidth,
 Z:common.KINDS,ht:common.hash01,vt:common.pickKind,jt:sourceGround,Q:common.removeBody,At:common.poseMatrix,Mt:common.createObstacle,kt:common.makeCar,e:common.isIOS,$:common.distance2,
 $tunnelHeight:tunnels.trafficHeight,$tunnelConnections:tunnels.tunnelConnections,
});
for(const [label,classes] of [['source',{Roads,Traffic}],['served',actual]]){
 const tile=makeTile(network),ctx={world:{tiles:new Map([['0_0',tile]])},modules:new Map([['streets',{roadHeight:(r,x,z)=>roadDeckHeight(mesh.decks,r.id,x,z)}]]),quality:{maxTraffic:1},
 state:{screenshotMode:true,local:{state:{x:128,z:128,yaw:0}}},camera:{position:{x:128,z:128},matrixWorld:{elements:new Array(16).fill(0)}},physics:{ready:false}};
 const graph=new classes.Roads(ctx);graph.load(tile);
 assert.equal([...graph.lanes.values()].filter(l=>l.road.id===joined.id).length,4,'all four motorway lanes are driveable');
 const approaches=[...graph.lanes.values()].filter(l=>l.road.id===left.id||l.road.id===right.id);
 assert.equal(approaches.length,4);
 const visited=new Set();
 for(const lane of approaches){
  const sim=new classes.Traffic(ctx,graph),along=lane.length-25,p=lanePoint(lane,along);
  const car={...common.makeCar('merge-'+lane.key,'sedan',p.x,roadDeckHeight(mesh.decks,lane.road.id,p.x,p.z),p.z,Math.atan2(-p.dx,-p.dz)),lane,along,next:null,wait:0,turn:0,age:0,speed:8};
  sim.cars.push(car);let connected=false;
  for(let step=0;step<1200&&!(car.lane.road.id===joined.id&&car.along>30);step++){
   const previous=car.lane;sim.update(1/60,step/60,[]);
   assert(sim.cars.includes(car),'the route must not dead-end');
   if(previous!==car.lane){
    assert(Math.hypot(previous.bx-car.lane.ax,previous.bz-car.lane.az)<1e-6,'traffic crosses matching lane endpoints');
    assert.equal(car.lane.road.id,joined.id);visited.add(car.lane.key);connected=true;
   }
  }
  assert(connected&&car.along>30,`${label}: traffic must travel through the merge`);sim.dispose();
 }
 assert.equal(visited.size,4,'the four incoming lanes map to four distinct outgoing routes');
 // Refreshing neighbours must preserve lane objects held by existing drivers.
 const held=approaches[0];graph.load(makeTile([drop],{key:'1_0',tx:1}));
 assert.equal(graph.lanes.get(held.key),held);
 graph.unload('1_0');assert.equal(graph.lanes.get(held.key),held);
 graph.dispose();assert.equal(graph.lanes.size,0);
 const dropTile=makeTile([joined,drop]);
 const dropCtx={...ctx,world:{tiles:new Map([['0_0',dropTile]])},quality:{maxTraffic:2},modules:new Map([['streets',{roadHeight:()=>0}]])};
 const dropGraph=new classes.Roads(dropCtx);dropGraph.load(dropTile);
 const arrivals=[...dropGraph.lanes.values()].filter(l=>l.road.id===joined.id);
 let merging;
 for(const l of arrivals)for(const r of arrivals)if(l!==r&&Math.hypot(l.bx-r.bx,l.bz-r.bz)<1e-6)merging=[l,r];
 assert(merging,'fixture contains two lanes dropping into one');
 const queue=new classes.Traffic(dropCtx,dropGraph);
 for(const [i,lane] of merging.entries()){
  const along=lane.length-40,p=lanePoint(lane,along);
  queue.cars.push({...common.makeCar('yield-'+i,'sedan',p.x,0,p.z,Math.atan2(-p.dx,-p.dz)),lane,along,next:null,wait:0,turn:0,age:0,speed:8});
 }
 const drivers=[...queue.cars];
 for(let step=0;step<2400&&!drivers.every(c=>c.lane.road.id===drop.id&&c.along>20);step++){
  queue.update(1/60,step/60,[]);
  assert(drivers.every(c=>queue.cars.includes(c)),'merging drivers must remain active');
  assert(!(Math.abs(drivers[0].x-drivers[1].x)<3.8&&Math.abs(drivers[0].z-drivers[1].z)<1.7),`${label}: lane-drop vehicles overlap`);
 }
 assert(drivers.every(c=>c.lane.road.id===drop.id&&c.along>20),`${label}: both drivers clear the lane drop`);
 queue.dispose();dropGraph.dispose();
 console.log(`PASS ${label}: cars traverse all four merge lanes and yield safely at lane drops; streaming retains routes`);
}
for(const file of ['lane-layout.js','lane-paths.js','edges.js'])assert.equal(readFileSync(new URL('../../public/world/assets/'+file,import.meta.url),'utf8'),readFileSync(new URL('../../src/client/src/streets/'+file,import.meta.url),'utf8'));
