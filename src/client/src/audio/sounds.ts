/**
 * One-shot sound recipes. Each recipe writes a node graph into a context starting at t0 and returns
 * the end time. At startup the Bank pre-renders every recipe (several variants) into mono AudioBuffers
 * with an OfflineAudioContext, so triggering a sound at runtime is one pooled BufferSource.
 * The same recipes render to WAV for verification (see window.__audio.render).
 */
import type { GameContext } from '@/core/context';
import { scheduleInit } from '../combat/init';
import { type AC, burst, tone, gain, filter, osc, noiseSrc, softClip, attackDecay, sweep, rnd, pick, at, holdRelease, blast } from './synth';

export type Recipe = (ac: AC, dest: AudioNode, t0: number, v: number) => number;

export interface SoundDef {
  name: string;
  seconds: number;
  variants: number;
  recipe: Recipe;
}

// ------------------------------------------------------------------------------------------------
// Guns (dry; the street reverb tails are shared convolvers at playback time)
//
// What a report looks like at a microphone a few metres away: a sub-millisecond pressure spike
// (Friedlander N-wave), its ground reflection ~2 ms later with flipped polarity (the comb that makes
// recordings sound "recorded"), a broadband crack that is gone in 5 ms, then the "body": the blast
// energy through the air, whose spectrum collapses from several kHz to a few hundred Hz within tens of
// ms. Everything after ~100 ms is the street, not the gun. Per weapon: the 5.56 rifle has the sharpest
// crack and the longest body, the 12 ga the deepest and slowest, the 9 mm pistol/SMG are short and
// mid-heavy. Mechanical action noises are broadband clicks (low Q), not pings.
// ------------------------------------------------------------------------------------------------
function gunBus(ac: AC, dest: AudioNode, drive: number): AudioNode {
  // the "recorded" quality of gunshots comes from the mic/preamp clipping: saturate the sum, trim to -2 dBFS
  const trim = gain(ac, 0.8, dest);
  const clip = softClip(ac, drive, trim);
  return clip;
}

interface ReportSpec {
  T: number; amp: number; groundMs: number;
  crackHz: number; crackPeak: number; crackTau: number;
  bodyFrom: number; bodyTo: number; bodyPeak: number; bodyTau: number; bodyDur: number;
  midHz: number; midPeak: number; midTau: number;
  thumpHz: number; thumpTo: number; thumpPeak: number; thumpTau: number; thumpDur: number;
}
function report(ac: AC, bus: AudioNode, t0: number, v: number, r: ReportSpec): void {
  blast(ac, bus, t0, { T: r.T, amp: r.amp }); // muzzle blast pressure spike
  blast(ac, bus, at(t0, r.groundMs + v * 0.15), { T: r.T * 1.2, amp: -r.amp * 0.55, hp: 120 }); // ground reflection, inverted
  burst(ac, bus, t0, { type: 'highpass', freq: r.crackHz, peak: r.crackPeak, attack: 0.0004, tau: r.crackTau, dur: r.crackTau * 7 }); // crack
  burst(ac, bus, t0, { type: 'lowpass', freq: r.bodyFrom, freqTo: r.bodyTo, q: 0.9, peak: r.bodyPeak, attack: 0.0008, tau: r.bodyTau, dur: r.bodyDur }); // blast body, spectrum collapsing
  burst(ac, bus, t0, { type: 'bandpass', freq: r.midHz + v * 60, q: 0.9, peak: r.midPeak, attack: 0.0008, tau: r.midTau, dur: r.midTau * 6 }); // mid bark
  tone(ac, bus, t0, { type: 'sine', freq: r.thumpHz + v * 8, freqTo: r.thumpTo, peak: r.thumpPeak, attack: 0.0015, tau: r.thumpTau, dur: r.thumpDur }); // chest thump
}

