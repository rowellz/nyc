import assert from 'node:assert/strict';
import { sceneFrameClock } from './scene-frame-clock.mjs';
import { readFileSync } from 'node:fs';
import { assets } from './sveltekit-assets.mjs';
import { CLIENT_REVISION, versionClientImports } from '../src/lib/server/client-cache.js';

const rail=name=>new URL(`rail/${name}.js?v=${CLIENT_REVISION}`,assets);
const {route,parkAvenue,hudson,harlem,authoredRoutes:routes,services:allServices,sample,layout,timetable,trainState,TRAIN_LENGTH,holesForTile}=await import(rail('network'));
const services=allServices.slice(0,3);
const {buildTrack,buildStation,stairHeight}=await import(rail('geometry'));
const {triangleHeight}=await import(new URL('supports.js',assets));
const {installRail}=await import(rail('runtime'));
const {hubs,platformOpening}=await import(rail('access'));
const {pathFloor}=await import(rail('access-plan'));
const {Z:Group,Or:Vector3}=await import(new URL(`textureRelease-2U-gT89r.js?v=${CLIENT_REVISION}`,assets));

const harlem125=parkAvenue.stations.find(s=>s.name==='Harlem-125 St');
assert(harlem125);
assert.equal(harlem125.source.lon,-73.939149);assert.equal(harlem125.source.lat,40.805157);
assert.equal(harlem125.y,8);assert.equal(parkAvenue.stations[0].y,-14);
assert(Math.hypot(harlem125.x-route.stations[11].x,harlem125.z-route.stations[11].z)>1500,'the Park Avenue and Broadway 125th Street stations are distinct');
assert.equal(routes.flatMap(r=>r.stations).length,22);
assert.equal(new Set(routes.flatMap(r=>r.stations.map(s=>s.key))).size,22);
assert.deepEqual(layout(parkAvenue).tracks,[-9,-3,3,9]);
assert.equal(layout(parkAvenue).platforms.length,2);
assert(hudson.stations.some(s=>s.name==='Spuyten Duyvil'));
assert(harlem.stations.some(s=>s.name==='Melrose'));

for(const r of [parkAvenue,hudson,harlem]) {
  assert(r.points.length>500);
  for(let s=0;s<r.length;s+=.5)assert(Math.abs(r.height(s+.5)-r.height(s))/.5<=.06001);
  for(const station of r.stations)for(let ds=-99;ds<=99;ds+=3)assert.equal(r.height(station.s+ds),station.y,'stations stay level');
  assert.equal([...r.segmentsByTile.values()].reduce((n,parts)=>n+parts.length,0),r.points.length-1,'one owner for each physical segment');
}
for(const branch of [hudson,harlem])for(const offset of branch.tracks) {
  const end=sample(parkAvenue,parkAvenue.length,offset),start=sample(branch,0,offset);
  assert(Math.hypot(end.x-start.x,end.z-start.z,end.y-start.y)<1e-6,'track positions agree across the shared trunk junction');
}
for(const service of services.slice(1)) {
  for(const direction of [-1,1]) {
    const schedule=timetable(service.path,direction);
    assert.equal(schedule.phases.filter(p=>p.station?.name==='Harlem-125 St').length,1);
    for(const phase of schedule.phases)if(phase.station) {
      const state=trainState(schedule,phase.start+5);
      assert.equal(state.speed,0);assert(state.doors);
    }
  }
  const seam=parkAvenue.length;
  const a=sample(service.path,seam-.01,service.tracks[1]),b=sample(service.path,seam+.01,service.tracks[1]);
  assert(Math.hypot(a.x-b.x,a.z-b.z,a.y-b.y)<.1,'a moving carriage crosses the route junction continuously');
}
console.log('PASS MTA station locations, four-track Park Avenue trunk, two branches, continuous grades and train paths');

