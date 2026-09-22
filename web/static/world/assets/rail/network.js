import {compactFactor,trackOffset,clearanceHeight,roadClearanceProfile,roadTunnelProfile,roadBoundsProfile,MAX_PORTAL_GRADE} from './corridor.js?v=rail-road-crossings-90';
import {railClearance} from './clearance-data.js?v=rail-road-crossings-90';
import {signData} from './sign-data.js?v=rail-road-crossings-90';
import {passageVolume} from './enclosure.js?v=rail-road-crossings-90';
import { metroNorthData } from './metro-north-data.js?v=rail-road-crossings-90';
import { mappedData } from './mapped-data.js?v=rail-road-crossings-90';
import {railRoadClearance,railRoadTunnels,railRoadPlans} from './road-clearance-data.js?v=rail-road-crossings-90';
import {accessSurfaceHoles,accessWaterHoles,hubs} from './access.js?v=rail-road-crossings-90';
// Rail corridors in the world's Bryant Park projection.
// OSM supplies general track geometry; explicit corridor overrides are below.
// Elevations and service are simulation data, not surveys or live timetables.
// All catalogs are bundled; no external map request is required during play.
const stops = [
  ['Times Sq–42 St', -73.9875, 40.7553, -12],
  ['50 St', -73.985, 40.7618, -12],
  ['59 St–Columbus Circle', -73.9819, 40.7682, -12],
  ['66 St–Lincoln Center', -73.9822, 40.7734, -12],
  ['72 St', -73.9819, 40.7785, -12],
  ['79 St', -73.9799, 40.7839, -12],
  ['86 St', -73.9762, 40.7886, -12],
  ['96 St', -73.9723, 40.7939, -12],
  ['103 St', -73.9684, 40.7994, -12],
  ['Cathedral Pkwy–110 St', -73.9666, 40.8039, -12],
  ['116 St–Columbia University', -73.9641, 40.8077, -12],
  ['125 St', -73.9584, 40.8156, 8],
  ['137 St–City College', -73.9537, 40.822, -12],
];
export const TILE_SIZE = 256;
export const PLATFORM_LENGTH = 120;
export const TRAIN_CARS = 5;
export const CAR_LENGTH = 18;
export const CAR_SPACING = 18.5;
export const TRAIN_LENGTH = CAR_LENGTH + (TRAIN_CARS - 1) * CAR_SPACING;
export const DWELL = 22;
const project = (lon, lat) => [(lon + 73.98322) * 111320 * Math.cos(40.75362 * Math.PI / 180), -(lat - 40.75362) * 110574];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = t => t * t * (3 - 2 * t);
export const tileKey = (x, z) => `${Math.floor(x / TILE_SIZE)}_${Math.floor(z / TILE_SIZE)}`;

