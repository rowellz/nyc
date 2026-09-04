/**
 * The Park Avenue Viaduct (1919/1928): the architecture of the elevated roadway the streets module already
 * carries as bridge decks. Along every roadway edge a granite balustrade (covering the streets' iron railing);
 * under the Pershing Square ramp (40th -> 42nd) the masonry side walls, solid on the climb and an arcade at
 * deck level; over 42nd Street the steel arch bridge with its spandrel posts and granite abutments; at the
 * junction in front of the terminal the deck that fans out to the two roadways.
 *
 * Deck heights replicate streets/bridges.ts: layer-1 decks at 7 m + ROAD_Y, ramping up over
 * min(87.5 m, half the segment) from a ground node with a smoothstep. Everything here sits under or beside the
 * streets ribbon, never on it, so the asphalt stays theirs.
 */
import { GeoBuilder, ccwRing, type StyleSpec, type XYZ } from '../geom';
import { VIADUCT as VD } from '../data';
import { STYLE } from '../materials';
import { facadeFrame } from './grand-central';
import type { Pt, Ring } from '@shared/world';

export interface ViaductParts {
  body: GeoBuilder;
  colliders: { ring: Ring; y0: number; y1: number }[];
  center: [number, number];
  decks: { ring: Ring; height: number }[];
}

const BALUSTRADE: StyleSpec = { style: STYLE.BALUSTER, p: [0.68, 0.64, 0.56, 0], p2: [0, 0, 0, 0] };
const GRANITE: StyleSpec = { style: STYLE.GRANITE, p: [0, 0, 0, 0], p2: [0, 0, 0.25, 0] };
const STEEL: StyleSpec = { style: STYLE.PAINT, p: [0.20, 0.26, 0.24, 0.55], p2: [0, 0, 0, 0] };
const STEEL_DARK: StyleSpec = { style: STYLE.PAINT, p: [0.14, 0.18, 0.17, 0.6], p2: [0, 0, 0, 0] };
const ASPHALT: StyleSpec = { style: STYLE.ASPHALT, p: [0, 0, 0, 0], p2: [0, 0, 0, 0] };
const DECK_TOP = VD.deck + VD.roadY;
const SLAB = 1.4;

function smooth(t: number): number {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
function length(pts: Ring): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}
/** the streets ramp profile of the Pershing Square ramp: height of the deck top above ground at arc length s */
export function rampHeight(s: number): number {
  const L = length(VD.ramp.pts);
  const rampLen = Math.min(VD.deck * 12.5, L * 0.5);
  return VD.deck * smooth(s / rampLen);
}

