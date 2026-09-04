/**
 * Mixer: bus graph on top of ctx.audio, master compressor + limiter, interior muffling, ducking,
 * a pooled/capped one-shot voice player with 3D panning, a level meter for tests, and settings.
 *
 *   ctx.audio.master -> compressor -> limiter -> destination         (master re-routed here)
 *   exteriorAmb -> muffleAmb -> duck -> ctx.audio.ambient
 *   exteriorSfx -> muffleSfx -> ctx.audio.sfx
 *   localSfx    -> ctx.audio.sfx                                       (own gun, own engine, own steps)
 *   ui          -> ctx.audio.sfx
 *   verbSend    -> convolver(near street IR, 1.3 s, bright slap-back) -> verbGain -> exteriorSfx
 *   verbFarSend -> convolver(far street IR, 1.8 s, dark roll)           -> verbFarGain -> exteriorSfx
 */
import { createPanner } from './spatial';
import type { AudioBus, Quality, GameContext } from '@/core/context';
import { clamp, dB, makeStreetIR, rampTo, slew, STREET_IR_FAR, STREET_IR_FAR_SECONDS, STREET_IR_NEAR, STREET_IR_NEAR_SECONDS, type StreetIRs } from './synth';
import { scheduleInit } from '../combat/init';

export interface PlayOpts {
  /** which bus: 'local' (unmuffled sfx), 'ext' (exterior sfx), 'amb' (exterior ambience), 'ui' */
  bus?: 'local' | 'ext' | 'amb' | 'ui';
  gain?: number;
  rate?: number;
  /** world position -> PannerNode; omit for non-positional */
  x?: number;
  y?: number;
  z?: number;
  hrtf?: boolean;
  refDistance?: number;
  rolloff?: number;
  maxDistance?: number;
  /** lowpass cutoff (Hz) on this voice */
  lowpass?: number;
  /** schedule delay in seconds (remote gunshots: distance / 343) */
  delay?: number;
  /** send to the near street reverb (0..1): bright 40/90/150 ms slap-back, 1.3 s tail */
  verb?: number;
  /** send to the far street reverb (0..1.5): darker, 1.8 s roll for shots blocks away */
  verbFar?: number;
  loop?: boolean;
  /** lower priority voices are stolen first */
  priority?: number;
  /** fade-in seconds (loops) */
  fadeIn?: number;
}

export interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode | null;
  filter: BiquadFilterNode | null;
  start: number;
  end: number;
  priority: number;
  alive: boolean;
  stop(fade?: number): void;
  setPosition(x: number, y: number, z: number): void;
}

export interface AudioSettings {
  master: number;
  sfx: number;
  ambient: number;
  music: number;
  muted: boolean;
}

const LS_KEY = 'nyc.audio';
export function readAudioSettings(): AudioSettings {
  const settings: AudioSettings = { master: 1, sfx: 1, ambient: 0.8, music: 0.5, muted: false };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<AudioSettings>;
      for (const key of ['master', 'sfx', 'ambient', 'music'] as const) {
        if (typeof data[key] === 'number') settings[key] = clamp(data[key], 0, 1);
      }
      if (typeof data.muted === 'boolean') settings.muted = data.muted;
    }
  } catch { /* unavailable storage or invalid settings */ }
  return settings;
}
export function saveAudioSettings(settings: AudioSettings): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); }
  catch { /* unavailable storage */ }
}

const MAX_VOICES = 24;
const RELEASE_VOICES = 4; // bounded extra slots for click-free stealing

