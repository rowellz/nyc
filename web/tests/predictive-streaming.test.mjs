import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';
import { assets } from './sveltekit-assets.mjs';
import { installTileRequests } from '../static/world/assets/tile-requests.js';
import { serveStatic } from '../src/lib/server/static.js';
import { canCommitSceneTile } from '../static/world/assets/predictive-streaming.js';

// Exercise the actual shipped streamer, including request IDs, promise replies,
// overlap indexes and events. Only time, camera and network latency are faked.
const main = readFileSync(new URL('main-D_3aygO4.js', assets), 'utf8');
const start = main.indexOf('Pl=class');
const end = main.indexOf('var Il=', start);
assert(start > 0 && end > start);
const streamerSource = main.slice(start, end).replaceAll('import.meta.url', '"file:///streamer.js"');
const policy = readFileSync(new URL('predictive-streaming.js', assets), 'utf8').replace(/^import .*\n/gm, '').replaceAll('export function', 'function');
assert(main.includes('$canCommitSceneTile(t,o)'));
assert(main.includes('O=$configureStreaming(new Pl(S,v,t.world),x.camera)'));
assert(readFileSync(new URL('streets-CfYSUqyW.js', assets), 'utf8').includes('e.world.tilePriority?.(t.tile.tx,t.tile.tz)'));

// Exercise the shipped quality detector, including the separate iOS override
// and desktop's explicit q=mobile (the profile shown in the report).
const qualitySource = readFileSync(new URL('quality-BuEwAkMy.js', assets), 'utf8');
for (const [ua, override, expected] of [
  ['iPhone', undefined, 512], ['iPhone', 'low', 512], ['Android', undefined, 512],
  ['Desktop', 'mobile', 512], ['Desktop', 'low', 1500], ['Desktop', 'medium', 1500],
  ['Desktop', 'high', 1500], ['Desktop', 'ultra', 1500],
]) {
  const scope = vm.createContext({ navigator: { userAgent: ua, platform: ua, maxTouchPoints: ua === 'Desktop' ? 0 : 5, hardwareConcurrency: 4 },
    window: { devicePixelRatio: 1 }, screen: { width: 1920, height: 1080 }, innerWidth: 390, innerHeight: 844,
    document: { createElement() { throw new Error('no GPU in unit test'); } } });
  vm.runInContext(qualitySource.replace(/export\{[^}]+\};/, ''), scope);
  const { quality } = scope.l(override);
  assert.equal(quality.drawDistance, expected, `${ua} / ${override} uses its device budget`);
  assert(quality.farDistance >= expected);
  if (quality.level === 'mobile') assert.equal(quality.farDistance, 512, 'mobile avoids an additional far-building layer');
  if (ua === 'iPhone') {
    assert.equal(quality.maxTraffic, 6);
    assert.equal(quality.shadows, false);
    assert.equal(quality.farDistance, quality.drawDistance, 'iOS avoids enabling an additional far-building layer');
  }
}
{
  const { createAtmosphere } = await import(new URL('mobile-D4ic5hjY.js', assets));
  const ctx = { scene: { add() {}, remove() {} }, renderer: { shadowMap: {} },
    time: { daylight: 1 }, state: { weather: {} } };
  const atmosphere = createAtmosphere(ctx);
  assert.equal(ctx.scene.fog.near, 180);
  assert.equal(ctx.scene.fog.far, 700, 'mobile restores the original fog range');
  atmosphere.update(1 / 60, 1);
  assert.equal(ctx.scene.fog.far, 700, 'day/night updates preserve mobile fog');
  atmosphere.dispose();
}

