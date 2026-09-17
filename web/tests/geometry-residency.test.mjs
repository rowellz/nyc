import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { assets } from './sveltekit-assets.mjs';
import { holdGeometrySlot, releaseGeometryRequest } from '../static/world/assets/geometry-residency.js';
const job = () => {
  let resolve;
  const j={pending:true,done:new Promise(r=>resolve=r),run(){},cancel(){j.pending=false;resolve()}};
  return j;
};
// Execute the served building reply path with a slow/cancelled scene commit.
const buildings=readFileSync(new URL('buildings-BDmduZ8y.js',assets),'utf8');
const start=buildings.indexOf('const $buildingWorkerCount='),end=buildings.indexOf('function M(',start);
for(const level of ['mobile','high']) {
  class Worker { postMessage(){} terminate(){} }
  const slots=[],owners=new Map(),records=new Map();let pumps=0;
  const scope=vm.createContext({Worker,URL,console,t:{quality:{level}},Fe:2,E:slots,k:owners,v:records,D:[],
    P:()=>pumps++,L:()=>null,$holdGeometrySlot:holdGeometrySlot});
  vm.runInContext(buildings.slice(start,end).replaceAll('import.meta.url','"https://test/buildings.js"'),scope);
  for(let i=0;i<100;i++) {
    const j=job(),rec={key:'0_0',pendingId:i+1,job:j};records.set(rec.key,rec);owners.set(i+1,rec);
    slots[0].busy=true;slots[0].id=i+1;
    slots[0].w.onmessage({data:{id:i+1,tile:{}}});
    assert.equal(slots[0].busy,level==='mobile','decoded geometry holds its mobile slot');
    j.cancel();await Promise.resolve();assert.equal(slots[0].busy,false);
    assert(!slots[0].commitJob,'completed/cancelled commits release the job reference');
    assert.equal(owners.size,0);
  }
  const j=job(),rec={key:'0_0',pendingId:200,job:j};owners.set(200,rec);records.set(rec.key,rec);slots[0].id=200;
  slots[0].w.onmessage({data:{id:200,tile:{}}});slots[0].w.onmessageerror();await Promise.resolve();
  if(level==='mobile')assert.equal(j.pending,false,'worker failure also cancels the decoded commit');
}
// The road acceptance path keeps the worker occupied through GPU/physics work.
const roads=readFileSync(new URL('streets-CfYSUqyW.js',assets),'utf8');
const begin=roads.indexOf('const $mobileGeometry='),finish=roads.indexOf('function X()',begin);
for(const level of ['mobile','high']) {
  const active=new Map();let pumps=0;
  const scope=vm.createContext({e:{quality:{level}},G:active,A:false,console,q:()=>true,ne:()=>null,$:()=>pumps++,
    $releaseGeometryRequest:releaseGeometryRequest});
  vm.runInContext(roads.slice(begin,finish),scope);
  for(let i=0;i<100;i++) {
    const j=job(),rec={tile:{key:'0_0'},revision:i},request={rec,revision:i,job:j};active.set(i,request);
    scope.Y({id:i,built:{}});
    assert.equal(active.size,level==='mobile'?1:0);
    j.cancel();await Promise.resolve();assert.equal(active.size,0,'cancelled commits cannot pin an active worker');
  }
}
// A cached warm-up promise may remember completion, but never its first mesh.
const anchor=roads.match(/g=e\.renderer\.compileAsync\(c,e.camera,e.scene\)\.then\(\(\)=>\{\}\),K.set\(C\[t\],g\)/)?.[0];
assert(anchor);
const cache=new Map(),mesh={geometry:new Float32Array(1024*1024)};
const scope=vm.createContext({e:{renderer:{compileAsync:()=>Promise.resolve(mesh)}},c:mesh,K:cache,C:['road'],t:0,g:null});
vm.runInContext(anchor,scope);assert.equal(await cache.get('road'),undefined);
console.log('PASS geometry residency: 200 commit/cancel cycles per worker type, worker failures, desktop concurrency, shader cache releases mesh');
