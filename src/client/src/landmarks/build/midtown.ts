/**
 * Midtown skyline towers seen from the rivers and Park Ave: One Vanderbilt, 432 Park, Citigroup Center, the
 * Bank of America Tower, the New York Times Building, the MetLife and Helmsley buildings, the UN Secretariat.
 * Real footprints from the tiles (data.ts), published heights. Each is a few hundred to a few thousand
 * triangles: silhouette, crown and facade rhythm; nothing that cannot be seen from 300 m.
 */
import { Frame, GeoBuilder, ROOF, GRID_BEARING, centroid, ccwRing, facetLoft, lift, notchedRect, offsetRing, type StyleSpec, type XYZ } from '../geom';
import { STYLE } from '../materials';
import { BOFA, CITIGROUP, FOUR32_PARK, HELMSLEY, METLIFE, NYT, ONE_VANDERBILT, UN, VIADUCT } from '../data';
import type { Ring } from '@shared/world';

export interface TowerParts {
  body: GeoBuilder;
  colliders: { ring: Ring; y0: number; y1: number }[];
  center: [number, number];
  decks?: { ring: Ring; height: number }[];
}

/** STYLE.CURTAIN: palette 0 dark aluminium, 1 terracotta, 2 white concrete, 3 precast grey, 4 ceramic white, 5 limestone, 6 weathered steel, 7 white aluminium */
export const curtain = (floorH: number, bayW: number, winW: number, winH: number, lit: number, palette: number, rods = 0, tint = 0): StyleSpec => ({ style: STYLE.CURTAIN, p: [floorH, bayW, winW, winH], p2: [lit, palette, rods, tint] });
export const paint = (r: number, g: number, b: number, rough = 0.5): StyleSpec => ({ style: STYLE.PAINT, p: [r, g, b, rough], p2: [0, 0, 0, 0] });
export const plain = (r: number, g: number, b: number): StyleSpec => ({ style: STYLE.PLAIN, p: [r, g, b, 0], p2: [0, 0, 0, 0] });
const RED_BEACON: StyleSpec = { style: STYLE.EMISSIVE, p: [1.0, 0.08, 0.05, 0], p2: [5.0, 0.85, 1.0, 0.5] };
const STEEL = paint(0.62, 0.63, 0.66, 0.4);

export function frameOf(footprint: Ring): { F: Frame; c: [number, number]; b: { u0: number; u1: number; v0: number; v1: number } } {
  const c = centroid(footprint);
  const F = Frame.fromBearing(c[0], c[1], GRID_BEARING);
  return { F, c: [c[0], c[1]], b: F.bounds(footprint) };
}
/** a frame rectangle lifted to 3D with a height per corner from its local (u, v) */
export function rect3(F: Frame, u0: number, u1: number, v0: number, v1: number, h: (u: number, v: number) => number): XYZ[] {
  return F.rect(u0, u1, v0, v1).map(([x, z]) => {
    const [u, v] = F.toLocal(x, z);
    return [x, h(u, v), z] as XYZ;
  });
}
export function beacon(g: GeoBuilder, x: number, z: number, y: number): void {
  g.cylinder(x, z, y, y + 1.0, 0.45, 0.45, 6, RED_BEACON, { cap: RED_BEACON });
}

