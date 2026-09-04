/**
 * Aerial perspective as a post-process effect: two exponential height layers (aerosol haze + ground fog)
 * integrated analytically along each pixel's view ray, in-scattering coloured by the real sky LUT at the
 * horizon in that direction plus the sun's forward (Mie) scattering, city glow at night, lightning.
 */
import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { LUT_SAMPLE_GLSL } from './sky';

const FRAG = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec2 uNearFar;
uniform sampler2D uLut;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uPollution;
uniform vec3 uFogColor;
uniform float uHazeDensity;
uniform float uHazeH;
uniform float uFogDensity;
uniform float uFogH;
uniform float uSunScatter;
uniform float uMieG;
uniform float uCloudCover;
uniform vec3 uFogTint;
uniform float uFogTintMix;
uniform float uFlash;
${LUT_SAMPLE_GLSL}

float layerOD(float y0, float dy, float dist, float sigma, float H) {
  if (sigma <= 0.0) return 0.0;
  float t = dy * dist / H;
  // (1-exp(-t))/t, with its horizontal-ray limit. Test the total height change, not just ray slope,
  // and avoid cancellation near the horizon. At sea level this is exactly sigma * distance.
  float integral = abs(t) < 0.01 ? 1.0 - t * 0.5 + t * t / 6.0 : (1.0 - exp(-t)) / t;
  return sigma * exp(-y0 / H) * dist * integral;
}
float fogPhase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (12.566371 * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  // Only clear depth is sky. With near=0.3/far=12000 the old epsilon discarded real geometry past
  // ~11.77 km, removing all haze there. EffectPass supplies conventional depth (it decodes log depth).
  if (depth >= 1.0) { outputColor = inputColor; return; }
  // Positive-sum perspective inversion avoids subtracting almost equal inverse-projection terms at
  // 5-12 km. Derive direction at mid clip depth, then use radial distance, including off-axis >12 km rays.
  float viewDepth = uNearFar.x * uNearFar.y / (uNearFar.x + (1.0 - depth) * (uNearFar.y - uNearFar.x));
  vec3 viewRay = (uInvProj * vec4(uv * 2.0 - 1.0, 0.0, 1.0)).xyz;
  float dist = viewDepth * length(viewRay) / abs(viewRay.z);
  vec3 dir = normalize(mat3(uCamWorld) * viewRay);
  float y0 = max(uCamPos.y, 0.0);
  float od = layerOD(y0, dir.y, dist, uHazeDensity, uHazeH) + layerOD(y0, dir.y, dist, uFogDensity, uFogH);
  float T = exp(-max(od, 0.0));
  vec3 dh = normalize(vec3(dir.x, max(dir.y, 0.0) * 0.25 + 0.02, dir.z));
  vec3 skyH = sampleSkyLut(uLut, dh);
  float mu = dot(dir, uSunDir);
  // Blue-grey hemispherical fill away from the sun; full horizon radiance
  // and the Mie lobe warm only the forward-facing part of the atmosphere.
  // The forward lobe widens as the sun drops: low-sun haze catches the light over a broad sector.
  float lowSun = 1.0 - smoothstep(0.05, 0.35, uSunDir.y);
  float sunward = smoothstep(mix(0.65, 0.4, lowSun), 0.98, mu);
  vec3 inscat = mix(uFogColor, skyH, 0.25 + 0.5 * sunward);
  inscat += uSunColor * fogPhase(mu, uMieG) * uSunScatter * sunward;
  inscat = mix(inscat, uFogTint, uFogTintMix);
  inscat += vec3(0.75, 0.82, 1.0) * uFlash * 0.5;
  outputColor = vec4(inputColor.rgb * T + inscat * (1.0 - T), inputColor.a);
}
`;

export class AerialPerspectiveEffect extends Effect {
  constructor(private camera: THREE.PerspectiveCamera, lut: THREE.Texture) {
    super('AerialPerspective', FRAG, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uNearFar', new THREE.Uniform(new THREE.Vector2(camera.near, camera.far))],
        ['uLut', new THREE.Uniform(lut)],
        ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uSunColor', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uPollution', new THREE.Uniform(new THREE.Vector3())],
        ['uFogColor', new THREE.Uniform(new THREE.Vector3(0.5, 0.6, 0.7))],
        ['uHazeDensity', new THREE.Uniform(3e-4)],
        ['uHazeH', new THREE.Uniform(1400)],
        ['uFogDensity', new THREE.Uniform(0)],
        ['uFogH', new THREE.Uniform(90)],
        ['uSunScatter', new THREE.Uniform(0.15)],
        ['uMieG', new THREE.Uniform(0.7)],
        ['uCloudCover', new THREE.Uniform(0)],
        ['uFogTint', new THREE.Uniform(new THREE.Vector3(0.5, 0.5, 0.5))],
        ['uFogTintMix', new THREE.Uniform(0)],
        ['uFlash', new THREE.Uniform(0)],
      ]),
    });
  }

  u(name: string): THREE.Uniform {
    return this.uniforms.get(name)!;
  }

  override update(): void {
    const cam = this.camera;
    (this.u('uInvProj').value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (this.u('uCamWorld').value as THREE.Matrix4).copy(cam.matrixWorld);
    (this.u('uCamPos').value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
    (this.u('uNearFar').value as THREE.Vector2).set(cam.near, cam.far);
  }
}
