import { pedestrianClearance } from '../../public/world/assets/pedestrian-clearance.js';
import { resolveRoadOverlaps } from '../../public/world/assets/road-overlap.js';
import { roadFootprints } from '../../public/world/assets/fixtures.js';
import { deckEdges, barrierRuns } from '../../public/world/assets/edges.js';
import { clearanceProfile } from '../../public/world/assets/ramps.js';
import { carriagewayIndex, pathHalfWidth, pathPieceClear } from '../../public/world/assets/carriageway.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import * as tunnels from '../../public/world/assets/tunnels.js';
import { supportPlanner, roadDeckHeight, roadDeckTriangles, triangleHeight } from '../../public/world/assets/supports.js';

const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 12, lanes: 3, oneway: true,
  layer: 1, bridge: true, tunnel: false, ...extra });
const lower = road(11, [[-128, 128], [384, 128]]);
const upper = road(12, [[128, -128], [128, 384]], { layer: 3 });
const surface = road(13, [[-128, 80], [384, 80]], { cls: 'primary', bridge: false, layer: 0, lanes: 2, width: 8 });
const makeTile = (roads, extra = {}) => ({ key: '0_0', tx: 0, tz: 0, roads, buildings: [], roadbeds: [], sidewalks: [], medians: [], parks: [], water: [],
  parking: [], plazas: [], crossings: [], trees: [], props: [], groundElev: 0, ...extra });
let result;
const sandbox = { console, performance, self: { postMessage: r => { result = r; } }, $roadFootprints: roadFootprints, $deckEdges: deckEdges, $barrierRuns: barrierRuns, $clearanceProfile: clearanceProfile, $roadDeckTriangles: roadDeckTriangles, $triangleHeight: triangleHeight, $roadDeckHeight: roadDeckHeight, $supportPlanner: supportPlanner,
  $tunnelBuild: tunnels.buildTunnels, $tunnelNetwork: tunnels.tunnelNetwork, $tunnelCut: tunnels.cutBuilder, $carriagewayIndex: carriagewayIndex, $pathHalfWidth: pathHalfWidth, $pathPieceClear: pathPieceClear, $resolveRoadOverlaps: resolveRoadOverlaps, $pedestrianClearance: pedestrianClearance };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../../public/world/assets/tile.worker-Ai2ZdmRL.js', import.meta.url), 'utf8').replace(/^import .*$/gm, ''), sandbox);
async function build(roads, extra = {}) {
  await sandbox.self.onmessage({ data: { id: 1, input: { tile: makeTile(roads, extra), roads, quality: { level: 'mobile', shadows: false } } } });
  assert(!result.error, result.error);
  return result.built;
}

const built = await build([lower, upper, surface]);
const marks = built.meshes[2].attributes, positions = marks.position.data;
// The wear frame identifies which road emitted a marking, independent of its height.
const frame = marks.aT.data;
assert(frame, `missing road wear frame: ${Object.keys(marks)}`);
let lowerAtCrossing = 0, upperAtCrossing = 0, surfaceAtCrossing = 0;
for (let i = 0; i < positions.length / 3; i++) {
  const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
  const rx = frame[i * 4], rz = frame[i * 4 + 1], laneCode = frame[i * 4 + 3];
  if (Math.abs(rx) < 0.01 && rz > 0.99 && laneCode < 100) {
    assert(y < 7.05, `lower markings jumped to ${y}`);
    if (Math.abs(x - 128) < 8) { assert(Math.abs(y - 7.032) < 0.002); lowerAtCrossing++; }
  }
  if (rx < -0.99 && Math.abs(rz) < 0.01 && Math.abs(z - 128) < 8) { assert(y > 17.9); upperAtCrossing++; }
  if (laneCode > 100) {
    assert(y < 0.2, `surface marking climbed to ${y}`);
    if (Math.abs(x - 128) < 8) surfaceAtCrossing++;
  }
}
assert(lowerAtCrossing && upperAtCrossing && surfaceAtCrossing);
assert(built.decks.every(d => d.roadId === 11 || d.roadId === 12));
console.log('PASS lower, upper, and surface markings retain their own elevations at overlapping crossings');

