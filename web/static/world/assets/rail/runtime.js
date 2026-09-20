import { Z as Group } from '../textureRelease-2U-gT89r.js?v=mobile-chunk-pacing-62';
import { route, routes, services, layout, sample, tileKey, timetable, trainState, TRAIN_LENGTH, surfaceHoles } from './network.js?v=station-layout-32';
import { buildTrack, buildStation, stationSign, materials, trainModel, stairHeight } from './geometry.js?v=mobile-chunk-pacing-62';
import {functionalEntrance,entranceYaw,entranceClosed,accessesByStation,hubs,stationPaths,accessSupport,platformOpening,platformFloorOpening} from './access.js?v=station-layout-32';
import {createStationUse} from './station-use.js?v=station-layout-32';
import {onPath} from './access-plan.js?v=station-layout-32';
import {createRailBudget,railBounds} from './mobile-budget.js?v=mobile-rail-budget-55';

function project(p,a,b) {
  const dx=b.x-a.x,dz=b.z-a.z,d=dx*dx+dz*dz;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(d||1)));
  return {s:a.s+(b.s-a.s)*t,distance:Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t),
    offset:((p.z-a.z)*dx-(p.x-a.x)*dz)/Math.sqrt(d||1)};
}
const trackKey=(route,key)=>`${route.id}:${key}`;

