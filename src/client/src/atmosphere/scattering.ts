/**
 * Atmospheric scattering model shared by the CPU (sun colour, fog colours) and the GPU (sky LUT, dome).
 * Single scattering (Rayleigh + Mie + ozone absorption) with a cheap multiple-scattering ambient term.
 * Units: metres; radiance in "game units" where the sun's top-of-atmosphere irradiance is SUN_IRRADIANCE.
 * A white lambertian surface in full noon sun then renders at ~ SUN_IRRADIANCE * T / pi ~= 1.0 linear.
 */
import * as THREE from 'three';

export const EARTH_R = 6360e3;
export const ATMO_R = 6460e3;
export const BETA_R = [5.802e-6, 13.558e-6, 33.1e-6] as const; // Rayleigh scattering /m at sea level
export const BETA_MS = 3.996e-6; // Mie scattering /m
export const BETA_MA = 4.4e-6; // Mie absorption /m
export const BETA_O = [0.65e-6, 1.881e-6, 0.085e-6] as const; // ozone absorption /m (peak)
export const H_R = 8000;
export const H_M = 1200;
export const OZONE_CENTER = 25000;
export const OZONE_WIDTH = 15000;

/** top-of-atmosphere solar irradiance in game units (linear rgb, slightly warm 5800 K) */
export const SUN_IRRADIANCE = new THREE.Vector3(4.0 * 1.0, 4.0 * 0.975, 4.0 * 0.94);
/** multiple scattering / calibration gains (see scattering notes in index.ts) */
export const MS_GAIN = 2.0;
export const SKY_GAIN = 1.5;
/**
 * Altitude whose sun transmittance colours the multiple-scattering source. Second-order light is dominated by
 * the (blue) sky above the aerosol layer, not by the reddened sun at ground level; using ground transmittance
 * made the whole sky too dark and the shade fill grey-green.
 */
export const MS_ALT = 4000;
/**
 * Aerosol multiple scattering whitens the sky within ~12 deg of the horizon (single scattering alone leaves
 * a green-yellow band away from the sun). Strength grows with haze; the sunward glow keeps its warmth.
 */
export function horizonWhiten(out: THREE.Color, dy: number, mu: number, haze: number, sunY = 1): THREE.Color {
  // With the sun low the anti-solar horizon is pale blue (earth shadow / Belt of Venus), not neutral grey:
  // that band carries most of the shade fill, so its chroma is what makes 18:00 shade blue rather than grey.
  // The single-scatter band there is yellow-green, so the multiple-scatter weight also rises with a low sun.
  const low = 1 - smoothstep(0.1, 0.45, sunY);
  const w = Math.min(0.9, (0.4 + 0.12 * Math.min(haze, 3)) * (1 + 0.5 * low)) * (1 - smoothstep(0, 0.22, dy)) * (1 - 0.7 * smoothstep(0.3, 0.9, mu));
  const l = out.r * 0.2126 + out.g * 0.7152 + out.b * 0.0722;
  out.r += (l * THREE.MathUtils.lerp(0.96, 0.78, low) - out.r) * w;
  out.g += (l * THREE.MathUtils.lerp(0.985, 0.93, low) - out.g) * w;
  out.b += (l * THREE.MathUtils.lerp(1.05, 1.25, low) - out.b) * w;
  return out;
}

/**
 * Civil/nautical twilight. Single scattering from street level sees no sun once it sets (every sample is in the
 * earth's shadow), so the model went black at -1 deg; the real sky is lit by the sunlit upper atmosphere for
 * ~40 min: deep blue overhead, lighter toward the horizon, a warm band low toward the sun. Game-unit radiance
 * (clear noon zenith ~0.25); fades in below +7 deg, halves every 2.5 deg of depression, gone by -14 deg.
 */
