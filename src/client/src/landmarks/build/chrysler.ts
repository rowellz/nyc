/**
 * Chrysler Building (1930), 318.9 m. Real footprint from the tiles; white glazed brick tower with dark brick
 * bands, setbacks at 5, 16, 24, 31, the 61st-floor eagles, the stainless terraced crown of seven radiating
 * arches with triangular windows (lit white at night), and the needle spire.
 */
import { Frame, GeoBuilder, ROOF, GRID_BEARING, centroid, notchedRect, type StyleSpec } from '../geom';
import { STYLE } from '../materials';
import { CHRYSLER } from '../data';
import type { Ring } from '@shared/world';

const BRICK: StyleSpec = { style: STYLE.CHRYSLER, p: [3.6, 2.4, 1.45, 2.0], p2: [1.6, 0.33, 0, 0] };
const BRICK_LIT: StyleSpec = { style: STYLE.CHRYSLER, p: [3.6, 2.4, 1.45, 2.0], p2: [1.6, 0.33, 1, 0] };
const STAINLESS: StyleSpec = { style: STYLE.STAINLESS, p: [0, 0, 0, 0], p2: [0, 0, 1, 0] };
const DARKBAND: StyleSpec = { style: STYLE.PAINT, p: [0.2, 0.19, 0.2, 0.6], p2: [0, 0, 0, 0] };
const WINDOW_LIGHT: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.98, 0.92, 0], p2: [3.0, 1.0, 0, 0] };
const RED_BEACON: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.08, 0.05, 0], p2: [5.0, 0.85, 1.0, 0.3] };

export function buildChrysler(footprint: Ring = CHRYSLER.footprint): { body: GeoBuilder; colliders: { ring: Ring; y0: number; y1: number }[]; center: [number, number] } {
  const c = centroid(footprint);
  const F = Frame.fromBearing(c[0], c[1], GRID_BEARING);
  const b = F.bounds(footprint);
  const g = new GeoBuilder();
  const colliders: { ring: Ring; y0: number; y1: number }[] = [];

  // base: the real footprint, 4 tall showroom floors
  g.prism(footprint, 0, 20, { ...BRICK, p: [4.6, 2.4, 1.6, 3.0], p2: [1.0, 0.5, 0, 0] }, ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: 20 });
  // setbacks 5-15, 16-23, 24-30
  const s1 = F.rect(b.u0 + 3, b.u1 - 3, b.v0 + 3, b.v1 - 3);
  g.prism(s1, 20, 62, BRICK, ROOF);
  colliders.push({ ring: s1, y0: 20, y1: 62 });
  const s2 = F.rect(b.u0 + 7, b.u1 - 7, b.v0 + 7, b.v1 - 7);
  g.prism(s2, 62, 92, BRICK, ROOF);
  const s3 = F.rect(b.u0 + 11, b.u1 - 11, b.v0 + 11, b.v1 - 11);
  g.prism(s3, 92, 118, BRICK, ROOF);
  // 31st floor: the dark frieze with the hubcap ornaments + the winged radiator caps at the corners
  const cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2;
  const shaftHalf = 17;
  g.prism(F.rect(cu - shaftHalf - 0.15, cu + shaftHalf + 0.15, cv - shaftHalf - 0.15, cv + shaftHalf + 0.15), 116.4, 118.2, DARKBAND, null);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const p = F.toWorld(cu + su * (shaftHalf - 0.2), cv + sv * (shaftHalf - 0.2));
    g.box(p[0], 119.5, p[1], 3.2, 3.0, 3.2, F.angle, STAINLESS, STAINLESS);
  }
  // main shaft 31-60 with notched corners
  const shaft = notchedRect(F, cu - shaftHalf, cu + shaftHalf, cv - shaftHalf, cv + shaftHalf, 3, 3);
  g.prism(shaft, 118, 240, BRICK, ROOF);
  // 61st floor band (eagle floor) and the eagles
  const crownBase = F.rect(cu - 15.5, cu + 15.5, cv - 15.5, cv + 15.5);
  g.prism(crownBase, 240, 246, BRICK_LIT, ROOF);
  buildEagles(g, F, cu, cv, 15.5, 243.5);

  // --- the crown: 7 tiers of crossed barrel vaults (arches on all four faces) with radiating triangular windows
  const tiers: { s: number; y: number; stem: number; n: number }[] = [
    { s: 30, y: 246, stem: 2.2, n: 8 },
    { s: 25.5, y: 252, stem: 2.0, n: 7 },
    { s: 21.5, y: 257.5, stem: 1.8, n: 7 },
    { s: 18, y: 262.5, stem: 1.6, n: 6 },
    { s: 14.5, y: 267, stem: 1.4, n: 5 },
    { s: 11.5, y: 271, stem: 1.2, n: 4 },
    { s: 8.5, y: 274.5, stem: 1.0, n: 3 },
  ];
  for (const t of tiers) {
    barrelVault(g, F, cu, cv, t.s, t.y, t.stem, 'u', STAINLESS);
    barrelVault(g, F, cu, cv, t.s, t.y, t.stem, 'v', STAINLESS);
    triangularWindows(g, F, cu, cv, t.s, t.y, t.stem, t.n);
  }
  // spire 281 -> 319
  const sx = F.toWorld(cu, cv);
  g.cylinder(sx[0], sx[1], 280.5, 296, 2.4, 1.1, 8, STAINLESS, { cap: null });
  g.cylinder(sx[0], sx[1], 296, 318.9, 1.1, 0.25, 8, STAINLESS, { cap: STAINLESS });
  g.cylinder(sx[0], sx[1], 318.9, 319.8, 0.4, 0.4, 6, RED_BEACON, { cap: RED_BEACON });
  return { body: g, colliders, center: [c[0], c[1]] };
}

