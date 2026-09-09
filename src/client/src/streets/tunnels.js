/** Shared by the geometry worker and traffic. Heights are synthetic: OSM layers
 * describe stacking, not surveyed elevations. Keep grades continuous across ways. */
export const TUNNEL_DEPTH = 8;
export const TUNNEL_CLEARANCE = 5.6;
const GRADE = 0.1;
const vehicular = r => !['footway', 'pedestrian', 'steps', 'cycleway'].includes(r.cls);
const key = p => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
const length = r => r.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1]), 0);

export function tunnelNetwork(roads) {
  const tunnels = [...new Map(roads.filter(r => r.tunnel && vehicular(r) && r.pts.length > 1).map(r => [r.id, r])).values()];
  const nodes = new Map(), profiles = new Map();
  const node = p => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { distance: Infinity, edges: [] });
    return nodes.get(k);
  };
  for (const road of tunnels) {
    const a = node(road.pts[0]), b = node(road.pts.at(-1)), size = length(road);
    a.edges.push([b, size]); b.edges.push([a, size]);
    profiles.set(road.id, { road, a, b, length: size });
  }
  const queue = [];
  for (const r of roads) if (!r.tunnel && vehicular(r) && r.pts.length > 1) {
    for (const p of [r.pts[0], r.pts.at(-1)]) {
      const n = nodes.get(key(p));
      if (n && n.distance !== 0) { n.distance = 0; queue.push(n); }
    }
  }
  // Bounded shortest paths: beyond 80 m from a portal every floor is at depth.
  while (queue.length) {
    queue.sort((a, b) => b.distance - a.distance);
    const n = queue.pop();
    for (const [other, size] of n.edges) {
      const d = n.distance + size;
      if (d < other.distance && d < TUNNEL_DEPTH / GRADE) { other.distance = d; queue.push(other); }
    }
  }
  return profiles;
}

export function tunnelHeight(profile, along) {
  return -Math.min(TUNNEL_DEPTH, Math.max(0, Math.min(profile.a.distance + along,
    profile.b.distance + profile.length - along)) * GRADE);
}

function project(road, x, z) {
  let best = null, acc = 0;
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1], b = road.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], size = Math.hypot(dx, dz);
    if (size < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / size ** 2));
    const distance = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    if (!best || distance < best.distance) best = { distance, along: acc + t * size };
    acc += size;
  }
  return best;
}

const worldCache = new WeakMap();
export function worldTunnels(world) {
  // Tile identities change on replacement as well as loading/unloading.
  const tiles = [...world.tiles.values()];
  let cached = worldCache.get(world);
  if (!cached || tiles.length !== cached.tiles.length || tiles.some((t, i) => t !== cached.tiles[i])) {
    cached = { tiles, profiles: tunnelNetwork(tiles.flatMap(t => t.roads)) };
    worldCache.set(world, cached);
  }
  return cached.profiles;
}

export function trafficHeight(world, road, x, z, fallback = 0) {
  if (!road.tunnel) return fallback;
  const p = worldTunnels(world).get(road.id), q = project(road, x, z);
  return p && q ? tunnelHeight(p, q.along) + 0.025 : -TUNNEL_DEPTH + 0.025;
}

/** Layer changes at actual tunnel mouths or bridge joins must not disconnect the lane graph.
 * Interior points and roads merely crossing in plan retain their original layer. */
export function tunnelConnections(roads, lane) {
  // Recover the centreline node; the lane itself is offset from it.
  const nodeKey = lane.end.split(',').slice(0, 2).join(',');
  const atEnd = r => [r.pts[0], r.pts.at(-1)].some(p => key(p) === nodeKey);
  const choices = [...(roads.outgoing.get(lane.end) ?? [])].filter(other =>
    (!!lane.road.tunnel === !!other.road.tunnel && !!lane.road.bridge === !!other.road.bridge) || atEnd(lane.road) && atEnd(other.road));
  if (!atEnd(lane.road)) return choices;
  for (const other of roads.lanes.values()) {
    if (!(lane.road.tunnel || other.road.tunnel || lane.road.bridge || other.road.bridge) || choices.includes(other)) continue;
    if (other.start.split(',').slice(0, 2).join(',') !== nodeKey) continue;
    if (!atEnd(other.road)) continue;
    choices.push(other);
  }
  return choices;
}

