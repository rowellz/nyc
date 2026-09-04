/**
 * Material patch helpers for the environment module.
 *
 * chainCompile() installs an onBeforeCompile hook that SURVIVES another module (atmosphere / CSM) assigning
 * `material.onBeforeCompile = fn` afterwards: the later hook runs after ours, and a wrapper that captured ours
 * as "prev" does not recurse. customProgramCacheKey is derived from our key + the external hook so three's
 * program cache stays correct.
 */
import * as THREE from 'three';

export type Shader = THREE.WebGLProgramParametersWithUniforms;
export type CompileHook = (shader: Shader, renderer: THREE.WebGLRenderer) => void;

function strHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function chainCompile(mat: THREE.Material, key: string, mine: CompileHook): void {
  let external: CompileHook | null = null;
  let running = false;
  const chained = function (this: unknown, shader: Shader, renderer: THREE.WebGLRenderer): void {
    if (running) return; // re-entrant call from a wrapper that captured us as "prev"
    running = true;
    try {
      mine(shader, renderer);
      if (external) external.call(mat, shader, renderer);
    } finally {
      running = false;
    }
  };
  Object.defineProperty(mat, 'onBeforeCompile', {
    configurable: true,
    enumerable: true,
    get: () => chained,
    set: (fn: CompileHook | undefined) => {
      external = typeof fn === 'function' && fn !== chained ? fn : null;
      mat.needsUpdate = true;
    },
  });
  mat.customProgramCacheKey = () => (external ? `${key}|${strHash(external.toString())}` : key);
}

/** GLSL: cheap hash / value noise / fbm + an anti-tiling texture sampler. Prefix `env` to avoid clashes. */
export const GLSL_NOISE = /* glsl */ `
float envHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 envHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float envNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash12(i), envHash12(i + vec2(1.0, 0.0)), f.x), mix(envHash12(i + vec2(0.0, 1.0)), envHash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float envFbm(vec2 p) {
  return (envNoise(p) * 0.5 + envNoise(p * 2.03 + 7.1) * 0.25 + envNoise(p * 4.07 + 3.3) * 0.125) / 0.875;
}
vec4 envTexNoTile(sampler2D tex, vec2 uv) {
  float k = envNoise(uv * 0.06);
  vec2 duvdx = dFdx(uv), duvdy = dFdy(uv);
  float l = k * 8.0;
  float f = fract(l);
  float ia = floor(l), ib = ia + 1.0;
  vec2 offa = sin(vec2(3.0, 7.0) * ia);
  vec2 offb = sin(vec2(3.0, 7.0) * ib);
  vec4 cola = textureGrad(tex, uv + offa, duvdx, duvdy);
  vec4 colb = textureGrad(tex, uv + offb, duvdx, duvdy);
  return mix(cola, colb, smoothstep(0.2, 0.8, f - 0.1 * dot(cola.xyz - colb.xyz, vec3(1.0))));
}
`;

/** vertex-shader-safe subset (no derivatives) */
export const GLSL_NOISE_VS = /* glsl */ `
float envHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 envHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float envNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash12(i), envHash12(i + vec2(1.0, 0.0)), f.x), mix(envHash12(i + vec2(0.0, 1.0)), envHash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/** Uniforms shared by every environment material. Some are the atmosphere module's objects (by identity). */
export interface SharedUniforms {
  uTime: { value: number };
  uWetness: { value: number };
  uRain: { value: number };
  uNight: { value: number };
  uWind: { value: THREE.Vector2 }; // xz direction * speed (m/s)
  uSeason: { value: number }; // 0 lush .. 1 dry
  uSafe: { value: THREE.Vector3 }; // safe zone x, z, radius (Bryant Park lawn: mowing stripes)
}
