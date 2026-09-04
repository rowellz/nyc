/**
 * Procedural animation clips for the rig in rig.ts. Every clip drives every bone (quaternion tracks) plus
 * the Hips position, so crossfades never leave a bone at a stale value.
 *
 * Conventions (bone local axes == model axes at bind, model faces -Z):
 *   legs/arms: +X swings the limb forward, knee flexion = -X on the shin, elbow flexion = +X on the forearm
 *   spine/head: -X leans forward, +Y turns left, +Z tilts left
 *   ankle: +X = toes up
 * Gait curves are keyed on the normalized cycle phase (left heel strike at 0, right at 0.5).
 */
import * as THREE from 'three';
import { BONES, BONE_INDEX, curve } from './rig';

const DEG = Math.PI / 180;
const NB = BONES.length;

export class Pose {
  rot = new Float32Array(NB * 3); // euler XYZ, radians
  hips = new Float32Array(3); // offset from bind, meters
  reset(): void {
    this.rot.fill(0);
    this.hips.fill(0);
  }
  add(bone: string, xDeg: number, yDeg = 0, zDeg = 0): void {
    const i = BONE_INDEX[bone] * 3;
    this.rot[i] += xDeg * DEG;
    this.rot[i + 1] += yDeg * DEG;
    this.rot[i + 2] += zDeg * DEG;
  }
}

export type Sampler = (t: number, p: Pose) => void;

export interface ClipDef {
  name: string;
  duration: number;
  loop: boolean;
  /** nominal forward speed (m/s) the cycle was designed for; 0 for stationary clips */
  speed: number;
  /** cycle phases at which the left / right heel strikes (for footsteps) */
  footfalls?: [number, number];
}

export interface GeneratedClip {
  clip: THREE.AnimationClip;
  def: ClipDef;
}

const FPS = 30;