const pistol: Recipe = (ac, dest, t0, v) => {
  const bus = gunBus(ac, dest, 2.4);
  report(ac, bus, t0, v, { T: 0.0006, amp: 1.5, groundMs: 1.6, crackHz: 2500, crackPeak: 0.7, crackTau: 0.0035, bodyFrom: 5000, bodyTo: 380, bodyPeak: 1.0, bodyTau: 0.02, bodyDur: 0.12, midHz: 1500, midPeak: 0.4, midTau: 0.008, thumpHz: 160, thumpTo: 52, thumpPeak: 0.42, thumpTau: 0.022, thumpDur: 0.1 });
  // slide cycling: two broadband mechanical clicks, then the ejected case landing
  burst(ac, bus, at(t0, 38), { type: 'bandpass', freq: 2800, q: 1.2, peak: 0.14, tau: 0.003, dur: 0.015 });
  burst(ac, bus, at(t0, 96), { type: 'bandpass', freq: 2100, q: 1.1, peak: 0.11, tau: 0.004, dur: 0.02 });
  burst(ac, bus, at(t0, 250 + v * 35), { type: 'bandpass', freq: 5200 + v * 300, q: 9, peak: 0.05, tau: 0.015, dur: 0.06 });
  return t0 + 0.34 + v * 0.035;
};

const smg: Recipe = (ac, dest, t0, v) => {
  const bus = gunBus(ac, dest, 2.6);
  report(ac, bus, t0, v, { T: 0.0005, amp: 1.4, groundMs: 1.4, crackHz: 3000, crackPeak: 0.65, crackTau: 0.003, bodyFrom: 4500, bodyTo: 420, bodyPeak: 0.9, bodyTau: 0.013, bodyDur: 0.09, midHz: 1800, midPeak: 0.35, midTau: 0.006, thumpHz: 150, thumpTo: 55, thumpPeak: 0.32, thumpTau: 0.016, thumpDur: 0.08 });
  burst(ac, bus, at(t0, 22), { type: 'bandpass', freq: 2600, q: 1.2, peak: 0.1, tau: 0.003, dur: 0.015 }); // bolt
  return t0 + 0.2;
};

const rifle: Recipe = (ac, dest, t0, v) => {
  const bus = gunBus(ac, dest, 2.8);
  report(ac, bus, t0, v, { T: 0.001, amp: 1.8, groundMs: 1.9, crackHz: 2000, crackPeak: 0.8, crackTau: 0.006, bodyFrom: 6000, bodyTo: 260, bodyPeak: 1.2, bodyTau: 0.035, bodyDur: 0.22, midHz: 900, midPeak: 0.5, midTau: 0.02, thumpHz: 120, thumpTo: 40, thumpPeak: 0.6, thumpTau: 0.045, thumpDur: 0.22 });
  burst(ac, bus, at(t0, 55), { type: 'bandpass', freq: 2400, q: 1.5, peak: 0.16, tau: 0.004, dur: 0.02 }); // bolt carrier back
  burst(ac, bus, at(t0, 78), { type: 'bandpass', freq: 1900, q: 1.3, peak: 0.1, tau: 0.005, dur: 0.025 }); // forward
  return t0 + 0.42;
};

const shotgun: Recipe = (ac, dest, t0, v) => {
  const bus = gunBus(ac, dest, 3.0);
  report(ac, bus, t0, v, { T: 0.0016, amp: 2.0, groundMs: 2.2, crackHz: 1200, crackPeak: 0.6, crackTau: 0.01, bodyFrom: 3500, bodyTo: 180, bodyPeak: 1.4, bodyTau: 0.06, bodyDur: 0.32, midHz: 600, midPeak: 0.6, midTau: 0.03, thumpHz: 95, thumpTo: 32, thumpPeak: 0.8, thumpTau: 0.08, thumpDur: 0.36 });
  // wad/shot rattle: a handful of tiny broadband clicks after the blast
  for (let i = 0; i < 6; i++) {
    burst(ac, bus, at(t0, 70 + i * 22 + rnd(-6, 6)), { type: 'bandpass', freq: 1500 + rnd(-400, 600), q: 1.5, peak: 0.08 * (1 - i / 8), tau: 0.005, dur: 0.025 });
  }
  // pump action (recipe is 0.86 s between shots at 70 rpm)
  burst(ac, bus, at(t0, 380), { type: 'bandpass', freq: 1800, q: 1.4, peak: 0.24, tau: 0.008, dur: 0.04 });
  tone(ac, bus, at(t0, 380), { type: 'sine', freq: 260, freqTo: 120, peak: 0.14, tau: 0.02, dur: 0.06 });
  burst(ac, bus, at(t0, 560), { type: 'bandpass', freq: 2100, q: 1.4, peak: 0.26, tau: 0.007, dur: 0.04 });
  tone(ac, bus, at(t0, 560), { type: 'sine', freq: 300, freqTo: 140, peak: 0.16, tau: 0.02, dur: 0.06 });
  return t0 + 0.65;
};

