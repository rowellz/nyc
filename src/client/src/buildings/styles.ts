/**
 * Per-style facade parameters. Shared by the CPU baker (window grid for AC units / balconies / stoops)
 * and the facade shader (uniform table). Real NYC dimensions.
 */
import type { Building, FacadeStyle } from '@shared/world';
import { hash4 } from './hash';

export const STYLE_IDS: Record<FacadeStyle, number> = {
  brick: 0,
  brownstone: 1,
  limestone: 2,
  castiron: 3,
  'prewar-office': 4,
  glass: 5,
  concrete: 6,
  'modern-brick': 7,
  industrial: 8,
  civic: 9,
  shed: 10,
};
export const STYLE_COUNT = 11;

/** Metres per masonry unit (including its joint), independent of floor/bay dimensions. */
export const MASONRY = {
  brick: [0.203, 0.067],
  stone: [0.6, 0.3],
  cmu: [0.4, 0.2],
} as const;

export interface StyleParams {
  floorH: number; // typical floor-to-floor, m
  gfResidential: number; // ground floor height when not commercial
  gfCommercial: number; // ground floor height with a storefront / lobby
  winW: number; // window width, m
  winH: number; // window height, m
  spacing: number; // window column spacing (centre to centre), m
  sill: number; // sill height above the floor line, m
  litFrac: number; // fraction of windows lit at night
  base: number; // 0 brick, 1 stone, 2 concrete, 3 painted cast iron, 4 curtain wall, 5 corrugated/cmu, 6 brownstone
  cornice: number; // 0 none, 1 light bracketed (tenement), 2 heavy stone, 3 cast iron, 4 brick corbel
  rustication: number; // floors of rusticated stone at the base
  acFrac: number; // fraction of windows with an AC unit
}

export const STYLES: StyleParams[] = [
  /* brick        */ { floorH: 3.2, gfResidential: 3.6, gfCommercial: 4.3, winW: 1.0, winH: 1.75, spacing: 2.3, sill: 0.75, litFrac: 0.3, base: 0, cornice: 1, rustication: 0, acFrac: 0.25 },
  /* brownstone   */ { floorH: 3.4, gfResidential: 1.7, gfCommercial: 1.7, winW: 1.1, winH: 2.3, spacing: 1.9, sill: 0.7, litFrac: 0.3, base: 6, cornice: 1, rustication: 0, acFrac: 0.15 },
  /* limestone    */ { floorH: 3.4, gfResidential: 4.6, gfCommercial: 4.8, winW: 1.3, winH: 1.9, spacing: 2.6, sill: 0.85, litFrac: 0.3, base: 1, cornice: 2, rustication: 2, acFrac: 0.05 },
  /* castiron     */ { floorH: 4.2, gfResidential: 4.8, gfCommercial: 5.0, winW: 2.0, winH: 2.9, spacing: 2.7, sill: 0.6, litFrac: 0.3, base: 3, cornice: 3, rustication: 0, acFrac: 0.0 },
  /* prewar-office*/ { floorH: 3.9, gfResidential: 5.2, gfCommercial: 5.5, winW: 1.4, winH: 2.1, spacing: 2.6, sill: 0.9, litFrac: 0.25, base: 1, cornice: 2, rustication: 2, acFrac: 0.0 },
  /* glass        */ { floorH: 3.9, gfResidential: 5.5, gfCommercial: 5.5, winW: 1.5, winH: 2.6, spacing: 1.5, sill: 0.9, litFrac: 0.35, base: 4, cornice: 0, rustication: 0, acFrac: 0.0 },
  /* concrete     */ { floorH: 3.3, gfResidential: 4.2, gfCommercial: 4.5, winW: 1.8, winH: 1.6, spacing: 3.0, sill: 0.9, litFrac: 0.35, base: 2, cornice: 0, rustication: 0, acFrac: 0.1 },
  /* modern-brick */ { floorH: 3.0, gfResidential: 3.8, gfCommercial: 4.2, winW: 1.5, winH: 1.5, spacing: 3.2, sill: 0.8, litFrac: 0.35, base: 0, cornice: 0, rustication: 0, acFrac: 0.2 },
  /* industrial   */ { floorH: 4.0, gfResidential: 4.5, gfCommercial: 4.5, winW: 2.2, winH: 2.4, spacing: 3.5, sill: 1.0, litFrac: 0.1, base: 0, cornice: 4, rustication: 0, acFrac: 0.05 },
  /* civic        */ { floorH: 4.5, gfResidential: 6.0, gfCommercial: 6.0, winW: 1.6, winH: 3.0, spacing: 3.4, sill: 1.2, litFrac: 0.1, base: 1, cornice: 2, rustication: 1, acFrac: 0.0 },
  /* shed         */ { floorH: 3.0, gfResidential: 3.0, gfCommercial: 3.0, winW: 0.8, winH: 0.8, spacing: 3.0, sill: 1.4, litFrac: 0.05, base: 5, cornice: 0, rustication: 0, acFrac: 0.0 },
];

