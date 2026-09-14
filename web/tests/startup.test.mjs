import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { assets } from './sveltekit-assets.mjs';
import { createStreetTileService } from '../src/lib/server/street-context.js';
import { preferredEncoding } from '../src/lib/server/precompressed.js';

// Run the served iOS entry and its actual policy with controllable frames.
const main = await readFile(new URL('main-D_3aygO4.js', assets), 'utf8');
const start = main.indexOf('async function de(){await $startDeferredModules(');
const end = main.indexOf('let fe=', start);
assert(start > 0 && end > start, 'served deferred-module function is identifiable');
const policy = (await readFile(new URL('startup-policy.js', assets), 'utf8')).replace(/^export /gm, '');
const order = ['atmosphere', 'environment', 'streets', 'buildings', 'landmarks', 'props', 'vehicles', 'character', 'combat', 'audio', 'ui'];
for (const screenshotMode of [false, true]) {
  const frames = [], created = [];
  let completed = false, finished = false, clock = 0;
  const scope = vm.createContext({
    Au: order, performance: { now: () => clock },
    requestAnimationFrame: callback => frames.push(callback),
    k: { busy: 1, state: { screenshotMode } }, O: { ready: false, tiles: new Map() }, ve: { running: true },
    ue: async name => { created.push(name); scope.k.busy = 1; },
    h() {}, ce: created, se: { ready: false, modulesCreated() { completed = true; } },
  });
  vm.runInContext(policy + '\nconst $startDeferredModules=startDeferredModules;\n' + main.slice(start, end), scope);
  const task = scope.de().then(() => { finished = true; });
  async function frame() {
    clock += 16;
    for (const callback of frames.splice(0)) callback();
    for (let i = 0; i < 16; i++) await Promise.resolve();
  }
  await frame();
  assert.deepEqual(created, [], 'busy jobs block module creation');
  scope.k.busy = 0;
  await frame();
  assert.deepEqual(created, [], 'near tiles must be ready');
  scope.O.ready = true;
  await frame();
  assert.deepEqual(created, ['environment'], 'next module starts on the next available frame');
  await frame();
  assert.deepEqual(created, ['environment'], 'factory jobs must drain before proceeding');
  assert.equal(completed, false);
  for (let i = 0; i < 100 && !completed; i++) { scope.k.busy = 0; await frame(); }
  assert(completed, 'required scene completes');
  assert(!created.includes('audio'));
  if (!screenshotMode) {
    assert.deepEqual(created, ['environment', 'streets', 'buildings', 'landmarks', 'character', 'combat', 'ui']);
    for (let i = 0; i < 5; i++) await frame();
    assert(!created.includes('props'), 'background jobs do not start until the real ready gate opens');
    assert(!finished);
    scope.se.ready = true;
    for (let i = 0; i < 100 && !finished; i++) { scope.k.busy = 0; await frame(); }
    assert(finished);
    assert.deepEqual(created.slice(-2), ['props', 'vehicles'], 'street furniture precedes traffic after entry');
  } else {
    assert.deepEqual(created, order.slice(1).filter(name => name !== 'audio'), 'screenshots wait for the complete scene');
  }
  await task;
  assert.equal(scope.k.startup.timings.length, created.length);
  assert(scope.k.startup.timings.every(timing => timing.ms >= 16));
  // Nine decoded tiles do not claim 100%, and the message identifies scene work.
  scope.O.tiles = new Map(Array.from({ length: 9 }, (_, n) => [n, {}]));
  scope.k.startup.active = 'streets';
  const progress = scope.startupProgress(scope.k, scope.O);
  assert(progress.fraction < 1);
  assert.match(progress.text, /Preparing roads — 9 tiles loaded/);
  created.length = 0; completed = false;
  scope.ve.running = false;
  const stopped = scope.de();
  await frame(); await stopped;
  assert.equal(created.length, 0, 'stopped loops cannot create another module');
  assert.equal(completed, false);
}
console.log('PASS served iOS startup: required scene, post-entry props/traffic, screenshot completeness, progress and shutdown');

for (const [header, expected] of [
  [undefined, 'identity'], ['', 'identity'], ['br, gzip', 'br'], ['gzip', 'gzip'],
  ['BR;q=1, gzip;q=0.5', 'br'], ['br;q=0, gzip', 'gzip'],
  ['br;q=0.5, gzip;q=0.8, identity;q=0', 'gzip'],
  ['br;q=0.5', 'identity'], ['*', 'br'], ['*;q=0', null],
  ['br;q=0, gzip;q=0, identity;q=0', null], ['zstd', 'identity'],
  ['*;q=0, identity;q=1', 'identity'], ['br;q=wat, gzip', 'gzip'],
]) assert.equal(preferredEncoding(header), expected, String(header));

