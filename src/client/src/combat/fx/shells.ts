/**
 * Ejected casings: one InstancedMesh (brass 9 mm / 5.56 casings, red 12-ga hulls with a brass head) simulated
 * on the CPU with gravity, a couple of ground bounces and a slow fade. Two instance slots per shell (body + head).
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';

const MAX = 48;
const LIFE = 9;
const G = 9.81;

interface Shell {
  active: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
  ang: THREE.Vector3; // angular velocity axis*rate
  born: number;
  r: number;
  len: number;
  headR: number;
  headLen: number;
  bounces: number;
  rest: boolean;
  bodyColor: THREE.Color;
  headColor: THREE.Color;
}

const BRASS = new THREE.Color(0xc9a84c);
const RED = new THREE.Color(0xb3231f);
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _off = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _hp = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

export class Shells {
  mesh: THREE.InstancedMesh;
  private list: Shell[] = [];
  private t = 0;
  private ground: (x: number, z: number) => number;

  constructor(ctx: GameContext) {
    const geo = new THREE.CylinderGeometry(0.86, 1, 1, 10, 1, false);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.32 });
    mat.name = 'shells';
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX * 2);
    this.mesh.name = 'combat-shells';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX * 2; i++) {
      this.mesh.setMatrixAt(i, _zero);
      this.mesh.setColorAt(i, BRASS);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = MAX * 2;
    for (let i = 0; i < MAX; i++) this.list.push({ active: false, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), ang: new THREE.Vector3(), born: 0, r: 0.005, len: 0.02, headR: 0, headLen: 0, bounces: 0, rest: false, bodyColor: new THREE.Color(), headColor: new THREE.Color() });
    this.ground = (x, z) => ctx.physics.groundHeight(x, z);
  }

  /** eject from `pos` with the weapon's right/up vectors; kind picks the casing */
  eject(pos: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, back: THREE.Vector3, kind: 'pistol' | 'rifle' | 'shotgun'): void {
    let s = this.list.find((x) => !x.active) ?? this.list.reduce((o, x) => (x.born < o.born ? x : o), this.list[0]);
    s.active = true;
    s.p.copy(pos);
    const spd = 2.6 + Math.random() * 1.6;
    s.v.copy(right).multiplyScalar(spd).addScaledVector(up, 1.6 + Math.random() * 1.2).addScaledVector(back, 0.4 + Math.random() * 0.6);
    s.v.x += (Math.random() - 0.5) * 0.6;
    s.v.z += (Math.random() - 0.5) * 0.6;
    s.q.setFromUnitVectors(_up, _axis.copy(right).addScaledVector(back, 0.4).normalize());
    s.ang.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(18 + Math.random() * 25);
    s.born = this.t;
    s.bounces = 0;
    s.rest = false;
    if (kind === 'shotgun') {
      s.r = 0.0098; s.len = 0.058; s.headR = 0.0105; s.headLen = 0.013;
      s.bodyColor.copy(RED); s.headColor.copy(BRASS);
    } else if (kind === 'rifle') {
      s.r = 0.0047; s.len = 0.045; s.headR = 0; s.headLen = 0;
      s.bodyColor.copy(BRASS); s.headColor.copy(BRASS);
    } else {
      s.r = 0.00495; s.len = 0.0193; s.headR = 0; s.headLen = 0;
      s.bodyColor.copy(BRASS); s.headColor.copy(BRASS);
    }
  }

  update(dt: number, t: number): void {
    this.t = t;
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const s = this.list[i];
      const bi = i * 2, hi = i * 2 + 1;
      if (!s.active) continue;
      const age = t - s.born;
      if (age > LIFE) {
        s.active = false;
        this.mesh.setMatrixAt(bi, _zero);
        this.mesh.setMatrixAt(hi, _zero);
        any = true;
        continue;
      }
      any = true;
      if (!s.rest) {
        s.v.y -= G * dt;
        s.p.addScaledVector(s.v, dt);
        const rate = s.ang.length();
        if (rate > 1e-3) {
          _axis.copy(s.ang).divideScalar(rate);
          _dq.setFromAxisAngle(_axis, rate * dt);
          s.q.premultiply(_dq);
        }
        const gy = this.ground(s.p.x, s.p.z) + s.r;
        if (s.p.y < gy) {
          s.p.y = gy;
          s.bounces++;
          if (s.bounces >= 3 || Math.abs(s.v.y) < 0.6) {
            s.rest = true;
            s.v.set(0, 0, 0);
            // lie flat: cylinder axis horizontal, random heading
            const a = Math.random() * Math.PI * 2;
            s.q.setFromUnitVectors(_up, _axis.set(Math.cos(a), 0, Math.sin(a)));
          } else {
            s.v.y = -s.v.y * 0.32;
            s.v.x *= 0.55;
            s.v.z *= 0.55;
            s.ang.multiplyScalar(0.45);
          }
        }
      }
      const fade = age > LIFE - 1.5 ? Math.max(0, (LIFE - age) / 1.5) : 1;
      _s.set(s.r * fade, s.len * fade, s.r * fade);
      _m.compose(s.p, s.q, _s);
      this.mesh.setMatrixAt(bi, _m);
      this.mesh.setColorAt(bi, s.bodyColor);
      if (s.headR > 0) {
        // head sits at the base (-Y end) of the body
        _off.set(0, -(s.len / 2 + s.headLen / 2 - 0.001), 0).applyQuaternion(s.q);
        _hp.copy(s.p).add(_off);
        _s.set(s.headR * fade, s.headLen * fade, s.headR * fade);
        _m.compose(_hp, s.q, _s);
        this.mesh.setMatrixAt(hi, _m);
        this.mesh.setColorAt(hi, s.headColor);
      } else this.mesh.setMatrixAt(hi, _zero);
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
