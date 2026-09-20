import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { lampPlanner, roadFootprints, streetLampPlacement, furnitureClearance, furniturePlanner, fixtureTiles } from '../../public/world/assets/fixtures.js';
const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 16, bridge: true, layer: 1, oneway: true, ...extra });
const main = road(1, [[-120, 0], [120, 0]]);
const cross = road(2, [[0, -120], [0, 120]], { layer: 3 });
const branch = road(3, [[-100, -40], [20, 0]], { width: 10 });
const local = road(4, [[-120, 25], [120, 25]], { cls: 'residential', bridge: false, width: 8 });
const roads = [main, cross, branch, local], plan = lampPlanner(roads), footprint = roadFootprints(roads);
const original = { kind: 'street_lamp', x: 0, z: 0, yaw: 0 };
const moved = plan(original);
assert(moved && moved !== original);
assert(Math.hypot(moved.x, moved.z) <= 48);
assert(!footprint.obstructs(moved.x, moved.z, 4.8, r => r.bridge));
assert(!footprint.obstructs(moved.x, moved.z, 0.7));
for (let reach = 0; reach <= 3; reach += 0.2) {
  assert(!footprint.obstructs(moved.x - Math.sin(moved.yaw) * reach, moved.z - Math.cos(moved.yaw) * reach, 1.6, r => r.bridge), 'lamp arm clears widened overhead pavement');
}
const clear = { ...original, x: 70, z: 32 };
assert.equal(plan(clear), clear, 'ordinary roadside furniture stays in place');
assert.equal(plan({ ...original, kind: 'hydrant' }).kind, 'hydrant');
assert.deepEqual(lampPlanner([...roads].reverse())(original), moved, 'road arrival order does not choose a different edge');
const obstacle = [[[-150, -150], [150, -150], [150, 150], [-150, 150]]];
assert.equal(lampPlanner(roads, [obstacle])(original), null, 'omit a lamp when no nearby edge is clear of buildings');
const tile = { tx: 0, tz: 0, key: '0_0', roads, props: [original, { x: NaN, z: 0, yaw: 0 }], buildings: [], water: [] };
const world = { tiles: new Map([[tile.key, tile]]), roadsNear: () => roads };
assert.deepEqual(streetLampPlacement(world, tile, original), moved);
console.log('PASS lamps clear crossing decks, merging lanes and nearby streets; preserve clear poles and omit blocked placements');

