import assert from 'node:assert/strict';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';
import {sceneFrameClock} from './scene-frame-clock.mjs';
import {createRailBudget,railBounds} from '../static/world/assets/rail/mobile-budget.js';
const camera={x:0,y:2,z:0},ctx={camera:{position:camera},world:{ios:true},quality:{level:'mobile'}};
const track=(id,y,x=0)=>({id,bounds:railBounds([{x,y,z:0},{x:x+40,y,z:0}],4),buried:y<-6});
const hidden=track('buried',-12),surface=track('surface',0),elevated=track('elevated',10);
let select=createRailBudget(ctx,[]);
assert(!select([hidden],new Set()).has('buried'),'buried corridors do not load from the surface tile halo');
assert.equal(select([surface,elevated],new Set()).size,2,'surface and elevated tracks remain');
camera.y=-10;assert(select([hidden],new Set()).has('buried'),'descending enables underground travel');
camera.y=2;
select=createRailBudget(ctx,[[[-1,-1],[1,-1],[1,1],[-1,1]]]);
assert(select([hidden],new Set()).has('buried'),'nearby entrance preloads rail before descent');
camera.x=75;assert(!select([hidden],new Set()).has('buried'));
assert(select([hidden],new Set(['buried'])).has('buried'),'entrance hysteresis avoids rebuilding on boundary motion');
camera.x=0;camera.y=200;assert(!select([hidden],new Set()).has('buried'),'flying overhead does not load underground detail');
camera.y=-10;
const tracks=Array.from({length:80},(_,i)=>track(`track${i}`,-12,i));
const stations=Array.from({length:10},(_,i)=>({...track(`station${i}`,-12,i),station:{}}));
const admitted=select([...tracks,...stations],new Set());
assert.equal([...admitted].filter(id=>id.startsWith('track')).length,32);
assert.equal([...admitted].filter(id=>id.startsWith('station')).length,4);
ctx.quality.level='high';assert.equal(createRailBudget(ctx,[])([...tracks,...stations],new Set()).size,90,'desktop retains full residency');

const {buildTrack,materials,trainModel}=await import(new URL('rail/geometry.js',assets));
const {route,sample,TRAIN_CARS,trainState,timetable}=await import(new URL('rail/network.js',assets));
const three=await import(new URL('textureRelease-2U-gT89r.js',assets));
const segments=[[sample(route,1000),sample(route,1050)]];
const original=buildTrack(segments,[],route),mobile=buildTrack(segments,[],route,true);
assert.deepEqual(mobile.collision,original.collision,'mobile track topology retains all walkable surfaces');
const before=original.layers.get('sleeper'),after=mobile.layers.get('sleeper');
assert.equal(after.index.length*6,before.index.length,'one visible face replaces six-sided noncolliding ties');
for(let i=0;i<after.index.length;i+=3) {
  const [a,b,c]=after.index.slice(i,i+3).map(j=>after.position.slice(j*3,j*3+3));
  assert((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0,'sleepers face up');
}
const mats=materials();
// Cancelling after a mesh buffer is allocated must dispose that unpublished
// geometry; no scene traversal can find it yet.
const {g:QueueGeometry}=await import(new URL(`textureRelease-2U-gT89r.js?v=${CLIENT_REVISION}`,assets));
const disposeGeometry=QueueGeometry.prototype.dispose;
let cancelledBuffers=0;
try {
  QueueGeometry.prototype.dispose=function(){cancelledBuffers++;return disposeGeometry.call(this);};
  const upload=mobile.buildSteps(mats);
  assert.equal(upload.next().done,false);
  upload.return();
  assert.equal(cancelledBuffers,1);
} finally {QueueGeometry.prototype.dispose=disposeGeometry;}
for(const kind of ['subway','commuter']) {
  const legacy=trainModel(mats,kind),batched=trainModel(mats,kind,true);
  const old=legacy.create(),fresh=batched.create(),schedule=timetable(route,1);
  let instanceDisposals=0,geometryDisposals=0;
  fresh.batches.forEach(({mesh})=>{mesh.addEventListener('dispose',()=>instanceDisposals++);mesh.geometry.addEventListener('dispose',()=>geometryDisposals++);});
  for(const [distance,doors,direction,side] of [[1000,false,1,1],[1010,true,1,1],[1200,true,-1,-1]]) {
    const state={...trainState(schedule,0),s:distance,doors};
    legacy.place(old,state,direction,1/30,route,2,side);
    batched.place(fresh,state,direction,1/30,route,2,side);
    old.root.updateMatrixWorld(true);fresh.root.updateMatrixWorld(true);
    for(const {mesh,part} of fresh.batches) for(let i=0;i<TRAIN_CARS;i++) {
      const matrix=new three.Ot();mesh.getMatrixAt(i,matrix);
      const expected=part ? old.cars[i].panels[part-1].matrixWorld : old.cars[i].car.matrixWorld;
      matrix.elements.forEach((v,j)=>assert(Math.abs(v-expected.elements[j])<.0003,'instancing preserves curved/graded car and door placement'));
      const point=new three.Or().setFromMatrixPosition(matrix);
      assert(mesh.boundingSphere.containsPoint(point),'moving train keeps conservative culling bounds');
    }
  }
  let draws=0;old.root.traverse(o=>{if(o.isMesh)draws++;});
  assert.equal(fresh.batches.length*TRAIN_CARS,draws);
  fresh.dispose();assert.equal(instanceDisposals,fresh.batches.length);assert.equal(geometryDisposals,0,'unloading train keeps shared geometry alive');
  old.dispose();legacy.dispose();batched.dispose();assert(geometryDisposals>0,'module disposal releases templates');
  console.log(`PASS ${kind} train batching: ${draws} -> ${fresh.batches.length} draws; door transforms, bounds and buffer disposal`);
}
Object.values(mats).forEach(m=>m.dispose());
console.log('PASS mobile rail budgets, entrance/height hysteresis, desktop preservation and sleeper geometry');

// Walk the actual mobile residency policy along connected station entrances.
const {installRail}=await import(new URL('rail/runtime.js',assets));
const {accessesByStation,entranceDestinations}=await import(new URL('rail/access.js',assets));
const {onPath}=await import(new URL('rail/access-plan.js',assets));
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({}, {get:()=>()=>{}})})};
const listeners=new Map(),colliders=new Set();
const runtimeCtx={worldGroup:new three.Z(),camera:{position:new three.Or()},modules:new Map(),scene:new three.Z(),
  world:{ios:true,tiles:new Map()},quality:{level:'mobile',drawDistance:256},state:{serverTime:()=>700},
  events:{on:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name)}},
  physics:{ready:true,groundHeight:()=>0,world:{createCollider:()=>({})},RAPIER:{ColliderDesc:{trimesh:()=>({setFriction(){return this}})}},
    addTileColliders:key=>colliders.add(key),removeTileColliders:key=>colliders.delete(key)}};
