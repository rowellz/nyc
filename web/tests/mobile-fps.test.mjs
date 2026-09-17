import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { createResolutionController, createMobileFrameBudget, resizeDrawingBuffer } from '../static/world/assets/mobile-frame-budget.js';
import { serveStatic } from '../src/lib/server/static.js';
import { CLIENT_REVISION } from '../src/lib/server/client-cache.js';

function replay(initial = .85) {
  let now = 0;
  const changes = [];
  const sample = createResolutionController(initial, ratio => changes.push({ ratio, now }));
  sample(now);
  return { changes, sample,
    run(ms, hz, active = true) {
      const end = now + ms;
      while (now < end) { now += 1000 / hz; sample(now, active); }
    },
  };
}
{
  const f = replay();
  f.run(30000, 60);
  assert.equal(f.changes.length, 0, 'steady 60 Hz causes no reallocations');
  f.run(12000, 30);
  assert.deepEqual(f.changes.map(c => c.ratio), [.75, .65], 'sustained slow frames reach a bounded floor');
  f.run(20000, 30);
  assert.equal(f.changes.length, 2, 'no repeated allocations at the floor');
  f.run(8000, 60);
  assert.equal(f.changes.length, 2, 'recovery requires sustained headroom');
  f.run(60000, 60);
  assert.equal(f.changes.at(-1).ratio, .85);
  assert(f.changes.every((c, i) => !i || c.now - f.changes[i - 1].now >= 3000));
}
for (const initial of [.75, .5]) {
  const f = replay(initial);
  f.run(20000, 15); f.run(60000, 120);
  assert(f.changes.every(c => c.ratio <= initial && c.ratio >= Math.min(initial, .65)), 'low/large-screen ceilings survive recovery');
}
{
  const f = replay();
  f.run(20000, 10, false); f.run(4000, 60);
  assert.equal(f.changes.length, 0, 'hidden/loading/menu frames are excluded');
  f.run(5000, 2); f.run(4000, 60);
  assert.equal(f.changes.length, 0, 'long pauses reset sampling');
  for (let i = 0; i < 12; i++) { f.run(1000, 30); f.run(3000, 60); }
  assert(f.changes.length <= 2, 'brief mixed frame rates do not cause continuous resizing');
}

