import {platformSignInfo,combineSignInfo,paintSign,boardPosition} from './signs.js?v=rail-road-crossings-90';
import {panelMesh,wallPanel} from './enclosure.js?v=rail-road-crossings-90';
import { g as BufferGeometry, h as BufferAttribute, kt as Mesh, Z as Group,
  Pt as MeshStandardMaterial, At as MeshBasicMaterial, y as CanvasTexture,
  rt as InstancedMesh, Ot as Matrix4 } from '../textureRelease-2U-gT89r.js?v=rail-road-crossings-90';
import { route as defaultRoute, routeById, layout, sample, sampleTrack, stationAt, openPortal, roadTunnelAt, railPassageVolumes, splitStationSegments, PLATFORM_LENGTH, TRAIN_CARS, CAR_LENGTH, CAR_SPACING } from './network.js?v=rail-road-crossings-90';
import { supportPlanner } from '../supports.js';
import {appendAccessGeometrySteps,platformOpening,platformStairAt,hubs,accessPassageVolumes,stationDestinations,transfers,accessesByStation} from './access.js?v=rail-chunk-pacing-79';

function finish(steps) {
  let result;
  do { result=steps.next(); } while(!result.done);
  return result.value;
}

// Use the shared endpoint frames, as the rails do, so curved wall/roof
// sections meet at the same corners instead of leaving wedge-shaped seams.
const framedPoint=(p,offset,y)=>[p.x-p.dz*offset,p.y+y,p.z+p.dx*offset];
const framedWall=(a,b,offset,low,high,endOffset=offset)=>[framedPoint(a,offset,low),framedPoint(b,endOffset,low),framedPoint(b,endOffset,high),framedPoint(a,offset,high)];
const framedRoof=(a,b,min,max,y,endMin=min,endMax=max)=>[framedPoint(a,min,y),framedPoint(b,endMin,y),framedPoint(b,endMax,y),framedPoint(a,max,y)];

// One indexed mesh per material per streamed tile. Collision uses the same
// vertices; no per-sleeper colliders, lights, or independently allocated meshes.
export class Builder {
  constructor() { this.layers = new Map(); this.collision = { position: [], index: [] }; }
  // Sleepers sit in ballast and have no collision. Their visible top is enough
  // on mobile; avoid five hidden box faces for every tie along every track.
  plate(p,width,length,material,y=0,offset=0) {
    let layer=this.layers.get(material);
    if(!layer){layer={position:[],index:[]};this.layers.set(material,layer);}
    const base=layer.position.length/3;
    for(const [x,z] of [[-1,-1],[1,-1],[1,1],[-1,1]]) {
      const across=x*width/2+offset,along=z*length/2;
      layer.position.push(p.x-p.dz*across+p.dx*along,p.y+y,p.z+p.dx*across+p.dz*along);
    }
    layer.index.push(base,base+1,base+2,base,base+2,base+3);
  }
  box(p, width, height, length, material, y=0, offset=0, solid=false, slope=0) {
    if (!(width>0 && height>0 && length>0)) return;
    const verts=[];
    for (const [x,h,z] of [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]) {
      const across=x*width/2+offset, along=z*length/2;
      verts.push(p.x-p.dz*across+p.dx*along,p.y+y+h*height/2+along*slope,p.z+p.dx*across+p.dz*along);
    }
    const idx=[0,2,1,0,3,2,4,5,6,4,6,7,0,4,7,0,7,3,1,2,6,1,6,5,3,7,6,3,6,2,0,1,5,0,5,4];
    // Across is the route's left normal, a reflected local basis.
    for(let i=0;i<idx.length;i+=3)[idx[i+1],idx[i+2]]=[idx[i+2],idx[i+1]];
    let layer=this.layers.get(material);
    if (!layer) { layer={position:[],index:[]}; this.layers.set(material,layer); }
    for (const target of solid ? [layer,this.collision] : [layer]) {
      const base=target.position.length/3; target.position.push(...verts); target.index.push(...idx.map(i=>i+base));
    }
  }
  span(a,b,width,height,material,y=0,offset=0,solid=false) {
    const length=Math.hypot(b.x-a.x,b.z-a.z);
    if (length<0.001) return;
    this.box({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2,dx:(b.x-a.x)/length,dz:(b.z-a.z)/length},
      width,height,length+0.015,material,y,offset,solid,(b.y-a.y)/length);
  }
  panel(points,thickness,material,cuts=[]) {
    if(points.flat().some(v=>!Number.isFinite(v)))throw Error("Invalid enclosure panel "+JSON.stringify(points));
    const data=panelMesh(points,thickness,cuts);if(!data.index.length)return;
    let layer=this.layers.get(material);if(!layer){layer={position:[],index:[]};this.layers.set(material,layer);}
    for(const target of [layer,this.collision]) {
      const base=target.position.length/3;target.position.push(...data.position);target.index.push(...data.index.map(i=>i+base));
    }
  }
  build(materials) {
    return finish(this.buildSteps(materials));
  }
  *buildSteps(materials) {
    const group=new Group();
    let complete=false;
    try {
      for (const [kind,data] of this.layers) {
        const g=new BufferGeometry(); g.setAttribute('position',new BufferAttribute(Float32Array.from(data.position),3));
        const mesh=new Mesh(g,materials[kind]); mesh.receiveShadow=true; group.add(mesh);
        yield;
        g.setIndex(data.index); yield;
        g.computeVertexNormals(); yield;
        g.computeBoundingSphere(); yield;
      }
      complete=true;
      return group;
    } finally {
      if(!complete)group.traverse(o=>o.geometry?.dispose());
    }
  }
}

