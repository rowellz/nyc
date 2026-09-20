import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { sceneryTools, sceneryChunks, compileScenery, landFaces, readSceneryTiles } from '../src/lib/server/scenery-compiler.js';
import { createSceneryService } from '../src/lib/server/scenery.js';
import { serveStatic } from '../src/lib/server/static.js';
import { encodeScenery, decodeScenery, prepareSceneryGeometry } from '../static/world/assets/scenery-format.js';
import { createSceneryStream, sceneryBudget } from '../static/world/assets/scenery-stream.js';
import { assets } from './sveltekit-assets.mjs';
const publicDir=path.resolve(import.meta.dirname??new URL('.',import.meta.url).pathname,'../../public');
const tools=await sceneryTools(publicDir);
{
  const response=await serveStatic('world/world/lod/manifest.json');
  assert.equal(response.status,200,'LOD routes resolve before looking for mirrored files');
  const manifest=await response.json();assert.equal(manifest.chunks.length,272);
  assert(manifest.chunks.every(c=>!('tiles' in c)),'source tile keys stay on the server');
  const mesh=await serveStatic('world/world/lod/0_0.far.bin');
  assert.equal(mesh.status,200);assert.equal(mesh.headers.get('content-encoding'),null);
  const body=gunzipSync(Buffer.from(await mesh.arrayBuffer()));
  assert.equal(decodeScenery(body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength)).key,'0_0');
}
const empty=(tx=0,tz=0)=>({key:`${tx}_${tz}`,tx,tz,buildings:[],roads:[],water:[]});
const square=(x,z,w)=>[[x,z],[x+w,z],[x+w,z+w],[x,z+w]];
const tile=empty();tile.water=[[square(80,80,96),square(112,112,32)]];
tile.buildings=[{id:1,height:50,footprint:[square(10,10,30)]},{id:2,height:8,footprint:[square(190,10,20)]}];
tile.parks=[[square(0,0,32)]];
tile.trees=[{x:10,z:10,dbh:20,height:16,species:'London plane'},{x:40,z:10,dbh:8,height:9,species:'ginkgo'},
  {x:NaN,z:10,dbh:8,height:9,species:'ginkgo'}];
