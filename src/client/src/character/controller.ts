/**
 * Local player movement: Rapier KinematicCharacterController on a capsule (r 0.35, h 1.8; crouch 1.25),
 * autostep 0.4 m, snap-to-ground, 50° slopes (core's createCharacterController), acceleration /
 * deceleration curves, turn rate, jump with anticipation, landing squat, crouch. Writes ctx.state.local.state.
 */
import * as THREE from 'three';
import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import { AnimId, StateFlag } from '@shared/protocol';
import { PLAYER_HEIGHT, PLAYER_RADIUS, PLAYER_RUN_SPEED, PLAYER_WALK_SPEED } from '@shared/constants';
import type { GameContext } from '@/core/context';
import type { PhysicsWorldImpl } from '@/core/physics';
import type { CharacterInstance, WeaponKind } from './animator';
import type { ClipName } from './clips';
import { openSpawnYaw } from './camera';

export const SPRINT_SPEED = 7.5;
const CROUCH_SPEED = 1.35;
const JUMP_SPEED = 4.0;
const JUMP_DELAY = 0.1; // anticipation before leaving the ground
const GRAVITY = 9.81;
const CROUCH_HEIGHT = 1.25;
const ACCEL_TAU = 0.16;
const DECEL_TAU = 0.13;
const TURN_TAU = 0.075;

export interface ControllerFrame {
  camYaw: number;
  camPitch: number;
  aiming: boolean;
  weapon: WeaponKind;
}

export class LocalController {
  body: RigidBody;
  collider: Collider;
  cc: KinematicCharacterController;
  private phys: PhysicsWorldImpl;
  private vel = new THREE.Vector3(); // horizontal velocity (world)
  private vy = 0;
  grounded = true;
  crouching = false;
  private airTime = 0;
  private jumpPending = -1;
  private landTimer = -1;
  private landDeep = false;
  yaw = 0;
  speed = 0;
  private wantDir = new THREE.Vector3();
  private desired = { x: 0, y: 0, z: 0 };
  private pendingSync = true;
  private spawnFacingPending = true;
  private capsuleHalf = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;
  private height = PLAYER_HEIGHT;
  private lastGroundY = 0;
  animState: ClipName = 'idle';
  sprinting = false;
  private tmpO = new THREE.Vector3();
  private tmpD = new THREE.Vector3(0, 1, 0);

