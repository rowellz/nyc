/**
 * Sky: a physically based scattering LUT (lat-long, RGBA16F, re-integrated every other frame) sampled by a
 * camera-attached dome that adds the sun disc + aureole, the moon with phase, procedural stars, NYC light
 * pollution and an animated curved cloud layer. The same dome (minus sun/stars) is rendered into a PMREM for
 * scene.environment so every PBR surface reflects the actual sky.
 */
import * as THREE from 'three';
import { compileMaterial } from './init';
import type { BuildSteps } from '@/buildings/loading';
import { SCATTER_GLSL, SKY_GAIN, MS_GAIN, SUN_IRRADIANCE } from './scattering';

const LUT_W = 512;
const LUT_H = 256;

/** tileable value-noise FBM texture used by the clouds (R: 5 octaves, G: detail, B: very low frequency) */
export function makeCloudNoise(size = 256): THREE.DataTexture {
  const tex = cloudNoiseTexture(size);
  for (const _ of fillCloudNoise(tex)) { /* synchronous offline/test callers */ }
  return tex;
}

function cloudNoiseTexture(size: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(size * size * 4), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/** One row per step; the shared queue stops its CPU work at 3 ms per frame. */
export function* fillCloudNoise(tex: THREE.DataTexture): Generator<void, void, unknown> {
  const size = tex.image.width;
  const data = tex.image.data!;
  const lattice = (period: number, seed: number) => {
    const vals = new Float32Array(period * period);
    let s = seed >>> 0;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < vals.length; i++) vals[i] = rnd();
    return (x: number, y: number) => {
      // x,y in [0,size)
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const v = (ix: number, iy: number) => vals[((iy % period) + period) % period * period + (((ix % period) + period) % period)];
      const a = v(x0, y0), b = v(x0 + 1, y0), c = v(x0, y0 + 1), d = v(x0 + 1, y0 + 1);
      return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
    };
  };
  const octR = [lattice(4, 11), lattice(8, 23), lattice(16, 37), lattice(32, 53), lattice(64, 71)];
  const octG = [lattice(16, 101), lattice(32, 113), lattice(64, 131), lattice(128, 151)];
  const octB = [lattice(2, 211), lattice(4, 223)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, wr = 0, w = 1;
      for (const o of octR) {
        r += o(x, y) * w;
        wr += w;
        w *= 0.5;
      }
      let g = 0, wg = 0;
      w = 1;
      for (const o of octG) {
        g += o(x, y) * w;
        wg += w;
        w *= 0.55;
      }
      const b = octB[0](x, y) * 0.7 + octB[1](x, y) * 0.3;
      const i = (y * size + x) * 4;
      data[i] = Math.round((r / wr) * 255);
      data[i + 1] = Math.round((g / wg) * 255);
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = 255;
    }
    yield;
  }
  tex.needsUpdate = true;
}

const LUT_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uSunDir;
uniform float uHaze;
uniform float uMieG;
uniform float uCamAlt;
uniform vec3 uSunIrradiance;
uniform float uSkyGain;
uniform float uMsGain;
varying vec2 vUv;
${SCATTER_GLSL}
void main() {
  float az = (vUv.x - 0.5) * 2.0 * PI_;
  float v = vUv.y - 0.5;
  float el = sign(v) * (4.0 * v * v) * (PI_ * 0.5);
  vec3 dir = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
  vec3 T;
  vec3 L = skyInscatter(dir, uCamAlt, uSunDir, uHaze, uMieG, uMsGain, T) * uSunIrradiance * uSkyGain;
  L = horizonWhiten(L, dir.y, dot(dir, uSunDir), uHaze, uSunDir.y);
  L += twilightSky(dir, uSunDir);
  gl_FragColor = vec4(L, 1.0);
}
`;

const LUT_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** shared GLSL to sample the LUT by direction */
export const LUT_SAMPLE_GLSL = /* glsl */ `
vec2 skyLutUv(vec3 d) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float az = atan(d.x, -d.z);
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (3.14159265 * 0.5));
  return vec2(az / (2.0 * 3.14159265) + 0.5, clamp(v, 0.002, 0.998));
}
vec3 sampleSkyLut(sampler2D lut, vec3 d) { return texture2D(lut, skyLutUv(d)).rgb; }
`;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #ifdef SKY_FAR
    p.z = p.w * 0.99999;
  #endif
  gl_Position = p;
}
`;

