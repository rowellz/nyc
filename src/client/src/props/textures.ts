/**
 * Procedural textures (canvas) for the props: weathering/grime for painted metal, green plywood for
 * sidewalk sheds, the wire-mesh alpha for litter baskets, the pedestrian-signal frame strip, and a
 * soft radial light pool. CC0 PBR textures from client/public/assets/textures replace the grime map
 * when the manifest exists (see index.ts pollTextures).
 */
import * as THREE from 'three';
import { rng } from './builder';

function canvas(w: number, h: number): { c: HTMLCanvasElement | OffscreenCanvas; g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  const c = typeof document === 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  return { c, g };
}

function toTexture(c: HTMLCanvasElement | OffscreenCanvas, opts: { srgb?: boolean; repeat?: boolean; aniso?: number; mip?: boolean } = {}): THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas> {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = opts.repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = opts.aniso ?? 8;
  t.generateMipmaps = opts.mip !== false;
  t.minFilter = opts.mip === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** near-white grime/scratch map that multiplies the vertex color; 1 tile = 1 m */
export function makeGrimeTexture(size = 512, seed = 7): THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas> {
  const { c, g } = canvas(size, size);
  const r = rng(seed);
  g.fillStyle = '#e9e9e9';
  g.fillRect(0, 0, size, size);
  // low frequency blotches
  for (let i = 0; i < 90; i++) {
    const x = r() * size, y = r() * size, rad = 20 + r() * 90;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = 0.75 + r() * 0.2;
    grad.addColorStop(0, `rgba(${Math.round(dark * 255)},${Math.round(dark * 250)},${Math.round(dark * 240)},${0.25 + r() * 0.35})`);
    grad.addColorStop(1, 'rgba(230,230,230,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // fine speckle
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 22;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
  // scratches / drips
  g.strokeStyle = 'rgba(120,115,110,0.35)';
  for (let i = 0; i < 60; i++) {
    g.lineWidth = 0.5 + r() * 1.5;
    const x = r() * size, y = r() * size;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 30, y + 10 + r() * 60);
    g.stroke();
  }
  // light streaks
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 40; i++) {
    g.lineWidth = 0.5 + r();
    const x = r() * size, y = r() * size;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (r() - 0.5) * 80, y + (r() - 0.5) * 12);
    g.stroke();
  }
  return toTexture(c, { srgb: true, repeat: true });
}

/**
 * Sidewalk shed parapet: two 8x4 sheets of NYC hunter-green plywood side by side (u 0..0.5 and 0.5..1).
 * Sheet A carries the POST NO BILLS stencil, sheet B the laminated DOB permit + contractor band, so a
 * per-bay u offset (instance aData.x) breaks the repeat along the shed. 1 sheet = 2.44 m x 1.22 m.
 */
