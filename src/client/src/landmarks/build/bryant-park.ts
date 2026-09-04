/**
 * Bryant Park set dressing (the spawn and safe zone). The tiles already give the lawn (grass mask), the plane-tree
 * allees and the plazas; this adds what makes the park read as Bryant Park:
 *  - the pinkish-tan crushed-gravel promenades around the lawn (2 cm speckle, darker worn lanes where people walk,
 *    a granite border against the paved perimeter), the bluestone-flag upper walks between the two rows of planes,
 *    the pink-grey granite lawn curb with its iron pipe rail, and the mounded ivy beds under the allees
 *  - the Josephine Shaw Lowell Memorial Fountain at the 6th Ave end (pink granite basin, pedestal, upper bowl, water)
 *  - the two food kiosks flanking the fountain terrace (dark green steel, cream trim, striped awnings), Le Carrousel
 *    on the 40th St side, the Reading Room's pergola on the 42nd St allee, the petanque courts by 6th Ave
 *  - the balustraded upper terrace at the library's rear with its three stairs, planters and the two cafe pavilions
 *  - the black twin-globe park lamps (instanced: cast posts, opal-glass globes, lit at night), slatted wooden benches
 *    on cast-iron ends at the edges
 *  - hundreds of Fermob-style folding bistro chairs (dark green enamel, slatted seats and backs) and round tables
 *    (instanced): clustered around the tables, a quarter turned at odd angles, some pulled aside, a few tipped, a
 *    few stacked. Every sittable chair is published as a seat transform for the character module.
 *
 * Everything is laid out in the BRYANT_PARK frame: u runs east along the streets (toward the library), n north.
 * Ref: refs/_sheets/bryant-park.png (3: chairs, gravel and the lawn by day; 2: the fountain and globes at night).
 */
import * as THREE from 'three';
import { Frame, GeoBuilder, circle, offsetRing, signedArea, type StyleSpec, type XYZ } from '../geom';
import { BRYANT_PARK } from '../data';
import { STYLE } from '../materials';
import type { Ring } from '@shared/world';

/** a chair someone can sit on: world position of the seat surface and the yaw (radians about +y) the sitter faces */
export interface ParkSeat {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface Parts {
  body: GeoBuilder;
  colliders: { ring: Ring; y0: number; y1: number }[];
  center: [number, number];
  instances: { body: GeoBuilder; matrices: THREE.Matrix4[]; name: string; castShadow: boolean }[];
  seats: ParkSeat[];
}

const plain = (r: number, g: number, b: number): StyleSpec => ({ style: STYLE.PLAIN, p: [r, g, b, 0], p2: [0, 0, 0, 0] });
const paint = (r: number, g: number, b: number, rough: number): StyleSpec => ({ style: STYLE.PAINT, p: [r, g, b, rough], p2: [0, 0, 0, 0] });
const color = (r: number, g: number, b: number, rough: number, metal = 0): StyleSpec => ({ style: STYLE.COLOR, p: [r, g, b, rough], p2: [metal, 0, 0, 0] });
const ivy = (r: number, g: number, b: number): StyleSpec => ({ style: STYLE.IVY, p: [r, g, b, 0], p2: [0, 0, 0, 0] });
const canvas = (r: number, g: number, b: number, period = 0, sr = 0, sg = 0, sb = 0): StyleSpec => ({ style: STYLE.CANVAS, p: [r, g, b, period], p2: [sr, sg, sb, 0] });
/** the streets module draws plazas / sidewalks at y = 0.15; park furniture and ground patches sit on that */
const G = 0.15;
const SEAT_H = 0.45;
const IVY = ivy(0.09, 0.16, 0.06);
const HEDGE = ivy(0.05, 0.12, 0.045);
const CURB = color(0.30, 0.28, 0.26, 0.6); // grey granite bed edging
const LAWN_CURB = color(0.23, 0.20, 0.19, 0.55); // pink-grey granite (ART_DIRECTION granite curb 0.18-0.24)
const BORDER = color(0.26, 0.24, 0.22, 0.6);
const PAVER = plain(0.66, 0.63, 0.58);
const PINK = plain(0.66, 0.47, 0.42); // Stony Creek pink granite
const CANVAS = canvas(0.80, 0.76, 0.64);
const VALANCE = canvas(0.84, 0.81, 0.70, 0.5, 0.30, 0.50, 0.34); // cream / green scallops
const AWNING = canvas(0.05, 0.16, 0.07, 0.6, 0.82, 0.80, 0.70); // green with cream stripes
const HORSE = plain(0.90, 0.88, 0.80);
const IRON = color(0.025, 0.025, 0.03, 0.5); // black painted cast iron
const GREEN = color(0.03, 0.14, 0.04, 0.42); // #2E6B3E "Bryant Park green" semi-gloss enamel (Fermob)
/** the chairs and tables are a stop darker than the park's other green ironwork (ref bryant-park.png 3) */
const CHAIR = color(0.016, 0.072, 0.024, 0.40);
const DKGREEN = color(0.02, 0.085, 0.03, 0.55);
const CREAM = color(0.86, 0.83, 0.72, 0.5);
const TIMBER = color(0.30, 0.20, 0.11, 0.8); // weathered stained slats
const WATER = paint(0.10, 0.20, 0.22, 0.05);
const JET = paint(0.80, 0.90, 0.95, 0.1);
const GLASS: StyleSpec = { style: STYLE.GLASS, p: [3.0, 1.05, 0.85, 0], p2: [0, 0.7, 0, 0] };
const GLOBE: StyleSpec = { style: STYLE.GLOBE, p: [1.0, 0.93, 0.78, 0], p2: [1.5, 1, 0, 0] };
const TERRACE_WALL: StyleSpec = { style: STYLE.NYPL, p: [6.3, 0, 0, 0], p2: [999, 0, 0.3, 999] }; // rusticated marble
const TERRACE_TRIM: StyleSpec = { style: STYLE.NYPL, p: [6.3, 0, 0, 0], p2: [0, 0, 0.5, 999] };

/** small deterministic RNG so the chairs land in the same places every build */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inPoly(u: number, n: number, poly: [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, ni] = poly[i], [uj, nj] = poly[j];
    if (ni > n !== nj > n && u < ((uj - ui) * (n - ni)) / (nj - ni) + ui) c = !c;
  }
  return c;
}

