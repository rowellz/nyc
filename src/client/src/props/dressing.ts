/**
 * Building-driven dressing: what the OSM prop data never carries but every Village block has
 * (refs/_sheets/west-village.png 1-2). Everything derives from the same wall segmentation, seeds and
 * hashes the buildings module bakes with, so a cafe sits under its own storefront and a flower box on
 * a window that is really there (no AC unit in it, buildings/shader.ts hash 70).
 *   - sidewalk cafe in front of a low-rise commercial shopfront on a sidewalk >= 3.4 m: a single row of
 *     two-tops against the wall, chairs facing the street, market umbrellas, a planter run of clipped
 *     boxwood on the path side, a chalkboard by the door
 *   - flower boxes on walk-up / row-house sills, upper floors only
 *   - the hardware under the awning the buildings module bakes over a shopfront (hash 21 < 0.45,
 *     shop wider than 3 m): the scalloped hem and the rafter/knee-brace frame, so it stops reading
 *     as one unsupported plane
 *   - bagged trash set out at the curb in front of about one street wall in seven
 */
import type { GameContext } from '@/core/context';
import type { RoadSegment, Tile } from '@shared/world';
import { buildingParams, windowColumns, windowOpening, STYLES } from '../buildings/styles';
import { hash4, seedOf } from '../buildings/hash';
import { normalizePolygon } from '../buildings/polygon';
import { shopSplit, SIGN_NAMES } from '../buildings/builder';
import { InstanceList, type TileStore } from './renderer';

/** streets/sidewalk.ts WALK_Y: the paving is a 0.15 m deck; the physics deck can commit after placement */
export const WALK_Y = 0.15;
/** mirrors buildings/builder.ts STREET_CLASSES: only these make a wall a street wall */
const STREET_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'pedestrian', 'living_street', 'unclassified']);
/** shop names (buildings/builder.ts SIGN_NAMES) that seat people outside */
const EATERIES = new Set(['PIZZA', 'BAGELS', 'DINER', 'COFFEE']);
export const CAFE_MIN_SIDEWALK = 3.4;
const TABLE_PITCH = 1.0;

