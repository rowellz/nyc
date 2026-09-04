/**
 * Per-kind texture atlas (color + emissive), painted on canvases. Solid patches for paint/plastic/chrome,
 * NY license plates, grille, lamp lenses, tire sidewall lettering, dashboard, taxi roof light, liveries
 * (yellow cab, boro taxi, NYPD, MTA, DSNY, generic box truck), bus LED destination sign, police lightbar.
 * Metalness / roughness / clearcoat come from a per-vertex attribute, so only color + emissive are painted.
 */
import * as THREE from 'three';
import type { VehicleSpec } from './kinds';

export const ATLAS = 1024;

export interface Rect { u0: number; v0: number; u1: number; v1: number; x: number; y: number; w: number; h: number }

function rect(x: number, y: number, w: number, h: number): Rect {
  // canvas y grows downward; texture v grows upward (flipY)
  return { x, y, w, h, u0: (x + 0.5) / ATLAS, u1: (x + w - 0.5) / ATLAS, v0: 1 - (y + h - 0.5) / ATLAS, v1: 1 - (y + 0.5) / ATLAS };
}

const SOLID_NAMES = ['white', 'black', 'chrome', 'alloy', 'rubber', 'interior', 'darkred', 'lens', 'amber', 'red', 'blue', 'glass', 'gray', 'darkchrome', 'seat', 'lightgray'] as const;
export type SolidName = (typeof SOLID_NAMES)[number];

export const R = {
  solid: Object.fromEntries(SOLID_NAMES.map((n, i) => [n, rect(i * 64 + 8, 8, 48, 48)])) as Record<SolidName, Rect>,
  plateFront: rect(0, 64, 256, 128),
  plateRear: rect(256, 64, 256, 128),
  grille: rect(512, 64, 256, 128),
  headlight: rect(768, 64, 256, 128),
  taillight: rect(0, 192, 256, 128),
  sidewall: rect(256, 192, 256, 256),
  dash: rect(512, 192, 256, 128),
  roofSign: rect(768, 192, 256, 128),
  decalL: rect(0, 448, 512, 192),
  decalR: rect(512, 448, 512, 192),
  sign: rect(0, 640, 512, 128),
  lightbar: rect(512, 640, 512, 64),
  rearDoor: rect(768, 320, 256, 128), // (was under boxSide, which painted over its lower half)
  boxSide: rect(0, 768, 1024, 256),
  hoodDecal: rect(768, 704, 256, 64),
  wheelHub: rect(512, 320, 128, 128),
  tread: rect(640, 320, 128, 128),
  busFront: rect(0, 320, 256, 64), // yellow front band with the roundel and lamp bezels
  roofDecal: rect(512, 704, 256, 64), // police unit number (roof, tailgate)
};

/** deterministic bus / unit numbers from the kind seed */
function fleetNumber(seed: number, lo: number, span: number): string {
  return `${Math.floor(lo + (seed * 8999) % span)}`;
}

export interface KindAtlas {
  map: THREE.CanvasTexture;
  emissive: THREE.CanvasTexture;
  /** The Camry fleets own their paint response; other vehicle atlases keep the shared defaults. */
  taxiBody?: boolean;
  dispose(): void;
}

const SOLID_COLORS: Record<SolidName, string> = {
  white: '#ffffff',
  black: '#0b0b0c',
  chrome: '#e8e9ea',
  alloy: '#a9abae',
  rubber: '#111213',
  interior: '#17181a',
  darkred: '#4a0608',
  lens: '#cfd6dc',
  amber: '#e8901c',
  red: '#c8141a',
  blue: '#1a3ec8',
  glass: '#0c1014',
  gray: '#8a8c8f',
  darkchrome: '#5a5c60',
  seat: '#26282b',
  lightgray: '#d8d9da',
};

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const g = c.getContext('2d')!;
  return [c, g];
}

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, opts: { weight?: string; family?: string; align?: CanvasTextAlign; stretch?: number; letter?: number } = {}): void {
  g.save();
  g.fillStyle = color;
  g.textAlign = opts.align ?? 'center';
  g.textBaseline = 'middle';
  g.font = `${opts.weight ?? 'bold'} ${size}px ${opts.family ?? '"Helvetica Neue", Helvetica, Arial, sans-serif'}`;
  if (opts.stretch && opts.stretch !== 1) {
    g.translate(x, y);
    g.scale(opts.stretch, 1);
    g.fillText(s, 0, 0);
  } else g.fillText(s, x, y);
  g.restore();
}

/** medallion number, e.g. 2Y47 (shared by the roof light, doors and plates of a kind) */
function medallion(seed: number): string {
  return `${Math.floor(1 + (seed * 9) % 9)}${String.fromCharCode(65 + Math.floor((seed * 26 * 7) % 26))}${Math.floor((seed * 100) % 90 + 10)}`;
}

