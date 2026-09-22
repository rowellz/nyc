import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { CLIENT_REVISION } from '../src/lib/server/client-cache.js';
import { sceneFrameClock } from './scene-frame-clock.mjs';

for(const name of ['geometry','runtime']) {
  const source=readFileSync(new URL(`../static/world/assets/rail/${name}.js`,import.meta.url),'utf8');
  assert(source.includes(`textureRelease-2U-gT89r.js?v=${CLIENT_REVISION}`),'rail shares the served Three instance');
}

const network = await import(new URL(`rail/network.js?v=${CLIENT_REVISION}`, assets));
const { route, sample, segmentsByTile, entrances, timetable, trainState, TRAIN_LENGTH, holesForTile } = network;
const { buildTrack, buildStation, stairHeight } = await import(new URL(`rail/geometry.js?v=${CLIENT_REVISION}`, assets));
const { cutSurface } = await import(new URL(`rail/cuts.js?v=${CLIENT_REVISION}`, assets));
const { triangleHeight } = await import(new URL('supports.js', assets));
const { syncTunnelTerrain } = await import(new URL('tunnels.js', assets));
const { installRail } = await import(new URL(`rail/runtime.js?v=${CLIENT_REVISION}`, assets));
const {hubs,platformHub,platformOpening,accessesByStation}=await import(new URL(`rail/access.js?v=${CLIENT_REVISION}`,assets));
const {pathFloor,onPath}=await import(new URL(`rail/access-plan.js?v=${CLIENT_REVISION}`,assets));
const { Z: Group, Or: Vector3 } = await import(new URL('textureRelease-2U-gT89r.js', assets));

assert.equal(route.stations.length, 13);
assert(route.length > 8000);
for (let s=0; s<route.length; s+=0.5) {
  const grade=Math.max(.06,...(route.portalGrades??[]).map(cap=>cap.grade));
  assert(Math.abs(route.height(s+0.5)-route.height(s))/0.5 <= grade+.00001, 'bounded continuous grades');
}
for (const stop of route.stations) {
  assert(Math.hypot(sample(route,stop.s).x-stop.x,sample(route,stop.s).z-stop.z)<0.01);
  assert.equal(route.height(stop.s-60),stop.y);
  assert.equal(route.height(stop.s+60),stop.y);
}
let count=0;
for(const segments of segmentsByTile.values()) for(const [a,b] of segments) {
  count++;
  assert.equal(sample(route,a.s).y,a.y);
  assert.equal(sample(route,b.s).y,b.y);
}
assert.equal(count,route.points.length-1,'each path segment has exactly one stable owner');
console.log('PASS rail route: 13 level stations, continuous grades and tile seams');

for(const direction of [-1,1]) {
  const schedule=timetable(route,direction);
  for(const phase of schedule.phases) {
    const end=trainState(schedule,phase.end-1e-7),next=trainState(schedule,phase.end+1e-7);
    if(phase.end<schedule.duration) assert(Math.abs(end.s-next.s)<1e-4,'no jumps at arrival/departure');
    if(phase.station) {
      const state=trainState(schedule,phase.start+5);
      assert.equal(state.speed,0);assert(state.doors);assert.equal(state.s,phase.station.s);
      assert(TRAIN_LENGTH < network.PLATFORM_LENGTH);
    }
  }
  // Spacing on both tracks remains larger than a consist, even at stations.
  const services=Math.floor(schedule.duration/150),gap=schedule.duration/services;
  for(let t=0;t<schedule.duration;t+=1) {
    const trains=Array.from({length:services},(_,i)=>trainState(schedule,t+i*gap).s).sort((a,b)=>a-b);
    for(let i=1;i<trains.length;i++)assert(trains[i]-trains[i-1]>TRAIN_LENGTH+10);
  }
}
console.log('PASS trains: braking, dwell, doors and safe spacing in both directions');

function covered(position,index,x,z,expected) {
  for(let i=0;i<index.length;i+=3) {
    const tri=[0,1,2].map(j=>Array.from(position.slice(index[i+j]*3,index[i+j]*3+3)));
    const hit=triangleHeight(tri,x,z);
    if(hit?.inside&&Math.abs(hit.height-expected)<0.025)return true;
  }
  return false;
}
for(const station of [route.stations[0],route.stations[11]]) {
  const stationMesh=buildStation(station).collision;
  for(const e of entrances.filter(e=>e.station===station))for(let s=e.start+.15;s<e.end;s+=.25) {
    const p=sample(route,s,e.offset);
    assert(covered(stationMesh.position,stationMesh.index,p.x,p.z,stairHeight(e,s)),'walkable stair treads');
  }
  const segments=[...segmentsByTile.values()].flat().filter(([a,b])=>a.s<station.s+65&&b.s>station.s-65);
  const track=buildTrack(segments).collision;
  for(const side of [-1,1])for(let s=station.s-58;s<station.s+58;s+=2) {
    const p=sample(route,s,side*6);
    const hub=platformHub(station,side*6.4),opening=platformOpening(station,s,side*6.4);
    const mesh=opening?stationMesh:track,height=opening?pathFloor(hub.path,p.x,p.z):station.y+1.15;
    assert(covered(mesh.position,mesh.index,p.x,p.z,height),'platform or access stairs have collision');
  }
}
console.log('PASS elevated and underground station platforms and stairs have matching collision');

