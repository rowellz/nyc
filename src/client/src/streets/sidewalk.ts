/**
 * Sidewalks, medians and plazas at y = 0.15 with granite curbs (0.12 m face + 3 cm bevel) on every edge that
 * borders a roadbed, pedestrian ramps (curb cuts with tactile pads) at crosswalk ends, yellow curb paint near
 * hydrants. Fallback ribbons when a tile has no planimetric sidewalks.
 */
import type { Pt, Ring } from '@shared/world';
import { GroundBuilder, type TileEnv } from './builders';
import { GRID_DIR, STREET, clipConvex, clipPolylineToRect, dir4, edgeOnRect, hash2, indexPolygons, pointInAny, ringBBox, signedArea, subtractConvex, triangulate, yawToDir, type IndexedPolygon, type NearestSample } from './geom2d';
import { KIND } from './materials';

export const WALK_Y = 0.15;
const CURB_TOP = 0.12;
/** visible granite width on top of the curb stone */
const CURB_W = 0.15;
const tmpNear = {} as NearestSample;
const RAMP_W = 1.6;
const RAMP_D = 1.3;
const PAD_D = 0.6;

export interface Ramp {
  /** curb-line centre */
  x: number;
  z: number;
  /** curb tangent (unit) and inward normal (unit, toward the sidewalk) */
  tx: number;
  tz: number;
  nx: number;
  nz: number;
}

export interface CurbEdge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** outward (toward the road) unit normal */
  nx: number;
  nz: number;
}

export interface SidewalkResult {
  ramps: Ramp[];
  curbs: CurbEdge[];
}

type EdgeFlag = 0 | 1 | 2 | 3 | 4; // 0 none, 1 curb, 2 ramp return (a on the curb line), 3 ramp inner edge, 4 ramp return (b on the curb line)

interface RingState {
  pts: Pt[];
  flags: EdgeFlag[];
  sign: number; // +1 when outward = (dz, -dx)
}

interface PolyState {
  rings: RingState[];
  kind: number;
  rand: number;
  /** paving that already owns this ground: triangles whose centroid falls inside are not emitted */
  under?: IndexedPolygon[];
}

function outward(r: RingState, i: number): [number, number, number] {
  const a = r.pts[i], b = r.pts[(i + 1) % r.pts.length];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  return [(dz / len) * r.sign, (-dx / len) * r.sign, len];
}

function prepare(env: TileEnv, poly: Ring[], kind: number, rand: number, fallback = false, under?: IndexedPolygon[]): PolyState | null {
  const rings: RingState[] = [];
  for (let ri = 0; ri < poly.length; ri++) {
    const ring = poly[ri];
    if (ring.length < 3) {
      if (ri === 0) return null;
      continue;
    }
    const area = signedArea(ring);
    if (Math.abs(area) < 0.05) {
      if (ri === 0) return null;
      continue;
    }
    const sign = (ri === 0 ? 1 : -1) * (area > 0 ? 1 : -1);
    const st: RingState = { pts: ring.map((p) => [p[0], p[1]] as Pt), flags: [], sign };
    const n = st.pts.length;
    for (let i = 0; i < n; i++) {
      const a = st.pts[i], b = st.pts[(i + 1) % n];
      let flag: EdgeFlag = 0;
      if (!edgeOnRect(a, b, env.rect)) {
        const [ox, oz, len] = outward(st, i);
        if (len > 0.05) {
          const mx = (a[0] + b[0]) / 2 + ox * 0.45, mz = (a[1] + b[1]) / 2 + oz * 0.45;
          if (pointInAny(mx, mz, env.roadbeds, 0.1)) flag = 1;
          else if (fallback) {
            const near = env.roadsS.nearest(mx, mz, 30);
            if (near && near.dist < near.seg.width / 2 && Math.abs((b[0] - a[0]) * near.dz - (b[1] - a[1]) * near.dx) < len * 0.05) flag = 1;
          }
          else if (len > 3) {
            // long edges: test the quarter points too (curb may border the road only partly; good enough)
            const qx = a[0] * 0.75 + b[0] * 0.25 + ox * 0.45, qz = a[1] * 0.75 + b[1] * 0.25 + oz * 0.45;
            if (pointInAny(qx, qz, env.roadbeds, 0.1)) flag = 1;
          }
        }
      }
      st.flags.push(flag);
    }
    rings.push(st);
  }
  return rings.length ? { rings, kind, rand, under } : null;
}

