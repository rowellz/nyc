import { basePath as __launchBasePath, mountedFetch as __launchFetch } from '@/core/basePath';
/**
 * Procedural, tileable street textures (asphalt, concrete, granite, Belgian block, noise) and the
 * paint/decal atlas. Everything is generated on the CPU once at startup (about 300-500 ms on an M2) and
 * replaced by CC0 PBR sets from client/public/assets/textures/manifest.json when those exist.
 */
import * as THREE from 'three';
import { bitmapTexture } from '../buildings/transfer';

export interface PbrSet {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  /** roughness in R (may be null -> shader uses constant) */
  rough: THREE.Texture | null;
  /** meters covered by one texture repeat */
  scale: number;
}

export interface StreetTextures {
  asphalt: PbrSet;
  asphalt2: THREE.Texture; // second albedo variant (anti-tiling blend)
  asphalt2Scale: number;
  concrete: PbrSet;
  granite: PbrSet;
  cobble: PbrSet;
  noise: THREE.Texture; // RGBA: R low fbm, G mid fbm, B fine, A ridged (cracks)
  atlas: THREE.Texture; // paint/decals
  procedural: boolean;
}

/* ------------------------------------------------------------------ noise */

/** tileable value-noise lattice */
function lattice(n: number, seed: number): Float32Array {
  const a = new Float32Array(n * n);
  let s = seed >>> 0;
  for (let i = 0; i < a.length; i++) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    a[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return a;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** tileable fbm over a size×size image; freq = lattice cells across the image at octave 0 */
function fbm(size: number, freq: number, octaves: number, seed: number, gain = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    const n = Math.max(2, Math.round(f));
    const lat = lattice(n, seed + o * 7919);
    const scale = n / size;
    for (let y = 0; y < size; y++) {
      const fy = y * scale;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      const ya = y0 % n, yb = (y0 + 1) % n;
      for (let x = 0; x < size; x++) {
        const fx = x * scale;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const xa = x0 % n, xb = (x0 + 1) % n;
        const v00 = lat[ya * n + xa], v10 = lat[ya * n + xb], v01 = lat[yb * n + xa], v11 = lat[yb * n + xb];
        const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
        out[y * size + x] += v * amp;
      }
    }
    total += amp;
    amp *= gain;
    f *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/** per-pixel white noise, optionally box-blurred once (tileable) */
function white(size: number, seed: number, blur = 0): Float32Array {
  const a = lattice(size, seed);
  if (!blur) return a;
  const b = new Float32Array(a.length);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let dy = -blur; dy <= blur; dy++)
        for (let dx = -blur; dx <= blur; dx++) s += a[((y + dy + size) % size) * size + ((x + dx + size) % size)];
      b[y * size + x] = s / ((2 * blur + 1) * (2 * blur + 1));
    }
  return b;
}

function normalFromHeight(h: Float32Array, size: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function dataTexture(data: Uint8Array, size: number, srgb: boolean, aniso: number): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/* ------------------------------------------------------------------ materials */

function makeAsphalt(size: number, aniso: number, seed: number, aged: number): { albedo: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } {
  const spk = white(size, seed + 1, 0); // aggregate
  const spk2 = white(size, seed + 2, 1);
  const mid = fbm(size, 6, 4, seed + 3);
  const low = fbm(size, 2, 2, seed + 4);
  const alb = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    // aggregate stones poke through the binder on aged asphalt: bright speckle over dark binder
    const stone = smooth(clamp01((spk2[i] - 0.45) * 3.5));
    const binder = 0.30 + 0.12 * aged;
    let v = binder + 0.16 * (mid[i] - 0.5) + 0.10 * (low[i] - 0.5) + stone * (0.16 + 0.12 * aged) * (0.6 + 0.8 * spk[i]);
    v += (spk[i] - 0.5) * 0.05;
    // slight warm/cool tint variations
    const r = v * (1.0 + 0.03 * (low[i] - 0.5));
    const g = v;
    const b = v * (1.0 - 0.02 * (mid[i] - 0.5)) * 0.985;
    alb[i * 4] = clamp01(r) * 255;
    alb[i * 4 + 1] = clamp01(g) * 255;
    alb[i * 4 + 2] = clamp01(b) * 255;
    alb[i * 4 + 3] = 255;
    const ro = 0.80 + 0.15 * (mid[i] - 0.5) + 0.05 * (1 - stone) - 0.05 * aged;
    rough[i * 4] = clamp01(ro) * 255;
    rough[i * 4 + 1] = rough[i * 4];
    rough[i * 4 + 2] = rough[i * 4];
    rough[i * 4 + 3] = 255;
    height[i] = stone * 0.6 + spk[i] * 0.1 + mid[i] * 0.3;
  }
  return { albedo: dataTexture(alb, size, true, aniso), normal: dataTexture(normalFromHeight(height, size, 2.2), size, false, aniso), rough: dataTexture(rough, size, false, aniso) };
}

function makeConcrete(size: number, aniso: number, seed: number): { albedo: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } {
  const fine = white(size, seed + 1, 1);
  const mid = fbm(size, 5, 4, seed + 2);
  const low = fbm(size, 2, 3, seed + 3);
  const pits = white(size, seed + 4, 0);
  const alb = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const pit = pits[i] > 0.985 ? 1 : 0;
    let v = 0.60 + 0.10 * (mid[i] - 0.5) + 0.12 * (low[i] - 0.5) + 0.05 * (fine[i] - 0.5) - 0.18 * pit;
    const r = v * 1.0, g = v * 0.985, b = v * 0.955; // warm grey
    alb[i * 4] = clamp01(r) * 255;
    alb[i * 4 + 1] = clamp01(g) * 255;
    alb[i * 4 + 2] = clamp01(b) * 255;
    alb[i * 4 + 3] = 255;
    const ro = 0.86 + 0.10 * (mid[i] - 0.5) + 0.08 * pit;
    rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = clamp01(ro) * 255;
    rough[i * 4 + 3] = 255;
    height[i] = mid[i] * 0.4 + fine[i] * 0.25 - pit * 0.5;
  }
  return { albedo: dataTexture(alb, size, true, aniso), normal: dataTexture(normalFromHeight(height, size, 1.6), size, false, aniso), rough: dataTexture(rough, size, false, aniso) };
}