/** Dense samples use whole-way arc length so adjoining tiles agree exactly. */
function samples(profile) {
  const result = [], road = profile.road;
  let acc = 0;
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1], b = road.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], size = Math.hypot(dx, dz);
    if (size < 1e-6) continue;
    const count = Math.ceil(size / 4);
    for (let j = 0; j < count; j++) result.push({ x: a[0] + dx * j / count, z: a[1] + dz * j / count, s: acc + size * j / count });
    acc += size;
  }
  const p = road.pts.at(-1);
  result.push({ x: p[0], z: p[1], s: acc });
  for (let i = 0; i < result.length; i++) {
    const a = result[Math.max(0, i - 1)], b = result[Math.min(result.length - 1, i + 1)], size = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    result[i].rx = -(b.z - a.z) / size; result[i].rz = (b.x - a.x) / size;
    result[i].y = tunnelHeight(profile, result[i].s) + 0.025;
  }
  return result;
}

export function tunnelHoles(profiles, surfaceY = 0) {
  const holes = [];
  for (const p of profiles.values()) {
    const pts = samples(p), hw = Math.max(2, p.road.width / 2) + 0.15;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      // Only remove the surface where the approach ceiling intersects it.
      if (Math.max(a.y, b.y) + TUNNEL_CLEARANCE < surfaceY - 0.3) continue;
      const ring = [
        [a.x - a.rx * hw, a.z - a.rz * hw], [b.x - b.rx * hw, b.z - b.rz * hw],
        [b.x + b.rx * hw, b.z + b.rz * hw], [a.x + a.rx * hw, a.z + a.rz * hw],
      ];
      holes.push(ring);
    }
  }
  return holes;
}

/** Subtract convex approach footprints from triangles, interpolating every
 * attribute. Used for both rendered paving and the actual ground collider. */
export function cutGround(attributes, indices, holes) {
  if (!holes.length) return null;
  const entries = Object.entries(attributes), posSlot = entries.findIndex(([name]) => name === 'position');
  const bounds = holes.map(r => ({ r, minX: Math.min(...r.map(p => p[0])), maxX: Math.max(...r.map(p => p[0])), minZ: Math.min(...r.map(p => p[1])), maxZ: Math.max(...r.map(p => p[1])) }));
  const output = entries.map(() => []), index = [];
  const point = vi => entries.map(([, a]) => Array.from(a.array.slice(vi * a.itemSize, (vi + 1) * a.itemSize)));
  const side = (v, a, b) => (b[0] - a[0]) * (v[posSlot][2] - a[1]) - (b[1] - a[1]) * (v[posSlot][0] - a[0]);
  const clip = (poly, a, b, sign) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const u = poly[i], v = poly[(i + 1) % poly.length], du = side(u, a, b) * sign, dv = side(v, a, b) * sign;
      if (du >= -1e-8) out.push(u);
      if ((du > 1e-8 && dv < -1e-8) || (du < -1e-8 && dv > 1e-8)) {
        const t = du / (du - dv);
        out.push(u.map((attr, j) => attr.map((value, k) => value + (v[j][k] - value) * t)));
      }
    }
    return out;
  };
  for (let i = 0; i < indices.length; i += 3) {
    let pieces = [[point(indices[i]), point(indices[i + 1]), point(indices[i + 2])]];
    const xyz = pieces[0].map(v => v[posSlot]);
    const minX = Math.min(...xyz.map(p => p[0])), maxX = Math.max(...xyz.map(p => p[0])), minZ = Math.min(...xyz.map(p => p[2])), maxZ = Math.max(...xyz.map(p => p[2]));
    for (const h of bounds) {
      if (h.maxX < minX || h.minX > maxX || h.maxZ < minZ || h.minZ > maxZ || xyz.some(p => p[1] > 0.3 || p[1] < -0.5)) continue;
      pieces = pieces.flatMap(poly => {
        const outside = [];
        let inside = poly;
        for (let j = 0; j < h.r.length && inside.length >= 3; j++) {
          const a = h.r[j], b = h.r[(j + 1) % h.r.length];
          const part = clip(inside, a, b, -1);
          if (part.length >= 3) outside.push(part);
          inside = clip(inside, a, b, 1);
        }
        return outside;
      });
    }
    for (const poly of pieces) {
      const base = output[posSlot].length / 3;
      for (const v of poly) v.forEach((attr, j) => output[j].push(...attr));
      for (let j = 1; j + 1 < poly.length; j++) index.push(base, base + j, base + j + 1);
    }
  }
  return { attributes: Object.fromEntries(entries.map(([name, a], i) => [name, { array: new Float32Array(output[i]), itemSize: a.itemSize }])), index: new Uint32Array(index) };
}

