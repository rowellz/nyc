/**
 * Gunfire: pre-rendered muzzle reports through a street-reverb convolver, remote shots delayed by
 * distance/343 and air-absorbed, supersonic whizz when a remote round passes near the camera,
 * bullet impacts from the server's hit/miss results, reload foley, empty click, weapon switch.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { WeaponId, WEAPONS } from '@shared/weapons';
import type { Mixer } from './mixer';
import type { Bank } from './sounds';
import { clamp, rnd, pick } from './synth';

const NAME: Record<number, string> = { [WeaponId.Pistol]: 'pistol', [WeaponId.SMG]: 'smg', [WeaponId.Shotgun]: 'shotgun', [WeaponId.Rifle]: 'rifle' };
/** relative loudness (a 12 ga is louder than a 9 mm) */
const LOUD: Record<number, number> = { [WeaponId.Pistol]: 0.85, [WeaponId.SMG]: 0.8, [WeaponId.Shotgun]: 1.0, [WeaponId.Rifle]: 1.0 };

/** Keep offline verification at the live per-weapon level. */
export function weaponLevel(name: string): number {
  return LOUD[Number(Object.keys(NAME).find(id => NAME[Number(id)] === name))] ?? 1;
}

/**
 * Distance model for a report heard from d metres away (shared with the offline render so the WAV
 * matches the game): sound arrives at 343 m/s; air + facade absorption darkens it (~2.7 kHz at 100 m,
 * ~1.1 kHz at 300 m); the bright near slap-back gives way to the long dark roll that is all you hear
 * from a shot a few blocks over.
 */
export function remoteShotParams(d: number): { delay: number; lowpass: number; gain: number; verb: number; verbFar: number } {
  d = clamp(d, 0, 1000);
  return {
    delay: d / 343,
    lowpass: clamp(18000 * Math.pow(14 / (14 + d), 0.9), 700, 18000),
    gain: clamp(10 / (d + 4), 0.04, 1) * 1.1,
    verb: clamp(0.55 - d / 90, 0.08, 0.55),
    verbFar: clamp(0.15 + d / 70, 0.15, 1.4),
  };
}

export class WeaponsAudio {
  private offs: (() => void)[] = [];
  private tmp = new THREE.Vector3();
  private lastStatus: { id: number; reloading: boolean; mag: number } | null = null;
  private lastEmpty = 0;
  private reloadTimers: number[] = [];

  constructor(private ctx: GameContext, private mixer: Mixer, private bank: Bank) {
    this.offs.push(ctx.events.on('localFire', (w) => this.localFire(w)));
    this.offs.push(ctx.events.on('remoteFire', (id, w, o, d) => this.remoteFire(id, w, o, d)));
    this.offs.push(ctx.events.on('hit', (m) => this.onHit(m.victimId, m.x, m.y, m.z)));
    this.offs.push(ctx.events.on('miss', (m) => this.onMiss(m.surface, m.x, m.y, m.z)));
  }

  localFire(weapon: number): void {
    const name = NAME[weapon];
    if (!name) return;
    this.mixer.duckAmbience(0.3, 200);
    this.mixer.play(this.bank.get(name), { bus: 'local', gain: 1.0 * (LOUD[weapon] ?? 1), rate: rnd(0.97, 1.03), verb: 0.5, priority: 3 });
  }

  remoteFire(_id: number, weapon: number, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const name = NAME[weapon];
    if (!name) return;
    const cam = this.ctx.camera.position;
    const d = origin.distanceTo(cam);
    if (d > 450) return;
    // supersonic crack: does the ray pass near us? (bullet arrives before the report)
    const def = WEAPONS[weapon];
    const toCam = this.tmp.copy(cam).sub(origin);
    const t = toCam.dot(dir);
    if (t > 6 && t < (def?.range ?? 100) + 20) {
      const perp = Math.sqrt(Math.max(0, toCam.lengthSq() - t * t));
      if (perp < 3.5) {
        const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
        this.mixer.play(this.bank.get('whizz'), { bus: 'ext', x: px, y: py, z: pz, gain: 0.7 * clamp(1 - perp / 4, 0.3, 1), rate: rnd(0.95, 1.1), hrtf: true, refDistance: 1, rolloff: 0, priority: 2 });
      }
    }
    const p = remoteShotParams(d);
    this.mixer.play(this.bank.get(name), { bus: 'ext', x: origin.x, y: origin.y, z: origin.z, gain: p.gain * (LOUD[weapon] ?? 1), rate: rnd(0.96, 1.04), hrtf: true, refDistance: 1, rolloff: 0, lowpass: p.lowpass, delay: p.delay, verb: p.verb, verbFar: p.verbFar, priority: 2 });
  }

