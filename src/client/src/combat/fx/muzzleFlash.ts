/**
 * Muzzle flashes: a 3-frame flipbook (starburst for the first ~18 ms, a smaller burst until ~40 ms, a dim orange
 * ember until ~70 ms) drawn as one
 * camera-facing quad at the muzzle plus two crossed axial quads (the flame along the bore), all in a single
 * dynamic geometry (1 additive draw call), and a fixed pool of PointLights that never leaves the scene (adding /
 * removing lights would recompile every material) — idle lights sit at intensity 0.
 */
import * as THREE from 'three';
import { isIOS } from '@/core/quality';
import type { GameContext } from '@/core/context';
import { makeFlashFlipbook } from '../textures';

interface Flash {
  active: boolean;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  born: number;
  size: number;
  length: number;
  roll: number;
  light: THREE.PointLight | null;
  lightBase: number;
}

const MAX = 8;
const FRAME0 = 0.018;
const FRAME1 = 0.04;
const LIFE = 0.07;
const _toCam = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _c = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _any = new THREE.Vector3();

export class MuzzleFlashes {
  mesh: THREE.Mesh;
  lights: THREE.PointLight[] = [];
  private list: Flash[] = [];
  private pos: Float32Array;
  private uv: Float32Array;
  private col: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private uvAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private tex: THREE.Texture;
  private t = 0;
  private lightRR = 0;

  constructor(ctx: GameContext) {
    const quads = MAX * 3;
    this.pos = new Float32Array(quads * 12);
    this.uv = new Float32Array(quads * 8);
    this.col = new Float32Array(quads * 12);
    const idx = new Uint16Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.uvAttr = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('uv', this.uvAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.tex = makeFlashFlipbook();
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    mat.name = 'muzzleFlash';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 23;
    this.mesh.name = 'combat-muzzleflash';
    for (let i = 0; i < MAX; i++) this.list.push({ active: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), born: 0, size: 0.25, length: 0.4, roll: 0, light: null, lightBase: 0 });
    // Adding a light after city startup recompiles every lit material, even at intensity zero.
    const nLights = isIOS() ? 0 : (ctx.quality.level === 'low' || ctx.quality.level === 'mobile') ? 1 : 2;
    for (let i = 0; i < nLights; i++) {
      const l = new THREE.PointLight(0xffa64d, 0, 7, 2);
      l.name = `muzzle-light-${i}`;
      l.castShadow = false;
      l.visible = true;
      this.lights.push(l);
    }
  }

  /** size ~ weapon class: pistol 0.22, smg 0.26, rifle 0.32, shotgun 0.42 */
  add(pos: THREE.Vector3, dir: THREE.Vector3, size: number, lightIntensity: number): void {
    let f = this.list.find((x) => !x.active) ?? this.list.reduce((o, x) => (x.born < o.born ? x : o), this.list[0]);
    if (f.light) {
      f.light.intensity = 0;
      f.light = null;
    }
    f.active = true;
    f.pos.copy(pos);
    f.dir.copy(dir).normalize();
    f.born = this.t;
    f.size = size * 1.15 * (0.85 + Math.random() * 0.3);
    f.length = size * 1.5 * (0.8 + Math.random() * 0.5);
    f.roll = Math.random() * Math.PI * 2;
    if (this.lights.length && lightIntensity > 0) {
      const l = this.lights[this.lightRR++ % this.lights.length];
      for (const o of this.list) if (o.light === l) o.light = null;
      f.light = l;
      f.lightBase = lightIntensity;
      l.position.copy(pos).addScaledVector(f.dir, 0.25);
      l.intensity = lightIntensity;
    }
  }

