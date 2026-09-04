/**
 * Fleet: per kind, one near InstancedMesh (opaque) + one near glass InstancedMesh + one far InstancedMesh.
 * Every rendered vehicle (parked, traffic, remote, local) is an instance written each frame. Draw calls are
 * 3 per kind regardless of how many vehicles are on screen.
 */
import * as THREE from 'three';
import { isIOS } from '@/core/quality';
import { InstanceUpdates } from '../buildings/instanceUpdates';
import type { GameContext } from '@/core/context';
import { buildKindAtlas, type KindAtlas } from './atlas';
import { bodyParams, buildVehicleGeometry, decalZone, type VehicleGeometry } from './geometry';
import { KINDS, KIND_IDS, type VehicleSpec } from './kinds';
import { createGlassMaterial, createVehicleMaterial, type VehicleUniforms } from './materials';

export const NEAR_CAP = 200;
export const FAR_CAP = 1200;
export const NEAR_DIST = 140;
export const FAR_DIST = 520;

export interface InstanceWrite {
  matrix: THREE.Matrix4;
  color: THREE.Color;
  /** head, brake, sigL, sigR */
  lightA: [number, number, number, number];
  /** siren, reverse, roofSign, blink phase (written here from the instance colour, not by the caller) */
  lightB: [number, number, number, number];
  spin: number;
  steer: number;
  susp: [number, number, number, number];
}

export class KindPool {
  near: THREE.InstancedMesh;
  glass: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  nearCount = 0;
  farCount = 0;
  lightA: THREE.InstancedBufferAttribute;
  lightB: THREE.InstancedBufferAttribute;
  wheel: THREE.InstancedBufferAttribute;
  susp: THREE.InstancedBufferAttribute;
  farLightA: THREE.InstancedBufferAttribute;
  farLightB: THREE.InstancedBufferAttribute;
  farWheel: THREE.InstancedBufferAttribute;
  farSusp: THREE.InstancedBufferAttribute;
  triangles: number;
  private nearUpdates: InstanceUpdates[];
  private farUpdates: InstanceUpdates[];

