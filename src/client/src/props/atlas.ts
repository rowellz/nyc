/**
 * SignAtlas: one 4096x4096 canvas texture holding every sign face the props need.
 *  - fixed slots (drawn once): ONE WAY, NO STANDING, NO PARKING, STOP, solid colors, the subway 'SUBWAY' base...
 *  - dynamic slots: street-name blades ("W 42 ST"), subway line signs ("B D F M"), bus route signs ("M42"),
 *    reference-counted per text; freed when the last tile using them unloads.
 * Slots are 384 x 64 px, 10 columns x 60 rows = 600 slots (plus a portrait strip).
 * Instances address a slot through aData = (u0, v0, uw, vh) (see material.ts PROP_ATLAS).
 * GPU uploads share the scene upload queue and coalesce until tile placement finishes.
 */
import * as THREE from 'three';
import { registerDynamicTexture } from '@/core/textureRelease';
import type { FrameBuildQueue, BuildJob, BuildSteps } from '../buildings/loading';

// The full-city dataset has more than 140 distinct names/routes within the ultra load radius.
// Keep the authored slot resolution, but allow 600 resident slots instead of blanking nearby signs.
export const ATLAS_W = 4096;
export const ATLAS_H = 4096;
export const SLOT_W = 384;
export const SLOT_H = 64;
/** Subway-only regions inside rectOf's inset: 4:1 entrance sign, then a 2:1 MTA plate. */
export const SUBWAY_SIGN_FRAC = 4 * (SLOT_H - 2) / (SLOT_W - 2);
export const SUBWAY_PLATE_U = (4 * (SLOT_H - 2) + 8) / (SLOT_W - 2);
/** 3:1 ONE WAY face within the atlas rect's one-pixel inset. */
export const ONE_WAY_FRAC = 3 * (SLOT_H - 2) / (SLOT_W - 2);
/** Bus-only portrait content uses the same one-pixel inset as rectOf, rotated 90 degrees. */
export const BUS_SIGN_FRAC = 2 * (SLOT_H - 2) / (SLOT_W - 2);
/** Bus-only portrait fractions, shared with the flag mesh. Unused route rows remain cut out. */
export const BUS_SIGN_LAYOUT = {
  headHeight: 0.5, routeTop: 0.53, routeBottom: 0.97,
  routeInset: 0.08, routeGap: 0.018, routeMaxHeight: 0.22,
} as const;
const COLS = Math.floor(ATLAS_W / SLOT_W);
/** the bottom 256 px are the "tall" strip for hi-res portrait signs (12 cells of 170 x 256) */
export const TALL_H = 256;
export const TALL_W = 170;
const ROWS = Math.floor((ATLAS_H - TALL_H) / SLOT_H);
const TALL_Y = ATLAS_H - TALL_H;

export type Rect = [u0: number, v0: number, uw: number, vh: number];

/** Newsstand-only artwork in the unused 256 px right gutter, above the portrait strip.
 * No existing fixed/dynamic cell is moved or resized. Coordinates are top-origin pixels. */
const NEWSSTAND_W = 256, NEWSSTAND_H = 1024;
export function newsstandUv(kind: 'cover' | 'snack' | 'bar' | 'drink' | 'paper' | 'paperEdge' | 'awning' | 'lottery', index = 0): Rect {
  let r: Rect;
  switch (kind) {
    case 'cover': r = [(index % 4) * 64 + 3, Math.floor(index / 4) * 96 + 3, 58, 90]; break;
    case 'snack': r = [(index % 4) * 64 + 3, 400 + Math.floor(index / 4) * 80 + 3, 58, 74]; break;
    case 'bar': r = [(index % 2) * 128 + 3, 883 + Math.floor(index / 2) * 32, 122, 26]; break;
    case 'drink': r = [131 + (index % 2) * 64, 675, 58, 26]; break;
    case 'paper': r = [3 + (index % 2) * 128, 579, 122, 90]; break;
    case 'paperEdge': r = [3, 735, 250, 26]; break;
    case 'awning': r = [3, 707, 250, 18]; break;
    case 'lottery': r = [3, 771, 250, 90]; break;
  }
  return [r[0] / NEWSSTAND_W, r[1] / NEWSSTAND_H, r[2] / NEWSSTAND_W, r[3] / NEWSSTAND_H];
}

interface Slot {
  index: number;
  key: string;
  refs: number;
  rect: Rect;
}

export type SlotDrawer = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;

const FONT_GOTHIC = '"Highway Gothic", "Roadgeek 2005 Series D", "Arial Narrow", "Helvetica Neue", Helvetica, Arial, sans-serif';
const FONT_HELV = '"Helvetica Neue", Helvetica, Arial, sans-serif';

/**
 * Two small leafy sprays and two individual blades, for the -9 shrub geometry only. Kept
 * separate from SignAtlas and the worker's legacy shrub map: no shared slot moves.
 * Opaque leaf interiors, transparent space between leaves, muted boxwood greens
 * and broader hydrangea-like blades; no opaque whole-shrub silhouette. Individual
 * blades occupy the upper two cells so the silhouette can turn leaf by leaf.
 */
export function makePlanterLeafTexture(): THREE.DataTexture {
  const size = 512, cell = 256, pixels = new Uint8Array(size * size * 4);
  let seed = 96317;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  // Green RGB under zero alpha prevents dark mip fringes around the leaf edges.
  for (let i = 0; i < pixels.length; i += 4) { pixels[i] = 67; pixels[i + 1] = 91; pixels[i + 2] = 43; }
  for (let tile = 0; tile < 4; tile++) {
    const ox = tile % 2 * cell, oy = Math.floor(tile / 2) * cell;
    const put = (x: number, y: number, rgb: number[], coverage: number) => {
      if (x < 4 || x >= 252 || y < 4 || y >= 252) return;
      const i = ((oy + y) * size + ox + x) * 4;
      const alpha = Math.round(255 * THREE.MathUtils.clamp(coverage, 0, 1));
      if (alpha < pixels[i + 3]) return;
      pixels[i] = rgb[0]; pixels[i + 1] = rgb[1]; pixels[i + 2] = rgb[2]; pixels[i + 3] = alpha;
    };
    const stem = (ax: number, ay: number, bx: number, by: number, width: number) => {
      const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
      for (let y = Math.floor(Math.min(ay, by) - width - 1); y <= Math.ceil(Math.max(ay, by) + width + 1); y++) {
        for (let x = Math.floor(Math.min(ax, bx) - width - 1); x <= Math.ceil(Math.max(ax, bx) + width + 1); x++) {
          const t = THREE.MathUtils.clamp(((x - ax) * dx + (y - ay) * dy) / length2, 0, 1);
          put(x, y, [90, 91, 48], width + 0.5 - Math.hypot(x - ax - t * dx, y - ay - t * dy));
        }
      }
    };
    const leaf = (cx: number, cy: number, length: number, width: number, angle: number) => {
      const dx = Math.sin(angle), dy = Math.cos(angle), radius = Math.ceil(Math.hypot(length, width));
      const palette = [[69, 98, 46], [83, 111, 53], [58, 86, 41], [91, 115, 59]][Math.floor(random() * 4)];
      const broad = tile === 3;
      for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
        for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
          const u = (x - cx) * dy - (y - cy) * dx, v = (x - cx) * dx + (y - cy) * dy;
          const t = v / length;
          if (Math.abs(t) >= 1) continue;
          const blade = width * Math.pow(1 - t * t, broad ? 0.68 : 0.52)
            * (1 - 0.1 * t) * (broad ? 0.976 + 0.024 * Math.cos(t * 48) : 1);
          const alpha = Math.min(blade - Math.abs(u) + 0.5, length - Math.abs(v));
          if (alpha <= 0) continue;
          // A shallow midrib fold and subdued lateral veins, never white outlines.
          const fold = u < 0 ? 0.92 : 1.06;
          const midrib = Math.max(0, 1 - Math.abs(u) / (length * 0.043)) * 0.12;
          const vein = broad ? Math.max(0, 1 - Math.abs(Math.sin((v - Math.abs(u) * 0.72) * 11 / length)) * 7) * 0.065 : 0;
          const tone = fold + midrib + vein + t * 0.04 + (random() - 0.5) * 0.055;
          put(x, y, palette.map(c => Math.round(c * tone)), alpha);
        }
      }
    };
    if (tile >= 2) {
      stem(128, 12, 128, 52, 2.1);
      leaf(128, 133, 106, tile === 3 ? 99 : 92, 0);
      continue;
    }
    const bend = (tile - 0.5) * 7.2;
    stem(128, 22, 128 + bend, 218, 1.5);
    const pairs = 5;
    for (let row = 0; row < pairs; row++) for (const side of [-1, 1]) {
      const y = 50 + row * 34 + (side > 0 ? 8 : 0);
      const x = 128 + bend * y / 218, reach = 31 + random() * 8;
      const angle = side * (0.87 + random() * 0.35);
      const cx = x + side * reach, cy = y + 8 + random() * 8;
      stem(x, y - 9, cx, cy, 0.9);
      // Slightly fuller blades retain the old planted mass after some sprays
      // become individual silhouette leaves; the gaps between shoots stay clear.
      leaf(cx, cy, 28 + random() * 6, 16 + random() * 4, angle);
    }
    leaf(128 + bend, 218, 23, 12.5, bend * 0.035);
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.name = 'planter-leaf-sprays';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Mailbox-only label sheet, separate from SignAtlas allocation and fixed slots.
 * Ref: mailbox-2.jpg (Plack, 2013, CC0): off-white eagle badge, collection notice,
 * small paper remnants. Fine print is unresolved; no location/schedule is asserted.
 * The USPS stencil is brief-led. Alpha is composited onto this asset's blue paint.
 */