class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  copy(p) { Object.assign(this, { x: p.x, y: p.y, z: p.z }); return this; }
  clone() { return new Vector(this.x, this.y, this.z); }
}
function fixture({ ios = true, mobile = true, predictive = true, latency = 0.6, tileData } = {}) {
  let time = 0;
  const sandbox = vm.createContext({ console, performance: { now: () => time * 1000 },
    M: Vector, n: () => ios, s: x => x, Dt: x => Math.floor(x / 256), Et: (x, z) => `${x}_${z}`,
    installTileRequests, Nl: 2, Ml: 2, jl: 6, Al: 2 });
  vm.runInContext(`${streamerSource}\n${policy}`, sandbox);
  const events = [], requests = [], pending = [], changes = [];
  const camera = { x: 1, z: 0, getWorldDirection(v) { return v.copy({ x: this.x, y: 0, z: this.z }); } };
  const world = new sandbox.Pl({ emit: (...args) => {
    events.push(args);
    if (args[0] === 'tileLoaded' || args[0] === 'tileUnloaded') changes.push({ time,
      fast: world.stats.fastTravel,
      occupied: args[0] === 'tileLoaded' && args[1].key === `${Math.floor(world.focus.x / 256)}_${Math.floor(world.focus.z / 256)}`,
    });
  } },
    { level: mobile ? 'mobile' : 'high', drawDistance: mobile || ios ? 512 : 1500, farDistance: mobile || ios ? 512 : 5000 });
  for (let x = -20; x <= 20; x++) for (let z = -10; z <= 10; z++) world.tileSet.add(`${x}_${z}`);
  if (tileData) world.tileSet = new Set(tileData.keys());
  world.index = { tiles: [...world.tileSet] };
  if (predictive) sandbox.configureStreaming(world, camera);
  world.decode = key => new Promise((resolve, reject) => {
    const [tx, tz] = key.split('_').map(Number);
    requests.push({ key, time, x: world.focus.x, z: world.focus.z });
    pending.push({ time: time + latency, resolve, reject, tile: tileData?.get(key) ?? { key, tx, tz, buildings: [], roads: [] } });
  });
  const point = new Vector(128, 0, 128);
  async function frame({ dt = 1 / 30, x = point.x, z = point.z, near = false, commit = true, busy } = {}) {
    time += dt;
    point.x = x; point.z = z;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].time <= time) {
        const reply = pending.splice(i, 1)[0];
        reply.resolve(reply.tile);
      }
    }
    await Promise.resolve();
    const before = events.filter(e => e[0] === 'tileLoaded').length;
    const unloaded = events.filter(e => e[0] === 'tileUnloaded').length;
    if (busy !== undefined) {
      world.focus.copy(point); // same order as the shipped main loop
      commit = sandbox.canCommitSceneTile({ busy }, world);
    }
    world.update(point, time, near, commit);
    assert(events.filter(e => e[0] === 'tileLoaded').length - before <= 1, 'at most one commit per frame');
    if (mobile && predictive) assert(events.filter(e => e[0] === 'tileUnloaded').length - unloaded <= 1, 'mobile disposes at most one tile per frame');
    if (mobile || ios) assert(world.inFlight.size <= (predictive ? 2 : 1), 'bounded in-flight memory');
    if (ios && predictive) assert(world.tiles.size <= 32, 'nearby, ahead and retained tiles share the 32-tile iOS limit');
  }
  return { world, camera, events, requests, pending, changes, frame, point, get time() { return time; } };
}

{
  const f = fixture({ latency: .01 });
  for (let i = 0; i < 100; i++) await f.frame({ dt: 1 / 60 });
  f.changes.length = 0;
  for (let i = 0; i < 360; i++) await f.frame({ dt: 1 / 60, x: f.point.x + 2 });
  assert(f.world.stats.fastTravel, '120 m/s movement selects the fast-travel budget');
  assert(f.changes.filter(c => c.fast).length > 6, 'continuous travel still loads and retires tiles');
  for (let i = 1; i < f.changes.length; i++) {
    const previous = f.changes[i - 1], current = f.changes[i];
    if (current.fast && !current.occupied) assert(current.time - previous.time >= .15 - 1e-6,
      'background tile lifecycle changes are spaced apart during fast travel');
  }
  for (let i = 0; i < 200; i++) await f.frame();
  assert(!f.world.stats.fastTravel, 'stopping restores the normal scene budget');
  assertCoverage(f);
}
{
  const world = { mobile: true, stats: { fastTravel: true }, focus: { x: 0, z: 0 },
    tiles: new Map([['0_0', {}]]), landed: [], inFlight: new Map() };
  assert(canCommitSceneTile({ busy: 5 }, world));
  assert(!canCommitSceneTile({ busy: 6 }, world), 'fast travel limits concurrent tile fan-out');
  world.tiles.clear(); world.landed.push({ p: { key: '0_0' }, id: 1 }); world.inFlight.set('0_0', 1);
  assert(canCommitSceneTile({ busy: 50 }, world), 'occupied terrain bypasses builder backpressure');
  world.inFlight.set('0_0', 2);
  assert(!canCommitSceneTile({ busy: 50 }, world), 'stale replies do not bypass the gate');
  world.mobile = false;
  assert(canCommitSceneTile({ busy: 6 }, world), 'desktop retains its existing job budget');
}

