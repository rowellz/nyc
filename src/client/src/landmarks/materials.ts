/**
 * Landmark materials. One MeshStandardMaterial (procedural facade shader, extended via onBeforeCompile so the
 * atmosphere module's CSM shadows / fog / env reflections apply) is shared by every landmark; per-vertex
 * style attributes pick the pattern (limestone + steel mullions for the Empire State, glazed brick for the
 * Chrysler, curtain wall for One WTC, granite blocks for the Brooklyn Bridge, ...).
 *
 * Shared uniforms (uNight, uTime, uWet) are our own objects; each frame the module copies the atmosphere
 * module's values into them so the crowns/beacons/windows light up at night.
 */
import * as THREE from 'three';
import { HASH_GLSL, lowbias32 } from '@/buildings/hash';
import { FACADE_EMISSIVE_GLSL } from '@/buildings/lighting';
import { litRamp, MASONRY } from '@/buildings/styles';
import { FAR_WINDOW_LIGHT_GLSL, WINDOW_GRID_GLSL, WINDOW_LIGHT_GAIN } from '@/buildings/windows';

export const STYLE = {
  PLAIN: 0,
  ESB: 1, // limestone + vertical stainless stripes + window columns
  CHRYSLER: 2, // white glazed brick, dark spandrels
  FLATIRON: 3, // rusticated limestone base / terracotta / arcade top (by height)
  GLASS: 4, // reflective curtain wall (One WTC)
  DARKBRICK: 5, // One Times Square tan brick
  GRANITE: 6, // Brooklyn Bridge towers
  MARBLE: 7, // Washington Square Arch
  FINS: 8, // One WTC podium glass fins
  PAINT: 9, // painted steel (rgb in aParam)
  COPPER: 10, // Statue of Liberty patina
  ROOF: 11,
  STAINLESS: 12, // Chrysler crown
  WOOD: 13, // bridge promenade planks
  ASPHALT: 14, // bridge roadway
  CONCRETE: 15,
  EMISSIVE: 16, // plain emissive light (rgb in aParam, intensity in aParam2.x, night-scaled by aParam2.y)
  REDGLASS: 17, // TKTS steps
  LIMESTONE: 18, // generic pale stone with windows (Grand Central)
  NYPL: 19, // Vermont marble, coursed + rusticated base, round-arched windows, entablature (aParam: bayW, winW, sill, archTop; aParam2: baseTop, lit, flood, entablatureY)
  BRONZE: 20, // statues (Father Duffy), flagpole bases
  CURTAIN: 21, // modern curtain wall / precast grid (aParam: floorH, bayW, winW, winH; aParam2: litDensity, palette, rods, glassTint)
  BALUSTER: 22, // stone balustrade (rgb in aParam; f.y is the member's local height: plinth, balusters at 0.32 m, rail)
  COLOR: 23, // plain coloured surface with its own roughness (aParam: rgb, roughness) and metalness (aParam2.x): paint, granite, stained wood
  GRAVEL: 24, // crushed-stone gravel (aParam: rgb, speckle; aParam2: walking direction xz, wear amount): Bryant Park promenades
  FLAGS: 25, // stone paving flags (aParam: rgb, flag length; aParam2: flag direction xz, flag width)
  GLOBE: 26, // opal-glass lamp globe: glossy milky white by day, lit from within (rgb in aParam, intensity aParam2.x, night-scaled aParam2.y)
  IVY: 27, // ivy mound / hedge, or alpha-tested leaf card (aParam: linear rgb, roughness; aParam2.x = 1 for cards)
  CANVAS: 28, // awning cloth (aParam: rgb, stripe period or 0; aParam2: stripe rgb)
} as const;

export interface SharedUniforms {
  uNight: { value: number };
  uTime: { value: number };
  uWet: { value: number };
  uSeed: { value: number };
}

export function createSharedUniforms(): SharedUniforms {
  return { uNight: { value: 0 }, uTime: { value: 0 }, uWet: { value: 0 }, uSeed: { value: 7 } };
}

const FACADE_VERTEX_PARS = /* glsl */ `
attribute float aStyle;
attribute vec4 aParam;
attribute vec4 aParam2;
attribute float aLmSeed;
flat varying float vLmSeed;
varying vec2 vFuv;
varying float vStyle;
varying vec4 vP1;
varying vec4 vP2;
varying vec3 vWPos;
`;
const FACADE_VERTEX = /* glsl */ `
vFuv = uv;
vStyle = aStyle;
vP1 = aParam;
vP2 = aParam2;
vLmSeed = aLmSeed;
vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
#ifdef USE_INSTANCING
  if (aStyle > 26.5 && aStyle < 27.5 && aParam2.x > 0.5) {
    // Only ivy cards use this path. The mound remains real geometry at every LOD.
    vec3 ivyCenter = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float ivyDistance = distance(cameraPosition, ivyCenter);
    transformed *= 1.0 - smoothstep(52.0, 64.0, ivyDistance);
    vWPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
    vP2.y = fract(sin(dot(ivyCenter.xz, vec2(12.9898, 78.233))) * 43758.5453);
  }
#endif
`;

