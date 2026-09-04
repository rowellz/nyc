/**
 * Character foley: footsteps by surface (local slightly quieter/lower), landing thumps from the
 * Airborne flag edge, sprint clothing rustle, hit-react breath, death thud, heartbeat under 25 hp.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { StateFlag } from '@shared/protocol';
import type { Mixer, Voice } from './mixer';
import type { Bank } from './sounds';
import { clamp, rnd, lerp } from './synth';

const SURFACES = new Set(['concrete', 'asphalt', 'grass', 'metal', 'water']);

export class CharacterAudio {
  private offs: (() => void)[] = [];
  private wasAirborne = false;
  private airVy = 0;
  private remoteAir = new Map<number, boolean>();
  private rustle: Voice | null = null;
  private nextBeat = 0;
  private lastStep = 0;

  constructor(private ctx: GameContext, private mixer: Mixer, private bank: Bank) {
    this.offs.push(ctx.events.on('footstep', (pos, surface, local) => this.footstep(pos, surface, local)));
    this.offs.push(ctx.events.on('hit', (m) => {
      if (m.victimId === ctx.state.local.id) this.mixer.play(this.bank.get('breath'), { bus: 'local', gain: m.headshot ? 0.7 : 0.5, rate: rnd(0.92, 1.08), priority: 2 });
    }));
    this.offs.push(ctx.events.on('localDeath', () => {
      this.mixer.play(this.bank.get('death'), { bus: 'local', gain: 0.8, verb: 0.25, priority: 3 });
      this.rustle?.stop(0.1);
      this.rustle = null;
    }));
    this.offs.push(ctx.events.on('death', (m) => {
      if (m.victimId === ctx.state.local.id) return;
      const r = ctx.state.remotes.get(m.victimId);
      if (!r) return;
      const s = r.render;
      const cam = ctx.camera.position;
      const d = Math.hypot(s.x - cam.x, s.z - cam.z);
      if (d < 45) this.mixer.play(this.bank.get('death'), { bus: 'ext', x: s.x, y: s.y + 0.3, z: s.z, gain: 0.7, hrtf: true, refDistance: 3, rolloff: 1.2, verb: 0.3, priority: 1 });
    }));
  }

  private footstep(pos: THREE.Vector3, surface: string, local: boolean): void {
    const name = `step_${SURFACES.has(surface) ? surface : surface === 'cobblestone' || surface === 'paint' ? 'concrete' : surface === 'ground' || surface === 'dirt' ? 'grass' : 'concrete'}`;
    if (local) {
      const now = performance.now();
      if (now - this.lastStep < 110) return; // both feet in one frame
      this.lastStep = now;
      const sprint = (this.ctx.state.local.state.flags & StateFlag.Sprint) !== 0;
      this.mixer.play(this.bank.get(name), { bus: 'local', gain: (sprint ? 0.42 : 0.3) * rnd(0.85, 1.1), rate: rnd(0.9, 1.02) * 0.96, verb: 0.06, priority: 0 });
      return;
    }
    const cam = this.ctx.camera.position;
    const d = pos.distanceTo(cam);
    if (d > 35 || this.mixer.inside) return;
    this.mixer.play(this.bank.get(name), { bus: 'ext', x: pos.x, y: pos.y + 0.1, z: pos.z, gain: 0.5 * rnd(0.85, 1.1), rate: rnd(0.92, 1.08), hrtf: true, refDistance: 2, rolloff: 1.3, maxDistance: 40, verb: 0.1, priority: -1 });
  }

  update(dt: number, t: number): void {
    const st = this.ctx.state.local;
    const s = st.state;
    // landing
    const air = (s.flags & StateFlag.Airborne) !== 0 || st.vehicleKey === null && s.vy < -3;
    if (air) this.airVy = Math.min(this.airVy, s.vy);
    if (this.wasAirborne && !air && st.vehicleKey === null) {
      const fall = clamp(-this.airVy / 9, 0.25, 1.3);
      this.mixer.play(this.bank.get('land'), { bus: 'local', gain: 0.35 * fall, rate: lerp(1.1, 0.85, clamp(fall, 0, 1)), priority: 1 });
      this.airVy = 0;
    }
    this.wasAirborne = air;
    // remote landings
    const cam = this.ctx.camera.position;
    for (const r of this.ctx.state.remotes.values()) {
      const rs = r.render;
      const ra = (rs.flags & StateFlag.Airborne) !== 0;
      const was = this.remoteAir.get(r.id) ?? false;
      if (was && !ra && !(rs.flags & StateFlag.InVehicle)) {
        const d = Math.hypot(rs.x - cam.x, rs.z - cam.z);
        if (d < 30) this.mixer.play(this.bank.get('land'), { bus: 'ext', x: rs.x, y: rs.y, z: rs.z, gain: 0.4, hrtf: true, refDistance: 2, rolloff: 1.3, priority: -1 });
      }
      this.remoteAir.set(r.id, ra);
    }
    if (this.remoteAir.size > 64) for (const id of this.remoteAir.keys()) if (!this.ctx.state.remotes.has(id)) this.remoteAir.delete(id);
    // sprint rustle
    const sprinting = (s.flags & StateFlag.Sprint) !== 0 && st.vehicleKey === null && !st.dead && Math.hypot(s.vx, s.vz) > 3.5;
    if (this.rustle && !this.rustle.alive) this.rustle = null;
    if (sprinting && !this.rustle) this.rustle = this.mixer.play(this.bank.get('rustle'), { bus: 'local', gain: 0.1, loop: true, fadeIn: 0.25, priority: -2 });
    else if (!sprinting && this.rustle) {
      this.rustle.stop(0.2);
      this.rustle = null;
    }
    // heartbeat
    const hp = s.health;
    if (!st.dead && hp > 0 && hp < 25) {
      if (t >= this.nextBeat) {
        const k = hp / 25;
        this.nextBeat = t + lerp(0.55, 1.0, k);
        this.mixer.play(this.bank.get('heartbeat'), { bus: 'ui', gain: lerp(0.65, 0.25, k), priority: 1 });
      }
    } else this.nextBeat = t;
    void dt;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.rustle?.stop(0.05);
  }
}