export function materials() {
  const standard=(color,roughness=0.85,metalness=0)=>new MeshStandardMaterial({color,roughness,metalness});
  return {
    ballast:standard(0x343639), concrete:standard(0x98958b), steel:standard(0x626e73,0.35,0.75),
    sleeper:standard(0x4c453d), tile:standard(0xc9c8b9), green:standard(0x18493f,0.55,0.3),
    yellow:standard(0xe5b72d), dark:standard(0x151c23), body:standard(0xa5acb0,0.4,0.6),
    blue:standard(0x0039a6), red:standard(0xee352e), window:new MeshBasicMaterial({color:0x344653}),
    light:new MeshBasicMaterial({color:0xffefd1}),
  };
}

export function buildTrack(segments, roads = [], route=defaultRoute, mobile=false) {
  return finish(buildTrackSteps(segments,roads,route,mobile));
}
export function* buildTrackSteps(segments, roads = [], route=defaultRoute, mobile=false) {
  segments=splitStationSegments(route,segments).flatMap(([a,b])=>{
    const cuts=route.stations.flatMap(station=>{const h=hubs.get(station.key);return h?[h.start,h.end]:[];}).filter(s=>s>a.s&&s<b.s).sort((a,b)=>a-b);
    const points=[a,...cuts.map(s=>({...sample(route,s),structure:a.structure})),b];return points.slice(1).map((p,i)=>[points[i],p]);
  });
  const b=new Builder(),entrances=route.entrances;
  const shift=(p,offset)=>({...p,x:p.x-p.dz*offset,z:p.z+p.dx*offset});
  const guard=(a,c)=>{
    // A single collision envelope prevents capsules slipping between bars.
    // Render open metalwork instead of an opaque wall above the sidewalk.
    const points=[[a.x,a.y,a.z],[c.x,c.y,c.z],[c.x,c.y+1.2,c.z],[a.x,a.y+1.2,a.z]];
    const mesh=panelMesh(points,.1),base=b.collision.position.length/3;
    b.collision.position.push(...mesh.position);b.collision.index.push(...mesh.index.map(i=>i+base));
    for(const y of [.12,.6,1.2])b.span(a,c,.07,.07,'green',y);
    const count=Math.max(1,Math.ceil(Math.hypot(c.x-a.x,c.z-a.z)/1.5));
    for(let i=0;i<=count;i++)b.box({...a,x:a.x+(c.x-a.x)*i/count,y:a.y+(c.y-a.y)*i/count,z:a.z+(c.z-a.z)*i/count},.09,1.25,.09,'green',.6);
  };
  let planSupport;
  if(segments.some(([a,c])=>Math.max(a.y,c.y)>2)) {
    const points=segments.flat(),margin=55;
    const minX=Math.min(...points.map(p=>p.x))-margin,maxX=Math.max(...points.map(p=>p.x))+margin;
    const minZ=Math.min(...points.map(p=>p.z))-margin,maxZ=Math.max(...points.map(p=>p.z))+margin;
    const nearby=roads.filter(r=>r.pts.some(([x,z],i)=>i>0
      &&Math.max(x,r.pts[i-1][0])>=minX&&Math.min(x,r.pts[i-1][0])<=maxX
      &&Math.max(z,r.pts[i-1][1])>=minZ&&Math.min(z,r.pts[i-1][1])<=maxZ));
    planSupport=supportPlanner({tile:{roads:nearby}},()=>null);
  }
  for(const [a,c] of segments) {
    yield;
    if(Math.hypot(c.x-a.x,c.z-a.z)<.001)continue;
    const mid=(a.s+c.s)/2,p=sample(route,mid),station=stationAt(route,mid);
    const accessStation=station??entrances.find(e=>mid>=e.start-3&&mid<=e.end+3)?.station;
    const l=layout(route,accessStation,mid),la=layout(route,accessStation,a.s),lc=layout(route,accessStation,c.s);
    const cuts=[...accessPassageVolumes(a,c),...(route.mapped?railPassageVolumes(a,c,route):[])];
    const underground=p.y<0&&((!route.openCut&&a.structure!=='cutting')||roadTunnelAt(route,a,c));
    // A continuous invert seals the gaps between ballast, platforms and walls.
    if(underground)b.panel(framedRoof(a,c,la.min-.4,la.max+.4,-.65,lc.min-.4,lc.max+.4),.3,'concrete',accessPassageVolumes(a,c));
    const stairwell=entrances.filter(e=>e.island&&mid>=e.start-3&&mid<=e.end+3);
    const bridge=route.bridgeSpans?.some(([start,end])=>mid>=start&&mid<=end);
    if(!route.island)b.span(a,c,l.width,.32,'ballast',-.3,l.center,true);
    for(const trackIndex of l.tracks.keys()) {
      const ta=shift(a,la.tracks[trackIndex]),tc=shift(c,lc.tracks[trackIndex]);
      if(route.island)b.span(ta,tc,3,.32,'ballast',-.3,0,true);
      // Offset the shared endpoint frames, including the branch junction.
      for(const rail of [-.7175,.7175])b.span(shift(a,la.tracks[trackIndex]+rail),shift(c,lc.tracks[trackIndex]+rail),.075,.15,'steel');
      for(let s=Math.ceil(a.s/.8)*.8;s<c.s;s+=.8) {
        if(mobile)b.plate(sampleTrack(route,s,(route.tracks??[-2,2])[trackIndex]),2.6,.22,'sleeper',-.06);
        else b.box(sampleTrack(route,s,(route.tracks??[-2,2])[trackIndex]),2.6,.16,.22,'sleeper',-.14);
      }
      if(route.island&&p.y>=.3)b.span(ta,tc,3,.6,'steel',-.7,0,true);
    }
    if(station) {
      for(const platform of l.platforms) {
        if(platformOpening(station,mid,platform.offset))continue;
        if(hubs.get(station.key)?.direct) {
          const p={...a,y:station.y},q={...c,y:station.y},min=platform.offset-platform.width/2,max=platform.offset+platform.width/2;
          const openings=accessPassageVolumes(a,c);
          b.panel(framedRoof(p,q,min,max,1.075),.15,'concrete',openings);
          for(const edge of [min,max])b.panel(framedWall(p,q,edge,-.35,1.15),.12,'concrete',openings);
        }else b.span({...a,y:station.y},{...c,y:station.y},platform.width,1.5,'concrete',.4,platform.offset,true);
        for(const edge of platform.edges)b.span({...a,y:station.y},{...c,y:station.y},route.island?.2:.55,.025,'yellow',1.163,edge);
        if(!route.island&&(hubs.has(station.key)||Math.abs(mid-(station.s-(station.y<0?20.5:53.5)))>2.8))
          b.panel(framedWall(a,c,platform.side*9.4,1.15,underground?5.25:2.25),.25,underground?'tile':'green',cuts);
        if(!underground)b.span(a,c,platform.width+.2,.2,'green',4.7,platform.offset,true);
      }
    }
    if(p.y<.3) {
      // A buried bore owns only its own storey. Extending its retaining walls
      // to street level blocks every platform and track stacked above it.
      const open=!station&&openPortal(route,a,c);
      const wallHeight=underground&&Math.max(a.y,c.y)<-5.7?5.5:Math.max(5.5,-Math.min(a.y,c.y)+.4);
      if(route.island||!station)for(const side of ['min','max']) {
        const offset=side==='min'?-.2:.2,points=framedWall(a,c,la[side]+offset,-.4,wallHeight-.1,lc[side]+offset);
        if(open){points[2][1]=.3;points[3][1]=.3;}
        b.panel(points,.35,'concrete',cuts);
        if(open)guard({...shift(a,la[side]+offset),y:.3},{...shift(c,lc[side]+offset),y:.3});
      }
      if(underground&&(station||Math.max(a.y,c.y)<-5.7)) {
        const half=station&&!route.island?9.5:l.width/2+.4;
        let from=l.center-half;
        for(const hole of stairwell.sort((a,b)=>a.offset-b.offset)) {
          const to=hole.offset-1.5;
          if(to>from)b.span(a,c,to-from,.35,'concrete',5.35,(from+to)/2,true);
          from=hole.offset+1.5;
        }
        const to=l.center+half;
        if(to>from)b.panel(route.compactTracks?framedRoof(a,c,stairwell.length?from:la.min-.4,la.max+.4,5.35,stairwell.length?from:lc.min-.4,lc.max+.4):framedRoof(a,c,from,to,5.35),.35,'concrete',cuts);
      }
    } else {
      if(!route.island&&!station)b.span(a,c,l.width+.8,.6,'steel',-.7,l.center,true);
      if(route.island||!station)for(const side of ['min','max'])b.panel(framedWall(a,c,la[side]+(side==='min'?-.25:.25),-.2,1,lc[side]+(side==='min'?-.25:.25)),.18,'green',cuts);
    }
    for(const s of route.portalCaps??[])if(s>=a.s&&s<c.s) {
      const p=sample(route,s),l=layout(route,null,s);
      const left={...shift(p,l.min-.2),y:.3},right={...shift(p,l.max+.2),y:.3};
      // A lintel seals the covered end without obstructing the train bore.
      b.panel([[left.x,p.y+5.1,left.z],[right.x,p.y+5.1,right.z],[right.x,.3,right.z],[left.x,.3,left.z]],.3,'concrete');
      guard(left,right);
    }
    if(station&&underground) {
      const half=(station.length??route.platformLength??PLATFORM_LENGTH)/2;
      for(const endpoint of [a,c])if(Math.abs(Math.abs(endpoint.s-station.s)-half)<.001) {
        const bore=layout(route,null),room=route.island?l:{min:-9.2,max:9.2},frame=sample(route,endpoint.s);
        for(const [from,to] of [[room.min-.35,bore.min-.2],[bore.max+.2,room.max+.35]])if(to>from) {
          const left=shift(frame,from),right=shift(frame,to);
          b.panel(wallPanel(left,right,0,-.4,5.35),.35,'concrete',cuts);
        }
      }
    }
    if(bridge) {
      // A continuous four-track river span, with shore towers rather than piers
      // appearing to stand on the water surface. Lift machinery is static.
      for(const edge of [l.min-.4,l.max+.4]) {
        b.span(a,c,.25,.25,'steel',4,edge,true);
        for(let s=Math.ceil(a.s/12)*12;s<c.s;s+=12) {
          const p=sample(route,s,edge),q=sample(route,s+12,edge);
          b.box(p,.25,4,.25,'steel',2,0,true);
          b.span({...p,y:p.y+.2},{...q,y:q.y+4},.2,.2,'steel');
        }
      }
    }
    for(const [start,end] of route.bridgeSpans??[])for(const s of [start,end])if(s>=a.s&&s<c.s) {
      for(const edge of [l.min-.6,l.max+.6]) {
        const q=sample(route,s,edge),height=q.y+20;
        b.box({...q,y:-8},1.8,height,2.6,'steel',height/2,0,true);
      }
    }
    for(let s=Math.ceil(a.s/18)*18;s<c.s;s+=18) {
      const q=sample(route,s);
      const access=entrances.some(e=>e.island&&s>=e.start-3&&s<=e.end+3);
      const overBuilding=route.obstacles?.some(o=>s>=o.start-1&&s<=o.end+1);
      if(q.y>2&&!bridge&&!access&&!overBuilding) {
        const center=shift(q,l.center),plan=planSupport({id:'rail'},center,l.width/2+.4,q.y-.7,.55,.4);
        if(plan) {
          for(const offset of plan.offsets)b.box({...center,y:0},.65,q.y-1.25,.8,'green',(q.y-1.25)/2,offset,true);
          b.box(center,plan.halfWidth*2,.55,.8,'green',-.975,0,true);
        }
      }
      if(station&&!platformStairAt(station,s))for(const platform of l.platforms) {
        const offset=route.mapped?platform.offset+Math.sign(platform.offset)*(platform.width/2-.4):route.island?platform.offset:platform.side*7.8;
        b.box(q,.18,3.4,.18,'green',2.85,offset,true);
        b.box(q,.25,.06,4,'light',4.5,platform.offset);
        b.box(q,route.island?.45:.7,.14,3,'sleeper',1.65,route.island?offset:platform.side*8,true);
        b.box(q,.14,.6,3,'sleeper',1.9,route.mapped?offset+Math.sign(platform.offset)*.18:route.island?offset:platform.side*8.3,true);
      } else if(underground&&q.y<-5.7)b.box(q,.15,.08,2,'light',4.85,l.center);
    }
  }
  return b;
}