export function createRoute(definition = stops) {
  if (definition.length < 2) throw new Error('Rail route needs at least two stations');
  const stations = definition.map(([name, lon, lat, y], id) => {
    if (![lon, lat, y].every(Number.isFinite)) throw new Error('Invalid rail station');
    const [x, z] = project(lon, lat);
    return { id, name, x, z, y, s: 0 };
  });
  // Hermite tangents preserve the corridor without overshooting sharp corners.
  const controls = stations.map(p => [p.x, p.z]);
  const extend = (a, b) => {
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d < 180) throw new Error('Rail stations must be at least 180 m apart');
    return [a[0] + (a[0] - b[0]) / d * 180, a[1] + (a[1] - b[1]) / d * 180];
  };
  controls.unshift(extend(controls[0], controls[1]));
  controls.push(extend(controls.at(-1), controls.at(-2)));
  const points = [];
  let s = 0;
  for (let i = 0; i < controls.length - 1; i++) {
    const a = controls[i], b = controls[i + 1], prev = controls[Math.max(0, i - 1)], next = controls[Math.min(controls.length - 1, i + 2)];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tangent = (u, v) => {
      const len = Math.hypot(v[0] - u[0], v[1] - u[1]) || 1;
      return [(v[0] - u[0]) / len * d, (v[1] - u[1]) / len * d];
    };
    const ta = tangent(prev, b), tb = tangent(a, next), count = Math.ceil(d / 3);
    for (let j = 0; j <= count; j++) {
      if (i && !j) { if (stations[i - 1]) stations[i - 1].s = s; continue; }
      const t = j / count, h = [2*t**3-3*t*t+1, t**3-2*t*t+t, -2*t**3+3*t*t, t**3-t*t];
      const x = h[0]*a[0]+h[1]*ta[0]+h[2]*b[0]+h[3]*tb[0], z = h[0]*a[1]+h[1]*ta[1]+h[2]*b[1]+h[3]*tb[1];
      const p = points.at(-1);
      if (p) s += Math.hypot(x-p.x, z-p.z);
      points.push({ x, z, s });
    }
  }
  const height = distance => {
    if (distance <= stations[0].s) return stations[0].y;
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i-1], b = stations[i];
      if (distance > b.s) continue;
      const start = a.s + PLATFORM_LENGTH/2 + 12, end = b.s - PLATFORM_LENGTH/2 - 12;
      if (end <= start || 1.5 * Math.abs(b.y-a.y)/(end-start) > 0.06) throw new Error('Rail grade exceeds 6%');
      return lerp(a.y, b.y, smooth(clamp((distance-start)/(end-start), 0, 1)));
    }
    return stations.at(-1).y;
  };
  points.forEach((p, i) => {
    const a = points[Math.max(0,i-1)], b = points[Math.min(points.length-1,i+1)];
    const d = Math.hypot(b.x-a.x,b.z-a.z) || 1;
    p.dx = (b.x-a.x)/d; p.dz = (b.z-a.z)/d; p.y = height(p.s);
  });
  return { id: 'broadway-local', label: '1', color: '#ee352e', points, stations, length: s, height };
}

export function sample(route, distance, offset = 0) {
  const s = clamp(distance, 0, route.length), pts = route.points;
  let lo = 0, hi = pts.length-1;
  while (lo+1 < hi) { const m = (lo+hi)>>1; if (pts[m].s <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], t = (s-a.s)/(b.s-a.s || 1);
  let dx = lerp(a.dx,b.dx,t), dz = lerp(a.dz,b.dz,t);
  const d = Math.hypot(dx,dz); dx /= d; dz /= d;
  return { x: lerp(a.x,b.x,t)-dz*offset, z: lerp(a.z,b.z,t)+dx*offset, y: route.height(s), dx, dz, s };
}

export function sampleTrack(route,distance,offset=0) { return sample(route,distance,trackOffset(route,distance,offset)); }

export function stationAt(route, s) { return route.stations.find(p => Math.abs(p.s-s) <= (p.length??route.platformLength??PLATFORM_LENGTH)/2); }

// A speed profile integrates constant acceleration, cruise, and braking exactly.
// Train centres stop at platform centres; all carriages sample the same path.
export function trip(distance, acceleration = 0.85, limit = 19) {
  const speed = Math.min(limit, Math.sqrt(distance*acceleration)), ramp = speed/acceleration;
  const cruise = Math.max(0, (distance-speed*speed/acceleration)/speed), duration = 2*ramp+cruise;
  return { duration, at(t) {
    t = clamp(t, 0, duration);
    if (t < ramp) return { distance: 0.5*acceleration*t*t, speed: acceleration*t };
    if (t < ramp+cruise) return { distance: speed*speed/(2*acceleration)+(t-ramp)*speed, speed };
    const left = duration-t;
    return { distance: distance-0.5*acceleration*left*left, speed: acceleration*left };
  } };
}
export function timetable(route, direction) {
  const stops = direction === 1 ? route.stations : [...route.stations].reverse();
  const start = direction === 1 ? 0 : route.length, end = direction === 1 ? route.length : 0;
  const phases = []; let time = 0, from = start;
  for (const stop of [...stops, { s: end }]) {
    const motion = trip(Math.abs(stop.s-from));
    phases.push({ start: time, end: time+motion.duration, from, motion }); time += motion.duration;
    if (stop.name) { phases.push({ start: time, end: time+DWELL, from: stop.s, station: stop }); time += DWELL; }
    from = stop.s;
  }
  return { direction, duration: time, phases };
}
export function trainState(schedule, seconds) {
  const t = ((seconds%schedule.duration)+schedule.duration)%schedule.duration;
  const phase = schedule.phases.find(p => t < p.end) ?? schedule.phases.at(-1);
  const moving = phase.motion?.at(t-phase.start);
  return { s: phase.from + schedule.direction*(moving?.distance ?? 0), speed: moving?.speed ?? 0,
    station: phase.station ?? null, doors: !!phase.station && t-phase.start > 2 && phase.end-t > 2 };
}

/** Separate alignment controls from stops: the Park Avenue portal must not be
 * interpolated over the entire Grand Central–Harlem station gap. */
export function nearestDistance(points, x, z) {
  let best=Infinity, along=0;
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,d=dx*dx+dz*dz;
    const t=clamp(((x-a.x)*dx+(z-a.z)*dz)/(d||1),0,1);
    const error=(x-a.x-dx*t)**2+(z-a.z-dz*t)**2;
    if(error<best){best=error;along=lerp(a.s,b.s,t);}
  }
  return along;
}

