/**
 * Small helpers shared by the combat module: seeded PRNG (identical to server/util.ts so shotgun pellet
 * patterns reproduce from (shooter id, seq)), ray/capsule tests matching the server's hit model, and a
 * cone-spread sampler.
 */
import * as THREE from 'three';

/** Same generator as the server (server/util.ts) — bit-exact so pellet spreads match. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ray vs sphere; t >= 0 (0 when starting inside) or -1. */
export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  if (c <= 0) return 0;
  if (b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : -1;
}

/** Ray vs capsule between sphere centers A and B with radius r (dir normalized). */
export function rayCapsule(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const aox = ox - ax, aoy = oy - ay, aoz = oz - az;
  const abab = abx * abx + aby * aby + abz * abz;
  const abd = abx * dx + aby * dy + abz * dz;
  const abao = abx * aox + aby * aoy + abz * aoz;
  const dao = dx * aox + dy * aoy + dz * aoz;
  const aoao = aox * aox + aoy * aoy + aoz * aoz;
  const a = abab - abd * abd;
  const b = abab * dao - abd * abao;
  const c = abab * (aoao - r * r) - abao * abao;
  let best = -1;
  if (a > 1e-9) {
    const disc = b * b - a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0) {
        const y = abao + t * abd;
        if (y >= 0 && y <= abab) best = t;
      } else if (c < 0) {
        if (abao >= 0 && abao <= abab) return 0;
      }
    }
  }
  const ta = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  if (ta >= 0 && (best < 0 || ta < best)) best = ta;
  const tb = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
  if (tb >= 0 && (best < 0 || tb < best)) best = tb;
  return best;
}

const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _up = new THREE.Vector3();

/** Orthonormal basis (right, up) around a normalized direction — same construction as the server's pellet spread. */
export function basisAround(d: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3): void {
  _up.set(Math.abs(d.y) < 0.99 ? 0 : 1, Math.abs(d.y) < 0.99 ? 1 : 0, 0);
  right.crossVectors(_up, d).normalize();
  up.crossVectors(d, right);
}

/** Rotate `dir` (normalized, in place) by a uniformly sampled offset within a cone of `halfAngleRad`. */
export function scatterInCone(dir: THREE.Vector3, halfAngleRad: number, rnd: () => number = Math.random): THREE.Vector3 {
  if (halfAngleRad <= 0) return dir;
  basisAround(dir, _r, _u);
  const ang = rnd() * Math.PI * 2;
  const rad = Math.sqrt(rnd()) * halfAngleRad;
  const sx = Math.cos(ang) * rad, sy = Math.sin(ang) * rad;
  dir.addScaledVector(_r, sx).addScaledVector(_u, sy).normalize();
  return dir;
}

/** The server's shotgun pellet pattern for (shooterId, seq): returns `pellets` normalized directions. */
export function pelletDirections(shooterId: number, seq: number, center: THREE.Vector3, spreadDeg: number, pellets: number, out: THREE.Vector3[]): THREE.Vector3[] {
  const rng = mulberry32((Math.imul(shooterId, 0x9e3779b1) ^ Math.imul(seq + 1, 0x85ebca6b)) >>> 0);
  basisAround(center, _r, _u);
  const spread = (spreadDeg * Math.PI) / 180;
  for (let i = 0; i < pellets; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * spread;
    const sx = Math.cos(ang) * rad, sy = Math.sin(ang) * rad;
    const v = out[i] ?? (out[i] = new THREE.Vector3());
    v.copy(center).addScaledVector(_r, sx).addScaledVector(_u, sy).normalize();
  }
  out.length = pellets;
  return out;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}
export function fmtClock(sec: number): string {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Dispose a whole subtree (geometries + materials, not shared textures). */
export function disposeObject(o: THREE.Object3D, materials = true): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (materials && m.material) {
      if (Array.isArray(m.material)) for (const mm of m.material) mm.dispose();
      else (m.material as THREE.Material).dispose();
    }
  });
}
