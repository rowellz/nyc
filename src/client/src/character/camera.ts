/**
 * GTA-style third-person camera. Pivot at the upper spine, 3.4 m back (aim: 1.4 m over the right shoulder),
 * mouse yaw/pitch with limits, swept-sphere collision (excluding the
 * player capsule), lagged follow, look-ahead when running, speed FOV, smooth blend when regaining
 * ownership from the vehicle camera, slow orbit when dead.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import type { PhysicsWorldImpl } from '@/core/physics';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { Tile } from '@shared/world';

// GTA framing: the character stands about a third of the frame tall, left of centre, seen from a little above
// the shoulder (camera at ~1.65 m looking down 6 degrees at a chest-height pivot).
const BASE_FOV = 62;
const AIM_FOV = 48;
const DIST = 4.1;
const AIM_DIST = 1.4;
const CROUCH_DIST = 3.3;
const SIDE = 0.6;
const AIM_SIDE = 0.55;
const PIVOT_H = 1.2;
const AIM_PIVOT_H = 1.46;
const CROUCH_PIVOT_H = 0.95;
const SENS = 0.0022;
const PITCH_MIN = -1.05;
const PITCH_MAX = 0.78;
const AIM_PITCH_MIN = -1.2;
const AIM_PITCH_MAX = 0.95;
const MIN_DIST = 1.4;
const COLLISION_MARGIN = 0.002;
const HEAD_CLEARANCE = 0.6;
const HANDOFF_SECONDS = 0.5;
// Bus shelters are rendered props but currently have no Rapier collider. Camera-only
// panels match their roof, back glass and end panels, preserving the open interior.
const SHELTER_PANELS = [
  [-2.3, 2.58, -0.9, 2.3, 2.8, 0.9],
  [-2.15, 0.35, 0.64, 2.15, 2.55, 0.76],
  [-2.16, 0.35, -0.65, -2.04, 2.55, 0.65],
  [2.02, 0.25, -0.65, 2.18, 2.25, 0.65],
].map(b => new THREE.Box3(new THREE.Vector3(...b.slice(0, 3) as [number, number, number]), new THREE.Vector3(...b.slice(3) as [number, number, number])).expandByScalar(0.24));
type Shelter = { x: number; y: number; z: number; cos: number; sin: number };

/** Pick a broad walkable heading, not a narrow gap between two obstacles. Runs only on spawn. */
export function openSpawnYaw(phys: PhysicsWorldImpl, p: { x: number; y: number; z: number; yaw: number }, exclude: RigidBody | null): number {
  const origin = new THREE.Vector3(p.x, p.y + 1, p.z), dir = new THREE.Vector3();
  let bestYaw = p.yaw, best = -Infinity;
  for (let i = 0; i < 24; i++) {
    const yaw = p.yaw + i * Math.PI / 12;
    let clearance = 10, sum = 0;
    for (const offset of [-0.3, 0, 0.3]) {
      dir.set(-Math.sin(yaw + offset), 0, -Math.cos(yaw + offset));
      const d = phys.raycastExcluding(origin, dir, 10, exclude)?.dist ?? 10;
      clearance = Math.min(clearance, d); sum += d;
    }
    const score = clearance * 2 + sum / 3 + Math.cos(yaw - p.yaw) * 0.1;
    if (score > best) { best = score; bestYaw = yaw; }
  }
  return bestYaw;
}

export interface CameraTarget {
  x: number;
  y: number; // feet
  z: number;
  yaw: number; // body yaw
  scale: number;
  speed: number;
  sprinting: boolean;
  aiming: boolean;
  crouching: boolean;
  dead: boolean;
  /** rigid body to exclude from collision rays */
  exclude: RigidBody | null;
}