function makeGranite(size: number, aniso: number, seed: number): { albedo: THREE.Texture; normal: THREE.Texture } {
  const spk = white(size, seed + 1, 0);
  const spk2 = white(size, seed + 2, 1);
  const mid = fbm(size, 4, 3, seed + 3);
  const alb = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    // feldspar (light), quartz (grey), mica (black) grains
    let v = 0.50 + 0.10 * (mid[i] - 0.5);
    if (spk[i] > 0.82) v += 0.18;
    else if (spk[i] < 0.12) v -= 0.25;
    v += (spk2[i] - 0.5) * 0.12;
    const r = v * 1.0, g = v * 0.99, b = v * 0.99;
    alb[i * 4] = clamp01(r) * 255;
    alb[i * 4 + 1] = clamp01(g) * 255;
    alb[i * 4 + 2] = clamp01(b) * 255;
    alb[i * 4 + 3] = 255;
    height[i] = spk2[i] * 0.5 + mid[i] * 0.3;
  }
  return { albedo: dataTexture(alb, size, true, aniso), normal: dataTexture(normalFromHeight(height, size, 1.2), size, false, aniso) };
}

/** Belgian block: ~13 x 25 cm blocks, running bond, 2 m tile */
function makeCobble(size: number, aniso: number, seed: number): { albedo: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } {
  const cols = 15, rows = 8;
  const mid = fbm(size, 6, 3, seed + 1);
  const fine = white(size, seed + 2, 1);
  const blockRand = lattice(64, seed + 3);
  const alb = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * rows;
    const row = Math.floor(fy);
    const ty = fy - row;
    for (let x = 0; x < size; x++) {
      let fx = (x / size) * cols + (row % 2 ? 0.5 : 0);
      const col = Math.floor(fx);
      const tx = fx - col;
      const id = ((row * 31 + (col % cols) * 17) & 4095) % blockRand.length;
      const br = blockRand[id];
      // rounded-top block profile: distance to block edge
      const ex = Math.min(tx, 1 - tx) * 2, ey = Math.min(ty, 1 - ty) * 2;
      const edge = Math.min(ex, ey);
      const mortar = edge < 0.16 ? 1 : 0;
      const dome = mortar ? 0 : Math.pow(Math.min(1, (edge - 0.16) / 0.5), 0.5);
      const i = y * size + x;
      let v = mortar ? 0.26 + 0.06 * fine[i] : 0.34 + 0.20 * br + 0.08 * (mid[i] - 0.5) + 0.06 * (fine[i] - 0.5);
      // grey-blue-brown granite blocks
      const tint = br < 0.4 ? [0.98, 1.0, 1.04] : br < 0.7 ? [1.04, 1.0, 0.94] : [1.0, 1.0, 1.0];
      alb[i * 4] = clamp01(v * tint[0]) * 255;
      alb[i * 4 + 1] = clamp01(v * tint[1]) * 255;
      alb[i * 4 + 2] = clamp01(v * tint[2]) * 255;
      alb[i * 4 + 3] = 255;
      const ro = mortar ? 0.95 : 0.55 + 0.25 * (1 - dome) + 0.1 * (fine[i] - 0.5);
      rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = clamp01(ro) * 255;
      rough[i * 4 + 3] = 255;
      height[i] = (mortar ? 0 : 0.5 + 0.5 * dome) + 0.05 * fine[i];
    }
  }
  return { albedo: dataTexture(alb, size, true, aniso), normal: dataTexture(normalFromHeight(height, size, 3.0), size, false, aniso), rough: dataTexture(rough, size, false, aniso) };
}