function mappedRoute(id, coordinates, stopIds, tracks, options={}) {
  const controls=coordinates.map(([lon,lat])=>project(lon,lat));
  if(options.terminal) {
    const [a,b]=controls,d=Math.hypot(b[0]-a[0],b[1]-a[1]);
    controls.unshift([a[0]-(b[0]-a[0])/d*180,a[1]-(b[1]-a[1])/d*180]);
  }
  const points=[];let s=0;
  for(let i=1;i<controls.length;i++) {
    const [a,b]=[controls[i-1],controls[i]],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(length<.001)continue;
    const count=Math.ceil(length/3);
    for(let j=i===1?0:1;j<=count;j++)points.push({x:lerp(a[0],b[0],j/count),z:lerp(a[1],b[1],j/count),s:s+length*j/count,y:8});
    s+=length;
  }
  for(let i=0;i<points.length;i++) {
    const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],d=Math.hypot(b.x-a.x,b.z-a.z);
    points[i].dx=(b.x-a.x)/d;points[i].dz=(b.z-a.z)/d;
  }
  const result={id,label:'MN',color:'#0039a6',kind:'commuter',points,length:s,tracks,island:true,platformLength:200,
    platformOffsets:tracks.filter((_,i)=>i%2===0).map((v,i)=>(v+tracks[i*2+1])/2),height:()=>8,...options};
  result.stations=stopIds.map(id=>{
    const source=metroNorthData.stations[id],[x,z]=project(source.lon,source.lat);
    const s=nearestDistance(points,x,z),p=sample(result,s);
    return {id,name:source.name,source,routeId:result.id,s,x:p.x,z:p.z,y:p.y};
  });
  return result;
}

function setProfile(route, anchors) {
  for(let i=1;i<anchors.length;i++)if(anchors[i][0]<=anchors[i-1][0]||1.5*Math.abs(anchors[i][1]-anchors[i-1][1])/(anchors[i][0]-anchors[i-1][0])>.06)
    throw new Error(`Invalid rail grade on ${route.id}`);
  route.height=s=>{
    for(let i=1;i<anchors.length;i++)if(s<=anchors[i][0])return lerp(anchors[i-1][1],anchors[i][1],smooth(clamp((s-anchors[i-1][0])/(anchors[i][0]-anchors[i-1][0]),0,1)));
    return anchors.at(-1)[1];
  };
  route.points.forEach(p=>p.y=route.height(p.s));
  route.stations.forEach(p=>p.y=route.height(p.s));
}

