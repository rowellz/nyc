import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { createMobileProps } from '../static/world/assets/mobile-props.js';
import { vehicleDrawDistance, parkedDrawDistance } from '../static/world/assets/traffic-distribution.js';
import { parkingOffset } from '../static/world/assets/curb-placement.js';

const bundle = readFileSync(new URL('vehicles-_zJz3z3J.js', assets), 'utf8');
const roadsStart = bundle.indexOf('const node = (x'), roadsEnd = bundle.indexOf('const AVENUE_RADIUS', roadsStart);
let highwayBuilds = 0, created = 0, removed = 0, insideChecks = 0, ios = true;
const Roads = vm.runInNewContext(bundle.slice(roadsStart, roadsEnd) + '\nRoads', {
  $vehicleDrawDistance: vehicleDrawDistance, $parkedDrawDistance: parkedDrawDistance,
  $parkingOffset: parkingOffset,
  isIOS: () => ios, TILE_SIZE: 256, isHighway: () => false,
  highwayLanePath: () => { highwayBuilds++; return null; },
  KINDS: { sedan: { length: 4, width: 2, parkedWeight: 1 } },
  pickKind: () => 'sedan', hash01: () => 0.2, ground: () => 0, poseMatrix() {},
  makeCar: (key, kind, x, y, z) => { created++; return { key, kind, x, y, z }; },
  removeBody: () => { removed++; },
});
const ctx = { quality: { level: 'mobile', drawDistance: 384, farDistance: 5000 }, world: { ios: true }, camera: { position: { x: 110, z: 100 } },
  modules: new Map([['buildings', { isInside: () => { insideChecks++; return false; } }]]) };
const road = { id: 1, cls: 'residential', pts: [[10, 100], [245, 100]], width: 15, lanes: 2, layer: 0 };
const tile = { key: '0_0', tx: 0, tz: 0, roads: [road], props: [] };
const roads = new Roads(ctx); roads.load(tile);
const originalLanes = [...roads.lanes.values()], originalCars = new Map(roads.tiles.get(tile.key).parked.map(c => [c.key, c]));
assert(originalCars.size > 0);
assert([...originalCars.values()].some(car => Math.abs(car.x-ctx.camera.position.x)>80), 'iPhone creates parked cars past the old 80 m window');
const builds = highwayBuilds, allocations = created;
roads.refreshParking(tile);
assert.equal(highwayBuilds, builds, 'parking refresh never rebuilds highway paths');
assert.equal(created, allocations, 'unchanged parked cars retain their bodies and identity');
assert.equal(removed, 0);
ctx.camera.position.x += 10;
roads.refreshParking(tile);
assert.deepEqual([...roads.lanes.values()], originalLanes, 'moving the parking window keeps live lane references');
assert.equal(highwayBuilds, builds);
for (const car of roads.tiles.get(tile.key).parked) if (originalCars.has(car.key)) assert.equal(car, originalCars.get(car.key));
insideChecks = 0;
ctx.camera.position.x = 2000;
roads.refreshParking(tile);
assert.equal(insideChecks, 0, 'distant tiles skip parking clearance queries');
assert.equal(roads.tiles.get(tile.key).parked.length, 0);
assert(removed > 0);
assert(bundle.includes('i.refreshParking(e)'), 'actual vehicle refresh uses parking-only updates');
ios = false;
const desktop = new Roads(ctx); desktop.load(tile);
assert.equal(desktop.tiles.get(tile.key).parked.length, originalCars.size, 'desktop still generates parking throughout the tile');
assert(insideChecks > 0, 'desktop keeps its clearance checks outside the mobile window');