/** styles whose windows belong to workplaces: lit by the office hour ramp, floor-coherent */
export const OFFICE_STYLES: ReadonlySet<number> = new Set([4, 5, 9]);

/**
 * Window-light hour ramp (docs/ART_DIRECTION.md §2 Night): multiplier on `litFrac`, which is the 22:30 value.
 * Residential: ×0.4 at 18:00, peak 21–23 h, ×0.3 at 03:00. Offices: ×1.2 at 18–19 h, then falling to ×0.3 at 03:00.
 * Piecewise linear over 24 hourly keys (index = hour, wraps at 24).
 */
const RAMP_RESIDENTIAL = [0.8, 0.55, 0.4, 0.3, 0.3, 0.4, 0.55, 0.45, 0.25, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.4, 0.7, 0.9, 1.0, 1.0, 1.0];
const RAMP_OFFICE = [0.65, 0.5, 0.4, 0.3, 0.3, 0.35, 0.5, 0.8, 1.1, 1.15, 1.15, 1.15, 1.15, 1.15, 1.15, 1.15, 1.15, 1.2, 1.2, 1.2, 1.1, 1.05, 1.0, 0.85];
/** hard cap on the lit fraction after the ramp: a fully lit facade never happens */
export const MAX_LIT_FRAC = 0.85;

export function litRamp(hour: number, office: boolean): number {
  const r = office ? RAMP_OFFICE : RAMP_RESIDENTIAL;
  const h = ((hour % 24) + 24) % 24;
  const i = Math.floor(h), f = h - i;
  return r[i] * (1 - f) + r[(i + 1) % 24] * f;
}

/** per-style lit fraction at an hour (after the ramp and cap) */
export function litFracAt(style: number, hour: number): number {
  return Math.min(MAX_LIT_FRAC, STYLES[style].litFrac * litRamp(hour, OFFICE_STYLES.has(style)));
}

/** refresh the hour-ramp slot of the shader style table (slot 10 = lit multiplier). Returns true when it changed. */
export function updateLitRamp(table: Float32Array, hour: number): boolean {
  let changed = false;
  for (let i = 0; i < STYLE_COUNT; i++) {
    const base = STYLES[i].litFrac;
    const mul = base > 0 ? litFracAt(i, hour) / base : 0;
    const o = i * 12 + 10;
    if (Math.abs(table[o] - mul) > 1e-4) { table[o] = mul; changed = true; }
  }
  return changed;
}

