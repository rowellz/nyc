/** One welded sidewalk trimesh per tile, shared with the exact (not 1 m raster) height query. */
import { TILE_SIZE } from '@shared/geo';
import type { GroundBuilder } from './builders';
import { KIND } from './materials';
import { WALK_Y, type CurbEdge } from './sidewalk';

const CELL = 8;
const N = TILE_SIZE / CELL;

export interface WalkCollision {
  position: Float32Array;
  index: Uint32Array;
  /** CSR spatial bins of nonvertical triangles, built off-thread. */
  offsets: Uint32Array;
  triangles: Uint32Array;
}

export function buildWalkCollision(walk: GroundBuilder, curbs: CurbEdge[], ox: number, oz: number): WalkCollision {
  const pos: number[] = [], idx: number[] = [], vertices = new Map<string, number>();
  const vertex = (x: number, y: number, z: number) => {
    // Weld in the same precision Rapier receives, including the ramp/top boundary.
    x = Math.fround(x); y = Math.fround(y); z = Math.fround(z);
    const key = `${x},${y},${z}`;
    let v = vertices.get(key);
    if (v === undefined) { v = pos.length / 3; vertices.set(key, v); pos.push(x, y, z); }
    return v;
  };
  for (let i = 0; i < walk.idx.length; i += 3) {
    // Granite joints, bevels and the 4 mm decorative cap are rendering only.
    // Keep the polygon tops (with holes/notches), ramp slopes/returns and footpaths.
    if (walk.aA[walk.idx[i] * 4] === KIND.curb) continue;
    for (let j = 0; j < 3; j++) {
      const v = walk.idx[i + j] * 3;
      idx.push(vertex(walk.pos[v], walk.pos[v + 1], walk.pos[v + 2]));
    }
  }
  // A whole 15 cm face per curb, not a collider per decorative stone. Curb cuts
  // are already absent from this list, so no invisible wall closes a ramp.
  for (const c of curbs) {
    const a = vertex(c.ax, 0, c.az), b = vertex(c.bx, 0, c.bz);
    const d = vertex(c.ax, WALK_Y, c.az), e = vertex(c.bx, WALK_Y, c.bz);
    if (-(c.bz - c.az) * c.nx + (c.bx - c.ax) * c.nz > 0) idx.push(a, b, e, a, e, d);
    else idx.push(a, e, b, a, d, e);
  }
  const bins: number[][] = Array.from({ length: N * N }, () => []);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const area = (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]) - (pos[c] - pos[a]) * (pos[b + 2] - pos[a + 2]);
    if (Math.abs(area) < 1e-8) continue;
    const x0 = Math.max(0, Math.floor((Math.min(pos[a], pos[b], pos[c]) - ox) / CELL));
    const x1 = Math.min(N - 1, Math.floor((Math.max(pos[a], pos[b], pos[c]) - ox) / CELL));
    const z0 = Math.max(0, Math.floor((Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) - oz) / CELL));
    const z1 = Math.min(N - 1, Math.floor((Math.max(pos[a + 2], pos[b + 2], pos[c + 2]) - oz) / CELL));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) bins[z * N + x].push(i);
  }
  const offsets = new Uint32Array(bins.length + 1);
  for (let i = 0; i < bins.length; i++) offsets[i + 1] = offsets[i] + bins[i].length;
  return { position: new Float32Array(pos), index: new Uint32Array(idx), offsets, triangles: new Uint32Array(bins.flat()) };
}

/** Barycentric heights preserve holes, sub-metre curb edges and continuously sloping curb cuts. */
export function walkHeightIn(walk: WalkCollision, x: number, z: number, ox: number, oz: number): number {
  const gx = Math.floor((x - ox) / CELL), gz = Math.floor((z - oz) / CELL);
  if (gx < 0 || gz < 0 || gx >= N || gz >= N) return 0;
  const bin = gz * N + gx, p = walk.position, idx = walk.index;
  let height = 0;
  for (let j = walk.offsets[bin]; j < walk.offsets[bin + 1]; j++) {
    const i = walk.triangles[j], a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = p[a] - x, az = p[a + 2] - z, bx = p[b] - x, bz = p[b + 2] - z, cx = p[c] - x, cz = p[c + 2] - z;
    const inv = 1 / ((bx - ax) * (cz - az) - (cx - ax) * (bz - az));
    const u = (bx * cz - cx * bz) * inv, v = (cx * az - ax * cz) * inv, w = 1 - u - v;
    if (u >= -1e-7 && v >= -1e-7 && w >= -1e-7) height = Math.max(height, u * p[a + 1] + v * p[b + 1] + w * p[c + 1]);
  }
  return height;
}
