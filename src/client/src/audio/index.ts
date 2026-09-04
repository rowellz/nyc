/**
 * Audio module. Everything is synthesized with WebAudio (no sample files): a layered city ambience
 * driven by the real world data around the camera, positioned traffic engines with doppler, the local
 * vehicle, gunfire with a street-reverb tail and distance model, character foley and UI cues.
 * No public API; consumes ctx.events + module queries. Settings/testing hooks on window.__audio.
 */
import type { GameContext, GameModule } from '@/core/context';
import { Mixer, createMasterChain, readAudioSettings, saveAudioSettings } from './mixer';
import { Bank, SOUND_DEFS, soundDef, renderRecipe } from './sounds';
import { Ambience, CityBed, createRainBed, honk, honkPhrase, subwayPass, thunder } from './ambience';
import { TrafficAudio } from './traffic';
import { LocalVehicleAudio } from './vehicle';
import { WeaponsAudio, remoteShotParams, weaponLevel } from './weapons';
import { CharacterAudio } from './character';
import { UiAudio, UiSynth } from './ui';
import { EngineVoice, type EngineKind } from './engine';
import { SirenVoice } from './siren';
import { createPanner } from './spatial';
import { initStep } from '../combat/init';
import { clamp, prepareSynth, makeStreetIR, filter, gain, stopSources, rampTo, STREET_IR_NEAR, STREET_IR_NEAR_SECONDS, STREET_IR_FAR, STREET_IR_FAR_SECONDS } from './synth';

export interface AudioModule extends GameModule {
  /** Once enabled, avoid dropping the first shot while its bank is still rendering. */
  readyForInput?(): boolean;
}

export interface AudioRender {
  sampleRate: number;
  channels: Float32Array[];
}

/** Keep the device unopened until a gesture (core owns unlock), or an explicit QA request.
 * AudioContext's cold native device startup is not preemptible and must not block scene loading.
 */
export async function createAudio(ctx: GameContext): Promise<AudioModule> {
  let live: AudioModule | undefined;
  let pending: Promise<void> | undefined;
  let disposed = false;
  const w = window as unknown as { __audio?: { test(name: string, opts?: Record<string, number>): boolean; ready?(): Promise<void> } };
  const start = (): Promise<void> => {
    if (pending) return pending;
    if (disposed) return Promise.resolve();
    removeGestures();
    ctx.busy = (ctx.busy ?? 0) + 1;
    pending = initializeAudio(ctx).then(mod => {
      if (disposed) mod.dispose?.();
      else live = mod;
    }).finally(() => { ctx.busy = (ctx.busy ?? 1) - 1; });
    return pending;
  };
  const gesture = (): void => { void start().catch(error => console.warn('[audio] initialization failed', error)); };
  const gestures = ['pointerdown', 'keydown', 'touchstart'] as const;
  const removeGestures = (): void => { for (const event of gestures) window.removeEventListener(event, gesture); };
  const facade = {
    getSettings: readAudioSettings,
    setVolume: (bus: 'master' | 'sfx' | 'ambient' | 'music', value: number) => {
      const settings = readAudioSettings();
      settings[bus] = clamp(value, 0, 1);
      saveAudioSettings(settings);
    },
    setMuted: (muted: boolean) => { saveAudioSettings({ ...readAudioSettings(), muted }); },
    meter: () => ({ rms: 0, peak: 0 }),
    stats: () => ({ state: 'idle', started: false, unlocked: ctx.audio.unlocked, bankReady: false, bankProgress: 0, initializing: !!pending }),
    /** Explicitly enable live audio for QA, including screenshot mode. */
    ready: async (): Promise<void> => {
      await start();
      if (w.__audio !== facade) await w.__audio?.ready?.();
    },
    test: (name: string, opts: Record<string, number> = {}): boolean => {
      if (!soundDef(name) && !['honk', 'siren', 'thunder', 'subway', 'footstep'].includes(name)) return false;
      void facade.ready().then(() => { if (!disposed && w.__audio !== facade) w.__audio?.test(name, opts); }).catch(error => console.warn('[audio] test failed', error));
      return true;
    },
    render: (name: string, seconds = 3) => renderOffline(name, seconds, 44100),
    list: () => [...RENDER_NAMES],
  };
  w.__audio = facade;
  for (const event of gestures) window.addEventListener(event, gesture, { passive: true });
  if (ctx.audio.unlocked) gesture();
  return {
    name: 'audio',
    readyForInput: () => live?.readyForInput?.() ?? !pending,
    update(dt, t) {
      if (!pending && ctx.audio.unlocked) gesture();
      live?.update(dt, t);
    },
    dispose() {
      disposed = true;
      removeGestures();
      live?.dispose?.();
      if (w.__audio === facade) delete w.__audio;
    },
  };
}

