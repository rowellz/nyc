import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { curbPlanner, parkingOffset } from '../static/world/assets/curb-placement.js';
import { vehicleDrawDistance, parkedDrawDistance } from '../static/world/assets/traffic-distribution.js';
import { CLIENT_REVISION } from '../src/lib/server/client-cache.js';

const square=(x0,z0,x1,z1)=>[[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]];
let reads=0;
const road={id:1,cls:'residential',width:12,lanes:1,oneway:true,layer:0,
  get pts(){reads++;return [[20,100],[220,100]];}};
const tile={key:'0_0',tx:0,tz:0,roads:[road],roadbeds:[square(20,93,220,109)],
  sidewalks:[square(20,109,220,114),square(20,87,220,93)],parks:[],water:[],buildings:[]};
// Cover both sides, different body dimensions, other positions, and rejected
// slots. Camera movement must not resample any of these unchanged curbs.
const slots=[[0,60,1,1.8,4.6],[0,60,-1,1.8,4.6],[0,60,1,2.5,8],[0,80,1,1.8,4.6],[0,0,1,1.8,4.6]];
const reference=curbPlanner([tile]);
const expected=slots.map(q=>reference.parking(road,...q));
assert(expected.includes(null),'fixture exercises a rejected bumper at the end of the sidewalk');
assert.deepEqual(slots.map(q=>parkingOffset(tile,road,...q)),expected);
reads=0;
for(let i=0;i<100;i++)assert.deepEqual(slots.map(q=>parkingOffset(tile,road,...q)),expected);
assert.equal(reads,0,'repeated parking refreshes perform no curb geometry scans, including rejected slots');
const replacement={...tile,sidewalks:[square(20,111,220,116),square(20,87,220,93)]};
assert.notEqual(parkingOffset(replacement,road,...slots[0]),expected[0],'replacement tile with the same key gets new curbs');
const otherRoad={...road,pts:[[20,99],[220,99]]};
assert.notEqual(parkingOffset(tile,otherRoad,...slots[0]),expected[0],'replacement road with the same ID gets its own results');
assert.equal(parkingOffset(tile,road,...slots[0]),expected[0],'replacement leaves the original data unchanged');

// Replay the actual served iPhone parking refresh against sixteen Midtown
// tiles. Compare with the former planner-only cache as the camera moves,
// reverses, and changes render distance. Clearance and car identity must survive.
const bundle=readFileSync(new URL('vehicles-_zJz3z3J.js',assets),'utf8');
const code=bundle.slice(bundle.indexOf('const node = (x'),bundle.indexOf('const AVENUE_RADIUS'))+'\nRoads';
const tiles=[];
for(let tx=-1;tx<=2;tx++)for(let tz=-5;tz<=-2;tz++)tiles.push(JSON.parse(gunzipSync(
  readFileSync(new URL(`../../public/world/world/tiles/${tx}_${tz}.json.gz`,import.meta.url)))));
const oldPlans=new WeakMap();
function uncached(tile,road,...args){
  if(!oldPlans.has(tile))oldPlans.set(tile,curbPlanner([tile]));
  return oldPlans.get(tile).parking(road,...args);
}
function fixture(offset,range=parkedDrawDistance){
  const disposed=[],ctx={quality:{level:'mobile',drawDistance:384,farDistance:5000},world:{ios:true},
    camera:{position:{x:-145,z:-591}},modules:new Map()};
  const Roads=vm.runInNewContext(code,{
    $parkingOffset:offset,$vehicleDrawDistance:vehicleDrawDistance,$parkedDrawDistance:range,TILE_SIZE:256,isIOS:()=>true,
    KINDS:{sedan:{width:1.85,length:4.9,parkedWeight:1}},isHighway:()=>false,
    highwayLanePath:()=>null,pickKind:()=> 'sedan',hash01:()=>.2,ground:()=>0,
    poseMatrix:()=>{},removeBody:(_ctx,car)=>disposed.push(car),
    makeCar:(key,kind,x,y,z,yaw)=>({key,kind,x,y,z,yaw}),
  });
  const roads=new Roads(ctx);
  for(const tile of tiles)roads.load(tile);
  return {roads,ctx,disposed};
}
const before=fixture(uncached),after=fixture(parkingOffset);
const wide=fixture(parkingOffset,vehicleDrawDistance);
const allCars=f=>[...f.roads.tiles.values()].flatMap(r=>r.parked);
const retained=new Set(allCars(after).map(c=>c.key));
assert(allCars(after).length<allCars(wide).length,'iPhone generates fewer parked cars than the traffic window');
for(const car of allCars(after))assert(Math.hypot(car.x+145,car.z+591)<=364,'generation stays inside the 300 m window plus its refresh buffer');
for(const car of allCars(wide))if(Math.hypot(car.x+145,car.z+591)<=300)
  assert(retained.has(car.key),'every previously available nearby parked car remains available');
