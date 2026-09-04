/**
 * Procedural vehicle bodies from smooth cross-section lofts.
 *
 * Model space: forward = -z, right = +x, up = +y, origin at ground level under the wheelbase center.
 * Every vertex carries: position, normal, uv (atlas), aMat (clearcoat, roughness, metalness, paintMask),
 * aLight (light channel id), aWheel (hub pivot xyz + wheel index+1, 0 = body). Wheel vertices are rotated in
 * the vertex shader (spin / steer / suspension), so a whole vehicle is ONE opaque draw + ONE glass draw.
 */
import * as THREE from 'three';
import { R, type Rect } from './atlas';
import type { BodyStyle, VehicleSpec } from './kinds';

/** sedan-proportioned bodies (the taxi is a Camry: same family, its own parameters) */
const carLike = (s: BodyStyle): boolean => s === 'sedan' || s === 'taxi';

export interface MatSpec { cc: number; rough: number; metal: number; paint: number }
const m = (cc: number, rough: number, metal: number, paint: number): MatSpec => ({ cc, rough, metal, paint });
export const MAT = {
  PAINT: m(1, 0.35, 0.3, 1),
  DECAL: m(1, 0.35, 0.2, 0),
  PLASTIC: m(0, 0.62, 0, 0),
  RUBBER: m(0, 0.9, 0, 0),
  CHROME: m(0, 0.14, 1, 0),
  ALLOY: m(0, 0.42, 0.65, 0),
  DARKMETAL: m(0, 0.5, 0.75, 0),
  INTERIOR: m(0, 0.92, 0, 0),
  GLASSFAR: m(1, 0.05, 0.2, 0),
  LENS: m(1, 0.1, 0, 0),
  PLATE: m(0.3, 0.45, 0.15, 0),
  SIGN: m(0.3, 0.4, 0, 0),
};

export const LIGHT = { NONE: 0, HEAD: 1, TAIL: 2, SIG_L: 3, SIG_R: 4, REVERSE: 5, ROOF: 6, SIREN_R: 7, SIREN_B: 8, SIREN_W: 9, DASH: 10, BUSSIGN: 11, LIGHTBAR: 12, DRL: 13 } as const;

export type Detail = 'near' | 'far';

// ---------------------------------------------------------------------------------------------------------
// builder
// ---------------------------------------------------------------------------------------------------------
export class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  mat: number[] = [];
  light: number[] = [];
  wheel: number[] = [];
  idx: number[] = [];
  wheelTag: [number, number, number, number] = [0, 0, 0, 0];
  flip = false;

  get count(): number {
    return this.pos.length / 3;
  }

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, vv: number, mt: MatSpec, light = 0): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.uv.push(u, vv);
    this.mat.push(mt.cc, mt.rough, mt.metal, mt.paint);
    this.light.push(light);
    this.wheel.push(this.wheelTag[0], this.wheelTag[1], this.wheelTag[2], this.wheelTag[3]);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    if (this.flip) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** append another builder's content transformed by a matrix (normals by the normal matrix) */
  append(o: GeoBuilder, mtx?: THREE.Matrix4): void {
    const base = this.count;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const nm = mtx ? new THREE.Matrix3().getNormalMatrix(mtx) : null;
    const det = mtx ? mtx.determinant() : 1;
    for (let i = 0; i < o.count; i++) {
      p.set(o.pos[i * 3], o.pos[i * 3 + 1], o.pos[i * 3 + 2]);
      n.set(o.nrm[i * 3], o.nrm[i * 3 + 1], o.nrm[i * 3 + 2]);
      if (mtx) {
        p.applyMatrix4(mtx);
        n.applyMatrix3(nm!).normalize();
      }
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(o.uv[i * 2], o.uv[i * 2 + 1]);
      this.mat.push(o.mat[i * 4], o.mat[i * 4 + 1], o.mat[i * 4 + 2], o.mat[i * 4 + 3]);
      this.light.push(o.light[i]);
      // wheel pivot moves with the transform
      const wi = o.wheel[i * 4 + 3];
      if (wi > 0 && mtx) {
        p.set(o.wheel[i * 4], o.wheel[i * 4 + 1], o.wheel[i * 4 + 2]).applyMatrix4(mtx);
        this.wheel.push(p.x, p.y, p.z, wi);
      } else this.wheel.push(o.wheel[i * 4], o.wheel[i * 4 + 1], o.wheel[i * 4 + 2], wi);
    }
    const flip = det < 0;
    for (let i = 0; i < o.idx.length; i += 3) {
      if (flip) this.idx.push(base + o.idx[i], base + o.idx[i + 2], base + o.idx[i + 1]);
      else this.idx.push(base + o.idx[i], base + o.idx[i + 1], base + o.idx[i + 2]);
    }
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 4));
    g.setAttribute('aLight', new THREE.Float32BufferAttribute(this.light, 1));
    g.setAttribute('aWheel', new THREE.Float32BufferAttribute(this.wheel, 4));
    g.setIndex(this.count > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------------------------------------------------
// loft
// ---------------------------------------------------------------------------------------------------------
export interface ProfilePt { x: number; y: number; sharp?: boolean; split?: boolean }
export interface Station { z: number; pts: ProfilePt[]; sharp?: boolean; split?: boolean }
export interface LoftOpts {
  /** mirror the half profile (x >= 0, first & last point at x = 0) into a closed ring */
  mirror: boolean;
  closed?: boolean; // for non-mirrored: connect last to first
  rect: Rect;
  /** material for the face between stations fi,fi+1 and ring points fk,fk+1 */
  matFn: (fi: number, fk: number) => MatSpec | null; // null = skip face
  lightFn?: (fi: number, fk: number) => number;
  /** uv in 0..1 within rect for vertex (i,k) as seen by face (fi,fk); default: k along u, i along v */
  uvFn?: (fi: number, fk: number, i: number, k: number, x: number, y: number, z: number) => [number, number];
  capStart?: MatSpec | null;
  capEnd?: MatSpec | null;
  capRect?: Rect;
  capLight?: number;
  /** send faces whose mat is GLASS to this builder instead */
  glassTo?: GeoBuilder;
  glassMat?: MatSpec;
}

export const GLASS: MatSpec = m(1, 0.02, 0, 0); // sentinel: routed to the glass builder
// Negative paint masks select taxi-only responses in the shared near-glass batch.
const TAXI_LAMP_GLASS = m(0, 0.03, 0, -1);
const TAXI_CABIN_GLASS = m(1, 0.05, 0.2, -2);

interface Ring { x: number[]; y: number[]; z: number; sharp: boolean; split: boolean; psharp: boolean[]; psplit: boolean[]; n: number }

function buildRing(st: Station, mirror: boolean): Ring {
  const pts = st.pts;
  const x: number[] = [], y: number[] = [], ps: boolean[] = [], pl: boolean[] = [];
  for (const p of pts) {
    x.push(p.x);
    y.push(p.y);
    ps.push(!!p.sharp);
    pl.push(!!p.split);
  }
  if (mirror) {
    for (let k = pts.length - 2; k >= 1; k--) {
      x.push(-pts[k].x);
      y.push(pts[k].y);
      ps.push(!!pts[k].sharp);
      pl.push(!!pts[k].split);
    }
  }
  return { x, y, z: st.z, sharp: !!st.sharp, split: !!st.split, psharp: ps, psplit: pl, n: x.length };
}

export function loft(b: GeoBuilder, stations: Station[], o: LoftOpts): void {
  const rings = stations.map((s) => buildRing(s, o.mirror));
  const nS = rings.length;
  const n = rings[0].n;
  const closed = o.mirror || !!o.closed;
  const nk = closed ? n : n - 1; // number of ring faces
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpN = new THREE.Vector3();

  const P = (i: number, k: number, out: THREE.Vector3) => {
    const r = rings[i];
    const kk = ((k % n) + n) % n;
    return out.set(r.x[kk], r.y[kk], r.z);
  };

  // normal at (i,k) for side selection (sideZ: 0 = face before station i, 1 = after; sideK likewise)
  const normal = (i: number, k: number, sideZ: number, sideK: number, out: THREE.Vector3) => {
    const r = rings[i];
    const kk = ((k % n) + n) % n;
    // ring tangent
    const ksharp = r.psharp[kk];
    let kPrev = kk - 1, kNext = kk + 1;
    if (!closed) {
      if (kPrev < 0) kPrev = kk;
      if (kNext >= n) kNext = kk;
    }
    if (ksharp) {
      if (sideK === 0) kNext = kk;
      else kPrev = kk;
    }
    P(i, kNext, tmpA).sub(P(i, kPrev, tmpB));
    const tk = tmpA.clone();
    if (tk.lengthSq() < 1e-12) {
      // degenerate (collapsed ring): use neighbors
      P(i, kk + 1, tmpA).sub(P(i, kk - 1, tmpB));
      tk.copy(tmpA);
    }
    // station tangent
    let iPrev = i - 1, iNext = i + 1;
    if (iPrev < 0) iPrev = i;
    if (iNext >= nS) iNext = i;
    if (r.sharp) {
      if (sideZ === 0) iNext = i;
      else iPrev = i;
    }
    P(iNext, kk, tmpA).sub(P(iPrev, kk, tmpB));
    const tz = tmpA.clone();
    if (tz.lengthSq() < 1e-12) tz.set(0, 0, 1);
    out.crossVectors(tk, tz);
    if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
    return out.normalize();
  };

  // vertex slots (i,k,sideZ,sideK) -> index, created lazily per material/uv variant
  const slots = new Map<string, number>();
  const getVertex = (i: number, k: number, sideZ: number, sideK: number, fi: number, fk: number): number => {
    const r = rings[i];
    const kk = ((k % n) + n) % n;
    const splitK = r.psharp[kk] || r.psplit[kk];
    const splitZ = r.sharp || r.split;
    const sz = splitZ ? sideZ : 0;
    const sk = splitK ? sideK : 0;
    const mt = o.matFn(splitZ ? fi : Math.min(fi, nS - 2), splitK ? fk : fk);
    const key = `${i}_${kk}_${sz}_${sk}_${splitZ || splitK ? `${fi}_${fk}` : ''}`;
    const have = slots.get(key);
    if (have !== undefined) return have;
    normal(i, kk, sz, sk, tmpN);
    let u: number, vv: number;
    if (o.uvFn) [u, vv] = o.uvFn(fi, fk, i, kk, r.x[kk], r.y[kk], r.z);
    else {
      u = kk / n;
      vv = i / Math.max(1, nS - 1);
    }
    const rect = o.rect === R.solid.white && mt === MAT.PLASTIC ? R.solid.black
      : o.rect === R.solid.white && mt === MAT.INTERIOR ? R.solid.interior : o.rect;
    const idx = b.v(r.x[kk], r.y[kk], r.z, tmpN.x, tmpN.y, tmpN.z, rect.u0 + (rect.u1 - rect.u0) * u, rect.v0 + (rect.v1 - rect.v0) * vv, mt ?? MAT.PAINT, o.lightFn ? o.lightFn(fi, fk) : 0);
    slots.set(key, idx);
    return idx;
  };

  // faces
  for (let i = 0; i + 1 < nS; i++) {
    for (let k = 0; k < nk; k++) {
      const mt = o.matFn(i, k);
      if (!mt) continue;
      const k1 = (k + 1) % n;
      if (mt === GLASS) {
        if (!o.glassTo) continue;
        // glass: separate builder, simple per-face vertices, same normals
        const gb = o.glassTo;
        const gm = o.glassMat ?? MAT.GLASSFAR;
        // Far glass is merged into the opaque pool, so it needs the tinted texel
        // rather than the white paint patch used by the near glass material.
        const rect = gb === b ? R.solid.glass : o.rect;
        const emit = (ii: number, kk: number, sz: number, sk: number) => {
          normal(ii, kk, sz, sk, tmpN);
          const r = rings[ii];
          const kq = ((kk % n) + n) % n;
          let u = kq / n, vv = ii / Math.max(1, nS - 1);
          if (o.uvFn) [u, vv] = o.uvFn(i, k, ii, kq, r.x[kq], r.y[kq], r.z);
          return gb.v(r.x[kq], r.y[kq], r.z, tmpN.x, tmpN.y, tmpN.z, rect.u0 + (rect.u1 - rect.u0) * u, rect.v0 + (rect.v1 - rect.v0) * vv, gm, 0);
        };
        const a = emit(i, k, 1, 1), bb = emit(i, k1, 1, 0), c = emit(i + 1, k1, 0, 0), d = emit(i + 1, k, 0, 1);
        gb.quad(a, bb, c, d);
        continue;
      }
      const a = getVertex(i, k, 1, 1, i, k);
      const bb = getVertex(i, k1, 1, 0, i, k);
      const c = getVertex(i + 1, k1, 0, 0, i, k);
      const d = getVertex(i + 1, k, 0, 1, i, k);
      // skip fully degenerate quads
      b.quad(a, bb, c, d);
    }
  }

  // caps (fan from centroid; ring is CCW seen from +z)
  const cap = (i: number, mt: MatSpec, facing: number) => {
    const r = rings[i];
    let cx = 0, cy = 0;
    for (let k = 0; k < n; k++) {
      cx += r.x[k];
      cy += r.y[k];
    }
    cx /= n;
    cy /= n;
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    for (let k = 0; k < n; k++) {
      minY = Math.min(minY, r.y[k]);
      maxY = Math.max(maxY, r.y[k]);
      minX = Math.min(minX, r.x[k]);
      maxX = Math.max(maxX, r.x[k]);
    }
    const rect = o.capRect ?? o.rect;
    const uvOf = (x: number, y: number): [number, number] => [rect.u0 + (rect.u1 - rect.u0) * ((x - minX) / Math.max(1e-3, maxX - minX)), rect.v0 + (rect.v1 - rect.v0) * ((y - minY) / Math.max(1e-3, maxY - minY))];
    const [cu, cv] = uvOf(cx, cy);
    const c = b.v(cx, cy, r.z, 0, 0, facing, cu, cv, mt, o.capLight ?? 0);
    const ring: number[] = [];
    for (let k = 0; k < n; k++) {
      const [u, vv] = uvOf(r.x[k], r.y[k]);
      ring.push(b.v(r.x[k], r.y[k], r.z, 0, 0, facing, u, vv, mt, o.capLight ?? 0));
    }
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      if (facing > 0) b.tri(c, ring[k], ring[k1]);
      else b.tri(c, ring[k1], ring[k]);
    }
  };
  if (o.capStart) cap(0, o.capStart, -1);
  if (o.capEnd) cap(nS - 1, o.capEnd, 1);
}

// ---------------------------------------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------------------------------------
/** axis-aligned box centered at c with size s; per-face uv into rect; optional transform */
export function box(b: GeoBuilder, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mt: MatSpec, rect: Rect, opts: { light?: number; mtx?: THREE.Matrix4; faces?: Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', { mt?: MatSpec; rect?: Rect; light?: number } | false>>; bevel?: number } = {}): void {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces: { n: [number, number, number]; pts: [number, number, number][]; key: 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz' }[] = [
    { key: 'px', n: [1, 0, 0], pts: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]] },
    { key: 'nx', n: [-1, 0, 0], pts: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]] },
    { key: 'py', n: [0, 1, 0], pts: [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]] },
    { key: 'ny', n: [0, -1, 0], pts: [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]] },
    { key: 'pz', n: [0, 0, 1], pts: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { key: 'nz', n: [0, 0, -1], pts: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
  ];
  const p = new THREE.Vector3(), nn = new THREE.Vector3();
  const nm = opts.mtx ? new THREE.Matrix3().getNormalMatrix(opts.mtx) : null;
  const uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    const fo = opts.faces?.[f.key];
    if (fo === false) continue;
    const fm = fo?.mt ?? mt;
    const fr = fo?.rect ?? rect;
    const fl = fo?.light ?? opts.light ?? 0;
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      p.set(f.pts[i][0] + cx, f.pts[i][1] + cy, f.pts[i][2] + cz);
      nn.set(f.n[0], f.n[1], f.n[2]);
      if (opts.mtx) {
        p.applyMatrix4(opts.mtx);
        nn.applyMatrix3(nm!).normalize();
      }
      ids.push(b.v(p.x, p.y, p.z, nn.x, nn.y, nn.z, fr.u0 + (fr.u1 - fr.u0) * uvs[i][0], fr.v0 + (fr.v1 - fr.v0) * uvs[i][1], fm, fl));
    }
    b.quad(ids[0], ids[1], ids[2], ids[3]);
  }
}

/** flat quad from 4 corner points (CCW seen from the normal side) */
export function quadPts(b: GeoBuilder, pts: [number, number, number][], mt: MatSpec, rect: Rect, light = 0, uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]): void {
  const a = new THREE.Vector3(...pts[0]), bb = new THREE.Vector3(...pts[1]), c = new THREE.Vector3(...pts[2]), d = new THREE.Vector3(...pts[3]);
  const n = new THREE.Vector3().subVectors(bb, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
  const ids = [a, bb, c, d].map((p, i) => b.v(p.x, p.y, p.z, n.x, n.y, n.z, rect.u0 + (rect.u1 - rect.u0) * uvs[i][0], rect.v0 + (rect.v1 - rect.v0) * uvs[i][1], mt, light));
  b.quad(ids[0], ids[1], ids[2], ids[3]);
}

/** Exterior panels must face away from the chassis, including mirrored lamp lenses. */
function exteriorQuad(b: GeoBuilder, pts: [number, number, number][], mt: MatSpec, rect: Rect, light = 0, uvs: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]): void {
  const a = new THREE.Vector3(...pts[0]);
  const normal = new THREE.Vector3(...pts[1]).sub(a).cross(new THREE.Vector3(...pts[3]).sub(a));
  const cx = pts.reduce((sum, p) => sum + p[0], 0), cz = pts.reduce((sum, p) => sum + p[2], 0);
  if (normal.x * cx + normal.z * cz < 0) {
    quadPts(b, [pts[0], pts[3], pts[2], pts[1]], mt, rect, light, [uvs[0], uvs[3], uvs[2], uvs[1]]);
  } else quadPts(b, pts, mt, rect, light, uvs);
}

/** polygon fan (convex), CCW seen from the normal side */
export function polygon(b: GeoBuilder, pts: THREE.Vector3[], normal: THREE.Vector3, mt: MatSpec, rect: Rect, light = 0): void {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  // planar uv: project onto the two largest axes of the normal complement
  const ax = Math.abs(normal.x) > 0.7 ? 'z' : 'x';
  const ay = Math.abs(normal.y) > 0.7 ? 'z' : 'y';
  for (const p of pts) {
    minX = Math.min(minX, p[ax]);
    maxX = Math.max(maxX, p[ax]);
    minY = Math.min(minY, p[ay]);
    maxY = Math.max(maxY, p[ay]);
  }
  const ids = pts.map((p) => b.v(p.x, p.y, p.z, normal.x, normal.y, normal.z, rect.u0 + (rect.u1 - rect.u0) * ((p[ax] - minX) / Math.max(1e-4, maxX - minX)), rect.v0 + (rect.v1 - rect.v0) * ((p[ay] - minY) / Math.max(1e-4, maxY - minY)), mt, light));
  for (let i = 1; i + 1 < ids.length; i++) b.tri(ids[0], ids[i], ids[i + 1]);
}

