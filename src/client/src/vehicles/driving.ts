import * as THREE from 'three';
import type { Collider, DynamicRayCastVehicleController, RigidBody } from '@dimforge/rapier3d-compat';
import type { GameContext } from '@/core/context';
import { AnimId, StateFlag } from '@shared/protocol';
import { KINDS } from './kinds';
import { type Car, removeBody } from './model';
import { engineAccel, steeringLock, tuningFor, type DriveTuning } from './tuning';

export interface DrivingState {
  key: string; kind: string; speed: number; rpm: number; gear: number;
  throttle: number; brake: number; handbrake: boolean; steer: number;
  siren: boolean; horn: boolean; airborne: boolean;
}

const G = 9.81;
/** suspension rest length and bump travel (m); the static sag is derived from the spring rate */
const REST = 0.4, TRAVEL = 0.26;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Lateral/longitudinal contact velocity ratio (~24 degrees); ordinary cornering is not a skid. */
export const SKID_SLIP = 0.45;
export const SKID_MIN_SPEED = 3;

/** Only the occupied car is dynamic. Wheels apply impulses immediately before the core physics step. */
export class Driving {
  body: RigidBody;
  controller: DynamicRayCastVehicleController;
  state: DrivingState;
  /** compression above the static ride height per wheel (m) for the wheel shader */
  suspension: [number, number, number, number] = [0, 0, 0, 0];
  /** 0..1 per wheel: sliding/locked tire, for skid marks and smoke */
  skid: [number, number, number, number] = [0, 0, 0, 0];
  lateralSlip = [0, 0, 0, 0];
  wheelLocked = [false, false, false, false];
  headlights: boolean;
  readonly tuning: DriveTuning;
  private com = 0.55;
  private staticLength = REST;
  private wheelZ: number[];
  private inertia = { x: 1, y: 1, z: 1 };
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private forward = new THREE.Vector3();
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();
  private impulse = new THREE.Vector3();
  private pivot = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private unit = new THREE.Vector3(1, 1, 1);
  private seat = new THREE.Matrix4();
  private seatOffset: THREE.Matrix4;
  private ray: import('@dimforge/rapier3d-compat').Ray;
  private cameraFilter: (collider: Collider) => boolean;
  // chase camera
  private camYaw: number;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookIdle = 10;
  private camDist = 6;
  private camBlocked = false;
  private nearCamera = false;
  private enterBlend = 0;
  private startYaw = 0;
  private startPitch = 0;
  private startDist = 0;
  private fovStart = 60;
  private shake = 0;
  private shakeT = 0;
  // engine/impacts
  private lastSpeed = 0;
  private impactCooldown = 0;
  private lastHorn = false;
  private lastGear = 1;
  private shiftCut = 0;
  private stuckTime = 0;
  /** Diagnostic count for regression tests; recovery never disables driving input. */
  unstuckCount = 0;

