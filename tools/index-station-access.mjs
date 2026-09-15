import {directStationAccess} from './plan-direct-station-access.mjs';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {routes,sample,layout} from '../web/static/world/assets/rail/network.js';
import {planHub,planAccess,pathFrom} from '../web/static/world/assets/rail/access-plan.js';
import {nearestRailPoint} from '../web/static/world/assets/rail/map-compiler.js';
import {routeConcourse} from '../web/static/world/assets/rail/access-routing.js';
const root=new URL('../',import.meta.url),dir=new URL('public/world/world/tiles/',root),entrances=[],hubs=new Map(),seen=new Set();
const sourceLayout=(r,s)=>r.mapped?{platforms:[{offset:s.offset}]}:layout(r,s);
const stations=routes.flatMap(r=>r.stations.map(s=>({r,s})));
for(const name of readdirSync(dir).filter(n=>n.endsWith('.json.gz')).sort()) {
 const tile=JSON.parse(gunzipSync(readFileSync(new URL(name,dir))));
 for(const p of tile.props??[])if(p.kind==='subway_entrance') {
  const id=`${p.x.toFixed(2)}:${p.z.toFixed(2)}`;if(seen.has(id))continue;seen.add(id);
  let nearest=null,best=220;
  for(const {r,s} of stations)for(const platform of sourceLayout(r,s).platforms) {
   const q=sample(r,s.s,platform.offset),d=Math.hypot(p.x-q.x,p.z-q.z);
   if(d<best){best=d;nearest={r,s,offset:platform.offset};}
  }
  if(!nearest)continue;
  const {r,s,offset}=nearest;let hub=hubs.get(s.key);
  if(!hub){
   // A mezzanine sits above every nearby track level, including express tracks
   // which have no platform of their own. Never route a concourse through them.
   let highest=s.y;
   if(s.y<0)for(const other of routes){const q=nearestRailPoint(other.points,s.x,s.z);if(q.distance<40&&q.y<-.5)highest=Math.max(highest,q.y);}
   const concourse=Math.min(-3.5,highest+6.4);
   hub=planHub(s,r,sample,offset,concourse);
   hub.branches=sourceLayout(r,s).platforms.filter(p=>p.offset!==offset).map(p=>planHub(s,r,sample,p.offset,concourse));
   const behind=h=>{const a=h.path[0],b=h.path[1],d=Math.hypot(b.x-a.x,b.z-a.z);return {x:a.x-(b.x-a.x)/d*4,y:a.y,z:a.z-(b.z-a.z)/d*4};};
   hub.links=hub.branches.map(branch=>pathFrom([hub.path[0],behind(hub),behind(branch),branch.path[0]]));
   hubs.set(s.key,hub);
  }
  // Follow the station axis instead of whichever intersecting road happens to
  // be nearest to the entrance point. The street prop uses this same frame.
  const frame=sample(r,s.s),toward=(hub.path[0].x-p.x)*frame.dx+(hub.path[0].z-p.z)*frame.dz;
  const dx=frame.dx*Math.sign(toward||1),dz=frame.dz*Math.sign(toward||1);
  entrances.push(planAccess({id,x:p.x,z:p.z,dx,dz},hub));
 }
}
// Platform polygons at different depths belong to one passenger station.
// Build a shared mezzanine graph, including levels which received no entrance
// during nearest-platform assignment.
const groups=[];
const normalized=s=>s.name.toLowerCase().replace(/[^a-z0-9]/g,'');
for(const item of stations.filter(({s})=>s.y<0)) {
 const matches=groups.filter(group=>group.some(other=>normalized(other.s)===normalized(item.s)&&Math.hypot(other.s.x-item.s.x,other.s.z-item.s.z)<180));
 if(!matches.length)groups.push([item]);
 else {matches[0].push(item);for(const group of matches.slice(1)){matches[0].push(...group);groups.splice(groups.indexOf(group),1);}}
}
const complexes=[];
for(const group of groups) {
 if(!group.some(({s})=>hubs.has(s.key)))continue;
 const base=Math.max(...group.map(({s})=>hubs.get(s.key)?.path[0].y??Math.min(-3.5,s.y+6.4)));
 for(const {r,s} of group) {
  const offset=hubs.get(s.key)?.offset??sourceLayout(r,s).platforms[0]?.offset;if(offset===undefined)continue;
  const hub=planHub(s,r,sample,offset,base);hub.branches=sourceLayout(r,s).platforms.filter(p=>p.offset!==offset).map(p=>planHub(s,r,sample,p.offset,base));
  const behind=h=>{const a=h.path[0],b=h.path[1],d=Math.hypot(b.x-a.x,b.z-a.z);return {x:a.x-(b.x-a.x)/d*4,y:a.y,z:a.z-(b.z-a.z)/d*4};};
  hub.links=hub.branches.map(branch=>pathFrom([hub.path[0],behind(hub),behind(branch),branch.path[0]]));hubs.set(s.key,hub);
 }
 if(group.length>1)complexes.push(group.map(({s})=>s.key));
}
for(let i=0;i<entrances.length;i++)entrances[i]=planAccess(entrances[i],hubs.get(entrances[i].stationKey));
const flights=[...entrances.map(a=>a.path.slice(0,(a.flightEnd??1)+1)),...[...hubs.values()].flatMap(h=>[h.path,...h.branches.map(b=>b.path)])];
// Connect each complex with a spanning tree. Corridors approach the landing
// behind each flight and use the same obstacle planner as entrance passages.
const transfers=[];
for(const keys of complexes) {
 const connected=new Set([keys.find(key=>entrances.some(e=>e.stationKey===key))]),pending=new Set(keys.filter(key=>!connected.has(key)));
 while(pending.size) {
  const candidates=[];
  for(const from of connected)for(const to of pending){const a=hubs.get(from).path[0],b=hubs.get(to).path[0];candidates.push({from,to,d:Math.hypot(a.x-b.x,a.z-b.z)});}
  let added=false;
  for(const {from,to} of candidates.sort((a,b)=>a.d-b.d)) {
   const source=hubs.get(from),target=hubs.get(to),a=source.path[0],b=target.path[0];
   const behind=h=>{const p=h.path[0],q=h.path[1],d=Math.hypot(q.x-p.x,q.z-p.z);return {x:p.x-(q.x-p.x)/d*4,y:p.y,z:p.z-(q.z-p.z)/d*4};};
   const entry={path:pathFrom([a,behind(source),behind(target),b])};
   const result=routeConcourse(entry,target,flights);if(result.blocked)continue;
   transfers.push({from,to,path:result.entry.path});connected.add(to);pending.delete(to);added=true;break;
  }
  if(!added)throw Error(`No clear transfer to ${[...pending].join(', ')}`);
 }
}

