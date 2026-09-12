import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';

const { highwayLayout, isHighway } = await import(new URL('lane-layout.js', assets));
const { deckEdges } = await import(new URL('edges.js', assets));
const tiles = [];
for (let tx = 12; tx <= 20; tx++) for (let tz = -47; tz <= -38; tz++) {
  try { tiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${tx}_${tz}.json.gz`, import.meta.url))))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const roads = [...new Map(tiles.flatMap(t => t.roads).map(r => [r.id,r])).values()];
let stations = 0;
const checked = new Set();
for (const road of roads.filter(isHighway)) {
  const layout = highwayLayout(road, roads);
  if (!layout) continue;
  const edges = deckEdges(road, roads, Math.max(3.2,road.width/2));
  for (let s = 0; s < layout.length; s += 1) {
    const left = layout.edge(s,0), right = layout.edge(s,1);
    assert(right-left >= layout.width/2-.01, `${road.id} collapses at ${s}m: edges ${left}, ${right}`);
    for (let q = .5; q < layout.count; q++) {
      const lane = layout.offset(s,q);
      assert(lane >= left-.01 && lane <= right+.01, `${road.id} lane ${q-.5} leaves its pavement at ${s}m`);
    }
    stations++; checked.add(road.id);
  }
  // The renderer and traffic both interpolate their four-metre samples. Check
  // those actual vertices, including bends and the end of every OSM segment.
  let along = 0;
  for (let i = 1; i < road.pts.length; i++) {
    const u = road.pts[i-1], v = road.pts[i], length = Math.hypot(v[0]-u[0],v[1]-u[1]);
    const count = Math.max(1,Math.ceil(length/4));
    for (let j = 0; j <= count; j++) {
      const s = along+length*j/count, [a,b] = edges(s), dx = b[0]-a[0], dz = b[1]-a[1];
      for (let q = .5; q < layout.count; q++) {
        const p = edges.line(s,(q-layout.count/2)*layout.width);
        const t = ((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz);
        assert(t >= -.01 && t <= 1.01, `${road.id} lane ${q-.5} leaves the rendered deck at ${s}m`);
      }
    }
    along += length;
  }
}
for (const id of [46588502000,46587576000,5669163000,46587572000,8119592000]) assert(checked.has(id));
console.log(`PASS ${stations} motorway width and lane-containment samples across ${checked.size} Washington Heights roads`);

// Execute the served worker, including its SvelteKit overrides, and check the
// actual asphalt and physics mesh of the pinched single-lane Riverside ramp.
let response;
const scope = { console, performance, self: { postMessage: value => { response = value; } } };
let worker = readFileSync(new URL('tile.worker-Ai2ZdmRL.js',assets),'utf8');
for (const match of worker.matchAll(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?$/gm)) {
  const module = await import(new URL(match[2],assets));
  for (const binding of match[1].split(',')) {
    const [name, alias = name] = binding.trim().split(/\s+as\s+/);
    scope[alias] = module[name];
  }
}
vm.createContext(scope);
vm.runInContext(worker.replace(/^import .*$/gm,''),scope);
const tile = { key:'13_-41',tx:13,tz:-41,roads,buildings:[],roadbeds:[],sidewalks:[],medians:[],parks:[],water:[],parking:[],plazas:[],crossings:[],trees:[],props:[],groundElev:0 };
await scope.self.onmessage({data:{id:1,input:{tile,roads,pedestrianTiles:[tile],quality:{level:'mobile',shadows:false}}}});
assert(!response.error,response.error);
const { roadDeckTriangles, triangleHeight } = await import(new URL('supports.js',assets));
const { highwayLanePath, lanePoint } = await import(new URL('lane-paths.js',assets));
const built = response.built, road = roads.find(r=>r.id===46588502000);
const surfaces = roadDeckTriangles(built.decks,road.id);
assert(surfaces.length,'the ramp is present in the worker output');
const triangles = (positions,indices) => Array.from({length:indices.length/3},(_,i)=>[0,1,2].map(j=>Array.from(positions.slice(indices[i*3+j]*3,indices[i*3+j]*3+3))));
const colliders = triangles(built.colliderPos,built.colliderIdx);
const asphalt = triangles(built.meshes[0].attributes.position.data,built.meshes[0].index);
let supported = 0;
for (let segment=0;segment+1<road.pts.length;segment++) {
  const path = highwayLanePath(road,roads,segment,0);
  for (let s=.5;s<path.length;s+=2) {
    const p=lanePoint(path,s),floor=surfaces.map(t=>triangleHeight(t,p.x,p.z)).find(h=>h?.inside);
    assert(floor,`ramp traffic leaves its deck at ${p.x},${p.z}`);
    for (const [kind,faces] of [['asphalt',asphalt],['collider',colliders]])
      assert(faces.some(t=>{const h=triangleHeight(t,p.x,p.z);return h?.inside&&Math.abs(h.height-floor.height)<.08;}),`missing ramp ${kind} at ${p.x},${p.z}`);
    supported++;
  }
}
assert(supported>80);
console.log(`PASS ${supported} Riverside ramp traffic positions retain rendered asphalt and collision support`);
