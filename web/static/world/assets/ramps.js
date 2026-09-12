/** Clearance planning across bridge tags and their connected approach roads. */
import { PEDESTRIAN_HEADROOM, PEDESTRIAN_FLOOR } from './pedestrian-clearance.js';
import { approachProfile, approachCeiling, tunnelNetwork, setApproachElevations, APPROACH_REACH, APPROACH_GRADE, PORTAL_DEPTH } from './tunnels.js';
import { deckEdges } from './edges.js';
const cache = new WeakMap();
const VEHICLES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service']);
const motorway = r => r.cls === 'motorway' || r.cls === 'trunk';
const pointKey = p => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
const slab = r => r.cls === 'motorway' || r.cls === 'trunk' ? 1 : 1.4;
const CELL = 32, STEP = 4, CLEARANCE = 4.8;
// Rise / horizontal run. Apply to the final profile, including native bridge
// crowns and clearance corrections, rather than just to each added lift.
export const MAX_ROAD_GRADE = 0.08;
export const MAX_ROAD_HEIGHT = 36;
// Include the longest possible descent plus a sampling margin in streamed jobs.
export const ROAD_PROFILE_REACH = Math.ceil(Math.max(MAX_ROAD_HEIGHT / MAX_ROAD_GRADE + STEP * 2, APPROACH_REACH) / 256) * 256;

export function clearanceProfile(env, road, baseProfile) {
  let profiles = cache.get(env);
  if (!profiles) {
    profiles = plan(env, baseProfile);
    cache.set(env, profiles);
  }
  return profiles.get(road.id) ?? baseProfile(env, road);
}

