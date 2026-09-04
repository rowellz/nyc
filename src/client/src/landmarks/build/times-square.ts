/**
 * Times Square: One Times Square (the 111 m wedge wrapped in LED from the 3rd floor to the roof, with the
 * ball-drop pole), the two curved 4 Times Square corner screens (Nasdaq at 43rd) and the TKTS red-glass
 * amphitheater at Duffy Square with the Father Duffy memorial in front of it.
 */
import * as THREE from 'three';
import { Frame, GeoBuilder, GRID_BEARING, ROOF, centroid, circle, type StyleSpec } from '../geom';
import { FIFTEEN_HUNDRED_CORNER, FOUR_TS_CORNER, NASDAQ, ONE_TIMES_SQUARE, PARAMOUNT, TKTS } from '../data';
import { MARKET_CELL, ScreenBuilder, edgeNormal, facadeScreen, rng } from '../screens';
import { STYLE } from '../materials';
import { inscribe } from '../letters';
import type { Ring } from '@shared/world';

const GRANITE: StyleSpec = { style: STYLE.GRANITE, p: [0, 0, 0, 0], p2: [0, 0, 0, 0] };
const BRONZE: StyleSpec = { style: STYLE.BRONZE, p: [0, 0, 0, 0], p2: [0, 0, 0, 0] };
const STEEL: StyleSpec = { style: STYLE.PAINT, p: [0.55, 0.56, 0.58, 0.4], p2: [0, 0, 0, 0] };

/**
 * The screen compositor handles the surrounding buildings; this BIN's massing is replaced too. The wrap is the
 * tower's signature from Duffy Square: a dense stack of panels on every face (the long 7th Ave and Broadway
 * flanks carry two columns of screens per tier, the narrow north tip a single column), 0.35 m dark frames
 * between them, from the 3rd floor to just under the roof.
 */
export function buildOneTimesSquare(footprint: Ring = ONE_TIMES_SQUARE.footprint) {
  const body = new GeoBuilder();
  const screens = new ScreenBuilder();
  const o = ONE_TIMES_SQUARE;
  const wall: StyleSpec = { style: STYLE.DARKBRICK, p: [3.6, 2.4, 1.1, 1.8], p2: [0, 0.2, 0, 0] };
  body.prism(footprint, 0, o.height, wall, ROOF);
  // parapet + rooftop mechanical box
  const c = centroid(footprint);
  body.walls(footprint, o.height, o.height + 1.2, { style: STYLE.PLAIN, p: [0.3, 0.28, 0.27, 0], p2: [0, 0, 0, 0] });
  body.box(c[0], o.height + 1.5, c[1], 6, 3, 5, Frame.fromBearing(0, 0, GRID_BEARING).angle, { style: STYLE.PLAIN, p: [0.35, 0.35, 0.36, 0], p2: [0, 0, 0, 0] });
  // ball-drop pole on the north tip: 23.5 m mast with the 3.7 m crystal ball parked at the top
  const tip = footprint.reduce((best, p) => (p[1] < best[1] ? p : best), footprint[0]);
  const px = tip[0] + (c[0] - tip[0]) * 0.25, pz = tip[1] + (c[1] - tip[1]) * 0.25;
  body.cylinder(px, pz, o.height, o.height + o.poleH, 0.45, 0.25, 8, STEEL, { cap: STEEL });
  const ball: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.95, 0.8, 0], p2: [2.2, 0.85, 0, 0] };
  const by = o.height + o.poleH - 2.0, R = 1.85;
  const rings = [-1, -0.6, -0.2, 0.2, 0.6, 1].map((t) => ({ y: by + t * R, r: Math.max(0.15, Math.sqrt(Math.max(0, 1 - t * t)) * R) }));
  for (let i = 0; i + 1 < rings.length; i++) body.loft(circle(px, pz, rings[i].r, 10), rings[i].y, circle(px, pz, rings[i + 1].r, 10), rings[i + 1].y, ball, { cap: i === rings.length - 2 ? ball : null });
  // LED wrap: stacked billboards on every face wider than 2.5 m, from the 3rd floor to just below the roof
  const rand = rng(o.bin);
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 2.5) continue;
    const n = edgeNormal(footprint, i);
    const long = len > 12;
    const margin = len > 8 ? 0.45 : 0.2;
    let y = o.screenY0;
    let j = 0;
    while (y < o.screenY1 - 2.5) {
      const ph = Math.min(o.screenY1 - y, long ? 7 + rand() * 6 : 4.5 + rand() * 4.5);
      const type = j % 3 === 2 ? 2 : 0;
      if (long && rand() < 0.65) {
        // two screens side by side, the split off-centre so the tiers do not line up
        const gap = 0.5, w1 = (len - 2 * margin - gap) * (0.38 + rand() * 0.24);
        screens.add(facadeScreen(a, b, n, margin, margin + w1, y, y + ph, 0.45, (i * 5 + j * 3) % 16, type, 0.7 + rand() * 0.6, rand()));
        screens.add(facadeScreen(a, b, n, margin + w1 + gap, len - margin, y, y + ph, 0.45, (i * 5 + j * 3 + 9) % 16, type, 0.7 + rand() * 0.6, rand()));
      } else {
        screens.add(facadeScreen(a, b, n, margin, len - margin, y, y + ph, 0.45, (i * 5 + j * 3) % 16, type, 0.7 + rand() * 0.6, rand()));
      }
      y += ph + 0.35;
      j++;
    }
  }
  return { body, screens, center: c, colliders: [{ ring: footprint, y0: 0, y1: o.height }] };
}

