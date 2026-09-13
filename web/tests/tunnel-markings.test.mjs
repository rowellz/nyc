import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { assets } from './sveltekit-assets.mjs';
import { serveStatic } from '../src/lib/server/static.js';

const tunnels = await import(new URL('tunnels.js', assets));
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
const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 12,
  lanes: 3, oneway: true, layer: 0, bridge: false, tunnel: false, ...extra });
const bore = road(1, [[20, 128], [140, 128]], { tunnel: true, layer: -1 });
const approach = road(2, [[140, 128], [400, 128]]);
const tile = { key: '0_0', tx: 0, tz: 0, roads: [bore, approach], buildings: [], roadbeds: [],
  sidewalks: [], medians: [], parks: [], water: [], parking: [], plazas: [], crossings: [], trees: [], props: [] };
const built = await build(tile);
assert.equal(tunnels.surfaceMarkingAllowed(tile.roads, approach, 160, 128), false);
assert.equal(tunnels.surfaceMarkingAllowed(tile.roads, approach, 350, 128), true,
  'the same approach resumes ordinary markings after reaching street level');
const marks = triangles(built.meshes[2]);
const center = tri => [0, 1, 2].map(axis => tri.reduce((sum, p) => sum + p[axis] / 3, 0));
const phantom = marks.filter(tri => {
  const [x, y, z] = center(tri);
  return x > 145 && x < 170 && Math.abs(z - 128) < 6 && y > -.1;
});
assert.equal(phantom.length, 0, 'buried approach must not also emit its lane paint at street level');
const structure = built.meshes[3];
assert(triangles(structure).some((tri, i) => {
  const [x, y] = center(tri);
  const color = structure.attributes.color?.data;
  return x > 145 && x < 170 && y < -5 && tri.every(p => Math.abs(p[1] - y) < 1)
    && color && color[structure.index[i * 3] * 3] > .8;
}), 'the tunnel builder retains its painted lines down on the graded road');

// A real surface road crossing above the bore retains its own paint.
const crossing = road(3, [[170, 20], [170, 235]], { cls: 'secondary', lanes: 2, width: 8 });
const crossingBuilt = await build({ ...tile, roads: [...tile.roads, crossing] });
assert(triangles(crossingBuilt.meshes[2]).some(tri => {
  const [x, y, z] = center(tri);
  return Math.abs(x - 170) < 4 && Math.abs(z - 128) < 5 && y > 0 && y < .1;
}), 'surface crossing paint is not removed merely because a tunnel passes beneath it');

// Actual west-side Trans-Manhattan approach: paint was left at y=0.032 while
// its owning road descended to roughly -6.5 m. Test final served worker bytes.
const real = JSON.parse(gunzipSync(Buffer.from(await (await serveStatic('world/world/tiles/14_-42.json.gz')).arrayBuffer())));
const actual = await build({ ...real, crossings: real.streetContext.crossings }, real.streetContext.roads);
const point = [3664.79191, -10555.93490];
assert(!triangles(actual.meshes[2]).some(tri => {
  const h = triangleHeight(tri, ...point);
  return h?.inside && h.height > -.1 && h.height < .1;
}), 'real approach 8119436000 has no duplicate street-level lane stripe');
console.log('PASS tunnel approach paint ownership, retained surface crossing and actual Trans-Manhattan duplicate stripe');