export class Mixer {
  readonly ac: AudioContext;
  readonly exteriorAmb: GainNode;
  readonly exteriorSfx: GainNode;
  readonly localSfx: GainNode;
  readonly ui: GainNode;
  readonly verbSend: GainNode;
  readonly verbFarSend: GainNode;
  private muffleAmb: BiquadFilterNode;
  private muffleSfx: BiquadFilterNode;
  private interiorGain: GainNode;
  private duck: GainNode;
  private compressor: DynamicsCompressorNode;
  private limiter: DynamicsCompressorNode;
  private analyser: AnalyserNode;
  private meterBuf: Float32Array<ArrayBuffer>;
  private voices: Voice[] = [];
  private disposed = false;
  private nodes: AudioNode[] = [];
  private verbGain: GainNode;
  private verbFarGain: GainNode;
  private disposeMaster!: () => void;
  private duckUntil = 0;
  private settings: AudioSettings = { master: 1, sfx: 1, ambient: 0.8, music: 0.5, muted: false };
  inside = false;
  readonly hrtfAllowed: boolean;

  constructor(readonly bus: AudioBus, quality: Quality, deferReverb = false) {
    this.ac = bus.ctx;
    const ac = this.ac;
    this.hrtfAllowed = quality.level !== 'low';

    // master dynamics: re-route master through compressor + limiter
    const chain = createMasterChain(ac, ac.destination);
    this.disposeMaster = chain.dispose;
    this.compressor = chain.compressor;
    this.limiter = chain.limiter;
    this.analyser = chain.analyser;
    this.meterBuf = new Float32Array(this.analyser.fftSize);
    try {
      bus.master.disconnect();
    } catch {
      /* not connected yet */
    }
    bus.master.connect(chain.input);

    // exterior chains with interior muffling
    this.duck = ac.createGain();
    this.duck.connect(bus.ambient);
    this.muffleAmb = ac.createBiquadFilter();
    this.muffleAmb.type = 'lowpass';
    this.muffleAmb.frequency.value = 20000;
    this.muffleAmb.Q.value = 0.4;
    this.muffleAmb.connect(this.duck);
    this.exteriorAmb = ac.createGain();
    this.exteriorAmb.connect(this.muffleAmb);

    this.interiorGain = ac.createGain();
    this.interiorGain.connect(bus.sfx);
    this.muffleSfx = ac.createBiquadFilter();
    this.muffleSfx.type = 'lowpass';
    this.muffleSfx.frequency.value = 20000;
    this.muffleSfx.Q.value = 0.4;
    this.muffleSfx.connect(this.interiorGain);
    this.exteriorSfx = ac.createGain();
    this.exteriorSfx.connect(this.muffleSfx);

    this.localSfx = ac.createGain();
    this.localSfx.connect(bus.sfx);
    this.ui = ac.createGain();
    this.ui.gain.value = 0.8;
    this.ui.connect(bus.sfx);

    // street reverb (guns, impacts, footsteps of others)
    this.verbSend = ac.createGain();
    const verbGain = this.verbGain = ac.createGain();
    verbGain.gain.value = 0.9;
    verbGain.connect(this.exteriorSfx);
    this.verbFarSend = ac.createGain();
    const verbFarGain = this.verbFarGain = ac.createGain();
    verbFarGain.gain.value = 0.9;
    verbFarGain.connect(this.exteriorSfx);
    if (!deferReverb) {
      const conv = ac.createConvolver();
      conv.normalize = false;
      conv.buffer = makeStreetIR(ac, STREET_IR_NEAR_SECONDS, STREET_IR_NEAR);
      this.verbSend.connect(conv);
      conv.connect(verbGain);
      const convFar = ac.createConvolver();
      convFar.normalize = false;
      convFar.buffer = makeStreetIR(ac, STREET_IR_FAR_SECONDS, STREET_IR_FAR);
      this.verbFarSend.connect(convFar);
      convFar.connect(verbFarGain);
      this.nodes.push(conv, convFar);
    }

    this.nodes.push(this.duck, this.muffleAmb, this.exteriorAmb, this.interiorGain, this.muffleSfx, this.exteriorSfx, this.localSfx, this.ui, this.verbSend, verbGain, this.verbFarSend, verbFarGain);
    this.loadSettings();
    this.applySettings();
  }

