/** Box-filter a repeating window opening over a pixel footprint, in bay/floor units.
 * Unlike step/fract, this preserves the grid's mean when a bay becomes subpixel.
 */
export function windowCoverage(p: number, lo: number, hi: number, footprint: number): number {
  const integral = (x: number) => Math.floor(x) * (hi - lo) + Math.max(0, Math.min(hi - lo, x - Math.floor(x) - lo));
  const w = Math.max(footprint, 0.00001);
  return Math.max(0, Math.min(1, (integral(p + w * 0.5) - integral(p - w * 0.5)) / w));
}

/**
 * Emissive gain on a lit opening in the mid LOD, chosen so the brightest part of an interior (the ceiling by
 * the fixture) lands near 1.6 linear and the sill near 0.55 — inside the 2.0 headroom `limitFacadeEmission`
 * leaves for bloom, and matching the near shader's interior-mapped range so nothing pops across the LOD line.
 * docs/ART_DIRECTION.md §2 Night: no lit window is ever a flat white rectangle.
 */
export const WINDOW_LIGHT_GAIN = 0.62;

/**
 * Shared window-light GLSL (near facade, mid/far grid, far skyline). `litFrac` is the style's 22:30 value times
 * the hour ramp (styles.ts updateLitRamp). Offices (prewar 4, glass 5, civic 9): whole floors on or off, then
 * runs of three bays share a state, then a per-window dropout: never a checkerboard. Residential: independent.
 */
export const WINDOW_GRID_GLSL = /* glsl */ `
float windowIntegral(float x, float lo, float hi) {
  return floor(x) * (hi - lo) + clamp(fract(x) - lo, 0.0, hi - lo);
}
float windowCoverage(float p, float lo, float hi, float footprint) {
  float w = max(footprint, 0.00001);
  return clamp((windowIntegral(p + w * 0.5, lo, hi) - windowIntegral(p - w * 0.5, lo, hi)) / w, 0.0, 1.0);
}
bool officeStyle(int style) { return style == 4 || style == 5 || style == 9; }
float windowLit(int style, uint seed, uint wid, uint fl, float litFrac) {
  float k = hash4(seed, wid, fl, 5u);
  if (!officeStyle(style)) return step(k, litFrac);
  float floorP = clamp(litFrac * 1.8, 0.0, 1.0);
  float floorOn = step(hash3(seed, 900u, fl), floorP);
  float run = hash4(seed, fl, wid / 3u, 901u);
  float within = litFrac / max(floorP, 0.001);
  return floorOn * step(run, within) * step(k, 0.9);
}
vec3 windowLightColor(int style, uint seed, uint wid, uint fl) {
  vec3 c;
  if (officeStyle(style)) {
    // one fixture type per floor: mostly cool fluorescent / LED, some warm
    float t = hash3(seed, 902u, fl);
    c = t < 0.5 ? vec3(0.85, 0.9, 1.0) : t < 0.8 ? vec3(1.0, 0.95, 0.85) : vec3(1.0, 0.85, 0.65);
  } else {
    float t = hash4(seed, wid, fl, 201u);
    c = t < 0.6 ? vec3(1.0, 0.85, 0.65) : vec3(0.85, 0.9, 1.0);
  }
  return c * (0.85 + 0.3 * hash4(seed, wid, fl, 202u));
}
/** Vertical falloff inside one lit opening: the ceiling and its fixture carry the light, the sill sits two
 * to three stops down. t = 0 at the sill, 1 at the head; the mean over an opening is ~0.93. */
float windowInterior(float t) { return 0.45 + 0.95 * smoothstep(0.0, 0.85, t); }
/** Window light colour that keeps its warm / cool identity once a bay stops resolving: the per-window tint
 * blends into the tint shared by its run of four bays on that floor, never into neutral white
 * (docs/ART_DIRECTION.md §8, "uniform lit windows"). resU = 1 while bays resolve, 0 once they do not. */
vec3 windowLightColorLOD(int style, uint seed, uint wid, uint fl, float resU) {
  return mix(windowLightColor(style, seed, wid / 4u * 4u, fl), windowLightColor(style, seed, wid, fl), resU);
}
`;

/** Skyline emission has no bay samples: filter coherent floor means into a building mean before floors
 * become subpixel. Kept separate from the near/mid grid so their resolved interiors are unchanged. */
export const FAR_WINDOW_LIGHT_GLSL = /* glsl */ `
float farFloorMean(int style, uint seed, uint fl, float litFrac) {
  if (!officeStyle(style)) return litFrac * (0.6 + 0.8 * hash3(seed, 912u, fl));
  float floorP = clamp(litFrac * 1.8, 0.0, 1.0);
  return step(hash3(seed, 900u, fl), floorP) * litFrac / max(floorP, 0.001) * 0.9;
}
vec3 farWindowLight(int style, uint seed, float floorCoord, float litFrac, float footprint) {
  float buildingMean = litFrac * (0.55 + 0.9 * hash2(seed, 910u));
  if (hash2(seed, 911u) < 0.12) buildingMean *= 0.3;
  // Smooth between floor centres, then lose floor detail as the pixel spans a floor. Neither occupancy
  // nor fixture colour depends on a column, face, fragment coordinate, or time.
  float p = max(0.0, floorCoord - 0.5);
  uint fl = uint(floor(p));
  float t = smoothstep(0.0, 1.0, fract(p));
  float floorMean = mix(farFloorMean(style, seed, fl, litFrac), farFloorMean(style, seed, fl + 1u, litFrac), t);
  float resolved = 1.0 - smoothstep(0.15, 0.75, footprint);
  vec3 buildingColor = mix(vec3(1.0, 0.85, 0.65), vec3(0.85, 0.9, 1.0), hash2(seed, 902u));
  return buildingColor * mix(min(buildingMean, 0.85), floorMean, resolved);
}
`;