// ------------------------------------------------------------------------------------------------
// Bullet impacts, whizz, foley
// ------------------------------------------------------------------------------------------------
const impConcrete: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'highpass', freq: 2200, peak: 0.9, tau: 0.004, dur: 0.03 }); // tick
  burst(ac, dest, t0, { type: 'bandpass', freq: 900 + v * 150, q: 1.5, peak: 0.5, tau: 0.012, dur: 0.07 }); // chip
  for (let i = 0; i < 4; i++) burst(ac, dest, at(t0, 25 + i * 18 + rnd(0, 10)), { type: 'bandpass', freq: 3000 + rnd(-800, 1500), q: 4, peak: 0.12, tau: 0.003, dur: 0.02 }); // debris
  return t0 + 0.14;
};
const impMetal: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'highpass', freq: 1500, peak: 0.8, tau: 0.004, dur: 0.03 });
  const f = 2300 + v * 500;
  burst(ac, dest, t0, { type: 'bandpass', freq: f, q: 38, peak: 0.9, tau: 0.09, dur: 0.35 }); // ring
  burst(ac, dest, t0, { type: 'bandpass', freq: f * 1.53, q: 30, peak: 0.4, tau: 0.06, dur: 0.25 });
  tone(ac, dest, t0, { type: 'sine', freq: 320, freqTo: 250, peak: 0.25, tau: 0.03, dur: 0.1 }); // clang body
  return t0 + 0.36;
};
const impBody: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'lowpass', freq: 700 + v * 100, peak: 0.9, attack: 0.002, tau: 0.02, dur: 0.09 });
  tone(ac, dest, t0, { type: 'sine', freq: 95, freqTo: 50, peak: 0.6, tau: 0.035, dur: 0.12 });
  return t0 + 0.14;
};
const whizz: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'highpass', freq: 2500, peak: 0.9, attack: 0.0005, tau: 0.003, dur: 0.02 }); // the crack
  burst(ac, dest, at(t0, 4), { type: 'bandpass', freq: 4200 + v * 300, freqTo: 1300, q: 6, peak: 0.6, attack: 0.004, tau: 0.05, dur: 0.17 }); // whistle down
  return t0 + 0.2;
};
const click: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'highpass', freq: 3000, peak: 0.7, tau: 0.003, dur: 0.02 });
  burst(ac, dest, t0, { type: 'bandpass', freq: 1500 + v * 200, q: 18, peak: 0.35, tau: 0.02, dur: 0.07 });
  return t0 + 0.08;
};
const clack: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'highpass', freq: 1800, peak: 0.6, tau: 0.004, dur: 0.03 });
  burst(ac, dest, t0, { type: 'bandpass', freq: 700 + v * 80, q: 6, peak: 0.5, tau: 0.02, dur: 0.08 });
  tone(ac, dest, t0, { type: 'sine', freq: 240, freqTo: 140, peak: 0.3, tau: 0.02, dur: 0.07 });
  return t0 + 0.1;
};
const emptyClick: Recipe = (ac, dest, t0) => {
  burst(ac, dest, t0, { type: 'highpass', freq: 3500, peak: 0.5, tau: 0.002, dur: 0.015 });
  burst(ac, dest, t0, { type: 'bandpass', freq: 2100, q: 25, peak: 0.25, tau: 0.015, dur: 0.05 });
  return t0 + 0.06;
};
const weaponSwitch: Recipe = (ac, dest, t0) => {
  burst(ac, dest, t0, { type: 'bandpass', freq: 1200, q: 4, peak: 0.4, tau: 0.02, dur: 0.06 }); // holster rustle
  burst(ac, dest, at(t0, 70), { type: 'highpass', freq: 2500, peak: 0.5, tau: 0.004, dur: 0.03 }); // snap
  burst(ac, dest, at(t0, 120), { type: 'bandpass', freq: 1700, q: 14, peak: 0.3, tau: 0.02, dur: 0.06 });
  return t0 + 0.2;
};

