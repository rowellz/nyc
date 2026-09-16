import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { sceneBuildBudgetMs, nextSceneBuild } from '../static/world/assets/mobile-build-policy.js';
const main = readFileSync(new URL('main-D_3aygO4.js', assets), 'utf8');
const start = main.indexOf('this.compileAsync=function('), end = main.indexOf(';let Tt=', start);
assert(start > 0 && end > start);
const compileSource = main.slice(start + 'this.compileAsync='.length, end);
const queue = readFileSync(new URL('loading-DS_gLujL.js', assets), 'utf8').replace(/^import .*\n/gm, '').replace(/export\{[^}]+\};/, '');
let clock = 0;
const timers = [], frames = [], warnings = [], properties = new Map();
const ctx = { busy: 0, quality: { level: 'high' }, renderer: { initTexture() {} } };
const renderer = { compile: material => new Set([material]) };
const sandbox = vm.createContext({
  I: { get: material => properties.get(material) ?? {} }, He: { get: () => null },
  setTimeout: fn => timers.push(fn), requestAnimationFrame: fn => { frames.push(fn); return 1; },
  performance: { now: () => clock += 0.01 }, console: { warn: (...args) => warnings.push(args) },
  $sceneBuildBudgetMs: sceneBuildBudgetMs, $nextSceneBuild: nextSceneBuild,
});
vm.runInContext(queue + '\nglobalThis.compile = ' + compileSource + ';globalThis.scope = n;', sandbox);
function material({ ready = false } = {}) {
  const m = {}, program = { program: {}, ready, polls: 0, isReady() {
    this.polls++; assert(this.program, 'destroyed programs must never reach GL polling'); return this.ready;
  } };
  properties.set(m, { currentProgram: program, programs: new Map([['variant', program]]) });
  return { m, program };
}
async function drain() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  for (const frame of frames.splice(0)) frame();
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
{
  const { m, program } = material();
  let done = false;
  const promise = sandbox.compile.call(renderer, m, {}).then(value => { assert.equal(value, m); done = true; });
  timers.shift()(); await drain();
  assert(!done, 'live shaders still wait for actual compilation');
  program.ready = true;
  timers.shift()(); await promise;
  assert(done);
}
{
  const { m, program } = material({ ready: true });
  const promise = sandbox.compile.call(renderer, m, {});
  properties.get(m).currentProgram = { program: {}, isReady: () => false };
  timers.shift()();
  await promise;
  assert.equal(program.polls, 1, 'later render variants cannot redirect an outstanding compile promise');
}
// Reproduce enough unload-during-compile races to fill the actual tile gate.
// Use the served frame queue, whose jobs own ctx.busy until promises settle.
{
  const owner = sandbox.scope(ctx), work = [];
  for (let i = 0; i < 20; i++) {
    const item = material(), job = owner.job(`environment mask ${i}_0`);
    work.push({ ...item, job });
    job.run((function* () { yield sandbox.compile.call(renderer, item.m, {}); })());
  }
  await drain();
  assert.equal(ctx.busy, 20);
  for (const { m, program } of work) { properties.delete(m); program.program = undefined; }
  for (const timer of timers.splice(0)) timer();
  await drain(); await drain();
  assert.equal(ctx.busy, 0, 'tile retirement cannot accumulate unresolved shader jobs and permanently close the streaming gate');
  assert(work.every(({ job }) => !job.pending));
  assert(work.every(({ program }) => program.polls === 0));
  owner.dispose(); assert.equal(ctx.busy, 0, 'later scope cleanup is idempotent');
}
{
  const { m, program } = material();
  program.isReady = () => { throw Error('simulated driver polling error'); };
  const owner = sandbox.scope(ctx), job = owner.job('shader error');
  job.run((function* () { yield sandbox.compile.call(renderer, m, {}); })());
  await drain();
  for (const timer of timers.splice(0)) timer();
  await drain();
  assert.equal(ctx.busy, 0, 'polling exceptions reject and release the owning build job');
  assert(warnings.some(w => String(w[0]).includes('async commit failed')));
  owner.dispose();
}
console.log('PASS served shader compilation: disposed tile materials, stable program snapshots, twenty-job streaming deadlock, rejection cleanup');
