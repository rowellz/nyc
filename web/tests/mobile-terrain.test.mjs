import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { terrainWorkerInput, emptyTerrainPixels } from '../static/world/assets/terrain-worker-input.js';

const source = readFileSync(new URL('environment-WQwLg8tn.js', assets), 'utf8');
const policy = readFileSync(new URL('mobile-build-policy.js', assets), 'utf8').replace(/^export /gm, '');
const dirtyStart = source.indexOf('function F(e,t){'), dirtyEnd = source.indexOf('function I(e)', dirtyStart);
const pumpStart = source.indexOf('function z(){if(O&&E)'), pumpEnd = source.indexOf('let ee=[', pumpStart);
assert(dirtyStart > 0 && dirtyEnd > dirtyStart && pumpStart > 0 && pumpEnd > pumpStart);
let now = 0, cancelled = 0;
const tiles = new Map(), pending = new Set(), requests = [], commits = [];
const ctx = { quality: { level: 'mobile' }, camera: { position: { x: 128, z: 128 } },
  world: { roadsNear: () => [], buildingsNear: () => [] } };
const sandbox = vm.createContext({ performance: { now: () => now },
  $terrainWorkerInput: terrainWorkerInput, $emptyTerrainPixels: emptyTerrainPixels,
  b: tiles, x: pending, S: 0, e: ctx, ie: (x, z) => `${x}_${z}`,
  o: { job: () => ({ pending: true, cancel() { this.pending = false; cancelled++; } }) },
  E: null, O: null, A: 0, T: { postMessage: request => requests.push(request) },
  R: (...args) => commits.push(args), P() { throw Error('unexpected worker failure'); },
});
vm.runInContext(policy + `
const $shouldInvalidateMask=shouldInvalidateMask,$markMaskDirty=markMaskDirty,
  $canBuildMask=canBuildMask,$beginMaskBuild=beginMaskBuild;
` + source.slice(dirtyStart, dirtyEnd) + source.slice(pumpStart, pumpEnd), sandbox);
for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
  const key = `${x}_${z}`;
  tiles.set(key, { tile: { key, tx: x, tz: z, parks: [], water: [[[]]] }, mask: {}, revision: 0 });
}
// A coastal tile's water is local: arrivals beside it do not repaint its mask.
sandbox.F(0, 0);
assert.deepEqual([...pending], ['0_0'], 'one repaint instead of nine without parks');
assert.equal(tiles.get('1_0').job, undefined, 'unchanged neighbors allocate no scene jobs');
pending.clear();
tiles.get('1_0').tile.parks = [[[]]];
sandbox.F(0, 0);
assert.deepEqual([...pending], ['0_0', '1_0'], 'park masks still react to neighboring roads/buildings');
for (now = 0; now <= 80; now += 20) { sandbox.F(0, 0); sandbox.z(); }
assert.equal(requests.length, 0, 'burst does not dispatch intermediate repaints');
now = 180; sandbox.z();
assert.equal(requests.length, 1);
assert.equal(requests[0].tile.key, '0_0');
assert.equal(sandbox.E.revision, tiles.get('0_0').revision, 'dispatch uses latest revision');
const stale = sandbox.E;
now = 190; sandbox.F(0, 0);
sandbox.O = { id: stale.id, key: '0_0', data: new Uint8ClampedArray(4) };
sandbox.z();
assert.equal(commits.length, 0, 'invalidated worker results never overwrite newer masks');
assert.equal(stale.job.pending, false, 'invalidating a running repaint releases its busy job');

// First terrain bypasses the settle window, on either worker or fallback path.
tiles.get('0_0').mask = null;
sandbox.z();
assert.equal(requests.at(-1).tile.key, '0_0');
assert(sandbox.E);
sandbox.O = { id: sandbox.E.id, key: '0_0', data: new Uint8ClampedArray(4) };
sandbox.z();
assert.equal(commits.length, 1);
tiles.get('0_0').mask = {};
pending.clear(); sandbox.E = null;
now = 1000;
for (; now <= 1400; now += 20) { sandbox.F(0, 0); sandbox.z(); }
assert(requests.length >= 3, 'continuous arrivals eventually dispatch at maximum wait');
assert(cancelled > 0);
const continuous = { mask: {}, tile: { tx: 4, tz: 0 } };
now = 3000; sandbox.markMaskDirty(continuous);
for (now = 3020; now < 3400; now += 20) {
  sandbox.markMaskDirty(continuous);
  assert.equal(sandbox.canBuildMask(continuous, ctx), false);
}
assert.equal(sandbox.canBuildMask(continuous, ctx), true, '400 ms maximum wait survives repeated changes');

// Desktop retains immediate park updates; mobile repaints keep old masks visible.
sandbox.E = null; ctx.quality.level = 'high';
now = 2000; sandbox.F(0, 0); sandbox.z();
assert.equal(sandbox.E.revision, tiles.get('0_0').revision);
assert(tiles.get('0_0').mask);
console.log('PASS served terrain updates: nine-to-one invalidation, coastal water, park dependencies, burst coalescing, first ground, stale results and bounded wait');
