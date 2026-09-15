import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assets} from './sveltekit-assets.mjs';
import {CLIENT_REVISION} from '../src/lib/server/client-cache.js';
const rail=name=>new URL(`rail/${name}.js?v=${CLIENT_REVISION}`,assets);
const {routes,services,sample}=await import(rail('network'));
const {signData}=await import(rail('sign-data'));
const {platformSignInfo,combineSignInfo,paintSign,routeBadge,boardPosition}=await import(rail('signs'));
const records=routes.flatMap(route=>route.stations.map(station=>({route,station})));
const record=id=>records.find(r=>r.station.id===id);
const info=id=>{const r=record(id);return platformSignInfo(r.station,r.route);};
const upper=info('way/905267133'),lower=info('way/905267134');
assert.deepEqual(upper.groups,[{direction:'N',label:'Uptown & The Bronx',routes:['4','5','6']}]);
assert.deepEqual(lower.groups,[{direction:'S',label:'Downtown',routes:['4','5','6']}]);
for(const id of ['way/907493094','way/907493095'])assert.deepEqual(info(id).groups[0].routes,['6']);
for(const id of ['way/510806175','way/510806176'])assert.deepEqual(info(id).groups[0].routes,['A','B','C','D'],'Columbus Circle IND platforms must not inherit the nearby IRT station');
assert.equal(info('way/509025013').stop,'635','Union Square Lexington platform must not inherit Canarsie L station metadata');
assert(info('way/509025013').groups.every(g=>g.routes.join()==='4,5,6'));
const b=routes.find(r=>r.id==='broadway-local');
assert.equal(platformSignInfo(b.stations[0],b,0).groups[0].label,'Downtown');
assert.equal(platformSignInfo(b.stations[0],b,1).groups[0].label,'Uptown');
assert.deepEqual(platformSignInfo(b.stations[4],b,1).groups[0].routes,['1','2','3']);
assert.deepEqual(platformSignInfo(b.stations[1],b,1).groups[0].routes,['1']);
const atStop=id=>Object.values(signData.stations).filter(s=>s.stop===id);
assert(atStop('Q03').some(s=>s.groups.length===2&&s.groups.every(g=>g.routes.join()==='Q')),'Second Avenue island serves Q in both directions');
assert(atStop('L03').some(s=>s.groups.some(g=>g.label==='Brooklyn'&&g.routes.join()==='L')));
assert(atStop('L03').some(s=>s.groups.some(g=>g.label==='West Side'&&g.routes.join()==='L')));
assert(atStop('R14').every(s=>s.groups.every(g=>g.routes.includes('R')&&g.routes.includes('Q'))),'Broadway express-stop islands list the local and express services');
for(const {route,station} of records.filter(r=>r.route.mapped&&r.route.kind==='subway'&&!/PATH/i.test(`${r.route.name} ${r.station.source?.tags?.network??''}`)))assert(signData.stations[station.key],`MTA platform has service metadata: ${station.key}`);
const source=JSON.parse(readFileSync(new URL('../static/world/assets/rail/subway-services.json',import.meta.url)));
const stops=new Map(source.stations.map(s=>[s.gtfs_stop_id,s]));
for(const value of Object.values(signData.stations))for(const group of value.groups){
 assert(group.routes.length&&group.label);
 for(const id of group.routes){assert(signData.routes[id]);assert(stops.get(value.stop).daytime_routes.split(' ').includes(routeBadge(id).label),'only services that stop at this station');}
}
for(const {route,station} of records.filter(r=>r.station.source?.tags?.network==='PATH'))assert(!signData.stations[station.key],'PATH platforms never receive MTA route bullets');
for(const id of ['way/905267133','way/905267134']){
 const {route,station}=record(id),service=services.find(s=>s.id===route.id),direction=service.directions[0];
 const a=sample(route,station.s),b=sample(route,station.s+direction*10);
 assert.equal(b.z<a.z,info(id).groups[0].direction==='N','train movement agrees with platform direction');
}
const entrance=combineSignInfo(upper,[lower]);assert.equal(entrance.groups.length,2);
const text=[],ctx=new Proxy({fillText:(...args)=>text.push(args)}, {get:(o,k)=>o[k]??(()=>{})}),canvas={getContext:()=>ctx};
paintSign(canvas,lower,{heading:'Down to level 2 ↓'});
assert(text.some(([s])=>s==='Down to level 2 ↓'));assert(text.some(([s])=>s==='Downtown'));
assert.deepEqual(text.filter(([s])=>/^[456]$/.test(s)).map(([s])=>s),['4','5','6']);
assert.equal(routeBadge('N').color,source.routes.N.color);assert.equal(routeBadge('L').color,source.routes.L.color);
assert.equal(boardPosition(100)%18,9,'signs sit between the platform columns');
console.log('PASS MTA service matching, local/express platform routes, stacked directions, transfer labels, route colors and train direction');
// Inspect the actual geometry's canvases, including both directions of the
// inter-level transfer, and verify streamed sign textures are released.
const canvases=[];
globalThis.document={createElement(){const words=[],context=new Proxy({fillText:s=>words.push(s)},{get:(o,k)=>o[k]??(()=>{})}),canvas={words,getContext:()=>context};canvases.push(canvas);return canvas;}};
const {stationSign,materials}=await import(rail('geometry'));
const mats=materials();
for(const [id,heading,destination] of [['way/905267133','Down to level 2 ↓','Downtown'],['way/905267134','Up to level 1 ↑','Uptown & The Bronx']]){
 canvases.length=0;const {station,route}=record(id),sign=stationSign(station,mats,route);
 const transfer=canvases.find(c=>c.words.includes(heading));assert(transfer,'transfer has a destination board');
 assert(transfer.words.includes(destination));for(const route of ['4','5','6'])assert(transfer.words.includes(route));
 let disposed=0;for(const child of sign.group.children){assert.equal(child.material.map.colorSpace,'srgb');child.material.map.addEventListener('dispose',()=>disposed++);}
 sign.dispose();assert.equal(disposed,sign.group.children.length);for(const child of sign.group.children)child.geometry.dispose();
}
for(const material of Object.values(mats))material.dispose();delete globalThis.document;
console.log('PASS rendered stair signs show destination lines/directions and all sign textures dispose on unload');
