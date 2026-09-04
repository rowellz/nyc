/**
 * Empire State Building. 443.2 m to the tip, 381 m roof, 320 m 86th-floor observatory.
 * Massing from the 1931 plans: 5-story base filling the 60 x 130 m lot, wings to the 20th floor, setbacks at 21,
 * 25, 30, the main shaft to 72, setbacks at 72, 81, 86 (observatory), the mooring mast to 102 (381 m) and the
 * antenna. Indiana limestone with the vertical stainless mullion stripes; the crown is floodlit at night.
 */
import * as THREE from 'three';
import { Frame, GeoBuilder, ROOF, crossRing, circle, roundedRect, type StyleSpec, type XYZ } from '../geom';
import { STYLE } from '../materials';
import { ESB } from '../data';
import { inscribe } from '../letters';
import type { Ring } from '@shared/world';

export interface EsbParts {
  body: GeoBuilder;
  colliders: { ring: Ring; y0: number; y1: number }[];
  center: [number, number];
}

const STONE: StyleSpec = { style: STYLE.ESB, p: [3.66, 2.75, 1.25, 1.95], p2: [2.0, 0.2, 0, 0] };
const STONE_LIT = (base: number): StyleSpec => ({ style: STYLE.ESB, p: [3.66, 2.75, 1.25, 1.95], p2: [2.0, 0.2, 1, base] });
const MAST_LIT = (base: number): StyleSpec => ({ style: STYLE.ESB, p: [3.4, 1.5, 0.55, 2.1], p2: [0.4, 0.4, 1, base] });
const STEEL: StyleSpec = { style: STYLE.PAINT, p: [0.62, 0.63, 0.66, 0.4], p2: [0, 0, 0, 0] };
/** ground floors: 3.6 m shop windows in 5.5 m bays, two 5.75 m storeys (ESB style keeps the stainless trim) */
const STOREFRONT: StyleSpec = { style: STYLE.ESB, p: [5.75, 5.5, 3.6, 4.4], p2: [0, 0.45, 0, 0] };
const DARK: StyleSpec = { style: STYLE.PAINT, p: [0.18, 0.18, 0.2, 0.5], p2: [0, 0, 0, 0] };
const RED_BEACON: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.08, 0.05, 0], p2: [6.0, 0.85, 1.0, 0] };
const WHITE_GLOW: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.97, 0.9, 0], p2: [2.2, 1.0, 0, 0] };
const PARAPET: StyleSpec = { style: STYLE.PLAIN, p: [0.66, 0.62, 0.56, 0], p2: [0, 0, 0, 0] };
/** the marquee's soffit lights and the illuminated "EMPIRE STATE" letters (dark metal by day) */
const CANOPY_LIGHT: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.9, 0.72, 0], p2: [1.4, 1.0, 0, 0] };
const LETTERS: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.88, 0.66, 0], p2: [1.8, 0.85, 0, 0] };
const FLAG_RED: StyleSpec = { style: STYLE.PLAIN, p: [0.55, 0.05, 0.06, 0], p2: [0, 0, 0, 0] };
const FLAG_WHITE: StyleSpec = { style: STYLE.PLAIN, p: [0.85, 0.85, 0.85, 0], p2: [0, 0, 0, 0] };
const FLAG_BLUE: StyleSpec = { style: STYLE.PLAIN, p: [0.03, 0.08, 0.30, 0], p2: [0, 0, 0, 0] };
const GLASS_DARK: StyleSpec = { style: STYLE.GLASS, p: [4.2, 1.4, 0.55, 0], p2: [0, 0.7, 0, 0] };