function tileDistance(tx, tz, x, z) {
  return Math.hypot(Math.max(tx * 256 - x, 0, x - (tx + 1) * 256),
    Math.max(tz * 256 - z, 0, z - (tz + 1) * 256));
}
function assertCoverage(f) {
  for (const key of f.world.tileSet) {
    const [tx, tz] = key.split('_').map(Number);
    if (tileDistance(tx, tz, f.point.x, f.point.z) <= f.world.drawDistance) {
      assert(f.world.tiles.has(key), `tile ${key} within ${f.world.drawDistance} m must load`);
    }
  }
}

// iOS fills a 512 m radius, plus at most one route tile beyond it.
// The immediate 3x3 must still outrank the additional scene work.
for (const [dx, dz] of [[1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2]]) {
  const f = fixture({ latency: 0.05 });
  f.camera.x = dx; f.camera.z = dz;
  for (let i = 0; i < 150; i++) await f.frame();
  const ahead = [...f.world.tiles.values()].filter(t => tileDistance(t.tx, t.tz, 128, 128) > 512);
  assert(ahead.length <= 1, 'at most one extra scene beyond the mobile neighborhood');
  assertCoverage(f);
  assert(f.world.tiles.size <= 26, '512 m needs at most 25 nearby tiles plus one route tile');
  const tx = dx === 0 ? 0 : 2, tz = dz === 0 ? 0 : (dz < 0 ? -1 : 1) * (dx === 0 ? 2 : 1);
  assert(f.world.tiles.has(`${tx}_${tz}`));
  assert.equal(f.world.stats.lookAheadMeters, 512);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    assert(f.world.tilePriority(x, z) < f.world.tilePriority(tx, tz), 'all local tiles precede speculation');
  }
  assert(f.requests.slice(0, 9).every(r => r.key.split('_').map(Number).every(n => Math.abs(n) <= 1)),
    'downloads fill the surrounding neighborhood before distant route tiles');
}

// A 512 m circle must remain covered at tile edges, including negative
// coordinates. Exercise retirement across several rows with the smaller cap.
{
  const f = fixture({ latency: 0.05 });
  let peak = 0;
  for (const [x, z] of [[255, 255], [511, 511], [767, 255], [1023, -1], [767, -257]]) {
    for (let i = 0; i < 250; i++) {
      await f.frame({ x, z });
      peak = Math.max(peak, f.world.tiles.size);
    }
    assertCoverage(f);
  }
  assert(peak > 9 && peak <= 32, 'mobile residency stays bounded during travel');
}

// Dense scene jobs keep the real main-loop gate closed. A decoded occupied
// tile can still publish; neighboring scenes remain blocked until jobs drain.
// This models backpressure explicitly, instead of assigning each tile an
// independent fixed build delay that ignores contention between tiles.
{
  const f = fixture({ latency: 0.2 });
  for (let i = 0; i < 60; i++) await f.frame({ busy: 24 });
  assert.deepEqual([...f.world.tiles.keys()], ['0_0']);
  assert.equal(f.world.landed.length, 2);
  for (let i = 0; i < 60; i++) await f.frame({ x: 2688, busy: 24 });
  assert(f.world.tiles.has('10_0'), 'occupied destination bypasses unrelated scene backlog');
  assert(!f.world.tiles.has('11_0'), 'urgent exception does not admit neighboring work');
  for (let i = 0; i < 120; i++) await f.frame({ busy: 0 });
  assert(f.world.ready, 'ordinary streaming resumes when builders catch up');
}

