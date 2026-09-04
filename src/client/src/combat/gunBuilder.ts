/**
 * Tiny CSG-less part builder for the procedural guns/props: rounded boxes, cylinders, tori, extruded side
 * profiles and curved stacks (magazines), each tagged with an albedo + (metalness, roughness, kind) that ends up
 * in vertex attributes so a whole object is ONE merged geometry drawn with the shared weapon material.
 *
 * Space: meters, -Z = muzzle/forward, +Y up, +X right (shooter's right). Origin = where the firing hand holds.
 * UVs are metric planar projections (picked per vertex from the dominant normal axis) so detail maps tile at a
 * physical size regardless of the primitive.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MatKind } from './materials';

export interface PartMat {
  color: number | string;
  metal: number;
  rough: number;
  kind: number;
}

export interface PartXf {
  pos?: [number, number, number];
  /** Euler XYZ, radians */
  rot?: [number, number, number];
}

/** ready-made material presets (sRGB hex) */
export const M = {
  polymer: { color: 0x26282c, metal: 0.0, rough: 0.68, kind: MatKind.polymer } as PartMat,
  polymerDark: { color: 0x1b1c1f, metal: 0.0, rough: 0.74, kind: MatKind.polymer } as PartMat,
  rubber: { color: 0x0e0e0f, metal: 0.0, rough: 0.92, kind: MatKind.polymer } as PartMat,
  slide: { color: 0x1e2024, metal: 0.92, rough: 0.4, kind: MatKind.steel } as PartMat,
  steel: { color: 0x33363b, metal: 0.95, rough: 0.38, kind: MatKind.steel } as PartMat,
  steelDark: { color: 0x17181b, metal: 0.9, rough: 0.55, kind: MatKind.steel } as PartMat,
  steelBright: { color: 0x6a6d72, metal: 1.0, rough: 0.28, kind: MatKind.steel } as PartMat,
  parkerized: { color: 0x2b2e33, metal: 0.85, rough: 0.6, kind: MatKind.steel } as PartMat,
  anodized: { color: 0x1f2226, metal: 0.85, rough: 0.5, kind: MatKind.anodized } as PartMat,
  anodizedGrey: { color: 0x3a3d42, metal: 0.8, rough: 0.48, kind: MatKind.anodized } as PartMat,
  magSteel: { color: 0x2a2d32, metal: 0.9, rough: 0.42, kind: MatKind.steel } as PartMat,
  wood: { color: 0xffffff, metal: 0.0, rough: 0.42, kind: MatKind.wood } as PartMat,
  brass: { color: 0xc09a45, metal: 1.0, rough: 0.3, kind: MatKind.brass } as PartMat,
  black: { color: 0x050506, metal: 0.0, rough: 1.0, kind: MatKind.polymer } as PartMat,
  lens: { color: 0x0a1626, metal: 0.0, rough: 0.05, kind: MatKind.anodized } as PartMat,
  whitePlastic: { color: 0xe6e6e2, metal: 0.0, rough: 0.5, kind: MatKind.polymer } as PartMat,
  redPlastic: { color: 0xc4162c, metal: 0.0, rough: 0.5, kind: MatKind.polymer } as PartMat,
  nylon: { color: 0x2b2a27, metal: 0.0, rough: 0.95, kind: MatKind.polymer } as PartMat,
  nylonCoyote: { color: 0x6d5a3c, metal: 0.0, rough: 0.95, kind: MatKind.polymer } as PartMat,
};

