/**
 * Props material: MeshStandardMaterial patched (onBeforeCompile) so one material per kind draws every
 * part of a prop from vertex attributes:
 *   color (albedo), aMat (roughness, metalness, uvMode), aEmit (channel, strength), per-instance aData.
 * Emissive channels (builder.ts EMIT):
 *   1 lamp head  : mix(uLampWarm, uLampWhite, aData.x) * strength * uLamp
 *   2 nightGlow  : vertexColor * strength * uLamp
 *   3/4/5 lenses : lit when aData.y == 0/1/2 (red/yellow/green)
 *   6 alwaysGlow : vertexColor * strength
 *   7 pedFace    : map frame from aData.z (uv shift in the vertex shader)
 *   8 mapGlowNight: sampled map * strength * uLamp (lightboxes)
 *   9 mapGlow    : sampled map * strength (screens)
 * Atlas kinds (uvMode 1): vMapUv = aData.xy + uv * aData.zw.
 * World's Fair bench slats alone reserve uvMode -1 for local grain/varnish and flush hardware.
 * Food-cart non-print parts alone reserve uvMode -4 for untextured metal, cloth and hardware.
 * The inverted-U/bicycle assembly alone reserves uvMode -8 for zinc, enamel and spoke cutouts.
 * Domed bollards alone reserve uvMode -9 for black paint, local wear and connected chains.
 * Shelter solids/glass reserve -10/-11; -10/w=1 is the seat skin, +5 is the backlit print.
 * Bus flag print alone reserves +6 for opaque alpha-cut route sheets (never emissive).
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { makeBasketTexture } from './textures';
import { makeCitiBikeMark, makeMailboxTexture, makePlanterLeafTexture } from './atlas';

export interface PropUniforms {
  uLamp: { value: number };
  uLampWarm: { value: THREE.Color };
  uLampWhite: { value: THREE.Color };
  uWet: { value: number };
  uPedFrames: { value: number };
}

/** shared by identity across every props material */
export const PROP_UNIFORMS: PropUniforms = {
  uLamp: { value: 0 },
  uLampWarm: { value: new THREE.Color(1.0, 0.62, 0.28) },
  uLampWhite: { value: new THREE.Color(1.0, 0.88, 0.72) },
  uWet: { value: 0 },
  uPedFrames: { value: 32 },
};

export interface PropMaterialOpts {
  map?: THREE.Texture | null;
  atlas?: boolean;
  /** Apply color/alpha map only to parts tagged textured in MeshBuilder. */
  selectiveMap?: boolean;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  side?: THREE.Side;
  envMapIntensity?: number;
  depthWrite?: boolean;
  name?: string;
}

const VERT_PARS = /* glsl */ `
attribute vec4 aMat;
attribute vec2 aEmit;
#ifdef USE_INSTANCING
attribute vec4 aData;
#else
const vec4 aData = vec4(0.0, 0.0, 0.0, 1.0);
#endif
varying vec4 vPropMat;
varying vec2 vPropEmit;
varying vec4 vPropData;
varying vec2 vPropUv;
#ifdef PROP_BIKE_RACK
varying vec3 vBikeRackLocal;
#endif
#ifdef PROP_SUBWAY_GLOBE
varying vec2 vSubwayGlobe;
#endif
#ifdef PROP_ATLAS
varying vec3 vSubwayLocal;
#endif
uniform float uPedFrames;
`;

const VERT_UV = /* glsl */ `
vPropMat = aMat;
vPropEmit = aEmit;
vPropData = aData;
vPropUv = uv;
#ifdef PROP_BIKE_RACK
vBikeRackLocal = position;
#endif
#ifdef PROP_SUBWAY_GLOBE
  // Exact existing buildGlobeLamp lens signature, not all nightGlow parts (sheds/shelters).
  // Only the daylight diffuse surface changes. Never rewrite its color/emission attributes.
  vSubwayGlobe = vec2(0.0, position.y);
  #ifdef USE_COLOR
    if (abs(aEmit.x - 2.0) < 0.001 && abs(aEmit.y - 1.6) < 0.001 &&
        abs(aMat.x - 0.35) < 0.001 && aMat.y < 0.001 && aMat.z < 0.5 &&
        distance(color, vec3(${new THREE.Color(0x2f9a4a).toArray().map(v => v.toFixed(8)).join(', ')})) < 0.00001)
      vSubwayGlobe.x = 1.0;
  #endif
#endif
#ifdef PROP_ATLAS
vSubwayLocal = position;
#endif
#ifdef USE_MAP
  #ifdef PROP_ATLAS
    if (aMat.z > 0.5) vMapUv = aData.xy + vMapUv * aData.zw;
  #endif
  if (aEmit.x > 6.5 && aEmit.x < 7.5) {
    // pedestrian face: frames laid out horizontally in the map
    vMapUv = vec2((vMapUv.x + floor(aData.z + 0.5)) / uPedFrames, vMapUv.y);
  }
#endif
`;

const FRAG_PARS = /* glsl */ `
varying vec4 vPropMat;
varying vec2 vPropEmit;
varying vec4 vPropData;
varying vec2 vPropUv;
uniform float uLamp;
uniform vec3 uLampWarm;
uniform vec3 uLampWhite;
uniform float uWet;
#ifdef PROP_BIKE_RACK
varying vec3 vBikeRackLocal;
float bikeRackHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float bikeRackWear(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bikeRackHash(vec3(cell, 7.0)), bikeRackHash(vec3(cell + vec2(1.0, 0.0), 7.0)), f.x),
             mix(bikeRackHash(vec3(cell + vec2(0.0, 1.0), 7.0)), bikeRackHash(vec3(cell + vec2(1.0), 7.0)), f.x), f.y);
}
#endif
#ifdef PROP_SUBWAY_GLOBE
varying vec2 vSubwayGlobe;
#endif
#ifdef PROP_ATLAS
varying vec3 vSubwayLocal;
float subwayHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float subwayWear(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(subwayHash(i), subwayHash(i + vec2(1.0, 0.0)), f.x),
             mix(subwayHash(i + vec2(0.0, 1.0)), subwayHash(i + vec2(1.0)), f.x), f.y);
}
#endif
#ifdef PROP_BASKET
uniform sampler2D uBasketMap;
#endif
#ifdef PROP_CITI_MARK
uniform sampler2D uCitiMark;
#endif
`;

// Reserved ONLY by buildTrashBags. Count/collection gates never touch other kinds,
// even though the street furniture shares the same base material and texture.
const TRASH_GATE = /* glsl */ `
uniform float uTrashEvening;
bool trashVisible(vec4 mat, vec4 data) {
  float count = mix(data.y, data.x, step(0.5, uTrashEvening));
  if (count < 0.5) return false;
  // Recycling replaces one black slot in some 4..8-bag piles, keeping the
  // requested TOTAL at 3..8 and at least three black bags in every evening pile.
  bool recycling = uTrashEvening > 0.5 && data.x > 3.5 && data.z < 0.65;
  if (mat.w < 7.5) return mat.w < count - (recycling ? 1.0 : 0.0) - 0.5;
  if (mat.w < 8.5) return recycling; // recycling film AND its contents
  return true; // flattened cardboard stays with any remaining bags
}
`;
const TRASH_VERTEX = /* glsl */ `
if (aMat.z < -13.5 && aMat.z > -17.5 && !trashVisible(aMat, aData)) {
  transformed = vec3(0.0); // no daytime fragments/depth for a hidden bag
}
`;
const TRASH_SURFACE = /* glsl */ `
bool propTrash = vPropMat.z < -13.5 && vPropMat.z > -17.5;
float trashRelief = 0.0;
float trashRoughness = vPropMat.x;
float trashFold = 0.0;
if (propTrash) {
  if (!trashVisible(vPropMat, vPropData)) discard;
  vec2 p = vPropUv;
  float seed = vPropData.z * 6.2831853 + vPropMat.w * 1.71;
  if (vPropMat.z > -15.5) {
    // Thin irregular tension folds climb toward the pinched neck, crossing
    // broad compressed creases in the belly. Geometry supplies the major folds.
    float a = p.x * 6.2831853;
    float gather = a * 17.0 + 1.7 * sin(p.y * 8.0 + a * 3.0 + seed);
    float crossFold = p.y * 56.0 + 5.0 * sin(a * 3.0 + seed) + 2.0 * sin(a * 7.0 - p.y * 8.0);
    float aa = 1.0 - smoothstep(1.0, 3.0, max(fwidth(gather), fwidth(crossFold)));
    float ridge = pow(0.5 + 0.5 * sin(gather), 10.0);
    float crease = pow(0.5 + 0.5 * sin(crossFold), 12.0) * (1.0 - smoothstep(0.65, 0.96, p.y));
    trashFold = max(ridge * 0.7, crease) * aa;
    trashRelief = (ridge * 0.0022 + crease * 0.0016) * aa;
    trashRoughness = clamp(vPropMat.x + 0.10 * trashFold + 0.035 * sin(a * 5.0 + p.y * 13.0 + seed), 0.20, 0.44);
    diffuseColor.rgb *= (0.91 + 0.09 * sin(seed + p.y * 9.0 + a * 2.0)) * (1.0 - 0.20 * trashFold);
  } else if (vPropMat.z > -16.5) {
    float crease = exp(-abs(p.x - 0.49 - 0.025 * sin(p.y * 8.0)) * 140.0);
    float flutePhase = p.x * 460.0;
    float flutes = sin(flutePhase) * (1.0 - smoothstep(1.0, 3.0, fwidth(flutePhase)));
    float edge = 1.0 - smoothstep(0.01, 0.04, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)));
    diffuseColor.rgb *= 0.93 + 0.045 * sin(p.x * 91.0 + sin(p.y * 24.0)) - 0.24 * crease + edge * flutes * 0.16;
    // Broken tape remnant, brown kraft faces and corrugated torn edge, no logo.
    float tape = (1.0 - smoothstep(0.045, 0.052, abs(p.x - 0.72))) * step(0.18, p.y) * step(p.y, 0.81);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.21, 0.14, 0.072), tape * 0.48);
    trashRoughness = mix(0.97, 0.58, tape);
    trashRelief = -0.0007 * crease + 0.00025 * flutes;
  }
}
`;
const TRASH_NORMAL = /* glsl */ `
if (propTrash) {
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float det = dot(dx, rx);
  if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - sign(det)
    * (dFdx(trashRelief) * rx + dFdy(trashRelief) * ry));
  if (vPropMat.z < -14.5 && vPropMat.z > -15.5) {
    // Ordered screen-door transmission keeps true interior geometry visible in
    // the opaque instanced draw (no per-pile transparency sorting or new material).
    // Film is clearer face-on, milkier at overlapping creases and grazing edges.
    float grazing = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
    float coverage = clamp(0.22 + 0.53 * grazing + 0.25 * trashFold, 0.22, 0.83);
    vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
    vec2 low = mod(cell, 2.0), high = floor(cell / 2.0);
    float threshold = (4.0 * (2.0 * low.x + 3.0 * low.y - 4.0 * low.x * low.y)
      + 2.0 * high.x + 3.0 * high.y - 4.0 * high.x * high.y + 0.5) / 16.0;
    if (coverage < threshold) discard;
  }
}
`;

// Only finishCiti emits -4 (solid) / -5 (decal). Never retexture another prop sharing the material.
const CITI_MAP = /* glsl */ `
if (vPropMat.z < -3.5 && vPropMat.z > -4.5) sampledDiffuseColor = vec4(1.0);
#ifdef PROP_CITI_MARK
  if (vPropMat.z < -4.5 && vPropMat.z > -5.5) {
    sampledDiffuseColor = texture2D(uCitiMark, vPropUv);
    // Only Citi decal triangles: expose the real grey casting around the white/red print.
    if (sampledDiffuseColor.a < 0.4) discard;
    sampledDiffuseColor.a = 1.0;
  }
#endif
`;