/** a half-cylinder vault of span s along one frame axis, sitting on a stem of height `stem`, arch faces at both ends */
function barrelVault(g: GeoBuilder, F: Frame, cu: number, cv: number, s: number, y0: number, stem: number, axis: 'u' | 'v', st: StyleSpec): void {
  const r = s / 2;
  const N = 14;
  // profile in (w, h): w across the vault, h above y0
  const prof: [number, number][] = [[-r, 0], [-r, stem]];
  for (let i = 1; i < N; i++) {
    const a = Math.PI - (i / N) * Math.PI;
    prof.push([Math.cos(a) * r, stem + Math.sin(a) * r]);
  }
  prof.push([r, stem], [r, 0]);
  const toW = (along: number, w: number): [number, number] => (axis === 'u' ? F.toWorld(cu + along, cv + w) : F.toWorld(cu + w, cv + along));
  // normals for the profile edges (outward = away from the axis line)
  const rows: number[][] = [];
  for (let k = 0; k + 1 < prof.length; k++) {
    const [w0, h0] = prof[k], [w1, h1] = prof[k + 1];
    // 2D outward normal of the profile segment
    let nw = h1 - h0, nh = -(w1 - w0);
    const nl = Math.hypot(nw, nh) || 1;
    nw /= nl;
    nh /= nl;
    // ensure it points away from the profile centroid (0, stem*0.5)
    const mw = (w0 + w1) / 2, mh = (h0 + h1) / 2;
    if (nw * (mw - 0) + nh * (mh - stem * 0.5) < 0) {
      nw = -nw;
      nh = -nh;
    }
    const n3 = axis === 'u' ? [F.vx * nw, nh, F.vz * nw] : [F.ux * nw, nh, F.uz * nw];
    const row: number[] = [];
    for (const [w, h, along] of [[w0, h0, -r], [w1, h1, -r], [w1, h1, r], [w0, h0, r]] as [number, number, number][]) {
      const p = toW(along, w);
      row.push(g.vertex(p[0], y0 + h, p[1], n3[0], n3[1], n3[2], along + r, y0 + h, st));
    }
    rows.push(row);
    // winding: choose so the normal faces outward (check with cross product)
    const [a, b, c2, d] = row;
    const ax = g.pos[a * 3], ay = g.pos[a * 3 + 1], az = g.pos[a * 3 + 2];
    const bx = g.pos[b * 3], by = g.pos[b * 3 + 1], bz = g.pos[b * 3 + 2];
    const dx = g.pos[d * 3], dy = g.pos[d * 3 + 1], dz = g.pos[d * 3 + 2];
    const e1 = [bx - ax, by - ay, bz - az], e2 = [dx - ax, dy - ay, dz - az];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n3[0] + cr[1] * n3[1] + cr[2] * n3[2] > 0) g.quad(a, b, c2, d);
    else g.quad(a, d, c2, b);
  }
  // end faces (the arches), fan from the profile's bottom center
  for (const end of [-r, r]) {
    const n3 = axis === 'u' ? [F.ux * Math.sign(end), 0, F.uz * Math.sign(end)] : [F.vx * Math.sign(end), 0, F.vz * Math.sign(end)];
    const cp = toW(end, 0);
    const center = g.vertex(cp[0], y0, cp[1], n3[0], n3[1], n3[2], r, y0, st);
    const ids: number[] = [];
    for (const [w, h] of prof) {
      const p = toW(end, w);
      ids.push(g.vertex(p[0], y0 + h, p[1], n3[0], n3[1], n3[2], w + r, y0 + h, st));
    }
    for (let k = 0; k + 1 < ids.length; k++) {
      const a = ids[k], b = ids[k + 1];
      const ax = g.pos[a * 3], ay = g.pos[a * 3 + 1], az = g.pos[a * 3 + 2];
      const bx = g.pos[b * 3], by = g.pos[b * 3 + 1], bz = g.pos[b * 3 + 2];
      const cx = g.pos[center * 3], cy = g.pos[center * 3 + 1], cz = g.pos[center * 3 + 2];
      const e1 = [ax - cx, ay - cy, az - cz], e2 = [bx - cx, by - cy, bz - cz];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * n3[0] + cr[1] * n3[1] + cr[2] * n3[2] > 0) g.tri(center, a, b);
      else g.tri(center, b, a);
    }
  }
}