export function twilightSky(dir: THREE.Vector3, sunDir: THREE.Vector3, out: THREE.Color): THREE.Color {
  const elDeg = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)) * 180 / Math.PI;
  const dep = Math.max(0, -elDeg);
  const amp = 0.18 * Math.exp(-dep / 3.6) * (1 - smoothstep(2, 7, elDeg)) * smoothstep(-14, -9, elDeg);
  if (amp <= 1e-5) return out.setRGB(0, 0, 0);
  const dy = Math.max(dir.y, 0);
  const dh = Math.hypot(dir.x, dir.z), sh = Math.hypot(sunDir.x, sunDir.z);
  const cosAz = dh > 1e-4 && sh > 1e-4 ? (dir.x * sunDir.x + dir.z * sunDir.z) / (dh * sh) : 0;
  const hz = Math.pow(1 - dy, 3);
  const warm = 3 * Math.pow(Math.max(cosAz, 0), 4) * Math.exp(-dy * 7) * Math.exp(-dep / 2.5);
  const toSun = Math.max(cosAz, 0) ** 2;
  out.r = amp * (THREE.MathUtils.lerp(0.16, 1.6 * THREE.MathUtils.lerp(0.36, 0.62, toSun), hz) + 1.0 * warm);
  out.g = amp * (THREE.MathUtils.lerp(0.30, 1.6 * THREE.MathUtils.lerp(0.42, 0.48, toSun), hz) + 0.52 * warm);
  out.b = amp * (THREE.MathUtils.lerp(0.62, 1.6 * THREE.MathUtils.lerp(0.62, 0.40, toSun), hz) + 0.22 * warm);
  return out;
}

function raySphereFar(oy: number, dx: number, dy: number, R: number): number {
  // origin (0, oy), dir (dx, dy)
  const b = oy * dy;
  const c = oy * oy - R * R;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b + Math.sqrt(disc);
}
function raySphereNear(oy: number, dx: number, dy: number, R: number): number {
  const b = oy * dy;
  const c = oy * oy - R * R;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b - Math.sqrt(disc);
}

const tmpDens = [0, 0, 0];
function densities(h: number, out = tmpDens): number[] {
  out[0] = Math.exp(-h / H_R);
  out[1] = Math.exp(-h / H_M);
  out[2] = Math.max(0, 1 - Math.abs(h - OZONE_CENTER) / OZONE_WIDTH);
  return out;
}

/**
 * Optical depth (rayleigh, mie, ozone densities integrated) from a point at (x=px, y=py) along unit dir (dx, dy)
 * to the top of the atmosphere. Returns null when the ray hits the earth.
 */
function opticalDepth(px: number, py: number, dx: number, dy: number, samples: number, out: number[]): number[] | null {
  // rotate into a frame where the point is on the y axis: not needed, we work in 2D with the point anywhere
  const r2 = px * px + py * py;
  const b = px * dx + py * dy;
  const cE = r2 - EARTH_R * EARTH_R;
  const discE = b * b - cE;
  if (discE > 0 && -b - Math.sqrt(discE) > 0) return null; // hits the earth
  const cA = r2 - ATMO_R * ATMO_R;
  const tmax = -b + Math.sqrt(Math.max(0, b * b - cA));
  out[0] = out[1] = out[2] = 0;
  let tPrev = 0;
  for (let i = 1; i <= samples; i++) {
    const f = i / samples;
    const t = tmax * f * f;
    const ds = t - tPrev;
    const tm = 0.5 * (t + tPrev);
    tPrev = t;
    const qx = px + dx * tm;
    const qy = py + dy * tm;
    const h = Math.sqrt(qx * qx + qy * qy) - EARTH_R;
    const d = densities(h);
    out[0] += d[0] * ds;
    out[1] += d[1] * ds;
    out[2] += d[2] * ds;
  }
  return out;
}

const odTmp = [0, 0, 0];

/**
 * Transmittance of sunlight reaching altitude `alt` with the sun at `elevation` (radians).
 * `haze` scales the Mie (aerosol) coefficients: 1 = clear continental, 3+ = humid summer haze, 8+ = rain.
 */
export function sunTransmittance(elevation: number, haze: number, out: THREE.Color, alt = 30): THREE.Color {
  const od = opticalDepth(0, EARTH_R + alt, Math.cos(elevation), Math.sin(elevation), 32, odTmp);
  if (!od) return out.setRGB(0, 0, 0);
  const mie = (BETA_MS + BETA_MA) * haze * od[1];
  out.r = Math.exp(-(BETA_R[0] * od[0] + mie + BETA_O[0] * od[2]));
  out.g = Math.exp(-(BETA_R[1] * od[0] + mie + BETA_O[1] * od[2]));
  out.b = Math.exp(-(BETA_R[2] * od[0] + mie + BETA_O[2] * od[2]));
  return out;
}

/** Low street-level sun: smoothly reach 3600 K at 16°, then 3200 K at 6°.
 * Preserve the transmitted luminance; never make an already-red sunset bluer.
 * RGB ratios are the Planckian locus converted from CIE xy to linear sRGB.
 */
