/**
 * One MeshStandardMaterial for every weapon (and pickup prop) so a whole gun is a single draw call:
 *  - vertex color = albedo
 *  - attribute aMat = (metalness, roughness, kind) with kind 0 polymer / 1 steel / 2 wood / 3 anodized aluminum / 4 brass
 *  - uv = metric planar projection (meters) so detail normals tile at a physical size
 * The shader picks a detail normal map by kind (polymer stipple, brushed steel, walnut grain), applies the walnut
 * albedo to wood, and adds subtle roughness variation + edge wear from a grunge mask.
 * MeshStandardMaterial keeps the atmosphere module's fog / CSM shadow / env-map patching intact.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { getWeaponTextures } from './textures';

export const MatKind = { polymer: 0, steel: 1, wood: 2, anodized: 3, brass: 4 } as const;

const shared = new Map<boolean, THREE.MeshStandardMaterial>();

/** chain an onBeforeCompile hook after whatever is already installed (e.g. by the atmosphere module) */
export function chainOnBeforeCompile(m: THREE.Material, fn: (shader: THREE.WebGLProgramParametersWithUniforms) => void, key: string): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(m, shader, renderer);
    fn(shader);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|${key}`;
}

export function getWeaponMaterial(ctx: GameContext, wood = false): THREE.MeshStandardMaterial {
  const ready = shared.get(wood);
  if (ready) return ready;
  const t = getWeaponTextures(wood);
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: 1,
    roughness: 1,
    normalMap: t.polymerNormal,
    normalScale: new THREE.Vector2(0.55, 0.55),
    envMapIntensity: 1.35,
  });
  m.name = 'weaponShared';
  const uniforms = {
    uSteelN: { value: t.steelNormal },
    uWoodN: { value: t.woodNormal },
    uWoodMap: { value: t.woodMap },
    uGrunge: { value: t.grunge },
  };
  chainOnBeforeCompile(
    m,
    (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aMat;\nvarying vec3 vMat;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <normalmap_pars_fragment>',
          `#include <normalmap_pars_fragment>
varying vec3 vMat;
uniform sampler2D uSteelN; uniform sampler2D uWoodN; uniform sampler2D uWoodMap; uniform sampler2D uGrunge;
vec4 sampleDetailN(vec2 uv) {
  float k = vMat.z;
  if (k < 0.5) return texture2D(normalMap, uv * 80.0);            // polymer stipple ~12 mm tile
  if (k < 1.5 || k > 2.5) return texture2D(uSteelN, uv * 24.0);   // brushed steel / anodized ~4 cm tile
  return texture2D(uWoodN, uv * vec2(3.0, 1.5));                  // walnut grain ~33 cm tile
}`,
        )
        // onBeforeCompile runs before Three expands includes; patch the normal chunk explicitly.
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replaceAll('texture2D( normalMap, vNormalMapUv )', 'sampleDetailN( vNormalMapUv )'))
        .replace(
          '#include <roughnessmap_fragment>',
          `vec4 grunge = texture2D(uGrunge, vNormalMapUv * 7.0);
float roughnessFactor = clamp(vMat.y + (grunge.r - 0.5) * 0.22 + wear * 0.12, 0.04, 1.0);`,
        )
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vMat.x;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float wear = texture2D(uGrunge, vNormalMapUv * 2.3 + 0.37).g;
if (vMat.z > 1.5 && vMat.z < 2.5) diffuseColor.rgb *= texture2D(uWoodMap, vNormalMapUv * vec2(3.0, 1.5)).rgb * 1.15;
else if (vMat.z < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.6 + 0.02, wear * 0.35);
else diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.62, 0.64), wear * 0.55);`,
        );
    },
    'weaponShared',
  );
  const atm = ctx.modules.get('atmosphere') as { setupMaterial?: (m: THREE.Material) => void } | undefined;
  atm?.setupMaterial?.(m);
  shared.set(wood, m);
  return m;
}

export function disposeWeaponMaterial(): void {
  for (const m of shared.values()) m.dispose();
  shared.clear();
}
