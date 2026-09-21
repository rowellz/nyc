/** Keep filtered window geometry and shopfronts, with inexpensive mobile light
 * occupancy. No per-window textures, lights, or extra geometry are allocated.
 */
// Per-fragment world distance, including altitude. Pixel footprint can only
// reduce detail: zooming in must not make an entire distant tower expensive.
const SURFACE_LOD = `
float mobileSurfaceDetail(vec3 position, vec2 footprint) {
  float proximity = 1.0 - smoothstep(144.0, 240.0, distance(cameraPosition, position));
  float resolved = 1.0 - smoothstep(0.16, 0.5, max(footprint.x, footprint.y));
  return proximity * resolved;
}
`;

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw Error(`Mobile surface LOD anchor changed: ${before}`);
  return source.replace(before, after);
}

const WINDOW_LIGHT = `
vec3 mobileWindowLight(int style, uint seed, uint wid, uint fl, float litFrac) {
  float room = hash4(seed, wid, fl, 5u);
  float on = step(room, litFrac);
  float color = room;
  if (officeStyle(style)) {
    float floorState = hash3(seed, 900u, fl);
    float floorP = clamp(litFrac * 1.8, 0.0, 1.0);
    on = step(floorState, floorP) * step(room, litFrac / max(floorP, 0.001));
    color = floorState / max(floorP, 0.001);
  }
  // Normalize the lit subset so both warm and cool rooms survive sparse occupancy.
  float tone = officeStyle(style) ? color : color / max(litFrac, 0.001);
  return mix(vec3(1.0, 0.85, 0.65), vec3(0.85, 0.9, 1.0), step(0.6, tone)) * on;
}
`;

/** Custom towers use a separate material from ordinary streamed buildings. */
export function mobileLandmarkShader(source) {
  source = replaceOnce(source, 'float lmHash21(vec2 p) {', SURFACE_LOD + `
float mobileLmDetail;
float lmHash21(vec2 p) {`);
  // All landmark noise calls become constant outside the local detail band;
  // the branch skips the hash work rather than only multiplying its result.
  source = replaceOnce(source, 'float lmNoise(vec2 p) {', `float lmNoise(vec2 p) {
  if (mobileLmDetail <= 0.0) return 0.5;`);
  source = replaceOnce(source, 'return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    'return mix(0.5, mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mobileLmDetail);');
  source = replaceOnce(source, 'lmHash21(cell + 9.0)',
    '(mobileLmDetail > 0.0 ? mix(0.5, lmHash21(cell + 9.0), mobileLmDetail) : 0.5)');
  const start = source.indexOf('vec3 lmWindowLight('), end = source.indexOf('vec3 lmGlass(', start);
  if (start < 0 || end < start) throw Error('Mobile landmark light anchors changed');
  source = source.slice(0, start) + WINDOW_LIGHT + `
vec3 lmWindowLight(vec2 grid, vec2 lo, vec2 hi, float density) {
  vec2 fw = fwidth(grid);
  float resolved = 1.0 - smoothstep(0.25, 0.75, max(fw.x, fw.y));
  float coverage = windowCoverage(grid.x, lo.x, hi.x, fw.x)
    * windowCoverage(grid.y, lo.y, hi.y, fw.y);
  float litFrac = clamp(density * uLmLitRamp, 0.0, 0.85);
  if (uNight <= 0.15 || coverage <= 0.001 || resolved <= 0.001 || litFrac <= 0.0) return vec3(0.0);
  uint seed = uint(vLmSeed) + uint(uSeed);
  uint wid = uint(max(0.0, floor(grid.x))), fl = uint(max(0.0, floor(grid.y)));
  return mobileWindowLight(5, seed, wid, fl, litFrac)
    * coverage * resolved * smoothstep(0.15, 0.6, uNight) * 0.992;
}
` + source.slice(end);
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const signature of ['float windowLit(', 'vec3 windowLightColor(',
    'float windowInterior(', 'vec3 windowLightColorLOD(', 'float farFloorMean(', 'vec3 farWindowLight(']) {
    const begin = source.indexOf(signature);
    if (begin < 0) throw Error(`Missing landmark light helper: ${signature}`);
    let finish = source.indexOf('{', begin), depth = 1;
    while (depth && ++finish < source.length) {
      if (source[finish] === '{') depth++;
      else if (source[finish] === '}') depth--;
    }
    if (depth) throw Error(`Unbalanced landmark light helper: ${signature}`);
    source = source.slice(0, begin) + source.slice(finish + 1);
  }
  return source;
}

/** Main chunk is separate from landmark helpers in the mirrored material. */
export function mobileLandmarkMain(source) {
  source = replaceOnce(source, '  vec2 f = vFuv;', `  vec2 f = vFuv;
  mobileLmDetail = mobileSurfaceDetail(vWPos, fwidth(vFuv));`);
  source = replaceOnce(source, 'float tint = lmHash21(vec2(bi, fl) * 0.37);',
    'float tint = mobileLmDetail > 0.0 ? mix(0.5, lmHash21(vec2(bi, fl) * 0.37), mobileLmDetail) : 0.5;');
  // Fade fine ESB steel strips into their mean coverage, leaving the major
  // window/spandrel rhythm and floodlighting intact at every height.
  source = replaceOnce(source,
    '    float stripe = lmBox(bx, bayW * 0.5 - halfW, bayW * 0.5 + halfW, fwidth(f.x)) * (1.0 - lmBox(bx, (bayW - winW) * 0.5, (bayW + winW) * 0.5, fwidth(f.x)));', `
    float stripeFw = fwidth(f.x);
    float stripe = 0.4 / bayW;
    if (mobileLmDetail > 0.0) {
      float fineStripe = lmBox(bx, bayW * 0.5 - halfW, bayW * 0.5 + halfW, stripeFw)
        * (1.0 - lmBox(bx, (bayW - winW) * 0.5, (bayW + winW) * 0.5, stripeFw));
      stripe = mix(stripe, fineStripe, mobileLmDetail);
    }`);
  return source;
}