export function buildOneVanderbilt(footprint: Ring = ONE_VANDERBILT.footprint): TowerParts {
  const { F, c, b } = frameOf(footprint);
  const T = ONE_VANDERBILT;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  const TERRA = curtain(4.6, 3.0, 2.5, 3.4, 0.4, 1);
  const LOBBY = curtain(6.0, 3.0, 2.85, 5.4, 0.9, 0);
  const cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2, hu = (b.u1 - b.u0) / 2, hv = (b.v1 - b.v0) / 2;
  g.prism(footprint, 0, T.lobby, LOBBY, null);
  colliders.push({ ring: footprint, y0: 0, y1: T.lobby });
  // one tapering shaft, then the four interlocking volumes each ending in a slope rising toward the spire
  const k1 = 0.86, k2 = 0.76;
  const r0 = F.rect(b.u0, b.u1, b.v0, b.v1);
  const r1 = F.rect(cu - hu * k1, cu + hu * k1, cv - hv * k1, cv + hv * k1);
  g.loft(r0, T.lobby, r1, T.shaft, TERRA, { cap: null });
  colliders.push({ ring: r0, y0: T.lobby, y1: T.shaft });
  for (const q of T.fins) {
    const uu = q.su > 0 ? [cu, cu + hu * k1] : [cu - hu * k1, cu];
    const vv = q.sv > 0 ? [cv, cv + hv * k1] : [cv - hv * k1, cv];
    const uu2 = q.su > 0 ? [cu, cu + hu * k2] : [cu - hu * k2, cu];
    const vv2 = q.sv > 0 ? [cv, cv + hv * k2] : [cv - hv * k2, cv];
    const lo = rect3(F, uu[0], uu[1], vv[0], vv[1], () => T.shaft);
    const hi = rect3(F, uu2[0], uu2[1], vv2[0], vv2[1], (u, v) => q.top - q.drop * 0.5 * (Math.abs(u - cu) / (hu * k2) + Math.abs(v - cv) / (hv * k2)));
    facetLoft(g, lo, hi, TERRA, ROOF);
  }
  const tallest = T.fins[0];
  const sp = F.toWorld(cu + tallest.su * hu * k2 * 0.45, cv + tallest.sv * hv * k2 * 0.45);
  const y0 = tallest.top - tallest.drop * 0.45 - 2;
  g.cylinder(sp[0], sp[1], y0, y0 + 24, 3.5, 1.2, 8, STEEL, { cap: null });
  g.cylinder(sp[0], sp[1], y0 + 24, T.spireTop, 1.2, 0.3, 8, STEEL, { cap: STEEL });
  beacon(g, sp[0], sp[1], T.spireTop);
  return { body: g, colliders, center: c };
}

export function build432Park(footprint: Ring = FOUR32_PARK.footprint): TowerParts {
  const { F, c } = frameOf(footprint);
  const T = FOUR32_PARK;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  const CONC = curtain(T.floorH, T.bay, T.win, T.win, 0.3, 2);
  const OPEN = curtain(T.floorH, T.bay, T.win, T.win, 0, 2, 0, -1);
  g.prism(footprint, 0, 10, curtain(5.0, 4.75, 3.4, 3.8, 0.6, 2), ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: 10 });
  const sq = F.rect(T.cu - T.half, T.cu + T.half, T.cv - T.half, T.cv + T.half);
  let y = 0;
  for (const fl of T.openFloors) {
    const y0 = fl * T.floorH, y1 = y0 + 2 * T.floorH;
    g.walls(sq, y, y0, CONC);
    g.walls(sq, y0, y1, OPEN);
    y = y1;
  }
  g.walls(sq, y, T.roof, CONC);
  g.prism(sq, T.roof, T.roof + 1.2, plain(0.80, 0.78, 0.74), ROOF);
  colliders.push({ ring: sq, y0: 0, y1: T.roof });
  return { body: g, colliders, center: c };
}

