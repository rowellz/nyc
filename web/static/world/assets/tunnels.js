import { deckEdges } from './edges.js';

/** Shared by the geometry worker and traffic. Heights are synthetic: OSM layers
 * describe stacking, not surveyed elevations. Keep grades continuous across ways. */
export const TUNNEL_DEPTH = 14;
export const TUNNEL_CLEARANCE = 5.6;
export const PORTAL_DEPTH = 8;
export const APPROACH_GRADE = 0.06;
const GRADE = 0.06;
// Match ramps.js's maximum planned bridge height. Continue through short,
// untagged connecting ways until the ceiling is above every possible deck;
// stopping at ground level leaves the next elevated way with a vertical step.
export const APPROACH_REACH = (PORTAL_DEPTH + 36) / APPROACH_GRADE + 8;
const networkCache = new WeakMap();
const vehicular = r => !['footway', 'pedestrian', 'steps', 'cycleway'].includes(r.cls);
const motorway = r => r.cls === 'motorway' || r.cls === 'trunk';
const key = p => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
const length = r => r.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1]), 0);

/** Tunnel mouths are already below grade. Surface approaches inherit a distance
 * field through shared endpoints, so short OSM ways cannot reset the descent. */
export function tunnelNetwork(roads) {
  if (networkCache.has(roads)) return networkCache.get(roads);
  const unique = [...new Map(roads.filter(r => vehicular(r) && r.pts.length > 1).map(r => [r.id, r])).values()];
  const nodes = new Map(), profiles = new Map();
  const node = p => {
    const k = key(p);
    if (!nodes.has(k)) nodes.set(k, { distance: Infinity, approach: Infinity, edges: [], surface: [] });
    return nodes.get(k);
  };
  for (const road of unique) {
    const a = node(road.pts[0]), b = node(road.pts.at(-1)), size = length(road);
    const links = road.tunnel ? 'edges' : motorway(road) ? 'surface' : null;
    if (links) { a[links].push([b, size]); b[links].push([a, size]); }
    if (road.tunnel || motorway(road)) {
      profiles.set(road.id, { road, a, b, length: size, approach: !road.tunnel });
    }
  }
  const portals = [...nodes.values()].filter(n => n.edges.length && n.surface.length);
  const spread = (field, links, reach) => {
    const queue = [...portals];
    for (const n of queue) n[field] = 0;
    while (queue.length) {
      queue.sort((a, b) => b[field] - a[field]);
      const n = queue.pop();
      for (const [other, size] of n[links]) {
        const d = n[field] + size;
        if (d < other[field] && d < reach) { other[field] = d; queue.push(other); }
      }
    }
  };
  spread('distance', 'edges', (TUNNEL_DEPTH - PORTAL_DEPTH) / GRADE);
  spread('approach', 'surface', APPROACH_REACH);
  for (const [id, p] of profiles) if (p.approach && Math.min(p.a.approach, p.b.approach) >= APPROACH_REACH) profiles.delete(id);
  // Approaches share their lane envelope with the motorway renderer and traffic.
  // Raw constant-width ribbons overlap at fans and put walls through live lanes.
  for (const p of profiles.values()) if (p.approach) p.edges = deckEdges(p.road, roads, Math.max(3.2, p.road.width / 2));
  networkCache.set(roads, profiles);
  return profiles;
}

export function approachCeiling(profile, along) {
  const distance = Math.max(0, Math.min(profile.a.approach + along, profile.b.approach + profile.length - along));
  return -PORTAL_DEPTH + distance * APPROACH_GRADE;
}

export function tunnelHeight(profile, along) {
  if (profile.approach) return Math.min(0, approachCeiling(profile, along));
  return -Math.min(TUNNEL_DEPTH, PORTAL_DEPTH + Math.max(0, Math.min(profile.a.distance + along,
    profile.b.distance + profile.length - along)) * GRADE);
}

/** Cap the existing bridge plan too, allowing elevated motorway connections to
 * descend continuously through zero before reaching the buried portal. */
export function approachProfile(env, road, base) {
  const p = tunnelNetwork(env.tile.roads).get(road.id);
  if (!p?.approach) return base;
  const hAt = s => Math.min(base.hAt(s), approachCeiling(p, s));
  let H = -Infinity;
  for (let s = 0; s < p.length; s += 4) H = Math.max(H, hAt(s));
  H = Math.max(H, hAt(p.length));
  return { ...base, H, hAt };
}

