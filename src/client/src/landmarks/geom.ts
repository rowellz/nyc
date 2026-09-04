/**
 * Geometry helpers for hand-built landmarks.
 *
 * Everything is collected into a GeoBuilder (positions/normals/uv/style attributes/indices) and turned into one
 * BufferGeometry per material so each landmark is a handful of draw calls.
 *
 * Facade UVs are in METERS: uv.x = distance along the wall, uv.y = world height. The facade shader
 * (materials.ts) draws windows / stone courses / mullions from those, so detail is crisp at any distance
 * without textures or extra triangles.
 *
 * Per-vertex attributes:
 *   aStyle  float  facade style id (see materials.ts STYLE)
 *   aParam  vec4   style parameters (floorH, bayW, winW, winH) for window styles, or rgb+x for colored ones
 *   aParam2 vec4   (sill, litDensity, floodlit, litBase)
 */
import * as THREE from 'three';
import type { Pt, Ring } from '@shared/world';

export interface StyleSpec {
  style: number;
  /** (floorH, bayW, winW, winH) or (r, g, b, x) */
  p: [number, number, number, number];
  /** (sill, litDensity, floodlit, litBase) */
  p2?: [number, number, number, number];
}

export const PLAIN: StyleSpec = { style: 0, p: [0.6, 0.58, 0.54, 0], p2: [0, 0, 0, 0] };

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  st: number[] = [];
  p1: number[] = [];
  p2: number[] = [];
  idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, s: StyleSpec): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.st.push(s.style);
    this.p1.push(s.p[0], s.p[1], s.p[2], s.p[3]);
    const q = s.p2 ?? [0, 0, 0, 0];
    this.p2.push(q[0], q[1], q[2], q[3]);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /**
   * Vertical walls around a ring (world x/z), from y0 to y1. Outward normals are derived from ring winding.
   * uStart lets consecutive rings continue the facade coordinate.
   */
  walls(ring: Ring, y0: number, y1: number, s: StyleSpec, opts: { closed?: boolean; uStart?: number; flipNormals?: boolean; uRelative?: boolean } = {}): void {
    const n = ring.length;
    if (n < 2) return;
    const closed = opts.closed ?? true;
    const cw = signedArea(ring) > 0; // z points south: positive area == clockwise seen from above (y up)
    let u = opts.uStart ?? 0;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-4) continue;
      // outward normal: for a ring that is clockwise seen from above (positive signed area in x/z) it is (dz, -dx)/len
      let nx = dz / len;
      let nz = -dx / len;
      if (!cw) {
        nx = -nx;
        nz = -nz;
      }
      if (opts.flipNormals) {
        nx = -nx;
        nz = -nz;
      }
      const u0 = opts.uRelative ? 0 : u;
      const v0 = this.vertex(a[0], y0, a[1], nx, 0, nz, u0, y0, s);
      const v1 = this.vertex(b[0], y0, b[1], nx, 0, nz, u0 + len, y0, s);
      const v2 = this.vertex(b[0], y1, b[1], nx, 0, nz, u0 + len, y1, s);
      const v3 = this.vertex(a[0], y1, a[1], nx, 0, nz, u0, y1, s);
      if (cw !== !!opts.flipNormals) this.quad(v0, v3, v2, v1);
      else this.quad(v0, v1, v2, v3);
      u += len;
    }
  }

  /** flat horizontal cap (roof) at height y for a polygon ring (with optional holes); normal up (or down) */
  cap(ring: Ring, y: number, s: StyleSpec, opts: { holes?: Ring[]; down?: boolean; uvScale?: number } = {}): void {
    if (ring.length < 3) return;
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = (opts.holes ?? []).map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    } catch {
      return;
    }
    if (!tris.length) return;
    const all = [...contour, ...holes.flat()];
    const base = this.vertexCount;
    const ny = opts.down ? -1 : 1;
    const k = opts.uvScale ?? 1;
    for (const p of all) this.vertex(p.x, y, p.y, 0, ny, 0, p.x * k, p.y * k, s);
    for (const t of tris) {
      // triangulateShape returns triangles in the contour's winding; make them face up (y+) regardless
      const a = all[t[0]], b = all[t[1]], c = all[t[2]];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      // in x/z with z south, a triangle seen from above (+y) is CCW when cross < 0
      const up = cross < 0;
      if (up !== !!opts.down) this.tri(base + t[0], base + t[1], base + t[2]);
      else this.tri(base + t[0], base + t[2], base + t[1]);
    }
  }

  /** extrude a ring: walls from y0..y1 and a roof cap at y1 */
  prism(ring: Ring, y0: number, y1: number, wall: StyleSpec, roof: StyleSpec | null = ROOF, opts: { holes?: Ring[]; uStart?: number } = {}): void {
    this.walls(ring, y0, y1, wall, { uStart: opts.uStart });
    if (opts.holes) for (const h of opts.holes) this.walls(h, y0, y1, wall, { flipNormals: true });
    if (roof) this.cap(ring, y1, roof, { holes: opts.holes });
  }

  /** a box: center (cx, cy, cz), size sx along the direction (cos angle, sin angle) in x/z, sz across it, sy tall */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, angle: number, wall: StyleSpec, top: StyleSpec | null = wall, bottom: StyleSpec | null = null): void {
    const c = Math.cos(angle), s = Math.sin(angle);
    const hx = sx / 2, hz = sz / 2;
    const corner = (u: number, v: number): Pt => [cx + u * c - v * s, cz + u * s + v * c];
    const ring: Ring = [corner(-hx, -hz), corner(hx, -hz), corner(hx, hz), corner(-hx, hz)];
    this.walls(ring, cy - sy / 2, cy + sy / 2, wall, { uRelative: true });
    if (top) this.cap(ring, cy + sy / 2, top);
    if (bottom) this.cap(ring, cy - sy / 2, bottom, { down: true });
  }

  /** frustum / tapered prism between two rings with the same vertex count (e.g. tapered towers, spires) */
  loft(r0: Ring, y0: number, r1: Ring, y1: number, s: StyleSpec, opts: { uRelative?: boolean; cap?: StyleSpec | null } = {}): void {
    const n = r0.length;
    if (n !== r1.length || n < 2) return;
    const cw = signedArea(r0) > 0;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const a0 = r0[i], b0 = r0[(i + 1) % n], a1 = r1[i], b1 = r1[(i + 1) % n];
      const ex = b0[0] - a0[0], ez = b0[1] - a0[1];
      const len = Math.hypot(ex, ez) || 1e-4;
      // face normal from the two edges
      const ax = a1[0] - a0[0], ay = y1 - y0, az = a1[1] - a0[1];
      let nx = ez * ay, ny = ex * az - ez * ax, nz = -ex * ay;
      // ensure outward (same side as the horizontal outward normal)
      let ox = ez / len, oz = -ex / len;
      if (!cw) {
        ox = -ox;
        oz = -oz;
      }
      if (nx * ox + nz * oz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const u0 = opts.uRelative ? 0 : u;
      const v0 = this.vertex(a0[0], y0, a0[1], nx, ny, nz, u0, y0, s);
      const v1 = this.vertex(b0[0], y0, b0[1], nx, ny, nz, u0 + len, y0, s);
      const v2 = this.vertex(b1[0], y1, b1[1], nx, ny, nz, u0 + len, y1, s);
      const v3 = this.vertex(a1[0], y1, a1[1], nx, ny, nz, u0, y1, s);
      if (cw) this.quad(v0, v3, v2, v1);
      else this.quad(v0, v1, v2, v3);
      u += len;
    }
    if (opts.cap) this.cap(r1, y1, opts.cap);
  }

  /** a tapered cylinder along +y (mast, antenna, spire) */
  cylinder(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, seg: number, s: StyleSpec, opts: { cap?: StyleSpec | null; yaw?: number } = {}): void {
    const ring0 = circle(cx, cz, r0, seg, opts.yaw ?? 0);
    const ring1 = circle(cx, cz, r1, seg, opts.yaw ?? 0);
    this.loft(ring0, y0, ring1, y1, s, { cap: opts.cap ?? null });
  }

  /** a UV sphere with smooth normals (lamp globes, finials); uv = (arc length around, world height) */
  sphere(cx: number, cy: number, cz: number, r: number, segU: number, segV: number, s: StyleSpec): void {
    const rows: number[][] = [];
    for (let j = 0; j <= segV; j++) {
      const phi = (j / segV) * Math.PI; // 0 at the top, PI at the bottom
      const ny = Math.cos(phi), rr = Math.sin(phi);
      const row: number[] = [];
      for (let i = 0; i <= segU; i++) {
        const th = (i / segU) * Math.PI * 2;
        const nx = Math.cos(th) * rr, nz = Math.sin(th) * rr;
        row.push(this.vertex(cx + nx * r, cy + ny * r, cz + nz * r, nx, ny, nz, th * r, cy + ny * r, s));
      }
      rows.push(row);
    }
    for (let j = 0; j < segV; j++) {
      for (let i = 0; i < segU; i++) {
        const a = rows[j][i], b = rows[j][i + 1], c = rows[j + 1][i + 1], d = rows[j + 1][i];
        // theta increases toward +z, which is screen-left seen from +x: a -> b -> c -> d is counter-clockwise from outside
        if (j > 0) this.tri(a, b, c);
        if (j < segV - 1) this.tri(a, c, d);
      }
    }
  }

  /** a tube along an arbitrary 3D polyline (cables, railings): `seg` sides */
  tube(points: THREE.Vector3[], radius: number, seg: number, s: StyleSpec): void {
    if (points.length < 2) return;
    const rings: number[][] = [];
    const tmp = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
    let along = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
      tmp.subVectors(next, prev).normalize();
      if (i > 0) along += points[i].distanceTo(points[i - 1]);
      // frame
      const up = Math.abs(tmp.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      n1.crossVectors(tmp, up).normalize();
      n2.crossVectors(tmp, n1).normalize();
      const ring: number[] = [];
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const nx = n1.x * Math.cos(a) + n2.x * Math.sin(a);
        const ny = n1.y * Math.cos(a) + n2.y * Math.sin(a);
        const nz = n1.z * Math.cos(a) + n2.z * Math.sin(a);
        ring.push(this.vertex(p.x + nx * radius, p.y + ny * radius, p.z + nz * radius, nx, ny, nz, along, (k / seg) * radius * Math.PI * 2, s));
      }
      rings.push(ring);
    }
    for (let i = 0; i + 1 < rings.length; i++) {
      const a = rings[i], b = rings[i + 1];
      for (let k = 0; k < seg; k++) {
        const k2 = (k + 1) % seg;
        this.quad(a[k], b[k], b[k2], a[k2]);
      }
    }
  }

  /** a flat quad in 3D from 4 corners (counter-clockwise seen from the front) with given uv range */
  quad3(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, s: StyleSpec, uv: [number, number, number, number] = [0, 0, 1, 1]): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const i0 = this.vertex(a.x, a.y, a.z, n.x, n.y, n.z, uv[0], uv[1], s);
    const i1 = this.vertex(b.x, b.y, b.z, n.x, n.y, n.z, uv[2], uv[1], s);
    const i2 = this.vertex(c.x, c.y, c.z, n.x, n.y, n.z, uv[2], uv[3], s);
    const i3 = this.vertex(d.x, d.y, d.z, n.x, n.y, n.z, uv[0], uv[3], s);
    this.quad(i0, i1, i2, i3);
  }

  /**
   * A planar shape with holes standing in a vertical plane (arched windows, portals, an arcade): contour and
   * holes are (u, y) with u measured from `origin` along the horizontal unit direction `along`; the face's
   * outward normal is the horizontal `normal`. Facade uv = (u + uOff, world y) like `walls`.
   */
  shape(origin: XYZ, along: [number, number], normal: [number, number], contour: [number, number][], holes: [number, number][][], s: StyleSpec, uOff = 0): void {
    const c2 = contour.map(([u, y]) => new THREE.Vector2(u, y));
    const h2 = holes.map((h) => h.map(([u, y]) => new THREE.Vector2(u, y)));
    let tris: number[][];
    try { tris = THREE.ShapeUtils.triangulateShape(c2, h2); } catch { return; }
    if (!tris.length) return;
    const all = [...c2, ...h2.flat()];
    const base = this.vertexCount;
    const nl = Math.hypot(normal[0], normal[1]) || 1;
    const nx = normal[0] / nl, nz = normal[1] / nl;
    for (const p of all) this.vertex(origin[0] + along[0] * p.x, origin[1] + p.y, origin[2] + along[1] * p.x, nx, 0, nz, p.x + uOff, origin[1] + p.y, s);
    for (const t of tris) {
      const a = all[t[0]], b = all[t[1]], c = all[t[2]];
      const e1u = b.x - a.x, e1y = b.y - a.y, e2u = c.x - a.x, e2y = c.y - a.y;
      // world cross product of the two in-plane edges, horizontal components only
      const cx = along[1] * (e1y * e2u - e1u * e2y), cz = along[0] * (e1u * e2y - e1y * e2u);
      if (cx * nx + cz * nz >= 0) this.tri(base + t[0], base + t[1], base + t[2]);
      else this.tri(base + t[0], base + t[2], base + t[1]);
    }
  }

  /**
   * A hexahedron from a bottom quad and a top quad (any orientation: sloping parapets, arch ribs, canopies).
   * Faces are oriented away from the centroid. uv = (distance along the face's first edge, height above the
   * face's lowest corner), so height-keyed styles see the member's local height.
   */
  hexa(b: XYZ[], t: XYZ[], s: StyleSpec, opts: { bottom?: boolean; top?: boolean } = {}): void {
    if (b.length !== 4 || t.length !== 4) return;
    const cx = (b[0][0] + b[1][0] + b[2][0] + b[3][0] + t[0][0] + t[1][0] + t[2][0] + t[3][0]) / 8;
    const cy = (b[0][1] + b[1][1] + b[2][1] + b[3][1] + t[0][1] + t[1][1] + t[2][1] + t[3][1]) / 8;
    const cz = (b[0][2] + b[1][2] + b[2][2] + b[3][2] + t[0][2] + t[1][2] + t[2][2] + t[3][2]) / 8;
    const faces: XYZ[][] = [
      [b[0], b[1], t[1], t[0]], [b[1], b[2], t[2], t[1]], [b[2], b[3], t[3], t[2]], [b[3], b[0], t[0], t[3]],
    ];
    if (opts.top !== false) faces.push([t[0], t[1], t[2], t[3]]);
    if (opts.bottom) faces.push([b[0], b[1], b[2], b[3]]);
    for (const f of faces) {
      const ux = f[1][0] - f[0][0], uy = f[1][1] - f[0][1], uz = f[1][2] - f[0][2];
      const vx = f[3][0] - f[0][0], vy = f[3][1] - f[0][1], vz = f[3][2] - f[0][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-9) continue;
      nx /= nl; ny /= nl; nz /= nl;
      const fx = (f[0][0] + f[2][0]) / 2 - cx, fy = (f[0][1] + f[2][1]) / 2 - cy, fz = (f[0][2] + f[2][2]) / 2 - cz;
      const flip = nx * fx + ny * fy + nz * fz < 0;
      if (flip) { nx = -nx; ny = -ny; nz = -nz; }
      const el = Math.hypot(ux, uy, uz) || 1;
      const y0 = Math.min(f[0][1], f[1][1], f[2][1], f[3][1]);
      const ids = f.map((p) => this.vertex(p[0], p[1], p[2], nx, ny, nz, ((p[0] - f[0][0]) * ux + (p[1] - f[0][1]) * uy + (p[2] - f[0][2]) * uz) / el, p[1] - y0, s));
      if (flip) this.quad(ids[0], ids[3], ids[2], ids[1]);
      else this.quad(ids[0], ids[1], ids[2], ids[3]);
    }
  }

  merge(other: GeoBuilder): void {
    const base = this.vertexCount;
    for (let i = 0; i < other.pos.length; i++) this.pos.push(other.pos[i]);
    for (let i = 0; i < other.nor.length; i++) this.nor.push(other.nor[i]);
    for (let i = 0; i < other.uv.length; i++) this.uv.push(other.uv[i]);
    for (let i = 0; i < other.st.length; i++) this.st.push(other.st[i]);
    for (let i = 0; i < other.p1.length; i++) this.p1.push(other.p1[i]);
    for (let i = 0; i < other.p2.length; i++) this.p2.push(other.p2[i]);
    for (let i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + base);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.st, 1));
    g.setAttribute('aParam', new THREE.Float32BufferAttribute(this.p1, 4));
    g.setAttribute('aParam2', new THREE.Float32BufferAttribute(this.p2, 4));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export const ROOF: StyleSpec = { style: 11, p: [0.25, 0.25, 0.26, 0], p2: [0, 0, 0, 0] };

