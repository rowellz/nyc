/**
 * Appearance generation: a wardrobe of NYC street archetypes (silhouette + fabric + palette), deterministic
 * from a seed so every client renders the same remote player the same way.
 *
 * The list below is a fixed library rather than a combinatorial roll: `buildBody` caches one geometry per
 * distinct body-parameter object, so an open-ended combination space would mean a geometry per pedestrian.
 * Everything that varies per person after that - colours, fabric roughness, height, build, hair and skin -
 * is a uniform, and costs nothing.
 *
 * `setCrowdConditions` carries the two street facts that change what people wear: rain (umbrellas come out)
 * and night (more outer layers, fewer bare arms). Both come from the shared world clock and weather, so the
 * result is still identical on every client.
 */
import type { Appearance } from './animator';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
import type { BodyParams } from './rig';
import { FABRIC } from './materials';
import { BAG_COLORS, COAT_COLORS, DENIM_COLORS, HAIR_COLORS, HAT_COLORS, JACKET_COLORS, PANTS_COLORS, SHOE_COLORS, SKIN_TONES, SUIT_COLORS, TIGHTS_COLORS, TOP_COLORS } from './materials';

export interface CrowdConditions {
  /** umbrellas up, no bare arms */
  rain: boolean;
  /** after dark: outer layers instead of tees */
  night: boolean;
}
const conditions: CrowdConditions = { rain: false, night: false };
/** Street conditions shared by every client (server weather + world clock), so appearance stays deterministic. */
export function setCrowdConditions(next: Partial<CrowdConditions>): void {
  if (next.rain !== undefined) conditions.rain = next.rain;
  if (next.night !== undefined) conditions.night = next.night;
}

type Fabric = number;
type Kind = 'street' | 'office' | 'suit' | 'athletic' | 'tourist' | 'hivis' | 'delivery' | 'police' | 'doorman' | 'scrubs';

interface Archetype {
  /** relative frequency on a Midtown sidewalk */
  w: number;
  /** raised in the rain / after dark, lowered in the sun */
  cold?: number;
  body: Partial<BodyParams>;
  kind: Kind;
  /** outer / shirt / trouser fabric */
  fab: [Fabric, Fabric, Fabric];
}

const female = { shoulders: 0.9, hips: 1.11, chest: 1.07 };
const male = { shoulders: 1.0, hips: 1.0, chest: 1.0 };

/**
 * The wardrobe. Silhouette first: a topcoat to the knee, a down jacket's loft, a blazer's lapels, a skirt
 * over tights and a hi-vis vest are all different shapes at fifty metres, which is what a photograph of a
 * New York sidewalk actually has and a crowd of tee-shirts does not.
 */
