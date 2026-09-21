import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';
const rail=name=>new URL(`rail/${name}.js?v=${CLIENT_REVISION}`,assets);
const {parkAvenue:r,services,sample,sampleTrack,layout,stationAt,portalHoles}=await import(rail('network'));
const {buildTrack,trainModel,materials}=await import(rail('geometry'));
const {triangleHeight}=await import(new URL('supports.js',assets));
const {foundationIndex,buildingFoundation}=await import(new URL('foundations.js',assets));
const {railClearance}=await import(rail('clearance-data'));
const {footprints}=await import(rail('footprints-data'));
const {clearanceHeight}=await import(rail('corridor'));
const tiles=new Map();
function tileAt(x,z) {
 const key=`${x}_${z}`;
 if(!tiles.has(key)) {
  const file=new URL(`../../public/world/world/tiles/${key}.json.gz`,import.meta.url);
  tiles.set(key,existsSync(file)?JSON.parse(gunzipSync(readFileSync(file))):{});
 }
 return tiles.get(key);
}
const roads=new Map();
for(let x=9;x<=11;x++)for(let z=-17;z<=-14;z++)for(const road of tileAt(x,z).roads??[])
 if(road.name==='Park Avenue')roads.set(road.id,road);
let checks=0;
for(let s=4515;s<4700;s+=2) {
 const p=sample(r,s),l=layout(r,null,s);
 assert(l.width<14,'compact four-track corridor');
 for(let i=1;i<l.tracks.length;i++)assert(Math.abs(l.tracks[i]-l.tracks[i-1]-3.4)<1e-9);
 for(const road of roads.values())for(let i=1;i<road.pts.length;i++) {
  const [a,b]=[road.pts[i-1],road.pts[i]],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
  if(Math.abs((dx*p.dx+dz*p.dz)/len)<.98)continue;
  const t=((p.x-a[0])*dx+(p.z-a[1])*dz)/(len*len);if(t<0||t>1)continue;
  const offset=(a[1]+dz*t-p.z)*p.dx-(a[0]+dx*t-p.x)*p.dz;
  assert(Math.abs(offset)-road.width/2>l.width/2+.375,'retaining walls leave both actual Park Avenue carriageways intact');checks++;
 }
}
assert(checks>100);
for(const station of r.stations) {
 assert.deepEqual(layout(r,station).tracks,[-9,-3,3,9],'station islands retain their original clearance');
 assert.equal(r.height(station.s),station.y);
}
// Terrain workers use a generated index: its portal vertices must match the
// live geometry, or narrowing the mesh still leaves holes through road lanes.
assert.deepEqual(footprints.surface.slice(0,portalHoles.length),portalHoles.map(ring=>ring.map(p=>p.map(n=>Number(n.toFixed(3))))));
console.log('PASS actual 97th Street carriageways, compact track spacing, level station platforms and worker cutouts');

const obstacles=railClearance[r.id];
assert(obstacles.some(o=>o.buildingId===1088599));assert(obstacles.some(o=>o.buildingId===1088600));
for(const obstacle of obstacles) {
 const p=sample(r,(obstacle.start+obstacle.end)/2);
 const buildings=new Map();
 for(let x=Math.floor(p.x/256)-1;x<=Math.floor(p.x/256)+1;x++)for(let z=Math.floor(p.z/256)-1;z<=Math.floor(p.z/256)+1;z++)
  for(const b of tileAt(x,z).buildings??[])buildings.set(b.id,b);
 const building=buildings.get(obstacle.buildingId);assert(building);
 const roof=buildingFoundation(building)+building.height+.6;
 for(let s=obstacle.start;s<=obstacle.end;s+=1)assert(r.height(s)-1>=roof+.199,'deck underside clears the entire building and parapet');
 const segments=[...r.segmentsByTile.values()].flat().filter(([a,b])=>a.s<obstacle.end&&b.s>obstacle.start);
 const geometry=buildTrack(segments,[],r,true),supports=geometry.layers.get('green');
 // No support-column vertices may run from the ground through a building.
 if(supports)for(let i=0;i<supports.position.length;i+=3)if(supports.position[i+1]<r.height(p.s)-1.5) {
  const x=supports.position[i],z=supports.position[i+2];
  const index=foundationIndex([{width:.1,pts:[[x-.05,z],[x+.05,z]]}]);
  assert.equal(buildingFoundation(building,index),0,'support columns avoid the building footprint');
 }
 if(obstacle.approach)for(const [a,b] of segments) {
  const s=(a.s+b.s)/2,l=layout(r,stationAt(r,s),s);
  for(const offset of l.tracks) {
   const q=sample(r,s,offset),mesh=geometry.collision;let floor=-Infinity;
   for(let i=0;i<mesh.index.length;i+=3){const tri=[0,1,2].map(j=>mesh.position.slice(mesh.index[i+j]*3,mesh.index[i+j]*3+3)),hit=triangleHeight(tri,q.x,q.z);if(hit?.inside&&hit.height<q.y+.1)floor=Math.max(floor,hit.height);}
   assert(Math.abs(floor-(q.y-.14))<.025,'rendered ballast and collision follow the raised route');
  }
 }
}
for(let s=0;s<r.length;s+=.5)assert(Math.abs(r.height(s+.5)-r.height(s))/.5<=.06001);
const synthetic=[{start:100,end:150,height:12,approach:400}];
assert.equal(clearanceHeight(()=>0,125,synthetic),12);
assert.equal(clearanceHeight(()=>0,-300,synthetic),0);
console.log('PASS real building roofs, support columns, matching deck collision and bounded continuous grades');

const model=trainModel(materials(),'commuter',true),train=model.create();
for(const service of services.filter(s=>['hudson','harlem-new-haven'].includes(s.id)))for(const direction of [-1,1])for(const s of [4515,5830,r.stations[1].s-230,r.stations[1].s]) {
 const state={s,doors:false};model.place(train,state,direction,1,service.path,service.tracks[direction],service.doors[direction]);
 for(const [i,{car}]of train.cars.entries()) {
  const along=s-direction*(i-2)*18.5,expected=sampleTrack(r,along,service.tracks[direction]);
  assert(Math.hypot(car.position.x-expected.x,car.position.y-expected.y,car.position.z-expected.z)<1e-6,'each carriage stays on its rendered track through narrowing and roof clearance');
 }
}
console.log('PASS all four commuter train directions follow compact rails and height transitions');
