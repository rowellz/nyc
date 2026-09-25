import { cutGround } from '../tunnels.js';
import { holesForTile } from './footprints.js?v=terrain-elevation-92';

/** Cut only street-level paving. An independent bridge above a rail portal
 * keeps its deck and collider. Interpolate every packed material attribute. */
export function cutSurface(attributes,index,holes) {
  if (!holes.length || !index.length) return null;
  const positions=attributes.position.array, selected=[],keep=[];
  for(let i=0;i<index.length;i+=3) {
    const tri=[index[i],index[i+1],index[i+2]];
    (tri.every(v=>positions[v*3+1]>=-0.6&&positions[v*3+1]<=0.65)?selected:keep).push(...tri);
  }
  if (!selected.length) return null;
  const cut=cutGround(attributes,selected,holes,[-0.6,0.65]);
  const offset=positions.length/3;
  const result={attributes:{},index:Uint32Array.from([...keep,...cut.index].map((v,i)=>i<keep.length?v:v+offset))};
  for(const [name,a] of Object.entries(attributes)) {
    const values=new a.array.constructor(a.array.length+cut.attributes[name].array.length);
    values.set(a.array);values.set(cut.attributes[name].array,a.array.length);
    result.attributes[name]={array:values,itemSize:a.itemSize};
  }
  return result;
}

export function cutRailStreets(built,tile) {
  const holes=holesForTile(tile);
  if(!holes.length)return built;
  for(const mesh of built.meshes) {
    if(!mesh)continue;
    const attributes=Object.fromEntries(Object.entries(mesh.attributes).map(([k,a])=>[k,{array:a.data,itemSize:a.size}]));
    const cut=cutSurface(attributes,mesh.index,holes);
    if(cut) {
      mesh.attributes=Object.fromEntries(Object.entries(cut.attributes).map(([k,a])=>[k,{data:a.array,size:a.itemSize}]));
      mesh.index=cut.index;
    }
  }
  for(const collider of [built.walkCollision,...built.colliders]) {
    const cut=cutSurface({position:{array:collider.position,itemSize:3}},collider.index,holes);
    if(cut){collider.position=cut.attributes.position.array;collider.index=cut.index;}
  }
  return built;
}
