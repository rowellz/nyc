import { basePath as __launchBasePath, mountedFetch as __launchFetch } from '@/core/basePath';
/**
 * Textures for the environment module.
 *  - Procedural PBR sets (albedo / normal / roughness) generated at startup from seeded, tileable value noise:
 *    asphalt, concrete, lawn grass, decomposed-granite gravel (Bryant Park), soil/mulch, water normal, three
 *    bark types (mottled plane, dark furrowed, smooth grey) and one leaf-cluster card per tree archetype.
 *  - loadManifestTextures(): when client/public/assets/textures/manifest.json lists real CC0 textures, those
 *    replace the procedural ones in place (same THREE.Texture objects are NOT reused: the caller swaps uniforms).
 * Normal maps use the OpenGL convention (green = toward decreasing v). World-space sampling in the shaders maps
 * v to +z (south), so "image up" is north; loaded textures get flipY=false to match.
 */
import * as THREE from 'three';

export type Arch = 'plane' | 'locust' | 'pear' | 'ginkgo' | 'oak';
export const ARCHS: Arch[] = ['plane', 'locust', 'pear', 'ginkgo', 'oak'];
export type BarkKind = 'plane' | 'dark' | 'grey';

export interface PbrSet {
  map: THREE.Texture;
  normal: THREE.Texture;
  rough: THREE.Texture | null;
  /** meters covered by one repeat */
  size: number;
  procedural: boolean;
}

export interface TexSet {
  asphalt: PbrSet;
  concrete: PbrSet;
  grass: PbrSet;
  gravel: PbrSet;
  soil: PbrSet;
  waterNormal: THREE.Texture;
  bark: Record<BarkKind, PbrSet>;
  leaves: Record<Arch, THREE.Texture>;
  crowns: Record<Arch, THREE.Texture>;
}

// ------------------------------------------------------------------------------------------------
// noise
// ------------------------------------------------------------------------------------------------
function ihash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** tileable value noise: x,y in cell units, periodic with (px, py) cells */
function vnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const wx = (i: number) => ((i % px) + px) % px;
  const wy = (i: number) => ((i % py) + py) % py;
  const a = ihash(wx(ix), wy(iy), seed), b = ihash(wx(ix + 1), wy(iy), seed);
  const c = ihash(wx(ix), wy(iy + 1), seed), d = ihash(wx(ix + 1), wy(iy + 1), seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}
/** tileable fbm, output normalised to 0..1. u,v in 0..1; cells = base frequency */
function fbm(u: number, v: number, cellsX: number, cellsY: number, oct: number, seed: number, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, fx = cellsX, fy = cellsY;
  for (let o = 0; o < oct; o++) {
    sum += vnoise(u * fx, v * fy, fx, fy, seed + o * 31) * amp;
    norm += amp;
    amp *= gain;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

// ------------------------------------------------------------------------------------------------
// texture helpers
// ------------------------------------------------------------------------------------------------
let maxAniso = 4;
export function setAnisotropy(a: number): void {
  maxAniso = Math.min(8, Math.max(1, a));
}

function dataTex(rgba: Uint8Array, w: number, h: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function* colorTex(rgb: Float32Array, w: number, h: number): TextureRecipe<THREE.DataTexture> {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    if (i % w === 0) yield;
    out[j] = clamp01(rgb[i * 3]) * 255;
    out[j + 1] = clamp01(rgb[i * 3 + 1]) * 255;
    out[j + 2] = clamp01(rgb[i * 3 + 2]) * 255;
    out[j + 3] = 255;
  }
  return dataTex(out, w, h, true);
}

function* heightToNormal(hgt: Float32Array, w: number, h: number, strength: number): TextureRecipe<THREE.DataTexture> {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    yield;
    const y0 = (y - 1 + h) % h, y1 = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const x0 = (x - 1 + w) % w, x1 = (x + 1) % w;
      const dhdx = (hgt[y * w + x1] - hgt[y * w + x0]) * 0.5 * strength;
      const dhdv = (hgt[y1 * w + x] - hgt[y0 * w + x]) * 0.5 * strength;
      // OpenGL convention: R = -dh/dx, G = +dh/dv (v increases downward in the image)
      let nx = -dhdx, ny = dhdv, nz = 1;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      const j = (y * w + x) * 4;
      out[j] = (nx * 0.5 + 0.5) * 255;
      out[j + 1] = (ny * 0.5 + 0.5) * 255;
      out[j + 2] = (nz * 0.5 + 0.5) * 255;
      out[j + 3] = 255;
    }
  }
  return dataTex(out, w, h, false);
}

function* roughTex(r: Float32Array, w: number, h: number): TextureRecipe<THREE.DataTexture> {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    if (i % w === 0) yield;
    const v = clamp01(r[i]) * 255;
    out[j] = v;
    out[j + 1] = v; // three reads roughness from G
    out[j + 2] = v;
    out[j + 3] = 255;
  }
  return dataTex(out, w, h, false);
}

