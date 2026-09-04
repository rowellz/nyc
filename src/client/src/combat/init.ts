import type { GameContext } from '@/core/context';

/** Shared by audio and combat: one queue, not a separate budget for every asset.
 * Recipes yield at rows/parts. Stop at 1 ms, leaving headroom in the 4 ms budget
 * for the last indivisible canvas/WebAudio/Three call and promise continuations.
 */
const queue: Array<() => boolean> = [];
let frame = 0;
export const initStats = { frames: 0, maxMs: 0, overBudget: 0 };
function pump(): void {
  frame = 0;
  const start = performance.now();
  while (queue.length && performance.now() - start < 1) {
    if (queue[0]()) queue.shift();
  }
  const ms = performance.now() - start;
  initStats.frames++;
  initStats.maxMs = Math.max(initStats.maxMs, ms);
  if (ms > 4) initStats.overBudget++;
  if (queue.length) frame = requestAnimationFrame(pump);
}

/** The count covers queueing through the final commit, including cancellation/failure. */
export function scheduleInit<T>(ctx: Pick<GameContext, 'busy'> | undefined, work: Generator<unknown, T, unknown>, signal?: AbortSignal): Promise<T> {
  if (ctx) ctx.busy = (ctx.busy ?? 0) + 1;
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown, value?: T): void => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      if (ctx) ctx.busy = (ctx.busy ?? 1) - 1;
      if (error !== undefined) reject(error);
      else resolve(value as T);
    };
    const abort = (): void => {
      try { work.return(undefined as T); }
      finally { finish(new DOMException('Initialization cancelled', 'AbortError')); }
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    queue.push(() => {
      if (finished) return true;
      try {
        const step = work.next();
        if (step.done) finish(undefined, step.value);
      } catch (error) { finish(error); }
      return finished;
    });
    if (!frame) frame = requestAnimationFrame(pump);
  });
}

export function initStep<T>(ctx: Pick<GameContext, 'busy'> | undefined, fn: () => T, signal?: AbortSignal): Promise<T> {
  return scheduleInit(ctx, (function* () { return fn(); })(), signal);
}

/** Synchronous recipes remain useful for standalone offline/test callers. */
export function finishNow<T>(work: Generator<unknown, T, unknown>): T {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}