export function makeMailboxTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d')!;
  const paper = '#dddcd0', ink = '#273d5a';
  const polygon = (points: [number, number][], color: string) => {
    g.fillStyle = color;
    g.beginPath();
    points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    g.closePath();
    g.fill();
  };
  // Broad angular eagle silhouette, with the two-line legacy postal-service caption.
  g.fillStyle = paper;
  g.beginPath();
  g.roundRect(9, 9, 238, 238, 9);
  g.fill();
  g.fillStyle = ink;
  g.fillRect(22, 22, 212, 153);
  g.fillStyle = '#e3e3d8';
  g.beginPath();
  g.moveTo(37, 38);
  g.lineTo(184, 83);
  g.bezierCurveTo(207, 90, 220, 117, 214, 144);
  g.lineTo(37, 154);
  g.lineTo(153, 125);
  g.bezierCurveTo(176, 120, 197, 126, 209, 137);
  g.bezierCurveTo(202, 117, 183, 108, 162, 106);
  g.lineTo(89, 94);
  g.closePath();
  g.fill();
  polygon([[88, 60], [178, 94], [154, 94], [115, 81]], ink);
  polygon([[178, 99], [193, 103], [181, 105]], ink);
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.font = `500 22px ${FONT_HELV}`;
  g.fillText('UNITED STATES', 128, 201, 215);
  g.fillText('POSTAL SERVICE', 128, 229, 215);
  g.fillStyle = '#936e62';
  g.fillRect(22, 207, 210, 2);

  // Notice panel: cool white ground and dense blue information blocks rather than
  // fictitious pickup times. Border wear stays in this rectangle's own gutter.
  g.fillStyle = '#edf1f2';
  g.fillRect(264, 8, 240, 120);
  g.strokeStyle = '#657383';
  g.lineWidth = 2;
  g.strokeRect(269, 13, 230, 110);
  g.fillStyle = ink;
  g.font = `bold 18px ${FONT_HELV}`;
  g.fillText('PULL HANDLE', 384, 35, 222);
  g.font = `bold 15px ${FONT_HELV}`;
  g.fillText('MAIL COLLECTION', 384, 57, 222);
  g.fillRect(279, 64, 210, 1);
  g.fillStyle = '#527392';
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 2; col++) {
      const x = 279 + col * 108, y = 73 + row * 6.5;
      const width = 89 + (row % 3) * 4 - col * 3;
      g.fillRect(x, y, width, 1.8);
      // Small interruptions read as rows of printing, without inventing text.
      g.fillStyle = '#edf1f2';
      for (let word = 1; word < 5; word++) g.fillRect(x + word * 17 + row % 4, y, 2, 1.8);
      g.fillStyle = '#527392';
    }
  }

  // Cut stencil: transparent counters and narrow bridges reveal the actual
  // underlying faded blue; there is no differently-coloured rectangular patch.
  g.fillStyle = '#d4d6cc';
  g.font = `bold 59px ${FONT_HELV}`;
  g.fillText('USPS', 384, 208, 232);
  for (const x of [314, 365, 414, 465]) g.clearRect(x, 160, 2, 59);

  // A small worn service sticker and a separate neutral inventory/barcode label.
  g.fillStyle = '#d2d0bd';
  g.fillRect(269, 249, 102, 70);
  g.fillStyle = '#55718a';
  g.fillRect(274, 254, 92, 11);
  g.fillStyle = '#707779';
  for (let i = 0; i < 5; i++) g.fillRect(278, 274 + i * 7, 79 - (i % 3) * 12, 2);
  g.fillStyle = '#c9c6ad';
  g.fillRect(389, 249, 94, 69);
  g.fillStyle = '#555b59';
  for (let i = 0; i < 25; i++) g.fillRect(396 + i * 3, 264, i % 4 === 0 ? 2 : 1, 28);
  g.fillRect(400, 301, 67, 2);

  // The reference has abraded paper on the exposed tray. Its few surviving
  // ink strokes are unresolved, so do not fabricate dates, routes or times.
  polygon([[267, 350], [492, 349], [500, 357], [502, 425], [484, 432],
    [277, 431], [270, 419], [265, 411]], '#d0d3cc');
  g.fillStyle = '#8b9499';
  for (let row = 0; row < 4; row++) {
    g.fillRect(286 + row * 2, 363 + row * 15, 29 + (row % 2) * 20, 1.5);
    g.fillRect(403, 365 + row * 15, 44 - row * 7, 1.5);
  }

  // Deterministic little edge losses and rubbed ink; not full-surface noise.
  let seed = 6419;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (const [x, y, w, h] of [[9, 9, 238, 238], [264, 8, 240, 120], [269, 249, 102, 70], [389, 249, 94, 69], [264, 348, 240, 88]]) {
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    for (let i = 0; i < 18; i++) {
      const cx = x + rand() * w, cy = i % 2 ? y + rand() * 4 : y + h - rand() * 4;
      g.clearRect(cx, cy, 1 + rand() * 8, 1 + rand() * 5);
    }
    g.fillStyle = 'rgba(211, 209, 189, 0.16)';
    for (let i = 0; i < 35; i++) g.fillRect(x + rand() * w, y + rand() * h, 1 + rand() * 4, 1);
    g.restore();
  }
  // Irregular losses around the collection placard expose the rusty blue
  // frame beneath; these remain confined to the mailbox-only notice region.
  g.save();
  g.beginPath(); g.rect(264, 8, 240, 120); g.clip();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 25; i++) {
    const cx = 264 + rand() * 240, cy = i % 2 ? 8 : 128;
    const w = 3 + rand() * 12, h = 2 + rand() * 7;
    polygon([[cx - w, cy], [cx - w * 0.7, cy - h * 0.6],
      [cx - w * 0.2, cy - h], [cx + w * 0.6, cy - h * 0.5],
      [cx + w, cy + h * 0.4], [cx - w * 0.3, cy + h]], '#000');
  }
  g.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'mailbox-labels-only';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

export class SignAtlas {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly texture: THREE.Texture;
  private uploadJob?: BuildJob;
  private disposed = false;
  private slots = new Map<string, Slot>();
  private free: number[] = [];
  private fixedCount = 0;
  private dirty = false;
  private lastUpload = -Infinity;
  private uploads = 0;

  constructor(private builds?: Pick<FrameBuildQueue, 'job'>, private canUpload = () => true, scale = 1) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W * scale;
    this.canvas.height = ATLAS_H * scale;
    this.g = this.canvas.getContext('2d', { willReadFrequently: false })!;
    this.g.scale(scale, scale);
    this.g.fillStyle = '#3a3a3a';
    this.g.fillRect(0, 0, ATLAS_W, ATLAS_H);
    for (let i = COLS * ROWS - 1; i >= 0; i--) this.free.push(i);
    this.texture = new THREE.CanvasTexture(this.canvas);
    registerDynamicTexture(this.texture, () => this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.anisotropy = 8;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.flipY = true;
    if (!builds) this.texture.needsUpdate = true;
    this.drawFixed();
    this.dirty = true;
    if (builds) this.uploadJob = builds.job('props sign atlas');
  }

  /** flipY texture: canvas row 0 is the TOP of the image, which is v = 1 */
  private rectOf(index: number): Rect {
    const col = index % COLS, row = Math.floor(index / COLS);
    const x = col * SLOT_W, y = row * SLOT_H;
    // 1 px inset so bilinear filtering never bleeds neighbors
    const u0 = (x + 1) / ATLAS_W, uw = (SLOT_W - 2) / ATLAS_W;
    const v1 = 1 - (y + 1) / ATLAS_H, vh = (SLOT_H - 2) / ATLAS_H;
    return [u0, v1 - vh, uw, vh];
  }

  private slotXY(index: number): { x: number; y: number } {
    return { x: (index % COLS) * SLOT_W, y: Math.floor(index / COLS) * SLOT_H };
  }

  /** a sub-rectangle of a slot rect: fx,fy,fw,fh are fractions of the slot (0..1, y from the TOP of the slot) */
  static sub(r: Rect, fx: number, fy: number, fw: number, fh: number): Rect {
    return [r[0] + r[2] * fx, r[1] + r[3] * (1 - fy - fh), r[2] * fw, r[3] * fh];
  }

  /** get or create a reference-counted slot for `key` */
  acquire(key: string, draw: SlotDrawer): Rect {
    let s = this.slots.get(key);
    if (s) {
      s.refs++;
      return s.rect;
    }
    if (this.free.length === 0) {
      // evict an unreferenced dynamic slot
      for (const [k, sl] of this.slots) {
        if (sl.refs <= 0 && sl.index >= this.fixedCount) {
          this.slots.delete(k);
          this.free.push(sl.index);
          break;
        }
      }
      if (this.free.length === 0) {
        console.warn('[props] sign atlas full; reusing the blank slot');
        return this.fixed('blank-green');
      }
    }
    const index = this.free.pop()!;
    const { x, y } = this.slotXY(index);
    this.g.save();
    this.g.beginPath();
    this.g.rect(x, y, SLOT_W, SLOT_H);
    this.g.clip();
    this.g.fillStyle = '#3a3a3a';
    this.g.fillRect(x, y, SLOT_W, SLOT_H);
    try {
      draw(this.g, x, y, SLOT_W, SLOT_H);
    } catch (err) {
      console.warn('[props] sign draw failed', key, err);
    }
    this.g.restore();
    s = { index, key, refs: 1, rect: this.rectOf(index) };
    this.slots.set(key, s);
    this.dirty = true;
    if (this.builds && !this.uploadJob?.pending) this.uploadJob = this.builds.job('props sign atlas');
    return s.rect;
  }

  release(key: string): void {
    const s = this.slots.get(key);
    if (!s || s.index < this.fixedCount) return;
    s.refs--;
    // keep it drawn until the space is needed (cheap re-acquire when the tile comes back)
  }

  fixed(name: string): Rect {
    const s = this.slots.get(`fixed:${name}`);
    if (!s) {
      console.warn('[props] unknown fixed sign', name);
      return this.slots.get('fixed:blank-green')!.rect;
    }
    return s.rect;
  }

  /** upload if dirty, throttled */
  update(now: number): void {
    if (!this.dirty || this.disposed || !this.canUpload()) return;
    if (!this.builds && now - this.lastUpload < 0.7 && this.uploads > 0) return;
    this.dirty = false;
    this.lastUpload = now;
    if (!this.builds) { this.uploads++; this.texture.needsUpdate = true; return; }
    const job = this.uploadJob?.pending ? this.uploadJob : this.builds.job('props sign atlas');
    this.uploadJob = undefined;
    const atlas = this;
    // Canvas is already decoded. Keep the GPU-backed source; creating a 4096² bitmap here
    // forces a synchronous readback in Chrome. Only enqueue its existing canvas upload.
    job.run((function* (): BuildSteps {
      yield { texture: atlas.texture, prepare: () => { atlas.texture.needsUpdate = true; atlas.uploads++; } };
    })());
  }

  dispose(): void {
    this.disposed = true; this.uploadJob?.cancel(); this.texture.dispose();
  }

  get stats(): { slots: number; free: number; uploads: number } {
    return { slots: this.slots.size, free: this.free.length, uploads: this.uploads };
  }

  // ---- fixed signs --------------------------------------------------------------------------

  private tallCount = 0;