// Use real Three buffers and the real shared build queue. Only workers and
// geometry/terrain inputs are faked; each expensive placement must yield.
const three = await import(new URL('textureRelease-2U-gT89r.js', assets));
const { t: buildScope } = await import(new URL('loading-DS_gLujL.js', assets));
const workerMessages = [];
class Worker {
  constructor(url) { this.url = url; Worker.instance = this; }
  postMessage(message) { workerMessages.push(message); }
  terminate() { this.terminated = true; }
  reply() {
    const request = workerMessages.at(-1);
    this.onmessage({ data: { id: request.id, placements: request.props.map(p => ({ ...p, x: p.x + 1 })) } });
  }
}
const oldWorker = globalThis.Worker, oldRaf = globalThis.requestAnimationFrame, oldPerformance = globalThis.performance;
let frames = [], groundQueries = 0, nearest = [], geometryBuilds = 0, clock = 0;
globalThis.Worker = Worker;
globalThis.requestAnimationFrame = fn => { frames.push(fn); return 1; };
globalThis.performance = { now: () => clock };
try {
  const events = new Map();
  const tiles = new Map([['0_0', { key: '0_0', tx: 0, tz: 0, roads: [], buildings: [], water: [] }]]);
  const ctx = { worldGroup: new three.Z(), world: { tiles }, quality: { level: 'mobile' }, busy: 0,
    camera: { position: new three.Or() }, renderer: { initTexture() {} }, state: { serverTime: () => 0 },
    events: { on(name, fn) { events.set(name, fn); return () => events.delete(name); } },
    physics: { groundHeight() { groundQueries++; clock += 0.8; return 2; } } };
  nearest = Array.from({ length: 200 }, (_, x) => ({ kind: 'street_lamp', x, z: 0, yaw: 0 }));
  const mod = createMobileProps(ctx, { Group: three.Z, Material: three.Pt, InstancedMesh: three.rt,
    Matrix4: three.Ot, Quaternion: three.Zt, Vector3: three.Or,
    SignalNetwork: class { resetPoles() {} addPole() {} signalFor() { return null; } },
    nearestProps: () => nearest,
    geometryFor: () => { geometryBuilds++; return new three.g(); },
    streetLampPlacement: () => { throw Error('clearance must run in worker'); },
    tileKey: (x, z) => `${x}_${z}`, tileIndex: x => Math.floor(x / 256), buildScope });
  assert.equal(groundQueries, 0, 'starting a refresh does no ground queries');
  assert(workerMessages[0].tiles, 'first worker request includes its world snapshot');
  Worker.instance.reply();
  assert.equal(groundQueries, 0, 'worker reply queues work instead of building synchronously');
  async function drain() {
    for (let i = 0; i < 200 && ctx.busy; i++) {
      const before = groundQueries;
      const current = frames; frames = []; current.forEach(fn => fn()); await Promise.resolve();
      assert(groundQueries - before <= 4, 'expensive ground queries respect the shared frame deadline');
    }
    assert.equal(ctx.busy, 0);
  }
  await drain();
  assert.equal(mod.stats.instances, 200);
  assert.equal(groundQueries, 200);
  assert.equal(geometryBuilds, 1);
  const mesh = ctx.worldGroup.children[0].children[0];
  assert.equal(mesh.instanceMatrix.array[13], 2, 'terrain height survives staging');
  assert.equal(mesh.instanceMatrix.array[12], 1, 'worker lamp relocation survives staging');
  nearest.reverse(); ctx.camera.position.x += 10; mod.update(0.5, 1);
  assert.equal(workerMessages.length, 1, 'distance reorder alone requires no placement refresh');
  assert.equal(groundQueries, 200);
  nearest = nearest.slice(0, 199); ctx.camera.position.x += 10; mod.update(0.5, 2); await drain();
  assert.equal(groundQueries, 200, 'remaining props reuse cached heights');
  assert.equal(ctx.worldGroup.children[0].children[0], mesh, 'one removed prop does not reallocate GPU buffers');
  assert.equal(mesh.count, 199);
  events.get('tileLoaded')(); mod.update(0.5, 3);
  assert.equal(workerMessages.length, 2);
  events.get('tileUnloaded')(); Worker.instance.reply();
  assert.equal(ctx.busy, 0, 'obsolete worker reply releases its job without publishing');
  mod.update(0.5, 4);
  mod.dispose(); Worker.instance.reply();
  assert.equal(ctx.busy, 0, 'disposal cancels workers and outstanding scene jobs exactly once');
  assert.equal(ctx.worldGroup.children.length, 0);
  assert(Worker.instance.terminated);
} finally { globalThis.Worker = oldWorker; globalThis.requestAnimationFrame = oldRaf; globalThis.performance = oldPerformance; }

// Worker placements use the same pavement/obstacle rules as the original path.
const { streetLampPlacement } = await import(new URL('fixtures.js', assets));
let result;
const worker = readFileSync(new URL('mobile-props.worker.js', assets), 'utf8');
const scope = vm.createContext({ streetLampPlacement, self: { postMessage: data => { result = data; } } });
vm.runInContext(worker.replace(/^import .*\n/gm, ''), scope);
const workerTile = { ...tile, buildings: [], water: [] };
const prop = { kind: 'street_lamp', x: 110, z: 100, yaw: 0 };
scope.self.onmessage({ data: { id: 1, tiles: [workerTile], props: [prop] } });
assert(!result.error, result.error);
const world = { tiles: new Map([[tile.key, workerTile]]), roadsNear: () => [road] };
assert.deepEqual(result.placements[0], streetLampPlacement(world, workerTile, prop));
scope.self.onmessage({ data: { id: 2, props: [prop] } });
assert(!result.error, 'worker keeps the snapshot for subsequent selections');
scope.self.onmessage({ data: { id: 3, tiles: [workerTile,
  { ...workerTile, key: '1_0', tx: 1, roads: [{ ...road, pts: [[256, 100], [500, 100]] }] }], props: [] } });
assert.equal(vm.runInContext('world.roadsNear(253, 100, 1).length', scope), 2, 'road width and separate segments with one OSM ID survive the worker index');
console.log('PASS parking without lane rebuilds, prop worker/caching, staged publication and cancellation');