// Only the dock casting opts into this mask (-4 solid, w=1). Its metric UV.y is authored height,
// including the cap/bevels; no instance atlas coordinates or unrelated metal finishes are changed.
const CITI_DOCK_SURFACE = /* glsl */ `
#ifdef PROP_CITI_MARK
  if (vPropMat.z < -3.5 && vPropMat.z > -4.5 && vPropMat.w > 0.5 && vPropMat.w < 1.5) {
    vec2 citiP = vPropUv;
    float citiMottle = 0.5 + 0.28 * sin(citiP.x * 18.0 + 1.6 * sin(citiP.y * 7.0))
      * sin(citiP.y * 10.0 + citiP.x * 5.0);
    float citiToe = 1.0 - smoothstep(0.06, 0.34, citiP.y);
    float citiStreakPhase = citiP.x * 78.0 + 0.7 * sin(citiP.y * 6.0);
    float citiStreak = smoothstep(0.63, 0.96, 0.5 + 0.5 * sin(citiStreakPhase))
      * (1.0 - smoothstep(0.14, 0.70, citiP.y))
      * (1.0 - smoothstep(0.7, 2.2, fwidth(citiStreakPhase)));
    // Quiet, irregular grey discoloration and two rubbed marks at shoe height, not rusty stripes.
    float citiRubA = 1.0 - smoothstep(0.35, 1.0, length((citiP - vec2(-0.19, 0.12)) / vec2(0.095, 0.019)));
    float citiRubB = 1.0 - smoothstep(0.25, 1.0, length((citiP - vec2(0.06, 0.075)) / vec2(0.065, 0.013)));
    float citiRub = max(citiRubA, citiRubB) * (0.65 + 0.35 * sin(citiP.x * 91.0));
    diffuseColor.rgb *= 0.99 - 0.03 * citiMottle - 0.25 * citiToe * (0.7 + 0.3 * citiMottle) - 0.055 * citiStreak;
    diffuseColor.rgb += vec3(0.025, 0.024, 0.021) * citiRub;
  }
#endif
`;

/** No map allocation or material state changes: only buildBikeRack emits selector -8.
 * Ref: ART_DIRECTION _general-1 / steam-stack-1; small lock/finish details are brief-led.
 * Opaque-depth alpha cutouts leave air between spokes, not tinted/solid wheel discs.
 */
const BIKE_RACK_SURFACE = /* glsl */ `
#ifdef PROP_BIKE_RACK
bool propBikeRack = vPropMat.z < -7.5 && vPropMat.z > -8.5;
float bikeRackRoughness = vPropMat.x;
float bikeRackMetalness = vPropMat.y;
float bikeRackOcclusion = 1.0;
if (propBikeRack) {
  float role = vPropMat.w;
  if (role > 3.5) {
    // Follow the existing sixteen-sided plate with a continuous 3 mm contact seam.
    // Subpixel coverage changes its shade, never turns it into a dotted halo.
    // The dark plate underside below carries most of the grounding at distance.
    vec2 footP = (vPropUv - 0.5) * 0.19;
    float angle = atan(footP.y, footP.x);
    float edge = length(footP) * cos(mod(angle, 0.3926990817) - 0.1963495408) - 0.0637510432;
    float width = 0.003;
    float coverage = min(1.0, width / max(fwidth(edge), 0.0001));
    if (edge < -0.003 || edge > width) discard;
    diffuseColor.rgb *= mix(1.35, 0.72, coverage * (1.0 - smoothstep(0.0, width, edge)));
    bikeRackOcclusion = 0.62;
  } else if (role > 2.5) {
    vec2 spokeP = (vPropUv - 0.5) * 0.624;
    float radius = length(spokeP);
    if (radius > 0.308 || radius < 0.018) discard;
    float angle = atan(spokeP.y, spokeP.x);
    // Two sets of 16 straight, tangentially laced spokes, attached to a 40 mm hub.
    // Distance to the nearest chord, not a radial wedge that thickens toward the rim.
    float pitch = 0.3926990817;
    float offset = 0.017;
    float skew = asin(min(0.999, offset / radius));
    float a = floor((angle - skew) / pitch + 0.5) * pitch;
    float b = floor((angle + skew - pitch * 0.5) / pitch + 0.5) * pitch + pitch * 0.5;
    float wire = min(abs(sin(angle - a) * radius - offset), abs(sin(angle - b) * radius + offset));
    float aa = max(fwidth(wire), 0.00015);
    float coverage = 1.0 - smoothstep(0.00085 - aa * 0.5, 0.00085 + aa * 0.5, wire);
    if (coverage < 0.48) discard;
    diffuseColor.rgb *= 0.78 + 0.22 * coverage;
  } else {
    vec3 p = vBikeRackLocal;
    float lowDirt = 1.0 - smoothstep(0.025, 0.22, p.y);
    if (role < 0.5) {
      // Smooth local-metre oxidation, shared by hoop and feet. Neutral zinc and
      // broad roughness variation separate it from the bicycle's green enamel.
      // Keep the fine spangle weaker still on the feet: no pale hardware specks.
      vec3 cells = p * 145.0;
      float resolved = 1.0 - smoothstep(0.55, 1.6, length(fwidth(cells)));
      float spangle = (bikeRackHash(floor(cells)) - 0.5) * resolved;
      float oxidation = bikeRackWear(vec2(p.x * 9.0 + p.z * 11.0, p.y * 7.0 + p.z * 5.0));
      float smudge = bikeRackWear(vec2(p.x * 43.0 + p.z * 61.0, p.y * 37.0 - p.z * 29.0) + vec2(3.7, 8.4));
      // Irregular dirt height and strength, not a level painted-on splash stripe.
      float grime = (1.0 - smoothstep(0.018, 0.16 + oxidation * 0.10, p.y))
        * (0.68 + smudge * 0.32);
      float plate = 1.0 - smoothstep(0.012, 0.030, p.y);
      float rub = (1.0 - smoothstep(0.05, 0.16, abs(p.y - 0.57)))
        * smoothstep(0.22, 0.285, abs(p.x)) * (0.5 + 0.5 * sin(p.y * 73.0 + p.z * 20.0));
      diffuseColor.rgb *= 0.99 + (oxidation - 0.5) * 0.10 + (smudge - 0.5) * 0.025
        + spangle * 0.018 * (1.0 - plate) - grime * 0.28 - plate * 0.065;
      diffuseColor.rgb += vec3(0.012) * rub;
      // Matching mounts are unresolved in the reference. Keep existing fasteners,
      // but omit bolt-centred rust/occlusion spots that overstate their detail.
      // Rough zinc still catches a broad sky/sun highlight; oxidized feet and
      // welds stay dull. Modulate the BRDF, not painted-on white highlight bands.
      bikeRackRoughness = clamp(vPropMat.x + 0.015 + (oxidation - 0.5) * 0.18
        + (smudge - 0.5) * 0.04 + grime * 0.17 + plate * 0.10 - rub * 0.065, 0.34, 0.78);
      bikeRackMetalness = clamp(vPropMat.y - grime * 0.14 - oxidation * 0.025 + rub * 0.045, 0.62, 0.88);
      float footRadius = length(vec2(abs(p.x) - 0.30, p.z));
      float weldContact = (1.0 - smoothstep(0.030, 0.045, footRadius)) * (1.0 - smoothstep(0.018, 0.033, p.y));
      float soleContact = 1.0 - smoothstep(0.002, 0.014, p.y);
      // Tight continuous dirt/occlusion at the plate's rim and weld, not bolt dots.
      // Including the top perimeter makes the 12 mm plate read as seated steel.
      float rimContact = smoothstep(0.052, 0.064, footRadius)
        * (1.0 - smoothstep(0.012, 0.018, p.y));
      bikeRackOcclusion = 1.0 - max(0.46 * weldContact, max(0.66 * soleContact, 0.40 * rimContact));
      diffuseColor.rgb *= 1.0 - max(0.42 * soleContact, 0.25 * rimContact);
    } else if (role < 1.5) {
      // Sparse frame chips concentrated around the lock and lower chainstay.
      float resolved = 1.0 - smoothstep(0.7, 1.8, length(fwidth(p * 160.0)));
      float contact = max(1.0 - smoothstep(0.035, 0.11, abs(p.y - 0.57)), lowDirt);
      float chip = smoothstep(0.91, 0.99, bikeRackHash(floor(p * 160.0))) * contact * resolved;
      diffuseColor.rgb *= 1.0 - lowDirt * 0.16;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.25, 0.23), chip * 0.7);
      bikeRackRoughness += chip * 0.14;
      bikeRackMetalness = chip * 0.45;
    } else {
      diffuseColor.rgb *= 1.0 - lowDirt * 0.12;
    }
  }
}
#endif
`;

// aMat.z 2/3/4 are set only by buildWireBasket. Other props, including the shed's shared mesh
// material, continue sampling their original map without altered UVs, color, alpha or roughness.
const BASKET_MAP = /* glsl */ `
#ifdef PROP_BASKET
  if (vPropMat.z > 1.5 && vPropMat.z < 4.5) {
    vec2 basketUv = clamp(vMapUv, vec2(0.004), vec2(0.996));
    if (vPropMat.z < 2.5) {
      basketUv = vec2(basketUv.x, 0.5 + basketUv.y * 0.5);
    } else if (vPropMat.z < 3.5) {
      basketUv = vec2((172.0 + basketUv.x * 340.0) / 512.0, basketUv.y * 0.5);
    } else {
      basketUv = vec2(basketUv.x * 172.0 / 512.0, basketUv.y * 0.5);
    }
    sampledDiffuseColor = texture2D(uBasketMap, basketUv);
    // Cutouts belong only to the wire; frame and notice must never become perforated at a mip seam.
    if (vPropMat.z > 2.5) sampledDiffuseColor.a = 1.0;
  } else
#endif
  if (vPropMat.w < 0.5) sampledDiffuseColor = vec4(1.0);
diffuseColor *= sampledDiffuseColor;
`;

/**
 * Requirement-led bench finish; Bryant Park's fallback sheet does not resolve this joinery.
 * All terms are board-local and deterministic, with derivative filtering at distance.
 * No atlas slots, new textures or per-instance random state; every non-bench part bypasses this.
 */
const BENCH_SURFACE = /* glsl */ `
bool propBenchSlat = vPropMat.z < -0.5 && vPropMat.z > -1.5;
float benchWear = 0.0;
float benchHead = 0.0;
float benchRelief = 0.0;
if (propBenchSlat) {
  float board = floor(mod(vPropUv.y + 0.00001, 20.0) * 0.5);
  float across = clamp(mod(vPropUv.y + 0.00001, 2.0), 0.0, 1.0);
  float exposed = 1.0 - step(19.5, vPropUv.y);
  float phase = board * 2.399;
  // Broad growth bands survive the close view; fine grain fades before it aliases.
  // Longitudinal bends differ by board, avoiding identical straight painted stripes.
  float growthPhase = 6.283185 * (across * 3.4 + 0.19 * sin(vPropUv.x * 3.0 + phase)
    + 0.055 * sin(vPropUv.x * 8.0 + phase));
  float growth = sin(growthPhase) * (1.0 - smoothstep(0.8, 3.0, fwidth(growthPhase)));
  float grainPhase = growthPhase * 4.6 + 0.45 * sin(vPropUv.x * 2.0 + phase);
  float grainFade = 1.0 - smoothstep(0.8, 3.0, fwidth(grainPhase));
  float grain = sin(grainPhase) * grainFade;
  float pores = smoothstep(0.64, 0.96, sin(grainPhase + 0.65 * sin(vPropUv.x * 17.0 + phase))) * grainFade;
  float edge = 1.0 - smoothstep(0.015, 0.085, min(across, 1.0 - across));
  // Uneven strips of worn varnish follow the fibres, with long intact darker areas.
  // Keep the original board colours; the lighter grey-brown is exposed wood, not lighting.
  float rubbed = smoothstep(0.30, 0.83, 0.5 + 0.28 * sin(vPropUv.x * 4.0 + phase)
    * sin(across * 3.0 + phase) + 0.22 * sin(across * 11.0 + phase + 0.3 * growth));
  float endWeather = smoothstep(0.69, 0.90, abs(vPropUv.x));
  benchWear = 0.30 * edge * (0.45 + 0.55 * rubbed) + (0.46 * rubbed + 0.12 * endWeather) * exposed;
  diffuseColor.rgb *= 0.99 + 0.070 * growth + 0.035 * grain - 0.11 * pores;
  // Desaturated bare fibres through uneven varnish, not green chair paint from the fallback sheet.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.235, 0.207, 0.165), benchWear);
  diffuseColor.rgb *= 1.0 - 0.10 * endWeather;
  benchRelief = (0.00005 * grain + 0.000035 * growth) * exposed;

  // Two nominal 14 mm domed bolt heads per slat over the x=+/-0.8 m cast webs.
  // These restrained dimensions are authored requirements, not measurements from the sheet.
  // Only the exposed broad face has hardware; no duplicate dots on end grain/undersides.
  float width = board < 4.5 ? 0.092 : 0.086;
  vec2 bolt = vec2(abs(vPropUv.x) - 0.8, (across - 0.5) * width);
  float radius = length(bolt);
  float aa = max(fwidth(radius), 0.0003);
  float resolved = 1.0 - smoothstep(0.004, 0.015, aa);
  // Restrained trapped dirt/tannin around the fastener, fading below pixel scale.
  float boltStain = (1.0 - smoothstep(0.008, 0.020, radius)) * exposed * resolved;
  diffuseColor.rgb *= 1.0 - 0.20 * boltStain;
  float rim = (1.0 - smoothstep(0.00825 - aa, 0.00825 + aa, radius)) * exposed * resolved;
  benchHead = (1.0 - smoothstep(0.007 - aa, 0.007 + aa, radius)) * exposed * resolved;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.030, 0.024), rim * 0.75);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.087, 0.075), benchHead);
  benchRelief += 0.0009 * max(0.0, 1.0 - radius * radius / 0.000049) * benchHead;
}
`;