// Changing road arrival order cannot change the emitted markings.
const reversed = await build([surface, upper, lower]);
const sortedVertices = mesh => {
  const a = mesh.attributes.position.data, out = [];
  for (let i = 0; i < a.length; i += 3) out.push(`${a[i]},${a[i + 1]},${a[i + 2]}`);
  return out.sort();
};
assert.deepEqual(sortedVertices(built.meshes[2]), sortedVertices(reversed.meshes[2]));

const paintedGround = await build([upper, surface], {
  roadbeds: [[[[125, 75], [131, 75], [131, 85], [125, 85]]]],
  crossings: [{ x: 128, z: 80, yaw: 0, width: 8, signal: false }],
  props: [{ kind: 'manhole', x: 128, z: 80, yaw: 0 }],
});
const ground = paintedGround.meshes[0].attributes;
let groundCorners = 0;
for (let i = 0; i < ground.position.data.length / 3; i++) {
  if (Math.abs(ground.position.data[i * 3 + 1] - 0.02) > 0.001) continue;
  assert(ground.aB.data[i * 4] > 0.99, 'ground asphalt wear follows the ground road direction');
  groundCorners++;
}
assert(groundCorners >= 4);
console.log('PASS arrival order is stable and surface asphalt follows the road below the overpass');

const main = road(21, [[-128, 128], [384, 128]], { width: 16, layer: 3 });
const underneath = road(22, [[-128, 128], [384, 128]], { width: 20, bridge: false });
const q = { x: 128, z: 128, dx: 1, dz: 0 };
const constantProfiles = (_env, r) => ({ hw: r.width / 2, hAt: () => !r.bridge ? 0 : r.layer === 3 ? 18 : 13 });
const planner = roads => supportPlanner({ tile: { roads } }, constantProfiles);
const ordinary = planner([main])(main, q, 8, 17, 1, 0.55);
assert.deepEqual(ordinary.offsets, [-4, 4]);
const shifted = planner([main, underneath])(main, q, 8, 17, 1, 0.55);
assert(shifted && shifted.offsets.length === 2);
assert(shifted.offsets.every(o => Math.abs(o) > 10 + Math.SQRT2 * 0.55 + 1), 'columns clear full lane widths plus a shoulder');
assert(shifted.halfWidth > Math.max(...shifted.offsets.map(Math.abs)), 'cap beam reaches the relocated columns');
const crossing = road(23, [[128, -128], [128, 384]], { bridge: false, width: 20 });
assert.equal(planner([main, crossing])(main, q, 8, 17, 1, 0.55), null, 'omit a station that cannot straddle a crossing');
assert(planner([main, crossing])(main, { ...q, x: 153 }, 8, 17, 1, 0.55), 'keep the next clear station');
const closeDeck = { ...underneath, bridge: true, layer: 2 };
assert.equal(planner([main, closeDeck])(main, q, 8, 17, 1, 0.55), null, 'omit a low crossbeam over a lower deck');
console.log('PASS supports relocate beside roads, widen their beams, and omit obstructed or low-clearance stations');

const supported = await build([main, underneath]);
let columnFaces = 0;
for (let i = 0; i < supported.colliderIdx.length; i += 3) {
  const pts = Array.from(supported.colliderIdx.slice(i, i + 3), v => Array.from(supported.colliderPos.slice(v * 3, v * 3 + 3)));
  const ys = pts.map(p => p[1]), xs = pts.map(p => p[0]), zs = pts.map(p => p[2]);
  if (Math.min(...ys) !== 0 || Math.max(...ys) < 2 || Math.max(...xs) - Math.min(...xs) > 1.2 || Math.max(...zs) - Math.min(...zs) > 1.2) continue;
  assert(pts.every(p => Math.abs(p[2] - 128) > 11), 'served column collider must clear the roadway below');
  columnFaces++;
}
assert(columnFaces > 0, 'the served builder still emits safe supporting columns');
console.log('PASS served worker places real support colliders outside the lower motorway');

