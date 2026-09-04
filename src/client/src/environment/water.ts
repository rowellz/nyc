/**
 * Water: ONE 26 km plane at y = WATER_LEVEL that follows the camera. Land tiles draw over it at y = 0 and the
 * ground shader discards water texels, so rivers, lakes and open-water tiles all come from this single mesh.
 * Material: MeshPhysicalMaterial (ior 1.33 -> Fresnel of the environment map, GGX sun glitter, fog, shadows)
 * with distance-filtered world-space normal-map octaves, wind-driven chop, whitecaps in strong wind,
 * rain ripples from uRain, and murk variation. Also a fallback PMREM sky for reflections until the atmosphere
 * module provides its own environment map.
 *
 * The env map is a sky only, and SSR gives up long before the skyline (uSSRMaxDistance 1600 m against a
 * 2-3 km reflected path from a 10 m camera), so the city never appeared in the river. A planar pass renders
 * ONLY the far-LOD skyline group through a camera mirrored about y = WATER_LEVEL into a half-res target,
 * which the fragment shader samples by projected world position, smears along the wave slope, blurs by
 * roughness and blends by Fresnel. Driven from mesh.onBeforeRender, so no call-site change is needed.
 */
import * as THREE from 'three';
import { chainCompile, GLSL_NOISE, type SharedUniforms } from './patch';
import { WATER_LEVEL } from './ground';

export interface WaterSystem {
  mesh: THREE.Mesh;
  mat: THREE.MeshPhysicalMaterial;
  update(camera: THREE.Camera): void;
  setEnvMap(t: THREE.Texture | null): void;
  setHaze(color: THREE.Color, density: number, postFog: boolean): void;
  setNormalMap(t: THREE.Texture): void;
  dispose(): void;
}

const WATER_PARS = /* glsl */ `
uniform sampler2D uWaterN;
uniform sampler2D uMirrorTex;
uniform float uTime, uRain;
uniform vec3 uWaterHorizon;
uniform float uWaterFogDensity, uWaterPostFog, uMirrorOn;
uniform vec2 uWind;
varying vec2 vWorldXZ;
varying vec4 vMirrorClip;
${GLSL_NOISE}
vec2 envRot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// Smooth, non-periodic-in-UV phase offsets break the normal image's square
// lattice without extra texture fetches or discontinuous per-cell rotations.
vec2 envWaterUV(vec2 uv, float fade) {
  return uv + fade * 0.23 * vec2(sin(dot(uv, vec2(1.73, 2.31))), sin(dot(uv, vec2(-2.17, 1.41))));
}
vec2 envRainRipples(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  vec2 cell = floor(p * 2.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 h = envHash22(c);
    vec2 center = (c + h) * 0.5;
    float phase = fract(t * 1.4 + envHash12(c * 1.7 + 3.1));
    float r = length(p - center);
    float ringR = phase * 0.42;
    float ring = exp(-pow((r - ringR) / 0.045, 2.0)) * (1.0 - phase);
    acc += normalize(p - center + vec2(1e-4)) * ring * sin((r - ringR) * 70.0);
  }
  return acc;
}
`;

