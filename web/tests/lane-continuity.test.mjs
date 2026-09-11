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

// Two wide branches leaving a split, as the Trans-Manhattan levels do: their
// decks partition the roadway along the gore and never lie over each other.
const wideTrunk=road(1101,[[0,60],[120,60]],{lanes:5,width:14.5});
const wideLeft=road(1102,[[120,60],[200,57],[280,51],[360,42]],{lanes:2,width:14.7});
const wideRight=road(1103,[[120,60],[200,63],[280,69],[360,78]],{lanes:2,width:14.7});
const wide=[wideTrunk,wideLeft,wideRight];
const wideMesh=await build(wide);
const inDeck=(mesh,id,x,z)=>roadDeckTriangles(mesh.decks,id).some(t=>triangleHeight(t,x,z)?.inside);
for(const r of [wideLeft,wideRight]){
 const layout=highwayLayout(r,wide),edges=deckEdges(r,wide,r.width/2),other=r===wideLeft?wideRight:wideLeft;
 for(let s=1;s<layout.length;s+=2)for(let i=0;i<r.lanes;i++){
  const [x,z]=edges.line(s,(i+.5-r.lanes/2)*layout.width);
  if(x>250)break; // the fixture tile ends at 256
  assert(inDeck(wideMesh,r.id,x,z),`lane ${i} of ${r.id} rides its own deck at ${s}`);
  assert(!inDeck(wideMesh,other.id,x,z),`lane ${i} of ${r.id} is never under the sibling deck at ${s}`);
 }
}
// The gore between the two envelopes is paved by one of them until they part.
const leftLayout=highwayLayout(wideLeft,wide),leftEdges=deckEdges(wideLeft,wide,wideLeft.width/2);
let flush=0;
for(let s=1;s<leftLayout.length;s+=2){
 const g=leftLayout.gap(s,1);if(!(g<2*(wideLeft.width/2-wideLeft.lanes*leftLayout.width/2)))break;
 const [x,z]=leftEdges.line(s,wideLeft.lanes*leftLayout.width/2+Math.max(0,g)/2);
 if(x>250)break;
 const inside=[[0,0],[.15,0],[-.15,0],[0,.15],[0,-.15]].some(([dx,dz])=>inDeck(wideMesh,wideLeft.id,x+dx,z+dz)||inDeck(wideMesh,wideRight.id,x+dx,z+dz));
 assert(inside,`gore is paved at ${s} (gap ${g.toFixed(2)})`);flush++;
}
assert(flush>20);
// The painted boundary sits on the deck that paints it, and only the left deck paints it while shared.
for(let s=1;s<leftLayout.length;s+=2){
 const rl=highwayLayout(wideRight,wide);
 if(leftLayout.gap(s,1)<.6)assert(rl.open(s,0)&&!leftLayout.open(s,1),`one line on a shared boundary at ${s}`);
 if(!leftLayout.open(s,1)){const [x,z]=leftEdges.line(s,wideLeft.lanes*leftLayout.width/2);if(x>250)break;assert(inDeck(wideMesh,wideLeft.id,x,z),`edge line on its own deck at ${s}`);}
}
console.log(`PASS wide fan siblings partition the roadway: ${flush} flush gore stations, no deck under another's lanes`);

