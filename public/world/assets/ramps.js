/** Clearance planning across bridge tags and their connected approach roads. */
import { PEDESTRIAN_HEADROOM, PEDESTRIAN_FLOOR } from './pedestrian-clearance.js';
const cache = new WeakMap();
const VEHICLES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service']);
const pointKey = p => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
const slab = r => r.cls === 'motorway' || r.cls === 'trunk' ? 1 : 1.4;
const CELL = 32, STEP = 4, CLEARANCE = 4.8;
// Rise / horizontal run. Apply to the final profile, including native bridge
// crowns and clearance corrections, rather than just to each added lift.
export const MAX_ROAD_GRADE = 0.08;
export const MAX_ROAD_HEIGHT = 36;
// Include the longest possible descent plus a sampling margin in streamed jobs.
export const ROAD_PROFILE_REACH = Math.ceil((MAX_ROAD_HEIGHT / MAX_ROAD_GRADE + STEP * 2) / 256) * 256;

export function clearanceProfile(env, road, baseProfile) {
  let profiles = cache.get(env);
  if (!profiles) {
    profiles = plan(env, baseProfile);
    cache.set(env, profiles);
  }
  return profiles.get(road.id) ?? baseProfile(env, road);
}

function plan(env, baseProfile) {
  const roads = [...new Map(env.tile.roads.filter(r => !r.tunnel && r.pts.length > 1 && VEHICLES.has(r.cls)).map(r => [r.id, r])).values()]
    .sort((a, b) => a.id - b.id);
  const ends = new Map();
  for (const r of roads) for (const p of [r.pts[0], r.pts.at(-1)]) {
    const key = pointKey(p), layers = ends.get(key) ?? new Set();
    layers.add(r.layer); ends.set(key, layers);
  }
  const nodes = [], byKey = new Map();
  const node = (key, base) => {
    if (!byKey.has(key)) { byKey.set(key, nodes.length); nodes.push({ base: 0, links: [], crossings: [] }); }
    const index = byKey.get(key); nodes[index].base = Math.max(nodes[index].base, base); return index;
  };
  const entries = roads.map(r => {
    const base = baseProfile(env, r), points = [];
    let along = 0;
    for (let i = 0; i < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const length = b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
      const count = b ? Math.max(1, Math.ceil(length / STEP)) : 1;
      for (let j = 0; j < count; j++) {
        const t = b ? j / count : 0, x = a[0] + (b ? b[0] - a[0] : 0) * t, z = a[1] + (b ? b[1] - a[1] : 0) * t;
        const s = along + length * t, xy = pointKey([x, z]);
        // Only actual OSM nodes join roads. Interior overpass nodes retain their layer.
        const key = j === 0 ? `${xy}:${ends.get(xy)?.has(r.layer) ? 'end' : r.layer}` : `${r.id}:${i}:${j}`;
        const id = node(key, base.hAt(s)); points.push({ x, z, s, id });
      }
      along += length;
    }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], distance = b.s - a.s;
      nodes[a.id].links.push([b.id, distance]); nodes[b.id].links.push([a.id, distance]);
    }
    return { road: r, base, points, length: along, hw: base.hw };
  });
  // Hold the whole ramp segment above a walking corridor. These are fixed ground
  // constraints, not graph connections that could pull pedestrians up with the road.
  if (env.pedestrians) for (const entry of entries) {
    if (!entry.road.bridge) continue;
    for (let i = 1; i < entry.points.length; i++) {
      const a = entry.points[i - 1], b = entry.points[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z); if (length < 1e-6) continue;
      const hw = entry.hw + .5, nx = -(b.z - a.z) / length * hw, nz = (b.x - a.x) / length * hw;
      // Rendering resamples clipped ways at different stations. Cover one extra
      // station at either end so interpolation cannot dip over the path's edge.
      const dx = (b.x - a.x) / length * STEP, dz = (b.z - a.z) / length * STEP;
      if (!env.pedestrians.intersects([[a.x - dx - nx, a.z - dz - nz], [b.x + dx - nx, b.z + dz - nz],
        [b.x + dx + nx, b.z + dz + nz], [a.x - dx + nx, a.z - dz + nz]])) continue;
      const height = PEDESTRIAN_FLOOR + PEDESTRIAN_HEADROOM + slab(entry.road) + .15;
      for (const p of [a, b]) nodes[p.id].minimum = Math.max(nodes[p.id].minimum ?? 0, height);
    }
  }
  // Index complete road footprints, not just centreline intersections. This
  // catches oblique crossings and ramps whose outside edge clips a lower lane.
  const cells = new Map();
  for (const entry of entries) for (let i = 1; i < entry.points.length; i++) {
    const a = entry.points[i - 1], b = entry.points[i], pad = entry.hw + 1;
    const segment = { entry, a, b };
    for (let x = Math.floor((Math.min(a.x, b.x) - pad) / CELL); x <= Math.floor((Math.max(a.x, b.x) + pad) / CELL); x++) {
      for (let z = Math.floor((Math.min(a.z, b.z) - pad) / CELL); z <= Math.floor((Math.max(a.z, b.z) + pad) / CELL); z++) {
        const key = `${x},${z}`, bucket = cells.get(key) ?? []; bucket.push(segment); cells.set(key, bucket);
      }
    }
  }
  for (const upper of entries) {
    if (!upper.road.bridge) continue;
    const contacts = new Map();
    upper.points.forEach((p, i) => {
      const pad = upper.hw * 1.6 + STEP, candidates = new Set();
      for (let x = Math.floor((p.x - pad) / CELL); x <= Math.floor((p.x + pad) / CELL); x++) {
        for (let z = Math.floor((p.z - pad) / CELL); z <= Math.floor((p.z + pad) / CELL); z++) {
          for (const segment of cells.get(`${x},${z}`) ?? []) candidates.add(segment);
        }
      }
      for (const segment of candidates) {
        const { entry: lower, a, b } = segment;
        if (lower === upper || lower.road.bridge && lower.road.layer >= upper.road.layer) continue;
        const dx = b.x - a.x, dz = b.z - a.z, size2 = dx * dx + dz * dz;
        if (size2 < 1e-8) continue;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / size2));
        if (Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t) > upper.hw + lower.hw + 0.5) continue;
        let contact = contacts.get(lower);
        if (!contact) { contact = new Map(); contacts.set(lower, contact); }
        const ids = contact.get(i) ?? new Set(); ids.add(a.id); ids.add(b.id); contact.set(i, ids);
      }
    });
    for (const [lower, contact] of contacts) {
      const indices = [...contact.keys()].sort((a, b) => a - b);
      const shared = p => [lower.road.pts[0], lower.road.pts.at(-1)].some(q => pointKey(q) === pointKey(p));
      for (let begin = 0; begin < indices.length;) {
        let end = begin + 1;
        while (end < indices.length && indices[end] === indices[end - 1] + 1) end++;
        // A contiguous overlap at a shared endpoint is a merge, not an underpass.
        const merge = indices[begin] === 0 && shared(upper.road.pts[0])
          || indices[end - 1] === upper.points.length - 1 && shared(upper.road.pts.at(-1));
        if (!merge) for (let k = begin; k < end; k++) {
          const i = indices[k];
          for (const lowerId of contact.get(i)) {
            const constraint = [upper.points[i].id, CLEARANCE + slab(upper.road) + 0.15, `${lower.road.id}:${upper.road.id}`];
            nodes[lowerId].crossings.push(constraint);
          }
        }
        begin = end;
      }
    }
  }
  const required = limitRoadGrades(nodes);
  return new Map(entries.map(({ road, base, points }) => {
    const heights = points.map(p => required[p.id]);
    return [road.id, { hw: base.hw, H: Math.max(...heights), hAt: s => {
      let lo = 0, hi = points.length - 1;
      while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (points[mid].s < s) lo = mid; else hi = mid; }
      const t = Math.max(0, Math.min(1, (s - points[lo].s) / (points[hi].s - points[lo].s || 1)));
      return heights[lo] + (heights[hi] - heights[lo]) * t;
    } }];
  }));
}