function plan(env, baseProfile) {
  const tunnels = tunnelNetwork(env.tile.roads);
  const roads = [...new Map(env.tile.roads.filter(r => !r.tunnel && r.pts.length > 1 && VEHICLES.has(r.cls)).map(r => [r.id, r])).values()]
    .sort((a, b) => a.id - b.id);
  const ends = new Map();
  for (const r of roads) for (const p of [r.pts[0], r.pts.at(-1)]) {
    const key = pointKey(p), layers = ends.get(key) ?? new Set();
    layers.add(r.layer); ends.set(key, layers);
  }
  const nodes = [], byKey = new Map();
  const node = (key, base, maximum) => {
    if (!byKey.has(key)) { byKey.set(key, nodes.length); nodes.push({ base: -Infinity, maximum: MAX_ROAD_HEIGHT, links: [], crossings: [] }); }
    const index = byKey.get(key), n = nodes[index];
    n.base = Math.max(n.base, base); n.maximum = Math.min(n.maximum, maximum); return index;
  };
  const entries = roads.map(r => {
    const base = approachProfile(env, r, baseProfile(env, r)), points = [], approach = tunnels.get(r.id);
    const edges = deckEdges(r, env.tile.roads, base.hw);
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
        const ceiling = approach ? approachCeiling(approach, s) : MAX_ROAD_HEIGHT;
        const maximum = approach ? (ceiling + PORTAL_DEPTH) * MAX_ROAD_GRADE / APPROACH_GRADE - PORTAL_DEPTH : MAX_ROAD_HEIGHT;
        const id = node(key, base.hAt(s), maximum); points.push({ x, z, s, id, edges: edges(s) });
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
  // Compare the rendered ribbons, including lane shifts and mitered corners.
  // Layer numbers alone cannot distinguish untagged ramps or same-layer bridges.
  const cells = new Map(), pairs = new Map();
  const overlap = (a, b) => {
    for (const ring of [a, b]) for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], nx = p[1] - q[1], nz = q[0] - p[0];
      const aa = a.map(v => v[0] * nx + v[1] * nz), bb = b.map(v => v[0] * nx + v[1] * nz);
      if (Math.min(...aa) >= Math.max(...bb) - 1e-6 || Math.min(...bb) >= Math.max(...aa) - 1e-6) return false;
    }
    return true;
  };
  for (const entry of entries) for (let i = 1; i < entry.points.length; i++) {
    const a = entry.points[i - 1], b = entry.points[i];
    const ring = [a.edges[0], b.edges[0], b.edges[1], a.edges[1]];
    const segment = { entry, a, b, i, ring }, candidates = new Set();
    for (let x = Math.floor(Math.min(...ring.map(p => p[0])) / CELL); x <= Math.floor(Math.max(...ring.map(p => p[0])) / CELL); x++) {
      for (let z = Math.floor(Math.min(...ring.map(p => p[1])) / CELL); z <= Math.floor(Math.max(...ring.map(p => p[1])) / CELL); z++) {
        const key = `${x},${z}`, bucket = cells.get(key) ?? [];
        for (const other of bucket) candidates.add(other);
        bucket.push(segment); cells.set(key, bucket);
      }
    }
    for (const other of candidates) {
      if (other.entry === entry || !(entry.road.bridge || other.entry.road.bridge
        || motorway(entry.road) && motorway(other.entry.road))
        || !overlap(ring, other.ring)) continue;
      const key = `${other.entry.road.id}:${entry.road.id}`;
      if (!pairs.has(key)) pairs.set(key, { key, a: other.entry, b: entry, contacts: [] });
      pairs.get(key).contacts.push([other, segment]);
    }
  }
  const crossings = [];
  for (const pair of pairs.values()) {
    // A fan may overlap at its junction and cross again farther along the same
    // ways. Only the connected contact region touching the junction is a merge.
    const pending = new Set(pair.contacts);
    while (pending.size) {
      const first = pending.values().next().value, region = [first]; pending.delete(first);
      for (let i = 0; i < region.length; i++) for (const contact of pending) {
        if (Math.abs(contact[0].i - region[i][0].i) <= 1 && Math.abs(contact[1].i - region[i][1].i) <= 1) {
          region.push(contact); pending.delete(contact);
        }
      }
      const aIds = new Set(region.flatMap(c => [c[0].a.id, c[0].b.id]));
      if (region.some(c => aIds.has(c[1].a.id) || aIds.has(c[1].b.id))) {
        // Sibling lanes remain one surface while their merge ribbons overlap.
        // Otherwise lifting a crossing independently can put one merging lane
        // through the other. Match stations along the travel direction: lateral
        // separation is not room for a vertical ramp between adjacent lanes.
        const linked = new Set();
        for (const [a, b] of region) {
          const dx = a.b.x - a.a.x, dz = a.b.z - a.a.z, length = Math.hypot(dx, dz);
          const ex = b.b.x - b.a.x, ez = b.b.z - b.a.z;
          if (Math.abs(dx * ex + dz * ez) < .85 * length * Math.hypot(ex, ez) || length < 1e-6) continue;
          for (const p of [a.a, a.b]) {
            const along = q => Math.abs(((q.x - p.x) * dx + (q.z - p.z) * dz) / length);
            const q = along(b.a) < along(b.b) ? b.a : b.b, distance = along(q);
            const key = `${p.id}:${q.id}`;
            if (p.id === q.id || distance > STEP / 2 || linked.has(key)) continue;
            linked.add(key);
            nodes[p.id].links.push([q.id, 0]); nodes[q.id].links.push([p.id, 0]);
          }
        }
        continue;
      }
      // A through crossing may require revisiting nearby stacking decisions.
      // Keep this more expensive repair separate from parallel shoulder contacts.
      const transverse = region.some(([a, b]) => {
        const dx = a.b.x - a.a.x, dz = a.b.z - a.a.z, ex = b.b.x - b.a.x, ez = b.b.z - b.a.z;
        const det = dx * ez - dz * ex;
        if (Math.abs(det) < .35 * Math.hypot(dx, dz) * Math.hypot(ex, ez) || Math.abs(det) < 1e-8) return false;
        const x = b.a.x - a.a.x, z = b.a.z - a.a.z, t = (x * ez - z * ex) / det, u = (x * dz - z * dx) / det;
        return t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6;
      });
      crossings.push({ ...pair, transverse, contacts: region, key: `${pair.key}:${first[0].i}:${first[1].i}` });
    }
  }
  const required = separateCrossings(nodes, crossings);
  setApproachElevations(tunnels, entries.filter(e => tunnels.has(e.road.id)).map(e => ({
    id: e.road.id, points: e.points.map(p => ({ s: p.s, h: required[p.id], x: p.x, z: p.z }))
  })));
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

/** Solve final elevations, including tunnel approaches, before any mesh or
 * traffic surface is emitted. A trial is atomic: an impossible ordering cannot
 * leave a partially raised ramp or a disconnected shared endpoint. */
function separateCrossings(nodes, crossings) {
  const maximum = Float64Array.from(nodes, n => Math.min(MAX_ROAD_HEIGHT, n.maximum));
  let conflict = [];
  const spread = (values, initial, upper, extra = false) => {
    const queue = [...initial], queued = new Uint8Array(nodes.length);
    const previous = extra ? new Int32Array(nodes.length).fill(-1) : null;
    const cause = extra ? new Array(nodes.length) : null, visits = new Uint32Array(nodes.length);
    const trace = start => {
      const seen = new Set(), keys = new Set();
      let i = start;
      while (i >= 0 && !seen.has(i)) {
        seen.add(i);
        if (cause[i]) keys.add(cause[i]);
        i = previous[i];
      }
      conflict = [...keys];
      return i >= 0;
    };
    for (const i of queue) queued[i] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const i = queue[cursor]; queued[i] = 0;
      // Detect an impossible cyclic stack without repeatedly raising it to the
      // height limit. The same causal path identifies decisions we can reverse.
      if (extra && ++visits[i] % 64 === 0 && trace(i)) return false;
      const edges = nodes[i].links.map(([j, d]) => [j, -MAX_ROAD_GRADE * d]);
      if (extra) edges.push(...nodes[i].crossings);
      for (const [j, delta, key] of edges) {
        const value = upper ? values[i] - delta : values[i] + delta;
        if (upper ? value >= values[j] - 1e-7 : value <= values[j] + 1e-7) continue;
        values[j] = value;
        if (extra) { previous[j] = i; cause[j] = key; }
        if (!upper && value > maximum[j] + 1e-7) {
          if (extra) trace(j);
          return false;
        }
        if (!queued[j]) { queued[j] = 1; queue.push(j); }
      }
    }
    return true;
  };
  const all = nodes.map((_, i) => i);
  // Fixed tunnel mouths bound the whole connected ramp, even across short ways.
  spread(maximum, all, true);
  let heights = Float64Array.from(nodes, (n, i) => Math.min(maximum[i], Math.max(n.base, n.minimum ?? -Infinity)));
  spread(heights, all, false);
  const baseline = heights.slice();
  const ordering = crossing => {
    const {a, b, contacts} = crossing;
    const height = side => Math.max(...contacts.flatMap(c => [heights[c[side].a.id], heights[c[side].b.id]]));
    const difference = height(1) - height(0);
    const layer = (b.road.bridge ? b.road.layer : 0) - (a.road.bridge ? a.road.layer : 0);
    // A nearby tunnel mouth may only leave room for one stacking order. Plan
    // these constrained crossings before choosing heights for freer ramps.
    const fits = [0, 1].map(side => {
      const clearance = CLEARANCE + slab(side ? b.road : a.road) + .25;
      return contacts.every(c => Math.max(heights[c[1 - side].a.id], heights[c[1 - side].b.id]) + clearance
        <= Math.min(maximum[c[side].a.id], maximum[c[side].b.id]) + 1e-7);
    });
    if (fits[0] !== fits[1]) return { side: Number(fits[1]), priority: 3 };
    return { side: Math.abs(difference) >= CLEARANCE + 1 ? Number(difference > 0) : layer ? Number(layer > 0) : Number(difference >= 0),
      priority: Math.abs(difference) >= CLEARANCE + 1 ? 2 : Math.abs(layer) > 0 ? 1 : 0 };
  };
  const ordered = crossings.map(c => ({...c, ...ordering(c)})).sort((a,b) => b.priority-a.priority || a.key.localeCompare(b.key));
  let accepted = new Map();
  const add = (crossing, side) => {
    const additions = [], starts = new Set(), upper = side ? crossing.b : crossing.a;
    for (const contact of crossing.contacts) for (const low of [contact[1 - side].a, contact[1 - side].b])
      for (const high of [contact[side].a, contact[side].b]) {
        const edge = [high.id, CLEARANCE + slab(upper.road) + .25, crossing.key];
        nodes[low.id].crossings.push(edge);
        additions.push([low.id, edge]); starts.add(low.id);
      }
    return { additions, starts };
  };
  const install = choices => {
    for (const n of nodes) n.crossings = [];
    for (const { crossing, side } of choices.values()) add(crossing, side);
  };
  const repair = pending => {
    const stack = [1 - pending.side, pending.side].map(side => new Map([...accepted, [pending.key, { crossing: pending, side }]]));
    const seen = new Set();
    // Search only decisions on a conflicting constraint path. A bounded local
    // repair avoids a combinatorial search over the entire streamed road map.
    for (let tries = 0; stack.length && tries < 64;) {
      const choices = stack.pop(), signature = [...choices].filter(([key, v]) => v.side !== accepted.get(key)?.side)
        .map(([key, v]) => `${key}=${v.side}`).sort().join(';');
      if (seen.has(signature)) continue;
      seen.add(signature); tries++;
      install(choices);
      const trial = baseline.slice();
      if (spread(trial, all, false, true)) return { choices, trial };
      const alternatives = conflict.filter(key => key !== pending.key && choices.has(key)).sort();
      for (const key of alternatives.reverse()) {
        const choice = choices.get(key), next = new Map(choices);
        next.set(key, { ...choice, side: 1 - choice.side }); stack.push(next);
      }
    }
    install(accepted);
    return null;
  };
  for (const crossing of ordered) {
    let done = false;
    for (const side of [crossing.side, 1-crossing.side]) {
      const { additions, starts } = add(crossing, side);
      const trial = heights.slice();
      if (spread(trial, starts, false, true)) {
        heights = trial; accepted.set(crossing.key, { crossing, side }); done = true; break;
      }
      for (const [id, edge] of additions) nodes[id].crossings.splice(nodes[id].crossings.indexOf(edge), 1);
    }
    if (!done && crossing.transverse) {
      const result = repair(crossing);
      if (result) { heights = result.trial; accepted = result.choices; }
    }
  }
  return heights;
}
