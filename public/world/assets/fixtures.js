import { deckEdges } from './edges.js';

const vehicular = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service']);
const highway = r => r.cls === 'motorway' || r.cls === 'trunk' || r.bridge;
const projection = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return [a[0] + dx * t, a[1] + dz * t, t];
};
function inside(x, z, ring) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}

/** Indexed pavement strips use the same tapered edges as the deck builder. */
export function roadFootprints(roads, profile = r => ({ hw: Math.max(3.2, r.width / 2), hAt: () => 0 })) {
  roads = [...new Map(roads.filter(r => !r.tunnel && r.pts.length > 1 && (vehicular.has(r.cls) || r.bridge)).map(r => [r.id, r])).values()];
  const cells = new Map(), strips = [];
  for (const road of roads) {
    const { hw, hAt } = profile(road), edges = deckEdges(road, roads, hw);
    let s = 0;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.max(1, Math.ceil(length / 4));
      for (let j = 0; j < count; j++) {
        const s0 = s + length * j / count, s1 = s + length * (j + 1) / count;
        const [l0, r0] = edges(s0), [l1, r1] = edges(s1);
        const ring = [l0, l1, r1, r0], h0 = hAt(s0), h1 = hAt(s1);
        const strip = { road, ring, h0, h1, a: [(l0[0] + r0[0]) / 2, (l0[1] + r0[1]) / 2], b: [(l1[0] + r1[0]) / 2, (l1[1] + r1[1]) / 2] };
        strips.push(strip);
        const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
        for (let x = Math.floor((Math.min(...xs) - 6) / 32); x <= Math.floor((Math.max(...xs) + 6) / 32); x++)
          for (let z = Math.floor((Math.min(...zs) - 6) / 32); z <= Math.floor((Math.max(...zs) + 6) / 32); z++) {
            const key = `${x},${z}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(strip);
          }
      }
      s += length;
    }
  }
  const near = (x, z) => cells.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) ?? [];
  return {
    strips,
    obstructs(x, z, margin = 0, accept = () => true) {
      return near(x, z).some(q => {
        if (!accept(q.road, q.h0 + (q.h1 - q.h0) * projection(x, z, q.a, q.b)[2])) return false;
        if (inside(x, z, q.ring)) return true;
        return margin > 0 && q.ring.some((a, i) => {
          const p = projection(x, z, a, q.ring[(i + 1) % 4]); return Math.hypot(p[0] - x, p[1] - z) < margin;
        });
      });
    },
  };
}

/** Authored lamps are ground furniture. Reserve room for the mast AND its arm,
 * independent of whether the asynchronous street colliders have arrived yet. */
export function lampPlanner(roads, obstacles = []) {
  const pavement = roadFootprints(roads);
  const blocked = (x, z) => pavement.obstructs(x, z, 4.8, highway) || pavement.obstructs(x, z, 0.7)
    || obstacles.some(rings => inside(x, z, rings[0]) && !rings.slice(1).some(ring => inside(x, z, ring)));
  return prop => {
    if (prop.kind !== 'street_lamp' || !pavement.obstructs(prop.x, prop.z, 4.8, highway)) return prop;
    const candidates = [];
    for (const q of pavement.strips) {
      if (!highway(q.road)) continue;
      for (const [a, b, opposite] of [[q.ring[0], q.ring[1], q.ring[3]], [q.ring[3], q.ring[2], q.ring[0]]]) {
        const p = projection(prop.x, prop.z, a, b), dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        let nx = -dz / len, nz = dx / len;
        if (nx * (opposite[0] - a[0]) + nz * (opposite[1] - a[1]) > 0) { nx = -nx; nz = -nz; }
        const x = p[0] + nx * 5, z = p[1] + nz * 5, distance = Math.hypot(x - prop.x, z - prop.z);
        if (distance <= 48) candidates.push({ ...prop, x, z, yaw: Math.atan2(nx, nz), distance });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
    return candidates.find(p => !blocked(p.x, p.z)) ?? null;
  };
}

const planners = new WeakMap();
export function streetLampPlacement(world, tile, prop) {
  if (prop.kind !== 'street_lamp') return prop;
  tile ??= world.tiles?.get(`${Math.floor(prop.x / 256)}_${Math.floor(prop.z / 256)}`);
  const key = tile ?? world, tiles = [...(world.tiles?.values() ?? [])];
  let entry = planners.get(key);
  if (!entry || entry.tiles.length !== tiles.length || tiles.some((t, i) => t !== entry.tiles[i])) {
    const cx = tile ? (tile.tx + 0.5) * 256 : prop.x, cz = tile ? (tile.tz + 0.5) * 256 : prop.z;
    const roads = [...(tile?.roads ?? []), ...(world.roadsNear?.(cx, cz, 280) ?? [])];
    const obstacles = tiles.flatMap(t => [...(t.buildings ?? []).map(b => b.footprint), ...(t.water ?? [])]);
    entry = { tiles, plan: lampPlanner(roads, obstacles) }; planners.set(key, entry);
  }
  return entry.plan(prop);
}

/** Neighbouring lamps may already exist when a crossing road tile arrives. */
export function fixtureTiles(world, tile) {
  const result = [tile];
  if (!tile.roads.some(r => !r.tunnel && highway(r))) return result;
  for (const other of world.tiles.values()) {
    if (other.key !== tile.key && Math.abs(other.tx - tile.tx) <= 1 && Math.abs(other.tz - tile.tz) <= 1
      && other.props.some(p => p.kind === 'street_lamp')) result.push(other);
  }
  return result;
}
