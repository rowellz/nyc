import assert from 'node:assert/strict';
import { sceneFrameClock } from './scene-frame-clock.mjs';
import {readFileSync} from 'node:fs';
import {compileRailMap,solveRailGrades,railStructure} from '../static/world/assets/rail/map-compiler.js';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';
const rail=name=>new URL(`rail/${name}.js?v=${CLIENT_REVISION}`,assets);
const {mappedRoutes,mapStats,routes,sample,layout,holesForTile,waterHolesForTiles}=await import(rail('network'));
const {buildTrack,buildStation}=await import(rail('geometry'));
const {installRail}=await import(rail('runtime'));
const workerFootprints=await import(rail('footprints'));
const {Z:Group,Or:Vector3}=await import(new URL(`textureRelease-2U-gT89r.js?v=${CLIENT_REVISION}`,assets));
assert.equal(railStructure({railway:'subway'}).structure,'surface','subway is a transport type, not an underground flag');
assert.equal(railStructure({tunnel:'yes',layer:'-2'}).target,-19);
assert.equal(railStructure({bridge:'yes',layer:'2'}).target,12);
const nodes=Array.from({length:101},(_,i)=>({x:i*10,z:0,target:i<20?-12:i>60?8:.35}));
const edges=nodes.slice(1).map((_,i)=>({a:i,b:i+1,flat:i>=78&&i<95}));
const heights=solveRailGrades(nodes,edges);
for(let i=1;i<heights.length;i++)assert(Math.abs(heights[i]-heights[i-1])<=.550001);
assert.equal(heights[78],heights[95]);assert.equal(heights[0],-12);assert.equal(heights.at(-1),8);
// Separate IDs at a geometric crossing must never become a grade junction.
assert.deepEqual(solveRailGrades([{x:0,z:0,target:-12},{x:0,z:0,target:8}],[]),[-12,8]);
function way(id,ids,positions,tags={}) {return {type:'way',id,nodes:ids,geometry:positions.map(([lon,lat])=>({lon,lat})),tags:{railway:'subway',...tags}};}
const input=[way(1,[1,2],[[-73.99,40.75],[-73.985,40.75]],{tunnel:'yes'}),way(2,[2,3],[[-73.985,40.75],[-73.98,40.75]],{bridge:'yes'}),way(3,[2,4],[[-73.985,40.75],[-73.985,40.755]])];
const a=compileRailMap(input),b=compileRailMap([...input].reverse());
assert.deepEqual(a,b,'map arrival order cannot change chain ownership or grades');
assert.equal(a.routes.reduce((n,r)=>n+r.points.length-1,0),a.stats.edges,'one physical owner per graph edge');
const junction=a.routes.flatMap(r=>r.points.filter(p=>Math.abs(p.z-a.routes[0].points[0].z)<.01&&Math.abs(p.x-(-73.985+73.98322)*111320*Math.cos(40.75362*Math.PI/180))<.01));
assert(junction.length>=2);assert(junction.every(p=>Math.abs(p.y-junction[0].y)<1e-9));
const stacked=compileRailMap([
 way(501,[501,502],[[-73.99,40.75],[-73.98,40.75]],{tunnel:'yes',layer:'-2'}),
 way(502,[503,504],[[-73.99,40.7500002],[-73.98,40.7500002]],{tunnel:'yes',layer:'-1'}),
 {type:'node',id:505,lon:-73.985,lat:40.75,tags:{railway:'station',name:'Stacked platform fixture',layer:'-1'}},
]);
assert.equal(stacked.routes.find(r=>r.stations.length)?.wayIds[0],502,'platform layer wins over a few centimeters of horizontal distance');
console.log('PASS map railway tags, graph connectivity, shared grades, level platforms and deterministic ownership');
assert(mapStats.ways>4000);assert(mappedRoutes.length>1000);assert(mappedRoutes.reduce((n,r)=>n+r.stations.length,0)>500);
assert.equal(new Set(mappedRoutes.map(r=>r.id)).size,mappedRoutes.length);
for(const r of mappedRoutes)for(const s of r.stations)for(const distance of [s.s-s.length/2,s.s,s.s+s.length/2])
 assert(Math.abs(r.height(distance)-s.y)<.00001,'tracks remain level across the entire mapped platform');
