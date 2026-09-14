import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { signalApproach } from '../../public/world/assets/signal-placement.js';
import { assets } from './sveltekit-assets.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = stripTypeScriptTypes(read('../../src/client/src/props/signals.ts').replace(/^import .*\n/gm, '')).replace(/^export /gm, '');
const SourceNetwork = vm.runInNewContext(source + '\nSignalNetwork', { hash01: () => 0.5 });
const bundle = readFileSync(new URL('lamp-DWcKsT0C.js', assets), 'utf8');
const ServedNetwork = vm.runInNewContext(bundle.slice(bundle.indexOf('q=(()=>') + 2, bundle.indexOf(',J={color:6252132')), { I: () => 0.5 });
const arm = degrees => ({ fx: Math.cos(degrees * Math.PI / 180), fz: Math.sin(degrees * Math.PI / 180), width: 12, incoming: true });
function add(network, a, arms, { x = 0, z = 0, tile = 'a', layer = 0, spread = 30 } = {}) {
  const approach = { x, z, ...a, arms, incoming: true, layer, setback: 8 };
  return network.addPole(x - a.fx * spread, z - a.fz * spread, Math.atan2(-a.fx, -a.fz), tile, approach);
}
for (const [name, Network] of [['source', SourceNetwork], ['served', ServedNetwork]]) {
  const cardinal = [0, 90, 180, 270].map(arm), network = new Network();
  const poles = cardinal.map(a => add(network, a, cardinal));
  assert.equal(network.clusters.length, 1, `${name}: poles 60 m apart share their junction`);
  const c = poles[0].cluster;
  assert.equal(c.phaseCount, 2); assert.equal(c.cycle, 90); assert.equal(c.allRed, 2);
  assert.equal(poles[0].phase, poles[2].phase); assert.equal(poles[1].phase, poles[3].phase);
  assert.notEqual(poles[0].phase, poles[1].phase);
  for (const phase of [0, 1]) {
    for (const [local, expected] of [[0, 2], [39.99, 2], [40, 1], [42.99, 1], [43, 0], [44.99, 0]]) {
      assert.equal(Network.vehicleState(phase, phase * 45 + local, c), expected);
    }
    assert.equal(Network.pedFrame(phase, phase * 45, c), 0);
    assert.equal(Network.pedFrame(phase, phase * 45 + 20, c), 12);
    assert.equal(Network.pedFrame(phase, phase * 45 + 40, c), 1);
  }
  const adjacent = add(network, cardinal[0], cardinal, { x: 12 });
  assert.notEqual(adjacent.cluster, c, 'nearby distinct road nodes are separate controllers');
  const elevated = add(network, cardinal[0], cardinal, { layer: 2 });
  assert.notEqual(elevated.cluster, c, 'stacked road junctions never merge');
  const claims = new Network();
  assert(claims.claimApproach({ ...poles[0].approach, ...arm(0) }, 'a'));
  assert(!claims.claimApproach({ ...poles[0].approach, ...arm(0) }, 'b'), 'duplicate incoming road arm is omitted');
  assert(claims.claimApproach({ ...poles[0].approach, ...arm(16) }, 'b'), 'a shallow branch keeps its own signal');

  for (const angles of [[0, 60, 120, 180, 240, 300], [0, 90, 180, 225, 270], [0, 30, 90, 180, 210, 270], [0, 40, 80, 120, 160]]) {
    const arms = angles.map(arm), n = new Network();
    const ps = arms.map((a, i) => add(n, a, arms, { tile: `tile-${i}` })), cluster = ps[0].cluster;
    assert(cluster.phaseCount >= 3);
    for (let t = 0; t < cluster.cycle; t += 0.25) {
      const active = ps.filter(p => Network.vehicleState(p.phase, t, cluster) !== 0);
      for (const a of active) for (const b of active) {
        assert(Math.abs(a.fx * b.fx + a.fz * b.fz) >= Math.cos(Math.PI / 12) - 1e-8, 'crossing axes never get green/yellow together');
      }
      if (Network.pedestrianFrame(ps[0], true, t) !== 1) assert.equal(active.length, 0, 'complex WALK/countdown has no moving phase');
    }
    for (const p of ps) {
      assert.equal(Network.vehicleState(p.phase, p.phase * 90 / cluster.phaseCount, cluster), 2, 'every approach gets a turn');
      const slot = 90 / cluster.phaseCount;
      assert.equal(Network.vehicleState(p.phase, (p.phase + 1) * slot - 0.01, cluster), 0, 'all-red clearance precedes every change');
    }
    assert.equal(Network.pedestrianFrame(ps[0], false, 90), 0);
    assert.equal(Network.pedestrianFrame(ps[0], true, 97), 12);
    const snapshot = ps.map(p => [p.phase, p.cluster.offset, p.cluster.cycle, p.cluster.allRed]);
    const reversed = new Network();
    const rp = [...arms].reverse().map((a, i) => add(reversed, a, [...arms].reverse(), { tile: `rev-${i}` })).reverse();
    assert.deepEqual(rp.map(p => [p.phase, p.cluster.offset, p.cluster.cycle, p.cluster.allRed]), snapshot, 'tile arrival order does not change timing');
    const solo = add(new Network(), arms[0], arms);
    assert.deepEqual([solo.phase, solo.cluster.offset, solo.cluster.cycle, solo.cluster.allRed], snapshot[0], 'mobile corner subsets retain the complete plan');
    n.removeTile('tile-1');
    assert.equal(ps[0].cluster.offset, snapshot[0][1]);
    n.resetPoles();
    const rebuilt = ps.filter(p => p.tileKey !== 'tile-1').map(p => n.addPole(p.x, p.z, Math.atan2(-p.fx, -p.fz), p.tileKey, p.approach));
    assert.equal(n.clusters.length, 1); assert.equal(rebuilt[0].cluster.offset, snapshot[0][1]);
    for (const p of rebuilt) n.removeTile(p.tileKey);
    assert.equal(n.clusters.length, 0); assert.equal(n.signalFor(20, 0, -1, 0, 0), null);
  }
  const lookup = new Network(), facing = cardinal[0];
  const surface = add(lookup, facing, cardinal, { spread: 40 });
  const upper = add(lookup, facing, cardinal, { layer: 2, tile: 'upper', spread: 40 });
  const time = surface.phase * 45 - surface.cluster.offset;
  const found = lookup.signalFor(48, 3, -1, 0, time);
  assert(found, 'wide far-side pole is found from its approach stop line');
  assert.equal(found.dist, 40); assert.equal(found.stopX, 8); assert.equal(found.state, 'green');
  assert(lookup.signalFor(7, 3, -1, 0, time).dist < 0, 'cars clearing the stop line keep their current junction signal');
  assert.equal(lookup.signalFor(48, 12, -1, 0, time), null, 'parallel road outside the carriageway does not borrow a signal');
  assert.equal(lookup.signalFor(48, 0, -0.7, -0.7, time), null, 'diagonal traffic does not borrow an adjacent-facing light');
  assert.equal(lookup.signalFor(48, 0, -1, 0, time, 1), null);
  assert(lookup.signalFor(48, 0, -1, 0, time, 2));
  lookup.removeTile('upper');
  assert.equal(lookup.signalFor(48, 0, -1, 0, time, 2), null);
  assert(lookup.signalFor(48, 0, -1, 0, time, 0));
  assert.equal(lookup.signalFor(NaN, 0, -1, 0, time), null);
  assert.equal(lookup.signalFor(0, 0, 0, 0, time), null);
  console.log(`PASS ${name}: four-way timing, multi-axis conflicts, pedestrian clearance, wide/stacked junctions, streaming and approach lookup`);
}

