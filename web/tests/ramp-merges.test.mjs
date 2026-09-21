import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';

const { clearanceProfile, MAX_ROAD_GRADE } = await import(new URL('ramps.js', assets));
const { triangleHeight, roadDeckTriangles } = await import(new URL('supports.js', assets));
const { resolveRoadCollision } = await import(new URL('road-collision.js', assets));
const worker = readFileSync(new URL('tile.worker-Ai2ZdmRL.js', assets), 'utf8');
const scope = { console, performance, self: { postMessage: r => { scope.result = r; } } };
for (const match of worker.matchAll(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?$/gm)) {
  const module = await import(new URL(match[2], assets));
  for (const binding of match[1].split(',')) {
    const [name, alias = name] = binding.trim().split(/\s+as\s+/); scope[alias] = module[name];
  }
}
vm.createContext(scope);
vm.runInContext(worker.replace(/^import .*$/gm, '').replace('return buildBridges;',
  'globalThis.nativeProfile=baseDeckProfile;return buildBridges;'), scope);
const makeEnv = roads => ({ tile: { roads }, ctx: { world: { roadsNear: () => roads } } });
const road = (id, pts) => ({ id, pts, cls: 'primary', width: 12, lanes: 3, oneway: true, bridge: true, layer: 1, tunnel: false });
const forks = [road(1, [[0,0],[140,0]]), road(2, [[0,0],[130,40]])];
const base = (_env,r) => ({hw:6,H:7,hAt:s=>r.id===1?7:Math.max(0,7-s*.08)});
for (const roads of [forks, [...forks].reverse()]) {
  const env=makeEnv(roads), profiles=forks.map(r=>clearanceProfile(env,r,base));
  // The old nearest-station links agreed at isolated samples, but the two
  // slopes still intersected across the width of this shallow, multilane fan.
  for(let s=0;s<30;s+=.25) for(const profile of profiles)
    assert(Math.abs(profile.hAt(s)-7)<1e-6,'the entire merge landing is level');
  for(let s=1;s<130;s++) for(const profile of profiles)
    assert(Math.abs(profile.hAt(s)-profile.hAt(s-1))<=MAX_ROAD_GRADE+1e-6);
  assert(profiles[1].hAt(130)<1,'the approach still descends away from the landing');
}
console.log('PASS shallow multilane street ramps share a level landing and gradual approaches in either input order');

const collider={cpos:[],cidx:[]};
function quad(x0,x1,y) {
  const n=collider.cpos.length/3;
  collider.cpos.push(x0,y,0,x1,y,0,x1,y,10,x0,y,10);
  collider.cidx.push(n,n+2,n+1,n,n+3,n+2);
}
quad(0,10,7);quad(0,10,7);quad(5,15,7);quad(0,15,0);
// Preserve a vertical obstacle too.
let n=collider.cpos.length/3;
collider.cpos.push(0,7,0,0,9,0,0,7,10);collider.cidx.push(n,n+1,n+2);
resolveRoadCollision(collider);
const faces=out=>Array.from({length:out.cidx.length/3},(_,i)=>out.cidx.slice(i*3,i*3+3).map(v=>out.cpos.slice(v*3,v*3+3)));
const cleaned=faces(collider);
for(let x=.37;x<15;x+=.5)for(let z=.23;z<10;z+=.5) {
  const heights=cleaned.map(t=>triangleHeight(t,x,z)).filter(h=>h?.inside).map(h=>h.height).sort((a,b)=>a-b);
  assert.deepEqual([...new Set(heights)],[0,7],'continuous collision support at each level, without gaps');
}
assert(cleaned.some(t=>t.every(p=>p[0]===0)&&t.some(p=>p[1]===9)),'retain vertical collision');
assert.equal(new Set(Array.from({length:collider.cpos.length/3},(_,i)=>collider.cpos.slice(i*3,i*3+3).join(','))).size,collider.cpos.length/3,'weld coincident vertices');
console.log('PASS collision cleanup retains stacked roads and walls, removes duplicate triangles, and welds seams');

const tiles=[];
for(let x=-1;x<=4;x++)for(let z=-3;z<=3;z++) {
  try { tiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`,import.meta.url))))); }
  catch(error){if(error.code!=='ENOENT')throw error;}
}
const roads=[...new Map(tiles.flatMap(t=>t.roads).map(r=>[r.id,r])).values()];
const tile=tiles.find(t=>t.key==='1_0');
await scope.self.onmessage({data:{id:1,input:{tile,roads,pedestrianTiles:tiles,quality:{level:'mobile',shadows:false}}}});
assert(!scope.result.error,scope.result.error);
const built=scope.result.built;
const ids=[988956475000,988956476000,1037772011000];
const decks=ids.map(id=>roadDeckTriangles(built.decks,id));
const physical=faces({cpos:Array.from(built.colliderPos),cidx:Array.from(built.colliderIdx)});
let overlaps=0, floors=0;
// Sweep the actual Park Avenue fork in a 24 m square, comparing the full
// ribbons instead of just their OSM centrelines. Rendering and physics agree.
for(let x=460.13;x<484;x+=.5)for(let z=145.17;z<169;z+=.5) {
  const heights=decks.map(ts=>ts.map(t=>triangleHeight(t,x,z)).find(h=>h?.inside)?.height).filter(h=>h!==undefined);
  if(!heights.length)continue;
  if(heights.length>1){assert(Math.max(...heights)-Math.min(...heights)<.002,`Park Avenue merge intersects at ${x},${z}`);overlaps++;}
  assert(physical.some(t=>{const h=triangleHeight(t,x,z);return h?.inside&&Math.abs(h.height-heights[0]-.02)<.003;}),`missing physical floor at ${x},${z}`);floors++;
}
assert(overlaps>10&&floors>100,'exercise the real merge footprint');
const streets=readFileSync(new URL('streets-CfYSUqyW.js',assets),'utf8');
assert(streets.includes('trimesh(t.position,t.index,r.RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES|r.RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES)'), 'served road physics suppresses internal triangle edges');
console.log(`PASS Park Avenue: ${overlaps} overlapping lane samples agree; ${floors} rendered floor samples have matching collision`);
