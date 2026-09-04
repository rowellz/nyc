/** iOS only. Retire upload sources after the driver has consumed them.
 * Context restoration is deliberately replaced by the crash guard's bounded retry.
 */
import * as THREE from 'three';
type UploadImage = CanvasImageSource & { width: number; height: number; depth?: number;
  data?: Uint8Array | null; cpuReleased?: boolean; close?: () => void };
let installed = false;
const dynamicSources = new WeakMap<THREE.Texture, () => unknown>();
/** Animation arrays and editable atlases are live simulation state, not upload copies. */
export function registerDynamicTexture(texture: THREE.Texture, source: () => unknown): void {
  if (installed) dynamicSources.set(texture, source);
}
export function prepareTextureUploads(renderer: THREE.WebGLRenderer): void {
  const init = renderer.initTexture.bind(renderer);
  renderer.initTexture = texture => { capTexture(texture); init(texture); };
  const render = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    const seen = new Set<THREE.Texture>();
    const prepare = (value: unknown) => {
      if (value instanceof THREE.Texture && !seen.has(value)) { seen.add(value); capTexture(value); }
    };
    scene.traverse(object => {
      const material = (object as THREE.Mesh).material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) {
        Object.values(m).forEach(prepare);
        const uniforms = (m as THREE.ShaderMaterial).uniforms;
        if (uniforms) for (const u of Object.values(uniforms)) {
          if (Array.isArray(u.value)) u.value.forEach(prepare); else prepare(u.value);
        }
      }
    });
    render(scene, camera);
  };
}
export const textureReleaseStats = { uploads: 0, releasedBytes: 0, resized: 0 };
export function installTextureRelease(): void {
  if (installed) return;
  installed = true;
  const updateSkeleton = THREE.Skeleton.prototype.update;
  THREE.Skeleton.prototype.update = function () {
    if (this.boneTexture) {
      const texture = this.boneTexture;
      registerDynamicTexture(texture, () => ({ data: this.boneMatrices, width: texture.image.width, height: texture.image.height }));
    }
    updateSkeleton.call(this);
  };
  const needsUpdate = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate')!.set!;
  // Covers loader textures, transferred worker textures, and procedural atlases,
  // including ones uploaded implicitly by renderer.render instead of initTexture.
  Object.defineProperty(THREE.Texture.prototype, 'needsUpdate', {
    configurable: true,
    set(this: THREE.Texture, value: boolean) {
      if (value && !this.isRenderTargetTexture) {
        const source = dynamicSources.get(this);
        if (source) this.image = source();
        else if ((this.image as UploadImage | null)?.cpuReleased) return;
      }
      needsUpdate.call(this, value);
    },
  });
  const callbacks = new WeakMap<THREE.Texture, (texture: THREE.Texture) => void>();
  Object.defineProperty(THREE.Texture.prototype, 'onUpdate', {
    configurable: true,
    get(this: THREE.Texture) { return callbacks.get(this); },
    set(this: THREE.Texture, callback: ((texture: THREE.Texture) => void) | null) {
      callbacks.set(this, texture => {
        callback?.(texture);
        if (texture.isRenderTargetTexture) return;
        const source = texture.source, image = source.data as UploadImage | null;
        if (!image || image.cpuReleased) return;
        // All sampler variants sharing this source can upload in the same draw.
        queueMicrotask(() => {
          if (source.data !== image) return;
          const { width, height, depth } = image;
          const dynamic = dynamicSources.get(texture);
          const working = dynamic?.();
          textureReleaseStats.uploads++;
          textureReleaseStats.releasedBytes += image.data?.byteLength || width * height * 4 || 0;
          // Keep only the owner's editable state; discard the GPU upload's copy.
          if (working !== image) {
            if (typeof image.close === 'function') image.close();
            else if (image instanceof HTMLImageElement) image.removeAttribute('src');
            else if (image instanceof HTMLCanvasElement || (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas)) image.width = image.height = 1;
            if (image.data) image.data = null;
          }
          source.data = { width, height, depth, data: null, cpuReleased: true };
          texture.mipmaps.length = 0;
        });
      });
    },
  });
  (window as any).__textureRelease = textureReleaseStats;
}
function capTexture(texture: THREE.Texture): void {
  const image = texture.image as UploadImage | null;
  if (texture.isRenderTargetTexture || !image || image.cpuReleased || image.depth || !image.width || !image.height || Math.max(image.width, image.height) <= 512) return;
  const scale = 512 / Math.max(image.width, image.height);
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
  if (image.data && ArrayBuffer.isView(image.data)) {
    const src = image.data as Uint8Array;
    const channels = src.length / (image.width * image.height);
    if (!Number.isInteger(channels) || channels < 1 || channels > 4) return;
    const Data = src.constructor as typeof Uint8Array;
    const data = new Data(width * height * channels);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * channels;
      for (let c = 0; c < channels; c++) data[(y * width + x) * channels + c] = src[from + c];
    }
    texture.image = { data, width, height };
  } else {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, width, height);
    if (!dynamicSources.has(texture)) image.close?.();
    texture.image = canvas;
  }
  textureReleaseStats.resized++;
}
