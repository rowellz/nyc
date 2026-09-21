import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { curbPlanner, parkingOffset, alignStreetTrees } from '../static/world/assets/curb-placement.js';
import { trafficAssetTransform } from '../src/lib/server/traffic-assets.js';
import { createStreetTileService } from '../src/lib/server/street-context.js';
import { readSceneryTiles } from '../src/lib/server/scenery-compiler.js';
import { treePitYaw } from '../../public/world/assets/fixtures.js';
const square=(x0,z0,x1,z1)=>[[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]];
const road={id:1,cls:'residential',width:12,lanes:1,oneway:true,layer:0,pts:[[20,100],[220,100]]};
const empty=extra=>({key:'0_0',tx:0,tz:0,roads:[road],roadbeds:[square(20,93,220,109)],sidewalks:[square(20,109,220,114),square(20,87,220,93)],parks:[],water:[],buildings:[],trees:[],props:[],...extra});
const tree={x:80,z:108.8,species:'ginkgo',height:10,dbh:12};
let tile=empty({trees:[tree]}),plan=curbPlanner([tile]);
assert(Math.abs(plan.parking(road,0,60,1,1.8,4.6)-7.85)<.001,'parking follows asymmetric curb, not half of nominal width');
assert(Math.abs(plan.parking(road,0,60,-1,1.8,4.6)+5.85)<.001,'opposite side finds its own curb');
assert(Math.abs(plan.parking(road,0,60,1,2.5,8)-7.5)<.001,'wide vehicles retain the same curb clearance');
const shifted=plan.tree(tree);
assert(shifted.z>=109.85&&shifted.z<=110.5,'pit moves wholly onto sidewalk');
assert.equal(plan.tree(shifted),shifted,'already aligned trees stay put');
const parkTree={...tree,z:120};
assert.equal(curbPlanner([empty({parks:[square(70,115,90,130)]})]).tree(parkTree),parkTree);
assert.equal(curbPlanner([empty({sidewalks:[]})]).tree(tree),tree,'missing paving does not invent tree positions');
assert.equal(curbPlanner([empty({sidewalks:[],roadbeds:[]})]).parking(road,0,60,1,1.8,4.6),4.85,'roads without surveyed curbs retain a width fallback');
// Raw sidewalk starts in the roadbed: both cars and pits follow the clipped curb.
plan=curbPlanner([empty({sidewalks:[square(20,106,220,114)]})]);
assert(Math.abs(plan.parking(road,0,60,1,1.8,4.6)-7.85)<.001);
assert(plan.tree({...tree,z:107}).z>=109.85);
// Taper: bumper clearance, not just the center point, determines the offset.
plan=curbPlanner([empty({roadbeds:[square(20,93,220,106)],sidewalks:[[[[20,106],[220,116],[220,121],[20,111]]]]})]);
const offset=plan.parking(road,0,60,1,1.8,8);
assert(offset<7.66&&offset>7.64,'taper reserves the nearer bumper curb');
// A tile seam is not a curb; neighbors give the same tree position on both paths.
const seamTree={...tree,x:255.8,z:108.8};
const left=empty({trees:[seamTree],roadbeds:[square(20,93,256,109)],sidewalks:[square(20,109,256,114)]});
const right=empty({key:'1_0',tx:1,roads:[],roadbeds:[square(256,93,300,109)],sidewalks:[square(256,109,300,114)]});
assert(alignStreetTrees(left,[left,right]).trees[0].z>=109.85);
console.log('PASS asymmetric curbs, vehicle widths, complete pits, parks, missing data, tapers and tile seams');

const directory=new URL('../../public/world/world/tiles/',import.meta.url);
const load=key=>JSON.parse(gunzipSync(readFileSync(new URL(`${key}.json.gz`,directory))));
const neighbors=[];for(let tx=8;tx<=10;tx++)for(let tz=-15;tz<=-13;tz++)neighbors.push(load(`${tx}_${tz}`));
const original=neighbors.find(t=>t.key==='9_-14'),aligned=alignStreetTrees(original,neighbors);
const actual=curbPlanner(neighbors);let moved=0;
for(let i=0;i<aligned.trees.length;i++) {
  const t=aligned.trees[i];if(t===original.trees[i])continue;
  moved++;
  const yaw=treePitYaw(aligned,t.x,t.z),dx=Math.cos(yaw),dz=-Math.sin(yaw);
  for(const along of [-1.22,0,1.22])for(const across of [-.77,0,.77])
    assert(actual.sidewalk(t.x+dx*along-dz*across,t.z+dz*along+dx*across),`real pit/guard footprint off sidewalk at ${t.x},${t.z}`);
}
assert(moved>20,'reported block includes misaligned street trees');
// Exercise the actual served parking loop, including the existing lane and
// intersection exclusions, rather than testing only the placement helper.
const bundle=trafficAssetTransform('world/assets/vehicles-_zJz3z3J.js',readFileSync(new URL('../../public/world/assets/vehicles-_zJz3z3J.js',import.meta.url),'utf8'));
const spec={width:1.8,length:4.6,parkedWeight:1};
const Roads=vm.runInNewContext(bundle.slice(bundle.indexOf('const node = (x'),bundle.indexOf('const AVENUE_RADIUS'))+'\nRoads',{
  $parkingOffset:parkingOffset,KINDS:{sedan:spec},isHighway:()=>false,isIOS:()=>false,TILE_SIZE:256,
  hash01:()=>.2,pickKind:()=> 'sedan',ground:()=>0,poseMatrix:()=>{},removeBody:()=>{},highwayLanePath:()=>null,
  makeCar:(key,kind,x,y,z,yaw)=>({key,kind,x,y,z,yaw}),
});
const graph=new Roads({modules:new Map(),camera:{position:{x:2528,z:-3561}}});graph.load(aligned);
const cars=graph.tiles.get(aligned.key).parked;
assert(cars.length>20,'curb correction preserves parking on the reported block');
for(const car of cars)for(const along of [-spec.length/2,0,spec.length/2])for(const across of [-spec.width/2,0,spec.width/2]) {
  const x=car.x+Math.sin(car.yaw)*along+Math.cos(car.yaw)*across;
  const z=car.z+Math.cos(car.yaw)*along-Math.sin(car.yaw)*across;
  assert(!actual.sidewalk(x,z),'parked vehicle footprint remains off sidewalk');
}
const served=JSON.parse(gunzipSync(await createStreetTileService(directory.pathname)('9_-14')));
const [scenery]=await readSceneryTiles(new URL('../../public/',import.meta.url).pathname,['9_-14']);
assert.deepEqual(served.trees,aligned.trees,'tile service ships corrected coordinates to trees, pits, guards and collisions');
assert.deepEqual(scenery.trees,served.trees,'distant and detailed trees share positions across chunk boundaries');
console.log(`PASS reported Park Avenue block: ${moved} trees corrected, ${cars.length} parked cars clear sidewalk, detailed/LOD positions agree`);