  constructor(private ctx: GameContext, public car: Car, public id: number) {
    removeBody(ctx, car);
    const R = ctx.physics.RAPIER, spec = KINDS[car.kind], tune = this.tuning = tuningFor(car.kind);
    this.com = THREE.MathUtils.clamp(spec.height * 0.33, 0.42, 0.8);
    // Spawn at the static ride height: sag = g / (4 k) with Rapier's per-mass spring rate, so the car neither
    // drops nor bounces when the player gets in, and the ground-origin mesh sits exactly on its parked pose.
    const sag = G / (4 * tune.stiffness);
    this.staticLength = REST - sag;
    const mountY = spec.wheelRadius + this.staticLength - this.com;
    this.q.setFromAxisAngle(this.up.set(0, 1, 0), car.yaw);
    const groundY = Math.max(car.y, ctx.physics.groundHeight(car.x, car.z));
    const L = spec.length, W = spec.width, H = spec.height * 0.82;
    this.inertia = { x: spec.mass / 12 * (H * H + L * L), y: spec.mass / 12 * (W * W + L * L) * 0.85, z: spec.mass / 12 * (W * W + H * H) };
    this.body = ctx.physics.world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(car.x, groundY + this.com, car.z).setRotation(this.q)
      .setLinearDamping(0).setAngularDamping(0.5).setCcdEnabled(true)
      .setAdditionalMassProperties(spec.mass, { x: 0, y: 0, z: 0 }, this.inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setUserData({ surface: 'vehicle', key: car.key }));
    // Rounded box from 0.24 m (clears 0.15 m curbs) to ~82% of the roof; mass comes from the body so the
    // centre of mass stays at the body origin instead of the box centre.
    const hh = Math.max(0.25, (H - 0.24) / 2);
    ctx.physics.world.createCollider(R.ColliderDesc.roundCuboid(W * 0.46 - 0.08, hh - 0.08, L * 0.47 - 0.08, 0.08)
      .setTranslation(0, 0.24 + hh - this.com, (spec.rear - spec.front) / 2)
      .setMass(0).setFriction(0.3).setRestitution(0.2), this.body);
    this.controller = ctx.physics.world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    this.wheelZ = [-spec.wheelbase / 2, -spec.wheelbase / 2, spec.wheelbase / 2, spec.wheelbase / 2];
    const damp = Math.sqrt(tune.stiffness); // per-wheel critical damping for the heave mode
    for (let i = 0; i < 4; i++) {
      this.controller.addWheel({ x: (i % 2 ? 1 : -1) * spec.track / 2, y: mountY, z: this.wheelZ[i] },
        { x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }, REST, spec.wheelRadius);
      this.controller.setWheelSuspensionStiffness(i, tune.stiffness);
      this.controller.setWheelSuspensionCompression(i, damp * 0.5);
      this.controller.setWheelSuspensionRelaxation(i, damp * 0.85);
      this.controller.setWheelMaxSuspensionTravel(i, TRAVEL);
      this.controller.setWheelMaxSuspensionForce(i, spec.mass * G * 0.8);
      this.controller.setWheelFrictionSlip(i, tune.grip);
      this.controller.setWheelSideFrictionStiffness(i, 1);
    }
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    // The chase camera clips against the world only: parked cars, traffic and the player never pull it in.
    this.cameraFilter = collider => {
      const data = collider.parent()?.userData as { surface?: string } | undefined;
      return data?.surface !== 'vehicle' && data?.surface !== 'player';
    };
    this.camYaw = car.yaw;
    this.camDist = 5.4 + spec.length * 0.14;
    // Entering: the on-foot camera can be anywhere, including inside the car's volume. Remember it in polar
    // coordinates around the car so the transition sweeps around the outside of the body, never through it.
    const cam = ctx.camera.position, cy = car.y + spec.height * 0.55 + 0.25;
    const dx = cam.x - car.x, dz = cam.z - car.z, flat = Math.hypot(dx, dz);
    this.startYaw = flat > 0.3 ? Math.atan2(dx, dz) : car.yaw;
    this.startPitch = THREE.MathUtils.clamp(Math.atan2(cam.y - cy, Math.max(0.3, flat)), 0.05, 0.9);
    this.startDist = Math.max(Math.hypot(flat, cam.y - cy), spec.length * 0.55 + 1.3);
    this.fovStart = ctx.camera.fov;
    this.headlights = ctx.time.daylight < 0.45;
    this.seatOffset = new THREE.Matrix4().makeTranslation(spec.seatX, spec.seatY, spec.seatZ);
    this.state = { key: car.key, kind: car.kind, speed: 0, rpm: 800, gear: 1, throttle: 0, brake: 0, handbrake: false,
      steer: 0, siren: false, horn: false, airborne: false };
  }

