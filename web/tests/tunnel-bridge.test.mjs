import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';

const tunnels = await import(new URL('tunnels.js', assets));
const { clearanceProfile, MAX_ROAD_GRADE, MAX_ROAD_HEIGHT, ROAD_PROFILE_REACH } = await import(new URL('ramps.js', assets));
const road = (id,pts,extra={}) => ({id,pts,cls:'motorway',lanes:2,width:8,oneway:true,layer:2,bridge:true,tunnel:false,...extra});
const length = r => r.pts.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-r.pts[i][0],p[1]-r.pts[i][1]),0);
const makeEnv = roads => ({tile:{roads},ctx:{world:{roadsNear:()=>roads}}});
const bore = road(1,[[20,128],[140,128]],{tunnel:true,bridge:false,layer:-1});
const approach = road(2,[[140,128],[240,128]],{bridge:false,layer:0});
const connector = road(3,[[240,128],[300,128]],{bridge:false,layer:0});
const bridge = road(4,[[300,128],[350,128]]);
const onward = road(5,[[350,128],[950,128]]);
const fixture = [bore,approach,connector,bridge,onward];
const base = () => ({hw:4,H:20,hAt:()=>20});
const env = makeEnv(fixture);
const planned = fixture.slice(1).map(r=>clearanceProfile(env,r,base));
for (let i=1;i<planned.length;i++) assert(Math.abs(planned[i-1].hAt(length(fixture[i]))-planned[i].hAt(0))<1e-6,
  `connecting way ${fixture[i].id} must meet ${fixture[i+1].id} without a height reset`);
assert.equal(planned[0].hAt(0),-tunnels.PORTAL_DEPTH);
assert.equal(planned.at(-1).hAt(length(onward)),20,'the approach eventually reaches the original bridge height');
const world={tiles:new Map([['fixture',{roads:fixture}]])};
assert(Math.abs(tunnels.tunnelSupport(world,330,128,3.5,13)-3.425)<1e-6,
  'positive connecting ramps keep support at their grade, even under another bridge');
const crossing=road(7,[[200,40],[200,220]]);
assert(clearanceProfile(makeEnv([...fixture,crossing]),crossing,base).hAt(88) >= 20,
  'a road crossing in plan without a shared endpoint does not inherit the tunnel descent');
assert(ROAD_PROFILE_REACH >= (MAX_ROAD_HEIGHT+tunnels.PORTAL_DEPTH)/tunnels.APPROACH_GRADE,
  'streamed worker jobs must include enough roads to see the entire tunnel-to-bridge transition');

// A way split must not change the grade or the endpoint shared with the bridge.
const unsplit = road(6,[[140,128],[350,128]],{bridge:false,layer:0});
const unbroken = clearanceProfile(makeEnv([bore,unsplit,onward]),unsplit,base);
for (let i=0,along=0;i<3;i++) {
  const size=length(fixture[i+1]);
  for(let s=0;s<=size;s++) assert(Math.abs(planned[i].hAt(s)-unbroken.hAt(along+s))<1e-6);
  along+=size;
}
console.log('PASS tunnel-to-bridge joins stay continuous through short untagged connecting ways');

let response;
const scope = {console,performance,self:{postMessage:value=>{response=value;}}};
let worker=readFileSync(new URL('tile.worker-Ai2ZdmRL.js',assets),'utf8');
for(const m of worker.matchAll(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?$/gm)) {
  const module=await import(new URL(m[2],assets));
  for(const binding of m[1].split(',')) {const [name,alias=name]=binding.trim().split(/\s+as\s+/);scope[alias]=module[name];}
}
vm.createContext(scope);
vm.runInContext(worker.replace(/^import .*$/gm,'').replace('return buildBridges;',
  'globalThis.nativeProfile=baseDeckProfile;return buildBridges;'),scope);

