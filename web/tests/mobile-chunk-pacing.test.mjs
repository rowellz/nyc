import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { assets } from './sveltekit-assets.mjs';
import { CLIENT_REVISION, versionClientImports } from '../src/lib/server/client-cache.js';
assert(readFileSync(new URL('tunnels.js', assets),'utf8').includes(`loading-DS_gLujL.js?v=${CLIENT_REVISION}`),'water shares the main scene queue instead of creating a second frame budget');
const { cutGround, cutGroundSteps, syncTunnelTerrain } = await import(new URL('tunnels.js', assets));
const { g: Geometry, h: Attribute, kt: Mesh, Z: Group } = await import(new URL('textureRelease-2U-gT89r.js', assets));
const { waterHolesForTiles } = await import(new URL('rail/footprints.js?v=station-layout-32', assets));
const attrs = {
  position: new Attribute(new Float32Array([-26000,0,-26000,26000,0,-26000,26000,0,26000,-26000,0,26000]),3),
  uv: new Attribute(new Float32Array([0,0,1,0,1,1,0,1]),2),
};
const indices = Uint32Array.from([0,2,1,0,3,2]);
const tiles = [];
for (let x=-2;x<=0;x++) for (let z=-4;z<=-2;z++) {
  const data=JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`,import.meta.url))));
  tiles.push({...data,key:`${x}_${z}`,tx:x,tz:z});
}
const holes=waterHolesForTiles(tiles);
assert(holes.length>50,'fixture has many real Midtown rail cutouts');
const synchronous=cutGround(attrs,indices,holes);
const steps=cutGroundSteps(attrs,indices,holes);
let result, yields=0;
do { result=steps.next(); if(!result.done)yields++; } while(!result.done);
assert(yields>20,'even a two-triangle water plane yields repeatedly inside polygon subtraction');
assert.deepEqual(result.value,synchronous,'cooperative clipping preserves positions, UV interpolation and indices');

// Use the shipped shared build queue with a deterministic frame clock. The
// original implementation finished the entire water recut during syncTerrain.
const originalPerformance=globalThis.performance, originalRAF=globalThis.requestAnimationFrame;
let clock=0, callbacks=[];
globalThis.performance={now:()=>clock+=.5};
globalThis.requestAnimationFrame=fn=>{callbacks.push(fn);return 1;};
function frame(){const batch=callbacks;callbacks=[];for(const fn of batch)fn();}
function drain(ctx){let count=0;while(callbacks.length&&count++<10000)frame();assert.equal(ctx.busy,0);return count;}
function fixture(level='mobile') {
  const scene=new Group(),geometry=new Geometry();
  for(const [key,a] of Object.entries(attrs))geometry.setAttribute(key,a.clone());
  geometry.setIndex(new Attribute(indices.slice(),1));
  const water=new Mesh(geometry);water.name='env-water';scene.add(water);
  const ctx={quality:{level},scene,world:{tiles:new Map(tiles.map(t=>[t.key,t]))},physics:{ready:false},renderer:{initTexture(){}}};
  return {ctx,water,geometry};
}
try {
 for (const level of ['mobile','low','high','ultra']) {
  const {ctx,water,geometry}=fixture(level);
  syncTunnelTerrain(ctx);
  assert.equal(water.geometry,geometry,'tile event returns before expensive clipping');
  assert.equal(ctx.busy,1,'water uses the shared job budget');
  frame();
  assert.equal(water.geometry,geometry,'retain the previous surface while work yields');
  assert(drain(ctx)>1,'dense cutouts span multiple rendered frames');
  const cut=water.geometry;
  assert.notEqual(cut,geometry);
  assert(cut.index.count>6);
  const unrelated={key:'100_100',tx:100,tz:100,roads:[]};
  ctx.world.tiles.set(unrelated.key,unrelated);syncTunnelTerrain(ctx);
  assert.equal(water.geometry,cut,'unrelated chunk arrival does not rebuild water');
  assert.equal(ctx.busy,0);
  // Reordering identical profiles/tiles also preserves the existing geometry.
  ctx.world.tiles=new Map([...ctx.world.tiles].reverse());syncTunnelTerrain(ctx);
  assert.equal(ctx.busy,0);
  ctx.world.tiles.clear();syncTunnelTerrain(ctx);
  drain(ctx);
  assert.deepEqual(water.geometry.index.array,indices,'retirement restores the original plane');
  assert.deepEqual(water.geometry.attributes.uv.array,attrs.uv.array);

  const cancelled=fixture(level);syncTunnelTerrain(cancelled.ctx);frame();
  cancelled.ctx.world.tiles.clear();syncTunnelTerrain(cancelled.ctx);
  assert.equal(cancelled.ctx.busy,1,'superseded job releases busy exactly once');
  drain(cancelled.ctx);
  assert.deepEqual(cancelled.water.geometry.index.array,indices,'a late cut cannot restore retired holes');
  const removed=fixture(level);syncTunnelTerrain(removed.ctx);frame();removed.water.removeFromParent();
  drain(removed.ctx);
  assert.equal(removed.water.geometry,removed.geometry,'unloaded water never receives a late publication');

 }
} finally {
  globalThis.performance=originalPerformance;
  if(originalRAF===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=originalRAF;
}
assert(versionClientImports("import './tunnels.js';").includes(`tunnels.js?v=${CLIENT_REVISION}`),'reload invalidates cached terrain code');
console.log(`PASS mobile/desktop chunk pacing: ${holes.length} real rail holes, ${yields} clipping yields, frame budget, unchanged-cut reuse, cancellation and restoration`);
