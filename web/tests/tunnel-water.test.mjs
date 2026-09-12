import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';

const { tunnelNetwork, tunnelWaterHoles, cutGround, syncTunnelTerrain } = await import(new URL('tunnels.js', assets));
const { triangleHeight } = await import(new URL('supports.js', assets));
const plane = { position: { array: new Float32Array([
  -26000, 0, -26000, 26000, 0, -26000, 26000, 0, 26000, -26000, 0, 26000,
]), itemSize: 3 } };
const indices = [0, 2, 1, 0, 3, 2];
function covered(geometry, x, z) {
  const pos = geometry.attributes.position.array;
  for (let i = 0; i < geometry.index.length; i += 3) {
    const triangle = [0, 1, 2].map(j => {
      const at = geometry.index[i + j] * 3;
      return [pos[at], pos[at + 1], pos[at + 2]];
    });
    if (triangleHeight(triangle, x, z)?.inside) return true;
  }
  return false;
}

const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 12,
  lanes: 3, layer: 0, tunnel: false, ...extra });
const bore = road(1, [[4000, -10400], [4200, -10400]], { tunnel: true });
const approach = road(2, [[4200, -10400], [4400, -10400]]);
const profiles = tunnelNetwork([bore, approach]);
const cut = cutGround(plane, indices, tunnelWaterHoles(profiles));
for (const x of [4000, 4100, 4200, 4240, 4280, 4330]) {
  assert(!covered(cut, x, -10400), `water must not cover road at ${x}`);
  assert(!covered(cut, x, -10393), 'water clears the shoulder margin');
}
assert(covered(cut, 4380, -10400), 'water beyond the descent stays intact');
assert(covered(cut, 4100, -10380), 'nearby water outside the corridor remains');

// Exercise the actual water update, which used to move cutouts with the camera.
const environment = readFileSync(new URL('environment-WQwLg8tn.js', assets), 'utf8');
const update = environment.match(/\{mesh:x,mat:i,update\(e\)\{([^}]+)\},setEnvMap/);
assert(update, 'served water update is present');
assert(environment.includes('new l(52e3,52e3,1,1)'), 'fixed plane covers the city and horizon');
const water = { position: { x: 0, y: -1.6, z: 0 }, updateMatrixWorld() {} };
const scope = { x: water, r: false, N: false, e: { position: { x: 4230, z: -10320 } } };
vm.runInNewContext(update[1], scope);
scope.e.position = { x: -6500, z: -16500 };
vm.runInNewContext(update[1], scope);
assert.deepEqual(water.position, { x: 0, y: -1.6, z: 0 }, 'camera movement cannot shift the holes');

// Terrain synchronization must work before a camera descends, and restore the
// original plane when streamed tunnel roads disappear.
class Attribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
}
class Geometry {
  constructor(attributes = plane, index = indices) {
    this.attributes = Object.fromEntries(Object.entries(attributes).map(([name, a]) =>
      [name, new Attribute(new Float32Array(a.array), a.itemSize)]));
    this.index = { array: Uint32Array.from(index) };
  }
  clone() { return new Geometry(this.attributes, this.index.array); }
  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  setIndex(value) { this.index.array = Uint32Array.from(value); }
  computeBoundingSphere() {}
  dispose() {}
}
water.geometry = new Geometry();
const tile = { key: '16_-41', tx: 16, tz: -41, roads: [bore, approach] };
const ctx = { world: { tiles: new Map([[tile.key, tile]]) },
  scene: { getObjectByName: name => name === 'env-water' ? water : null },
  physics: { ready: false } };
syncTunnelTerrain(ctx, tile);
assert(!covered({ attributes: water.geometry.attributes, index: water.geometry.index.array }, 4240, -10400));
ctx.world.tiles.clear();
syncTunnelTerrain(ctx, tile);
assert(covered({ attributes: water.geometry.attributes, index: water.geometry.index.array }, 4240, -10400));

const tiles = [];
for (let x = 14; x <= 18; x++) for (let z = -42; z <= -40; z++) {
  tiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`, import.meta.url)))));
}
const actual = tunnelNetwork(tiles.flatMap(tile => tile.roads));
const actualCut = cutGround(plane, indices, tunnelWaterHoles(actual));
let samples = 0;
for (const profile of actual.values()) {
  if (!profile.road.name?.startsWith('Trans-Manhattan')) continue;
  const points = profile.road.pts;
  // Every reported portal and the road shoulder beside it must be dry.
  for (const point of [points[0], points.at(-1)]) {
    if (profile.approach) continue;
    assert(!covered(actualCut, ...point), `water covers tunnel ${profile.road.id}`);
    samples++;
  }
}
assert(samples >= 20);
assert(actualCut.index.length / 3 < 5000, 'city cuts must not fragment the water into excessive triangles');
console.log(`PASS fixed water cutouts, shoulder clearance, streaming restoration, and ${samples} real Trans-Manhattan portal samples`);
