/** Publish the carriageway rule and the sidewalk builder that obeys it. Run after patch-road-layers. */
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const path = root + 'public/world/assets/tile.worker-Ai2ZdmRL.js';
const original = readFileSync(path, 'utf8');
let code = original;
if (!code.includes('carriagewayIndex as $carriagewayIndex')) {
  code = "import { carriagewayIndex as $carriagewayIndex, pathHalfWidth as $pathHalfWidth } from './carriageway.js';\n" + code;
}
const source = readFileSync(root + 'src/client/src/streets/sidewalk.ts', 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '');
const js = stripTypeScriptTypes(source).replace(/[\t ]+$/gm, '');
// The served names for everything sidewalk.ts imports. `$` is the region's own RAMP_W; the block owns it.
const aliases = 'const carriagewayIndex=$carriagewayIndex,GroundBuilder=vr,GRID_DIR=hr,STREET=fr,clipConvex=nr,clipPolylineToRect=cr,'
  + 'dir4=mr,edgeOnRect=ur,hash2=Z,indexPolygons=$n,pointInAny=er,ringBBox=Yn,signedArea=Jn,subtractConvex=rr,triangulate=ir,yawToDir=gr,KIND=Q;';
const block = `// NYC sidewalk carriageway trim v1\nconst $sidewalkModule=(()=>{\n${aliases}\n${js}\nreturn{WALK_Y,buildSidewalks};\n})();\nconst Wr=$sidewalkModule.WALK_Y;\nfunction ii(...args){return $sidewalkModule.buildSidewalks(...args)}\n`;
// Footpath ribbons are paved after the sidewalks, from the same walk builder, under the same rule.
const paths = [
  ['if(er(r[0]+(i[0]-r[0])*n,r[1]+(i[1]-r[1])*n,h))continue;',
    'const $px=r[0]+(i[0]-r[0])*n,$pz=r[1]+(i[1]-r[1])*n;if(er($px,$pz,h)||m.carriageway?.covers($px,$pz))continue;'],
  ['Er(s?c:l,o,Math.max(.6,e.width/2),()=>s?Sr:Wr,u,0,Z(e.id,0))',
    'Er(s?c:l,o,s?Math.max(.6,e.width/2):$pathHalfWidth(m.carriageway,Math.max(.6,e.width/2),$px,$pz,i[0]-r[0],i[1]-r[1]),()=>s?Sr:Wr,u,0,Z(e.id,0))'],
];
for (const [from, to] of code.includes('const $pathSupport=') ? [] : paths) {
  if (code.includes(to)) continue;
  if (code.split(from).length !== 2) throw new Error(`Cannot find the served footpath anchor: ${from}`);
  code = code.replace(from, to);
}
if (!code.includes('const $pathSupport=')) {
  const edits = [
    ['g=new Set;for(let e of r)', 'g=new Set;const $pathSupport=new vr;for(let e of r)'],
    [paths[1][1], 'const $hw=$pathHalfWidth(m.carriageway,Math.max(.6,e.width/2),$px,$pz,i[0]-r[0],i[1]-r[1]);if(!$pathPieceClear(m.carriageway,o,$hw))continue;Er(s?c:l,o,$hw,()=>s?Sr:Wr,u,0,Z(e.id,0));if(s)Er($pathSupport,o,$hw,()=>Sr,u,0,Z(e.id,0))'],
    ['$tunnelCut(l,$profiles);', '$tunnelCut(l,$profiles);$tunnelCut($pathSupport,$profiles);'],
    ['di(l,m.curbs,a,o)', 'di({pos:[...l.pos,...$pathSupport.pos],aA:[...l.aA,...$pathSupport.aA],idx:[...l.idx,...$pathSupport.idx.map(i=>i+l.vertexCount)]},m.curbs,a,o)'],
  ];
  for (const [from,to] of edits) {
    if (code.split(from).length !== 2) throw new Error(`Cannot find path support anchor: ${from}`);
    code = code.replace(from, () => to);
  }
  code = "import { pathPieceClear as $pathPieceClear } from './carriageway.js';\n" + code;
}
const start = code.includes('// NYC sidewalk carriageway trim v1')
  ? code.indexOf('// NYC sidewalk carriageway trim v1')
  : code.indexOf('let Wr=.15,');
const end = code.indexOf('function ai(', start);
if (start < 0 || end <= start) throw new Error('Cannot find served sidewalk builder boundaries');
code = code.slice(0, start) + block + code.slice(end);
if (code !== original) writeFileSync(path, code);
const runtime = readFileSync(root + 'src/client/src/streets/carriageway.js', 'utf8');
const target = root + 'public/world/assets/carriageway.js';
let old; try { old = readFileSync(target, 'utf8'); } catch { /* first publication */ }
if (old !== runtime) writeFileSync(target, runtime);
console.log('Published the carriageway rule: sidewalks and plazas trimmed off the paved and painted roadway.');
