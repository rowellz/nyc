import {passageVolume,wallPanel,roofPanel} from './enclosure.js?v=station-layout-32';
import {accessData} from './access-data.js?v=station-layout-32';
import {onPath,pathFrom,pathFloor,accessRing} from './access-plan.js?v=station-layout-32';
export const hubs=new Map(accessData.hubs.map(h=>[h.stationKey,h]));
const pathsForHub=h=>[...(h.direct?[]:[h.path]),...(h.branches??[]).map(b=>b.path),...(h.links??[])];
export const transfers=accessData.transfers??[];
const ownedTransfers=new Map();
for(const transfer of transfers){if(!ownedTransfers.has(transfer.from))ownedTransfers.set(transfer.from,[]);ownedTransfers.get(transfer.from).push(transfer.geometryPath??transfer.path);}
const hubPaths=[...accessData.hubs.flatMap(pathsForHub),...transfers.map(t=>t.geometryPath??t.path)];
const destinationCache=new Map();
export function stationDestinations(key) {
 if(destinationCache.has(key))return destinationCache.get(key);
 const reached=new Map([[key,{stationKey:key,hub:hubs.get(key),path:[],via:[key]}]]),queue=[key];
 for(const current of queue)for(const transfer of transfers) {
  const next=transfer.from===current?transfer.to:transfer.to===current?transfer.from:null;if(!next||reached.has(next))continue;
  const previous=reached.get(current),path=transfer.from===current?transfer.path:[...transfer.path].reverse();
  reached.set(next,{stationKey:next,hub:hubs.get(next),path:pathFrom([...previous.path,...(previous.path.length?path.slice(1):path)]),via:[...previous.via,next]});queue.push(next);
 }
 const result=[...reached.values()].filter(d=>d.hub).sort((a,b)=>a.stationKey.localeCompare(b.stationKey));destinationCache.set(key,result);return result;
}
export function entranceDestinations(entry) {
 return stationDestinations(entry.stationKey).flatMap(destination=>[destination.hub,...(destination.hub.branches??[])].map((hub,index)=>({
  ...entry,stationKey:destination.stationKey,via:destination.via,hub,
  path:pathFrom([...entry.path,...(entry.platformPath??[]).slice(1),...destination.path.slice(1),...(index?destination.hub.links[index-1].slice(1):[]),...(hub.direct?[]:hub.path.slice(1)),hub.wait])
 })));
}
export function sharedEntrances(key) {
 return stationDestinations(key).flatMap(d=>accessesByStation.get(d.stationKey)??[]);
}
export const accessesByStation=new Map();
const entrances=new Map();
const closed=new Map((accessData.closed??[]).map(a=>[a.id,a]));
for(const a of accessData.entrances) {
 entrances.set(a.id,a);if(!accessesByStation.has(a.stationKey))accessesByStation.set(a.stationKey,[]);accessesByStation.get(a.stationKey).push(a);
}
export const functionalEntrance=(x,z)=>entrances.has(`${x.toFixed(2)}:${z.toFixed(2)}`)||closed.has(`${x.toFixed(2)}:${z.toFixed(2)}`);
export const entranceClosed=(x,z)=>closed.has(`${x.toFixed(2)}:${z.toFixed(2)}`);
export function entranceYaw(x,z){const key=`${x.toFixed(2)}:${z.toFixed(2)}`,a=entrances.get(key)??closed.get(key);return a?Math.atan2(-a.dz,a.dx):undefined;}
export function platformStairAt(station,s) {const h=hubs.get(station.key);return !!h&&(h.stairRanges?.some(([a,b])=>s>=a&&s<b)||(s>=h.start&&s<h.end));}
export function platformHub(station,offset) {const h=hubs.get(station.key);return offset===undefined?h:[h,...(h?.branches??[])].find(b=>b&&Math.abs(b.offset-offset)<.1);}
export function platformOpening(station,s,offset) {const h=platformHub(station,offset);return !!h&&s>=h.start&&s<h.end&&h.path[0].y<h.path.at(-1).y;}
export function stationPaths(stationKey) {
 const h=hubs.get(stationKey);return h?[...pathsForHub(h),...(ownedTransfers.get(stationKey)??[]),...(accessesByStation.get(stationKey)??[]).map(a=>a.path)]:[];
}
export function accessSupport(stationKey,x,z,referenceY) {
 let best=null,delta=Infinity;
 for(const path of stationPaths(stationKey)) {
  const y=pathFloor(path,x,z,1.15,referenceY);if(y===null)continue;const d=Math.abs(referenceY-y);
  if(referenceY>=y-.6&&referenceY<y+3.5&&d<delta){best=y;delta=d;}
 }
 return best;
}
export function appendAccessGeometry(b,station,railVolumes=()=>[]) {
 for(const a of closed.values())if(a.stationKey===station.key)
  b.box({...a.path[0],dx:a.dx,dz:a.dz},2.35,1,.15,'green',.5,0,true);
 const segments=[],flat=[];
 for(const path of stationPaths(station.key))for(let i=1;i<path.length;i++) {
  const a=path[i-1],c=path[i],d=Math.hypot(c.x-a.x,c.z-a.z);if(d<.01)continue;
  if(Math.abs(a.y-c.y)>.001){segments.push({path,a,c,width:a.width??2.65});continue;}
  const dx=(c.x-a.x)/d,dz=(c.z-a.z)/d;
  let line=flat.find(g=>g.width===(a.width??2.65)&&Math.abs(g.a.y-a.y)<.001&&Math.abs(g.dx*dz-g.dz*dx)<.00001&&Math.abs((a.x-g.a.x)*g.dz-(a.z-g.a.z)*g.dx)<.01);
  if(!line){line={a,dx,dz,width:a.width??2.65,ranges:[]};flat.push(line);}
  const u=(a.x-line.a.x)*line.dx+(a.z-line.a.z)*line.dz,v=(c.x-line.a.x)*line.dx+(c.z-line.a.z)*line.dz;
  line.ranges.push([Math.min(u,v),Math.max(u,v)]);
 }
 // Shared mezzanine branches have a single floor, wall and ceiling owner.
 for(const line of flat) {
  const merged=[];for(const range of line.ranges.sort((a,b)=>a[0]-b[0])) {
   const last=merged.at(-1);if(last&&range[0]<=last[1]+.02)last[1]=Math.max(last[1],range[1]);else merged.push([...range]);
  }
  for(const range of merged){const path=pathFrom(range.map(s=>({x:line.a.x+line.dx*s,y:line.a.y,z:line.a.z+line.dz*s})));segments.push({path,a:path[0],c:path[1],width:line.width});}
 }
 // Cut the interior, stopping short of the lining: overlapping wall skins
 // must not remove each other at nearly tangent stair/tunnel junctions.
 for(const segment of segments)segment.volume=passageVolume(segment.a,segment.c,segment.width/2-.145,-.2,2.65);
 for(const segment of segments) {
  const {path,a,c,width}=segment,d=c.s-a.s;if(d<.01)continue;
  const steps=Math.max(1,Math.ceil(Math.abs(c.y-a.y)/.17));
  for(let j=0;j<steps;j++) {
   const p=onPath(path,a.s+d*(j+.5)/steps),y=a.y+(c.y-a.y)*(j+1)/steps;
   b.box({...p,y},width,.22,d/steps+.01,'concrete',-.11);
  }
  // Render discrete treads but sweep the player capsule over a continuous ramp,
  // as the road renderer does with its separate walking collision surface.
  const walk=new b.constructor();
  walk.span(a,c,width,.22,'concrete',-.11+(Math.abs(c.y-a.y)>.001?Math.sign(c.y-a.y)*.085:0),0,true);
  const base=b.collision.position.length/3;
  b.collision.position.push(...walk.collision.position);b.collision.index.push(...walk.collision.index.map(i=>i+base));
  const cuts=[...segments.filter(s=>s!==segment).map(s=>s.volume),...railVolumes(a,c),...accessPassageVolumes(a,c,station.key)];
  const count=Math.ceil(d/3);
  for(let j=0;j<count;j++) {
   const p=onPath(path,a.s+d*j/count),q=onPath(path,a.s+d*(j+1)/count),underground=Math.max(p.y,q.y)<-2.7;
   for(const side of [-1,1]) {
    if(!underground&&Math.min(p.y,q.y)<0) {
     // Open street flights still need retaining walls up to the pavement.
     const panel=wallPanel(p,q,side*(width/2-.075),0,1.1);panel[2][1]=Math.max(q.y+1.1,.15);panel[3][1]=Math.max(p.y+1.1,.15);
     b.panel(panel,.12,'tile',cuts);
    }else b.panel(wallPanel(p,q,side*(width/2-.075),0,underground?2.8:1.1),.12,underground?'tile':'green',cuts);
   }
   if(underground)b.panel(roofPanel(p,q,-width/2,width/2,2.8),.2,'concrete',cuts);
   if(underground&&j%3===0)b.box(p,.1,.08,1,'light',2.65);
  }
  // End returns close the outside corners of bends. Adjacent walking volumes
  // cut the doorway through these caps; street thresholds remain open.
  for(const p of [a,c])if(p.y<-.5) {
   const dx=(c.x-a.x)/d,dz=(c.z-a.z)/d;
   const left={x:p.x+dz*width/2,y:p.y,z:p.z-dx*width/2},right={x:p.x-dz*width/2,y:p.y,z:p.z+dx*width/2};
   b.panel(wallPanel(left,right,0,-.1,p.y<-2.7?2.8:1.1),.12,p.y<-2.7?'tile':'green',cuts);
  }
 }
}
export const accessSurfaceHoles=accessData.entrances.flatMap(entry=>{
 const holes=[];
 for(let i=1;i<=(entry.flightEnd??1);i++) {
  const a=entry.path[i-1],b=entry.path[i];if(Math.max(a.y,b.y)<-2.9)continue;
  const cut=b.y< -2.9?onPath(entry.path,a.s+(b.s-a.s)*(-2.9-a.y)/(b.y-a.y)):b;
  holes.push(accessRing(a,cut,1.3));
 }
 return holes;
});
export const accessWaterHoles=[];
for(const path of [...accessData.entrances.map(a=>a.path),...hubPaths])for(let i=1;i<path.length;i++) {
 const a=path[i-1],b=path[i];if(Math.min(a.y,b.y)>=0)continue;
 const count=Math.ceil((b.s-a.s)/30);
 for(let j=0;j<count;j++)accessWaterHoles.push(accessRing(onPath(path,a.s+(b.s-a.s)*j/count),onPath(path,a.s+(b.s-a.s)*(j+1)/count),1.6));
}
const passageCells=new Map();
for(const {path,stationKey} of [...accessData.entrances,...accessData.hubs.flatMap(h=>pathsForHub(h).map(path=>({path,stationKey:h.stationKey}))),...transfers.map(t=>({path:t.geometryPath??t.path,stationKey:t.from}))])for(let i=1;i<path.length;i++) {
 const a=path[i-1],b=path[i],segment=Object.assign([a,b],{stationKey});
 for(let x=Math.floor((Math.min(a.x,b.x)-2)/256);x<=Math.floor((Math.max(a.x,b.x)+2)/256);x++)
  for(let z=Math.floor((Math.min(a.z,b.z)-2)/256);z<=Math.floor((Math.max(a.z,b.z)+2)/256);z++) {
   const key=`${x}_${z}`;if(!passageCells.has(key))passageCells.set(key,[]);passageCells.get(key).push(segment);
  }
}
export function accessPassageAt(x,z,y,top=y) {
 for(const path of passageCells.get(`${Math.floor(x/256)}_${Math.floor(z/256)}`)??[]) {
  const floor=pathFloor(path,x,z,1.35);if(floor!==null&&top>floor+.1&&y<floor+2.6)return true;
 }
 return false;
}

