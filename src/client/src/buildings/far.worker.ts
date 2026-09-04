import { basePath as __launchBasePath, mountedFetch as __launchFetch } from '@/core/basePath';
/**
 * Far-skyline worker: fetches EVERY tile in the world index (nearest first, a few in flight), keeps only
 * footprints + heights, and builds one cheap merged geometry per 4x4-tile chunk (1024 m). Buildings are
 * inset 0.25 m and lowered 0.4 m so the detailed near-tile geometry always draws over them.
 *
 * Vertex layout: position, aData (rgb tint + style), aInfo (height, seed, floorH, gfH),
 * uv (metres along/up the wall), aWall (wall length, wall id). Never derive UVs from fragment normals.
 *
 * Tops (docs/ART_DIRECTION.md §1.6, §3 roofs): every wall carries its parapet, the roof cap sits behind a
 * parapet lip, and the top tier gets the same props the near builder places (stair bulkhead, louvred
 * mechanical screen on towers, a water tower where the tool flagged one) so the silhouette from the rivers
 * and the aerial spots is not a field of flat-topped extrusions. Water towers go out as instances.
 */
import type { Building, Ring, Tile } from '@shared/world';
import { hash4, seedOf } from './hash';
import { roofPalette, roofMaterial } from './builder';
import { buildingParams } from './styles';
import { normalizePolygon, simplifyRing, insetOrScale, triangulate, area2, orientedBox, pointInRing } from './polygon';
import type { LandmarkRange } from './landmarks';

export const FAR_CHUNK_TILES = 4;
/** aData.a values above the facade styles: roof caps, mechanical boxes / screens, parapet lips */
export const FAR_STYLE_ROOF = 255;
export const FAR_STYLE_MECH = 254;
export const FAR_STYLE_PARAPET = 253;
/** water tower instance: x, y (roof level), z, stand height */
export const FAR_TOWER_FLOATS = 4;
/** the far box is lowered this much so near roofs always win the depth test */
export const FAR_DROP = 0.4;

export interface FarStart {
  type: 'start';
  baseUrl: string;
  keys: string[];
  /** Mobile reuses the bounded near scene without more fetches or decodes. */
  tiles?: Tile[];
  focusX: number;
  focusZ: number;
  landmarkBins: number[];
  /** minimum building height to keep (m); small buildings are dropped far away */
  minHeight: number;
}
export interface FarChunkMsg {
  type: 'chunk';
  key: string; // "cx_cz"
  ox: number;
  oz: number;
  position: Float32Array;
  data: Uint8Array;
  info: Float32Array;
  uv: Float32Array;
  wall: Float32Array;
  index: Uint32Array;
  renderIndex: Uint32Array;
  /** water tower instances (FAR_TOWER_FLOATS each), chunk-local */
  towers: Float32Array;
  bounds: { cx: number; cy: number; cz: number; r: number };
  buildings: number;
  landmarkRanges: LandmarkRange[];
}
export interface FarProgress {
  type: 'progress';
  fetched: number;
  total: number;
  chunks: number;
  done: boolean;
}

interface ChunkState {
  key: string;
  cx: number;
  cz: number;
  pending: Set<string>;
  buildings: Building[];
  dist: number;
}

type Tint = [number, number, number];

