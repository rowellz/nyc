/**
 * World pickups from ctx.state.pickups: the weapon itself (or a medkit / plate carrier) hovering ~1 m up and
 * slowly turning, a soft light ring on the ground, a floating name label, and a small pool of point lights
 * handed to the nearest few. Within 2 m the ui prompt offers 'E — Pick up …'; 'interact' sends {t:'pickup'}.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import type { Pickup } from '@shared/protocol';
import { WEAPONS } from '@shared/weapons';
import { prepareWeapon, buildWeaponMesh, buildMedkitGeometrySteps, buildVestGeometrySteps } from './weaponModels';
import { getWeaponMaterial, chainOnBeforeCompile } from './materials';
import { scheduleInit } from './init';
import { makeLabelTexture, makeRingTexture } from './textures';

interface Vis {
  p: Pickup;
  group: THREE.Group;
  model: THREE.Object3D;
  ring: THREE.Mesh;
  label: THREE.Sprite;
  /** soft additive glow around the item */
  halo: THREE.Sprite;
  haloR: number;
  labelAspect: number;
  phase: number;
  spin: number;
  name: string;
  hover: number;
}

type Kind = Pickup['kind'];
const COLORS: Record<Kind, THREE.Color> = { weapon: new THREE.Color(0xffc978), health: new THREE.Color(0xff5a4a), armor: new THREE.Color(0x63a8ff) };
const PROMPT_RANGE = 2.0;
const VISUAL_RANGE = 90;
const LABEL_RANGE = 28;
const LIGHT_RANGE = 22;
const _cam = new THREE.Vector3();

export class Pickups {
  group = new THREE.Group();
  private vis = new Map<number, Vis>();
  private pending = new Map<number, AbortController>();
  private disposed = false;
  private ringTex: THREE.Texture;
  private ringMats: Record<Kind, THREE.MeshBasicMaterial>;
  private haloMats: Record<Kind, THREE.SpriteMaterial>;
  private ringGeo: THREE.PlaneGeometry;
  private labelCache = new Map<string, { texture: THREE.Texture; aspect: number }>();
  private medkit: THREE.BufferGeometry | null = null;
  private vest: THREE.BufferGeometry | null = null;
  private lights: THREE.PointLight[] = [];
  private uTime = { value: 0 };
  /** the pickup currently offered by the prompt */
  nearest: Pick<Vis, 'p' | 'name'> | null = null;
  private lastPromptId = -1;
  private autoId = -1;
  private nextTakeAt = 0;

