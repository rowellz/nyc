import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { sceneBuildBudgetMs, nextSceneBuild, nextBuildingTile } from '../static/world/assets/mobile-build-policy.js';
import { mobilePerformanceAssetPaths } from '../src/lib/server/mobile-performance-assets.js';
import { serveStatic } from '../src/lib/server/static.js';
import { CLIENT_REVISION, versionClientImports } from '../src/lib/server/client-cache.js';
import { addonsFor } from '../src/lib/server/client-addons.js';

const loading = readFileSync(new URL('loading-DS_gLujL.js', assets), 'utf8')
  .replace(/^import .*\n/gm, '').replace(/export\{[^}]+\};/, '');

// Drive the actual building dispatcher: travel priority applies before worker
// construction too, with an oldest-job turn so distant buildings still finish.
for (const [level, fastTravel, expectedSteps] of [['mobile', true, 1], ['mobile', false, 3], ['high', true, 3]]) {
  const f = queueFixture(level);
  f.ctx.world.stats = { fastTravel };
  let steps = 0;
  f.scope.job('streets:0_0').run((function* () {
    for (let i = 0; i < 20; i++) { f.cost(); steps++; yield; }
  })());
  await f.frame();
  assert.equal(steps, expectedSteps, 'fast mobile travel reserves more of the frame for rendering');
  for (let i = 0; i < 25; i++) await f.frame();
  assert.equal(f.ctx.busy, 0, 'reduced budget still completes scene work');
}

for (const level of ['mobile', 'high']) {
  const source = readFileSync(new URL('buildings-BDmduZ8y.js', assets), 'utf8');
  const from = source.indexOf('function P(){'), to = source.indexOf('function F(', from);
  assert(from > 0 && to > from);
  const context = { quality: { level }, world: { tilePriority: tx => tx } };
  const rec = tx => ({ key: `${tx}_0`, tile: { tx, tz: 0 }, job: { pending: true } });
  const far = rec(10), near = rec(0), next = rec(1);
  const queue = [far, next, near], sent = [];
  const slot = { busy: false, w: { postMessage: m => sent.push(m.input.tx) } };
  const records = new Map(queue.map(r => [r.key, r]));
  const sandbox = vm.createContext({ D: queue, E: [slot], v: records, O: 0, k: new Map(),
    N: r => r.tile, $buildingContext: context, $nextBuildingTile: nextBuildingTile });
  vm.runInContext(source.slice(from, to), sandbox);
  sandbox.P();
  assert.equal(sent[0], level === 'mobile' ? 0 : 10);
  if (level === 'mobile') {
    slot.busy = false; sandbox.P();
    assert.equal(sent[1], 1);
    for (let i = 0; i < 2; i++) {
      const urgent = rec(-i - 1); records.set(urgent.key, urgent); queue.push(urgent);
      slot.busy = false; sandbox.P();
    }
    assert.equal(sent[2], -1);
    assert.equal(sent[3], 10, 'fourth dispatch advances the oldest background tile');
  }
}

{
  const ctx = { quality: { level: 'mobile' }, world: { tilePriority: tx => Math.abs(tx) } };
  const item = label => ({ label, job: { pending: true } });
  const oldest = item('buildings:10_0'), current = item('environment mask 0_0');
  assert.equal(nextSceneBuild([oldest, current], ctx, 3), current, 'nearby terrain bypasses distant queued building commits');
  assert.equal(nextSceneBuild([oldest, current], ctx, 15), oldest, 'background FIFO turn prevents starvation');
}

// The crowd's startup deadline must not stretch with slow rendering. Exercise
// the shipped population gate with very little simulated time but 4s wall time.
{
  const character = readFileSync(new URL('character-O1u3Gxpp.js', assets), 'utf8');
  const start = character.indexOf('this.populationPending&&(this.populationTime+=');
  const end = character.indexOf(',this.carTime-=', start);
  assert(start > 0 && end > start);
  let clock = 0;
  const gate = vm.runInNewContext(`(function(e,a){${character.slice(start, end)}})`, { performance: { now: () => clock } });
  const crowd = level => ({ ctx: { quality: { level }, busy: 1 }, populationPending: true,
    populationTime: 0, populationStarted: 0, densityScale: 1, parkTarget: 0,
    walkerCount: () => 0, parkOccupied: () => 0,
    finishPopulation() { this.populationPending = false; this.ctx.busy--; } });
  const mobile = crowd('mobile'), desktop = crowd('high');
  clock = 3999; gate.call(mobile, 0.01, 0);
  assert(mobile.populationPending, 'startup still gives pedestrians a grace period');
  clock = 4000; gate.call(mobile, 0.01, 0); gate.call(desktop, 0.01, 0);
  assert.equal(mobile.ctx.busy, 0, 'slow mobile frames cannot hold the HUD behind crowd spawning');
  assert(desktop.populationPending, 'desktop retains its existing simulated-time deadline');
  gate.call(mobile, 0.01, 0);
  assert.equal(mobile.ctx.busy, 0, 'startup busy count is released once');
  const ready = crowd('mobile'); ready.walkerCount = () => 2;
  clock = 5; gate.call(ready, 0.01, 2);
  assert(!ready.populationPending, 'a complete crowd still finishes immediately');
}

