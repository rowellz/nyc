import { pedestrianClearance } from '../../public/world/assets/pedestrian-clearance.js';
import { resolveRoadOverlaps } from '../../public/world/assets/road-overlap.js';
/**
 * The carriageway rule: paving laid for pedestrians never covers the ground the street builders pave or
 * paint for motor traffic. Planimetric sidewalk polygons overhang the curb — on the Trans-Manhattan
 * Expressway a whole slab crossed the lanes — and the 15 cm concrete buried the lane lines under it while a
 * granite curb stood in live traffic.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import { carriagewayIndex, pathHalfWidth, pathPieceClear } from '../../public/world/assets/carriageway.js';
import { roadFootprints } from '../../public/world/assets/fixtures.js';
import { deckEdges, barrierRuns } from '../../public/world/assets/edges.js';
import { clearanceProfile } from '../../public/world/assets/ramps.js';
import * as tunnels from '../../public/world/assets/tunnels.js';
import { supportPlanner, roadDeckHeight, roadDeckTriangles, triangleHeight } from '../../public/world/assets/supports.js';

const square = (x0, z0, x1, z1) => [[[x0, z0], [x1, z0], [x1, z1], [x0, z1]]];
const ear = poly => {
  // Enough triangulation for the test polygons (convex rectangles); the worker passes geom2d's.
  const ring = poly[0], verts = ring.flat(), tris = [];
  for (let i = 1; i + 1 < ring.length; i++) tris.push(0, i, i + 1);
  return { verts, tris };
};
const emptyTile = extra => ({ key: '0_0', tx: 0, tz: 0, roads: [], buildings: [], roadbeds: [], sidewalks: [], medians: [],
  parks: [], water: [], parking: [], plazas: [], crossings: [], trees: [], props: [], groundElev: 0, ...extra });
const street = (extra = {}) => ({ id: 1, pts: [[10, 0], [10, 60]], cls: 'primary', width: 20, lanes: 4, oneway: false,
  surface: 'asphalt', bridge: false, tunnel: false, layer: 0, ...extra });

// --- the rule itself -------------------------------------------------------------------------------

{
  const index = carriagewayIndex(emptyTile({ roadbeds: [square(0, 0, 20, 60)] }), [], ear);
  assert(!index.empty);
  assert(index.covers(10, 30), 'planimetric asphalt is carriageway');
  assert(!index.covers(25, 30), 'the sidewalk beside it is not');
  assert.equal(index.clip([[25, 25], [30, 25], [30, 30]]), null, 'a ring clear of the roadway is left alone');
  assert.deepEqual(index.clip([[2, 25], [8, 25], [8, 30]]), [], 'a ring wholly inside it is dropped');
  const parts = index.clip([[16, 20], [26, 20], [26, 30]]);
  assert(parts && parts.length, 'a ring overhanging the curb is trimmed, not dropped');
  for (const part of parts) for (const [x] of part) assert(x >= 19.99, `trimmed paving reaches x=${x}, inside the roadbed`);
}

{
  // No planimetric polygons: the painted lane envelope of the centreline still owns its ground.
  const index = carriagewayIndex(emptyTile({ roads: [street()] }), [street()], ear);
  assert(index.covers(10, 30), 'the lanes are carriageway without a roadbed polygon');
  assert(index.covers(16.5, 30), 'out to the outer lane line');
  assert(!index.covers(30, 30), 'not out to the building line');
  for (const over of [{ bridge: true }, { tunnel: true }, { layer: 2 }]) {
    const raised = street(over);
    const above = carriagewayIndex(emptyTile({ roads: [raised] }), [raised], ear);
    assert(!above.covers(10, 30), `a ${JSON.stringify(over)} roadway passes over the sidewalk, not through it`);
  }
}

{
  const index = carriagewayIndex(emptyTile({ roadbeds: [square(0, 0, 20, 60)] }), [], ear);
  assert.equal(pathHalfWidth(index, 3, 22, 30, 0, 1), 2, 'a 6 m path beside the curb narrows until it clears the lanes');
  assert.equal(pathHalfWidth(index, 3, 40, 30, 0, 1), 3, 'a path with room keeps its width');
  assert.equal(pathHalfWidth(null, 3, 22, 30, 0, 1), 3, 'no index, no change');
}
console.log('PASS the carriageway is the paved and painted roadway, at grade, and paving is trimmed to it');

// --- the served worker -----------------------------------------------------------------------------

let result;
const sandbox = { console, performance, self: { postMessage: r => { result = r; } },
  $roadFootprints: roadFootprints, $deckEdges: deckEdges, $barrierRuns: barrierRuns, $clearanceProfile: clearanceProfile,
  $roadDeckTriangles: roadDeckTriangles, $triangleHeight: triangleHeight, $roadDeckHeight: roadDeckHeight, $supportPlanner: supportPlanner,
  $tunnelBuild: tunnels.buildTunnels, $tunnelNetwork: tunnels.tunnelNetwork, $tunnelCut: tunnels.cutBuilder,
  $carriagewayIndex: carriagewayIndex, $pathHalfWidth: pathHalfWidth, $pathPieceClear: pathPieceClear, $resolveRoadOverlaps: resolveRoadOverlaps, $pedestrianClearance: pedestrianClearance };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../../public/world/assets/tile.worker-Ai2ZdmRL.js', import.meta.url), 'utf8').replace(/^import .*$/gm, ''), sandbox);
async function build(tile, roads = tile.roads) {
  await sandbox.self.onmessage({ data: { id: 1, input: { tile, roads, quality: { level: 'mobile', shadows: false } } } });
  assert(!result.error, result.error);
  return result.built;
}

/** the flat 15 cm slab tops of the walk mesh, as triangles */
function slabs(built) {
  const m = built.meshes[1], pos = m.attributes.position.data, nrm = m.attributes.normal.data, idx = m.index, out = [];
  for (let i = 0; i < idx.length; i += 3) {
    const v = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
    if (!v.every(a => nrm[a + 1] > 0.99 && Math.abs(pos[a + 1] - 0.15) < 1e-3)) continue;
    const p = v.map(a => [pos[a], pos[a + 2]]);
    out.push({ p, area: Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2,
      cx: (p[0][0] + p[1][0] + p[2][0]) / 3, cz: (p[0][1] + p[1][1] + p[2][1]) / 3 });
  }
  return out;
}

