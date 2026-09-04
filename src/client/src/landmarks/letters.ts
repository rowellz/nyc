/**
 * Carved / applied inscriptions ("GRAND CENTRAL TERMINAL", "EMPIRE STATE") as flat stroke-letter quads a few
 * centimetres proud of a wall. A minimal capital stroke font in a 1-unit-tall cell; two triangles per stroke,
 * so a 22-letter inscription is under 200 triangles.
 */
import * as THREE from 'three';
import type { GeoBuilder, StyleSpec } from './geom';

type Stroke = [number, number, number, number];
const P_STROKES: Stroke[] = [[0.08, 0, 0.08, 1], [0.08, 1, 0.6, 1], [0.6, 1, 0.76, 0.86], [0.76, 0.86, 0.76, 0.62], [0.76, 0.62, 0.6, 0.48], [0.6, 0.48, 0.08, 0.48]];
const FONT: Record<string, { w: number; s: Stroke[] }> = {
  A: { w: 0.9, s: [[0.06, 0, 0.45, 1], [0.45, 1, 0.84, 0], [0.22, 0.36, 0.68, 0.36]] },
  B: { w: 0.8, s: [...P_STROKES, [0.6, 0.48, 0.76, 0.36], [0.76, 0.36, 0.76, 0.14], [0.76, 0.14, 0.6, 0], [0.6, 0, 0.08, 0]] },
  C: { w: 0.85, s: [[0.08, 0.1, 0.08, 0.9], [0.08, 0.9, 0.22, 1], [0.22, 1, 0.8, 1], [0.08, 0.1, 0.22, 0], [0.22, 0, 0.8, 0]] },
  D: { w: 0.85, s: [[0.08, 0, 0.08, 1], [0.08, 1, 0.58, 1], [0.58, 1, 0.8, 0.8], [0.8, 0.8, 0.8, 0.2], [0.8, 0.2, 0.58, 0], [0.58, 0, 0.08, 0]] },
  E: { w: 0.78, s: [[0.08, 0, 0.08, 1], [0.08, 1, 0.74, 1], [0.08, 0.5, 0.64, 0.5], [0.08, 0, 0.74, 0]] },
  G: { w: 0.9, s: [[0.08, 0.1, 0.08, 0.9], [0.08, 0.9, 0.22, 1], [0.22, 1, 0.82, 1], [0.08, 0.1, 0.22, 0], [0.22, 0, 0.82, 0], [0.82, 0, 0.82, 0.46], [0.5, 0.46, 0.82, 0.46]] },
  H: { w: 0.9, s: [[0.08, 0, 0.08, 1], [0.82, 0, 0.82, 1], [0.08, 0.5, 0.82, 0.5]] },
  I: { w: 0.3, s: [[0.15, 0, 0.15, 1]] },
  K: { w: 0.85, s: [[0.08, 0, 0.08, 1], [0.08, 0.45, 0.78, 1], [0.3, 0.6, 0.8, 0]] },
  L: { w: 0.75, s: [[0.08, 0, 0.08, 1], [0.08, 0, 0.7, 0]] },
  M: { w: 1.0, s: [[0.08, 0, 0.08, 1], [0.08, 1, 0.5, 0.32], [0.5, 0.32, 0.92, 1], [0.92, 1, 0.92, 0]] },
  N: { w: 0.9, s: [[0.08, 0, 0.08, 1], [0.08, 1, 0.82, 0], [0.82, 0, 0.82, 1]] },
  O: { w: 0.9, s: [[0.08, 0.12, 0.08, 0.88], [0.82, 0.12, 0.82, 0.88], [0.08, 0.88, 0.2, 1], [0.2, 1, 0.7, 1], [0.7, 1, 0.82, 0.88], [0.08, 0.12, 0.2, 0], [0.2, 0, 0.7, 0], [0.7, 0, 0.82, 0.12]] },
  P: { w: 0.8, s: P_STROKES },
  R: { w: 0.85, s: [...P_STROKES, [0.44, 0.48, 0.8, 0]] },
  S: { w: 0.8, s: [[0.1, 0.9, 0.74, 0.9], [0.1, 0.9, 0.1, 0.52], [0.1, 0.52, 0.72, 0.52], [0.72, 0.52, 0.72, 0.1], [0.08, 0.1, 0.72, 0.1]] },
  T: { w: 0.8, s: [[0.02, 1, 0.78, 1], [0.4, 0, 0.4, 1]] },
  U: { w: 0.9, s: [[0.08, 1, 0.08, 0.14], [0.82, 1, 0.82, 0.14], [0.08, 0.14, 0.2, 0], [0.2, 0, 0.7, 0], [0.7, 0, 0.82, 0.14]] },
  V: { w: 0.9, s: [[0.06, 1, 0.45, 0], [0.45, 0, 0.84, 1]] },
  Y: { w: 0.85, s: [[0.06, 1, 0.42, 0.5], [0.42, 0.5, 0.78, 1], [0.42, 0, 0.42, 0.5]] },
  ' ': { w: 0.45, s: [] },
};
const STROKE_W = 0.15;
const TRACKING = 0.22;

/** width of an inscription in units of its letter height */
export function inscriptionWidth(text: string): number {
  let w = 0;
  for (const ch of text.toUpperCase()) w += (FONT[ch]?.w ?? 0.6) + TRACKING;
  return w - TRACKING;
}

/**
 * Write `text` on a vertical wall. `origin` is the baseline point on the wall face, `along` the horizontal
 * reading direction (unit), `normal` the wall's outward normal (unit); the letters are `height` metres tall,
 * `proud` metres in front of the face, and centred on `origin` unless `align` is 'left'.
 */
export function inscribe(g: GeoBuilder, origin: THREE.Vector3, along: THREE.Vector3, normal: THREE.Vector3, text: string, height: number, s: StyleSpec, opts: { proud?: number; align?: 'left' | 'center' } = {}): void {
  const proud = opts.proud ?? 0.03;
  const total = inscriptionWidth(text) * height;
  let x = opts.align === 'left' ? 0 : -total / 2;
  const base = origin.clone().addScaledVector(normal, proud);
  const up = new THREE.Vector3(0, 1, 0);
  const at = (u: number, y: number) => base.clone().addScaledVector(along, u).addScaledVector(up, y);
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch];
    if (!glyph) { x += 0.6 * height + TRACKING * height; continue; }
    for (const [u0, y0, u1, y1] of glyph.s) {
      const du = u1 - u0, dy = y1 - y0;
      const len = Math.hypot(du, dy) || 1;
      const tu = du / len, ty = dy / len; // stroke direction
      const nu = -ty, ny = tu; // in-plane normal
      const hw = STROKE_W / 2, ext = STROKE_W / 2; // square ends overlap at the corners
      const a = at(x + (u0 - tu * ext + nu * hw) * height, (y0 - ty * ext + ny * hw) * height);
      const b = at(x + (u0 - tu * ext - nu * hw) * height, (y0 - ty * ext - ny * hw) * height);
      const c = at(x + (u1 + tu * ext - nu * hw) * height, (y1 + ty * ext - ny * hw) * height);
      const d = at(x + (u1 + tu * ext + nu * hw) * height, (y1 + ty * ext + ny * hw) * height);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
      if (n.dot(normal) < 0) g.quad3(a, d, c, b, s);
      else g.quad3(a, b, c, d, s);
    }
    x += (glyph.w + TRACKING) * height;
  }
}