// ------------------------------------------------------------------------------------------------
// Footsteps: heel strike (a 2-5 ms broadband tick plus a short low thud), then the ball of the foot
// 65-95 ms later (softer, slower attack, a little sole scuff). Concrete is bright and hard, asphalt
// duller and gritty, grass a soft compressive "shh" made of many micro-crunches.
// ------------------------------------------------------------------------------------------------
const stepConcrete: Recipe = (ac, dest, t0, v) => {
  const toe = at(t0, 68 + v * 7 + rnd(0, 12));
  burst(ac, dest, t0, { type: 'bandpass', freq: 3200 + v * 300, q: 1.6, peak: 0.7, attack: 0.0005, tau: 0.003, dur: 0.02 }); // heel tick
  burst(ac, dest, t0, { type: 'lowpass', freq: 420, peak: 0.5, attack: 0.001, tau: 0.008, dur: 0.045, type2: 'highpass', freq2: 90 }); // heel thud
  tone(ac, dest, t0, { type: 'sine', freq: 150, freqTo: 95, peak: 0.1, tau: 0.01, dur: 0.035 });
  burst(ac, dest, toe, { type: 'highpass', freq: 2500, peak: 0.2, attack: 0.001, tau: 0.003, dur: 0.015 }); // toe tick
  burst(ac, dest, toe, { type: 'bandpass', freq: 1800 + v * 100, q: 0.9, peak: 0.4, attack: 0.006, tau: 0.018, dur: 0.07 }); // ball of foot
  burst(ac, dest, toe, { kind: 'pink', type: 'lowpass', freq: 2600, freqTo: 900, peak: 0.12, attack: 0.02, tau: 0.03, dur: 0.09 }); // sole scuff
  return t0 + 0.19;
};
const stepAsphalt: Recipe = (ac, dest, t0, v) => {
  const toe = at(t0, 75 + v * 6 + rnd(0, 12));
  burst(ac, dest, t0, { type: 'bandpass', freq: 1400 + v * 120, q: 1.0, peak: 0.6, attack: 0.0008, tau: 0.006, dur: 0.04 }); // heel (duller)
  burst(ac, dest, t0, { type: 'lowpass', freq: 320, peak: 0.45, attack: 0.001, tau: 0.01, dur: 0.05, type2: 'highpass', freq2: 80 });
  for (let i = 0; i < 3; i++) burst(ac, dest, at(t0, 8 + i * 9 + rnd(0, 6)), { type: 'bandpass', freq: 3500 + rnd(0, 1800), q: 3, peak: 0.1, tau: 0.003, dur: 0.015 }); // grit
  burst(ac, dest, toe, { type: 'bandpass', freq: 1100 + v * 80, q: 0.8, peak: 0.35, attack: 0.006, tau: 0.02, dur: 0.07 });
  burst(ac, dest, toe, { kind: 'pink', type: 'lowpass', freq: 1800, freqTo: 700, peak: 0.1, attack: 0.02, tau: 0.03, dur: 0.09 });
  return t0 + 0.19;
};
const stepGrass: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { kind: 'pink', type: 'lowpass', freq: 1200, peak: 0.5, attack: 0.006, tau: 0.035, dur: 0.12 }); // soft body
  for (let i = 0; i < 10; i++) burst(ac, dest, at(t0, 4 + i * 9 + rnd(0, 7) + v * 2), { type: 'bandpass', freq: 3000 + rnd(-600, 3500), q: 2.5, peak: 0.11 * (1 - i / 14), tau: 0.0035, dur: 0.018 }); // crunch grains
  burst(ac, dest, at(t0, 85 + v * 6), { kind: 'pink', type: 'lowpass', freq: 900, peak: 0.25, attack: 0.01, tau: 0.03, dur: 0.09 }); // toe
  return t0 + 0.19;
};
const stepMetal: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'highpass', freq: 1200, peak: 0.7, tau: 0.006, dur: 0.04 });
  burst(ac, dest, t0, { type: 'bandpass', freq: 1050 + v * 90, q: 28, peak: 0.6, tau: 0.09, dur: 0.3 }); // ring
  burst(ac, dest, t0, { type: 'bandpass', freq: 2700 + v * 200, q: 24, peak: 0.35, tau: 0.06, dur: 0.22 });
  tone(ac, dest, t0, { type: 'triangle', freq: 300, freqTo: 240, peak: 0.28, tau: 0.04, dur: 0.12, lp: 900 }); // clang body
  return t0 + 0.32;
};
const stepWater: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'lowpass', freq: 4500, freqTo: 800, peak: 0.8, attack: 0.004, tau: 0.05, dur: 0.18 }); // splash
  for (let i = 0; i < 6; i++) burst(ac, dest, at(t0, 30 + i * 25 + rnd(0, 15)), { type: 'bandpass', freq: 1200 + rnd(0, 2500) + v * 100, q: 10, peak: 0.16, tau: 0.01, dur: 0.05 }); // droplets
  return t0 + 0.28;
};
const landing: Recipe = (ac, dest, t0, v) => {
  tone(ac, dest, t0, { type: 'sine', freq: 85 + v * 8, freqTo: 40, peak: 0.9, attack: 0.002, tau: 0.05, dur: 0.18 });
  burst(ac, dest, t0, { type: 'lowpass', freq: 600, peak: 0.6, attack: 0.002, tau: 0.03, dur: 0.12 });
  burst(ac, dest, at(t0, 20), { type: 'bandpass', freq: 1800, q: 1.2, peak: 0.3, tau: 0.02, dur: 0.08 }); // shoe scuff
  return t0 + 0.2;
};
const deathThud: Recipe = (ac, dest, t0) => {
  tone(ac, dest, t0, { type: 'sine', freq: 110, freqTo: 32, peak: 1.0, attack: 0.003, tau: 0.09, dur: 0.35 });
  burst(ac, dest, t0, { type: 'lowpass', freq: 500, peak: 0.7, attack: 0.003, tau: 0.05, dur: 0.2 });
  burst(ac, dest, at(t0, 40), { type: 'bandpass', freq: 2600, q: 0.8, peak: 0.25, attack: 0.01, tau: 0.06, dur: 0.25 }); // clothing
  tone(ac, dest, at(t0, 180), { type: 'sine', freq: 80, freqTo: 35, peak: 0.45, tau: 0.05, dur: 0.2 }); // second contact (limbs)
  return t0 + 0.45;
};
const breath: Recipe = (ac, dest, t0, v) => {
  // a sharp exhale: noise through two vocal-tract-ish resonances
  burst(ac, dest, t0, { kind: 'pink', type: 'bandpass', freq: 650 + v * 60, q: 2.5, peak: 0.7, attack: 0.012, tau: 0.07, dur: 0.24 });
  burst(ac, dest, t0, { kind: 'pink', type: 'bandpass', freq: 1400 + v * 100, q: 3, peak: 0.35, attack: 0.01, tau: 0.05, dur: 0.2 });
  return t0 + 0.26;
};
const heartbeat: Recipe = (ac, dest, t0) => {
  tone(ac, dest, t0, { type: 'sine', freq: 62, freqTo: 40, peak: 1.0, attack: 0.01, tau: 0.06, dur: 0.18 }); // lub
  tone(ac, dest, at(t0, 190), { type: 'sine', freq: 55, freqTo: 38, peak: 0.7, attack: 0.01, tau: 0.05, dur: 0.16 }); // dub
  return t0 + 0.4;
};
const rustle: Recipe = (ac, dest, t0) => {
  // 1 s loop of clothing rustle at a sprint cadence (~3 steps/s)
  for (let i = 0; i < 3; i++) burst(ac, dest, at(t0, i * 333), { kind: 'pink', type: 'bandpass', freq: 3200 + rnd(-500, 500), q: 0.9, peak: 0.5, attack: 0.05, tau: 0.09, dur: 0.3 });
  return t0 + 1.0;
};