  async prepareReverb(ctx: GameContext, irs: StreetIRs): Promise<void> {
    // Native convolvers partition long IRs internally. Do not run 34 separate FFT
    // engines + delay lines on the audio thread just to slice the one-time setup.
    // Yield between the two native buffer assignments; preserve both IRs exactly.
    const nodes: ConvolverNode[] = [];
    try {
      await scheduleInit(ctx, (function* (ac: AudioContext) {
        for (const ir of [irs.near, irs.far]) {
          yield;
          const convolver = ac.createConvolver();
          nodes.push(convolver);
          convolver.normalize = false;
          convolver.buffer = ir;
        }
      })(this.ac));
      if (this.disposed) return;
      this.verbSend.connect(nodes[0]);
      nodes[0].connect(this.verbGain);
      this.verbFarSend.connect(nodes[1]);
      nodes[1].connect(this.verbFarGain);
      this.nodes.push(...nodes);
    } finally {
      if (this.disposed || nodes.length !== 2) nodes.forEach(node => node.disconnect());
    }
  }

  get now(): number {
    return this.ac.currentTime;
  }

  busNode(b: PlayOpts['bus']): AudioNode {
    switch (b) {
      case 'amb':
        return this.exteriorAmb;
      case 'ext':
        return this.exteriorSfx;
      case 'ui':
        return this.ui;
      default:
        return this.localSfx;
    }
  }

  /** play a pre-rendered buffer through the pool. Returns null if the buffer is missing. */
  play(buffer: AudioBuffer | null, o: PlayOpts = {}): Voice | null {
    if (!buffer || this.disposed) return null;
    if (o.x !== undefined && ![o.x, o.y ?? 1.5, o.z ?? 0].every(Number.isFinite)) return null;
    const ac = this.ac;
    const t0 = ac.currentTime + clamp(o.delay ?? 0, 0, 60) + 0.003;
    if (this.voices.length >= MAX_VOICES + RELEASE_VOICES) return null;
    if (this.voices.filter((v) => v.alive).length >= MAX_VOICES) this.steal(o.priority ?? 0);
    if (this.voices.filter((v) => v.alive).length >= MAX_VOICES) return null;

    const src = ac.createBufferSource();
    src.buffer = buffer;
    src.loop = !!o.loop;
    const rate = clamp(o.rate ?? 1, 0.01, 16);
    src.playbackRate.value = rate;
    const g = ac.createGain();
    const target = clamp(o.gain ?? 1, 0, 8);
    if (o.fadeIn) {
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(target, t0 + clamp(o.fadeIn, 0.001, 10));
    } else g.gain.value = target;

    let head: AudioNode = g;
    let filt: BiquadFilterNode | null = null;
    if (o.lowpass && o.lowpass < 19000) {
      filt = ac.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = clamp(o.lowpass, 10, ac.sampleRate / 2);
      filt.Q.value = 0.5;
      src.connect(filt);
      filt.connect(g);
    } else src.connect(g);

    let panner: PannerNode | null = null;
    if (o.x !== undefined) {
      panner = createPanner(ac, this.busNode(o.bus), { hrtf: o.hrtf && this.hrtfAllowed, ref: o.refDistance ?? 3, rolloff: o.rolloff, max: o.maxDistance ?? 300, x: o.x, y: o.y, z: o.z });
      g.connect(panner);
      head = panner;
    }
    if (!panner) head.connect(this.busNode(o.bus));
    let send: GainNode | null = null;
    if (o.verb) {
      send = ac.createGain();
      send.gain.value = clamp(o.verb, 0, 4);
      head.connect(send);
      send.connect(this.verbSend);
    }
    let sendFar: GainNode | null = null;
    if (o.verbFar) {
      sendFar = ac.createGain();
      sendFar.gain.value = clamp(o.verbFar, 0, 4);
      head.connect(sendFar);
      sendFar.connect(this.verbFarSend);
    }

    const dur = o.loop ? Infinity : buffer.duration / rate;
    const voice: Voice = {
      src,
      gain: g,
      panner,
      filter: filt,
      start: t0,
      end: t0 + dur,
      priority: o.priority ?? 0,
      alive: true,
      stop: (fade = 0.02) => {
        if (!voice.alive) return;
        voice.alive = false;
        const now = ac.currentTime;
        try {
          fade = clamp(fade, 0.001, 10);
          rampTo(g.gain, 0, now, fade);
          src.stop(now + fade + 0.005);
        } catch {
          /* already stopped */
        }
      },
      setPosition: (x, y, z) => {
        if (!panner) return;
        const now = ac.currentTime;
        slew(panner.positionX, x, now, 0.04);
        slew(panner.positionY, y, now, 0.04);
        slew(panner.positionZ, z, now, 0.04);
      },
    };
    src.onended = () => {
      voice.alive = false;
      const i = this.voices.indexOf(voice);
      if (i >= 0) this.voices.splice(i, 1);
      try {
        src.disconnect();
        g.disconnect();
        filt?.disconnect();
        panner?.disconnect();
        send?.disconnect();
        sendFar?.disconnect();
      } catch {
        /* ignore */
      }
    };
    src.start(t0);
    if (!o.loop) src.stop(t0 + dur + 0.01);
    this.voices.push(voice);
    return voice;
  }

