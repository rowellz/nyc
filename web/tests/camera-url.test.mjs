import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as THREE from '../../public/world/assets/textureRelease-2U-gT89r.js';
import { ADDONS } from '../src/lib/server/client-addons.js';

// Exercise the same camera/quaternion implementation as the shipped client.
const PerspectiveCamera = Object.values(THREE).find(value => value?.prototype?.getFocalLength);
assert(PerspectiveCamera, 'shipped perspective camera is available');
const source = readFileSync(new URL('../static/world-addons/camera-url.js', import.meta.url), 'utf8');
const windows = [];
function boot(search = '', { ground = 12, drawn = true, screenshotMode = true } = {}) {
  const { window: w } = new JSDOM('', {
    url: `http://localhost:3000/world/${search}`, runScripts: 'outside-only',
  });
  windows.push(w);
  const camera = new PerspectiveCamera(67);
  camera.position.set(123.456, 34.567, -987.654);
  camera.rotation.set(-20 * Math.PI / 180, -90 * Math.PI / 180, 0, 'YXZ');
  const ctx = { camera, physics: { groundHeight: () => ground },
    stats: { drawCalls: drawn ? 1 : 0 }, state: { screenshotMode } };
  w.__game = { ctx };
  w.history.replaceState({ router: 'preserved' }, '', w.location.href);
  const replace = w.history.replaceState.bind(w.history);
  let writes = 0;
  w.history.replaceState = (...args) => { writes++; replace(...args); };
  let frame;
  w.requestAnimationFrame = callback => { frame = callback; };
  w.eval(source);
  return { w, ctx, camera, step: time => frame?.(time), writes: () => writes,
    params: () => new URL(w.location.href).searchParams };
}

try {
  assert(ADDONS['world/index.html'].includes('/world-addons/camera-url.js'));
  const live = boot('?spot=times-square&q=mobile&debug=1&time=18%3A00#inspect');
  live.step(0);
  assert.equal(live.params().get('fly'), '123.46,-987.65,22.57,90,-20');
  assert.equal(live.params().get('camy'), '34.57');
  assert.equal(live.params().get('fov'), '67');
  assert(!live.params().has('spot'), 'named spot must not override the saved view');
  assert.equal(live.params().get('q'), 'mobile');
  assert.equal(live.params().get('debug'), '1');
  assert.equal(live.params().get('time'), '18:00');
  assert.equal(live.w.location.hash, '#inspect');
  assert.deepEqual(live.w.history.state, { router: 'preserved' });
  assert.equal(live.w.history.length, 1);
  live.step(500);
  assert.equal(live.writes(), 1, 'stationary camera does not rewrite history');
  live.camera.position.x = 200;
  live.step(600);
  assert.equal(live.writes(), 1, 'movement is throttled');
  live.step(1000);
  assert.equal(live.writes(), 2);
  live.camera.rotation.set(0.1, 0.2, 0, 'YXZ');
  live.camera.fov = 80;
  live.step(1500);
  assert.equal(live.params().get('fly'), '200,-987.65,22.57,348.54,5.73');
  assert.equal(live.params().get('fov'), '80');
  live.camera.position.x = 201;
  live.w.dispatchEvent(new live.w.Event('pagehide'));
  assert(live.params().get('fly').startsWith('201,'), 'page exit flushes movement');

  // Reproduce the client's ground-relative placement, then load the addon with
  // a different ground height (e.g. a deck that has not streamed in yet).
  const saved = live.params();
  const [x, z, h, heading, pitch] = saved.get('fly').split(',').map(Number);
  for (const ground of [-100, 0, 25]) {
    const restored = boot(live.w.location.search, { ground, drawn: false });
    restored.camera.position.set(x, ground + h, z);
    restored.camera.rotation.set(pitch * Math.PI / 180, -heading * Math.PI / 180, 0, 'YXZ');
    restored.camera.fov = Number(saved.get('fov'));
    restored.step(0);
    assert.equal(restored.camera.position.y, 34.57, 'absolute height restores before drawing');
    assert.equal(restored.writes(), 0, 'boot does not overwrite the requested view');
    restored.ctx.stats.drawCalls = 1;
    restored.step(500);
    const result = restored.params().get('fly').split(',').map(Number);
    assert.deepEqual([result[0], result[1], result[3], result[4]], [x, z, heading, pitch]);
    assert.equal(restored.params().get('fov'), '80');
    restored.camera.position.y = 40;
    restored.step(1000);
    assert.equal(restored.camera.position.y, 40, 'restoration happens only once');
  }

  const delayed = boot('?spot=soho', { drawn: false });
  delete delayed.w.__game;
  delayed.step(0);
  assert.equal(delayed.writes(), 0);
  delayed.w.__game = { ctx: delayed.ctx };
  delayed.step(500);
  assert.equal(delayed.writes(), 0);
  delayed.ctx.stats.drawCalls = 1;
  delayed.step(1000);
  assert.equal(delayed.writes(), 1, 'sync starts after the game draws');

  for (const search of ['?fly=1,2&camy=NaN', '?fly=1,2&camy=',
    '?fly=bad,2&camy=999', '?fly=,2&camy=999', '?camy=999', '?spot=soho&fly=1,2&camy=999',
    '?urlsync=0&fly=1,2&camy=999']) {
    const invalid = boot(search);
    invalid.step(0);
    assert.equal(invalid.camera.position.y, 34.567, `no height override for ${search}`);
    if (search.includes('urlsync=0')) {
      invalid.w.dispatchEvent(new invalid.w.Event('pagehide'));
      assert.equal(invalid.writes(), 0);
    }
  }
  const playing = boot('', { screenshotMode: false });
  playing.step(0);
  assert(playing.params().has('fly'), 'play mode also captures a debug camera view');
  assert.equal(playing.ctx.state.screenshotMode, false, 'URL writing does not change the live mode');
  playing.camera.position.x = NaN;
  playing.step(500);
  assert.equal(playing.writes(), 1, 'non-finite coordinates are never published');
  playing.camera.position.x = 0;
  playing.w.history.replaceState = () => { throw new Error('restricted history'); };
  assert.doesNotThrow(() => playing.step(1000));
  console.log('Camera URL checks passed: movement, angles, restoration, history, startup, and opt-out.');
} finally {
  windows.forEach(w => w.close());
}