export const route = createRoute();
// The Manhattan Valley portal is north of W 122nd St. Interpolating only
// between 116th and 125th put its open trench through 121st/122nd, and the
// emerging deck through 123rd. Our streets are flat: retain a buried bore
// through those crossings, then rise in the long block before 125th.
// These are simulation clearances, not surveyed elevations.
const broadwayPortalApproach=nearestDistance(route.points,1864,-6437)+12;
const broadwayProfile=route.stations.flatMap(station=>[
  [station.s-PLATFORM_LENGTH/2-12,station.y],
  [station.s+PLATFORM_LENGTH/2+12,station.y],
]);
broadwayProfile.push([broadwayPortalApproach,-7.5]);
setProfile(route,broadwayProfile.sort((a,b)=>a[0]-b[0]));
export const parkAvenue = mappedRoute('metro-north-park-avenue',metroNorthData.trunk,['1','4'],[-9,-3,3,9],{terminal:true});
export const hudson = mappedRoute('metro-north-hudson',metroNorthData.hudson,['622','9','10','11','14'],[-9,-3]);
export const harlem = mappedRoute('metro-north-harlem',metroNorthData.harlem,['54','55'],[3,9],{openCut:true});
// East 97th Street/Park Avenue in the mirrored street projection. The bore roof
// clears ground at this portal; the elevated deck is reached near 103rd Street.
// Include the far sidewalk, not only the road centre, in the covered crossing.
const portal=nearestDistance(parkAvenue.points,2645,-3707)+25;
setProfile(parkAvenue,[[0,-14],[portal-350,-14],[portal+490,8],[parkAvenue.length,8]]);
// Retain the wider island platforms and branch junction, closing to 3.4 m
// centres between stations. GTFS follows a service path, slightly west of the
// street median; centre the compact corridor within the two carriageways.
parkAvenue.compactTracks=true;
for(const p of parkAvenue.points) {
  const shift=1.8*compactFactor(parkAvenue,p.s);
  p.x-=p.dz*shift;p.z+=p.dx*shift;
}
for(let i=0;i<parkAvenue.points.length;i++) {
  const a=parkAvenue.points[Math.max(0,i-1)],b=parkAvenue.points[Math.min(parkAvenue.points.length-1,i+1)],d=Math.hypot(b.x-a.x,b.z-a.z);
  parkAvenue.points[i].dx=(b.x-a.x)/d;parkAvenue.points[i].dz=(b.z-a.z)/d;
}
parkAvenue.obstacles=railClearance[parkAvenue.id]??[];
parkAvenue.baseHeight=parkAvenue.height;
parkAvenue.height=s=>clearanceHeight(parkAvenue.baseHeight,s,parkAvenue.obstacles);
parkAvenue.points.forEach(p=>p.y=parkAvenue.height(p.s));

