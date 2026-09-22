/** Index surface road ribbons beneath elevated railway segments. Run after
 * importing roads or rails, then regenerate rail footprints. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {authoredRoutes,layout} from '../web/static/world/assets/rail/network.js';
import {mappedData} from '../web/static/world/assets/rail/mapped-data.js';
import {roadClearanceProfile,roadTunnelProfile,planRoadCrossings,roadBoundsProfile,MAX_PORTAL_GRADE} from '../web/static/world/assets/rail/corridor.js';

const TILE=256;
const classes=new Set(['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','living_street','service','unclassified']);
const tiles=new Map();
function roadsIn(tx,tz) {
  const key=`${tx}_${tz}`;
  if(tiles.has(key))return tiles.get(key);
  const file=new URL(`../public/world/world/tiles/${key}.json.gz`,import.meta.url);
  const result=[];
  if(existsSync(file))for(const road of JSON.parse(gunzipSync(readFileSync(file))).roads??[]) {
    if(!classes.has(road.cls)||road.bridge||road.tunnel||road.pts.length<2)continue;
    for(let i=1;i<road.pts.length;i++)result.push({a:road.pts[i-1],b:road.pts[i],width:road.width??8});
  }
  tiles.set(key,result);
  return result;
}
function pointDistance(p,a,b) {
  const dx=b[0]-a[0],dz=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}
function segmentDistance(a,b,c,d) {
  const ax=b[0]-a[0],az=b[1]-a[1],bx=d[0]-c[0],bz=d[1]-c[1];
  const det=ax*bz-az*bx;
  if(Math.abs(det)>1e-9) {
    const cx=c[0]-a[0],cz=c[1]-a[1];
    const t=(cx*bz-cz*bx)/det,u=(cx*az-cz*ax)/det;
    if(t>=0&&t<=1&&u>=0&&u<=1)return 0;
  }
  return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
}
function simplifyProfile(points) {
  const keep=new Set([0,points.length-1]);
  const split=(start,end)=>{
    const a=points[start],b=points[end];let error=1e-7,index;
    for(let i=start+1;i<end;i++) {
      const p=points[i],e=Math.abs(p[1]-a[1]-(b[1]-a[1])*(p[0]-a[0])/(b[0]-a[0]||1));
      if(e>error){error=e;index=i;}
    }
    if(index!==undefined){keep.add(index);split(start,index);split(index,end);}
  };
  split(0,points.length-1);
  return [...keep].sort((a,b)=>a-b).map(i=>points[i]);
}
const result={},tunnels={},conflicts=[],plans={};
const source=[
  ...authoredRoutes.map(r=>({id:r.id,stations:r.stations.map(st=>({...st,y:r.roadBaseHeight(st.s),length:st.length??r.platformLength??120})),points:r.roadBasePoints.map(p=>({x:p.x,z:p.z,s:p.s,y:r.roadBaseHeight(p.s),half:layout(r,null,p.s).width/2,center:layout(r,null,p.s).center,bridge:r.roadBaseHeight(p.s)>.5}))})),
  ...mappedData.routes.map(r=>({id:r.id,stations:r.stations,points:r.points.map(([x,z,y,s,structure])=>({x,z,y,s,half:2.3,center:0,bridge:structure===2}))})),
];
for(const route of source) {
  const spans=[];
  for(let i=1;i<route.points.length;i++) {
    const a=route.points[i-1],b=route.points[i];
    if(!(a.bridge||b.bridge)||Math.min(a.y,b.y)>=7.5)continue;
    const tx=Math.floor((a.x+b.x)/2/TILE),tz=Math.floor((a.z+b.z)/2/TILE);
    const p=[a.x,a.z],q=[b.x,b.z];
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const road of roadsIn(tx+dx,tz+dz)) {
      const radius=road.width/2+2.5;
      if(Math.min(p[0],q[0])-radius>Math.max(road.a[0],road.b[0])||Math.max(p[0],q[0])+radius<Math.min(road.a[0],road.b[0])||
         Math.min(p[1],q[1])-radius>Math.max(road.a[1],road.b[1])||Math.max(p[1],q[1])+radius<Math.min(road.a[1],road.b[1]))continue;
      if(segmentDistance(p,q,road.a,road.b)<=radius)spans.push([Math.max(0,a.s-4),Math.min(route.points.at(-1).s,b.s+4)]);
    }
  }
  if(!spans.length)continue;
  spans.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const [a,b] of spans) {
    if(merged.length&&a<=merged.at(-1)[1]+8)merged.at(-1)[1]=Math.max(b,merged.at(-1)[1]);
    else merged.push([a,b]);
  }
  result[route.id]=merged.map(pair=>pair.map(n=>Number(n.toFixed(3))));
}
// A raised approach must also fit below subsequent road crossings. Use the
// original structure/height to retain their intended underground relationship.
for(const route of source) {
  if(!result[route.id])continue;
  const points=route.points;
  const base=s=>{
    let lo=0,hi=points.length-1;
    while(lo+1<hi){const m=(lo+hi)>>1;if(points[m].s<=s)lo=m;else hi=m;}
    const a=points[lo],b=points[hi],t=Math.max(0,Math.min(1,(s-a.s)/(b.s-a.s||1)));
    return a.y+(b.y-a.y)*t;
  };
  const raised=roadClearanceProfile(base,route.stations,result[route.id]),spans=[];
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i];
    if(a.bridge||b.bridge||Math.max(a.y,b.y)>-6.5)continue;
    const tx=Math.floor((a.x+b.x)/2/TILE),tz=Math.floor((a.z+b.z)/2/TILE),p=[a.x,a.z],q=[b.x,b.z];
    // Only inspect the neighbourhood influenced by a raised approach.
    if(Math.max(raised(a.s),raised(b.s))<-9)continue;
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const road of roadsIn(tx+dx,tz+dz)) {
      if(segmentDistance(p,q,road.a,road.b)<=road.width/2+5.5)
        spans.push([Math.max(0,a.s-8),Math.min(points.at(-1).s,b.s+8)]);
    }
  }
  spans.sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const [a,b] of spans) {
    if(merged.length&&a<=merged.at(-1)[1]+8)merged.at(-1)[1]=Math.max(b,merged.at(-1)[1]);
    else merged.push([a,b]);
  }
  // A ribbon spanning a bridge-tag boundary is still the same overpass;
  // assigning it both vertical relationships would produce conflicting bounds.
  const affected=merged.filter(([a,b])=>a>0&&b<points.at(-1).s
    &&!result[route.id].some(([u,v])=>a<=v&&b>=u)
    &&points.some(p=>p.s>=a&&p.s<=b&&raised(p.s)>-6.5));
  const feasible=affected.filter(span=>{
    try {
      const {caps,rejected}=roadTunnelProfile(raised,route.stations,result[route.id],[span],points.at(-1).s);
      if(caps.length)return true;
      conflicts.push({route:route.id,span,grade:Number.isFinite(rejected[0].grade)?rejected[0].grade:null,
        reason:'Cannot preserve road and station clearances within the portal grade limit'});
    } catch(error) {conflicts.push({route:route.id,span,reason:error.message});}
    return false;
  });
  if(feasible.length)tunnels[route.id]=feasible.map(pair=>pair.map(n=>Number(n.toFixed(3))));
}
// Audit the full rendered width, including shallow transition segments that
// have neither bridge clearance nor a buried roof. Re-plan those corridors as
// a sequence of crossings, keeping platforms fixed and portals between roads.
for(const route of source) {
  const points=route.points,length=points.at(-1).s;
  const base=s=>{
    let lo=0,hi=points.length-1;
    while(lo+1<hi){const m=(lo+hi)>>1;if(points[m].s<=s)lo=m;else hi=m;}
    const a=points[lo],b=points[hi],t=Math.max(0,Math.min(1,(s-a.s)/(b.s-a.s||1)));
    return a.y+(b.y-a.y)*t;
  };
  const raised=roadClearanceProfile(base,route.stations,result[route.id]);
  const old=roadTunnelProfile(raised,route.stations,result[route.id]??[],tunnels[route.id]??[],length).height;
  if(!points.some(p=>old(p.s)>-6.5&&old(p.s)<7.5))continue;
  const nearby=p=>{
    const roads=[],tx=Math.floor(p.x/TILE),tz=Math.floor(p.z/TILE);
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)roads.push(...roadsIn(tx+dx,tz+dz));
    return roads;
  };
  const frames=points.map((p,i)=>{
    const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],d=Math.hypot(b.x-a.x,b.z-a.z)||1;
    return {dx:(b.x-a.x)/d,dz:(b.z-a.z)/d};
  });
  // If a broad structure clips just one side of a divided road, use the
  // available median. Bound the adjustment and taper it before platforms.
  const offsets=points.map((p,i)=>{
    if(old(p.s)<-9||old(p.s)>9)return 0;
    const frame=frames[i];let lower=-Infinity,upper=Infinity;
    for(const road of nearby(p)) {
      const dx=road.b[0]-road.a[0],dz=road.b[1]-road.a[1],d=Math.hypot(dx,dz);
      if(!d||Math.abs((dx*frame.dx+dz*frame.dz)/d)<.98)continue;
      const t=((p.x-road.a[0])*dx+(p.z-road.a[1])*dz)/(d*d);
      if(t<0||t>1)continue;
      const offset=(road.a[1]+t*dz-p.z)*frame.dx-(road.a[0]+t*dx-p.x)*frame.dz;
      if(Math.abs(offset)>30)continue;
      if(offset<p.center)lower=Math.max(lower,offset+road.width/2+p.half+.65-p.center);
      else upper=Math.min(upper,offset-road.width/2-p.half-.65-p.center);
    }
    if(!Number.isFinite(lower)||!Number.isFinite(upper)||lower>upper)return 0;
    const room=Math.min(4,...route.stations.map(st=>Math.max(0,Math.abs(st.s-p.s)-(st.length??200)/2-32)*.05),p.s*.05,(length-p.s)*.05);
    return Math.max(-room,Math.min(room,Math.max(lower,Math.min(upper,0))));
  });
  // Extend offsets into neighbouring free space with a bounded horizontal
  // taper. All resulting geometry is checked again against the road ribbons.
  for(let i=1;i<offsets.length;i++) {
    const delta=(points[i].s-points[i-1].s)*.04;
    if(offsets[i-1]>0)offsets[i]=Math.max(offsets[i],offsets[i-1]-delta);
    if(offsets[i-1]<0)offsets[i]=Math.min(offsets[i],offsets[i-1]+delta);
  }
  for(let i=offsets.length-2;i>=0;i--) {
    const delta=(points[i+1].s-points[i].s)*.04;
    if(offsets[i+1]>0)offsets[i]=Math.max(offsets[i],offsets[i+1]-delta);
    if(offsets[i+1]<0)offsets[i]=Math.min(offsets[i],offsets[i+1]+delta);
  }
  for(let i=0;i<offsets.length;i++) {
    const s=points[i].s,room=Math.min(s,length-s,...route.stations.map(st=>Math.max(0,Math.abs(st.s-s)-(st.length??200)/2-12)))*.04;
    offsets[i]=Math.max(-room,Math.min(room,offsets[i]));
  }
  const aligned=points.map((p,i)=>({...p,x:p.x-frames[i].dz*offsets[i],z:p.z+frames[i].dx*offsets[i]}));
  const spans=[];let missed=false;
  const center=(p,i)=>[p.x-frames[i].dz*p.center,p.z+frames[i].dx*p.center];
  for(let i=1;i<aligned.length;i++) {
    const a=aligned[i-1],b=aligned[i];
    if(Math.max(old(a.s),old(b.s))<-9||Math.min(old(a.s),old(b.s))>9)continue;
    const p=center(a,i-1),q=center(b,i);
    for(const road of nearby(a)) {
      const radius=road.width/2+Math.max(a.half,b.half)+.5;
      const intersects=segmentDistance(p,q,road.a,road.b)<=radius;
      if(intersects)spans.push([Math.max(0,a.s-4),Math.min(length,b.s+4)]);
      const originalA=points[i-1],originalB=points[i];
      if(Math.max(old(a.s),old(b.s))>-6.5&&Math.min(old(a.s),old(b.s))<7.5
        &&(intersects||segmentDistance(center(originalA,i-1),center(originalB,i),road.a,road.b)<=radius))missed=true;
    }
  }
  if(!missed)continue;
  const stations=route.stations.map(st=>({...st,y:raised(st.s)}));
  // Lateral alignment can shorten a curve. Scale the vertical slope budget
  // by the shortest actual segment so physical grades still stay below 13%.
  const grade=MAX_PORTAL_GRADE*Math.min(1,...aligned.slice(1).map((p,i)=>Math.hypot(p.x-aligned[i].x,p.z-aligned[i].z)/(p.s-aligned[i].s||1)));
  const bounds=planRoadCrossings(old,stations,spans,length,grade);
  if(!bounds)continue;
  const profile=roadBoundsProfile(old,bounds,grade);
  plans[route.id]={bounds,grade,offsets:simplifyProfile(points.map((p,i)=>[p.s,offsets[i]]))};
  result[route.id]=bounds.filter(b=>b[4]&&b[2]!==null&&b[2]>=7.5).map(b=>b.slice(0,2));
  tunnels[route.id]=bounds.filter(b=>b[4]&&b[3]!==null&&b[3]<=-6.5).map(b=>b.slice(0,2));
  // Store the unmodified input to the bounds, so generation does not depend on
  // whichever revision of this generated plan was imported by the runtime.
  plans[route.id].base=simplifyProfile(points.map(p=>[p.s,old(p.s)]));
  for(const [a,b] of spans)for(const s of [a,(a+b)/2,b]) {
    const y=profile(s);
    if(y>-6.5+1e-5&&y<7.5-1e-5)throw Error(`Unprotected road at ${route.id}:${s}`);
  }
}
writeFileSync(new URL('../web/static/world/assets/rail/road-clearance-data.js',import.meta.url),
  '// Generated by tools/index-rail-road-clearance.mjs from the vendored road tiles.\nexport const railRoadClearance = '+JSON.stringify(result)+';\nexport const railRoadTunnels = '+JSON.stringify(tunnels)+';\nexport const railRoadTunnelConflicts = '+JSON.stringify(conflicts.filter(c=>!plans[c.route]))+';\nexport const railRoadPlans = '+JSON.stringify(plans)+';\n');
console.log(`Replanned ${Object.keys(plans).length} corridors with complete road and structure widths.`);
console.log(`Indexed ${Object.values(result).flat().length} road spans beneath ${Object.keys(result).length} rail routes.`);
console.log(`Protected ${Object.values(tunnels).flat().length} underground road crossings.`);
if(conflicts.length)console.log(`${conflicts.length} other crossings need alignment changes to fit the portal grade limit; retained their existing profiles.`);
