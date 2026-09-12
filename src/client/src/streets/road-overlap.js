/** Give overlapping coplanar asphalt one visible surface, not two competing depth values.
 * Roadbeds, fallback ribbons and ramp approaches can all pave the same ground.
 * Work in tile-local coordinates for stable clipping at large world coordinates.
 */
const CELL = 16;
const EPS = 1e-7;
function area(poly) {
  const a=poly[0]; let sum=0;
  for(let i=1;i+1<poly.length;i++) sum+=(poly[i][0]-a[0])*(poly[i+1][1]-a[1])-(poly[i][1]-a[1])*(poly[i+1][0]-a[0]);
  return sum/2;
}
function split(poly,a,b,sign) {
  const near=[],far=[];
  const dist=p=>sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
  for(let i=0;i<poly.length;i++) {
    const p=poly[i],q=poly[(i+1)%poly.length],dp=dist(p),dq=dist(q);
    if(dp>=0)near.push(p);
    if(dp<=0)far.push(p);
    if(dp>0&&dq<0||dp<0&&dq>0){const t=dp/(dp-dq),v=[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];near.push(v);far.push(v);}
  }
  return [near,far];
}
function subtract(poly,clip) {
  let kept=poly;const result=[],sign=Math.sign(area(clip));
  for(let i=0;i<clip.length&&kept.length>=3;i++) {
    const [near,far]=split(kept,clip[i],clip[(i+1)%clip.length],sign);
    kept=near;
    if(far.length>=3&&Math.abs(area(far))>EPS)result.push(far);
  }
  return kept.length<3||Math.abs(area(kept))<=EPS?[poly]:result;
}
function bounds(poly) {
  return {x0:Math.min(...poly.map(p=>p[0])),x1:Math.max(...poly.map(p=>p[0])),
    z0:Math.min(...poly.map(p=>p[1])),z1:Math.max(...poly.map(p=>p[1]))};
}

export function resolveRoadOverlaps(gb, ox=0, oz=0) {
  const grid=new Map(), original=gb.idx, indices=[];
  let removedArea=0;
  for(let i=0;i<original.length;i+=3) {
    const ids=original.slice(i,i+3),p=ids.map(v=>[gb.pos[v*3]-ox,gb.pos[v*3+2]-oz]);
    const signed=area(p),bb=bounds(p);
    if(Math.abs(signed)<=EPS){indices.push(...ids);continue;}
    const y=ids.map(v=>gb.pos[v*3+1]);
    const bx=p[1][0]-p[0][0],bz=p[1][1]-p[0][1],cx=p[2][0]-p[0][0],cz=p[2][1]-p[0][1],det=2*signed;
    const weights=q=>{const dx=q[0]-p[0][0],dz=q[1]-p[0][1];const v=(dx*cz-dz*cx)/det,w=(bx*dz-bz*dx)/det;return [1-v-w,v,w];};
    const hx=((y[1]-y[0])*cz-(y[2]-y[0])*bz)/det;
    const hz=(bx*(y[2]-y[0])-cx*(y[1]-y[0]))/det;
    const h0=y[0]-hx*p[0][0]-hz*p[0][1];
    const keys=[],near=new Set();
    for(let x=Math.floor(bb.x0/CELL);x<=Math.floor(bb.x1/CELL);x++)for(let z=Math.floor(bb.z0/CELL);z<=Math.floor(bb.z1/CELL);z++) {
      const key=`${x},${z}`;keys.push(key);for(const tri of grid.get(key)??[])near.add(tri);
    }
    let parts=[p],changed=false;
    for(const tri of near) {
      if(tri.bb.x1<=bb.x0+EPS||tri.bb.x0>=bb.x1-EPS||tri.bb.z1<=bb.z0+EPS||tri.bb.z0>=bb.z1-EPS)continue;
      // Require matching planes, not just a point where ramps at different grades cross.
      if(Math.abs(hx-tri.hx)>1e-6||Math.abs(hz-tri.hz)>1e-6||Math.abs(h0-tri.h0)>1e-5)continue;
      const next=[];
      for(const part of parts){const pieces=subtract(part,tri.p);if(pieces[0]!==part)changed=true;next.push(...pieces);}
      parts=next;if(!parts.length)break;
    }
    if(!changed)indices.push(...ids);
    else {
      removedArea+=Math.abs(signed)-parts.reduce((s,p)=>s+Math.abs(area(p)),0);
      for(const part of parts) {
        const vertices=part.map(q=>{
          const w=weights(q),v=gb.pos.length/3;
          // Interpolate every material attribute so clipping does not stretch wear or change texture direction.
          for(const [name,stride] of [['pos',3],['nrm',3],['aA',4],['aB',4]])for(let k=0;k<stride;k++)
            gb[name].push(ids.reduce((s,id,j)=>s+w[j]*gb[name][id*stride+k],0));
          return v;
        });
        for(let j=1;j+1<vertices.length;j++)indices.push(vertices[0],vertices[j],vertices[j+1]);
      }
    }
    // The original footprint equals kept pieces plus already-owned areas. Indexing it avoids
    // multiplying spatial entries as successive intersection cuts fragment the surface.
    const tri={p,bb,hx,hz,h0};
    for(const key of keys){const list=grid.get(key);if(list)list.push(tri);else grid.set(key,[tri]);}
  }
  gb.idx=indices;
  return removedArea;
}
