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
