import {routeConcourse} from '../web/static/world/assets/rail/access-routing.js';
import {pathFrom,pathFloor,onPath,stairRun,stairPath} from '../web/static/world/assets/rail/access-plan.js';
import {nearestRailPoint} from '../web/static/world/assets/rail/map-compiler.js';

// Entrances descend near their own street position. Platform walking belongs to
// navigation only; it must not generate another enclosed concourse over the aisle.
export function directStationAccess({stations,hubs,entrances,transfers,sample}) {
 const records=new Map(stations.map(item=>[item.s.key,item])),old=new Map([...hubs].map(([key,h])=>[key,structuredClone(h)]));
 const narrowPlatforms=new Set();
 const eligible=key=>{const item=records.get(key);return item?.r.mapped&&item.s.y<0&&!narrowPlatforms.has(key);};
 const connected=key=>{const keys=new Set([key]);for(const current of keys)for(const t of transfers){const next=t.from===current?t.to:t.to===current?t.from:null;if(next)keys.add(next);}return [...keys];};
 const walk=(key,from,to)=>{const {r,s}=records.get(key),a=nearestRailPoint(r.points,from.x,from.z).s,b=nearestRailPoint(r.points,to.x,to.z).s,n=Math.max(1,Math.ceil(Math.abs(b-a)/4));return pathFrom([from,...Array.from({length:n},(_,i)=>({...sample(r,a+(b-a)*(i+1)/n,hubs.get(key).offset),y:s.y+1.15})),to].filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.z-all[i-1].z)>.01));};
 for(const [key,hub]of hubs)if(eligible(key)) {
  const {r,s}=records.get(key),side=Math.sign(s.offset||1),center=sample(r,s.s);let outer=Math.abs(s.offset)+2.8;
  for(const route of new Set(stations.map(item=>item.r)))if(route!==r) {
   const q=nearestRailPoint(route.points,center.x,center.z);if(q.distance>20||Math.abs(q.y-s.y)>1)continue;
   const across=(-(q.x-center.x)*center.dz+(q.z-center.z)*center.dx)*side;
   if(across>Math.abs(s.offset)+1)outer=Math.min(outer,across-1.65);
  }
  if(outer-1.65<3.4){narrowPlatforms.add(key);continue;}
  const inner=1.65,aisle=(inner+.65)*side,stairs=(outer-1.05)*side;
  const a={...sample(r,s.s,aisle),y:s.y+1.15},b={...sample(r,s.s+1,aisle),y:a.y};
  Object.assign(hub,{direct:true,offset:aisle,stairOffset:stairs,platformOffset:(inner+outer)/2*side,platformWidth:outer-inner,start:s.s,end:s.s,path:pathFrom([a,b]),wait:b,branches:[],links:[],stairRanges:[]});

 }
 const protectedPlatforms=stations.filter(({r})=>!r.mapped).flatMap(({r,s})=>{
  const p=sample(r,s.s);return (r.island?r.platformOffsets:[-6.4,6.4]).map(offset=>({p,offset,half:r.island?1.4:2.9,length:(s.length??r.platformLength??120)/2,y:s.y+1.15}));
 });
 const protectedScore=path=>{
  let score=0;
  for(let distance=0;distance<path.at(-1).s;distance+=1.5){const p=onPath(path,distance);for(const platform of protectedPlatforms){if(p.y<platform.y-.25||p.y>platform.y+2.2)continue;const x=p.x-platform.p.x,z=p.z-platform.p.z;if(Math.abs(x*platform.p.dx+z*platform.p.dz)<platform.length+1&&Math.abs(-x*platform.p.dz+z*platform.p.dx-platform.offset)<platform.half+1)score+=10000;}}
  return score;
 };
 const alternatives=new Map();
 for(let i=0;i<entrances.length;i++) {
  const entry=entrances[i];if(!eligible(entry.stationKey))continue;
  const choices=connected(entry.stationKey).filter(eligible).map(key=>records.get(key)),highest=Math.max(...choices.map(({s})=>s.y));
  const {r,s}=choices.filter(({s})=>s.y>=highest-.75).sort((a,b)=>Math.hypot(a.s.x-entry.x,a.s.z-entry.z)-Math.hypot(b.s.x-entry.x,b.s.z-entry.z))[0];
  const hub=hubs.get(s.key),half=s.length/2,depth=Math.max(-3.5,old.get(s.key).path[0].y),run=stairRun(s.y+1.15-depth),candidates=[];
  for(const direction of [-1,1])for(const shift of [0,-8,8,-16,16]) {
   const frame=sample(r,s.s),dx=frame.dx*direction,dz=frame.dz*direction,a={x:entry.x-dx*3.1,y:.16,z:entry.z-dz*3.1};
   const streetRun=Math.max(6.2,stairRun(.16-depth)),b={x:a.x+dx*streetRun,y:depth,z:a.z+dz*streetRun};
   const nearest=nearestRailPoint(r.points,b.x,b.z).s,start=Math.max(s.s-half+3+(direction<0?run:0),Math.min(s.s+half-3-(direction>0?run:0),nearest+shift)),end=start+direction*run;
   const c={...sample(r,start,hub.stairOffset),y:depth},d={...sample(r,end,hub.stairOffset),y:s.y+1.15};
   const landing={...sample(r,start-direction*2.5,hub.stairOffset),y:depth};
   const street=stairPath(a,b),path=pathFrom([...street,landing,c,...stairPath(c,d).slice(1)].filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.z-all[i-1].z)>.01));
   path.forEach(p=>p.width=2);
   candidates.push({...entry,stationKey:s.key,dx,dz,flightEnd:street.length-1,path,platformPath:walk(s.key,d,hub.path[0]),start,end,score:Math.hypot(b.x-landing.x,b.z-landing.z)+protectedScore(path)});
  }
  alternatives.set(i,candidates);const best=candidates.sort((a,b)=>a.score-b.score)[0];entrances[i]=best;hub.stairRanges.push([Math.min(best.start,best.end)-3,Math.max(best.start,best.end)+3]);
 }
 // Resolve neighboring entrance flights together, rather than routing a local
 // landing beneath somebody else's stairs.
 const overlapCache=new WeakMap();
 const overlap=(path,other)=>{
  let cache=overlapCache.get(path);if(!cache){cache=new WeakMap();overlapCache.set(path,cache);}if(cache.has(other))return cache.get(other);
  let count=0;
  for(let distance=.6;distance<path.at(-1).s;distance+=1.5){const p=onPath(path,distance),floor=pathFloor(other,p.x,p.z,2);if(floor!==null&&floor>p.y+.3&&floor<p.y+2.5)count++;}
  cache.set(other,count);return count;
 };
 for(const candidates of alternatives.values())for(const candidate of candidates) {
  let clashes=0;const path=candidate.path;
  for(let i=1;i<path.length;i++)for(let j=1;j<path.length;j++)if(Math.abs(i-j)>1)clashes+=overlap(pathFrom([path[i-1],path[i]]),pathFrom([path[j-1],path[j]]));
  candidate.score+=clashes*1000;
 }
 for(let pass=0;pass<4;pass++)for(const [index,candidates]of alternatives) {
  const neighbors=entrances.filter((entry,j)=>j!==index&&Math.hypot(entry.x-entrances[index].x,entry.z-entrances[index].z)<100);
  const score=candidate=>candidate.score+1000*neighbors.reduce((n,other)=>n+overlap(candidate.path,other.path)+overlap(other.path,candidate.path),0);
  entrances[index]=candidates.reduce((best,candidate)=>score(candidate)<score(best)?candidate:best);
 }
 const obstacleFlights=entrances.map(e=>e.path);
 for(const [index]of alternatives) {
  const entry=entrances[index],cut=entry.flightEnd+3,prefix={...entry,path:pathFrom(entry.path.slice(0,cut))},hub={path:entry.path.slice(cut-1,cut+1)};
  const result=routeConcourse(prefix,hub,obstacleFlights);
  if(!result.blocked){entry.path=pathFrom([...result.entry.path,...entry.path.slice(cut)]);entry.path.forEach(p=>p.width=2);}
 }
 for(const hub of hubs.values())if(hub.direct)hub.stairRanges=[];
 for(const [index]of alternatives){const entry=entrances[index];delete entry.score;hubs.get(entry.stationKey).stairRanges.push([Math.min(entry.start,entry.end)-3,Math.max(entry.start,entry.end)+3]);}
 for(const transfer of transfers) {
  if(!eligible(transfer.from)||!eligible(transfer.to)) {
   const geometry=[...transfer.path];
   if(eligible(transfer.from))geometry.unshift(...[...old.get(transfer.from).path].reverse().slice(0,-1));
   if(eligible(transfer.to))geometry.push(...old.get(transfer.to).path.slice(1));
   transfer.geometryPath=pathFrom(geometry);
   transfer.path=pathFrom([...(eligible(transfer.from)?walk(transfer.from,hubs.get(transfer.from).path[0],geometry[0]):[geometry[0]]),...geometry.slice(1),...(eligible(transfer.to)?walk(transfer.to,geometry.at(-1),hubs.get(transfer.to).path[0]).slice(1):[])]);
   continue;
  }
  const source=records.get(transfer.from),target=records.get(transfer.to),from=hubs.get(transfer.from),to=hubs.get(transfer.to);
  const upper=source.s.y>target.s.y?source:target,lower=upper===source?target:source;
  if(upper.s.y-lower.s.y>3) {
   const run=stairRun(upper.s.y-lower.s.y),start=upper.s.s+25,a={...sample(upper.r,start,hubs.get(upper.s.key).stairOffset),y:upper.s.y+1.15};
   const trial=sample(upper.r,start+run,hubs.get(upper.s.key).stairOffset),q=nearestRailPoint(lower.r.points,trial.x,trial.z),b={...sample(lower.r,q.s,hubs.get(lower.s.key).stairOffset),y:lower.s.y+1.15};
   const drop=a.y-b.y,first=Math.min(4.2,drop-2.5),last=Math.min(4.2,drop-first),runFirst=stairRun(first),runLast=stairRun(last);
   const midA={...sample(upper.r,start+runFirst,hubs.get(upper.s.key).stairOffset),y:a.y-first},midB={...sample(lower.r,q.s-runLast,hubs.get(lower.s.key).stairOffset),y:b.y+last};
   const exit={...sample(upper.r,start+runFirst+2,hubs.get(upper.s.key).stairOffset),y:midA.y},approach={...sample(lower.r,q.s-runLast-2,hubs.get(lower.s.key).stairOffset),y:midB.y};
   const sideA=Math.sign(-(approach.x-exit.x)*exit.dz+(approach.z-exit.z)*exit.dx)||1,sideB=Math.sign(-(exit.x-approach.x)*approach.dz+(exit.z-approach.z)*approach.dx)||1;
   const cornerA={...exit,x:exit.x-exit.dz*3*sideA,z:exit.z+exit.dx*3*sideA},cornerB={...approach,x:approach.x-approach.dz*3*sideB,z:approach.z+approach.dx*3*sideB};
   const middle=Math.abs(cornerA.y-cornerB.y)<.001?[cornerA,cornerB]:stairPath(cornerA,cornerB);
   const aligned=Math.abs(a.dx*b.dx+a.dz*b.dz)>.9&&Math.abs(-(b.x-a.x)*a.dz+(b.z-a.z)*a.dx)<2;
   const stairs=aligned?stairPath(a,b):pathFrom([...stairPath(a,midA),exit,cornerA,...middle.slice(1),approach,midB,...stairPath(midB,b).slice(1)]),forward=source===upper?stairs:[...stairs].reverse();
   transfer.geometryPath=pathFrom(forward.map(p=>({...p,width:2})));transfer.kind='stairs';
   transfer.path=pathFrom([...walk(transfer.from,from.path[0],forward[0]),...forward.slice(1),...walk(transfer.to,forward.at(-1),to.path[0]).slice(1)]);
   hubs.get(upper.s.key).stairRanges.push([start-3,start+run+3]);
   hubs.get(lower.s.key).stairRanges.push([q.s-3,q.s+3]);
  }else {
   const base=Math.max(source.s.y,target.s.y)+6.4,runA=stairRun(base-source.s.y-1.15),runB=stairRun(base-target.s.y-1.15);
   const startA=source.s.s+55,a={...sample(source.r,startA,from.stairOffset),y:source.s.y+1.15},topA={...sample(source.r,startA+runA,from.stairOffset),y:base},leadA={...sample(source.r,startA+runA+2.5,from.stairOffset),y:base};
   const nearby=nearestRailPoint(target.r.points,a.x,a.z).s,startB=Math.max(target.s.s-target.s.length/2+5,Math.min(target.s.s+target.s.length/2-runB-5,nearby));
   const b={...sample(target.r,startB,to.stairOffset),y:target.s.y+1.15},topB={...sample(target.r,startB+runB,to.stairOffset),y:base},leadB={...sample(target.r,startB+runB+2.5,to.stairOffset),y:base};
   const path=pathFrom([...stairPath(a,topA),leadA,leadB,...stairPath(b,topB).reverse()].filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.z-all[i-1].z)>.01));path.forEach(p=>p.width=2);
   transfer.geometryPath=path;transfer.path=pathFrom([...walk(transfer.from,from.path[0],a),...path.slice(1),...walk(transfer.to,b,to.path[0]).slice(1)]);
   from.stairRanges.push([startA-3,startA+runA+3]);to.stairRanges.push([startB-3,startB+runB+3]);
  }
 }
 return entrances;
}