const WATER_MAP = /* glsl */ `
vec2 envSlope = vec2(0.0); // world-space wave slope, filled by the normal block, used by the planar mirror
vec2 wp = vWorldXZ;
float ws = length(uWind);
vec2 wd = ws > 0.01 ? uWind / ws : vec2(0.7, 0.7);
float wDist = length(vViewPosition);
// Silt-laden estuary: broad, slow drifts of turbidity (hundreds of metres), never 50 m blotches.
float murk = envFbm(wp * 0.005 + uTime * 0.003) * 0.65 + envNoise(wp * 0.028 - uTime * 0.008) * 0.35;
diffuseColor.rgb *= mix(0.86, 1.14, murk);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.068, 0.046), smoothstep(0.55, 0.85, murk) * 0.35); // brown silt plumes
// wind streaks: long dark/light lanes along the wind (Hudson from the shore)
float lane = envNoise(vec2(dot(wp, vec2(-wd.y, wd.x)) * 0.05, dot(wp, wd) * 0.006 + uTime * 0.01));
diffuseColor.rgb *= mix(0.94, 1.06, lane);
// whitecaps only in real wind (>4 m/s), breaking crests aligned with it, near field only
float capN = envNoise(wp * 0.35 + wd * uTime * 0.18) * 0.6 + envNoise(wp * 1.3 - wd * uTime * 0.4) * 0.4;
float cap = smoothstep(0.72, 0.80, capN) * smoothstep(4.0, 10.0, ws) * (1.0 - smoothstep(120.0, 500.0, wDist));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.58, 0.56), cap);
// Oily flats: slow patches 100-300 m long, stretched ~3x along the wind, where the chop is damped and the water
// turns to a darker, sharper mirror of the sky (the Hudson from the shore: dark glassy lanes between chop).
vec2 wpp = vec2(-wd.y, wd.x);
float envSlick = smoothstep(0.54, 0.70, envFbm(vec2(dot(wp, wd) * 0.0045, dot(wp, wpp) * 0.013) + uTime * 0.0015));
envSlick *= 1.0 - smoothstep(1.0, 9.0, ws) * 0.7 - uRain;
envSlick = clamp(envSlick, 0.0, 1.0);
diffuseColor.rgb *= mix(1.0, 0.86, envSlick);
// Looking upwind you see the steep windward faces (brighter, rougher); downwind the backs (darker, smoother).
vec2 envViewXZ = normalize(wp - cameraPosition.xz + vec2(1e-4, 0.0));
float envUpwind = dot(envViewXZ, -wd) * 0.5 + 0.5;
// Roughness: glassy facets close up (the sun glitters, the sky reflects as a broken mirror); chop that the
// normal octaves no longer resolve with distance becomes lobe width instead of vanishing into a flat mirror.
float envLod = smoothstep(20.0, 400.0, wDist);
float envRough = mix(0.05, 0.24, envLod) + 0.08 * smoothstep(1.0, 9.0, ws) + 0.25 * uRain;
envRough += 0.05 * (envUpwind - 0.5);
envRough *= mix(1.0, 0.45, envSlick);
envRough = mix(envRough, 0.75, cap);
`;

const WATER_NORMAL = /* glsl */ `
{
  vec2 wp = vWorldXZ;
  float ws = length(uWind);
  vec2 wd = ws > 0.01 ? uWind / ws : vec2(0.7, 0.7);
  float t = uTime;
  float d = length(vViewPosition);
  float nearWarp = 1.0 - smoothstep(30.0, 120.0, d);
  // Fade short waves first; the old common cutoff kept the repeating pattern
  // sharp for hundreds of metres, then flattened every octave into a hard band.
  // Swell (20-40 m, slow, low slope: 30 cm on 30 m is ~0.06 rad) under four chop octaves at non-harmonic
  // scales/rotations so no repeat shows; short waves fade first with distance.
  vec2 uv0 = envRot(wp / 31.0, 0.35) + wd * t * 0.020;
  vec2 uv1 = envRot(wp / 61.0, -0.4) + wd * t * 0.010;
  vec2 uv2 = envRot(wp / 17.0, 0.9) - wd * t * 0.04;
  vec2 uv3 = envRot(wp / 5.3, 2.1) + wd * t * 0.09;
  vec2 uv4 = envRot(wp / 1.7, -0.7) - envRot(wd, 0.5) * t * 0.16;
  vec3 n0 = texture2D(uWaterN, uv0).xyz * 2.0 - 1.0;
  vec3 n1 = texture2D(uWaterN, envWaterUV(uv1, nearWarp)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uWaterN, envWaterUV(uv2, nearWarp)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(uWaterN, envWaterUV(uv3, nearWarp)).xyz * 2.0 - 1.0;
  vec3 n4 = texture2D(uWaterN, envWaterUV(uv4, nearWarp)).xyz * 2.0 - 1.0;
  // Real wind-chop slopes are ~0.1-0.25 rms; the old 0.8/0.7 weights tilted the far water 30-40 degrees, so
  // every distant facet mirrored the dark lower hemisphere (navy speckle) instead of the sky. The 61 m octave
  // at 0.22 was a 2 m swell: the far field read as uniform-contrast corrugation instead of broad sky mirror.
  float chop = 0.6 + 0.6 * smoothstep(0.0, 9.0, ws);
  float mediumFade = 1.0 - smoothstep(80.0, 600.0, d);
  float fineFade = 1.0 - smoothstep(20.0, 160.0, d);
  // Distance alone misses grazing-angle/subpixel waves in the near field.
  float footprint = max(length(dFdx(wp)), length(dFdy(wp)));
  fineFade *= 1.0 - smoothstep(0.06, 0.22, footprint);
  float finestFade = (1.0 - smoothstep(4.0, 28.0, d)) * (1.0 - smoothstep(0.02, 0.08, footprint));
  // micro-chop at half its old weight near the camera; damped further on the oily flats (the swell stays)
  float slickDamp = mix(1.0, 0.25, envSlick);
  vec2 swell = n0.xy * 0.07 + n1.xy * 0.08;
  vec2 nxy = swell * (0.8 + 0.4 * chop)
    + (n2.xy * 0.15 * mediumFade + n3.xy * 0.10 * fineFade + n4.xy * 0.05 * finestFade) * chop * slickDamp;
  if (uRain > 0.01 && fineFade > 0.0) nxy += envRainRipples(wp, t) * uRain * 0.55 * fineFade;
  nxy *= 1.0 - smoothstep(600.0, 5000.0, d);
  envSlope = nxy;
  vec3 nW = normalize(vec3(nxy.x, 1.0, -nxy.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`;