const FACADE_FRAG_PARS = /* glsl */ `
${FACADE_EMISSIVE_GLSL}
${HASH_GLSL}
${WINDOW_GRID_GLSL}
${FAR_WINDOW_LIGHT_GLSL}
uniform float uNight;
uniform float uTime;
uniform float uWet;
uniform float uSeed;
uniform float uLmLitRamp;
flat varying float vLmSeed;
varying vec2 vFuv;
varying float vStyle;
varying vec4 vP1;
varying vec4 vP2;
varying vec3 vWPos;

float lmHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float lmNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = lmHash21(i), b = lmHash21(i + vec2(1.0, 0.0)), c = lmHash21(i + vec2(0.0, 1.0)), d = lmHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// anti-aliased box: 1 inside [lo,hi], 0 outside, soft edge of width aa
float lmBox(float p, float lo, float hi, float aa) {
  return smoothstep(lo - aa, lo + aa, p) * (1.0 - smoothstep(hi - aa, hi + aa, p));
}
struct LmSurf { vec3 col; float rough; float metal; vec3 emis; };

// punched windows in a masonry wall. returns window coverage (0 wall, 1 glass) and sets glass/lit
float lmWindow(vec2 f, float floorH, float bayW, float winW, float winH, float sill, float g0, out float fl, out float bi, out float spandrel) {
  float yy = f.y - g0;
  fl = floor(yy / floorH);
  float fy = yy - fl * floorH;
  bi = floor(f.x / bayW);
  float bx = f.x - bi * bayW;
  float aax = fwidth(f.x), aay = fwidth(f.y);
  float wx = lmBox(bx, (bayW - winW) * 0.5, (bayW + winW) * 0.5, aax);
  float wy = lmBox(fy, sill, sill + winH, aay);
  spandrel = wx * (1.0 - wy);
  return wx * wy;
}
// LOD: how many pattern periods per pixel; > 0.5 means the pattern is sub-pixel -> use the average
float lmLod(float period) { return fwidth(vFuv.x) / max(period, 0.01); }

// Match ordinary office facades: floor/run occupancy and floor fixture colour while resolved, then
// continuous floor/building means. Derivatives MUST use continuous metre UVs, never floor(cell).
vec3 lmWindowLight(vec2 grid, vec2 lo, vec2 hi, float density) {
  vec2 fw = fwidth(grid);
  uint seed = uint(vLmSeed) + uint(uSeed);
  uint wid = uint(max(0.0, floor(grid.x))), fl = uint(max(0.0, floor(grid.y)));
  float litFrac = clamp(density * uLmLitRamp, 0.0, 0.85);
  float resU = 1.0 - smoothstep(0.08, 0.25, fw.x);
  float resV = 1.0 - smoothstep(0.1, 0.35, fw.y);
  vec2 size = max(vec2(0.0), hi - lo);
  float wx = windowCoverage(grid.x, lo.x, hi.x, fw.x);
  float wy = windowCoverage(grid.y, lo.y, hi.y, fw.y);
  float interior = windowInterior(clamp((fract(grid.y) - lo.y) / max(size.y, 0.001), 0.0, 1.0));
  vec3 rooms = windowLightColorLOD(5, seed, wid, fl, resU)
    * windowLit(5, seed, wid, fl, litFrac) * interior * wx * wy;
  // No column/fragment noise survives here; horizontal openings become their area, and floor bands
  // also become area before floors are subpixel. farWindowLight smoothly interpolates floor centres.
  vec3 mean = farWindowLight(5, seed, grid.y, litFrac, fw.y)
    * size.x * mix(size.y, wy, resV) * 0.95;
  vec3 light = mix(mean, rooms, resU * resV) * (1.6 * ${WINDOW_LIGHT_GAIN.toFixed(2)})
    * smoothstep(0.15, 0.6, uNight);
  float peak = max(max(light.r, light.g), light.b);
  return light * min(1.0, 1.6 / max(peak, 0.0001));
}

vec3 lmGlass(vec2 cell, vec2 grid, vec2 size, float sill, float density, inout vec3 emis, inout float rough, inout float metal) {
  vec2 lo = vec2((1.0 - size.x) * 0.5, sill);
  vec3 light = lmWindowLight(grid, lo, lo + size, density);
  emis += light;
  rough = 0.12;
  metal = 0.0;
  // dark blue-gray glass, a bit of per-pane variation so the reflections break up
  return vec3(0.09, 0.105, 0.125) * (0.8 + 0.4 * lmHash21(cell + 9.0)) + light * 0.15;
}
`;

