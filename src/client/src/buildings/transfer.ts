import * as THREE from 'three';
import { mobileTextureUrl } from '@/core/quality';

/** Worker-owned arrays are transferred, then wrapped directly; never copied on the main thread. */
export interface PackedMesh {
  attributes: Record<string, { data: THREE.TypedArray; size: number; normalized: boolean }>;
  index: Uint16Array | Uint32Array | null;
  bounds: [number, number, number, number];
}
export function packMesh(g: THREE.BufferGeometry): PackedMesh {
  if (!g.boundingSphere) g.computeBoundingSphere();
  const b = g.boundingSphere!;
  const attributes: PackedMesh['attributes'] = {};
  for (const [name, a] of Object.entries(g.attributes)) attributes[name] = { data: a.array, size: a.itemSize, normalized: a.normalized };
  return { attributes, index: g.index?.array as PackedMesh['index'] ?? null, bounds: [b.center.x, b.center.y, b.center.z, b.radius] };
}
export function unpackMesh(p: PackedMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(p.attributes)) g.setAttribute(name, new THREE.BufferAttribute(a.data, a.size, a.normalized));
  if (p.index) g.setIndex(new THREE.BufferAttribute(p.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(...p.bounds.slice(0, 3)), p.bounds[3]);
  return g;
}

export interface PackedTexture {
  image: ImageBitmap | { data: Uint8Array; width: number; height: number };
  colorSpace: string;
  wrapS: THREE.Wrapping; wrapT: THREE.Wrapping;
  minFilter: THREE.MinificationTextureFilter; magFilter: THREE.MagnificationTextureFilter;
  generateMipmaps: boolean; anisotropy: number;
}
export async function packTexture(t: THREE.Texture): Promise<PackedTexture> {
  let image: PackedTexture['image'];
  if (t instanceof THREE.DataTexture) image = t.image as { data: Uint8Array; width: number; height: number };
  else {
    const bitmap = await createImageBitmap(t.image as ImageBitmapSource, {
      imageOrientation: t.flipY ? 'flipY' : 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none',
    });
    // Chrome can spend >50 ms converting a bitmap during texImage2D. Do that conversion
    // in this worker too, so the main thread only uploads already-oriented RGBA bytes.
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bitmap, 0, 0);
    const pixels = g.getImageData(0, 0, bitmap.width, bitmap.height);
    image = { data: new Uint8Array(pixels.data.buffer), width: bitmap.width, height: bitmap.height };
    bitmap.close();
  }
  return { image, colorSpace: t.colorSpace, wrapS: t.wrapS, wrapT: t.wrapT, minFilter: t.minFilter,
    magFilter: t.magFilter, generateMipmaps: t.generateMipmaps, anisotropy: t.anisotropy };
}
export function unpackTexture(p: PackedTexture): THREE.Texture {
  const t = 'data' in p.image ? new THREE.DataTexture(p.image.data, p.image.width, p.image.height) : new THREE.Texture(p.image);
  t.flipY = false;
  for (const key of ['colorSpace', 'wrapS', 'wrapT', 'minFilter', 'magFilter', 'generateMipmaps', 'anisotropy'] as const) Object.assign(t, { [key]: p[key] });
  t.needsUpdate = true;
  if (!('data' in p.image)) t.addEventListener('dispose', () => (p.image as ImageBitmap).close());
  return t;
}
export function transfers(value: unknown, out = new Set<Transferable>()): Transferable[] {
  if (ArrayBuffer.isView(value)) out.add(value.buffer as ArrayBuffer);
  else if (value instanceof ArrayBuffer || (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap)) out.add(value);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) transfers(child, out);
  return [...out];
}

/** Decode off the main thread, including the orientation formerly supplied by Texture.flipY. */
export async function bitmapTexture(url: string): Promise<THREE.Texture> {
  url = mobileTextureUrl(url);
  if (typeof Worker !== 'undefined') return decodePixels(url);
  const bitmap = await new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).loadAsync(url);
  const t = new THREE.Texture(bitmap);
  t.flipY = false;
  t.needsUpdate = true;
  t.addEventListener('dispose', () => bitmap.close());
  return t;
}

let decoder: Worker | undefined;
let sequence = 0;
const decodes = new Map<number, { resolve: (t: THREE.Texture) => void; reject: (error: Error) => void }>();
function decodePixels(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    if (!decoder) {
      try {
        decoder = new Worker(new URL('./texture.worker.ts', import.meta.url), { type: 'module', name: 'scene-textures' });
        decoder.onmessage = (event: MessageEvent<{ id: number; width: number; height: number; data: Uint8ClampedArray; mean: number[]; error?: string }>) => {
          const data = event.data, request = decodes.get(data.id);
          if (!request) return;
          decodes.delete(data.id);
          if (data.error) { request.reject(new Error(data.error)); return; }
          const texture = new THREE.DataTexture(new Uint8Array(data.data.buffer), data.width, data.height);
          texture.generateMipmaps = true;
          texture.minFilter = THREE.LinearMipmapLinearFilter;
          texture.magFilter = THREE.LinearFilter;
          texture.userData.linearMean = data.mean;
          texture.needsUpdate = true;
          request.resolve(texture);
        };
        const fail = () => {
          decoder?.terminate(); decoder = undefined;
          for (const request of decodes.values()) request.reject(new Error('texture decode worker failed'));
          decodes.clear();
        };
        decoder.onerror = event => { event.preventDefault(); fail(); };
        decoder.onmessageerror = fail;
      } catch (error) { reject(error); return; }
    }
    const id = ++sequence;
    decodes.set(id, { resolve, reject });
    try { decoder.postMessage({ id, url: new URL(url, location.href).href }); }
    catch (error) { decodes.delete(id); reject(error); }
  });
}

export interface ColliderChunk { position: Float32Array; index: Uint32Array; bin?: number }
/** Bound each native Rapier BVH build; preserve every triangle, winding and landmark boundary. */
export function splitCollider(position: Float32Array, index: Uint32Array,
  ranges: { start: number; count: number; bin: number }[] = []): ColliderChunk[] {
  const chunks: ColliderChunk[] = [];
  let start = 0;
  const append = (end: number, bin?: number) => {
    while (start < end) {
      const stop = Math.min(end, start + 384);
      const remap = new Map<number, number>(), p: number[] = [], idx = new Uint32Array(stop - start);
      for (let i = start; i < stop; i++) {
        const old = index[i];
        let n = remap.get(old);
        if (n === undefined) { n = remap.size; remap.set(old, n); p.push(position[old * 3], position[old * 3 + 1], position[old * 3 + 2]); }
        idx[i - start] = n;
      }
      chunks.push({ position: new Float32Array(p), index: idx, bin });
      start = stop;
    }
  };
  for (const r of ranges) { append(r.start); append(r.start + r.count, r.bin); }
  append(index.length);
  return chunks;
}