const yankees=hudson.stations[0].s;
setProfile(hudson,[[0,8],[yankees+110,8],[yankees+810,2],[hudson.length,2]]);
setProfile(harlem,[[0,8],[100,8],[harlem.stations[0].s-110,-8],[harlem.length,-8]]);
// The GTFS shapes share their exact trunk endpoint. Share its frame too: each
// branch's tracks leave the same positions, without duplicating the trunk.
for(const branch of [hudson,harlem]) {
  const end=parkAvenue.points.at(-1),start=branch.points[0];
  start.dx=end.dx;start.dz=end.dz;
}
parkAvenue.bridgeSpans=[[nearestDistance(parkAvenue.points,...project(-73.9340,40.8112)),nearestDistance(parkAvenue.points,...project(-73.9318,40.8131))]];
export const authoredRoutes=[route,parkAvenue,hudson,harlem];
function applyRoadClearance(r,spans) {
  r.roadBaseHeight=r.height;
  r.roadBasePoints=r.points;
  const plan=railRoadPlans[r.id];
  if(!spans?.length&&!plan)return;
  const stations=r.stations.map(st=>({...st,length:st.length??r.platformLength??PLATFORM_LENGTH}));
  if(plan) {
    r.points=r.points.map(p=>({...p}));
    const interpolate=(points,s)=>{
      let lo=0,hi=points.length-1;
      while(lo+1<hi){const m=(lo+hi)>>1;if(points[m][0]<=s)lo=m;else hi=m;}
      const a=points[lo],b=points[hi];return lerp(a[1],b[1],clamp((s-a[0])/(b[0]-a[0]||1),0,1));
    };
    r.height=roadBoundsProfile(s=>interpolate(plan.base,s),plan.bounds,plan.grade);
    r.portalGrades=[{grade:MAX_PORTAL_GRADE}];
    for(const p of r.points) {
      const offset=interpolate(plan.offsets,p.s);
      p.x-=p.dz*offset;p.z+=p.dx*offset;
    }
    r.points.forEach((p,i)=>{
      const a=r.points[Math.max(0,i-1)],b=r.points[Math.min(r.points.length-1,i+1)],d=Math.hypot(b.x-a.x,b.z-a.z)||1;
      p.dx=(b.x-a.x)/d;p.dz=(b.z-a.z)/d;
    });
  }else {
    r.height=roadClearanceProfile(r.height,stations,spans);
    if(railRoadTunnels[r.id]?.length) {
      const profile=roadTunnelProfile(r.height,stations,spans,railRoadTunnels[r.id],r.length);
      r.height=profile.height;r.portalGrades=profile.caps;
    }
  }
  r.points.forEach(p=>p.y=r.height(p.s));
  if(r.portalGrades?.length) {
    // Keep the rendered deck/collider on the same descent as sampled trains,
    // including where a buried-road bound meets the original smooth grade.
    const refined=[r.points[0]];
    const split=(a,b,depth=0)=>{
      const error=Math.max(...[.25,.5,.75].map(t=>Math.abs(r.height(lerp(a.s,b.s,t))-lerp(a.y,b.y,t))));
      if(error>.002&&depth<10&&b.s-a.s>.01) {
        const mid=sample(r,(a.s+b.s)/2);mid.structure=a.structure;
        split(a,mid,depth+1);split(mid,b,depth+1);
      } else refined.push(b);
    };
    for(let i=1;i<r.points.length;i++)split(r.points[i-1],r.points[i]);
    r.points=refined;
  }
  r.stations.forEach(st=>st.y=r.height(st.s));
}
for(const r of authoredRoutes)applyRoadClearance(r,railRoadClearance[r.id]);
export const mappedRoutes=mappedData.routes.map(data=>{
  const points=data.points.map(([x,z,y,s,structure])=>({x,z,y,s,structure:['surface','tunnel','bridge','cutting'][structure]}));
  for(let i=0;i<points.length;i++) {
    const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],d=Math.hypot(b.x-a.x,b.z-a.z)||1;
    points[i].dx=(b.x-a.x)/d;points[i].dz=(b.z-a.z)/d;
  }
  const r={...data,stations:data.stations.map(st=>({...st})),mapped:true,points,tracks:[0],platformOffsets:[],island:true,platformLength:200,
    label:data.kind==='subway'?'S':'R',color:data.kind==='subway'?'#555e68':'#0039a6'};
  const basePoints=points.map(p=>({s:p.s,y:p.y}));
  r.height=s=>{
    let lo=0,hi=basePoints.length-1;
    while(lo+1<hi){const m=(lo+hi)>>1;if(basePoints[m].s<=s)lo=m;else hi=m;}
    const a=basePoints[lo],b=basePoints[hi];return lerp(a.y,b.y,clamp((s-a.s)/(b.s-a.s||1),0,1));
  };
  applyRoadClearance(r,railRoadClearance[r.id]);
  return r;
});
export const mapStats=mappedData.stats;
export const routes=[...authoredRoutes,...mappedRoutes];
export const routeById=new Map(routes.map(r=>[r.id,r]));