function distToPolyline(x: number, z: number, pts: number[][]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0;
    const d = (a[0] + t * dx - x) ** 2 + (a[1] + t * dz - z) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export interface DressingCounts { cafes: number; tables: number; flowerBoxes: number }

/** Yields once per building so tile streaming stays incremental. */
export function* dressTileSteps(ctx: GameContext, tile: Tile, store: TileStore,
  solid?: (kind: string, x: number, y: number, z: number, yaw: number) => void, counts?: DressingCounts): Generator<void> {
  const roads = tile.roads.filter(r => !r.tunnel && STREET_CLASSES.has(r.cls));
  if (!roads.length) return;
  const add = (kind: string, x: number, y: number, z: number, yaw: number, scale = 1) => {
    let list = store.kinds.get(kind);
    if (!list) store.kinds.set(kind, list = new InstanceList());
    list.push(x, y, z, yaw, scale);
    solid?.(kind, x, y, z, yaw);
  };
  for (const b of tile.buildings) {
    yield;
    if (!Number.isFinite(b.height)) continue;
    const poly = normalizePolygon(b.footprint);
    if (!poly) continue;
    const outer = poly[0], h = Math.max(3, b.height);
    const seed = seedOf(b.id), P = buildingParams(b, seed), st = STYLES[P.style];
    // Cafes, awnings and sills are a low-rise, neighbourhood thing; towers get lobbies, not two-tops.
    const lowRise = h <= 30;
    const storefronts = lowRise && P.commercial && P.style !== 9 && P.style !== 10 && P.gfH >= 3.5;
    const sills = lowRise && (P.style === 0 || P.style === 1);
    // Bagged trash is the one thing every block face has, tower or walk-up: a coarse per-building gate
    // keeps the edge/road scan off the buildings that would produce nothing.
    const setOut = hash4(seed, 110, 0, 0) < 0.42;
    if (!storefronts && !sills && !setOut) continue;
    for (let i = 0; i < outer.length; i++) {
      const a = outer[i], c = outer[(i + 1) % outer.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 3) continue;
      const ux = dx / len, uz = dz / len, nx = uz, nz = -ux;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      // the builder's street test: a point 2.5 m outside the wall within the road's reach
      let road: RoadSegment | null = null, best = Infinity;
      for (const r of roads) {
        const d = distToPolyline(mx + nx * 2.5, mz + nz * 2.5, r.pts);
        if (d <= r.width / 2 + 7.5 && d < best) { best = d; road = r; }
      }
      if (!road) continue;
      const sidewalk = distToPolyline(mx, mz, road.pts) - road.width / 2;
      const wallIdx = i + 1;
      const yaw = Math.atan2(-nx, -nz); // local -z toward the street, +x along the wall
      const at = (u: number, out: number) => ({ x: a[0] + ux * u + nx * out, z: a[1] + uz * u + nz * out });
      const ground = Math.max(WALK_Y, ctx.physics.groundHeight(mx + nx * 1.5, mz + nz * 1.5));

      // Awning hardware. buildings/builder.ts storefronts() bakes the canvas from the same
      // shopSplit and the same hash 21: fascia at gfH - 0.8, front edge 1.6 m out and 0.8 m lower,
      // a 0.32 m valance. Anchor every piece on the wall plane at the front-edge height so the
      // rafters land under that slope and the hem under that valance.
      if (storefronts && len >= 4) {
        const { n, w } = shopSplit(len, seed, wallIdx);
        const yFront = P.gfH - 1.6;
        for (let sh = 0; sh < n; sh++) {
          if (!(w > 3 && hash4(seed, 21, wallIdx, sh) < 0.45)) continue;
          const au0 = sh * w + 0.25, span = w - 0.5;
          const hems = Math.max(3, Math.round(span / 1.04));
          for (let k = 0; k < hems; k++) {
            const q = at(au0 + (k + 0.5) * (span / hems), 0);
            add('awningHem', q.x, yFront, q.z, yaw);
          }
          const rigs = Math.max(2, Math.round(span / 2.4) + 1);
          for (let k = 0; k < rigs; k++) {
            const q = at(au0 + 0.12 + (span - 0.24) * (k / (rigs - 1)), 0);
            add('awningRig', q.x, yFront, q.z, yaw);
          }
        }
      }

      // Bagged set-out at the curb: ART_DIRECTION §4 gutter line. One street wall in seven, on the
      // roadway side of the walk so it sits in the gutter band, not against the shopfront.
      if (setOut && sidewalk >= 1.8 && hash4(seed, 111, wallIdx, 0) < 0.36) {
        const u = len * (0.28 + 0.44 * hash4(seed, 112, wallIdx, 0));
        const q = at(u, Math.max(0.8, sidewalk - 0.75));
        add('trashPile', q.x, Math.max(WALK_Y, ctx.physics.groundHeight(q.x, q.z)), q.z,
          yaw + (hash4(seed, 113, wallIdx, 0) - 0.5) * 0.5);
      }

      if (storefronts && len >= 4 && sidewalk >= CAFE_MIN_SIDEWALK) {
        const { n, w } = shopSplit(len, seed, wallIdx);
        for (let s = 0; s < n; s++) {
          if (w < 3.6) continue;
          const t = hash4(seed, 21, wallIdx, s);
          const awning = t < 0.45, lightbox = !awning && t < 0.8;
          const name = SIGN_NAMES[Math.floor(hash4(seed, 25, wallIdx, s) * SIGN_NAMES.length)];
          // The 16-name sign list under-counts restaurants for a Village block; unsigned fronts and a share
          // of awnings seat people too. Lightboxes read as delis and salons: those stay clear.
          const r = hash4(seed, 92, wallIdx, s);
          const cafe = EATERIES.has(name) ? r < 0.85 : !lightbox && r < 0.4;
          if (!cafe) continue;
          const u0 = s * w, u1 = (s + 1) * w;
          const doorU = u0 + w * (0.15 + 0.7 * hash4(seed, 23, wallIdx, s));
          const tables: number[] = [];
          for (let u = u0 + 0.75; u <= u1 - 0.75; u += TABLE_PITCH) if (Math.abs(u - doorU) >= 1.25) tables.push(u);
          if (tables.length < 2) continue;
          if (counts) { counts.cafes++; counts.tables += tables.length; }
          for (let k = 0; k < tables.length; k++) {
            const p = at(tables[k], 0.75);
            add('cafeTable', p.x, ground, p.z, yaw + (hash4(seed, 94, wallIdx, k) - 0.5) * 0.25);
          }
          // umbrellas in every second gap between tables (never at the door gap), one canvas per cafe
          const umbrella = hash4(seed, 95, wallIdx, s) < 0.55 ? 'umbrellaCream' : 'umbrellaGreen';
          for (let k = 0; k + 1 < tables.length; k += 2) {
            if (tables[k + 1] - tables[k] > TABLE_PITCH + 0.01) continue;
            const p = at((tables[k] + tables[k + 1]) / 2, 0.82);
            add(umbrella, p.x, ground, p.z, yaw + hash4(seed, 98, wallIdx, k) * Math.PI);
          }
          // planter run on the path side of the tables; open at the door gap and both ends
          const first = tables[0] - 0.45, last = tables[tables.length - 1] + 0.45;
          for (let u = first + 0.45; u <= last - 0.45 + 0.01; u += 1.1) {
            if (Math.abs(u - doorU) < 1.45) continue;
            const p = at(u, 1.3);
            add('cafePlanter', p.x, ground, p.z, yaw);
            add('shrub', p.x, ground + 0.4, p.z, yaw + hash4(seed, 99, wallIdx, Math.round(u * 10)) * Math.PI, 0.42);
          }
          // chalkboard beside the door, facing people walking along the block
          const side = doorU + 1.0 < u1 - 0.3 ? 1 : -1;
          const p = at(doorU + side * 0.95, 0.55);
          add('sandwichBoard', p.x, ground, p.z, yaw + Math.PI / 2);
        }
      }

      if (sills) {
        const cols = windowColumns(P.style, len);
        for (let fl = 1; fl < 12 && cols.count > 0; fl++) {
          const win = windowOpening(P.style, fl, P.gfH, P.floorH, h);
          if (!win) { if (fl > 1) break; continue; }
          for (let col = 0; col < cols.count; col++) {
            if (hash4(seed, 70, wallIdx * 128 + col, fl) < st.acFrac) continue; // an AC unit sits in that sash
            const r = hash4(seed, 96, wallIdx * 128 + col, fl);
            if (r > (P.style === 1 ? 0.2 : 0.12)) continue;
            if (counts) counts.flowerBoxes++;
            const p = at(cols.offset + (col + 0.5) * cols.spacing, 0.02);
            add(r < 0.07 ? 'flowerBox2' : 'flowerBox', p.x, win.bottom, p.z, yaw);
          }
        }
      }
    }
  }
}