export const WARDROBE: Archetype[] = [
  // ---- men, everyday ---------------------------------------------------------------------------
  { w: 9, cold: 2.2, kind: 'office', fab: [FABRIC.wool, FABRIC.cotton, FABRIC.wool],
    body: { ...male, build: 0.35, sleeves: 'long', legs: 'long', hair: 'short', jacket: 'overcoat', bag: false, backpack: false, beard: true } },
  { w: 7, cold: 2.4, kind: 'street', fab: [FABRIC.nylon, FABRIC.cotton, FABRIC.denim],
    body: { ...male, build: 0.45, sleeves: 'long', legs: 'long', hair: 'fade', jacket: 'puffer', headwear: 'beanie', bag: false, backpack: true } },
  { w: 6, cold: 0.6, kind: 'suit', fab: [FABRIC.wool, FABRIC.cotton, FABRIC.wool],
    body: { ...male, build: 0.3, sleeves: 'long', legs: 'long', hair: 'short', jacket: 'blazer', tie: true, bag: true, backpack: false } },
  { w: 6, cold: 1.4, kind: 'street', fab: [FABRIC.knit, FABRIC.cotton, FABRIC.denim],
    body: { ...male, build: 0.4, sleeves: 'long', legs: 'long', hair: 'cap', jacket: 'hoodie', bag: false, backpack: true, earbuds: true } },
  { w: 5, cold: 0.15, kind: 'street', fab: [FABRIC.cotton, FABRIC.cotton, FABRIC.denim],
    body: { ...male, build: 0.3, sleeves: 'short', legs: 'long', hair: 'short', jacket: false, bag: false, backpack: false, beard: true } },
  { w: 4, cold: 1.2, kind: 'street', fab: [FABRIC.denim, FABRIC.cotton, FABRIC.cotton],
    body: { ...male, build: 0.5, sleeves: 'long', legs: 'long', hair: 'bald', jacket: 'open', bag: false, backpack: false, glasses: true } },
  { w: 4, cold: 1.0, kind: 'office', fab: [FABRIC.leather, FABRIC.cotton, FABRIC.wool],
    body: { ...male, build: 0.35, sleeves: 'long', legs: 'long', hair: 'short', jacket: 'zip', carry: 'coffee', bag: false, backpack: false } },
  { w: 2, cold: 0.45, kind: 'athletic', fab: [FABRIC.technical, FABRIC.technical, FABRIC.technical],
    body: { ...male, build: 0.2, sleeves: 'short', legs: 'short', hair: 'cap', jacket: false, bag: false, backpack: false, earbuds: true } },
  { w: 3, cold: 1.6, kind: 'street', fab: [FABRIC.wool, FABRIC.knit, FABRIC.wool],
    body: { ...male, build: 0.7, sleeves: 'long', legs: 'long', hair: 'afro', jacket: 'overcoat', bag: false, backpack: false, beard: true } },
  { w: 3, cold: 0.5, kind: 'street', fab: [FABRIC.cotton, FABRIC.cotton, FABRIC.cotton],
    body: { ...male, build: 0.6, sleeves: 'short', legs: 'long', hair: 'cap', jacket: false, carry: 'shopping', bag: false, backpack: false } },
  { w: 3, cold: 1.3, kind: 'street', fab: [FABRIC.nylon, FABRIC.cotton, FABRIC.denim],
    body: { ...male, build: 0.25, sleeves: 'long', legs: 'long', hair: 'fade', jacket: 'zip', carry: 'tote', bag: false, backpack: false } },

  // ---- women, everyday -------------------------------------------------------------------------
  { w: 7, cold: 2.2, kind: 'office', fab: [FABRIC.wool, FABRIC.cotton, FABRIC.knit],
    body: { ...female, build: 0.25, sleeves: 'long', legs: 'skirt', hair: 'bob', jacket: 'overcoat', bag: true, backpack: false } },
  { w: 6, cold: 2.4, kind: 'street', fab: [FABRIC.nylon, FABRIC.knit, FABRIC.denim],
    body: { ...female, build: 0.3, sleeves: 'long', legs: 'long', hair: 'ponytail', jacket: 'puffer', bag: true, backpack: false } },
  { w: 5, cold: 0.4, kind: 'street', fab: [FABRIC.cotton, FABRIC.cotton, FABRIC.cotton],
    body: { ...female, build: 0.22, sleeves: 'short', legs: 'dress', hair: 'long', jacket: false, carry: 'tote', bag: false, backpack: false, glasses: true } },
  { w: 5, cold: 1.1, kind: 'office', fab: [FABRIC.wool, FABRIC.cotton, FABRIC.wool],
    body: { ...female, build: 0.28, sleeves: 'long', legs: 'long', hair: 'bun', jacket: 'blazer', bag: true, backpack: false } },
  { w: 4, cold: 1.4, kind: 'street', fab: [FABRIC.denim, FABRIC.cotton, FABRIC.denim],
    body: { ...female, build: 0.4, sleeves: 'long', legs: 'long', hair: 'long', jacket: 'open', carry: 'coffee', bag: true, backpack: false } },
  { w: 4, cold: 1.3, kind: 'street', fab: [FABRIC.knit, FABRIC.cotton, FABRIC.denim],
    body: { ...female, build: 0.3, sleeves: 'long', legs: 'long', hair: 'bun', jacket: 'hoodie', bag: false, backpack: true, earbuds: true } },
  { w: 3, cold: 1.8, kind: 'street', fab: [FABRIC.wool, FABRIC.cotton, FABRIC.knit],
    body: { ...female, build: 0.35, sleeves: 'long', legs: 'skirt', hair: 'short', headwear: 'hijab', jacket: 'open', bag: true, backpack: false } },
  { w: 2, cold: 0.45, kind: 'athletic', fab: [FABRIC.technical, FABRIC.technical, FABRIC.technical],
    body: { ...female, build: 0.2, sleeves: 'short', legs: 'short', hair: 'ponytail', jacket: false, bag: false, backpack: false, earbuds: true } },
  { w: 3, cold: 0.8, kind: 'street', fab: [FABRIC.cotton, FABRIC.cotton, FABRIC.cotton],
    body: { ...female, build: 0.5, sleeves: 'short', legs: 'long', hair: 'afro', jacket: false, carry: 'shopping', bag: false, backpack: false } },
  { w: 3, cold: 1.2, kind: 'street', fab: [FABRIC.leather, FABRIC.cotton, FABRIC.denim],
    body: { ...female, build: 0.24, sleeves: 'long', legs: 'long', hair: 'bob', jacket: 'zip', bag: true, backpack: false, glasses: true } },

  // ---- visitors ---------------------------------------------------------------------------------
  { w: 3, cold: 0.5, kind: 'tourist', fab: [FABRIC.nylon, FABRIC.cotton, FABRIC.cotton],
    body: { ...male, build: 0.55, sleeves: 'short', legs: 'short', hair: 'cap', jacket: false, carry: 'camera', bag: false, backpack: true } },
  { w: 2, cold: 1.0, kind: 'tourist', fab: [FABRIC.nylon, FABRIC.cotton, FABRIC.denim],
    body: { ...female, build: 0.35, sleeves: 'long', legs: 'long', hair: 'ponytail', jacket: 'zip', carry: 'camera', bag: false, backpack: true } },

  // ---- people at work ---------------------------------------------------------------------------
  { w: 2, kind: 'hivis', fab: [FABRIC.technical, FABRIC.cotton, FABRIC.denim],
    body: { ...male, build: 0.6, sleeves: 'long', legs: 'long', hair: 'short', jacket: 'vest', headwear: 'hardhat', bag: false, backpack: false, beard: true } },
  { w: 2, kind: 'delivery', fab: [FABRIC.nylon, FABRIC.cotton, FABRIC.technical],
    body: { ...male, build: 0.3, sleeves: 'long', legs: 'long', hair: 'cap', jacket: 'zip', carry: 'delivery', bag: false, backpack: false } },
  { w: 1.5, kind: 'police', fab: [FABRIC.technical, FABRIC.cotton, FABRIC.wool],
    body: { ...male, build: 0.5, sleeves: 'long', legs: 'long', hair: 'fade', jacket: 'zip', headwear: 'peaked', bag: false, backpack: false } },
  { w: 1, kind: 'doorman', fab: [FABRIC.wool, FABRIC.cotton, FABRIC.wool],
    body: { ...male, build: 0.4, sleeves: 'long', legs: 'long', hair: 'short', jacket: 'overcoat', headwear: 'peaked', bag: false, backpack: false } },
  { w: 1.5, kind: 'scrubs', fab: [FABRIC.cotton, FABRIC.cotton, FABRIC.cotton],
    body: { ...female, build: 0.32, sleeves: 'short', legs: 'long', hair: 'bun', jacket: false, bag: true, backpack: false } },
];

