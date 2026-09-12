import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { serveStatic } from '../src/lib/server/static.js';

const { Z: Group, rt: InstancedMesh, g: BufferGeometry, Pt: Material } =
  await import(new URL('textureRelease-2U-gT89r.js', assets));
const { l: disposeObject } = await import(new URL('geom-8zUJB5A-.js', assets));
const material = new Material();
let disposedMaterials = 0;
material.addEventListener('dispose', () => disposedMaterials++);
const instanceBuffers = new Set(), geometries = new Set();
function furniture() {
  const geometry = new BufferGeometry(), mesh = new InstancedMesh(geometry, material, 128);
  // WebGL releases instanceMatrix/instanceColor on the MESH disposal event,
  // separately from the geometry's attributes. Track those ownership contracts.
  instanceBuffers.add(mesh); geometries.add(geometry);
  mesh.addEventListener('dispose', () => instanceBuffers.delete(mesh));
  geometry.addEventListener('dispose', () => geometries.delete(geometry));
  return mesh;
}
for (let i = 0; i < 100; i++) {
  const root = new Group(), nested = new Group(); root.add(nested); nested.add(furniture());
  disposeObject(root);
  assert.equal(instanceBuffers.size, 0, 'unloading releases instanced landmark buffers');
  assert.equal(geometries.size, 0, 'unloading releases landmark geometry');
}
assert.equal(disposedMaterials, 0, 'shared landmark materials survive individual tile unloads');

// Run the served landmark update/preRender/dispose and removal functions.
// Procedural construction is replaced with one real instanced mesh per landmark.
const source = readFileSync(new URL('landmarks-KpQKy0CX.js', assets), 'utf8');
const removeStart = source.indexOf('function ne(t){d.remove(');
const removeEnd = source.indexOf('function re(t,n,r,i)', removeStart);
const lifecycleStart = source.indexOf('function de(t){');
const lifecycleEnd = source.indexOf('export{te as LANDMARK_BINS', lifecycleStart);
assert(removeStart > 0 && removeEnd > removeStart && lifecycleStart > removeEnd && lifecycleEnd > lifecycleStart);
function fixture(level) {
  const group = new Group(), removedColliders = [];
  const ctx = { quality: { level, drawDistance: level === 'mobile' ? 512 : 1500 },
    camera: { position: { x: 0, z: 0 } }, time: { daylight: 1 }, state: { weather: {} },
    world: { hasTile: () => true }, physics: { unregisterDeck() {} } };
  const landmark = (id, x, radius = 80) => ({ id, center: [x, 0], radius, owners: new Set(),
    bins: [id], deckKeys: [], root: null, parts: null, job: null, failed: false, colliding: false,
    *build() { yield; return {}; } });
  const near = landmark('near', 0), far = landmark('far', 2000), bridge = landmark('bridge', 1000, 750);
  const landmarks = [near, far, bridge], bins = new Set(), seats = new Map(landmarks.map(l => [l.id, []]));
  const sandbox = { e: ctx, T: false, ve: 6000, _: landmarks, E: {}, performance, i: {},
    n: { uNight: {}, uTime: {}, uWet: {} }, u: { update() {}, remove() {}, dispose() {} },
    d: { remove: key => removedColliders.push(key), dispose() {} }, Re: disposeObject,
    v: bins, C: seats, m: new Map(), h: new Map(), p: new Map(), ce: [], y: [], b: [],
    a: material, o: { dispose() {} }, c: null, s: null, t: group, k: x => Math.floor(x / 256),
    M: l => { l.colliding = true; },
    j: l => { l.root = new Group(); l.root.add(furniture()); group.add(l.root);
      l.parts = {}; bins.add(l.id); seats.get(l.id).push({ x: l.center[0] }); },
  };
  vm.createContext(sandbox);
  const mod = vm.runInContext('(function(){' + source.slice(removeStart, removeEnd)
    + source.slice(lifecycleStart, lifecycleEnd) + ')()', sandbox);
  const settle = () => { for (let i = 0; i < 12; i++) mod.update(1 / 30, i); mod.preRender(); };
  return { ctx, mod, settle, near, far, bridge, bins, seats };
}
for (const level of ['mobile', 'high']) {
  const f = fixture(level); f.settle();
  assert(f.near.root);
  assert(f.bridge.root, 'large landmarks load when their edge is nearby');
  assert.equal(!!f.far.root, level !== 'mobile', 'mobile does not build the 6 km skyline');
  if (level === 'mobile') {
    for (let i = 0; i < 10; i++) {
      f.ctx.camera.position.x = 2000; f.settle();
      assert.equal(f.near.root, null, 'distant landmarks release their meshes');
      assert(!f.bins.has('near'), 'ordinary building geometry can reappear');
      assert.equal(f.seats.get('near').length, 0, 'unloading clears published furniture seats');
      assert(f.far.root);
      f.ctx.camera.position.x = 0; f.settle();
      assert(f.near.root, 'returning rebuilds the released landmark');
      assert.equal(f.far.root, null);
      assert.equal(instanceBuffers.size, 2, 'travel retains only nearby landmark instance buffers');
    }
  }
  f.mod.dispose();
  assert.equal(instanceBuffers.size, 0);
  assert.equal(geometries.size, 0);
}
for (const file of ['geom-8zUJB5A-.js', 'landmarks-KpQKy0CX.js']) {
  const response = await serveStatic(`world/assets/${file}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), readFileSync(new URL(file, assets), 'utf8'));
}
console.log('PASS mobile landmark range, bridge edges, repeated travel, instance disposal, shared materials and serving');