  constructor(public spec: VehicleSpec, public geo: VehicleGeometry, public atlas: KindAtlas, opaque: THREE.MeshPhysicalMaterial, glass: THREE.MeshPhysicalMaterial, shadows: boolean, private nearCapacity = NEAR_CAP, private farCapacity = FAR_CAP) {
    this.triangles = geo.triangles;
    const mk = (g: THREE.BufferGeometry, m: THREE.Material, cap: number, name: string) => {
      const im = new THREE.InstancedMesh(g, m, cap);
      im.name = name;
      im.count = 0;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.matrixAutoUpdate = false;
      im.matrixWorldAutoUpdate = false;
      return im;
    };
    this.near = mk(geo.opaque, opaque, this.nearCapacity, `veh-${spec.id}-near`);
    this.glass = mk(geo.glass, glass, this.nearCapacity, `veh-${spec.id}-glass`);
    this.far = mk(geo.far, opaque, this.farCapacity, `veh-${spec.id}-far`);
    this.near.castShadow = shadows;
    this.near.receiveShadow = true;
    this.far.castShadow = shadows;
    this.far.receiveShadow = true;
    this.glass.castShadow = false;
    this.glass.receiveShadow = false;
    this.glass.renderOrder = 10;
    const attr = (cap: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.lightA = attr(this.nearCapacity);
    this.lightB = attr(this.nearCapacity);
    this.wheel = attr(this.nearCapacity);
    this.susp = attr(this.nearCapacity);
    this.farLightA = attr(this.farCapacity);
    this.farLightB = attr(this.farCapacity);
    this.farWheel = attr(this.farCapacity);
    this.farSusp = attr(this.farCapacity);
    // near + glass share the same per-instance attributes (same instance order)
    for (const im of [this.near, this.glass]) {
      im.geometry.setAttribute('iLightA', this.lightA);
      im.geometry.setAttribute('iLightB', this.lightB);
      im.geometry.setAttribute('iWheel', this.wheel);
      im.geometry.setAttribute('iSusp', this.susp);
    }
    this.far.geometry.setAttribute('iLightA', this.farLightA);
    this.far.geometry.setAttribute('iLightB', this.farLightB);
    this.far.geometry.setAttribute('iWheel', this.farWheel);
    this.far.geometry.setAttribute('iSusp', this.farSusp);
    // instance colours
    this.near.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.nearCapacity * 3).fill(1), 3);
    this.near.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.glass.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.nearCapacity * 3).fill(1), 3);
    this.far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.farCapacity * 3).fill(1), 3);
    this.far.instanceColor.setUsage(THREE.DynamicDrawUsage);
    // shared matrix buffer between near and glass: glass copies near's matrix attribute object
    this.glass.instanceMatrix = this.near.instanceMatrix;
    this.nearUpdates = [this.near.instanceMatrix, this.near.instanceColor!, this.lightA, this.lightB, this.wheel, this.susp].map(a => new InstanceUpdates(a));
    this.farUpdates = [this.far.instanceMatrix, this.far.instanceColor!, this.farLightA, this.farLightB, this.farWheel, this.farSusp].map(a => new InstanceUpdates(a));
  }

  begin(): void {
    this.nearCount = 0;
    this.farCount = 0;
  }

  write(w: InstanceWrite, near: boolean): void {
    const i = near ? this.nearCount : this.farCount;
    if (i >= (near ? this.nearCapacity : this.farCapacity)) return;
    if (near) this.nearCount++; else this.farCount++;
    const updates = near ? this.nearUpdates : this.farUpdates;
    updates[0].write(i * 16, w.matrix.elements);
    const color = updates[1], c = i * 3, q = i * 4;
    color.set(c, w.color.r); color.set(c + 1, w.color.g); color.set(c + 2, w.color.b);
    updates[2].write(q, w.lightA);
    // Turn-signal phase in the free .w channel. uSeed is per material, i.e. per kind, so every sedan on
    // the avenue blinked in lockstep. Instance colour is fixed for a vehicle's life, so this phase is
    // stable as it drives. Write .w from the phase alone: writing the caller's 0 first and correcting it
    // would re-dirty the attribute every frame.
    const lightB = updates[3];
    lightB.set(q, w.lightB[0]); lightB.set(q + 1, w.lightB[1]); lightB.set(q + 2, w.lightB[2]);
    lightB.set(q + 3, (w.color.r * 7.13 + w.color.g * 3.71 + w.color.b * 1.97) % 1);
    const wheel = updates[4];
    wheel.set(q, w.spin); wheel.set(q + 1, w.steer);
    wheel.set(q + 2, 0); wheel.set(q + 3, 0);
    updates[5].write(q, w.susp);
  }

  end(): void {
    const n = this.nearCount, f = this.farCount;
    this.near.count = n;
    this.glass.count = n;
    this.far.count = f;
    this.near.visible = n > 0;
    this.glass.visible = n > 0;
    this.far.visible = f > 0;
    if (n > 0) for (const update of this.nearUpdates) update.flush();
    if (f > 0) for (const update of this.farUpdates) update.flush();
  }

  dispose(): void {
    this.geo.opaque.dispose();
    this.geo.glass.dispose();
    this.geo.far.dispose();
    this.atlas.dispose();
    (this.near.material as THREE.Material).dispose();
    this.near.dispose();
    this.glass.dispose();
    this.far.dispose();
  }
}

export class Fleet {
  pools = new Map<string, KindPool>();
  group = new THREE.Group();
  uniforms: VehicleUniforms;
  glassMat: THREE.MeshPhysicalMaterial;
  ready = false;
  private queue: string[] = [];
  private tmpW: InstanceWrite = { matrix: new THREE.Matrix4(), color: new THREE.Color(), lightA: [0, 0, 0, 0], lightB: [0, 0, 0, 0], spin: 0, steer: 0, susp: [0, 0, 0, 0] };

