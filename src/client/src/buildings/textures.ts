import { basePath as __launchBasePath, mountedFetch as __launchFetch } from '@/core/basePath';
/**
 * CC0 PBR texture overlays from client/public/assets/textures/manifest.json (appears progressively while the
 * asset pass runs). The facade shader is fully procedural without them; when present they add micro detail
 * (grain, weathering) scaled by the manifest's physical size. Tolerant of the manifest format.
 */
import * as THREE from 'three';
import { bitmapTexture } from './transfer';
import type { FacadeUniforms } from './material';

interface ManifestEntry {
  id?: string;
  name?: string;
  path?: string;
  dir?: string;
  physicalSizeM?: number | [number, number];
  sizePx?: [number, number];
  sizeM?: number;
  size?: number;
  maps?: Record<string, string>;
  files?: Record<string, string>;
  albedo?: string;
  color?: string;
  diffuse?: string;
  normal?: string;
  tags?: string[];
  category?: string;
}

const BASE = __launchBasePath('/assets/textures');
const loaded = new WeakSet<FacadeUniforms>();

function entries(m: unknown): ManifestEntry[] {
  if (!m) return [];
  if (Array.isArray(m)) return m as ManifestEntry[];
  const o = m as Record<string, unknown>;
  if (Array.isArray(o.textures)) return o.textures as ManifestEntry[];
  if (Array.isArray(o.items)) return o.items as ManifestEntry[];
  if (Array.isArray(o.entries)) return o.entries as ManifestEntry[];
  // object keyed by id
  return Object.entries(o)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([k, v]) => ({ id: k, ...(v as ManifestEntry) }));
}

function nameOf(e: ManifestEntry): string {
  return `${e.id ?? ''} ${e.name ?? ''} ${e.path ?? ''} ${e.dir ?? ''} ${(e.tags ?? []).join(' ')} ${e.category ?? ''}`.toLowerCase();
}

function resolveUrl(e: ManifestEntry, cand: string | undefined): string | null {
  if (!cand) return null;
  if (cand.startsWith('/') || cand.startsWith('http')) return cand;
  const dir = e.path ?? e.dir ?? '';
  if (dir) return `${BASE}/${dir.replace(/^\/?assets\/textures\/?/, '').replace(/\/$/, '')}/${cand}`.replace(/\/+/g, '/');
  return `${BASE}/${cand}`.replace(/\/+/g, '/');
}

function albedoUrl(e: ManifestEntry): string | null {
  const maps = e.maps ?? e.files ?? {};
  return resolveUrl(e, e.albedo ?? e.color ?? e.diffuse ?? maps.albedo ?? maps.color ?? maps.diffuse ?? maps.baseColor ?? maps.basecolor ?? maps.base_color ?? maps.diff);
}

function normalUrl(e: ManifestEntry): string | null {
  const maps = e.maps ?? e.files ?? {};
  return resolveUrl(e, e.normal ?? maps.normal ?? maps.nor ?? maps.normalGL ?? maps.nor_gl);
}

/** mean colour of a loaded image in linear RGB (for retinting a scan to a per-building colour) */
function meanLinear(t: THREE.Texture): [number, number, number] | null {
  if (t.userData.linearMean) return t.userData.linearMean as [number, number, number];
  try {
    const img = t.image as HTMLImageElement | ImageBitmap | undefined;
    if (!img || !img.width || !img.height) return null;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img as CanvasImageSource, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    const acc = [0, 0, 0];
    const toLin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    for (let i = 0; i < d.length; i += 4) { acc[0] += toLin(d[i] / 255); acc[1] += toLin(d[i + 1] / 255); acc[2] += toLin(d[i + 2] / 255); }
    const n = d.length / 4;
    return [acc[0] / n, acc[1] / n, acc[2] / n];
  } catch {
    return null;
  }
}

/** A scalar manifest size is the image width; preserve non-square scans' aspect ratio. */
export function physicalSizeOf(e: ManifestEntry, def: number): [number, number] {
  const s = e.physicalSizeM ?? e.sizeM ?? e.size;
  const positive = (v: unknown, fallback: number): number => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
  if (Array.isArray(s)) return [positive(s[0], def), positive(s[1], def)];
  const width = positive(s, def);
  const [px, py] = e.sizePx ?? [1, 1];
  return [width, width * positive(py, 1) / positive(px, 1)];
}

