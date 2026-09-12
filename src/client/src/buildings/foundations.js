import { tunnelRoads } from './tunnel-roads.js';
import { TUNNEL_CLEARANCE } from '../streets/tunnels.js';

// The entrance floor is at ROAD_Y (0.025), with a 0.4 m roof slab.
export const TUNNEL_FOUNDATION_Y = 0.025 + TUNNEL_CLEARANCE + 0.4;

function inside(p, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
const inPolygon = (p, poly) => inside(p, poly[0]) && !poly.slice(1).some(r => inside(p, r));
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function intersects(a, b, c, d) {
  if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.min(a[0], b[0]) > Math.max(c[0], d[0])
    || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.min(a[1], b[1]) > Math.max(c[1], d[1])) return false;
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}
const bounds = ring => ({ x0: Math.min(...ring.map(p => p[0])), x1: Math.max(...ring.map(p => p[0])),
  z0: Math.min(...ring.map(p => p[1])), z1: Math.max(...ring.map(p => p[1])) });

/** Index the full tunnel width, so an edge-only overlap also elevates a building.
 * A city-wide index keeps both LODs stable regardless of tile arrival order. */
export function foundationIndex(roads) {
  const grid = new Map();
  for (const r of roads) {
    if (r.tunnel === false || ['footway', 'pedestrian', 'steps', 'cycleway'].includes(r.cls)) continue;
    const hw = Math.max(2, r.width / 2);
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], size = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (size < 1e-6) continue;
      const rx = -(b[1] - a[1]) / size * hw, rz = (b[0] - a[0]) / size * hw;
      const ring = [[a[0] - rx, a[1] - rz], [b[0] - rx, b[1] - rz], [b[0] + rx, b[1] + rz], [a[0] + rx, a[1] + rz]];
      const entry = { ring, ...bounds(ring) };
      for (let x = Math.floor(entry.x0 / 256); x <= Math.floor(entry.x1 / 256); x++) {
        for (let z = Math.floor(entry.z0 / 256); z <= Math.floor(entry.z1 / 256); z++) {
          const key = `${x},${z}`;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(entry);
        }
      }
    }
  }
  return grid;
}
const cityIndex = foundationIndex(tunnelRoads);

export function buildingFoundation(building, index = cityIndex) {
  const poly = building.footprint;
  if (!poly?.[0]?.length) return 0;
  const bb = bounds(poly[0]), seen = new Set();
  for (let x = Math.floor(bb.x0 / 256); x <= Math.floor(bb.x1 / 256); x++) {
    for (let z = Math.floor(bb.z0 / 256); z <= Math.floor(bb.z1 / 256); z++) {
      for (const e of index.get(`${x},${z}`) ?? []) {
        if (seen.has(e)) continue;
        seen.add(e);
        if (e.x1 < bb.x0 || e.x0 > bb.x1 || e.z1 < bb.z0 || e.z0 > bb.z1) continue;
        if (e.ring.some(p => inPolygon(p, poly)) || poly[0].some(p => inside(p, e.ring))) return TUNNEL_FOUNDATION_Y;
        for (const ring of poly) for (let i = 0; i < ring.length; i++) {
          for (let j = 0; j < e.ring.length; j++) {
            if (intersects(ring[i], ring[(i + 1) % ring.length], e.ring[j], e.ring[(j + 1) % e.ring.length])) return TUNNEL_FOUNDATION_Y;
          }
        }
      }
    }
  }
  return 0;
}

/** A thin foundation slab closes the raised building's underside. Its bottom
 * stays above the tunnel's clear opening; no solid plinth seals the roadway. */
export function foundationSlab(baker, poly) {
  if (!baker.baseY) return;
  const a = { r: 0.48, g: 0.47, b: 0.44, tierTop: 0, floorH: 3, styleSeed: 0,
    partyH: 0, wallLen: 0, flags: 0, gfH: 3, kind: 2 };
  const firstVertex = baker.pos.n, firstIndex = baker.idx.n;
  baker.cap(poly, -0.25, a);
  for (let i = firstVertex + 1; i < baker.nrm.n; i += 3) baker.nrm.a[i] = -1;
  for (let i = firstIndex; i < baker.idx.n; i += 3) {
    const v = baker.idx.a[i + 1]; baker.idx.a[i + 1] = baker.idx.a[i + 2]; baker.idx.a[i + 2] = v;
  }
  baker.colCap(poly, -0.25);
  for (const ring of poly) for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const edge = { ax: p[0], az: p[1], bx: q[0], bz: q[1], len, nx: dz / len, nz: -dx / len };
    baker.wallQuad(edge, -0.25, 0, a); baker.colWall(edge, -0.25, 0);
  }
}
