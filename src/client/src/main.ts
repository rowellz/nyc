/// <reference types="vite/client" />
/**
 * Client entry. Builds the GameContext, creates the modules in ARCHITECTURE.md order (each one optional:
 * a missing or failing module never stops the rest), installs core fallbacks (debug world, fallback
 * character, debug overlay, basic lights) for whatever is missing, then starts the loop.
 */
import './style.css';
import * as THREE from 'three';
import { xzToLonLat } from '@shared/geo';
import { GAME_VERSION } from '@shared/version';
import type { GameContext, GameModule, Quality } from '@/core/context';
import { TypedEventBus } from '@/core/events';
import { parseParams } from '@/core/params';
import { detectQuality, isIOS, mobileTextureUrl } from '@/core/quality';
import { createRenderer } from '@/core/renderer';
import { createClientState } from '@/core/state';
import { TimeOfDayImpl } from '@/core/time';
import { InputManager } from '@/core/input';
import { AudioBusImpl } from '@/core/audio';
import { PhysicsWorldImpl } from '@/core/physics';
import { WorldStreamerImpl } from '@/core/streamer';
import { NetClientImpl } from '@/core/net';
import { GameLoop } from '@/core/loop';
import { installScreenshotMode, spotFromParams } from '@/core/screenshot';
import { createDebugWorld } from '@/core/debugWorld';
import { createFallbackCharacter } from '@/core/fallbackCharacter';
import { createDebugOverlay } from '@/core/debugOverlay';
import { basePath } from '@/core/basePath';
import { createAdminTools } from '@/core/admin';
import { ConnectionNotice, showLoadingRecovery } from '@/ui/recovery';
import { createTelemetry } from '@/core/telemetry';
import { markFirstFrame, markReady, reportStartupError, setStageQuality, stageBeacon } from '@/core/crashGuard';

const MODULE_ORDER = ['atmosphere', 'environment', 'streets', 'buildings', 'landmarks', 'props', 'vehicles', 'character', 'combat', 'audio', 'ui'] as const;
type ModuleName = (typeof MODULE_ORDER)[number];

/** Vite resolves this at build time to the module folders that exist; missing ones are simply absent. */
const moduleLoaders = import.meta.glob('./*/index.ts') as Record<string, () => Promise<Record<string, unknown>>>;

function loadingText(sub: string, pct?: number): void {
  const s = document.getElementById('loading-sub');
  if (s) s.textContent = sub;
  if (pct !== undefined) {
    const b = document.getElementById('loading-bar');
    if (b) b.style.width = `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`;
  }
}

function fatal(msg: string, err?: unknown): void {
  reportStartupError('fatal', err || msg);
  console.error(msg, err);
  const el = document.getElementById('fatal');
  if (el) {
    el.style.display = 'flex';
    el.textContent = `${msg} Please reload to try again in a lighter mode.`;
    const retry = document.createElement('a');
    const url = new URL(location.href); url.searchParams.set('q', 'low');
    retry.href = url.href; retry.textContent = 'Reload in lighter mode';
    el.appendChild(retry);
  }
  document.getElementById('loading')?.setAttribute('hidden', '');
}

