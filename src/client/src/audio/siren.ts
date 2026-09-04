/**
 * NYPD siren (Federal Signal PA300 / Whelen 295 style 100 W horn driver).
 *   wail     = slow exponential sweep 700 -> 1600 -> 700 Hz, ~5 s per cycle, rise slower than fall
 *   yelp     = the same sweep at ~3.3 Hz (approaching an intersection)
 *   priority = "piercer": faster (~6 Hz), narrower band, used when boxed in
 *   hilo     = two alternating tones (~1.4 Hz)
 *   rumbler  = the tone an octave down through a lowpass from the bumper woofers, 8-10 s bursts
 *   air horn = the electronic truck-horn blast (two saw tones, ~345/430 Hz) the officer stabs at
 *              intersections; the siren tone dips while it sounds
 * The sweep is done in cents (detune) so it is exponential like the real oscillator circuit; the LFO
 * is an asymmetric triangle (55 % rise) built as a PeriodicWave, which is how the real ramp generator
 * behaves and what gives the wail its "wind-up then drop" shape.
 */
import { type AC, stopSources, clamp, filter, gain, osc, softClip, slew, rampTo, rnd, holdRelease, disconnectOnEnded } from './synth';

export type SirenMode = 'wail' | 'yelp' | 'priority' | 'hilo';

const CENTER_HZ = Math.sqrt(700 * 1600); // 1058
const DEPTH_CENTS = 1200 * Math.log2(1600 / 700) / 2; // +-714
const PRIORITY_CENTER = Math.sqrt(900 * 1700); // narrower, higher band
const PRIORITY_DEPTH = 1200 * Math.log2(1700 / 900) / 2;
const RATE: Record<SirenMode, number> = { wail: 1 / 5.2, yelp: 3.3, priority: 6.2, hilo: 1.4 };

const waves = new WeakMap<AC, PeriodicWave>();
/** asymmetric triangle (rise fraction r) as a PeriodicWave for the sweep LFO */
function sweepWave(ac: AC, r = 0.55): PeriodicWave {
  let w = waves.get(ac);
  if (w) return w;
  const N = 256, H = 20;
  const g = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const t = n / N;
    g[n] = t < r ? -1 + (2 * t) / r : 1 - (2 * (t - r)) / (1 - r);
  }
  const real = new Float32Array(H + 1), imag = new Float32Array(H + 1);
  for (let k = 1; k <= H; k++) {
    let a = 0, b = 0;
    for (let n = 0; n < N; n++) {
      a += g[n] * Math.cos((2 * Math.PI * k * n) / N);
      b += g[n] * Math.sin((2 * Math.PI * k * n) / N);
    }
    real[k] = (2 / N) * a;
    imag[k] = (2 / N) * b;
  }
  w = ac.createPeriodicWave(real, imag); // normalized to a +-1 peak
  waves.set(ac, w);
  return w;
}

export class SirenVoice {
  private out: GainNode;
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private oscR: OscillatorNode;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;
  private rumbleGain: GainNode;
  private hiloLfo: OscillatorNode;
  private hiloGain: GainNode;
  private toneMix: GainNode;
  private hornIn: AudioNode;
  private alive = true;
  private horns = new Set<OscillatorNode>();
  private mode: SirenMode = 'wail';
  private nextMode = 0;
  private rumblerUntil = 0;
  private nextRumbler = 0;
  private hornUntil = 0;
  private hornPending = 0;
  private doppler = 0;
  private level: number;
  auto = true;
  /** current siren base frequency in Hz (for anyone wanting to visualize) */
  get frequency(): number {
    return CENTER_HZ;
  }

