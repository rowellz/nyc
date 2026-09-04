/**
 * 2D helpers for the streets module. World (x, z) meters, z south.
 * Rings are open (last != first). signedArea > 0 means the interior is on the LEFT of each edge
 * in (x, z) space, i.e. the outward normal of edge (a -> b) is (dz, -dx).
 */
import * as THREE from 'three';
import type { Polygon, Pt, Ring, RoadSegment } from '@shared/world';

export interface BBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function signedArea(ring: Ring): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function ringBBox(ring: Ring, out?: BBox): BBox {
  const bb = out ?? { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  bb.minX = Infinity; bb.minZ = Infinity; bb.maxX = -Infinity; bb.maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < bb.minX) bb.minX = x;
    if (x > bb.maxX) bb.maxX = x;
    if (z < bb.minZ) bb.minZ = z;
    if (z > bb.maxZ) bb.maxZ = z;
  }
  return bb;
}

export function bboxContains(bb: BBox, x: number, z: number, pad = 0): boolean {
  return x >= bb.minX - pad && x <= bb.maxX + pad && z >= bb.minZ - pad && z <= bb.maxZ + pad;
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

/** polygon with a cached bbox for fast point tests */
export interface IndexedPolygon {
  poly: Polygon;
  bb: BBox;
}

export function indexPolygons(polys: Polygon[]): IndexedPolygon[] {
  const out: IndexedPolygon[] = [];
  for (const poly of polys) {
    if (!poly[0] || poly[0].length < 3) continue;
    out.push({ poly, bb: ringBBox(poly[0]) });
  }
  return out;
}

export function pointInAny(x: number, z: number, polys: IndexedPolygon[], pad = 0): boolean {
  for (const p of polys) {
    if (!bboxContains(p.bb, x, z, pad)) continue;
    if (pointInPolygon(x, z, p.poly)) return true;
  }
  return false;
}

/** Split a convex polygon at an oriented line, retaining both half planes. */
function splitConvex(poly: Ring, a: Pt, b: Pt, sign: number): [Ring, Ring] {
  const inside: Ring = [], outside: Ring = [];
  const distance = (p: Pt) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = distance(p), dq = distance(q);
    (dp >= 0 ? inside : outside).push(p);
    if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
      const t = dp / (dp - dq);
      const hit: Pt = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      inside.push(hit); outside.push(hit);
    }
  }
  return [inside, outside];
}

/** Exact convex clipping; used only while building fallback sidewalks. */
export function clipConvex(poly: Ring, clip: Ring): Ring {
  let result = poly;
  const sign = Math.sign(signedArea(clip));
  for (let i = 0; i < clip.length && result.length; i++) result = splitConvex(result, clip[i], clip[(i + 1) % clip.length], sign)[0];
  return result;
}

/** Convex difference, returned as non-overlapping convex pieces. */
export function subtractConvex(poly: Ring, clip: Ring): Ring[] {
  let inside = poly;
  const result: Ring[] = [], sign = Math.sign(signedArea(clip));
  for (let i = 0; i < clip.length && inside.length; i++) {
    const parts = splitConvex(inside, clip[i], clip[(i + 1) % clip.length], sign);
    inside = parts[0];
    if (parts[1].length >= 3 && Math.abs(signedArea(parts[1])) > 1e-6) result.push(parts[1]);
  }
  // A non-intersecting obstacle must not needlessly subdivide the subject.
  return inside.length < 3 || Math.abs(signedArea(inside)) < 1e-6 ? [poly] : result;
}

/** Triangulate a polygon (outer + holes). Returns flat vertex list [x,z,...] and triangle indices wound so the
 *  face normal points +y. Falls back to the outer ring only if earcut chokes on the holes. */
