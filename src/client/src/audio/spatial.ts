/** PannerNode helpers for positioned continuous voices. */
import type { AC } from './synth';
import { slew, clamp, finite } from './synth';

export interface PannerOpts {
  hrtf?: boolean;
  ref?: number;
  rolloff?: number;
  max?: number;
  x?: number;
  y?: number;
  z?: number;
}

export function createPanner(ac: AC, dest: AudioNode, o: PannerOpts = {}): PannerNode {
  const p = ac.createPanner();
  p.panningModel = o.hrtf ? 'HRTF' : 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = clamp(o.ref ?? 4, 0.01, 1e6);
  p.rolloffFactor = clamp(o.rolloff ?? 1, 0, 10);
  p.maxDistance = clamp(o.max ?? 400, p.refDistance, 1e7);
  p.positionX.value = finite(o.x ?? 0, 0);
  p.positionY.value = finite(o.y ?? 1.5, 1.5);
  p.positionZ.value = finite(o.z ?? 0, 0);
  p.connect(dest);
  return p;
}

export function movePanner(p: PannerNode, x: number, y: number, z: number, now: number, tau = 0.05): void {
  slew(p.positionX, x, now, tau);
  slew(p.positionY, y, now, tau);
  slew(p.positionZ, z, now, tau);
}

/** doppler pitch ratio from closing speed (m/s, positive = approaching), clamped */
export function dopplerRatio(closing: number): number {
  const c = 343;
  const v = clamp(closing, -80, 80);
  return c / (c - v * 0.85); // 0.85: slightly understated, real doppler at 30 m/s is jarring in headphones
}