export function cutGeometry(geometry, profiles) {
  const cut = cutGround(geometry.attributes, geometry.index.array, tunnelHoles(profiles));
  if (!cut) return geometry;
  const Attribute = geometry.getAttribute('position').constructor;
  for (const [name, a] of Object.entries(cut.attributes)) geometry.setAttribute(name, new Attribute(a.array, a.itemSize));
  geometry.setIndex(Array.from(cut.index));
  geometry.computeBoundingSphere();
  return geometry;
}

export function cutBuilder(builder, profiles) {
  const attrs = { position: { array: builder.pos, itemSize: 3 }, normal: { array: builder.nrm, itemSize: 3 } };
  for (const name of ['aA', 'aB']) attrs[name] = { array: builder[name], itemSize: 4 };
  const cut = cutGround(attrs, builder.idx, tunnelHoles(profiles));
  if (!cut) return;
  builder.pos = Array.from(cut.attributes.position.array); builder.nrm = Array.from(cut.attributes.normal.array);
  builder.aA = Array.from(cut.attributes.aA.array); builder.aB = Array.from(cut.attributes.aB.array); builder.idx = Array.from(cut.index);
}

export function tunnelSupport(world, x, z, referenceY, fallback) {
  if (!Number.isFinite(referenceY)) return fallback;
  let best = fallback;
  for (const p of worldTunnels(world).values()) {
    const q = project(p.road, x, z);
    if (!q || q.distance > Math.max(2, p.road.width / 2) - 0.2) continue;
    const h = tunnelHeight(p, q.along) + 0.025;
    if (referenceY < h + TUNNEL_CLEARANCE - 1 && referenceY >= h - 2) best = h;
  }
  return best;
}

const terrainBases = new WeakMap();
function recut(mesh, holes) {
  let base = terrainBases.get(mesh);
  if (!base && !holes.length) return;
  if (!base) { base = mesh.geometry.clone(); terrainBases.set(mesh, base); }
  const next = base.clone();
  const cut = cutGround(next.attributes, next.index.array, holes);
  if (cut) {
    const Attribute = next.getAttribute('position').constructor;
    for (const [name, a] of Object.entries(cut.attributes)) next.setAttribute(name, new Attribute(a.array, a.itemSize));
    next.setIndex(Array.from(cut.index)); next.computeBoundingSphere();
  }
  mesh.geometry.dispose(); mesh.geometry = next;
}

const waterProfiles = new WeakMap();
const cutLandTiles = new WeakMap();
/** Rebuild from original surfaces, so streamed neighbours can reveal or remove
 * portals without accumulating holes. The collider gets the very same cuts. */
export function syncTunnelTerrain(ctx, tile) {
  const profiles = worldTunnels(ctx.world), holes = tunnelHoles(profiles);
  const local = holes.filter(r => Math.max(...r.map(p => p[0])) >= tile.tx * 256 && Math.min(...r.map(p => p[0])) <= (tile.tx + 1) * 256
    && Math.max(...r.map(p => p[1])) >= tile.tz * 256 && Math.min(...r.map(p => p[1])) <= (tile.tz + 1) * 256);
  const ground = ctx.scene.getObjectByName(`env-ground-${tile.key}`);
  if (ground) recut(ground, local);
  // Keep tile water classification intact; only the collider geometry is cut.
  let cutTiles = cutLandTiles.get(ctx.physics);
  if (!cutTiles) { cutTiles = new Set(); cutLandTiles.set(ctx.physics, cutTiles); }
  if (ctx.physics.ready !== false && (local.length || cutTiles.has(tile.key))) {
    ctx.physics.loadLand(tile, local);
    if (local.length) cutTiles.add(tile.key); else cutTiles.delete(tile.key);
  }
  const water = ctx.scene.getObjectByName('env-water');
  if (water && waterProfiles.get(water) !== profiles) {
    recut(water, tunnelHoles(profiles, -1.6)); waterProfiles.set(water, profiles);
  }
}