/** revolve a (r, x) profile around the x axis; segments around; open profile */
export function lathe(b: GeoBuilder, profile: { r: number; x: number; sharp?: boolean }[], segments: number, mt: MatSpec | ((j: number) => MatSpec), rect: Rect, opts: { uv?: 'polar' | 'strip'; rMax?: number; light?: number; flipNormals?: boolean } = {}): void {
  const np = profile.length;
  const rMax = opts.rMax ?? Math.max(...profile.map((p) => p.r));
  const slotIdx: number[][] = []; // [j][seg*2 + side]
  const tangents: [number, number][] = [];
  for (let j = 0; j < np; j++) {
    const a = profile[Math.max(0, j - 1)], c = profile[Math.min(np - 1, j + 1)];
    tangents.push([c.r - a.r, c.x - a.x]);
  }
  const getIdx = (j: number, seg: number, side: number): number => {
    const key = j * (segments + 1) * 2 + seg * 2 + (profile[j].sharp ? side : 0);
    slotIdx[j] = slotIdx[j] ?? [];
    const have = slotIdx[j][seg * 2 + (profile[j].sharp ? side : 0)];
    if (have !== undefined) return have;
    const p = profile[j];
    let tr: number, tx: number;
    if (p.sharp) {
      const o = side === 0 ? profile[Math.max(0, j - 1)] : profile[Math.min(np - 1, j + 1)];
      tr = side === 0 ? p.r - o.r : o.r - p.r;
      tx = side === 0 ? p.x - o.x : o.x - p.x;
    } else [tr, tx] = tangents[j];
    // profile tangent (tr, tx) in (r, x); outward normal in (r,x) plane = (tx, -tr) normalized
    const len = Math.hypot(tr, tx) || 1;
    let nr = tx / len, nx = -tr / len;
    if (opts.flipNormals) {
      nr = -nr;
      nx = -nx;
    }
    const th = (seg / segments) * Math.PI * 2;
    const ct = Math.cos(th), stt = Math.sin(th);
    const y = p.r * ct, z = p.r * stt;
    let u: number, vv: number;
    if (opts.uv === 'polar') {
      u = 0.5 + 0.5 * (p.r / rMax) * ct;
      vv = 0.5 + 0.5 * (p.r / rMax) * stt;
    } else {
      u = seg / segments;
      vv = j / Math.max(1, np - 1);
    }
    const mm = typeof mt === 'function' ? mt(j) : mt;
    const id = b.v(p.x, y, z, nx, nr * ct, nr * stt, rect.u0 + (rect.u1 - rect.u0) * u, rect.v0 + (rect.v1 - rect.v0) * vv, mm, opts.light ?? 0);
    slotIdx[j][seg * 2 + (profile[j].sharp ? side : 0)] = id;
    void key;
    return id;
  };
  for (let j = 0; j + 1 < np; j++) {
    for (let s = 0; s < segments; s++) {
      const s1 = s + 1;
      const a = getIdx(j, s, 1), bb = getIdx(j + 1, s, 0), c = getIdx(j + 1, s1, 0), d = getIdx(j, s1, 1);
      // winding must agree with the (tx, -tr) profile normal: with theta running y -> z, (a, d, c, bb) is the
      // front face on the normal's side. (The other order left every lathe inside-out: tires showed their far
      // inner wall through a culled outer sidewall.)
      if (opts.flipNormals) b.quad(a, bb, c, d);
      else b.quad(a, d, c, bb);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// shape helpers
// ---------------------------------------------------------------------------------------------------------
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (t: number) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** quarter-ellipse corner factor: 1 far from the end, dropping to `min` at the end over `len` */
function cornerTaper(d: number, len: number, min: number): number {
  if (d >= len) return 1;
  const t = clamp01(d / len);
  return min + (1 - min) * Math.sqrt(1 - (1 - t) * (1 - t));
}

function mergeZ(lists: number[][], zMin: number, zMax: number): number[] {
  const set = new Set<number>();
  for (const l of lists) for (const z of l) if (z >= zMin - 1e-6 && z <= zMax + 1e-6) set.add(+z.toFixed(4));
  return Array.from(set).sort((a, b) => a - b);
}
function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  const n = Math.max(1, Math.round((b - a) / step));
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// body parameters per style
// ---------------------------------------------------------------------------------------------------------
export interface BodyParams {
  floorY: number;
  sillY: number;
  beltF: number; // beltline height at the cowl
  beltR: number; // beltline height at the C pillar
  hoodCowl: number; // hood height at the cowl
  noseTop: number; // hood height at the nose
  noseBottom: number; // where the tub's underside meets the bumper at the nose
  tailTop: number; // deck height at the tail
  tailBottom: number;
  roofY: number; // roof height
  zCowl: number;
  zRoofF: number; // windshield top
  zRoofR: number; // rear glass top
  zGlassEnd: number; // rear glass bottom / deck start (sedan) or tailgate (suv)
  zB: number; // B pillar
  zDoorF: number; // front door front seam
  zDoorR: number; // rear door rear seam
  noseWidth: number; // fraction of width at the nose face
  tailWidth: number;
  noseCorner: number; // corner rounding length
  tailCorner: number;
  crown: number;
  tumble: number;
  bumperTop: number;
  blackSill: boolean;
  blackArch: boolean;
  rearVertical: boolean; // suv/van: greenhouse ends at the tail
  doorGlassOnlyFront?: boolean; // van
  hoodStyle: 'sedan' | 'camry' | 'flat' | 'stub';
  /** Camry taxi body: hood power dome height, a sharp character crease under the door handles, a quarter window
   *  behind the rear door, black trim instead of chrome */
  hoodDome?: number;
  crease?: boolean;
  quarterGlass?: boolean;
  blackTrim?: boolean;
  /** Explorer PIU: gloss-black D pillar (floating roof) and black mirror caps */
  blackPillars?: boolean;
  blackMirrors?: boolean;
  /** Camry-family fascia (taxi, sedan, crossover): bowed nose, moulded bumper cover around the lower intake,
   *  swept lamps under clear covers, hood shut line, shell mirrors */
  sculpted?: boolean;
  /** tail lamps lofted into the body: the shoulder band wraps the rear corner as a lens joined to the tail-face unit */
  wrapTail?: boolean;
  /** sedan: the deck lid kicks up into a lip at the tail */
  spoilerLip?: boolean;
  /** crossover: tall black grille between the lamp tips and the bumper intake */
  bigGrille?: boolean;
  /** crossover hatch: raked glass over a near-vertical painted tailgate (exponent of the glass rake curve) */
  hatchRake?: number;
}

/** z range of the side livery band: the doors, or fender-to-tail on the police car (stripe, motto, unit number) */
export function decalZone(spec: VehicleSpec, p: BodyParams): { z0: number; z1: number } {
  if (spec.style === 'police') return { z0: -spec.wheelbase / 2 + archRadius(spec) + 0.08, z1: spec.rear - 0.05 };
  return { z0: p.zDoorF, z1: p.zDoorR };
}

export function bodyParams(spec: VehicleSpec): BodyParams {
  const front = -spec.front, rear = spec.rear;
  const zf = -spec.wheelbase / 2, zr = spec.wheelbase / 2;
  switch (spec.style) {
    case 'sedan':
      // Accord/Camry-class: the Camry lower body (low bowed nose, crease over the sills, 14 cm ride height) under a
      // fastback roof with a painted C pillar and quarter glass, a short deck with a lip, lamps wrapping the corners
      return {
        floorY: 0.14, sillY: 0.29, beltF: 0.92, beltR: 0.99, hoodCowl: 0.9, noseTop: 0.76, noseBottom: 0.55, tailTop: 1.01, tailBottom: 0.5, roofY: spec.height - 0.005,
        zCowl: zf + 0.62, zRoofF: zf + 1.72, zRoofR: zr - 0.2, zGlassEnd: zr + 0.5, zB: 0.25, zDoorF: zf + 0.78, zDoorR: zr - 0.4,
        noseWidth: 0.84, tailWidth: 0.85, noseCorner: 0.5, tailCorner: 0.42, crown: 0.028, tumble: 0.17, bumperTop: 0.5, blackSill: false, blackArch: false, rearVertical: false, hoodStyle: 'camry',
        hoodDome: 0.022, crease: true, quarterGlass: true, sculpted: true, wrapTail: true, spoilerLip: true,
      };
    case 'taxi':
      // Toyota Camry XV70: low nose, long fast windshield (1.1 m), short high deck, crease above the sills
      return {
        floorY: 0.16, sillY: 0.31, beltF: 0.92, beltR: 0.99, hoodCowl: 0.9, noseTop: 0.76, noseBottom: 0.55, tailTop: 1.01, tailBottom: 0.5, roofY: spec.height - 0.005,
        zCowl: zf + 0.62, zRoofF: zf + 1.72, zRoofR: zr - 0.28, zGlassEnd: zr + 0.42, zB: 0.22, zDoorF: zf + 0.8, zDoorR: zr - 0.42,
        noseWidth: 0.84, tailWidth: 0.85, noseCorner: 0.5, tailCorner: 0.4, crown: 0.028, tumble: 0.17, bumperTop: 0.5, blackSill: false, blackArch: false, rearVertical: false, hoodStyle: 'camry',
        hoodDome: 0.022, crease: true, quarterGlass: true, blackTrim: true, sculpted: true,
      };
    case 'suv':
      // RAV4/CR-V-class crossover: bowed nose with a tall grille over the intake, flat hood, upright glass on a high
      // belt, black D pillar, cladding over the sills and arches, raked hatch glass over a painted tailgate, wrap lamps
      return {
        floorY: 0.22, sillY: 0.4, beltF: 1.06, beltR: 1.12, hoodCowl: 1.05, noseTop: 0.93, noseBottom: 0.58, tailTop: 1.15, tailBottom: 0.6, roofY: spec.height - 0.01,
        zCowl: zf + 0.68, zRoofF: zf + 1.55, zRoofR: rear - 0.42, zGlassEnd: rear - 0.04, zB: 0.32, zDoorF: zf + 0.85, zDoorR: zr - 0.28,
        noseWidth: 0.84, tailWidth: 0.88, noseCorner: 0.45, tailCorner: 0.3, crown: 0.025, tumble: 0.13, bumperTop: 0.62, blackSill: true, blackArch: true, rearVertical: true, hoodStyle: 'flat',
        hoodDome: 0.015, crease: true, blackTrim: true, blackPillars: true, sculpted: true, wrapTail: true, bigGrille: true, hatchRake: 1.2,
      };
    case 'police':
      // Ford Explorer PIU: long flat hood, fast windshield, rising beltline, vertical tailgate, black lower cladding
      return {
        floorY: 0.28, sillY: 0.42, beltF: 1.02, beltR: 1.09, hoodCowl: 1.07, noseTop: 0.9, noseBottom: 0.5, tailTop: 1.14, tailBottom: 0.55, roofY: spec.height - 0.01,
        zCowl: zf + 0.82, zRoofF: zf + 1.72, zRoofR: rear - 0.42, zGlassEnd: rear - 0.1, zB: 0.5, zDoorF: zf + 0.95, zDoorR: zr - 0.42,
        noseWidth: 0.86, tailWidth: 0.9, noseCorner: 0.36, tailCorner: 0.25, crown: 0.025, tumble: 0.14, bumperTop: 0.6, blackSill: true, blackArch: true, rearVertical: true, hoodStyle: 'flat',
        blackTrim: true, blackPillars: true, blackMirrors: true,
      };
    case 'van':
      return {
        floorY: 0.35, sillY: 0.5, beltF: 1.2, beltR: 1.2, hoodCowl: 1.19, noseTop: 1.0, noseBottom: 0.55, tailTop: 1.2, tailBottom: 0.6, roofY: spec.height - 0.02,
        zCowl: front + 1.0, zRoofF: front + 1.55, zRoofR: rear - 0.15, zGlassEnd: rear - 0.02, zB: front + 2.2, zDoorF: front + 1.2, zDoorR: rear - 0.1,
        noseWidth: 0.9, tailWidth: 0.96, noseCorner: 0.28, tailCorner: 0.15, crown: 0.04, tumble: 0.06, bumperTop: 0.62, blackSill: true, blackArch: true, rearVertical: true, doorGlassOnlyFront: true, hoodStyle: 'stub',
      };
    case 'cabover':
      // read by the interior builder only (cab and box are lofted separately): NPR cab floor / belt / roof
      return {
        floorY: 0.45, sillY: 0.6, beltF: 1.3, beltR: 1.3, hoodCowl: 1.3, noseTop: 1.2, noseBottom: 0.5, tailTop: 1.3, tailBottom: 0.6, roofY: 2.35,
        zCowl: front + 0.28, zRoofF: front + 0.7, zRoofR: front + 1.9, zGlassEnd: front + 1.95, zB: front + 1.6, zDoorF: front + 0.45, zDoorR: front + 1.6,
        noseWidth: 0.9, tailWidth: 0.96, noseCorner: 0.2, tailCorner: 0.1, crown: 0.0, tumble: 0.0, bumperTop: 0.62, blackSill: true, blackArch: true, rearVertical: true, doorGlassOnlyFront: true, hoodStyle: 'stub',
      };
    case 'garbage':
      return {
        floorY: 0.5, sillY: 0.7, beltF: 1.45, beltR: 1.45, hoodCowl: 1.44, noseTop: 1.25, noseBottom: 0.7, tailTop: 1.45, tailBottom: 0.7, roofY: 2.75,
        zCowl: front + 0.95, zRoofF: front + 1.5, zRoofR: front + 2.5, zGlassEnd: front + 2.6, zB: front + 2.3, zDoorF: front + 1.15, zDoorR: front + 2.5,
        noseWidth: 0.92, tailWidth: 0.96, noseCorner: 0.25, tailCorner: 0.1, crown: 0.03, tumble: 0.05, bumperTop: 0.8, blackSill: true, blackArch: true, rearVertical: true, doorGlassOnlyFront: true, hoodStyle: 'stub',
      };
    case 'bus':
      return {
        floorY: 0.35, sillY: 0.5, beltF: 1.2, beltR: 1.2, hoodCowl: 1.2, noseTop: 1.2, noseBottom: 0.5, tailTop: 1.2, tailBottom: 0.5, roofY: spec.height,
        zCowl: front + 0.1, zRoofF: front + 0.5, zRoofR: rear - 0.3, zGlassEnd: rear, zB: 0, zDoorF: front + 0.6, zDoorR: rear - 0.5,
        noseWidth: 0.97, tailWidth: 0.97, noseCorner: 0.2, tailCorner: 0.2, crown: 0.05, tumble: 0.02, bumperTop: 0.6, blackSill: true, blackArch: false, rearVertical: true, hoodStyle: 'stub',
      };
  }
}

// ---------------------------------------------------------------------------------------------------------
// the tub (lower body)
// ---------------------------------------------------------------------------------------------------------
interface TubShape {
  bottomY(z: number): number;
  sillX(z: number): number;
  shoulderX(z: number): number;
  shoulderY(z: number): number;
  topY(z: number): number;
  topX(z: number): number;
  arch(z: number): number | null; // arch edge height at z, or null
  wellX: number;
  isFrontArch(z: number): boolean;
}

/** wheel arch radius: the opening hugs the tire (a few cm of clearance), tighter on cars than on trucks */
function archRadius(spec: VehicleSpec): number {
  return spec.wheelRadius + (spec.style === 'taxi' ? 0.055 : spec.style === 'sedan' ? 0.05 : spec.style === 'suv' ? 0.06 : 0.1);
}

function tubShape(spec: VehicleSpec, p: BodyParams): TubShape {
  const zNose = -spec.front, zTail = spec.rear;
  const zf = -spec.wheelbase / 2, zr = spec.wheelbase / 2;
  const hw = spec.width / 2;
  const archR = archRadius(spec);
  const hubY = spec.wheelRadius;
  const wellX = spec.track / 2 - spec.tireWidth / 2 - 0.06;
  const bumperZone = spec.style === 'bus' ? 0.25 : 0.5;
  const topY = (z: number): number => {
    if (z < p.zCowl) {
      // hood: from the cowl height down to the nose top with a soft power dome
      const t = clamp01((p.zCowl - z) / (p.zCowl - zNose));
      if (p.hoodStyle === 'stub') return lerp(p.hoodCowl, p.noseTop, smooth(t * 1.2));
      if (p.hoodStyle === 'flat') return lerp(p.hoodCowl, p.noseTop, t * t);
      if (p.hoodStyle === 'camry') return lerp(p.hoodCowl, p.noseTop, 0.45 * t + 0.55 * t * t);
      return lerp(p.hoodCowl, p.noseTop, 0.15 * t + 0.85 * t * t * t);
    }
    if (z > p.zGlassEnd) {
      const t = clamp01((z - p.zGlassEnd) / Math.max(0.05, zTail - p.zGlassEnd));
      // deck lid lip: the last 15 cm of the deck kick up 3 cm (Accord/Camry ducktail)
      return lerp(p.beltR + 0.02, p.tailTop, t) + (p.spoilerLip ? 0.03 * smooth((z - (zTail - 0.16)) / 0.14) : 0);
    }
    return lerp(p.beltF, p.beltR, clamp01((z - p.zCowl) / Math.max(0.1, p.zGlassEnd - p.zCowl))) + 0.02;
  };
  return {
    wellX,
    bottomY: (z) => {
      const dN = z - zNose, dT = zTail - z;
      let y = p.floorY;
      if (dN < bumperZone) y = lerp(p.noseBottom, p.floorY, smooth(dN / bumperZone));
      if (dT < bumperZone) y = Math.max(y, lerp(p.tailBottom, p.floorY, smooth(dT / bumperZone)));
      return y;
    },
    sillX: (z) => p.sculpted && z < zNose + p.noseCorner
      // The rocker must taper WITH the front shoulder, not flare below it.
      ? lerp(hw * p.noseWidth * 0.965 - 0.045, hw - 0.07, cornerTaper(z - zNose, p.noseCorner, 0))
      : hw - 0.07 * (spec.style === 'bus' ? 0.4 : 1) * Math.min(1, cornerTaper(z - zNose, p.noseCorner, p.noseWidth) * cornerTaper(zTail - z, p.tailCorner, p.tailWidth)) - 0.0,
    shoulderX: (z) => hw * cornerTaper(z - zNose, p.noseCorner, p.noseWidth) * cornerTaper(zTail - z, p.tailCorner, p.tailWidth) * (carLike(spec.style) ? lerp(0.965, 1, smooth((z - zNose) / 1.6)) : 1),
    // the fender top follows the hood down to the nose (a continuous shoulder line from the headlight to the
    // A pillar), instead of staying at belt height and leaving a raised rim around the hood
    shoulderY: (z) => (z < p.zCowl ? Math.min(p.beltF, topY(z) - 0.005) : lerp(p.beltF, p.beltR, clamp01((z - p.zCowl) / Math.max(0.1, p.zGlassEnd - p.zCowl)))),
    topY,
    topX: (z) => {
      const sx = hw * cornerTaper(z - zNose, p.noseCorner, p.noseWidth) * cornerTaper(zTail - z, p.tailCorner, p.tailWidth);
      return sx - (z < p.zCowl ? 0.16 : 0.12);
    },
    arch: (z) => {
      for (const zc of [zf, zr]) {
        const dz = z - zc;
        if (Math.abs(dz) < archR) return hubY + Math.sqrt(archR * archR - dz * dz);
      }
      return null;
    },
    isFrontArch: (z) => Math.abs(z - zf) < archR,
  };
}

/** stations for the tub, dense where curvature is high */
function tubStations(spec: VehicleSpec, p: BodyParams, detail: Detail): number[] {
  const zNose = -spec.front, zTail = spec.rear;
  const zf = -spec.wheelbase / 2, zr = spec.wheelbase / 2;
  const archR = archRadius(spec);
  if (detail === 'far') {
    return mergeZ([range(zNose, zTail, 0.45), [zNose + 0.08, zNose + 0.2, zTail - 0.08, zTail - 0.2, p.zCowl, p.zGlassEnd]], zNose, zTail);
  }
  const lists: number[][] = [
    range(zNose, zNose + p.noseCorner + 0.1, 0.05),
    range(zTail - p.tailCorner - 0.1, zTail, 0.05),
    range(zf - archR - 0.04, zf + archR + 0.04, 0.06),
    range(zr - archR - 0.04, zr + archR + 0.04, 0.06),
    range(zNose, zTail, 0.22),
    [p.zCowl, p.zGlassEnd, p.zCowl - 0.1],
  ];
  return mergeZ(lists, zNose, zTail);
}

function buildTub(b: GeoBuilder, spec: VehicleSpec, p: BodyParams, detail: Detail, decal: boolean): void {
  const firstVertex = b.count;
  const sh = tubShape(spec, p);
  const zs = tubStations(spec, p, detail);
  const near = detail === 'near';
  const seams = near && spec.style !== 'bus' ? [p.zDoorF, p.zB, p.zDoorR] : [];
  // hood rear edge and (sedan) trunk lid front edge: dark lines across the top surfaces only
  const topSeams = near && (carLike(spec.style) || spec.style === 'suv' || spec.style === 'police') ? [p.zCowl - 0.03, ...(p.sculpted ? [-spec.front + 0.05] : []), ...(carLike(spec.style) ? [p.zGlassEnd + 0.04] : [])] : [];
  const gapZ = [...seams, ...topSeams];
  // wrap tail lamps: the shoulder band behind lampZ is a lens at both LODs (the tail-face unit joins it at the corner)
  const lampZ = p.wrapTail ? spec.rear - wrapLampLength(spec) : null;
  // arch cladding (crossover): matte black on the fender lip band around each opening (4.5 cm over the wheel,
  // widening down to the rocker at the ends), 1 cm past the arch
  const archR = archRadius(spec), zfA = -spec.wheelbase / 2, zrA = spec.wheelbase / 2, cladR = archR + 0.012;
  const claddingZ = p.blackArch && near && p.sculpted ? [zfA - cladR, zfA + cladR, zrA - cladR, zrA + cladR] : [];
  const inCladding = (z: number) => claddingZ.length > 0 && (Math.abs(z - zfA) < cladR || Math.abs(z - zrA) < cladR);
  const stations: Station[] = [];
  const stationZ: number[] = [];
  const pushStation = (z: number, inset = 0, flags: Partial<Station> = {}) => {
    const inLamp = lampZ !== null && z >= lampZ - 1e-6;
    const bottomY = sh.bottomY(z);
    const sillX = sh.sillX(z) - inset;
    const shoulderX = sh.shoulderX(z) - inset;
    const shoulderY = sh.shoulderY(z);
    const topY = sh.topY(z);
    const topX = Math.min(sh.topX(z), shoulderX - 0.05);
    const arch = sh.arch(z); // Wheel openings must not close over the far-LOD rim.
    const sillY = Math.max(p.sillY, bottomY + 0.04);
    const creaseBlend = p.sculpted ? smooth((z + spec.front) / 0.65) : 1;
    const bulgeX = shoulderX + (p.crease ? 0.012 + 0.012 * creaseBlend : 0.012);
    // hood power dome: the centre line lifts a couple of cm mid-hood and settles again before the cowl
    const dome = p.hoodDome && z < p.zCowl ? p.hoodDome * Math.sin(Math.PI * clamp01((z + spec.front - 0.2) / (p.zCowl + spec.front - 0.35))) : 0;
    const crown = p.crown + dome;
    const pts: ProfilePt[] = [];
    pts.push({ x: 0, y: bottomY });
    if (arch !== null) {
      const wellX = Math.min(sh.wellX, sillX - 0.05);
      // well liner wall, dark liner ceiling, then a thin fender lip right at the opening
      pts.push({ x: wellX, y: bottomY, sharp: true });
      pts.push({ x: wellX, y: arch - 0.03, sharp: true });
      pts.push({ x: sillX + 0.012, y: arch + 0.006, sharp: true, split: true });
      // with cladding the band's top follows the opening (down to 15 cm over the sill) instead of the door's 42 % line
      pts.push({ x: bulgeX - 0.01, y: Math.max(arch + 0.045, inCladding(z) ? sillY + 0.15 : sillY + (shoulderY - sillY) * 0.42), split: decal || inCladding(z) });
    } else {
      pts.push({ x: sillX - 0.06, y: bottomY, sharp: true });
      pts.push({ x: sillX, y: sillY, sharp: true });
      pts.push({ x: sillX + 0.015, y: sillY + 0.09, split: true });
      pts.push({ x: bulgeX - 0.01, y: sillY + (shoulderY - sillY) * 0.42, split: decal || inCladding(z) });
    }
    // Keep the door character line, but roll the front fender into the swept lamp instead of a hard bevel.
    pts.push({ x: bulgeX, y: shoulderY - 0.16, sharp: !!p.crease && (!p.sculpted || z >= p.zCowl), split: inLamp });
    pts.push({ x: shoulderX, y: shoulderY - 0.035, split: decal || inLamp });
    // where the shoulder dips toward the nose the side points must still climb, or the profile folds back
    for (let i = 4; i <= 6; i++) pts[i].y = Math.max(pts[i].y, pts[i - 1].y + 0.01);
    pts.push({ x: shoulderX - 0.06, y: shoulderY + 0.015, split: inLamp });
    // Keep the taxi hood climbing gently inboard from the shoulder; a trough here folds the nose cap.
    const hoodShoulder = p.sculpted && z < p.zCowl ? Math.max(topY, shoulderY + 0.02) : topY;
    pts.push({ x: topX, y: hoodShoulder });
    pts.push({ x: topX * 0.5, y: Math.max(topY + crown * 0.8, hoodShoulder + (p.sculpted && z < p.zCowl ? 0.005 : 0)) });
    pts.push({ x: 0, y: topY + crown });
    stations.push({ z, pts, ...flags });
    stationZ.push(z);
  };
  const seamSet = new Set(seams.map((z) => +z.toFixed(4)));
  // Far LOD has no door seams, but still needs exact livery boundary stations.
  // uv split stations at the decal zone boundaries
  const { z0: decalZ0, z1: decalZ1 } = decalZone(spec, p);
  const all = mergeZ([zs, decal ? [decalZ0, decalZ1] : [], gapZ.flatMap((z) => [z - 0.005, z, z + 0.005]), lampZ !== null ? [lampZ] : [], claddingZ], -spec.front, spec.rear);
  for (const z of all) {
    const isSeam = seamSet.has(+z.toFixed(4));
    // stations bounding a panel gap are split so the dark gap band doesn't bleed into the panels
    const nearGap = gapZ.some((g) => Math.abs(z - g) < 0.0051);
    // likewise the livery band, the lens band and the cladding: material changes need their own vertices
    const split = (decal && (Math.abs(z - decalZ0) < 1e-3 || Math.abs(z - decalZ1) < 1e-3)) || (lampZ !== null && Math.abs(z - lampZ) < 1e-3) || claddingZ.some((c) => Math.abs(z - c) < 1e-3);
    pushStation(z, isSeam ? 0.006 : 0, { split: split || nearGap, sharp: isSeam });
  }
  const lensFace = (z: number, hkFace: number): boolean => lampZ !== null && z > lampZ && (hkFace === 5 || hkFace === 6);
  /** face centred in a panel gap band: door seams all the way up the side, top seams only on the hood/deck */
  const inGap = (z: number, hkFace: number): boolean => {
    if (hkFace < 3) return false;
    for (const g of seams) if (Math.abs(z - g) < 0.004) return true;
    if (hkFace >= 8) for (const g of topSeams) if (Math.abs(z - g) < 0.004) return true;
    return false;
  };
  const nS = stations.length;
  const nHalf = stations[0].pts.length; // 11
  const ringN = nHalf * 2 - 2;
  const hw = spec.width / 2;
  const decalRectL = R.decalL, decalRectR = R.decalR;
  // ring index -> half index and side (right = +x for k < nHalf)
  const halfOf = (k: number) => (k < nHalf ? k : ringN - k);
  const isRight = (k: number) => k < nHalf;

  loft(b, stations, {
    mirror: true,
    rect: R.solid.white,
    matFn: (fi, fk) => {
      const z = (stationZ[fi] + stationZ[fi + 1]) / 2;
      const hk = halfOf(fk);
      const inArch = sh.arch(z) !== null;
      // faces between half points hk and hk+1 (for the mirrored side the same by symmetry)
      const hkFace = isRight(fk) ? hk : hk - 1; // the face on the left side between ring k and k+1 maps to half face hk-1
      if (hkFace <= 0) return MAT.PLASTIC; // underbody
      if (inArch) {
        if (hkFace === 1) return MAT.INTERIOR; // well wall
        if (hkFace === 2) return MAT.INTERIOR; // liner ceiling (dark; the fender lip itself is the next face)
      } else {
        if (hkFace === 1) return MAT.PLASTIC; // sill underside
        if (hkFace === 2) return p.blackSill ? MAT.PLASTIC : MAT.PAINT; // rocker
      }
      if (inGap(z, hkFace)) return MAT.PLASTIC; // panel gap: thin dark line
      if (lensFace(z, hkFace)) return MAT.LENS; // wrap tail lamp
      if (hkFace === 3 && inCladding(z)) return MAT.PLASTIC; // arch cladding
      if (decal && hkFace >= 3 && hkFace <= 5 && z > decalZ0 && z < decalZ1) return MAT.DECAL;
      if (spec.style === 'bus' && hkFace >= 3 && hkFace <= 5) return MAT.DECAL;
      return MAT.PAINT;
    },
    lightFn: lampZ === null ? undefined : (fi, fk) => {
      const hk = halfOf(fk);
      return lensFace((stationZ[fi] + stationZ[fi + 1]) / 2, isRight(fk) ? hk : hk - 1) ? LIGHT.TAIL : 0;
    },
    uvFn: (fi, fk, i, k, x, y, z) => {
      const hk = halfOf(fk);
      const hkFace = isRight(fk) ? hk : hk - 1;
      const zz = (stationZ[fi] + stationZ[fi + 1]) / 2;
      if (lensFace(zz, hkFace)) {
        // lens: u runs from the lamp's forward tip (0) to the corner (0.5); the tail-face unit continues to 1
        const sy = sh.shoulderY(z);
        return [0.5 * clamp01((z - lampZ!) / (spec.rear - lampZ!)), clamp01((y - (sy - 0.16)) / 0.175)];
      }
      const useDecal = (decal && hkFace >= 3 && hkFace <= 5 && zz > decalZ0 && zz < decalZ1) || (spec.style === 'bus' && hkFace >= 3 && hkFace <= 5);
      if (useDecal) {
        const rr = isRight(fk) ? decalRectR : decalRectL;
        // u along z (front at left for the left side, mirrored for the right side), v by height within the door band
        const z0 = spec.style === 'bus' ? -spec.front : decalZ0, z1 = spec.style === 'bus' ? spec.rear : decalZ1;
        const t = clamp01((z - z0) / (z1 - z0));
        const u = isRight(fk) ? 1 - t : t;
        const yLo = p.sillY + 0.1, yHi = sh.shoulderY(z) - 0.03;
        const v = clamp01((y - yLo) / (yHi - yLo));
        void rr;
        return [u, v];
      }
      return [0.5, 0.5];
    },
    // per-face rect is chosen inside matFn/uvFn; the loft uses one rect so we remap decal faces via the DECAL flag below
    capStart: MAT.PAINT,
    capEnd: MAT.PAINT,
    capRect: R.solid.white,
  });
  // the loft wrote lens uvs in 0..1 inside the white patch; move them onto the tail lamp texture
  if (lampZ !== null) remapUVs(b, firstVertex, MAT.LENS, R.taillight);
  if (p.sculpted) {
    if (near) {
      // Follow the authored hood/fender junction exactly: a continuous six-millimetre shut line,
      // joining the front and cowl seams without changing the wheelbase or hood length.
      const hood = stations.filter(s => s.z >= -spec.front + 0.045 && s.z <= p.zCowl - 0.025);
      const edge = (s: Station, side: number, outer: boolean): [number, number, number] => {
        const q = s.pts[8], adjacent = s.pts[outer ? 7 : 9];
        const x = q.x + (outer ? 0.003 : -0.003);
        const y = lerp(q.y, adjacent.y, (x - q.x) / (adjacent.x - q.x)) + 0.001;
        return [side * x, y, s.z];
      };
      for (const side of [1, -1]) for (let i = 0; i + 1 < hood.length; i++) {
        const a = hood[i], c = hood[i + 1];
        const pts = [edge(a, side, true), edge(a, side, false), edge(c, side, false), edge(c, side, true)];
        quadPts(b, side > 0 ? pts : pts.reverse(), MAT.PLASTIC, R.solid.black);
      }
    }
    curveTaxiNose(b, firstVertex, spec);
  }
  void hw;
  // the loft above wrote decal uvs in 0..1 within R.solid.white; remap those vertices to the decal rects
  if (decal || spec.style === 'bus') remapDecalUVs(b, spec, p, sh, decalZ0, decalZ1);
}

/** length of the wrap tail lamp along the side (forward tip to the tail face) */
function wrapLampLength(spec: VehicleSpec): number {
  return carLike(spec.style) ? 0.36 : 0.3;
}

/** vertices added since `from` with material `mt` (uv 0..1 inside the white patch) are moved into `rect` */
function remapUVs(b: GeoBuilder, from: number, mt: MatSpec, rect: Rect): void {
  const w = R.solid.white, wu = w.u1 - w.u0, wv = w.v1 - w.v0;
  for (let i = from; i < b.count; i++) {
    if (b.mat[i * 4] !== mt.cc || b.mat[i * 4 + 1] !== mt.rough || b.mat[i * 4 + 2] !== mt.metal || b.mat[i * 4 + 3] !== mt.paint) continue;
    b.uv[i * 2] = rect.u0 + (rect.u1 - rect.u0) * clamp01((b.uv[i * 2] - w.u0) / wu);
    b.uv[i * 2 + 1] = rect.v0 + (rect.v1 - rect.v0) * clamp01((b.uv[i * 2 + 1] - w.v0) / wv);
  }
}

/** vertices with DECAL material get their uv (currently 0..1 inside the white patch) moved into decalL/decalR */
function remapDecalUVs(b: GeoBuilder, spec: VehicleSpec, p: BodyParams, sh: TubShape, z0: number, z1: number): void {
  const w = R.solid.white;
  const wu = w.u1 - w.u0, wv = w.v1 - w.v0;
  for (let i = 0; i < b.count; i++) {
    if (b.mat[i * 4 + 3] !== 0 || b.mat[i * 4] !== MAT.DECAL.cc || b.mat[i * 4 + 1] !== MAT.DECAL.rough || b.mat[i * 4 + 2] !== MAT.DECAL.metal) continue;
    const x = b.pos[i * 3];
    const u01 = (b.uv[i * 2] - w.u0) / wu;
    const v01 = (b.uv[i * 2 + 1] - w.v0) / wv;
    const rr = x >= 0 ? R.decalR : R.decalL;
    b.uv[i * 2] = rr.u0 + (rr.u1 - rr.u0) * clamp01(u01);
    b.uv[i * 2 + 1] = rr.v0 + (rr.v1 - rr.v0) * clamp01(v01);
  }
  void spec;
  void p;
  void sh;
  void z0;
  void z1;
}

// ---------------------------------------------------------------------------------------------------------
// greenhouse (cabin)
// ---------------------------------------------------------------------------------------------------------
/** crossover hatch: fraction of the roof-to-belt run that is raked glass; the rest is the painted tailgate */
const HATCH_GLASS = 0.68;

function buildGreenhouse(b: GeoBuilder, glass: GeoBuilder | null, spec: VehicleSpec, p: BodyParams, detail: Detail): void {
  const sh = tubShape(spec, p);
  const near = detail === 'near';
  const hMax = p.roofY - lerp(p.beltF, p.beltR, 0.4);
  const zTail = spec.rear;
  const z0 = p.zCowl, z1 = p.rearVertical ? p.zGlassEnd : p.zGlassEnd;
  const hEnd = p.rearVertical ? 0.02 : 0.06;
  const hAt = (z: number): number => {
    if (z <= p.zRoofF) {
      const t = clamp01((z - z0) / (p.zRoofF - z0));
      return hMax * (t < 0.85 ? t : 0.85 + (t - 0.85) * 0.85); // straight rake, softened at the header
    }
    if (z >= p.zRoofR) {
      const t = clamp01((z - p.zRoofR) / Math.max(0.05, z1 - p.zRoofR));
      // crossover hatch: raked glass drops 55 % of the height over the first 68 % of the run, then the painted
      // tailgate falls almost vertically to the belt
      if (p.hatchRake) return t < HATCH_GLASS ? hMax * (1 - 0.55 * Math.pow(t / HATCH_GLASS, p.hatchRake)) : lerp(hMax * 0.45, hEnd, (t - HATCH_GLASS) / (1 - HATCH_GLASS));
      // rear glass: convex; vertical hatch for suv/van
      return lerp(hMax, hEnd, p.rearVertical ? t * t * t : Math.sin((t * Math.PI) / 2));
    }
    // roof arc
    const mid = (p.zRoofF + p.zRoofR) / 2, half = (p.zRoofR - p.zRoofF) / 2;
    const u = (z - mid) / Math.max(0.1, half);
    return hMax * (1 - 0.03 * u * u) + 0.03 * hMax;
  };
  const zHatch = p.hatchRake ? p.zRoofR + (z1 - p.zRoofR) * HATCH_GLASS : null;
  const zsList: number[][] = near
    ? [range(z0, p.zRoofF, 0.12), range(p.zRoofF, p.zRoofR, 0.25), range(p.zRoofR, z1, 0.08), [p.zB - 0.06, p.zB + 0.06, z0 + 0.5, z0 + 0.62, p.zRoofR + 0.02, p.zRoofR - 0.02, p.zDoorF, p.zDoorR, p.zRoofF - 0.02, p.zRoofF + 0.02, p.zDoorR - 0.025, p.zDoorR + 0.025, p.zRoofR + 0.08, p.zRoofR + 0.12], zHatch !== null ? [zHatch] : []]
    : [range(z0, p.zRoofF, 0.35), range(p.zRoofF, p.zRoofR, 0.8), range(p.zRoofR, z1, 0.25), zHatch !== null ? [zHatch] : []];
  const zs = mergeZ(zsList, z0, z1);
  const stations: Station[] = [];
  for (const z of zs) {
    const belt = sh.shoulderY(z) + 0.02;
    const h = hAt(z);
    const baseX = sh.shoulderX(z) - (spec.style === 'bus' ? 0.03 : 0.09);
    const tumble = p.tumble * clamp01(h / Math.max(0.2, hMax * 0.6));
    const roofEdgeX = baseX - tumble;
    const crown = p.crown;
    const pts: ProfilePt[] = [
      { x: baseX + 0.02, y: belt - 0.015, sharp: true },
      { x: baseX, y: belt + 0.03, split: true },
      { x: baseX - tumble * 0.5, y: belt + h * 0.55 },
      { x: roofEdgeX, y: belt + h - 0.03, sharp: true },
      { x: roofEdgeX - 0.05, y: belt + h + crown * 0.3 },
      { x: roofEdgeX * 0.5, y: belt + h + crown * 0.8 },
      { x: 0, y: belt + h + crown },
    ];
    const split = Math.abs(z - p.zRoofF) < 0.021 || Math.abs(z - p.zRoofR) < 0.021 || Math.abs(z - (z0 + 0.5)) < 1e-3 || Math.abs(z - (z0 + 0.62)) < 1e-3 || Math.abs(z - (p.zB - 0.06)) < 1e-3 || Math.abs(z - (p.zB + 0.06)) < 1e-3 || Math.abs(z - p.zDoorF) < 1e-3 || Math.abs(z - p.zDoorR) < 1e-3
      || Math.abs(z - (p.zDoorR - 0.025)) < 1e-3 || Math.abs(z - (p.zDoorR + 0.025)) < 1e-3 || Math.abs(z - (p.zRoofR + 0.08)) < 1e-3 || Math.abs(z - (p.zRoofR + 0.12)) < 1e-3
      || (zHatch !== null && Math.abs(z - zHatch) < 1e-3);
    stations.push({ z, pts, split });
  }
  const nHalf = 7, ringN = nHalf * 2 - 2;
  const halfOf = (k: number) => (k < nHalf ? k : ringN - k);
  const isRight = (k: number) => k < nHalf;
  const sideMat = (z: number): MatSpec => {
    // A pillar
    if (z < z0 + 0.5) return MAT.PAINT;
    if (z < z0 + 0.62) return MAT.PLASTIC; // window surround
    if (Math.abs(z - p.zB) < 0.06) return MAT.PLASTIC; // B pillar
    if (p.quarterGlass && Math.abs(z - p.zDoorR) < 0.025) return MAT.PLASTIC; // rear door frame: divider before the quarter window
    if (p.doorGlassOnlyFront && z > p.zDoorR) return MAT.PAINT;
    if (p.doorGlassOnlyFront && z > p.zB) return MAT.PAINT;
    if (spec.style === 'bus') {
      // pillars every 1.5 m
      const k = ((z - z0) / 1.5) % 1;
      return k < 0.06 ? MAT.PLASTIC : GLASS;
    }
    if (!p.rearVertical && z > p.zRoofR + (p.quarterGlass ? 0.09 : 0.02)) return MAT.PAINT; // C pillar (behind the quarter window)
    if (p.rearVertical && z > p.zRoofR + 0.02) return p.blackPillars ? MAT.PLASTIC : MAT.PAINT; // D pillar / hatch frame (gloss black on the Explorer)
    return GLASS;
  };
  loft(b, stations, {
    mirror: true,
    rect: R.solid.white,
    glassTo: glass ?? undefined,
    glassMat: near && spec.style === 'taxi' ? TAXI_CABIN_GLASS : MAT.GLASSFAR,
    matFn: (fi, fk) => {
      const z = (zs[fi] + zs[fi + 1]) / 2;
      const hk = halfOf(fk);
      const hkFace = isRight(fk) ? hk : hk - 1;
      if (hkFace <= 0) return MAT.PLASTIC; // belt trim
      if (hkFace <= 2) return sideMat(z); // side glass / pillars
      if (hkFace === 3) return z < p.zRoofF - 0.02 || z > p.zRoofR + 0.02 ? (z < p.zRoofF ? MAT.PAINT : MAT.PAINT) : MAT.PAINT; // drip rail
      // top: windshield / roof / rear glass
      if (z < p.zRoofF - 0.02) return z < z0 + 0.04 ? MAT.PLASTIC : GLASS;
      if (z > p.zRoofR + 0.02) return z > z1 - 0.04 && !p.rearVertical ? MAT.PLASTIC : zHatch !== null && z > zHatch ? MAT.PAINT : GLASS; // rear glass / painted tailgate
      return MAT.PAINT;
    },
    // the sedan's open ring under the rear glass is closed with the glass's black lower frit band
    capEnd: p.rearVertical ? MAT.PAINT : p.wrapTail ? MAT.PLASTIC : null,
    capStart: null,
  });
  void zTail;
}

// ---------------------------------------------------------------------------------------------------------
// bumpers
// ---------------------------------------------------------------------------------------------------------
/** A shallow bow across the taxi nose, fading into the existing hood/fender loft.
 * References show cab finish, not this Camry's precise fascia; retain its low sedan proportions.
 */
function taxiNoseOffset(x: number): number {
  return -0.034 + 0.15 * Math.pow(Math.abs(x) / 0.86, 3);
}

function taxiNoseZ(spec: VehicleSpec, x: number, z = -spec.front): number {
  const t = clamp01(1 - (z + spec.front) / 0.55);
  return z + taxiNoseOffset(x) * t * t;
}

/** Transform normals with the inverse transpose of the deformation, not just positions. */
function curveTaxiNose(b: GeoBuilder, first: number, spec: VehicleSpec, proud = 0): void {
  for (let i = first; i < b.count; i++) {
    const j = i * 3, x = b.pos[j], z = b.pos[j + 2];
    const t = clamp01(1 - (z + spec.front) / 0.55);
    if (t <= 0) continue;
    const dzdx = 0.45 * x * Math.abs(x) / Math.pow(0.86, 3) * t * t;
    const dzdz = 1 - (taxiNoseOffset(x) - proud) * 2 * t / 0.55;
    const nz = b.nrm[j + 2] / dzdz;
    const nx = b.nrm[j] - dzdx * nz, ny = b.nrm[j + 1];
    const len = Math.hypot(nx, ny, nz);
    b.pos[j + 2] = taxiNoseZ(spec, x, z) - proud * t * t;
    b.nrm[j] = nx / len; b.nrm[j + 1] = ny / len; b.nrm[j + 2] = nz / len;
  }
}

/** Weld only the requested taxi surface's shading, retaining atlas/material boundaries and draw batches. */
function smoothTaxiSurface(b: GeoBuilder, firstIndex: number, material: MatSpec): void {
  const sums = new Map<string, THREE.Vector3>();
  const vertices = new Map<number, string>();
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const a = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let i = firstIndex; i < b.idx.length; i += 3) {
    const ids = b.idx.slice(i, i + 3);
    if (!ids.every(id => b.mat[id * 4] === material.cc && b.mat[id * 4 + 1] === material.rough
      && b.mat[id * 4 + 2] === material.metal && b.mat[id * 4 + 3] === material.paint)) continue;
    for (let k = 0; k < 3; k++) p[k].fromArray(b.pos, ids[k] * 3);
    normal.crossVectors(a.subVectors(p[1], p[0]), c.subVectors(p[2], p[0]));
    if (normal.lengthSq() < 1e-16) continue;
    normal.normalize();
    for (let k = 0; k < 3; k++) {
      const key = p[k].toArray().map(v => v.toFixed(6)).join(',');
      const angle = a.subVectors(p[(k + 1) % 3], p[k]).angleTo(c.subVectors(p[(k + 2) % 3], p[k]));
      if (!sums.has(key)) sums.set(key, new THREE.Vector3());
      sums.get(key)!.addScaledVector(normal, angle);
      vertices.set(ids[k], key);
    }
  }
  for (const [id, key] of vertices) {
    normal.copy(sums.get(key)!);
    if (normal.lengthSq() > 1e-16) normal.normalize().toArray(b.nrm, id * 3);
  }
}

/** Painted bumper cheeks and lip around an actual recessed, flared lower opening. */
function buildTaxiBumper(b: GeoBuilder, spec: VehicleSpec, p: BodyParams, detail: Detail): void {
  const sh = tubShape(spec, p), near = detail === 'near';
  const first = b.count, firstIndex = b.idx.length, length = 0.52;
  const stations: Station[] = range(0, length, near ? 0.1 : length).map(d => {
    const z = -spec.front + d, t = smooth(d / length);
    const w = sh.shoulderX(z) - lerp(0.016, 0.055, t);
    // Bring the cheek into the lower fender beneath the lamp. The old low shoulder left a visible
    // re-entrant notch where the separate tub and bumper met at the front corner.
    const bottom = lerp(p.floorY + 0.02, p.floorY, t), top = lerp(p.noseBottom + 0.078, p.sillY + 0.16, t);
    const h = top - bottom;
    return { z, pts: [
      { x: 0, y: bottom },
      { x: w - 0.09, y: bottom, sharp: true },
      { x: w - 0.025, y: bottom + h * 0.09 },
      { x: w + 0.012, y: bottom + h * 0.40 },
      { x: w + 0.008, y: top - h * 0.20 },
      { x: w - 0.015, y: top },
      { x: 0, y: top },
    ] };
  });
  loft(b, stations, {
    mirror: true, rect: R.solid.white,
    matFn: (_fi, fk) => fk === 0 || fk === 11 ? MAT.PLASTIC : MAT.PAINT,
  });
  // A small physical overlap avoids coplanar flicker where the raised cover meets the tub cap.
  const coverProud = 0.004;
  curveTaxiNose(b, first, spec, coverProud);
  const mirror = (half: ProfilePt[]): ProfilePt[] => [
    ...half, ...half.slice(1, -1).reverse().map(q => ({ x: -q.x, y: q.y })),
  ];
  const outer = mirror(stations[0].pts);
  // intake between 6.5 cm over the floor and 2.5 cm under the nose bottom (the Camry's 0.225..0.525 m)
  const oy = (f: number) => lerp(p.floorY + 0.065, p.noseBottom - 0.025, f);
  const opening = mirror([
    { x: 0, y: oy(0) }, { x: 0.55, y: oy(0) }, { x: 0.615, y: oy(0.11) },
    { x: 0.585, y: oy(0.41667) }, { x: 0.475, y: oy(0.88333) }, { x: 0.425, y: oy(1) }, { x: 0, y: oy(1) },
  ]);
  const point = (q: ProfilePt, depth = 0): [number, number, number] => [q.x, q.y, taxiNoseZ(spec, q.x) - coverProud + depth];
  // A gently crowned intermediate contour turns the flat surround into a moulded bumper cover.
  // Its outer edge still meets the existing fender; the flared Camry intake silhouette is unchanged.
  const middle = outer.map((q, i) => ({ x: lerp(q.x, opening[i].x, 0.5), y: lerp(q.y, opening[i].y, 0.5) }));
  const depth = near ? 0.035 : -0.003;
  // A separate narrow return keeps the intake edge crisp instead of smoothing the whole cheek
  // into one swollen surface. Same dielectric paint response, still in the opaque batch.
  const lipPaint = m(1, 0.4, 0.3, 1);
  const lip = opening.map((q, i) => ({ x: lerp(q.x, middle[i].x, 0.09), y: lerp(q.y, middle[i].y, 0.09) }));
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    if (near) {
      exteriorQuad(b, [point(outer[i]), point(outer[j]), point(middle[j], -0.016), point(middle[i], -0.016)], MAT.PAINT, R.solid.white);
      exteriorQuad(b, [point(middle[i], -0.016), point(middle[j], -0.016), point(lip[j], -0.012), point(lip[i], -0.012)], MAT.PAINT, R.solid.white);
      exteriorQuad(b, [point(lip[i], -0.012), point(lip[j], -0.012), point(opening[j], 0.002), point(opening[i], 0.002)], lipPaint, R.solid.white);
    } else exteriorQuad(b, [point(outer[i]), point(outer[j]), point(opening[j], -0.006), point(opening[i], -0.006)], MAT.PAINT, R.solid.white);
    if (near) exteriorQuad(b, [point(opening[i], 0.002), point(opening[j], 0.002), point(opening[j], depth), point(opening[i], depth)], MAT.PLASTIC, R.solid.black);
  }
  // The grille is behind the painted surround; it no longer hangs ahead of the bumper like a plate.
  polygon(b, opening.map(q => new THREE.Vector3(...point(q, depth))).reverse(), new THREE.Vector3(0, 0, -1), MAT.PLASTIC, R.grille);
  smoothTaxiSurface(b, firstIndex, MAT.PAINT);
  smoothTaxiSurface(b, firstIndex, lipPaint);
}

function buildBumper(b: GeoBuilder, spec: VehicleSpec, p: BodyParams, end: 'front' | 'rear', detail: Detail): void {
  if (p.sculpted && end === 'front') {
    buildTaxiBumper(b, spec, p, detail);
    return;
  }
  const sh = tubShape(spec, p);
  const zEnd = end === 'front' ? -spec.front : spec.rear;
  const dir = end === 'front' ? -1 : 1;
  const top = end === 'front' ? p.noseBottom + 0.02 : p.tailBottom + 0.02;
  const bottom = Math.max(0.12, p.floorY - 0.02);
  const black = p.sculpted ? bottom + (top - bottom) * 0.24 : end === 'front' ? bottom + (top - bottom) * 0.42 : bottom + (top - bottom) * 0.38;
  const len = spec.style === 'bus' ? 0.35 : 0.55;
  const proud = spec.style === 'bus' ? 0.02 : 0.015; // modern covers sit nearly flush with the body
  const zs = detail === 'near' ? range(0, len, 0.05) : range(0, len, len / 3);
  const stations: Station[] = [];
  for (const d of zs) {
    // d = distance from the tucked-in start toward the end
    const z = zEnd - dir * (len - d) + dir * proud * smooth(d / len);
    const zBody = zEnd - dir * Math.max(0.0, len - d);
    const xs = Math.min(sh.sillX(zBody) + 0.01, sh.shoulderX(zBody) - 0.06);
    const tEnd = clamp01((d - (len - 0.12)) / 0.12);
    const squeeze = 1 - 0.85 * smooth(tEnd);
    const mid = (top + bottom) / 2;
    const yb = mid + (bottom - mid) * squeeze;
    const yt = mid + (top - mid) * squeeze;
    const ybl = mid + (black - mid) * squeeze;
    const pts: ProfilePt[] = [
      { x: 0, y: yb },
      { x: xs - 0.07, y: yb, sharp: true },
      { x: xs - 0.01, y: yb + 0.05 * squeeze },
      { x: xs + 0.012, y: ybl, split: true },
      { x: xs + 0.03, y: yt - 0.05 * squeeze },
      { x: xs + 0.005, y: yt, sharp: true },
      { x: 0, y: yt },
    ];
    stations.push({ z, pts });
  }
  const nHalf = 7, ringN = nHalf * 2 - 2;
  const halfOf = (k: number) => (k < nHalf ? k : ringN - k);
  const isRight = (k: number) => k < nHalf;
  loft(b, stations, {
    mirror: true,
    rect: R.solid.white,
    matFn: (_fi, fk) => {
      const hk = halfOf(fk);
      const hkFace = isRight(fk) ? hk : hk - 1;
      if (hkFace <= 2) return MAT.PLASTIC;
      return spec.style === 'garbage' ? MAT.PLASTIC : MAT.PAINT;
    },
    capEnd: end === 'rear' ? MAT.PAINT : null,
    capStart: end === 'front' ? MAT.PAINT : null,
  });
}

// ---------------------------------------------------------------------------------------------------------
// wheels
// ---------------------------------------------------------------------------------------------------------
export function buildWheel(b: GeoBuilder, spec: VehicleSpec, detail: Detail): void {
  // built for the RIGHT side (outer face at +x), centered at origin; hub axis = x
  const tr = spec.wheelRadius, tw = spec.tireWidth, hwd = tw / 2;
  const rimR = tr * (carLike(spec.style) ? 0.64 : spec.style === 'suv' ? 0.63 : spec.style === 'police' ? 0.61 : 0.55);
  // police cars run black steel wheels; everything else silver alloy / steel
  const rimMat = spec.style === 'police' ? MAT.DARKMETAL : MAT.ALLOY, rimRect = spec.style === 'police' ? R.solid.black : R.solid.alloy;
  // The atlas describes coated spokes/steel and a cap, not a mirror. A diffuse lobe keeps
  // its pattern readable in street shade at 10–40 m (and in the mipmapped far wheel).
  const faceMat = m(0.12, 0.48, spec.style === 'police' ? 0.12 : 0.22, 0);
  const segs = detail === 'near' ? 36 : 16;
  // tire: sidewall (polar uv on the sidewall rect) + tread (strip uv on the tread rect)
  const g1 = 0.006;
  const tireProfile = (): { r: number; x: number; sharp?: boolean }[] => {
    if (detail === 'far') return [{ r: rimR, x: -hwd + 0.01 }, { r: tr - 0.01, x: -hwd + 0.01 }, { r: tr, x: -hwd + 0.04, sharp: true }, { r: tr, x: hwd - 0.04, sharp: true }, { r: tr - 0.01, x: hwd - 0.01 }, { r: rimR, x: hwd - 0.01 }];
    const pts: { r: number; x: number; sharp?: boolean }[] = [
      { r: rimR - 0.01, x: -hwd + 0.02 },
      { r: rimR + 0.01, x: -hwd + 0.005 },
      { r: tr - 0.055, x: -hwd },
      { r: tr - 0.02, x: -hwd + 0.012 },
      { r: tr - 0.006, x: -hwd + 0.03, sharp: true },
      { r: tr, x: -hwd + 0.045 },
    ];
    // tread grooves
    const treadW = tw - 0.09;
    const grooves = 3;
    for (let i = 0; i <= grooves; i++) {
      const xa = -treadW / 2 + (treadW * i) / (grooves + 1) + 0.012;
      const xb = -treadW / 2 + (treadW * (i + 1)) / (grooves + 1) - 0.012;
      if (i > 0) pts.push({ r: tr, x: xa, sharp: true });
      if (i < grooves) {
        pts.push({ r: tr, x: xb, sharp: true });
        pts.push({ r: tr - g1 * 1.6, x: xb + 0.006, sharp: true });
        pts.push({ r: tr - g1 * 1.6, x: xb + 0.018, sharp: true });
      }
    }
    pts.push({ r: tr, x: hwd - 0.045 });
    pts.push({ r: tr - 0.006, x: hwd - 0.03, sharp: true });
    pts.push({ r: tr - 0.02, x: hwd - 0.012 });
    pts.push({ r: tr - 0.055, x: hwd });
    pts.push({ r: rimR + 0.01, x: hwd - 0.005 });
    pts.push({ r: rimR - 0.01, x: hwd - 0.02 });
    return pts;
  };
  const prof = tireProfile();
  // split the lathe: sidewalls polar-mapped, tread strip-mapped -> do two lathes sharing the boundary
  const iA = prof.findIndex((q) => q.r === tr);
  const iB = prof.length - 1 - [...prof].reverse().findIndex((q) => q.r === tr);
  lathe(b, prof.slice(0, iA + 1), segs, MAT.RUBBER, R.sidewall, { uv: 'polar', rMax: tr });
  lathe(b, prof.slice(iA, iB + 1), segs, MAT.RUBBER, R.tread, { uv: 'strip' });
  lathe(b, prof.slice(iB), segs, MAT.RUBBER, R.sidewall, { uv: 'polar', rMax: tr });

  // rim: barrel lip + dish + spokes + hub + brake disc
  const face = hwd - 0.035; // outer face x
  if (detail === 'near') {
    // barrel + rolled lip
    lathe(b, [{ r: rimR - 0.012, x: -hwd + 0.03 }, { r: rimR - 0.012, x: face - 0.02, sharp: true }, { r: rimR, x: face + 0.005, sharp: true }, { r: rimR - 0.03, x: face - 0.002, sharp: true }, { r: rimR - 0.045, x: face - 0.03 }], segs, rimMat, rimRect);
    // dished face carrying the painted spoke design (dark pockets, twin spokes, centre cap, lug nuts):
    // far cheaper than modelled spokes and it reads as a real wheel instead of a sky-mirror rotor
    lathe(b, [{ r: rimR - 0.03, x: face - 0.005 }, { r: rimR * 0.5, x: face - 0.025 }, { r: 0.085, x: face - 0.03, sharp: true }, { r: 0.0, x: face - 0.015 }], segs, faceMat, R.wheelHub, { uv: 'polar', rMax: rimR - 0.03 });
  } else {
    lathe(b, [{ r: rimR, x: face }, { r: 0.0, x: face }], segs, faceMat, R.wheelHub, { uv: 'polar', rMax: rimR }); // faces +x (outer)
  }
  // inner face cap so the wheel isn't hollow from inside
  lathe(b, [{ r: 0.0, x: -hwd + 0.02 }, { r: rimR, x: -hwd + 0.02 }], detail === 'near' ? 16 : 8, MAT.DARKMETAL, R.solid.black); // faces -x (chassis side)
}

// ---------------------------------------------------------------------------------------------------------
// details (lights, grille, plates, mirrors, handles, wipers, interior, roof gear)
// ---------------------------------------------------------------------------------------------------------
function buildTaxiHeadlights(b: GeoBuilder, glass: GeoBuilder | null, spec: VehicleSpec, p: BodyParams, detail: Detail): void {
  const sh = tubShape(spec, p), near = detail === 'near';
  // Mapped reflector chambers sit behind a separate, gently bowed clear cover at the near LOD.
  const lensMaterial = near ? m(0, 0.24, 0.55, 0) : m(1, 0.26, 0, 0);
  const firstIndex = b.idx.length;
  const firstGlassIndex = glass?.idx.length ?? 0;
  type LensRow = { bottom: [number, number, number]; top: [number, number, number]; u: number };
  // the lamp layout was authored on the Camry nose (top 0.76 m); taller sculpted noses carry it up with them
  const ly = p.noseTop - 0.76;
  for (const side of [1, -1]) {
    const rows: LensRow[] = [
      { bottom: [0.265, 0.665 + ly, -spec.front], top: [0.265, 0.735 + ly, -spec.front], u: 0 },
      { bottom: [0.48, 0.635 + ly, -spec.front], top: [0.48, 0.754 + ly, -spec.front], u: 0.30 },
      { bottom: [0.71, 0.648 + ly, -spec.front], top: [0.71, 0.751 + ly, -spec.front], u: 0.58 },
    ];
    const sideX = (z: number, y: number): number => {
      const sy = sh.shoulderY(z), sx = sh.shoulderX(z);
      return sx + 0.018 + (y > sy - 0.035
        ? -0.06 * clamp01((y - sy + 0.035) / 0.05)
        : 0.024 * clamp01((sy - 0.035 - y) / 0.125));
    };
    for (const d of [0.015, 0.04, 0.14, 0.30, 0.43]) {
      const z = -spec.front + d, top = sh.shoulderY(z) - 0.022;
      const bottom = top - lerp(0.115, 0.023, smooth(d / 0.43));
      rows.push({ bottom: [sideX(z, bottom), bottom, z], top: [sideX(z, top), top, z], u: 0.58 + 0.42 * d / 0.43 });
    }
    const lensPoint = (q: [number, number, number]): [number, number, number] => [
      side * q[0], q[1], taxiNoseZ(spec, q[0], q[2]) - 0.009,
    ];
    const coverPoint = (row: LensRow, v: number): [number, number, number] => {
      const q = lensPoint(row.bottom.map((n, k) => lerp(n, row.top[k], v)) as [number, number, number]);
      const wrap = smooth((row.u - 0.58) / 0.42);
      const depth = 0.014 + 0.006 * Math.sin(Math.PI * v);
      q[0] += side * depth * wrap;
      q[2] -= depth * (1 - wrap);
      return q;
    };
    const opticPoint = (u: number, v: number, proud: number): [number, number, number] => {
      const i = Math.max(0, rows.findIndex(row => row.u >= u) - 1);
      const a = rows[i], c = rows[i + 1], t = (u - a.u) / (c.u - a.u);
      const q = a.bottom.map((n, k) => lerp(lerp(n, a.top[k], v), lerp(c.bottom[k], c.top[k], v), t)) as [number, number, number];
      const point = lensPoint(q);
      point[2] -= proud;
      return point;
    };
    // One continuous tapered lens, including the corner: no separate square front and black side slab.
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i], c = rows[i + 1];
      if (near) {
        const crownPoint = (row: LensRow): [number, number, number] => {
          const q = lensPoint(row.bottom.map((v, k) => lerp(v, row.top[k], 0.5)) as [number, number, number]);
          const wrap = smooth((row.u - 0.58) / 0.42);
          q[0] -= side * 0.003 * wrap;
          q[2] += 0.003 * (1 - wrap);
          return q;
        };
        exteriorQuad(b, [lensPoint(a.bottom), lensPoint(c.bottom), crownPoint(c), crownPoint(a)], lensMaterial, R.headlight, LIGHT.HEAD,
          [[a.u, 0], [c.u, 0], [c.u, 0.5], [a.u, 0.5]]);
        exteriorQuad(b, [crownPoint(a), crownPoint(c), lensPoint(c.top), lensPoint(a.top)], lensMaterial, R.headlight, LIGHT.HEAD,
          [[a.u, 0.5], [c.u, 0.5], [c.u, 1], [a.u, 1]]);
        if (glass) for (const v of [0, 0.5]) {
          exteriorQuad(glass, [coverPoint(a, v), coverPoint(c, v), coverPoint(c, v + 0.5), coverPoint(a, v + 0.5)], TAXI_LAMP_GLASS, R.solid.white);
        }
      } else exteriorQuad(b, [lensPoint(a.bottom), lensPoint(c.bottom), lensPoint(c.top), lensPoint(a.top)], lensMaterial, R.headlight, LIGHT.HEAD,
          [[a.u, 0], [c.u, 0], [c.u, 1], [a.u, 1]]);
      if (near) {
        // Dark housing returns enclose the reflector; the cover is not a silver-white solid wedge.
        exteriorQuad(b, [coverPoint(a, 0), coverPoint(c, 0), lensPoint(c.bottom), lensPoint(a.bottom)], MAT.PLASTIC, R.solid.black);
        exteriorQuad(b, [lensPoint(a.top), lensPoint(c.top), coverPoint(c, 1), coverPoint(a, 1)], MAT.PLASTIC, R.solid.black);
      }
    }
    if (near) {
      // Round projector mouth and recessed optical centre, inside the existing swept cover.
      // Its position follows the already-authored atlas optic, not an inferred reference layout.
      // Ten sides add only 60 triangles per car; no extra mesh/material or far-LOD geometry.
      const reflector = m(0, 0.18, 0.9, 0), optic = m(0, 0.08, 0, 0);
      const center = opticPoint(0.30, 0.43, 0.010);
      for (let j = 0; j < 10; j++) {
        const a = j * Math.PI * 2 / 10, c = (j + 1) * Math.PI * 2 / 10;
        const uv = (angle: number, inner: boolean): [number, number] => [
          0.30 + Math.cos(angle) * (inner ? 0.041 : 0.055),
          0.43 + Math.sin(angle) * (inner ? 0.235 : 0.31),
        ];
        const au = uv(a, false), cu = uv(c, false), ai = uv(a, true), ci = uv(c, true);
        const pa = opticPoint(...au, 0.013), pc = opticPoint(...cu, 0.013);
        const ia = opticPoint(...ai, 0.004), ic = opticPoint(...ci, 0.004);
        exteriorQuad(b, [pa, pc, ic, ia], reflector, R.solid.chrome);
        // A shallow convex core catches a compact reflection while the surrounding bowl stays dark.
        const n = new THREE.Vector3(...ic).sub(new THREE.Vector3(...ia)).cross(new THREE.Vector3(...center).sub(new THREE.Vector3(...ia))).normalize();
        if (n.z > 0) n.negate();
        const vertex = (q: [number, number, number], tex: [number, number]) => b.v(...q, n.x, n.y, n.z,
          lerp(R.headlight.u0, R.headlight.u1, tex[0]), lerp(R.headlight.v0, R.headlight.v1, tex[1]), optic, LIGHT.HEAD);
        const va = vertex(ia, ai), vc = vertex(ic, ci), vm = vertex(center, [0.30, 0.43]);
        if (side > 0) b.tri(va, vm, vc); else b.tri(va, vc, vm);
      }
      for (const row of [rows[0], rows[rows.length - 1]]) {
        exteriorQuad(b, [lensPoint(row.bottom), coverPoint(row, 0), coverPoint(row, 1), lensPoint(row.top)], MAT.PLASTIC, R.solid.black);
      }
      const a = rows[rows.length - 2], c = rows[rows.length - 1];
      const marker = (q: [number, number, number], h: number): [number, number, number] => {
        const v = lensPoint(q); return [v[0] + side * 0.002, v[1] + h, v[2] - 0.001];
      };
      exteriorQuad(b, [marker(a.bottom, 0.004), marker(c.bottom, 0.004), marker(c.bottom, 0.017), marker(a.bottom, 0.017)], MAT.LENS, R.solid.amber, side > 0 ? LIGHT.SIG_R : LIGHT.SIG_L);
    }
  }
  smoothTaxiSurface(b, firstIndex, lensMaterial);
  if (glass) smoothTaxiSurface(glass, firstGlassIndex, TAXI_LAMP_GLASS);
}

