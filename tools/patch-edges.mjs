/** Publish the source bridge builder and its shared edge geometry. */
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const path = root + 'public/world/assets/tile.worker-Ai2ZdmRL.js';
let code = readFileSync(path, 'utf8');
if (!code.includes('deckEdges as $deckEdges')) {
  const first = code.indexOf('\n') + 1;
  code = code.slice(0, first) + "import { deckEdges as $deckEdges, barrierRuns as $barrierRuns } from './edges.js';\n" + code.slice(first);
}
if (!code.includes('roadFootprints as $roadFootprints')) code = "import { roadFootprints as $roadFootprints } from './fixtures.js';\n" + code;
const source = readFileSync(root + 'src/client/src/streets/bridges.ts', 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '');
const js = stripTypeScriptTypes(source).replace(/[\t ]+$/gm, '');
const builder = `const $edgeBridgeBuilder=(()=>{\nconst roadFootprints=$roadFootprints,deckEdges=$deckEdges,barrierRuns=$barrierRuns,buildTunnels=$tunnelBuild,supportPlanner=$supportPlanner,clearanceProfile=$clearanceProfile,GroundBuilder=vr,VEHICULAR=dr,clipPolylineToRect=cr,hash2=Z,pointAlong=or,polylineLength=ar,KIND=Q,ROAD_Y=Sr,kindForSurface=Cr,ribbon=Er;\n${js}\nreturn buildBridges;\n})();\nfunction Rr(...args){return $edgeBridgeBuilder(...args)}\n`;
const start = code.includes('const $edgeBridgeBuilder=') ? code.indexOf('const $edgeBridgeBuilder=') : code.indexOf('function Rr(');
const end = code.indexOf('function zr(', start);
if (start < 0 || end <= start) throw new Error('Cannot find served bridge builder boundaries');
code = code.slice(0, start) + builder + code.slice(end);
if (code !== readFileSync(path, 'utf8')) writeFileSync(path, code);
const runtime = readFileSync(root + 'src/client/src/streets/edges.js', 'utf8');
const target = root + 'public/world/assets/edges.js';
let old; try { old = readFileSync(target, 'utf8'); } catch { /* first publication */ }
if (old !== runtime) writeFileSync(target, runtime);
console.log('Published continuous highway edges and matching barriers.');

writeFileSync(root + 'public/world/assets/fixtures.js', readFileSync(root + 'src/client/src/streets/fixtures.js', 'utf8'));