tile.roads=[{id:1,cls:'primary',width:10,pts:[[0,50],[256,50]]},{id:2,cls:'residential',width:6,pts:[[0,60],[256,60]]},
  {id:3,cls:'primary',tunnel:true,width:10,pts:[[0,70],[256,70]]}];
{
  const faces=landFaces(tile,tools.inside);
  const area=faces.reduce((n,r)=>n+Math.abs(r.reduce((s,p,i)=>s+p[0]*r[(i+1)%r.length][1]-r[(i+1)%r.length][0]*p[1],0))/2,0);
  assert.equal(area,256*256-96*96+32*32,'coastline subtraction preserves islands inside water');
  const mid=compileScenery('0_0',[tile],'mid',tools),far=compileScenery('0_0',[tile],'far',tools);
  assert.equal(mid.buildings,2);assert.equal(far.buildings,1);
  assert.equal(mid.layers.find(l=>l.kind==='roads').index.length,12,'tunnels never appear as surface strips');
  assert.equal(far.layers.find(l=>l.kind==='roads').index.length,6,'far roads omit side streets');
  for(const c of [mid,far]) {
    const decoded=prepareSceneryGeometry(decodeScenery(encodeScenery(c)));
    assert.equal(decoded.triangles,c.layers.reduce((n,l)=>n+l.index.length/3,0));
    for(const layer of decoded.layers) {
      assert(layer.bounds.radius>0);
      assert.deepEqual(layer.renderIndex,layer.index);
      for(let i=0;i<layer.position.length;i+=3)assert(Math.hypot(...layer.position.slice(i,i+3).map((v,j)=>v-layer.bounds.center[j]))<=layer.bounds.radius+1e-4);
    }
    assert.equal(decoded.key,c.key);assert.equal(decoded.tier,c.tier);
    assert.deepEqual(decoded.treeTiles,c.treeTiles,'tree records survive worker binary transport');
    assert.deepEqual(decoded.treeTiles[0].trees.map(t=>t.park),[true,false],'park forms and valid street trees reach distant chunks');
    c.layers.forEach((layer,i)=>{
      assert.deepEqual([...decoded.layers[i].index],layer.index);
      assert.deepEqual(decoded.layers[i].features,layer.features);
      assert(decoded.layers[i].position.every(Number.isFinite));
      assert(!('colliders' in decoded.layers[i]));
      if(layer.kind!=='buildings')assert(decoded.layers[i].normal.every((n,j)=>j%3!==1||n===127),'horizontal faces point up');
    });
  }
  assert.throws(()=>decodeScenery(new ArrayBuffer(3)),/size/);
  const malformed=encodeScenery(mid);new DataView(malformed).setUint32(0,0xffffffff,true);
  assert.throws(()=>decodeScenery(malformed),/header/);
  assert(sceneryChunks(['-1_-1']).has('-1_-1'),'negative coordinates use floor, not truncation');
}
{
  const keys=['0_0','1_0','0_1','1_1'];
  const tiles=await readSceneryTiles(publicDir,keys);
  const mid=compileScenery('0_0',tiles,'mid',tools),far=compileScenery('0_0',tiles,'far',tools);
  const triangles=c=>c.layers.reduce((n,l)=>n+l.index.length/3,0);
  assert(triangles(far)<triangles(mid));
  assert(decodeScenery(encodeScenery(mid)).buildings>50);
  console.log(`PASS real Midtown prebuilt scenery: ${triangles(mid)} mid / ${triangles(far)} far triangles, no scene builders or colliders`);
  const directory=await mkdtemp(path.join(tmpdir(),'nyc-scenery-test-'));
  try {
    await mkdir(path.join(directory,'scenery'));
    const manifest={version:1,chunkSize:1024,revision:'fixture',chunks:[{key:'0_0'}]};
    await writeFile(path.join(directory,'scenery/manifest.json'),JSON.stringify(manifest));
    const encoded=gzipSync(new Uint8Array(encodeScenery(mid)));
    await writeFile(path.join(directory,'scenery/0_0.mid.bin.gz'),encoded);
    const service=createSceneryService('/missing-source-world',directory);
    assert.equal((await service('world/world/lod/manifest.json')).status,200,'production reads prepared files without original tile decode');
    const response=await service('world/world/lod/0_0.mid.bin');
    assert.equal(response.headers.get('content-encoding'),null);
    const body=gunzipSync(Buffer.from(await response.arrayBuffer()));
    assert.equal(body.length,encodeScenery(mid).byteLength);
    assert.equal((await service('world/world/lod/0_0.mid.bin',{method:'HEAD'})).headers.get('content-length'),String(encoded.length));
    assert.equal((await service('world/world/lod/99_99.mid.bin')).status,404);
    assert.equal(await service('world/world/lod/../../secret'),null);
  }finally{await rm(directory,{recursive:true,force:true});}
}
// Both proxy tiers must inherit the actual detailed baker's palette, including
// per-building variation, reclassified row houses and independently colored roofs.
{
  const styles=await import(new URL('styles-CD9VAM0e.js',assets));
  const roofs=await import(new URL('builder-Ct8y1lc-.js',assets));
  const sample=empty();
  sample.buildings=['brick','brownstone','limestone','castiron','prewar-office','glass','concrete','modern-brick','industrial','civic','shed']
    .flatMap((style,i)=>Array.from({length:4},(_,j)=>({id:1000+i*4+j,style,height:24,floors:6,bldgClass:'C0',footprint:[square(i*20,j*30,12)]})));
  for(const tier of ['mid','far']) {
    const layer=compileScenery('0_0',[sample],tier,tools).layers.find(l=>l.kind==='buildings');
    for(const feature of layer.features) {
      const building=sample.buildings.find(b=>b.id===feature.id),seed=styles.p(building.id);
      const wall=styles.i(building,seed).tint,roof=roofs.i(seed,roofs.r(seed));
      for(const vertex of layer.index.slice(feature.start,feature.start+feature.count)) {
        const expected=layer.normal[vertex*3+1]===127?roof:wall;
        for(let c=0;c<3;c++) assert(Math.abs(layer.color[vertex*3+c]/255-expected[c])<=.5/255+1e-7,`${tier} ${building.style} color channel ${c}`);
      }
    }
  }
}
// Classifying parks must preserve land area, park holes and coastal water cuts.
{
  const sample=empty();sample.parks=[[square(0,0,128),square(16,16,16)]];
  sample.water=[[square(64,0,128)]];
  const faces=landFaces(sample,tools.inside,true);
  const area=ring=>Math.abs(ring.reduce((s,p,i)=>s+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0))/2;
  assert.equal(faces.reduce((sum,f)=>sum+area(f),0),256*256-128*128);
  assert.equal(faces.filter(f=>f.grass).reduce((sum,f)=>sum+area(f),0),64*128-16*16);
  const ground=compileScenery('0_0',[sample],'mid',tools).layers.find(l=>l.kind==='ground');
  assert(ground.color.some((c,i)=>i%3===1&&c===255),'parks reach the shader as grass');
}
function fixture({bytes=1000,requests=2,triangles=Infinity}={}) {
  let time=0,changes=0;
  const pending=[],removed=[],published=[];
  const stream=createSceneryStream({budget:{distance:2200,middle:800,chunks:12,bytes,requests,triangles},now:()=>time,
    fetchChunk:(key,tier,signal)=>new Promise((resolve,reject)=>{pending.push({key,tier,signal,resolve,reject});signal.addEventListener('abort',()=>reject(Error('aborted')));}),
    publish:data=>{changes++;published.push(data);return data;},remove:handle=>{changes++;removed.push(handle);}});
  stream.setManifest({chunks:Array.from({length:25},(_,i)=>({key:`${i-12}_0`}))});
  const tick=async(x=128,allowed=true)=>{time+=100;const before=changes;stream.update(x,128,allowed);await Promise.resolve();await Promise.resolve();assert(changes-before<=2,'at most one replacement (add + remove) per frame');assert(stream.stats.bytes<=bytes);assert(stream.stats.triangles<=triangles);assert(stream.stats.inFlight<=requests);};
  const land=()=>{for(const p of pending.splice(0))p.resolve({key:p.key,tier:p.tier,byteLength:100,triangles:1000});};
  return{stream,pending,published,removed,tick,land};
}
{
  const f=fixture();await f.tick();assert.equal(f.pending[0].key,'0_0');
  f.land();await f.tick(128,false);assert.equal(f.published.length,0,'scene pressure holds replies without opening extra request slots');
  await f.tick();assert.equal(f.published[0].key,'0_0');
  for(let i=0;i<12;i++){f.land();await f.tick();}
  assert(f.stream.resident.size>2);
  const before=f.published.length;await f.tick(8300);f.land();
  for(let i=0;i<4;i++){await f.tick(8300);f.land();}
  assert(f.published.slice(before).some(c=>c.key==='8_0'),'teleport destination bypasses the retirement backlog');
  for(let i=0;i<50;i++){f.land();await f.tick(i%2?128:8300);}
  f.stream.dispose();assert.equal(f.stream.stats.bytes,0);assert.equal(f.stream.resident.size,0);
  f.land();await Promise.resolve();assert.equal(f.stream.resident.size,0,'late replies cannot resurrect disposed chunks');
}
{
  const f=fixture({triangles:2500});
  for(let i=0;i<40;i++){f.land();await f.tick();}
  assert(f.stream.resident.size<=2,'triangle budget applies independently of memory');
  assert(f.stream.resident.has('0_0'),'closest chunk survives triangle pressure');
  f.stream.dispose();assert.equal(f.stream.stats.triangles,0);
}
{
  const f=fixture({bytes:250});
  for(let i=0;i<40;i++){f.land();await f.tick();}
  assert(f.stream.resident.size<=2,'byte cap applies independently of chunk count');
  assert(f.stream.resident.has('0_0'),'closest chunk survives memory pressure');f.stream.dispose();
}
{
  const f=fixture();for(let i=0;i<8;i++){f.land();await f.tick();}
  const original=f.stream.resident.get('1_0');assert.equal(original.tier,'far');
  await f.tick(700);assert.equal(f.stream.resident.get('1_0'),original,'keep the far mesh while its mid replacement is downloading');
  f.land();for(let i=0;i<6;i++){await f.tick(700);f.land();}
  assert.equal(f.stream.resident.get('1_0').tier,'mid');assert(f.removed.includes(original.handle));
  f.stream.dispose();
}
{
  const {nearSceneryCoverage,createScenery}=await import(new URL('scenery.js',assets));
  const {Z:Group}=await import(new URL('textureRelease-2U-gT89r.js',assets));
  for(const [level,ios,expected] of [['mobile',false,[875,3500]],['mobile',true,[625,2500]],['high',false,[180,700]]]) {
    const fog={isFog:true,near:180,far:700};
    const context={quality:{level,farDistance:ios?2500:3500},world:{ios},worldGroup:new Group(),scene:{fog}};
    const scenery=createScenery(context);
    assert.deepEqual([fog.near,fog.far],expected,'near and far mobile objects use one atmosphere');
    scenery.dispose();
    assert.deepEqual([fog.near,fog.far],[180,700],'disposing scenery restores the original fog');
    assert.equal(context.worldGroup.children.length,0);
  }
  const coverage=nearSceneryCoverage({children:[{name:'buildings',visible:true,children:[{name:'bld-0_0',visible:true}]},
    {name:'streets',visible:true,children:[{name:'streets:1_0',visible:false}]},
    {name:'environment',visible:true,children:[{name:'env-ground-0_0',visible:true}]}]});
  assert(coverage.buildings.has('0_0'));assert(coverage.ground.has('0_0'));assert.equal(coverage.roads.size,0);
  const source=await readFile(new URL('buildings-BDmduZ8y.js',assets),'utf8');
  assert(source.includes('x=$createScenery(t,y)'),'served client replaces the all-world skyline worker');
  assert(sceneryBudget(true,2500).bytes<sceneryBudget(false,6000).bytes);
  const ios=sceneryBudget(true,2500,true);
  assert.equal(ios.bytes,8*1024*1024);assert.equal(ios.distance,2500);assert.equal(ios.triangles,80000);
}
console.log('PASS scenery binary format, coastline holes, tiers, production serving, bounded streaming, teleports, cancellation and visible-mesh handoff');