function buildLights(b: GeoBuilder, glass: GeoBuilder | null, spec: VehicleSpec, p: BodyParams, detail: Detail): void {
  const sh = tubShape(spec, p);
  const zNose = -spec.front, zTail = spec.rear;
  const noseW = sh.shoulderX(zNose + 0.005);
  const near = detail === 'near';
  // headlights: wedge lenses at the nose corners, sweeping back along the fender
  const hlY0 = p.noseTop - (spec.style === 'taxi' ? 0.24 : carLike(spec.style) ? 0.19 : 0.22), hlY1 = p.noseTop - 0.03;
  const hlW = Math.min(spec.style === 'taxi' ? 0.56 : carLike(spec.style) ? 0.5 : spec.style === 'bus' ? 0.45 : 0.42, noseW - 0.28);
  if (p.sculpted) buildTaxiHeadlights(b, glass, spec, p, detail);
  for (const s of p.sculpted ? [] : [1, -1]) {
    const xo = s * (noseW - 0.015);
    const xi = s * (noseW - 0.015 - hlW);
    const zf = zNose - 0.006;
    // front face lens
    exteriorQuad(b, s > 0 ? [[xi, hlY0, zf], [xo, hlY0 + 0.03, zf], [xo, hlY1, zf], [xi, hlY1 - 0.02, zf]] : [[xo, hlY0 + 0.03, zf], [xi, hlY0, zf], [xi, hlY1 - 0.02, zf], [xo, hlY1, zf]], MAT.LENS, R.headlight, LIGHT.HEAD, s > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[1, 0], [0, 0], [0, 1], [1, 1]]);
    if (near) {
      // front turn signal: small amber strip under the lens
      const zs = zNose - 0.004;
      exteriorQuad(b, s > 0 ? [[xi + 0.1, hlY0 - 0.05, zs], [xo - 0.02, hlY0 - 0.03, zs], [xo - 0.02, hlY0 - 0.005, zs], [xi + 0.1, hlY0 - 0.02, zs]] : [[xo + 0.02, hlY0 - 0.03, zs], [xi - 0.1, hlY0 - 0.05, zs], [xi - 0.1, hlY0 - 0.02, zs], [xo + 0.02, hlY0 - 0.005, zs]], MAT.LENS, R.solid.amber, s > 0 ? LIGHT.SIG_R : LIGHT.SIG_L);
    }
  }
  // taillights on the tail face + wrap onto the side
  const tailW = sh.shoulderX(zTail - 0.005);
  const tlY1 = sh.topY(zTail - 0.01) - 0.04;
  const police = spec.style === 'police'; // Explorer: wide horizontal LED lamps at the tailgate corners
  const tlY0 = tlY1 - (carLike(spec.style) ? 0.14 : police ? 0.16 : 0.3);
  const tlW = carLike(spec.style) ? 0.55 : police ? 0.5 : 0.2;
  if (p.wrapTail) buildWrapTailFace(b, spec, p, detail);
  for (const s of p.wrapTail ? [] : [1, -1]) {
    const xo = s * (tailW - 0.012);
    const xi = s * (tailW - 0.012 - tlW);
    const zb = zTail + 0.006;
    const inner = s * (tailW - 0.012 - tlW * 0.55);
    // outer part: tail/brake; inner part: brake + turn signal (blinks red)
    if (s > 0) {
      exteriorQuad(b, [[xo, tlY0, zb], [inner, tlY0, zb], [inner, tlY1, zb], [xo, tlY1, zb]], MAT.LENS, R.taillight, LIGHT.TAIL, [[0, 0], [0.55, 0], [0.55, 1], [0, 1]]);
      exteriorQuad(b, [[inner, tlY0, zb], [xi, tlY0, zb], [xi, tlY1, zb], [inner, tlY1, zb]], MAT.LENS, R.taillight, LIGHT.SIG_R, [[0.55, 0], [1, 0], [1, 1], [0.55, 1]]);
    } else {
      exteriorQuad(b, [[inner, tlY0, zb], [xo, tlY0, zb], [xo, tlY1, zb], [inner, tlY1, zb]], MAT.LENS, R.taillight, LIGHT.TAIL, [[0.55, 0], [0, 0], [0, 1], [0.55, 1]]);
      exteriorQuad(b, [[xi, tlY0, zb], [inner, tlY0, zb], [inner, tlY1, zb], [xi, tlY1, zb]], MAT.LENS, R.taillight, LIGHT.SIG_L, [[1, 0], [0.55, 0], [0.55, 1], [1, 1]]);
    }
    if (near && carLike(spec.style)) {
      // side wrap
      const zs = zTail - 0.18;
      const xs = s * (sh.shoulderX(zs) + 0.004);
      const xt = s * (sh.shoulderX(zTail - 0.01) + 0.004);
      exteriorQuad(b, s > 0 ? [[xt, tlY0, zTail - 0.01], [xs, tlY0 + 0.04, zs], [xs, tlY1 - 0.02, zs], [xt, tlY1, zTail - 0.01]] : [[xs, tlY0 + 0.04, zs], [xt, tlY0, zTail - 0.01], [xt, tlY1, zTail - 0.01], [xs, tlY1 - 0.02, zs]], MAT.LENS, R.taillight, LIGHT.TAIL);
    }
    // reverse lamp (small, white) inside the taillight low corner
    if (near) {
      const rx0 = s > 0 ? xi + 0.03 : xi - 0.03, rx1 = s > 0 ? xi + 0.13 : xi - 0.13;
      exteriorQuad(b, s > 0 ? [[rx0, tlY0 + 0.01, zb + 0.001], [rx1, tlY0 + 0.01, zb + 0.001], [rx1, tlY0 + 0.05, zb + 0.001], [rx0, tlY0 + 0.05, zb + 0.001]] : [[rx1, tlY0 + 0.01, zb + 0.001], [rx0, tlY0 + 0.01, zb + 0.001], [rx0, tlY0 + 0.05, zb + 0.001], [rx1, tlY0 + 0.05, zb + 0.001]], MAT.LENS, R.solid.lens, LIGHT.REVERSE);
    }
  }
  // high-mounted brake light (sedan/suv): thin strip at the rear glass top, or on the crossover's roof spoiler
  if (near && (carLike(spec.style) || spec.style === 'suv' || spec.style === 'police')) {
    const z = p.hatchRake ? p.zRoofR + 0.201 : p.rearVertical ? zTail - 0.1 : p.zRoofR + 0.05;
    const y = p.hatchRake ? roofTopAt(b, p, p.zRoofR - 0.3, p.zRoofR) - 0.042 : p.rearVertical ? p.roofY - 0.08 : sh.shoulderY(z) + (p.roofY - sh.shoulderY(z)) * 0.93;
    exteriorQuad(b, [[-0.18, y, z], [0.18, y, z], [0.18, y + (p.hatchRake ? 0.02 : 0.03), z], [-0.18, y + (p.hatchRake ? 0.02 : 0.03), z]], MAT.LENS, R.solid.red, LIGHT.TAIL);
  }
}