/** insert pedestrian ramps (notches) at crosswalk ends: returns the ramps created */
function insertRamps(env: TileEnv, polys: PolyState[]): Ramp[] {
  const ramps: Ramp[] = [];
  const requests = new Map<RingState, { t: number; edge: number }[]>();
  for (const c of env.tile.crossings) {
    const [ax, az] = yawToDir(c.yaw);
    for (const s of [-1, 1]) {
      const ex = c.x + ax * s * (c.width / 2), ez = c.z + az * s * (c.width / 2);
      // nearest curb edge within 3.5 m
      let best: { ring: RingState; edge: number; t: number; d: number } | null = null;
      for (const p of polys) {
        for (const r of p.rings) {
          const n = r.pts.length;
          for (let i = 0; i < n; i++) {
            if (r.flags[i] !== 1) continue;
            const a = r.pts[i], b = r.pts[(i + 1) % n];
            const dx = b[0] - a[0], dz = b[1] - a[1];
            const len2 = dx * dx + dz * dz;
            if (len2 < (RAMP_W + 1.6) * (RAMP_W + 1.6)) continue;
            const len = Math.sqrt(len2);
            let t = ((ex - a[0]) * dx + (ez - a[1]) * dz) / len2;
            t = Math.max((RAMP_W / 2 + 0.6) / len, Math.min(1 - (RAMP_W / 2 + 0.6) / len, t));
            const px = a[0] + dx * t, pz = a[1] + dz * t;
            const d = Math.hypot(ex - px, ez - pz);
            if (d < 3.5 && (!best || d < best.d)) best = { ring: r, edge: i, t: t * len, d };
          }
        }
      }
      if (!best) continue;
      let list = requests.get(best.ring);
      if (!list) requests.set(best.ring, (list = []));
      // keep ramps at least 2.2 m apart on the same edge
      if (list.some((q) => q.edge === best!.edge && Math.abs(q.t - best!.t) < RAMP_W + 0.6)) continue;
      list.push({ t: best.t, edge: best.edge });
    }
  }
  for (const [ring, list] of requests) {
    list.sort((a, b) => a.edge - b.edge || a.t - b.t);
    const pts: Pt[] = [];
    const flags: EdgeFlag[] = [];
    const n = ring.pts.length;
    let li = 0;
    for (let i = 0; i < n; i++) {
      const a = ring.pts[i], b = ring.pts[(i + 1) % n];
      pts.push(a);
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      const tx = dx / len, tz = dz / len;
      const [ox, oz] = outward(ring, i);
      const nx = -ox, nz = -oz; // inward
      let last: Pt = a;
      let any = false;
      while (li < list.length && list[li].edge === i) {
        const s = list[li].t;
        li++;
        const p1: Pt = [a[0] + tx * (s - RAMP_W / 2), a[1] + tz * (s - RAMP_W / 2)];
        const p2: Pt = [p1[0] + nx * RAMP_D, p1[1] + nz * RAMP_D];
        const p3: Pt = [p2[0] + tx * RAMP_W, p2[1] + tz * RAMP_W];
        const p4: Pt = [a[0] + tx * (s + RAMP_W / 2), a[1] + tz * (s + RAMP_W / 2)];
        // edge last->p1 curb, p1->p2 return, p2->p3 inner, p3->p4 return, p4->(next) curb
        flags.push(1);
        pts.push(p1);
        flags.push(2);
        pts.push(p2);
        flags.push(3);
        pts.push(p3);
        flags.push(4);
        pts.push(p4);
        last = p4;
        any = true;
        ramps.push({ x: a[0] + tx * s, z: a[1] + tz * s, tx, tz, nx, nz });
      }
      flags.push(any ? 1 : ring.flags[i]);
      void last;
    }
    ring.pts = pts;
    ring.flags = flags;
  }
  return ramps;
}

