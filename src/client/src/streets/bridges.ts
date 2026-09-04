/**
 * Elevated roadways (RoadSegment.bridge): deck ribbon at the layer height with ramps to ground at nodes
 * shared with ground-level roads, slab + fascia + parapet (Jersey barrier on highways, iron railing on old
 * viaducts), piers every 25 m, colliders. Tunnel portals for RoadSegment.tunnel ends.
 */
import type { Pt, RoadSegment } from '@shared/world';
import { GroundBuilder, StructBuilder, type TileEnv } from './builders';
import { VEHICULAR, clipPolylineToRect, hash2, pointAlong, polylineLength, type BBox } from './geom2d';
import { KIND } from './materials';
import { ROAD_Y, kindForSurface, ribbon } from './roadbed';

export interface DeckSample {
  pts: { x: number; z: number; h: number }[];
  hw: number;
}

export interface BridgeOut {
  decks: DeckSample[];
  cpos: number[];
  cidx: number[];
}

const CONCRETE: [number, number, number] = [0.66, 0.64, 0.6];
const CONCRETE_DARK: [number, number, number] = [0.5, 0.49, 0.46];
const STEEL_GREEN: [number, number, number] = [0.2, 0.26, 0.24];
const STEEL_GREY: [number, number, number] = [0.36, 0.37, 0.39];
const IRON: [number, number, number] = [0.07, 0.07, 0.075];

function deckHeightFor(r: RoadSegment): number {
  const foot = r.cls === 'footway' || r.cls === 'steps' || r.cls === 'pedestrian' || r.cls === 'cycleway';
  if (r.layer >= 3) return 18;
  if (r.layer === 2) return foot ? 9 : 13;
  if (/bridge/i.test(r.name ?? '') && (r.cls === 'trunk' || r.cls === 'motorway') && r.layer >= 2) return 20;
  return 7;
}

function isGroundNode(env: TileEnv, x: number, z: number, self: RoadSegment): boolean {
  const near = env.ctx.world.roadsNear(x, z, 3);
  let any = false;
  for (const r of near) {
    if (r === self || r.id === self.id || r.bridge || r.tunnel) continue;
    if (!VEHICULAR.has(r.cls) && !(r.cls === self.cls)) continue;
    const a = r.pts[0], b = r.pts[r.pts.length - 1];
    if (Math.hypot(a[0] - x, a[1] - z) < 0.6 || Math.hypot(b[0] - x, b[1] - z) < 0.6) return true;
    any = true;
  }
  void any;
  // a bridge end shared with nothing at all: ramp down (OSM often tags only the elevated part)
  let shared = false;
  for (const r of near) {
    if (r === self || r.id === self.id) continue;
    const a = r.pts[0], b = r.pts[r.pts.length - 1];
    if (Math.hypot(a[0] - x, a[1] - z) < 0.6 || Math.hypot(b[0] - x, b[1] - z) < 0.6) shared = true;
  }
  return !shared;
}

function smooth(t: number): number {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/** subdivide a polyline so no piece is longer than maxLen; keeps arc-length s per point (from s0) */
function densify(pts: Pt[], s0: number, maxLen: number): { pts: Pt[]; s: number[] } {
  const out: Pt[] = [pts[0]];
  const s: number[] = [s0];
  let acc = s0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(l / maxLen));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      s.push(acc + l * t);
    }
    acc += l;
  }
  return { pts: out, s };
}

function inRect(r: BBox, x: number, z: number): boolean {
  return x >= r.minX + 0.05 && x < r.maxX - 0.05 && z >= r.minZ + 0.05 && z < r.maxZ - 0.05;
}

