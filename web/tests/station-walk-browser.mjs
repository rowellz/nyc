// Optional integration check: Chromium renders the actual station meshes while
// Rapier walks the player's capsule from street to platform and back.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';

const html=readFileSync(new URL('station-walk.html',import.meta.url),'utf8')
 .replaceAll('?v=station-layout-32',`?v=${CLIENT_REVISION}`)
 .replace(/(main-D_3aygO4|textureRelease-2U-gT89r)\.js'/g,`$1.js?v=${CLIENT_REVISION}'`);
const server=createServer((req,res)=>{
 try {
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(path==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
  if(!path.startsWith('/world/assets/'))throw Error('Unknown fixture asset');
  const name=path.slice('/world/assets/'.length);let source=readFileSync(new URL(name,assets),'utf8');
  if(name==='main-D_3aygO4.js')source+='\nexport {ea as WebGLRenderer,ta as RAPIER};';
  if(name==='index-DQv-X5z6.js')source=source.replace('z().catch(e=>','Promise.resolve().catch(e=>');
  res.setHeader('content-type','text/javascript');res.end(source);
 }catch(error){res.writeHead(404);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const chrome=spawn(process.env.CHROMIUM??'/usr/bin/chromium',[
 '--headless=new','--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader',
 '--enable-unsafe-swiftshader','--remote-debugging-port=0','--no-first-run',
 `--user-data-dir=${mkdtempSync(`${tmpdir()}/nyc-station-browser-`)}`,'about:blank',
],{stdio:['ignore','ignore','pipe']});
let socket;
try {
 const endpoint=await new Promise((resolve,reject)=>{
  let stderr='';const timer=setTimeout(()=>reject(Error('Chromium did not start')),20000);
  chrome.once('error',error=>{clearTimeout(timer);reject(error);});
  chrome.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(new URL(match[1]));}});
 });
 const pages=await(await fetch(`http://${endpoint.host}/json/list`)).json();
 socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise(resolve=>socket.onopen=resolve);
 let sequence=0;const pending=new Map(),errors=[];
 socket.onmessage=({data})=>{
  const message=JSON.parse(data);
  if(message.id){const call=pending.get(message.id);pending.delete(message.id);message.error?call.reject(Error(message.error.message)):call.resolve(message.result);}
  else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
 };
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{
  const result=await call('Runtime.evaluate',{expression,returnByValue:true});
  assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result?.value;
 };
 await call('Runtime.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:960,height:640,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
 let ready=false;
 for(let i=0;i<180;i++){
  await new Promise(resolve=>setTimeout(resolve,250));assert.equal(errors.length,0,errors.join('\n'));
  if(await evaluate('window.ready')){ready=true;break;}
 }
 assert(ready,'station fixture initialized');
 for(const [id,entry,platform,target=null] of [...await evaluate('window.levelCases()'),[0,0,0],[0,0,1],[11,0,0],[11,0,1],...[0,1,3].map(i=>[`concourse-${i}`,0,0]),...await evaluate('window.entryCases()')]){
  if(process.argv.length>2&&!process.argv.slice(2).includes(String(id)))continue;
  const result=await evaluate(`window.show(${JSON.stringify(id)},${entry},${platform},${JSON.stringify(target)})`);
  await evaluate('window.inspect()');
  const shot=await call('Page.captureScreenshot',{format:'png'});
  writeFileSync(`${process.env.STATION_SCREENSHOTS??`${tmpdir()}/nyc-station-layout`}-${id}-${entry}-${platform}.png`,Buffer.from(shot.data,'base64'));
  await evaluate('window.inspectSigns()');
  const board=await call('Page.captureScreenshot',{format:'png'});
  writeFileSync(`${tmpdir()}/nyc-station-sign-${id}-${entry}-${platform}.png`,Buffer.from(board.data,'base64'));
  await evaluate('window.inspectStairs()');
  const stairs=await call('Page.captureScreenshot',{format:'png'});
  writeFileSync(`${process.env.STATION_SCREENSHOTS??`${tmpdir()}/nyc-station-layout`}-${id}-${entry}-${platform}-stairs.png`,Buffer.from(stairs.data,'base64'));
  assert.equal(result.error,null,JSON.stringify(result));assert(result.frames>1000);
  assert(Math.abs(result.end.y-.9-result.start.y)<.2,'capsule finishes on the street landing');
  assert(result.render.triangles>1000,'station mesh rendered');
  console.log(`PASS ${result.station} entrance ${entry+1}, platform ${platform+1}: player capsule walks street → platform → street (${result.frames} physics steps)`);
 }
 assert.equal(errors.length,0,errors.join('\n'));
}finally{socket?.close();chrome.kill();server.close();}