// A trunk with fewer lanes than its branches share one: the option lane keeps
// the trunk's slot at the node, then widens as the branches part.
const optTrunk=road(1111,[[0,200],[120,200]],{lanes:4,width:14});
const optLeft=road(1112,[[120,200],[220,196],[320,188],[420,176]],{lanes:3,width:10});
const optRight=road(1113,[[120,200],[220,204],[320,212],[420,224]],{lanes:2,width:7});
const opt=[optTrunk,optLeft,optRight];
const leftLines=Array.from({length:4},(_,q)=>deckEdges(optLeft,opt,5).line(0,(q-1.5)*highwayLayout(optLeft,opt).width)[1]);
const rightLines=Array.from({length:3},(_,q)=>deckEdges(optRight,opt,3.5).line(0,(q-1)*highwayLayout(optRight,opt).width)[1]);
const trunkW=highwayLayout(optTrunk,opt).width;
for(const [lines,first] of [[leftLines,0],[rightLines,2]])lines.forEach((z,q)=>assert(Math.abs(z-(200+(first+q-2)*trunkW))<1e-6,'branch lines sit on the trunk slot boundaries at the node'));
assert(Math.abs(leftLines[3]-rightLines[1])<1e-6&&Math.abs(leftLines[2]-rightLines[0])<1e-6,'the shared lane is bounded by both branches');
const ol=highwayLayout(optLeft,opt),or=highwayLayout(optRight,opt);
assert(ol.open(0,1)&&or.open(0,0),'no edge line inside the shared lane at the node');
assert(Math.abs(ol.edge(0,1)-(ol.offset(0,3)-trunkW/2))<.35&&Math.abs(or.edge(0,0)-(or.offset(0,0)+trunkW/2))<.35,'decks meet through the middle of the shared lane');
const optMesh=await build(opt);
let opened=false;
for(let s=1;s<ol.length;s+=2){
 const [x,z]=deckEdges(optLeft,opt,5).line(s,(2.5-1.5)*ol.width);
 if(x<250)assert(!inDeck(optMesh,optRight.id,x,z),`option lane copies part without one deck covering the other at ${s}`);
 if(!ol.open(s,1)&&!or.open(s,0))opened=true;
}
assert(opened,'both edge lines appear once the option lane has widened into two');
console.log('PASS an option lane shared by both branches stays on its trunk slot and splits cleanly');

// A lane opening on a single carriageway widens the deck; it does not step out.
const oneLane=road(1121,[[0,240],[100,240]],{lanes:1,width:7.5});
const twoLanes=road(1122,[[100,240],[300,240]],{lanes:2,width:8.6});
const opening=[oneLane,twoLanes];
const [oneL,oneR]=deckEdges(oneLane,opening,3.75)(100),[twoL,twoR]=deckEdges(twoLanes,opening,4.3)(0);
assert(Math.hypot(oneL[0]-twoL[0],oneL[1]-twoL[1])<1e-6&&Math.hypot(oneR[0]-twoR[0],oneR[1]-twoR[1])<1e-6,'deck edges meet where a lane opens');
let widest=0;
for(let s=0;s<200;s+=4){const [l,r]=deckEdges(twoLanes,opening,4.3)(s);const w=r[1]-l[1];assert(w>=widest-1e-6,'the opened deck only widens');widest=w;}
assert(Math.abs(widest-8.6)<1e-6);
console.log('PASS lane additions taper the wider deck instead of stepping');
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
// Marking layout must not flatten overlapping approaches to make paint visible.
// A merge can contain distinct sloping surfaces before its shared endpoint.
const unmarked = real.map(r => ({...r, oneway: false}));
const profileEnv = roads => ({tile:{roads},ctx:{world:{roadsNear:()=>roads}}});
const paintedEnv = profileEnv(real), unmarkedEnv = profileEnv(unmarked);
for (const r of real) {
 if (r.tunnel || !['motorway','trunk'].includes(r.cls)) continue;
 const plain = unmarked.find(q => q.id === r.id);
 const a = clearanceProfile(paintedEnv,r,sandbox.nativeProfile);
 const b = clearanceProfile(unmarkedEnv,plain,sandbox.nativeProfile);
 const length = r.pts.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-r.pts[i][0],p[1]-r.pts[i][1]),0);
 for(let s=0;s<=length;s+=4)assert.equal(a.hAt(s),b.hAt(s),`marking eligibility changed road ${r.id}'s elevation`);
}
console.log('PASS motorway marking layout cannot change approach elevations');

