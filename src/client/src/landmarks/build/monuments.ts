import * as THREE from 'three';
import { Frame, GeoBuilder, circle, type StyleSpec } from '../geom';
import { LIBERTY, WASHINGTON_ARCH } from '../data';
import { STYLE } from '../materials';
import type { Ring } from '@shared/world';

/** A real open arch, not a solid box: piers plus a segmented curved soffit and attic. */
export function buildWashingtonArch() {
  const a = WASHINGTON_ARCH;
  const f = Frame.fromBearing(a.cx, a.cz, a.bearing + 90);
  const body = new GeoBuilder();
  const stone: StyleSpec = { style: STYLE.MARBLE, p: [0, 0, 0, 0], p2: [0, 0, 1, 0] };
  const colliders: { ring: Ring; y0: number; y1: number }[] = [];
  for (const sign of [-1, 1]) {
    const ring = f.rect(sign < 0 ? -a.width / 2 : a.opening / 2, sign < 0 ? -a.opening / 2 : a.width / 2, -a.depth / 2, a.depth / 2);
    body.prism(ring, 0, a.atticBase, stone, stone);
    colliders.push({ ring, y0: 0, y1: a.atticBase });
  }
  const r = a.opening / 2;
  // Narrow vertical slices follow the semicircular opening without filling the passage below it.
  for (let i = 0; i < 24; i++) {
    const x0 = -r + 2 * r * i / 24, x1 = -r + 2 * r * (i + 1) / 24;
    const y = a.springing + Math.sqrt(Math.max(0, r * r - ((x0 + x1) / 2) ** 2));
    const ring = f.rect(x0, x1, -a.depth / 2, a.depth / 2);
    body.prism(ring, y, a.atticBase, stone, stone);
    body.cap(ring, y, stone, { down: true });
    colliders.push({ ring, y0: y, y1: a.atticBase });
  }
  const attic = f.rect(-a.width / 2, a.width / 2, -a.depth / 2, a.depth / 2);
  body.prism(attic, a.atticBase, a.top, stone, stone);
  colliders.push({ ring: attic, y0: a.atticBase, y1: a.top });
  for (const y of [a.atticBase, a.top - 0.6]) {
    body.prism(f.rect(-a.width / 2 - 0.35, a.width / 2 + 0.35, -a.depth / 2 - 0.35, a.depth / 2 + 0.35), y, y + 0.6, stone, stone);
  }
  return { body, colliders, center: [a.cx, a.cz] as [number, number] };
}

/** Distant low-poly silhouette, including pedestal (46 m), robe, crown and raised torch (93 m). */
export function buildLiberty() {
  const l = LIBERTY;
  const f = Frame.fromBearing(l.cx, l.cz, l.facing);
  const body = new GeoBuilder();
  const stone: StyleSpec = { style: STYLE.GRANITE, p: [0, 0, 0, 0], p2: [0, 0, 0.5, 0] };
  const copper: StyleSpec = { style: STYLE.COPPER, p: [0, 0, 0, 0] };
  const flame: StyleSpec = { style: STYLE.EMISSIVE, p: [1, 0.65, 0.15, 0], p2: [2, 0.5, 0, 0] };
  body.prism(f.rect(-15, 15, -15, 15), 0, 10, stone, stone);
  body.loft(f.rect(-10, 10, -10, 10), 10, f.rect(-7, 7, -7, 7), 46, stone, { cap: stone });
  body.loft(circle(l.cx, l.cz, 7, 12), 46, circle(l.cx, l.cz, 3, 12), 75, copper, { cap: copper });
  body.cylinder(l.cx, l.cz, 75, 81, 2.7, 2.3, 12, copper, { cap: copper });
  const p = (u: number, v: number, y: number) => { const xz = f.toWorld(u, v); return new THREE.Vector3(xz[0], y, xz[1]); };
  body.tube([p(0, 2, 72), p(1, 6, 80), p(2, 7, 89)], 1.2, 8, copper);
  body.tube([p(0, -2, 71), p(3, -4, 64)], 1.4, 8, copper);
  const torch = f.toWorld(2, 7);
  body.cylinder(torch[0], torch[1], 88, 91, 1.8, 1.2, 8, copper, { cap: copper });
  body.cylinder(torch[0], torch[1], 91, 93, 1.2, 0.05, 8, flame, { cap: flame });
  for (let i = 0; i < 7; i++) {
    const angle = Math.PI * 2 * i / 7;
    body.tube([p(Math.cos(angle) * 2.5, Math.sin(angle) * 2.5, 80), p(Math.cos(angle) * 5, Math.sin(angle) * 5, 83)], 0.25, 5, copper);
  }
  return { body, center: [l.cx, l.cz] as [number, number], colliders: [{ ring: f.rect(-15, 15, -15, 15), y0: 0, y1: 10 }] };
}
