import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { serveStatic } from '../src/lib/server/static.js';

const { triangleHeight } = await import(new URL('supports.js', assets));
const { deckEdges } = await import(new URL('edges.js', assets));
let response;
const scope = { console, performance, self: { postMessage: value => { response = value; } } };
const worker = readFileSync(new URL('tile.worker-Ai2ZdmRL.js', assets), 'utf8');
for (const match of worker.matchAll(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?$/gm)) {
  const module = await import(new URL(match[2], assets));
  for (const binding of match[1].split(',')) {
    const [name, alias = name] = binding.trim().split(/\s+as\s+/);
    scope[alias] = module[name];
  }
}
vm.createContext(scope);
vm.runInContext(worker.replace(/^import .*$/gm, ''), scope);
async function build(tile, roads = tile.roads, level = 'mobile') {
  await scope.self.onmessage({ data: { id: 1, input: { tile, roads,
    pedestrianTiles: tile.streetContext?.pedestrianTiles ?? [tile], quality: { level, shadows: false } } } });
  assert(!response.error, response.error);
  const mesh = response.built.meshes[2];
  const triangles = mesh ? Array.from({ length: mesh.index.length / 3 }, (_, i) => [0, 1, 2].map(j => {
    const offset = mesh.index[i * 3 + j] * 3;
    return Array.from(mesh.attributes.position.data.slice(offset, offset + 3));
  })) : [];
  return (x, z) => triangles.some(triangle => triangleHeight(triangle, x, z)?.inside);
}
const road = (id, pts, extra = {}) => ({ id, pts, cls: 'primary', width: 14, lanes: 2,
  oneway: false, layer: 0, bridge: false, tunnel: false, ...extra });
const tile = roads => ({ key: '0_0', tx: 0, tz: 0, roads, buildings: [], roadbeds: [], sidewalks: [],
  medians: [], parks: [], water: [], parking: [], plazas: [], crossings: [], trees: [], props: [] });
const left = road(1, [[20, 128], [128, 128]]), right = road(2, [[128, 128], [240, 128]]);
for (const level of ['mobile', 'high']) {
  for (const next of [right, { ...right, pts: [...right.pts].reverse(), lanes: 4 }]) {
    const painted = await build(tile([left, next]), [left, next], level);
    for (let x = 121.5; x < 135; x += .5) assert(painted(x, 128.13), `${level}: centerline continues at ${x}`);
    assert(!painted(23, 128.13) && !painted(237, 128.13), 'dead ends retain their setbacks');
  }
}
// The adjoining way can belong to the next tile; context still describes the seam.
const border = [road(3, [[160, 128], [256, 128]]), road(4, [[256, 128], [350, 128]])];
for (const tx of [0, 1]) {
  const painted = await build({ ...tile([border[tx]]), key: `${tx}_0`, tx }, border);
  assert(painted(tx ? 259 : 253, 128.13), 'tile ownership does not open a paint gap');
}
for (const branch of [road(5, [[128, 128], [128, 220]]), road(6, [[128, 20], [128, 220]])]) {
  const roads = [left, right, branch], painted = await build(tile(roads));
  assert(!painted(124, 128.13) && !painted(132, 128.13), 'real junction retains setbacks, including unsplit cross streets');
}
const crossingRoad = road(7, [[128, 20], [128, 220]], { bridge: true, layer: 1 });
const separated = await build(tile([left, right, crossingRoad]));
assert(separated(124, 128.13), 'an overpass is not a ground-level junction');
const oneWay = [{ ...left, oneway: true }, { ...right, oneway: true }];
const along = await build(tile(oneWay));
assert(along(124, 124.7) && along(132, 124.7), 'one-way edge paint continues through a data split');
const opposed = [oneWay[0], { ...oneWay[1], pts: [...right.pts].reverse() }];
const headOn = await build(tile(opposed));
assert(!headOn(124, 124.7), 'opposing one-way ends are not a continuation');
const crossing = { x: 128, z: 128, yaw: Math.PI / 2, width: 14 };
const withCrosswalk = await build({ ...tile([left, right]), crossings: [crossing] });
assert(!withCrosswalk(130, 128.13), 'crosswalk clearance still suppresses longitudinal paint');
console.log('PASS street paint joins, tile borders, direction changes, junctions, overpasses and crosswalk clearance');

// Seams visible in IMG_5455 and IMG_5457: West 125th Street and both sides
// of Adam Clayton Powell Jr. Boulevard. Lane/width changes are not intersections.
for (const [key, ids] of [
  ['11_-24', [1321780273000, 305323035000]],
  ['12_-25', [165473831001, 962623445000, 420877071000, 420877096001]],
]) {
  const actual = JSON.parse(gunzipSync(Buffer.from(await (await serveStatic(`world/world/tiles/${key}.json.gz`)).arrayBuffer())));
  const roads = actual.streetContext.roads;
  const painted = await build({ ...actual, crossings: actual.streetContext.crossings }, roads);
  for (const id of ids) {
    const r = roads.find(r => r.id === id);
    assert(r, `reported road ${id} exists`);
    const seam = r.oneway ? (id === 165473831001 || id === 420877096001 ? r.pts.at(-1) : r.pts[0]) : [2996.03, -6091.04];
    const atEnd = Math.hypot(...r.pts.at(-1).map((v, i) => v - seam[i])) < .1;
    const total = r.pts.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1]), 0);
    const edges = deckEdges(r, roads, r.width / 2);
    const offset = r.oneway ? -r.lanes * Math.min(3.3, r.width / r.lanes) / 2 : .13;
    for (const distance of [1, 3, 5]) {
      const point = edges.line(atEnd ? total - distance : distance, offset);
      assert(painted(...point), `${r.name} ${id}: paint ${distance} m from the data seam`);
    }
  }
}
console.log('PASS served geometry at both reported Harlem locations retains paint through mid-block data splits');