  constructor(private ac: AC, dest: AudioNode, opts: { level?: number; distant?: boolean; t0?: number } = {}) {
    const t0 = opts.t0 ?? ac.currentTime;
    this.out = gain(ac, 0, dest);
    this.level = clamp(opts.level ?? 0.6, 0, 4);
    // horn driver: a strong throat resonance around 1.25 kHz, a second one near 2.7 kHz, rolled off
    // above 5 kHz, gently saturated (the 100 W amp is always near clipping)
    const clip = softClip(ac, 1.7, filter(ac, 'highpass', 15, 0.707, 0, this.out));
    const hp = filter(ac, 'highpass', 360, 0.7, 0, clip);
    const peak = filter(ac, 'peaking', 1250, 1.2, 7, hp);
    const peak2 = filter(ac, 'peaking', 2700, 2.0, 4, peak);
    const lp = filter(ac, 'lowpass', opts.distant ? 2000 : 5000, 0.7, 0, peak2);
    this.hornIn = lp;
    const mix = this.toneMix = gain(ac, 0.5, lp);
    this.oscA = osc(ac, 'sawtooth', CENTER_HZ, mix, t0);
    const bGain = gain(ac, 0.25, mix);
    this.oscB = osc(ac, 'square', CENTER_HZ, bGain, t0);
    this.oscB.detune.value = 4; // slight detune -> the two-driver beating of a real PA300
    // rumbler: octave down, lowpassed, only during bursts
    this.rumbleGain = gain(ac, 0, this.out);
    const rlp = filter(ac, 'lowpass', 300, 1.0, 0, this.rumbleGain);
    this.oscR = osc(ac, 'sawtooth', CENTER_HZ / 2, rlp, t0);
    // sweep LFO in cents: asymmetric triangle
    this.lfo = ac.createOscillator();
    this.lfo.setPeriodicWave(sweepWave(ac));
    this.lfo.frequency.value = RATE.wail;
    this.lfo.start(t0);
    this.lfoGain = gain(ac, DEPTH_CENTS);
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.oscA.detune);
    this.lfoGain.connect(this.oscB.detune);
    this.lfoGain.connect(this.oscR.detune);
    // hi-lo: square LFO switching between two tones
    this.hiloLfo = osc(ac, 'square', RATE.hilo, null, t0);
    this.hiloGain = gain(ac, 0);
    this.hiloLfo.connect(this.hiloGain);
    this.hiloGain.connect(this.oscA.detune);
    this.hiloGain.connect(this.oscB.detune);
    this.hiloGain.connect(this.oscR.detune);
    this.out.gain.setValueAtTime(0, t0);
    this.out.gain.linearRampToValueAtTime(this.level, t0 + 0.15);
    this.nextMode = t0 + rnd(6, 12);
    this.nextRumbler = t0 + rnd(4, 20);
  }

  setMode(mode: SirenMode, now = this.ac.currentTime): void {
    if (!this.alive || !Number.isFinite(now) || !(mode in RATE)) return;
    now = Math.max(0, now);
    this.mode = mode;
    this.applyCenter(now);
    if (mode === 'hilo') {
      rampTo(this.lfoGain.gain, 0, now, 0.05);
      rampTo(this.hiloGain.gain, 350, now, 0.05);
      return;
    }
    rampTo(this.hiloGain.gain, 0, now, 0.05);
    rampTo(this.lfoGain.gain, mode === 'priority' ? PRIORITY_DEPTH : DEPTH_CENTS, now, 0.05);
    this.lfo.frequency.setTargetAtTime(RATE[mode] * (mode === 'wail' ? rnd(0.9, 1.12) : 1), now, 0.05);
    this.applyCenter(now);
  }

  private applyCenter(now: number): void {
    const center = this.mode === 'priority' ? PRIORITY_CENTER : CENTER_HZ;
    const f = center * Math.pow(2, this.doppler / 1200);
    slew(this.oscA.frequency, f, now, 0.05);
    slew(this.oscB.frequency, f, now, 0.05);
    slew(this.oscR.frequency, f / 2, now, 0.05);
  }

  setLevel(v: number, now = this.ac.currentTime, tau = 0.08): void {
    this.level = clamp(v, 0, 4);
    slew(this.out.gain, this.level, now, tau);
  }

  /** doppler etc. in cents (added on top of the sweep) */
  setDetune(c: number, now = this.ac.currentTime): void {
    // the sweep LFO writes to detune via connections, so doppler goes to frequency instead
    this.doppler = clamp(c, -2400, 2400);
    this.applyCenter(now);
  }

  /**
   * Air-horn blast: two saw tones a major third apart through the same horn, 20 ms attack, a pitch sag
   * as the button is released. The siren tone ducks underneath while it sounds.
   */
  airHorn(dur = 0.6, now = this.ac.currentTime): void {
    if (!this.alive || !Number.isFinite(now) || this.horns.size >= 4) return;
    now = Math.max(0, now);
    dur = clamp(dur, 0.15, 2.5);
    const ac = this.ac;
    const g = gain(ac, 0, this.hornIn);
    const end = now + dur + 0.12;
    const f1 = 345 * Math.pow(2, this.doppler / 1200), f2 = f1 * 1.247;
    const a = osc(ac, 'sawtooth', f1, gain(ac, 0.55, g), now, end);
    const b = osc(ac, 'sawtooth', f2, gain(ac, 0.45, g), now, end);
    for (const o of [a, b]) {
      o.frequency.setValueAtTime(o === a ? f1 * 0.96 : f2 * 0.96, now);
      o.frequency.exponentialRampToValueAtTime(o === a ? f1 : f2, now + 0.03);
      o.frequency.setValueAtTime(o === a ? f1 : f2, now + dur);
      o.frequency.exponentialRampToValueAtTime((o === a ? f1 : f2) * 0.93, now + dur + 0.08);
    }
    for (const o of [a, b]) {
      this.horns.add(o);
      o.addEventListener('ended', () => this.horns.delete(o), { once: true });
    }
    disconnectOnEnded(b, [g]);
    holdRelease(g.gain, now, dur + 0.09, 0.95, 0.02, 0.08);
    // duck the siren tone under the horn
    rampTo(this.toneMix.gain, 0.12, now, 0.02);
    this.toneMix.gain.setValueAtTime(0.12, now + dur);
    this.toneMix.gain.linearRampToValueAtTime(0.5, now + dur + 0.12);
    this.hornUntil = Math.max(this.hornUntil, end);
  }

  /** call ~10 Hz: cycles modes like an officer toggling the controller, blasts the horn at intersections */
  update(now = this.ac.currentTime): void {
    if (!this.alive || !this.auto) return;
    if (now >= this.nextMode) {
      const r = Math.random();
      let m: SirenMode;
      if (this.mode === 'wail') m = r < 0.7 ? 'yelp' : r < 0.85 ? 'priority' : 'hilo';
      else if (this.mode === 'yelp' && r < 0.25) m = 'priority';
      else m = 'wail';
      this.setMode(m, now);
      this.nextMode = now + (m === 'wail' ? rnd(7, 14) : m === 'yelp' ? rnd(2.5, 5) : m === 'priority' ? rnd(2, 4) : rnd(1.5, 3));
      // approaching an intersection: sometimes a stab or two on the air horn
      if (m !== 'wail' && Math.random() < 0.45) this.hornPending = now + rnd(0.3, 1.5);
    }
    if (this.hornPending && now >= this.hornPending && now >= this.hornUntil) {
      this.hornPending = 0;
      const d = rnd(0.35, 0.8);
      this.airHorn(d, now);
      if (Math.random() < 0.5) this.airHorn(rnd(0.3, 0.7), now + d + rnd(0.2, 0.35));
    }
    if (now >= this.nextRumbler && this.rumblerUntil < now) {
      this.rumblerUntil = now + rnd(8, 10);
      rampTo(this.rumbleGain.gain, 0.4, now, 0.3);
      this.nextRumbler = now + rnd(20, 45);
    } else if (this.rumblerUntil && now >= this.rumblerUntil) {
      this.rumblerUntil = 0;
      rampTo(this.rumbleGain.gain, 0, now, 0.4);
    }
  }

  stop(fade = 0.25, now = this.ac.currentTime, nodes: AudioNode[] = []): void {
    if (!this.alive) return;
    this.alive = false;
    stopSources([this.oscA, this.oscB, this.oscR, this.lfo, this.hiloLfo, ...this.horns], this.out, fade, now, nodes);
  }

  get isAlive(): boolean {
    return this.alive;
  }
}
