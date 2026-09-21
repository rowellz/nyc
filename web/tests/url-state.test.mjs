import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {installUrlState,readUrlState} from '../static/world/assets/url-state.js';
import {urlStateAssetTransform} from '../src/lib/server/url-state-assets.js';
import {versionClientImports,CLIENT_REVISION} from '../src/lib/server/client-cache.js';
import {Ut as PerspectiveCamera} from '../../public/world/assets/textureRelease-2U-gT89r.js';
function fixture(search='',{cameraMode=false,welcomed=true,character=true}={}) {
 const dom=new JSDOM('',{url:`https://nyc.test/world/${search}`,runScripts:'outside-only'}),host=dom.window;
 let now=0,id=0;const timers=new Map(),teleports=[],sent=[];
 host.setInterval=(fn,ms)=>{const key=++id;timers.set(key,{fn,ms,next:now+ms});return key;};host.clearInterval=key=>timers.delete(key);
 function advance(ms){now+=ms;for(const timer of timers.values())while(timer.next<=now){timer.next+=timer.ms;timer.fn();}}
 const camera=new PerspectiveCamera(62,1,.1,1000);camera.position.set(12,8,-20);camera.rotation.set(.2,-.8,0,'YXZ');
 const state={screenshotMode:cameraMode,welcomed,admin:false,local:{state:{x:10,y:2,z:-22,yaw:-.5}}};
 const ctx={camera,state,stats:{drawCalls:5},modules:new Map(),input:{look:{dx:0,dy:0},move:{x:0,y:0}},physics:{groundHeight:()=>6},net:{send:v=>sent.push(v)}};
 let regained=0;if(character)host.__character={restoreView(){regained++;}};
 const shots={cam:cameraMode?{place(x,y,z,bearing,pitch){camera.position.set(x,y,z);camera.rotation.set(pitch*Math.PI/180,-bearing*Math.PI/180,0,'YXZ');}}:null};
 const game={ctx,teleport(x,z,y){teleports.push([x,z,y]);Object.assign(state.local.state,{x,y,z});}};
 host.history.replaceState({keep:'router-state'},'');const historyLength=host.history.length;
 const module=installUrlState(game,shots,host);
 return {host,ctx,game,shots,module,advance,timers,teleports,sent,historyLength,regained:()=>regained,close:()=>{module.dispose();host.close();}};
}
{
 const f=fixture('?q=mobile&time=18%3A00&live=0#map');
 f.advance(4999);assert.equal(f.host.location.search,'?q=mobile&time=18%3A00&live=0');
 f.advance(1);const url=new URL(f.host.location.href),saved=readUrlState(url);
 assert.deepEqual(saved.pos,[10,2,-22,28.65]);assert.deepEqual(saved.view,[12,8,-20,45.84,11.46,62]);
 assert.equal(url.searchParams.get('q'),'mobile');assert.equal(url.searchParams.get('time'),'18:00');assert.equal(url.hash,'#map');
 assert(!url.searchParams.has('fly'),'walking links stay in play mode');assert.equal(f.host.history.length,f.historyLength);assert.equal(f.host.history.state.keep,'router-state');
 f.ctx.camera.position.x=55;f.ctx.state.local.state.x=50;f.advance(5000);
 assert.equal(readUrlState(new URL(f.host.location.href)).view[0],55);
 assert.equal(f.host.history.length,f.historyLength);f.close();
}
console.log('PASS URL updates every five seconds, preserves options/hash/history state and captures player plus camera independently');
{
 const f=fixture('?spot=times-square&q=mobile',{cameraMode:true});f.advance(5000);
 const url=new URL(f.host.location.href);assert(!url.searchParams.has('spot'));assert.equal(url.searchParams.get('fly'),'12,-20,2,45.84,11.46');
 assert.equal(f.host.sessionStorage.getItem('nyc.web.camera-return'),url.search);
 const next=fixture(url.search,{cameraMode:true});
 assert.equal(next.ctx.camera.position.y,8,'view height is absolute even when terrain ground is six metres');
 assert(Math.abs(next.ctx.camera.rotation.y+.8)<.0001);assert.equal(next.ctx.state.local.state.x,10);
 assert.equal(next.teleports.length,0);next.close();f.close();
}
console.log('PASS free-camera links replace named spots and restore absolute height, heading, pitch and FOV');
{
 const f=fixture('?pos=2645,12,-3707,90&view=2648,15,-3702,120,-15,62',{welcomed:false,character:false});
 f.advance(15000);assert.equal(f.teleports.length,0,'wait for server spawn');
 assert.equal(new URL(f.host.location.href).searchParams.get('pos'),'2645,12,-3707,90');
 f.ctx.state.welcomed=true;f.module.update();assert.deepEqual(f.teleports,[[2645,-3707,12]]);
 let calls=0;f.host.__character={restoreView(){calls++;}};f.module.update();f.module.update();
 assert.equal(calls,1);assert.equal(f.ctx.camera.position.x,2648);assert(Math.abs(f.ctx.camera.rotation.y+2*Math.PI/3)<1e-9);
 assert.equal(f.teleports.length,1,'later frames do not teleport again');assert(!f.ctx.state.screenshotMode);f.close();
}
{
 const f=fixture('?pos=10,2,-22,90&view=12,8,-20,120,-15,62',{character:false});
 let restored;
 f.ctx.modules.set('character',{restoreView(...values){restored=values;}});f.module.update();
 assert.deepEqual(restored,[120,-15],'core fallback controller receives the saved orientation');f.advance(5000);
 assert.equal(new URL(f.host.location.href).searchParams.get('view'),'12,8,-20,120,-15,62');f.close();
}
console.log('PASS gameplay restoration waits for welcome and late mobile character creation, then restores only once');
for(const invalid of ['NaN,0,0,0','1,,2,0','Infinity,0,0,0','999999,0,0,0','1,2,3,4extra','1,2,3'])
 assert.equal(readUrlState(new URL(`https://nyc.test/?pos=${invalid}`)).pos,null);
assert.equal(readUrlState(new URL('https://nyc.test/?view=1,2,3,90,999,62')).view,null);
{
 const f=fixture('?pos=bad&view=bad');f.advance(5000);assert(readUrlState(new URL(f.host.location.href)).pos);
 const before=f.host.location.href;f.ctx.camera.position.x=NaN;f.advance(5000);assert.equal(f.host.location.href,before);
 f.ctx.camera.position.x=20;f.host.history.replaceState=()=>{throw Error('denied');};assert.doesNotThrow(()=>f.advance(5000));f.close();
}
{
 const f=fixture();f.host.dispatchEvent(new f.host.Event('pagehide'));assert.equal(f.timers.size,0);
 f.host.dispatchEvent(new f.host.Event('pageshow'));assert.equal(f.timers.size,1);
 const replacement=installUrlState(f.game,f.shots,f.host);assert.equal(f.timers.size,1);replacement.dispose();assert.equal(f.timers.size,0);f.close();
}
for(const name of ['main-D_3aygO4.js','character-O1u3Gxpp.js']) {
 const source=readFileSync(new URL(`../../public/world/assets/${name}`,import.meta.url),'utf8');
 const transformed=urlStateAssetTransform(`world/assets/${name}`,source);
 if(name.startsWith('main'))assert(versionClientImports(transformed).includes(`./url-state.js?v=${CLIENT_REVISION}`));
 else assert(transformed.includes('restoreView(){u.regain()}'));
 assert.throws(()=>urlStateAssetTransform(`world/assets/${name}`,''),/anchor changed/);
}
console.log('PASS malformed links, invalid frames, denied history, bfcache lifecycle, disposal and guarded served-client hooks');