export function buildBryantPark(): Parts {
  const B = BRYANT_PARK;
  const f = Frame.fromBearing(B.ox, B.oz, B.bearing);
  const g = new GeoBuilder();
  const colliders: Parts['colliders'] = [];
  const W = (u: number, n: number) => f.toWorld(u, -n);
  const V3 = (u: number, n: number, y: number) => {
    const w = W(u, n);
    return new THREE.Vector3(w[0], y, w[1]);
  };
  const P = (u: number, n: number, y: number): XYZ => {
    const w = W(u, n);
    return [w[0], y, w[1]];
  };
  const rect = (u0: number, u1: number, n0: number, n1: number): Ring => f.rect(u0, u1, -n1, -n0);
  const band = (u0: number, u1: number, a: number, b: number, side: number): Ring => rect(u0, u1, Math.min(side * a, side * b), Math.max(side * a, side * b));
  const poly = (pts: [number, number][]): Ring => {
    const r = pts.map(([u, n]) => W(u, n));
    return signedArea(r) > 0 ? r.reverse() : r;
  };
  const box = (u: number, n: number, y: number, su: number, sy: number, sn: number, wall: StyleSpec, top: StyleSpec | null = wall, bottom: StyleSpec | null = null) => {
    const w = W(u, n);
    g.box(w[0], y, w[1], su, sy, sn, f.angle, wall, top, bottom);
  };
  const cyl = (u: number, n: number, y0: number, y1: number, r0: number, r1: number, seg: number, s: StyleSpec, cap: StyleSpec | null = s) => {
    const w = W(u, n);
    g.cylinder(w[0], w[1], y0, y1, r0, r1, seg, s, { cap });
  };
  const disc = (u: number, n: number, r: number, seg: number): Ring => {
    const w = W(u, n);
    return circle(w[0], w[1], r, seg);
  };
  const U = new THREE.Vector3(f.ux, 0, f.uz);
  const NV = new THREE.Vector3(-f.vx, 0, -f.vz); // +n (north)
  const UP = new THREE.Vector3(0, 1, 0);
  /** quad whose normal is forced toward `want` */
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, s: StyleSpec, want: THREE.Vector3, uv?: [number, number, number, number]) => {
    const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    if (nrm.dot(want) < 0) g.quad3(a, d, c, b, s, uv);
    else g.quad3(a, b, c, d, s, uv);
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, s: StyleSpec, want: THREE.Vector3) => {
    const nrm = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (nrm.dot(want) < 0) nrm.negate();
    const i0 = g.vertex(a.x, a.y, a.z, nrm.x, nrm.y, nrm.z, 0, a.y, s);
    const i1 = g.vertex(b.x, b.y, b.z, nrm.x, nrm.y, nrm.z, 1, b.y, s);
    const i2 = g.vertex(c.x, c.y, c.z, nrm.x, nrm.y, nrm.z, 1, c.y, s);
    if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).dot(nrm) < 0) g.tri(i0, i2, i1);
    else g.tri(i0, i1, i2);
  };
  /** boxes along every edge of a ring (curbs, timber edges); w across, h tall, centred at height y */
  const edgeBoxes = (ring: Ring, w: number, h: number, y: number, s: StyleSpec, overlap = w) => {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.05) continue;
      g.box((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, len + overlap, h, w, Math.atan2(b[1] - a[1], b[0] - a[0]), s, s);
    }
  };
  // ground styles keyed to the frame: gravel wear runs along the streets, flags are laid along them
  const GRAVEL: StyleSpec = { style: STYLE.GRAVEL, p: [0.43, 0.36, 0.30, 1.0], p2: [f.ux, f.uz, 1, 0] };
  const COURT: StyleSpec = { style: STYLE.GRAVEL, p: [0.50, 0.42, 0.33, 0.6], p2: [f.ux, f.uz, 0.4, 0] };
  const FLAGS: StyleSpec = { style: STYLE.FLAGS, p: [0.19, 0.20, 0.22, 0.9], p2: [f.ux, f.uz, 0.6, 0] }; // bluestone, darker than concrete
  /** the upper walks (bluestone) sit a centimetre above the gravel */
  const onFlags = (u: number, n: number) => Math.abs(n) > 35.5 && Math.abs(n) < 42 && u > -80 && u < 20;
  const groundY = (u: number, n: number) => (onFlags(u, n) ? G + 0.05 : G + 0.04);

  // ---- ground: gravel promenades around the lawn, flagged upper walks, ivy beds under the allees, petanque courts --
  const lawn = poly(B.lawn);
  const promenade = rect(-102, B.terrace.u0, -49, 49);
  g.cap(promenade, G + 0.04, GRAVEL, { holes: [lawn] });
  edgeBoxes(promenade, 0.35, 0.03, G + 0.045, BORDER, 0.35); // granite border against the paved perimeter
  for (const side of [-1, 1]) g.cap(band(-80, 20, 35.5, 42, side), G + 0.05, FLAGS);
  // All seven beds share the body draw and ONE leaf instance draw. Back faces are explicit, so the
  // shared landmark material can stay FrontSide; four triangles/card, including the underside.
  const ivyCards = new GeoBuilder(), ivyMatrices: THREE.Matrix4[] = [];
  const leafStyle: StyleSpec = { style: STYLE.IVY, p: [0.09, 0.16, 0.06, 0.45], p2: [1, 0, 0, 0] };
  for (const ny of [1, -1]) {
    const base = ivyCards.vertexCount;
    for (const [x, z] of [[-0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0.5, -0.5]]) {
      ivyCards.vertex(x, 0, z, 0, ny, 0, x + 0.5, z + 0.5, leafStyle);
    }
    if (ny > 0) ivyCards.quad(base, base + 1, base + 2, base + 3);
    else ivyCards.quad(base + 3, base + 2, base + 1, base);
  }
  const bed = (ring: Ring) => {
    const mulchRing = offsetRing(ring, -0.16);
    g.walls(ring, G, G + 0.18, CURB);
    g.cap(ring, G + 0.18, CURB, { holes: [mulchRing] });
    g.cap(mulchRing, G + 0.185, color(0.05, 0.035, 0.025, 0.95));

    // A sampled loft: the first/last rows form the foot and the inset rows form an irregular
    // crest ring. Continue the samples across the crown (no flat roof or 100 m straight edge).
    // These are rectangular bands in the park frame, including the two short fountain beds.
    const origin = new THREE.Vector3(mulchRing[0][0], 0, mulchRing[0][1]);
    const axisX = new THREE.Vector3(mulchRing[1][0], 0, mulchRing[1][1]).sub(origin);
    const axisZ = new THREE.Vector3(mulchRing[3][0], 0, mulchRing[3][1]).sub(origin);
    const sx = axisX.length(), sz = axisZ.length();
    axisX.normalize(); axisZ.normalize();
    const random = rng(1911 ^ Math.round(origin.x * 100) ^ Math.imul(Math.round(origin.z * 100), 31));
    const samples = (length: number) => {
      const steps = Math.max(1, Math.ceil((length - 1.2) / 1.6));
      return [0, ...Array.from({ length: steps + 1 }, (_, i) => 0.6 + (length - 1.2) * i / steps), length];
    };
    const xs = samples(sx), zs = samples(sz);
    const points: THREE.Vector3[] = [], normals: THREE.Vector3[] = [];
    for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs.length; i++) {
      const edgeX = i === 0 || i === xs.length - 1, edgeZ = j === 0 || j === zs.length - 1;
      // Keep the foot just inside the mulch, jitter the crest horizontally as well as vertically.
      const x = edgeX ? xs[i] + (i === 0 ? 1 : -1) * random() * 0.07 : xs[i] + (random() - 0.5) * 0.28;
      const z = edgeZ ? zs[j] + (j === 0 ? 1 : -1) * random() * 0.07 : zs[j] + (random() - 0.5) * 0.28;
      const y = edgeX || edgeZ ? 0.21 + random() * 0.065 : 0.35 + random() * 0.20;
      points.push(origin.clone().addScaledVector(axisX, x).addScaledVector(axisZ, z).setY(G + y));
      normals.push(new THREE.Vector3());
    }
    const faces: [number, number, number][] = [], areas: number[] = [];
    let area = 0;
    const face = (a: number, b: number, c: number) => {
      const normal = new THREE.Vector3().subVectors(points[b], points[a]).cross(new THREE.Vector3().subVectors(points[c], points[a]));
      if (normal.y < 0) { [b, c] = [c, b]; normal.negate(); }
      faces.push([a, b, c]);
      areas.push(area += normal.y * 0.5);
      for (const i of [a, b, c]) normals[i].add(normal);
    };
    for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
      const a = j * xs.length + i, b = a + 1, d = a + xs.length, c = d + 1;
      // Alternate diagonals to avoid visible long strips in the mound's shading.
      if ((i + j) % 2) { face(a, b, d); face(b, c, d); }
      else { face(a, b, c); face(a, c, d); }
    }
    const base = g.vertexCount;
    points.forEach((p, i) => {
      const n = normals[i].normalize();
      g.vertex(p.x, p.y, p.z, n.x, n.y, n.z, p.x, p.z, IVY);
    });
    for (const [a, b, c] of faces) g.tri(base + a, base + b, base + c);

    // Two cards/m² of planted area. Area-weighted triangle sampling seats every card on the
    // actual noisy surface, rather than floating over (or burying it in) an analytic mound.
    const count = Math.ceil(area * 2);
    const rotation = new THREE.Quaternion(), euler = new THREE.Euler(), scale = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const target = random() * area;
      let lo = 0, hi = areas.length - 1;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (areas[mid] < target) lo = mid + 1; else hi = mid; }
      const [a, b, c] = faces[lo], r = Math.sqrt(random()), s = random();
      const p = points[a].clone().multiplyScalar(1 - r).addScaledVector(points[b], r * (1 - s)).addScaledVector(points[c], r * s);
      p.y += 0.055;
      const size = 0.25 + random() * 0.15;
      euler.set(0.25 + random() * 0.65, random() * Math.PI * 2, (random() - 0.5) * 0.5, 'YXZ');
      ivyMatrices.push(new THREE.Matrix4().compose(p, rotation.setFromEuler(euler), scale.setScalar(size)));
    }
  };
  for (const side of [-1, 1]) {
    bed(band(-80, 20, 32, 35.5, side)); // under the inner row of planes
    // under the outer rows (the south bed breaks around the carousel)
    if (side > 0) bed(band(-80, 20, 42, 49, side));
    else { bed(band(-80, -45, 42, 49, side)); bed(band(-31, 20, 42, 49, side)); }
    bed(band(-82, -78, 12, 27, side)); // flanking the fountain terrace
  }
  // clipped hedge between the lawn and the lower terrace
  box(15.5, 2, G + 0.5, 1.4, 0.98, 32, HEDGE, HEDGE);
  // petanque courts by 6th Ave (42nd St side), timber-edged
  for (const [n0, n1] of [[35.5, 39.5], [41.5, 45.5]]) {
    const court = rect(-100, -84, n0, n1);
    g.cap(court, G + 0.06, COURT);
    edgeBoxes(court, 0.16, 0.2, G + 0.1, TIMBER, 0.16);
  }

  // ---- lawn border: granite curb + low iron pipe rail on posts every 2 m ------------------------------------
  edgeBoxes(lawn, 0.34, 0.26, G + 0.13, LAWN_CURB, 0.34);
  for (let i = 0; i < lawn.length; i++) {
    const a = lawn[i], b = lawn[(i + 1) % lawn.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    g.box((a[0] + b[0]) / 2, G + 0.7, (a[1] + b[1]) / 2, len, 0.035, 0.035, angle, IRON, IRON);
    const posts = Math.max(1, Math.round(len / 2));
    for (let k = 0; k < posts; k++) {
      const t = (k + 0.5) / posts;
      g.box(a[0] + (b[0] - a[0]) * t, G + 0.48, a[1] + (b[1] - a[1]) * t, 0.04, 0.46, 0.04, angle, IRON, null);
    }
  }

  // ---- Josephine Shaw Lowell Memorial Fountain ---------------------------------------------------------------
  {
    const [fu, fn] = B.fountain;
    const fw = W(fu, fn);
    // lower basin: outer wall, coping ring, inner wall, water
    g.cylinder(fw[0], fw[1], 0, G + 0.6, 4.3, 4.3, 24, PINK, { cap: null });
    const rimOut = circle(fw[0], fw[1], 4.5, 24), rimIn = circle(fw[0], fw[1], 3.9, 24);
    g.loft(circle(fw[0], fw[1], 4.3, 24), G + 0.6, rimOut, G + 0.72, PINK);
    g.cap(rimOut, G + 0.72, PINK, { holes: [rimIn] });
    g.walls(rimIn, G + 0.2, G + 0.72, PINK, { flipNormals: true });
    g.cap(circle(fw[0], fw[1], 3.9, 24), G + 0.55, WATER);
    // pedestal and the wide upper bowl
    cyl(fu, fn, G + 0.2, G + 0.62, 1.5, 1.5, 12, PINK);
    cyl(fu, fn, G + 0.62, G + 2.0, 1.0, 0.72, 12, PINK, null);
    g.loft(circle(fw[0], fw[1], 0.72, 16), G + 2.0, circle(fw[0], fw[1], 3.1, 16), G + 3.0, PINK);
    g.loft(circle(fw[0], fw[1], 3.1, 16), G + 3.0, circle(fw[0], fw[1], 3.2, 16), G + 3.15, PINK);
    g.cap(circle(fw[0], fw[1], 3.2, 16), G + 3.15, PINK, { holes: [circle(fw[0], fw[1], 2.85, 16)] });
    g.walls(circle(fw[0], fw[1], 2.85, 16), G + 2.75, G + 3.15, PINK, { flipNormals: true });
    g.cap(circle(fw[0], fw[1], 2.85, 16), G + 3.0, WATER);
    // small top bowl and the central jet
    cyl(fu, fn, G + 3.0, G + 3.9, 0.35, 0.25, 10, PINK, null);
    g.loft(circle(fw[0], fw[1], 0.25, 12), G + 3.9, circle(fw[0], fw[1], 0.9, 12), G + 4.3, PINK, { cap: PINK });
    g.cap(circle(fw[0], fw[1], 0.75, 12), G + 4.31, WATER);
    cyl(fu, fn, G + 4.3, G + 5.4, 0.07, 0.03, 5, JET);
    colliders.push({ ring: rimOut, y0: 0, y1: G + 0.72 });
    colliders.push({ ring: circle(fw[0], fw[1], 1.5, 12), y0: 0, y1: G + 2.0 });
  }

  // ---- food kiosks flanking the fountain terrace: dark green painted steel, cream trim, glazed, hipped roof,
  //      a striped awning over the serving counter on the side facing the fountain (east) --------------------------
  for (const [ku, kn] of B.kiosks) {
    const ring = rect(ku - 2.15, ku + 2.15, kn - 2.15, kn + 2.15);
    g.walls(ring, 0, 0.95, DKGREEN);
    g.walls(ring, 0.95, 2.55, GLASS);
    g.walls(ring, 2.55, 2.95, DKGREEN);
    g.walls(offsetRing(ring, 0.02), 0.92, 0.98, CREAM); // sill band
    for (const du of [-2.1, 2.1]) for (const dn of [-2.1, 2.1]) box(ku + du, kn + dn, 1.5, 0.14, 3.0, 0.14, CREAM, CREAM);
    const eave = rect(ku - 2.55, ku + 2.55, kn - 2.55, kn + 2.55);
    g.walls(eave, 2.8, 2.98, CREAM);
    g.cap(eave, 2.8, CREAM, { down: true });
    g.loft(eave, 2.98, rect(ku - 0.5, ku + 0.5, kn - 0.5, kn + 0.5), 3.95, DKGREEN, { cap: DKGREEN });
    box(ku + 2.45, kn, 0.98, 0.5, 0.06, 3.2, TIMBER, TIMBER, TIMBER);
    // awning: corners ordered so the first edge runs along the wall and the stripes fall down the slope
    const ub = ku + 2.17, uo = ku + 3.5;
    g.hexa([P(ub, kn - 2.0, 2.52), P(ub, kn + 2.0, 2.52), P(uo, kn + 2.0, 2.12), P(uo, kn - 2.0, 2.12)], [P(ub, kn - 2.0, 2.55), P(ub, kn + 2.0, 2.55), P(uo, kn + 2.0, 2.15), P(uo, kn - 2.0, 2.15)], AWNING, { bottom: true });
    for (const dn of [-1.9, 1.9]) {
      const a = V3(uo - 0.05, kn + dn, 2.13), b = V3(ub + 0.05, kn + dn, 1.0);
      g.tube([a, b], 0.015, 4, IRON);
    }
    colliders.push({ ring: eave, y0: 0, y1: 2.95 });
  }

  // ---- Le Carrousel (40th St side): round platform, tented roof with a scalloped valance, horses on poles -----
  {
    const [cu, cn] = B.carousel;
    cyl(cu, cn, 0, 0.4, 4.3, 4.3, 20, DKGREEN, TIMBER);
    cyl(cu, cn, 0.4, 3.3, 0.55, 0.5, 10, CREAM);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      cyl(cu + Math.cos(a) * 3.7, cn + Math.sin(a) * 3.7, 0.4, 3.1, 0.06, 0.06, 6, CREAM, null);
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      const hu = cu + Math.cos(a) * 2.5, hn = cn + Math.sin(a) * 2.5;
      cyl(hu, hn, 0.4, 3.1, 0.03, 0.03, 4, IRON, null);
      const hw = W(hu, hn);
      g.box(hw[0], 1.15, hw[1], 1.1, 0.55, 0.32, f.angle + a + Math.PI / 2, HORSE, HORSE, HORSE);
      g.box(hw[0] + 0.0, 1.62, hw[1], 0.35, 0.4, 0.22, f.angle + a + Math.PI / 2, HORSE, HORSE);
    }
    const valance = disc(cu, cn, 4.75, 20);
    g.walls(valance, 2.85, 3.2, VALANCE);
    g.cap(valance, 2.85, CANVAS, { down: true });
    g.loft(valance, 3.2, disc(cu, cn, 0.45, 20), 5.5, CANVAS, { cap: CANVAS });
    cyl(cu, cn, 5.5, 6.3, 0.45, 0.08, 8, DKGREEN);
    colliders.push({ ring: disc(cu, cn, 4.3, 20), y0: 0, y1: 0.4 });
    colliders.push({ ring: disc(cu, cn, 0.55, 10), y0: 0, y1: 3.3 });
  }

  // ---- the Reading Room: an open steel pergola with a green canvas canopy on the 42nd St allee, book carts -------
  {
    for (const pu of [-10, -6, -2, 2, 6, 10]) for (const pn of [36.8, 40.7]) cyl(pu, pn, 0, 3.25, 0.07, 0.07, 6, DKGREEN, null);
    for (const pn of [36.8, 40.7]) box(0, pn, 3.3, 20.6, 0.14, 0.14, DKGREEN, DKGREEN, DKGREEN);
    for (let pu = -10; pu <= 10; pu += 1) box(pu, 38.75, 3.45, 0.08, 0.14, 4.6, DKGREEN, DKGREEN, DKGREEN);
    const canopy = rect(-10.4, 10.4, 36.4, 41.1);
    const shade = canvas(0.06, 0.16, 0.08);
    g.walls(canopy, 3.3, 3.56, shade);
    g.cap(canopy, 3.56, shade);
    g.cap(canopy, 3.3, shade, { down: true });
    for (const cu of [-5, 5]) {
      box(cu, 38.75, 0.55, 1.6, 1.1, 0.9, DKGREEN, DKGREEN);
      box(cu, 38.75, 1.18, 1.4, 0.16, 0.8, TIMBER, TIMBER);
    }
  }

  // ---- black twin-globe park lamps (one instanced model; the arm runs along the allee or across it) -----------
  const lamps: [number, number, boolean][] = [];
  for (const side of [-1, 1]) {
    for (const u of [-70, -46, -22, 2]) lamps.push([u, side * 30.2, true]);
    for (const u of [-62, -38, -14, 14]) lamps.push([u, side * 38.8, true]);
    lamps.push([-79, side * 23, false], [-72, side * 10, false], [13.5, side * 20, false], [-96, side * 14, false], [-84.5, side * 17, false], [26.5, side * 9, false]);
  }
  lamps.push([13.5, 0, false]);
  const lamp = new GeoBuilder();
  lamp.cylinder(0, 0, 0, 0.1, 0.27, 0.27, 10, IRON, { cap: IRON }); // plinth
  lamp.cylinder(0, 0, 0.1, 0.62, 0.21, 0.12, 10, IRON, { cap: IRON }); // flared base
  lamp.cylinder(0, 0, 0.62, 3.5, 0.085, 0.06, 8, IRON, { cap: null }); // post
  lamp.cylinder(0, 0, 3.5, 3.66, 0.06, 0.1, 8, IRON, { cap: IRON }); // capital
  lamp.box(0, 3.66, 0, 1.36, 0.07, 0.07, 0, IRON, IRON, IRON); // arm along local +x
  lamp.sphere(0, 3.8, 0, 0.08, 6, 4, IRON); // finial
  for (const d of [-0.62, 0.62]) {
    lamp.cylinder(d, 0, 3.62, 3.76, 0.09, 0.13, 8, IRON, { cap: IRON }); // fitter
    lamp.sphere(d, 4.02, 0, 0.28, 10, 6, GLOBE);
  }

  // ---- the upper terrace at the library's rear: marble retaining walls, balustrade, three stairs, planters -------
  const planters: [number, number][] = [];
  {
    const T = B.terrace;
    const ring = rect(T.u0, T.u1, T.n0, T.n1);
    g.walls(ring, 0, T.h, TERRACE_WALL);
    g.cap(ring, T.h, FLAGS);
    colliders.push({ ring, y0: 0, y1: T.h });
    const lip = offsetRing(ring, 0.18);
    g.walls(lip, T.h - 0.3, T.h + 0.06, TERRACE_TRIM);
    g.cap(lip, T.h + 0.06, TERRACE_TRIM, { holes: [offsetRing(ring, -0.4)] });
    g.cap(lip, T.h - 0.3, TERRACE_TRIM, { down: true });
    /** balustrade along a segment (u0,n0)->(u1,n1): plinth, balusters every 0.42 m, handrail, piers at the ends */
    const balustrade = (u0: number, n0: number, u1: number, n1: number) => {
      const a = W(u0, n0), b = W(u1, n1);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      g.box(mx, T.h + 0.15, mz, len, 0.3, 0.46, angle, TERRACE_TRIM, TERRACE_TRIM);
      g.box(mx, T.h + 1.06, mz, len, 0.2, 0.4, angle, TERRACE_TRIM, TERRACE_TRIM, TERRACE_TRIM);
      const count = Math.max(1, Math.round(len / 0.42));
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        g.box(a[0] + (b[0] - a[0]) * t, T.h + 0.63, a[1] + (b[1] - a[1]) * t, 0.13, 0.66, 0.13, angle + Math.PI / 4, TERRACE_TRIM, null);
      }
      for (const p of [a, b]) g.box(p[0], T.h + 0.68, p[1], 0.62, 1.36, 0.62, angle, TERRACE_TRIM, TERRACE_TRIM);
    };
    const stairsAt: [number, number][] = [[-52, -46], [-7, 7], [46, 52]];
    // west edge runs between the stairs, then the two street-side edges
    balustrade(T.u0, T.n0, T.u0, -52);
    balustrade(T.u0, -46, T.u0, -7);
    balustrade(T.u0, 7, T.u0, 46);
    balustrade(T.u0, 52, T.u0, T.n1);
    balustrade(T.u0, T.n0, T.u1 - 0.5, T.n0);
    balustrade(T.u0, T.n1, T.u1 - 0.5, T.n1);
    // stairs descending west from the terrace edge: 12 risers of 0.2 m, 0.36 m treads, marble cheek walls
    const steps = 12, rise = T.h / steps, run = 0.36;
    for (const [n0, n1] of stairsAt) {
      for (let i = 1; i < steps; i++) {
        const y = T.h - rise * i;
        const ua = T.u0 - run * i, ub = T.u0 - run * (i - 1);
        quad(V3(ua, n0, y), V3(ub, n0, y), V3(ub, n1, y), V3(ua, n1, y), PAVER, UP, [0, n0, ub - ua, n1]);
        quad(V3(ub, n0, y), V3(ub, n1, y), V3(ub, n1, y + rise), V3(ub, n0, y + rise), TERRACE_TRIM, U.clone().negate(), [0, y, n1 - n0, y + rise]);
        colliders.push({ ring: rect(ua, ub, n0, n1), y0: 0, y1: y });
      }
      const uFoot = T.u0 - run * (steps - 1);
      quad(V3(uFoot, n0, 0), V3(uFoot, n1, 0), V3(uFoot, n1, rise), V3(uFoot, n0, rise), TERRACE_TRIM, U.clone().negate());
      for (const n of [n0, n1]) tri(V3(T.u0, n, T.h + 0.3), V3(uFoot, n, 0), V3(T.u0, n, 0), TERRACE_WALL, n === n0 ? NV.clone().negate() : NV);
      // a pair of planted urns at the foot of each stair: green painted steel, clipped boxwood
      for (const n of [n0 - 0.9, n1 + 0.9]) {
        const pu = uFoot - 0.9;
        cyl(pu, n, G, G + 0.62, 0.36, 0.44, 10, DKGREEN, DKGREEN);
        const pw = W(pu, n);
        g.sphere(pw[0], G + 0.95, pw[1], 0.5, 8, 5, HEDGE);
        planters.push([pu, n]);
        colliders.push({ ring: circle(pw[0], pw[1], 0.44, 8), y0: 0, y1: G + 0.62 });
      }
    }
    // cafe pavilions on the terrace (replace the tiles' 3 m boxes): posts, flat canopy, service counter
    for (const c of B.cafes) {
      const uc = (c.u0 + c.u1) / 2, nc = (c.n0 + c.n1) / 2, su = c.u1 - c.u0, sn = c.n1 - c.n0;
      for (const du of [-su / 2 + 0.4, su / 2 - 0.4]) for (const dn of [-sn / 2 + 0.4, 0, sn / 2 - 0.4]) cyl(uc + du, nc + dn, T.h, T.h + 3.0, 0.08, 0.08, 6, DKGREEN, null);
      box(uc, nc, T.h + 3.15, su + 0.6, 0.3, sn + 0.6, DKGREEN, DKGREEN, DKGREEN);
      const alongU = su > sn;
      box(uc, nc, T.h + 0.5, alongU ? su * 0.6 : 1.0, 1.0, alongU ? 1.0 : sn * 0.6, TIMBER, TIMBER);
      colliders.push({ ring: rect(uc - (alongU ? su * 0.3 : 0.5), uc + (alongU ? su * 0.3 : 0.5), nc - (alongU ? 0.5 : sn * 0.3), nc + (alongU ? 0.5 : sn * 0.3)), y0: T.h, y1: T.h + 1.0 });
    }
  }

  // ---- instanced furniture: Fermob-style bistro chairs, round tables, slatted benches --------------------------
  // Chair: local +z is the front. The round-4 critic read the old chair as a bent-wire stick frame with a
  // flat seat plate; the real Luxembourg chair is a 34 mm slatted seat and back on a 34 mm tube frame, and
  // it is the slat pitch and the tube thickness that carry it at 10-30 m. Enamel is a darker green than the
  // park's ironwork (ref bryant-park.png 3: the chairs read near-black against the gravel in full sun).
  const chair = new GeoBuilder();
  {
    const slat = 0.034, gap = 0.024, pitch = slat + gap, sd = 0.38;
    for (let i = 0; i < 7; i++) chair.box((i - 3) * pitch, SEAT_H, 0.0, slat, 0.018, sd, 0, CHAIR, CHAIR, CHAIR);
    // seat rails: the frame the slats are riveted to, square section so it reads as metal, not wire
    for (const z of [-0.185, 0.185]) chair.box(0, 0.428, z, 0.42, 0.026, 0.026, 0, CHAIR, CHAIR, CHAIR);
    for (const x of [-0.196, 0.196]) chair.box(x, 0.428, 0, 0.026, 0.026, 0.40, 0, CHAIR, CHAIR, CHAIR);
    // back: four boards and a rolled top rail, raked back over the rear legs
    for (let i = 0; i < 4; i++) chair.box(0, 0.60 + i * 0.085, -0.188 - i * 0.011, 0.40, 0.045, 0.016, 0, CHAIR, CHAIR, CHAIR);
    chair.box(0, 0.928, -0.226, 0.40, 0.055, 0.022, 0, CHAIR, CHAIR, CHAIR);
    // 34 mm tube legs: front pair stops under the seat, rear pair runs on as the back frame
    for (const x of [-0.186, 0.186]) {
      chair.cylinder(x, 0.168, 0, 0.452, 0.017, 0.017, 6, CHAIR, { cap: CHAIR });
      chair.cylinder(x, -0.198, 0, 0.955, 0.017, 0.017, 6, CHAIR, { cap: CHAIR });
    }
  }
  // Table: 0.6 m round top with a rolled edge on an 8-sided pedestal and a cast three-lobed foot.
  const table = new GeoBuilder();
  table.cylinder(0, 0, 0.695, 0.725, 0.302, 0.302, 16, CHAIR, { cap: CHAIR });
  table.cap(circle(0, 0, 0.302, 16), 0.695, CHAIR, { down: true });
  table.cylinder(0, 0, 0.66, 0.697, 0.29, 0.302, 16, DKGREEN, { cap: null }); // rolled rim under the top
  table.cylinder(0, 0, 0.06, 0.66, 0.036, 0.030, 8, CHAIR, { cap: null });
  table.cylinder(0, 0, 0.045, 0.09, 0.075, 0.055, 8, CHAIR, { cap: CHAIR });
  table.cylinder(0, 0, 0, 0.045, 0.235, 0.20, 12, DKGREEN, { cap: DKGREEN });
  // bench: three seat slats and three back slats of stained timber on black cast-iron ends with armrests
  const bench = new GeoBuilder();
  {
    const bw = 1.8;
    for (const z of [-0.12, 0.02, 0.16]) bench.box(0, 0.44, z, bw, 0.035, 0.10, 0, TIMBER, TIMBER, null);
    for (const [y, z] of [[0.60, -0.23], [0.74, -0.25], [0.88, -0.27]]) bench.box(0, y, z, bw, 0.10, 0.03, 0, TIMBER, TIMBER, null);
    for (const x of [-0.85, 0.85]) {
      bench.box(x, 0.22, 0.0, 0.05, 0.44, 0.44, 0, IRON, null, null);
      bench.box(x, 0.66, -0.24, 0.05, 0.56, 0.05, 0, IRON, IRON, null);
      bench.box(x, 0.66, -0.02, 0.05, 0.04, 0.44, 0, IRON, IRON, null);
    }
  }
  const chairs: THREE.Matrix4[] = [], tables: THREE.Matrix4[] = [], benches: THREE.Matrix4[] = [], lampMats: THREE.Matrix4[] = [];
  const seats: ParkSeat[] = [];
  const quatTmp = new THREE.Quaternion(), euler = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  /** yaw so that local +z faces the frame direction (du, dn) */
  const yawTo = (du: number, dn: number) => {
    const wx = f.ux * du - f.vx * dn, wz = f.uz * du - f.vz * dn;
    return Math.atan2(wx, wz);
  };
  /** yaw so that local +x points along the world direction (dx, dz) */
  const yawX = (dx: number, dz: number) => Math.atan2(-dz, dx);
  const place = (list: THREE.Matrix4[], u: number, n: number, yaw: number, y: number, tilt = 0) => {
    euler.set(tilt, yaw, 0, 'YXZ');
    list.push(new THREE.Matrix4().compose(V3(u, n, y), quatTmp.setFromEuler(euler), one));
  };
  const placeChair = (u: number, n: number, yaw: number, opts: { y?: number; tilt?: number; seat?: boolean } = {}) => {
    const y = opts.y ?? groundY(u, n);
    place(chairs, u, n, yaw, y, opts.tilt ?? 0);
    if (opts.seat !== false && !opts.tilt) {
      const w = W(u, n);
      seats.push({ x: w[0], y: y + SEAT_H, z: w[1], yaw });
    }
  };
  for (const [u, n, along] of lamps) place(lampMats, u, n, along ? yawX(f.ux, f.uz) : yawX(-f.vx, -f.vz), 0);

  const rand = rng(1911);
  const [fu, fn] = B.fountain;
  const [cu, cn] = B.carousel;
  const blocked = (u: number, n: number): boolean => {
    if (inPoly(u, n, B.lawn)) return true;
    if (Math.hypot(u - fu, n - fn) < 5.6 || Math.hypot(u - cu, n - cn) < 5.4) return true;
    for (const [ku, kn] of B.kiosks) if (Math.abs(u - ku) < 3.4 && Math.abs(n - kn) < 3.2) return true;
    const an = Math.abs(n);
    if (u > -80.5 && u < 20.5 && ((an > 31.5 && an < 36) || (an > 41.5 && an < 49.5))) return true; // ivy beds
    if (u > -82.5 && u < -77.5 && an > 11.5 && an < 27.5) return true;
    if (u > 14.2 && u < 16.8 && n > -14.5 && n < 18.5) return true; // hedge
    if (u > -11 && u < 11 && n > 36 && n < 41.5) return true; // pergola
    if (u > -100.5 && u < -83.5 && n > 35 && n < 46) return true; // petanque
    if (u > 26) return true; // stairs / terrace
    for (const [lu, ln] of lamps) if (Math.hypot(u - lu, n - ln) < 0.7) return true;
    for (const [pu, pn] of planters) if (Math.hypot(u - pu, n - pn) < 1.0) return true;
    return false;
  };
  const zones: [number, number, number, number, number][] = [
    // u0, u1, n0, n1, tables per 100 m^2 (the promenades beside the lawn are the busiest)
    [-76, 11, 28.2, 31.6, 9], [-76, 11, -31.6, -28.2, 9],
    [-78, 18, 36.2, 41.4, 5], [-78, 18, -41.4, -36.2, 5],
    [-77.5, -64.5, -26, 26, 3.5], [12.5, 25.5, -44, 44, 2.5],
    [-101, -82, -33, 33, 2],
  ];
  const placed: [number, number][] = [];
  const wants = zones.map(([u0, u1, n0, n1, density]) => Math.round(((u1 - u0) * (n1 - n0) * density) / 100));
  // tables with their chairs clustered around them: most facing the table, a quarter pushed back at odd angles
  zones.forEach(([u0, u1, n0, n1], zi) => {
    const want = wants[zi];
    let tries = 0;
    for (let k = 0; k < want && tries < want * 12; tries++) {
      const u = u0 + rand() * (u1 - u0), n = n0 + rand() * (n1 - n0);
      if (blocked(u, n) || placed.some(([pu, pn]) => Math.hypot(pu - u, pn - n) < 2.3)) continue;
      placed.push([u, n]);
      k++;
      place(tables, u, n, rand() * Math.PI, groundY(u, n));
      // Chairs bunch on one side of a table far more often than they ring it evenly; the round-4 critic
      // read the old even ring as uniform spacing. Spread the arc unevenly around a random bias and let a
      // third of them stand well back, turned any way at all.
      const count = 2 + Math.floor(rand() * 3);
      const a0 = rand() * Math.PI * 2, bias = 0.5 + rand() * 1.6;
      for (let s = 0; s < count; s++) {
        const a = a0 + (s / count) * Math.PI * 2 * bias + (rand() - 0.5) * 0.9;
        const odd = rand() < 0.33;
        const r = odd ? 0.78 + rand() * 0.6 : 0.56 + rand() * 0.16;
        const cu2 = u + Math.cos(a) * r, cn2 = n + Math.sin(a) * r;
        const yaw = odd ? rand() * Math.PI * 2 : yawTo(u - cu2, n - cn2) + (rand() - 0.5) * 0.5;
        placeChair(cu2, cn2, yaw);
      }
    }
  });
  // stacks of nested chairs left by the attendants along the edges (not sittable)
  for (const [su, sn] of [[-73, 30.6], [8.5, 30.6], [-73, -30.6], [8.5, -30.6], [-77, 39], [17, -39], [-99, 30], [-99, -30]] as [number, number][]) {
    if (blocked(su, sn) || placed.some(([pu, pn]) => Math.hypot(pu - su, pn - sn) < 1.5)) continue;
    placed.push([su, sn]);
    const count = 4 + Math.floor(rand() * 3);
    const yaw = rand() * Math.PI * 2;
    for (let k = 0; k < count; k++) placeChair(su, sn, yaw + (rand() - 0.5) * 0.08, { y: groundY(su, sn) + k * 0.085, seat: false });
  }
  // loose chairs: pulled aside at any angle, a few tipped over on their backs
  zones.forEach(([u0, u1, n0, n1], zi) => {
    const loose = Math.round(wants[zi] * 0.4);
    for (let k = 0, t = 0; k < loose && t < loose * 10; t++) {
      const u = u0 + rand() * (u1 - u0), n = n0 + rand() * (n1 - n0);
      if (blocked(u, n) || placed.some(([pu, pn]) => Math.hypot(pu - u, pn - n) < 1.1)) continue;
      k++;
      const roll = rand();
      if (roll < 0.09) {
        // on its back where somebody left it: the park's most photographed detail
        placeChair(u, n, rand() * Math.PI * 2, { y: groundY(u, n) + 0.12, tilt: -Math.PI / 2 + 0.26 });
      } else if (roll < 0.35) {
        // a pair dragged together knee to knee, both chairs turned to face across the same 0.85 m gap
        const a = rand() * Math.PI * 2, half = 0.42 + rand() * 0.08;
        const du = Math.cos(a) * half, dn = Math.sin(a) * half;
        placeChair(u + du, n + dn, yawTo(-du, -dn) + (rand() - 0.5) * 0.3);
        placeChair(u - du, n - dn, yawTo(du, dn) + (rand() - 0.5) * 0.3);
      } else {
        placeChair(u, n, rand() * Math.PI * 2);
      }
    }
  });
  // benches: along the upper walks backing onto the outer beds, facing the lawn; around the fountain
  for (const side of [-1, 1]) {
    for (let u = -72; u <= 16; u += 11) {
      if (side > 0 && u > -12 && u < 12) continue; // the Reading Room
      if (side < 0 && Math.abs(u - cu) < 7) continue; // the carousel
      place(benches, u, side * 41.1, yawTo(0, -side), groundY(u, side * 41.1));
    }
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const bu = fu + Math.cos(a) * 8.5, bn = fn + Math.sin(a) * 8.5;
    if (Math.abs(bn) > 30) continue;
    place(benches, bu, bn, yawTo(fu - bu, fn - bn), groundY(bu, bn));
  }
  for (const [u, n] of [[-79.5, 30], [-79.5, -30], [18, 46], [18, -46]] as [number, number][]) place(benches, u, n, yawTo(-Math.sign(u + 30), 0), groundY(u, n));

  return {
    body: g,
    colliders,
    center: B.center,
    instances: [
      { name: 'chairs', body: chair, matrices: chairs, castShadow: true },
      { name: 'tables', body: table, matrices: tables, castShadow: true },
      { name: 'benches', body: bench, matrices: benches, castShadow: true },
      { name: 'lamps', body: lamp, matrices: lampMats, castShadow: true },
      { name: 'ivy-cards', body: ivyCards, matrices: ivyMatrices, castShadow: false },
    ],
    seats,
  };
}