/** convex polygon facing `facing` (winding fixed up), with explicit uvs */
function facePoly(b: GeoBuilder, pts: [number, number, number][], uvs: [number, number][], facing: THREE.Vector3, mt: MatSpec, rect: Rect, light: number): void {
  const a = new THREE.Vector3(...pts[0]);
  const n = new THREE.Vector3(...pts[1]).sub(a).cross(new THREE.Vector3(...pts[2]).sub(a));
  if (n.dot(facing) < 0) {
    pts = pts.slice().reverse();
    uvs = uvs.slice().reverse();
  }
  const ids = pts.map((q, i) => b.v(q[0], q[1], q[2], facing.x, facing.y, facing.z, rect.u0 + (rect.u1 - rect.u0) * uvs[i][0], rect.v0 + (rect.v1 - rect.v0) * uvs[i][1], mt, light));
  for (let i = 1; i + 1 < ids.length; i++) b.tri(ids[0], ids[i], ids[i + 1]);
}

/** tail-face part of the wrap lamps: continues the lofted shoulder-band lens around the corner onto the tail face,
 *  following the cap outline (the shoulder roll); outer 60 % tail/brake, inner 40 % turn signal, reverse lens low inside */
function buildWrapTailFace(b: GeoBuilder, spec: VehicleSpec, p: BodyParams, detail: Detail): void {
  const sh = tubShape(spec, p), zTail = spec.rear, near = detail === 'near';
  const sy = sh.shoulderY(zTail), yLo = sy - 0.16, yHi = sy + 0.015;
  const xo = sh.shoulderX(zTail) - 0.004, tlW = carLike(spec.style) ? 0.5 : 0.44, xm = xo - tlW * 0.6, xi = xo - tlW;
  const zb = zTail + 0.004, back = new THREE.Vector3(0, 0, 1);
  const v = (y: number) => clamp01((y - yLo) / (yHi - yLo));
  for (const s of [1, -1]) {
    const P = (q: [number, number], dz = 0): [number, number, number] => [s * q[0], q[1], zb + dz];
    facePoly(b, [P([xo, yLo]), P([xm, yLo]), P([xm, yHi]), P([xo - 0.06, yHi]), P([xo, sy - 0.03])],
      [[0.5, 0], [0.8, 0], [0.8, 1], [0.5 + 0.3 * (0.06 / tlW), 1], [0.5, v(sy - 0.03)]], back, MAT.LENS, R.taillight, LIGHT.TAIL);
    facePoly(b, [P([xm, yLo]), P([xi, yLo]), P([xi, yHi]), P([xm, yHi])], [[0.8, 0], [1, 0], [1, 1], [0.8, 1]], back, MAT.LENS, R.taillight, s > 0 ? LIGHT.SIG_R : LIGHT.SIG_L);
    if (near) facePoly(b, [P([xi + 0.03, yLo + 0.012], 0.001), P([xi + 0.13, yLo + 0.012], 0.001), P([xi + 0.13, yLo + 0.05], 0.001), P([xi + 0.03, yLo + 0.05], 0.001)], [[0, 0], [1, 0], [1, 1], [0, 1]], back, MAT.LENS, R.solid.lens, LIGHT.REVERSE);
  }
}

