/**
 * Tile geometry builder (pure TS, runs in builder.worker.ts or on the main thread as a fallback).
 *
 * Output per tile: ONE merged near geometry (walls, roofs, parapets, cornices, and every baked prop:
 * water towers, bulkheads, HVAC, AC units, stoops, fences, awnings, lightboxes, balconies, beacons),
 * plus a simple collider mesh (walls + roofs) for Rapier.
 *
 * Vertex layout (all Float32):
 *   position xyz (tile-relative), normal xyz, uv (u metres along the wall, v metres above ground),
 *   color rgb (tint), aInfo (tierTop, floorH, style*65536+seed, partyH), aWall (wallLen, flags, gfH, kind)
 */
import type { Building, RoadSegment, Ring, Polygon, Pt } from '@shared/world';
import { hash4, seedOf } from './hash';
import {
  STYLES, KIND_WALL, KIND_ROOF, KIND_TRIM, KIND_LIGHTBOX, KIND_AWNING, KIND_BEACON, KIND_GLASS,
  FLAG_STREET, FLAG_COMMERCIAL, FLAG_PAINTED, FLAG_METAL, FLAG_BALCONIES, FLAG_DENTILS, FLAG_RESIDENTIAL_DOOR,
  FLAG_TEXT0, FLAG_TEXT1, FLAG_SETBACK_TIER, FLAG_WALL_SHIFT, FLAG_LOUVRE,
  SIGN_NAME_ROWS, SIGN_NEON_ROWS,
  buildingParams, windowColumns, windowOpening, floorBase, type BuildingParams,
} from './styles';
import { normalizePolygon, area2, ringBBox, ringCentroid, pointInRing, pointInPolygon, triangulate, insetOrScale, insetRing, orientedBox, distToPolyline } from './polygon';
import { splitCollider, type ColliderChunk } from './transfer';
import type { LandmarkRange } from './landmarks';

export const SIGN_NAMES = ['DELI GROCERY', 'PIZZA', 'NAIL SALON', 'LAUNDROMAT', 'PHARMACY', 'BAGELS', 'DRY CLEANERS', 'CHECK CASHING', 'SMOKE SHOP', 'HARDWARE', 'DINER', 'PSYCHIC', 'LIQUORS', 'COFFEE', 'TAILOR', 'FLOWERS'];
/** total rows in the sign atlas: the names, then the neon accent artwork (styles.ts SIGN_NEON_ROWS) */
export const SIGN_ROWS = SIGN_NAME_ROWS + SIGN_NEON_ROWS;
export { SIGN_NAME_ROWS, SIGN_NEON_ROWS };

export interface BuildInput {
  key: string;
  tx: number;
  tz: number;
  buildings: Building[];
  roads: RoadSegment[];
  landmarkBins: number[]; // candidates: retain fallbacks until landmarks reports completion
  /** neighbouring tiles' buildings (for party-wall tests at tile borders); optional */
  neighbours?: Building[];
  quality: 'low' | 'medium' | 'high' | 'ultra';
}

export interface BuiltTile {
  key: string;
  ox: number;
  oz: number;
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  info: Float32Array;
  wall: Float32Array;
  index: Uint32Array;
  renderIndex: Uint32Array;
  bounds: { cx: number; cy: number; cz: number; r: number };
  colPos: Float32Array; // tile-relative (body placed at the tile origin)
  colIdx: Uint32Array;
  landmarkRanges: LandmarkRange[];
  landmarkColliderRanges: LandmarkRange[];
  /** per building: id, minX, minZ, maxX, maxZ, height (for the main-thread lookup index) */
  lookup: Float64Array;
  grid: Int32Array[];
  colliders: ColliderChunk[];
  stats: { ms: number; verts: number; tris: number; buildings: number; skipped: number };
}

const PARAPET_H = 0.6;
const STREET_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'pedestrian', 'living_street', 'unclassified']);

