import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assets } from './sveltekit-assets.mjs';
import { rendererDiagnostics } from '../static/world/assets/renderer-diagnostics.js';
const {Z:Group,g:Geometry,h:Attribute,kt:Mesh,rt:InstancedMesh,Pt:Material} =
  await import(new URL('textureRelease-2U-gT89r.js',assets));

const scene=new Group(),worldGroup=new Group(),buildings=new Group(),trees=new Group();
buildings.name='buildings';trees.name='trees';scene.add(worldGroup);worldGroup.add(buildings,trees);
const geometry=new Geometry(),positions=new Float32Array(18),indices=new Uint16Array([0,1,2]);
geometry.setAttribute('position',new Attribute(positions.subarray(0,9),3));
geometry.setAttribute('normal',new Attribute(positions.subarray(9),3));
geometry.setIndex(new Attribute(indices,1));
const material=new Material(),instances=new InstancedMesh(geometry,material,4);
buildings.add(new Mesh(geometry,material),new Mesh(geometry,material));trees.add(instances);
const ctx={scene,worldGroup,quality:{level:'mobile'},world:{ios:true,tiles:new Map([['0_0',{}]])},
  camera:{position:{x:1.2,y:4,z:-8.9}},renderer:{info:{render:{calls:3,triangles:9}}}};
const report=rendererDiagnostics(ctx),baseBytes=positions.byteLength+indices.byteLength;
assert.equal(report.sceneBufferBytes,baseBytes+instances.instanceMatrix.array.byteLength);
assert.deepEqual(report.sceneBuffersByGroup,[['trees',256],['buildings',baseBytes]]);
assert.equal(report.ios,true);assert.equal(report.tiles,1);assert.equal(report.calls,3);
assert.deepEqual(report.position,[1,4,-9]);
assert.equal(rendererDiagnostics(ctx).sceneBufferBytes,report.sceneBufferBytes,'sampling is read-only');
ctx.modules=new Map([['buildings',{stats:{bytes:100,far:{bytes:200,reservedBytes:300,downgraded:2}}}]]);
const budgets=rendererDiagnostics(ctx);assert.equal(budgets.buildingCpuBytes,100);assert.equal(budgets.sceneryResidentBytes,200);assert.equal(budgets.sceneryReservedBytes,300);assert.equal(budgets.sceneryDowngrades,2);
assert.equal(rendererDiagnostics({}).sceneBufferBytes,0,'partial startup context is safe');
const main=readFileSync(new URL('main-D_3aygO4.js',assets),'utf8');
assert(main.includes('...$rendererDiagnostics(k)'));
assert(main.includes('h(`webgl_context_lost`,JSON.stringify($rendererDiagnostics(k)));ve.stop()'));
assert(/renderer-diagnostics\.js\?v=/.test(main),'diagnostic helper participates in cache invalidation');
instances.dispose();geometry.dispose();material.dispose();
console.log('PASS renderer diagnostics: shared-buffer accounting, module totals, startup and context-loss wiring');

// Execute the served beacon: rendering JSON survives, arbitrary stage text stays bounded.
const entry=readFileSync(new URL('index-DQv-X5z6.js',assets),'utf8');
const start=entry.indexOf('function k(e,t=``){'),end=entry.indexOf('function A(e,t){',start);
const vm=await import('node:vm');
let sent;
const scope=vm.createContext({v:true,p:'',navigator:{userAgent:'test',sendBeacon:(_url,body)=>{sent=body;return true}},
  l:'test',d:0,performance:{now:()=>0},o:'test',innerWidth:390,innerHeight:844,f:'mobile',S:0,m:'',i:s=>s,Blob});
vm.runInContext(entry.slice(start,end),scope);
const detail=JSON.stringify({...budgets,padding:'x'.repeat(500)});
scope.k('renderer_memory',detail);assert.deepEqual(JSON.parse(JSON.parse(await sent.text()).detail),JSON.parse(detail));
scope.k('other','x'.repeat(1000));assert.equal(JSON.parse(await sent.text()).detail.length,160);
console.log('PASS render telemetry preserves complete bounded JSON');
