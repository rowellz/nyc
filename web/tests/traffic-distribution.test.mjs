import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { laneRanges, roadGroup, trafficKind, spawnTraffic, trafficRadius } from '../static/world/assets/traffic-distribution.js';

const bundle = readFileSync(new URL('vehicles-_zJz3z3J.js', assets), 'utf8');
// Exercise the actual served Traffic class, including its transform and queue logic.
const start = bundle.indexOf('class Traffic {');
const end = bundle.indexOf('return {Roads,Traffic,isAvenue}', start);
const lanePoint = (lane, s) => ({ x: lane.ax + lane.dx * s, z: lane.az + lane.dz * s, dx: lane.dx, dz: lane.dz });
let random = 719;
const hash01 = () => { random = Math.imul(random, 1664525) + 1013904223 | 0; return (random >>> 0) / 4294967296; };
const kindsSource = readFileSync(new URL('../../src/client/src/vehicles/kinds.ts', import.meta.url), 'utf8');
const { stripTypeScriptTypes } = await import('node:module');
const kinds = vm.runInNewContext(stripTypeScriptTypes(kindsSource.replace(/export /g, '')) + '\nKINDS');
const distance2 = (a,b) => (a.x-b.x)**2+(a.z-b.z)**2;
const scope = { $spawnTraffic:spawnTraffic, $trafficRadius:trafficRadius, lanePoint, hash01, KINDS:kinds,
  ground:()=>0, trafficHeight:(_w,r)=>r.layer*6, makeCar:(key,kind,x,y,z,yaw)=>({key,kind,x,y,z,yaw,speed:0,spin:0}),
  removeBody:()=>{},createObstacle:()=>{},poseMatrix:()=>{},distance2,
  isAvenue:r=>/avenue/i.test(r.name??''),tunnelConnections:()=>[] };
const Traffic = vm.runInNewContext(bundle.slice(start,end)+'\nTraffic',scope);
const lanes = new Map();
for (const [cls, z, layer] of [['motorway',-140,0],['primary',-60,1],['residential',80,0]]) {
  for (let side=0;side<4;side++) {
    const dx=side<2?1:-1, ax=dx===1?-400:400;
    const lane={key:`${cls}:${side}`,road:{cls,layer,name:cls==='primary'?'Test Avenue':cls},ax,az:z+side*4,bx:-ax,bz:z+side*4,dx,dz:0,length:800,speed:10};
    lanes.set(lane.key,lane);
  }
}
const ctx={quality:{drawDistance:512,maxTraffic:400},state:{screenshotMode:true,local:{state:{x:0,z:0}}},camera:{position:{x:0,z:0},matrixWorld:{elements:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}},modules:new Map(),world:{}};
const traffic=new Traffic(ctx,{lanes,outgoing:new Map()});
for(let i=0;i<24;i++)traffic.update(0,.25*i,[]),traffic.spawnClock=0;
const counts={};for(const c of traffic.cars)counts[roadGroup(c.lane.road)]=(counts[roadGroup(c.lane.road)]??0)+1;
assert(traffic.cars.length>300,`only ${traffic.cars.length} cars spawned`);
for(const group of ['highway','arterial','street'])assert(counts[group]>35,`${group} was starved: ${counts[group]}`);
assert(new Set(traffic.cars.map(c=>c.lane.key)).size===12,'every lane and direction receives traffic');
assert(new Set(traffic.cars.map(c=>c.kind)).size>=8,'fleet contains a broad vehicle mix');
assert(traffic.cars.filter(c=>c.kind==='taxi').length<traffic.cars.length*.3,'taxi quota no longer dominates');
ctx.quality.maxTraffic=0;traffic.update(0,0,[]);assert.equal(traffic.cars.length,0,'zero density removes traffic');
console.log('PASS served traffic spawner:',counts);