// Drive the actual street worker dispatcher through a burst of tile arrivals.
{
  let clock = 0;
  const sent = [];
  const source = readFileSync(new URL('streets-CfYSUqyW.js', assets), 'utf8');
  const from = source.indexOf('function $(){');
  const to = source.indexOf('function*ne(', from);
  assert(from > 0 && to > from);
  const policy = readFileSync(new URL('mobile-build-policy.js', assets), 'utf8').replace(/^export /gm, '');
  const ctx = { quality: { level: 'mobile' }, camera: { position: { x: 0, z: 0 } },
    world: { tilePriority: tx => tx } };
  const dirty = new Set(), active = new Map();
  const workers = [0, 1].map(slot => ({ postMessage: request => sent.push({ ...request, slot }) }));
  const sandbox = vm.createContext({ performance: { now: () => clock },
    V: workers[0], W: workers, G: active, z: dirty, e: ctx, j: 0,
    te: rec => rec.tile, Y: response => { throw Error(response.error); } });
  vm.runInContext(policy + '\nconst $canBuildStreet=canBuildStreet,$beginStreetBuild=beginStreetBuild;' + source.slice(from, to), sandbox);
  const rec = tx => ({ tile: { tx, tz: 0, key: `${tx}_0` }, revision: 0, job: { pending: true } });
  const near = rec(0), ahead = rec(1);
  function change(tile) { tile.revision++; sandbox.markStreetDirty(tile); dirty.add(tile); }
  change(near);
  for (clock = 0; clock < 100; clock += 20) { change(near); sandbox.$(); }
  assert.equal(sent.length, 0, 'a burst of arrivals produces no intermediate rebuilds');
  clock = 180; sandbox.$();
  assert.equal(sent.length, 1, 'latest revision builds when the burst settles');
  assert.equal(active.get(sent[0].id).revision, near.revision);
  clock = 200; change(near); change(ahead);
  clock = 310; sandbox.$();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].input.key, '1_0', 'second worker advances another tile instead of duplicating an active motorway');
  active.delete(sent[0].id);
  sandbox.$();
  assert.equal(sent.length, 3);
  assert.equal(sent[2].input.key, '0_0', 'invalidated revision is rebuilt after the old worker finishes');
  assert.equal(active.get(sent[2].id).revision, near.revision);
  active.clear(); dirty.clear();
  const continuous = rec(2);
  for (clock = 400; clock <= 800; clock += 20) { change(continuous); sandbox.$(); }
  assert.equal(sent.length, 4, '400ms maximum wait prevents starvation during continuous streaming');
  active.clear(); dirty.clear();
  ctx.quality.level = 'high';
  change(rec(3)); sandbox.$();
  assert.equal(sent.length, 5, 'desktop does not acquire the mobile settle delay');
}

function queueFixture(level = 'mobile') {
  let time = 0, frames = [], frameNumber = 0;
  const uploads = [];
  const ctx = { quality: { level }, busy: 0, world: { tilePriority: tx => Math.abs(tx) },
    renderer: { initTexture: texture => uploads.push({ texture, frame: frameNumber }) } };
  const sandbox = vm.createContext({ Promise, console, $sceneBuildBudgetMs: sceneBuildBudgetMs, $nextSceneBuild: nextSceneBuild,
    performance: { now: () => time }, requestAnimationFrame: fn => { frames.push(fn); return 1; } });
  vm.runInContext(loading + '\nglobalThis.buildScope=n;', sandbox);
  const scope = sandbox.buildScope(ctx);
  async function frame() {
    frameNumber++;
    const callbacks = frames; frames = [];
    for (const fn of callbacks) fn();
    assert(uploads.filter(u => u.frame === frameNumber).length <= 1, 'one upload per frame');
    await Promise.resolve();
  }
  return { ctx, scope, frame, uploads, cost: () => { time += 1; } };
}

for (const level of ['mobile', 'high']) {
  const f = queueFixture(level), order = [];
  for (let i = 0; i < 60; i++) f.scope.job(`buildings:${i}_0`).run((function* () {
    for (let n = 0; n < 6; n++) { f.cost(); order.push(`building:${i}`); yield; }
  })());
  let roadDone = false;
  f.scope.job('streets:0_0').run((function* () {
    for (let i = 0; i < 12; i++) { f.cost(); order.push('road'); yield; }
    roadDone = true;
  })());
  for (let i = 0; i < 7; i++) await f.frame();
  if (level === 'mobile') {
    assert(roadDone, 'near road publishes despite sixty active building commits');
    assert(order.includes('building:0'), 'buildings make progress while roads are busy');
  } else {
    assert.equal(order[0], 'building:0', 'desktop retains FIFO scheduling');
    assert(!roadDone);
  }
  f.scope.dispose();
  assert.equal(f.ctx.busy, 0, 'cancellation drains busy exactly once');
  await f.frame();
  assert.equal(f.ctx.busy, 0);
}