/** vertical granite faces (0 -> 0.12 m), as their footprint segments */
function curbs(built) {
  const m = built.meshes[1], pos = m.attributes.position.data, nrm = m.attributes.normal.data, idx = m.index, out = [];
  for (let i = 0; i < idx.length; i += 3) {
    const v = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
    if (Math.abs(nrm[v[0] + 1]) > 0.01) continue;
    if (Math.max(...v.map(a => pos[a + 1])) > 0.13) continue;
    out.push({ x: v.map(a => pos[a]), z: v.map(a => pos[a + 2]), nx: nrm[v[0]], nz: nrm[v[0] + 2] });
  }
  return out;
}

{
  // A sidewalk polygon overhanging a 20 m roadbed by 4 m, the shape the planimetric data keeps drawing.
  const road = street();
  const tile = emptyTile({ roads: [road], roadbeds: [square(0, 0, 20, 60)], sidewalks: [square(16, 10, 30, 50)] });
  const built = await build(tile);
  const tops = slabs(built);
  assert(tops.length, 'the sidewalk is still built');
  let kept = 0;
  for (const t of tops) {
    for (const [x, z] of t.p) assert(x > 19.9 || z < 9.9 || z > 50.1, `slab corner at ${x.toFixed(2)},${z.toFixed(2)} is inside the roadbed`);
    if (t.cx > 20 && t.cx < 30) kept += t.area;
  }
  // 14 m x 40 m of data, 4 m of it over the roadbed: exactly the 10 m x 40 m outside the curb is left.
  assert(Math.abs(kept - 400) < 1, `the sidewalk outside the roadway survives whole (${kept.toFixed(1)} m2 of an expected 400)`);
  const trim = curbs(built).filter(c => c.x.every(x => Math.abs(x - 20) < 0.05));
  assert(trim.length, 'the trimmed edge gets its own curb, at the edge of the roadbed');
  const span = trim.flatMap(c => c.z);
  assert(Math.min(...span) < 12 && Math.max(...span) > 48, 'and that curb runs the length of the trim');
  for (const c of trim) assert(c.nx < -0.99, 'facing the roadway it holds back');
}
console.log('PASS an overhanging slab is trimmed at the roadbed, curbed on the trim, and otherwise kept');

