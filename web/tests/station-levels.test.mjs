import assert from 'node:assert/strict';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';
const rail=name=>new URL(`rail/${name}.js?v=${CLIENT_REVISION}`,assets);
const {routes}=await import(rail('network'));
const {accessData}=await import(rail('access-data'));
const {hubs,accessesByStation,entranceDestinations,stationDestinations,sharedEntrances,platformFloorOpening,accessSupport}=await import(rail('access'));
const {onPath,pathFloor,pathFrom}=await import(rail('access-plan'));
const {createStationUse}=await import(rail('station-use'));
const records=routes.flatMap(route=>route.stations.map(station=>({job:{route,station}})));
const upper=records.find(r=>r.job.station.id==='way/905267133'),lower=records.find(r=>r.job.station.id==='way/905267134');
assert(upper&&lower,'both retained Lexington–125th platform polygons are rendered');
assert.equal(upper.job.station.y,-19);assert.equal(lower.job.station.y,-26);
const entry=accessesByStation.get(upper.job.station.key)?.[0]??sharedEntrances(upper.job.station.key)[0],destinations=entranceDestinations(entry);
assert(destinations.some(d=>d.stationKey===upper.job.station.key));assert(destinations.some(d=>d.stationKey===lower.job.station.key));
assert([...hubs.keys()].every(key=>sharedEntrances(key).length),'every generated level connects to a real street entrance');
for(const transfer of accessData.transfers) {
 assert.equal(transfer.path[0].y,hubs.get(transfer.from).path[0].y,'transfer starts on the source level');
 assert.equal(transfer.path.at(-1).y,hubs.get(transfer.to).path[0].y,'transfer ends on the destination level');
 assert(stationDestinations(transfer.to).some(d=>d.stationKey===transfer.from),'transfers work in both directions');
}
for(const path of [...accessData.entrances.map(e=>e.path),...accessData.hubs.flatMap(h=>[h.path,...h.branches.map(b=>b.path)])])
 for(let i=1;i<path.length;i++) {
  const a=path[i-1],b=path[i],rise=Math.abs(b.y-a.y);if(rise<.001)continue;
  assert(rise<=3.201,'short flights between resting landings');
  assert(Math.hypot(b.x-a.x,b.z-a.z)<=6.3,'no long uninterrupted flight');
  assert(rise/Math.hypot(b.x-a.x,b.z-a.z)<.8,'walkable stair grade with margin below the controller limit');
 }
for(const access of accessesByStation.get(upper.job.station.key)) {
 assert(Math.abs(access.path.at(-1).y-upper.job.station.y-1.15)<.001,'each entrance descends directly to the platform');
 for(let i=1;i<access.path.length;i++)if(Math.abs(access.path[i].y-access.path[i-1].y)<.001)
  assert(access.path[i].s-access.path[i-1].s<25,'no remote shared entrance hallway');
}
const descent=accessData.transfers.find(t=>t.kind==='stairs'&&[t.from,t.to].includes(lower.job.station.key));
assert(descent,'a visible stair connects the platform levels');
const down=descent.from===upper.job.station.key?descent.geometryPath:[...descent.geometryPath].reverse();
const point=onPath(pathFrom(down),2),floor=pathFloor(down,point.x,point.z,1,point.y);
assert(platformFloorOpening(upper.job.station,point.x,point.z),'the upper floor lookup opens for the descending stair');
const owner=records.find(r=>r.job.station.key===descent.from).job.station;
assert(Math.abs(accessSupport(owner.key,point.x,point.z,floor)-floor)<.1,'height queries follow the descending floor');
const events={on(){return()=>{};},emit(){}};
for(let index=0;index<destinations.length;index++) {
 const ctx={state:{screenshotMode:true,local:{state:{x:0,y:0,z:0}}},quality:{level:'mobile'},events};
 const use=createStationUse(ctx,{stationRecords:()=>records,visibleTrains:()=>[],readyStation:()=>true,clock:()=>0});
 const p={x:entry.path[0].x,z:entry.path[0].z,gy:.16,y:.16,seed:(index||destinations.length)*4,state:'walk',baseSpeed:1.2,inst:{},lane:{}};
 const manager={walkable:()=>true,grid:{move(){}}};let started=false,waitY=null,returned=false;
 for(let tick=0;tick<30000;tick++) {
  use.update(.1);use.updatePed(p,.1,manager);started ||=!!p.stationVisit;
  if(use.stats.waiting)waitY=p.gy;
  if(started&&!p.stationVisit){returned=true;break;}
 }
 assert(started&&returned,'NPC completes a visit and returns through the same entrance');
 assert(Math.abs(waitY-destinations[index].hub.wait.y)<.2,'NPC reaches its selected platform level');use.dispose();
}
console.log('PASS Lexington–125th upper/lower platform recovery, shared entrances, bidirectional transfers, short flights, and NPC visits to both levels');