// Use the rendered asphalt, not its centreline sampler, as the reference.
function checkPaintSurface(tile, predicate = () => true) {
  const asphalt = tile.meshes[0], paint = tile.meshes[2];
  const a = asphalt.attributes.position.data, p = paint.attributes.position.data;
  const faces = [];
  for (let i = 0; i < asphalt.index.length; i += 3) {
    faces.push(Array.from(asphalt.index.slice(i, i + 3), v => Array.from(a.slice(v * 3, v * 3 + 3))));
  }
  let checked = 0;
  for (let i = 0; i < paint.index.length; i += 3) {
    const points = Array.from(paint.index.slice(i, i + 3), v => Array.from(p.slice(v * 3, v * 3 + 3)));
    const centre = [0, 1, 2].map(j => points.reduce((sum, v) => sum + v[j], 0) / 3);
    if (!predicate(centre)) continue;
    const [x, y, z] = centre;
    let closest = Infinity;
    for (const [a, b, c] of faces) {
      if ([a, b, c].every(v => v[0] < x - 0.002) || [a, b, c].every(v => v[0] > x + 0.002) || [a, b, c].every(v => v[2] < z - 0.002) || [a, b, c].every(v => v[2] > z + 0.002)) continue;
      const det = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
      if (Math.abs(det) < 1e-8) continue;
      const u = ((x - a[0]) * (c[2] - a[2]) - (z - a[2]) * (c[0] - a[0])) / det;
      const v = ((b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0])) / det;
      if (u < -1e-3 || v < -1e-3 || u + v > 1.001) continue;
      const delta = y - (a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]));
      if (Math.abs(delta - 0.012) < Math.abs(closest - 0.012)) closest = delta;
    }
    assert(Math.abs(closest - 0.012) < 0.003, `paint at ${centre} is ${closest} m above asphalt`);
    checked++;
  }
  assert(checked > 0);
  return checked;
}
const curved = road(31, [[-40, 65], [80, 65], [100, 120], [230, 120], [290, 200]]);
const curvedTile = await build([curved, upper]);
assert(checkPaintSurface(curvedTile, p => p[1] > 0.2 && p[1] < 7.1) > 100);
console.log('PASS paint remains above the rendered curved ramp, including inside each dash');

for (const bridge of [false, true]) {
  const short = road(32, [[120, 100], [130, 100]], { bridge });
  const shortTile = await build([short, upper]);
  const p = shortTile.meshes[2].attributes.position.data;
  const near = [];
  for (let i = 0; i < p.length; i += 3) if (p[i + 1] < 7.1 && Math.abs(p[i + 2] - 100) < 6) near.push(p[i]);
  assert(near.length > 0, 'a ten-meter highway connector retains markings under an overpass');
  assert(Math.min(...near) <= 120.001 && Math.max(...near) >= 129.999, 'edge lines reach both way boundaries');
}
console.log('PASS short surface and elevated highway connectors keep their markings through way boundaries');

// The tagged bridge starts only five metres before an underpass. Its approach
// must carry the climb instead of forcing the bridge endpoint down into traffic.
const approachRoad = road(51, [[5, 128], [100, 128]], { bridge: false, layer: 0, width: 8 });
const shortRamp = road(52, [[100, 128], [245, 128]], { width: 8 });
const underRamp = road(53, [[105, 5], [105, 250]], { bridge: false, layer: 0, width: 10 });
const rampTile = await build([approachRoad, shortRamp, underRamp]);
assert(roadDeckHeight(rampTile.decks, shortRamp.id, 105, 128) - 1 >= 4.8, 'slab clears the road beneath');
for (const x of [100, 102, 105, 108, 110]) for (const z of [124, 128, 132]) {
  assert(roadDeckHeight(rampTile.decks, shortRamp.id, x, z) - 1 >= 4.8, 'clearance covers the full overlapping roadway widths');
}
const approachEnd = roadDeckHeight(rampTile.decks, approachRoad.id, 100, 128);
assert(approachEnd > 5.8, 'the approach remains elevated at the bridge tag boundary');
assert(Math.abs(approachEnd - roadDeckHeight(rampTile.decks, shortRamp.id, 100, 128)) < 0.001, 'approach and bridge meet without a step');
assert.equal(roadDeckHeight(rampTile.decks, approachRoad.id, 5, 128), 0, 'the far approach still lands at street level');
checkPaintSurface(rampTile, p => p[1] > 0.2);
const reorderedRamp = await build([underRamp, shortRamp, approachRoad]);
assert.deepEqual(sortedVertices(rampTile.meshes[0]), sortedVertices(reorderedRamp.meshes[0]));
console.log('PASS short ramps clear full road widths, extend smoothly into approaches, and preserve their ground connection');

