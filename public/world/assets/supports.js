import { tunnelNetwork, tunnelHeight } from './tunnels.js';
import { PEDESTRIAN_HEADROOM, PEDESTRIAN_FLOOR } from './pedestrian-clearance.js';

const CLEARANCE = 4.8;
const SHOULDER = 1;
const surfaceCache = new WeakMap();

/** Actual ribbon faces, including mitered bends and widened joins. Heights
 * exclude the road material's 2 cm offset, like the centreline samples. */
export function roadDeckTriangles(decks, roadId) {
  let byRoad = surfaceCache.get(decks);
  if (!byRoad) { byRoad = new Map(); surfaceCache.set(decks, byRoad); }
  if (!byRoad.has(roadId)) {
    const triangles = [];
    for (const deck of decks) {
      if (deck.roadId !== roadId || !deck.surface) continue;
      for (let i = 0; i + 11 < deck.surface.length; i += 6) {
        for (const offsets of [[0, 9, 6], [0, 3, 9]]) {
          triangles.push(offsets.map(o => deck.surface.slice(i + o, i + o + 3)));
        }
      }
    }
    byRoad.set(roadId, triangles);
  }
  return byRoad.get(roadId);
}

export function triangleHeight(triangle, x, z) {
  const [a, b, c] = triangle;
  const bx = b[0] - a[0], bz = b[2] - a[2], cx = c[0] - a[0], cz = c[2] - a[2];
  const det = bx * cz - bz * cx;
  if (Math.abs(det) < 1e-10) return null;
  const u = ((x - a[0]) * cz - (z - a[2]) * cx) / det;
  const v = (bx * (z - a[2]) - bz * (x - a[0])) / det;
  return { height: a[1] + u * (b[1] - a[1]) + v * (c[1] - a[1]), inside: u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6 };
}

/** Sample only the owning deck. An offset lane can cross a tile edge beyond
 * the clipped centreline; extend that end segment's slope instead of falling
 * back to ground height at the boundary. */
export function roadDeckHeight(decks, roadId, x, z) {
  for (const triangle of roadDeckTriangles(decks, roadId)) {
    const sample = triangleHeight(triangle, x, z);
    if (sample?.inside) return sample.height;
  }
  let distance = Infinity, height = 0;
  for (const deck of decks) {
    if (deck.roadId !== roadId) continue;
    for (let i = 1; i < deck.pts.length; i++) {
      const a = deck.pts[i - 1], b = deck.pts[i], dx = b.x - a.x, dz = b.z - a.z, size2 = dx * dx + dz * dz;
      if (size2 < 1e-8) continue;
      const t = ((x - a.x) * dx + (z - a.z) * dz) / size2, clipped = Math.max(0, Math.min(1, t));
      const d = (x - a.x - dx * clipped) ** 2 + (z - a.z - dz * clipped) ** 2;
      if (d >= distance) continue;
      distance = d;
      const sample = t < 0 && i === 1 || t > 1 && i === deck.pts.length - 1 ? t : clipped;
      height = Math.max(0, a.h + (b.h - a.h) * sample);
    }
  }
  return height;
}

/** Profile neighbouring roads once. Support placement uses real road widths and
 * ramp elevations, rather than assuming OSM layer numbers are physical heights. */
export function supportPlanner(env, deckProfile) {
  const tunnels = tunnelNetwork(env.tile.roads);
  const roads = [...new Map(env.tile.roads.filter(r => r.pts.length > 1 && !['steps', 'footway', 'pedestrian', 'cycleway'].includes(r.cls))
    .map(r => [r.id, r])).values()].map(road => {
    const profile = !road.tunnel ? deckProfile(env, road) : null;
    let along = 0;
    const segments = [];
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      segments.push({ a, dx, dz, length, along }); along += length;
    }
    return { road, segments, hw: profile?.hw ?? Math.max(2, road.width / 2),
      height: s => road.tunnel ? tunnelHeight(tunnels.get(road.id), s) : profile ? profile.hAt(s) : 0 };
  });

  function obstructed(self, x, z, radius, top, bottom) {
    if (top > PEDESTRIAN_FLOOR && bottom < PEDESTRIAN_FLOOR + PEDESTRIAN_HEADROOM
      && env.pedestrians?.intersects([[x - radius - .3, z - radius - .3], [x + radius + .3, z - radius - .3],
        [x + radius + .3, z + radius + .3], [x - radius - .3, z + radius + .3]])) return true;
    for (const entry of roads) {
      if (entry.road.id === self.id) continue;
      const reach = entry.hw + radius + SHOULDER;
      for (const s of entry.segments) {
        if (x < Math.min(s.a[0], s.a[0] + s.dx) - reach || x > Math.max(s.a[0], s.a[0] + s.dx) + reach
          || z < Math.min(s.a[1], s.a[1] + s.dz) - reach || z > Math.max(s.a[1], s.a[1] + s.dz) + reach) continue;
        const t = Math.max(0, Math.min(1, ((x - s.a[0]) * s.dx + (z - s.a[1]) * s.dz) / s.length ** 2));
        if (Math.hypot(x - s.a[0] - s.dx * t, z - s.a[1] - s.dz * t) > reach) continue;
        const floor = entry.height(s.along + t * s.length);
        if (floor < top && floor + CLEARANCE > bottom) return true;
      }
    }
    return false;
  }

  return (road, q, hw, top, capH, columnHalfWidth) => {
    const rx = -q.dz, rz = q.dx;
    const radius = columnHalfWidth * Math.SQRT2;
    const blocked = offset => obstructed(road, q.x + rx * offset, q.z + rz * offset, radius, top - capH, 0);
    let offsets = hw > 6 ? [-hw * 0.5, hw * 0.5] : [0];
    if (offsets.some(blocked)) {
      // A portal frame spans traffic below. Search outwards on both sides;
      // a crossing that cannot be spanned here uses the next support station.
      offsets = [];
      for (const side of [-1, 1]) {
        let found = null;
        for (let d = hw + 1.5; d <= hw + 24; d += 0.75) {
          if (!blocked(side * d)) { found = side * d; break; }
        }
        if (found === null) return null;
        offsets.push(found);
      }
    }
    const halfWidth = Math.max(hw + 0.3, ...offsets.map(o => Math.abs(o) + columnHalfWidth + 0.15));
    // The crossbeam must also clear vehicles on any lower ramp/deck.
    for (let d = -halfWidth; d <= halfWidth; d += 0.75) {
      if (obstructed(road, q.x + rx * d, q.z + rz * d, 0.75, top, top - capH)) return null;
    }
    return { offsets, halfWidth };
  };
}
