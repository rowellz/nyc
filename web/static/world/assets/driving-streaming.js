const TILE = 256;
const holds = new WeakMap();
const checks = new WeakMap();

function requiredTiles(drive, position, velocity, dt, radius) {
  const world = drive.ctx.world, seconds = Math.max(dt * 2, 0.15);
  const x = position.x + velocity.x * seconds, z = position.z + velocity.z * seconds;
  const minX = Math.floor((Math.min(position.x, x) - radius) / TILE);
  const maxX = Math.floor((Math.max(position.x, x) + radius) / TILE);
  const minZ = Math.floor((Math.min(position.z, z) - radius) / TILE);
  const maxZ = Math.floor((Math.max(position.z, z) + radius) / TILE);
  let cached = checks.get(drive);
  if (!cached || cached.minX !== minX || cached.maxX !== maxX || cached.minZ !== minZ || cached.maxZ !== maxZ
    || cached.index !== world.index || cached.tileSet !== world.tileSet || cached.indexSize !== world.tileSet.size) {
    const tiles = new Set();
    // The short swept bounding box is conservative even during a sudden turn.
    // Its grid coverage usually stays unchanged for hundreds of physics steps.
    for (let tx = minX; tx <= maxX; tx++) for (let tz = minZ; tz <= maxZ; tz++) {
      const key = `${tx}_${tz}`;
      if (world.tileSet.has(key)) tiles.add(key);
    }
    cached = { minX, maxX, minZ, maxZ, index: world.index, tileSet: world.tileSet,
      indexSize: world.tileSet.size, tiles };
    checks.set(drive, cached);
  }
  // Normal streaming cadence and budgets still apply. Safety comes from holding
  // the car, not forcing extra full-scene publication/replanning in this hook.
  world.drivingRequired = cached.tiles;
  return cached.tiles;
}

/** Called before the occupied car applies wheel impulses on every physics step.
 * A pending surface is a streaming wait, not an airborne vehicle. Keep the car
 * collidable at its exact pose while builders run, then restore its momentum.
 */
export function guardDriving(drive, dt, spec) {
  const { ctx, body } = drive, world = ctx.world;
  if (!body.isValid()) return false;
  const held = holds.get(drive), position = held?.position ?? body.translation();
  const velocity = held?.velocity ?? body.linvel();
  // Camera smoothing and a stationary streaming hold must not hide road speed
  // from the frame scheduler. Rapier velocities are metres per second.
  world.stats.drivingSpeed = Math.hypot(velocity.x, velocity.z);
  const radius = Math.hypot(spec.length, spec.width) / 2 + 2;
  const required = requiredTiles(drive, position, velocity, dt, radius);
  const streets = ctx.modules.get('streets');
  let ready = world.index !== null && ctx.physics.ready;
  if (ready) for (const key of required) {
    if (!world.tiles.has(key) || !streets?.collisionReady(key)) { ready = false; break; }
  }
  world.stats.drivingWaiting = !ready;
  drive.state.streaming = !ready;
  if (ready) {
    if (held) {
      body.setBodyType(held.type, true);
      body.setLinvel(held.velocity, true);
      body.setAngvel(held.angular, true);
      drive.lastSpeed = Math.hypot(velocity.x, velocity.z); // Resumption is not an impact.
      holds.delete(drive);
    }
    return false;
  }
  if (!held) {
    holds.set(drive, { position: { ...position }, type: body.bodyType(), velocity: { ...velocity }, angular: { ...body.angvel() } });
    body.setBodyType(ctx.physics.RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.setNextKinematicTranslation(position);
    body.setNextKinematicRotation(body.rotation());
    drive.skid.fill(0);
    drive.lateralSlip.fill(0);
    drive.wheelLocked.fill(false);
  }
  drive.state.speed = 0;
  drive.state.throttle = 0;
  drive.state.airborne = false;
  return true;
}

export function releaseDrivingGuard(drive) {
  holds.delete(drive);
  checks.delete(drive);
  drive.ctx.world.drivingRequired = undefined;
  drive.ctx.world.stats.drivingWaiting = false;
  drive.ctx.world.stats.drivingSpeed = 0;
}
