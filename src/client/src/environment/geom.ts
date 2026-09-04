/** Small 2D polygon helpers in world x/z. */
import type { Polygon, Ring } from '@shared/world';

export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return a / 2;
}

export function pointInRing(x: number, z: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(x: number, z: number, poly: Polygon): boolean {
  if (!poly.length || !pointInRing(x, z, poly[0])) return false;
  for (let r = 1; r < poly.length; r++) if (pointInRing(x, z, poly[r])) return false;
  return true;
}

export function ringCentroid(ring: Ring): [number, number] {
  let x = 0, z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  const n = ring.length || 1;
  return [x / n, z / n];
}

export function ringBBox(ring: Ring): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** true when the polygon is (mostly) inside any of the given polygons: centroid or a majority of vertices */
export function polygonInsideAny(poly: Polygon, others: Polygon[]): boolean {
  if (!poly.length || !others.length) return false;
  const [cx, cz] = ringCentroid(poly[0]);
  for (const o of others) if (pointInPolygon(cx, cz, o)) return true;
  let inside = 0;
  const ring = poly[0];
  const step = Math.max(1, Math.floor(ring.length / 12));
  let tested = 0;
  for (let i = 0; i < ring.length; i += step) {
    tested++;
    for (const o of others)
      if (pointInPolygon(ring[i][0], ring[i][1], o)) {
        inside++;
        break;
      }
  }
  return tested > 0 && inside / tested > 0.5;
}

/** deterministic 0..1 hash of two numbers (positions) */
export function hash2(x: number, z: number, seed = 0): number {
  let h = (Math.imul(Math.round(x * 100) | 0, 374761393) + Math.imul(Math.round(z * 100) | 0, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** mulberry32 PRNG */
export function rng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
