/**
 * Combat module: weapons (procedural models attached via the character module), firing with rate limiting /
 * magazines / reloads / spread / recoil, muzzle flash + shells + tracers, local raycast feedback with
 * server-confirmed hit markers and damage, remote fire visuals, pickups, safe-zone visuals, spawn protection,
 * death / respawn hooks. The SERVER decides every hit: we only predict visuals.
 *
 * Weapon meshes handed to character.setWeaponMesh(): origin = firing hand on the grip, -Z = muzzle, +Y up,
 * +X = shooter's right; children named 'muzzle' and 'eject' mark the bore exit and the ejection port.
 */
import * as THREE from 'three';
import type { GameContext, GameModule } from '@/core/context';
import type { ServerMessage } from '@shared/protocol';
import { StateFlag } from '@shared/protocol';
import { WEAPONS, WeaponId, type WeaponDef } from '@shared/weapons';
import { PLAYER_RUN_SPEED } from '@shared/constants';
import { ParticleSystem } from './fx/particles';
import { Decals } from './fx/decals';
import { Tracers } from './fx/tracers';
import { MuzzleFlashes } from './fx/muzzleFlash';
import { Shells } from './fx/shells';
import { Impacts } from './fx/impacts';
import { CombatHud } from './hud';
import { Pickups } from './pickups';
import { SafeZoneFx } from './safeZone';
import { prepareWeapon, buildWeaponMesh, disposeWeaponGeometries, weaponInfo } from './weaponModels';
import { disposeWeaponMaterial } from './materials';
import { prepareFxTextures, disposeWeaponTextures } from './textures';
import { scheduleInit, initStep, initStats } from './init';
import { WeaponPose, type WeaponKick } from './weaponPose';
import { ProtectionFx } from './protection';
import { clamp, fmtClock, pelletDirections, rayCapsule, raySphere, scatterInCone } from './util';

export interface CombatModule extends GameModule {
  /** crosshair spread in degrees for the HUD */
  spreadDeg(): number;
  /** the reticle should show: aiming (RMB) or the gun is still raised from a recent shot */
  aiming(): boolean;
  /** 0..1 heartbeat envelope below 30 hp (audio hook; window also gets 'combat:heartbeat' events per beat) */
  lowHealthPulse(): number;
  /** current weapon def + ammo for HUD */
  weaponStatus(): { name: string; id: number; mag: number; ammo: number; reloading: boolean } | null;
  // ---- extras
  /** seconds of spawn protection left (0 when none) */
  protectedSeconds(): number;
  /** local player is inside the safe zone */
  inSafeZone(): boolean;
  /** Contextual E priority: collect the offered pickup before trying a nearby vehicle. */
  interactPickup(): boolean;
}

interface CharacterLike {
  rightHandMatrix?(): THREE.Matrix4 | null;
  headPosition?(id: number, out: THREE.Vector3): THREE.Vector3 | null;
  setWeaponMesh?(playerId: number, mesh: THREE.Object3D | null): void;
  playAction?(playerId: number, action: 'fire' | 'reload' | 'punch' | 'hitReact'): void;
  localModel?(): THREE.Object3D | null;
  remoteModel?(id: number): THREE.Object3D | null;
}
interface UiLike {
  toast?(text: string, kind?: 'info' | 'score' | 'discover' | 'warn'): void;
  prompt?(text: string | null): void;
}

/**
 * per-weapon feel: camera kick (deg) + sideways share, recoil spring (K stiffness / C damping: heavier guns
 * recover slower), bloom per shot (deg), flash size (m), light intensity, smoke puffs, tracer intensity
 * (0 = none: pistol and shotgun), and the weapon's own kick in the hand (back along the bore, muzzle rise)
 */
interface Feel { kick: number; side: number; K: number; C: number; bloom: number; flash: number; light: number; smoke: number; tracer: number; wk: WeaponKick }
const FEEL: Record<number, Feel> = {
  [WeaponId.Pistol]: { kick: 1.7, side: 0.5, K: 230, C: 27, bloom: 0.7, flash: 0.24, light: 16, smoke: 1, tracer: 0, wk: { back: 0.035, up: 0.1, rise: 0.025, recover: 11 } },
  [WeaponId.SMG]: { kick: 0.75, side: 0.9, K: 280, C: 30, bloom: 0.35, flash: 0.26, light: 14, smoke: 1, tracer: 0.55, wk: { back: 0.015, up: 0.045, rise: 0.02, recover: 16 } },
  [WeaponId.Shotgun]: { kick: 4.6, side: 0.4, K: 120, C: 19, bloom: 2.4, flash: 0.46, light: 32, smoke: 3, tracer: 0, wk: { back: 0.07, up: 0.16, rise: 0.04, recover: 6 } },
  [WeaponId.Rifle]: { kick: 1.25, side: 0.6, K: 210, C: 26, bloom: 0.55, flash: 0.34, light: 24, smoke: 1, tracer: 0.75, wk: { back: 0.028, up: 0.07, rise: 0.025, recover: 12 } },
};
const CAPSULE_R = 0.35;
const CAPSULE_H = 1.8;
const HEAD_R = 0.3;
const MELEE_RANGE = 2.0;
const MELEE_COOLDOWN = 0.6;
const HEAD_OFFSET = 1.62;

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _castOrigin = new THREE.Vector3();
const _aimDirection = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _b = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pellets: THREE.Vector3[] = [];
const _evPos = new THREE.Vector3();
const _evDir = new THREE.Vector3();
/** where the local player's last shot landed (debug / test readout) */
const _lastImpact = new THREE.Vector3();
let _lastSurface = 'none';

