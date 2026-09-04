/**
 * Remote players: one CharacterInstance per RemotePlayer, positioned from the interpolated `render`
 * state, animation from state.anim + velocity, aim pitch from state.pitch, name tag sprite, spawn
 * protection shimmer, death pose, LOD (full skinned < 60 m, lite 60-150 m, hidden beyond).
 */
import * as THREE from 'three';
import { StateFlag, AnimId } from '@shared/protocol';
import { WeaponId } from '@shared/weapons';
import type { GameContext, RemotePlayer } from '@/core/context';
import { CharacterInstance, type ActionName, type WeaponKind } from './animator';
import { createNameTag, type NameTag } from './materials';
import { randomAppearance } from './appearance';
import { fromAnimId } from './controller';

export const LOD_FULL = 60;
export const LOD_LITE = 150;
const TAG_FADE_START = 38;
const TAG_MAX = 60;

interface Entry {
  inst: CharacterInstance;
  tag: NameTag;
  dead: boolean;
  lastAnim: number;
  lastName: string;
  lastScore: number;
  visible: boolean;
  headPos: THREE.Vector3;
}

export function weaponKind(w: number): WeaponKind {
  if (w === WeaponId.Rifle || w === WeaponId.SMG || w === WeaponId.Shotgun) return 'rifle';
  if (w === WeaponId.Pistol) return 'pistol';
  return 'none';
}

export class RemoteManager {
  private entries = new Map<number, Entry>();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private lastFootstep = new Map<number, number>();

  constructor(
    private ctx: GameContext,
    private group: THREE.Group,
    private shared: { uTime: { value: number }; uWetness?: { value: number } },
    private surfaceAt: (x: number, z: number) => string,
  ) {}

  get(id: number): CharacterInstance | null {
    return this.entries.get(id)?.inst ?? null;
  }

  count(): number {
    return this.entries.size;
  }

  private spawn(r: RemotePlayer): Entry {
    const inst = new CharacterInstance(randomAppearance(r.id * 7919 + 13), this.shared);
    inst.root.name = `remote:${r.id}`;
    this.group.add(inst.root);
    const tag = createNameTag(r.name, r.score);
    tag.sprite.name = `tag:${r.id}`;
    this.group.add(tag.sprite);
    const e: Entry = { inst, tag, dead: false, lastAnim: -1, lastName: r.name, lastScore: r.score, visible: true, headPos: new THREE.Vector3() };
    const id = r.id;
    inst.onFootstep = () => {
      const now = this.ctx.now ?? 0;
      if (now - (this.lastFootstep.get(id) ?? -1) < 0.12) return;
      this.lastFootstep.set(id, now);
      const p = inst.root.position;
      if (p.distanceToSquared(this.camPos) < 30 * 30) this.ctx.events.emit('footstep', this.tmp2.copy(p), this.surfaceAt(p.x, p.z), false);
    };
    this.entries.set(r.id, e);
    return e;
  }

  remove(id: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    this.group.remove(e.tag.sprite);
    e.tag.dispose();
    e.inst.dispose();
  }

