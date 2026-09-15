import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';
const rail=name=>new URL(`rail/${name}.js?v=${CLIENT_REVISION}`,assets);
const {route,routes,sample,services,timetable,trainState}=await import(rail('network'));
const {hubs,accessesByStation,stationPaths,functionalEntrance,accessSupport}=await import(rail('access'));
const {onPath,pathFloor}=await import(rail('access-plan'));
const {buildStation,buildTrack}=await import(rail('geometry'));
const {triangleHeight}=await import(new URL('supports.js',assets));
const {createStationUse,boardingDoor}=await import(rail('station-use'));
function heights(mesh,x,z) {
 const out=[];for(let i=0;i<mesh.index.length;i+=3){const tri=[0,1,2].map(j=>mesh.position.slice(mesh.index[i+j]*3,mesh.index[i+j]*3+3));const hit=triangleHeight(tri,x,z);if(hit?.inside)out.push(hit.height);}return out;
}
assert([...accessesByStation.values()].flat().length>1000);
for(const station of [route.stations[0],route.stations[11]]) {
 const access=accessesByStation.get(station.key)?.[0];if(!access)continue;
 assert(functionalEntrance(access.x,access.z));
 const mesh=buildStation(station,route).collision;
 const segments=[...route.segmentsByTile.values()].flat().filter(([a,b])=>a.s<station.s+110&&b.s>station.s-150),track=buildTrack(segments,[],route).collision;
 for(const path of [access.path,hubs.get(station.key).path])for(let s=.2;s<path.at(-1).s-.2;s+=.8) {
  const p=onPath(path,s),floor=pathFloor(path,p.x,p.z);
  assert(heights(mesh,p.x,p.z).some(y=>Math.abs(y-floor)<.025),`walkable access floor at ${station.name}, ${s}`);
  assert(!heights(mesh,p.x,p.z).some(y=>y>floor+.3&&y<floor+1.9),`adjoining access leaves headroom at ${station.name}, ${s}`);
  assert(!heights(track,p.x,p.z).some(y=>y>floor+.3&&y<floor+1.9),`track geometry leaves player headroom at ${station.name}, ${s}, floor=${floor}, hits=${heights(track,p.x,p.z)}, hub=${path===hubs.get(station.key).path}`);
  assert(Math.abs(accessSupport(station.key,p.x,p.z,floor+.1)-floor)<.18);
 }
}
console.log('PASS real entrance lookup and continuous collidable access to underground/elevated platforms');
const station=route.stations[0],service=services[0],schedule=timetable(service.path,1),arrival=schedule.phases.find(p=>p.station?.key===station.key);
let time=arrival.start+6;const item={key:'test-train',service,schedule,phase:0};
const local={state:{...sample(service.path,station.s+5.7,4.5),y:station.y+1.15},dead:false,vehicleKey:null};
const events=new Map();let respawns=0;
const ctx={state:{local,welcomed:true,screenshotMode:false},quality:{level:'mobile'},events:{on:(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);return()=>events.get(name).delete(fn);},emit:name=>{if(name==='localRespawn')respawns++;for(const fn of events.get(name)??[])fn();}}};
let ready=true;
const record={job:{route,station}};
const use=createStationUse(ctx,{clock:()=>time,stationRecords:()=>[record],visibleTrains:()=>[{item,state:trainState(schedule,time)}],readyStation:()=>ready});
assert(boardingDoor(item,trainState(schedule,time),local.state));
assert.equal(boardingDoor(item,{...trainState(schedule,time),doors:false},local.state),null);
assert.equal(boardingDoor(item,trainState(schedule,time),{...local.state,y:0}),null,'street above a platform cannot board');
ready=false;assert(!use.interact());ready=true;assert(use.interact());assert(use.riding);assert(use.controlsInteraction());
for(let i=0;i<180;i++){time+=.2;use.update(.2);use.carryPassenger(.2);}
assert(use.riding);assert(use.interact(),'request exit while moving');
let moved=false,previous=local.state.x;
for(let i=0;i<2000&&use.riding;i++){time+=.2;use.update(.2);use.carryPassenger(.2);if(Math.abs(local.state.x-previous)>.01)moved=true;previous=local.state.x;}
assert(moved);assert(!use.riding);assert(respawns>0);
assert(Math.abs(local.state.y-route.stations[1].y-1.15)<.01,'rider exits onto the next platform');
console.log('PASS doors-only boarding, level checks, moving train carry, queued exit and controller resynchronization');
const entry=accessesByStation.get(station.key)[0],start=entry.path[0];
const ped={x:start.x,y:start.y,z:start.z,gy:start.y,seed:4,state:'walk',baseSpeed:1.2,inst:{},lane:{}};
ctx.state.screenshotMode=true;
const manager={walkable:()=>true,grid:{move(){}}};let entered=false,waited=false,left=false,lowest=Infinity;
for(let i=0;i<12000;i++) {
 use.update(.1);const claimed=use.updatePed(ped,.1,manager);
 entered ||= !!ped.stationVisit;waited ||= use.stats.waiting>0;lowest=Math.min(lowest,ped.gy);
 if(entered&&!ped.stationVisit){left=true;break;}
}
assert(entered&&waited&&left,'NPC walks in, waits, and returns to its sidewalk route');
assert(Math.abs(lowest-(station.y+1.15))<.2);assert(Math.hypot(ped.x-start.x,ped.z-start.z)<.2);assert.equal(use.stats.visitors,0);
// A returning visitor must pass a later arrival in the same narrow stairwell.
const crowd=[4,8].map(seed=>({...ped,x:start.x,z:start.z,gy:start.y,seed,inst:{}})),finished=new Set(),started=new Set();
for(let i=0;i<16000&&finished.size<crowd.length;i++) {
 use.update(.1);
 for(let j=0;j<crowd.length;j++) {
  if((j===1&&i<180)||finished.has(j))continue;
  use.updatePed(crowd[j],.1,manager);
  if(crowd[j].stationVisit)started.add(j);
  else if(started.has(j))finished.add(j);
 }
}
assert.equal(finished.size,2,'opposing visitors pass each other and both return to the street');
const interrupted={...ped,x:start.x,z:start.z,gy:start.y,seed:12,inst:{}};
assert(use.updatePed(interrupted,.1,manager));ready=false;
assert(!use.updatePed(interrupted,.1,manager));assert(!interrupted.stationVisit);
assert(Math.hypot(interrupted.x-start.x,interrupted.z-start.z)<.01,'unloaded station returns its visitor to a valid sidewalk');ready=true;
use.dispose();assert([...events.values()].every(set=>!set.size));
const commuter=routes.find(r=>r.id==='metro-north-park-avenue'),harlem=commuter.stations.find(s=>s.name==='Harlem-125 St');
const stair=commuter.entrances.find(e=>e.station===harlem),street=sample(commuter,stair.street,stair.offset);
const visitor={...ped,x:street.x,z:street.z,gy:.16,seed:4,inst:{}};
const commuterUse=createStationUse(ctx,{clock:()=>time,stationRecords:()=>[{job:{route:commuter,station:harlem}}],visibleTrains:()=>[],readyStation:()=>true});
let reached=false,returned=false;
for(let i=0;i<6000;i++) {
 commuterUse.update(.1);commuterUse.updatePed(visitor,.1,manager);
 reached ||= visitor.gy>harlem.y;
 if(reached&&!visitor.stationVisit){returned=true;break;}
}
assert(reached&&returned,'NPCs also visit Harlem–125th through its elevated station stairs');commuterUse.dispose();
const character=readFileSync(new URL('character-O1u3Gxpp.js',assets),'utf8');
assert(character.includes('updatePed(t,e,this)'));assert(character.includes('!r.stationVisit'));assert(character.includes('carryPassenger(e)'));assert(character.includes('y+.9'));
const props=readFileSync(new URL('props-coU--UuE.js',assets),'utf8');assert(props.includes('$functionalEntrance(l.x,l.z)'));
assert(props.includes('|Entrance closed|Use another entrance'),'closed entrances use the atlas title fields, not route badges');
console.log('PASS existing NPC crowd visits, waiting, street return, cleanup and served interaction hooks');