const road = (id, pts, extra = {}) => ({ id, pts, lanes: 2, width: 12, layer: 0, ...extra });
const roads = [road(1, [[0, 0], [100, 0]]), road(2, [[0, 0], [0, 100]], { width: 30 }), road(3, [[0, 0], [-100, 0]])];
const prop = { x: -17, z: 4, yaw: -Math.PI / 2 };
const approach = signalApproach(prop, roads);
assert.equal(approach.setback, 17, 'stop before the full width of the crossing roadway');
assert.equal(approach.arms.length, 3);
assert.equal(signalApproach(prop, roads.map(r => r.id === 1 ? { ...r, oneway: true } : r)).incoming, false, 'one-way exits have no incoming signal');
assert.equal(signalApproach(prop, [roads[0], { ...roads[1], layer: 2 }]), null, 'an overpass does not create a surface intersection');
assert.equal(signalApproach(prop, [roads[0], roads[2]]), null, 'continuation nodes do not add signals');

// Replay the real West 155th / Harlem River area, including its elevated branches.
const tiles = [];
for (let x = 14; x <= 16; x++) for (let z = -34; z <= -32; z++) {
  tiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`, import.meta.url)))));
}
const cityRoads = [...new Map(tiles.flatMap(t => t.roads).map(r => [r.id, r])).values()];
const city = new ServedNetwork();
for (const tile of tiles) for (const p of tile.props.filter(p => p.kind === 'traffic_signal')) {
  const a = signalApproach(p, cityRoads), key = `${tile.tx}_${tile.tz}`;
  if (a && city.claimApproach(a, key)) city.addPole(p.x, p.z, p.yaw, key, a);
}
const complex = city.clusters.filter(c => c.phaseCount > 2);
assert(complex.length > 0, 'real complex junctions use extra phases');
for (const c of city.clusters) {
  for (let t = 0; t < c.cycle; t += 0.5) {
    const active = c.poles.filter(p => ServedNetwork.vehicleState(p.phase, t, c) !== 0);
    for (const a of active) for (const b of active) assert(Math.abs(a.fx * b.fx + a.fz * b.fz) >= Math.cos(Math.PI / 12) - 1e-8);
  }
}
const props = readFileSync(new URL('props-coU--UuE.js', assets), 'utf8');
assert(props.includes('i.addPole(l.x,l.z,f,t.key,r)'));
assert(props.includes('n.tileKey,n.approach)'));
assert(props.includes('he.pedestrianFrame(a,!!e[t+5],s)'));
assert(props.includes('n.state.serverTime(),layer)'));
assert(readFileSync(new URL('mobile-props.js', assets), 'utf8').includes('signals.addPole(prop.x, prop.z, prop.yaw, key, approach)'));
console.log(`PASS West 155th/Harlem River replay: ${city.poles.length} approaches, ${city.clusters.length} junctions, ${complex.length} multi-axis controllers; served desktop/mobile hooks`);

// Drive the actual served AI toward a signal on an elevated road. Use the real
// network for the lookup, including a conflicting surface signal underneath it.
const vehicles = readFileSync(new URL('vehicles-_zJz3z3J.js', assets), 'utf8');
const trafficStart = vehicles.indexOf('class Traffic {'), trafficEnd = vehicles.indexOf('return {Roads,Traffic,isAvenue}', trafficStart);
const Traffic = vm.runInNewContext(vehicles.slice(trafficStart, trafficEnd) + '\nTraffic', {
  KINDS: { sedan: { width: 2, length: 4, front: 2, rear: 2, wheelRadius: 0.3 } },
  distance2: (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2,
  lanePoint: (lane, along) => ({ x: 80 - along, z: 0, dx: -1, dz: 0 }),
  trafficHeight: () => 10, ground: () => 10, poseMatrix() {}, removeBody() {},
  tunnelConnections: () => [],
  $trafficRadius: () => 450,
});
const aiNetwork = new ServedNetwork(), aiArms = [0, 60, 120, 180, 240, 300].map(arm);
const aiPole = add(aiNetwork, aiArms[0], aiArms, { layer: 2 });
add(aiNetwork, aiArms[0], aiArms, { layer: 0 });
let signalTime = ((aiPole.phase + 1) % 3) * 30 - aiPole.cluster.offset, queries = 0;
const lane = { key: 'bridge', end: 'end', road: { bridge: true, layer: 2 }, ax: 80, az: 0, bx: 0, bz: 0, dx: -1, dz: 0, length: 80, speed: 10 };
const ctx = { world: {}, quality: { maxTraffic: 1 }, state: { screenshotMode: true }, camera: { position: { x: 30, z: 0 } },
  modules: new Map([['props', { signalFor: (x, z, dx, dz, layer) => { queries++; return aiNetwork.signalFor(x, z, dx, dz, signalTime, layer); } }]]) };
const ai = new Traffic(ctx, { lanes: new Map([[lane.key, lane]]), outgoing: new Map() });
ai.spawnClock = 1000;
const car = { key: 'test', kind: 'sedan', lane, x: 38, y: 10, z: 0, along: 42, speed: 8, age: 0, yaw: Math.PI / 2, spin: 0, wait: 0, next: null };
ai.cars.push(car);
for (let i = 0; i < 600; i++) ai.update(1 / 60, i / 60, []);
assert(queries > 0, 'bridge vehicles query road-level signals');
assert(car.x >= 10.9 && car.x < 12, `stops before the line with nose clearance: ${car.x}`);
assert.equal(car.speed, 0);
signalTime = aiPole.phase * 30 - aiPole.cluster.offset;
for (let i = 0; i < 60; i++) ai.update(1 / 60, i / 60, []);
assert(car.speed > 1, 'vehicle accelerates when its own elevated approach turns green');
console.log('PASS served vehicle AI brakes for elevated red signals and resumes on its own green');