/** Difference constraints on the connected road network. Raising neighbours
 * extends a climb without shaving off a bridge crown or pedestrian headroom.
 * Source topology occasionally calls the same junction both a merge and an
 * underpass. Reject that contradictory crossing, never relax the grade limit.
 */
export function limitRoadGrades(nodes) {
  const disabled = new Set();
  for (;;) {
    const heights = Float64Array.from(nodes, n => Math.min(MAX_ROAD_HEIGHT, Math.max(n.base, n.minimum ?? 0)));
    const queue = nodes.map((_, i) => i), queued = new Uint8Array(nodes.length).fill(1);
    const previous = new Int32Array(nodes.length).fill(-1), cause = new Array(nodes.length);
    const visits = new Uint32Array(nodes.length);
    let conflict = -1;
    const raise = (from, to, height, crossing) => {
      if (height <= heights[to] + 1e-7) return;
      heights[to] = height; previous[to] = from; cause[to] = crossing;
      if (height > MAX_ROAD_HEIGHT + 1e-7) conflict = to;
      if (!queued[to]) { queued[to] = 1; queue.push(to); }
    };
    for (let cursor = 0; cursor < queue.length && conflict < 0; cursor++) {
      const id = queue[cursor], n = nodes[id]; queued[id] = 0;
      if (++visits[id] % 64 === 0) {
        const seen = new Set(); let p = id;
        while (p >= 0 && !seen.has(p)) { seen.add(p); p = previous[p]; }
        if (p >= 0) { conflict = p; break; }
      }
      for (const [other, distance] of n.links)
        raise(id, other, heights[id] - MAX_ROAD_GRADE * distance);
      for (const crossing of n.crossings) {
        if (!disabled.has(crossing[2])) raise(id, crossing[0], heights[id] + crossing[1], crossing);
      }
    }
    if (conflict < 0) return heights;
    // Trace the conflicting chain (or positive cycle) and remove its least
    // supported inferred underpass as a whole, not individual sample points.
    const path = [], seen = new Set();
    for (let id = conflict; id >= 0 && !seen.has(id); id = previous[id]) {
      seen.add(id);
      if (cause[id]) path.push({ edge: cause[id], separation: nodes[id].base - nodes[previous[id]].base });
    }
    path.sort((a, b) => a.separation - b.separation || String(a.edge[2]).localeCompare(String(b.edge[2])));
    if (!path.length) throw new Error('Road grade constraint has no crossing to resolve');
    disabled.add(path[0].edge[2]);
  }
}
