/** Update the served worker's road ownership and traffic-safe bridge supports. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const path = root + 'public/world/assets/tile.worker-Ai2ZdmRL.js';
const marker = '// NYC road layers v1';
let code = readFileSync(path, 'utf8');
const original = code;
if (!code.includes(marker)) {
  const edits = [
    ['joins=$deckNeighbours(env);', 'joins=$deckNeighbours(env),planSupport=$supportPlanner(env,$deckProfile);'],
    ['out.decks.push({pts:d.pts.map', 'out.decks.push({roadId:r.id,pts:d.pts.map'],
    ['capH=foot?.5:1,cw=hw+.3,cd=.5,\n          b=', 'capH=foot?.5:1,cwid=foot?.35:.55;\n      const support=planSupport(r,q,hw,top,capH,cwid);\n      if(!support)continue;\n      let cw=support.halfWidth,cd=.5,\n          b='],
    ['let cols=hw>6?[-hw*.5,hw*.5]:[0];', 'let cols=support.offsets;'],
    ['function Ur(e,t,n){let r=0;for(let i of e){let e=i.pts;', 'function Ur(e,t,n,roadId){let r=0;for(let i of e){if(roadId!==undefined&&i.roadId!==roadId)continue;let e=i.pts;'],
    ['deckAt:(e,t)=>Ur(s.decks,e,t),seed:', 'deckAt:(e,t)=>Ur(s.decks,e,t),roadAt:(r,x,z)=>r.bridge?Ur(s.decks,x,z,r.id):0,seed:'],
    [';Dr(p,c);', ';Dr({...p,roadsV:new sr(r,e=>dr.has(e.cls)&&!e.tunnel&&!e.bridge)},c);'],
    ['Math.max(p.deckAt(e,t),fi(v,', 'Math.max(0,fi(v,'],
  ];
  for (const [before, after] of edits) {
    if (code.split(before).length !== 2) throw new Error(`Expected one road-layer anchor: ${before}`);
    code = code.replace(before, after);
  }
  const firstLine = code.indexOf('\n') + 1;
  code = code.slice(0, firstLine) + marker + "\nimport { supportPlanner as $supportPlanner } from './supports.js';\n" + code.slice(firstLine);
}
// Upgrade the initial ownership hook to extend clipped deck ends at tile borders.
code = code.replace("import { supportPlanner as $supportPlanner } from './supports.js';", "import { supportPlanner as $supportPlanner, roadDeckHeight as $roadDeckHeight } from './supports.js';")
  .replace('roadAt:(r,x,z)=>r.bridge?Ur(s.decks,x,z,r.id):0', 'roadAt:(r,x,z)=>r.bridge?$roadDeckHeight(s.decks,r.id,x,z):0');
if (!code.includes('roadTriangles:')) {
  const edits = [
    ["roadDeckHeight as $roadDeckHeight }", "roadDeckHeight as $roadDeckHeight, roadDeckTriangles as $roadDeckTriangles, triangleHeight as $triangleHeight }"],
    ['out.decks.push({roadId:r.id,pts:d.pts.map((p,i)=>({x:p[0],z:p[1],h:hs[i]})),hw});',
      'const surface=left.flatMap((l,i)=>[l,right[i]].flatMap(v=>[gb.pos[v*3],gb.pos[v*3+1]-Sr,gb.pos[v*3+2]]));\n      out.decks.push({roadId:r.id,pts:d.pts.map((p,i)=>({x:p[0],z:p[1],h:hs[i]})),hw,surface});'],
    ['roadAt:(r,x,z)=>r.bridge?$roadDeckHeight(s.decks,r.id,x,z):0,',
      'roadAt:(r,x,z)=>r.bridge?$roadDeckHeight(s.decks,r.id,x,z):0,roadTriangles:r=>r.bridge?$roadDeckTriangles(s.decks,r.id):[],'],
  ];
  for (const [before, after] of edits) {
    if (code.split(before).length !== 2) throw new Error(`Expected one deck-surface anchor: ${before}`);
    code = code.replace(before, after);
  }
}
const builders = readFileSync(root + 'src/client/src/streets/builders.ts', 'utf8');
const quadStart = builders.indexOf('  quad(', builders.indexOf('export class MarkBuilder'));
const quadEnd = builders.indexOf('  /** vertical quad', quadStart);
let quad = stripTypeScriptTypes('class Paint {\n' + builders.slice(quadStart, quadEnd) + '}');
quad = quad.slice(quad.indexOf('{') + 1, quad.lastIndexOf('}'))
  .replaceAll('NO_FRAME', 'yr').replaceAll('clipConvex', 'nr').replaceAll('triangleHeight', '$triangleHeight');
const servedQuad = code.indexOf('quad(', code.indexOf('var br=class'));
const servedWall = code.indexOf('wallQuad(', servedQuad);
if (servedQuad < 0 || servedWall < servedQuad) throw new Error('Cannot locate served paint quad');
code = code.slice(0, servedQuad) + quad.trim() + code.slice(servedWall);
// This builder is recovered source; transplant it with explicit bindings to
// the mirrored worker's existing atlas and geometry helpers.
const source = readFileSync(root + 'src/client/src/streets/markings.ts', 'utf8');
const body = source.slice(source.indexOf('export function buildMarkings'));
let markings = stripTypeScriptTypes(body).replace('export function buildMarkings', 'function ai');
const open = markings.indexOf('{') + 1;
markings = markings.slice(0, open) + '\n  const TILE_SIZE=256, RoadIndex=sr, clipPolylineToRect=cr, hash2=Z, pointAlong=or, polylineLength=ar, ROAD_Y=Sr, WALK_Y=Wr, ATLAS=X;\n  const yawToDir=yaw=>[-Math.sin(yaw),-Math.cos(yaw)];\n' + markings.slice(open);
const a = code.indexOf('function ai('), b = code.indexOf('let oi={', a);
if (a < 0 || b < a) throw new Error('Cannot locate the served markings builder');
code = code.slice(0, a) + markings + '\n' + code.slice(b);
const runtimePath = root + 'public/world/assets/supports.js';
const runtime = readFileSync(root + 'src/client/src/streets/supports.js', 'utf8');
if (!existsSync(runtimePath) || readFileSync(runtimePath, 'utf8') !== runtime) writeFileSync(runtimePath, runtime);
if (code !== original) writeFileSync(path, code);
// The main thread uses the same owned surface for traffic height sampling.
const streetsPath = root + 'public/world/assets/streets-CfYSUqyW.js';
let streets = readFileSync(streetsPath, 'utf8');
if (!streets.includes('roadHeight:')) {
  const anchor = 'deckHeight:P,dispose()';
  if (streets.split(anchor).length !== 2) throw new Error('Cannot locate streets height API');
  const firstLine = streets.indexOf('\n') + 1;
  streets = streets.slice(0, firstLine) + "import { roadDeckHeight as $roadDeckHeight } from './supports.js';\n" + streets.slice(firstLine);
  streets = streets.replace(anchor, 'deckHeight:P,roadHeight:(r,x,z)=>{if(!r.bridge||!Number.isFinite(x)||!Number.isFinite(z))return 0;const rec=N.get(p(Math.floor(x/256),Math.floor(z/256)));return rec?$roadDeckHeight(rec.decks,r.id,x,z):0},dispose()');
  writeFileSync(streetsPath, streets);
}
const vehiclesPath = root + 'public/world/assets/vehicles-_zJz3z3J.js';
let vehicles = readFileSync(vehiclesPath, 'utf8');
if (!vehicles.includes('function jt(e,t,n,road)')) {
  const edits = [
    ['function jt(e,t,n){return e.modules.get(`streets`)?.deckHeight?.(t,n)??e.physics.groundHeight(t,n)}',
      'function jt(e,t,n,road){const streets=e.modules.get(`streets`);if(road)return streets?.roadHeight?.(road,t,n)??0;return streets?.deckHeight?.(t,n)??e.physics.groundHeight(t,n)}'],
    ['T.road.bridge?jt(r,ee,k):0', 'T.road.bridge?jt(r,ee,k,T.road):0'],
    ['n.lane.road.bridge?jt(r,n.x,n.z):0', 'n.lane.road.bridge?jt(r,n.x,n.z,n.lane.road):0'],
  ];
  for (const [before, after] of edits) {
    if (vehicles.split(before).length !== 2) throw new Error(`Expected one traffic-height anchor: ${before}`);
    vehicles = vehicles.replace(before, after);
  }
  writeFileSync(vehiclesPath, vehicles);
}
console.log(code === original ? 'Road layers already updated.' : 'Updated road markings and bridge supports in the served worker.');