// The same pier planner as motorways keeps the street below the railway clear.
{
  const station=route.stations[11],a=sample(route,station.s-80),b=sample(route,station.s+80);
  const road={id:991,cls:'primary',width:14,pts:[[a.x,a.z],[b.x,b.z]],bridge:false,tunnel:false,layer:0};
  const segments=[...segmentsByTile.values()].flat().filter(([a,b])=>a.s<station.s+60&&b.s>station.s-60);
  const built=buildTrack(segments,[road]);
  for(const layer of built.layers.values())for(let i=0;i<layer.position.length;i+=24) {
    const vertices=Array.from({length:8},(_,j)=>layer.position.slice(i+j*3,i+j*3+3));
    if(Math.min(...vertices.map(v=>v[1]))>.05)continue;
    const x=vertices.reduce((s,v)=>s+v[0],0)/8,z=vertices.reduce((s,v)=>s+v[2],0)/8;
    const distance=Math.abs((z-a.z)*(b.x-a.x)-(x-a.x)*(b.z-a.z))/Math.hypot(b.x-a.x,b.z-a.z);
    assert(distance>8,'rail support clears the lower carriageway');
  }
}
console.log('PASS elevated rail piers span lower road lanes');

// Cut actual packed surfaces while preserving independent decks above portals.
const hole=[[-2,-2],[2,-2],[2,2],[-2,2]];
const attributes={position:{array:Float32Array.from([-4,0,-4,4,0,-4,4,0,4,-4,0,4,-4,8,-4,4,8,-4,4,8,4,-4,8,4]),itemSize:3},
  uv:{array:new Float32Array(16),itemSize:2}};
const cut=cutSurface(attributes,[0,2,1,0,3,2,4,6,5,4,7,6],[hole]);
assert(!covered(cut.attributes.position.array,cut.index,0,0,0));
assert(covered(cut.attributes.position.array,cut.index,0,0,8));
assert.equal(cut.attributes.uv.array.length,cut.attributes.position.array.length/3*2);
const raised={position:{array:Float32Array.from([-4,.5,-4,4,.5,-4,4,.5,4,-4,.5,4]),itemSize:3}};
const raisedCut=cutSurface(raised,[0,2,1,0,3,2],[hole]);
assert(!covered(raisedCut.attributes.position.array,raisedCut.index,0,0,.5),'raised paving is cut too');

// Execute the served worker with its real imports, against a stairwell tile.
const p=onPath(accessesByStation.get(route.stations[0].key)[0].path,3);
const tx=Math.floor(p.x/256),tz=Math.floor(p.z/256);
const tile={key:`${tx}_${tz}`,tx,tz,roads:[],buildings:[],roadbeds:[],sidewalks:[],medians:[],parks:[],water:[],parking:[],plazas:[],crossings:[],trees:[],props:[],groundElev:0};
tile.roads.push({id:990001,cls:'residential',pts:[[p.x-35,p.z],[p.x+35,p.z]],width:8,lanes:2,layer:0,bridge:false,tunnel:false});
assert(holesForTile(tile).length);
let response;
const scope={console,performance,self:{postMessage:r=>{response=r;}}};
const worker=readFileSync(new URL('tile.worker-Ai2ZdmRL.js',assets),'utf8');
for(const match of worker.matchAll(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?$/gm)) {
  const module=await import(new URL(match[2],assets));
  for(const binding of match[1].split(',')) {const [name,alias=name]=binding.trim().split(/\s+as\s+/);scope[alias]=module[name];}
}
vm.createContext(scope);vm.runInContext(worker.replace(/^import .*$/gm,''),scope);
await scope.self.onmessage({data:{id:1,input:{tile,roads:tile.roads,pedestrianTiles:[tile],quality:{level:'mobile',shadows:false}}}});
assert(!response.error,response.error);
assert(response.built.meshes.some(mesh=>mesh?.index.length),'fixture contains real rendered streets');
for(const mesh of response.built.meshes.filter(Boolean)) {
  assert(!covered(mesh.attributes.position.data,mesh.index,p.x,p.z,0.025));
}
console.log('PASS rail openings cut served worker surfaces and retain overhead decks');