  constructor(private ctx: GameContext) {
    this.group.name = 'combat-pickups';
    this.ringTex = makeRingTexture();
    this.ringGeo = new THREE.PlaneGeometry(1, 1);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringMats = { weapon: this.makeRingMat('weapon'), health: this.makeRingMat('health'), armor: this.makeRingMat('armor') };
    this.haloMats = { weapon: this.makeHaloMat('weapon'), health: this.makeHaloMat('health'), armor: this.makeHaloMat('armor') };
    // two lights at most (the muzzle flashes own the other two of the scene's dynamic-light budget)
    const nLights = (ctx.quality.level === 'low' || ctx.quality.level === 'mobile') ? 0 : 2;
    for (let i = 0; i < nLights; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 2);
      l.name = `pickup-light-${i}`;
      this.group.add(l);
      this.lights.push(l);
    }
  }

  private makeRingMat(kind: Kind): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: COLORS[kind].clone().multiplyScalar(0.9), opacity: 0.8, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.name = `pickupRing-${kind}`;
    const uTime = this.uTime;
    chainOnBeforeCompile(
      m,
      (shader) => {
        shader.uniforms.uTime = uTime;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; varying float vPulse;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPulse = 0.8 + 0.2 * sin(uTime * 2.1 + modelMatrix[3].x * 0.7 + modelMatrix[3].z * 0.3);');
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPulse;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vPulse;');
      },
      'pickupRing',
    );
    return m;
  }

  private makeHaloMat(kind: Kind): THREE.SpriteMaterial {
    const m = new THREE.SpriteMaterial({ map: this.ringTex, color: COLORS[kind].clone().multiplyScalar(0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.28, fog: true });
    m.name = `pickupHalo-${kind}`;
    return m;
  }

  private label(name: string, sub?: string): { texture: THREE.Texture; aspect: number } {
    const key = `${name}|${sub ?? ''}`;
    let l = this.labelCache.get(key);
    if (!l) {
      l = makeLabelTexture(name, sub);
      this.labelCache.set(key, l);
    }
    return l;
  }

  private *create(p: Pickup): Generator<void, Vis, unknown> {
    const group = new THREE.Group();
    group.name = `pickup-${p.id}`;
    let model: THREE.Object3D;
    let name: string;
    let sub: string;
    let radius = 0.9;
    let hover = 1.0;
    if (p.kind === 'weapon') {
      const def = WEAPONS[p.weapon ?? 0];
      name = def?.name ?? 'Weapon';
      sub = def ? `${def.magazine}-round magazine` : '';
      const w = buildWeaponMesh(this.ctx, p.weapon ?? 0);
      const len = (w?.userData.length as number) ?? 0.5;
      const holder = new THREE.Group();
      if (w) {
        // center the gun on its length so it turns about its middle; tilt it slightly
        w.position.set(0, 0.02, len * 0.5 - 0.22);
        holder.add(w);
      }
      holder.rotation.x = -0.12;
      holder.rotation.z = 0.32;
      model = holder;
      radius = Math.max(0.8, len * 0.9);
    } else if (p.kind === 'health') {
      name = 'Medkit';
      sub = '+50 health';
      if (!this.medkit) this.medkit = (yield* buildMedkitGeometrySteps()).geometry;
      const m = new THREE.Mesh(this.medkit, getWeaponMaterial(this.ctx));
      m.castShadow = true;
      m.position.y = -0.06;
      model = m;
      hover = 0.85;
    } else {
      name = 'Body Armor';
      sub = '+50 armor';
      if (!this.vest) this.vest = (yield* buildVestGeometrySteps()).geometry;
      const m = new THREE.Mesh(this.vest, getWeaponMaterial(this.ctx));
      m.castShadow = true;
      m.position.y = -0.2;
      model = m;
      hover = 0.95;
    }
    group.add(model);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMats[p.kind]);
    ring.scale.set(radius * 2.2, 1, radius * 2.2);
    // groundHeight() is the road datum; a sidewalk/plaza can render 0.15 m above it.
    ring.position.y = 0.175;
    ring.renderOrder = 6;
    group.add(ring);
    const haloR = radius * 1.1;
    const halo = new THREE.Sprite(this.haloMats[p.kind]);
    halo.scale.setScalar(haloR);
    halo.position.y = hover;
    halo.renderOrder = 6;
    group.add(halo);
    yield;
    const lab = this.label(name, sub);
    yield;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: lab.texture, transparent: true, depthWrite: false, depthTest: true, fog: true }));
    label.position.y = hover + 0.55;
    label.renderOrder = 7;
    group.add(label);
    const ground = this.ctx.physics.groundHeight(p.x, p.z);
    group.position.set(p.x, Math.max(ground, p.y), p.z);
    this.group.add(group);
    return { p, group, model, ring, label, halo, haloR, labelAspect: lab.aspect, phase: Math.random() * Math.PI * 2, spin: Math.random() * Math.PI * 2, name, hover };
  }

  private remove(v: Vis): void {
    this.group.remove(v.group);
    v.label.material.dispose();
    // weapon / medkit / vest geometries and the ring material are shared and cached; nothing else owned here
  }

  update(dt: number, t: number): void {
    const st = this.ctx.state;
    this.uTime.value = t;
    const want = st.pickups;
    for (const [id, v] of this.vis) {
      if (!want.has(id)) {
        this.remove(v);
        this.vis.delete(id);
      }
    }
    for (const [id, job] of this.pending) if (!want.has(id)) { job.abort(); this.pending.delete(id); }
    for (const [id, p] of want) {
      if (this.vis.has(id) || this.pending.has(id)) continue;
      // Denser starter loot must not build/render the entire network AOI at entry.
      // Interaction uses authoritative records below, independently of this visual LOD.
      if (Math.hypot(p.x - st.local.state.x, p.z - st.local.state.z) > VISUAL_RANGE + 20) continue;
      const abort = new AbortController();
      this.pending.set(id, abort);
      // Count the whole request, including waiting for a weapon and the scene commit.
      this.ctx.busy = (this.ctx.busy ?? 0) + 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.ctx.busy = (this.ctx.busy ?? 1) - 1;
        abort.signal.removeEventListener('abort', release);
      };
      abort.signal.addEventListener('abort', release, { once: true });
      void (async () => {
        if (p.kind === 'weapon') await prepareWeapon(this.ctx, p.weapon ?? 0);
        if (this.disposed || abort.signal.aborted || want.get(id) !== p) return;
        const visual = await scheduleInit(this.ctx, this.create(p), abort.signal);
        this.vis.set(id, visual);
      })().catch(error => {
        if (!abort.signal.aborted && !this.disposed) console.warn('[combat] pickup initialization failed', error);
      }).finally(() => {
        if (this.pending.get(id) === abort) this.pending.delete(id);
        release();
      });
    }

    _cam.copy(this.ctx.camera.position);
    const me = st.local.state;
    let nearest: Pick<Vis, 'p' | 'name'> | null = null;
    let nearestD = Infinity;
    // Interaction must not wait for an asynchronously built weapon mesh or depend on the camera.
    for (const p of want.values()) {
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d < nearestD && Math.abs(me.y - Math.max(p.y, this.ctx.physics.groundHeight(p.x, p.z))) < 1.5) {
        nearestD = d;
        nearest = { p, name: p.kind === 'weapon' ? WEAPONS[p.weapon ?? 0]?.name ?? 'Weapon' : p.kind === 'health' ? 'Medkit' : 'Body Armor' };
      }
    }
    const candidates: { v: Vis; d: number }[] = [];
    for (const v of this.vis.values()) {
      const dCam = v.group.position.distanceTo(_cam);
      const visible = dCam < VISUAL_RANGE;
      v.group.visible = visible;
      if (!visible) continue;
      v.spin += dt * 1.1;
      v.model.position.y = v.hover + Math.sin(t * 1.6 + v.phase) * 0.09;
      v.model.rotation.y = v.spin;
      v.halo.position.y = v.model.position.y;
      v.halo.scale.setScalar(v.haloR * (0.92 + 0.1 * Math.sin(t * 2.1 + v.phase)));
      v.label.visible = dCam < LABEL_RANGE;
      if (v.label.visible) {
        const s = Math.max(0.16, dCam * 0.032);
        v.label.scale.set(s * v.labelAspect, s, 1);
        v.label.material.opacity = Math.min(1, (LABEL_RANGE - dCam) / 6);
      }
      if (dCam < LIGHT_RANGE) candidates.push({ v, d: dCam });
    }
    candidates.sort((a, b) => a.d - b.d);
    const night = 1 - this.ctx.time.daylight;
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const c = candidates[i];
      if (!c) {
        l.intensity = 0;
        continue;
      }
      l.position.copy(c.v.group.position);
      l.position.y += c.v.hover + 0.3;
      l.color.copy(COLORS[c.v.p.kind]);
      l.intensity = (1.2 + night * 5) * (0.9 + 0.1 * Math.sin(t * 2.1 + c.v.phase));
    }
    const ui = this.ctx.modules.get('ui') as { prompt?: (s: string | null) => void } | undefined;
    if (nearest && nearestD <= PROMPT_RANGE && !st.local.dead && !st.screenshotMode && st.welcomed && st.local.vehicleKey === null) {
      this.nearest = nearest;
      ui?.prompt?.(`E — pick up ${nearest.name}`);
      this.lastPromptId = nearest.p.id;
      // Walking through the inner radius collects it; standing nearby still offers E.
      // Retry a pending crossing for authoritative position/latency, never every frame.
      if (nearestD <= 1 && (Math.hypot(me.vx, me.vz) > 0.1 || this.autoId === nearest.p.id)) {
        this.autoId = nearest.p.id;
        if (t >= this.nextTakeAt) { this.interact(); this.nextTakeAt = t + 0.6; }
      } else {
        this.autoId = -1;
      }
    } else {
      if (this.lastPromptId !== -1) {
        ui?.prompt?.(null);
        this.lastPromptId = -1;
      }
      this.nearest = null;
      this.autoId = -1;
    }
  }

  /** E pressed: take the offered pickup (server validates range) */
  interact(): boolean {
    const v = this.nearest;
    const st = this.ctx.state, me = st.local.state;
    if (!v || !st.welcomed || st.local.dead || st.screenshotMode || st.local.vehicleKey !== null || !st.pickups.has(v.p.id) || Math.hypot(v.p.x - me.x, v.p.z - me.z) > PROMPT_RANGE) return false;
    this.ctx.net.send({ t: 'pickup', id: v.p.id });
    return true;
  }

  count(): number {
    return this.vis.size;
  }

  dispose(): void {
    this.disposed = true;
    for (const abort of this.pending.values()) abort.abort();
    this.pending.clear();
    for (const v of this.vis.values()) this.remove(v);
    this.vis.clear();
    for (const l of this.labelCache.values()) l.texture.dispose();
    this.ringTex.dispose();
    for (const m of Object.values(this.ringMats)) m.dispose();
    for (const m of Object.values(this.haloMats)) m.dispose();
    this.ringGeo.dispose();
    this.medkit?.dispose();
    this.vest?.dispose();
    this.group.removeFromParent();
  }
}
