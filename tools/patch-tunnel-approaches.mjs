/** Final surface cuts must run after bridge joins, before adding tunnel floors. */
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const path = new URL('public/world/assets/tile.worker-Ai2ZdmRL.js', root);
let code = readFileSync(path, 'utf8');
const marker = '// NYC final tunnel approach cuts v1';
if (!code.includes(marker)) {
  for (const [before, after] of [
    ['Rr(p,c,d,s),Hr(p,d,s),f.rasterize(c.pos,c.idx.slice(_),c.aA,1/0);',
      'Rr(p,c,d,s),$tunnelFinish(c,d,s,m,$profiles),Hr(p,d,s),f.rasterize(c.pos,c.idx,c.aA,1/0);'],
    ['-Sr)),{meshes:[pi(c.build())', '-Sr)),$tunnelCut(u,$profiles),{meshes:[pi(c.build())'],
  ]) {
    if (code.split(before).length !== 2) throw new Error(`Missing final tunnel cut anchor: ${before}`);
    code = code.replace(before, after);
  }
  code = marker + "\nimport { finishTunnelApproaches as $tunnelFinish } from './tunnels.js';\n" + code;
  writeFileSync(path, code);
}
const runtimePath = new URL('public/world/assets/tunnels.js', root);
const runtime = readFileSync(new URL('src/client/src/streets/tunnels.js', root), 'utf8');
if (readFileSync(runtimePath, 'utf8') !== runtime) writeFileSync(runtimePath, runtime);
const environmentPath = new URL('public/world/assets/environment-WQwLg8tn.js', root);
let environment = readFileSync(environmentPath, 'utf8');
if (environment.includes('x.has(t)?-3.6:-.25')) {
  environment = environment.replace('x.has(t)?-3.6:-.25', 'x.has(t)?-100:-.25');
  writeFileSync(environmentPath, environment);
}
console.log('Published final tunnel surface, curb, and collision cuts.');