  /** hi-res portrait sign in the tall strip: drawn at width min(170, 256*aspect), returns the exact rect */
  private addTall(name: string, aspect: number, draw: SlotDrawer): void {
    if (this.tallCount >= Math.floor(ATLAS_W / TALL_W)) {
      console.warn('[props] tall atlas strip full', name);
      return;
    }
    const cell = this.tallCount++;
    const x = cell * TALL_W, y = TALL_Y;
    let w = Math.min(TALL_W - 2, Math.floor((TALL_H - 2) * aspect));
    let h = Math.min(TALL_H - 2, Math.floor(w / aspect));
    w = Math.floor(h * aspect);
    this.g.save();
    this.g.beginPath();
    this.g.rect(x + 1, y + 1, w, h);
    this.g.clip();
    draw(this.g, x + 1, y + 1, w, h);
    this.g.restore();
    const rect: Rect = [(x + 1.5) / ATLAS_W, 1 - (y + 1.5 + h - 1) / ATLAS_H, (w - 1) / ATLAS_W, (h - 1) / ATLAS_H];
    this.slots.set(`fixed:${name}`, { index: -1, key: `fixed:${name}`, refs: 1e9, rect });
  }

  private drawFixed(): void {
    const add = (name: string, draw: SlotDrawer) => {
      const index = this.free.pop()!;
      const { x, y } = this.slotXY(index);
      this.g.save();
      this.g.beginPath();
      this.g.rect(x, y, SLOT_W, SLOT_H);
      this.g.clip();
      draw(this.g, x, y, SLOT_W, SLOT_H);
      this.g.restore();
      this.slots.set(`fixed:${name}`, { index, key: `fixed:${name}`, refs: 1e9, rect: this.rectOf(index) });
      this.fixedCount++;
    };
    this.addTall('no-standing', 12 / 18, drawNoStanding);
    this.addTall('no-parking', 12 / 18, drawNoParking);
    this.addTall('alt-side', 12 / 18, drawAltSide);
    this.addTall('stop', 1, drawStop);
    this.addTall('muni', 0.26 / 0.78, drawMuniMeter);
    this.addTall('linknyc-screen', 0.69 / 1.22, drawLinkScreen);
    this.addTall('bus-shelter-ad', 1.1 / 1.7, drawShelterAd);
    this.addTall('citibike-panel', 0.42 / 1.2, drawCitiPanel);
    this.addTall('mta-bus-sign', 0.5, (g, x, y, w, h) => drawBusSign(g, x, y, w, h, []));
    add('blank-green', (g, x, y, w, h) => {
      g.fillStyle = '#0f6b3c';
      g.fillRect(x, y, w, h);
    });
    add('solid-grey', (g, x, y, w, h) => {
      g.fillStyle = '#8a8d90';
      g.fillRect(x, y, w, h);
    });
    add('solid-black', (g, x, y, w, h) => {
      g.fillStyle = '#141414';
      g.fillRect(x, y, w, h);
    });
    add('solid-white', (g, x, y, w, h) => {
      g.fillStyle = '#f2f2f0';
      g.fillRect(x, y, w, h);
    });
    // ONE WAY: exact 3:1 face inside the same pixel inset used by rectOf.
    add('one-way-left', (g, x, y, _w, h) => drawOneWay(g, x + 1, y + 1, 3 * (h - 2), h - 2, -1));
    add('one-way-right', (g, x, y, _w, h) => drawOneWay(g, x + 1, y + 1, 3 * (h - 2), h - 2, 1));
    add('food-cart-menu', (g, x, y, w, h) => drawMenu(g, x, y, w, h));
    add('subway-base', (g, x, y, w, h) => drawSubwaySign(g, x, y, w, h, ''));
    // Consume the same legacy cell so later dynamic slot indices are unchanged, but give
    // individual covers enough texels in the previously unused right-hand gutter.
    add('newsstand-front', () => {});
    this.g.save();
    this.g.beginPath();
    this.g.rect(COLS * SLOT_W, 0, NEWSSTAND_W, NEWSSTAND_H);
    this.g.clip();
    drawNewsstand(this.g, COLS * SLOT_W, 0, NEWSSTAND_W, NEWSSTAND_H);
    this.g.restore();
    this.slots.get('fixed:newsstand-front')!.rect = [COLS * SLOT_W / ATLAS_W,
      1 - NEWSSTAND_H / ATLAS_H, NEWSSTAND_W / ATLAS_W, NEWSSTAND_H / ATLAS_H];
  }

  // ---- dynamic sign helpers ------------------------------------------------------------------

  streetBlade(text: string): Rect {
    return this.acquire(`blade:${text}`, (g, x, y, w, h) => drawStreetBlade(g, x, y, w, h, text));
  }

  subwaySign(lines: string): Rect {
    return this.acquire(`subway:${lines}`, (g, x, y, w, h) => drawSubwaySign(g, x, y, w, h, lines));
  }

  busSign(routes: string[]): Rect {
    const key = routes.slice(0, 4).join(' ');
    return this.acquire(`bus:${key}`, (g, x, y, w, h) => drawRotated(g, x + 1, y + 1, w - 2, h - 2,
      (gg, xx, yy, ww, hh) => drawBusSign(gg, xx, yy, ww, hh, routes), 0.5));
  }
}

/**
 * Draws a portrait sign (width/height = aspect) rotated -90 deg into a landscape slot: the sign's top lands
 * at the slot's left edge, the sign's left edge at the slot's bottom. Portrait width = slot height (h),
 * portrait height = h / aspect (capped to w). Geometry maps: slot_u = (1 - v) * (signH / w), slot_v = u.
 */
function drawRotated(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, draw: SlotDrawer, aspect = 0.5): void {
  g.save();
  g.translate(x, y + h);
  g.rotate(-Math.PI / 2);
  draw(g, 0, 0, h, Math.min(w, h / aspect));
  g.restore();
}

/** green NYC blade: white Highway Gothic uppercase, thin white border */
function drawStreetBlade(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string): void {
  g.fillStyle = '#0f6b3c';
  g.fillRect(x, y, w, h);
  // slight vinyl sheen + weathering
  const grad = g.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.strokeStyle = '#f4f4ee';
  g.lineWidth = Math.max(2, h * 0.045);
  g.strokeRect(x + h * 0.09, y + h * 0.09, w - h * 0.18, h - h * 0.18);
  g.fillStyle = '#f7f7f2';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = h * 0.66;
  g.font = `bold ${Math.round(size)}px ${FONT_GOTHIC}`;
  const maxW = w - h * 0.5;
  let m = g.measureText(text).width;
  if (m > maxW) {
    size *= maxW / m;
    g.font = `bold ${Math.round(size)}px ${FONT_GOTHIC}`;
    m = g.measureText(text).width;
  }
  g.fillText(text, x + w / 2, y + h * 0.53);
}

function drawOneWay(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dir: 1 | -1): void {
  g.fillStyle = '#111';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#f4f4f0';
  g.strokeStyle = '#f4f4f0';
  g.lineWidth = 2;
  g.strokeRect(x + 3, y + 3, w - 6, h - 6);
  // arrow: shaft + head, text ONE WAY inside the shaft
  const cy = y + h / 2;
  const shaftL = x + w * 0.1, shaftR = x + w * 0.9;
  const headW = w * 0.2;
  g.beginPath();
  if (dir > 0) {
    g.moveTo(shaftL, cy - h * 0.27);
    g.lineTo(shaftR - headW, cy - h * 0.27);
    g.lineTo(shaftR - headW, cy - h * 0.46);
    g.lineTo(shaftR, cy);
    g.lineTo(shaftR - headW, cy + h * 0.46);
    g.lineTo(shaftR - headW, cy + h * 0.27);
    g.lineTo(shaftL, cy + h * 0.27);
  } else {
    g.moveTo(shaftR, cy - h * 0.27);
    g.lineTo(shaftL + headW, cy - h * 0.27);
    g.lineTo(shaftL + headW, cy - h * 0.46);
    g.lineTo(shaftL, cy);
    g.lineTo(shaftL + headW, cy + h * 0.46);
    g.lineTo(shaftL + headW, cy + h * 0.27);
    g.lineTo(shaftR, cy + h * 0.27);
  }
  g.closePath();
  g.fill();
  g.fillStyle = '#111';
  const text = 'ONE WAY', margin = h * 0.09;
  const textL = shaftL + (dir < 0 ? headW : 0) + margin;
  const textR = shaftR - (dir > 0 ? headW : 0) - margin;
  let size = Math.floor(h * 0.42);
  g.font = `bold ${size}px ${FONT_GOTHIC}`;
  // Fit the actual fallback font, not an assumed Highway Gothic width.
  while (g.measureText(text).width > textR - textL && size > 1) {
    g.font = `bold ${--size}px ${FONT_GOTHIC}`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, (textL + textR) / 2, cy + 1, textR - textL);
}