const _color = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class GunBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private uvJitter = 0;
  tris = 0;
  /** named points (muzzle, eject, ...) in builder space */
  points = new Map<string, THREE.Vector3>();

  add(geo: THREE.BufferGeometry, mat: PartMat, xf: PartXf = {}): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    // strip attributes we do not merge on (extrude geometries carry none extra; be safe)
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    const rot = xf.rot ?? [0, 0, 0];
    const pos = xf.pos ?? [0, 0, 0];
    _e.set(rot[0], rot[1], rot[2], 'XYZ');
    _q.setFromEuler(_e);
    _m4.compose(_v.set(pos[0], pos[1], pos[2]), _q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(_m4);
    const n = g.attributes.position.count;
    const p = g.attributes.position as THREE.BufferAttribute;
    const nr = g.attributes.normal as THREE.BufferAttribute;
    const uv = new Float32Array(n * 2);
    const col = new Float32Array(n * 3);
    const am = new Float32Array(n * 3);
    _color.set(mat.color);
    const jx = this.uvJitter * 0.137, jy = this.uvJitter * 0.291;
    this.uvJitter++;
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const ax = Math.abs(nr.getX(i)), ay = Math.abs(nr.getY(i)), az = Math.abs(nr.getZ(i));
      let u: number, v: number;
      if (ax >= ay && ax >= az) (u = z), (v = y);
      else if (ay >= az) (u = x), (v = z);
      else (u = x), (v = y);
      uv[i * 2] = u + jx;
      uv[i * 2 + 1] = v + jy;
      col[i * 3] = _color.r;
      col[i * 3 + 1] = _color.g;
      col[i * 3 + 2] = _color.b;
      am[i * 3] = mat.metal;
      am[i * 3 + 1] = mat.rough;
      am[i * 3 + 2] = mat.kind;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aMat', new THREE.BufferAttribute(am, 3));
    this.parts.push(g);
    this.tris += n / 3;
    return this;
  }

  /** rounded box; radius 0 -> plain box. seg = corner segments (1 cheap, 2 smooth). */
  box(w: number, h: number, d: number, mat: PartMat, xf: PartXf = {}, radius = 0, seg = 1): this {
    const r = Math.min(radius, w / 2, h / 2, d / 2);
    const g = r > 0 ? new RoundedBoxGeometry(w, h, d, seg, r) : new THREE.BoxGeometry(w, h, d);
    return this.add(g, mat, xf);
  }

  /** cylinder along an axis ('y' default) */
  cyl(rTop: number, rBot: number, len: number, mat: PartMat, xf: PartXf = {}, axis: 'x' | 'y' | 'z' = 'z', radial = 14, open = false): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, radial, 1, open);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    else if (axis === 'x') g.rotateZ(-Math.PI / 2);
    return this.add(g, mat, xf);
  }

  /** flat disc facing +axis */
  disc(r: number, mat: PartMat, xf: PartXf = {}, axis: 'x' | 'y' | 'z' = 'z', radial = 14): this {
    const g = new THREE.CircleGeometry(r, radial);
    if (axis === 'y') g.rotateX(-Math.PI / 2);
    else if (axis === 'x') g.rotateY(Math.PI / 2);
    return this.add(g, mat, xf);
  }

  torus(r: number, tube: number, mat: PartMat, xf: PartXf = {}, radial = 6, tubular = 16): this {
    return this.add(new THREE.TorusGeometry(r, tube, radial, tubular), mat, xf);
  }

  sphere(r: number, mat: PartMat, xf: PartXf = {}, seg = 8): this {
    return this.add(new THREE.SphereGeometry(r, seg, seg), mat, xf);
  }

  /**
   * Side profile (points in the Y/Z plane as [z, y]) extruded across X by `width`, centered.
   * Bevel gives rounded edges (0 for none).
   */
  profile(pts: [number, number][], width: number, mat: PartMat, bevel = 0, xf: PartXf = {}): this {
    const shape = new THREE.Shape();
    // Shape lives in XY; we map (z, y) -> (shapeX = z, shapeY = y) then extrude along +Z, then rotate so the
    // extrusion runs along X: rotateY(-90deg) maps shape X -> -Z... simpler: build, then swap axes via matrix.
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();
    const depth = Math.max(0.0005, width - 2 * bevel);
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1, curveSegments: 6 });
    // extrusion is along +Z from 0..depth (plus bevels); center it and rotate: shape X (our z) -> world Z, extrude Z -> world X
    g.translate(0, 0, -depth / 2);
    g.rotateY(-Math.PI / 2); // (x, y, z) -> (-z, y, x): shape X -> world +Z (as authored), extrusion -> world X
    g.computeVertexNormals();
    return this.add(g, mat, xf);
  }

  /**
   * Curved stack of boxes (magazines): starts at `start` pointing down (-Y), each segment rotates `stepRad` about X
   * so the bottom curves forward (-Z). w = width (x), d = depth (z), segLen = length per segment.
   */
  curvedStack(start: [number, number, number], segments: number, segLen: number, stepRad: number, w: number, d: number, mat: PartMat, radius = 0.002): this {
    let x = start[0], y = start[1], z = start[2];
    for (let k = 0; k < segments; k++) {
      const a = stepRad * (k + 0.5);
      const dirY = -Math.cos(a), dirZ = -Math.sin(a);
      const cx = x, cy = y + (dirY * segLen) / 2, cz = z + (dirZ * segLen) / 2;
      this.box(w, segLen * 1.02, d, mat, { pos: [cx, cy, cz], rot: [-a, 0, 0] }, radius, 1);
      x = cx;
      y = cy + (dirY * segLen) / 2;
      z = cz + (dirZ * segLen) / 2;
    }
    this.points.set('stackEnd', new THREE.Vector3(x, y, z));
    return this;
  }

  point(name: string, x: number, y: number, z: number): this {
    this.points.set(name, new THREE.Vector3(x, y, z));
    return this;
  }

  /** merge everything; `shift` moves the whole object (and the named points) so the hand point is the origin */
  build(shift: [number, number, number] = [0, 0, 0]): { geometry: THREE.BufferGeometry; points: Map<string, THREE.Vector3>; tris: number } {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('gun builder: nothing to merge');
    for (const p of this.parts) p.dispose();
    this.parts = [];
    merged.translate(shift[0], shift[1], shift[2]);
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    for (const p of this.points.values()) p.add(_v.set(shift[0], shift[1], shift[2]));
    return { geometry: merged, points: this.points, tris: this.tris };
  }
}

export const deg = (d: number) => (d * Math.PI) / 180;