interface Field {
  rgb: Float32Array;
  h: Float32Array;
  r: Float32Array;
}
function* field(w: number, hh: number, fn: (u: number, v: number, x: number, y: number, o: number[]) => void): TextureRecipe<Field> {
  const rgb = new Float32Array(w * hh * 3), h = new Float32Array(w * hh), r = new Float32Array(w * hh);
  const o = [0, 0, 0, 0, 0.8];
  for (let y = 0; y < hh; y++) {
    yield;
    for (let x = 0; x < w; x++) {
      fn(x / w, y / hh, x, y, o);
      const i = y * w + x;
      rgb[i * 3] = o[0];
      rgb[i * 3 + 1] = o[1];
      rgb[i * 3 + 2] = o[2];
      h[i] = o[3];
      r[i] = o[4];
    }
  }
  return { rgb, h, r };
}
function* toSet(f: Field, w: number, h: number, size: number, normalStrength: number, withRough: boolean): TextureRecipe<PbrSet> {
  return { map: yield* colorTex(f.rgb, w, h), normal: yield* heightToNormal(f.h, w, h, normalStrength), rough: withRough ? yield* roughTex(f.r, w, h) : null, size, procedural: true };
}

// ------------------------------------------------------------------------------------------------
// generators (colours are sRGB 0..1)
// ------------------------------------------------------------------------------------------------
function* genAsphalt(S: number): TextureRecipe<PbrSet> {
  const f = yield* field(S, S, (u, v, _x, _y, o) => {
    const mac = fbm(u, v, 6, 6, 4, 11);
    const spk = fbm(u, v, 120, 120, 2, 12);
    const fine = vnoise(u * S, v * S, S, S, 13);
    const crackN = fbm(u + 0.31, v + 0.17, 5, 5, 3, 14);
    const crack = sstep(0.035, 0.0, Math.abs(crackN - 0.5)) * sstep(0.48, 0.62, mac);
    const spkS = sstep(0.42, 0.78, spk);
    const worn = sstep(0.6, 0.8, fbm(u + 0.7, v + 0.2, 3, 3, 3, 15));
    const L = 0.26 + 0.09 * (mac - 0.5) + 0.11 * (spkS - 0.4) + 0.05 * (fine - 0.5) - 0.42 * crack + 0.07 * worn;
    o[0] = L * 1.0;
    o[1] = L * 1.0;
    o[2] = L * 1.03;
    o[3] = spkS * 0.6 + fine * 0.25 + mac * 0.15 - crack * 1.5;
    o[4] = 0.8 + 0.15 * spkS - 0.12 * worn;
  });
  return yield* toSet(f, S, S, 2.4, 2.2, true);
}

function* genConcrete(S: number): TextureRecipe<PbrSet> {
  const f = yield* field(S, S, (u, v, _x, _y, o) => {
    const mac = fbm(u, v, 4, 4, 4, 21);
    const fine = fbm(u, v, 64, 64, 3, 22);
    const pits = sstep(0.72, 0.86, vnoise(u * 200, v * 200, 200, 200, 23));
    const stains = sstep(0.56, 0.78, fbm(u + 0.3, v + 0.6, 3, 3, 3, 24));
    const L = 0.55 + 0.07 * (mac - 0.5) + 0.06 * (fine - 0.5) - 0.09 * pits - 0.11 * stains;
    o[0] = L;
    o[1] = L * 0.985;
    o[2] = L * 0.955;
    o[3] = fine * 0.5 + mac * 0.3 - pits;
    o[4] = 0.74 + 0.1 * fine - 0.06 * stains;
  });
  return yield* toSet(f, S, S, 3.0, 1.6, true);
}

function* genGrass(S: number): TextureRecipe<PbrSet> {
  const f = yield* field(S, S, (u, v, _x, _y, o) => {
    const clump = fbm(u, v, 22, 22, 4, 31);
    const streak = vnoise(u * 180, v * 26, 180, 26, 32);
    const streak2 = vnoise(u * 90 + 3, v * 14, 90, 14, 33);
    const dry = sstep(0.56, 0.74, fbm(u, v, 3, 3, 3, 34));
    const dark = sstep(0.0, 0.35, clump);
    const lush = [0.27, 0.40, 0.12], mid = [0.38, 0.46, 0.17], dryC = [0.58, 0.51, 0.27];
    for (let c = 0; c < 3; c++) {
      let col = lerp(lerp(lush[c], mid[c], clump), dryC[c], dry * 0.8);
      col *= (0.7 + 0.45 * streak) * (0.85 + 0.25 * streak2) * (0.72 + 0.28 * dark);
      o[c] = col;
    }
    o[3] = clump * 0.55 + streak * 0.3 + streak2 * 0.15;
    o[4] = 0.9;
  });
  return yield* toSet(f, S, S, 1.6, 1.8, false);
}

