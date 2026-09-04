/**
 * Sign atlas: one canvas with SIGN_ROWS rows, white on transparent, sampled through the red channel.
 *   rows [0, SIGN_NAME_ROWS)  generic (no real brand) shop names in a condensed bold face — fascia boards,
 *                             awning valances and lightboxes.
 *   rows [SIGN_NAME_ROWS, …)  neon accent artwork: stroked tube lettering and a bent-tube squiggle, hung
 *                             inside the glass on ~20 % of shops at night (docs/ART_DIRECTION.md §2 Night).
 * The facade shader composes background colour + text colour + night emissive from it.
 */
import * as THREE from 'three';
import { SIGN_NAMES, SIGN_ROWS, SIGN_NAME_ROWS, SIGN_NEON_ROWS } from './builder';

/** Neon words are short: a tube sign is bent by hand, so it is never a paragraph. */
const NEON_WORDS = ['OPEN', 'COLD BEER', 'BAR', 'OPEN 24 HRS', 'ATM'];

/** One row of bent tube: a sine run with a loop at each end, the shape a neon bender actually makes. */
function drawSquiggle(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.beginPath();
  const y0 = h * 0.5, amp = h * 0.26, x0 = w * 0.3, x1 = w * 0.7;
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + Math.sin(t * Math.PI * 3) * amp;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  // the return bend and the two electrode stubs
  g.beginPath();
  g.arc(x0, y0, h * 0.14, Math.PI * 0.5, Math.PI * 1.5);
  g.stroke();
  g.beginPath();
  g.arc(x1, y0, h * 0.14, -Math.PI * 0.5, Math.PI * 0.5);
  g.stroke();
}

export function createSignAtlas(): THREE.Texture {
  const W = 1024, ROW = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = ROW * SIGN_ROWS;
  const g = canvas.getContext('2d');
  if (g) {
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < SIGN_NAME_ROWS; i++) {
      const name = SIGN_NAMES[i];
      // condensed bold sans: fits ~14 chars in half the row
      const fonts = ['bold 46px "Arial Narrow", "Helvetica Neue", Arial, sans-serif', 'bold 44px Impact, "Arial Black", sans-serif', '700 44px Futura, "Trebuchet MS", sans-serif'];
      g.font = fonts[i % fonts.length];
      g.save();
      g.translate(W / 2, i * ROW + ROW / 2);
      const w = g.measureText(name).width;
      const maxW = W * 0.46;
      if (w > maxW) g.scale(maxW / w, 1);
      g.fillText(name, 0, 0);
      g.restore();
    }
    // Neon rows: outlined glyphs, so the emissive lands on a tube of constant width instead of a solid slab.
    g.strokeStyle = '#fff';
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (let i = 0; i < SIGN_NEON_ROWS; i++) {
      const row = SIGN_NAME_ROWS + i;
      g.save();
      g.translate(W / 2, row * ROW + ROW / 2);
      if (i < NEON_WORDS.length) {
        const word = NEON_WORDS[i];
        g.font = '600 40px "Brush Script MT", "Segoe Script", "Helvetica Neue", Arial, sans-serif';
        g.lineWidth = 5;
        const w = g.measureText(word).width;
        const maxW = W * 0.4;
        if (w > maxW) g.scale(maxW / w, 1);
        g.strokeText(word, 0, 0);
      } else {
        g.translate(-W / 2, -ROW / 2);
        g.lineWidth = 6;
        drawSquiggle(g, W, ROW);
      }
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
