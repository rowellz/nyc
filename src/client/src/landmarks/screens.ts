/**
 * Times Square LED screens: a procedural content atlas (15 "campaigns" in the visual language of real ads --
 * product and talent stand-ins built from gradients and shapes, big display type, taglines, billing blocks --
 * plus the one news ribbon, no real brands), a geometry
 * builder for screen quads (with the per-screen animation / size attributes the screen shader reads and the list
 * of big screens that spill light onto the street), and the facade composition rules that put stacked screens on
 * every bowtie-facing facade.
 */
import * as THREE from 'three';
import type { Building, Ring } from '@shared/world';
import { signedArea } from './geom';
import { FIFTEEN_HUNDRED_BROADWAY_BIN, TIMES_SQUARE_AXIS, TWO_TIMES_SQUARE_BIN } from './data';

export const ATLAS_CELLS = 4; // 4x4 cells
export const ATLAS_SIZE = 2048;
/** atlas cell of the news strip every scrolling ribbon shows (designed to tile horizontally) */
export const TICKER_CELL = 14;
/** atlas cell the Nasdaq cylinder's slideshow starts on */
export const MARKET_CELL = 15;
/** LED pixel pitch (m) of the dot grid the screen shader resolves up close */
export const LED_PITCH = 0.04;
/** mean atlas colour converted from sRGB to linear (filled by createScreenAtlas; drives the light spill) */
export const CELL_AVERAGES: THREE.Color[] = Array.from({ length: ATLAS_CELLS * ATLAS_CELLS }, () => new THREE.Color(0.45, 0.4, 0.45));
/** a screen at least this big (m^2) lights the street in front of it */
export const SPILL_MIN_AREA = 40;

type C2D = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const FONT = {
  black: '"Arial Black", "Helvetica Neue", Arial, sans-serif',
  impact: 'Impact, "Arial Narrow", "Helvetica Neue", sans-serif',
  cond: '"Avenir Next Condensed", "Arial Narrow", Impact, sans-serif',
  didot: 'Didot, "Bodoni 72", Georgia, "Times New Roman", serif',
  futura: 'Futura, "Century Gothic", "Avenir Next", "Helvetica Neue", sans-serif',
  helv: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  copper: 'Copperplate, "Trajan Pro", Georgia, serif',
};

/** deterministic pseudo-random from a seed */
export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s % 100000) / 100000;
  };
}

