import { mobileTextureUrl } from '@/core/quality';
import type { GameContext } from '@/core/context';
import { buildScope, type BuildSteps } from '@/buildings/loading';
import { generateTextures, generateLeafCardsAsync, loadLeafSprites, type TexSet } from './textures';
import { textureList, unpackTextures } from './texture-transfer';
import type { TextureRequest } from './textures.worker';

type Request = TextureRequest extends infer T ? T extends TextureRequest ? Omit<T, 'id' | 'anisotropy'> : never : never;

/** Shares the scene builders' upload queue: one texture per RAF, published only
 * after upload. The busy token includes worker/bitmap decode and final commit. */
export class TextureLoading {
  private scope;
  private worker: Worker | null = null;
  private nextId = 0;
  private waiting = new Map<number, { resolve(value: unknown): void; reject(error: unknown): void }>();
  private disposed = false;
  private abort = new AbortController();
  constructor(private ctx: GameContext) {
    this.scope = buildScope(ctx);
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./textures.worker.ts', import.meta.url), { type: 'module', name: 'environment-textures' });
        this.worker.onmessage = ({ data }: MessageEvent<{ id: number; value?: unknown; error?: string }>) => {
          const waiter = this.waiting.get(data.id);
          this.waiting.delete(data.id);
          const value = unpackTextures(data.value);
          if (!waiter) { for (const t of textureList(value)) t.dispose(); return; }
          if (data.error) waiter.reject(new Error(data.error)); else waiter.resolve(value);
        };
        this.worker.onerror = event => { event.preventDefault(); this.stopWorker(new Error('Texture worker failed')); };
      } catch { this.stopWorker(new Error('Texture worker unavailable')); }
    }
  }

  private stopWorker(error: Error): void {
    this.worker?.terminate(); this.worker = null;
    for (const waiter of this.waiting.values()) waiter.reject(error);
    this.waiting.clear();
  }

  private async request<T>(request: Request, fallback: () => Promise<T>): Promise<T> {
    if (this.disposed) throw new DOMException('Environment disposed', 'AbortError');
    if (this.worker) {
      try {
        return await new Promise<T>((resolve, reject) => {
          const id = ++this.nextId;
          this.waiting.set(id, { resolve: value => resolve(value as T), reject });
          this.worker!.postMessage({ ...request, id, anisotropy: this.ctx.renderer.capabilities.getMaxAnisotropy() } satisfies TextureRequest);
        });
      } catch (error) { if (this.disposed) throw error; }
    }
    return fallback();
  }

  hold(label: string) { return this.scope.job(label); }

  async load<T>(label: string, make: () => Promise<T>): Promise<T> {
    const job = this.scope.job(label);
    let value: T | undefined;
    let uploaded = false;
    try {
      if (!job.pending) throw new DOMException('Environment disposed', 'AbortError');
      value = await make();
      if (job.pending) job.run((function* (): BuildSteps { yield* textureList(value); uploaded = true; })());
      await job.done;
      if (!uploaded || this.disposed) throw new DOMException('Environment upload cancelled or failed', 'AbortError');
      return value;
    } catch (error) {
      job.cancel();
      for (const texture of textureList(value)) texture.dispose();
      throw error;
    }
  }

  generate(): Promise<TexSet> {
    const quality = this.ctx.quality.level === 'mobile' ? 'low' : this.ctx.quality.level;
    return this.load('environment procedural textures', () => this.request({ kind: 'base', quality }, () => generateTextures(quality, this.abort.signal)));
  }

  leaves(size: number, color: string, opacity: string): Promise<TexSet['leaves'] | null> {
    color = mobileTextureUrl(color); opacity = mobileTextureUrl(opacity);
    return this.load('environment leaf atlas', () => this.request({ kind: 'leaves', size, color, opacity }, async () => {
      const sprites = await loadLeafSprites(color, opacity);
      return sprites ? generateLeafCardsAsync(size, sprites, this.abort.signal) : null;
    }));
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.scope.dispose();
    this.stopWorker(new DOMException('Environment disposed', 'AbortError'));
  }
}