const generated = await mkdtemp(path.join(tmpdir(), 'nyc-startup-'));
const publicDir = fileURLToPath(new URL('../../public', import.meta.url));
try {
  const { stdout } = await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('../scripts/prepare-world.mjs', import.meta.url)), publicDir, generated,
  ]);
  console.log(stdout.trim());
  process.env.NODE_ENV = 'production';
  process.env.PUBLIC_DIR = publicDir;
  process.env.PREPARED_ASSET_DIR = generated;
  const { serveStatic } = await import('../src/lib/server/static.js');

  // Compare every compressed build artifact with the actual identity response,
  // catching stale transforms, unversioned imports and incorrect encodings.
  async function checkAssets(directory) {
    for (const item of await readdir(path.join(generated, directory), { withFileTypes: true })) {
      const rel = path.join(directory, item.name);
      if (item.isDirectory()) { await checkAssets(rel); continue; }
      if (!rel.endsWith('.br')) continue;
      const asset = rel.slice(0, -3);
      const identity = await serveStatic(asset);
      const plain = Buffer.from(await identity.arrayBuffer());
      assert.equal(identity.headers.get('vary'), 'Accept-Encoding');
      assert.equal(identity.headers.get('content-encoding'), null);
      for (const [encoding, decode] of [['br', brotliDecompressSync], ['gzip', gunzipSync]]) {
        const response = await serveStatic(asset, { acceptEncoding: encoding });
        const encoded = Buffer.from(await response.arrayBuffer());
        assert.equal(response.headers.get('content-encoding'), encoding);
        assert.equal(response.headers.get('content-type'), identity.headers.get('content-type'));
        assert.equal(response.headers.get('cache-control'), identity.headers.get('cache-control'));
        assert.equal(Number(response.headers.get('content-length')), encoded.length);
        assert.deepEqual(decode(encoded), plain, `${asset}: ${encoding} matches serving transforms`);
        const head = await serveStatic(asset, { acceptEncoding: encoding, method: 'HEAD' });
        assert.equal(head.body, null);
        assert.deepEqual([...head.headers], [...response.headers]);
        if (asset.endsWith('main-D_3aygO4.js')) {
          console.log(`main: ${plain.length} bytes identity -> ${encoded.length} bytes ${encoding}`);
          assert(encoded.length < plain.length * .5);
        }
      }
    }
  }
  await checkAssets('world');
  assert.equal((await serveStatic('world/assets/main-D_3aygO4.js', { acceptEncoding: '*;q=0' })).status, 406);
  assert.equal((await serveStatic('../package.json', { acceptEncoding: 'br' })).status, 403);
  assert.equal((await serveStatic('world/missing.js', { acceptEncoding: 'br' })).status, 404);
  const html = await serveStatic('world/index.html', { acceptEncoding: 'br', transform: text => text + '<!-- addon -->' });
  assert.equal(html.headers.get('content-encoding'), null);
  assert((await html.text()).endsWith('<!-- addon -->'));
  console.log('PASS production encoding negotiation, transformed bytes, HEAD, lengths and tile/HTML exclusions');

  const tiles = path.join(publicDir, 'world/world/tiles');
  const scan = createStreetTileService(tiles);
  const prepared = createStreetTileService(tiles, { catalogPath: path.join(generated, 'road-index.json') });
  let began = performance.now();
  const expected = await scan('0_0');
  const scanMs = performance.now() - began;
  began = performance.now();
  const actual = await prepared('0_0');
  const preparedMs = performance.now() - began;
  assert.deepEqual(gunzipSync(actual), gunzipSync(expected));
  // Include cross-tile motorway geometry, not just the spawn neighborhood.
  for (const key of ['19_-40', '11_-43']) {
    const [a, b] = await Promise.all([scan(key), prepared(key)]);
    assert.deepEqual(gunzipSync(a), gunzipSync(b));
  }
  const tile = await serveStatic('world/world/tiles/0_0.json.gz', { acceptEncoding: 'br, gzip' });
  assert.equal(tile.headers.get('content-encoding'), null);
  assert.equal(tile.headers.get('content-type'), 'application/gzip');
  assert.deepEqual(gunzipSync(Buffer.from(await tile.arrayBuffer())), gunzipSync(expected));
  const head = await serveStatic('world/world/tiles/0_0.json.gz', { method: 'HEAD', acceptEncoding: 'br' });
  assert.equal(head.body, null);
  assert.deepEqual([...head.headers], [...tile.headers]);
  console.log(`PASS road catalog matches full scan: cold tile ${scanMs.toFixed(0)} ms scan / ${preparedMs.toFixed(0)} ms prepared`);
} finally {
  await rm(generated, { recursive: true, force: true });
}