/** kept for callers that only need a body cut */
export const BODY_VARIANTS: Partial<BodyParams>[] = WARDROBE.map(a => a.body);

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** roughness by fabric family: nylon and leather catch a highlight, wool and denim swallow it */
const FABRIC_ROUGH: Record<number, number> = {
  [FABRIC.cotton]: 0.88, [FABRIC.wool]: 0.92, [FABRIC.nylon]: 0.44, [FABRIC.denim]: 0.94,
  [FABRIC.leather]: 0.42, [FABRIC.technical]: 0.62, [FABRIC.knit]: 0.93,
};

/** A body-parameter object with a stable key order, so the geometry cache sees one entry per wardrobe cut. */
function bodyOf(a: Archetype, r: () => number): Partial<BodyParams> {
  const b = { ...a.body };
  // the rain closes bare arms and puts an umbrella in one hand
  if (conditions.rain) {
    if (b.sleeves !== 'long') b.sleeves = 'long';
    if (!b.carry && !b.jacket && r() < 0.55) b.jacket = 'zip';
    if (!b.carry && r() < 0.45) b.carry = 'umbrella';
  }
  if (conditions.night && !b.jacket && a.kind !== 'athletic' && a.kind !== 'scrubs' && r() < 0.6) {
    b.jacket = r() < 0.5 ? 'puffer' : 'open';
    if (b.sleeves === 'short') b.sleeves = 'long';
  }
  if (b.glasses && conditions.night) b.glasses = false; // sunglasses come off after dark
  return b;
}