// ------------------------------------------------------------------------------------------------
// Vehicles: crashes, doors, air brake, horns are live (see traffic.ts)
// ------------------------------------------------------------------------------------------------
const crunch: Recipe = (ac, dest, t0, v) => {
  const bus = softClip(ac, 2.2, dest);
  tone(ac, bus, t0, { type: 'sine', freq: 90, freqTo: 30, peak: 1.0, attack: 0.002, tau: 0.09, dur: 0.35 }); // thump
  burst(ac, bus, t0, { kind: 'white', type: 'lowpass', freq: 900 + v * 100, peak: 1.0, attack: 0.002, tau: 0.06, dur: 0.3 }); // body
  burst(ac, bus, t0, { type: 'bandpass', freq: 2500, q: 1, peak: 0.5, attack: 0.001, tau: 0.02, dur: 0.1 }); // glass/plastic snap
  for (let i = 0; i < 9; i++) burst(ac, bus, at(t0, 30 + i * 28 + rnd(0, 20)), { type: 'bandpass', freq: 1200 + rnd(0, 2800), q: 6, peak: 0.28 * (1 - i / 12), tau: 0.008, dur: 0.04 }); // panel rattle
  tone(ac, bus, at(t0, 120), { type: 'sine', freq: 70, freqTo: 35, peak: 0.4, tau: 0.08, dur: 0.3 });
  return t0 + 0.55;
};
const doorOpen: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'bandpass', freq: 2200 + v * 200, q: 6, peak: 0.5, tau: 0.01, dur: 0.05 }); // latch
  burst(ac, dest, at(t0, 25), { type: 'bandpass', freq: 600, q: 3, peak: 0.35, tau: 0.03, dur: 0.12 });
  tone(ac, dest, at(t0, 25), { type: 'sine', freq: 150, freqTo: 90, peak: 0.25, tau: 0.03, dur: 0.1 });
  return t0 + 0.2;
};
const doorClose: Recipe = (ac, dest, t0, v) => {
  tone(ac, dest, t0, { type: 'sine', freq: 120 + v * 10, freqTo: 55, peak: 0.9, attack: 0.002, tau: 0.05, dur: 0.22 }); // thunk
  burst(ac, dest, t0, { type: 'lowpass', freq: 700, peak: 0.7, attack: 0.002, tau: 0.03, dur: 0.15 });
  burst(ac, dest, at(t0, 12), { type: 'bandpass', freq: 2600, q: 5, peak: 0.35, tau: 0.008, dur: 0.05 }); // latch catch
  return t0 + 0.3;
};
const airBrake: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'highpass', freq: 2500 + v * 300, peak: 0.6, attack: 0.005, tau: 0.25, dur: 0.75 });
  burst(ac, dest, at(t0, 550), { type: 'bandpass', freq: 3200, q: 2, peak: 0.35, attack: 0.002, tau: 0.03, dur: 0.12 }); // final spit
  return t0 + 0.8;
};
const starter: Recipe = (ac, dest, t0) => {
  // starter motor whirr ~ 0.6 s then a catch
  const g = gain(ac, 0, dest);
  const lp = filter(ac, 'lowpass', 1500, 2, 0, g);
  const o = osc(ac, 'sawtooth', 38, lp, t0, t0 + 0.7);
  sweep(o.frequency, t0, 30, 46, 0.6);
  holdRelease(g.gain, t0, 0.68, 0.35, 0.05, 0.1);
  burst(ac, dest, t0, { type: 'bandpass', freq: 1800, q: 1.5, peak: 0.2, attack: 0.05, tau: 0.5, dur: 0.6 });
  return t0 + 0.75;
};

