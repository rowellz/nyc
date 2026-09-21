// The surface streamer has a tile halo; that must not implicitly build every
// stacked subway corridor beneath it. Keep collision and rendering together.
export function railBounds(points, padding = 0) {
  const min={x:Infinity,y:Infinity,z:Infinity},max={x:-Infinity,y:-Infinity,z:-Infinity};
  for(const p of points)for(const axis of ['x','y','z']){
    min[axis]=Math.min(min[axis],p[axis]);max[axis]=Math.max(max[axis],p[axis]);
  }
  min.x-=padding;min.z-=padding;min.y-=1;
  max.x+=padding;max.z+=padding;max.y+=6;
  return {min,max};
}

export function distanceToRail(bounds, camera) {
  return Math.hypot(...['x','y','z'].map(axis=>Math.max(bounds.min[axis]-camera[axis],0,camera[axis]-bounds.max[axis])));
}

export function createRailBudget(ctx, openings) {
  const mobile=ctx.quality.level==='mobile',ios=ctx.world?.ios===true;
  const buckets=new Map();
  for(const ring of openings) {
    const x=ring.reduce((n,p)=>n+p[0],0)/ring.length,z=ring.reduce((n,p)=>n+p[1],0)/ring.length;
    const key=`${Math.floor(x/128)}_${Math.floor(z/128)}`;
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({x,z});
  }
  return (candidates, resident) => {
    if(!mobile)return new Set(candidates.map(job=>job.id));
    const camera=ctx.camera.position,tx=Math.floor(camera.x/128),tz=Math.floor(camera.z/128);
    let entranceDistance=Infinity;
    if(camera.y<24)for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)
      for(const p of buckets.get(`${tx+dx}_${tz+dz}`)??[])
        entranceDistance=Math.min(entranceDistance,Math.hypot(p.x-camera.x,p.z-camera.z));
    const ranked=[];
    for(const job of candidates) {
      const held=resident.has(job.id),distance=distanceToRail(job.bounds,camera);
      const entrance=entranceDistance<=(held?88:64);
      // Leave the entrances and surface/elevated railway intact. Buried
      // corridors are useful only underground or close to a surface opening.
      if(job.buried && camera.y>=1 && !entrance && !job.station)continue;
      const range=job.buried ? (camera.y<1?176:96) : 256;
      if(distance>range+(held?48:0))continue;
      // A station owns its entrance stairs, so use their bounds even above
      // ground. Its large below-ground interior still gets a tighter range.
      if(job.station&&job.buried&&camera.y>=1&&!entrance&&distance>32)continue;
      ranked.push({job,rank:distance-(held?16:0)});
    }
    ranked.sort((a,b)=>a.rank-b.rank||a.job.id.localeCompare(b.job.id));
    let tracks=0,stations=0;const selected=new Set();
    for(const {job} of ranked) {
      if(job.station){if(stations>=(ios?4:6))continue;stations++;}
      else {if(tracks>=(ios?32:48))continue;tracks++;}
      selected.add(job.id);
    }
    return selected;
  };
}