const BENCH_NORMAL = /* glsl */ `
if (propBenchSlat) {
  // Shallow domed heads perturb the lit normal, rather than painting a fixed light direction.
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float determinant = dot(dx, rx);
  vec3 gradient = sign(determinant) * (dFdx(benchRelief) * rx + dFdy(benchRelief) * ry);
  normal = normalize(max(abs(determinant), 1e-10) * normal - gradient);
}
`;

const SUBWAY_MAP = /* glsl */ `
#ifdef PROP_ATLAS
  // -7 is authored only by buildNewsstand for unprinted steel, paper edges and canvas.
  // Do not make the shared mapped material selective for any other prop.
  if (vPropMat.z > -7.5 && vPropMat.z < -6.5) sampledDiffuseColor = vec4(1.0);
  if (vPropMat.w > 1.5 && vPropMat.w < 2.5 && vPropMat.z < 0.5) {
    sampledDiffuseColor = vec4(1.0);
    float grain = subwayWear(vMapUv * 18.0);
    // Enamel stays uniform here. Multiplying all painted faces by chip noise before vertex
    // colour made the tall castings look camouflage-painted, rather than locally abraded.
    if (vPropMat.x > 0.85) {
      // Worn coping, with a narrow dark contact band where it seats into the paving.
      diffuseColor.rgb *= (0.88 + 0.16 * grain) * mix(0.67, 1.0, smoothstep(0.15, 0.18, vSubwayLocal.y));
    }
  }
#endif
`;

// Only the newsstand's unprinted -7 metal parts use this finish. The metre-projected
// UV x axis follows each shelf length; unresolved brushing fades to smooth stainless.
// No shared atlas samples, coarse noise, painted highlight bands or weather speckle.
const NEWSSTAND_SURFACE = /* glsl */ `
bool newsstandSteel = vPropMat.z > -7.5 && vPropMat.z < -6.5 && vPropMat.y > 0.7;
float newsstandBrush = 0.0;
float newsstandRelief = 0.0;
if (newsstandSteel) {
  float nsPhase = vPropUv.y * 2400.0 + 0.35 * sin(vPropUv.x * 3.0);
  float nsResolved = 1.0 - smoothstep(0.8, 2.8, fwidth(nsPhase));
  newsstandBrush = sin(nsPhase) * nsResolved;
  // Subtle directional microfinish; actual scene lighting supplies the highlights.
  diffuseColor.rgb *= 0.997 + 0.003 * newsstandBrush;
  newsstandRelief = newsstandBrush * 0.000002;
}
`;

const NEWSSTAND_ROUGHNESS = /* glsl */ `
if (newsstandSteel) roughnessFactor = clamp(roughnessFactor + 0.018 * newsstandBrush, 0.03, 1.0);
`;

const NEWSSTAND_NORMAL = /* glsl */ `
if (newsstandSteel) {
  vec3 nsDx = dFdx(-vViewPosition), nsDy = dFdy(-vViewPosition);
  vec3 nsRx = cross(nsDy, normal), nsRy = cross(normal, nsDx);
  float nsDet = dot(nsDx, nsRx);
  if (abs(nsDet) > 1e-12) {
    normal = normalize(abs(nsDet) * normal - sign(nsDet)
      * (dFdx(newsstandRelief) * nsRx + dFdy(newsstandRelief) * nsRy));
  }
}
`;

// Instanced shelter-local metres, never world/camera coordinates. These paths only run on
// the -10/-11/+5 selectors authored by furniture.ts; other mapped/glass props stay unchanged.
const SHELTER_VERT_PARS = /* glsl */ `
varying vec3 vShelterLocal;
`;
const SHELTER_VERTEX = /* glsl */ `
vShelterLocal = position;
`;
const SHELTER_FRAG_PARS = /* glsl */ `
varying vec3 vShelterLocal;
float shelterHash(vec2 p) { return fract(sin(dot(p, vec2(41.73, 289.13))) * 43758.5453); }
float shelterNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(shelterHash(cell), shelterHash(cell + vec2(1, 0)), f.x),
    mix(shelterHash(cell + vec2(0, 1)), shelterHash(cell + vec2(1)), f.x), f.y);
}
`;
const SHELTER_SURFACE = /* glsl */ `
bool shelterMetal = vPropMat.z > -10.5 && vPropMat.z < -9.5 && vPropMat.y > 0.3;
bool shelterPane = vPropMat.z > -11.5 && vPropMat.z < -10.5;
float shelterDirt = 0.0;
float shelterBrush = 0.0;
float shelterFinish = 0.0;
float shelterSeatGroove = 0.0;
float shelterEtch = 0.0;
float shelterSmudge = 0.0;
if (shelterMetal) {
  vec3 p = vShelterLocal;
  vec2 finishUv = vPropUv * vec2(18.0, 7.0);
  float finishFootprint = max(fwidth(finishUv.x), fwidth(finishUv.y));
  float finishNoise = mix(0.5, shelterNoise(finishUv), 1.0 - smoothstep(0.3, 0.9, finishFootprint));
  // Broad handling/polish variation still reads when the fine brushing is subpixel.
  // Only the shelter's -10 steel opts in: no generic metal tint or painted highlights.
  shelterFinish = shelterNoise(vPropUv * vec2(2.6, 0.9)) - 0.5;
  float foot = 1.0 - smoothstep(0.19, 0.59, p.y);
  shelterDirt = foot * (0.60 + 0.40 * finishNoise);
  // Actual brushing changes roughness; its submillimetre frequency fades before aliasing.
  float phase = vPropUv.y * 1900.0 + 0.5 * sin(vPropUv.x * 11.0);
  shelterBrush = sin(phase) * (1.0 - smoothstep(0.75, 2.5, fwidth(phase)));
  diffuseColor.rgb *= 0.994 + 0.012 * finishNoise + 0.020 * shelterFinish - 0.24 * shelterDirt;
  // Short broken scuffs at the shoe/paving and sleeve edges, not noise over every member.
  float shoeEdge = min(abs(p.y - 0.173), abs(p.y - 0.2575));
  float abrasion = (1.0 - smoothstep(0.002, 0.014, shoeEdge))
    * smoothstep(0.43, 0.73, shelterNoise(vPropUv * vec2(120.0, 31.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.325, 0.35), abrasion * 0.48);
  if (vPropMat.w > 0.5 && vPropMat.w < 1.5) {
    // Four shallow 5 mm drainage grooves on the continuous seat top. Integrate each
    // groove over the pixel footprint so unresolved lines become coverage, not speckles.
    // This subtype is emitted only by buildBusShelter, never another metal bench.
    float grooveDist = abs(mod(p.z - 0.190, 0.086) - 0.043);
    float footprint = max(fwidth(p.z), 0.0005);
    float coverage = max(0.0, min(0.0025, grooveDist + footprint * 0.5)
      - max(-0.0025, grooveDist - footprint * 0.5)) / footprint;
    coverage = mix(coverage, 0.005 / 0.086, smoothstep(0.043, 0.086, footprint));
    shelterSeatGroove = coverage * smoothstep(0.594, 0.604, p.y);
    diffuseColor.rgb *= 1.0 - 0.18 * shelterSeatGroove;
  }
}
if (shelterPane) {
  vec2 uv = clamp(vPropUv, 0.0, 1.0);
  float cover = step(0.5, vPropMat.w);
  float edgeDist = min(min(uv.x, 1.0 - uv.x) * mix(1.352, 1.1, cover),
    min(uv.y, 1.0 - uv.y) * mix(2.13, 1.7, cover));
  float dust = (1.0 - smoothstep(0.004, 0.036, edgeDist))
    * (0.55 + 0.45 * shelterNoise(uv * vec2(53.0, 29.0)));
  float splash = (1.0 - smoothstep(0.38, 0.75, vShelterLocal.y)) * (1.0 - cover)
    * (0.28 + 0.72 * shelterNoise(uv * vec2(21.0, 7.0)));
  float streakPhase = uv.x * 161.0 + 0.6 * sin(uv.y * 13.0);
  float streak = smoothstep(0.84, 0.98, 0.5 + 0.5 * sin(streakPhase))
    * (1.0 - smoothstep(0.07, 0.54, uv.y))
    * (1.0 - smoothstep(0.8, 2.8, fwidth(streakPhase))) * (1.0 - cover);
  shelterDirt = clamp(dust * 0.72 + splash * 0.47 + streak * 0.10, 0.0, 1.0);
  // Sparse broad wipe residue is mostly a roughness change; the view through remains clear.
  vec2 wipe = (uv - vec2(0.29, 0.46)) / vec2(0.22, 0.14);
  shelterSmudge = (1.0 - smoothstep(0.50, 1.0, length(wipe)))
    * (0.4 + 0.6 * shelterNoise(uv * 27.0));
  // Small anti-collision dots, not a frosted band. No etching over the advertising print.
  vec2 dotP = vec2((fract(uv.x * 16.0) - 0.5) * 0.0845, vShelterLocal.y - 1.22);
  float dotDist = length(dotP), aa = max(fwidth(dotDist), 0.0006);
  shelterEtch = (1.0 - smoothstep(0.0045 - aa, 0.0045 + aa, dotDist))
    * (1.0 - smoothstep(0.006, 0.018, aa)) * (1.0 - cover);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.185, 0.16), shelterDirt * 0.65);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.61, 0.58), shelterEtch);
}
`;
const SHELTER_ROUGHNESS = /* glsl */ `
if (shelterMetal) roughnessFactor = clamp(roughnessFactor + shelterFinish * 0.035 + shelterDirt * 0.16
  + shelterBrush * 0.012 + shelterSeatGroove * 0.04, 0.08, 0.94);
if (shelterPane) roughnessFactor = clamp(0.085 + shelterDirt * 0.28 + shelterSmudge * 0.10 + shelterEtch * 0.25, 0.06, 0.65);
`;
const SHELTER_GLASS_ALPHA = /* glsl */ `
if (shelterPane) {
  // View-dependent grazing reflection from the scene's real environment, not painted cards.
  float fresnel = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 5.0);
  float cover = step(0.5, vPropMat.w);
  diffuseColor.a = clamp(mix(0.075, 0.035, cover) + 0.59 * fresnel
    + shelterDirt * 0.17 + shelterSmudge * 0.025 + shelterEtch * 0.48, 0.035, 0.78);
}
`;
const SHELTER_GLASS_REFLECTION = /* glsl */ `
if (shelterPane) {
  // Alpha blends the transmitted view; do not attenuate the physical F0 reflection twice.
  // The standard material supplies the lit/specular environment, including changing weather.
  outgoingLight += totalSpecular * (1.0 / max(diffuseColor.a, 0.10) - 1.0);
}
`;