function project(road, x, z) {
  let best = null, acc = 0;
  for (let i = 1; i < road.pts.length; i++) {
    const a = road.pts[i - 1], b = road.pts[i], dx = b[0] - a[0], dz = b[1] - a[1], size = Math.hypot(dx, dz);
    if (size < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / size ** 2));
    const px = a[0] + dx*t, pz = a[1] + dz*t, distance = Math.hypot(x-px, z-pz);
    if (!best || distance < best.distance) best = { distance, along: acc + t * size, x: px, z: pz };
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
  const p = worldTunnels(world).get(road.id), q = p && project(road, x, z);
  if (!p || !q) return road.tunnel ? -TUNNEL_DEPTH + 0.025 : fallback;
  return p.approach ? Math.min(fallback, approachCeiling(p, q.along) + 0.025) : tunnelHeight(p, q.along) + 0.025;
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
  if (profile.samples) return profile.samples;
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
    const q = result[i], hw = Math.max(2, road.width / 2);
    [q.left, q.right] = profile.edges ? profile.edges(q.s) :
      [[q.x - q.rx * hw, q.z - q.rz * hw], [q.x + q.rx * hw, q.z + q.rz * hw]];
  }
  profile.samples = result;
  return result;
}

function edgePoint(a, side, margin = 0) {
  const edge = side ? a.right : a.left, sign = side ? 1 : -1;
  return [edge[0] + sign * a.rx * margin, edge[1] + sign * a.rz * margin];
}

export function tunnelHoles(profiles, surfaceY = 0) {
  const holes = [];
  for (const p of profiles.values()) {
    const pts = samples(p);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      // Only remove the surface where the approach ceiling intersects it.
      if (!p.approach || Math.min(a.y, b.y) >= 0.024
        || Math.max(a.y, b.y) + TUNNEL_CLEARANCE < surfaceY - 0.3) continue;
      const ring = [
        edgePoint(a, 0, 0.15), edgePoint(b, 0, 0.15),
        edgePoint(b, 1, 0.15), edgePoint(a, 1, 0.15),
      ];
      holes.push(ring);
    }
  }
  return holes;
}

/** Water lies under the whole map, including dry land. Remove it along bores
 * and descending approaches independently of whether the ground needs a hole.
 * Use complete straight segments to keep the global plane inexpensive to cut.
 * Two metres of overlap cover shoulders, bends and seams between OSM ways. */
