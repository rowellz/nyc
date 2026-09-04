/**
 * Grand Central Terminal (1913). The terminal building on its tile footprint (BIN 1035381): a Stony Creek
 * granite ground storey under the Park Avenue Viaduct's deck, Indiana limestone above. The 42nd Street
 * facade is the Beaux-Arts triumphal-arch front: three 18 m round-arched windows with their iron grilles in
 * 19 m bays, paired Corinthian columns on pedestals standing on the viaduct deck, the entablature with the
 * "GRAND CENTRAL TERMINAL" frieze, the cornice, and the Glory of Commerce sculpture group (Mercury between
 * Hercules and Minerva) with the 4 m Tiffany clock, 46 m above the street. In front of the facade, at deck
 * level, the terrace the roadways run past, over the entrance arcade.
 *
 * Laid out in a Frame at the midpoint of the south front: u uptown (into the building), v east along the
 * facade. Heights match streets/bridges.ts (layer-1 deck at 7 m).
 */
import * as THREE from 'three';
import { Frame, GeoBuilder, GRID_BEARING, ROOF, ccwRing, circle, signedArea, type StyleSpec, type XYZ } from '../geom';
import { GRAND_CENTRAL as T } from '../data';
import { STYLE } from '../materials';
import { inscribe } from '../letters';
import type { Ring } from '@shared/world';

export interface GctParts {
  body: GeoBuilder;
  colliders: { ring: Ring; y0: number; y1: number }[];
  center: [number, number];
  decks: { ring: Ring; height: number }[];
}

/** limestone with round-arched windows (STYLE.NYPL: bayW, winW, sill, archTop / baseTop, lit, flood, entablatureY) */
const arched = (bayW: number, winW: number, sill: number, apex: number, lit: number, flood = 0.6): StyleSpec => ({ style: STYLE.NYPL, p: [bayW, winW, sill, apex], p2: [0, lit, flood, 999] });
const STONE: StyleSpec = { style: STYLE.NYPL, p: [6, 0, 0, 0], p2: [0, 0, 0.5, 999] };
const STONE_DARK: StyleSpec = { style: STYLE.NYPL, p: [6, 0, 0, 0], p2: [0, 0, 0.3, 999] };
const GRANITE: StyleSpec = { style: STYLE.GRANITE, p: [0, 0, 0, 0], p2: [0, 0, 0.3, 0] };
const CORNICE: StyleSpec = { style: STYLE.PLAIN, p: [0.78, 0.75, 0.68, 0], p2: [0, 0, 0, 0] };
const SHADOW: StyleSpec = { style: STYLE.PLAIN, p: [0.46, 0.44, 0.40, 0], p2: [0, 0, 0, 0] };
const CARVED: StyleSpec = { style: STYLE.PLAIN, p: [0.30, 0.28, 0.25, 0], p2: [0, 0, 0, 0] };
const FIGURE: StyleSpec = { style: STYLE.PLAIN, p: [0.74, 0.70, 0.63, 0], p2: [0, 0, 0, 0] };
const PAVING: StyleSpec = { style: STYLE.CONCRETE, p: [0, 0, 0, 0], p2: [0, 0, 0, 0] };
const CLOCK_FACE: StyleSpec = { style: STYLE.PLAIN, p: [0.93, 0.91, 0.84, 0], p2: [0, 0, 0, 0] };
const BRONZE: StyleSpec = { style: STYLE.BRONZE, p: [0, 0, 0, 0], p2: [0, 0, 0, 0] };
const BALUSTRADE: StyleSpec = { style: STYLE.BALUSTER, p: [0.70, 0.66, 0.58, 0], p2: [0, 0, 0, 0] };

/**
 * The frame of the 42nd Street front: origin at the midpoint of the longest downtown-facing footprint edge,
 * u uptown (into the building), v east along the facade; `half` is half the facade length.
 */
export function facadeFrame(footprint: Ring = T.footprint): { F: Frame; half: number; edge: number } {
  const cw = signedArea(footprint) > 0;
  const down = Frame.fromBearing(0, 0, GRID_BEARING);
  let best = -1, bestLen = 0, bestI = 0;
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1) continue;
    let nx = dz / len, nz = -dx / len;
    if (!cw) { nx = -nx; nz = -nz; }
    const facing = -(nx * down.ux + nz * down.uz);
    if (facing > 0.9 && len > bestLen) { best = facing; bestLen = len; bestI = i; }
  }
  if (best < 0) { bestI = 0; bestLen = Math.hypot(footprint[1][0] - footprint[0][0], footprint[1][1] - footprint[0][1]); }
  const a = footprint[bestI], b = footprint[(bestI + 1) % footprint.length];
  const F = Frame.fromBearing((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, GRID_BEARING);
  return { F, half: bestLen / 2, edge: bestI };
}