// Even still-wanted neighbor replies must not monopolize all decoder slots
// when movement puts the player in an unfetched tile and builders are blocked.
for (const options of [{}, { ios: false }, { ios: false, mobile: false }]) {
  const f = fixture({ ...options, latency: 0.1 });
  for (let i = 0; i < 30; i++) await f.frame({ commit: false });
  assert.equal(f.world.landed.length, options.mobile === false ? 6 : 2);
  const destination = f.world.queue.find(p => Math.abs(p.tx) <= 1 && Math.abs(p.tz) <= 1);
  assert(destination);
  for (let i = 0; i < 30; i++) await f.frame({ x: destination.tx * 256 + 128, z: destination.tz * 256 + 128, busy: 24 });
  assert(f.world.tiles.has(destination.key), 'occupied tile gets a slot even when all replies remain in the wanted neighborhood');
  assert.equal(f.world.tiles.size, 1, 'only the occupied scene bypasses backpressure');
}

// Desktop admin travel and Android also need their occupied tile when distant
// scene jobs saturate the shared gate. Neighbors must still obey backpressure.
for (const mobile of [false, true]) {
  const f = fixture({ ios: false, mobile, latency: 0.01 });
  for (let i = 0; i < 30; i++) await f.frame({ busy: 24 });
  assert.deepEqual([...f.world.tiles.keys()], ['0_0']);
  assert(f.world.landed.length > 0);
  for (let i = 0; i < 30; i++) await f.frame({ x: 2688, busy: 24 });
  assert(f.world.tiles.has('10_0'), 'camera destination bypasses unrelated scene jobs');
  assert(!f.world.tiles.has('11_0'), 'exception remains limited to the occupied tile');
  for (let i = 0; i < 100; i++) await f.frame({ busy: 0 });
  assert(f.world.ready);
}

// At a spot change, publish the occupied tile as soon as space is available;
// do not wait for every old tile to be disposed. Each frame still does only one.
{
  const f = fixture({ latency: 0.01 });
  for (let i = 0; i < 100; i++) await f.frame();
  const before = f.events.length;
  for (let i = 0; i < 3; i++) await f.frame({ x: 2688 });
  assert(f.world.tiles.has('10_0'));
  const events = f.events.slice(before);
  assert(events.findIndex(e => e[0] === 'tileLoaded') < 3, 'current tile does not wait behind a row of retirements');
}

// Startup retains its small neighborhood and never waits on speculative tiles.
{
  const f = fixture({ latency: 0.1 });
  for (let i = 0; i < 100; i++) await f.frame({ near: true });
  assert.equal(f.world.tiles.size, 9);
  assert(f.world.ready);
  assert(f.requests.every(r => r.key.split('_').map(Number).every(n => Math.abs(n) <= 1)));
}

// Even standing near the next boundary starts the forward row before crossing it.
{
  const f = fixture({ latency: 0.1 });
  for (let i = 0; i < 150; i++) await f.frame();
  for (let i = 0; i < 90; i++) await f.frame({ x: 220 });
  assert(f.requests.some(r => r.key === '2_0' && r.x < 256));
  assert(f.world.tiles.has('2_0'));
  assert(f.world.tilePriority(2, 0) < f.world.tilePriority(-2, 0));
  assert(f.world.ready, 'ahead loading does not hold readiness');
  f.camera.x = -1;
  for (let i = 0; i < 60; i++) await f.frame({ x: 128 });
  assert(f.world.tilePriority(-2, 0) < f.world.tilePriority(2, 0), 'turns reprioritize builds as well as loads');
}