function* genGravel(S: number): TextureRecipe<PbrSet> {
  const f = yield* field(S, S, (u, v, _x, _y, o) => {
    const base = fbm(u, v, 30, 30, 3, 41);
    const peb1 = vnoise(u * 110, v * 110, 110, 110, 42);
    const peb2 = vnoise(u * 180 + 7, v * 180 + 3, 180, 180, 43);
    const p1 = sstep(0.55, 0.66, peb1), p2 = sstep(0.6, 0.7, peb2);
    const shade = ihash(Math.floor(u * 110), Math.floor(v * 110), 44);
    // Base tone matches the landmarks GRAVEL style (bryant-park.ts: linear 0.43, 0.36, 0.30) so the tile
    // gravel and the landmark promenade cap are the same crushed stone where they meet; the old tan was
    // both darker and far more saturated, which drew a visible seam around the Bryant Park promenade.
    const b = [0.685, 0.634, 0.584];
    const pebC = shade < 0.3 ? [0.535, 0.514, 0.522] : shade < 0.6 ? [0.77, 0.721, 0.684] : [0.642, 0.568, 0.497];
    for (let c = 0; c < 3; c++) {
      let col = b[c] * (0.86 + 0.28 * base);
      col = lerp(col, pebC[c], p1 * 0.9);
      col = lerp(col, b[c] * 1.12, p2 * 0.5);
      o[c] = col;
    }
    o[3] = p1 * 0.8 + p2 * 0.4 + base * 0.2;
    o[4] = 0.86;
  });
  return yield* toSet(f, S, S, 1.1, 2.4, false);
}

function* genSoil(S: number): TextureRecipe<PbrSet> {
  const f = yield* field(S, S, (u, v, _x, _y, o) => {
    const base = fbm(u, v, 12, 12, 4, 51);
    const chips = sstep(0.6, 0.72, vnoise(u * 70, v * 24, 70, 24, 52));
    const chips2 = sstep(0.62, 0.74, vnoise(u * 40 + 5, v * 90, 40, 90, 53));
    const grain = vnoise(u * S, v * S, S, S, 54);
    const b = [0.23, 0.17, 0.12];
    const chipC = [0.42, 0.31, 0.2];
    for (let c = 0; c < 3; c++) {
      let col = b[c] * (0.75 + 0.5 * base) * (0.85 + 0.3 * grain);
      col = lerp(col, chipC[c], chips * 0.8);
      col = lerp(col, b[c] * 0.55, chips2 * 0.7);
      o[c] = col;
    }
    o[3] = chips * 0.7 + chips2 * 0.4 + grain * 0.2;
    o[4] = 0.95;
  });
  return yield* toSet(f, S, S, 1.0, 1.6, false);
}

function* genWaterNormal(S: number): TextureRecipe<THREE.Texture> {
  const waves: [number, number, number, number][] = [
    [3, 1, 0.5, 0.3], [1, 4, 0.42, 1.7], [5, -3, 0.3, 2.9], [-2, 7, 0.24, 0.9], [8, 5, 0.16, 4.1], [11, -9, 0.12, 2.2], [14, 3, 0.08, 5.0], [-6, 13, 0.07, 1.1],
  ];
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    yield;
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let s = 0;
      for (const [fx, fy, a, ph] of waves) s += a * Math.sin(2 * Math.PI * (fx * u + fy * v) + ph);
      s += (fbm(u, v, 12, 12, 3, 61) - 0.5) * 0.9;
      h[y * S + x] = s;
    }
  }
  return yield* heightToNormal(h, S, S, 1.4);
}

function* genBark(kind: BarkKind, W: number, H: number): TextureRecipe<PbrSet> {
  const f = yield* field(W, H, (u, v, _x, _y, o) => {
    const fine = vnoise(u * W * 0.5, v * H * 0.5, W * 0.5, H * 0.5, 71);
    if (kind === 'plane') {
      // camouflage bark: older grey-brown plates flake off in irregular patches showing cream / olive / yellow-green
      // fresh bark underneath; plate edges are a step up, the patches are smooth and recessed
      const p1 = fbm(u, v, 6, 4, 3, 72), p2 = fbm(u + 0.4, v + 0.2, 4, 3, 3, 73), p3 = fbm(u * 1.3 + 0.7, v + 0.5, 9, 6, 2, 77);
      const e1 = sstep(0.46, 0.53, p1), e2 = sstep(0.48, 0.56, p2), e3 = sstep(0.5, 0.58, p3);
      const cream = [0.80, 0.76, 0.60], olive = [0.56, 0.58, 0.38], grey = [0.47, 0.44, 0.36], dark = [0.34, 0.29, 0.22];
      for (let c = 0; c < 3; c++) {
        const fresh = lerp(cream[c], olive[c], e3);
        const old = lerp(dark[c], grey[c], e2);
        o[c] = lerp(old, fresh, e1) * (0.9 + 0.2 * fine);
      }
      o[3] = 0.35 * (1 - e1) + 0.25 * e2 * (1 - e1) + 0.08 * e3 + fine * 0.1;
      o[4] = lerp(0.9, 0.7, e1);
    } else if (kind === 'dark') {
      const ridge = fbm(u, v, 14, 3, 4, 74);
      const r = sstep(0.36, 0.64, ridge);
      const fur = [0.12, 0.10, 0.08], rid = [0.36, 0.31, 0.26];
      for (let c = 0; c < 3; c++) o[c] = lerp(fur[c], rid[c], r) * (0.85 + 0.3 * fine);
      o[3] = r * 1.2 + fine * 0.15;
      o[4] = 0.92;
    } else {
      const fis = sstep(0.025, 0.0, Math.abs(fbm(u, v, 9, 2, 3, 75) - 0.5));
      const lent = sstep(0.7, 0.8, vnoise(u * 20, v * 120, 20, 120, 76));
      const L = 0.5 - 0.22 * fis + 0.1 * lent;
      o[0] = L * 1.0;
      o[1] = L * 0.97;
      o[2] = L * 0.92;
      o[3] = -fis * 1.0 + lent * 0.3 + fine * 0.1;
      o[4] = 0.8;
    }
  });
  return yield* toSet(f, W, H, 0.6, kind === 'dark' ? 3.0 : 1.5, false);
}