export function stairHeight(entrance,s) {
  const steps=Math.ceil(Math.abs(entrance.top-entrance.bottom)/0.17);
  const fraction=Math.min(steps,Math.max(1,Math.floor((s-entrance.start)/(entrance.end-entrance.start)*steps)+1))/steps;
  return entrance.top+(entrance.bottom-entrance.top)*fraction;
}
export function buildStation(station,route=routeById.get(station.routeId)??defaultRoute) {
  return finish(buildStationSteps(station,route));
}
export function* buildStationSteps(station,route=routeById.get(station.routeId)??defaultRoute) {
  const b=new Builder();
  yield* appendAccessGeometrySteps(b,station,railPassageVolumes);
  for (const e of route.entrances.filter(e=>e.station===station)) {
    const width=e.island?2.4:2.8;
    const steps=Math.ceil(Math.abs(e.top-e.bottom)/0.17),length=(e.end-e.start)/steps;
    for (let i=0;i<steps;i++) {
      yield;
      const s=e.start+(i+0.5)*length, q=sample(route,s,e.offset),y=stairHeight(e,s);
      b.box({...q,y},width,0.3,length+0.01,'concrete',-0.15,0,true);
      b.box({...q,y},width-.1,0.025,0.06,'yellow',0.016,0);
    }
    const a={...sample(route,e.start,e.offset),y:e.top},c={...sample(route,e.end,e.offset),y:e.bottom};
    for (const side of [-1,1]) {
      b.span(a,c,0.14,1.15,'green',0.55,side*(width/2+.1),true);
      // Retaining walls make the underground stairwell a real enclosed volume.
      if (station.y<0) b.span({...a,y:(e.top+e.bottom)/2},{...c,y:e.bottom},0.25,Math.abs(e.top-e.bottom)+0.5,'tile',0,side*1.7,true);
    }
    for (const [s,y] of [[e.start-1.5,e.top],[e.end+1.5,e.bottom]]) b.box({...sample(route,s,e.offset),y},3,0.3,3,'concrete',-0.15,0,true);
    // Connect the station-level landing across to the outer platform.
    const s=e.landing, q=sample(route,s,e.island?e.offset:e.side*11.8);
    b.box(q,e.island?2.8:8.5,0.3,3,'concrete',1,0,true);
    if (station.y<0&&!e.island) {
      b.box(q,8.5,0.25,3.5,'tile',4.5,0,true);
      for (const end of [-1,1]) b.box(sample(route,s+end*1.65,e.side*11.8),8.5,3.3,0.2,'tile',2.7,0,true);
    }
    const street=sample(route,e.street,e.offset);
    for (const side of [-1,1]) b.box({...street,y:0},0.14,2.8,0.14,'green',1.4,side*1.5,true);
    b.box({...street,y:0},3.2,0.5,0.16,'dark',2.55);
  }
  return b;
}