const DOME_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform sampler2D uLut;
uniform sampler2D uNoise;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunRadiance;     // disc radiance (already through the atmosphere)
uniform vec3 uSunColorCloud;   // sun light at cloud altitude
uniform vec3 uSunGround;       // sun irradiance at street level (directional light colour * intensity)
uniform vec3 uMoonRadiance;
uniform vec3 uMoonLight;       // moon light colour used to light clouds/aureole
uniform float uMoonPhase;      // radians, 0 = full, pi = new
uniform vec3 uPollution;       // light pollution glow colour (includes night factor)
uniform float uNight;          // 0..1
uniform float uCloudCover;
uniform float uCloudHeight;
uniform float uCloudScale;
uniform vec2 uWind1;
uniform vec2 uWind2;
uniform vec2 uCamXZ;
uniform float uCamAlt;
uniform float uStarRot;        // radians, sidereal rotation
uniform float uStarVis;
uniform float uFlash;
uniform float uEnvMode;        // 1 = rendering the environment map (no sun disc, no stars, clamp)
uniform float uHazeMix;        // 0..1 how much the whole sky is flattened into fog
uniform vec3 uFogTint;
uniform float uSunAureole;
uniform float uTime;
${LUT_SAMPLE_GLSL}
const float PI = 3.14159265;
const float EARTH_R = 6360e3;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hg(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}
float raySphereFarD(vec3 o, vec3 d, float R) {
  float b = dot(o, d);
  float c = dot(o, o) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b + sqrt(disc);
}

vec3 stars(vec3 d) {
  // rotate about the celestial pole (NYC latitude 40.75 N, north = -z)
  vec3 pole = normalize(vec3(0.0, sin(0.7112), -cos(0.7112)));
  float c = cos(uStarRot), s = sin(uStarRot);
  vec3 dp = d * c + cross(pole, d) * s + pole * dot(pole, d) * (1.0 - c);
  // cube-face cells
  vec3 a = abs(dp);
  vec2 uv; float face;
  if (a.x >= a.y && a.x >= a.z) { uv = dp.yz / a.x; face = dp.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { uv = dp.xz / a.y; face = dp.y > 0.0 ? 2.0 : 3.0; }
  else { uv = dp.xy / a.z; face = dp.z > 0.0 ? 4.0 : 5.0; }
  float N = 160.0;
  vec2 g = uv * N;
  vec2 cell = floor(g);
  vec2 f = g - cell;
  float h = hash12(cell + face * 977.0);
  float h2 = hash12(cell * 1.7 + face * 131.0 + 5.0);
  vec2 sp = vec2(hash12(cell + 3.1 + face), hash12(cell + 7.7 + face));
  float dist = length(f - sp) * (1.0 / N);
  float mag = pow(h2, 14.0);           // few bright, many faint
  float radius = 0.0012 + 0.0025 * mag;
  float city = smoothstep(0.001, 0.015, dot(uPollution, vec3(0.2126, 0.7152, 0.0722)));
  float star = (1.0 - smoothstep(radius * 0.25, radius, dist))
    * step(mix(0.72, 0.998, city), h) * mix(1.0, step(0.8, mag), city);
  vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash12(cell + 11.0 + face));
  return tint * star * (0.06 + 1.6 * mag) * mix(1.0, 0.06, city);
}

// Mid-level cumulus / altocumulus density on the layer: puffs 150 m .. 2 km. The FBM (R + very-low B) gives the
// masses; the fine G channel erodes only the EDGE band (base near the threshold), so the outline is cauliflower
// while the cores stay solid. The old wide smoothstep (0.14) with detail everywhere was the "blurry smear".
float cloudDensity(vec2 xz, float thr) {
  vec3 n1 = texture2D(uNoise, xz * 0.9 + uWind1).rgb;
  float det = texture2D(uNoise, xz * 4.2 + uWind2).g;
  float base = n1.r * 0.78 + n1.b * 0.22;
  float edgeBand = 1.0 - smoothstep(0.0, 0.22, base - thr);
  float eroded = base + (det - 0.5) * 0.24 * edgeBand;
  return smoothstep(thr, thr + 0.07, eroded);
}