// ------------------------------------------------------------------------------------------------
// leaf cluster cards (Canvas2D). Each card is one twig's worth of leaves (~40 leaves in ~1.6 m at tree scale)
// so a crown of ~80 cards reads as foliage, not as a few big lobed cut-outs. With the CC0 leaf atlas loaded
// (client/public/assets/textures/leaf-atlas, 3x3 ovate leaves + opacity), pear / oak / locust cards are built
// from real leaf sprites; plane (lobed) and ginkgo (fan) stay procedural because the atlas has no such shapes.
// ------------------------------------------------------------------------------------------------
type TextureCanvas = HTMLCanvasElement | OffscreenCanvas;
type TextureContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type LeafSprite = TextureCanvas;
export type TextureRecipe<T> = Generator<void, T, unknown>;

function canvas(w: number, h = w): TextureCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const result = document.createElement('canvas');
  result.width = w; result.height = h;
  return result;
}
function context(cv: TextureCanvas): TextureContext {
  return cv.getContext('2d', { willReadFrequently: true }) as TextureContext;
}

interface LeafStyle {
  base: [number, number, number]; // rgb 0..255, sunlit face
  vary: number;
  count: number; // leaves per card
  size: number; // leaf half-size px at 512
  sprite: boolean; // may use the atlas sprites
  draw: (c: TextureContext, s: number, rnd: () => number) => void;
}

function lobedPath(c: TextureContext, s: number, lobes: number, depth: number, stretch: number, sharp = 0.9): void {
  c.beginPath();
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = s * (1 - depth + depth * Math.pow(Math.abs(Math.cos((lobes * t) / 2)), sharp));
    const x = Math.sin(t) * r, y = -Math.cos(t) * r * stretch;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
}

function ovatePath(c: TextureContext, s: number): void {
  c.beginPath();
  c.moveTo(0, -s);
  c.bezierCurveTo(s * 0.72, -s * 0.55, s * 0.7, s * 0.5, 0, s);
  c.bezierCurveTo(-s * 0.7, s * 0.5, -s * 0.72, -s * 0.55, 0, -s);
  c.closePath();
}

function styleFor(arch: Arch): LeafStyle {
  switch (arch) {
    case 'plane':
      return {
        // London plane: large palmate 5-lobed leaves with pointed lobes, deep green in early September
        base: [84, 128, 50], vary: 18, count: 76, size: 25, sprite: false,
        draw: (c, s) => {
          lobedPath(c, s, 5, 0.46, 1.05, 0.55);
          c.fill();
          c.beginPath();
          for (let k = -2; k <= 2; k++) {
            c.moveTo(0, s * 0.4);
            c.lineTo(Math.sin(k * 0.55) * s * 0.85, -Math.cos(k * 0.55) * s * 0.85);
          }
          c.stroke();
        },
      };
    case 'locust':
      // pinnate compound leaf: rachis with 2 x 8 tiny leaflets; the card stays airy (feathery crown)
      return {
        base: [118, 156, 62], vary: 18, count: 36, size: 34, sprite: true,
        draw: (c, s) => {
          c.beginPath();
          c.moveTo(0, s);
          c.lineTo(0, -s);
          c.stroke();
          for (let i = 0; i < 8; i++) {
            const y = s * 0.9 - (i / 7) * 1.8 * s;
            for (const side of [-1, 1]) {
              c.beginPath();
              c.ellipse(side * s * 0.15, y, s * 0.16, s * 0.065, side * 0.45, 0, Math.PI * 2);
              c.fill();
            }
          }
        },
      };
    case 'pear':
      return {
        base: [58, 98, 42], vary: 14, count: 70, size: 21, sprite: true,
        draw: (c, s) => {
          ovatePath(c, s);
          c.fill();
          c.beginPath();
          c.moveTo(0, s * 0.9);
          c.lineTo(0, -s * 0.85);
          c.stroke();
        },
      };
    case 'ginkgo':
      return {
        base: [124, 154, 62], vary: 14, count: 64, size: 20, sprite: false,
        draw: (c, s) => {
          c.beginPath();
          c.moveTo(0, s * 0.95);
          c.lineTo(0, s * 0.15);
          c.stroke();
          c.beginPath();
          c.moveTo(0, s * 0.15);
          for (let i = 0; i <= 14; i++) {
            const a = -1.05 + (i / 14) * 2.1;
            const r = s * (0.95 + 0.06 * Math.sin(i * 2.3)) * (i === 7 ? 0.82 : 1);
            c.lineTo(Math.sin(a) * r, s * 0.15 - Math.cos(a) * r);
          }
          c.closePath();
          c.fill();
        },
      };
    default:
      return {
        base: [74, 112, 46], vary: 18, count: 58, size: 26, sprite: true,
        draw: (c, s) => {
          lobedPath(c, s * 0.7, 7, 0.3, 1.75);
          c.fill();
          c.beginPath();
          c.moveTo(0, s * 1.2);
          c.lineTo(0, -s * 1.2);
          c.stroke();
        },
      };
  }
}

