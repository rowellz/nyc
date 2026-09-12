/** A texture-free road surface for phones. Paint is a separate street mesh. */
export function createMobileRoadMaterial(Material, installPatch, shared) {
  // Keep standard lighting, fog and atmosphere integration, but avoid the
  // desktop surface's texture reads, normal perturbations, cracks and ripples.
  const material = new Material({ color: 0xffffff, roughness: 0.95, metalness: 0, envMapIntensity: 0 });
  material.name = 'streets-road';
  material.userData.mobileRoadColors = true;
  const uniforms = { uMobileRoadWetness: shared.uWetness };
  installPatch(material, 'streets-road-mobile-colors-v1', shader => {
    Object.assign(shader.uniforms, uniforms);
    material.userData.streetUniforms = shader.uniforms;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aA;
varying float vMobileRoadGray;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
// aA.x is surface kind; aA.w is a stable per-road seed. Colors are linear.
float roadGray = mix(0.105, 0.145, clamp(aA.w, 0.0, 1.0));
if (aA.x > 3.5 && aA.x < 4.5) roadGray += 0.12;
if (aA.x > 5.5 && aA.x < 6.5) roadGray += 0.055;
vMobileRoadGray = roadGray;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uMobileRoadWetness;
varying float vMobileRoadGray;`)
      .replace('#include <map_fragment>', `
diffuseColor.rgb *= vec3(vMobileRoadGray * (1.0 - 0.18 * clamp(uMobileRoadWetness, 0.0, 1.0)));`);
  });
  return { material, uniforms };
}