async function initializeAudio(ctx: GameContext): Promise<AudioModule> {
  const bus = ctx.audio;
  let ac: AudioContext;
  try {
    ac = bus.ctx;
    void bus.listener; // attaches the three AudioListener to the camera
  } catch (err) {
    console.warn('[audio] WebAudio unavailable', err);
    return { name: 'audio', update() {} };
  }
  const ir = await prepareSynth(ctx, ac);
  const mixer = await initStep(ctx, () => new Mixer(bus, ctx.quality, true));
  await mixer.prepareReverb(ctx, ir);
  const bank = new Bank(ac.sampleRate, SOUND_DEFS, ctx);
  const ambience = await initStep(ctx, () => new Ambience(ctx, mixer, bank));
  const traffic = await initStep(ctx, () => new TrafficAudio(ctx, mixer, bank));
  const vehicle = await initStep(ctx, () => new LocalVehicleAudio(ctx, mixer, bank));
  const weapons = await initStep(ctx, () => new WeaponsAudio(ctx, mixer, bank));
  const character = await initStep(ctx, () => new CharacterAudio(ctx, mixer, bank));
  const ui = await initStep(ctx, () => new UiAudio(ctx, mixer));

  let started = false;
  let lastResumeTry = 0;
  const perf = { ms: 0, max: 0 };
  const tryStart = (): void => {
    if (started) return;
    if (ac.state !== 'running') {
      // core resumes on the first gesture; nudge again in case that raced (cheap, rate limited)
      const now = performance.now();
      if (bus.unlocked && now - lastResumeTry > 1000) {
        lastResumeTry = now;
        ac.resume().catch(() => {});
      }
      return;
    }
    started = true;
    ambience.start();
    console.info(`[audio] started (${ac.sampleRate} Hz, ${mixer.hrtfAllowed ? 'HRTF' : 'equalpower'})`);
  };
  ac.addEventListener('statechange', tryStart);
  bank.done.then(() => console.info('[audio] bank ready: ' + SOUND_DEFS.length + ' sounds')).catch(() => {});

  const mod: AudioModule = {
    name: 'audio',
    readyForInput: () => bank.ready,
    update(dt, t) {
      tryStart();
      if (!started) return;
      const t0 = performance.now();
      ambience.update(dt, t);
      traffic.update(dt);
      vehicle.update(dt);
      weapons.update();
      character.update(dt, t);
      ui.update();
      const ms = performance.now() - t0;
      perf.ms += (ms - perf.ms) * 0.05;
      if (ms > perf.max) perf.max = ms;
    },
    dispose() {
      ac.removeEventListener('statechange', tryStart);
      ambience.dispose();
      traffic.dispose();
      vehicle.dispose();
      weapons.dispose();
      character.dispose();
      ui.dispose();
      bank.dispose();
      mixer.dispose();
      delete (window as unknown as { __audio?: unknown }).__audio;
    },
  };

  // ---- window.__audio: settings for the ui module, test/debug hooks -----------------------------
  const api = {
    ready: () => bank.done,
    /** volumes 0..1 per bus + mute; persisted in localStorage 'nyc.audio' */
    getSettings: () => mixer.getSettings(),
    setVolume: (busName: 'master' | 'sfx' | 'ambient' | 'music', v: number) => mixer.setVolume(busName, v),
    setMuted: (m: boolean) => mixer.setMuted(m),
    /** post-limiter RMS/peak of the last ~43 ms */
    meter: () => mixer.meter(),
    stats: () => ({ state: ac.state, started, unlocked: bus.unlocked, sampleRate: ac.sampleRate, voices: mixer.voiceCount, voiceLimit: mixer.voiceLimit, bankReady: bank.ready, bankProgress: bank.progress, updateMs: +perf.ms.toFixed(3), updateMaxMs: +perf.max.toFixed(2), inside: mixer.inside, ambience: ambience.debug(), traffic: traffic.debug() }),
    /** trigger a sound by name for QA: gun names, 'honk', 'siren', 'thunder', 'subway', bank names */
    test: (name: string, opts: Record<string, number> = {}) => {
      const now = ac.currentTime + 0.01;
      const cam = ctx.camera.position;
      const w: Record<string, number> = { pistol: 1, smg: 2, shotgun: 3, rifle: 4 };
      if (w[name]) {
        if (opts.dist) {
          const ang = opts.angle ?? 0;
          const o = cam.clone().add({ x: Math.sin(ang) * opts.dist, y: 0, z: -Math.cos(ang) * opts.dist } as never);
          const dir = cam.clone().sub(o).normalize();
          ctx.events.emit('remoteFire', 9999, w[name], o, dir);
        } else ctx.events.emit('localFire', w[name], cam.clone(), ctx.camera.getWorldDirection(cam.clone()));
        return true;
      }
      if (name === 'honk') {
        honk(ac, mixer.exteriorAmb, now, { x: cam.x + 20, z: cam.z - 30, style: 'sedan', dur: 0.5, dist: 36 });
        return true;
      }
      if (name === 'siren') {
        const p = createPanner(ac, mixer.exteriorSfx, { ref: 8, x: cam.x + 15, y: 1, z: cam.z - 15 });
        const s = new SirenVoice(ac, p, { level: 0.8 });
        s.stop(0.3, now + Math.max(0.1, Math.min(60, opts.seconds ?? 8)), [p]);
        return true;
      }
      if (name === 'thunder') {
        thunder(ac, mixer.exteriorAmb, now, opts.dist ?? 0.3);
        return true;
      }
      if (name === 'subway') {
        subwayPass(ac, mixer.exteriorAmb, cam.x + 6, cam.z, true, now);
        return true;
      }
      if (name === 'footstep') {
        ctx.events.emit('footstep', cam.clone(), 'concrete', true);
        return true;
      }
      if (soundDef(name)) {
        mixer.play(bank.get(name), { bus: 'local', gain: opts.gain ?? 0.8 });
        return true;
      }
      return false;
    },
    /** offline-render a synth to PCM for verification: gun names, 'siren', 'engine_idle|mid|high', 'ambience', 'honk', 'thunder', 'subway', bank names */
    render: async (name: string, seconds = 3): Promise<AudioRender> => renderOffline(name, seconds, ac.sampleRate),
    list: () => [...RENDER_NAMES],
  };
  const settings = readAudioSettings();
  for (const name of ['master', 'sfx', 'ambient', 'music'] as const) mixer.setVolume(name, settings[name]);
  mixer.setMuted(settings.muted);
  (window as unknown as { __audio: typeof api }).__audio = api;
  return mod;
}

