/**
 * Integer hashing shared by the CPU (geometry baking: AC units, awnings, stoops...) and the GPU facade shader
 * (window lights, blinds, shop types). Both sides MUST produce identical results, so everything is 32-bit
 * unsigned integer math (Math.imul / >>> 0 here, uint in GLSL).
 */

/** lowbias32 (Chris Wellons) */
export function lowbias32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** hash of up to four small non-negative integers -> [0,1) */
export function hash4(a: number, b = 0, c = 0, d = 0): number {
  let h = lowbias32((a >>> 0) + 0x9e3779b1);
  h = lowbias32((h ^ (b >>> 0)) + 0x85ebca6b);
  h = lowbias32((h ^ (c >>> 0)) + 0xc2b2ae35);
  h = lowbias32(h ^ (d >>> 0));
  return (h >>> 8) / 16777216;
}

/** building seed: 16-bit value derived from the BIN so it survives a float attribute exactly */
export function seedOf(bin: number): number {
  return lowbias32(bin >>> 0) & 0xffff;
}

/** the same functions in GLSL (ES 3.00) */
export const HASH_GLSL = /* glsl */ `
uint lowbias32(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x;
}
float hash4(uint a, uint b, uint c, uint d) {
  uint h = lowbias32(a + 0x9e3779b1u);
  h = lowbias32((h ^ b) + 0x85ebca6bu);
  h = lowbias32((h ^ c) + 0xc2b2ae35u);
  h = lowbias32(h ^ d);
  return float(h >> 8u) / 16777216.0;
}
float hash2(uint a, uint b) { return hash4(a, b, 0u, 0u); }
float hash3(uint a, uint b, uint c) { return hash4(a, b, c, 0u); }
`;
