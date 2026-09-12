import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';

const tunnels = await import(new URL('tunnels.js', assets));
const { roadFootprints } = await import(new URL('fixtures.js', assets));
const { deckEdges, barrierRuns } = await import(new URL('edges.js', assets));
const { clearanceProfile } = await import(new URL('ramps.js', assets));
const { carriagewayIndex, pathHalfWidth, pathPieceClear } = await import(new URL('carriageway.js', assets));
const { resolveRoadOverlaps } = await import(new URL('road-overlap.js', assets));
const { pedestrianClearance } = await import(new URL('pedestrian-clearance.js', assets));
const { supportPlanner, roadDeckHeight, roadDeckTriangles, triangleHeight } = await import(new URL('supports.js', assets));

let response;
const sandbox = { console, performance, self: { postMessage: value => { response = value; } },
  $roadFootprints: roadFootprints, $deckEdges: deckEdges, $barrierRuns: barrierRuns,
  $clearanceProfile: clearanceProfile, $roadDeckTriangles: roadDeckTriangles,
  $triangleHeight: triangleHeight, $roadDeckHeight: roadDeckHeight, $supportPlanner: supportPlanner,
  $tunnelFinish: tunnels.finishTunnelApproaches, $tunnelBuild: tunnels.buildTunnels,
  $tunnelNetwork: tunnels.tunnelNetwork, $tunnelCut: tunnels.cutBuilder,
  $carriagewayIndex: carriagewayIndex, $pathHalfWidth: pathHalfWidth,
  $pathPieceClear: pathPieceClear, $resolveRoadOverlaps: resolveRoadOverlaps,
  $pedestrianClearance: pedestrianClearance };
vm.createContext(sandbox);
const worker = readFileSync(new URL('tile.worker-Ai2ZdmRL.js', assets), 'utf8').replace(/^import .*$/gm, '');
vm.runInContext(worker, sandbox);

const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 12,
  lanes: 3, oneway: true, layer: 0, bridge: false, tunnel: false, ...extra });
const approach = road(1, [[150, 100], [283, 100]]);
const bore = road(2, [[150, 100], [20, 100]], { tunnel: true, layer: -1 });
const roads = [approach, bore];
const tile = { key: '0_0', tx: 0, tz: 0, roads, buildings: [], roadbeds: [],
  sidewalks: [], medians: [], parks: [], water: [], parking: [], plazas: [],
  crossings: [], trees: [], props: [], groundElev: 0 };
await sandbox.self.onmessage({ data: { id: 1, input: { tile, roads,
  pedestrianTiles: [tile], quality: { level: 'mobile', shadows: false } } } });
assert(!response.error, response.error);

function heightsAt(x, z) {
  const heights = [];
  for (const mesh of response.built.meshes) {
    if (!mesh) continue;
    const positions = mesh.attributes.position.data;
    for (let i = 0; i < mesh.index.length; i += 3) {
      const triangle = [0, 1, 2].map(j => {
        const at = mesh.index[i + j] * 3;
        return [positions[at], positions[at + 1], positions[at + 2]];
      });
      const sample = triangleHeight(triangle, x, z);
      if (sample?.inside) heights.push(sample.height);
    }
  }
  return heights;
}

for (const x of [155, 190, 230, 250]) {
  const floor = tunnels.tunnelHeight(tunnels.tunnelNetwork(roads).get(approach.id), x - 150) + 0.025;
  const heights = heightsAt(x, 100);
  assert(heights.some(height => Math.abs(height - floor) < 0.08), `missing sloped floor at x=${x}`);
  assert(!heights.some(height => height > floor + 0.2 && height < floor + 4.8), `blocked approach at x=${x}`);
}

console.log('PASS served worker builds clear, collidable motorway descents');