export function randomAppearance(seed: number): Appearance {
  const r = mulberry(seed);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length) % arr.length];

  // Weighted archetype draw: uniforms are rare, commuters are not, and the weather moves the whole table.
  // `cold` > 1 is a winter/rain/evening look, < 1 a warm-afternoon one; a clear day inverts the same factor
  // so a September 15:00 sidewalk is roughly half in shirtsleeves and a wet night is almost all coats.
  const chilly = conditions.rain || conditions.night;
  const weights = WARDROBE.map(a => a.w * (a.cold === undefined ? 1 : chilly ? a.cold : Math.pow(Math.max(0.3, a.cold), -0.75)));
  let total = 0;
  for (const w of weights) total += Math.max(0.05, w);
  let roll = r() * total, vi = 0;
  for (let i = 0; i < weights.length; i++) { roll -= Math.max(0.05, weights[i]); if (roll <= 0) { vi = i; break; } }
  const arch = WARDROBE[vi];
  const body = bodyOf(arch, r);
  const isFemale = (body.hips ?? 1) > 1.05;

  // heights: adult distribution (women ~13 cm shorter on average) over the 1.55-1.95 m a street shows
  const height = clamp((isFemale ? 1.638 : 1.782) + (r() + r() + r() - 1.5) * 0.115, 1.55, 1.95);
  // lateral build: slight to heavy. The head bone counter-scales this in the animator so builds stay plausible.
  const width = 0.94 + (body.build ?? 0.35) * 0.16 + (r() - 0.5) * 0.05;
  const headphones = !body.earbuds && !body.headwear && body.hair !== 'cap' && r() < 0.09;

  const skin = pick(SKIN_TONES);
  let hair = pick(HAIR_COLORS);
  if (skin < 0xb00000 && r() < 0.88) hair = pick([0x0d0b0a, 0x151110, 0x241a14]);
  // a fifth of adults over about forty are grey; keep it off the athletic and student cuts
  if (r() < 0.11 && arch.kind !== 'athletic') hair = pick([0x8a8a8a, 0xa8a49c, 0x6b6b6b]);

  let [outerFab, shirtFab, pantsFab] = arch.fab;
  let shirt = pick(TOP_COLORS);
  let pants = pantsFab === FABRIC.denim ? pick(DENIM_COLORS) : pick(PANTS_COLORS);
  let shoes = pick(SHOE_COLORS);
  let jacket = body.jacket === 'overcoat' ? pick(COAT_COLORS) : pick(JACKET_COLORS);
  let hat = pick(HAT_COLORS);
  let bag = pick(BAG_COLORS);
  let sock: number | undefined;
  let hivis: number | undefined;
  let prop: number | undefined;
  let propRough = 0.7;
  let tie: number | undefined;
  let accent = pick([0x1a1612, 0x2b2620, 0x3a2f28, 0x141414, 0x5a4a3a]);
  let quilted = body.jacket === 'puffer' ? 1 : 0;

  switch (arch.kind) {
    case 'suit': {
      const sc = pick(SUIT_COLORS);
      jacket = sc; pants = sc;
      shirt = pick([0xe8e6e1, 0xd9e2ec, 0xc8d3e0, 0xe8e6e1, 0xbcc6d2]);
      shoes = pick([0x111111, 0x3a2416, 0x111111]);
      tie = pick([0x7a1c22, 0x1c2a4a, 0x2f4536, 0x4a2340, 0x6b5a20, 0x25292e]);
      break;
    }
    case 'office':
      shoes = pick([0x111111, 0x1a1a1a, 0x3a2416, 0x4a3a2a, 0x111111]);
      if (body.legs === 'skirt' || body.legs === 'dress') sock = pick(TIGHTS_COLORS);
      break;
    case 'athletic':
      shirt = pick([0x1a1a1a, 0xd8d6d0, 0x1f3a5a, 0x6b2a2e, 0x35604a, 0x3a3a3a, 0x2a2a2a]);
      pants = pick([0x1a1a1a, 0x222222, 0x2b3340, 0x3a3a3a]);
      shoes = pick([0xe6e6e6, 0xdcdcdc, 0xd8d0b8, 0xbbbbbb]);
      shirtFab = pantsFab = FABRIC.technical;
      break;
    case 'tourist':
      shirt = pick([0xd8d4c8, 0xe0ddd4, 0x4b6f9a, 0x8fa6bf, 0x9e7a3a, 0x6b8a60]);
      pants = pick([0x8a7a66, 0xa8977a, 0x5a5048, 0x2c3a5a]);
      shoes = pick([0xe6e6e6, 0xbbbbbb, 0x8a8a8a]);
      hat = pick([0x1c2538, 0x8a1f24, 0xd9d4c7, 0x2c6b4a]);
      prop = 0x14171a; propRough = 0.4;
      break;
    case 'hivis':
      hivis = pick([0xc8e630, 0xd6ee46, 0xbadd28]);
      hat = pick([0xe8e4dc, 0xe8b21f, 0xe8e4dc]);
      shirt = pick([0x3a4a5a, 0x2f2f2f, 0x5a4a3a, 0x1f2a44]);
      pants = pick(DENIM_COLORS); pantsFab = FABRIC.denim;
      shoes = pick([0x4a3222, 0x3a2a1e, 0x1a1a1a]);
      break;
    case 'delivery':
      jacket = pick([0x1a1a1a, 0x1c2538, 0x2b2b2b]);
      prop = pick([0xd23a2a, 0x1f7a4a, 0x2b5fb8, 0xe07a1f]); propRough = 0.5;
      hat = pick([0x111111, 0x1a1a1a, 0x8a1f24]);
      pants = pick([0x1a1a1a, 0x222222, 0x2b3340]);
      break;
    case 'police':
      // NYPD street uniform: near-black navy, with the blue stripe on the cap band
      jacket = 0x121820; pants = 0x141a22; shirt = 0x1a2230;
      hat = 0x121820; accent = 0x1d4b9e;
      shoes = 0x0d0d0d;
      break;
    case 'doorman':
      jacket = pick([0x1a2233, 0x241a14, 0x1c2a22]);
      pants = jacket; hat = jacket; accent = pick([0xb08a2b, 0xc4a24a]);
      shirt = 0xe8e6e1; shoes = 0x111111;
      break;
    case 'scrubs': {
      const sc = pick([0x2f6b7a, 0x3a6b52, 0x4a5f8a, 0x5a6b7a, 0x6b4a6b]);
      shirt = sc; pants = sc;
      shoes = pick([0xe6e6e6, 0xdcdcdc]);
      shirtFab = pantsFab = FABRIC.cotton;
      break;
    }
    default:
      if (body.legs === 'skirt' || body.legs === 'dress') sock = pick(TIGHTS_COLORS);
      break;
  }
  if (body.legs === 'dress' && !body.jacket) pants = shirt; // one piece
  if (body.carry === 'shopping') prop = pick([0xd9d4c7, 0xe8e6e1, 0x2a2a2a, 0xb08a52, 0x8a1f24]);
  if (body.carry === 'coffee') { prop = pick([0xe8e2d6, 0xd9d4c7, 0xf0ece2]); propRough = 0.8; }
  if (body.carry === 'umbrella') { prop = pick([0x141414, 0x1c2538, 0x3b4030, 0x8a1f24, 0x2f2f2f]); propRough = 0.55; }

  // shader details: zip line (closed outer layers), chest graphic (tees), stripes, pocket welts
  const closed = !!body.jacket && body.jacket !== 'open' && body.jacket !== 'blazer' && body.jacket !== 'overcoat';
  const style: [number, number, number, number] = [
    closed ? 1 : 0,
    !body.jacket && body.sleeves === 'short' && r() < 0.32 ? 1 : 0,
    !body.jacket && r() < 0.08 ? 1 : 0,
    body.jacket && arch.kind !== 'suit' && r() < 0.6 ? 1 : 0,
  ];
  const sneakers = shoes >= 0xbbbbbb;

  return {
    body: headphones ? { ...body, headphones: true } : body,
    variant: seed,
    colors: {
      skin, shirt, pants, shoes, hair, hairvol: hair, accent,
      jacket, jacketRough: FABRIC_ROUGH[outerFab] ?? 0.85,
      bag, hat,
      hatRough: arch.kind === 'hivis' ? 0.35 : 0.85,
      shirtRough: FABRIC_ROUGH[shirtFab] ?? 0.88,
      pantsRough: FABRIC_ROUGH[pantsFab] ?? 0.88,
      sock: sock ?? (body.legs === 'short' ? 0xe6e4de : undefined),
      sockRough: sock ? 0.82 : 0.9,
      hivis, prop, propRough, tie,
      // sunglasses are near-black; prescription frames are thin metal or tortoiseshell
      glasses: body.glasses ? (r() < 0.6 ? 0x0b0b0d : pick([0x3a2a1e, 0x6b6b70, 0x1a1a1a])) : 0x0b0b0d,
      sole: sneakers ? 0xe4e1da : 0x2a2622,
    },
    height,
    width,
    style,
    fabric: [outerFab, shirtFab, pantsFab, quilted],
  };
}