/** flattened style table for the shader: 3 vec4 per style */
export function styleUniformTable(): Float32Array {
  const out = new Float32Array(STYLE_COUNT * 12);
  for (let i = 0; i < STYLE_COUNT; i++) {
    const s = STYLES[i];
    const o = i * 12;
    out[o + 0] = s.floorH;
    out[o + 1] = s.winW;
    out[o + 2] = s.winH;
    out[o + 3] = s.spacing;
    out[o + 4] = s.sill;
    out[o + 5] = s.litFrac;
    out[o + 6] = s.base;
    out[o + 7] = s.rustication;
    out[o + 8] = s.cornice;
    out[o + 9] = s.acFrac;
    out[o + 10] = 1; // lit-fraction hour multiplier (updateLitRamp)
    out[o + 11] = 0;
  }
  return out;
}

export function styleId(style: FacadeStyle | string | undefined): number {
  return STYLE_IDS[style as FacadeStyle] ?? 0;
}

/** PLUTO: ground-floor retail / lobby likely */
export function isCommercial(b: Building): boolean {
  const lu = b.landUse ?? '';
  const c = (b.bldgClass ?? '')[0] ?? '';
  if (lu === '04' || lu === '05') return true;
  if (c === 'K' || c === 'O' || c === 'S' || c === 'H') return true;
  if (c === 'R' && lu === '04') return true;
  return false;
}

/** wall flag bits (aWall.y) */
export const FLAG_STREET = 1;
export const FLAG_COMMERCIAL = 2;
export const FLAG_PAINTED = 4;
export const FLAG_METAL = 8; // trims: metallic
export const FLAG_BALCONIES = 16;
export const FLAG_DENTILS = 32; // trims: cornice dentil band
export const FLAG_RESIDENTIAL_DOOR = 64;
export const FLAG_TEXT0 = 128; // signs: 2 bits of text colour
export const FLAG_TEXT1 = 256;
export const FLAG_SETBACK_TIER = 512; // wall belongs to an upper tier
export const FLAG_LOUVRE = 256; // trims: horizontal louvre slats (rooftop mechanical screens)
/** wall index is stored above bit 10 */
export const FLAG_WALL_SHIFT = 1024;

/** vertex kinds (aWall.w) */
export const KIND_WALL = 0;
export const KIND_ROOF = 1;
export const KIND_TRIM = 2;
export const KIND_LIGHTBOX = 3;
export const KIND_AWNING = 4;
export const KIND_BEACON = 5;
export const KIND_GLASS = 6; // plain glazing prop (storefront doors etc.)

/**
 * Sign atlas layout (signs.ts draws it, material.ts passes the total as uSignRows).
 * Rows [0, SIGN_NAME_ROWS) are shop names in a real typeface; the rows after them are neon accent artwork
 * (stroked tube lettering and a squiggle) that the night storefront hangs inside the glass on ~20 % of shops
 * — docs/ART_DIRECTION.md §2 Night, "a few red/blue neon squiggles". Kept here so the shader can bake both
 * counts as constants without importing the baker.
 */
export const SIGN_NAME_ROWS = 16;
export const SIGN_NEON_ROWS = 6;

/** Per-building derived parameters (CPU side; the shader receives them per vertex). */
export interface BuildingParams {
  style: number;
  seed: number; // 0..65535
  floorH: number; // fitted to the PLUTO floor count when sane
  gfH: number; // ground floor height
  commercial: boolean;
  painted: boolean;
  balconies: boolean;
  tint: [number, number, number];
}