// --- the reported blocks ---------------------------------------------------------------------------

const loadTile = key => JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${key}.json.gz`, import.meta.url))));
const inRing = (x, z, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const inPoly = (x, z, poly) => inRing(x, z, poly[0]) && !poly.slice(1).some(hole => inRing(x, z, hole));
function polygonArea(polys, keep) {
  let m2 = 0;
  for (const poly of polys) {
    const xs = poly[0].map(p => p[0]), zs = poly[0].map(p => p[1]);
    for (let x = Math.min(...xs); x < Math.max(...xs); x += 0.5)
      for (let z = Math.min(...zs); z < Math.max(...zs); z += 0.5)
        if (inPoly(x, z, poly) && keep(x, z)) m2 += 0.25;
  }
  return m2;
}

// 15_-42 and 14_-42 carry the Trans-Manhattan Expressway through Highbridge Park.
for (const key of ['15_-42', '14_-42', '18_-40']) {
  const tile = loadTile(key);
  const beds = [...tile.roadbeds, ...tile.parking];
  const onRoadway = (x, z) => beds.some(p => inPoly(x, z, p));
  const overhang = polygonArea(tile.sidewalks, onRoadway);
  assert(overhang > 100, `${key}: the fixture tile should still have sidewalk data overhanging the curb`);
  const built = await build(tile);
  let left = 0;
  for (const t of slabs(built)) {
    if (!onRoadway(t.cx, t.cz)) continue;
    left += t.area;
  }
  assert(left < 8, `${key}: ${left.toFixed(1)} m2 of pedestrian paving still sits on the roadway (was ${overhang.toFixed(0)} m2 of overhang)`);
  console.log(`  ${key}: ${overhang.toFixed(0)} m2 of overhanging sidewalk data, ${left.toFixed(1)} m2 left on the roadway`);
}
console.log('PASS real Highbridge and Bronx blocks keep their paving off the lanes');

assert.equal(readFileSync(new URL('../../src/client/src/streets/carriageway.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../../public/world/assets/carriageway.js', import.meta.url), 'utf8'),
  'source and served carriageway rule are the same file');
console.log('PASS source and served carriageway rule match');

// Median labels are not permission to lay a raised crossing through live motorway lanes.
{
  const tile=emptyTile({roads:[street({cls:"motorway"})],roadbeds:[square(0,0,20,60)],medians:[square(5,20,30,24)]});
  const built=await build(tile);
  const tops=slabs(built);
  assert(tops.some(t=>t.cx>20),'the safe portion of a median is retained');
  assert(!tops.some(t=>t.cx<19.99),'the portion crossing the roadway is removed');
}
// Check the entire ribbon footprint, and give asphalt footpaths the same navigation support as concrete.
for (const surface of ['concrete','asphalt']) {
  const path=street({id:88,cls:'footway',width:3,lanes:0,surface,pts:[[10,30],[50,30]]});
  const tile=emptyTile({roads:[street({cls:"motorway"}),path],roadbeds:[square(0,0,20,60)]});
  const built=await build(tile);
  const walk=built.walkCollision, p=walk.position;
  let pathFaces=0;
  for(let i=0;i<walk.index.length;i+=3){
    const vertices=[0,1,2].map(j=>walk.index[i+j]*3);
    if(!vertices.every(v=>Math.abs(p[v+1]-(surface==='asphalt'?.02:.15))<.001))continue;
    pathFaces++;
    for(const v of vertices)assert(p[v]>=19.99,`${surface} path corner intrudes into the road at ${p[v]}`);
  }
  assert(pathFaces>0,`${surface} path outside traffic still supports walking`);
}
console.log('PASS crossing medians and full path footprints clear traffic; asphalt and concrete paths retain navigation support');
