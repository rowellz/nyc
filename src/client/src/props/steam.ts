/**
 * Steam: one Points draw call. Every emitter (Con Ed stack, steaming manhole, subway grate) owns N
 * particles whose life is computed on the GPU from a seed and uTime: rise, wind drift, turbulence,
 * growth and fade. The CPU only rebuilds the buffer when the set of nearby emitters changes.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { makeSteamTexture } from './textures';

export interface SteamEmitter {
  x: number;
  y: number;
  z: number;
  /** 0 = manhole wisp, 1 = grate haze, 2 = Con Ed stack */
  kind: 0 | 1 | 2;
  seed: number;
}

const COUNTS = [24, 30, 110];
const MAX_PARTICLES = 6000;

export class SteamSystem {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private geom: THREE.BufferGeometry;
  private aPos: THREE.BufferAttribute;
  private aSeed: THREE.BufferAttribute;
  private aKind: THREE.BufferAttribute;
  private count = 0;
  private lastKey = '';
  readonly uniforms: {
    uTime: { value: number };
    uWind: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uSkyColor: { value: THREE.Color };
    uLamp: { value: number };
    uMap: { value: THREE.Texture };
    uFogColor: { value: THREE.Color };
    uFogDensity: { value: number };
    uPixelRatio: { value: number };
  };

