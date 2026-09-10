import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { lampPlanner, roadFootprints, streetLampPlacement } from '../../public/world/assets/fixtures.js';
const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 16, bridge: true, layer: 1, oneway: true, ...extra });
const main = road(1, [[-120, 0], [120, 0]]);
const cross = road(2, [[0, -120], [0, 120]], { layer: 3 });
const branch = road(3, [[-100, -40], [20, 0]], { width: 10 });
const local = road(4, [[-120, 25], [120, 25]], { cls: 'residential', bridge: false, width: 8 });
const roads = [main, cross, branch, local], plan = lampPlanner(roads), footprint = roadFootprints(roads);
const original = { kind: 'street_lamp', x: 0, z: 0, yaw: 0 };
const moved = plan(original);
assert(moved && moved !== original);
assert(Math.hypot(moved.x, moved.z) <= 48);
assert(!footprint.obstructs(moved.x, moved.z, 4.8, r => r.bridge));
assert(!footprint.obstructs(moved.x, moved.z, 0.7));
for (let reach = 0; reach <= 3; reach += 0.2) {
  assert(!footprint.obstructs(moved.x - Math.sin(moved.yaw) * reach, moved.z - Math.cos(moved.yaw) * reach, 1.6, r => r.bridge), 'lamp arm clears widened overhead pavement');
}
const clear = { ...original, x: 70, z: 32 };
assert.equal(plan(clear), clear, 'ordinary roadside furniture stays in place');
assert.equal(plan({ ...original, kind: 'hydrant' }).kind, 'hydrant');
assert.deepEqual(lampPlanner([...roads].reverse())(original), moved, 'road arrival order does not choose a different edge');
const obstacle = [[[-150, -150], [150, -150], [150, 150], [-150, 150]]];
assert.equal(lampPlanner(roads, [obstacle])(original), null, 'omit a lamp when no nearby edge is clear of buildings');
const tile = { tx: 0, tz: 0, key: '0_0', roads, props: [original, { x: NaN, z: 0, yaw: 0 }], buildings: [], water: [] };
const world = { tiles: new Map([[tile.key, tile]]), roadsNear: () => roads };
assert.deepEqual(streetLampPlacement(world, tile, original), moved);
console.log('PASS lamps clear crossing decks, merging lanes and nearby streets; preserve clear poles and omit blocked placements');