export function warmLowSun(color: THREE.Color, elevationDeg: number): THREE.Color {
  const weight = 1 - smoothstep(16, 20, elevationDeg);
  if (weight === 0 || color.r <= 0) return color;
  const cool = smoothstep(6, 16, elevationDeg);
  const green = Math.min(color.g / color.r, THREE.MathUtils.lerp(0.516892, 0.588055, cool));
  const blue = Math.min(color.b / color.r, THREE.MathUtils.lerp(0.194285, 0.281649, cool));
  const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
  color.g += (color.r * green - color.g) * weight;
  color.b += (color.r * blue - color.b) * weight;
  return color.multiplyScalar(luminance / Math.max(1e-8, color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722));
}

/**
 * Coarse CPU sky radiance for a view direction (unit, y up) with the sun at sunDir. Same model as the GPU LUT,
 * fewer samples. Used for uSkyColor / uHorizonColor / uFogColor so far-LOD materials match the real sky.
 */
export function skyRadiance(dir: THREE.Vector3, sunDir: THREE.Vector3, haze: number, mieG: number, out: THREE.Color, alt = 30): THREE.Color {
  const oy = EARTH_R + alt;
  // 2D: view plane. dir.y is elevation component; the horizontal part is |dir.xz|
  const dh = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
  const dy = dir.y;
  let tmax = raySphereFar(oy, dh, dy, ATMO_R);
  const tg = raySphereNear(oy, dh, dy, EARTH_R);
  if (tg > 0) tmax = tg;
  if (tmax <= 0) return out.setRGB(0, 0, 0);
  const mu = dir.dot(sunDir);
  const phR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g = mieG;
  const phM = ((3 / (8 * Math.PI)) * ((1 - g * g) * (1 + mu * mu))) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
  const N = 10;
  // multiple-scattering illuminant: sun transmittance above the aerosol layer (bluish)
  const odMs = opticalDepth(0, EARTH_R + MS_ALT, Math.sqrt(Math.max(0, 1 - sunDir.y * sunDir.y)), sunDir.y, 8, odTmp);
  let TmsR = 0, TmsG = 0, TmsB = 0;
  if (odMs) {
    const mieMs = (BETA_MS + BETA_MA) * haze * odMs[1];
    TmsR = Math.exp(-(BETA_R[0] * odMs[0] + mieMs + BETA_O[0] * odMs[2]));
    TmsG = Math.exp(-(BETA_R[1] * odMs[0] + mieMs + BETA_O[1] * odMs[2]));
    TmsB = Math.exp(-(BETA_R[2] * odMs[0] + mieMs + BETA_O[2] * odMs[2]));
  }
  let odR = 0, odM = 0, odO = 0;
  let Lr = 0, Lg = 0, Lb = 0;
  let tPrev = 0;
  // sun direction in the 2D plane: we need the 3D geometry for the sun ray from sample points. Sample points lie
  // in the plane spanned by up and dir; the sun ray from a point p goes along sunDir. Compute in 3D.
  const px0 = 0, pz0 = 0;
  for (let i = 1; i <= N; i++) {
    const f = i / N;
    const t = tmax * f * f;
    const ds = t - tPrev;
    const tm = 0.5 * (t + tPrev);
    tPrev = t;
    // sample point in 3D (earth centre at origin)
    const sx = px0 + dir.x * tm;
    const sy = oy + dir.y * tm;
    const sz = pz0 + dir.z * tm;
    const r = Math.sqrt(sx * sx + sy * sy + sz * sz);
    const h = r - EARTH_R;
    const dd = densities(h);
    const d = [dd[0], dd[1], dd[2]];
    odR += d[0] * ds;
    odM += d[1] * ds;
    odO += d[2] * ds;
    const mieV = (BETA_MS + BETA_MA) * haze * odM;
    const Tvr = Math.exp(-(BETA_R[0] * odR + mieV + BETA_O[0] * odO));
    const Tvg = Math.exp(-(BETA_R[1] * odR + mieV + BETA_O[1] * odO));
    const Tvb = Math.exp(-(BETA_R[2] * odR + mieV + BETA_O[2] * odO));
    // sun optical depth from the sample: reduce to 2D in the plane (sample point, sun dir)
    // radial unit = sample/r; the sun ray's radial component:
    const cosZ = (sx * sunDir.x + sy * sunDir.y + sz * sunDir.z) / r;
    const sinZ = Math.sqrt(Math.max(0, 1 - cosZ * cosZ));
    const ods = opticalDepth(0, r, sinZ, cosZ, 8, odTmp);
    let Tsr = 0, Tsg = 0, Tsb = 0;
    if (ods) {
      const mieS = (BETA_MS + BETA_MA) * haze * ods[1];
      Tsr = Math.exp(-(BETA_R[0] * ods[0] + mieS + BETA_O[0] * ods[2]));
      Tsg = Math.exp(-(BETA_R[1] * ods[0] + mieS + BETA_O[1] * ods[2]));
      Tsb = Math.exp(-(BETA_R[2] * ods[0] + mieS + BETA_O[2] * ods[2]));
    }
    const msVis = smoothstep(-0.1, 0.15, cosZ);
    const mieSc = BETA_MS * haze * d[1];
    const scR = BETA_R[0] * d[0] * phR + mieSc * phM;
    const scG = BETA_R[1] * d[0] * phR + mieSc * phM;
    const scB = BETA_R[2] * d[0] * phR + mieSc * phM;
    const msR = (BETA_R[0] * d[0] + mieSc) * (MS_GAIN / (4 * Math.PI)) * msVis * (0.15 * Math.sqrt(Tsr + 0.02) + 0.85 * TmsR);
    const msG = (BETA_R[1] * d[0] + mieSc) * (MS_GAIN / (4 * Math.PI)) * msVis * (0.15 * Math.sqrt(Tsg + 0.02) + 0.85 * TmsG);
    const msB = (BETA_R[2] * d[0] + mieSc) * (MS_GAIN / (4 * Math.PI)) * msVis * (0.15 * Math.sqrt(Tsb + 0.02) + 0.85 * TmsB);
    Lr += (scR * Tsr + msR) * Tvr * ds;
    Lg += (scG * Tsg + msG) * Tvg * ds;
    Lb += (scB * Tsb + msB) * Tvb * ds;
  }
  out.r = Lr * SUN_IRRADIANCE.x * SKY_GAIN;
  out.g = Lg * SUN_IRRADIANCE.y * SKY_GAIN;
  out.b = Lb * SUN_IRRADIANCE.z * SKY_GAIN;
  horizonWhiten(out, dy, mu, haze, sunDir.y);
  return out.add(twilightSky(dir, sunDir, twilightTmp));
}
const twilightTmp = new THREE.Color();