function emitTop(env: TileEnv, gb: GroundBuilder, p: PolyState): void {
  const poly = p.rings.map((r) => r.pts);
  const tri = triangulate(poly);
  if (!tri) return;
  const base = gb.vertexCount;
  const n = tri.verts.length / 2;
  // A varying angle inside rot2(worldPosition, angle) stretches the grid:
  // small angle changes are amplified by distance from the world origin.
  // Keep one normalized, street-aligned frame over the whole polygon.
  const bb = ringBBox(poly[0]);
  const near = env.roadsS.nearest((bb.minX + bb.maxX) / 2, (bb.minZ + bb.maxZ) / 2, 70);
  const [c4, s4] = near ? dir4(near.dx, near.dz) : dir4(GRID_DIR[0], GRID_DIR[1]);
  for (let i = 0; i < n; i++) {
    const x = tri.verts[i * 2], z = tri.verts[i * 2 + 1];
    // aA.y = signed offset from the nearest vehicular centreline, aA.z = its half-width, aB.w = 1 (a sidewalk top):
    // the shader derives the distance to the curb for the grime band along the gutter side.
    const nv = env.roadsV.nearest(x, z, 45, tmpNear);
    gb.vertex(x, WALK_Y, z, 0, 1, 0, p.kind, nv ? nv.side : 0, nv ? nv.seg.width / 2 : 0, p.rand, c4, s4, 0, 1);
  }
  for (let i = 0; i < tri.tris.length; i += 3) {
    const a = tri.tris[i], b = tri.tris[i + 1], c = tri.tris[i + 2];
    if (p.under) {
      const cx = (tri.verts[a * 2] + tri.verts[b * 2] + tri.verts[c * 2]) / 3;
      const cz = (tri.verts[a * 2 + 1] + tri.verts[b * 2 + 1] + tri.verts[c * 2 + 1]) / 3;
      if (pointInAny(cx, cz, p.under)) continue;
    }
    gb.tri(base + a, base + b, base + c);
  }
}