const source=JSON.parse(readFileSync(new URL('../static/world/assets/rail/map-features.json',import.meta.url)));
for(const name of ['IRT Lexington Avenue Line','IND Eighth Avenue Line','IND Queens Boulevard Line'])assert(source.features.some(f=>f.tags.name===name),`import includes ${name}`);
for(const r of mappedRoutes)for(let i=1;i<r.points.length;i++) {
 const p=r.points[i-1],q=r.points[i];assert(Math.abs(q.y-p.y)<=.05501*Math.hypot(q.x-p.x,q.z-p.z)+.00002,`${r.id} grade`);
}
const station=mappedRoutes.flatMap(r=>r.stations.map(s=>({r,s}))).find(({s})=>s.name.includes('Astoria'));
assert(station,'a station outside the authored corridors is generated from map features');
const {r,s}=station;
assert(s.source.polygon?.length,'preserve mapped platform source geometry');
const geometry=buildTrack([...r.segmentsByTile.values()].flat().filter(([p,q])=>p.s<s.s+110&&q.s>s.s-140),[],r);
assert(geometry.collision.index.length);assert(buildStation(s,r).collision.index.length);
const tiles=[{tx:Math.floor(s.x/256),tz:Math.floor(s.z/256)}];
assert(holesForTile({tx:10000,tz:10000}).length===0);assert(waterHolesForTiles([]).length===0);
assert(waterHolesForTiles(tiles).length<1000,'water cutting is bounded to resident tiles');
for(const r of mappedRoutes)for(const p of [r.points[0],...r.stations]) {
 const tile={tx:Math.floor(p.x/256),tz:Math.floor(p.z/256)},expected=holesForTile(tile),actual=workerFootprints.holesForTile(tile);
 assert.equal(actual.length,expected.length,'worker footprint index matches the current rail catalog');
 for(let i=0;i<actual.length;i++)for(let j=0;j<4;j++)for(let k=0;k<2;k++)assert(Math.abs(actual[i][j][k]-expected[i][j][k])<=.000501);
}
console.log('PASS checked-in city railway coverage, every imported grade, source platforms and spatial footprint lookup');
globalThis.document={createElement:()=>({getContext:()=>new Proxy({}, {get:()=>()=>{}})})};
const colliders=new Set(),listeners=new Map();
const ctx={worldGroup:new Group(),scene:new Group(),camera:{position:new Vector3(s.x,s.y+3,s.z)},modules:new Map(),world:{tiles:new Map()},quality:{level:'mobile',drawDistance:512},state:{serverTime:()=>100},
 events:{on:(name,fn)=>{listeners.set(name,fn);return()=>listeners.delete(name);}},
 physics:{ready:true,groundHeight:()=>0,world:{createCollider:()=>({})},RAPIER:{ColliderDesc:{trimesh:()=>({setFriction(){return this;}})}},addTileColliders:key=>colliders.add(key),removeTileColliders:key=>colliders.delete(key)}};
const api=installRail(ctx);
const frameClock=sceneFrameClock();
for(let run=0;run<2;run++) {
 for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++){const tx=tiles[0].tx+x,tz=tiles[0].tz+z;ctx.world.tiles.set(`${tx}_${tz}`,{tx,tz});}
 listeners.get('tileLoaded')();for(let i=0;i<5000&&!api.readyForInput();i++){api.update(1/60);frameClock.frame();}
 assert(api.readyForInput());assert(api.stats.corridors.includes(r.id));assert(api.stats.trains<=4);
 const p=sample(r,s.s,s.offset);assert(Math.abs(api.support(p.x,p.z,s.y+1.15,NaN)-(s.y+1.15))<.01);
 ctx.world.tiles.clear();listeners.get('tileUnloaded')();api.update(.1);assert.equal(colliders.size,0);assert.equal(api.stats.trackTiles,0);
}
api.dispose();delete globalThis.document;assert.equal(listeners.size,0);assert.equal(ctx.worldGroup.children.length,0);
frameClock.restore();
console.log('PASS imported station streaming, platform support, global fleet budget and complete disposal');