export function smoothstep(a: number, b: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** GLSL: the same model, used by the sky LUT pass. Expects uniforms declared by the caller (see sky.ts). */
export const SCATTER_GLSL = /* glsl */ `
const float EARTH_R = 6360e3;
const float ATMO_R = 6460e3;
const vec3 BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float BETA_MS = 3.996e-6;
const float BETA_MA = 4.4e-6;
const vec3 BETA_O = vec3(0.65e-6, 1.881e-6, 0.085e-6);
const float H_R = 8000.0;
const float H_M = 1200.0;
const float PI_ = 3.14159265;
const float MS_ALT = 4000.0;

float raySphereFar(vec3 o, vec3 d, float R) {
  float b = dot(o, d);
  float c = dot(o, o) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b + sqrt(disc);
}
float raySphereNear(vec3 o, vec3 d, float R) {
  float b = dot(o, d);
  float c = dot(o, o) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  return -b - sqrt(disc);
}
vec3 atmoDensities(float h) {
  return vec3(exp(-h / H_R), exp(-h / H_M), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0));
}
vec3 atmoExtinction(vec3 od, float haze) {
  return BETA_R * od.x + (BETA_MS + BETA_MA) * haze * od.y + BETA_O * od.z;
}
// optical depth from p toward the sun (6 samples, quadratic spacing). w = 0 when the earth blocks the sun.
vec4 opticalDepthToSun(vec3 p, vec3 s) {
  float tg = raySphereNear(p, s, EARTH_R);
  if (tg > 0.0) return vec4(0.0, 0.0, 0.0, 0.0);
  float tmax = raySphereFar(p, s, ATMO_R);
  vec3 od = vec3(0.0);
  float tPrev = 0.0;
  for (int i = 1; i <= 6; i++) {
    float f = float(i) / 6.0;
    float t = tmax * f * f;
    float tm = 0.5 * (t + tPrev);
    float ds = t - tPrev;
    tPrev = t;
    vec3 q = p + s * tm;
    od += atmoDensities(length(q) - EARTH_R) * ds;
  }
  return vec4(od, 1.0);
}
float phaseRayleigh(float mu) { return 3.0 / (16.0 * PI_) * (1.0 + mu * mu); }
float phaseMie(float mu, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * PI_) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}
float phaseHG(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI_ * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

// aerosol multiple scattering whitens the horizon band (see horizonWhiten in scattering.ts)
vec3 horizonWhiten(vec3 L, float dy, float mu, float haze, float sunY) {
  float low = 1.0 - smoothstep(0.1, 0.45, sunY);
  float w = min(0.9, (0.4 + 0.12 * min(haze, 3.0)) * (1.0 + 0.5 * low)) * (1.0 - smoothstep(0.0, 0.22, dy)) * (1.0 - 0.7 * smoothstep(0.3, 0.9, mu));
  float l = dot(L, vec3(0.2126, 0.7152, 0.0722));
  return mix(L, l * mix(vec3(0.96, 0.985, 1.05), vec3(0.78, 0.93, 1.25), low), w);
}
// twilight sky (see twilightSky in scattering.ts): the same curve on the CPU feeds uSkyColor/uHorizonColor
vec3 twilightSky(vec3 dir, vec3 sunDir) {
  float elDeg = asin(clamp(sunDir.y, -1.0, 1.0)) * 57.29578;
  float dep = max(0.0, -elDeg);
  float amp = 0.18 * exp(-dep / 3.6) * (1.0 - smoothstep(2.0, 7.0, elDeg)) * smoothstep(-14.0, -9.0, elDeg);
  if (amp <= 1e-5) return vec3(0.0);
  float dy = max(dir.y, 0.0);
  float dh = length(dir.xz), sh = length(sunDir.xz);
  float cosAz = (dh > 1e-4 && sh > 1e-4) ? dot(dir.xz, sunDir.xz) / (dh * sh) : 0.0;
  float hz = pow(1.0 - dy, 3.0);
  float warm = 3.0 * pow(max(cosAz, 0.0), 4.0) * exp(-dy * 7.0) * exp(-dep / 2.5);
  float toSun = pow(max(cosAz, 0.0), 2.0);
  vec3 band = mix(vec3(0.36, 0.42, 0.62), vec3(0.62, 0.48, 0.40), toSun) * 1.6;
  return amp * (mix(vec3(0.16, 0.30, 0.62), band, hz) + vec3(1.0, 0.52, 0.22) * warm);
}

// single + approximate multiple scattering along dir from altitude alt. Returns radiance (before sun irradiance scale).
vec3 skyInscatter(vec3 dir, float alt, vec3 sunDir, float haze, float mieG, float msGain, out vec3 transmittance) {
  vec3 o = vec3(0.0, EARTH_R + alt, 0.0);
  float tmax = raySphereFar(o, dir, ATMO_R);
  float tg = raySphereNear(o, dir, EARTH_R);
  if (tg > 0.0) tmax = tg;
  float mu = dot(dir, sunDir);
  float phR = phaseRayleigh(mu);
  float phM = phaseMie(mu, mieG);
  // multiple-scattering illuminant: sun transmittance above the aerosol layer (bluish, not the reddened ground sun)
  vec4 odMs = opticalDepthToSun(vec3(0.0, EARTH_R + MS_ALT, 0.0), sunDir);
  vec3 Tms = exp(-atmoExtinction(odMs.xyz, haze)) * odMs.w;
  vec3 odView = vec3(0.0);
  vec3 L = vec3(0.0);
  float tPrev = 0.0;
  for (int i = 1; i <= 16; i++) {
    float f = float(i) / 16.0;
    float t = tmax * f * f;
    float ds = t - tPrev;
    float tm = 0.5 * (t + tPrev);
    tPrev = t;
    vec3 p = o + dir * tm;
    float r = length(p);
    float h = r - EARTH_R;
    vec3 dens = atmoDensities(h);
    odView += dens * ds;
    vec3 Tview = exp(-atmoExtinction(odView, haze));
    vec4 odSun = opticalDepthToSun(p, sunDir);
    vec3 Tsun = exp(-atmoExtinction(odSun.xyz, haze)) * odSun.w;
    float cosZ = dot(p / r, sunDir);
    float msVis = smoothstep(-0.1, 0.15, cosZ);
    float mieSc = BETA_MS * haze * dens.y;
    vec3 sc = (BETA_R * dens.x * phR + mieSc * phM) * Tsun;
    vec3 ms = (BETA_R * dens.x + mieSc) * (msGain / (4.0 * PI_)) * msVis * (0.15 * sqrt(Tsun + 0.02) + 0.85 * Tms);
    L += (sc + ms) * Tview * ds;
  }
  transmittance = exp(-atmoExtinction(odView, haze));
  return L;
}
`;