function buildFrontFace(b: GeoBuilder, spec: VehicleSpec, p: BodyParams, detail: Detail): void {
  if (p.sculpted) {
    const near = detail === 'near';
    // authored on the Camry nose (top 0.76 m); the crossover carries the slot and badge up with its taller nose
    const ly = p.noseTop - 0.76;
    // Shallow upper slot joins the inner lamp tips. The lower intake lives in the sculpted bumper.
    for (const side of [1, -1]) {
      const point = (x: number, y: number): [number, number, number] => [side * x, y + ly, taxiNoseZ(spec, x) - 0.009];
      exteriorQuad(b, [point(0, 0.653), point(0.265, 0.68), point(0.265, 0.723), point(0, 0.704)], MAT.PLASTIC, R.grille);
      if (near) exteriorQuad(b, [point(0, 0.704), point(0.265, 0.723), point(0.265, 0.731), point(0, 0.712)], MAT.DARKMETAL, R.solid.darkchrome);
    }
    if (near) {
      const badgeZ = taxiNoseZ(spec, 0) - 0.015;
      exteriorQuad(b, [[-0.036, 0.665 + ly, badgeZ], [0.036, 0.665 + ly, badgeZ], [0.036, 0.706 + ly, badgeZ], [-0.036, 0.706 + ly, badgeZ]], MAT.DARKMETAL, R.solid.darkchrome);
    }
    if (p.bigGrille) {
      // crossover: a tall trapezoid grille fills the nose between the bumper cover and the lamp tips, following the bow
      const gy0 = p.noseBottom + 0.092, gy1 = p.noseTop - 0.13, xs = [0, 0.18, 0.36, 0.52];
      for (const side of [1, -1]) {
        const pt = (x: number, y: number, d = 0.012): [number, number, number] => [side * x, y, taxiNoseZ(spec, x) - d];
        for (let i = 0; i + 1 < xs.length; i++) {
          const xa = xs[i], xb = xs[i + 1];
          exteriorQuad(b, [pt(xa, gy0), pt(xb, gy0), pt(xb * 0.9, gy1), pt(xa * 0.9, gy1)], MAT.PLASTIC, R.grille, 0, [[xa / 0.52, 0], [xb / 0.52, 0], [xb / 0.52, 1], [xa / 0.52, 1]]);
        }
        // gloss black surround: top bar and outer post
        if (near) {
          exteriorQuad(b, [pt(0, gy1, 0.014), pt(0.47, gy1, 0.014), pt(0.47, gy1 + 0.018, 0.014), pt(0, gy1 + 0.018, 0.014)], MAT.DARKMETAL, R.solid.black);
          exteriorQuad(b, [pt(0.52, gy0, 0.014), pt(0.545, gy0, 0.014), pt(0.49, gy1 + 0.018, 0.014), pt(0.47, gy1 + 0.018, 0.014)], MAT.DARKMETAL, R.solid.black);
        }
      }
    }
    const pw = 0.305, ph = 0.152, y = p.floorY + 0.255, z = taxiNoseZ(spec, 0) - 0.012;
    exteriorQuad(b, [[-pw / 2, y - ph / 2, z], [pw / 2, y - ph / 2, z], [pw / 2, y + ph / 2, z], [-pw / 2, y + ph / 2, z]], MAT.PLATE, R.plateFront);
    return;
  }
  const sh = tubShape(spec, p);
  const zNose = -spec.front;
  const noseW = sh.shoulderX(zNose + 0.005);
  const near = detail === 'near';
  // grille (between the headlights)
  const gw = carLike(spec.style) ? Math.max(0.5, (noseW - 0.55) * 2) : Math.max(0.6, (noseW - 0.46) * 2);
  const gy1 = p.noseTop - 0.05, gy0 = carLike(spec.style) ? p.noseTop - 0.2 : p.noseTop - 0.28;
  const zg = zNose - 0.004;
  const trimM = p.blackTrim ? MAT.PLASTIC : MAT.CHROME, trimR = p.blackTrim ? R.solid.black : R.solid.chrome;
  exteriorQuad(b, [[-gw / 2, gy0, zg], [gw / 2, gy0, zg], [gw / 2, gy1, zg], [-gw / 2, gy1, zg]], MAT.PLASTIC, R.grille, 0);
  if (near) {
    // grille surround (chrome, or gloss black trim on fleet cars)
    const t = 0.02;
    exteriorQuad(b, [[-gw / 2 - t, gy0 - t, zg + 0.001], [gw / 2 + t, gy0 - t, zg + 0.001], [gw / 2 + t, gy0, zg + 0.001], [-gw / 2 - t, gy0, zg + 0.001]], trimM, trimR);
    exteriorQuad(b, [[-gw / 2 - t, gy1, zg + 0.001], [gw / 2 + t, gy1, zg + 0.001], [gw / 2 + t, gy1 + t, zg + 0.001], [-gw / 2 - t, gy1 + t, zg + 0.001]], trimM, trimR);
    // badge
    exteriorQuad(b, [[-0.045, (gy0 + gy1) / 2 - 0.03, zg - 0.006], [0.045, (gy0 + gy1) / 2 - 0.03, zg - 0.006], [0.045, (gy0 + gy1) / 2 + 0.03, zg - 0.006], [-0.045, (gy0 + gy1) / 2 + 0.03, zg - 0.006]], p.blackTrim ? MAT.DARKMETAL : MAT.CHROME, p.blackTrim ? R.solid.darkchrome : R.solid.chrome);
  }
  // lower bumper intake (black mesh) + front plate
  const by0 = Math.max(0.22, p.floorY + 0.05), by1 = p.noseBottom - 0.06;
  const bz = zNose - 0.024; // just in front of the (nearly flush) bumper cover
  const bw = Math.min(1.2, noseW * 1.2);
  exteriorQuad(b, [[-bw / 2, by0, bz], [bw / 2, by0, bz], [bw / 2, by1, bz], [-bw / 2, by1, bz]], MAT.PLASTIC, R.grille, 0);
  const pw = 0.305, ph = 0.152;
  const py = (by0 + by1) / 2 + 0.01;
  // u runs +x -> -x: read left-to-right by someone standing in front of the car
  exteriorQuad(b, [[pw / 2, py - ph / 2, bz - 0.004], [-pw / 2, py - ph / 2, bz - 0.004], [-pw / 2, py + ph / 2, bz - 0.004], [pw / 2, py + ph / 2, bz - 0.004]], MAT.PLATE, R.plateFront, 0);
}