// weighted toward red/brown: LES / Village walk-ups are mostly red or brown brick, tan/buff is the minority
const BRICK_PALETTE: [number, number, number][] = [
  [0.58, 0.29, 0.21], // classic red
  [0.62, 0.34, 0.24],
  [0.55, 0.3, 0.24], // brownish red
  [0.66, 0.42, 0.28], // orange-red
  [0.5, 0.27, 0.2], // dark red
  [0.45, 0.26, 0.2], // dark brown
  [0.6, 0.36, 0.26], // red-orange
  [0.7, 0.56, 0.4], // tan
  [0.66, 0.5, 0.36], // buff
  [0.52, 0.3, 0.22], // sooty red
];
const PAINT_PALETTE: [number, number, number][] = [
  [0.86, 0.85, 0.8], // off-white
  [0.55, 0.55, 0.55], // gray
  [0.5, 0.18, 0.14], // painted red
  [0.2, 0.32, 0.26], // dark green
  [0.25, 0.25, 0.28], // charcoal
  [0.78, 0.7, 0.55], // cream
];
const STONE_PALETTE: [number, number, number][] = [
  [0.78, 0.74, 0.65],
  [0.72, 0.68, 0.6],
  [0.82, 0.78, 0.7],
  [0.7, 0.66, 0.6],
  [0.75, 0.68, 0.56], // warm terracotta-ish
];
// chocolate Portland / Connecticut sandstone under a century of soot (stoops-1, upper-west 1): the pale tan
// entries are the recently restored fronts
const BROWNSTONE_PALETTE: [number, number, number][] = [
  [0.27, 0.17, 0.12],
  [0.32, 0.2, 0.15],
  [0.38, 0.25, 0.18],
  [0.24, 0.15, 0.11],
  [0.3, 0.19, 0.14],
  [0.42, 0.28, 0.2],
];
// painted row-house fronts: grey, cream, oxblood, white, a dark red-brown (upper-west 1)
const BROWNSTONE_PAINT: [number, number, number][] = [
  [0.52, 0.5, 0.46],
  [0.8, 0.72, 0.58],
  [0.4, 0.13, 0.1],
  [0.86, 0.85, 0.8],
  [0.36, 0.22, 0.18],
];
const CASTIRON_PALETTE: [number, number, number][] = [
  [0.86, 0.84, 0.78], // cream
  [0.9, 0.9, 0.88], // white
  [0.6, 0.62, 0.6], // gray
  [0.32, 0.4, 0.36], // green-gray
  [0.42, 0.36, 0.3], // brown
  [0.22, 0.24, 0.26], // black
];
const GLASS_PALETTE: [number, number, number][] = [
  [0.45, 0.6, 0.72], // blue
  [0.5, 0.66, 0.62], // green
  [0.55, 0.45, 0.32], // bronze
  [0.5, 0.55, 0.6], // gray
  [0.42, 0.55, 0.7],
  [0.3, 0.32, 0.34], // dark
];
const CONCRETE_PALETTE: [number, number, number][] = [
  [0.62, 0.6, 0.56],
  [0.7, 0.66, 0.58], // tan precast
  [0.55, 0.54, 0.52],
  [0.66, 0.62, 0.55],
];
const MODERN_BRICK_PALETTE: [number, number, number][] = [
  [0.6, 0.32, 0.24],
  [0.7, 0.55, 0.4], // tan
  [0.5, 0.3, 0.24],
  [0.64, 0.42, 0.3],
  [0.75, 0.7, 0.62], // light
];

function pick(p: [number, number, number][], t: number): [number, number, number] {
  return p[Math.min(p.length - 1, Math.floor(t * p.length))];
}

