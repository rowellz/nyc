/** Clearance planning across bridge tags and their connected approach roads. */
const cache = new WeakMap();
const VEHICLES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service']);
const pointKey = p => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
const slab = r => r.cls === 'motorway' || r.cls === 'trunk' ? 1 : 1.4;
const CELL = 32, STEP = 4, CLEARANCE = 4.8;

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
  for (const entry of entries) if (entry.road.bridge) for (const p of entry.points) nodes[p.id].layer = Math.max(nodes[p.id].layer ?? -Infinity, entry.road.layer);
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
  const nearbyNodes = new Map();
  const localJoin = (a, b, reach) => {
    if (!nearbyNodes.has(a)) {
      const distances = new Map([[a, 0]]), queue = [a];
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i], d = distances.get(id);
        for (const [other, length] of nodes[id].links) {
          const next = d + length;
          if (next > 80 || next >= (distances.get(other) ?? Infinity)) continue;
          distances.set(other, next); queue.push(other);
        }
      }
      nearbyNodes.set(a, distances);
    }
    return (nearbyNodes.get(a).get(b) ?? Infinity) < reach;
  };
  const approachLayer = (id, reach) => {
    localJoin(id, id, reach);
    let layer = -Infinity;
    for (const [other, distance] of nearbyNodes.get(id)) if (distance < reach) layer = Math.max(layer, nodes[other].layer ?? -Infinity);
    return layer;
  };
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
            // Tiny connector ways can split a merge into several road records.
            // A short path through actual shared nodes is still one junction.
            if (localJoin(upper.points[i].id, lowerId, 2 * (upper.hw + lower.hw + STEP))) continue;
            if (!lower.road.bridge && approachLayer(lowerId, 2 * (upper.hw + lower.hw + STEP)) >= upper.road.layer) continue;
            nodes[lowerId].crossings.push([upper.points[i].id, CLEARANCE + slab(upper.road) + 0.15]);
          }
        }
        begin = end;
      }
    }
  }
  // Propagate the required clearance into connected approaches. Keeping bridge
  // tag endpoints pinned to zero forces a ramp through traffic just before them.
  // Use the gentlest feasible grade; unusually short map loops need a steeper run.
  let required;
  for (const grade of [0.12, 0.18, 0.25, 0.4]) {
    required = new Float64Array(nodes.length);
    const queue = [], queued = new Uint8Array(nodes.length), visits = new Uint16Array(nodes.length);
    const raise = (id, height) => {
      if (height <= required[id] + 1e-7) return;
      required[id] = height;
      if (!queued[id]) { queue.push(id); queued[id] = 1; }
    };
    nodes.forEach(n => n.crossings.forEach(([id, height]) => raise(id, n.base + height)));
    let feasible = true;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor], n = nodes[id]; queued[id] = 0;
      if (++visits[id] > 128) { feasible = false; break; }
      for (const [other, distance] of n.links) raise(other, required[id] - grade * distance);
      for (const [other, height] of n.crossings) raise(other, Math.max(n.base, required[id]) + height);
    }
    if (feasible) break;
    // Contradictory source topology must not discard an entire streamed tile
    // or generate unbounded towers. Preserve its original profiles in that case.
    if (grade === 0.4) return new Map(entries.map(entry => [entry.road.id, entry.base]));
  }
  return new Map(entries.map(({ road, base, points }) => {
    const heights = points.map(p => Math.max(base.hAt(p.s), required[p.id]));
    return [road.id, { hw: base.hw, H: Math.max(base.H, ...heights), hAt: s => {
      let lo = 0, hi = points.length - 1;
      while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (points[mid].s < s) lo = mid; else hi = mid; }
      const t = Math.max(0, Math.min(1, (s - points[lo].s) / (points[hi].s - points[lo].s || 1)));
      return heights[lo] + (heights[hi] - heights[lo]) * t;
    } }];
  }));
}
