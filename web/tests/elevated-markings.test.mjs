import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { assets } from './sveltekit-assets.mjs';
import { serveStatic } from '../src/lib/server/static.js';

const { triangleHeight } = await import(new URL('supports.js', assets));
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
async function build(tile, roads = tile.roads) {
  await scope.self.onmessage({ data: { id: 1, input: { tile, roads,
    pedestrianTiles: tile.streetContext?.pedestrianTiles ?? [tile], quality: { level: 'mobile', shadows: false } } } });
  assert(!response.error, response.error);
  return response.built;
}
function triangles(mesh) {
  if (!mesh) return [];
  return Array.from({ length: mesh.index.length / 3 }, (_, i) => [0, 1, 2].map(j => {
    const offset = mesh.index[i * 3 + j] * 3;
    return Array.from(mesh.attributes.position.data.slice(offset, offset + 3));
  }));
}

const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 12, lanes: 3,
  oneway: true, layer: 1, bridge: true, tunnel: false, ...extra });
const bore = road(1, [[20, 128], [140, 128]], { tunnel: true, bridge: false, layer: -1 });
const approach = road(2, [[140, 128], [400, 128]], { bridge: false, layer: 0 });
const bridge = road(3, [[400, 128], [1000, 128]]);
const roads = [bore, approach, bridge];
const tile = { key: '2_0', tx: 2, tz: 0, roads, buildings: [], roadbeds: [], sidewalks: [], medians: [],
  parks: [], water: [], parking: [], plazas: [], crossings: [], trees: [], props: [] };
const built = await build(tile);
function groundTunnelPaint(built) {
  const mesh = built.meshes[3], color = mesh?.attributes.color?.data;
  return triangles(mesh).filter((tri, i) => color?.[mesh.index[i * 3] * 3] > .8
    && tri.every(p => p[1] > 0 && p[1] < .1));
}
assert.equal(groundTunnelPaint(built).length, 0,
  'an elevated tunnel approach must not receive a second set of tunnel stripes at ground level');
assert(triangles(built.meshes[2]).some(tri => tri.every(p => p[1] > 6)),
  'lane markings remain on the elevated deck');
assert(scope.$tunnelNetwork(roads).get(bridge.id).elevation,
  'the tunnel renderer sees the elevations published by the road planner');

const real = JSON.parse(gunzipSync(Buffer.from(await (await serveStatic('world/world/tiles/17_-40.json.gz')).arrayBuffer())));
const actual = await build({ ...real, crossings: real.streetContext.crossings }, real.streetContext.roads);
// Centre of a phantom tunnel stripe from the reported interchange. Keep actual
// ground roads intact; only this elevated approach's duplicate should disappear.
const point = [4358.427571614583, -10182.798177083334];
assert(!groundTunnelPaint(actual).some(tri => triangleHeight(tri, ...point)?.inside),
  'Highbridge elevated approach has no duplicate ground-level tunnel stripe');
assert(triangles(actual.meshes[0]).some(tri => {
  const sample = triangleHeight(tri, ...point);
  return sample?.inside && sample.height > 1;
}), 'the real regression point remains covered by elevated pavement');
assert(triangles(actual.meshes[2]).some(tri => tri.every(p => p[1] > 6)),
  'Highbridge retains its elevated road paint');
console.log('PASS elevated approach paint ownership in the served worker and actual Highbridge tile');
