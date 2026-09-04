/**
 * Night lighting for the props:
 *  - LightPool: a fixed pool of PointLights (added once, so shader light counts never change); every
 *    frame the nearest lamp heads / shed tubes take a light with a smooth intensity ramp.
 *  - PoolDecals: one additive InstancedMesh of ground quads (the light pool on the pavement) under every
 *    lamp / shed / globe within range; warm or white per instance, brighter when the street is wet.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import type { BuildingsModule, Storefront } from '@/buildings';
import { makePoolTexture } from './textures';
import { PROP_UNIFORMS } from './material';

export interface LightSource {
  x: number;
  y: number;
  z: number;
  groundY?: number;
  /** 0 = warm HPS, 1 = white LED, 2 = fluorescent shed, 3 = green globe */
  kind: 0 | 1 | 2 | 3;
  /** ground pool half-size (m) */
  poolX: number;
  poolZ: number;
  yaw: number;
  seed: number;
  /** Optional linear lamp colour and ground-glow strength (before the shared night factor). */
  color?: readonly [number, number, number];
  intensity?: number;
}

const COLORS = [PROP_UNIFORMS.uLampWarm.value, PROP_UNIFORMS.uLampWhite.value, new THREE.Color(0.85, 0.95, 1.0), new THREE.Color(0.5, 0.9, 0.6)];
const INTENSITY = [140, 150, 55, 5]; // candela (Three's inverse-square PointLights), not lumens
const DIST = [34, 36, 16, 6];
// Physics groundHeight supplies the deck, not the authored 15 cm sidewalk surface.
const POOL_GROUND_OFFSET = 0.17;

export class LightPool {
  lights: THREE.PointLight[] = [];
  private assigned: (LightSource | null)[] = [];
  private target: number[] = [];
  private current: number[] = [];

  constructor(private ctx: GameContext, readonly size: number) {
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 2);
      l.castShadow = false;
      l.name = `props-lamp-${i}`;
      l.position.set(0, -1000, 0);
      ctx.scene.add(l);
      this.lights.push(l);
      this.assigned.push(null);
      this.target.push(0);
      this.current.push(0);
    }
  }

  /** Candidates are distance-sorted. Street lamps take priority over shed tubes and subway globes. */
  assign(candidates: LightSource[], lampFactor: number, dt: number, snap = false): void {
    const n = this.size;
    const wanted: LightSource[] = [];
    for (const src of candidates) {
      if (src.kind < 2) wanted.push(src);
      if (wanted.length === n) break;
    }
    if (wanted.length < n) for (const src of candidates) {
      if (src.kind >= 2) wanted.push(src);
      if (wanted.length === n) break;
    }
    // keep lights that are still wanted, free the others
    const keep = new Set<LightSource>(wanted);
    for (let i = 0; i < n; i++) {
      const a = this.assigned[i];
      if (a && !keep.has(a)) {
        this.target[i] = 0;
        // A screenshot/teleport must not wait for stale sources to fade before reusing their slots.
        if (snap) { this.assigned[i] = null; this.current[i] = 0; }
      }
    }
    // assign new sources to lights that are free (or fading out with intensity ~0)
    for (const src of wanted) {
      if (this.assigned.includes(src)) continue;
      let slot = -1;
      for (let i = 0; i < n; i++) {
        if (this.assigned[i] === null) {
          slot = i;
          break;
        }
      }
      if (slot < 0) {
        // steal the dimmest fading light
        let best = -1, bestI = Infinity;
        for (let i = 0; i < n; i++) {
          if (this.target[i] === 0 && this.current[i] < bestI) {
            bestI = this.current[i];
            best = i;
          }
        }
        if (best < 0 || bestI > 0.15) continue;
        slot = best;
      }
      this.assigned[slot] = src;
      this.current[slot] = 0;
      const l = this.lights[slot];
      l.position.set(src.x, src.y, src.z);
      l.color.copy(COLORS[src.kind]);
      l.distance = DIST[src.kind];
    }
    for (let i = 0; i < n; i++) {
      const src = this.assigned[i];
      if (src && keep.has(src)) this.target[i] = 1;
      const k = snap ? 1 : Math.min(1, Math.max(0, dt) * 4);
      this.current[i] += (this.target[i] - this.current[i]) * k;
      const l = this.lights[i];
      l.intensity = src ? INTENSITY[src.kind] * this.current[i] * lampFactor : 0;
      if (!src || (this.target[i] === 0 && this.current[i] < 0.01)) {
        this.assigned[i] = null;
        l.intensity = 0;
        l.position.set(0, -1000, 0);
      }
    }
  }

  removeSources(sources: LightSource[]): void {
    for (let i = 0; i < this.size; i++) {
      if (!this.assigned[i] || !sources.includes(this.assigned[i]!)) continue;
      this.assigned[i] = null;
      this.target[i] = this.current[i] = this.lights[i].intensity = 0;
      this.lights[i].position.set(0, -1000, 0);
    }
  }

  dispose(): void {
    for (const l of this.lights) {
      this.ctx.scene.remove(l);
      l.dispose();
    }
    this.assigned.fill(null);
  }
}

