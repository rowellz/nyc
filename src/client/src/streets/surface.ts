/**
 * Per-tile 1 m raster of the walkable surface type for surfaceAt(), plus small lists of paint / metal
 * decals that are too thin for the raster.
 */
import { TILE_SIZE } from '@shared/geo';
import { KIND } from './materials';

export const SURF = { none: 0, asphalt: 1, concrete: 2, cobble: 3 } as const;
export const SURF_NAME: (string | null)[] = [null, 'asphalt', 'concrete', 'cobblestone'];

export interface DecalRect {
  cx: number;
  cz: number;
  dx: number;
  dz: number; // long axis
  hl: number;
  hw: number;
}

export function surfForKind(kind: number): number {
  switch (Math.round(kind)) {
    case KIND.asphalt:
      return SURF.asphalt;
    case KIND.concreteRoad:
      return SURF.concrete;
    case KIND.cobble:
      return SURF.cobble;
    default:
      return SURF.concrete;
  }
}

export class SurfaceGrid {
  static readonly N = TILE_SIZE; // 1 m cells
  data: Uint8Array = new Uint8Array(SurfaceGrid.N * SurfaceGrid.N);
  paint: DecalRect[] = [];
  metal: DecalRect[] = [];
  constructor(public ox: number, public oz: number) {}

  /** rasterize indexed triangles; kind per vertex from aA (stride 4) */
  rasterize(pos: number[], idx: number[], aA: number[], yMax = 1): void {
    const N = SurfaceGrid.N;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const ax = pos[a * 3] - this.ox, az = pos[a * 3 + 2] - this.oz;
      const bx = pos[b * 3] - this.ox, bz = pos[b * 3 + 2] - this.oz;
      const cx = pos[c * 3] - this.ox, cz = pos[c * 3 + 2] - this.oz;
      // skip vertical faces (curbs) and elevated decks
      if (pos[a * 3 + 1] > yMax || pos[b * 3 + 1] > yMax || pos[c * 3 + 1] > yMax) continue;
      const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(area) < 1e-6) continue;
      const code = surfForKind(aA[a * 4]);
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minZ = Math.max(0, Math.floor(Math.min(az, bz, cz))), maxZ = Math.min(N - 1, Math.ceil(Math.max(az, bz, cz)));
      const inv = 1 / area;
      for (let gz = minZ; gz <= maxZ; gz++) {
        const pz = gz + 0.5;
        for (let gx = minX; gx <= maxX; gx++) {
          const px = gx + 0.5;
          const w0 = ((bx - px) * (cz - pz) - (cx - px) * (bz - pz)) * inv;
          const w1 = ((cx - px) * (az - pz) - (ax - px) * (cz - pz)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) this.data[gz * N + gx] = code;
        }
      }
    }
  }

  query(x: number, z: number): string | null {
    const N = SurfaceGrid.N;
    const gx = Math.floor(x - this.ox), gz = Math.floor(z - this.oz);
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return null;
    for (const m of this.metal) if (inRect(m, x, z)) return 'metal';
    const base = SURF_NAME[this.data[gz * N + gx]];
    if (base) for (const p of this.paint) if (inRect(p, x, z)) return 'paint';
    return base;
  }
}

function inRect(r: DecalRect, x: number, z: number): boolean {
  const px = x - r.cx, pz = z - r.cz;
  const along = px * r.dx + pz * r.dz;
  const across = px * -r.dz + pz * r.dx;
  return Math.abs(along) <= r.hl && Math.abs(across) <= r.hw;
}