const SUBWAY_SURFACE = /* glsl */ `
#ifdef PROP_SUBWAY_GLOBE
  if (vSubwayGlobe.x > 0.5) {
    float lowerGlass = 1.0 - smoothstep(1.974, 1.986, vSubwayGlobe.y);
    vec3 opal = vec3(0.60, 0.62, 0.57) * mix(0.84, 1.0, smoothstep(1.81, 1.87, vSubwayGlobe.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, opal, lowerGlass * (1.0 - clamp(uLamp, 0.0, 1.0)));
  }
#endif
#ifdef PROP_ATLAS
  if (vPropMat.w > 1.5 && vPropMat.w < 2.5 && vPropMat.z < 0.5) {
    vec3 subPos = vSubwayLocal;
    float wornFleck = smoothstep(0.52, 0.76, subwayWear(vMapUv * 57.0));
    if (vPropMat.y < 0.1 && vPropMat.x < 0.7) {
      // Sparse millimetre/centimetre chips at cast feet, lower rail arrises and square-post
      // corners. Unhandled upper faces stay near-black green (42 St–PABT reference).
      float highTouch = 1.0 - smoothstep(0.004, 0.018, abs(subPos.y - 1.114));
      float baseTouch = 1.0 - smoothstep(0.010, 0.035, abs(subPos.y - 0.27));
      float lowerEdge = min(abs(subPos.y - 0.25), abs(subPos.y - 0.39));
      float lowerTouch = 1.0 - smoothstep(0.003, 0.018, lowerEdge);
      vec2 castOffset = abs(vec2(subPos.x + 3.0, abs(subPos.z) - 1.37));
      float castCorner = 1.0 - smoothstep(0.002, 0.008, abs(castOffset.x - castOffset.y));
      castCorner *= (1.0 - step(0.16, max(castOffset.x, castOffset.y))) *
        (1.0 - smoothstep(0.60, 1.70, subPos.y));
      vec2 chipUv = vMapUv * 78.0;
      float paintFleck = smoothstep(0.66, 0.86, subwayWear(chipUv));
      vec2 chipFootprint = fwidth(chipUv);
      paintFleck *= 1.0 - smoothstep(0.8, 2.0, max(chipFootprint.x, chipFootprint.y));
      float contactWear = max(max(baseTouch, lowerTouch), max(highTouch * 0.30, castCorner * 0.45));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.12, 0.105), paintFleck * contactWear * 0.72);
    } else if (vPropMat.x > 0.85 && vPropMat.x < 0.95) {
      float slabEdge = min(abs(abs(subPos.z) - 1.45), abs(abs(subPos.x) - 3.20));
      float padEdge = min(abs(abs(subPos.x + 3.0) - 0.16), abs(abs(abs(subPos.z) - 1.37) - 0.155));
      if (subPos.x < -2.83 && abs(subPos.z) > 1.20) slabEdge = min(slabEdge, padEdge);
      if (subPos.x < -2.695 && abs(subPos.z) < 1.205) {
        slabEdge = min(abs(subPos.x + 3.0), abs(subPos.x + 2.70));
        // Lengthwise boot scuffs break up the broad threshold without painting another stripe.
        diffuseColor.rgb *= 0.76 + 0.28 * subwayWear(vec2(subPos.x * 12.0, subPos.z * 65.0));
      }
      float chippedArris = (1.0 - smoothstep(0.004, 0.033, slabEdge)) * wornFleck;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.31, 0.28), chippedArris * 0.7);
    } else if (vPropMat.x > 0.70 && vPropMat.x < 0.75) {
      // Yellow end paint wears through to the grey tread; it is never emissive.
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.23, 0.23, 0.21), wornFleck * 0.48);
    }
  }
#endif
`;

// Only the atlas program compiles this, and only foodCart authors uvMode -4.
// Reuse its existing object-local varying/noise helper; never weather menu ink or other props.
const FOOD_CART_SURFACE = /* glsl */ `
#ifdef PROP_ATLAS
float foodCartRoughness = vPropMat.x;
float foodCartMetalness = vPropMat.y;
float foodCartRelief = 0.0;
bool foodCartStainless = vPropMat.z > -4.25 && vPropMat.z < -3.75 && vPropMat.y > 0.85;
if (foodCartStainless) {
  vec3 cartPos = vSubwayLocal;
  float cartPatch = subwayWear(vPropUv * vec2(17.0, 7.0));
  float cartWipe = subwayWear(vPropUv * vec2(4.1, 2.7) + vec2(9.3, 2.1));
  float cartBrushScale = 850.0;
  float cartBrushFade = 1.0 - smoothstep(0.4, 1.2, fwidth(vPropUv.y * cartBrushScale));
  float cartBrush = (subwayWear(vPropUv * vec2(3.0, cartBrushScale)) - 0.5) * cartBrushFade;
  // Broader brushing groups modulate roughness, not painted silver stripes.
  // Both frequencies fade with pixel footprint; the millimetre grain cannot shimmer.
  float cartSatinFade = 1.0 - smoothstep(0.55, 1.8, fwidth(vPropUv.y * 92.0));
  float cartSatin = (subwayWear(vPropUv * vec2(2.3, 92.0)) - 0.5) * cartSatinFade;
  float cartFront = 1.0 - smoothstep(-0.74, -0.68, cartPos.z);
  float cartSplash = (1.0 - smoothstep(0.48, 0.82, cartPos.y)) * (0.35 + 0.65 * cartPatch);
  float cartSill = (1.0 - smoothstep(0.015, 0.08,
    min(abs(cartPos.y - 1.119), abs(cartPos.y - 0.853)))) * cartFront;
  float cartGrease = cartSill * smoothstep(0.35, 0.78, cartPatch) * 0.17;
  float cartHood = (1.0 - smoothstep(0.025, 0.19, abs(cartPos.y - 1.653)))
    * (1.0 - smoothstep(0.65, 0.80, abs(cartPos.x - 0.30)))
    * smoothstep(-0.39, -0.29, cartPos.z) * (1.0 - smoothstep(0.62, 0.69, cartPos.z));
  // Broad wipe marks change the reflected highlight more than the base colour.
  // Fold wear belongs to the cart's known cabinet edges and counter, not every metal prop.
  float cartSmudge = smoothstep(0.48, 0.82, cartWipe)
    * smoothstep(0.45, 0.70, cartPos.y) * (1.0 - smoothstep(1.72, 2.20, cartPos.y));
  float cartFold = min(abs(abs(cartPos.x) - 1.285), abs(cartPos.y - 1.1175));
  cartFold = min(cartFold, abs(cartPos.y - 0.2535));
  cartFold = min(cartFold, abs(cartPos.y - 0.853));
  float cartDoorX = abs(mod(cartPos.x + 1.22, 2.44 / 3.0) - 2.44 / 6.0);
  float cartDoorFold = min(abs(cartDoorX - 0.393), abs(abs(cartPos.y - 0.5475) - 0.275));
  float cartDoorArea = cartFront * step(0.26, cartPos.y) * (1.0 - step(0.83, cartPos.y));
  cartFold = min(cartFold, mix(1.0, cartDoorFold, cartDoorArea));
  float cartEdgeWear = (1.0 - smoothstep(0.002, 0.017, cartFold))
    * smoothstep(0.30, 0.69, cartPatch) * step(0.8, vPropMat.y);
  float cartDrip = smoothstep(0.58, 0.82, subwayWear(vPropUv * vec2(39.0, 1.7)))
    * (1.0 - smoothstep(0.02, 0.27, 1.10 - cartPos.y)) * step(cartPos.y, 1.10);
  // Dirty folded joins stay on the cabinet rails / equipment backsplash, not the ink.
  float cartJoin = (1.0 - smoothstep(0.002, 0.019, cartDoorFold)) * cartDoorArea;
  float cartRearJoint = min(abs(cartPos.x - 1.09), abs(cartPos.x + 0.93));
  cartRearJoint = min(cartRearJoint, abs(cartPos.y - 1.195));
  float cartRearDirt = (1.0 - smoothstep(0.006, 0.055, cartRearJoint))
    * step(0.38, cartPos.z) * step(1.135, cartPos.y) * (1.0 - smoothstep(1.73, 1.80, cartPos.y));
  float cartDirt = clamp(cartSplash * 0.19 + cartGrease + cartHood * cartPatch * 0.29
    + cartSmudge * 0.075 + cartDrip * 0.06 + (cartJoin * 0.38 + cartRearDirt * 0.29)
    * (0.45 + 0.55 * cartPatch), 0.0, 0.44);
  // Sparse rubbed scuffs interrupt the satin finish; their width is derivative-filtered.
  float cartScuffPhase = vPropUv.y * 181.0 + 0.8 * sin(vPropUv.x * 31.0);
  float cartScuffAA = max(fwidth(cartScuffPhase), 0.04);
  float cartScuff = (1.0 - smoothstep(0.04, 0.04 + cartScuffAA, abs(sin(cartScuffPhase))))
    * smoothstep(0.65, 0.86, cartPatch) * (1.0 - smoothstep(0.4, 1.2, cartScuffAA));
  diffuseColor.rgb *= 0.93 + cartWipe * 0.12 + cartBrush * 0.025;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.066, 0.041), cartDirt);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.57, 0.60, 0.59), cartEdgeWear * 0.24);
  foodCartRoughness = clamp(vPropMat.x + (cartWipe - 0.5) * 0.30 + cartSmudge * 0.18
    + cartSatin * 0.16 + cartBrush * 0.06 + cartDirt * 0.6 + cartScuff * 0.18
    - cartEdgeWear * 0.10, 0.19, 0.88);
  foodCartMetalness = vPropMat.y * (1.0 - cartDirt * 0.7);
  // Millimetre sheet waviness turns the actual environment highlight gently;
  // no painted reflection bands or brightened ink. Fine brushing fades at distance.
  foodCartRelief = 0.0012 * sin(vPropUv.x * 11.4 + 0.6 * sin(vPropUv.y * 4.1))
    * sin(vPropUv.y * 7.7) + 0.000004 * cartBrush;
}
// Only the cart's rotisserie has this roughness/metal signature under uvMode -4.
// Browned sliced layers use local position, so nothing repeats on bottles or cloth.
if (vPropMat.z > -4.25 && vPropMat.z < -3.75 && vPropMat.y < 0.01
    && abs(vPropMat.x - 0.76) < 0.001) {
  vec3 cartMeatPos = vSubwayLocal;
  float cartCrust = subwayWear(cartMeatPos.xy * vec2(39.0, 27.0));
  float cartSlicePhase = cartMeatPos.y * 930.0 + 2.0 * subwayWear(cartMeatPos.xz * 23.0);
  float cartSliceFade = 1.0 - smoothstep(0.9, 3.0, fwidth(cartSlicePhase));
  float cartSlice = (0.5 + 0.5 * sin(cartSlicePhase)) * cartSliceFade;
  diffuseColor.rgb *= 0.72 + cartCrust * 0.65 + cartSlice * 0.18;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.062, 0.031, 0.012),
    smoothstep(0.61, 0.86, cartCrust) * 0.60);
  foodCartRoughness = 0.60 + cartCrust * 0.21;
}
#endif
`;

const FOOD_CART_NORMAL = /* glsl */ `
#ifdef PROP_ATLAS
if (foodCartStainless) {
  vec3 cartDx = dFdx(-vViewPosition), cartDy = dFdy(-vViewPosition);
  vec3 cartRx = cross(cartDy, normal), cartRy = cross(normal, cartDx);
  float cartDet = dot(cartDx, cartRx);
  if (abs(cartDet) > 1e-12) {
    normal = normalize(abs(cartDet) * normal - sign(cartDet)
      * (dFdx(foodCartRelief) * cartRx + dFdy(foodCartRelief) * cartRy));
  }
}
#endif
`;

const FRAG_EMISSIVE = /* glsl */ `
{
  float ch = vPropEmit.x;
  float st = vPropEmit.y;
  vec3 e = vec3(0.0);
  #ifdef USE_COLOR
    vec3 vc = vColor.rgb;
  #else
    vec3 vc = vec3(1.0);
  #endif
  if (ch > 0.5 && ch < 1.5) {
    e = mix(uLampWarm, uLampWhite, clamp(vPropData.x, 0.0, 1.0)) * st * uLamp;
  } else if (ch < 2.5 && ch > 1.5) {
    e = vc * st * uLamp;
  } else if (ch > 2.5 && ch < 5.5) {
    float lens = ch - 3.0;
    float lit = abs(vPropData.y - lens) < 0.5 ? 1.0 : 0.0;
    vec3 lc = lens < 0.5 ? vec3(1.0, 0.08, 0.03) : (lens < 1.5 ? vec3(1.0, 0.55, 0.05) : vec3(0.05, 1.0, 0.35));
    // Keep only the cap bright, near the bloom threshold rather than several stops above it.
    e = lc * st * lit;
    diffuseColor.rgb = mix(diffuseColor.rgb, lc * 0.35, lit * 0.8);
  } else if (ch > 5.5 && ch < 6.5) {
    e = vc * st;
  } else if (ch > 6.5 && ch < 7.5) {
    #ifdef USE_MAP
      e = sampledDiffuseColor.rgb * st;
    #endif
  } else if (ch > 7.5 && ch < 8.5) {
    #ifdef USE_MAP
      e = sampledDiffuseColor.rgb * st * uLamp;
      // Only shelter print (+5): a restrained diffuser with a slightly dimmer sealed edge.
      // Keep the shared lamp gate, so daytime emission is exactly zero; ink stays dark.
      if (vPropMat.z > 4.5 && vPropMat.z < 5.5) {
        float inset = min(min(vPropUv.x, 1.0 - vPropUv.x), min(vPropUv.y, 1.0 - vPropUv.y));
        e *= 0.84 + 0.16 * smoothstep(0.0, 0.12, inset);
      }
    #endif
  } else if (ch > 8.5 && ch < 9.5) {
    #ifdef USE_MAP
      e = sampledDiffuseColor.rgb * st;
    #endif
  }
  totalEmissiveRadiance += e;
}
`;

