import assert from 'node:assert/strict';
import { assets } from './sveltekit-assets.mjs';
import { sceneryTools, readSceneryTiles, sceneryChunks, compileScenery } from '../src/lib/server/scenery-compiler.js';
import { readFileSync } from 'node:fs';
import { encodeScenery, decodeScenery, prepareSceneryGeometry, compactSceneryIndex } from '../static/world/assets/scenery-format.js';

const { createScenery } = await import(new URL('scenery.js', assets));
const { Z:Group } = await import(new URL('textureRelease-2U-gT89r.js', assets));
const publicDir=new URL('../../public/',import.meta.url).pathname;
const tools=await sceneryTools(publicDir);
const chunks=sceneryChunks(JSON.parse(readFileSync(`${publicDir}world/world/index.json`)).tiles);
const keys=['-1_-1','0_-1','-1_0','0_0'];
const data=new Map();
for(const key of keys) {
  const tiles=await readSceneryTiles(publicDir,chunks.get(key));
  for(const tier of ['mid','far'])data.set(`${key}.${tier}`,encodeScenery(compileScenery(key,tiles,tier,tools)));
}
const original={Worker:globalThis.Worker,fetch:globalThis.fetch,__ready:globalThis.__ready};
globalThis.__ready=true;
globalThis.fetch=async()=>({ok:true,json:async()=>({version:1,chunkSize:1024,revision:'test',chunks:keys.map(key=>({key}))})});
globalThis.Worker=class {
  postMessage(message) {
    if(message.type!=='load')return;
    const chunk=prepareSceneryGeometry(decodeScenery(data.get(`${message.key}.${message.tier}`).slice(0)));
    queueMicrotask(()=>this.onmessage({data:{id:message.id,chunk}}));
  }
  terminate(){}
};
try {
  for(const level of ['mobile','high']) {
    const worldGroup=new Group(), scene=new Group(), built=new Set();
    const ctx={worldGroup,scene,quality:{level,farDistance:4000},world:{},camera:{position:{x:0,y:200,z:0}},time:{daylight:1},busy:0};
    const lod=createScenery(ctx,built);
    try {
      for(let i=0;i<30&&lod.stats.chunks<keys.length;i++) {
        lod.update();await new Promise(resolve=>setImmediate(resolve));
      }
      assert.equal(lod.stats.chunks,keys.length);
      const meshes=lod.group.children.flatMap(root=>root.children);
      const versions=()=>meshes.map(mesh=>mesh.geometry.index.version);
      const changed=before=>meshes.filter((mesh,i)=>mesh.geometry.index.version!==before[i]);
      const snapshots=()=>meshes.map(mesh=>mesh.geometry.index.array.slice());
      const verify=()=>{
        for(const mesh of meshes) {
          const {sourceIndex,coverage}=mesh.userData;
          const expected=sourceIndex.slice();
          if(level==='mobile') {
            const count=compactSceneryIndex({...mesh.userData,renderIndex:expected},coverage,built);
            assert.equal(mesh.geometry.drawRange.count,count);
            assert.deepEqual(mesh.geometry.index.array.slice(0,count),expected.slice(0,count));
          } else {
            for(const feature of mesh.userData.features)if(built.has(feature.id))expected.fill(0,feature.start,feature.start+feature.count);
            assert.deepEqual(mesh.geometry.index.array,expected);
          }
        }
      };
      const pristine=snapshots();let before=versions();
      lod.update();lod.syncLandmarks();
      assert.deepEqual(changed(before),[],'steady visibility never reuploads geometry');
      const root=new Group();root.name='buildings';worldGroup.add(root);
      const tile=new Group();tile.name='bld-0_0';root.add(tile);
      lod.update();verify();
      const affected=changed(before);
      assert.equal(affected.length,level==='mobile'?1:0,'a near building tile updates only its own skyline building layer');
      if(level==='mobile') {
        const mesh=affected[0];
        assert.equal(mesh.userData.kind,'buildings');
        assert.deepEqual(mesh.geometry.index.updateRanges,[{start:0,count:mesh.geometry.drawRange.count}],
          'only the live index prefix is marked for GPU upload');
      }
      before=versions();
      // A second tile arrival in an unrelated district changes the global
      // coverage signature, but none of these four chunks owns that tile.
      const unrelated=new Group();unrelated.name='bld-100_100';root.add(unrelated);
      lod.update();assert.deepEqual(changed(before),[],'unrelated arrivals cause zero skyline uploads');
      unrelated.removeFromParent();
      const proxy=meshes.find(m=>m.userData.kind==='buildings'&&!m.userData.tiles.includes('0_0'));
      const feature=proxy.userData.features[0];
      built.add(feature.id);lod.syncLandmarks();verify();
      assert(changed(before).length>0,'committed landmark replaces its proxy');
      assert(changed(before).every(m=>m.userData.features.some(f=>f.id===feature.id)),
        'landmark updates leave every unrelated mesh untouched');
      before=versions();built.add(-999);lod.syncLandmarks();
      assert.deepEqual(changed(before),[],'landmarks outside the resident chunks cause zero uploads');
      built.clear();tile.removeFromParent();lod.update();lod.syncLandmarks();verify();
      assert.deepEqual(snapshots(),pristine,'tile and landmark retirement restore original geometry');
      // Fully covered layers need no index upload; restoring them must upload.
      if(level==='mobile') {
        const mesh=meshes.find(m=>m.userData.kind==='buildings'&&m.userData.tiles.includes('0_0'));
        for(const key of mesh.userData.tiles){const tile=new Group();tile.name=`bld-${key}`;root.add(tile);}
        before=versions();lod.update();verify();
        assert.equal(mesh.geometry.drawRange.count,0);
        assert.deepEqual(changed(before),[],'completely covered geometry is hidden without uploading');
        root.clear();lod.update();verify();
        assert.equal(changed(before).length,1,'restoring a covered chunk uploads only that layer');
      }
      console.log(`PASS ${level} skyline handoff: ${meshes.length} real layers; local arrivals, unrelated tiles, landmark completion, full coverage and restoration`);
    } finally {lod.dispose();}
  }
} finally {
  for(const [key,value] of Object.entries(original))if(value===undefined)delete globalThis[key];else globalThis[key]=value;
}