function hits(mesh,x,z) {
  const heights=[];
  for(let i=0;i<mesh.index.length;i+=3) {
    const tri=[0,1,2].map(j=>mesh.position.slice(mesh.index[i+j]*3,mesh.index[i+j]*3+3));
    const hit=triangleHeight(tri,x,z);if(hit?.inside)heights.push(hit.height);
  }
  return heights;
}
for(const [r,station] of [[parkAvenue,harlem125],[parkAvenue,parkAvenue.stations[0]],[harlem,harlem.stations[0]]]) {
  const segments=[...r.segmentsByTile.values()].flat().filter(([a,b])=>a.s<station.s+105&&b.s>station.s-140);
  const track=buildTrack(segments,[],r).collision,stairs=buildStation(station,r).collision;
  for(const platform of layout(r).platforms)for(let ds=-97;ds<=97;ds+=7) {
    const p=sample(r,station.s+ds,platform.offset+.8);
    const main=hubs.get(station.key),hub=[main,...(main?.branches??[])].find(h=>h?.offset===platform.offset),opening=platformOpening(station,station.s+ds,platform.offset);
    const floor=opening?pathFloor(hub.path,p.x,p.z):station.y+1.15;
    assert(hits(opening?stairs:track,p.x,p.z).some(h=>Math.abs(h-floor)<.025),'both island platforms and their access stairs are walkable');
  }
  for(const e of r.entrances.filter(e=>e.station===station))for(let s=e.start+.1;s<e.end;s+=.7) {
    const p=sample(r,s,e.offset),height=stairHeight(e,s);
    assert(hits(stairs,p.x,p.z).some(h=>Math.abs(h-height)<.025));
    assert(!hits(track,p.x,p.z).some(h=>h>height+.1&&h<height+2.1),'the track slab and tunnel roof leave headroom over the access stair');
  }
}
const portalPoint=parkAvenue.points.find(p=>p.y>-.1&&p.y<.1);
assert(portalPoint);
assert(holesForTile({tx:Math.floor(portalPoint.x/256),tz:Math.floor(portalPoint.z/256)}).length);
console.log('PASS Harlem–125th, Grand Central and Melrose platform/stair collision and portal openings');

globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>new Proxy({}, {get:()=>()=>{}})})};
const colliders=new Set(),listeners=new Map();
const ctx={worldGroup:new Group(),camera:{position:new Vector3()},scene:new Group(),modules:new Map(),world:{tiles:new Map()},
  quality:{level:'mobile',drawDistance:900},state:{serverTime:()=>0},events:{on:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name);}},
  physics:{ready:true,groundHeight:()=>0,world:{createCollider:()=>({})},RAPIER:{ColliderDesc:{trimesh:()=>({setFriction(){return this;}})}},
    addTileColliders:key=>{assert(!colliders.has(key));colliders.add(key);},removeTileColliders:key=>colliders.delete(key)}};
const api=installRail(ctx);
const frameClock=sceneFrameClock();
function visit(station) {
  const tx=Math.floor(station.x/256),tz=Math.floor(station.z/256);
  ctx.camera.position.set(station.x,station.y+3,station.z);ctx.world.tiles.clear();
  for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)ctx.world.tiles.set(`${tx+x}_${tz+z}`,{tx:tx+x,tz:tz+z,roads:[]});
  listeners.get('tileLoaded')();for(let i=0;i<5000&&!api.readyForInput();i++){api.update(1/60);frameClock.frame();}
  assert(api.readyForInput());assert(api.stats.trains<=4);
}
for(let i=0;i<2;i++)for(const station of [harlem125,parkAvenue.stations[0],hudson.stations[0],harlem.stations[0],route.stations[0]]) {
  visit(station);
  assert(api.stats.corridors.includes(station.routeId));
  assert.equal(ctx.worldGroup.children.length,1,'one rail module owns all services');
  if(station===harlem125) {
    assert.equal(api.root.children.filter(g=>g.name===`rail:station:${station.key}`).length,1,'Hudson and Harlem services share the same physical station');
    for(const offset of [-6,6]) {
      const p=sample(parkAvenue,station.s+30,offset);
      assert.equal(api.support(p.x,p.z,9.15,NaN),9.15);
    }
    const path=services[1].path,schedule=timetable(path,1),arrival=schedule.phases.find(p=>p.station?.key===station.key);
    ctx.state.serverTime=()=>arrival.start+5;api.update(.1);
    assert(api.stats.trains>0,'Metro-North trains render at the Park Avenue stop');
  }
  ctx.world.tiles.clear();listeners.get('tileUnloaded')();api.update(.1);
  assert.equal(api.stats.trackTiles,0);assert.equal(api.stats.stations,0);assert.equal(api.stats.trains,0);assert.equal(colliders.size,0);
}
api.dispose();delete globalThis.document;
frameClock.restore();
assert.equal(ctx.worldGroup.children.length,0);assert.equal(listeners.size,0);
const main=readFileSync(new URL('main-D_3aygO4.js',assets),'utf8');
assert(main.includes(`./rail/runtime.js?v=${CLIENT_REVISION}`));
assert(versionClientImports("import './rail/cuts.js';").includes(`cuts.js?v=${CLIENT_REVISION}`));
console.log('PASS multi-line streaming, shared-station ownership, global train budget, cleanup and cache refresh');