async function fetchTile(url: string): Promise<Tile | null> {
  const res = await __launchFetch(url, { cache: 'force-cache' });
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  let text: string;
  if (isGzip) {
    const stream = new Blob([buf as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else text = new TextDecoder().decode(buf);
  return JSON.parse(text) as Tile;
}

function boxFits(ring: Ring, x: number, z: number, ux: number, uz: number, hu: number, hv: number): boolean {
  const vx = -uz, vz = ux;
  for (const su of [-1, 1])
    for (const sv of [-1, 1]) {
      if (!pointInRing(x + ux * hu * su + vx * hv * sv, z + uz * hu * su + vz * hv * sv, ring)) return false;
    }
  return pointInRing(x, z, ring);
}

export function buildChunk(c: ChunkState, land: Set<number>, minHeight: number): FarChunkMsg | null {
  const ox = c.cx * FAR_CHUNK_TILES * 256, oz = c.cz * FAR_CHUNK_TILES * 256;
  const pos: number[] = [];
  const data: number[] = [];
  const info: number[] = [];
  const uv: number[] = [], wall: number[] = [];
  const idx: number[] = [];
  const towers: number[] = [];
  const landmarkRanges: LandmarkRange[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let count = 0;
  const vert = (x: number, y: number, z: number, r: number, g: number, b: number, style: number, h: number, seed: number,
    floorH: number, gfH: number, u: number, length: number, wallId: number): number => {
    const rx = x - ox, rz = z - oz;
    pos.push(rx, y, rz);
    data.push(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), style);
    info.push(h, seed, floorH, gfH);
    uv.push(u, y);
    wall.push(length, wallId);
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (rz < minZ) minZ = rz;
    if (rz > maxZ) maxZ = rz;
    return pos.length / 3 - 1;
  };
  /** outward-facing wall quads around a ring (inward when `inward`), u in metres along each wall */
  const walls = (ring: Ring, y0: number, y1: number, tint: Tint, style: number, H: number, seed: number, floorH: number, gfH: number, inward = false): void => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i], q = ring[(i + 1) % n];
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      const v0 = vert(a[0], y0, a[1], ...tint, style, H, seed, floorH, gfH, 0, len, i + 1);
      const v1 = vert(q[0], y0, q[1], ...tint, style, H, seed, floorH, gfH, len, len, i + 1);
      const v2 = vert(q[0], y1, q[1], ...tint, style, H, seed, floorH, gfH, len, len, i + 1);
      const v3 = vert(a[0], y1, a[1], ...tint, style, H, seed, floorH, gfH, 0, len, i + 1);
      // outward normal (dz, -dx): choose the winding so the face points outward
      if (inward) idx.push(v0, v1, v2, v0, v2, v3);
      else idx.push(v0, v2, v1, v0, v3, v2);
    }
  };
  /** upward-facing cap over a ring */
  const cap = (ring: Ring, y: number, tint: Tint, style: number, seed: number, floorH: number, gfH: number): void => {
    const tris = triangulate([ring]);
    if (!tris.length) return;
    const base = pos.length / 3;
    for (const [x, z] of ring) vert(x, y, z, ...tint, style, y, seed, floorH, gfH, 0, 0, 0);
    for (let i = 0; i < tris.length; i += 3) {
      const p = ring[tris[i]], q = ring[tris[i + 1]], r = ring[tris[i + 2]];
      const s = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
      if (s < 0) idx.push(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
      else idx.push(base + tris[i], base + tris[i + 2], base + tris[i + 1]);
    }
  };
  /** oriented box (walls + cap) for rooftop props */
  const box = (x: number, z: number, ux: number, uz: number, hu: number, hv: number, y0: number, y1: number, tint: Tint, capTint: Tint, seed: number): void => {
    const vx = -uz, vz = ux;
    const ring: Ring = [
      [x - ux * hu - vx * hv, z - uz * hu - vz * hv],
      [x + ux * hu - vx * hv, z + uz * hu - vz * hv],
      [x + ux * hu + vx * hv, z + uz * hu + vz * hv],
      [x - ux * hu + vx * hv, z - uz * hu + vz * hv],
    ];
    if (area2(ring) < 0) ring.reverse();
    walls(ring, y0, y1, tint, FAR_STYLE_MECH, y1, seed, 3, 3);
    cap(ring, y1, capTint, FAR_STYLE_ROOF, seed, 3, 3);
  };
  for (const b of c.buildings) {
    const indexStart = idx.length;
    const h = Math.max(3, b.height);
    if (h < minHeight) continue;
    const poly = normalizePolygon(b.footprint);
    if (!poly) continue;
    const seed = seedOf(b.id);
    const P = buildingParams(b, seed);
    let ring = simplifyRing(poly[0], 0.6);
    const inset = insetOrScale(ring, 0.25);
    if (inset) ring = inset;
    const tint = P.tint;
    const parapetH = P.style === 5 ? 1.0 : 0.6;
    const tiers: { ring: Ring; base: number; top: number }[] = [];
    if (b.roofShape === 'setback' && h > 60) {
      const r1 = insetOrScale(ring, 3.5);
      const r2 = r1 ? insetOrScale(r1, 3.5) : null;
      if (r1 && r2) {
        tiers.push({ ring, base: 0, top: h * 0.55 - FAR_DROP }, { ring: r1, base: h * 0.55 - FAR_DROP, top: h * 0.82 - FAR_DROP }, { ring: r2, base: h * 0.82 - FAR_DROP, top: h - FAR_DROP });
      } else if (r1) tiers.push({ ring, base: 0, top: h * 0.7 - FAR_DROP }, { ring: r1, base: h * 0.7 - FAR_DROP, top: h - FAR_DROP });
      else tiers.push({ ring, base: 0, top: h - FAR_DROP });
    } else tiers.push({ ring, base: 0, top: h - FAR_DROP });
    const roofMat = roofMaterial(seed);
    const rc = roofPalette(seed, roofMat);
    // the lip's inner face: masonry in the wall tone, a metal coping on glass and concrete (the glass tint is a reflectance)
    const lipTint: Tint = P.style === 5 || P.style === 6 ? [0.34, 0.34, 0.35] : tint;
    for (const T of tiers) {
      // walls carry the parapet; aInfo.x stays the roof level so the window grid stops under the cornice
      walls(T.ring, T.base, T.top + parapetH, tint, P.style, T.top, seed, P.floorH, P.gfH);
      // parapet lip: the roof cap sits behind an inward-facing ring where the footprint allows it
      const lip = h > 8 ? insetOrScale(T.ring, 0.3) : null;
      if (lip && Math.abs(area2(lip)) / 2 > 40) {
        walls(lip, T.top, T.top + parapetH, lipTint, FAR_STYLE_PARAPET, T.top, seed, P.floorH, P.gfH, true);
        cap(lip, T.top, rc, FAR_STYLE_ROOF, seed, P.floorH, P.gfH);
      } else cap(T.ring, T.top + parapetH, rc, FAR_STYLE_ROOF, seed, P.floorH, P.gfH);
    }
    // ---- roof props on the top tier (same rules as the near builder, so nothing pops at the tile edge) ----
    const top = tiers[tiers.length - 1];
    const topArea = Math.abs(area2(top.ring)) / 2;
    const pitched = b.roofShape === 'pitched' && h < 16 && topArea < 400;
    if (!pitched && h > 9 && topArea > 70) {
      const roofY0 = top.top + FAR_DROP; // the near roof level: props must match it, not the lowered far cap
      // The mechanical screen goes up first and its deck becomes the prop surface, exactly as in the near
      // builder (builder.ts mechScreen): otherwise a tower's plant sits under its own screen cap.
      let propRing = top.ring, propBase = top.top, propY = roofY0;
      if ((P.style === 5 || P.style === 6) && h > 40 && topArea > 300) {
        const inner = insetOrScale(top.ring, 2.5 + hash4(seed, 45) * 2);
        if (inner && Math.abs(area2(inner)) / 2 >= 60) {
          const g = P.style === 5 ? 0.46 : 0.5;
          const hgt = 3.6 + hash4(seed, 46) * 1.8;
          walls(inner, top.top, roofY0 + hgt, [g, g, g * 1.02], FAR_STYLE_MECH, roofY0 + hgt, seed, P.floorH, P.gfH);
          cap(inner, roofY0 + hgt, rc, FAR_STYLE_ROOF, seed, P.floorH, P.gfH);
          propRing = inner; propBase = roofY0 + hgt; propY = roofY0 + hgt;
        }
      }
      const propArea = Math.abs(area2(propRing)) / 2;
      const obb = orientedBox(propRing);
      const vx = -obb.uz, vz = obb.ux;
      const spots: [number, number][] = [];
      const flip = hash4(seed, 41) < 0.5 ? -1 : 1;
      for (const ins of [2.6, 4.5]) {
        const hl = obb.halfL - ins, hw = obb.halfW - ins;
        if (hl <= 0.5 || hw <= 0.5) continue;
        for (const su of [-flip, flip]) for (const sv of [-1, 1]) spots.push([obb.cx + obb.ux * hl * su + vx * hw * sv, obb.cz + obb.uz * hl * su + vz * hw * sv]);
      }
      spots.push([obb.cx, obb.cz]);
      let spotI = 0;
      const take = (w: number, d: number): [number, number] | null => {
        for (; spotI < spots.length; spotI++) {
          const s = spots[spotI];
          if (boxFits(propRing, s[0], s[1], obb.ux, obb.uz, w / 2 + 0.4, d / 2 + 0.4)) { spotI++; return s; }
        }
        return null;
      };
      const mechTint: Tint = P.style === 5 || P.style === 6 ? [0.55, 0.55, 0.53] : [0.5, 0.42, 0.36];
      const s = take(3, 4);
      if (s) box(s[0], s[1], obb.ux, obb.uz, 1.5, 2, propBase, propY + 2.9, mechTint, [0.22, 0.22, 0.22], seed);
      // condenser / air-handler boxes: the near builder puts a bank on every roof over ~90 m2, so the mid
      // distance needs the same silhouettes or roofs go bald exactly where the LOD line falls (aerial-downtown)
      if (propArea > 180) {
        const hv: Tint = [0.46, 0.46, 0.47];
        const cnt = Math.min(3, Math.round(propArea / 520) + 1);
        for (let k = 0; k < cnt; k++) {
          const u = take(2.0, 1.4);
          if (!u) break;
          box(u[0], u[1], obb.ux, obb.uz, 1.0, 0.7, propBase, propY + 1.0, hv, [0.2, 0.2, 0.2], seed);
        }
      }
      // cooling tower on the bigger offices and lofts
      if (propArea > 400 && h > 28 && hash4(seed, 54) < 0.5) {
        const u = take(3.2, 2.4);
        if (u) box(u[0], u[1], obb.ux, obb.uz, 1.5, 1.1, propBase, propY + 2.2 + hash4(seed, 71) * 1.2, [0.5, 0.5, 0.5], [0.3, 0.3, 0.3], seed);
      }
      if (b.hasWaterTower && propArea > 90) {
        const t = take(4.2, 4.2);
        if (t) towers.push(t[0] - ox, propY, t[1] - oz, 4 + hash4(seed, 42) * 2);
      }
    }
    if (land.has(b.id)) landmarkRanges.push({ bin: b.id, start: indexStart, count: idx.length - indexStart });
    count++;
  }
  if (!pos.length) return null;
  return {
    type: 'chunk',
    key: c.key,
    ox,
    oz,
    position: new Float32Array(pos),
    data: new Uint8Array(data),
    info: new Float32Array(info),
    uv: new Float32Array(uv),
    wall: new Float32Array(wall),
    index: new Uint32Array(idx),
    renderIndex: new Uint32Array(idx),
    towers: new Float32Array(towers),
    bounds: { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2, r: Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 },
    buildings: count,
    landmarkRanges,
  };
}

if (typeof self !== 'undefined') self.onmessage = async (e: MessageEvent<FarStart>) => {
  const m = e.data;
  if (m.type !== 'start') return;
  const land = new Set(m.landmarkBins);
  const chunks = new Map<string, ChunkState>();
  const keys = m.keys.slice();
  const tileChunk = new Map<string, ChunkState>();
  for (const k of keys) {
    const [tx, tz] = k.split('_').map(Number);
    const cx = Math.floor(tx / FAR_CHUNK_TILES), cz = Math.floor(tz / FAR_CHUNK_TILES);
    const ck = `${cx}_${cz}`;
    let c = chunks.get(ck);
    if (!c) {
      const mx = (cx + 0.5) * FAR_CHUNK_TILES * 256, mz = (cz + 0.5) * FAR_CHUNK_TILES * 256;
      c = { key: ck, cx, cz, pending: new Set(), buildings: [], dist: Math.hypot(mx - m.focusX, mz - m.focusZ) };
      chunks.set(ck, c);
    }
    c.pending.add(k);
    tileChunk.set(k, c);
  }
  // nearest tiles first
  keys.sort((a, b) => {
    const [ax, az] = a.split('_').map(Number), [bx, bz] = b.split('_').map(Number);
    return Math.hypot((ax + 0.5) * 256 - m.focusX, (az + 0.5) * 256 - m.focusZ) - Math.hypot((bx + 0.5) * 256 - m.focusX, (bz + 0.5) * 256 - m.focusZ);
  });
  let fetched = 0, built = 0, next = 0;
  const total = keys.length;
  const post = (msg: FarChunkMsg | FarProgress, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(msg, transfer ?? []);
  const finishChunk = (c: ChunkState) => {
    const out = buildChunk(c, land, m.minHeight);
    c.buildings = [];
    built++;
    if (out) post(out, [out.position.buffer, out.data.buffer, out.info.buffer, out.uv.buffer, out.wall.buffer, out.index.buffer, out.renderIndex.buffer, out.towers.buffer]);
  };
  const worker = async () => {
    while (next < keys.length) {
      const k = keys[next++];
      const c = tileChunk.get(k)!;
      try {
        const t = m.tiles ? m.tiles.find(t => t.key === k) : await fetchTile(`${m.baseUrl}/tiles/${k}.json.gz`);
        if (t?.buildings) for (const b of t.buildings) c.buildings.push({ id: b.id, footprint: b.footprint, height: b.height, year: b.year, floors: b.floors, bldgClass: b.bldgClass, landUse: b.landUse, style: b.style, roofShape: b.roofShape, hasWaterTower: b.hasWaterTower, groundElev: 0 });
      } catch {
        /* missing tile: nothing to draw */
      }
      fetched++;
      c.pending.delete(k);
      if (c.pending.size === 0) finishChunk(c);
      if (fetched % 8 === 0 || fetched === total) post({ type: 'progress', fetched, total, chunks: built, done: fetched === total });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  post({ type: 'progress', fetched, total, chunks: built, done: true });
};