// Runs after emissivemap_fragment: diffuseColor, roughnessFactor, metalnessFactor, totalEmissiveRadiance exist.
const FACADE_FRAG = /* glsl */ `
{
  float st = vStyle;
  vec2 f = vFuv;
  vec3 col = diffuseColor.rgb;
  float rough = roughnessFactor;
  float metal = metalnessFactor;
  vec3 emis = vec3(0.0);
  float fl, bi, sp;
  float n1 = lmNoise(f * 0.37 + vWPos.xz * 0.01);
  float n2 = lmNoise(f * 2.3);

  if (st < 0.5) {
    // PLAIN: rgb in aParam
    col = vP1.rgb * (0.94 + 0.12 * n1);
    rough = 0.85;
    metal = 0.0;
  } else if (st < 1.5) {
    // EMPIRE STATE: Indiana limestone piers, stainless steel stripes flanking dark spandrel/window columns
    float floorH = vP1.x, bayW = vP1.y, winW = vP1.z, winH = vP1.w;
    float g0 = vP2.x;
    float w = lmWindow(f, floorH, bayW, winW, winH, 0.85, g0, fl, bi, sp);
    float lod = lmLod(bayW);
    vec3 stone = vec3(0.70, 0.66, 0.60) * (0.92 + 0.16 * n1) * (0.96 + 0.08 * n2);
    // stripes: 0.2 m of chrome-nickel steel on both sides of the window column (thin bright lines, not bands)
    float bx = f.x - bi * bayW;
    float halfW = winW * 0.5 + 0.2;
    float stripe = lmBox(bx, bayW * 0.5 - halfW, bayW * 0.5 + halfW, fwidth(f.x)) * (1.0 - lmBox(bx, (bayW - winW) * 0.5, (bayW + winW) * 0.5, fwidth(f.x)));
    vec3 steel = vec3(0.48, 0.49, 0.52);
    vec3 spandrelCol = vec3(0.22, 0.22, 0.24);
    vec3 glass = lmGlass(vec2(bi, fl), vec2(f.x / bayW, (f.y - g0) / floorH), vec2(winW / bayW, winH / floorH), 0.85 / floorH, vP2.y, emis, rough, metal);
    emis *= 0.6; // lit offices behind small panes read as rooms, not lamps
    col = stone;
    rough = 0.8;
    metal = 0.0;
    col = mix(col, steel, stripe);
    rough = mix(rough, 0.4, stripe);
    metal = mix(metal, 0.75, stripe);
    col = mix(col, spandrelCol, sp);
    rough = mix(rough, 0.5, sp);
    metal = mix(metal, 0.6, sp);
    col = mix(col, glass, w);
    // distance: average
    vec3 avg = stone * 0.55 + steel * 0.15 + spandrelCol * 0.12 + vec3(0.1, 0.11, 0.13) * 0.18;
    col = mix(col, avg, smoothstep(0.35, 0.8, lod));
    // floodlit crown (from the setback lights below): brighter near the base of the lit section
    float flood = vP2.z * uNight;
    float fall = 1.0 - 0.55 * smoothstep(0.0, 45.0, f.y - vP2.w);
    emis += flood * fall * (1.0 - w * 0.6) * vec3(1.0, 0.97, 0.9) * 1.1;
  } else if (st < 2.5) {
    // CHRYSLER: white glazed brick, dark brick spandrels & bands
    float floorH = vP1.x, bayW = vP1.y, winW = vP1.z, winH = vP1.w;
    float w = lmWindow(f, floorH, bayW, winW, winH, 0.8, vP2.x, fl, bi, sp);
    float lod = lmLod(bayW);
    vec3 brick = vec3(0.76, 0.74, 0.70) * (0.9 + 0.2 * n1);
    // dark brick pattern: spandrels + thin vertical piers every other bay
    vec3 dark = vec3(0.24, 0.23, 0.24);
    float pier = step(0.5, fract(bi * 0.5)) * lmBox(f.x - bi * bayW, 0.0, 0.25, fwidth(f.x));
    vec3 glass = lmGlass(vec2(bi, fl), vec2(f.x / bayW, (f.y - vP2.x) / floorH), vec2(winW / bayW, winH / floorH), 0.8 / floorH, vP2.y, emis, rough, metal);
    col = brick;
    rough = 0.55;
    metal = 0.0;
    col = mix(col, dark, max(sp, pier));
    col = mix(col, glass, w);
    vec3 avg = brick * 0.6 + dark * 0.2 + vec3(0.1) * 0.2;
    col = mix(col, avg, smoothstep(0.35, 0.8, lod));
    float flood = vP2.z * uNight;
    emis += flood * vec3(1.0, 0.98, 0.92) * 0.8;
  } else if (st < 3.5) {
    // FLATIRON: by height. base rusticated limestone, mid terracotta, top arcade
    float floorH = vP1.x;
    float lod = lmLod(2.2);
    float y = f.y;
    vec3 lime = vec3(0.68, 0.64, 0.57) * (0.9 + 0.2 * n1);
    vec3 terra = vec3(0.64, 0.55, 0.47) * (0.9 + 0.2 * n1) * (0.96 + 0.08 * n2);
    if (y < 17.0) {
      // rustication: horizontal grooves every 1.15 m, big storefront windows in 4.4 m bays
      float groove = 1.0 - lmBox(fract(y / 1.15) * 1.15, 0.0, 0.08, fwidth(f.y)) * 0.6;
      float w = lmWindow(f, 5.5, 4.4, 2.4, 3.4, 1.0, 0.0, fl, bi, sp);
      vec3 glass = lmGlass(vec2(bi, fl + 100.0), f / vec2(4.4, 5.5), vec2(2.4 / 4.4, 3.4 / 5.5), 1.0 / 5.5, 0.7, emis, rough, metal);
      col = mix(lime * groove, glass, w);
      rough = mix(0.85, rough, w);
    } else if (y < 72.0) {
      float w = lmWindow(f, floorH, 2.25, 1.35, 2.15, 17.0 + 0.85 - floor(17.0 / floorH) * floorH, 0.0, fl, bi, sp);
      // string course each floor
      float band = lmBox(fract((y - 17.0) / floorH) * floorH, 0.0, 0.22, fwidth(f.y));
      vec3 glass = lmGlass(vec2(bi, fl), f / vec2(2.25, floorH), vec2(1.35 / 2.25, 2.15 / floorH), (17.85 - floor(17.0 / floorH) * floorH) / floorH, vP2.y, emis, rough, metal);
      col = mix(terra * (1.0 - band * 0.25), glass, w);
      rough = mix(0.75, rough, w);
    } else {
      // arcade: arched windows (round tops), tall, with a heavy cornice band near 82 m
      float yy = y - 72.0;
      float fh = 4.6;
      fl = floor(yy / fh);
      float fy = yy - fl * fh;
      bi = floor(f.x / 2.25);
      float bx = f.x - bi * 2.25 - 1.125;
      float arch = 0.0;
      if (fy < 2.2) arch = lmBox(bx, -0.65, 0.65, fwidth(f.x)) * step(0.5, fy);
      else arch = step(length(vec2(bx, fy - 2.2)), 0.65) ;
      vec3 glass = lmGlass(vec2(bi, fl + 50.0), vec2(f.x / 2.25, yy / fh), vec2(1.3 / 2.25, 2.35 / fh), 0.5 / fh, vP2.y, emis, rough, metal);
      emis *= mix(1.0, arch, 1.0 - smoothstep(0.1, 0.35, fwidth(yy / fh)));
      col = mix(terra * 1.05, glass, arch);
      rough = mix(0.7, rough, arch);
      float cornice = lmBox(y, 81.2, 82.2, fwidth(f.y));
      col = mix(col, terra * 0.75, cornice);
    }
    vec3 avg = mix(lime, terra, step(17.0, y)) * 0.7 + vec3(0.1) * 0.3;
    col = mix(col, avg, smoothstep(0.35, 0.8, lod));
    metal = 0.0;
  } else if (st < 4.5) {
    // GLASS curtain wall (One WTC): 1.5 m panels, floor lines, faceted tint per panel
    float floorH = vP1.x, panelW = vP1.y;
    fl = floor(f.y / floorH);
    bi = floor(f.x / panelW);
    float lod = lmLod(panelW);
    float mullionX = lmBox(fract(f.x / panelW) * panelW, 0.0, 0.07, fwidth(f.x));
    float mullionY = lmBox(fract(f.y / floorH) * floorH, 0.0, 0.12, fwidth(f.y));
    float mullion = max(mullionX, mullionY) * (1.0 - smoothstep(0.3, 0.7, lod));
    float tint = lmHash21(vec2(bi, fl) * 0.37);
    vec3 glass = mix(vec3(0.62, 0.70, 0.78), vec3(0.72, 0.78, 0.84), tint) * vP1.z;
    col = mix(glass, vec3(0.2, 0.21, 0.23), mullion);
    rough = mix(0.06, 0.5, mullion);
    metal = mix(0.95, 0.4, mullion);
    emis += lmWindowLight(f / vec2(panelW, floorH), vec2(0.07 / panelW, 0.12 / floorH), vec2(1.0), vP2.y);
  } else if (st < 5.5) {
    // DARKBRICK: One Times Square's tan brick with sparse windows
    float w = lmWindow(f, vP1.x, vP1.y, vP1.z, vP1.w, 0.9, vP2.x, fl, bi, sp);
    vec3 brick = vec3(0.42, 0.36, 0.31) * (0.9 + 0.2 * n1) * (0.95 + 0.1 * n2);
    vec3 glass = lmGlass(vec2(bi, fl), vec2(f.x / vP1.y, (f.y - vP2.x) / vP1.x), vP1.zw / vP1.yx, 0.9 / vP1.x, vP2.y, emis, rough, metal);
    col = mix(brick, glass, w);
    rough = mix(0.9, rough, w);
    metal = mix(0.0, metal, w);
  } else if (st < 6.5) {
    // GRANITE blocks (Brooklyn Bridge towers): 0.62 m courses, 1.5 m blocks, running bond
    float courseH = 0.62, blockL = 1.5;
    float ci = floor(f.y / courseH);
    float off = fract(ci * 0.5) * blockL;
    float bj = floor((f.x + off) / blockL);
    float lod = lmLod(blockL);
    float mortarY = lmBox(fract(f.y / courseH) * courseH, 0.0, 0.035, fwidth(f.y));
    float mortarX = lmBox(fract((f.x + off) / blockL) * blockL, 0.0, 0.035, fwidth(f.x));
    float mortar = max(mortarX, mortarY) * (1.0 - smoothstep(0.3, 0.7, lod));
    float bh = lmHash21(vec2(bj, ci) * 0.73);
    vec3 gran = mix(vec3(0.52, 0.47, 0.41), vec3(0.62, 0.58, 0.52), bh) * (0.9 + 0.2 * n1);
    // weathering: darker streaks
    gran *= 0.85 + 0.15 * lmNoise(vec2(f.x * 0.7, f.y * 0.15));
    col = mix(gran, gran * 0.55, mortar);
    rough = 0.9;
    metal = 0.0;
    emis += vP2.z * uNight * vec3(1.0, 0.9, 0.75) * 0.35; // floodlit at night
  } else if (st < 7.5) {
    // MARBLE (Washington Square Arch)
    float courseH = 0.55, blockL = 1.1;
    float ci = floor(f.y / courseH);
    float off = fract(ci * 0.5) * blockL;
    float mortar = max(lmBox(fract(f.y / courseH) * courseH, 0.0, 0.02, fwidth(f.y)), lmBox(fract((f.x + off) / blockL) * blockL, 0.0, 0.02, fwidth(f.x)));
    vec3 marble = vec3(0.86, 0.85, 0.80) * (0.93 + 0.1 * n1) * (0.96 + 0.06 * lmNoise(f * 5.0));
    col = mix(marble, marble * 0.7, mortar * (1.0 - smoothstep(0.3, 0.7, lmLod(blockL))));
    rough = 0.55;
    metal = 0.0;
    emis += vP2.z * uNight * vec3(1.0, 0.92, 0.8) * 0.5;
  } else if (st < 8.5) {
    // FINS: One WTC podium: vertical glass fins every 0.6 m
    float p = fract(f.x / 0.6);
    float lod = lmLod(0.6);
    float fin = mix(0.45 + 0.55 * smoothstep(0.0, 0.5, p) * (1.0 - smoothstep(0.5, 1.0, p)), 0.7, smoothstep(0.3, 0.8, lod));
    col = vec3(0.55, 0.62, 0.70) * fin;
    rough = 0.25;
    metal = 0.6;
    emis += vec3(0.7, 0.8, 1.0) * uNight * 0.25 * fin;
  } else if (st < 9.5) {
    // PAINT (steel): rgb in aParam, roughness in aParam.w
    col = vP1.rgb * (0.93 + 0.14 * n1);
    rough = vP1.w > 0.0 ? vP1.w : 0.55;
    metal = 0.55;
  } else if (st < 10.5) {
    // COPPER patina
    col = mix(vec3(0.33, 0.56, 0.50), vec3(0.42, 0.62, 0.55), n1) * (0.94 + 0.12 * n2);
    rough = 0.7;
    metal = 0.1;
  } else if (st < 11.5) {
    // ROOF: dark gravel / membrane
    col = vec3(0.24, 0.24, 0.25) * (0.9 + 0.2 * lmNoise(f * 3.0));
    rough = 0.95;
    metal = 0.0;
  } else if (st < 12.5) {
    // STAINLESS (Chrysler crown): horizontal ribs
    float rib = 0.5 + 0.5 * sin(f.y * 12.0);
    col = vec3(0.78, 0.79, 0.82) * (0.9 + 0.1 * rib);
    rough = 0.28 + 0.12 * rib;
    metal = 1.0;
    emis += vP2.z * uNight * vec3(1.0, 0.97, 0.9) * 0.9;
  } else if (st < 13.5) {
    // WOOD planks (promenade), planks 0.16 m across f.x
    float pi_ = floor(f.x / 0.16);
    float ph = lmHash21(vec2(pi_, floor(f.y / 3.0)));
    float gap = lmBox(fract(f.x / 0.16) * 0.16, 0.0, 0.012, fwidth(f.x)) * (1.0 - smoothstep(0.3, 0.7, lmLod(0.16)));
    col = mix(vec3(0.46, 0.36, 0.26), vec3(0.58, 0.47, 0.34), ph) * (0.9 + 0.2 * n2) * (1.0 - 0.5 * gap);
    rough = 0.85;
    metal = 0.0;
  } else if (st < 14.5) {
    // ASPHALT
    col = vec3(0.13, 0.13, 0.135) * (0.9 + 0.2 * lmNoise(f * 2.0));
    rough = mix(0.9, 0.35, uWet);
    metal = 0.0;
  } else if (st < 15.5) {
    // CONCRETE
    col = vec3(0.52, 0.51, 0.49) * (0.92 + 0.16 * n1) * (0.95 + 0.1 * n2);
    rough = 0.9;
    metal = 0.0;
  } else if (st < 16.5) {
    // EMISSIVE light source: rgb, intensity vP2.x, night-scale vP2.y (0 = always on, 1 = only at night)
    col = vP1.rgb * 0.2;
    float k = mix(1.0, uNight, vP2.y);
    float blink = vP2.z > 0.0 ? step(0.5, fract(uTime * vP2.z + vP2.w)) : 1.0;
    emis += vP1.rgb * vP2.x * k * blink;
    rough = 0.4;
    metal = 0.0;
  } else if (st < 17.5) {
    // RED GLASS (TKTS steps): lit from within; aParam2.x scales the glow (risers glow more than treads),
    // kept under ~1.0 so the tone curve does not desaturate it to pink
    float k = vP2.x > 0.0 ? vP2.x : 1.0;
    col = vec3(0.5, 0.03, 0.04);
    rough = 0.15;
    metal = 0.0;
    emis += vec3(0.95, 0.06, 0.04) * (0.12 + 0.8 * uNight) * k;
  } else if (st < 18.5) {
    // LIMESTONE generic with windows
    float w = lmWindow(f, vP1.x, vP1.y, vP1.z, vP1.w, 0.9, vP2.x, fl, bi, sp);
    vec3 stone = vec3(0.72, 0.68, 0.60) * (0.92 + 0.16 * n1);
    // This hero branch replaces the ordinary building facade wholesale. It must
    // retain metric masonry and window reveals at street range (Paramount BIN
    // 1024706), rather than leaving two glass rectangles on a featureless plane.
    float courseH = ${MASONRY.stone[1].toFixed(2)}, blockL = ${MASONRY.stone[0].toFixed(2)};
    float course = floor(f.y / courseH), off = mod(course, 2.0) * blockL * 0.5;
    float masonryLod = 1.0 - smoothstep(0.2, 0.6, max(fwidth(f.x) / blockL, fwidth(f.y) / courseH));
    float joint = max(lmBox(mod(f.y, courseH), 0.0, 0.012, fwidth(f.y)),
      lmBox(mod(f.x + off, blockL), 0.0, 0.012, fwidth(f.x))) * masonryLod;
    stone *= 1.0 - 0.24 * joint;
    float frameFl, frameBi, frameSp;
    float reveal = lmWindow(f, vP1.x, vP1.y, max(0.0, vP1.z) + 0.14,
      vP1.w + 0.14, 0.83, vP2.x, frameFl, frameBi, frameSp) * step(0.01, vP1.z);
    stone *= 1.0 - 0.28 * max(0.0, reveal - w) * masonryLod;
    vec3 glass = lmGlass(vec2(bi, fl), vec2(f.x / vP1.y, (f.y - vP2.x) / vP1.x), vP1.zw / vP1.yx, 0.9 / vP1.x, vP2.y, emis, rough, metal);
    col = mix(stone, glass, w);
    rough = mix(0.8, rough, w);
    metal = mix(0.0, metal, w);
    emis += vP2.z * uNight * vec3(1.0, 0.92, 0.8) * 0.45;
  } else if (st < 19.5) {
    // NYPL: warm Vermont marble in 0.72 m courses (open joints, weathered), rusticated below baseTop,
    // tall round-arched windows in bays of bayW (winW = 0 -> plain wall), entablature shadow lines at entY,
    // small square attic windows above the cornice.
    float bayW = vP1.x, winW = vP1.y, sill = vP1.z, archTop = vP1.w;
    float baseTop = vP2.x, entY = vP2.w;
    float courseH = 0.72, blockL = 1.55;
    float ci = floor(f.y / courseH);
    float off = fract(ci * 0.5) * blockL;
    float lodB = smoothstep(0.3, 0.7, lmLod(blockL));
    float rust = 1.0 - step(baseTop, f.y);
    float jointH = mix(0.028, 0.07, rust);
    float mortar = max(lmBox(fract(f.y / courseH) * courseH, 0.0, jointH, fwidth(f.y)), lmBox(fract((f.x + off) / blockL) * blockL, 0.0, 0.028, fwidth(f.x))) * (1.0 - lodB);
    float streak = lmNoise(vec2(f.x * 0.9, f.y * 0.11) + vWPos.xz * 0.02);
    float streak2 = lmNoise(vec2(f.x * 3.7, f.y * 0.2) + 5.0);
    // warm marble (0.82/0.78/0.70 clean), never paper white: rain streaks take 0-16 % off
    vec3 marble = vec3(0.82, 0.78, 0.70) * (0.95 + 0.08 * n1) * (0.97 + 0.05 * lmNoise(f * 4.0));
    marble *= 0.84 + 0.16 * streak;                              // grey rain streaks
    // soot in the rain shadow under the ledges: below the entablature, the sills and the rusticated base's top
    float under = smoothstep(-0.2, 0.3, entY - f.y) * (1.0 - smoothstep(0.6, 4.5, entY - f.y));
    under = max(under, smoothstep(-0.2, 0.2, sill - f.y) * (1.0 - smoothstep(0.4, 2.5, sill - f.y)) * step(0.5, winW));
    under = max(under, smoothstep(-0.2, 0.2, baseTop - f.y) * (1.0 - smoothstep(0.3, 1.6, baseTop - f.y)) * step(baseTop, 500.0));
    marble *= 1.0 - 0.18 * under * (0.45 + 0.55 * streak2);
    marble *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 6.0, f.y));     // grime near the ground
    marble *= 1.0 - 0.05 * rust;
    col = mix(marble, marble * 0.7, mortar);
    rough = 0.62;
    metal = 0.0;
    if (winW > 0.0) {
      bi = floor(f.x / bayW);
      float bx = f.x - bi * bayW - bayW * 0.5;
      float r = winW * 0.5;
      float aa = fwidth(f.x);
      float cy = archTop - r;
      float d = length(vec2(bx, f.y - cy));
      float w = f.y < cy ? lmBox(bx, -r, r, aa) * step(sill, f.y) : 1.0 - smoothstep(r - aa, r + aa, d);
      float rs = r + 0.42;
      float surround = f.y < cy ? lmBox(bx, -rs, rs, aa) * step(sill - 0.5, f.y) : 1.0 - smoothstep(rs - aa, rs + aa, d);
      // a slender pilaster between bays, from the sill line to the entablature
      float pil = lmBox(abs(bx), bayW * 0.5 - 0.45, bayW * 0.5, aa) * step(sill - 1.2, f.y) * (1.0 - step(entY, f.y));
      // basement windows in the rusticated band
      float bw = lmBox(bx, -1.0, 1.0, aa) * lmBox(f.y, baseTop - 2.6, baseTop - 0.9, fwidth(f.y)) * step(1.0, baseTop - 3.0);
      // attic windows
      float aw = lmBox(bx, -0.9, 0.9, aa) * lmBox(f.y, entY + 4.2, entY + 5.9, fwidth(f.y));
      w = max(w * step(f.y, archTop) * (1.0 - step(entY, sill)), max(bw, aw));
      vec3 glass = lmGlass(vec2(bi, floor(f.y / 8.0)), f / vec2(bayW, 8.0), vec2(winW / bayW, 1.0), 0.0, vP2.y, emis, rough, metal);
      emis *= w;
      if (winW > 8.0) {
        // the great windows (Grand Central): iron grille of 1.3 x 1.75 m panes with 0.12 m bars, deep reveal
        float grille = max(lmBox(fract((bx + r) / 1.3) * 1.3, 0.0, 0.12, aa), lmBox(fract(f.y / 1.75) * 1.75, 0.0, 0.12, fwidth(f.y))) * (1.0 - smoothstep(0.3, 0.7, lmLod(1.3)));
        glass = mix(glass * 0.8, vec3(0.05, 0.05, 0.055), grille);
        emis *= 1.0 - grille;
      }
      col = mix(col, marble * 0.86, max(surround * (1.0 - w) * step(sill - 0.5, f.y) * step(f.y, archTop + 0.42), pil * 0.6));
      col = mix(col, glass, w);
      rough = mix(0.62, rough, w);
      metal = mix(0.0, metal, w);
      float lod = smoothstep(0.35, 0.8, lmLod(bayW));
      col = mix(col, marble * 0.8, lod * 0.35);
      emis *= 1.0 - lod;
    }
    // entablature: architrave / frieze / cornice shadow lines
    float ent = lmBox(f.y, entY, entY + 0.22, fwidth(f.y)) + lmBox(f.y, entY + 1.5, entY + 1.68, fwidth(f.y)) + lmBox(f.y, entY + 3.1, entY + 3.5, fwidth(f.y));
    col *= 1.0 - 0.35 * clamp(ent, 0.0, 1.0) * (1.0 - lodB);
    // floodlit at night (the facade is uplit from the terrace)
    emis += vP2.z * uNight * vec3(1.0, 0.93, 0.8) * 0.45 * (1.0 - 0.5 * smoothstep(5.0, 26.0, f.y));
  } else if (st < 20.5) {
    // BRONZE: dark patinated bronze
    col = mix(vec3(0.24, 0.17, 0.10), vec3(0.30, 0.26, 0.18), n2) * (0.9 + 0.2 * n1);
    rough = 0.5;
    metal = 0.8;
  } else if (st < 22.5 && st > 21.5) {
    // BALUSTER: a stone balustrade seen as a solid member: plinth 0-0.2, balusters (0.32 m pitch, 0.14 m gaps
    // in shadow) 0.2-0.85, rail above. f.y is the local height (GeoBuilder.hexa), f.x runs along the rail.
    vec3 stone = vP1.rgb * (0.94 + 0.1 * n1) * (0.97 + 0.06 * n2);
    float lod = smoothstep(0.3, 0.7, lmLod(0.32));
    float gap = lmBox(fract(f.x / 0.32) * 0.32, 0.18, 0.32, fwidth(f.x)) * lmBox(f.y, 0.2, 0.85, fwidth(f.y));
    col = mix(stone, stone * 0.42, gap * (1.0 - lod));
    col = mix(col, stone * 0.85, lod * 0.3);
    col *= 1.0 - 0.08 * (1.0 - smoothstep(0.0, 0.2, f.y));
    rough = 0.75;
    metal = 0.0;
  } else if (st > 22.5 && st < 23.5) {
    // COLOR: paint, granite, stained wood: rgb in aParam, roughness aParam.w, metalness aParam2.x
    col = vP1.rgb * (0.95 + 0.10 * n1) * (0.97 + 0.06 * n2);
    rough = vP1.w > 0.0 ? vP1.w : 0.6;
    metal = vP2.x;
  } else if (st > 23.5 && st < 24.5) {
    // GRAVEL: crushed stone, 2 cm stones with the odd pale / dark one, 7 cm mottle, and darker worn streaks along the
    // walking direction (aParam2.xy) where feet pack it down; the speckle averages out beyond ~25 m
    vec2 wd = vP2.xy;
    float lu = dot(f, wd), ln = dot(f, vec2(-wd.y, wd.x));
    float lod = smoothstep(0.25, 0.9, lmLod(0.02));
    float stone = lmHash21(floor(f / 0.02));
    float stone2 = lmHash21(floor(f / 0.07) + 3.0);
    float speck = mix((stone - 0.5) * 0.7 + (stone2 - 0.5) * 0.25, 0.0, lod) * vP1.w;
    vec3 base = vP1.rgb * (1.0 + speck);
    base = mix(base, base * vec3(0.55, 0.5, 0.48), mix(step(0.94, stone), 0.06, lod) * 0.5);
    base = mix(base, base * vec3(1.35, 1.3, 1.25), mix(step(0.96, stone2 * stone), 0.04, lod) * 0.5);
    float wear = smoothstep(0.45, 0.85, lmNoise(vec2(lu * 0.035, ln * 0.4)) * 0.7 + 0.3 * lmNoise(vec2(lu * 0.12, ln * 0.9)));
    col = base * (0.92 + 0.16 * n1) * (1.0 - vP2.z * wear * 0.3);
    rough = 0.92;
    metal = 0.0;
  } else if (st > 24.5 && st < 25.5) {
    // FLAGS: bluestone paving flags in running bond; per-flag tone, some leaning blue and some rust, 12 mm joints
    vec2 wd = vP2.xy;
    float L = max(vP1.w, 0.3), Wd = max(vP2.z, 0.3);
    float lu = dot(f, wd), ln = dot(f, vec2(-wd.y, wd.x));
    float row = floor(ln / Wd);
    float off = fract(row * 0.5) * L;
    float colI = floor((lu + off) / L);
    float lod = smoothstep(0.3, 0.8, lmLod(Wd));
    float aa = max(fwidth(f.x), fwidth(f.y));
    float joint = max(lmBox(fract((lu + off) / L) * L, 0.0, 0.012, aa), lmBox(fract(ln / Wd) * Wd, 0.0, 0.012, aa)) * (1.0 - lod);
    float fh = lmHash21(vec2(colI, row) * 0.61);
    vec3 flag = vP1.rgb * mix(0.82, 1.18, fh) * (0.94 + 0.12 * n1);
    flag *= mix(vec3(0.95, 0.98, 1.06), vec3(1.08, 1.0, 0.9), lmHash21(vec2(row, colI) * 0.37));
    col = mix(flag, flag * 0.55, joint);
    rough = 0.78;
    metal = 0.0;
  } else if (st > 25.5 && st < 26.5) {
    // GLOBE: opal-glass lamp globe: milky white and glossy (the env map carries the sky highlight), lit from within
    // at night (rgb, intensity aParam2.x, night scale aParam2.y)
    col = vec3(0.86, 0.85, 0.82);
    rough = 0.12;
    metal = 0.0;
    float k = mix(1.0, uNight, vP2.y);
    emis += vP1.rgb * vP2.x * k;
  } else if (st > 26.5 && st < 27.5) {
    // IVY: lobed leaves over shaded clumps, not sub-pixel value speckle. Cards and the mound
    // use the same leaf profile/palette, so losing the cards at 52–64 m does not expose a cube.
    bool card = vP2.x > 0.5;
    vec2 grid = f / 0.28;
    vec2 cell = floor(grid);
    float seed = card ? vP2.y : lmHash21(cell);
    float angle = seed * 6.283185;
    vec2 leafUv = card ? f : mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * (fract(grid) - 0.5) + 0.5;
    float y = leafUv.y;
    // Five pointed lobes: basal pair, shoulder pair, long central tip. Hard coverage test is
    // deliberate (opaque depth-writing alpha test, no transparent sorting or rectangular cards).
    float width = y < 0.32 ? mix(0.06, 0.46, clamp((y - 0.04) / 0.28, 0.0, 1.0))
      : y < 0.50 ? mix(0.46, 0.22, (y - 0.32) / 0.18)
      : y < 0.66 ? mix(0.22, 0.32, (y - 0.50) / 0.16)
      : mix(0.32, 0.0, clamp((y - 0.66) / 0.32, 0.0, 1.0));
    float edge = min(width - abs(leafUv.x - 0.5), min(y - 0.04, 0.98 - y));
    float aa = max(fwidth(edge), 0.002);
    float leaf = smoothstep(-aa, aa, edge);
    if (card && leaf < 0.5) discard;
    float vein = 1.0 - smoothstep(0.006, 0.022, abs(leafUv.x - 0.5));
    float tone = smoothstep(0.32, 0.68, seed);
    vec3 leafColor = vP1.rgb * mix(vec3(0.72, 0.80, 0.65), vec3(1.18, 1.12, 0.96), tone);
    leafColor *= 0.90 + 0.16 * y + 0.10 * vein;
    float bump;
    if (card) {
      col = leafColor;
      rough = vP1.w; // 0.45: waxy dielectric highlight, not painted matte green
      bump = 0.012 * (1.0 - abs(leafUv.x - 0.5) * 2.0);
    } else {
      // Derivative-filter just the leaf scale; 0.8–2 m clumps persist well beyond 60 m.
      float detail = 1.0 - smoothstep(0.25, 0.85, max(fwidth(grid.x), fwidth(grid.y)));
      float clump = 0.65 * lmNoise(f * 0.65) + 0.35 * lmNoise(f * 1.8 + 13.0);
      float cover = mix(0.80, 0.50 + 0.50 * leaf, detail);
      vec3 canopy = mix(vP1.rgb * vec3(0.95, 0.96, 0.81), leafColor, detail);
      col = mix(vec3(0.05, 0.035, 0.025), canopy, cover) * (0.60 + 0.80 * clump);
      rough = mix(0.62, 0.45, leaf * detail);
      bump = 0.035 * clump + detail * leaf * 0.008;
    }
    // Small leaf folds / clumps change the lighting as well as albedo. Geometric crown noise
    // carries the silhouette; this surface-gradient bump only gives the wax a broken highlight.
    vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
    vec3 rx = cross(dpdy, normal), ry = cross(normal, dpdx);
    float det = dot(dpdx, rx);
    normal = normalize(abs(det) * normal - sign(det) * (dFdx(bump) * rx + dFdy(bump) * ry));
    metal = 0.0;
  } else if (st > 27.5 && st < 28.5) {
    // CANVAS: awning cloth with a fine weave; optional stripes of period aParam.w along f.x in aParam2's colour
    float weave = 0.94 + 0.06 * lmNoise(f * 40.0);
    vec3 cloth = vP1.rgb;
    if (vP1.w > 0.0) {
      float lod = smoothstep(0.3, 0.8, lmLod(vP1.w));
      float stripe = lmBox(fract(f.x / vP1.w), 0.0, 0.5, fwidth(f.x) / vP1.w);
      cloth = mix(mix(vP1.rgb, vP2.rgb, stripe), mix(vP1.rgb, vP2.rgb, 0.5), lod);
    }
    col = cloth * weave * (0.95 + 0.1 * n1);
    rough = 0.9;
    metal = 0.0;
  } else {
    // CURTAIN: modern curtain wall / precast grid. Windows centred in each floor, the frame (mullions, piers,
    // spandrels) from a palette: 0 dark aluminium, 1 terracotta (One Vanderbilt), 2 white concrete (432 Park),
    // 3 precast grey (MetLife), 4 ceramic white (NYT, with horizontal rods when aParam2.z > 0), 5 limestone
    // (35 Hudson Yards), 6 weathered steel (55 Hudson Yards), 7 white aluminium (Citigroup Center).
    // aParam2.w: > 0 tints the glass green (UN), < 0 marks an open mechanical floor (void behind the grid).
    float floorH = vP1.x, bayW = vP1.y, winW = vP1.z, winH = vP1.w;
    float w = lmWindow(f, floorH, bayW, winW, winH, (floorH - winH) * 0.5, 0.0, fl, bi, sp);
    float lod = lmLod(bayW);
    float pal = vP2.y;
    vec3 frame = vec3(0.22, 0.23, 0.25);
    if (pal > 0.5 && pal < 1.5) frame = vec3(0.60, 0.42, 0.32);
    else if (pal < 2.5 && pal > 1.5) frame = vec3(0.80, 0.78, 0.74);
    else if (pal < 3.5 && pal > 2.5) frame = vec3(0.56, 0.55, 0.52);
    else if (pal < 4.5 && pal > 3.5) frame = vec3(0.84, 0.84, 0.82);
    else if (pal < 5.5 && pal > 4.5) frame = vec3(0.72, 0.68, 0.60);
    else if (pal < 6.5 && pal > 5.5) frame = vec3(0.45, 0.26, 0.16);
    else if (pal > 6.5) frame = vec3(0.80, 0.81, 0.82);
    frame *= 0.93 + 0.12 * n1;
    float frameRough = pal < 0.5 ? 0.45 : 0.75;
    float frameMetal = pal < 0.5 ? 0.6 : 0.0;
    vec3 glass = lmGlass(vec2(bi, fl), f / vec2(bayW, floorH), vec2(winW / bayW, winH / floorH), (floorH - winH) * 0.5 / floorH, vP2.x, emis, rough, metal);
    if (vP2.w > 0.0) glass = mix(glass, vec3(0.16, 0.30, 0.28), vP2.w * 0.6);
    if (vP2.w < 0.0) { glass = vec3(0.02, 0.022, 0.025); emis = vec3(0.0); }
    col = mix(frame * mix(1.0, 0.85, sp), glass, w);
    rough = mix(frameRough, rough, w);
    metal = mix(frameMetal, metal, w);
    if (vP2.z > 0.0) {
      float rod = lmBox(fract(f.y / 0.42) * 0.42, 0.0, 0.14, fwidth(f.y)) * (1.0 - smoothstep(0.3, 0.7, lmLod(0.42)));
      col = mix(col, vec3(0.86, 0.86, 0.84), rod * 0.85);
      rough = mix(rough, 0.6, rod);
      metal = mix(metal, 0.0, rod);
    }
    vec3 avg = frame * 0.45 + vec3(0.10, 0.11, 0.13) * 0.55;
    col = mix(col, avg, smoothstep(0.35, 0.8, lod));
  }

  // rain: everything a little darker and glossier
  col *= 1.0 - 0.25 * uWet;
  rough = mix(rough, rough * 0.5, uWet);

  diffuseColor.rgb = col;
  roughnessFactor = rough;
  metalnessFactor = metal;
  totalEmissiveRadiance += limitFacadeEmission(emis);
}
`;

