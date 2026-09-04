/**
 * Procedural textures for the combat module (all generated once on canvases, all tileable where needed).
 * Weapons: polymer stipple normal, brushed-steel normal, walnut albedo/normal, grunge (roughness/wear).
 * FX: particle atlas, decal atlas, muzzle flash flipbook, tracer gradient, ground ring, hex grid, beam gradient.
 */
import * as THREE from 'three';
import { finishNow, scheduleInit } from './init';
import type { GameContext } from '@/core/context';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return { c, g };
}

function tex(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: boolean; aniso?: number } = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (opts.repeat !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  else t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = opts.aniso ?? 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** deterministic hash -> [0,1) */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable value noise, `cells` lattice cells across the width; returns values in [0,1]. */
function* tileableNoiseSteps(w: number, h: number, cells: number, octaves: number, seed: number, persistence = 0.5): Generator<void, Float32Array, unknown> {
  const out = new Float32Array(w * h);
  let amp = 1, norm = 0;
  let c = cells;
  for (let o = 0; o < octaves; o++) {
    const cw = c, ch = Math.max(1, Math.round((c * h) / w));
    for (let y = 0; y < h; y++) {
      yield;
      const fy = (y / h) * ch;
      const y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cw;
        const x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = hash2(x0 % cw, y0 % ch, seed + o);
        const b = hash2((x0 + 1) % cw, y0 % ch, seed + o);
        const cc = hash2(x0 % cw, (y0 + 1) % ch, seed + o);
        const d = hash2((x0 + 1) % cw, (y0 + 1) % ch, seed + o);
        const v = a + (b - a) * sx + (cc - a) * sy + (a - b - cc + d) * sx * sy;
        out[y * w + x] += v * amp;
      }
    }
    norm += amp;
    amp *= persistence;
    c *= 2;
  }
  for (let i = 0; i < out.length; i++) {
    if (i % 1024 === 0) yield;
    out[i] /= norm;
  }
  return out;
}