function makeNoise(size: number, seed: number): THREE.Texture {
  const low = fbm(size, 2, 3, seed + 1);
  const mid = fbm(size, 5, 4, seed + 2);
  const fine = white(size, seed + 3, 1);
  const ridge = fbm(size, 3, 4, seed + 4, 0.6);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = clamp01(low[i]) * 255;
    data[i * 4 + 1] = clamp01(mid[i]) * 255;
    data[i * 4 + 2] = clamp01(fine[i]) * 255;
    data[i * 4 + 3] = clamp01(Math.abs(ridge[i] - 0.5) * 2) * 255; // 0 along ridges -> cracks
  }
  const t = dataTexture(data, size, false, 4);
  return t;
}

/* ------------------------------------------------------------------ atlas */

/** atlas regions in UV (x, y, w, h), inset so mip bleeding stays inside the tile */
export const ATLAS = {
  white: [0, 0, 0.25, 0.25],
  yellow: [0.25, 0, 0.25, 0.25],
  green: [0.5, 0, 0.25, 0.25],
  terracotta: [0.75, 0, 0.25, 0.25],
  arrowStraight: [0, 0.25, 0.25, 0.25],
  arrowLeft: [0.25, 0.25, 0.25, 0.25],
  arrowRight: [0.5, 0.25, 0.25, 0.25],
  only: [0.75, 0.25, 0.25, 0.25],
  manhole: [0, 0.5, 0.25, 0.25],
  sewerGrate: [0.25, 0.5, 0.25, 0.25],
  subwayGrate: [0.5, 0.5, 0.25, 0.25],
  curbInlet: [0.75, 0.5, 0.25, 0.25],
  oil: [0, 0.75, 0.25, 0.25],
  tactile: [0.25, 0.75, 0.25, 0.25],
  patch: [0.5, 0.75, 0.25, 0.25],
  bikeSymbol: [0.75, 0.75, 0.25, 0.25],
} as const;
export type AtlasRegion = keyof typeof ATLAS;

/** photographed decals composited into the atlas (worker-safe: fetch + createImageBitmap + OffscreenCanvas) */
export interface DecalImages {
  /** cast-iron manhole cover, colour masked by its opacity map */
  manhole?: ImageBitmap;
}