function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** draw one atlas leaf sprite, tinted (multiply) by the shade colour, centred on the origin, half-height s */
function drawSprite(c: TextureContext, sprite: LeafSprite, tmp: TextureCanvas, s: number, tint: string): void {
  const t = context(tmp);
  const w = tmp.width;
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, w, w);
  t.drawImage(sprite, 0, 0, w, w);
  t.globalCompositeOperation = 'multiply';
  t.fillStyle = tint;
  t.fillRect(0, 0, w, w);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(sprite, 0, 0, w, w);
  c.drawImage(tmp, -s * 0.72, -s, s * 1.44, s * 2);
}

function* genLeafCard(arch: Arch, S: number, sprites: LeafSprite[] | null): TextureRecipe<THREE.Texture> {
  const st = styleFor(arch);
  const useSprites = st.sprite && !!sprites && sprites.length > 0;
  const cv = canvas(S);
  const c = context(cv);
  const rnd = seeded(arch.length * 977 + arch.charCodeAt(0) * 13);
  const k = S / 512;
  const tmp = canvas(96);
  c.clearRect(0, 0, S, S);
  // twigs: from a centre node, forking once
  c.strokeStyle = 'rgba(62,46,32,0.95)';
  c.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    c.lineWidth = 2.6 * k;
    c.beginPath();
    c.moveTo(S / 2, S / 2);
    const mx = S / 2 + Math.cos(a + 0.3) * S * 0.2, my = S / 2 + Math.sin(a + 0.3) * S * 0.2;
    c.quadraticCurveTo(mx, my, S / 2 + Math.cos(a) * S * 0.4, S / 2 + Math.sin(a) * S * 0.4);
    c.stroke();
    c.lineWidth = 1.5 * k;
    c.beginPath();
    c.moveTo(mx, my);
    c.lineTo(mx + Math.cos(a + 0.9) * S * 0.18, my + Math.sin(a + 0.9) * S * 0.18);
    c.stroke();
  }
  // leaves: gaussian-ish placement, larger + brighter near the front (drawn last)
  const n = Math.round(st.count * (useSprites ? 1.0 : 1.15));
  const items: { x: number; y: number; r: number; s: number; l: number; i: number }[] = [];
  const subs = arch === 'plane' ? [[0.5, 0.5], [0.3, 0.36], [0.68, 0.62], [0.42, 0.72]] : null;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const sub = subs ? subs[i % subs.length] : null;
    const rr = Math.sqrt(rnd()) * (sub ? 0.24 : 0.45) * S;
    const cx = sub ? sub[0] * S : S / 2, cy = sub ? sub[1] * S : S / 2;
    items.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, r: rnd() * Math.PI * 2, s: st.size * k * (0.65 + 0.7 * rnd()), l: rnd(), i: Math.floor(rnd() * 9) });
  }
  items.sort((p, q) => p.l - q.l);
  for (const it of items) {
    yield;
    // back leaves in shade, front leaves sunlit, a few yellowing ones
    const shade = 0.55 + 0.6 * it.l;
    const yellow = rnd() < (arch === 'plane' ? 0.09 : 0.06) ? 1 : 0;
    const vr = (rnd() - 0.5) * st.vary + yellow * 40, vg = (rnd() - 0.5) * st.vary + yellow * 10, vb = (rnd() - 0.5) * st.vary * 0.6 - yellow * 20;
    const rC = Math.round((st.base[0] + vr) * shade), gC = Math.round((st.base[1] + vg) * shade), bC = Math.round((st.base[2] + vb) * shade);
    c.save();
    c.translate(it.x, it.y);
    c.rotate(it.r);
    if (useSprites && arch !== 'locust') {
      // the atlas leaves are neutral mid-green; tint relative to that so species keep their hue
      drawSprite(c, sprites![it.i % sprites!.length], tmp, it.s, `rgb(${Math.min(255, Math.round(rC * 1.55))},${Math.min(255, Math.round(gC * 1.45))},${Math.min(255, Math.round(bC * 1.6))})`);
    } else {
      c.fillStyle = `rgb(${rC},${gC},${bC})`;
      c.strokeStyle = `rgba(${Math.round(rC * 0.6)},${Math.round(gC * 0.62)},${Math.round(bC * 0.5)},0.8)`;
      c.lineWidth = 0.9 * k;
      st.draw(c, it.s, rnd);
    }
    c.restore();
  }
  yield* bleedEdges(c, S, st.base);
  return canvasTex(cv);
}

