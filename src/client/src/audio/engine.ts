/**
 * Procedural engine. The tonal core is two waveforms at the firing frequency cross-faded by load
 * (triangle = closed throttle, dull; sawtooth = open throttle, every harmonic) plus a half-order sub
 * (the V8 lump), all through a load-dependent lowpass. Around it the noise that a microphone actually
 * hears: exhaust pulses (brown noise band-passed at the 2nd and 4th orders, amplitude-modulated by the
 * firing pulses), intake roar under throttle (pink, ~400 Hz), valvetrain hiss rising with rpm, diesel
 * clatter, turbo whine. A slow noise on the pitch (+-18 cents at idle) is the idle lope; `shift()` lifts
 * the load for ~150 ms while the next gear engages.
 *   gas 4-cyl : idle 800, redline 6500 -> firing 26..216 Hz
 *   v8 (taxi/SUV/police): 900..6000, firing 30..200 Hz, more sub
 *   diesel (bus/truck): 6-cyl, 600..2400, heavy clatter, turbo whine
 */
import { type AC, stopSources, filter, gain, osc, noiseSrc, softClip, slew, clamp, lerp } from './synth';

export type EngineKind = 'gas' | 'v8' | 'diesel';

interface Spec {
  cyl: number;
  idle: number;
  max: number;
  sub: number;
  exhaustQ: number;
  clatter: number;
  lpBase: number;
  lpPerHz: number;
  lpThrottle: number;
  drive: number;
  jitter: number;
}
const SPECS: Record<EngineKind, Spec> = {
  gas: { cyl: 4, idle: 800, max: 6500, sub: 0.2, exhaustQ: 1.4, clatter: 0.05, lpBase: 220, lpPerHz: 6, lpThrottle: 2200, drive: 1.6, jitter: 14 },
  v8: { cyl: 8, idle: 850, max: 6000, sub: 0.45, exhaustQ: 1.0, clatter: 0.04, lpBase: 180, lpPerHz: 5, lpThrottle: 1900, drive: 2.0, jitter: 20 },
  diesel: { cyl: 6, idle: 620, max: 2400, sub: 0.35, exhaustQ: 1.2, clatter: 0.55, lpBase: 140, lpPerHz: 4.5, lpThrottle: 900, drive: 1.9, jitter: 10 },
};

export class EngineVoice {
  readonly out: GainNode;
  private oscA: OscillatorNode;
  private oscB: OscillatorNode;
  private oscT: OscillatorNode;
  private oscSub: OscillatorNode;
  private pulse: OscillatorNode;
  private mixA: GainNode;
  private mixT: GainNode;
  private lp: BiquadFilterNode;
  private exhBp: BiquadFilterNode;
  private exhBp2: BiquadFilterNode;
  private exhGain: GainNode;
  private exh2Gain: GainNode;
  private roarGain: GainNode;
  private mechGain: GainNode;
  private clatterGain: GainNode;
  private pre: GainNode;
  private dip: GainNode;
  private jitterGain: GainNode;
  private turbo: OscillatorNode | null = null;
  private turboGain: GainNode | null = null;
  private srcs: AudioScheduledSourceNode[] = [];
  private spec: Spec;
  private alive = true;
  rpm: number;
  throttle = 0;
  private doppler = 0;
  private level = 1;