/**
 * The curved screens of the east side: the two rounded Broadway corners of 4 Times Square (Nasdaq MarketSite at
 * 43rd, the 42nd corner wrap) and the big wrap around 1500 Broadway's corner at 44th.
 */
export function buildNasdaq() {
  const screens = new ScreenBuilder();
  const n = NASDAQ;
  screens.addArc(n.cx, n.cz, n.r, n.a0, n.a1, n.y0, n.y1, MARKET_CELL, 0, 0.8, 0);
  const f = FOUR_TS_CORNER;
  screens.addArc(f.cx, f.cz, f.r, f.a0, f.a1, f.y0, f.y1, 9, 0, 0.7, 0.4);
  const k = FIFTEEN_HUNDRED_CORNER;
  screens.addArc(k.cx, k.cz, k.r, k.a0, k.a1, k.y0, k.y1, 3, 3, 0.75, 0.6);
  return { body: new GeoBuilder(), screens, center: [n.cx, n.cz] as [number, number], colliders: [] };
}

/**
 * Paramount Building: the full-block base, the symmetrical stepped setbacks climbing to the slender tower (the
 * crown floodlit at night), the four-faced clock (lit face, numerals, hands) and the glass globe on the lantern.
 */
export function buildParamount(footprint: Ring = PARAMOUNT.footprint) {
  const body = new GeoBuilder();
  const P = PARAMOUNT;
  const f = Frame.fromBearing(P.ox, P.oz, P.bearing);
  const wall: StyleSpec = { style: STYLE.LIMESTONE, p: [3.65, 3.4, 1.8, 2.3], p2: [0.6, 0.35, 0.3, 0] };
  // the crown above the 66 m setback is uplit from the terraces
  const crown: StyleSpec = { style: STYLE.LIMESTONE, p: [3.65, 3.4, 1.8, 2.3], p2: [0.6, 0.3, 1.1, 0] };
  const crownPlain: StyleSpec = { style: STYLE.LIMESTONE, p: [3.65, 3.4, 0, 0], p2: [0.6, 0, 1.1, 0] };
  const trim: StyleSpec = { style: STYLE.PLAIN, p: [0.62, 0.58, 0.5, 0], p2: [0, 0, 0, 0] };
  const face: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.97, 0.85, 0], p2: [2.3, 0.9, 0, 0] };
  const bezel: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.72, 0.32, 0], p2: [1.9, 0.9, 0, 0] };
  const hand: StyleSpec = { style: STYLE.PLAIN, p: [0.08, 0.08, 0.09, 0], p2: [0, 0, 0, 0] };
  const glass: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.98, 0.9, 0], p2: [2.0, 0.85, 0, 0] };
  body.prism(footprint, 0, P.base, wall, ROOF);
  const colliders: { ring: Ring; y0: number; y1: number }[] = [{ ring: footprint, y0: 0, y1: P.base }];
  for (const [w, d, y0, y1, vc] of P.setbacks) {
    const c = f.toWorld(0, vc);
    body.box(c[0], (y0 + y1) / 2, c[1], w, y1 - y0, d, f.angle, y0 >= 66 ? crown : wall, ROOF);
    // a light cornice line on every setback
    body.box(c[0], y1 + 0.3, c[1], w + 0.8, 0.6, d + 0.8, f.angle, trim, trim, trim);
  }
  // clock block: four lit faces with numerals and hands, on the tower top
  const ck = P.clock;
  const cc = f.toWorld(0, ck.v);
  body.box(cc[0], (ck.y0 + ck.y1) / 2, cc[1], ck.size, ck.y1 - ck.y0, ck.size, f.angle, crownPlain, trim);
  const yc = (ck.y0 + ck.y1) / 2;
  const dirs: [number, number][] = [[f.ux, f.uz], [-f.ux, -f.uz], [f.vx, f.vz], [-f.vx, -f.vz]];
  const disc = (cx: number, cz: number, nx: number, nz: number, r: number, s: StyleSpec) => {
    // tangent along the face
    const tx = -nz, tz = nx;
    const seg = 20;
    const centre = body.vertex(cx, yc, cz, nx, 0, nz, 0.5, 0.5, s);
    const rim: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      rim.push(body.vertex(cx + tx * Math.cos(a) * r, yc + Math.sin(a) * r, cz + tz * Math.cos(a) * r, nx, 0, nz, 0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), s));
    }
    // (tangent x up) = -normal for tangent (-nz, nx), so the outward-facing fan is (centre, b, a)
    for (let k = 0; k < seg; k++) body.tri(centre, rim[(k + 1) % seg], rim[k]);
  };
  for (const [nx, nz] of dirs) {
    const tx = -nz, tz = nx;
    disc(cc[0] + nx * (ck.size / 2 + 0.1), cc[1] + nz * (ck.size / 2 + 0.1), nx, nz, ck.r + 0.45, bezel);
    const cx = cc[0] + nx * (ck.size / 2 + 0.15), cz = cc[1] + nz * (ck.size / 2 + 0.15);
    disc(cx, cz, nx, nz, ck.r, face);
    const angle = Math.atan2(tz, tx);
    // numerals as dark blocks around the dial, the hands at 10:10 just in front of the face
    const hx = cx + nx * 0.12, hz = cz + nz * 0.12;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const rr = ck.r * 0.82;
      body.box(hx + tx * Math.cos(a) * rr, yc + Math.sin(a) * rr, hz + tz * Math.cos(a) * rr, k % 3 === 0 ? 0.5 : 0.32, k % 3 === 0 ? 0.55 : 0.36, 0.12, angle, hand, hand, hand);
    }
    for (const [len, rot] of [[ck.r * 0.55, 1.05], [ck.r * 0.8, -0.35]]) {
      const mx = hx + tx * Math.cos(rot) * len * 0.5, mz = hz + tz * Math.cos(rot) * len * 0.5;
      body.box(mx, yc + Math.sin(rot) * len * 0.5, mz, len, 0.35, 0.15, angle, hand, hand, hand);
    }
  }
  // lantern drum and the globe
  const drum = f.toWorld(0, ck.v);
  body.cylinder(drum[0], drum[1], ck.y1, ck.y1 + 4.5, 3.2, 2.6, 12, crownPlain, { cap: trim });
  const g = P.globe;
  const rings = [-1, -0.7, -0.4, 0, 0.4, 0.7, 1].map((t) => ({ y: g.y + t * g.r, r: Math.max(0.2, Math.sqrt(Math.max(0, 1 - t * t)) * g.r) }));
  for (let i = 0; i + 1 < rings.length; i++) body.loft(circle(drum[0], drum[1], rings[i].r, 12), rings[i].y, circle(drum[0], drum[1], rings[i + 1].r, 12), rings[i + 1].y, glass, { cap: i === rings.length - 2 ? glass : null });
  return { body, center: [P.ox + f.vx * -30, P.oz + f.vz * -30] as [number, number], colliders };
}

