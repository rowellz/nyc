import type * as THREE from 'three';
import type { GameContext } from '@/core/context';

/** Shared by the three scene builders: ONE cooperative 4 ms budget and ONE texture upload per RAF.
 * A job owns its busy increment from enqueue, not from worker dispatch. Cancelling is idempotent.
 * Generators yield between small native operations; geometry/BVH inputs must be bounded in workers.
 * WebGL uploads/program compilation cannot be preempted; native-call overruns must be measured too.
 */
export interface TextureUpload { texture: THREE.Texture; prepare: () => void }
export type BuildSteps = Generator<THREE.Texture | TextureUpload | Promise<unknown> | void, void, unknown>;
export interface BuildJob {
  readonly pending: boolean;
  readonly done: Promise<void>;
  run(steps: BuildSteps): void;
  cancel(): void;
}
const queues = new WeakMap<GameContext, FrameBuildQueue>();
export function frameBuilds(ctx: GameContext): FrameBuildQueue {
  let queue = queues.get(ctx);
  if (!queue) queues.set(ctx, queue = new FrameBuildQueue(ctx));
  return queue;
}

/** Module lifetime owns waiting workers/decodes as well as runnable commits. */
export function buildScope(ctx: GameContext): Pick<FrameBuildQueue, 'job'> & { dispose(): void } {
  const queue = frameBuilds(ctx), jobs = new Set<BuildJob>();
  let disposed = false;
  return {
    job(label) {
      const inner = queue.job(label);
      const job: BuildJob = {
        get pending() { return inner.pending; },
        done: inner.done,
        run: steps => inner.run((function* (): BuildSteps {
          try { yield* steps; } finally { jobs.delete(job); }
        })()),
        cancel() { jobs.delete(job); inner.cancel(); },
      };
      if (disposed) job.cancel(); else jobs.add(job);
      return job;
    },
    dispose() { disposed = true; for (const job of jobs) job.cancel(); jobs.clear(); },
  };
}

export class FrameBuildQueue {
  private ready: { job: BuildJob; steps: BuildSteps; upload?: THREE.Texture | TextureUpload }[] = [];
  private frame = 0;
  constructor(private ctx: GameContext) {}

  job(label: string): BuildJob {
    const ctx = this.ctx;
    ctx.busy = (ctx.busy ?? 0) + 1;
    let pending = true;
    let resolve!: () => void;
    const done = new Promise<void>(r => { resolve = r; });
    let iterator: BuildSteps | undefined;
    const finish = () => {
      if (!pending) return;
      pending = false;
      ctx.busy = (ctx.busy ?? 1) - 1;
      resolve();
    };
    const job: BuildJob = {
      get pending() { return pending; },
      done,
      run: steps => {
        if (!pending) { steps.return(); return; }
        if (iterator) throw new Error(`Already committing ${label}`);
        iterator = steps;
        this.ready.push({ job, steps });
        this.schedule();
      },
      cancel: () => { finish(); iterator?.return(); },
    };
    return job;
  }

  private schedule(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.frame = 0;
    // Leave 1 ms of headroom for the last atomic BufferAttribute / small Rapier call.
    const deadline = performance.now() + 3;
    let uploaded = false;
    const paused: typeof this.ready = [];
    let visits = this.ready.length;
    while (this.ready.length && visits-- > 0 && performance.now() < deadline) {
      const item = this.ready.shift()!;
      if (!item.job.pending) continue;
      try {
        if (item.upload) {
          if (uploaded) { paused.push(item); continue; }
          const upload = item.upload;
          if ('texture' in upload) { upload.prepare(); this.ctx.renderer.initTexture(upload.texture); }
          else this.ctx.renderer.initTexture(upload);
          item.upload = undefined;
          uploaded = true;
          // Do not publish the texture until the next frame.
          paused.push(item);
          continue;
        }
        const step = item.steps.next();
        if (step.done) item.job.cancel();
        else if (step.value instanceof Promise) {
          // Shader compilation can finish on the driver without holding a RAF or releasing busy.
          void step.value.then(() => {
            if (item.job.pending) { this.ready.push(item); this.schedule(); }
          }, error => { console.warn('[scene-build] async commit failed', error); item.job.cancel(); });
        }
        else {
          if (step.value) item.upload = step.value;
          this.ready.push(item);
          visits++;
        }
      } catch (error) {
        console.warn('[scene-build] commit failed', error);
        item.job.cancel();
      }
    }
    this.ready.push(...paused);
    if (this.ready.length) this.schedule();
  }
}
