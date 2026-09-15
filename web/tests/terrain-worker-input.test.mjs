import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { serialize } from 'node:v8';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { serveStatic } from '../src/lib/server/static.js';
import { terrainWorkerInput, emptyTerrainPixels, terrainTexturePixels, updateTerrainTexture } from '../static/world/assets/terrain-worker-input.js';

const worker = readFileSync(new URL('mask.worker-xVmTzvog.js', assets), 'utf8');
function paint(request) {
  const commands = [];
  let response;
  class Canvas {
    getContext() {
      return new Proxy({
        getImageData(_x, _y, w, h) { return { data: new Uint8ClampedArray(w * h * 4).fill(commands.length % 256) }; },
      }, {
        get: (target, name) => target[name] ?? ((...args) => commands.push([name, ...args])),
        set(target, name, value) { commands.push([name, value]); target[name] = value; return true; },
      });
    }
  }
  const scope = vm.createContext({ OffscreenCanvas: Canvas, console,
    self: { postMessage: value => { response = value; } } });
  vm.runInContext(worker, scope);
  scope.self.onmessage({ data: structuredClone(request) });
  assert(!response.error, response.error);
  return { commands, data: response.data };
}

let beforeTotal = 0, afterTotal = 0;
for (const key of ['0_0', '19_-40', '13_-42']) {
  const response = await serveStatic(`world/world/tiles/${key}.json.gz`);
  assert.equal(response.status, 200);
  const tile = JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())));
  const world = { roadsNear: () => tile.streetContext.roads, buildingsNear: () => tile.buildings };
  const full = { id: 1, tile, roads: world.roadsNear(), buildings: world.buildingsNear() };
  const compact = terrainWorkerInput(1, tile, world);
  const a = paint(full), b = paint(compact);
  assert.deepEqual(b.commands, a.commands, `${key}: identical Canvas2D draw operations`);
  assert.deepEqual(Buffer.from(b.data), Buffer.from(a.data), `${key}: identical mask channel assembly`);
  assert.equal(compact.tile.streetContext, undefined);
  assert.equal(compact.tile.buildings, undefined);
  assert.equal(compact.tile.trees, undefined);
  const before = serialize(full).byteLength, after = serialize(compact).byteLength;
  assert(after < before, `${key}: worker message excludes unrelated tile data`);
  beforeTotal += before; afterTotal += after;
  console.log(`Terrain worker ${key}: ${before} -> ${after} serialized bytes`);
}

const noPark = { key: '0_0', tx: 0, tz: 0, parks: [], water: [] };
const noQueries = { roadsNear() { throw Error('unneeded road query'); }, buildingsNear() { throw Error('unneeded building query'); } };
assert.deepEqual(terrainWorkerInput(1, noPark, noQueries).roads, []);
// A coastal mask still paints its water, with no neighboring road/building query.
const coastal = { ...noPark, water: [[[[0, 0], [256, 0], [256, 256], [0, 0]]]] };
assert(paint(terrainWorkerInput(1, coastal, noQueries)).commands.length > 0);

// Drive the served dispatcher: empty land never starts a worker, and goes
// through the same ground/publication job as masks received from a worker.
const source = readFileSync(new URL('environment-WQwLg8tn.js', assets), 'utf8');
const start = source.indexOf('function z(){if(O&&E)'), end = source.indexOf('let ee=[', start);
const record = { tile: noPark, mask: null, revision: 1, job: {} };
const committed = [];
const scope = vm.createContext({ O: null, E: null, T: { postMessage() { throw Error('empty masks need no worker'); } },
  x: new Set(['0_0']), b: new Map([['0_0', record]]),
  e: { camera: { position: { x: 0, z: 0 } }, world: noQueries },
  $canBuildMask: () => true, $beginMaskBuild() {}, $emptyTerrainPixels: emptyTerrainPixels,
  R: (...args) => committed.push(args),
});
vm.runInContext(source.slice(start, end), scope); scope.z();
assert.equal(committed.length, 1);
assert.equal(committed[0][0], record);
assert.equal(committed[0][1], emptyTerrainPixels());
assert.equal(scope.x.size, 0);
assert.equal(scope.E, null);

// Exercise the served commit generator, including repainting across sizes.
const commitStart = source.indexOf('function R(e,n,r)'), commitEnd = source.indexOf('function z(){', commitStart);
class Texture {
  disposals = 0;
  constructor(data, width, height) { this.image = { data, width, height }; }
  dispose() { this.disposals++; }
}
const commitScope = vm.createContext({ $terrainTexturePixels: terrainTexturePixels, $updateTerrainTexture: updateTerrainTexture,
  g: Texture, D: 1, te: 1, j: 1, d: { addTile: () => ({ mat: {}, mesh: {} }), setTileLoaded() {} },
  l() {}, y() {}, u: { build: () => null }, t: () => null,
});
vm.runInContext(source.slice(commitStart, commitEnd), commitScope);
let steps;
const job = { pending: true, run: value => { steps = value; } };
const rec = { tile: noPark, mask: null };
const empty = emptyTerrainPixels();
assert.equal(empty.length, 512 * 512 * 4, 'CPU surface grid keeps its indexing contract');
assert.equal(empty[empty.length - 1], 0);
commitScope.R(rec, empty, job);
const texture = steps.next().value;
assert.equal(texture.image.data.byteLength, 4, 'empty GPU mask uploads one texel instead of 1 MiB');
while (!steps.next().done) {}
assert.equal(rec.mask.data, empty);
const full = new Uint8ClampedArray(512 * 512 * 4).fill(255);
for (const data of [full, empty]) {
  commitScope.R(rec, data, job);
  steps.next().value.prepare();
  while (!steps.next().done) {}
  assert.equal(rec.mask.tex.image.width, data === empty ? 1 : 512);
  assert.equal(rec.mask.data, data);
}
assert.equal(texture.disposals, 2, 'size changes release the previous GPU allocation');
console.log(`PASS terrain worker input: ${Math.round((1 - afterTotal / beforeTotal) * 100)}% fewer serialized bytes across three real tiles; identical painter commands, empty tile bypass and GPU upload sizes`);
