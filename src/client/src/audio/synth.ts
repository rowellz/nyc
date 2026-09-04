/**
 * Low-level WebAudio synthesis primitives shared by every audio sub-system.
 * Everything here works on any BaseAudioContext (live or OfflineAudioContext) so the same recipes
 * can be pre-rendered into buffers, played live, or rendered to WAV for verification.
 */
import { finishNow, scheduleInit } from '../combat/init';
import type { GameContext } from '@/core/context';

export type AC = BaseAudioContext;
export type NoiseKind = 'white' | 'pink' | 'brown';

export const rnd = (a = 0, b = 1): number => a + Math.random() * (b - a);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const finite = (v: number, fallback = 0): number => Number.isFinite(v) ? v : fallback;
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, finite(v, a)));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dB = (db: number): number => Math.pow(10, db / 20);
export const cents = (ratio: number): number => 1200 * Math.log2(Math.max(1e-6, ratio));

// ------------------------------------------------------------------------------------------------
// Noise. Raw sample data is cached per kind (independent of context), buffers per context.
// ------------------------------------------------------------------------------------------------
const NOISE_SECONDS = 3;
const noiseData = new Map<string, Float32Array>();
const noiseBuffers = new WeakMap<AC, Map<string, AudioBuffer>>();
const sourceEnds = new WeakMap<AudioScheduledSourceNode, number>();

export function* fillNoiseSteps(d: Float32Array, kind: NoiseKind, seed = 1): Generator<void, void, unknown> {
  // small xorshift so pre-rendered banks are reproducible between runs
  let s = (seed * 2654435761) >>> 0 || 1;
  const rand = (): number => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
  if (kind === 'white') {
    for (let i = 0; i < d.length; i++) {
      if (i % 1024 === 0) yield;
      d[i] = rand();
    }
    return;
  }
  if (kind === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      if (i % 1024 === 0) yield;
      const w = rand();
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return;
  }
  // brown: leaky integrator, normalized to +-0.9 peak
  let last = 0, peak = 1e-6;
  for (let i = 0; i < d.length; i++) {
    if (i % 1024 === 0) yield;
    const w = rand();
    last = (last + 0.02 * w) / 1.02;
    d[i] = last;
    const a = Math.abs(last);
    if (a > peak) peak = a;
  }
  const k = 0.9 / peak;
  for (let i = 0; i < d.length; i++) {
    if (i % 1024 === 0) yield;
    d[i] *= k;
  }
}

export function fillNoise(d: Float32Array, kind: NoiseKind, seed = 1): void {
  finishNow(fillNoiseSteps(d, kind, seed));
}

function noiseSamples(kind: NoiseKind, sr: number, ch: number): Float32Array {
  const key = `${kind}:${sr}:${ch}`;
  let d = noiseData.get(key);
  if (!d) {
    d = new Float32Array(Math.floor(sr * NOISE_SECONDS));
    fillNoise(d, kind, 7 + ch * 31 + (kind === 'pink' ? 100 : kind === 'brown' ? 200 : 0));
    noiseData.set(key, d);
  }
  return d;
}

export function noiseBuffer(ac: AC, kind: NoiseKind): AudioBuffer {
  let m = noiseBuffers.get(ac);
  if (!m) {
    m = new Map();
    noiseBuffers.set(ac, m);
  }
  let buf = m.get(kind);
  if (!buf) {
    const sr = ac.sampleRate;
    buf = ac.createBuffer(2, Math.floor(sr * NOISE_SECONDS), sr);
    buf.copyToChannel(noiseSamples(kind, sr, 0) as Float32Array<ArrayBuffer>, 0);
    buf.copyToChannel(noiseSamples(kind, sr, 1) as Float32Array<ArrayBuffer>, 1);
    m.set(kind, buf);
  }
  return buf;
}

export interface NoiseOpts {
  loop?: boolean;
  t0?: number;
  /** stop time (absolute) for one-shots */
  end?: number;
  rate?: number;
  /** deterministic start offset (seconds) instead of a random one */
  offset?: number;
}

