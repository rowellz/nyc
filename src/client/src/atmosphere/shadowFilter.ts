import * as THREE from 'three';

/** r185's five-tap PCF rotates a sparse disk with screen-space IGN. Without TAA
 * that noise is visible on still pavement. Use a fixed, bilinearly filtered
 * separable tent for directional/spot shadows; retain the native depth format.
 *
 * Each tap also carries a receiver-plane depth bias: the shadow-map depth gradient
 * of the surface being shaded, solved from the shadow coordinate's screen-space
 * derivatives. That is what stops a filtered lookup from self-shadowing, so the
 * constant and normal biases no longer have to cover the filter footprint. The old
 * 1.6-texel normal bias was 5.5 cm on the near cascade (enough to erase a chair
 * leg's shadow outright) and 72 cm on the far one (every distant building floating
 * off its own base); lighting.ts can now hold it under 8 cm everywhere.
 */
export const FILTERED_SHADOW_CHUNK = THREE.ShaderChunk.shadowmap_pars_fragment.replace(
  /\t\tfloat getShadow\( sampler2DShadow[\s\S]*?\n\t\t\}\n/,
  /* glsl */ `
    float getShadow(sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity,
      float shadowBias, float shadowRadius, vec4 shadowCoord) {
      shadowCoord.xyz /= shadowCoord.w;
      if (shadowCoord.x < 0.0 || shadowCoord.x > 1.0 || shadowCoord.y < 0.0 || shadowCoord.y > 1.0 || shadowCoord.z > 1.0) return 1.0;
      vec2 texel = 1.0 / shadowMapSize;
      vec3 shadowDx = dFdx(shadowCoord.xyz);
      vec3 shadowDy = dFdy(shadowCoord.xyz);
      float det = shadowDx.x * shadowDy.y - shadowDx.y * shadowDy.x;
      vec2 slope = vec2(0.0);
      if (abs(det) > 1e-9) {
        slope = vec2(shadowDy.y * shadowDx.z - shadowDx.y * shadowDy.z,
                     shadowDx.x * shadowDy.z - shadowDy.x * shadowDx.z) / det;
      }
      // A cascade seam or a silhouette makes those derivatives meaningless, so cap the
      // per-texel depth slope well above a grazing ground plane under a low sun.
      vec2 depthPerTexel = clamp(slope * texel, vec2(-0.002), vec2(0.002));
      // Sub-texel spread is fine: hardware PCF already filters each tap bilinearly.
      float spread = max(0.5, shadowRadius * 0.5);
      float shadow = 0.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 tap = vec2(float(x), float(y)) * spread;
        float weight = (x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0);
        float depth = shadowCoord.z + shadowBias + dot(depthPerTexel, tap);
        shadow += weight * texture(shadowMap, vec3(shadowCoord.xy + tap * texel, depth));
      }
      return mix(1.0, shadow / 16.0, shadowIntensity);
    }
`);