export function tunnelWaterHoles(profiles) {
  const holes = [], margin = 2;
  for (const p of profiles.values()) {
    let along = 0;
    const hw = Math.max(2, p.road.width / 2, ...samples(p).flatMap(a =>
      [a.left, a.right].map(e => Math.hypot(e[0] - a.x, e[1] - a.z)))) + margin;
    for (let i = 1; i < p.road.pts.length; i++) {
      const a = p.road.pts[i - 1], b = p.road.pts[i];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-6) continue;
      const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
      let ranges = [[0, length]];
      if (p.approach) {
        const reach = PORTAL_DEPTH / APPROACH_GRADE;
        ranges = [[0, Math.min(length, reach - p.a.approach - along)],
          [Math.max(0, p.length - along + p.b.approach - reach), length]]
          .filter(([start, end]) => end > start);
        if (ranges.length === 2 && ranges[1][0] <= ranges[0][1]) ranges = [[0, length]];
      }
      for (const [start, end] of ranges) {
        const ax = a[0] + dx * (start - margin), az = a[1] + dz * (start - margin);
        const bx = a[0] + dx * (end + margin), bz = a[1] + dz * (end + margin);
        holes.push([[ax + dz * hw, az - dx * hw], [bx + dz * hw, bz - dx * hw],
          [bx - dz * hw, bz + dx * hw], [ax - dz * hw, az + dx * hw]]);
      }
      along += length;
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
        // Earlier cuts create pieces far from this hole. Do not subdivide
        // those pieces along the infinite extensions of its clipping edges.
        if (poly.every(v => v[posSlot][0] < h.minX) || poly.every(v => v[posSlot][0] > h.maxX)
          || poly.every(v => v[posSlot][2] < h.minZ) || poly.every(v => v[posSlot][2] > h.maxZ)) return [poly];
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
  const fields = { pos: 3, nrm: 3, aA: 4, aB: 4, local: 2, region: 4, m: 4, t: 4 };
  const names = Object.keys(fields).filter(name => Array.isArray(builder[name]));
  const attrs = Object.fromEntries(names.map(name => [name === 'pos' ? 'position' : name, { array: builder[name], itemSize: fields[name] }]));
  const cut = cutGround(attrs, builder.idx, tunnelHoles(profiles));
  if (!cut) return;
  for (const name of names) builder[name] = Array.from(cut.attributes[name === 'pos' ? 'position' : name].array);
  builder.idx = Array.from(cut.index);
}

/** Later bridge joins can repave an opening; cut once more before adding the
 * underground floor. Curbs are line segments, clipped with the same footprints. */
export function finishTunnelApproaches(roadbed, structure, out, walks, profiles) {
  cutBuilder(roadbed, profiles);
  const holes = tunnelHoles(profiles);
  const cut = cutGround({ position: { array: out.cpos, itemSize: 3 } }, out.cidx, holes);
  if (cut) { out.cpos = Array.from(cut.attributes.position.array); out.cidx = Array.from(cut.index); }
  for (const ring of holes) {
    walks.curbs = walks.curbs.flatMap(c => {
      let lo = 0, hi = 1;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const side = (x, z) => (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
        const start = side(c.ax, c.az), delta = side(c.bx, c.bz) - start;
        if (Math.abs(delta) < 1e-9) { if (start < 0) return [c]; }
        else if (delta > 0) lo = Math.max(lo, -start / delta);
        else hi = Math.min(hi, -start / delta);
      }
      if (lo >= hi) return [c];
      const part = (a, b) => ({ ...c, ax: c.ax + (c.bx-c.ax)*a, az: c.az + (c.bz-c.az)*a,
        bx: c.ax + (c.bx-c.ax)*b, bz: c.az + (c.bz-c.az)*b });
      return [...(lo > 0 ? [part(0, lo)] : []), ...(hi < 1 ? [part(hi, 1)] : [])];
    });
  }
}

export function tunnelSupport(world, x, z, referenceY, fallback) {
  if (!Number.isFinite(referenceY)) return fallback;
  let best = fallback;
  for (const p of worldTunnels(world).values()) {
    const q = project(p.road, x, z);
    if (!q) continue;
    if (p.edges) {
      const [left, right] = p.edges(q.along), dx = right[0]-left[0], dz = right[1]-left[1];
      const width = Math.hypot(dx,dz), across = ((x-left[0])*dx+(z-left[1])*dz)/(width || 1);
      const reach = Math.max(Math.hypot(left[0]-q.x,left[1]-q.z), Math.hypot(right[0]-q.x,right[1]-q.z));
      if (q.distance > reach || across < 0.2 || across > width-0.2) continue;
    } else if (q.distance > Math.max(2, p.road.width / 2) - 0.2) continue;
    // Continue support through zero onto the rising bridge. The zero-capped
    // tunnel construction profile would otherwise drop a low ramp to ground.
    const h = p.approach ? Math.min(fallback, approachCeiling(p, q.along) + 0.025)
      : tunnelHeight(p, q.along) + 0.025;
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
    recut(water, tunnelWaterHoles(profiles)); waterProfiles.set(water, profiles);
  }
}

const passageCache = new WeakMap();
/** Index the actual paving swept up to vehicle clearance. A side wall may
 * bound one way while passing through its neighbour; subtract that neighbour's
 * passage from both the mesh and collider. Height planes preserve stacked roads. */
function passages(profiles) {
  if (passageCache.has(profiles)) return passageCache.get(profiles);
  const cells = new Map(), cellSize = 32, margin = 0.15;
  for (const profile of profiles.values()) {
    const pts = samples(profile);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const corners = [[...a.left, a.y], [...b.left, b.y], [...b.right, b.y], [...a.right, a.y]];
      for (const t of [[corners[0], corners[1], corners[2]], [corners[0], corners[2], corners[3]]]) {
        // Coordinates here are x,z,y. Solve the floor plane y = hx*x + hz*z + c.
        const [u, v, w] = t, dx = v[0]-u[0], dz = v[1]-u[1], ex = w[0]-u[0], ez = w[1]-u[1];
        const det = dx*ez-dz*ex;
        if (Math.abs(det) < 1e-8) continue;
        const hx = ((v[2]-u[2])*ez-(w[2]-u[2])*dz)/det;
        const hz = (dx*(w[2]-u[2])-ex*(v[2]-u[2]))/det, c = u[2]-hx*u[0]-hz*u[1];
        const planes = t.map((p, j) => {
          const q = t[(j+1)%3], dx = q[0]-p[0], dz = q[1]-p[1], sign = Math.sign(det);
          return [-dz*sign, 0, dx*sign, (dz*p[0]-dx*p[1])*sign + margin*Math.hypot(dx,dz)];
        });
        planes.push([-hx, 1, -hz, -c+margin], [hx, -1, hz, c+TUNNEL_CLEARANCE]);
        const passage = { profile, planes };
        for (let x = Math.floor((Math.min(...t.map(p=>p[0]))-margin)/cellSize); x <= Math.floor((Math.max(...t.map(p=>p[0]))+margin)/cellSize); x++)
          for (let z = Math.floor((Math.min(...t.map(p=>p[1]))-margin)/cellSize); z <= Math.floor((Math.max(...t.map(p=>p[1]))+margin)/cellSize); z++) {
            const k = `${x},${z}`, bucket = cells.get(k) ?? [];
            bucket.push(passage); cells.set(k, bucket);
          }
      }
    }
  }
  const near = points => {
    const found = new Set();
    for (let x = Math.floor(Math.min(...points.map(p=>p[0]))/cellSize); x <= Math.floor(Math.max(...points.map(p=>p[0]))/cellSize); x++)
      for (let z = Math.floor(Math.min(...points.map(p=>p[2]))/cellSize); z <= Math.floor(Math.max(...points.map(p=>p[2]))/cellSize); z++)
        for (const passage of cells.get(`${x},${z}`) ?? []) found.add(passage);
    return found;
  };
  passageCache.set(profiles, near);
  return near;
}

