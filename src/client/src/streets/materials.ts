/**
 * Street materials. All MeshStandardMaterial (shadows, fog, env reflections come from three / the atmosphere
 * module) extended through onBeforeCompile. World-space UVs (1 unit = 1 m) so overlapping tile geometry never
 * z-fights visibly and no seams appear between tiles.
 *
 * Ground mesh attribute layout (roadbed + sidewalk meshes):
 *   aA = (kind, laneOffset m, alongCurb m | road half-width m, random 0..1)
 *   aB = (dirCos, dirSin, paintFlag | road lane code (laneW, +100 for even lane counts), traffic 0..1)
 *   dir = (cos 2θ, sin 2θ) for roads, (cos 4θ, sin 4θ) for sidewalks
 * Kinds: 0 asphalt, 1 concrete flags, 2 granite curb, 3 tactile pad, 4 concrete road, 5 pavers, 6 cobblestone, 7 plain concrete
 */
import * as THREE from 'three';
import type { StreetTextures } from './textures';

export const KIND = { asphalt: 0, flags: 1, curb: 2, tactile: 3, concreteRoad: 4, pavers: 5, cobble: 6, plainConcrete: 7 } as const;
export const FLAG_SIZE_M = 1.52;

export interface SharedUniforms {
  uWetness: { value: number };
  uRain: { value: number };
  uTime: { value: number };
  uNight: { value: number };
}

type Shader = { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> };

/** Install a shader patch that survives another module assigning material.onBeforeCompile later (both run). */
export function installPatch(mat: THREE.Material, key: string, patch: (s: Shader) => void): void {
  let external: ((s: Shader, r: THREE.WebGLRenderer) => void) | null = null;
  let running = false;
  const combined = (s: Shader, r: THREE.WebGLRenderer) => {
    if (running) return; // a wrapper calling back into us
    running = true;
    try {
      patch(s);
      external?.(s, r);
    } finally {
      running = false;
    }
  };
  Object.defineProperty(mat, 'onBeforeCompile', {
    configurable: true,
    enumerable: true,
    get: () => combined,
    set: (fn: unknown) => {
      external = typeof fn === 'function' && fn !== combined ? (fn as typeof external) : null;
    },
  });
  mat.customProgramCacheKey = () => `${key}|${external ? external.toString().length : 0}`;
}

/**
 * Wet-surface model shared by the ground shaders. `hgt` is a relative surface height (0..1, mean 0.5; ruts,
 * gutters and joints are biased lower). Rain fills the low spots first: the water film spreads up the surface
 * with uWetness (so 0.3 reads as a damp street with wet gutters, 1.0 as soaked), and standing water sits below
 * a level that rises with uWetness. Puddle edges are crisp (one or two texels, fwidth-limited at distance).
 * Roughness targets follow docs/ART_DIRECTION.md section 3: film 0.24-0.3, puddles 0.05 (SSR traces < 0.55).
 */
const GLSL_WET = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
/* film 0..1 in x, standing water 0..1 in y */
vec2 wetMasks(float hgt, float wet) {
  float on = step(0.02, wet);
  float film = smoothstep(0.0, 0.4, wet * 1.2 - 0.35 - (hgt - 0.5) * 1.6);
  film = max(film, smoothstep(0.75, 1.0, wet)) * on;
  float level = mix(0.14, 0.38, wet);
  float aa = max(0.012, fwidth(hgt) * 1.5);
  float puddle = (1.0 - smoothstep(level, level + aa, hgt)) * on;
  return vec2(film, puddle);
}
/* rain on standing water: expanding rings from drop impacts, two layers of ~0.4 m cells; tangent-space xy */
vec2 rainRings(vec2 p) {
  vec2 n = vec2(0.0);
  for (int i = 0; i < 2; ++i) {
    float fi = float(i);
    vec2 q = p * (2.6 + 1.3 * fi) + fi * 7.3;
    vec2 c = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = hash12(c + fi * 11.0);
    float t = fract(uTime * (0.9 + 0.7 * h) + h * 13.0);
    vec2 d = f - (vec2(hash12(c + 1.7), hash12(c + 3.1)) - 0.5) * 0.5;
    float r = length(d);
    float R = t * 0.5;
    float ring = sin((r - R) * 50.0) * exp(-abs(r - R) * 22.0) * (1.0 - t) * step(0.3, h);
    n += d / max(r, 1e-3) * ring;
  }
  return n * 0.6 * uRain;
}
`;

const GLSL_COMMON = /* glsl */ `
uniform sampler2D tNoise;
uniform float uWetness;
uniform float uRain;
uniform float uTime;
uniform float uNight;
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec4 vA;
varying vec4 vB;

const vec3 LUMW = vec3(0.2126, 0.7152, 0.0722);
${GLSL_WET}
vec3 perturbN(vec3 Nw, vec3 tn) {
  vec3 T = abs(Nw.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), Nw));
  vec3 B = cross(Nw, T);
  return normalize(T * tn.x + B * tn.y + Nw * tn.z);
}
vec2 rot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
// The Times Square bowtie: Broadway / 7th from 42nd (-361,-252) to 50th (-74,-882), world metres.
// Sealed precast and constantly repaved, polished asphalt; at night the screens above have to mirror in it.
float timesSquare(vec2 p) {
  vec2 a = vec2(-361.0, -252.0), ab = vec2(287.0, -630.0);
  float u = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  return 1.0 - smoothstep(52.0, 96.0, length(p - (a + ab * u)));
}
`;

const VERTEX_PATCH = (shader: Shader) => {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec4 aA;
attribute vec4 aB;
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec4 vA;
varying vec4 vB;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * normal);
vA = aA;
vB = aB;`,
    );
};

function linkUniforms(shader: Shader, tex: StreetTextures, shared: SharedUniforms, extra: Record<string, THREE.IUniform>): void {
  shader.uniforms.tNoise = { value: tex.noise };
  shader.uniforms.uWetness = shared.uWetness;
  shader.uniforms.uRain = shared.uRain;
  shader.uniforms.uTime = shared.uTime;
  shader.uniforms.uNight = shared.uNight;
  Object.assign(shader.uniforms, extra);
}

/* ------------------------------------------------------------------ roadbed */