assert.equal(parkedDrawDistance(after.ctx),300);
assert.equal(vehicleDrawDistance(after.ctx),768,'moving traffic retains its longer range');
assert.equal(parkedDrawDistance({...after.ctx,quality:{...after.ctx.quality,drawDistance:256}}),256,'lower detail settings also lower parking range');
for(const ctx of [{...after.ctx,world:{ios:false}}, {...after.ctx,quality:{level:'high',drawDistance:768}}])
  assert.equal(parkedDrawDistance(ctx),vehicleDrawDistance(ctx),'other presets retain their previous parking range');
const snapshot=f=>JSON.stringify([...f.roads.tiles].sort(([a],[b])=>a.localeCompare(b)).map(([key,r])=>[key,r.parkingSlots,r.parked]));
assert.equal(snapshot(after),snapshot(before));
let beforeMs=0,afterMs=0;
for(const [x,z,range]of [[-120,-635,384],[-85,-697,384],[-50,-760,384],[-85,-697,384],[-85,-697,256],[-85,-697,384]]){
  const previous=new Map([...after.roads.tiles.values()].flatMap(r=>r.parked.map(car=>[car.key,car])));
  for(const f of [before,after]){
    Object.assign(f.ctx.camera.position,{x,z});f.ctx.quality.drawDistance=range;
    const start=performance.now();
    for(const tile of tiles)f.roads.refreshParking(tile);
    if(f===before)beforeMs+=performance.now()-start;else afterMs+=performance.now()-start;
  }
  assert.equal(snapshot(after),snapshot(before),'camera movement and range changes preserve every parking decision');
  for(const r of after.roads.tiles.values())for(const car of r.parked)
    if(previous.has(car.key))assert.equal(car,previous.get(car.key),'retained cars keep their objects and physics bodies');
}
assert.deepEqual(after.disposed.map(c=>c.key),before.disposed.map(c=>c.key),'departing cars retire identically');
after.roads.unload(tiles[0].key);
assert(!after.roads.tiles.has(tiles[0].key));
after.roads.load(structuredClone(tiles[0]));
assert.equal(snapshot(after),snapshot(before),'reloaded tiles regenerate the same parking');
assert(bundle.includes(`curb-placement.js?v=${CLIENT_REVISION}`),'the served client imports the current parking implementation');
{
  const start=bundle.indexOf('function ce(e,t,n,r){'),end=bundle.indexOf('function le(e){',start);
  assert(start>=0&&end>start);
  const car=allCars(after)[0];assert(car,'nearby parking remains populated');
  const nearest=vm.runInNewContext(bundle.slice(start,end)+'\nce',{
    re:false,I:false,y:[car],_:new Map(),Z:{sedan:{length:4.9,width:1.85,seatZ:0}},
  });
  assert.equal(nearest(car.x,car.y,car.z,2),car,'the actual enter-vehicle lookup still finds nearby parked cars');
}

// Execute the served parked rendering loop and fleet submission helper. The
// generation buffer must not leak into drawing or shorten moving traffic.
{
  const start=bundle.indexOf('function he(e,i,a,o=0){'),end=bundle.indexOf('return typeof window',start);
  const loopStart=bundle.indexOf('for(let e of x)!_.has(e.key)'),loopEnd=bundle.indexOf(';',loopStart);
  assert(start>=0&&end>start&&loopStart>=0&&loopEnd>loopStart);
  const drawn=[],cars=[100,300,330,500].map(x=>({key:`car-${x}`,kind:'sedan',matrix:`car-${x}`,x,y:0,z:0}));
  const owners=new Map(),ctx={...after.ctx,camera:{position:{x:0,z:0}}};
  const scope={t:ctx,x:cars,_:owners,$parkingRange:parkedDrawDistance(ctx),$vehicleDrawDistance:vehicleDrawDistance,
    $:(a,b)=>(a.x-b.x)**2+(a.z-b.z)**2,Z:{sedan:{height:2,length:5}},N:null,
    D:{center:{set(){}}},T:{intersectsSphere:()=>true},c:{add(){}},
    r:{scratch:()=>({matrix:{copy:key=>drawn.push(key)},color:{copy(){}},lightA:[],lightB:[]}),write(){}},
  };
  const draw=vm.runInNewContext(bundle.slice(start,end)+`\n({parked(){${bundle.slice(loopStart,loopEnd+1)}},moving:he})`,scope);
  draw.parked();assert.deepEqual(drawn,['car-100','car-300'],'parked cars draw through 300 m, excluding the generation buffer');
  drawn.length=0;owners.set('car-100',1);draw.parked();
  assert.deepEqual(drawn,['car-300'],'occupied cars are excluded from the parked pass');
  draw.moving(cars[3],0,0);assert.equal(drawn.at(-1),'car-500','moving cars still draw beyond the parked cutoff');
}
console.log(`PASS served parking refresh: unchanged curbs, rejected slots, replacement, car identity, range and retirement; six Midtown refreshes ${beforeMs.toFixed(1)} -> ${afterMs.toFixed(1)} ms`);
console.log(`PASS iPhone parked range: 300 m drawing, 364 m generation, nearby cars preserved; Midtown cars ${allCars(wide).length} -> ${retained.size}`);