interface CastResult {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  dist: number;
  surface: string;
  victimId: number;
}

export async function createCombat(ctx: GameContext): Promise<CombatModule> {
  const st = ctx.state;
  const q = ctx.quality;
  const character = () => ctx.modules.get('character') as CharacterLike | undefined;
  const ui = () => ctx.modules.get('ui') as UiLike | undefined;

  // The pistol and all fire effects must be ready before this module accepts input.
  await scheduleInit(ctx, prepareFxTextures());
  await prepareWeapon(ctx, WeaponId.Pistol);

  // ---- fx
  const particles = await initStep(ctx, () => new ParticleSystem(ctx, (q.level === 'low' || q.level === 'mobile') ? 512 : q.level === 'medium' ? 1024 : 2048));
  const decals = await initStep(ctx, () => new Decals(ctx, (q.level === 'low' || q.level === 'mobile') ? 64 : q.level === 'medium' ? 128 : 256));
  const tracers = await initStep(ctx, () => new Tracers());
  const flashes = await initStep(ctx, () => new MuzzleFlashes(ctx));
  const shells = await initStep(ctx, () => new Shells(ctx));
  const impacts = await initStep(ctx, () => new Impacts(ctx, particles, decals));
  const hud = await initStep(ctx, () => new CombatHud(ctx));
  const pickups = await initStep(ctx, () => new Pickups(ctx));
  const safe = await initStep(ctx, () => new SafeZoneFx(ctx));
  const shields = new ProtectionFx(ctx);
  const fxGroup = new THREE.Group();
  fxGroup.name = 'combat-fx';
  fxGroup.add(particles.group, decals.mesh, tracers.mesh, flashes.mesh, shells.mesh, ...flashes.lights, shields.group);
  ctx.worldGroup.add(fxGroup, pickups.group, safe.group);
  /** fallback rig for weapons when the character module is absent */
  const fallbackRig = new THREE.Group();
  fallbackRig.name = 'combat-fallback-weapons';
  ctx.worldGroup.add(fallbackRig);

  let disposed = false;
  const requested = new Set<number>();
  function requestWeapon(id: number): void {
    if (requested.has(id)) return;
    requested.add(id);
    void prepareWeapon(ctx, id).catch(error => {
      if (!disposed) console.warn('[combat] weapon initialization failed', id, error);
    }).finally(() => requested.delete(id));
  }

  // ---- local weapon state
  let t = 0;
  let localWeapon: THREE.Group | null = null;
  let localWeaponId = -1;
  let seq = 0;
  let nextShotAt = 0;
  let lastShotAt = -10;
  let queuedPressAt = -10;
  let reloading = false;
  let reloadEnd = 0;
  let bloom = 0;
  let lastMelee = -10;
  let firingUntil = -10;
  let recoilP = 0, recoilY = 0, recoilVP = 0, recoilVY = 0;
  let recoilK = 190, recoilC = 26;
  /** 0..1 smoothed aim state for the crosshair / spread transition */
  let aimK = 0;
  let reloadStart = -10;
  /** pose layer (hip raise, barrel alignment, kick, magazine) per attached weapon mesh */
  const poses = new Map<THREE.Object3D, WeaponPose>();
  let wasProtected = false;
  let protectionToastShown = false;
  const remoteWeapons = new Map<number, { weaponId: number; mesh: THREE.Group | null; firingSince: number; nextVisualShot: number; lastFiring: boolean; lastShot: number }>();
  let pendingKillMarker = false;
  const predictedImpacts = new Set<number>();

  const currentDef = (): WeaponDef | null => WEAPONS[st.local.inventory.current] ?? null;
  const currentSlot = () => st.local.inventory.weapons.find((w) => w.id === st.local.inventory.current) ?? null;
  const inSafe = () => safe.inSafeZone(st.local.state.x, st.local.state.z);

  // ------------------------------------------------------------------ weapon meshes (local / remote)
  function attachLocalWeapon(id: number): void {
    if (id === localWeaponId) return;
    if (id !== WeaponId.None && !st.local.dead && !weaponInfo(id)) { requestWeapon(id); return; }
    const ch = character();
    if (localWeapon) {
      if (ch?.setWeaponMesh) ch.setWeaponMesh(st.local.id, null);
      poses.delete(localWeapon);
      localWeapon.removeFromParent();
      localWeapon = null;
    }
    localWeaponId = id;
    if (id === WeaponId.None || st.local.dead) {
      localWeaponId = st.local.dead ? -1 : id;
      return;
    }
    const mesh = buildWeaponMesh(ctx, id);
    if (!mesh) return;
    localWeapon = mesh;
    if (ch?.setWeaponMesh) {
      ch.setWeaponMesh(st.local.id, mesh);
      poses.set(mesh, new WeaponPose(mesh));
    } else fallbackRig.add(mesh);
  }

  function syncRemoteWeapons(): void {
    const ch = character();
    for (const [id, r] of st.remotes) {
      const wid = r.render.flags & StateFlag.Dead ? WeaponId.None : r.render.weapon;
      let rec = remoteWeapons.get(id);
      if (!rec) {
        rec = { weaponId: -1, mesh: null, firingSince: -1, nextVisualShot: 0, lastFiring: false, lastShot: -10 };
        remoteWeapons.set(id, rec);
      }
      if (rec.weaponId !== wid && (wid === WeaponId.None || weaponInfo(wid))) {
        if (rec.mesh) {
          ch?.setWeaponMesh?.(id, null);
          poses.delete(rec.mesh);
          rec.mesh.removeFromParent();
          rec.mesh = null;
        }
        rec.weaponId = wid;
        if (wid !== WeaponId.None) {
          const mesh = buildWeaponMesh(ctx, wid);
          if (mesh) {
            rec.mesh = mesh;
            if (ch?.setWeaponMesh) {
              ch.setWeaponMesh(id, mesh);
              poses.set(mesh, new WeaponPose(mesh));
            } else fallbackRig.add(mesh);
          }
        }
      }
      if (wid !== WeaponId.None && !weaponInfo(wid)) requestWeapon(wid);
      // fallback placement (no character module): at the shoulder, pointing along yaw/pitch
      if (rec.mesh && !ch?.setWeaponMesh) {
        const s = r.render;
        rec.mesh.position.set(s.x - Math.cos(s.yaw) * 0.25 - Math.sin(s.yaw) * 0.3, s.y + 1.32, s.z + Math.sin(s.yaw) * 0.25 - Math.cos(s.yaw) * 0.3);
        rec.mesh.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
      }
    }
    for (const [id, rec] of remoteWeapons) {
      if (!st.remotes.has(id)) {
        if (rec.mesh) {
          ch?.setWeaponMesh?.(id, null);
          poses.delete(rec.mesh);
          rec.mesh.removeFromParent();
        }
        remoteWeapons.delete(id);
      }
    }
  }

  function placeFallbackLocalWeapon(): void {
    if (!localWeapon || character()?.setWeaponMesh) return;
    if (st.screenshotMode) {
      localWeapon.visible = false;
      return;
    }
    localWeapon.visible = true;
    const eye = st.local.eye;
    _d.copy(st.local.aimDir).normalize();
    _r.crossVectors(_d, _u.set(0, 1, 0)).normalize();
    _u.crossVectors(_r, _d).normalize();
    localWeapon.position.copy(eye).addScaledVector(_d, 0.35).addScaledVector(_r, 0.22).addScaledVector(_u, -0.22);
    _m.copy(localWeapon.position).add(_d);
    localWeapon.lookAt(_m);
    localWeapon.rotateY(Math.PI); // lookAt points +Z at the target; our muzzle is -Z
  }

  /** world-space muzzle position + barrel direction of a weapon mesh (or a fallback around the head) */
  function muzzleOf(mesh: THREE.Group | null, playerId: number, fallbackDir: THREE.Vector3, outPos: THREE.Vector3, outDir: THREE.Vector3): void {
    if (mesh && mesh.parent) {
      const mz = mesh.getObjectByName('muzzle');
      if (mz) {
        mesh.updateWorldMatrix(true, false);
        mz.getWorldPosition(outPos);
        mesh.getWorldQuaternion(_q);
        outDir.set(0, 0, -1).applyQuaternion(_q).normalize();
        // guard against a not-yet-posed rig (muzzle at the origin)
        if (outPos.lengthSq() > 1e-6 && isFinite(outPos.x)) return;
      }
    }
    const ch = character();
    let head: THREE.Vector3 | null = null;
    if (ch?.headPosition) head = ch.headPosition(playerId, _p);
    if (!head) {
      const s = playerId === st.local.id ? st.local.state : st.remotes.get(playerId)?.render;
      if (s) head = _p.set(s.x, s.y + HEAD_OFFSET, s.z);
      else head = _p.copy(ctx.camera.position);
    }
    outDir.copy(fallbackDir).normalize();
    _r.crossVectors(outDir, _u.set(0, 1, 0)).normalize();
    outPos.copy(head).addScaledVector(outDir, 0.55).addScaledVector(_r, 0.2).add(_u.set(0, -0.25, 0));
  }

  // ------------------------------------------------------------------ raycasts
  /** physics ray that steps past the local player's own capsule */
  function castWorld(origin: THREE.Vector3, dir: THREE.Vector3, max: number): { point: THREE.Vector3; normal: THREE.Vector3; dist: number; surface: string } | null {
    _castOrigin.copy(origin);
    let consumed = 0;
    const me = st.local.state;
    for (let i = 0; i < 4; i++) {
      const h = ctx.physics.raycast(_castOrigin, dir, max - consumed);
      if (!h) return null;
      const own = h.surface === 'player' && Math.hypot(h.point.x - me.x, h.point.z - me.z) < CAPSULE_R + 0.35 && h.point.y > me.y - 0.3 && h.point.y < me.y + CAPSULE_H + 0.3;
      if (!own) {
        h.dist += consumed;
        return h;
      }
      const step = h.dist < 0.01 ? 0.45 : h.dist + 0.05;
      _castOrigin.addScaledVector(dir, step);
      consumed += step;
    }
    return null;
  }

  /** nearest of world geometry and remote player capsules (rewound by nothing: we draw what we see) */
  function castShot(origin: THREE.Vector3, dir: THREE.Vector3, range: number, out: CastResult): CastResult {
    const h = castWorld(origin, dir, range);
    let tHit = h ? h.dist : range;
    out.victimId = 0;
    out.surface = h ? h.surface : 'none';
    if (h) {
      out.point.copy(h.point);
      out.normal.copy(h.normal);
    } else {
      out.point.copy(origin).addScaledVector(dir, range);
      out.normal.copy(dir).negate();
    }
    out.dist = tHit;
    const ch = character();
    for (const [id, r] of st.remotes) {
      const s = r.render;
      if (s.flags & StateFlag.Dead) continue;
      const wx = s.x - origin.x, wz = s.z - origin.z;
      const along = wx * dir.x + wz * dir.z;
      if (along < -CAPSULE_R || along > tHit + CAPSULE_R) continue;
      let hx = s.x, hy = s.y + CAPSULE_H - HEAD_R, hz = s.z;
      const head = ch?.headPosition?.(id, _p);
      if (head) (hx = head.x), (hy = head.y), (hz = head.z);
      let th = raySphere(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, hx, hy, hz, HEAD_R);
      if (th < 0) th = rayCapsule(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, s.x, s.y + CAPSULE_R, s.z, s.x, s.y + CAPSULE_H - CAPSULE_R, s.z, CAPSULE_R);
      if (th < 0 || th >= tHit) continue;
      tHit = th;
      out.victimId = id;
      out.surface = s.flags & StateFlag.Protected || safe.inSafeZone(s.x, s.z) ? 'protected' : 'player';
      out.point.copy(origin).addScaledVector(dir, th);
      out.normal.copy(dir).negate();
      out.dist = th;
    }
    return out;
  }
  const cast: CastResult = { point: new THREE.Vector3(), normal: new THREE.Vector3(), dist: 0, surface: 'none', victimId: 0 };

  /** shot origin (the local eye) and direction toward what the camera's crosshair is on, with spread applied */
  function aimRay(def: WeaponDef | null, outO: THREE.Vector3, outD: THREE.Vector3): void {
    const cam = ctx.camera;
    cam.getWorldDirection(_aimDirection);
    // Never let raycast scratch alias the outgoing origin/direction. The previous shared _o
    // overwrote the eye with camera position, causing server origin-clamping and near-target misses.
    const me = st.local.state;
    outO.set(me.x, me.y + 1.6, me.z);
    const target = castShot(cam.position, _aimDirection, 400, cast);
    const camToEye = cam.position.distanceTo(outO);
    if (target.surface !== 'none' && target.dist > camToEye + 0.4) _hit.copy(target.point);
    else if (target.surface !== 'none') _hit.copy(outO).addScaledVector(_aimDirection, 50);
    else _hit.copy(cam.position).addScaledVector(_aimDirection, 400);
    outD.subVectors(_hit, outO).normalize();
    if (outD.dot(_aimDirection) < 0.5) outD.copy(_aimDirection);
    const sp = def ? (def.pellets > 1 ? bloom : spreadNow(def)) : 0;
    if (sp > 0) scatterInCone(outD, (sp * Math.PI) / 180);
  }

  // ------------------------------------------------------------------ spread / recoil
  function spreadNow(def: WeaponDef | null): number {
    if (!def) return 0;
    const s = st.local.state;
    const base = def.spreadDeg + (def.aimSpreadDeg - def.spreadDeg) * aimK;
    const speed = Math.hypot(s.vx, s.vz);
    const moveK = clamp(speed / PLAYER_RUN_SPEED, 0, 1);
    let v = base * (1 + moveK * 0.9) + (s.flags & StateFlag.Airborne ? 2.5 : 0) + bloom;
    if (s.flags & StateFlag.Crouch) v *= 0.85;
    return v;
  }
  function isAiming(): boolean {
    return ctx.input.aim && !st.local.dead && !st.screenshotMode && st.local.inventory.current !== WeaponId.None && st.local.vehicleKey === null;
  }
  function kickCamera(def: WeaponDef): void {
    const f = FEEL[def.id];
    if (!f) return;
    const aimK = isAiming() ? 0.7 : 1;
    const crouchK = st.local.state.flags & StateFlag.Crouch ? 0.8 : 1;
    const k = (f.kick * (0.8 + Math.random() * 0.4) * aimK * crouchK * Math.PI) / 180;
    recoilP += k;
    recoilY += (Math.random() - 0.5) * k * f.side;
    recoilVP += k * 6;
    recoilK = f.K;
    recoilC = f.C;
    bloom = Math.min(4, bloom + f.bloom);
  }
  function integrateRecoil(dt: number): void {
    const K = recoilK, C = recoilC;
    const step = Math.min(dt, 1 / 30);
    recoilVP += (-K * recoilP - C * recoilVP) * step;
    recoilP += recoilVP * step;
    recoilVY += (-K * recoilY - C * recoilVY) * step;
    recoilY += recoilVY * step;
    if (Math.abs(recoilP) < 1e-5 && Math.abs(recoilVP) < 1e-4) recoilP = recoilVP = 0;
    if (Math.abs(recoilY) < 1e-5 && Math.abs(recoilVY) < 1e-4) recoilY = recoilVY = 0;
    bloom = Math.max(0, bloom * Math.exp(-dt * 3.2) - dt * 0.8);
  }

  // ------------------------------------------------------------------ firing
  function fireVisuals(shooterId: number, weaponId: number, mesh: THREE.Group | null, origin: THREE.Vector3, dir: THREE.Vector3, shotSeq: number, drawImpacts: boolean): void {
    const def = WEAPONS[weaponId];
    const f = FEEL[weaponId] ?? FEEL[WeaponId.Pistol];
    muzzleOf(mesh, shooterId, dir, _m, _b);
    const distCam = _m.distanceTo(ctx.camera.position);
    flashes.add(_m, _b, f.flash, distCam < 60 ? f.light : 0);
    if (distCam < 80) impacts.muzzleSmoke(_m, _b, f.smoke);
    if (distCam < 40) {
      const info = weaponInfo(weaponId);
      _r.crossVectors(_b, _u.set(0, 1, 0)).normalize();
      _u.crossVectors(_r, _b).normalize();
      const ej = mesh?.getObjectByName('eject');
      if (ej && mesh?.parent) ej.getWorldPosition(_p);
      else _p.copy(_m).addScaledVector(_b, -(info?.length ?? 0.4) * 0.6).addScaledVector(_r, 0.03);
      shells.eject(_p, _r, _u, _n.copy(_b).negate(), info?.shell ?? 'pistol');
    }
    const range = def?.range ?? 100;
    const pellets = def && def.pellets > 1 ? pelletDirections(shooterId, shotSeq, dir, def.spreadDeg, def.pellets, _pellets) : null;
    const rays = pellets ?? [dir];
    for (let i = 0; i < rays.length; i++) {
      castShot(origin, rays[i], range, cast);
      if (f.tracer > 0 && !pellets) tracers.add(_m, cast.point, f.tracer);
      if (drawImpacts && cast.surface !== 'none') {
        if (cast.surface === 'protected') shields.flash(cast.victimId);
        else if (cast.surface !== 'player') {
          impacts.hit(cast.surface, cast.point, cast.normal, rays[i], pellets ? 0.7 : 1);
          if (shooterId === st.local.id) {
            predictedImpacts.add(shotSeq);
            if (predictedImpacts.size > 64) predictedImpacts.delete(predictedImpacts.values().next().value!);
          }
        }
        _lastImpact.copy(cast.point);
        _lastSurface = cast.surface;
      }
    }
  }

  function fireLocal(def: WeaponDef, slot: { id: number; ammo: number; mag: number }): void {
    // Optional/lazy audio may still be warming after entry; it must not eat trigger input.
    if (!localWeapon || localWeaponId !== def.id) return;
    seq++;
    slot.mag--;
    lastShotAt = t;
    aimRay(def, _o, _d);
    ctx.net.send({ t: 'shoot', w: def.id, ox: _o.x, oy: _o.y, oz: _o.z, dx: _d.x, dy: _d.y, dz: _d.z, ct: performance.now() / 1000, seq });
    // firing ends spawn protection (server does the same)
    if (st.local.protectedUntil > st.serverTime()) st.local.protectedUntil = st.serverTime();
    kickCamera(def);
    firingUntil = t + 0.12;
    // raise / kick the gun in the hand before the visuals read the muzzle
    const pose = poses.get(localWeapon);
    if (pose) {
      pose.fire((FEEL[def.id] ?? FEEL[WeaponId.Pistol]).wk);
      pose.update(0, st.local.aimDir, isAiming(), 0, reloading ? t - reloadStart : -1);
    }
    fireVisuals(st.local.id, def.id, localWeapon, _o, _d, seq, true);
    character()?.playAction?.(st.local.id, 'fire');
    ctx.events.emit('localFire', def.id, _evPos.copy(_m), _evDir.copy(_d));
  }

  function startReload(): void {
    const def = currentDef();
    const slot = currentSlot();
    if (!def || !slot || reloading || st.local.dead) return;
    if (slot.mag >= def.magazine || slot.ammo <= 0) return;
    reloading = true;
    reloadStart = t;
    reloadEnd = t + def.reloadSeconds;
    ctx.net.send({ t: 'reload' });
    character()?.playAction?.(st.local.id, 'reload');
  }

  function switchTo(id: number): void {
    const inv = st.local.inventory;
    if (id !== WeaponId.None && !inv.weapons.some((w) => w.id === id)) return;
    if (inv.current === id) return;
    inv.current = id;
    st.local.state.weapon = id;
    reloading = false;
    bloom = 0;
    ctx.net.send({ t: 'switchWeapon', w: id });
    attachLocalWeapon(id);
  }

  function cycleWeapon(dirn: number): void {
    const inv = st.local.inventory;
    const order = [WeaponId.None, ...inv.weapons.map((w) => w.id).sort((a, b) => a - b)];
    if (order.length < 2) return;
    const i = Math.max(0, order.indexOf(inv.current));
    switchTo(order[(i + dirn + order.length) % order.length]);
  }

  function melee(): void {
    if (t - lastMelee < MELEE_COOLDOWN) return;
    lastMelee = t;
    const me = st.local.state;
    ctx.camera.getWorldDirection(_d);
    _d.y = 0;
    _d.normalize();
    let best = 0, bestD = Infinity;
    for (const [id, r] of st.remotes) {
      const s = r.render;
      const dx = s.x - me.x, dz = s.z - me.z;
      const d = Math.hypot(dx, dz);
      if (d > MELEE_RANGE + CAPSULE_R || Math.abs(s.y - me.y) > 1.5) continue;
      if ((dx * _d.x + dz * _d.z) / (d || 1) < 0.3) continue;
      if (d < bestD) (bestD = d), (best = id);
    }
    ctx.net.send({ t: 'melee', targetId: best, ct: performance.now() / 1000 });
    character()?.playAction?.(st.local.id, 'punch');
    firingUntil = t + 0.2;
  }

  // ------------------------------------------------------------------ server events
  const offs: (() => void)[] = [];
  offs.push(
    ctx.events.on('hit', (msg) => {
      if (msg.damage <= 0) {
        shields.flash(msg.victimId);
        if (msg.shooterId === st.local.id) hud.hitMarker('protected');
        return;
      }
      const at = _p.set(msg.x, msg.y, msg.z);
      const shooterPos = shooterPosition(msg.shooterId);
      const victimPos = playerPosition(msg.victimId);
      if (shooterPos && victimPos) _d.subVectors(victimPos, shooterPos).normalize();
      else _d.set(0, -0.3, -1).normalize();
      if (msg.shooterId === st.local.id) {
        hud.hitMarker(msg.headshot ? 'head' : 'hit');
        hud.damageNumber(msg.damage, msg.headshot, at);
        pendingKillMarker = true;
        impacts.blood(at, _d, msg.headshot ? 1.3 : 1);
      } else if (msg.victimId === st.local.id) {
        hud.damaged(shooterPos, msg.damage);
        impacts.blood(at, _d, 0.8);
      } else {
        impacts.blood(at, _d, 1);
      }
      if (msg.victimId !== st.local.id) character()?.playAction?.(msg.victimId, 'hitReact');
    }),
    ctx.events.on('miss', (msg) => {
      // Confirm walls even when their local collision/visual tile wasn't ready at fire time.
      // Cars/props already predicted a closer impact; don't draw a second one behind them.
      if (msg.shooterId === st.local.id && predictedImpacts.delete(msg.seq)) return;
      if (msg.surface === 'none') return;
      const at = _p.set(msg.x, msg.y, msg.z);
      const from = shooterPosition(msg.shooterId);
      if (from) _d.subVectors(at, from).normalize();
      else _d.set(0, -1, 0);
      // a normal: for the ground it's up; for buildings probe the collider just before the point
      if (msg.surface === 'ground') _n.set(0, 1, 0);
      else {
        _o.copy(at).addScaledVector(_d, -0.6);
        const h = ctx.physics.raycast(_o, _d, 1.2);
        if (h) _n.copy(h.normal);
        else _n.copy(_d).negate();
      }
      impacts.hit(msg.surface === 'ground' ? 'ground' : 'building', at, _n, _d, 1);
    }),
    ctx.events.on('death', (msg) => {
      if (msg.victimId === st.local.id) {
        reloading = false;
        bloom = 0;
        attachLocalWeapon(WeaponId.None);
        localWeaponId = -1;
      } else if (msg.killerId === st.local.id && pendingKillMarker) hud.hitMarker('kill');
      pendingKillMarker = false;
      if (msg.victimId !== st.local.id) {
        const rec = remoteWeapons.get(msg.victimId);
        if (rec?.mesh) {
          character()?.setWeaponMesh?.(msg.victimId, null);
          poses.delete(rec.mesh);
          rec.mesh.removeFromParent();
          rec.mesh = null;
          rec.weaponId = WeaponId.None;
        }
      }
    }),
    ctx.events.on('localRespawn', () => {
      reloading = false;
      bloom = 0;
      recoilP = recoilY = recoilVP = recoilVY = 0;
      localWeaponId = -1;
      attachLocalWeapon(st.local.inventory.current);
      // localRespawn is also a teleport/controller-sync event. It must not renew
      // protection or replay its welcome toast; only server respawns do that.
    }),
    ctx.events.on('remoteFire', (id, weapon, origin, dir) => {
      const rec = remoteWeapons.get(id);
      if (rec) {
        // edge from the snapshot: the continuous tracker below handles the cadence; force the first shot now
        rec.nextVisualShot = t;
      } else fireVisuals(id, weapon, null, origin, dir, 0, false);
    }),
    ctx.events.on('playerLeft', (id) => {
      const rec = remoteWeapons.get(id);
      if (rec?.mesh) {
        character()?.setWeaponMesh?.(id, null);
        poses.delete(rec.mesh);
        rec.mesh.removeFromParent();
      }
      remoteWeapons.delete(id);
    }),
    ctx.events.on('interact', () => {
      pickups.interact();
    }),
    ctx.net.onMessage((msg: ServerMessage) => {
      if (msg.t === 'welcome' || msg.t === 'respawned') { protectionToastShown = false; wasProtected = false; }
      if (msg.t === 'inventory') {
        // server-authoritative inventory arrived (pickup, reload done, rejected switch): resync the model
        if (msg.inventory.current !== localWeaponId && !st.local.dead) attachLocalWeapon(msg.inventory.current);
        if (reloading) {
          const slot = currentSlot();
          const def = currentDef();
          if (slot && def && slot.mag >= Math.min(def.magazine, slot.mag)) reloading = t < reloadEnd ? reloading : false;
        }
      }
    }),
  );

  function playerPosition(id: number): THREE.Vector3 | null {
    if (id === st.local.id) return _r.set(st.local.state.x, st.local.state.y + 1.2, st.local.state.z);
    const r = st.remotes.get(id);
    if (!r) return null;
    return _r.set(r.render.x, r.render.y + 1.2, r.render.z);
  }
  function shooterPosition(id: number): THREE.Vector3 | null {
    if (id === st.local.id) return _u.copy(st.local.eye);
    const r = st.remotes.get(id);
    if (!r) return null;
    return _u.set(r.render.x, r.render.y + HEAD_OFFSET, r.render.z);
  }

  /** remote players: pose their gun toward where they look and keep firing visuals going while their Firing flag is up */
  function updateRemoteFire(dt: number): void {
    for (const [id, rec] of remoteWeapons) {
      const r = st.remotes.get(id);
      if (!r) continue;
      const s = r.render;
      const firing = (s.flags & StateFlag.Firing) !== 0 && !(s.flags & StateFlag.Dead) && s.weapon !== WeaponId.None;
      if (firing && !rec.lastFiring) {
        rec.firingSince = t;
        rec.nextVisualShot = Math.min(rec.nextVisualShot, t);
      }
      rec.lastFiring = firing;
      const cp = Math.cos(s.pitch);
      _d.set(-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp).normalize();
      const pose = rec.mesh ? poses.get(rec.mesh) : undefined;
      pose?.update(dt, _d, (s.flags & StateFlag.Aiming) !== 0, t - rec.lastShot, -1);
      if (!firing) continue;
      const def = WEAPONS[s.weapon];
      if (!def) continue;
      if (t < rec.nextVisualShot) continue;
      const interval = def.automatic ? 60 / def.roundsPerMinute : Math.max(60 / def.roundsPerMinute, 0.33);
      rec.nextVisualShot = t + interval;
      // only if within visual range
      if (Math.hypot(s.x - ctx.camera.position.x, s.z - ctx.camera.position.z) > 160) continue;
      rec.lastShot = t;
      if (pose) {
        pose.fire((FEEL[s.weapon] ?? FEEL[WeaponId.Pistol]).wk);
        pose.update(0, _d, (s.flags & StateFlag.Aiming) !== 0, 0, -1);
      }
      _o.set(s.x, s.y + HEAD_OFFSET, s.z);
      fireVisuals(id, s.weapon, rec.mesh, _o, _d, 0, false);
    }
  }

  // ------------------------------------------------------------------ spawn protection
  function updateProtection(): void {
    const left = st.local.protectedUntil - st.serverTime();
    const prot = left > 0 && !st.local.dead;
    if (prot) st.local.state.flags |= StateFlag.Protected;
    else st.local.state.flags &= ~StateFlag.Protected;
    if (prot && !protectionToastShown && st.welcomed && left > 3) {
      protectionToastShown = true;
      ui()?.toast?.(`Spawn protection: ${fmtClock(left)} — ends when you fire`, 'info');
    }
    if (wasProtected && !prot && st.welcomed && !st.local.dead) ui()?.toast?.('Spawn protection ended', 'warn');
    wasProtected = prot;
  }

  // ------------------------------------------------------------------ debug hooks (tests + screenshots)
  const w = window as any;
  w.__debug = w.__debug || {};
  w.__debug.pickups = () => Array.from(st.pickups.values());
  let showcase: THREE.Group | null = null;
  let showcasing = false;
  const dbg = {
    status: () => ({ initialization: { ...initStats }, weapon: localWeaponId, inv: st.local.inventory, reloading, seq, bloom: +bloom.toFixed(2), spread: +spreadNow(currentDef()).toFixed(2), safe: inSafe(), protected: +Math.max(0, st.local.protectedUntil - st.serverTime()).toFixed(1), pickups: pickups.count(), remotes: Array.from(remoteWeapons.entries()).map(([id, r]) => ({ id, weapon: r.weaponId })), health: st.local.state.health, dead: st.local.dead }),
    pickups: () => Array.from(st.pickups.values()),
    /** fire the current weapon regardless of input (test harness) */
    fire: () => {
      const def = currentDef();
      const slot = currentSlot();
      if (!def || !slot || slot.mag <= 0 || inSafe() || st.local.dead || localWeaponId !== def.id || !localWeapon) return false;
      fireLocal(def, slot);
      return true;
    },
    /** purely visual shot from the camera along its forward vector (screenshots) */
    demoShot: (weapon = WeaponId.Rifle, impact = true) => {
      ctx.camera.getWorldDirection(_d);
      _o.copy(ctx.camera.position).addScaledVector(_d, 0.9);
      _r.crossVectors(_d, _u.set(0, 1, 0)).normalize();
      _o.addScaledVector(_r, 0.32).add(_u.set(0, -0.28, 0));
      const def = WEAPONS[weapon];
      const f = FEEL[weapon] ?? FEEL[WeaponId.Rifle];
      flashes.add(_o, _d, f.flash, f.light);
      impacts.muzzleSmoke(_o, _d, f.smoke);
      _b.crossVectors(_r, _d).normalize();
      shells.eject(_p.copy(_o).addScaledVector(_d, -0.25), _r, _b, _n.copy(_d).negate(), weaponInfo(weapon)?.shell ?? 'rifle');
      castShot(_o, _d, def?.range ?? 200, cast);
      tracers.add(_o, cast.point, 1);
      if (impact && cast.surface !== 'none') impacts.hit(cast.surface, cast.point, cast.normal, _d, 1);
      return { surface: cast.surface, dist: +cast.dist.toFixed(2) };
    },
    /** place the four weapons + medkit + vest in front of the camera for inspection */
    showcase: async (dist = 1.4) => {
      await Promise.all([WeaponId.Pistol, WeaponId.SMG, WeaponId.Shotgun, WeaponId.Rifle].map(id => prepareWeapon(ctx, id)));
      if (disposed) return {};
      if (showcase) {
        showcase.removeFromParent();
        showcase = null;
      }
      showcase = new THREE.Group();
      showcase.name = 'combat-showcase';
      ctx.camera.getWorldDirection(_d);
      _r.crossVectors(_d, _u.set(0, 1, 0)).normalize();
      _u.crossVectors(_r, _d).normalize();
      const ids = [WeaponId.Pistol, WeaponId.SMG, WeaponId.Shotgun, WeaponId.Rifle];
      const tris: Record<string, number> = {};
      ids.forEach((id, i) => {
        const m = buildWeaponMesh(ctx, id);
        if (!m) return;
        const info = weaponInfo(id)!;
        tris[WEAPONS[id].name] = info.tris;
        const x = (i - 1.5) * 0.36;
        m.position.copy(ctx.camera.position).addScaledVector(_d, dist + Math.abs(x) * 0.15).addScaledVector(_r, x).addScaledVector(_u, -0.08 + (i % 2) * 0.1);
        // muzzle to the camera's left, seen from the side, slightly turned toward the viewer
        m.quaternion.copy(ctx.camera.quaternion);
        m.rotateY(Math.PI / 2 + 0.35);
        m.rotateX(0.15);
        m.position.addScaledVector(_r, info.length * 0.15);
        showcase!.add(m);
      });
      ctx.worldGroup.add(showcase);
      return tris;
    },
    demoPickup: (kind: 'weapon' | 'health' | 'armor' = 'weapon', weapon = WeaponId.Rifle, dist = 3) => {
      ctx.camera.getWorldDirection(_d);
      _d.y = 0;
      _d.normalize();
      const x = ctx.camera.position.x + _d.x * dist, z = ctx.camera.position.z + _d.z * dist;
      const id = 9000 + st.pickups.size;
      st.pickups.set(id, { id, kind, weapon: kind === 'weapon' ? weapon : undefined, x, y: 0, z });
      return id;
    },
    fx: { particles, decals, tracers, flashes, shells },
    lastImpact: () => ({ surface: _lastSurface, x: _lastImpact.x, y: _lastImpact.y, z: _lastImpact.z }),
  };
  w.__combat = dbg;
  const paramCombat = new URLSearchParams(location.search).get('combat');

  // ------------------------------------------------------------------ module
  const mod: CombatModule = {
    name: 'combat',
    update(dt, now) {
      t = now;
      const inp = ctx.input;
      const local = st.local;
      const s = local.state;
      integrateRecoil(dt);
      particles.update(t);
      decals.update(t);
      impacts.update(t);
      shells.update(dt, t);
      pickups.update(dt, t);
      safe.update(dt, t);
      updateProtection();
      shields.update(dt);
      syncRemoteWeapons();
      updateRemoteFire(dt);

      // local weapon model follows the inventory (server may change it under us)
      if (!local.dead && local.inventory.current !== localWeaponId) attachLocalWeapon(local.inventory.current);
      placeFallbackLocalWeapon();
      aimK += ((isAiming() ? 1 : 0) - aimK) * (1 - Math.exp(-dt * 14));
      if (localWeapon) poses.get(localWeapon)?.update(dt, local.aimDir, isAiming(), t - lastShotAt, reloading ? t - reloadStart : -1);

      if (paramCombat === 'showcase' && !showcase && !showcasing && (w.__ready || st.screenshotMode)) {
        showcasing = true;
        void dbg.showcase().catch(error => console.warn('[combat] showcase failed', error));
      }

      if (st.screenshotMode || !st.welcomed) return;

      // input: switching / reload
      if (inp.weaponSlot) switchTo(inp.weaponSlot);
      if (inp.nextWeapon) cycleWeapon(inp.nextWeapon);
      if (inp.reload) startReload();
      if (reloading && t >= reloadEnd) {
        reloading = false;
        const def = currentDef();
        const slot = currentSlot();
        if (def && slot) {
          const take = Math.min(def.magazine - slot.mag, slot.ammo);
          if (take > 0) {
            slot.mag += take;
            slot.ammo -= take;
          }
        }
      }

      // firing
      const canAct = !local.dead && local.vehicleKey === null;
      const def = currentDef();
      const slot = currentSlot();
      if (t < firingUntil) s.flags |= StateFlag.Firing;
      if (def && slot && canAct && localWeaponId === def.id && localWeapon) {
        if (inp.firePressed) queuedPressAt = t;
        const wantFire = (def.automatic && inp.fire) || inp.firePressed || t - queuedPressAt < 0.16;
        if (wantFire && !reloading) {
          if (inSafe()) {
            safe.refuse();
            queuedPressAt = -10;
          } else if (slot.mag <= 0) {
            queuedPressAt = -10;
            if (slot.ammo > 0) startReload();
          } else if (t >= nextShotAt) {
            const interval = 60 / def.roundsPerMinute;
            nextShotAt = Math.max(nextShotAt + interval, t + interval * 0.85);
            queuedPressAt = -10;
            fireLocal(def, slot);
          }
        }
      } else if (!def && canAct && inp.firePressed) {
        if (inSafe()) safe.refuse();
        else melee();
      }
    },
    preRender() {
      // camera recoil on top of whatever the character module set (never in screenshot mode: core owns it)
      if (!st.screenshotMode && (recoilP !== 0 || recoilY !== 0)) {
        const cam = ctx.camera;
        cam.rotation.x += recoilP;
        cam.rotation.y += recoilY;
      }
      tracers.update(t, ctx.camera.position);
      flashes.update(t, ctx.camera.position);
      hud.update(t);
    },
    spreadDeg: () => spreadNow(currentDef()),
    aiming: () => isAiming() || (t - lastShotAt < 1.2 && !st.local.dead && !st.screenshotMode && st.local.vehicleKey === null && st.local.inventory.current !== WeaponId.None),
    lowHealthPulse: () => hud.pulse(),
    weaponStatus() {
      const def = currentDef();
      const slot = currentSlot();
      if (!def || !slot) return null;
      return { name: def.name, id: def.id, mag: slot.mag, ammo: slot.ammo, reloading };
    },
    protectedSeconds: () => Math.max(0, st.local.protectedUntil - st.serverTime()),
    inSafeZone: inSafe,
    interactPickup: () => pickups.interact(),
    dispose() {
      disposed = true;
      for (const off of offs) off();
      attachLocalWeapon(WeaponId.None);
      for (const [id, rec] of remoteWeapons) {
        if (rec.mesh) {
          character()?.setWeaponMesh?.(id, null);
          poses.delete(rec.mesh);
          rec.mesh.removeFromParent();
        }
      }
      remoteWeapons.clear();
      poses.clear();
      showcase?.removeFromParent();
      particles.dispose();
      decals.dispose();
      tracers.dispose();
      flashes.dispose();
      shells.dispose();
      hud.dispose();
      pickups.dispose();
      safe.dispose();
      shields.dispose();
      fxGroup.removeFromParent();
      fallbackRig.removeFromParent();
      disposeWeaponGeometries();
      disposeWeaponMaterial();
      disposeWeaponTextures();
      delete w.__combat;
    },
  };
  attachLocalWeapon(st.local.inventory.current);
  return mod;
}
