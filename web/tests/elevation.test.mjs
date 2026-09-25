import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { terrainHeight, elevateMesh, elevateGeometry, buildingElevation } from '../static/world/assets/elevation.js';
import { elevateStreetTile } from '../static/world/assets/elevation-streets.js';
import { elevationData } from '../static/world/assets/elevation-data.js';
import { elevationAssetPaths, elevationAssetTransform } from '../src/lib/server/elevation-assets.js';
import { serveStatic } from '../src/lib/server/static.js';
import { assets } from './sveltekit-assets.mjs';

const project=(lon,lat)=>[(lon+73.98322)*111320*Math.cos(40.75362*Math.PI/180),-(lat-40.75362)*110574];
assert(terrainHeight(0,0)>15 && terrainHeight(0,0)<30);
assert(terrainHeight(...project(-73.9385,40.8528))>65,'Washington Heights is above Midtown');
assert.equal(terrainHeight(...project(-74.005,40.775)),0,'Hudson stays at sea datum');
for(const p of [[NaN,0],[Infinity,0],[1e9,1e9]])assert.equal(terrainHeight(...p),0);
assert.equal(elevationData.values.length,elevationData.width*elevationData.height);
assert(elevationData.values.every(h=>Number.isFinite(h)&&h>=0&&h<10000));
assert.equal(terrainHeight(elevationData.x0+(elevationData.width-1)*64,elevationData.z0),elevationData.values[elevationData.width-1]/10);

function heightOn(mesh,x,z) {
  const p=mesh.attributes.position.array;
  for(let i=0;i<mesh.index.length;i+=3) {
    const [a,b,c]=Array.from(mesh.index.slice(i,i+3),n=>p.slice(n*3,n*3+3));
    const dx=b[0]-a[0],dz=b[2]-a[2],ex=c[0]-a[0],ez=c[2]-a[2],det=dx*ez-dz*ex;
    if(Math.abs(det)<1e-8)continue;
    const u=((x-a[0])*ez-(z-a[2])*ex)/det,v=(dx*(z-a[2])-dz*(x-a[0]))/det;
    if(u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6)return a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]);
  }
  return null;
}
const quad=(x,z,y=0)=>elevateMesh({position:{array:[x,y,z,x+256,y,z,x+256,y,z+256,x,y,z+256],itemSize:3}},[0,2,1,0,3,2]);
for(const [x,z] of [[0,0],[3584,-11008],[-256,-256]]) {
  const a=quad(x,z),b=quad(x+256,z);
  for(let dz=1;dz<256;dz+=13) {
    assert(Math.abs(heightOn(a,x+256,z+dz)-heightOn(b,x+256,z+dz))<1e-4,'no tile seam');
    for(let dx=1;dx<256;dx+=17)assert(Math.abs(heightOn(a,x+dx,z+dz)-terrainHeight(x+dx,z+dz))<1e-4,'mesh and support sampler agree');
  }
}
const courtyard=buildingElevation({footprint:[[[0,0],[100,0],[100,100],[0,100]]]});
assert.equal(courtyard,Math.max(...[[0,0],[100,0],[100,100],[0,100]].map(p=>terrainHeight(...p))));

// Use the renderer's real PlaneGeometry: its floating-point position attribute
// constructor must never be reused for the WebGL element index buffer.
const {Gt:PlaneGeometry}=await import(new URL('textureRelease-2U-gT89r.js',assets));
for(const [x,z] of [[0,0],[3584,-11008]]) {
  const plane=new PlaneGeometry(256,256,4,4);
  plane.rotateX(-Math.PI/2);plane.translate(x+128,0,z+128);
  elevateGeometry(plane);
  assert(plane.index.array instanceof Uint16Array||plane.index.array instanceof Uint32Array,'ground indices must be WebGL-compatible unsigned integers');
  const surface={attributes:plane.attributes,index:plane.index.array};
  for(let dz=1;dz<256;dz+=13)for(let dx=1;dx<256;dx+=17) {
    const height=heightOn(surface,x+dx,z+dz);
    assert.notEqual(height,null,'ground retains complete surface coverage');
    assert(Math.abs(height-terrainHeight(x+dx,z+dz))<1e-4);
  }
  plane.dispose();
}

// Execute the actual worker with the final elevation publication hook. The
// older datum-level suites continue to exercise the independent road builders.
for(const rel of elevationAssetPaths) {
  const response=await serveStatic(rel);assert.equal(response.status,200);
  assert((await response.text()).includes('./elevation.js'));
  const name=rel.split('/').at(-1);
  writeFileSync(new URL(name,assets),elevationAssetTransform(rel,readFileSync(new URL(name,assets),'utf8')));
}
let response;
globalThis.self={postMessage:value=>{response=value;}};
await import(new URL('tile.worker-Ai2ZdmRL.js',assets));
const {cutGround}=await import(new URL('tunnels.js',assets));
const hole=[[80,80],[176,80],[176,176],[80,176]];
const ground=quad(0,0);
const cut=cutGround(ground.attributes,ground.index,[hole],[-Infinity,Infinity]);
assert.equal(heightOn(cut,128,128),null,'raised ground preserves access openings');
assert.notEqual(heightOn(cut,20,20),null,'cuts retain surrounding raised land');