assert.equal(roadDeckHeight([
  { roadId: 1, pts: [{ x: 254, z: 100, h: 6 }, { x: 255, z: 101, h: 7 }] },
  { roadId: 2, pts: [{ x: 254, z: 100, h: 18 }, { x: 256, z: 102, h: 18 }] },
], 1, 256, 102), 8, 'an offset lane crossing a clipped deck end extends its own slope');

const city = new Map(), cityRoads = new Map();
for (let x = 15; x <= 18; x++) for (let z = -42; z <= -39; z++) {
  const key = `${x}_${z}`;
  let bytes;
  try { bytes = readFileSync(new URL(`../../public/world/world/tiles/${key}.json.gz`, import.meta.url)); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const tile = JSON.parse(gunzipSync(bytes)); city.set(key, tile);
  for (const road of tile.roads) cityRoads.set(road.id, road);
}
for (const key of ['16_-41', '17_-41', '17_-40']) {
  const tile = city.get(key); assert(tile);
  await sandbox.self.onmessage({ data: { id: 2, input: { tile, roads: [...cityRoads.values()], quality: { level: 'mobile', shadows: false } } } });
  assert(!result.error, result.error);
  if (key === '17_-40') {
    for (const [upperId, lowerId, x, z] of [
      [8119542000, 121772578000, 4398.237253797577, -10197.276869772999],
      [8119552000, 121772578000, 4437.895901514511, -10193.745978086132],
      [46593920000, 121772578000, 4414.062463027695, -10194.777168593708],
      [46593921000, 121772578000, 4427.392647882964, -10193.828596251735],
    ]) {
      const clearance = roadDeckHeight(result.built.decks, upperId, x, z) - roadDeckHeight(result.built.decks, lowerId, x, z) - 1;
      assert(clearance >= 4.8, `Highbridge ramp ${upperId} has ${clearance} m of clearance`);
    }
  }
  const mesh = result.built.meshes[2], p = mesh.attributes.position.data;
  checkPaintSurface(result.built, p => p[1] > 0.2);
  for (let i = 0; i < mesh.index.length; i += 3) {
    const points = Array.from(mesh.index.slice(i, i + 3), v => Array.from(p.slice(v * 3, v * 3 + 3)));
    const rise = Math.max(...points.map(v => v[1])) - Math.min(...points.map(v => v[1]));
    const run = Math.max(...points.flatMap(a => points.map(b => Math.hypot(a[0] - b[0], a[2] - b[2]))));
    assert(!(rise > 3 && rise > run), `${key}: marking rose ${rise} m over ${run} m`);
  }
}
console.log('PASS actual Highbridge paint stays above the asphalt without vertical stretches at tile edges');

const narrow = road(81, [[-80, 128], [128, 128]], { width: 8, lanes: 2 });
const wide = road(82, [[128, 128], [380, 128]], { width: 18, lanes: 2 });
const connected = [narrow, wide];
const narrowEdges = deckEdges(narrow, connected, 4), wideEdges = deckEdges(wide, connected, 9);
assert.deepEqual(narrowEdges(208), wideEdges(0), 'both ways agree on the width and direction at their seam');
for (const [edges, length] of [[narrowEdges, 208], [wideEdges, 252]]) {
  let previous = edges(0);
  for (let s = 0.5; s <= length; s += 0.5) {
    const next = edges(s);
    for (let side = 0; side < 2; side++) assert(Math.abs(next[side][1] - previous[side][1]) <= 0.061, 'width changes taper instead of stepping sideways');
    previous = next;
  }
}
const joinSpur = deckEdges(narrow, [narrow], 4, q => q.s >= 100 && q.s <= 104 ? [1.6, 0] : [0, 0]);
for (let s = 75; s < 125; s += 0.5) assert(Math.abs(joinSpur(s + 0.5)[0][1] - joinSpur(s)[0][1]) <= 0.050001, 'an isolated join adjustment cannot form a jagged spur');
const seamTile = await build(connected);
const seamEdges = id => {
  const deck = seamTile.decks.find(d => d.roadId === id);
  const i = deck.pts.findIndex(p => Math.abs(p.x - 128) < 0.001 && Math.abs(p.z - 128) < 0.001);
  assert(i >= 0);
  return Array.from(deck.surface.slice(i * 6, i * 6 + 6));
};
assert.deepEqual(seamEdges(narrow.id), seamEdges(wide.id), 'rendered asphalt and collider copies have matching seam vertices');
for (let x = 125; x <= 131; x += 0.5) {
  const edges = x <= 128 ? narrowEdges(x + 80) : wideEdges(x - 128);
  for (let side = 0; side < 2; side++) {
    const z = edges[side][1] + (side ? -0.38 : 0.38);
    let covered = false;
    for (let i = 0; i < seamTile.colliderIdx.length && !covered; i += 3) {
      const face = Array.from(seamTile.colliderIdx.slice(i, i + 3), v => Array.from(seamTile.colliderPos.slice(v * 3, v * 3 + 3)));
      const sample = triangleHeight(face, x, z);
      covered = sample?.inside && sample.height > 7.7 && sample.height < 7.9;
    }
    assert(covered, `barrier collider is continuous across the tapered seam at ${x},${z}`);
  }
}
checkPaintSurface(seamTile, p => p[1] > 0.2);
const reverseSeam = await build([...connected].reverse());
assert.deepEqual(sortedVertices(seamTile.meshes[0]), sortedVertices(reverseSeam.meshes[0]));
assert.deepEqual(barrierRuns([0, 7, 0], [4, 7, 0], p => p[0] >= 3), [[[0, 7, 0], [3, 7, 0]]], 'a merge covering one end opens only that part of a barrier');
console.log('PASS abrupt width changes and isolated join spurs become gradual, matching deck edges without oversized barrier gaps');

// Include the Cross Bronx bridge approaches shown in the second reported area.
for (let x = 19; x <= 20; x++) for (let z = -42; z <= -38; z++) {
  let tile;
  try { tile = JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`, import.meta.url)))); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  for (const r of tile.roads) cityRoads.set(r.id, r);
}
// Actual width discontinuities from both reported highway areas.
for (const [aId, bId] of [[121772578000, 1504770029000], [121772577000, 42435675000], [1081036135000, 1081036137000],
  [1303959654000, 1303959655000], [538804346000, 46620618000], [1303959655000, 1303647211000]]) {
  const a = cityRoads.get(aId), b = cityRoads.get(bId); assert(a && b);
  const all = [...cityRoads.values()], ae = deckEdges(a, all, Math.max(3.2, a.width / 2)), be = deckEdges(b, all, Math.max(3.2, b.width / 2));
  const length = r => r.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1]), 0);
  let matched = false;
  for (const aEnd of [false, true]) for (const bEnd of [false, true]) {
    const p = aEnd ? a.pts.at(-1) : a.pts[0], q = bEnd ? b.pts.at(-1) : b.pts[0];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01) continue;
    const A = ae(aEnd ? length(a) : 0), B = be(bEnd ? length(b) : 0);
    assert(A.every(v => B.some(w => Math.hypot(v[0] - w[0], v[1] - w[1]) < 0.001)), `${aId}/${bId}: actual road edges match at the width change`);
    matched = true;
  }
  assert(matched);
}
console.log('PASS six real Highbridge and Cross Bronx highway width transitions now share continuous edges');

// An opposed carriageway widens at its way boundary. The nominal-width test
// mistakes this overlap for a median and leaves concrete in the merged pavement.
const fixtureMain = road(90, [[-128, 128], [384, 128]], { width: 16 });
const fixtureNarrow = road(91, [[128, 114], [-128, 114]], { width: 6.4 });
const fixtureWide = road(92, [[384, 114], [128, 114]], { width: 20 });
const fixtureTile = await build([fixtureMain, fixtureNarrow, fixtureWide]);
const mainDeck = fixtureTile.decks.find(d => d.roadId === 90);
const barrierAt = (x, z, tile = fixtureTile) => {
  for (let i = 0; i < tile.colliderIdx.length; i += 3) {
    const face = Array.from(tile.colliderIdx.slice(i, i + 3), v => Array.from(tile.colliderPos.slice(v * 3, v * 3 + 3)));
    const y = triangleHeight(face, x, z);
    if (y?.inside && y.height > 7.7 && y.height < 7.9) return true;
  }
  return false;
};
// The opposing deck is measured where it is actually built: covered barrier
// lines go, and the median returns exactly where the two are merely alongside.
const opposedEdges = deckEdges(fixtureNarrow, [fixtureMain, fixtureNarrow, fixtureWide], 3.2);
let covered = 0, alongside = 0;
for (let i = 0; i < mainDeck.surface.length; i += 6) {
  const x = mainDeck.surface[i], line = mainDeck.surface[i + 2] + 0.38;
  if (x < 100 || x >= 128) continue;
  const reach = opposedEdges(128 - x)[0][1] - line;
  if (Math.abs(reach) < 0.05) continue;
  if (reach > 0) { assert(!barrierAt(x + 0.1, line), `remove median concrete inside the widened opposing pavement at x=${x}`); covered++; }
  else { assert(barrierAt(x + 0.1, line), `keep the median where the opposed decks are only alongside at x=${x}`); alongside++; }
  assert(barrierAt(x + 0.1, mainDeck.surface[i + 5] - 0.38), 'retain the exposed outer motorway barrier');
}
assert(covered >= 2 && alongside >= 2, `${covered} covered, ${alongside} alongside`);
for (let i = 0; i < mainDeck.surface.length; i += 6) {
  const x = mainDeck.surface[i];
  if (x < 132 || x > 160) continue;
  assert(!barrierAt(x + 0.1, mainDeck.surface[i + 2] + 0.38), `remove median concrete inside the widened opposing pavement at x=${x}`);
}
console.log('PASS widened merges clear interior barrier colliders and retain exposed outer barriers');

const baselineSandbox = { ...sandbox, $roadFootprints: () => ({ obstructs: () => false }), self: { postMessage: r => { result = r; } } };
vm.createContext(baselineSandbox);
vm.runInContext(readFileSync(new URL('../../public/world/assets/tile.worker-Ai2ZdmRL.js', import.meta.url), 'utf8').replace(/^import .*$/gm, ''), baselineSandbox);
const fixtureRoads = [fixtureMain, fixtureNarrow, fixtureWide];
await baselineSandbox.self.onmessage({ data: { id: 1, input: { tile: makeTile(fixtureRoads), roads: fixtureRoads, quality: { level: 'mobile', shadows: false } } } });
assert(!result.error, result.error);
const withoutFootprints = result.built;
// The neighbour test now measures the opposing deck where it is built, so it
// clears the covered barrier by itself; the footprint rule remains for pavement
// that is not a neighbouring deck at all.
assert(!barrierAt(126.13, 120.38, withoutFootprints), 'the built-edge neighbour test alone clears the covered barrier');
assert(barrierAt(114.31, 120.38, withoutFootprints), 'and keeps the median where the decks are only alongside');
console.log('PASS the opposing deck is measured where it is built, with or without the pavement index');