// Replay motorway travel with slow tile responses. Movement wins over a camera
// looking backwards, and upcoming tiles are requested earlier than upstream.
{
  const improved = fixture({ latency: 1.5 });
  const original = fixture({ predictive: false, latency: 1.5 });
  for (const f of [improved, original]) {
    for (let i = 0; i < 500; i++) await f.frame({ near: true });
    f.camera.x = -1;
    for (let i = 1; i <= 300; i++) await f.frame({ x: 128 + i * 60 / 30 });
  }
  const next = improved.requests.find(r => r.key === '2_0');
  const old = original.requests.find(r => r.key === '2_0');
  assert(next && old);
  assert(next.x < 256 && old.x >= 256, `next row: predictive x=${next.x}, upstream x=${old.x}`);
  assert(improved.world.tilePriority(4, 0) < improved.world.tilePriority(0, 0), 'travel direction beats reverse camera');
  console.log(`PASS 60 m/s travel: next row requested at x=${next.x} (upstream x=${old.x})`);
}

// Looking back and forth near a boundary must reuse the previous forward row.
// Rebuilding those same tiles fans out into all five scene builders on phones.
{
  const f = fixture({ latency: 0.05 });
  for (let i = 0; i < 100; i++) await f.frame();
  for (let turn = 0; turn < 6; turn++) {
    f.camera.x = turn % 2 ? 1 : -1;
    for (let i = 0; i < 20; i++) await f.frame();
  }
  const counts = new Map();
  for (const request of f.requests) counts.set(request.key, (counts.get(request.key) ?? 0) + 1);
  assert([...counts.values()].every(n => n === 1), 'brief camera reversals reuse resident tiles instead of fetching and rebuilding them');
}

// Backpressure holds both decoded slots; teleporting drops old replies and
// frees those slots without emitting tiles from the abandoned scene.
{
  const f = fixture({ latency: 0.1 });
  for (let i = 0; i < 30; i++) await f.frame({ commit: false });
  assert.equal(f.requests.length, 2);
  assert.equal(f.world.landed.length, 2);
  await f.frame({ x: 2688, commit: false });
  assert(f.requests.some(r => r.key === '10_0'), 'stale slots are recycled even with scene publication blocked');
  assert.equal(f.world.tiles.size, 0);
  for (let i = 0; i < 90; i++) await f.frame();
  assert(f.world.tiles.has('10_0'));
  assert(f.events.filter(e => e[0] === 'tileLoaded').every(e => e[1].tx >= 4));
  f.world.unloadAll();
  for (let i = 0; i < 90; i++) await f.frame({ x: -128, z: -128, near: true });
  assert(f.world.tiles.has('-1_-1'));
  assert(f.world.ready);
}