export function buildCitigroup(footprint: Ring = CITIGROUP.footprint): TowerParts {
  const { F, c } = frameOf(footprint);
  const T = CITIGROUP;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  const ALU = curtain(3.9, 1.5, 1.4, 1.95, 0.35, 7);
  const WHITE = paint(0.80, 0.81, 0.82, 0.45);
  g.prism(footprint, 0, 12, curtain(4.0, 3.0, 2.7, 3.2, 0.5, 0), ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: 12 });
  // the tower floats on the core and four stilts at the middle of its sides
  const core = F.rect(T.cu - 7, T.cu + 7, T.cv - 7, T.cv + 7);
  g.prism(core, 0, T.stiltH, paint(0.30, 0.31, 0.33, 0.5), null);
  colliders.push({ ring: core, y0: 0, y1: T.stiltH });
  for (const [du, dv] of [[-T.half + 3.65, 0], [T.half - 3.65, 0], [0, -T.half + 3.65], [0, T.half - 3.65]]) {
    const p = F.toWorld(T.cu + du, T.cv + dv);
    g.box(p[0], T.stiltH / 2, p[1], 7.3, T.stiltH, 7.3, F.angle, WHITE, null, null);
    colliders.push({ ring: F.rect(T.cu + du - 3.65, T.cu + du + 3.65, T.cv + dv - 3.65, T.cv + dv + 3.65), y0: 0, y1: T.stiltH });
  }
  const sq = F.rect(T.cu - T.half, T.cu + T.half, T.cv - T.half, T.cv + T.half);
  g.cap(sq, T.stiltH, plain(0.5, 0.5, 0.5), { down: true });
  g.walls(sq, T.stiltH, T.slopeBase, ALU);
  colliders.push({ ring: sq, y0: T.stiltH, y1: T.top });
  // the 45° crown: one plane from the south edge up to the north edge
  const lo = lift(sq, T.slopeBase);
  const hi = sq.map(([x, z]) => {
    const [u] = F.toLocal(x, z);
    return [x, T.slopeBase + ((u - (T.cu - T.half)) / (2 * T.half)) * (T.top - T.slopeBase), z] as XYZ;
  });
  facetLoft(g, lo, hi, WHITE, WHITE);
  return { body: g, colliders, center: c };
}

export function buildBankOfAmerica(footprint: Ring = BOFA.footprint): TowerParts {
  const { F, c } = frameOf(footprint);
  const T = BOFA;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  // pale crystal: dark glass behind thin white-aluminium mullions; the facets separate by shading
  const GL = curtain(4.4, 1.5, 1.4, 4.0, 0.35, 7);
  g.prism(footprint, 0, T.podium, GL, ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: T.podium });
  const lo: XYZ[] = T.base.map(([u, v]) => { const p = F.toWorld(u, v); return [p[0], T.podium, p[1]]; });
  const hi: XYZ[] = T.crown.map(([u, v, y]) => { const p = F.toWorld(u, v); return [p[0], y, p[1]]; });
  facetLoft(g, lo, hi, GL, ROOF);
  colliders.push({ ring: lo.map((p) => [p[0], p[2]] as [number, number]), y0: T.podium, y1: 250 });
  const sp = F.toWorld(T.spire[0], T.spire[1]);
  const y0 = Math.max(...T.crown.map((q) => q[2]));
  g.cylinder(sp[0], sp[1], y0 - 2, y0 + 40, 2.4, 1.0, 8, STEEL, { cap: null });
  g.cylinder(sp[0], sp[1], y0 + 40, T.spireTop, 1.0, 0.25, 8, STEEL, { cap: STEEL });
  beacon(g, sp[0], sp[1], T.spireTop);
  return { body: g, colliders, center: c };
}

