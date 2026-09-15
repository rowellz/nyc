import assert from 'node:assert/strict';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';
const rail=name=>new URL(`rail/${name}.js?v=${CLIENT_REVISION}`,assets);
const {routes,sample}=await import(rail('network'));
const {buildStation,buildTrack}=await import(rail('geometry'));
const {accessesByStation,hubs,sharedEntrances,entranceClosed,functionalEntrance}=await import(rail('access'));
const {accessData}=await import(rail('access-data'));
const {onPath,pathFloor}=await import(rail('access-plan'));
const {triangleHeight}=await import(new URL('supports.js',assets));
const stops=routes.flatMap(route=>route.stations.filter(station=>station.name==='77th Street').map(station=>({route,station})));
assert.equal(stops.length,2);
assert(stops.every(({station})=>station.y===-12),'both mapped local platforms use layer -1, above the express tracks');
assert(accessData.closed.length>0);
assert(accessData.closed.every(e=>entranceClosed(e.x,e.z)&&functionalEntrance(e.x,e.z)),'closed entries remove the fake stairwell and display their closed state');
assert([...hubs.keys()].every(key=>sharedEntrances(key).length),'every station retains a usable street entrance');
const center=stops[0].station,meshes=[];
for(const route of routes) {
 const segments=[...route.segmentsByTile.values()].flat().filter(([a,b])=>Math.abs((a.x+b.x)/2-center.x)<200&&Math.abs((a.z+b.z)/2-center.z)<200);
 if(!segments.length)continue;
 const built=buildTrack(segments,[],route).collision;meshes.push(built);
 if(segments.every(([a,b])=>a.y<-18&&b.y<-18))
  assert(Math.max(...built.position.filter((_,i)=>i%3===1))<-13,'lower bore walls cannot extend into the local station above');
}
for(const {route,station} of stops)meshes.push(buildStation(station,route).collision);
function blocked(x,z,floor,head) {
 for(const mesh of meshes)for(let i=0;i<mesh.index.length;i+=3) {
  const vertices=[0,1,2].map(j=>mesh.position.slice(mesh.index[i+j]*3,mesh.index[i+j]*3+3));
  const hit=triangleHeight(vertices,x,z);
  if(hit?.inside&&hit.height>floor+.3&&hit.height<head)return hit.height;
 }return null;
}
for(const {route,station} of stops) {
 for(let s=station.s-60;s<station.s+85;s+=4) {
  const p=sample(route,s,hubs.get(station.key)?.offset??station.offset);
  assert.equal(blocked(p.x,p.z,station.y+1.15,station.y+3.2),null,'continuous platform walking aisle');
  const track=sample(route,s);
  assert.equal(blocked(track.x,track.z,track.y,track.y+4.3),null,'stairs and passages leave the train envelope clear');
 }
 for(const entry of accessesByStation.get(station.key)) {
  assert(entry.path[1].s<12,'street flight stops at the mezzanine instead of crossing through the railway');
  for(const path of [entry.path,hubs.get(station.key).path])for(let s=1;s<path.at(-1).s-1;s+=1.5) {
   const p=onPath(path,s),floor=pathFloor(path,p.x,p.z);
   assert.equal(blocked(p.x,p.z,floor,floor+2.1),null,`all neighboring meshes leave access headroom: ${entry.id} at ${s}`);
  }
 }
}
console.log('PASS 77th Street: correct stacked levels, enclosed bores, clear trains/platforms and all eight entrance paths');