/** a noise source, started at a random offset so parallel voices never phase-lock */
export function noiseSrc(ac: AC, dest: AudioNode | null, kind: NoiseKind, o: NoiseOpts = {}): AudioBufferSourceNode {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac, kind);
  src.loop = o.loop ?? true;
  src.playbackRate.value = clamp(o.rate ?? 1, 0.01, 16);
  if (dest) src.connect(dest);
  const t0 = Math.max(0, finite(o.t0 ?? ac.currentTime, ac.currentTime));
  const off = o.offset ?? Math.random() * (NOISE_SECONDS - 1);
  disconnectOnEnded(src);
  src.start(Math.max(0, finite(t0)), Math.max(0, finite(off)) % NOISE_SECONDS);
  if (o.end !== undefined) {
    const end = Math.max(t0, finite(o.end, t0));
    sourceEnds.set(src, end);
    src.stop(end);
  }
  return src;
}

// ------------------------------------------------------------------------------------------------
// Node helpers
// ------------------------------------------------------------------------------------------------
export function gain(ac: AC, v: number, dest?: AudioNode | AudioParam | null): GainNode {
  const g = ac.createGain();
  g.gain.value = finite(v);
  if (dest) {
    if ('setValueAtTime' in dest) g.connect(dest as AudioParam);
    else g.connect(dest as AudioNode);
  }
  return g;
}

export function filter(ac: AC, type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0, dest?: AudioNode | null): BiquadFilterNode {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = clamp(freq, 0, ac.sampleRate / 2);
  f.Q.value = clamp(q, 0.0001, 1000);
  if (gainDb) f.gain.value = finite(gainDb);
  if (dest) f.connect(dest);
  return f;
}

export function osc(ac: AC, type: OscillatorType, freq: number, dest?: AudioNode | null, t0?: number, end?: number): OscillatorNode {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = clamp(freq, 0, ac.sampleRate / 2);
  if (dest) o.connect(dest);
  disconnectOnEnded(o);
  const start = Math.max(0, finite(t0 ?? ac.currentTime, ac.currentTime));
  o.start(start);
  if (end !== undefined) {
    const stop = Math.max(start, finite(end, start));
    sourceEnds.set(o, stop);
    o.stop(stop);
  }
  return o;
}

let shaperCache = new WeakMap<AC, Map<number, Float32Array>>();
/** tanh soft clipper. drive 1 = gentle, 4 = crunchy */
export function softClip(ac: AC, drive = 2, dest?: AudioNode | null): WaveShaperNode {
  drive = clamp(drive, 0.001, 100);
  let m = shaperCache.get(ac);
  if (!m) {
    m = new Map();
    shaperCache.set(ac, m);
  }
  let curve = m.get(drive);
  if (!curve) {
    const n = 1024;
    curve = new Float32Array(n);
    const k = Math.tanh(drive);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * drive) / k;
    }
    m.set(drive, curve);
  }
  const ws = ac.createWaveShaper();
  ws.curve = curve as Float32Array<ArrayBuffer>;
  ws.oversample = '2x';
  if (dest) ws.connect(dest);
  return ws;
}

// ------------------------------------------------------------------------------------------------
// Envelopes. `curve` writes an explicit value curve ending exactly at 0 => click-free stops.
// ------------------------------------------------------------------------------------------------
export function curve(p: AudioParam, t0: number, dur: number, fn: (t01: number, tSec: number) => number, n = 96): void {
  t0 = Math.max(0, finite(t0));
  dur = Math.max(0.0001, finite(dur, 0.1));
  n = Math.round(clamp(n, 2, 16384));
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    v[i] = finite(fn(t, t * dur));
  }
  v[n - 1] = 0;
  p.setValueCurveAtTime(v, t0, dur);
}

