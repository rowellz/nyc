// Convex walking volumes cut only their actual overlap from enclosure panels.
// Keep the remaining sill, lintel and jamb geometry, including collision faces.
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function passageVolume(a,b,half=1.4,bottom=-.2,top=2.9,offset=0) {
 const length=Math.hypot(b.x-a.x,b.z-a.z);if(length<.001)return null;
 const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length,slope=(b.y-a.y)/length;
 const origin=[a.x,a.y,a.z],u=[dx,0,dz],n=[-dz,0,dx],up=[-slope*dx,1,-slope*dz];
 const plane=(normal,value)=>({normal,value:dot(normal,origin)+value});
 const neg=v=>v.map(x=>-x);
 return {planes:[plane(u,length+.025),plane(neg(u),.025),plane(n,offset+half),plane(neg(n),half-offset),plane(up,top),plane(neg(up),-bottom)],
  bounds:[Math.min(a.x,b.x)-half-Math.abs(offset),Math.max(a.x,b.x)+half+Math.abs(offset),Math.min(a.z,b.z)-half-Math.abs(offset),Math.max(a.z,b.z)+half+Math.abs(offset)]};
}
function split(poly,{normal,value}) {
 const distances=poly.map(p=>dot(normal,p)-value);
 if(distances.every(d=>d<=1e-8))return [poly,[]];
 if(distances.every(d=>d>=-1e-8))return [[],poly];
 const inside=[],outside=[];
 for(let i=0;i<poly.length;i++) {
  const a=poly[i],b=poly[(i+1)%poly.length],da=dot(normal,a)-value,db=dot(normal,b)-value;
  if(da<=1e-8)inside.push(a);
  if(da>=-1e-8)outside.push(a);
  if((da< -1e-8&&db>1e-8)||(da>1e-8&&db< -1e-8)) {
   const t=da/(da-db),p=a.map((v,j)=>v+(b[j]-v)*t);inside.push(p);outside.push(p);
  }
 }
 return [inside,outside];
}
export function cutPanel(points,volumes) {
 let pieces=[points];
 for(const volume of volumes) {
  if(!volume)continue;
  const [minX,maxX,minZ,maxZ]=volume.bounds;
  if(points.every(p=>p[0]<minX)||points.every(p=>p[0]>maxX)||points.every(p=>p[2]<minZ)||points.every(p=>p[2]>maxZ))continue;
  if(volume.planes.some(({normal,value})=>points.every(p=>dot(normal,p)-value>1e-8)))continue;
  const remaining=[];
  for(const piece of pieces) {
   let inside=piece;
   for(const plane of volume.planes) {
    const [next,outside]=split(inside,plane);if(outside.length>=3)remaining.push(outside);
    inside=next;if(inside.length<3)break;
   }
  }
  pieces=remaining;if(!pieces.length)break;
 }
 return pieces;
}
export function panelMesh(points,thickness,cuts=[]) {
 const position=[],index=[];
 for(const poly of cutPanel(points,cuts)) {
  const a=poly[0];let normal,length=0;
  for(let i=1;i<poly.length-1&&length<1e-8;i++) {
   const u=poly[i].map((v,j)=>v-a[j]),v=poly[i+1].map((v,j)=>v-a[j]);
   normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];length=Math.hypot(...normal);
  }
  if(length<1e-8)continue;
  const base=position.length/3,n=poly.length,delta=normal.map(v=>v/length*thickness/2);
  for(const sign of [1,-1])for(const p of poly)position.push(...p.map((v,i)=>v+sign*delta[i]));
  for(let i=1;i<n-1;i++)index.push(base,base+i,base+i+1,base+n,base+n+i+1,base+n+i);
  for(let i=0;i<n;i++){const j=(i+1)%n;index.push(base+i,base+n+i,base+n+j,base+i,base+n+j,base+j);}
 }
 return {position,index};
}
export function wallPanel(a,b,offset,bottom,top) {
 const d=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/d,dz=(b.z-a.z)/d;
 const p=(q,y)=>[q.x-dz*offset,q.y+y,q.z+dx*offset];
 return [p(a,bottom),p(b,bottom),p(b,top),p(a,top)];
}
export function roofPanel(a,b,min,max,height) {
 const d=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/d,dz=(b.z-a.z)/d;
 const p=(q,offset)=>[q.x-dz*offset,q.y+height,q.z+dx*offset];
 return [p(a,min),p(b,min),p(b,max),p(a,max)];
}