export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function centroid(ring: Ring): Pt {
  let x = 0, z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

export function circle(cx: number, cz: number, r: number, seg: number, yaw = 0): Ring {
  const ring: Ring = [];
  for (let i = 0; i < seg; i++) {
    const a = yaw + (i / seg) * Math.PI * 2;
    ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return ring;
}

/** rounded rectangle ring (u/v half sizes, corner radius) in a Frame */
export function roundedRect(f: Frame, u0: number, u1: number, v0: number, v1: number, r: number, segPerCorner = 4): Ring {
  const ring: Ring = [];
  const corners: [number, number, number][] = [
    [u1 - r, v1 - r, 0],
    [u0 + r, v1 - r, Math.PI / 2],
    [u0 + r, v0 + r, Math.PI],
    [u1 - r, v0 + r, (3 * Math.PI) / 2],
  ];
  for (const [cu, cv, a0] of corners) {
    for (let i = 0; i <= segPerCorner; i++) {
      const a = a0 + (i / segPerCorner) * (Math.PI / 2);
      ring.push(f.toWorld(cu + Math.cos(a) * r, cv + Math.sin(a) * r));
    }
  }
  return ring;
}

/**
 * A local 2D frame on the ground: origin + two unit axes (u, v). Manhattan-grid frames use
 * u = along the avenues (toward uptown) and v = along the streets (toward the east river side).
 */
export class Frame {
  constructor(public ox: number, public oz: number, public ux: number, public uz: number, public vx: number, public vz: number) {}

  /** frame from a compass bearing of the u axis (degrees, 0 = north, clockwise). v = u rotated 90° clockwise (to the right) */
  static fromBearing(ox: number, oz: number, bearingDeg: number): Frame {
    const b = (bearingDeg * Math.PI) / 180;
    // world: x east, z south. north = (0, -1). bearing b -> (sin b, -cos b)
    const ux = Math.sin(b), uz = -Math.cos(b);
    // right of u (clockwise when seen from above with y up): rotate (ux, uz) by +90° clockwise in compass terms
    const vx = Math.sin(b + Math.PI / 2), vz = -Math.cos(b + Math.PI / 2);
    return new Frame(ox, oz, ux, uz, vx, vz);
  }

  toWorld(u: number, v: number): Pt {
    return [this.ox + this.ux * u + this.vx * v, this.oz + this.uz * u + this.vz * v];
  }
  toLocal(x: number, z: number): [number, number] {
    const dx = x - this.ox, dz = z - this.oz;
    return [dx * this.ux + dz * this.uz, dx * this.vx + dz * this.vz];
  }
  /** rectangle ring (u0..u1, v0..v1), counter-clockwise seen from above */
  rect(u0: number, u1: number, v0: number, v1: number): Ring {
    const r: Ring = [this.toWorld(u0, v0), this.toWorld(u1, v0), this.toWorld(u1, v1), this.toWorld(u0, v1)];
    return signedArea(r) > 0 ? r.reverse() : r;
  }
  /** yaw (radians about +y) of the u axis for THREE rotations: yaw 0 = -z (north) */
  get yaw(): number {
    return Math.atan2(-this.ux, -this.uz);
  }
  /** angle of the u axis in the x/z plane (for GeoBuilder.box): atan2(uz, ux) */
  get angle(): number {
    return Math.atan2(this.uz, this.ux);
  }
  /** angle of the v axis */
  get angleV(): number {
    return Math.atan2(this.vz, this.vx);
  }
  /** local bounds of a ring */
  bounds(ring: Ring): { u0: number; u1: number; v0: number; v1: number } {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of ring) {
      const [u, v] = this.toLocal(x, z);
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    return { u0, u1, v0, v1 };
  }
}

/** Manhattan street grid: avenues run at bearing 29° (uptown = NNE) */
export const GRID_BEARING = 29.0;

/** a plus/cross shaped ring from two overlapping rectangles in a frame (u-range x v-range each), CCW */
export function crossRing(f: Frame, a: [number, number, number, number], b: [number, number, number, number]): Ring {
  // a = wide in u, b = wide in v  (a.u0 <= b.u0, a.v0 >= b.v0)
  const [au0, au1, av0, av1] = a;
  const [bu0, bu1, bv0, bv1] = b;
  const pts: [number, number][] = [
    [au0, av0], [bu0, av0], [bu0, bv0], [bu1, bv0], [bu1, av0], [au1, av0],
    [au1, av1], [bu1, av1], [bu1, bv1], [bu0, bv1], [bu0, av1], [au0, av1],
  ];
  const ring: Ring = pts.map(([u, v]) => f.toWorld(u, v));
  return signedArea(ring) > 0 ? ring.reverse() : ring;
}

/** a rectangle with notched corners (notch nu along u, nv along v), CCW */
export function notchedRect(f: Frame, u0: number, u1: number, v0: number, v1: number, nu: number, nv: number): Ring {
  const pts: [number, number][] = [
    [u0 + nu, v0], [u1 - nu, v0], [u1 - nu, v0 + nv], [u1, v0 + nv], [u1, v1 - nv], [u1 - nu, v1 - nv],
    [u1 - nu, v1], [u0 + nu, v1], [u0 + nu, v1 - nv], [u0, v1 - nv], [u0, v0 + nv], [u0 + nu, v0 + nv],
  ];
  const ring: Ring = pts.map(([u, v]) => f.toWorld(u, v));
  return signedArea(ring) > 0 ? ring.reverse() : ring;
}

/** offset a ring outward by d meters (simple vertex-normal offset; fine for convex-ish building rings) */
export function offsetRing(ring: Ring, d: number): Ring {
  const n = ring.length;
  const cw = signedArea(ring) > 0;
  const out: Ring = [];
  for (let i = 0; i < n; i++) {
    const p = ring[(i - 1 + n) % n], c = ring[i], q = ring[(i + 1) % n];
    let e1x = c[0] - p[0], e1z = c[1] - p[1];
    let e2x = q[0] - c[0], e2z = q[1] - c[1];
    const l1 = Math.hypot(e1x, e1z) || 1, l2 = Math.hypot(e2x, e2z) || 1;
    e1x /= l1; e1z /= l1; e2x /= l2; e2z /= l2;
    // outward normals of the two edges
    let n1x = e1z, n1z = -e1x, n2x = e2z, n2z = -e2x;
    if (!cw) { n1x = -n1x; n1z = -n1z; n2x = -n2x; n2z = -n2z; }
    let bx = n1x + n2x, bz = n1z + n2z;
    const bl = Math.hypot(bx, bz);
    if (bl < 1e-6) { bx = n1x; bz = n1z; } else { bx /= bl; bz /= bl; }
    const cosHalf = Math.max(0.35, bx * n1x + bz * n1z);
    out.push([c[0] + (bx * d) / cosHalf, c[1] + (bz * d) / cosHalf]);
  }
  return out;
}

/** points on a catenary-ish parabola between two 3D points with a sag (positive = hangs down) */
export function parabola(a: THREE.Vector3, b: THREE.Vector3, sag: number, n: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= 4 * sag * t * (1 - t);
    pts.push(p);
  }
  return pts;
}

/** line segments builder (cables, stays, railings, lattice) */
export class LineBuilder {
  pos: number[] = [];
  seg(a: THREE.Vector3, b: THREE.Vector3): void {
    this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  polyline(pts: THREE.Vector3[]): void {
    for (let i = 0; i + 1 < pts.length; i++) this.seg(pts[i], pts[i + 1]);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.computeBoundingSphere();
    return g;
  }
  get count(): number {
    return this.pos.length / 6;
  }
}

/** dispose a subtree's geometries (materials are shared and disposed by the module) */
export function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}

// ---------------------------------------------------------------------------------------------------------
// Faceted / sloped massing (skyline towers whose tops are not horizontal)
// ---------------------------------------------------------------------------------------------------------

export type XYZ = [number, number, number];

/** counter-clockwise (seen from above) copy of a ring: the winding Frame.rect produces */
export function ccwRing(ring: Ring): Ring {
  return signedArea(ring) > 0 ? ring.slice().reverse() : ring;
}

/** ring points lifted to 3D at a height (constant, or per vertex) */
export function lift(ring: Ring, y: number | ((x: number, z: number, i: number) => number)): XYZ[] {
  return ring.map(([x, z], i) => [x, typeof y === 'number' ? y : y(x, z, i), z]);
}

/**
 * Side faces between two rings of equal length whose vertices may sit at different heights (a 45° roof, a
 * crystalline crown, a wedge). Every side becomes two triangles with their own outward normal, so twisted quads
 * read as facets; zero-area triangles (the low edge of a wedge) are skipped. `cap` fans the upper ring as a roof.
 */
export function facetLoft(g: GeoBuilder, r0: XYZ[], r1: XYZ[], s: StyleSpec, cap: StyleSpec | null = null): void {
  const n = r0.length;
  if (n !== r1.length || n < 3) return;
  let cx = 0, cz = 0;
  for (const p of r0) { cx += p[0]; cz += p[2]; }
  cx /= n;
  cz /= n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    facetTri(g, r0[i], r0[j], r1[j], s, cx, cz);
    facetTri(g, r0[i], r1[j], r1[i], s, cx, cz);
  }
  if (cap) polyFan(g, r1, cap);
}