  constructor(private ctx: GameContext, private inst: CharacterInstance) {
    this.phys = ctx.physics as unknown as PhysicsWorldImpl;
    const R = this.phys.RAPIER;
    const s = ctx.state.local.state;
    this.body = this.phys.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(s.x, s.y + PLAYER_HEIGHT / 2, s.z).setUserData({ surface: 'player', local: true }));
    this.collider = this.phys.world.createCollider(R.ColliderDesc.capsule(this.capsuleHalf, PLAYER_RADIUS).setFriction(0), this.body);
    this.phys.tagCollider(this.collider, 'player');
    this.cc = this.phys.createCharacterController(0.05);
    this.yaw = s.yaw;
  }

  /** re-place the capsule from ctx.state.local.state (spawn / respawn / teleport) */
  sync(): void {
    this.pendingSync = true;
    this.spawnFacingPending = true;
  }

  private place(x: number, y: number, z: number): void {
    this.body.setNextKinematicTranslation({ x, y, z });
    this.body.setTranslation({ x, y, z }, true);
    this.phys.world.propagateModifiedBodyPositionsToColliders();
  }

  private applySync(): void {
    const s = this.ctx.state.local.state;
    this.place(s.x, s.y + this.height / 2 + 0.1, s.z);
    this.vy = 0;
    this.vel.set(0, 0, 0);
    this.yaw = s.yaw;
    this.grounded = true;
    this.airTime = 0;
    this.jumpPending = -1;
    this.landTimer = -1;
    this.setCrouch(false);
    this.animState = 'idle';
  }

  private setCrouch(on: boolean): void {
    if (on === this.crouching) return;
    this.crouching = on;
    const t = this.body.translation();
    const feet = t.y - (this.capsuleHalf + PLAYER_RADIUS);
    this.height = on ? CROUCH_HEIGHT : PLAYER_HEIGHT;
    this.capsuleHalf = this.height / 2 - PLAYER_RADIUS;
    this.collider.setHalfHeight(this.capsuleHalf);
    this.place(t.x, feet + this.capsuleHalf + PLAYER_RADIUS, t.z);
  }

  /** feet position */
  feet(out: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return out.set(t.x, t.y - (this.capsuleHalf + PLAYER_RADIUS), t.z);
  }

  update(dt: number, f: ControllerFrame): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const s = st.local.state;
    const inp = ctx.input;
    if (this.pendingSync) {
      this.pendingSync = false;
      this.applySync();
    }
    // Decoded tiles alone are not enough: building/prop workers must have committed colliders.
    if (this.spawnFacingPending && ctx.world.ready && !(ctx.busy ?? 0) && !st.screenshotMode) {
      this.yaw = s.yaw = openSpawnYaw(this.phys, s, this.body);
      this.spawnFacingPending = false;
    }
    const screenshot = st.screenshotMode;
    const dead = st.local.dead;
    const inputOk = !screenshot && !dead;

    if (screenshot) {
      // core owns the position in screenshot mode; keep the capsule where the state says
      this.place(s.x, s.y + this.height / 2, s.z);
      this.yaw = s.yaw;
      this.speed = 0;
      this.vel.set(0, 0, 0);
      this.animState = 'idle';
      return;
    }

    // ---- crouch ----
    if (inputOk && this.grounded) {
      if (inp.crouch && !this.crouching) this.setCrouch(true);
      else if (!inp.crouch && this.crouching) {
        // headroom check: 0.6 m above the standing capsule top
        const t = this.body.translation();
        this.tmpO.set(t.x, t.y + this.capsuleHalf, t.z);
        const hit = this.phys.raycastExcluding(this.tmpO, this.tmpD, PLAYER_HEIGHT - CROUCH_HEIGHT + 0.1, this.body);
        if (!hit) this.setCrouch(false);
      }
    }

    // ---- desired movement ----
    const mx = inputOk ? inp.move.x : 0;
    const my = inputOk ? inp.move.y : 0;
    const mag = Math.min(1, Math.hypot(mx, my));
    const moving = mag > 0.05;
    const landing = this.landTimer >= 0 && this.landDeep;
    const sprintWanted = inputOk && inp.sprint && my > 0.2 && !this.crouching && !f.aiming && !landing;
    let targetSpeed = 0;
    if (moving) {
      if (this.crouching) targetSpeed = CROUCH_SPEED;
      else if (f.aiming) targetSpeed = PLAYER_WALK_SPEED;
      else if (sprintWanted) targetSpeed = SPRINT_SPEED;
      else if (mag < 0.45) targetSpeed = PLAYER_WALK_SPEED; // gamepad stick: gentle push walks
      else targetSpeed = PLAYER_RUN_SPEED;
      if (landing) targetSpeed = Math.min(targetSpeed, PLAYER_WALK_SPEED);
    }
    this.sprinting = sprintWanted && moving;
    // camera-relative direction (forward = -z rotated by yaw; right = +x rotated by yaw)
    const sy = Math.sin(f.camYaw), cy = Math.cos(f.camYaw);
    this.wantDir.set(-sy * my + cy * mx, 0, -cy * my - sy * mx);
    if (this.wantDir.lengthSq() > 1e-6) this.wantDir.normalize();

    // ---- velocity curves ----
    const targetVx = this.wantDir.x * targetSpeed, targetVz = this.wantDir.z * targetSpeed;
    const curSpeed = this.vel.length();
    const speedingUp = targetSpeed > curSpeed + 0.01;
    const tau = speedingUp ? ACCEL_TAU : DECEL_TAU;
    const k = 1 - Math.exp(-dt / (this.grounded ? tau : tau * 3));
    this.vel.x += (targetVx - this.vel.x) * k;
    this.vel.z += (targetVz - this.vel.z) * k;
    if (!moving && this.vel.lengthSq() < 0.01) this.vel.set(0, 0, 0);
    this.speed = this.vel.length();

    // ---- facing ----
    let targetYaw = this.yaw;
    if (f.aiming && inputOk) targetYaw = f.camYaw;
    else if (this.speed > 0.35) targetYaw = Math.atan2(-this.vel.x, -this.vel.z);
    this.yaw = lerpAngle(this.yaw, targetYaw, 1 - Math.exp(-dt / (f.aiming ? 0.04 : TURN_TAU)));

    // ---- jump / gravity ----
    if (inputOk && inp.jump && this.grounded && !this.crouching && this.jumpPending < 0 && this.landTimer < 0) {
      this.jumpPending = 0;
      this.inst.play('jumpStart', 0.06, true);
    }
    if (this.jumpPending >= 0) {
      this.jumpPending += dt;
      if (this.jumpPending >= JUMP_DELAY) {
        this.jumpPending = -1;
        this.vy = JUMP_SPEED;
        this.grounded = false;
      }
    }
    if (this.grounded && this.vy < 0) this.vy = 0;
    this.vy -= GRAVITY * dt;
    if (this.vy < -40) this.vy = -40;

    // ---- physics move ----
    this.desired.x = (dead ? 0 : this.vel.x) * dt;
    this.desired.y = this.vy * dt;
    this.desired.z = (dead ? 0 : this.vel.z) * dt;
    this.cc.computeColliderMovement(this.collider, this.desired, undefined, undefined, (c) => c.handle !== this.collider.handle);
    const mv = this.cc.computedMovement();
    const t = this.body.translation();
    let nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    const wasGrounded = this.grounded;
    this.grounded = this.cc.computedGrounded() && this.jumpPending < 0 && this.vy <= 0.01;
    if (this.vy > 0.01) this.grounded = false;
    // last-resort ground clamp
    const half = this.capsuleHalf + PLAYER_RADIUS;
    const g = this.phys.groundHeight(nx, nz);
    if (ny - half < g - 0.3) {
      ny = g + half + 0.02;
      this.vy = 0;
      this.grounded = true;
    }
    this.place(nx, ny, nz);
    if (this.grounded) {
      if (!wasGrounded) {
        // landing
        const hard = this.airTime > 0.35 || this.vy < -4;
        this.landTimer = 0;
        this.landDeep = hard;
        if (hard) this.inst.play('land', 0.05, true);
      }
      this.airTime = 0;
      if (this.vy < 0) this.vy = 0;
      this.lastGroundY = ny - half;
    } else this.airTime += dt;
    if (this.landTimer >= 0) {
      this.landTimer += dt;
      if (this.landTimer > (this.landDeep ? 0.36 : 0.12)) this.landTimer = -1;
    }
    // wall bump: kill velocity into walls so the run animation does not keep going against a wall
    const movedX = mv.x, movedZ = mv.z;
    const wantX = this.desired.x, wantZ = this.desired.z;
    const wantLen = Math.hypot(wantX, wantZ);
    if (wantLen > 1e-4) {
      const gotLen = (movedX * wantX + movedZ * wantZ) / wantLen;
      if (gotLen < wantLen * 0.35) {
        this.vel.multiplyScalar(0.6);
        this.speed = this.vel.length();
      }
    }

    // ---- write state ----
    const p = this.body.translation();
    const feetY = p.y - half;
    const inv = 1 / Math.max(dt, 1e-4);
    s.vx = (p.x - s.x) * inv;
    s.vy = (feetY - s.y) * inv;
    s.vz = (p.z - s.z) * inv;
    s.x = p.x;
    s.y = feetY;
    s.z = p.z;
    s.yaw = this.yaw;
    s.pitch = f.camPitch;
    s.roll = 0;
    s.vehicleId = 0;
    let flags = s.flags & (StateFlag.Protected | StateFlag.Dead);
    if (this.sprinting) flags |= StateFlag.Sprint;
    if (this.crouching) flags |= StateFlag.Crouch;
    if (f.aiming && inputOk) flags |= StateFlag.Aiming;
    if (inputOk && inp.fire) flags |= StateFlag.Firing;
    if (!this.grounded) flags |= StateFlag.Airborne;
    s.flags = flags;

    // ---- animation state ----
    let anim: ClipName;
    if (dead) anim = 'death';
    else if (this.jumpPending >= 0) anim = 'jumpStart';
    else if (!this.grounded) anim = this.vy > -0.5 && this.airTime < 0.9 ? 'jumpLoop' : 'fall';
    else if (this.landTimer >= 0 && this.landDeep) anim = 'land';
    else if (this.crouching) anim = this.speed > 0.25 ? 'crouchWalk' : 'crouchIdle';
    else if (this.speed > 0.3) anim = this.speed > 6.6 ? 'sprint' : this.speed > 3.4 ? 'run' : 'walk';
    else anim = 'idle';
    this.animState = anim;
    s.anim = toAnimId(anim, f.aiming && inputOk);
  }

  dispose(): void {
    try {
      this.phys.world.removeCharacterController(this.cc);
      this.phys.world.removeCollider(this.collider, false);
      this.phys.world.removeRigidBody(this.body);
    } catch {
      /* already gone */
    }
  }
}