/** height field -> tangent-space normal map canvas (wraps at the edges) */
function* heightToNormalCanvasSteps(hf: Float32Array, w: number, h: number, strength: number): Generator<void, HTMLCanvasElement, unknown> {
  const { c, g } = canvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    yield;
    const yp = (y + h - 1) % h, yn = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const xp = (x + w - 1) % w, xn = (x + 1) % w;
      const dx = (hf[y * w + xn] - hf[y * w + xp]) * strength;
      const dy = (hf[yn * w + x] - hf[yp * w + x]) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export interface WeaponTextures {
  polymerNormal: THREE.Texture;
  steelNormal: THREE.Texture;
  woodMap: THREE.Texture;
  woodNormal: THREE.Texture;
  grunge: THREE.Texture;
}

let weaponTex: WeaponTextures | null = null;
let woodTex: Pick<WeaponTextures, 'woodMap' | 'woodNormal'> | null = null;
function* getWeaponTexturesSteps(wood = false): Generator<void, WeaponTextures, unknown> {
  if (weaponTex && (!wood || woodTex)) return wood ? { ...weaponTex, ...woodTex! } : weaponTex;
  let polymerNormal: THREE.Texture, steelNormal: THREE.Texture, woodMap: THREE.Texture, woodNormal: THREE.Texture, grunge: THREE.Texture;
  if (!weaponTex) {
    // polymer: dense stipple (raised dots) + very slight low-frequency waviness of the moulding
    {
      const w = 256, h = 256;
      const hf = new Float32Array(w * h);
      const low = yield* tileableNoiseSteps(w, h, 6, 2, 11);
      for (let y = 0; y < h; y++) {
        yield;
        for (let x = 0; x < w; x++) {
          let v = low[y * w + x] * 0.25;
          // stipple: hashed cells with a round bump in each
          const cell = 5;
          const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
          const jx = hash2(cx, cy, 3) * 0.6 + 0.2, jy = hash2(cx, cy, 4) * 0.6 + 0.2;
          const px = (x % cell) / cell - jx, py = (y % cell) / cell - jy;
          const r = Math.sqrt(px * px + py * py) / 0.42;
          if (r < 1) v += (1 - r * r) * 0.9 * (0.6 + 0.4 * hash2(cx, cy, 5));
          hf[y * w + x] = v;
        }
      }
      polymerNormal = tex(yield* heightToNormalCanvasSteps(hf, w, h, 1.6));
    }
    // brushed steel: long horizontal streaks (anisotropic look) + faint pitting
    {
      const w = 256, h = 256;
      const hf = new Float32Array(w * h);
      const streak = yield* tileableNoiseSteps(w, h, 2, 1, 21);
      const fine = yield* tileableNoiseSteps(w, h, 64, 2, 22);
      for (let y = 0; y < h; y++) {
        yield;
        const rowA = hash2(y, 0, 31), rowB = hash2(y, 1, 32);
        for (let x = 0; x < w; x++) {
          // streaks: per-row amplitude, smooth along x
          const s = Math.sin((x / w) * Math.PI * 2 * (1 + Math.floor(rowB * 3))) * 0.5 + 0.5;
          hf[y * w + x] = rowA * 0.6 + s * 0.08 + streak[y * w + x] * 0.1 + fine[y * w + x] * 0.12;
        }
      }
      steelNormal = tex(yield* heightToNormalCanvasSteps(hf, w, h, 0.9));
    }
    // grunge: greyscale wear mask (scratches + smudges). R = roughness variation, G = edge-wear-ish blotches.
    {
      const w = 256, h = 256;
      const { c, g } = canvas(w, h);
      const img = g.createImageData(w, h);
      const d = img.data;
      const blot = yield* tileableNoiseSteps(w, h, 4, 4, 51, 0.6);
      const fine = yield* tileableNoiseSteps(w, h, 32, 2, 52);
      for (let y = 0; y < h; y++) {
        yield;
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          let scratch = 0;
          // a few long thin diagonal scratches
          for (let s = 0; s < 6; s++) {
            const sy = hash2(s, 0, 61) * h, sx = hash2(s, 1, 62) * w, ang = (hash2(s, 2, 63) - 0.5) * 0.8;
            const dx = ((x - sx + w * 1.5) % w) - w / 2, dy = ((y - sy + h * 1.5) % h) - h / 2;
            const dist = Math.abs(dy - dx * ang) / Math.sqrt(1 + ang * ang);
            if (dist < 0.9 && Math.abs(dx) < 60 + s * 10) scratch = Math.max(scratch, 1 - dist);
          }
          const k = i * 4;
          d[k] = Math.max(0, Math.min(255, 128 + (fine[i] - 0.5) * 120 + (blot[i] - 0.5) * 80));
          d[k + 1] = Math.max(0, Math.min(255, Math.max(0, blot[i] - 0.55) * 500 + scratch * 200));
          d[k + 2] = 0;
          d[k + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      grunge = tex(c);
    }
    // Non-wood vertices never sample these uniforms; reuse a ready texture until wood is needed.
    weaponTex = { polymerNormal, steelNormal, woodMap: polymerNormal, woodNormal: polymerNormal, grunge };
  }
  if (wood && !woodTex) {
    // walnut: grain lines along v with gentle waviness, darker pores
    {
      const w = 256, h = 512;
      const { c, g } = canvas(w, h);
      const img = g.createImageData(w, h);
      const d = img.data;
      const wave = yield* tileableNoiseSteps(w, h, 3, 3, 41);
      const pores = yield* tileableNoiseSteps(w, h, 48, 2, 42);
      const hf = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        yield;
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const u = x / w + (wave[i] - 0.5) * 0.35;
          const ring = Math.sin(u * Math.PI * 2 * 9) * 0.5 + 0.5;
          const grain = Math.pow(ring, 2.2);
          const pore = pores[i] > 0.62 ? (pores[i] - 0.62) * 2.5 : 0;
          const t = grain * 0.55 + (wave[i] - 0.5) * 0.25 - pore * 0.5;
          // walnut palette: dark chocolate to warm mid-brown (sRGB)
          const r = 0x5c + t * 0x3a, gg = 0x38 + t * 0x22, b = 0x22 + t * 0x10;
          const k = (y * w + x) * 4;
          d[k] = Math.max(0, Math.min(255, r));
          d[k + 1] = Math.max(0, Math.min(255, gg));
          d[k + 2] = Math.max(0, Math.min(255, b));
          d[k + 3] = 255;
          hf[i] = grain * 0.5 - pore;
        }
      }
      g.putImageData(img, 0, 0);
      woodMap = tex(c, { srgb: true, aniso: 8 });
      woodNormal = tex(yield* heightToNormalCanvasSteps(hf, w, h, 0.7));
    }
    woodTex = { woodMap: woodMap!, woodNormal: woodNormal! };
  }
  return wood ? { ...weaponTex, ...woodTex! } : weaponTex;
}

/** Particle atlas: 4 cells of 128 px — 0 soft puff, 1 chip, 2 spark streak, 3 blood drop. */
function* makeParticleAtlasSteps(): Generator<void, THREE.Texture, unknown> {
  const s = 128;
  const { c, g } = canvas(s * 4, s);
  // 0: soft dust puff, irregular edge
  {
    const img = g.createImageData(s, s);
    const d = img.data;
    const n = yield* tileableNoiseSteps(s, s, 4, 3, 71);
    for (let y = 0; y < s; y++) {
      yield;
      for (let x = 0; x < s; x++) {
        const dx = (x + 0.5) / s - 0.5, dy = (y + 0.5) / s - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const edge = 1 - Math.min(1, r / (0.75 + (n[y * s + x] - 0.5) * 0.5));
        const a = Math.pow(Math.max(0, edge), 1.6) * (0.55 + 0.45 * n[y * s + x]);
        const k = (y * s + x) * 4;
        d[k] = d[k + 1] = d[k + 2] = 255;
        d[k + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
  }
  // 1: chip — a small angular shard (polygon) with shading
  {
    g.save();
    g.translate(s * 1.5, s * 0.5);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(-40, -10);
    g.lineTo(-8, -42);
    g.lineTo(38, -14);
    g.lineTo(30, 30);
    g.lineTo(-20, 38);
    g.closePath();
    g.fill();
    const grad = g.createLinearGradient(-40, -40, 40, 40);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grad;
    g.fill();
    g.restore();
  }
  // 2: spark — horizontal streak, hot white core, warm falloff
  {
    const img = g.createImageData(s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) {
      yield;
      for (let x = 0; x < s; x++) {
        const u = (x + 0.5) / s - 0.5, v = ((y + 0.5) / s - 0.5) * 2;
        const along = 1 - Math.min(1, Math.abs(u) * 2.05);
        const across = Math.exp(-v * v * 40);
        const a = Math.pow(along, 0.9) * across;
        const core = Math.pow(along, 2.5) * Math.exp(-v * v * 160);
        const k = (y * s + x) * 4;
        d[k] = 255;
        d[k + 1] = Math.min(255, 160 + core * 95);
        d[k + 2] = Math.min(255, 60 + core * 195);
        d[k + 3] = Math.min(255, a * 255);
      }
    }
    g.putImageData(img, s * 2, 0);
  }
  // 3: blood drop / mist — irregular blob, dark rim
  {
    const img = g.createImageData(s, s);
    const d = img.data;
    const n = yield* tileableNoiseSteps(s, s, 3, 3, 81);
    for (let y = 0; y < s; y++) {
      yield;
      for (let x = 0; x < s; x++) {
        const dx = (x + 0.5) / s - 0.5, dy = (y + 0.5) / s - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const edge = 1 - Math.min(1, r / (0.55 + (n[y * s + x] - 0.5) * 0.7));
        const a = Math.pow(Math.max(0, edge), 0.7);
        const k = (y * s + x) * 4;
        const t = Math.pow(Math.max(0, edge), 2);
        d[k] = 255;
        d[k + 1] = 40 + t * 40;
        d[k + 2] = 30 + t * 30;
        d[k + 3] = a * 255;
      }
    }
    g.putImageData(img, s * 3, 0);
  }
  return tex(c, { srgb: true, repeat: false });
}

/** Decal atlas: 4 cells of 128 px — 0 bullet hole (concrete/asphalt), 1 blood splat, 2 paint chip on metal, 3 torn wood. Alpha = coverage. */
function* makeDecalAtlasSteps(): Generator<void, THREE.Texture, unknown> {
  const s = 128;
  const { c, g } = canvas(s * 4, s);
  // 0: bullet hole: black crater center, lighter chipped ring (lighter than the wall), radial cracks
  {
    const img = g.createImageData(s, s);
    const d = img.data;
    const n = yield* tileableNoiseSteps(s, s, 6, 3, 91);
    for (let y = 0; y < s; y++) {
      yield;
      for (let x = 0; x < s; x++) {
        const dx = (x + 0.5) / s - 0.5, dy = (y + 0.5) / s - 0.5;
        const ang = Math.atan2(dy, dx);
        const wob = 1 + (n[y * s + x] - 0.5) * 0.9;
        const r = Math.sqrt(dx * dx + dy * dy) * 2 * wob;
        const hole = 1 - Math.min(1, r / 0.28);
        const chip = r > 0.2 && r < 0.9 ? (1 - Math.abs(r - 0.5) / 0.45) * (0.5 + 0.5 * Math.pow(Math.abs(Math.sin(ang * 3.5 + n[y * s + x] * 6)), 2)) : 0;
        let cracks = 0;
        for (let k = 0; k < 5; k++) {
          const a0 = (k / 5) * Math.PI * 2 + hash2(k, 0, 5) * 1.2;
          let da = Math.abs(((ang - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          da *= r * 10;
          if (r > 0.25 && r < 1.0) cracks = Math.max(cracks, (1 - Math.min(1, da / 0.22)) * (1 - r) * 1.2);
        }
        const k = (y * s + x) * 4;
        const dark = Math.max(hole, cracks * 0.8);
        const light = chip * (1 - hole) * 0.9;
        // premultiplied-ish: color ramps from lighter chip (bright grey) to black; alpha = coverage
        const shade = light * 200;
        d[k] = shade;
        d[k + 1] = shade * 0.98;
        d[k + 2] = shade * 0.94;
        d[k + 3] = Math.min(255, (Math.max(dark, light * 0.75)) * 255);
        if (dark > light) {
          d[k] = d[k + 1] = d[k + 2] = 12 * (1 - hole);
        }
      }
    }
    g.putImageData(img, 0, 0);
  }
  // 1: blood splat: dark red irregular pool with satellite drops
  {
    const img = g.createImageData(s, s);
    const d = img.data;
    const n = yield* tileableNoiseSteps(s, s, 3, 4, 101, 0.55);
    for (let y = 0; y < s; y++) {
      yield;
      for (let x = 0; x < s; x++) {
        const dx = (x + 0.5) / s - 0.5, dy = (y + 0.5) / s - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const th = 0.45 + (n[y * s + x] - 0.5) * 0.9;
        let a = r < th ? 1 : 0;
        // satellites
        for (let k = 0; k < 9; k++) {
          const sx = (hash2(k, 0, 111) - 0.5) * 0.9, sy = (hash2(k, 1, 112) - 0.5) * 0.9, sr = 0.04 + hash2(k, 2, 113) * 0.07;
          const ddx = dx - sx, ddy = dy - sy;
          if (ddx * ddx + ddy * ddy < sr * sr) a = 1;
        }
        const k = (y * s + x) * 4;
        const t = n[y * s + x];
        d[k] = 70 + t * 40;
        d[k + 1] = 6 + t * 6;
        d[k + 2] = 6 + t * 4;
        d[k + 3] = a * (200 + t * 55);
      }
    }
    g.putImageData(img, s, 0);
  }
  // 2: paint chip on metal: bright bare-metal scuff with a darker dented center, ragged edge, a few radial scratches
  {
    const img = g.createImageData(s, s);
    const d = img.data;
    const n = yield* tileableNoiseSteps(s, s, 5, 3, 131);
    for (let y = 0; y < s; y++) {
      yield;
      for (let x = 0; x < s; x++) {
        const dx = (x + 0.5) / s - 0.5, dy = (y + 0.5) / s - 0.5;
        const ang = Math.atan2(dy, dx);
        const wob = 1 + (n[y * s + x] - 0.5) * 1.1;
        const r = Math.sqrt(dx * dx + dy * dy) * 2 * wob;
        const dent = 1 - Math.min(1, r / 0.32);
        const bare = r < 0.8 ? 1 - Math.pow(r / 0.8, 3) : 0;
        let scratch = 0;
        for (let k = 0; k < 4; k++) {
          const a0 = (k / 4) * Math.PI * 2 + hash2(k, 1, 7) * 1.5;
          const da = Math.abs(((ang - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * r * 12;
          if (r > 0.3 && r < 1.0) scratch = Math.max(scratch, (1 - Math.min(1, da / 0.25)) * (1 - r));
        }
        const k = (y * s + x) * 4;
        const shade = 150 + bare * 70 - dent * 120 + scratch * 60;
        d[k] = Math.max(0, Math.min(255, shade));
        d[k + 1] = Math.max(0, Math.min(255, shade * 0.99));
        d[k + 2] = Math.max(0, Math.min(255, shade * 0.97));
        d[k + 3] = Math.min(255, Math.max(bare * 0.9, dent, scratch * 0.7) * 255);
      }
    }
    g.putImageData(img, s * 2, 0);
  }
  // 3: wood: a torn light crater, elongated along the grain (x), fibrous streaks, a darker pit in the middle
  {
    const img = g.createImageData(s, s);
    const d = img.data;
    const n = yield* tileableNoiseSteps(s, s, 4, 3, 141);
    for (let y = 0; y < s; y++) {
      yield;
      for (let x = 0; x < s; x++) {
        const dx = (x + 0.5) / s - 0.5, dy = (y + 0.5) / s - 0.5;
        const wob = 1 + (n[y * s + x] - 0.5) * 0.8;
        const r = Math.sqrt(dx * dx * 0.55 + dy * dy * 1.6) * 2 * wob;
        const pit = 1 - Math.min(1, r / 0.3);
        const torn = r < 1 ? Math.pow(1 - r, 0.8) * (0.6 + 0.4 * Math.abs(Math.sin(dy * 90 + n[y * s + x] * 5))) : 0;
        const k = (y * s + x) * 4;
        const light = torn * (1 - pit);
        d[k] = Math.min(255, 210 * light + 40 * pit);
        d[k + 1] = Math.min(255, 175 * light + 26 * pit);
        d[k + 2] = Math.min(255, 120 * light + 14 * pit);
        d[k + 3] = Math.min(255, Math.max(pit, light * 0.85) * 255);
      }
    }
    g.putImageData(img, s * 3, 0);
  }
  return tex(c, { srgb: true, repeat: false });
}

/** Muzzle flash flipbook: 3 frames of 256 px side by side. 0 big starburst, 1 smaller burst, 2 a dim orange ember. */
function* makeFlashFlipbookSteps(): Generator<void, THREE.Texture, unknown> {
  const s = 256;
  const { c, g } = canvas(s * 3, s);
  const scales = [1, 0.68, 0.42];
  const spikesN = [7, 5, 4];
  for (let f = 0; f < 3; f++) {
    const img = g.createImageData(s, s);
    const d = img.data;
    const seed = 121 + f * 7;
    const scale = scales[f];
    const spikes = spikesN[f];
    const ember = f === 2;
    for (let y = 0; y < s; y++) {
      yield;
      for (let x = 0; x < s; x++) {
        const dx = ((x + 0.5) / s - 0.5) / scale, dy = ((y + 0.5) / s - 0.5) / scale;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const ang = Math.atan2(dy, dx);
        let star = 0;
        for (let k = 0; k < spikes; k++) {
          const a0 = (k / spikes) * Math.PI * 2 + hash2(k, f, seed) * 0.9;
          const len = 0.55 + hash2(k, f + 3, seed) * 0.5;
          const da = Math.abs(((ang - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          const width = 0.22 * (1 - Math.min(1, r / len)) + 0.02;
          star = Math.max(star, (1 - Math.min(1, da / width)) * Math.max(0, 1 - r / len));
        }
        const core = Math.exp(-r * r * 9);
        const glow = Math.exp(-r * r * 2.2) * (ember ? 0.6 : 0.35);
        const v = Math.min(1, core * (ember ? 1.4 : 1.2) + star * (ember ? 0.45 : 0.9) + glow);
        const k = (y * s + x) * 4;
        // hot white core -> orange -> deep orange edge; the ember frame is cooler (more orange, less white)
        const hot = ember ? Math.pow(v, 1.6) : v;
        d[k] = 255;
        d[k + 1] = Math.min(255, (ember ? 90 : 120) + hot * 135);
        d[k + 2] = Math.min(255, 30 + Math.pow(hot, 2.5) * 225);
        d[k + 3] = Math.min(255, v * 255);
      }
    }
    g.putImageData(img, f * s, 0);
  }
  return tex(c, { srgb: true, repeat: false });
}

/** Tracer: 64x8 horizontal gradient, bright middle, transparent ends, soft across. */
function* makeTracerTextureSteps(): Generator<void, THREE.Texture, unknown> {
  const w = 64, h = 8;
  const { c, g } = canvas(w, h);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
      yield;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w, v = ((y + 0.5) / h - 0.5) * 2;
      const along = Math.pow(Math.sin(u * Math.PI), 0.6);
      const across = Math.exp(-v * v * 5);
      const k = (y * w + x) * 4;
      d[k] = 255;
      d[k + 1] = 230;
      d[k + 2] = 170;
      d[k + 3] = along * across * 255;
    }
    }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: true, repeat: false });
}

/** Soft radial ring (for pickup ground glow): alpha peaks at r=0.6, fades both ways. */
function* makeRingTextureSteps(): Generator<void, THREE.Texture, unknown> {
  const s = 128;
  const { c, g } = canvas(s, s);
  const img = g.createImageData(s, s);
  const d = img.data;
  for (let y = 0; y < s; y++) {
      yield;
    for (let x = 0; x < s; x++) {
      const dx = (x + 0.5) / s - 0.5, dy = (y + 0.5) / s - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const ring = Math.exp(-Math.pow((r - 0.62) / 0.16, 2));
      const fill = Math.max(0, 1 - r / 0.62) * 0.18;
      const k = (y * s + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = 255;
      d[k + 3] = Math.min(255, (ring + fill) * 255);
    }
    }
  g.putImageData(img, 0, 0);
  return tex(c, { repeat: false });
}

/** Tileable hex grid lines (for the safe-zone shimmer wall): alpha = line coverage, soft. */
export function makeHexTexture(): THREE.Texture {
  const w = 128, h = 148; // hex tiling ratio ~ sqrt(3)
  const { c, g } = canvas(w, h);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 2.2;
  g.lineJoin = 'round';
  // hex radius so the pattern tiles: width = sqrt(3)*R*2 columns... draw a 2x2 tile of pointy-top hexes
  const R = w / (2 * Math.sqrt(3));
  const hexAt = (cx: number, cy: number) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      const px = cx + R * Math.cos(a), py = cy + R * Math.sin(a);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.stroke();
  };
  const dxs = Math.sqrt(3) * R, dys = 1.5 * R;
  for (let row = -1; row <= 3; row++)
    for (let col = -1; col <= 3; col++) {
      const cx = col * dxs + (row % 2 ? dxs / 2 : 0), cy = row * dys;
      hexAt(cx, cy);
    }
  // slight blur-ish softening by a second lighter pass
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = 5;
  for (let row = -1; row <= 3; row++)
    for (let col = -1; col <= 3; col++) {
      const cx = col * dxs + (row % 2 ? dxs / 2 : 0), cy = row * dys;
      hexAt(cx, cy);
    }
  const t = tex(c);
  return t;
}

/** Label sprite canvas: name with a soft dark outline; returns a texture + aspect. */
export function makeLabelTexture(text: string, sub?: string): { texture: THREE.Texture; aspect: number } {
  const font = '600 44px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const subFont = '500 26px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const m = canvas(4, 4);
  m.g.font = font;
  const wText = m.g.measureText(text).width;
  m.g.font = subFont;
  const wSub = sub ? m.g.measureText(sub).width : 0;
  const w = Math.ceil(Math.max(wText, wSub) + 48);
  const h = sub ? 108 : 72;
  const { c, g } = canvas(w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = 8;
  g.strokeText(text, w / 2, sub ? 36 : h / 2);
  g.fillStyle = '#f4f6f8';
  g.fillText(text, w / 2, sub ? 36 : h / 2);
  if (sub) {
    g.font = subFont;
    g.lineWidth = 6;
    g.strokeText(sub, w / 2, 82);
    g.fillStyle = '#b9c3d0';
    g.fillText(sub, w / 2, 82);
  }
  const t = tex(c, { srgb: true, repeat: false });
  t.generateMipmaps = true;
  return { texture: t, aspect: w / h };
}

const preparedFx = new Map<string, THREE.Texture>();
export function* prepareFxTextures(): Generator<void, void, unknown> {
  preparedFx.set('makeParticleAtlas', yield* makeParticleAtlasSteps());
  preparedFx.set('makeDecalAtlas', yield* makeDecalAtlasSteps());
  preparedFx.set('makeFlashFlipbook', yield* makeFlashFlipbookSteps());
  preparedFx.set('makeTracerTexture', yield* makeTracerTextureSteps());
  preparedFx.set('makeRingTexture', yield* makeRingTextureSteps());
}
export function makeParticleAtlas(): THREE.Texture {
  const ready = preparedFx.get('makeParticleAtlas');
  preparedFx.delete('makeParticleAtlas');
  return ready ?? finishNow(makeParticleAtlasSteps());
}
export function makeDecalAtlas(): THREE.Texture {
  const ready = preparedFx.get('makeDecalAtlas');
  preparedFx.delete('makeDecalAtlas');
  return ready ?? finishNow(makeDecalAtlasSteps());
}
export function makeFlashFlipbook(): THREE.Texture {
  const ready = preparedFx.get('makeFlashFlipbook');
  preparedFx.delete('makeFlashFlipbook');
  return ready ?? finishNow(makeFlashFlipbookSteps());
}
export function makeTracerTexture(): THREE.Texture {
  const ready = preparedFx.get('makeTracerTexture');
  preparedFx.delete('makeTracerTexture');
  return ready ?? finishNow(makeTracerTextureSteps());
}
export function makeRingTexture(): THREE.Texture {
  const ready = preparedFx.get('makeRingTexture');
  preparedFx.delete('makeRingTexture');
  return ready ?? finishNow(makeRingTextureSteps());
}
export function getWeaponTextures(wood = false): WeaponTextures {
  return finishNow(getWeaponTexturesSteps(wood));
}
export function prepareWeaponTextures(ctx: GameContext, wood: boolean, signal?: AbortSignal): Promise<WeaponTextures> {
  return scheduleInit(ctx, getWeaponTexturesSteps(wood), signal);
}
export function disposeWeaponTextures(): void {
  for (const texture of new Set([...Object.values(weaponTex ?? {}), ...Object.values(woodTex ?? {}), ...preparedFx.values()])) texture.dispose();
  weaponTex = null;
  woodTex = null;
  preparedFx.clear();
}
export function tileableNoise(w: number, h: number, cells: number, octaves: number, seed: number, persistence = 0.5): Float32Array {
  return finishNow(tileableNoiseSteps(w, h, cells, octaves, seed, persistence));
}
export function heightToNormalCanvas(hf: Float32Array, w: number, h: number, strength: number): HTMLCanvasElement {
  return finishNow(heightToNormalCanvasSteps(hf, w, h, strength));
}
