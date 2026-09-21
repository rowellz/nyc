import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';
const rail=name=>new URL(`rail/${name}.js?v=${CLIENT_REVISION}`,assets);
const {route,sample,layout,portalHoles}=await import(rail('network'));
const {footprints}=await import(rail('footprints-data'));
const {holesForTile}=await import(rail('footprints'));
const {cutSurface}=await import(rail('cuts'));
const {buildTrack}=await import(rail('geometry'));
const {triangleHeight}=await import(new URL('supports.js',assets));

const roads=new Map();
for(let x=6;x<=8;x++)for(let z=-26;z<=-24;z++) {
 const tile=JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`,import.meta.url))));
 for(const road of tile.roads??[])if(/^West (120th|121st|122nd|123rd) Street$/.test(road.name))roads.set(road.id,road);
}
const covered=(position,index,x,z,y)=>{
 for(let i=0;i<index.length;i+=3) {
  const hit=triangleHeight([0,1,2].map(j=>Array.from(position.slice(index[i+j]*3,index[i+j]*3+3))),x,z);
  if(hit?.inside&&Math.abs(hit.height-y)<.025)return true;
 }
 return false;
};
const crossings=new Set();let samples=0;
for(const road of roads.values())for(let i=1;i<road.pts.length;i++) {
 const [a,b]=[road.pts[i-1],road.pts[i]],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
 const near=[];
 for(let s=route.stations[10].s+72;s<route.stations[11].s-72;s+=1) {
  const l=layout(route,null,s);
  for(const offset of [l.min,0,l.max]) {
   const p=sample(route,s,offset),along=((p.x-a[0])*dx+(p.z-a[1])*dz)/length;
   const across=((p.z-a[1])*dx-(p.x-a[0])*dz)/length;
   // Road legs can end at a Broadway carriageway before reaching its median.
   // Include the intersection apron across that remaining 20 m.
   if(along< -20||along>length+20||Math.abs(across)>road.width/2)continue;
   assert(p.y<-5.7,`${road.name}: entire bore roof must remain below street (height ${p.y})`);
   near.push(p);crossings.add(road.name);samples++;
  }
 }
 if(!near.length)continue;
 // Run the actual street cutter on the crossing's full-width road ribbon.
 // Both paving and its collider must survive above the buried track.
 const normal=[-dz/length*road.width/2,dx/length*road.width/2];
 const start=[a[0]-dx/length*20,a[1]-dz/length*20],end=[b[0]+dx/length*20,b[1]+dz/length*20];
 const position=Float32Array.from([start,end,end,start].flatMap((p,j)=>[p[0]+normal[0]*(j<2?1:-1),.025,p[1]+normal[1]*(j<2?1:-1)]));
 const index=[0,1,2,0,2,3];
 const holes=[...new Set(near.flatMap(p=>holesForTile({tx:Math.floor(p.x/256),tz:Math.floor(p.z/256)})))];
 const cut=cutSurface({position:{array:position,itemSize:3}},index,holes);
 for(const p of near)assert(covered(cut?.attributes.position.array??position,cut?.index??index,p.x,p.z,.025),`${road.name}: street stays continuous over tracks`);
}
assert.deepEqual([...crossings].sort(),['West 120th Street','West 121st Street','West 122nd Street','West 123rd Street']);
assert(samples>100);
assert.deepEqual(footprints.surface.slice(0,portalHoles.length),portalHoles.map(r=>r.map(p=>p.map(n=>Number(n.toFixed(3))))));

// The replacement approach still gives trains a continuous, driveable grade
// and exactly the same floor as their rendered track and collision geometry.
const segments=[...route.segmentsByTile.values()].flat().filter(([a,b])=>a.s<route.stations[11].s-72&&b.s>route.stations[10].s+72);
const geometry=buildTrack(segments,[],route,true).collision;
for(let s=route.stations[10].s+72;s<route.stations[11].s-72;s+=9) {
 const p=sample(route,s,2);
 assert(covered(geometry.position,geometry.index,p.x,p.z,p.y-.14),'ballast collision follows the approach');
 assert(Math.abs(route.height(s+.5)-route.height(s))/.5<=.06001,'grade stays under 6%');
}
assert.equal(route.stations[10].y,-12);
assert.equal(route.stations[11].y,8);
console.log(`PASS Broadway approach: ${samples} real crossing samples, intact paving, buried roofs, matching worker cutouts and track collision`);