export function makeClip(def: ClipDef, sampler: Sampler): GeneratedClip {
  const frames = Math.max(2, Math.round(def.duration * FPS) + 1);
  const times = new Float32Array(frames);
  const quat = new Float32Array(frames * NB * 4);
  const hipPos = new Float32Array(frames * 3);
  const p = new Pose();
  const e = new THREE.Euler(0, 0, 0, 'XYZ');
  const q = new THREE.Quaternion();
  const hipsBind = BONES[0].pos;
  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1); // 0..1 (loops sample t=1 == t=0)
    times[f] = t * def.duration;
    p.reset();
    sampler(def.loop ? t % 1 : t, p);
    for (let b = 0; b < NB; b++) {
      e.set(p.rot[b * 3], p.rot[b * 3 + 1], p.rot[b * 3 + 2]);
      q.setFromEuler(e);
      const o = (f * NB + b) * 4;
      quat[o] = q.x;
      quat[o + 1] = q.y;
      quat[o + 2] = q.z;
      quat[o + 3] = q.w;
    }
    hipPos[f * 3] = hipsBind[0] + p.hips[0];
    hipPos[f * 3 + 1] = hipsBind[1] + p.hips[1];
    hipPos[f * 3 + 2] = hipsBind[2] + p.hips[2];
  }
  const tracks: THREE.KeyframeTrack[] = [];
  for (let b = 0; b < NB; b++) {
    const vals = new Float32Array(frames * 4);
    for (let f = 0; f < frames; f++) {
      const o = (f * NB + b) * 4;
      vals[f * 4] = quat[o];
      vals[f * 4 + 1] = quat[o + 1];
      vals[f * 4 + 2] = quat[o + 2];
      vals[f * 4 + 3] = quat[o + 3];
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${BONES[b].name}.quaternion`, times, vals));
  }
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipPos));
  const clip = new THREE.AnimationClip(def.name, def.duration, tracks);
  return { clip, def };
}

// ------------------------------------------------------------------------------------------------
// gait model
// ------------------------------------------------------------------------------------------------

interface Gait {
  /** hip flexion curve (deg) over the phase */
  hip: [number, number][];
  knee: [number, number][];
  ankle: [number, number][];
  toe: [number, number][];
  bob: number; // vertical pelvis bob amplitude
  sway: number; // lateral
  pelvisYaw: number;
  pelvisTilt: number;
  spineYaw: number;
  lean: number; // forward lean of the spine (deg)
  armSwing: number;
  armOffset: number;
  elbowMin: number;
  elbowMax: number;
  armAbduct: number;
  headBob: number;
  drop: number; // constant pelvis drop
}

const WALK: Gait = {
  hip: [[0, 30], [0.08, 27], [0.3, 8], [0.5, -16], [0.58, -19], [0.7, -4], [0.85, 22], [1, 30]],
  knee: [[0, 5], [0.1, 17], [0.25, 9], [0.45, 8], [0.55, 26], [0.68, 60], [0.8, 50], [0.92, 14], [1, 5]],
  ankle: [[0, 5], [0.08, -2], [0.3, 4], [0.45, -3], [0.55, -17], [0.65, -9], [0.8, 4], [1, 5]],
  toe: [[0, 0], [0.42, 0], [0.52, 22], [0.6, 8], [0.7, 0], [1, 0]],
  bob: 0.019,
  sway: 0.018,
  pelvisYaw: 5,
  pelvisTilt: 4,
  spineYaw: 4.5,
  lean: 3,
  armSwing: 23,
  armOffset: -3,
  elbowMin: 12,
  elbowMax: 28,
  armAbduct: 6,
  headBob: 1.3,
  drop: 0.018,
};

const RUN: Gait = {
  hip: [[0, 42], [0.1, 32], [0.3, 4], [0.45, -22], [0.55, -26], [0.68, -6], [0.85, 34], [1, 42]],
  knee: [[0, 14], [0.12, 34], [0.3, 18], [0.45, 24], [0.55, 60], [0.68, 102], [0.8, 82], [0.92, 30], [1, 14]],
  ankle: [[0, 4], [0.1, -4], [0.3, 6], [0.42, -8], [0.52, -26], [0.62, -14], [0.8, 2], [1, 4]],
  toe: [[0, 0], [0.4, 0], [0.5, 26], [0.6, 6], [1, 0]],
  bob: 0.04,
  sway: 0.012,
  pelvisYaw: 7,
  pelvisTilt: 5,
  spineYaw: 6,
  lean: 12,
  armSwing: 40,
  armOffset: 8,
  elbowMin: 78,
  elbowMax: 108,
  armAbduct: 8,
  headBob: 1.4,
  drop: 0.03,
};

const SPRINT: Gait = {
  ...RUN,
  hip: [[0, 50], [0.1, 38], [0.3, 2], [0.45, -28], [0.55, -32], [0.68, -8], [0.85, 40], [1, 50]],
  knee: [[0, 18], [0.12, 40], [0.3, 20], [0.45, 30], [0.55, 70], [0.68, 118], [0.8, 92], [0.92, 34], [1, 18]],
  bob: 0.05,
  lean: 17,
  armSwing: 46,
  armOffset: 10,
  elbowMin: 80,
  elbowMax: 112,
  headBob: 2,
  drop: 0.045,
};

function gaitSampler(g: Gait, ampl = 1): Sampler {
  return (p, o) => {
    const two = Math.PI * 2;
    const c1 = Math.cos(two * p), s1 = Math.sin(two * p), c2 = Math.cos(two * 2 * p);
    // pelvis
    o.hips[1] = -g.drop - g.bob * c2 * ampl;
    o.hips[0] = -g.sway * s1;
    o.add('Hips', 0, -g.pelvisYaw * c1 * ampl, -g.pelvisTilt * s1 * ampl);
    // spine counter-rotation + lean
    o.add('Spine', -g.lean * 0.5, g.spineYaw * 0.4 * c1 * ampl, 1.2 * s1);
    o.add('Spine1', -g.lean * 0.3, g.spineYaw * 0.35 * c1 * ampl, 0.8 * s1);
    o.add('Spine2', -g.lean * 0.2 + g.headBob * 0.3 * c2, g.spineYaw * 0.35 * c1 * ampl, 0.5 * s1);
    o.add('Neck', g.lean * 0.35, -g.spineYaw * 0.5 * c1 * ampl, -1.0 * s1);
    o.add('Head', g.lean * 0.45 - g.headBob * c2, -g.spineYaw * 0.4 * c1 * ampl, -1.2 * s1);
    // legs
    for (const [side, ph] of [['Left', 0], ['Right', 0.5]] as const) {
      const ps = (p + ph) % 1;
      const hip = curve(g.hip, ps) * ampl;
      const knee = curve(g.knee, ps) * ampl;
      const ankle = curve(g.ankle, ps) * ampl;
      const toe = curve(g.toe, ps) * ampl;
      o.add(side + 'UpLeg', hip, 0, side === 'Left' ? -2 : 2);
      o.add(side + 'Leg', -knee, 0, 0);
      // keep the foot level relative to the ground: undo thigh+shin, then add the ankle curve
      o.add(side + 'Foot', -(hip - knee) + ankle, 0, 0);
      o.add(side + 'ToeBase', toe, 0, 0);
    }
    // arms (opposite phase to the same-side leg)
    for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
      const swing = sign * g.armSwing * c1 * ampl + g.armOffset;
      const fwd = 0.5 - 0.5 * sign * c1; // 1 when this arm is forward
      const elbow = g.elbowMin + (g.elbowMax - g.elbowMin) * fwd;
      const abd = sign * g.armAbduct; // left arm (-X): negative Z moves it away from the body
      o.add(side + 'Shoulder', 0, sign * 2 * c1, sign * -2);
      o.add(side + 'Arm', swing, sign * 6, abd);
      o.add(side + 'ForeArm', elbow, sign * -10, 0);
      o.add(side + 'Hand', 4, sign * -6, sign * 4);
    }
  };
}

// ------------------------------------------------------------------------------------------------
// stationary poses
// ------------------------------------------------------------------------------------------------

function restArms(o: Pose, k = 1): void {
  // relaxed arms hang a little back and out, elbows softly bent, palms turned toward the thighs
  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    o.add(side + 'Shoulder', 0, 0, sign * -2 * k);
    o.add(side + 'Arm', -5 * k, sign * 8 * k, sign * 7.5 * k);
    o.add(side + 'ForeArm', 15 * k, sign * -12 * k, sign * -2 * k);
    o.add(side + 'Hand', 8 * k, sign * -6 * k, sign * 5 * k);
  }
}

const idleSampler: Sampler = (t, o) => {
  const two = Math.PI * 2;
  const breath = Math.sin(two * 2 * t); // 2 breaths per 8 s
  const shift = Math.sin(two * t); // one weight shift per cycle
  const micro = Math.sin(two * 3 * t + 1.3);
  o.hips[0] = 0.017 * shift;
  o.hips[1] = -0.012 + 0.003 * breath;
  o.add('Hips', 0, 2.5 * shift, 1.6 * shift);
  o.add('Spine', -2, 0, -1.0 * shift);
  o.add('Spine1', -1 + 0.8 * breath, 0, -0.7 * shift);
  o.add('Spine2', -1.5 * breath, 1.8 * shift, -0.5 * shift);
  o.add('Neck', 1.5, 0, 0);
  o.add('Head', 1 + 1.2 * micro, 3 * Math.sin(two * t + 0.7), 0.6 * shift);
  // legs: relaxed, one leg takes weight
  o.add('LeftUpLeg', -2, 4, -3 - 1.3 * shift);
  o.add('RightUpLeg', -1, -6, 3 + 1.3 * shift);
  o.add('LeftLeg', -4, 0, 0);
  o.add('RightLeg', -3, 0, 0);
  o.add('LeftFoot', 6, 0, 0);
  o.add('RightFoot', 4, 0, 0);
  restArms(o);
  // breathing: the chest lifts and the shoulders rise a touch with it
  o.add('LeftArm', 1.5 * breath, 0, 0);
  o.add('RightArm', 1.5 * breath, 0, 0);
  o.add('LeftShoulder', 0, 0, 0.7 * breath);
  o.add('RightShoulder', 0, 0, -0.7 * breath);
};

function crouchBase(o: Pose): void {
  o.hips[1] = -0.42;
  o.hips[2] = 0.05;
  o.add('Hips', 0, 0, 0);
  o.add('Spine', -16, 0, 0);
  o.add('Spine1', -8, 0, 0);
  o.add('Spine2', -4, 0, 0);
  o.add('Neck', 12, 0, 0);
  o.add('Head', 12, 0, 0);
}

const crouchIdleSampler: Sampler = (t, o) => {
  const two = Math.PI * 2;
  const breath = Math.sin(two * 2 * t);
  crouchBase(o);
  o.add('Spine1', 0.8 * breath, 0, 0);
  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    o.add(side + 'UpLeg', 86, sign * -8, sign * -8);
    o.add(side + 'Leg', -106, 0, 0);
    o.add(side + 'Foot', 20, 0, sign * 6);
    o.add(side + 'Arm', 28, sign * 10, sign * 14);
    o.add(side + 'ForeArm', 42, sign * -20, 0);
    o.add(side + 'Hand', 8, 0, 0);
  }
};

const crouchWalkSampler: Sampler = (p, o) => {
  const two = Math.PI * 2;
  const c1 = Math.cos(two * p), s1 = Math.sin(two * p), c2 = Math.cos(two * 2 * p);
  crouchBase(o);
  o.hips[1] += -0.01 * c2;
  o.hips[0] = -0.01 * s1;
  o.add('Hips', 0, -3 * c1, -2 * s1);
  for (const [side, ph] of [['Left', 0], ['Right', 0.5]] as const) {
    const ps = (p + ph) % 1;
    const hip = 62 + curve([[0, 22], [0.3, 6], [0.55, -12], [0.7, 0], [0.85, 16], [1, 22]], ps);
    const knee = 78 + curve([[0, 8], [0.15, 14], [0.4, 6], [0.55, 26], [0.7, 48], [0.9, 16], [1, 8]], ps);
    const ankle = curve([[0, 4], [0.3, 2], [0.5, -8], [0.7, 0], [1, 4]], ps);
    o.add(side + 'UpLeg', hip, 0, side === 'Left' ? -5 : 5);
    o.add(side + 'Leg', -knee, 0, 0);
    o.add(side + 'Foot', -(hip - knee) + ankle, 0, 0);
  }
  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    o.add(side + 'Arm', 26 + sign * 10 * c1, sign * 10, sign * 14);
    o.add(side + 'ForeArm', 44, sign * -20, 0);
    o.add(side + 'Hand', 8, 0, 0);
  }
};

const jumpStartSampler: Sampler = (t, o) => {
  // 0.28 s: dip, then explode upward (the controller launches the capsule at t≈0.15)
  const dip = Math.sin(Math.min(1, t / 0.5) * Math.PI); // 0..1..0 over the first half
  const ext = THREE.MathUtils.smoothstep(t, 0.45, 1);
  o.hips[1] = -0.14 * dip + 0.02 * ext;
  o.add('Spine', -10 * dip - 4 * ext, 0, 0);
  o.add('Spine1', -6 * dip, 0, 0);
  o.add('Neck', 6 * dip, 0, 0);
  o.add('Head', 6 * dip + 4 * ext, 0, 0);
  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    o.add(side + 'UpLeg', 38 * dip + 22 * ext, 0, sign * -3);
    o.add(side + 'Leg', -(52 * dip + 32 * ext), 0, 0);
    o.add(side + 'Foot', 14 * dip - 18 * ext, 0, 0);
    o.add(side + 'Arm', -30 * dip + 40 * ext, sign * 6, sign * 10);
    o.add(side + 'ForeArm', 20 + 20 * ext, sign * -10, 0);
  }
};

const jumpLoopSampler: Sampler = (t, o) => {
  const two = Math.PI * 2;
  const s = Math.sin(two * t);
  o.hips[1] = 0.02;
  o.add('Spine', -6, 0, 0);
  o.add('Spine1', -3, 0, 0);
  o.add('Head', 4, 0, 0);
  o.add('LeftUpLeg', 34 + 2 * s, 0, 4);
  o.add('RightUpLeg', 10 - 2 * s, 0, -4);
  o.add('LeftLeg', -48, 0, 0);
  o.add('RightLeg', -30, 0, 0);
  o.add('LeftFoot', -6, 0, 0);
  o.add('RightFoot', -10, 0, 0);
  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    o.add(side + 'Arm', 22 + 3 * s, sign * 6, sign * -38);
    o.add(side + 'ForeArm', 36, sign * -20, 0);
    o.add(side + 'Hand', 6, 0, 0);
  }
};

const fallSampler: Sampler = (t, o) => {
  const two = Math.PI * 2;
  const s = Math.sin(two * t);
  o.hips[1] = 0.0;
  o.add('Spine', -12, 0, 0);
  o.add('Spine1', -6, 0, 0);
  o.add('Neck', 6, 0, 0);
  o.add('Head', 8, 0, 0);
  o.add('LeftUpLeg', 18 + 3 * s, 0, 6);
  o.add('RightUpLeg', 8 - 3 * s, 0, -6);
  o.add('LeftLeg', -26, 0, 0);
  o.add('RightLeg', -16, 0, 0);
  o.add('LeftFoot', -12, 0, 0);
  o.add('RightFoot', -14, 0, 0);
  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    o.add(side + 'Arm', 40 + 6 * s, sign * 10, sign * -62);
    o.add(side + 'ForeArm', 30, sign * -30, 0);
    o.add(side + 'Hand', -10, 0, 0);
  }
};

const landSampler: Sampler = (t, o) => {
  // 0.4 s: absorb (deep at t≈0.3) then recover to a neutral stance
  const k = Math.sin(Math.min(1, t) * Math.PI) * (t < 0.3 ? 1 : 1);
  const absorb = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
  const a = Math.max(0, absorb) * k;
  o.hips[1] = -0.2 * a;
  o.add('Spine', -16 * a, 0, 0);
  o.add('Spine1', -8 * a, 0, 0);
  o.add('Neck', 8 * a, 0, 0);
  o.add('Head', 10 * a, 0, 0);
  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    o.add(side + 'UpLeg', 48 * a, 0, sign * -4);
    o.add(side + 'Leg', -66 * a, 0, 0);
    o.add(side + 'Foot', 18 * a, 0, 0);
    o.add(side + 'Arm', 20 * a - 3, sign * 6, sign * 10 * a + sign * 6);
    o.add(side + 'ForeArm', 30 * a + 8, sign * -10, 0);
  }
};

const deathSampler: Sampler = (t, o) => {
  // 1.7 s: knees buckle, torso pitches forward, body lies face-down with a roll to the right
  const k1 = THREE.MathUtils.smoothstep(t, 0, 0.32);
  const k2 = THREE.MathUtils.smoothstep(t, 0.25, 0.75);
  const k3 = THREE.MathUtils.smoothstep(t, 0.6, 1);
  o.hips[1] = -0.36 * k1 - 0.5 * k2;
  o.hips[2] = -0.25 * k2;
  o.add('Hips', -30 * k1 - 48 * k2, 8 * k2, 12 * k2 + 6 * k3);
  o.add('Spine', -22 * k1 + 6 * k2, 4 * k2, 4 * k2);
  o.add('Spine1', -10 * k1 + 4 * k2, 4 * k2, 0);
  o.add('Spine2', -6 * k1, 6 * k2, 0);
  o.add('Neck', 8 * k1 - 4 * k2, 10 * k2, 0);
  o.add('Head', 14 * k1 - 10 * k3, 42 * k2, 10 * k3);
  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    const late = side === 'Left' ? k3 : k2;
    o.add(side + 'UpLeg', 70 * k1 - 62 * k2 + (side === 'Left' ? 10 : -4) * late, sign * 6 * k2, sign * (-6 + 10 * k2));
    o.add(side + 'Leg', -(96 * k1 - 76 * k2) - (side === 'Left' ? 24 : 6) * late, 0, 0);
    o.add(side + 'Foot', 16 * k1 - 30 * k2, 0, 0);
    o.add(side + 'Arm', 20 * k1 + (side === 'Right' ? 90 : 34) * k2, sign * 10 * k2, sign * (10 + 60 * k2));
    o.add(side + 'ForeArm', 30 * k1 + (side === 'Right' ? 60 : 20) * k2, sign * -30 * k2, 0);
    o.add(side + 'Hand', 10, 0, 0);
  }
};

const driveSampler: Sampler = (t, o) => {
  const two = Math.PI * 2;
  const breath = Math.sin(two * 2 * t);
  o.hips[1] = 0;
  o.add('Hips', -8, 0, 0);
  o.add('Spine', 2, 0, 0);
  o.add('Spine1', 1 + 0.6 * breath, 0, 0);
  o.add('Spine2', 2, 0, 0);
  o.add('Neck', 4, 0, 0);
  o.add('Head', 6, 2 * Math.sin(two * t), 0);
  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    o.add(side + 'UpLeg', 84, sign * -4, sign * -6);
    o.add(side + 'Leg', -72, 0, 0);
    o.add(side + 'Foot', -2, 0, 0);
    o.add(side + 'Arm', 52, sign * 4, sign * -6);
    o.add(side + 'ForeArm', 46, sign * -30, 0);
    o.add(side + 'Hand', -10, 0, sign * 20);
  }
};

/** Bistro chair: arms rest over the thighs, not on an invisible steering wheel.
 * The animator fits the legs to the actual seat/ground height at both crowd LODs. */
const sitSampler: Sampler = (t, o) => {
  const breath = Math.sin(t * Math.PI * 2);
  o.add('Spine1', -2 + 0.7 * breath);
  o.add('Head', 3, 3 * Math.sin(t * Math.PI * 2));
  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    o.add(side + 'UpLeg', 90);
    o.add(side + 'Leg', -90);
    o.add(side + 'Arm', 12, sign * 5, sign * -8);
    o.add(side + 'ForeArm', 65, sign * -12);
    o.add(side + 'Hand', 12, 0, sign * -6);
  }
};

// ------------------------------------------------------------------------------------------------

export const CLIP_DEFS = {
  idle: { name: 'idle', duration: 8, loop: true, speed: 0 },
  // nominal speeds = the stride the leg curves actually cover (0.73 m per step at full amplitude) / cycle time, so
  // the time scale keeps the feet planted instead of sliding
  walk: { name: 'walk', duration: 0.9, loop: true, speed: 1.62, footfalls: [0.02, 0.52] },
  /** slow walkers (phones, window shoppers): shorter stride at a lower cadence instead of a slowed-down walk */
  stroll: { name: 'stroll', duration: 0.98, loop: true, speed: 1.19, footfalls: [0.02, 0.52] },
  run: { name: 'run', duration: 0.68, loop: true, speed: 6, footfalls: [0.03, 0.53] },
  sprint: { name: 'sprint', duration: 0.62, loop: true, speed: 7.5, footfalls: [0.03, 0.53] },
  crouchIdle: { name: 'crouchIdle', duration: 6, loop: true, speed: 0 },
  crouchWalk: { name: 'crouchWalk', duration: 1.05, loop: true, speed: 1.3, footfalls: [0.02, 0.52] },
  jumpStart: { name: 'jumpStart', duration: 0.28, loop: false, speed: 0 },
  jumpLoop: { name: 'jumpLoop', duration: 1.2, loop: true, speed: 0 },
  fall: { name: 'fall', duration: 1.2, loop: true, speed: 0 },
  land: { name: 'land', duration: 0.42, loop: false, speed: 0 },
  death: { name: 'death', duration: 1.7, loop: false, speed: 0 },
  drive: { name: 'drive', duration: 6, loop: true, speed: 0 },
  sit: { name: 'sit', duration: 7, loop: true, speed: 0 },
} as const satisfies Record<string, ClipDef>;

export type ClipName = keyof typeof CLIP_DEFS;

export interface ClipSet {
  byName: Record<ClipName, GeneratedClip>;
  all: THREE.AnimationClip[];
}

let cached: ClipSet | null = null;

/** generate (once) every clip. ~2 ms total. */
export function getClips(): ClipSet {
  if (cached) return cached;
  const byName = {
    idle: makeClip(CLIP_DEFS.idle, idleSampler),
    walk: makeClip(CLIP_DEFS.walk, gaitSampler(WALK)),
    stroll: makeClip(CLIP_DEFS.stroll, gaitSampler(WALK, 0.8)),
    run: makeClip(CLIP_DEFS.run, gaitSampler(RUN)),
    sprint: makeClip(CLIP_DEFS.sprint, gaitSampler(SPRINT)),
    crouchIdle: makeClip(CLIP_DEFS.crouchIdle, crouchIdleSampler),
    crouchWalk: makeClip(CLIP_DEFS.crouchWalk, crouchWalkSampler),
    jumpStart: makeClip(CLIP_DEFS.jumpStart, jumpStartSampler),
    jumpLoop: makeClip(CLIP_DEFS.jumpLoop, jumpLoopSampler),
    fall: makeClip(CLIP_DEFS.fall, fallSampler),
    land: makeClip(CLIP_DEFS.land, landSampler),
    death: makeClip(CLIP_DEFS.death, deathSampler),
    drive: makeClip(CLIP_DEFS.drive, driveSampler),
    sit: makeClip(CLIP_DEFS.sit, sitSampler),
  };
  cached = { byName, all: Object.values(byName).map((g) => g.clip) };
  return cached;
}
