import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import * as tunnels from '../../public/world/assets/tunnels.js';
import { supportPlanner, roadDeckHeight, roadDeckTriangles, triangleHeight } from '../../public/world/assets/supports.js';

const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 10, lanes: 3, oneway: true, layer: 0, tunnel: false, bridge: false, ...extra });
const approach = road(1, [[10, 40], [50, 40]]);
const boreA = road(2, [[50, 40], [100, 40]], { tunnel: true, layer: -1 });
const boreB = road(3, [[100, 40], [190, 40]], { tunnel: true, layer: -1 });
const boreC = road(4, [[190, 40], [270, 40]], { tunnel: true, layer: -1 });
const exit = road(5, [[270, 40], [350, 40]]);
const roads = [approach, boreA, boreB, boreC, exit];
const tile = (tx = 0) => ({ key: `${tx}_0`, tx, tz: 0, roads, buildings: [], roadbeds: [], sidewalks: [], medians: [], parks: [], water: [], parking: [], plazas: [], crossings: [], trees: [], props: [], groundElev: 0 });
const profiles = tunnels.tunnelNetwork(roads);
assert(Math.abs(tunnels.tunnelHeight(profiles.get(2), 0)) < 1e-9);
assert.equal(tunnels.tunnelHeight(profiles.get(2), 50), tunnels.tunnelHeight(profiles.get(3), 0));
assert.equal(tunnels.tunnelHeight(profiles.get(3), 50), -8);
assert(Math.abs(tunnels.tunnelHeight(profiles.get(4), 80)) < 1e-9);
assert.equal(tunnels.tunnelNetwork([...roads].reverse()).get(3).a.distance, profiles.get(3).a.distance);
const world = { tiles: new Map([['0_0', tile()]]) };
assert.equal(tunnels.trafficHeight(world, boreB, 150, 40), -7.975);
assert.equal(tunnels.tunnelSupport(world, 150, 40, -8, 0), -7.975);
assert.equal(tunnels.tunnelSupport(world, 150, 40, 0, 0), 0, 'surface support remains above the buried tunnel');
assert.equal(tunnels.tunnelSupport(world, 75, 40, -2.5, 0), -2.475);
console.log('PASS continuous profiles, split ways, surface/underground support');

const holes = tunnels.tunnelHoles(profiles);
const attrs = { position: { array: [0, 0, 0, 256, 0, 0, 256, 0, 256, 0, 0, 256], itemSize: 3 } };
const cut = tunnels.cutGround(attrs, [0, 2, 1, 0, 3, 2], holes);
function covered(pos, idx, x, z, targetY = 0) {
  for (let i = 0; i < idx.length; i += 3) {
    const pts = Array.from(idx.slice(i, i + 3), vi => Array.from(pos.slice(vi * 3, vi * 3 + 3)));
    if (pts.some(p => Math.abs(p[1] - targetY) > 0.05)) continue;
    const signs = pts.map((a, j) => { const b = pts[(j + 1) % 3]; return (b[0] - a[0]) * (z - a[2]) - (b[2] - a[2]) * (x - a[0]); });
    if (signs.every(s => s >= -1e-6) || signs.every(s => s <= 1e-6)) return true;
  }
  return false;
}
assert(!covered(cut.attributes.position.array, cut.index, 75, 40), 'approach ground is actually removed');
assert(covered(cut.attributes.position.array, cut.index, 150, 40), 'buried roadway leaves the surface above intact');
assert(covered(cut.attributes.position.array, cut.index, 75, 60), 'neighbouring ground stays intact');
assert([...cut.attributes.position.array].every(Number.isFinite));
console.log('PASS exact approach cuts preserve neighbouring streets and tunnel cover');

// Execute the served worker, including its actual geometry builders and collider packing.
let built;
const workerCode = readFileSync(new URL('../../public/world/assets/tile.worker-Ai2ZdmRL.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '');
const sandbox = { console, performance, self: { postMessage: result => { built = result; } },
  $roadDeckTriangles: roadDeckTriangles, $triangleHeight: triangleHeight, $roadDeckHeight: roadDeckHeight, $supportPlanner: supportPlanner, $tunnelBuild: tunnels.buildTunnels, $tunnelNetwork: tunnels.tunnelNetwork, $tunnelCut: tunnels.cutBuilder };
vm.createContext(sandbox); vm.runInContext(workerCode, sandbox);
const quality = { level: 'mobile', shadows: false };
await sandbox.self.onmessage({ data: { id: 1, input: { tile: tile(), roads, quality } } });
assert(!built.error, built.error);
assert(built.built.colliderPos.some(y => y < -7.9));
const collider = built.built;
// A vertical blocker would cross this straight centreline with a normal along x.
for (let i = 0; i < collider.colliderIdx.length; i += 3) {
  const pts = Array.from(collider.colliderIdx.slice(i, i + 3), vi => Array.from(collider.colliderPos.slice(vi * 3, vi * 3 + 3)));
  if (Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0])) > 0.01) continue;
  if (Math.min(...pts.map(p => p[2])) > 40 || Math.max(...pts.map(p => p[2])) < 40) continue;
  assert(Math.min(...pts.map(p => p[1])) >= 5.6, 'no black portal wall across the traffic path');
}
assert(collider.meshes[3].attributes.position.data.some(v => v < -7.9));
console.log('PASS served worker creates underground geometry and open, collidable bores');