  fixed(dt: number): void {
    if (!this.body.isValid()) return;
    // Replacing a parked fixed body can recycle a Rapier slot that becomes disabled on
    // the first world step. Wheel impulses still accumulate, but the chassis never moves.
    // An owned driving body must participate in physics; reconnect freezes skip this hook.
    if (!this.body.isEnabled()) this.body.setEnabled(true);
    const input = this.ctx.input, s = this.state, spec = KINDS[this.car.kind], tune = this.tuning, c = this.controller;
    const active = !this.ctx.state.local.dead && !this.ctx.state.screenshotMode;
    const throttle = active ? input.throttle : 0;
    const v = this.body.linvel(), av = this.body.angvel();
    this.q.copy(this.body.rotation());
    this.forward.set(0, 0, -1).applyQuaternion(this.q);
    this.right.set(1, 0, 0).applyQuaternion(this.q);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    const vf = v.x * this.forward.x + v.y * this.forward.y + v.z * this.forward.z;
    const vr = v.x * this.right.x + v.y * this.right.y + v.z * this.right.z;
    const yawRate = av.x * this.up.x + av.y * this.up.y + av.z * this.up.z;
    s.speed = Math.hypot(v.x, v.z);
    s.throttle = throttle;
    s.handbrake = active && input.handbrake;
    s.brake = vf * throttle < -0.5 ? Math.abs(throttle) : 0;
    s.steer = active ? input.steer : 0;
    let contacts = 0;
    for (let i = 0; i < 4; i++) if (c.wheelIsInContact(i)) contacts++;
    s.airborne = contacts === 0;

    // Steering: speed-sensitive lock plus a counter-steer assist that points the fronts part-way along the
    // slide, which is what makes handbrake turns recoverable without a wheel.
    const slip = s.speed > 3 ? Math.atan2(vr, Math.max(1, Math.abs(vf))) : 0;
    const assist = contacts && s.speed > 4 ? THREE.MathUtils.clamp(-slip * 0.8, -0.5, 0.5) : 0;
    const angle = -s.steer * steeringLock(tune, s.speed) + assist;

    // Engine: torque curve by kind, brief torque cut on upshifts, no drive while braking.
    const reverse = throttle < 0 && vf < 0.5;
    let engine = s.brake || throttle === 0 ? 0 : throttle * spec.mass * engineAccel(tune, vf, reverse);
    const span = tune.top / tune.gears;
    const gear = vf < -0.5 ? -1 : Math.min(tune.gears, 1 + Math.floor(s.speed / span));
    if (gear > this.lastGear && gear > 1 && vf > 3) this.shiftCut = 0.12;
    this.lastGear = gear;
    this.shiftCut -= dt;
    if (this.shiftCut > 0) engine *= 0.3;
    const rear = tune.rearBias, front = 1 - rear;
    for (let i = 0; i < 4; i++) {
      const isRear = i > 1, hb = s.handbrake && isRear;
      c.setWheelSteering(i, isRear ? 0 : angle);
      c.setWheelEngineForce(i, hb ? 0 : engine * (isRear ? rear : front) / 2);
      // Rapier ignores the brake on a driven wheel, so these only bite when the engine force is zero.
      let brake = s.brake * tune.brake * spec.mass / 4 * dt * (isRear ? 0.8 : 1.2);
      if (hb) brake = Math.max(brake, spec.mass * 6 * dt); // rear lock
      else if (Math.abs(throttle) < 0.03 && !s.brake) brake = Math.max(brake, spec.mass * 0.6 / 4 * dt); // engine braking
      c.setWheelBrake(i, brake);
      // Progressive lateral grip. Rapier's bilateral side impulse only removes 20% of the slip velocity per step
      // per unit of stiffness, so 2.2 is a crisp street tire; it fades towards 0.9 past ~7 deg of axle slip and
      // the locked rears drop to 0.45 so a handbrake turn keeps sliding until the driver catches it.
      const axleSlip = Math.abs(Math.atan2(vr + yawRate * this.wheelZ[i], Math.max(1.5, Math.abs(vf))) - (isRear ? 0 : angle));
      const soften = THREE.MathUtils.smoothstep(axleSlip, 0.12, 0.5);
      c.setWheelSideFrictionStiffness(i, hb ? 0.6 : (isRear ? 2.0 : 2.2) - 1.2 * soften);
      c.setWheelFrictionSlip(i, hb ? tune.grip * 0.6 : tune.grip);
    }
    // Rapier already excludes its own chassis; use native flags rather than a JS callback in the WASM query.
    c.updateVehicle(dt, this.ctx.physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    // Use this step's wheel contacts. The previous contacts can belong to the
    // asphalt before a curb clip rather than the surface under the car now.
    contacts = 0;
    for (let i = 0; i < 4; i++) if (c.wheelIsInContact(i)) contacts++;
    s.airborne = contacts === 0;
    this.recoverStuck(dt, throttle, contacts);
    // The controller applies tire side impulses almost at the centre of mass (roll influence 0.1), so the body
    // never leans. Re-apply the lateral part of this step's tire impulse as a moment about the roll centre.
    if (contacts) {
      const v1 = this.body.linvel();
      const lateral = (v1.x - v.x) * this.right.x + (v1.y - v.y) * this.right.y + (v1.z - v.z) * this.right.z;
      this.impulse.copy(this.forward).multiplyScalar(-lateral * spec.mass * this.com * 0.55);
      // Slide stability: once the handbrake is off, bleed yaw rate while the car is still sideways so a drift
      // straightens under the counter-steer assist instead of carrying its yaw inertia into a spin.
      if (!s.handbrake) this.impulse.addScaledVector(this.up, -yawRate * this.inertia.y * 4 * THREE.MathUtils.smoothstep(Math.abs(slip), 0.2, 0.5) * dt);
      this.body.applyTorqueImpulse(this.impulse, true);
    }

    if (!s.airborne) {
      // Rolling resistance + aero drag (sets the top end together with the torque curve), then downforce that
      // loads the tires at speed, then roll/pitch damping only: the springs alone set how much the body leans.
      const resist = (0.12 + 0.00011 * s.speed * s.speed) * spec.mass * dt / Math.max(0.5, s.speed);
      this.body.applyImpulse(this.impulse.set(-v.x * resist, 0, -v.z * resist), true);
      this.body.applyImpulse(this.impulse.set(0, -Math.min(2.5, s.speed * s.speed * 0.001) * spec.mass * dt, 0), true);
    }
    // Roll/pitch rate damping always (a car on two wheels must not keep rotating), plus a righting torque
    // past ~10 deg of lean: side impacts with parked cars tip a ray-cast vehicle over far too easily, and the
    // reference cars settle back onto their wheels instead of ending on their roof.
    if (this.up.y > 0) {
      const rollRate = av.x * this.forward.x + av.y * this.forward.y + av.z * this.forward.z;
      const pitchRate = av.x * this.right.x + av.y * this.right.y + av.z * this.right.z;
      const lean = Math.asin(THREE.MathUtils.clamp(this.right.y, -1, 1)); // + when the left side is up
      const righting = Math.sign(lean) * Math.max(0, Math.abs(lean) - 0.17) * 25;
      this.impulse.copy(this.forward).multiplyScalar((-rollRate * 4 - righting) * this.inertia.z * dt)
        .addScaledVector(this.right, -pitchRate * this.inertia.x * 4 * dt);
      this.body.applyTorqueImpulse(this.impulse, true);
    }
    // Slip in the STEERED tire frame, not chassis lateral speed (which also
    // grows in a normal corner). A decaying visual strength alone must never
    // keep stamping after grip returns, the vehicle stops, or contact is lost.
    for (let i = 0; i < 4; i++) {
      const isRear = i > 1, wheelAngle = isRear ? 0 : angle;
      const axleLateral = vr + yawRate * this.wheelZ[i];
      const lateral = axleLateral * Math.cos(wheelAngle) + vf * Math.sin(wheelAngle);
      const longitudinal = vf * Math.cos(wheelAngle) - axleLateral * Math.sin(wheelAngle);
      const contact = c.wheelIsInContact(i) && s.speed > SKID_MIN_SPEED;
      const slipRatio = this.lateralSlip[i] = contact ? Math.abs(lateral) / Math.max(1, Math.abs(longitudinal)) : 0;
      const locked = this.wheelLocked[i] = contact && ((s.handbrake && isRear) || (s.brake > 0.8 && s.speed > 9 && !isRear));
      const sliding = contact && (slipRatio > SKID_SLIP || locked);
      const target = sliding ? Math.max(THREE.MathUtils.clamp((slipRatio - SKID_SLIP) / 0.65, 0.15, 1), locked ? (isRear ? 1 : 0.6) : 0) : 0;
      this.skid[i] = sliding ? this.skid[i] + (target - this.skid[i]) * Math.min(1, dt * 12) : 0;
    }
    this.impactCooldown -= dt;
    const drop = this.lastSpeed - s.speed;
    if (drop > 1.5 && this.impactCooldown <= 0) {
      this.ctx.events.emit('impact', this.pivot.set(this.car.x, this.car.y + 0.7, this.car.z), drop * spec.mass);
      this.shake = Math.min(1, this.shake + drop / 10);
      this.impactCooldown = 0.25;
    }
    this.lastSpeed = s.speed;
    s.gear = gear;
    const inGear = gear < 0 ? Math.min(1, s.speed / 12) : (s.speed - (gear - 1) * span) / span;
    s.rpm = THREE.MathUtils.clamp(900 + inGear * 5200 + Math.abs(throttle) * 500, 800, 7000);
  }

  private recoverStuck(dt: number, throttle: number, wheelContacts: number): void {
    const s = this.state;
    if (Math.abs(throttle) < 0.2 || s.handbrake || s.brake || s.speed >= 0.5) {
      this.stuckTime = 0;
      return;
    }
    // A high-centred chassis can lose all wheel rays while still resting on a
    // curb. A short downward body probe distinguishes that from actual airtime.
    const pos = this.body.translation(), R = this.ctx.physics.RAPIER;
    this.ray.origin.x = pos.x; this.ray.origin.y = pos.y; this.ray.origin.z = pos.z;
    this.ray.dir.x = 0; this.ray.dir.y = -1; this.ray.dir.z = 0;
    const world = this.ctx.physics.world, chassis = this.body.collider(0);
    const support = world.castRay(this.ray, Math.max(this.com + 0.2, KINDS[this.car.kind].height), true,
      R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, this.body);
    let grounded = wheelContacts > 0 || !!support && support.timeOfImpact <= this.com + 0.2;
    if (!grounded) world.contactPairsWith(chassis, other => {
      world.contactPair(chassis, other, manifold => {
        if (Math.abs(manifold.normal().y) < 0.4) return;
        for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) < 0.04) grounded = true;
      });
    });
    this.stuckTime = grounded ? this.stuckTime + dt : 0;
    if (this.stuckTime < 2) return;
    this.stuckTime = 0;
    this.unstuckCount++;
    if (this.up.y < 0.5 && support) {
      // A roof/side contact is grounded too. The ordinary righting torque only
      // handles upright cars; otherwise a low-speed roll permanently loses W/S.
      const yaw = Math.atan2(-this.forward.x, -this.forward.z);
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const target = { x: pos.x, y: pos.y - support.timeOfImpact + this.com + 0.08, z: pos.z };
      const offset = chassis.translationWrtParent()!;
      const centre = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(rotation).add(new THREE.Vector3(target.x, target.y, target.z));
      // Test the entire upright chassis, including its offset from the COM.
      if (!world.intersectionWithShape(centre, rotation, chassis.shape,
        R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, chassis, this.body)) {
        this.body.setRotation(rotation, true);
        this.body.setTranslation(target, true);
        this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        world.propagateModifiedBodyPositionsToColliders();
        return;
      }
    }
    // An impulse, not a teleport: CCD and wall contacts remain authoritative.
    // The small lift unloads a caught chassis; reverse nudges away from a wall.
    const mass = this.body.mass(), direction = Math.sign(throttle);
    this.impulse.set(this.forward.x * direction * 1.2, 1.6, this.forward.z * direction * 1.2).multiplyScalar(mass);
    this.body.applyImpulse(this.impulse, true);
  }

  update(dt: number): void {
    const ctx = this.ctx, car = this.car, s = this.state, spec = KINDS[car.kind];
    const pos = this.body.translation(), vel = this.body.linvel(), av = this.body.angvel();
    this.q.copy(this.body.rotation());
    this.e.setFromQuaternion(this.q, 'YXZ');
    // Body origin is the center of mass; the author's mesh origin is the ground below the wheelbase.
    this.up.set(0, this.com, 0).applyQuaternion(this.q);
    car.x = pos.x - this.up.x; car.y = pos.y - this.up.y; car.z = pos.z - this.up.z; car.yaw = this.e.y;
    car.matrix.compose(this.pivot.set(car.x, car.y, car.z), this.q, this.unit);
    car.speed = s.speed; car.steer = this.controller.wheelSteering(0) ?? 0; car.brake = s.brake || (s.handbrake ? 1 : 0);
    car.spin -= (vel.x * -Math.sin(car.yaw) + vel.z * -Math.cos(car.yaw)) * dt / spec.wheelRadius;
    for (let i = 0; i < 4; i++) this.suspension[i] = this.staticLength - (this.controller.wheelSuspensionLength(i) ?? this.staticLength);
    if (ctx.input.headlights) this.headlights = !this.headlights;
    if (ctx.input.camToggle) this.nearCamera = !this.nearCamera;
    // F is the existing horn mapping; on a police car its rising edge also toggles the siren.
    if (car.kind === 'nypd' && ctx.input.horn && !this.lastHorn) s.siren = !s.siren;
    this.lastHorn = ctx.input.horn;
    s.horn = ctx.input.horn; car.siren = s.siren;
    const wire = ctx.state.local.state;
    Object.assign(wire, { x: car.x, y: car.y, z: car.z, yaw: this.e.y, pitch: this.e.x, roll: this.e.z,
      vx: vel.x, vy: vel.y, vz: vel.z, vehicleId: this.id, steer: s.steer, throttle: s.throttle, anim: AnimId.DriveIdle });
    wire.flags = (wire.flags & (StateFlag.Protected | StateFlag.Dead)) | StateFlag.InVehicle | (s.airborne ? StateFlag.Airborne : 0);
    this.seat.copy(car.matrix).multiply(this.seatOffset);
    if (ctx.state.screenshotMode || ctx.state.local.dead) return;
    this.chaseCamera(dt, vel, av);
  }

  /** GTA-style chase: sits behind the velocity vector, leads into turns, stretches and widens with speed. */
  private chaseCamera(dt: number, vel: { x: number; y: number; z: number }, av: { x: number; y: number; z: number }): void {
    const ctx = this.ctx, car = this.car, s = this.state, spec = KINDS[car.kind], camera = ctx.camera;
    const look = ctx.input.look;
    if (Math.abs(look.dx) > 0.1 || Math.abs(look.dy) > 0.1) {
      this.lookYaw = wrap(this.lookYaw - look.dx * 0.0025);
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + look.dy * 0.002, -0.28, 0.5);
      this.lookIdle = 0;
    } else this.lookIdle += dt;
    if (this.lookIdle > 1 && s.speed > 1.5) {
      const keep = Math.exp(-dt * 2);
      this.lookYaw *= keep; this.lookPitch *= keep;
    }
    const vf = -vel.x * Math.sin(car.yaw) - vel.z * Math.cos(car.yaw);
    let target = car.yaw;
    if (vf > 3) target = car.yaw + wrap(Math.atan2(-vel.x, -vel.z) - car.yaw) * 0.6 * THREE.MathUtils.smoothstep(s.speed, 3, 8);
    target += THREE.MathUtils.clamp(av.y * 0.25, -0.3, 0.3);
    this.camYaw += wrap(target - this.camYaw) * (1 - Math.exp(-dt * (2.5 + Math.min(4, s.speed * 0.15))));
    let yaw = this.camYaw + this.lookYaw;
    let pitch = 0.24 - Math.min(0.05, s.speed * 0.001) + this.lookPitch;
    const distTarget = (this.nearCamera ? 3.6 : 5.4) + spec.length * 0.14 + Math.min(2.4, s.speed * 0.05);
    this.camDist += (distTarget - this.camDist) * (1 - Math.exp(-dt * 2));
    let dist = this.camDist, entering = false;
    if (this.enterBlend < 1) {
      // Glide from the on-foot view into the chase position around the outside of the car rather than cutting.
      this.enterBlend = Math.min(1, this.enterBlend + dt / 0.7);
      const k = THREE.MathUtils.smoothstep(this.enterBlend, 0, 1);
      yaw = this.startYaw + wrap(yaw - this.startYaw) * k;
      pitch = THREE.MathUtils.lerp(this.startPitch, pitch, k);
      dist = THREE.MathUtils.lerp(this.startDist, dist, k);
      camera.fov = THREE.MathUtils.lerp(this.fovStart, camera.fov, k);
      entering = true;
    }
    this.pivot.set(car.x, car.y + spec.height * 0.55 + 0.25, car.z);
    const ahead = Math.min(5, s.speed * 0.1);
    this.lookTarget.set(car.x - Math.sin(car.yaw) * ahead, this.pivot.y, car.z - Math.cos(car.yaw) * ahead);
    this.direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.ray.origin.x = this.pivot.x; this.ray.origin.y = this.pivot.y; this.ray.origin.z = this.pivot.z;
    this.ray.dir.x = this.direction.x; this.ray.dir.y = this.direction.y; this.ray.dir.z = this.direction.z;
    const R = ctx.physics.RAPIER;
    const hit = ctx.physics.world.castRay(this.ray, dist, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, this.body, this.cameraFilter);
    const blocked = !!hit && hit.timeOfImpact < dist;
    this.desired.copy(this.pivot).addScaledVector(this.direction, blocked ? Math.max(0.7, hit!.timeOfImpact - 0.35) : dist);
    // Snap inward at walls, ease back out; otherwise a light positional lag sells acceleration.
    camera.position.lerp(this.desired, blocked || entering ? 1 : 1 - Math.exp(-dt * (this.camBlocked ? 4 : 12)));
    this.camBlocked = blocked;
    this.shake *= Math.exp(-dt * 5);
    this.shakeT += dt;
    if (this.shake > 0.005) {
      const a = this.shake * 0.22;
      camera.position.x += Math.sin(this.shakeT * 61) * a;
      camera.position.y += Math.sin(this.shakeT * 47) * a * 0.7;
      camera.position.z += Math.sin(this.shakeT * 53) * a;
    }
    camera.lookAt(this.lookTarget);
    const fovTarget = 60 + 12 * THREE.MathUtils.smoothstep(s.speed, 0, 45);
    camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-dt * 3));
    camera.updateProjectionMatrix();
    ctx.state.local.eye.copy(camera.position);
    camera.getWorldDirection(ctx.state.local.aimDir);
  }

  /** Test hook: put the car on the road at (x, z) facing yaw with an initial forward speed (m/s). */
  place(x: number, z: number, yaw: number, speed = 0): void {
    if (!this.body.isValid()) return;
    this.skid.fill(0); this.lateralSlip.fill(0); this.wheelLocked.fill(false);
    this.stuckTime = 0;
    this.q.setFromAxisAngle(this.up.set(0, 1, 0), yaw);
    this.body.setTranslation({ x, y: Math.max(0, this.ctx.physics.groundHeight(x, z)) + this.com, z }, true);
    this.body.setRotation(this.q, true);
    this.body.setLinvel({ x: -Math.sin(yaw) * speed, y: 0, z: -Math.cos(yaw) * speed }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.camYaw = yaw; this.lookYaw = this.lookPitch = 0; this.enterBlend = 1; this.lastSpeed = speed; this.shake = 0;
    this.ctx.camera.position.set(x + Math.sin(yaw) * this.camDist, this.com + 2, z + Math.cos(yaw) * this.camDist);
  }
  driverSeatMatrix(): THREE.Matrix4 { return this.seat; }
  dispose(): void {
    this.ctx.physics.world.removeVehicleController(this.controller);
    if (this.body.isValid()) this.ctx.physics.world.removeRigidBody(this.body);
  }
}