/**
 * Far-LOD crown card: the whole canopy silhouette (ellipse of leaf-coloured speckle, lit from above, darker and
 * more transparent toward the underside and rim) so distant trees read as crowns instead of giant leaf clusters.
 */
function* genCrownCard(arch: Arch, S: number): TextureRecipe<THREE.Texture> {
  const st = styleFor(arch);
  const cv = canvas(S);
  const c = context(cv);
  const rnd = seeded(arch.charCodeAt(1) * 431 + 7);
  c.clearRect(0, 0, S, S);
  const shape = arch === 'pear' ? { rx: 0.36, ry: 0.47 } : arch === 'ginkgo' ? { rx: 0.3, ry: 0.48 } : arch === 'locust' ? { rx: 0.45, ry: 0.42 } : { rx: 0.47, ry: 0.44 };
  const airy = arch === 'locust' ? 0.62 : 0.85;
  const blobs = Math.round(S * S * 0.0046 * airy);
  for (let i = 0; i < blobs; i++) {
    if (i % 8 === 0) yield;
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6);
    const x = 0.5 + Math.cos(a) * r * shape.rx, y = 0.5 + Math.sin(a) * r * shape.ry;
    // lit from above-left: brightness with height, darker deep inside and at the underside
    const lit = 0.40 + 0.85 * (1 - y) * (0.55 + 0.45 * (1 - r)) + 0.12 * (0.5 - x);
    const v = (rnd() - 0.5) * st.vary * 1.5;
    const rC = Math.round((st.base[0] + v) * lit), gC = Math.round((st.base[1] + v) * lit), bC = Math.round((st.base[2] + v * 0.5) * lit);
    c.fillStyle = `rgba(${rC},${gC},${bC},${(0.75 + 0.25 * rnd()).toFixed(2)})`;
    const rad = S * (0.012 + 0.022 * rnd()) * (1 - 0.3 * r);
    c.beginPath();
    c.ellipse(x * S, y * S, rad, rad * (0.7 + 0.5 * rnd()), rnd() * 3.14, 0, Math.PI * 2);
    c.fill();
  }
  // a few trunk-side branches showing through the lower crown
  c.strokeStyle = 'rgba(58,44,32,0.6)';
  c.lineWidth = 2.2 * (S / 512);
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
    c.beginPath();
    c.moveTo(S * 0.5, S * 0.86);
    c.lineTo(S * (0.5 + Math.cos(a) * 0.3), S * (0.62 + Math.sin(a) * 0.3));
    c.stroke();
  }
  yield* bleedEdges(c, S, st.base);
  return canvasTex(cv);
}

/** fill transparent texels with the mean leaf colour so bilinear filtering / mips never bleed black */
function* bleedEdges(c: TextureContext, S: number, base: [number, number, number]): TextureRecipe<void> {
  const img = c.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (i % (S * 4) === 0) yield;
    if (d[i + 3] < 250) {
      const a = d[i + 3] / 255;
      d[i] = Math.round(d[i] * a + base[0] * 0.8 * (1 - a));
      d[i + 1] = Math.round(d[i + 1] * a + base[1] * 0.8 * (1 - a));
      d[i + 2] = Math.round(d[i + 2] * a + base[2] * 0.8 * (1 - a));
    }
  }
  c.putImageData(img, 0, 0);
}

function canvasTex(cv: TextureCanvas): THREE.Texture {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso;
  t.premultiplyAlpha = false;
  t.needsUpdate = true;
  return t;
}

/** Split the leaf atlas (colour + opacity, 3x3 grid) into RGBA sprites. null when either image fails. */
export async function loadLeafSprites(colorUrl: string, opacityUrl: string): Promise<LeafSprite[] | null> {
  const load = (url: string) => decodeTextureImage(url);
  try {
    const [col, opa] = await Promise.all([load(colorUrl), load(opacityUrl)]);
    const cell = 128, grid = 3, out: LeafSprite[] = [];
    const work = canvas(cell);
    const w = context(work);
    for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) {
      const sx = (col.width / grid) * gx, sy = (col.height / grid) * gy, sw = col.width / grid, shh = col.height / grid;
      w.clearRect(0, 0, cell, cell);
      w.drawImage(col, sx, sy, sw, shh, 0, 0, cell, cell);
      const rgb = w.getImageData(0, 0, cell, cell);
      w.clearRect(0, 0, cell, cell);
      w.drawImage(opa, (opa.width / grid) * gx, (opa.height / grid) * gy, opa.width / grid, opa.height / grid, 0, 0, cell, cell);
      const al = w.getImageData(0, 0, cell, cell).data;
      const d = rgb.data;
      for (let i = 0; i < d.length; i += 4) d[i + 3] = al[i] < 40 ? 0 : al[i];
      const sprite = canvas(cell);
      context(sprite).putImageData(rgb, 0, 0);
      await yieldFrame();
      out.push(sprite);
    }
    col.close(); opa.close();
    return out;
  } catch {
    return null;
  }
}