function nearHydrant(env: TileEnv, x: number, z: number, r: number): boolean {
  for (const h of env.hydrants) {
    const dx = h.x - x, dz = h.z - z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

function emitCurbs(env: TileEnv, gb: GroundBuilder, p: PolyState, out: SidewalkResult): void {
  for (const r of p.rings) {
    const n = r.pts.length;
    let along = hash2(p.rand, r.pts[0][0]) * 30; // random phase so stones don't align across polygons
    for (let i = 0; i < n; i++) {
      const a = r.pts[i], b = r.pts[(i + 1) % n];
      const [ox, oz, len] = outward(r, i);
      const f = r.flags[i];
      if (f === 1) {
        out.curbs.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], nx: ox, nz: oz });
        // split long edges so hydrant paint can vary along them
        const pieces = Math.max(1, Math.ceil(len / 6));
        for (let k = 0; k < pieces; k++) {
          const t0 = k / pieces, t1 = (k + 1) / pieces;
          const ax = a[0] + (b[0] - a[0]) * t0, az = a[1] + (b[1] - a[1]) * t0;
          const bx = a[0] + (b[0] - a[0]) * t1, bz = a[1] + (b[1] - a[1]) * t1;
          const paint = nearHydrant(env, (ax + bx) / 2, (az + bz) / 2, 4.5) ? 1 : 0;
          const a0 = along + len * t0, a1 = along + len * t1;
          gb.wall(ax, az, bx, bz, 0, CURB_TOP, ox, 0, oz, KIND.curb, a0, a1, p.rand, paint, 0, ox, oz);
          // bevel: from the face top inward 3 cm up to the sidewalk level
          const bn = 0.7071;
          gb.wall(ax, az, bx, bz, CURB_TOP, WALK_Y, ox * bn, bn, oz * bn, KIND.curb, a0, a1, p.rand, paint, 0.03, ox, oz);
          // granite top: the curb stone shows ~15 cm of its top beside the flags (a lighter band with the stone joints)
          // aA.y on the top band = inset from the curb line, so the shader can put the mortar line
          // exactly where the stone butts the flags instead of guessing at it from world position.
          const ty = WALK_Y + 0.004, ix = -ox, iz = -oz;
          const v0 = gb.vertex(ax + ix * 0.02, ty, az + iz * 0.02, 0, 1, 0, KIND.curb, 0.02, a0, p.rand, ox, oz, paint, 0);
          const v1 = gb.vertex(bx + ix * 0.02, ty, bz + iz * 0.02, 0, 1, 0, KIND.curb, 0.02, a1, p.rand, ox, oz, paint, 0);
          const v2 = gb.vertex(bx + ix * CURB_W, ty, bz + iz * CURB_W, 0, 1, 0, KIND.curb, CURB_W, a1, p.rand, ox, oz, paint, 0);
          const v3 = gb.vertex(ax + ix * CURB_W, ty, az + iz * CURB_W, 0, 1, 0, KIND.curb, CURB_W, a0, p.rand, ox, oz, paint, 0);
          // +y winding: (v1 - v0) x (v3 - v0) in xz must point up
          const ny = (bz - az) * ix - (bx - ax) * iz;
          if (ny > 0) gb.quad(v0, v1, v2, v3);
          else gb.quad(v0, v3, v2, v1);
        }
      } else if (f === 2 || f === 4) {
        // ramp return: a wedge from sidewalk level down to the ramp surface (the ramp rises inward).
        // The notch (ramp) lies on the outward side of this boundary edge, so the wall faces `outward`.
        const outer = f === 2 ? a : b;
        const inner = f === 2 ? b : a;
        const rand = p.rand;
        const v0 = gb.vertex(outer[0], WALK_Y, outer[1], ox, 0, oz, KIND.plainConcrete, 0, 0, rand, 0, 0, 0, 0);
        const v1 = gb.vertex(outer[0], 0, outer[1], ox, 0, oz, KIND.plainConcrete, 0, 0, rand, 0, 0, 0, 0);
        const v2 = gb.vertex(inner[0], WALK_Y, inner[1], ox, 0, oz, KIND.plainConcrete, 0, 0, rand, 0, 0, 0, 0);
        // pick the winding whose normal matches (ox, oz)
        const ex = inner[0] - outer[0], ez = inner[1] - outer[1];
        // (v1 - v0) = (0, -h, 0); (v2 - v0) = (ex, 0, ez): cross = (-h*ez, 0, h*ex) -> direction (-ez, 0, ex)
        if (-ez * ox + ex * oz > 0) gb.tri(v0, v1, v2);
        else gb.tri(v0, v2, v1);
      }
      along += len;
    }
  }
}