export function buildEmpireState(footprint?: Ring): EsbParts {
  const F = Frame.fromBearing(ESB.cornerNE.x, ESB.cornerNE.z, ESB.bearingU);
  const g = new GeoBuilder();
  const U = ESB.lotU, V = ESB.lotV;
  const colliders: { ring: Ring; y0: number; y1: number }[] = [];

  // --- base, floors 1-5, the whole lot
  const base = footprint ?? F.rect(0, U, 0, V);
  // two tall storefront floors (5.5 m shop windows between the piers), then the limestone base whose window
  // columns start at the 3rd floor: the photo reads a heavier plinth under the striped block
  g.prism(base, 0, 11.5, STOREFRONT, null);
  g.prism(base, 11.5, 24, { ...STONE, p2: [2.0, 0.22, 0, 0] }, ROOF, { uStart: 0 });
  colliders.push({ ring: base, y0: 0, y1: 24 });
  // 5th Ave entrance: stainless portal + dark glass, 3 stories, slightly proud of the wall
  {
    const cu = U / 2;
    const portal = F.rect(cu - 8.5, cu + 8.5, -0.25, 0.6);
    g.prism(portal, 0, 12.5, STEEL, STEEL);
    // the lobby front: dark reflective glass in a stainless grid (a flat paint box read as a billboard)
    const glass = F.rect(cu - 7.2, cu + 7.2, -0.4, 0.5);
    g.prism(glass, 0, 11.2, GLASS_DARK, DARK);
    // the two side entrances on 33rd / 34th: dark glass in a stainless frame
    for (const uu of [-0.25, U + 0.25]) {
      g.prism(F.rect(uu - 0.3, uu + 0.3, 40.5, 51.5), 0, 8.0, GLASS_DARK, STEEL);
      for (const vv of [40, 52]) g.prism(F.rect(uu - 0.45, uu + 0.45, vv - 0.4, vv + 0.4), 0, 8.5, STEEL, STEEL);
      g.prism(F.rect(uu - 0.45, uu + 0.45, 40, 52), 8.0, 8.6, STEEL, STEEL);
    }
    // the art-deco marquee over the 5th Ave doors: stainless canopy, lit soffit, "EMPIRE STATE" on the fascia
    const cy = 5.3, depth = 3.4, halfW = 6.6;
    const at = (u: number, v: number, y: number): XYZ => { const w = F.toWorld(u, v); return [w[0], y, w[1]]; };
    g.hexa([at(cu - halfW, -0.2, cy), at(cu + halfW, -0.2, cy), at(cu + halfW, -depth, cy + 0.15), at(cu - halfW, -depth, cy + 0.15)], [at(cu - halfW, -0.2, cy + 1.0), at(cu + halfW, -0.2, cy + 1.0), at(cu + halfW, -depth, cy + 0.95), at(cu - halfW, -depth, cy + 0.95)], STEEL, { bottom: true });
    g.hexa([at(cu - halfW + 0.3, -0.5, cy - 0.06), at(cu + halfW - 0.3, -0.5, cy - 0.06), at(cu + halfW - 0.3, -depth + 0.3, cy + 0.08), at(cu - halfW + 0.3, -depth + 0.3, cy + 0.08)], [at(cu - halfW + 0.3, -0.5, cy - 0.02), at(cu + halfW - 0.3, -0.5, cy - 0.02), at(cu + halfW - 0.3, -depth + 0.3, cy + 0.12), at(cu - halfW + 0.3, -depth + 0.3, cy + 0.12)], CANOPY_LIGHT, { bottom: true });
    const fascia = F.toWorld(cu, -depth);
    const east = new THREE.Vector3(-F.vx, 0, -F.vz);
    // the frame's u runs downtown along 5th Ave; read the letters uptown so they face the avenue correctly
    inscribe(g, new THREE.Vector3(fascia[0], cy + 0.32, fascia[1]), new THREE.Vector3(-F.ux, 0, -F.uz), east, 'EMPIRE STATE', 0.5, LETTERS, { proud: 0.05 });
    // three flagpoles on the 5th Ave front above the entrance, angled out over the sidewalk, flags flying uptown
    for (const du of [-7.5, 0, 7.5]) {
      const u = cu + du;
      const p0 = at(u, -0.1, 22.4), p1 = at(u, -4.6, 26.2);
      g.tube([new THREE.Vector3(...p0), new THREE.Vector3(...p1)], 0.08, 6, STEEL);
      g.cylinder(p0[0], p0[2], 21.9, 22.9, 0.35, 0.35, 8, STEEL, { cap: STEEL });
      const H0 = new THREE.Vector3(...at(u, -3.4, 25.2)), H1 = new THREE.Vector3(...at(u, -4.5, 26.1));
      const fly = new THREE.Vector3(-F.ux, 0, -F.uz).multiplyScalar(2.3);
      const stripe = (t0: number, t1: number, f0: number, f1: number, st: StyleSpec) => {
        const a = H0.clone().lerp(H1, t0).addScaledVector(fly, f0), b = H0.clone().lerp(H1, t0).addScaledVector(fly, f1);
        const c = H0.clone().lerp(H1, t1).addScaledVector(fly, f1), d = H0.clone().lerp(H1, t1).addScaledVector(fly, f0);
        g.quad3(a, b, c, d, st);
        g.quad3(a, d, c, b, st);
      };
      for (let k = 0; k < 7; k++) stripe(k / 7, (k + 1) / 7, k >= 3 ? 0.4 : 0, 1, k % 2 === 0 ? FLAG_RED : FLAG_WHITE);
      stripe(3 / 7, 1, 0, 0.4, FLAG_BLUE);
    }
  }
  // stone parapet band on the base roof
  g.prism(base, 24, 25.2, PARAPET, ROOF);

  // --- wings 6-20
  const s2 = F.rect(3, U - 3, 4.5, 118);
  g.prism(s2, 24, 79, STONE, null);
  g.prism(s2, 79, 80.1, PARAPET, ROOF);
  colliders.push({ ring: s2, y0: 24, y1: 79 });
  // --- 21-25, 26-30 (each setback roof carries its limestone parapet)
  const s3 = F.rect(6, U - 6, 8, 102), s4 = F.rect(9, U - 9, 12, 88);
  g.prism(s3, 79, 97, STONE, null);
  g.prism(s3, 97, 98.1, PARAPET, ROOF);
  g.prism(s4, 97, 115, STONE, null);
  g.prism(s4, 115, 116.1, PARAPET, ROOF);
  // --- main shaft 30-72: cross plan (wide central bays on the long faces)
  const shaft = crossRing(F, [8, U - 8, 28, 70], [12, U - 12, 18, 80]);
  g.prism(shaft, 115, 269, STONE, null);
  g.prism(shaft, 269, 270.1, PARAPET, ROOF);
  // --- 72-81 (floodlit from here up)
  const s6 = crossRing(F, [11, U - 11, 32, 66], [15, U - 15, 22, 76]);
  g.prism(s6, 269, 302, STONE_LIT(269), null);
  g.prism(s6, 302, 303.1, PARAPET, ROOF);
  // --- 81-85
  const s7 = crossRing(F, [14, U - 14, 36, 62], [18, U - 18, 28, 70]);
  g.prism(s7, 302, 318, STONE_LIT(302), ROOF);
  // observatory terrace parapet on the 86th floor setback
  g.prism(s7, 318, 319.3, { style: STYLE.PLAIN, p: [0.66, 0.62, 0.56, 0], p2: [0, 0, 0, 0] }, ROOF);
  // --- 86th floor pavilion
  const s8 = F.rect(19, U - 19, 31, 67);
  g.prism(s8, 318, 322.5, STONE_LIT(318), ROOF);

  // --- mooring mast 86-102: rounded, tapering, ribbed
  const cu = U / 2, cv = 49;
  const m0 = roundedRect(F, cu - 6.6, cu + 6.6, cv - 9, cv + 9, 2.6, 4);
  const m1 = roundedRect(F, cu - 5.2, cu + 5.2, cv - 6.2, cv + 6.2, 2.0, 4);
  g.loft(m0, 322.5, m1, 366, MAST_LIT(322.5), { cap: ROOF });
  // the vertical fins of the mast (4 per face) read as steel stripes: thin boxes
  for (let i = 0; i < 4; i++) {
    const t = -0.5 + (i + 0.5) / 4;
    for (const side of [-1, 1]) {
      const vv = cv + t * 11;
      const uu = cu + side * 5.6;
      g.box(F.toWorld(uu, vv)[0], 344, F.toWorld(uu, vv)[1], 0.5, 43, 0.45, F.angle, STEEL, STEEL);
    }
  }
  // 102nd floor: the round glass "dirigible dock" and the dome
  const ringC = circle(F.toWorld(cu, cv)[0], F.toWorld(cu, cv)[1], 5.2, 20);
  g.prism(ringC, 366, 371.5, { style: STYLE.GLASS, p: [2.7, 1.3, 0.9, 0], p2: [0, 0.9, 0, 0] }, null);
  g.loft(ringC, 371.5, circle(F.toWorld(cu, cv)[0], F.toWorld(cu, cv)[1], 3.4, 20), 376, MAST_LIT(360), { cap: null });
  g.loft(circle(F.toWorld(cu, cv)[0], F.toWorld(cu, cv)[1], 3.4, 20), 376, circle(F.toWorld(cu, cv)[0], F.toWorld(cu, cv)[1], 1.7, 20), 381, MAST_LIT(360), { cap: STEEL });

  // --- antenna 381-443
  const ax = F.toWorld(cu, cv)[0], az = F.toWorld(cu, cv)[1];
  g.cylinder(ax, az, 381, 400, 1.5, 1.1, 10, STEEL, { cap: null });
  g.cylinder(ax, az, 400, 425, 1.1, 0.7, 10, STEEL, { cap: null });
  g.cylinder(ax, az, 425, 443.2, 0.7, 0.3, 8, STEEL, { cap: STEEL });
  for (const [y, r] of [[394, 2.4], [411, 2.0], [428, 1.6]] as [number, number][]) g.cylinder(ax, az, y, y + 0.7, r, r, 10, STEEL, { cap: STEEL });
  // aviation beacons: blinking red at the tip, steady red ring at the antenna base and mast top
  g.cylinder(ax, az, 443.2, 444.3, 0.55, 0.55, 8, RED_BEACON, { cap: RED_BEACON });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bx = ax + Math.cos(a) * 2.2, bz = az + Math.sin(a) * 2.2;
    g.cylinder(bx, bz, 381.5, 382.3, 0.35, 0.35, 6, { ...RED_BEACON, p2: [5.0, 0.85, 0, 0] }, { cap: RED_BEACON });
  }
  // floodlight fixtures on the 72nd and 81st floor setbacks (white glow strips that bloom at night)
  for (const [ring, y] of [[s6, 269.2], [s7, 302.2]] as [Ring, number][]) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 8) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      g.box(mx, y + 0.35, mz, Math.min(len - 2, 30), 0.5, 0.6, Math.atan2(b[1] - a[1], b[0] - a[0]), WHITE_GLOW, WHITE_GLOW);
    }
  }

  return { body: g, colliders, center: F.toWorld(U / 2, 55) };
}
