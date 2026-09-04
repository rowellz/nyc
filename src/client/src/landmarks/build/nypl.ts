/**
 * New York Public Library, Stephen A. Schwarzman Building (1911). Beaux-Arts Vermont-marble block on 5th Ave:
 * the raised terrace with its urn balustrade and the three-stage stair (plaza -> terrace between the lions,
 * terrace -> porch, porch -> portico between the column pedestals), the central pavilion with three 3.2 m deep
 * barrel-vaulted portals behind archivolts and paired fluted Corinthian columns on pedestals, the dentilled
 * entablature and the attic with its six standing figures, the wings with tall round-arched windows in real
 * 0.9 m reveals between proud pilasters over a rusticated base, the lions on their pedestals and the two
 * flagpoles with their flags.
 *
 * Everything is laid out in a Frame whose u axis runs along the 5th Ave front (uptown = +u) and whose v axis
 * points east toward the avenue (the facade line is v = 0, the pavilion projects to v = 6.3, the plaza ends at
 * v = 28 where the sidewalk starts). Dimensions are from the footprint in the tiles and the real elevations.
 */
import * as THREE from 'three';
import { Frame, GeoBuilder, ROOF, circle, offsetRing, signedArea, type StyleSpec, type XYZ } from '../geom';
import { NYPL } from '../data';
import { STYLE } from '../materials';
import type { Ring } from '@shared/world';
import type { LandmarkSeat } from '../index';

/** wing bays: window width, sill and arch apex, pilaster foot and the entablature line (m above the sidewalk) */
const WIN_W = 3.3, SILL = 6.6, APEX = 15.0, PIL_Y0 = 5.4, ENT_Y = 17.6;
/** depth of the wing windows' reveals and of the portals */
const REVEAL = 0.9, PORTAL = 3.2;
/** the porch landing the column pedestals stand on (terrace 2.0 -> porch -> portico floor 4.4) */
const PORCH = 3.4;

const FACADE: StyleSpec = { style: STYLE.NYPL, p: [6.3, 3.0, SILL, APEX], p2: [5.6, 0.35, 1, ENT_Y] };
const PAVILION: StyleSpec = { style: STYLE.NYPL, p: [6.3, 0, 0, 0], p2: [5.6, 0, 1, 18.2] };
const PLAIN_MARBLE: StyleSpec = { style: STYLE.NYPL, p: [6.3, 0, 0, 0], p2: [0, 0, 0.6, 999] };
const RUSTIC: StyleSpec = { style: STYLE.NYPL, p: [6.3, 0, 0, 0], p2: [999, 0, 0.3, 999] };
const CORNICE: StyleSpec = { style: STYLE.PLAIN, p: [0.78, 0.74, 0.66, 0], p2: [0, 0, 0, 0] };
const SHADOW: StyleSpec = { style: STYLE.PLAIN, p: [0.46, 0.44, 0.40, 0], p2: [0, 0, 0, 0] };
const LION: StyleSpec = { style: STYLE.PLAIN, p: [0.68, 0.62, 0.55, 0], p2: [0, 0, 0, 0] };
const FIGURE: StyleSpec = { style: STYLE.PLAIN, p: [0.74, 0.70, 0.63, 0], p2: [0, 0, 0, 0] };
const BRONZE: StyleSpec = { style: STYLE.BRONZE, p: [0, 0, 0, 0], p2: [0, 0, 0, 0] };
const POLE: StyleSpec = { style: STYLE.PAINT, p: [0.82, 0.82, 0.8, 0.45], p2: [0, 0, 0, 0] };
const WINDOW: StyleSpec = { style: STYLE.GLASS, p: [1.5, 0.8, 0.45, 0], p2: [0, 0.2, 0, 0] };
const LUNETTE: StyleSpec = { style: STYLE.GLASS, p: [4, 1.1, 0.5, 0], p2: [0, 0.6, 0, 0] };
const BALUSTRADE: StyleSpec = { style: STYLE.BALUSTER, p: [0.76, 0.72, 0.64, 0], p2: [0, 0, 0, 0] };
/** the US flag: 13 stripes over a 2.4 m hoist (CANVAS stripes run along uv.x, which the flag maps to its height) */
const FLAG_STRIPES: StyleSpec = { style: STYLE.CANVAS, p: [0.62, 0.06, 0.08, 2.4 / 6.5], p2: [0.88, 0.88, 0.86, 0] };
const FLAG_CANTON: StyleSpec = { style: STYLE.CANVAS, p: [0.08, 0.12, 0.36, 0], p2: [0, 0, 0, 0] };

