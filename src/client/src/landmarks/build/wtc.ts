/**
 * One World Trade Center: 61 m square podium (glass fins) to 57 m, then the tower whose square base rotates
 * into a 45°-turned square at the 417 m roof (eight isosceles-triangle facets of reflective glass), the parapet,
 * and the 124 m spire with the beacon (541 m to the tip).
 */
import { Frame, GeoBuilder, ROOF, circle, type StyleSpec } from '../geom';
import { STYLE } from '../materials';
import { ONE_WTC } from '../data';
import type { Ring } from '@shared/world';

const GLASS: StyleSpec = { style: STYLE.GLASS, p: [4.0, 1.5, 1.0, 0], p2: [0, 0.3, 0, 0] };
const LOBBY: StyleSpec = { style: STYLE.GLASS, p: [6.0, 1.5, 0.75, 0], p2: [0, 0.9, 0, 0] };
const FINS: StyleSpec = { style: STYLE.FINS, p: [0, 0, 0, 0], p2: [0, 0, 0, 0] };
const STEEL: StyleSpec = { style: STYLE.PAINT, p: [0.66, 0.68, 0.72, 0.35], p2: [0, 0, 0, 0] };
const WHITE_RING: StyleSpec = { style: STYLE.EMISSIVE, p: [0.9, 0.95, 1.0, 0], p2: [1.6, 1.0, 0, 0] };
const BEACON: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 1.0, 1.0, 0], p2: [8.0, 0.7, 1.0, 0] };
const RED: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.1, 0.05, 0], p2: [4.0, 0.85, 0, 0] };

export function buildOneWTC(): { body: GeoBuilder; colliders: { ring: Ring; y0: number; y1: number }[]; center: [number, number] } {
  const W = ONE_WTC;
  const F = Frame.fromBearing(W.cx, W.cz, W.bearing);
  const g = new GeoBuilder();
  const hb = W.base / 2;
  const colliders: { ring: Ring; y0: number; y1: number }[] = [];

  // podium: lobby glass 0-16, fins 16-57
  const pod = F.rect(-hb, hb, -hb, hb);
  g.walls(pod, 0, 16, LOBBY);
  g.walls(pod, 16, W.podiumH, FINS);
  colliders.push({ ring: pod, y0: 0, y1: W.podiumH });
  // the podium's top is where the chamfers begin, no visible roof

  // tower: 16 planar triangles between the base square and the 45°-rotated top square
  const rBaseCorner = hb * Math.SQRT2, rBaseMid = hb;
  const rTopVertex = W.top / Math.SQRT2, rTopMid = W.top / 2;
  const basePt = (i: number): [number, number] => {
    const a = (i * Math.PI) / 4;
    const r = i % 2 === 1 ? rBaseCorner : rBaseMid;
    return F.toWorld(Math.cos(a) * r, Math.sin(a) * r);
  };
  const topPt = (i: number): [number, number] => {
    const a = (i * Math.PI) / 4;
    const r = i % 2 === 0 ? rTopVertex : rTopMid;
    return F.toWorld(Math.cos(a) * r, Math.sin(a) * r);
  };
  const y0 = W.podiumH, y1 = W.roofH;
  const tri = (p: [number, number, number][], style: StyleSpec) => {
    // normal from the triangle, forced outward (away from the tower axis)
    const [a, b, c] = p;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    n = n.map((v) => v / nl);
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const out = [cx - W.cx, 0, cz - W.cz];
    let flip = false;
    if (n[0] * out[0] + n[2] * out[2] < 0) {
      n = n.map((v) => -v);
      flip = true;
    }
    // facade uv: u along the horizontal in-plane direction, v = height
    const hx = -n[2], hz = n[0]; // horizontal, perpendicular to the normal
    const ids = p.map((q) => g.vertex(q[0], q[1], q[2], n[0], n[1], n[2], q[0] * hx + q[2] * hz, q[1], style));
    if (flip) g.tri(ids[0], ids[2], ids[1]);
    else g.tri(ids[0], ids[1], ids[2]);
  };
  for (let i = 0; i < 8; i++) {
    const bi = basePt(i), bj = basePt(i + 1), ti = topPt(i), tj = topPt(i + 1);
    const B = (p: [number, number]): [number, number, number] => [p[0], y0, p[1]];
    const T = (p: [number, number]): [number, number, number] => [p[0], y1, p[1]];
    if (i % 2 === 0) {
      // (M, C, T) side, (C, E, T) corner
      tri([B(bi), B(bj), T(ti)], GLASS);
      tri([B(bj), T(tj), T(ti)], GLASS);
    } else {
      // (C, M', T') side, (C, T', E) corner
      tri([B(bi), B(bj), T(tj)], GLASS);
      tri([B(bi), T(tj), T(ti)], GLASS);
    }
  }
  // roof: the rotated square, parapet, dark roof
  const topRing: Ring = [0, 2, 4, 6].map((i) => topPt(i));
  g.prism(topRing, y1, y1 + 1.6, GLASS, ROOF);

  // spire: platform, lower mast, rings, upper mast, beacon
  const sx = W.cx, sz = W.cz;
  g.cylinder(sx, sz, y1 + 1.6, y1 + 8, 8.5, 5.5, 8, STEEL, { cap: STEEL, yaw: Math.PI / 8 });
  g.cylinder(sx, sz, y1 + 8, 470, 3.2, 1.7, 8, STEEL, { cap: null, yaw: Math.PI / 8 });
  for (const [y, r] of [[438, 4.6], [455, 4.0], [470, 3.4]] as [number, number][]) {
    g.cylinder(sx, sz, y, y + 1.1, r, r, 12, STEEL, { cap: STEEL });
    g.cylinder(sx, sz, y + 1.1, y + 1.5, r * 0.92, r * 0.92, 12, WHITE_RING, { cap: null });
  }
  g.cylinder(sx, sz, 470, 520, 1.5, 0.7, 8, STEEL, { cap: null });
  g.cylinder(sx, sz, 520, W.spireTop, 0.7, 0.25, 8, STEEL, { cap: STEEL });
  g.cylinder(sx, sz, W.spireTop, W.spireTop + 1.4, 0.7, 0.7, 8, BEACON, { cap: BEACON });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.cylinder(sx + Math.cos(a) * 4.8, sz + Math.sin(a) * 4.8, 471.6, 472.3, 0.35, 0.35, 6, RED, { cap: RED });
  }
  void circle;
  return { body: g, colliders, center: [W.cx, W.cz] };
}