export function createWater(parent: THREE.Group, normalMap: THREE.Texture, sh: SharedUniforms, mirrorEnabled = true): WaterSystem {
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.04, 0.055, 0.05, THREE.LinearSRGBColorSpace), // Hudson: grey-green silt water, opaque (ART: 0.04/0.055/0.05)
    roughness: 0.08,
    metalness: 0,
    ior: 1.333,
    specularIntensity: 1,
    envMapIntensity: 0.8,
    fog: true,
    depthWrite: true, // the atmosphere's depth-based fog must see the water surface
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 4,
  });
  const uWaterN = { value: normalMap };
  // ---- planar skyline mirror ----
  const mirrorRT = mirrorEnabled ? new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, generateMipmaps: false,
  }) : null;
  if (mirrorRT) mirrorRT.texture.name = 'water.skyline-mirror';
  const mirrorCam = new THREE.PerspectiveCamera();
  const uMirrorTex = { value: mirrorRT?.texture ?? null };
  const uMirrorMat = { value: new THREE.Matrix4() };
  const uMirrorOn = { value: 0 };
  const haze = {
    uWaterHorizon: { value: new THREE.Color(0x9baaba) },
    uWaterFogDensity: { value: 0.00024 },
    uWaterPostFog: { value: 0 },
  };
  chainCompile(mat, 'env-water-v7', (shader) => {
    Object.assign(shader.uniforms, haze, { uWaterN, uTime: sh.uTime, uRain: sh.uRain, uWind: sh.uWind, uMirrorTex, uMirrorMat, uMirrorOn });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;\nvarying vec4 vMirrorClip;\nuniform mat4 uMirrorMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 envWPos = modelMatrix * vec4(transformed, 1.0);\nvWorldXZ = envWPos.xz;\nvMirrorClip = uMirrorMat * envWPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WATER_PARS)
      .replace('#include <map_fragment>', WATER_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = envRough;')
      .replace('#include <normal_fragment_maps>', WATER_NORMAL)
      .replace('#include <opaque_fragment>', `
        // With aerial perspective active, only close the distant horizon seam;
        // otherwise supply water fog here. Never apply two full fog layers.
        float waterD = length(vViewPosition);
        float waterFog = 1.0 - exp(-uWaterFogDensity * waterD);
        waterFog *= mix(1.0, smoothstep(4000.0, 11000.0, waterD), uWaterPostFog);
        #ifdef USE_FOG
          waterFog = 0.0;
        #endif
        vec3 envV = normalize(vViewPosition);
        float envCosT = clamp(dot(normal, envV), 0.0, 1.0);
        float envF = 0.02 + 0.98 * pow(1.0 - envCosT, 5.0);
        // Planar skyline mirror. The env map carries only sky, so the towers come from a second, half-res
        // render of the far-LOD layer through a camera reflected about the water plane, projected here by
        // world position. Fresnel decides how much of the body colour it replaces (0.65 at 5 deg grazing).
        if (uMirrorOn > 0.5) {
          vec2 mUv = vMirrorClip.xy / max(vMirrorClip.w, 1e-4);
          // The slope displaces the mirrored image. Keep the lateral term small: a reflected tower is a
          // vertical bar and sideways smear is what dissolves it, while vertical smear is what chop does.
          mUv += vec2(envSlope.x * 0.010, envSlope.y * 0.15) * (1.0 - smoothstep(1200.0, 6000.0, waterD));
          vec2 mEdge = min(mUv, 1.0 - mUv);
          float mIn = smoothstep(0.0, 0.02, min(mEdge.x, mEdge.y));
          if (mIn > 0.0) {
            vec2 mStep = vec2(0.0011, 0.0052) * clamp(envRough / 0.30, 0.15, 1.8);
            vec2 mLo = vec2(0.001), mHi = vec2(0.999);
            vec4 mC = texture2D(uMirrorTex, clamp(mUv, mLo, mHi)) * 0.36;
            mC += texture2D(uMirrorTex, clamp(mUv + vec2(0.0, mStep.y), mLo, mHi)) * 0.22;
            mC += texture2D(uMirrorTex, clamp(mUv - vec2(0.0, mStep.y), mLo, mHi)) * 0.22;
            mC += texture2D(uMirrorTex, clamp(mUv + vec2(mStep.x, 0.0), mLo, mHi)) * 0.10;
            mC += texture2D(uMirrorTex, clamp(mUv - vec2(mStep.x, 0.0), mLo, mHi)) * 0.10;
            // the mirror pass never goes through the aerial-perspective post pass: the reflected tower is at
            // least as far as the water carrying it, so ramp it toward the horizon colour by that distance.
            vec3 mRgb = mix(mC.rgb / max(mC.a, 1e-3), uWaterHorizon, 0.12 + 0.38 * smoothstep(60.0, 2200.0, waterD));
            outgoingLight = mix(outgoingLight, mRgb * 0.92, clamp(mC.a, 0.0, 1.0) * mIn * envF * (1.0 - cap));
          }
        }
        // Sun path: the GGX lobe gives the glitter; this broad lobe (sub-facet slopes the normal octaves do not
        // carry, foam, spray) is the soft body of the path that widens toward the camera when the sun faces it.
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 envR = reflect(-envV, normal);
          float envMu = max(dot(envR, directionalLights[0].direction), 0.0);
          outgoingLight += directionalLights[0].color * (pow(envMu, 26.0) * 0.13 + pow(envMu, 6.0) * 0.030) * envF * (1.0 - cap);
        }
        #endif
        outgoingLight *= mix(0.95, 1.05, envUpwind);
        outgoingLight = mix(outgoingLight, uWaterHorizon, waterFog);
        #include <opaque_fragment>`);
  });
  const geo = new THREE.PlaneGeometry(26000, 26000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'env-water';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2; // after the land so hidden water fragments are rejected by depth
  mesh.position.y = WATER_LEVEL;
  parent.add(mesh);

  // Reflect only the far-LOD skyline: it already contains every building in the world, so hiding the near
  // tiles costs nothing visible at river range and keeps the pass to one extra draw of the cheapest layer.
  const MIRROR_SCALE = 0.5, MIRROR_MAX = 720;
  const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const bufSize = new THREE.Vector2();
  const clearCol = new THREE.Color();
  const rotM = new THREE.Matrix4();
  const fwd = new THREE.Vector3(), upv = new THREE.Vector3();
  const hidden: THREE.Object3D[] = [];
  let farGroup: THREE.Object3D | null = null;
  let lookupAt = -1e9, mirrorPending = false, mirrorBusy = false;

  mesh.onBeforeRender = (renderer, scene, camera, _geo, material) => {
    // Once per frame, and only on our own material: the SSR G-buffer pass swaps in a lighting-free clone
    // whose far-layer counterpart would render normals, not colour, into the mirror.
    if (!mirrorRT || !mirrorPending || mirrorBusy || material !== mat) return;
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    mirrorPending = false;
    if (!farGroup?.parent) {
      uMirrorOn.value = 0;
      if (renderer.info.render.frame - lookupAt < 30) return; // the layer streams in late; do not walk the scene every frame
      lookupAt = renderer.info.render.frame;
      farGroup = scene.getObjectByName('buildings-far') ?? null;
    }
    if (!farGroup?.parent || !farGroup.visible || cam.position.y <= WATER_LEVEL + 0.25) {
      uMirrorOn.value = 0;
      return;
    }
    mirrorBusy = true;
    // Three's Reflector construction: reflecting the up vector as well as the eye and the target keeps the
    // basis right-handed, so front faces stay front faces and no cull-face override is needed.
    rotM.extractRotation(cam.matrixWorld);
    fwd.set(0, 0, -1).applyMatrix4(rotM);
    upv.set(0, 1, 0).applyMatrix4(rotM);
    mirrorCam.position.set(cam.position.x, 2 * WATER_LEVEL - cam.position.y, cam.position.z);
    mirrorCam.up.set(upv.x, -upv.y, upv.z);
    mirrorCam.lookAt(mirrorCam.position.x + fwd.x, mirrorCam.position.y - fwd.y, mirrorCam.position.z + fwd.z);
    mirrorCam.fov = cam.fov;
    mirrorCam.aspect = cam.aspect;
    mirrorCam.near = cam.near;
    // At 6 km the aerial perspective is already 60 % of the way to the horizon colour and the reflection of
    // anything further is indistinguishable from haze, so a short far plane culls the outer chunks for free:
    // it is the difference between doubling the far layer's draw cost and adding a fifth of it. Only z
    // changes, so the x/y NDC mapping that the texture matrix depends on is untouched.
    mirrorCam.far = Math.min(cam.far, 6000);
    mirrorCam.updateProjectionMatrix();
    mirrorCam.updateMatrixWorld(true);
    uMirrorMat.value.copy(BIAS).multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);

    renderer.getDrawingBufferSize(bufSize);
    const w = Math.max(64, Math.min(MIRROR_MAX, Math.round(bufSize.x * MIRROR_SCALE)));
    const h = Math.max(64, Math.min(MIRROR_MAX, Math.round(bufSize.y * MIRROR_SCALE)));
    if (mirrorRT.width !== w || mirrorRT.height !== h) mirrorRT.setSize(w, h);
    for (let node: THREE.Object3D = farGroup; node.parent; node = node.parent) {
      for (const sib of node.parent.children) if (sib !== node && sib.visible) { sib.visible = false; hidden.push(sib); }
    }
    const prevTarget = renderer.getRenderTarget();
    const prevBg = scene.background;
    const prevMatrixAuto = scene.matrixWorldAutoUpdate;
    const prevAutoReset = renderer.info.autoReset;
    const prevShadowAuto = renderer.shadowMap.autoUpdate, prevShadowNeeds = renderer.shadowMap.needsUpdate;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearCol);
    scene.background = null; // the sky already reaches the water through the env map
    // We run inside the main render, which has already walked the graph this frame. Left on, every nested
    // render repeats a full scene.updateMatrixWorld() over every tile, prop, vehicle and pedestrian, which
    // costs several milliseconds of CPU and dwarfs the draw it is there to make.
    scene.matrixWorldAutoUpdate = false;
    renderer.info.autoReset = false; // a nested render must not reset the frame's counters
    renderer.shadowMap.autoUpdate = false; // never re-render the cascades for the mirror
    renderer.shadowMap.needsUpdate = false;
    try {
      renderer.setRenderTarget(mirrorRT);
      renderer.setClearColor(0x000000, 0); // alpha carries skyline coverage
      renderer.render(scene, mirrorCam);
      uMirrorOn.value = 1;
    } finally {
      // A throw here must never leave the scene half-hidden or the renderer pointed at the mirror.
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(clearCol, prevAlpha);
      scene.background = prevBg;
      scene.matrixWorldAutoUpdate = prevMatrixAuto;
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      renderer.shadowMap.needsUpdate = prevShadowNeeds;
      renderer.info.autoReset = prevAutoReset;
      for (const o of hidden) o.visible = true;
      hidden.length = 0;
      mirrorBusy = false;
    }
  };

  return {
    mesh,
    mat,
    update(camera) {
      mesh.position.x = camera.position.x;
      mesh.position.z = camera.position.z;
      mesh.updateMatrixWorld();
      mirrorPending = mirrorEnabled;
    },
    setEnvMap(t) {
      if (mat.envMap !== t) {
        mat.envMap = t;
        mat.needsUpdate = true;
      }
    },
    setHaze(color, density, postFog) {
      haze.uWaterHorizon.value.copy(color);
      haze.uWaterFogDensity.value = density;
      haze.uWaterPostFog.value = postFog ? 1 : 0;
    },
    setNormalMap(t) {
      uWaterN.value = t;
    },
    dispose() {
      parent.remove(mesh);
      mesh.onBeforeRender = () => {};
      geo.dispose();
      mat.dispose();
      mirrorRT?.dispose();
    },
  };
}