export function buildViaduct(): ViaductParts {
  const g = new GeoBuilder();
  const colliders: ViaductParts['colliders'] = [];
  const decks: ViaductParts['decks'] = [];
  const { F, half: hl } = facadeFrame();
  const P = (u: number, v: number, y: number): XYZ => { const w = F.toWorld(u, v); return [w[0], y, w[1]]; };
  /** in front of the terminal (terrace + fan): roadway inner edges have a kerb there, not a balustrade */
  const inFront = (x: number, z: number): boolean => {
    const [u, v] = F.toLocal(x, z);
    return u > -26 && u < 1 && Math.abs(v) < hl + 2;
  };

  /**
   * A balustrade along one edge of a roadway: `side` -1 = left of travel, +1 = right; the member straddles the
   * ribbon edge (0.25 m in, 0.3 m out) so it swallows the streets' iron railing. Heights from hAt(s).
   */
  const balustrade = (pts: Ring, hw: number, side: -1 | 1, hAt: (s: number) => number, skipInner: boolean) => {
    let s = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const ux = dx / len, uz = dz / len;
      const rx = -uz * side, rz = ux * side; // toward this edge
      const h0 = hAt(s) + VD.roadY, h1 = hAt(s + len) + VD.roadY;
      s += len;
      if (h0 < 0.4 && h1 < 0.4) continue;
      const mx = (a[0] + b[0]) / 2 + rx * hw, mz = (a[1] + b[1]) / 2 + rz * hw;
      if (skipInner && inFront(mx, mz)) continue;
      const o0 = hw - 0.25, o1 = hw + 0.3;
      const bot: XYZ[] = [
        [a[0] + rx * o0, h0 - 0.3, a[1] + rz * o0], [b[0] + rx * o0, h1 - 0.3, b[1] + rz * o0],
        [b[0] + rx * o1, h1 - 0.3, b[1] + rz * o1], [a[0] + rx * o1, h0 - 0.3, a[1] + rz * o1],
      ];
      const top: XYZ[] = bot.map((p, k) => [p[0], (k === 0 || k === 3 ? h0 : h1) + 1.1, p[2]]);
      g.hexa(bot, top, BALUSTRADE);
      if (len > 3) colliders.push({ ring: [[bot[0][0], bot[0][2]], [bot[1][0], bot[1][2]], [bot[2][0], bot[2][2]], [bot[3][0], bot[3][2]]], y0: Math.min(h0, h1) - 0.3, y1: Math.max(h0, h1) + 1.1 });
    }
  };
  const flat = () => VD.deck;

  // ---- the roadways around the terminal: balustrades on both edges (inner edges only past the terrace) ----
  for (const seg of VD.west) { balustrade(seg.pts, seg.hw, -1, flat, false); balustrade(seg.pts, seg.hw, 1, flat, true); }
  for (const seg of VD.east) { balustrade(seg.pts, seg.hw, -1, flat, true); balustrade(seg.pts, seg.hw, 1, flat, false); }

  // ---- the Pershing Square ramp: balustrades, masonry side walls, the arcade, the arch over 42nd ------------
  const ramp = VD.ramp.pts;
  const L = length(ramp);
  const dir: Pt = [(ramp[1][0] - ramp[0][0]) / L, (ramp[1][1] - ramp[0][1]) / L];
  const right: Pt = [-dir[1], dir[0]];
  const at = (s: number, off: number, y: number): XYZ => [ramp[0][0] + dir[0] * s + right[0] * off, y, ramp[0][1] + dir[1] * s + right[1] * off];
  // 42nd Street's centreline crosses the ramp near its top; the arch spans the roadway and both sidewalks
  const [uJ] = F.toLocal(ramp[1][0], ramp[1][1]);
  const [u42] = F.toLocal(467.8, 166.4);
  const s42 = L - (uJ - u42);
  const halfSpan = 12.0;
  const sAbutS = s42 - halfSpan, sAbutN = s42 + halfSpan;
  const dense: number[] = [];
  for (let s = 0; s < sAbutS - 2; s += 4) dense.push(s);
  dense.push(sAbutS - 2);
  const hw = VD.ramp.hw;
  // the balustrade follows the streets' smoothstep profile: densify the two-point ramp to 4 m pieces
  const rampDense: Ring = [];
  for (let s = 0; s < L; s += 4) rampDense.push([ramp[0][0] + dir[0] * s, ramp[0][1] + dir[1] * s]);
  rampDense.push(ramp[1]);
  balustrade(rampDense, hw, -1, rampHeight, false);
  balustrade(rampDense, hw, 1, rampHeight, false);
  // side walls: solid rusticated granite on the climb; the arcade at deck level up to the abutment
  const sArc = Math.min(VD.deck * 12.5, L * 0.5) + 2;
  for (const side of [-1, 1]) {
    const o0 = side * (hw + 0.1), o1 = side * (hw + 0.7);
    for (let i = 0; i + 1 < dense.length; i++) {
      const s0 = dense[i], s1 = dense[i + 1];
      if (s0 >= sArc) break;
      const e1 = Math.min(s1, sArc);
      const t0 = rampHeight(s0) + VD.roadY - SLAB - 0.02, t1 = rampHeight(e1) + VD.roadY - SLAB - 0.02;
      if (t0 < 0.2 && t1 < 0.2) continue;
      g.hexa([at(s0, o0, -0.3), at(e1, o0, -0.3), at(e1, o1, -0.3), at(s0, o1, -0.3)], [at(s0, o0, Math.max(0.05, t0)), at(e1, o0, Math.max(0.05, t1)), at(e1, o1, Math.max(0.05, t1)), at(s0, o1, Math.max(0.05, t0))], GRANITE);
    }
    // arcade wall from the top of the climb to the south abutment: piers with round-arched openings
    const wallLen = sAbutS - 2 - sArc;
    if (wallLen > 6) {
      const top = VD.deck + VD.roadY - SLAB - 0.02;
      const nA = Math.max(1, Math.round(wallLen / 5.6));
      const pitch = wallLen / nA;
      const holes: [number, number][][] = [];
      for (let k = 0; k < nA; k++) {
        const c = (k + 0.5) * pitch, r = Math.min(1.7, pitch * 0.3), spring = top - 1.0 - r;
        const pts: [number, number][] = [[c - r, 0.05], [c + r, 0.05], [c + r, spring]];
        for (let j = 1; j < 10; j++) { const t = (j / 10) * Math.PI; pts.push([c + Math.cos(t) * r, spring + Math.sin(t) * r]); }
        pts.push([c - r, spring]);
        holes.push(pts);
      }
      const o = side * (hw + 0.4);
      const origin = at(sArc, o, 0);
      const normal: [number, number] = [right[0] * side, right[1] * side];
      // the shape's u runs along `dir` for both sides; the winding is fixed by the normal
      g.shape(origin, dir, normal, [[0, 0], [wallLen, 0], [wallLen, top], [0, top]], holes, GRANITE);
      colliders.push({ ring: [[origin[0], origin[2]], [origin[0] + dir[0] * wallLen, origin[2] + dir[1] * wallLen], [origin[0] + dir[0] * wallLen + normal[0] * 0.6, origin[2] + dir[1] * wallLen + normal[1] * 0.6], [origin[0] + normal[0] * 0.6, origin[2] + normal[1] * 0.6]], y0: 0, y1: top });
    }
  }
  // abutments (granite blocks on the sidewalks) and the steel arch: two ribs under the ribbon's edges,
  // spandrel posts every 3 m, cross ties between the ribs
  const springY = 2.6, crownY = DECK_TOP - SLAB - 0.08;
  for (const [sA, sB] of [[sAbutS - 2.2, sAbutS], [sAbutN, sAbutN + 2.2]]) {
    g.hexa([at(sA, -hw - 0.6, -0.3), at(sB, -hw - 0.6, -0.3), at(sB, hw + 0.6, -0.3), at(sA, hw + 0.6, -0.3)], [at(sA, -hw - 0.6, springY + 0.6), at(sB, -hw - 0.6, springY + 0.6), at(sB, hw + 0.6, springY + 0.6), at(sA, hw + 0.6, springY + 0.6)], GRANITE);
    colliders.push({ ring: [[at(sA, -hw - 0.6, 0)[0], at(sA, -hw - 0.6, 0)[2]], [at(sB, -hw - 0.6, 0)[0], at(sB, -hw - 0.6, 0)[2]], [at(sB, hw + 0.6, 0)[0], at(sB, hw + 0.6, 0)[2]], [at(sA, hw + 0.6, 0)[0], at(sA, hw + 0.6, 0)[2]]], y0: 0, y1: springY + 0.6 });
  }
  const archY = (s: number) => crownY - (crownY - springY) * ((s - s42) / halfSpan) ** 2;
  const nSeg = 14;
  for (const off of [-hw + 0.4, hw - 0.4]) {
    for (let i = 0; i < nSeg; i++) {
      const s0 = sAbutS + (i / nSeg) * 2 * halfSpan, s1 = sAbutS + ((i + 1) / nSeg) * 2 * halfSpan;
      const y0 = archY(s0), y1 = archY(s1);
      g.hexa([at(s0, off - 0.3, y0 - 0.45), at(s1, off - 0.3, y1 - 0.45), at(s1, off + 0.3, y1 - 0.45), at(s0, off + 0.3, y0 - 0.45)], [at(s0, off - 0.3, y0 + 0.25), at(s1, off - 0.3, y1 + 0.25), at(s1, off + 0.3, y1 + 0.25), at(s0, off + 0.3, y0 + 0.25)], STEEL, { bottom: true });
    }
    for (let s = sAbutS + 3; s < sAbutN - 1; s += 3) {
      const y = archY(s) + 0.2;
      if (crownY - y < 0.4) continue;
      g.hexa([at(s - 0.15, off - 0.15, y), at(s + 0.15, off - 0.15, y), at(s + 0.15, off + 0.15, y), at(s - 0.15, off + 0.15, y)], [at(s - 0.15, off - 0.15, crownY + 0.05), at(s + 0.15, off - 0.15, crownY + 0.05), at(s + 0.15, off + 0.15, crownY + 0.05), at(s - 0.15, off + 0.15, crownY + 0.05)], STEEL_DARK);
    }
  }
  for (let s = sAbutS + 3; s < sAbutN - 1; s += 6) {
    const y = archY(s) - 0.35;
    g.hexa([at(s - 0.12, -hw + 0.4, y - 0.12), at(s + 0.12, -hw + 0.4, y - 0.12), at(s + 0.12, hw - 0.4, y - 0.12), at(s - 0.12, hw - 0.4, y - 0.12)], [at(s - 0.12, -hw + 0.4, y + 0.12), at(s + 0.12, -hw + 0.4, y + 0.12), at(s + 0.12, hw - 0.4, y + 0.12), at(s - 0.12, hw - 0.4, y + 0.12)], STEEL_DARK, { bottom: true });
  }

  // ---- the deck fanning out from the junction to the two roadways in front of the terrace ---------------------
  {
    const [, vJ] = F.toLocal(ramp[1][0], ramp[1][1]);
    const fan = ccwRing([P(uJ - 0.4, vJ - hw, 0), P(uJ - 0.4, vJ + hw, 0), P(-5.3, vJ + 12.5, 0), P(-5.3, vJ - 12.5, 0)].map((p) => [p[0], p[2]] as Pt));
    g.prism(fan, DECK_TOP - SLAB, DECK_TOP - 0.02, STEEL, ASPHALT);
    decks.push({ ring: fan, height: DECK_TOP - 0.02 });
  }

  return { body: g, colliders, center: VD.center, decks };
}
