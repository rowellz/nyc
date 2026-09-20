import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { assets } from './sveltekit-assets.mjs';
import { serveStatic } from '../src/lib/server/static.js';
import { CLIENT_REVISION, versionClientImports } from '../src/lib/server/client-cache.js';

// Keep the served shoulder and taper corrections, but compare the spatial
// lookup with the exhaustive sibling scan it replaces.
const reference = readFileSync(new URL('lane-layout.js', assets), 'utf8').replace(
  'for(const i of cells.get(`${Math.floor(p.x/GORE_NEAR)},${Math.floor(p.z/GORE_NEAR)}`)??[]){',
  'for(let i=1;i<other.length;i++){');
writeFileSync(new URL('lane-layout-reference.js', assets), reference);
const { highwayLayout: originalLayout } = await import(new URL('lane-layout-reference.js', assets));
const { highwayLayout, isHighway } = await import(new URL('lane-layout.js', assets));
const { worldTunnels, tunnelHoles, tunnelWaterHoles } = await import(new URL('tunnels.js', assets));
for (const [label, tx, tz] of [['GWB', 13, -42], ['Cross Bronx', 19, -40]]) {
  const tiles = [];
  for (let x = tx - 1; x <= tx + 1; x++) for (let z = tz - 1; z <= tz + 1; z++) {
    const response = await serveStatic(`world/world/tiles/${x}_${z}.json.gz`);
    assert.equal(response.status, 200);
    tiles.push(JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer()))));
  }
  const roads = [...new Map(tiles.flatMap(t => [...t.streetContext.roads, ...t.roads]).map(r => [r.id, r])).values()];
  let stations = 0;
  for (const road of roads.filter(isHighway)) {
    const before = originalLayout(road, roads), after = highwayLayout(road, roads);
    assert.equal(after.phase, before.phase);
    for (let s = 0; s <= before.length; s += 2) {
      for (const side of [0, 1]) {
        assert.equal(after.edge(s, side), before.edge(s, side));
        assert.equal(after.open(s, side), before.open(s, side));
      }
      for (let lane = 0; lane <= before.count; lane += .5)
        assert.equal(after.offset(s, lane), before.offset(s, lane));
      stations++;
    }
  }
  const world = { tiles: new Map(tiles.map(t => [t.key, t])) };
  const start = performance.now(), before = worldTunnels(world);
  const coldMs = performance.now() - start;
  const ground = tunnelHoles(before), water = tunnelWaterHoles(before);
  assert(ground.length && water.length);
  const approach = [...before.values()].find(p => p.approach);
  const edges = approach.edges;
  tiles[0].approachProfiles = [];
  const updateStart = performance.now(), after = worldTunnels(world);
  const updateMs = performance.now() - updateStart;
  assert.notEqual(after, before, 'new worker elevations invalidate terrain profiles');
  assert.equal(after.get(approach.road.id).edges, edges, 'elevation publication reuses the exact lane plan');
  assert.deepEqual(tunnelHoles(after), ground);
  assert.deepEqual(tunnelWaterHoles(after), water);
  tiles[0].approachProfiles = [{ id: approach.road.id, points: [{ s: 0, h: -4, x: 0, z: 0 },
    { s: approach.length, h: -2, x: 1, z: 1 }] }];
  assert.equal(worldTunnels(world).get(approach.road.id).elevation[0].h, -4);
  tiles[0].approachProfiles = [];
  assert.equal(worldTunnels(world).get(approach.road.id).elevation, undefined, 'removed elevations cannot survive through the lane cache');
  tiles[0].streetContext = { ...tiles[0].streetContext, roads: tiles[0].streetContext.roads.slice() };
  assert.notEqual(worldTunnels(world).get(approach.road.id).edges, edges, 'replacing road context invalidates the lane plan');
  console.log(`PASS ${label}: ${stations} identical lane stations, stable cuts, lane reuse and invalidation; network ${coldMs.toFixed(1)} ms, elevation update ${updateMs.toFixed(1)} ms`);
}
for (const asset of ['edges', 'lane-layout'])
  assert(versionClientImports(`import './${asset}.js';`).includes(`${asset}.js?v=${CLIENT_REVISION}`));
