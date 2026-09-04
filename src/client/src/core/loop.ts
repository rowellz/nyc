/**
 * Frame loop. Per frame, in order:
 *   input.beginFrame -> time.update -> net.update -> streamer.update -> physics (fixed 60 Hz accumulator)
 *   -> module.update(dt, t) in creation order -> module.preRender() -> render (ctx.composer if set) -> stats
 * dt is clamped to 0.1 s so a stalled tab never explodes physics.
 */
import type { GameContext } from './context';
import type { InputManager } from './input';
import type { TimeOfDayImpl } from './time';
import type { NetClientImpl } from './net';
import type { WorldStreamerImpl } from './streamer';
import { isIOS, type QualityLevel } from './quality';
import { PHYSICS_DT } from './physics';
import { DeathCameraGuard } from './deathCamera';

export interface LoopDeps {
  ctx: GameContext;
  input: InputManager;
  time: TimeOfDayImpl;
  net: NetClientImpl;
  streamer: WorldStreamerImpl;
  /** returns the point tiles should load around (player or free camera) */
  focus: () => { x: number; y: number; z: number };
  /** Hold distant tile work until the near scene has been rendered idle. */
  loading?: () => boolean;
  /** called every frame after render (ready gating, overlays) */
  afterFrame?: (dt: number, t: number) => void;
}

const MAX_DT = 0.1;
const MAX_PHYSICS_STEPS = 4; // spiral-of-death guard: never run more than this many 60 Hz steps per frame

export class GameLoop {
  running = false;
  frame = 0;
  /** seconds since start */
  t = 0;
  private last = 0;
  private startedAt = 0;
  private acc = 0;
  private raf = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private frameMsAcc = 0;
  private selectedLevel: QualityLevel | null = null;
  private fixedHooks: ((dt: number) => void)[] = [];
  private deathCamera = new DeathCameraGuard();

  constructor(private d: LoopDeps) {}

  /** register a callback that runs at the fixed physics rate, right before each physics.step */
  onFixedStep(fn: (dt: number) => void): () => void {
    this.fixedHooks.push(fn);
    return () => {
      const i = this.fixedHooks.indexOf(fn);
      if (i >= 0) this.fixedHooks.splice(i, 1);
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.startedAt = this.last;
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.step(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** one frame. Exposed so tests / the screenshot tool can drive frames manually. */
  step(now: number = performance.now()): void {
    const { ctx, input, time, net, streamer } = this.d;
    const frameStart = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > MAX_DT) dt = MAX_DT;
    this.t += dt;
    ctx.now = this.t;
    this.frame++;

    ctx.renderer.info.reset();

    const frozen = !ctx.state.screenshotMode && net.interrupted;
    const loading = this.d.loading?.() ?? false;
    input.blocked = frozen || loading;
    input.beginFrame();
    time.update(dt);
    net.update(dt);
    const warming = !ctx.state.screenshotMode && now - this.startedAt < 10_000;
    const selectedLevel = this.selectedLevel ??= ctx.quality.level;
    // Keep the reduced tier between frames too: incremental builders and worker replies
    // run asynchronously, not just inside streamer.update(). Renderer settings stay unchanged.
    ctx.quality.level = warming && selectedLevel !== 'mobile' ? (selectedLevel === 'high' || selectedLevel === 'ultra' ? 'medium' : 'low') : selectedLevel;
    const f = loading ? ctx.camera.position : this.d.focus();
    streamer.focus.set(f.x, f.y, f.z);
    // Let outstanding builders drain before publishing more tiles (each fans out into jobs).
    streamer.update(streamer.focus, this.t, loading || (!isIOS() && warming), (ctx.busy ?? 0) < 16);
    ctx.stats.tilesLoaded = streamer.tiles.size;

    // fixed-step physics
    this.acc = frozen ? 0 : this.acc + dt;
    let steps = 0;
    while (this.acc >= PHYSICS_DT && steps < MAX_PHYSICS_STEPS) {
      for (const h of this.fixedHooks) h(PHYSICS_DT);
      ctx.physics.step(PHYSICS_DT);
      this.acc -= PHYSICS_DT;
      steps++;
    }
    if (steps === MAX_PHYSICS_STEPS && this.acc > PHYSICS_DT) this.acc = 0; // drop the backlog

    for (const m of ctx.modules.values()) {
      if (frozen && ['character', 'vehicles', 'combat'].includes(m.name)) continue;
      const screenshot = ctx.state.screenshotMode;
      try {
        if (ctx.state.adminFlying && (m.name === 'character' || m.name === 'combat')) ctx.state.screenshotMode = true;
        m.update(dt, this.t);
      } catch (err) {
        reportModuleError(m.name, 'update', err);
      } finally {
        ctx.state.screenshotMode = screenshot;
      }
    }
    this.deathCamera.update(ctx);
    for (const m of ctx.modules.values()) {
      if (!m.preRender) continue;
      const screenshot = ctx.state.screenshotMode;
      try {
        if (ctx.state.adminFlying && (m.name === 'character' || m.name === 'combat')) ctx.state.screenshotMode = true;
        m.preRender();
      } catch (err) {
        reportModuleError(m.name, 'preRender', err);
      } finally {
        ctx.state.screenshotMode = screenshot;
      }
    }

    // A preRender camera owner must not bypass the guard, including composer rendering.
    this.deathCamera.update(ctx);

    if (ctx.composer) {
      try {
        ctx.composer.render(dt);
      } catch (err) {
        reportModuleError('composer', 'render', err);
        ctx.composer = null;
        ctx.renderer.render(ctx.scene, ctx.camera);
      }
    } else {
      ctx.renderer.render(ctx.scene, ctx.camera);
    }

    // stats
    const frameMs = performance.now() - frameStart;
    this.frameMsAcc += frameMs;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      ctx.stats.fps = Math.round(this.fpsFrames / this.fpsAcc);
      ctx.stats.frameMs = +(this.frameMsAcc / this.fpsFrames).toFixed(2);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      this.frameMsAcc = 0;
    }
    ctx.stats.drawCalls = ctx.renderer.info.render.calls;
    ctx.stats.triangles = ctx.renderer.info.render.triangles;

    this.d.afterFrame?.(dt, this.t);
  }
}

const errorCounts = new Map<string, number>();
function reportModuleError(name: string, phase: string, err: unknown): void {
  const k = `${name}:${phase}`;
  const n = (errorCounts.get(k) ?? 0) + 1;
  errorCounts.set(k, n);
  // log the first few, then once every 300 frames, so a broken module doesn't flood the console
  if (n <= 3 || n % 300 === 0) console.error(`[loop] module "${name}" threw in ${phase} (x${n})`, err);
}