// Desktop includes the distant GWB owner from the NYC approach. Mobile loads
// that geometry when within its smaller radius instead of retaining distant tiles.
{
  const tiles = new Map();
  for (let tx = 10; tx <= 19; tx++) for (let tz = -45; tz <= -37; tz++) {
    const key = `${tx}_${tz}`;
    try {
      const tile = JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${key}.json.gz`, import.meta.url))));
      tiles.set(key, { ...tile, key, tx, tz });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const bridge = tiles.get('11_-43').roads.find(r => r.id === 9702602000);
  assert(bridge && bridge.name.includes('Upper Level'));
  for (const options of [{}, { ios: false }, { ios: false, mobile: false }]) {
    const f = fixture({ ...options, latency: 0.05, tileData: tiles });
    for (let i = 0; i < 350; i++) await f.frame({ x: 4009.11, z: -10444.47 });
    assertCoverage(f);
    if (options.mobile !== false) {
      assert(!f.world.tiles.has('11_-43'), 'mobile excludes the bridge owner beyond 512 m');
      for (let i = 0; i < 150; i++) await f.frame({ x: 11.5 * 256, z: -42.5 * 256 });
      assertCoverage(f);
    }
    assert(f.world.tiles.has('11_-43'), 'GWB upper-level owner loads within the device radius');
    assert(f.world.roadsNear(...bridge.pts[0], 2).some(r => r.id === bridge.id), 'bridge road is in the live overlap index');
  }
  console.log('PASS actual GWB upper-level tile coverage on iPhone, mobile preset and desktop');
}

// Tile publication still indexes roads that cross a tile boundary.
{
  const f = fixture({ latency: 0.1 });
  await f.frame({ commit: false });
  const occupied = f.pending.find(p => p.tile.key === '0_0');
  const road = { id: 42, width: 12, pts: [[240, 128], [300, 128]] };
  occupied.tile.roads.push(road);
  // Four replies land together; the occupied tile must publish first.
  await f.frame({ dt: 0.2 });
  assert.equal(f.events.find(e => e[0] === 'tileLoaded')[1].key, '0_0');
  assert.equal(f.world.roadsNear(280, 128, 10)[0], road, 'commits preserve cross-tile road lookup');
  f.world.unloadAll();
  assert.equal(f.world.roadsNear(280, 128, 10).length, 0, 'unloading removes overlap indexes');
}

// Failed requests retain the upstream retry delay, and open water is ready.
{
  const f = fixture({ latency: 100 });
  await f.frame();
  const failed = f.pending.shift();
  failed.reject(new Error('simulated offline'));
  await Promise.resolve();
  for (let i = 0; i < 270; i++) await f.frame();
  assert.equal(f.requests.filter(r => r.key === failed.tile.key).length, 1);
  f.pending.length = 0;
  f.world.inFlight.clear();
  await f.frame({ dt: 2 });
  assert.equal(f.requests.filter(r => r.key === failed.tile.key).length, 2);
  f.world.unloadAll();
  f.world.tileSet.clear();
  await f.frame();
  assert(f.world.ready);
  assert.equal(f.world.queue.length, 0);
}

for (const options of [{ ios: false }, { ios: false, mobile: false }]) {
  const f = fixture({ ...options, latency: 0.05 });
  for (let i = 0; i < 200; i++) await f.frame();
  assert(f.world.ready);
  assertCoverage(f);
  assert(f.world.tiles.has('2_0'), 'Android and desktop retain their normal draw radius');
  for (let i = 0; i < 150; i++) await f.frame({ x: 220 });
  const forward = `${f.world.loadRadius + 1}_0`;
  assert(f.requests.some(r => r.key === forward && r.x < 256), 'preload extends beyond the normal draw radius');
}

// Repeated city-length trips exceed the resident budget many times. Neither
// fetched totals nor prior unloads may become an implicit lifetime tile cap.
for (const options of [{ ios: true, mobile: true }, { ios: false, mobile: false }]) {
  const f = fixture({ ...options, latency: 0.01 });
  let peak = 0;
  for (let trip = 0; trip < 2; trip++) for (const tx of [-15, -9, -3, 3, 9, 15, 9, 3, -3, -9, -15]) {
    for (let i = 0; i < 220; i++) {
      await f.frame({ x: tx * 256 + 128, busy: i < 12 ? 24 : 0 });
      peak = Math.max(peak, f.world.tiles.size);
    }
    assertCoverage(f);
    assert(f.world.ready);
  }
  assert(f.world.stats.fetched > peak * 5, 'many generations of tiles load in one session');
  assert(peak <= (options.ios ? 32 : 260), 'retired tiles do not accumulate across city trips');
  assert(f.events.some(e => e[0] === 'tileUnloaded'));
  console.log(`PASS repeated ${options.ios ? 'mobile' : 'desktop camera'} travel: ${f.world.stats.fetched} tile loads, peak ${peak} resident`);
}

for (const file of ['main-D_3aygO4.js', 'streets-CfYSUqyW.js', 'quality-BuEwAkMy.js', 'mobile-D4ic5hjY.js']) {
  const response = await serveStatic(`world/assets/${file}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), readFileSync(new URL(file, assets), 'utf8'));
}
console.log('PASS predictive streaming: startup, ahead loads, turns, memory, backpressure, teleports, retries, serving');