  constructor(private ctx: GameContext) {
    this.group.name = 'vehicles';
    this.group.matrixAutoUpdate = false;
    this.group.matrixWorldAutoUpdate = false;
    this.group.matrixWorld.identity();
    ctx.worldGroup.add(this.group);
    const atm = ctx.modules.get('atmosphere') as { uniforms?: { uNight: { value: number }; uTime: { value: number }; uWetness: { value: number } }; setupMaterial?: (m: THREE.Material) => void } | undefined;
    this.uniforms = {
      uNight: atm?.uniforms?.uNight ?? { value: 0 },
      uTime: atm?.uniforms?.uTime ?? { value: 0 },
      uWet: atm?.uniforms?.uWetness ?? { value: 0 },
    };
    this.glassMat = createGlassMaterial(this.uniforms);
    atm?.setupMaterial?.(this.glassMat);
    this.queue = KIND_IDS.slice();
  }

  /** build one kind per call (a few ms each) so startup never hitches; returns true when all are built */
  buildNext(): boolean {
    const id = this.queue.shift();
    if (!id) {
      this.ready = true;
      return true;
    }
    const spec = KINDS[id];
    const t0 = performance.now();
    const geo = buildVehicleGeometry(spec);
    const bp = bodyParams(spec), zone = decalZone(spec, bp), zl = zone.z1 - zone.z0;
    const atlas = buildKindAtlas(spec, 1 + KIND_IDS.indexOf(id) * 0.173, { doorSplit: (bp.zB - zone.z0) / zl, doorF: (bp.zDoorF - zone.z0) / zl, doorR: (bp.zDoorR - zone.z0) / zl });
    const mat = createVehicleMaterial(atlas, this.uniforms, KIND_IDS.indexOf(id) * 0.37);
    const atm = this.ctx.modules.get('atmosphere') as { setupMaterial?: (m: THREE.Material) => void } | undefined;
    atm?.setupMaterial?.(mat);
    const pool = new KindPool(spec, geo, atlas, mat, this.glassMat, this.ctx.quality.shadows, isIOS() ? 64 : NEAR_CAP, isIOS() ? 0 : FAR_CAP);
    for (const im of [pool.near, pool.glass, pool.far]) {
      im.matrixWorld.identity();
      this.group.add(im);
    }
    this.pools.set(id, pool);
    if (this.ctx.state.debug) console.info(`[vehicles] built ${id}: ${geo.triangles} tris near, ${(performance.now() - t0).toFixed(1)} ms`);
    return this.queue.length === 0 && (this.ready = true);
  }

  has(kind: string): boolean {
    return this.pools.has(kind);
  }

  begin(): void {
    for (const p of this.pools.values()) p.begin();
  }

  /** write one instance; distance decides LOD */
  write(kind: string, w: InstanceWrite, dist: number): void {
    const p = this.pools.get(kind);
    if (!p) return;
    if (dist > FAR_DIST) return;
    p.write(w, dist < NEAR_DIST);
  }

  /** helper: fill the scratch write struct */
  scratch(): InstanceWrite {
    const w = this.tmpW;
    w.lightA[0] = w.lightA[1] = w.lightA[2] = w.lightA[3] = 0;
    w.lightB[0] = w.lightB[1] = w.lightB[2] = w.lightB[3] = 0;
    w.spin = 0;
    w.steer = 0;
    w.susp[0] = w.susp[1] = w.susp[2] = w.susp[3] = 0;
    return w;
  }

  end(): void {
    for (const p of this.pools.values()) p.end();
  }

  stats(): { near: number; far: number; draws: number } {
    let near = 0, far = 0, draws = 0;
    for (const p of this.pools.values()) {
      near += p.nearCount;
      far += p.farCount;
      draws += (p.nearCount > 0 ? 2 : 0) + (p.farCount > 0 ? 1 : 0);
    }
    return { near, far, draws };
  }

  dispose(): void {
    for (const p of this.pools.values()) p.dispose();
    this.pools.clear();
    this.glassMat.dispose();
    this.ctx.worldGroup.remove(this.group);
  }
}
