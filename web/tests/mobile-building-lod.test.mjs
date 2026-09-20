import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { assets } from './sveltekit-assets.mjs';
import { buildingFoundation, foundationSlab } from '../../public/world/assets/foundations.js';
import { selectBuildingDetail, createBuildingDetailController, compactBuildingGeometry } from '../static/world/assets/mobile-building-lod.js';
const code=readFileSync(new URL('builder.worker-D9_Czkt3.js',assets),'utf8').replace(/^import .*$/gm,'');
let reply;
const scope=vm.createContext({console,performance,self:{postMessage:r=>reply=r},
  $foundation:buildingFoundation,$foundationSlab:foundationSlab,$compactBuildingGeometry:compactBuildingGeometry});
vm.runInContext(code,scope);
const build=(tile,options={})=>{
  scope.self.onmessage({data:{id:1,input:{...tile,quality:'low',landmarkBins:tile.buildings.slice(0,2).map(b=>b.id),...options}}});
  assert(!reply.error,reply.error);return reply.tile;
};
const bytes=value=>{
  const buffers=new Set();const visit=v=>{if(ArrayBuffer.isView(v))buffers.add(v.buffer);else if(v&&typeof v==='object')Object.values(v).forEach(visit)};
  visit(value);return [...buffers].reduce((n,b)=>n+b.byteLength,0);
};
let before=0,after=0,oldTriangles=0,newTriangles=0;
for(const key of ['0_0','1_0','0_1','1_1','-1_0','0_-1']) {
  const tile=JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${key}.json.gz`,import.meta.url))));
  const original=build(tile),shell=build(tile,{mobile:true,detailedIds:[]});
  before+=bytes(original);after+=bytes(shell);oldTriangles+=original.index.length/3;newTriangles+=shell.index.length/3;
  assert(shell.normal instanceof Int8Array);assert(shell.color instanceof Uint8Array);
  assert.equal(shell.byteLength,bytes(shell));
  assert.equal(shell.stats.buildings,original.stats.buildings,'all buildings survive');
  assert.deepEqual(shell.grid,original.grid,'building queries keep original indices');
  assert.equal(shell.colliders.length,original.colliders.length);
  for(let i=0;i<shell.colliders.length;i++) {
    assert.deepEqual(shell.colliders[i].position,original.colliders[i].position,'walkable walls/roofs/foundations unchanged');
    assert.deepEqual(shell.colliders[i].index,original.colliders[i].index);
  }
  for(const range of shell.landmarkRanges)assert(range.count>0&&range.start+range.count<=shell.index.length);
  const detailed=build(tile,{mobile:true,detailedIds:tile.buildings.map(b=>b.id)});
  assert.deepEqual(detailed.position,original.position,'selected roof detail retains original shape');
  assert.deepEqual(detailed.index,original.index);
  for(let i=0;i<original.normal.length;i++)assert(Math.abs(detailed.normal[i]/127-original.normal[i])<=1/127);
  for(let i=0;i<original.color.length;i++)assert(Math.abs(detailed.color[i]/255-original.color[i])<=1/255);
}
assert(after<before*.6,'shell geometry materially reduces resident arrays');
assert(newTriangles<oldTriangles*.6);
console.log(`PASS real Midtown building shells: ${oldTriangles} -> ${newTriangles} triangles; ${(before/1048576).toFixed(2)} -> ${(after/1048576).toFixed(2)} MiB CPU buffers; identical collision`);
const building=(id,x,height=20)=>({id,height,footprint:[[[x,0],[x+10,0],[x+10,10],[x,10]]]});
const tile={key:'0_0',buildings:Array.from({length:100},(_,i)=>building(i,i))};
const ctx={quality:{level:'mobile'},camera:{position:{x:0,y:2,z:0}},world:{ios:true,tiles:new Map([['0_0',tile]])}};
const selection=selectBuildingDetail(ctx);assert.equal(selection.size,24);assert(selection.has(0));
ctx.world.tiles.set('tower',{buildings:[building(1000,0,300)]});
assert(!selectBuildingDetail(ctx).has(1000),'street camera does not allocate unseen tower parapets');
ctx.camera.position.y=300;assert(selectBuildingDetail(ctx).has(1000),'flying near the crown restores roof detail');
ctx.quality.level='high';assert.equal(selectBuildingDetail(ctx),null);ctx.quality.level='mobile';
let time=0;const controller=createBuildingDetailController(ctx,()=>time);
const rec={tile,mesh:{},job:{pending:false}};controller.input(rec);
const records=new Map([['0_0',rec]]),enqueued=[];
controller.update(records,r=>enqueued.push(r));assert.equal(enqueued.length,0);
ctx.camera.position.y=2;time=1000;
rec.job.pending=true;controller.update(records,r=>enqueued.push(r));assert.equal(enqueued.length,0,'no concurrent replacement');
rec.job.pending=false;time=2000;controller.update(records,r=>enqueued.push(r));assert.equal(enqueued.length,1);
controller.input(rec);time=3000;controller.update(records,r=>enqueued.push(r));assert.equal(enqueued.length,1,'stable selection never rebuilds');

// Run the actual served scene commit and unload functions with real Three meshes.
const three=await import(new URL('textureRelease-2U-gT89r.js',assets));
const source=readFileSync(new URL('buildings-BDmduZ8y.js',assets),'utf8');
const group=new three.Z(),stats={verts:0,tris:0,bytes:0,buildMs:0};
const record={key:'0_0'},tiles=new Map([['0_0',record]]),material=new three.At();
let colliderBuilds=0;
const sandbox=vm.createContext({performance,v:tiles,n:group,b:stats,k:new Map(),D:[],m:material,
  t:{quality:{shadows:false},camera:{},scene:{},state:{},physics:{removeTileColliders(){}}},
  p:three.g,h:three.h,f:three.ar,o:three.Or,_:three.kt,e:()=>true,y:new Set(),_e:()=>null,
  J:(g,index)=>g.setDrawRange(0,index.length),R:function*(){colliderBuilds++;record.colliderDone=true;}});
vm.runInContext(source.slice(source.indexOf('function I(e){let r=v.get(e);'),source.indexOf('function*R(e){')),sandbox);
const fixture={key:'0_0',tx:0,tz:0,buildings:[building(1,0)],roads:[]};
let disposed=0;
for(let i=0;i<20;i++) {
  const built=build(fixture,{mobile:true,detailedIds:i%2?[1]:[]});
  const generator=sandbox.L(record,built);
  for(const step of generator)assert.equal(step,undefined);
  assert.equal(group.children.length,1,'replacement keeps one tile batch');
  assert.equal(stats.bytes,built.byteLength,'old geometry accounting retires');
  assert(record.mesh.geometry.attributes.normal.normalized);
  assert(record.mesh.geometry.attributes.color.normalized);
  assert.equal(record.mesh.castShadow,false);
  record.mesh.geometry.addEventListener('dispose',()=>disposed++);
}
assert.equal(colliderBuilds,1,'detail replacements retain existing physics without gaps');
sandbox.I('0_0');assert.equal(disposed,20);assert.equal(group.children.length,0);
assert.equal(stats.bytes,0);assert.equal(stats.verts,0);assert.equal(stats.tris,0);
material.dispose();
console.log('PASS building detail budgets, roof distance, serialized refresh, normalized attributes and 20 replacement/disposal cycles');