// Only props-metal compiles this path, and only the hydrant's aMat.z -2/-3
// enters it. Local metres keep wear fixed to each casting (including its caps),
// with a stable instance seed; no extra material, texture upload, or draw call.
const HYDRANT_VERT_PARS = /* glsl */ `
varying vec3 vHydrantLocal;
varying float vHydrantSeed;
`;

const HYDRANT_VERTEX = /* glsl */ `
vHydrantLocal = position;
vHydrantSeed = 0.0;
#ifdef USE_INSTANCING
  if (aMat.z < -1.5 && aMat.z > -3.5) {
    vec2 cell = floor(instanceMatrix[3].xz * 16.0);
    vHydrantSeed = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  }
#endif
`;

const HYDRANT_FRAG_PARS = /* glsl */ `
varying vec3 vHydrantLocal;
varying float vHydrantSeed;
float hydrantHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float hydrantNoise(vec3 p) {
  vec3 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hydrantHash(cell), hydrantHash(cell + vec3(1,0,0)), f.x),
                 mix(hydrantHash(cell + vec3(0,1,0)), hydrantHash(cell + vec3(1,1,0)), f.x), f.y),
             mix(mix(hydrantHash(cell + vec3(0,0,1)), hydrantHash(cell + vec3(1,0,1)), f.x),
                 mix(hydrantHash(cell + vec3(0,1,1)), hydrantHash(cell + vec3(1,1,1)), f.x), f.y), f.z);
}
`;

const HYDRANT_SURFACE = /* glsl */ `
float hydrantRoughness = vPropMat.x;
float hydrantMetalness = vPropMat.y;
float hydrantRelief = 0.0;
if (vPropMat.z < -1.5 && vPropMat.z > -3.5) {
  vec3 p = vHydrantLocal;
  vec3 sampleP = p + vec3(vHydrantSeed * 7.0, 0.0, vHydrantSeed * 11.0);
  float patches = hydrantNoise(sampleP * 48.0);
  float flakes = hydrantNoise(sampleP * 240.0);
  float casting = hydrantNoise(sampleP * 930.0);
  float flow = hydrantNoise(sampleP * vec3(32.0, 6.0, 32.0));
  float role = vPropMat.w;
  if (role < 2.5) {
    float oldPaint = step(2.5, -vPropMat.z);
    float radius = length(p.xz);
    float flangeRim = max(1.0 - smoothstep(0.002, 0.008, abs(p.y - 0.249)),
      1.0 - smoothstep(0.0015, 0.006, abs(p.y - 0.223)))
      * smoothstep(0.097, 0.11, radius);
    float bonnetRim = (1.0 - smoothstep(0.001, 0.004, abs(p.y - 0.691)))
      * smoothstep(0.074, 0.081, radius);
    float rim = max(flangeRim, bonnetRim);
    float sideRim = (1.0 - smoothstep(0.004, 0.008, abs(abs(p.x) - 0.126)))
      * smoothstep(0.031, 0.036, length(p.yz - vec2(0.572, 0.0)));
    float frontRim = (1.0 - smoothstep(0.004, 0.008, abs(p.z + 0.13)))
      * smoothstep(0.042, 0.048, length(p.xy - vec2(0.0, 0.562)));
    rim = max(rim, max(sideRim, frontRim));
    // Gate chips to actual casting edges. Noise only breaks up that wear; it must
    // not pepper the long intact barrel with free-floating rust islands.
    float wearEdge = max(rim, step(1.5, role) * 0.25);
    float chip = wearEdge * smoothstep(0.62, 0.78, patches * 0.7 + flakes * 0.3 + oldPaint * 0.025);
    float rust = chip * smoothstep(0.46, 0.68, patches);
    vec3 oxide = mix(vec3(0.04, 0.026, 0.016), vec3(0.075, 0.036, 0.02), flakes);
    vec3 exposed = mix(vec3(0.055, 0.055, 0.052), oxide, smoothstep(0.46, 0.68, patches));
    diffuseColor.rgb *= 0.96 + 0.08 * patches;
    diffuseColor.rgb = mix(diffuseColor.rgb, exposed, chip);
    // Satin black enamel stays dielectric; the silver bonnet has a tighter,
    // brighter metal reflection without smoothing away its local tarnish.
    float minRoughness = role < 0.5 ? 0.3 : 0.24;
    hydrantRoughness = clamp(vPropMat.x + (flow - 0.5) * 0.16 + (patches - 0.5) * 0.12 + (flakes - 0.5) * 0.04, minRoughness, 0.86);
    hydrantRoughness = mix(hydrantRoughness, 0.91, rust);
    hydrantMetalness = mix(vPropMat.y, 0.65, chip) * (1.0 - rust * 0.97);

    // A few irregular, millimetre-wide washed/oxidised runs, not broad ribs.
    // Jitter width, origin and fade independently; no streak is added to relief.
    // Local y keeps gravity vertical even when the hydrant instance is rotated.
    float angle = atan(p.z, p.x);
    float lane = (angle + 3.14159265) * 4.61549335; // 29 lanes; seam stays periodic.
    float laneId = mod(floor(lane), 29.0);
    float run = hydrantHash(vec3(laneId, vHydrantSeed * 29.0, 9.0));
    float runCenter = 0.2 + 0.6 * hydrantHash(vec3(laneId, vHydrantSeed * 29.0, 3.0));
    float runShape = hydrantHash(vec3(laneId, vHydrantSeed * 29.0, 17.0));
    float runTop = 0.666 - 0.012 * runShape;
    float runEnd = runTop - 0.07 - 0.18 * hydrantHash(vec3(laneId, vHydrantSeed * 29.0, 23.0));
    float taper = smoothstep(runEnd, runTop, p.y);
    float runWidth = (0.065 + 0.065 * runShape) * (0.3 + 0.7 * taper);
    float stripe = (1.0 - smoothstep(runWidth, runWidth + 0.045, abs(fract(lane) - runCenter)))
      * smoothstep(0.8, 0.92, run);
    float drip = stripe * smoothstep(runEnd, runEnd + 0.045, p.y)
      * (1.0 - smoothstep(runTop - 0.012, runTop, p.y))
      * (1.0 - smoothstep(0.078, 0.086, radius)) * (0.6 + 0.4 * flow);
    // Dirt follows the exposed foot, not the buried physics-ground origin.
    float exposedHeight = max(0.0, p.y - 0.15);
    float dirt = (1.0 - smoothstep(0.01, 0.11, exposedHeight)) * (0.6 + 0.4 * patches);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.028, 0.024), drip * 0.25);
    diffuseColor.rgb = mix(diffuseColor.rgb, oxide * 0.5, drip * 0.1);
    diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - dirt * 0.25), vec3(0.026, 0.021, 0.015), dirt * 0.27);
    hydrantRoughness = mix(hydrantRoughness, 0.94, max(dirt, drip * 0.4));
    hydrantMetalness *= 1.0 - max(dirt, drip * 0.65);
    hydrantRelief = (casting - 0.5) * 0.00008 + (flakes - 0.5) * 0.00013 - chip * 0.00032;
    if (role > 0.5 && role < 1.5) hydrantRelief *= 0.65;

    if (role > 0.5 && role < 1.5) {
      // Neutral silver tarnish: darker grey oxidation, never a green cast.
      // Keep broad clean areas; only broken portions of the rim are rubbed dull.
      float tarnish = smoothstep(0.39, 0.75, patches * 0.55 + flow * 0.45);
      float dullRim = bonnetRim * smoothstep(0.42, 0.7, patches);
      diffuseColor.rgb *= 1.0 - 0.3 * tarnish;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.17, 0.166), dullRim * 0.45);
      hydrantRoughness = clamp(hydrantRoughness + tarnish * 0.19 + dullRim * 0.12, 0.3, 0.85);
      hydrantMetalness *= 1.0 - tarnish * 0.28;
    }

    if (role < 0.5) {
      // Abrasion is tied to the actual exposed foot/pavement junction and both
      // flange edges. Broken grey-brown flecks, not a continuous rust ring.
      float footContact = (1.0 - smoothstep(0.004, 0.026, abs(p.y - 0.158)))
        * (1.0 - smoothstep(0.064, 0.068, radius));
      float abrasion = max(flangeRim, footContact * 0.5)
        * smoothstep(0.53, 0.72, patches * 0.55 + flakes * 0.45);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.058, 0.053, 0.045), abrasion * 0.42);
      hydrantRoughness = mix(hydrantRoughness, 0.82, abrasion);
      // Two faint worn marker strokes on the back, intentionally no invented text.
      float tagArea = (1.0 - smoothstep(0.024, 0.03, abs(p.x + 0.018)))
        * smoothstep(0.063, 0.074, p.z);
      float stroke = 1.0 - smoothstep(0.0007, 0.002, abs(p.y - 0.338 - 0.012 * sin((p.x + 0.028) * 125.0)));
      float slash = 1.0 - smoothstep(0.0007, 0.0018, abs(p.y - 0.338 + (p.x + 0.018) * 0.38));
      float tag = max(stroke, slash) * tagArea * smoothstep(0.3, 0.65, flakes) * 0.32;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.31, 0.29, 0.24), tag);
      hydrantRoughness = mix(hydrantRoughness, 0.85, tag);
    }
  } else {
    diffuseColor.rgb *= 0.88 + 0.16 * flakes;
  }
}
`;

const HYDRANT_NORMAL = /* glsl */ `
if (vPropMat.z < -1.5 && vPropMat.z > -3.5 && vPropMat.w < 2.5) {
  // Sub-millimetre casting relief and paint steps, in view-space surface derivatives.
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float det = dot(dx, rx);
  if (abs(det) > 1e-12) {
    normal = normalize(abs(det) * normal - sign(det)
      * (dFdx(hydrantRelief) * rx + dFdy(hydrantRelief) * ry));
  }
}
`;

