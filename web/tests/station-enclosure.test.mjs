import assert from 'node:assert/strict';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';
const rail=name=>new URL(`rail/${name}.js?v=${CLIENT_REVISION}`,assets);
const {passageVolume,wallPanel}=await import(rail('enclosure'));
const {Builder,buildTrack,buildStation}=await import(rail('geometry'));
const {appendAccessGeometry,hubs}=await import(rail('access'));
const {pathFrom,onPath}=await import(rail('access-plan'));
const {routes,sample}=await import(rail('network'));
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function hit(mesh,origin,direction,limit=40) {
 for(let i=0;i<mesh.index.length;i+=3) {
  const [a,b,c]=[0,1,2].map(j=>mesh.position.slice(mesh.index[i+j]*3,mesh.index[i+j]*3+3));
  const e=sub(b,a),f=sub(c,a),h=cross(direction,f),det=dot(e,h);if(Math.abs(det)<1e-8)continue;
  const s=sub(origin,a),u=dot(s,h)/det;if(u<0||u>1)continue;
  const q=cross(s,e),v=dot(direction,q)/det;if(v<0||u+v>1)continue;
  const t=dot(f,q)/det;if(t>1e-4&&t<limit)return true;
 }return false;
}
const doorway=new Builder();
doorway.panel(wallPanel({x:0,y:0,z:0},{x:0,y:0,z:10},0,0,5),.2,'tile',[passageVolume({x:-5,y:1,z:5},{x:5,y:1,z:5},1.3,0,2.5)]);
for(const [z,y,covered] of [[5,2,false],[5,.5,true],[5,4,true],[2,2,true],[8,2,true]])
 assert.equal(hit(doorway.collision,[-2,y,z],[1,0,0]),covered,'doorway retains sill, lintel and adjacent wall');
assert.deepEqual(doorway.layers.get('tile'),doorway.collision,'render and collision use the same enclosure');
const key='enclosure-fixture',path=pathFrom([{x:0,y:-6,z:0},{x:0,y:-6,z:10},{x:10,y:-6,z:10}]);
hubs.set(key,{path});
try {
 const corner=new Builder();appendAccessGeometry(corner,{key});
 assert(hit(corner.collision,[-.8,-4.5,9],[0,0,1]),'outside corner has an end return');
 assert(!hit(corner.collision,[0,-4.5,9],[1,0,0],2),'inside corner remains passable');
 assert(hit(corner.collision,[0,-4.5,9],[0,1,0]),'corner has a ceiling');
}finally{hubs.delete(key);}
const stops=routes.flatMap(route=>route.stations.filter(s=>s.name==='149th Street-Grand Concourse').map(station=>({route,station})));
assert.equal(stops.length,4);const center=stops[0].station,meshes=[];
for(const route of routes) {
 const segments=[...route.segmentsByTile.values()].flat().filter(([a,b])=>Math.abs((a.x+b.x)/2-center.x)<250&&Math.abs((a.z+b.z)/2-center.z)<250);
 if(segments.length)meshes.push(buildTrack(segments,[],route).collision);
 for(const station of route.stations)if(Math.hypot(station.x-center.x,station.z-center.z)<230)meshes.push(buildStation(station,route).collision);
}
for(const {route,station} of stops)for(const distance of [-75,-35,0,35,75]) {
 const p=sample(route,station.s+distance,station.offset),origin=[p.x,station.y+2.6,p.z];
 for(const direction of [[-p.dz,0,p.dx],[p.dz,0,-p.dx],[0,1,0]])
  assert(meshes.some(mesh=>hit(mesh,origin,direction)),`Grand Concourse enclosure at ${station.key}, ${distance}, ${direction}`);
}
for(const {station} of stops) {
 const hub=hubs.get(station.key);if(!hub)continue;
 for(let s=2;s<hub.path.at(-1).s-1;s+=2) {
  const p=onPath(hub.path,s);if(p.y> -5)continue;
  for(const direction of Array.from({length:32},(_,i)=>[Math.cos(i*Math.PI/8),i<16?0:-.4,Math.sin(i*Math.PI/8)]))
   assert(meshes.some(mesh=>hit(mesh,[p.x,p.y+1.4,p.z],direction,200)),`Grand Concourse stair enclosure at ${station.key}, ${s}, ${direction}`);
 }
}
assert(meshes.every(mesh=>mesh.position.every(Number.isFinite)),'enclosure contains no invalid vertices');
console.log('PASS precise doorway cuts, closed corridor corners, matching collision, and Grand Concourse walls/ceilings on both levels');
