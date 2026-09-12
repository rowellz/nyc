import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { buildingFoundation, foundationIndex, foundationSlab, TUNNEL_FOUNDATION_Y } from '../../public/world/assets/foundations.js';

const polygon = (x0, z0, x1, z1) => [[[x0, z0], [x1, z0], [x1, z1], [x0, z1]]];
const road = { tunnel: true, width: 10, pts: [[20, 40], [220, 40]] };
const index = foundationIndex([road]);
const building = (id, footprint) => ({ id, footprint, height: 25, floors: 7, year: 1920,
  style: 'brick', roofShape: 'flat', hasWaterTower: true, groundElev: 0 });
const raised = building(100, polygon(70, 36, 110, 60));
const outside = building(101, polygon(70, 60, 110, 80));
assert.equal(buildingFoundation(raised, index), TUNNEL_FOUNDATION_Y);
assert.equal(buildingFoundation(outside, index), 0);
assert.equal(buildingFoundation(building(102, polygon(70, 44, 110, 48)), index), TUNNEL_FOUNDATION_Y, 'width overlap without centreline overlap');
assert.equal(buildingFoundation(building(103, polygon(120, 0, 130, 100)), index), TUNNEL_FOUNDATION_Y, 'crossing without containing either segment endpoint');
const courtyard = polygon(0, 0, 256, 256).concat(polygon(10, 30, 230, 50));
assert.equal(buildingFoundation(building(104, courtyard), index), 0, 'tunnel wholly in a courtyard does not support the surrounding building');
assert.equal(buildingFoundation(raised, foundationIndex([{ ...road, tunnel: false }])), 0);
assert.equal(buildingFoundation(raised, foundationIndex([{ ...road, cls: 'footway' }])), 0);
assert.equal(buildingFoundation(building(105, polygon(255, 36, 275, 60)), foundationIndex([{ ...road, pts: [[240, 40], [300, 40]] }])), TUNNEL_FOUNDATION_Y, 'tile-border footprint');
console.log('PASS footprint intersections, road width, courtyards, nearby buildings, and tile borders');

const code = name => readFileSync(new URL('../../public/world/assets/' + name, import.meta.url), 'utf8').replace(/^import .*$/m, '');
function near(b, base) {
  let result;
  const sandbox = { console, performance, self: { postMessage: r => { result = r; } }, $foundation: base, $foundationSlab: foundationSlab };
  vm.createContext(sandbox); vm.runInContext(code('builder.worker-D9_Czkt3.js'), sandbox);
  sandbox.self.onmessage({ data: { id: 1, input: { key: '0_0', tx: 0, tz: 0, buildings: b, roads: [], landmarkBins: [], quality: 'high' } } });
  assert(!result.error, result.error);
  return result.tile;
}
// A residential facade keeps the same vertex layout when it is raised.
const residential = { ...raised, style: 'limestone' };
const base = near([residential], () => 0), moved = near([residential], b => buildingFoundation(b, index));
for (let i = 0; i < base.position.length; i++) {
  assert(Math.abs(moved.position[i] - base.position[i] - (i % 3 === 1 ? TUNNEL_FOUNDATION_Y : 0)) < 0.00003, `render vertex ${i}`);
}
for (let i = 0; i < base.colPos.length; i++) {
  assert(Math.abs(moved.colPos[i] - base.colPos[i] - (i % 3 === 1 ? TUNNEL_FOUNDATION_Y : 0)) < 0.00003, `collision vertex ${i}`);
}
assert.equal(moved.lookup[5], base.lookup[5] + TUNNEL_FOUNDATION_Y);
assert(moved.bounds.cy + moved.bounds.r >= Math.max(...moved.position.filter((_, i) => i % 3 === 1)), 'bounds include the raised roof');
assert(moved.colPos.length > base.colPos.length, 'foundation underside has a collider');
assert(Math.min(...moved.colPos.filter((_, i) => i % 3 === 1)) > 5.6, 'foundation clears the tunnel opening');
const untouched = near([outside], b => buildingFoundation(b, index)), original = near([outside], () => 0);
assert.deepEqual(Array.from(untouched.position), Array.from(original.position));
const mixed = near([raised, outside], b => buildingFoundation(b, index));
assert(mixed.colPos.some((v, i) => i % 3 === 1 && v === 0), 'the next building resets the elevation');
console.log('PASS served near builder moves the entire building, roof props, collisions, bounds, and lookup; adds an open foundation slab');

const shop = { ...raised, landUse: '04' };
const streetShop = near([shop], () => 0), raisedShop = near([shop], b => buildingFoundation(b, index));
const commercial = tile => tile.wall.some((v, i) => i % 4 === 1 && (v & 2) !== 0);
const shopProps = tile => tile.wall.some((v, i) => i % 4 === 3 && (v === 3 || v === 4));
assert(commercial(streetShop), 'street-level shops retain their facade treatment');
assert(shopProps(streetShop), 'street-level shops retain signs and awnings');
assert(!commercial(raisedShop), 'raised facades do not paint storefronts');
assert(!shopProps(raisedShop), 'raised facades do not attach shop signs or awnings');
console.log('PASS storefront textures, signs, and awnings are removed only from elevated buildings');

async function far(base) {
  const messages = [];
  const sandbox = { console, performance, self: { postMessage: r => messages.push(r) }, $foundation: base };
  vm.createContext(sandbox); vm.runInContext(code('far.worker-BYt2J0PM.js'), sandbox);
  await sandbox.self.onmessage({ data: { type: 'start', keys: ['0_0'], tiles: [{ key: '0_0', buildings: [raised], roads: [] }],
    focusX: 0, focusZ: 0, landmarkBins: [], minHeight: 0 } });
  const chunk = messages.find(m => m.type === 'chunk');
  assert(chunk, JSON.stringify(messages));
  return chunk;
}
const farBase = await far(() => 0), farRaised = await far(b => buildingFoundation(b, index));
assert.equal(farBase.position.length, farRaised.position.length);
for (let i = 0; i < farBase.position.length; i++) {
  assert(Math.abs(farRaised.position[i] - farBase.position[i] - (i % 3 === 1 ? TUNNEL_FOUNDATION_Y : 0)) < 0.00003);
}
for (let i = 0; i < farBase.towers.length; i++) {
  assert(Math.abs(farRaised.towers[i] - farBase.towers[i] - (i % 4 === 1 ? TUNNEL_FOUNDATION_Y : 0)) < 0.00003);
}
assert.deepEqual(Array.from(farBase.uv), Array.from(farRaised.uv), 'facade floors keep their local texture coordinates');
console.log('PASS served distant builder and water towers use the identical foundation elevation');

const cityTile = JSON.parse(gunzipSync(readFileSync(new URL('../../public/world/world/tiles/15_-41.json.gz', import.meta.url))));
const supported = cityTile.buildings.filter(b => buildingFoundation(b) > 0);
assert(supported.length > 0, 'real Trans-Manhattan buildings overlap the global tunnel index');
assert(cityTile.buildings.some(b => buildingFoundation(b) === 0));
const real = near([supported[0]], buildingFoundation);
assert(real.colPos.every((v, i) => i % 3 !== 1 || v >= TUNNEL_FOUNDATION_Y - 0.251));
console.log(`PASS actual Trans-Manhattan tile: ${supported.length} buildings receive elevated foundations`);