const short={ax:0,az:0,bx:8,bz:0,length:8};
assert(laneRanges(short,{x:4,z:0},20).length,'short highway pieces can spawn traffic');
const curved={length:200,path:[{x:-100,z:100,s:0},{x:0,z:0,s:100},{x:100,z:100,s:200}]};
const ranges=laneRanges(curved,{x:0,z:0},30);
assert(ranges.length && ranges[0][0]<100 && ranges[0][1]>100,'curved paths enter the disc even when the endpoint chord misses');
assert.equal(laneRanges(short,{x:500,z:0},20).length,0);
for(const group of ['highway','ramp','arterial','street'])for(const r of [0,.1,.5,.999999])assert(kinds[trafficKind(group,r)]);
console.log('PASS short/curved lanes, fleet mix, and density reduction');

// Replay the user's Cross Bronx location with its real OSM lanes and bends.
const { gunzipSync } = await import('node:zlib');
const layout = await import(new URL('lane-layout.js', assets));
const paths = await import(new URL('lane-paths.js', assets));
const original = readFileSync(new URL('../../public/world/assets/vehicles-_zJz3z3J.js',import.meta.url),'utf8');
const roadsStart = original.indexOf('const node = (x');
const roadsEnd = original.indexOf('const AVENUE_RADIUS',roadsStart);
const Roads = vm.runInNewContext(original.slice(roadsStart,roadsEnd)+'\nRoads',{
  ...scope, isIOS:()=>true, TILE_SIZE:256, isHighway:layout.isHighway,laneCount:layout.laneCount,laneWidth:layout.laneWidth,
  highwayLanePath:paths.highwayLanePath,pickKind:()=> 'sedan',
});
const camera={x:(-73.9265363+73.98322)*111320*Math.cos(40.75362*Math.PI/180),z:-(40.8450068-40.75362)*110574};
const heading=105*Math.PI/180;
ctx.camera.position=camera;ctx.camera.matrixWorld.elements[8]=-Math.sin(heading);ctx.camera.matrixWorld.elements[10]=Math.cos(heading);
const roads=new Roads(ctx), refreshHighways=roads.refreshHighways;
roads.refreshHighways=()=>{};
for(let tx=Math.floor(camera.x/256)-2;tx<=Math.floor(camera.x/256)+2;tx++)for(let tz=Math.floor(camera.z/256)-2;tz<=Math.floor(camera.z/256)+2;tz++){
  let tile;try{tile=JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${tx}_${tz}.json.gz`,import.meta.url))));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  roads.load({...tile,key:`${tx}_${tz}`,tx,tz});
}
refreshHighways.call(roads);
const OriginalTraffic=vm.runInNewContext(original.slice(original.indexOf('const AVENUE_RADIUS'),original.indexOf('return {Roads,Traffic,isAvenue}'))+'\nTraffic',{
  ...scope,lanePoint:paths.lanePoint,pickKind:(_type,r)=>trafficKind('arterial',r),
});
const ServedTraffic=vm.runInNewContext(bundle.slice(start,end)+'\nTraffic',{...scope,lanePoint:paths.lanePoint});
function capture(Type,cap){
  ctx.quality.maxTraffic=cap;random=719;
  const t=new Type(ctx,roads);
  for(let i=0;i<32;i++){t.spawnClock=0;t.update(0,i*.25,[]);}
  const inView=t.cars.filter(c=>{
    const dx=c.x-camera.x,dz=c.z-camera.z,forward=dx*Math.sin(heading)-dz*Math.cos(heading),side=dx*Math.cos(heading)+dz*Math.sin(heading);
    return forward>0 && Math.abs(side)<forward*.85 && distance2(c,camera)<512**2;
  });
  const distribution={};for(const c of inView){const g=roadGroup(c.lane.road);distribution[g]=(distribution[g]??0)+1;}
  return {total:t.cars.length,visible:inView.length,distribution};
}
const before=capture(OriginalTraffic,200),after=capture(ServedTraffic,400);
assert(after.visible>before.visible*1.5,`visible traffic did not increase: ${JSON.stringify({before,after})}`);
assert(after.distribution.highway>=25,`highway still empty: ${JSON.stringify(after)}`);
assert(Object.keys(after.distribution).length>=3,'visible traffic reaches multiple road types');
console.log('PASS Cross Bronx road replay:',JSON.stringify({before,after}));