const api=installRail(runtimeCtx);
const frameClock=sceneFrameClock(),frame=()=>frameClock.frame();
// A chunk event and update only enqueue work. Other scene jobs share the same
// queue, and retiring a tile cancels construction before anything is published.
const {t:buildScope}=await import(new URL(`loading-DS_gLujL.js?v=${CLIENT_REVISION}`,assets));
const station=route.stations[1],tx=Math.floor(station.x/256),tz=Math.floor(station.z/256);
runtimeCtx.camera.position.set(station.x,station.y+1.7,station.z);
runtimeCtx.world.tiles.set(`${tx}_${tz}`,{tx,tz,roads:[]});listeners.get('tileLoaded')();
api.update(1/30);
assert.equal(colliders.size,0,'mobile rail does not build synchronously in the frame loop');
assert.equal(runtimeCtx.busy,1);
let otherRan=false;
buildScope(runtimeCtx).job('other scene work').run((function*(){otherRan=true;})());
frame();assert(otherRan,'rail yields to another scene builder');
assert.equal(colliders.size,0,'dense rail construction spans frames');
runtimeCtx.world.tiles.clear();listeners.get('tileUnloaded')();frame();
assert.equal(runtimeCtx.busy,0,'retirement releases the active build exactly once');
assert.equal(colliders.size,0,'retired rail cannot publish late');
assert(api.readyForInput());
for(const station of [route.stations[1],route.stations[5],route.stations[11]]) {
  const entry=accessesByStation.get(station.key)?.[0];assert(entry);
  const destination=entranceDestinations(entry).find(d=>d.stationKey===station.key);assert(destination);
  const path=destination.path;
  for(const fraction of [0,.25,.5,.75,1,.5,0]) {
    const point=onPath(path,path.at(-1).s*fraction);runtimeCtx.camera.position.set(point.x,point.y+1.7,point.z);
    const tx=Math.floor(point.x/256),tz=Math.floor(point.z/256);runtimeCtx.world.tiles.clear();
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)runtimeCtx.world.tiles.set(`${tx+dx}_${tz+dz}`,{tx:tx+dx,tz:tz+dz,roads:[]});
    listeners.get('tileLoaded')();
    for(let i=0;i<5000&&!api.readyForInput();i++){api.update(1/30);frame();}
    assert(api.readyForInput());assert(api.stats.trackTiles<=32&&api.stats.stations<=4);
    if(fraction>0&&fraction<1)assert(Math.abs(api.support(point.x,point.z,point.y,NaN)-point.y)<.05,`mobile approach keeps ${station.name} stairs available at ${fraction}`);
  }
}
api.dispose();assert.equal(colliders.size,0);assert.equal(runtimeCtx.worldGroup.children.length,0);
assert.equal(runtimeCtx.busy,0);
frameClock.restore();
delete globalThis.document;
console.log('PASS iPhone station approach/descent/return: budgeted runtime retains underground and elevated stair support');