/** attack (linear) then exponential decay with time constant tau, forced to 0 at dur */
export function attackDecay(p: AudioParam, t0: number, dur: number, peak: number, attack: number, tau: number): void {
  const a = Math.max(0.0005, attack);
  curve(p, t0, dur, (_, t) => {
    if (t < a) return (peak * t) / a;
    const v = peak * Math.exp(-(t - a) / tau);
    // fade the last 15% linearly so we always land on zero without a step
    const tail = (dur - t) / (dur * 0.15);
    return tail < 1 ? v * Math.max(0, tail) : v;
  }, Math.max(32, Math.min(256, Math.round(dur * 400))));
}

/** hold at `peak` after `attack` until `dur - release`, then linear release */
export function holdRelease(p: AudioParam, t0: number, dur: number, peak: number, attack: number, release: number): void {
  curve(p, t0, dur, (_, t) => {
    if (t < attack) return (peak * t) / Math.max(1e-4, attack);
    if (t > dur - release) return (peak * (dur - t)) / Math.max(1e-4, release);
    return peak;
  }, Math.max(16, Math.min(128, Math.round(dur * 60))));
}

export function sweep(p: AudioParam, t0: number, f0: number, f1: number, dur: number, exp = true): void {
  p.setValueAtTime(Math.max(1e-3, f0), t0);
  if (exp) p.exponentialRampToValueAtTime(Math.max(1e-3, f1), t0 + dur);
  else p.linearRampToValueAtTime(f1, t0 + dur);
}

/** smooth live parameter changes (per-frame); tau in seconds */
export function slew(p: AudioParam, v: number, now: number, tau = 0.05): void {
  if (!Number.isFinite(v) || !Number.isFinite(now)) return;
  now = Math.max(0, now);
  // Replace pending ramps too (e.g. a zero-level engine's constructor fade-in).
  p.cancelAndHoldAtTime(now);
  p.setTargetAtTime(v, now, Math.max(0.001, finite(tau, 0.05)));
}

/** cancel automation and ramp to a value, click-free */
export function rampTo(p: AudioParam, v: number, now: number, dur = 0.02): void {
  if (!Number.isFinite(v) || !Number.isFinite(now)) return;
  now = Math.max(0, now);
  p.cancelAndHoldAtTime(now);
  dur = Math.max(0.001, finite(dur, 0.02));
  // A new linear ramp after a completed ramp can reach backwards to its old endpoint,
  // especially when scheduling an offline release in advance. A target starts at `now`
  // from the actual held value. Eight time constants leave <0.04% before the exact endpoint.
  p.setTargetAtTime(v, now, dur / 8);
  p.setValueAtTime(v, now + dur);
}

// ------------------------------------------------------------------------------------------------
// Impulse response: Manhattan street reverb. The convolver runs with normalize=false, so the IR is
// scaled in real energy terms: a diffuse tail of amplitude a with time constant tau carries energy
// ~ a^2 * tau * sr / 2 relative to a unit impulse. Specular slap-backs off the facades (40/90/150 ms,
// then weaker) and a 60 ms facade-to-facade flutter (a 20 m street) sit on top, and HF damping grows
// over the tail (masonry, air). `far` builds the darker, longer tail heard from a shot blocks away.
// ------------------------------------------------------------------------------------------------
export interface StreetIROpts {
  preDelay?: number;
  /** specular reflections: [seconds, amplitude] */
  early?: [number, number][];
  /** diffuse tail noise amplitude (see energy note above) */
  tailLevel?: number;
  /** HF damping multiplier (<1 = darker) */
  damp?: number;
  /** first flutter echo amplitude (60 ms train, decays 0.68 per hop) */
  flutter?: number;
}
export const STREET_IR_NEAR: StreetIROpts = { preDelay: 0.006, early: [[0.04, 0.5], [0.09, 0.38], [0.15, 0.3], [0.23, 0.17], [0.31, 0.1]], tailLevel: 0.012, damp: 1, flutter: 0.12 };
export const STREET_IR_FAR: StreetIROpts = { preDelay: 0.016, early: [[0.05, 0.28], [0.11, 0.3], [0.17, 0.26], [0.26, 0.2], [0.36, 0.14], [0.48, 0.09]], tailLevel: 0.011, damp: 0.45, flutter: 0.05 };
export const STREET_IR_NEAR_SECONDS = 1.3;
export const STREET_IR_FAR_SECONDS = 1.8;