export function createRoadMaterial(tex: StreetTextures, shared: SharedUniforms): { material: THREE.MeshStandardMaterial; uniforms: Record<string, THREE.IUniform> } {
  const uniforms: Record<string, THREE.IUniform> = {
    tAsphalt: { value: tex.asphalt.albedo },
    tAsphaltN: { value: tex.asphalt.normal },
    tAsphaltR: { value: tex.asphalt.rough },
    tAsphalt2: { value: tex.asphalt2 },
    uAsphaltScale: { value: tex.asphalt.scale },
    uAsphalt2Scale: { value: tex.asphalt2Scale },
    tConcrete: { value: tex.concrete.albedo },
    tConcreteN: { value: tex.concrete.normal },
    uConcreteScale: { value: tex.concrete.scale },
    tCobble: { value: tex.cobble.albedo },
    tCobbleN: { value: tex.cobble.normal },
    tCobbleR: { value: tex.cobble.rough },
    uCobbleScale: { value: tex.cobble.scale },
    uHasAsphaltR: { value: tex.asphalt.rough ? 1 : 0 },
    uHasCobbleR: { value: tex.cobble.rough ? 1 : 0 },
    // Diagnostic control: isolate asphalt cracks without hiding paint, oil or tyre wear.
    uCrackStrength: { value: 1 },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 1 });
  material.name = 'streets-road';
  installPatch(material, 'streets-road', (shader) => {
    linkUniforms(shader, tex, shared, uniforms);
    material.userData.streetUniforms = shader.uniforms;
    VERTEX_PATCH(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${GLSL_COMMON}
uniform sampler2D tAsphalt, tAsphaltN, tAsphaltR, tAsphalt2, tConcrete, tConcreteN, tCobble, tCobbleN, tCobbleR;
uniform float uAsphaltScale, uAsphalt2Scale, uConcreteScale, uCobbleScale, uHasAsphaltR, uHasCobbleR, uCrackStrength;`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
vec2 p = vWPos.xz;
float kind = vA.x;
vec4 nLow = texture2D(tNoise, p / 41.0);
vec4 nMid = texture2D(tNoise, p / 9.3 + 0.31);
vec3 sAlb;
float sRough;
vec3 sTn; // tangent-space normal
float traffic = clamp(vB.w, 0.0, 1.0);
float puddleBias = 0.0;
// gutter line (0..1 at the curb), road angle and along-road coordinate: set by the asphalt branch, used by the wet block
float gutterLine = 0.0, roadTh = 0.0, alongRoad = p.x;

if (kind > 5.5 && kind < 6.5) {
  // ---- Belgian block
  vec2 uv = p / uCobbleScale;
  sAlb = texture2D(tCobble, uv).rgb;
  sTn = texture2D(tCobbleN, uv).xyz * 2.0 - 1.0;
  sRough = uHasCobbleR > 0.5 ? texture2D(tCobbleR, uv).r : 0.7;
  sAlb *= 0.85 + 0.3 * nLow.g;
  // blocks polished by tires
  float laneW = 3.3;
  float lp = mod(vA.y + laneW * 0.5, laneW) - laneW * 0.5;
  float tr = exp(-pow((abs(lp) - 0.85) / 0.4, 2.0)) * traffic;
  sRough -= 0.25 * tr;
  sAlb *= 1.0 - 0.12 * tr;
} else if ((kind > 3.5 && kind < 4.5) || kind > 6.5) {
  // ---- concrete roadway (FDR, some avenues): mid grey, the source map is normalised to a NYC tone
  vec2 uv = p / (uConcreteScale * 1.6);
  vec3 cTex = texture2D(tConcrete, uv).rgb;
  sAlb = (0.13 + 1.1 * mix(vec3(dot(cTex, LUMW)), cTex, 0.3)) * vec3(1.0, 0.99, 0.97);
  sTn = texture2D(tConcreteN, uv).xyz * 2.0 - 1.0;
  sRough = 0.86 + 0.1 * (nMid.g - 0.5);
  sAlb *= 0.88 + 0.24 * nLow.r;
  // transverse joints every 4.6 m + longitudinal lane joints
  float th = 0.5 * atan(vB.y, vB.x);
  vec2 lp2 = rot2(p, -th);
  float ja = fract(lp2.x / 4.6), jb = fract((vA.y + 1.65) / 3.3);
  float joint = (1.0 - smoothstep(0.0, 0.012, min(ja, 1.0 - ja) * 4.6)) + (1.0 - smoothstep(0.0, 0.012, min(jb, 1.0 - jb) * 3.3));
  sAlb *= 1.0 - 0.45 * clamp(joint, 0.0, 1.0);
  float laneW = 3.3;
  float lp = mod(vA.y + laneW * 0.5, laneW) - laneW * 0.5;
  float tr = exp(-pow((abs(lp) - 0.85) / 0.4, 2.0)) * traffic;
  sAlb *= 1.0 - 0.16 * tr;
} else {
  // ---- asphalt
  // Reuse the existing low-frequency noise to break repeat alignment. Each
  // source retains its own physical scale; normals/roughness share uvA.
  vec2 uvA = p / uAsphaltScale + (nLow.gb - 0.5) * 1.7;
  vec2 uvB = rot2(p, 0.63) / uAsphalt2Scale + (nLow.rg - 0.5) * 1.7 + 0.37;
  vec3 a1 = texture2D(tAsphalt, uvA).rgb;
  vec3 a2 = texture2D(tAsphalt2, uvB).rgb;
  // age: side streets (low traffic) are older grey asphalt, avenues get repaved
  float age = clamp(nLow.r + 0.25 * (vA.w - 0.5) + 0.35 * (1.0 - traffic), 0.0, 1.0);
  float blend = smoothstep(0.3, 0.7, age);
  // neutral dark grey: the source maps carry a brown cast; keep their grain, set the tone by age
  float lum = dot(mix(a1, a2, blend), LUMW);
  sAlb = vec3(0.02 + lum * mix(0.62, 1.28, blend)) * vec3(1.0, 0.995, 0.985);
  sTn = texture2D(tAsphaltN, uvA).xyz * 2.0 - 1.0;
  sTn.xy *= 1.3;
  // coarse aggregate at close range: a second octave of the normal map, faded out past ~15 m
  float camD = length(vWPos - cameraPosition);
  float nearW = 1.0 - smoothstep(4.0, 16.0, camD);
  if (nearW > 0.001) {
    vec3 tn2 = texture2D(tAsphaltN, uvA * 4.3 + 0.37).xyz * 2.0 - 1.0;
    sTn.xy += tn2.xy * (0.5 + 0.4 * blend) * nearW;
  }
  sRough = uHasAsphaltR > 0.5 ? texture2D(tAsphaltR, uvA).r : 0.85;
  sRough = mix(sRough, 0.92, blend * 0.5);
  // Times Square roadway: polished black top, so the signs above reflect in it (SSR cuts off at 0.55)
  sRough = mix(sRough, 0.26, timesSquare(p) * (0.5 + 0.5 * uNight));
  // macro variation (repaving history: some blocks darker/fresher), at a contrast that survives 40 m
  sAlb *= 0.78 + 0.42 * nLow.g;
  sAlb *= 0.90 + 0.20 * nMid.r;
  // lane geometry from the vertex: lane width + phase (even lane counts put lane centres at +-laneW/2)
  float laneW = mod(vB.z, 100.0);
  float phase = vB.z >= 100.0 ? laneW * 0.5 : 0.0;
  if (laneW < 1.0) { laneW = 3.3; phase = 0.0; }
  float hw = vA.z;
  float lp = mod(vA.y - phase + laneW * 0.5, laneW) - laneW * 0.5;
  // parking lane on side streets: the outer 2.4 m sees no moving traffic
  float moving = (hw > 0.5 && traffic < 0.72) ? 1.0 - smoothstep(hw - 3.0, hw - 2.2, abs(vA.y)) : 1.0;
  // wheel tracks: tyres wear the binder off the aggregate, the tracks read lighter and smoother than the lane edges
  float tr = exp(-pow((abs(lp) - 0.85) / 0.45, 2.0)) * traffic * moving;
  sAlb *= 1.0 + (0.14 + 0.07 * blend) * tr;
  sRough -= 0.20 * tr;
  vec3 cleanAsphalt = sAlb;
  // oil drip strip along the lane centre, heaviest where traffic is heavy
  float oil = exp(-pow(lp / 0.16, 2.0)) * traffic * moving * smoothstep(0.55, 0.72, nMid.b);
  sAlb *= 1.0 - 0.15 * oil;
  sRough -= 0.08 * oil;
  puddleBias = 0.10 * tr;
  // gutter: grime toward the curb and a darker damp line right along it, water collects there
  float gutter = hw > 0.5 ? smoothstep(hw - 1.3, hw - 0.3, abs(vA.y)) : 0.0;
  // The 0.5 m under the curb overhang never sees the sun. That dark band is half of what makes the
  // 15 cm step read as a step rather than as a tonal seam between two flat values.
  float gline = hw > 0.5 ? smoothstep(hw - 0.50, hw - 0.04, abs(vA.y)) : 0.0;
  sAlb *= 1.0 - 0.26 * gutter * (0.6 + 0.4 * nMid.g) - 0.44 * gline * (0.7 + 0.3 * nMid.r);
  sRough += 0.06 * gutter - 0.18 * gline;
  puddleBias += 0.16 * gutter + 0.2 * gline;
  gutterLine = gline;
  // Sparse utility repairs: 1-3 cm seals, only a modest age difference from the surrounding mat.
  float th = 0.5 * atan(vB.y, vB.x);
  vec2 lp2 = rot2(p, -th);
  roadTh = th; alongRoad = lp2.x;
  // The sealant bead around every repair is held to a screen-space minimum width, like the flag joints,
  // so the quilt of cuts still reads at 40 m instead of mipping back into a single flat mat.
  float pfw = max(length(fwidth(lp2)) * 0.5, 1e-4);
  float sealHW = max(0.035, pfw * 0.8);
  float sealCov = clamp(0.035 / sealHW, 0.55, 1.0);
  vec2 cell = vec2(floor(lp2.x / 8.0), floor(lp2.y / 3.2));
  vec2 cf = vec2(fract(lp2.x / 8.0), fract(lp2.y / 3.2));
  float ch = hash12(cell + 17.0);
  float cutIn = 0.0, cutEdge = 0.0, cutFresh = 0.0;
  if (ch < 0.055 + 0.045 * blend) {
    vec2 m0 = vec2(0.04 + 0.25 * hash12(cell + 3.0), 0.06 + 0.2 * hash12(cell + 5.0));
    vec2 m1 = vec2(0.96 - 0.25 * hash12(cell + 7.0), 0.94 - 0.2 * hash12(cell + 9.0));
    vec2 din = min(cf - m0, m1 - cf);
    float dm = min(din.x * 8.0, din.y * 3.2);
    cutIn = step(0.0, dm);
    cutEdge = (1.0 - smoothstep(sealHW - pfw, sealHW + pfw, dm)) * cutIn * sealCov;
    cutFresh = step(0.5, hash12(cell + 11.0));
  }
  // Round cut-and-restore repairs over castings and valve boxes: a 1.2-2 m repaved disc with the same
  // bead. Procedural, so they do not land on the manhole props; most NYC rings have no cover showing.
  vec2 rcell = floor(lp2 / vec2(11.0, 5.5));
  vec2 rf = (fract(lp2 / vec2(11.0, 5.5)) - 0.5) * vec2(11.0, 5.5);
  if (hash12(rcell + 41.3) < 0.26) {
    vec2 rc = (vec2(hash12(rcell + 2.2), hash12(rcell + 6.4)) - 0.5) * vec2(7.0, 3.0);
    float rd = (0.6 + 0.4 * hash12(rcell + 8.8)) - length(rf - rc);
    float rin = step(0.0, rd);
    cutFresh = mix(cutFresh, step(0.55, hash12(rcell + 13.1)), rin);
    cutIn = max(cutIn, rin);
    cutEdge = max(cutEdge, (1.0 - smoothstep(sealHW - pfw, sealHW + pfw, rd)) * rin * sealCov);
  }
  // patched trenches: a 0.9 m strip along the road for a 24 m stretch, the same seal lines
  float tcell = floor(lp2.x / 24.0);
  float thh = hash12(vec2(tcell, floor(vA.w * 7.0)) + 23.0);
  if (thh < 0.06 && hw > 0.5) {
    float tc = (hash12(vec2(tcell, 5.0)) - 0.5) * (hw - 1.4) * 1.6;
    float tf = fract(lp2.x / 24.0) * 24.0;
    float dm = min(0.45 - abs(vA.y - tc), min(tf - 0.4, 23.6 - tf));
    float tin = step(0.0, dm);
    cutIn = max(cutIn, tin);
    cutEdge = max(cutEdge, (1.0 - smoothstep(sealHW - pfw, sealHW + pfw, dm)) * tin * sealCov);
    cutFresh = mix(cutFresh, step(0.5, hash12(vec2(tcell, 9.0))), tin);
  }
  if (cutIn > 0.0) {
    vec3 grain = texture2D(tAsphalt2, uvB * 1.7 + 0.5).rgb;
    vec3 oldPatch = vec3(0.03 + dot(grain, LUMW) * 1.9) * (0.9 + 0.2 * nMid.g);
    vec3 freshPatch = vec3(0.035, 0.035, 0.037) * (0.8 + 0.4 * nMid.g) + 0.05 * dot(grain, LUMW);
    vec3 patchAlb = clamp(mix(oldPatch, freshPatch, cutFresh), sAlb * 0.55, sAlb * 1.45);
    sAlb = mix(sAlb, patchAlb, cutIn);
    sRough = mix(sRough, mix(0.95, 0.62, cutFresh), cutIn);
    sAlb *= 1.0 - 0.52 * cutEdge;
    sRough -= 0.10 * cutEdge;
    sTn.xy *= 1.0 - 0.6 * cutIn * cutFresh;
  }
  // Short broken segments, not a thresholded noise contour (which produced metre-wide loops).
  // World-space half-width is 5-15 mm; coverage AA fades subpixel cracks instead of widening them.
  vec2 crackCell = floor(p / 3.0);
  float cr = hash12(crackCell + 31.7);
  vec2 cq = rot2(mod(p, 3.0) - 1.5, cr * 6.283185);
  vec2 ca = vec2(-0.55 - 0.3 * cr, (hash12(crackCell + 4.2) - 0.5) * 0.5);
  vec2 cb = vec2(0.0, (hash12(crackCell + 8.6) - 0.5) * 0.35);
  vec2 cc = vec2(0.4 + 0.4 * cr, (hash12(crackCell + 12.3) - 0.5) * 0.5);
  vec2 ab = cb - ca, bc = cc - cb;
  float cd = min(length(cq - ca - ab * clamp(dot(cq - ca, ab) / dot(ab, ab), 0.0, 1.0)),
                 length(cq - cb - bc * clamp(dot(cq - cb, bc) / dot(bc, bc), 0.0, 1.0)));
  float halfWidth = mix(0.005, 0.015, hash12(crackCell + 2.4));
  float caa = max(0.001, length(fwidth(p)) * 0.5);
  float crack = (1.0 - smoothstep(halfWidth - caa, halfWidth + caa, cd)) * min(1.0, halfWidth / caa);
  crack *= step(cr, 0.10 + 0.10 * blend) * (1.0 - cutIn * cutFresh) * clamp(uCrackStrength, 0.0, 1.0);
  sAlb *= 1.0 - 0.34 * crack;
  // heat-worn ruts (subtle wide darkening along tracks)
  sAlb *= 1.0 - 0.06 * traffic * smoothstep(0.4, 1.4, abs(lp));
  // Overlapping grime and cracks may darken dry asphalt by at most 28%; inside a seal patch, 60%,
  // otherwise the floor flattens exactly the contrast the patches are there to provide.
  sAlb = max(sAlb, cleanAsphalt * mix(0.72, 0.40, clamp(cutIn, 0.0, 1.0)));
}

// ---- wetness (see GLSL_WET): the film follows the surface height, standing water fills ruts and gutters first
float wet = uWetness;
float hgt = 0.5 * texture2D(tNoise, p / 19.0 + 0.11).g + 0.2 * nLow.r + 0.22 * nMid.g
  + 0.08 * texture2D(tNoise, p / 2.3 + 0.61).g - puddleBias;
vec2 wm = wetMasks(hgt, wet);
float film = wm.x, puddle = wm.y;
// damp everywhere once it rains, the full film (x0.45, glossy) where the water has spread
sAlb *= 1.0 - 0.22 * wet * (1.0 - film);
sAlb *= mix(1.0, 0.45, film);
sRough = mix(sRough, 0.27 - 0.05 * traffic, film * 0.95);
sTn = normalize(vec3(sTn.xy * mix(1.0, 0.45, film), 1.0));
// standing water: a flat mirror over darker asphalt, rain rings on it
sAlb = mix(sAlb, sAlb * 0.55, puddle);
sRough = mix(sRough, 0.05, puddle);
sTn = mix(sTn, vec3(0.0, 0.0, 1.0), puddle);
sTn.xy += rainRings(p) * puddle;
// gutter stream: water running along the curb while it rains
float stream = gutterLine * smoothstep(0.3, 0.7, wet) * smoothstep(0.02, 0.3, uRain);
if (stream > 0.001) {
  vec2 flow = vec2(alongRoad * 3.0 - uTime * 1.7, abs(vA.y) * 11.0);
  vec2 sn = (texture2D(tNoise, flow / 7.0).rg - 0.5) * 0.5 + (texture2D(tNoise, flow / 2.1 + 0.3).gb - 0.5) * 0.3;
  sTn.xy += rot2(sn, roadTh) * stream;
  sRough = mix(sRough, 0.05, stream);
  sAlb *= 1.0 - 0.2 * stream;
}
sTn = normalize(sTn);

// night: slightly lift the albedo of the pale concrete... nothing (lighting handles it)
diffuseColor.rgb *= sAlb;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(sRough, 0.02, 1.0);')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(perturbN(normalize(vWNormal), sTn), 0.0)).xyz);');
  });
  return { material, uniforms };
}

/* ------------------------------------------------------------------ sidewalk */

export function createSidewalkMaterial(tex: StreetTextures, shared: SharedUniforms): { material: THREE.MeshStandardMaterial; uniforms: Record<string, THREE.IUniform> } {
  const uniforms: Record<string, THREE.IUniform> = {
    tConcrete: { value: tex.concrete.albedo },
    tConcreteN: { value: tex.concrete.normal },
    tConcreteR: { value: tex.concrete.rough },
    uConcreteScale: { value: tex.concrete.scale },
    tGranite: { value: tex.granite.albedo },
    tGraniteN: { value: tex.granite.normal },
    uGraniteScale: { value: tex.granite.scale },
    uHasConcreteR: { value: tex.concrete.rough ? 1 : 0 },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: 1 });
  material.name = 'streets-sidewalk';
  installPatch(material, 'streets-sidewalk', (shader) => {
    linkUniforms(shader, tex, shared, uniforms);
    material.userData.streetUniforms = shader.uniforms;
    VERTEX_PATCH(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${GLSL_COMMON}
uniform sampler2D tConcrete, tConcreteN, tConcreteR, tGranite, tGraniteN;
uniform float uConcreteScale, uGraniteScale, uHasConcreteR;`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
vec2 p = vWPos.xz;
float kind = vA.x;
vec4 nLow = texture2D(tNoise, p / 37.0 + 0.5);
vec4 nMid = texture2D(tNoise, p / 6.1 + 0.13);
vec3 sAlb;
float sRough;
vec3 sTn;
float puddle = 0.0, film = 0.0;
float sMetal = 0.0;
float wet = uWetness;

if (kind > 1.5 && kind < 2.5) {
  // ---- granite curb: 1.5 m stones along the curb, 3 cm bevel lit lighter, yellow paint near hydrants.
  // Grey granite: grain from the unjointed concrete detail map plus a fine salt-and-pepper speckle
  // (the curb photo set is a brown paver grid that would print false joints on the face).
  float along = vA.z;
  float stone = floor(along / 1.5);
  float sh = hash12(vec2(stone, vA.w * 91.0));
  // Three quads share this branch: the 15 cm top band (ny 1), the 3 cm chamfer (ny 0.707) and the face
  // (ny 0). The top band takes its grain across the stone; the chamfer and the face use height.
  float ny = vWNormal.y;
  bool top = ny > 0.9;
  float chamfer = step(0.35, ny) - step(0.9, ny);
  float across = top ? dot(p, vec2(vB.x, vB.y)) : vWPos.y;
  vec2 uv = vec2(along, across) / (uConcreteScale * 0.45);
  float grain = dot(texture2D(tConcrete, uv).rgb, LUMW);
  float speckle = texture2D(tNoise, vec2(along, across) * 3.1).b - 0.5;
  // each stone its own tone (quarry batches): +-18 %, with a slight warm/cool drift
  vec3 stoneTint = (0.82 + 0.36 * sh) * (1.0 + (hash12(vec2(stone, 3.0)) - 0.5) * vec3(0.05, 0.0, -0.06));
  sAlb = vec3(0.075 + 1.20 * grain + 0.12 * speckle) * vec3(1.0, 0.985, 0.965) * stoneTint;
  sTn = texture2D(tConcreteN, uv).xyz * 2.0 - 1.0;
  sTn.xy = sTn.xy * 0.5 + vec2(speckle, texture2D(tNoise, vec2(along, across) * 3.1 + 0.3).b - 0.5) * 0.25;
  sRough = 0.66 + 0.1 * (nMid.g - 0.5) - 0.1 * step(0.7, sh);
  // Feet and tyres polish the chamfer and the top band. That highlight, over a face that stays granite-
  // light against much darker asphalt, is what makes the 15 cm step read as a step in the mid-ground.
  float worn = top ? 0.45 : chamfer;
  sAlb *= 1.0 + 0.55 * worn;
  sRough -= 0.16 * worn;
  // stone joints every 1.5 m, held to a screen-space minimum width so they survive mips at 40 m
  float jd = abs(along - floor(along / 1.5 + 0.5) * 1.5);
  float jfw = max(fwidth(along), 1e-5);
  float jhw = max(0.013, jfw * 0.7);
  float joint = (1.0 - smoothstep(jhw - jfw * 0.6, jhw + jfw * 0.6, jd)) * clamp(0.013 / jhw, 0.55, 1.0);
  sAlb *= 1.0 - 0.55 * joint - 0.14 * (1.0 - smoothstep(0.0, 0.07, jd));
  // the mortar line where the top band butts the flags (vA.y = inset from the curb line on that quad)
  if (top) sAlb *= 1.0 - 0.40 * smoothstep(0.118, 0.148, vA.y);
  // gutter: 6 cm of road stain and a standing-water tide line at the foot of the face, scuffs above it
  float gutter = (1.0 - smoothstep(0.015, 0.07, vWPos.y)) * (1.0 - step(0.35, ny));
  sAlb *= 1.0 - 0.38 * gutter;
  sRough += 0.06 * gutter;
  sAlb *= 1.0 - 0.16 * smoothstep(0.5, 0.8, nMid.r) * (1.0 - step(0.35, ny));
  // yellow paint (worn)
  if (vB.z > 0.5) {
    float wear = smoothstep(0.35, 0.7, texture2D(tNoise, vec2(along, vWPos.y * 3.0) / 1.3).b * 0.5 + nMid.r * 0.5);
    vec3 yellow = vec3(0.80, 0.62, 0.10);
    sAlb = mix(sAlb, yellow * (0.8 + 0.3 * nMid.g), 0.85 * wear);
    sRough = mix(sRough, 0.55, wear);
  }
  // the top face films over like the flags, the vertical face only darkens
  float cf = top ? 1.0 : 0.5;
  sAlb *= mix(1.0, 0.58, wet * cf);
  sRough = mix(sRough, 0.28, wet * (top ? 0.9 : 0.5));
} else if (kind > 2.5 && kind < 3.5) {
  // ---- tactile warning pad: red-brown with truncated domes on a 6 cm grid
  vec2 uv = vec2(vA.y, vA.z);
  vec2 cell = floor(uv / 0.06);
  vec2 f = fract(uv / 0.06) - 0.5;
  float d = length(f) * 0.06;
  float dome = 1.0 - smoothstep(0.010, 0.014, d);
  float rim = smoothstep(0.008, 0.012, d) * (1.0 - smoothstep(0.012, 0.016, d));
  sAlb = vec3(0.52, 0.17, 0.12) * (0.85 + 0.3 * nMid.r);
  sAlb += dome * vec3(0.08, 0.03, 0.02) - rim * 0.15;
  sTn = normalize(vec3(-f * dome * 1.4, 1.0));
  sRough = 0.6 - 0.15 * dome;
  sAlb *= mix(1.0, 0.6, wet);
  sRough = mix(sRough, 0.25, wet * 0.8);
} else if (kind > 4.5 && kind < 5.5) {
  // ---- precast pavers (plazas): 0.6 x 0.3 running bond, dark grey
  float th = 0.25 * atan(vB.y, vB.x);
  vec2 lp = rot2(p, -th);
  float row = floor(lp.y / 0.3);
  float ox = mod(row, 2.0) * 0.3;
  vec2 cell = vec2(floor((lp.x + ox) / 0.6), row);
  vec2 f = vec2(fract((lp.x + ox) / 0.6), fract(lp.y / 0.3));
  float h = hash12(cell + 0.3);
  vec2 uv = p / uConcreteScale;
  vec3 detail = texture2D(tConcrete, uv).rgb;
  // Charcoal precast: bounded linear albedo, with neutral fine grain rather than the photo's tan cast.
  sAlb = vec3(clamp(0.065 + 0.012 * (h - 0.5) + 0.018 * (dot(detail, LUMW) - 0.25), 0.05, 0.08));
  sTn = texture2D(tConcreteN, uv).xyz * 2.0 - 1.0;
  sTn.xy *= 0.30;
  float jointD = min(min(f.x, 1.0 - f.x) * 0.6, min(f.y, 1.0 - f.y) * 0.3);
  float aa = max(0.001, length(fwidth(lp)) * 0.5);
  float joint = (1.0 - smoothstep(0.003 - aa, 0.003 + aa, jointD)) * min(1.0, 0.003 / aa);
  sAlb *= 1.0 - 0.18 * joint;
  sRough = 0.35 + 0.04 * (h - 0.5);
  // Times Square plaza: sealed precast, wiped down nightly; the screens have to read in it
  sRough = mix(sRough, 0.22, timesSquare(p) * (0.5 + 0.5 * uNight));
  // Flush 5 cm nickel-steel discs in ~6% of pavers; reflective, never emissive.
  vec2 discOffset = (vec2(hash12(cell + 6.1), hash12(cell + 9.7)) - 0.5) * vec2(0.35, 0.14);
  float discD = length((f - 0.5) * vec2(0.6, 0.3) - discOffset);
  float disc = step(h, 0.06) * (1.0 - smoothstep(0.025 - aa, 0.025 + aa, discD)) * min(1.0, 0.025 / aa);
  sAlb = mix(sAlb, vec3(0.56, 0.58, 0.60), disc);
  sRough = mix(sRough, 0.21, disc);
  sMetal = disc * 0.9;
  sTn.xy *= 1.0 - disc;
  float hgt = 0.55 * texture2D(tNoise, p / 13.0).g + 0.25 * nLow.r + 0.12 * (h - 0.5) + 0.08 * nMid.g - 0.25 * joint;
  vec2 wm = wetMasks(hgt, wet);
  film = wm.x; puddle = wm.y;
  sAlb *= 1.0 - 0.2 * wet * (1.0 - film);
  sAlb *= mix(1.0, 0.5, film);
  sRough = mix(sRough, 0.24, film * 0.92);
} else {
  // ---- concrete flags 1.52 m aligned to the street (kind 1) or plain concrete (kind 7)
  float th = 0.25 * atan(vB.y, vB.x);
  vec2 lp = rot2(p, -th);
  vec2 cell = floor(lp / ${FLAG_SIZE_M});
  vec2 f = fract(lp / ${FLAG_SIZE_M});
  float h = hash12(cell + vec2(0.7, 0.2));
  vec2 uv = p / uConcreteScale;
  vec3 cTex = texture2D(tConcrete, uv).rgb;
  // light warm grey NYC concrete: the source map is dark and brown, keep its grain and set the tone here
  sAlb = (0.19 + 1.45 * mix(vec3(dot(cTex, LUMW)), cTex, 0.35)) * vec3(1.0, 0.975, 0.94);
  sTn = texture2D(tConcreteN, uv).xyz * 2.0 - 1.0;
  sRough = uHasConcreteR > 0.5 ? 0.82 + 0.5 * (texture2D(tConcreteR, uv).r - 0.78) : 0.88;
  bool flags = kind < 1.5;
  // Joints have to survive 40 m. Per axis: a 2.5 cm saw cut widened to a screen-space minimum taken from
  // fwidth so it never mips or aliases away, with a contrast floor, and each axis faded out only once its
  // own 1.52 m period is undersampled (perspective compresses the transverse lines long before the
  // longitudinal ones). Every fourth joint is a 4 cm bituminous expansion strip: 6.08 m, as poured.
  vec2 jIdx = floor(lp / ${FLAG_SIZE_M} + 0.5);
  vec2 dax = abs(lp - jIdx * ${FLAG_SIZE_M});
  vec2 jfw = max(fwidth(lp), vec2(1e-5));
  vec2 strip = step(mod(jIdx, 4.0), vec2(0.5));
  vec2 jwid = mix(vec2(0.0125), vec2(0.021), strip);
  vec2 jhw = max(jwid, jfw * 0.7);
  vec2 jfade = 1.0 - smoothstep(0.40, 1.0, jfw / ${FLAG_SIZE_M});
  vec2 jline = (1.0 - smoothstep(jhw - jfw * 0.6, jhw + jfw * 0.6, dax)) * clamp(jwid / jhw, 0.80, 1.0) * jfade;
  if (!flags) jline = vec2(0.0);
  float dmin = min(dax.x, dax.y);
  float joint = max(jline.x, jline.y);
  float expansion = max(jline.x * strip.x, jline.y * strip.y);
  float jointSoft = flags ? (1.0 - smoothstep(0.0, 0.09 + 0.6 * max(jfw.x, jfw.y), dmin)) * max(jfade.x, jfade.y) : 0.0;
  // per-flag tint / age (+-14 %), with a small warm/cool drift from pour to pour
  float tint = 0.86 + 0.28 * h;
  float patched = 0.0;
  if (h > 0.92) { tint = 1.28; patched = 1.0; } // replaced flag: newer, lighter concrete (one in twelve)
  else if (h < 0.07) tint = 0.74;               // old, stained
  vec3 drift = 1.0 + (hash12(cell + vec2(3.1, 7.7)) - 0.5) * vec3(0.06, 0.0, -0.07);
  if (flags) sAlb *= tint * drift;
  sAlb *= 0.88 + 0.24 * nLow.r;        // block-scale grime variation
  sAlb *= 0.94 + 0.12 * nMid.g;
  sRough += 0.06 * (h - 0.5) - 0.08 * patched;
  // Times Square: the pedestrian plaza flags are burnished by the crowd, enough sheen to hold the signs
  sRough = mix(sRough, 0.44, timesSquare(p) * (0.5 + 0.5 * uNight));
  sTn.xy *= 1.0 - 0.5 * patched;       // a smoother trowel finish
  // grime along the gutter side (dirt splashed up from the road) and a lighter, salted band by the building line
  float curbD = vB.w > 0.5 && vA.z > 0.5 ? abs(vA.y) - vA.z : 10.0;
  // 30 cm of splash-stained flags along the curb line, then a wider grime fade toward the building line
  float curbBand = 1.0 - smoothstep(0.03, 0.33, curbD);
  float curbGrime = 1.0 - smoothstep(0.1, 1.3, curbD);
  sAlb *= 1.0 - 0.28 * curbBand * (0.7 + 0.3 * nMid.r) - 0.13 * curbGrime * (0.5 + 0.5 * nMid.r);
  // stains: blotches of spilled drink, tree drip and rust from railings
  float stain = smoothstep(0.6, 0.78, texture2D(tNoise, p / 4.7 + 0.37).g * 0.6 + nMid.b * 0.4);
  sAlb *= 1.0 - 0.24 * stain * (1.0 - 0.6 * patched);
  // gum spots: 3 cm black discs at ~3 per m2, drawn only inside 10 m where they are wider than a pixel
  vec2 gc = floor(lp / 0.25);
  vec2 gf = fract(lp / 0.25) - 0.5;
  float gh = hash12(gc + 5.1);
  float gumNear = 1.0 - smoothstep(6.5, 10.5, length(vWPos - cameraPosition));
  float gum = step(gh, 0.20) * (1.0 - smoothstep(0.055, 0.085, length(gf) * (0.9 + 0.7 * hash12(gc + 9.0)))) * gumNear;
  sAlb = mix(sAlb, sAlb * 0.26, gum * 0.92 * (1.0 - 0.7 * patched));
  sRough = mix(sRough, 0.4, gum);
  // cracks
  float crack = (1.0 - smoothstep(0.0, 0.045, texture2D(tNoise, p / 5.0 + 0.2).a)) * smoothstep(0.55, 0.75, nMid.b + 0.15 * (1.0 - h)) * (1.0 - patched);
  sAlb *= 1.0 - 0.5 * crack;
  // joints: a dark saw cut, near black in the expansion strips, plus a groove normal
  sAlb *= 1.0 - clamp(0.65 * joint + 0.20 * expansion, 0.0, 0.86) - 0.15 * jointSoft;
  vec2 gdir = vec2(0.0);
  if (flags) gdir = rot2(sign(lp - jIdx * ${FLAG_SIZE_M}) * jline, th) * 0.55;
  sTn = normalize(vec3(sTn.xy * 0.6 + gdir, 1.0));
  // wet: flags drain toward the curb; the saw-cut joints hold water first, then the low flags pool
  float hgt = 0.5 * texture2D(tNoise, p / 11.0).g + 0.22 * nLow.r + 0.14 * nMid.g + 0.14 * (h - 0.5)
    + 0.06 * texture2D(tNoise, p / 1.9 + 0.43).g - 0.32 * joint - 0.06 * jointSoft - 0.08 * curbGrime;
  vec2 wm = wetMasks(hgt, wet);
  film = wm.x; puddle = wm.y;
  sAlb *= 1.0 - 0.2 * wet * (1.0 - film);
  sAlb *= mix(1.0, 0.48, film);
  sRough = mix(sRough, 0.27, film * 0.92);
  sTn = normalize(vec3(sTn.xy * mix(1.0, 0.5, film), 1.0));
}
sAlb = mix(sAlb, sAlb * 0.55, puddle);
sRough = mix(sRough, 0.05, puddle);
sTn = mix(sTn, vec3(0.0, 0.0, 1.0), puddle);
sTn.xy += rainRings(p) * puddle;
sTn = normalize(sTn);
diffuseColor.rgb *= sAlb;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(sRough, 0.02, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = sMetal;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(perturbN(normalize(vWNormal), sTn), 0.0)).xyz);');
  });
  return { material, uniforms };
}