export function generateLeafCards(S: number, sprites: LeafSprite[] | null): Record<Arch, THREE.Texture> {
  const leaves = {} as Record<Arch, THREE.Texture>;
  for (const a of ARCHS) leaves[a] = finishTextureRecipe(genLeafCard(a, S, sprites));
  return leaves;
}

export function generateCrownCards(S: number): Record<Arch, THREE.Texture> {
  const crowns = {} as Record<Arch, THREE.Texture>;
  for (const a of ARCHS) crowns[a] = finishTextureRecipe(genCrownCard(a, S));
  return crowns;
}
// ------------------------------------------------------------------------------------------------
// public
// ------------------------------------------------------------------------------------------------
const yieldFrame = () => new Promise<void>(resolve => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});

function finishTextureRecipe<T>(steps: TextureRecipe<T>): T {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Fallback for browsers without module Workers: rows/draws share a 1 ms slice,
 * leaving headroom within 3 ms for the final indivisible Canvas2D operation. */
export async function runTextureRecipe<T>(steps: TextureRecipe<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException('Texture generation cancelled', 'AbortError');
  if (typeof window === 'undefined') return finishTextureRecipe(steps);
  for (;;) {
    await yieldFrame();
    if (signal?.aborted) { steps.return(undefined as T); throw new DOMException('Texture generation cancelled', 'AbortError'); }
    const deadline = performance.now() + 1;
    do {
      const step = steps.next();
      if (step.done) return step.value;
    } while (performance.now() < deadline);
  }
}

export async function generateLeafCardsAsync(S: number, sprites: LeafSprite[] | null, signal?: AbortSignal): Promise<Record<Arch, THREE.Texture>> {
  const leaves = {} as Record<Arch, THREE.Texture>;
  for (const a of ARCHS) leaves[a] = await runTextureRecipe(genLeafCard(a, S, sprites), signal);
  return leaves;
}

export async function generateTextures(quality: 'low' | 'medium' | 'high' | 'ultra', signal?: AbortSignal): Promise<TexSet> {
  const S = quality === 'low' ? 256 : 512;
  const asphalt = await runTextureRecipe(genAsphalt(S), signal);
  const concrete = await runTextureRecipe(genConcrete(S), signal);
  const grass = await runTextureRecipe(genGrass(S), signal);
  const gravel = await runTextureRecipe(genGravel(S), signal);
  const soil = await runTextureRecipe(genSoil(S), signal);
  const waterNormal = await runTextureRecipe(genWaterNormal(S), signal);
  const bark = {} as TexSet['bark'];
  for (const kind of ['plane', 'dark', 'grey'] as const) bark[kind] = await runTextureRecipe(genBark(kind, S / 2, S), signal);
  const leaves = await generateLeafCardsAsync(S, null, signal);
  const crowns = {} as TexSet['crowns'];
  for (const a of ARCHS) crowns[a] = await runTextureRecipe(genCrownCard(a, S), signal);
  return { asphalt, concrete, grass, gravel, soil, waterNormal, bark, leaves, crowns };
}

export function disposeTexSet(t: TexSet): void {
  const sets = [t.asphalt, t.concrete, t.grass, t.gravel, t.soil, t.bark.plane, t.bark.dark, t.bark.grey];
  for (const s of sets) {
    s.map.dispose();
    s.normal.dispose();
    s.rough?.dispose();
  }
  t.waterNormal.dispose();
  for (const a of ARCHS) { t.leaves[a].dispose(); t.crowns[a].dispose(); }
}

// ------------------------------------------------------------------------------------------------
// CC0 manifest loader (format unknown at the time of writing: scanned defensively)
// ------------------------------------------------------------------------------------------------
export interface ManifestMatch {
  name: string;
  albedo: string | null;
  normal: string | null;
  rough: string | null;
  opacity: string | null;
  size: number | null;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const BASE = __launchBasePath('/assets/textures/');

function joinUrl(base: string, p: string): string {
  if (/^(https?:)?\/\//.test(p) || p.startsWith('/')) return p;
  if (p.startsWith('assets/')) return '/' + p;
  return base + p.replace(/^\.\//, '');
}

/** find entries whose id/name/tags/path mention any keyword; return the first with an albedo map */
export function findInManifest(manifest: Json, keywords: string[], exclude: string[] = [], normalOnly = false): ManifestMatch | null {
  const entries: { key: string; obj: { [k: string]: Json } }[] = [];
  const visit = (node: Json, key: string, depth: number): void => {
    if (depth > 4 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n, key, depth + 1);
      return;
    }
    entries.push({ key, obj: node });
    for (const k of Object.keys(node)) visit(node[k], k, depth + 1);
  };
  visit(manifest, '', 0);
  const kws = keywords.map((k) => k.toLowerCase());
  const exs = exclude.map((k) => k.toLowerCase());
  for (const { key, obj } of entries) {
    const strings: string[] = [key];
    for (const k of ['id', 'name', 'slug', 'title', 'tags', 'category', 'path', 'dir', 'folder', 'source', 'description']) {
      const v = obj[k];
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) for (const s of v) if (typeof s === 'string') strings.push(s);
    }
    const hay = strings.join(' ').toLowerCase();
    if (!kws.some((k) => hay.includes(k))) continue;
    if (exs.some((k) => hay.includes(k))) continue;
    const maps = pickMaps(obj);
    if (normalOnly ? !maps.normal : !maps.albedo) continue;
    let size: number | null = null;
    for (const k of ['size', 'sizeM', 'size_m', 'meters', 'scale', 'repeat', 'physicalSize', 'physicalSizeM', 'dimensions']) {
      const v = obj[k];
      if (typeof v === 'number' && v > 0 && v < 50) size = v;
      else if (Array.isArray(v) && typeof v[0] === 'number' && v[0] > 0 && v[0] < 50) size = v[0];
    }
    const dirHint = typeof obj.dir === 'string' ? obj.dir : typeof obj.path === 'string' && !/\.(png|jpe?g|webp|ktx2)$/i.test(obj.path) ? obj.path : typeof obj.folder === 'string' ? obj.folder : '';
    const base = dirHint ? joinUrl(BASE, dirHint.replace(/\/?$/, '/')) : BASE;
    return { name: strings[1] ?? key, albedo: maps.albedo ? joinUrl(base, maps.albedo) : null, normal: maps.normal ? joinUrl(base, maps.normal) : null, rough: maps.rough ? joinUrl(base, maps.rough) : null, opacity: maps.opacity ? joinUrl(base, maps.opacity) : null, size };
  }
  return null;
}

function pickMaps(obj: { [k: string]: Json }): { albedo: string | null; normal: string | null; rough: string | null; opacity: string | null } {
  let albedo: string | null = null, normal: string | null = null, rough: string | null = null, opacity: string | null = null;
  const consider = (k: string, v: Json): void => {
    if (typeof v !== 'string') return;
    const kk = k.toLowerCase();
    const vv = v.toLowerCase();
    const isImg = /\.(png|jpe?g|webp|ktx2)$/i.test(vv);
    if (!isImg && !/^(albedo|color|diffuse|basecolor|base_color|map|normal|nor|normalgl|normal_gl|rough|roughness|arm|opacity|alpha)$/.test(kk)) return;
    const s = kk + ' ' + vv;
    if (/opacity|alpha/.test(s) && !opacity) opacity = v;
    else if (/normal|_nor|nor_gl|normalgl|_nrm/.test(s) && !normal) normal = v;
    else if (/rough|_arm|orm/.test(s) && !rough) rough = v;
    else if (/albedo|diff|color|basecolor|base_color|_col/.test(s) && !albedo) albedo = v;
  };
  // Declared files win over descriptive metadata. A title/source URL may name the
  // original download (waternormals.jpg), not the shipped file (normal.jpg).
  for (const [k, v] of Object.entries(obj)) {
    if (!/^(maps|files|textures|images)$/i.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [key, file] of Object.entries(v)) consider(key, file);
    else if (Array.isArray(v)) for (const file of v) consider('', file);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (/^(albedo|color|diffuse|basecolor|base_color|map|normal|nor|normalgl|normal_gl|rough|roughness|arm|opacity|alpha)(map|url|path)?$/i.test(k)) consider(k, v);
  }
  return { albedo, normal, rough, opacity };
}

export async function fetchManifest(): Promise<Json | null> {
  try {
    const res = await __launchFetch(BASE + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as Json;
  } catch {
    return null;
  }
}

async function decodeTextureImage(url: string): Promise<ImageBitmap> {
  const response = await __launchFetch(url);
  if (!response.ok) throw new Error(`Texture ${url}: ${response.status}`);
  return createImageBitmap(await response.blob(), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}

function ownBitmap(t: THREE.Texture, bitmap: ImageBitmap): void {
  const release = () => { bitmap.close(); t.removeEventListener('dispose', release); };
  t.addEventListener('dispose', release);
}

async function loadTex(url: string, srgb: boolean): Promise<THREE.Texture> {
  const bitmap = await decodeTextureImage(url);
  const t = new THREE.Texture(bitmap);
  ownBitmap(t, bitmap);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.flipY = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = maxAniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** load just a (tangent-space, OpenGL) normal map; null on failure */
export async function loadNormalMap(m: ManifestMatch): Promise<THREE.Texture | null> {
  if (!m.normal) return null;
  try {
    return await loadTex(m.normal, false);
  } catch {
    return null;
  }
}

/** load one PBR set from a manifest match; null on failure */
export async function loadPbrSet(m: ManifestMatch, fallbackSize: number): Promise<PbrSet | null> {
  try {
    const map = await loadTex(m.albedo!, true);
    const normal = m.normal ? await loadTex(m.normal, false).catch(() => null) : null;
    const rough = m.rough ? await loadTex(m.rough, false).catch(() => null) : null;
    if (!normal) {
      map.dispose(); rough?.dispose();
      return null; // a normal map is essential for the ground look; keep procedural otherwise
    }
    return { map, normal, rough, size: m.size ?? fallbackSize, procedural: false };
  } catch {
    return null;
  }
}
