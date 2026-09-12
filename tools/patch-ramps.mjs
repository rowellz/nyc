/** Publish clearance-aware profiles to the mirrored client. Run after patch-road-layers. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
function patch(file, marker, edits, imports = '') {
  const path = root + 'public/world/assets/' + file;
  let code = readFileSync(path, 'utf8');
  if (code.includes(marker)) return;
  for (const [before, after] of edits) {
    if (code.split(before).length !== 2) throw new Error(`Expected one ramp anchor in ${file}: ${before}`);
    code = code.replace(before, after);
  }
  const firstLine = code.indexOf('\n') + 1;
  code = code.slice(0, firstLine) + marker + '\n' + imports + code.slice(firstLine);
  writeFileSync(path, code);
}
patch('tile.worker-Ai2ZdmRL.js', '// NYC ramp clearance v1', [
  ['function $deckProfile(env,r){', 'function $deckProfile(env,r){return $clearanceProfile(env,r,$baseDeckProfile)}\nfunction $baseDeckProfile(env,r){\n  if(!r.bridge)return{hw:Math.max(dr.has(r.cls)?3.2:1.2,r.width/2),H:0,hAt:()=>0};'],
  ['if(seen.has(r.id)||!r.bridge||r.tunnel||r.pts.length<2||!dr.has(r.cls))continue;', 'if(seen.has(r.id)||r.tunnel||r.pts.length<2||!dr.has(r.cls))continue;'],
  ['let{hw,hAt}=$deckProfile(env,r),pad=hw+$JOIN_GAP,', 'let{hw,H,hAt}=$deckProfile(env,r);if(H<.05)continue;let pad=hw+$JOIN_GAP,'],
  ['if(!r.bridge||r.tunnel||seen.has(r.id)||r.pts.length<2)continue;', 'if(r.tunnel||seen.has(r.id)||r.pts.length<2)continue;'],
  ['let{hw,H,hAt}=$deckProfile(env,r),\n        slabT=', 'let{hw,H,hAt}=$deckProfile(env,r);if(H<.05)continue;let slabT='],
  ['roadAt:(r,x,z)=>r.bridge?$roadDeckHeight(s.decks,r.id,x,z):0,roadTriangles:r=>r.bridge?$roadDeckTriangles(s.decks,r.id):[],',
    'roadAt:(r,x,z)=>$roadDeckHeight(s.decks,r.id,x,z),roadTriangles:r=>$roadDeckTriangles(s.decks,r.id),'],
], "import { clearanceProfile as $clearanceProfile } from './ramps.js';\n");
patch('streets-CfYSUqyW.js', '// NYC ramp traffic heights v1', [
  ['if(!r.bridge||!Number.isFinite(x)||!Number.isFinite(z))return 0;', 'if(!Number.isFinite(x)||!Number.isFinite(z))return 0;'],
]);
patch('vehicles-_zJz3z3J.js', '// NYC ramp approach traffic v1', [
  ['T.road.bridge?jt(r,ee,k,T.road):0', 'jt(r,ee,k,T.road)'],
  ['n.lane.road.bridge?jt(r,n.x,n.z,n.lane.road):0', 'jt(r,n.x,n.z,n.lane.road)'],
]);
patch('vehicles-_zJz3z3J.js', '// NYC approach signals v1', [
  ['i.road.tunnel||i.road.bridge?null:o?.signalFor', 'i.road.tunnel||i.road.bridge||n.y>.3?null:o?.signalFor'],
]);
patch('streets-CfYSUqyW.js', '// NYC approach streaming v1', [
  ['roadsNear((n.tx+.5)*256,(n.tz+.5)*256,208)', 'roadsNear((n.tx+.5)*256,(n.tz+.5)*256,384)'],
  ['e.maxX>=n-80&&e.minX<=n+256+80&&e.maxZ>=r-80&&e.minZ<=r+256+80', 'e.maxX>=n-256&&e.minX<=n+512&&e.maxZ>=r-256&&e.minZ<=r+512'],
]);
const runtime = readFileSync(root + 'src/client/src/streets/ramps.js', 'utf8');
const path = root + 'public/world/assets/ramps.js';
let old; try { old = readFileSync(path, 'utf8'); } catch { /* first publication */ }
if (old !== runtime) writeFileSync(path, runtime);
console.log('Ramp clearance profiles and approach traffic updated.');
