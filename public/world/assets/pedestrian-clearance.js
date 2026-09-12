import { carriagewayIndex } from './carriageway.js';

const CELL = 16;
const WALK_CLASSES = new Set(['footway', 'pedestrian', 'path']);
export const PEDESTRIAN_HEADROOM = 2.5;
export const PEDESTRIAN_FLOOR = 0.15;

/** Only use the portions of mapped walking areas that survive the road-paving trim. */
export function pedestrianClearance(tiles, roads, triangulate) {
  const cells = new Map();
  const bounds = poly => ({ x0: Math.min(...poly.map(p => p[0])), x1: Math.max(...poly.map(p => p[0])),
    z0: Math.min(...poly.map(p => p[1])), z1: Math.max(...poly.map(p => p[1])) });
  const keys = function* (b) {
    for (let x = Math.floor(b.x0 / CELL); x <= Math.floor(b.x1 / CELL); x++)
      for (let z = Math.floor(b.z0 / CELL); z <= Math.floor(b.z1 / CELL); z++) yield `${x},${z}`;
  };
  const add = poly => {
    if (poly.length < 3) return;
    const item = { poly, bounds: bounds(poly) };
    for (const key of keys(item.bounds)) {
      const list = cells.get(key) ?? []; list.push(item); cells.set(key, list);
    }
  };
  const seenPaths = new Set();
  for (const tile of tiles) {
    const road = carriagewayIndex(tile, roads, triangulate);
    const addTrimmed = ring => { for (const part of road.clip(ring) ?? [ring]) add(part); };
    for (const poly of [...tile.sidewalks, ...tile.medians, ...tile.plazas]) {
      const tri = triangulate(poly); if (!tri) continue;
      for (let i = 0; i < tri.tris.length; i += 3) addTrimmed([0, 1, 2].map(j => {
        const v = tri.tris[i + j] * 2; return [tri.verts[v], tri.verts[v + 1]];
      }));
    }
    // Footpaths outside mapped paving are also walking corridors. Clip each portion
    // to its owner square so neighbouring roadbed holes use the correct tile data.
    const x0 = tile.tx * 256, z0 = tile.tz * 256;
    for (const r of roads) {
      if (r.bridge || r.tunnel || !WALK_CLASSES.has(r.cls)) continue;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 1e-6) continue;
        if (Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) >= x0 + 256
          || Math.max(a[1], b[1]) < z0 || Math.min(a[1], b[1]) >= z0 + 256) continue;
        const count = Math.ceil(length / 2), hw = Math.max(.6, r.width / 2);
        const nx = -(b[1] - a[1]) / length * hw, nz = (b[0] - a[0]) / length * hw;
        for (let j = 0; j < count; j++) {
          const x = a[0] + (b[0] - a[0]) * (j + .5) / count, z = a[1] + (b[1] - a[1]) * (j + .5) / count;
          if (x < x0 || x >= x0 + 256 || z < z0 || z >= z0 + 256) continue;
          const key = `${r.id}:${i}:${j}`; if (seenPaths.has(key)) continue; seenPaths.add(key);
          const ends = [j / count, (j + 1) / count].map(t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          addTrimmed([[ends[0][0] - nx, ends[0][1] - nz], [ends[1][0] - nx, ends[1][1] - nz],
            [ends[1][0] + nx, ends[1][1] + nz], [ends[0][0] + nx, ends[0][1] + nz]]);
        }
      }
    }
  }
  // Separating axes preserve courtyard holes and reject a sidewalk beside, rather
  // than beneath, the deck. Both inputs are convex after triangulation/trimming.
  function overlaps(a, b) {
    for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], nx = -(q[1] - p[1]), nz = q[0] - p[0];
      if (Math.abs(nx) + Math.abs(nz) < 1e-8) continue;
      const projection = ring => ring.map(v => (v[0] - p[0]) * nx + (v[1] - p[1]) * nz);
      const aa = projection(a), bb = projection(b);
      if (Math.max(...aa) <= Math.min(...bb) + 1e-7 || Math.max(...bb) <= Math.min(...aa) + 1e-7) return false;
    }
    return true;
  }
  return {
    intersects(poly) {
      const bb = bounds(poly), seen = new Set();
      for (const key of keys(bb)) for (const item of cells.get(key) ?? []) {
        if (seen.has(item)) continue; seen.add(item);
        const b = item.bounds;
        if (b.x1 <= bb.x0 || b.x0 >= bb.x1 || b.z1 <= bb.z0 || b.z0 >= bb.z1) continue;
        if (overlaps(poly, item.poly)) return true;
      }
      return false;
    },
  };
}

/** Match the two-tile approach-planning margin used by street workers. */
export function pedestrianTiles(world, tile) {
  return [...world.tiles.values()].filter(t => Math.abs(t.tx - tile.tx) <= 2 && Math.abs(t.tz - tile.tz) <= 2)
    .map(t => ({ tx: t.tx, tz: t.tz, sidewalks: t.sidewalks, medians: t.medians, plazas: t.plazas,
      roadbeds: t.roadbeds, parking: t.parking }));
}