  constructor(private ac: AC, dest: AudioNode, readonly kind: EngineKind, opts: { level?: number; t0?: number } = {}) {
    const spec = (this.spec = SPECS[kind]);
    const t0 = opts.t0 ?? ac.currentTime;
    this.rpm = spec.idle;
    this.level = clamp(opts.level ?? 1, 0, 4);
    this.out = gain(ac, 0, dest);
    const post = gain(ac, 0.5, this.out);
    const clip = softClip(ac, spec.drive, filter(ac, 'highpass', 15, 0.707, 0, post));
    this.dip = gain(ac, 1, clip);
    this.pre = gain(ac, 0.7, this.dip);

    const f = this.firingHz(spec.idle);
    // tonal core: triangle (closed throttle) and sawtooth (open) cross-faded by load, plus a half-order sub
    this.lp = filter(ac, 'lowpass', spec.lpBase + f * spec.lpPerHz, 1.1, 0, this.pre);
    const body = filter(ac, 'peaking', 95, 1.2, 3, this.lp); // exhaust drone resonance
    this.mixA = gain(ac, 0.12, body);
    const mixB = gain(ac, 0.8, this.mixA);
    this.mixT = gain(ac, 0.4, body);
    const mixS = gain(ac, spec.sub, body);
    this.oscA = osc(ac, 'sawtooth', f, this.mixA, t0);
    this.oscB = osc(ac, 'sawtooth', f, mixB, t0);
    this.oscB.detune.value = 7;
    this.oscT = osc(ac, 'triangle', f, this.mixT, t0);
    this.oscSub = osc(ac, 'sine', f / 2, mixS, t0);
    // idle lope / combustion irregularity: slow noise on the pitch of everything
    this.jitterGain = gain(ac, spec.jitter);
    const jitLp = filter(ac, 'lowpass', 6, 0.7, 0, this.jitterGain);
    this.srcs.push(noiseSrc(ac, jitLp, 'white', { t0, rate: 0.02 }));
    for (const o of [this.oscA, this.oscB, this.oscT, this.oscSub]) this.jitterGain.connect(o.detune);
    // firing pulses (AM source): square at f -> 0..1 modulation
    this.pulse = osc(ac, 'square', f, null, t0);
    this.jitterGain.connect(this.pulse.detune);
    const am = gain(ac, 0);
    const pulseDepth = gain(ac, 0.5, am.gain);
    this.pulse.connect(pulseDepth);
    const offset = ac.createConstantSource();
    offset.offset.value = 0.5;
    offset.connect(am.gain);
    offset.start(t0);
    this.srcs.push(offset);
    // exhaust noise: brown, band-passed at the 2nd order (and 4th under load), pulsed
    this.exhGain = gain(ac, 0.25, this.pre);
    am.connect(this.exhGain);
    this.exhBp = filter(ac, 'bandpass', f * 2, spec.exhaustQ, 0, am);
    this.srcs.push(noiseSrc(ac, this.exhBp, 'brown', { t0 }));
    this.exh2Gain = gain(ac, 0, this.pre);
    const am2 = gain(ac, 0, this.exh2Gain);
    this.pulse.connect(gain(ac, 0.5, am2.gain));
    offset.connect(am2.gain);
    this.exhBp2 = filter(ac, 'bandpass', f * 4, 2.0, 0, am2);
    this.srcs.push(noiseSrc(ac, this.exhBp2, 'pink', { t0 }));
    // intake roar under throttle
    this.roarGain = gain(ac, 0, this.pre);
    const roarBp = filter(ac, 'bandpass', 420, 0.7, 0, this.roarGain);
    this.srcs.push(noiseSrc(ac, roarBp, 'pink', { t0 }));
    // diesel clatter: white noise pulsed hard through a mid resonance
    this.clatterGain = gain(ac, spec.clatter, this.pre);
    const clBp = filter(ac, 'bandpass', 1150, 2.2, 0, this.clatterGain);
    const clAm = gain(ac, 0, clBp);
    this.pulse.connect(gain(ac, 0.5, clAm.gain));
    offset.connect(clAm.gain);
    this.srcs.push(noiseSrc(ac, clAm, 'white', { t0 }));
    // mechanical hiss (valvetrain, belts)
    this.mechGain = gain(ac, 0.02, this.pre);
    const mechBp = filter(ac, 'bandpass', 2600, 0.8, 0, this.mechGain);
    this.srcs.push(noiseSrc(ac, mechBp, 'white', { t0 }));
    if (kind === 'diesel') {
      this.turboGain = gain(ac, 0, this.pre);
      const tlp = filter(ac, 'bandpass', 3000, 3, 0, this.turboGain);
      this.turbo = osc(ac, 'sine', 800, tlp, t0);
    }
    this.srcs.push(this.oscA, this.oscB, this.oscT, this.oscSub, this.pulse);
    if (this.turbo) this.srcs.push(this.turbo);
    this.out.gain.setValueAtTime(0, t0);
    this.out.gain.linearRampToValueAtTime(this.level, t0 + 0.2);
  }

  firingHz(rpm: number): number {
    return (rpm / 60) * (this.spec.cyl / 2);
  }
  get idleRpm(): number {
    return this.spec.idle;
  }
  get maxRpm(): number {
    return this.spec.max;
  }