/** radiating triangular windows on the 4 arch faces of a tier, slightly proud of the face */
function triangularWindows(g: GeoBuilder, F: Frame, cu: number, cv: number, s: number, y0: number, stem: number, n: number): void {
  const r = s / 2;
  const faces: { axis: 'u' | 'v'; sign: number }[] = [
    { axis: 'u', sign: 1 },
    { axis: 'u', sign: -1 },
    { axis: 'v', sign: 1 },
    { axis: 'v', sign: -1 },
  ];
  for (const f of faces) {
    const off = r + 0.12;
    const toW = (w: number): [number, number] => (f.axis === 'u' ? F.toWorld(cu + f.sign * off, cv + w) : F.toWorld(cu + w, cv + f.sign * off));
    const n3 = f.axis === 'u' ? [F.ux * f.sign, 0, F.uz * f.sign] : [F.vx * f.sign, 0, F.vz * f.sign];
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.12 + (0.76 * (i + 0.5)) / n);
      const dirW = Math.cos(a), dirH = Math.sin(a);
      // triangle: apex near the arch rim, base toward the center
      const apexR = r * 0.9, baseR = r * 0.5, halfBase = Math.max(0.35, r * 0.075);
      const apex: [number, number] = [dirW * apexR, stem + dirH * apexR];
      const bc: [number, number] = [dirW * baseR, stem + dirH * baseR];
      const perp = [-dirH, dirW];
      const b1: [number, number] = [bc[0] + perp[0] * halfBase, bc[1] + perp[1] * halfBase];
      const b2: [number, number] = [bc[0] - perp[0] * halfBase, bc[1] - perp[1] * halfBase];
      const ids = [apex, b1, b2].map(([w, h]) => {
        const p = toW(w);
        return g.vertex(p[0], y0 + h, p[1], n3[0], n3[1], n3[2], w, y0 + h, WINDOW_LIGHT);
      });
      const [A, B, C] = ids;
      const ax = g.pos[A * 3], ay = g.pos[A * 3 + 1], az = g.pos[A * 3 + 2];
      const bx = g.pos[B * 3], by = g.pos[B * 3 + 1], bz = g.pos[B * 3 + 2];
      const cx = g.pos[C * 3], cy = g.pos[C * 3 + 1], cz = g.pos[C * 3 + 2];
      const e1 = [bx - ax, by - ay, bz - az], e2 = [cx - ax, cy - ay, cz - az];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * n3[0] + cr[1] * n3[1] + cr[2] * n3[2] > 0) g.tri(A, B, C);
      else g.tri(A, C, B);
    }
  }
}

/** eight stainless eagle gargoyles at the 61st-floor corners (two per corner, one per face) */
function buildEagles(g: GeoBuilder, F: Frame, cu: number, cv: number, half: number, y: number): void {
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    // eagle projecting along u from the corner, and one projecting along v
    for (const axis of ['u', 'v'] as const) {
      const sign = axis === 'u' ? su : sv;
      const along = (d: number): [number, number] => (axis === 'u' ? F.toWorld(cu + su * (half + d), cv + sv * (half - 1.4)) : F.toWorld(cu + su * (half - 1.4), cv + sv * (half + d)));
      const yaw = axis === 'u' ? F.angle : F.angleV;
      void sign;
      // body: box projecting 3.6 m
      const b0 = along(1.4), b1 = along(3.6);
      const c0 = [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2];
      g.box(c0[0], y, c0[1], 2.6, 1.3, 1.3, yaw, { style: STYLE.STAINLESS, p: [0, 0, 0, 0], p2: [0, 0, 0.6, 0] }, { style: STYLE.STAINLESS, p: [0, 0, 0, 0], p2: [0, 0, 0.6, 0] });
      // head at the outer end, a bit higher, with the beak
      const h = along(4.2);
      g.box(h[0], y + 0.85, h[1], 1.2, 1.1, 1.0, yaw, { style: STYLE.STAINLESS, p: [0, 0, 0, 0], p2: [0, 0, 0.6, 0] });
      const bk = along(4.95);
      g.box(bk[0], y + 0.6, bk[1], 0.6, 0.5, 0.5, yaw, { style: STYLE.STAINLESS, p: [0, 0, 0, 0], p2: [0, 0, 0.6, 0] });
      // swept-back wing plate on the outer side
      const w = along(2.2);
      g.box(w[0], y + 0.3, w[1], 3.0, 1.9, 0.3, yaw, { style: STYLE.STAINLESS, p: [0, 0, 0, 0], p2: [0, 0, 0.6, 0] });
    }
  }
}

