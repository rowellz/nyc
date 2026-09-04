/**
 * Surface-specific impact effects built from the particle system + decals. Every hit gets a brief bright
 * "contact flash" so it reads from 20 m, then material-specific debris and a persistent decal:
 *  concrete/masonry ('building', 'unknown', 'concrete', 'brick'): pale dust puff + stone chips + dark bullet hole
 *  asphalt ('ground', 'deck', 'asphalt', 'road'): sparks + dark dust + small hole
 *  metal ('prop', 'metal', 'vehicle', 'lamp', 'signal'): bright sparks + faint smoke + a paint-chip scuff (no hole)
 *  wood ('wood', 'tree', 'bench', 'fence'): pale splinters + light dust + a torn light crater
 *  glass: nothing; water: white splash puff; grass/dirt: brown puff + clods
 *  player: blood mist + droplets + a blood decal on the ground below
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { ParticleSystem, PKind } from './particles';
import { Decals, DecalKind } from './decals';

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _refl = new THREE.Vector3();
const _n = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Vector3();

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export class Impacts {
  private t = 0;
  constructor(private ctx: GameContext, readonly particles: ParticleSystem, readonly decals: Decals) {}

  update(t: number): void {
    this.t = t;
  }

  /** dir = incoming bullet direction (normalized) */
  hit(surface: string, point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, scale = 1): void {
    switch (surface) {
      case 'glass':
        return;
      case 'player':
        this.blood(point, dir, scale);
        return;
      case 'water':
        this.splash(point);
        return;
      case 'prop':
      case 'metal':
      case 'vehicle':
      case 'lamp':
      case 'signal':
        this.metal(point, normal, dir, scale);
        return;
      case 'wood':
      case 'tree':
      case 'bench':
      case 'fence':
        this.wood(point, normal, dir, scale);
        return;
      case 'ground':
      case 'deck':
      case 'asphalt':
      case 'road':
        this.asphalt(point, normal, dir, scale);
        return;
      case 'grass':
      case 'dirt':
        this.dirt(point, normal, dir, scale);
        return;
      default:
        this.concrete(point, normal, dir, scale);
    }
  }

  private reflect(dir: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 {
    return _refl.copy(dir).addScaledVector(normal, -2 * dir.dot(normal));
  }

  /** the instant of contact: a small hot flash that makes even a far hit legible for two frames */
  private contactFlash(point: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    _p.copy(point).addScaledVector(normal, 0.04);
    this.particles.emit(PKind.spark, _p, _zero, { life: 0.12, size, sizeEnd: size * 0.35, alpha: 0.9 });
  }

  concrete(point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, scale: number): void {
    const ps = this.particles;
    this.contactFlash(point, normal, 0.22 * scale);
    // dust: pale warm grey, expands fast then hangs and drifts along the normal
    for (let i = 0; i < 8; i++) {
      _v.copy(normal).multiplyScalar(rnd(0.9, 2.4)).add(_p.set(rnd(-0.9, 0.9), rnd(-0.2, 1.0), rnd(-0.9, 0.9)));
      _p.copy(point).addScaledVector(normal, 0.04);
      ps.emit(PKind.dust, _p, _v, { life: rnd(0.6, 1.1), size: 0.28 * scale, sizeEnd: rnd(0.65, 1.0) * scale, color: 0xa8a297, alpha: 0.85, drag: 4.5, gravity: -0.12 });
    }
    // chips: darker, fast, bounce-ish arcs
    const r = this.reflect(dir, normal);
    for (let i = 0; i < 8; i++) {
      _v.copy(r).multiplyScalar(rnd(1.5, 4.5)).addScaledVector(normal, rnd(0.5, 3)).add(_p.set(rnd(-1.5, 1.5), rnd(-0.5, 1.5), rnd(-1.5, 1.5)));
      _p.copy(point).addScaledVector(normal, 0.02);
      ps.emit(PKind.chip, _p, _v, { life: rnd(0.4, 0.9), size: rnd(0.012, 0.032) * scale, color: 0x6a655d, gravity: 9.81, drag: 0.6 });
    }
    // a tiny hot spark on masonry (rebar / aggregate) now and then
    if (Math.random() < 0.4) {
      _v.copy(r).multiplyScalar(rnd(3, 6)).add(_p.set(rnd(-1, 1), rnd(0, 2), rnd(-1, 1)));
      ps.emit(PKind.spark, point, _v, { life: rnd(0.15, 0.3), size: 0.05, sizeEnd: 0.02, gravity: 9.81 });
    }
    this.decals.add(DecalKind.bulletHole, point, normal, rnd(0.1, 0.14) * scale, this.t);
  }

  asphalt(point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, scale: number): void {
    const ps = this.particles;
    const r = this.reflect(dir, normal);
    this.contactFlash(point, normal, 0.12 * scale);
    for (let i = 0; i < 5; i++) {
      _v.copy(r).multiplyScalar(rnd(3, 7)).addScaledVector(normal, rnd(0.5, 2)).add(_p.set(rnd(-1.5, 1.5), rnd(0, 1.5), rnd(-1.5, 1.5)));
      ps.emit(PKind.spark, point, _v, { life: rnd(0.12, 0.3), size: rnd(0.04, 0.07), sizeEnd: 0.02, gravity: 9.81 });
    }
    for (let i = 0; i < 6; i++) {
      _v.copy(normal).multiplyScalar(rnd(0.7, 1.8)).add(_p.set(rnd(-0.7, 0.7), rnd(0, 0.7), rnd(-0.7, 0.7)));
      _p.copy(point).addScaledVector(normal, 0.03);
      ps.emit(PKind.dust, _p, _v, { life: rnd(0.5, 0.9), size: 0.16 * scale, sizeEnd: rnd(0.5, 0.75) * scale, color: 0x6e6a64, alpha: 0.8, drag: 4, gravity: -0.1 });
    }
    for (let i = 0; i < 4; i++) {
      _v.copy(r).multiplyScalar(rnd(1, 3)).addScaledVector(normal, rnd(1, 2.5)).add(_p.set(rnd(-1, 1), 0, rnd(-1, 1)));
      ps.emit(PKind.chip, point, _v, { life: rnd(0.3, 0.7), size: rnd(0.01, 0.022), color: 0x2c2b29, gravity: 9.81, drag: 0.5 });
    }
    this.decals.add(DecalKind.bulletHole, point, normal, rnd(0.08, 0.11) * scale, this.t, 0xffffff, 0.85);
  }

  dirt(point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, scale: number): void {
    const ps = this.particles;
    for (let i = 0; i < 7; i++) {
      _v.copy(normal).multiplyScalar(rnd(1.0, 2.5)).add(_p.set(rnd(-0.8, 0.8), rnd(0, 0.8), rnd(-0.8, 0.8)));
      _p.copy(point).addScaledVector(normal, 0.03);
      ps.emit(PKind.dust, _p, _v, { life: rnd(0.5, 0.9), size: 0.1 * scale, sizeEnd: rnd(0.35, 0.55) * scale, color: 0x5e4a33, alpha: 0.85, drag: 4, gravity: 0.5 });
    }
    for (let i = 0; i < 7; i++) {
      _v.copy(normal).multiplyScalar(rnd(2, 4)).add(_p.set(rnd(-1.5, 1.5), 0, rnd(-1.5, 1.5)));
      ps.emit(PKind.chip, point, _v, { life: rnd(0.4, 0.8), size: rnd(0.012, 0.028), color: 0x3d2f20, gravity: 9.81, drag: 0.6 });
    }
    void dir;
  }

  metal(point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, scale: number): void {
    const ps = this.particles;
    const r = this.reflect(dir, normal);
    for (let i = 0; i < 14; i++) {
      _v.copy(r).multiplyScalar(rnd(3, 9)).addScaledVector(normal, rnd(0, 2)).add(_p.set(rnd(-2, 2), rnd(-0.5, 2), rnd(-2, 2)));
      ps.emit(PKind.spark, point, _v, { life: rnd(0.15, 0.5), size: rnd(0.04, 0.085) * scale, sizeEnd: 0.015, gravity: 9.81, drag: 0.3 });
    }
    _v.copy(normal).multiplyScalar(0.5).add(_p.set(0, 0.4, 0));
    _p.copy(point).addScaledVector(normal, 0.03);
    ps.emit(PKind.smoke, _p, _v, { life: 0.8, size: 0.06, sizeEnd: 0.32, color: 0x6b6b6b, alpha: 0.4, drag: 3 });
    // the ring: a hot core for two frames
    this.contactFlash(point, normal, 0.22 * scale);
    // paint scuffed off to bare metal; no hole
    this.decals.add(DecalKind.paint, point, normal, rnd(0.07, 0.1) * scale, this.t, 0xffffff, 0.95);
  }

  wood(point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, scale: number): void {
    const ps = this.particles;
    const r = this.reflect(dir, normal);
    this.contactFlash(point, normal, 0.1 * scale);
    // splinters: pale, long-lived, tumbling
    for (let i = 0; i < 9; i++) {
      _v.copy(r).multiplyScalar(rnd(1.5, 4)).addScaledVector(normal, rnd(0.8, 3)).add(_p.set(rnd(-1.5, 1.5), rnd(0, 1.5), rnd(-1.5, 1.5)));
      _p.copy(point).addScaledVector(normal, 0.02);
      ps.emit(PKind.chip, _p, _v, { life: rnd(0.5, 1.1), size: rnd(0.015, 0.04) * scale, color: 0xc9a878, gravity: 9.81, drag: 0.8 });
    }
    for (let i = 0; i < 4; i++) {
      _v.copy(normal).multiplyScalar(rnd(0.6, 1.4)).add(_p.set(rnd(-0.5, 0.5), rnd(0, 0.6), rnd(-0.5, 0.5)));
      _p.copy(point).addScaledVector(normal, 0.03);
      ps.emit(PKind.dust, _p, _v, { life: rnd(0.4, 0.7), size: 0.07 * scale, sizeEnd: rnd(0.25, 0.4) * scale, color: 0xb59a74, alpha: 0.6, drag: 4, gravity: 0.2 });
    }
    this.decals.add(DecalKind.wood, point, normal, rnd(0.09, 0.13) * scale, this.t);
  }

  blood(point: THREE.Vector3, dir: THREE.Vector3, scale: number): void {
    const ps = this.particles;
    // mist: dark red, hangs briefly
    for (let i = 0; i < 5; i++) {
      _v.copy(dir).multiplyScalar(rnd(0.3, 1.2)).add(_p.set(rnd(-0.5, 0.5), rnd(-0.2, 0.5), rnd(-0.5, 0.5)));
      ps.emit(PKind.blood, point, _v, { life: rnd(0.35, 0.65), size: 0.09 * scale, sizeEnd: rnd(0.3, 0.45) * scale, color: 0x6a0a0a, alpha: 0.6, drag: 5 });
    }
    // droplets: carry on through, fall
    for (let i = 0; i < 10; i++) {
      _v.copy(dir).multiplyScalar(rnd(1.5, 4)).add(_p.set(rnd(-1.5, 1.5), rnd(-0.5, 1.5), rnd(-1.5, 1.5)));
      ps.emit(PKind.blood, point, _v, { life: rnd(0.3, 0.6), size: rnd(0.02, 0.05) * scale, sizeEnd: 0.015, color: 0x7d0f0f, gravity: 9.81, drag: 1.2 });
    }
    // pool on the ground below
    const gy = this.ctx.physics.groundHeight(point.x, point.z);
    if (point.y - gy < 2.5) {
      _p.set(point.x + dir.x * 0.4 + rnd(-0.15, 0.15), gy, point.z + dir.z * 0.4 + rnd(-0.15, 0.15));
      this.decals.add(DecalKind.blood, _p, _n, rnd(0.35, 0.6) * scale, this.t, 0xffffff, 0.9);
    }
  }

  splash(point: THREE.Vector3): void {
    const ps = this.particles;
    for (let i = 0; i < 8; i++) {
      _v.set(rnd(-1, 1), rnd(1.5, 3.5), rnd(-1, 1));
      ps.emit(PKind.dust, point, _v, { life: rnd(0.4, 0.7), size: 0.05, sizeEnd: 0.25, color: 0xdfe8ee, alpha: 0.7, gravity: 6, drag: 1 });
    }
  }

  /** grey puff + a rolling wisp from the muzzle after a shot (amount = weapon class, 1..3) */
  muzzleSmoke(pos: THREE.Vector3, dir: THREE.Vector3, amount: number): void {
    const ps = this.particles;
    const n = amount + 1;
    for (let i = 0; i < n; i++) {
      _v.copy(dir).multiplyScalar(rnd(1.2, 2.8)).add(_p.set(rnd(-0.3, 0.3), rnd(0.35, 0.9), rnd(-0.3, 0.3)));
      _p.copy(pos).addScaledVector(dir, 0.08 + i * 0.1);
      ps.emit(PKind.smoke, _p, _v, { life: rnd(0.6, 1.1), size: 0.12, sizeEnd: rnd(0.3, 0.45) * (0.8 + amount * 0.15), color: 0x8a8580, alpha: 0.32, drag: 3.5 });
    }
  }
}