// High cirrus (8 km): thin ice fibres stretched ~8x along the wind inside slow large patches. Strongly forward
// scattering, so they light up white/warm toward a low sun and stay a pale veil away from it.
vec4 cirrus(vec3 d, vec3 o, vec3 ambient, vec3 sunLit, float sunUp, float cover, float mu) {
  float t = raySphereFarD(o, d, EARTH_R + 8000.0);
  vec3 p = o + d * t;
  vec2 xz = (p.xz + uCamXZ) / (uCloudScale * 2.2);
  vec2 wd = length(uWind1) > 1e-5 ? normalize(uWind1) : vec2(0.7, 0.7);
  vec2 f = vec2(dot(xz, wd), dot(xz, vec2(-wd.y, wd.x)));
  float patchN = texture2D(uNoise, xz * 0.7 + uWind1 * 0.15).r;
  float fib1 = texture2D(uNoise, vec2(f.x * 0.45, f.y * 3.6) + uWind1 * 0.25).g;
  float fib2 = texture2D(uNoise, vec2(f.x * 0.9, f.y * 7.0) - uWind2 * 0.2).g;
  // clear skies keep a faint veil over ~a third of the sky; partly cloudy grows it; a deck hides it anyway
  float amount = mix(0.30, 0.62, smoothstep(0.0, 0.5, cover));
  float thr = mix(0.63, 0.40, amount);
  float mask = smoothstep(thr, thr + 0.18, patchN);
  float fibre = smoothstep(0.32, 0.72, fib1 * 0.65 + fib2 * 0.35);
  float dens = mask * fibre;
  vec3 col = ambient * 0.55 + sunLit * (0.22 + 0.6 * hg(mu, 0.65)) * sunUp;
  float horizon = smoothstep(0.004, 0.06, d.y);
  float alpha = dens * 0.42 * exp(-t / 90000.0) * horizon;
  return vec4(col, clamp(alpha, 0.0, 1.0));
}

// returns colour + alpha; skyBehind is the clear sky in this direction, used for the aerial perspective of far cloud
vec4 clouds(vec3 d, vec3 ambient, vec3 sunLit, float sunUp, vec3 skyBehind) {
  if (d.y < 0.004) return vec4(0.0);
  vec3 o = vec3(0.0, EARTH_R + uCamAlt, 0.0);
  float cover = clamp(uCloudCover, 0.0, 1.0);
  float mu = dot(d, uSunDir);
  // ---- high layer first (the mid layer composites over it) ----
  vec4 ci = cirrus(d, o, ambient, sunLit, sunUp, cover, mu);
  // ---- mid layer ----
  float t = raySphereFarD(o, d, EARTH_R + uCloudHeight);
  vec3 p = o + d * t;
  vec2 xz = (p.xz + uCamXZ) / uCloudScale;
  // FBM is concentrated around 0.5: the threshold walks through that band with cover
  float thr = mix(0.70, 0.28, cover);
  float dens = cloudDensity(xz, thr);
  // thickness toward the sun (silver lining / dark core)
  vec2 sunXZ = normalize(uSunDir.xz + vec2(1e-4, 0.0)) * (900.0 / uCloudScale) * clamp(1.0 - uSunDir.y, 0.2, 1.0);
  float densS = cloudDensity(xz + sunXZ, thr);
  float lit = exp(-densS * 2.8) * 0.85 + 0.15;
  // silver lining: thin edges glow toward the sun; frontlit edges brighten a little regardless of angle
  float edge = dens * (1.0 - dens) * 4.0;
  float silver = hg(mu, 0.6) * 1.6 * edge;
  // cumulus: bases are shaded grey when the sun is high, lit warm from the side when it is low
  float bottomLit = mix(0.28, 0.95, smoothstep(0.35, 0.02, uSunDir.y));
  float core = dens * dens;
  vec3 direct = sunLit * (lit * bottomLit * (1.0 - 0.6 * core) + edge * lit * 0.12 + silver) * sunUp;
  // dark base: a thick core gets less than half the sky light
  vec3 col = ambient * (0.95 - 0.5 * core) + direct;
  float overcast = smoothstep(0.55, 0.95, cover);
  // A real deck: mottled bases (dens saturates at high cover, so use the FBM directly), darker toward the horizon
  // where the layer is seen edge-on, thin spots that pass the sun and a bright zone toward it.
  float mottle = texture2D(uNoise, xz * 1.7 + uWind1 * 1.3).r * 0.7 + texture2D(uNoise, xz * 5.0 + uWind2 * 0.6).g * 0.3;
  float thin = 1.0 - smoothstep(0.30, 0.72, mottle);
  vec3 deck = ambient * (0.55 + 0.5 * smoothstep(0.25, 0.75, mottle)) * mix(0.82, 1.0, smoothstep(0.02, 0.35, d.y))
    + sunLit * sunUp * (0.06 + 0.30 * thin) * (0.3 + hg(mu, 0.55) * 2.0);
  col = mix(col, deck, overcast * 0.9);
  float horizon = smoothstep(0.004, 0.05, d.y);
  // the deck is solid at high cover (only the thin spots open); far cloud fades into the haze, not to nothing
  float alpha = max(dens, overcast * (0.80 + 0.2 * (1.0 - thin))) * horizon * smoothstep(0.0, 0.15, cover);
  alpha *= mix(1.0, exp(-t / 70000.0), 1.0 - overcast);
  float hazeBlend = 1.0 - exp(-t / 32000.0);
  col = mix(col, skyBehind, hazeBlend * 0.85);
  // composite the mid layer over the cirrus
  vec3 ciCol = mix(ci.rgb, skyBehind, 0.5 * (1.0 - smoothstep(0.0, 0.25, d.y)));
  float a = alpha + ci.a * (1.0 - alpha);
  vec3 outCol = a > 1e-4 ? (col * alpha + ciCol * ci.a * (1.0 - alpha)) / a : col;
  return vec4(outCol, clamp(a, 0.0, 1.0));
}