  constructor(ctx: GameContext, uLamp: { value: number }) {
    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: new THREE.Vector3(0.6, 0, 0.3) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSkyColor: { value: new THREE.Color(0.5, 0.6, 0.75) },
      uLamp,
      uMap: { value: makeSteamTexture() },
      uFogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
      uFogDensity: { value: 0.0008 },
      uPixelRatio: { value: ctx.renderer.getPixelRatio() },
    };
    const atmos = ctx.modules.get('atmosphere') as { uniforms?: Record<string, { value: unknown }> } | undefined;
    const u = atmos?.uniforms;
    if (u) {
      if (u.uSunColor) this.uniforms.uSunColor = u.uSunColor as { value: THREE.Color };
      if (u.uSkyColor) this.uniforms.uSkyColor = u.uSkyColor as { value: THREE.Color };
      if (u.uFogColor) this.uniforms.uFogColor = u.uFogColor as { value: THREE.Color };
      if (u.uFogDensity) this.uniforms.uFogDensity = u.uFogDensity as { value: number };
    }
    this.geom = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    this.aSeed = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
    this.aKind = new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES), 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aSeed.setUsage(THREE.DynamicDrawUsage);
    this.aKind.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute('position', this.aPos);
    this.geom.setAttribute('aSeed', this.aSeed);
    this.geom.setAttribute('aKind', this.aKind);
    this.geom.setDrawRange(0, 0);
    this.geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      name: 'props-steam',
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute float aKind;
        uniform float uTime;
        uniform vec3 uWind;
        uniform float uPixelRatio;
        varying float vAlpha;
        varying float vLife;
        varying float vFogDepth;
        varying float vKind;
        varying float vRot;
        float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
        void main() {
          // per-particle constants from the seed
          float r0 = h1(aSeed), r1 = h1(aSeed + 1.7), r2 = h1(aSeed + 3.1), r3 = h1(aSeed + 5.3);
          float dur = aKind > 1.5 ? 6.0 + r0 * 4.0 : (aKind > 0.5 ? 3.0 + r0 * 2.0 : 2.5 + r0 * 2.0);
          float rate = 1.0 / dur;
          float life = fract(uTime * rate + r1);            // 0..1
          float t = life * dur;
          // start offset (source area) and motion
          float src = aKind > 1.5 ? 0.22 : (aKind > 0.5 ? 1.2 : 0.35);
          vec3 p = position + vec3((r2 - 0.5) * src, 0.0, (r3 - 0.5) * src);
          float rise = aKind > 1.5 ? 2.6 : (aKind > 0.5 ? 0.45 : 0.7);
          // buoyant rise slows as it cools; wind takes over
          p.y += rise * t * (1.0 - 0.35 * life);
          p += uWind * t * (0.35 + 0.65 * life);
          // turbulence
          float ph = aSeed * 0.37;
          p.x += sin(t * 1.3 + ph) * 0.25 * life + sin(t * 3.1 + ph * 2.0) * 0.08;
          p.z += cos(t * 1.1 + ph * 1.3) * 0.25 * life + cos(t * 2.7 + ph) * 0.08;
          // size grows with life
          float base = aKind > 1.5 ? 1.3 : (aKind > 0.5 ? 1.0 : 0.55);
          float size = base * (0.35 + 3.0 * life);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * 900.0 * uPixelRatio / dist, 1.0, 240.0);
          // fade in fast, out slow; thinner for wisps
          float a = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.3, 1.0, life));
          a *= aKind > 1.5 ? 0.5 : (aKind > 0.5 ? 0.14 : 0.22);
          vRot = r2 * 6.2831 + (r3 - 0.5) * t * 1.2;
          // distance fade so far steam does not turn into blobs
          a *= 1.0 - smoothstep(120.0, 220.0, dist);
          vAlpha = a;
          vLife = life;
          vFogDepth = dist;
          vKind = aKind;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uMap;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uLamp;
        varying float vAlpha;
        varying float vLife;
        varying float vFogDepth;
        varying float vKind;
        varying float vRot;
        void main() {
          // rotate the sprite per particle so the puffs do not all share one silhouette
          vec2 pc = gl_PointCoord - 0.5;
          float cs = cos(vRot), sn = sin(vRot);
          vec2 rc = vec2(pc.x * cs - pc.y * sn, pc.x * sn + pc.y * cs) + 0.5;
          vec4 tex = texture2D(uMap, rc);
          float a = tex.a * vAlpha;
          if (a < 0.004) discard;
          // lit by sun + sky in the day (brighter toward the top of each puff), warm sodium/LED glow at night
          float top = 0.75 + 0.5 * (0.5 - pc.y);
          vec3 day = (uSunColor * 0.5 * top + uSkyColor * 0.55);
          vec3 night = vec3(0.85, 0.7, 0.5) * (0.35 + 0.3 * top);
          vec3 col = mix(day, night, uLamp) * (0.9 + 0.1 * (1.0 - vLife));
          col = clamp(col, 0.0, 1.5);
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
          col = mix(col, uFogColor, fog);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.points = new THREE.Points(this.geom, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 50;
    this.points.name = 'props-steam';
    const atmosM = ctx.modules.get('atmosphere') as { setupMaterial?: (m: THREE.Material) => void } | undefined;
    try {
      atmosM?.setupMaterial?.(this.material);
    } catch {
      /* optional */
    }
  }

  /** rebuild the particle buffer for these emitters (call when the nearby set changes) */
  setEmitters(emitters: SteamEmitter[]): void {
    const key = emitters.map((e) => e.seed).join(',');
    if (key === this.lastKey) return;
    this.lastKey = key;
    let n = 0;
    const pos = this.aPos.array as Float32Array;
    const seed = this.aSeed.array as Float32Array;
    const kind = this.aKind.array as Float32Array;
    for (const e of emitters) {
      const c = COUNTS[e.kind];
      for (let i = 0; i < c && n < MAX_PARTICLES; i++) {
        pos[n * 3] = e.x;
        pos[n * 3 + 1] = e.y;
        pos[n * 3 + 2] = e.z;
        seed[n] = (e.seed % 1000) * 7.31 + i * 1.618;
        kind[n] = e.kind;
        n++;
      }
    }
    this.count = n;
    this.aPos.needsUpdate = true;
    this.aSeed.needsUpdate = true;
    this.aKind.needsUpdate = true;
    this.geom.setDrawRange(0, n);
    this.points.visible = n > 0;
  }

  update(t: number, wind: { speed: number; dir: number }, pixelRatio: number): void {
    this.uniforms.uTime.value = t;
    // windDir: yaw convention, direction the wind blows TOWARD. forward for yaw = (sin(-yaw), -cos(-yaw))
    const heading = -wind.dir;
    const s = Math.min(6, wind.speed) * 0.18 + 0.15;
    this.uniforms.uWind.value.set(Math.sin(heading) * s, 0, -Math.cos(heading) * s);
    this.uniforms.uPixelRatio.value = pixelRatio;
  }

  get particleCount(): number {
    return this.count;
  }

  dispose(): void {
    this.geom.dispose();
    this.material.dispose();
    this.uniforms.uMap.value.dispose();
  }
}
