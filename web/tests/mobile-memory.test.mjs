import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { serveStatic } from '../src/lib/server/static.js';
import { MOBILE_STREET_BUDGET, selectDetailedLandmarks } from '../static/world/assets/mobile-build-policy.js';

const { Z: Group, rt: InstancedMesh, g: BufferGeometry, Pt: Material } =
  await import(new URL('textureRelease-2U-gT89r.js', assets));
const { l: disposeObject } = await import(new URL('geom-8zUJB5A-.js', assets));

// Execute the served worker-pool setup, preserving reply/error handlers and
// initial texture dispatch. Reducing the pools must not drop their only slot.
for (const level of ['mobile', 'high']) {
  const expected = level === 'mobile' ? 1 : 2;
  class Worker {
    messages = [];
    terminated = false;
    constructor(_url, options) { this.name = options.name; }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  const source = readFileSync(new URL('streets-CfYSUqyW.js', assets), 'utf8');
  const start = source.indexOf('try{V=new Worker('), end = source.indexOf('function Z(', start);
  assert(start > 0 && end > start);
  const replies = [], slots = [];
  const streetScope = vm.createContext({ Worker, URL, W: slots, V: null, A: false,
    $streetBudget: MOBILE_STREET_BUDGET,
    e: { quality: { level }, renderer: { capabilities: { getMaxAnisotropy: () => 8 } } },
    b: { then: fn => fn(null) }, Y: reply => replies.push(reply), X: () => { throw Error('worker setup failed'); },
  });
  vm.runInContext(source.slice(start, end).replaceAll('import.meta.url', '"https://test/world/assets/streets.js"'), streetScope);
  assert.equal(slots.length, expected);
  assert.equal(slots[0].messages.length, 1, 'the first street worker still generates textures');
  assert.equal(slots[0].messages[0].quality, level);
  for (const worker of slots) await worker.onmessage({ data: { id: replies.length + 1 } });
  assert.equal(replies.length, expected, 'each street worker accepts geometry replies');

  const buildings = readFileSync(new URL('buildings-BDmduZ8y.js', assets), 'utf8');
  const begin = buildings.indexOf('const $buildingWorkerCount='), finish = buildings.indexOf('function M(', begin);
  assert(begin > 0 && finish > begin);
  let pumped = 0, cancelled = 0;
  const buildingSlots = [], owners = new Map();
  const buildingScope = vm.createContext({ Worker, URL, console,
    t: { quality: { level } }, Fe: 2, E: buildingSlots, k: owners, v: new Map(),
    D: [{ job: { cancel: () => cancelled++ } }], P: () => pumped++,
  });
  vm.runInContext(buildings.slice(begin, finish).replaceAll('import.meta.url', '"https://test/world/assets/buildings.js"'), buildingScope);
  assert.equal(buildingSlots.length, expected);
  buildingSlots[0].busy = true;
  buildingSlots[0].w.onmessage({ data: { id: 1 } });
  assert.equal(buildingSlots[0].busy, false, 'a completed build releases the only mobile slot');
  assert.equal(pumped, 1, 'queued building work continues after a reply');
  for (const slot of [...buildingSlots]) {
    slot.w.onmessageerror();
    assert(slot.w.terminated);
  }
  assert.equal(buildingSlots.length, 0);
  assert.equal(cancelled, 1, 'losing the pool cancels queued jobs');
}
console.log('PASS mobile geometry worker limits, texture initialization, replies and pool failure cleanup');

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
  const ctx = { quality: { level, drawDistance: level === 'mobile' ? 512 : 768 },
    camera: { position: { x: 0, z: 0 } }, time: { daylight: 1 }, state: { weather: {} },
    world: { hasTile: () => true }, physics: { unregisterDeck() {} } };
  const landmark = (id, x, radius = 80) => ({ id, center: [x, 0], radius, owners: new Set(),
    bins: [id], deckKeys: [], root: null, parts: null, job: null, failed: false, colliding: false,
    builds:0,*build() { this.builds++;yield; return {}; } });
  const near = landmark('near', 0), far = landmark('far', 2000), bridge = landmark('bridge', 1000, 750);
  const landmarks = [near, far, bridge], bins = new Set(), seats = new Map(landmarks.map(l => [l.id, []]));
  const sandbox = { e: ctx, T: false, ve: 6000, _: landmarks, E: {}, performance, i: {}, $selectDetailedLandmarks:selectDetailedLandmarks,
    n: { uNight: {}, uTime: {}, uWet: {} }, u: { update() {}, remove() {}, dispose() {} },
    d: { remove: key => removedColliders.push(key), dispose() {} }, Re: disposeObject,
    v: bins, C: seats, m: new Map(), h: new Map(), p: new Map(), ce: [], y: [], b: [],
    a: material, o: { dispose() {} }, c: null, s: null, t: group, k: x => Math.floor(x / 256),
    M: l => { l.colliding = true; },
    j: l => { l.root = new Group(); l.root.add(furniture()); group.add(l.root);
      l.parts = {}; bins.add(l.id); seats.get(l.id)?.push({ x: l.center[0] }); },
  };
  vm.createContext(sandbox);
  const mod = vm.runInContext('(function(){' + source.slice(removeStart, removeEnd)
    + source.slice(lifecycleStart, lifecycleEnd) + ')()', sandbox);
  const settle = () => { for (let i = 0; i < 12; i++) mod.update(1 / 30, i); mod.preRender(); };
  return { ctx, mod, settle, near, far, bridge, bins, seats, landmarks, landmark };
}
// Dense blocks must obey the construction cap, not allocate all custom towers
// first and only hide them after uploading. Owning tiles cannot pin replacements.
for(const [level,ios,limit] of [['mobile',true,2],['mobile',false,3],['high',false,5]]) {
  const f=fixture(level);f.ctx.world.ios=ios;
  const towers=[f.near,...[20,40,60,80].map((x,i)=>f.landmark(`tower-${i}`,x))];
  f.landmarks.push(...towers.slice(1));
  for(const tower of towers)tower.owners.add('0_0');
  f.settle();f.settle();
  assert.equal(towers.filter(t=>t.root).length,limit,'only admitted custom models get built');
  assert.equal(towers.reduce((n,t)=>n+t.builds,0),limit,'unselected towers allocate no construction geometry');
  assert.equal(towers.filter(t=>f.bins.has(t.id)).length,limit,'other buildings retain ordinary facades');
  assert(f.bridge.root,'bridge decks retain their normal visibility/collision policy');
  if(level==='mobile') {
    const park=f.landmark('bryant-park',0);f.landmarks.push(park);f.settle();assert(park.root,'walkable parks are not counted as custom towers');
    const interrupted=towers.find(t=>!t.root);interrupted.job={next(){throw Error('retired job resumed');}};
    f.mod.update(1/30,30);assert.equal(interrupted.job,null,'unselected construction jobs release their scratch data');
    f.ctx.camera.position.x=2000;
    f.mod.update(1/30,31);assert.equal(f.far.builds,0,'retirement gets its own frame before allocating another tower');
    f.settle();
    assert(towers.every(t=>!t.root&&!f.bins.has(t.id)),'even owned distant towers retire and restore their fallbacks');
    assert(f.far.root);
  }
  f.mod.dispose();assert.equal(instanceBuffers.size,0);assert.equal(geometries.size,0);
}
for (const level of ['mobile', 'high']) {
  const f = fixture(level); f.settle();
  assert(f.near.root);
  assert(f.bridge.root, 'large landmarks load when their edge is nearby');
  assert.equal(f.far.root, null, 'distant landmarks use prebuilt proxies on every device');
  {
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