export function makePlywoodTexture(w = 2048, h = 512): THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas> {
  const { c, g } = canvas(w, h);
  const r = rng(31);
  const sw = w / 2;
  g.fillStyle = '#1f4a2c';
  g.fillRect(0, 0, w, h);
  // wood grain through the paint
  for (let i = 0; i < 520; i++) {
    g.strokeStyle = `rgba(${10 + r() * 30},${40 + r() * 40},${20 + r() * 25},${0.12 + r() * 0.2})`;
    g.lineWidth = 1 + r() * 3;
    const y = r() * h;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 64) g.lineTo(x, y + (r() - 0.5) * 8);
    g.stroke();
  }
  // weathering: pale patches, water stains, a chalky bloom near the top edge
  for (let i = 0; i < 52; i++) {
    const x = r() * w, y = r() * h, rad = 30 + r() * 120;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(${60 + r() * 60},${90 + r() * 50},${60 + r() * 40},${0.15 + r() * 0.25})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const top = g.createLinearGradient(0, 0, 0, h * 0.25);
  top.addColorStop(0, 'rgba(180,190,170,0.22)');
  top.addColorStop(1, 'rgba(180,190,170,0)');
  g.fillStyle = top;
  g.fillRect(0, 0, w, h * 0.25);
  // drips from the top edge
  g.strokeStyle = 'rgba(20,30,20,0.35)';
  for (let i = 0; i < 40; i++) {
    g.lineWidth = 1 + r() * 2;
    const x = r() * w;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (r() - 0.5) * 6, h * (0.15 + r() * 0.5));
    g.stroke();
  }
  // sheet seams (the 4 ft edges) + screw heads on both sheets
  for (const x0 of [0, sw]) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(x0 + sw - 3, 0, 3, h);
    g.fillStyle = 'rgba(30,30,30,0.8)';
    for (let i = 0; i < 8; i++) {
      g.beginPath();
      g.arc(x0 + 14 + (i % 2) * (sw - 28), 20 + Math.floor(i / 2) * ((h - 40) / 3), 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // sheet A: the POST NO BILLS stencil, slightly over-sprayed
  g.fillStyle = 'rgba(245,245,240,0.82)';
  g.font = `bold ${Math.round(h * 0.17)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('POST NO BILLS', sw * 0.5, h * 0.5);
  g.fillStyle = 'rgba(245,245,240,0.12)';
  g.fillText('POST NO BILLS', sw * 0.5 + 3, h * 0.5 + 2);
  // sheet B: the laminated DOB permit (white sheet, a few lines of small print) and the contractor band
  const px = sw + sw * 0.08, py = h * 0.12, pw = sw * 0.16, ph = h * 0.5;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(px + 3, py + 3, pw, ph);
  g.fillStyle = '#f2f1ea';
  g.fillRect(px, py, pw, ph);
  g.fillStyle = '#c8102e';
  g.fillRect(px, py, pw, ph * 0.14);
  g.fillStyle = '#ffffff';
  g.font = `bold ${Math.round(ph * 0.09)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.fillText('WORK PERMIT', px + pw / 2, py + ph * 0.07);
  g.fillStyle = '#222';
  for (let i = 0; i < 7; i++) {
    const y = py + ph * (0.22 + i * 0.1);
    g.fillRect(px + pw * 0.08, y, pw * (0.5 + r() * 0.4), ph * 0.035);
  }
  g.fillStyle = '#1a1a1a';
  g.fillRect(px + pw * 0.3, py + ph * 0.88, pw * 0.4, ph * 0.08);
  // contractor band (white letters, stencilled)
  g.fillStyle = 'rgba(245,245,240,0.75)';
  g.font = `bold ${Math.round(h * 0.1)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.fillText('SIDEWALK SHED  •  212-555-0148', sw + sw * 0.6, h * 0.42);
  g.font = `bold ${Math.round(h * 0.06)}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
  g.fillStyle = 'rgba(245,245,240,0.5)';
  g.fillText('SCAFFOLDING  •  HOISTING  •  SHORING', sw + sw * 0.6, h * 0.58);
  // pasted flyers / torn posters + one tag on each sheet
  for (let i = 0; i < 7; i++) {
    const x = r() * (w - 80), y = h * 0.15 + r() * (h * 0.55);
    g.fillStyle = `rgba(${220 + r() * 35},${215 + r() * 35},${200 + r() * 40},0.9)`;
    g.fillRect(x, y, 40 + r() * 40, 50 + r() * 40);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    for (let k = 0; k < 4; k++) g.fillRect(x + 6, y + 8 + k * 10, 20 + r() * 30, 3);
  }
  for (const x0 of [0, sw]) {
    g.strokeStyle = x0 ? 'rgba(240,240,240,0.5)' : 'rgba(210,60,190,0.55)';
    g.lineWidth = 6;
    g.beginPath();
    const gx = x0 + r() * (sw - 200), gy = h * 0.2 + r() * h * 0.5;
    g.moveTo(gx, gy);
    g.bezierCurveTo(gx + 60, gy - 40, gx + 90, gy + 50, gx + 160, gy - 10);
    g.stroke();
  }
  return toTexture(c, { srgb: true, repeat: true });
}

/** expanded-steel wire mesh alpha (litter baskets, fences). RGBA: green paint + alpha holes */
export function makeMeshTexture(size = 256, color = '#2d6a3e'): THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas> {
  const { c, g } = canvas(size, size);
  g.clearRect(0, 0, size, size);
  const cell = size / 8;
  g.strokeStyle = color;
  g.lineWidth = size / 40;
  g.lineCap = 'round';
  // diamond lattice
  for (let i = -8; i <= 16; i++) {
    g.beginPath();
    g.moveTo(i * cell, 0);
    g.lineTo(i * cell + size, size);
    g.stroke();
    g.beginPath();
    g.moveTo(i * cell, 0);
    g.lineTo(i * cell - size, size);
    g.stroke();
  }
  // rust speckle
  const r = rng(5);
  g.fillStyle = 'rgba(120,60,20,0.6)';
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.arc(r() * size, r() * size, 1 + r() * 2, 0, Math.PI * 2);
    g.fill();
  }
  const t = toTexture(c, { srgb: true, repeat: true });
  return t;
}

/** aMat.z selectors used ONLY by buildWireBasket; 0/1 retain their shared prop/atlas meaning. */
export const BASKET_SURFACE = { wire: 2, frame: 3, placard: 4 } as const;

/**
 * Basket-only 512² skin: upper half = the entire unwrapped mesh, lower left third = notice,
 * lower right = frame paint. Kept separate from makeMeshTexture so shed netting is unchanged.
 * Alpha belongs only to the expanded metal; source-atop wear cannot fill its diamond openings.
 */
export function makeBasketTexture(): THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas> {
  const { c, g } = canvas(512, 512);
  const r = rng(503);
  g.clearRect(0, 0, 512, 512);
  g.save();
  g.beginPath(); g.rect(0, 0, 512, 256); g.clip();
  // ~34 x 48 mm diamonds with ~7 mm flat steel ligaments on the widened basket.
  // Broad faces and a single sheared edge read as expanded sheet, not round wire.
  // Keep the existing 512² allocation and alpha-tested shell, not thousands of mesh triangles.
  const columns = 64, rows = 20, dx = 512 / columns, dy = 256 / rows;
  g.strokeStyle = '#454a37';
  g.lineWidth = 1.8;
  g.lineJoin = 'bevel';
  g.lineCap = 'butt';
  g.beginPath();
  for (let row = -1; row <= rows; row++) for (let col = -1; col <= columns; col++) {
    const x = col * dx, y = row * dy;
    g.moveTo(x, y + dy / 2);
    g.lineTo(x + dx / 2, y);
    g.lineTo(x + dx, y + dy / 2);
    g.lineTo(x + dx / 2, y + dy);
    g.closePath();
  }
  g.stroke();
  g.globalCompositeOperation = 'source-atop';
  // A narrow dark sheared edge on one diagonal leaves a broad, flat painted face.
  // No rounded wire highlight or over/under crossing; bonds remain one connected sheet.
  g.strokeStyle = '#282d22'; g.lineWidth = 0.46;
  g.beginPath();
  for (let row = -1; row <= rows; row++) for (let col = -1; col <= columns; col++) {
    const x = col * dx, y = row * dy + 0.60;
    g.moveTo(x, y + dy / 2); g.lineTo(x + dx / 2, y);
    g.moveTo(x + dx / 2, y + dy); g.lineTo(x + dx, y + dy / 2);
  }
  g.stroke();
  // Warm, desaturated green-black sectors and uneven chalking, not a blue-green net.
  for (let i = 0; i < 20; i++) {
    const x = r() * 512, y = r() * 256, radius = 20 + r() * 55;
    const fade = g.createRadialGradient(x, y, 0, x, y, radius);
    fade.addColorStop(0, i % 3 ? 'rgba(28,32,23,0.58)' : 'rgba(102,105,79,0.42)');
    fade.addColorStop(1, 'rgba(35,42,29,0)');
    g.fillStyle = fade;
    g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  // Localized rust beside ribs and at the lower splash edge, clipped to actual strands.
  for (const [cx, cy, radius] of [[63, 35, 15], [194, 166, 23], [383, 237, 25], [452, 71, 13]]) {
    for (let i = 0; i < 65; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
      g.fillStyle = i % 3 ? 'rgba(92,55,30,0.80)' : 'rgba(139,91,48,0.55)';
      g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1 + r() * 4, 1 + r() * 5);
    }
  }
  const splash = g.createLinearGradient(0, 185, 0, 256);
  splash.addColorStop(0, 'rgba(13,18,13,0)');
  splash.addColorStop(1, 'rgba(13,18,13,0.58)');
  g.fillStyle = splash; g.fillRect(0, 185, 512, 71);
  g.restore();

  // Flat ribs/rolled edges: black-green paint with irregular edge loss and corrosion islands.
  const fx = 172, fw = 340;
  g.save();
  g.beginPath(); g.rect(fx, 256, fw, 256); g.clip();
  g.fillStyle = '#444838'; g.fillRect(fx, 256, fw, 256);
  for (let i = 0; i < 16; i++) {
    const x = fx + r() * fw, y = 256 + r() * 256, radius = 15 + r() * 75;
    const fade = g.createRadialGradient(x, y, 0, x, y, radius);
    fade.addColorStop(0, i % 3 ? 'rgba(27,32,23,0.54)' : 'rgba(100,104,79,0.42)');
    fade.addColorStop(1, 'rgba(35,42,29,0)');
    g.fillStyle = fade; g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  for (let i = 0; i < 96; i++) {
    const edge = i % 2 ? fx + 2 + r() * 11 : fx + fw - 13 + r() * 11;
    const y = 256 + r() * 256, w = 2 + r() * 10, h = 2 + r() * 13;
    // Broken polygonal flakes instead of evenly spaced rectangular scratches.
    g.fillStyle = i % 5 ? '#60472e' : '#77705c';
    g.beginPath(); g.moveTo(edge, y); g.lineTo(edge + w * 0.6, y + 1);
    g.lineTo(edge + w, y + h * 0.45); g.lineTo(edge + w * 0.45, y + h);
    g.lineTo(edge - 1, y + h * 0.72); g.closePath(); g.fill();
  }
  for (const [u, v] of [[0.03, 0.18], [0.97, 0.70], [0.12, 0.89], [0.84, 0.11]]) {
    const stain = g.createRadialGradient(fx + u * fw, 256 + v * 256, 0, fx + u * fw, 256 + v * 256, 23);
    stain.addColorStop(0, 'rgba(79,53,30,0.68)'); stain.addColorStop(1, 'rgba(51,40,25,0)');
    g.fillStyle = stain; g.fillRect(fx + u * fw - 23, 256 + v * 256 - 23, 46, 46);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = i % 3 ? 'rgba(87,54,30,0.80)' : 'rgba(123,85,45,0.64)';
      g.fillRect(fx + u * fw + (r() - 0.5) * 28, 256 + v * 256 + (r() - 0.5) * 33, 1 + r() * 7, 1 + r() * 9);
    }
  }
  // The roll's exposed crown spans U=2/3..5/6 after strapUv. Broad, broken flakes
  // cross that crown in just three sectors; edge-only speckles vanish on a thin rim.
  // Separate local RNG keeps the notice and other existing wear deterministic and unchanged.
  const rimWear = rng(1503);
  for (const [u, v, w, h] of [[0.72, 0.23, 95, 22], [0.80, 0.57, 104, 18], [0.70, 0.85, 78, 26]]) {
    const cx = fx + u * fw, cy = 256 + v * 256;
    g.save();
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, k = 0.72 + rimWear() * 0.28;
      const x = cx + Math.cos(a) * w * 0.5 * k, y = cy + Math.sin(a) * h * 0.5 * k;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
    g.fillStyle = '#765335'; g.fill();
    g.strokeStyle = '#302e23'; g.lineWidth = 2; g.stroke();
    g.clip();
    for (let i = 0; i < 48; i++) {
      g.fillStyle = i % 3 ? 'rgba(63,47,29,0.58)' : 'rgba(157,117,69,0.65)';
      g.fillRect(cx + (rimWear() - 0.5) * w, cy + (rimWear() - 0.5) * h,
        2 + rimWear() * 8, 1 + rimWear() * 4);
    }
    g.restore();
  }
  g.restore();

  // Unbranded weathered notice: preserve the reference's large light/dark/red graphic hierarchy,
  // without copying its sanitation seal or inventing a specific fine amount.
  g.save();
  g.beginPath(); g.rect(0, 256, 172, 256); g.clip();
  g.fillStyle = '#c9c6b3'; g.fillRect(0, 256, 172, 256);
  for (const [x, y, radius] of [[31, 308, 54], [143, 397, 48], [83, 461, 61]]) {
    const stain = g.createRadialGradient(x, y, 2, x, y, radius);
    stain.addColorStop(0, 'rgba(92,78,50,0.35)'); stain.addColorStop(1, 'rgba(92,78,50,0)');
    g.fillStyle = stain; g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  g.strokeStyle = '#575a4a'; g.lineWidth = 1.5; g.strokeRect(5, 261, 162, 246);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const font = '"Arial Narrow", "Helvetica Neue", Helvetica, Arial, sans-serif';
  g.fillStyle = '#27372c';
  g.font = `bold 19px ${font}`; g.fillText('KEEP NYC', 86, 282, 145);
  g.font = `bold 25px ${font}`; g.fillText('CLEAN', 86, 307, 145);
  g.fillStyle = '#23251f';
  g.font = `bold 16px ${font}`; g.fillText('NO HOUSEHOLD', 86, 348, 151);
  g.font = `bold 21px ${font}`; g.fillText('TRASH', 86, 371, 151);
  g.font = `bold 17px ${font}`; g.fillText('NO BUSINESS', 86, 410, 151);
  g.font = `bold 21px ${font}`; g.fillText('TRASH', 86, 433, 151);
  g.fillStyle = '#853d2c';
  g.font = `bold 23px ${font}`; g.fillText('FINES APPLY', 86, 483, 151);
  g.strokeStyle = '#7c7b6b'; g.lineWidth = 0.7;
  for (const y of [327, 454]) { g.beginPath(); g.moveTo(12, y); g.lineTo(160, y); g.stroke(); }
  // Edge chips and grime overlay the lettering as well as the enamel, with most text still legible.
  for (let i = 0; i < 300; i++) {
    const x = r() * 172, y = 256 + r() * 256;
    const edge = Math.min(x, 172 - x, y - 256, 512 - y);
    g.fillStyle = edge < 11 ? 'rgba(71,54,32,0.65)' : 'rgba(76,74,58,0.15)';
    g.fillRect(x, y, 0.6 + r() * 3, 0.8 + r() * (edge < 11 ? 8 : 3));
  }
  for (const x of [13, 159]) for (const y of [270, 498]) {
    g.fillStyle = '#5b4931'; g.beginPath(); g.arc(x, y, 2.7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#939080'; g.fillRect(x - 1, y - 1, 2, 1);
    g.fillStyle = 'rgba(100,68,37,0.32)'; g.fillRect(x - 1, y + 3, 2, 9);
  }
  // A stained, peeling fold crosses the lower ink without replacing the generic, logo-free header.
  g.strokeStyle = 'rgba(85,70,45,0.24)'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(69, 269); g.lineTo(73, 360); g.lineTo(68, 423); g.lineTo(80, 507); g.stroke();
  for (let i = 0; i < 38; i++) {
    const y = 340 + r() * 167;
    const x = (y < 423 ? 73 - (y - 360) * 5 / 63 : 68 + (y - 423) * 12 / 84) + (r() - 0.5) * 6;
    const w = 1 + r() * 5, h = 2 + r() * 9;
    g.fillStyle = i % 4 ? '#b8b299' : '#73654a';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y - 1);
    g.lineTo(x + w * 0.7, y + h); g.lineTo(x - 1, y + h * 0.65); g.closePath(); g.fill();
  }
  g.strokeStyle = 'rgba(218,212,190,0.7)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(67, 267); g.lineTo(71, 360); g.lineTo(66, 423); g.lineTo(78, 507); g.stroke();
  g.restore();
  return toTexture(c, { srgb: true, repeat: false });
}

export const PED_FRAMES = 32; // 0 = walk, 1 = steady hand, 2 = flashing hand blank, 3..31 = countdown 29..1 with hand

/** pedestrian signal frames laid out horizontally: white walking man, orange hand, hand + countdown digits */
export function makePedTexture(frame = 96): THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas> {
  const { c, g } = canvas(frame * PED_FRAMES, frame);
  g.fillStyle = '#0a0a0a';
  g.fillRect(0, 0, c.width, c.height);
  const orange = '#ff7a1a';
  const white = '#f4f6ff';
  const drawHand = (x0: number, alpha = 1) => {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = orange;
    const cx = x0 + frame * 0.28, cy = frame * 0.5;
    // palm
    g.beginPath();
    g.ellipse(cx, cy + frame * 0.1, frame * 0.13, frame * 0.17, 0, 0, Math.PI * 2);
    g.fill();
    // fingers
    for (let i = 0; i < 4; i++) {
      const fx = cx - frame * 0.11 + i * frame * 0.075;
      const fh = frame * (0.2 + (i === 1 || i === 2 ? 0.05 : 0));
      g.fillRect(fx - frame * 0.028, cy - frame * 0.04 - fh, frame * 0.056, fh + frame * 0.06);
    }
    // thumb
    g.save();
    g.translate(cx + frame * 0.16, cy + frame * 0.02);
    g.rotate(0.6);
    g.fillRect(-frame * 0.03, -frame * 0.12, frame * 0.06, frame * 0.16);
    g.restore();
    // wrist
    g.fillRect(cx - frame * 0.06, cy + frame * 0.24, frame * 0.12, frame * 0.1);
    g.restore();
  };
  const drawMan = (x0: number) => {
    g.fillStyle = white;
    const cx = x0 + frame * 0.5, top = frame * 0.14;
    g.beginPath();
    g.arc(cx + frame * 0.03, top + frame * 0.07, frame * 0.07, 0, Math.PI * 2);
    g.fill();
    g.lineCap = 'round';
    g.lineWidth = frame * 0.09;
    g.strokeStyle = white;
    // torso
    g.beginPath();
    g.moveTo(cx + frame * 0.02, top + frame * 0.16);
    g.lineTo(cx - frame * 0.03, top + frame * 0.45);
    g.stroke();
    // legs
    g.beginPath();
    g.moveTo(cx - frame * 0.03, top + frame * 0.45);
    g.lineTo(cx + frame * 0.14, top + frame * 0.66);
    g.lineTo(cx + frame * 0.12, top + frame * 0.8);
    g.stroke();
    g.beginPath();
    g.moveTo(cx - frame * 0.03, top + frame * 0.45);
    g.lineTo(cx - frame * 0.16, top + frame * 0.62);
    g.lineTo(cx - frame * 0.2, top + frame * 0.8);
    g.stroke();
    // arms
    g.lineWidth = frame * 0.07;
    g.beginPath();
    g.moveTo(cx + frame * 0.0, top + frame * 0.2);
    g.lineTo(cx + frame * 0.16, top + frame * 0.32);
    g.stroke();
    g.beginPath();
    g.moveTo(cx + frame * 0.0, top + frame * 0.2);
    g.lineTo(cx - frame * 0.16, top + frame * 0.36);
    g.stroke();
  };
  const drawDigits = (x0: number, n: number) => {
    g.fillStyle = orange;
    g.font = `bold ${Math.round(frame * 0.6)}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), x0 + frame * 0.72, frame * 0.52);
  };
  drawMan(0);
  drawHand(frame, 1);
  // frame 2: blank (flashing off)
  for (let i = 3; i < PED_FRAMES; i++) {
    const n = PED_FRAMES - i; // 29..1
    drawHand(i * frame, 1);
    drawDigits(i * frame, n);
  }
  const t = toTexture(c, { srgb: true, repeat: false });
  return t;
}

/** radial soft light pool (alpha), and an elongated one for sheds */
export function makePoolTexture(size = 256): THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas> {
  const { c, g } = canvas(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return toTexture(c, { srgb: false, repeat: false });
}

/** soft round particle for steam */
export function makeSteamTexture(size = 128): THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas> {
  const { c, g } = canvas(size, size);
  const r = rng(11);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // break the symmetry a bit
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 14; i++) {
    const x = r() * size, y = r() * size, rad = 8 + r() * 22;
    const gg = g.createRadialGradient(x, y, 0, x, y, rad);
    gg.addColorStop(0, 'rgba(0,0,0,0.35)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gg;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return toTexture(c, { srgb: false, repeat: false });
}

/** subway stairwell wall tiles: cream/white ceramic with a dark band */
export function makeSubwayTileTexture(size = 256): THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas> {
  const { c, g } = canvas(size, size);
  const r = rng(3);
  g.fillStyle = '#9a968c';
  g.fillRect(0, 0, size, size);
  const tw = size / 8, th = size / 16;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8; x++) {
      const off = y % 2 ? tw / 2 : 0;
      const v = 205 + r() * 35;
      g.fillStyle = `rgb(${v},${v - 4 + r() * 6},${v - 18})`;
      g.fillRect(x * tw + off + 1, y * th + 1, tw - 2, th - 2);
    }
  }
  // dark green band of tiles across the top rows
  for (let y = 2; y < 4; y++)
    for (let x = 0; x < 8; x++) {
      const off = y % 2 ? tw / 2 : 0;
      g.fillStyle = `rgb(${30 + r() * 20},${70 + r() * 25},${50 + r() * 20})`;
      g.fillRect(x * tw + off + 1, y * th + 1, tw - 2, th - 2);
    }
  // grime streaks
  g.fillStyle = 'rgba(40,35,30,0.25)';
  for (let i = 0; i < 24; i++) g.fillRect(r() * size, 0, 1 + r() * 3, size);
  return toTexture(c, { srgb: true, repeat: true });
}

/** shrub foliage: a leafy blob with alpha, for cross-quad planters */
export function makeShrubTexture(size = 256): THREE.CanvasTexture<HTMLCanvasElement | OffscreenCanvas> {
  const { c, g } = canvas(size, size);
  const r = rng(19);
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const ang = r() * Math.PI * 2;
    const rad = Math.pow(r(), 0.6) * size * 0.46;
    const x = size / 2 + Math.cos(ang) * rad, y = size / 2 + Math.sin(ang) * rad * 0.95;
    const sh = 40 + r() * 70;
    g.fillStyle = `rgba(${sh * 0.5},${sh + 30},${sh * 0.45},${0.85})`;
    g.beginPath();
    g.ellipse(x, y, 3 + r() * 6, 2 + r() * 4, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  const t = toTexture(c, { srgb: true, repeat: false });
  return t;
}
