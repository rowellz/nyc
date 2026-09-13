import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { correctStreetTile } from '../src/lib/server/street-corrections.js';
import { createStreetTileService } from '../src/lib/server/street-context.js';
import { serveStatic } from '../src/lib/server/static.js';
import { assets } from './sveltekit-assets.mjs';

const LOOP = 165423253000;
const directory = new URL('../../public/world/world/tiles/', import.meta.url);
const readTile = key => JSON.parse(gunzipSync(readFileSync(new URL(`${key}.json.gz`, directory))));
const original = readTile('13_-42'), neighbor = readTile('13_-41');
assert(original.roads.some(r => r.id === LOOP), 'fixture includes the reported turnaround');
const corrected = correctStreetTile(original);
assert.deepEqual(correctStreetTile(corrected), corrected, 'correction is idempotent');
assert.deepEqual(original, readTile('13_-42'), 'the mirrored map is unchanged');
assert.deepEqual(corrected.roads, original.roads.filter(r => r.id !== LOOP), 'all other road shapes and connections are retained');
assert.equal(correctStreetTile(neighbor), neighbor, 'unrelated tile records are unchanged');

function inRing([x, z], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}
const covered = (tile, point) => tile.roadbeds.some(poly => inRing(point, poly[0]) && !poly.slice(1).some(ring => inRing(point, ring)));
for (const point of [[3377, -10518], [3378, -10530], [3381, -10540]]) {
  assert(covered(original, point), `original loop asphalt at ${point}`);
  assert(!covered(corrected, point), `loop asphalt removed at ${point}`);
}
for (const id of [160061999000, 1086766006000]) {
  for (const point of corrected.roads.find(r => r.id === id).pts.filter(([, z]) => z >= -10604))
    assert(covered(corrected, point), `Riverside Drive retains asphalt at ${point}`);
}

const response = await serveStatic('world/world/tiles/13_-42.json.gz');
assert.equal(response.status, 200);
const served = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())));
const { streetContext, ...scene } = served;
assert.deepEqual(scene, corrected);
assert(!streetContext.roads.some(r => r.id === LOOP), 'worker and traffic context exclude the loop');
const adjacent = JSON.parse(gunzipSync(Buffer.from(await (await serveStatic('world/world/tiles/13_-41.json.gz')).arrayBuffer())));
assert(!adjacent.streetContext.roads.some(r => r.id === LOOP), 'neighboring tiles cannot rebuild the removed loop');
const { streetContext: adjacentContext, ...adjacentScene } = adjacent;
assert.deepEqual(adjacentScene, neighbor, 'neighbor scene ownership is unchanged');
console.log('PASS served scene/context, neighboring ramps, and ground asphalt correction');

// Even a prepared catalog made from the original map must not put the removed
// road back into a neighbor's planning data.
const temp = mkdtempSync(`${tmpdir()}/nyc-street-correction-`);
try {
  const catalogPath = `${temp}/road-index.json`;
  writeFileSync(catalogPath, JSON.stringify({ version: 1, keys: [original.key, neighbor.key], roads: [...original.roads, ...neighbor.roads] }));
  const service = createStreetTileService(directory.pathname, { catalogPath });
  for (const tile of [original, neighbor]) {
    const result = JSON.parse(gunzipSync(await service(tile.key)));
    assert(!result.roads.some(r => r.id === LOOP));
    assert(!result.streetContext.roads.some(r => r.id === LOOP));
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
console.log('PASS prepared catalogs apply the same map correction');

// Run the real worker with the complete served planning neighborhood. Check
// the road-owned collision/deck output, not just the serialized map records.
const worker = readFileSync(new URL('tile.worker-Ai2ZdmRL.js', assets), 'utf8');
const scope = { console, performance, self: { postMessage: reply => { scope.reply = reply; } } };
for (const match of worker.matchAll(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?$/gm)) {
  const module = await import(new URL(match[2], assets));
  for (const binding of match[1].split(',')) {
    const [name, alias = name] = binding.trim().split(/\s+as\s+/); scope[alias] = module[name];
  }
}
vm.createContext(scope); vm.runInContext(worker.replace(/^import .*$/gm, ''), scope);
const tile = { ...served, buildings: [], parks: [], trees: [], props: [] };
await scope.self.onmessage({ data: { id: 1, input: { tile, roads: streetContext.roads,
  pedestrianTiles: streetContext.pedestrianTiles, quality: { level: 'mobile', shadows: false } } } });
assert(!scope.reply.error, scope.reply.error);
const { roadDeckTriangles } = await import(new URL('supports.js', assets));
const { decks } = scope.reply.built;
assert.equal(roadDeckTriangles(decks, LOOP).length, 0, 'no phantom loop driving/collision surface');
for (const id of [160061999000, 1086766006000, 1133431620000, 46587573000])
  assert(roadDeckTriangles(decks, id).length > 0, `remaining Riverside/highway deck ${id} is still built`);
console.log('PASS actual worker removes the loop deck and retains Riverside Drive and highway ramps');