const MAX_POOLS = 1024;

export class PoolDecals {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  private aData: THREE.InstancedBufferAttribute;
  private shops = new Map<string, { segments?: readonly Storefront[]; sources: LightSource[] }>();
  private uniforms: { uMap: { value: THREE.Texture }; uLamp: { value: number }; uWet: { value: number } };

  constructor(private ctx: GameContext, uLamp: { value: number }, uWet: { value: number }) {
    const geom = new THREE.PlaneGeometry(2, 2);
    geom.rotateX(-Math.PI / 2);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * 4), 4);
    this.aData.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('aData', this.aData);
    this.uniforms = { uMap: { value: makePoolTexture() }, uLamp, uWet };
    this.material = new THREE.ShaderMaterial({
      name: 'props-lightpool',
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      vertexShader: /* glsl */ `
        attribute vec4 aData;
        varying vec2 vUv;
        varying vec4 vData;
        varying float vDist;
        void main() {
          vUv = uv;
          vData = aData;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec4 mv = viewMatrix * wp;
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uMap;
        uniform float uLamp;
        uniform float uWet;
        varying vec2 vUv;
        varying vec4 vData;
        varying float vDist;
        void main() {
          // The canvas gradient is white RGB with radial ALPHA, not a greyscale mask.
          float a = texture2D(uMap, vUv).a;
          vec3 c = vData.rgb;
          float strength = vData.w * uLamp * (1.0 + 0.8 * uWet);
          // fade with distance so far pools do not pile up into a bright haze
          strength *= 1.0 - smoothstep(180.0, 320.0, vDist);
          gl_FragColor = vec4(c * a * strength, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.InstancedMesh(geom, this.material, MAX_POOLS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'props-lightpools';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    const atmos = ctx.modules.get('atmosphere') as { setupMaterial?: (m: THREE.Material) => void } | undefined;
    try {
      atmos?.setupMaterial?.(this.material);
    } catch {
      /* optional */
    }
  }

  addTile(key: string): void { this.shops.set(key, { sources: [] }); }
  removeTile(key: string): void { this.shops.delete(key); }

  /** Existing lamp candidates stay separate from decal-only shops: no extra PointLights. */
  set(sources: LightSource[], camera?: THREE.Vector3, range = 300): void {
    if (camera) {
      const buildings = this.ctx.modules.get('buildings') as BuildingsModule | undefined;
      const nearby: LightSource[] = [];
      const distance2 = (s: LightSource) => (s.x - camera.x) ** 2 + (s.z - camera.z) ** 2;
      for (const [key, tile] of this.shops) {
        const segments = buildings?.storefronts(key);
        if (segments !== tile.segments) {
          tile.segments = segments;
          tile.sources = (segments ?? []).map(shop => {
            const x = shop.x + shop.nx * 1.3, z = shop.z + shop.nz * 1.3;
            return { x, z, y: 0, groundY: this.ctx.physics.groundHeight(x, z), kind: 0,
              poolX: shop.width / 2, poolZ: 1.3, yaw: Math.atan2(shop.nx, shop.nz), seed: 0,
              color: shop.color, get intensity() { return 0.28 * shop.lit; } };
          });
        }
        for (const source of tile.sources) if (source.intensity! > 0 && distance2(source) < range ** 2) nearby.push(source);
      }
      nearby.sort((a, b) => distance2(a) - distance2(b));
      nearby.length = Math.min(40, nearby.length);
      sources = [...nearby, ...sources.slice(0, MAX_POOLS - nearby.length)];
    }
    const n = Math.min(sources.length, MAX_POOLS);
    const im = this.mesh.instanceMatrix.array as Float32Array;
    const d = this.aData.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const s = sources[i];
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      const sx = s.poolX, sz = s.poolZ;
      const o = i * 16;
      im[o] = c * sx; im[o + 1] = 0; im[o + 2] = -sn * sx; im[o + 3] = 0;
      im[o + 4] = 0; im[o + 5] = 1; im[o + 6] = 0; im[o + 7] = 0;
      im[o + 8] = sn * sz; im[o + 9] = 0; im[o + 10] = c * sz; im[o + 11] = 0;
      im[o + 12] = s.x; im[o + 13] = (s.groundY ?? 0) + POOL_GROUND_OFFSET; im[o + 14] = s.z; im[o + 15] = 1;
      const strength = s.intensity ?? (s.kind === 0 ? 0.55 : s.kind === 1 ? 0.5 : s.kind === 2 ? 0.35 : 0.12);
      d[i * 4] = s.color?.[0] ?? COLORS[s.kind].r; d[i * 4 + 1] = s.color?.[1] ?? COLORS[s.kind].g;
      d[i * 4 + 2] = s.color?.[2] ?? COLORS[s.kind].b; d[i * 4 + 3] = strength;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aData.needsUpdate = true;
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.shops.clear();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.material.dispose();
    this.uniforms.uMap.value.dispose();
  }
}
