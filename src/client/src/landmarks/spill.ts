/**
 * Light spill from the big LED screens. A small fixed pool of SpotLights (added once at creation, so shader light
 * counts never change) sits every frame in front of the biggest screens near the camera, aimed along the screen's
 * own normal so the wash lands on the pavement and the facade opposite instead of on the wall carrying the screen.
 * Each one is coloured by the campaign it is showing (per-cell atlas averages, following the shader's cut timing)
 * and scaled by screen area x average luminance. Additive ground-glow decals, stretched along the same normal and
 * sized to the screen, fill the strip at the building line that the cone cannot reach. Everything scales with uNight.
 *
 * The lights are real scene lights, so crowds, vehicles, props and facades all pick the tint up for free.
 */
import * as THREE from 'three';
import { isIOS } from '@/core/quality';
import type { GameContext } from '@/core/context';
import { ATLAS_CELLS, CELL_AVERAGES, TICKER_CELL, type SpillSource } from './screens';
import type { SharedUniforms } from './materials';

const LIGHTS = 6;
const DECALS = 10;
/** screens farther than this from the camera never spill */
const RANGE = 190;
const REPICK = 0.25;
/** cone half-angle: wide enough to hold the pavement below and the facade opposite in one light */
const CONE = 1.4;
/** candela per m^2 of screen at unit luminance; calibrated so plaza pavement reads ~3x a street-lamp pool */
const CD_PER_M2 = 32;
const CD_MAX = 8500;
/** an atlas cell average is a whole ad flattened, so it is far greyer than what the eye reads off the sign */
const CHROMA = 1.8;

interface Slot { src: SpillSource | null; cur: number; ground: number }

function poolTexture(): THREE.Texture | null {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    if (!x) return null;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch { return null; }
}

export class ScreenSpill {
  private groups = new Map<string, SpillSource[]>();
  private lights: THREE.SpotLight[] = [];
  private decals: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private lightSlots: Slot[] = [];
  private decalSlots: Slot[] = [];
  private geometry = new THREE.PlaneGeometry(1, 1);
  private map: THREE.Texture | null;
  private scene: THREE.Object3D | undefined;
  private until = 0;
  private col = new THREE.Color();
  private hue = new THREE.Color();
  private cands: { s: SpillSource; score: number }[] = [];

