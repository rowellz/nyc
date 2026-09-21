import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CLIENT_REVISION } from '../src/lib/server/client-cache.js';
import { assets } from './sveltekit-assets.mjs';
import { guardDriving, releaseDrivingGuard } from '../static/world/assets/driving-streaming.js';

// Use the exact Rapier build shipped with the game, including its embedded WASM.
const main = readFileSync(new URL('main-D_3aygO4.js', assets), 'utf8');
const start = main.indexOf('ta=e({ActiveCollisionTypes:'), end = main.indexOf('function Bc(', start);
assert(start > 0 && end > start);
const scope = vm.createContext({ console, performance, WebAssembly, TextDecoder, TextEncoder, URL, atob,
  e: defs => Object.defineProperties({}, Object.fromEntries(Object.entries(defs).map(([key, get]) => [key, { get }]))),
});
vm.runInContext('var ' + main.slice(start, end) + ';globalThis.R=ta;', scope);
const R = scope.R;
await R.init();
const spec = { length: 5, width: 2 }, dt = 1 / 60;
const keys = new Set(['-1_0', '0_0', '1_0', '2_0', '3_0']);
for (const [sign, height] of [[1, 0], [-1, 0], [1, 20], [1, -8]]) {
  const physics = new R.World({ x: 0, y: -9.81, z: 0 });
  physics.timestep = dt;
  const floor = tx => physics.createCollider(R.ColliderDesc.cuboid(128, 1, 128)
    .setTranslation(tx * 256 + 128, height - 1, 128).setFriction(0));
  floor(0);
  const body = physics.createRigidBody(R.RigidBodyDesc.dynamic()
    .setTranslation(sign > 0 ? 225 : 31, height + .5, 128).setCcdEnabled(true));
  physics.createCollider(R.ColliderDesc.cuboid(1, .5, 2).setFriction(0), body);
  body.setLinvel({ x: sign * 120, y: 0, z: 0 }, true);
  const next = sign > 0 ? '1_0' : '-1_0';
  const ready = new Set(['0_0']);
  const world = { tileSet: keys, index: {}, tiles: new Map([['0_0', {}]]), stats: {}, lastPlan: 1 };
  const ctx = { world, physics: { world: physics, ready: true, RAPIER: R },
    modules: new Map([['streets', { collisionReady: key => ready.has(key) }]]) };
  const drive = { ctx, body, state: {}, skid: [1, 1, 1, 1], lateralSlip: [1, 1, 1, 1], wheelLocked: [true, true, true, true] };
  let heldAt;
  for (let i = 0; i < 600; i++) {
    const held = guardDriving(drive, dt, spec);
    if (held && heldAt === undefined) heldAt = { ...body.translation() };
    physics.step();
    assert(body.translation().y > height + .45, '120 m/s travel never falls through missing land, bridges or tunnels');
  }
  assert(heldAt, 'delayed tiles hold the moving vehicle before its chassis crosses the edge');
  assert.equal(body.translation().x, heldAt.x);
  assert.equal(body.bodyType(), R.RigidBodyType.KinematicPositionBased);
  assert(body.collider(0).isEnabled(), 'waiting car remains a collision obstacle');
  assert(world.drivingRequired.has(next));
  assert.equal(world.lastPlan, 1, 'safety checks do not force full scene replanning');
  assert.equal(drive.state.streaming, true);
  assert(Math.abs(world.stats.drivingSpeed-120)<.01,'streaming holds retain the saved vehicle speed for scheduling');
  assert.deepEqual(drive.skid, [0, 0, 0, 0]);
  // Decoded tile / visible road is insufficient: bridge and tunnel collision
  // chunks can still be pending after the ordinary land floor is installed.
  world.tiles.set(next, {}); floor(sign > 0 ? 1 : -1);
  assert(guardDriving(drive, dt, spec));
  physics.step();
  assert.equal(body.translation().x, heldAt.x);
  ready.add(next);
  assert.equal(guardDriving(drive, dt, spec), false);
  assert.equal(body.bodyType(), R.RigidBodyType.Dynamic);
  assert(Math.abs(body.linvel().x - sign * 120) < .01, 'momentum resumes after collider readiness');
  physics.step();
  assert(sign * (body.translation().x - heldAt.x) > 1);
  assert.equal(drive.state.streaming, false);
  // Rebuilding the occupied tile also holds the car until replacement colliders exist.
  ready.delete('0_0');
  assert(guardDriving(drive, dt, spec));
  releaseDrivingGuard(drive);
  assert.equal(world.drivingRequired, undefined);
  assert.equal(world.stats.drivingWaiting, false);
  assert.equal(world.stats.drivingSpeed,0,'leaving the car clears its scheduling speed');
  physics.free();
}

// Actual known water remains fallable; do not add an invisible floor or infer
// missing land from a downward ray that also misses water and airborne jumps.
{
  const physics = new R.World({ x: 0, y: -9.81, z: 0 });
  const body = physics.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(128, 10, 128));
  physics.createCollider(R.ColliderDesc.ball(1), body);
  const world = { tileSet: new Set(), index: {}, tiles: new Map(), stats: {} };
  const drive = { ctx: { world, physics: { ready: true, RAPIER: R }, modules: new Map() }, body, state: {} };
  assert.equal(guardDriving(drive, dt, spec), false);
  for (let i = 0; i < 60; i++) physics.step();
  assert(body.translation().y < 6);
  physics.free();
}

// Execute the served staged street commit to distinguish mesh publication,
// partial collider installation, completion, rebuild and cancellation.
const streets = readFileSync(new URL('streets-CfYSUqyW.js', assets), 'utf8');
const a = streets.indexOf('function*ne('), b = streets.indexOf('let re=', a);
assert(a > 0 && b > a);
const records = new Map();
const streetScope = vm.createContext({ console, N: records,
  o: class { children = []; traverse() {} }, I: class {},
  t: { add() {} }, $tunnelTerrain() {},
  J(rec) { rec.group = null; rec.collisionReady = false; },
  e: { physics: { ready: true, world: { createCollider: () => ({}) },
    RAPIER: { ColliderDesc: { trimesh: () => ({ setFriction() { return this; }, setRestitution() { return this; } }) }, TriMeshFlags: {} },
    addTileColliders() {},
  } },
});
vm.runInContext(streets.slice(a, b), streetScope);
const rec = { tile: { key: '0_0', tx: 0, tz: 0 }, collisionReady: true };
const built = { meshes: [], walkCollision: { position: [], index: [0, 1, 2] }, colliders: [{ position: [], index: [] }] };
const job = streetScope.ne(rec, built);
assert.equal(rec.collisionReady, true, 'old collision remains ready until replacement starts');
for (let result = job.next(); !result.done; result = job.next()) assert.equal(rec.collisionReady, false);
assert.equal(rec.collisionReady, true, 'ready only after every collider chunk');
const cancelled = streetScope.ne(rec, built);
cancelled.next(); cancelled.return();
assert.equal(rec.collisionReady, false, 'cancelled partial replacement cannot claim readiness');
const vehicles = readFileSync(new URL('vehicles-_zJz3z3J.js', assets), 'utf8');
assert(vehicles.includes('if($guardDriving(this,e,Z[this.car.kind]))return;this.body.isEnabled()'));
assert(vehicles.includes('dispose(){$releaseDrivingGuard(this);'));
assert(vehicles.includes(`driving-streaming.js?v=${CLIENT_REVISION}`));
console.log('PASS fast driving: real Rapier pause/resume, reverse, footprint, water, collider staging and disposal');
