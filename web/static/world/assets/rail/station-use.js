import {accessesByStation,hubs,entranceDestinations} from './access.js?v=terrain-elevation-92';
import {pathFrom,onPath,pathFloor} from './access-plan.js?v=terrain-elevation-92';
import {sample,sampleTrack,trainState,CAR_SPACING,TRAIN_CARS} from './network.js?v=terrain-elevation-92';
export function boardingDoor(item,state,position,height=()=>0) {
 if(!state.doors||!state.station)return null;
 const offset=item.service.tracks[item.schedule.direction],side=Math.sign(state.station.offset??item.service.doors[item.schedule.direction]);
 let nearest=null;
 for(let i=0;i<TRAIN_CARS;i++)for(const door of [-5.7,5.7]) {
  const along=-(i-(TRAIN_CARS-1)/2)*CAR_SPACING*item.schedule.direction;
  const p=sample(item.service.path,state.s+along+door,offset+side*2.5),d=Math.hypot(position.x-p.x,position.z-p.z);
  if(Math.abs(position.y-p.y-height(p.x,p.z)-1.15)<.65&&d<2.8&&(!nearest||d<nearest.distance))nearest={distance:d,along};
 }
 return nearest;
}
export function createStationUse(ctx,{stationRecords,visibleTrains,readyStation,clock}) {
 const height=ctx.terrainHeight??(()=>0),absolute=p=>({...p,y:p.y+height(p.x,p.z)});
 const visitors=new Map(),cooldown=new WeakMap(),entryCache=new WeakMap();let passenger=null,elapsed=0,claimUntil=-1,uiClock=0,disposed=false;
 const button=globalThis.document?.body?.appendChild?document.createElement('button'):null;
 if(button){button.style.cssText='position:fixed;bottom:110px;left:50%;transform:translateX(-50%);z-index:35;max-width:85vw;padding:10px 16px;border:1px solid #bdccd4;border-radius:6px;background:#12212eef;color:white;font:14px sans-serif';button.hidden=true;document.body.appendChild(button);button.addEventListener('pointerdown',e=>e.stopPropagation());button.addEventListener('click',e=>{e.stopPropagation();interact();});}
 function nearestBoarder(position) {
  let best=null;for(const {item,state} of visibleTrains()) {
   const terminal=item.schedule.direction===1?item.service.path.stations.at(-1):item.service.path.stations[0];
   if(state.station?.key===terminal?.key)continue;
   if(!readyStation(state.station?.key))continue;const door=boardingDoor(item,state,position,height);
   if(door&&(!best||door.distance<best.door.distance))best={item,state,door};
  }return best;
 }
 function exitRide(record,state) {
  const station=state.station;if(!station||!state.doors||!readyStation(station.key))return false;
  const side=Math.sign(station.offset??record.item.service.doors[record.item.schedule.direction]);
  const offset=station.offset??record.item.service.tracks[record.item.schedule.direction]+side*4.4;
  const p=absolute(sample(record.item.service.path,station.s+record.along,offset));
  Object.assign(ctx.state.local.state,{x:p.x,y:p.y+1.15,z:p.z,vx:0,vy:0,vz:0});
  passenger=null;ctx.events.emit('localRespawn');return true;
 }
 function interact() {
  const local=ctx.state?.local;if(disposed||!local||ctx.state.screenshotMode||local.dead||local.vehicleKey!=null||ctx.state.welcomed===false)return false;
  if(elapsed<claimUntil)return true;
  if(passenger) {
   claimUntil=elapsed+.3;const state=trainState(passenger.item.schedule,clock()+passenger.item.phase);
   if(!exitRide(passenger,state))passenger.exitRequested=true;return true;
  }
  const board=nearestBoarder(local.state);if(!board)return false;
  passenger={item:board.item,along:board.door.along,lastSafe:{...local.state},lastS:board.state.s,exitRequested:false};claimUntil=elapsed+.3;return true;
 }
 function cancelRide(restore=false) {
  if(!passenger)return;const safe=passenger.lastSafe;passenger=null;
  if(restore&&ctx.state?.local){Object.assign(ctx.state.local.state,safe,{vx:0,vy:0,vz:0});ctx.events.emit('localRespawn');}
 }
 function carryPassenger(dt) {
  if(!passenger)return false;
  if(ctx.state.local.dead||ctx.state.screenshotMode){cancelRide();return false;}
  const record=passenger,{item}=record,state=trainState(item.schedule,clock()+item.phase);
  if(Math.abs(state.s-record.lastS)>Math.max(25,dt*30)){cancelRide(true);return false;}
  record.lastS=state.s;
  const terminal=item.schedule.direction===1?item.service.path.stations.at(-1):item.service.path.stations[0];
  if((record.exitRequested||state.station?.key===terminal?.key)&&exitRide(record,state))return false;
  const p=absolute(sampleTrack(item.service.path,state.s+record.along,item.service.tracks[item.schedule.direction])),s=ctx.state.local.state;
  Object.assign(s,{x:p.x,y:p.y+1.25,z:p.z,vx:p.dx*state.speed*item.schedule.direction,vy:0,vz:p.dz*state.speed*item.schedule.direction});
  return true;
 }
 function releasePed(p){visitors.delete(p);p.stationVisit=false;}
 function navigationEntries(record) {
  if(entryCache.has(record))return entryCache.get(record);
  const {station,route}=record.job,hub=hubs.get(station.key);
  const mapped=(accessesByStation.get(station.key)??[]).flatMap(a=>{const destinations=entranceDestinations(a);return destinations.map((destination,platformIndex)=>({...destination,platformIndex,platformCount:destinations.length}));});
  const entries=mapped.length?mapped:route.entrances.filter(e=>e.station===station).map((e,i)=>{
   const a={...sample(route,e.start,e.offset),y:e.top},b={...sample(route,e.end,e.offset),y:e.bottom},offset=e.island?e.offset:e.side*6.4;
   const landing={...sample(route,e.landing,e.island?e.offset:e.side*11.8),y:station.y+1.15};
   return {id:`${station.key}:${i}`,stationKey:station.key,path:pathFrom([
    {...sample(route,e.street,e.offset),y:.16},...(Math.abs(e.top-.16)<.01?[a,b]:[b,a]),landing,
    {...sample(route,e.landing,offset),y:station.y+1.15},{...sample(route,station.s,offset),y:station.y+1.15}])};
  });
  entryCache.set(record,entries);return entries;
 }
 function updatePed(p,dt,manager) {
  let visit=visitors.get(p);
  if(!visit) {
   if(p.state!=='walk'||p.seat||p.crossing||p.follow||p.seed%4||visitors.size>=(ctx.quality.level==='mobile'?12:32)||(cooldown.get(p)??0)>elapsed)return false;
   let choice=null,distance=8;
   for(const record of stationRecords())for(const a of navigationEntries(record)) {
    if(a.platformCount&&a.platformIndex!==(p.seed>>>2)%a.platformCount)continue;
    const start=a.path[0],d=Math.hypot(p.x-start.x,p.z-start.z);
    if(d>=distance||Math.abs(p.gy-height(p.x,p.z)-start.y)>1||!(a.via??[a.stationKey]).every(readyStation))continue;
    if([...visitors.values()].some(v=>v.entrance.id===a.id&&v.distance<8))continue;
    let clear=true;for(let t=0;t<=1;t+=.2)if(manager.walkable&&!manager.walkable(p.x+(start.x-p.x)*t,p.z+(start.z-p.z)*t,p.lane))clear=false;
    if(clear){choice=a;distance=d;}
   }
   if(!choice){cooldown.set(p,elapsed+2);return false;}
   const points=[{x:p.x,y:p.gy-height(p.x,p.z),z:p.z},...choice.path];
   visit={entrance:choice,path:pathFrom(points),distance:0,direction:1,wait:18+p.seed%24,origin:{x:p.x,z:p.z,y:p.gy},stage:'entering'};
   visitors.set(p,visit);p.stationVisit=true;p.phone=false;p.follow=null;
  }
  if(!(visit.entrance.via??[visit.entrance.stationKey]).every(readyStation)) {
   const previous={x:p.x,z:p.z};p.x=visit.origin.x;p.z=visit.origin.z;p.gy=visit.origin.y;
   manager.grid?.move(p,previous.x,previous.z);releasePed(p);cooldown.set(p,elapsed+45);return false;
  }
  if(p.state==='flee'||p.state==='flinch')visit.direction=-1;
  const previous={x:p.x,z:p.z};let speed=Math.min(1.25,p.baseSpeed??1.2);
  if(visit.stage==='waiting') {
   speed=0;visit.wait-=dt;if(visit.wait<=0){visit.stage='leaving';visit.direction=-1;}
  } else {
   const next=Math.max(0,Math.min(visit.path.at(-1).s,visit.distance+visit.direction*speed*dt)),point=onPath(visit.path,next);
   // Keep to the right in both directions so returning visitors can pass an
   // arriving queue. Blend back onto the original sidewalk route at the exit.
   const lane=.44*visit.direction*Math.min(1,next/2);
   point.x-=point.dz*lane;point.z+=point.dx*lane;
   const worldY=point.y+height(point.x,point.z);
   const blocked=[...visitors].some(([other])=>other!==p&&Math.abs(other.gy-worldY)<1.8&&Math.hypot(other.x-point.x,other.z-point.z)<.65);
   const player=ctx.state?.local?.state;
   if(blocked||(player&&!ctx.state.screenshotMode&&Math.abs(player.y-worldY)<1.8&&Math.hypot(player.x-point.x,player.z-point.z)<.8))speed=0;
   else {visit.distance=next;p.x=point.x;p.z=point.z;p.gy=(pathFloor(visit.path,p.x,p.z,1.1,point.y)??point.y)+height(p.x,p.z);p.yaw=Math.atan2(-point.dx*visit.direction,-point.dz*visit.direction);}
   if(visit.distance>=visit.path.at(-1).s-.01){visit.stage='waiting';}
   if(visit.direction<0&&visit.distance<=.01){releasePed(p);cooldown.set(p,elapsed+90);p.state='walk';}
  }
  p.speed=speed;p.inst.speed=speed;manager.grid?.move(p,previous.x,previous.z);return true;
 }
 function update(dt) {
  elapsed+=Math.max(0,dt);uiClock-=dt;if(!button||uiClock>0)return;uiClock=.2;
  const local=ctx.state?.local;button.hidden=!local||ctx.state.screenshotMode||ctx.state.welcomed===false||local.dead;
  if(button.hidden)return;
  if(passenger){const state=trainState(passenger.item.schedule,clock()+passenger.item.phase);button.textContent=state.station&&state.doors?`F · Exit at ${state.station.name}`:passenger.exitRequested?'Getting off at the next available platform':'F · Get off at next station';return;}
  const board=nearestBoarder(local.state);button.hidden=!board;
  if(board)button.textContent=`F · Board train — ${board.state.station.name}`;
 }
 const off=[ctx.events.on('interact',interact),ctx.events.on('localRespawn',()=>cancelRide()),ctx.events.on('localDeath',()=>cancelRide())];
 return {interact,carryPassenger,updatePed,releasePed,update,cancelRide,
  get passengerKey(){return passenger?.item.key;},get riding(){return !!passenger;},controlsInteraction:()=>!!passenger||elapsed<claimUntil,
  get stats(){return {visitors:visitors.size,waiting:[...visitors.values()].filter(v=>v.stage==='waiting').length,riding:!!passenger};},
  dispose(){disposed=true;cancelRide(true);for(const p of visitors.keys())releasePed(p);off.forEach(fn=>fn());button?.remove();}};
}
