/**
 * Screenshot mode (?spot= / ?fly=): a free camera at a real spot, no pointer lock, the local player
 * standing at the spot on the ground. Also the window.__* hooks tools/shot.mjs drives.
 *
 * Free-fly: hold the left mouse button and drag to look; WASD move, Space/Ctrl up/down, Shift = fast.
 */
import * as THREE from 'three';
import { headingToYaw, lonLatToXZ, tileIndex, tileKey, xzToLonLat, yawToHeading } from '@shared/geo';
import type { WeatherState } from '@shared/protocol';
import type { GameContext } from './context';
import { SPOTS, spotById, spotToWorld, type Spot } from './spots';
import { parseTimeOfDay, type UrlParams } from './params';
import type { TimeOfDayImpl } from './time';
import type { InputManager } from './input';
import type { NetClientImpl } from './net';
import { showLoadingRecovery } from '@/ui/recovery';

export interface SpotLike {
  lat?: number;
  lon?: number;
  x?: number;
  z?: number;
  heading?: number;
  pitch?: number;
  h?: number;
  fov?: number;
}

const WEATHER_CONDITIONS: WeatherState['condition'][] = ['clear', 'partly_cloudy', 'cloudy', 'fog', 'rain', 'heavy_rain', 'snow', 'thunder'];
const READY_TIMEOUT_MS = 25_000;

/** a full WeatherState for a forced condition (used by ?weather= and __setWeather) */
export function weatherFor(condition: string, base: WeatherState): WeatherState | null {
  if (!WEATHER_CONDITIONS.includes(condition as WeatherState['condition'])) return null;
  const c = condition as WeatherState['condition'];
  const table: Record<WeatherState['condition'], Partial<WeatherState>> = {
    clear: { cloudCover: 0.05, precip: 0, wetness: 0, wind: 2.5 },
    partly_cloudy: { cloudCover: 0.4, precip: 0, wetness: 0, wind: 3.5 },
    cloudy: { cloudCover: 0.9, precip: 0, wetness: 0.1, wind: 4 },
    fog: { cloudCover: 0.95, precip: 0, wetness: 0.4, wind: 1 },
    rain: { cloudCover: 0.95, precip: 0.5, wetness: 0.9, wind: 6 },
    heavy_rain: { cloudCover: 1, precip: 1, wetness: 1, wind: 9 },
    snow: { cloudCover: 0.95, precip: 0.6, wetness: 0.3, wind: 4, temperatureC: -2 },
    thunder: { cloudCover: 1, precip: 0.9, wetness: 1, wind: 11 },
  };
  return { ...base, ...table[c], condition: c, source: 'forced' };
}

export class FreeCamera {
  yaw = 0; // radians, geo.ts convention
  pitch = 0; // radians, + up
  speed = 8;
  fastMul = 6;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private disposers: (() => void)[] = [];
  private dir = new THREE.Vector3();
  private right = new THREE.Vector3();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(private camera: THREE.PerspectiveCamera, private input: InputManager, target: HTMLElement, private options: { pointerLock?: boolean; heightSpeed?: boolean; active?: () => boolean } = {}) {
    const down = (e: MouseEvent) => {
      if (e.button !== 0 || options.pointerLock || options.active?.() === false) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    };
    const up = () => (this.dragging = false);
    const move = (e: MouseEvent) => {
      if (!this.dragging || options.active?.() === false) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * 0.0035;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0035, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    };
    target.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    window.addEventListener('mousemove', move);
    this.disposers.push(() => target.removeEventListener('mousedown', down), () => window.removeEventListener('mouseup', up), () => window.removeEventListener('mousemove', move));
    this.syncFromCamera();
  }

  syncFromCamera(): void {
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = this.euler.y;
    this.pitch = this.euler.x;
  }

  place(x: number, y: number, z: number, headingDeg: number, pitchDeg: number): void {
    this.camera.position.set(x, y, z);
    this.yaw = headingToYaw(headingDeg);
    this.pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.apply();
  }

  apply(): void {
    this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(this.euler);
  }