/** Canonical QA names; the renderer rejects typos rather than silently rendering idle. */
export const RENDER_NAMES = [
  ...SOUND_DEFS.map(d => d.name),
  ...['pistol', 'smg', 'rifle', 'shotgun'].flatMap(w => [30, 90, 200].map(d => `${w}_${d}m`)),
  'siren', 'siren_wail', 'siren_yelp', 'siren_priority', 'siren_hilo', 'siren_airHorn',
  ...['gas', 'v8', 'diesel'].flatMap(k => ['idle', 'mid', 'high', 'shift'].map(s => `engine_${k}_${s}`)),
  'engine_idle', 'engine_mid', 'engine_high', 'engine_sweep', 'engine_shift',
  'ambience', 'ambience_day', 'ambience_night', 'honk', 'horn', 'honk_phrase',
  'honk_tap', 'honk_double', 'honk_triple', 'honk_lean', 'rain', 'thunder', 'subway',
  ...['pickup', 'hit', 'headshot', 'kill', 'death', 'discovery', 'score', 'warning',
    'protection_end', 'safe_enter', 'safe_exit', 'banner'].map(n => `ui_${n}`),
];

/** standalone offline renders (also used by tools to write WAVs) */
export async function renderOffline(name: string, seconds: number, sampleRate: number): Promise<AudioRender> {
  if (!Number.isFinite(seconds) || seconds < 0.1 || seconds > 60) throw new RangeError('render duration must be 0.1..60 seconds');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new RangeError('invalid render sample rate');
  const off = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const chain = createMasterChain(off, off.destination);
  const dest = chain.input;
  // A requested crop must also end at zero; leave room for the dynamics' lookahead.
  rampTo(dest.gain, 0, seconds - Math.min(0.04, seconds / 4), Math.min(0.015, seconds / 8));
  const t0 = 0.02;
  const releaseAt = Math.max(t0, seconds - 0.25);
  const remote = /^(pistol|smg|rifle|shotgun)_(?:(?:far|remote)_)?(30|90|200)m?$/.exec(name);
  const def = soundDef(remote?.[1] ?? name);
  const gun = ['pistol', 'smg', 'shotgun', 'rifle'].includes(remote?.[1] ?? name);
  const reverb = (far: boolean): GainNode => {
    const conv = off.createConvolver();
    conv.normalize = false;
    conv.buffer = makeStreetIR(off, far ? STREET_IR_FAR_SECONDS : STREET_IR_NEAR_SECONDS, far ? STREET_IR_FAR : STREET_IR_NEAR);
    conv.connect(gain(off, 0.9, dest));
    return gain(off, 1, conv);
  };
  if (gun && def) {
    // Use the same mono bank, weapon trim, absorption, panning and sends as live playback.
    const p = remote ? remoteShotParams(Number(remote[2])) : { delay: 0, lowpass: 20000, gain: 1, verb: 0.5, verbFar: 0 };
    const src = off.createBufferSource();
    src.buffer = await renderRecipe(def.recipe, def.seconds, 0, sampleRate);
    const level = gain(off, p.gain * weaponLevel(def.name));
    if (remote) src.connect(filter(off, 'lowpass', p.lowpass, 0.5, 0, level));
    else src.connect(level);
    const head = remote ? createPanner(off, dest, { ref: 1, rolloff: 0, x: 0, y: 0, z: -Number(remote[2]) }) : level;
    if (remote) level.connect(head);
    else head.connect(dest);
    head.connect(gain(off, p.verb, reverb(false)));
    if (p.verbFar) head.connect(gain(off, p.verbFar, reverb(true)));
    src.start(t0 + p.delay);
  } else if (/^siren(?:_(?:wail|yelp|priority|hilo|airHorn|airhorn))?$/.test(name)) {
    const s = new SirenVoice(off, dest, { level: 0.6, t0 });
    s.auto = false;
    s.setMode(name === 'siren_yelp' ? 'yelp' : name === 'siren_priority' ? 'priority' : name === 'siren_hilo' ? 'hilo' : 'wail', t0);
    if (/airhorn/i.test(name)) s.airHorn(0.7, t0 + Math.min(0.5, seconds / 4));
    s.stop(0.15, releaseAt);
  } else if (/^engine(?:_(?:gas|v8|diesel))?_(?:idle|mid|high|sweep|shift)$/.test(name)) {
    const kind: EngineKind = name.includes('diesel') ? 'diesel' : name.includes('v8') ? 'v8' : 'gas';
    const e = new EngineVoice(off, dest, kind, { level: 0.7, t0 });
    const lvl = name.endsWith('high') ? 1 : name.endsWith('mid') ? 0.5 : /(?:sweep|shift)$/.test(name) ? -1 : 0;
    if (lvl < 0) {
      const duration = Math.max(0.01, releaseAt - t0);
      for (let i = 0; i <= 24; i++) {
        const tt = t0 + duration * 0.85 * i / 24;
        const k = i / 24;
        const rpm = e.idleRpm + (e.maxRpm - e.idleRpm) * (k < 0.5 ? k * 2 : 0.4 + (k - 0.5) * 1.2);
        e.set(rpm, k < 0.5 ? 0.9 : 0.6, tt, 0.08);
        if (i === 12) e.shift(tt);
      }
      e.set(e.idleRpm, 0.05, t0 + duration * 0.9, 0.1);
    } else e.set(e.idleRpm + (e.maxRpm - e.idleRpm) * lvl, lvl === 0 ? 0.04 : lvl === 0.5 ? 0.45 : 1, t0, 0.02);
    e.stop(0.15, releaseAt);
  } else if (['ambience', 'ambience_day', 'ambience_night'].includes(name)) {
    const night = name === 'ambience_night' ? 1 : 0;
    const bedBus = gain(off, 0.8, dest); // default live ambient setting
    const bed = new CityBed(off, bedBus, t0);
    for (let t = t0; t < releaseAt; t += 0.1) {
      bed.set({ density: 1, night, inPark: 0, trees: 4, hvac: 0.6, wind: 0.3, precip: 0 }, t, t - t0);
    }
    bed.passBy(t0 + 1, { dist01: 0.5, level: night ? 0.035 : 0.07, fromLeft: true, dur: 3.5 });
    if (!night) bed.passBy(t0 + 4, { dist01: 0.7, level: 0.06, fromLeft: false, dur: 3 });
    const far = reverb(true);
    honkPhrase(off, bedBus, t0 + 1.2, { x: 40, z: -60, style: 'taxi', dist: 70, verb: far });
    const sp = createPanner(off, bedBus, { ref: 45, rolloff: 1, max: 900, x: 240, y: 2, z: -180 });
    sp.connect(gain(off, 0.35, far));
    const siren = new SirenVoice(off, sp, { level: 0.7, distant: true, t0 });
    siren.auto = false;
    if (!night) soundDef('chirp')!.recipe(off, createPanner(off, bedBus, { ref: 6, x: 8, y: 4, z: -5 }), t0 + 2.4, 1);
    siren.stop(0.15, releaseAt, [sp]);
    bed.stop(0.15, releaseAt);
  } else if (name === 'honk' || name === 'horn') {
    honk(off, dest, t0, { x: 10, z: -20, style: 'sedan', dur: 0.6, dist: 22 });
    honk(off, dest, t0 + 1.0, { x: 10, z: -20, style: 'taxi', dur: 0.2, dist: 22 });
    honk(off, dest, t0 + 1.3, { x: 10, z: -20, style: 'taxi', dur: 0.5, dist: 22 });
    honk(off, dest, t0 + 2.2, { x: 10, z: -20, style: 'truck', dur: 0.8, dist: 22 });
  } else if (/^honk_(?:phrase|tap|double|triple|lean)$/.test(name)) {
    honkPhrase(off, dest, t0, { x: 10, z: -20, style: 'taxi', dist: 22, verb: reverb(true) },
      name === 'honk_phrase' ? undefined : name.slice(5) as 'tap' | 'double' | 'triple' | 'lean');
  } else if (name === 'rain') {
    const out = gain(off, 1, dest);
    const rain = createRainBed(off, out, t0);
    rain.hi.gain.setTargetAtTime(0.2, t0, 0.15);
    rain.lo.gain.setTargetAtTime(0.16, t0, 0.15);
    stopSources(rain.sources, out, 0.2, Math.max(t0, seconds - 0.3));
  } else if (name.startsWith('ui_')) {
    const ui = new UiSynth(off, dest);
    switch (name) {
      case 'ui_pickup': ui.pickup(); break;
      case 'ui_hit': ui.hitMarker(false); break;
      case 'ui_headshot': ui.hitMarker(true); break;
      case 'ui_kill': ui.killConfirm(); break;
      case 'ui_death': ui.deathSting(); break;
      case 'ui_discovery': ui.discovery(true); break;
      case 'ui_score': ui.scoreTick(); break;
      case 'ui_warning': ui.protectionWarning(); break;
      case 'ui_protection_end': ui.protectionEnd(); break;
      case 'ui_safe_enter': ui.safeZone(true); break;
      case 'ui_safe_exit': ui.safeZone(false); break;
      case 'ui_banner': ui.bannerPing(); break;
      default: throw new Error(`unknown UI render "${name}"`);
    }
  } else if (name === 'thunder') thunder(off, dest, t0, 0.25);
  else if (name === 'subway') subwayPass(off, dest, 0, -5, true, t0);
  else if (def) def.recipe(off, dest, t0, 0);
  else throw new Error(`unknown render "${name}"`);
  const buf = await off.startRendering();
  chain.dispose();
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  return { sampleRate: buf.sampleRate, channels };
}