// Use real Three geometry with a tiny DOM/physics fixture for repeated streaming.
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({}, {get:()=>()=>{}})})};
const listeners=new Map(),colliders=new Set();let sequence=0;
const ctx={worldGroup:new Group(),camera:{position:new Vector3(p.x,0,p.z)},scene:new Group(),
  modules:new Map(),world:{tiles:new Map()},quality:{level:'mobile',drawDistance:512},state:{serverTime:()=>700},
  events:{on:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name);}},
  physics:{ready:true,groundHeight:()=>0,world:{createCollider:()=>({id:++sequence})},
    RAPIER:{ColliderDesc:{trimesh:()=>({setFriction(){return this;}})}},
    addTileColliders:key=>colliders.add(key),removeTileColliders:key=>colliders.delete(key),loadLand:()=>{}}};
const originalHeight=ctx.physics.groundHeight,api=installRail(ctx);
const frameClock=sceneFrameClock();
const main=readFileSync(new URL('main-D_3aygO4.js',assets),'utf8');
const guardSource=main.match(/var ql=(class\{[\s\S]*?t\.updateMatrixWorld\(\)\}\})/)[1];
const Guard=vm.runInNewContext(`(${guardSource})`,{M:Vector3,Ue:new Group().quaternion.constructor});
// Reproduce the served street module taking ownership of the height sampler.
const streets=readFileSync(new URL('streets-CfYSUqyW.js',assets),'utf8');
const heightHook=streets.match(/let F=e\.physics\.groundHeight,L=([\s\S]+?);e\.physics\.groundHeight=L;/);
assert(heightHook,'street module height hook remains discoverable');
const streetHeight=vm.runInNewContext(`(${heightHook[1]})`,{e:ctx,F:ctx.physics.groundHeight,P:()=>0,$tunnelSupport:(_w,_x,_z,_y,fallback)=>fallback});
for(let run=0;run<3;run++)for(const station of [route.stations[0],route.stations[11]]) {
  const tx=Math.floor(station.x/256),tz=Math.floor(station.z/256);
  ctx.world.tiles.clear();ctx.camera.position.set(station.x,station.y+3,station.z);
  for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)ctx.world.tiles.set(`${tx+x}_${tz+z}`,{tx:tx+x,tz:tz+z,key:`${tx+x}_${tz+z}`,roads:[]});
  listeners.get('tileLoaded')();
  for(let i=0;i<5000&&!api.readyForInput();i++){api.update(1/60);frameClock.frame();}
  assert(api.readyForInput());assert(api.stats.stations>0);assert(api.stats.trains<=4);
  const floor=sample(route,station.s,6);
  assert.equal(ctx.physics.groundHeight(floor.x,floor.z,station.y+1.15),station.y+1.15);
  assert.equal(streetHeight(floor.x,floor.z,station.y+1.15),station.y+1.15,'street installation preserves rail support');
  assert.equal(ctx.physics.groundHeight(floor.x,floor.z,0),0,'street travel retains its height');
  const camera=new Group();camera.position.set(floor.x,station.y+2.75,floor.z);camera.near=.1;
  const state={welcomed:true,screenshotMode:false,local:{state:{x:floor.x,y:station.y+1.15,z:floor.z},dead:false,fallPending:false}};
  let reports=0;
  const guardContext={...ctx,camera,state,net:{sendState:()=>reports++}};
  new Guard().update(guardContext);
  assert.equal(camera.position.y,station.y+2.75,'camera can follow a player underground');
  assert.equal(reports,0);assert(!state.local.fallPending,'standing underground is not a fatal fall');
  state.screenshotMode=true;camera.position.y=-9.2;new Guard().update(guardContext);
  assert.equal(camera.position.y,-9.2,'underground launcher viewpoint is preserved');
  state.screenshotMode=false;state.local.state.x=100000;state.local.state.y=-10;new Guard().update(guardContext);
  assert(state.local.fallPending);assert.equal(reports,1,'unsupported falls retain the original guard');
  syncTunnelTerrain(ctx);
  ctx.world.tiles.clear();listeners.get('tileUnloaded')();api.update(1/60);
  assert.equal(api.stats.trackTiles,0);assert.equal(api.stats.stations,0);assert.equal(api.stats.trains,0);assert.equal(colliders.size,0);
}
api.dispose();assert.equal(ctx.worldGroup.children.length,0);assert.equal(listeners.size,0);
assert.equal(ctx.physics.groundHeight,originalHeight);
assert(!ctx.modules.has('rail'));
delete globalThis.document;
frameClock.restore();
console.log('PASS repeated tile arrival/removal, level-aware support and complete rail disposal');