const tileResponse=await serveStatic('world/world/tiles/14_-42.json.gz');
const tile=JSON.parse(gunzipSync(Buffer.from(await tileResponse.arrayBuffer())));
const roads=tile.streetContext?.roads??tile.roads;
await self.onmessage({data:{id:1,input:{tile,roads,pedestrianTiles:[tile],quality:{level:'mobile',shadows:false}}}});
assert(!response.error,response.error);
const built=response.built;
assert(built.meshes.some(Boolean)&&built.walkCollision.position.length,'real hill tile has rendering and collision');
for(const mesh of built.meshes.filter(Boolean))assert(mesh.attributes.position.data.every(Number.isFinite));
// An arbitrary paving polygon over multiple cells: render, collider and
// walking-query buffers must all contain the same elevated surface.
const p=new Float32Array([3584,.15,-11008,3840,.15,-11008,3840,.15,-10752,3584,.15,-10752]),idx=new Uint32Array([0,2,1,0,3,2]);
const fixture=elevateStreetTile({meshes:[{attributes:{position:{data:p.slice(),size:3}},index:idx}],colliders:[{position:p.slice(),index:idx}],walkCollision:{position:p.slice(),index:idx},decks:[]},{tx:14,tz:-43});
assert.deepEqual(fixture.meshes[0].attributes.position.data,fixture.colliders[0].position);
assert.deepEqual(fixture.walkCollision.position,fixture.colliders[0].position);
assert.equal(fixture.walkCollision.offsets.length,1025);
const walk={attributes:{position:{array:fixture.walkCollision.position}},index:fixture.walkCollision.index};
assert(Math.abs(heightOn(walk,3700,-10900)-terrainHeight(3700,-10900)-.15)<1e-4);

// Rail's datum design remains reusable; the runtime explicitly requests
// terrain conversion for both the track mesh and its collision envelope.
const {Builder}=await import(new URL('rail/geometry.js',assets));
const {Pt:Material}=await import(new URL('textureRelease-2U-gT89r.js',assets));
const rail=new Builder();rail.box({x:3700,y:-12,z:-10900,dx:0,dz:1},4,.5,120,'concrete',0,0,true);
const root=rail.build({concrete:new Material()},true);
assert(rail.collision.position.some((v,i)=>i%3===1&&v>30));
assert.deepEqual(Array.from(root.children[0].geometry.attributes.position.array),Array.from(rail.collision.position));
root.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});

const {route,services,sample,timetable,trainState}=await import(new URL('rail/network.js',assets));
const {createStationUse,boardingDoor}=await import(new URL('rail/station-use.js',assets));
const {accessesByStation}=await import(new URL('rail/access.js',assets));
const station=route.stations[0],service=services[0],schedule=timetable(service.path,1);
let time=schedule.phases.find(p=>p.station?.key===station.key).start+6;
const item={key:'elevated-train',service,schedule,phase:0};
const point=sample(service.path,station.s+5.7,4.5);
const local={state:{...point,y:station.y+1.15+terrainHeight(point.x,point.z)},dead:false,vehicleKey:null};
const ctx={terrainHeight,state:{local,welcomed:true,screenshotMode:false},quality:{level:'mobile'},events:{on:()=>()=>{},emit(){}}};
const use=createStationUse(ctx,{clock:()=>time,stationRecords:()=>[{job:{route,station}}],visibleTrains:()=>[{item,state:trainState(schedule,time)}],readyStation:()=>true});
assert(boardingDoor(item,trainState(schedule,time),local.state,terrainHeight),'boarding uses world elevation');
assert.equal(boardingDoor(item,trainState(schedule,time),{...local.state,y:station.y+1.15},terrainHeight),null,'old datum cannot board a raised train');
assert(use.interact());assert(use.carryPassenger(.1));
assert(Math.abs(local.state.y-terrainHeight(local.state.x,local.state.z)-station.y-1.25)<.01,'passenger follows elevated train');
use.cancelRide();ctx.state.screenshotMode=true;
const start=accessesByStation.get(station.key)[0].path[0];
const ped={x:start.x,z:start.z,gy:start.y+terrainHeight(start.x,start.z),seed:4,state:'walk',baseSpeed:1.2,inst:{},lane:{}};
let entered=false,returned=false;
for(let i=0;i<12000;i++) {
  use.update(.1);use.updatePed(ped,.1,{walkable:()=>true,grid:{move(){}}});
  entered ||= !!ped.stationVisit;
  if(entered&&!ped.stationVisit){returned=true;break;}
}
assert(returned,'pedestrian traverses elevated station access and returns');
assert(Math.abs(ped.gy-terrainHeight(ped.x,ped.z)-start.y)<.2);
use.dispose();
delete globalThis.self;
console.log('PASS offline elevation, real NYC relief, tile seams, surface/collision agreement, terrain cuts, served street worker, foundations and elevated rail');