/* ------------------------------------------------------------------ markings / decals */

/**
 * attribute layout: aLocal (2) region-space coords, aRegion (4) atlas rect, aM (4) = (paintHealth, mode 0 tile/1 stretch, metalness, darken),
 * aT (4) = road frame (rx, rz, c, laneCode) so paint wears in the wheel tracks; all zero = no frame
 */
export function createMarkingsMaterial(tex: StreetTextures, shared: SharedUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    alphaTest: 0.02,
    envMapIntensity: 1,
  });
  material.name = 'streets-markings';
  installPatch(material, 'streets-markings', (shader) => {
    material.userData.streetUniforms = shader.uniforms;
    shader.uniforms.tAtlas = { value: tex.atlas };
    shader.uniforms.tNoise = { value: tex.noise };
    shader.uniforms.uWetness = shared.uWetness;
    shader.uniforms.uRain = shared.uRain;
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uNight = shared.uNight;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aLocal;
attribute vec4 aRegion;
attribute vec4 aM;
attribute vec4 aT;
varying vec2 vLocal;
varying vec4 vRegion;
varying vec4 vM;
varying vec4 vT;
varying vec3 vWPos;
varying vec3 vWNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLocal = aLocal;
vRegion = aRegion;
vM = aM;
vT = aT;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * normal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D tAtlas;
uniform sampler2D tNoise;
uniform float uWetness, uRain, uTime, uNight;
varying vec2 vLocal;
varying vec4 vRegion;
varying vec4 vM;
varying vec4 vT;
varying vec3 vWPos;
varying vec3 vWNormal;
${GLSL_WET}`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
vec2 lc = vM.y > 0.5 ? clamp(vLocal, 0.0, 1.0) : fract(vLocal);
vec2 uv = vRegion.xy + lc * vRegion.zw;
vec4 tx = texture2D(tAtlas, uv);
vec2 p = vWPos.xz;
float health = vM.x;
// wear: flaking from the mid octave, chipped edges from the fine ridged noise. The noise channels sit
// around 0.5 with a small spread, so remap the mix to ~0..1 before thresholding against the wear amount.
float nh = texture2D(tNoise, p / 2.3).b * 0.4 + texture2D(tNoise, p / 7.0).g * 0.35 + texture2D(tNoise, p / 0.9 + 0.4).a * 0.25;
nh = clamp((nh - 0.22) / 0.40, 0.0, 1.0);
float wear = 1.0 - health;
// tyres take the paint off in the wheel tracks first
float track = 0.0;
if (abs(vT.x) + abs(vT.y) > 0.5) {
  float laneW = mod(vT.w, 100.0);
  float phase = vT.w >= 100.0 ? laneW * 0.5 : 0.0;
  if (laneW < 1.0) { laneW = 3.3; phase = 0.0; }
  float lo = dot(p, vT.xy) - vT.z;
  float lpn = mod(lo - phase + laneW * 0.5, laneW) - laneW * 0.5;
  track = exp(-pow((abs(lpn) - 0.85) / 0.5, 2.0));
}
wear = clamp(wear + 0.38 * track, 0.0, 0.85);
float wearMask = smoothstep(wear - 0.12, wear + 0.12, nh);
float alpha = tx.a * wearMask;
if (vM.z > 0.5) alpha = tx.a; // metal decals do not wear away
vec3 alb = tx.rgb * (1.0 - 0.25 * vM.w);
// paint scuffed by tyres and dirt: greyer where it is thin, tyre-grey across the tracks
float thin = 1.0 - smoothstep(wear + 0.02, wear + 0.38, nh);
alb = mix(alb, alb * 0.55, (wear * 0.45 + 0.45 * thin + 0.15 * track) * (1.0 - vM.z));
float wet = uWetness;
// the road's water level (same noise taps as the asphalt shader), ruts lower
float hgt = 0.5 * texture2D(tNoise, p / 19.0 + 0.11).g + 0.2 * texture2D(tNoise, p / 41.0).r
  + 0.22 * texture2D(tNoise, p / 9.3 + 0.31).g + 0.08 * texture2D(tNoise, p / 2.3 + 0.61).g - 0.10 * track;
vec2 wm = wetMasks(hgt, wet);
float film = wm.x, puddle = wm.y;
// paint and steel darken less than asphalt but go just as glossy
alb *= 1.0 - 0.12 * wet * (1.0 - film);
alb *= mix(1.0, 0.72, film);
alb = mix(alb, alb * 0.7, puddle);
diffuseColor = vec4(alb, alpha);
float sRough = mix(vM.z > 0.5 ? 0.42 : 0.6, vM.z > 0.5 ? 0.16 : 0.12, film);
sRough = mix(sRough, 0.05, puddle);
vec3 sTn = normalize(vec3(rainRings(p) * puddle, 1.0));
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vM.z * 0.55;')
      .replace(
        '#include <normal_fragment_maps>',
        `{
  vec3 Nw = normalize(vWNormal);
  vec3 T = abs(Nw.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 1.0, 0.0), Nw));
  vec3 B = cross(Nw, T);
  normal = normalize((viewMatrix * vec4(normalize(T * sTn.x + B * sTn.y + Nw * sTn.z), 0.0)).xyz);
}`,
      );
  });
  return material;
}

/* ------------------------------------------------------------------ bridge structure / portals */

/** vertex-coloured concrete/steel with world-space grime; aA.x = 0 concrete, 1 painted steel, 2 rusty iron */
export function createStructureMaterial(tex: StreetTextures, shared: SharedUniforms): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0, vertexColors: true, envMapIntensity: 1 });
  material.name = 'streets-structure';
  installPatch(material, 'streets-structure', (shader) => {
    shader.uniforms.tNoise = { value: tex.noise };
    material.userData.streetUniforms = shader.uniforms;
    shader.uniforms.tConcrete = { value: tex.concrete.albedo };
    shader.uniforms.tConcreteN = { value: tex.concrete.normal };
    shader.uniforms.uWetness = shared.uWetness;
    shader.uniforms.uRain = shared.uRain;
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uNight = shared.uNight;
    VERTEX_PATCH(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${GLSL_COMMON}
uniform sampler2D tConcrete, tConcreteN;`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `
vec3 Nw = normalize(vWNormal);
vec2 p = abs(Nw.y) > 0.5 ? vWPos.xz : (abs(Nw.x) > abs(Nw.z) ? vWPos.zy : vWPos.xy);
vec4 nLow = texture2D(tNoise, p / 23.0);
vec4 nMid = texture2D(tNoise, p / 4.0 + 0.4);
float mat = vA.x;
vec3 sAlb;
float sRough;
vec3 sTn;
if (mat < 0.5) {
  vec2 uv = p / 2.6;
  sAlb = texture2D(tConcrete, uv).rgb * (0.85 + 0.3 * nLow.g);
  sTn = texture2D(tConcreteN, uv).xyz * 2.0 - 1.0;
  sRough = 0.88;
  // formwork lines + streaks
  float streak = smoothstep(0.55, 0.9, texture2D(tNoise, vec2(p.x / 1.5, p.y / 14.0)).b) * 0.35 * (1.0 - Nw.y);
  sAlb *= 1.0 - streak;
} else if (mat < 1.5) {
  sAlb = vec3(1.0) * (0.85 + 0.3 * nLow.r);
  sTn = normalize(vec3((nMid.rg - 0.5) * 0.15, 1.0));
  sRough = 0.55 + 0.2 * nMid.b;
  float rust = smoothstep(0.6, 0.85, nMid.g * 0.6 + nLow.b * 0.4);
  sAlb = mix(sAlb, vec3(0.42, 0.22, 0.12), rust * 0.6);
} else {
  sAlb = vec3(0.9 + 0.2 * nMid.r);
  sTn = normalize(vec3((nMid.rg - 0.5) * 0.3, 1.0));
  sRough = 0.75;
}
float wet = uWetness;
sAlb *= mix(1.0, 0.7, wet * (0.5 + 0.5 * Nw.y));
sRough = mix(sRough, 0.3, wet * 0.6 * Nw.y);
diffuseColor.rgb *= sAlb;
`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = sRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(perturbN(Nw, sTn), 0.0)).xyz);');
  });
  return material;
}