  update(dt: number): void {
    const st = this.ctx.state;
    const cam = this.ctx.camera;
    this.camPos.copy(cam.position);
    // remove entries whose remote is gone
    for (const id of this.entries.keys()) if (!st.remotes.has(id)) this.remove(id);
    for (const r of st.remotes.values()) {
      let e = this.entries.get(r.id);
      if (!e) e = this.spawn(r);
      const s = r.render;
      const inst = e.inst;
      const inVehicle = (s.flags & StateFlag.InVehicle) !== 0 || s.vehicleId !== 0;
      const dx = s.x - this.camPos.x, dz = s.z - this.camPos.z, dy = s.y - this.camPos.y;
      const d2 = dx * dx + dy * dy + dz * dz;
      const visible = !inVehicle && d2 < LOD_LITE * LOD_LITE;
      if (visible !== e.visible) {
        e.visible = visible;
        inst.setVisible(visible);
        e.tag.sprite.visible = visible;
      }
      if (!visible) continue;
      const full = d2 < LOD_FULL * LOD_FULL;
      inst.setDetail(full ? 'high' : 'low');
      inst.root.position.set(s.x, s.y, s.z);
      inst.root.rotation.y = s.yaw;

      // animation
      const speed = Math.hypot(s.vx, s.vz);
      const airborne = (s.flags & StateFlag.Airborne) !== 0;
      const dead = (s.flags & StateFlag.Dead) !== 0 || s.anim === AnimId.Death;
      if (dead && !e.dead) {
        e.dead = true;
        inst.play('death', 0.12, true);
        inst.aimTarget = 0;
      } else if (!dead && e.dead) {
        e.dead = false;
        inst.play('idle', 0.1, true);
      }
      if (!dead) {
        let state = fromAnimId(s.anim, speed, airborne, s.vy);
        if (state === 'land') state = speed > 0.3 ? 'walk' : 'idle';
        if (airborne && state !== 'jumpLoop' && state !== 'fall') state = s.vy > -0.5 ? 'jumpLoop' : 'fall';
        inst.play(state, 0.18);
        inst.speed = speed;
        const aiming = (s.flags & StateFlag.Aiming) !== 0 || s.anim === AnimId.AimIdle || s.anim === AnimId.AimWalk;
        inst.aimTarget = aiming ? 1 : 0;
        inst.weapon = weaponKind(s.weapon);
        inst.aimPitch = s.pitch;
        // one-shots signalled through anim ids
        if (s.anim !== e.lastAnim) {
          if (s.anim === AnimId.Reload) inst.action('reload');
          else if (s.anim === AnimId.Punch) inst.action('punch');
          e.lastAnim = s.anim;
        }
        // head look: toward the local player when close, else forward
        const lx = st.local.state.x - s.x, lz = st.local.state.z - s.z;
        const ld2 = lx * lx + lz * lz;
        if (ld2 < 12 * 12 && ld2 > 1) {
          const yawTo = Math.atan2(-lx, -lz);
          let rel = yawTo - s.yaw;
          while (rel > Math.PI) rel -= 2 * Math.PI;
          while (rel < -Math.PI) rel += 2 * Math.PI;
          if (Math.abs(rel) < 1.4) {
            inst.lookYaw = rel;
            inst.lookPitch = 0;
            inst.lookWeight = 0.8;
          } else inst.lookWeight = 0;
        } else inst.lookWeight = 0;
      }
      inst.setProtected(!dead && (s.flags & StateFlag.Protected) !== 0);
      inst.update(dt, full);

      // name tag
      if (r.name !== e.lastName || r.score !== e.lastScore) {
        e.lastName = r.name;
        e.lastScore = r.score;
        e.tag.set(r.name, r.score);
      }
      const dist = Math.sqrt(d2);
      const tagVisible = dist < TAG_MAX;
      e.tag.sprite.visible = tagVisible;
      if (tagVisible) {
        const sc = inst.appearance.height / 1.8;
        const headY = s.y + (dead ? 0.5 : (inst.state === 'crouchIdle' || inst.state === 'crouchWalk' ? 1.45 : 2.02)) * sc;
        e.tag.sprite.position.set(s.x, headY, s.z);
        const k = THREE.MathUtils.clamp(dist / 6, 0.5, 4);
        e.tag.sprite.scale.set(1.0 * k, 0.1875 * k, 1);
        e.tag.material.opacity = 1 - THREE.MathUtils.smoothstep(dist, TAG_FADE_START, TAG_MAX);
      }
    }
  }

  headPosition(id: number, out: THREE.Vector3): THREE.Vector3 | null {
    const e = this.entries.get(id);
    if (!e) return null;
    const s = this.ctx.state.remotes.get(id)?.render;
    if (!s) return null;
    const sc = e.inst.appearance.height / 1.8;
    if (e.inst.root.visible) {
      e.inst.bonePosition('Head', out);
      // bone matrices lag a frame at most; guard against an unrendered instance (all zeros)
      if (out.lengthSq() > 0.01) {
        out.y += 0.08 * sc;
        return out;
      }
    }
    const crouch = (s.flags & StateFlag.Crouch) !== 0;
    return out.set(s.x, s.y + (crouch ? 1.2 : 1.66) * sc, s.z);
  }

  action(id: number, name: ActionName): void {
    this.entries.get(id)?.inst.action(name);
  }

  dispose(): void {
    for (const id of Array.from(this.entries.keys())) this.remove(id);
  }

  /** for the debug hook */
  debugStats(): { count: number; visible: number } {
    let visible = 0;
    for (const e of this.entries.values()) if (e.visible) visible++;
    return { count: this.entries.size, visible };
  }

  /** local head helper reused by index.ts */
  static localHead(inst: CharacterInstance, out: THREE.Vector3, fallback: { x: number; y: number; z: number }, crouch: boolean): THREE.Vector3 {
    inst.bonePosition('Head', out);
    if (out.lengthSq() > 0.01) {
      out.y += 0.08 * (inst.appearance.height / 1.8);
      return out;
    }
    return out.set(fallback.x, fallback.y + (crouch ? 1.2 : 1.66), fallback.z);
  }
}
