/**
 * Flatiron Building (1902), 86.9 m. Real triangular footprint with the rounded prow; rusticated limestone base,
 * terracotta shaft with three projecting oriel bays on each long face (floors 7-17), the arcaded top floors and
 * the deep projecting cornice.
 */
import { GeoBuilder, ROOF, offsetRing, type StyleSpec } from '../geom';
import { STYLE } from '../materials';
import { FLATIRON } from '../data';
import type { Ring } from '@shared/world';

const FACADE: StyleSpec = { style: STYLE.FLATIRON, p: [3.66, 2.25, 1.35, 2.15], p2: [0, 0.3, 0, 0] };
const CORNICE: StyleSpec = { style: STYLE.PLAIN, p: [0.6, 0.53, 0.45, 0], p2: [0, 0, 0, 0] };
const PARAPET: StyleSpec = { style: STYLE.PLAIN, p: [0.63, 0.56, 0.48, 0], p2: [0, 0, 0, 0] };
const PENTHOUSE: StyleSpec = { style: STYLE.PLAIN, p: [0.45, 0.42, 0.4, 0], p2: [0, 0, 0, 0] };

export function buildFlatiron(footprint: Ring = FLATIRON.footprint): { body: GeoBuilder; colliders: { ring: Ring; y0: number; y1: number }[]; center: [number, number] } {
  const g = new GeoBuilder();
  const roof = FLATIRON.roof;
  g.prism(footprint, 0, roof, FACADE, null);
  // cornice: projecting slab with a shadow line under it
  const outer = offsetRing(footprint, 1.35);
  g.prism(outer, roof, roof + 2.4, CORNICE, null);
  g.cap(outer, roof, CORNICE, { down: true });
  g.cap(outer, roof + 2.4, PARAPET);
  // parapet + roof
  const par = offsetRing(footprint, 0.3);
  g.prism(par, roof + 2.4, FLATIRON.parapet, PARAPET, ROOF);
  // rooftop mechanical penthouse near the wide end
  {
    let cx = 0, cz = 0;
    for (const p of footprint) {
      cx += p[0];
      cz += p[1];
    }
    cx /= footprint.length;
    cz /= footprint.length;
    // shift toward the wide (south) end: the centroid already sits there
    g.box(cx, FLATIRON.parapet + 1.4, cz + 6, 9, 2.8, 5, 0.5, PENTHOUSE, PENTHOUSE);
  }
  // oriel bays on the two long faces (edges longer than 40 m), floors 7-17
  const n = footprint.length;
  for (let i = 0; i < n; i++) {
    const a = footprint[i], b = footprint[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 40) continue;
    const ex = dx / len, ez = dz / len;
    // outward normal, consistent with GeoBuilder.walls
    let nx = ez, nz = -ex;
    // signed area of the footprint decides the side
    let area = 0;
    for (let k = 0; k < n; k++) {
      const p = footprint[k], q = footprint[(k + 1) % n];
      area += p[0] * q[1] - q[0] * p[1];
    }
    if (area < 0) {
      nx = -nx;
      nz = -nz;
    }
    for (const t of [0.22, 0.5, 0.78]) {
      const s = t * len;
      const w = 3.6, out = 0.55;
      const ring: Ring = [
        [a[0] + ex * (s - w / 2) - nx * 0.3, a[1] + ez * (s - w / 2) - nz * 0.3],
        [a[0] + ex * (s + w / 2) - nx * 0.3, a[1] + ez * (s + w / 2) - nz * 0.3],
        [a[0] + ex * (s + w / 2) + nx * out, a[1] + ez * (s + w / 2) + nz * out],
        [a[0] + ex * (s - w / 2) + nx * out, a[1] + ez * (s - w / 2) + nz * out],
      ];
      g.prism(ring, 24.5, 62.5, { ...FACADE, p2: [0, 0.3, 0, 0] }, CORNICE, { uStart: s - w / 2 });
      // a little sill/base under each oriel
      g.cap(ring, 24.5, CORNICE, { down: true });
    }
  }
  let cx = 0, cz = 0;
  for (const p of footprint) {
    cx += p[0];
    cz += p[1];
  }
  return { body: g, colliders: [{ ring: footprint, y0: 0, y1: roof }], center: [cx / footprint.length, cz / footprint.length] };
}
