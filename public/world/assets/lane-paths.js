import { deckEdges } from './edges.js';
import { isHighway } from './lane-layout.js';
const cache = new WeakMap();
/** Densify the same lane guide used for paint, retaining original graph nodes. */
export function highwayLanePath(road, roads, segment, offset) {
  if (!isHighway(road)) return null;
  let layouts=cache.get(roads);if(!layouts){layouts=new Map();cache.set(roads,layouts);}
  let edges=layouts.get(road.id);if(!edges){edges=deckEdges(road,roads,Math.max(3.2,road.width/2));layouts.set(road.id,edges);}
  let start=0;
  for(let i=1;i<=segment;i++)start+=Math.hypot(road.pts[i][0]-road.pts[i-1][0],road.pts[i][1]-road.pts[i-1][1]);
  const a=road.pts[segment],b=road.pts[segment+1],run=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const count=Math.max(1,Math.ceil(run/4)),path=[];let length=0;
  for(let i=0;i<=count;i++){
    const [x,z]=edges.line(start+run*i/count,offset),prev=path.at(-1);
    if(prev)length+=Math.hypot(x-prev.x,z-prev.z);
    path.push({x,z,s:length});
  }
  const first=path[0],last=path.at(-1),chord=Math.hypot(last.x-first.x,last.z-first.z)||1;
  return {path,length,ax:first.x,az:first.z,bx:last.x,bz:last.z,dx:(last.x-first.x)/chord,dz:(last.z-first.z)/chord};
}
export function lanePoint(lane, along) {
  if(!lane.path)return{x:lane.ax+lane.dx*along,z:lane.az+lane.dz*along,dx:lane.dx,dz:lane.dz};
  const path=lane.path;let lo=0,hi=path.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(path[mid].s<along)lo=mid;else hi=mid;}
  const a=path[lo],b=path[hi],d=b.s-a.s||1,t=Math.max(0,Math.min(1,(along-a.s)/d));
  return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,dx:(b.x-a.x)/d,dz:(b.z-a.z)/d};
}