/** portrait regulation sign, w x h (w = 12", h = 18") */
function drawNoStanding(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#f4f4f0';
  g.fillRect(x, y, w, h);
  g.strokeStyle = '#c8102e';
  g.lineWidth = w * 0.03;
  g.strokeRect(x + w * 0.05, y + w * 0.05, w * 0.9, h - w * 0.1);
  g.fillStyle = '#c8102e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(w * 0.22)}px ${FONT_HELV}`;
  g.fillText('NO', x + w / 2, y + h * 0.2);
  g.fillText('STANDING', x + w / 2, y + h * 0.4);
  g.font = `bold ${Math.round(w * 0.17)}px ${FONT_HELV}`;
  g.fillText('ANYTIME', x + w / 2, y + h * 0.62);
  // the no-standing "P" symbol substitute: a red circle with a slash and the tow icon text
  g.beginPath();
  g.arc(x + w / 2, y + h * 0.82, w * 0.12, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(x + w / 2 - w * 0.085, y + h * 0.82 + w * 0.085);
  g.lineTo(x + w / 2 + w * 0.085, y + h * 0.82 - w * 0.085);
  g.stroke();
}

function drawNoParking(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#f4f4f0';
  g.fillRect(x, y, w, h);
  g.strokeStyle = '#c8102e';
  g.lineWidth = w * 0.03;
  g.strokeRect(x + w * 0.05, y + w * 0.05, w * 0.9, h - w * 0.1);
  g.fillStyle = '#c8102e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(w * 0.2)}px ${FONT_HELV}`;
  g.fillText('NO', x + w / 2, y + h * 0.17);
  g.fillText('PARKING', x + w / 2, y + h * 0.34);
  g.fillStyle = '#111';
  g.font = `bold ${Math.round(w * 0.12)}px ${FONT_HELV}`;
  g.fillText('8AM - 6PM', x + w / 2, y + h * 0.55);
  g.fillText('EXCEPT SUNDAY', x + w / 2, y + h * 0.68);
  g.font = `${Math.round(w * 0.1)}px ${FONT_HELV}`;
  g.fillText('COMMERCIAL VEHICLES', x + w / 2, y + h * 0.84);
  g.fillText('ONLY', x + w / 2, y + h * 0.92);
}

function drawAltSide(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#f4f4f0';
  g.fillRect(x, y, w, h);
  g.strokeStyle = '#c8102e';
  g.lineWidth = w * 0.03;
  g.strokeRect(x + w * 0.05, y + w * 0.05, w * 0.9, h - w * 0.1);
  g.fillStyle = '#c8102e';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(w * 0.2)}px ${FONT_HELV}`;
  g.fillText('NO', x + w / 2, y + h * 0.16);
  g.fillText('PARKING', x + w / 2, y + h * 0.32);
  // broom symbol
  g.strokeStyle = '#111';
  g.lineWidth = w * 0.05;
  g.beginPath();
  g.moveTo(x + w * 0.3, y + h * 0.62);
  g.lineTo(x + w * 0.62, y + h * 0.45);
  g.stroke();
  g.fillStyle = '#111';
  g.fillRect(x + w * 0.2, y + h * 0.6, w * 0.2, h * 0.08);
  g.font = `bold ${Math.round(w * 0.12)}px ${FONT_HELV}`;
  g.fillText('11:30AM - 1PM', x + w / 2, y + h * 0.78);
  g.fillText('TUES & FRI', x + w / 2, y + h * 0.9);
}

function drawStop(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) * 0.5;
  g.fillStyle = '#b3121b';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = '#f4f4f0';
  g.lineWidth = r * 0.06;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    g.lineTo(cx + Math.cos(a) * r * 0.9, cy + Math.sin(a) * r * 0.9);
  }
  g.closePath();
  g.stroke();
  g.fillStyle = '#f4f4f0';
  g.font = `bold ${Math.round(r * 0.72)}px ${FONT_GOTHIC}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('STOP', cx, cy + r * 0.04);
}

function drawMuniMeter(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#5b6066';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#2b2f33';
  g.fillRect(x + w * 0.1, y + h * 0.08, w * 0.8, h * 0.3);
  g.fillStyle = '#7fd0e6';
  g.fillRect(x + w * 0.16, y + h * 0.12, w * 0.68, h * 0.2);
  g.fillStyle = '#0d0d0d';
  g.font = `bold ${Math.round(w * 0.11)}px ${FONT_HELV}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('PAY HERE', x + w / 2, y + h * 0.22);
  g.fillStyle = '#e6e6e6';
  g.font = `bold ${Math.round(w * 0.14)}px ${FONT_HELV}`;
  g.fillText('MUNI', x + w / 2, y + h * 0.5);
  g.fillText('METER', x + w / 2, y + h * 0.62);
  g.fillStyle = '#1a1a1a';
  g.fillRect(x + w * 0.3, y + h * 0.74, w * 0.4, h * 0.05);
  g.fillStyle = '#3a8f3a';
  g.fillRect(x + w * 0.62, y + h * 0.83, w * 0.14, h * 0.06);
}

/** Food-cart-only artwork in the ORIGINAL slot: LED, food print and counter fascia.
 * Reference: refs/_general/halal-cart-1.jpg; its individual menu labels are too small to transcribe.
 * Deterministic photographic-style food prints: shaded crust, grains and leaves, not fetched
 * photographs or transcribed dishes. Only this slot is painted; atlas allocation stays unchanged.
 */
function drawMenu(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.save();
  // Match rectOf's one-pixel inset; all sub-regions stay inside this one existing slot.
  g.translate(x + 1, y + 1);
  g.scale((w - 2) / 384, (h - 2) / 64);
  g.fillStyle = '#902717';
  g.fillRect(0, 0, 384, 64);
  g.fillStyle = '#090e0d';
  g.fillRect(0, 0, 384, 20);
  // Five-by-seven red / green diode letters. This is invented cart branding, not a
  // transcription of the cropped sign. The header alone samples these rows.
  const diodeGlyphs: Record<string, number[]> = {
    C: [14, 17, 16, 16, 16, 17, 14], R: [30, 17, 17, 30, 20, 18, 17],
    E: [31, 16, 16, 30, 16, 16, 31], S: [15, 16, 16, 14, 1, 1, 30],
    N: [17, 25, 25, 21, 19, 19, 17], T: [31, 4, 4, 4, 4, 4, 4],
    H: [17, 17, 17, 31, 17, 17, 17], A: [14, 17, 17, 31, 17, 17, 17],
    L: [16, 16, 16, 16, 16, 16, 31],
  };
  const header = 'CRESCENT HALAL';
  const diodePitch = 4.55;
  const diodeLeft = (384 - (header.length * 6 - 1) * diodePitch) / 2;
  for (let letter = 0; letter < header.length; letter++) {
    const glyph = diodeGlyphs[header[letter]];
    if (!glyph) continue;
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++) {
      const lit = (glyph[row] & (1 << (4 - col))) !== 0;
      g.fillStyle = letter > 8 ? (lit ? '#61cc49' : '#112317') : (lit ? '#f05230' : '#29140e');
      g.beginPath();
      g.ellipse(diodeLeft + (letter * 6 + col) * diodePitch, 3 + row * 2.0, 1.22, 0.8, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const rand = (n: number) => {
    const v = Math.sin(n * 127.1 + 31.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, color: string, rotation = 0) => {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
    g.fill();
  };
  // Three independently composed close-up prints, authored at cabinet aspect ratio.
  // Store the tall photographs in the existing 30-row region; no new atlas slots.
  // The upper menu samples their food crop and caption strip separately.
  const labels = ['CORNER CHICKEN  $9', 'CITY GYRO  $8', 'GARDEN FALAFEL  $8'];
  g.save();
  g.translate(0, 20);
  g.scale(1, 30 / 112);
  for (let dish = 0; dish < 3; dish++) {
    g.save();
    g.translate(dish * 128, 0);
    g.beginPath();
    g.rect(1, 0, 126, 112);
    g.clip();
    const bg = g.createLinearGradient(0, 0, 125, 112);
    bg.addColorStop(0, dish === 1 ? '#24482c' : '#782618');
    bg.addColorStop(0.62, dish === 2 ? '#315128' : '#a83b20');
    bg.addColorStop(1, '#16281c');
    g.fillStyle = bg;
    g.fillRect(0, 0, 128, 112);
    const shaded = (cx: number, cy: number, rx: number, ry: number, light: string, shade: string, rotation = 0) => {
      g.save();
      g.translate(cx, cy);
      g.rotate(rotation);
      g.scale(rx, ry);
      const gloss = g.createRadialGradient(-0.32, -0.40, 0.02, 0, 0, 1);
      gloss.addColorStop(0, light);
      gloss.addColorStop(0.68, light);
      gloss.addColorStop(1, shade);
      g.fillStyle = gloss;
      g.beginPath();
      g.arc(0, 0, 1, 0, Math.PI * 2);
      g.fill();
      g.restore();
    };
    // Camera-close, edge-cropped foil tray only on the chicken / falafel panels.
    // The gyro is a hand-sized diagonal pita, not another copy of the same platter.
    if (dish !== 1) {
      ellipse(67, 61, 64, 48, '#19211a', -0.08);
      shaded(64, 56, 63, 47, '#ddd8c3', '#777c70', -0.08);
      shaded(64, 55, 58, 42, '#e6cc88', '#8e6c36', -0.08);
      // Dense, irregular grains make a food photograph read even after atlas downsampling.
      for (let j = 0; j < 460; j++) {
        const seed = j + dish * 1000;
        const a = rand(seed) * Math.PI * 2, r = Math.sqrt(rand(seed + 731));
        const px = 62 + Math.cos(a) * r * 53, py = 55 + Math.sin(a) * r * 37;
        ellipse(px, py + 0.7, 1.8, 0.78, '#977332', -0.45 + rand(seed + 14));
        ellipse(px, py, 1.8, 0.63, ['#e9c575', '#e5ba63', '#f5d891', '#c49745'][j % 4], -0.45 + rand(seed + 14));
      }
    } else {
      shaded(64, 57, 43, 54, '#d8b37b', '#77532f', 0.62);
      shaded(64, 51, 33, 43, '#6b452a', '#30291b', 0.62);
    }
    // Salad clustered beside the filling: torn leaves with shaded folds, tomato and cucumber.
    for (let j = 0; j < 40; j++) {
      const seed = j + dish * 71 + 1200;
      const px = dish === 1 ? 51 + rand(seed) * 32 : 85 + rand(seed) * 33;
      const py = 17 + rand(seed + 71) * 61;
      shaded(px, py, 4 + rand(seed + 43) * 5, 3 + rand(seed + 24) * 3,
        ['#a1b95b', '#709838', '#86a446'][j % 3], '#315329', rand(seed + 21) * 3);
    }
    for (let j = 0; j < 5; j++) {
      const px = dish === 1 ? 44 + j * 7 : 88 + rand(j + 78) * 27;
      const py = 25 + j * 12;
      shaded(px, py, 8, 6, '#d9542e', '#86281b', -0.4);
      ellipse(px - 1, py - 1, 4, 2.5, '#e27b45', -0.4);
      shaded(px + 3, py + 7, 6.5, 4.4, '#c4cc81', '#59804b', 0.6);
      ellipse(px + 3, py + 7, 4.0, 2.8, '#d8d29d', 0.6);
    }
    if (dish === 2) {
      // Falafel: rough golden crust over dark fried edges, each ball lit independently.
      for (const [j, [px, py, radius]] of [[28, 40, 14], [53, 33, 13], [68, 57, 14], [39, 67, 16], [67, 82, 12]].entries()) {
        ellipse(px + 2, py + 3, radius + 1, radius * 0.82, '#493a1c');
        shaded(px, py, radius, radius * 0.86, '#ab853d', '#59421d');
        for (let k = 0; k < 60; k++) {
          const seed = j * 80 + k + 3200, a = rand(seed) * Math.PI * 2, r = Math.sqrt(rand(seed + 36));
          ellipse(px + Math.cos(a) * r * (radius - 1), py + Math.sin(a) * r * (radius * 0.78),
            0.4 + rand(seed + 29), 0.65, ['#d0a951', '#7d5b27', '#4a4326', '#b38c3c'][k % 4]);
        }
      }
    } else {
      // Chopped chicken and long gyro shavings have different silhouettes and crust colours.
      for (let j = 0; j < (dish === 1 ? 29 : 49); j++) {
        const seed = dish * 700 + j + 2200;
        const px = 25 + rand(seed) * (dish === 1 ? 59 : 50), py = 25 + rand(seed + 131) * 57;
        const angle = dish === 1 ? -0.7 : rand(seed + 47) * 3;
        const rx = dish === 1 ? 8 + rand(seed + 58) * 5 : 3.3 + rand(seed + 58) * 4;
        const ry = dish === 1 ? 2.8 : 3.4 + rand(seed + 59) * 2;
        ellipse(px + 1, py + 2, rx + 1, ry + 0.5, '#513922', angle);
        shaded(px, py, rx, ry, dish === 1 ? '#997347' : '#cf954c', '#794722', angle);
        ellipse(px - 1.4, py + 1, rx * 0.70, 0.55, '#5d3b23', angle);
      }
      if (dish === 1) {
        // Bread folded over the lower edge, with toasted pores, distinct from the filling.
        shaded(49, 82, 38, 15, '#e3c68e', '#927042', 0.57);
        for (let j = 0; j < 30; j++) {
          const px = 24 + rand(j + 4111) * 47, py = 70 + rand(j + 4193) * 22;
          ellipse(px, py, 0.5 + rand(j + 4159) * 1.7, 0.65, '#a17b47', 0.57);
        }
      }
    }
    // Fine white / hot sauce drizzles, with slight shadows rather than flat white icons.
    g.lineCap = 'round';
    for (const [color, width, dy] of [['#695738', 3.1, 1.5], ['#e6ddba', 2.1, 0], ['#bd4e27', 1.0, 5]] as const) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(30, 34 + dy);
      g.bezierCurveTo(82, 45 + dy, 15, 53 + dy, 61, 58 + dy);
      g.bezierCurveTo(93, 67 + dy, 30, 70 + dy, 68, 80 + dy);
      g.stroke();
    }
    // Subtle exposure falloff and print grain bind the ingredients into one image.
    const vignette = g.createRadialGradient(55, 41, 22, 64, 54, 79);
    vignette.addColorStop(0, 'rgba(25,18,8,0)');
    vignette.addColorStop(1, 'rgba(25,18,8,0.32)');
    g.fillStyle = vignette;
    g.fillRect(0, 0, 128, 98);
    for (let j = 0; j < 650; j++) {
      g.fillStyle = j % 2 ? 'rgba(250,231,187,0.10)' : 'rgba(36,25,15,0.09)';
      g.fillRect(rand(j + dish * 139 + 4700) * 128, rand(j + dish * 571 + 5100) * 96, 0.8, 1.1);
    }
    g.fillStyle = '#661e15';
    g.fillRect(0, 97, 128, 15);
    g.fillStyle = '#edcc8e';
    g.font = `bold 9px ${FONT_HELV}`;
    g.fillText(labels[dish], 64, 105, 120);
    // Scuffed laminate edges, not scratches repeated across the food itself.
    g.fillStyle = 'rgba(227,207,166,0.22)';
    g.fillRect(1, 4, 0.8, 54);
    g.fillRect(7, 110, 51, 0.6);
    g.restore();
  }
  g.restore();
  // Dedicated, readable counter fascia rather than another row of tiny plates.
  // HALAL FOOD is visible in the reference; surrounding branding remains fictional.
  g.save();
  g.beginPath();
  g.rect(0, 51, 384, 13);
  g.clip();
  const fascia = g.createLinearGradient(0, 51, 384, 64);
  fascia.addColorStop(0, '#23472b');
  fascia.addColorStop(0.18, '#8f2b1b');
  fascia.addColorStop(0.5, '#b87a3d');
  fascia.addColorStop(0.82, '#8f2b1b');
  fascia.addColorStop(1, '#23472b');
  g.fillStyle = fascia;
  g.fillRect(0, 51, 384, 13);
  g.font = `bold 17px ${FONT_GOTHIC}`;
  g.lineWidth = 1.6;
  g.strokeStyle = '#571b12';
  g.save();
  g.translate(192, 58);
  g.scale(2.05, 1);
  g.strokeText('HALAL FOOD', 0, 0, 130);
  g.fillStyle = '#f2dba1';
  g.fillText('HALAL FOOD', 0, 0, 130);
  g.restore();
  for (const px of [35, 349]) {
    ellipse(px, 57.5, 5.8, 4.6, '#dbb772');
    ellipse(px + 2, 56.8, 4.6, 4.0, '#354b29');
  }
  g.restore();
  g.restore();
}

function drawLinkScreen(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const grad = g.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#1c3f8f');
  grad.addColorStop(0.5, '#1c9bd1');
  grad.addColorStop(1, '#0d2a5c');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(w * 0.2)}px ${FONT_HELV}`;
  g.fillText('Link', x + w / 2, y + h * 0.2);
  g.font = `${Math.round(w * 0.1)}px ${FONT_HELV}`;
  g.fillText('Free Wi-Fi', x + w / 2, y + h * 0.33);
  g.font = `bold ${Math.round(w * 0.28)}px ${FONT_HELV}`;
  g.fillText('72°', x + w / 2, y + h * 0.55);
  g.font = `${Math.round(w * 0.09)}px ${FONT_HELV}`;
  g.fillText('Midtown', x + w / 2, y + h * 0.7);
  g.fillText('Tap for maps', x + w / 2, y + h * 0.88);
}