// Bollard-only selection: placement/data layouts stay untouched. These two starts
// and their neighbours are present in world tile 0_0, with yaw 2.64 and unit scale.
// Never hash arbitrary city instances into chains: a nearby partner is not guaranteed.
const BOLLARD_VERT_PARS = /* glsl */ `
varying vec4 vBollardLocalSeed;
`;
const BOLLARD_VERTEX = /* glsl */ `
vBollardLocalSeed = vec4(position, 0.0);
#ifdef USE_INSTANCING
  if (aMat.z > -9.5 && aMat.z < -8.5) {
    vBollardLocalSeed.w = fract(dot(floor(instanceMatrix[3].xz * 16.0), vec2(0.1031, 0.11369)));
  }
#endif
`;
const BOLLARD_TRANSFORM = /* glsl */ `
if (aMat.z > -9.5 && aMat.z < -8.5 && aMat.w > 2.5) {
  // Collapse unused eyes AND links into the shaft, including non-instanced previews.
  // Existing bollards do not cast shadows; that catalogue policy remains unchanged.
  transformed = vec3(0.0, 0.5, 0.0);
  #ifdef USE_INSTANCING
    vec2 origin = instanceMatrix[3].xz;
    bool firstSpan = distance(origin, vec2(148.52, 84.14)) < 0.025;
    bool secondSpan = distance(origin, vec2(149.59, 82.21)) < 0.025;
    bool lastPost = distance(origin, vec2(150.65, 80.28)) < 0.025;
    bool aligned = distance(instanceMatrix[2].xz, vec2(0.480822615, -0.876817890)) < 0.002
      && abs(instanceMatrix[1].y - 1.0) < 0.002;
    if (aMat.w < 3.5 && aligned) {
      bool occupiedEye = position.z > 0.0 ? (firstSpan || secondSpan) : (secondSpan || lastPost);
      if (occupiedEye) transformed = position;
    } else if (aMat.w > 3.5 && (firstSpan || secondSpan) && aligned) {
      vec2 end = firstSpan ? vec2(149.59, 82.21) : vec2(150.65, 80.28);
      vec2 delta = end - origin;
      vec2 localEnd = vec2(dot(instanceMatrix[0].xz, delta), dot(instanceMatrix[2].xz, delta));
      transformed = position;
      // Account for centimetre rounding in the placed coordinates. Both ends meet
      // actual neighbour eyelets instead of assuming the rounded yaw is exact.
      transformed.xz += (localEnd - vec2(0.0, 2.2)) * clamp((position.z - 0.164) / 1.872, 0.0, 1.0);
      vBollardLocalSeed.xyz = transformed;
    }
  #endif
}
`;
const BOLLARD_FRAG_PARS = /* glsl */ `
varying vec4 vBollardLocalSeed;
// Metric abrasion envelope: chips get a pixel-wide boundary, rubbed paint a soft edge.
// Keep the resolved silhouette independent of the fine-noise distance fade.
float bollardScratch(vec2 p, vec2 centre, vec2 size, float lean, float feather) {
  vec2 d = p - centre;
  d.x += d.y * lean;
  float edge = length(d / size);
  float aa = max(feather, fwidth(edge));
  return 1.0 - smoothstep(1.0 - aa, 1.0 + aa, edge);
}
`;
const BOLLARD_SURFACE = /* glsl */ `
bool propBollard = vPropMat.z > -9.5 && vPropMat.z < -8.5;
float bollardRoughness = vPropMat.x;
float bollardMetalness = vPropMat.y;
float bollardRelief = 0.0;
if (propBollard) {
  vec3 p = vBollardLocalSeed.xyz;
  vec3 sampleP = p + vec3(vBollardLocalSeed.w * 7.0, 0.0, vBollardLocalSeed.w * 11.0);
  float bollardPatch = hydrantNoise(sampleP * 47.0);
  float cloud = hydrantNoise(sampleP * vec3(13.0, 7.0, 13.0));
  // Independent, centimetre-scale paint sheen, not extra albedo speckle.
  float coat = hydrantNoise(sampleP * vec3(31.0, 16.0, 31.0));
  vec3 chipP = sampleP * 210.0;
  float chipFade = 1.0 - smoothstep(0.7, 1.9, length(fwidth(chipP)));
  float flake = mix(0.5, hydrantNoise(chipP), chipFade);
  float radius = length(p.xz);
  float role = vPropMat.w;
  float shell = 1.0 - step(0.5, role);
  float flange = step(0.5, role) * (1.0 - step(1.5, role));
  // Uneven splash height and paint loss climb the lower shaft, not a clean rust ring.
  float low = 1.0 - smoothstep(0.045, 0.26 + (cloud - 0.5) * 0.12, p.y);
  float dirt = low * (0.40 + 0.60 * cloud);
  // Local edge contact, not uniform speckle over the whole painted cylinder.
  float flangeEdge = (1.0 - smoothstep(0.003, 0.012, min(abs(p.y - 0.007), abs(p.y - 0.033))))
    * smoothstep(0.145, 0.154, radius);
  float toeEdge = (1.0 - smoothstep(0.008, 0.032, abs(p.y - 0.065)))
    * (1.0 - smoothstep(0.113, 0.12, radius));
  float capEdge = (1.0 - smoothstep(0.001, 0.004, abs(p.y - 0.805))) * 0.18;
  float contact = max(flangeEdge, max(toeEdge * 0.85, capEdge));
  if (role > 1.5) contact = role < 2.5 ? 0.72 : 0.20;
  float fracture = bollardPatch * 0.78 + flake * 0.22;
  float fractureAA = max(0.018, fwidth(fracture) * 0.65);
  float brokenPaint = smoothstep(0.54 - fractureAA, 0.54 + fractureAA, fracture);
  float chip = brokenPaint * max(contact, shell * low * 0.52);
  // Ref: pedestrians-1 supports vertical rubbing, dull surrounding paint and dirty
  // feet, not the hydraulic caps/stripes. Frayed patches interrupt each abrasion
  // completely; no minimum-opacity pale streak or repeated diagonal tick marks.
  float markShift = (vBollardLocalSeed.w - 0.5) * 0.016;
  float front = 1.0 - smoothstep(-0.097, -0.071, p.z);
  vec2 marks = p.xy - vec2(markShift, 0.0);
  vec2 frayedMarks = marks + vec2((bollardPatch - 0.5) * 0.009, (flake - 0.5) * 0.012);
  float rub = max(bollardScratch(frayedMarks, vec2(-0.042, 0.350), vec2(0.014, 0.080), 0.025, 0.02),
    bollardScratch(frayedMarks, vec2(0.021, 0.535), vec2(0.010, 0.050), -0.04, 0.02));
  rub = max(rub, bollardScratch(frayedMarks, vec2(-0.018, 0.180), vec2(0.023, 0.046), 0.06, 0.02) * 0.64);
  // 8–20 mm torn islands are sized for the fixed 3 m view, instead of relying
  // on 3 mm streaks that enter the fine-detail distance fade.
  vec3 abrasionP = sampleP * vec3(118.0, 55.0, 100.0);
  float abrasionFade = 1.0 - smoothstep(0.7, 1.9, length(fwidth(abrasionP)));
  float abrasionNoise = hydrantNoise(abrasionP);
  float tear = abrasionNoise * 0.68 + bollardPatch * 0.32;
  float tearAA = max(0.018, fwidth(tear) * 0.65);
  float tornPaint = mix(0.20, smoothstep(0.53 - tearAA, 0.53 + tearAA, tear), abrasionFade);
  float scuffHalo = max(bollardScratch(marks, vec2(-0.041, 0.350), vec2(0.023, 0.094), 0.025, 0.30),
    bollardScratch(marks, vec2(0.021, 0.535), vec2(0.017, 0.064), -0.04, 0.30));
  float scuff = scuffHalo * front * shell * (0.35 + 0.65 * bollardPatch);
  chip = max(chip, rub * front * shell * tornPaint * 0.92);
  // Only scraped flange bevels and the high hex faces expose fresh metal. Leave
  // the washer seating and most of the mounting plate in their dark painted finish.
  float anchorWear = 0.0;
  if (role > 1.5 && role < 2.5)
    anchorWear = smoothstep(0.050, 0.055, p.y) * (0.4 + 0.35 * brokenPaint);
  float cleanEdge = max(flange * flangeEdge * brokenPaint * 0.78, anchorWear);
  chip = max(chip, anchorWear);
  // Oxidation is an independent exposed-iron mix, not multiplied by chip opacity
  // twice. Keep it confined to irregular toe/rim damage and muted fastener bleed.
  float oxideAmount = low * (0.42 + 0.58 * smoothstep(0.35, 0.67, cloud));
  oxideAmount *= 1.0 - 0.92 * smoothstep(0.15, 0.65, cleanEdge);
  float rust = chip * oxideAmount;
  vec3 iron = vec3(0.098, 0.096, 0.089);
  vec3 oxide = vec3(0.105, 0.055, 0.028);
  diffuseColor.rgb *= (0.91 + 0.16 * cloud) * (1.0 + 0.22 * scuff);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(iron, oxide, oxideAmount), chip);
  float footStain = (shell + flange) * (1.0 - smoothstep(0.012, 0.14, p.y))
    * smoothstep(0.48, 0.68, cloud * 0.52 + bollardPatch * 0.48) * (1.0 - cleanEdge);
  diffuseColor.rgb = mix(diffuseColor.rgb, oxide * 0.72, footStain * 0.35);
  float settledDirt = dirt * (1.0 - cleanEdge * 0.75);
  diffuseColor.rgb *= 1.0 - 0.24 * settledDirt;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.038, 0.034, 0.026), settledDirt * 0.30);
  float contactGrime = (1.0 - smoothstep(0.003, 0.016 + 0.015 * bollardPatch, p.y))
    * (0.55 + 0.45 * cloud);
  float socketGrime = shell * (1.0 - smoothstep(0.003, 0.012, abs(p.y - 0.039)));
  diffuseColor.rgb *= 1.0 - 0.46 * max(contactGrime, socketGrime);
  if (flange > 0.5) {
    float boltDistance = length(abs(p.xz) - vec2(0.094752309));
    float halo = (1.0 - smoothstep(0.017, 0.038, boltDistance))
      * (0.18 + 0.82 * brokenPaint) * smoothstep(0.026, 0.036, p.y) * (1.0 - cleanEdge);
    diffuseColor.rgb = mix(diffuseColor.rgb, oxide * 0.82, halo * 0.68);
    float washerCrevice = 1.0 - smoothstep(0.016, 0.019, boltDistance);
    diffuseColor.rgb *= 1.0 - 0.38 * washerCrevice;
  }
  bollardRoughness = clamp(vPropMat.x + (cloud - 0.5) * 0.14 + (coat - 0.5) * 0.20
    + (flake - 0.5) * 0.045 + settledDirt * 0.16 + rust * 0.18 + footStain * 0.08
    - scuff * 0.075 + contactGrime * 0.12 - chip * (1.0 - oxideAmount) * 0.16, 0.48, 0.96);
  // Paint remains dielectric; only the sparse rubbed-through iron changes metalness.
  bollardMetalness = chip * 0.58 * (1.0 - oxideAmount) * (1.0 - settledDirt * 0.7);
  bollardRelief = (flake - 0.5) * 0.000085 * chipFade - chip * 0.00015;
}
`;
const BOLLARD_NORMAL = /* glsl */ `
if (propBollard) {
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float det = dot(dx, rx);
  if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - sign(det)
    * (dFdx(bollardRelief) * rx + dFdy(bollardRelief) * ry));
}
`;

