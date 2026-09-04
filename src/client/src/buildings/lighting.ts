/** Leave HDR headroom for bloom, preserving hue instead of clipping RGB channels independently. */
export const MAX_FACADE_EMISSIVE = 2.0;
export const FACADE_EMISSIVE_GLSL = /* glsl */ `
vec3 limitFacadeEmission(vec3 emission) {
  float peak = max(max(emission.r, emission.g), emission.b);
  return emission * min(1.0, ${MAX_FACADE_EMISSIVE.toFixed(1)} / max(peak, 0.0001));
}
`;