export async function loadDecalImages(base = __launchBasePath('/assets/textures/')): Promise<DecalImages> {
  const out: DecalImages = {};
  const sources: ImageBitmap[] = [];
  const bitmap = async (url: string) => {
    const res = await __launchFetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const image = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' });
    sources.push(image);
    return image;
  };
  try {
    // Wait for both loads even on failure so the successful sibling is released.
    const images = await Promise.allSettled([bitmap(base + 'manhole-cover/color.jpg'), bitmap(base + 'manhole-cover/opacity.jpg')]);
    const [color, opacity] = images.map(image => {
      if (image.status === 'rejected') throw image.reason;
      return image.value;
    });
    const c = new OffscreenCanvas(512, 512);
    const g = c.getContext('2d')!;
    g.drawImage(color, 0, 0, 512, 512);
    const pixels = g.getImageData(0, 0, 512, 512);
    g.drawImage(opacity, 0, 0, 512, 512);
    const mask = g.getImageData(0, 0, 512, 512).data;
    // JPEG has no alpha: destination-in would retain an opaque square. The
    // grayscale opacity map stores coverage in RGB, not in its alpha channel.
    for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i + 3] *= mask[i] / 255;
    g.putImageData(pixels, 0, 0);
    out.manhole = await createImageBitmap(c);
  } catch (error) {
    console.info('[streets] manhole decal unavailable, using the drawn one', error);
  } finally {
    sources.forEach(image => image.close());
  }
  return out;
}

