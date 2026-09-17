// Actual WebGL shader compilation and scene lifecycle, using the shipped Three
// and LOD runtime. Software rendering is a correctness check, not an FPS test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { assets } from './sveltekit-assets.mjs';
import { sceneryTools, sceneryChunks, compileScenery, readSceneryTiles } from '../src/lib/server/scenery-compiler.js';
import { encodeScenery } from '../static/world/assets/scenery-format.js';
const publicDir=new URL('../../public/',import.meta.url).pathname;
const tools=await sceneryTools(publicDir),index=JSON.parse(readFileSync(`${publicDir}world/world/index.json`));
const chunks=sceneryChunks(index.tiles),data=new Map(),entries=[];
for(const key of ['-1_-1','0_-1','1_-1','-1_0','0_0','1_0','-1_1','0_1','1_1']) {
  const tiles=await readSceneryTiles(publicDir,chunks.get(key));entries.push({key});
  for(const tier of ['mid','far'])data.set(`/world/world/lod/${key}.${tier}.bin`,gzipSync(new Uint8Array(encodeScenery(compileScenery(key,tiles,tier,tools)))));
}
const level=process.env.SCENERY_QUALITY??'mobile';
const ios=process.env.SCENERY_IOS==='1';
const html=`<body style="margin:0"><script type="module">
import {WebGLRenderer} from '/world/assets/main-D_3aygO4.js';
import {Zn as Scene,Ut as PerspectiveCamera,Z as Group,$ as HemisphereLight,z as DirectionalLight,w as Color} from '/world/assets/textureRelease-2U-gT89r.js';
import {createScenery} from '/world/assets/scenery.js';
window.errors=[];const report=console.error;console.error=(...args)=>{window.errors.push(args.map(String).join(' '));report(...args)};
const renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(960,640);document.body.appendChild(renderer.domElement);
const scene=new Scene();scene.background=new Color(0x9ab2c5);scene.add(new HemisphereLight(0xffffff,0x666666,2));const light=new DirectionalLight(0xffffff,2);light.position.set(100,300,100);scene.add(light);
const camera=new PerspectiveCamera(65,1.5,.1,10000);camera.position.set(512,500,1400);camera.lookAt(512,0,-1200);
const worldGroup=new Group();scene.add(worldGroup);const built=new Set();
const ctx={quality:{level:${JSON.stringify(level)},farDistance:${ios?1500:2500}},world:{baseUrl:'/world/world',ios:${ios}},worldGroup,scene,camera,time:{daylight:1},busy:10};
window.__ready=true;const lod=createScenery(ctx,built);
function frame(){lod.update();renderer.render(scene,camera);requestAnimationFrame(frame)}frame();
window.inspect=()=>({stats:lod.stats,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,errors:window.errors,basic:lod.group.children.every(c=>c.children.every(m=>m.material.isMeshBasicMaterial))});
window.handoff=()=>{const root=new Group();root.name='buildings';const mesh=new Group();mesh.name='bld-0_0';root.add(mesh);worldGroup.add(root);lod.update();
const proxies=lod.group.children.flatMap(c=>c.children).filter(m=>m.userData.kind==='buildings'&&m.userData.tiles.includes('0_0'));
if(!proxies.length)throw Error('missing proxy');if(!proxies.every(m=>m.userData.coverage[m.userData.tiles.indexOf('0_0')]===1))throw Error('near mesh did not cover proxy');
root.removeFromParent();lod.update();if(!proxies.every(m=>m.userData.coverage[m.userData.tiles.indexOf('0_0')]===0))throw Error('unload did not restore proxy');
const proxy=proxies[0],f=proxy.userData.features[0];built.add(f.id);lod.syncLandmarks();if(!proxy.geometry.index.array.slice(f.start,f.start+f.count).every(v=>v===0))throw Error('landmark double rendering');
built.clear();lod.syncLandmarks();return true;};
window.travel=async()=>{
ctx.busy=0;const samples=[];
const wait=async(predicate)=>{const until=performance.now()+15000;while(!predicate()){if(performance.now()>until)throw Error('travel timeout');await new Promise(r=>setTimeout(r,50));}};
for(let i=0;i<5;i++){
  camera.position.set(20000,500,20000);
  await wait(()=>lod.stats.chunks===0&&lod.stats.inFlight===0);
  renderer.render(scene,camera);samples.push(renderer.info.memory.geometries);
  if(renderer.info.memory.geometries!==0)throw Error('retired GPU geometry survived travel');
  camera.position.set(512,500,1400);camera.lookAt(512,0,-1200);
  await wait(()=>lod.stats.chunks>0&&lod.stats.inFlight===0);
}
return samples;
};
window.finish=()=>{lod.dispose();renderer.render(scene,camera);return{children:worldGroup.children.length,geometries:renderer.info.memory.geometries};};
</script>`;
const server=createServer((req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
    if(path.endsWith('/manifest.json')){res.setHeader('content-type','application/json');res.end(JSON.stringify({version:1,chunkSize:1024,revision:'browser',chunks:entries}));return;}
    if(data.has(path)){res.setHeader('content-type','application/gzip');res.end(data.get(path));return;}
    if(!path.startsWith('/world/assets/')){res.writeHead(404);res.end();return;}
    const name=path.slice('/world/assets/'.length);let source=readFileSync(new URL(name,assets),'utf8');
    if(name==='main-D_3aygO4.js')source+='\nexport {ea as WebGLRenderer};';
    if(name==='index-DQv-X5z6.js')source=source.replace('z().catch(e=>','Promise.resolve().catch(e=>');
    res.setHeader('content-type','text/javascript');res.end(source);
  }catch(error){res.writeHead(404);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=mkdtempSync(`${tmpdir()}/nyc-scenery-browser-`);
const chrome=spawn(process.env.CHROMIUM??'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0','--no-first-run',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;
try{
  const endpoint=await new Promise((resolve,reject)=>{
    let stderr='';const timer=setTimeout(()=>reject(Error('Chromium did not start')),20000);
    chrome.once('error',e=>{clearTimeout(timer);reject(e)});
    chrome.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(new URL(match[1]));}});
  });
  const pages=await(await fetch(`http://${endpoint.host}/json/list`)).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise(resolve=>socket.onopen=resolve);
  let sequence=0;const pending=new Map(),errors=[];
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true});assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result?.value;};
  await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:960,height:640,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  let result;
  for(let i=0;i<160;i++){
    await new Promise(r=>setTimeout(r,250));assert.equal(errors.length,0,errors.join('\n'));
    result=await evaluate('window.inspect?.()');
    if(result?.stats.chunks>0&&( ios ? result.stats.inFlight===0 : result.stats.chunks===9))break;
  }
  if(ios){assert(result?.stats.chunks>0,JSON.stringify(result));assert(result.stats.bytes<=8*1024*1024);assert(result.stats.triangles<=80000);}else assert.equal(result?.stats.chunks,9,JSON.stringify(result));assert.deepEqual(result.errors,[]);
  assert.equal(result.basic,level==='mobile','only mobile uses the cheaper vertex-lit shader');
  if(level==='mobile')assert(result.stats.triangles<=160000,'mobile resident triangles stay bounded');
  assert(result.triangles>1000);assert(result.calls<=27,'merged chunks use at most three draw calls each');
  assert(await evaluate('window.handoff()'));
  const shot=await call('Page.captureScreenshot',{format:'png'});
  const screenshot=process.env.SCENERY_SCREENSHOT??`${tmpdir()}/nyc-scenery.png`;
  writeFileSync(screenshot,Buffer.from(shot.data,'base64'));
  if(ios){const travel=await call('Runtime.evaluate',{expression:'window.travel()',awaitPromise:true,returnByValue:true});assert(!travel.exceptionDetails,JSON.stringify(travel.exceptionDetails));assert.deepEqual(travel.result.value,[0,0,0,0,0]);}
  const disposed=await evaluate('window.finish()');assert.equal(disposed.children,0);assert.equal(disposed.geometries,0);
  console.log(`PASS WebGL ${ios?'iOS':level} scenery: ${result.triangles} triangles / ${result.calls} draws; near handoff, landmark replacement, disposal; ${screenshot}`);
}finally{
  const closed=new Promise(resolve=>chrome.once('close',resolve));
  if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id:999999,method:'Browser.close'}));
  else chrome.kill();
  const killTimer=setTimeout(()=>chrome.kill('SIGKILL'),5000);
  await closed;clearTimeout(killTimer);socket?.close();server.close();
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