interface Parts { body: GeoBuilder; colliders: { ring: Ring; y0: number; y1: number }[]; center: [number, number]; seats: LandmarkSeat[] }

export function buildNypl(footprint: Ring = NYPL.footprint): Parts {
  const L = NYPL;
  const f = Frame.fromBearing(L.ox, L.oz, L.bearing);
  const g = new GeoBuilder();
  const colliders: Parts['colliders'] = [];
  const seats: LandmarkSeat[] = [];
  const P = (u: number, v: number, y: number) => {
    const w = f.toWorld(u, v);
    return new THREE.Vector3(w[0], y, w[1]);
  };
  const X = (u: number, v: number, y: number): XYZ => {
    const w = f.toWorld(u, v);
    return [w[0], y, w[1]];
  };
  const U = new THREE.Vector3(f.ux, 0, f.uz), V = new THREE.Vector3(f.vx, 0, f.vz);
  const along: [number, number] = [f.ux, f.uz], east: [number, number] = [f.vx, f.vz];
  /** quad whose normal is forced toward `want` (flips the winding if needed) */
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, s: StyleSpec, want: THREE.Vector3, uv?: [number, number, number, number]) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    if (n.dot(want) < 0) g.quad3(a, d, c, b, s, uv);
    else g.quad3(a, b, c, d, s, uv);
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, s: StyleSpec, want: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (n.dot(want) < 0) n.negate();
    const i0 = g.vertex(a.x, a.y, a.z, n.x, n.y, n.z, 0, a.y, s);
    const i1 = g.vertex(b.x, b.y, b.z, n.x, n.y, n.z, 1, b.y, s);
    const i2 = g.vertex(c.x, c.y, c.z, n.x, n.y, n.z, 1, c.y, s);
    if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).dot(n) < 0) g.tri(i0, i2, i1);
    else g.tri(i0, i1, i2);
  };
  /** ring of n points around (u, v) in the frame with a per-point radius (fluting, leaf rows, ellipses) */
  const ring = (u: number, v: number, n: number, r: (i: number) => number, ru = 1, rv = 1): Ring => {
    const out: Ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rr = r(i);
      out.push(f.toWorld(u + Math.cos(a) * rr * ru, v + Math.sin(a) * rr * rv));
    }
    return out;
  };
  /** an arch opening outline (u, y): flat sill, jambs, 12-segment semicircle */
  const archOutline = (uc: number, w: number, y0: number, apex: number): [number, number][] => {
    const r = w / 2, cy = apex - r;
    const pts: [number, number][] = [[uc - r, y0], [uc + r, y0], [uc + r, cy]];
    for (let k = 1; k < 12; k++) {
      const t = (k / 12) * Math.PI;
      pts.push([uc + Math.cos(t) * r, cy + Math.sin(t) * r]);
    }
    pts.push([uc - r, cy]);
    return pts;
  };
  /** jambs, soffit and sill of an opening in a wall at v = vFace, `depth` into the wall (toward -v) */
  const reveals = (pts: [number, number][], uc: number, cy: number, vFace: number, depth: number, s: StyleSpec, skipBottom: boolean) => {
    for (let k = 0; k < pts.length; k++) {
      const p0 = pts[k], p1 = pts[(k + 1) % pts.length];
      const mu = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      const horizontal = Math.abs(p0[1] - p1[1]) < 1e-6;
      if (horizontal && skipBottom) continue;
      const want = horizontal ? new THREE.Vector3(0, my < cy ? 1 : -1, 0) : P(uc, vFace - depth / 2, Math.min(my, cy)).sub(P(mu, vFace - depth / 2, my));
      quad(P(p0[0], vFace, p0[1]), P(p1[0], vFace, p1[1]), P(p1[0], vFace - depth, p1[1]), P(p0[0], vFace - depth, p0[1]), s, want, [0, 0, depth, 1]);
    }
  };
  /** a row of dentils under a cornice: 0.16 m blocks at 0.34 m pitch, centred on the run */
  const dentils = (t0: number, t1: number, across: number, y: number, alongU: boolean) => {
    const len = Math.abs(t1 - t0), n = Math.floor(len / 0.34);
    if (n < 1) return;
    const start = Math.min(t0, t1) + (len - (n - 1) * 0.34) / 2;
    for (let i = 0; i < n; i++) {
      const t = start + i * 0.34;
      const w = alongU ? f.toWorld(t, across) : f.toWorld(across, t);
      g.box(w[0], y, w[1], alongU ? 0.16 : 0.3, 0.24, alongU ? 0.3 : 0.16, f.angle, PLAIN_MARBLE, null, SHADOW);
    }
  };

  // ---- footprint in the frame: the pavilion is the part projecting east of the facade line -----------------
  const local = footprint.map(([x, z]) => f.toLocal(x, z));
  let vP = 0, uA = Infinity, uB = -Infinity;
  for (const [u, v] of local) if (v > 3) { vP = Math.max(vP, v); uA = Math.min(uA, u); uB = Math.max(uB, u); }
  if (!(vP > 3)) { vP = 6.3; uA = -14.2; uB = 15.0; }
  const uC = (uA + uB) / 2, halfW = (uB - uA) / 2;
  const flip = signedArea(footprint) > 0;

  // ---- main block: every footprint edge except the pavilion's and the wing fronts (built below with real
  // window reveals); the sides carry the shader's arched windows -----------------------------------------------
  let along_ = 0;
  let fMin = Infinity, fMax = -Infinity;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length];
    const la = local[i], lb = local[(i + 1) % footprint.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (la[1] > 3 || lb[1] > 3) { along_ += len; continue; }
    if (Math.abs(la[1]) < 1.2 && Math.abs(lb[1]) < 1.2) {
      fMin = Math.min(fMin, la[0], lb[0]);
      fMax = Math.max(fMax, la[0], lb[0]);
      along_ += len;
      continue;
    }
    // short jogs get no windows (a window would straddle the corner)
    g.walls([a, b], 0, L.roof, len < 8 ? PAVILION : FACADE, { closed: false, uStart: along_, flipNormals: flip });
    along_ += len;
  }
  if (!Number.isFinite(fMin)) { fMin = -58.9; fMax = 58.9; }
  g.cap(footprint, L.roof, ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: L.roof });
  // projecting cornice under the attic, dentils under it along the front
  const cor = offsetRing(footprint, 0.9);
  g.walls(cor, L.cornice - 0.5, L.cornice + 0.4, CORNICE, { flipNormals: signedArea(cor) > 0 !== flip ? true : false });
  g.cap(cor, L.cornice - 0.5, SHADOW, { down: true });
  g.cap(cor, L.cornice + 0.4, CORNICE);
  dentils(fMin + 0.3, uA - 0.3, 0.3, L.cornice - 0.62, true);
  dentils(uB + 0.3, fMax - 0.3, 0.3, L.cornice - 0.62, true);
  // the Rose Reading Room block rises above the wings at the back
  {
    const w = f.toWorld(0, -52);
    g.box(w[0], L.roof + 3.2, w[1], 64, 6.4, 34, f.angle, PLAIN_MARBLE, ROOF);
  }

  // ---- balustrade members: BALUSTER style on a hexa (uv.y = local height), posts with urns -----------------
  const balustrade = (u0: number, u1: number, v0: number, v1: number, y: number) => {
    g.hexa([X(u0, v0, y), X(u1, v0, y), X(u1, v1, y), X(u0, v1, y)], [X(u0, v0, y + 1.05), X(u1, v0, y + 1.05), X(u1, v1, y + 1.05), X(u0, v1, y + 1.05)], BALUSTRADE);
  };
  const urn = (u: number, v: number, y: number) => {
    const w = f.toWorld(u, v);
    g.box(w[0], y + 0.6, w[1], 0.62, 1.2, 0.62, f.angle, PLAIN_MARBLE, CORNICE);
    const prof: [number, number][] = [[0.24, 0], [0.34, 0.1], [0.2, 0.26], [0.4, 0.6], [0.3, 0.9], [0.37, 1.0], [0.3, 1.08]];
    for (let i = 0; i + 1 < prof.length; i++) {
      g.loft(circle(w[0], w[1], prof[i][0], 8), y + 1.2 + prof[i][1], circle(w[0], w[1], prof[i + 1][0], 8), y + 1.2 + prof[i + 1][1], PLAIN_MARBLE, { cap: i === prof.length - 2 ? PLAIN_MARBLE : null });
    }
  };

  // ---- wing fronts: the tall arched windows cut through the wall with 0.9 m jambs and soffits, a dark grid
  // of iron-framed glass at the back of each reveal, pilasters standing proud between the bays ---------------
  const wingFront = (uS: number, uE: number) => {
    const len = uE - uS;
    const nB = Math.max(1, Math.round(len / 6.3)), bayW = len / nB;
    const style: StyleSpec = { style: STYLE.NYPL, p: [bayW, WIN_W, SILL, APEX], p2: [5.6, 0.35, 1, ENT_Y] };
    const cy = APEX - WIN_W / 2;
    const holes: [number, number][][] = [];
    for (let k = 0; k < nB; k++) holes.push(archOutline((k + 0.5) * bayW, WIN_W, SILL, APEX));
    g.shape(X(uS, 0, 0), along, east, [[0, 0], [len, 0], [len, L.roof], [0, L.roof]], holes, style);
    for (const [k, pts] of holes.entries()) {
      const uc = (k + 0.5) * bayW;
      reveals(pts.map(([u, y]) => [uS + u, y]), uS + uc, cy, 0, REVEAL, PLAIN_MARBLE, false);
      g.shape(X(uS, -REVEAL, 0), along, east, pts, [], WINDOW);
    }
    // pilasters (0.9 x 0.28 m) at the bay lines, a plain capital block under the entablature; urns above them
    // on the roof balustrade
    for (let k = 0; k <= nB; k++) {
      const u = uS + k * bayW;
      const w = f.toWorld(u, 0.14);
      g.box(w[0], (PIL_Y0 + ENT_Y) / 2, w[1], 0.9, ENT_Y - PIL_Y0, 0.28, f.angle, PLAIN_MARBLE, PLAIN_MARBLE);
      g.box(w[0], ENT_Y - 0.25, w[1], 1.15, 0.5, 0.36, f.angle, CORNICE, CORNICE, SHADOW);
      urn(u, 0.2, L.roof);
    }
    balustrade(uS, uE, -0.1, 0.5, L.roof);
  };
  wingFront(fMin, uA);
  wingFront(uB, fMax);

  // ---- central pavilion: jog walls, the arched front wall, loggia, columns, entablature, attic -------------
  const arches = [-1, 0, 1].map((k) => ({ uc: uC + k * 8.8, w: 6.0, apex: 15.2 }));
  const spring = (a: { w: number; apex: number }) => a.apex - a.w / 2;
  quad(P(uA, 0, 0), P(uA, vP, 0), P(uA, vP, L.pavilionRoof), P(uA, 0, L.pavilionRoof), PAVILION, U.clone().negate(), [0, 0, vP, L.pavilionRoof]);
  quad(P(uB, 0, 0), P(uB, vP, 0), P(uB, vP, L.pavilionRoof), P(uB, 0, L.pavilionRoof), PAVILION, U, [0, 0, vP, L.pavilionRoof]);
  g.cap(f.rect(uA, uB, 0, vP), L.pavilionRoof, ROOF);
  // front wall with three portal openings, their 3.2 m barrel vaults, bronze doors and lunettes behind
  {
    const holes = arches.map((a) => archOutline(a.uc, a.w, L.floor, a.apex));
    g.shape(X(uA, vP, 0), along, east, [[0, 0], [uB - uA, 0], [uB - uA, L.pavilionRoof], [0, L.pavilionRoof]], holes.map((h) => h.map(([u, y]) => [u - uA, y] as [number, number])), PAVILION);
    for (const [ai, pts] of holes.entries()) {
      const a = arches[ai];
      reveals(pts, a.uc, spring(a), vP, PORTAL, PLAIN_MARBLE, true);
      // inner wall behind the opening: bronze doors and a glazed lunette
      const vi = vP - PORTAL;
      quad(P(a.uc - a.w / 2 - 0.5, vi, L.floor), P(a.uc + a.w / 2 + 0.5, vi, L.floor), P(a.uc + a.w / 2 + 0.5, vi, a.apex + 0.5), P(a.uc - a.w / 2 - 0.5, vi, a.apex + 0.5), PLAIN_MARBLE, V, [0, 0, a.w + 1, a.apex + 0.5 - L.floor]);
      const dw = f.toWorld(a.uc, vi + 0.12);
      g.box(dw[0], L.floor + 2.6, dw[1], 3.2, 5.2, 0.24, f.angle, BRONZE, BRONZE);
      quad(P(a.uc - 2.2, vi + 0.1, L.floor + 5.6), P(a.uc + 2.2, vi + 0.1, L.floor + 5.6), P(a.uc + 2.2, vi + 0.1, a.apex - 0.9), P(a.uc - 2.2, vi + 0.1, a.apex - 0.9), LUNETTE, V, [0, 0, 4.4, 4]);
      // archivolt (a 0.56 m moulded ring standing 0.32 m proud), the jamb pilasters with their imposts, keystone
      const r = a.w / 2, sy = spring(a), ri = r + 0.06, ro = r + 0.62, proud = 0.32;
      const pt = (rr: number, t: number, v: number): XYZ => X(a.uc + Math.cos(t) * rr, v, sy + Math.sin(t) * rr);
      for (let k = 0; k < 12; k++) {
        const t0 = (k / 12) * Math.PI, t1 = ((k + 1) / 12) * Math.PI;
        g.hexa([pt(ri, t0, vP), pt(ro, t0, vP), pt(ro, t1, vP), pt(ri, t1, vP)], [pt(ri, t0, vP + proud), pt(ro, t0, vP + proud), pt(ro, t1, vP + proud), pt(ri, t1, vP + proud)], PLAIN_MARBLE);
      }
      for (const s of [-1, 1]) {
        const w = f.toWorld(a.uc + s * (r + 0.34), vP + proud / 2);
        g.box(w[0], (L.floor + sy) / 2, w[1], 0.56, sy - L.floor, proud, f.angle, PLAIN_MARBLE, PLAIN_MARBLE);
        const wi = f.toWorld(a.uc + s * (r + 0.34), vP + proud / 2 + 0.08);
        g.box(wi[0], sy - 0.2, wi[1], 0.9, 0.4, proud + 0.16, f.angle, CORNICE, CORNICE, SHADOW);
      }
      const kw = f.toWorld(a.uc, vP + proud / 2 + 0.1);
      g.box(kw[0], a.apex + 0.35, kw[1], 0.8, 1.4, proud + 0.2, f.angle, CORNICE, CORNICE, SHADOW);
    }
    // loggia floor and ceiling
    quad(P(uA + 0.5, vP - PORTAL, L.floor), P(uB - 0.5, vP - PORTAL, L.floor), P(uB - 0.5, vP, L.floor), P(uA + 0.5, vP, L.floor), PLAIN_MARBLE, new THREE.Vector3(0, 1, 0));
    quad(P(uA + 0.5, vP - PORTAL, 16.0), P(uB - 0.5, vP - PORTAL, 16.0), P(uB - 0.5, vP, 16.0), P(uA + 0.5, vP, 16.0), PLAIN_MARBLE, new THREE.Vector3(0, -1, 0));
  }
  // porch (stylobate) in front of the pavilion at the landing level the column pedestals stand on
  const porchV = vP + 4.4;
  {
    const w = f.toWorld(uC, (vP + porchV) / 2);
    g.box(w[0], (L.terrace + PORCH) / 2, w[1], uB - uA, PORCH - L.terrace, porchV - vP, f.angle, RUSTIC, PLAIN_MARBLE);
    colliders.push({ ring: f.rect(uA, uB, vP, porchV), y0: 0, y1: PORCH });
  }
  // paired Corinthian columns on pedestals, on the piers between and beside the arches
  const colV = vP + 2.6;
  const colTop = 17.0;
  const piers = [uC - 13.2, uC - 4.4, uC + 4.4, uC + 13.2];
  for (const pier of piers) {
    for (const du of [-0.85, 0.85]) {
      const u = pier + du;
      const w = f.toWorld(u, colV);
      // pedestal: plinth, die, cap
      g.box(w[0], PORCH + 0.15, w[1], 2.0, 0.3, 2.0, f.angle, RUSTIC, PLAIN_MARBLE);
      g.box(w[0], (PORCH + 0.3 + 6.15) / 2, w[1], 1.6, 6.15 - PORCH - 0.3, 1.6, f.angle, RUSTIC, PLAIN_MARBLE);
      g.box(w[0], 6.275, w[1], 1.9, 0.25, 1.9, f.angle, CORNICE, CORNICE, SHADOW);
      // attic base: torus and scotia
      g.cylinder(w[0], w[1], 6.4, 6.75, 0.80, 0.70, 16, PLAIN_MARBLE, { cap: PLAIN_MARBLE });
      g.cylinder(w[0], w[1], 6.75, 7.1, 0.70, 0.58, 16, PLAIN_MARBLE);
      // fluted shaft (24 flutes as alternating radii, every facet its own normal) with entasis
      const flutes = (r: number) => ring(u, colV, 48, (i) => (i % 2 ? r * 0.945 : r));
      g.loft(flutes(0.58), 7.1, flutes(0.575), 11.0, PLAIN_MARBLE);
      g.loft(flutes(0.575), 11.0, flutes(0.50), colTop, PLAIN_MARBLE);
      // Corinthian capital: two rows of acanthus leaves, the volutes flaring to the abacus
      const leaves = (r: number) => ring(u, colV, 16, (i) => (i % 2 ? r * 0.86 : r));
      g.loft(ring(u, colV, 16, () => 0.5), colTop, leaves(0.68), colTop + 0.4, CORNICE);
      g.loft(leaves(0.68), colTop + 0.4, leaves(0.82), colTop + 0.78, CORNICE);
      g.loft(leaves(0.82), colTop + 0.78, ring(u, colV, 16, (i) => (i % 4 === 0 ? 1.02 : 0.88)), colTop + 1.05, CORNICE, { cap: CORNICE });
      g.box(w[0], colTop + 1.2, w[1], 1.95, 0.3, 1.95, f.angle, CORNICE, CORNICE, CORNICE);
    }
  }
  // entablature carried across the columns (architrave + frieze, dentil course, cornice), then the attic with
  // its cornice and the six standing figures over the columns
  {
    const entY0 = 18.3, entY1 = 21.6;
    const w = f.toWorld(uC, (vP + colV + 1.3) / 2);
    g.box(w[0], (entY0 + entY1) / 2, w[1], uB - uA + 1.4, entY1 - entY0, colV + 1.3 - vP, f.angle, PAVILION, CORNICE, SHADOW);
    const c2 = f.toWorld(uC, (vP + colV + 1.9) / 2);
    g.box(c2[0], entY1 + 0.3, c2[1], uB - uA + 2.6, 0.6, colV + 1.9 - vP, f.angle, CORNICE, CORNICE, SHADOW);
    dentils(uC - halfW - 0.6, uC + halfW + 0.6, colV + 1.3 + 0.15, entY1 - 0.12, true);
    for (const s of [-1, 1]) dentils(vP + 0.3, colV + 1.3, uC + s * (halfW + 0.7 + 0.15), entY1 - 0.12, false);
    const at = f.toWorld(uC, (vP + colV + 0.6) / 2);
    g.box(at[0], (entY1 + 0.6 + L.pavilionRoof) / 2, at[1], uB - uA + 0.6, L.pavilionRoof - entY1 - 0.6, colV + 0.6 - vP, f.angle, PAVILION, CORNICE);
    const top = f.toWorld(uC, (vP + colV + 1.2) / 2);
    g.box(top[0], L.pavilionRoof + 0.25, top[1], uB - uA + 1.6, 0.5, colV + 1.2 - vP, f.angle, CORNICE, CORNICE, SHADOW);
    const figure = (u: number, v: number, y0: number) => {
      const w = f.toWorld(u, v);
      g.box(w[0], y0 + 0.3, w[1], 1.5, 0.6, 1.1, f.angle, CORNICE, CORNICE);
      const y1 = y0 + 0.6;
      const ell = (ru: number, rv: number) => ring(u, v, 8, () => 1, ru, rv);
      g.loft(ell(0.62, 0.42), y1, ell(0.44, 0.30), y1 + 1.7, FIGURE);
      g.loft(ell(0.44, 0.30), y1 + 1.7, ell(0.60, 0.34), y1 + 2.55, FIGURE, { cap: FIGURE });
      g.loft(ell(0.24, 0.20), y1 + 2.55, ell(0.20, 0.17), y1 + 2.85, FIGURE);
      g.sphere(w[0], y1 + 3.12, w[1], 0.30, 8, 5, FIGURE);
    };
    const fy = L.pavilionRoof + 0.5;
    for (const du of [-0.85, 0.85]) { figure(piers[0] + du, colV, fy); figure(piers[3] + du, colV, fy); }
    figure(piers[1], colV, fy);
    figure(piers[2], colV, fy);
  }

  // ---- terrace, the three-stage stair, balustrades, lions, flagpoles ---------------------------------------
  const tD = L.terraceDepth;
  const lowerW = 16.5; // half width of the lower flight
  const terr = f.rect(-58.9, 58.9, 0, tD);
  g.walls(terr, 0, L.terrace, RUSTIC);
  g.cap(terr, L.terrace, PLAIN_MARBLE, { uvScale: 1 });
  colliders.push({ ring: terr, y0: 0, y1: L.terrace });
  const stairs = (ua: number, ub: number, v0: number, v1: number, yTop: number, yBot: number, n: number, cheeks: boolean) => {
    const run = (v1 - v0) / n, rise = (yTop - yBot) / n;
    for (let i = 0; i < n; i++) {
      const y = yTop - rise * i;
      const va = v0 + run * i, vb = v0 + run * (i + 1);
      quad(P(ua, va, y), P(ub, va, y), P(ub, vb, y), P(ua, vb, y), PLAIN_MARBLE, new THREE.Vector3(0, 1, 0), [0, va, ub - ua, vb]);
      quad(P(ua, vb, y - rise), P(ub, vb, y - rise), P(ub, vb, y), P(ua, vb, y), PLAIN_MARBLE, V, [0, 0, ub - ua, rise]);
      colliders.push({ ring: f.rect(ua, ub, va, vb), y0: 0, y1: y });
    }
    if (cheeks) {
      tri(P(ua, v0, yTop), P(ua, v1, yBot), P(ua, v0, yBot), RUSTIC, U.clone().negate());
      tri(P(ub, v0, yTop), P(ub, v1, yBot), P(ub, v0, yBot), RUSTIC, U);
    }
  };
  // 1: plaza -> terrace between the lions (11 steps); 2: terrace -> porch across the pavilion (8 steps);
  // 3: porch -> portico floor, a short flight in front of each portal between the column pedestals (5 steps)
  stairs(uC - lowerW, uC + lowerW, tD, tD + 5.5, L.terrace, 0, 11, true);
  stairs(uA, uB, porchV, porchV + 3.4, PORCH, L.terrace, 8, true);
  // One sitting row on each lower flight, on its third tread from the bottom.
  // Leave a central 3 m passage and end margins; the feet rest on the next tread.
  const stepSeats = (ua: number, ub: number, v0: number, v1: number, top: number, bottom: number, n: number) => {
    const run = (v1 - v0) / n, rise = (top - bottom) / n, i = n - 3;
    const y = top - rise * i, v = v0 + run * (i + 1) - 0.12;
    for (let u = ua + 0.6; u <= ub - 0.6 + 0.001; u += 0.6) {
      if (Math.abs(u - uC) < 1.5) continue;
      const [x, z] = f.toWorld(u, v);
      seats.push({ x, y, z, yaw: Math.atan2(f.vx, f.vz), groundY: y - rise });
    }
  };
  stepSeats(uC - lowerW, uC + lowerW, tD, tD + 5.5, L.terrace, 0, 11);
  stepSeats(uA, uB, porchV, porchV + 3.4, PORCH, L.terrace, 8);
  for (const a of arches) stairs(a.uc - 2.7, a.uc + 2.7, vP, vP + 1.8, L.floor, PORCH, 5, false);
  // urn balustrade along the terrace edge (broken by the lower flight) and its ends
  const terraceRail = (u0: number, u1: number) => {
    balustrade(u0, u1, tD - 0.55, tD - 0.05, L.terrace);
    const n = Math.max(1, Math.round((u1 - u0) / 6.5));
    for (let i = 0; i <= n; i++) urn(u0 + ((u1 - u0) * i) / n, tD - 0.3, L.terrace);
  };
  terraceRail(-58.9, uC - lowerW - 3.6);
  terraceRail(uC + lowerW + 3.6, 58.9);
  for (const s of [-1, 1]) {
    balustrade(s * 58.85 - 0.25, s * 58.85 + 0.25, 0.4, tD - 0.6, L.terrace);
    for (let i = 1; i < 4; i++) urn(s * 58.85, 0.4 + ((tD - 1.0) * i) / 4, L.terrace);
  }
  // the lions (Patience and Fortitude) on their pedestals flanking the lower flight, facing the avenue
  for (const side of [-1, 1]) {
    const u = uC + side * (lowerW + 1.6);
    const pc = f.toWorld(u, tD + 1.6);
    g.box(pc[0], 1.4, pc[1], 2.4, 2.8, 5.2, f.angle, RUSTIC, PLAIN_MARBLE);
    g.box(pc[0], 2.95, pc[1], 2.8, 0.3, 5.6, f.angle, CORNICE, CORNICE, SHADOW);
    g.box(pc[0], 3.2, pc[1], 1.9, 0.2, 4.4, f.angle, LION, LION);
    colliders.push({ ring: f.rect(u - 1.4, u + 1.4, tD - 1.2, tD + 4.4), y0: 0, y1: 3.3 });
    const B = (dv: number) => f.toWorld(u, tD + dv);
    const y = 3.3;
    // haunches at the back, the body, the chest rising to the mane and head, forepaws stretched forward
    const haunch = B(0.2);
    g.box(haunch[0], y + 0.6, haunch[1], 1.35, 1.2, 1.4, f.angle, LION, LION);
    const body = B(1.5);
    g.box(body[0], y + 0.55, body[1], 1.15, 1.1, 1.6, f.angle, LION, LION);
    g.loft(ring(u, tD + 2.6, 8, () => 1, 0.62, 0.7), y, ring(u, tD + 2.65, 8, () => 1, 0.68, 0.62), y + 1.9, LION, { cap: LION });
    for (const s of [-1, 1]) {
      const paw = f.toWorld(u + s * 0.42, tD + 3.5);
      g.box(paw[0], y + 0.2, paw[1], 0.36, 0.4, 1.5, f.angle, LION, LION);
    }
    g.loft(ring(u, tD + 2.95, 8, () => 1, 0.75, 0.55), y + 1.5, ring(u, tD + 3.05, 8, () => 1, 0.6, 0.45), y + 2.7, LION, { cap: LION });
    const head = B(3.4);
    g.box(head[0], y + 2.25, head[1], 0.8, 0.75, 0.9, f.angle, LION, LION, LION);
  }
  // flagpoles on the terrace flanking the stairs, flying the flag toward the avenue
  for (const side of [-1, 1]) {
    const u = uC + side * 24, v = tD - 3.5;
    const w = f.toWorld(u, v);
    g.cylinder(w[0], w[1], L.terrace, L.terrace + 1.4, 1.3, 1.1, 10, RUSTIC, { cap: RUSTIC });
    g.cylinder(w[0], w[1], L.terrace + 1.4, L.terrace + 4.2, 0.75, 0.32, 10, BRONZE, { cap: BRONZE });
    g.cylinder(w[0], w[1], L.terrace + 4.2, L.terrace + 26, 0.16, 0.08, 6, POLE, { cap: POLE });
    g.sphere(w[0], L.terrace + 26.2, w[1], 0.22, 8, 4, BRONZE);
    colliders.push({ ring: circle(w[0], w[1], 1.2, 8), y0: 0, y1: L.terrace + 4.2 });
    // the flag: 3.6 x 2.4 m in six strips with a wave and a slight droop, both faces; the canton over the top strips
    const H = 2.4, W = 3.6, yTop = L.terrace + 25.7, strips = 6;
    const pt = (t: number, y: number, du = 0) => P(u + du + Math.sin(t * 5.2) * 0.22 * t, v + 0.2 + t * W, y - t * 0.25);
    const strip = (t0: number, t1: number, y0: number, y1: number, s: StyleSpec, du: number) => {
      const a = pt(t0, y0, du), b = pt(t0, y1, du), c = pt(t1, y1, du), d = pt(t1, y0, du);
      g.quad3(a, b, c, d, s, [y0 - (yTop - H), t0 * W, y1 - (yTop - H), t1 * W]);
      g.quad3(d, c, b, a, s, [y0 - (yTop - H), t1 * W, y1 - (yTop - H), t0 * W]);
    };
    for (let k = 0; k < strips; k++) strip(k / strips, (k + 1) / strips, yTop - H, yTop, FLAG_STRIPES, 0);
    for (const s of [-0.02, 0.02]) for (let k = 0; k < 2; k++) strip((k * 0.4) / 2, ((k + 1) * 0.4) / 2, yTop - H * 0.54, yTop, FLAG_CANTON, s);
  }
  return { body: g, colliders, seats, center: [L.ox + f.vx * -30, L.oz + f.vz * -30] };
}