// Run both real placement generators through the first lamp. The second prop's
// yield lets us inspect records without invoking unrelated tile dressing.
const source = stripTypeScriptTypes(readFileSync(new URL('../../src/client/src/props/placement.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')).replace(/^export /gm, '');
const served = readFileSync(new URL('../../public/world/assets/props-coU--UuE.js', import.meta.url), 'utf8');
const start = served.indexOf('function*jn('), end = served.indexOf('function ', start);
for (const [name, code, fn] of [['source', source, 'placeTileSteps'], ['served', served.slice(start, end), 'jn']]) {
  class InstanceList { records = []; push(...args) { this.records.push(args); } }
  const sandbox = { streetLampPlacement, $streetLampPlacement: streetLampPlacement, InstanceList, It: InstanceList,
    hash01: () => 0.1, L: () => 0.1, LAMP_HEAD_LOCAL: { x: 0, y: 10, z: -2.4 }, B: { x: 0, y: 10, z: -2.4 } };
  vm.createContext(sandbox); vm.runInContext(code + `\nglobalThis.place = ${fn}`, sandbox);
  const store = { kinds: new Map(), lights: [], steam: [] }, colliders = [], queries = [];
  const ctx = { world, physics: { groundHeight: (x, z) => { queries.push([x, z]); return 0.15; } } };
  const generator = sandbox.place(ctx, tile, store, { fixed: () => [0, 0, 0, 0] }, {}, new Map(), () => 1, (...args) => colliders.push(args));
  generator.next(); generator.next(); generator.return();
  const record = store.kinds.get('lampLED').records[0];
  assert.deepEqual([record[0], record[1], record[2]], [moved.x, 0.15, moved.z], name);
  assert.deepEqual(queries, [[moved.x, moved.z]], `${name}: sample ground at the relocated base`);
  assert.deepEqual(colliders[0].slice(1, 4), [moved.x, 0.15, moved.z], `${name}: collider follows pole`);
  assert.equal(store.lights.length, 1);
  assert(Math.abs(store.lights[0].x - (moved.x - Math.sin(moved.yaw) * 2.4)) < 1e-6);
  assert(Math.abs(store.lights[0].z - (moved.z - Math.cos(moved.yaw) * 2.4)) < 1e-6);
}
assert.equal(readFileSync(new URL('../../src/client/src/streets/fixtures.js', import.meta.url), 'utf8'), readFileSync(new URL('../../public/world/assets/fixtures.js', import.meta.url), 'utf8'));
console.log('PASS source and served lamp meshes, light sources and colliders share the relocated placement');

// Actual Highbridge roads and authored lamps from the reported interchange.
const { gunzipSync } = await import('node:zlib');
const cityTiles = [];
for (let x = 16; x <= 18; x++) for (let z = -42; z <= -40; z++) {
  cityTiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`, import.meta.url)))));
}
const cityRoads = [...new Map(cityTiles.flatMap(t => t.roads).map(r => [r.id, r])).values()];
const cityPlan = lampPlanner(cityRoads, cityTiles.flatMap(t => [...t.buildings.map(b => b.footprint), ...t.water]));
const cityFootprints = roadFootprints(cityRoads);
let relocated = 0, omitted = 0, preserved = 0;
for (const p of cityTiles.find(t => t.tx === 17 && t.tz === -41).props.filter(p => p.kind === 'street_lamp')) {
  const result = cityPlan(p);
  if (result === p) { preserved++; continue; }
  if (!result) { omitted++; continue; }
  relocated++;
  assert(!cityFootprints.obstructs(result.x, result.z, 4.8, r => r.bridge || r.cls === 'motorway' || r.cls === 'trunk'));
  assert(!cityFootprints.obstructs(result.x, result.z, 0.7));
}
assert(relocated > 0 && preserved > 0);
console.log(`PASS actual Highbridge lamps: ${relocated} moved to clear edges, ${preserved} unchanged, ${omitted} omitted where no clear edge exists`);

// Exercise the actual iOS refresh function as well (including the context alias
// inside its prop loop, and a refresh after road tiles change).
const mobile = readFileSync(new URL('../../public/world/assets/mobile-SBC7KRMu.js', import.meta.url), 'utf8');
const refreshStart = mobile.indexOf('function w(){'), refreshEnd = mobile.indexOf('return w(),', refreshStart);
const mobileTile = { ...tile, props: [original] }, mobileWorld = { ...world, tiles: new Map([[tile.key, mobileTile]]) };
class Mesh {
  instanceMatrix = {}; records = [];
  constructor(geometry, material, count) { this.geometry = geometry; this.count = count; }
  setMatrixAt(i, matrix) { this.records[i] = matrix; }
}
const mobileSandbox = { $streetLampPlacement: streetLampPlacement, e: { camera: { position: { x: 0, z: 0 } }, world: mobileWorld, physics: { groundHeight: () => 0.15 } },
  re: () => [original], g: true, _: 0, v: 0, x: [], i: { resetPoles() {} }, t: { add() {}, remove() {} }, n: {}, r: new Map(),
  a: {}, C: Mesh, ie: () => ({}), d: { set(x, y, z) { this.pos = [x, y, z]; } }, u: { setFromAxisAngle(up, yaw) { this.yaw = yaw; } },
  f: {}, h: {}, l: { compose(pos, rotation) { return { pos: pos.pos, yaw: rotation.yaw }; } } };
vm.createContext(mobileSandbox); vm.runInContext(mobile.slice(refreshStart, refreshEnd) + 'w();', mobileSandbox);
assert.deepEqual(mobileSandbox.r.get('street_lamp').records[0].pos, [moved.x, 0.15, moved.z]);
mobileSandbox.g = true;
vm.runInContext('w();', mobileSandbox);
assert.deepEqual(mobileSandbox.r.get('street_lamp').records[0].pos, [moved.x, 0.15, moved.z]);
console.log('PASS served iOS fallback places lamps at clear edges and refreshes when road tiles change');