function emitRamp(env: TileEnv, gb: GroundBuilder, rp: Ramp, rand: number): void {
  const { tx, tz, nx, nz } = rp;
  // Meet the physical road at zero; the asphalt's 2 cm render offset is not a step.
  const slope = WALK_Y / RAMP_D;
  const nl = Math.hypot(slope, 1);
  const snx = (-nx * slope) / nl, sny = 1 / nl, snz = (-nz * slope) / nl;
  const [c4, s4] = dir4(tx, tz);
  const row = (d: number, kind: number) => {
    const y = slope * d;
    const cx = rp.x + nx * d, cz = rp.z + nz * d;
    const l = gb.vertex(cx - tx * (RAMP_W / 2), y, cz - tz * (RAMP_W / 2), snx, sny, snz, kind, 0, d, rand, c4, s4, 0, 0);
    const r = gb.vertex(cx + tx * (RAMP_W / 2), y, cz + tz * (RAMP_W / 2), snx, sny, snz, kind, RAMP_W, d, rand, c4, s4, 0, 0);
    return [l, r];
  };
  const r0 = row(0, KIND.tactile);
  const r1 = row(PAD_D, KIND.tactile);
  const r1b = row(PAD_D, KIND.flags);
  const r2 = row(RAMP_D, KIND.flags);
  const quad = (a: number[], b: number[]) => {
    // rows a (outer) and b (inner); +y winding: (aL, bR, bL) (aL, aR, bR) with "right" = +t and inward = +n
    // check orientation: t x n should be consistent; we compute the y-normal sign explicitly
    const ax = gb.pos[a[0] * 3], az = gb.pos[a[0] * 3 + 2];
    const bx = gb.pos[a[1] * 3], bz = gb.pos[a[1] * 3 + 2];
    const cx = gb.pos[b[1] * 3], cz = gb.pos[b[1] * 3 + 2];
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny > 0) {
      gb.tri(a[0], a[1], b[1]);
      gb.tri(a[0], b[1], b[0]);
    } else {
      gb.tri(a[0], b[1], a[1]);
      gb.tri(a[0], b[0], b[1]);
    }
  };
  quad(r0, r1);
  quad(r1b, r2);
  void env;
}

/** Derive sidewalks without paving over buildings, intersections, parks or plazas. */
function fallbackRibbons(env: TileEnv): PolyState[] {
  const obstacles = [...env.tile.buildings.map(b => b.footprint), ...env.tile.water,
    ...env.tile.parks, ...env.tile.plazas, ...env.tile.medians, ...env.tile.parking, ...env.tile.roadbeds];
  // Road envelopes are needed even when planimetric roadbeds are absent.
  for (const { seg: r } of env.roadsS.segs) {
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const rx = -(b[1] - a[1]) / len * r.width / 2, rz = (b[0] - a[0]) / len * r.width / 2;
      obstacles.push([[[a[0] - rx, a[1] - rz], [b[0] - rx, b[1] - rz], [b[0] + rx, b[1] + rz], [a[0] + rx, a[1] + rz]]]);
    }
  }
  const cuts = obstacles.flatMap(poly => {
    const tri = triangulate(poly);
    if (!tri) return [];
    const triangles: Ring[] = [];
    for (let i = 0; i < tri.tris.length; i += 3) triangles.push(tri.tris.slice(i, i + 3).map(v => [tri.verts[v * 2], tri.verts[v * 2 + 1]]));
    return [{ bb: ringBBox(poly[0]), triangles }];
  });
  const rect = env.rect;
  const clip: Ring = [[rect.minX, rect.minZ], [rect.maxX, rect.minZ], [rect.maxX, rect.maxZ], [rect.minX, rect.maxZ]];
  const result: PolyState[] = [];
  for (const { seg: r } of env.roadsS.segs) {
    // Sidewalks belong to surface streets, not limited-access highways.
    if (!STREET.has(r.cls) || r.cls === 'motorway' || r.cls === 'trunk') continue;
    const sw = r.cls === 'residential' || r.cls === 'tertiary' ? 3.8 : 4.6;
    const hw = r.width / 2, margin = hw + sw;
    const expanded = { minX: rect.minX - margin, minZ: rect.minZ - margin, maxX: rect.maxX + margin, maxZ: rect.maxZ + margin };
    for (const piece of clipPolylineToRect(r.pts, expanded)) {
      const pts = piece.pts;
      for (const side of [-1, 1]) {
        const inner: Ring = [], outer: Ring = [];
        for (let i = 0; i < pts.length; i++) {
          const [x, z] = pts[i];
          const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
          const len = Math.hypot(next[0] - prev[0], next[1] - prev[1]) || 1;
          const rx = -(next[1] - prev[1]) / len * side, rz = (next[0] - prev[0]) / len * side;
          inner.push([x + rx * hw, z + rz * hw]);
          outer.push([x + rx * (hw + sw), z + rz * (hw + sw)]);
        }
        const tri = triangulate([[...inner, ...outer.reverse()]]);
        if (!tri) continue;
        for (let i = 0; i < tri.tris.length; i += 3) {
          const subject: Ring = tri.tris.slice(i, i + 3).map(v => [tri.verts[v * 2], tri.verts[v * 2 + 1]]);
          const clipped = clipConvex(subject, clip);
          if (clipped.length < 3) continue;
          const bb = ringBBox(clipped);
          let parts = [clipped];
          for (const cut of cuts) {
            if (cut.bb.maxX <= bb.minX || cut.bb.minX >= bb.maxX || cut.bb.maxZ <= bb.minZ || cut.bb.minZ >= bb.maxZ) continue;
            for (const triangle of cut.triangles) parts = parts.flatMap(part => subtractConvex(part, triangle));
            if (!parts.length) break;
          }
          for (const part of parts) {
            const poly = prepare(env, [part], KIND.flags, hash2(r.id, side), true);
            if (!poly) continue;
            result.push(poly);
            // Two street envelopes share sidewalk corners. Own each patch once
            // instead of emitting coplanar overlapping tops at the junction.
            const triangles: Ring[] = [];
            for (let j = 1; j + 1 < part.length; j++) triangles.push([part[0], part[j], part[j + 1]]);
            cuts.push({ bb: ringBBox(part), triangles });
          }
        }
      }
    }
  }
  return result;
}

