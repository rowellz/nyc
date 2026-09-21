// Planimetric sidewalks are clipped by roadbeds and painted lanes when rendered.
// Placement must use that same ground, rather than a nominal OSM road width.
const driveable = new Set(['motorway','trunk','primary','secondary','tertiary','residential','service']);
const insideRing = (x,z,ring) => {
  let yes=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])yes=!yes;
  }
  return yes;
};
const inside = (x,z,p) => insideRing(x,z,p[0])&&!p.slice(1).some(r=>insideRing(x,z,r));
function polygonIndex(polys) {
  const cells=new Map();
  for(const p of polys) {
    if(!p[0]?.length)continue;
    const xs=p[0].map(v=>v[0]),zs=p[0].map(v=>v[1]);
    for(let x=Math.floor(Math.min(...xs)/16);x<=Math.floor(Math.max(...xs)/16);x++)
      for(let z=Math.floor(Math.min(...zs)/16);z<=Math.floor(Math.max(...zs)/16);z++) {
        const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(p);
      }
  }
  return (x,z)=>(cells.get(`${Math.floor(x/16)},${Math.floor(z/16)}`)??[]).some(p=>inside(x,z,p));
}
export function curbPlanner(tiles) {
  const walks=tiles.flatMap(t=>t.sidewalks??[]), beds=tiles.flatMap(t=>[...(t.roadbeds??[]),...(t.parking??[])]);
  const roadPolys=[...beds],seen=new Set();
  for(const tile of tiles)for(const r of tile.streetContext?.roads??tile.roads??[]) {
    if(seen.has(r.id)||r.bridge||r.tunnel||r.layer>0||!driveable.has(r.cls))continue;
    seen.add(r.id);
    const lanes=Math.max(1,Math.min(10,r.lanes||1));
    const half=Math.max(r.lanes>0&&r.cls!=='service'?lanes*Math.min(3.3,r.width/lanes)/2+.06:0,
      !(tile.roadbeds?.length)?Math.max(2.4,r.width/2):0);
    if(!half)continue;
    for(let i=1;i<r.pts.length;i++) {
      const a=r.pts[i-1],b=r.pts[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<.01)continue;
      const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len;
      const s0=i>1?half:0,s1=i<r.pts.length-1?half:0;
      const ax=a[0]-dx*s0,az=a[1]-dz*s0,bx=b[0]+dx*s1,bz=b[1]+dz*s1,nx=-dz*half,nz=dx*half;
      roadPolys.push([[[ax-nx,az-nz],[bx-nx,bz-nz],[bx+nx,bz+nz],[ax+nx,az+nz]]]);
    }
  }
  const onWalk=polygonIndex(walks),onRoad=polygonIndex(roadPolys);
  const obstacle=polygonIndex(tiles.flatMap(t=>[...(t.water??[]),...(t.buildings??[]).map(b=>b.footprint)]));
  const park=polygonIndex(tiles.flatMap(t=>t.parks??[]));
  const sidewalk=(x,z)=>onWalk(x,z)&&!onRoad(x,z)&&!obstacle(x,z);
  const edges=[];
  for(const tile of tiles)for(const poly of [...(tile.sidewalks??[]),...(tile.roadbeds??[])])for(const ring of poly)for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const seam=[0,1].some(axis=>[0,256].some(d=>Math.abs(a[axis]-(axis===0?tile.tx:tile.tz)*256-d)<.15&&Math.abs(b[axis]-(axis===0?tile.tx:tile.tz)*256-d)<.15));
    if(len>=2&&!seam)edges.push({a,b,dx:(b[0]-a[0])/len,dz:(b[1]-a[1])/len,len});
  }
  const pitFits=(x,z,dx,dz)=>{
    // Include the guard posts and a little paving beyond the mulch rectangle.
    for(const along of [-1.3,0,1.3])for(const across of [-.85,0,.85])
      if(!sidewalk(x+dx*along-dz*across,z+dz*along+dx*across))return false;
    return true;
  };
  return {
    sidewalk,
    tree(tree) {
      if(!Number.isFinite(tree.x)||!Number.isFinite(tree.z)||park(tree.x,tree.z))return tree;
      let best=null,distance=6;
      for(const e of edges) {
        const s=Math.max(0,Math.min(e.len,(tree.x-e.a[0])*e.dx+(tree.z-e.a[1])*e.dz));
        const x=e.a[0]+e.dx*s,z=e.a[1]+e.dz*s;
        if(Math.hypot(x-tree.x,z-tree.z)>6)continue;
        if(pitFits(tree.x,tree.z,e.dx,e.dz))return tree;
        for(const sign of [-1,1])for(const inset of [1,1.5,2,2.5,3]) {
          const px=x-e.dz*sign*inset,pz=z+e.dx*sign*inset,d=Math.hypot(px-tree.x,pz-tree.z);
          if(d>=distance||!pitFits(px,pz,e.dx,e.dz))continue;
          best={...tree,x:px,z:pz};distance=d;
        }
      }
      return best??tree;
    },
    parking(road,segment,d,side,width,length) {
      const a=road.pts[segment],b=road.pts[segment+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(len<.01)return null;
      const dx=(b[0]-a[0])/len,dz=(b[1]-a[1])/len,nx=-dz*side,nz=dx*side;
      const x=a[0]+dx*d,z=a[1]+dz*d;
      // Sample both bumpers as well as the center so a taper cannot put a car
      // corner on the paving. Resolve the first sidewalk on this side only.
      const curbs=[];
      for(const along of [-length/2,0,length/2]) {
        const px=x+dx*along,pz=z+dz*along;
        let curb=null;
        for(let offset=1;offset<=road.width/2+8;offset+=.25) {
          if(!sidewalk(px+nx*offset,pz+nz*offset))continue;
          let lo=offset-.25,hi=offset;
          for(let k=0;k<10;k++){const mid=(lo+hi)/2;if(sidewalk(px+nx*mid,pz+nz*mid))hi=mid;else lo=mid;}
          curb=hi;break;
        }
        curbs.push(curb);
      }
      if(curbs.some(c=>c===null)&&curbs.some(c=>c!==null))return null;
      const curb=curbs[0]===null?road.width/2:Math.min(...curbs);
      const offset=curb-width/2-.25;
      if(offset<=0)return null;
      for(const along of [-length/2,0,length/2])for(const across of [-width/2,0,width/2]) {
        const px=x+dx*along+nx*(offset+across),pz=z+dz*along+nz*(offset+across);
        if(onWalk(px,pz)&&!onRoad(px,pz)||obstacle(px,pz)||park(px,pz))return null;
      }
      return offset*side;
    },
  };
}
const planners=new WeakMap();
export function parkingOffset(tile,road,segment,d,side,width,length) {
  let plan=planners.get(tile);
  if(!plan){plan=curbPlanner([tile]);planners.set(tile,plan);}
  return plan.parking(road,segment,d,side,width,length);
}
export function alignStreetTrees(tile,neighbors=[tile]) {
  if(!tile.trees?.length)return tile;
  const plan=curbPlanner(neighbors);
  return {...tile,trees:tile.trees.map(tree=>plan.tree(tree))};
}
