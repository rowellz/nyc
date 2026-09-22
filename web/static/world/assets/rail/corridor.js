// Shared by the offline clearance index and the runtime. Distances are metres.
const smooth=t=>t*t*(3-2*t);
export function compactFactor(route,s) {
  if(!route.compactTracks)return 0;
  let distance=Math.min(s,route.length-s);
  for(const station of route.stations)distance=Math.min(distance,Math.abs(s-station.s)-(station.length??route.platformLength)/2-45);
  return smooth(Math.max(0,Math.min(1,distance/180)));
}
export function trackOffset(route,s,offset) {
  if(route.partAt){const part=route.partAt(s);return trackOffset(part.route,s-part.start,offset);}
  return offset*(1-compactFactor(route,s)*(1-3.4/6));
}
// A plateau covers the whole footprint; smooth approaches are bounded at 4.5%.
// Taking the maximum preserves the grade bound where nearby obstacles overlap.
export function clearanceHeight(base,s,obstacles) {
  let y=base(s);
  for(const {start,end,height,approach} of obstacles) {
    const distance=Math.max(start-s,0,s-end);
    if(distance>=approach)continue;
    const floor=Math.min(base(start),base(end));
    y=Math.max(y,floor+(height-floor)*smooth(1-distance/approach));
  }
  return y;
}

// A raised rail deck clears surface traffic. Extend each protected span over
// any platform it touches, then approach it at the mapped rail grade limit.
export function roadClearanceProfile(base,stations,spans) {
  if(!spans?.length)return base;
  const protectedSpans=spans.map(([a,b])=>[a,b,7.5]);
  const stationFloors=new Map();
  const floorAt=s=>{
    let y=base(s);
    for(const [a,b,height] of protectedSpans) {
      const floor=height-0.055*Math.max(a-s,0,s-b);
      if(floor>y)y=floor;
    }
    return y;
  };
  // Approaches can reach a platform even when the road itself does not.
  // Carry the highest approached level across the entire platform.
  for(let pass=0;pass<100;pass++) {
    let changed=false;
    for(const station of stations) {
      const half=(station.length??200)/2;
      const height=Math.max(floorAt(station.s-half),floorAt(station.s+half));
      const previous=stationFloors.get(station)??base(station.s);
      if(height<=previous+1e-6)continue;
      stationFloors.set(station,height);
      const existing=protectedSpans.find(span=>span[3]===station);
      if(existing)existing[2]=height;
      else protectedSpans.push([station.s-half-12,station.s+half+12,height,station]);
      changed=true;
    }
    if(!changed)break;
  }
  return floorAt;
}

export const BURIED_RAIL_HEIGHT=-6.5; // Includes the 5.525 m bore roof and ground cover.
export const MAX_PORTAL_GRADE=.13; // Simulation limit for short, road-constrained descents.

// A crossing is an interval occupied by the entire structure, including walls.
// Choose above/below relationships together: adjacent streets cannot each pick
// a portal independently when there is too little room to change levels.
export function planRoadCrossings(base,stations,crossings,length,grade=MAX_PORTAL_GRADE) {
  const intervals=[...crossings.map(([start,end])=>({start,end,road:true})),
    ...stations.map(st=>({start:Math.max(0,st.s-(st.length??200)/2-12),
      end:Math.min(length,st.s+(st.length??200)/2+12),fixed:st.y})),
    {start:0,end:0,fixed:base(0)},{start:length,end:length,fixed:base(length)}]
    .sort((a,b)=>a.start-b.start);
  const groups=[];
  for(const interval of intervals) {
    const last=groups.at(-1);
    if(last&&interval.start<=last.end) {
      if(interval.fixed!==undefined&&last.fixed!==undefined&&Math.abs(interval.fixed-last.fixed)>1e-5)return null;
      last.end=Math.max(last.end,interval.end);last.road||=interval.road;
      if(interval.fixed!==undefined)last.fixed=interval.fixed;
    }else groups.push({...interval});
  }
  let previous=[];
  for(const [i,group] of groups.entries()) {
    const levels=group.fixed!==undefined?[group.fixed]:[7.5,BURIED_RAIL_HEIGHT];
    const states=[];
    for(const y of levels) {
      if(group.road&&y<7.5-1e-6&&y>BURIED_RAIL_HEIGHT+1e-6)continue;
      const cost=Math.abs(y-base((group.start+group.end)/2));
      if(!i){states.push({y,cost,group});continue;}
      const gap=group.start-groups[i-1].end;
      const choices=previous.filter(p=>Math.abs(y-p.y)<=grade*gap+1e-6);
      const parent=choices.sort((a,b)=>a.cost-b.cost)[0];
      if(parent)states.push({y,cost:parent.cost+cost,group,parent});
    }
    if(!states.length)return null;
    previous=states;
  }
  let state=previous.sort((a,b)=>a.cost-b.cost)[0];const bounds=[];
  while(state) {
    const {start,end,road,fixed}=state.group,y=state.y;
    bounds.push([start,end,fixed!==undefined?y:y>=7.5?7.5:null,
      fixed!==undefined?y:y<=BURIED_RAIL_HEIGHT?BURIED_RAIL_HEIGHT:null,!!road]);
    state=state.parent;
  }
  return bounds.reverse();
}

export function roadBoundsProfile(base,bounds,grade=MAX_PORTAL_GRADE) {
  return s=>{
    let low=-Infinity,high=Infinity;
    for(const [a,b,floor,ceiling] of bounds) {
      const change=grade*Math.max(a-s,0,s-b);
      if(floor!==null)low=Math.max(low,floor-change);
      if(ceiling!==null)high=Math.min(high,ceiling+change);
    }
    return Math.max(low,Math.min(high,base(s)));
  };
}

/** Keep a descending bore under roads. Distance through a station contributes
 * no descent, preserving level platforms. Short gaps between an overpass and
 * an underpass use the grade needed to fit both road clearances. */
export function roadTunnelProfile(base,stations,overpasses,underpasses,length) {
  const flats=stations.map(st=>[st.s-(st.length??200)/2-12,st.s+(st.length??200)/2+12]).sort((a,b)=>a[0]-b[0]);
  const merged=[];
  for(const span of flats) {
    if(merged.length&&span[0]<=merged.at(-1)[1])merged.at(-1)[1]=Math.max(merged.at(-1)[1],span[1]);
    else merged.push([...span]);
  }
  const distance=s=>s-merged.reduce((total,[a,b])=>total+Math.max(0,Math.min(s,b)-a),0);
  const anchors=[...overpasses.map(([a,b])=>[distance(a),distance(b),7.5]),
    ...stations.map(st=>[distance(st.s),distance(st.s),base(st.s)]),
    [distance(0),distance(0),base(0)],[distance(length),distance(length),base(length)]];
  const candidates=(underpasses??[]).map(([start,end])=>{
    const a=distance(start),b=distance(end);
    let grade=.055;
    for(const [u,v,y] of anchors)if(y>BURIED_RAIL_HEIGHT) {
      const gap=Math.max(a-v,u-b,0);
      grade=Math.max(grade,gap>0?(y-BURIED_RAIL_HEIGHT)/gap:Infinity);
    }
    return {start,end,a,b,grade};
  });
  const caps=candidates.filter(cap=>cap.grade<=MAX_PORTAL_GRADE);
  return {caps,rejected:candidates.filter(cap=>cap.grade>MAX_PORTAL_GRADE),height:s=>{
    const t=distance(s);
    let y=base(s);
    for(const {a,b,grade} of caps)y=Math.min(y,BURIED_RAIL_HEIGHT+grade*Math.max(a-t,0,t-b));
    return y;
  }};
}