const tiles=[];
for(let tx=12;tx<=21;tx++)for(let tz=-45;tz<=-37;tz++) {
  try{tiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${tx}_${tz}.json.gz`,import.meta.url)))));}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
const roads=[...new Map(tiles.flatMap(t=>t.roads).map(r=>[r.id,r])).values()];
const realEnv=makeEnv(roads),profiles=tunnels.tunnelNetwork(roads),nodes=new Map();
let gradeSamples=0;
for(const r of roads.filter(r=>!r.tunnel&&['motorway','trunk'].includes(r.cls))) {
  const size=length(r),p=clearanceProfile(realEnv,r,scope.nativeProfile);
  for(const [xy,s]of[[r.pts[0],0],[r.pts.at(-1),size]]) {
    const key=xy.map(v=>Math.round(v*2)).join(','),members=nodes.get(key)??[];
    members.push({id:r.id,height:p.hAt(s),approach:profiles.has(r.id)});nodes.set(key,members);
  }
  if(!profiles.has(r.id))continue;
  for(let s=0;s<size;s++) {
    const end=Math.min(size,s+1);
    assert(Math.abs(p.hAt(end)-p.hAt(s)) <= MAX_ROAD_GRADE*(end-s)+1e-6,`excessive grade on ${r.id} at ${s}`);
    gradeSamples++;
  }
}
let joins=0;
for(const members of nodes.values()) {
  if(members.length<2||!members.some(r=>r.approach))continue;
  assert(Math.max(...members.map(r=>r.height))-Math.min(...members.map(r=>r.height))<1e-5,
    `disconnected real approach junction: ${JSON.stringify(members)}`);
  joins++;
}
assert(joins>20&&gradeSamples>2000);
console.log(`PASS ${joins} real approach junctions and ${gradeSamples} grade samples on both sides of the Trans-Manhattan tunnels`);

const {triangleHeight}=await import(new URL('supports.js',assets));
const {deckEdges}=await import(new URL('edges.js',assets));
const cells=new Map(),CELL=16;
const builtKeys=new Set(['13_-42','14_-42','16_-41','17_-41','17_-40']);
function index(positions,indices,kind) {
  for(let i=0;i<indices.length;i+=3) {
    const tri=[0,1,2].map(j=>Array.from(positions.slice(indices[i+j]*3,indices[i+j]*3+3)));
    const entry={tri,kind};
    for(let x=Math.floor(Math.min(...tri.map(p=>p[0]))/CELL);x<=Math.floor(Math.max(...tri.map(p=>p[0]))/CELL);x++)
      for(let z=Math.floor(Math.min(...tri.map(p=>p[2]))/CELL);z<=Math.floor(Math.max(...tri.map(p=>p[2]))/CELL);z++) {
        const key=`${x},${z}`,bucket=cells.get(key)??[];bucket.push(entry);cells.set(key,bucket);
      }
  }
}
// Build the actual reported joins on both sides of the tunnel. Include the
// neighbouring tile: geometry must remain connected across worker jobs too.
// Use the same road-only inputs as realEnv; pedestrian clearance is tested
// separately and would add height constraints absent from these reference profiles.
for(const key of builtKeys) {
  const original=tiles.find(t=>t.key===key);
  const tile={...original,buildings:[],roadbeds:[],sidewalks:[],medians:[],parks:[],water:[],parking:[],plazas:[],crossings:[],trees:[],props:[]};
  await scope.self.onmessage({data:{id:1,input:{tile,roads,pedestrianTiles:[],quality:{level:'mobile',shadows:false}}}});
  assert(!response.error,response.error);
  for(const mesh of response.built.meshes.filter(Boolean))index(mesh.attributes.position.data,mesh.index,'mesh');
  index(response.built.colliderPos,response.built.colliderIdx,'collider');
}
let pavementSamples=0;
const routes=[121772577000,42435675000,9852385000,1081036136000,121772574000,16586045000,8119436000,44763891000];
for(const id of routes) {
  const road=roads.find(r=>r.id===id),profile=clearanceProfile(realEnv,road,scope.nativeProfile),size=length(road);
  const edges=deckEdges(road,roads,Math.max(3.2,road.width/2));
  const stations=[0];
  for(let i=1;i<road.pts.length;i++)stations.push(stations.at(-1)+Math.hypot(road.pts[i][0]-road.pts[i-1][0],road.pts[i][1]-road.pts[i-1][1]));
  let count=0;
  for(let s=.5;s<size;s++) {
    let segment=1;while(segment<stations.length-1&&stations[segment]<s)segment++;
    const a=road.pts[segment-1],b=road.pts[segment],fraction=(s-stations[segment-1])/(stations[segment]-stations[segment-1]);
    const center=a.map((v,i)=>v+(b[i]-v)*fraction);
    // An offset lane can enter a tile before the owning centreline does. The
    // adjacent worker then supplies its paving; don't sample unbuilt tiles.
    if(!builtKeys.has(`${Math.floor(center[0]/256)}_${Math.floor(center[1]/256)}`))continue;
    for(let lane=0;lane<road.lanes;lane++) {
      const offset=(lane+.5-road.lanes/2)*Math.min(3.3,road.width/road.lanes),[x,z]=edges.line(s,offset);
      if(!builtKeys.has(`${Math.floor(x/256)}_${Math.floor(z/256)}`))continue;
      const nearby=cells.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)??[],y=profile.hAt(s)+.025;
      for(const kind of ['mesh','collider'])assert(nearby.some(entry=>{
        if(entry.kind!==kind)return false;
        const h=triangleHeight(entry.tri,x,z);return h?.inside&&Math.abs(h.height-y)<.2;
      }),`${kind} missing on ${id} lane ${lane} at ${s}m (height ${y})`);
      count++;pavementSamples++;
    }
  }
  assert(count>20,`route ${id} must be exercised`);
}
console.log(`PASS ${pavementSamples} real traffic-lane positions keep pavement and collision support through tunnel/bridge joins`);
