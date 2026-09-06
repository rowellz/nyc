/**
 * Elevated roadways (RoadSegment.bridge): deck ribbon at the layer height, ramping to ground at nodes
 * shared with ground-level roads and to whatever height its neighbours agreed on at nodes shared with
 * other decks, slab + fascia + parapet (Jersey barrier on highways, iron railing on old viaducts), piers
 * every 25 m, colliders. Tunnel portals for RoadSegment.tunnel ends.
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

// OSM `layer` is a stacking hint, not a survey: two spans of one continuous roadway are routinely tagged
// layer=1 and layer=2 (or 0 and 3) where they pass each other, and deckHeightFor turns that into a 6 m --
// on the Brooklyn Bridge an 11 m -- vertical cliff at the node they share. So a deck no longer decides its
// end heights alone: every deck meeting at a node agrees on one height there, and each ramps to its own
// crown from that. DECK_GRADE is the slope those ramps run at (the 1/12.5 the old rampLen implied).
const DECK_GRADE = 1 / 12.5;

/** does `r` end at (x, z)? (the 0.6 m node tolerance the rest of this file uses) */
function endsAt(r: RoadSegment, x: number, z: number): boolean {
  const a = r.pts[0], b = r.pts[r.pts.length - 1];
  return Math.hypot(a[0] - x, a[1] - z) < 0.6 || Math.hypot(b[0] - x, b[1] - z) < 0.6;
}

/**
 * The deck height every bridge meeting at this node has to share, so none of them steps. The lowest
 * wins: the spans either side then climb to their own crown over a ramp, where a taller node height
 * would have dumped the whole difference onto whichever span was shorter. Every deck at the node takes
 * the min over the same set (itself included), so they all arrive at the same number whatever order the
 * tiles are built in -- which matters, because neighbouring tiles profile the same segment separately.
 */