export function triangulate(poly: Polygon): { verts: number[]; tris: number[] } | null {
  const outer = poly[0];
  if (!outer || outer.length < 3) return null;
  const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
  const holes = poly.slice(1).filter((r) => r.length >= 3).map((r) => r.map(([x, z]) => new THREE.Vector2(x, z)));
  let tris: number[][] = [];
  let all: THREE.Vector2[] = [];
  try {
    tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    all = [...contour, ...holes.flat()];
  } catch {
    tris = [];
  }
  if (!tris.length && holes.length) {
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, []);
      all = contour;
    } catch {
      tris = [];
    }
  }
  if (!tris.length) return null;
  const verts: number[] = new Array(all.length * 2);
  for (let i = 0; i < all.length; i++) {
    verts[i * 2] = all[i].x;
    verts[i * 2 + 1] = all[i].y;
  }
  const out: number[] = [];
  for (const t of tris) {
    const a = all[t[0]], b = all[t[1]], c = all[t[2]];
    // y component of (b-a) x (c-a) for points in the xz plane
    const ny = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
    if (ny > 0) out.push(t[0], t[1], t[2]);
    else out.push(t[0], t[2], t[1]);
  }
  return { verts, tris: out };
}

/** deterministic 0..1 hash of two numbers */
export function hash2(a: number, b: number): number {
  let h = Math.imul(Math.floor(a * 1000) | 0, 374761393) + Math.imul(Math.floor(b * 1000) | 0, 668265263);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** small seeded RNG (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function polylineLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** point + unit tangent at arc length s along a polyline (clamped) */
export function pointAlong(pts: Pt[], s: number): { x: number; z: number; dx: number; dz: number } {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
    const l = Math.hypot(bx - ax, bz - az);
    if (s <= acc + l || i === pts.length - 1) {
      const t = l > 0 ? Math.max(0, Math.min(1, (s - acc) / l)) : 0;
      const dx = l > 0 ? (bx - ax) / l : 1, dz = l > 0 ? (bz - az) / l : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx, dz };
    }
    acc += l;
  }
  const p = pts[0];
  return { x: p[0], z: p[1], dx: 1, dz: 0 };
}

export interface NearestSample {
  seg: RoadSegment;
  x: number;
  z: number;
  dist: number; // unsigned
  side: number; // signed distance: + = right of travel direction (x east, z south: right = (-dz, dx))
  dx: number;
  dz: number;
  s: number; // arc length along the segment
}

/** road segments with cached bbox + cumulative lengths for repeated nearest queries */
export class RoadIndex {
  segs: { seg: RoadSegment; bb: BBox; cum: number[] }[] = [];
  constructor(roads: RoadSegment[], filter: (r: RoadSegment) => boolean) {
    const seen = new Set<number>();
    for (const r of roads) {
      if (seen.has(r.id) || !filter(r) || r.pts.length < 2) continue;
      seen.add(r.id);
      const bb = ringBBox(r.pts);
      const hw = r.width / 2 + 12;
      bb.minX -= hw; bb.maxX += hw; bb.minZ -= hw; bb.maxZ += hw;
      const cum = [0];
      for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
      this.segs.push({ seg: r, bb, cum });
    }
  }

  nearest(x: number, z: number, maxDist = 40, out?: NearestSample): NearestSample | null {
    let bestD2 = maxDist * maxDist;
    let best: NearestSample | null = null;
    for (const e of this.segs) {
      const bb = e.bb;
      if (x < bb.minX - maxDist || x > bb.maxX + maxDist || z < bb.minZ - maxDist || z > bb.maxZ + maxDist) continue;
      const pts = e.seg.pts;
      for (let i = 0; i + 1 < pts.length; i++) {
        const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
        const ex = bx - ax, ez = bz - az;
        const len2 = ex * ex + ez * ez;
        if (len2 < 1e-6) continue;
        let t = ((x - ax) * ex + (z - az) * ez) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + ex * t, pz = az + ez * t;
        const ddx = x - px, ddz = z - pz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < bestD2) {
          bestD2 = d2;
          const len = Math.sqrt(len2);
          const dx = ex / len, dz = ez / len;
          if (!best) best = out ?? ({} as NearestSample);
          best.seg = e.seg;
          best.x = px;
          best.z = pz;
          best.dist = Math.sqrt(d2);
          best.side = ddx * -dz + ddz * dx;
          best.dx = dx;
          best.dz = dz;
          best.s = e.cum[i] + t * len;
        }
      }
    }
    return best;
  }
}

