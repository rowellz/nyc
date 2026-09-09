/** Apply building foundation elevation to the mirrored near and far builders. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = root + 'public/world/assets/';
const marker = '// NYC tunnel foundations v1\n';
function patch(name, imports, edits) {
  let code = readFileSync(assets + name, 'utf8');
  const original = code;
  const patched = code.startsWith(marker);
  for (const [before, after] of edits) {
    if (patched && code.split(after).length === 2) continue;
    if (code.split(before).length !== 2) throw new Error(`${name}: expected one anchor ${before}`);
    code = code.replace(before, after);
  }
  if (!patched) code = marker + `import { ${imports} } from './foundations.js';\n` + code;
  return code === original ? null : [assets + name, code];
}
const changes = [
  patch('builder.worker-D9_Czkt3.js', 'buildingFoundation as $foundation, foundationSlab as $foundationSlab', [
    ['let n=e[0],a=l.idx.n', 'l.baseY=$foundation(t);let n=e[0],a=l.idx.n'],
    ['p.push(t.id,b.minX,b.minZ,b.maxX,b.maxZ,x)', 'p.push(t.id,b.minX,b.minZ,b.maxX,b.maxZ,x+l.baseY)'],
    ['}c.has(t.id)&&(m.push', '}$foundationSlab(l,e);c.has(t.id)&&(m.push'],
    ['vert(e,t,n,r,i,a,o,s,c){let l=', 'vert(e,t,n,r,i,a,o,s,c){t+=this.baseY??0;let l='],
    ['colWall(e,t,n){let r=', 'colWall(e,t,n){t+=this.baseY??0;n+=this.baseY??0;let r='],
    ['colCap(e,t){let n=', 'colCap(e,t){t+=this.baseY??0;let n='],
    ['(C.commercial?2:0)', '(C.commercial&&!l.baseY?2:0)'],
    ['C.commercial&&e.len>=4&&C.style!==9', 'C.commercial&&!l.baseY&&e.len>=4&&C.style!==9'],
  ]),
  patch('far.worker-BYt2J0PM.js', 'buildingFoundation as $foundation', [
    ['x=0,C=(e,t,n,o,s,f,p,m,x,S,C,w,T,E)=>', 'x=0,$foundationY=0,C=(e,t,n,o,s,f,p,m,x,S,C,w,T,E)=>'],
    ['a.push(D,t,O)', 'a.push(D,t+$foundationY,O)'],
    ['t<g&&(g=t),t>y&&(y=t)', 't+$foundationY<g&&(g=t+$foundationY),t+$foundationY>y&&(y=t+$foundationY)'],
    ['for(let a of e.buildings){let e=', 'for(let a of e.buildings){$foundationY=$foundation(a);let e='],
    ['p.push(e[0]-r,s,e[1]-i,4+', 'p.push(e[0]-r,s+$foundationY,e[1]-i,4+'],
  ]),
].filter(Boolean);
function writeChanged(path, code) {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== code) writeFileSync(path, code);
}
writeChanged(assets + 'foundations.js', readFileSync(root + 'src/client/src/buildings/foundations.js', 'utf8').replace("'../streets/tunnels.js'", "'./tunnels.js'"));
writeChanged(assets + 'tunnel-roads.js', readFileSync(root + 'src/client/src/buildings/tunnel-roads.js', 'utf8'));
for (const [path, code] of changes) writeFileSync(path, code);
console.log(`Tunnel foundations: updated ${changes.length} client chunks and shared runtime.`);
