/**
 * 2D polygon helpers in the world x/z plane. No three.js dependency (runs in the builder worker).
 * Convention used throughout the buildings module after normalizeRing():
 *   outer rings have POSITIVE shoelace area (sum x_i*z_{i+1} - x_{i+1}*z_i > 0), holes negative,
 *   and the outward wall normal of edge a->b is (dz, -dx) for both.
 */
import { Earcut } from 'three/src/extras/Earcut.js';
import type { Pt, Ring, Polygon } from '@shared/world';

export function area2(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a;
}

/** drop duplicate / collinear-ish points, closing duplicates, enforce orientation */
export function cleanRing(ring: Ring, wantPositive: boolean, eps = 0.02): Ring | null {
  const out: Ring = [];
  for (const p of ring) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < eps && Math.abs(q[1] - p[1]) < eps) continue;
    out.push([p[0], p[1]]);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps) out.pop();
  }
  // remove collinear points (they only add wall quads)
  for (let i = 0; i < out.length && out.length > 3; ) {
    const p = out[(i + out.length - 1) % out.length], q = out[i], r = out[(i + 1) % out.length];
    const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
    const l1 = Math.hypot(q[0] - p[0], q[1] - p[1]), l2 = Math.hypot(r[0] - q[0], r[1] - q[1]);
    if (Math.abs(cross) < 0.01 * l1 * l2) out.splice(i, 1);
    else i++;
  }
  if (out.length < 3) return null;
  const a = area2(out);
  if (Math.abs(a) < 1) return null;
  if (a > 0 !== wantPositive) out.reverse();
  return out;
}

export function normalizePolygon(poly: Polygon): Polygon | null {
  const outer = cleanRing(poly[0] ?? [], true);
  if (!outer) return null;
  const out: Polygon = [outer];
  for (let i = 1; i < poly.length; i++) {
    const h = cleanRing(poly[i], false);
    if (h) out.push(h);
  }
  return out;
}

export function ringBBox(ring: Ring): { minX: number; minZ: number; maxX: number; maxZ: number } {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

export function ringCentroid(ring: Ring): Pt {
  let cx = 0, cz = 0, a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * f;
    cz += (ring[j][1] + ring[i][1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0, sz = 0;
    for (const p of ring) { sx += p[0]; sz += p[1]; }
    return [sx / ring.length, sz / ring.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
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
  if (!pointInRing(x, z, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(x, z, poly[i])) return false;
  return true;
}

/** earcut triangulation; returns flat index triples into the concatenated ring points */
export function triangulate(poly: Polygon): number[] {
  const data: number[] = [];
  const holes: number[] = [];
  for (let r = 0; r < poly.length; r++) {
    if (r > 0) holes.push(data.length / 2);
    for (const [x, z] of poly[r]) data.push(x, z);
  }
  try {
    return Earcut.triangulate(data, holes.length ? holes : undefined, 2);
  } catch {
    return [];
  }
}

/**
 * Inward offset of a simple ring by d (m). Intersects consecutive offset edges; validates the result
 * (same orientation, smaller area, every vertex inside the original ring, no huge miter spikes).
 * Returns null when the offset collapses or misbehaves (caller falls back to scaling).
 */
export function insetRing(ring: Ring, d: number): Ring | null {
  const n = ring.length;
  if (n < 3) return null;
  const sign = area2(ring) > 0 ? 1 : -1;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i + n - 1) % n], p1 = ring[i], p2 = ring[(i + 1) % n];
    // edge directions
    let ax = p1[0] - p0[0], az = p1[1] - p0[1];
    let bx = p2[0] - p1[0], bz = p2[1] - p1[1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    // inward normals: outward is (dz, -dx) for positive rings -> inward (-dz, dx); flipped for negative rings
    const nax = -az * sign, naz = ax * sign;
    const nbx = -bz * sign, nbz = bx * sign;
    // miter direction
    let mx = nax + nbx, mz = naz + nbz;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) return null; // 180° turn
    mx /= ml; mz /= ml;
    const cosHalf = mx * nax + mz * naz; // = cos(theta/2)
    if (cosHalf < 0.2) return null; // extremely sharp corner: miter explodes
    const len = d / cosHalf;
    out.push([p1[0] + mx * len, p1[1] + mz * len]);
  }
  const a0 = area2(ring), a1 = area2(out);
  if (a1 * sign <= 0 || Math.abs(a1) >= Math.abs(a0)) return null;
  // expect the area to shrink by roughly perimeter*d; if it shrank too much the ring folded
  let per = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) per += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
  const expected = Math.abs(a0) / 2 - per * d;
  if (expected < 4 || Math.abs(a1) / 2 < expected * 0.5) return null;
  for (const [x, z] of out) if (!pointInRing(x, z, ring)) return null;
  // edges must keep their direction (no local inversions)
  for (let i = 0; i < n; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % n], q1 = out[i], q2 = out[(i + 1) % n];
    if ((p2[0] - p1[0]) * (q2[0] - q1[0]) + (p2[1] - p1[1]) * (q2[1] - q1[1]) <= 0) return null;
  }
  return out;
}