// Only the existing props-metal material compiles these terms. The unique -6
// marker is authored solely by buildMailbox; no atlas modes or other props enter.
const MAILBOX_VERT_PARS = /* glsl */ `
varying vec4 vMailboxLocalSeed;
`;
const MAILBOX_VERTEX = /* glsl */ `
vMailboxLocalSeed = vec4(position, 0.0);
#ifdef USE_INSTANCING
  if (aMat.z < -5.5 && aMat.z > -6.5) {
    vMailboxLocalSeed.w = fract(sin(dot(floor(instanceMatrix[3].xz * 16.0),
      vec2(19.173, 43.719))) * 43758.5453);
  }
#endif
`;
const MAILBOX_FRAG_PARS = /* glsl */ `
varying vec4 vMailboxLocalSeed;
uniform sampler2D uMailboxLabels;
float mailboxHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float mailboxNoise(vec3 p) {
  vec3 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mailboxHash(cell), mailboxHash(cell + vec3(1,0,0)), f.x),
                 mix(mailboxHash(cell + vec3(0,1,0)), mailboxHash(cell + vec3(1,1,0)), f.x), f.y),
             mix(mix(mailboxHash(cell + vec3(0,0,1)), mailboxHash(cell + vec3(1,0,1)), f.x),
             mix(mailboxHash(cell + vec3(0,1,1)), mailboxHash(cell + vec3(1,1,1)), f.x), f.y), f.z);
}
// Finite metric scratches, antialiased in screen space; no repeating stripe map.
float mailboxScratch(vec2 p, vec2 a, vec2 b, float width) {
  vec2 span = b - a;
  float along = clamp(dot(p - a, span) / dot(span, span), 0.0, 1.0);
  float dist = length(p - a - span * along);
  return 1.0 - smoothstep(width, width + max(fwidth(dist), 0.00035), dist);
}
`;
const MAILBOX_SURFACE = /* glsl */ `
bool propMailbox = vPropMat.z < -5.5 && vPropMat.z > -6.5;
float mailboxRoughness = vPropMat.x;
float mailboxMetalness = vPropMat.y;
if (propMailbox) {
  vec3 mbPos = vMailboxLocalSeed.xyz;
  vec3 mbSample = mbPos + vec3(vMailboxLocalSeed.w * 9.0, 0.0, vMailboxLocalSeed.w * 5.0);
  float mbCloud = mailboxNoise(mbSample * vec3(9.0, 6.0, 9.0));
  float mbPatch = mailboxNoise(mbSample * 31.0);
  float mbFine = mailboxNoise(mbSample * 170.0);
  float mbResolution = 1.0 - smoothstep(0.006, 0.025, length(fwidth(mbPos)));
  float mbRole = vPropMat.w;
  if (mbRole < 0.5 || mbRole > 2.5) {
    // Ref: mailbox-2's faded enamel, directional abrasions and localized rubs.
    // Keep the broad colour drift quiet so wear reads as contact, not clouds.
    float mbMacro = mailboxNoise(mbSample * vec3(4.5, 4.0, 4.5));
    float mbChalk = smoothstep(0.28, 0.76, mbCloud * 0.70 + mbMacro * 0.30);
    float mbFade = smoothstep(0.42, 1.20, mbPos.y) * (0.35 + 0.65 * mbChalk);
    float mbFront = 1.0 - smoothstep(-0.254, -0.246, mbPos.z);
    float mbPanelFade = smoothstep(0.38, 0.46, mbPos.y)
      * (1.0 - smoothstep(0.72, 0.77, mbPos.y)) * mbFront;
    diffuseColor.rgb *= 0.90 + 0.15 * mbCloud;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.082, 0.135, 0.205),
      mbChalk * 0.16 + mbFade * 0.11 + mbPanelFade * 0.05);
    // Faint vertical contact wear, with short interrupted abrasions rather
    // than isolated pale diagonal slashes. All coordinates are mailbox-local.
    float mbSide = smoothstep(0.252, 0.262, abs(mbPos.x));
    float mbAcross = mix(mbPos.x, mbPos.z, mbSide);
    float mbRubNoise = mailboxNoise(mbSample * vec3(75.0, 14.0, 75.0) + vec3(7.1, 11.3, 19.7));
    float mbContactPanel = smoothstep(0.39, 0.46, mbPos.y)
      * (1.0 - smoothstep(0.70, 0.75, mbPos.y)) * max(mbFront, mbSide);
    float mbScuff = mbContactPanel
      * smoothstep(0.55, 0.80, mbRubNoise * 0.70 + mbFine * 0.30);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.090, 0.137, 0.186), mbScuff * 0.14);
    vec2 mbContact = vec2(mbAcross, mbPos.y + mbSide * 0.037 + vMailboxLocalSeed.w * 0.012);
    float mbScratch = max(
      mailboxScratch(mbContact, vec2(-0.172, 0.438), vec2(-0.174, 0.468), 0.00045),
      mailboxScratch(mbContact, vec2(-0.165, 0.521), vec2(-0.166, 0.563), 0.0004));
    mbScratch = max(mbScratch,
      mailboxScratch(mbContact, vec2(-0.071, 0.486), vec2(-0.073, 0.508), 0.00035));
    mbScratch = max(mbScratch,
      mailboxScratch(mbContact, vec2(0.101, 0.598), vec2(0.100, 0.640), 0.00045));
    mbScratch = max(mbScratch,
      mailboxScratch(mbContact, vec2(0.187, 0.455), vec2(0.185, 0.521), 0.0005));
    float mbBreakup = mailboxNoise(mbSample * vec3(35.0, 240.0, 35.0));
    mbScratch *= max(mbFront, mbSide) * mbResolution
      * smoothstep(0.40, 0.60, mbFine * 0.60 + mbBreakup * 0.40);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.095, 0.140, 0.187), mbScratch * 0.33);
    float mbLeg = 1.0 - smoothstep(0.275, 0.395, mbPos.y);
    float mbBottom = 1.0 - smoothstep(0.007, 0.035, abs(mbPos.y - 0.36) + (mbPatch - 0.5) * 0.018);
    float mbCorner = smoothstep(0.242, 0.264, abs(mbPos.x))
      * smoothstep(0.215, 0.25, abs(mbPos.z));
    float mbPanelLip = (1.0 - smoothstep(0.003, 0.013, abs(mbPos.y - 0.754))) * mbFront
      * smoothstep(0.43, 0.65, mbPatch);
    float mbFrameDistance = abs(max(abs(mbPos.x) - 0.207, abs(mbPos.y - 0.838) - 0.062));
    float mbPlacardEdge = (1.0 - smoothstep(0.003, 0.014,
      mbFrameDistance + (mbPatch - 0.5) * 0.012)) * mbFront;
    float mbEdge = max(max(mbBottom, mbPanelLip * 0.65), mbPlacardEdge);
    mbEdge = max(mbEdge, mbCorner * (1.0 - smoothstep(0.42, 0.83, mbPos.y)) * 0.55);
    float mbChip = mbEdge * smoothstep(0.44, 0.64, mbPatch * 0.76 + mbFine * 0.24);
    // The visible mounting tabs are at y=.155, above the .15 m sidewalk.
    // Broken peeling islands span the feet AND lower posts; never recolour
    // an entire plate orange or leave the exposed post uniformly blue-black.
    float mbLegPattern = mailboxNoise(mbSample * vec3(92.0, 24.0, 92.0)
      + vec3(11.3, 3.9, 5.7)) * 0.63 + mbFine * 0.37;
    float mbBaseLoss = 1.0 - smoothstep(0.22, 0.35, mbPos.y + (mbPatch - 0.5) * 0.065);
    float mbLegPeel = max(mbBaseLoss * smoothstep(0.34, 0.59, mbLegPattern),
      mbLeg * smoothstep(0.42, 0.66, mbLegPattern));
    float mbFootPlate = 1.0 - smoothstep(0.169, 0.187, mbPos.y);
    float mbFootPeel = mbFootPlate * smoothstep(0.32, 0.60, mbLegPattern * 0.75 + mbPatch * 0.25);
    mbChip = max(mbChip, max(mbLegPeel, mbFootPeel));
    // Sparse rubbed chips on the rolled crown; the broad rim stays blue enamel.
    float mbRim = smoothstep(0.267, 0.272, abs(mbPos.x)) * smoothstep(0.86, 0.96, mbPos.y);
    float mbRimChip = mbRim * smoothstep(0.64, 0.80, mbPatch * 0.8 + mbFine * 0.2);
    mbChip = max(mbChip, mbRimChip);
    float mbOxide = smoothstep(0.30, 0.57, mbCloud * 0.65 + mbFine * 0.35);
    mbOxide = mix(mbOxide, 0.60 + 0.40 * smoothstep(0.34, 0.69, mbLegPattern), mbLeg);
    mbOxide *= 1.0 - mbRimChip * 0.65;
    vec3 mbRust = mix(vec3(0.051, 0.025, 0.014), vec3(0.165, 0.068, 0.029), mbFine);
    mbRust = mix(mbRust, mix(vec3(0.072, 0.027, 0.013), vec3(0.205, 0.079, 0.029),
      mbPatch * 0.65 + mbFine * 0.35), mbLeg);
    vec3 mbSteel = mix(vec3(0.095, 0.10, 0.102), vec3(0.028, 0.033, 0.035), mbLeg);
    vec3 mbBare = mix(mbSteel, mbRust, mbOxide);
    diffuseColor.rgb = mix(diffuseColor.rgb, mbBare, mbChip);
    float mbDirt = (1.0 - smoothstep(0.16, 0.36, mbPos.y)) * (0.5 + 0.5 * mbCloud);
    diffuseColor.rgb *= 1.0 - mbDirt * 0.21;
    // Intact paint stays dielectric. Only genuinely exposed, unoxidised chips
    // receive metalness; rust, paper, stencil ink and dirt all remain nonmetal.
    mailboxMetalness = 0.58 * mbChip * (1.0 - mbOxide) * (1.0 - mbDirt);
    float mbPaintRoughness = vPropMat.x + (mbCloud - 0.5) * 0.15 + mbChalk * 0.13
      + (mbFine - 0.5) * 0.035 * mbResolution + mbFade * 0.06 - mbScuff * 0.13 + mbScratch * 0.10;
    float mbBareRoughness = mix(mix(0.43, 0.61, mbLeg), 0.92, mbOxide);
    mailboxRoughness = clamp(mix(mbPaintRoughness, mbBareRoughness, mbChip) + mbDirt * 0.10, 0.40, 0.93);
  } else if (mbRole < 1.5) {
    diffuseColor.rgb *= 0.92 + 0.08 * mbCloud;
    mailboxRoughness = 0.83;
    mailboxMetalness = 0.0;
  } else {
    float mbTarnish = smoothstep(0.42, 0.74, mbPatch);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.065, 0.038, 0.021), mbTarnish * 0.55);
    mailboxRoughness = mix(vPropMat.x, 0.88, mbTarnish);
    mailboxMetalness = vPropMat.y * (1.0 - mbTarnish * 0.8);
    float mbAnchor = 1.0 - smoothstep(0.185, 0.220, mbPos.y);
    vec3 mbAnchorRust = mix(vec3(0.100, 0.038, 0.018), vec3(0.245, 0.110, 0.052),
      smoothstep(0.168, 0.182, mbPos.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, mbAnchorRust * (0.88 + 0.12 * mbPatch), mbAnchor);
    mailboxRoughness = mix(mailboxRoughness, 0.89, mbAnchor);
    mailboxMetalness *= 1.0 - mbAnchor;
  }
  if (mbRole > 2.5) {
    vec4 mbLabel = texture2D(uMailboxLabels, vPropUv);
    diffuseColor.rgb = mix(diffuseColor.rgb, mbLabel.rgb * (0.79 + 0.035 * mbCloud), mbLabel.a);
    mailboxRoughness = mix(mailboxRoughness, 0.84, mbLabel.a);
    mailboxMetalness *= 1.0 - mbLabel.a;
  }
}
`;

// -12 is reserved by buildPlanter, -13 by buildShrub. Neither selector can enter
// another prop's finish path, and the common metal / legacy shrub maps stay intact.
const PLANTER_VERT_PARS = /* glsl */ `
varying vec4 vPlanterLocal;
`;
const PLANTER_VERTEX = /* glsl */ `
vPlanterLocal = vec4(position, 0.0);
#ifdef USE_INSTANCING
  if (abs(aMat.z + 12.0) < 0.25)
    vPlanterLocal.w = fract(sin(dot(floor(instanceMatrix[3].xz * 8.0), vec2(12.9898, 78.233))) * 43758.5453);
#endif
`;
const PLANTER_FRAG_PARS = /* glsl */ `
varying vec4 vPlanterLocal;
float planterHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float planterNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(planterHash(i), planterHash(i + vec2(1, 0)), f.x),
    mix(planterHash(i + vec2(0, 1)), planterHash(i + vec2(1)), f.x), f.y);
}
`;
const PLANTER_SURFACE = /* glsl */ `
bool propPlanter = abs(vPropMat.z + 12.0) < 0.25;
float planterRoughness = vPropMat.x;
float planterRelief = 0.0;
if (propPlanter) {
  vec2 p = vPropUv + vPlanterLocal.w * vec2(4.7, 6.3);
  float role = vPropMat.w;
  float cloud = planterNoise(p * 8.0);
  float grains = planterNoise(p * 185.0);
  vec2 grainDx = fwidth(p * 185.0);
  float detail = 1.0 - smoothstep(0.45, 1.5, max(grainDx.x, grainDx.y));
  if (role < 1.5) {
    // 4–7 mm mineral grains, isolated casting pores and sub-millimetre relief.
    vec2 cells = p * 143.0, cell = floor(cells);
    float pore = step(0.935, planterHash(cell))
      * (1.0 - smoothstep(0.12, 0.29, length(fract(cells) - vec2(0.5)))) * detail;
    float mineral = smoothstep(0.60, 0.84, grains) * detail;
    float quartz = (1.0 - smoothstep(0.16, 0.31, grains)) * detail;
    // Quiet mineral variation in one neutral casting, not a speckled finish.
    diffuseColor.rgb *= 0.955 + 0.075 * cloud;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.215, 0.20), mineral * 0.22);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.48, 0.465, 0.44), quartz * 0.16);
    diffuseColor.rgb *= 1.0 - pore * 0.47;
    float height = vPlanterLocal.y;
    float toe = (1.0 - smoothstep(0.025, 0.21, height)) * (0.7 + 0.3 * cloud);
    float flow = planterNoise(vec2(p.x * 31.0, height * 2.4 + vPlanterLocal.w * 9.0));
    float drip = smoothstep(0.61, 0.84, flow)
      * smoothstep(0.18 + flow * 0.15, 0.65, height) * (1.0 - smoothstep(0.678, 0.70, height));
    diffuseColor.rgb *= 1.0 - 0.22 * toe - 0.06 * drip;
    if (role > 0.5) diffuseColor.rgb *= 0.88 - 0.16 * (1.0 - smoothstep(0.505, 0.685, height));
    planterRoughness = clamp(0.79 + cloud * 0.06 + pore * 0.1 + toe * 0.07, 0.76, 0.97);
    planterRelief = (grains - 0.5) * 0.00085 * detail - pore * 0.0012;
  } else if (role < 2.5) {
    float crumbs = planterNoise(p * 78.0);
    diffuseColor.rgb *= 0.69 + 0.40 * crumbs + 0.16 * grains;
    planterRelief = (crumbs - 0.5) * 0.0025 + (grains - 0.5) * 0.0008 * detail;
    planterRoughness = 0.98;
  } else {
    diffuseColor.rgb *= 0.83 + 0.27 * grains;
    planterRelief = (grains - 0.5) * 0.0007 * detail;
    planterRoughness = 0.96;
  }
}
`;
const PLANTER_NORMAL = /* glsl */ `
if (propPlanter) {
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float det = dot(dx, rx);
  if (abs(det) > 1e-12)
    normal = normalize(abs(det) * normal - sign(det)
      * (dFdx(planterRelief) * rx + dFdy(planterRelief) * ry));
}
`;
const SHRUB_MAP = /* glsl */ `
if (abs(vPropMat.z + 13.0) < 0.25) {
  sampledDiffuseColor = vPropMat.w < 0.5 ? texture2D(uPlanterLeaves, vPropUv) : vec4(1.0);
}
`;

/**
 * Wrap the material's onBeforeCompile so a previous hook (e.g. the atmosphere module's) still runs.
 */