// Run both real placement generators through the first lamp. The second prop's
// yield lets us inspect records without invoking unrelated tile dressing.
const source = stripTypeScriptTypes(readFileSync(new URL('../../src/client/src/props/placement.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')).replace(/^export /gm, '');
const served = readFileSync(new URL('../../public/world/assets/props-coU--UuE.js', import.meta.url), 'utf8');
const start = served.indexOf('function*jn('), end = served.indexOf('function ', start);
for (const [name, code, fn] of [['source', source, 'placeTileSteps'], ['served', served.slice(start, end), 'jn']]) {
  class InstanceList { records = []; push(...args) { this.records.push(args); } }
  const sandbox = { furnitureClearance, $furnitureClearance: furnitureClearance, streetLampPlacement, $streetLampPlacement: streetLampPlacement, InstanceList, It: InstanceList,
    hash01: () => 0.1, L: () => 0.1, LAMP_HEAD_LOCAL: { x: 0, y: 10, z: -2.4 }, B: { x: 0, y: 10, z: -2.4 } };
  vm.createContext(sandbox); vm.runInContext(code + `\nglobalThis.place = ${fn}`, sandbox);
  const store = { kinds: new Map(), lights: [], steam: [] }, colliders = [], queries = [];
  const ctx = { world, physics: { groundHeight: (x, z) => { queries.push([x, z]); return 0.15; } } };
  const generator = sandbox.place(ctx, tile, store, { fixed: () => [0, 0, 0, 0] }, {}, new Map(), () => 1, (...args) => colliders.push(args));
  generator.next(); generator.next(); generator.return();
  const record = store.kinds.get('lampLED').records[0];
  assert.deepEqual([record[0], record[1], record[2]], [moved.x, 0.15, moved.z], name);
  assert.deepEqual(queries, [[moved.x, moved.z]], `${name}: sample ground at the relocated base`);
  assert.deepEqual(colliders[0].slice(1, 4), [moved.x, 0.15, moved.z], `${name}: collider follows pole`);
  assert.equal(store.lights.length, 1);
  assert(Math.abs(store.lights[0].x - (moved.x - Math.sin(moved.yaw) * 2.4)) < 1e-6);
  assert(Math.abs(store.lights[0].z - (moved.z - Math.cos(moved.yaw) * 2.4)) < 1e-6);
}
assert.equal(readFileSync(new URL('../../src/client/src/streets/fixtures.js', import.meta.url), 'utf8'), readFileSync(new URL('../../public/world/assets/fixtures.js', import.meta.url), 'utf8'));
console.log('PASS source and served lamp meshes, light sources and colliders share the relocated placement');

// Actual Highbridge roads and authored lamps from the reported interchange.
const { gunzipSync } = await import('node:zlib');
const cityTiles = [];
for (let x = 16; x <= 18; x++) for (let z = -42; z <= -40; z++) {
  cityTiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`, import.meta.url)))));
}
const cityRoads = [...new Map(cityTiles.flatMap(t => t.roads).map(r => [r.id, r])).values()];
const cityPlan = lampPlanner(cityRoads, cityTiles.flatMap(t => [...t.buildings.map(b => b.footprint), ...t.water]));
const cityFootprints = roadFootprints(cityRoads);
let relocated = 0, omitted = 0, preserved = 0;
for (const p of cityTiles.find(t => t.tx === 17 && t.tz === -41).props.filter(p => p.kind === 'street_lamp')) {
  const result = cityPlan(p);
  if (result === p) { preserved++; continue; }
  if (!result) { omitted++; continue; }
  relocated++;
  assert(!cityFootprints.obstructs(result.x, result.z, 4.8, r => r.bridge || r.cls === 'motorway' || r.cls === 'trunk'));
  assert(!cityFootprints.obstructs(result.x, result.z, 0.7));
}
assert(relocated > 0 && preserved > 0);
console.log(`PASS actual Highbridge lamps: ${relocated} moved to clear edges, ${preserved} unchanged, ${omitted} omitted where no clear edge exists`);

// Exercise the actual iOS refresh function as well (including the context alias
// inside its prop loop, and a refresh after road tiles change).
const mobile = readFileSync(new URL('../../public/world/assets/mobile-SBC7KRMu.js', import.meta.url), 'utf8');
const refreshStart = mobile.indexOf('function w(){'), refreshEnd = mobile.indexOf('return w(),', refreshStart);
const mobileTile = { ...tile, props: [original] }, mobileWorld = { ...world, tiles: new Map([[tile.key, mobileTile]]) };
class Mesh {
  instanceMatrix = {}; records = [];
  constructor(geometry, material, count) { this.geometry = geometry; this.count = count; }
  setMatrixAt(i, matrix) { this.records[i] = matrix; }
}
const mobileSandbox = { $streetLampPlacement: streetLampPlacement, e: { camera: { position: { x: 0, z: 0 } }, world: mobileWorld, physics: { groundHeight: () => 0.15 } },
  re: () => [original], g: true, _: 0, v: 0, x: [], i: { resetPoles() {} }, t: { add() {}, remove() {} }, n: {}, r: new Map(),
  a: {}, C: Mesh, ie: () => ({}), d: { set(x, y, z) { this.pos = [x, y, z]; } }, u: { setFromAxisAngle(up, yaw) { this.yaw = yaw; } },
  f: {}, h: {}, l: { compose(pos, rotation) { return { pos: pos.pos, yaw: rotation.yaw }; } } };
vm.createContext(mobileSandbox); vm.runInContext(mobile.slice(refreshStart, refreshEnd) + 'w();', mobileSandbox);
assert.deepEqual(mobileSandbox.r.get('street_lamp').records[0].pos, [moved.x, 0.15, moved.z]);
mobileSandbox.g = true;
vm.runInContext('w();', mobileSandbox);
assert.deepEqual(mobileSandbox.r.get('street_lamp').records[0].pos, [moved.x, 0.15, moved.z]);
console.log('PASS served iOS fallback places lamps at clear edges and refreshes when road tiles change');

// Local junctions are often much wider than their centerline ribbons.
const square = (x0,z0,x1,z1) => [[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const junction = { ...tile, roads:[road(10,[[-60,0],[60,0]],{cls:'residential',bridge:false,width:8,layer:0}),
  road(11,[[0,-60],[0,60]],{cls:'residential',bridge:false,width:8,layer:0})], roadbeds:[[square(-12,-12,12,12)]], parking:[] };
const junctionWorld={tiles:new Map([[junction.key,junction]])};
const clearFurniture=furnitureClearance(junctionWorld,junction);
for(const kind of ['street_sign','traffic_signal','trash_can','hydrant','citibike_dock']) {
  assert.equal(streetLampPlacement(junctionWorld,junction,{kind,x:10,z:10,yaw:0}),null,`${kind}: reject broad intersection asphalt outside the centerlines`);
  const sidewalk={kind,x:16,z:16,yaw:0};
  assert.equal(streetLampPlacement(junctionWorld,junction,sidewalk),sidewalk,`${kind}: keep existing clear sidewalk positions`);
}
assert.equal(clearFurniture('wireBasket',12.3,10),false,'the whole basket clears the curb, not just its center');
assert.equal(clearFurniture('stopSign',10,10),false,'generated stop signs use the same junction check');
assert.equal(clearFurniture('manhole',0,0),true,'flush road hardware stays on the road');
assert.equal(furniturePlanner([], [{roadbeds:[[square(-20,-20,20,20),square(-3,-3,3,3)]]}])('trash_can',0,0),true,'retain furniture on a traffic island');
assert.equal(furniturePlanner([main,cross])('trash_can',0,0),true,'elevated roads do not erase ground-level furniture');
assert.equal(furniturePlanner([{...junction.roads[0],tunnel:true}])('trash_can',0,0),true,'tunnels do not erase ground-level furniture');
const pieces=[road(12,[[0,0],[10,0]],{cls:'residential',bridge:false,layer:0,width:4}),road(12,[[20,0],[30,0]],{cls:'residential',bridge:false,layer:0,width:4})];
assert.equal(furniturePlanner(pieces)('trash_can',5,0),false,'first piece of a repeated road ID survives');
assert.equal(furniturePlanner(pieces)('trash_can',25,0),false,'second piece of a repeated road ID survives');
// Crossing roadbed through a long model: all model corners lie outside the road.
assert.equal(furniturePlanner([], [{roadbeds:[[square(-.1,-5,.1,5)]]}])('bench',0,0),false);
const adjacent={...junction,key:'1_0',tx:1,props:[{kind:'trash_can',x:260,z:10,yaw:0}],roads:[]};
junctionWorld.tiles.set(adjacent.key,adjacent);
assert(fixtureTiles(junctionWorld,junction).includes(adjacent),'local-road arrivals rebuild neighboring furniture');

// Run actual generated sign accessories and bike docks around the reported
// West 177th Street / Cabrini Boulevard area, not just authored prop centers.
const westTiles=[];
for(let x=12;x<=15;x++)for(let z=-42;z<=-40;z++){
  const key=`${x}_${z}`;
  try{westTiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${key}.json.gz`,import.meta.url)))));}catch(e){if(e.code!=='ENOENT')throw e;}
}
const westWorld={tiles:new Map(westTiles.map(t=>[t.key,t])),roadsNear:()=>westTiles.flatMap(t=>t.roads)};
let rejected=0,kept=0,accessories=0;
for(const cityTile of westTiles.filter(t=>t.tz===-41&&[13,14].includes(t.tx))) {
  class InstanceList { records=[];push(...args){this.records.push(args);} }
  const relevant=new Set(['street_sign','trash_can','citibike_dock','phone_booth','bus_stop']);
  const selected={...cityTile,props:cityTile.props.filter(p=>relevant.has(p.kind))};
  const clear=furnitureClearance(westWorld,cityTile);
  for(const p of selected.props) {if(streetLampPlacement(westWorld,cityTile,p))kept++;else rejected++;}
  const sandbox={furnitureClearance,streetLampPlacement,InstanceList,hash01:()=>.1,signName:s=>s,
    BLADE_X0:.08,BLADE_W:1.15,AVENUE_CLASSES:new Set(['primary','secondary']),signalApproach:()=>null,
    dressTileSteps:function*(){}};
  vm.createContext(sandbox);
  vm.runInContext(source+'\nplaceTreeGuards=function*(){};placeTrashBagSteps=function*(){};globalThis.place=placeTileSteps;',sandbox);
  const store={kinds:new Map(),lights:[],steam:[],signs:[],signals:[]},colliders=[];
  const ctx={world:westWorld,physics:{groundHeight:()=>.15}};
  const atlas=new Proxy({}, {get:()=>()=>[0,0,0,0]});
  for(const _ of sandbox.place(ctx,selected,store,atlas,{},new Map(),()=>1,(...args)=>colliders.push(args))){}
  // The bundled generator must apply the same final-position rule as the source.
  Object.assign(sandbox,{$furnitureClearance:furnitureClearance,$streetLampPlacement:streetLampPlacement,
    It:InstanceList,L:()=>.1,en:s=>s,Xt:()=>null,nn:.08,tn:1.15,Cn:new Set(['primary','secondary']),$:sandbox.roadNear,
    On:function*(){},Sn:function*(){}});
  vm.runInContext(served.slice(start,end)+'\nMn=function*(){};globalThis.bundled=jn;',sandbox);
  const bundledStore={kinds:new Map(),lights:[],steam:[],signs:[],signals:[]};
  for(const _ of sandbox.bundled(ctx,selected,bundledStore,atlas,{},new Map(),()=>1)){}
  assert.deepEqual([...bundledStore.kinds].map(([kind,list])=>[kind,list.records]),[...store.kinds].map(([kind,list])=>[kind,list.records]),'source and bundled furniture positions match');
  for(const [kind,list] of store.kinds)for(const [x,y,z,yaw,scale] of list.records){
    assert(clear(kind,x,z,yaw,scale),`${cityTile.key}: ${kind} overlaps motor traffic at ${x},${z}`);accessories++;
  }
  for(const [kind,x,y,z,yaw] of colliders)assert(clear(kind,x,z,yaw),'collision uses the same accepted positions');
}
assert(rejected>0&&kept>0&&accessories>0);
console.log(`PASS West 177th Street furniture: ${rejected} unsafe sources omitted, ${kept} kept; ${accessories} generated pieces clear road surfaces`);

// iOS worker and synchronous fallback receive the same roadbed/context data.
{
  let result;
  const worker=readFileSync(new URL('../static/world/assets/mobile-props.worker.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'');
  const scope={streetLampPlacement,self:{postMessage:data=>result=data}};
  vm.createContext(scope);vm.runInContext(worker,scope);
  const props=[{kind:'trash_can',x:10,z:10,yaw:0},{kind:'trash_can',x:16,z:16,yaw:0}];
  scope.self.onmessage({data:{id:1,tiles:[junction],props}});
  assert(!result.error,result.error);assert.equal(result.placements[0],null);assert.equal(result.placements[1].x,16);
  const changed={...junction,roadbeds:[[square(-20,-20,20,20)]]};
  scope.self.onmessage({data:{id:2,tiles:[changed],props}});
  assert(result.placements.every(p=>p===null),'changed roadbeds invalidate cached worker placements');
}
console.log('PASS street furniture worker/fallback agreement and roadbed invalidation');
