import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { prepareSceneTextures } from '../static/world/assets/texture-preflight.js';
import { assets } from './sveltekit-assets.mjs';

let visits = 0;
const texture = () => ({ isTexture: true });
const sharedMap = texture(), uniformMap = texture();
const materials = Array.from({ length: 20 }, () => ({
  get map() { visits++; return sharedMap; },
  uniforms: { maps: { value: [uniformMap, sharedMap] } },
  ...Object.fromEntries(Array.from({length:60},(_,i)=>[`property${i}`,i])),
}));
const objects = Array.from({length:2000},(_,i)=>({material:materials[i%materials.length]}));
objects.push({material:[materials[0],materials[1]]},{});
const scene = { traverse(fn) { objects.forEach(fn); } };
const oldScan = (scene, prepare) => {
  const seen = new Set();
  const visit = value => { if(value?.isTexture&&!seen.has(value)){seen.add(value);prepare(value);} };
  scene.traverse(object => {
    for(const m of Array.isArray(object.material)?object.material:object.material?[object.material]:[]) {
      Object.values(m).forEach(visit);
      if(m.uniforms)for(const u of Object.values(m.uniforms))Array.isArray(u.value)?u.value.forEach(visit):visit(u.value);
    }
  });
};
const before=[],after=[];
oldScan(scene,t=>before.push(t));const previousVisits=visits;visits=0;
prepareSceneTextures(scene,t=>after.push(t));
assert.deepEqual(after,before,'same textures receive the upload cap');
assert.equal(previousVisits,2002);assert.equal(visits,20,'one property scan per shared material');
// Must inspect again next render: async image loads and mutable shader uniforms
// need capping even when no material version is bumped.
const lateMap=texture();materials[0].uniforms.maps.value=[lateMap];
const next=[];prepareSceneTextures(scene,t=>next.push(t));assert(next.includes(lateMap));
const source=readFileSync(new URL('textureRelease-2U-gT89r.js',assets),'utf8');
assert(source.includes('$prepareSceneTextures(e,rl),n(e,t)'),'served renderer uses deduplicated preparation');
for(const scan of [oldScan,prepareSceneTextures])for(let i=0;i<10;i++)scan(scene,()=>{});
const measure=scan=>{const start=performance.now();for(let i=0;i<100;i++)scan(scene,()=>{});return (performance.now()-start)/100;};
console.log(`PASS mobile texture preflight: ${previousVisits} -> 20 material scans; fixture CPU ${measure(oldScan).toFixed(2)} -> ${measure(prepareSceneTextures).toFixed(2)} ms/frame (host, not device FPS)`);
