// Station navigation uses the same polyline for mesh, collision and agents.
export function pathFrom(points) {
  let s=0;
  return points.map((p,i)=>{if(i)s+=Math.hypot(p.x-points[i-1].x,p.z-points[i-1].z);return {...p,s};});
}
export function onPath(path,distance) {
  const s=Math.max(0,Math.min(path.at(-1).s,distance));
  let i=1;while(i<path.length-1&&path[i].s<s)i++;
  const a=path[i-1],b=path[i],t=(s-a.s)/(b.s-a.s||1),d=Math.hypot(b.x-a.x,b.z-a.z)||1;
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,dx:(b.x-a.x)/d,dz:(b.z-a.z)/d,s};
}
export function pathFloor(path,x,z,width=1.1,referenceY) {
  let best=null,delta=Infinity;
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],dx=b.x-a.x,dz=b.z-a.z,d=dx*dx+dz*dz;
    if(d<1e-8)continue;
    let t=((x-a.x)*dx+(z-a.z)*dz)/(d||1);
    if(t<-.000001||t>1.000001||Math.hypot(x-a.x-dx*t,z-a.z-dz*t)>width)continue;
    t=Math.max(0,Math.min(1,t));
    // A continuous walking surface avoids capsule catches on internal tread
    // edges; the visible steps stay within half a riser of this surface.
    const y=a.y+(b.y-a.y)*t+(Math.abs(b.y-a.y)>.001?Math.sign(b.y-a.y)*.085:0);
    if(referenceY===undefined)return y;
    if(Math.abs(y-referenceY)<delta){delta=Math.abs(y-referenceY);best=y;}
  }
  return best;
}
export function accessRing(a,b,width=1.25) {
  const d=Math.hypot(b.x-a.x,b.z-a.z)||1,nx=-(b.z-a.z)/d*width,nz=(b.x-a.x)/d*width;
  return [[a.x-nx,a.z-nz],[b.x-nx,b.z-nz],[b.x+nx,b.z+nz],[a.x+nx,a.z+nz]];
}
// Short flights with level resting landings. The overall grade stays below
// the character controller's climb limit; no single flight spans a deep storey.
export function stairRun(rise) {const flights=Math.max(1,Math.ceil(Math.abs(rise)/3.2));return Math.max(4,Math.abs(rise)/.7+(flights-1)*1.6);}
export function stairPath(a,b) {
 const rise=b.y-a.y,flights=Math.max(1,Math.ceil(Math.abs(rise)/3.2)),length=Math.hypot(b.x-a.x,b.z-a.z);
 const landing=flights>1?1.6:0,run=(length-landing*(flights-1))/flights,dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
 const points=[a];let distance=0;
 for(let i=1;i<=flights;i++) {
  distance+=run;const y=a.y+rise*i/flights;
  points.push({...a,x:a.x+dx*distance,y,z:a.z+dz*distance});
  if(i<flights){distance+=landing;points.push({...a,x:a.x+dx*distance,y,z:a.z+dz*distance});}
 }
 points[points.length-1]=b;return pathFrom(points);
}
export function planHub(station,route,sample,offset,concourseY) {
  const half=(station.length??route.platformLength??120)/2, floor=station.y+1.15,base=station.y<0?(concourseY??Math.min(-3.5,station.y+6.4)):.16;
  const run=stairRun(floor-base),start=station.s-half+4,end=Math.min(start+run,station.s+half-12);
  const a={...sample(route,start,offset),y:base},b={...sample(route,end,offset),y:floor};
  return {stationKey:station.key,routeId:route.id,offset,start,end,path:stairPath(a,b),wait:{...sample(route,Math.min(end+10,station.s+half-6),offset),y:floor}};
}
export function planAccess(entry,hub) {
  const a={x:entry.x-entry.dx*3.1,y:.16,z:entry.z-entry.dz*3.1},depth=hub.path[0].y;
  const run=Math.max(6.2,stairRun(a.y-depth)),b={x:a.x+entry.dx*run,y:depth,z:a.z+entry.dz*run};
  // Approach the foot of the platform stairs from behind, leaving room to turn
  // before the first riser instead of meeting its side at an oblique angle.
  const c=hub.path[0],d=hub.path[1],length=Math.hypot(d.x-c.x,d.z-c.z)||1;
  const landing={x:c.x-(d.x-c.x)/length*4,y:depth,z:c.z-(d.z-c.z)/length*4};
  const dx=(d.x-c.x)/length,dz=(d.z-c.z)/length,along=(b.x-landing.x)*dx+(b.z-landing.z)*dz,side=Math.sign(hub.offset||1)*4;
  // Branch sideways off each entrance flight onto a shared longitudinal
  // concourse. It cannot run underneath the next entrance's descending stairs.
  const outer={x:landing.x-dz*side,y:depth,z:landing.z+dx*side};
  const corner={x:outer.x+dx*along,y:depth,z:outer.z+dz*along};
  return {...entry,stationKey:hub.stationKey,flightEnd:stairPath(a,b).length-1,path:pathFrom([...stairPath(a,b),corner,outer,landing,c].filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.z-all[i-1].z)>.01))};
}