  constructor(private ctx: GameContext, private uniforms: SharedUniforms) {
    this.scene = (ctx as unknown as { scene?: THREE.Object3D }).scene;
    this.map = poolTexture();
    for (let i = 0; i < (isIOS() ? 0 : LIGHTS); i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 120, CONE, 0.9, 2);
      l.name = `screen-spill-${i}`;
      l.castShadow = false;
      l.position.set(0, -1000, 0);
      // The target rides the light, so its world matrix updates with it and never needs its own scene entry.
      l.target.position.set(0, 0, 1);
      l.add(l.target);
      this.scene?.add(l);
      this.lights.push(l);
      this.lightSlots.push({ src: null, cur: 0, ground: 0 });
    }
    for (let i = 0; i < DECALS; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x000000, map: this.map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
      const mesh = new THREE.Mesh(this.geometry, m);
      mesh.name = `screen-glow-${i}`;
      mesh.rotation.order = 'YXZ';
      mesh.rotation.set(-Math.PI / 2, 0, 0);
      mesh.renderOrder = 5;
      mesh.visible = false;
      this.scene?.add(mesh);
      this.decals.push(mesh);
      this.decalSlots.push({ src: null, cur: 0, ground: 0 });
    }
  }

  add(key: string, sources: SpillSource[]): void {
    if (sources.length) this.groups.set(key, sources);
    else this.groups.delete(key);
    this.until = 0;
  }
  remove(key: string): void {
    if (this.groups.delete(key)) this.until = 0;
  }

  /** linear colour of what the screen shows right now (mirrors the shader's slot / crossfade timing) */
  private colourOf(s: SpillSource, t: number, out: THREE.Color): THREE.Color {
    const n = ATLAS_CELLS * ATLAS_CELLS;
    if (s.type > 0.5 && s.type < 1.5) return out.copy(CELL_AVERAGES[TICKER_CELL]);
    const tt = t * 0.14 * s.speed + s.phase;
    const slot = Math.floor(tt), ft = tt - slot;
    const a = (((s.cell + slot * 7) % n) + n) % n, b = (a + 7) % n;
    const x = THREE.MathUtils.smoothstep(ft, 0.93, 1.0);
    out.copy(CELL_AVERAGES[a]).lerp(CELL_AVERAGES[b], x);
    if (s.type > 1.5 && s.type < 2.5) out.multiplyScalar(0.8 + 0.2 * Math.sin(t * 2 * s.speed + s.phase * 6.28));
    return out;
  }

  private pick(): void {
    const cam = this.ctx.camera.position;
    const cands = this.cands;
    cands.length = 0;
    for (const list of this.groups.values()) for (const s of list) {
      const dx = s.x - cam.x, dz = s.z - cam.z, dy = s.y - cam.y;
      const d2 = dx * dx + dz * dz + dy * dy;
      if (d2 > RANGE * RANGE) continue;
      if (dx * s.nx + dz * s.nz > 0) continue; // the camera is behind the screen
      cands.push({ s, score: (s.w * s.h) / Math.max(150, d2) });
    }
    cands.sort((p, q) => q.score - p.score);
    this.assign(this.decalSlots, DECALS);
    this.assign(this.lightSlots, this.lights.length);
  }

  private assign(slots: Slot[], n: number): void {
    const wanted = new Set<SpillSource>();
    for (let i = 0; i < Math.min(n, this.cands.length); i++) wanted.add(this.cands[i].s);
    for (const slot of slots) if (slot.src && !wanted.has(slot.src)) slot.src = null;
    for (const s of wanted) {
      if (slots.some(sl => sl.src === s)) continue;
      const free = slots.find(sl => sl.src === null);
      if (!free) break;
      free.src = s;
      free.cur = 0;
      const off = glowLength(s) * 0.42;
      const x = s.x + s.nx * off, z = s.z + s.nz * off;
      let g = 0;
      try { g = this.ctx.physics?.groundHeight?.(x, z) ?? 0; } catch { g = 0; }
      free.ground = g;
    }
  }

  update(dt: number, snap: boolean): void {
    const night = this.uniforms.uNight.value;
    const t = this.uniforms.uTime.value;
    this.until -= dt;
    if (this.until <= 0 || snap) {
      this.pick();
      this.until = REPICK;
    }
    const k = snap ? 1 : Math.min(1, dt * 3);
    for (let i = 0; i < this.lights.length; i++) {
      const slot = this.lightSlots[i], light = this.lights[i], s = slot.src;
      if (!s) {
        slot.cur += (0 - slot.cur) * k;
        light.intensity = slot.cur;
        if (slot.cur < 0.5) light.position.y = -1000;
        continue;
      }
      const lum = this.tint(s, t);
      const area = s.w * s.h;
      // A screen is an area source: stand the point light off by ~half its size so the near field does not blow up,
      // then aim it down the normal at the street. Nothing is between the screen and the light but air.
      const off = THREE.MathUtils.clamp(0.5 * Math.sqrt(area), 4, 16);
      const target = night * THREE.MathUtils.clamp(CD_PER_M2 * area * Math.sqrt(lum), 40, CD_MAX);
      slot.cur += (target - slot.cur) * k;
      light.color.copy(this.hue);
      light.intensity = slot.cur;
      light.distance = THREE.MathUtils.clamp(45 + Math.sqrt(area) * 3, 60, 130);
      light.position.set(s.x + s.nx * off, s.y, s.z + s.nz * off);
      // aim: 22 m along the normal and most of the way down to the street
      light.target.position.set(s.nx * 22, -Math.max(4, s.y * 0.85), s.nz * 22);
    }
    for (let i = 0; i < DECALS; i++) {
      const slot = this.decalSlots[i], mesh = this.decals[i], s = slot.src;
      if (!s) {
        slot.cur += (0 - slot.cur) * k;
        if (slot.cur < 0.01) mesh.visible = false;
        else mesh.material.color.multiplyScalar(0.9);
        continue;
      }
      const lum = this.tint(s, t);
      const area = s.w * s.h;
      const target = night * Math.sqrt(Math.max(0.02, lum)) * 1.4 * Math.min(1, area / 100) * Math.min(1, 2000 / (s.y * s.y + 700));
      slot.cur += (target - slot.cur) * k;
      // sized to the screen: as wide as the screen (plus spread), stretched along the normal away from the facade
      const len = glowLength(s);
      const wide = Math.min(70, s.w * 1.25 + 8);
      mesh.position.set(s.x + s.nx * len * 0.42, slot.ground + 0.2, s.z + s.nz * len * 0.42);
      mesh.rotation.y = Math.atan2(s.nx, s.nz);
      mesh.scale.set(wide, len, 1);
      mesh.material.color.copy(this.hue).multiplyScalar(slot.cur);
      mesh.visible = slot.cur > 0.01;
    }
  }

  /** live screen colour -> this.hue (unit-peak, chroma-restored tint), returns its luminance */
  private tint(s: SpillSource, t: number): number {
    this.colourOf(s, t, this.col);
    const mx = Math.max(this.col.r, this.col.g, this.col.b, 0.05);
    const lum = Math.max(0.02, 0.2126 * this.col.r + 0.7152 * this.col.g + 0.0722 * this.col.b);
    const inv = 1 / mx;
    this.hue.setRGB(
      Math.max(0, 1 - (1 - this.col.r * inv) * CHROMA),
      Math.max(0, 1 - (1 - this.col.g * inv) * CHROMA),
      Math.max(0, 1 - (1 - this.col.b * inv) * CHROMA),
    );
    return lum;
  }

  dispose(): void {
    for (const l of this.lights) l.removeFromParent();
    for (const d of this.decals) { d.removeFromParent(); d.material.dispose(); }
    this.geometry.dispose();
    this.map?.dispose();
    this.groups.clear();
  }
}

/** how far the ground glow reaches out from the facade: taller screens throw further */
function glowLength(s: SpillSource): number {
  return Math.min(80, Math.max(12, s.y * 1.5 + s.h * 0.8));
}