export function layout(route,station,s=station?.s) {
  const compact=Number.isFinite(s)?compactFactor(route,s):0;
  const tracks=(route.tracks??[-2,2]).map(offset=>Number.isFinite(s)?trackOffset(route,s,offset):offset);
  const margin=2.3-.65*compact;let min=Math.min(...tracks)-margin,max=Math.max(...tracks)+margin;
  const platforms=route.island?(route.mapped?(station?[station.offset]:[]):route.platformOffsets).map(offset=>({offset,width:2.8,edges:route.mapped?[offset-Math.sign(offset)*1.15]:[offset-1.15,offset+1.15]}))
    :[-1,1].map(side=>({offset:side*6.4,width:5.8,side,edges:[side*3.8]}));
  const hub=station&&hubs.get(station.key),direct=hub?.direct&&Number.isFinite(hub.platformWidth);
  if(route.mapped&&direct)Object.assign(platforms[0],{offset:hub.platformOffset,width:hub.platformWidth,edges:[Math.sign(station.offset)*1.8]});
  if(route.mapped&&station){min=Math.min(min,(direct?hub.platformOffset-hub.platformWidth/2-.2:station.offset-1.6));max=Math.max(max,(direct?hub.platformOffset+hub.platformWidth/2+.2:station.offset+1.6));}
  return {tracks,min,max,center:(min+max)/2,width:max-min,platforms};
}

for(const r of routes) {
  r.segmentsByTile=new Map();
  for(let i=1;i<r.points.length;i++) {
    const a=r.points[i-1],b=r.points[i],key=tileKey((a.x+b.x)/2,(a.z+b.z)/2);
    if(!r.segmentsByTile.has(key))r.segmentsByTile.set(key,[]);
    r.segmentsByTile.get(key).push([a,b]);
  }
  r.stations.forEach(station=>{station.routeId=r.id;station.key=`${r.id}:${station.id}`;});
  r.entrances=r.stations.filter(station=>!hubs.has(station.key)).flatMap(station=>r.island?layout(r,station).platforms.map(({offset})=>({
    station,side:Math.sign(offset),offset,start:station.s-(station.length??r.platformLength)/2-32,end:station.s-(station.length??r.platformLength)/2-2,
    top:.16,bottom:station.y+1.15,island:true,landing:station.s-(station.length??r.platformLength)/2-.5,street:station.s-(station.length??r.platformLength)/2-33.5,
  })):[-1,1].map(side=>({station,side,offset:side*16,start:station.s-52,end:station.s-22,
    top:station.y<0?.16:station.y+1.15,bottom:station.y<0?station.y+1.15:.16,
    landing:station.s-(station.y<0?20.5:53.5),street:station.s-(station.y<0?54:20),
  })));
}
// Retain the Broadway aliases for existing tooling; the runtime uses routes.
export const segmentsByTile=route.segmentsByTile;
export const entrances=route.entrances;
const railSegmentsByTile=new Map();
for(const r of routes)for(const [key,segments] of r.segmentsByTile) {
  if(!railSegmentsByTile.has(key))railSegmentsByTile.set(key,[]);
  railSegmentsByTile.get(key).push({route:r,segments});
}
export function splitStationSegments(route,segments) {
 const boundaries=route.stations.flatMap(s=>{const half=(s.length??route.platformLength??PLATFORM_LENGTH)/2;return [s.s-half,s.s+half];});
 return segments.flatMap(([a,b])=>{const points=[a,...boundaries.filter(s=>s>a.s&&s<b.s).sort((a,b)=>a-b).map(s=>({...sample(route,s),structure:a.structure})),b];return points.slice(1).map((p,i)=>[points[i],p]);});
}
// Shared chamber volumes also close the outer rim of intersecting bores.
const chamberCache=new WeakMap();
export function railPassageVolumes(a,b,owner=null) {
 const result=[];
 for(let x=Math.floor((Math.min(a.x,b.x)-20)/256);x<=Math.floor((Math.max(a.x,b.x)+20)/256);x++)
 for(let z=Math.floor((Math.min(a.z,b.z)-20)/256);z<=Math.floor((Math.max(a.z,b.z)+20)/256);z++)
 for(const item of railSegmentsByTile.get(`${x}_${z}`)??[]) {
  if(item.route===owner)continue;
  for(const segment of item.segments) {
   const [p,q]=segment;
   if(Math.max(p.x,q.x)<Math.min(a.x,b.x)-25||Math.min(p.x,q.x)>Math.max(a.x,b.x)+25||Math.max(p.z,q.z)<Math.min(a.z,b.z)-25||Math.min(p.z,q.z)>Math.max(a.z,b.z)+25)continue;
   let volume=chamberCache.get(segment);
   if(!volume){volume=splitStationSegments(item.route,[segment]).map(([p,q])=>{const l=layout(item.route,stationAt(item.route,(p.s+q.s)/2),(p.s+q.s)/2);return passageVolume(p,q,!item.route.island&&stationAt(item.route,(p.s+q.s)/2)?9.2:l.width/2-.05,-.5,5.15,l.center);});chamberCache.set(segment,volume);}
   result.push(...volume);
  }
 }
 return result;
}
/** Keep walls and parapets out of connected tracks and neighboring platforms.
 * Distinct underground layers retain their own enclosure. */