function clearPassages(points, profile, nearby) {
  let pieces = [points];
  const distance = (p, plane) => p[0]*plane[0]+p[1]*plane[1]+p[2]*plane[2]+plane[3];
  const clip = (poly, plane, sign) => {
    const result = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i+1)%poly.length], da = sign*distance(a,plane), db = sign*distance(b,plane);
      if (da >= -1e-8) result.push(a);
      if (da > 1e-8 && db < -1e-8 || da < -1e-8 && db > 1e-8) result.push(a.map((v,k)=>v+(b[k]-v)*da/(da-db)));
    }
    return result;
  };
  for (const passage of nearby(points)) {
    if (passage.profile === profile) continue;
    pieces = pieces.flatMap(poly => {
      if (passage.planes.some(plane => poly.every(p => distance(p,plane) <= 1e-8))) return [poly];
      const outside = [];
      let inside = poly;
      for (const plane of passage.planes) {
        if (inside.length < 3) break;
        const part = clip(inside, plane, -1);
        if (part.length >= 3) outside.push(part);
        inside = clip(inside, plane, 1);
      }
      return outside;
    });
    if (!pieces.length) break;
  }
  return pieces;
}

/** Open-ended, collidable floor/walls/roof. No portal blocker or cross-way caps. */
export function buildTunnels(env, structure, out) {
  const profiles = tunnelNetwork(env.tile.roads), rect = env.rect;
  const nearby = passages(profiles);
  const concrete = [0.42, 0.43, 0.42], asphalt = [0.12, 0.13, 0.14], paint = [0.85, 0.8, 0.57];
  function face(points, color, collide = true) {
    structure.face(points, color, 0, false);
    if (!collide) return;
    const base = out.cpos.length / 3;
    for (const p of points) out.cpos.push(...p);
    out.cidx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const shell = (points, profile, collide = true) => {
    for (const poly of clearPassages(points, profile, nearby)) {
      if (poly.length === 4) face(poly, concrete, collide);
      else for (let j = 1; j + 1 < poly.length; j++) face([poly[0], poly[j], poly[j+1], poly[j+1]], concrete, collide);
    }
  };
  for (const p of profiles.values()) {
    const pts = samples(p), hw = Math.max(2, p.road.width / 2);
    const v = (a, off, h = 0) => {
      const t = (off / hw + 1) / 2;
      return [a.left[0] + (a.right[0] - a.left[0]) * t, a.y + h,
        a.left[1] + (a.right[1] - a.left[1]) * t];
    };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const corners = [a.left, a.right, b.left, b.right];
      if (corners.every(q => q[0] < rect.minX) || corners.every(q => q[0] > rect.maxX)
        || corners.every(q => q[1] < rect.minZ) || corners.every(q => q[1] > rect.maxZ)) continue;
      if (p.approach && Math.min(a.y, b.y) >= 0.024) continue;
      // Clip ownership by the centre of each global sample span. Whole spans
      // meet at identical vertices; tile boundaries never add internal walls.
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (Math.floor(mx / 256) !== env.tile.tx || Math.floor(mz / 256) !== env.tile.tz) continue;
      face([v(a, -hw), v(a, hw), v(b, hw), v(b, -hw)], asphalt);
      const buried = !p.approach || Math.max(a.y, b.y) + TUNNEL_CLEARANCE < -0.3;
      const topA = buried ? TUNNEL_CLEARANCE : Math.max(0, 0.15 - a.y);
      const topB = buried ? TUNNEL_CLEARANCE : Math.max(0, 0.15 - b.y);
      if (!p.edges?.layout?.open((a.s + b.s) / 2, 0)) shell([v(a, -hw), v(b, -hw), v(b, -hw, topB), v(a, -hw, topA)], p);
      if (!p.edges?.layout?.open((a.s + b.s) / 2, 1)) shell([v(b, hw), v(a, hw), v(a, hw, topA), v(b, hw, topB)], p);
      if (buried) shell([v(a, -hw, TUNNEL_CLEARANCE), v(b, -hw, TUNNEL_CLEARANCE), v(b, hw, TUNNEL_CLEARANCE), v(a, hw, TUNNEL_CLEARANCE)], p);
      if (buried) shell([v(a, hw, TUNNEL_CLEARANCE + 0.4), v(b, hw, TUNNEL_CLEARANCE + 0.4), v(b, -hw, TUNNEL_CLEARANCE + 0.4), v(a, -hw, TUNNEL_CLEARANCE + 0.4)], p);
      for (const [end, portal] of [[a, i === 1 && p.a.distance === 0], [b, i === pts.length - 1 && p.b.distance === 0]]) if (portal && !p.approach) {
        const cap = [v(end, -hw, TUNNEL_CLEARANCE), v(end, hw, TUNNEL_CLEARANCE), v(end, hw, TUNNEL_CLEARANCE + 0.4), v(end, -hw, TUNNEL_CLEARANCE + 0.4)];
        shell(cap, p); shell([...cap].reverse(), p, false);
      }
      // Continuous shoulder lines and dashed lane dividers follow the grade.
      for (const side of [0, 1]) if (!p.edges?.layout?.open((a.s + b.s) / 2, side)) {
        const offset = (side ? 1 : -1) * (hw - 0.35);
        face([v(a, offset - 0.06, 0.015), v(a, offset + 0.06, 0.015), v(b, offset + 0.06, 0.015), v(b, offset - 0.06, 0.015)], paint, false);
      }
      const laneV = (q, off) => {
        const point = p.edges?.line(q.s, off) ?? [q.x + q.rx * off, q.z + q.rz * off];
        return [point[0], q.y + 0.015, point[1]];
      };
      const count = Math.max(1, p.road.lanes || 1), width = Math.min(3.3, p.road.width / count);
      if (Math.floor(a.s / 4) % 3 === 0) for (let lane = 1; lane < count; lane++) {
        const offset = (lane - count / 2) * width;
        face([laneV(a, offset - 0.06), laneV(a, offset + 0.06), laneV(b, offset + 0.06), laneV(b, offset - 0.06)], paint, false);
      }
      // Bright fixture panels provide visible guidance without per-light costs.
      if (!p.approach && Math.floor(a.s / 4) % 5 === 0) face([v(a, -0.4, TUNNEL_CLEARANCE - 0.02), v(b, -0.4, TUNNEL_CLEARANCE - 0.02), v(b, 0.4, TUNNEL_CLEARANCE - 0.02), v(a, 0.4, TUNNEL_CLEARANCE - 0.02)], [1, 0.93, 0.72], false);
    }
  }
}