export function installRail(ctx) {
  if(ctx.modules.has('rail'))return ctx.modules.get('rail');
  const root=new Group();root.name='rail';ctx.worldGroup.add(root);
  const mobile=ctx.quality.level==='mobile';
  const mats=materials(),models={subway:trainModel(mats,'subway',mobile),commuter:trainModel(mats,'commuter',mobile)};
  const resident=new Map(),stations=new Map(),trains=new Map(),pending=new Set();
  const jobs=new Map(),jobsByTile=new Map(),stationJobs=[];
  const selectJobs=createRailBudget(ctx,surfaceHoles);
  let disposed=false,scan=0,elapsed=0,visibleNow=[];
  const fleet=services.flatMap(service=>(service.directions??[-1,1]).flatMap(direction=>{
    const schedule=timetable(service.path,direction),count=Math.max(1,Math.floor(schedule.duration/150));
    return Array.from({length:count},(_,i)=>({key:`${service.id}:${direction}:${i}`,service,schedule,phase:i*schedule.duration/count}));
  }));
  for(const r of routes) {
    for(const [key,segments] of r.segmentsByTile) {
      const points=segments.flat();
      const id=trackKey(r,key),job={id,route:r,key,segments,point:segments[0][0],bounds:railBounds(points,22),
        buried:!r.openCut&&points.every(p=>p.y<-6&&p.structure!=='cutting')};
      jobs.set(id,job);
      if(!jobsByTile.has(key))jobsByTile.set(key,[]);
      jobsByTile.get(key).push(job);
    }
    for(const station of r.stations) {
      const keys=new Set(),points=[],half=(r.platformLength??120)/2;
      for(const path of stationPaths(station.key))for(let s=0;s<=path.at(-1).s+1;s+=20){const p=onPath(path,s);keys.add(tileKey(p.x,p.z));points.push(p);}
      for(let s=station.s-half-38;s<=station.s+half+5;s+=10)for(const offset of [-18,0,18]) {
        const p=sample(r,s,offset);keys.add(tileKey(p.x,p.z));points.push(p);
      }
      const job={id:`station:${station.key}`,station,route:r,keys,point:station,bounds:railBounds(points,2),buried:!r.openCut&&station.y<-6};
      jobs.set(job.id,job);stationJobs.push(job);
    }
  }
  function publish(builder,name) {
    const group=builder.build(mats);group.name=name;root.add(group);
    const {position,index}=builder.collision;
    if(index.length) {
      const p=ctx.physics,col=p.world.createCollider(p.RAPIER.ColliderDesc.trimesh(Float32Array.from(position),Uint32Array.from(index),p.RAPIER.TriMeshFlags?.FIX_INTERNAL_EDGES).setFriction(.85));
      p.addTileColliders(name,[col],'concrete');
    }
    return {group,name};
  }
  function release(record) {
    record.sign?.dispose();record.group.traverse(o=>o.geometry?.dispose());record.group.removeFromParent();
    ctx.physics.removeTileColliders(record.name);
  }
  function refresh() {
    let wanted=new Set();
    // Each physical corridor owns its geometry once, even when multiple train
    // services traverse it. A tile halo covers tracks over a residency seam.
    for(const tile of ctx.world.tiles.values())for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)
      for(const job of jobsByTile.get(`${tile.tx+dx}_${tile.tz+dz}`)??[])wanted.add(job.id);
    for(const job of stationJobs)if([...job.keys].some(key=>ctx.world.tiles.has(key)))wanted.add(job.id);
    wanted=selectJobs([...wanted].map(key=>jobs.get(key)),new Set([...resident.keys(),...stations.keys()]));
    for(const collection of [resident,stations])for(const [key,record] of collection)if(!wanted.has(key)){release(record);collection.delete(key);}
    for(const key of pending)if(!wanted.has(key))pending.delete(key);
    for(const key of wanted)if(!resident.has(key)&&!stations.has(key))pending.add(key);
  }
  function buildNext() {
    if(!pending.size||ctx.physics.ready===false)return;
    const distance=key=>{const p=jobs.get(key).point;return Math.hypot(p.x-ctx.camera.position.x,p.z-ctx.camera.position.z);};
    const key=[...pending].sort((a,b)=>distance(a)-distance(b))[0],job=jobs.get(key);pending.delete(key);
    if(job.station) {
      const record=publish(buildStation(job.station,job.route),`rail:${key}`),sign=stationSign(job.station,mats,job.route);
      record.group.add(sign.group);record.sign=sign;record.job=job;stations.set(key,record);
    } else {
      const roads=[...new Map([...ctx.world.tiles.values()].flatMap(tile=>tile.streetContext?.roads??tile.roads??[]).map(road=>[road.id,road])).values()];
      resident.set(key,publish(buildTrack(job.segments,roads,job.route,mobile),`rail:${key}`));
    }
  }
  const baseHeight=ctx.physics.groundHeight;
  function support(x,z,referenceY,fallback) {
    const base=fallback??baseHeight.call(ctx.physics,x,z,referenceY);
    if(disposed||!Number.isFinite(referenceY))return base;
    let best=base,nearest=Infinity;
    const offer=y=>{
      const d=Math.abs(referenceY-y);
      if(referenceY>=y-.6&&referenceY<y+3.5&&d<nearest){best=y;nearest=d;}
    };
    for(const {job:{station,route:r}} of stations.values()) {
      const access=accessSupport(station.key,x,z,referenceY);if(access!==null)offer(access);
      for(const e of r.entrances.filter(e=>e.station===station)) {
        const a=sample(r,e.start,e.offset),b=sample(r,e.end,e.offset),q=project({x,z},a,b);
        if(q.distance<(e.island?1.2:1.48))offer(stairHeight(e,q.s));
        const p=sample(r,e.landing,e.island?e.offset:e.side*11.8),dx=x-p.x,dz=z-p.z;
        if(Math.abs(dx*p.dx+dz*p.dz)<1.5&&Math.abs(-dx*p.dz+dz*p.dx)<(e.island?1.4:4.25))offer(station.y+1.15);
      }
    }
    const tx=Math.floor(x/256),tz=Math.floor(z/256);
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const job of jobsByTile.get(`${tx+dx}_${tz+dz}`)??[]) {
      if(!resident.has(job.id))continue;
      const r=job.route;
      for(const [a,b] of job.segments) {
        const q=project({x,z},a,b);
        if(q.distance>22)continue;
        const station=r.stations.find(station=>Math.abs(station.s-q.s)<=(station.length??r.platformLength??120)/2),l=layout(r,station);
        if(r.island?l.tracks.some(track=>Math.abs(q.offset-track)<1.5):q.distance<4.25)offer(r.height(q.s)-.14);
        if(station&&!platformFloorOpening(station,x,z)&&l.platforms.some(p=>Math.abs(q.offset-p.offset)<p.width/2&&!platformOpening(station,q.s,p.offset)))offer(station.y+1.15);
      }
    }
    return best;
  }
  ctx.physics.groundHeight=support;
  const use=createStationUse(ctx,{stationRecords:()=>stations.values(),visibleTrains:()=>visibleNow,
    readyStation:key=>{const record=stations.get(`station:${key}`);return !!record&&resident.has(trackKey(record.job.route,tileKey(record.job.station.x,record.job.station.z)));},
    clock:()=>ctx.state.serverTime?.()??elapsed});
  const off=[ctx.events.on('tileLoaded',refresh),ctx.events.on('tileUnloaded',refresh)];
  const api={name:'rail',route,routes,stations:routes.flatMap(r=>r.stations),root,support,
    functionalEntrance,entranceYaw,entranceClosed,
    interact:use.interact,carryPassenger:use.carryPassenger,updatePed:use.updatePed,releasePed:use.releasePed,controlsInteraction:use.controlsInteraction,
    readyForInput:()=>pending.size===0,
    get stats(){return{trackTiles:resident.size,stations:stations.size,trains:trains.size,pending:pending.size,
      corridors:[...new Set([...resident.keys()].map(key=>jobs.get(key).route.id))],stationUse:use.stats};},
    update(dt) {
      if(disposed)return;
      elapsed+=Math.max(0,dt);scan+=dt;
      if(scan>.5){scan=0;refresh();}
      buildNext();
      const now=ctx.state.serverTime?.()??elapsed,range=Math.min(ctx.quality.drawDistance||800,900);
      const localRoutes=new Set([...resident.keys()].map(key=>jobs.get(key).route.id));
      const visible=fleet.filter(item=>item.key===use.passengerKey||!item.service.id.startsWith('osm-')||localRoutes.has(item.service.id)).map(item=>{
        const state=trainState(item.schedule,now+item.phase),p=sample(item.service.path,state.s,item.service.tracks[item.schedule.direction]);
        const owner=item.service.path.partAt(state.s).route,center=sample(item.service.path,state.s);
        return {item,state,distance:Math.hypot(p.x-ctx.camera.position.x,p.z-ctx.camera.position.z),owner,center};
      }).filter(({item,state,center,owner,distance})=>item.key===use.passengerKey||(state.s>TRAIN_LENGTH/2&&state.s<item.service.path.length-TRAIN_LENGTH/2
        &&distance<range&&resident.has(trackKey(owner,tileKey(center.x,center.z)))))
        .sort((a,b)=>Number(b.item.key===use.passengerKey)-Number(a.item.key===use.passengerKey)||a.distance-b.distance).slice(0,ctx.quality.level==='mobile'?4:10);
      visibleNow=visible;
      const live=new Set(visible.map(v=>v.item.key));
      for(const [key,train] of trains)if(!live.has(key)){train.dispose();trains.delete(key);}
      for(const {item,state} of visible) {
        const {service,schedule}=item,model=models[service.kind];let train=trains.get(item.key);
        if(!train){train=model.create();root.add(train.root);trains.set(item.key,train);}
        if(state.station?.offset!==undefined)train.doorSide=Math.sign(state.station.offset);
        model.place(train,state,schedule.direction,dt,service.path,service.tracks[schedule.direction],train.doorSide??service.doors[schedule.direction]);
      }
      use.update(dt);
    },
    dispose() {
      disposed=true;use.dispose();off.forEach(fn=>fn());pending.clear();
      for(const r of [...resident.values(),...stations.values()])release(r);
      for(const train of trains.values())train.dispose();
      resident.clear();stations.clear();trains.clear();Object.values(models).forEach(model=>model.dispose());
      Object.values(mats).forEach(m=>m.dispose());root.removeFromParent();
      if(ctx.physics.groundHeight===support)ctx.physics.groundHeight=baseHeight;
      ctx.modules.delete('rail');
    },
  };
  ctx.modules.set('rail',api);refresh();return api;
}