// Every real junction in the loaded tiles: continuous edges through 1:1 seams,
// fan branches spanning exactly the trunk, and no sibling deck under another's lanes.
{
 const nodeKey=p=>`${Math.round(p[0]*2)},${Math.round(p[1]*2)}`,byNode=new Map();
 const length=r=>r.pts.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-r.pts[i][0],p[1]-r.pts[i][1]),0);
 for(const r of real){if(!isHighway(r)||r.pts.length<2)continue;for(const end of [0,1]){const k=nodeKey(end?r.pts.at(-1):r.pts[0]);byNode.set(k,[...(byNode.get(k)??[]),{r,end}]);}}
 let seams=0,fans=0;
 for(const members of byNode.values()){
  const ins=members.filter(m=>m.end),outs=members.filter(m=>!m.end);
  if(!ins.length||!outs.length||ins.length>1&&outs.length>1)continue;
  const dir=m=>{const p=m.end?m.r.pts.at(-1):m.r.pts[0],q=m.end?m.r.pts.at(-2):m.r.pts[1],d=Math.hypot(q[0]-p[0],q[1]-p[1]);return [(q[0]-p[0])/d*(m.end?-1:1),(q[1]-p[1])/d*(m.end?-1:1)];};
  const trunk=outs.length===1?outs[0]:ins[0],branches=outs.length===1?ins:outs,t=dir(trunk);
  if(branches.some(b=>{const d=dir(b);return d[0]*t[0]+d[1]*t[1]<.5;}))continue; // a hairpin is no continuation
  const ends=m=>deckEdges(m.r,real,Math.max(3.2,m.r.width/2))(m.end?length(m.r):0);
  const T=ends(trunk),B=branches.map(ends),d=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1]);
  assert(B.some(e=>d(e[0],T[0])<.05)&&B.some(e=>d(e[1],T[1])<.05),`branch decks span the trunk at ${trunk.r.id}`);
  if(branches.length===1){seams++;continue;}
  fans++;
  for(const a of branches)for(const b of branches){
   if(a===b)continue;
   const la=highwayLayout(a.r,real),ea=deckEdges(a.r,real,Math.max(3.2,a.r.width/2)),eb=deckEdges(b.r,real,Math.max(3.2,b.r.width/2)),lb=highwayLayout(b.r,real);
   for(let s=2;s<la.length;s+=4)for(let q=.5;q<la.count;q++){
    if(Math.min(la.gap(s,0),la.gap(s,1))<-.01)continue; // a lane both branches keep is split down its middle
    const p=ea.line(s,(q-la.count/2)*la.width);
    // the lane centre must not fall inside the sibling's deck polygon
    for(let sb=0;sb<lb.length;sb+=4){const [l,r]=eb(sb),[l2,r2]=eb(Math.min(lb.length,sb+4));
     const ring=[l,l2,r2,r];let inside=false;
     for(let i=0,j=3;i<4;j=i++){const A=ring[i],Bp=ring[j];if((A[1]>p[1])!==(Bp[1]>p[1])&&p[0]<(Bp[0]-A[0])*(p[1]-A[1])/(Bp[1]-A[1])+A[0])inside=!inside;}
     assert(!inside,`lane ${q-.5} of ${a.r.id} at ${s} lies under sibling ${b.r.id}`);
    }
   }
  }
 }
 assert(seams>=30&&fans>=8,`${seams} seams, ${fans} fans`);
 console.log(`PASS ${seams} real seams and ${fans} real fans keep continuous edges with no deck under a sibling's lanes`);
}
// Traffic lanes of the two Trans-Manhattan approaches stay a lane apart all the way to the merge.
{
 const a=cityRoads.get(42435675000),b=cityRoads.get(1504770029000);
 const la=highwayLayout(a,real),lb=highwayLayout(b,real);
 const pathA=[],pathB=[];
 for(let seg=0;seg<a.pts.length-1;seg++)pathA.push(...highwayLanePath(a,real,seg,(a.lanes-.5-a.lanes/2)*la.width).path);
 for(let seg=0;seg<b.pts.length-1;seg++)pathB.push(...highwayLanePath(b,real,seg,(.5-b.lanes/2)*lb.width).path);
 let nearest=Infinity;
 for(const p of pathA)for(const q of pathB)nearest=Math.min(nearest,Math.hypot(p.x-q.x,p.z-q.z));
 assert(nearest>2.9,`adjacent lanes of the two levels come within ${nearest.toFixed(2)} m`);
 console.log(`PASS the Trans-Manhattan upper and lower approaches keep their inner lanes ${nearest.toFixed(2)} m apart`);
}

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