  update(dt: number): void {
    if (this.options.active?.() === false) return;
    if (this.options.pointerLock && this.input.pointerLocked) {
      this.yaw -= this.input.look.dx * 0.0035;
      this.pitch = THREE.MathUtils.clamp(this.pitch - this.input.look.dy * 0.0035, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    }
    const k = this.input.keys;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const upDown = (k.has('Space') || k.has('KeyE') ? 1 : 0) - (k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyQ') ? 1 : 0);
    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    this.apply();
    if (fwd || strafe || upDown) {
      const height = this.options.heightSpeed ? 1 + Math.max(0, this.camera.position.y) / 40 : 1;
      const s = this.speed * height * (fast ? this.fastMul : 1) * dt;
      this.camera.getWorldDirection(this.dir);
      this.right.crossVectors(this.dir, this.camera.up).normalize();
      this.camera.position.addScaledVector(this.dir, fwd * s);
      this.camera.position.addScaledVector(this.right, strafe * s);
      this.camera.position.y += upDown * s;
    }
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}

export interface ScreenshotHooks {
  /** current spot id or null for custom */
  spotId: string | null;
  cam: FreeCamera | null;
  /** A frame rendered with initialized modules and a fully committed near scene. */
  ready: boolean;
  setSpot(id: string | SpotLike): Promise<void>;
  setTime(hhmm: string): void;
  setWeather(cond: string): boolean;
  update(dt: number): void;
  /** call once modules are created (part of the ready gate) */
  modulesCreated(): void;
  notifyFrame(): void;
}

export function installScreenshotMode(
  ctx: GameContext,
  deps: { params: UrlParams; time: TimeOfDayImpl; input: InputManager; net: NetClientImpl; canvas: HTMLCanvasElement; loadingEl: HTMLElement | null; bootTimedOut?: boolean },
): ScreenshotHooks {
  const { params, time, input, net, canvas } = deps;
  const st = ctx.state;
  let cam: FreeCamera | null = null;
  let modulesDone = false;
  let rendered = false;
  let slowWarning = false;
  let readyWaiters: (() => void)[] = [];
  let hudHidden = false;
  // Initial deadline includes boot/module creation, not just the first frame. Later spots get 25 s each.
  let gateStarted = ctx.quality.level === 'mobile' ? performance.now() : 0;
  let deadline = gateStarted + READY_TIMEOUT_MS;
  let timeout: ReturnType<typeof setTimeout>;
  let readyReason: 'loading' | 'scene' | 'still-loading' = 'loading';
  let readyMs: number | null = null;
  ctx.busy ??= 0;

  function nearTilesDecoded(): boolean {
    if (!ctx.world.ready) return false;
    if ('index' in ctx.world && !ctx.world.index) return false; // a failed index is not an empty, ready city
    // In play mode the streamer follows the player, but the ready promise describes the camera.
    if (!ctx.world.hasTile) return true; // compatibility with partial test contexts
    const tx = tileIndex(ctx.camera.position.x), tz = tileIndex(ctx.camera.position.z);
    for (let x = tx - 1; x <= tx + 1; x++) for (let z = tz - 1; z <= tz + 1; z++)
      if (ctx.world.hasTile(x, z) && !ctx.world.tiles.has(tileKey(x, z))) return false;
    return true;
  }

  function stillLoading(warn = true): void {
    if (hooks.ready) return;
    readyReason = 'still-loading';
    showLoadingRecovery();
    if (warn && !slowWarning) console.warn('[core] near scene is still loading; keeping the loading screen visible', {
      nearTilesDecoded: nearTilesDecoded(), busy: ctx.busy ?? 0, modulesDone,
    });
    slowWarning = true;
  }

  function finishReady(): void {
    if (hooks.ready || !modulesDone || !rendered || ctx.stats.drawCalls === 0 ||
        !(ctx.physics.ready ?? true) || !nearTilesDecoded() || (ctx.busy ?? 0) !== 0) return;
    clearTimeout(timeout);
    readyReason = 'scene';
    readyMs = performance.now() - gateStarted;
    hooks.ready = true;
    (window as any).__ready = true;
    if (deps.loadingEl) deps.loadingEl.hidden = true;
    if (params.nohud && !hudHidden) {
      hudHidden = true;
      ctx.uiRoot.hidden = true;
      ctx.uiRoot.style.display = 'none';
    }
    const waiters = readyWaiters;
    readyWaiters = [];
    for (const w of waiters) w();
  }

  function armTimeout(): void {
    clearTimeout(timeout);
    // The deadline changes the message, never the readiness contract.
    timeout = setTimeout(() => stillLoading(), Math.max(0, deadline - performance.now()));
  }

  const hooks: ScreenshotHooks = {
    spotId: null,
    cam: null,
    ready: false,
    async setSpot(spec) {
      const resolved = resolveSpot(spec);
      if (!resolved) throw new Error(`unknown spot: ${typeof spec === 'string' ? spec : JSON.stringify(spec)}`);
      hooks.spotId = typeof spec === 'string' ? spec : null;
      if (!cam) {
        cam = new FreeCamera(ctx.camera, input, canvas);
        hooks.cam = cam;
      }
      st.screenshotMode = true;
      input.enabled = false;
      input.releaseLock();
      const ground = ctx.physics.groundHeight(resolved.x, resolved.z);
      cam.place(resolved.x, ground + resolved.h, resolved.z, resolved.heading, resolved.pitch);
      if (resolved.fov) {
        ctx.camera.fov = resolved.fov;
        ctx.camera.updateProjectionMatrix();
      }
      // the local player stands at the spot, facing the same way
      const s = st.local.state;
      s.x = resolved.x;
      s.y = ground;
      s.z = resolved.z;
      s.yaw = headingToYaw(resolved.heading);
      s.vx = s.vy = s.vz = 0;
      ctx.world.focus?.set(resolved.x, ground, resolved.z);
      hooks.ready = false;
      rendered = false;
      slowWarning = false;
      if (deps.loadingEl) deps.loadingEl.hidden = false;
      (window as any).__ready = false;
      readyReason = 'loading';
      readyMs = null;
      // The initial setSpot from main must not extend the navigation deadline.
      if (modulesDone) {
        gateStarted = performance.now();
        deadline = gateStarted + READY_TIMEOUT_MS;
      }
      armTimeout();
      await new Promise<void>((resolve) => readyWaiters.push(resolve));
    },
    setTime(hhmm) {
      const f = parseTimeOfDay(hhmm);
      if (f === null) throw new Error(`bad time: ${hhmm}`);
      time.frozen = true;
      time.setFraction(f);
    },
    setWeather(cond) {
      const w = weatherFor(cond, st.weather);
      if (!w) return false;
      net.weatherLocked = true;
      st.weather = w;
      ctx.events.emit('weather', w);
      return true;
    },
    update(dt) {
      if (!cam) return;
      cam.update(dt);
      const p = ctx.camera.position;
      st.local.eye.copy(p);
      ctx.camera.getWorldDirection(st.local.aimDir);
      // keep the player's yaw aligned with the camera; the streamer follows the camera
      ctx.world.focus?.copy(p);
    },
    modulesCreated() {
      modulesDone = true;
    },
    notifyFrame() {
      rendered = true;
      if (hooks.ready) return;
      finishReady(); // AFTER render: the final incremental commits have reached a frame
      if (!hooks.ready && performance.now() >= deadline && !slowWarning) stillLoading();
    },
  };

  // window hooks for tools/shot.mjs and manual poking
  const w = window as any;
  w.__ready = false;
  w.__setSpot = (spec: string | SpotLike) => hooks.setSpot(spec);
  w.__setTime = (hhmm: string) => hooks.setTime(hhmm);
  w.__setWeather = (cond: string) => hooks.setWeather(cond);
  w.__spots = () => SPOTS.map((s) => ({ id: s.id, name: s.name }));
  w.__stats = () => {
    const s = st.local.state;
    const ll = xzToLonLat(ctx.camera.position.x, ctx.camera.position.z);
    return {
      ...ctx.stats,
      quality: ctx.quality.level,
      pixelRatio: ctx.quality.pixelRatio,
      spot: hooks.spotId,
      camera: { x: +ctx.camera.position.x.toFixed(2), y: +ctx.camera.position.y.toFixed(2), z: +ctx.camera.position.z.toFixed(2), heading: +yawToHeading(cam ? cam.yaw : 0).toFixed(1), lat: +ll.lat.toFixed(6), lon: +ll.lon.toFixed(6), fov: ctx.camera.fov },
      player: { x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2) },
      time: time.dayFraction,
      sunElevationDeg: +THREE.MathUtils.radToDeg(time.sunElevation).toFixed(2),
      weather: st.weather.condition,
      net: { status: net.status, ping: st.ping, online: st.online, remotes: st.remotes.size },
      world: { tiles: ctx.world.tiles.size, ready: ctx.world.ready, indexTiles: ctx.world.index?.tiles.length ?? 0 },
      modules: Array.from(ctx.modules.keys()),
      ready: hooks.ready,
      readiness: { reason: readyReason, busy: ctx.busy ?? 0, elapsedMs: readyMs ?? performance.now() - gateStarted },
    };
  };
  w.__ctx = ctx;
  if (deps.bootTimedOut) stillLoading(false);
  else armTimeout();

  if (params.time) {
    const f = parseTimeOfDay(params.time);
    if (f !== null) {
      time.frozen = true;
      time.setFraction(f);
    } else console.warn('[screenshot] bad ?time=', params.time);
  }
  if (params.weather) {
    if (!hooks.setWeather(params.weather)) console.warn('[screenshot] unknown ?weather=', params.weather, 'expected one of', WEATHER_CONDITIONS.join('|'));
  }
  if (params.fov) {
    ctx.camera.fov = params.fov;
    ctx.camera.updateProjectionMatrix();
  }

  return hooks;
}

export function resolveSpot(spec: string | SpotLike): { x: number; z: number; h: number; heading: number; pitch: number; fov?: number } | null {
  if (typeof spec === 'string') {
    const s = spotById(spec);
    if (!s) return null;
    const p = spotToWorld(s);
    return { x: p.x, z: p.z, h: s.h, heading: s.heading, pitch: s.pitch, fov: s.fov };
  }
  let x: number, z: number;
  if (typeof spec.lat === 'number' && typeof spec.lon === 'number') ({ x, z } = lonLatToXZ(spec.lon, spec.lat));
  else if (typeof spec.x === 'number' && typeof spec.z === 'number') (x = spec.x), (z = spec.z);
  else return null;
  return { x, z, h: spec.h ?? 1.7, heading: spec.heading ?? 0, pitch: spec.pitch ?? 0, fov: spec.fov };
}

export function spotFromParams(params: UrlParams): { spec: string | SpotLike; spot?: Spot } | null {
  if (params.spot) return { spec: params.spot, spot: spotById(params.spot) };
  if (params.fly) return { spec: { x: params.fly.x, z: params.fly.z, h: params.fly.h, heading: params.fly.heading, pitch: params.fly.pitch } };
  return null;
}