export function stationSign(station,materialSet,route=routeById.get(station.routeId)??defaultRoute) {
  const b=new Builder(),signMaterials={},wallMaterials=new Set(),cache=new Map();
  const info=platformSignInfo(station,route),destinations=stationDestinations(station.key);
  const levels=[...new Set(destinations.map(d=>Math.round(d.hub.wait.y/2)*2))].sort((a,b)=>b-a);
  const stationFor=key=>{const split=key.lastIndexOf(':'),r=routeById.get(key.slice(0,split));return {route:r,station:r?.stations.find(s=>s.key===key)};};
  const destinationInfo=key=>{const target=stationFor(key);return target.station?platformSignInfo(target.station,target.route):null;};
  const entranceInfo=combineSignInfo(info,destinations.map(d=>destinationInfo(d.stationKey)).filter(Boolean));
  function sign(data,heading=data.name,wall=false) {
    const key=JSON.stringify([data,heading,wall]);if(cache.has(key))return cache.get(key);
    const canvas=paintSign(document.createElement('canvas'),data,{heading});
    const texture=new CanvasTexture(canvas);texture.colorSpace='srgb';
    const material=new MeshBasicMaterial({map:texture,toneMapped:false}),kind=`sign${cache.size}`;
    signMaterials[kind]=material;cache.set(key,kind);if(wall)wallMaterials.add(material);return kind;
  }
  function face(p,q){const d=Math.hypot(q.x-p.x,q.z-p.z)||1;return {...p,dx:(q.x-p.x)/d,dz:(q.z-p.z)/d};}
  const exitCanvas=document.createElement('canvas');exitCanvas.width=256;exitCanvas.height=64;
  const ec=exitCanvas.getContext('2d');ec.fillStyle='#14633b';ec.fillRect(0,0,256,64);
  ec.fillStyle='#fff';ec.font='bold 38px sans-serif';ec.textAlign='center';ec.fillText('EXIT ↑',128,46);
  const exitTexture=new CanvasTexture(exitCanvas);exitTexture.colorSpace='srgb';
  signMaterials.exit=new MeshBasicMaterial({map:exitTexture,toneMapped:false});
  const platforms=layout(route,station).platforms,hub=hubs.get(station.key);
  for(const [index,platform] of platforms.entries()) {
    const data=platformSignInfo(station,route,index),kind=sign(data,data.name,true);
    const offset=route.mapped?platform.offset+Math.sign(platform.offset)*(platform.width/2-.1):route.island?platform.offset:platform.side*9.15;
    // Repeat along the platform so the destination is readable near each entry.
    for(const ds of [-.3,0,.3]){const s=boardPosition(station.s+ds*(station.length??route.platformLength??PLATFORM_LENGTH));if(platformStairAt(station,s))continue;b.box(sample(route,s,offset),.06,data.groups.length>1?1.1:.78,5,kind,route.island&&!route.mapped?3.8:3);}
  }
  if(hub&&!hub.direct)for(const [index,branch] of [hub,...(hub.branches??[])].entries()) {
    const platformIndex=platforms.reduce((best,p,i)=>Math.abs(p.offset-branch.offset)<Math.abs(platforms[best].offset-branch.offset)?i:best,0);
    const data=platformSignInfo(station,route,platformIndex);
    b.box(branch.path[0],2.8,.64,.08,sign(data,'Platforms ↓'),2.4);
    b.box({...sample(route,branch.end+1.5,branch.offset),y:station.y+1.15},2.1,.55,.08,'exit',2.6);
  }
  for(const entry of accessesByStation.get(station.key)??[]) {
    const top=entry.path[0],next=entry.path[1];
    b.box(face(top,next),3.2,Math.min(1.25,.35+entranceInfo.groups.length*.22),.08,sign(entranceInfo),3.15);
    if(hub?.direct){
      const p=entry.path.at(-1),q=entry.path.at(-2);
      b.box(face(p,q),1.8,.42,.08,'exit',2.4);
      // Face arrivals from the stairs; name + line + direction at the landing.
      const landing={...p,x:p.x+(p.x-q.x)/Math.max(1,Math.hypot(p.x-q.x,p.z-q.z)),z:p.z+(p.z-q.z)/Math.max(1,Math.hypot(p.x-q.x,p.z-q.z))};
      b.box(face(landing,p),2.6,.64,.08,sign(info),2.4);
    }
  }
  for(const e of route.entrances.filter(e=>e.station===station))b.box({...sample(route,e.street,e.offset),y:0},3.2,.64,.08,sign(entranceInfo),3.1);
  for(const transfer of transfers.filter(t=>t.from===station.key||t.to===station.key)) {
    const forward=transfer.from===station.key,otherKey=forward?transfer.to:transfer.from,other=hubs.get(otherKey),data=destinationInfo(otherKey);
    if(!other||!data)continue;
    const path=transfer.geometryPath??transfer.path,p=forward?path[0]:path.at(-1),q=forward?path[1]:path.at(-2);
    const difference=other.wait.y-(station.y+1.15),level=levels.indexOf(Math.round(other.wait.y/2)*2)+1;
    const heading=Math.abs(difference)>3?`${difference<0?'Down':'Up'} to level ${level} ${difference<0?'↓':'↑'}`:'Transfer →';
    b.box(face(p,q),2.8,data.groups.length>1?.85:.64,.08,sign(data,heading),2.4);
  }
  const group=b.build({...materialSet,...signMaterials});
  for(const mesh of group.children) {
    const uv=new Float32Array(mesh.geometry.getAttribute('position').count*2);
    for(let i=0;i<uv.length;i+=16)uv.set([0,0,1,0,1,1,0,1,1,0,0,0,0,1,1,1],i);
    if(wallMaterials.has(mesh.material))for(let i=0;i<uv.length;i+=2)uv[i]=1-uv[i];
    mesh.geometry.setAttribute('uv',new BufferAttribute(uv,2));
  }
  return {group,dispose(){for(const material of Object.values(signMaterials)){material.map.dispose();material.dispose();}}};
}

