import{n as e}from"./quality-BuEwAkMy.js";import{f as t,p as n}from"./index-DQv-X5z6.js";import{Et as r,Hn as i,K as a,Or as o,Ot as s,Pt as c,Yn as l,Z as u,_t as d,ar as f,g as p,gt as m,h,kr as g,kt as _,rt as v,tt as y,w as b,y as x}from"./textureRelease-2U-gT89r.js";import{t as S}from"./loading-DS_gLujL.js";import{a as C}from"./geo-Db9f_zPw.js";import{t as w}from"./list-YlYpUYLh.js";import{d as T,i as E,n as D,o as O,p as k,s as A,t as j,u as M}from"./styles-CD9VAM0e.js";import{a as N,i as P,l as F,o as ee,r as I,s as L,t as R,u as te}from"./polygon-BtfRVykj.js";import{t as ne}from"./transfer-CN3_6JL-.js";import{a as re,i as z,n as B,r as V,t as H}from"./builder-Ct8y1lc-.js";import{i as U,n as W,r as G,t as ie}from"./windows-DHBrnuBG.js";var ae=`
attribute vec4 aInfo;
attribute vec4 aWall;
attribute vec3 color;
varying vec2 vUvM;
varying vec4 vInfo;
varying vec4 vWall;
varying vec3 vTint;
varying vec3 vWPos;
varying vec3 vWNorm;
`,oe=`
vUvM = uv;
vInfo = aInfo;
vWall = aWall;
vTint = color;
vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
vWNorm = normalize(mat3(modelMatrix) * normal);
`,K=`
// coated architectural glass seen at skyline range: 20-35 % tinted reflectance (skyline-hudson 1-2)
vec3 lodGlassF0(vec3 tint) { return mix(vec3(0.08), tint, 0.62); }
// mechanical crown on glass towers of 80 m and more: the top two floors read as a louvred band, not glazing,
// which is what gives the skyline its capped silhouettes (skyline-hudson 1-2, skyline-east 3)
float lodCrownBand(float v, float H, float floorH) { return step(80.0, H) * step(H - 2.0 * floorH - 0.3, v); }
vec3 lodLouvre(vec3 base, float v, float fwV) {
  float slat = 0.5 + 0.5 * sin(v * 6.2831853 / 0.15);
  return base * mix(0.72 + 0.28 * slat, 0.86, smoothstep(0.05, 0.3, fwV));
}
vec3 lodShaftTint(uint seed, vec3 stone) {
  float k = hash2(seed, 17u);
  vec3 b = k < 0.5 ? vec3(0.62, 0.5, 0.38) : k < 0.8 ? vec3(0.46, 0.27, 0.2) : vec3(0.56, 0.52, 0.45);
  return mix(stone, b, 0.75);
}
// LOD window lights: per window while bays resolve, then per floor (offices: whole floors on or off, homes: a
// floor mean that differs floor to floor), then a per-building mean so a skyline of unresolved towers is
// never one uniform glow (docs/ART_DIRECTION.md §8). fwU/fwV: pixel footprint in bays / floors.
float lodWindowLit(int style, uint seed, uint wid, uint fl, float litFrac, float fwU, float fwV) {
  // Masonry openings occupy only part of a bay/floor. Average their on/off states before the openings
  // shrink to 1-2 pixels, and require BOTH axes to resolve before restoring individual windows.
  float resU = 1.0 - smoothstep(0.08, 0.25, fwU);
  float resV = 1.0 - smoothstep(0.1, 0.35, fwV);
  float bldg = litFrac * (0.55 + 0.9 * hash2(seed, 910u));
  if (hash2(seed, 911u) < 0.12) bldg *= 0.3;
  float floorMean;
  if (officeStyle(style)) {
    float floorP = clamp(litFrac * 1.8, 0.0, 1.0);
    float floorOn = step(hash3(seed, 900u, fl), floorP);
    floorMean = floorOn * litFrac / max(floorP, 0.001) * 0.9;
  } else floorMean = litFrac * (0.6 + 0.8 * hash3(seed, 912u, fl));
  float perWin = windowLit(style, seed, wid, fl, litFrac);
  return mix(mix(min(bldg, 0.85), floorMean, resV), perWin, resU * resV);
}
`,se=`
uniform vec4 uStyle[33];
uniform float uNight;
uniform float uTime;
uniform float uWet;
uniform float uDetailDist;
uniform float uEmissive;
uniform sampler2D uSignAtlas;
uniform float uSignRows;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
#ifdef USE_FACADE_TEX
uniform sampler2D uTexBrick;
uniform sampler2D uTexBrickN;
uniform sampler2D uTexStone;
uniform sampler2D uTexConcrete;
uniform sampler2D uTexRoof;
uniform vec4 uTexScale; // 1/physical size (m) of brick, stone, concrete, roof
uniform vec4 uTexScaleY; // vertical physical sizes (rectangular scans are not square tiles)
uniform vec3 uTexBrickMean; // linear mean colour of the brick scan
uniform float uTexBrickNK; // brick normal-map strength (0 = not loaded)
#endif
varying vec2 vUvM;
varying vec4 vInfo;
varying vec4 vWall;
varying vec3 vTint;
varying vec3 vWPos;
varying vec3 vWNorm;

${M}
${U}
${W}
${K}

float hashf(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashf(i), hashf(i + vec2(1, 0)), f.x), mix(hashf(i + vec2(0, 1)), hashf(i + vec2(1, 1)), f.x), f.y);
}
float fbm3(vec2 p) { return vnoise(p) * 0.5 + vnoise(p * 2.03) * 0.3 + vnoise(p * 4.1) * 0.2; }
/** Box-filter one non-repeating band [lo, hi] over a pixel footprint f, in the same units as x. Keeps a
 * 14 cm sill or a coping line from flickering once it is thinner than a pixel; it fades to its mean instead. */
float bandCov(float x, float lo, float hi, float f) {
  float w = max(f, 1e-5);
  return clamp((min(hi, x + w * 0.5) - max(lo, x - w * 0.5)) / w, 0.0, 1.0);
}

struct Surf { vec3 alb; float rough; float metal; vec3 n; vec3 emis; float ao; vec3 spec; float specMix; };
// coated architectural glass: reflectance 13-26 %, tinted by the coating (blue / green / bronze / grey per building)
vec3 glassF0(vec3 tint) { return mix(vec3(0.06), tint, 0.3); }

// ---------------------------------------------------------------------------------------------------------
// masonry patterns (metres). tilt = normal tilt along (u, v)
// ---------------------------------------------------------------------------------------------------------
vec3 brickPattern(vec2 uv, vec3 tint, bool painted, float fade, float fwm, out vec2 tilt, out float rough, out vec3 brickVar) {
  const float BW = ${D.brick[0]}, BH = ${D.brick[1]}, MJ = 0.005; // 8 x 2 5/8 in brick, 3/8 in joint (half per side)
  float row = floor(uv.y / BH);
  float shift = mod(row, 2.0) * 0.5;
  float bx = uv.x / BW + shift;
  float bi = floor(bx);
  vec2 f = vec2(fract(bx) * BW, fract(uv.y / BH) * BH); // metres inside the cell
  // anti-aliased joint mask (>= 1 px wide): the courses read as fine light lines at street distance
  float aa = max(fwm * 0.6, 0.003);
  float jx = smoothstep(MJ - aa, MJ + aa, f.x) * (1.0 - smoothstep(BW - MJ - aa, BW - MJ + aa, f.x));
  float jy = smoothstep(MJ - aa, MJ + aa, f.y) * (1.0 - smoothstep(BH - MJ - aa, BH - MJ + aa, f.y));
  float inBrick = jx * jy;
  float hb = hashf(vec2(bi, row));
  float hb2 = hashf(vec2(bi * 1.7, row * 0.3 + 7.0));
  float wpatch = fbm3(uv * vec2(0.45, 0.9)); // repointed / weathered patches
  // Kiln variation changes hue as well as value; retain occasional clinker and pale underfired bricks.
  brickVar = (0.74 + 0.46 * hb) * (0.88 + 0.24 * wpatch) * mix(vec3(1.0), vec3(1.10, 0.92, 0.86), hb2 * 0.7);
  if (hb2 > 0.92) brickVar *= 0.6;
  else if (hb2 < 0.06) brickVar *= 1.18;
  // Metre-scale repairs / spalling remain visible even when individual courses fade out.
  float blotch = fbm3(uv * vec2(0.45, 0.55) + 11.0);
  vec3 blotchTint = mix(vec3(1.0), vec3(0.80, 0.86, 0.92), smoothstep(0.58, 0.78, blotch));
  blotchTint *= mix(vec3(1.0), vec3(1.18, 1.02, 0.90), 1.0 - smoothstep(0.28, 0.46, blotch));
  brickVar *= blotchTint * (0.94 + 0.12 * vnoise(uv * 45.0));
  vec3 bc = tint * brickVar;
  vec3 mortar = vec3(0.58, 0.56, 0.52) * (0.72 + 0.3 * vnoise(uv * 33.0)) * (0.85 + 0.3 * wpatch);
  if (painted) {
    // paint over brick: joints nearly filled, chalky weathering, a little brick showing through chips
    bc = tint * (0.95 + 0.08 * hb) * (0.9 + 0.14 * wpatch);
    if (hb2 > 0.965) bc *= 0.7;
    mortar = tint * 0.86;
  }
  vec3 avg = mix(mortar, tint * (painted ? vec3(1.0) : blotchTint), painted ? 0.95 : 0.84);
  vec3 col = mix(mix(mortar, bc, inBrick), avg, fade);
  // bevelled brick edges -> normal tilt (mortar recessed)
  float tu = smoothstep(MJ + 0.012, MJ, f.x) * step(MJ, f.x) - smoothstep(BW - MJ - 0.012, BW - MJ, f.x);
  float tv = smoothstep(MJ + 0.01, MJ, f.y) * step(MJ, f.y) - smoothstep(BH - MJ - 0.01, BH - MJ, f.y);
  tilt = vec2(-tu, -tv) * 0.5 * (1.0 - fade) * inBrick;
  rough = mix(0.92, 0.78, inBrick * (painted ? 0.9 : 0.35));
  return col;
}

// Coursed limestone ashlar (fifth-42nd 1-3, upper-west 6): 60 x 30 cm blocks with hairline joints, each block its
// own tone and a faint warm / cool cast from the quarry bed. Rusticated courses are taller with deep horizontal
// channels (wide chamfers) and nearly flush vertical joints, the course above shading the top of each block.
vec3 stonePattern(vec2 uv, vec3 tint, bool rusticated, float fade, out vec2 tilt, out float rough) {
  float BW = rusticated ? 0.9 : ${D.stone[0]}, BH = rusticated ? 0.45 : ${D.stone[1]};
  float jointX = rusticated ? 0.012 : 0.006, jointY = rusticated ? 0.05 : 0.006;
  float row = floor(uv.y / BH);
  float shift = mod(row, 2.0) * 0.5;
  float bx = uv.x / BW + shift;
  float bi = floor(bx);
  vec2 f = vec2(fract(bx), fract(uv.y / BH));
  vec2 jw = vec2(jointX / BW, jointY / BH);
  vec2 aa = max(fwidth(uv) / vec2(BW, BH), vec2(0.001));
  float inBlock = smoothstep(jw.x - aa.x, jw.x + aa.x, f.x) * smoothstep(jw.y - aa.y, jw.y + aa.y, f.y);
  float hb = hashf(vec2(bi, row) + 3.1);
  float hb2 = hashf(vec2(bi * 0.7 + 5.0, row * 1.3));
  vec3 bedCast = mix(vec3(1.03, 1.0, 0.95), vec3(0.97, 0.99, 1.03), hb2);
  vec3 bc = tint * (0.91 + 0.15 * hb) * bedCast * (0.95 + 0.1 * fbm3(uv * 6.0)) * (0.97 + 0.06 * vnoise(uv * 90.0));
  // weathering mottle and the odd sooty block
  bc *= 1.0 - 0.12 * smoothstep(0.6, 0.9, fbm3(uv * vec2(0.8, 1.6) + 4.0));
  if (hb2 > 0.94) bc *= 0.88;
  vec3 mortar = tint * (rusticated ? 0.32 : 0.72);
  vec3 col = mix(mix(mortar, bc, inBlock), tint, fade);
  // chamfered arrises: rustication is a 4 cm channel with 3 cm chamfers, ashlar a hairline
  float bevX = rusticated ? 0.03 : 0.015, bevY = rusticated ? 0.09 : 0.03;
  float tu = smoothstep(jw.x + bevX, jw.x, f.x) * step(jw.x, f.x) - smoothstep(1.0 - bevX, 1.0, f.x);
  float tv = smoothstep(jw.y + bevY, jw.y, f.y) * step(jw.y, f.y) - smoothstep(1.0 - bevY, 1.0, f.y);
  tilt = vec2(-tu * (rusticated ? 0.5 : 0.35), -tv * (rusticated ? 1.3 : 0.35)) * (1.0 - fade) * inBlock;
  if (rusticated) col *= 1.0 - 0.35 * smoothstep(0.8, 1.0, f.y) * (1.0 - fade);
  rough = 0.82;
  return col;
}

// Brownstone: a sandstone veneer with joints too tight to read, horizontal bedding grain, and the face flaking
// off in irregular spalls that expose the lighter orange stone inside a dark rim (stoops-1, upper-west 1).
// Painted fronts keep the spalls as blisters under the paint.
vec3 brownstonePattern(vec2 uv, vec3 tint, bool painted, float wear, float fade, out vec2 tilt, out float rough) {
  const float BW = ${D.stone[0]}, BH = ${D.stone[1]};
  float row = floor(uv.y / BH);
  float bx = uv.x / BW + mod(row, 2.0) * 0.5;
  float bi = floor(bx);
  vec2 f = vec2(fract(bx), fract(uv.y / BH));
  vec2 jw = vec2(0.004 / BW, 0.004 / BH);
  vec2 aa = max(fwidth(uv) / vec2(BW, BH), vec2(0.001));
  float inBlock = smoothstep(jw.x - aa.x, jw.x + aa.x, f.x) * smoothstep(jw.y - aa.y, jw.y + aa.y, f.y);
  float hb = hashf(vec2(bi, row) + 9.2);
  float grain = vnoise(uv * vec2(3.0, 40.0));
  float wash = fbm3(uv * vec2(0.7, 0.25));
  // spalls: a few hand-sized flakes on a restored front, a third of the face on a neglected one (wear 0..1)
  vec2 sq = uv * vec2(3.2, 2.4) + 17.0;
  float sp = fbm3(sq), spx = fbm3(sq + vec2(0.06, 0.0)), spy = fbm3(sq + vec2(0.0, 0.06));
  float th = mix(0.74, 0.62, wear);
  float spall = smoothstep(th, th + 0.04, sp);
  float rim = smoothstep(th - 0.05, th, sp) * (1.0 - spall);
  vec3 bc;
  if (painted) {
    bc = tint * (0.96 + 0.06 * hb) * (0.94 + 0.1 * wash);
    bc *= 1.0 - 0.18 * spall - 0.1 * rim;
  } else {
    bc = tint * (0.94 + 0.1 * hb) * (0.93 + 0.12 * grain) * (0.88 + 0.24 * wash);
    bc = mix(bc, tint * vec3(1.12, 1.04, 0.96) * (0.9 + 0.25 * vnoise(uv * 25.0)), spall * 0.6);
    bc *= 1.0 - 0.3 * rim;
  }
  vec3 mortar = tint * 0.8;
  vec3 col = mix(mix(mortar, bc, painted ? 1.0 : inBlock), tint, fade);
  // the spall edge is a 1-2 cm step: normal from the noise gradient, strongest on the rim
  tilt = vec2(sp - spx, sp - spy) * 12.0 * rim * (1.0 - fade);
  rough = painted ? mix(0.6, 0.8, spall) : mix(0.85, 0.95, spall);
  return col;
}

// prewar office shaft brick over a stone base: buff / tan, red-brown, or grey-buff
vec3 shaftTint(uint seed, vec3 stone) {
  float k = hash2(seed, 17u);
  vec3 b = k < 0.5 ? vec3(0.62, 0.5, 0.38) : k < 0.8 ? vec3(0.46, 0.27, 0.2) : vec3(0.56, 0.52, 0.45);
  return mix(stone, b, 0.75);
}

vec3 concretePattern(vec2 uv, vec3 tint, float panelW, float panelH, float fade, out vec2 tilt, out float rough) {
  vec2 f = vec2(fract(uv.x / panelW), fract(uv.y / panelH));
  vec2 jw = vec2(0.02 / panelW, 0.02 / panelH);
  float inPanel = step(jw.x, f.x) * step(jw.y, f.y);
  vec3 c = tint * (0.9 + 0.2 * fbm3(uv * 1.7)) * (0.96 + 0.08 * vnoise(uv * 70.0));
  vec3 col = mix(mix(tint * 0.55, c, inPanel), tint, fade);
  tilt = vec2(0.0);
  rough = 0.88;
  return col;
}

vec3 cmuPattern(vec2 uv, vec3 tint, float fade, out vec2 tilt, out float rough) {
  const float BW = ${D.cmu[0]}, BH = ${D.cmu[1]};
  float row = floor(uv.y / BH);
  float bx = uv.x / BW + mod(row, 2.0) * 0.5;
  vec2 f = vec2(fract(bx), fract(uv.y / BH));
  float inB = step(0.025, f.x) * step(0.05, f.y);
  vec3 bc = tint * (0.92 + 0.14 * hashf(vec2(floor(bx), row))) * (0.95 + 0.1 * vnoise(uv * 60.0));
  vec3 col = mix(mix(tint * 0.7, bc, inB), tint, fade);
  tilt = vec2(0.0);
  rough = 0.95;
  return col;
}

vec3 corrugated(vec2 uv, vec3 tint, out vec2 tilt, out float rough, out float metal) {
  float s = sin(uv.y * 6.2831853 / 0.076);
  tilt = vec2(0.0, cos(uv.y * 6.2831853 / 0.076) * 0.5);
  vec3 c = tint * (0.82 + 0.18 * s) * (0.9 + 0.15 * fbm3(uv * 2.5));
  // rust / grime streaks
  c *= 1.0 - 0.25 * smoothstep(0.55, 0.8, fbm3(vec2(uv.x * 0.8, uv.y * 0.15)));
  rough = 0.55;
  metal = 0.7;
  return c;
}

// ---------------------------------------------------------------------------------------------------------
// Night storefront: one shared model of a shop's state so the wall, the mid LOD and the signs above it agree.
// docs/ART_DIRECTION.md §2 Night — at 22:30 the shop windows are the brightest warm planes on the block, the
// fascia lightboxes glow evenly under the emissive cap, and everything else falls into the warm skyglow.
// ---------------------------------------------------------------------------------------------------------
/** Peak emissive of a lit shop, linear. lighting.ts caps facade emission at 2.0 to keep bloom headroom, so
 *  1.80 leaves the limiter unengaged: the ceiling fixture is the brightest pixel and it never clips white. */
const float SHOP_LAMP_PEAK = 1.80;
/** Even face of a fascia lightbox, linear. Same ceiling, reached by the diffuser rather than a bare tube. */
const float SHOP_BOX_PEAK = 1.62;
const float SIGN_NAME_ROWS = 16.0;
const float SIGN_NEON_ROWS = 6.0;

/** Interior lights on: nearly every shop with its gate up is open or at least lit at 22:30; the rest keep a
 *  security light, which the callers add separately. Returns 0..1 (day value is lower: daylight dominates). */
float shopLitState(uint seed, uint wallIdx, uint sid, float night) {
  float k = hash4(seed, 28u, wallIdx, sid);
  return mix(step(k, 0.85) * 0.35, step(k, 0.82), smoothstep(0.1, 0.5, night));
}
/** Roll gate down on ~40 % of shops after dark, ~6 % by day (deliveries, a vacancy). */
float shopGateDown(uint seed, uint wallIdx, uint sid, float night) {
  return step(hash4(seed, 22u, wallIdx, sid), mix(0.06, 0.40, smoothstep(0.2, 0.8, night)));
}
/** Per-shop fixture: a deli or laundromat runs 4000 K tubes, a cafe or bar 2700 K lamps. Never neutral white
 *  — a block where every shop is the same temperature is the tell (docs/ART_DIRECTION.md §8). */
vec3 shopLampColor(uint seed, uint wallIdx, uint sid) {
  float w = hash4(seed, 41u, wallIdx, sid);
  return w < 0.42 ? vec3(1.0, 0.76, 0.50) : w < 0.78 ? vec3(1.0, 0.88, 0.70) : vec3(0.80, 0.90, 1.0);
}
/** Neon accent colour: the classic tubes are red, warm pink and cobalt. */
vec3 shopNeonColor(uint seed, uint wallIdx, uint sid) {
  float k = hash4(seed, 43u, wallIdx, sid);
  return k < 0.45 ? vec3(1.0, 0.10, 0.06) : k < 0.75 ? vec3(0.22, 0.42, 1.0) : vec3(1.0, 0.22, 0.55);
}

/**
 * Distance along d to the near or far plane of an axis slab, guarding a near-zero component WITHOUT losing its
 * sign. The old guard forced the denominator positive, so a ray running nearly parallel to a wall or the
 * ceiling produced a large NEGATIVE t; that t won the min(), and the whole interior collapsed to one garbage
 * sample. It happens exactly when the camera faces a shopfront square on, which is the frame that matters.
 */
float slabHit(float p, float dc, float hiPlane, float loPlane) {
  float sgn = dc >= 0.0 ? 1.0 : -1.0;
  float den = abs(dc) < 1e-4 ? sgn * 1e-4 : dc;
  return ((dc > 0.0 ? hiPlane : loPlane) - p) / den;
}

// window interior (room box) + blinds/curtains. Returns colour seen through the glass; emissive in emis.
vec3 roomInterior(vec3 p, vec3 d, float roomW, float roomH, float depth, vec3 light, float lit, uint wid, uint seed, out vec3 emis) {
  // p: (x from column centre, y from the floor, 0), d: ray direction into the room (d.z < 0)
  float tz = (-depth) / min(d.z, -0.02);
  float tx = slabHit(p.x, d.x, roomW * 0.5, -roomW * 0.5);
  float ty = slabHit(p.y, d.y, roomH, 0.0);
  float t = min(tz, min(tx, ty));
  vec3 hit = p + d * t;
  float dz = clamp(-hit.z / depth, 0.0, 1.0);
  vec3 col;
  float h1 = hash3(seed, wid, 91u), h2 = hash3(seed, wid, 92u);
  vec3 wallCol = mix(vec3(0.85, 0.8, 0.72), vec3(0.75, 0.78, 0.8), h1);
  if (t == tz) {
    col = wallCol * 0.75;
    // something on the back wall: a bookshelf / poster / cabinet band
    float px = hit.x + roomW * 0.5;
    float band = step(0.3, px) * step(px, roomW * 0.5 + 0.2 * h2) * step(0.9, hit.y) * step(hit.y, 1.9);
    col = mix(col, vec3(0.45, 0.32, 0.22) * (0.8 + 0.4 * h2), band * step(0.4, h1));
  } else if (t == ty) {
    col = d.y > 0.0 ? vec3(0.9, 0.88, 0.85) : vec3(0.42, 0.34, 0.26) * (0.9 + 0.2 * h2);
  } else {
    col = wallCol * 0.6;
  }
  // day: room lit by the window (bright near, dark deep). night: ceiling light if lit
  float dayL = mix(0.55, 0.12, dz) * (1.0 - uNight * 0.95);
  float nightL = lit * mix(1.0, 0.55, dz) * (t == ty && d.y > 0.0 ? 1.4 : 1.0);
  vec3 c = col * (dayL + nightL * light);
  // A screen on in roughly a fifth of the lit rooms. Every set runs at its own rate and phase, and every few
  // seconds a cut throws a different colour on the wall, so a wall of flats never blinks in unison
  // (docs/ART_DIRECTION.md §8, "uniform lit windows").
  if (lit > 0.5 && h2 > 0.82 && t == tz) {
    float tv = step(abs(hit.x - (h1 - 0.5) * roomW * 0.5), 0.6) * step(0.9, hit.y) * step(hit.y, 1.6);
    float rate = 5.0 + 7.0 * h1;
    float ph = h2 * 37.0;
    float fl = 0.45 + 0.55 * vnoise(vec2(uTime * rate + ph, h1 * 10.0));
    // a scene cut every 2-5 s: the colour of the light in the room changes, not just its level
    float cut = floor(uTime / (2.0 + 3.0 * h1) + ph);
    float ch = hashf(vec2(cut, ph));
    vec3 tint2 = ch < 0.45 ? vec3(0.45, 0.58, 1.0) : ch < 0.75 ? vec3(0.75, 0.75, 0.95) : ch < 0.92 ? vec3(1.0, 0.72, 0.45) : vec3(0.5, 1.0, 0.7);
    c += tv * tint2 * fl * (1.3 + 0.9 * ch);
  }
  emis = c * lit;
  return c;
}

// Shop interior: one room per shopfront behind the glass, ray-marched against the flat wall quad.
// p: (x from the glazed bay centre, y above the sidewalk, 0), d into the shop (d.z < 0).
// Night model (docs/ART_DIRECTION.md §2, west-village 6, east-village 2, 6): the ceiling troffers ARE the
// light source, everything else is lit by them and falls off with depth, so a deep shop goes dark at the back
// instead of glowing evenly. Returns the colour seen through the glass; linear emissive radiance in emis.
vec3 shopInterior(vec3 p, vec3 d, float roomW, float roomH, float depth, float lit, vec3 lampC, uint sid, uint seed, out vec3 emis) {
  float tz = (-depth) / min(d.z, -0.02);
  float tx = slabHit(p.x, d.x, roomW * 0.5, -roomW * 0.5);
  float ty = slabHit(p.y, d.y, roomH, 0.0);
  float t = min(tz, min(tx, ty));
  int face = t == ty ? 1 : (t == tz ? 0 : 2); // 0 back wall, 1 ceiling/floor, 2 side wall, 3 counter
  vec3 hit = p + d * t;
  float k1 = hash3(seed, sid, 95u), k2 = hash3(seed, sid, 96u);
  float k3 = hash3(seed, sid, 97u), k4 = hash3(seed, sid, 98u);
  // a service counter 2.2-3.8 m in, running most of the width: the mass that stops a shop reading as a box
  float cD = 2.2 + 1.6 * k3;
  if (k3 < 0.62) {
    float tc = (-cD) / min(d.z, -0.02);
    vec3 hc = p + d * tc;
    if (tc > 0.0 && tc < t && hc.y < 1.05 && hc.y > 0.0 && hc.x > -roomW * 0.5 && hc.x < roomW * (0.05 + 0.35 * k4)) {
      t = tc; hit = hc; face = 3;
    }
  }
  float dz = clamp(-hit.z / depth, 0.0, 1.0);
  vec3 wallCol = k1 < 0.4 ? vec3(0.85, 0.82, 0.74) : k1 < 0.7 ? vec3(0.62, 0.64, 0.6) : vec3(0.3, 0.28, 0.26);
  bool shelves = k2 < 0.65;
  vec3 col;
  float glow = 0.0;   // 1 on a fixture face: this pixel is the lamp itself
  float lambert = 1.0; // how much of the ceiling this face can see
  if (face == 1) {
    if (d.y > 0.0) {
      // ceiling: white tile with recessed fluorescent troffers on a 1.8 m grid
      col = vec3(0.88, 0.87, 0.84);
      vec2 g = vec2(fract(hit.x / 1.8), fract(-hit.z / 1.8));
      float fixture = step(abs(g.x - 0.5), 0.17) * step(abs(g.y - 0.5), 0.33);
      col = mix(col, vec3(1.0, 0.98, 0.92), fixture);
      // the tile around a troffer is washed by it; the tile between two of them is not
      float near = (1.0 - smoothstep(0.17, 0.42, abs(g.x - 0.5))) * (1.0 - smoothstep(0.33, 0.5, abs(g.y - 0.5)));
      lambert = 0.30 + 0.55 * near;
      glow = fixture;
    } else {
      // floor: 0.3 m tile checker, worn; it only sees the ceiling
      float ch = mod(floor(hit.x / 0.3) + floor(-hit.z / 0.3), 2.0);
      col = mix(vec3(0.5, 0.48, 0.44), vec3(0.32, 0.31, 0.3), ch) * (0.85 + 0.3 * vnoise(hit.xz * 3.0));
      lambert = 0.85;
    }
  } else if (face == 3) {
    // counter front and top: laminate or dark wood, with the till end brighter
    col = k4 < 0.5 ? vec3(0.62, 0.58, 0.5) : vec3(0.26, 0.19, 0.14);
    col *= 0.85 + 0.3 * vnoise(vec2(hit.x * 6.0, hit.y * 6.0));
    col = mix(col, vec3(0.72, 0.70, 0.66), step(1.0, hit.y)); // the counter top catching the ceiling
    lambert = mix(0.55, 1.0, step(1.0, hit.y));
  } else {
    // back / side walls: shelving stocked with product (0.4 m rows, 0.5 m facings) or plain paint
    col = wallCol;
    float along = face == 0 ? hit.x : -hit.z;
    lambert = face == 0 ? 0.62 : 0.7;
    if (shelves && hit.y > 0.22 && hit.y < 2.30) {
      // Gondola shelving: 0.4 m shelves with a dark board at every level, facings 0.4-0.6 m wide so the rows
      // do not line up into a checkerboard, and the goods saturated - AgX takes most of the colour out.
      float rowY = floor(max(hit.y, 0.0) / 0.4);
      float pitch = 0.4 + 0.2 * hashf(vec2(rowY, float(sid)));
      vec2 cell = vec2(floor(along / pitch + rowY * 0.37), rowY);
      float hc = hashf(cell + float(sid) * 3.7);
      float hc2 = hashf(cell * 1.3 + 17.0);
      vec3 prod = hc < 0.25 ? vec3(0.90, 0.10, 0.06) : hc < 0.45 ? vec3(0.06, 0.20, 0.72) : hc < 0.6 ? vec3(0.95, 0.72, 0.06) : hc < 0.75 ? vec3(0.08, 0.45, 0.16) : vec3(0.85, 0.82, 0.72);
      prod *= 0.45 + 0.9 * hc2;
      float shelfEdge = step(fract(hit.y / 0.4), 0.11);
      col = mix(prod, vec3(0.16, 0.15, 0.14), shelfEdge); // the shelf boards read as dark lines, not grey
      // an upstand light under each shelf: the facings are brighter than the wall behind them
      lambert = mix(0.9, 1.25, step(0.35, fract(hit.y / 0.4)));
    } else if (shelves) {
      // the plinth under the gondola and the plain wall above it: the bands that make the room a room
      bool plinth = hit.y <= 0.22;
      col = plinth ? vec3(0.10, 0.10, 0.11) : wallCol * 0.85;
      lambert = plinth ? 0.45 : 0.75;
    } else if (!shelves && hit.y > 0.30 && hit.y < 2.30) {
      // no shelving: a run of glass-door chillers or a back bar, lit from inside. A blank painted wall behind
      // the glass is what makes a shopfront read as a pale panel instead of a room (west-village 6).
      float bay = fract(along / 0.9);
      float mull = 1.0 - smoothstep(0.03, 0.07, min(bay, 1.0 - bay));
      float shelf = step(0.06, fract(hit.y / 0.55));
      col = mix(vec3(0.62, 0.70, 0.72), vec3(0.22, 0.22, 0.24), mull);
      col *= mix(0.55, 1.0, shelf);
      col *= 0.75 + 0.5 * hashf(floor(vec2(along / 0.9, max(hit.y, 0.0) / 0.55)) + float(sid));
      lambert = 1.15 * (1.0 - 0.5 * mull);
      glow = max(glow, 0.22 * (1.0 - mull) * shelf);
    } else if (!shelves) {
      col = hit.y <= 0.30 ? vec3(0.12, 0.11, 0.11) : wallCol * 0.85;
      lambert = hit.y <= 0.30 ? 0.45 : 0.75;
    }
    // an internally lit menu / lottery board over the back counter on some shops
    if (face == 0 && k4 > 0.62 && abs(hit.x - (k2 - 0.5) * roomW * 0.4) < roomW * 0.18 && hit.y > 1.9 && hit.y < 2.5) {
      col = mix(vec3(0.95, 0.92, 0.85), vec3(0.95, 0.35, 0.15), step(0.5, fract(hit.y * 5.0)));
      glow = max(glow, 0.55);
    }
  }
  // Depth falloff from the ceiling plane of fixtures: inverse-square-ish, clamped so the front is not blown.
  float fall = 1.0 / (1.0 + 1.6 * dz * dz);
  // day: window light falls off with depth and dominates; night: the fixtures do
  float dayL = mix(0.6, 0.12, dz) * (1.0 - uNight * 0.95);
  float lampL = lit * lambert * fall;
  // 1.5 puts the front product wall near 0.9 linear and the back of the shop near 0.35, so a shop window is
  // brighter than any lit apartment above it (WINDOW_LIGHT_GAIN peaks at ~1.4) and still never clips.
  vec3 c = col * (dayL + lampL * 1.5) * mix(vec3(1.0), lampC, lit);
  // the fixture face itself is the only pixel at the cap, and it REPLACES the shaded value rather than
  // adding to it, so the brightest pixel in a shop lands on 1.80 and never reaches lighting.ts's limiter
  emis = mix(c, lampC * SHOP_LAMP_PEAK, clamp(glow, 0.0, 1.0)) * lit;
  return clamp(c, 0.0, 1.0);
}

// ---------------------------------------------------------------------------------------------------------
Surf shadeWall(vec3 V, vec3 N, float detail) {
  Surf S;
  S.emis = vec3(0.0);
  S.ao = 1.0;
  S.metal = 0.0;
  S.spec = vec3(0.04);
  S.specMix = 0.0;
  float ss = vInfo.z;
  int style = int(floor(ss / 65536.0 + 1e-4));
  uint seed = uint(ss - float(style) * 65536.0 + 0.5);
  vec4 P0 = uStyle[style * 3];
  vec4 P1 = uStyle[style * 3 + 1];
  float floorH = vInfo.y;
  float winW = P0.y, winH = P0.z, sp = P0.w, sill = P1.x;
  float litFrac = P1.y * uStyle[style * 3 + 2].z; // 22:30 base x hour ramp
  float nightK = smoothstep(0.15, 0.6, uNight);
  int base = int(P1.z + 0.5);
  float rustF = P1.w;
  float u = vUvM.x, v = vUvM.y;
  float H = vInfo.x, partyH = vInfo.w, wl = vWall.x, gfH = vWall.z;
  int flags = int(vWall.y + 0.5);
  bool street = (flags & 1) != 0, commercial = (flags & 2) != 0, painted = (flags & 4) != 0;
  bool balc = (flags & 16) != 0, resDoor = (flags & 64) != 0, tier = (flags & 512) != 0;
  uint wallIdx = uint(flags / 1024);
  bool party = v < partyH - 0.05;
  vec3 tint = vTint;
  vec3 T = normalize(vec3(-N.z, 0.0, N.x));
  vec3 B = vec3(0.0, 1.0, 0.0);
  float fwU = fwidth(u), fwV = fwidth(v);
  float fw = max(fwU, fwV);

  // ---- floor / column layout -------------------------------------------------------------------------
  int fl; float fb, fh;
  if (style == 1) {
    if (v < 1.7) { fl = 0; fb = 0.0; fh = 1.7; }
    else if (v < 5.5) { fl = 1; fb = 1.7; fh = 3.8; }
    else { fl = 2 + int((v - 5.5) / floorH); fb = 5.5 + float(fl - 2) * floorH; fh = floorH; }
  } else if (v < gfH) { fl = 0; fb = 0.0; fh = gfH; }
  else { fl = 1 + int((v - gfH) / floorH); fb = gfH + float(fl - 1) * floorH; fh = floorH; }
  float fy = v - fb;
  float margin = style == 5 ? 0.0 : 0.7;
  float nCols = floor((wl - 2.0 * margin) / sp);
  float off = (wl - nCols * sp) * 0.5;
  float cu = (u - off) / sp;
  int col = int(floor(cu));
  float cx = (fract(cu) - 0.5) * sp;
  bool inCol = cu >= 0.0 && float(col) < nCols && nCols > 0.5;
  uint wid = wallIdx * 256u + uint(max(col, 0));
  bool parapet = v > H - 0.01;
  bool cwLobby = style == 5 && fl == 0 && street && resDoor && !tier && !party && gfH >= 4.5 && wl > 8.0;
  bool storefront = fl == 0 && street && commercial && !tier && !party && style != 9 && style != 10 && gfH >= 3.5 && !cwLobby;
  bool ribbon = style == 6 && hash2(seed, 8u) < 0.4;
  bool balcCol = balc && street && (col % 2 == 0) && fl > 0;

  // ---- stone-fronted styles: limestone / prewar office / civic --------------------------------------
  bool stoneStyle = style == 2 || style == 4 || style == 9;
  vec3 stoneT = vTint;
  // prewar offices: a stone base under a brick shaft (55 %), or stone / terracotta all the way up
  bool brickShaft = style == 4 && hash2(seed, 14u) < 0.55;
  int baseFloors = brickShaft ? 3 : int(rustF + 0.5);
  float baseTop = gfH + float(baseFloors - 1) * floorH;
  // the crown floor: the storey whose window is the last to fit under the tier top
  bool topFloor = stoneStyle && fl > 0 && fb + fh + sill + winH >= H - 0.35;
  bool arched = style == 9 || (topFloor && hash2(seed, 15u) < 0.6);
  bool spandrels = (style == 4 && hash2(seed, 18u) < 0.5) || (style == 2 && hash2(seed, 18u) < 0.25);

  // ---- window rectangle (absolute v) ---------------------------------------------------------------
  float wb = fb + sill, wt = fb + sill + winH, ww = winW;
  if (style == 1) { if (fl == 0) { wb = 0.45; wt = 1.35; ww = 0.9; } else if (fl == 1) { wb = fb + 0.6; wt = fb + 3.35; ww = 1.15; } }
  else if (fl == 0 && !storefront) { wb = fb + (style == 4 || style == 2 || style == 9 ? 1.2 : 1.0); wt = min(wb + winH * 1.15, fb + fh - 0.7); }
  if (ribbon) { ww = sp - 0.35; }
  if (balcCol) { wb = fb + 0.05; wt = fb + 2.3; ww = 1.7; }
  if (style == 5) { ww = sp; wb = fb + 0.9; wt = fb + fh - 0.25; }
  if (wt > fb + fh - 0.12) wt = fb + fh - 0.12;
  bool fits = wt < H - ((style == 0 || style == 1) ? 0.6 : 0.35) && wt - wb > 0.5;
  bool cwin = inCol && fits && !party && !parapet;

  // Mid view (roughly 60-400 m, where most of a street frame lives): the bay and floor grid stays, but
  // centimetre slats, room interiors and masonry units are under a pixel. Everything below is box-filtered
  // coverage of the SAME dimensions the near branch models in geometry - reveals, sills, lintels, belt
  // courses, a cornice shadow line, the shopfront course - so the facade keeps its relief without shimmering
  // and nothing shifts when a fragment crosses the LOD line (fifth-42nd 1-2, park-ave-60 1).
  if (fw > 0.16) {
    float fu = fwU / sp, fv = fwV / fh;
    float pv = (v - fb) / fh;
    float width = style == 5 ? sp - 0.09 : ww;
    float bu0 = 0.5 - width / sp * 0.5, bu1 = 0.5 + width / sp * 0.5;
    float lo = (wb - fb) / fh, hi = (wt - fb) / fh;
    bool grid = cwin && !storefront;
    int matM = (brickShaft && fl >= 3) ? 0 : base;
    float cU = windowCoverage(cu, bu0, bu1, fu);
    float cV = windowCoverage(pv, lo, hi, fv);
    float cWide = windowCoverage(cu, bu0 - 0.14 / sp, bu1 + 0.14 / sp, fu);
    float win = grid ? cU * cV : 0.0;

    // ---- wall tone: value drift, belt courses, floor bands ------------------------------------------
    vec3 wall = tint;
    if (brickShaft && fl >= 3) wall = shaftTint(seed, tint);
    // metre-scale drift: a masonry front is never one flat painted value, at any distance
    wall *= 0.90 + 0.20 * vnoise(vec2(u * 0.09, v * 0.05) + vec2(hash2(seed, 951u) * 41.0));
    if (stoneStyle && !party) {
      // rusticated base (channel shadows) capped by a moulded belt course; a string course per floor above
      wall *= 1.0 - 0.11 * bandCov(v, -1.0, baseTop - 0.45, fwV);
      wall = mix(wall, stoneT * 1.10, bandCov(v, baseTop - 0.45, baseTop, fwV) * 0.9);
      if (hash2(seed, 13u) < 0.45 && fl > baseFloors && !topFloor)
        wall = mix(wall, stoneT * 1.06, windowCoverage(pv, 0.0, 0.14 / fh, fv) * 0.8);
    }
    if (style == 7 && fl >= 1 && !party && !parapet)
      wall = mix(wall, vec3(0.62, 0.6, 0.56), windowCoverage(pv, 0.0, 0.22 / fh, fv) * step(0.5, hash2(seed, 9u)));
    if (style == 6 && !ribbon && !party)
      wall = mix(wall, tint * 0.85, windowCoverage(pv, 0.0, 0.35 / fh, fv) * 0.6);
    if (style == 0 && fl == 0 && !storefront && !party)
      wall = mix(wall, vec3(0.42, 0.4, 0.37), bandCov(v, -1.0, 0.75, fwV));

    S.n = N;
    S.alb = wall;
    S.rough = 0.85;
    if (style == 5) {
      // curtain wall at bay resolution: dark tinted vision glass against a darker spandrel band, each panel
      // its own batch (albedo) and bow (normal) so the sky reflection breaks up panel to panel
      float cwK = hash2(seed, 4u);
      float ph = hash3(seed, wid, uint(fl)), p2 = hash3(seed, wid, uint(fl) + 977u);
      vec3 vision = tint * 0.07 * (0.85 + 0.3 * hash3(seed, wid, uint(fl) + 906u));
      bool panelSp = cwK >= 0.35 && cwK < 0.7 && hash2(seed, 903u) >= 0.5;
      vec3 spandrel = panelSp ? vec3(0.13, 0.13, 0.14) : tint * (cwK < 0.35 ? 0.05 : cwK < 0.7 ? 0.055 : 0.045);
      vec3 mullC = cwK < 0.35 ? vec3(0.16, 0.13, 0.10) : cwK < 0.7 ? vec3(0.34, 0.35, 0.36) : vec3(0.2, 0.21, 0.22);
      S.alb = mix(spandrel, vision, win);
      S.rough = mix(panelSp ? 0.5 : 0.3, 0.05 + 0.1 * ph, win);
      S.metal = panelSp ? 0.6 * (1.0 - win) : 0.0;
      // the skyline-range reflectance (lodGlassF0) blends in from the near value over the detail fade
      S.spec = mix(lodGlassF0(tint), glassF0(tint), detail) * mix(0.85, 1.0, win);
      S.specMix = panelSp ? win : 1.0;
      // mullion caps: the metal grid that stops a curtain wall reading as one black sheet at 100-400 m
      float mullF = (1.0 - cU) * cV * 0.85;
      S.alb = mix(S.alb, mullC, mullF);
      S.rough = mix(S.rough, 0.45, mullF);
      S.metal = mix(S.metal, 0.7, mullF);
      S.specMix *= 1.0 - mullF;
      S.ao *= 1.0 - 0.22 * (1.0 - cV); // the transom shades the head of the glass under it
      float panel = 1.0 - smoothstep(0.35, 0.9, max(fu, fv));
      S.n = normalize(N + (T * (ph - 0.5) * 0.09 + B * (p2 - 0.5) * 0.07) * panel);
      // the crown band fades in with distance so the near shader's glazed top floors do not pop
      float crown = lodCrownBand(v, H, fh) * (1.0 - detail);
      if (crown > 0.0) {
        S.alb = mix(S.alb, lodLouvre(vec3(0.3, 0.31, 0.32), v, fwV), crown);
        S.rough = mix(S.rough, 0.55, crown); S.metal = mix(S.metal, 0.3, crown);
        S.specMix *= 1.0 - crown; S.n = normalize(mix(S.n, N, crown)); win *= 1.0 - crown;
      }
      if (cwLobby) {
        // the double-height lobby: glass under a metal fascia, lit day and night (fifth-42nd 6)
        float bGl = bandCov(v, 0.15, gfH - 0.55, fwV);
        S.alb = mix(S.alb, vec3(0.14, 0.14, 0.13), bGl);
        S.alb = mix(S.alb, mullC, bandCov(v, gfH - 0.55, gfH, fwV));
        S.emis += vec3(1.0, 0.94, 0.82) * mix(0.14, 0.78, nightK) * uEmissive * bGl;
        win *= 1.0 - bGl;
      }
      S.alb *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, 0.7, v)); // splash; the rest of a curtain wall stays clean
    } else {
      // ---- window reveal: the opening sits 15-22 cm behind the wall face. The head soffit faces down and
      // is always in shadow, the sill faces up and catches sky, and the two jambs turn sideways so the sun
      // lights one and shades the other - the depth cue a punched black square has not got.
      float rev = (style == 0 || style == 1 || style == 8) ? 0.22 : 0.17;
      float rb = rev * 0.75;
      float cHead = grid ? cU * windowCoverage(pv, hi - rb / fh, hi, fv) : 0.0;
      float cSill = grid ? cU * windowCoverage(pv, lo, lo + rb * 0.8 / fh, fv) : 0.0;
      float cJL = grid ? cV * windowCoverage(cu, bu0, bu0 + rb / sp, fu) : 0.0;
      float cJR = grid ? cV * windowCoverage(cu, bu1 - rb / sp, bu1, fu) : 0.0;
      float glazed = max(win - cHead - cSill - cJL - cJR, 0.0);
      vec3 revC = wall * 0.42;
      S.alb = mix(wall, vec3(0.055, 0.065, 0.085), glazed);
      S.alb = mix(S.alb, revC, min(1.0, cJL + cJR));
      S.alb = mix(S.alb, mix(wall, vec3(0.52, 0.50, 0.46), 0.6) * 0.82, cSill);
      S.alb = mix(S.alb, revC * 0.48, cHead);
      S.rough = mix(0.85, 0.12, glazed); // glass sharp enough to hold a sky reflection: dark blue-grey, not black
      S.spec = mix(S.spec, vec3(0.05), glazed);
      S.specMix = max(S.specMix, glazed * 0.9);

      // ---- sills and lintels as tone bands: the horizontal rhythm a photographed facade has at 200 m ---
      float sOut = 0.0, lOut = 0.0;
      if (matM == 1 || stoneStyle || style == 0 || style == 1 || style == 7 || style == 8) {
        float tk = hash2(seed, 12u);
        vec3 trimC = (matM == 1 || stoneStyle) ? stoneT * 1.05
          : style == 0 ? (tk < 0.4 ? vec3(0.4, 0.29, 0.22) : tk < 0.75 ? vec3(0.6, 0.58, 0.53) : vec3(0.78, 0.75, 0.68))
          : style == 1 ? tint * (painted ? 1.0 : 1.08) : vec3(0.7, 0.66, 0.6);
        float lintH = (style == 0 || style == 1) ? 0.28 : 0.22;
        sOut = grid ? cWide * windowCoverage(pv, lo - 0.14 / fh, lo, fv) : 0.0;
        lOut = grid ? cWide * windowCoverage(pv, hi, hi + lintH / fh, fv) : 0.0;
        S.alb = mix(S.alb, trimC, min(1.0, sOut + lOut) * 0.9);
        S.rough = mix(S.rough, 0.8, min(1.0, sOut + lOut));
        // the drip shadow a projecting sill casts on the wall right under it
        S.ao *= 1.0 - 0.35 * (grid ? cWide * windowCoverage(pv, lo - 0.26 / fh, lo - 0.14 / fh, fv) : 0.0) - 0.10 * lOut;
      }
      S.n = normalize(N + T * (cJL - cJR) * 0.7 + B * (cSill * 0.5 + sOut * 0.45 - cHead * 0.9));
      S.ao *= 1.0 - 0.60 * cHead - 0.38 * (cJL + cJR) - 0.18 * cSill;
      win = glazed;
    }

    // ---- window lights: warm / cool per window, floor-coherent offices, an interior that falls off ----
    if (uNight > 0.15) {
      float resU = 1.0 - smoothstep(0.25, 1.0, max(fu, fv));
      float lit = lodWindowLit(style, seed, wid, uint(fl), litFrac, fu, fv);
      vec3 light = windowLightColorLOD(style, seed, wid, uint(fl), resU);
      float resV = 1.0 - smoothstep(0.15, 0.5, fv);
      float depth = mix(0.95, windowInterior(clamp((pv - lo) / max(hi - lo, 0.001), 0.0, 1.0)), resV);
      S.emis += light * lit * win * depth * nightK * uEmissive * ${G.toFixed(2)};
    }

    // ---- the ground-floor shopfront course: 4-5 m of dark glazing over a bulkhead, between masonry piers,
    // capped by a fascia in the shop's colour. Same bay hashes and band heights as the near branch.
    if (storefront) {
      float bw = 7.0 + hash3(seed, 20u, wallIdx) * 5.0;
      float ns = max(1.0, floor(wl / bw + 0.5));
      float sw = wl / ns;
      uint sid = uint(u / sw);
      float su = u - float(sid) * sw;
      int pal = int(hash4(seed, 24u, wallIdx, sid) * 6.0);
      vec3 shopCol = pal == 0 ? vec3(0.03, 0.03, 0.03) : pal == 1 ? vec3(0.05, 0.16, 0.09) : pal == 2 ? vec3(0.28, 0.05, 0.07) : pal == 3 ? vec3(0.06, 0.09, 0.22) : pal == 4 ? vec3(0.5, 0.06, 0.05) : vec3(0.12, 0.12, 0.13);
      float shopLit = shopLitState(seed, wallIdx, sid, uNight);
      float gate = shopGateDown(seed, wallIdx, sid, uNight);
      vec3 lampC = shopLampColor(seed, wallIdx, sid);
      float bandB = gfH - 1.15, bandT = gfH - 0.25;
      float shop = bandCov(su, 0.28, sw - 0.28, fwU); // 0 on the piers between shops
      float bGlaze = bandCov(v, 0.62, bandB - 0.05, fwV) * shop;
      float bBulk = bandCov(v, 0.0, 0.62, fwV) * shop;
      float bFasc = bandCov(v, bandB, bandT, fwV) * shop;
      // a closed gate is dark painted steel, not the bright galvanised plane it used to be
      vec3 gateC = vec3(0.20, 0.19, 0.19);
      S.alb = mix(S.alb, mix(vec3(0.05, 0.052, 0.058), gateC, gate), bGlaze);
      S.alb = mix(S.alb, mix(vec3(0.09, 0.09, 0.09), gateC, gate), bBulk);
      S.alb = mix(S.alb, shopCol, bFasc * 0.95);
      S.alb = mix(S.alb, mix(S.alb, vec3(0.6), 0.5), bandCov(v, bandT - 0.07, bandT, fwV) * shop);
      S.rough = mix(S.rough, mix(0.12, 0.68, gate), bGlaze);
      S.spec = mix(S.spec, vec3(0.05), bGlaze * (1.0 - gate));
      S.specMix = max(S.specMix, bGlaze * (1.0 - gate));
      // Mean of the near branch's interior over the glazed band, so nothing pops across the LOD line: the
      // window is the brightest warm plane, the fascia is washed from above, the bulkhead takes the bounce.
      S.emis += lampC * 0.72 * shopLit * (1.0 - gate) * bGlaze;
      S.emis += S.alb * lampC * 0.62 * shopLit * bFasc * nightK;
      S.emis += S.alb * lampC * 0.55 * shopLit * (1.0 - gate) * bBulk * nightK;
      S.ao *= 1.0 - 0.3 * bandCov(v, bandB - 1.7, bandB, fwV) * shop;
    }

    // ---- weathering: soot in the cornice's rain shadow, splash at the foot, a smear under every sill ---
    if (style != 5) {
      float streak = vnoise(vec2(u * 0.8, v * 0.05));
      float dirt = 0.46 * smoothstep(H - 3.0, H + 0.6, v) * (0.55 + 0.65 * streak);
      dirt += (street ? 0.34 : 0.18) * (1.0 - smoothstep(0.0, street ? 2.0 : 1.5, v)) * (0.65 + 0.35 * streak);
      dirt += 0.10 * vnoise(vec2(u * 0.33, v * 0.07));
      if (stoneStyle) dirt += 0.14 * smoothstep(baseTop, max(H, baseTop + 12.0), v) * (0.6 + 0.4 * streak);
      float dBelow = (fb + fh + sill) - v;
      if (!party && dBelow > 0.0 && dBelow < 1.6) {
        float f2 = 1.0 - dBelow / 1.6;
        dirt += 0.40 * f2 * f2 * cWide * (0.35 + 0.65 * streak);
      }
      dirt = clamp(dirt, 0.0, 0.68);
      S.alb *= 1.0 - dirt * ((matM == 0 || matM == 6) ? 0.65 : 0.55);
      S.rough = mix(S.rough, 0.97, dirt * 0.5);
    }
    float wetM = uWet * (0.25 + 0.6 * (1.0 - smoothstep(0.0, 4.0, v)));
    S.alb *= 1.0 - 0.35 * wetM;
    S.rough = mix(S.rough, 0.3, wetM);

    // ---- cornice band and coping, at the top of every tier: a setback and the roof edge both get the
    // shadow line the crowning profile throws on the wall under it. The cornice geometry still casts a real
    // shadow inside the 350 m cascade, so this stand-in fades in exactly as that shadow fades out.
    float corn = street ? step(0.5, uStyle[style * 3 + 2].x) : 0.0;
    S.ao *= 1.0 - (0.15 + 0.30 * corn) * smoothstep(0.16, 0.34, fw) * bandCov(v, H - 1.2 - corn * 0.4, H - 0.3, fwV);
    if (style != 5) S.alb = mix(S.alb, matM == 1 ? tint * 1.05 : vec3(0.66, 0.63, 0.58), bandCov(v, H + 0.45, H + 40.0, fwV));
    S.rough = clamp(S.rough, 0.03, 1.0);
    return S;
  }

  // ---- parallax recess ---------------------------------------------------------------------------------
  vec3 vt = vec3(dot(V, T), dot(V, B), dot(V, N));
  float recess = (style == 5 ? 0.12 : (style == 0 || style == 1 || style == 8) ? 0.26 : 0.2) * detail;
  vec2 sh = -vt.xy / max(vt.z, 0.08) * recess;
  float cx2 = cx + sh.x, v2 = v + sh.y;
  bool inWin = cwin && abs(cx) < ww * 0.5 && v > wb && v < wt;
  bool inWin2 = cwin && abs(cx2) < ww * 0.5 && v2 > wb && v2 < wt;
  // arched heads (civic, the crown floor of stone fronts; cast iron segmental)
  if (arched && cwin) {
    float ac = wt - ww * 0.5;
    inWin = inWin && (v < ac || (cx * cx + (v - ac) * (v - ac)) < ww * ww * 0.25);
    inWin2 = inWin2 && (v2 < ac || (cx2 * cx2 + (v2 - ac) * (v2 - ac)) < ww * ww * 0.25);
  } else if (style == 3 && cwin && fl > 0) {
    float k = 0.3 / (ww * ww * 0.25);
    inWin = inWin && v < wt - k * cx * cx;
    inWin2 = inWin2 && v2 < wt - k * cx2 * cx2;
  }

  // ---- masonry base --------------------------------------------------------------------------------------
  vec2 tilt = vec2(0.0);
  vec3 brickVar = vec3(1.0);
  float rough = 0.85;
  float fade = smoothstep(0.04, 0.18, fw); // pixel footprint -> pattern fades out
  vec3 alb;
  int mat = base;
  if (brickShaft && fl >= 3) { mat = 0; tint = shaftTint(seed, tint); }
  bool rust = (mat == 1) && float(fl) < rustF;
  if (mat == 0) alb = brickPattern(vec2(u, v), tint, painted, fade, fw, tilt, rough, brickVar);
  else if (mat == 1) alb = stonePattern(vec2(u, v), tint, rust, fade, tilt, rough);
  else if (mat == 2) alb = concretePattern(vec2(u, v), tint, sp, floorH, fade, tilt, rough);
  else if (mat == 3) { alb = tint * (0.94 + 0.08 * fbm3(vec2(u, v) * 3.0)); rough = 0.5; }
  else if (mat == 5) alb = cmuPattern(vec2(u, v), tint, fade, tilt, rough);
  else if (mat == 6) alb = brownstonePattern(vec2(u, v), tint, painted, hash2(seed, 19u), fade, tilt, rough);
  else { alb = tint; rough = 0.3; }
#ifdef USE_FACADE_TEX
  if (mat == 0 && !painted) {
    vec2 tuv = vec2(u, v) * vec2(uTexScale.x, uTexScaleY.x);
    vec3 t3 = texture2D(uTexBrick, tuv).rgb;
    // retint the scan to this building's brick: luminance ratio keeps the mortar light, chroma from the tint;
    // the light joints drift toward neutral grey so dark-red buildings do not get pink mortar
    float lm = max(dot(uTexBrickMean, vec3(0.3, 0.59, 0.11)), 0.02);
    float r = dot(t3, vec3(0.3, 0.59, 0.11)) / lm;
    vec3 tex = tint * r;
    float joint = smoothstep(1.15, 1.55, r);
    tex = mix(tex, vec3(0.6, 0.58, 0.54) * clamp(r / 1.45, 0.6, 1.3), joint * 0.8);
    // Carry kiln / repair variation through the scan blend without tinting its light mortar.
    tex *= mix(brickVar, vec3(1.0), joint);
    float tw = 0.85 * (1.0 - fade);
    alb = mix(alb, tex, tw);
    vec3 tn = texture2D(uTexBrickN, tuv).xyz * 2.0 - 1.0;
    tilt = mix(tilt, tn.xy * 1.2, uTexBrickNK * tw);
  } else if (mat == 1) {
    vec3 t3 = texture2D(uTexStone, vec2(u, v) * vec2(uTexScale.y, uTexScaleY.y)).rgb;
    alb *= mix(vec3(1.0), t3 * 1.8, 0.3 * (1.0 - fade));
  } else if (mat == 2) {
    vec3 t3 = texture2D(uTexConcrete, vec2(u, v) * vec2(uTexScale.z, uTexScaleY.z)).rgb;
    alb *= mix(vec3(1.0), t3 * 1.9, 0.4 * (1.0 - fade));
  }
#endif

  // ---- cast iron: pilasters + entablature ---------------------------------------------------------------
  if (style == 3 && fl > 0 && !party) {
    float pil = step(sp * 0.5 - 0.32, abs(cx));
    float flute = 0.5 + 0.5 * sin(cx * 6.2831853 / 0.09);
    alb = mix(alb, alb * (0.92 + 0.1 * flute), pil * (1.0 - fade));
    tilt.x += pil * cos(cx * 6.2831853 / 0.09) * 0.25 * (1.0 - fade);
    float ent = step(fh - 0.55, fy);
    float mould = 0.5 + 0.5 * sin(fy * 6.2831853 / 0.14);
    alb = mix(alb, alb * (0.9 + 0.12 * mould), ent);
    tilt.y += ent * cos(fy * 6.2831853 / 0.14) * 0.3;
    S.ao *= 1.0 - ent * 0.15;
  }
  // ---- modern brick: precast floor bands on some buildings ----------------------------------------------
  if (style == 7 && !party && !parapet) {
    float course = step(fy, 0.22) * step(1.0, float(fl));
    alb = mix(alb, vec3(0.62, 0.6, 0.56), course * step(0.5, hash2(seed, 9u)));
  }
  // ---- window surrounds, sills and lintels (stone fronts, walk-ups, row houses, brick shafts) ---------------
  if (cwin && (mat == 1 || stoneStyle || style == 0 || style == 1 || style == 7 || style == 8) && !inWin) {
    bool walkup = style == 0 || style == 1;
    bool parlour = style == 1 && fl == 1;
    float tk = hash2(seed, 12u);
    // stone fronts: a keystone in a flat lintel, a moulded cornice lintel, or a plain surround; brownstone parlour
    // windows carry a hood mould (upper-west 1)
    bool keystone = stoneStyle && tk < 0.45;
    bool mouldLint = (stoneStyle && tk >= 0.45 && tk < 0.75) || parlour;
    float sillH = walkup ? 0.14 : 0.13, ext = walkup ? 0.16 : 0.14;
    float lintH = parlour ? 0.36 : mouldLint ? 0.28 : walkup ? 0.28 : 0.2;
    float sillB = step(wb - sillH, v) * step(v, wb) * step(abs(cx), ww * 0.5 + ext);
    float lint = step(wt, v) * step(v, wt + lintH) * step(abs(cx), ww * 0.5 + ext);
    float ac = wt - ww * 0.5;
    float rr = length(vec2(cx, max(v - ac, 0.0)));
    if (arched) lint = step(ac, v) * step(ww * 0.5, rr) * step(rr, ww * 0.5 + lintH) * step(abs(cx), ww * 0.5 + lintH);
    vec3 stone = (mat == 1 || stoneStyle) ? stoneT * 1.05 : vec3(0.7, 0.66, 0.6);
    // brick walk-ups: brownstone, grey limestone or painted trims per building
    if (style == 0) stone = tk < 0.4 ? vec3(0.4, 0.29, 0.22) : tk < 0.75 ? vec3(0.6, 0.58, 0.53) : vec3(0.78, 0.75, 0.68);
    if (style == 1) stone = tint * (painted ? 1.0 : 1.08);
    stone *= 0.92 + 0.12 * vnoise(vec2(u, v) * 18.0);
    float trim = max(sillB, lint);
    float key = 0.0;
    if (keystone) {
      // wedge keystone, 6 cm proud of the lintel; on an arch it sits at the crown
      float ky = arched ? v - (ac + ww * 0.5) : v - wt;
      float kw = 0.08 + 0.03 * clamp(ky / lintH, 0.0, 1.0);
      key = step(abs(cx), kw) * step(0.0, ky) * step(ky, lintH + 0.06);
      trim = max(trim, key);
    } else if (style == 0 && tk >= 0.5) key = lint * step(abs(cx), 0.09);
    // limestone / painted trims usually come as full surrounds: 14 cm jambs either side of the opening
    if (style == 0 && tk >= 0.5) {
      float jamb = step(ww * 0.5, abs(cx)) * step(abs(cx), ww * 0.5 + 0.14) * step(wb - sillH, v) * step(v, wt + lintH);
      trim = max(trim, jamb);
    }
    // a moulded lintel's top 35 % projects and faces the sky; its underside is in shadow
    float ly = clamp((v - wt) / lintH, 0.0, 1.0);
    float cap = mouldLint ? step(0.65, ly) : 0.0;
    vec2 trimTilt = vec2(0.0, sillB * 0.7 + lint * (mouldLint ? mix(-0.25, 0.9, cap) : 0.0));
    alb = mix(alb, stone * (1.0 + 0.1 * key + 0.06 * cap * lint), trim * 0.92);
    tilt = mix(tilt, trimTilt, trim);
    rough = mix(rough, 0.8, trim);
    // shadow line under the projecting sill, a slight one under the lintel drip
    float under = step(wb - sillH - 0.1, v) * step(v, wb - sillH) * step(abs(cx), ww * 0.5 + ext);
    S.ao *= 1.0 - under * 0.4 - lint * (mouldLint ? 0.12 * (1.0 - cap) : 0.06);
    if (mat == 1 || stoneStyle || style == 1) {
      float sur = arched
        ? step(wb - 0.14, v) * (v < ac ? step(abs(cx), ww * 0.5 + 0.14) : step(rr, ww * 0.5 + 0.14))
        : step(abs(cx), ww * 0.5 + 0.14) * step(wb - 0.14, v) * step(v, wt + 0.14);
      sur *= 1.0 - trim;
      alb = mix(alb, stone * 0.97, sur * 0.85);
      tilt = mix(tilt, vec2(0.0), sur);
      // the surround stands 3 cm proud: a shadow line on the wall along its lower and right edges
      float outer = arched && v >= ac ? rr - (ww * 0.5 + 0.14) : max(abs(cx) - (ww * 0.5 + 0.14), (wb - 0.14) - v);
      S.ao *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.04, outer)) * step(0.0, outer) * step(v, wt + 0.14);
    }
  }
  // ---- stone fronts: base cornice, string courses, crown-floor pilasters, spandrel panels ----------------
  // (fifth-42nd 2, upper-west 6): the rusticated base is capped by a moulded belt course with a drip shadow, the
  // shaft carries a string course per floor on some buildings, the crown floor reads as an arcade on pilasters,
  // terracotta / stone spandrel panels with a low relief sit between the windows of a bay.
  if (stoneStyle && !party && !parapet) {
    float sk = hash2(seed, 13u);
    float bb = v - (baseTop - 0.45);
    if (bb >= 0.0 && bb < 0.45 && !inWin && !tier) {
      float prof = bb / 0.45;
      // fillet, cyma, fascia: the upper slopes face the sky and read lighter
      float face = smoothstep(0.15, 0.4, prof) - 0.6 * smoothstep(0.55, 0.7, prof) + 0.5 * smoothstep(0.8, 0.95, prof);
      alb = stoneT * (0.98 + 0.1 * face) * (0.96 + 0.06 * vnoise(vec2(u, v) * 18.0));
      tilt = vec2(0.0, (prof - 0.5) * 1.6);
      rough = 0.8;
    }
    float underBelt = (baseTop - 0.45) - v;
    if (underBelt > 0.0 && underBelt < 0.35 && !tier) S.ao *= 1.0 - 0.4 * (1.0 - underBelt / 0.35);
    if (sk < 0.45 && fl > baseFloors && !topFloor && !inWin) {
      float course = step(fy, 0.14);
      alb = mix(alb, stoneT * 1.06, course);
      tilt.y += course * 0.35;
    }
    if (topFloor && arched && cwin && !inWin) {
      float pil = step(sp * 0.5 - 0.24, abs(cx));
      alb = mix(alb, stoneT * 1.05 * (0.96 + 0.06 * vnoise(vec2(u, v) * 14.0)), pil * 0.85);
      float edge = abs(cx) - (sp * 0.5 - 0.24);
      S.ao *= 1.0 - 0.3 * (1.0 - smoothstep(-0.08, 0.0, edge)) * (1.0 - pil);
    }
    if (spandrels && cwin && !inWin && fl >= baseFloors && !topFloor) {
      float sb = wt + 0.24, st = fb + fh + sill - 0.16;
      bool nextFits = fb + fh + sill + winH < H - 0.35;
      if (nextFits && v > sb && v < st && abs(cx) < ww * 0.5 + 0.1) {
        float inset = min(min(v - sb, st - v), ww * 0.5 + 0.1 - abs(cx));
        float rebate = 1.0 - smoothstep(0.03, 0.07, inset);
        vec2 q = vec2(cx, v - sb) * vec2(9.0, 7.0);
        float o0 = vnoise(q), ox = vnoise(q + vec2(0.35, 0.0)), oy = vnoise(q + vec2(0.0, 0.35));
        float relief = smoothstep(0.35, 0.65, o0);
        alb = stoneT * (0.9 + 0.14 * relief) * (0.97 + 0.05 * vnoise(vec2(u, v) * 40.0));
        alb *= 1.0 - 0.3 * rebate;
        tilt = vec2(o0 - ox, o0 - oy) * 2.0 * (1.0 - fade);
        rough = 0.75;
      }
    }
  }
  // ---- walk-up residential base: stone water table below the ground-floor sills ----------------------
  if (style == 0 && fl == 0 && !storefront && !party && v < 0.75) {
    float j = step(0.95, fract(u / 1.3));
    alb = mix(vec3(0.42, 0.4, 0.37) * (0.88 + 0.22 * vnoise(vec2(u, v) * 15.0)), vec3(0.3, 0.29, 0.28), j);
    tilt = vec2(0.0);
    rough = 0.8;
  }
  // ---- modern brick / concrete: floor bands ----------------------------------------------------------
  if (style == 6 && !ribbon && !party) {
    float band = step(fy, 0.35);
    alb = mix(alb, tint * 0.85, band * 0.6);
  }

  // ---- dirt & weathering ------------------------------------------------------------------------------
  float streak = fbm3(vec2(u * 2.7, v * 0.05));
  float vstreak = fbm3(vec2(u * 5.5, v * 0.035));
  // Soot accumulates in the parapet's rain shadow; exposed masonry has finer vertical runoff.
  float dirt = 0.46 * smoothstep(H - 3.0, H + 0.6, v) * (0.55 + 0.65 * vstreak);
  dirt += (street ? 0.34 : 0.18) * (1.0 - smoothstep(0.0, street ? 2.0 : 1.5, v)) * (0.65 + 0.35 * streak);
  dirt += 0.10 * fbm3(vec2(u * 0.33, v * 0.07));
  dirt += 0.12 * smoothstep(0.45, 0.85, vstreak);
  // limestone darkens toward the top: a century of soot the rain never reaches (fifth-42nd 1, 5)
  if (stoneStyle) dirt += 0.14 * smoothstep(baseTop, max(H, baseTop + 12.0), v) * (0.6 + 0.4 * vstreak);
  if (inCol && !party && !parapet && !inWin && style != 5) {
    // A 1.6 m fan crosses the floor line: also inspect the sill on the storey above this fragment.
    for (int above = 0; above < 2; above++) {
      int sf = fl + above;
      float sb = above == 0 ? fb : fb + fh;
      float sh = above == 0 ? fh : (style == 1 && sf == 1 ? 3.8 : floorH);
      float swb = above == 0 ? wb : sb + sill;
      float swt = above == 0 ? wt : min(swb + winH, sb + sh - 0.12);
      float sww = above == 0 ? ww : (ribbon ? sp - 0.35 : winW);
      bool sBalcony = balc && street && col % 2 == 0 && sf > 0;
      if (above == 1 && style == 1 && sf == 1) { swb = sb + 0.6; swt = sb + 3.35; sww = 1.15; }
      if (above == 1 && sBalcony) { swb = sb + 0.05; swt = min(sb + 2.3, sb + sh - 0.12); sww = 1.7; }
      bool sFits = swt < H - ((style == 0 || style == 1) ? 0.6 : 0.35) && swt - swb > 0.5;
      if (!sFits || (above == 0 && storefront)) continue;
      float below = swb - v;
      if (below <= 0.0 || below >= 1.6) continue;
      float falloff = 1.0 - below / 1.6;
      float fanWidth = sww * 0.5 + below * 0.16;
      float fan = 1.0 - smoothstep(sww * 0.3, fanWidth, abs(cx));
      dirt += 0.42 * falloff * falloff * (0.35 + 0.65 * streak) * fan;
      // Match Baker.acUnits: base-tier upper openings, same column/floor hash and balcony exclusions.
      float acFrac = uStyle[style * 3 + 2].y;
      bool ac = !tier && wl > 3.0 && sf > 0 && sf < 60 && sb >= partyH && !sBalcony
        && sb + sill + 0.5 <= H - 0.9 && hash4(seed, 70u, wallIdx * 128u + uint(col), uint(sf)) < acFrac;
      if (ac) {
        float drip = 1.0 - smoothstep(0.05, 0.22 + below * 0.05, abs(cx - 0.12));
        dirt += 0.24 * falloff * drip * (0.45 + 0.55 * vstreak);
      }
    }
  }
  dirt = clamp(dirt, 0.0, 0.68); // weathered brick, not a blanket of dirt
  alb *= 1.0 - dirt * ((mat == 0 || mat == 6) ? 0.65 : 0.55);
  rough = mix(rough, 0.97, dirt * 0.5);
  // rain: darker, glossier low on the wall
  float wetF = uWet * (0.25 + 0.6 * (1.0 - smoothstep(0.0, 4.0, v)));
  alb *= 1.0 - 0.35 * wetF;
  rough = mix(rough, 0.3, wetF);

  vec3 nW = N;
  vec3 emis = vec3(0.0);
  float metal = 0.0;

  // ---- curtain wall ------------------------------------------------------------------------------------
  // Three systems per building (park-ave-60 1, 6; fifth-42nd 1, 6): bronze-mullion tinted glass (Seagram type),
  // aluminium mullions with a spandrel band, or a flush all-glass skin. Vision glass is dark and dielectric-ish so
  // the reflection is the sky by Fresnel; every panel has its own batch (albedo), bow (normal) and haze (roughness).
  if (style == 5 && !party && !storefront) {
    float cwK = hash2(seed, 4u);
    int cwType = cwK < 0.35 ? 0 : cwK < 0.7 ? 1 : 2;
    float spandrelH = cwType == 2 ? 0.9 : 0.8 + 0.4 * hash2(seed, 905u);
    float mullW = cwType == 0 ? 0.07 : cwType == 1 ? 0.06 : 0.035;
    float mullD = (cwType == 2 ? 0.03 : 0.12) * detail;
    vec3 mullCol = cwType == 0 ? vec3(0.16, 0.13, 0.10) : cwType == 1 ? vec3(0.34, 0.35, 0.36) : vec3(0.2, 0.21, 0.22);
    float mullRough = cwType == 1 ? 0.5 : 0.4;
    vec3 glassT = tint;
    float ph = hash3(seed, wid, uint(fl));
    float p2 = hash3(seed, wid, uint(fl) + 977u);
    float batch = 0.85 + 0.3 * hash3(seed, wid, uint(fl) + 906u);
    bool panelSp = cwType == 1 && hash2(seed, 903u) >= 0.5;
    vec3 spandrelCol = cwType == 0 ? glassT * 0.05 : cwType == 1 ? (panelSp ? vec3(0.13, 0.13, 0.14) : glassT * 0.055) : glassT * 0.045;
    float spandrelRough = panelSp ? 0.5 : cwType == 2 ? 0.1 : 0.3;
    float spandrelMetal = panelSp ? 0.6 : 0.0;
    vec3 F0 = glassF0(glassT);
    float specMix = 0.0;
    vec3 spec = F0;
    float lit = windowLit(style, seed, wid, uint(fl), litFrac) * nightK;
    vec3 lightCol = windowLightColor(style, seed, wid, uint(fl));
    // parallax: mullion caps on the outer plane, glass mullD behind. A view ray that leaves the panel on the
    // glass plane hit the mullion's side first (a real edge, not a painted line).
    vec2 shm = -vt.xy / max(vt.z, 0.08) * mullD;
    float cxg = cx + shm.x, vg = v + shm.y, fyg = vg - fb;
    bool capV = abs(cx) > sp * 0.5 - mullW;
    bool capH = fy < mullW || fy > fh - mullW;
    bool sideV = abs(cxg) > sp * 0.5 - mullW;
    bool sideH = fyg < mullW || fyg > fh - mullW;
    bool vision = vg > fb + spandrelH && vg < fb + fh - 0.22;
    bool corner = cwType != 2 && (u < 0.32 || u > wl - 0.32);
    if (parapet) {
      // parapet / mechanical band above the top floor: the spandrel material, capped in the mullion metal
      alb = spandrelCol; rough = spandrelRough; metal = spandrelMetal;
      if (!panelSp) { specMix = 1.0; spec = F0 * 0.85; }
      if (v > H + 0.85) { alb = mullCol; rough = mullRough; metal = 0.7; specMix = 0.0; }
      tilt = vec2(0.0);
    } else if (cwLobby) {
      // lobby: double-height glass recessed 0.6 m between stone piers, a metal fascia over, revolving door hint
      float pierSp = 6.0 + 3.0 * hash2(seed, 907u);
      float nP = max(1.0, floor(wl / pierSp + 0.5));
      float pitch = wl / nP;
      float pu = mod(u, pitch);
      bool pier = pu < 0.9 || pu > pitch - 0.9 || u < 0.9 || u > wl - 0.9;
      float sk = hash2(seed, 908u);
      vec3 stone = sk < 0.4 ? vec3(0.09, 0.09, 0.1) : sk < 0.7 ? vec3(0.55, 0.5, 0.42) : vec3(0.42, 0.42, 0.43);
      float fasciaB = gfH - 0.55;
      vec2 pl = vec2(u, v) - vt.xy / max(vt.z, 0.08) * 0.6;
      float plu = mod(pl.x, pitch);
      bool plPier = plu < 0.9 || plu > pitch - 0.9 || pl.x < 0.9 || pl.x > wl - 0.9;
      if (v >= fasciaB) {
        alb = mullCol; rough = mullRough; metal = 0.7; tilt = vec2(0.0);
      } else if (pier) {
        alb = stone * (0.94 + 0.1 * vnoise(vec2(u, v) * 9.0)); rough = sk < 0.4 ? 0.25 : 0.6; tilt = vec2(0.0);
        alb *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.7, v));
      } else if (plPier || pl.y >= fasciaB) {
        // reveal of the pier / soffit of the fascia
        bool soffit = pl.y >= fasciaB;
        alb = (soffit ? mullCol : stone) * (soffit ? 0.5 : 0.6); rough = 0.6;
        nW = soffit ? -B : (plu < 0.9 ? T : -T); S.ao *= soffit ? 0.45 : 0.65; tilt = vec2(0.0);
      } else {
        // glazing: 1.5 m mullions, a transom at 3 m, the lobby lit day and night
        float gx = mod(pl.x, 1.5);
        float doorU = 1.3 + hash3(seed, 30u, wallIdx) * max(0.0, wl - 2.6);
        bool door = abs(pl.x - doorU) < 1.1 && pl.y < 2.3;
        bool frame = gx < 0.04 || gx > 1.46 || abs(pl.y - 3.0) < 0.03 || pl.y < 0.12 || pl.y > fasciaB - 0.1;
        frame = frame || (door && (abs(abs(pl.x - doorU) - 1.1) < 0.06 || abs(pl.y - 2.3) < 0.06 || abs(pl.x - doorU) < 0.05 || abs(pl.y - 1.05) < 0.02));
        if (frame) { alb = mullCol; rough = mullRough; metal = 0.7; nW = N; }
        else {
          vec3 re = vec3(0.0);
          vec3 room = vec3(0.1);
          if (detail > 0.0) room = roomInterior(vec3(pl.x - wl * 0.5, pl.y, 0.0), -vt, wl, gfH - 0.6, 10.0, vec3(1.0, 0.94, 0.82), 0.8, wid + 977u, seed, re);
          else re = vec3(1.0, 0.94, 0.82) * 0.4;
          alb = glassT * 0.03 + room * 0.22;
          rough = 0.05; metal = 0.0;
          spec = vec3(0.07); specMix = 1.0;
          // The lobby lights stay on by day but must not blow the glass out against daylight; after dark the
          // lobby is the one warm room at street level and it reads brighter than the tower above it.
          emis = re * mix(0.12, 0.72, nightK) * uEmissive;
          // doorman's light: a downlight over the desk end of the lobby, and the pool it throws on the floor
          float deskU = doorU + (hash3(seed, 909u, wallIdx) < 0.5 ? -2.6 : 2.6);
          float desk = (1.0 - smoothstep(0.0, 1.4, abs(pl.x - deskU))) * (1.0 - smoothstep(0.0, 2.6, pl.y));
          emis += vec3(1.0, 0.88, 0.68) * desk * 0.55 * nightK;
          if (door) { alb *= 0.6; emis *= 0.6; }
        }
        S.ao *= 0.7;
        tilt = vec2(0.0);
      }
    } else if (corner) {
      // corner cover: the mullion metal wrapping the edge, bevelled toward the corner
      float side = u < wl * 0.5 ? -1.0 : 1.0;
      alb = mullCol; rough = mullRough; metal = 0.7;
      nW = normalize(N + T * side * 0.35);
      tilt = vec2(0.0);
    } else if (capV || capH) {
      // mullion cap: a rounded extrusion, edges tilted so it catches light differently from the glass
      float d = capV ? (sp * 0.5 - abs(cx)) / mullW : (fy < mullW ? fy : fh - fy) / mullW;
      alb = mullCol; rough = mullRough; metal = 0.7;
      vec2 tw = capV ? vec2(sign(cx) * (1.0 - d) * 0.45, 0.0) : vec2(0.0, (fy < mullW ? -1.0 : 1.0) * (1.0 - d) * 0.45);
      nW = normalize(N + T * tw.x + B * tw.y);
      tilt = vec2(0.0);
    } else if (sideV || sideH) {
      // side face of the mullion, seen at an angle
      alb = mullCol * 0.55; rough = mullRough; metal = 0.6;
      nW = sideV ? -sign(cxg) * T : (fyg < mullW ? B : -B);
      S.ao *= 0.6;
      tilt = vec2(0.0);
    } else {
      // glass plane: per-panel bow so the sky reflection breaks up panel to panel
      nW = normalize(N + T * (ph - 0.5) * 0.09 + B * (p2 - 0.5) * 0.07);
      // shadow of the mullion cap on the glass just inside it
      float inset = min(sp * 0.5 - mullW - abs(cxg), min(fyg - mullW, fh - mullW - fyg));
      S.ao *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.12, inset)) * detail;
      if (vision) {
        vec3 room = vec3(0.0);
        vec3 re = vec3(0.0);
        if (detail > 0.0) room = roomInterior(vec3(cxg, vg - fb, 0.0), -vt, sp * 2.0, fh - 0.2, 5.0, lightCol, lit, wid, seed, re);
        else { room = vec3(0.1); re = lightCol * 0.5 * lit; }
        alb = (glassT * 0.05 + room * glassT * 0.12) * batch;
        rough = 0.05 + 0.1 * ph;
        metal = 0.0;
        spec = F0 * batch; specMix = 1.0;
        emis = re * 0.55 * uEmissive;
        // blinds: horizontal slats over part of the panel (light panels behind the tint)
        float bh = hash3(seed, wid, uint(fl) + 313u);
        if (bh < 0.4) {
          float cover = 0.3 + 0.7 * hash3(seed, wid, uint(fl) + 314u);
          float blind = step(fb + fh - 0.22 - cover * (fh - spandrelH - 0.22), vg);
          float slat = 0.85 + 0.15 * sin(vg * 6.2831853 / 0.025) * (1.0 - smoothstep(0.006, 0.025, fw));
          vec3 blindCol = mix(vec3(0.62, 0.62, 0.6), glassT, 0.35) * 0.32 * slat;
          alb = mix(alb, blindCol * batch, blind * 0.85);
          emis = mix(emis, lightCol * 0.3 * lit * uEmissive, blind);
          rough = mix(rough, 0.2, blind * 0.5);
        }
      } else {
        // spandrel band: back-painted glass, anodised panel, or the flush skin's shadow box
        alb = spandrelCol * batch;
        rough = spandrelRough; metal = spandrelMetal;
        if (!panelSp) { spec = F0 * 0.85 * batch; specMix = 1.0; }
        if (cwType == 2) {
          // slab edge showing through the shadow box
          float slab = step(fyg, 0.35) * step(0.05, fyg);
          alb = mix(alb, vec3(0.08, 0.08, 0.085), slab * 0.6);
        }
      }
      tilt = vec2(0.0);
    }
    if (!parapet && !cwLobby && !corner) {
      // splash and grime at the foot of the wall; the rest of a curtain wall stays clean
      alb *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, 0.7, v));
    }
    S.spec = spec; S.specMix = specMix;
  }
  // ---- storefront ---------------------------------------------------------------------------------------
  // The commercial ground floor is a distinct band (west-village 1-3, east-village 4-6): piers, a fascia board or
  // lightbox, big glazing recessed 0.3 m behind the piers on a bulkhead, the entrance a further 0.6 m back, a lit
  // interior day and night, a gate housing above the glass. All parallax against the flat wall quad: no extra draws.
  else if (storefront) {
    float bw = 7.0 + hash3(seed, 20u, wallIdx) * 5.0;
    float ns = max(1.0, floor(wl / bw + 0.5));
    float sw = wl / ns;
    int si = int(u / sw);
    float su = u - float(si) * sw;
    uint sid = uint(si);
    float t = hash4(seed, 21u, wallIdx, sid); // < 0.45 awning, < 0.8 lightbox, else painted board (Baker.storefronts)
    float g = hash4(seed, 22u, wallIdx, sid);
    float doorU = sw * (0.15 + 0.7 * hash4(seed, 23u, wallIdx, sid));
    float ck = hash4(seed, 24u, wallIdx, sid);
    int pal = int(ck * 6.0);
    float bandB = gfH - 1.15, bandT = gfH - 0.25;
    float pil = 0.28;
    bool hasAwning = t < 0.45 && sw > 3.0;
    bool hasBox = t >= 0.45 && t < 0.8 && sw > 3.0;
    bool gateBox = g < 0.55;
    bool gateDown = shopGateDown(seed, wallIdx, sid, uNight) > 0.5;
    // shops keep their lights on by day; a few are dark at night (closed, gate up)
    float shopLit = shopLitState(seed, wallIdx, sid, uNight);
    vec3 lampC = shopLampColor(seed, wallIdx, sid);
    // A closed shop with its gate up is never a black hole and never a flat panel either: the night light at
    // the back lights the SAME room, two and a half stops down, so the shelves and the ceiling still read.
    float interiorLit = max(shopLit, (1.0 - shopLit) * nightK * 0.17);
    // a Village shop is 5-9 m deep, not a uniform 8: the back wall lands at a different distance per shop
    float shopDepth = 5.0 + 4.0 * hash4(seed, 46u, wallIdx, sid);
    // After dark the glass shows the room and nothing else. Keeping the daytime albedo (skylight on the
    // glazing competing with the interior) leaves every lit window a washed neutral panel at 22:30.
    float glassK = mix(0.68, 0.16, nightK);
    // shop palette (AWNING_COLORS in the baker shares the index): black, hunter green, burgundy, navy, red, charcoal
    vec3 shopCol = pal == 0 ? vec3(0.03, 0.03, 0.03) : pal == 1 ? vec3(0.05, 0.16, 0.09) : pal == 2 ? vec3(0.28, 0.05, 0.07) : pal == 3 ? vec3(0.06, 0.09, 0.22) : pal == 4 ? vec3(0.5, 0.06, 0.05) : vec3(0.12, 0.12, 0.13);
    float fk = hash4(seed, 27u, wallIdx, sid);
    // frames: dark anodised aluminium (most), painted wood in the shop colour, or bronze
    vec3 frameCol = fk < 0.55 ? vec3(0.07, 0.07, 0.08) : fk < 0.85 ? shopCol * 1.1 : vec3(0.3, 0.22, 0.12);
    float frameMetal = fk < 0.55 || fk >= 0.85 ? 0.7 : 0.0;
    float hT = bandB - (gateBox ? 0.32 : 0.0); // head of the glazed opening (under the gate housing)
    float gw = sw - 2.0 * pil;
    float dHalf = 0.75, dH = 2.4;
    bool pilaster = su < pil || su > sw - pil;
    bool glassy = false;
    if (v >= bandT) {
      // masonry strip / transom line above the shop
      alb = mix(alb, alb * 0.9, 0.5);
    } else if (v >= bandB) {
      if (pilaster) { alb *= 0.85; }
      else {
        // fascia: painted board in the shop colour with a light cap moulding
        alb = shopCol * (0.92 + 0.12 * vnoise(vec2(u, v) * 20.0));
        rough = 0.55;
        float capM = step(bandT - 0.07, v);
        alb = mix(alb, mix(alb, vec3(0.6), 0.5), capM);
        if (!hasBox) {
          // the name in a real typeface (sign atlas), aspect-correct; +u runs screen-left, so the atlas x is reversed
          float tb = bandB + 0.36, tt = bandT - 0.12;
          float m = 0.35, tw = sw - 2.0 * m;
          float hx = min(0.5, (tw / (tt - tb)) / 32.0); // atlas half-width (half is reserved in GLSL ES)
          float ax = 0.5 + hx - (su - m) / tw * 2.0 * hx;
          float fy = (v - tb) / (tt - tb);
          float nameRow = floor(hash4(seed, 25u, wallIdx, sid) * SIGN_NAME_ROWS);
          float text = 0.0;
          if (fy > 0.0 && fy < 1.0 && su > m && su < sw - m) text = texture2D(uSignAtlas, vec2(ax, (nameRow + (1.0 - fy)) / uSignRows)).r;
          float tk = hash4(seed, 26u, wallIdx, sid);
          vec3 textCol = tk < 0.6 ? vec3(0.92, 0.9, 0.85) : tk < 0.85 ? vec3(0.85, 0.68, 0.25) : vec3(0.1, 0.1, 0.1);
          if (pal == 4 || pal == 0) textCol = tk < 0.75 ? vec3(0.92, 0.9, 0.85) : vec3(0.85, 0.68, 0.25);
          alb = mix(alb, textCol, text * 0.95);
        }
        // Gooseneck lamps over the board: two or three shades on 1.6-2.4 m centres throw overlapping
        // scallops, brightest just under the cap and gone by the bottom rail. A painted board glowing
        // evenly over its whole face is the tell (west-village 3, east-village 4).
        float nLamp = max(2.0, floor(sw / 2.0));
        float lampU = fract(su / (sw / nLamp)) - 0.5;
        float scallop = 0.55 + 0.45 * (1.0 - smoothstep(0.10, 0.55, abs(lampU)));
        float drop = 0.40 + 0.60 * smoothstep(bandB - 0.10, bandT - 0.10, v);
        emis = alb * lampC * (0.10 + 0.95 * scallop * drop) * shopLit * nightK;
        // the shade itself, a small hot spot on the cap moulding
        emis += lampC * SHOP_LAMP_PEAK * 0.55 * shopLit * nightK
              * step(bandT - 0.05, v) * (1.0 - smoothstep(0.0, 0.09, abs(lampU)));
      }
      tilt = vec2(0.0);
    } else if (pilaster) {
      // piers between shops: the building's masonry, the shop's painted cladding, or glazed tile
      float pk = hash4(seed, 29u, wallIdx, sid);
      if (pk < 0.45) alb *= 0.9;
      else if (pk < 0.75) { alb = shopCol * (0.9 + 0.15 * vnoise(vec2(u, v) * 12.0)); rough = 0.5; tilt = vec2(0.0); }
      else {
        vec2 tf = fract(vec2(u, v) / 0.15);
        float grout = step(0.06, tf.x) * step(0.06, tf.y);
        vec3 tileC = pk < 0.88 ? vec3(0.6, 0.6, 0.58) : vec3(0.42, 0.12, 0.1);
        alb = mix(tileC * 0.7, tileC, grout) * (0.94 + 0.1 * hashf(floor(vec2(u, v) / 0.15)));
        rough = 0.3;
        tilt = vec2(0.0);
      }
    } else if (gateDown) {
      // Roll-down gate, flush with the piers, covering glass, door and bulkhead. A gate is galvanised steel
      // that has been up and down for twenty years: mid-dark, hand-greased along the pull rail, filthy at the
      // kerb, and tagged more often than not (west-village 3, east-village 2). Under a skyglow-only sky a
      // clean 0.5 grey gate becomes the brightest plane on the block, which is exactly backwards.
      vec2 gt; float gm;
      float pk = hash4(seed, 31u, wallIdx, sid);
      // galvanised grey, brown-painted, or dark green-painted; painted gates are the majority
      vec3 gc = pk < 0.35 ? vec3(0.26, 0.27, 0.28) : pk < 0.65 ? vec3(0.20, 0.15, 0.12) : pk < 0.85 ? vec3(0.11, 0.16, 0.13) : vec3(0.17, 0.17, 0.19);
      alb = corrugated(vec2(u, v), gc, gt, rough, gm);
      metal = pk < 0.35 ? gm : 0.15;
      rough = pk < 0.35 ? 0.6 : 0.72;
      // graffiti on roughly half of them: a fat two-colour throw-up between 0.4 and 2.1 m with an outline
      float gr = hash4(seed, 32u, wallIdx, sid);
      if (gr < 0.55) {
        vec3 fill = gr < 0.16 ? vec3(0.55, 0.13, 0.38) : gr < 0.30 ? vec3(0.14, 0.28, 0.55) : gr < 0.43 ? vec3(0.55, 0.42, 0.08) : vec3(0.42, 0.42, 0.44);
        vec2 tq = vec2(u * 0.85 + float(sid) * 4.3, (v - 1.2) * 1.6);
        float blob = fbm3(tq * 1.15);
        float band = step(0.42, v) * step(v, 2.1) * (1.0 - smoothstep(0.0, 0.35, abs(v - 1.25) - 0.55));
        float body = smoothstep(0.50, 0.57, blob) * band;
        float edge = (smoothstep(0.45, 0.50, blob) - smoothstep(0.57, 0.62, blob)) * band;
        alb = mix(alb, fill * (0.75 + 0.5 * vnoise(tq * 6.0)), body * 0.9);
        alb = mix(alb, vec3(0.05, 0.05, 0.06), edge * 0.85);
        rough = mix(rough, 0.85, max(body, edge));
        metal *= 1.0 - max(body, edge);
      }
      // pull rail worn bright at 1.2 m, kerb grime and salt bloom at the bottom, rust bleed at the guides
      alb *= 1.0 + 0.30 * (1.0 - smoothstep(0.0, 0.10, abs(v - 1.2)));
      alb *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.55, v)) * (0.6 + 0.4 * fbm3(vec2(u * 3.0, v * 0.6)));
      alb = mix(alb, vec3(0.20, 0.10, 0.05), 0.35 * smoothstep(0.6, 0.85, fbm3(vec2(u * 0.5, v * 0.12))) * (1.0 - smoothstep(0.0, 2.4, v)));
      tilt = gt;
      // the gate is in its own shade: nothing behind it, and the fascia above shadows its head
      S.ao *= 0.72 - 0.16 * smoothstep(hT - 1.2, hT, v);
      if (v >= hT) { alb = vec3(0.15, 0.145, 0.14); rough = 0.62; metal = 0.5; tilt = vec2(0.0); S.ao *= 0.7; }
    } else {
      // recessed shopfront: glazing plane 0.3 m behind the piers, entrance vestibule 0.9 m back
      vec2 p1 = vec2(su, v) - vt.xy / max(vt.z, 0.08) * 0.3;
      if (v >= hT) {
        // gate housing face (behind the baked housing box on gated shops): painted steel in shadow
        alb = vec3(0.17, 0.165, 0.16); rough = 0.6; metal = 0.5; tilt = vec2(0.0); S.ao *= 0.7;
      } else if (p1.x < pil || p1.x > sw - pil || p1.y > hT) {
        // jamb / head reveal of the opening, washed by the light coming out of the glass beside it
        bool head = p1.y > hT;
        alb = mix(tint, shopCol, 0.5) * (head ? 0.3 : 0.55);
        rough = 0.8;
        nW = head ? -B : p1.x < pil ? T : -T;
        S.ao *= head ? 0.45 : 0.65;
        emis = alb * lampC * (head ? 0.60 : 0.35) * shopLit * nightK;
        tilt = vec2(0.0);
      } else if (p1.y < 0.0) {
        // stone sill of the recess, taking the spill from the window straight above it
        alb = vec3(0.4, 0.39, 0.37); rough = 0.8; nW = B; tilt = vec2(0.0);
        emis = alb * lampC * 0.50 * shopLit * nightK;
      } else if (abs(p1.x - doorU) < dHalf && p1.y < dH) {
        vec2 p2 = vec2(su, v) - vt.xy / max(vt.z, 0.08) * 0.9;
        if (abs(p2.x - doorU) >= dHalf || p2.y >= dH || p2.y < 0.0) {
          // vestibule: tiled cheeks and floor, a soffit with a downlight
          bool soffit = p2.y >= dH;
          bool floorHit = p2.y < 0.0;
          vec2 tf = fract(vec2(u, v) / 0.15);
          float grout = step(0.06, tf.x) * step(0.06, tf.y);
          alb = mix(vec3(0.5, 0.5, 0.48) * 0.7, vec3(0.5, 0.5, 0.48), grout) * (soffit ? 0.5 : floorHit ? 0.6 : 0.75);
          rough = 0.45;
          nW = soffit ? -B : floorHit ? B : (p2.x < doorU ? T : -T);
          S.ao *= soffit ? 0.4 : 0.55;
          if (soffit && abs(p2.x - doorU) < 0.2) emis = lampC * SHOP_LAMP_PEAK * mix(0.35, 1.0, nightK) * shopLit;
          else emis = alb * lampC * (floorHit ? 1.25 : 0.7) * shopLit * nightK;
          tilt = vec2(0.0);
        } else {
          // glazed door pair: frames, centre post, push bars, kick plates, transom over
          float ddx = p2.x - doorU;
          bool fr = abs(abs(ddx) - dHalf) < 0.06 || abs(ddx) < 0.03 || abs(p2.y - 2.1) < 0.04 || p2.y > dH - 0.06;
          bool kick = p2.y < 0.3;
          bool bar = abs(p2.y - 1.05) < 0.025 && abs(ddx) > 0.1 && abs(ddx) < dHalf - 0.1;
          if (fr || kick || bar) { alb = kick || bar ? vec3(0.55, 0.55, 0.56) : frameCol; rough = kick || bar ? 0.35 : 0.45; metal = kick || bar ? 0.8 : frameMetal; nW = N; }
          else {
            vec3 re = vec3(0.0);
            vec3 room = vec3(0.08);
            if (detail > 0.0) room = shopInterior(vec3(p2.x - pil - gw * 0.5, p2.y, 0.0), -vt, gw, hT - 0.15, shopDepth, interiorLit, lampC, sid, seed, re);
            else re = lampC * 0.72 * interiorLit;
            alb = room * glassK;
            rough = 0.05;
            emis = re;
            glassy = true;
          }
          S.ao *= 0.6;
          tilt = vec2(0.0);
        }
      } else if (p1.y < 0.6) {
        // bulkhead under the glass: black granite, painted panel, or tile; capped by the bottom rail
        float bk = hash4(seed, 35u, wallIdx, sid);
        if (bk < 0.4) { alb = vec3(0.06, 0.06, 0.065) * (0.9 + 0.2 * vnoise(vec2(u, v) * 25.0)); rough = 0.25; }
        else if (bk < 0.7) { alb = shopCol * (0.9 + 0.15 * vnoise(vec2(u, v) * 12.0)); rough = 0.55; }
        else { vec2 tf = fract(vec2(u, v) / 0.15); float grout = step(0.06, tf.x) * step(0.06, tf.y); alb = mix(vec3(0.35), vec3(0.55, 0.55, 0.52), grout); rough = 0.35; }
        if (p1.y > 0.55) { alb = frameCol; rough = 0.45; metal = frameMetal; }
        tilt = vec2(0.0);
      } else {
        // glazing: mullions every ~2.4 m, a transom bar 0.7 m under the head, top and bottom rails, sidelight frames
        float gl = p1.x - pil;
        float nm = max(1.0, floor(gw / 2.4));
        float mw = gw / nm;
        float mx = fract(gl / mw) * mw;
        bool mull = mx < 0.04 || mx > mw - 0.04 || p1.y > hT - 0.08 || abs(p1.y - (hT - 0.7)) < 0.03 || p1.y < 0.65;
        mull = mull || (p1.y < dH + 0.06 && abs(abs(p1.x - doorU) - dHalf) < 0.06) || (abs(p1.x - doorU) < dHalf && abs(p1.y - dH) < 0.06);
        if (mull) { alb = frameCol; rough = 0.45; metal = frameMetal; nW = N; }
        else {
          vec3 re = vec3(0.0);
          vec3 room = vec3(0.08);
          if (detail > 0.0) room = shopInterior(vec3(p1.x - pil - gw * 0.5, p1.y, 0.0), -vt, gw, hT - 0.15, shopDepth, interiorLit, lampC, sid, seed, re);
          else re = lampC * 0.72 * interiorLit;
          alb = room * glassK;
          rough = 0.05;
          metal = 0.0;
          emis = re;
          glassy = true;
          // Neon accent on ~20 % of shops: a bent tube hung in the glass just under the transom, from the
          // atlas's neon rows. Small, saturated, and the only thing on the block above the lightbox cap.
          float nk = hash4(seed, 42u, wallIdx, sid);
          if (nk < 0.2 && shopLit > 0.5) {
            float nb = hT - 1.35, ntp = hT - 0.85;
            float nm2 = 0.55, ntw = max(gw - 2.0 * nm2, 0.4);
            float nhx = min(0.5, (ntw / max(ntp - nb, 0.05)) / 34.0);
            float nax = 0.5 + nhx - (gl - nm2) / ntw * 2.0 * nhx;
            float nfy = (p1.y - nb) / (ntp - nb);
            float nrow = SIGN_NAME_ROWS + floor(hash4(seed, 44u, wallIdx, sid) * SIGN_NEON_ROWS);
            float tube = 0.0;
            if (nfy > 0.0 && nfy < 1.0 && gl > nm2 && gl < gw - nm2)
              tube = texture2D(uSignAtlas, vec2(nax, (nrow + (1.0 - nfy)) / uSignRows)).r;
            vec3 nc = shopNeonColor(seed, wallIdx, sid);
            // tube glass reads dark grey off, the argon fill carries the colour on
            alb = mix(alb, vec3(0.12, 0.12, 0.13), tube * 0.8);
            emis += nc * tube * 1.90 * nightK;
          }
          // posters, menus and notices stuck on the glass
          float ps = hash4(seed, 33u, wallIdx, sid);
          if (ps < 0.3) {
            float post = step(abs(mx - mw * 0.5), 0.35) * step(1.2, p1.y) * step(p1.y, 2.2);
            vec3 pc = ps < 0.15 ? vec3(0.9, 0.85, 0.2) : vec3(0.85, 0.2, 0.15);
            alb = mix(alb, pc * (0.7 + 0.3 * vnoise(vec2(u, v) * 30.0)), post * 0.9);
            emis = mix(emis, pc * lampC * 0.75 * shopLit, post);
            rough = mix(rough, 0.6, post);
          } else if (ps < 0.6) {
            float sheet = step(abs(p1.y - 1.5), 0.18) * step(abs(abs(p1.x - doorU) - (dHalf + 0.35)), 0.14);
            alb = mix(alb, vec3(0.85, 0.84, 0.8), sheet * 0.95);
            rough = mix(rough, 0.7, sheet);
            emis = mix(emis, vec3(0.85, 0.84, 0.8) * lampC * 0.62 * shopLit, sheet);
          }
          // a band of small white vinyl lettering across the glass on some shops
          float vk = hash4(seed, 36u, wallIdx, sid);
          if (vk < 0.35) {
            float band = step(abs(p1.y - 1.95), 0.05) * step(0.5, fract(gl / 0.22)) * step(0.3, mx) * step(mx, mw - 0.3);
            alb = mix(alb, vec3(0.9), band * 0.8);
            rough = mix(rough, 0.6, band);
          }
        }
        tilt = vec2(0.0);
      }
    }
    // the awning's sky occlusion on everything under it (its sun shadow comes from the shadow map)
    if (hasAwning && su > 0.25 && su < sw - 0.25) {
      float yTop = bandB + 0.35;
      S.ao *= 1.0 - 0.4 * smoothstep(yTop - 1.8, yTop - 0.3, v) * step(v, yTop + 0.02);
    }
    // soot and splash at the base of everything that is not glass
    if (!glassy) {
      float splash = 1.0 - smoothstep(0.0, 0.7, v);
      alb *= 1.0 - 0.3 * splash * (0.7 + 0.3 * streak);
      rough = mix(rough, 0.95, splash * 0.5);
    }
    // Spill (docs/ART_DIRECTION.md §2 Night): the light leaving a lit window washes the bulkhead and the
    // piers next to it, and bounces off the pavement back onto the bottom 0.8 m of the shopfront. The soft
    // trapezoid on the sidewalk itself belongs to the ground decal pass (props), not to the facade mesh.
    if (!glassy && !gateDown && v < bandB) {
      float bounce = 0.55 * (1.0 - smoothstep(0.0, 0.9, v)) + 0.30 * (1.0 - smoothstep(0.0, bandB, v));
      emis += alb * lampC * bounce * shopLit * nightK;
    }
    S.ao *= mix(1.0, 0.85, step(bandT, v) * step(v, gfH));
  }
  // ---- residential entrance: glazed lobby (stone / concrete apartment houses) or a panelled walk-up door ------
  else if (resDoor && !party && ((style != 1 && fl == 0) || (style == 1 && fl == 1)) && wl > 3.0) {
    float doorU = 1.3 + hash3(seed, 30u, wallIdx) * max(0.0, wl - 2.6);
    bool lobby = style == 2 || style == 4 || style == 6 || style == 9 || (style == 7 && H > 15.0);
    float dw = lobby ? 1.15 : style == 1 ? 0.62 : 0.6;
    float dh = lobby ? 2.9 : style == 1 ? 2.7 : 2.5;
    float dv = v - fb;
    bool inDoor = abs(u - doorU) < dw && dv < dh && dv >= 0.0;
    bool sur = abs(u - doorU) < dw + (lobby ? 0.3 : 0.2) && dv < dh + (lobby ? 0.4 : 0.25) && dv >= 0.0;
    if (inDoor && lobby) {
      // glazed double doors recessed 0.5 m in a stone surround; the lobby is lit day and night
      vec2 p2 = vec2(u - doorU, dv) - vt.xy / max(vt.z, 0.08) * 0.5;
      vec3 fc = hash3(seed, 34u, wallIdx) < 0.5 ? vec3(0.3, 0.22, 0.12) : vec3(0.08, 0.08, 0.09);
      if (abs(p2.x) >= dw || p2.y >= dh || p2.y < 0.0) {
        bool soffit = p2.y >= dh;
        vec3 stone = style == 6 || style == 7 ? vec3(0.5, 0.48, 0.45) : tint;
        alb = stone * (soffit ? 0.35 : p2.y < 0.0 ? 0.7 : 0.6);
        nW = soffit ? -B : p2.y < 0.0 ? B : (p2.x < 0.0 ? T : -T);
        S.ao *= soffit ? 0.45 : 0.65;
        rough = 0.8;
        // The doorman's light: a single warm bulb in the entry soffit, and the stone reveal it washes. The
        // lit entrance is what tells a residential block from a warehouse after dark (stoops-1, _general-1).
        if (soffit && abs(p2.x) < 0.25) emis = vec3(1.0, 0.90, 0.72) * mix(0.55, 1.35, nightK) * uEmissive;
        else emis = alb * vec3(1.0, 0.90, 0.72) * (p2.y < 0.0 ? 1.1 : 0.75) * nightK;
      } else {
        bool fr = abs(abs(p2.x) - dw) < 0.07 || abs(p2.x) < 0.035 || abs(p2.y - 2.25) < 0.05 || p2.y > dh - 0.07 || p2.y < 0.3;
        bool bar = abs(p2.y - 1.05) < 0.02 && abs(p2.x) > 0.12 && abs(p2.x) < dw - 0.12;
        if (fr || bar) { alb = fc; rough = 0.4; metal = 0.7; nW = N; }
        else {
          vec3 re = vec3(0.0);
          vec3 room = vec3(0.1);
          if (detail > 0.0) room = roomInterior(vec3(p2.x, p2.y, 0.0), -vt, 4.5, dh + 0.3, 7.0, vec3(1.0, 0.93, 0.8), 0.8, wid + 977u, seed, re);
          else re = vec3(1.0, 0.93, 0.8) * 0.4;
          alb = room * 0.7;
          rough = 0.05;
          emis = re * mix(0.35, 0.85, nightK) * uEmissive;
        }
        S.ao *= 0.6;
      }
      tilt = vec2(0.0);
      inWin = false;
    } else if (inDoor) {
      float hd = hash3(seed, 34u, wallIdx);
      // black, dark green, varnished wood; red is the exception
      vec3 dc = hd < 0.4 ? vec3(0.08, 0.07, 0.06) : hd < 0.62 ? vec3(0.12, 0.2, 0.14) : hd < 0.9 ? vec3(0.35, 0.22, 0.12) : vec3(0.4, 0.08, 0.06);
      bool transom = dv > dh - 0.55;
      bool fr = abs(abs(u - doorU) - dw) < 0.06 || abs(dv - (dh - 0.55)) < 0.04 || dv > dh - 0.05;
      // panels
      float pnl = step(0.08, abs(fract((dv) / 0.9) - 0.5) - 0.0) * step(0.1, abs(abs(u - doorU) - dw * 0.5));
      if (transom && !fr) { alb = vec3(0.05, 0.06, 0.08); rough = 0.1; emis = vec3(1.0, 0.85, 0.6) * 0.75 * smoothstep(0.2, 0.7, uNight) * uEmissive; }
      else { alb = dc * (0.9 + 0.2 * pnl) * (0.9 + 0.2 * vnoise(vec2(u, v) * 40.0)); rough = 0.5; if (fr) alb *= 0.8; }
      tilt = vec2(0.0);
      // recessed 0.3 m: fake shadow
      S.ao *= 0.75;
      inWin = false;
    } else if (sur) {
      vec3 stone = style == 1 ? tint * 1.05 : lobby ? tint * 1.08 : vec3(0.68, 0.64, 0.58);
      alb = mix(alb, stone, 0.9);
      tilt = vec2(0.0);
      inWin = false;
    }
  }

  // ---- punched windows (masonry styles) ------------------------------------------------------------------
  if (style != 5 && inWin && !(storefront && fl == 0)) {
    vec3 frameCol = vec3(0.1, 0.1, 0.1);
    float fk = hash2(seed, 6u);
    if (style == 0 || style == 1 || style == 7) frameCol = fk < 0.3 ? vec3(0.8, 0.8, 0.77) : fk < 0.75 ? vec3(0.09, 0.08, 0.07) : vec3(0.3, 0.22, 0.15);
    else if (style == 3) frameCol = fk < 0.5 ? vec3(0.1, 0.14, 0.1) : vec3(0.12, 0.12, 0.12);
    else if (style == 4 || style == 2 || style == 9) frameCol = fk < 0.5 ? vec3(0.28, 0.22, 0.14) : vec3(0.14, 0.14, 0.14);
    else if (style == 8) frameCol = vec3(0.12, 0.13, 0.14);
    if (!inWin2) {
      // Separate the side jamb, down-facing head soffit, and lighter upward-facing stone sill.
      vec3 rn;
      if (abs(cx2) >= ww * 0.5) { rn = -sign(cx2) * T; alb *= 0.50; S.ao *= 0.50; }
      else if (v2 > (wb + wt) * 0.5) { rn = -B; alb *= 0.22; S.ao *= 0.30; }
      else { rn = B; alb = mix(alb, vec3(0.52, 0.50, 0.46), 0.6) * 0.8; S.ao *= 0.75; }
      nW = rn;
      rough = 0.9;
      tilt = vec2(0.0);
    } else {
      float edge = min(ww * 0.5 - abs(cx2), min(v2 - wb, wt - v2));
      float frameW = style == 3 || style == 8 ? 0.06 : (style == 0 || style == 1) ? 0.085 : 0.07;
      bool frame = edge < frameW;
      // muntins: double-hung rail at mid height; industrial steel sash grid; cast iron 2 panes
      bool rail = abs(v2 - (wb + wt) * 0.5) < ((style == 0 || style == 1) ? 0.045 : 0.03) && style != 8 && style != 5 && !balcCol;
      bool grid = false;
      if (style == 8) { float px = fract((cx2 + ww * 0.5) / 0.45), py = fract((v2 - wb) / 0.5); grid = px < 0.06 || py < 0.06; }
      if (style == 3) grid = abs(cx2) < 0.03;
      if (style == 9) grid = abs(cx2) < 0.03 || (v2 - wb > 0.0 && fract((v2 - wb) / 0.6) < 0.05 && v2 < wt - ww * 0.5);
      if (frame || rail || grid) { alb = frameCol; rough = 0.55; metal = 0.15; nW = N; tilt = vec2(0.0); }
      else {
        // glass: interior mapping, blinds, curtains, lights
        float lit = windowLit(style, seed, wid, uint(fl), litFrac) * nightK;
        float bl = hash3(seed, wid, uint(fl) + 200u);
        vec3 lightCol = windowLightColor(style, seed, wid, uint(fl));
        vec3 re = vec3(0.0);
        vec3 room = vec3(0.05);
        if (detail > 0.0) {
          vec3 d = -vt;
          room = roomInterior(vec3(cx2, v2 - fb, 0.0), d, sp, fh - 0.15, 3.2 + 2.0 * hash3(seed, wid, 7u), lightCol, lit, wid, seed, re);
        } else { room = vec3(0.06); re = lightCol * 0.45 * lit; }
        alb = room * ((style == 0 || style == 1) ? 0.45 : stoneStyle ? 0.6 : 0.85);
        rough = 0.06;
        metal = 0.0;
        emis = re * 0.6 * uEmissive;
        if (bl < 0.3) {
          // venetian blinds covering the top part
          float cover = 0.3 + 0.7 * hash3(seed, wid, uint(fl) + 202u);
          float blind = step(wt - cover * (wt - wb), v2);
          float slat = 0.85 + 0.15 * sin(v2 * 6.2831853 / 0.025) * (1.0 - smoothstep(0.006, 0.025, fw));
          vec3 bc = vec3(0.82, 0.8, 0.74) * slat;
          alb = mix(alb, bc, blind);
          rough = mix(rough, 0.5, blind);
          emis = mix(emis, lightCol * 0.35 * lit * uEmissive, blind);
        } else if (bl < 0.45) {
          // curtains
          float ch = hash3(seed, wid, uint(fl) + 203u);
          vec3 cc = ch < 0.4 ? vec3(0.85, 0.8, 0.7) : ch < 0.7 ? vec3(0.6, 0.2, 0.18) : vec3(0.3, 0.35, 0.5);
          float folds = 0.8 + 0.25 * sin(cx2 * 6.2831853 / 0.18 + vnoise(vec2(cx2 * 3.0, v2)) * 2.0);
          float open = step(0.5, hash3(seed, wid, uint(fl) + 204u));
          float cur = open > 0.5 ? step(ww * 0.25, abs(cx2)) : 1.0;
          alb = mix(alb, cc * folds, cur);
          rough = mix(rough, 0.8, cur);
          emis = mix(emis, cc * 0.4 * lit * uEmissive, cur);
        }
        if (style == 1 && fl == 0) {
          // areaway window behind an iron grille: 12 cm bars and a mid rail, the room dim behind
          float bars = clamp(step(fract((cx2 + ww * 0.5) / 0.12), 0.18) + step(abs(v2 - (wb + wt) * 0.5), 0.02), 0.0, 1.0);
          alb = mix(alb * 0.6, vec3(0.06, 0.06, 0.065), bars);
          emis *= 1.0 - bars;
          rough = mix(rough, 0.6, bars);
        }
        nW = N;
        tilt = vec2(0.0);
      }
    }
  }

  // ---- parapet / coping -----------------------------------------------------------------------------------
  if (parapet && style != 5) {
    float cop = step(H + 0.45, v);
    vec3 copCol = mat == 1 ? tint * 1.05 : vec3(0.66, 0.63, 0.58);
    if (stoneStyle && !party && hash2(seed, 16u) < 0.45) {
      // balustrade: turned balusters at 0.34 m centres on a 0.1 m plinth under the rail, the gaps between them dark
      float pu = fract(u / 0.34) - 0.5;
      float py = v - H;
      float prof = 0.075 + 0.045 * sin(py * 6.2831853 / 0.35);
      float band = step(0.1, py) * step(py, 0.45);
      float bal = step(abs(pu * 0.34), prof) * band;
      float gap = (1.0 - bal) * band;
      alb = mix(alb, stoneT * 1.04 * (0.96 + 0.06 * vnoise(vec2(u, v) * 16.0)), bal);
      alb *= 1.0 - 0.6 * gap;
      S.ao *= 1.0 - 0.5 * gap;
      // turned balusters are round: the normal rolls off toward each edge
      tilt = vec2(sign(pu) * (1.0 - smoothstep(0.0, prof, prof - abs(pu * 0.34))) * 0.8 * bal, 0.0);
    }
    alb = mix(alb, copCol, cop);
    tilt *= 1.0 - cop;
  }

  S.alb = alb;
  S.rough = clamp(rough, 0.03, 1.0);
  S.metal = metal;
  S.n = normalize(nW + (T * tilt.x + B * tilt.y) * 0.35);
  S.emis = emis;
  return S;
}

/**
 * Flat roof. The covering comes from the vertex tint (builder.ts roofPalette: tar, silver aluminium coat,
 * pea-gravel ballast or grey single-ply), which the old branch ignored entirely - every roof in the city
 * was one of two hard-coded greys, which is why the aerial frames read as pale empty slabs.
 *
 * The low-frequency work (recoat patches, ponding stains and their chalky dried rims) is deliberately NOT
 * faded out with distance: it is what breaks a 40 x 60 m roof into something with a surface at 300 m.
 * Only the seams, gravel and bird lime - detail finer than a pixel up there - fade.
 */
Surf shadeRoof(vec3 N) {
  Surf S;
  S.emis = vec3(0.0); S.ao = 1.0; S.metal = 0.0; S.spec = vec3(0.04); S.specMix = 0.0;
  vec2 p = vWPos.xz;
  int flags = int(vWall.y + 0.5);
  int mat = flags & 3;                       // 0 tar, 1 silver coat, 2 gravel ballast, 3 single-ply
  float fw = fwidth(p.x) + fwidth(p.y);
  float near = 1.0 - smoothstep(0.06, 0.5, fw);
  vec3 c = vTint;

  // recoat patchwork: nobody redoes a whole roof at once, they patch the half that leaks
  float big = fbm3(p * 0.09 + 11.0);
  float mid = fbm3(p * 0.33 + 4.0);
  c *= 0.82 + 0.40 * big;
  c *= 0.90 + 0.20 * mid;

  // ponding: the dead-flat low spots hold water for days and dry to a pale mineral ring
  float pondF = fbm3(p * 0.16 - 7.0);
  float pond = smoothstep(0.52, 0.70, pondF);
  float rim = smoothstep(0.46, 0.54, pondF) * (1.0 - smoothstep(0.56, 0.64, pondF));
  c = mix(c, c * 0.62, pond * 0.85);
  c = mix(c, c * 0.9 + vec3(0.055, 0.053, 0.048), rim);

  float rough = 0.93;
  if (mat == 1) {
    // sprayed aluminium: streaky along the roll, dulling to grey where sun and rain reach it
    c *= 0.88 + 0.24 * vnoise(vec2(p.x * 0.7, p.y * 9.0));
    c = mix(c, c * 0.72 + vec3(0.03), smoothstep(0.55, 0.85, big));
    rough = 0.60;
    S.metal = 0.12;
  } else if (mat == 2) {
    // pea gravel: 10-20 mm stones close up, a warm speckle that settles to its mean far away
    c *= 0.80 + 0.28 * vnoise(p * 55.0) + 0.20 * vnoise(p * 160.0) * near;
    rough = 0.96;
  } else if (mat == 3) {
    c *= 0.94 + 0.12 * vnoise(p * 6.0);
    rough = 0.72;
  } else {
    // asphalt cap sheet: kettle drips, chalking, the odd cold-patch repair
    c *= 0.85 + 0.30 * vnoise(p * 11.0);
    c = mix(c, c * 0.55, 0.5 * smoothstep(0.70, 0.86, mid));
    rough = 0.93;
  }

  // roll seams: 0.92 m sheets with a 8 cm lap, roll ends every ~9 m, running with the Manhattan grid
  vec2 q = mat2(0.875, -0.485, 0.485, 0.875) * p;
  float su = abs(fract(q.x / 0.92) - 0.5);
  float sv = abs(fract(q.y / 9.1) - 0.5);
  float seam = clamp((1.0 - smoothstep(0.02, 0.055, su)) + 0.7 * (1.0 - smoothstep(0.02, 0.05, sv)), 0.0, 1.0) * near;
  c *= 1.0 - (mat == 1 ? -0.16 : 0.26) * seam;

  // pigeons: chalky streaks where they sit, along the parapets and the mechanical boxes
  float lime = smoothstep(0.80, 0.93, vnoise(p * 3.2 + 21.0)) * smoothstep(0.55, 0.85, vnoise(p * 12.0));
  c = mix(c, vec3(0.60, 0.59, 0.55), 0.45 * lime * near);

  float pud = clamp(pond + 0.5 * smoothstep(0.44, 0.58, pondF), 0.0, 1.0) * uWet;
  S.alb = c * (1.0 - 0.42 * pud) * (1.0 - 0.18 * uWet);
  S.rough = mix(rough, 0.07, pud);
  S.n = N;
#ifdef USE_FACADE_TEX
  vec3 t3 = texture2D(uTexRoof, p * vec2(uTexScale.w, uTexScaleY.w)).rgb;
  S.alb *= mix(vec3(1.0), t3 * 1.8, 0.35 * near);
#endif
  return S;
}

Surf shadeTrim(vec3 N) {
  Surf S;
  S.emis = vec3(0.0); S.ao = 1.0; S.spec = vec3(0.04); S.specMix = 0.0;
  int flags = int(vWall.y + 0.5);
  bool metal = (flags & 8) != 0;
  bool dentils = (flags & 32) != 0;
  bool wood = (flags & 128) != 0;
  bool louvre = (flags & 256) != 0;
  vec3 c = vTint;
  float fw = fwidth(vUvM.x);
  float fade = smoothstep(0.05, 0.25, fw);
  float ltilt = 0.0;
  if (louvre) {
    // horizontal slats at 0.1 m, each catching the light on its top bevel
    float sl = fract(vUvM.y / 0.1);
    float lfade = smoothstep(0.02, 0.12, fwidth(vUvM.y));
    c *= mix(0.72 + 0.28 * smoothstep(0.0, 0.35, sl) * (1.0 - smoothstep(0.75, 1.0, sl)), 0.86, lfade);
    ltilt = (0.5 - sl) * 0.5 * (1.0 - lfade);
  }
  if (dentils && vUvM.y > 4.0 && vUvM.y < 6.0) {
    float d = step(0.5, fract(vUvM.x / 0.24));
    c *= mix(0.72, 1.0, mix(d, 0.85, fade));
  }
  if (wood) {
    float st = step(0.5, fract(vUvM.x / 0.14));
    c *= (0.86 + 0.14 * mix(st, 0.5, fade)) * (0.85 + 0.3 * vnoise(vec2(vUvM.x * 30.0, vUvM.y * 3.0)));
    // weathering: greyer up top
    c = mix(c, vec3(0.45, 0.42, 0.38), 0.35 * smoothstep(1.0, 4.0, vUvM.y));
  }
  // generic grime on horizontal-ish upward faces
  c *= 1.0 - 0.15 * fbm3(vWPos.xz * 2.0 + vWPos.y);
  c *= 1.0 - 0.3 * uWet;
  S.alb = c;
  S.rough = mix(vWall.z, 0.25, uWet * 0.5);
  S.metal = metal ? 0.9 : 0.0;
  S.n = louvre ? normalize(N + vec3(0.0, ltilt, 0.0)) : N;
  return S;
}

Surf shadeSign(vec3 N, bool lightbox) {
  Surf S;
  S.emis = vec3(0.0); S.ao = 1.0; S.metal = 0.0; S.spec = vec3(0.04); S.specMix = 0.0;
  int flags = int(vWall.y + 0.5);
  bool lightText = (flags & 128) != 0;
  bool redText = (flags & 256) != 0;
  vec3 bg = vTint;
  float row = floor(vUvM.y);
  float fy = vUvM.y - row;
  float text = 0.0;
  if (vUvM.y < uSignRows + 0.5) text = texture2D(uSignAtlas, vec2(vUvM.x, (row + (1.0 - fy)) / uSignRows)).r;
  vec3 tc = lightbox ? (lightText ? vec3(0.98) : redText ? vec3(0.75, 0.08, 0.05) : vec3(0.05, 0.05, 0.1)) : (lightText ? vec3(0.95) : vec3(0.05));
  if (lightbox && !lightText && redText) tc = vec3(0.75, 0.08, 0.05);
  if (lightbox && lightText && redText) tc = vec3(0.95, 0.85, 0.2);
  vec3 c = mix(bg, tc, text);
  float night = smoothstep(0.1, 0.5, uNight);
  // The baker stores this sign's wall and shop index (builder.ts storefronts) so the same hashes the facade
  // uses decide whether the shop under it is open: a dark shop does not leave its sign burning.
  uint sseed = uint(vInfo.z);
  uint swall = uint(vWall.x + 0.5);
  uint ssid = uint(vInfo.w + 0.5);
  float shopLit = shopLitState(sseed, swall, ssid, uNight);
  float gate = shopGateDown(sseed, swall, ssid, uNight);
  vec3 lampC = shopLampColor(sseed, swall, ssid);
  // a closed shop keeps its sign on about a third of the time (the timer nobody reset)
  float signOn = max(shopLit, step(hash4(sseed, 45u, swall, ssid), 0.32)) * (1.0 - 0.45 * gate);
  if (lightbox) {
    // Diffusing panel with tubes behind it: an EVEN face, tube ripple at a couple of per cent, a hair
    // brighter in the middle of the box than at the frame. SHOP_BOX_PEAK keeps the brightest channel under
    // lighting.ts's 2.0 limiter, so a white box stays a lit panel instead of clipping to paper white
    // (docs/ART_DIRECTION.md §2 Night sign caps, checklist 6).
    float even = 0.94 + 0.06 * sin(fy * 3.14159);
    float ripple = 0.985 + 0.015 * sin(vUvM.x * 42.0);
    float drive = SHOP_BOX_PEAK / max(max(max(bg.r, bg.g), bg.b), 0.35); // one tube luminance for the whole face
    S.emis = c * drive * even * ripple * night * signOn * (0.97 + 0.03 * step(0.5, fract(uTime * 3.0)));
    S.emis = min(S.emis, vec3(SHOP_BOX_PEAK)); // white lettering on a red box must not run past the panel
    S.rough = 0.35;
  } else {
    // canvas: stripes on some awnings, fabric noise, fading
    // stripes are the exception on NYC awnings (west-village 1-3: solid hunter green, black, burgundy)
    float stripes = step(0.5, fract(vUvM.x * 6.0)) * step(0.92, hash2(uint(vInfo.z), 44u));
    c = mix(c, mix(c, vec3(0.85, 0.83, 0.78), 0.55), stripes * (1.0 - text));
    // sun-faded, dusty top of the canvas
    c = mix(c, c * 0.85 + 0.06, 0.4 * step(0.5, N.y));
    c *= 0.85 + 0.2 * vnoise(vWPos.xz * 60.0 + vWPos.y * 40.0);
    c = mix(c, c * 0.8 + 0.1, 0.25 * fbm3(vWPos.xz * 1.5));
    S.rough = 0.85;
    // Underlit by the fascia goosenecks and by the shop below: the valance (facing the street) reads, the
    // underside reads more, the sloping top stays dark. Without this an awning is a black hole at night
    // where the photo shows the brightest lettering on the block (west-village 1-2, east-village 6).
    float face = 1.0 - smoothstep(0.0, 0.55, N.y);          // 1 on the valance and underside, 0 on the top
    float under = smoothstep(-0.25, -0.8, N.y);             // 1 only where the canvas looks down
    S.emis = (c + vec3(0.06) * under + vec3(0.10) * text) * lampC * (0.55 * face + 1.10 * under) * night * signOn;
  }
  S.alb = c;
  S.n = N;
  return S;
}
`,ce=`
{
  vec3 Vw = normalize(cameraPosition - vWPos);
  vec3 Nw = normalize(vWNorm);
  if (!gl_FrontFacing) Nw = -Nw;
  float distV = length(cameraPosition - vWPos);
  float detail = 1.0 - smoothstep(uDetailDist * 0.75, uDetailDist * 1.15, distV);
  int kind = int(vWall.w + 0.5);
  Surf S;
  if (kind == 0) S = shadeWall(Vw, Nw, detail);
  else if (kind == 1) S = shadeRoof(Nw);
  else if (kind == 3) S = shadeSign(Nw, true);
  else if (kind == 4) S = shadeSign(Nw, false);
  else if (kind == 5) {
    S.alb = vec3(0.6, 0.05, 0.02); S.rough = 0.3; S.metal = 0.0; S.n = Nw; S.ao = 1.0; S.spec = vec3(0.04); S.specMix = 0.0;
    float on = step(0.5, fract(uTime * 0.7 + hash2(uint(vInfo.z), 1u)));
    S.emis = vec3(1.0, 0.04, 0.02) * (0.4 + 5.0 * on) * uEmissive;
  }
  else S = shadeTrim(Nw);
  diffuseColor.rgb = S.alb;
  roughnessFactor = S.rough;
  metalnessFactor = S.metal;
  normal = normalize((viewMatrix * vec4(S.n, 0.0)).xyz);
  totalEmissiveRadiance += limitFacadeEmission(S.emis);
  facadeAO = S.ao;
  facadeSpec = S.spec;
  facadeSpecMix = S.specMix;
}
`;function le(e,t){let n=e.modules.get(`atmosphere`)?.uniforms,r=(e,t)=>{let r=n?.[e];return r&&typeof r.value==`number`?r:{value:t}},i=!!(n&&typeof n.uNight?.value==`number`&&typeof n.uTime?.value==`number`),a=e.quality.level;return{uStyle:{value:O()},uNight:r(`uNight`,0),uTime:r(`uTime`,0),uWet:r(`uWetness`,0),uDetailDist:{value:a===`ultra`||a===`high`?520:a===`medium`?380:260},uEmissive:{value:1.6},uSignAtlas:{value:t},uSignRows:{value:B},uSkyZenith:{value:new b(.3,.5,.9)},uSkyHorizon:{value:new b(.75,.8,.9)},uTexBrick:{value:null},uTexBrickN:{value:null},uTexStone:{value:null},uTexConcrete:{value:null},uTexRoof:{value:null},uTexScale:{value:new g(1,1,1,1)},uTexScaleY:{value:new g(1,1,1,1)},uTexBrickMean:{value:new o(.35,.3,.28)},uTexBrickNK:{value:0},shared:i}}function ue(e,t){let n=new c({color:16777215,roughness:.8,metalness:0,side:0,envMapIntensity:1});n.name=`facade`,t.textures&&(n.defines={USE_FACADE_TEX:``});let r=n.onBeforeCompile;return n.onBeforeCompile=(t,i)=>{r?.call(n,t,i);let{shared:a,...o}=e;for(let[e,n]of Object.entries(o))t.uniforms[e]=n;t.vertexShader=t.vertexShader.replace(`#include <common>`,`#include <common>
`+ae).replace(`#include <uv_vertex>`,`#include <uv_vertex>
`+oe),t.fragmentShader=t.fragmentShader.replace(`#include <common>`,`#include <common>
`+se).replace(`#include <normal_fragment_maps>`,`#include <normal_fragment_maps>
float facadeAO = 1.0;
vec3 facadeSpec = vec3(0.04);
float facadeSpecMix = 0.0;
`+ce).replace(`#include <lights_physical_fragment>`,`#include <lights_physical_fragment>
material.specularColorBlended = mix(material.specularColorBlended, facadeSpec, facadeSpecMix);`).replace(`#include <aomap_fragment>`,`#include <aomap_fragment>
reflectedLight.indirectDiffuse *= facadeAO;
reflectedLight.indirectSpecular *= facadeAO;
reflectedLight.directDiffuse *= mix(1.0, facadeAO, 0.5);`)},n.customProgramCacheKey=()=>`facade-v2-${t.textures?`tex`:`proc`}`,n}var de=[`OPEN`,`COLD BEER`,`BAR`,`OPEN 24 HRS`,`ATM`];function fe(e,t,n){e.beginPath();let r=n*.5,i=n*.26,a=t*.3,o=t*.7;for(let t=0;t<=48;t++){let n=t/48,s=a+(o-a)*n,c=r+Math.sin(n*Math.PI*3)*i;t===0?e.moveTo(s,c):e.lineTo(s,c)}e.stroke(),e.beginPath(),e.arc(a,r,n*.14,Math.PI*.5,Math.PI*1.5),e.stroke(),e.beginPath(),e.arc(o,r,n*.14,-Math.PI*.5,Math.PI*.5),e.stroke()}function pe(){let e=1024,t=document.createElement(`canvas`);t.width=e,t.height=64*B;let n=t.getContext(`2d`);if(n){n.clearRect(0,0,t.width,t.height),n.fillStyle=`#fff`,n.textAlign=`center`,n.textBaseline=`middle`;for(let t=0;t<16;t++){let r=H[t],i=[`bold 46px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`,`bold 44px Impact, "Arial Black", sans-serif`,`700 44px Futura, "Trebuchet MS", sans-serif`];n.font=i[t%i.length],n.save(),n.translate(e/2,t*64+32);let a=n.measureText(r).width,o=e*.46;a>o&&n.scale(o/a,1),n.fillText(r,0,0),n.restore()}n.strokeStyle=`#fff`,n.lineJoin=`round`,n.lineCap=`round`;for(let t=0;t<6;t++){let r=16+t;if(n.save(),n.translate(e/2,r*64+32),t<de.length){let r=de[t];n.font=`600 40px "Brush Script MT", "Segoe Script", "Helvetica Neue", Arial, sans-serif`,n.lineWidth=5;let i=n.measureText(r).width,a=e*.4;i>a&&n.scale(a/i,1),n.strokeText(r,0,0)}else n.translate(-512,-32),n.lineWidth=6,fe(n,e,64);n.restore()}}let r=new x(t);return r.colorSpace=``,r.minFilter=d,r.magFilter=m,r.generateMipmaps=!0,r.anisotropy=4,r.flipY=!1,r.needsUpdate=!0,r}var q=.4;async function me(e){let t=await n(e,{cache:`force-cache`});if(!t.ok)return null;let r=new Uint8Array(await t.arrayBuffer()),i=r.length>=2&&r[0]===31&&r[1]===139,a;if(i){let e=new Blob([r]).stream().pipeThrough(new DecompressionStream(`gzip`));a=await new Response(e).text()}else a=new TextDecoder().decode(r);return JSON.parse(a)}function he(e,t,n,r,i,a,o){let s=-i,c=r;for(let l of[-1,1])for(let u of[-1,1])if(!L(t+r*a*l+s*o*u,n+i*a*l+c*o*u,e))return!1;return L(t,n,e)}function ge(e,t,n){let r=e.cx*4*256,i=e.cz*4*256,a=[],o=[],s=[],c=[],l=[],u=[],d=[],f=[],p=1/0,m=1/0,h=1/0,g=-1/0,_=-1/0,v=-1/0,y=0,b=(e,t,n,u,d,f,y,b,x,S,C,w,T,E)=>{let D=e-r,O=n-i;return a.push(D,t,O),o.push(Math.round(u*255),Math.round(d*255),Math.round(f*255),y),s.push(b,x,S,C),c.push(w,t),l.push(T,E),D<p&&(p=D),D>g&&(g=D),t<m&&(m=t),t>_&&(_=t),O<h&&(h=O),O>v&&(v=O),a.length/3-1},x=(e,t,n,r,i,a,o,s,c,l=!1)=>{let d=e.length;for(let f=0;f<d;f++){let p=e[f],m=e[(f+1)%d],h=Math.hypot(m[0]-p[0],m[1]-p[1]),g=b(p[0],t,p[1],...r,i,a,o,s,c,0,h,f+1),_=b(m[0],t,m[1],...r,i,a,o,s,c,h,h,f+1),v=b(m[0],n,m[1],...r,i,a,o,s,c,h,h,f+1),y=b(p[0],n,p[1],...r,i,a,o,s,c,0,h,f+1);l?u.push(g,_,v,g,v,y):u.push(g,v,_,g,y,v)}},S=(e,t,n,r,i,o,s)=>{let c=te([e]);if(!c.length)return;let l=a.length/3;for(let[a,c]of e)b(a,t,c,...n,r,t,i,o,s,0,0,0);for(let t=0;t<c.length;t+=3){let n=e[c[t]],r=e[c[t+1]],i=e[c[t+2]];(r[0]-n[0])*(i[1]-n[1])-(i[0]-n[0])*(r[1]-n[1])<0?u.push(l+c[t],l+c[t+1],l+c[t+2]):u.push(l+c[t],l+c[t+2],l+c[t+1])}},C=(e,t,n,r,i,a,o,s,c,l,u)=>{let d=-r,f=n,p=[[e-n*i-d*a,t-r*i-f*a],[e+n*i-d*a,t+r*i-f*a],[e+n*i+d*a,t+r*i+f*a],[e-n*i+d*a,t-r*i+f*a]];R(p)<0&&p.reverse(),x(p,o,s,c,254,s,u,3,3),S(p,s,l,255,u,3,3)};for(let a of e.buildings){let e=u.length,o=Math.max(3,a.height);if(o<n)continue;let s=P(a.footprint);if(!s)continue;let c=k(a.id),l=E(a,c),p=F(s[0],.6),m=I(p,.25);m&&(p=m);let h=l.tint,g=l.style===5?1:.6,_=[];if(a.roofShape===`setback`&&o>60){let e=I(p,3.5),t=e?I(e,3.5):null;e&&t?_.push({ring:p,base:0,top:o*.55-q},{ring:e,base:o*.55-q,top:o*.82-q},{ring:t,base:o*.82-q,top:o-q}):e?_.push({ring:p,base:0,top:o*.7-q},{ring:e,base:o*.7-q,top:o-q}):_.push({ring:p,base:0,top:o-q})}else _.push({ring:p,base:0,top:o-q});let v=V(c),b=z(c,v),w=l.style===5||l.style===6?[.34,.34,.35]:h;for(let e of _){x(e.ring,e.base,e.top+g,h,l.style,e.top,c,l.floorH,l.gfH);let t=o>8?I(e.ring,.3):null;t&&Math.abs(R(t))/2>40?(x(t,e.top,e.top+g,w,253,e.top,c,l.floorH,l.gfH,!0),S(t,e.top,b,255,c,l.floorH,l.gfH)):S(e.ring,e.top+g,b,255,c,l.floorH,l.gfH)}let D=_[_.length-1],O=Math.abs(R(D.ring))/2;if(!(a.roofShape===`pitched`&&o<16&&O<400)&&o>9&&O>70){let e=D.top+q,t=D.ring,n=D.top,s=e;if((l.style===5||l.style===6)&&o>40&&O>300){let r=I(D.ring,2.5+T(c,45)*2);if(r&&Math.abs(R(r))/2>=60){let i=l.style===5?.46:.5,a=3.6+T(c,46)*1.8;x(r,D.top,e+a,[i,i,i*1.02],254,e+a,c,l.floorH,l.gfH),S(r,e+a,b,255,c,l.floorH,l.gfH),t=r,n=e+a,s=e+a}}let u=Math.abs(R(t))/2,f=N(t),p=-f.uz,m=f.ux,h=[],g=T(c,41)<.5?-1:1;for(let e of[2.6,4.5]){let t=f.halfL-e,n=f.halfW-e;if(!(t<=.5||n<=.5))for(let e of[-g,g])for(let r of[-1,1])h.push([f.cx+f.ux*t*e+p*n*r,f.cz+f.uz*t*e+m*n*r])}h.push([f.cx,f.cz]);let _=0,v=(e,n)=>{for(;_<h.length;_++){let r=h[_];if(he(t,r[0],r[1],f.ux,f.uz,e/2+.4,n/2+.4))return _++,r}return null},y=l.style===5||l.style===6?[.55,.55,.53]:[.5,.42,.36],w=v(3,4);if(w&&C(w[0],w[1],f.ux,f.uz,1.5,2,n,s+2.9,y,[.22,.22,.22],c),u>180){let e=[.46,.46,.47],t=Math.min(3,Math.round(u/520)+1);for(let r=0;r<t;r++){let t=v(2,1.4);if(!t)break;C(t[0],t[1],f.ux,f.uz,1,.7,n,s+1,e,[.2,.2,.2],c)}}if(u>400&&o>28&&T(c,54)<.5){let e=v(3.2,2.4);e&&C(e[0],e[1],f.ux,f.uz,1.5,1.1,n,s+2.2+T(c,71)*1.2,[.5,.5,.5],[.3,.3,.3],c)}if(a.hasWaterTower&&u>90){let e=v(4.2,4.2);e&&d.push(e[0]-r,s,e[1]-i,4+T(c,42)*2)}}t.has(a.id)&&f.push({bin:a.id,start:e,count:u.length-e}),y++}return a.length?{type:`chunk`,key:e.key,ox:r,oz:i,position:new Float32Array(a),data:new Uint8Array(o),info:new Float32Array(s),uv:new Float32Array(c),wall:new Float32Array(l),index:new Uint32Array(u),renderIndex:new Uint32Array(u),towers:new Float32Array(d),bounds:{cx:(p+g)/2,cy:(m+_)/2,cz:(h+v)/2,r:Math.hypot(g-p,_-m,v-h)/2},buildings:y,landmarkRanges:f}:null}typeof self<`u`&&(self.onmessage=async e=>{let t=e.data;if(t.type!==`start`)return;let n=new Set(t.landmarkBins),r=new Map,i=t.keys.slice(),a=new Map;for(let e of i){let[n,i]=e.split(`_`).map(Number),o=Math.floor(n/4),s=Math.floor(i/4),c=`${o}_${s}`,l=r.get(c);if(!l){let e=(o+.5)*4*256,n=(s+.5)*4*256;l={key:c,cx:o,cz:s,pending:new Set,buildings:[],dist:Math.hypot(e-t.focusX,n-t.focusZ)},r.set(c,l)}l.pending.add(e),a.set(e,l)}i.sort((e,n)=>{let[r,i]=e.split(`_`).map(Number),[a,o]=n.split(`_`).map(Number);return Math.hypot((r+.5)*256-t.focusX,(i+.5)*256-t.focusZ)-Math.hypot((a+.5)*256-t.focusX,(o+.5)*256-t.focusZ)});let o=0,s=0,c=0,l=i.length,u=(e,t)=>self.postMessage(e,t??[]),d=e=>{let r=ge(e,n,t.minHeight);e.buildings=[],s++,r&&u(r,[r.position.buffer,r.data.buffer,r.info.buffer,r.uv.buffer,r.wall.buffer,r.index.buffer,r.renderIndex.buffer,r.towers.buffer])},f=async()=>{for(;c<i.length;){let e=i[c++],n=a.get(e);try{let r=t.tiles?t.tiles.find(t=>t.key===e):await me(`${t.baseUrl}/tiles/${e}.json.gz`);if(r?.buildings)for(let e of r.buildings)n.buildings.push({id:e.id,footprint:e.footprint,height:e.height,year:e.year,floors:e.floors,bldgClass:e.bldgClass,landUse:e.landUse,style:e.style,roofShape:e.roofShape,hasWaterTower:e.hasWaterTower,groundElev:0})}catch{}o++,n.pending.delete(e),n.pending.size===0&&d(n),(o%8==0||o===l)&&u({type:`progress`,fetched:o,total:l,chunks:s,done:o===l})}};await Promise.all([f(),f(),f(),f()]),u({type:`progress`,fetched:o,total:l,chunks:s,done:!0})});function _e(e){let t=e.modules.get(`landmarks`);return t?.builtBins??t?.built}function ve(e,t,n){let r=0;for(let e of t)n.has(e.bin)&&(r+=e.count);if(!r)return e;let i=new Uint32Array(e.length-r),a=0,o=0;for(let r of t)n.has(r.bin)&&(i.set(e.subarray(a,r.start),o),o+=r.start-a,a=r.start+r.count);return i.set(e.subarray(a),o),i}function J(e,t,n,r){let i=ve(t,n,r);n.length&&(e.index.array.set(i),e.index.needsUpdate=!0),e.setDrawRange(0,i.length)}var ye=`
{
  vec4 fwp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  fwp = instanceMatrix * fwp;
  #endif
  vWPosF = (modelMatrix * fwp).xyz;
}
`,be=`
uniform vec3 uFocus;
uniform float uNearR;
varying vec3 vWPosF;
`,xe=`
attribute vec4 aData;
attribute vec4 aInfo;
attribute vec2 aWall;
flat varying vec4 vData;
flat varying vec4 vInfo;
flat varying vec2 vWall;
varying vec2 vUvM;
varying vec3 vWPosF;
`,Se=`
vData = aData;
vInfo = aInfo;
vWall = aWall;
vUvM = uv;
`,Ce=`
uniform float uNight;
uniform float uTime;
uniform float uEmissive;
uniform vec4 uStyle[33];
flat varying vec4 vData;
flat varying vec4 vInfo;
flat varying vec2 vWall;
varying vec2 vUvM;
${be}
${M}
${W}
${ie}
${U}
${K}
float hashfF(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoiseF(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashfF(i), hashfF(i + vec2(1, 0)), f.x), mix(hashfF(i + vec2(0, 1)), hashfF(i + vec2(1, 1)), f.x), f.y);
}
float fbmF(vec2 p) { return vnoiseF(p) * 0.5 + vnoiseF(p * 2.03) * 0.3 + vnoiseF(p * 4.1) * 0.2; }
`,we=`
{
  int style = int(vData.a * 255.0 + 0.5);
  vec3 tint = vData.rgb;
  float H = vInfo.x;
  uint seed = uint(vInfo.y + 0.5);
  vec3 alb = tint;
  float rough = 0.85, metal = 0.0;
  vec3 emis = vec3(0.0);
  farSpec = vec3(0.04); farSpecMix = 0.0;
  float u = vUvM.x, v = vUvM.y;
  // rooftop boxes and parapet lips exist in the near tiles too: ours stop where those are resident
  if (style >= 253 && style < 255 && distance(vWPosF.xz, uFocus.xz) < uNearR) discard;
  if (style == 255) {
    // Roof membrane, matched term for term to buildings/shader.ts shadeRoof so nothing shifts across the
    // LOD line: 10 m recoat patches, 3 m batch variation, ponding stains with a chalky dried rim, and the
    // silver coat's dulling. Distance keeps all of it - this is what stops a roof reading as a pale slab.
    vec2 rp = vWPosF.xz;
    float rmat = hash2(seed, 40u);
    float rbig = fbmF(rp * 0.09 + 11.0);
    float rpond = fbmF(rp * 0.16 - 7.0);
    vec3 rc = tint * (0.82 + 0.40 * rbig) * (0.90 + 0.20 * fbmF(rp * 0.33 + 4.0));
    rc = mix(rc, rc * 0.62, smoothstep(0.52, 0.70, rpond) * 0.85);
    rc = mix(rc, rc * 0.9 + vec3(0.055, 0.053, 0.048), smoothstep(0.46, 0.54, rpond) * (1.0 - smoothstep(0.56, 0.64, rpond)));
    if (rmat < 0.28) { // silver aluminium coat
      rc = mix(rc, rc * 0.72 + vec3(0.03), smoothstep(0.55, 0.85, rbig));
      rough = 0.6; metal = 0.12;
    } else if (rmat < 0.86) rough = 0.94;
    else rough = 0.72;
    alb = rc;
  } else if (style == 254) {
    // stair bulkheads and louvred mechanical screens: painted metal, horizontal slats
    float slat = 0.5 + 0.5 * sin(v * 6.2831853 / 0.15);
    float fade = smoothstep(0.05, 0.3, fwidth(v));
    alb = tint * mix(0.72 + 0.28 * slat, 0.86, fade);
    rough = 0.55; metal = 0.25;
  } else if (style == 253) {
    alb = tint * 0.9;
  } else {
    vec4 P0 = uStyle[style * 3], P1 = uStyle[style * 3 + 1];
    float floorH = vInfo.z, gfH = vInfo.w;
    // Baked face-local coordinates are stable even on distant, oblique walls.
    float fl, fb, fh;
    if (style == 1) {
      fl = v < 1.7 ? 0.0 : v < 5.5 ? 1.0 : 2.0 + floor((v - 5.5) / floorH);
      fb = fl < 1.0 ? 0.0 : fl < 2.0 ? 1.7 : 5.5 + (fl - 2.0) * floorH;
      fh = fl < 1.0 ? 1.7 : fl < 2.0 ? 3.8 : floorH;
    } else {
      fl = v < gfH ? 0.0 : 1.0 + floor((v - gfH) / floorH);
      fb = fl < 1.0 ? 0.0 : gfH + (fl - 1.0) * floorH;
      fh = fl < 1.0 ? gfH : floorH;
    }
    float sp = P0.w, wl = vWall.x;
    float nCols = max(0.0, floor((wl - (style == 5 ? 0.0 : 1.4)) / sp));
    float cu = (u - (wl - nCols * sp) * 0.5) / sp;
    float ww = style == 5 ? sp - 0.09 : P0.y;
    float sill = style == 5 ? 0.9 : P1.x;
    float head = min(sill + P0.z, fh - 0.12);
    if (style == 1 && fl == 1.0) { sill = 0.6; head = 3.35; ww = 1.15; }
    if (style == 5) head = fh - 0.25;
    float fwU = fwidth(u) / sp, fwV = fwidth(v) / fh;
    float win = windowCoverage(cu, 0.5 - ww / sp * 0.5, 0.5 + ww / sp * 0.5, fwU)
      * windowCoverage((v - fb) / fh, sill / fh, head / fh, fwV);
    win *= step(0.0, cu) * (1.0 - step(nCols, cu)) * step(fb + head, H - 0.35);
    uint column = uint(vWall.y + 0.5) * 256u + uint(max(0.0, floor(cu)));
    // masonry: limestone / brick at its real tone, the prewar brick shaft over a stone base, the base
    // reading darker under a light belt course (fifth-42nd 1)
    vec3 wall = tint;
    bool stoneStyle = style == 2 || style == 4 || style == 9;
    bool brickShaft = style == 4 && hash2(seed, 14u) < 0.55;
    if (brickShaft && fl >= 3.0) wall = lodShaftTint(seed, tint);
    if (stoneStyle) {
      float baseFloors = brickShaft ? 3.0 : P1.w;
      float baseTop = gfH + (baseFloors - 1.0) * floorH;
      wall *= 1.0 - 0.12 * step(v, baseTop - 0.45);
      wall *= 1.0 + 0.12 * step(abs(v - (baseTop - 0.22)), max(0.22, fwidth(v)));
    }
    if (style == 5) {
      // curtain wall at bay resolution (same families as the near shader): dark tinted vision glass over a
      // darker spandrel band, or an anodised panel band; the coated glass reflects the sky at 20-35 %
      float cwK = hash2(seed, 4u);
      float ph = hash3(seed, column, uint(fl)), p2 = hash3(seed, column, uint(fl) + 977u);
      vec3 vision = tint * 0.06 * (0.85 + 0.3 * hash3(seed, column, uint(fl) + 906u));
      bool panelSp = cwK >= 0.35 && cwK < 0.7 && hash2(seed, 903u) >= 0.5;
      vec3 spandrel = panelSp ? vec3(0.13, 0.13, 0.14) : tint * (cwK < 0.35 ? 0.05 : cwK < 0.7 ? 0.055 : 0.045);
      alb = mix(spandrel, vision, win);
      metal = panelSp ? 0.6 * (1.0 - win) : 0.0;
      rough = mix(panelSp ? 0.5 : 0.3, 0.05 + 0.1 * ph, win);
      farSpec = lodGlassF0(tint) * mix(0.85, 1.0, win); farSpecMix = panelSp ? win : 1.0;
      // per-panel bow so the sky reflection breaks up floor to floor and bay to bay
      float panel = 1.0 - smoothstep(0.35, 0.9, max(fwU, fwV));
      vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      vec3 tV = normalize(cross(upV, normal));
      normal = normalize(normal + (tV * (ph - 0.5) * 0.09 + upV * (p2 - 0.5) * 0.07) * panel);
      if (lodCrownBand(v, H, fh) > 0.5) {
        alb = lodLouvre(vec3(0.3, 0.31, 0.32), v, fwidth(v));
        rough = 0.55; metal = 0.3; farSpecMix = 0.0; win = 0.0;
      }
    } else {
      alb = mix(wall, vec3(0.05, 0.06, 0.07), win);
      // Once a 2.6 m bay is sub-pixel, win is a coverage fraction, but a surface that is part mirror and
      // part matte keeps the SHARP lobe: averaging roughness linearly turned every masonry tower at 1 km
      // into a dull rough-0.7 slab with no sky sheen and no face-to-face contrast. sqrt gives the glass
      // the weight it has in the highlight while the albedo still averages linearly.
      rough = mix(0.85, 0.22, sqrt(win));
    }
    if (uNight > 0.15) {
      float litFrac = P1.y * uStyle[style * 3 + 2].z;
      vec3 light = farWindowLight(style, seed, fl + (v - fb) / fh, litFrac, fwV);
      // Unresolved bays contribute their area, never a random on/off window multiplied by coverage.
      float band = (ww / sp) * windowCoverage((v - fb) / fh, sill / fh, head / fh, fwV);
      band *= step(0.0, cu) * (1.0 - step(nCols, cu)) * step(fb + head, H - 0.35);
      if (style == 5) band *= 1.0 - lodCrownBand(v, H, fh);
      emis = light * band * smoothstep(0.15, 0.6, uNight) * uEmissive * 0.55;
      // Hue-preserving HDR ceiling, before exposure/bloom; near and mid emission keep their own limit.
      emis *= min(1.0, 1.5 / max(max(emis.r, max(emis.g, emis.b)), 0.0001));
    }
    // Retain the cornice shadow band after its sub-metre geometry stops resolving.
    float cornice = step(0.5, uStyle[style * 3 + 2].x);
    alb *= 1.0 - cornice * 0.25 * smoothstep(H - 1.25, H - 0.5, v);
    alb *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, 2.0, v));
  }
  diffuseColor.rgb = alb;
  roughnessFactor = rough;
  metalnessFactor = metal;
  totalEmissiveRadiance += limitFacadeEmission(emis);
}
`;function Te(){let e=[],t=[],n=[],r=[],i=[],o=[.36,.26,.18],s=[.28,.2,.14],c=[.2,.2,.21],l=(i,a,o,s,c,l)=>(e.push(i,a,o),r.push(...s),t.push(...c),n.push(l),e.length/3-1),u=(e,t,n)=>i.push(e,t,n),d=1.55;for(let[e,t]of[[-1,-1],[1,-1],[1,1],[-1,1]]){let n=e*d,r=t*d,i=.08;for(let e of[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){let t=e[2],a=-e[0],o=n+e[0]*i,s=r+e[2]*i,d=l(o-t*i,0,s-a*i,e,c,1),f=l(o+t*i,0,s+a*i,e,c,1),p=l(o+t*i,1,s+a*i,e,c,1),m=l(o-t*i,1,s-a*i,e,c,1);u(d,p,f),u(d,m,p)}}for(let[t,n,r,i]of[[0,-1,1,0],[0,1,1,0],[-1,0,0,1],[1,0,0,1]])for(let a of[.45,.9]){let o=[n,0,t],s=t*d+o[0]*.04,f=n*d+o[2]*.04,p=l(s-r*d,a,f-i*d,o,c,1),m=l(s+r*d,a,f+i*d,o,c,1),h=l(s+r*d,a,f+i*d,o,c,1),g=l(s-r*d,a,f-i*d,o,c,1);e[h*3+1]+=.06,e[g*3+1]+=.06,u(p,h,m),u(p,g,h)}let f=1.85,m=(e,t,n,r)=>{let i=[];for(let a=0;a<12;a++){let o=a/12*Math.PI*2,s=Math.cos(o),c=Math.sin(o),u=Math.hypot(1,r);i.push(l(s*t,e,c*t,[s/u,r/u,c/u],n,0))}return i},h=(e,t)=>{for(let n=0;n<12;n++){let r=(n+1)%12;u(e[n],t[r],e[r]),u(e[n],t[n],t[r])}};h(m(-.6,.9,s,-1.2),m(0,f,s,-1.2)),h(m(0,f,o,0),m(4,f,o,0)),h(m(4,2,s,1.2),m(5.3,.25,s,1.2));let g=l(0,5.3+.1,0,[0,1,0],s,0),_=m(5.3,.25,s,1.2);for(let e=0;e<12;e++)u(_[e],g,_[(e+1)%12]);let v=new p;return v.setAttribute(`position`,new a(e,3)),v.setAttribute(`normal`,new a(r,3)),v.setAttribute(`color`,new a(t,3)),v.setAttribute(`aPart`,new a(n,1)),v.setIndex(i),v.computeBoundingSphere(),v}function Ee(e,t,n){let r=new u;r.name=`buildings-far`,e.worldGroup.add(r);let i={chunks:0,fetched:0,total:0,done:!1,buildings:0,towers:0},a=new Map,l=new Map,d=new Map,m=null,g=!1,b=!1,x=0,C=S(e),T,E=new Set,D={uFocus:{value:new o},uNearR:{value:Math.max(0,e.quality.drawDistance-200)}},O=e.modules.get(`atmosphere`),k=new c({color:16777215,roughness:.85,metalness:0,flatShading:!0,depthFunc:2,depthWrite:!0,transparent:!1});k.name=`facade-far`,k.onBeforeCompile=e=>{e.uniforms.uStyle=t.uStyle,e.uniforms.uNight=t.uNight,e.uniforms.uTime=t.uTime,e.uniforms.uEmissive=t.uEmissive,e.uniforms.uFocus=D.uFocus,e.uniforms.uNearR=D.uNearR,e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
`+xe).replace(`#include <uv_vertex>`,`#include <uv_vertex>
`+Se).replace(`#include <begin_vertex>`,`#include <begin_vertex>
`+ye),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+Ce).replace(`#include <normal_fragment_maps>`,`#include <normal_fragment_maps>
vec3 farSpec = vec3(0.04);
float farSpecMix = 0.0;
`+we).replace(`#include <lights_physical_fragment>`,`#include <lights_physical_fragment>
material.specularColor = mix(material.specularColor, farSpec, farSpecMix);
material.specularColorBlended = mix(material.specularColorBlended, farSpec, farSpecMix);`)},k.customProgramCacheKey=()=>`facade-far-grid-v7`,O?.setupMaterial?.(k);let A=Te(),j=new c({vertexColors:!0,roughness:.8,metalness:0,depthFunc:2,depthWrite:!0});j.name=`facade-far-towers`,j.onBeforeCompile=e=>{e.uniforms.uFocus=D.uFocus,e.uniforms.uNearR=D.uNearR,e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
attribute float aPart;
attribute float aStand;
varying vec3 vWPosF;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
transformed.y = aPart > 0.5 ? transformed.y * aStand : transformed.y + aStand;
`+ye),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+be).replace(`#include <normal_fragment_maps>`,`#include <normal_fragment_maps>
if (distance(vWPosF.xz, uFocus.xz) < uNearR) discard;`)},j.customProgramCacheKey=()=>`facade-far-towers-v1`,O?.setupMaterial?.(j);function*M(e){if(a.has(e.key))return;let t=new p;t.setAttribute(`position`,new h(e.position,3)),yield,t.setAttribute(`aData`,new h(e.data,4,!0)),yield,t.setAttribute(`aInfo`,new h(e.info,4)),t.setAttribute(`uv`,new h(e.uv,2)),t.setAttribute(`aWall`,new h(e.wall,2)),t.setIndex(new h(e.renderIndex,1)),J(t,e.index,e.landmarkRanges,n),e.landmarkRanges.length&&d.set(e.key,{index:e.index,ranges:e.landmarkRanges}),t.boundingSphere=new f(new o(e.bounds.cx,e.bounds.cy,e.bounds.cz),e.bounds.r),t.boundingBox=null;let c=new _(t,k);c.position.set(e.ox,0,e.oz),c.castShadow=!1,c.receiveShadow=!1,c.frustumCulled=!0,c.name=`far-${e.key}`,c.renderOrder=1,r.add(c),a.set(e.key,c),i.chunks++,i.buildings+=e.buildings;let u=e.towers.length/4;if(u>0){yield;let t=new v(A,j,u),n=new Float32Array(u),a=new s;for(let r=0;r<u;r++){let i=r*4;a.makeTranslation(e.towers[i],e.towers[i+1],e.towers[i+2]),t.setMatrixAt(r,a),n[r]=e.towers[i+3]}let o=A.clone();o.setAttribute(`aStand`,new y(n,1)),t.geometry=o,t.instanceMatrix.needsUpdate=!0,t.position.set(e.ox,0,e.oz),t.castShadow=!1,t.receiveShadow=!1,t.frustumCulled=!0,t.computeBoundingSphere(),t.boundingSphere&&(t.boundingSphere.radius+=12),t.renderOrder=1,t.name=`far-towers-${e.key}`,r.add(t),l.set(e.key,t),i.towers+=u}}function N(){let t=e.world.index;if(!t||g||b||(g=!0,i.total=t.tiles.length,typeof Worker>`u`))return;try{m=new Worker(new URL(`/world/assets/far.worker-BYt2J0PM.js`,``+import.meta.url),{type:`module`,name:`buildings-far`})}catch(e){console.warn(`[buildings] far worker unavailable`,e);return}T=C.job(`far skyline request`),m.onmessage=e=>{let t=e.data;if(t.type===`chunk`){let e=C.job(`far:${t.key}`);E.add(e),e.run((function*(){try{yield*M(t)}finally{E.delete(e)}})())}else i.fetched=t.fetched,t.done&&T?.cancel(),i.done=t.done&&!E.size,t.done&&console.info(`[buildings] far skyline: ${i.chunks} chunks, ${i.buildings} buildings, ${i.towers} water towers from ${t.total} tiles`)},m.onerror=e=>{T?.cancel(),m?.terminate(),console.warn(`[buildings] far worker error`,e.message)},m.onmessageerror=()=>{T?.cancel(),m?.terminate()};let n=e.world.focus??e.camera.position,r=e.world.baseUrl??`/world`,a=e.quality.level===`mobile`?Array.from(e.world.tiles.values()):void 0,o={type:`start`,baseUrl:r,keys:a?a.map(e=>e.key):t.tiles.slice(),tiles:a,focusX:n.x,focusZ:n.z,landmarkBins:Array.from(w),minHeight:e.quality.level===`low`?8:0};m.postMessage(o)}return{group:r,stats:i,update(){D.uFocus.value.copy(e.world.focus??e.camera.position),!g&&!x&&globalThis.__ready&&(x=requestAnimationFrame(()=>{x=0,N()})),g&&T&&!T.pending&&!E.size&&(i.done=!0)},syncLandmarks(){for(let[e,t]of d)J(a.get(e).geometry,t.index,t.ranges,n)},dispose(){C.dispose(),b=!0,cancelAnimationFrame(x),T?.cancel();for(let e of E)e.cancel();E.clear(),m?.terminate(),m=null;for(let e of a.values())r.remove(e),e.geometry.dispose();for(let e of l.values())r.remove(e),e.geometry.dispose(),e.dispose();a.clear(),l.clear(),d.clear(),A.dispose(),k.dispose(),j.dispose(),e.worldGroup.remove(r)}}}var Y=t(`/assets/textures`),De=new WeakSet;function Oe(e){if(!e)return[];if(Array.isArray(e))return e;let t=e;return Array.isArray(t.textures)?t.textures:Array.isArray(t.items)?t.items:Array.isArray(t.entries)?t.entries:Object.entries(t).filter(([,e])=>e&&typeof e==`object`).map(([e,t])=>({id:e,...t}))}function ke(e){return`${e.id??``} ${e.name??``} ${e.path??``} ${e.dir??``} ${(e.tags??[]).join(` `)} ${e.category??``}`.toLowerCase()}function Ae(e,t){if(!t)return null;if(t.startsWith(`/`)||t.startsWith(`http`))return t;let n=e.path??e.dir??``;return n?`${Y}/${n.replace(/^\/?assets\/textures\/?/,``).replace(/\/$/,``)}/${t}`.replace(/\/+/g,`/`):`${Y}/${t}`.replace(/\/+/g,`/`)}function X(e){let t=e.maps??e.files??{};return Ae(e,e.albedo??e.color??e.diffuse??t.albedo??t.color??t.diffuse??t.baseColor??t.basecolor??t.base_color??t.diff)}function je(e){let t=e.maps??e.files??{};return Ae(e,e.normal??t.normal??t.nor??t.normalGL??t.nor_gl)}function Me(e){if(e.userData.linearMean)return e.userData.linearMean;try{let t=e.image;if(!t||!t.width||!t.height)return null;let n=document.createElement(`canvas`);n.width=n.height=32;let r=n.getContext(`2d`,{willReadFrequently:!0});if(!r)return null;r.drawImage(t,0,0,32,32);let i=r.getImageData(0,0,32,32).data,a=[0,0,0],o=e=>e<=.04045?e/12.92:((e+.055)/1.055)**2.4;for(let e=0;e<i.length;e+=4)a[0]+=o(i[e]/255),a[1]+=o(i[e+1]/255),a[2]+=o(i[e+2]/255);let s=i.length/4;return[a[0]/s,a[1]/s,a[2]/s]}catch{return null}}function Z(e,t){let n=e.physicalSizeM??e.sizeM??e.size,r=(e,t)=>typeof e==`number`&&Number.isFinite(e)&&e>0?e:t;if(Array.isArray(n))return[r(n[0],t),r(n[1],t)];let i=r(n,t),[a,o]=e.sizePx??[1,1];return[i,i*r(o,1)/r(a,1)]}function Ne(e,t){return/limestone-block(?:\/|$)/.test(e.path??e.dir??``)?[1.2,1.5]:Z(e,t)}async function Q(e,t,n=!0,r){try{let a=await ne(e);return a.wrapS=a.wrapT=i,a.colorSpace=n?l:``,a.anisotropy=Math.min(8,t.capabilities.getMaxAnisotropy()),await r?.(a),a}catch{return null}}async function Pe(e,t,r){if(De.has(t))return!0;let i;try{let e=await n(`${Y}/manifest.json`,{cache:`no-cache`});if(!e.ok)return!1;i=await e.json()}catch{return!1}let a=Oe(i);if(!a.length)return!1;let o=(...e)=>a.find(t=>e.every(e=>ke(t).includes(e))&&X(t)),s=o(`brick`)??o(`bricks`),c=o(`limestone`)??o(`sandstone`)??o(`stone`,`wall`)??o(`stone`),l=o(`concrete`,`panels`)??o(`concrete`),u=o(`roof`,`gravel`)??o(`gravel`)??o(`asphalt`)??o(`tar`);if(!s)return!1;let d=je(s),[f,p,m,h,g]=await Promise.all([Q(X(s),e,!0,r),c?Q(X(c),e,!0,r):Promise.resolve(null),l?Q(X(l),e,!0,r):Promise.resolve(null),u?Q(X(u),e,!0,r):Promise.resolve(null),d?Q(d,e,!1,r):Promise.resolve(null)]);if(!f){for(let e of[p,m,h,g])e?.dispose();return!1}t.uTexBrick.value=f;let _=Me(f);_&&t.uTexBrickMean.value.set(_[0],_[1],_[2]),g&&(t.uTexBrickN.value=g,t.uTexBrickNK.value=1),t.uTexStone.value=p??f,t.uTexConcrete.value=m??f,t.uTexRoof.value=h??f;let v=Z(s,1),y=[v,p&&c?Ne(c,2):v,m&&l?Ne(l,2):v,h&&u?Z(u,2):v];return t.uTexScale.value.fromArray(y.map(([e])=>1/e)),t.uTexScaleY.value.fromArray(y.map(([,e])=>1/e)),De.add(t),console.info(`[buildings] textures: brick=${X(s)} stone=${c?X(c):`-`} concrete=${l?X(l):`-`} roof=${u?X(u):`-`}`),!0}var Fe=2,$=16;async function Ie(t){let n=new u;n.name=`buildings`,t.worldGroup.add(n);let i=S(t),a=!1,s=new Set,c=pe(),l=i.job(`building signs`);l.run((function*(){yield c})());let d=le(t,c),m=ue(d,{textures:!1}),g=t.modules.get(`atmosphere`);g?.setupMaterial?.(m);let v=new Map,y=new Set,b={tiles:0,verts:0,tris:0,buildMs:0,lastBuildMs:0,commitMs:0,far:{chunks:0,fetched:0,total:0,done:!1,buildings:0}},x=t.quality.farDistance>t.quality.drawDistance?Ee(t,d,y):null;x&&(b.far=x.stats);let E=[],D=[],O=0,k=new Map;if(typeof Worker<`u`)for(let e=0;e<Fe;e++)try{let t=new Worker(new URL(`/world/assets/builder.worker-D9_Czkt3.js`,``+import.meta.url),{type:`module`,name:`buildings-${e}`}),n={w:t,busy:!1,id:0};t.onmessage=e=>{n.busy=!1;let t=k.get(e.data.id);k.delete(e.data.id),e.data.error&&console.warn(`[buildings] build failed for ${e.data.key}: ${e.data.error}`),t&&v.get(t.key)===t&&t.pendingId===e.data.id&&(t.pendingId=0,e.data.tile?t.job?.run(L(t,e.data.tile)):t.job?.cancel()),P()};let r=()=>{if(t.terminate(),k.get(n.id)?.job?.cancel(),k.delete(n.id),E.splice(E.indexOf(n),1),E.length)P();else{for(let e of D)e.job?.cancel();D.length=0}console.warn(`[buildings] worker failed; pending job cancelled`)};t.onerror=e=>{e.preventDefault(),r()},t.onmessageerror=r,E.push(n)}catch(e){console.warn(`[buildings] worker unavailable`,e);break}function M(e){let n=[],r=e.tx*256-3,i=(e.tx+1)*256+3,a=e.tz*256-3,o=(e.tz+1)*256+3;for(let s=-1;s<=1;s++)for(let c=-1;c<=1;c++){if(!s&&!c)continue;let l=t.world.tiles.get(C(e.tx+s,e.tz+c));if(l)for(let e of l.buildings){let t=e.footprint[0];if(!t)continue;let s=1/0,c=-1/0,l=1/0,u=-1/0;for(let[e,n]of t)e<s&&(s=e),e>c&&(c=e),n<l&&(l=n),n>u&&(u=n);c<r||s>i||u<a||l>o||n.push(e)}}return n}function N(e){let n=e.tile;return{key:n.key,tx:n.tx,tz:n.tz,buildings:n.buildings,roads:n.roads,landmarkBins:Array.from(w),neighbours:M(n),quality:t.quality.level===`mobile`?`low`:t.quality.level}}function P(){for(;D.length;){let e=E.find(e=>!e.busy);if(!e)return;let t=D.shift();if(v.get(t.key)!==t||!t.job?.pending)continue;let n=++O;t.pendingId=n,k.set(n,t),e.busy=!0,e.id=n;try{e.w.postMessage({id:n,input:N(t)})}catch(r){e.busy=!1,k.delete(n),t.job?.cancel(),console.warn(`[buildings] dispatch failed`,r)}}}function F(e){v.has(e.key)&&I(e.key);let t={key:e.key,tile:e,mesh:null,built:null,grid:null,colliderDone:!1,pendingId:0};v.set(e.key,t),!(!e.buildings.length||a)&&(t.job=i.job(`buildings:${e.key}`),E.length?(D.push(t),P()):(t.job.cancel(),console.warn(`[buildings] tile skipped: no geometry worker`,e.key)))}function I(e){let r=v.get(e);if(!r)return;v.delete(e),k.delete(r.pendingId),r.pendingId=0,r.job?.cancel();let i=D.indexOf(r);i>=0&&D.splice(i,1),r.mesh&&=(n.remove(r.mesh),r.mesh.geometry.dispose(),b.verts-=r.mesh.geometry.getAttribute(`position`)?.count??0,b.tris-=r.mesh.geometry.drawRange.count/3,null),t.physics.removeTileColliders(`bld:${e}`),r.built=null,r.grid=null,b.tiles=v.size}function*L(r,i){if(v.get(i.key)!==r)return;let a=performance.now(),s=new p;try{s.setAttribute(`position`,new h(i.position,3)),yield,s.setAttribute(`normal`,new h(i.normal,3)),yield,s.setAttribute(`uv`,new h(i.uv,2)),yield,s.setAttribute(`color`,new h(i.color,3)),yield,s.setAttribute(`aInfo`,new h(i.info,4)),yield,s.setAttribute(`aWall`,new h(i.wall,4)),yield,s.setIndex(new h(i.renderIndex,1)),J(s,i.index,i.landmarkRanges,y),s.boundingSphere=new f(new o(i.bounds.cx,i.bounds.cy,i.bounds.cz),i.bounds.r),s.boundingBox=null;let c=new _(s,m);c.position.set(i.ox,0,i.oz),c.castShadow=!0,c.receiveShadow=!0,c.frustumCulled=!0,c.name=`bld-${i.key}`,e()||(yield t.renderer.compileAsync(c,t.camera,t.scene)),J(s,i.index,i.landmarkRanges,_e(t)??y),n.add(c),r.mesh=c,r.built=i,r.grid=i.grid,b.verts+=i.position.length/3,b.tris+=s.drawRange.count/3,b.buildMs+=i.stats.ms,b.lastBuildMs=i.stats.ms,b.tiles=v.size,b.commitMs=performance.now()-a,t.state.debug&&console.info(`[buildings] ${i.key}: ${i.stats.buildings} buildings, ${i.position.length/3|0} verts, build ${i.stats.ms.toFixed(1)} ms, commit ${b.commitMs.toFixed(2)} ms`),yield,yield*R(r)}finally{r.mesh?.geometry!==s&&s.dispose()}}function*R(e){let n=e.built;if(n){t.physics.removeTileColliders(`bld:${e.key}`);for(let r of n.colliders){if(r.bin!==void 0&&y.has(r.bin))continue;for(;t.physics.ready===!1;)yield;let i=t.physics.RAPIER.ColliderDesc.trimesh(r.position,r.index).setTranslation(n.ox,0,n.oz).setFriction(.6),a=t.physics.world.createCollider(i);t.physics.addTileColliders(`bld:${e.key}`,[a],`building`),yield}e.colliderDone=!0}}function te(){let e=_e(t),n=!1;for(let t of w){let r=e?.has(t)??!1;r!==y.has(t)&&(n=!0,r?y.add(t):y.delete(t))}if(n){for(let e of v.values()){let n=e.built;if(!n?.landmarkRanges.length||!e.mesh)continue;let r=e.mesh.geometry;b.tris-=r.drawRange.count/3,J(r,n.index,n.landmarkRanges,y),e.storefronts=void 0,b.tris+=r.drawRange.count/3,t.physics.removeTileColliders(`bld:${e.key}`),e.colliderDone=!1,e.job?.cancel(),e.job=i.job(`building landmark colliders:${e.key}`),e.job.run(R(e))}x?.syncLandmarks()}}function ne(e){let t=v.get(e),n=t?.built,i=t?.mesh?.geometry;if(!t||!n||!i)return;if(t.storefronts)return t.storefronts;let a=[],o=new Set;for(let e=0;e<i.drawRange.count;e+=3){let t=i.index.getX(e),s=t*4;if(n.wall[s+3]!==0||n.uv[t*2]!==0||n.uv[t*2+1]!==0||o.has(t))continue;o.add(t);let c=n.wall[s+1],l=n.wall[s],u=n.wall[s+2],f=Math.floor(n.info[s+2]/65536),p=n.info[s+2]%65536;if(!(c&1)||!(c&2)||c&512||n.info[s+3]>.05||f===9||f===10||u<3.5||f===5&&c&64&&u>=4.5&&l>8)continue;let m=Math.floor(c/j),{n:h,w:g}=re(l,p,m),_=n.normal[t*3],v=n.normal[t*3+2];for(let e=0;e<h;e++){let i=(e+.5)*g,o=T(p,28,m,e),s=T(p,22,m,e),c=T(p,41,m,e);a.push({x:n.ox+n.position[t*3]-v*i,z:n.oz+n.position[t*3+2]+_*i,nx:_,nz:v,width:g,color:c<.42?[1,.76,.5]:c<.78?[1,.88,.7]:[.8,.9,1],get lit(){let e=d.uNight.value,t=r.smoothstep(e,.1,.5);return s<=.06+.34*r.smoothstep(e,.2,.8)?0:(o<=.85?.35:0)*(1-t)+ +(o<=.82)*t}})}}return t.storefronts=a}function z(e,t){let n=Math.floor(e/256),r=Math.floor(t/256),i=v.get(C(n,r));if(!i?.grid||!i.built)return null;let a=Math.min(15,Math.max(0,Math.floor((e-n*256)/(256/$)))),o=Math.min(15,Math.max(0,Math.floor((t-r*256)/(256/$)))),s=i.grid[o*$+a];for(let n=0;n<s.length;n++){let r=i.tile.buildings[s[n]];if(r&&ee(e,t,r.footprint))return r}return null}let B=!1,V=0,H=0;async function U(){H++;let e=i.job(`facade textures`),n=!1;try{n=await Pe(t.renderer,d,e=>{if(a)return e.dispose(),Promise.resolve();s.add(e);let t=i.job(`facade upload`);return t.run((function*(){yield e})()),t.done})}finally{e.cancel()}if(!a&&n&&!B){B=!0;let e=m;m=ue(d,{textures:!0}),g?.setupMaterial?.(m);for(let e of v.values())e.mesh&&(e.mesh.material=m);e.dispose(),console.info(`[buildings] facade textures enabled`)}}for(let e of t.world.tiles.values())F(e);let W=t.events.on(`tileLoaded`,F),G=t.events.on(`tileUnloaded`,I);return U(),{name:`buildings`,stats:b,storefronts:ne,update(e,n){te(),A(d.uStyle.value,t.time.dayFraction*24),d.shared||(d.uTime.value=n,d.uNight.value=1-t.time.daylight,d.uWet.value=t.state.weather.wetness??0),x?.update(),!B&&H<40&&(V+=e,V>30&&(V=0,U()))},isInside(e,t){return z(e,t)!==null},buildingAt(e,n){let r=z(e,n);if(r)return r;let i=t.world.buildingsNear(e,n,3);return i.length?i[0]:null},dispose(){i.dispose(),a=!0,l.cancel(),W(),G();for(let e of Array.from(v.keys()))I(e);for(let e of E)e.w.terminate();x?.dispose(),m.dispose();for(let e of s)e.dispose();s.clear(),c.dispose(),t.worldGroup.remove(n)}}}export{Ie as createBuildings};
//# sourceMappingURL=buildings-BDmduZ8y.js.map