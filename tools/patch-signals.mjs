/** Publish the recovered signal controller and its desktop/mobile call sites. */
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const write = (path, code) => writeFileSync(new URL(path, root), code);
const source = name => stripTypeScriptTypes(read(`src/client/src/props/${name}.ts`).replace(/^import .*\n/gm, '')).replace(/[\t ]+$/gm, '');
const placement = source('signalPlacement');
write('public/world/assets/signal-placement.js', placement);
write('web/static/world/assets/signal-placement.js', placement);
let lamp = read('public/world/assets/lamp-DWcKsT0C.js');
const start = lamp.indexOf('q='), end = lamp.indexOf(',J={color:6252132', start);
if (start < 0 || end < start) throw new Error('Signal class boundaries changed');
lamp = lamp.slice(0, start) + `q=(()=>{const hash01=I;\n${source('signals').replace(/^export /gm, '')}\nreturn SignalNetwork;})()` + lamp.slice(end);
write('public/world/assets/lamp-DWcKsT0C.js', lamp);
let props = read('public/world/assets/props-coU--UuE.js');
const placementStart = props.indexOf('function Xt('), placementEnd = props.indexOf('var Zt=', placementStart);
if (placementStart < 0 || placementEnd < placementStart) throw new Error('Signal placement boundaries changed');
props = props.slice(0, placementStart) + placement.slice(placement.indexOf('export function signalApproach')).replace('export function signalApproach', 'function Xt') + props.slice(placementEnd);
function replaceOnce(code, before, after) {
  if (code.includes(after)) return code;
  if (code.split(before).length !== 2) throw new Error(`Signal hook changed: ${before}`);
  return code.replace(before, after);
}
for (const [before, after] of [
  ['Xt(l,e.world.roadsNear?.(l.x,l.z,45)??t.roads)', 'Xt(l,t.streetContext?.roads??e.world.roadsNear?.(l.x,l.z,45)??t.roads)'],
  ['signalFor(e,t,r,i){return w?null:h.signalFor(e,t,r,i,n.state.serverTime())}', 'signalFor(e,t,r,i,layer){return w?null:h.signalFor(e,t,r,i,n.state.serverTime(),layer)}'],
  ['i.addPole(l.x,l.z,f,t.key)', 'i.addPole(l.x,l.z,f,t.key,r)'],
  ['h.addPole(n.x,n.z,Math.atan2(-n.fx,-n.fz),n.tileKey)', 'h.addPole(n.x,n.z,Math.atan2(-n.fx,-n.fz),n.tileKey,n.approach)'],
  ['let o=e[t+5]?1-a.phase:a.phase,s=he.phaseTime(a.cluster,i);return n[r+1]=he.vehicleState(o,s),n[r+2]=he.pedFrame(o,s),!0',
   'let s=he.phaseTime(a.cluster,i);return n[r+1]=he.vehicleState(a.phase,s,a.cluster),n[r+2]=he.pedestrianFrame(a,!!e[t+5],s),!0'],
]) props = replaceOnce(props, before, after);
write('public/world/assets/props-coU--UuE.js', props);
let mobile = read('public/world/assets/mobile-SBC7KRMu.js');
if (!mobile.includes('signalApproach as $signalApproach')) mobile = "import { signalApproach as $signalApproach } from './signal-placement.js';\n" + mobile;
mobile = replaceOnce(mobile, 'i.addPole(e.x,e.z,e.yaw,E(D(e.x),D(e.z)))',
  '(()=>{const key=E(D(e.x),D(e.z)),roads=$fixtureWorld.tiles.get(key)?.streetContext?.roads??$fixtureWorld.roadsNear?.(e.x,e.z,45)??[],approach=$signalApproach(e,roads);if(approach?.incoming!==false)i.addPole(e.x,e.z,e.yaw,key,approach)})()');
mobile = replaceOnce(mobile, 'signalFor:(t,n,r,a)=>i.signalFor(t,n,r,a,e.state.serverTime())', 'signalFor:(t,n,r,a,layer)=>i.signalFor(t,n,r,a,e.state.serverTime(),layer)');
write('public/world/assets/mobile-SBC7KRMu.js', mobile);
let vehicles = read('public/world/assets/vehicles-_zJz3z3J.js');
vehicles = replaceOnce(vehicles,
  'const signal = lane.road.tunnel || lane.road.bridge || c.y > 0.3 ? null : signals?.signalFor?.(c.x, c.z, heading.dx, heading.dz);',
  'const signal = lane.road.tunnel ? null : signals?.signalFor?.(c.x, c.z, heading.dx, heading.dz, lane.road.layer ?? 0);');
write('public/world/assets/vehicles-_zJz3z3J.js', vehicles);
console.log('Published junction signal plans, approach stop lines and pedestrian phases.');