export function trainModel(materialSet,kind='subway',instanced=false) {
  const body=new Builder(),doors=Array.from({length:4},()=>new Builder());
  const origin={x:0,y:0,z:0,dx:0,dz:1};
  body.box(origin,2.85,0.28,CAR_LENGTH,'body',1.15);
  body.box(origin,2.85,0.25,CAR_LENGTH,'body',3.85);
  body.box(origin,2.8,0.6,CAR_LENGTH-1,'dark',0.72);
  for (const end of [-1,1]) {
    body.box({...origin,z:end*(CAR_LENGTH/2-0.1)},2.8,2.6,0.2,'body',2.5);
    body.box({...origin,z:end*(CAR_LENGTH/2+0.015)},1.95,0.9,0.04,'window',2.9);
    for (const side of [-1,1]) body.box({...origin,z:end*6},0.25,0.65,2.8,'dark',0.55,side*1.2);
    for (const side of [-1,1]) body.box({...origin,z:end*(CAR_LENGTH/2+0.045)},0.18,0.12,0.03,'light',1.7,side*1.05);
  }
  for (const side of [-1,1]) {
    if(kind==='commuter')body.box(origin,.11,.2,CAR_LENGTH,'blue',3.4,side*1.43);
    for(const [start,end] of [[-9,-6.42],[-4.98,4.98],[6.42,9]])
      body.box({...origin,z:(start+end)/2},0.09,0.8,end-start,'body',1.7,side*1.42);
    body.box(origin,0.09,0.35,CAR_LENGTH,'body',3.52,side*1.42);
    for (const z of [-7.4,-3.8,0,3.8,7.4]) {
      body.box({...origin,z},0.06,1.05,2.15,'window',2.76,side*1.43);
    }
    for (const z of [-5.7,5.7]) for (const half of [-1,1]) {
      const b=doors[(side===1?2:0)+(half===1?1:0)];
      b.box({...origin,z:z+half*0.36},0.08,2,0.7,'body',2.35,side*1.47);
      b.box({...origin,z:z+half*0.36},0.1,0.72,0.48,'window',2.8,side*1.48);
    }
  }
  const shared=[body.build(materialSet),...doors.map(b=>b.build(materialSet))];
  return {
    create() {
      const root=new Group(),cars=[],batches=[];
      root.name=`rail-train-${kind}`;
      if(instanced)for(let part=0;part<shared.length;part++)for(const source of shared[part].children) {
        const mesh=new InstancedMesh(source.geometry,source.material,TRAIN_CARS);
        root.add(mesh);batches.push({mesh,part});
      }
      for(let i=0;i<TRAIN_CARS;i++) {
        const car=new Group(),panels=shared.slice(1).map(g=>instanced?new Group():g.clone());
        if(instanced)car.add(...panels);
        else car.add(shared[0].clone(),...panels);
        root.add(car);cars.push({car,panels});
      }
      return {root,cars,batches,dispose(){for(const {mesh} of batches)mesh.dispose();root.removeFromParent();}};
    },
    place(train,state,direction,dt,route=defaultRoute,trackOffset=direction*2,doorSide=direction) {
      train.open=(train.open??0)+(Number(state.doors)-(train.open??0))*Math.min(1,dt*4);
      train.cars.forEach(({car,panels},i)=>{
        const s=state.s-direction*(i-(TRAIN_CARS-1)/2)*CAR_SPACING;
        const p=sampleTrack(route,s,trackOffset),a=sampleTrack(route,s-4,trackOffset),b=sampleTrack(route,s+4,trackOffset);
        car.position.set(p.x,p.y,p.z);car.rotation.set(0,Math.atan2(b.x-a.x,b.z-a.z),0);
        car.rotateX(-Math.atan2(b.y-a.y,Math.hypot(b.x-a.x,b.z-a.z)));
        // Side platforms are outside each track. Keep the track-side doors shut.
        panels.forEach((panel,j)=>panel.position.z=(j%2?1:-1)*train.open*0.66
          *Number((j<2?-1:1)===doorSide));
      });
      // Five cars share each body/door draw. Transform-only nodes retain the
      // original curvature, grades and independently sliding door panels.
      if(train.batches.length) {
        for(const {car,panels} of train.cars){car.updateMatrix();for(const panel of panels)panel.updateMatrix();}
        const matrix=new Matrix4();
        for(const {mesh,part} of train.batches) {
          train.cars.forEach(({car,panels},i)=>{
            matrix.copy(car.matrix);if(part)matrix.multiply(panels[part-1].matrix);
            mesh.setMatrixAt(i,matrix);
          });
          mesh.instanceMatrix.needsUpdate=true;
          mesh.computeBoundingSphere();
        }
      }
    },
    dispose(){shared.forEach(g=>g.traverse(o=>o.geometry?.dispose()));},
  };
}
