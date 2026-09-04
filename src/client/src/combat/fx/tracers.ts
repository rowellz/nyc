/**
 * Tracers (rifle / SMG only, subtle): for each shot a faint full-length quad along the ray (60 ms) plus a short streak that travels
 * the ray at ~380 m/s (what actually reads as a bullet). All tracers live in one dynamic BufferGeometry
 * (camera-facing ribbons rebuilt each frame) drawn additively with vertex-color intensity: 1 draw call.
 */
import * as THREE from 'three';
import { makeTracerTexture } from '../textures';

interface Tracer {
  active: boolean;
  a: THREE.Vector3;
  b: THREE.Vector3;
  len: number;
  born: number;
  intensity: number;
}

const MAX = 32;
const RAY_LIFE = 0.06;
const STREAK_SPEED = 380;
const STREAK_LEN = 5;

const _d = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _mid = new THREE.Vector3();

export class Tracers {
  mesh: THREE.Mesh;
  private list: Tracer[] = [];
  private pos: Float32Array;
  private col: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private tex: THREE.Texture;
  private t = 0;

  constructor() {
    const quads = MAX * 2;
    this.pos = new Float32Array(quads * 4 * 3);
    this.col = new Float32Array(quads * 4 * 3);
    const uv = new Float32Array(quads * 4 * 2);
    const idx = new Uint16Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], q * 8);
      const v = q * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.tex = makeTracerTexture();
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true, toneMapped: true });
    mat.name = 'tracers';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    this.mesh.name = 'combat-tracers';
    for (let i = 0; i < MAX; i++) this.list.push({ active: false, a: new THREE.Vector3(), b: new THREE.Vector3(), len: 0, born: 0, intensity: 1 });
  }

  add(from: THREE.Vector3, to: THREE.Vector3, intensity = 1): void {
    let slot = this.list.find((t) => !t.active);
    if (!slot) {
      slot = this.list.reduce((o, t) => (t.born < o.born ? t : o), this.list[0]);
    }
    slot.active = true;
    slot.a.copy(from);
    slot.b.copy(to);
    slot.len = from.distanceTo(to);
    slot.born = this.t;
    slot.intensity = intensity;
  }

  private writeQuad(q: number, p0: THREE.Vector3, p1: THREE.Vector3, halfW: THREE.Vector3, r: number, g: number, b: number): void {
    const o = q * 12;
    const p = this.pos;
    p[o] = p0.x - halfW.x; p[o + 1] = p0.y - halfW.y; p[o + 2] = p0.z - halfW.z;
    p[o + 3] = p1.x - halfW.x; p[o + 4] = p1.y - halfW.y; p[o + 5] = p1.z - halfW.z;
    p[o + 6] = p1.x + halfW.x; p[o + 7] = p1.y + halfW.y; p[o + 8] = p1.z + halfW.z;
    p[o + 9] = p0.x + halfW.x; p[o + 10] = p0.y + halfW.y; p[o + 11] = p0.z + halfW.z;
    const c = this.col;
    for (let k = 0; k < 4; k++) {
      c[o + k * 3] = r;
      c[o + k * 3 + 1] = g;
      c[o + k * 3 + 2] = b;
    }
  }

  private clearQuad(q: number): void {
    this.pos.fill(0, q * 12, q * 12 + 12);
  }

  update(t: number, camPos: THREE.Vector3): void {
    this.t = t;
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const tr = this.list[i];
      const q0 = i * 2, q1 = i * 2 + 1;
      if (!tr.active) {
        this.clearQuad(q0);
        this.clearQuad(q1);
        continue;
      }
      const age = t - tr.born;
      const travel = age * STREAK_SPEED;
      const streakDone = travel - STREAK_LEN > tr.len;
      if (age > RAY_LIFE && streakDone) {
        tr.active = false;
        this.clearQuad(q0);
        this.clearQuad(q1);
        continue;
      }
      any = true;
      _d.subVectors(tr.b, tr.a).normalize();
      _mid.addVectors(tr.a, tr.b).multiplyScalar(0.5);
      _toCam.subVectors(camPos, _mid);
      const dist = _toCam.length();
      _toCam.divideScalar(dist || 1);
      _w.crossVectors(_d, _toCam).normalize();
      // full-ray faint quad
      if (age <= RAY_LIFE) {
        const k = (1 - age / RAY_LIFE) * 0.2 * tr.intensity;
        _w.multiplyScalar(0.01 + dist * 0.0005);
        this.writeQuad(q0, tr.a, tr.b, _w, k, k * 0.92, k * 0.7);
        _w.normalize();
      } else this.clearQuad(q0);
      // travelling streak
      if (!streakDone) {
        const s1 = Math.min(tr.len, travel);
        const s0 = Math.max(0, travel - STREAK_LEN);
        if (s1 > s0 + 0.05) {
          _p0.copy(tr.a).addScaledVector(_d, s0);
          _p1.copy(tr.a).addScaledVector(_d, s1);
          _toCam.subVectors(camPos, _p1);
          const d2 = _toCam.length();
          const k = 1.15 * tr.intensity;
          _w.multiplyScalar(0.016 + d2 * 0.0009);
          this.writeQuad(q1, _p0, _p1, _w, k, k * 0.85, k * 0.55);
        } else this.clearQuad(q1);
      } else this.clearQuad(q1);
    }
    this.mesh.visible = any;
    if (any) {
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.tex.dispose();
    this.mesh.removeFromParent();
  }
}
