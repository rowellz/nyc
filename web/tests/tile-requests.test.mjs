import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
const read = name => readFileSync(new URL(name, assets), 'utf8');
const main = read('main-D_3aygO4.js');
const core = main.slice(main.indexOf('Pl=class'), main.indexOf('var Il=', main.indexOf('Pl=class'))).replaceAll('import.meta.url', '"file:///streamer.js"');
const policy = read('predictive-streaming.js').replace(/^import .*\n/gm, '').replace(/^export /gm, '');
const requests = read('tile-requests.js').replace(/^export /gm, '');
class Vector {
  constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
  clone() { return new Vector(this.x, this.y, this.z); }
  copy(p) { Object.assign(this, p); return this; }
}
function fixture({ worker = true } = {}) {
  let time = 0, serial = 0;
  const timers = new Map(), workers = [], fetches = [], warnings = [];
  class Worker {
    messages = []; terminated = false;
    constructor() { workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
    reply(id, key) {
      const [tx, tz] = key.split('_').map(Number);
      this.onmessage({ data: { id, tile: { key, tx, tz, buildings: [], roads: [] }, bytes: 10, ms: 1 } });
    }
  }
  const scope = vm.createContext({ performance: { now: () => time }, console: { warn: (...args) => warnings.push(args) },
    URL, AbortController, Blob, Response, TextDecoder, DecompressionStream,
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: time + ms }); return id; }, clearTimeout: id => timers.delete(id),
    fetch: (url, options) => new Promise((resolve, reject) => fetches.push({ url, options, resolve, reject })),
    M: Vector, n: () => false, s: x => x, Dt: x => Math.floor(x / 256), Et: (x, z) => `${x}_${z}`,
    Nl: 2, Ml: 2, jl: 6, Al: 2, ...(worker ? { Worker } : {}) });
  vm.runInContext(core + '\n' + requests + '\n' + policy, scope);
  const events = [];
  const world = new scope.Pl({ emit: (...args) => events.push(args) }, { level: 'high', drawDistance: 1500, farDistance: 5000 });
  for (let x = -10; x <= 60; x++) for (let z = -8; z <= 8; z++) world.tileSet.add(`${x}_${z}`);
  world.index = { tiles: [...world.tileSet] };
  scope.configureStreaming(world, { getWorldDirection: out => out.copy(new Vector(1, 0, 0)) });
  const drain = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const tick = async (ms, x = world.focus.x, commit = true) => {
    time += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); }
    await drain();
    world.update(new Vector(x, 80, 128), time / 1000, false, commit);
    await drain();
  };
  return { world, workers, fetches, events, timers, warnings, tick, drain };
}
{
  const f = fixture();
  await f.tick(0, 128);
  assert.equal(f.world.inFlight.size, 6);
  const abandoned = f.workers.flatMap(w => w.messages.filter(m => m.url).map(m => ({ w, ...m })));
  await f.tick(100, 12000);
  assert.equal(f.world.reqCallbacks.size, 6, 'a long camera move replaces requests instead of retaining old decoder callbacks');
  assert.equal(f.timers.size, 6);
  assert(f.workers.every(w => w.messages.some(m => m.type === 'cancel')), 'obsolete worker fetches are aborted before decoding');
  assert([...f.world.inFlight.keys()].every(k => Number(k.split('_')[0]) > 30));
  for (const old of abandoned) old.w.reply(old.id, old.url.match(/tiles\/(.*?)\.json/)[1]);
  await f.drain();
  assert.equal(f.world.landed.length, 0, 'late cancelled replies never publish in the new area');
  assert.equal(f.world.failed.size, 0, 'moving away does not put abandoned tiles on failure cooldown');
  const loadCounts = [...f.world.workerLoads];
  assert.equal(loadCounts.reduce((a, b) => a + b, 0), 6, 'late replies do not corrupt worker occupancy');
  f.world.unloadAll(); await f.drain();
  assert.equal(f.world.reqCallbacks.size, 0); assert.equal(f.world.inFlight.size, 0); assert.equal(f.timers.size, 0);
  assert(f.world.workerLoads.every(n => n === 0));
  await f.tick(1, 128);
  assert(f.world.inFlight.has('0_0'), 'returning to an abandoned area can retry immediately');
  f.world.dispose(); await f.drain();
  assert.equal(f.timers.size, 0); assert.equal(f.world.reqCallbacks.size, 0);
}
{
  const f = fixture();
  await f.tick(0, 128);
  const originalWorkers = [...f.workers], keys = [...f.world.inFlight.keys()];
  await f.tick(29999);
  assert.equal(f.world.stats.failed, 0, 'slow requests get the full deadline');
  await f.tick(1);
  assert.equal(f.world.stats.failed, 6, 'a nonresponsive decoder pool releases every stalled request');
  assert(originalWorkers.every(w => w.terminated));
  assert.equal(f.world.workers.length, 2, 'a timed-out pool is replaced');
  assert(f.world.reqCallbacks.size <= 6); assert(f.timers.size <= 6);
  // Freeze new unrelated requests, then verify timed-out keys become eligible
  // again after the existing ten-second retry interval.
  f.world.unloadAll(); await f.drain();
  f.world.tileSet = new Set(keys);
  for (const key of keys) f.world.failed.set(key, 30);
  await f.tick(9999);
  assert(keys.every(k => !f.world.inFlight.has(k)));
  await f.tick(301);
  assert(keys.some(k => f.world.inFlight.has(k)), 'timeouts retry rather than blacklisting tiles forever');
  f.world.dispose(); await f.drain();
}
{
  const f = fixture();
  await f.tick(0, 128, false);
  const delivered = new Set();
  for (const worker of f.workers) for (const m of worker.messages) if (m.url) {
    delivered.add(m.id); worker.reply(m.id, m.url.match(/tiles\/(.*?)\.json/)[1]);
  }
  await f.drain();
  assert.equal(f.timers.size, 0, 'decode completion ends network timeout before scene publication');
  await f.tick(60000, 128, false);
  assert.equal(f.world.stats.failed, 0); assert.equal(f.world.landed.length, 6);
  await f.tick(1, 128, true);
  assert(f.world.tiles.has('0_0'), 'held decoded replies remain valid through a long builder backlog');
  f.world.dispose(); await f.drain();
}
{
  const f = fixture({ worker: false });
  await f.tick(0, 128);
  const old = [...f.fetches];
  await f.tick(100, 12000);
  assert(old.every(r => r.options.signal.aborted), 'main-thread fallback fetches are also cancelled on travel');
  for (const request of old) request.resolve(new Response(JSON.stringify({ key: '0_0', tx: 0, tz: 0, buildings: [], roads: [] })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.world.landed.length, 0);
  f.world.dispose(); await f.drain();
  assert(f.fetches.every(r => r.options.signal.aborted)); assert.equal(f.timers.size, 0);
}
// Exercise the actual worker protocol, including a cancel while the response
// body is outstanding. No error or tile message may escape for that request.
{
  const posted = [], fetches = [];
  const scope = vm.createContext({ URL, AbortController, Blob, Response, TextDecoder, DecompressionStream, performance,
    self: { postMessage: m => posted.push(m) },
    fetch: (url, options) => new Promise((resolve, reject) => fetches.push({ url, options, resolve, reject })) });
  vm.runInContext(read('streamer.worker-CUGZ-BtP.js'), scope);
  const work = scope.self.onmessage({ data: { id: 1, url: '/first' } });
  await scope.self.onmessage({ data: { type: 'cancel', id: 1 } });
  assert(fetches[0].options.signal.aborted);
  fetches[0].resolve(new Response('{"key":"old"}'));
  await work; assert.equal(posted.length, 0);
  const next = scope.self.onmessage({ data: { id: 2, url: '/next' } });
  fetches[1].resolve(new Response('{"key":"new"}'));
  await next; assert.equal(posted[0].tile.key, 'new');
}
console.log('PASS real streamer request lifecycle: abandoned camera requests, deadlines, decoder restart, retries, late replies, backpressure, fallback and worker cancellation');