/** Fallback environment map: a PMREM of a simple analytic sky, regenerated as the sun moves. */
export class FallbackSkyEnv {
  texture: THREE.Texture | null = null;
  private pmrem: THREE.PMREMGenerator;
  private scene = new THREE.Scene();
  private mat: THREE.ShaderMaterial;
  private rt: THREE.WebGLRenderTarget | null = null;
  private lastDay = -1;
  private lastSun = new THREE.Vector3(0, -1, 0);
  private lastAt = -1e9;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uDay: { value: 1 } },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vDir; uniform vec3 uSun; uniform float uDay;
        void main(){
          vec3 d = normalize(vDir); float h = clamp(d.y, -1.0, 1.0);
          vec3 zen = mix(vec3(0.012, 0.016, 0.03), vec3(0.14, 0.30, 0.66), uDay);
          vec3 hor = mix(vec3(0.03, 0.03, 0.045), vec3(0.60, 0.68, 0.80), uDay);
          vec3 gnd = mix(vec3(0.012, 0.012, 0.012), vec3(0.16, 0.15, 0.13), uDay);
          vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor, gnd, pow(-h, 0.4));
          float sd = max(0.0, dot(d, uSun));
          c += vec3(1.0, 0.86, 0.62) * (pow(sd, 500.0) * 30.0 + pow(sd, 6.0) * 0.3) * uDay;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 16), this.mat);
    this.scene.add(sphere);
  }

  /** returns true when the texture was (re)generated */
  update(sunDir: THREE.Vector3, daylight: number, now: number): boolean {
    const moved = this.lastSun.distanceTo(sunDir) > 0.06 || Math.abs(daylight - this.lastDay) > 0.08;
    if (this.texture && !moved) return false;
    if (this.texture && now - this.lastAt < 4) return false;
    this.lastAt = now;
    this.lastSun.copy(sunDir);
    this.lastDay = daylight;
    (this.mat.uniforms.uSun.value as THREE.Vector3).copy(sunDir);
    this.mat.uniforms.uDay.value = daylight;
    const old = this.rt;
    this.rt = this.pmrem.fromScene(this.scene, 0, 1, 2000);
    this.texture = this.rt.texture;
    if (old) old.dispose();
    return true;
  }

  dispose(): void {
    this.rt?.dispose();
    this.pmrem.dispose();
    this.mat.dispose();
    this.scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    this.scene.clear();
  }
}