/** Clip a polyline to an axis-aligned rect; returns pieces with the arc-length offset (s0) of each piece start
 *  measured along the ORIGINAL polyline (so dash phases stay continuous across tiles). */
export function clipPolylineToRect(pts: Pt[], r: BBox): { pts: Pt[]; s0: number }[] {
  const out: { pts: Pt[]; s0: number }[] = [];
  let cur: Pt[] | null = null;
  let curS0 = 0;
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const c = clipSegment(a, b, r);
    if (c) {
      const [p0, p1, t0, t1] = c;
      if (!cur || t0 > 1e-9 || (cur.length && (Math.abs(cur[cur.length - 1][0] - p0[0]) > 1e-6 || Math.abs(cur[cur.length - 1][1] - p0[1]) > 1e-6))) {
        if (cur && cur.length >= 2) out.push({ pts: cur, s0: curS0 });
        cur = [p0];
        curS0 = acc + t0 * segLen;
      }
      cur.push(p1);
      if (t1 < 1 - 1e-9) {
        if (cur.length >= 2) out.push({ pts: cur, s0: curS0 });
        cur = null;
      }
    } else if (cur) {
      if (cur.length >= 2) out.push({ pts: cur, s0: curS0 });
      cur = null;
    }
    acc += segLen;
  }
  if (cur && cur.length >= 2) out.push({ pts: cur, s0: curS0 });
  return out;
}

/** Liang–Barsky segment clip: returns [p0, p1, t0, t1] or null */
function clipSegment(a: Pt, b: Pt, r: BBox): [Pt, Pt, number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const p = [-dx, dx, -dz, dz];
  const q = [a[0] - r.minX, r.maxX - a[0], a[1] - r.minZ, r.maxZ - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [[a[0] + dx * t0, a[1] + dz * t0], [a[0] + dx * t1, a[1] + dz * t1], t0, t1];
}

/** true if both endpoints lie on the same side line of the rect (an artifact edge from tile clipping) */
export function edgeOnRect(a: Pt, b: Pt, r: BBox, eps = 0.02): boolean {
  return (
    (Math.abs(a[0] - r.minX) < eps && Math.abs(b[0] - r.minX) < eps) ||
    (Math.abs(a[0] - r.maxX) < eps && Math.abs(b[0] - r.maxX) < eps) ||
    (Math.abs(a[1] - r.minZ) < eps && Math.abs(b[1] - r.minZ) < eps) ||
    (Math.abs(a[1] - r.maxZ) < eps && Math.abs(b[1] - r.maxZ) < eps)
  );
}

export const VEHICULAR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service']);
export const STREET = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential']);

/** road direction -> (cos 2θ, sin 2θ): invariant under reversal, interpolates sanely */
export function dir2(dx: number, dz: number): [number, number] {
  const c = dx, s = dz;
  return [c * c - s * s, 2 * c * s];
}
/** (cos 4θ, sin 4θ): invariant under 90° turns (sidewalk flag grids) */
export function dir4(dx: number, dz: number): [number, number] {
  const [c2, s2] = dir2(dx, dz);
  return [c2 * c2 - s2 * s2, 2 * c2 * s2];
}

/** Manhattan grid default direction (avenues run ~29° east of north): unit vector pointing "up-avenue" */
export const GRID_DIR: [number, number] = [Math.sin((29 * Math.PI) / 180), -Math.cos((29 * Math.PI) / 180)];

export function yawToDir(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}
