/** Lane assignments at actual motorway endpoints, shared by asphalt, paint and traffic. */
const cache = new WeakMap();
/** One-way carriageways laid out lane by lane: motorways, trunks, and primary bridges,
 * which carry no kerb parking and no turning lanes at a span's end. */
export const isHighway = r => (['motorway', 'trunk'].includes(r.cls) || r.cls === 'primary' && !!r.bridge) && r.oneway && !r.tunnel;
export const laneCount = r => Math.max(1, Math.min(10, r.lanes || 1));
export const laneWidth = r => Math.min(3.3, r.width / laneCount(r));
/** deck kept beyond a painted line so the paint is not cut by its own slab edge */
export const LINE_MARGIN = 0.3;
/** sibling edge lines closer than this are one line, painted once */
export const SHARED_LINE = 0.6;
const GORE_STEP = 2, GORE_REACH = 400, GORE_NEAR = 30, GORE_ALONG = 0.6;
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
    const record = {road:r, stations, length:stations.at(-1), ends:[null,null], phase:0, gores:[[],[]]};
    records.set(r.id,record);
    for(const end of [0,1]) {
      const p=end?r.pts.at(-1):r.pts[0], q=end?r.pts.at(-2):r.pts[1];
      const direction=end?unit(p[0]-q[0],p[1]-q[1]):unit(q[0]-p[0],q[1]-p[1]);
      const k=key(p), j=junctions.get(k)??{incoming:[],outgoing:[]};
      j[end?'incoming':'outgoing'].push({record,end,direction});junctions.set(k,j);
    }
  }
  const fans=[];
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
    let cursor=0;const used=new Set(), ends=[];
    for(const branch of branches) {
      const n=laneCount(branch.record.road);
      const indices=Array.from({length:n},(_,i)=>Math.min(slots.length-1,Math.floor((cursor+i+.5)*slots.length/total)));
      const values=indices.map(i=>slots[i]);
      for(const i of indices)used.add(i);
      // An open side ends on a lane line; the deck carries the paint past it.
      const left=indices[0]===0?-half:values[0]-w/2-LINE_MARGIN;
      const right=indices.at(-1)===slots.length-1?half:values.at(-1)+w/2+LINE_MARGIN;
      ends.push(branch.record.ends[branch.end]={members,direction,values,width:w,left,right,
        openLeft:indices[0]>0,openRight:indices.at(-1)<slots.length-1});
      cursor+=n;
    }
    const trunkValues=slots.map((v,i)=>used.has(i)?v:slots[[...used].sort((a,b)=>Math.abs(a-i)-Math.abs(b-i)||a-b)[0]]);
    // A lone branch narrower than the trunk is a lane opening or closing: the
    // trunk tapers to the branch's envelope instead of stepping out past it.
    const only=branches.length===1?ends[0]:null;
    trunk.record.ends[trunk.end]={members,direction,values:trunkValues,width:w,
      left:only?.openLeft?only.left:-half,right:only?.openRight?only.right:half,openLeft:false,openRight:false};
    for(let i=1;i<branches.length;i++)fans.push([branches[i-1],branches[i]]);
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
  // The deck builder's miter frames, so lane edges sampled here land exactly
  // where the asphalt and paint will.
  const frames=r=>r.frames??=r.road.pts.map((p,i,pts)=>{
    const last=pts.length-1;
    const before=i>0?unit(p[0]-pts[i-1][0],p[1]-pts[i-1][1]):null;
    const after=i<last?unit(pts[i+1][0]-p[0],pts[i+1][1]-p[1]):null;
    let incoming=before??after,outgoing=after??before;
    if(i===0&&r.ends[0])incoming=outgoing=r.ends[0].direction;
    if(i===last&&r.ends[1])incoming=outgoing=r.ends[1].direction;
    const tangent=unit(incoming[0]+outgoing[0],incoming[1]+outgoing[1]);
    const scale=Math.min(1.6,1/Math.max(.6,incoming[0]*tangent[0]+incoming[1]*tangent[1]));
    return {rx:-tangent[1]*scale,rz:tangent[0]*scale};
  });
  const pointAt=(r,s,lateral)=>{
    const st=r.stations,pts=r.road.pts,f=frames(r);
    let i=1;while(i<st.length-1&&st[i]<s)i++;
    const t=Math.max(0,Math.min(1,(s-st[i-1])/(st[i]-st[i-1]||1)));
    const rx=f[i-1].rx+(f[i].rx-f[i-1].rx)*t,rz=f[i-1].rz+(f[i].rz-f[i-1].rz)*t;
    return {x:pts[i-1][0]+(pts[i][0]-pts[i-1][0])*t+rx*lateral,z:pts[i-1][1]+(pts[i][1]-pts[i-1][1])*t+rz*lateral,rx,rz};
  };
  const layouts=new Map([...records].map(([id,r])=>{
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
    // Room between this side's outer lane line and a fan sibling's, Infinity clear of any
    // fan. Tables sample every GORE_STEP from the road's start; the last entry sits on its end.
    const gap=(s,side)=>{
      let g=Infinity;
      for(const {gaps} of r.gores[side]){
        const k=Math.max(0,Math.min(gaps.length-2,Math.floor(s/GORE_STEP))),a=gaps[k],b=gaps[k+1]??a;
        const t=Math.max(0,Math.min(1,(s-k*GORE_STEP)/(Math.min(r.length,(k+1)*GORE_STEP)-k*GORE_STEP||1)));
        g=Math.min(g,a===Infinity||b===Infinity?(t<.5?a:b):a+(b-a)*t);
      }
      return g;
    };
    const base=(s,q)=>{let v=(q-n/2)*w;for(const end of [0,1])if(r.ends[end])v+=(target(r.ends[end],q)-(q-n/2)*w)*weight(s,end);return v;};
    // Where a sibling's lanes overlap this road's, the pair is one roadway drawn as
    // two ways, or a lane both branches keep: each moves its lanes half the overlap
    // aside, except at the junction itself, where they must sit on the trunk's slots.
    const shift=(s,side)=>{
      const g=gap(s,side);if(!(g<0))return 0;
      let anchored=0;for(const t of r.gores[side])if(t.end>=0)anchored=Math.max(anchored,weight(s,t.end));
      return -g*(1-anchored)/2;
    };
    const offset=(s,q)=>{let v=base(s,q);for(const side of [0,1])if(r.gores[side].length)v-=(side?1:-1)*shift(s,side);return v;};
    /** room still between the two lane envelopes once both have moved aside */
    const room=(s,side)=>gap(s,side)+2*shift(s,side);
    return [id,{...r,count:n,width:w,offset,base,gap,
      edge(s,side){
        const sign=side?1:-1,fanEnds=r.gores[side].map(t=>t.end);
        let v=sign*hw,own=sign*hw;
        for(const end of [0,1])if(r.ends[end]){
          const d=((side?r.ends[end].right:r.ends[end].left)-sign*hw)*weight(s,end);
          v+=d;if(!fanEnds.includes(end))own+=d;
        }
        const g=room(s,side);
        if(g===Infinity)return v;
        // Beside a fan sibling the deck stops at the gore: half the room between
        // the two lane envelopes, up to the shoulder it would have had anyway,
        // and halfway through a lane the two still share. The decks stay one
        // surface until the lanes part, and neither is laid over the other's
        // paint. Once the sibling is clear, the tapered edge resumes.
        const env=offset(s,side?n:0),shoulder=Math.max(0,sign*(own-env));
        const margin=r.gores[side].some(t=>t.paints)?LINE_MARGIN*smooth(1-Math.abs(g)/SHARED_LINE):0;
        if(g<0)return env+sign*(g/2+margin);
        const gore=env+sign*Math.max(margin,Math.min(shoulder,g/2));
        return gore+(v-gore)*smooth((g/2-shoulder-LINE_MARGIN)/2);
      },
      open(s,side){
        // A sibling boundary is painted once, by the deck on its left, from where
        // the gore opens; inside a shared lane neither edge line exists yet.
        if(r.gores[side].length){const g=room(s,side);return r.gores[side].some(t=>!t.paints)?g<SHARED_LINE:g<0;}
        return r.ends.some((e,end)=>e&&(side?e.openRight:e.openLeft)&&weight(s,end)>.15);
      },
    }];
  }));
  // A fan sibling's outer lane line, followed through 1:1 continuations so a
  // way split beside its neighbour keeps the constraint.
  const chain=(record,end)=>{
    const out=[{record,end}];let total=record.length;
    for(let guard=0;guard<32&&total<GORE_REACH;guard++){
      const {record:last,end:e}=out.at(-1),far=e?0:1;
      const p=far?last.road.pts.at(-1):last.road.pts[0],j=junctions.get(key(p));
      if(!j||j.incoming.length!==1||j.outgoing.length!==1)break;
      const next=(far?j.outgoing:j.incoming)[0];
      if(out.some(o=>o.record===next.record)||j.incoming[0].direction[0]*j.outgoing[0].direction[0]+j.incoming[0].direction[1]*j.outgoing[0].direction[1]<.5)break;
      out.push({record:next.record,end:next.end});total+=next.record.length;
    }
    return out;
  };
  const envelope=(links,side)=>{
    const pts=[];let from=0;
    for(const {record,end} of links){
      const l=layouts.get(record.road.id),q=side?l.count:0;
      for(let d=0;d<=record.length;d+=GORE_STEP){const s=end?record.length-d:d;pts.push({...pointAt(record,s,l.base(s,q)),d:from+d});}
      from+=record.length;
    }
    return pts;
  };
  const tables=(links,side,other,paints)=>{
    let from=0;
    for(const [link,{record,end}] of links.entries()){
      const l=layouts.get(record.road.id),q=side?l.count:0,gaps=[];
      for(let k=0;k*GORE_STEP<record.length+GORE_STEP;k++){
        const s=Math.min(record.length,k*GORE_STEP),p=pointAt(record,s,l.base(s,q)),d=from+(end?record.length-s:s);
        const nx=(side?1:-1)*p.rx,nz=(side?1:-1)*p.rz,nd=Math.hypot(nx,nz)||1;
        // this road's direction away from the fan
        const tx=(end?-1:1)*p.rz/nd,tz=(end?1:-1)*p.rx/nd;
        let best=Infinity,near=GORE_NEAR;
        for(let i=1;i<other.length;i++){
          // Only the stretch of the sibling abreast of this station and running
          // with it: a ramp that loops back or crosses its trunk is not beside it.
          if(Math.abs(other[i].d-d)>d/2+GORE_STEP*4)continue;
          const a=other[i-1],b=other[i],dx=b.x-a.x,dz=b.z-a.z,d2=dx*dx+dz*dz;
          if(d2<1e-8||(dx*tx+dz*tz)/Math.sqrt(d2)<GORE_ALONG)continue;
          const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/d2));
          const qx=a.x+dx*t-p.x,qz=a.z+dz*t-p.z,dist=Math.hypot(qx,qz);
          if(dist<near){near=dist;best=(qx*nx+qz*nz)/nd;}
        }
        gaps.push(best);
      }
      // Once a whole way runs clear of its sibling the pair has parted for good.
      if(gaps.every(g=>g===Infinity))break;
      record.gores[side].push({gaps,paints,end:link?-1:end});
      from+=record.length;
    }
  };
  for(const [left,right] of fans){
    const a=chain(left.record,left.end),b=chain(right.record,right.end);
    const edgeA=envelope(a,1),edgeB=envelope(b,0);
    tables(a,1,edgeB,true);tables(b,0,edgeA,false);
  }
  return layouts;
}