/** Open-ended, collidable floor/walls/roof. No portal blocker or cross-way caps. */
export function buildTunnels(env, structure, out) {
  const profiles = tunnelNetwork(env.tile.roads), rect = env.rect;
  const concrete = [0.42, 0.43, 0.42], asphalt = [0.12, 0.13, 0.14], paint = [0.85, 0.8, 0.57];
  function face(points, color, collide = true) {
    structure.face(points, color, 0, false);
    if (!collide) return;
    const base = out.cpos.length / 3;
    for (const p of points) out.cpos.push(...p);
    out.cidx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  for (const p of profiles.values()) {
    const pts = samples(p), hw = Math.max(2, p.road.width / 2);
    const v = (a, off, h = 0) => [a.x + a.rx * off, a.y + h, a.z + a.rz * off];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (Math.max(a.x, b.x) + hw < rect.minX || Math.min(a.x, b.x) - hw > rect.maxX || Math.max(a.z, b.z) + hw < rect.minZ || Math.min(a.z, b.z) - hw > rect.maxZ) continue;
      // Clip ownership by the centre of each global sample span. Whole spans
      // meet at identical vertices; tile boundaries never add internal walls.
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (Math.floor(mx / 256) !== env.tile.tx || Math.floor(mz / 256) !== env.tile.tz) continue;
      face([v(a, -hw), v(a, hw), v(b, hw), v(b, -hw)], asphalt);
      face([v(a, -hw), v(b, -hw), v(b, -hw, TUNNEL_CLEARANCE), v(a, -hw, TUNNEL_CLEARANCE)], concrete);
      face([v(b, hw), v(a, hw), v(a, hw, TUNNEL_CLEARANCE), v(b, hw, TUNNEL_CLEARANCE)], concrete);
      face([v(a, -hw, TUNNEL_CLEARANCE), v(b, -hw, TUNNEL_CLEARANCE), v(b, hw, TUNNEL_CLEARANCE), v(a, hw, TUNNEL_CLEARANCE)], concrete);
      face([v(a, hw, TUNNEL_CLEARANCE + 0.4), v(b, hw, TUNNEL_CLEARANCE + 0.4), v(b, -hw, TUNNEL_CLEARANCE + 0.4), v(a, -hw, TUNNEL_CLEARANCE + 0.4)], concrete);
      for (const [end, portal] of [[a, i === 1 && p.a.distance === 0], [b, i === pts.length - 1 && p.b.distance === 0]]) if (portal) {
        const cap = [v(end, -hw, TUNNEL_CLEARANCE), v(end, hw, TUNNEL_CLEARANCE), v(end, hw, TUNNEL_CLEARANCE + 0.4), v(end, -hw, TUNNEL_CLEARANCE + 0.4)];
        face(cap, concrete); face([...cap].reverse(), concrete, false);
      }
      // Continuous shoulder lines and dashed lane dividers follow the grade.
      const offsets = [-hw + 0.35, hw - 0.35];
      if (Math.floor(a.s / 4) % 3 === 0) for (let lane = 1; lane < Math.max(1, p.road.lanes); lane++) offsets.push(-hw + 2 * hw * lane / p.road.lanes);
      for (const offset of offsets) face([v(a, offset - 0.06, 0.015), v(a, offset + 0.06, 0.015), v(b, offset + 0.06, 0.015), v(b, offset - 0.06, 0.015)], paint, false);
      // Bright fixture panels provide visible guidance without per-light costs.
      if (Math.floor(a.s / 4) % 5 === 0) face([v(a, -0.4, TUNNEL_CLEARANCE - 0.02), v(b, -0.4, TUNNEL_CLEARANCE - 0.02), v(b, 0.4, TUNNEL_CLEARANCE - 0.02), v(a, 0.4, TUNNEL_CLEARANCE - 0.02)], [1, 0.93, 0.72], false);
    }
  }
}
