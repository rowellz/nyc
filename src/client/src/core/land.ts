/** Exact horizontal land mesh: split a tile into trapezoids outside the union of its water polygons.
 * Scan bands include edge crossings, so concavities, holes, overlaps and tile-edge water all work.
 */
import { TILE_SIZE } from '@shared/geo';
import type { Tile } from '@shared/world';
import { pointInPolygon } from './physics';

type Edge = { x: (z: number) => number; lo: number; hi: number };
export function landMesh(tile: Tile): { vertices: Float32Array; indices: Uint32Array } {
  const x0 = tile.tx * TILE_SIZE, x1 = x0 + TILE_SIZE, z0 = tile.tz * TILE_SIZE, z1 = z0 + TILE_SIZE;
  const cuts = new Set<number>([z0, z1]);
  const edges: Edge[] = [{ x: () => x0, lo: z0, hi: z1 }, { x: () => x1, lo: z0, hi: z1 }];
  for (const poly of tile.water) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (a[1] === b[1]) continue;
    const lo = Math.max(z0, Math.min(a[1], b[1])), hi = Math.min(z1, Math.max(a[1], b[1]));
    if (lo >= hi) continue;
    edges.push({ lo, hi, x: z => a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1]) });
    cuts.add(lo); cuts.add(hi);
  }
  for (let i = 0; i < edges.length; i++) for (let j = 0; j < i; j++) {
    const a = edges[i], b = edges[j], lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
    if (lo >= hi) continue;
    const d0 = a.x(lo) - b.x(lo), d1 = a.x(hi) - b.x(hi);
    if (d0 * d1 < 0) cuts.add(lo + (hi - lo) * d0 / (d0 - d1));
  }
  const bands = [...cuts].sort((a, b) => a - b), vertices: number[] = [], indices: number[] = [];
  for (let i = 1; i < bands.length; i++) {
    const lo = bands[i - 1], hi = bands[i], mid = (lo + hi) / 2;
    const active = edges.filter(e => e.lo <= mid && e.hi >= mid).sort((a, b) => a.x(mid) - b.x(mid));
    for (let j = 1; j < active.length; j++) {
      const a = active[j - 1], b = active[j], x = (a.x(mid) + b.x(mid)) / 2;
      if (x <= x0 || x >= x1 || b.x(mid) - a.x(mid) < 1e-7 || tile.water.some(p => pointInPolygon(x, mid, p))) continue;
      const n = vertices.length / 3;
      const clamp = (v: number) => Math.max(x0, Math.min(x1, v));
      vertices.push(clamp(a.x(lo)), 0, lo, clamp(b.x(lo)), 0, lo, clamp(b.x(hi)), 0, hi, clamp(a.x(hi)), 0, hi);
      indices.push(n, n + 2, n + 1, n, n + 3, n + 2);
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
