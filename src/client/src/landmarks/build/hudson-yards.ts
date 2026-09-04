/**
 * Hudson Yards from the river: 30 Hudson Yards (the wedge with the Edge deck), 35 Hudson Yards (limestone,
 * rounded corners), 10 Hudson Yards (sloped roof) and 55 Hudson Yards (weathered-steel grid). The tiles tag 10
 * and 55 with their podium heights only, so these replace 24-45 m boxes with the real towers.
 */
import { GeoBuilder, ROOF, ccwRing, facetLoft, lift, roundedRect, type StyleSpec, type XYZ } from '../geom';
import { STYLE } from '../materials';
import { HY10, HY30, HY35, HY55 } from '../data';
import { curtain, frameOf, paint, plain, type TowerParts } from './midtown';
import type { Ring } from '@shared/world';

/** dark blue-grey vision glass in thin aluminium mullions: from the river these towers read darker than the sky (STYLE.GLASS mirrors it and vanishes) */
const GLASS = (lit: number): StyleSpec => curtain(4.0, 1.5, 1.4, 3.5, lit, 0);
const RAIL: StyleSpec = { style: STYLE.GLASS, p: [4.0, 1.5, 1.1, 0], p2: [0, 0, 0, 0] };

export function build30HudsonYards(footprint: Ring = HY30.footprint): TowerParts {
  const { F, c } = frameOf(footprint);
  const T = HY30;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  const GL = GLASS(0.35);
  g.prism(footprint, 0, T.podium, GLASS(0.6), ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: T.podium });
  const r0 = F.rect(T.u0, T.u1, T.v0, T.v1);
  g.walls(r0, T.podium, T.shoulder0, GL);
  colliders.push({ ring: r0, y0: T.podium, y1: T.roofLow });
  // the "shoulders": two tapers, then the roof plane rising from the south edge to the north edge
  const r1 = F.rect(T.u0 + 4, T.u1 - 4, T.v0 + 4, T.v1 - 4);
  g.loft(r0, T.shoulder0, r1, T.shoulder1, GL, { cap: null });
  const r2 = F.rect(T.u0 + 8, T.u1 - 8, T.v0 + 8, T.v1 - 8);
  g.loft(r1, T.shoulder1, r2, T.roofLow, GL, { cap: null });
  const hi = r2.map(([x, z]) => {
    const [u] = F.toLocal(x, z);
    const t = (u - (T.u0 + 8)) / (T.u1 - T.u0 - 16);
    return [x, T.roofLow + t * (T.roofHigh - T.roofLow), z] as XYZ;
  });
  facetLoft(g, lift(r2, T.roofLow), hi, GL, ROOF);
  // Edge: the triangular deck on the 100th floor, steel underside, concrete top, glass parapet
  const deck = ccwRing(T.deck.map(([u, v]) => F.toWorld(u, v)));
  const DARK = paint(0.18, 0.19, 0.21, 0.5);
  g.walls(deck, T.deckY - 3.5, T.deckY, DARK);
  g.cap(deck, T.deckY - 3.5, DARK, { down: true });
  g.cap(deck, T.deckY, plain(0.55, 0.54, 0.52));
  g.walls(deck, T.deckY, T.deckY + 2.8, RAIL);
  return { body: g, colliders, center: c, decks: [{ ring: deck, height: T.deckY }] };
}

export function build35HudsonYards(footprint: Ring = HY35.footprint): TowerParts {
  const { F, c } = frameOf(footprint);
  const T = HY35;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  const LIME = curtain(3.6, 3.0, 2.0, 2.7, 0.35, 5);
  g.prism(footprint, 0, T.podium, LIME, ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: T.podium });
  const tower = roundedRect(F, -26, 26, -22, 22, 7);
  g.prism(tower, T.podium, T.setback, LIME, ROOF);
  colliders.push({ ring: tower, y0: T.podium, y1: T.roof });
  g.prism(roundedRect(F, -22, 22, -18, 18, 6), T.setback, T.roof, plain(0.70, 0.66, 0.58), ROOF);
  return { body: g, colliders, center: c };
}

export function build10HudsonYards(footprint: Ring = HY10.footprint): TowerParts {
  const { F, c } = frameOf(footprint);
  const T = HY10;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  const GL = GLASS(0.35);
  g.prism(footprint, 0, T.podium, GLASS(0.6), ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: T.podium });
  const r = F.rect(T.u0, T.u1, T.v0, T.v1);
  g.walls(r, T.podium, T.roofLow, GL);
  colliders.push({ ring: r, y0: T.podium, y1: T.roofHigh });
  const hi = r.map(([x, z]) => {
    const [u] = F.toLocal(x, z);
    const t = (T.u1 - u) / (T.u1 - T.u0);
    return [x, T.roofLow + t * (T.roofHigh - T.roofLow), z] as XYZ;
  });
  facetLoft(g, lift(r, T.roofLow), hi, GL, ROOF);
  return { body: g, colliders, center: c };
}

export function build55HudsonYards(footprint: Ring = HY55.footprint): TowerParts {
  const { F, c } = frameOf(footprint);
  const T = HY55;
  const g = new GeoBuilder();
  const colliders: TowerParts['colliders'] = [];
  g.prism(footprint, 0, T.podium, GLASS(0.5), ROOF);
  colliders.push({ ring: footprint, y0: 0, y1: T.podium });
  const r = F.rect(T.u0, T.u1, T.v0, T.v1);
  g.prism(r, T.podium, T.roof, curtain(4.0, 3.0, 2.55, 3.3, 0.35, 6), ROOF);
  colliders.push({ ring: r, y0: T.podium, y1: T.roof });
  return { body: g, colliders, center: c };
}
