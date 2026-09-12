import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { assets } from './sveltekit-assets.mjs';

const tunnels = await import(new URL('tunnels.js', assets));
const { highwayLanePath, lanePoint } = await import(new URL('lane-paths.js', assets));
const { laneCount, laneWidth } = await import(new URL('lane-layout.js', assets));
const { triangleHeight } = await import(new URL('supports.js', assets));
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
function intersects(a, b, pts) {
  const d = sub(b, a), e = sub(pts[1], pts[0]), f = sub(pts[2], pts[0]);
  const p = cross(d, f), det = dot(e, p);
  if (Math.abs(det) < 1e-8) return false;
  const t = sub(a, pts[0]), u = dot(t, p) / det;
  if (u < 0 || u > 1) return false;
  const q = cross(t, e), v = dot(d, q) / det, s = dot(f, q) / det;
  return v >= 0 && u + v <= 1 && s > 1e-5 && s <= 1;
}

function geometry(roads, tiles) {
  const rendered = [], out = { cpos: [], cidx: [] };
  for (const tile of tiles) tunnels.buildTunnels({ tile: { ...tile, roads }, rect: {
    minX: tile.tx * 256, maxX: (tile.tx + 1) * 256,
    minZ: tile.tz * 256, maxZ: (tile.tz + 1) * 256,
  } }, { face: pts => rendered.push(pts) }, out);
  const collision = [];
  for (let i = 0; i < out.cidx.length; i += 3) collision.push([0, 1, 2].map(j => out.cpos.slice(out.cidx[i+j]*3, out.cidx[i+j]*3+3)));
  return { rendered: rendered.flatMap(p => [[p[0], p[1], p[2]], [p[0], p[2], p[3]]]), collision };
}

const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 12,
  lanes: 3, oneway: true, layer: -1, bridge: false, tunnel: true, ...extra });
const east = road(1, [[0,100], [200,100]]), north = road(2, [[100,0], [100,200]]);
for (const order of [[east, north], [north, east]]) {
  const built = geometry(order, [{ tx: 0, tz: 0 }]);
  for (const triangles of Object.values(built)) {
    for (const [a,b] of [[[70,-12,100], [130,-12,100]], [[100,-12,70], [100,-12,130]]])
      assert(!triangles.some(t => intersects(a,b,t)), 'crossing passages have no internal walls, regardless of road order');
    assert(triangles.some(t => intersects([50,-12,100], [50,-12,110], t)), 'outer retaining walls remain');
  }
}
// An upper approach crosses a much deeper bore: their walls must remain intact.
const upper = road(3, [[0,100], [200,100]], { tunnel: false, layer: 0 });
const portal = road(4, [[-100,100], [0,100]]);
const stacked = geometry([upper, portal, north], [{ tx: 0, tz: 0 }]);
for (const triangles of Object.values(stacked)) {
  assert(triangles.some(t => intersects([100,-1,100], [100,-1,110], t)), 'upper approach wall remains above the deep bore');
  assert(triangles.some(t => intersects([100,-12,100], [110,-12,100], t)), 'lower bore wall remains below the approach');
}
console.log('PASS crossing openings, retained outer walls, separate elevations, and road-order independence');

// Both ends of the reported expressway, including the fan branches that used
// to draw full-width retaining walls straight through the adjoining lanes.
const tiles = [];
for (let tx = 13; tx <= 19; tx++) for (let tz = -43; tz <= -39; tz++) {
  try { tiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${tx}_${tz}.json.gz`, import.meta.url))))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const roads = [...new Map(tiles.flatMap(t => t.roads).map(r => [r.id, r])).values()];
const profiles = tunnels.tunnelNetwork(roads), world = { tiles: new Map(tiles.map(t => [t.key, t])) };
const built = geometry(roads, tiles);
// Spatial buckets keep thousands of lane checks inexpensive.
function index(triangles) {
  const buckets = new Map();
  for (const tri of triangles) {
    for (let x = Math.floor(Math.min(...tri.map(p => p[0])) / 16); x <= Math.floor(Math.max(...tri.map(p => p[0])) / 16); x++)
      for (let z = Math.floor(Math.min(...tri.map(p => p[2])) / 16); z <= Math.floor(Math.max(...tri.map(p => p[2])) / 16); z++) {
        const k = `${x},${z}`, bucket = buckets.get(k) ?? [];
        bucket.push(tri); buckets.set(k, bucket);
      }
  }
  return (x, z) => buckets.get(`${Math.floor(x/16)},${Math.floor(z/16)}`) ?? [];
}
const physical = index(built.collision), visible = index(built.rendered);
let rays = 0, stations = 0;
const failures = [];
for (const profile of profiles.values()) {
  const road = profile.road;
  if (!road.name?.startsWith('Trans-Manhattan')) continue;
  const count = laneCount(road), width = laneWidth(road);
  for (let lane = 0; lane < count; lane++) {
    let previous;
    for (let segment = 0; segment + 1 < road.pts.length; segment++) {
      const a = road.pts[segment], b = road.pts[segment+1], length = Math.hypot(b[0]-a[0], b[1]-a[1]);
      const dx = (b[0]-a[0])/length, dz = (b[1]-a[1])/length, offset = (lane+.5-count/2)*width;
      const path = highwayLanePath(road, roads, segment, offset) ?? { ax: a[0]-dz*offset, az: a[1]+dx*offset, dx, dz, length };
      for (let s = .5; s < path.length; s += 1) {
        const p = lanePoint(path, s), y = tunnels.trafficHeight(world, road, p.x, p.z);
        if (y >= -.1) { previous = null; continue; }
        const label = `${road.id}, lane ${lane}, ${p.x.toFixed(2)},${p.z.toFixed(2)}`;
        if (!physical(p.x,p.z).some(t => { const h = triangleHeight(t,p.x,p.z); return h?.inside && Math.abs(h.height-y)<.25; })) failures.push(`missing floor: ${label}`);
        if (previous) for (const height of [.5, 1.5, 4.5]) {
          const start = [previous.x, previous.y+height, previous.z], end = [p.x,y+height,p.z];
          for (const [kind, near] of [['collider', physical], ['mesh', visible]]) {
            for (const tri of new Set([...near(p.x,p.z), ...near(previous.x,previous.z)])) {
              if (intersects(start,end,tri)) failures.push(`${kind} blocks ${label} at clearance ${height}: ${JSON.stringify({start,end,tri})}`);
            }
          }
          rays++;
        }
        previous = { ...p, y }; stations++;
      }
    }
  }
}
assert.equal(failures.length, 0, `${failures.length} failures: ${failures.slice(0,12).join('\n')}`);
assert(stations > 2000 && rays > 6000);
console.log(`PASS ${stations} real tunnel/approach lane floor samples and ${rays} vehicle clearance rays`);