let rerouted=0;const closed=[];
for(let i=0;i<entrances.length;i++){const result=routeConcourse(entrances[i],hubs.get(entrances[i].stationKey),flights);entrances[i]=result.entry;rerouted+=Number(result.rerouted);if(result.blocked)closed.push(result.entry);}
const closedIds=new Set(closed.map(e=>e.id)),connected=entrances.filter(e=>!closedIds.has(e.id));
for(const hub of hubs.values())if(!connected.some(e=>e.stationKey===hub.stationKey)&&!complexes.some(keys=>keys.includes(hub.stationKey)&&connected.some(e=>keys.includes(e.stationKey))))throw Error(`Station ${hub.stationKey} has no clear entrance`);
directStationAccess({stations,hubs,entrances:connected,transfers,sample});
writeFileSync(new URL('web/static/world/assets/rail/access-data.js',root),'// Generated from mirrored entrance props and rail platforms by tools/index-station-access.mjs.\nexport const accessData = '+JSON.stringify({entrances:connected,closed,hubs:[...hubs.values()],transfers})+';\n');
console.log(`Connected ${connected.length} street entrances to ${hubs.size} station platforms.`);
console.log(`Routed ${rerouted} passages around neighboring stair flights.`);
console.log(`Closed ${closed.length} entrances with no clear passage.`);
console.log(`Connected ${complexes.length} station complexes with ${transfers.length} inter-platform passages.`);