const passageVolumeCache=new WeakMap();
export function accessPassageVolumes(a,b,excludeStation) {
 const paths=new Set();
 for(let x=Math.floor((Math.min(a.x,b.x)-2)/256);x<=Math.floor((Math.max(a.x,b.x)+2)/256);x++)
 for(let z=Math.floor((Math.min(a.z,b.z)-2)/256);z<=Math.floor((Math.max(a.z,b.z)+2)/256);z++)
 for(const path of passageCells.get(`${x}_${z}`)??[])if(!excludeStation||path.stationKey!==excludeStation)paths.add(path);
 return [...paths].map(path=>{let volume=passageVolumeCache.get(path);if(!volume){volume=passageVolume(path[0],path[1],(path[0].width??2.65)/2-.145,-.55,2.65);passageVolumeCache.set(path,volume);}return volume;});
}

// Height queries must agree with the holes in the rendered platform slab.
export function platformFloorOpening(station,x,z) {
 if(!hubs.get(station.key)?.direct)return false;
 const height=station.y+1.15;
 for(const path of passageCells.get(`${Math.floor(x/256)}_${Math.floor(z/256)}`)??[]) {
  const floor=pathFloor(path,x,z,(path[0].width??2.65)/2-.145);
  if(floor!==null&&floor<height-.25&&floor+2.65>height)return true;
 }
 return false;
}