function buildRearFace(b: GeoBuilder, spec: VehicleSpec, p: BodyParams, detail: Detail): void {
  const zTail = spec.rear;
  const near = detail === 'near';
  const sh = tubShape(spec, p);
  // rear plate in a recess above the bumper
  const pw = 0.305, ph = 0.152;
  const py = p.tailBottom + 0.12 + (carLike(spec.style) ? 0.06 : 0.12);
  const zp = zTail + 0.005;
  exteriorQuad(b, [[pw / 2, py - ph / 2, zp], [-pw / 2, py - ph / 2, zp], [-pw / 2, py + ph / 2, zp], [pw / 2, py + ph / 2, zp]], MAT.PLATE, R.plateRear, 0, [[1, 0], [0, 0], [0, 1], [1, 1]]);
  if (near) {
    // plate lamp housing + chrome trunk garnish
    const gw = sh.shoulderX(zTail - 0.02) * 1.1;
    exteriorQuad(b, [[gw / 2, py + ph / 2 + 0.03, zp], [-gw / 2, py + ph / 2 + 0.03, zp], [-gw / 2, py + ph / 2 + 0.05, zp], [gw / 2, py + ph / 2 + 0.05, zp]], p.blackTrim ? MAT.PLASTIC : MAT.CHROME, p.blackTrim ? R.solid.black : R.solid.chrome);
    // exhaust tip(s)
    const ex = carLike(spec.style) ? [0.45] : [0.55];
    for (const x of ex) {
      const g = new GeoBuilder();
      lathe(g, [{ r: 0.035, x: -0.14 }, { r: 0.035, x: -0.02, sharp: true }, { r: 0.028, x: 0 }], 12, MAT.DARKMETAL, R.solid.darkchrome);
      b.append(g, new THREE.Matrix4().makeTranslation(x, p.floorY + 0.03, zTail - 0.02).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)));
    }
  }
}

