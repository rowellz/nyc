/** Guarded, repeatable patch of the mirrored client (the recovered TS has no build). */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const assets = root + 'public/world/assets/';
const marker = '// NYC functional tunnels v1\n';
function patch(name, imports, edits) {
  let code = readFileSync(assets + name, 'utf8');
  if (code.startsWith(marker)) return;
  for (const [before, after] of edits) {
    if (code.split(before).length !== 2) throw new Error(`${name}: expected one anchor ${before.slice(0, 90)}`);
    code = code.replace(before, after);
  }
  return [assets + name, marker + (imports ? `import { ${imports} } from './tunnels.js';\n` : '') + code];
}
const worker = readFileSync(assets + 'tile.worker-Ai2ZdmRL.js', 'utf8');
const portal = worker.slice(worker.indexOf('function Hr('), worker.indexOf('function Ur('));
const changes = [
  patch('tile.worker-Ai2ZdmRL.js', 'buildTunnels as $tunnelBuild, tunnelNetwork as $tunnelNetwork, cutBuilder as $tunnelCut', [
    [portal, 'function Hr(e,t,n){$tunnelBuild(e,t,n)}'],
    ['f.rasterize(c.pos,c.idx,c.aA),f.rasterize(l.pos,l.idx,l.aA);', 'const $profiles=$tunnelNetwork(r);$tunnelCut(c,$profiles);$tunnelCut(l,$profiles);f.rasterize(c.pos,c.idx,c.aA),f.rasterize(l.pos,l.idx,l.aA);'],
    ['e===r||e.id===r.id||e.bridge||e.tunnel||!dr.has(e.cls)', 'e===r||e.id===r.id||e.bridge||!dr.has(e.cls)'],
  ]),
  patch('vehicles-_zJz3z3J.js', 'trafficHeight as $tunnelHeight, tunnelConnections as $tunnelConnections', [
    ['dn=e=>!e.tunnel&&!', 'dn=e=>!'],
    ['function gn(e){if(!e.oneway)', 'function gn(e){if(e.tunnel&&e.oneway){const n=Math.max(1,e.lanes),w=Math.min(3.3,(e.width-1)/n);return Array.from({length:n},(_,i)=>(i-(n-1)/2)*w)}if(!e.oneway)'],
    ['||r.bridge||r.width<7', '||r.bridge||r.tunnel||r.width<7'],
    ['(this.roads.outgoing.get(e.lane.end)??[]).filter', '$tunnelConnections(this.roads,e.lane).filter'],
    ['A=jt(r,ee,k),j=Z[D]', 'A=$tunnelHeight(r.world,T.road,ee,k,T.road.bridge?jt(r,ee,k):0),j=Z[D]'],
    ['u=o?.signalFor?.(n.x,n.z,i.dx,i.dz)', 'u=i.road.tunnel||i.road.bridge?null:o?.signalFor?.(n.x,n.z,i.dx,i.dz)'],
    ['n.y=n.lane.road.bridge?jt(r,n.x,n.z):0', 'n.y=$tunnelHeight(r.world,n.lane.road,n.x,n.z,n.lane.road.bridge?jt(r,n.x,n.z):0)'],
    ['e!==n&&e.lane!==i&&Math.hypot', 'e!==n&&Math.abs(e.y-n.y)<3&&e.lane!==i&&Math.hypot'],
    ['e.physics.groundHeight(t.x,t.z)', 'e.physics.groundHeight(t.x,t.z,t.y)'],
  ]),
  patch('main-D_3aygO4.js', 'cutGround as $tunnelCutGround', [
    ['loadLand(e){this.unloadLand(e.key)', 'loadLand(e,$holes=[]){this.unloadLand(e.key)'],
    ['if(!e.water.length)t=wc.cuboid(128,1,128)', 'if(!e.water.length&&!$holes.length)t=wc.cuboid(128,1,128)'],
    ['else{let n=Bc(e);if(!n.indices.length)return;t=wc.trimesh(n.vertices,n.indices)}', 'else{let n=Bc(e);const cut=$tunnelCutGround({position:{array:n.vertices,itemSize:3}},n.indices,$holes);if(cut)n={vertices:cut.attributes.position.array,indices:cut.index};if(!n.indices.length)return;t=wc.trimesh(n.vertices,n.indices)}'],
  ]),
  patch('streets-CfYSUqyW.js', 'syncTunnelTerrain as $tunnelTerrain, tunnelSupport as $tunnelSupport', [
    ['L=(t,n)=>{let r=F.call(e.physics,t,n),i=P(t,n);return i>0?Math.max(r,i):r}', 'L=(t,n,y)=>{let r=F.call(e.physics,t,n),i=P(t,n);return $tunnelSupport(e.world,t,n,y,i>0?Math.max(r,i):r)}'],
    ['n.decks=i.decks,yield,i.walkCollision.index.length', 'n.decks=i.decks,$tunnelTerrain(e,n.tile),yield,i.walkCollision.index.length'],
  ]),
  patch('environment-WQwLg8tn.js', 'syncTunnelTerrain as $tunnelTerrain', [
    ['n*4+e,t?-3.6:-.25', 'n*4+e,t?-100:-.25'],
    ['o.matrixAutoUpdate=!1,t.add(o);let s=null,l=null;', 'o.matrixAutoUpdate=!1,t.add(o),$tunnelTerrain(e,n);let s=null,l=null;'],
  ]),
  patch('character-O1u3Gxpp.js', '', [
    ['this.phys.groundHeight(E,O)', 'this.phys.groundHeight(E,O,D-A)'],
  ]),
].filter(Boolean);
const runtime = readFileSync(root + 'src/client/src/streets/tunnels.js', 'utf8');
if (!existsSync(assets + 'tunnels.js') || readFileSync(assets + 'tunnels.js', 'utf8') !== runtime) writeFileSync(assets + 'tunnels.js', runtime);
for (const [path, code] of changes) writeFileSync(path, code);
console.log(`Functional tunnels: updated ${changes.length} client chunks and shared runtime.`);