/** the local player: a fixed, readable look (dark open jacket, grey tee, black jeans, white sneakers); gender/skin/hair vary per name */
export function localAppearance(name: string): Appearance {
  const r = mulberry(hashString(name || 'you') + 7);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length) % arr.length];
  const isFemale = r() < 0.4;
  const body: Partial<BodyParams> = isFemale
    ? { ...female, build: 0.25, sleeves: 'long', legs: 'long', hair: 'long', jacket: 'open', bag: false, backpack: false, glasses: false, headphones: false, watch: true }
    : { ...male, build: 0.3, sleeves: 'long', legs: 'long', hair: 'short', jacket: 'open', bag: false, backpack: false, glasses: false, headphones: false, watch: true };
  return {
    body,
    variant: hashString(name || 'you'),
    colors: {
      skin: pick(SKIN_TONES),
      // heather-grey cotton tee, black cotton shell jacket (a little sheen on the folds), black raw denim, white leather sneakers
      shirt: 0x8c8b88,
      shirtRough: 0.9,
      jacket: 0x121213,
      jacketRough: 0.62,
      pants: 0x121316,
      pantsRough: 0.9,
      shoes: 0xe9e9e6,
      sole: 0xe4e1da,
      hair: pick([0x1a1210, 0x2b1b12, 0x3d2817, 0x0d0b0a, 0x8a5a2b]),
      accent: 0x16120f,
      bag: 0x1a1816,
      hat: 0x111111,
      watch: 0xb9bcc0,
    },
    height: isFemale ? 1.68 : 1.8,
    width: 1,
    style: [0, 0, 0, 1],
    fabric: [FABRIC.nylon, FABRIC.cotton, FABRIC.denim, 0],
  };
}
