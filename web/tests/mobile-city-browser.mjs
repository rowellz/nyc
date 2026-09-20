// Full-scene diagnostic against the local dev service. SwiftShader timings are
// not phone FPS; use draw/triangle counts to compare the same camera and scene.
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
const profile=mkdtempSync('/tmp/nyc-city-profile-');
const chrome=spawn(process.env.CHROMIUM??'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0','--no-first-run',`--user-data-dir=${profile}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let socket;
try{
const endpoint=await new Promise((resolve,reject)=>{let stderr='';const timer=setTimeout(()=>reject(Error('Chromium did not start')),20000);chrome.once('error',reject);chrome.stderr.on('data',d=>{stderr+=d;const m=stderr.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(new URL(m[1]));}});});
const pages=await(await fetch(`http://${endpoint.host}/json/list`)).json();socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>socket.onopen=r);
let seq=0;const pending=new Map(),errors=[];
socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
await call('Runtime.enable');
await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await call('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
await call('Page.navigate',{url:process.env.CITY_URL??'http://127.0.0.1:5174/world/?fly=-145,-591,2,0,0&time=12:00&live=0'});
let ready=false;
for(let i=0;i<240;i++){
 await new Promise(r=>setTimeout(r,1000));
 const state=await evaluate(`(()=>{for(const input of document.querySelectorAll('form input')){if(input.type==='text')input.value='Render test';if(input.type==='email')input.value='render-test@example.invalid';if(input.type==='checkbox')input.checked=false;}document.querySelector('form button[type=submit]')?.click();const g=window.__game;return {ready:window.__ready,busy:g?.ctx?.busy,modules:g?[...g.ctx.modules.keys()]:[],text:!g?document.body.innerText.slice(0,150):'',errors:0};})()`);
 if(i%15===0)console.log(JSON.stringify(state));
 if(state.ready&&state.busy===0){ready=true;break;}
 if(errors.length)throw Error(errors.join('\n'));
}
if(!ready)throw Error('City did not become ready');
const result=await evaluate(`(()=>{const {ctx,loop}=window.__game;loop?.stop();const counts={},restore=[];ctx.worldGroup.children.forEach(root=>root.traverse(o=>{if(!o.isMesh)return;const old=o.onBeforeRender;o.onBeforeRender=function(...args){const rec=counts[root.name]??={draws:0,triangles:0,};rec.draws++;const g=o.geometry;rec.triangles+=Math.min(g.drawRange.count,g.index?.count??g.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);old.apply(this,args);};restore.push(()=>o.onBeforeRender=old)}));ctx.renderer.info.reset();ctx.renderer.render(ctx.scene,ctx.camera);restore.forEach(f=>f());return {stats:ctx.stats,submitted:{calls:ctx.renderer.info.render.calls,triangles:ctx.renderer.info.render.triangles},position:ctx.camera.position,counts,rail:ctx.modules.get('rail')?.stats,geometries:ctx.renderer.info.memory.geometries};})()`);
if(errors.length)throw Error(errors.join('\n'));console.log(JSON.stringify(result,null,2));writeFileSync('/tmp/nyc-city-profile.json',JSON.stringify(result,null,2));
const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync('/tmp/nyc-city-profile.png',Buffer.from(shot.data,'base64'));
}finally{
 const closed=new Promise(resolve=>chrome.once('close',resolve));
 if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id:999999,method:'Browser.close'}));else chrome.kill();
 const timer=setTimeout(()=>chrome.kill('SIGKILL'),5000);
 await closed;clearTimeout(timer);socket?.close();
 await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
