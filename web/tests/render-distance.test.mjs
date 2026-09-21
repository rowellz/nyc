import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { configureRenderDistance, normalizeRenderDistance, RENDER_DISTANCE_KEY } from '../static/world/assets/render-distance.js';
import { createSceneryStream } from '../static/world/assets/scenery-stream.js';
import { ADDONS, addonsFor } from '../src/lib/server/client-addons.js';
import { versionClientImports, CLIENT_REVISION } from '../src/lib/server/client-cache.js';

for (const value of [null, undefined, '', 'oops', Infinity]) assert.equal(normalizeRenderDistance(value), 100);
assert.equal(normalizeRenderDistance(-100), 50);
assert.equal(normalizeRenderDistance(99999), 200);
assert.equal(normalizeRenderDistance(200, 100), 100);

const source = readFileSync(new URL('../static/world-addons/render-distance.js', import.meta.url), 'utf8');
for (const [touch, ios, near, far] of [[false, false, 768, 6000], [true, false, 640, 6000], [true, true, 384, 5000]]) {
  const dom = new JSDOM(`<div id="nyc" data-touch="${touch ? 'active' : 'off'}"><div class="hud bl"><div class="minimap-slot"></div></div></div>`,
    { url: 'http://localhost/world/', runScripts: 'outside-only' });
  globalThis.localStorage = dom.window.localStorage;
  localStorage.setItem(RENDER_DISTANCE_KEY, '75');
  const quality = { level: touch ? 'mobile' : 'high', drawDistance: near, farDistance: far, maxTraffic: 6 };
  const world = { ios, setDrawDistance(value) { this.distance = value; } };
  configureRenderDistance(world, quality);
  assert.equal(world.distance, Math.max(256, near * .75), 'saved preference applies before UI mounts');
  dom.window.__game = { ctx: { quality, world, state: { admin: false } } };
  dom.window.eval(source);
  const slider = dom.window.document.querySelector('#render-distance');
  const maximum = touch ? 100 : 200;
  assert.equal(slider.max, String(maximum));
  assert.equal(slider.value, '75');
  slider.value = '200';
  slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(quality.drawDistance, near * maximum / 100);
  assert.equal(world.distance, quality.drawDistance);
  assert.equal(quality.farDistance, Math.min(8000, far * maximum / 100));
  assert.equal(localStorage.getItem(RENDER_DISTANCE_KEY), String(maximum));
  assert.equal(quality.maxTraffic, 6);
  assert(slider.getAttribute('aria-valuetext').includes(`${near * maximum / 100} m detail`));
  let bubbled = false;
  dom.window.document.addEventListener('keydown', () => { bubbled = true; });
  slider.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(bubbled, false, 'keyboard adjustment does not reach player controls');
  dom.window.document.querySelector('button').click();
  assert.equal(slider.value, '100');
  assert.equal(world.distance, near);
  assert.equal(quality.farDistance, far);
  assert.equal(localStorage.getItem(RENDER_DISTANCE_KEY), '100');
  // Existing preferences and direct runtime calls obey the device cap too.
  localStorage.setItem(RENDER_DISTANCE_KEY, '200');
  const reloaded = { ios, mobile: touch, setDrawDistance(value) { this.distance = value; } };
  const reloadedQuality = { level: 'high', drawDistance: near, farDistance: far };
  configureRenderDistance(reloaded, reloadedQuality);
  assert.equal(reloaded.renderDistance.value, maximum);
  assert.equal(localStorage.getItem(RENDER_DISTANCE_KEY), String(maximum));
  reloaded.renderDistance.set(10000);
  assert.equal(reloaded.distance, near * maximum / 100);
  dom.window.eval(source);
  assert.equal(dom.window.document.querySelectorAll('#render-distance').length, 1);
  dom.window.close();
}
delete globalThis.localStorage;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('storage denied'); } });
const world = { setDrawDistance() {} };
configureRenderDistance(world, { drawDistance: 768, farDistance: 5000 });
world.renderDistance.set(50);
assert.equal(world.renderDistance.value, 50, 'unavailable storage never prevents live changes');
delete globalThis.localStorage;

// A stationary camera must immediately cancel obsolete scenery and retire
// its geometry when reducing range, even before the ordinary 250 ms replan.
const budget = { distance: 2500, middle: 0, chunks: 10, bytes: 1000, requests: 10 };
const requests = [], removed = [];
const stream = createSceneryStream({ budget, now: () => 0,
  fetchChunk(key, tier, signal) { requests.push({ key, signal }); return Promise.resolve({ key, byteLength: 1 }); },
  publish(data) { return data.key; }, remove(key) { removed.push(key); } });
stream.setManifest({ chunks: ['0_0', '1_0', '2_0'].map(key => ({ key })) });
stream.update(0, 0);
await Promise.resolve();
stream.update(0, 0); stream.update(0, 0); stream.update(0, 0);
assert.equal(stream.resident.size, 3);
budget.distance = 500;
stream.update(0, 0); stream.update(0, 0);
assert.deepEqual([...stream.resident.keys()], ['0_0']);
assert.equal(removed.length, 2);
budget.distance = 2500;
stream.update(0, 0);
assert.equal(requests.length, 5, 'increasing range requests newly visible scenery without moving');
budget.distance = 500;
stream.update(0, 0);
assert(requests.slice(-2).every(request => request.signal.aborted));
stream.dispose();

assert(ADDONS['world/index.html'].includes('/world-addons/render-distance.js'));
assert(!ADDONS['world/safe.html'].includes('/world-addons/render-distance.js'));
const html = versionClientImports(addonsFor('world/index.html')('<body></body>'));
assert(html.includes(`/world-addons/render-distance.js?v=${CLIENT_REVISION}`));
assert(versionClientImports("import './render-distance.js'").includes(`?v=${CLIENT_REVISION}`));
console.log('PASS render distance: live desktop/mobile controls, persistence, reset, scenery resizing and delivery');