void main() {
  vec3 d = normalize(vDir);
  vec3 dSky = d;
  dSky.y = max(d.y, 0.0);
  vec3 sky = sampleSkyLut(uLut, normalize(dSky + vec3(0.0, 0.0015, 0.0)));
  // Under a high sun the single-scatter LUT is too even from 10 deg up: a photograph keeps a bright hazy
  // horizon band and deepens toward the zenith. Off below ~12 deg (golden hour) and under a deck.
  float highSun = smoothstep(0.2, 0.45, uSunDir.y) * (1.0 - smoothstep(0.55, 0.95, uCloudCover));
  sky *= mix(1.0, 0.76, smoothstep(0.08, 0.6, d.y) * highSun);
  // view only (not the fill): the upper third deepens a little more so a clear noon is not a flat cyan
  sky *= 1.0 - 0.07 * smoothstep(0.3, 0.9, d.y) * highSun * (1.0 - uEnvMode);
  vec3 zen = sampleSkyLut(uLut, vec3(0.0, 1.0, 0.0));
  vec3 horiz = sampleSkyLut(uLut, normalize(vec3(-uSunDir.x, 0.06, -uSunDir.z) + vec3(0.001, 0.0, 0.0)));
  // NYC light pollution: a dull orange-grey haze band in the lower ~25 deg (the city's own light scattered back
  // down: a photograph over Manhattan shows it, not blue-black) grading to a grey-blue zenith. horizonness
  // (1-y)^5 is the tight skirt at the horizon; the exp band carries the glow up to the tops of the towers.
  // Post-exposure the band sits ~0.08-0.12 at 15 deg, the zenith ~0.02. The PMREM uses this same profile,
  // keeping the night fill in step with the sky.
  float horizonness = pow(1.0 - clamp(d.y, 0.0, 1.0), 5.0);
  float band = exp(-max(d.y, 0.0) / 0.22);
  vec3 pollution = uPollution * (0.5 + 2.0 * horizonness + 4.5 * band) * (1.0 + 1.0 * uCloudCover);
  pollution += vec3(0.011, 0.012, 0.017) * uNight * (1.0 - horizonness);

  // ground below the horizon
  float below = smoothstep(0.0, -0.12, d.y);
  if (uEnvMode > 0.5) {
    // Environment map = the diffuse fill. A street's shade is lit by the sky AND by sunlit pavement and facades
    // across the way, which this dome has none of. By day: cut the sky chroma (real 3 pm shade reads
    // neutral-cool, not sky-cyan), put warm sunlit-facade bounce into the low sky band buildings would occupy,
    // and let the floor carry pavement bounce (still dark: a bright floor flat-fills every wall from below).
    // Gated on sun height: at a 10 deg sun there is no sunlit pavement to bounce and the shade really is blue.
    float dayFill = smoothstep(0.15, 0.5, uSunDir.y);
    vec3 skyAvg = mix(zen, horiz, 0.2);
    float skyLumEnv = dot(sky, vec3(0.2126, 0.7152, 0.0722));
    sky = mix(sky, vec3(skyLumEnv), 0.75 * dayFill);
    vec3 bounce = uSunGround * max(uSunDir.y, 0.0) * vec3(0.56, 0.48, 0.40) / PI; // sunlit limestone/asphalt/paint, albedo-weighted
    float facadeBand = 1.0 - smoothstep(0.0, 0.30, d.y);
    sky = mix(sky, bounce * 0.30 + skyAvg * 0.25, facadeBand * 0.6 * dayFill);
    vec3 ground = 0.13 * skyAvg + bounce * 0.22 + pollution * 0.5;
    sky = mix(sky, ground, below);
  } else {
    sky = mix(sky, sky * 0.55, below);
  }
  sky += pollution * (1.0 - below * 0.5);

  float skyLum = dot(sky, vec3(0.2126, 0.7152, 0.0722));
  // Under a deck the light is the deck's own (neutral grey, ART 0.62/0.64/0.66), not the blue clear-sky zenith
  // behind it: this feeds the PMREM, so it decides whether an overcast street has a blue cast.
  float overcastSky = smoothstep(0.55, 0.95, uCloudCover);
  vec3 ambientCloud = mix(zen, horiz, 0.45) * 1.05;
  float ambientLum = dot(ambientCloud, vec3(0.2126, 0.7152, 0.0722));
  ambientCloud = mix(ambientCloud, ambientLum * vec3(0.968, 0.999, 1.03), overcastSky * 0.85) + uPollution * (1.2 + 1.2 * uCloudCover);

  // stars
  if (uEnvMode < 0.5 && uStarVis > 0.001) {
    float city = smoothstep(0.001, 0.015, dot(uPollution, vec3(0.2126, 0.7152, 0.0722)));
    float zenith = smoothstep(mix(0.0, 0.8, city), mix(0.15, 0.98, city), d.y);
    float vis = uStarVis * (1.0 - smoothstep(0.004, 0.06, skyLum)) * zenith;
    sky += stars(d) * vis;
  }

  // moon (disc with phase); visible by day too, faintly
  {
    float cosR = dot(d, uMoonDir);
    float rMoon = 0.0046;
    if (cosR > 0.99995 && uMoonDir.y > -0.05) {
      vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 my = cross(mx, uMoonDir);
      vec2 q = vec2(dot(d, mx), dot(d, my)) / rMoon;
      float r2 = dot(q, q);
      if (r2 < 1.15) {
        float z = sqrt(max(0.0, 1.0 - min(r2, 1.0)));
        vec3 n = normalize(q.x * mx + q.y * my - z * uMoonDir);
        // phase: light from a virtual direction rotated by the phase angle in the moon's frame
        vec3 L = normalize(-uMoonDir * cos(uMoonPhase) + mx * sin(uMoonPhase));
        float lam = max(dot(n, L), 0.0);
        float maria = 0.85 + 0.3 * (texture2D(uNoise, q * 0.35 + 0.3).g - 0.5);
        vec3 moon = uMoonRadiance * (lam * maria + 0.012);
        float a = smoothstep(1.15, 0.95, r2);
        sky = mix(sky, moon + sky * 0.15, a);
      }
    }
  }

  float sunUp = smoothstep(-0.12, 0.0, uSunDir.y);
  float mu = dot(d, uSunDir);

  // sun disc + aureole (not in the env map: the directional light carries the sun). The disc limb is soft
  // (haze + lens) and sits under the cloud composite so it is attenuated by cloud alpha and shows through gaps.
  // Two glow terms: the tight forward peak, and the broad ~10 deg halo the haze lends a low sun.
  vec3 skyBehind = sky;
  if (uEnvMode < 0.5) {
    float cosDisc = 0.999989; // 0.2665 deg radius
    float disc = smoothstep(cosDisc - 0.000022, cosDisc + 0.000004, mu);
    sky += uSunRadiance * disc;
    sky += uSunRadiance * (hg(mu, 0.985) * 0.0025 + hg(mu, 0.90) * 0.0012) * uSunAureole;
  } else {
    sky += uSunRadiance * hg(mu, 0.985) * uSunAureole * 0.0004;
  }

  // clouds (two layers: high cirrus, mid cumulus/altocumulus or deck)
  vec3 sunLitCloud = uSunColorCloud + uMoonLight * 0.6;
  vec4 cl = clouds(d, ambientCloud, sunLitCloud, max(sunUp, 0.15), skyBehind);
  sky = mix(sky, cl.rgb, cl.a);

  // fog condition: flatten the whole sky into the fog colour near the horizon
  float fogFlat = uHazeMix * (1.0 - smoothstep(0.0, 0.6, d.y) * 0.6);
  sky = mix(sky, uFogTint, clamp(fogFlat, 0.0, 1.0));

  // lightning
  sky += vec3(0.75, 0.82, 1.0) * uFlash * (0.5 + 1.5 * cl.a + 0.8 * horizonness);

  if (uEnvMode > 0.5) sky = min(sky, vec3(6.0));
  gl_FragColor = vec4(max(sky, vec3(0.0)), 1.0);
}
`;

export interface SkyParams {
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
  haze: number;
  mieG: number;
  camAlt: number;
  camX: number;
  camZ: number;
  sunRadiance: THREE.Color;
  sunColorCloud: THREE.Color;
  sunGround: THREE.Color;
  moonRadiance: THREE.Color;
  moonLight: THREE.Color;
  moonPhase: number;
  pollution: THREE.Color;
  night: number;
  cloudCover: number;
  cloudHeight: number;
  wind1: THREE.Vector2;
  wind2: THREE.Vector2;
  starRot: number;
  starVis: number;
  flash: number;
  hazeMix: number;
  fogTint: THREE.Color;
  sunAureole: number;
  time: number;
}

export class SkySystem {
  readonly lut: THREE.WebGLRenderTarget;
  readonly noise: THREE.DataTexture;
  readonly dome: THREE.Mesh;
  readonly envScene: THREE.Scene;
  private lutMat: THREE.ShaderMaterial;
  private lutScene: THREE.Scene;
  private lutCam: THREE.OrthographicCamera;
  private domeMat: THREE.ShaderMaterial;
  private envMat: THREE.ShaderMaterial;
  private envDome: THREE.Mesh;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  envMap: THREE.Texture | null = null;
  private lutUniforms: Record<string, THREE.IUniform>;
  private domeUniforms: Record<string, THREE.IUniform>;
  private lutValid = false;
  private readonly lastLutSun = new THREE.Vector3();
  private readonly lastLutIrradiance = new THREE.Vector3();
  private lastLutHaze = NaN;
  private lastLutMieG = NaN;
  private lastLutAltitude = NaN;
  private lastLutSkyGain = NaN;
  private lastLutMsGain = NaN;
  private lastLutMaterialVersion = -1;
  private lastLutTextureVersion = -1;
  private readonly invalidateLut = () => { this.lutValid = false; };

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    renderer.domElement.addEventListener('webglcontextrestored', this.invalidateLut);
    this.noise = cloudNoiseTexture(256);
    this.lut = new THREE.WebGLRenderTarget(LUT_W, LUT_H, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.lut.texture.name = 'skyLut';
    this.lutUniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uHaze: { value: 1 },
      uMieG: { value: 0.76 },
      uCamAlt: { value: 2 },
      uSunIrradiance: { value: SUN_IRRADIANCE.clone() },
      uSkyGain: { value: SKY_GAIN },
      uMsGain: { value: MS_GAIN },
    };
    this.lutMat = new THREE.ShaderMaterial({ vertexShader: LUT_VERT, fragmentShader: LUT_FRAG, uniforms: this.lutUniforms, depthTest: false, depthWrite: false });
    this.lutScene = new THREE.Scene();
    this.lutScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat));
    this.lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.domeUniforms = {
      uLut: { value: this.lut.texture },
      uNoise: { value: this.noise },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunRadiance: { value: new THREE.Color(0, 0, 0) },
      uSunColorCloud: { value: new THREE.Color(0, 0, 0) },
      uSunGround: { value: new THREE.Color(0, 0, 0) },
      uMoonRadiance: { value: new THREE.Color(0, 0, 0) },
      uMoonLight: { value: new THREE.Color(0, 0, 0) },
      uMoonPhase: { value: 0 },
      uPollution: { value: new THREE.Color(0, 0, 0) },
      uNight: { value: 0 },
      uCloudCover: { value: 0.2 },
      uCloudHeight: { value: 1500 },
      uCloudScale: { value: 9000 },
      uWind1: { value: new THREE.Vector2() },
      uWind2: { value: new THREE.Vector2() },
      uCamXZ: { value: new THREE.Vector2() },
      uCamAlt: { value: 2 },
      uStarRot: { value: 0 },
      uStarVis: { value: 0 },
      uFlash: { value: 0 },
      uEnvMode: { value: 0 },
      uHazeMix: { value: 0 },
      uFogTint: { value: new THREE.Color(0.5, 0.5, 0.5) },
      uSunAureole: { value: 1 },
      uTime: { value: 0 },
    };
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      uniforms: this.domeUniforms,
      defines: { SKY_FAR: '' },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });
    this.dome = new THREE.Mesh(geo, this.domeMat);
    this.dome.name = 'skyDome';
    this.dome.scale.setScalar(9000);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 100000;
    this.dome.castShadow = false;
    this.dome.receiveShadow = false;
    this.dome.matrixAutoUpdate = true;
    scene.add(this.dome);

    // environment scene: same shader, env mode, small dome so PMREM's cube camera (near 0.1..far 100) sees it
    this.envMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      uniforms: { ...this.domeUniforms, uEnvMode: { value: 1 } },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.envDome = new THREE.Mesh(geo, this.envMat);
    this.envDome.scale.setScalar(50);
    this.envDome.frustumCulled = false;
    this.envScene = new THREE.Scene();
    this.envScene.add(this.envDome);
    this.pmrem = new THREE.PMREMGenerator(renderer);

  }

  *warmup(scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget): BuildSteps {
    yield* fillCloudNoise(this.noise);
    yield this.noise;
    yield compileMaterial(this.renderer, this.lutMat, this.lutCam, this.lutScene, this.lut);
    yield compileMaterial(this.renderer, this.domeMat, camera, scene, target, this.dome);
    yield compileMaterial(this.renderer, this.envMat, new THREE.PerspectiveCamera(90, 1, 1, 100), this.envScene, target, this.envDome);
  }

  /** Three r185 has no public async PMREM warmup. Isolate its pinned-version
   * allocation adapter here; never change the GGX filtering or capture shader.
   * The scratch output is discarded, internal materials remain cached for fromScene. */
  *warmupPMREM(size: number): BuildSteps {
    const generator = this.pmrem as unknown as {
      _setSize(size: number): void;
      _allocateTargets(): THREE.WebGLRenderTarget;
      _ggxMaterial: THREE.ShaderMaterial;
      _blurMaterial: THREE.ShaderMaterial;
      _backgroundBox: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial> | null;
    };
    generator._setSize(size);
    const target = generator._allocateTargets();
    try {
      // fromScene also draws a solid background before the dome on all six faces.
      // Warm its real material, otherwise the first capture still links it inline.
      generator._backgroundBox ??= new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({
        name: 'PMREM.Background', side: THREE.BackSide, depthWrite: false, depthTest: false,
      }));
      yield compileMaterial(this.renderer, generator._backgroundBox.material, this.lutCam, this.envScene, target, generator._backgroundBox);
      yield compileMaterial(this.renderer, generator._ggxMaterial, this.lutCam, this.envScene, target);
      // sigma is zero in renderEnv: the optional Gaussian blur is never drawn.
    } finally { target.dispose(); }
  }

  /** push the frame's parameters to the shaders */
  setParams(p: SkyParams): void {
    const l = this.lutUniforms;
    (l.uSunDir.value as THREE.Vector3).copy(p.sunDir);
    l.uHaze.value = p.haze;
    l.uMieG.value = p.mieG;
    l.uCamAlt.value = Math.max(2, p.camAlt);
    const u = this.domeUniforms;
    (u.uSunDir.value as THREE.Vector3).copy(p.sunDir);
    (u.uMoonDir.value as THREE.Vector3).copy(p.moonDir);
    (u.uSunRadiance.value as THREE.Color).copy(p.sunRadiance);
    (u.uSunColorCloud.value as THREE.Color).copy(p.sunColorCloud);
    (u.uSunGround.value as THREE.Color).copy(p.sunGround);
    (u.uMoonRadiance.value as THREE.Color).copy(p.moonRadiance);
    (u.uMoonLight.value as THREE.Color).copy(p.moonLight);
    u.uMoonPhase.value = p.moonPhase;
    (u.uPollution.value as THREE.Color).copy(p.pollution);
    u.uNight.value = p.night;
    u.uCloudCover.value = p.cloudCover;
    u.uCloudHeight.value = p.cloudHeight;
    (u.uWind1.value as THREE.Vector2).copy(p.wind1);
    (u.uWind2.value as THREE.Vector2).copy(p.wind2);
    (u.uCamXZ.value as THREE.Vector2).set(p.camX, p.camZ);
    u.uCamAlt.value = Math.max(2, p.camAlt);
    u.uStarRot.value = p.starRot;
    u.uStarVis.value = p.starVis;
    u.uFlash.value = p.flash;
    u.uHazeMix.value = p.hazeMix;
    (u.uFogTint.value as THREE.Color).copy(p.fogTint);
    u.uSunAureole.value = p.sunAureole;
    u.uTime.value = p.time;
  }

  /** re-integrate the scattering LUT (cheap: 512x256 x 16 x 6 samples) */
  renderLut(): void {
    // Only these uniforms feed LUT_FRAG. Clouds, wind, stars and lightning are
    // evaluated by the dome and must keep animating even when the LUT is reused.
    // Test exact equality, and retain the caller's existing every-other-frame
    // cadence when anything changes (no lower-resolution or stale sky samples).
    const u = this.lutUniforms;
    if (this.lutValid && this.lastLutSun.equals(u.uSunDir.value)
      && this.lastLutIrradiance.equals(u.uSunIrradiance.value)
      && this.lastLutHaze === u.uHaze.value && this.lastLutMieG === u.uMieG.value
      && this.lastLutAltitude === u.uCamAlt.value && this.lastLutSkyGain === u.uSkyGain.value
      && this.lastLutMsGain === u.uMsGain.value && this.lastLutMaterialVersion === this.lutMat.version
      && this.lastLutTextureVersion === this.lut.texture.version) return;
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevXr = r.xr.enabled;
    try {
      r.xr.enabled = false;
      r.setRenderTarget(this.lut);
      r.render(this.lutScene, this.lutCam);
      this.lastLutSun.copy(u.uSunDir.value);
      this.lastLutIrradiance.copy(u.uSunIrradiance.value);
      this.lastLutHaze = u.uHaze.value;
      this.lastLutMieG = u.uMieG.value;
      this.lastLutAltitude = u.uCamAlt.value;
      this.lastLutSkyGain = u.uSkyGain.value;
      this.lastLutMsGain = u.uMsGain.value;
      this.lastLutMaterialVersion = this.lutMat.version;
      this.lastLutTextureVersion = this.lut.texture.version;
      this.lutValid = true;
    } finally {
      r.setRenderTarget(prevRT);
      r.xr.enabled = prevXr;
    }
  }

  /** render the sky (env mode) into a PMREM and return it. Caller sets scene.environment. */
  renderEnv(size = 256): THREE.Texture {
    const old = this.envRT;
    // Three r185's fromScene has no output-target argument. Reuse only its
    // compatible output allocation, leaving capture, GGX filtering and cadence
    // untouched. Its private allocator must still run after a size/warmup change
    // to rebuild the internal mip geometry/materials and ping-pong target.
    const generator = this.pmrem as unknown as {
      _allocateTargets(): THREE.WebGLRenderTarget;
      _pingPongRenderTarget: THREE.WebGLRenderTarget | null;
    };
    const cubeSize = 2 ** Math.floor(Math.log2(size));
    const width = 3 * Math.max(cubeSize, 16 * 7), height = 4 * cubeSize;
    const scratch = generator._pingPongRenderTarget;
    const reuse = old && old.width === width && old.height === height
      && scratch?.width === width && scratch.height === height;
    const allocate = generator._allocateTargets;
    if (reuse) generator._allocateTargets = () => old;
    try {
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 100, { size });
    } finally {
      generator._allocateTargets = allocate;
    }
    this.envMap = this.envRT.texture;
    if (old && old !== this.envRT) old.dispose();
    return this.envMap;
  }

  placeAt(pos: THREE.Vector3): void {
    this.dome.position.copy(pos);
  }

  dispose(scene: THREE.Scene): void {
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.invalidateLut);
    scene.remove(this.dome);
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.envMat.dispose();
    this.lutMat.dispose();
    this.lut.dispose();
    this.noise.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
  }
}
