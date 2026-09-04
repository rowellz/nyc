/**
 * Bryant Park's boundary: a soft 1.5 m ground wash, eight 25 m light columns,
 * and a faint hex shimmer only within 12 m of the edge. No distant neon rim.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { SAFE_ZONE } from '@shared/constants';
import { pointInPolygon } from '@/core/physics';
import { BRYANT_PARK } from '@/landmarks/data';
import { Frame } from '@/landmarks/geom';
import { makeHexTexture } from './textures';
import { chainOnBeforeCompile } from './materials';
import { smoothstep } from './util';

const PILLARS = 8;
const PILLAR_H = 25;
const BAND_WIDTH = 1.5;
const WALL_H = 9;
const WALL_FADE_M = 12;
const GROUND_OFFSET = 0.035;
const TAU = Math.PI * 2;
const PARK_FRAME = Frame.fromBearing(BRYANT_PARK.ox, BRYANT_PARK.oz, BRYANT_PARK.bearing);
type Zone = { x: number; z: number; radius: number };

export class SafeZoneFx {
  group = new THREE.Group();
  private ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private pillars: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private wall: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private hex: THREE.Texture;
  private pillarTemplate: Float32Array;
  private uniforms = { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3() }, uPulse: { value: 0 }, uNight: { value: 0 } };
  private inside = false;
  private first = true;
  private pulseUntil = 0;
  private promptUntil = 0;
  private placedZone = '';
  private placedTiles: unknown[] = [];

  constructor(private ctx: GameContext) {
    const sz = ctx.state.safeZone ?? SAFE_ZONE;
    this.group.name = 'combat-safezone';
    this.hex = makeHexTexture();
    const atm = ctx.modules.get('atmosphere') as { uniforms?: { uNight?: { value: number } } } | undefined;
    if (atm?.uniforms?.uNight) this.uniforms.uNight = atm.uniforms.uNight;
    const u = this.uniforms;
    const blue = new THREE.Color(0x91c7ff);

    // Radial UVs retain a broad, even wash; only the outer shoulders feather away.
    const ringGeo = new THREE.RingGeometry(sz.radius - BAND_WIDTH / 2, sz.radius + BAND_WIDTH / 2, 256, 4);
    ringGeo.rotateX(-Math.PI / 2);
    const rp = ringGeo.getAttribute('position');
    const ru = ringGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), z = rp.getZ(i);
      ru.setXY(i, (Math.hypot(x, z) - sz.radius) / BAND_WIDTH + 0.5, Math.atan2(z, x) / TAU);
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: blue, opacity: 0.35, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true, side: THREE.DoubleSide, forceSinglePass: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    ringMat.name = 'safeRing';
    chainOnBeforeCompile(ringMat, shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vRadial;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRadial = uv.x;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vRadial;')
        .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.a *= 1.0 - smoothstep(0.45, 1.0, abs(vRadial - 0.5) * 2.0);`);
    }, 'safeRing-soft-band');
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.name = 'combat-safezone-ring';
    this.ring.renderOrder = 8;
    this.group.add(this.ring);

    // One soft scattering surface per beam. Alpha blending includes extinction:
    // additive-only light washes out to white against the pale daytime skyline.
    // Retain light through most of the height so 25 m columns read at 300 m.
    const beam = new THREE.CylinderGeometry(1.2, 1.5, PILLAR_H, 24, 8, true).toNonIndexed();
    beam.translate(0, PILLAR_H / 2, 0);
    this.pillarTemplate = new Float32Array(beam.getAttribute('position').array);
    const parts = Array.from({ length: PILLARS }, () => beam.clone());
    beam.dispose();
    const pillarMat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.18, 0.5, 1.1), opacity: 0.48,
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: true, side: THREE.FrontSide });
    pillarMat.name = 'safePillar';
    chainOnBeforeCompile(pillarMat, shader => {
      shader.uniforms.uTime = u.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPuv; varying float vFacing;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vPuv = uv;
vec3 wn = normalize(mat3(modelMatrix) * normal);
vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
vFacing = max(0.0, dot(wn, normalize(cameraPosition - wp)));`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPuv; varying float vFacing; uniform float uTime;')
        .replace('#include <color_fragment>', `#include <color_fragment>
float hfade = smoothstep(0.0, 0.035, vPuv.y) * (1.0 - smoothstep(0.70, 1.0, vPuv.y));
float flow = 0.97 + 0.03 * sin(vPuv.y * 12.0 - uTime * 0.7);
diffuseColor.a *= hfade * pow(max(0.0, vFacing), 1.7) * flow;`);
    }, 'safePillar-soft-column');
    this.pillars = new THREE.Mesh(mergeSimple(parts), pillarMat);
    this.pillars.name = 'combat-safezone-pillars';
    this.pillars.renderOrder = 9;
    this.group.add(this.pillars);

    const wallGeo = new THREE.CylinderGeometry(sz.radius, sz.radius, WALL_H, 256, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({ color: blue, map: this.hex, opacity: 0.12, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: true, side: THREE.DoubleSide, forceSinglePass: true });
    wallMat.name = 'safeWall';
    this.hex.repeat.set(TAU * sz.radius / 1.2, 1);
    chainOnBeforeCompile(wallMat, shader => {
      shader.uniforms.uTime = u.uTime;
      shader.uniforms.uPlayer = u.uPlayer;
      shader.uniforms.uPulse = u.uPulse;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying float vWh;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(position, 1.0)).xyz; vWh = uv.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWp; varying float vWh; uniform float uTime; uniform vec3 uPlayer; uniform float uPulse;')
        .replace('#include <map_fragment>', `vec2 huv = vec2(vMapUv.x, vMapUv.y * ${(WALL_H / 1.2).toFixed(2)});
float hex = texture2D(map, huv).a;
float dp = distance(vWp.xz, uPlayer.xz);
float near = 1.0 - smoothstep(2.0, ${WALL_FADE_M.toFixed(1)}, dp);
float hfade = pow(max(0.0, 1.0 - vWh), 1.5);
float shimmer = 0.72 + 0.28 * sin(uTime * 1.2 + vWp.y * 2.0);
// The crossing pulse is gated too: no wall/rim can leak beyond 12 m.
diffuseColor.a *= hex * shimmer * near * hfade * (1.0 + uPulse * 0.35);`);
    }, 'safeWall-local-shimmer');
    this.wall = new THREE.Mesh(wallGeo, wallMat);
    this.wall.name = 'combat-safezone-wall';
    this.wall.renderOrder = 10;
    this.wall.visible = false;
    this.group.add(this.wall);
    this.placeGeometry(sz, false);
  }

  /** Physics includes decks, but not the landmark's thin gravel/flag overlays. */
  private groundAt(x: number, z: number): number {
    let surface = 0.02; // street roadbed
    const tile = this.ctx.world.tileAt?.(x, z);
    if (tile && [...tile.sidewalks, ...tile.plazas].some(p => pointInPolygon(x, z, p))) surface = 0.15;
    const [pu, pv] = PARK_FRAME.toLocal(x, z);
    if (pu >= -102 && pu <= BRYANT_PARK.terrace.u0 && Math.abs(pv) <= 49
        && !pointInPolygon(pu, -pv, [BRYANT_PARK.lawn])) {
      surface = Math.abs(pv) > 35.5 && Math.abs(pv) < 42 && pu > -80 && pu < 20 ? 0.20 : 0.19;
    }
    return Math.max(surface, this.ctx.physics?.groundHeight(x, z) ?? 0) + GROUND_OFFSET;
  }

  /** Keep the authoritative circle and metre-sized widths on server moves/resizes.
   * Refit only after the boundary tiles/builders settle, including reloaded tiles. */
  private placeGeometry(sz: Zone, settled = true): void {
    const tiles = [-1, 1].flatMap(dx => [-1, 1].map(dz => this.ctx.world.tileAt?.(sz.x + dx * sz.radius, sz.z + dz * sz.radius)));
    const key = `${sz.x}:${sz.z}:${sz.radius}`;
    if (settled) {
      if (!this.ctx.world.ready || (this.ctx.busy ?? 0) > 0 || (typeof this.ctx.world.tileAt === 'function' && tiles.some(t => !t))) return;
      if (key === this.placedZone && tiles.every((tile, i) => tile === this.placedTiles[i])) return;
      this.placedZone = key;
      this.placedTiles = tiles;
    }
    this.group.position.set(sz.x, 0, sz.z);
    const rp = this.ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ru = this.ring.geometry.getAttribute('uv');
    for (let i = 0; i < rp.count; i++) {
      const a = ru.getY(i) * TAU, r = sz.radius + (ru.getX(i) - 0.5) * BAND_WIDTH;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      rp.setXYZ(i, x, this.groundAt(sz.x + x, sz.z + z), z);
    }
    const wp = this.wall.geometry.getAttribute('position') as THREE.BufferAttribute;
    const wn = this.wall.geometry.getAttribute('normal'), wu = this.wall.geometry.getAttribute('uv');
    for (let i = 0; i < wp.count; i++) {
      const x = wn.getX(i) * sz.radius, z = wn.getZ(i) * sz.radius;
      wp.setXYZ(i, x, this.groundAt(sz.x + x, sz.z + z) + wu.getY(i) * WALL_H, z);
    }
    this.hex.repeat.x = TAU * sz.radius / 1.2;

    const buildings = this.ctx.modules.get('buildings') as { isInside?: (x: number, z: number) => boolean } | undefined;
    const blocked = (x: number, z: number) => buildings?.isInside?.(x, z)
      || this.ctx.world.buildingsNear?.(x, z, 0).some(b => pointInPolygon(x, z, b.footprint));
    const chosen: number[] = [];
    const sightSteps = Math.ceil(sz.radius / 4);
    const pos = this.pillars.geometry.getAttribute('position') as THREE.BufferAttribute;
    const stride = this.pillarTemplate.length / 3;
    for (let i = 0; i < PILLARS; i++) {
      const preferred = i / PILLARS * TAU;
      let angle = preferred;
      // Prefer anchors visible from inside the zone, not behind the library.
      // Second pass allows occluded anchors if the terrain offers no clear view.
      search: for (const clearView of [true, false]) for (let step = 0; step < 144; step++) {
        const a = preferred + Math.ceil(step / 2) * Math.PI / 72 * (step % 2 ? 1 : -1);
        const dx = Math.cos(a) * sz.radius, dz = Math.sin(a) * sz.radius;
        const x = sz.x + dx, z = sz.z + dz;
        if (blocked(x, z) || this.ctx.world.isWater?.(x, z)) continue;
        if ([[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]].some(([ox, oz]) => blocked(x + ox, z + oz))) continue;
        if (chosen.some(b => Math.hypot(Math.cos(a) - Math.cos(b), Math.sin(a) - Math.sin(b)) * sz.radius < 12)) continue;
        if (clearView) {
          let occluded = false;
          for (let j = 1; j < sightSteps; j++) {
            if (blocked(sz.x + dx * j / sightSteps, sz.z + dz * j / sightSteps)) { occluded = true; break; }
          }
          if (occluded) continue;
        }
        angle = a; break search;
      }
      chosen.push(angle);
      const x = Math.cos(angle) * sz.radius, z = Math.sin(angle) * sz.radius;
      const ground = this.groundAt(sz.x + x, sz.z + z);
      for (let j = 0; j < stride; j++) {
        const k = j * 3;
        pos.setXYZ(i * stride + j, x + this.pillarTemplate[k], ground + this.pillarTemplate[k + 1], z + this.pillarTemplate[k + 2]);
      }
    }
    for (const mesh of [this.ring, this.pillars, this.wall]) {
      mesh.geometry.getAttribute('position').needsUpdate = true;
      mesh.geometry.computeBoundingSphere();
    }
  }

  inSafeZone(x: number, z: number): boolean {
    const sz = this.ctx.state.safeZone ?? SAFE_ZONE;
    const dx = x - sz.x, dz = z - sz.z;
    return dx * dx + dz * dz <= sz.radius * sz.radius;
  }

  /** called when the local player tries to shoot inside */
  refuse(): void {
    const now = performance.now() / 1000;
    if (now < this.promptUntil) return;
    this.promptUntil = now + 1.6;
    const ui = this.ctx.modules.get('ui') as { toast?: (s: string, kind: 'warn') => void } | undefined;
    // A transient warning must not own (or later erase) a pickup/vehicle prompt.
    // The old timer ran before its deadline and left that shared prompt stuck forever.
    ui?.toast?.('Safe zone — weapons disabled', 'warn');
  }

  update(dt: number, t: number): void {
    const st = this.ctx.state;
    const sz = st.safeZone ?? SAFE_ZONE;
    this.placeGeometry(sz);
    this.uniforms.uTime.value = t;
    const night = THREE.MathUtils.clamp(this.uniforms.uNight.value, 0, 1);
    this.ring.material.opacity = THREE.MathUtils.lerp(0.35, 0.6, night);
    this.pillars.material.opacity = THREE.MathUtils.lerp(0.48, 0.75, night);
    this.wall.material.opacity = THREE.MathUtils.lerp(0.12, 0.2, night);
    // Screenshot mode still animates and uses the free camera for proximity.
    const me = st.screenshotMode ? this.ctx.camera.position : st.local.state;
    this.uniforms.uPlayer.value.set(me.x, 0, me.z);
    const d = Math.hypot(me.x - sz.x, me.z - sz.z);
    this.wall.visible = Math.abs(d - sz.radius) < WALL_FADE_M;
    const inside = d <= sz.radius;
    if (inside !== this.inside) {
      this.inside = inside;
      const ui = this.ctx.modules.get('ui') as { toast?: (s: string, k?: string) => void } | undefined;
      if (!this.first || inside) ui?.toast?.(inside ? 'Bryant Park — Safe Zone' : 'Leaving the safe zone', inside ? 'info' : 'warn');
      if (!this.first) this.pulseUntil = t + 1.2;
    }
    this.first = false;
    this.uniforms.uPulse.value = this.pulseUntil > t ? smoothstep(0, 1, (this.pulseUntil - t) / 1.2) : 0;
    void dt;
  }

  dispose(): void {
    for (const mesh of [this.ring, this.pillars, this.wall]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.hex.dispose();
    this.group.removeFromParent();
  }
}

/** merge non-indexed position/normal/uv geometries (no BufferGeometryUtils dependency needed here, but use it) */
function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += c;
    g.dispose();
  }
  for (const g of list) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}