/** growable float array */
class F32 {
  a: Float32Array;
  n = 0;
  constructor(cap = 1 << 16) {
    this.a = new Float32Array(cap);
  }
  ensure(extra: number): void {
    if (this.n + extra <= this.a.length) return;
    let cap = this.a.length * 2;
    while (cap < this.n + extra) cap *= 2;
    const b = new Float32Array(cap);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
  push3(x: number, y: number, z: number): void {
    this.ensure(3);
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  push2(x: number, y: number): void {
    this.ensure(2);
    this.a[this.n++] = x;
    this.a[this.n++] = y;
  }
  push4(x: number, y: number, z: number, w: number): void {
    this.ensure(4);
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
    this.a[this.n++] = w;
  }
  slice(): Float32Array {
    return this.a.slice(0, this.n);
  }
}
class U32 {
  a: Uint32Array;
  n = 0;
  constructor(cap = 1 << 16) {
    this.a = new Uint32Array(cap);
  }
  push3(x: number, y: number, z: number): void {
    if (this.n + 3 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a.subarray(0, this.n));
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  slice(): Uint32Array {
    return this.a.slice(0, this.n);
  }
}

interface VAttrs {
  r: number;
  g: number;
  b: number;
  tierTop: number;
  floorH: number;
  styleSeed: number;
  partyH: number;
  wallLen: number;
  flags: number;
  gfH: number;
  kind: number;
}

interface Edge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  len: number;
  nx: number; // outward normal
  nz: number;
  dx: number; // unit direction
  dz: number;
  street: boolean;
  partyH: number; // height of an abutting neighbour (0 = free wall)
  idx: number;
}

export function buildTile(input: BuildInput): BuiltTile {
  const t0 = performance.now();
  const ox = input.tx * 256, oz = input.tz * 256;
  const land = new Set(input.landmarkBins);
  const B = new Baker(ox, oz);
  const roads = input.roads.filter((r) => !r.tunnel && STREET_CLASSES.has(r.cls)).map((r) => ({ r, bb: polylineBBox(r.pts, r.width / 2 + 12) }));
  // neighbour footprints for party-wall tests
  const all: { b: Building; poly: Polygon; bb: ReturnType<typeof ringBBox>; h: number }[] = [];
  const normalized = new Map<number, Polygon>();
  for (const b of [...input.buildings, ...(input.neighbours ?? [])]) {
    const poly = normalizePolygon(b.footprint);
    if (!poly) continue;
    normalized.set(b.id, poly);
    all.push({ b, poly, bb: ringBBox(poly[0]), h: Math.max(3, b.height) });
  }
  const lookup: number[] = [];
  const landmarkRanges: LandmarkRange[] = [], landmarkColliderRanges: LandmarkRange[] = [];
  let built = 0, skipped = 0;
  const quality = input.quality;
  const rich = quality !== 'low';

  for (const b of input.buildings) {
    const poly = normalized.get(b.id);
    if (!poly) {
      skipped++;
      continue;
    }
    const outer = poly[0];
    const indexStart = B.idx.n, colliderStart = B.cidx.n;
    const bb = ringBBox(outer);
    const h = Math.max(3, b.height);
    lookup.push(b.id, bb.minX, bb.minZ, bb.maxX, bb.maxZ, h);
    const seed = seedOf(b.id);
    const P = buildingParams(b, seed);
    const styleSeed = P.style * 65536 + seed;
    const st = STYLES[P.style];
    const areaM2 = Math.abs(area2(outer)) / 2;

    // ---- edges of the outer ring: street facing + party walls --------------------------------------
    const edges: Edge[] = [];
    const n = outer.length;
    for (let i = 0; i < n; i++) {
      const a = outer[i], c = outer[(i + 1) % n];
      const dx = c[0] - a[0], dz = c[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const ux = dx / len, uz = dz / len;
      const nx = uz, nz = -ux;
      const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      let street = false;
      if (len >= 2.5) {
        const px = mx + nx * 2.5, pz = mz + nz * 2.5;
        for (const { r, bb: rb } of roads) {
          if (px < rb.minX || px > rb.maxX || pz < rb.minZ || pz > rb.maxZ) continue;
          if (distToPolyline(px, pz, r.pts) <= r.width / 2 + 7.5) {
            street = true;
            break;
          }
        }
      }
      // party wall: sample points just outside the wall inside another footprint
      let partyH = 0;
      if (!street) {
        for (const s of [0.25, 0.5, 0.75]) {
          const px = a[0] + dx * s + nx * 0.35, pz = a[1] + dz * s + nz * 0.35;
          for (const o of all) {
            if (o.b.id === b.id) continue;
            if (px < o.bb.minX || px > o.bb.maxX || pz < o.bb.minZ || pz > o.bb.maxZ) continue;
            if (pointInPolygon(px, pz, o.poly)) {
              if (o.h > partyH) partyH = o.h;
              break;
            }
          }
        }
      }
      edges.push({ ax: a[0], az: a[1], bx: c[0], bz: c[1], len, nx, nz, dx: ux, dz: uz, street, partyH, idx: i });
    }
    if (!edges.length) {
      skipped++;
      continue;
    }
    if (!edges.some((e) => e.street)) {
      // every building has a front: the longest free wall
      let best: Edge | null = null;
      for (const e of edges) if (!best || (e.partyH === 0 && e.len > best.len) || (best.partyH > 0 && e.partyH === 0)) best = e;
      if (best) best.street = true;
    }
    let entrance: Edge | null = null;
    for (const e of edges) if (e.street && (!entrance || e.len > entrance.len)) entrance = e;

    // ---- tiers (setbacks) -------------------------------------------------------------------------
    const pitched = b.roofShape === 'pitched' && h < 16 && areaM2 < 400;
    interface Tier { ring: Ring; holes: Ring[]; base: number; top: number; edges: Edge[] }
    const tiers: Tier[] = [];
    if (b.roofShape === 'setback' && h > 60) {
      const r1 = insetOrScale(outer, 3.5);
      const r2 = r1 ? insetOrScale(r1, 3.5) : null;
      if (r1 && r2) {
        tiers.push({ ring: outer, holes: poly.slice(1), base: 0, top: h * 0.55, edges });
        tiers.push({ ring: r1, holes: [], base: h * 0.55, top: h * 0.82, edges: ringEdges(r1, true) });
        tiers.push({ ring: r2, holes: [], base: h * 0.82, top: h, edges: ringEdges(r2, true) });
      } else if (r1) {
        tiers.push({ ring: outer, holes: poly.slice(1), base: 0, top: h * 0.7, edges });
        tiers.push({ ring: r1, holes: [], base: h * 0.7, top: h, edges: ringEdges(r1, true) });
      } else tiers.push({ ring: outer, holes: poly.slice(1), base: 0, top: h, edges });
    } else tiers.push({ ring: outer, holes: poly.slice(1), base: 0, top: h, edges });

    const baseFlags = (P.commercial ? FLAG_COMMERCIAL : 0) | (P.painted ? FLAG_PAINTED : 0) | (P.balconies ? FLAG_BALCONIES : 0);
    const parapetH = pitched ? 0 : P.style === 5 ? 1.0 : PARAPET_H;
    const roofMat = roofMaterial(seed);
    const roofCol: [number, number, number] = roofPalette(seed, roofMat);

    for (let ti = 0; ti < tiers.length; ti++) {
      const T = tiers[ti];
      const wallTop = T.top + parapetH;
      const tierFlag = ti > 0 ? FLAG_SETBACK_TIER : 0;
      const va: VAttrs = { r: P.tint[0], g: P.tint[1], b: P.tint[2], tierTop: T.top, floorH: P.floorH, styleSeed, partyH: 0, wallLen: 0, flags: 0, gfH: P.gfH, kind: KIND_WALL };
      // walls
      const rings: { ring: Ring; edges: Edge[] }[] = [{ ring: T.ring, edges: T.edges }];
      for (const hole of T.holes) rings.push({ ring: hole, edges: ringEdges(hole, false) });
      for (const { edges: es } of rings) {
        for (const e of es) {
          va.wallLen = e.len;
          va.partyH = e.partyH;
          va.flags = baseFlags | tierFlag | (e.street ? FLAG_STREET : 0) | (e === entrance ? FLAG_RESIDENTIAL_DOOR : 0) | (e.idx + 1) * FLAG_WALL_SHIFT;
          const y1 = pitched ? T.top - 2.4 : wallTop;
          B.wallQuad(e, T.base, y1, va);
          B.colWall(e, T.base, y1);
          // cornice on street-facing walls of the top of each tier
          if (st.cornice && e.street && e.partyH < T.top - 1 && !pitched && rich) B.cornice(e, T.ring, T.top + parapetH, st.cornice, P, seed);
        }
      }
      // roof
      if (pitched) B.gableRoof(T.ring, T.top - 2.4, T.top, P, roofCol, va);
      else {
        const inner = insetRing(T.ring, 0.28);
        if (inner) {
          const rv: VAttrs = { ...va, kind: KIND_ROOF, r: roofCol[0], g: roofCol[1], b: roofCol[2], flags: roofMat };
          B.cap([inner, ...T.holes], T.top, rv);
          // inner parapet faces + coping
          const pv: VAttrs = { ...va, kind: KIND_TRIM, flags: baseFlags, gfH: 0.9, partyH: 0 };
          B.parapet(T.ring, inner, T.top, wallTop, pv, P);
        } else {
          const rv: VAttrs = { ...va, kind: KIND_ROOF, r: roofCol[0], g: roofCol[1], b: roofCol[2], flags: roofMat };
          B.cap([T.ring, ...T.holes], wallTop, rv);
        }
      }
      B.colCap([T.ring, ...T.holes], T.top);
    }

    // ---- roof props on the top tier -------------------------------------------------------------
    const top = tiers[tiers.length - 1];
    if (!pitched && rich) {
      // A tower's mechanical screen paves nearly its whole roof, so build it FIRST and treat its deck as the
      // roof surface: the plant that belongs up there then sits on the screen instead of being buried under
      // its cap, which is what left every glass and concrete tower reading as one empty slab from the air.
      const screen = (P.style === 5 || P.style === 6) && h > 40 && Math.abs(area2(top.ring)) / 2 > 300
        ? B.mechScreen(top.ring, top.top, seed, P, roofCol, roofMat)
        : null;
      const propRing = screen ? screen.ring : top.ring;
      const propY = screen ? screen.y : top.top;
      const obb = orientedBox(propRing);
      const frontMid: Pt = entrance ? [(entrance.ax + entrance.bx) / 2, (entrance.az + entrance.bz) / 2] : ringCentroid(outer);
      const spots = roofSpots(propRing, obb, frontMid, seed);
      const topArea = Math.abs(area2(propRing)) / 2;
      let spotI = 0;
      const used: { x: number; z: number; r: number }[] = [];
      const take = (w: number, d: number): { x: number; z: number; ux: number; uz: number } | null => {
        const r = Math.hypot(w, d) / 2;
        for (; spotI < spots.length; spotI++) {
          const s = spots[spotI];
          if (!boxFits(propRing, s.x, s.z, obb.ux, obb.uz, w / 2 + 0.4, d / 2 + 0.4)) continue;
          let clear = true;
          for (const o of used) if (Math.hypot(s.x - o.x, s.z - o.z) < r + o.r + 0.35) { clear = false; break; }
          if (!clear) continue;
          spotI++;
          used.push({ x: s.x, z: s.z, r });
          return { x: s.x, z: s.z, ux: obb.ux, uz: obb.uz };
        }
        return null;
      };
      // stair bulkhead (rear)
      if (h > 9 && topArea > 70) {
        const s = take(3, 4);
        if (s) B.bulkhead(s.x, propY, s.z, s.ux, s.uz, 3, 4, 2.9, P);
      }
      // water tower
      if (b.hasWaterTower && topArea > 90 && h > 9) {
        const s = take(4.2, 4.2);
        if (s) B.waterTower(s.x, propY, s.z, seed);
      }
      // HVAC: condenser banks, not one lonely box. A Midtown roof of any size carries a row of them.
      if (topArea > 90 && h > 6) {
        const cnt = Math.min(6, Math.max(1, Math.round(topArea / 320)) + (topArea > 250 ? 1 : 0));
        for (let k = 0; k < cnt; k++) {
          const s = take(1.6, 1.2);
          if (!s) break;
          if (hash4(seed, 51 + k) < 0.45) B.condensers(s.x, propY, s.z, s.ux, s.uz, seed, k);
          else B.hvac(s.x, propY, s.z, s.ux, s.uz, hash4(seed, 50 + k));
        }
      }
      // duct run: galvanised rectangular trunk on sleepers between the bulkhead and the air handler
      if (topArea > 220 && h > 8 && hash4(seed, 52) < 0.55) {
        const s = take(1.0, 5.0);
        if (s) B.duct(s.x, propY, s.z, s.ux, s.uz, 3.5 + hash4(seed, 53) * 4.5);
      }
      // cooling tower on offices and lofts: louvred box with a fan cowl on top
      if (topArea > 400 && h > 28 && hash4(seed, 54) < 0.5) {
        const s = take(3.2, 2.4);
        if (s) B.coolingTower(s.x, propY, s.z, s.ux, s.uz, seed);
      }
      // roof hatch: an aluminium lid on a 30 cm curb, on anything without a bulkhead
      if (topArea > 40 && !(h > 9 && topArea > 70)) {
        const s = take(1.1, 0.9);
        if (s) B.roofHatch(s.x, propY, s.z, s.ux, s.uz);
      }
      // skylights: loft and industrial roofs, a run of two or three curbed lights
      if ((P.style === 3 || P.style === 7 || P.style === 8) && topArea > 200 && hash4(seed, 55) < 0.6) {
        for (let k = 0; k < 3; k++) {
          const s = take(2.0, 1.6);
          if (!s) break;
          B.skylight(s.x, propY, s.z, s.ux, s.uz, 1.8, 1.4);
        }
      }
      // brick chimney stack: walk-ups, brownstones and tenements all keep theirs
      if (h < 30 && (P.style === 0 || P.style === 1 || P.style === 2 || P.style === 4) && topArea > 40) {
        const s = take(0.9, 0.7);
        if (s) B.chimney(s.x, propY, s.z, s.ux, s.uz, 1.6 + hash4(seed, 56) * 1.4, P);
      }
      // rooftop deck: decking, a table and two chairs, on a fraction of the residential walk-ups
      if (h > 9 && h < 40 && topArea > 130 && !P.commercial && hash4(seed, 57) < 0.28) {
        const s = take(4.0, 3.4);
        if (s) B.roofDeck(s.x, propY, s.z, s.ux, s.uz, seed);
      }
      // cell antennas and a satellite dish or two, on the taller residentials and every office
      if (h > 20 && topArea > 100 && hash4(seed, 58) < 0.5) {
        const s = take(1.2, 1.2);
        if (s) B.dish(s.x, propY, s.z, s.ux, s.uz, 0.55 + hash4(seed, 59) * 0.5);
      }
      // vent pipes: a cluster of soil stacks, never a single pipe in the middle of the roof
      if (topArea > 60) {
        const c = ringCentroid(propRing);
        if (pointInRing(c[0], c[1], propRing)) {
          const n = topArea > 400 ? 4 : topArea > 150 ? 3 : 2;
          for (let k = 0; k < n; k++) {
            const a = hash4(seed, 62, k) * 6.283, r = 1.2 + hash4(seed, 63, k) * Math.min(6, Math.sqrt(topArea) * 0.25);
            const px = c[0] + Math.cos(a) * r, pz = c[1] + Math.sin(a) * r;
            if (pointInRing(px, pz, propRing)) B.pipe(px, propY, pz, 0.055 + hash4(seed, 64, k) * 0.08, 0.7 + hash4(seed, 65, k) * 1.1);
          }
        }
      }
      // aviation beacon + antenna
      if (h > 150) {
        const c = ringCentroid(propRing);
        B.beacon(c[0], propY, c[1], seed);
      } else if (h > 60 && hash4(seed, 60) < 0.2) {
        const c = ringCentroid(propRing);
        if (pointInRing(c[0], c[1], propRing)) B.antenna(c[0], propY, c[1], 6 + hash4(seed, 61) * 6);
      }
    }

    // ---- facade props on the base tier ----------------------------------------------------------
    if (rich) {
      for (const e of edges) {
        if (e.partyH >= h - 1) continue;
        // AC units in windows
        if (st.acFrac > 0 && e.len > 3) B.acUnits(e, P, seed, tiers[0].top, st.acFrac);
        // balconies
        if (P.balconies && e.street && e.len > 5) B.balconies(e, P, h);
        if (!e.street) continue;
        // glass tower: the entrance wall is a double-height lobby (shader cwLobby) under a cantilevered canopy
        const cwLobby = P.style === 5 && e === entrance && e.len > 8 && P.gfH >= 4.5;
        if (cwLobby) B.glassCanopy(e, seed);
        // storefronts
        if (P.commercial && e.len >= 4 && P.style !== 9 && P.style !== 10 && P.gfH >= 3.5 && !cwLobby) B.storefronts(e, P, seed);
        // brownstone stoop + areaway fence
        if (P.style === 1 && e === entrance && e.len >= 4.5 && h > 6) B.stoop(e, P, seed);
        // apartment-house lobby: canvas canopy on two posts over the glazed entrance (shader `lobby`)
        const lobby = P.style === 2 || P.style === 4 || P.style === 6 || (P.style === 7 && h > 15);
        if (!P.commercial && lobby && e === entrance && e.len >= 5 && h > 12 && hash4(seed, 38, wallIdx(e)) < 0.6) B.canopy(e, P, seed);
      }
    }
    if (land.has(b.id)) {
      landmarkRanges.push({ bin: b.id, start: indexStart, count: B.idx.n - indexStart });
      landmarkColliderRanges.push({ bin: b.id, start: colliderStart, count: B.cidx.n - colliderStart });
    }
    built++;
  }

  const out = B.finish();
  const cells: number[][] = Array.from({ length: 256 }, () => []);
  const buildingIndex = new Map<number, number>();
  input.buildings.forEach((b, i) => { if (!buildingIndex.has(b.id)) buildingIndex.set(b.id, i); });
  for (let i = 0; i < lookup.length; i += 6) {
    const bi = buildingIndex.get(lookup[i]);
    if (bi === undefined) continue;
    const x0 = Math.max(0, Math.floor((lookup[i + 1] - ox) / 16)), x1 = Math.min(15, Math.floor((lookup[i + 3] - ox) / 16));
    const z0 = Math.max(0, Math.floor((lookup[i + 2] - oz) / 16)), z1 = Math.min(15, Math.floor((lookup[i + 4] - oz) / 16));
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) cells[z * 16 + x].push(bi);
  }
  const colliders = splitCollider(out.colPos, out.colIdx, landmarkColliderRanges);
  const ms = performance.now() - t0;
  return {
    key: input.key,
    ox,
    oz,
    ...out,
    renderIndex: landmarkRanges.length ? out.index.slice() : out.index,
    lookup: new Float64Array(lookup),
    grid: cells.map(c => Int32Array.from(c)),
    colliders,
    landmarkRanges,
    landmarkColliderRanges,
    stats: { ms, verts: out.position.length / 3, tris: out.index.length / 3, buildings: built, skipped },
  };
}

/**
 * Roof covering per building. New York roofs are overwhelmingly dark: mopped asphalt / tar cap sheet,
 * with silver aluminium coating on maybe a third, pea-gravel ballast on the older flats and grey
 * single-ply on the recent recoats. docs/ART_DIRECTION.md §3: tar 0.06, silver-coat 0.40, gravel 0.25.
 * The old palette sat at 0.20-0.62, which is why every aerial frame read as pale empty slabs.
 */
export const ROOF_TAR = 0, ROOF_SILVER = 1, ROOF_GRAVEL = 2, ROOF_SINGLEPLY = 3;
export function roofMaterial(seed: number): number {
  const t = hash4(seed, 40);
  return t < 0.28 ? ROOF_SILVER : t < 0.5 ? ROOF_GRAVEL : t < 0.86 ? ROOF_TAR : ROOF_SINGLEPLY;
}
/** membrane tone for a covering; per-building age and batch variation so a block of roofs is never one grey */
export function roofPalette(seed: number, mat: number): [number, number, number] {
  const v = 0.84 + hash4(seed, 43) * 0.32; // age: a fresh coat against one twenty summers old
  const w = hash4(seed, 44);
  switch (mat) {
    case ROOF_SILVER: {
      // sprayed aluminium, dulling toward grey as the leafing pigment weathers
      const a = 0.40 * v * (0.78 + 0.34 * w);
      return [a, a * 0.995, a * 0.97];
    }
    case ROOF_GRAVEL: {
      // pea gravel over a built-up roof: warm buff, darker where the tar bleeds through
      const a = 0.25 * v * (0.82 + 0.3 * w);
      return [a * 1.06, a, a * 0.84];
    }
    case ROOF_SINGLEPLY: {
      // grey EPDM / dirty TPO
      const a = 0.30 * v * (0.85 + 0.25 * w);
      return [a * 0.98, a, a * 1.03];
    }
    default: {
      // asphalt cap sheet: black new, chalking to a dusty charcoal
      const a = 0.075 * v * (0.7 + 0.9 * w);
      return [a * 1.05, a, a * 0.94];
    }
  }
}

function wallIdx(e: Edge): number {
  return e.idx + 1;
}

function polylineBBox(pts: Pt[], pad: number) {
  const bb = ringBBox(pts);
  return { minX: bb.minX - pad, minZ: bb.minZ - pad, maxX: bb.maxX + pad, maxZ: bb.maxZ + pad };
}

function ringEdges(ring: Ring, street: boolean): Edge[] {
  const out: Edge[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], c = ring[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const ux = dx / len, uz = dz / len;
    out.push({ ax: a[0], az: a[1], bx: c[0], bz: c[1], len, nx: uz, nz: -ux, dx: ux, dz: uz, street, partyH: 0, idx: i });
  }
  return out;
}

/**
 * Candidate roof prop positions: the OBB corners (rear first), then a jittered 3.2 m lattice over the
 * rest of the roof, still ordered rear-to-front. A real roof is cluttered end to end; the four-corner
 * list left every roof over ~300 m2 with one box on it and acres of empty membrane.
 */
function roofSpots(ring: Ring, obb: ReturnType<typeof orientedBox>, front: Pt, seed: number): { x: number; z: number }[] {
  const vx = -obb.uz, vz = obb.ux;
  const corners: { x: number; z: number; d: number }[] = [];
  const lattice: { x: number; z: number; d: number }[] = [];
  const at = (x: number, z: number) => ({ x, z, d: Math.hypot(x - front[0], z - front[1]) });
  for (const ins of [2.6, 4.5]) {
    const hl = obb.halfL - ins, hw = obb.halfW - ins;
    if (hl <= 0.5 || hw <= 0.5) continue;
    for (const su of [-1, 1]) for (const sv of [-1, 1]) corners.push(at(obb.cx + obb.ux * hl * su + vx * hw * sv, obb.cz + obb.uz * hl * su + vz * hw * sv));
  }
  const step = 3.2;
  const nu = Math.min(7, Math.floor((obb.halfL - 2.2) / step) * 2 + 1);
  const nv = Math.min(7, Math.floor((obb.halfW - 2.2) / step) * 2 + 1);
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const cu = (i - (nu - 1) / 2) * step + (hash4(seed, 66, i, j) - 0.5) * 1.3;
      const cv = (j - (nv - 1) / 2) * step + (hash4(seed, 67, i, j) - 0.5) * 1.3;
      lattice.push(at(obb.cx + obb.ux * cu + vx * cv, obb.cz + obb.uz * cu + vz * cv));
    }
  corners.sort((a, b) => b.d - a.d);
  lattice.sort((a, b) => b.d - a.d);
  // corners first, unchanged: the far worker (far.worker.ts) picks the bulkhead and water tower off the same
  // four-corner list, and a tower that jumped when a tile loaded would be worse than an empty roof
  return [...corners, { x: obb.cx, z: obb.cz, d: 0 }, ...lattice];
}

function boxFits(ring: Ring, x: number, z: number, ux: number, uz: number, hu: number, hv: number): boolean {
  const vx = -uz, vz = ux;
  for (const su of [-1, 1])
    for (const sv of [-1, 1]) {
      if (!pointInRing(x + ux * hu * su + vx * hv * sv, z + uz * hu * su + vz * hv * sv, ring)) return false;
    }
  return pointInRing(x, z, ring);
}

/** shop segmentation of a commercial street-facing wall; identical to the shader */
export function shopSplit(wallLen: number, seed: number, wallIdx: number): { n: number; w: number } {
  const base = 7 + hash4(seed, 20, wallIdx) * 5;
  const n = Math.max(1, Math.round(wallLen / base));
  return { n, w: wallLen / n };
}

/** index shared with the shader's shop palette (hash 24) so the canvas matches the fascia: solid dark canvas (west-village 1-3) */
const AWNING_COLORS: [number, number, number][] = [
  [0.03, 0.03, 0.03], // black
  [0.05, 0.16, 0.09], // hunter green
  [0.28, 0.05, 0.07], // burgundy
  [0.06, 0.09, 0.22], // navy
  [0.5, 0.06, 0.05], // red
  [0.12, 0.12, 0.13], // charcoal
];
/** atlas v for sign-kind faces that carry no lettering (beyond the last row: the shader never samples the atlas) */
const NO_TEXT = SIGN_ROWS + 1;
const LIGHTBOX_COLORS: [number, number, number][] = [
  [0.95, 0.95, 0.9], // white
  [0.95, 0.85, 0.2], // yellow
  [0.8, 0.12, 0.1], // red
  [0.1, 0.2, 0.55], // blue
];

class Baker {
  pos = new F32();
  nrm = new F32();
  uv = new F32();
  col = new F32();
  info = new F32();
  wall = new F32();
  idx = new U32();
  cpos = new F32(1 << 14);
  cidx = new U32(1 << 14);
  minX = Infinity; minY = Infinity; minZ = Infinity; maxX = -Infinity; maxY = -Infinity; maxZ = -Infinity;

