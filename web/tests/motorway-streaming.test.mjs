import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { serveStatic } from '../src/lib/server/static.js';
import { createRoadIndex, streetContext } from '../src/lib/server/street-context.js';
import { CLIENT_REVISION } from '../src/lib/server/client-cache.js';
import { alignStreetTrees } from '../static/world/assets/curb-placement.js';

const layout = await import(new URL('lane-layout.js', assets));
const paths = await import(new URL('lane-paths.js', assets));
const { deckEdges } = await import(new URL('edges.js', assets));
const { pedestrianTiles } = await import(new URL('pedestrian-clearance.js', assets));
const readTile = key => JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${key}.json.gz`, import.meta.url))));
const tiles = [];
for (let x = 12; x <= 21; x++) for (let z = -45; z <= -37; z++) {
  try { tiles.push(readTile(`${x}_${z}`)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const tile = readTile('19_-40'), index = createRoadIndex();
for (const t of tiles) for (const r of t.roads) index.add(r);
const streets = await (await serveStatic('world/assets/streets-CfYSUqyW.js')).text();
const inputStart = streets.indexOf('function te(t)'), inputEnd = streets.indexOf('function $()', inputStart);
const crossingStart = streets.indexOf('function U('), crossingEnd = streets.indexOf('async function W(', crossingStart);
const world = { tiles: new Map([[tile.key, tile]]), roadsNear: () => tile.roads };
const client = vm.createContext({ e: { world, quality: { level: 'mobile', shadows: false } },
  p: (x, z) => `${x}_${z}`, $roadProfileReach: 512, $pedestrianTiles: pedestrianTiles });
vm.runInContext(streets.slice(crossingStart, crossingEnd) + streets.slice(inputStart, inputEnd), client);
const early = client.te({ tile });
world.tiles = new Map(tiles.map(t => [t.key, t])); world.roadsNear = index.near;
const late = client.te({ tile });
const road = tile.roads.find(r => r.id === 1300424395000);
const edges = roads => deckEdges(road, roads, Math.max(3.2, road.width / 2));
const before = edges(early.roads).line(0, 0), after = edges(late.roads).line(0, 0);
assert(Math.hypot(before[0] - after[0], before[1] - after[1]) > 3,
  'reproduce the old sideways pop when neighboring roads arrive');

const started = performance.now();
const response = await serveStatic('world/world/tiles/19_-40.json.gz');
const bytes = Buffer.from(await response.arrayBuffer());
assert.equal(response.headers.get('content-type'), 'application/gzip');
assert.equal(response.headers.get('content-encoding'), null, 'decoder must receive raw gzip');
assert.equal(Number(response.headers.get('content-length')), bytes.length);
const served = JSON.parse(gunzipSync(bytes));
const { streetContext: context, ...original } = served;
assert.deepEqual(original, alignStreetTrees(tile,tiles.filter(t=>Math.abs(t.tx-tile.tx)<=1&&Math.abs(t.tz-tile.tz)<=1)),
  'planning preserves scene ownership and map records, including the served sidewalk-aligned trees');
assert(context.roads.length > tile.roads.length);
assert.equal(context.pedestrianTiles.length, 25);
const head = await serveStatic('world/world/tiles/19_-40.json.gz', { method: 'HEAD' });
assert.equal(head.headers.get('content-length'), String(bytes.length)); assert.equal(await head.text(), '');
assert.equal((await serveStatic('world/world/tiles/9999_9999.json.gz')).status, 404);
const main = await (await serveStatic('world/assets/main-D_3aygO4.js')).text();
assert(main.includes('${e.key}.json.gz?v=' + CLIENT_REVISION), 'cached legacy tiles cannot bypass planning context');
console.log(`PASS real 3.3 m streaming regression and gzip/HEAD/cache integration (${Math.round(performance.now() - started)} ms cold index, ${Math.round(bytes.length / 1024)} KiB tile)`);

const spur=1492536225000,owner=tiles.find(t=>t.roads.some(r=>r.id===spur));
assert(owner,'exercise the removed service spur from the real northern GWB loop');
assert(!index.near(3500,-10680,512).some(r=>r.id===spur),'neighbor road lookup cannot restore the spur');
assert(!streetContext(owner,index,tiles).roads.some(r=>r.id===spur),'raw owner cannot reinsert the spur into planning');
for(const key of new Set([owner.key,'13_-42','14_-42'])) {
  const response=await serveStatic(`world/world/tiles/${key}.json.gz`);
  const served=JSON.parse(gunzipSync(Buffer.from(await response.arrayBuffer())));
  assert(!served.roads.some(r=>r.id===spur),'scene and traffic omit the spur');
  assert(!served.streetContext.roads.some(r=>r.id===spur),'worker geometry and collision omit the spur');
  if(key===owner.key)assert.deepEqual(served.roads,owner.roads.filter(r=>r.id!==spur),'keep the surrounding loop roads');
}
console.log('PASS the northern GWB service spur stays removed from its owner, neighboring context, and traffic input');

world.tiles = new Map([[served.key, served]]); world.roadsNear = () => served.roads;
const distant = client.te({ tile: served });
world.tiles = new Map(tiles.map(t => [t.key, t])); world.roadsNear = index.near;
const nearby = client.te({ tile: served });
assert.deepEqual(distant, nearby, 'approaching a tile gives identical worker input');
world.tiles.clear(); world.roadsNear = () => [];
assert.deepEqual(client.te({ tile: served }), distant, 'unloading neighbors cannot change the motorway either');

const worker = readFileSync(new URL('tile.worker-Ai2ZdmRL.js', assets), 'utf8');
const scope = { console, performance, self: { postMessage: reply => { scope.reply = reply; } } };
for (const match of worker.matchAll(/^import \{([^}]+)\} from ['"]\.\/([^'"]+)['"];?$/gm)) {
  const module = await import(new URL(match[2], assets));
  for (const binding of match[1].split(',')) {
    const [name, alias = name] = binding.trim().split(/\s+as\s+/); scope[alias] = module[name];
  }
}
vm.createContext(scope); vm.runInContext(worker.replace(/^import .*$/gm, ''), scope);
const build = async input => {
  // Exercise the motorway meshes and their real pedestrian constraints without
  // rebuilding unrelated buildings, park paths and city sidewalk meshes.
  const tile = { ...input.tile, buildings: [], roadbeds: [], sidewalks: [], medians: [], parks: [],
    water: [], parking: [], plazas: [], crossings: [], trees: [], props: [] };
  await scope.self.onmessage({ data: { id: 1, input: structuredClone({ ...input, tile }) } });
  assert(!scope.reply.error, scope.reply.error);
  const { ms, ...geometry } = scope.reply.built; return geometry;
};
const farGeometry = await build(distant), nearGeometry = await build(nearby);
assert(farGeometry.decks.length > 0);
assert.deepEqual(nearGeometry, farGeometry, 'all pavement, barriers, paint, elevations and colliders remain identical');
// Trimming context polygons for transport must preserve the full neighborhood's
// clearance constraints, including roadbed holes under bridge approaches.
const fullPedestrians = pedestrianTiles({ tiles: new Map(tiles.map(t => [t.key, t])) }, tile);
assert.deepEqual(await build({ ...nearby, pedestrianTiles: fullPedestrians }), farGeometry);
console.log('PASS identical real worker geometry far away, nearby, and with untrimmed pedestrian constraints');

// Exercise actual invalidation code: neighboring scene arrivals and removals
// must not even enqueue a replacement mesh once planning context is complete.
const record = tile => ({ tile, revision: 0, job: { cancel() {} } });
const own = record(served), neighborTile = { ...served, key: '20_-40', tx: 20 };
const neighbor = record(neighborTile), legacy = record({ ...neighborTile, streetContext: undefined });
const invalidation = vm.createContext({ N: new Map([['own', own], ['neighbor', neighbor], ['legacy', legacy]]),
  V: {}, a: { job: () => ({ cancel() {} }) }, z: new Set(), $roadProfileReach: 512, $markStreetDirty() {},
  g: points => ({ minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
    minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])) }) });
vm.runInContext(streets.slice(streets.indexOf('function Z(e)'), streets.indexOf('function Q(e)')), invalidation);
invalidation.Z(neighborTile);
assert.equal(own.revision, 0); assert.equal(neighbor.revision, 1); assert.equal(legacy.revision, 1);
invalidation.Z(served); assert.equal(own.revision, 1, 'explicit tile replacements still rebuild');

const vehicles = readFileSync(new URL('vehicles-_zJz3z3J.js', assets), 'utf8');
const { vehicleDrawDistance, parkedDrawDistance } = await import('../static/world/assets/traffic-distribution.js');
let pathBuilds=0;
const Roads = vm.runInNewContext(vehicles.slice(vehicles.indexOf('const node = (x'), vehicles.indexOf('const AVENUE_RADIUS')) + '\nRoads', {
  $vehicleDrawDistance: vehicleDrawDistance, $parkedDrawDistance: parkedDrawDistance,
  isHighway: layout.isHighway, laneCount: layout.laneCount, laneWidth: layout.laneWidth,
  highwayLanePath: (...args)=>{pathBuilds++;return paths.highwayLanePath(...args);}, KINDS: { sedan: { width: 2, parkedWeight: 1 } },
  isIOS: () => true, TILE_SIZE: 256, removeBody() {},
});
const traffic = new Roads({ quality: { level:'mobile', drawDistance:384, farDistance:5000 }, world:{ios:true}, camera: { position: { x: 0, z: 0 } } });
traffic.load({ ...served, roads: served.roads.filter(layout.isHighway) });
const snapshots = new Map([...traffic.lanes].map(([key, lane]) => [key, structuredClone(lane.path)]));
const originalPaths = new Map([...traffic.lanes].map(([key, lane]) => [key, lane.path]));
assert(snapshots.size > 0);
pathBuilds=0;traffic.refreshHighways();
assert.equal(pathBuilds,0,'unchanged contextual traffic does not redensify paths');
const arrival = { ...readTile('20_-40'), roads: readTile('20_-40').roads.filter(layout.isHighway) };
traffic.load(arrival);
for (const [key, path] of snapshots) {
  assert.deepEqual(structuredClone(traffic.lanes.get(key).path), path);
  assert.equal(traffic.lanes.get(key).path,originalPaths.get(key),'arrivals preserve existing path buffers');
}
pathBuilds=0;
traffic.unload(arrival.key);
assert.equal(pathBuilds,0,'retirement does not redensify remaining contextual lanes');
for (const [key, path] of snapshots) assert.deepEqual(structuredClone(traffic.lanes.get(key).path), path);
for(let i=0;i<10;i++) {
  traffic.load({key:'100_100',tx:100,tz:100,roads:[],props:[]});traffic.unload('100_100');
}
assert.equal(pathBuilds,0,'ten unrelated load/unload cycles allocate no replacement paths');

// A changed lane position or a new road context still needs a new path. Compare
// against the uncached builder so reuse cannot freeze a changed join in place.
const lane=traffic.lanes.values().next().value, laneContext=traffic.streetContexts.get(lane.road);
assert(laneContext);
const checkPath=()=>assert.deepEqual(structuredClone(lane.path),
  structuredClone(paths.highwayLanePath(lane.road,traffic.streetContexts.get(lane.road),lane.segment,lane.offset).path));
lane.offset+=.25;traffic.refreshHighways();assert.equal(pathBuilds,1);checkPath();
const newContext=structuredClone(laneContext);
traffic.streetContexts.set(lane.road,newContext);
const beforeContext=pathBuilds;
traffic.refreshHighways();assert(pathBuilds>beforeContext,'replacement road context invalidates cached lanes');checkPath();
const legacyTraffic=new Roads(traffic.ctx);
legacyTraffic.load({...arrival,streetContext:undefined});pathBuilds=0;
legacyTraffic.refreshHighways();assert(pathBuilds>0,'legacy roads still follow resident neighbours');
legacyTraffic.dispose();traffic.dispose();
console.log(`PASS contextual traffic: ${snapshots.size} original paths preserved; zero rebuilds for unrelated chunks; changed offsets/context and legacy roads refresh`);

// Roads can cross the planning halo without owning a tile there or placing a
// vertex inside it; selecting by whole-way bounds must still include them.
const synthetic = createRoadIndex();
const longRoad = { id: 1, pts: [[-2000, 128], [2000, 128]], bridge: false, cls: 'motorway' };
synthetic.add(longRoad);
assert.equal(streetContext({ ...tile, tx: 0, tz: 0, roads: [] }, synthetic, []).roads[0], longRoad);