// ------------------------------------------------------------------------------------------------
// Ambience one-shots: birds, gulls, drips, jackhammer loop
// ------------------------------------------------------------------------------------------------
const chirp: Recipe = (ac, dest, t0, v) => {
  // house sparrow: 2-4 quick FM chirps
  const n = 2 + (v % 3);
  let t = t0;
  for (let i = 0; i < n; i++) {
    const f0 = 3200 + rnd(-300, 600) + v * 80;
    tone(ac, dest, t, { type: 'sine', freq: f0, freqTo: f0 * (i % 2 ? 0.72 : 1.35), peak: 0.5, attack: 0.008, tau: 0.03, dur: 0.07 });
    t += 0.075 + rnd(0, 0.05);
  }
  return t + 0.05;
};
const pigeon: Recipe = (ac, dest, t0, v) => {
  // coo: low tone with tremolo, three pulses
  for (let i = 0; i < 3; i++) {
    const tt = at(t0, i * 260 + (i === 2 ? 60 : 0));
    tone(ac, dest, tt, { type: 'triangle', freq: 330 + v * 15, freqTo: 290, peak: 0.45, attack: 0.03, tau: 0.09, dur: i === 2 ? 0.34 : 0.22, lp: 900 });
  }
  return t0 + 1.0;
};
const gull: Recipe = (ac, dest, t0, v) => {
  // herring gull long call: harsh descending "kyow"
  const g = gain(ac, 0, dest);
  const bp = filter(ac, 'bandpass', 1800, 2.5, 0, g);
  const o = osc(ac, 'sawtooth', 1200, bp, t0, t0 + 0.55);
  sweep(o.frequency, t0, 1500 + v * 80, 1000, 0.35);
  o.frequency.exponentialRampToValueAtTime(700, t0 + 0.5);
  attackDecay(g.gain, t0, 0.5, 0.5, 0.06, 0.18);
  tone(ac, dest, at(t0, 620), { type: 'sawtooth', freq: 1300, freqTo: 850, peak: 0.3, attack: 0.04, tau: 0.12, dur: 0.3, lp: 2500 });
  return t0 + 1.0;
};
const drip: Recipe = (ac, dest, t0, v) => {
  burst(ac, dest, t0, { type: 'bandpass', freq: 1800 + v * 700 + rnd(0, 900), q: 9, peak: 0.7, attack: 0.001, tau: 0.012, dur: 0.05 });
  return t0 + 0.06;
};
const jackhammer: Recipe = (ac, dest, t0) => {
  // one second loop at 11.5 Hz: each hit = broadband slap + concrete knock
  const rate = 11.5;
  for (let i = 0; i < rate; i++) {
    const tt = t0 + i / rate;
    burst(ac, dest, tt, { type: 'highpass', freq: 900, peak: 0.9, attack: 0.0006, tau: 0.007, dur: 0.04 });
    burst(ac, dest, tt, { type: 'bandpass', freq: 380, q: 2, peak: 0.6, attack: 0.001, tau: 0.02, dur: 0.06 });
  }
  // Twelve hits form a complete loop at 11.5 Hz; never cut the last concrete knock.
  burst(ac, dest, t0, { type: 'highpass', freq: 4000, peak: 0.12, attack: 0.02, tau: 3, dur: 12 / rate });
  return t0 + 12 / rate;
};