export function createFacadeMaterial(u: SharedUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, side: THREE.FrontSide });
  m.name = 'landmarkFacade';
  const ramp = { value: litRamp(22.5, true) };
  const clocks = new WeakMap<THREE.Scene, THREE.IUniform<number>>();
  const ivyBounds = new THREE.Sphere(), ivyEye = new THREE.Vector3();
  m.onBeforeRender = (_renderer, scene, _camera, geometry, object) => {
    if ((object as THREE.InstancedMesh).isInstancedMesh && geometry.getAttribute('aStyle')?.getX(0) === STYLE.IVY
      && geometry.getAttribute('aParam2')?.getX(0) === 1) {
      const cards = object as THREE.InstancedMesh;
      // The mound casts the bed shadow. Avoid the shared, non-alpha-tested shadow material
      // stamping rectangular card shadows (and spending a second leaf draw per cascade).
      cards.castShadow = false;
      if (!cards.boundingSphere) cards.computeBoundingSphere();
      ivyBounds.copy(cards.boundingSphere!).applyMatrix4(cards.matrixWorld);
      _camera.getWorldPosition(ivyEye);
      // Coarse all-batch cull; the vertex shader drops individual cards at 64 m. Restore count
      // on approach even after a zero-instance draw, without rebuilding or uploading matrices.
      cards.count = ivyBounds.distanceToPoint(ivyEye) > 64 ? 0 : cards.instanceMatrix.count;
    }
    // The existing sky rotation is dayFraction * 2 PI (atmosphere/index.ts). Read its live uniform,
    // not elapsed uTime or the screenshot URL, so frozen time, clock jumps and normal play agree.
    let clock = clocks.get(scene);
    if (!clock) {
      const sky = scene.getObjectByName('skyDome') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
      clock = sky?.material.uniforms?.uStarRot;
      if (clock) clocks.set(scene, clock);
    }
    ramp.value = litRamp(clock ? clock.value * 12 / Math.PI : 22.5, true);
    if (!geometry.hasAttribute('aLmSeed')) {
      // One deterministic seed for the entire hero, including its faces and setbacks. Do not hash
      // world position in the fragment shader: that creates patches across even a single window.
      let seed = 7;
      const name = object.parent?.name || object.name;
      for (let i = 0; i < name.length; i++) seed = lowbias32(seed ^ name.charCodeAt(i));
      if (!name) {
        geometry.computeBoundingSphere();
        const c = geometry.boundingSphere!.center;
        seed = lowbias32(Math.round(c.x)) ^ lowbias32(Math.round(c.z));
      }
      const attribute = new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(seed & 0xffff), 1);
      // Material hooks run after geometry upload. Install after this first draw so the next upload
      // sees the attribute before binding it; the warm-up draw uses the default zero attribute.
      const after = object.onAfterRender;
      object.onAfterRender = function (...args) {
        geometry.setAttribute('aLmSeed', attribute);
        object.onAfterRender = after;
        after.apply(this, args);
      };
    }
  };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = u.uNight;
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uWet = u.uWet;
    shader.uniforms.uSeed = u.uSeed;
    shader.uniforms.uLmLitRamp = ramp;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${FACADE_VERTEX_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${FACADE_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_FRAG_PARS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FACADE_FRAG}`);
  };
  m.customProgramCacheKey = () => 'landmarkFacade12';
  return m;
}

// ---------------------------------------------------------------------------------------------------------
// LED screens (Times Square). One material, one atlas, animation in the shader.
//   attributes: aCell (float atlas cell), aAnim (type, speed, phase, aspect)
// ---------------------------------------------------------------------------------------------------------

const SCREEN_VERTEX_PARS = /* glsl */ `
attribute float aCell;
attribute vec4 aAnim;
attribute vec2 aSize;
varying vec2 vSuv;
varying float vCell;
varying vec4 vAnim;
varying vec2 vSize;
`;
const SCREEN_VERTEX = /* glsl */ `
vSuv = uv;
vCell = aCell;
vAnim = aAnim;
vSize = aSize;
`;
const SCREEN_FRAG_PARS = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uTime;
uniform float uNight;
uniform float uCells; // cells per row (atlas is uCells x uCells)
uniform float uPitch; // LED pixel pitch (m)
uniform float uTickerCell;
varying vec2 vSuv;
varying float vCell;
varying vec4 vAnim;
varying vec2 vSize;
float scrHash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
vec2 cellUv(float cell, vec2 uv) {
  float n = uCells;
  float c = mod(cell, n * n);
  // Canvas rows start at the top; CanvasTexture.flipY puts row zero at the top of UV space.
  vec2 o = vec2(mod(c, n), n - 1.0 - floor(c / n));
  // inset so mipmaps do not bleed across cells
  return (o + mix(vec2(0.01), vec2(0.99), clamp(uv, 0.0, 1.0))) / n;
}
vec3 scrSample(float cell, vec2 uv) {
  return texture2D(uAtlas, cellUv(cell, uv)).rgb;
}
`;
const SCREEN_FRAG = /* glsl */ `
{
  float type = vAnim.x;
  float speed = vAnim.y;
  float phase = vAnim.z;
  float aspect = vAnim.w; // width / height of this screen
  vec2 uv = vSuv;
  vec3 content;
  if (type > 0.5 && type < 1.5) {
    // scrolling news ribbon: the strip cell repeats every 1.8 screen heights and slides along the ribbon
    vec2 suv = vec2(fract(uv.x * aspect * 0.55 - uTime * 0.09 * speed + phase), (uv.y - 0.5) * 0.55 + 0.5);
    content = scrSample(uTickerCell, suv);
  } else {
    // very tall / very wide screens are split into panels that each run their own campaign
    float panels = 1.0, pi_ = 0.0, pa = aspect;
    vec2 puv = uv;
    if (aspect < 0.55) { panels = min(4.0, ceil(0.6 / aspect)); pi_ = floor(uv.y * panels); puv.y = fract(uv.y * panels); pa = aspect * panels; }
    else if (aspect > 2.6) { panels = min(8.0, ceil(aspect / 1.8)); pi_ = floor(uv.x * panels); puv.x = fract(uv.x * panels); pa = aspect / panels; }
    // crop the square cell to the panel's aspect (the designs keep their message in the central band)
    vec2 cuv = pa > 1.0 ? vec2(puv.x, (puv.y - 0.5) * max(0.55, 1.0 / pa) + 0.5) : vec2((puv.x - 0.5) * max(0.55, pa) + 0.5, puv.y);
    // a cut every 6-10 s with a short crossfade; a slow push-in / drift inside each slot
    float t = uTime * 0.14 * speed + phase + pi_ * 0.37;
    float slot = floor(t), ft = fract(t);
    float h1 = scrHash(slot * 1.7 + phase * 13.0 + pi_), h2 = scrHash(slot * 3.1 + phase * 7.0 + pi_ + 5.0);
    // a slow push-in / pull-out (6 %) and a pan that never leaves the cell, so headlines are not cropped
    float zoom = 1.0 - 0.06 * mix(ft, 1.0 - ft, step(0.5, h1));
    vec2 drift = (vec2(h1, h2) - 0.5) * (1.0 - zoom) * (ft - 0.5) * 2.0;
    vec2 kuv = (cuv - 0.5) * zoom + 0.5 + drift;
    float cellA = vCell + slot * 7.0 + pi_ * 5.0;
    vec3 a = scrSample(cellA, kuv);
    vec3 b = scrSample(cellA + 7.0, kuv);
    content = mix(a, b, smoothstep(0.93, 1.0, ft));
    if (type > 1.5 && type < 2.5) {
      // pulsing brightness (looped animation)
      content *= 0.8 + 0.2 * sin(uTime * 2.0 * speed + phase * 6.28);
    } else if (type > 2.5) {
      // moving diagonal light band (video-like motion)
      content *= 0.92 + 0.12 * sin((uv.x + uv.y) * 6.0 - uTime * 1.5 * speed + phase * 6.28);
    }
  }
  // LED pixel structure: one dot per uPitch metres, resolved up close, averaging to 0.78 at distance
  vec2 g = uv * vSize / uPitch;
  float fw = max(fwidth(g.x), fwidth(g.y));
  float dot_ = 1.0 - smoothstep(0.28, 0.46, length(fract(g) - 0.5));
  float led = mix(mix(0.6, 1.0, dot_), 0.78, smoothstep(0.3, 0.9, fw));
  content *= led;
  // calibrated: the brightest LED dot is 2.5 (linear) at night, which stays just under paper white through the
  // tone curve; a little lower by day when the exposure is already low.
  float intensity = mix(2.0, 2.5, uNight);
  diffuseColor.rgb = vec3(0.01);
  roughnessFactor = 0.32;
  metalnessFactor = 0.0;
  totalEmissiveRadiance = content * intensity;
}
`;

export function createScreenMaterial(u: SharedUniforms, atlas: THREE.Texture, cellsPerRow: number, pitch = 0.04, tickerCell = 14): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.32, metalness: 0.0, emissive: 0x000000, side: THREE.FrontSide });
  m.name = 'landmarkScreens';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlas };
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uNight = u.uNight;
    shader.uniforms.uCells = { value: cellsPerRow };
    shader.uniforms.uPitch = { value: pitch };
    shader.uniforms.uTickerCell = { value: tickerCell };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${SCREEN_VERTEX_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${SCREEN_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SCREEN_FRAG_PARS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${SCREEN_FRAG}`);
  };
  m.customProgramCacheKey = () => 'landmarkScreens4';
  return m;
}

/** thin cables / stays / railings */
export function createLineMaterial(color: number, opacity = 1): THREE.LineBasicMaterial {
  const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  m.name = 'landmarkLines';
  return m;
}

/** necklace lights along bridge cables: PointsMaterial with night scaling */
export function createLightPointsMaterial(u: SharedUniforms, color: number, size: number): THREE.PointsMaterial {
  const m = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  m.name = 'landmarkLights';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = u.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <premultiplied_alpha_fragment>', '#include <premultiplied_alpha_fragment>\n{ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = smoothstep(0.5, 0.15, d); gl_FragColor.rgb *= a * (0.15 + 2.2 * uNight); gl_FragColor.a *= a; }');
  };
  m.customProgramCacheKey = () => 'landmarkLights1';
  return m;
}