  private steal(incomingPriority: number): void {
    // steal the lowest-priority, then oldest, voice that is not more important than the newcomer
    let best: Voice | null = null;
    for (const v of this.voices) {
      if (!v.alive) continue;
      if (v.priority > incomingPriority) continue;
      if (!best || v.priority < best.priority || (v.priority === best.priority && v.start < best.start)) best = v;
    }
    if (best) {
      best.stop(0.01);
      // Keep releasing sources counted until onended, including burst overload.
    }
  }

  get voiceCount(): number {
    return this.voices.length;
  }

  get voiceLimit(): number { return MAX_VOICES + RELEASE_VOICES; }

  /** gunshots duck the ambience for ~200 ms */
  duckAmbience(amount = 0.3, ms = 200): void {
    amount = clamp(amount, 0, 1);
    ms = clamp(ms, 0, 60000);
    const now = this.ac.currentTime;
    const g = this.duck.gain;
    g.cancelAndHoldAtTime(now);
    g.linearRampToValueAtTime(amount, now + 0.006);
    g.setValueAtTime(amount, now + 0.03);
    g.linearRampToValueAtTime(1, now + 0.03 + ms / 1000);
    this.duckUntil = now + ms / 1000;
  }

  /** interior muffling (inside a vehicle) */
  setInside(inside: boolean): void {
    if (inside === this.inside) return;
    this.inside = inside;
    const now = this.ac.currentTime;
    const fc = inside ? 750 : 20000;
    slew(this.muffleAmb.frequency, fc, now, 0.12);
    slew(this.muffleSfx.frequency, fc, now, 0.12);
    slew(this.interiorGain.gain, inside ? 0.55 : 1, now, 0.12);
    slew(this.exteriorAmb.gain, inside ? 0.5 : 1, now, 0.12);
  }

  /** RMS of the last analyser window (post-limiter), for tests */
  meter(): { rms: number; peak: number } {
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let s = 0, p = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const v = this.meterBuf[i];
      s += v * v;
      const a = Math.abs(v);
      if (a > p) p = a;
    }
    return { rms: Math.sqrt(s / this.meterBuf.length), peak: p };
  }

  // ---- settings ----
  getSettings(): AudioSettings {
    return { ...this.settings };
  }
  setVolume(bus: keyof Omit<AudioSettings, 'muted'>, v: number): void {
    this.settings[bus] = clamp(v, 0, 1);
    this.applySettings();
    this.saveSettings();
  }
  setMuted(m: boolean): void {
    this.settings.muted = m;
    this.applySettings();
    this.saveSettings();
  }
  private applySettings(): void {
    const s = this.settings;
    const now = this.ac.currentTime;
    const m = s.muted ? 0 : s.master;
    rampTo(this.bus.master.gain, m, now, 0.05);
    rampTo(this.bus.sfx.gain, s.sfx, now, 0.05);
    rampTo(this.bus.ambient.gain, s.ambient, now, 0.05);
    rampTo(this.bus.music.gain, s.music, now, 0.05);
  }
  private loadSettings(): void { this.settings = readAudioSettings(); }
  private saveSettings(): void { saveAudioSettings(this.settings); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const v of this.voices.slice()) v.stop(0.01);
    const teardown = (): void => {
      for (const node of this.nodes) node.disconnect();
      this.nodes = [];
      this.disposeMaster();
      try {
        this.bus.master.disconnect();
        this.bus.master.connect(this.ac.destination);
      } catch { /* context already closed */ }
    };
    if (this.ac instanceof AudioContext && this.ac.state !== 'running') {
      teardown();
      return;
    }
    // Let the releases render before disconnecting the buses. Immediate graph
    // teardown used to bypass every producer's carefully scheduled fade-out.
    const now = this.ac.currentTime;
    for (const bus of [this.exteriorAmb, this.exteriorSfx, this.localSfx, this.ui]) rampTo(bus.gain, 0, now, 0.02);
    const end = this.ac.createConstantSource();
    end.offset.value = 0;
    end.connect(this.localSfx);
    end.addEventListener('ended', () => { end.disconnect(); teardown(); }, { once: true });
    end.start(now);
    end.stop(now + 0.05);
  }
}

