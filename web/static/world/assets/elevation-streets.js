import { elevateMesh } from './elevation.js?v=terrain-elevation-92';

function packed(mesh) {
  if (!mesh) return mesh;
  const lifted = elevateMesh(mesh.attributes, mesh.index);
  mesh.attributes = Object.fromEntries(Object.entries(lifted.attributes).map(([name,a])=>[name,{data:a.array,size:a.itemSize}]));
  mesh.index = lifted.index;
  const p = lifted.attributes.position.array;
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for(let i=0;i<p.length;i++) {min[i%3]=Math.min(min[i%3],p[i]);max[i%3]=Math.max(max[i%3],p[i]);}
  mesh.bounds = [...min.map((v,i)=>(v+max[i])/2),Math.hypot(...min.map((v,i)=>(max[i]-v)/2))];
  return mesh;
}
function collision(mesh) {
  const lifted = elevateMesh({position:{array:mesh.position,itemSize:3}},mesh.index);
  return {...mesh,position:lifted.attributes.position.array,index:lifted.index};
}
function walking(mesh,tile) {
  const next=collision(mesh),bins=Array.from({length:1024},()=>[]),p=next.position,idx=next.index;
  for(let i=0;i<idx.length;i+=3) {
    const tri=[idx[i]*3,idx[i+1]*3,idx[i+2]*3];
    const x0=Math.max(0,Math.floor((Math.min(...tri.map(n=>p[n]))-tile.tx*256)/8));
    const x1=Math.min(31,Math.floor((Math.max(...tri.map(n=>p[n]))-tile.tx*256)/8));
    const z0=Math.max(0,Math.floor((Math.min(...tri.map(n=>p[n+2]))-tile.tz*256)/8));
    const z1=Math.min(31,Math.floor((Math.max(...tri.map(n=>p[n+2]))-tile.tz*256)/8));
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++)bins[z*32+x].push(i);
  }
  const offsets=new Uint32Array(1025);
  for(let i=0;i<1024;i++)offsets[i+1]=offsets[i]+bins[i].length;
  return {...next,offsets,triangles:new Uint32Array(bins.flat())};
}
/** The builders and tunnel/rail cuts use local street datum. Publish absolute
 * heights only after all those operations, including their matching colliders. */
export function elevateStreetTile(built,tile) {
  built.meshes=built.meshes.map(packed);
  built.colliders=built.colliders.map(collision);
  if(built.walkCollision)built.walkCollision=walking(built.walkCollision,tile);
  if(built.colliderPos?.length) {
    const c=collision({position:built.colliderPos,index:built.colliderIdx});
    built.colliderPos=c.position;built.colliderIdx=c.index;
  }
  // Deck queries still describe offsets from ground; the street API adds the
  // terrain sample. Keeping these relative preserves tunnel approach cuts.
  return built;
}