export function* streetIRSteps(sr: number, seconds = STREET_IR_NEAR_SECONDS, opts: StreetIROpts = STREET_IR_NEAR): Generator<void, Float32Array[], unknown> {
  const n = Math.floor(sr * seconds);
  const channels = [new Float32Array(n), new Float32Array(n)];
  const pre = opts.preDelay ?? 0.006;
  const early = opts.early ?? STREET_IR_NEAR.early!;
  const tailLevel = opts.tailLevel ?? 0.012;
  const flutter = opts.flutter ?? 0.12;
  const tau = seconds / 6.9; // -60 dB at `seconds`
  for (let ch = 0; ch < 2; ch++) {
    const d = channels[ch];
    let s = (ch + 1) * 977;
    const rand = (): number => {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return (s / 4294967296) * 2 - 1;
    };
    // diffuse tail: builds over the first 50 ms (the sound has to reach the facades first)
    const preN = Math.floor(pre * sr);
    for (let i = preN; i < n; i++) {
      if (i % 1024 === 0) yield;
      const t = (i - preN) / sr;
      d[i] = rand() * tailLevel * Math.exp(-t / tau) * (t < 0.05 ? t / 0.05 : 1);
    }
    // specular slap-backs with a little diffusion behind each, offset per channel for width
    for (const [sec, g] of early) {
      const at = Math.floor((sec + pre + (ch ? 0.003 : -0.003)) * sr);
      if (at >= n) continue;
      d[at] += g * (ch ? 0.9 : 1);
      const len = Math.floor(0.008 * sr);
      for (let i = 1; i < len && at + i < n; i++) d[at + i] += rand() * g * 0.12 * Math.exp(-i / (len * 0.3));
    }
    // facade-to-facade flutter: alternating sides, 60 ms spacing, slightly different per channel
    for (let k = 1; k <= 8; k++) {
      const at = Math.floor((pre + 0.06 * k + (ch ? 0.0025 : -0.0025) * k) * sr);
      if (at >= n) break;
      d[at] += flutter * Math.pow(0.68, k - 1) * ((k + ch) % 2 ? 1 : -1);
    }
    // HF damping: one-pole lowpass whose cutoff falls from ~8 kHz to ~1.4 kHz over the tail
    let y = 0;
    for (let i = 0; i < n; i++) {
      if (i % 1024 === 0) yield;
      const t = i / sr;
      const fc = lerp(8000, 1400, clamp(t / (seconds * 0.7), 0, 1)) * (opts.damp ?? 1);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      y += a * (d[i] - y);
      d[i] = y;
    }
  }
  return channels;
}

export function makeStreetIR(ac: AC, seconds = STREET_IR_NEAR_SECONDS, opts: StreetIROpts = STREET_IR_NEAR): AudioBuffer {
  const data = finishNow(streetIRSteps(ac.sampleRate, seconds, opts));
  const buffer = ac.createBuffer(2, data[0].length, ac.sampleRate);
  data.forEach((channel, i) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, i));
  return buffer;
}

export interface SynthSamples { noise: Array<{ key: string; data: Float32Array }>; ir: Float32Array[]; irFar: Float32Array[] }
/** Same seeded algorithms on both paths; fallback remains cooperatively scheduled. */
export function* synthSamples(sr: number): Generator<void, SynthSamples, unknown> {
  const noise: SynthSamples['noise'] = [];
  for (const kind of ['white', 'pink', 'brown'] as const) {
    for (let ch = 0; ch < 2; ch++) {
      const data = new Float32Array(Math.floor(sr * NOISE_SECONDS));
      yield* fillNoiseSteps(data, kind, 7 + ch * 31 + (kind === 'pink' ? 100 : kind === 'brown' ? 200 : 0));
      noise.push({ key: `${kind}:${sr}:${ch}`, data });
    }
  }
  const ir = yield* streetIRSteps(sr, STREET_IR_NEAR_SECONDS, STREET_IR_NEAR);
  const irFar = yield* streetIRSteps(sr, STREET_IR_FAR_SECONDS, STREET_IR_FAR);
  return { noise, ir, irFar };
}