export const DB = dB;

/**
 * Master dynamics. Chrome's DynamicsCompressorNode applies automatic makeup gain
 * ((1/gainAtFullScale)^0.6, about +5 dB for these settings), so a trim follows each stage to keep the
 * nominal level where the sources put it: ambience beds around -28 dBFS, a close gunshot at -1 dBFS.
 */
export function createMasterChain(ac: BaseAudioContext, dest: AudioNode): { input: GainNode; compressor: DynamicsCompressorNode; limiter: DynamicsCompressorNode; analyser: AnalyserNode; dispose(): void } {
  const input = ac.createGain();
  const compressor = ac.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 10;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.25;
  const trim1 = ac.createGain();
  trim1.gain.value = 0.56; // -5 dB: undo the compressor's makeup gain
  const limiter = ac.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0.5;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.06;
  const trim2 = ac.createGain();
  trim2.gain.value = 0.89; // -1 dB: limiter makeup
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  input.connect(compressor);
  compressor.connect(trim1);
  trim1.connect(limiter);
  limiter.connect(trim2);
  trim2.connect(analyser);
  analyser.connect(dest);
  return { input, compressor, limiter, analyser, dispose() { for (const n of [input, compressor, trim1, limiter, trim2, analyser]) n.disconnect(); } };
}

/** Convolution is linear: sum delayed short partitions of the unchanged IR.
 * A single 1.25 s ConvolverNode.buffer assignment costs ~8 ms in Chrome's native
 * FFT setup, which cannot yield. 4096-sample partitions bound each assignment.
 * All taps are installed before the live mixer is exposed to sound producers.
 */
export function* partitionedReverb(ac: BaseAudioContext, input: AudioNode, output: AudioNode, ir: AudioBuffer): Generator<void, AudioNode[], unknown> {
  const nodes: AudioNode[] = [];
  let complete = false;
  try {
    for (let offset = 0; offset < ir.length; offset += 4096) {
      yield;
      const length = Math.min(4096, ir.length - offset);
      const part = ac.createBuffer(ir.numberOfChannels, length, ir.sampleRate);
      for (let ch = 0; ch < ir.numberOfChannels; ch++) {
        part.copyToChannel(ir.getChannelData(ch).subarray(offset, offset + length), ch);
      }
      yield;
      const convolver = ac.createConvolver();
      nodes.push(convolver);
      convolver.normalize = false;
      convolver.buffer = part;
      yield;
      if (offset) {
        const delay = ac.createDelay(ir.duration);
        delay.delayTime.value = offset / ir.sampleRate;
        nodes.push(delay);
        input.connect(delay);
        delay.connect(convolver);
      } else input.connect(convolver);
      convolver.connect(output);
    }
    complete = true;
    return nodes;
  } finally {
    if (!complete) nodes.forEach(node => node.disconnect());
  }
}
