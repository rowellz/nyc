/**
 * MeshBuilder: assembles a prop out of primitive parts into ONE merged BufferGeometry with the
 * per-vertex attributes the props material understands:
 *   color  (vec3)  base albedo
 *   aMat   (vec4)  roughness, metalness, uvMode (0 = as-is, 1 = instance atlas rect), texture mask
 *   aEmit  (vec2)  emissive channel, strength   (see material.ts for the channel table)
 * Parts get metric "box projected" UVs by default (grime tiles in world meters); parts that map
 * to a texture (signs, screens) keep their own UVs (keepUv).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const EMIT = {
  none: 0,
  /** lamp head: color = mix(warm, white, aData.x) * strength * uLamp */
  lamp: 1,
  /** night glow using the vertex color as emissive color (* uLamp) */
  nightGlow: 2,
  /** traffic signal lenses: lit when aData.y == lens index */
  lensRed: 3,
  lensYellow: 4,
  lensGreen: 5,
  /** constant glow (screens, day and night) using the vertex color */
  alwaysGlow: 6,
  /** pedestrian signal face: aData.z selects the frame (uv shifted in the shader) */
  pedFace: 7,
  /** backlit sign face: the sampled map glows (* uLamp) - lightboxes, subway signs, shelter ads */
  mapGlowNight: 8,
  /** screen: the sampled map glows day and night (LinkNYC, kiosks, menus) */
  mapGlow: 9,
} as const;

export interface PartStyle {
  color: number | THREE.Color | [number, number, number];
  rough?: number;
  metal?: number;
  emit?: number;
  emitStrength?: number;
  /** meters per texture tile for the projected uv (default 1) */
  uvScale?: number;
  /** keep the primitive's own uv (signs, screens) */
  keepUv?: boolean;
  /** uvMode 1 = the instance's atlas rect is applied to this part's uv */
  atlas?: boolean;
  /** Sample the map on this part when the material uses selectiveMap (e.g. basket mesh, not its bag). */
  textured?: boolean;
  /** vertex-color gradient: darker at the bottom (grime): [yFrom, yTo, factor] */
  grimeBand?: [number, number, number];
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpNM = new THREE.Matrix3();
const tmpC = new THREE.Color();

export interface Xform {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

export function xformMatrix(t: Xform | undefined, out = new THREE.Matrix4()): THREE.Matrix4 {
  if (!t) return out.identity();
  tmpE.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, 'XYZ');
  tmpQ.setFromEuler(tmpE);
  tmpV.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  return out.compose(new THREE.Vector3(t.x ?? 0, t.y ?? 0, t.z ?? 0), tmpQ, tmpV);
}

export class MeshBuilder {
  private parts: THREE.BufferGeometry[] = [];
  triangles = 0;

  /** add a primitive; the geometry is consumed (transformed in place) */
  add(geom: THREE.BufferGeometry, style: PartStyle, t?: Xform | THREE.Matrix4): this {
    if (!geom.index) geom = mergeVertices(geom);
    // strip attributes we do not merge on
    for (const k of Object.keys(geom.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geom.deleteAttribute(k);
    if (!geom.attributes.normal) geom.computeVertexNormals();
    if (!geom.attributes.uv) geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((geom.attributes.position.count) * 2), 2));
    const m = t instanceof THREE.Matrix4 ? t : xformMatrix(t, tmpM);
    geom.applyMatrix4(m);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const nor = geom.attributes.normal as THREE.BufferAttribute;
    const uv = geom.attributes.uv as THREE.BufferAttribute;
    const n = pos.count;
    const color = new Float32Array(n * 3);
    const mat = new Float32Array(n * 4);
    const emit = new Float32Array(n * 2);
    const c = style.color instanceof THREE.Color ? style.color : Array.isArray(style.color) ? tmpC.setRGB(style.color[0], style.color[1], style.color[2]) : tmpC.setHex(style.color);
    const rough = style.rough ?? 0.6;
    const metal = style.metal ?? 0;
    const uvMode = style.atlas ? 1 : 0;
    const ch = style.emit ?? 0;
    const es = style.emitStrength ?? 1;
    const uvs = 1 / (style.uvScale ?? 1);
    const band = style.grimeBand;
    for (let i = 0; i < n; i++) {
      let r = c.r, g = c.g, b = c.b;
      if (band) {
        const y = pos.getY(i);
        const f = THREE.MathUtils.clamp((y - band[0]) / (band[1] - band[0]), 0, 1);
        const k = 1 - band[2] * (1 - f);
        r *= k; g *= k; b *= k;
      }
      color[i * 3] = r; color[i * 3 + 1] = g; color[i * 3 + 2] = b;
      mat[i * 4] = rough; mat[i * 4 + 1] = metal; mat[i * 4 + 2] = uvMode; mat[i * 4 + 3] = style.textured ? 1 : 0;
      emit[i * 2] = ch; emit[i * 2 + 1] = es;
      if (!style.keepUv) {
        // box projection along the dominant normal axis, in meters
        const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        if (nx >= ny && nx >= nz) uv.setXY(i, pz * uvs, py * uvs);
        else if (ny >= nz) uv.setXY(i, px * uvs, pz * uvs);
        else uv.setXY(i, px * uvs, py * uvs);
      }
    }
    geom.setAttribute('color', new THREE.BufferAttribute(color, 3));
    geom.setAttribute('aMat', new THREE.BufferAttribute(mat, 4));
    geom.setAttribute('aEmit', new THREE.BufferAttribute(emit, 2));
    this.parts.push(geom);
    this.triangles += geom.index!.count / 3;
    return this;
  }