export function buildBridges(env: TileEnv, gb: GroundBuilder, sb: StructBuilder, out: BridgeOut): void {
  const { tile, rect } = env;
  const seen = new Set<number>();
  const low = env.ctx.quality.level === 'low';
  for (const r of tile.roads) {
    if (!r.bridge || r.tunnel || seen.has(r.id) || r.pts.length < 2) continue;
    seen.add(r.id);
    const foot = !VEHICULAR.has(r.cls);
    if (r.cls === 'steps') continue;
    const H = deckHeightFor(r);
    const L = polylineLength(r.pts);
    if (L < 2) continue;
    const p0 = r.pts[0], p1 = r.pts[r.pts.length - 1];
    const g0 = isGroundNode(env, p0[0], p0[1], r);
    const g1 = isGroundNode(env, p1[0], p1[1], r);
    const rampLen = Math.min(H * 12.5, L * 0.5);
    const hAt = (s: number) => H * (g0 ? smooth(s / rampLen) : 1) * (g1 ? smooth((L - s) / rampLen) : 1);
    const hw = Math.max(foot ? 1.2 : 3.2, r.width / 2);
    const slabT = foot ? 0.4 : r.cls === 'motorway' || r.cls === 'trunk' ? 1.0 : 1.4;
    const steel = !foot && r.cls !== 'motorway' && r.cls !== 'trunk';
    const fascia: [number, number, number] = foot ? CONCRETE : steel ? (r.layer <= 1 ? STEEL_GREEN : STEEL_GREY) : CONCRETE;
    const fasciaMat = foot ? 0 : steel ? 1 : 0;
    const jersey = !foot && (r.cls === 'motorway' || r.cls === 'trunk');
    const kind = foot ? KIND.plainConcrete : kindForSurface(r.surface);
    const rand = hash2(env.seed, r.id);

    for (const piece of clipPolylineToRect(r.pts, rect)) {
      const d = densify(piece.pts, piece.s0, 4);
      const hs = d.s.map(hAt);
      // skip pieces that never leave the ground
      if (hs.every((h) => h < 0.05)) continue;
      // deck top (into the roadbed mesh so it shares the asphalt shader)
      const { left, right } = ribbon(gb, d.pts, hw, (i) => ROAD_Y + hs[i], kind, foot ? 0 : 0.9, rand);
      out.decks.push({ pts: d.pts.map((p, i) => ({ x: p[0], z: p[1], h: hs[i] })), hw });
      // collider: copy the deck top
      const cb = out.cpos.length / 3;
      for (let i = 0; i < left.length; i++) {
        out.cpos.push(gb.pos[left[i] * 3], gb.pos[left[i] * 3 + 1], gb.pos[left[i] * 3 + 2]);
        out.cpos.push(gb.pos[right[i] * 3], gb.pos[right[i] * 3 + 1], gb.pos[right[i] * 3 + 2]);
      }
      for (let i = 0; i + 1 < left.length; i++) {
        const l0 = cb + i * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
        out.cidx.push(l0, r1, l1, l0, r0, r1);
      }
      // slab sides + underside + parapets
      const P = (vi: number) => [gb.pos[vi * 3], gb.pos[vi * 3 + 1], gb.pos[vi * 3 + 2]];
      for (let i = 0; i + 1 < left.length; i++) {
        if (hs[i] < 0.3 && hs[i + 1] < 0.3) continue;
        const Lt0 = P(left[i]), Lt1 = P(left[i + 1]), Rt0 = P(right[i]), Rt1 = P(right[i + 1]);
        const Lb0 = [Lt0[0], Lt0[1] - slabT, Lt0[2]], Lb1 = [Lt1[0], Lt1[1] - slabT, Lt1[2]];
        const Rb0 = [Rt0[0], Rt0[1] - slabT, Rt0[2]], Rb1 = [Rt1[0], Rt1[1] - slabT, Rt1[2]];
        sb.face([Lt0, Lt1, Lb1, Lb0], fascia, fasciaMat);
        sb.face([Rt1, Rt0, Rb0, Rb1], fascia, fasciaMat);
        sb.face([Lb0, Lb1, Rb1, Rb0], CONCRETE_DARK, 0);
        // parapet
        const dx = Lt1[0] - Lt0[0], dz = Lt1[2] - Lt0[2];
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        const rx = -uz, rz = ux; // right of travel (unit)
        for (const side of [-1, 1]) {
          const T0 = side < 0 ? Lt0 : Rt0, T1 = side < 0 ? Lt1 : Rt1;
          const inx = -side * rx, inz = -side * rz; // inward (toward the deck centre)
          if (jersey) {
            const b0 = [T0[0] + inx * 0.1, T0[1], T0[2] + inz * 0.1], b1 = [T1[0] + inx * 0.1, T1[1], T1[2] + inz * 0.1];
            const b2 = [T1[0] + inx * 0.65, T1[1], T1[2] + inz * 0.65], b3 = [T0[0] + inx * 0.65, T0[1], T0[2] + inz * 0.65];
            const t0 = [T0[0] + inx * 0.28, T0[1] + 0.81, T0[2] + inz * 0.28], t1 = [T1[0] + inx * 0.28, T1[1] + 0.81, T1[2] + inz * 0.28];
            const t2 = [T1[0] + inx * 0.48, T1[1] + 0.81, T1[2] + inz * 0.48], t3 = [T0[0] + inx * 0.48, T0[1] + 0.81, T0[2] + inz * 0.48];
            solid(sb, [b0, b1, b2, b3], [t0, t1, t2, t3], CONCRETE, 0, out, true);
          } else {
            // iron railing: rails + posts + balusters
            const off = 0.12;
            const railW = 0.06;
            const base0 = [T0[0] + inx * off, T0[1], T0[2] + inz * off], base1 = [T1[0] + inx * off, T1[1], T1[2] + inz * off];
            const railH = foot ? 1.1 : 1.05;
            bar(sb, base0, base1, inx, inz, railW, railH - 0.06, railH, IRON, 2, out);
            bar(sb, base0, base1, inx, inz, railW, 0.1, 0.16, IRON, 2, out);
            if (!low) {
              const nb = Math.max(1, Math.round(len / 0.2));
              for (let k = 0; k < nb; k++) {
                const t = (k + 0.5) / nb;
                const cx = base0[0] + (base1[0] - base0[0]) * t, cy = base0[1] + (base1[1] - base0[1]) * t, cz = base0[2] + (base1[2] - base0[2]) * t;
                post(sb, cx, cy, cz, ux, uz, 0.022, 0.16, railH - 0.06, IRON, 2);
              }
            }
            const np = Math.max(1, Math.round(len / 2));
            for (let k = 0; k <= np; k++) {
              const t = k / np;
              if (k === np && i + 2 < left.length) continue; // the next piece starts with this post
              const cx = base0[0] + (base1[0] - base0[0]) * t, cy = base0[1] + (base1[1] - base0[1]) * t, cz = base0[2] + (base1[2] - base0[2]) * t;
              post(sb, cx, cy, cz, ux, uz, 0.08, 0, railH + 0.04, IRON, 2);
            }
          }
        }
      }
    }
    // piers every 25 m along the whole segment (only those inside this tile)
    if (!foot || H > 3) {
      for (let s = 12.5; s < L; s += 25) {
        const h = hAt(s);
        if (h < 2.5) continue;
        const q = pointAlong(r.pts, s);
        if (!inRect(rect, q.x, q.z)) continue;
        const rx = -q.dz, rz = q.dx;
        const top = h + ROAD_Y - slabT;
        const capH = foot ? 0.5 : 1.0;
        // cap beam
        const cw = hw + 0.3, cd = 0.5;
        const b = [
          [q.x - rx * cw - q.dx * cd, top - capH, q.z - rz * cw - q.dz * cd],
          [q.x + rx * cw - q.dx * cd, top - capH, q.z + rz * cw - q.dz * cd],
          [q.x + rx * cw + q.dx * cd, top - capH, q.z + rz * cw + q.dz * cd],
          [q.x - rx * cw + q.dx * cd, top - capH, q.z - rz * cw + q.dz * cd],
        ];
        const t = b.map((p) => [p[0], top, p[2]]);
        solid(sb, b, t, CONCRETE, 0, out, false);
        const cols = hw > 6 ? [-hw * 0.5, hw * 0.5] : [0];
        for (const off of cols) {
          const cx = q.x + rx * off, cz = q.z + rz * off;
          const cwid = foot ? 0.35 : 0.55;
          const cb = [
            [cx - rx * cwid - q.dx * cwid, 0, cz - rz * cwid - q.dz * cwid],
            [cx + rx * cwid - q.dx * cwid, 0, cz + rz * cwid - q.dz * cwid],
            [cx + rx * cwid + q.dx * cwid, 0, cz + rz * cwid + q.dz * cwid],
            [cx - rx * cwid + q.dx * cwid, 0, cz - rz * cwid + q.dz * cwid],
          ];
          const ct = cb.map((p) => [p[0], top - capH + 0.01, p[2]]);
          solid(sb, cb, ct, CONCRETE, 0, out, true);
        }
      }
    }
  }
}