export async function main(registration?: { name: string; email: string; newsletter: boolean }): Promise<void> {
  const params = parseParams();
  const ios = isIOS();
  // Texture/GLTF loaders also consume dynamically constructed manifest paths.
  THREE.DefaultLoadingManager.setURLModifier(url => mobileTextureUrl(url.startsWith('/assets/') ? basePath(url) : url));
  const adminSession = fetch(basePath('/api/admin/me'), { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(4000) })
    .then(r => r.ok ? r.json() as Promise<{ admin: boolean }> : { admin: false }).catch(() => ({ admin: false }));
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const uiRoot = document.getElementById('ui') as HTMLElement | null;
  const loadingEl = document.getElementById('loading');
  if (!canvas || !uiRoot) throw new Error('index.html must contain #game and #ui');

  // quality -> renderer
  const { quality, device, auto } = detectQuality(params.q);
  setStageQuality(quality.level);
  stageBeacon('renderer_start');
  console.info(`[core] v${GAME_VERSION} quality=${quality.level} (auto ${auto}) gpu="${device.gpu}" dpr=${device.dpr} cores=${device.cores}${device.mobile ? ' mobile' : ''}`);
  loadingText('starting renderer', 0.05);
  const r = createRenderer(canvas, quality, { fov: params.fov, preserveDrawingBuffer: params.screenshotMode });

  // core services
  const events = new TypedEventBus();
  const state = createClientState({ screenshotMode: params.screenshotMode, debug: params.debug, name: params.name });
  const time = new TimeOfDayImpl(state);
  const input = new InputManager(canvas, { enabled: !params.screenshotMode });
  const audio = new AudioBusImpl(r.camera, !ios);
  const streamer = new WorldStreamerImpl(events, quality, params.world);
  const net = new NetClientImpl(state, events, params.server ?? undefined);
  net.attachTime(time);
  const connectionNotice = new ConnectionNotice(net, input, () => state.screenshotMode);
  window.addEventListener('pagehide', () => connectionNotice.dispose(), { once: true });

  // Cover boot before a GameContext exists; the screenshot gate takes over once physics resolves.
  let bootTimedOut = false;
  (window as any).__ready = false;
  const bootReadyTimeout = setTimeout(() => {
    bootTimedOut = true;
    showLoadingRecovery();
    console.warn('[core] physics initialization is taking more than 25 s; keeping the loading screen visible');
  }, device.mobile ? 25_000 : Math.max(0, 25_000 - performance.now()));

  loadingText('starting physics', 0.15);
  const indexPromise = streamer.loadIndex(); // in parallel with rapier init
  let physics: PhysicsWorldImpl;
  try {
    physics = await PhysicsWorldImpl.create();
  } catch (err) {
    clearTimeout(bootReadyTimeout);
    fatal('Physics (Rapier WASM) failed to start.', err);
    return;
  }

  stageBeacon('physics_ready');
  const ctx: GameContext = {
    renderer: r.renderer,
    scene: r.scene,
    camera: r.camera,
    worldGroup: r.worldGroup,
    world: streamer,
    physics,
    net,
    input,
    events,
    state,
    time,
    audio,
    quality,
    uiRoot,
    stats: { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, tilesLoaded: 0 },
    modules: new Map(),
    busy: 0,
    composer: null,
    canvas,
    now: 0,
  };

  // screenshot hooks + free camera (also installs window.__ready/__setSpot/__setTime/__setWeather/__stats)
  ctx.modules.set('telemetry', createTelemetry(ctx));
  clearTimeout(bootReadyTimeout);
  const shots = installScreenshotMode(ctx, { params, time, input, net, canvas, loadingEl, bootTimedOut });
  const spot = spotFromParams(params);
  if (spot) {
    if (params.spot && !spot.spot) console.warn(`[core] unknown ?spot=${params.spot}; use one of: ${(window as any).__spots().map((s: { id: string }) => s.id).join(', ')}`);
    else shots.setSpot(spot.spec).catch((err) => console.warn('[core] setSpot', err));
  }

  loadingText('fetching world index', 0.25);
  await indexPromise;
  if (streamer.index) loadingText(`world: ${streamer.index.tiles.length} tiles`, 0.3);
  else loadingText('no world data (empty city)', 0.3);

  physics.setLandIndex(streamer.index);
  if (ios) streamer.releaseIndexCache();
  events.on('tileLoaded', tile => physics.loadLand(tile));
  events.on('tileUnloaded', key => physics.unloadLand(key));
  state.admin = (await adminSession).admin === true;
  ctx.modules.set('adminTools', createAdminTools(ctx, shots));
  // Returning players connect immediately; new players connect after the private entry form.
  if (registration) net.register(registration.name, registration.email, registration.newsletter);
  else net.connect();

  // modules, in order; each optional
  const created: string[] = [];
  const missing: string[] = [];
  async function createModule(name: ModuleName, i: number): Promise<void> {
    loadingText(`loading ${name}`, 0.3 + (0.55 * i) / MODULE_ORDER.length);
    const loader = ios && name === 'atmosphere' ? () => import('@/atmosphere/mobile')
      : ios && name === 'props' ? () => import('@/props/mobile') : moduleLoaders[`./${name}/index.ts`];
    if (!loader || (params.modules && !params.modules.includes(name))) {
      missing.push(name);
      return;
    }
    try {
      stageBeacon(ios ? `module_start:${name}` : 'module_start', name);
      const m = await loader();
      const factory = findFactory(m, name);
      if (!factory) throw new Error(`module "${name}" has no create${cap(name)}() export`);
      const mod = (await factory(ctx)) as GameModule | undefined;
      if (!mod || typeof mod.update !== 'function') throw new Error(`create${cap(name)}() did not return a GameModule`);
      if (!mod.name) (mod as { name: string }).name = name;
      if (ios && name === 'character') ctx.modules.get('character')?.dispose?.();
      ctx.modules.set(name, mod);
      if (name === 'atmosphere' && !quality.reflections) {
        // Honor core's preset contract: the optional atmosphere module may allocate SSR on high,
        // but high explicitly disables reflections. Use its public uniform, not module internals.
        const atmosphere = mod as GameModule & { uniforms?: { uSSRIntensity?: { value: number } } };
        if (atmosphere.uniforms?.uSSRIntensity) atmosphere.uniforms.uSSRIntensity.value = 0;
      }
      created.push(name);
      stageBeacon(ios ? `module_created:${name}` : 'module_created', name);
    } catch (err) {
      reportStartupError('module_error', `${name}: ${err instanceof Error ? err.stack : err}`);
      console.warn(`[core] module missing/failed: ${name}`, err);
      missing.push(name);
    }
  }
  for (let i = 0; i < MODULE_ORDER.length; i++) {
    if (!ios || i === 0) await createModule(MODULE_ORDER[i], i);
  }
  stageBeacon('modules_created', ios ? 'bootstrap; city modules deferred until after first frame' : created.join(', '));
  console.info(`[core] modules: ${created.join(', ') || '(none)'}${missing.length ? `  missing: ${missing.join(', ')}` : ''}${params.modules ? `  (?modules=${params.modules.join(',') || 'none'})` : ''}`);

  // core fallbacks for whatever is missing
  const has = (n: ModuleName) => ctx.modules.has(n);
  const debugWorldNeeded = (!ios && !has('buildings')) || params.debug;
  if (debugWorldNeeded) {
    const dw = createDebugWorld(ctx, {
      buildings: !has('buildings') || params.debug,
      roads: !has('streets') || params.debug,
      areas: !has('environment') || params.debug,
      ground: !has('environment'),
      lights: !has('atmosphere'),
    });
    ctx.modules.set('debugWorld', dw);
  } else if (!has('atmosphere')) {
    ctx.modules.set('debugWorld', createDebugWorld(ctx, { buildings: false, roads: false, areas: false, ground: !has('environment'), lights: true }));
  }
  if (!has('character')) ctx.modules.set('character', createFallbackCharacter(ctx));
  if ((!ios && !has('ui')) || params.debug) ctx.modules.set('debugOverlay', createDebugOverlay(ctx, { net, streamer, device: device.gpu, autoLevel: auto }));
  if (!ios) shots.modulesCreated();
  async function createDeferredModules(): Promise<void> {
    for (let i = 1; i < MODULE_ORDER.length; i++) {
      const name = MODULE_ORDER[i];
      if (name === 'audio') continue;
      // Factories can return while their workers/build queues are still allocating.
      // Drain those jobs before the next 1.5 s slot, so memory peaks don't overlap.
      do { await new Promise(resolve => setTimeout(resolve, 1500)); }
      while (loop.running && ((ctx.busy ?? 0) > 0 || !streamer.ready));
      if (!loop.running) return;
      await createModule(name, i);
    }
    stageBeacon('modules_ready', created.join(', '));
    shots.modulesCreated();
  }

  // loop
  const focus = () => (state.screenshotMode ? ctx.camera.position : state.local.state) as { x: number; y: number; z: number };
  let loadingHidden = false;
  let deferredStarted = false;
  let readyAt = 0, lastMemoryAt = 0, audioStarted = false;
  const loop = new GameLoop({
    ctx,
    input,
    time,
    net,
    streamer,
    focus,
    loading: () => !shots.ready,
    afterFrame() {
      markFirstFrame();
      if (ios) {
        const now = performance.now();
        if (now - lastMemoryAt >= 5000) {
          lastMemoryAt = now;
          const { geometries, textures } = r.renderer.info.memory;
          stageBeacon('renderer_memory', JSON.stringify({ geometries, textures, programs: r.renderer.info.programs?.length ?? 0 }));
        }
        if (readyAt && !audioStarted && now - readyAt >= 10_000) {
          audioStarted = true; audio.enable();
          void createModule('audio', MODULE_ORDER.indexOf('audio'));
        }
      }
      if (ios && !deferredStarted) {
        deferredStarted = true;
        void createDeferredModules().catch(error => reportStartupError('module_error', error));
      }
      shots.update(0); // no-op unless a free camera exists (movement handled below)
      shots.notifyFrame();
      if (!loadingHidden) {
        if (shots.ready) {
          loadingHidden = true;
          stageBeacon('ready');
          readyAt = performance.now();
          if (ios) markReady();
          if (loadingEl) loadingEl.hidden = true;
        } else {
          const p = focus();
          loadingText(`streaming tiles around ${xzToLonLat(p.x, p.z).lat.toFixed(4)}, ${xzToLonLat(p.x, p.z).lon.toFixed(4)} — ${streamer.tiles.size} loaded`, 0.85 + 0.15 * Math.min(1, streamer.tiles.size / 9));
        }
      }
    },
  });
  // the free camera moves before modules update so preRender sees the final camera
  ctx.modules.set('freeCamera', { name: 'freeCamera', update: (dt) => shots.update(dt) });
  // keep creation order: freeCamera should run first -> rebuild the map with it in front
  const ordered = new Map<string, GameModule>();
  ordered.set('freeCamera', ctx.modules.get('freeCamera')!);
  for (const [k, v] of ctx.modules) if (k !== 'freeCamera') ordered.set(k, v);
  ctx.modules.clear();
  for (const [k, v] of ordered) ctx.modules.set(k, v);

  loadingText('streaming tiles', 0.85);
  canvas.addEventListener('webglcontextlost', () => loop.stop());
  loop.start();

  (window as any).__loop = loop;
  (window as any).__stats = (window as any).__stats ?? (() => ctx.stats);
  // playtest helpers (see docs/CLIENT_CORE.md §9)
  (window as any).__game = {
    ctx,
    /** put the local player (and the free camera in screenshot mode) at x,z on the ground. Modules re-sync on localRespawn.
     *  The server clamps movement to ~70 m/s, so other players see you slide there. */
    teleport(x: number, z: number, y?: number): void {
      const gy = y ?? Math.max(0, physics.groundHeight(x, z));
      const s = state.local.state;
      s.x = x;
      s.y = gy;
      s.z = z;
      s.vx = s.vy = s.vz = 0;
      if (state.screenshotMode) ctx.camera.position.set(x, gy + 1.7, z);
      streamer.focus.set(x, gy, z);
      streamer.update(streamer.focus, loop.t);
      events.emit('localRespawn');
    },
    interact(): void {
      if (!input.enabled || input.blocked || net.interrupted) return;
      // Same event used by E and the touch Interact button: pickups and vehicles both subscribe.
      events.emit('interact');
    },
    setName(n: string): void {
      net.setName(n);
    },
    /** Hold a key or MouseLeft/MouseMiddle/MouseRight through the normal frame input pipeline. */
    async press(key: string, ms = 100): Promise<void> {
      const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key;
      if (!Number.isFinite(ms) || ms < 0) throw new Error('press: invalid duration');
      const button = ['MouseLeft', 'MouseMiddle', 'MouseRight'].indexOf(key);
      if (button >= 0) input.debugMouseButton(button, true);
      else window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true }));
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
      } finally {
        if (button >= 0) input.debugMouseButton(button, false);
        else window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true }));
      }
    },
    /** Steer the character's existing orbit hook; never take camera ownership or change hit state. */
    async lookAt(x: number, y: number, z: number): Promise<void> {
      if (![x, y, z].every(Number.isFinite)) throw new Error('lookAt: invalid target');
      const character = (window as any).__character;
      if (!character?.orbit) throw new Error('lookAt requires the character orbit debug hook');
      const target = new THREE.Vector3(x, y, z);
      const dir = new THREE.Vector3();
      for (let i = 0; i < 180; i++) {
        dir.subVectors(target, ctx.camera.position).normalize();
        const desiredYaw = Math.atan2(-dir.x, -dir.z);
        const desiredPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
        const current = new THREE.Euler().setFromQuaternion(ctx.camera.quaternion, 'YXZ');
        const yawDelta = Math.atan2(Math.sin(desiredYaw - current.y), Math.cos(desiredYaw - current.y));
        const pitchDelta = desiredPitch - current.x;
        if (i >= 4 && Math.hypot(yawDelta, pitchDelta) < 0.004) return;
        const sensitivity = 0.0022 * (input.aim ? 0.62 : 1);
        character.orbit(-yawDelta * 0.5 / sensitivity, -pitchDelta * 0.5 / sensitivity);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      throw new Error('lookAt did not converge (dead player, camera ownership, or unreachable pitch)');
    },
  };
  console.info('[core] running');
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function findFactory(m: Record<string, unknown>, name: string): ((ctx: GameContext) => unknown) | null {
  const candidates = [`create${cap(name)}`, `create${name.toUpperCase()}`, 'create', 'default'];
  for (const c of candidates) {
    const f = m[c];
    if (typeof f === 'function') return f as (ctx: GameContext) => unknown;
  }
  return null;
}

// re-export for consumers who want to build a quality object manually (tests)
export type { Quality };