export function buildNYTimes(footprint: Ring = NYT.footprint): TowerParts {
  const { F, c } = frameOf(footprint);
  const T = NYT;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  const CER = curtain(4.3, 1.5, 1.38, 3.3, 0.35, 4, 1);
  g.prism(footprint, 0, T.podium, curtain(4.3, 1.5, 1.38, 3.3, 0.5, 0), ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: T.podium });
  const tower = notchedRect(F, T.u0, T.u1, T.v0, T.v1, 3.5, 3.5);
  g.prism(tower, T.podium, T.roof, CER, ROOF);
  colliders.push({ ring: tower, y0: T.podium, y1: T.roof });
  // the ceramic-rod screen continues above the roof as an open lattice
  const rail = paint(0.85, 0.85, 0.83, 0.6);
  const ring = F.rect(T.u0, T.u1, T.v0, T.v1);
  for (let i = 0; i < 4; i++) {
    const a = ring[i], b = ring[(i + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const n = Math.round(len / 4);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      g.box(a[0] + (b[0] - a[0]) * t, T.roof + T.screen / 2, a[1] + (b[1] - a[1]) * t, 0.35, T.screen, 0.35, ang, rail, rail);
    }
    for (const y of [T.roof + 4, T.roof + 9, T.roof + 14]) g.box((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2, len, 0.25, 0.25, ang, rail, rail);
  }
  const m = F.toWorld(T.mast[0], T.mast[1]);
  g.cylinder(m[0], m[1], T.roof, T.roof + 52, 1.6, 0.8, 8, STEEL, { cap: null });
  g.cylinder(m[0], m[1], T.roof + 52, T.mastTop, 0.8, 0.25, 8, STEEL, { cap: STEEL });
  beacon(g, m[0], m[1], T.mastTop);
  return { body: g, colliders, center: c };
}

export function buildMetLife(footprint: Ring = METLIFE.footprint): TowerParts {
  const { F, c } = frameOf(footprint);
  const T = METLIFE;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  const PRE = curtain(3.66, 1.83, 1.1, 1.85, 0.35, 3);
  g.prism(footprint, 0, T.base, PRE, ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: T.base });
  const oct = ccwRing(T.slab.map(([u, v]) => F.toWorld(T.cu + u, T.cv + v)));
  g.walls(oct, T.base, T.crown, PRE);
  g.prism(oct, T.crown, T.roof, plain(0.50, 0.49, 0.47), ROOF);
  colliders.push({ ring: oct, y0: T.base, y1: T.roof });
  return { body: g, colliders, center: c };
}

