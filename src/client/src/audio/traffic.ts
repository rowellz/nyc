/**
 * Nearby traffic: engine + tire voices for AI cars (vehicles.traffic()) and remote players' vehicles
 * within 60 m, matched frame to frame (the traffic API has no ids), doppler from the closing speed,
 * honks when queued at a light, bus air brakes, NYPD sirens with doppler.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { StateFlag } from '@shared/protocol';
import type { Mixer } from './mixer';
import type { Bank } from './sounds';
import { EngineVoice, engineKindFor } from './engine';
import { SirenVoice } from './siren';
import { honk } from './ambience';
import { createPanner, movePanner, dopplerRatio } from './spatial';
import { type AC, disconnectOnEnded, noiseSrc, filter, gain, slew, rnd, clamp, rampTo } from './synth';

interface Entry {
  id?: string | number;
  x: number;
  z: number;
  speed: number;
  kind: string;
  siren: boolean;
  vx?: number;
  vz?: number;
  y?: number;
}

interface TrafficVoice {
  id: string | number | null;
  engine: EngineVoice;
  tire: GainNode;
  tireSrc: AudioBufferSourceNode;
  panner: PannerNode;
  siren: SirenVoice | null;
  x: number;
  z: number;
  vx: number;
  vz: number;
  speed: number;
  lastSpeed: number;
  stoppedSince: number;
  lastD: number;
  rpm: number;
  kind: string;
  diesel: boolean;
  nextHonk: number;
  matched: boolean;
  dying: number; // audio time when it should be removed, 0 = alive
}

const RANGE = 60;

export class TrafficAudio {
  private ac: AC;
  private voices: TrafficVoice[] = [];
  private maxVoices: number;
  private camPrev = new THREE.Vector3();
  private camVel = new THREE.Vector3();
  private camInit = false;
  private globalHonk = 0;
  private lastList: Entry[] = [];

  constructor(private ctx: GameContext, private mixer: Mixer, private bank: Bank) {
    this.ac = mixer.ac;
    this.maxVoices = ctx.quality.level === 'low' ? 4 : ctx.quality.level === 'medium' ? 6 : 8;
  }

  private gather(): Entry[] {
    const out: Entry[] = [];
    const vehicles = this.ctx.modules.get('vehicles') as { traffic?: () => Entry[]; remoteSpeed?: (id: number) => number } | undefined;
    try {
      const list = vehicles?.traffic?.();
      if (list) for (const e of list) out.push(e);
    } catch {
      /* ignore */
    }
    // remote players driving: their state carries velocity
    for (const r of this.ctx.state.remotes.values()) {
      const s = r.render;
      if (!(s.flags & StateFlag.InVehicle)) continue;
      out.push({ id: `p${r.id}`, x: s.x, z: s.z, y: s.y, speed: Math.hypot(s.vx, s.vz), kind: 'sedan', siren: false, vx: s.vx, vz: s.vz });
    }
    return out.filter((e) => Number.isFinite(e.x) && Number.isFinite(e.z) && Number.isFinite(e.speed) && typeof e.kind === 'string');
  }

  update(dt: number): void {
    dt = clamp(dt, 0, 0.25);
    const cam = this.ctx.camera.position;
    const now = this.ac.currentTime;
    if (!this.camInit) {
      this.camPrev.copy(cam);
      this.camInit = true;
    }
    if (dt > 0) {
      this.camVel.set((cam.x - this.camPrev.x) / dt, 0, (cam.z - this.camPrev.z) / dt);
      if (this.camVel.lengthSq() > 120 * 120) this.camVel.set(0, 0, 0); // teleport
    }
    this.camPrev.copy(cam);

    const list = this.gather();
    this.lastList = list;
    const localKey = this.ctx.state.local.vehicleKey;
    for (const v of this.voices) v.matched = false;
    const used = new Set<number>();
    const maxJump = 6 + 40 * dt;

    // match existing voices
    for (const v of this.voices) {
      if (v.dying) continue;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < list.length; i++) {
        if (used.has(i)) continue;
        const e = list[i];
        if (v.id !== null && e.id !== undefined) {
          if (e.id === v.id) {
            best = i;
            bestD = 0;
            break;
          }
          continue;
        }
        const px = v.x + v.vx * dt, pz = v.z + v.vz * dt;
        const d = Math.hypot(e.x - px, e.z - pz);
        if (d < bestD && d < maxJump) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) {
        used.add(best);
        v.matched = true;
        this.updateVoice(v, list[best], dt, now, cam);
      }
    }
    // retire lost / far voices
    for (const v of this.voices) {
      if (v.dying) continue;
      const d = Math.hypot(v.x - cam.x, v.z - cam.z);
      if (!v.matched || d > RANGE * 1.25) this.retire(v, now);
    }
    // new candidates: nearest unmatched entries within range
    const alive = this.voices.filter((v) => !v.dying).length;
    if (alive < this.maxVoices) {
      const cands: { i: number; d: number }[] = [];
      for (let i = 0; i < list.length; i++) {
        if (used.has(i)) continue;
        const e = list[i];
        const d = Math.hypot(e.x - cam.x, e.z - cam.z);
        if (d < RANGE) cands.push({ i, d });
      }
      cands.sort((a, b) => a.d - b.d);
      for (let k = 0; k < cands.length && this.voices.filter((v) => !v.dying).length < this.maxVoices && this.voices.length < this.maxVoices + 2; k++) {
        const e = list[cands[k].i];
        if (localKey && e.id === localKey) continue;
        this.spawn(e, now, cands[k].d);
      }
    }
    // cleanup dying
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.dying && now >= v.dying) {
        try {
          v.panner.disconnect();
        } catch {
          /* ignore */
        }
        this.voices.splice(i, 1);
      }
    }
  }

  private spawn(e: Entry, now: number, d: number): void {
    const ac = this.ac;
    const kind = engineKindFor(e.kind);
    const panner = createPanner(ac, this.mixer.exteriorSfx, { ref: 4, rolloff: 1.15, max: 120, x: e.x, y: e.y ?? 0.7, z: e.z });
    const engine = new EngineVoice(ac, panner, kind, { level: 0, t0: now });
    // tires: filtered noise by speed
    const tire = gain(ac, 0, panner);
    const tireLp = filter(ac, 'lowpass', 900, 0.6, 0, tire);
    const tireHp = filter(ac, 'highpass', 180, 0.7, 0, tireLp);
    const tireSrc = noiseSrc(ac, tireHp, 'pink', { t0: now });
    const v: TrafficVoice = {
      id: e.id ?? null,
      engine,
      tire,
      tireSrc,
      panner,
      siren: null,
      x: e.x,
      z: e.z,
      vx: e.vx ?? 0,
      vz: e.vz ?? 0,
      speed: e.speed,
      lastSpeed: e.speed,
      stoppedSince: e.speed < 0.3 ? now : 0,
      lastD: d,
      rpm: engine.idleRpm,
      kind: e.kind,
      diesel: kind === 'diesel',
      nextHonk: now + rnd(3, 8),
      matched: true,
      dying: 0,
    };
    engine.setLevel(kind === 'diesel' ? 0.8 : 0.55, now, 0.25);
    this.voices.push(v);
  }

  private retire(v: TrafficVoice, now: number): void {
    v.dying = now + 0.4;
    v.engine.stop(0.3);
    rampTo(v.tire.gain, 0, now, 0.25);
    disconnectOnEnded(v.tireSrc, [v.tire, v.panner]);
    v.tireSrc.addEventListener('ended', () => {
      const i = this.voices.indexOf(v);
      if (i >= 0) this.voices.splice(i, 1);
    }, { once: true });
    v.tireSrc.stop(now + 0.4);
    v.siren?.stop(0.3);
    v.siren = null;
  }

  private updateVoice(v: TrafficVoice, e: Entry, dt: number, now: number, cam: THREE.Vector3): void {
    // velocity from position deltas (or given)
    if (e.vx !== undefined && e.vz !== undefined) {
      v.vx = e.vx;
      v.vz = e.vz;
    } else if (dt > 0) {
      const nvx = (e.x - v.x) / dt, nvz = (e.z - v.z) / dt;
      v.vx += (nvx - v.vx) * Math.min(1, dt * 12);
      v.vz += (nvz - v.vz) * Math.min(1, dt * 12);
    }
    v.x = e.x;
    v.z = e.z;
    v.lastSpeed = v.speed;
    v.speed = e.speed;
    movePanner(v.panner, e.x, e.y ?? 0.7, e.z, now, 0.05);

    // doppler: closing speed between source and listener along the line between them
    const dx = cam.x - e.x, dz = cam.z - e.z;
    const d = Math.hypot(dx, dz) || 1e-3;
    const nx = dx / d, nz = dz / d;
    const closing = v.vx * nx + v.vz * nz - (this.camVel.x * nx + this.camVel.z * nz);
    const ratio = dopplerRatio(closing);
    v.engine.setDoppler(1200 * Math.log2(ratio));
    v.lastD = d;

    // engine model for AI cars: gears from speed, throttle from acceleration
    const accel = (v.speed - v.lastSpeed) / Math.max(1e-3, dt);
    const idle = v.engine.idleRpm, max = v.engine.maxRpm;
    const gearSpan = v.diesel ? 6 : 8.5;
    const gear = Math.floor(v.speed / gearSpan);
    const inGear = (v.speed - gear * gearSpan) / gearSpan;
    const targetRpm = v.speed < 0.3 ? idle : idle + (max - idle) * (0.18 + 0.55 * inGear);
    v.rpm += (targetRpm - v.rpm) * Math.min(1, dt * 6);
    const throttle = clamp(0.12 + accel * 0.25 + v.speed * 0.012, 0, 1);
    v.engine.set(v.rpm, v.speed < 0.3 ? 0.05 : throttle, now);
    // tire noise
    slew(v.tire.gain, clamp(v.speed / 28, 0, 1) * 0.35, now, 0.1);

    // bus air brake when it stops
    if (v.diesel && v.lastSpeed > 2.5 && v.speed < 0.6) {
      this.mixer.play(this.bank.get('airbrake'), { bus: 'ext', x: e.x, y: 0.6, z: e.z, gain: 0.5, refDistance: 5, rolloff: 1.2, priority: 0 });
    }
    // queued at a light: an impatient honk now and then
    if (v.speed < 0.3) {
      if (!v.stoppedSince) v.stoppedSince = now;
      const stopped = now - v.stoppedSince;
      if (stopped > 4 && now >= v.nextHonk && now >= this.globalHonk && Math.random() < 0.35) {
        v.nextHonk = now + rnd(15, 40);
        this.globalHonk = now + rnd(4, 9);
        const style = v.diesel ? 'truck' : /taxi|cab/i.test(v.kind) ? 'taxi' : 'sedan';
        honk(this.ac, this.mixer.exteriorSfx, now, { x: e.x, z: e.z, style, dur: rnd(0.15, 0.7), dist: d, panner: v.panner, level: 0.7 });
        if (Math.random() < 0.4) honk(this.ac, this.mixer.exteriorSfx, now + rnd(0.3, 0.5), { x: e.x, z: e.z, style, dur: rnd(0.3, 1.0), dist: d, panner: v.panner, level: 0.7 });
      }
    } else v.stoppedSince = 0;

    // siren
    if (e.siren && !v.siren) {
      v.siren = new SirenVoice(this.ac, v.panner, { level: 0.9, t0: now });
    } else if (!e.siren && v.siren) {
      v.siren.stop(0.3);
      v.siren = null;
    }
    if (v.siren) {
      v.siren.setDetune(1200 * Math.log2(ratio), now);
      v.siren.update(now);
    }
  }

  debug(): Record<string, unknown> {
    return { trafficEntries: this.lastList.length, totalVoices: this.voices.length, limit: this.maxVoices, totalLimit: this.maxVoices + 2, voices: this.voices.filter((v) => !v.dying).length, sirens: this.voices.filter((v) => v.siren).length };
  }

  dispose(): void {
    const now = this.ac.currentTime;
    for (const v of this.voices) if (!v.dying) this.retire(v, now);
  }
}