/** a prism from a bottom quad and a top quad (any orientation); faces are oriented outward automatically */
export function solid(sb: StructBuilder, b: number[][], t: number[][], color: [number, number, number], mat: number, out: BridgeOut | null, collide: boolean): void {
  const all = [...b, ...t];
  const c = [0, 0, 0];
  for (const p of all) { c[0] += p[0] / 8; c[1] += p[1] / 8; c[2] += p[2] / 8; }
  const faces = [
    [t[0], t[1], t[2], t[3]],
    [b[0], b[1], b[2], b[3]],
    [b[0], b[1], t[1], t[0]],
    [b[1], b[2], t[2], t[1]],
    [b[2], b[3], t[3], t[2]],
    [b[3], b[0], t[0], t[3]],
  ];
  for (const f of faces) {
    const ux = f[1][0] - f[0][0], uy = f[1][1] - f[0][1], uz = f[1][2] - f[0][2];
    const vx = f[2][0] - f[0][0], vy = f[2][1] - f[0][1], vz = f[2][2] - f[0][2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const fc = [(f[0][0] + f[2][0]) / 2, (f[0][1] + f[2][1]) / 2, (f[0][2] + f[2][2]) / 2];
    const dot = nx * (fc[0] - c[0]) + ny * (fc[1] - c[1]) + nz * (fc[2] - c[2]);
    const ordered = dot >= 0 ? f : [f[0], f[3], f[2], f[1]];
    sb.face(ordered, color, mat, false);
    if (collide && out) {
      const cb = out.cpos.length / 3;
      for (const q of ordered) out.cpos.push(q[0], q[1], q[2]);
      out.cidx.push(cb, cb + 1, cb + 2, cb, cb + 2, cb + 3);
    }
  }
}

/** horizontal bar along base0->base1 (deck-top coordinates), width w toward `in`, between heights y0..y1 above the deck */
function bar(sb: StructBuilder, a: number[], b: number[], inx: number, inz: number, w: number, y0: number, y1: number, color: [number, number, number], mat: number, out: BridgeOut): void {
  const bot = [
    [a[0], a[1] + y0, a[2]],
    [b[0], b[1] + y0, b[2]],
    [b[0] + inx * w, b[1] + y0, b[2] + inz * w],
    [a[0] + inx * w, a[1] + y0, a[2] + inz * w],
  ];
  const top = bot.map((p, i) => [p[0], (i < 2 ? (i === 0 ? a[1] : b[1]) : i === 2 ? b[1] : a[1]) + y1, p[2]]);
  solid(sb, bot, top, color, mat, out, y1 > 0.5);
}

function post(sb: StructBuilder, cx: number, cy: number, cz: number, ux: number, uz: number, size: number, y0: number, y1: number, color: [number, number, number], mat: number): void {
  const rx = -uz, rz = ux;
  const h = size / 2;
  const bot = [
    [cx - ux * h - rx * h, cy + y0, cz - uz * h - rz * h],
    [cx + ux * h - rx * h, cy + y0, cz + uz * h - rz * h],
    [cx + ux * h + rx * h, cy + y0, cz + uz * h + rz * h],
    [cx - ux * h + rx * h, cy + y0, cz - uz * h + rz * h],
  ];
  const top = bot.map((p) => [p[0], cy + y1, p[2]]);
  solid(sb, bot, top, color, mat, null, false);
}

/** tunnel portals at the ends of vehicular tunnel segments that connect to surface roads */
export function buildPortals(env: TileEnv, sb: StructBuilder, out: BridgeOut): void {
  const { tile, rect } = env;
  const seen = new Set<number>();
  for (const r of tile.roads) {
    if (!r.tunnel || seen.has(r.id) || !VEHICULAR.has(r.cls) || r.cls === 'service' || r.pts.length < 2) continue;
    seen.add(r.id);
    for (const atStart of [true, false]) {
      const p = atStart ? r.pts[0] : r.pts[r.pts.length - 1];
      if (!inRect(rect, p[0], p[1])) continue;
      // connected to a surface road?
      const near = env.ctx.world.roadsNear(p[0], p[1], 3);
      let surface = false;
      for (const o of near) {
        if (o.id === r.id || o.tunnel) continue;
        const a = o.pts[0], b = o.pts[o.pts.length - 1];
        if (Math.hypot(a[0] - p[0], a[1] - p[1]) < 0.6 || Math.hypot(b[0] - p[0], b[1] - p[1]) < 0.6) surface = true;
      }
      if (!surface) continue;
      const q = pointAlong(r.pts, atStart ? Math.min(6, polylineLength(r.pts) / 2) : Math.max(0, polylineLength(r.pts) - Math.min(6, polylineLength(r.pts) / 2)));
      // direction INTO the tunnel
      let dx = q.x - p[0], dz = q.z - p[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const rx = -dz, rz = dx;
      const hw = Math.max(4, r.width / 2) + 0.6;
      const depth = 8, wallT = 0.6, height = 5.2;
      const box = (o0: number, o1: number, d0: number, d1: number, y0: number, y1: number, color: [number, number, number], collide: boolean) => {
        const b = [
          [p[0] + rx * o0 + dx * d0, y0, p[1] + rz * o0 + dz * d0],
          [p[0] + rx * o1 + dx * d0, y0, p[1] + rz * o1 + dz * d0],
          [p[0] + rx * o1 + dx * d1, y0, p[1] + rz * o1 + dz * d1],
          [p[0] + rx * o0 + dx * d1, y0, p[1] + rz * o0 + dz * d1],
        ];
        const t = b.map((v) => [v[0], y1, v[2]]);
        solid(sb, b, t, color, 0, out, collide);
      };
      box(-hw - wallT, -hw, 0, depth, 0, height, CONCRETE, true);
      box(hw, hw + wallT, 0, depth, 0, height, CONCRETE, true);
      box(-hw - wallT, hw + wallT, 0, depth, height, height + 1.2, CONCRETE, false);
      // dark mouth: a black slab 1.5 m in (also the collider that stops cars)
      box(-hw, hw, 1.5, 2.0, 0, height, [0.012, 0.012, 0.014], true);
      // the tunnel floor between the mouth and the walls
      box(-hw, hw, 0, 1.5, -0.05, 0.02, [0.2, 0.2, 0.2], false);
    }
  }
}

/** height of the highest deck over a point (0 = ground). Uses the tile's deck samples. */
export function deckHeightIn(decks: DeckSample[], x: number, z: number): number {
  let best = 0;
  for (const d of decks) {
    const pts = d.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z;
      const len2 = ex * ex + ez * ez;
      if (len2 < 1e-6) continue;
      let t = ((x - a.x) * ex + (z - a.z) * ez) / len2;
      if (t < -0.02 || t > 1.02) continue;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + ex * t, pz = a.z + ez * t;
      if (Math.hypot(x - px, z - pz) > d.hw + 0.3) continue;
      const h = a.h + (b.h - a.h) * t;
      if (h > best) best = h;
    }
  }
  return best;
}