function plate(g: CanvasRenderingContext2D, r: Rect, seed: number, yellowStyle: boolean, taxiPlate = false): void {
  const { x, y, w, h } = r;
  // NY 2020+ "Excelsior": white with a blue band top and bottom; older: yellow/gold gradient with "EMPIRE STATE"
  if (yellowStyle) {
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#f7dc6f');
    grad.addColorStop(0.5, '#f5c542');
    grad.addColorStop(1, '#e8a317');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    g.fillStyle = '#1b2e73';
    g.fillRect(x, y + h - 18, w, 18);
    text(g, 'EMPIRE STATE', x + w / 2, y + h - 9, 12, '#f5f5f5', { weight: '700' });
    text(g, 'NEW YORK', x + w / 2, y + 14, 15, '#1b2e73', { weight: '800' });
  } else {
    g.fillStyle = '#f4f5f6';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#123a8f';
    g.fillRect(x, y, w, 20);
    g.fillRect(x, y + h - 20, w, 20);
    text(g, 'NEW YORK', x + w / 2, y + 10, 14, '#ffffff', { weight: '800' });
    text(g, 'EXCELSIOR', x + w / 2, y + h - 10, 11, '#ffffff', { weight: '700' });
  }
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const n = (i: number) => Math.floor(Math.abs(Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1 * 10);
  const l = (i: number) => letters[Math.floor(Math.abs(Math.sin(seed * 45.164 + i * 94.673) * 23421.631) % 1 * letters.length)];
  // medallion cabs carry T-number-C plates
  const s = taxiPlate ? `T${n(0)}${n(1)}${n(2)}${n(3)}${n(4)}${n(5)}C` : `${l(0)}${l(1)}${l(2)} ${n(3)}${n(4)}${n(5)}${n(6)}`;
  text(g, s, x + w / 2, y + h / 2 + 2, taxiPlate ? 50 : 62, yellowStyle ? '#1b2e73' : '#1c2340', { weight: '700', family: '"Helvetica Neue", Arial Narrow, Arial, sans-serif', stretch: 0.92 });
}

function grille(g: CanvasRenderingContext2D, r: Rect): void {
  const { x, y, w, h } = r;
  g.fillStyle = '#0a0a0b';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#1c1d1f';
  for (let i = 0; i < 7; i++) g.fillRect(x, y + 6 + i * 17, w, 6);
  g.fillStyle = '#050505';
  for (let i = 0; i < 12; i++) g.fillRect(x + 2 + i * 22, y, 3, h);
}

function headlight(g: CanvasRenderingContext2D, r: Rect, e: CanvasRenderingContext2D, modern = false): void {
  const { x, y, w, h } = r;
  if (modern) {
    // Taxi-only reflector cavities under a clear cover, not a solid chrome blade. The photos establish
    // lens/reflector contrast, not the precise optical layout of this Camry.
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#26343e');
    grad.addColorStop(0.22, '#111a22');
    grad.addColorStop(0.76, '#28343e');
    grad.addColorStop(1, '#0b1118');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    // Broad, separated reflector facets survive a five-metre view; no invented fine lens fluting.
    const facet = (points: [number, number][], color: string) => {
      g.fillStyle = color;
      g.beginPath();
      points.forEach(([u, v], i) => i ? g.lineTo(x + w * u, y + h * v) : g.moveTo(x + w * u, y + h * v));
      g.closePath();
      g.fill();
    };
    facet([[0.44, 0.25], [0.69, 0.20], [0.64, 0.40], [0.48, 0.49]], '#8999a4');
    facet([[0.44, 0.25], [0.48, 0.49], [0.49, 0.73], [0.43, 0.78]], '#546572');
    facet([[0.49, 0.73], [0.64, 0.40], [0.69, 0.20], [0.67, 0.74]], '#465e6e');
    facet([[0.43, 0.78], [0.49, 0.73], [0.67, 0.74], [0.63, 0.86]], '#a1aeb6');
    facet([[0.72, 0.22], [0.92, 0.22], [0.82, 0.42], [0.72, 0.54]], '#718796');
    facet([[0.72, 0.54], [0.82, 0.42], [0.84, 0.62], [0.70, 0.77]], '#536977');
    g.fillStyle = '#0c0d0f';
    g.beginPath();
    // Compensate for the wide, shallow lamp UVs: the projector must be round on the car,
    // not a broad silver oval. These bounds also match the near-LOD modelled optical recess.
    g.ellipse(x + w * 0.3, y + h * 0.57, 16, 44, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#cbd4db';
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(x + w * 0.3, y + h * 0.57, 14, 40, 0, 0, Math.PI * 2);
    g.stroke();
    g.save();
    g.translate(x + w * 0.3, y + h * 0.57);
    g.scale(0.35, 1);
    const optic = g.createRadialGradient(-6, -12, 2, 0, 0, 30);
    optic.addColorStop(0, '#d5e1e7');
    optic.addColorStop(0.22, '#718e9f');
    optic.addColorStop(0.62, '#233d50');
    optic.addColorStop(1, '#0c1620');
    g.fillStyle = optic;
    g.beginPath();
    g.arc(0, 0, 30, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // A dark lower bezel separates the optic from its bright reflector bowl.
    g.strokeStyle = '#24333e';
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(x + w * 0.3, y + h * 0.57, 14, 40, 0, 0.12, Math.PI - 0.12);
    g.stroke();
    g.fillStyle = '#dfe6ec';
    // Discontinuous edge glints leave the dark housing readable instead of outlining a chrome blade.
    g.fillRect(x + w * 0.18, y + 8, w * 0.19, 3);
    g.fillRect(x + w * 0.45, y + 8, w * 0.22, 3);
    e.fillStyle = '#000';
    e.fillRect(x, y, w, h);
    e.fillStyle = '#b9c4ce';
    e.beginPath();
    e.ellipse(x + w * 0.3, y + h * 0.57, 6, 18, 0, 0, Math.PI * 2);
    e.fill();
    e.fillStyle = '#dfe7ef';
    e.fillRect(x + w * 0.18, y + 8, w * 0.19, 3);
    e.fillRect(x + w * 0.45, y + 8, w * 0.22, 3);
    return;
  }
  // lens: pale gray with a projector in the inner half and a DRL strip at the bottom
  const grad = g.createLinearGradient(x, y, x + w, y);
  grad.addColorStop(0, '#e6ebef');
  grad.addColorStop(1, '#b9c2c9');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.fillStyle = '#2b3136';
  g.beginPath();
  g.ellipse(x + w * 0.35, y + h * 0.5, 40, 40, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#9fb3c4';
  g.beginPath();
  g.ellipse(x + w * 0.35, y + h * 0.5, 26, 26, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d8dee3';
  g.fillRect(x + 8, y + h - 22, w - 16, 10);
  // emissive: projector bright white, DRL strip white
  e.fillStyle = '#000';
  e.fillRect(x, y, w, h);
  e.fillStyle = '#ffffff';
  e.beginPath();
  e.ellipse(x + w * 0.35, y + h * 0.5, 30, 30, 0, 0, Math.PI * 2);
  e.fill();
  e.fillStyle = '#dfe7ef';
  e.fillRect(x + 8, y + h - 22, w - 16, 10);
}

function taillight(g: CanvasRenderingContext2D, r: Rect, e: CanvasRenderingContext2D, wrap = false): void {
  const { x, y, w, h } = r;
  if (wrap) {
    // Wrap-around LED unit (sedan / crossover): u runs from the forward tip on the fender (0) round the corner
    // (0.5) to the inner end on the tail face (1). Smoked red lens, a bright light-guide bar along the top
    // that tapers into the tip, a second bar low on the tail-face part, clear signal / reverse zone at the inner end.
    const grad = g.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#5a0a10');
    grad.addColorStop(0.55, '#3a0507');
    grad.addColorStop(1, '#1e0304');
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    const bar = (c: CanvasRenderingContext2D, u0: number, u1: number, v0: number, v1: number, color: string, taper = 0) => {
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(x + w * u0, y + h * (1 - v0) - taper);
      c.lineTo(x + w * u1, y + h * (1 - v0));
      c.lineTo(x + w * u1, y + h * (1 - v1));
      c.lineTo(x + w * u0, y + h * (1 - v1) + taper);
      c.closePath();
      c.fill();
    };
    bar(g, 0.02, 0.8, 0.62, 0.86, '#c8262c', 10); // upper light guide, tapering into the tip
    bar(g, 0.5, 0.8, 0.12, 0.3, '#b3222a'); // lower bar on the tail face
    g.fillStyle = '#2a0608';
    g.fillRect(x + w * 0.46, y + h * 0.2, 3, h * 0.6); // body corner shut line in the lens
    g.fillStyle = '#4a0a0e';
    g.fillRect(x + w * 0.8, y, 2, h);
    g.fillStyle = '#7a1218';
    g.fillRect(x + w * 0.81, y, w * 0.19, h); // signal (inner)
    g.fillStyle = '#d4d8dc';
    g.fillRect(x + w * 0.83, y + h * 0.66, w * 0.15, h * 0.24); // clear reverse lens, inner low corner
    e.fillStyle = '#000';
    e.fillRect(x, y, w, h);
    e.fillStyle = '#a80f14';
    e.fillRect(x, y, w * 0.8, h);
    bar(e, 0.02, 0.8, 0.62, 0.86, '#e04040', 10);
    bar(e, 0.5, 0.8, 0.12, 0.3, '#d83838');
    // Inner hotspot: a real tail lens is a saturated red bar with a hotter filament line inside it, so
    // only that line crosses the bloom threshold on the brakes. A flat bar reads as painted red plastic.
    bar(e, 0.06, 0.74, 0.685, 0.80, '#ff7a6a', 6);
    bar(e, 0.54, 0.78, 0.165, 0.255, '#ff6a5c');
    // US-style red turn signal: the channel idles at a low glow, so amber here would read as a lit orange block
    e.fillStyle = '#ff3030';
    e.fillRect(x + w * 0.81, y, w * 0.19, h);
    e.fillStyle = '#000';
    e.fillRect(x + w * 0.83, y + h * 0.66, w * 0.15, h * 0.24);
    return;
  }
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#7a0c10');
  grad.addColorStop(0.6, '#4d0508');
  grad.addColorStop(1, '#2c0304');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.fillStyle = '#a5161c';
  for (let i = 0; i < 4; i++) g.fillRect(x + 6, y + 10 + i * 28, w - 12, 12);
  g.fillStyle = '#d9d9d9';
  g.fillRect(x + w - 50, y + h - 34, 40, 24); // reverse lens
  e.fillStyle = '#000';
  e.fillRect(x, y, w, h);
  // The truck/bus cluster is a large face: a flat full-brightness rect blooms as one red slab. Keep the
  // body of the lens a deep red and put the light in the four bars, each with a hotter filament line.
  e.fillStyle = '#b8181e';
  e.fillRect(x, y, w, h);
  e.fillStyle = '#ff4a4a';
  for (let i = 0; i < 4; i++) e.fillRect(x + 6, y + 10 + i * 28, w - 12, 12);
  e.fillStyle = '#ff8f80';
  for (let i = 0; i < 4; i++) e.fillRect(x + 10, y + 13 + i * 28, w - 20, 5);
  e.fillStyle = '#000';
  e.fillRect(x + w - 50, y + h - 34, 40, 24);
}

function sidewall(g: CanvasRenderingContext2D, r: Rect): void {
  const { x, y, w, h } = r;
  const cx = x + w / 2, cy = y + h / 2;
  g.fillStyle = '#121314';
  g.fillRect(x, y, w, h);
  // subtle radial shading
  const grad = g.createRadialGradient(cx, cy, w * 0.3, cx, cy, w * 0.5);
  grad.addColorStop(0, '#191a1b');
  grad.addColorStop(0.62, '#303237');
  grad.addColorStop(1, '#101113');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, w * 0.5, 0, Math.PI * 2);
  g.fill();
  // lettering around the sidewall
  // Broad molded shoulder ring survives minification; the lettering alone does not.
  g.strokeStyle = '#43464b';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(cx, cy, w * 0.455, 0, Math.PI * 2);
  g.stroke();
  g.save();
  g.translate(cx, cy);
  g.fillStyle = '#404144';
  g.font = 'bold 16px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const s = 'P215/55R17  M+S   RADIAL   ';
  const radius = w * 0.42;
  for (let i = 0; i < s.length; i++) {
    const a = (i / s.length) * Math.PI * 2;
    g.save();
    g.rotate(a);
    g.fillText(s[i], 0, -radius);
    g.restore();
  }
  g.restore();
  // rim shadow ring
  g.strokeStyle = '#000';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(cx, cy, w * 0.33, 0, Math.PI * 2);
  g.stroke();
}

function dash(g: CanvasRenderingContext2D, r: Rect, e: CanvasRenderingContext2D): void {
  const { x, y, w, h } = r;
  g.fillStyle = '#1a1b1d';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#0d0e10';
  g.fillRect(x + 20, y + 30, 90, 40); // instrument cluster
  g.fillRect(x + 130, y + 40, 60, 40); // center screen
  e.fillStyle = '#000';
  e.fillRect(x, y, w, h);
  e.fillStyle = '#3d6fa8';
  e.fillRect(x + 24, y + 34, 82, 32);
  e.fillStyle = '#4a7fb5';
  e.fillRect(x + 134, y + 44, 52, 32);
}

function roofSign(g: CanvasRenderingContext2D, r: Rect, e: CanvasRenderingContext2D, seed: number, taxi = false): void {
  const { x, y, w, h } = r;
  if (taxi) {
    // yellow-cab-1 / yellow-cab-2: white medallion characters on a black identifier band.
    // Retain the existing compact Camry light; the reference advertising toppers are different models.
    const draw = (c: CanvasRenderingContext2D, emissive: boolean) => {
      c.fillStyle = emissive ? '#000' : '#101317';
      c.fillRect(x, y, w, h);
      if (!emissive) {
        c.strokeStyle = '#bdc2c4';
        c.lineWidth = 4;
        c.strokeRect(x + 2, y + 2, w - 4, h - 4);
      }
      const ink = emissive ? '#a9aca5' : '#f1f2e9';
      text(c, medallion(seed), x + w / 2, y + h / 2 + 3, 99, ink, { weight: '800', stretch: 0.46 });
      for (const dx of [24, w - 24]) {
        text(c, 'OFF', x + dx, y + h * 0.41, 23, emissive ? '#000' : '#d8dcd7', { stretch: 0.46 });
        text(c, 'DUTY', x + dx, y + h * 0.64, 23, emissive ? '#000' : '#d8dcd7', { stretch: 0.46 });
      }
    };
    draw(g, false);
    draw(e, true);
    return;
  }
  // NYC roof light: the medallion number alone on a backlit yellow panel, dark "off duty" lamps at both ends.
  // The rect (2:1) lands on a 0.6 x 0.13 m face, so glyphs are drawn 0.43x wide to read upright.
  const num = medallion(seed);
  const draw = (c: CanvasRenderingContext2D, ground: string, ink: string, lamp: string) => {
    c.fillStyle = ground;
    c.fillRect(x, y, w, h);
    c.fillStyle = '#111';
    c.fillRect(x, y, w, 5);
    c.fillRect(x, y + h - 5, w, 5);
    c.fillStyle = lamp;
    c.fillRect(x, y + 5, 26, h - 10);
    c.fillRect(x + w - 26, y + 5, 26, h - 10);
    c.fillStyle = '#111';
    c.fillRect(x + 26, y + 5, 3, h - 10);
    c.fillRect(x + w - 29, y + 5, 3, h - 10);
    text(c, num, x + w / 2, y + h / 2 + 4, 108, ink, { weight: '800', stretch: 0.43, family: 'Arial, "Helvetica Neue", sans-serif' });
  };
  draw(g, '#f5c518', '#111', '#3a3a3c');
  draw(e, '#f2c300', '#000', '#141414');
}

function lightbar(g: CanvasRenderingContext2D, r: Rect, e: CanvasRenderingContext2D): void {
  const { x, y, w, h } = r;
  // left half red, right half blue, white center; emissive is the same; the shader sequences by u
  const seg = w / 8;
  const day = ['#7e1114', '#7e1114', '#7e1114', '#b9c0c6', '#b9c0c6', '#1a3596', '#1a3596', '#1a3596'];
  const lit = ['#ff2020', '#ff2020', '#ff2020', '#ffffff', '#ffffff', '#2a52ff', '#2a52ff', '#2a52ff'];
  for (let i = 0; i < 8; i++) {
    g.fillStyle = day[i];
    g.fillRect(x + i * seg, y, seg, h);
    e.fillStyle = lit[i];
    e.fillRect(x + i * seg, y, seg, h);
  }
  // module dividers and the black top / bottom extrusion of the bar
  g.fillStyle = 'rgba(0,0,0,0.5)';
  for (let i = 0; i < 24; i++) g.fillRect(x + i * (w / 24), y, 3, h);
  g.fillStyle = '#0b0b0c';
  g.fillRect(x, y, w, 6);
  g.fillRect(x, y + h - 6, w, 6);
  e.fillStyle = '#000';
  e.fillRect(x, y, w, 6);
  e.fillRect(x, y + h - 6, w, 6);
}

function busSign(g: CanvasRenderingContext2D, r: Rect, e: CanvasRenderingContext2D): void {
  const { x, y, w, h } = r;
  g.fillStyle = '#0c0c0e';
  g.fillRect(x, y, w, h);
  e.fillStyle = '#000';
  e.fillRect(x, y, w, h);
  const draw = (c: CanvasRenderingContext2D, col: string) => {
    text(c, 'M42', x + 90, y + h / 2, 84, col, { weight: '800', family: 'Arial, sans-serif' });
    text(c, 'CROSSTOWN', x + 330, y + h * 0.34, 44, col, { weight: '800', family: 'Arial, sans-serif' });
    text(c, 'UN / EAST SIDE', x + 330, y + h * 0.7, 34, col, { weight: '700', family: 'Arial, sans-serif' });
  };
  draw(g, '#f4a51c');
  draw(e, '#ffb52a');
  // LED dot mask
  g.fillStyle = 'rgba(0,0,0,0.45)';
  for (let i = 0; i < w; i += 4) g.fillRect(x + i, y, 1, h);
  for (let j = 0; j < h; j += 4) g.fillRect(x, y + j, w, 1);
}

function busFront(g: CanvasRenderingContext2D, r: Rect): void {
  const { x, y, w, h } = r;
  // yellow band under the windshield, black lamp bezels at the corners, MTA roundel in the middle, blue lower edge
  g.fillStyle = '#f5a61c';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#0d0e10';
  g.fillRect(x, y + 6, 56, h - 12);
  g.fillRect(x + w - 56, y + 6, 56, h - 12);
  g.fillStyle = '#0039a6';
  g.fillRect(x, y + h - 5, w, 5);
  g.beginPath();
  g.arc(x + w / 2, y + h / 2, 22, 0, Math.PI * 2);
  g.fill();
  text(g, 'MTA', x + w / 2, y + h / 2 + 1, 18, '#fff', { weight: '900' });
}

function decalBase(g: CanvasRenderingContext2D, r: Rect, color: string): void {
  g.fillStyle = color;
  g.fillRect(r.x, r.y, r.w, r.h);
}

/** paints the atlas for a kind. `seed` varies plates / medallion numbers. */
/** `layout.doorSplit`: u of the B pillar within the door decal band (front door = u < split on the left side) */
export function buildKindAtlas(spec: VehicleSpec, seed = 1, layout: { doorSplit?: number; doorF?: number; doorR?: number } = {}): KindAtlas {
  const [mc, g] = canvas();
  const [ec, e] = canvas();
  e.fillStyle = '#000';
  e.fillRect(0, 0, ATLAS, ATLAS);
  g.fillStyle = '#888';
  g.fillRect(0, 0, ATLAS, ATLAS);

  for (const n of SOLID_NAMES) {
    const s = R.solid[n];
    g.fillStyle = SOLID_COLORS[n];
    g.fillRect(s.x - 8, s.y - 8, s.w + 16, s.h + 16);
  }
  // amber / red / blue solids are used for turn signals & sirens: emissive too
  for (const n of ['amber', 'red', 'blue', 'white'] as SolidName[]) {
    const s = R.solid[n];
    e.fillStyle = SOLID_COLORS[n];
    e.fillRect(s.x - 8, s.y - 8, s.w + 16, s.h + 16);
  }

  const yellowPlate = spec.livery === 'taxi';
  plate(g, R.plateFront, seed, yellowPlate, yellowPlate);
  plate(g, R.plateRear, seed, yellowPlate, yellowPlate);
  grille(g, R.grille);
  headlight(g, R.headlight, e, spec.style === 'taxi' || spec.style === 'sedan' || spec.style === 'suv');
  taillight(g, R.taillight, e, spec.style === 'sedan' || spec.style === 'suv');
  sidewall(g, R.sidewall);
  dash(g, R.dash, e);
  roofSign(g, R.roofSign, e, seed, spec.style === 'taxi');
  lightbar(g, R.lightbar, e);
  busSign(g, R.sign, e);
  busFront(g, R.busFront);

  // wheel face (polar-mapped onto the rim dish): dark pockets, five twin spokes, centre cap, lug nuts
  {
    const s = R.wheelHub;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, rad = s.w / 2;
    g.fillStyle = '#0f1011';
    g.fillRect(s.x, s.y, s.w, s.h);
    const hub = spec.livery === 'taxi' ? 'cover' : spec.livery === 'nypd' ? 'blacksteel' : spec.livery === 'mta' ? 'alcoa' : spec.livery === 'boxtruck' || spec.livery === 'dsny' ? 'truck' : 'alloy';
    const steel = hub === 'cover';
    const spoke = hub === 'blacksteel' ? '#414449' : hub === 'alcoa' ? '#d6d8da' : hub === 'truck' ? '#c9cac7' : steel ? '#c6c9cd' : '#d2d5d9';
    g.save();
    g.translate(cx, cy);
    if (hub === 'blacksteel' || hub === 'alcoa' || hub === 'truck') {
      // solid disc: black steel with five oval vents (police), polished aluminium with hand holes (bus), grey steel (truck)
      g.fillStyle = spoke;
      g.beginPath();
      g.arc(0, 0, rad - 6, 0, Math.PI * 2);
      g.fill();
      const holes = hub === 'blacksteel' ? 5 : 5, hr = hub === 'blacksteel' ? 0.6 : 0.62;
      for (let i = 0; i < holes; i++) {
        const a = (i / holes) * Math.PI * 2 + Math.PI / 2;
        g.save();
        g.translate(Math.cos(a) * rad * hr, Math.sin(a) * rad * hr);
        g.rotate(a);
        g.fillStyle = '#0a0a0b';
        g.beginPath();
        g.ellipse(0, 0, hub === 'blacksteel' ? rad * 0.09 : rad * 0.12, hub === 'blacksteel' ? rad * 0.17 : rad * 0.12, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      if (hub === 'alcoa') {
        g.fillStyle = '#4a4c50';
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          g.beginPath();
          g.arc(Math.cos(a) * rad * 0.33, Math.sin(a) * rad * 0.33, 4, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else if (steel) {
      // plastic wheel cover over a steel wheel: full silver dish with a ring of short slots near the rim
      g.fillStyle = '#b1b3b6';
      g.beginPath();
      g.arc(0, 0, rad - 6, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.save();
        g.translate(Math.cos(a) * rad * 0.66, Math.sin(a) * rad * 0.66);
        g.rotate(a);
        g.fillStyle = '#1a1b1d';
        g.beginPath();
        g.ellipse(0, 0, rad * 0.085, rad * 0.16, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
      g.strokeStyle = '#8f9194';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(0, 0, rad * 0.42, 0, Math.PI * 2);
      g.stroke();
    } else {
      for (let i = 0; i < 5; i++) {
        g.save();
        g.rotate((i / 5) * Math.PI * 2);
        g.fillStyle = spoke;
        g.fillRect(rad * 0.22, -rad * 0.11, rad * 0.7, rad * 0.22);
        g.fillStyle = '#1a1b1d';
        g.fillRect(rad * 0.3, -rad * 0.025, rad * 0.58, rad * 0.05); // twin-spoke slit
        g.restore();
      }
    }
    g.restore();
    // outer rim lip and a shadow ring just inside it
    g.strokeStyle = hub === 'blacksteel' ? '#2c2d30' : '#c0c2c5';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(cx, cy, rad - 4, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, rad - 9, 0, Math.PI * 2);
    g.stroke();
    // centre cap + lug nuts (a small chrome cap on the police steelie, a dark hub on the truck wheels)
    g.fillStyle = hub === 'blacksteel' ? '#c8cacc' : hub === 'alcoa' || hub === 'truck' ? '#3a3b3e' : spoke;
    g.beginPath();
    g.arc(cx, cy, hub === 'blacksteel' ? rad * 0.22 : rad * 0.29, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#3c3d40';
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = hub === 'blacksteel' ? '#8e9094' : '#35363a';
    const lugs = hub === 'alcoa' ? 0 : hub === 'truck' ? 6 : 5;
    for (let i = 0; i < lugs; i++) {
      const a = (i / lugs) * Math.PI * 2 + Math.PI / lugs;
      g.beginPath();
      g.arc(cx + Math.cos(a) * rad * (hub === 'blacksteel' ? 0.24 : 0.17), cy + Math.sin(a) * rad * (hub === 'blacksteel' ? 0.24 : 0.17), 2.5, 0, Math.PI * 2);
      g.fill();
    }
    // radial shading: pockets get darker toward the barrel
    const shade = g.createRadialGradient(cx, cy, rad * 0.3, cx, cy, rad);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = shade;
    g.fillRect(s.x, s.y, s.w, s.h);
  }
  // tread: dark with grooves (tiled once around; also used as a color break)
  {
    const s = R.tread;
    g.fillStyle = '#141516';
    g.fillRect(s.x, s.y, s.w, s.h);
    g.fillStyle = '#0a0a0b';
    for (let i = 0; i < 3; i++) g.fillRect(s.x, s.y + 22 + i * 40, s.w, 8);
    for (let j = 0; j < s.h; j += 12) g.fillRect(s.x, s.y + j, s.w, 2);
  }

  // rear roll-up door (trucks): aluminium slats, a latch bar, road grime creeping up from the sill, scuffs
  {
    const s = R.rearDoor;
    g.fillStyle = '#d6d6d2';
    g.fillRect(s.x, s.y, s.w, s.h);
    for (let j = 0; j < s.h; j += 11) {
      g.fillStyle = '#b4b4b0';
      g.fillRect(s.x, s.y + j, s.w, 2);
      g.fillStyle = '#e4e4e0';
      g.fillRect(s.x, s.y + j + 2, s.w, 1);
    }
    const grime = g.createLinearGradient(0, s.y + s.h - 46, 0, s.y + s.h);
    grime.addColorStop(0, 'rgba(60,52,44,0)');
    grime.addColorStop(1, 'rgba(60,52,44,0.6)');
    g.fillStyle = grime;
    g.fillRect(s.x, s.y + s.h - 46, s.w, 46);
    g.fillStyle = 'rgba(40,36,32,0.35)';
    for (let i = 0; i < 9; i++) g.fillRect(s.x + 12 + i * 28 + (i % 3) * 5, s.y + s.h - 30 - (i % 4) * 6, 3 + (i % 2) * 2, 30);
    g.fillStyle = '#55554f';
    g.fillRect(s.x + s.w / 2 - 22, s.y + s.h - 22, 44, 8);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 6; i++) g.fillRect(s.x + 20 + i * 38, s.y + 30 + (i % 3) * 25, 14, 1);
  }

  // liveries
  const paintHex = '#' + spec.colors[0][0].toString(16).padStart(6, '0');
  switch (spec.livery) {
    case 'taxi':
    case 'borotaxi': {
      const base = paintHex; // exactly the same yellow/green as the instanced body paint
      const med = medallion(seed);
      const split = layout.doorSplit ?? 0.55;
      const heavy = { weight: '900', family: '"Arial Black", "Helvetica Neue", Arial, sans-serif' };
      // 2012 livery: "NYC (T)AXI" wordmark on the front door; medallion number and the rate card on the rear door.
      // The band covers both doors, front at u=0 on the left side and u=1 on the right side.
      for (const [r, right] of [[R.decalL, false], [R.decalR, true]] as [Rect, boolean][]) {
        decalBase(g, r, base);
        const xB = r.x + r.w * (right ? 1 - split : split);
        const fc = right ? (xB + r.x + r.w) / 2 : (r.x + xB) / 2; // front door centre
        const rc = right ? (r.x + xB) / 2 : (xB + r.x + r.w) / 2; // rear door centre
        const yLogo = r.y + r.h * 0.5;
        text(g, 'NYC', fc - 64, yLogo, 34, '#111', heavy);
        g.fillStyle = '#111';
        g.beginPath();
        g.arc(fc, yLogo, 19, 0, Math.PI * 2);
        g.fill();
        text(g, 'T', fc, yLogo + 1, 27, base, heavy);
        text(g, spec.livery === 'taxi' ? 'AXI' : 'AXI', fc + 60, yLogo, 34, '#111', heavy);
        if (spec.livery === 'borotaxi') text(g, 'BORO', fc, yLogo + 34, 16, '#111', { weight: '800' });
        // rear door: medallion number high, rate card sticker (white) below it
        text(g, med, rc, r.y + 56, 56, '#111', { weight: '800', family: 'Arial, "Helvetica Neue", sans-serif' });
        g.fillStyle = '#f2f2ee';
        rr(g, rc - 50, r.y + 118, 100, 54, 3);
        g.fill();
        g.fillStyle = '#1b1b1b';
        g.fillRect(rc - 46, r.y + 122, 92, 9);
        text(g, 'RATE OF FARE', rc, r.y + 127, 7, '#fff', { weight: '800' });
        g.fillStyle = '#333';
        for (let i = 0; i < 5; i++) g.fillRect(rc - 44, r.y + 137 + i * 7, 60 + (i % 3) * 10, 2);
        g.fillRect(rc - 44, r.y + 165, 88, 3);
      }
      // hood: medallion number
      decalBase(g, R.hoodDecal, base);
      break;
    }
    case 'nypd': {
      // 2017+ Explorer livery: wide blue stripe fender-to-tail with white pinstripes, "NYPD" in white on the front
      // door, unit number over / "POLICE" under the stripe on the rear door, the motto on the rear quarter.
      // The band is 3.5 m x 0.48 m on 512 x 192 px, so glyphs are drawn ~0.4x wide to read upright.
      const blue = '#1d4b9e';
      const uF = layout.doorF ?? 0.11, uB = layout.doorSplit ?? 0.42, uR = layout.doorR ?? 0.58;
      const unit = fleetNumber(seed, 1000, 8999);
      for (const [r, flip] of [[R.decalL, false], [R.decalR, true]] as [Rect, boolean][]) {
        decalBase(g, r, '#f4f4f2');
        const X = (u: number) => r.x + r.w * (flip ? 1 - u : u);
        const Y = (v: number) => r.y + r.h * (1 - v);
        g.fillStyle = blue;
        g.fillRect(r.x, Y(0.7), r.w, Y(0.24) - Y(0.7));
        g.fillStyle = '#f4f4f2';
        g.fillRect(r.x, Y(0.66), r.w, 2);
        g.fillRect(r.x, Y(0.29), r.w, 2);
        text(g, 'NYPD', X((uF + uB) / 2), Y(0.47) + 2, 92, '#ffffff', { weight: '900', stretch: 0.5, family: 'Arial, "Helvetica Neue", sans-serif' });
        text(g, unit, X((uB + uR) / 2), Y(0.83), 50, blue, { weight: '800', stretch: 0.4 });
        text(g, 'POLICE', X((uB + uR) / 2), Y(0.12), 44, blue, { weight: '800', stretch: 0.42 });
        text(g, 'COURTESY  PROFESSIONALISM  RESPECT', X((uR + 1) / 2), Y(0.84), 24, blue, { weight: '700', stretch: 0.38 });
      }
      decalBase(g, R.hoodDecal, '#f4f4f2');
      text(g, 'NYPD', R.hoodDecal.x + R.hoodDecal.w / 2, R.hoodDecal.y + R.hoodDecal.h / 2 + 2, 52, blue, { weight: '900', stretch: 1.15 });
      decalBase(g, R.roofDecal, '#f4f4f2');
      text(g, unit, R.roofDecal.x + R.roofDecal.w / 2, R.roofDecal.y + R.roofDecal.h / 2 + 2, 54, blue, { weight: '800', stretch: 1.1 });
      break;
    }
    case 'mta': {
      // NYCT XD40 scheme: white body, deep blue skirt band with the gold stripe over it, "MTA New York City Bus"
      // in the white above, fleet number on the band. The side is 12.2 m x 0.82 m on 1024 x 256 px (0.27x glyphs).
      const s = R.boxSide, blue = '#0039a6', gold = '#f5a61c';
      const Y = (v: number) => s.y + s.h * (1 - v);
      decalBase(g, s, '#f4f6f8');
      g.fillStyle = blue;
      g.fillRect(s.x, Y(0.6), s.w, Y(0.08) - Y(0.6));
      g.fillStyle = gold;
      g.fillRect(s.x, Y(0.68), s.w, Y(0.6) - Y(0.68));
      g.fillStyle = '#c9ccd1';
      g.fillRect(s.x, Y(0.08), s.w, Y(0) - Y(0.08));
      const num = fleetNumber(seed, 4000, 5999);
      for (const u of [0.07, 0.93]) text(g, num, s.x + s.w * u, Y(0.34), 56, '#ffffff', { weight: '800', stretch: 0.28 });
      for (const u of [0.42, 0.58]) {
        g.fillStyle = blue;
        g.beginPath();
        g.ellipse(s.x + s.w * u - (u < 0.5 ? 36 : -36), Y(0.84), 13, 40, 0, 0, Math.PI * 2);
        g.fill();
        text(g, 'MTA', s.x + s.w * u - (u < 0.5 ? 36 : -36), Y(0.84) + 2, 30, '#fff', { weight: '900', stretch: 0.3 });
        text(g, 'New York City Bus', s.x + s.w * u + (u < 0.5 ? 60 : -60), Y(0.84) + 2, 46, blue, { weight: '700', stretch: 0.27, family: 'Helvetica, Arial, sans-serif' });
      }
      // wheelchair pictogram by the front door on both ends
      for (const u of [0.15, 0.85]) {
        g.fillStyle = '#1a62c8';
        rr(g, s.x + s.w * u - 9, Y(0.98), 18, 52, 3);
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(s.x + s.w * u, Y(0.82), 5, 14, 0, 0.4, Math.PI * 1.6);
        g.stroke();
      }
      decalBase(g, R.decalL, '#f4f6f8');
      decalBase(g, R.decalR, '#f4f6f8');
      break;
    }
    case 'boxtruck': {
      // 4.9 m x 2.4 m box on 1024 x 256 px (glyphs 1.95x wide): FRP panel seams with rivets, a strapped canvas
      // banner with a generic mover's name, road grime rising from the rub rail, scuffs and rust streaks
      const s = R.boxSide;
      decalBase(g, s, '#e8e7e2');
      for (let i = 0; i <= 8; i++) {
        const px = s.x + Math.round((s.w * i) / 8);
        g.fillStyle = '#cfceC8';
        g.fillRect(px - 1, s.y, 2, s.h);
        g.fillStyle = '#b9b8b2';
        for (let j = 6; j < s.h; j += 12) g.fillRect(px - 2, s.y + j, 4, 2);
      }
      g.fillStyle = '#f0ede3';
      rr(g, s.x + 150, s.y + 44, s.w - 300, 132, 4);
      g.fill();
      g.strokeStyle = '#8a877c';
      g.lineWidth = 2;
      g.stroke();
      const wrinkle = g.createLinearGradient(s.x + 150, 0, s.x + s.w - 150, 0);
      for (let i = 0; i <= 12; i++) wrinkle.addColorStop(i / 12, i % 2 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)');
      g.fillStyle = wrinkle;
      g.fillRect(s.x + 150, s.y + 44, s.w - 300, 132);
      g.fillStyle = '#4b4a45';
      for (let i = 0; i < 14; i++) {
        const gx = s.x + 158 + ((s.w - 316) * i) / 13;
        g.beginPath();
        g.arc(gx, s.y + 52, 3, 0, Math.PI * 2);
        g.arc(gx, s.y + 168, 3, 0, Math.PI * 2);
        g.fill();
      }
      text(g, 'EMPIRE CITY MOVING & STORAGE', s.x + s.w / 2, s.y + 92, 40, '#1e3a5f', { weight: '900', family: 'Impact, "Arial Black", sans-serif', stretch: 1.6 });
      text(g, 'LOCAL  •  LONG DISTANCE  •  (212) 555-0164', s.x + s.w / 2, s.y + 140, 19, '#b23a2f', { weight: '700', stretch: 1.7 });
      const grime = g.createLinearGradient(0, s.y + s.h - 58, 0, s.y + s.h);
      grime.addColorStop(0, 'rgba(62,54,44,0)');
      grime.addColorStop(0.6, 'rgba(62,54,44,0.32)');
      grime.addColorStop(1, 'rgba(50,44,36,0.62)');
      g.fillStyle = grime;
      g.fillRect(s.x, s.y + s.h - 58, s.w, 58);
      g.fillStyle = 'rgba(45,40,34,0.28)';
      for (let i = 0; i < 26; i++) g.fillRect(s.x + 14 + i * 39 + (i % 4) * 6, s.y + s.h - 40 - (i % 5) * 5, 4 + (i % 3) * 3, 40);
      g.fillStyle = 'rgba(120,80,40,0.35)';
      for (let i = 0; i < 9; i++) g.fillRect(s.x + Math.round((s.w * i) / 8) - 1, s.y + s.h - 70 + (i % 3) * 10, 2, 18);
      g.fillStyle = 'rgba(255,255,255,0.4)';
      for (let i = 0; i < 12; i++) g.fillRect(s.x + 30 + i * 80, s.y + s.h - 26 - (i % 3) * 8, 26, 1);
      g.fillStyle = 'rgba(40,40,40,0.25)';
      for (let i = 0; i < 6; i++) g.fillRect(s.x + 70 + i * 160, s.y + s.h - 20 - (i % 2) * 6, 40, 2);
      decalBase(g, R.decalL, '#f2f2ee');
      decalBase(g, R.decalR, '#f2f2ee');
      break;
    }
    case 'van': {
      decalBase(g, R.boxSide, paintHex);
      decalBase(g, R.decalL, paintHex);
      decalBase(g, R.decalR, paintHex);
      // subtle panel lines only, no brand
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(R.boxSide.x, R.boxSide.y + 120, R.boxSide.w, 3);
      break;
    }
    case 'dsny': {
      const s = R.boxSide;
      decalBase(g, s, '#f0f0ec');
      g.fillStyle = '#1e6b3a';
      g.fillRect(s.x, s.y + 60, s.w, 26);
      g.fillStyle = '#1c4e9e';
      g.fillRect(s.x, s.y + 90, s.w, 10);
      text(g, 'DSNY', s.x + 220, s.y + 170, 110, '#1e6b3a', { weight: '900', family: 'Impact, "Arial Black", sans-serif' });
      text(g, 'NEW YORK CITY  •  DEPARTMENT OF SANITATION', s.x + 690, s.y + 150, 30, '#1c4e9e', { weight: '800' });
      text(g, "NEW YORK'S STRONGEST", s.x + 690, s.y + 195, 26, '#1e6b3a', { weight: '700' });
      decalBase(g, R.decalL, '#f0f0ec');
      decalBase(g, R.decalR, '#f0f0ec');
      break;
    }
    default: {
      decalBase(g, R.decalL, '#ffffff');
      decalBase(g, R.decalR, '#ffffff');
      decalBase(g, R.boxSide, '#ffffff');
      decalBase(g, R.hoodDecal, '#ffffff');
    }
  }

  const map = new THREE.CanvasTexture(mc);
  map.name = `vehicle-${spec.id}-livery-atlas`;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  const emissive = new THREE.CanvasTexture(ec);
  emissive.name = `vehicle-${spec.id}-emissive-atlas`;
  emissive.colorSpace = THREE.SRGBColorSpace;
  emissive.anisotropy = 4;
  return {
    map,
    emissive,
    taxiBody: spec.style === 'taxi',
    dispose() {
      map.dispose();
      emissive.dispose();
    },
  };
}