export function chainOnBeforeCompile(m: THREE.Material, fn: (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(m, shader, renderer);
    fn(shader, renderer);
  };
}

let matSeq = 0;

export function createPropMaterial(ctx: GameContext | null, opts: PropMaterialOpts = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    map: opts.map ?? null,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    alphaTest: opts.alphaTest ?? 0,
    side: opts.side ?? THREE.FrontSide,
    envMapIntensity: opts.envMapIntensity ?? 1,
    depthWrite: opts.depthWrite ?? true,
  });
  m.name = opts.name ?? `props-${matSeq++}`;
  const atlas = !!opts.atlas;
  const shelter = atlas || !!opts.transparent;
  // One small, lifetime-owned skin on the existing cutout material: no extra instanced draw.
  const basketMap = opts.selectiveMap && (opts.alphaTest ?? 0) > 0 ? makeBasketTexture() : null;
  if (basketMap) m.addEventListener('dispose', () => basketMap.dispose());
  const hydrant = opts.name === 'props-metal';
  const bikeRack = opts.name === 'props-metal';
  const bollard = opts.name === 'props-metal';
  const trash = opts.name === 'props-metal';
  const subwayGlobe = opts.name === 'props-metal';
  const citiMark = opts.name === 'props-metal' ? makeCitiBikeMark() : null;
  if (citiMark) m.addEventListener('dispose', () => citiMark.dispose());
  const mailboxLabels = opts.name === 'props-metal' ? makeMailboxTexture() : null;
  if (mailboxLabels) m.addEventListener('dispose', () => mailboxLabels.dispose());
  const planter = opts.name === 'props-metal';
  // Existing shrub-material signature. The -13 geometry gate remains mandatory,
  // including if another cutout kind later shares this material configuration.
  const planterLeaves = !opts.selectiveMap && opts.alphaTest === 0.4 && opts.side === THREE.DoubleSide
    ? makePlanterLeafTexture() : null;
  if (planterLeaves) m.addEventListener('dispose', () => planterLeaves.dispose());
  const patch = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uLamp = PROP_UNIFORMS.uLamp;
    shader.uniforms.uLampWarm = PROP_UNIFORMS.uLampWarm;
    shader.uniforms.uLampWhite = PROP_UNIFORMS.uLampWhite;
    shader.uniforms.uWet = PROP_UNIFORMS.uWet;
    shader.uniforms.uPedFrames = PROP_UNIFORMS.uPedFrames;
    // Getter is evaluated on uniform upload, including frozen/preRender-only
    // frames. 19:00 must work even before September's astronomical sunset.
    if (trash) shader.uniforms.uTrashEvening = { get value() {
      const fraction = ctx?.time.dayFraction;
      const hour = Number.isFinite(fraction) ? ((fraction! % 1 + 1) % 1) * 24 : 12;
      return hour >= 18 || hour < 6 || PROP_UNIFORMS.uLamp.value > 0.2 ? 1 : 0;
    } };
    if (atlas) shader.defines = { ...(shader.defines ?? {}), PROP_ATLAS: 1 };
    if (bikeRack) shader.defines = { ...(shader.defines ?? {}), PROP_BIKE_RACK: 1 };
    if (subwayGlobe) shader.defines = { ...(shader.defines ?? {}), PROP_SUBWAY_GLOBE: 1 };
    if (mailboxLabels) shader.uniforms.uMailboxLabels = { value: mailboxLabels };
    if (planterLeaves) shader.uniforms.uPlanterLeaves = { value: planterLeaves };
    if (basketMap) {
      shader.uniforms.uBasketMap = { value: basketMap };
      shader.defines = { ...(shader.defines ?? {}), PROP_BASKET: 1 };
    }
    if (citiMark) {
      shader.uniforms.uCitiMark = { value: citiMark };
      shader.defines = { ...(shader.defines ?? {}), PROP_CITI_MARK: 1 };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS + (hydrant ? HYDRANT_VERT_PARS : '') + (mailboxLabels ? MAILBOX_VERT_PARS : '') + (bollard ? BOLLARD_VERT_PARS : '') + (trash ? TRASH_GATE : '') + (planter ? PLANTER_VERT_PARS : '') + (shelter ? SHELTER_VERT_PARS : ''))
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + VERT_UV + (hydrant ? HYDRANT_VERTEX : '') + (mailboxLabels ? MAILBOX_VERTEX : '') + (bollard ? BOLLARD_VERTEX : '') + (planter ? PLANTER_VERTEX : '') + (shelter ? SHELTER_VERTEX : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (bollard ? BOLLARD_TRANSFORM : '') + (trash ? TRASH_VERTEX : ''));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS + (hydrant ? HYDRANT_FRAG_PARS : '') + (mailboxLabels ? MAILBOX_FRAG_PARS : '') + (bollard ? BOLLARD_FRAG_PARS : '') + (trash ? TRASH_GATE : '') + (planter ? PLANTER_FRAG_PARS : '') + (planterLeaves ? '\nuniform sampler2D uPlanterLeaves;\n' : '') + (shelter ? SHELTER_FRAG_PARS : ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + BENCH_SURFACE + (hydrant ? HYDRANT_SURFACE : '') + SUBWAY_SURFACE + CITI_DOCK_SURFACE + BIKE_RACK_SURFACE + (atlas ? FOOD_CART_SURFACE + NEWSSTAND_SURFACE : '') + (mailboxLabels ? MAILBOX_SURFACE : '') + (bollard ? BOLLARD_SURFACE : '') + (trash ? TRASH_SURFACE : '') + (planter ? PLANTER_SURFACE : '') + (shelter ? SHELTER_SURFACE : ''))
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(' + (hydrant ? 'hydrantRoughness' : atlas ? 'foodCartRoughness' : 'vPropMat.x') + ' * (1.0 - 0.5 * uWet), 0.03, 1.0);\nif (propBenchSlat) roughnessFactor = mix(clamp((vPropMat.x + benchWear * 0.55) * (1.0 - 0.5 * uWet), 0.03, 1.0), 0.44, benchHead);'
        + (mailboxLabels ? '\nif (propMailbox) roughnessFactor = clamp(mailboxRoughness * (1.0 - 0.5 * uWet), 0.03, 1.0);' : '')
        + (bikeRack ? '\nif (propBikeRack) roughnessFactor = clamp(bikeRackRoughness * (1.0 - 0.5 * uWet), 0.03, 1.0);' : '') + (atlas ? NEWSSTAND_ROUGHNESS : '') + (trash ? '\nif (propTrash) roughnessFactor = clamp(trashRoughness * (1.0 - 0.25 * uWet), 0.16, 1.0);' : '') + (planter ? '\nif (propPlanter) roughnessFactor = clamp(planterRoughness * (1.0 - 0.35 * uWet), 0.03, 1.0);' : '') + (shelter ? SHELTER_ROUGHNESS : '') + (bollard ? '\nif (propBollard) roughnessFactor = clamp(bollardRoughness * (1.0 - 0.5 * uWet), 0.03, 1.0);' : ''))
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = ' + (hydrant ? 'hydrantMetalness' : atlas ? 'foodCartMetalness' : 'vPropMat.y') + ';\nif (propBenchSlat) metalnessFactor = 0.55 * benchHead;'
        + (mailboxLabels ? '\nif (propMailbox) metalnessFactor = mailboxMetalness;' : '')
        + (bikeRack ? '\nif (propBikeRack) metalnessFactor = bikeRackMetalness;' : '') + (bollard ? '\nif (propBollard) metalnessFactor = bollardMetalness;' : ''))
      .replace('#include <normal_fragment_maps>', (trash ? 'if (!propTrash) {\n#include <normal_fragment_maps>\n}\n' : '#include <normal_fragment_maps>\n') + BENCH_NORMAL + (hydrant ? HYDRANT_NORMAL : '') + (atlas ? FOOD_CART_NORMAL + NEWSSTAND_NORMAL : '') + (bollard ? BOLLARD_NORMAL : '') + (trash ? TRASH_NORMAL : '') + (planter ? PLANTER_NORMAL : '') + (shelter ? SHELTER_GLASS_ALPHA : ''))
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>' + (bikeRack ? '\nif (propBikeRack) { reflectedLight.indirectDiffuse *= bikeRackOcclusion; reflectedLight.indirectSpecular *= mix(1.0, bikeRackOcclusion, 0.7); }' : ''))
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE)
      .replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;\n' + (shelter ? SHELTER_GLASS_REFLECTION : ''));
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      THREE.ShaderChunk.map_fragment.replace('diffuseColor *= sampledDiffuseColor;',
        // Preserve the basket skin and selective maps, without generic metal grime over wood.
        (opts.selectiveMap ? BASKET_MAP : 'diffuseColor *= sampledDiffuseColor;')
          .replace('diffuseColor *= sampledDiffuseColor;',
            'if (vPropMat.z < -0.5 && vPropMat.z > -1.5) sampledDiffuseColor = vec4(1.0);\n'
            + (hydrant ? 'if (vPropMat.z < -1.5 && vPropMat.z > -3.5) sampledDiffuseColor = vec4(1.0);\n' : '')
            + (mailboxLabels ? 'if (vPropMat.z < -5.5 && vPropMat.z > -6.5) sampledDiffuseColor = vec4(1.0);\n' : '')
            + (bikeRack ? 'if (vPropMat.z < -7.5 && vPropMat.z > -8.5) sampledDiffuseColor = vec4(1.0);\n' : '')
            + (bollard ? 'if (vPropMat.z > -9.5 && vPropMat.z < -8.5) sampledDiffuseColor = vec4(1.0);\n' : '')
            + (planter ? 'if (abs(vPropMat.z + 12.0) < 0.25) sampledDiffuseColor = vec4(1.0);\n' : '')
            + (planterLeaves ? SHRUB_MAP : '')
            + (trash ? 'if (vPropMat.z < -13.5 && vPropMat.z > -17.5) sampledDiffuseColor = vec4(1.0);\n' : '')
            + (atlas ? SUBWAY_MAP : '')
            + (atlas ? 'if (vPropMat.z > -10.5 && vPropMat.z < -9.5) sampledDiffuseColor = vec4(1.0);\n' : '')
            // Only buildBusSignPlate emits +6. Cut route gaps/unused rows on its sheets;
            // do not enable alpha testing or change opacity for the shared mapped material.
            + (atlas ? 'if (vPropMat.z > 5.5 && vPropMat.z < 6.5 && sampledDiffuseColor.a < 0.5) discard;\n' : '')
            + CITI_MAP
            + (atlas ? 'if (vPropMat.z > -4.25 && vPropMat.z < -3.75) sampledDiffuseColor = vec4(1.0);\n' : '')
            + 'diffuseColor *= sampledDiffuseColor;')));
  };
  chainOnBeforeCompile(m, patch);
  // the cache key must differ from a plain MeshStandardMaterial with the same flags
  const baseKey = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `props-bench-v3-citi-v3${atlas ? '-atlas-foodcart-v5-newsstand-brushed-v2-selector7-busflag-cutout6' : ''}${opts.selectiveMap ? '-selective' : ''}${basketMap ? '-basket' : ''}${hydrant ? '-hydrant-wear' : ''}${subwayGlobe ? '-subway-opal' : ''}${citiMark ? '-citi-mark' : ''}${mailboxLabels ? '-mailbox-v4-selector6' : ''}${bikeRack ? '-bike-rack-v4-selector8' : ''}${bollard ? '-bollard-v4-fractured-paint-selector9' : ''}${shelter ? '-shelter-v3-satin-seat-selectors10-11-5' : ''}${planter ? '-planter-stone-v4-selector12' : ''}${planterLeaves ? '-leaf-sprays-v1-selector13' : ''}${trash ? '-trash-v1-selectors14-17' : ''}-${baseKey()}`;
  const atmos = ctx?.modules.get('atmosphere') as { setupMaterial?: (m: THREE.Material) => void } | undefined;
  try {
    atmos?.setupMaterial?.(m);
  } catch (err) {
    console.warn('[props] atmosphere.setupMaterial failed', err);
  }
  return m;
}

/** hook shared atmosphere uniforms by identity when the atmosphere module exists */
export function bindAtmosphere(ctx: GameContext): void {
  const atmos = ctx.modules.get('atmosphere') as { uniforms?: { uWetness?: { value: number }; uNight?: { value: number } } } | undefined;
  // Bind before creating materials/decals so a preRender-only frame sees the live night gate too.
  PROP_UNIFORMS.uLamp = atmos?.uniforms?.uNight ?? { value: 1 - ctx.time.daylight };
  const wet = atmos?.uniforms?.uWetness;
  if (wet) PROP_UNIFORMS.uWet = wet;
}