function nodeHeight(env: TileEnv, x: number, z: number, self: RoadSegment): number {
  let h = isGroundNode(env, x, z, self) ? 0 : deckHeightFor(self);
  if (h <= 0) return 0; // a street lands here: the deck has to come down to it
  for (const r of env.ctx.world.roadsNear(x, z, 3)) {
    if (r === self || r.id === self.id || !r.bridge || r.tunnel || r.pts.length < 2 || r.cls === 'steps') continue;
    if (!endsAt(r, x, z)) continue;
    // a footway deck and a roadway deck sharing a node are joined like any other pair -- one of them has
    // to move, and deckHeightFor giving footways their own heights is no reason to leave a step instead
    h = Math.min(h, isGroundNode(env, x, z, r) ? 0 : deckHeightFor(r));
    if (h <= 0) return 0;
  }
  return h;
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

/** deck half-width, crown height and height-along-arc-length: the profile buildBridges gives this segment. */
function deckProfile(env: TileEnv, r: RoadSegment): { hw: number; H: number; hAt: (s: number) => number } {
  const foot = !VEHICULAR.has(r.cls);
  const L = polylineLength(r.pts);
  const e = r.pts[r.pts.length - 1];
  const h0 = nodeHeight(env, r.pts[0][0], r.pts[0][1], r);
  const h1 = nodeHeight(env, e[0], e[1], r);
  let H = deckHeightFor(r);
  // A span that runs deck-to-deck cannot climb further than its own length allows, so a 17 m stub tagged
  // one layer up stays with its neighbours instead of humping 6 m and back. A span ramping from the ground
  // is exempt: it has to reach whatever it crosses, however short and steep the approach.
  if (h0 > 0 && h1 > 0) {
    const reach = DECK_GRADE * L * 0.5;
    H = Math.min(Math.max(H, Math.min(h0, h1) - reach), Math.max(h0, h1) + reach);
  }
  // Each end gets the run DECK_GRADE asks for, and when together they want more than the span has they
  // share it in proportion -- so an end already at the crown lends its half to the end that has to climb,
  // instead of the old fixed half-and-half packing an 11 m drop into 6 m. Two ends the same distance from
  // the crown (every span that ramps from the ground at both ends) split it evenly, exactly as before.
  let ramp0 = Math.abs(H - h0) / DECK_GRADE, ramp1 = Math.abs(H - h1) / DECK_GRADE;
  if (ramp0 + ramp1 > L) {
    const k = L / (ramp0 + ramp1);
    ramp0 *= k;
    ramp1 *= k;
  }
  return {
    hw: Math.max(foot ? 1.2 : 3.2, r.width / 2),
    H,
    // The ramps never overlap, so each end lands exactly on its node height and the crown holds through
    // whatever is left in the middle. Reduces to the old H * smooth(s/ramp) * smooth((L-s)/ramp)
    // whenever both ends sit on the ground.
    hAt: (s) => {
      const a = ramp0 > 0 ? smooth(s / ramp0) : 1;
      const b = ramp1 > 0 ? smooth((L - s) / ramp1) : 1;
      const h = H + (h0 - H) * (1 - a) + (h1 - H) * (1 - b);
      return h > 0 ? h : 0;
    },
  };
}

// A ramp and the motorway it merges with, or the two carriageways of one viaduct, arrive as separate
// RoadSegments whose decks all but touch. Built independently each grows its own parapet down the shared
// side, so the pair reads as two walls with an unreachable slot between them -- and those walls run
// straight through the node where the ramp is supposed to merge. These bound "the deck beside me is part
// of the same structure": close the gap to it and drop the wall.
const JOIN_GAP = 3.0; // widest edge-to-edge clearance still counted as one structure
const JOIN_DH = 1.2; // ...provided the two decks are at the same level, not stacked
const JOIN_PARALLEL = 0.5; // ...and running roughly along each other, not crossing
// A ramp does not always meet its motorway edge-on: at a gore it comes in steeply enough to fail
// JOIN_PARALLEL, and its deck edge ends up not beside the carriageway but out on it. The parapet that
// edge carries is then a wall standing across the lanes. Two decks this deep into each other at the same
// height are always one junction -- decks that truly cross are at different heights -- so past this depth
// the parallel test is dropped and the wall goes, whatever the angle.
const JOIN_OVER = 0.3; // how far inside the neighbour's half-width counts as "on it", not "beside it"

interface DeckNeighbour {
  seg: RoadSegment;
  bb: BBox;
  cum: number[];
  hw: number;
  hAt: (s: number) => number;
}

/** every vehicular deck this tile can see, profiled once, with a padded bbox for cheap rejection */
function deckNeighbours(env: TileEnv): DeckNeighbour[] {
  const { rect } = env;
  const cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2;
  const reach = Math.hypot(rect.maxX - cx, rect.maxZ - cz) + 48;
  const out: DeckNeighbour[] = [];
  const seen = new Set<number>();
  for (const r of env.ctx.world.roadsNear(cx, cz, reach)) {
    if (seen.has(r.id) || !r.bridge || r.tunnel || r.pts.length < 2 || !VEHICULAR.has(r.cls)) continue;
    seen.add(r.id);
    const { hw, hAt } = deckProfile(env, r);
    const pad = hw + JOIN_GAP;
    const bb: BBox = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    const cum = [0];
    for (let i = 0; i < r.pts.length; i++) {
      const [x, z] = r.pts[i];
      if (x - pad < bb.minX) bb.minX = x - pad;
      if (x + pad > bb.maxX) bb.maxX = x + pad;
      if (z - pad < bb.minZ) bb.minZ = z - pad;
      if (z + pad > bb.maxZ) bb.maxZ = z + pad;
      if (i > 0) cum.push(cum[i - 1] + Math.hypot(x - r.pts[i - 1][0], z - r.pts[i - 1][1]));
    }
    out.push({ seg: r, bb, cum, hw, hAt });
  }
  return out;
}

/** the deck (if any) whose own edge faces this deck edge closely enough to be the same structure */
function facingDeck(list: DeckNeighbour[], skipId: number, ex: number, ez: number, h: number, ux: number, uz: number): { gap: number; dot: number; id: number; over: boolean } | null {
  let best: { gap: number; dot: number; id: number; over: boolean } | null = null;
  for (const n of list) {
    if (n.seg.id === skipId) continue;
    const bb = n.bb;
    if (ex < bb.minX || ex > bb.maxX || ez < bb.minZ || ez > bb.maxZ) continue;
    const pts = n.seg.pts;
    let bd2 = Infinity, bs = 0, bdx = 1, bdz = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0], az = pts[i][1];
      const vx = pts[i + 1][0] - ax, vz = pts[i + 1][1] - az;
      const len2 = vx * vx + vz * vz;
      if (len2 < 1e-6) continue;
      let t = ((ex - ax) * vx + (ez - az) * vz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = ex - (ax + vx * t), dz = ez - (az + vz * t);
      const d2 = dx * dx + dz * dz;
      if (d2 < bd2) {
        bd2 = d2;
        const len = Math.sqrt(len2);
        bs = n.cum[i] + t * len;
        bdx = vx / len; bdz = vz / len;
      }
    }
    if (bd2 === Infinity) continue;
    const gap = Math.sqrt(bd2) - n.hw;
    if (gap > JOIN_GAP || (best && gap >= best.gap)) continue;
    if (Math.abs(n.hAt(bs) - h) > JOIN_DH) continue; // stacked decks (upper/lower level) are not neighbours
    const dot = ux * bdx + uz * bdz;
    const over = gap < -JOIN_OVER; // this edge is out on the neighbour's carriageway, not alongside it
    if (!over && Math.abs(dot) < JOIN_PARALLEL) continue; // a deck crossing at an angle still needs its wall
    best = { gap, dot, id: n.seg.id, over };
  }
  return best;
}

