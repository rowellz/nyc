/** Lane assignments at actual motorway endpoints, shared by asphalt, paint and traffic. */
const cache = new WeakMap();
export const isHighway = r => ['motorway', 'trunk'].includes(r.cls) && r.oneway && !r.tunnel;
export const laneCount = r => Math.max(1, Math.min(10, r.lanes || 1));
export const laneWidth = r => Math.min(3.3, r.width / laneCount(r));
const key = p => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
const unit = (x, z) => { const d = Math.hypot(x, z) || 1; return [x / d, z / d]; };
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const centres = r => Array.from({length: laneCount(r)}, (_, i) => (i + .5 - laneCount(r) / 2) * laneWidth(r));

export function highwayLayout(road, roads) {
  if (!isHighway(road)) return null;
  let layouts = cache.get(roads);
  if (!layouts) { layouts = plan(roads); cache.set(roads, layouts); }
  return layouts.get(road.id) ?? null;
}

function plan(roads) {
  const records = new Map(), junctions = new Map();
  for (const r of [...roads].sort((a,b)=>a.id-b.id)) {
    if (!isHighway(r) || r.pts.length < 2 || records.has(r.id)) continue;
    const stations = [0];
    for(let i=1;i<r.pts.length;i++) stations.push(stations.at(-1)+Math.hypot(r.pts[i][0]-r.pts[i-1][0],r.pts[i][1]-r.pts[i-1][1]));
    const record = {road:r, stations, length:stations.at(-1), ends:[null,null], phase:0};
    records.set(r.id,record);
    for(const end of [0,1]) {
      const p=end?r.pts.at(-1):r.pts[0], q=end?r.pts.at(-2):r.pts[1];
      const direction=end?unit(p[0]-q[0],p[1]-q[1]):unit(q[0]-p[0],q[1]-p[1]);
      const k=key(p), j=junctions.get(k)??{incoming:[],outgoing:[]};
      j[end?'incoming':'outgoing'].push({record,end,direction});junctions.set(k,j);
    }
  }
  for(const {incoming,outgoing} of junctions.values()) {
    // Crossings in plan are never joins. Complex many-to-many intersections keep
    // their ordinary junction routing; a motorway merge/split has a single trunk.
    if(!incoming.length||!outgoing.length||incoming.length>1&&outgoing.length>1) continue;
    const trunk=outgoing.length===1?outgoing[0]:incoming[0];
    const branches=outgoing.length===1?incoming:outgoing;
    const direction=trunk.direction, normal=[-direction[1],direction[0]];
    if(branches.some(b=>b.record===trunk.record||b.direction[0]*direction[0]+b.direction[1]*direction[1]<.5))continue;
    // Order branches by their physical approach side, not record arrival order.
    const side=b=>{
      const r=b.record.road, pts=r.pts;
      const p=b.end?pts.at(-1):pts[0],q=b.end?pts.at(-2):pts[1];
      const d=Math.hypot(q[0]-p[0],q[1]-p[1])||1;
      return ((q[0]-p[0])*normal[0]+(q[1]-p[1])*normal[1])/d;
    };
    branches.sort((a,b)=>side(a)-side(b)||a.record.road.id-b.record.road.id);
    const members=branches.length>1?[trunk,...branches].map(b=>({id:b.record.road.id,end:b.end})):null;
    const main=trunk.record.road, slots=centres(main), total=branches.reduce((n,b)=>n+laneCount(b.record.road),0);
    const half=branches.length===1?(Math.max(3.2,main.width/2)+Math.max(3.2,branches[0].record.road.width/2))/2:Math.max(3.2,main.width/2), w=laneWidth(main);
    let cursor=0;const used=new Set();
    for(const branch of branches) {
      const n=laneCount(branch.record.road);
      const indices=Array.from({length:n},(_,i)=>Math.min(slots.length-1,Math.floor((cursor+i+.5)*slots.length/total)));
      const values=indices.map(i=>slots[i]);
      for(const i of indices)used.add(i);
      const left=indices[0]===0?-half:values[0]-w/2;
      const right=indices.at(-1)===slots.length-1?half:values.at(-1)+w/2;
      branch.record.ends[branch.end]={members,direction,values,width:w,left,right,
        openLeft:indices[0]>0,openRight:indices.at(-1)<slots.length-1};
      cursor+=n;
    }
    const trunkValues=slots.map((v,i)=>used.has(i)?v:slots[[...used].sort((a,b)=>Math.abs(a-i)-Math.abs(b-i)||a-b)[0]]);
    trunk.record.ends[trunk.end]={members,direction,values:trunkValues,width:w,left:-half,right:half,openLeft:false,openRight:false};
    // Continue the main dash phase across tag and lane-count changes.
    const next=outgoing[0].record;
    const prev=[...incoming].sort((a,b)=>laneCount(b.record.road)-laneCount(a.record.road)||a.record.road.id-b.record.road.id)[0].record;
    if(outgoing.length===1) next.previous=prev;
    else for(const b of outgoing)b.record.previous=prev;
  }
  const phased=new Set(), visiting=new Set();
  const phase=r=>{
    if(phased.has(r))return r.phase;
    if(visiting.has(r))return 0;
    visiting.add(r);
    r.phase=r.previous?(phase(r.previous)+r.previous.length)%12:0;
    visiting.delete(r);phased.add(r);return r.phase;
  };
  for(const r of records.values())phase(r);
  return new Map([...records].map(([id,r])=>{
    const road=r.road,n=laneCount(road),w=laneWidth(road),hw=Math.max(3.2,road.width/2);
    const target=(e,q)=>{
      if(q<=.5)return e.values[0]+(q-.5)*e.width;
      if(q>=n-.5)return e.values.at(-1)+(q-n+.5)*e.width;
      const i=Math.floor(q-.5),t=q-.5-i;
      return e.values[i]+(e.values[i+1]-e.values[i])*t;
    };
    const run=r.ends.map(e=>e?Math.min(r.length/(r.ends[0]&&r.ends[1]?2:1),Math.max(48,Math.abs(e.left+hw)*15,Math.abs(e.right-hw)*15,
      ...e.values.map((v,i)=>Math.abs(v-(i+.5-n/2)*w)*15))):0);
    const weight=(s,end)=>run[end]>0?1-smooth((end?r.length-s:s)/run[end]):0;
    return [id,{...r,count:n,width:w,
      offset(s,q){let v=(q-n/2)*w;for(const end of [0,1])if(r.ends[end])v+=(target(r.ends[end],q)-(q-n/2)*w)*weight(s,end);return v;},
      edge(s,side){let v=side?hw:-hw;for(const end of [0,1])if(r.ends[end])v+=((side?r.ends[end].right:r.ends[end].left)-(side?hw:-hw))*weight(s,end);return v;},
      open(s,side){return r.ends.some((e,end)=>e&&(side?e.openRight:e.openLeft)&&weight(s,end)>.15);},
    }];
  }));
}
