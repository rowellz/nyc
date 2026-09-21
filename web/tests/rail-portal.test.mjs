import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';
const rail=name=>new URL(`rail/${name}.js?v=${CLIENT_REVISION}`,assets);
const {parkAvenue:r,sample,layout,route:broadway}=await import(rail('network'));
const {buildTrack}=await import(rail('geometry'));
const {triangleHeight}=await import(new URL('supports.js',assets));
const tile=JSON.parse(gunzipSync(readFileSync(new URL('../../public/world/world/tiles/10_-15.json.gz',import.meta.url))));

// Exercise the served worker on the actual 97th Street sidewalk polygons.
let response;
const scope={console,performance,self:{postMessage:r=>{response=r;}}};
const worker=readFileSync(new URL('tile.worker-Ai2ZdmRL.js',assets),'utf8');
for(const match of worker.matchAll(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?$/gm)) {
 const module=await import(new URL(match[2],assets));
 for(const binding of match[1].split(',')){const [name,alias=name]=binding.trim().split(/\s+as\s+/);scope[alias]=module[name];}
}
let uncut;const cut=scope.$railCuts;scope.$railCuts=(built,tile)=>{uncut=structuredClone(built);return cut(built,tile);};
vm.createContext(scope);vm.runInContext(worker.replace(/^import .*$/gm,''),scope);
await scope.self.onmessage({data:{id:1,input:{tile,roads:tile.roads,pedestrianTiles:[tile],quality:{level:'mobile',shadows:false}}}});
assert(!response.error,response.error);
function inside(r,x,z) {
 let hit=false;
 for(let i=0,j=r.length-1;i<r.length;j=i++) {
  const a=r[i],b=r[j];
  if((a[1]>z)!=(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;
 }
 return hit;
}
function covered(position,index,x,z,minY,maxY) {
 for(let i=0;i<index.length;i+=3) {
  const hit=triangleHeight([0,1,2].map(j=>Array.from(position.slice(index[i+j]*3,index[i+j]*3+3))),x,z);
  if(hit?.inside&&hit.height>=minY&&hit.height<=maxY)return true;
 }
 return false;
}
let checks=0,collisionChecks=0;
for(let s=4495;s<4535;s+=.5)for(let offset=-6.5;offset<=6.5;offset+=.5) {
 const p=sample(r,s,offset);
 if(!tile.sidewalks.some(poly=>inside(poly[0],p.x,p.z)&&!poly.slice(1).some(h=>inside(h,p.x,p.z))))continue;
 assert(p.y+5.525<0,'bore roof clears the full sidewalk');
 assert(response.built.meshes.filter(Boolean).some(m=>covered(m.attributes.position.data,m.index,p.x,p.z,0,.65)),'rendered sidewalk remains above tunnel');
 const colliders=[response.built.walkCollision,...response.built.colliders];
 const original=[uncut.walkCollision,...uncut.colliders];
 if(original.some(m=>covered(m.position,m.index,p.x,p.z,0,.65))) {
  assert(colliders.some(m=>covered(m.position,m.index,p.x,p.z,0,.65)),'existing sidewalk collision remains above tunnel');collisionChecks++;
 }
 checks++;
}
assert(checks>300);assert(collisionChecks>100);

// Cast horizontal rays through the collision envelope between visible posts.
// Express a vertical plane in triangleHeight's horizontal coordinates.
function barrier(geometry,p,along,height,offset) {
 const position=[];
 for(let i=0;i<geometry.position.length;i+=3) {
  const dx=geometry.position[i]-p.x,dz=geometry.position[i+2]-p.z;
  position.push(dx*p.dx+dz*p.dz,-dx*p.dz+dz*p.dx,geometry.position[i+1]);
 }
 return covered(position,geometry.index,along,height,offset-.15,offset+.15);
}
for(const route of [r,broadway]) {
 const cap=route.portalCaps[0];assert(Number.isFinite(cap));
 const segments=[...route.segmentsByTile.values()].flat().filter(([a,b])=>a.s<cap+45&&b.s>cap-5);
 const built=buildTrack(segments,[],route,true);
 for(let s=cap+1;s<cap+40;s+=1.3) {
  const p=sample(route,s),l=layout(route,null,s);
  for(const offset of [l.min-.2,l.max+.2])for(const y of [.5,1,1.45])assert(barrier(built.collision,p,0,y,offset),'side rail blocks pedestrians between posts');
 }
 const p=sample(route,cap),l=layout(route,null,cap);
 const across={...p,dx:-p.dz,dz:p.dx};
 for(let offset=l.min;offset<=l.max;offset+=.7)for(const y of [.5,1,1.45])assert(barrier(built.collision,across,offset,y,0),'end rail closes the sidewalk-facing lip');
 // The cap stays above the bore: trains retain at least 5 m headroom.
 assert(!barrier(built.collision,across,0,p.y+4,0),'end rail does not block trains');
 const metal=built.layers.get('green');assert(metal?.index.length,'visible railing metalwork is emitted');
 for(const [a,b] of segments) {
  const single=buildTrack([[a,b]],[],route,true);
  assert(single.collision.position.every(Number.isFinite),'tile-independent portal geometry stays finite');
 }
}
console.log(`PASS ${checks} actual Park Avenue sidewalk samples retain paving/collision; Park Avenue and Broadway portal rails protect both sides and the head`);
