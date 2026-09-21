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
for(const key of ['-1_-1','0_-1','1_-1','-1_0','0_0','1_0','-1_1','0_1','1_1','0_-3','1_-3']) {
  const tiles=await readSceneryTiles(publicDir,chunks.get(key));entries.push({key});
  for(const tier of ['mid','far'])data.set(`/world/world/lod/${key}.${tier}.bin`,gzipSync(new Uint8Array(encodeScenery(compileScenery(key,tiles,tier,tools)))));
}
const level=process.env.SCENERY_QUALITY??'mobile';
const ios=process.env.SCENERY_IOS==='1';
const html=`<body style="margin:0"><script type="module">
import {WebGLRenderer} from '/world/assets/main-D_3aygO4.js';
import {Zn as Scene,Ut as PerspectiveCamera,Z as Group,$ as HemisphereLight,z as DirectionalLight,w as Color,g as BufferGeometry,h as BufferAttribute,kt as Mesh} from '/world/assets/textureRelease-2U-gT89r.js';
import {createScenery} from '/world/assets/scenery.js';
import {createTreesTest,leafRecipe,crownRecipe,finishRecipe} from '/world/assets/environment-WQwLg8tn.js';
import {createFacadeTest,createFacadeUniformsTest} from '/world/assets/buildings-BDmduZ8y.js';
import {createLandmarkFacadeTest,createLandmarkUniformsTest} from '/world/assets/landmarks-KpQKy0CX.js';
window.errors=[];const report=console.error;console.error=(...args)=>{window.errors.push(args.map(String).join(' '));report(...args)};
const renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(960,640);document.body.appendChild(renderer.domElement);
const scene=new Scene();scene.background=new Color(0x9ab2c5);scene.add(new HemisphereLight(0xffffff,0x666666,2));const light=new DirectionalLight(0xffffff,2);light.position.set(100,300,100);scene.add(light);
const camera=new PerspectiveCamera(65,1.5,.1,10000);camera.position.set(512,500,1400);camera.lookAt(512,0,-1200);
const worldGroup=new Group();scene.add(worldGroup);const built=new Set();
const ctx={quality:{level:${JSON.stringify(level)},farDistance:${ios?5000:6000}},world:{baseUrl:'/world/world',ios:${ios}},worldGroup,scene,camera,time:{daylight:1},busy:10};
window.__ready=true;const lod=createScenery(ctx,built);
function frame(){lod.update();renderer.render(scene,camera);requestAnimationFrame(frame)}frame();
window.inspect=()=>({stats:lod.stats,triangles:renderer.info.render.triangles,calls:renderer.info.render.calls,errors:window.errors,basic:lod.group.children.every(c=>c.children.every(m=>m.material.isMeshBasicMaterial))});
// Isolate window emission on a known facade: most wall pixels must retain their
// color, roofs must not emit, and unresolved windows must fade away.
window.wallColors=()=>{
  const lights=scene.children.filter(c=>c.isLight),intensities=lights.map(l=>l.intensity);
  lights.forEach(l=>l.intensity*=.04);
  const fixture=new Scene();fixture.background=new Color(0);
  fixture.add(new HemisphereLight(0xffffff,0x666666,.08));
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(new Float32Array([464,0,0,560,0,0,560,64,0,464,64,0]),3));
  geometry.setAttribute('normal',new BufferAttribute(new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1]),3));
  geometry.setAttribute('color',new BufferAttribute(new Float32Array(Array.from({length:4},()=>[.55,.25,.18]).flat()),3));
  geometry.setAttribute('aOwner',new BufferAttribute(new Float32Array(4),1));
  geometry.setIndex([0,1,2,0,2,3]);
  const material=lod.group.children.flatMap(c=>c.children).find(m=>m.userData.kind==='buildings').material;
  const mesh=new Mesh(geometry,material);fixture.add(mesh);
  const view=new PerspectiveCamera(65,1.5,.1,10000);view.position.set(512,32,120);view.lookAt(512,32,0);
  const snapshot=daylight=>{
    ctx.time.daylight=daylight;lod.update();material.userData.lodCoverage.value=new Float32Array(16);
    renderer.render(fixture,view);
    const gl=renderer.getContext(),pixels=new Uint8Array(960*640*4);
    gl.readPixels(0,0,960,640,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;
  };
  const difference=(a,b)=>{
    let wall=0,changed=0;
    for(let i=0;i<a.length;i+=4){
      if(a[i]+a[i+1]+a[i+2]>0)wall++;
      if(Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]-b[i+c])))>1)changed++;
    }
    return {wall,changed};
  };
  const windows=difference(snapshot(1),snapshot(0));
  geometry.attributes.normal.array.set([0,1,0,0,1,0,0,1,0,0,1,0]);geometry.attributes.normal.needsUpdate=true;
  const roof=difference(snapshot(1),snapshot(0));
  geometry.attributes.normal.array.set([0,0,1,0,0,1,0,0,1,0,0,1]);geometry.attributes.normal.needsUpdate=true;
  view.position.z=2200;
  const distant=difference(snapshot(1),snapshot(0));
  geometry.dispose();
  ctx.time.daylight=1;lights.forEach((l,i)=>l.intensity=intensities[i]);lod.update();renderer.render(scene,camera);
  return {windows,roof,distant};
};
window.handoff=()=>{const root=new Group();root.name='buildings';const mesh=new Group();mesh.name='bld-0_0';root.add(mesh);worldGroup.add(root);lod.update();
const proxies=lod.group.children.flatMap(c=>c.children).filter(m=>m.userData.kind==='buildings'&&m.userData.tiles.includes('0_0'));
if(!proxies.length)throw Error('missing proxy');if(!proxies.every(m=>m.userData.coverage[m.userData.tiles.indexOf('0_0')]===1))throw Error('near mesh did not cover proxy');if(ctx.quality.level==='mobile')for(const m of proxies){const owner=m.userData.tiles.indexOf('0_0');if(m.geometry.index.array.slice(0,m.geometry.drawRange.count).some(v=>m.userData.owner[v]===owner))throw Error('covered tile still submitted');}
root.removeFromParent();lod.update();if(!proxies.every(m=>m.userData.coverage[m.userData.tiles.indexOf('0_0')]===0))throw Error('unload did not restore proxy');
const proxy=proxies[0],f=proxy.userData.features[0];built.add(f.id);lod.syncLandmarks();
if(ctx.quality.level==='mobile') {
  const hidden=new Set(proxy.userData.sourceIndex.slice(f.start,f.start+f.count));
  if(proxy.geometry.index.array.slice(0,proxy.geometry.drawRange.count).some(v=>hidden.has(v)))throw Error('landmark submitted twice');
} else if(!proxy.geometry.index.array.slice(f.start,f.start+f.count).every(v=>v===0))throw Error('landmark double rendering');
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
${readFileSync(new URL('./tree-browser-fixture.js',import.meta.url),'utf8')}
${readFileSync(new URL('./facade-browser-fixture.js',import.meta.url),'utf8')}
${readFileSync(new URL('./building-lod-browser-fixture.js',import.meta.url),'utf8')}
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
    if(name==='buildings-BDmduZ8y.js')source+='\nexport {ue as createFacadeTest,le as createFacadeUniformsTest};';
    if(name==='landmarks-KpQKy0CX.js')source+='\nexport {et as createLandmarkFacadeTest,Ye as createLandmarkUniformsTest};';
    if(name==='environment-WQwLg8tn.js')source+='\nexport {qt as createTreesTest,ct as leafRecipe,lt as crownRecipe,mt as finishRecipe};';
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
    if(result?.stats.chunks===entries.length&&result.stats.inFlight===0)break;
  }
  if(ios){assert.equal(result?.stats.chunks,entries.length,JSON.stringify(result));assert(result.stats.bytes<=32*1024*1024);assert(result.stats.triangles<=320000);}else assert.equal(result?.stats.chunks,entries.length,JSON.stringify(result));assert.deepEqual(result.errors,[]);
  assert.equal(result.basic,level==='mobile','only mobile uses the cheaper vertex-lit shader');
  if(level==='mobile')assert(result.stats.triangles<=480000,'mobile resident triangles stay bounded');
  assert(result.triangles>1000);assert(result.calls<=entries.length*3,'merged chunks use at most three draw calls each');
  const colors=await evaluate('window.wallColors()');
  assert(colors.windows.wall>1000&&colors.windows.changed>100,JSON.stringify(colors));
  assert(colors.windows.changed/colors.windows.wall<.2,'lit windows leave most wall pixels unchanged');
  assert(colors.roof.wall>1000&&colors.roof.changed===0,'roofs never receive window lights');
  assert(colors.distant.wall>0&&colors.distant.changed===0,'subpixel windows fade without a whole-wall glow');
  const trees=await evaluate('window.testTrees()');
  assert(Math.abs(trees.pitDirection[0]-trees.pitDirection[1])<1e-6,'rendered pit follows the diagonal sidewalk');
  if(trees.guardDirection)assert.deepEqual(trees.guardDirection,trees.pitDirection,'guard and pit share the same orientation');
  for(const [band,name] of [['near','leaves'],['middle','middle'],['far','far'],['extended','far'],['restored','far'],['fallback','far']]) {
    assert.equal(trees[band].batches['env-tree-plane-'+name],1,JSON.stringify(trees[band]));
  }
  assert(trees.middle.triangles<trees.near.triangles/2,'middle trees use a bounded subset of real leaf clusters');
  assert(trees.far.triangles<trees.middle.triangles/4,'far trees stay cheap');
  assert.equal(trees.far.batches['env-tree-plane-far-wood'],1,'far crowns retain their trunks');
  assert.deepEqual(trees.unloaded.batches,{});assert.equal(trees.remaining,0,'tree batches retire cleanly');
  assert.deepEqual(trees.reduced.batches,{},'stationary camera responds immediately to reduced tree range');
  const treeCount=Object.entries(trees.streamed.batches).filter(([name])=>/-(leaves|middle|far)$/.test(name)).reduce((sum,[,n])=>sum+n,0);
  assert(treeCount>10&&treeCount<=(ios?4000:level==='mobile'?8000:10000),'real scenery populates bounded tree instances');
  for(const [band,shot] of Object.entries(trees.shots))writeFileSync(`${tmpdir()}/nyc-trees-${level}-${band}.png`,Buffer.from(shot.split(',')[1],'base64'));
  assert.deepEqual(await evaluate('window.errors'),[],'all tree LOD shaders compile');
  const facade=await evaluate('window.testFacadeLights()');
  for(const type of ['homes','offices','landmark']){
    assert.equal(facade[type].day,0,'window lights turn off during daylight');
    assert(facade[type].night>1000&&facade[type].night<120000,JSON.stringify(facade));
    assert(facade[type].warm>100&&facade[type].cool>100,JSON.stringify(facade));
    assert(facade[type].stable,'mobile window lights do not animate or flicker');
  }
  for(const face of ['party','roof','unresolved'])assert.equal(facade[face],0,`${face} never receives window glow`);
  assert.equal(facade.landmarkUnresolved,0,'custom towers lose subpixel window glow');
  assert.deepEqual(await evaluate('window.errors'),[],'mobile facade shader compiles');
  const surfaceLod=await evaluate('window.testFacadeSurfaceLod()');
  for(const [kind,levels] of Object.entries(surfaceLod)){
    for(const point of ['street','flying','crown'])assert(levels[point][0]>245,`${kind} ${point}: nearby surface retains detail`);
    for(const point of ['upperFromStreet','lowerFromAir','horizontal','outside']){
      assert.equal(levels[point][0],0,`${kind} ${point}: distant surface skips detail`);
      assert.equal(levels[point][1],255,'probe rendered the wall, not the background');
    }
    assert(levels.transition[0]>0&&levels.transition[0]<245,`${kind}: smooth transition`);
  }
  assert.deepEqual(await evaluate('window.errors'),[],'surface LOD compiles for ordinary buildings and ESB');
  console.log('PASS WebGL facade surface LOD: street, flight and crown proximity; distant floors, horizontal distance and smooth fade');
  console.log('PASS WebGL mobile window lights: sparse warm/cool windows, daylight, stable occupancy, blank walls, roofs and subpixel fade');
  const building=await call('Runtime.evaluate',{expression:'window.testBuildingWorker()',awaitPromise:true,returnByValue:true});
  assert(!building.exceptionDetails,JSON.stringify(building.exceptionDetails));
  assert(building.result.value.triangles>0&&building.result.value.colored>1000&&building.result.value.colliders>0,JSON.stringify(building));
  assert.deepEqual(await evaluate('window.errors'),[],'packed building geometry renders with the mobile facade shader');
  console.log('PASS WebGL packed building worker: transferred geometry, normalized colors/normals, mobile shader, visible tower and collision');
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