function makeAtlas(size: number, aniso: number, decals: DecalImages = {}): THREE.Texture {
  const c = typeof document === 'undefined' ? new OffscreenCanvas(size, size) : document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  const cell = size / 4;
  g.clearRect(0, 0, size, size);

  const paintTile = (cx: number, cy: number, rgb: string, seed: number) => {
    // solid paint with mottled alpha (tileable enough at 256 px)
    const img = g.createImageData(cell, cell);
    const n = fbm(cell, 4, 4, seed);
    const w = white(cell, seed + 9, 1);
    const [r, gg, b] = rgb.split(',').map(Number);
    for (let i = 0; i < cell * cell; i++) {
      const a = clamp01(0.55 + 0.6 * n[i] + 0.25 * (w[i] - 0.5));
      const shade = 0.9 + 0.2 * (w[i] - 0.5);
      img.data[i * 4] = clamp01((r / 255) * shade) * 255;
      img.data[i * 4 + 1] = clamp01((gg / 255) * shade) * 255;
      img.data[i * 4 + 2] = clamp01((b / 255) * shade) * 255;
      img.data[i * 4 + 3] = a * 255;
    }
    g.putImageData(img, cx * cell, cy * cell);
  };
  paintTile(0, 0, '238,236,228', 11);
  paintTile(1, 0, '224,178,62', 12); // NYC yellow after a few winters: slightly faded
  paintTile(2, 0, '38,120,66', 13);
  paintTile(3, 0, '150,62,40', 14);

  const arrow = (cx: number, cy: number, kind: 'straight' | 'left' | 'right') => {
    const x0 = cx * cell, y0 = cy * cell;
    g.save();
    g.translate(x0 + cell / 2, y0 + cell / 2);
    g.rotate(Math.PI / 2); // drawn pointing "up", rotated so the head points to +x (= forward along travel in the decal quad)
    g.fillStyle = 'rgba(238,236,228,0.95)';
    // shaft (long axis = +y down in the canvas = "backwards" along travel; arrow points up = forward)
    const sw = cell * 0.13, len = cell * 0.9;
    g.beginPath();
    if (kind === 'straight') {
      g.rect(-sw / 2, -len / 2 + cell * 0.22, sw, len - cell * 0.22);
      g.moveTo(0, -len / 2);
      g.lineTo(cell * 0.2, -len / 2 + cell * 0.26);
      g.lineTo(-cell * 0.2, -len / 2 + cell * 0.26);
      g.closePath();
    } else {
      const s = kind === 'left' ? -1 : 1;
      g.rect(-sw / 2, -len / 2 + cell * 0.1, sw, len - cell * 0.1);
      // curved head to the side
      g.moveTo(-sw / 2, -len / 2 + cell * 0.3);
      g.lineTo(-sw / 2 + s * cell * 0.02, -len / 2 + cell * 0.12);
      g.lineTo(s * cell * 0.24, -len / 2 + cell * 0.12);
      g.lineTo(s * cell * 0.24, -len / 2 + cell * 0.2);
      g.lineTo(s * cell * 0.34, -len / 2 + cell * 0.05);
      g.lineTo(s * cell * 0.24, -len / 2 - cell * 0.1);
      g.lineTo(s * cell * 0.24, -len / 2 - cell * 0.02);
      g.lineTo(-sw / 2 - s * cell * 0.03, -len / 2 - cell * 0.02);
      g.closePath();
    }
    g.fill();
    g.restore();
  };
  arrow(0, 1, 'straight');
  arrow(1, 1, 'left');
  arrow(2, 1, 'right');
  // ONLY text
  g.save();
  g.translate(3 * cell + cell / 2, cell + cell / 2);
  g.fillStyle = 'rgba(238,236,228,0.95)';
  g.font = `bold ${Math.round(cell * 0.34)}px Helvetica, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.rotate(Math.PI / 2); // letters "up" = +x = forward
  g.scale(1, 2.4); // letters stretched along travel, as on real pavement
  g.fillText('ONLY', 0, 0);
  g.restore();

  // manhole cover: the photographed cast-iron cover when available, else Con Edison style rings + waffle
  if (decals.manhole) {
    const x0 = 0, y0 = 2 * cell;
    const cx = x0 + cell / 2, cy = y0 + cell / 2, R = cell * 0.5;
    // the asphalt seal around the frame: a dark soft ring under the cover's edge
    const seal = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, R);
    seal.addColorStop(0, 'rgba(16,15,14,0.85)');
    seal.addColorStop(0.7, 'rgba(16,15,14,0.55)');
    seal.addColorStop(1, 'rgba(16,15,14,0)');
    g.fillStyle = seal;
    g.fillRect(x0, y0, cell, cell);
    g.drawImage(decals.manhole, x0 + cell * 0.03, y0 + cell * 0.03, cell * 0.94, cell * 0.94);
  } else {
    const x0 = 0, y0 = 2 * cell;
    const cx = x0 + cell / 2, cy = y0 + cell / 2, R = cell * 0.47;
    g.save();
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgb(58,56,54)';
    g.fillRect(x0, y0, cell, cell);
    // waffle pattern
    g.strokeStyle = 'rgba(30,29,28,0.9)';
    g.lineWidth = 3;
    const step = cell * 0.06;
    for (let i = -R; i <= R; i += step) {
      g.beginPath();
      g.moveTo(cx + i, cy - R);
      g.lineTo(cx + i, cy + R);
      g.stroke();
      g.beginPath();
      g.moveTo(cx - R, cy + i);
      g.lineTo(cx + R, cy + i);
      g.stroke();
    }
    // raised rings
    g.strokeStyle = 'rgba(120,116,110,0.9)';
    g.lineWidth = 4;
    for (const rr of [0.92, 0.72, 0.4]) {
      g.beginPath();
      g.arc(cx, cy, R * rr, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = 'rgba(20,20,20,0.9)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
    g.stroke();
    // lettering hint
    g.fillStyle = 'rgba(140,136,128,0.9)';
    g.font = `bold ${Math.round(cell * 0.11)}px Helvetica, Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('CON EDISON', cx, cy - R * 0.55);
    g.fillText('N.Y.C.', cx, cy + R * 0.58);
    g.restore();
  }
  // sewer grate (rectangular, 2 x 4 slots)
  {
    const x0 = cell, y0 = 2 * cell;
    g.fillStyle = 'rgb(40,38,36)';
    g.fillRect(x0 + cell * 0.04, y0 + cell * 0.04, cell * 0.92, cell * 0.92);
    g.fillStyle = 'rgb(8,8,8)';
    for (let i = 0; i < 6; i++) g.fillRect(x0 + cell * (0.12 + i * 0.13), y0 + cell * 0.14, cell * 0.06, cell * 0.72);
    g.strokeStyle = 'rgb(90,88,84)';
    g.lineWidth = 3;
    g.strokeRect(x0 + cell * 0.05, y0 + cell * 0.05, cell * 0.9, cell * 0.9);
  }
  // subway grate: tileable bar pattern over a void
  {
    const x0 = 2 * cell, y0 = 2 * cell;
    g.fillStyle = 'rgb(6,6,7)';
    g.fillRect(x0, y0, cell, cell);
    g.fillStyle = 'rgb(76,74,70)';
    const bars = 12;
    for (let i = 0; i < bars; i++) g.fillRect(x0, y0 + (i * cell) / bars, cell, cell / bars / 2.6);
    g.fillStyle = 'rgb(66,64,60)';
    for (let i = 0; i < 4; i++) g.fillRect(x0 + (i * cell) / 4, y0, cell * 0.02, cell);
  }
  // curb inlet (dark opening with a lintel)
  {
    const x0 = 3 * cell, y0 = 2 * cell;
    g.fillStyle = 'rgb(5,5,6)';
    g.fillRect(x0 + cell * 0.05, y0 + cell * 0.3, cell * 0.9, cell * 0.45);
    g.fillStyle = 'rgb(70,68,64)';
    g.fillRect(x0 + cell * 0.05, y0 + cell * 0.25, cell * 0.9, cell * 0.06);
  }
  // oil stain
  {
    const x0 = 0, y0 = 3 * cell;
    const grad = g.createRadialGradient(x0 + cell / 2, y0 + cell / 2, 0, x0 + cell / 2, y0 + cell / 2, cell * 0.45);
    grad.addColorStop(0, 'rgba(12,10,10,0.20)');
    grad.addColorStop(0.6, 'rgba(14,12,12,0.08)');
    grad.addColorStop(1, 'rgba(14,12,12,0)');
    g.fillStyle = grad;
    g.fillRect(x0, y0, cell, cell);
  }
  // tactile pad (tileable dome grid, red-brown)
  {
    const x0 = cell, y0 = 3 * cell;
    g.fillStyle = 'rgb(140,46,32)';
    g.fillRect(x0, y0, cell, cell);
    const n = 8;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const cx = x0 + ((i + 0.5) * cell) / n, cy = y0 + ((j + 0.5) * cell) / n;
        const grad = g.createRadialGradient(cx - cell * 0.012, cy - cell * 0.012, 0, cx, cy, cell * 0.035);
        grad.addColorStop(0, 'rgb(190,80,58)');
        grad.addColorStop(0.7, 'rgb(150,50,36)');
        grad.addColorStop(1, 'rgb(105,32,22)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx, cy, cell * 0.035, 0, Math.PI * 2);
        g.fill();
      }
  }
  // asphalt patch (dark fresh asphalt, soft edge)
  {
    const x0 = 2 * cell, y0 = 3 * cell;
    const img = g.createImageData(cell, cell);
    const w = white(cell, 77, 1);
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++) {
        const i = y * cell + x;
        const ex = Math.min(x, cell - 1 - x) / cell, ey = Math.min(y, cell - 1 - y) / cell;
        const e = Math.min(ex, ey);
        const a = clamp01(e / 0.03) * 0.85;
        const v = 0.16 + 0.05 * (w[i] - 0.5);
        img.data[i * 4] = v * 255;
        img.data[i * 4 + 1] = v * 255;
        img.data[i * 4 + 2] = v * 255 * 0.98;
        img.data[i * 4 + 3] = a * 255;
      }
    g.putImageData(img, x0, y0);
  }
  // bike symbol
  {
    const x0 = 3 * cell, y0 = 3 * cell;
    g.save();
    g.translate(x0 + cell / 2, y0 + cell / 2);
    g.strokeStyle = 'rgba(238,236,228,0.95)';
    g.lineWidth = cell * 0.05;
    g.beginPath();
    g.arc(-cell * 0.2, cell * 0.15, cell * 0.16, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(cell * 0.2, cell * 0.15, cell * 0.16, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(-cell * 0.2, cell * 0.15);
    g.lineTo(-cell * 0.02, -cell * 0.12);
    g.lineTo(cell * 0.2, cell * 0.15);
    g.lineTo(cell * 0.04, cell * 0.15);
    g.lineTo(-cell * 0.05, -cell * 0.12);
    g.moveTo(-cell * 0.02, -cell * 0.12);
    g.lineTo(cell * 0.08, -cell * 0.3);
    g.stroke();
    g.restore();
  }

  const t = new THREE.CanvasTexture(c);
  t.flipY = false; // ATLAS regions are measured from the top-left of the canvas
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = aniso;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ public */

export function createProceduralTextures(aniso: number, quality: string, skip: Partial<Record<'asphalt' | 'asphalt2' | 'concrete' | 'granite' | 'cobble', boolean>> = {}, decals: DecalImages = {}): StreetTextures {
  const big = quality === 'low' ? 512 : 1024;
  const t0 = performance.now();
  const blank = () => ({ albedo: dataTexture(new Uint8Array(4), 1, true, aniso), normal: dataTexture(new Uint8Array(4), 1, false, aniso), rough: dataTexture(new Uint8Array(4), 1, false, aniso) });
  const asphalt = skip.asphalt ? blank() : makeAsphalt(big, aniso, 101, 0.7);
  const asphalt2 = skip.asphalt2 ? blank() : makeAsphalt(big / 2, aniso, 202, 0.2);
  const concrete = skip.concrete ? blank() : makeConcrete(big, aniso, 303);
  const granite = skip.granite ? blank() : makeGranite(512, aniso, 404);
  const cobble = skip.cobble ? blank() : makeCobble(big, aniso, 505);
  const noise = makeNoise(256, 606);
  const atlas = makeAtlas(1024, aniso, decals);
  // the second asphalt variant only needs its albedo
  asphalt2.normal.dispose();
  asphalt2.rough.dispose();
  console.info(`[streets] procedural textures in ${(performance.now() - t0).toFixed(0)} ms`);
  return {
    asphalt: { albedo: asphalt.albedo, normal: asphalt.normal, rough: asphalt.rough, scale: 3.0 },
    asphalt2: asphalt2.albedo,
    asphalt2Scale: 3.0,
    concrete: { albedo: concrete.albedo, normal: concrete.normal, rough: concrete.rough, scale: 2.4 },
    granite: { albedo: granite.albedo, normal: granite.normal, rough: null, scale: 0.7 },
    cobble: { albedo: cobble.albedo, normal: cobble.normal, rough: cobble.rough, scale: 2.0 },
    noise,
    atlas,
    procedural: true,
  };
}

export function disposeTextures(t: StreetTextures): void {
  for (const set of [t.asphalt, t.concrete, t.granite, t.cobble]) {
    set.albedo.dispose();
    set.normal.dispose();
    set.rough?.dispose();
  }
  t.asphalt2.dispose();
  t.noise.dispose();
  t.atlas.dispose();
}

/* ------------------------------------------------------------------ manifest (CC0 PBR sets) */

interface ManifestEntry {
  id?: string;
  name?: string;
  path?: string;
  dir?: string;
  base?: string;
  scale?: number;
  size?: number;
  meters?: number;
  albedo?: string;
  color?: string;
  diffuse?: string;
  basecolor?: string;
  normal?: string;
  normalGL?: string;
  roughness?: string;
  rough?: string;
  files?: Record<string, string>;
  maps?: Record<string, string>;
  tags?: string[];
  category?: string;
  [k: string]: unknown;
}

function entryList(json: unknown): ManifestEntry[] {
  if (Array.isArray(json)) return json as ManifestEntry[];
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    for (const k of ['textures', 'entries', 'items', 'sets', 'materials']) {
      if (Array.isArray(o[k])) return o[k] as ManifestEntry[];
      if (o[k] && typeof o[k] === 'object') return Object.entries(o[k] as Record<string, ManifestEntry>).map(([id, e]) => ({ id, ...e }));
    }
    return Object.entries(o).filter(([, v]) => v && typeof v === 'object').map(([id, e]) => ({ id, ...(e as ManifestEntry) }));
  }
  return [];
}

function pickMap(e: ManifestEntry, keys: string[]): string | null {
  const pools: Record<string, unknown>[] = [e, e.files ?? {}, e.maps ?? {}];
  for (const pool of pools) {
    for (const k of Object.keys(pool)) {
      const lk = k.toLowerCase();
      if (keys.some((want) => lk === want || lk.includes(want))) {
        const v = pool[k];
        if (typeof v === 'string' && /\.(jpg|jpeg|png|webp|ktx2|basis)$/i.test(v)) return v;
      }
    }
  }
  return null;
}

function resolveUrl(base: string, e: ManifestEntry, file: string): string {
  if (/^(https?:)?\//.test(file)) return file;
  const dir = e.path ?? e.dir ?? e.base ?? '';
  const pre = dir ? (dir.endsWith('/') ? dir : dir + '/') : '';
  const rel = pre + file;
  if (rel.startsWith('assets/')) return '/' + rel;
  return rel.startsWith('/') ? rel : base + rel;
}

/** Try to load PBR sets from the manifest; returns null if the manifest is missing or has nothing usable. */
export async function loadManifestTextures(base = __launchBasePath('/assets/textures/')): Promise<Partial<Record<'asphalt' | 'concrete' | 'granite' | 'cobble', PbrSet>> & { asphalt2?: THREE.Texture; asphalt2Scale?: number } | null> {
  let json: unknown;
  try {
    const res = await __launchFetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }
  const entries = entryList(json);
  if (!entries.length) return null;
  const load = async (url: string, srgb: boolean): Promise<THREE.Texture | null> => {
    try {
      const t = await bitmapTexture(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      return t;
    } catch { return null; }
  };
  const find = (words: string[], exclude: string[] = []): ManifestEntry[] =>
    entries.filter((e) => {
      const s = `${e.id ?? e.slug ?? ''} ${e.name ?? e.title ?? ''} ${e.path ?? ''} ${e.category ?? ''} ${(e.tags ?? []).join(' ')}`.toLowerCase();
      return words.some((w) => s.includes(w)) && !exclude.some((w) => s.includes(w));
    });
  const out: Partial<Record<'asphalt' | 'concrete' | 'granite' | 'cobble', PbrSet>> & { asphalt2?: THREE.Texture; asphalt2Scale?: number } = {};
  const want: ['asphalt' | 'concrete' | 'granite' | 'cobble', string[], string[], number][] = [
    ['asphalt', ['asphalt', 'road', 'tarmac'], ['wall', 'roof'], 3],
    ['concrete', ['sidewalk', 'pavement', 'concrete'], ['wall', 'block', 'brick', 'paver', 'tile'], 2.5],
    ['granite', ['granite', 'curb', 'stone'], ['wall', 'brick', 'cobble', 'paver'], 0.7],
    ['cobble', ['cobble', 'sett', 'belgian', 'paving'], ['wall'], 2],
  ];
  await Promise.all(want.map(async ([key, words, exclude, scale]) => {
    const cands = find(words, exclude);
    // The shader supplies metre-scale joints. Prefer the unjointed concrete
    // detail map over a photograph of rectangular paving with another grid.
    if (key === 'concrete') cands.sort((a, b) => Number(b.slug === 'plaza-concrete') - Number(a.slug === 'plaza-concrete'));
    for (const e of cands) {
      const alb = pickMap(e, ['albedo', 'color', 'diffuse', 'basecolor', 'base_color', 'col']);
      const nrm = pickMap(e, ['normal', 'nrm', 'nor']);
      if (!alb) continue;
      const size = e.physicalSizeM ?? e.scale ?? e.meters ?? e.size;
      const s = typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : scale;
      if (key === 'asphalt' && out.asphalt) {
        const a = await load(resolveUrl(base, e, alb), true);
        if (a) { out.asphalt2 = a; out.asphalt2Scale = s; break; }
        continue;
      }
      const rgh = pickMap(e, ['rough']);
      const [a, n, r] = await Promise.all([load(resolveUrl(base, e, alb), true), nrm ? load(resolveUrl(base, e, nrm), false) : Promise.resolve(null), rgh ? load(resolveUrl(base, e, rgh), false) : Promise.resolve(null)]);
      if (!a) { n?.dispose(); r?.dispose(); continue; }
      if (!n) {
        // no normal map: keep the procedural one (null marks "keep")
        (out as Record<string, unknown>)[key] = { albedo: a, normal: null as unknown as THREE.Texture, rough: r, scale: s };
      } else (out as Record<string, unknown>)[key] = { albedo: a, normal: n, rough: r, scale: s };
      if (key !== 'asphalt') break;
    }
  }));
  return Object.keys(out).length ? out : null;
}