// ------------------------------------------------------------------------------------------------
// Night: a distant four-on-the-floor kick from a club / a car stereo a block over (looped, ~124 bpm)
// ------------------------------------------------------------------------------------------------
const BASS_BPM = 124;
const bassLoop: Recipe = (ac, dest, t0) => {
  const beat = 60 / BASS_BPM;
  const lp = filter(ac, 'lowpass', 160, 0.8, 0, dest);
  for (let i = 0; i < 4; i++) {
    const tt = t0 + i * beat;
    tone(ac, lp, tt, { type: 'sine', freq: 120, freqTo: 44, peak: 0.9, attack: 0.003, tau: 0.09, dur: 0.32 });
    burst(ac, lp, tt, { type: 'lowpass', freq: 300, peak: 0.4, attack: 0.001, tau: 0.012, dur: 0.05 });
    if (i % 2 === 1) burst(ac, lp, tt + beat / 2, { type: 'bandpass', freq: 140, q: 1.2, peak: 0.25, attack: 0.002, tau: 0.03, dur: 0.1 }); // bass note on the off-beat
  }
  return t0 + 4 * beat;
};

export const SOUND_DEFS: SoundDef[] = [
  { name: 'pistol', seconds: 0.4, variants: 3, recipe: pistol },
  { name: 'smg', seconds: 0.24, variants: 3, recipe: smg },
  { name: 'rifle', seconds: 0.48, variants: 3, recipe: rifle },
  { name: 'shotgun', seconds: 0.7, variants: 2, recipe: shotgun },
  { name: 'imp_concrete', seconds: 0.18, variants: 3, recipe: impConcrete },
  { name: 'imp_metal', seconds: 0.4, variants: 3, recipe: impMetal },
  { name: 'imp_body', seconds: 0.18, variants: 2, recipe: impBody },
  { name: 'whizz', seconds: 0.24, variants: 3, recipe: whizz },
  { name: 'click', seconds: 0.1, variants: 3, recipe: click },
  { name: 'clack', seconds: 0.12, variants: 3, recipe: clack },
  { name: 'empty', seconds: 0.08, variants: 1, recipe: emptyClick },
  { name: 'switch', seconds: 0.24, variants: 1, recipe: weaponSwitch },
  { name: 'step_concrete', seconds: 0.2, variants: 4, recipe: stepConcrete },
  { name: 'step_asphalt', seconds: 0.2, variants: 4, recipe: stepAsphalt },
  { name: 'step_grass', seconds: 0.2, variants: 4, recipe: stepGrass },
  { name: 'step_metal', seconds: 0.36, variants: 3, recipe: stepMetal },
  { name: 'step_water', seconds: 0.32, variants: 3, recipe: stepWater },
  { name: 'land', seconds: 0.24, variants: 2, recipe: landing },
  { name: 'death', seconds: 0.5, variants: 1, recipe: deathThud },
  { name: 'breath', seconds: 0.3, variants: 2, recipe: breath },
  { name: 'heartbeat', seconds: 0.45, variants: 1, recipe: heartbeat },
  { name: 'rustle', seconds: 1.0, variants: 1, recipe: rustle },
  { name: 'crunch', seconds: 0.6, variants: 3, recipe: crunch },
  { name: 'door_open', seconds: 0.24, variants: 2, recipe: doorOpen },
  { name: 'door_close', seconds: 0.34, variants: 2, recipe: doorClose },
  { name: 'airbrake', seconds: 0.85, variants: 2, recipe: airBrake },
  { name: 'starter', seconds: 0.8, variants: 1, recipe: starter },
  { name: 'chirp', seconds: 0.5, variants: 6, recipe: chirp },
  { name: 'pigeon', seconds: 1.05, variants: 2, recipe: pigeon },
  { name: 'gull', seconds: 1.05, variants: 3, recipe: gull },
  { name: 'drip', seconds: 0.07, variants: 4, recipe: drip },
  { name: 'jackhammer', seconds: 12 / 11.5, variants: 1, recipe: jackhammer },
  { name: 'bass_loop', seconds: (60 / BASS_BPM) * 4, variants: 1, recipe: bassLoop },
];

