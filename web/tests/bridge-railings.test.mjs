import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';

const scope = { console, performance, self: { postMessage: r => { scope.response = r; } } };
const worker = readFileSync(new URL('tile.worker-Ai2ZdmRL.js', assets), 'utf8');
for (const match of worker.matchAll(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?$/gm)) {
  const module = await import(new URL(match[2], assets));
  for (const binding of match[1].split(',')) {
    const [name, alias = name] = binding.trim().split(/\s+as\s+/); scope[alias] = module[name];
  }
}
vm.createContext(scope);
vm.runInContext(worker.replace(/^import .*$/gm, ''), scope);

const road = (id, pts, extra = {}) => ({ id, pts, cls:'motorway', width:12, lanes:3, oneway:true, bridge:true, layer:1, tunnel:false, ...extra });
async function build(roads) {
  const tile = {key:'0_0',tx:0,tz:0,roads,buildings:[],roadbeds:[],sidewalks:[],medians:[],parks:[],water:[],parking:[],plazas:[],crossings:[],trees:[],props:[],groundElev:0};
  await scope.self.onmessage({data:{id:1,input:{tile,roads,quality:{level:'mobile',shadows:false}}}});
  assert(!scope.response.error,scope.response.error);
  const result=scope.response.built;
  const collision=[];
  for(let i=0;i<result.colliderIdx.length;i+=3) collision.push([0,1,2].map(j=>Array.from(result.colliderPos.slice(result.colliderIdx[i+j]*3,result.colliderIdx[i+j]*3+3))));
  const mesh=result.meshes[3],rendered=[];
  for(let i=0;i<mesh.index.length;i+=3) rendered.push([0,1,2].map(j=>Array.from(mesh.attributes.position.data.slice(mesh.index[i+j]*3,mesh.index[i+j]*3+3))));
  return {collision,rendered};
}
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function intersects(a, b, pts) {
  const d = sub(b, a), e = sub(pts[1], pts[0]), f = sub(pts[2], pts[0]);
  const p = cross(d, f), det = dot(e, p);
  if (Math.abs(det) < 1e-8) return false;
  const t = sub(a, pts[0]), u = dot(t, p) / det;
  if (u < 0 || u > 1) return false;
  const q = cross(t, e), v = dot(d, q) / det, s = dot(f, q) / det;
  return v >= 0 && u + v <= 1 && s > 1e-5 && s <= 1;
}

const main = road(1,[[-128,128],[384,128]]);
const path = road(2,[[128,-128],[128,384]],{cls:'footway',width:3,lanes:1,oneway:false});
// This failed against the original worker: the top rail was a physical wall
// across the same-level road, and posts/balusters were drawn inside its lanes.
for (const roads of [[main,path],[path,main]]) {
  const built = await build(roads);
  for (const [kind,triangles] of Object.entries(built)) {
    for(let z=124;z<=132;z+=.5) for(const y of [7.5,8.08]) {
      assert(!triangles.some(tri=>intersects([120,y,z],[136,y,z],tri)), `${kind}: pedestrian bridge railings must leave the carriageway open`);
    }
    assert(triangles.some(tri=>intersects([120,8.08,100],[136,8.08,100],tri)), `${kind}: exposed approach railings remain`);
  }
}
console.log('PASS rendered rails/posts and collision barriers clear the roadway in either arrival order, retaining exposed railings');

const separate = await build([main,{...path,layer:3}]);
for (const [kind,triangles] of Object.entries(separate)) {
  assert(triangles.some(tri=>intersects([120,19.08,125],[136,19.08,125],tri)), `${kind}: a footbridge above the roadway retains its railing`);
}
console.log('PASS grade-separated pedestrian bridge railings remain intact');
