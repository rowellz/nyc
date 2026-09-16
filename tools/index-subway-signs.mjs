/** Join normal MTA services to physical OSM platforms, independently of tile loading.
 * node tools/index-subway-signs.mjs [/path/to/osm-subway-ways.json]
 * An optional Overpass body/geom extract refreshes retained track directions.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {mappedData} from '../web/static/world/assets/rail/mapped-data.js';
import {route as broadway} from '../web/static/world/assets/rail/network.js';
import {railProjection,nearestRailPoint} from '../web/static/world/assets/rail/map-compiler.js';
const root=new URL('../web/static/world/assets/rail/',import.meta.url),read=n=>JSON.parse(readFileSync(new URL(n,root)));
if(process.argv[2]){
 const bytes=readFileSync(process.argv[2]),raw=JSON.parse(bytes);
 if(raw.remark)throw Error(raw.remark);
 const tracks={source:'https://www.openstreetmap.org',license:'ODbL-1.0',sha256:createHash('sha256').update(bytes).digest('hex'),ways:raw.elements.filter(w=>w.type==='way'&&w.tags?.railway==='subway'&&w.geometry).map(w=>({id:w.id,tags:w.tags,points:w.geometry.map(p=>railProjection(p.lon,p.lat).map(v=>+v.toFixed(3)))}))};
 writeFileSync(new URL('subway-tracks.json',root),JSON.stringify(tracks)+'\n');
}
const source=read('map-features.json'),mta=read('subway-services.json'),trackSource=read('subway-tracks.json');
const wayById=new Map(trackSource.ways.map(w=>[w.id,{...w,points:w.points.map(([x,z],s)=>({x,z,s,y:0}))}]));
const nodes=new Map(source.stations.map(s=>[s.id,s]));
const stops=mta.stations.map(s=>{const [x,z]=railProjection(s.lon,s.lat);return {...s,x,z};});
const byId=new Map(stops.map(s=>[s.station_id,s]));
const routes=mappedData.routes.filter(r=>r.kind==='subway').map(r=>({...r,points:r.points.map(([x,z,y,s])=>({x,z,y,s}))}));
function nearest(points,x,z){const q=nearestRailPoint(points,x,z),a=points[q.i-1],b=points[q.i],length=Math.hypot(b.x-a.x,b.z-a.z)||1;return {...q,dx:(b.x-a.x)/length,dz:(b.z-a.z)/length};}
const at=(r,s)=>nearest(r.points,s.x,s.z);
const aliases={
 'Lexington Av':['lexington','pelham','easternparkway'], 'Broadway - 7Av':['broadwayseventh','lenox'],
 '8th Av - Fulton St':['eighth','fulton','culver'], '6th Av - Culver':['sixth','culver','brighton','chrystie','63rd'],
 'Broadway - Brighton':['bmtbroadway','astoria','brighton'], 'Broadway':['bmtbroadway'], 'Astoria':['astoria'],
 'Canarsie':['canarsie'], 'Second Av':['secondavenue'], 'Flushing':['flushing'], 'Concourse':['concourse'],
 'Queens Blvd':['queensboulevard','sixth'], '63rd St':['63rd','queensboulevard'],
 'Lexington - Shuttle':['42ndstreet'], 'Lenox - White Plains Rd':['lenox','whiteplains'],
 'Eastern Pky':['easternparkway','lexington','broadwayseventh'], 'Clark St':['broadwayseventh','easternparkway'],
 'Manhattan Bridge':['bmtbroadway','secondavenue','brighton'], '4th Av':['fourthavenue','bmtbroadway'],
 'Jamaica':['jamaica','nassau'], 'Jerome Av':['jerome','lexington'], 'Pelham':['pelham','lexington'],
 'Crosstown':['crosstown'], 'Myrtle Av':['myrtle'], 'Franklin Shuttle':['franklin']
};
function compatible(stop,name){const line=name.replace(/[^a-z0-9]/gi,'').toLowerCase();return (aliases[stop.line]??[stop.line.replace(/[^a-z0-9]/gi,'').toLowerCase()]).some(n=>line.includes(n));}
function match(station,r){
 if(/PATH/i.test(`${r.name} ${station.source?.tags?.network??''}`))return undefined;
 const tagged=station.source?.tags?.['gtfs:stop_id']?.split(';')[0].replace(/[NS]$/,'');if(tagged){const stop=stops.find(s=>s.gtfs_stop_id===tagged);if(stop&&Math.hypot(stop.x-station.x,stop.z-station.z)<300)return stop;}
 const node=nodes.get(station.source?.stationId??station.id),ref=node?.tags['railway:ref'];
 const way=nearestWay(r,at(r,station)),name=way?.w.tags.name??r.name;
 const exact=byId.get(ref);
 if(exact&&compatible(exact,name)&&Math.hypot(exact.x-station.x,exact.z-station.z)<600)return exact;
 const candidates=stops.filter(s=>Math.hypot(s.x-station.x,s.z-station.z)<250&&compatible(s,name));
 const closest=candidates.sort((a,b)=>Math.hypot(a.x-station.x,a.z-station.z)-Math.hypot(b.x-station.x,b.z-station.z))[0];
 if(closest)return closest;
 if(name==='Railway')return exact;
 // A few retained platform polygons were snapped to a neighboring track.
 // Use the platform's own location/name, never a different station's routes.
 const normalize=s=>s.toLowerCase().replace(/(\d+)(st|nd|rd|th)/g,'$1').replace(/avenue/g,'av').replace(/street/g,'st').replace(/[^a-z0-9]/g,'');
 return stops.filter(s=>normalize(s.stop_name)===normalize(station.name)&&Math.hypot(s.x-station.x,s.z-station.z)<220).sort((a,b)=>Math.hypot(a.x-station.x,a.z-station.z)-Math.hypot(b.x-station.x,b.z-station.z))[0];
}
function nearestWay(r,q){
 let best;
 for(const id of r.wayIds){const w=wayById.get(id);if(!w)continue;const p=nearest(w.points,q.x,q.z);if(!best||p.distance<best.distance)best={...p,w};}
 return best;
}
function polygonDistance(points,p){
 let inside=false,best=Infinity;
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const [x,z]=points[i],[xx,zz]=points[j];
  if((z>p.z)!==(zz>p.z)&&p.x<(xx-x)*(p.z-z)/(zz-z)+x)inside=!inside;
  const dx=xx-x,dz=zz-z,t=Math.max(0,Math.min(1,((p.x-x)*dx+(p.z-z)*dz)/(dx*dx+dz*dz||1)));
  best=Math.min(best,Math.hypot(p.x-x-t*dx,p.z-z-t*dz));
 }return inside?0:best;
}
function follows(w,service){
 const pref=w.w.tags['railway:preferred_direction'];
 if(!['forward','backward'].includes(pref))return true;
 const v=service.vector,[vx,vz]=[v[0]*111320*Math.cos(40.75362*Math.PI/180),-v[1]*110574];
 return (w.dx*vx+w.dz*vz)*(pref==='forward'?1:-1)>0;
}
const corridorServices=[[/IRT.*Broadway|Lenox/,['1','2','3']],[/Lexington|Pelham/,['4','5','6']],[/Eastern Parkway/,['2','3','4','5','6']],[/Eighth|Fulton/,['A','B','C','D','E']],[/Sixth/,['B','D','F','M']],[/Queens Boulevard/,['E','F','M','R']],[/BMT Broadway|Astoria/,['N','Q','R','W']],[/Second Avenue/,['Q']],[/Canarsie/,['L']],[/Flushing/,['7']],[/Concourse/,['B','D']],[/Brighton/,['B','Q']],[/Nassau|Jamaica/,['J','Z','M']]];
// At express stops a side platform touches only local track; an island may
// touch both. Restrict each edge before taking the union for the whole platform.
function edgeServices(tags,services){
 const name=tags.name??'';const allowed=corridorServices.find(([pattern])=>pattern.test(name))?.[1];if(allowed)services=services.filter(s=>allowed.includes(s.route));
 const signal=tags['railway:track_ref:signals']??'',n=Number(signal.match(/(\d)$/)?.[1]);
 let express=null,expressLines=[];
 if(name.includes('Lexington')&&/^L[1-4]$/.test(signal)){express=n<=2;expressLines=['4','5'];}
 if(name.includes('Broadway–Seventh')&&/^B[1-4]$/.test(signal)){express=n<=2;expressLines=['2','3'];}
 if(name.includes('Eighth')&&/^A[1-4]$/.test(signal)){express=n>=3;expressLines=['A','D'];}
 if(name.includes('Sixth')&&/^B[1-4]$/.test(signal)){express=n>=3;expressLines=['B','D'];}
 if(name.includes('BMT Broadway')&&/^A[1-4]$/.test(signal)){express=n>=3;expressLines=['N','Q'];}
 if(express===null)return services;
 const expressHere=services.filter(s=>expressLines.includes(s.route)),localHere=services.filter(s=>!expressLines.includes(s.route));
 // Services run locally beyond the express section. Split only where both
 // groups actually stop; never erase the only service at a local-only station.
 return expressHere.length&&localHere.length?(express?expressHere:localHere):services;
}
const records={},unmatched=[],directionsByRoute=new Map();
for(const r of routes)for(const station of r.stations){
 const stop=match(station,r);if(!stop){unmatched.push({id:station.id,name:station.name,line:r.name,nearest:nearestWay(r,at(r,station))?.w.tags.name,reference:nodes.get(station.source?.stationId??station.id)?.tags['railway:ref']});continue;}
 const q=at(r,station),polygon=station.source?.polygon,platformLayer=station.source?.tags?.layer,explicitDirections=[...new Set((station.source?.tags?.['gtfs:stop_id']??'').split(';').filter(id=>id.slice(0,-1)===stop.gtfs_stop_id).map(id=>id.at(-1)).filter(d=>d==='N'||d==='S'))];
 const nearby=polygon?routes.map(other=>({r:other,q:at(other,station)})).filter(o=>o.q.distance<13&&Math.abs(o.q.dx*q.dx+o.q.dz*q.dz)>.8&&polygonDistance(polygon,o.q)<2.1&&(Math.abs(o.q.y-station.y)<2.1||(platformLayer!==undefined&&nearestWay(o.r,o.q)?.w.tags.layer===platformLayer))):[];
 if(!nearby.some(o=>o.r.id===r.id))nearby.push({r,q});
 const groups=new Map(),edges=[];
 for(const edge of nearby){
  const w=nearestWay(edge.r,edge.q);if(!w||w.distance>12)continue;
  for(const d of explicitDirections.length?explicitDirections:['N','S']){
   const served=edgeServices(w.w.tags,stop.directions[d]).filter(service=>follows(w,service));if(!served.length)continue;
   const text=label(stop,d,w.w.tags.name,served),key=`${d}:${text}`;
   if(!groups.has(key))groups.set(key,{direction:d,label:text,routes:new Set()});for(const service of served)groups.get(key).routes.add(service.route);
   edges.push({way:w.w.id,direction:d,routes:served.map(s=>s.route)});
   if(['forward','backward'].includes(w.w.tags['railway:preferred_direction'])){
    const sign=(edge.q.dx*w.dx+edge.q.dz*w.dz)*(w.w.tags['railway:preferred_direction']==='forward'?1:-1)>=0?1:-1;
    if(!directionsByRoute.has(edge.r.id))directionsByRoute.set(edge.r.id,[]);directionsByRoute.get(edge.r.id).push(sign);
   }
  }
 }
 if(!groups.size)for(const d of explicitDirections.length?explicitDirections:['N','S'])groups.set(d,{direction:d,label:label(stop,d),routes:new Set(stop.directions[d].map(s=>s.route))});
 records[`${r.id}:${station.id}`]={stop:stop.gtfs_stop_id,stationId:stop.station_id,name:stop.stop_name,groups:[...groups.values()].map(g=>({...g,routes:[...g.routes].sort()})),edges};
}
function label(stop,d,name,services){
 const raw=stop[d==='N'?'north_direction_label':'south_direction_label'];
 if(name?.includes('Queens Boulevard')&&services?.length===1)return services[0].headsign;
 const eastWest=stop.line==='Canarsie'||stop.line==='Flushing'||stop.line==='Lexington - Shuttle';
 if(raw==='Outbound'&&name?.includes('Sixth'))return d==='N'?'Uptown & The Bronx':'Downtown';
 if(stop.borough==='M'&&!eastWest&&raw!=='Last Stop')return `${d==='N'?'Uptown':'Downtown'}${/uptown|downtown/i.test(raw)?'':` & ${raw}`}`;
 return raw==='Last Stop'?'Last stop':raw;
}
for(const station of broadway.stations){
 const stop=stops.filter(s=>s.line==='Broadway - 7Av').sort((a,b)=>Math.hypot(a.x-station.x,a.z-station.z)-Math.hypot(b.x-station.x,b.z-station.z))[0];
 if(!stop||Math.hypot(stop.x-station.x,stop.z-station.z)>300)throw Error(`Unmatched Broadway station ${station.name}`);
 const groups=['S','N'].map(d=>({direction:d,label:label(stop,d),routes:stop.directions[d].map(s=>s.route).sort()}));
 records[station.key]={stop:stop.gtfs_stop_id,stationId:stop.station_id,name:stop.stop_name,groups,platformGroups:groups.map(g=>[g])};
}
const trainDirections=Object.fromEntries([...directionsByRoute].map(([id,signs])=>[id,signs.reduce((a,b)=>a+b,0)<0?-1:1]));
const data={source:mta.source,stationSource:mta.stationSource,sha256:mta.sha256,trackSha256:trackSource.sha256,mapSha256:source.sha256,catalogSha256:mta.stationSha256,feedVersion:mta.feed?.[0]?.feed_version,routes:mta.routes,stations:records,trainDirections};
writeFileSync(new URL('sign-data.js',root),'// Generated by tools/index-subway-signs.mjs from MTA services and OSM platform/track data.\nexport const signData = '+JSON.stringify(data)+';\n');
console.log(`Matched ${Object.keys(records).length} subway platforms; ${unmatched.length} unmatched`);
console.log(JSON.stringify(unmatched));