export function buildGrandCentral(footprint: Ring = T.footprint): GctParts {
  const { F, half: hl, edge } = facadeFrame(footprint);
  const g = new GeoBuilder();
  const colliders: GctParts['colliders'] = [];
  const decks: GctParts['decks'] = [];
  const flip = signedArea(footprint) > 0;
  const U = new THREE.Vector3(F.ux, 0, F.uz), V = new THREE.Vector3(F.vx, 0, F.vz);
  const P = (u: number, v: number, y: number): XYZ => { const w = F.toWorld(u, v); return [w[0], y, w[1]]; };
  const along: [number, number] = [F.vx, F.vz];
  const south: [number, number] = [-F.ux, -F.uz];

  // ---- massing: granite ground storey, limestone above, roof --------------------------------------------
  g.walls(footprint, 0, T.base, GRANITE);
  const n = footprint.length;
  for (let i = 0; i < n; i++) {
    if (i === edge) continue;
    const a = footprint[i], b = footprint[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.3) continue;
    // long side elevations (Vanderbilt Ave / Depew Place) carry the concourse's arched windows in bays fitted to the wall
    const style = len > 40 ? arched(len / Math.max(1, Math.round(len / 13.5)), 6.5, T.sill, 26.0, 0.6, 0.4) : STONE_DARK;
    g.walls([a, b], T.base, T.roof, style, { closed: false, uStart: 0, flipNormals: flip });
  }
  g.cap(footprint, T.roof, ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: T.roof });

  // ---- the 42nd Street facade: end bays, the three great windows, the attic ---------------------------------
  const endW = hl - 1.5 * T.bay;
  // three walls with their own u = 0 so the bays are centred; an open wall from lower to higher v faces -u
  // (downtown), which is the facade's outward side
  const wall = (v0: number, v1: number, s: StyleSpec) => {
    g.walls([F.toWorld(0, v0), F.toWorld(0, v1)], T.base, T.attic, s, { closed: false, uStart: 0 });
  };
  wall(-hl, -hl + endW, arched(endW, 3.0, 14.0, 24.5, 0.5));
  wall(-hl + endW, hl - endW, arched(T.bay, T.archW, T.sill, T.apex, 1.0));
  wall(hl - endW, hl, arched(endW, 3.0, 14.0, 24.5, 0.5));
  // the attic parapet's inner face and top (the wall stands 1.5 m above the roof)
  g.walls([F.toWorld(0.6, hl), F.toWorld(0.6, -hl)], T.roof, T.attic, STONE_DARK, { closed: false });
  g.cap([F.toWorld(0, -hl), F.toWorld(0.6, -hl), F.toWorld(0.6, hl), F.toWorld(0, hl)], T.attic, CORNICE);

  // paired Corinthian columns on pedestals between and beside the arches, standing on the viaduct deck
  const piers = [-hl + endW / 2 + 0.5, -1.5 * T.bay, -0.5 * T.bay, 0.5 * T.bay, 1.5 * T.bay, hl - endW / 2 - 0.5];
  const colU = -1.35;
  for (const pier of piers) {
    for (const dv of [-1.25, 1.25]) {
      const v = pier + dv;
      const w = F.toWorld(colU, v);
      g.box(w[0], (T.deck + T.sill) / 2, w[1], 1.9, T.sill - T.deck, 1.9, F.angle, STONE, CORNICE);
      g.cylinder(w[0], w[1], T.sill, T.sill + 0.5, 0.95, 0.82, 12, STONE, { cap: STONE });
      g.cylinder(w[0], w[1], T.sill + 0.5, T.colTop, 0.82, 0.72, 12, STONE);
      g.loft(circle(w[0], w[1], 0.72, 8, Math.PI / 8), T.colTop, circle(w[0], w[1], 1.1, 8, Math.PI / 8), T.colTop + 1.4, CORNICE);
      g.box(w[0], T.colTop + 1.6, w[1], 2.3, 0.4, 2.3, F.angle, CORNICE, CORNICE, CORNICE);
    }
  }
  // entablature (architrave + frieze with the inscription), cornice, balustrade
  {
    const eU = -2.8;
    const c = F.toWorld(eU / 2, 0);
    g.box(c[0], (T.entablature + T.cornice) / 2, c[1], -eU, T.cornice - T.entablature, 2 * hl, F.angle, STONE, CORNICE, SHADOW);
    const c2 = F.toWorld(-1.75, 0);
    g.box(c2[0], T.cornice + 0.45, c2[1], 3.5, 0.9, 2 * hl + 1.0, F.angle, CORNICE, CORNICE, SHADOW);
    const frieze = F.toWorld(eU, 0);
    inscribe(g, new THREE.Vector3(frieze[0], T.entablature + 0.7, frieze[1]), V, U.clone().negate(), 'GRAND CENTRAL TERMINAL', 1.05, CARVED, { proud: 0.04 });
    // balustrade on the cornice either side of the sculpture group
    for (const [v0, v1] of [[-hl - 0.3, -10.5], [10.5, hl + 0.3]]) {
      g.hexa([P(-3.5, v0, T.cornice + 0.9), P(-3.5, v1, T.cornice + 0.9), P(-2.9, v1, T.cornice + 0.9), P(-2.9, v0, T.cornice + 0.9)], [P(-3.5, v0, T.cornice + 2.0), P(-3.5, v1, T.cornice + 2.0), P(-2.9, v1, T.cornice + 2.0), P(-2.9, v0, T.cornice + 2.0)], BALUSTRADE);
    }
  }
  // the Glory of Commerce: pedestal, Mercury with his wings, Hercules and Minerva seated, the clock
  {
    const pedY = T.cornice + 0.9;
    const pc = F.toWorld(-0.9, 0);
    g.box(pc[0], (pedY + T.attic + 1.6) / 2, pc[1], 3.4, T.attic + 1.6 - pedY, 19, F.angle, STONE, CORNICE);
    const y0 = T.attic + 1.6;
    const rect = (u0: number, u1: number, v0: number, v1: number) => ccwRing(F.rect(u0, u1, v0, v1));
    g.loft(rect(-1.9, 0.5, -1.6, 1.6), y0, rect(-1.5, 0.2, -0.95, 0.95), y0 + 6.2, FIGURE, { cap: FIGURE });
    const hc = F.toWorld(-0.65, 0);
    g.cylinder(hc[0], hc[1], y0 + 6.2, y0 + 7.6, 0.55, 0.45, 8, FIGURE, { cap: FIGURE });
    g.cylinder(hc[0], hc[1], y0 + 7.6, T.sculptureTop, 0.3, 0.05, 6, FIGURE, { cap: FIGURE });
    for (const side of [-1, 1]) {
      g.hexa([P(-1.4, side * 1.0, y0 + 2.2), P(-0.3, side * 1.0, y0 + 2.2), P(-0.3, side * 1.0, y0 + 6.0), P(-1.4, side * 1.0, y0 + 6.0)], [P(-1.1, side * 5.6, y0 + 5.2), P(-0.6, side * 5.6, y0 + 5.2), P(-0.6, side * 5.6, y0 + 8.6), P(-1.1, side * 5.6, y0 + 8.6)], FIGURE, { bottom: true });
      // seated figures
      g.loft(rect(-2.3, 0.6, side * 6.8 - 1.9, side * 6.8 + 1.9), y0, rect(-1.8, 0.2, side * 6.8 - 1.2, side * 6.8 + 1.2), y0 + 3.6, FIGURE, { cap: FIGURE });
      const fh = F.toWorld(-1.0, side * 6.8);
      g.cylinder(fh[0], fh[1], y0 + 3.6, y0 + 4.9, 0.5, 0.35, 8, FIGURE, { cap: FIGURE });
    }
    // the clock: opal face in a bronze bezel, on the pedestal's front below Mercury
    const rim = circle(0, 0, T.clock.r + 0.35, 20).map(([x, z]) => [x, T.clock.y + z] as [number, number]);
    const face = circle(0, 0, T.clock.r, 20).map(([x, z]) => [x, T.clock.y + z] as [number, number]);
    g.shape(P(-2.75, 0, 0), along, south, rim, [], BRONZE);
    g.shape(P(-2.85, 0, 0), along, south, face, [], CLOCK_FACE);
    g.box(pc[0], T.clock.y - T.clock.r - 0.9, pc[1], 3.6, 1.8, 6.0, F.angle, STONE, CORNICE);
  }

  // ---- the terrace at deck level along the facade, over the entrance arcade ---------------------------------
  {
    const depth = 5.4;
    const holes: [number, number][][] = [];
    const nA = 14, pitch = (2 * hl) / nA;
    for (let k = 0; k < nA; k++) {
      const c = (k + 0.5) * pitch, r = 1.7, spring = 3.6;
      const pts: [number, number][] = [[c - r, 0.02], [c + r, 0.02], [c + r, spring]];
      for (let j = 1; j < 10; j++) { const t = (j / 10) * Math.PI; pts.push([c + Math.cos(t) * r, spring + Math.sin(t) * r]); }
      pts.push([c - r, spring]);
      holes.push(pts);
    }
    g.shape(P(-depth, -hl, 0), along, south, [[0, 0], [2 * hl, 0], [2 * hl, T.deck], [0, T.deck]], holes, GRANITE);
    // arcade soffit line and the terrace top; the ends are closed
    const terr = ccwRing(F.rect(-depth, 0, -hl, hl));
    g.cap(terr, T.deck, PAVING, { uvScale: 1 });
    for (const side of [-1, 1]) {
      // from -depth to 0 the open wall faces +v (east): flip it on the west end
      g.walls([F.toWorld(-depth, side * hl), F.toWorld(0, side * hl)], 0, T.deck, GRANITE, { closed: false, flipNormals: side < 0 });
    }
    colliders.push({ ring: terr, y0: 0, y1: T.deck });
    decks.push({ ring: terr, height: T.deck });
  }

  return { body: g, colliders, center: [F.ox, F.oz], decks };
}