export function buildingParams(b: Building, seed: number): BuildingParams {
  // Small footprint area is not evidence of a utility shed. The source classifier
  // mislabels narrow, multi-storey mixed-use row houses (e.g. BIN 1011200).
  const occupiedRowHouse = b.style === 'shed' && b.height >= 8 && (b.floors ?? 0) >= 3
    && /^[ABCDS]/.test(b.bldgClass ?? '');
  const style = styleId(occupiedRowHouse ? ((b.year ?? 1900) < 1945 ? 'brick' : 'modern-brick') : b.style);
  const st = STYLES[style];
  const commercial = isCommercial(b) || (style === 0 && hash4(seed, 11) < 0.25);
  let gfH = commercial ? st.gfCommercial : st.gfResidential;
  const h = Math.max(3, b.height);
  if (h < gfH + 2.4) gfH = h; // one-storey building
  let floorH = st.floorH;
  const floors = b.floors && b.floors > 1 ? b.floors : 0;
  if (floors && style !== 1) {
    const fitted = (h - gfH) / (floors - 1);
    if (fitted >= 2.5 && fitted <= 5.5) floorH = fitted;
  }
  const t = hash4(seed, 1);
  const t2 = hash4(seed, 2);
  let painted = false;
  let tint: [number, number, number];
  switch (style) {
    case 0:
      painted = t2 < 0.12;
      tint = painted ? pick(PAINT_PALETTE, t) : pick(BRICK_PALETTE, t);
      break;
    case 1:
      // a quarter of the Village / UWS row houses are painted or stuccoed over the sandstone
      painted = t2 < 0.25;
      tint = painted ? pick(BROWNSTONE_PAINT, t) : pick(BROWNSTONE_PALETTE, t);
      break;
    case 2:
    case 4:
    case 9:
      tint = pick(STONE_PALETTE, t);
      break;
    case 3:
      tint = pick(CASTIRON_PALETTE, t);
      painted = true;
      break;
    case 5:
      tint = pick(GLASS_PALETTE, t);
      break;
    case 6:
      tint = pick(CONCRETE_PALETTE, t);
      break;
    case 7:
      tint = pick(MODERN_BRICK_PALETTE, t);
      break;
    case 8:
      painted = t2 < 0.3;
      tint = painted ? pick(PAINT_PALETTE, t) : pick(BRICK_PALETTE, t);
      break;
    default:
      tint = [0.6, 0.6, 0.58];
  }
  // per-building value shift
  const v = 0.9 + hash4(seed, 3) * 0.2;
  tint = [Math.min(1, tint[0] * v), Math.min(1, tint[1] * v), Math.min(1, tint[2] * v)];
  const balconies = style === 7 && hash4(seed, 7) < 0.5;
  return { style, seed, floorH, gfH, commercial, painted, balconies, tint };
}

/** window column layout for a wall; identical to the shader's */
export function windowColumns(style: number, wallLen: number): { count: number; offset: number; spacing: number } {
  const st = STYLES[style];
  const spacing = st.spacing;
  const margin = style === 5 ? 0 : 0.7;
  const count = Math.max(0, Math.floor((wallLen - 2 * margin) / spacing));
  const offset = (wallLen - count * spacing) * 0.5;
  return { count, offset, spacing };
}

/** floor index -> floor base height (m). Brownstone: basement 0..1.7, parlour 1.7..(1.7+3.8), then floorH */
export function floorBase(style: number, fl: number, gfH: number, floorH: number): number {
  if (style === 1) {
    if (fl === 0) return 0;
    if (fl === 1) return 1.7;
    return 1.7 + 3.8 + (fl - 2) * floorH;
  }
  if (fl === 0) return 0;
  return gfH + (fl - 1) * floorH;
}
export function floorHeightOf(style: number, fl: number, gfH: number, floorH: number): number {
  if (style === 1) return fl === 0 ? 1.7 : fl === 1 ? 3.8 : floorH;
  return fl === 0 ? gfH : floorH;
}

/** Upper-storey punched opening, matching shadeWall (before balcony overrides). */
export function windowOpening(style: number, fl: number, gfH: number, floorH: number, top: number): { bottom: number; top: number; width: number } | null {
  const st = STYLES[style];
  const fb = floorBase(style, fl, gfH, floorH);
  const fh = floorHeightOf(style, fl, gfH, floorH);
  const parlour = style === 1 && fl === 1;
  const bottom = fb + (parlour ? 0.6 : st.sill);
  const head = Math.min(parlour ? fb + 3.35 : bottom + st.winH, fb + fh - 0.12);
  // walk-ups keep the top floor clear of the bracketed cornice (0.9 m deep below the parapet)
  if (fl < 1 || head >= top - (style === 0 || style === 1 ? 0.6 : 0.35) || head - bottom <= 0.5) return null;
  return { bottom, top: head, width: parlour ? 1.15 : st.winW };
}
