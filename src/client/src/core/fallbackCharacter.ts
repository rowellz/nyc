/**
 * Minimal local player controller used ONLY when the character module is missing (Stage A).
 * Kinematic capsule (Rapier character controller) that walks/runs/jumps with WASD on the ground and
 * collides with whatever colliders exist; invisible; third-person follow camera driven by mouse look.
 * Writes state.local.state / eye / aimDir like the real character module will.
 */
import * as THREE from 'three';
import { AnimId, StateFlag } from '@shared/protocol';
import { PLAYER_HEIGHT, PLAYER_RADIUS, PLAYER_RUN_SPEED, PLAYER_WALK_SPEED } from '@shared/constants';
import type { GameContext, GameModule } from './context';
import type { PhysicsWorldImpl } from './physics';

const EYE = 1.62;
const SPRINT_SPEED = PLAYER_RUN_SPEED;
const JUMP_SPEED = 4.6;
const GRAVITY = 9.81;
const CAM_DIST = 3.6;
const CAM_HEIGHT = 1.9;

export function createFallbackCharacter(ctx: GameContext): GameModule {
  const phys = ctx.physics as unknown as PhysicsWorldImpl;
  const R = phys.RAPIER;
  const st = ctx.state;
  const s = st.local.state;
  const halfH = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;
  const body = phys.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(s.x, s.y + PLAYER_HEIGHT / 2, s.z).setUserData({ surface: 'player', local: true }));
  const collider = phys.world.createCollider(R.ColliderDesc.capsule(halfH, PLAYER_RADIUS).setFriction(0), body);
  phys.tagCollider(collider, 'player');
  const cc = phys.createCharacterController(0.05);

  let vy = 0;
  let grounded = true;
  let camYaw = s.yaw; // orbit yaw == facing yaw (camera behind the player)
  let camPitch = -0.12;
  const moveWorld = new THREE.Vector3();
  const desired = { x: 0, y: 0, z: 0 };
  const camPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const rayO = new THREE.Vector3();
  const rayD = new THREE.Vector3();
  let lastWasSprint = false;
  let respawnPending = true;

  const offRespawn = ctx.events.on('localRespawn', () => {
    respawnPending = true;
  });

  function placeBody(x: number, y: number, z: number): void {
    body.setNextKinematicTranslation({ x, y, z });
    body.setTranslation({ x, y, z }, true);
    // the collider's cached position is what the character controller queries; keep it current between physics steps
    phys.world.propagateModifiedBodyPositionsToColliders();
  }
  function syncBodyFromState(): void {
    // start a hair above the ground so the controller settles at its offset instead of starting penetrated
    placeBody(s.x, s.y + PLAYER_HEIGHT / 2 + 0.1, s.z);
    vy = 0;
    camYaw = s.yaw;
  }

  return {
    name: 'character',
    update(dt) {
      if (respawnPending) {
        respawnPending = false;
        syncBodyFromState();
      }
      const inp = ctx.input;
      const screenshot = st.screenshotMode;

      if (!screenshot) {
        // mouse look: yaw right = negative yaw (geo.ts: +yaw is counter-clockwise from above)
        camYaw -= inp.look.dx * 0.0022;
        camPitch = THREE.MathUtils.clamp(camPitch - inp.look.dy * 0.0022, -1.2, 0.9);
      }

      // movement in camera space -> world
      const mx = screenshot ? 0 : inp.move.x;
      const my = screenshot ? 0 : inp.move.y;
      const moving = (mx !== 0 || my !== 0) && !st.local.dead;
      const sprint = inp.sprint && my > 0;
      const speed = sprint ? SPRINT_SPEED : inp.crouch ? PLAYER_WALK_SPEED * 0.6 : moving && !inp.sprint ? PLAYER_WALK_SPEED * 1.6 : PLAYER_WALK_SPEED;
      // forward = -z rotated by yaw; right = +x rotated by yaw
      const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
      const fwdX = -sy, fwdZ = -cy;
      const rightX = cy, rightZ = -sy;
      moveWorld.set(fwdX * my + rightX * mx, 0, fwdZ * my + rightZ * mx);
      if (moveWorld.lengthSq() > 1) moveWorld.normalize();
      moveWorld.multiplyScalar(moving ? speed : 0);

      // vertical
      if (grounded) {
        vy = 0;
        if (!screenshot && inp.jump && !st.local.dead) {
          vy = JUMP_SPEED;
          grounded = false;
        }
      }
      vy -= GRAVITY * dt;
      if (vy < -50) vy = -50;

      desired.x = moveWorld.x * dt;
      desired.y = vy * dt;
      desired.z = moveWorld.z * dt;
      cc.computeColliderMovement(collider, desired, undefined, undefined, (c) => c.handle !== collider.handle);
      const mv = cc.computedMovement();
      const t = body.translation();
      const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
      placeBody(nx, ny, nz);
      grounded = cc.computedGrounded();
      if (grounded && vy < 0) vy = 0;
      // never fall through the world: clamp to the analytic ground (decks/y=0) as a last resort
      const feetY = ny - PLAYER_HEIGHT / 2;
      const g = phys.groundHeight(nx, nz);
      if (feetY < g - 0.5) {
        placeBody(nx, g + PLAYER_HEIGHT / 2 + 0.05, nz);
        vy = 0;
        grounded = true;
      }
      const p = body.translation();
      s.vx = (p.x - s.x) / Math.max(dt, 1e-4);
      s.vy = (p.y - PLAYER_HEIGHT / 2 - s.y) / Math.max(dt, 1e-4);
      s.vz = (p.z - s.z) / Math.max(dt, 1e-4);
      s.x = p.x;
      s.y = p.y - PLAYER_HEIGHT / 2;
      s.z = p.z;
      if (moving) s.yaw = Math.atan2(-moveWorld.x, -moveWorld.z);
      else if (!screenshot && inp.aim) s.yaw = camYaw;
      s.pitch = camPitch;
      let flags = s.flags & (StateFlag.Protected | StateFlag.Dead);
      if (sprint) flags |= StateFlag.Sprint;
      if (inp.crouch) flags |= StateFlag.Crouch;
      if (inp.aim) flags |= StateFlag.Aiming;
      if (inp.fire) flags |= StateFlag.Firing;
      if (!grounded) flags |= StateFlag.Airborne;
      s.flags = flags;
      s.anim = !grounded ? (vy > 0 ? AnimId.Jump : AnimId.Fall) : moving ? (sprint ? AnimId.Sprint : inp.crouch ? AnimId.CrouchWalk : speed > PLAYER_WALK_SPEED ? AnimId.Run : AnimId.Walk) : inp.crouch ? AnimId.CrouchIdle : inp.aim ? AnimId.AimIdle : AnimId.Idle;
      lastWasSprint = sprint;
      void lastWasSprint;

      // eye + aim
      st.local.eye.set(s.x, s.y + (inp.crouch ? EYE * 0.7 : EYE), s.z);
      if (!screenshot) {
        const cp = Math.cos(camPitch);
        st.local.aimDir.set(-Math.sin(camYaw) * cp, Math.sin(camPitch), -Math.cos(camYaw) * cp);
      }

      if (inp.interact) ctx.events.emit('interact');
    },
    preRender() {
      if (st.screenshotMode) return;
      // third-person camera: behind and above the player, pulled in by walls
      const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
      lookAt.set(s.x, s.y + CAM_HEIGHT - 0.4, s.z);
      rayD.set(Math.sin(camYaw) * cp, -sp, Math.cos(camYaw) * cp); // behind the player
      rayO.copy(lookAt);
      let dist = CAM_DIST;
      const hit = phys.raycastExcluding(rayO, rayD, CAM_DIST + 0.3, body);
      if (hit && hit.dist < dist + 0.3) dist = Math.max(0.5, hit.dist - 0.3);
      camPos.copy(lookAt).addScaledVector(rayD, dist);
      const minY = phys.groundHeight(camPos.x, camPos.z) + 0.3;
      if (camPos.y < minY) camPos.y = minY;
      ctx.camera.position.lerp(camPos, 1 - Math.pow(0.001, 1 / 60));
      ctx.camera.lookAt(lookAt);
    },
    dispose() {
      offRespawn();
      phys.world.removeCharacterController(cc);
      phys.world.removeCollider(collider, false);
      phys.world.removeRigidBody(body);
    },
  };
}