/** The bundled ashlar scan has two large blocks across and five courses vertically.
 * Its generic 3 m manifest size makes 1.5 m stones; facade units are 60 x 30 cm.
 * Keep unrelated scans and structural concrete panels at their declared sizes.
 */
export function facadeTextureSize(e: ManifestEntry, def: number): [number, number] {
  if (/limestone-block(?:\/|$)/.test(e.path ?? e.dir ?? '')) return [1.2, 1.5];
  return physicalSizeOf(e, def);
}

async function loadTex(url: string, renderer: THREE.WebGLRenderer, srgb = true, prepare?: (t: THREE.Texture) => Promise<void>): Promise<THREE.Texture | null> {
  try {
    const t = await bitmapTexture(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    await prepare?.(t);
    return t;
  } catch { return null; }
}

/** returns true when at least the brick overlay is available (and sets the uniforms) */
export async function loadFacadeTextures(renderer: THREE.WebGLRenderer, u: FacadeUniforms, prepare?: (t: THREE.Texture) => Promise<void>): Promise<boolean> {
  if (loaded.has(u)) return true;
  let manifest: unknown;
  try {
    const res = await __launchFetch(`${BASE}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return false;
    manifest = await res.json();
  } catch {
    return false;
  }
  const list = entries(manifest);
  if (!list.length) return false;
  const find = (...words: string[]): ManifestEntry | undefined => list.find((e) => words.every((w) => nameOf(e).includes(w)) && albedoUrl(e));
  const brick = find('brick') ?? find('bricks');
  const stone = find('limestone') ?? find('sandstone') ?? find('stone', 'wall') ?? find('stone');
  const concrete = find('concrete', 'panels') ?? find('concrete');
  const roof = find('roof', 'gravel') ?? find('gravel') ?? find('asphalt') ?? find('tar');
  if (!brick) return false;
  const brickN = normalUrl(brick);
  const [tb, ts, tc, tr, tbn] = await Promise.all([
    loadTex(albedoUrl(brick)!, renderer, true, prepare),
    stone ? loadTex(albedoUrl(stone)!, renderer, true, prepare) : Promise.resolve(null),
    concrete ? loadTex(albedoUrl(concrete)!, renderer, true, prepare) : Promise.resolve(null),
    roof ? loadTex(albedoUrl(roof)!, renderer, true, prepare) : Promise.resolve(null),
    brickN ? loadTex(brickN, renderer, false, prepare) : Promise.resolve(null),
  ]);
  if (!tb) { for (const t of [ts, tc, tr, tbn]) t?.dispose(); return false; }
  u.uTexBrick.value = tb;
  const mean = meanLinear(tb);
  if (mean) u.uTexBrickMean.value.set(mean[0], mean[1], mean[2]);
  if (tbn) { u.uTexBrickN.value = tbn; u.uTexBrickNK.value = 1; }
  u.uTexStone.value = ts ?? tb;
  u.uTexConcrete.value = tc ?? tb;
  u.uTexRoof.value = tr ?? tb;
  // A failed optional map uses the brick sampler, so it must also use the brick's dimensions.
  const brickSize = physicalSizeOf(brick, 1);
  const sizes = [brickSize, ts && stone ? facadeTextureSize(stone, 2) : brickSize, tc && concrete ? facadeTextureSize(concrete, 2) : brickSize, tr && roof ? physicalSizeOf(roof, 2) : brickSize];
  u.uTexScale.value.fromArray(sizes.map(([x]) => 1 / x));
  u.uTexScaleY.value.fromArray(sizes.map(([, y]) => 1 / y));
  loaded.add(u);
  console.info(`[buildings] textures: brick=${albedoUrl(brick)} stone=${stone ? albedoUrl(stone) : '-'} concrete=${concrete ? albedoUrl(concrete) : '-'} roof=${roof ? albedoUrl(roof) : '-'}`);
  return true;
}
