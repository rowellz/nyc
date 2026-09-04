/**
 * Facade material: MeshStandardMaterial extended through onBeforeCompile so CSM shadows, fog and env
 * reflections from the atmosphere module keep working. Uniforms shared with the atmosphere module are
 * referenced by object identity when it exists.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { FACADE_FRAGMENT_MAIN, FACADE_FRAGMENT_PARS, FACADE_VERTEX_MAIN, FACADE_VERTEX_PARS } from './shader';
import { styleUniformTable } from './styles';
import { SIGN_ROWS } from './builder';

export interface AtmosphereLike {
  uniforms?: Record<string, { value: unknown }>;
  setupMaterial?(m: THREE.Material): void;
  envMap?: THREE.Texture | null;
}

export interface FacadeUniforms {
  uStyle: { value: Float32Array };
  uNight: { value: number };
  uTime: { value: number };
  uWet: { value: number };
  uDetailDist: { value: number };
  uEmissive: { value: number };
  uSignAtlas: { value: THREE.Texture };
  uSignRows: { value: number };
  uSkyZenith: { value: THREE.Color };
  uSkyHorizon: { value: THREE.Color };
  uTexBrick: { value: THREE.Texture | null };
  uTexBrickN: { value: THREE.Texture | null };
  uTexStone: { value: THREE.Texture | null };
  uTexConcrete: { value: THREE.Texture | null };
  uTexRoof: { value: THREE.Texture | null };
  uTexScale: { value: THREE.Vector4 };
  uTexScaleY: { value: THREE.Vector4 };
  uTexBrickMean: { value: THREE.Vector3 }; // linear mean colour of the brick albedo (for retinting)
  uTexBrickNK: { value: number }; // brick normal-map strength, 0 until the map is loaded
  /** true when uNight/uTime/uWet are the atmosphere's objects (do not write them) */
  shared: boolean;
}

export function createFacadeUniforms(ctx: GameContext, signAtlas: THREE.Texture): FacadeUniforms {
  const atm = ctx.modules.get('atmosphere') as AtmosphereLike | undefined;
  const au = atm?.uniforms;
  const pick = (name: string, def: number): { value: number } => {
    const u = au?.[name];
    if (u && typeof u.value === 'number') return u as { value: number };
    return { value: def };
  };
  const shared = !!(au && typeof au.uNight?.value === 'number' && typeof au.uTime?.value === 'number');
  const q = ctx.quality.level;
  return {
    uStyle: { value: styleUniformTable() },
    uNight: pick('uNight', 0),
    uTime: pick('uTime', 0),
    uWet: pick('uWetness', 0),
    uDetailDist: { value: q === 'ultra' || q === 'high' ? 520 : q === 'medium' ? 380 : 260 },
    uEmissive: { value: 1.6 },
    uSignAtlas: { value: signAtlas },
    uSignRows: { value: SIGN_ROWS },
    uSkyZenith: { value: new THREE.Color(0.3, 0.5, 0.9) },
    uSkyHorizon: { value: new THREE.Color(0.75, 0.8, 0.9) },
    uTexBrick: { value: null },
    uTexBrickN: { value: null },
    uTexStone: { value: null },
    uTexConcrete: { value: null },
    uTexRoof: { value: null },
    uTexScale: { value: new THREE.Vector4(1, 1, 1, 1) },
    uTexScaleY: { value: new THREE.Vector4(1, 1, 1, 1) },
    uTexBrickMean: { value: new THREE.Vector3(0.35, 0.3, 0.28) },
    uTexBrickNK: { value: 0 },
    shared,
  };
}

export function createFacadeMaterial(uniforms: FacadeUniforms, opts: { textures: boolean }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, side: THREE.FrontSide, envMapIntensity: 1.0 });
  mat.name = 'facade';
  if (opts.textures) mat.defines = { USE_FACADE_TEX: '' };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    const { shared: _s, ...rest } = uniforms;
    for (const [k, v] of Object.entries(rest)) shader.uniforms[k] = v as THREE.IUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + FACADE_VERTEX_PARS)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + FACADE_VERTEX_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_FRAGMENT_PARS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nfloat facadeAO = 1.0;\nvec3 facadeSpec = vec3(0.04);\nfloat facadeSpecMix = 0.0;\n' + FACADE_FRAGMENT_MAIN)
      // glass: explicit coated-glass F0 (0.13-0.26, tinted) instead of the metalness workflow's albedo-coupled F0
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColorBlended = mix(material.specularColorBlended, facadeSpec, facadeSpecMix);')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= facadeAO;\nreflectedLight.indirectSpecular *= facadeAO;\nreflectedLight.directDiffuse *= mix(1.0, facadeAO, 0.5);');
  };
  mat.customProgramCacheKey = () => `facade-v2-${opts.textures ? 'tex' : 'proc'}`;
  return mat;
}