export function buildHelmsley(footprint: Ring = HELMSLEY.footprint): TowerParts {
  const { F, c, b } = frameOf(footprint);
  const T = HELMSLEY;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  const LIME: StyleSpec = { style: STYLE.LIMESTONE, p: [3.9, 2.9, 1.5, 2.3], p2: [0, 0.3, 0.5, 0] };
  const COPPER: StyleSpec = { style: STYLE.COPPER, p: [0, 0, 0, 0], p2: [0, 0, 0, 0] };
  const GOLD = paint(0.85, 0.65, 0.25, 0.35);
  const cv = T.cv;
  g.prism(footprint, 0, T.base, LIME, ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: T.base });
  const CORNICE = plain(0.62, 0.58, 0.51);
  const cornice = (ring: Ring, y: number) => g.prism(offsetRing(ring, 0.7), y - 1.3, y, CORNICE, ROOF);
  cornice(footprint, T.base);
  const mid = F.rect(b.u0 + 5, b.u1 - 5, b.v0 + 6, b.v1 - 6);
  g.prism(mid, T.base, T.setback, LIME, ROOF);
  cornice(mid, T.setback);
  const tower = F.rect(-22, 22, cv - 20, cv + 20);
  g.prism(tower, T.setback, T.tower, LIME, ROOF);
  cornice(tower, T.tower);
  colliders.push({ ring: tower, y0: T.base, y1: T.tower });
  g.prism(F.rect(-16, 16, cv - 14, cv + 14), T.tower, T.tower + 8, LIME, ROOF);
  g.loft(F.rect(-15, 15, cv - 13, cv + 13), T.tower + 8, F.rect(-5, 5, cv - 4, cv + 4), T.pyramid, COPPER, { cap: COPPER });
  const p = F.toWorld(0, cv);
  g.cylinder(p[0], p[1], T.pyramid, T.pyramid + 6, 4.5, 4.5, 12, GOLD, { cap: GOLD });
  g.cylinder(p[0], p[1], T.pyramid + 6, T.pyramid + 14, 3.0, 3.0, 12, GOLD, { cap: null });
  g.cylinder(p[0], p[1], T.pyramid + 14, T.top - 4, 3.0, 0.4, 12, GOLD, { cap: null });
  g.cylinder(p[0], p[1], T.top - 4, T.top, 0.4, 0.1, 6, GOLD, { cap: GOLD });
  // the viaduct portals: round-arched openings where the two roadways enter the south face at deck level
  // (VIADUCT.helmsleySouth) and leave the north face at grade (helmsleyNorth), with their limestone
  // archivolts; between them on both faces the pedestrian arcade of the Park Avenue passage
  const DARK = paint(0.05, 0.05, 0.06, 0.6);
  const SURROUND = plain(0.62, 0.58, 0.51);
  const archHole = (c: number, y0: number, r: number, spring: number): [number, number][] => {
    const pts: [number, number][] = [[c - r, y0], [c + r, y0], [c + r, spring]];
    for (let j = 1; j < 12; j++) { const t = (j / 12) * Math.PI; pts.push([c + Math.cos(t) * r, spring + Math.sin(t) * r]); }
    pts.push([c - r, spring]);
    return pts;
  };
  const along: [number, number] = [F.vx, F.vz];
  for (const [entries, u, sign, y0] of [[VIADUCT.helmsleySouth, b.u0, -1, VIADUCT.deck], [VIADUCT.helmsleyNorth, b.u1, 1, 0]] as [[number, number][], number, number, number][]) {
    const normal: [number, number] = [F.ux * sign, F.uz * sign];
    const vs = entries.map(([x, z]) => F.toLocal(x, z)[1]);
    const face = (proud: number, y: number): [number, number, number] => { const w = F.toWorld(u + sign * proud, 0); return [w[0], y, w[1]]; };
    for (const v of vs) {
      const r = 4.7, spring = y0 + 7.0;
      g.shape(face(0.12, 0), along, normal, archHole(v, y0 - 0.6, r + 0.9, spring), [], SURROUND);
      g.shape(face(0.3, 0), along, normal, archHole(v, y0, r, spring), [], DARK);
    }
    // the arcade: five arches between the portals at street level
    const mid = (vs[0] + vs[1]) / 2;
    for (let k = -2; k <= 2; k++) {
      const v = mid + k * 5.4;
      g.shape(face(0.12, 0), along, normal, archHole(v, -0.3, 2.3, 4.6), [], SURROUND);
      g.shape(face(0.3, 0), along, normal, archHole(v, 0, 1.7, 4.6), [], DARK);
    }
  }
  return { body: g, colliders, center: c };
}

export function buildUnSecretariat(footprint: Ring = UN.footprint): TowerParts {
  const { F, c, b } = frameOf(footprint);
  const T = UN;
  const g = new GeoBuilder();
  const GREEN = curtain(T.floorH, 1.6, 1.5, 2.4, 0.35, 0, 0, 1);
  const MARB: StyleSpec = { style: STYLE.MARBLE, p: [0, 0, 0, 0], p2: [0, 0, 0.3, 0] };
  const ring = ccwRing(footprint);
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], bb = ring[(i + 1) % n];
    const dx = bb[0] - a[0], dz = bb[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    const alongAvenue = Math.abs((dx * F.ux + dz * F.uz) / len) > 0.7;
    g.walls([a, bb], 0, T.roof, alongAvenue ? GREEN : MARB, { closed: false });
  }
  g.cap(ring, T.roof, ROOF);
  const off = offsetRing(ring, 0.2);
  for (const fl of T.louvers) g.walls(off, fl * T.floorH, (fl + 1) * T.floorH, paint(0.20, 0.21, 0.22, 0.6));
  g.prism(F.rect(b.u0 + 8, b.u1 - 8, b.v0 + 3, b.v1 - 3), T.roof, T.roof + 5, plain(0.30, 0.30, 0.31), ROOF);
  return { body: g, colliders: [{ ring, y0: 0, y1: T.roof }], center: c };
}
