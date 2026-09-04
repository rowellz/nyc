/**
 * The local vehicle: engine from rpm/throttle with gear-shift blips, tire squeal on slip, road noise
 * by speed and surface (cobbles rumble), wind at speed, horn, siren, crash impacts, door foley,
 * interior muffling of the outside world.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import type { Mixer } from './mixer';
import type { Bank } from './sounds';
import { EngineVoice, engineKindFor } from './engine';
import { SirenVoice } from './siren';
import { type AC, stopSources, noiseSrc, filter, gain, osc, slew, rnd, clamp, rampTo, lerp } from './synth';

interface Driving {
  key: string;
  kind: string;
  speed: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  steer: number;
  siren: boolean;
  horn: boolean;
  airborne: boolean;
}

export class LocalVehicleAudio {
  private ac: AC;
  private engine: EngineVoice | null = null;
  private siren: SirenVoice | null = null;
  private squeal!: GainNode;
  private squealBp!: BiquadFilterNode;
  private road!: GainNode;
  private roadLp!: BiquadFilterNode;
  private cobble!: GainNode;
  private cobbleLfo!: OscillatorNode;
  private wind!: GainNode;
  private horn!: GainNode;
  private hornOscs: OscillatorNode[] = [];
  private built = false;
  private sources: AudioScheduledSourceNode[] = [];
  private out!: GainNode;
  private timers: number[] = [];
  private lastGear = 0;
  private lastKey: string | null = null;
  private lastSpeed = 0;
  private offs: (() => void)[] = [];
  private tmp = new THREE.Vector3();
  private lastImpact = 0;
  private hornHeld = false;

  constructor(private ctx: GameContext, private mixer: Mixer, private bank: Bank) {
    this.ac = mixer.ac;
    this.offs.push(ctx.events.on('enteredVehicle', () => this.onEnter()));
    this.offs.push(ctx.events.on('exitedVehicle', () => this.onExit()));
    this.offs.push(ctx.events.on('impact', (pos, impulse) => this.onImpact(pos, impulse)));
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const ac = this.ac;
    const dest = this.out = gain(ac, 1, this.mixer.localSfx);
    const now = ac.currentTime;
    // tire squeal: narrow band noise, swept
    this.squeal = gain(ac, 0, dest);
    this.squealBp = filter(ac, 'bandpass', 1500, 14, 0, this.squeal);
    const sq2 = filter(ac, 'bandpass', 1500, 14, 0, this.squealBp);
    this.sources.push(noiseSrc(ac, sq2, 'white', { t0: now }));
    // road noise
    this.road = gain(ac, 0, dest);
    this.roadLp = filter(ac, 'lowpass', 700, 0.7, 0, this.road);
    const roadHp = filter(ac, 'highpass', 90, 0.7, 0, this.roadLp);
    this.sources.push(noiseSrc(ac, roadHp, 'pink', { t0: now }));
    // cobbles: brown noise amplitude-modulated at the stone-crossing rate
    this.cobble = gain(ac, 0, dest);
    const cobAm = gain(ac, 0, this.cobble);
    this.cobbleLfo = osc(ac, 'square', 20, null, now);
    this.cobbleLfo.connect(gain(ac, 0.5, cobAm.gain));
    const off = ac.createConstantSource();
    off.offset.value = 0.5;
    off.connect(cobAm.gain);
    off.start(now);
    this.sources.push(off, this.cobbleLfo);
    const cobLp = filter(ac, 'lowpass', 260, 1.2, 0, cobAm);
    this.sources.push(noiseSrc(ac, cobLp, 'brown', { t0: now }));
    // wind
    this.wind = gain(ac, 0, dest);
    const windBp = filter(ac, 'bandpass', 520, 0.5, 0, this.wind);
    this.sources.push(noiseSrc(ac, windBp, 'pink', { t0: now }));
    // horn: two-tone 400/500 through a nasal peak
    this.horn = gain(ac, 0, dest);
    const hornPk = filter(ac, 'peaking', 1150, 1.0, 8, this.horn);
    const hornLp = filter(ac, 'lowpass', 4000, 0.6, 0, hornPk);
    this.hornOscs = [osc(ac, 'sawtooth', 400, gain(ac, 0.5, hornLp), now), osc(ac, 'sawtooth', 500, gain(ac, 0.45, hornLp), now)];
    this.sources.push(...this.hornOscs);
  }

  private onEnter(): void {
    this.clearTimers();
    this.build();
    const now = this.ac.currentTime;
    this.mixer.play(this.bank.get('door_open'), { bus: 'local', gain: 0.6 });
    this.timers.push(window.setTimeout(() => this.mixer.play(this.bank.get('door_close'), { bus: 'local', gain: 0.8 }), 650));
    this.timers.push(window.setTimeout(() => { if (this.ctx.state.local.vehicleKey !== null) this.mixer.setInside(true); }, 700));
    void now;
  }

  private clearTimers(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private onExit(): void {
    this.clearTimers();
    this.mixer.setInside(false);
    this.mixer.play(this.bank.get('door_open'), { bus: 'local', gain: 0.6 });
    this.timers.push(window.setTimeout(() => this.mixer.play(this.bank.get('door_close'), { bus: 'local', gain: 0.75 }), 900));
    this.stopEngine();
  }

  private startEngine(kind: string): void {
    this.build();
    const now = this.ac.currentTime;
    const ek = engineKindFor(kind);
    this.mixer.play(this.bank.get('starter'), { bus: 'local', gain: 0.5 });
    const e = new EngineVoice(this.ac, this.mixer.localSfx, ek, { level: 0, t0: now + 0.55 });
    e.setLevel(ek === 'diesel' ? 0.75 : 0.6, now + 0.55, 0.15);
    // starter catch: a quick rev then settle
    e.set(e.idleRpm * 1.6, 0.5, now + 0.6, 0.05);
    e.set(e.idleRpm, 0.05, now + 1.0, 0.3);
    this.engine = e;
  }

  private stopEngine(): void {
    this.hornHeld = false;
    this.engine?.stop(0.35);
    this.engine = null;
    this.siren?.stop(0.2);
    this.siren = null;
    if (this.built) {
      const now = this.ac.currentTime;
      for (const g of [this.squeal, this.road, this.cobble, this.wind, this.horn]) rampTo(g.gain, 0, now, 0.15);
    }
  }

  private onImpact(pos: THREE.Vector3, impulse: number): void {
    const now = this.ac.currentTime;
    if (now - this.lastImpact < 0.12) return;
    this.lastImpact = now;
    // impulse units are unknown across vehicle implementations: treat < 30 as a delta-v (m/s), else N*s
    const strength = impulse < 30 ? clamp(impulse / 8, 0, 1) : clamp(impulse / 9000, 0, 1);
    if (strength < 0.04) return;
    const cam = this.ctx.camera.position;
    const d = pos.distanceTo(cam);
    const local = this.ctx.state.local.vehicleKey !== null && d < 8;
    const g = 0.25 + 0.75 * Math.sqrt(strength);
    if (local) this.mixer.play(this.bank.get('crunch'), { bus: 'local', gain: g, rate: lerp(1.15, 0.85, strength), verb: 0.35, priority: 2 });
    else if (d < 80) this.mixer.play(this.bank.get('crunch'), { bus: 'ext', x: pos.x, y: pos.y, z: pos.z, gain: g, rate: lerp(1.15, 0.85, strength), hrtf: true, refDistance: 6, rolloff: 1.1, verb: 0.5, priority: 1 });
  }

  update(dt: number): void {
    const vehicles = this.ctx.modules.get('vehicles') as { driving?: () => Driving | null } | undefined;
    let d: Driving | null = null;
    try {
      d = vehicles?.driving?.() ?? null;
    } catch {
      d = null;
    }
    const now = this.ac.currentTime;
    if (!d) {
      if (this.engine) this.stopEngine();
      this.lastKey = null;
      // muffling follows vehicleKey too, in case the event was missed
      if (this.mixer.inside && this.ctx.state.local.vehicleKey === null) this.mixer.setInside(false);
      return;
    }
    if (!this.engine || this.lastKey !== d.key) {
      this.stopEngine();
      this.startEngine(d.kind);
      this.lastKey = d.key;
      this.lastGear = d.gear;
      if (!this.mixer.inside) this.mixer.setInside(true);
    }
    const e = this.engine!;
    // rpm scale: normalized 0..1 or real rpm
    let rpm = d.rpm;
    if (!(rpm > 0)) rpm = e.idleRpm;
    else if (rpm <= 1.5) rpm = e.idleRpm + (e.maxRpm - e.idleRpm) * clamp(rpm, 0, 1);
    const throttle = clamp(Math.abs(d.throttle), 0, 1);
    e.set(rpm, d.airborne ? throttle * 0.6 : throttle, now);
    if (d.gear !== this.lastGear) {
      if (d.gear > this.lastGear && d.gear > 1) e.shift(now); // load lifts while the next gear engages (rpm drop comes from the vehicle model)
      this.lastGear = d.gear;
    }
    const speed = Math.abs(d.speed);
    // tire squeal from slip: handbrake at speed, hard steering at speed, heavy braking
    let slip = 0;
    if (d.handbrake && speed > 2.5) slip = clamp(speed / 12, 0.4, 1);
    slip = Math.max(slip, clamp((Math.abs(d.steer) * speed) / 22 - 0.45, 0, 1));
    slip = Math.max(slip, clamp(d.brake * speed / 30 - 0.6, 0, 1));
    if (d.airborne) slip = 0;
    slew(this.squeal.gain, slip * 0.5, now, slip > 0 ? 0.05 : 0.12);
    slew(this.squealBp.frequency, 1200 + 900 * slip + 200 * Math.sin(now * 9), now, 0.06);
    // road noise by speed and surface
    const streets = this.ctx.modules.get('streets') as { surfaceAt?: (x: number, z: number) => string | null } | undefined;
    let surface: string | null = null;
    try {
      const p = this.ctx.state.local.state;
      surface = streets?.surfaceAt?.(p.x, p.z) ?? null;
    } catch {
      surface = null;
    }
    const sp01 = clamp(speed / 30, 0, 1);
    const cobbles = surface === 'cobblestone' || surface === 'paving_stones';
    slew(this.road.gain, (d.airborne ? 0 : 0.3 * Math.pow(sp01, 0.8)) * (surface === 'metal' ? 1.4 : 1), now, 0.12);
    slew(this.roadLp.frequency, 500 + 1200 * sp01 + (surface === 'metal' ? 800 : 0), now, 0.15);
    slew(this.cobble.gain, cobbles && !d.airborne ? 0.4 * Math.pow(sp01, 0.6) : 0, now, 0.15);
    slew(this.cobbleLfo.frequency, clamp(speed / 0.14, 4, 120), now, 0.1);
    slew(this.wind.gain, 0.35 * Math.pow(clamp(speed / 45, 0, 1), 2), now, 0.2);
    // siren
    const sirenKind = /police|nypd|ambulance|fire|fdny/i.test(d.kind);
    if (d.siren && sirenKind && !this.siren) this.siren = new SirenVoice(this.ac, this.mixer.localSfx, { level: 0.55, t0: now });
    else if ((!d.siren || !sirenKind) && this.siren) {
      this.siren.stop(0.25);
      this.siren = null;
    }
    // horn
    const sirenHorn = !!this.siren && d.horn && !this.hornHeld;
    if (sirenHorn) this.siren!.airHorn(0.7, now);
    this.hornHeld = d.horn;
    slew(this.horn.gain, d.horn && !this.siren ? 0.6 : 0, now, d.horn ? 0.01 : 0.03);
    this.siren?.update(now);
    this.lastSpeed = speed;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.clearTimers();
    this.stopEngine();
    if (this.built) stopSources(this.sources, this.out, 0.15);
    this.sources = [];
    this.built = false;
  }
}