  private onHit(victimId: number, x: number, y: number, z: number): void {
    const cam = this.ctx.camera.position;
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    if (d > 60) return;
    const local = victimId === this.ctx.state.local.id;
    if (local) this.mixer.play(this.bank.get('imp_body'), { bus: 'local', gain: 0.8, rate: rnd(0.9, 1.05), priority: 2 });
    else this.mixer.play(this.bank.get('imp_body'), { bus: 'ext', x, y, z, gain: 0.7, rate: rnd(0.9, 1.1), hrtf: true, refDistance: 3, rolloff: 1.2, verb: 0.15, delay: d / 343, priority: 1 });
  }

  private onMiss(surface: string, x: number, y: number, z: number): void {
    if (surface === 'none') return;
    const cam = this.ctx.camera.position;
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    if (d > 70) return;
    const metal = surface === 'building' ? Math.random() < 0.18 : Math.random() < 0.08;
    const name = metal ? 'imp_metal' : 'imp_concrete';
    const g = (surface === 'ground' ? 0.55 : 0.7) * clamp(12 / (d + 6), 0.25, 1);
    this.mixer.play(this.bank.get(name), { bus: 'ext', x, y, z, gain: g, rate: rnd(0.9, 1.12), hrtf: true, refDistance: 2.5, rolloff: 1.2, verb: 0.2, delay: d / 343, priority: 1 });
  }

  update(): void {
    const combat = this.ctx.modules.get('combat') as { weaponStatus?: () => { name: string; id: number; mag: number; ammo: number; reloading: boolean } | null } | undefined;
    let s: { id: number; mag: number; ammo: number; reloading: boolean } | null = null;
    try {
      s = combat?.weaponStatus?.() ?? null;
    } catch {
      s = null;
    }
    const prev = this.lastStatus;
    if (s) {
      if (prev && s.id !== prev.id && s.id !== WeaponId.None) this.mixer.play(this.bank.get('switch'), { bus: 'local', gain: 0.5 });
      if (s.reloading && !(prev && prev.reloading)) this.reloadFoley(s.id);
      if (!s.reloading && prev?.reloading) this.clearReload();
      // empty click: trigger pulled on an empty magazine
      if (this.ctx.input.firePressed && s.mag === 0 && !s.reloading && s.id !== WeaponId.None) {
        const now = performance.now();
        if (now - this.lastEmpty > 160) {
          this.lastEmpty = now;
          this.mixer.play(this.bank.get('empty'), { bus: 'local', gain: 0.6 });
        }
      }
      this.lastStatus = { id: s.id, reloading: s.reloading, mag: s.mag };
    } else this.lastStatus = null;
  }

  private reloadFoley(weapon: number): void {
    this.clearReload();
    const def = WEAPONS[weapon];
    const T = (def?.reloadSeconds ?? 1.5) * 1000;
    const seq: [number, string, number][] = weapon === WeaponId.Shotgun
      ? [[0, 'click', 0.5], [0.25, 'clack', 0.5], [0.45, 'clack', 0.5], [0.65, 'clack', 0.5], [0.85, 'click', 0.6]]
      : [[0, 'click', 0.5], [0.22, 'clack', 0.55], [0.62, 'clack', 0.6], [0.86, 'click', 0.6]];
    for (const [f, name, g] of seq) {
      const h = window.setTimeout(() => this.mixer.play(this.bank.get(name), { bus: 'local', gain: g, rate: rnd(0.93, 1.07) }), f * T);
      this.reloadTimers.push(h);
    }
  }
  private clearReload(): void {
    for (const h of this.reloadTimers) clearTimeout(h);
    this.reloadTimers.length = 0;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.clearReload();
    void pick;
  }
}