// Run the recovered traffic classes: exercise actual spawning, lane transitions,
// height following, and unloading rather than only checking graph helpers.
function sourceModule(relative, injected, exports) {
  let source = readFileSync(new URL('../../src/client/src/' + relative, import.meta.url), 'utf8');
  source = source.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
  source = source.replace('constructor(private ctx: GameContext) {}', 'constructor(ctx: GameContext) { this.ctx = ctx; }')
    .replace('constructor(private ctx: GameContext, private roads: Roads) {}', 'constructor(ctx: GameContext, roads: Roads) { this.ctx = ctx; this.roads = roads; }');
  const js = stripTypeScriptTypes(source);
  return vm.runInNewContext(`(function(){${js};return {${exports}}})()`, injected);
}
const spec = { width: 1.8, length: 4, front: 2, rear: 2, wheelRadius: 0.3, parkedWeight: 0 };
const sourceGround = sourceModule('vehicles/model.ts', {}, 'ground').ground;
const common = { console, KINDS: { sedan: spec, taxi: spec }, hash01: (a, b = 0, c = 0) => ((a * 73 + b * 31 + c * 17) % 997) / 997,
  pickKind: () => 'sedan', ground: sourceGround, removeBody: () => {}, poseMatrix: () => {}, createObstacle: () => {},
  makeCar: (key, kind, x, y, z, yaw) => ({ key, kind, x, y, z, yaw, speed: 0, spin: 0 }), isIOS: () => false, TILE_SIZE: 256,
  trafficHeight: tunnels.trafficHeight, tunnelConnections: tunnels.tunnelConnections,
  distance2: (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 };
const { Roads, isAvenue } = sourceModule('vehicles/roads.ts', common, 'Roads,isAvenue');
const { Traffic } = sourceModule('vehicles/traffic.ts', { ...common, Roads, isAvenue }, 'Traffic');
const ctx = { world, modules: new Map([['props', { signalFor: () => ({ state: 'red', stopX: 175, stopZ: 40, dist: 1 }) }]]),
  quality: { maxTraffic: 1 }, state: { screenshotMode: true, local: { state: { x: 150, z: 40, yaw: 0 } } },
  camera: { position: { x: 150, z: 40 }, matrixWorld: { elements: new Array(16).fill(0) } }, physics: { ready: false } };
const network = new Roads(ctx); network.load(tile());
assert.equal([...network.lanes.values()].filter(l => l.road.tunnel).length, 9, 'all tunnel lanes participate');
assert.equal(network.tiles.get('0_0').parked.length, 0);
const approachLane = [...network.lanes.values()].find(l => l.road.id === 1);
assert(tunnels.tunnelConnections(network, approachLane).some(l => l.road.id === 2), 'portal connects across OSM layer change');
const traffic = new Traffic(ctx, network);
const car = { ...common.makeCar('test', 'sedan', 35, 0, 40, -Math.PI / 2), lane: approachLane, along: 25, next: null, wait: 0, turn: 0, age: 0, speed: 8 };
traffic.cars.push(car);
ctx.modules.clear(); // first enter normally, then put a surface signal over the bore
let deepest = 0, exited = false;
for (let step = 0; step < 3000; step++) {
  if (car.lane.road.tunnel) ctx.modules.set('props', { signalFor: () => { throw new Error('underground cars queried surface signals'); } });
  else ctx.modules.clear();
  traffic.update(1 / 60, step / 60, []);
  deepest = Math.min(deepest, car.y);
  if (car.lane.road.id === 5) { exited = true; break; }
}
assert(deepest < -7.9, `car descended to ${deepest}`);
assert(exited, 'car traversed all tunnel segments and emerged onto the exit road');
assert.equal(car.y, 0);
network.unload('0_0'); traffic.unload();
assert.equal(traffic.cars.length, 0); assert.equal(network.lanes.size, 0);
console.log('PASS traffic enters, descends, ignores surface signals, exits, and unloads');

// Run the same journey against the exact minified classes served to browsers.
const shipped = readFileSync(new URL('../../public/world/assets/vehicles-_zJz3z3J.js', import.meta.url), 'utf8');
const start = shipped.indexOf('ln=(e,t,n)=>'), end = shipped.indexOf(';function wn(', start);
assert(start > 0 && end > start);
const servedGround = vm.runInNewContext(`(${shipped.slice(shipped.indexOf('function jt('), shipped.indexOf('function Q('))})`);
const actual = vm.runInNewContext(`(function(){let ${shipped.slice(start, end)};return {Roads:vn,Traffic:Cn}})()`, {
  console, Z: common.KINDS, ht: common.hash01, vt: common.pickKind, jt: servedGround, Q: common.removeBody,
  At: common.poseMatrix, Mt: common.createObstacle, kt: common.makeCar, e: common.isIOS, $: common.distance2,
  $tunnelHeight: tunnels.trafficHeight, $tunnelConnections: tunnels.tunnelConnections,
});
ctx.modules.clear();
const actualRoads = new actual.Roads(ctx); actualRoads.load(tile());
const actualTraffic = new actual.Traffic(ctx, actualRoads);
const actualLane = [...actualRoads.lanes.values()].find(l => l.road.id === 1);
const actualCar = { ...common.makeCar('shipped', 'sedan', 35, 0, 40, -Math.PI / 2), lane: actualLane, along: 25, next: null, wait: 0, turn: 0, age: 0, speed: 8 };
actualTraffic.cars.push(actualCar);
let shippedDepth = 0;
for (let step = 0; step < 3000 && actualCar.lane.road.id !== 5; step++) {
  actualTraffic.update(1 / 60, step / 60, []);
  shippedDepth = Math.min(shippedDepth, actualCar.y);
}
assert(shippedDepth < -7.9); assert.equal(actualCar.lane.road.id, 5); assert.equal(actualCar.y, 0);
assert.equal(readFileSync(new URL('../../src/client/src/streets/tunnels.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../../public/world/assets/tunnels.js', import.meta.url), 'utf8'));
console.log('PASS served traffic bundle traverses the tunnel; runtime matches source');

const bridgeA = road(41, [[10, 40], [110, 40]], { bridge: true, layer: 1, lanes: 1 });
const bridgeB = road(42, [[110, 40], [210, 40]], { bridge: true, layer: 2, lanes: 1 });
const bridgeExit = road(43, [[210, 40], [350, 40]], { lanes: 1 });
// This overpass has an interior centreline point at the lower bridge join.
// It must not become an exit just because its x/z node matches.
const overhead = road(44, [[110, -90], [110, 40], [110, 170]], { bridge: true, layer: 3, lanes: 1 });
const bridgeRoads = [bridgeA, bridgeB, bridgeExit, overhead];
const bridgeTile = { ...tile(), roads: bridgeRoads };
await sandbox.self.onmessage({ data: { id: 3, input: { tile: bridgeTile, roads: bridgeRoads, quality } } });
assert(!built.error, built.error);
const decks = built.built.decks;
const heights = { deckHeight: () => 18, roadHeight: (r, x, z) => r.bridge ? roadDeckHeight(decks, r.id, x, z) : 0 };
const bridgeCtx = { ...ctx, world: { tiles: new Map([['0_0', bridgeTile]]) }, modules: new Map([['streets', heights]]) };
for (const [name, classes, ground] of [['source', { Roads, Traffic }, sourceGround], ['served', actual, servedGround]]) {
  assert.equal(ground(bridgeCtx, 105, 40), 18, 'unconstrained callers retain the existing highest-surface API');
  assert(ground(bridgeCtx, 105, 40, bridgeA) < 8, 'traffic samples its own lower deck');
  const graph = new classes.Roads(bridgeCtx); graph.load(bridgeTile);
  const firstLane = [...graph.lanes.values()].find(l => l.road.id === bridgeA.id);
  const connections = tunnels.tunnelConnections(graph, firstLane);
  assert(connections.some(l => l.road.id === bridgeB.id), `${name}: bridge continues across layer change`);
  assert(!connections.some(l => l.road.id === overhead.id), `${name}: crossing overpass stays disconnected`);
  const simulation = new classes.Traffic(bridgeCtx, graph);
  const vehicle = { ...common.makeCar(name, 'sedan', 35, heights.roadHeight(bridgeA, 35, 40), 40, -Math.PI / 2),
    lane: firstLane, along: 25, next: null, wait: 0, turn: 0, age: 0, speed: 8 };
  simulation.cars.push(vehicle);
  let passedUnder = false;
  for (let step = 0; step < 3000 && vehicle.lane.road.id !== bridgeExit.id; step++) {
    simulation.update(1 / 60, step / 60, []);
    assert.equal(vehicle.y, heights.roadHeight(vehicle.lane.road, vehicle.x, vehicle.z));
    assert.notEqual(vehicle.lane.road.id, overhead.id);
    if (Math.abs(vehicle.x - 110) < 5) { assert(vehicle.y < 8); passedUnder = true; }
  }
  assert(passedUnder); assert.equal(vehicle.lane.road.id, bridgeExit.id, `${name}: traffic reaches the surface exit`);
  assert.equal(vehicle.y, 0);
  simulation.dispose(); graph.unload('0_0');
}
console.log('PASS source and served traffic stay under overpasses, cross bridge layer changes, and reach the surface exit');