// ---- 2D drawing helpers (S = cell size in px; every coordinate is a fraction of S) -------------------------------
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function setSpacing(c: C2D, px: number): void {
  (c as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
}
function radial(c: C2D, x: number, y: number, r: number, stops: [number, string][], x0 = x, y0 = y, r0 = 0): CanvasGradient {
  const g = c.createRadialGradient(x0, y0, r0, x, y, r);
  for (const [t, col] of stops) g.addColorStop(t, col);
  return g;
}
function linear(c: C2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [t, col] of stops) g.addColorStop(t, col);
  return g;
}
function roundRect(c: C2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
interface TextOpts { weight?: string | number; align?: CanvasTextAlign; maxW?: number; spacing?: number; italic?: boolean; glow?: string; glowSize?: number; alpha?: number }
function text(c: C2D, S: number, s: string, x: number, y: number, size: number, family: string, color: string, o: TextOpts = {}): void {
  const font = (px: number) => `${o.italic ? 'italic ' : ''}${o.weight ?? 700} ${px}px ${family}`;
  let px = size * S;
  c.font = font(px);
  setSpacing(c, (o.spacing ?? 0) * S);
  const maxW = (o.maxW ?? 0.94) * S;
  const w = c.measureText(s).width;
  if (w > maxW) {
    px *= maxW / w;
    c.font = font(px);
  }
  c.textAlign = o.align ?? 'center';
  c.textBaseline = 'middle';
  c.fillStyle = color;
  c.globalAlpha = o.alpha ?? 1;
  if (o.glow) {
    c.shadowColor = o.glow;
    c.shadowBlur = (o.glowSize ?? 0.06) * S;
  }
  // Letter spacing stays fixed when the font shrinks, so the first fit can still exceed maxW.
  c.fillText(s, x * S, y * S, maxW);
  c.shadowBlur = 0;
  c.shadowColor = 'transparent';
  c.globalAlpha = 1;
  setSpacing(c, 0);
}
/** the tiny credits block at the foot of a movie / series poster */
function billing(c: C2D, S: number, y: number, color: string, alpha: number): void {
  const rows = [
    'FEATURING THE ORIGINAL CAST   MUSIC BY THE CITY ORCHESTRA   COSTUMES A. LIND   EDITED BY R. SATO',
    'PRODUCTION DESIGN J. OKAFOR   DIRECTOR OF PHOTOGRAPHY M. DUARTE   EXECUTIVE PRODUCERS P. HALE  T. NAKAMURA',
    'PRODUCED BY S. VANCE   WRITTEN AND DIRECTED BY L. MBEKI',
  ];
  rows.forEach((r, i) => text(c, S, r, 0.5, y + i * 0.026, 0.017, FONT.cond, color, { weight: 500, spacing: 0.0012, alpha, maxW: 0.9 }));
}
function glow(c: C2D, S: number, x: number, y: number, r: number, hex: string, alpha: number): void {
  c.fillStyle = radial(c, x * S, y * S, r * S, [[0, rgba(hex, alpha)], [0.55, rgba(hex, alpha * 0.35)], [1, rgba(hex, 0)]]);
  c.fillRect(0, 0, S, S);
}
function vignette(c: C2D, S: number, k: number): void {
  c.fillStyle = radial(c, S / 2, S / 2, S * 0.78, [[0.4, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${k})`]]);
  c.fillRect(0, 0, S, S);
}
function bokeh(c: C2D, S: number, n: number, hex: string, seed: number, rMin: number, rMax: number, alpha: number, yMax = 1): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S * yMax, rad = S * (rMin + r() * (rMax - rMin));
    c.fillStyle = radial(c, x, y, rad, [[0, rgba(hex, alpha)], [0.65, rgba(hex, alpha * 0.55)], [1, rgba(hex, 0)]]);
    c.beginPath();
    c.arc(x, y, rad, 0, TAU);
    c.fill();
  }
}
/** a shaded sphere with an off-centre highlight (planet, ball, bauble) */
function orb(c: C2D, S: number, x: number, y: number, r: number, hex: string, hi: string, shadow: string): void {
  x *= S; y *= S; r *= S;
  c.fillStyle = radial(c, x, y, r, [[0, hi], [0.3, hex], [1, shadow]], x - r * 0.35, y - r * 0.4, r * 0.05);
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
  c.fillStyle = radial(c, x - r * 0.4, y - r * 0.45, r * 0.3, [[0, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]);
  c.beginPath();
  c.arc(x - r * 0.4, y - r * 0.45, r * 0.3, 0, TAU);
  c.fill();
}
/** cylinder shading across a rounded rect (cans, bottles, tubes) */
function cylinderFill(c: C2D, x: number, w: number, hex: string, dark: string, light: string): CanvasGradient {
  return linear(c, x - w / 2, 0, x + w / 2, 0, [[0, dark], [0.2, hex], [0.36, light], [0.52, hex], [0.82, dark], [1, dark]]);
}
function droplets(c: C2D, S: number, x: number, y: number, w: number, h: number, n: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const dx = (x - w / 2 + r() * w) * S, dy = (y - h / 2 + r() * h) * S, rad = S * (0.004 + r() * 0.008);
    c.fillStyle = radial(c, dx, dy, rad, [[0, 'rgba(255,255,255,0.85)'], [0.6, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']], dx - rad * 0.3, dy - rad * 0.3, 0);
    c.beginPath();
    c.arc(dx, dy, rad, 0, TAU);
    c.fill();
  }
}
function can(c: C2D, S: number, x: number, y: number, w: number, h: number, hex: string, dark: string, light: string, label: string, labelBg: string, labelFg: string): void {
  c.fillStyle = cylinderFill(c, x * S, w * S, hex, dark, light);
  roundRect(c, (x - w / 2) * S, (y - h / 2) * S, w * S, h * S, w * S * 0.12);
  c.fill();
  // label band
  c.fillStyle = labelBg;
  c.globalAlpha = 0.92;
  c.fillRect((x - w / 2) * S, (y - h * 0.12) * S, w * S, h * 0.42 * S);
  c.globalAlpha = 1;
  c.fillStyle = linear(c, (x - w / 2) * S, 0, (x + w / 2) * S, 0, [[0, 'rgba(0,0,0,0.45)'], [0.3, 'rgba(255,255,255,0.12)'], [0.5, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.5)']]);
  c.fillRect((x - w / 2) * S, (y - h * 0.12) * S, w * S, h * 0.42 * S);
  text(c, S, label, x, y + h * 0.09, w * 0.42, FONT.black, labelFg, { maxW: w * 0.9 });
  // rim
  c.fillStyle = linear(c, (x - w / 2) * S, 0, (x + w / 2) * S, 0, [[0, '#6a6a70'], [0.4, '#f2f2f5'], [1, '#55555c']]);
  c.beginPath();
  c.ellipse(x * S, (y - h / 2) * S, (w / 2) * S, w * 0.11 * S, 0, 0, TAU);
  c.fill();
  droplets(c, S, x, y - h * 0.32, w * 0.9, h * 0.3, 26, 5);
}
function bottle(c: C2D, S: number, x: number, y: number, w: number, h: number, hex: string, dark: string, light: string, capHex: string, label?: string, labelBg?: string, labelFg?: string): void {
  c.fillStyle = cylinderFill(c, x * S, w * S, hex, dark, light);
  roundRect(c, (x - w / 2) * S, (y - h * 0.15) * S, w * S, h * 0.65 * S, w * S * 0.22);
  c.fill();
  c.fillStyle = cylinderFill(c, x * S, w * 0.42 * S, hex, dark, light);
  roundRect(c, (x - w * 0.21) * S, (y - h * 0.5) * S, w * 0.42 * S, h * 0.42 * S, w * S * 0.08);
  c.fill();
  // shoulder
  c.fillStyle = cylinderFill(c, x * S, w * S, hex, dark, light);
  c.beginPath();
  c.ellipse(x * S, (y - h * 0.13) * S, (w / 2) * S, h * 0.06 * S, 0, 0, TAU);
  c.fill();
  c.fillStyle = capHex;
  roundRect(c, (x - w * 0.24) * S, (y - h * 0.5) * S, w * 0.48 * S, h * 0.08 * S, w * S * 0.04);
  c.fill();
  if (label && labelBg && labelFg) {
    c.fillStyle = labelBg;
    c.fillRect((x - w / 2) * S, (y + h * 0.1) * S, w * S, h * 0.24 * S);
    text(c, S, label, x, y + h * 0.22, w * 0.3, FONT.copper, labelFg, { maxW: w * 0.9 });
  }
  droplets(c, S, x, y + h * 0.1, w * 0.9, h * 0.5, 22, 11);
}
function phone(c: C2D, S: number, x: number, y: number, w: number, h: number, screen: CanvasGradient): void {
  c.fillStyle = '#0a0a0e';
  roundRect(c, (x - w / 2) * S, (y - h / 2) * S, w * S, h * S, w * S * 0.14);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = S * 0.004;
  c.stroke();
  const m = w * 0.045;
  c.fillStyle = screen;
  roundRect(c, (x - w / 2 + m) * S, (y - h / 2 + m) * S, (w - 2 * m) * S, (h - 2 * m) * S, w * S * 0.11);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.14)';
  c.beginPath();
  c.moveTo((x - w / 2 + m) * S, (y - h / 2 + m) * S);
  c.lineTo((x + w / 2 - m) * S, (y - h / 2 + m) * S);
  c.lineTo((x - w / 2 + m) * S, (y + h * 0.25) * S);
  c.closePath();
  c.fill();
}
function streaks(c: C2D, S: number, hex: string, angle: number, n: number, seed: number, alpha: number): void {
  const r = rng(seed);
  c.save();
  c.translate(S / 2, S / 2);
  c.rotate(angle);
  for (let i = 0; i < n; i++) {
    const y = (r() - 0.5) * S * 1.4, len = S * (0.6 + r() * 1.2), th = S * (0.004 + r() * 0.02), x0 = (r() - 0.5) * S;
    c.fillStyle = linear(c, x0 - len / 2, 0, x0 + len / 2, 0, [[0, rgba(hex, 0)], [0.5, rgba(hex, alpha * (0.4 + r() * 0.6))], [1, rgba(hex, 0)]]);
    c.fillRect(x0 - len / 2, y, len, th);
  }
  c.restore();
}
function pill(c: C2D, S: number, s: string, x: number, y: number, bg: string, fg: string, size = 0.036): void {
  c.font = `700 ${size * S}px ${FONT.helv}`;
  setSpacing(c, 0.003 * S);
  const w = c.measureText(s).width + size * S * 1.8, h = size * S * 2.1;
  c.fillStyle = bg;
  roundRect(c, x * S - w / 2, y * S - h / 2, w, h, h / 2);
  c.fill();
  text(c, S, s, x, y + size * 0.05, size, FONT.helv, fg, { spacing: 0.003 });
}
/** a brand-neutral mark: open ring with a solid square inside */
function mark(c: C2D, S: number, x: number, y: number, r: number, hex: string): void {
  c.strokeStyle = hex;
  c.lineWidth = r * S * 0.42;
  c.beginPath();
  c.arc(x * S, y * S, r * S * 0.75, 0.55, 5.75);
  c.stroke();
  c.fillStyle = hex;
  c.fillRect((x - r * 0.24) * S, (y - r * 0.24) * S, r * 0.48 * S, r * 0.48 * S);
}
function stripes(c: C2D, S: number, hex: string, alpha: number, period: number, width: number, angle: number): void {
  c.save();
  c.translate(S / 2, S / 2);
  c.rotate(angle);
  c.fillStyle = rgba(hex, alpha);
  for (let x = -S; x < S; x += period * S) c.fillRect(x, -S, width * S, 2 * S);
  c.restore();
}
function star(c: C2D, x: number, y: number, R: number, r: number): void {
  c.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU - Math.PI / 2, rr = k % 2 === 0 ? R : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}
function metalRing(c: C2D, S: number, x: number, y: number, r: number, w: number): void {
  x *= S; y *= S; r *= S; w *= S;
  const n = 36;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * TAU, a1 = ((k + 1.02) / n) * TAU;
    const l = 0.3 + 0.6 * Math.abs(Math.sin(a0 * 2 + 0.7)) ** 2;
    c.fillStyle = `rgb(${Math.round(200 * l + 30)},${Math.round(195 * l + 30)},${Math.round(185 * l + 28)})`;
    c.beginPath();
    c.arc(x, y, r, a0, a1);
    c.arc(x, y, r - w, a1, a0, true);
    c.closePath();
    c.fill();
  }
}

/** a head-and-shoulders silhouette (h = shoulder width) with a rim light on the key side: the poster "talent" */
function bust(c: C2D, S: number, x: number, y: number, h: number, fill: string | CanvasGradient, rim: string): void {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo((x - h * 0.5) * S, (y + h * 0.55) * S);
  c.quadraticCurveTo((x - h * 0.48) * S, (y + h * 0.06) * S, (x - h * 0.13) * S, (y - h * 0.02) * S);
  c.lineTo((x + h * 0.13) * S, (y - h * 0.02) * S);
  c.quadraticCurveTo((x + h * 0.48) * S, (y + h * 0.06) * S, (x + h * 0.5) * S, (y + h * 0.55) * S);
  c.closePath();
  c.fill();
  c.fillRect((x - h * 0.075) * S, (y - h * 0.14) * S, h * 0.15 * S, h * 0.16 * S);
  c.beginPath();
  c.ellipse(x * S, (y - h * 0.26) * S, h * 0.125 * S, h * 0.155 * S, 0, 0, TAU);
  c.fill();
  c.strokeStyle = rim;
  c.lineCap = 'round';
  c.lineWidth = h * 0.014 * S;
  c.beginPath();
  c.ellipse(x * S, (y - h * 0.26) * S, h * 0.125 * S, h * 0.155 * S, 0, -1.3, 0.85);
  c.stroke();
  c.beginPath();
  c.moveTo((x + h * 0.14) * S, (y - h * 0.01) * S);
  c.quadraticCurveTo((x + h * 0.46) * S, (y + h * 0.08) * S, (x + h * 0.49) * S, (y + h * 0.5) * S);
  c.stroke();
}
/** a running shoe in profile (w = length), sole, upper, an accent stripe */
function sneaker(c: C2D, S: number, x: number, y: number, w: number, hex: string, sole: string, accent: string): void {
  c.fillStyle = sole;
  roundRect(c, (x - w / 2) * S, (y + w * 0.07) * S, w * S, w * 0.12 * S, w * 0.05 * S);
  c.fill();
  c.fillStyle = hex;
  c.beginPath();
  c.moveTo((x - w * 0.48) * S, (y + w * 0.09) * S);
  c.lineTo((x - w * 0.45) * S, (y - w * 0.24) * S);
  c.quadraticCurveTo((x - w * 0.3) * S, (y - w * 0.34) * S, (x - w * 0.12) * S, (y - w * 0.2) * S);
  c.quadraticCurveTo((x + w * 0.15) * S, (y - w * 0.05) * S, (x + w * 0.48) * S, (y + w * 0.0) * S);
  c.lineTo((x + w * 0.5) * S, (y + w * 0.09) * S);
  c.closePath();
  c.fill();
  c.strokeStyle = accent;
  c.lineCap = 'round';
  c.lineWidth = w * 0.032 * S;
  c.beginPath();
  c.moveTo((x - w * 0.3) * S, (y + w * 0.03) * S);
  c.quadraticCurveTo((x - w * 0.02) * S, (y + w * 0.07) * S, (x + w * 0.36) * S, (y - w * 0.08) * S);
  c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.35)';
  c.lineWidth = w * 0.012 * S;
  for (let k = 0; k < 4; k++) {
    c.beginPath();
    c.moveTo((x - w * 0.36 + k * w * 0.07) * S, (y - w * 0.2 + k * w * 0.02) * S);
    c.lineTo((x - w * 0.3 + k * w * 0.07) * S, (y - w * 0.11 + k * w * 0.02) * S);
    c.stroke();
  }
}
/** a car seen head-on at night: dark body, cabin, wheels, blazing headlights and their reflection on the road */
function car(c: C2D, S: number, x: number, y: number, w: number): void {
  const h = w * 0.42;
  c.fillStyle = linear(c, (x - w / 2) * S, 0, (x + w / 2) * S, 0, [[0, '#1c2230'], [0.3, '#3a4456'], [0.55, '#242b38'], [1, '#0e1118']]);
  roundRect(c, (x - w / 2) * S, (y - h * 0.35) * S, w * S, h * 0.75 * S, w * 0.06 * S);
  c.fill();
  c.fillStyle = '#0b0e15';
  c.beginPath();
  c.moveTo((x - w * 0.36) * S, (y - h * 0.35) * S);
  c.lineTo((x - w * 0.28) * S, (y - h * 0.8) * S);
  c.lineTo((x + w * 0.28) * S, (y - h * 0.8) * S);
  c.lineTo((x + w * 0.36) * S, (y - h * 0.35) * S);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(120,160,220,0.25)';
  c.beginPath();
  c.moveTo((x - w * 0.3) * S, (y - h * 0.38) * S);
  c.lineTo((x - w * 0.24) * S, (y - h * 0.74) * S);
  c.lineTo((x + w * 0.05) * S, (y - h * 0.74) * S);
  c.closePath();
  c.fill();
  for (const s of [-1, 1]) {
    c.fillStyle = '#050608';
    c.beginPath();
    c.ellipse((x + s * w * 0.38) * S, (y + h * 0.42) * S, w * 0.075 * S, w * 0.11 * S, 0, 0, TAU);
    c.fill();
  }
  for (const s of [-1, 1]) {
    const hx = (x + s * w * 0.36) * S, hy = (y + h * 0.02) * S;
    c.fillStyle = radial(c, hx, hy, w * 0.16 * S, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(210,230,255,0.9)'], [1, 'rgba(150,200,255,0)']]);
    c.beginPath();
    c.arc(hx, hy, w * 0.16 * S, 0, TAU);
    c.fill();
  }
  c.fillStyle = '#e8f4ff';
  c.fillRect((x - w * 0.3) * S, y * S, w * 0.6 * S, w * 0.012 * S);
  c.fillStyle = linear(c, 0, (y + h * 0.4) * S, 0, (y + h * 0.95) * S, [[0, 'rgba(150,200,255,0.35)'], [1, 'rgba(150,200,255,0)']]);
  c.fillRect((x - w / 2) * S, (y + h * 0.4) * S, w * S, h * 0.55 * S);
}

// ---- the 16 campaigns ---------------------------------------------------------------------------------------------
type Draw = (c: C2D, S: number) => void;
const ADS: Draw[] = [
  // 0 feature film: night-blue key light, the lead in silhouette with a warm rim light, a burning planet,
  // condensed title, billing block
  (c, S) => {
    c.fillStyle = '#05070d';
    c.fillRect(0, 0, S, S);
    glow(c, S, 0.5, 1.05, 0.95, '#0f5f8a', 0.9);
    glow(c, S, 0.72, 0.22, 0.5, '#ff9a3c', 0.55);
    streaks(c, S, '#ffd9a0', -0.35, 7, 4, 0.18);
    orb(c, S, 0.72, 0.24, 0.16, '#ff7a1a', '#ffe0a0', '#4a1200');
    bust(c, S, 0.4, 0.44, 0.66, linear(c, 0.2 * S, 0.15 * S, 0.55 * S, 0.8 * S, [[0, '#26384a'], [1, '#05070d']]), '#ffb060');
    vignette(c, S, 0.6);
    text(c, S, 'AFTERLIGHT', 0.5, 0.68, 0.19, FONT.cond, '#ffffff', { weight: 800, spacing: 0.008, maxW: 0.9 });
    text(c, S, 'ONLY IN THEATERS  •  FRIDAY', 0.5, 0.79, 0.042, FONT.helv, '#ffd9a0', { weight: 600, spacing: 0.004 });
    billing(c, S, 0.88, '#ffffff', 0.55);
  },
  // 1 soda: red field, silver can with condensation, big display type, CTA pill
  (c, S) => {
    c.fillStyle = '#c8101c';
    c.fillRect(0, 0, S, S);
    glow(c, S, 0.45, 0.5, 0.65, '#ff6a4a', 0.8);
    bokeh(c, S, 22, '#ffffff', 3, 0.006, 0.022, 0.55, 0.75);
    can(c, S, 0.29, 0.54, 0.2, 0.52, '#d8d8de', '#6c6c74', '#ffffff', 'ZERO', '#b40b18', '#ffffff');
    text(c, S, 'ICE COLD', 0.66, 0.42, 0.2, FONT.impact, '#ffffff', { maxW: 0.54, glow: 'rgba(0,0,0,0.35)', glowSize: 0.02 });
    text(c, S, 'TASTE THE NIGHT', 0.66, 0.56, 0.042, FONT.helv, '#ffe8b0', { spacing: 0.006, maxW: 0.5 });
    pill(c, S, 'NEW  ZERO SUGAR', 0.66, 0.68, '#ffffff', '#c8101c');
  },
  // 2 fragrance: black-on-black with an amber flacon and Didot type
  (c, S) => {
    c.fillStyle = linear(c, 0, 0, 0, S, [[0, '#1c1414'], [1, '#080606']]);
    c.fillRect(0, 0, S, S);
    glow(c, S, 0.5, 0.42, 0.5, '#8a5a40', 0.75);
    bottle(c, S, 0.5, 0.42, 0.2, 0.5, '#d9a066', '#6a3a14', '#ffe2b8', '#111111');
    text(c, S, 'NOIR', 0.5, 0.79, 0.24, FONT.didot, '#f3e9dc', { weight: 400, spacing: 0.04 });
    text(c, S, 'THE NEW FRAGRANCE', 0.5, 0.905, 0.038, FONT.didot, '#c9b8a6', { weight: 400, spacing: 0.01 });
    vignette(c, S, 0.5);
  },
  // 3 phone launch: violet/cyan glow behind a handset, Futura, pre-order CTA
  (c, S) => {
    c.fillStyle = '#050510';
    c.fillRect(0, 0, S, S);
    glow(c, S, 0.5, 0.55, 0.6, '#6a3cff', 0.9);
    glow(c, S, 0.32, 0.32, 0.38, '#19d7ff', 0.5);
    phone(c, S, 0.5, 0.47, 0.26, 0.54, linear(c, 0.37 * S, 0.2 * S, 0.63 * S, 0.74 * S, [[0, '#ff2d95'], [0.5, '#6a3cff'], [1, '#19d7ff']]));
    text(c, S, 'HELLO, TOMORROW.', 0.5, 0.83, 0.07, FONT.futura, '#ffffff', { weight: 500, spacing: 0.002, maxW: 0.9 });
    pill(c, S, 'PRE-ORDER NOW', 0.5, 0.925, '#ffffff', '#050510', 0.032);
  },
  // 4 sportswear: volt / black diagonal, a white arc, italic display type
  (c, S) => {
    c.fillStyle = '#c9ff1a';
    c.fillRect(0, 0, S, S);
    c.fillStyle = '#0b0b0b';
    c.beginPath();
    c.moveTo(S, 0.18 * S);
    c.lineTo(S, S);
    c.lineTo(0, S);
    c.lineTo(0, 0.78 * S);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.92)';
    c.lineWidth = S * 0.028;
    c.beginPath();
    c.arc(0.2 * S, 1.1 * S, 0.8 * S, -1.95, -0.55);
    c.stroke();
    text(c, S, 'GO', 0.3, 0.3, 0.42, FONT.black, '#0b0b0b', { weight: 900, italic: true });
    sneaker(c, S, 0.6, 0.55, 0.58, '#f4f4f4', '#c9ff1a', '#0b0b0b');
    text(c, S, 'FURTHER', 0.5, 0.8, 0.15, FONT.black, '#ffffff', { weight: 900, italic: true, maxW: 0.8 });
    text(c, S, 'RUN THE CITY', 0.5, 0.91, 0.04, FONT.helv, '#c9ff1a', { spacing: 0.008 });
  },
  // 5 the musical: magenta glow, gold marquee title with a halo, star row, tickets pill
  (c, S) => {
    c.fillStyle = linear(c, 0, 0, S, S, [[0, '#3a0a5e'], [1, '#b0157a']]);
    c.fillRect(0, 0, S, S);
    c.fillStyle = 'rgba(255,214,94,0.12)';
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * TAU;
      c.beginPath();
      c.moveTo(0.5 * S, 0.42 * S);
      c.lineTo(0.5 * S + Math.cos(a) * S, 0.42 * S + Math.sin(a) * S);
      c.lineTo(0.5 * S + Math.cos(a + 0.12) * S, 0.42 * S + Math.sin(a + 0.12) * S);
      c.closePath();
      c.fill();
    }
    glow(c, S, 0.5, 0.42, 0.5, '#ff4fb0', 0.6);
    bokeh(c, S, 12, '#ffd45e', 7, 0.004, 0.012, 0.8);
    text(c, S, 'MIDNIGHT', 0.5, 0.41, 0.2, FONT.impact, '#ffd45e', { glow: 'rgba(255,180,40,0.95)', glowSize: 0.05, spacing: 0.006, maxW: 0.92 });
    text(c, S, 'THE MUSICAL', 0.5, 0.56, 0.06, FONT.didot, '#ffffff', { weight: 400, spacing: 0.014 });
    c.fillStyle = '#ffd45e';
    for (let k = 0; k < 5; k++) star(c, (0.36 + k * 0.07) * S, 0.655 * S, 0.02 * S, 0.009 * S);
    pill(c, S, 'TICKETS ON SALE NOW', 0.5, 0.78, '#ffd45e', '#3a0a5e');
    text(c, S, 'ON BROADWAY  •  8 SHOWS A WEEK', 0.5, 0.9, 0.03, FONT.helv, '#f0c8e8', { weight: 600, spacing: 0.006 });
  },
  // 6 eyewear: white studio field, a portrait in sunglasses, black jacket, Futura
  (c, S) => {
    c.fillStyle = '#f4f2ee';
    c.fillRect(0, 0, S, S);
    c.fillStyle = radial(c, 0.5 * S, 0.4 * S, 0.5 * S, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.12)']]);
    c.fillRect(0, 0, S, S);
    c.fillStyle = '#2a1c14';
    c.beginPath();
    c.ellipse(0.5 * S, 0.36 * S, 0.2 * S, 0.24 * S, 0, 0, TAU);
    c.fill();
    c.fillStyle = radial(c, 0.5 * S, 0.44 * S, 0.22 * S, [[0, '#f2c8a4'], [1, '#c48a62']], 0.45 * S, 0.36 * S, 0.02 * S);
    c.beginPath();
    c.ellipse(0.5 * S, 0.44 * S, 0.155 * S, 0.2 * S, 0, 0, TAU);
    c.fill();
    c.fillStyle = '#111111';
    c.beginPath();
    c.moveTo(0.16 * S, S);
    c.quadraticCurveTo(0.28 * S, 0.68 * S, 0.5 * S, 0.65 * S);
    c.quadraticCurveTo(0.72 * S, 0.68 * S, 0.84 * S, S);
    c.closePath();
    c.fill();
    c.fillStyle = '#0b0b0d';
    roundRect(c, 0.352 * S, 0.385 * S, 0.135 * S, 0.078 * S, 0.03 * S);
    c.fill();
    roundRect(c, 0.513 * S, 0.385 * S, 0.135 * S, 0.078 * S, 0.03 * S);
    c.fill();
    c.fillRect(0.48 * S, 0.4 * S, 0.04 * S, 0.012 * S);
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.fillRect(0.37 * S, 0.397 * S, 0.05 * S, 0.011 * S);
    c.fillRect(0.53 * S, 0.397 * S, 0.05 * S, 0.011 * S);
    text(c, S, 'SEE IT ALL.', 0.5, 0.8, 0.13, FONT.futura, '#ffffff', { weight: 700, spacing: -0.004, maxW: 0.9 });
    text(c, S, 'THE NEW COLLECTION', 0.5, 0.905, 0.036, FONT.helv, '#cfcac2', { weight: 600, spacing: 0.01 });
    mark(c, S, 0.1, 0.1, 0.045, '#111111');
  },
  // 7 lager: amber light, brown bottle, Copperplate
  (c, S) => {
    c.fillStyle = linear(c, 0, 0, 0, S, [[0, '#2a1600'], [0.5, '#7a4a08'], [1, '#2a1600']]);
    c.fillRect(0, 0, S, S);
    glow(c, S, 0.5, 0.48, 0.55, '#ffb020', 0.7);
    bokeh(c, S, 16, '#ffd070', 9, 0.012, 0.04, 0.45);
    bottle(c, S, 0.5, 0.44, 0.17, 0.56, '#5a2a08', '#1e0c02', '#a8602a', '#d8b050', 'LAGER', '#e8c05a', '#3a1a04');
    text(c, S, 'COLD ONE', 0.5, 0.8, 0.13, FONT.copper, '#ffd070', { spacing: 0.01, maxW: 0.9 });
    text(c, S, 'BREWED FOR NEW YORK NIGHTS', 0.5, 0.9, 0.034, FONT.helv, '#f5e0b0', { weight: 600, spacing: 0.006 });
    vignette(c, S, 0.5);
  },
  // 8 streaming series: red angled band across black, condensed title, billing
  (c, S) => {
    c.fillStyle = '#070707';
    c.fillRect(0, 0, S, S);
    glow(c, S, 0.5, 0.3, 0.55, '#a00d1c', 0.5);
    streaks(c, S, '#ffffff', -0.2, 6, 21, 0.1);
    for (const [x, h] of [[0.27, 0.5], [0.5, 0.58], [0.73, 0.5]]) bust(c, S, x, 0.42, h, linear(c, 0, 0.1 * S, 0, 0.7 * S, [[0, '#2a1416'], [1, '#070707']]), '#ff5a66');
    c.fillStyle = '#d40f24';
    c.beginPath();
    c.moveTo(0, 0.56 * S);
    c.lineTo(S, 0.36 * S);
    c.lineTo(S, 0.62 * S);
    c.lineTo(0, 0.82 * S);
    c.closePath();
    c.fill();
    text(c, S, 'THE HEIST', 0.5, 0.5, 0.2, FONT.cond, '#ffffff', { weight: 800, spacing: 0.01, maxW: 0.92, glow: 'rgba(0,0,0,0.5)', glowSize: 0.02 });
    text(c, S, 'NEW SEASON  •  STREAMING NOW', 0.5, 0.2, 0.042, FONT.helv, '#ffffff', { spacing: 0.006 });
    billing(c, S, 0.885, '#ffffff', 0.5);
  },
  // 9 cosmetics: blush gradient, a lipstick, Didot
  (c, S) => {
    c.fillStyle = linear(c, 0, 0, 0, S, [[0, '#ffd9e6'], [1, '#fff6f8']]);
    c.fillRect(0, 0, S, S);
    glow(c, S, 0.7, 0.3, 0.45, '#ffb3c8', 0.8);
    c.fillStyle = cylinderFill(c, 0.5 * S, 0.1 * S, '#d8b45a', '#8a6a1e', '#fff0b8');
    roundRect(c, 0.45 * S, 0.54 * S, 0.1 * S, 0.17 * S, 0.012 * S);
    c.fill();
    c.fillStyle = cylinderFill(c, 0.5 * S, 0.075 * S, '#d91a4a', '#7a0a26', '#ff7a9a');
    c.beginPath();
    c.moveTo(0.4625 * S, 0.55 * S);
    c.lineTo(0.4625 * S, 0.3 * S);
    c.lineTo(0.5375 * S, 0.24 * S);
    c.lineTo(0.5375 * S, 0.55 * S);
    c.closePath();
    c.fill();
    text(c, S, 'BLUSH', 0.5, 0.83, 0.2, FONT.didot, '#1a0a10', { weight: 400, spacing: 0.03 });
    text(c, S, 'NEW SHADES  •  SPRING', 0.5, 0.935, 0.036, FONT.didot, '#7a4a5a', { weight: 400, spacing: 0.01 });
  },
  // 10 airline: sky gradient, a flight-path arc, fare
  (c, S) => {
    c.fillStyle = linear(c, 0, 0, 0, S, [[0, '#7fd6ff'], [0.55, '#1c6fd6'], [1, '#0a3d8a']]);
    c.fillRect(0, 0, S, S);
    bokeh(c, S, 6, '#ffffff', 13, 0.1, 0.2, 0.25, 0.5);
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = S * 0.012;
    c.beginPath();
    c.arc(0.45 * S, 1.25 * S, 1.05 * S, -2.5, -1.1);
    c.stroke();
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0.93 * S, 0.29 * S);
    c.lineTo(0.84 * S, 0.335 * S);
    c.lineTo(0.87 * S, 0.29 * S);
    c.lineTo(0.84 * S, 0.245 * S);
    c.closePath();
    c.fill();
    text(c, S, 'FLY NONSTOP', 0.5, 0.5, 0.11, FONT.helv, '#ffffff', { spacing: -0.002, maxW: 0.9 });
    text(c, S, 'NEW YORK  →  LISBON   FROM $349', 0.5, 0.63, 0.04, FONT.helv, '#dff3ff', { weight: 500, spacing: 0.003 });
    pill(c, S, 'BOOK TODAY', 0.5, 0.76, '#ffffff', '#0a3d8a');
  },
  // 11 sale: yellow field, giant discount, black band
  (c, S) => {
    c.fillStyle = '#ffd400';
    c.fillRect(0, 0, S, S);
    stripes(c, S, '#000000', 0.06, 0.09, 0.03, -0.6);
    text(c, S, 'EVERYTHING IN STORE & ONLINE', 0.5, 0.12, 0.03, FONT.helv, '#111111', { spacing: 0.008 });
    text(c, S, '50%', 0.5, 0.38, 0.34, FONT.impact, '#111111', { spacing: -0.006 });
    text(c, S, 'OFF', 0.5, 0.64, 0.2, FONT.impact, '#111111', { spacing: 0.01 });
    c.fillStyle = '#111111';
    c.fillRect(0, 0.78 * S, S, 0.13 * S);
    text(c, S, 'THIS WEEKEND ONLY', 0.5, 0.845, 0.055, FONT.helv, '#ffd400', { weight: 800, spacing: 0.01 });
  },
  // 12 energy drink / esports: neon streaks, glowing ring, italic display
  (c, S) => {
    c.fillStyle = '#030308';
    c.fillRect(0, 0, S, S);
    streaks(c, S, '#19f0ff', -0.5, 9, 31, 0.4);
    streaks(c, S, '#ff2ad4', -0.5, 6, 32, 0.35);
    glow(c, S, 0.5, 0.5, 0.4, '#19f0ff', 0.45);
    c.strokeStyle = '#19f0ff';
    c.lineWidth = S * 0.018;
    c.shadowColor = '#19f0ff';
    c.shadowBlur = S * 0.05;
    c.beginPath();
    c.arc(0.5 * S, 0.5 * S, 0.32 * S, 0, TAU);
    c.stroke();
    c.shadowBlur = 0;
    text(c, S, 'LEVEL UP', 0.5, 0.5, 0.15, FONT.black, '#ffffff', { weight: 900, italic: true, glow: '#19f0ff', glowSize: 0.05, maxW: 0.85 });
    text(c, S, 'ZERO SUGAR  •  200MG', 0.5, 0.64, 0.038, FONT.helv, '#ff2ad4', { spacing: 0.008 });
  },
  // 13 watch: steel bezel on black, thin Didot
  (c, S) => {
    c.fillStyle = '#08090c';
    c.fillRect(0, 0, S, S);
    glow(c, S, 0.5, 0.42, 0.5, '#3a4050', 0.9);
    metalRing(c, S, 0.5, 0.42, 0.27, 0.06);
    c.fillStyle = radial(c, 0.5 * S, 0.42 * S, 0.21 * S, [[0, '#1c1f26'], [1, '#05060a']]);
    c.beginPath();
    c.arc(0.5 * S, 0.42 * S, 0.21 * S, 0, TAU);
    c.fill();
    c.fillStyle = '#d8d2c4';
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU;
      c.save();
      c.translate(0.5 * S, 0.42 * S);
      c.rotate(a);
      c.fillRect(-0.006 * S, -0.195 * S, 0.012 * S, k % 3 === 0 ? 0.04 * S : 0.022 * S);
      c.restore();
    }
    c.strokeStyle = '#e9e4d8';
    c.lineCap = 'round';
    c.lineWidth = S * 0.012;
    c.beginPath();
    c.moveTo(0.5 * S, 0.42 * S);
    c.lineTo(0.5 * S + Math.cos(-1.05) * 0.12 * S, 0.42 * S + Math.sin(-1.05) * 0.12 * S);
    c.moveTo(0.5 * S, 0.42 * S);
    c.lineTo(0.5 * S + Math.cos(0.35) * 0.17 * S, 0.42 * S + Math.sin(0.35) * 0.17 * S);
    c.stroke();
    text(c, S, 'TIMELESS', 0.5, 0.8, 0.12, FONT.didot, '#e9e4d8', { weight: 400, spacing: 0.025 });
    text(c, S, 'AUTOMATIC  •  SINCE 1908', 0.5, 0.9, 0.034, FONT.didot, '#a8a296', { weight: 400, spacing: 0.01 });
  },
  // 14 news strip (tiles horizontally: the ribbons scroll it)
  (c, S) => {
    c.fillStyle = '#05070f';
    c.fillRect(0, 0, S, S);
    c.fillStyle = '#000000';
    c.fillRect(0, 0.25 * S, S, 0.5 * S);
    c.fillStyle = '#d40f24';
    c.fillRect(0, 0.25 * S, S, 0.03 * S);
    c.fillRect(0, 0.72 * S, S, 0.03 * S);
    c.fillStyle = '#d40f24';
    c.fillRect(0, 0.3 * S, 0.16 * S, 0.4 * S);
    text(c, S, 'LIVE', 0.08, 0.5, 0.09, FONT.black, '#ffffff', { weight: 900, maxW: 0.14 });
    text(c, S, 'TONIGHT 11PM  ▶  COUNCIL VOTES ON TRANSIT PLAN  ▶', 0.58, 0.5, 0.12, FONT.cond, '#ffffff', { weight: 700, spacing: 0.003, maxW: 0.8 });
  },
  // 15 electric car: night road, headlights blazing at the camera, Futura, spec line
  (c, S) => {
    c.fillStyle = linear(c, 0, 0, 0, S, [[0, '#0a0d18'], [0.6, '#141a2c'], [1, '#05060a']]);
    c.fillRect(0, 0, S, S);
    bokeh(c, S, 18, '#ffb060', 41, 0.008, 0.03, 0.5, 0.55);
    bokeh(c, S, 10, '#5ab0ff', 42, 0.008, 0.025, 0.4, 0.55);
    c.fillStyle = linear(c, 0, 0.62 * S, 0, S, [[0, '#1a1c24'], [1, '#07080c']]);
    c.fillRect(0, 0.62 * S, S, 0.38 * S);
    car(c, S, 0.5, 0.6, 0.78);
    text(c, S, 'ELECTRIC. FINALLY.', 0.5, 0.2, 0.09, FONT.futura, '#ffffff', { weight: 700, spacing: 0.002, maxW: 0.92 });
    text(c, S, '0–60 IN 3.1 S   •   400 MI RANGE', 0.5, 0.9, 0.034, FONT.helv, '#9fc4ff', { weight: 600, spacing: 0.006 });
  },
];

/** draw the 16 campaigns into a square atlas; returns a CanvasTexture (sRGB) and fills CELL_AVERAGES */
export function createScreenAtlas(size = ATLAS_SIZE): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cell = size / ATLAS_CELLS;
  if (ctx) {
    for (let i = 0; i < ATLAS_CELLS * ATLAS_CELLS; i++) {
      const x0 = (i % ATLAS_CELLS) * cell;
      const y0 = Math.floor(i / ATLAS_CELLS) * cell;
      ctx.save();
      ctx.translate(x0, y0);
      ctx.beginPath();
      ctx.rect(0, 0, cell, cell);
      ctx.clip();
      try { ADS[i % ADS.length](ctx, cell); } catch { ctx.fillStyle = '#202030'; ctx.fillRect(0, 0, cell, cell); }
      ctx.restore();
    }
    // per-cell mean colour (16 px per cell is plenty for a light colour)
    try {
      const px = 16, small = document.createElement('canvas');
      small.width = small.height = px * ATLAS_CELLS;
      const sc = small.getContext('2d');
      if (sc) {
        sc.drawImage(canvas, 0, 0, small.width, small.height);
        const data = sc.getImageData(0, 0, small.width, small.height).data;
        for (let i = 0; i < ATLAS_CELLS * ATLAS_CELLS; i++) {
          const cx = (i % ATLAS_CELLS) * px, cy = Math.floor(i / ATLAS_CELLS) * px;
          let r = 0, g = 0, b = 0;
          for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
            const o = ((cy + y) * small.width + cx + x) * 4;
            r += data[o]; g += data[o + 1]; b += data[o + 2];
          }
          const n = px * px * 255;
          CELL_AVERAGES[i].setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
        }
      }
    } catch { /* tainted / headless canvas: keep the defaults */ }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export interface ScreenQuad {
  /** bottom-left, bottom-right, top-right, top-left seen from the front */
  p: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  cell: number;
  type: number; // 0 slideshow, 1 ticker, 2 pulse, 3 band
  speed: number;
  phase: number;
}

/** a big screen that lights the street: centre, outward normal, size and the content it shows */
export interface SpillSource {
  x: number; y: number; z: number;
  nx: number; nz: number;
  w: number; h: number;
  cell: number; type: number; speed: number; phase: number;
}

/** collects screen quads into one geometry (aCell / aAnim / aSize attributes for the screen material) */
export class ScreenBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  cell: number[] = [];
  anim: number[] = [];
  size: number[] = [];
  idx: number[] = [];
  count = 0;
  sources: SpillSource[] = [];

  add(q: ScreenQuad): void {
    const [a, b, c, d] = q.p;
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const w = a.distanceTo(b), h = a.distanceTo(d);
    const aspect = Math.max(0.1, Math.min(14, w / Math.max(0.1, h)));
    const base = this.pos.length / 3;
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    [a, b, c, d].forEach((p, i) => {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.cell.push(q.cell);
      this.anim.push(q.type, q.speed, q.phase, aspect);
      this.size.push(w, h);
    });
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count++;
    if (w * h >= SPILL_MIN_AREA) {
      this.sources.push({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2, nx: n.x, nz: n.z, w, h, cell: q.cell, type: q.type, speed: q.speed, phase: q.phase });
    }
  }

  /** a curved screen (cylinder segment) around (cx, cz) from angle a0 to a1, radius r, heights y0..y1 */
  addArc(cx: number, cz: number, r: number, a0: number, a1: number, y0: number, y1: number, cell: number, type: number, speed: number, phase: number): void {
    const segs = Math.max(6, Math.ceil((Math.abs(a1 - a0) * r) / 1.5));
    const arcLen = Math.abs(a1 - a0) * r;
    const aspect = Math.max(0.1, Math.min(14, arcLen / (y1 - y0)));
    const base = this.pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const a = a0 + (a1 - a0) * t;
      const nx = Math.cos(a), nz = Math.sin(a);
      const x = cx + nx * r, z = cz + nz * r;
      for (const [y, v] of [[y0, 0], [y1, 1]] as [number, number][]) {
        this.pos.push(x, y, z);
        this.nor.push(nx, 0, nz);
        // Increasing angles travel right-to-left when viewed from outside the cylinder.
        this.uv.push(a1 > a0 ? 1 - t : t, v);
        this.cell.push(cell);
        this.anim.push(type, speed, phase, aspect);
        this.size.push(arcLen, y1 - y0);
      }
    }
    // winding so the front faces outward: check with the first quad
    for (let i = 0; i < segs; i++) {
      const b0 = base + i * 2, b1 = base + (i + 1) * 2;
      // quad: (b0 bottom, b1 bottom, b1 top, b0 top)
      const ax = this.pos[b0 * 3], az = this.pos[b0 * 3 + 2], bx = this.pos[b1 * 3], bz = this.pos[b1 * 3 + 2];
      const nx = this.nor[b0 * 3], nz = this.nor[b0 * 3 + 2];
      // outward if (b - a) x up points along the normal:  (dx, dz) x (0,1,0) -> (-dz, 0, dx)... use 2D test
      const dx = bx - ax, dz = bz - az;
      const cross = dz * nx - dx * nz; // sign of (edge x normal) about y
      if (cross < 0) this.idx.push(b0, b1, b1 + 1, b0, b1 + 1, b0 + 1);
      else this.idx.push(b0, b0 + 1, b1 + 1, b0, b1 + 1, b1);
    }
    this.count++;
    if (arcLen * (y1 - y0) >= SPILL_MIN_AREA) {
      const am = (a0 + a1) / 2;
      this.sources.push({ x: cx + Math.cos(am) * r, y: (y0 + y1) / 2, z: cz + Math.sin(am) * r, nx: Math.cos(am), nz: Math.sin(am), w: arcLen, h: y1 - y0, cell, type, speed, phase });
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCell', new THREE.Float32BufferAttribute(this.cell, 1));
    g.setAttribute('aAnim', new THREE.Float32BufferAttribute(this.anim, 4));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.size, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** a screen quad on a vertical facade edge a->b (outward normal n), t0..t1 along the edge (m), y0..y1, standoff */
export function facadeScreen(a: [number, number], b: [number, number], n: [number, number], t0: number, t1: number, y0: number, y1: number, standoff: number, cell: number, type: number, speed: number, phase: number): ScreenQuad {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ex = dx / len, ez = dz / len;
  const P = (t: number, y: number) => new THREE.Vector3(a[0] + ex * t + n[0] * standoff, y, a[1] + ez * t + n[1] * standoff);
  const p: ScreenQuad['p'] = -ez * n[0] + ex * n[1] >= 0
    ? [P(t0, y0), P(t1, y0), P(t1, y1), P(t0, y1)]
    : [P(t1, y0), P(t0, y0), P(t0, y1), P(t1, y1)];
  return { p, cell, type, speed, phase };
}

/** outward normal of ring edge i (ring in world x/z) */
export function edgeNormal(ring: Ring, i: number): [number, number] {
  const a = ring[i], b = ring[(i + 1) % ring.length];
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  let nx = dz / len, nz = -dx / len;
  if (signedArea(ring) < 0) {
    nx = -nx;
    nz = -nz;
  }
  return [nx, nz];
}

/** distance from a point to the bowtie axis polyline + direction toward it */
export function axisInfo(x: number, z: number): { dist: number; dirX: number; dirZ: number } {
  let best = Infinity, bx = 0, bz = 0;
  const A = TIMES_SQUARE_AXIS;
  for (let i = 0; i + 1 < A.length; i++) {
    const [ax, az] = A[i], [cx, cz] = A[i + 1];
    const ex = cx - ax, ez = cz - az;
    const l2 = ex * ex + ez * ez || 1;
    let t = ((x - ax) * ex + (z - az) * ez) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + ex * t, pz = az + ez * t;
    const d = Math.hypot(px - x, pz - z);
    if (d < best) {
      best = d;
      bx = px;
      bz = pz;
    }
  }
  const dl = best || 1;
  return { dist: best, dirX: (bx - x) / dl, dirZ: (bz - z) / dl };
}

/**
 * Buildings whose signage covers more than the generic composition: 2 Times Square is a billboard slab from the
 * 3rd floor to the roof on every face toward Duffy Square; 1500 Broadway's wrap climbs to its 10th floor.
 */
const SIGNAGE_TOP: Record<number, number> = { [TWO_TIMES_SQUARE_BIN]: 76, [FIFTEEN_HUNDRED_BROADWAY_BIN]: 66 };

/**
 * Screens for one bowtie building: every facade edge that faces the axis (within 62 m) gets a composition of
 * stacked LED panels. Deterministic per BIN so the layout is stable across reloads.
 */
export function composeBuildingScreens(b: Building, out: ScreenBuilder, skipBins: Set<number>): void {
  if (skipBins.has(b.id)) return;
  const ring = b.footprint[0];
  if (!ring || ring.length < 3 || b.height < 9) return;
  const rand = rng(b.id * 7919 + 13);
  const n = ring.length;
  const topLimit = SIGNAGE_TOP[b.id] ?? 62;
  const stackAll = b.id === TWO_TIMES_SQUARE_BIN;
  const edge = (i: number) => {
    const a = ring[i], c = ring[(i + 1) % n];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    const nrm = edgeNormal(ring, i);
    const ax = axisInfo(mx, mz);
    const facing = nrm[0] * ax.dirX + nrm[1] * ax.dirZ;
    let ok = len >= 6;
    if (stackAll) {
      // the 2 Times Square stack wraps the whole south tip (both flanks), not just the 10 m face on 47th
      if (facing < -0.6 || (ax.dist > 34 && facing < 0.45)) ok = false;
    } else if (ax.dist > 62 || facing < 0.45) ok = false;
    return { a, c, len, nrm, ok };
  };
  // the square's one scrolling news ribbon: the ground band of 1500 Broadway's longest bowtie-facing facade
  let tickerEdge = -1;
  if (b.id === FIFTEEN_HUNDRED_BROADWAY_BIN) {
    let best = 0;
    for (let i = 0; i < n; i++) {
      const e = edge(i);
      if (e.ok && e.len > best) { best = e.len; tickerEdge = i; }
    }
  }
  for (let i = 0; i < n; i++) {
    const { a, c, len, nrm, ok } = edge(i);
    if (!ok) continue;
    const h = b.height;
    const margin = 0.6;
    const standoff = 0.35;
    const cellOf = () => Math.floor(rand() * 14);
    // tickers only run on the ground ribbons; main screens are slideshows, pulses or video-like bands
    const typeOf = () => {
      const r = rand();
      return r < 0.55 ? 0 : r < 0.78 ? 2 : 3;
    };
    if (len < 11 && !stackAll) {
      // narrow facade: one tall vertical screen
      const w = Math.min(len - 2 * margin, 8);
      const t0 = (len - w) / 2;
      const top = Math.min(h - 2, 4 + 10 + rand() * 14);
      out.add(facadeScreen(a, c, nrm, t0, t0 + w, 4, top, standoff, cellOf(), typeOf(), 0.7 + rand() * 0.6, rand()));
      continue;
    }
    if (stackAll) {
      // 2 Times Square: a full-height stack of billboards, the classic Duffy Square backdrop
      let y = 4;
      while (y < Math.min(h - 2, topLimit)) {
        const ph = Math.min(Math.min(h - 2, topLimit) - y, 9 + rand() * 6);
        if (ph < 3) break;
        out.add(facadeScreen(a, c, nrm, margin, len - margin, y, y + ph, standoff, cellOf(), typeOf(), 0.6 + rand() * 0.8, rand()));
        y += ph + 0.5;
      }
      continue;
    }
    // ground band (storefront signage wrap): the news ribbon on its one facade, ad panels everywhere else
    out.add(facadeScreen(a, c, nrm, margin, len - margin, 3.6, Math.min(h - 1.5, 6.4), standoff, cellOf(), i === tickerEdge ? 1 : 0, 0.8 + rand() * 0.5, rand()));
    // big main screen
    let y = 7.2;
    const bigH = Math.min(h - 3 - y, 12 + rand() * 16);
    if (bigH > 4) {
      const w = len - 2 * margin - rand() * Math.min(6, len * 0.25);
      const t0 = margin + rand() * (len - 2 * margin - w);
      out.add(facadeScreen(a, c, nrm, t0, t0 + w, y, y + bigH, standoff, cellOf(), typeOf(), 0.6 + rand() * 0.8, rand()));
      y += bigH + 1.0 + rand() * 1.5;
    }
    // stacked panels above, up to ~62 m (more on the signature signage buildings) or the roof
    let guard = 0;
    while (y < Math.min(h - 4, topLimit) && guard++ < 6) {
      const ph = Math.min(h - 3 - y, 5 + rand() * 12);
      if (ph < 3.5) break;
      const split = rand() < 0.4 && len > 18;
      if (split) {
        const gap = 1.0;
        const w1 = (len - 2 * margin - gap) * (0.35 + rand() * 0.3);
        out.add(facadeScreen(a, c, nrm, margin, margin + w1, y, y + ph, standoff, cellOf(), typeOf(), 0.6 + rand() * 0.8, rand()));
        out.add(facadeScreen(a, c, nrm, margin + w1 + gap, len - margin, y, y + ph, standoff, cellOf(), typeOf(), 0.6 + rand() * 0.8, rand()));
      } else {
        const w = len - 2 * margin - rand() * Math.min(8, len * 0.3);
        const t0 = margin + rand() * (len - 2 * margin - w);
        out.add(facadeScreen(a, c, nrm, t0, t0 + w, y, y + ph, standoff, cellOf(), typeOf(), 0.6 + rand() * 0.8, rand()));
      }
      y += ph + 0.8 + rand() * 2.5;
    }
  }
}