export class ThirdPersonCamera {
  yaw = 0;
  pitch = -0.11;
  private aimBlend = 0;
  private dist = DIST;
  private pivot = new THREE.Vector3();
  private pivotInit = false;
  private lookAhead = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private back = new THREE.Vector3();
  private right = new THREE.Vector3();
  private rayO = new THREE.Vector3();
  private rayD = new THREE.Vector3();
  private anchor = new THREE.Vector3();
  private head = new THREE.Vector3();
  private candidate = new THREE.Vector3();
  private safe = new THREE.Vector3();
  private preferred = new THREE.Vector3();
  private fromAnchor = new THREE.Vector3();
  private spawnPending = true;
  private snapPosition = true;
  private lookAt = new THREE.Vector3();
  private blendT = -1;
  private blendFrom = new THREE.Vector3();
  private blendFromQ = new THREE.Quaternion();
  private tmpQ = new THREE.Quaternion();
  private previousPosition = new THREE.Vector3();
  private orbitT = 0;
  private fov = BASE_FOV;
  private phys: PhysicsWorldImpl;
  private shelterCache = new WeakMap<Tile, Shelter[]>();
  private shelters: Shelter[] = [];
  private shelterTiles = new Set<Tile>();
  private shelterRay = new THREE.Ray();
  private shelterHit = new THREE.Vector3();
  /** debug: extra look applied from tests */
  injectLook = { dx: 0, dy: 0 };

  constructor(private ctx: GameContext) {
    this.phys = ctx.physics as unknown as PhysicsWorldImpl;
    this.yaw = ctx.state.local.state.yaw;
  }

  /** call when the camera comes back from the vehicle module (or on spawn): blend from the current transform */
  regain(fromCurrent = true): void {
    if (fromCurrent) {
      this.blendFrom.copy(this.ctx.camera.position);
      this.blendFromQ.copy(this.ctx.camera.quaternion);
      this.blendT = 0;
      this.snapPosition = this.spawnPending = false;
      this.fov = this.ctx.camera.fov;
      // start the orbit yaw from the camera's current heading so it does not snap
      const e = new THREE.Euler().setFromQuaternion(this.ctx.camera.quaternion, 'YXZ');
      this.yaw = e.y;
      this.pitch = THREE.MathUtils.clamp(e.x, PITCH_MIN, PITCH_MAX);
    }
    this.pivotInit = false;
  }

  /** snap the orbit behind the body (spawn) */
  snapBehind(yaw: number): void {
    this.yaw = yaw;
    this.pitch = -0.11;
    this.pivotInit = false;
    this.blendT = -1;
    this.spawnPending = this.snapPosition = true;
    this.dist = DIST;
  }

