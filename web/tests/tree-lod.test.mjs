import assert from 'node:assert/strict';
import {treeBudget,treeRecords,syncSceneryTrees} from '../../src/client/src/environment/tree-lod.js';

for(const [level,ios,distance,count] of [['mobile',false,1200,4000],['mobile',true,800,2000],['high',false,2000,10000]]) {
  assert.deepEqual(treeBudget({level,farDistance:2500},ios),{distance,count,middle:ios?150:level==='mobile'?220:320});
}
assert.equal(treeBudget({level:'high',farDistance:600}).distance,600);
const record=(x,scenery=false)=>({tree:{x,z:0},scenery});
const detailed=record(20),overlap=record(20,true),far=record(900,true),outside=record(1300,true);
const near=new Map([['0_0',[detailed]]]),remote=new Map([['0_0',[overlap]],['3_0',[far,outside]]]);
assert.deepEqual(treeRecords(near,remote,{x:0,z:0},1200,4000),[detailed,far],'one representation per tile');
assert.deepEqual(treeRecords(near,remote,{x:0,z:0},1200,1),[detailed],'nearest trees survive the instance cap');
near.clear();assert.deepEqual(treeRecords(near,remote,{x:0,z:0},1200,4000),[overlap,far],'scenery fills retired detail tiles');
const tiles=new Map([['0_0',{key:'0_0',trees:[overlap]}]]),records=new Map();
const ctx={worldGroup:{userData:{sceneryTreeTiles:tiles}}};let builds=0;
const trees={addTile(tile,scenery){assert(scenery);records.set(tile.key,[...tile.trees]);builds++;}};
assert(syncSceneryTrees(ctx,trees,records));assert(!syncSceneryTrees(ctx,trees,records));assert.equal(builds,1);
tiles.set('0_0',{key:'0_0',trees:[far]});assert(syncSceneryTrees(ctx,trees,records));assert.equal(builds,2);
assert.equal(records.get('0_0')[0],far,'tier replacement refreshes existing tree records');
delete ctx.worldGroup.userData.sceneryTreeTiles;assert(syncSceneryTrees(ctx,trees,records));assert.equal(records.size,0);
console.log('PASS tree distances, nearest-first instance caps, tile handoff, replacement and disposal');