/** re-point texture uniforms after CC0 sets arrive (materials recompile via needsUpdate) */
export function retarget(uniforms: Record<string, THREE.IUniform>, tex: StreetTextures): void {
  const set = (k: string, v: unknown) => {
    if (uniforms[k]) uniforms[k].value = v;
  };
  set('tAtlas', tex.atlas);
  set('tNoise', tex.noise);
  set('tAsphalt', tex.asphalt.albedo);
  set('tAsphaltN', tex.asphalt.normal);
  set('tAsphaltR', tex.asphalt.rough);
  set('tAsphalt2', tex.asphalt2);
  set('uAsphaltScale', tex.asphalt.scale);
  set('uAsphalt2Scale', tex.asphalt2Scale);
  set('uHasAsphaltR', tex.asphalt.rough ? 1 : 0);
  set('tConcrete', tex.concrete.albedo);
  set('tConcreteN', tex.concrete.normal);
  set('tConcreteR', tex.concrete.rough);
  set('uConcreteScale', tex.concrete.scale);
  set('uHasConcreteR', tex.concrete.rough ? 1 : 0);
  set('tGranite', tex.granite.albedo);
  set('tGraniteN', tex.granite.normal);
  set('uGraniteScale', tex.granite.scale);
  set('tCobble', tex.cobble.albedo);
  set('tCobbleN', tex.cobble.normal);
  set('tCobbleR', tex.cobble.rough);
  set('uCobbleScale', tex.cobble.scale);
  set('uHasCobbleR', tex.cobble.rough ? 1 : 0);
}