  update(dt: number, t: CameraTarget): void {
    this.refreshShelters(t.x, t.z);
    const cam = this.ctx.camera;
    this.previousPosition.copy(cam.position);
    const inp = this.ctx.input;
    const dead = t.dead;

    // Late audio/prop builders can finish after PLAY already accepted input.
    // Once the player steers, never replace their heading with the spawn-ready heuristic.
    if (inp.look.dx || inp.look.dy || this.injectLook.dx || this.injectLook.dy || inp.aim || Math.hypot(inp.move?.x ?? 0, inp.move?.y ?? 0) > 0.01) this.spawnPending = false;
    if (this.spawnPending && this.ctx.world.ready && !(this.ctx.busy ?? 0)) {
      // The controller has selected the same heading after near-tile collision finished loading.
      this.yaw = openSpawnYaw(this.phys, { ...t, yaw: this.ctx.state.local.state.yaw }, t.exclude);
      this.spawnPending = false;
    }

    if (!dead) {
      const dx = inp.look.dx + this.injectLook.dx, dy = inp.look.dy + this.injectLook.dy;
      this.injectLook.dx = this.injectLook.dy = 0;
      const sens = SENS * (t.aiming ? 0.62 : 1);
      this.yaw -= dx * sens;
      this.pitch -= dy * sens;
      const lo = t.aiming ? AIM_PITCH_MIN : PITCH_MIN, hi = t.aiming ? AIM_PITCH_MAX : PITCH_MAX;
      this.pitch = THREE.MathUtils.clamp(this.pitch, lo, hi);
      // auto-center pitch slowly while sprinting (GTA does this)
      if (t.sprinting && !t.aiming) this.pitch += (-0.12 - this.pitch) * (1 - Math.exp(-dt * 0.6));
    }

    const ka = 1 - Math.exp(-dt * 10);
    this.aimBlend += ((t.aiming ? 1 : 0) - this.aimBlend) * ka;
    const a = this.aimBlend;

    // ---- pivot (lagged follow) ----
    const pivotH = THREE.MathUtils.lerp(t.crouching ? CROUCH_PIVOT_H : PIVOT_H, AIM_PIVOT_H, a) * t.scale;
    const px = t.x, py = t.y + pivotH, pz = t.z;
    this.anchor.set(px, py, pz);
    this.head.set(t.x, t.y + (t.crouching ? 1.1 : 1.65) * t.scale, t.z);
    const character = this.ctx.modules.get('character') as { headPosition?(id: number, out: THREE.Vector3): THREE.Vector3 | null } | undefined;
    character?.headPosition?.(this.ctx.state.local.id, this.head);
    if (!this.pivotInit) {
      this.pivot.set(px, py, pz);
      this.pivotInit = true;
    } else {
      const kh = 1 - Math.exp(-dt / (t.aiming ? 0.03 : 0.07));
      const kv = 1 - Math.exp(-dt / (t.aiming ? 0.05 : 0.14));
      this.pivot.x += (px - this.pivot.x) * kh;
      this.pivot.z += (pz - this.pivot.z) * kh;
      this.pivot.y += (py - this.pivot.y) * kv;
      // never lag more than 0.6 m behind (fast vehicles / teleports)
      const lag = Math.hypot(this.pivot.x - px, this.pivot.z - pz);
      if (lag > 0.6) {
        const f = (lag - 0.6) / lag;
        this.pivot.x += (px - this.pivot.x) * f;
        this.pivot.z += (pz - this.pivot.z) * f;
      }
    }

    if (dead) {
      this.orbitT += dt;
      const r = 3.2, h = 1.5;
      const ang = this.yaw + Math.PI + this.orbitT * 0.25;
      this.desired.set(t.x + Math.sin(ang) * r, t.y + h, t.z + Math.cos(ang) * r);
      cam.position.lerp(this.desired, 1 - Math.exp(-dt * 3));
      this.lookAt.set(t.x, t.y + 0.5, t.z);
      cam.lookAt(this.lookAt);
      this.fov += (BASE_FOV - this.fov) * (1 - Math.exp(-dt * 4));
      if (Math.abs(cam.fov - this.fov) > 0.05) {
        cam.fov = this.fov;
        cam.updateProjectionMatrix();
      }
      return;
    }
    this.orbitT = 0;

    // ---- desired position ----
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // back = direction from the pivot away from where the camera looks
    this.back.set(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp);
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wantDist = THREE.MathUtils.lerp(t.crouching ? CROUCH_DIST : DIST, AIM_DIST, a) * Math.max(0.85, t.scale);
    const side = THREE.MathUtils.lerp(SIDE, AIM_SIDE, a) * t.scale;
    // look-ahead when running: shift the pivot forward along the body's motion
    const speedK = THREE.MathUtils.clamp(t.speed / 7.5, 0, 1);
    const ahead = (1 - a) * speedK * 0.55;
    this.lookAhead.set(-Math.sin(t.yaw) * ahead, 0, -Math.cos(t.yaw) * ahead);
    const target = this.pivot;
    // Validate the shoulder/lag offset before using it as the pull-in pivot.
    // Sweeping from the centre to the destination would shrink the shoulder offset too.
    this.rayO.copy(target).addScaledVector(this.right, side);
    this.rayD.subVectors(this.rayO, this.anchor);
    const offsetLength = this.rayD.length();
    if (offsetLength > 1e-8) {
      this.rayD.divideScalar(offsetLength);
      const offsetHit = this.sweep(this.anchor, this.rayD, offsetLength, t.exclude);
      // Leave a small margin so the next sweep never starts on/inside a contact plane.
      const offsetRoom = offsetHit === null ? offsetLength : Math.max(0, offsetHit - COLLISION_MARGIN);
      this.rayO.copy(this.anchor).addScaledVector(this.rayD, offsetRoom);
    }
    const hit = this.sweep(this.rayO, this.back, wantDist, t.exclude);
    const available = hit === null ? wantDist : Math.max(0, hit - COLLISION_MARGIN);
    this.dist += (available - this.dist) * (1 - Math.exp(-dt * (available < this.dist ? 28 : 5)));
    // Smooth the pull-in, but the collision limit always wins over interpolation.
    this.desired.copy(this.rayO).addScaledVector(this.back, Math.min(available, Math.max(MIN_DIST, this.dist)));
    this.resolvePosition(this.desired, t.exclude);

    // ---- apply (with the ownership blend) ----
    this.lookAt.copy(this.rayO).add(this.lookAhead).addScaledVector(this.back, -8);
    const handingOff = this.blendT >= 0;
    if (this.snapPosition) {
      cam.position.copy(this.desired);
      cam.lookAt(this.lookAt);
      this.snapPosition = false;
    } else if (this.blendT >= 0) {
      this.blendT += dt;
      const u = THREE.MathUtils.smoothstep(this.blendT / HANDOFF_SECONDS, 0, 1);
      // Compute the destination orientation at the destination, not at the moving
      // blend position (which can still be on the other side of the exited car).
      cam.position.copy(this.desired);
      cam.lookAt(this.lookAt);
      this.tmpQ.copy(cam.quaternion);
      cam.position.copy(this.blendFrom).lerp(this.desired, u);
      cam.quaternion.slerpQuaternions(this.blendFromQ, this.tmpQ, u);
      if (u >= 1) this.blendT = -1;
    } else {
      cam.position.lerp(this.desired, 1 - Math.exp(-dt / 0.035));
      cam.lookAt(this.lookAt);
    }
    if (handingOff) {
      // The chase pose can legitimately be occluded from the NEW player pivot by
      // the exited vehicle. Pulling it in along that sightline causes the exit cut.
      // Sweep the actual camera motion instead; the destination is already resolved.
      this.rayD.subVectors(cam.position, this.previousPosition);
      const travel = this.rayD.length();
      if (travel > 1e-8) {
        this.rayD.divideScalar(travel);
        const hit = this.sweep(this.previousPosition, this.rayD, travel, t.exclude);
        if (hit !== null) cam.position.copy(this.previousPosition).addScaledVector(this.rayD, Math.max(0, hit - COLLISION_MARGIN));
      }
      // Invalid starting poses (e.g. respawn inside the avatar) still need immediate clearance.
      if (cam.position.distanceToSquared(this.head) < HEAD_CLEARANCE ** 2
        || cam.position.distanceToSquared(this.anchor) < HEAD_CLEARANCE ** 2) this.resolvePosition(cam.position, t.exclude);
    } else {
      // Ordinary follow lerps must keep both the camera volume and sightline clear.
      this.resolvePosition(cam.position, t.exclude);
    }

    // ---- fov ----
    const targetFov = THREE.MathUtils.lerp(BASE_FOV, AIM_FOV, a) + (1 - a) * (t.sprinting ? 6 : 0) * speedK * speedK;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 6));
    if (Math.abs(cam.fov - this.fov) > 0.02) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  private resolvePosition(position: THREE.Vector3, exclude: RigidBody | null): void {
    this.preferred.subVectors(position, this.rayO);
    const currentLength = this.preferred.length();
    if (this.preferred.lengthSq() < 1e-8) this.preferred.copy(this.back);
    this.preferred.normalize();
    const length = Math.max(this.minimumDistance(this.preferred), currentLength);
    const hit = this.sweep(this.rayO, this.preferred, length, exclude);
    const available = hit === null ? length : Math.max(0, hit - COLLISION_MARGIN);
    position.copy(this.rayO).addScaledVector(this.preferred, available);
    this.clearSightline(position, exclude);
    if (available >= MIN_DIST && position.distanceToSquared(this.anchor) >= MIN_DIST ** 2
      && position.distanceToSquared(this.head) >= HEAD_CLEARANCE ** 2) return;

    // Find a clear 1.4 m orbit before accepting a cramped position. Never clamp through a wall.
    let best = -Infinity;
    let bestRoom = position.distanceTo(this.anchor);
    this.safe.copy(position);
    const yaw = Math.atan2(this.preferred.x, this.preferred.z);
    for (const elevation of [0, 0.65, -0.65, 1.2]) {
      for (let i = 0; i < 24; i++) {
        const angle = yaw + i * Math.PI / 12, cp = Math.cos(elevation);
        this.rayD.set(Math.sin(angle) * cp, Math.sin(elevation), Math.cos(angle) * cp);
        const minimum = this.minimumDistance(this.rayD);
        const hit = this.sweep(this.rayO, this.rayD, minimum, exclude);
        const distance = hit === null ? minimum : Math.max(0, hit - COLLISION_MARGIN);
        this.candidate.copy(this.rayO).addScaledVector(this.rayD, distance);
        this.clearSightline(this.candidate, exclude);
        if (this.candidate.distanceToSquared(this.head) < HEAD_CLEARANCE ** 2) continue;
        const room = this.candidate.distanceTo(this.anchor);
        if (distance < minimum || room < MIN_DIST) {
          if (best === -Infinity && room > bestRoom) { bestRoom = room; this.safe.copy(this.candidate); }
          continue;
        }
        const score = this.rayD.dot(this.preferred);
        if (score <= best) continue;
        best = score; this.safe.copy(this.candidate);
      }
    }
    position.copy(this.safe);
  }

  /** Shoulder sweeps and interpolated corners must also leave the avatar's sightline clear. */
  private clearSightline(position: THREE.Vector3, exclude: RigidBody | null): void {
    this.fromAnchor.subVectors(position, this.anchor);
    const length = this.fromAnchor.length();
    if (length < 1e-8) return;
    this.fromAnchor.divideScalar(length);
    const hit = this.sweep(this.anchor, this.fromAnchor, length, exclude);
    if (hit !== null) position.copy(this.anchor).addScaledVector(this.fromAnchor, Math.max(0, hit - COLLISION_MARGIN));
  }

  /** An orbit toward the body needs extra reach from the shoulder to clear the body too. */
  private minimumDistance(direction: THREE.Vector3): number {
    const along = direction.dot(this.rayO) - direction.dot(this.anchor);
    const acrossSq = this.rayO.distanceToSquared(this.anchor) - along * along;
    return Math.max(MIN_DIST, Math.sqrt(Math.max(0, (MIN_DIST + COLLISION_MARGIN) ** 2 - acrossSq)) - along);
  }

  private refreshShelters(x: number, z: number): void {
    this.shelters.length = 0;
    const seen = this.shelterTiles;
    seen.clear();
    for (const dx of [-10, 0, 10]) for (const dz of [-10, 0, 10]) {
      const tile = this.ctx.world.tileAt?.(x + dx, z + dz);
      if (!tile || seen.has(tile)) continue;
      seen.add(tile);
      let list = this.shelterCache.get(tile);
      if (!list) {
        list = [];
        for (const p of tile.props) {
          if (p.kind !== 'bus_stop') continue;
          let yaw = p.yaw, best = 45 ** 2;
          // Match the furniture placement's closest road segment, including curved streets.
          for (const road of tile.roads) {
            if (road.tunnel) continue;
            for (let i = 1; i < road.pts.length; i++) {
              const [ax, az] = road.pts[i - 1], [bx, bz] = road.pts[i];
              const vx = bx - ax, vz = bz - az, len = vx * vx + vz * vz;
              if (len < 1e-6) continue;
              const u = THREE.MathUtils.clamp(((p.x - ax) * vx + (p.z - az) * vz) / len, 0, 1);
              const nx = p.x - ax - vx * u, nz = p.z - az - vz * u, d = nx * nx + nz * nz;
              if (d < best) { best = d; yaw = Math.atan2(nx, nz); }
            }
          }
          list.push({ x: p.x, y: this.phys.groundHeight(p.x, p.z), z: p.z, cos: Math.cos(yaw), sin: Math.sin(yaw) });
        }
        this.shelterCache.set(tile, list);
      }
      for (const shelter of list) if (Math.hypot(shelter.x - x, shelter.z - z) < 12) this.shelters.push(shelter);
    }
  }

  private sweep(origin: THREE.Vector3, dir: THREE.Vector3, max: number, exclude: RigidBody | null): number | null {
    // The physics sweep includes ALL tagged props and cars, excluding only players/sensors.
    let nearest = this.phys.sphereCast(origin, dir, max, exclude);
    for (const s of this.shelters) {
      const x = origin.x - s.x, z = origin.z - s.z;
      this.shelterRay.origin.set(x * s.cos - z * s.sin, origin.y - s.y, x * s.sin + z * s.cos);
      this.shelterRay.direction.set(dir.x * s.cos - dir.z * s.sin, dir.y, dir.x * s.sin + dir.z * s.cos);
      for (const panel of SHELTER_PANELS) {
        const inside = panel.containsPoint(this.shelterRay.origin);
        const hit = inside || this.shelterRay.intersectBox(panel, this.shelterHit);
        if (!hit) continue;
        const distance = inside ? 0 : this.shelterHit.distanceTo(this.shelterRay.origin);
        if (distance <= max && (nearest === null || distance < nearest)) nearest = distance;
      }
    }
    return nearest;
  }
}