export interface StreetIRs { near: AudioBuffer; far: AudioBuffer }
export async function prepareSynth(ctx: GameContext, ac: AC): Promise<StreetIRs> {
  ctx.busy = (ctx.busy ?? 0) + 1;
  let worker: Worker | undefined;
  try {
    let data: SynthSamples;
    try {
      worker = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' });
      const active = worker;
      data = await new Promise<SynthSamples>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Audio worker timed out')), 10000);
        active.onmessage = event => { clearTimeout(timeout); resolve(event.data); };
        active.onerror = event => { clearTimeout(timeout); event.preventDefault(); reject(new Error(event.message)); };
        active.onmessageerror = () => { clearTimeout(timeout); reject(new Error('Invalid audio worker response')); };
        active.postMessage(ac.sampleRate);
      });
    } catch (error) {
      console.warn('[audio] sample worker unavailable, using sliced synthesis', error);
      worker?.terminate();
      data = await scheduleInit(ctx, synthSamples(ac.sampleRate));
    }
    return await scheduleInit(ctx, (function* () {
      for (const item of data.noise) noiseData.set(item.key, item.data);
      for (const kind of ['white', 'pink', 'brown'] as const) { yield; noiseBuffer(ac, kind); }
      yield;
      const near = ac.createBuffer(2, data.ir[0].length, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) { yield; near.copyToChannel(data.ir[ch] as Float32Array<ArrayBuffer>, ch); }
      const far = ac.createBuffer(2, data.irFar[0].length, ac.sampleRate);
      for (let ch = 0; ch < 2; ch++) { yield; far.copyToChannel(data.irFar[ch] as Float32Array<ArrayBuffer>, ch); }
      return { near, far };
    })());
  } finally {
    worker?.terminate();
    ctx.busy = (ctx.busy ?? 1) - 1;
  }
}

// ------------------------------------------------------------------------------------------------
// Chains: quick "source -> filter -> envelope gain -> dest" builders used by the one-shot recipes.
// ------------------------------------------------------------------------------------------------
export interface BurstOpts {
  kind?: NoiseKind;
  type?: BiquadFilterType;
  freq?: number;
  q?: number;
  /** second filter stage (e.g. highpass to clean the low end) */
  type2?: BiquadFilterType;
  freq2?: number;
  q2?: number;
  peak?: number;
  attack?: number;
  tau?: number;
  dur?: number;
  /** filter frequency sweep target (exponential over dur) */
  freqTo?: number;
  rate?: number;
}

/** filtered noise burst with an attack/decay envelope. Returns the end time. */
export function burst(ac: AC, dest: AudioNode, t0: number, o: BurstOpts): number {
  const dur = o.dur ?? 0.1;
  const g = gain(ac, 0, dest);
  const nodes: AudioNode[] = [g];
  let node: AudioNode = g;
  if (o.type2) {
    const f2 = filter(ac, o.type2, o.freq2 ?? 1000, o.q2 ?? 0.7, 0, node);
    nodes.push(f2);
    node = f2;
  }
  if (o.type) {
    const f = filter(ac, o.type, o.freq ?? 1000, o.q ?? 0.7, 0, node);
    if (o.freqTo) sweep(f.frequency, t0, o.freq ?? 1000, o.freqTo, dur);
    nodes.push(f);
    node = f;
  }
  const src = noiseSrc(ac, node, o.kind ?? 'white', { t0, end: t0 + dur + 0.01, loop: true, rate: o.rate });
  disconnectOnEnded(src, nodes);
  attackDecay(g.gain, t0, dur, o.peak ?? 1, o.attack ?? 0.001, o.tau ?? dur / 4);
  return t0 + dur;
}

export interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  freqTo?: number;
  peak?: number;
  attack?: number;
  tau?: number;
  dur?: number;
  /** optional lowpass on the tone */
  lp?: number;
  /** optional partial multipliers with relative gains (bell timbres) */
  partials?: [number, number][];
}

/** oscillator tone with attack/decay (and optional pitch sweep). Returns the end time. */
export function tone(ac: AC, dest: AudioNode, t0: number, o: ToneOpts): number {
  const dur = o.dur ?? 0.2;
  const g = gain(ac, 0, dest);
  const nodes: AudioNode[] = [g];
  let into: AudioNode = g;
  if (o.lp) { into = filter(ac, 'lowpass', o.lp, 0.7, 0, g); nodes.push(into); }
  const parts: [number, number][] = o.partials ?? [[1, 1]];
  let remaining = parts.length;
  for (const [mul, pg] of parts) {
    const pgain = gain(ac, pg, into);
    nodes.push(pgain);
    const os = osc(ac, o.type ?? 'sine', o.freq * mul, pgain, t0, t0 + dur + 0.01);
    os.addEventListener('ended', () => { if (--remaining === 0) for (const n of nodes) n.disconnect(); }, { once: true });
    if (o.freqTo) sweep(os.frequency, t0, o.freq * mul, o.freqTo * mul, dur);
  }
  attackDecay(g.gain, t0, dur, o.peak ?? 0.5, o.attack ?? 0.002, o.tau ?? dur / 4);
  return t0 + dur;
}

/**
 * Friedlander blast wave: a single asymmetric pressure pulse (sharp positive spike, shallow negative
 * phase). This is what a muzzle blast / explosion actually looks like at a microphone, and it is the
 * difference between a gunshot and a burst of static. T = positive-phase duration (s).
 */
export function blast(ac: AC, dest: AudioNode, t0: number, o: { T?: number; amp?: number; hp?: number } = {}): void {
  const T = o.T ?? 0.0008;
  const sr = ac.sampleRate;
  const n = Math.max(8, Math.floor(sr * T * 8));
  const buf = ac.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // half-sample rise to avoid a hard DC step, then (1 - t/T) e^{-t/T}
    d[i] = (o.amp ?? 1) * (1 - t / T) * Math.exp(-t / T) * Math.min(1, i / 2);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const hp = o.hp ? filter(ac, 'highpass', o.hp, 0.7, 0, dest) : null;
  src.connect(hp ?? dest);
  disconnectOnEnded(src, hp ? [hp] : []);
  src.start(t0);
}

/** stereo-safe convenience: schedule fn after a delay */
export const at = (t0: number, ms: number): number => t0 + ms / 1000;

/** Use audio-time ended events, never wall timers (which race suspended/offline contexts). */
export function disconnectOnEnded(src: AudioScheduledSourceNode, nodes: AudioNode[] = []): void {
  src.addEventListener('ended', () => {
    src.disconnect();
    for (const node of nodes) node.disconnect();
  }, { once: true });
}

/** Stop a continuous graph after its release and drop all retained source connections. */
export function stopSources(srcs: AudioScheduledSourceNode[], out: GainNode, fade = 0.1, now = out.context.currentTime, nodes: AudioNode[] = []): void {
  now = Math.max(0, finite(now, out.context.currentTime));
  fade = clamp(fade, 0.001, 10);
  rampTo(out.gain, 0, now, fade);
  let remaining = srcs.length;
  const cleanup = (): void => { out.disconnect(); for (const node of nodes) node.disconnect(); };
  if (!remaining) { cleanup(); return; }
  for (const src of srcs) {
    src.addEventListener('ended', () => { src.disconnect(); if (--remaining === 0) cleanup(); }, { once: true });
    // Do not prolong a one-shot (air horn / pass-by) that already has an earlier stop.
    const end = Math.min(sourceEnds.get(src) ?? Infinity, now + fade + 0.05);
    sourceEnds.set(src, end);
    src.stop(end);
  }
}