export function soundDef(name: string): SoundDef | undefined {
  return SOUND_DEFS.find((d) => d.name === name);
}

/** Renders every recipe variant into mono buffers, one OfflineAudioContext at a time (keeps the main thread free). */
export class Bank {
  private buffers = new Map<string, AudioBuffer[]>();
  ready = false;
  progress = 0;
  readonly done: Promise<void>;
  private abort = new AbortController();
  private releaseBusy: () => void;
  constructor(private sampleRate: number, defs: SoundDef[] = SOUND_DEFS, private ctx?: GameContext) {
    if (ctx) ctx.busy = (ctx.busy ?? 0) + 1;
    let released = false;
    this.releaseBusy = () => {
      if (released) return;
      released = true;
      if (ctx) ctx.busy = (ctx.busy ?? 1) - 1;
    };
    this.done = this.renderAll(defs).finally(this.releaseBusy);
  }

  private async renderAll(defs: SoundDef[]): Promise<void> {
    let n = 0;
    const total = defs.reduce((s, d) => s + d.variants, 0);
    for (const def of defs) {
      const list: AudioBuffer[] = [];
      for (let v = 0; v < def.variants; v++) {
        if (this.abort.signal.aborted) return;
        try {
          list.push(await renderRecipe(def.recipe, def.seconds, v, this.sampleRate, 1, this.ctx, this.abort.signal));
        } catch (err) {
          if (this.abort.signal.aborted) return;
          console.warn('[audio] bank render failed', def.name, err);
        }
        if (this.abort.signal.aborted) return;
        this.progress = ++n / total;
      }
      this.buffers.set(def.name, list);
    }
    this.ready = true;
  }

  dispose(): void {
    this.abort.abort();
    this.releaseBusy();
    this.buffers.clear();
  }

  get(name: string, variant?: number): AudioBuffer | null {
    const l = this.buffers.get(name);
    if (!l || l.length === 0) return null;
    return variant === undefined || !Number.isFinite(variant) ? pick(l) : l[((Math.trunc(variant) % l.length) + l.length) % l.length];
  }
  has(name: string): boolean {
    return (this.buffers.get(name)?.length ?? 0) > 0;
  }
}

export async function renderRecipe(recipe: Recipe, seconds: number, variant: number, sampleRate: number, channels = 1, ctx?: GameContext, signal?: AbortSignal): Promise<AudioBuffer> {
  const off = await scheduleInit(ctx, (function* () {
    const context = new OfflineAudioContext(channels, Math.ceil(seconds * sampleRate), sampleRate);
    yield;
    recipe(context, context.destination, 0.005, variant);
    return context;
  })(), signal);
  const buffer = await off.startRendering();
  // Bank buffers can be stopped or looped at this boundary. Taper only the last 2 ms,
  // including filter ring-out, so a variant cannot produce a hard edge at the crop.
  const edge = Math.max(2, Math.round(sampleRate * 0.002));
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const samples = buffer.getChannelData(ch);
    for (let i = 0; i < edge; i++) samples[samples.length - edge + i] *= 1 - i / (edge - 1);
  }
  return buffer;
}