  constructor(public ox: number, public oz: number) {}

  private vcount(): number {
    return this.pos.n / 3;
  }

  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, a: VAttrs): number {
    const rx = x - this.ox, rz = z - this.oz;
    this.pos.push3(rx, y, rz);
    this.nrm.push3(nx, ny, nz);
    this.uv.push2(u, v);
    this.col.push3(a.r, a.g, a.b);
    this.info.push4(a.tierTop, a.floorH, a.styleSeed, a.partyH);
    this.wall.push4(a.wallLen, a.flags, a.gfH, a.kind);
    if (rx < this.minX) this.minX = rx;
    if (rx > this.maxX) this.maxX = rx;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    if (rz < this.minZ) this.minZ = rz;
    if (rz > this.maxZ) this.maxZ = rz;
    return this.vcount() - 1;
  }

  /** quad p0..p3 (any order forming a loop) with the given normal; winding fixed to face the normal */
  quad(p: number[], nx: number, ny: number, nz: number, uvs: number[], a: VAttrs): void {
    const base = this.vcount();
    for (let i = 0; i < 4; i++) this.vert(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], nx, ny, nz, uvs[i * 2], uvs[i * 2 + 1], a);
    // orientation of (p0,p1,p2)
    const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
    const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * nx + cy * ny + cz * nz >= 0) {
      this.idx.push3(base, base + 1, base + 2);
      this.idx.push3(base, base + 2, base + 3);
    } else {
      this.idx.push3(base, base + 2, base + 1);
      this.idx.push3(base, base + 3, base + 2);
    }
  }

  wallQuad(e: Edge, y0: number, y1: number, a: VAttrs): void {
    this.quad([e.ax, y0, e.az, e.bx, y0, e.bz, e.bx, y1, e.bz, e.ax, y1, e.az], e.nx, 0, e.nz, [0, y0, e.len, y0, e.len, y1, 0, y1], a);
  }

  colWall(e: Edge, y0: number, y1: number): void {
    const base = this.cpos.n / 3;
    this.cpos.push3(e.ax - this.ox, y0, e.az - this.oz);
    this.cpos.push3(e.bx - this.ox, y0, e.bz - this.oz);
    this.cpos.push3(e.bx - this.ox, y1, e.bz - this.oz);
    this.cpos.push3(e.ax - this.ox, y1, e.az - this.oz);
    this.cidx.push3(base, base + 2, base + 1);
    this.cidx.push3(base, base + 3, base + 2);
  }

  colCap(poly: Polygon, y: number): void {
    const tris = triangulate(poly);
    if (!tris.length) return;
    const base = this.cpos.n / 3;
    for (const ring of poly) for (const [x, z] of ring) this.cpos.push3(x - this.ox, y, z - this.oz);
    for (let i = 0; i < tris.length; i += 3) this.cidx.push3(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
  }

  /** flat horizontal cap over a polygon (normal up), uv = world xz */
  cap(poly: Polygon, y: number, a: VAttrs): void {
    const tris = triangulate(poly);
    if (!tris.length) return;
    const base = this.vcount();
    const pts: Pt[] = [];
    for (const ring of poly) for (const p of ring) pts.push(p);
    for (const [x, z] of pts) this.vert(x, y, z, 0, 1, 0, x, z, a);
    for (let i = 0; i < tris.length; i += 3) {
      const p = pts[tris[i]], q = pts[tris[i + 1]], r = pts[tris[i + 2]];
      // +y facing: CCW seen from above in (x, z) with y up means negative shoelace in (x,z)
      const s = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
      if (s < 0) this.idx.push3(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
      else this.idx.push3(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
    }
  }

  /** inner parapet faces (from the inset ring up to the wall top) + coping strip */
  parapet(outer: Ring, inner: Ring, roofY: number, topY: number, a: VAttrs, P: BuildingParams): void {
    const n = outer.length;
    if (inner.length !== n) return;
    const stone = P.style === 2 || P.style === 4 || P.style === 9 ? [0.72, 0.7, 0.64] : P.style === 5 ? [0.35, 0.36, 0.38] : [0.55, 0.53, 0.5];
    const cop: VAttrs = { ...a, r: stone[0], g: stone[1], b: stone[2], gfH: 0.75, kind: KIND_TRIM };
    for (let i = 0; i < n; i++) {
      const a0 = outer[i], a1 = outer[(i + 1) % n], b0 = inner[i], b1 = inner[(i + 1) % n];
      const dx = b1[0] - b0[0], dz = b1[1] - b0[1];
      const len = Math.hypot(dx, dz) || 1;
      // inner face: normal points INTO the roof (opposite of the outward normal)
      const nx = -dz / len, nz = dx / len;
      this.quad([b0[0], roofY, b0[1], b1[0], roofY, b1[1], b1[0], topY, b1[1], b0[0], topY, b0[1]], nx, 0, nz, [0, roofY, len, roofY, len, topY, 0, topY], a);
      // coping
      this.quad([a0[0], topY, a0[1], a1[0], topY, a1[1], b1[0], topY, b1[1], b0[0], topY, b0[1]], 0, 1, 0, [0, 0, len, 0, len, 0.3, 0, 0.3], cop);
    }
  }

  /** gable roof over the oriented box of the ring; walls end at eaveY, ridge at ridgeY */
  gableRoof(ring: Ring, eaveY: number, ridgeY: number, P: BuildingParams, roofCol: [number, number, number], a: VAttrs): void {
    const obb = orientedBox(ring);
    const vx = -obb.uz, vz = obb.ux;
    const hl = obb.halfL + 0.3, hw = obb.halfW + 0.3;
    const rv: VAttrs = { ...a, kind: KIND_TRIM, r: 0.3, g: 0.28, b: 0.27, gfH: 0.85, flags: 0 };
    const gv: VAttrs = { ...a, kind: KIND_WALL };
    // two slopes
    const c = [obb.cx, obb.cz];
    const pt = (su: number, sv: number, y: number) => [c[0] + obb.ux * hl * su + vx * hw * sv, y, c[1] + obb.uz * hl * su + vz * hw * sv];
    const rise = ridgeY - eaveY;
    const slopeLen = Math.hypot(hw, rise);
    for (const sv of [-1, 1]) {
      const e0 = pt(-1, sv, eaveY), e1 = pt(1, sv, eaveY), r1 = pt(1, 0, ridgeY), r0 = pt(-1, 0, ridgeY);
      const nx = vx * sv * (rise / slopeLen), ny = hw / slopeLen, nz = vz * sv * (rise / slopeLen);
      this.quad([...e0, ...e1, ...r1, ...r0], nx, ny, nz, [0, 0, hl * 2, 0, hl * 2, slopeLen, 0, slopeLen], rv);
    }
    // gable end triangles (as degenerate quads) in wall material
    for (const su of [-1, 1]) {
      const g0 = pt(su, -1, eaveY), g1 = pt(su, 1, eaveY), gr = pt(su, 0, ridgeY);
      this.quad([...g0, ...g1, ...gr, ...gr], obb.ux * su, 0, obb.uz * su, [0, eaveY, hw * 2, eaveY, hw, ridgeY, hw, ridgeY], { ...gv, wallLen: hw * 2, partyH: 0 });
    }
    void roofCol;
    void P;
  }

  /** decorative cornice: profile extruded along the top of a street-facing wall, mitred at shared corners */
  cornice(e: Edge, ring: Ring, topY: number, kind: number, P: BuildingParams, seed: number): void {
    // profile as (outward offset, dy from the top) pairs, top to bottom
    let prof: [number, number][];
    let col: [number, number, number];
    let dentils = false;
    switch (kind) {
      case 2: // heavy stone
        prof = [[0, 0.05], [0.85, 0.05], [0.85, -0.12], [0.7, -0.2], [0.7, -0.45], [0.5, -0.55], [0.5, -0.8], [0.3, -0.95], [0.3, -1.15], [0, -1.25]];
        col = [P.tint[0] * 0.98, P.tint[1] * 0.97, P.tint[2] * 0.95];
        dentils = true;
        break;
      case 3: // cast iron
        prof = [[0, 0.05], [0.7, 0.05], [0.7, -0.1], [0.55, -0.18], [0.55, -0.4], [0.35, -0.5], [0.35, -0.75], [0, -0.9]];
        col = P.tint;
        dentils = true;
        break;
      case 4: // brick corbel
        prof = [[0, 0.05], [0.25, 0.05], [0.25, -0.15], [0.15, -0.25], [0.15, -0.45], [0, -0.55]];
        col = [P.tint[0] * 0.95, P.tint[1] * 0.95, P.tint[2] * 0.95];
        break;
      default: {
        // pressed-metal bracketed cornice, painted
        const pal: [number, number, number][] = [[0.16, 0.24, 0.18], [0.35, 0.22, 0.15], [0.8, 0.76, 0.66], [0.2, 0.2, 0.2], [0.5, 0.15, 0.12]];
        col = P.style === 1 ? [P.tint[0] * 0.9, P.tint[1] * 0.9, P.tint[2] * 0.9] : pal[Math.floor(hash4(seed, 41) * pal.length)];
        // 0.9 m tall, 0.75 m projection: crown, dentil course, frieze (brackets added below)
        prof = [[0, 0.05], [0.75, 0.05], [0.75, -0.12], [0.6, -0.2], [0.6, -0.28], [0.45, -0.4], [0.45, -0.46], [0.28, -0.52], [0.28, -0.96], [0, -1.03]];
        dentils = true;
      }
    }
    // miter at the ends when the neighbouring edge is also street-facing
    const n = ring.length;
    const prev = ring[(e.idx + n - 1) % n], next = ring[(e.idx + 2) % n];
    const mA = miterDir(prev, [e.ax, e.az], [e.bx, e.bz]);
    const mB = miterDir([e.ax, e.az], [e.bx, e.bz], next);
    // pressed-metal (kind 1) cornices are painted: dielectric, not bare metal
    const a: VAttrs = { r: col[0], g: col[1], b: col[2], tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: e.len, flags: (dentils ? FLAG_DENTILS : 0) | (kind === 3 ? FLAG_METAL : 0), gfH: kind === 3 ? 0.45 : kind === 1 ? 0.6 : 0.75, kind: KIND_TRIM };
    for (let i = 0; i + 1 < prof.length; i++) {
      const [o0, y0] = prof[i], [o1, y1] = prof[i + 1];
      const p0a = [e.ax + mA[0] * o0, topY + y0, e.az + mA[1] * o0];
      const p0b = [e.bx + mB[0] * o0, topY + y0, e.bz + mB[1] * o0];
      const p1b = [e.bx + mB[0] * o1, topY + y1, e.bz + mB[1] * o1];
      const p1a = [e.ax + mA[0] * o1, topY + y1, e.az + mA[1] * o1];
      // normal from the profile segment (in the outward/up plane)
      const so = o1 - o0, sy = y1 - y0;
      const l = Math.hypot(so, sy) || 1;
      const no = -sy / l, ny = so / l; // rotate (so, sy) by +90° -> points outward for descending profiles
      const sign = ny * (o0 > o1 ? 1 : 1);
      void sign;
      const nx = e.nx * no, nz = e.nz * no;
      this.quad([...p0a, ...p0b, ...p1b, ...p1a], nx, ny, nz, [0, i, e.len, i, e.len, i + 1, 0, i + 1], a);
    }
    // end caps when not mitred
    if (!mA[2]) this.profileCap(e.ax, e.az, e.nx, e.nz, topY, prof, -e.dx, -e.dz, a);
    if (!mB[2]) this.profileCap(e.bx, e.bz, e.nx, e.nz, topY, prof, e.dx, e.dz, a);
    // scroll brackets of a pressed-metal cornice: frieze-height, under the crown, ~0.85 m on centre
    if (kind === 1 && e.len > 2.5) {
      const br: VAttrs = { ...a, r: col[0] * 0.88, g: col[1] * 0.88, b: col[2] * 0.88, flags: 0 };
      const n = Math.max(2, Math.round(e.len / 0.85));
      const pitch = e.len / n;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) * pitch;
        // upper block against the crown (0.28..0.62 out), lower scroll tapering back to the frieze
        const bx = e.ax + e.dx * u + e.nx * 0.45, bz = e.az + e.dz * u + e.nz * 0.45;
        this.box(bx, topY - 0.62, bz, e.dx, e.dz, 0.07, 0.25, 0.17, br);
        const lx = e.ax + e.dx * u + e.nx * 0.38, lz = e.az + e.dz * u + e.nz * 0.38;
        this.box(lx, topY - 0.96, lz, e.dx, e.dz, 0.07, 0.17, 0.1, br);
      }
    }
  }

  private profileCap(x: number, z: number, nx: number, nz: number, topY: number, prof: [number, number][], cx: number, cz: number, a: VAttrs): void {
    for (let i = 0; i + 1 < prof.length; i++) {
      const [o0, y0] = prof[i], [o1, y1] = prof[i + 1];
      this.quad([x, topY + y0, z, x + nx * o0, topY + y0, z + nz * o0, x + nx * o1, topY + y1, z + nz * o1, x, topY + y1, z], cx, 0, cz, [0, 0, o0, 0, o1, 1, 0, 1], a);
    }
  }

  /** oriented box: centre (x, y bottom, z), axis (ux, uz), half sizes. kind trim by default */
  box(x: number, y: number, z: number, ux: number, uz: number, hu: number, hy: number, hv: number, a: VAttrs, kind = KIND_TRIM): void {
    const vx = -uz, vz = ux;
    const cy = y + hy;
    const P = (su: number, sy: number, sv: number) => [x + ux * hu * su + vx * hv * sv, cy + hy * sy, z + uz * hu * su + vz * hv * sv];
    const at: VAttrs = { ...a, kind };
    // +u
    this.quad([...P(1, -1, -1), ...P(1, -1, 1), ...P(1, 1, 1), ...P(1, 1, -1)], ux, 0, uz, [0, 0, hv * 2, 0, hv * 2, hy * 2, 0, hy * 2], at);
    this.quad([...P(-1, -1, 1), ...P(-1, -1, -1), ...P(-1, 1, -1), ...P(-1, 1, 1)], -ux, 0, -uz, [0, 0, hv * 2, 0, hv * 2, hy * 2, 0, hy * 2], at);
    this.quad([...P(-1, -1, -1), ...P(1, -1, -1), ...P(1, 1, -1), ...P(-1, 1, -1)], -vx, 0, -vz, [0, 0, hu * 2, 0, hu * 2, hy * 2, 0, hy * 2], at);
    this.quad([...P(1, -1, 1), ...P(-1, -1, 1), ...P(-1, 1, 1), ...P(1, 1, 1)], vx, 0, vz, [0, 0, hu * 2, 0, hu * 2, hy * 2, 0, hy * 2], at);
    this.quad([...P(-1, 1, -1), ...P(1, 1, -1), ...P(1, 1, 1), ...P(-1, 1, 1)], 0, 1, 0, [0, 0, hu * 2, 0, hu * 2, hv * 2, 0, hv * 2], at);
    this.quad([...P(-1, -1, 1), ...P(1, -1, 1), ...P(1, -1, -1), ...P(-1, -1, -1)], 0, -1, 0, [0, 0, hu * 2, 0, hu * 2, hv * 2, 0, hv * 2], at);
  }

  cylinder(x: number, y0: number, z: number, r0: number, r1: number, y1: number, segs: number, a: VAttrs, capTop = true, capBottom = false): void {
    const base = this.vcount();
    // side: two rings of verts (smooth normals)
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      const c = Math.cos(t), s = Math.sin(t);
      const slope = (r0 - r1) / Math.max(0.001, y1 - y0);
      const nl = Math.hypot(1, slope);
      this.vert(x + c * r0, y0, z + s * r0, c / nl, slope / nl, s / nl, (i / segs) * 2 * Math.PI * (r0 + r1) * 0.5, 0, a);
      this.vert(x + c * r1, y1, z + s * r1, c / nl, slope / nl, s / nl, (i / segs) * 2 * Math.PI * (r0 + r1) * 0.5, y1 - y0, a);
    }
    for (let i = 0; i < segs; i++) {
      const b0 = base + i * 2, b1 = base + (i + 1) * 2;
      // outward facing: check with normal at vertex b0 -> use (b0, b1, b1+1),(b0, b1+1, b0+1) orientation test via cross
      this.idx.push3(b0, b0 + 1, b1);
      this.idx.push3(b1, b0 + 1, b1 + 1);
    }
    if (capTop && r1 > 0.01) this.disc(x, y1, z, r1, segs, 1, a);
    if (capBottom && r0 > 0.01) this.disc(x, y0, z, r0, segs, -1, a);
  }

  disc(x: number, y: number, z: number, r: number, segs: number, ny: number, a: VAttrs): void {
    const c = this.vert(x, y, z, 0, ny, 0, 0, 0, a);
    const base = this.vcount();
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      this.vert(x + Math.cos(t) * r, y, z + Math.sin(t) * r, 0, ny, 0, Math.cos(t) * r, Math.sin(t) * r, a);
    }
    for (let i = 0; i < segs; i++) {
      const p = base + i, q = base + ((i + 1) % segs);
      if (ny > 0) this.idx.push3(c, q, p);
      else this.idx.push3(c, p, q);
    }
  }

  bulkhead(x: number, y: number, z: number, ux: number, uz: number, w: number, d: number, hgt: number, P: BuildingParams): void {
    const brick = P.style === 5 || P.style === 6 ? [0.55, 0.55, 0.53] : [0.5, 0.42, 0.36];
    const a: VAttrs = { r: brick[0], g: brick[1], b: brick[2], tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: 0, gfH: 0.9, kind: KIND_TRIM };
    this.box(x, y, z, ux, uz, w / 2, hgt / 2, d / 2, a);
    // door on one side (dark)
    const dv: VAttrs = { ...a, r: 0.2, g: 0.2, b: 0.21, gfH: 0.6, flags: FLAG_METAL };
    this.box(x + ux * (w / 2 + 0.02), y, z + uz * (w / 2 + 0.02), ux, uz, 0.02, 1.05, 0.45, dv);
  }

  waterTower(x: number, y: number, z: number, seed: number): void {
    const standH = 4 + hash4(seed, 42) * 2;
    const tankR = 1.85, tankH = 4.0, roofH = 1.3;
    const wood: VAttrs = { r: 0.36, g: 0.26, b: 0.18, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: 0, gfH: 0.85, kind: KIND_TRIM };
    const woodDark: VAttrs = { ...wood, r: 0.28, g: 0.2, b: 0.14 };
    const steel: VAttrs = { ...wood, r: 0.2, g: 0.2, b: 0.21, flags: FLAG_METAL, gfH: 0.55 };
    const hoop: VAttrs = { ...wood, r: 0.15, g: 0.15, b: 0.15, flags: FLAG_METAL, gfH: 0.5 };
    // stand: 4 posts + cross braces + top platform beams
    const pr = 1.55;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
      this.box(x + sx * pr, y, z + sz * pr, 1, 0, 0.08, standH / 2, 0.08, steel);
    }
    for (const [sx, sz, ux, uz] of [[0, -1, 1, 0], [0, 1, 1, 0], [-1, 0, 0, 1], [1, 0, 0, 1]] as [number, number, number, number][]) {
      // X braces as two thin diagonal boxes approximated by horizontal + vertical rails
      this.box(x + sx * pr, y + standH * 0.45, z + sz * pr, ux, uz, pr, 0.04, 0.04, steel);
      this.box(x + sx * pr, y + standH * 0.9, z + sz * pr, ux, uz, pr, 0.06, 0.06, steel);
      this.box(x + sx * pr, y + standH * 0.05, z + sz * pr, ux, uz, pr, 0.04, 0.04, steel);
    }
    // tank bottom (dark conical bottom) + stave cylinder
    this.cylinder(x, y + standH - 0.6, z, 0.9, tankR, y + standH, 20, woodDark, false, true);
    this.cylinder(x, y + standH, z, tankR, tankR, y + standH + tankH, 24, wood, false, false);
    // hoops
    for (let i = 0; i < 4; i++) {
      const hy = y + standH + 0.4 + i * (tankH - 0.8) / 3;
      this.cylinder(x, hy - 0.04, z, tankR + 0.03, tankR + 0.03, hy + 0.04, 24, hoop, false, false);
    }
    // conical roof with a small cap
    this.cylinder(x, y + standH + tankH, z, tankR + 0.15, 0.25, y + standH + tankH + roofH, 24, woodDark, true, false);
    this.box(x, y + standH + tankH + roofH - 0.05, z, 1, 0, 0.3, 0.2, 0.3, woodDark);
    // ladder rail
    this.box(x + tankR + 0.15, y + standH - 1, z, 0, 1, 0.03, (tankH + 1) / 2, 0.22, steel);
  }

  hvac(x: number, y: number, z: number, ux: number, uz: number, t: number): void {
    const g = 0.6 + t * 0.2;
    const a: VAttrs = { r: g, g: g, b: g * 0.98, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL, gfH: 0.55, kind: KIND_TRIM };
    this.box(x, y + 0.15, z, ux, uz, 0.8, 0.55, 0.55, a);
    // feet
    const f: VAttrs = { ...a, r: 0.25, g: 0.25, b: 0.25 };
    this.box(x, y, z, ux, uz, 0.7, 0.08, 0.45, f);
    // fan ring on top
    const fan: VAttrs = { ...a, r: 0.3, g: 0.3, b: 0.3 };
    this.cylinder(x, y + 1.25, z, 0.35, 0.35, y + 1.4, 12, fan, true, false);
  }

  /** condenser bank: 2-3 square units side by side on sleepers, the fan grille recessed in the top */
  condensers(x: number, y: number, z: number, ux: number, uz: number, seed: number, k: number): void {
    const vx = -uz, vz = ux;
    const n = 2 + (hash4(seed, 68, k) < 0.4 ? 1 : 0);
    const g = 0.42 + hash4(seed, 69, k) * 0.18;
    const a: VAttrs = { r: g, g: g, b: g * 1.02, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL, gfH: 0.5, kind: KIND_TRIM };
    const sl: VAttrs = { ...a, r: 0.2, g: 0.19, b: 0.18, flags: 0, gfH: 0.85 };
    const fan: VAttrs = { ...a, r: 0.14, g: 0.14, b: 0.14, gfH: 0.7 };
    const w = 0.85;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * (w + 0.18);
      const cx = x + vx * o, cz = z + vz * o;
      this.box(cx, y + 0.12, cz, ux, uz, w / 2, 0.42, w / 2, a);       // cabinet
      this.box(cx, y, cz, ux, uz, w / 2 - 0.06, 0.06, w / 2 - 0.06, sl); // timber sleeper
      this.cylinder(cx, y + 0.94, cz, w * 0.4, w * 0.4, y + 0.99, 10, fan, true, false);
    }
  }

  /** rectangular galvanised duct on sleepers: the trunk that runs from the bulkhead to the air handler */
  duct(x: number, y: number, z: number, ux: number, uz: number, len: number): void {
    const a: VAttrs = { r: 0.56, g: 0.56, b: 0.55, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL, gfH: 0.45, kind: KIND_TRIM };
    const sl: VAttrs = { ...a, r: 0.2, g: 0.19, b: 0.18, flags: 0, gfH: 0.85 };
    const vx = -uz, vz = ux;
    // the trunk runs along the OBB's cross axis (v); sleepers hold it 0.11 m clear of the membrane
    this.box(x, y + 0.35, z, ux, uz, 0.32, 0.24, len / 2, a);
    const sleepers = Math.max(2, Math.round(len / 1.8));
    for (let i = 0; i < sleepers; i++) {
      const o = (i / (sleepers - 1) - 0.5) * (len - 0.6);
      this.box(x + vx * o, y, z + vz * o, ux, uz, 0.34, 0.12, 0.12, sl);
    }
    // joint flanges every 1.2 m: the banded silhouette that says duct and not kerb from above
    const bands = Math.max(1, Math.floor(len / 1.2));
    const bv: VAttrs = { ...a, r: 0.44, g: 0.44, b: 0.43 };
    for (let i = 0; i < bands; i++) {
      const o = (i - (bands - 1) / 2) * (len / bands);
      this.box(x + vx * o, y + 0.11, z + vz * o, ux, uz, 0.36, 0.25, 0.03, bv);
    }
  }

  /** cooling tower: louvred intake box with a fan cowl and a short discharge stack */
  coolingTower(x: number, y: number, z: number, ux: number, uz: number, seed: number): void {
    const hgt = 2.2 + hash4(seed, 71) * 1.2;
    const g = 0.5 + hash4(seed, 72) * 0.12;
    const a: VAttrs = { r: g, g: g * 1.01, b: g * 0.99, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL | FLAG_LOUVRE, gfH: 0.55, kind: KIND_TRIM };
    const cap: VAttrs = { ...a, r: 0.3, g: 0.3, b: 0.3, flags: FLAG_METAL, gfH: 0.5 };
    this.box(x, y, z, ux, uz, 1.5, hgt / 2, 1.1, a);
    this.cylinder(x, y + hgt, z, 0.75, 0.85, y + hgt + 0.7, 14, cap, false, false);
    this.cylinder(x, y + hgt + 0.7, z, 0.85, 0.85, y + hgt + 0.78, 14, cap, true, false);
  }

  /** roof hatch: aluminium lid on a 0.3 m curb, the way out of the stair when there is no bulkhead */
  roofHatch(x: number, y: number, z: number, ux: number, uz: number): void {
    const curb: VAttrs = { r: 0.3, g: 0.28, b: 0.26, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: 0, gfH: 0.9, kind: KIND_TRIM };
    const lid: VAttrs = { ...curb, r: 0.62, g: 0.63, b: 0.63, flags: FLAG_METAL, gfH: 0.4 };
    this.box(x, y, z, ux, uz, 0.55, 0.14, 0.45, curb);
    this.box(x, y + 0.28, z, ux, uz, 0.6, 0.04, 0.5, lid);
  }

  /** curbed skylight: a 0.35 m upstand under a shallow wired-glass light, milky and low-roughness */
  skylight(x: number, y: number, z: number, ux: number, uz: number, w: number, d: number): void {
    const curb: VAttrs = { r: 0.34, g: 0.32, b: 0.3, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: 0, gfH: 0.9, kind: KIND_TRIM };
    const glass: VAttrs = { ...curb, r: 0.52, g: 0.55, b: 0.56, flags: FLAG_METAL, gfH: 0.16 };
    this.box(x, y, z, ux, uz, w / 2, 0.18, d / 2, curb);
    this.box(x, y + 0.36, z, ux, uz, w / 2 + 0.05, 0.05, d / 2 + 0.05, glass);
  }

  /** brick chimney stack with a corbelled cap and a clay flue pot */
  chimney(x: number, y: number, z: number, ux: number, uz: number, hgt: number, P: BuildingParams): void {
    const br: VAttrs = { r: P.tint[0] * 0.9, g: P.tint[1] * 0.88, b: P.tint[2] * 0.86, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: 0, gfH: 0.92, kind: KIND_TRIM };
    const capA: VAttrs = { ...br, r: 0.55, g: 0.53, b: 0.5, gfH: 0.8 };
    const pot: VAttrs = { ...br, r: 0.42, g: 0.26, b: 0.19, gfH: 0.85 };
    this.box(x, y, z, ux, uz, 0.42, hgt / 2, 0.32, br);
    this.box(x, y + hgt, z, ux, uz, 0.5, 0.06, 0.4, capA);
    this.cylinder(x, y + hgt + 0.12, z, 0.13, 0.13, y + hgt + 0.55, 8, pot, false, false);
  }

  /** rooftop deck: a run of decking, a table, two chairs and a planter */
  roofDeck(x: number, y: number, z: number, ux: number, uz: number, seed: number): void {
    const vx = -uz, vz = ux;
    const deck: VAttrs = { r: 0.4, g: 0.32, b: 0.24, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_TEXT0, gfH: 0.88, kind: KIND_TRIM };
    const furn: VAttrs = { ...deck, r: 0.24, g: 0.24, b: 0.25, flags: FLAG_METAL, gfH: 0.55 };
    const planter: VAttrs = { ...deck, r: 0.32, g: 0.3, b: 0.27, flags: 0, gfH: 0.9 };
    const leaf: VAttrs = { ...deck, r: 0.10, g: 0.19, b: 0.08, flags: 0, gfH: 0.85 };
    this.box(x, y + 0.02, z, ux, uz, 2.0, 0.04, 1.7, deck);
    const tx = x + ux * 0.4, tz = z + uz * 0.4;
    this.box(tx, y + 0.68, tz, ux, uz, 0.45, 0.03, 0.45, furn);   // table top
    this.box(tx, y + 0.1, tz, ux, uz, 0.06, 0.29, 0.06, furn);    // pedestal
    for (const sgn of [-1, 1]) {
      const cx = tx + vx * sgn * 0.85, cz = tz + vz * sgn * 0.85;
      this.box(cx, y + 0.1, cz, ux, uz, 0.22, 0.16, 0.22, furn);
      this.box(cx - ux * sgn * 0.0 + vx * sgn * 0.2, y + 0.42, cz + vz * sgn * 0.2, ux, uz, 0.22, 0.19, 0.03, furn);
    }
    const px = x - ux * 1.5 + vx * (hash4(seed, 73) - 0.5), pz = z - uz * 1.5 + vz * (hash4(seed, 73) - 0.5);
    this.box(px, y + 0.05, pz, ux, uz, 0.3, 0.22, 0.3, planter);
    this.box(px, y + 0.49, pz, ux, uz, 0.34, 0.22, 0.34, leaf);
  }

  /** satellite dish on a ballasted mast, plus a whip antenna beside it */
  dish(x: number, y: number, z: number, ux: number, uz: number, r: number): void {
    const a: VAttrs = { r: 0.62, g: 0.62, b: 0.6, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: 0, gfH: 0.5, kind: KIND_TRIM };
    const mast: VAttrs = { ...a, r: 0.3, g: 0.3, b: 0.31, flags: FLAG_METAL, gfH: 0.5 };
    const ball: VAttrs = { ...a, r: 0.2, g: 0.19, b: 0.18, flags: 0, gfH: 0.9 };
    this.box(x, y, z, ux, uz, 0.45, 0.06, 0.45, ball);        // concrete ballast block
    this.cylinder(x, y + 0.1, z, 0.05, 0.05, y + 1.1, 8, mast, false, false);
    // the dish: a shallow cone tipped by offsetting its rim, cheap enough to read as a dish from 200 m
    this.cylinder(x, y + 1.1, z, r, r * 0.25, y + 1.1 + r * 0.45, 12, a, true, false);
    this.cylinder(x + ux * 0.5, y, z + uz * 0.5, 0.025, 0.025, y + 2.2, 6, mast, true, false);
  }

  pipe(x: number, y: number, z: number, r: number, h: number): void {
    const a: VAttrs = { r: 0.35, g: 0.34, b: 0.33, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL, gfH: 0.6, kind: KIND_TRIM };
    this.cylinder(x, y, z, r, r, y + h, 8, a, true, false);
    this.cylinder(x, y + h, z, r * 1.6, r * 1.6, y + h + 0.12, 8, a, true, false);
  }

  antenna(x: number, y: number, z: number, h: number): void {
    const a: VAttrs = { r: 0.5, g: 0.5, b: 0.5, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL, gfH: 0.5, kind: KIND_TRIM };
    this.box(x, y, z, 1, 0, 0.06, h / 2, 0.06, a);
    this.box(x, y + h * 0.7, z, 1, 0, 0.6, 0.02, 0.02, a);
  }

  beacon(x: number, y: number, z: number, seed: number): void {
    const mast: VAttrs = { r: 0.45, g: 0.45, b: 0.45, tierTop: 0, floorH: 0, styleSeed: seed, partyH: 0, wallLen: 0, flags: FLAG_METAL, gfH: 0.5, kind: KIND_TRIM };
    this.box(x, y, z, 1, 0, 0.1, 2.0, 0.1, mast);
    const b: VAttrs = { ...mast, r: 1, g: 0.05, b: 0.02, kind: KIND_BEACON, flags: 0 };
    this.box(x, y + 4.0, z, 1, 0, 0.25, 0.25, 0.25, b, KIND_BEACON);
  }

  /** AC units in ~acFrac of the windows (not the ground floor) */
  acUnits(e: Edge, P: BuildingParams, seed: number, h: number, frac: number): void {
    const cols = windowColumns(P.style, e.len);
    if (!cols.count) return;
    const st = STYLES[P.style];
    const a: VAttrs = { r: 0.72, g: 0.72, b: 0.7, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL, gfH: 0.5, kind: KIND_TRIM };
    const wallIdx = e.idx + 1;
    for (let fl = 1; fl < 60; fl++) {
      const fb = floorBase(P.style, fl, P.gfH, P.floorH);
      if (fb + st.sill + 0.5 > h - 0.9) break;
      const opening = windowOpening(P.style, fl, P.gfH, P.floorH, h);
      if (!opening) continue;
      if (fb < e.partyH) continue;
      for (let c = 0; c < cols.count; c++) {
        if (hash4(seed, 70, wallIdx * 128 + c, fl) >= frac) continue;
        if (P.balconies && e.street && c % 2 === 0) continue;
        const u = cols.offset + (c + 0.5) * cols.spacing;
        const winB = opening.bottom + 0.07; // clear the frame; occupy only the lower pane
        const halfHeight = Math.min(0.2, (opening.top - winB) * 0.25 - 0.03);
        // The facade/reveal is shader-only: burying the box behind that plane hides its back.
        // Seat the back exactly on the facade, with a 32 cm exterior projection.
        const cx = e.ax + e.dx * u + e.nx * 0.16, cz = e.az + e.dz * u + e.nz * 0.16;
        this.box(cx, winB, cz, e.dx, e.dz, Math.min(0.3, opening.width * 0.5 - 0.07), halfHeight, 0.16, a);
        // support bracket
        const br: VAttrs = { ...a, r: 0.3, g: 0.3, b: 0.3 };
        this.box(cx, winB - 0.1, cz, e.dx, e.dz, 0.2, 0.05, 0.16, br);
      }
    }
  }

  balconies(e: Edge, P: BuildingParams, h: number): void {
    const cols = windowColumns(P.style, e.len);
    if (!cols.count) return;
    const slab: VAttrs = { r: 0.6, g: 0.58, b: 0.55, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: 0, gfH: 0.85, kind: KIND_TRIM };
    const rail: VAttrs = { ...slab, r: 0.15, g: 0.15, b: 0.16, flags: FLAG_METAL, gfH: 0.45 };
    const depth = 1.5, w = Math.min(cols.spacing * 0.9, 3.4);
    for (let fl = 1; fl < 80; fl++) {
      const fb = floorBase(P.style, fl, P.gfH, P.floorH);
      if (fb > h - 2.5) break;
      if (fb < e.partyH) continue;
      for (let c = 0; c < cols.count; c += 2) {
        const u = cols.offset + (c + 0.5) * cols.spacing;
        const cx = e.ax + e.dx * u + e.nx * (depth / 2), cz = e.az + e.dz * u + e.nz * (depth / 2);
        this.box(cx, fb - 0.16, cz, e.dx, e.dz, w / 2, 0.08, depth / 2, slab);
        // railing: front + two sides (thin), top rail
        const fx = e.ax + e.dx * u + e.nx * (depth - 0.03), fz = e.az + e.dz * u + e.nz * (depth - 0.03);
        this.box(fx, fb, fz, e.dx, e.dz, w / 2, 0.52, 0.02, rail);
        for (const s of [-1, 1]) {
          const sx = e.ax + e.dx * (u + s * (w / 2 - 0.02)) + e.nx * (depth / 2), sz = e.az + e.dz * (u + s * (w / 2 - 0.02)) + e.nz * (depth / 2);
          this.box(sx, fb, sz, e.dx, e.dz, 0.02, 0.52, depth / 2, rail);
        }
      }
    }
  }

  /** awnings / lightboxes / standpipes for the shops along a commercial street wall */
  storefronts(e: Edge, P: BuildingParams, seed: number): void {
    const wallIdx = e.idx + 1;
    const { n, w } = shopSplit(e.len, seed, wallIdx);
    const gfH = P.gfH;
    for (let i = 0; i < n; i++) {
      const u0 = i * w, u1 = (i + 1) * w;
      const t = hash4(seed, 21, wallIdx, i);
      const nameIdx = Math.floor(hash4(seed, 25, wallIdx, i) * SIGN_NAME_ROWS);
      const doorU = u0 + w * (0.15 + 0.7 * hash4(seed, 23, wallIdx, i));
      // standpipe (siamese connection) next to the door
      const spU = Math.min(u1 - 0.4, doorU + 1.1);
      this.standpipe(e.ax + e.dx * spU + e.nx * 0.25, e.az + e.dz * spU + e.nz * 0.25, e.dx, e.dz);
      // roll-down gate housing over the glazing (the shader's gate threshold peaks at 0.55): a 0.32 m box under the fascia
      if (hash4(seed, 22, wallIdx, i) < 0.55 && w > 2) {
        const gb: VAttrs = { r: 0.45, g: 0.44, b: 0.42, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL, gfH: 0.5, kind: KIND_TRIM };
        const cu = (u0 + u1) / 2;
        this.box(e.ax + e.dx * cu + e.nx * 0.14, gfH - 1.15 - 0.32, e.az + e.dz * cu + e.nz * 0.14, e.dx, e.dz, (w - 0.56) / 2, 0.16, 0.14, gb);
      }
      if (t < 0.45 && w > 3) {
        // awning: solid canvas hung from the fascia, sloping out over the gate housing, with a valance carrying the name
        const ci = Math.floor(hash4(seed, 24, wallIdx, i) * AWNING_COLORS.length);
        const col = AWNING_COLORS[ci];
        // wallLen / partyH carry the wall and shop index so the sign shader can rebuild this shop's night
        // state (lit, gate down) from the same hashes the facade uses: a dark shop's awning is not underlit.
        const a: VAttrs = { r: col[0], g: col[1], b: col[2], tierTop: 0, floorH: 0, styleSeed: seed, partyH: i, wallLen: wallIdx, flags: FLAG_TEXT0, gfH: 0.9, kind: KIND_AWNING };
        const yTop = gfH - 0.8, yFront = yTop - 0.8, proj = 1.6;
        const m = 0.25;
        const au0 = u0 + m, au1 = u1 - m;
        const A = (u: number, out: number, y: number) => [e.ax + e.dx * u + e.nx * out, y, e.az + e.dz * u + e.nz * out];
        // slope: v beyond the atlas so the shader never letters it (a row-2 v put mirrored, mip-bled glyphs on it)
        const slopeN = norm3(e.nx * (yTop - yFront), proj, e.nz * (yTop - yFront));
        this.quad([...A(au0, 0.02, yTop), ...A(au1, 0.02, yTop), ...A(au1, proj, yFront), ...A(au0, proj, yFront)], slopeN[0], slopeN[1], slopeN[2], [0, NO_TEXT, 1, NO_TEXT, 1, NO_TEXT, 0, NO_TEXT], a);
        // valance with the name, aspect-correct atlas uv
        const vh = 0.32;
        const aspect = (au1 - au0) / vh;
        const half = Math.min(0.5, aspect / 16 / 2);
        const row = nameIdx;
        // Wall +u runs right-to-left from the street; reverse only the atlas's horizontal axis.
        const uvs = [0.5 + half, row + 0.02, 0.5 - half, row + 0.02, 0.5 - half, row + 0.98, 0.5 + half, row + 0.98];
        this.quad([...A(au0, proj, yFront - vh), ...A(au1, proj, yFront - vh), ...A(au1, proj, yFront), ...A(au0, proj, yFront)], e.nx, 0, e.nz, uvs, a);
        // underside
        this.quad([...A(au0, proj, yFront), ...A(au1, proj, yFront), ...A(au1, 0.02, yTop - 0.02), ...A(au0, 0.02, yTop - 0.02)], -slopeN[0], -slopeN[1], -slopeN[2], [0, NO_TEXT, 1, NO_TEXT, 1, NO_TEXT, 0, NO_TEXT], a);
        // side triangles
        for (const [uu, sgn] of [[au0, -1], [au1, 1]] as [number, number][]) {
          this.quad([...A(uu, 0.02, yTop), ...A(uu, proj, yFront), ...A(uu, proj, yFront - vh), ...A(uu, 0.02, yTop - 0.05)], e.dx * sgn, 0, e.dz * sgn, [0, NO_TEXT, 1, NO_TEXT, 1, NO_TEXT, 0, NO_TEXT], a);
        }
        // support arms
        const arm: VAttrs = { ...a, r: 0.2, g: 0.2, b: 0.2, kind: KIND_TRIM, flags: FLAG_METAL, gfH: 0.5 };
        for (const uu of [au0 + 0.1, au1 - 0.1]) this.box(e.ax + e.dx * uu + e.nx * proj * 0.5, yFront + (yTop - yFront) * 0.5 - 0.02, e.az + e.dz * uu + e.nz * proj * 0.5, e.nx, e.nz, proj * 0.5, 0.02, 0.02, arm);
      } else if (t < 0.8 && w > 3) {
        // lightbox sign in the band above the shopfront
        const ci = Math.floor(hash4(seed, 24, wallIdx, i) * LIGHTBOX_COLORS.length);
        const col = LIGHTBOX_COLORS[ci];
        const textDark = ci === 0 || ci === 1;
        const tc = Math.floor(hash4(seed, 26, wallIdx, i) * 3); // text colour variant
        const a: VAttrs = { r: col[0], g: col[1], b: col[2], tierTop: 0, floorH: 0, styleSeed: seed, partyH: i, wallLen: wallIdx, flags: (textDark ? 0 : FLAG_TEXT0) | (tc === 1 ? FLAG_TEXT1 : 0), gfH: 0.6, kind: KIND_LIGHTBOX };
        const m = 0.3;
        const su0 = u0 + m, su1 = u1 - m;
        const bh = 0.8, yb = gfH - 1.05, out = 0.18;
        const A = (u: number, o: number, y: number) => [e.ax + e.dx * u + e.nx * o, y, e.az + e.dz * u + e.nz * o];
        const aspect = (su1 - su0) / bh;
        const half = Math.min(0.5, aspect / 16 / 2);
        // Same street-facing atlas orientation as the awning valance.
        const uvs = [0.5 + half, nameIdx + 0.02, 0.5 - half, nameIdx + 0.02, 0.5 - half, nameIdx + 0.98, 0.5 + half, nameIdx + 0.98];
        this.quad([...A(su0, out, yb), ...A(su1, out, yb), ...A(su1, out, yb + bh), ...A(su0, out, yb + bh)], e.nx, 0, e.nz, uvs, a);
        // box sides (frame) in trim
        const fr: VAttrs = { ...a, r: 0.15, g: 0.15, b: 0.15, kind: KIND_TRIM, flags: FLAG_METAL, gfH: 0.5 };
        this.quad([...A(su0, 0.02, yb + bh), ...A(su1, 0.02, yb + bh), ...A(su1, out, yb + bh), ...A(su0, out, yb + bh)], 0, 1, 0, [0, 0, 1, 0, 1, 1, 0, 1], fr);
        this.quad([...A(su0, out, yb), ...A(su1, out, yb), ...A(su1, 0.02, yb), ...A(su0, 0.02, yb)], 0, -1, 0, [0, 0, 1, 0, 1, 1, 0, 1], fr);
        this.quad([...A(su0, 0.02, yb), ...A(su0, out, yb), ...A(su0, out, yb + bh), ...A(su0, 0.02, yb + bh)], -e.dx, 0, -e.dz, [0, 0, 1, 0, 1, 1, 0, 1], fr);
        this.quad([...A(su1, out, yb), ...A(su1, 0.02, yb), ...A(su1, 0.02, yb + bh), ...A(su1, out, yb + bh)], e.dx, 0, e.dz, [0, 0, 1, 0, 1, 1, 0, 1], fr);
      }
    }
  }

  /** lobby canopy: a 3 m fabric hood over the entrance walk on two slim posts, in the shader's door position */
  canopy(e: Edge, P: BuildingParams, seed: number): void {
    const wi = e.idx + 1;
    const doorU = 1.3 + hash4(seed, 30, wi) * Math.max(0, e.len - 2.6);
    const k = hash4(seed, 37, wi);
    const col: [number, number, number] = k < 0.4 ? [0.05, 0.16, 0.09] : k < 0.7 ? [0.03, 0.03, 0.03] : [0.28, 0.05, 0.07];
    const fab: VAttrs = { r: col[0], g: col[1], b: col[2], tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: 0, gfH: 0.85, kind: KIND_TRIM };
    const steel: VAttrs = { ...fab, r: 0.2, g: 0.2, b: 0.21, flags: FLAG_METAL, gfH: 0.5 };
    const proj = 3.0, hw = 1.35, y = 2.95;
    const A = (u: number, out: number, yy: number) => [e.ax + e.dx * u + e.nx * out, yy, e.az + e.dz * u + e.nz * out];
    const c = A(doorU, proj / 2, y);
    this.box(c[0], c[1], c[2], e.nx, e.nz, proj / 2, 0.14, hw, fab);
    for (const sgn of [-1, 1]) {
      const post = A(doorU + sgn * (hw - 0.05), proj - 0.08, 0);
      this.box(post[0], 0, post[2], e.nx, e.nz, 0.03, y / 2, 0.03, steel);
    }
    void P;
  }

  /** glass tower lobby: a flat steel canopy cantilevered over the entrance (shader doorU, hash 30) */
  glassCanopy(e: Edge, seed: number): void {
    const wi = e.idx + 1;
    const doorU = 1.3 + hash4(seed, 30, wi) * Math.max(0, e.len - 2.6);
    const k = hash4(seed, 4);
    const col: [number, number, number] = k < 0.35 ? [0.16, 0.13, 0.1] : [0.34, 0.35, 0.36];
    const steel: VAttrs = { r: col[0], g: col[1], b: col[2], tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL, gfH: 0.45, kind: KIND_TRIM };
    const proj = 2.6, hw = 2.4, y = 3.55;
    const cx = e.ax + e.dx * doorU + e.nx * (proj / 2), cz = e.az + e.dz * doorU + e.nz * (proj / 2);
    this.box(cx, y, cz, e.nx, e.nz, proj / 2, 0.11, hw, steel);
    // recessed downlights along the soffit (lit through shadeTrim as a lighter strip)
    const light: VAttrs = { ...steel, r: 0.85, g: 0.82, b: 0.75, flags: 0, gfH: 0.3 };
    this.box(cx, y - 0.02, cz, e.nx, e.nz, 0.12, 0.01, hw - 0.4, light);
  }

  /**
   * Rooftop mechanical screen: louvred enclosure inset from the parapet on a tower's top tier. Its deck is
   * the tower's real working roof, so it is capped in the building's own membrane (not a flat 0.22 plate)
   * and returned so the plant - cooling towers, condensers, dishes - is placed ON it rather than under it.
   */
  mechScreen(ring: Ring, y: number, seed: number, P: BuildingParams, roofCol: [number, number, number], roofMat: number): { ring: Ring; y: number } | null {
    const inner = insetOrScale(ring, 2.5 + hash4(seed, 45) * 2);
    if (!inner || Math.abs(area2(inner)) / 2 < 60) return null;
    const g = P.style === 5 ? 0.46 : 0.5;
    const hgt = 3.6 + hash4(seed, 46) * 1.8;
    const a: VAttrs = { r: g, g: g, b: g * 1.02, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL | FLAG_LOUVRE, gfH: 0.55, kind: KIND_TRIM };
    const n = inner.length;
    for (let i = 0; i < n; i++) {
      const p = inner[i], q = inner[(i + 1) % n];
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const nx = dz / len, nz = -dx / len;
      this.quad([p[0], y, p[1], q[0], y, q[1], q[0], y + hgt, q[1], p[0], y + hgt, p[1]], nx, 0, nz, [0, 0, len, 0, len, hgt, 0, hgt], a);
    }
    const capA: VAttrs = { ...a, r: roofCol[0], g: roofCol[1], b: roofCol[2], flags: roofMat, gfH: 0.9, kind: KIND_ROOF };
    this.cap([inner], y + hgt, capA);
    return { ring: inner, y: y + hgt };
  }

  standpipe(x: number, z: number, dx: number, dz: number): void {
    const a: VAttrs = { r: 0.55, g: 0.38, b: 0.16, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: FLAG_METAL, gfH: 0.4, kind: KIND_TRIM };
    this.cylinder(x, 0, z, 0.06, 0.06, 0.75, 8, a, false, false);
    for (const s of [-1, 1]) {
      const cx = x + dx * s * 0.11, cz = z + dz * s * 0.11;
      this.cylinder(cx, 0.55, cz, 0.06, 0.06, 0.78, 8, a, true, true);
    }
  }

  /** brownstone stoop (8 steps to the parlour floor at +1.7 m) with cheek walls and iron railings, plus the areaway fence */
  stoop(e: Edge, P: BuildingParams, seed: number): void {
    const wallIdx = e.idx + 1;
    const tdoor = hash4(seed, 30, wallIdx);
    const doorU = 1.3 + tdoor * Math.max(0, e.len - 2.6);
    const stone: VAttrs = { r: P.tint[0] * 0.95, g: P.tint[1] * 0.95, b: P.tint[2] * 0.95, tierTop: 0, floorH: 0, styleSeed: 0, partyH: 0, wallLen: 0, flags: 0, gfH: 0.85, kind: KIND_TRIM };
    const iron: VAttrs = { ...stone, r: 0.1, g: 0.1, b: 0.11, flags: FLAG_METAL, gfH: 0.5 };
    const steps = 8, rise = 1.7 / steps, tread = 0.3, width = 1.5;
    const totalRun = steps * tread;
    const A = (u: number, out: number, y: number) => [e.ax + e.dx * u + e.nx * out, y, e.az + e.dz * u + e.nz * out];
    // steps as stacked boxes: step k (from the top) spans out = [0, totalRun - k*tread]
    for (let k = 0; k < steps; k++) {
      const top = 1.7 - k * rise;
      const run = totalRun - k * tread;
      this.box(...centre(A(doorU, run / 2, 0)), e.nx, e.nz, run / 2, top / 2, width / 2, stone);
    }
    // landing at the door
    this.box(...centre(A(doorU, -0.05, 0)), e.nx, e.nz, 0.3, 1.7 / 2, width / 2 + 0.25, stone);
    // cheek walls (solid, sloped top approximated by two boxes)
    for (const s of [-1, 1]) {
      const cu = doorU + s * (width / 2 + 0.12);
      this.box(...centre(A(cu, totalRun * 0.25, 0)), e.nx, e.nz, totalRun * 0.25, (1.7 * 0.75) / 2 + 0.1, 0.12, stone);
      this.box(...centre(A(cu, totalRun * 0.7, 0)), e.nx, e.nz, totalRun * 0.2, (1.7 * 0.35) / 2 + 0.1, 0.12, stone);
      // railing: posts + handrail (sloped approximated by segments)
      for (let k = 0; k <= 4; k++) {
        const o = (k / 4) * totalRun;
        const y = 1.7 - (o / totalRun) * 1.7 + 0.1;
        this.box(...centre(A(cu, o, y)), e.nx, e.nz, 0.02, 0.45, 0.02, iron);
        if (k < 4) {
          const o2 = ((k + 1) / 4) * totalRun;
          const y2 = 1.7 - (o2 / totalRun) * 1.7 + 0.1;
          const mid = A(cu, (o + o2) / 2, (y + y2) / 2 + 0.9);
          this.box(mid[0], mid[1] - 0.02, mid[2], e.nx, e.nz, (o2 - o) / 2 + 0.03, 0.02, 0.02, iron);
        }
      }
    }
    // areaway fence along the front (1.1 m out), except at the stoop
    const fenceOut = 1.5;
    const segs: [number, number][] = [[0.3, doorU - width / 2 - 0.35], [doorU + width / 2 + 0.35, e.len - 0.3]];
    for (const [f0, f1] of segs) {
      if (f1 - f0 < 0.8) continue;
      const rail = A((f0 + f1) / 2, fenceOut, 0);
      this.box(rail[0], 0.95, rail[2], e.dx, e.dz, (f1 - f0) / 2, 0.02, 0.02, iron);
      this.box(rail[0], 0.3, rail[2], e.dx, e.dz, (f1 - f0) / 2, 0.015, 0.015, iron);
      const nPosts = Math.max(2, Math.round((f1 - f0) / 0.15));
      for (let k = 0; k <= nPosts; k++) {
        const u = f0 + ((f1 - f0) * k) / nPosts;
        const p = A(u, fenceOut, 0);
        this.box(p[0], 0, p[2], e.dx, e.dz, 0.012, 0.55, 0.012, iron);
      }
    }
  }

  finish() {
    const cx = (this.minX + this.maxX) / 2, cy = (this.minY + this.maxY) / 2, cz = (this.minZ + this.maxZ) / 2;
    const r = Math.hypot(this.maxX - this.minX, this.maxY - this.minY, this.maxZ - this.minZ) / 2;
    return {
      position: this.pos.slice(),
      normal: this.nrm.slice(),
      uv: this.uv.slice(),
      color: this.col.slice(),
      info: this.info.slice(),
      wall: this.wall.slice(),
      index: this.idx.slice(),
      bounds: Number.isFinite(cx) ? { cx, cy, cz, r } : { cx: 128, cy: 20, cz: 128, r: 250 },
      colPos: this.cpos.slice(),
      colIdx: this.cidx.slice(),
    };
  }
}

function centre(p: number[]): [number, number, number] {
  return [p[0], p[1], p[2]];
}

function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** outward miter direction at vertex b of a->b->c (scaled so an offset along it keeps both edges' offsets) */
function miterDir(a: Pt, b: Pt, c: Pt): [number, number, boolean] {
  let ax = b[0] - a[0], az = b[1] - a[1];
  let cx = c[0] - b[0], cz = c[1] - b[1];
  const la = Math.hypot(ax, az) || 1, lc = Math.hypot(cx, cz) || 1;
  ax /= la; az /= la; cx /= lc; cz /= lc;
  const n1x = az, n1z = -ax, n2x = cz, n2z = -cx;
  let mx = n1x + n2x, mz = n1z + n2z;
  const ml = Math.hypot(mx, mz);
  if (ml < 1e-4) return [n1x, n1z, false];
  mx /= ml; mz /= ml;
  const cosHalf = mx * n1x + mz * n1z;
  if (cosHalf < 0.5) return [n1x, n1z, false];
  const s = 1 / cosHalf;
  return [mx * s, mz * s, true];
}

export { KIND_WALL, KIND_ROOF, KIND_TRIM, KIND_LIGHTBOX, KIND_AWNING, KIND_BEACON, KIND_GLASS };