{
  const f = queueFixture();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let finalized = 0, finished = 0;
  const job = f.scope.job('streets:0_0');
  job.run((function* () {
    try { yield pending; finished++; } finally { finalized++; }
  })());
  await f.frame();
  job.cancel(); job.cancel(); release();
  await Promise.resolve(); await f.frame();
  assert.equal(finalized, 1);
  assert.equal(finished, 0, 'cancelled shader compilation never republishes');
  assert.equal(f.ctx.busy, 0);
  for (let i = 0; i < 3; i++) f.scope.job(`streets:${i}_0`).run((function* () { yield { name: i }; })());
  for (let i = 0; i < 6; i++) await f.frame();
  assert.equal(f.uploads.length, 3);
  assert.equal(f.ctx.busy, 0);
}

// Real procedural generators and packing run in the served worker. Canvas
// drawing is stubbed; pixel array dimensions and all data textures are real.
class Canvas {
  constructor(width, height) { Object.assign(this, { width, height }); }
  getContext() {
    const pixels = (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    return new Proxy({
      createImageData: pixels, getImageData: (_x, _y, w, h) => pixels(w, h),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
      measureText: () => ({ width: 20 }),
    }, { get: (target, key) => target[key] ?? (() => {}) });
  }
}
{
  let result, fetched = 0;
  const sandbox = vm.createContext({ console, performance, OffscreenCanvas: Canvas,
    fetch: () => { fetched++; throw Error('mobile should use the drawn decal'); },
    createImageBitmap: async image => ({ width: image.width, height: image.height, close() {} }),
    self: { postMessage: message => { result = message; } } });
  const worker = readFileSync(new URL('tile.worker-Ai2ZdmRL.js', assets), 'utf8');
  for (const [, bindings, path] of worker.matchAll(/import \{([^}]+)\} from '([^']+)'/g)) {
    const module = await import(new URL(path, assets));
    for (const binding of bindings.split(',')) {
      const [name, alias = name] = binding.trim().split(/\s+as\s+/);
      sandbox[alias] = module[name];
    }
  }
  vm.runInContext(worker.replace(/^import .*\n/gm, ''), sandbox);
  await sandbox.self.onmessage({ data: { type: 'textures', quality: 'mobile', aniso: 8, skip: {} } });
  assert(!result.error, result.error);
  assert.equal(fetched, 0);
  const textures = result.textures;
  for (const name of ['concrete', 'granite']) {
    for (const kind of ['albedo', 'normal', 'rough']) {
      const texture = textures[name][kind];
      if (!texture) continue;
      assert.equal(texture.image.width, 64);
      assert.equal(texture.image.height, 64);
      assert.equal(texture.image.data.byteLength, 64 * 64 * 4);
      assert.equal(texture.anisotropy, 1);
      assert(texture.generateMipmaps);
    }
  }
  assert.equal(textures.noise.image.width, 32);
  assert.equal(textures.noise.anisotropy, 1);
  assert.equal(textures.atlas.image.width, 256, 'paint atlas retains extra resolution for legibility');
  assert.equal(textures.atlas.anisotropy, 1);
  for (const name of ['asphalt', 'cobble']) {
    for (const texture of Object.values(textures[name]).filter(t => t?.image)) {
      assert.equal(texture.image.width, 1, 'unused road maps are only packing placeholders');
      assert.equal(texture.image.data.byteLength, 4);
    }
  }
  assert.equal(textures.asphalt2.image.width, 1);
}

for (const rel of mobilePerformanceAssetPaths) {
  const response = await serveStatic(rel);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), readFileSync(new URL(rel.split('/').pop(), assets), 'utf8'));
}
{
  const html = await (await serveStatic('world/index.html', { transform: addonsFor('world/index.html') })).text();
  assert(html.includes(`index-DQv-X5z6.js?v=${CLIENT_REVISION}`), 'reload bypasses the old immutable entry cache');
  assert(html.includes(`mobile-map.js?v=${CLIENT_REVISION}`), 'traffic control revision is delivered with the page');
  const entry = readFileSync(new URL('index-DQv-X5z6.js', assets), 'utf8');
  assert(entry.includes(`main-D_3aygO4.js?v=${CLIENT_REVISION}`), 'entry imports the new streamer');
  const main = readFileSync(new URL('main-D_3aygO4.js', assets), 'utf8');
  assert(main.includes(`streets-CfYSUqyW.js?v=${CLIENT_REVISION}`), 'dynamic modules share the new import graph');
  const streets = readFileSync(new URL('streets-CfYSUqyW.js', assets), 'utf8');
  assert(streets.includes(`tile.worker-Ai2ZdmRL.js?v=${CLIENT_REVISION}`), 'worker URL bypasses the old cache');
  assert.equal(versionClientImports(streets), streets, 'versioning is idempotent');
}
console.log('PASS mobile street textures, road commit priority, background fairness, cancellation, upload budget and serving');