function drawShelterAd(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  // refs/_sheets/fifth-42nd.png: broad pink/white blocks only; the distant print is unreadable.
  // Keep authored copy, not a purported reconstruction of the obscured reference advertisement.
  // Only this existing fixed slot changes. Dark ink stays dark when the lightbox is on.
  g.fillStyle = '#eeeae8';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#be557f';
  g.fillRect(x, y, w, h * 0.70);
  g.fillStyle = '#f1ebee';
  g.fillRect(x + w * 0.09, y + h * 0.09, w * 0.20, h * 0.012);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(w * 0.185)}px ${FONT_HELV}`;
  g.fillText('NEW YORK', x + w / 2, y + h * 0.27, w * 0.86);
  g.fillText('IS FOR', x + w / 2, y + h * 0.39, w * 0.86);
  g.fillText('WALKING', x + w / 2, y + h * 0.51, w * 0.86);
  g.fillStyle = '#72304e';
  g.font = `${Math.round(w * 0.065)}px ${FONT_HELV}`;
  g.fillText('nyc.gov/dot', x + w / 2, y + h * 0.85);
  g.strokeStyle = 'rgba(65,47,58,0.22)'; g.lineWidth = Math.max(1, w * 0.012);
  g.strokeRect(x + w * 0.01, y + h * 0.01, w * 0.98, h * 0.98);
}

const LINE_COLORS: Record<string, string> = {
  A: '#0039a6', C: '#0039a6', E: '#0039a6',
  B: '#ff6319', D: '#ff6319', F: '#ff6319', M: '#ff6319',
  N: '#fccc0a', Q: '#fccc0a', R: '#fccc0a', W: '#fccc0a',
  '1': '#ee352e', '2': '#ee352e', '3': '#ee352e',
  '4': '#00933c', '5': '#00933c', '6': '#00933c',
  '7': '#b933ad', L: '#a7a9ac', G: '#6cbe45', J: '#996633', Z: '#996633', S: '#808183', T: '#00add0',
};

/** Subway-only artwork; named stations reuse the same slot layout and shared texture allocation. */
function drawSubwaySign(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lines: string): void {
  g.fillStyle = '#101414';
  g.fillRect(x, y, w, h);
  const sh = h - 2, sw = (w - 2) * SUBWAY_SIGN_FRAC;
  const sx = x + 1, sy = y + 1, margin = sh * 0.14;
  g.fillStyle = '#e2e4df';
  g.fillRect(sx + margin, sy + 2, sw - margin * 2, 1.5);
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const [routes, title = 'Subway', subtitle = 'Station'] = lines.split('|');
  const bullets = [...new Set(routes.toUpperCase().split(/\s+/).filter(s => LINE_COLORS[s]))].slice(0, 10);
  const longRoutes = bullets.length > 3;
  const gap = sh * 0.075;
  const r = sh * (longRoutes ? 0.125 : 0.135);
  const bulletW = bullets.length * r * 2 + Math.max(0, bullets.length - 1) * gap;
  const titleW = sw - margin * 2 - (longRoutes || !bullets.length ? 0 : bulletW + gap);
  // Reference: paired white station-name lines, routes beside the first, small transit footer.
  // Keep the resolved station/routes: the PABT slot gets blue A/C/E, 5 Avenue retains its 7.
  // Reference's paired lines have one type size, including the longer Port Authority title.
  // Fit both against the actual font metrics; never stretch a station name or crowd its routes.
  let stationSize = Math.round(sh * (longRoutes ? 0.27 : 0.31));
  g.font = `bold ${stationSize}px ${FONT_HELV}`;
  while (stationSize > 1 && (g.measureText(title).width > titleW ||
      g.measureText(subtitle).width > sw - margin * 2)) {
    g.font = `bold ${--stationSize}px ${FONT_HELV}`;
  }
  g.fillText(title, sx + margin, sy + sh * (longRoutes ? 0.26 : 0.25), titleW);
  g.fillText(subtitle, sx + margin, sy + sh * 0.55, sw - margin * 2);
  const bulletY = sy + sh * (longRoutes ? 0.81 : 0.25);
  let cx = longRoutes ? sx + margin : sx + sw - margin - bulletW;
  for (const key of bullets) {
    g.fillStyle = LINE_COLORS[key];
    g.beginPath();
    g.arc(cx + r, bulletY, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'NQRW'.includes(key) ? '#151515' : '#eeeeea';
    g.font = `bold ${Math.round(r * 1.5)}px ${FONT_HELV}`;
    g.textAlign = 'center';
    g.fillText(key, cx + r, bulletY + 0.5);
    cx += r * 2 + gap;
  }
  if (!longRoutes) {
    g.fillStyle = '#e2e4df';
    g.textAlign = 'left';
    g.font = `bold ${Math.round(sh * 0.15)}px ${FONT_HELV}`;
    g.fillText('SUBWAY', sx + margin, sy + sh * 0.87);
    g.font = `${Math.round(sh * 0.11)}px ${FONT_HELV}`;
    g.textAlign = 'right';
    g.fillText('New York City Transit', sx + sw - margin, sy + sh * 0.87, sw * 0.58);
  }
  // The small plate reuses the otherwise unused right side of this subway's own dynamic slot.
  const px = sx + (w - 2) * SUBWAY_PLATE_U, pw = (w - 2) * (1 - SUBWAY_PLATE_U);
  g.fillStyle = '#0039a6';
  g.fillRect(px, sy, pw, sh * 0.28);
  g.fillStyle = '#e2e4df';
  g.textAlign = 'left';
  g.font = `bold ${Math.round(sh * 0.20)}px ${FONT_HELV}`;
  g.fillText('MTA', px + 5, sy + sh * 0.15, pw - 10);
  g.font = `bold ${Math.round(sh * 0.16)}px ${FONT_HELV}`;
  g.fillText('New York City', px + 5, sy + sh * 0.46, pw - 10);
  g.fillText('Transit', px + 5, sy + sh * 0.65, pw - 10);
  g.font = `${Math.round(sh * 0.12)}px ${FONT_HELV}`;
  g.fillText('Subway Station', px + 5, sy + sh * 0.86, pw - 10);
}

/** Fictional editorial covers and unbranded wrappers, only sampled by the newsstand.
 * Close evidence: refs/_general/newsstand-1.jpg — varied photography/layouts, overlapping
 * issues, foil packets and folded papers. Tiny copy is authored texture, not claimed source text. */
function drawNewsstand(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.save();
  g.translate(x, y);
  g.scale(w / NEWSSTAND_W, h / NEWSSTAND_H);
  g.fillStyle = '#334536';
  g.fillRect(0, 0, NEWSSTAND_W, NEWSSTAND_H);
  const titles = ['CITYFOLIO', 'NINTH & CO.', 'METROFORM', 'TABLE / 42',
    'BOROUGH INK', 'WEEKENDISH', 'EAST / ELSEWHERE', 'NORTHBLOCK',
    'CURBSIDE EDIT', 'AFTERHOURS / NYC', 'FRAME / 21', 'GREENBOROUGH',
    'CROSS / TOWN', 'SIDEWALKER', 'KINETIC / NYC', 'THE DAILY BLOCK'];
  const fields = ['#d97185', '#eee2d8', '#345363', '#da9d46', '#f0e8de', '#c1626b', '#f1d0d3', '#d6bea5',
    '#ad474d', '#ede3d2', '#e84b60', '#e3b49e', '#e4daca', '#bb5762', '#ece6dc', '#b54d3c'];
  const skins = ['#bf8a6d', '#e5bba0', '#93634a', '#d5a47e', '#ab775b', '#ebc5ad'];
  const ink = '#eee8d7';
  let seed = 517;
  const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  // Small editorial portraits: different crops/poses, not the same oval stamped on every cover.
  // These are invented people and layouts, not reconstructions of unreadable source details.
  const portrait = (cx: number, cy: number, scale: number, variant: number, profile = false) => {
    g.save(); g.translate(cx, cy); g.rotate((variant % 3 - 1) * 0.075); g.scale(scale, scale);
    const skin = skins[variant % skins.length];
    const hair = ['#3c2621', '#b89b6b', '#262321', '#9b6b48', '#d0b68a', '#54352a'][variant % 6];
    const longHair = variant % 3 !== 2;
    const hairShade = g.createLinearGradient(-15, 0, 17, 13);
    hairShade.addColorStop(0, hair); hairShade.addColorStop(0.65, hair); hairShade.addColorStop(1, '#392a25');
    g.fillStyle = hairShade;
    g.beginPath(); g.ellipse(-1, longHair ? 6 : -4, 14, longHair ? 27 : 16, -0.06, 0, Math.PI * 2); g.fill();
    const coat = g.createLinearGradient(-22, 24, 25, 59);
    coat.addColorStop(0, ['#d0b99e', '#702e3f', '#e5d7ca', '#2c3035', '#9b3e36', '#47443e'][variant % 6]);
    coat.addColorStop(1, variant % 2 ? '#3c3334' : '#766557');
    g.fillStyle = coat;
    g.beginPath(); g.moveTo(-6, 17); g.bezierCurveTo(-13, 23, -23, 22, -27, 36);
    g.lineTo(-31, 76); g.lineTo(29, 76); g.lineTo(24, 35); g.bezierCurveTo(19, 24, 11, 24, 5, 18); g.closePath(); g.fill();
    const neck = g.createLinearGradient(-5, 10, 6, 25);
    neck.addColorStop(0, '#8f604a'); neck.addColorStop(1, skin);
    g.fillStyle = neck;
    g.beginPath(); g.moveTo(-5, 8); g.lineTo(-6, 22); g.quadraticCurveTo(1, 30, 7, 22); g.lineTo(5, 9); g.fill();
    const face = g.createLinearGradient(-11, -8, 12, 7);
    face.addColorStop(0, '#8b5e48'); face.addColorStop(0.27, skin); face.addColorStop(0.68, skin); face.addColorStop(1, '#aa7659');
    g.fillStyle = face;
    g.beginPath(); g.moveTo(-9, -9);
    g.bezierCurveTo(-6, -16, 7, -15, 10, -8);
    if (profile) {
      g.bezierCurveTo(10, -4, 10, -1, 14, 2); g.lineTo(10, 4);
      g.bezierCurveTo(12, 10, 7, 15, 3, 16);
    } else {
      g.bezierCurveTo(13, 1, 8, 14, 2, 16);
    }
    g.bezierCurveTo(-3, 17, -9, 10, -10, 3); g.bezierCurveTo(-12, -3, -11, -6, -9, -9); g.fill();
    g.fillStyle = hairShade;
    g.beginPath(); g.moveTo(-12, 7); g.bezierCurveTo(-18, -15, -3, -22, 8, -15);
    g.bezierCurveTo(14, -11, 14, -5, 11, 0); g.lineTo(7, -10);
    g.bezierCurveTo(3, -14, -1, -3, -8, -5); g.lineTo(-9, 10); g.closePath(); g.fill();
    if (longHair) {
      g.beginPath(); g.moveTo(-10, 0); g.bezierCurveTo(-8, 15, -7, 26, -15, 37);
      g.lineTo(-18, 29); g.lineTo(-14, -3); g.fill();
    }
    // Soft brows, eyelids and a shaded nose; no oversized cartoon eye dots.
    g.strokeStyle = '#654337'; g.lineWidth = 0.65;
    g.beginPath(); g.moveTo(3, -2); g.quadraticCurveTo(6, -3, 8, -1);
    if (!profile) { g.moveTo(-7, -2); g.quadraticCurveTo(-5, -3, -3, -2); } g.stroke();
    g.strokeStyle = '#9a6a54'; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(1, 0); g.lineTo(0, 5); g.lineTo(3, 6); g.stroke();
    g.strokeStyle = variant % 2 ? '#9b4f50' : '#8d5a4d'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(profile ? 5 : -2, 10); g.quadraticCurveTo(3, 11, profile ? 9 : 6, 9); g.stroke();
    g.strokeStyle = 'rgba(249,223,197,0.28)'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(-7, 2); g.quadraticCurveTo(-6, 6, -4, 7); g.stroke();
    g.strokeStyle = 'rgba(238,221,200,0.48)'; g.lineWidth = 0.65;
    g.beginPath(); g.moveTo(-9, 23); g.lineTo(-2, 39); g.lineTo(9, 23); g.stroke();
    g.restore();
  };
  for (let id = 0; id < 16; id++) {
    g.save();
    g.translate((id % 4) * 64 + 2, Math.floor(id / 4) * 96 + 2);
    g.beginPath(); g.rect(0, 0, 60, 92); g.clip();
    const bg = g.createLinearGradient(0, 0, 60, 92);
    bg.addColorStop(0, fields[id]); bg.addColorStop(1, id % 3 === 0 ? '#a8786c' : '#ded0bf');
    g.fillStyle = bg; g.fillRect(0, 0, 60, 92);
    const theme = id === 2 || id === 12 ? 2 : id === 3 ? 3 : id === 9 ? 4 : id % 2;
    if (theme === 0 || theme === 1) {
      if (id === 8 || id === 13) {
        // Duo / interview cover, with two different depths and head sizes.
        portrait(18, 45, 0.82, id + 2); portrait(43, 49, 0.93, id + 5, id === 13);
      } else if (id === 4 || id === 11) {
        // Three-quarter fashion figure leaves a broad column for editorial copy.
        portrait(id === 4 ? 40 : 21, 33, 0.74, id + 1);
      } else if (id === 6 || id === 14) {
        portrait(id === 6 ? 23 : 34, 43, 1.18, id + 3, true);
      } else if (id === 0 || id === 10 || id === 15) {
        // Face close-ups, cropped asymmetrically, alternate with the smaller figures.
        portrait(id === 10 ? 25 : 40, id === 15 ? 48 : 44, id === 0 ? 1.52 : 1.35, id + 1);
      } else {
        portrait(id % 2 ? 36 : 24, 43 + id % 3, 1.0, id + 2);
      }
    } else if (theme === 2) {
      // Architectural city photograph composition, not another head-and-shoulders cover.
      for (let i = 0; i < 7; i++) {
        const bw = 7 + rand() * 7, bh = 25 + rand() * 35, bx = i * 9 - 4;
        g.fillStyle = ['#847d6d', '#414a4b', '#a7a28c'][i % 3];
        g.fillRect(bx, 76 - bh, bw, bh);
        g.fillStyle = '#cfb787';
        for (let a = 0; a < 3; a++) for (let b = 0; b < 8; b++) if (rand() > 0.33) g.fillRect(bx + 2 + a * 3, 79 - bh + b * 5, 1, 2);
      }
      g.fillStyle = '#62635b'; g.fillRect(0, 76, 60, 16);
      g.strokeStyle = '#aca791'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, 89); g.lineTo(37, 76); g.lineTo(60, 87); g.stroke();
    } else if (theme === 3) {
      // Food/lifestyle cover: crockery and small ingredients over a warm tabletop.
      g.fillStyle = '#6b563f'; g.fillRect(0, 24, 60, 68);
      g.fillStyle = '#e4d9bb'; g.beginPath(); g.ellipse(32, 58, 26, 23, -0.35, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#bfa171'; g.beginPath(); g.ellipse(32, 58, 20, 17, -0.35, 0, Math.PI * 2); g.fill();
      for (let n = 0; n < 55; n++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand());
        g.fillStyle = ['#748045', '#a14b31', '#d2ac63', '#d5c9a2'][n % 4];
        g.beginPath(); g.ellipse(32 + Math.cos(a) * r * 18, 58 + Math.sin(a) * r * 15, 2 + rand() * 3, 1.4 + rand() * 2, a, 0, Math.PI * 2); g.fill();
      }
    } else {
      // Travel/landscape: layered ridgelines and water, unique to these issues.
      for (let layer = 0; layer < 4; layer++) {
        g.fillStyle = ['#899b96', '#607b70', '#465f50', '#29453e'][layer];
        g.beginPath(); g.moveTo(0, 91);
        for (let q = 0; q < 7; q++) g.lineTo(q * 10, 35 + layer * 10 + rand() * 15);
        g.lineTo(60, 92); g.closePath(); g.fill();
      }
      g.fillStyle = '#79928e';
      g.beginPath(); g.moveTo(31, 64); g.lineTo(43, 64); g.lineTo(56, 92); g.lineTo(16, 92); g.closePath(); g.fill();
    }
    // Fine tonal print grain, deterministic and deliberately weak at this small scale.
    for (let n = 0; n < 200; n++) {
      g.fillStyle = n % 2 ? 'rgba(240,230,209,0.07)' : 'rgba(18,23,23,0.08)';
      g.fillRect(rand() * 60, 18 + rand() * 74, 0.7, 0.7);
    }
    const darkType = [1, 4, 6, 7, 9, 11, 12, 14].includes(id);
    const accent = [1, 4, 6, 11, 14].includes(id) ? '#b52f4c' : '#25292a';
    if (id === 8 || id === 13) { g.fillStyle = '#f2e4d9'; g.fillRect(0, 0, 60, 18); }
    g.fillStyle = darkType || id === 8 || id === 13 ? accent : ink;
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.font = `${id % 3 === 0 ? 'italic ' : 'bold '}${id % 4 === 0 ? 10 : 8}px ${id % 3 === 0 ? 'Georgia, serif' : FONT_HELV}`;
    g.fillText(titles[id], 30, 3, 56);
    g.font = `2.5px ${FONT_HELV}`; g.fillText(`NEW YORK  /  ISSUE ${24 + id}  /  $6.00`, 30, 15, 54);
    g.textAlign = id % 2 ? 'right' : 'left';
    const tx = id % 2 ? 57 : 3;
    g.fillStyle = darkType ? '#403534' : ink;
    // Asymmetric cover lines break the repeated head + caption template at thumbnail size.
    const sideX = id === 4 || id === 0 || id === 15 ? 3 : 57;
    g.textAlign = sideX === 3 ? 'left' : 'right';
    g.font = `bold ${id % 3 === 0 ? 9 : 7}px ${FONT_HELV}`;
    g.fillText(['35', 'NOW', 'STYLE', '12'][id % 4], sideX, 30 + id % 3 * 3, 22);
    g.font = `bold 3.3px ${FONT_HELV}`;
    for (let line = 0; line < 3; line++) g.fillText(['FRESH IDEAS', 'CITY PEOPLE', 'NEW SEASON'][line], sideX, 42 + line * 4, 22);
    if (id === 1 || id === 10 || id === 13) {
      g.fillStyle = id === 1 ? '#b72f4d' : '#ecdfce'; g.fillRect(1, 71, 58, 11);
      g.fillStyle = id === 1 ? ink : '#9c3043';
    }
    g.textAlign = id % 2 ? 'right' : 'left';
    g.font = `bold 4px ${FONT_HELV}`;
    g.fillText(['THE CITY', 'NEW IDEAS', 'WEEKEND', 'AT HOME'][id % 4], tx, 68, 28);
    g.font = `bold ${id % 2 ? 8 : 6}px ${FONT_HELV}`;
    g.fillText(['24', 'FRESH', 'LOCAL', 'ESCAPE'][id % 4], tx, 74, 30);
    g.font = `2.4px ${FONT_HELV}`;
    g.fillText('PEOPLE  PLACES  STORIES', tx, 86, 34);
    g.fillStyle = '#dfdcd1'; g.fillRect(id % 2 ? 3 : 48, 84, 9, 6);
    g.fillStyle = '#393b35';
    for (let n = 0; n < 7; n++) g.fillRect((id % 2 ? 4 : 49) + n, 85, n % 3 === 0 ? 0.6 : 0.3, 3);
    // Fold/shadow on the bound edge survives mipmapping without making a black frame.
    g.fillStyle = 'rgba(30,28,24,0.22)'; g.fillRect(0, 0, 1.2, 92);
    g.restore();
  }
  const wrappers = ['#ae3029', '#d6ab2d', '#367291', '#548444', '#92557d', '#d38535', '#923c2c', '#c8c0a3'];
  for (let id = 0; id < 8; id++) {
    g.save(); g.translate((id % 4) * 64 + 2, 400 + Math.floor(id / 4) * 80 + 2);
    const foil = g.createLinearGradient(0, 0, 60, 0);
    foil.addColorStop(0, '#716951'); foil.addColorStop(0.13, wrappers[id]);
    foil.addColorStop(0.65, wrappers[id]); foil.addColorStop(1, '#514638');
    g.fillStyle = foil; g.fillRect(0, 0, 60, 76);
    g.fillStyle = '#d1c4a1'; g.fillRect(0, 0, 60, 4); g.fillRect(0, 72, 60, 4);
    g.fillStyle = 'rgba(253,238,197,0.17)'; g.fillRect(5, 5, 2, 65); g.fillRect(53, 5, 1, 64);
    g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillStyle = '#f8ebc4';
    g.font = `italic bold 13px ${FONT_HELV}`; g.fillText(['CRUNCH', 'CORN', 'MINT', 'SOURS', 'CHEWS', 'NUTS', 'COCOA', 'OAT'][id], 30, 23, 53);
    g.font = `bold 5px ${FONT_HELV}`; g.fillText(['SEA SALT', 'GOLDEN', 'COOL', 'FRUIT', 'BERRY', 'ROASTED', 'DARK', 'HONEY'][id], 30, 34, 50);
    for (let n = 0; n < 9; n++) {
      g.fillStyle = id === 3 || id === 4 ? ['#d96443', '#aaba58', '#d3a66d'][n % 3] : ['#debd75', '#c59954', '#ebcd8a'][n % 3];
      g.beginPath(); g.ellipse(13 + rand() * 35, 45 + rand() * 19, 4 + rand() * 4, 3 + rand() * 3, rand(), 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(35,25,21,0.25)';
    for (let n = 0; n < 20; n++) { g.fillRect(n * 3, 0, 0.6, 4); g.fillRect(n * 3, 72, 0.6, 4); }
    g.restore();
  }
  // Two folded editions occupy only this newsstand's existing gutter. Printed top sheets
  // have different layouts; page thickness and offset folded edges come from geometry.
  for (let edition = 0; edition < 2; edition++) {
    g.save(); g.translate(2 + edition * 128, 578);
    g.fillStyle = edition ? '#dcd8ca' : '#d8d2bf'; g.fillRect(0, 0, 124, 92);
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#353a34';
    g.font = 'bold 11px Georgia, serif'; g.fillText(edition ? 'Borough Dispatch' : 'The Daily Block', 62, 3, 116);
    g.fillRect(4, 17, 116, 1);
    g.font = `bold 6px ${FONT_HELV}`; g.fillText(edition ? 'NEIGHBOURHOOD NOTES' : 'A NEW CHAPTER FOR THE CITY', 62, 21, 116);
    const photoX = edition ? 5 : 43;
    g.fillStyle = '#788582'; g.fillRect(photoX, 34, 37, 27);
    g.fillStyle = '#515e5b';
    for (let n = 0; n < 7; n++) g.fillRect(photoX + n * 5, 40 + (n % 3) * 5, 4, 21 - (n % 3) * 5);
    g.fillStyle = '#77766a';
    for (let col = 0; col < 5; col++) for (let line = 0; line < 24; line++) {
      if ((edition ? col < 2 : col === 2 || col === 3) && line < 13) continue;
      g.fillRect(5 + col * 23, 34 + line * 2.15, 18 + rand() * 3, 0.55);
    }
    g.fillStyle = '#beb9a8'; g.fillRect(0, 88, 124, 2); g.restore();
  }
  // Unused gutter between awning and lottery art: closely spaced folded-page striations.
  // Only each paper section's narrow spine samples this; the shelf void remains geometry.
  g.save(); g.translate(2, 734);
  g.fillStyle = '#d2ccba'; g.fillRect(0, 0, 252, 28);
  for (let line = 0; line < 9; line++) {
    g.strokeStyle = line % 3 === 0 ? '#9e9685' : '#bbb3a0'; g.lineWidth = line % 3 === 0 ? 0.9 : 0.6;
    g.beginPath(); g.moveTo(0, 2 + line * 3);
    g.bezierCurveTo(65, 1 + line * 3, 173, 3 + line * 3, 252, 2 + line * 3); g.stroke();
  }
  g.fillStyle = 'rgba(118,70,59,0.35)'; g.fillRect(0, 2, 252, 1.1);
  g.restore();
  // Small wraparound bottle labels: no transparent materials or new atlas allocation.
  for (let id = 0; id < 2; id++) {
    g.save(); g.translate(130 + id * 64, 674);
    g.fillStyle = id ? '#dce6da' : '#225946'; g.fillRect(0, 0, 60, 28);
    g.fillStyle = id ? '#457f96' : '#c8d8b2'; g.fillRect(0, 1, 60, 4); g.fillRect(0, 23, 60, 4);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = id ? '#244f68' : '#f2eed2';
    g.font = `bold 10px ${FONT_HELV}`; g.fillText(id ? 'WATER' : 'ICED TEA', 30, 12, 55);
    g.font = `4px ${FONT_HELV}`; g.fillText(id ? 'SPRING  /  STILL' : 'LEMON  /  BREWED', 30, 20, 52);
    g.restore();
  }
  // Landscape wrappers are drawn for candy bars/gum, never stretched portrait bag artwork.
  for (let id = 0; id < 8; id++) {
    g.save(); g.translate((id % 2) * 128 + 2, 882 + Math.floor(id / 2) * 32);
    const foil = g.createLinearGradient(0, 0, 0, 28);
    foil.addColorStop(0, '#e4d8ae'); foil.addColorStop(0.18, wrappers[id]);
    foil.addColorStop(0.62, wrappers[id]); foil.addColorStop(1, '#655746');
    g.fillStyle = foil; g.fillRect(0, 0, 124, 28);
    g.fillStyle = '#c7bba2'; g.fillRect(0, 0, 5, 28); g.fillRect(119, 0, 5, 28);
    g.fillStyle = '#f7ebcf'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `italic bold 15px ${FONT_HELV}`;
    g.fillText(['CHOC / CRISP', 'CITRUS', 'COOL MINT', 'FRUIT CHEWS', 'BERRY MIX', 'NUT CRUNCH', 'DARK / COCOA', 'HONEY OAT'][id], 62, 11, 108);
    g.font = `bold 5px ${FONT_HELV}`; g.fillText('POCKET SIZE  •  FRESH FLAVOUR', 62, 22, 102);
    g.fillStyle = 'rgba(45,36,28,0.35)';
    for (let seam = 0; seam < 7; seam++) { g.fillRect(0, seam * 4, 5, 1); g.fillRect(119, seam * 4, 5, 1); }
    g.restore();
  }
  g.fillStyle = '#365d42'; g.fillRect(0, 704, 256, 24);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#eee6cb';
  g.font = `bold 12px ${FONT_HELV}`; g.fillText('NEWS  •  MAGAZINES  •  SNACKS', 128, 716, 242);
  g.fillStyle = '#e6c84a'; g.fillRect(0, 768, 256, 96);
  g.fillStyle = '#243f34'; g.fillRect(3, 771, 250, 13);
  g.fillStyle = '#f0e9ce'; g.font = `bold 8px ${FONT_HELV}`; g.fillText('PLAY HERE', 128, 778);
  g.fillStyle = '#243f34'; g.font = `bold 35px ${FONT_HELV}`; g.fillText('LOTTERY', 128, 810, 235);
  g.font = `bold 11px ${FONT_HELV}`; g.fillText('DAILY GAMES  •  SCRATCH CARDS', 128, 847, 229);
  g.fillRect(12, 833, 232, 1);
  g.restore();
}

/** Citi-only artwork. This helper never changes the layout/allocation of any sign-atlas slot. */
function drawCitiWordmark(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.save();
  g.translate(x + w * 0.5, y + h * 0.57);
  g.font = `bold ${h * 0.69}px ${FONT_HELV}`;
  const first = g.measureText('citi').width;
  g.font = `${h * 0.69}px ${FONT_HELV}`;
  const second = g.measureText('bike').width;
  const total = first + second + h * 0.04;
  g.scale(Math.min(1, w * 0.91 / total), 1);
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = '#f0f2ed';
  g.font = `bold ${h * 0.69}px ${FONT_HELV}`;
  g.fillText('citi', -total / 2, 0);
  g.font = `${h * 0.69}px ${FONT_HELV}`;
  g.fillText('bike', -total / 2 + first + h * 0.04, 0);
  g.strokeStyle = '#cf4549'; g.lineWidth = Math.max(1, h * 0.045);
  g.beginPath();
  g.moveTo(-total / 2 + first * 0.26, -h * 0.35);
  g.quadraticCurveTo(-total / 2 + first * 0.58, -h * 0.65, -total / 2 + first * 0.90, -h * 0.35);
  g.stroke(); g.restore();
}

/** One tiny lifetime-owned bike/dock decal skin, sampled only by Citi's aMat.z=-5 parts.
 * Separate from the station atlas, because dock/bike instances retain their original base material/data.
 */
export function makeCitiBikeMark(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#1f3f77'; g.fillRect(0, 0, 512, 128);
  drawCitiWordmark(g, 18, 16, 476, 98);
  // Logical portrait artwork becomes the lower half; transparent gaps expose the dock casting.
  // Top-to-bottom wordmark, as on the nearest dock in refs/_general/citibike-1.jpg.
  g.save(); g.translate(0, 128); g.scale(4, 0.25);
  g.translate(64, 256); g.rotate(Math.PI / 2);
  drawCitiWordmark(g, -230, -66, 460, 132);
  g.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'citibike-only-markings';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function drawCitiPanel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  g.fillStyle = '#d0d2cd'; g.fillRect(x, y, w, h);
  g.fillStyle = '#1f3f77'; g.fillRect(x, y, w, h * 0.14);
  drawCitiWordmark(g, x + w * 0.10, y + h * 0.018, w * 0.80, h * 0.095);
  // Recessed display, neutral LCD and restrained printed instructions, not a luminous blue pillar.
  g.fillStyle = '#242d32'; g.fillRect(x + w * 0.10, y + h * 0.18, w * 0.80, h * 0.245);
  g.fillStyle = '#9caeaf'; g.fillRect(x + w * 0.16, y + h * 0.20, w * 0.68, h * 0.19);
  g.fillStyle = '#30424a';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(w * 0.09)}px ${FONT_HELV}`;
  g.fillText('Get a bike', x + w / 2, y + h * 0.25, w * 0.62);
  g.fillStyle = '#d1dbd5'; g.fillRect(x + w * 0.23, y + h * 0.30, w * 0.54, h * 0.055);
  g.fillStyle = '#2a3438';
  g.font = `${Math.round(w * 0.075)}px ${FONT_HELV}`;
  g.fillText('START', x + w / 2, y + h * 0.327);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    g.fillStyle = '#5e6666';
    g.fillRect(x + w * (0.14 + col * 0.125), y + h * (0.455 + row * 0.031), w * 0.095, h * 0.022);
  }
  g.fillStyle = '#27373f';
  g.font = `${Math.round(w * 0.075)}px ${FONT_HELV}`;
  g.fillText('Ride. Return. Repeat.', x + w / 2, y + h * 0.605, w * 0.9);
  g.fillStyle = '#7c8582'; g.fillRect(x + w * 0.05, y + h * 0.655, w * 0.9, 1);
  // Diagrammatic station-area grid; no invented street names or claimed exact map geography.
  // This lower region alone is reused by the existing outboard station board.
  const mx = x + w * 0.04, my = y + h * 0.69, mw = w * 0.92, mh = h * 0.29;
  g.save(); g.beginPath(); g.rect(mx, my, mw, mh); g.clip();
  g.fillStyle = '#dbded5'; g.fillRect(mx, my, mw, mh);
  g.fillStyle = '#96b9c5'; g.fillRect(mx + mw * 0.77, my, mw * 0.25, mh);
  g.fillStyle = '#a8b394'; g.fillRect(mx + mw * 0.14, my + mh * 0.08, mw * 0.18, mh * 0.33);
  g.strokeStyle = '#f3f1e6'; g.lineWidth = Math.max(1.3, mw * 0.035);
  for (let i = 0; i < 8; i++) {
    g.beginPath(); g.moveTo(mx - mw * 0.15, my + mh * i / 7);
    g.lineTo(mx + mw * 0.80, my + mh * (i / 7 - 0.12)); g.stroke();
  }
  for (let i = 0; i < 5; i++) {
    g.beginPath(); g.moveTo(mx + mw * i / 6, my);
    g.lineTo(mx + mw * (i / 6 + 0.16), my + mh); g.stroke();
  }
  g.fillStyle = '#1f3f77';
  for (const [u, v] of [[0.2, 0.51], [0.49, 0.29], [0.55, 0.76], [0.68, 0.47]]) {
    g.beginPath(); g.arc(mx + mw * u, my + mh * v, Math.max(1.5, mw * 0.025), 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

/** Bus-only print: rounded blue/red head, independently stacked colored route panels.
 * halal-cart-1 resolves this silhouette/color arrangement, not fine print or stop-specific routes.
 * Retain placement's route names (X68 at the target), never copy the distant photo's routes.
 */
function drawBusSign(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, routes: string[]): void {
  const layout = BUS_SIGN_LAYOUT, blue = '#0039a6', light = '#f1f2ec';
  // Alpha belongs only to busSign's +6 selector. Clearing this existing cell cannot
  // change any other atlas slot, the shelter advertisement or the shared material opacity.
  g.clearRect(x, y, w, h);
  const cy = y + h * layout.headHeight / 2, radius = w / 2;
  g.save();
  g.beginPath(); g.arc(x + w / 2, cy, radius, 0, Math.PI * 2); g.clip();
  g.fillStyle = blue;
  g.fillRect(x, y, w, h * layout.headHeight);
  // The red lower chord is part of the round head, not a rectangular grey backing.
  g.fillStyle = '#c62e3a'; g.fillRect(x, y + h * 0.393, w, h * 0.107);
  g.fillStyle = light;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `bold ${Math.round(w * 0.12)}px ${FONT_HELV}`;
  g.fillText('MTA', x + w / 2, y + h * 0.10);
  // A front-view bus pictogram, large enough to survive the existing 62 px slot width.
  const bx = x + w * 0.25, by = y + h * 0.17, bw = w * 0.50, bh = h * 0.16;
  g.beginPath(); g.roundRect(bx, by, bw, bh, w * 0.035); g.fill();
  g.fillRect(bx + bw * 0.10, by + bh, bw * 0.17, h * 0.022);
  g.fillRect(bx + bw * 0.73, by + bh, bw * 0.17, h * 0.022);
  g.fillStyle = blue;
  g.fillRect(bx + bw * 0.09, by + bh * 0.13, bw * 0.82, bh * 0.43);
  for (const u of [0.14, 0.76]) g.fillRect(bx + bw * u, by + bh * 0.75, bw * 0.10, bh * 0.10);
  g.fillStyle = light;
  g.font = `bold ${Math.round(w * 0.085)}px ${FONT_HELV}`;
  g.fillText('BUS STOP', x + w / 2, y + h * 0.429, w * 0.66);
  g.strokeStyle = '#d8dedc'; g.lineWidth = w * 0.018;
  g.beginPath(); g.arc(x + w / 2, cy, radius - g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
  g.restore();

  const list = routes.length ? routes.slice(0, 4) : ['M42'];
  const gap = h * layout.routeGap;
  const panelH = Math.min(h * layout.routeMaxHeight,
    (h * (layout.routeBottom - layout.routeTop) - gap * (list.length - 1)) / list.length);
  const left = x + w * layout.routeInset, panelW = w * (1 - 2 * layout.routeInset);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < list.length; i++) {
    const top = y + h * layout.routeTop + i * (panelH + gap);
    // Express prefixes use green; other dynamic routes retain blue. Do not invent
    // extra routes to fill the stack: a single X68 leaves open air below its panel.
    g.fillStyle = /^(?:X|BxM|BM|QM|SIM)\d/i.test(list[i]) ? '#007c59' : blue;
    // Half a texel of lateral bleed keeps the thin sheet edges solid under filtering.
    g.fillRect(left - 0.5, top, panelW + 1, panelH);
    g.fillStyle = light;
    let fs = Math.min(w * 0.36, panelH * 0.69);
    g.font = `bold ${fs}px ${FONT_HELV}`;
    while (fs > 1 && g.measureText(list[i]).width > panelW * 0.88) {
      fs -= 0.5; g.font = `bold ${fs}px ${FONT_HELV}`;
    }
    g.fillText(list[i], x + w / 2, top + panelH * 0.51);
  }
}

export { drawStreetBlade, LINE_COLORS };