/** steering wheel (torus on a tilted column) with its hub and a spoke bar; `tilt` = column pitch in radians */
function steeringWheel(b: GeoBuilder, x: number, y: number, z: number, tilt: number): void {
  const sw = new GeoBuilder();
  lathe(sw, [{ r: 0.17, x: -0.018 }, { r: 0.19, x: 0, sharp: true }, { r: 0.17, x: 0.018 }, { r: 0.15, x: 0.0 }], 20, MAT.INTERIOR, R.solid.black);
  lathe(sw, [{ r: 0.0, x: -0.01 }, { r: 0.07, x: -0.01, sharp: true }, { r: 0.07, x: 0.02 }], 12, MAT.INTERIOR, R.solid.black);
  box(sw, 0, 0, 0, 0.02, 0.3, 0.04, MAT.INTERIOR, R.solid.black);
  b.append(sw, new THREE.Matrix4().makeTranslation(x, y, z).multiply(new THREE.Matrix4().makeRotationX(tilt)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
}

function buildInterior(b: GeoBuilder, glass: GeoBuilder | null, spec: VehicleSpec, p: BodyParams): void {
  const sh = tubShape(spec, p);
  const belt = sh.shoulderY(p.zCowl);
  const inW = sh.shoulderX(p.zB) - 0.14;
  const floorY = p.floorY + 0.2;
  // cabin floor (dark)
  quadPts(b, [[-inW, floorY, p.zGlassEnd], [inW, floorY, p.zGlassEnd], [inW, floorY, p.zCowl], [-inW, floorY, p.zCowl]], MAT.INTERIOR, R.solid.interior);
  // dashboard: slab under the windshield base with a top face carrying the cluster texture
  const dz0 = p.zCowl + 0.02, dz1 = p.zCowl + 0.55;
  box(b, 0, belt - 0.12, (dz0 + dz1) / 2, inW * 2, 0.28, dz1 - dz0, MAT.INTERIOR, R.solid.interior, { faces: { py: { rect: R.dash, light: LIGHT.DASH }, nz: false, ny: false } });
  steeringWheel(b, spec.seatX, belt - 0.02, p.zCowl + 0.62, -0.35);
  // seats: front x2, rear bench
  const seat = (x: number, z: number, w: number, tall: number) => {
    box(b, x, floorY + 0.18, z, w, 0.16, 0.5, MAT.INTERIOR, R.solid.seat); // cushion
    const back = new THREE.Matrix4().makeTranslation(x, floorY + 0.18 + tall / 2, z + 0.22).multiply(new THREE.Matrix4().makeRotationX(-0.22));
    box(b, 0, 0, 0, w, tall, 0.12, MAT.INTERIOR, R.solid.seat, { mtx: back });
    const hr = new THREE.Matrix4().makeTranslation(x, floorY + 0.18 + tall + 0.1, z + 0.2).multiply(new THREE.Matrix4().makeRotationX(-0.22));
    box(b, 0, 0, 0, Math.min(0.28, w * 0.6), 0.16, 0.1, MAT.INTERIOR, R.solid.seat, { mtx: hr });
  };
  const seatZ = p.zCowl + 1.05 + (carLike(spec.style) ? 0 : 0.05);
  const tall = Math.min(0.62, p.roofY - floorY - 0.5);
  seat(spec.seatX, seatZ, 0.52, tall);
  seat(-spec.seatX, seatZ, 0.52, tall);
  if (carLike(spec.style) || spec.style === 'suv' || spec.style === 'police') seat(0, seatZ + 0.85, inW * 2 - 0.2, tall - 0.05);
  // taxi partition
  if (spec.livery === 'taxi' || spec.livery === 'borotaxi') {
    const pz = seatZ + 0.42;
    box(b, 0, floorY + 0.35, pz, inW * 2 - 0.1, 0.5, 0.03, MAT.INTERIOR, R.solid.interior);
    if (glass) quadPts(glass, [[-inW + 0.05, floorY + 0.6, pz], [inW - 0.05, floorY + 0.6, pz], [inW - 0.05, p.roofY - 0.15, pz], [-inW + 0.05, p.roofY - 0.15, pz]], MAT.GLASSFAR, R.solid.glass);
  }
  // rear-view mirror
  box(b, 0, p.roofY - 0.13, p.zRoofF - 0.35, 0.24, 0.06, 0.02, MAT.INTERIOR, R.solid.black);
}

function buildExterior(b: GeoBuilder, spec: VehicleSpec, p: BodyParams): void {
  const sh = tubShape(spec, p);
  // side mirrors
  for (const s of [1, -1]) {
    const z = p.zCowl + 0.22;
    const belt = sh.shoulderY(z);
    const x = s * (sh.shoulderX(z) + 0.1);
    if (p.sculpted) {
      // Compact tapered shell, with a distinct dark stalk and inset rear-facing mirror.
      const shell = new GeoBuilder();
      const profile: ProfilePt[] = [
        { x: 0, y: -0.044 }, { x: 0.078, y: -0.034 }, { x: 0.098, y: 0.004 },
        { x: 0.062, y: 0.05 }, { x: 0, y: 0.053 },
      ];
      const rows = [{ z: -0.055, scale: 0.48 }, { z: 0.008, scale: 1 }, { z: 0.044, scale: 0.85 }];
      loft(shell, rows.map(row => ({ z: row.z, pts: profile.map(q => ({ x: q.x * row.scale, y: q.y * row.scale })) })), {
        mirror: true, rect: R.solid.white, matFn: () => MAT.PAINT, capStart: MAT.PAINT,
      });
      const face = [...profile, ...profile.slice(1, -1).reverse().map(q => ({ x: -q.x, y: q.y }))];
      polygon(shell, face.map(q => new THREE.Vector3(q.x * 0.85, q.y * 0.85, 0.044)), new THREE.Vector3(0, 0, 1), MAT.DARKMETAL, R.solid.darkchrome);
      b.append(shell, new THREE.Matrix4().makeTranslation(x, belt + 0.14, z));
    } else box(b, x, belt + 0.14, z, 0.2, 0.11, 0.09, p.blackMirrors ? MAT.PLASTIC : MAT.PAINT, p.blackMirrors ? R.solid.black : R.solid.white, { faces: { pz: { mt: MAT.CHROME, rect: R.solid.chrome } } });
    box(b, s * (sh.shoulderX(z) + 0.02), belt + 0.1, z, 0.08, 0.03, 0.05, MAT.PLASTIC, R.solid.black);
  }
  // door handles
  const handles = spec.style === 'garbage' || spec.style === 'van' ? [p.zDoorR - 0.35] : [p.zB - 0.2, p.zDoorR - 0.25];
  for (const s of [1, -1]) {
    for (const z of handles) {
      const y = sh.shoulderY(z) - (p.crease ? 0.09 : 0.2);
      const x = s * (sh.shoulderX(z) + (p.crease ? 0.026 : 0.012));
      if (p.crease) box(b, s * (sh.shoulderX(z) + 0.016), y, z, 0.006, 0.05, 0.2, MAT.PLASTIC, R.solid.black); // recess
      box(b, x, y, z, 0.02, 0.03, 0.15, MAT.PAINT, R.solid.white);
    }
  }
  // wipers
  for (const s of [-0.35, 0.3]) {
    const z = p.zCowl + 0.03;
    const y = sh.shoulderY(z) + 0.03;
    const mtx = new THREE.Matrix4().makeTranslation(s, y, z).multiply(new THREE.Matrix4().makeRotationY(0.25)).multiply(new THREE.Matrix4().makeRotationX(-0.5));
    box(b, 0.25, 0, 0, 0.55, 0.012, 0.02, MAT.PLASTIC, R.solid.black, { mtx });
  }
  // fuel door line + antenna: skip. Roof rails for suv (seated on the actual roof surface, not the nominal roofY)
  if (spec.style === 'suv') {
    for (const s of [1, -1]) {
      const x = s * (sh.shoulderX(0) - 0.3);
      const top = topAt(b, x - 0.04, x + 0.04, p.zRoofF + 0.1, p.zRoofR - 0.1);
      box(b, x, top + 0.018, (p.zRoofF + p.zRoofR) / 2, 0.05, 0.045, p.zRoofR - p.zRoofF - 0.3, MAT.PLASTIC, R.solid.black);
    }
  } else if (spec.style === 'police') {
    for (const s of [1, -1]) box(b, s * (sh.shoulderX(0) - 0.32), p.roofY + 0.03, (p.zRoofF + p.zRoofR) / 2, 0.05, 0.05, p.zRoofR - p.zRoofF - 0.3, MAT.PLASTIC, R.solid.black);
  }
  if (p.hatchRake) {
    // roof spoiler over the raked hatch glass (the high brake light sits on its trailing face), rear wiper at the glass base
    const roofTop = roofTopAt(b, p, p.zRoofR - 0.3, p.zRoofR);
    box(b, 0, roofTop - 0.03, p.zRoofR + 0.07, (sh.shoulderX(p.zRoofR) - 0.25) * 2, 0.045, 0.26, MAT.PAINT, R.solid.white, { faces: { ny: { mt: MAT.PLASTIC, rect: R.solid.black } } });
    const run = p.zGlassEnd - p.zRoofR, zw = p.zRoofR + run * HATCH_GLASS - 0.04;
    const yw = topAt(b, -0.1, 0.1, zw - 0.02, zw + 0.02) + 0.012;
    box(b, 0.1, yw, zw, 0.5, 0.014, 0.025, MAT.PLASTIC, R.solid.black);
  }
}

/** highest vertex inside an x/z window (surfaces built so far) */
function topAt(b: GeoBuilder, x0: number, x1: number, z0: number, z1: number): number {
  let top = -Infinity;
  for (let i = 0; i < b.count; i++) {
    const x = b.pos[i * 3], z = b.pos[i * 3 + 2];
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) top = Math.max(top, b.pos[i * 3 + 1]);
  }
  return Number.isFinite(top) ? top : 0;
}

function buildRoofGear(b: GeoBuilder, spec: VehicleSpec, p: BodyParams, detail: Detail): void {
  if (spec.roof === 'taxi') {
    const z = (p.zRoofF + p.zRoofR) / 2 - 0.1;
    // roofY is nominal: the loft adds belt/crown height above it. Seat the sign
    // above the actual roof so its medallion text isn't buried in painted metal.
    let roofY = p.roofY;
    for (let i = 0; i < b.count; i++) {
      if (Math.abs(b.pos[i * 3]) < 0.3 && b.pos[i * 3 + 2] >= p.zRoofF && b.pos[i * 3 + 2] <= p.zRoofR) roofY = Math.max(roofY, b.pos[i * 3 + 1]);
    }
    // Full-width rubber seat at both LODs, with the identifier housing physically touching it.
    box(b, 0, roofY + 0.009, z, 0.62, 0.026, 0.22, MAT.PLASTIC, R.solid.black, { faces: { ny: false } });
    box(b, 0, roofY + 0.087, z, 0.6, 0.13, 0.2, MAT.SIGN, R.roofSign, { light: LIGHT.ROOF, faces: { py: { rect: R.solid.lightgray, light: 0 }, ny: false, px: { rect: R.solid.lightgray, light: 0 }, nx: { rect: R.solid.lightgray, light: 0 } } });
  } else if (spec.roof === 'lightbar') {
    const sh = tubShape(spec, p);
    const zBar = (p.zRoofF + p.zRoofR) / 2 - 0.2;
    const roofTop = roofTopAt(b, p, zBar - 0.25, zBar + 0.25);
    // Whelen Liberty-class low-profile bar: 1.22 x 0.055 x 0.3 m on two 3 cm feet; red modules left, blue right, white centre
    box(b, 0, roofTop + 0.03 + 0.0275, zBar, 1.22, 0.055, 0.3, MAT.SIGN, R.lightbar, { light: LIGHT.LIGHTBAR, faces: { py: { rect: R.solid.black, light: 0, mt: MAT.PLASTIC }, ny: false } });
    if (detail === 'near') {
      for (const s of [1, -1]) box(b, s * 0.5, roofTop + 0.015, zBar, 0.05, 0.03, 0.22, MAT.PLASTIC, R.solid.black);
      // roof unit number behind the bar; two whip antennas on the rear roof
      quadPts(b, [[-0.42, roofTop + 0.004, zBar + 0.66], [0.42, roofTop + 0.004, zBar + 0.66], [0.42, roofTop + 0.004, zBar + 0.45], [-0.42, roofTop + 0.004, zBar + 0.45]], MAT.DECAL, R.roofDecal);
      for (const x of [0.38, -0.22]) box(b, x, roofTop + 0.17, p.zRoofR - 0.3, 0.012, 0.34, 0.012, MAT.PLASTIC, R.solid.black);
      // Setina-style push bumper: two uprights, two crossbars, rubber-faced pad, short wings back to the fenders
      const zNose = -spec.front - 0.1;
      for (const s of [1, -1]) box(b, s * 0.3, 0.62, zNose - 0.02, 0.045, 0.62, 0.045, MAT.PLASTIC, R.solid.black);
      box(b, 0, 0.9, zNose - 0.04, 0.78, 0.045, 0.045, MAT.PLASTIC, R.solid.black);
      box(b, 0, 0.66, zNose - 0.04, 0.78, 0.045, 0.045, MAT.PLASTIC, R.solid.black);
      box(b, 0, 0.44, zNose - 0.05, 0.8, 0.17, 0.03, MAT.RUBBER, R.solid.rubber);
      for (const s of [1, -1]) {
        const mtx = new THREE.Matrix4().makeTranslation(s * 0.92, 0.68, zNose + 0.06).multiply(new THREE.Matrix4().makeRotationY(s * 0.6));
        box(b, 0, 0, 0, 0.04, 0.32, 0.36, MAT.PLASTIC, R.solid.black, { mtx });
      }
      // A-pillar spotlight (driver side): drum lamp on a rod through the pillar, lens facing forward
      const sx = -(sh.shoulderX(p.zCowl + 0.2) + 0.11), sy = p.beltF + 0.34, sz = p.zCowl + 0.14;
      box(b, sx + 0.1, sy - 0.02, sz, 0.24, 0.025, 0.025, MAT.PLASTIC, R.solid.black);
      const lamp = new GeoBuilder();
      lathe(lamp, [{ r: 0.05, x: -0.12 }, { r: 0.085, x: -0.09 }, { r: 0.09, x: -0.005, sharp: true }, { r: 0.075, x: 0 }], 14, MAT.PLASTIC, R.solid.black);
      lathe(lamp, [{ r: 0.075, x: 0.001 }, { r: 0, x: 0.004 }], 14, MAT.LENS, R.solid.lens);
      b.append(lamp, new THREE.Matrix4().makeTranslation(sx, sy, sz).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
      // "NYPD" on the hood, "NYPD" + unit number on the tailgate
      hoodDecal(b, sh, p, p.zCowl - 0.78, p.zCowl - 0.58, 0.34, R.hoodDecal);
      const zt = spec.rear + 0.006;
      exteriorQuad(b, [[0.3, 0.94, zt], [-0.3, 0.94, zt], [-0.3, 1.09, zt], [0.3, 1.09, zt]], MAT.DECAL, R.hoodDecal, 0, [[1, 0], [0, 0], [0, 1], [1, 1]]);
      exteriorQuad(b, [[0.82, 0.96, zt], [0.42, 0.96, zt], [0.42, 1.06, zt], [0.82, 1.06, zt]], MAT.DECAL, R.roofDecal, 0, [[1, 0], [0, 0], [0, 1], [1, 1]]);
    }
  }
}

/** highest body vertex near the centreline between two z's (the loft adds belt/crown height above the nominal roof) */
function roofTopAt(b: GeoBuilder, p: BodyParams, z0: number, z1: number): number {
  let roofY = p.roofY;
  for (let i = 0; i < b.count; i++) {
    if (Math.abs(b.pos[i * 3]) < 0.3 && b.pos[i * 3 + 2] >= z0 && b.pos[i * 3 + 2] <= z1) roofY = Math.max(roofY, b.pos[i * 3 + 1]);
  }
  return roofY;
}

/** decal draped over the hood between z0 and z1 (two strips following the crown), reading from the front */
function hoodDecal(b: GeoBuilder, sh: TubShape, p: BodyParams, z0: number, z1: number, halfW: number, rect: Rect): void {
  const y = (z: number, x: number) => sh.topY(z) + p.crown * (1 - (0.35 * Math.abs(x)) / halfW) + 0.01;
  for (const [xa, xb, ua, ub] of [[halfW, 0, 0, 0.5], [0, -halfW, 0.5, 1]] as [number, number, number, number][]) {
    quadPts(b, [[xa, y(z0, xa), z0], [xb, y(z0, xb), z0], [xb, y(z1, xb), z1], [xa, y(z1, xa), z1]], MAT.DECAL, rect, 0, [[ua, 0], [ub, 0], [ub, 1], [ua, 1]]);
  }
}

// trucks: cargo box / hopper / bus body
function buildCargo(b: GeoBuilder, spec: VehicleSpec, p: BodyParams, detail: Detail): void {
  const near = detail === 'near';
  if (spec.style === 'garbage') {
    const z0 = p.zGlassEnd + 0.3, z1 = spec.rear - 1.1;
    const hw = spec.width / 2 - 0.02;
    // hopper body: rounded top loft
    const st: Station[] = [];
    for (const z of [z0, z0 + 0.02, z1 - 0.02, z1]) {
      const sq = z === z0 || z === z1 ? 0.0 : 0;
      void sq;
      st.push({
        z,
        pts: [
          { x: 0, y: 0.95 },
          { x: hw - 0.05, y: 0.95, sharp: true },
          { x: hw, y: 1.1, sharp: true },
          { x: hw, y: 2.9, split: true },
          { x: hw - 0.15, y: 3.35 },
          { x: hw * 0.5, y: spec.height - 0.05 },
          { x: 0, y: spec.height },
        ],
      });
    }
    loft(b, st, { mirror: true, rect: R.boxSide, matFn: (_fi, fk) => (fk === 0 || fk === 11 || fk === 1 ? MAT.PLASTIC : MAT.DECAL), uvFn: (_fi, _fk, _i, _k, x, y, z) => [x >= 0 ? 1 - (z - z0) / (z1 - z0) : (z - z0) / (z1 - z0), clamp01((y - 1.1) / 1.9)], capStart: MAT.PAINT, capEnd: MAT.PAINT, capRect: R.solid.white });
    // rear loader hopper (lower, angled tailgate)
    const zt0 = z1, zt1 = spec.rear;
    box(b, 0, 2.0, (zt0 + zt1) / 2, hw * 2, 2.1, zt1 - zt0, MAT.PAINT, R.solid.white, { faces: { pz: { mt: MAT.DARKMETAL, rect: R.solid.darkchrome } } });
    box(b, 0, 0.62, (p.zGlassEnd + zt1) / 2, 1.0, 0.16, zt1 - p.zGlassEnd, MAT.PLASTIC, R.solid.black);
    if (near) {
      box(b, 0, 0.65, zt1 + 0.1, hw * 1.6, 0.12, 0.3, MAT.DARKMETAL, R.solid.darkchrome); // riding step
      for (const s of [1, -1]) box(b, s * (hw - 0.2), 1.2, zt1 + 0.05, 0.05, 1.2, 0.05, MAT.DARKMETAL, R.solid.darkchrome); // grab rails
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// boxy bodies (bus, cab-over cab): one mirrored loft with a rounded-rectangle profile, wheel wells cut into the
// skirt and raked nose stations, so the big windshield is part of the loft; livery / glass / pillars per face
// ---------------------------------------------------------------------------------------------------------
type BoxyBand = 'under' | 'well' | 'skirt' | 'panel' | 'belt' | 'window' | 'header' | 'roof';
const BOXY_HALF = 13;
const BOXY_BANDS: BoxyBand[] = ['under', 'well', 'well', 'skirt', 'panel', 'belt', 'window', 'header', 'header', 'roof', 'roof', 'roof'];
interface BoxyStation { z: number; x: number; y0: number; belt: number; top: number; winT: number; rTop: number; arch: number | null; wellX: number; split?: boolean; inset?: number }
interface BoxyMatCtx { z: number; y: number; band: BoxyBand; right: boolean; arch: boolean }

function boxyProfile(s: BoxyStation): ProfilePt[] {
  const x = s.x - (s.inset ?? 0);
  const hTop = s.belt + (s.top - s.belt) * s.winT, rest = s.top - hTop, r = Math.min(s.rTop, rest * 0.6);
  const pts: ProfilePt[] = [{ x: 0, y: s.y0 }];
  if (s.arch !== null) pts.push({ x: s.wellX, y: s.y0, sharp: true }, { x: s.wellX, y: s.arch - 0.03, sharp: true }, { x: x + 0.004, y: s.arch + 0.005, sharp: true, split: true });
  else pts.push({ x: x - 0.1, y: s.y0, sharp: true }, { x: x - 0.02, y: s.y0 + 0.05 }, { x, y: s.y0 + 0.12, sharp: true, split: true });
  pts.push({ x, y: Math.max(s.belt - 0.7 * (s.belt - s.y0 - 0.12), (s.arch ?? 0) + 0.03), split: true }); // 4: door glass bottom
  pts.push({ x, y: s.belt - 0.02, split: true }); // 5: belt (livery top)
  pts.push({ x: x - 0.012, y: s.belt + (s.top - s.belt) * 0.03, sharp: true }); // 6: window rubber
  pts.push({ x: x - 0.02, y: hTop, sharp: true }); // 7: window top
  pts.push({ x: x - 0.03, y: hTop + rest * 0.5 }); // 8: header
  pts.push({ x: x - r * 0.3, y: s.top - r * 0.7 }); // 9: roof corner
  pts.push({ x: x - r, y: s.top - r * 0.12 }); // 10
  pts.push({ x: x - r - 0.3, y: s.top }); // 11
  pts.push({ x: 0, y: s.top + 0.01 }); // 12
  return pts;
}

function boxyLoft(b: GeoBuilder, glass: GeoBuilder | null, stations: BoxyStation[], mat: (c: BoxyMatCtx) => MatSpec, uvV: (y: number, band: BoxyBand) => number): void {
  const st: Station[] = stations.map((s) => ({ z: s.z, pts: boxyProfile(s), split: s.split, sharp: !!s.inset }));
  const zs = stations.map((s) => s.z), z0 = zs[0], z1 = zs[zs.length - 1];
  const nHalf = BOXY_HALF, ringN = nHalf * 2 - 2;
  const halfOf = (k: number) => (k < nHalf ? k : ringN - k);
  const isRight = (k: number) => k < nHalf;
  const faceOf = (fk: number) => Math.min(nHalf - 2, isRight(fk) ? halfOf(fk) : halfOf(fk) - 1);
  const ctx = (fi: number, fk: number): BoxyMatCtx => {
    const hf = Math.max(0, faceOf(fk)), a = st[fi].pts, c = st[fi + 1].pts, h1 = Math.min(hf + 1, nHalf - 1);
    return { z: (zs[fi] + zs[fi + 1]) / 2, y: (a[hf].y + a[h1].y + c[hf].y + c[h1].y) / 4, band: BOXY_BANDS[hf], right: isRight(fk), arch: stations[fi].arch !== null || stations[fi + 1].arch !== null };
  };
  loft(b, st, {
    mirror: true,
    rect: R.solid.white,
    glassTo: glass ?? b,
    glassMat: MAT.GLASSFAR,
    matFn: (fi, fk) => (faceOf(fk) < 0 ? MAT.PLASTIC : mat(ctx(fi, fk))),
    uvFn: (_fi, fk, _i, _k, _x, y, z) => {
      const t = clamp01((z - z0) / (z1 - z0));
      return [isRight(fk) ? 1 - t : t, uvV(y, BOXY_BANDS[Math.max(0, faceOf(fk))])];
    },
    capStart: MAT.PAINT,
    capEnd: MAT.PAINT,
    capRect: R.solid.white,
  });
}

/** DECAL vertices added since `from` (uv 0..1 inside the white patch) -> a livery rect chosen by side */
function remapDecalTo(b: GeoBuilder, from: number, rectFor: (x: number) => Rect): void {
  const w = R.solid.white, wu = w.u1 - w.u0, wv = w.v1 - w.v0;
  for (let i = from; i < b.count; i++) {
    if (b.mat[i * 4 + 3] !== 0 || b.mat[i * 4] !== MAT.DECAL.cc || b.mat[i * 4 + 1] !== MAT.DECAL.rough || b.mat[i * 4 + 2] !== MAT.DECAL.metal) continue;
    const rr = rectFor(b.pos[i * 3]);
    b.uv[i * 2] = rr.u0 + (rr.u1 - rr.u0) * clamp01((b.uv[i * 2] - w.u0) / wu);
    b.uv[i * 2 + 1] = rr.v0 + (rr.v1 - rr.v0) * clamp01((b.uv[i * 2 + 1] - w.v0) / wv);
  }
}

/** side-by-side lens pair helper: mirrors the x order for the left side so exteriorQuad keeps the uv upright */
function lensQuad(b: GeoBuilder, s: number, xo: number, xi: number, yA: number, yB: number, z: number, mt: MatSpec, rect: Rect, light: number, uvs?: [number, number][]): void {
  const flip: [number, number][] = [[1, 0], [0, 0], [0, 1], [1, 1]];
  exteriorQuad(b, s > 0 ? [[xi, yA, z], [xo, yA, z], [xo, yB, z], [xi, yB, z]] : [[xo, yA, z], [xi, yA, z], [xi, yB, z], [xo, yB, z]], mt, rect, light, s > 0 ? uvs : uvs ? [uvs[1], uvs[0], uvs[3], uvs[2]] : flip);
}

// New Flyer XD40: 12.2 m box, belt 1.15 m, black window band to 2.5 m, raked one-piece windshield, LED sign,
// yellow front band, blue skirt livery, front bike rack, rear engine grille, roof A/C, two right-side doors
function buildBus(b: GeoBuilder, glass: GeoBuilder | null, spec: VehicleSpec, detail: Detail): void {
  const near = detail === 'near';
  const zN = -spec.front, zT = spec.rear, hw = spec.width / 2;
  const zf = -spec.wheelbase / 2, zr = spec.wheelbase / 2;
  const y0 = 0.33, belt = 1.15, top = spec.height, winT = (2.5 - belt) / (top - belt);
  const archR = spec.wheelRadius + 0.06, hubY = spec.wheelRadius, wellX = hw - 0.8;
  const arch = (z: number): number | null => {
    for (const zc of [zf, zr]) { const dz = z - zc; if (Math.abs(dz) < archR) return hubY + Math.sqrt(archR * archR - dz * dz); }
    return null;
  };
  const doors: [number, number][] = [[zN + 0.45, zN + 1.65], [zN + 6.85, zN + 8.05]];
  const pillars = near ? range(zN + 2.05, zT - 0.7, 1.45) : [];
  const lines = near ? [...pillars, ...doors.flatMap(([a, c]) => [a, c, (a + c) / 2])] : [];
  const noseLen = 0.44;
  const nose: [number, number][] = [[0, belt + 0.02], [0.05, 1.6], [0.14, 2.2], [0.24, 2.58], [0.3, 2.95], [0.36, 3.18], [noseLen, top]];
  const zsMid = near
    ? mergeZ([range(zN + noseLen, zT, 0.3), range(zf - archR - 0.04, zf + archR + 0.04, 0.07), range(zr - archR - 0.04, zr + archR + 0.04, 0.07), lines.flatMap((z) => [z - 0.035, z + 0.035]), [zT - 0.06, zT - 0.18]], zN + noseLen, zT)
    : mergeZ([range(zN + noseLen, zT, 0.6), range(zf - archR, zf + archR, 0.18), range(zr - archR, zr + archR, 0.18), [zT - 0.1]], zN + noseLen, zT);
  const stations: BoxyStation[] = [];
  const st = (z: number, topY: number, split = false) => stations.push({ z, x: hw * cornerTaper(z - zN, 0.32, 0.86) * cornerTaper(zT - z, 0.28, 0.9), y0, belt, top: topY, winT, rTop: 0.32, arch: arch(z), wellX, split });
  for (const [dz, topY] of nose) st(zN + dz, topY, true);
  for (const z of zsMid) if (z > zN + noseLen + 1e-4) st(z, top, lines.some((l) => Math.abs(Math.abs(z - l) - 0.035) < 1e-3));
  const inDoor = (z: number) => doors.some(([a, c]) => z > a && z < c);
  const onLine = (z: number) => lines.some((l) => Math.abs(z - l) < 0.036);
  const mat = ({ z, y, band, right, arch: inArch }: BoxyMatCtx): MatSpec => {
    const noseZ = z < zN + noseLen;
    switch (band) {
      case 'under': return MAT.PLASTIC;
      case 'well': return inArch ? MAT.INTERIOR : MAT.PLASTIC;
      case 'skirt': return MAT.DECAL;
      case 'panel': return right && near && inDoor(z) ? (onLine(z) ? MAT.PLASTIC : GLASS) : MAT.DECAL;
      case 'belt': return MAT.PLASTIC;
      case 'window': return noseZ ? MAT.PLASTIC : z > zT - 0.2 ? MAT.PAINT : onLine(z) ? MAT.PLASTIC : GLASS;
      case 'header': return noseZ ? MAT.PLASTIC : MAT.PAINT;
      case 'roof': return noseZ ? (y > 2.55 ? MAT.PLASTIC : GLASS) : MAT.PAINT;
    }
  };
  const from = b.count;
  boxyLoft(b, glass, stations, mat, (y, band) => (band === 'skirt' || band === 'panel' ? clamp01((y - y0 - 0.12) / (belt - 0.02 - y0 - 0.12)) : 0.5));
  remapDecalTo(b, from, () => R.boxSide);

  // front: bumper, yellow band with the roundel (atlas) + lamps, LED destination sign on the raked glass, wipers
  const zF = zN - 0.004, wF = hw * 0.86 - 0.03;
  box(b, 0, 0.47, zN - 0.05, wF * 2 + 0.08, 0.26, 0.16, MAT.PLASTIC, R.solid.black);
  exteriorQuad(b, [[wF, 0.6, zF], [-wF, 0.6, zF], [-wF, belt - 0.02, zF], [wF, belt - 0.02, zF]], MAT.DECAL, R.busFront);
  for (const s of [1, -1]) {
    lensQuad(b, s, s * (wF - 0.06), s * (wF - 0.5), 0.68, 0.9, zF - 0.003, MAT.LENS, R.headlight, LIGHT.HEAD);
    lensQuad(b, s, s * (wF - 0.06), s * (wF - 0.5), 0.92, 1.0, zF - 0.003, MAT.LENS, R.solid.amber, s > 0 ? LIGHT.SIG_R : LIGHT.SIG_L);
  }
  exteriorQuad(b, [[0.95, 2.62, zN + 0.23], [-0.95, 2.62, zN + 0.23], [-0.95, 2.92, zN + 0.28], [0.95, 2.92, zN + 0.28]], MAT.SIGN, R.sign, LIGHT.BUSSIGN);
  if (near) {
    for (const x of [-0.7, 0.2]) box(b, x, 1.24, zN + 0.02, 0.8, 0.015, 0.03, MAT.PLASTIC, R.solid.black);
    // rabbit-ear mirrors: bar out from the pillar, bar forward, head with the glass facing the driver
    for (const s of [1, -1]) {
      box(b, s * (hw + 0.02), 2.25, zN + 0.06, 0.56, 0.025, 0.025, MAT.PLASTIC, R.solid.black);
      box(b, s * (hw + 0.28), 2.25, zN - 0.08, 0.025, 0.025, 0.3, MAT.PLASTIC, R.solid.black);
      box(b, s * (hw + 0.28), 1.95, zN - 0.22, 0.22, 0.52, 0.06, MAT.PLASTIC, R.solid.black, { faces: { pz: { mt: MAT.CHROME, rect: R.solid.chrome } } });
    }
    // folded two-bike rack ahead of the bumper
    const zR = zN - 0.17;
    box(b, 0, 0.4, zR, 1.2, 0.04, 0.04, MAT.PLASTIC, R.solid.black);
    box(b, 0, 0.98, zR - 0.03, 1.2, 0.04, 0.04, MAT.PLASTIC, R.solid.black);
    for (const x of [-0.58, 0.58]) box(b, x, 0.69, zR - 0.015, 0.04, 0.62, 0.04, MAT.PLASTIC, R.solid.black);
    for (const x of [-0.3, 0.3]) box(b, x, 0.69, zR - 0.07, 0.06, 0.58, 0.03, MAT.PLASTIC, R.solid.black);
    box(b, 0, 0.72, zR - 0.1, 0.42, 0.18, 0.02, MAT.PLASTIC, R.solid.black);
    // side route sign inside the first window on the door side
    const xs = hw + 0.004;
    exteriorQuad(b, [[xs, 2.05, zN + 2.75], [xs, 2.05, zN + 2.1], [xs, 2.3, zN + 2.1], [xs, 2.3, zN + 2.75]], MAT.SIGN, R.sign, LIGHT.BUSSIGN, [[0, 0], [0.36, 0], [0.36, 1], [0, 1]]);
    // door leaf handles / kick plates are implied by the frames; add the fleet number plates near the front
  }
  // rear: bumper, engine grille, rear window, corner lamp stacks (brake / signal / reverse), roof A/C unit
  const zB = zT + 0.004, wB = hw * 0.9 - 0.03;
  box(b, 0, 0.47, zT + 0.05, wB * 2 + 0.08, 0.26, 0.16, MAT.PLASTIC, R.solid.black);
  exteriorQuad(b, [[wB - 0.3, 0.75, zB], [-wB + 0.3, 0.75, zB], [-wB + 0.3, 2.35, zB], [wB - 0.3, 2.35, zB]], MAT.PLASTIC, R.grille);
  exteriorQuad(glass ?? b, [[0.85, 2.45, zB], [-0.85, 2.45, zB], [-0.85, 2.95, zB], [0.85, 2.95, zB]], MAT.GLASSFAR, glass ? R.solid.white : R.solid.glass);
  for (const s of [1, -1]) {
    const xo = s * (wB - 0.05), xi = s * (wB - 0.26);
    lensQuad(b, s, xo, xi, 1.3, 1.55, zB, MAT.LENS, R.solid.red, LIGHT.TAIL);
    lensQuad(b, s, xo, xi, 1.02, 1.27, zB, MAT.LENS, R.solid.amber, s > 0 ? LIGHT.SIG_R : LIGHT.SIG_L);
    lensQuad(b, s, xo, xi, 0.75, 0.99, zB, MAT.LENS, R.solid.lens, LIGHT.REVERSE);
  }
  box(b, 0, top + 0.15, 1.2, 1.7, 0.3, 2.6, MAT.PAINT, R.solid.lightgray);
  // interior: floor, driver's dash + wheel + seat, forward-facing passenger seats
  if (near) {
    const inW = hw - 0.12, floorY = 0.62;
    quadPts(b, [[-inW, floorY, zT - 0.3], [inW, floorY, zT - 0.3], [inW, floorY, zN + 0.5], [-inW, floorY, zN + 0.5]], MAT.INTERIOR, R.solid.interior);
    box(b, -0.62, 1.05, zN + 0.75, 1.05, 0.3, 0.5, MAT.INTERIOR, R.solid.interior, { faces: { py: { rect: R.dash, light: LIGHT.DASH } } });
    steeringWheel(b, spec.seatX, 1.15, zN + 1.35, -0.9);
    const seat = (x: number, z: number, w: number) => {
      box(b, x, floorY + 0.25, z, w, 0.1, 0.45, MAT.INTERIOR, R.solid.seat);
      box(b, x, floorY + 0.55, z + 0.2, w, 0.5, 0.08, MAT.INTERIOR, R.solid.seat);
    };
    seat(spec.seatX, zN + 1.85, 0.5);
    for (let z = zN + 3.2; z < zT - 1.2; z += 0.78) { seat(-inW + 0.45, z, 0.85); seat(inW - 0.45, z, 0.85); }
  }
}

// Isuzu NPR cab-over: 1.95 m cab, 2.0 m wide, raked windshield from the belt (1.3 m) to the roof (2.35 m), door
// seams, vent-window divider, west-coast mirrors, exposed frame, fuel tank, mud flaps behind the duals
function buildCabover(b: GeoBuilder, glass: GeoBuilder | null, spec: VehicleSpec, p: BodyParams, detail: Detail): void {
  const near = detail === 'near';
  const zN = -spec.front, cabL = 1.95, zC = zN + cabL, hw = 1.0;
  const zf = -spec.wheelbase / 2, zr = spec.wheelbase / 2, zT = spec.rear;
  const y0 = 0.42, belt = 1.3, top = 2.35, winT = 0.82;
  const archR = spec.wheelRadius + 0.1, hubY = spec.wheelRadius, wellX = spec.track / 2 - spec.tireWidth / 2 - 0.06;
  const arch = (z: number): number | null => { const dz = z - zf; return Math.abs(dz) < archR ? hubY + Math.sqrt(archR * archR - dz * dz) : null; };
  const seams = [zN + 0.45, zN + 1.6], vent = zN + 0.8, noseLen = 0.36;
  const nose: [number, number][] = [[0, belt + 0.02], [0.04, 1.55], [0.12, 1.95], [0.22, 2.2], [0.3, 2.33], [noseLen, top]];
  const zsMid = near
    ? mergeZ([range(zN + noseLen, zC, 0.2), range(zf - archR - 0.04, zf + archR + 0.04, 0.06), seams.flatMap((z) => [z - 0.006, z, z + 0.006]), [vent - 0.02, vent + 0.02, zC - 0.05]], zN + noseLen, zC)
    : mergeZ([range(zN + noseLen, zC, 0.4), range(zf - archR, zf + archR, 0.16)], zN + noseLen, zC);
  const stations: BoxyStation[] = [];
  const st = (z: number, topY: number, split = false, inset = 0) => stations.push({ z, x: hw * cornerTaper(z - zN, 0.22, 0.88) * cornerTaper(zC - z, 0.08, 0.96), y0, belt, top: topY, winT, rTop: 0.16, arch: arch(z), wellX, split, inset });
  for (const [dz, topY] of nose) st(zN + dz, topY, true);
  for (const z of zsMid) {
    if (z <= zN + noseLen + 1e-4) continue;
    const seam = seams.some((sz) => Math.abs(z - sz) < 1e-4);
    const split = seam || seams.some((sz) => Math.abs(Math.abs(z - sz) - 0.006) < 1e-3) || Math.abs(Math.abs(z - vent) - 0.02) < 1e-3;
    st(z, top, split, seam ? 0.006 : 0);
  }
  const onSeam = (z: number) => seams.some((sz) => Math.abs(z - sz) < 0.0065);
  const mat = ({ z, band, arch: inArch }: BoxyMatCtx): MatSpec => {
    const noseZ = z < zN + noseLen;
    switch (band) {
      case 'under': return MAT.PLASTIC;
      case 'well': return inArch ? MAT.INTERIOR : MAT.PLASTIC;
      case 'skirt': case 'panel': return onSeam(z) ? MAT.PLASTIC : MAT.PAINT;
      case 'belt': return MAT.PLASTIC;
      case 'window': return noseZ || z < seams[0] || z > seams[1] ? MAT.PAINT : onSeam(z) || Math.abs(z - vent) < 0.021 ? MAT.PLASTIC : GLASS;
      case 'header': return MAT.PAINT;
      case 'roof': return noseZ ? GLASS : MAT.PAINT;
    }
  };
  boxyLoft(b, glass, stations, mat, () => 0.5);

  // front panel: bumper with the plate, grille with chrome bars, headlights and signals at the corners
  const zF = zN - 0.004;
  box(b, 0, 0.53, zN - 0.04, 2.0, 0.22, 0.1, MAT.PLASTIC, R.solid.black);
  exteriorQuad(b, [[0.16, 0.46, zN - 0.092], [-0.16, 0.46, zN - 0.092], [-0.16, 0.61, zN - 0.092], [0.16, 0.61, zN - 0.092]], MAT.PLATE, R.plateFront);
  exteriorQuad(b, [[-0.44, 0.78, zF], [0.44, 0.78, zF], [0.44, 1.12, zF], [-0.44, 1.12, zF]], MAT.PLASTIC, R.grille);
  for (const y of [0.86, 1.02]) box(b, 0, y, zN - 0.006, 0.9, 0.02, 0.008, MAT.CHROME, R.solid.chrome);
  for (const s of [1, -1]) {
    lensQuad(b, s, s * 0.9, s * 0.52, 0.8, 1.06, zF, MAT.LENS, R.headlight, LIGHT.HEAD);
    lensQuad(b, s, s * 0.9, s * 0.6, 0.7, 0.78, zF, MAT.LENS, R.solid.amber, s > 0 ? LIGHT.SIG_R : LIGHT.SIG_L);
  }
  // wipers parked at the glass base, cowl strip
  box(b, 0, belt + 0.02, zN + 0.01, 1.8, 0.03, 0.05, MAT.PLASTIC, R.solid.black);
  if (near) for (const x of [-0.55, 0.25]) box(b, x, belt + 0.06, zN - 0.012, 0.6, 0.015, 0.03, MAT.PLASTIC, R.solid.black);
  // west-coast mirrors on two arms, door handles
  for (const s of [1, -1]) {
    for (const y of [1.55, 1.95]) box(b, s * (hw + 0.14), y, zN + 0.55, 0.3, 0.025, 0.025, MAT.PLASTIC, R.solid.black);
    box(b, s * (hw + 0.28), 1.75, zN + 0.55, 0.18, 0.5, 0.03, MAT.PLASTIC, R.solid.black, { faces: { pz: { mt: MAT.CHROME, rect: R.solid.chrome } } });
    if (near) box(b, s * (hw + 0.012), 1.02, zN + 1.42, 0.02, 0.03, 0.14, MAT.PLASTIC, R.solid.black);
  }
  // chassis: frame rails, fuel tank (right), mud flaps behind the duals
  for (const s of [1, -1]) box(b, s * 0.42, 0.92, (zC + zT) / 2, 0.08, 0.16, zT - zC, MAT.PLASTIC, R.solid.black);
  if (near) {
    const tank = new GeoBuilder();
    lathe(tank, [{ r: 0.0, x: -0.36 }, { r: 0.24, x: -0.34, sharp: true }, { r: 0.24, x: 0.34, sharp: true }, { r: 0.0, x: 0.36 }], 14, MAT.ALLOY, R.solid.alloy);
    b.append(tank, new THREE.Matrix4().makeTranslation(0.74, 0.64, zC + 0.9).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
    for (const s of [1, -1]) box(b, s * (spec.track / 2 - 0.02), 0.55, zr + 0.58, 0.5, 0.72, 0.015, MAT.RUBBER, R.solid.rubber);
  }
  if (near) buildInterior(b, glass, { ...spec, width: hw * 2 - 0.1 }, p);
}

// 16 ft box: white FRP panels with the livery / grime painted in the atlas, aluminium rub rails, corner posts,
// roll-up rear door in its frame, cab roof fairing, underride bar, plate and lamps under the door
function buildBox(b: GeoBuilder, spec: VehicleSpec, detail: Detail): void {
  const near = detail === 'near';
  const zN = -spec.front, zT = spec.rear, z0 = zN + 2.1, hw = spec.width / 2, y0 = 1.0, y1 = spec.height;
  const L = zT - z0, zc = (z0 + zT) / 2, zC = zN + 1.95;
  box(b, 0, (y0 + y1) / 2, zc, hw * 2, y1 - y0, L, MAT.DECAL, R.boxSide, {
    faces: { py: { mt: MAT.PAINT, rect: R.solid.white }, ny: { mt: MAT.PLASTIC, rect: R.solid.black }, pz: { mt: MAT.DECAL, rect: R.rearDoor }, nz: { mt: MAT.PAINT, rect: R.solid.white } },
  });
  for (const s of [1, -1]) {
    box(b, s * (hw + 0.015), y0 + 0.05, zc, 0.03, 0.1, L - 0.04, MAT.ALLOY, R.solid.alloy);
    box(b, s * (hw + 0.008), y1 - 0.02, zc, 0.016, 0.04, L, MAT.ALLOY, R.solid.alloy);
    for (const z of [z0 + 0.03, zT - 0.03]) box(b, s * (hw + 0.006), (y0 + y1) / 2, z, 0.012, y1 - y0, 0.06, MAT.ALLOY, R.solid.alloy);
    box(b, s * (hw - 0.06), (y0 + y1) / 2, zT + 0.01, 0.12, y1 - y0, 0.02, MAT.ALLOY, R.solid.alloy);
  }
  box(b, 0, y1 - 0.05, zT + 0.01, hw * 2, 0.1, 0.02, MAT.ALLOY, R.solid.alloy);
  box(b, 0, y0 + 0.04, zT + 0.02, hw * 2 - 0.2, 0.08, 0.04, MAT.DARKMETAL, R.solid.darkchrome);
  // roof fairing from the cab roof up to the box's front edge
  quadPts(b, [[-0.85, 2.37, zC - 0.35], [0.85, 2.37, zC - 0.35], [0.8, y1 - 0.1, z0 - 0.02], [-0.8, y1 - 0.1, z0 - 0.02]], MAT.PAINT, R.solid.white);
  for (const s of [1, -1]) {
    const pts = [new THREE.Vector3(s * 0.85, 2.37, zC - 0.35), new THREE.Vector3(s * 0.8, y1 - 0.1, z0 - 0.02), new THREE.Vector3(s * 0.8, 2.37, z0 - 0.02)];
    polygon(b, s > 0 ? pts : pts.reverse(), new THREE.Vector3(s, 0, 0), MAT.PAINT, R.solid.white);
  }
  if (near) {
    box(b, 0, 0.55, zT - 0.03, 2.0, 0.1, 0.06, MAT.PLASTIC, R.solid.black);
    for (const s of [1, -1]) box(b, s * 0.6, 0.78, zT - 0.05, 0.06, 0.42, 0.06, MAT.PLASTIC, R.solid.black);
    box(b, 0, 0.7, zT - 0.02, 0.42, 0.2, 0.02, MAT.PLASTIC, R.solid.black);
    exteriorQuad(b, [[0.16, 0.62, zT - 0.005], [-0.16, 0.62, zT - 0.005], [-0.16, 0.78, zT - 0.005], [0.16, 0.78, zT - 0.005]], MAT.PLATE, R.plateRear, 0, [[1, 0], [0, 0], [0, 1], [1, 1]]);
    box(b, 0, 0.9, zT - 0.02, 2.0, 0.16, 0.03, MAT.PLASTIC, R.solid.black);
    for (const s of [1, -1]) {
      lensQuad(b, s, s * 0.98, s * 0.76, 0.85, 0.98, zT - 0.004, MAT.LENS, R.taillight, LIGHT.TAIL, [[0, 0], [0.55, 0], [0.55, 1], [0, 1]]);
      lensQuad(b, s, s * 0.74, s * 0.62, 0.85, 0.98, zT - 0.004, MAT.LENS, R.solid.lens, LIGHT.REVERSE);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------------------------------------
export interface VehicleGeometry {
  opaque: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  wheelPivots: [number, number, number][];
  triangles: number;
}

export function buildVehicleGeometry(spec: VehicleSpec): VehicleGeometry {
  const p = bodyParams(spec);
  const out: Partial<VehicleGeometry> = {};
  const wheelPivots: [number, number, number][] = [];
  for (const detail of ['near', 'far'] as Detail[]) {
    const near = detail === 'near';
    const b = new GeoBuilder();
    const glass = near ? new GeoBuilder() : null;
    if (spec.style === 'bus') buildBus(b, glass, spec, detail);
    else if (spec.style === 'cabover') {
      buildCabover(b, glass, spec, p, detail);
      buildBox(b, spec, detail);
    } else {
      const decal = spec.livery === 'taxi' || spec.livery === 'borotaxi' || spec.livery === 'nypd';
      buildTub(b, spec, p, detail, decal);
      buildGreenhouse(b, glass ?? b, spec, p, detail);
      buildBumper(b, spec, p, 'front', detail);
      buildBumper(b, spec, p, 'rear', detail);
      buildLights(b, glass, spec, p, detail);
      buildFrontFace(b, spec, p, detail);
      buildRearFace(b, spec, p, detail);
      if (near) {
        buildInterior(b, glass, spec, p);
        buildExterior(b, spec, p);
      }
      buildRoofGear(b, spec, p, detail);
      if (spec.style === 'garbage') buildCargo(b, spec, p, detail);
    }

    // wheels: instanced per vehicle via aWheel tag (index 0 FL, 1 FR, 2 RL, 3 RR)
    const wheel = new GeoBuilder();
    buildWheel(wheel, spec, detail);
    const zf = -spec.wheelbase / 2, zr = spec.wheelbase / 2;
    const hx = spec.track / 2;
    const places: { x: number; z: number; i: number; extra?: number }[] = [
      { x: -hx, z: zf, i: 0 },
      { x: hx, z: zf, i: 1 },
      { x: -hx, z: zr, i: 2 },
      { x: hx, z: zr, i: 3 },
    ];
    if (spec.dualRear) {
      places.push({ x: -hx + spec.tireWidth + 0.02, z: zr, i: 2, extra: 1 }, { x: hx - spec.tireWidth - 0.02, z: zr, i: 3, extra: 1 });
    }
    if (detail === 'near') wheelPivots.length = 0;
    for (const pl of places) {
      // Stationary, matte backing inside the arch; no body-loft changes. It sits behind
      // the inner tire and prevents bright road/sky from leaking through the wheel well.
      if (!pl.extra) {
        const well = new GeoBuilder(), radius = archRadius(spec);
        lathe(well, [{ r: radius, x: 0 }, { r: 0, x: 0 }], near ? 24 : 12, MAT.PLASTIC, R.solid.black);
        const side = Math.sign(pl.x);
        const wellMatrix = new THREE.Matrix4().makeTranslation(pl.x - side * (spec.tireWidth / 2 + 0.025), spec.wheelRadius, pl.z);
        if (side < 0) wellMatrix.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
        // Clip below the tire contact plane; a circular well must not penetrate the road.
        for (let i = 1; i < well.pos.length; i += 3) well.pos[i] = Math.max(-spec.wheelRadius + 0.04, well.pos[i]);
        b.append(well, wellMatrix);
      }
      const mtx = new THREE.Matrix4().makeTranslation(pl.x, spec.wheelRadius, pl.z);
      if (pl.x < 0) mtx.multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
      const tagged = new GeoBuilder();
      tagged.wheelTag = [pl.x, spec.wheelRadius, pl.z, pl.i + 1];
      tagged.append(wheel);
      // pivot already in local wheel space (0,0,0) -> after transform becomes (x, r, z); set explicitly
      for (let i = 0; i < tagged.count; i++) {
        tagged.wheel[i * 4] = pl.x;
        tagged.wheel[i * 4 + 1] = spec.wheelRadius;
        tagged.wheel[i * 4 + 2] = pl.z;
        tagged.wheel[i * 4 + 3] = pl.i + 1;
      }
      b.append(tagged, mtx);
      // append() re-transforms the pivot with the matrix; restore the intended world pivot
      for (let i = b.count - tagged.count; i < b.count; i++) {
        b.wheel[i * 4] = pl.x;
        b.wheel[i * 4 + 1] = spec.wheelRadius;
        b.wheel[i * 4 + 2] = pl.z;
      }
      if (detail === 'near' && pl.i === wheelPivots.length) wheelPivots.push([pl.x, spec.wheelRadius, pl.z]);
    }
    if (near) {
      out.opaque = b.toGeometry();
      out.glass = glass!.toGeometry();
      out.triangles = b.idx.length / 3 + glass!.idx.length / 3;
    } else out.far = b.toGeometry();
  }
  return { opaque: out.opaque!, glass: out.glass!, far: out.far!, wheelPivots, triangles: out.triangles! };
}