function inRect(r: BBox, x: number, z: number): boolean {
  return x >= r.minX + 0.05 && x < r.maxX - 0.05 && z >= r.minZ + 0.05 && z < r.maxZ - 0.05;
}

export function buildBridges(env: TileEnv, gb: GroundBuilder, sb: StructBuilder, out: BridgeOut): void {
  const { tile, rect } = env;
  const seen = new Set<number>();
  const low = env.ctx.quality.level === 'low';
  const joins = deckNeighbours(env);
  for (const r of tile.roads) {
    if (!r.bridge || r.tunnel || seen.has(r.id) || r.pts.length < 2) continue;
    seen.add(r.id);
    const foot = !VEHICULAR.has(r.cls);
    if (r.cls === 'steps') continue;
    const L = polylineLength(r.pts);
    if (L < 2) continue;
    // H is the crown deckProfile settled on, not deckHeightFor's raw layer height: the piers below follow it
    const { hw, H, hAt } = deckProfile(env, r);
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
      // Where another deck of the same structure faces an edge, walk that edge out to meet it (the
      // neighbour covers the other half of the gap) and remember not to wall the join off. Two decks
      // running against each other still keep one parapet between them -- the median barrier -- so only
      // the higher id gives up its own. Done before the collider copy below, which reads those vertices back.
      const joined: [boolean[], boolean[]] = [[], []];
      const walled: [boolean[], boolean[]] = [[], []];
      if (!foot) {
        for (let i = 0; i < d.pts.length; i++) {
          const a = d.pts[Math.max(0, i - 1)], b = d.pts[Math.min(d.pts.length - 1, i + 1)];
          const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const ux = (b[0] - a[0]) / tl, uz = (b[1] - a[1]) / tl;
          for (let k = 0; k < 2; k++) {
            const vi = (k === 0 ? left : right)[i];
            const ex = gb.pos[vi * 3], ez = gb.pos[vi * 3 + 2];
            const f = facingDeck(joins, r.id, ex, ez, hs[i], ux, uz);
            if (!f) continue;
            joined[k][i] = true;
            // the median between two opposed carriageways -- but never across a carriageway
            walled[k][i] = !f.over && f.dot < 0 && r.id < f.id;
            if (f.gap > 0.05) {
              const ox = ex - d.pts[i][0], oz = ez - d.pts[i][1];
              const ol = Math.hypot(ox, oz) || 1;
              const ext = f.gap * 0.5 + 0.1; // meet in the middle, with a little overlap to hide seams
              gb.pos[vi * 3] = ex + (ox / ol) * ext;
              gb.pos[vi * 3 + 2] = ez + (oz / ol) * ext;
            }
          }
        }
      }
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
        const joinL = joined[0][i] && joined[0][i + 1], joinR = joined[1][i] && joined[1][i + 1];
        // a fascia buried in the neighbouring slab is invisible and z-fights it
        if (!joinL) sb.face([Lt0, Lt1, Lb1, Lb0], fascia, fasciaMat);
        if (!joinR) sb.face([Rt1, Rt0, Rb0, Rb1], fascia, fasciaMat);
        sb.face([Lb0, Lb1, Rb1, Rb0], CONCRETE_DARK, 0);
        // parapet
        const dx = Lt1[0] - Lt0[0], dz = Lt1[2] - Lt0[2];
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        const rx = -uz, rz = ux; // right of travel (unit)
        for (const side of [-1, 1]) {
          const k = side < 0 ? 0 : 1;
          if ((joined[k][i] || joined[k][i + 1]) && !(walled[k][i] && walled[k][i + 1])) continue;
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