/**
 * TKTS: 27 red-glass steps rising 4.9 m from the Duffy statue (south) to 47th St (north) across the whole
 * footprint, lit from within at night (risers and the stepped side walls brightest, treads a little dimmer), the
 * ticket booth tucked under the top landing with the "TKTS" letters on its 47th St face, and the Father Duffy
 * memorial (granite Celtic cross, plinth and bronze figure) on the axis in front of the bottom step.
 */
export function buildTkts(footprint: Ring = TKTS.footprint) {
  const body = new GeoBuilder();
  const c = centroid(footprint);
  const f = Frame.fromBearing(c[0], c[1], GRID_BEARING);
  const b = f.bounds(footprint);
  // glow factors stay near 1.0: the REDGLASS emissive desaturates to pink above ~1.1 through the tone curve
  const red: StyleSpec = { style: STYLE.REDGLASS, p: [0, 0, 0, 0], p2: [1.15, 0, 0, 0] };
  const side: StyleSpec = { style: STYLE.REDGLASS, p: [0, 0, 0, 0], p2: [1.05, 0, 0, 0] };
  const tread: StyleSpec = { style: STYLE.REDGLASS, p: [0, 0, 0, 0], p2: [0.8, 0, 0, 0] };
  const glass: StyleSpec = { style: STYLE.GLASS, p: [3, 1.2, 0.6, 0], p2: [0, 0.9, 0, 0] };
  const letters: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.12, 0.08, 0], p2: [2.2, 0.6, 0, 0] };
  const colliders: { ring: Ring; y0: number; y1: number }[] = [];
  const P = (u: number, v: number, y: number) => {
    const w = f.toWorld(u, v);
    return new THREE.Vector3(w[0], y, w[1]);
  };
  const steps = TKTS.steps;
  const landing = 2.2; // top landing at the 47th St end
  const u0 = b.u0, u1 = b.u1 - landing;
  const treadD = (u1 - u0) / steps;
  const rise = TKTS.rise / steps;
  // glass side walls (the stepped profile) as one polygon each, so the steps read as a solid wedge from the side
  for (const [v, sign] of [[b.v0, -1], [b.v1, 1]] as [number, number][]) {
    const pts: THREE.Vector3[] = [P(u0, v, 0)];
    for (let i = 0; i < steps; i++) {
      const ua = u0 + treadD * i, ub = u0 + treadD * (i + 1);
      pts.push(P(ua, v, rise * (i + 1)), P(ub, v, rise * (i + 1)));
    }
    pts.push(P(b.u1, v, TKTS.rise), P(b.u1, v, 0));
    // fan from the bottom-front corner; winding by side
    for (let i = 1; i + 1 < pts.length; i++) {
      const [q1, q2] = sign > 0 ? [pts[i + 1], pts[i]] : [pts[i], pts[i + 1]];
      const n = new THREE.Vector3().subVectors(q1, pts[0]).cross(new THREE.Vector3().subVectors(q2, pts[0])).normalize();
      const i0 = body.vertex(pts[0].x, pts[0].y, pts[0].z, n.x, n.y, n.z, 0, 0, side);
      const i1 = body.vertex(q1.x, q1.y, q1.z, n.x, n.y, n.z, 1, 0, side);
      const i2 = body.vertex(q2.x, q2.y, q2.z, n.x, n.y, n.z, 1, 1, side);
      body.tri(i0, i1, i2);
    }
  }
  // treads + risers
  for (let i = 0; i < steps; i++) {
    const ua = u0 + treadD * i, ub = u0 + treadD * (i + 1);
    const y = rise * (i + 1);
    body.quad3(P(ua, b.v0, y), P(ua, b.v1, y), P(ub, b.v1, y), P(ub, b.v0, y), tread, [0, 0, b.v1 - b.v0, treadD]);
    body.quad3(P(ua, b.v0, y - rise), P(ua, b.v1, y - rise), P(ua, b.v1, y), P(ua, b.v0, y), red, [0, 0, b.v1 - b.v0, rise]);
    colliders.push({ ring: f.rect(ua, ub, b.v0, b.v1), y0: 0, y1: y });
  }
  // top landing + the north (47th St) face: the booth's glass front under the red top rail, the TKTS letters on it
  body.quad3(P(u1, b.v0, TKTS.rise), P(u1, b.v1, TKTS.rise), P(b.u1, b.v1, TKTS.rise), P(b.u1, b.v0, TKTS.rise), tread, [0, 0, b.v1 - b.v0, landing]);
  body.quad3(P(b.u1, b.v1, 0), P(b.u1, b.v0, 0), P(b.u1, b.v0, TKTS.rise - 0.6), P(b.u1, b.v1, TKTS.rise - 0.6), glass, [0, 0, b.v1 - b.v0, TKTS.rise - 0.6]);
  body.quad3(P(b.u1, b.v1, TKTS.rise - 0.6), P(b.u1, b.v0, TKTS.rise - 0.6), P(b.u1, b.v0, TKTS.rise), P(b.u1, b.v1, TKTS.rise), red, [0, 0, b.v1 - b.v0, 0.6]);
  colliders.push({ ring: f.rect(u1, b.u1, b.v0, b.v1), y0: 0, y1: TKTS.rise });
  {
    // seen from 47th (facing south) the reading direction is west, i.e. -v
    const origin = P(b.u1, (b.v0 + b.v1) / 2, TKTS.rise - 1.35);
    inscribe(body, origin, new THREE.Vector3(-f.vx, 0, -f.vz), new THREE.Vector3(f.ux, 0, f.uz), 'TKTS', 0.85, letters, { proud: 0.06 });
  }
  // the front riser of the first step is covered by the loop; the bottom-most riser sits on the plaza.
  // Father Duffy memorial on the axis south of the steps: granite plinth, tall Celtic cross, bronze figure
  const vm = (b.v0 + b.v1) / 2;
  const du = u0 - TKTS.duffyOffset;
  const ang = f.angle;
  const d = f.toWorld(du, vm);
  body.box(d[0], 0.7, d[1], 3.6, 1.4, 2.6, ang, GRANITE, GRANITE);
  colliders.push({ ring: f.rect(du - 1.8, du + 1.8, vm - 1.3, vm + 1.3), y0: 0, y1: 1.4 });
  const cross = f.toWorld(du + 1.0, vm);
  body.box(cross[0], 1.4 + 2.6, cross[1], 0.7, 5.2, 1.1, ang, GRANITE, GRANITE);
  body.box(cross[0], 1.4 + 3.7, cross[1], 0.7, 0.9, 3.2, ang, GRANITE, GRANITE);
  const fig = f.toWorld(du - 0.4, vm);
  body.cylinder(fig[0], fig[1], 1.4, 3.3, 0.5, 0.42, 8, BRONZE, { cap: BRONZE });
  body.cylinder(fig[0], fig[1], 3.3, 3.7, 0.28, 0.2, 8, BRONZE, { cap: BRONZE });
  body.cylinder(fig[0], fig[1], 3.7, 4.0, 0.2, 0.05, 8, BRONZE, { cap: BRONZE });
  return { body, center: c, colliders };
}