/** inset with a scale-about-centroid fallback; null if the footprint is too small for the inset */
export function insetOrScale(ring: Ring, d: number): Ring | null {
  const ins = insetRing(ring, d);
  if (ins) return ins;
  const a = Math.abs(area2(ring)) / 2;
  const r = Math.sqrt(a / Math.PI);
  if (r < d * 2.2) return null;
  const s = 1 - d / r;
  const c = ringCentroid(ring);
  const out: Ring = ring.map(([x, z]) => [c[0] + (x - c[0]) * s, c[1] + (z - c[1]) * s]);
  for (const [x, z] of out) if (!pointInRing(x, z, ring)) return null;
  return out;
}

/** Douglas-Peucker on a closed ring (keeps at least 3 points) */
export function simplifyRing(ring: Ring, tol: number): Ring {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  // split at the farthest point from the first, so a closed ring becomes two open chains
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  keep[far] = 1;
  const t2 = tol * tol;
  const stack: [number, number][] = [[0, far], [far, ring.length]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const a = ring[s], b = ring[e % ring.length];
    let best = -1, bd = t2;
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const l2 = ex * ex + ez * ez || 1;
    for (let i = s + 1; i < e; i++) {
      const p = ring[i];
      let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = p[0] - (a[0] + ex * t), dz = p[1] - (a[1] + ez * t);
      const d = dx * dx + dz * dz;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  if (out.length < 3) return ring;
  return out;
}

/** minimum-area oriented bounding box (tries every edge direction) */
export function orientedBox(ring: Ring): { cx: number; cz: number; ux: number; uz: number; halfL: number; halfW: number } {
  let best: { cx: number; cz: number; ux: number; uz: number; halfL: number; halfW: number } | null = null;
  let bestArea = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    let ux = b[0] - a[0], uz = b[1] - a[1];
    const l = Math.hypot(ux, uz);
    if (l < 0.5) continue;
    ux /= l; uz /= l;
    const vx = -uz, vz = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of ring) {
      const u = p[0] * ux + p[1] * uz, v = p[0] * vx + p[1] * vz;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      let halfL = (maxU - minU) / 2, halfW = (maxV - minV) / 2;
      let fx = ux, fz = uz;
      if (halfW > halfL) { const t = halfL; halfL = halfW; halfW = t; fx = vx; fz = vz; }
      best = { cx: cu * ux + cv * vx, cz: cu * uz + cv * vz, ux: fx, uz: fz, halfL, halfW };
    }
  }
  if (!best) {
    const bb = ringBBox(ring);
    return { cx: (bb.minX + bb.maxX) / 2, cz: (bb.minZ + bb.maxZ) / 2, ux: 1, uz: 0, halfL: (bb.maxX - bb.minX) / 2, halfW: (bb.maxZ - bb.minZ) / 2 };
  }
  return best;
}

/** distance from a point to a polyline, and the closest segment direction */
export function distToPolyline(x: number, z: number, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const ex = bx - ax, ez = bz - az;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (ax + ex * t), dz = z - (az + ez * t);
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
