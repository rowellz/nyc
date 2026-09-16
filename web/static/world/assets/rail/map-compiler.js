/** Pure map-to-rail compiler. Used offline, before tile partitioning, so grades
 * and junctions never depend on which tile happens to arrive first. */
export const railProjection=(lon,lat)=>[(lon+73.98322)*111320*Math.cos(40.75362*Math.PI/180),-(lat-40.75362)*110574];
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const yes=v=>v&&v!=='no';
export function railStructure(tags) {
  const layer=Number.parseFloat(tags.layer??tags.level)||0;
  const structure=yes(tags.tunnel)?'tunnel':yes(tags.bridge)?'bridge':yes(tags.cutting)?'cutting':'surface';
  return {structure,layer,target:structure==='tunnel'?-12-Math.max(0,-layer-1)*7:structure==='bridge'?Math.max(8,layer*6):structure==='cutting'?-6:.35};
}
// Multi-source shortest paths compute the greatest profile below the nominal
// heights satisfying |dy| <= grade * distance on EVERY connected graph edge.
// Shared OSM nodes join; geometric crossings with distinct IDs do not.
export function solveRailGrades(nodes,edges,grade=.055) {
  const adjacent=nodes.map(()=>[]),heap=[];
  function push(item){let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(heap[p][0]<=item[0])break;heap[i]=heap[p];i=p;}heap[i]=item;}
  function pop(){const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1][0]<heap[c][0])c++;if(heap[c][0]>=last[0])break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;}
  for(const e of edges){const cost=(e.flat?0:distance(nodes[e.a],nodes[e.b])*grade);adjacent[e.a].push([e.b,cost]);adjacent[e.b].push([e.a,cost]);}
  const heights=nodes.map((n,i)=>{push([n.target,i]);return n.target;});
  while(heap.length){const [h,i]=pop();if(h!==heights[i])continue;for(const [j,cost] of adjacent[i])if(h+cost<heights[j]-1e-9){heights[j]=h+cost;push([heights[j],j]);}}
  return heights;
}
export function nearestRailPoint(points,x,z) {
  let best={distance:Infinity};
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,d=dx*dx+dz*dz;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(d||1))),px=a.x+dx*t,pz=a.z+dz*t;
    const error=Math.hypot(x-px,z-pz);
    if(error<best.distance)best={distance:error,s:a.s+(b.s-a.s)*t,x:px,z:pz,y:a.y+(b.y-a.y)*t,offset:((z-a.z)*dx-(x-a.x)*dz)/Math.sqrt(d||1),i};
  }
  return best;
}
export function compileRailMap(elements,{bounds,overrides=[]}={}) {
  elements=[...elements].sort((a,b)=>a.type.localeCompare(b.type)||a.id-b.id);
  const nodes=[],nodeIds=new Map(),edges=[],edgeIds=new Set(),features=new Map();
  const inside=p=>!bounds||(p.x>=bounds[0]&&p.z>=bounds[1]&&p.x<=bounds[2]&&p.z<=bounds[3]);
  const buckets=new Map(),bucket=(x,z)=>`${Math.floor(x/256)}_${Math.floor(z/256)}`;
  // Explicit replacement corridors are indexed by segments. The map remains
  // the default everywhere else; no list of supported subway lines is needed.
  for(const r of overrides)for(let i=1;i<r.points.length;i++) {
    const a=r.points[i-1],b=r.points[i],key=bucket(a.x,a.z);
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({a,b,r});
  }
  function override(p,tags) {
    let best=null;
    for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const entry of buckets.get(bucket(p.x+dx*256,p.z+dz*256))??[]) {
      const {r,a,b}=entry;
      if(r.kind==='commuter'?tags.railway!=='rail':tags.railway!=='subway'||!tags.name?.includes('IRT Broadway'))continue;
      const q=nearestRailPoint([a,b],p.x,p.z),width=r.kind==='commuter'?24:28;
      if(q.distance<width&&(!best||q.distance<best.distance))best={...q,r};
    }
    return best;
  }
  const addNode=(id,p,target)=>{let i=nodeIds.get(id);if(i===undefined){i=nodes.length;nodeIds.set(id,i);nodes.push({...p,id,target});}else nodes[i].target=Math.min(nodes[i].target,target);return i;};
  const ways=elements.filter(e=>e.type==='way'&&['rail','subway','light_rail','tram'].includes(e.tags?.railway)).sort((a,b)=>a.id-b.id);
  let replaced=0;
  for(const way of ways) {
    if(way.geometry?.length!==way.nodes?.length)throw Error(`Incomplete railway way ${way.id}`);
    const tags=way.tags,{structure,layer,target}=railStructure(tags),feature={id:way.id,tags,structure,layer};features.set(way.id,feature);
    for(let i=1;i<way.nodes.length;i++) {
      const rawA=way.geometry[i-1],rawB=way.geometry[i],pa=railProjection(rawA.lon,rawA.lat),pb=railProjection(rawB.lon,rawB.lat);
      const a={x:pa[0],z:pa[1]},b={x:pb[0],z:pb[1]},d=distance(a,b);
      if(d<.01||(!inside(a)&&!inside(b)))continue;
      const count=Math.ceil(d/8);
      for(let j=0;j<count;j++) {
        const p={x:a.x+(b.x-a.x)*j/count,z:a.z+(b.z-a.z)*j/count};
        const q={x:a.x+(b.x-a.x)*(j+1)/count,z:a.z+(b.z-a.z)*(j+1)/count};
        if(override({x:(p.x+q.x)/2,z:(p.z+q.z)/2},tags)){replaced++;continue;}
        const ids=[j===0?`n${way.nodes[i-1]}`:`w${way.id}:${i}:${j}`,j===count-1?`n${way.nodes[i]}`:`w${way.id}:${i}:${j+1}`];
        const key=[...ids].sort().join('/');if(edgeIds.has(key))continue;edgeIds.add(key);
        const op=override(p,tags),oq=override(q,tags);
        edges.push({a:addNode(ids[0],p,op?.y??target),b:addNode(ids[1],q,oq?.y??target),way:way.id,structure,layer});
      }
    }
  }
  const adjacency=nodes.map(()=>[]);edges.forEach((e,i)=>{adjacency[e.a].push(i);adjacency[e.b].push(i);});
  // Continue mutually straight tracks through switches; every physical edge
  // still belongs to exactly one chain. Branches keep their own stable IDs.
  const pairs=new Map();
  for(let n=0;n<nodes.length;n++) {
    const incident=adjacency[n],candidates=[];
    for(let i=0;i<incident.length;i++)for(let j=i+1;j<incident.length;j++) {
      const ea=edges[incident[i]],eb=edges[incident[j]],ta=features.get(ea.way).tags,tb=features.get(eb.way).tags;
      if(ta.railway!==tb.railway)continue;
      const a=nodes[ea.a===n?ea.b:ea.a],b=nodes[eb.a===n?eb.b:eb.a],p=nodes[n];
      const cos=((a.x-p.x)*(b.x-p.x)+(a.z-p.z)*(b.z-p.z))/(distance(a,p)*distance(b,p));
      if(cos<-.85)candidates.push({a:incident[i],b:incident[j],cos});
    }
    const used=new Set();for(const p of candidates.sort((a,b)=>a.cos-b.cos||a.a-b.a))if(!used.has(p.a)&&!used.has(p.b)){
      pairs.set(`${n}:${p.a}`,p.b);pairs.set(`${n}:${p.b}`,p.a);used.add(p.a);used.add(p.b);
    }
  }
  const visited=new Set(),chains=[];
  function walk(first,start) {
    const chain={nodes:[start],edges:[]};let edge=first,n=start;
    while(!visited.has(edge)){visited.add(edge);chain.edges.push(edge);const e=edges[edge];n=e.a===n?e.b:e.a;chain.nodes.push(n);const next=pairs.get(`${n}:${edge}`);if(next===undefined)break;edge=next;}
    chains.push(chain);
  }
  for(let i=0;i<edges.length;i++)for(const n of [edges[i].a,edges[i].b])if(!visited.has(i)&&!pairs.has(`${n}:${i}`))walk(i,n);
  for(let i=0;i<edges.length;i++)if(!visited.has(i))walk(i,edges[i].a);
  const routes=chains.map(chain=>{
    let s=0;const points=chain.nodes.map((n,i)=>{if(i)s+=distance(nodes[n],nodes[chain.nodes[i-1]]);return {...nodes[n],s,y:nodes[n].target,node:n};});
    const wayIds=[...new Set(chain.edges.map(i=>edges[i].way))],f=features.get(wayIds[0]);
    return {id:`osm-${wayIds[0]}-${nodes[chain.nodes[0]].id}`,points,length:s,wayIds,kind:f.tags.railway==='subway'?'subway':'commuter',name:f.tags.name??'Railway',stations:[],chain};
  });
  // OSM platforms remain source features. Named stations without a mapped
  // platform receive the same procedural platform fallback, rather than vanish.
  const stations=elements.filter(e=>e.tags?.railway==='station'&&e.tags.name&&e.type==='node').map(e=>{
    const [x,z]=railProjection(e.lon,e.lat);return {id:`${e.type}/${e.id}`,name:e.tags.name,tags:e.tags,x,z};
  }).filter(inside);
  const platformFeatures=elements.filter(e=>e.type==='way'&&e.tags?.railway==='platform'&&e.geometry?.length>=2).map(e=>{
    const pts=e.geometry.map(p=>railProjection(p.lon,p.lat));const x=pts.reduce((s,p)=>s+p[0],0)/pts.length,z=pts.reduce((s,p)=>s+p[1],0)/pts.length;
    const nearest=stations.map(s=>({station:s,d:distance(s,{x,z})})).sort((a,b)=>a.d-b.d)[0];
    return {id:`way/${e.id}`,name:e.tags.name??(nearest?.d<350?nearest.station.name:'Rail platform'),tags:e.tags,x,z,polygon:pts,stationId:nearest?.d<350?nearest.station.id:`way/${e.id}`};
  }).filter(inside);
  const covered=new Set(platformFeatures.map(p=>p.stationId));
  const candidates=[...platformFeatures,...stations.filter(s=>!covered.has(s.id)).map(s=>({...s,stationId:s.id}))];
  for(const station of candidates) {
    let best;
    for(const r of routes) {
      if(r.length<170)continue;
      const q=nearestRailPoint(r.points,station.x,station.z);
      if(q.distance>35||q.s<75||q.s>r.length-75)continue;
      const tagLevel=Number.parseFloat(station.tags.layer??station.tags.level),edge=edges[r.chain.edges[Math.min(q.i-1,r.chain.edges.length-1)]];
      if(Number.isFinite(tagLevel)&&Math.abs(tagLevel-edge.layer)>1)continue;
      const score=q.distance+(Number.isFinite(tagLevel)?Math.abs(tagLevel-edge.layer)*100:0);
      if(!best||score<best.score)best={r,q,score};
    }
    if(!best)continue;
    const {r,q}=best,half=Math.min(100,q.s-35,r.length-q.s-10),p=r.points[q.i],a=r.points[q.i-1],d=distance(p,a),dx=(p.x-a.x)/d,dz=(p.z-a.z)/d;
    const offset=Math.sign(q.offset||1)*Math.max(3.1,Math.min(6,Math.abs(q.offset)));
    const source={id:station.id,stationId:station.stationId,name:station.name,polygon:station.polygon,tags:station.tags};
    const duplicate=r.stations.find(s=>Math.abs(s.s-q.s)<140&&Math.sign(s.offset)===Math.sign(offset));if(duplicate)continue;
    r.stations.push({id:station.id,name:station.name,s:q.s,x:q.x,z:q.z,y:q.y,offset,length:half*2,source});
    // Hold the entire platform flat before solving grades. This extends ramps
    // into adjacent ways instead of tilting platforms or adding endpoint steps.
    for(let i=0;i<r.chain.edges.length;i++)if(r.points[i].s<=q.s+half+4&&r.points[i+1].s>=q.s-half-4)edges[r.chain.edges[i]].flat=true;
  }
  const heights=solveRailGrades(nodes,edges);
  for(const r of routes) {
    r.points.forEach((p,i)=>{p.y=heights[p.node];p.structure=edges[r.chain.edges[Math.min(i,r.chain.edges.length-1)]].structure;delete p.target;delete p.node;delete p.id;});
    r.stations.sort((a,b)=>a.s-b.s).forEach(s=>{s.y=nearestRailPoint(r.points,s.x,s.z).y;});
    delete r.chain;
  }
  return {version:1,routes,features:[...features.values()].map(f=>({id:f.id,tags:f.tags})),stations,platforms:platformFeatures,
    entrances:elements.filter(e=>e.type==='node'&&e.tags?.railway==='subway_entrance').map(e=>{const [x,z]=railProjection(e.lon,e.lat);return{id:e.id,x,z,tags:e.tags};}).filter(inside),
    stats:{ways:ways.length,edges:edges.length,replaced,chains:routes.length,platforms:routes.reduce((n,r)=>n+r.stations.length,0)}};
}