  /** set the engine state; smoothed inside. throttle 0..1. */
  set(rpm: number, throttle: number, now = this.ac.currentTime, tau = 0.045): void {
    if (!this.alive) return;
    const spec = this.spec;
    rpm = clamp(rpm, spec.idle * 0.7, spec.max * 1.05);
    throttle = clamp(throttle, 0, 1);
    this.rpm = rpm;
    this.throttle = throttle;
    const f = this.firingHz(rpm) * Math.pow(2, this.doppler / 1200);
    slew(this.oscA.frequency, f, now, tau);
    slew(this.oscB.frequency, f, now, tau);
    slew(this.oscT.frequency, f, now, tau);
    slew(this.oscSub.frequency, f / 2, now, tau);
    slew(this.pulse.frequency, f, now, tau);
    slew(this.exhBp.frequency, clamp(f * 2, 40, 1200), now, tau);
    slew(this.exhBp2.frequency, clamp(f * 4, 80, 2400), now, tau);
    const rpm01 = clamp((rpm - spec.idle) / (spec.max - spec.idle), 0, 1);
    // load timbre: open throttle brings in the sawtooth and opens the filter
    slew(this.mixA.gain, 0.1 + 0.45 * throttle, now, 0.08);
    slew(this.mixT.gain, 0.4 * (1 - 0.6 * throttle), now, 0.08);
    slew(this.lp.frequency, spec.lpBase + f * spec.lpPerHz + spec.lpThrottle * throttle, now, 0.08);
    slew(this.exhGain.gain, lerp(0.2, 0.7, throttle) * lerp(0.7, 1, rpm01), now, 0.08);
    slew(this.exh2Gain.gain, 0.35 * throttle * lerp(0.4, 1, rpm01), now, 0.08);
    slew(this.roarGain.gain, 0.3 * throttle * lerp(0.4, 1, rpm01), now, 0.08);
    slew(this.mechGain.gain, 0.015 + 0.06 * rpm01, now, 0.1);
    slew(this.jitterGain.gain, spec.jitter * lerp(1, 0.25, rpm01), now, 0.2);
    slew(this.pre.gain, 0.55 + 0.75 * throttle + 0.2 * rpm01, now, 0.08);
    slew(this.clatterGain.gain, spec.clatter * lerp(0.6, 1.2, throttle), now, 0.1);
    if (this.turbo && this.turboGain) {
      slew(this.turbo.frequency, 600 + 2600 * rpm01, now, 0.2);
      slew(this.turboGain.gain, 0.03 * rpm01 * (0.3 + throttle), now, 0.2);
    }
  }

  setDoppler(cents: number): void {
    this.doppler = clamp(cents, -400, 400);
  }

  setLevel(v: number, now = this.ac.currentTime, tau = 0.1): void {
    this.level = clamp(v, 0, 4);
    slew(this.out.gain, this.level, now, tau);
  }

  /** short blip: rev bump (throttle stab) */
  blip(now = this.ac.currentTime): void {
    if (!this.alive || !Number.isFinite(now)) return;
    now = Math.max(0, now);
    const g = this.exhGain.gain;
    g.cancelAndHoldAtTime(now);
    g.linearRampToValueAtTime(Math.min(1, g.value + 0.35), now + 0.03);
    g.setTargetAtTime(this.exhGain.gain.value, now + 0.05, 0.1);
  }

  /** gear change: the load comes off for ~150 ms (the pitch drop itself comes from the caller's rpm) */
  shift(now = this.ac.currentTime): void {
    if (!this.alive || !Number.isFinite(now)) return;
    now = Math.max(0, now);
    const g = this.dip.gain;
    g.cancelAndHoldAtTime(now);
    g.linearRampToValueAtTime(0.4, now + 0.04);
    g.setValueAtTime(0.4, now + 0.14);
    g.linearRampToValueAtTime(1, now + 0.36);
  }

  stop(fade = 0.3, now = this.ac.currentTime): void {
    if (!this.alive) return;
    this.alive = false;
    stopSources(this.srcs, this.out, fade, now);
  }

  get isAlive(): boolean {
    return this.alive;
  }
}

/** kind string from the vehicles module -> engine kind */
export function engineKindFor(vehicleKind: string): EngineKind {
  const k = vehicleKind.toLowerCase();
  if (/bus|truck|garbage|box|semi|delivery|ambulance|fire/.test(k)) return 'diesel';
  if (/taxi|police|nypd|suv|cab|van|pickup|crown|escalade|tahoe|explorer/.test(k)) return 'v8';
  return 'gas';
}