export function mobileFacadeShader(source) {
  const near = source.indexOf('  // ---- parallax recess');
  const roof = source.indexOf('Surf shadeRoof(vec3 N) {');
  const trim = source.indexOf('Surf shadeTrim(vec3 N) {');
  if (near < 0 || roof < near || trim < roof || !source.includes('if (fw > 0.16) {')) {
    throw Error('Mobile facade shader anchors changed');
  }
  source = source.slice(0, near).replace('if (fw > 0.16) {', '{') + '}\n' + `
Surf shadeRoof(vec3 N) {
  Surf S;
  S.alb = vTint * (1.0 - 0.18 * uWet);
  S.rough = mix(0.88, 0.65, uWet);
  S.n = N;
  S.emis = vec3(0.0); S.ao = 1.0; S.metal = 0.0;
  S.spec = vec3(0.04); S.specMix = 0.0;
  return S;
}
` + source.slice(trim);
  source = replaceOnce(source, '  float fw = max(fwU, fwV);', `  float fw = max(fwU, fwV);
  detail = mobileSurfaceDetail(vWPos, vec2(fwU, fwV));`);
  const lights = source.indexOf('    // ---- window lights:');
  const shops = source.indexOf('    // ---- the ground-floor shopfront course:', lights);
  if (lights < 0 || shops < lights) throw Error('Mobile window light anchors changed');
  const lighting = `
    // Derivatives/coverage were computed above, outside this conditional.
    // Skip emission on wall pixels, by day, and once windows are subpixel.
    vec3 surfaceLight = vec3(0.0);
    float lightResolution = 1.0 - smoothstep(0.25, 0.75, max(fu, fv));
    if (uNight > 0.15 && win > 0.001 && lightResolution > 0.001 && litFrac > 0.0) {
      vec3 light = mobileWindowLight(style, seed, wid, uint(fl), litFrac);
      surfaceLight = light * lightResolution * nightK * uEmissive * 0.62;
    }
`;
  source = source.slice(0, lights) + '    S.emis += surfaceLight * win;\n' + source.slice(shops);
  // Share the exact same window layout and light occupancy across both tiers.
  // Every derivative above is evaluated before the distance-dependent return.
  source = replaceOnce(source, '    // ---- wall tone:', lighting + `
    // Only the transition needs both surfaces. Near walls use the detailed
    // result directly; distant walls return before the detailed work below.
    Surf coarse;
    if (detail < 1.0) {
    coarse = S;
    coarse.emis = surfaceLight * win;
    vec3 coarseTint = brickShaft && fl >= 3 ? shaftTint(seed, tint) : tint;
    coarse.n = N;
    coarse.alb = mix(coarseTint, vec3(0.055, 0.065, 0.085), win);
    coarse.rough = mix(0.85, 0.12, win);
    coarse.spec = mix(vec3(0.04), vec3(0.05), win);
    coarse.specMix = win * 0.9;
    if (style == 5) {
      coarse.alb = tint * mix(0.05, 0.07, win);
      coarse.rough = mix(0.3, 0.1, win);
      coarse.spec = lodGlassF0(tint) * mix(0.85, 1.0, win);
      coarse.specMix = 1.0;
      float crown = lodCrownBand(v, H, fh);
      coarse.alb = mix(coarse.alb, vec3(0.258, 0.267, 0.275), crown);
      coarse.rough = mix(coarse.rough, 0.55, crown);
      coarse.metal = 0.3 * crown;
      coarse.specMix *= 1.0 - crown;
      coarse.emis *= 1.0 - crown;
    }
    float coarseWet = uWet * (0.25 + 0.6 * (1.0 - smoothstep(0.0, 4.0, v)));
    coarse.alb *= 1.0 - 0.35 * coarseWet;
    coarse.rough = mix(coarse.rough, 0.3, coarseWet);
    if (detail <= 0.0) return coarse;
    }

    // ---- wall tone:`);
  source = replaceOnce(source, '    return S;', `
    if (detail < 1.0) {
    S.alb = mix(coarse.alb, S.alb, detail);
    S.rough = mix(coarse.rough, S.rough, detail);
    S.metal = mix(coarse.metal, S.metal, detail);
    S.n = normalize(mix(coarse.n, S.n, detail));
    S.emis = mix(coarse.emis, S.emis, detail);
    S.ao = mix(coarse.ao, S.ao, detail);
    S.spec = mix(coarse.spec, S.spec, detail);
    S.specMix = mix(coarse.specMix, S.specMix, detail);
    }
    return S;`);
  // Strip unused desktop light/interior helpers from WebKit's compilation
  // input as well. Remove comments before matching function braces.
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const [type, name] of [
    ['vec3', 'roomInterior'], ['vec3', 'shopInterior'],
    ['float', 'lodWindowLit'], ['float', 'windowLit'],
    ['vec3', 'windowLightColorLOD'], ['vec3', 'windowLightColor'], ['float', 'windowInterior'],
  ]) {
    const start = source.indexOf(`${type} ${name}(`);
    if (start < 0) throw Error(`Missing facade helper: ${name}`);
    let end = source.indexOf('{', start), depth = 1;
    while (depth && ++end < source.length) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}') depth--;
    }
    if (depth) throw Error(`Unbalanced facade helper: ${name}`);
    source = source.slice(0, start) + source.slice(end + 1);
  }
  return source.replace('Surf shadeWall(', WINDOW_LIGHT + SURFACE_LOD + '\nSurf shadeWall(');
}