// CPU backing arrays, copied draw indices and GPU uploads all count as resident.
{
  const {prepareSceneryGeometry,compactSceneryIndex}=await import('../static/world/assets/scenery-format.js');
  const sample=empty();sample.buildings=[{id:1,height:30,footprint:[square(0,0,20)]},{id:2,height:50,footprint:[square(40,0,20)]}];
  const chunk=prepareSceneryGeometry(decodeScenery(encodeScenery(compileScenery('0_0',[sample],'mid',tools))));
  assert.equal(chunk.residentBytes,chunk.byteLength+chunk.gpuBytes);assert(chunk.gpuBytes>0);
  const layer=chunk.layers.find(l=>l.kind==='buildings');layer.sourceIndex=layer.index;
  const original=layer.index.slice(),coverage=new Float32Array(16);
  assert.equal(compactSceneryIndex(layer,coverage,new Set()),original.length);
  coverage[0]=1;assert.equal(compactSceneryIndex(layer,coverage,new Set()),0,'covered owners submit no triangles');
  coverage[0]=0;
  const count=compactSceneryIndex(layer,coverage,new Set([1]));
  assert.equal(count,original.length-layer.features[0].count,'built landmark is removed from submissions');
  assert.equal(compactSceneryIndex(layer,coverage,new Set()),original.length,'retired landmarks restore proxy');
  assert.deepEqual(layer.renderIndex,original);
}
{
  let time=0;const requests=[],published=[];
  const stream=createSceneryStream({budget:{distance:1000,middle:500,chunks:2,requests:1,bytes:100,
    triangles:100,decodeBytes:30,peakBytes:190},now:()=>time,
    fetchChunk:(key,tier)=>new Promise(resolve=>requests.push({key,tier,resolve})),
    publish:data=>{published.push(data);return data},remove:()=>{}});
  stream.setManifest({chunks:[{key:'0_0'}]});
  stream.update(0,0);assert.equal(stream.stats.reservedBytes,90);
  requests.shift().resolve({byteLength:70,residentBytes:140,triangles:80});await Promise.resolve();
  time+=100;stream.update(0,0);assert.equal(published.length,0,'GPU copy exceeds resident cap');
  assert.equal(requests[0].tier,'far','oversized mid falls back immediately');
  requests.shift().resolve({byteLength:30,residentBytes:60,triangles:40});await Promise.resolve();
  time+=100;stream.update(0,0);assert.equal(stream.stats.bytes,60);
  assert.equal(stream.stats.downgraded,1);assert.equal(stream.stats.reservedBytes,60);
  stream.dispose();assert.equal(stream.stats.reservedBytes,0);
}
console.log('PASS scenery CPU/GPU accounting, decode reservations, coarse fallback and hidden-geometry compaction');