export function railPassageAt(owner,x,z,y) {
  const tx=Math.floor(x/256),tz=Math.floor(z/256);
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const item of railSegmentsByTile.get(`${tx+dx}_${tz+dz}`)??[]) {
    if(item.route===owner)continue;
    for(const [a,b] of item.segments) {
      const vx=b.x-a.x,vz=b.z-a.z,d=vx*vx+vz*vz,t=((x-a.x)*vx+(z-a.z)*vz)/(d||1);
      if(t<0||t>1)continue;
      const floor=lerp(a.y,b.y,t);if(y<floor-.2||y>floor+4.8)continue;
      const offset=((z-a.z)*vx-(x-a.x)*vz)/Math.sqrt(d||1),station=stationAt(item.route,lerp(a.s,b.s,t)),l=layout(item.route,station,lerp(a.s,b.s,t));
      if(l.tracks.some(track=>Math.abs(offset-track)<1.9)||l.platforms.some(p=>Math.abs(offset-p.offset)<p.width/2+.2))return true;
    }
  }
  return false;
}

export function joinRoutes(sections) {
  let length=0;const points=[],stations=[],parts=[];
  for(const route of sections) {
    const start=length;parts.push({route,start,end:start+route.length});
    for(const p of route.points)if(!points.length||p.s>0)points.push({...p,s:p.s+start});
    stations.push(...route.stations.map(station=>({...station,s:station.s+start})));
    length+=route.length;
  }
  const partAt=s=>parts.find(part=>s<=part.end)??parts.at(-1);
  return {points,stations,length,partAt,height:s=>{const p=partAt(s);return p.route.height(s-p.start);}};
}
export const services=[
  {id:'broadway',path:joinRoutes([route]),kind:'subway',tracks:{1:2,'-1':-2},doors:{1:1,'-1':-1}},
  {id:'hudson',path:joinRoutes([parkAvenue,hudson]),kind:'commuter',tracks:{1:-9,'-1':-3},doors:{1:1,'-1':-1}},
  {id:'harlem-new-haven',path:joinRoutes([parkAvenue,harlem]),kind:'commuter',tracks:{1:3,'-1':9},doors:{1:1,'-1':-1}},
  ...mappedRoutes.filter(r=>r.length>500&&r.stations.length).map(r=>({id:r.id,path:joinRoutes([r]),kind:r.kind,
    directions:[signData.trainDirections[r.id]??1],tracks:{1:0,'-1':0},doors:{1:Math.sign(r.stations[0].offset),'-1':Math.sign(r.stations[0].offset)}})),
];
export function ringAt(a,b,width) {
  return [[a.x+a.dz*width,a.z-a.dx*width],[b.x+b.dz*width,b.z-b.dx*width],
    [b.x-b.dz*width,b.z+b.dx*width],[a.x-a.dz*width,a.z+a.dx*width]];
}
export function roadTunnelAt(route,a,b) {
  return Math.max(a.y,b.y)<-5.7&&(railRoadTunnels[route.id]??[]).some(([start,end])=>a.s<=end&&b.s>=start);
}
export function openPortal(route,a,b) {
  return !roadTunnelAt(route,a,b)&&Math.min(a.y,b.y)<.3&&(route.openCut||a.structure==='cutting'||Math.max(a.y,b.y)>-5.5);
}
export const portalHoles = [];
export const waterHoles = [];
for(const r of routes) {
  const l=layout(r);
  r.portalCaps=[];
  for(let i=1;i<r.points.length;i++) {
    const a=r.points[i-1],b=r.points[i];
    if(openPortal(r,a,b)) {
      // Only cap the buried end. The other end opens along the rising tracks.
      if(i>1&&!openPortal(r,r.points[i-2],a)&&a.y< -5.5)r.portalCaps.push(a.s);
      if(i+1<r.points.length&&!openPortal(r,b,r.points[i+1])&&b.y< -5.5)r.portalCaps.push(b.s);
      const la=layout(r,null,a.s),lb=layout(r,null,b.s);
      const pa=sample(r,a.s,la.center),pb=sample(r,b.s,lb.center),wa=la.width/2+.2,wb=lb.width/2+.2;
      portalHoles.push([[pa.x+pa.dz*wa,pa.z-pa.dx*wa],[pb.x+pb.dz*wb,pb.z-pb.dx*wb],
        [pb.x-pb.dz*wb,pb.z+pb.dx*wb],[pa.x-pa.dz*wa,pa.z+pa.dx*wa]]);
    }
  }
  // Coarser water footprints keep clipping the city-wide plane inexpensive.
  for(let s=0;s<r.length;s+=50) {
    const a=sample(r,s,l.center),b=sample(r,Math.min(r.length,s+50),l.center);
    if(Math.min(a.y,b.y)<0)waterHoles.push(ringAt(a,b,Math.max(10,l.width/2+1)));
  }
}
export const entranceHoles = routes.flatMap(r=>r.entrances.filter(e=>e.station.y<0)
  .map(e=>ringAt(sample(r,e.start,e.offset),sample(r,e.end,e.offset),1.6)));
waterHoles.push(...entranceHoles,...accessWaterHoles);
export const surfaceHoles = [...portalHoles,...entranceHoles,...accessSurfaceHoles];
function indexHoles(holes) {
const byTile=new Map();
for(const hole of holes) {
  const xs=hole.map(p=>p[0]),zs=hole.map(p=>p[1]);
  for(let x=Math.floor(Math.min(...xs)/256);x<=Math.floor(Math.max(...xs)/256);x++)
    for(let z=Math.floor(Math.min(...zs)/256);z<=Math.floor(Math.max(...zs)/256);z++) {
      const key=`${x}_${z}`;if(!byTile.has(key))byTile.set(key,[]);byTile.get(key).push(hole);
    }
}
return byTile;
}
const holesByTile=indexHoles(surfaceHoles),waterByTile=indexHoles(waterHoles);
export function waterHolesForTiles(tiles) {
  const holes=new Set();for(const tile of tiles)for(const hole of waterByTile.get(`${tile.tx}_${tile.tz}`)??[])holes.add(hole);
  return [...holes];
}
export function holesForTile(tile) {
  return holesByTile.get(`${tile.tx}_${tile.tz}`)??[];
}