/** generator: yields between polygons so the tile job can spread work over frames */
export function* buildSidewalks(env: TileEnv, gb: GroundBuilder, out: SidewalkResult): Generator<void, void> {
  const { tile } = env;
  const polys: PolyState[] = [];
  let k = 0;
  const add = (list: Ring[][], kind: number) => {
    for (const poly of list) {
      const st = prepare(env, poly, kind, hash2(env.seed + 7, k++));
      if (st) polys.push(st);
    }
  };
  add(tile.sidewalks, KIND.flags);
  // A median/plaza is not evidence that the tile has sidewalk coverage.
  if (!polys.length) polys.push(...fallbackRibbons(env));
  // Planimetric plazas and medians routinely lie inside the block's sidewalk polygon: the NYPL frontage
  // at 5th and 42nd is paved twice over, flags and pavers coplanar at WALK_Y, and the pair fights for
  // every fragment, which is what turns the 1.52 m flag grid into a patchwork of half-joints. The
  // sidewalk layer is what the frontage photographs as (refs/_sheets/fifth-42nd 3, 4), so it owns the
  // overlap and the plaza keeps only the ground no sidewalk already claims.
  const paved = indexPolygons(tile.sidewalks);
  const addOver = (list: Ring[][], kind: number) => {
    for (const poly of list) {
      const st = prepare(env, poly, kind, hash2(env.seed + 7, k++), false, paved.length ? paved : undefined);
      if (st) polys.push(st);
    }
  };
  addOver(tile.medians, KIND.flags);
  addOver(tile.plazas, KIND.pavers);
  if (!polys.length) return;
  yield;
  const ramps = insertRamps(env, polys);
  out.ramps.push(...ramps);
  yield;
  let budget = 0;
  for (const p of polys) {
    emitTop(env, gb, p);
    emitCurbs(env, gb, p, out);
    budget += p.rings.reduce((a, r) => a + r.pts.length, 0);
    if (budget > 120) {
      budget = 0;
      yield;
    }
  }
  for (const rp of ramps) emitRamp(env, gb, rp, hash2(rp.x, rp.z));
}