  box(w: number, h: number, d: number, style: PartStyle, t?: Xform): this {
    return this.add(new THREE.BoxGeometry(w, h, d), style, t);
  }

  /** vertical cylinder, base at y=0 of the local transform (height along +y) */
  cyl(rTop: number, rBot: number, h: number, seg: number, style: PartStyle, t?: Xform, openEnded = false): this {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, openEnded);
    g.translate(0, h / 2, 0);
    return this.add(g, style, t);
  }

  /** cylinder centered on its transform (for rotated tubes) */
  cylC(rTop: number, rBot: number, h: number, seg: number, style: PartStyle, t?: Xform, openEnded = false): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, openEnded), style, t);
  }

  sphere(r: number, seg: number, style: PartStyle, t?: Xform): this {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.6))), style, t);
  }

  /** straight tube from a to b (world/local coords), radius r */
  tube(a: [number, number, number], b: [number, number, number], r: number, seg: number, style: PartStyle): this {
    const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return this;
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    const dir = tmpV.set(dx, dy, dz).normalize();
    tmpQ.setFromUnitVectors(tmpN.set(0, 1, 0), dir);
    tmpM.compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), tmpQ, new THREE.Vector3(1, 1, 1));
    return this.add(g, style, tmpM.clone());
  }

  /** a single quad (w x h) in the XY plane facing +z, centered, with uv 0..1 (keepUv) */
  quad(w: number, h: number, style: PartStyle, t?: Xform, uvRect?: [number, number, number, number]): this {
    const g = new THREE.PlaneGeometry(w, h);
    if (uvRect) {
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uvRect[0] + uv.getX(i) * uvRect[2], uvRect[1] + uv.getY(i) * uvRect[3]);
    }
    return this.add(g, { keepUv: true, ...style }, t);
  }

  /** lathe (profile in x=radius, y=height) */
  lathe(profile: [number, number][], seg: number, style: PartStyle, t?: Xform): this {
    const pts = profile.map(([x, y]) => new THREE.Vector2(x, y));
    return this.add(new THREE.LatheGeometry(pts, seg), style, t);
  }

  /** octagonal tapered pole: NYC aluminum light poles */
  octPole(rBot: number, rTop: number, h: number, style: PartStyle, t?: Xform): this {
    return this.cyl(rTop, rBot, h, 8, style, t);
  }

  /** extruded polygon (x,z ring) with height h, base at y=0 */
  prism(ring: [number, number][], h: number, style: PartStyle, t?: Xform): this {
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1 });
    // extrude goes along +z; rotate so it goes along +y with the ring in xz
    g.rotateX(-Math.PI / 2);
    return this.add(g, style, t);
  }

  merge(other: MeshBuilder, t?: Xform | THREE.Matrix4): this {
    const m = t instanceof THREE.Matrix4 ? t : xformMatrix(t, tmpM);
    for (const p of other.parts) {
      const g = p.clone();
      g.applyMatrix4(m);
      this.parts.push(g);
      this.triangles += g.index!.count / 3;
    }
    return this;
  }

  isEmpty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      return g;
    }
    const merged = this.parts.length === 1 ? this.parts[0] : mergeGeometries(this.parts, false);
    if (!merged) throw new Error('[props] mergeGeometries failed');
    for (const p of this.parts) if (p !== merged) p.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

/** minimal indexer for non-indexed geometry (welds exact duplicates) */
function mergeVertices(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  geom.setIndex(new THREE.BufferAttribute(idx, 1));
  return geom;
}

/** normal matrix helper for callers transforming normals themselves */
export function normalMatrixOf(m: THREE.Matrix4): THREE.Matrix3 {
  return tmpNM.getNormalMatrix(m);
}

/** deterministic hash -> 0..1 */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul((a * 73856093) ^ (b * 19349663) ^ (c * 83492791), 2654435761) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** seeded PRNG */
export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s >>> 0) / 4294967296;
  };
}