export function toAnimId(state: ClipName, aiming: boolean): AnimId {
  switch (state) {
    case 'idle':
      return aiming ? AnimId.AimIdle : AnimId.Idle;
    case 'walk':
      return aiming ? AnimId.AimWalk : AnimId.Walk;
    case 'run':
      return AnimId.Run;
    case 'sprint':
      return AnimId.Sprint;
    case 'jumpStart':
    case 'jumpLoop':
      return AnimId.Jump;
    case 'fall':
    case 'land':
      return AnimId.Fall;
    case 'crouchIdle':
      return AnimId.CrouchIdle;
    case 'crouchWalk':
      return AnimId.CrouchWalk;
    case 'death':
      return AnimId.Death;
    case 'drive':
      return AnimId.DriveIdle;
  }
  return AnimId.Idle;
}

export function fromAnimId(id: number, speed: number, airborne: boolean, vy: number): ClipName {
  switch (id) {
    case AnimId.Idle:
    case AnimId.AimIdle:
    case AnimId.Fire:
    case AnimId.Reload:
    case AnimId.Punch:
      return speed > 0.4 ? (speed > 3.4 ? 'run' : 'walk') : 'idle';
    case AnimId.Walk:
    case AnimId.AimWalk:
      return speed < 0.25 ? 'idle' : 'walk';
    case AnimId.Run:
      return speed < 0.25 ? 'idle' : 'run';
    case AnimId.Sprint:
      return speed < 0.25 ? 'idle' : 'sprint';
    case AnimId.Jump:
      return vy > -0.5 ? 'jumpLoop' : 'fall';
    case AnimId.Fall:
      return airborne ? 'fall' : 'land';
    case AnimId.CrouchIdle:
      return 'crouchIdle';
    case AnimId.CrouchWalk:
      return speed < 0.2 ? 'crouchIdle' : 'crouchWalk';
    case AnimId.Death:
      return 'death';
    case AnimId.DriveIdle:
      return 'drive';
  }
  return 'idle';
}

export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