function facetTri(g: GeoBuilder, a: XYZ, b: XYZ, c: XYZ, s: StyleSpec, cx: number, cz: number): void {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-6) return;
  nx /= nl; ny /= nl; nz /= nl;
  // outward: away from the ring's axis; a horizontal facet faces up
  const mx = (a[0] + b[0] + c[0]) / 3 - cx, mz = (a[2] + b[2] + c[2]) / 3 - cz;
  const out = nx * mx + nz * mz;
  let flip = false;
  if (out < -1e-6 || (Math.abs(out) <= 1e-6 && ny < 0)) { nx = -nx; ny = -ny; nz = -nz; flip = true; }
  const hx = -nz, hz = nx;
  const ids = [a, b, c].map((q) => g.vertex(q[0], q[1], q[2], nx, ny, nz, q[0] * hx + q[2] * hz, q[1], s));
  if (flip) g.tri(ids[0], ids[2], ids[1]);
  else g.tri(ids[0], ids[1], ids[2]);
}

/** a roof-like convex polygon (normal up), fan-triangulated; the corners need not be exactly coplanar */
export function polyFan(g: GeoBuilder, pts: XYZ[], s: StyleSpec): void {
  const n = pts.length;
  if (n < 3) return;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const ids = pts.map((p) => g.vertex(p[0], p[1], p[2], nx, ny, nz, p[0], p[2], s));
  const a = pts[0], b = pts[1], c = pts[2];
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const same = cr[0] * nx + cr[1] * ny + cr[2] * nz >= 0;
  for (let k = 1; k + 1 < n; k++) {
    if (same) g.tri(ids[0], ids[k], ids[k + 1]);
    else g.tri(ids[0], ids[k + 1], ids[k]);
  }
}