// Execute the quality detector and renderer wrapper as served to Safari.
const main = readFileSync(new URL('main-D_3aygO4.js', assets), 'utf8');
const quality = readFileSync(new URL('quality-BuEwAkMy.js', assets), 'utf8');
assert(main.includes('$mobileFrameBudget(performance.now(),pe)'));
assert(main.includes('v.level===`mobile`&&e===`atmosphere`?'), 'Android uses the direct mobile renderer too');
assert(main.includes('$createMobileFrameBudget(k,x,t.raw.get(`adaptive`)!==`0`&&t.raw.get(`capture`)!==`1`)'));
assert(main.includes('preserveDrawingBuffer:t.screenshotMode&&(!c||t.raw.get(`capture`)===`1`)'));
assert(main.includes(`./mobile-frame-budget.js?v=${CLIENT_REVISION}`));
for (const [ua, touch, override, ratio] of [
  ['iPhone', 5, undefined, .85], ['iPhone', 5, 'low', .75],
  ['Macintosh', 5, undefined, .85], ['Android', 5, undefined, .85],
  ['Desktop', 0, 'high', 1.5],
]) {
  const scope = vm.createContext({ navigator: { userAgent: ua, platform: ua, maxTouchPoints: touch },
    window: { devicePixelRatio: 3 }, screen: { width: 390, height: 844 }, innerWidth: 390, innerHeight: 844,
    document: { createElement() { throw Error('no probe'); } } });
  vm.runInContext(quality.replace(/export\{[^}]+\};/, ''), scope);
  assert.equal(scope.l(override).quality.pixelRatio, ratio);
}
{
  const calls = [], listeners = new Map();
  let ratio = 1;
  class Renderer {
    shadowMap = {}; info = {}; domElement = { style: {} };
    setClearColor() {} setPixelRatio(value) { ratio = value; }
    getPixelRatio() { return ratio; }
    setDrawingBufferSize(w, h, pr) { ratio = pr; calls.push([w, h, pr]); }
    dispose() {}
  }
  class Camera {
    position = { set() {} }; rotation = {};
    updateProjectionMatrix() {}
  }
  class Group { add() {} }
  const window = { innerWidth: 390, innerHeight: 844,
    addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener() {} };
  const scope = vm.createContext({ window, n: () => true, f: () => true, c: () => false,
    ct() {}, at() {}, ea: Renderer, Me: Camera, He: Group, Ve: Group, pt: class {}, Be: 1, Xc: .3, Zc: 12000,
    t: (pr, w, h) => Math.min(pr, 1, Math.sqrt(1200000 / (w * h))),
    $resizeDrawingBuffer: resizeDrawingBuffer, clearTimeout() {}, setTimeout: fn => fn(),
  });
  const start = main.indexOf('function Qc('), end = main.indexOf('var $c=', start);
  assert(start > 0 && end > start);
  vm.runInContext(main.slice(start, end), scope);
  const q = { level: 'mobile', pixelRatio: .85 };
  const bundle = scope.Qc({ addEventListener() {} }, q);
  assert.deepEqual(calls, [[390, 844, .85]]);
  bundle.resize();
  assert.equal(calls.length, 1, 'same-size resize does not reallocate');
  bundle.applyPixelRatio(.75);
  assert.deepEqual(calls.at(-1), [390, 844, .75]);
  assert.equal(q.pixelRatio, .75, 'stats report the applied ratio');
  window.innerWidth = 844; window.innerHeight = 390;
  listeners.get('resize')();
  assert.deepEqual(calls.at(-1), [844, 390, .75], 'orientation preserves adaptive resolution');
  assert.equal(bundle.camera.aspect, 844 / 390);
  assert.equal(bundle.renderer.domElement.style.width, '844px', 'CSS controls retain logical size');
  assert.equal(calls.length, 3, 'one buffer resize per actual change');
  bundle.dispose();
}
{
  globalThis.document = { hidden: false };
  const ctx = { quality: { level: 'mobile', pixelRatio: .85 }, state: {}, net: {} };
  const applied = [];
  const bundle = { applyPixelRatio: ratio => applied.push(ratio), renderer: { getPixelRatio: () => applied.at(-1) } };
  const sample = createMobileFrameBudget(ctx, bundle);
  for (let now = 0; now < 12000; now += 1000 / 30) sample(now, true);
  assert.equal(ctx.quality.pixelRatio, .65);
  for (const block of ['composer', 'hidden', 'menu', 'loading', 'interrupted']) {
    ctx.composer = block === 'composer' ? {} : null;
    document.hidden = block === 'hidden';
    ctx.state.menuOpen = block === 'menu';
    ctx.net.interrupted = block === 'interrupted';
    for (let now = 12000; now < 50000; now += 1000 / 60) sample(now, block !== 'loading');
    assert.equal(ctx.quality.pixelRatio, .65, `${block} must not trigger recovery`);
  }
  for (const [level, enabled] of [['high', true], ['mobile', false]]) {
    const inactive = createMobileFrameBudget({ quality: { level }, state: {} }, {}, enabled);
    inactive(1000, true);
  }
  document.hidden = false;
  const camera = { quality: { level: 'mobile', pixelRatio: .85 }, state: { screenshotMode: true }, net: { interrupted: true } };
  const sampleCamera = createMobileFrameBudget(camera, bundle);
  for (let now = 0; now < 14000; now += 1000 / 15) sampleCamera(now, true);
  assert.equal(camera.quality.pixelRatio, .65, '15 FPS free camera adapts even without a game connection');
  delete globalThis.document;
}
{
  const source = readFileSync(new URL('buildings-BDmduZ8y.js', assets), 'utf8');
  const start = source.indexOf('function le('), end = source.indexOf('function ', start + 9);
  const scope = vm.createContext({ O: () => [], B: 1, b: class {}, g: class {}, o: class {} });
  vm.runInContext(source.slice(start, end), scope);
  for (const [level, distance] of [['mobile', 96], ['low', 260], ['medium', 380], ['high', 520]]) {
    const uniforms = scope.le({ quality: { level }, modules: new Map() }, {});
    assert.equal(uniforms.uDetailDist.value, distance);
  }
}
for (const name of ['main-D_3aygO4.js', 'quality-BuEwAkMy.js', 'buildings-BDmduZ8y.js']) {
  const response = await serveStatic(`world/assets/${name}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), readFileSync(new URL(name, assets), 'utf8'));
}
console.log('PASS mobile FPS: resolution adaptation, pauses/recovery, iOS low mode, single resize, orientation, facade LOD and served cache revision');