  private quad(q: number, c: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, frame: number, k: number): void {
    const o = q * 12;
    const p = this.pos;
    // corners: c - ax - ay, c + ax - ay, c + ax + ay, c - ax + ay
    p[o] = c.x - ax.x - ay.x; p[o + 1] = c.y - ax.y - ay.y; p[o + 2] = c.z - ax.z - ay.z;
    p[o + 3] = c.x + ax.x - ay.x; p[o + 4] = c.y + ax.y - ay.y; p[o + 5] = c.z + ax.z - ay.z;
    p[o + 6] = c.x + ax.x + ay.x; p[o + 7] = c.y + ax.y + ay.y; p[o + 8] = c.z + ax.z + ay.z;
    p[o + 9] = c.x - ax.x + ay.x; p[o + 10] = c.y - ax.y + ay.y; p[o + 11] = c.z - ax.z + ay.z;
    const u0 = frame / 3, u1 = u0 + 1 / 3;
    this.uv.set([u0, 0, u1, 0, u1, 1, u0, 1], q * 8);
    const cc = this.col;
    for (let i = 0; i < 4; i++) {
      cc[o + i * 3] = k;
      cc[o + i * 3 + 1] = k;
      cc[o + i * 3 + 2] = k;
    }
  }

  update(t: number, camPos: THREE.Vector3): void {
    this.t = t;
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const f = this.list[i];
      const q = i * 3;
      if (!f.active) {
        this.pos.fill(0, q * 12, q * 12 + 36);
        continue;
      }
      const age = t - f.born;
      if (age > LIFE) {
        f.active = false;
        if (f.light) {
          f.light.intensity = 0;
          f.light = null;
        }
        this.pos.fill(0, q * 12, q * 12 + 36);
        continue;
      }
      any = true;
      const frame = age < FRAME0 ? 0 : age < FRAME1 ? 1 : 2;
      const k = frame === 0 ? 2.4 : frame === 1 ? 1.6 : 0.9;
      const sz = f.size * (frame === 0 ? 1 : frame === 1 ? 0.85 : 0.55);
      const ln = f.length * (frame === 2 ? 0.6 : 1);
      if (f.light) f.light.intensity = f.lightBase * Math.max(0, 1 - age / LIFE) * (frame === 0 ? 1 : frame === 1 ? 0.6 : 0.25);
      // billboard at the muzzle (slightly forward)
      _c.copy(f.pos).addScaledVector(f.dir, sz * 0.25);
      _toCam.subVectors(camPos, _c).normalize();
      _any.set(0, 1, 0);
      if (Math.abs(_toCam.y) > 0.95) _any.set(1, 0, 0);
      _r.crossVectors(_any, _toCam).normalize();
      _u.crossVectors(_toCam, _r).normalize();
      const cr = Math.cos(f.roll), sr = Math.sin(f.roll);
      _tmp.copy(_r).multiplyScalar(cr).addScaledVector(_u, sr).multiplyScalar(sz * 0.5);
      _u.multiplyScalar(cr).addScaledVector(_r, -sr).multiplyScalar(sz * 0.5);
      this.quad(q, _c, _tmp, _u, frame, k);
      // two crossed axial quads: along dir, half-width across, extending forward from the muzzle
      _any.set(0, 1, 0);
      if (Math.abs(f.dir.y) > 0.95) _any.set(1, 0, 0);
      _r.crossVectors(_any, f.dir).normalize();
      _u.crossVectors(f.dir, _r).normalize();
      const roll2 = f.roll * 0.5;
      const c2 = Math.cos(roll2), s2 = Math.sin(roll2);
      _tmp.copy(_r).multiplyScalar(c2).addScaledVector(_u, s2);
      _u.multiplyScalar(c2).addScaledVector(_r, -s2);
      _c.copy(f.pos).addScaledVector(f.dir, ln * 0.5);
      _r.copy(f.dir).multiplyScalar(ln * 0.5);
      _tmp.multiplyScalar(sz * 0.42);
      _u.multiplyScalar(sz * 0.42);
      this.quad(q + 1, _c, _r, _tmp, frame, k * 0.8);
      this.quad(q + 2, _c, _r, _u, frame, k * 0.8);
    }
    this.mesh.visible = any;
    if (any) {
      this.posAttr.needsUpdate = true;
      this.uvAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.tex.dispose();
    this.mesh.removeFromParent();
    for (const l of this.lights) l.removeFromParent();
  }
}
