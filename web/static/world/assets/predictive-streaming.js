// The recovered streamer owns fetching, decoding, indexing and tile events.
// Replace its scheduling policy without changing those lifetime contracts.
import { installTileRequests } from './tile-requests.js';
const TILE = 256;
// iOS fills the 384 m neighborhood, with one route tile and recent retention.
// Leave a little retirement overlap while keeping geometry/physics bounded.
const IOS_STREAMING = Object.freeze({ maxTiles: 20, requests: 1 });
// Start pacing before 50 km/h, rather than waiting until 86 km/h (24 m/s).
// A lower exit speed keeps acceleration/braking near the threshold from
// repeatedly restoring the larger scene budget.
const FAST_TRAVEL_SPEED = 12;
const SLOW_TRAVEL_SPEED = 9;
const keyOf = (tx, tz) => `${tx}_${tz}`;
const distance = (tx, tz, x, z) => Math.hypot(
  Math.max(tx * TILE - x, 0, x - (tx + 1) * TILE),
  Math.max(tz * TILE - z, 0, z - (tz + 1) * TILE),
);

// Distance along the travel ray when it enters a tile. Corner-only touches
// are excluded so diagonal travel does not spend the speculative slot on side tiles.
function routeEntry(tx, tz, x, z, dx, dz) {
  let enter = 0, leave = Infinity;
  for (const [cell, origin, direction] of [[tx, x, dx], [tz, z, dz]]) {
    const lo = cell * TILE, hi = lo + TILE;
    if (Math.abs(direction) < 1e-6) {
      if (origin < lo || origin >= hi) return Infinity;
    } else {
      const a = (lo - origin) / direction, b = (hi - origin) / direction;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
    }
  }
  return leave - enter > 1e-6 ? enter : Infinity;
}

// The main loop normally stops publication when sixteen scene jobs are busy.
// Allow decoded occupied/required driving tiles through that gate: a car held
// at the boundary cannot enter its missing tile to make it occupied. The
// streamer still enforces one publication per frame and its resident-tile limit.
export function canCommitSceneTile(ctx, world) {
  const limit = world.stats?.fastTravel ? (world.mobile || world.ios ? 6 : 10) : 16;
  if ((ctx.busy ?? 0) < limit) return true;
  const key = keyOf(Math.floor(world.focus.x / TILE), Math.floor(world.focus.z / TILE));
  return world.landed.some(({ p, id }) => !world.tiles.has(p.key)
    && (p.key === key || world.drivingRequired?.has(p.key)) && world.inFlight.get(p.key) === id);
}

export function configureStreaming(world, camera) {
  const cancelObsoleteRequests = installTileRequests(world);
  const mobile = world.mobile || world.ios;
  const mobileRequestLimit = world.ios ? IOS_STREAMING.requests : 2;
  const residentLimit = world.ios ? IOS_STREAMING.maxTiles : mobile ? 40 : Infinity;
  const originalUpdate = world.update;
  const originalUnloadAll = world.unloadAll;
  const direction = world.focus.clone();
  let sample = null, vx = 0, vz = 0, aheadX = 0, aheadZ = 0;
  let wanted = new Map();
  const lastWanted = new Map();
  let retiring = [];
  let nextSceneChange = 0;
  let retiredLast = false;
  const travelSceneInterval = mobile ? 0.15 : 0.05;

  // Keep the occupied tile and its immediate boundary neighbors first. Beyond
  // that, favor the route ahead over equally distant work behind the player.
  world.tilePriority = (tx, tz) => {
    const { x, z } = world.focus;
    const d = distance(tx, tz, x, z);
    if (tx === Math.floor(x / TILE) && tz === Math.floor(z / TILE)) return -2 * TILE;
    if (world.drivingRequired?.has(keyOf(tx, tz))) return -1.75 * TILE + Math.min(d, TILE) / 4;
    if (d < TILE / 2) return -TILE + d;
    if (Math.hypot(aheadX, aheadZ) > 0) {
      const lead = Math.hypot(aheadX, aheadZ);
      const entry = routeEntry(tx, tz, x, z, aheadX / lead, aheadZ / lead);
      // Build the route in arrival order; a far tile must never jump ahead
      // of an intervening one just because it is closer to the lookahead point.
      const near = Math.abs(tx - Math.floor(x / TILE)) <= 1
        && Math.abs(tz - Math.floor(z / TILE)) <= 1;
      // Finish the local 3x3 before speculative scenery. Direction only breaks
      // ties within that tier, so a far motorway cannot starve nearby tiles.
      return (near ? 0 : TILE * 4) + d + (entry <= lead ? 0 : TILE / 4);
    }
    return d * 0.35 + distance(tx, tz, x + aheadX, z + aheadZ) * 0.65;
  };

  world.update = function (focus, now, nearOnly = false, commitAllowed = true) {
    const wall = performance.now() / 1000;
    const dt = sample ? wall - sample.time : 0;
    if (dt > 0 && dt < 1) {
      const dx = focus.x - sample.x, dz = focus.z - sample.z;
      // Fast free cameras legitimately exceed 150 m/s. Detect discontinuities
      // by displacement instead; a whole tile in one sample is a spot change.
      if (Math.hypot(dx, dz) < TILE) {
        const blend = 1 - Math.exp(-dt / 0.2);
        vx += (dx / dt - vx) * blend;
        vz += (dz / dt - vz) * blend;
      } else { vx = vz = 0; }
    } else { vx = vz = 0; }
    sample = { x: focus.x, z: focus.z, time: wall };
    const speed = Math.hypot(vx, vz);
    const travelSpeed = Math.max(speed, this.stats.drivingSpeed ?? 0);
    this.stats.fastTravel = !nearOnly && (travelSpeed > (this.stats.fastTravel ? SLOW_TRAVEL_SPEED : FAST_TRAVEL_SPEED)
      || this.stats.drivingWaiting === true);
    camera.getWorldDirection(direction);
    const facing = Math.hypot(direction.x, direction.z);
    const nearReach = this.ios ? TILE : this.drawDistance;
    const lead = nearOnly ? 0 : mobile
      ? this.ios ? this.drawDistance + Math.min(TILE, speed * 4)
        : this.drawDistance + Math.min(TILE * 2, TILE / 2 + speed * 6)
      : nearReach + Math.min(TILE * 2, TILE / 2 + speed * 6);
    this.stats.lookAheadMeters = lead;
    const scale = speed > 1 ? speed : facing;
    aheadX = scale > 0.1 ? (speed > 1 ? vx : direction.x) / scale * lead : 0;
    aheadZ = scale > 0.1 ? (speed > 1 ? vz : direction.z) / scale * lead : 0;
    // Plan before committing so teleports cannot publish stale decoded tiles.
    originalUpdate.call(this, focus, now, nearOnly, false);
    // Disposing one tile fans out through every scene module. Never tear down
    // a whole row and publish another tile in the same frame.
    discardObsolete();
    const key = keyOf(Math.floor(focus.x / TILE), Math.floor(focus.z / TILE));
    // All decoded slots can still belong to wanted neighbors after a move.
    // Make one available for a missing occupied tile even if scene jobs prevent
    // publishing those neighbors. Requeue the lower-priority reply for later.
    const requestLimit = mobile ? mobileRequestLimit : this.initialBurst ? 6 : 2;
    const needed = [key, ...(this.drivingRequired ?? [])].find(key =>
      !this.tiles.has(key) && !this.inFlight.has(key) && this.queue.some(p => p.key === key));
    if (needed && this.inFlight.size >= requestLimit && this.landed.length) {
      this.landed.sort((a, b) => this.tilePriority(a.p.tx, a.p.tz) - this.tilePriority(b.p.tx, b.p.tz));
      const { p, id } = this.landed.pop();
      if (this.inFlight.get(p.key) === id) {
        this.inFlight.delete(p.key);
        this.queue.push(p);
        this.queue.sort((a, b) => this.tilePriority(a.tx, a.tz) - this.tilePriority(b.tx, b.tz));
      }
    }
    const urgent = commitAllowed && this.landed.some(reply => !this.tiles.has(reply.p.key)
      && reply.p.key === key);
    const sceneDue = !this.stats.fastTravel || wall >= nextSceneChange;
    // Once there is room, do not drain a whole retirement queue before showing
    // the occupied tile. Cleanup resumes on subsequent frames.
    const hasRoom = this.tiles.size < residentLimit;
    const canPublish = commitAllowed && this.landed.length > 0 && hasRoom;
    // Alternate cleanup and publication when both have work. A long retirement
    // queue must not hold the route hostage; iOS still retires first at its cap.
    const retire = (sceneDue || urgent) && !(urgent && hasRoom)
      && (!canPublish || !retiredLast) ? retiring.shift() : undefined;
    const before = this.tiles.size;
    if (retire !== undefined) this.unload(retire);
    else if (commitAllowed && (sceneDue || urgent)
      && this.tiles.size < residentLimit) this.commitLanded();
    if (this.tiles.size !== before) {
      retiredLast = retire !== undefined;
      nextSceneChange = wall + travelSceneInterval;
    }
    this.pump(wall);
    this.stats.inFlight = this.inFlight.size;
    this.stats.queued = this.queue.length;
  };

  world.plan = function (fx, fz, ftx, ftz, now) {
    wanted = new Map();
    const add = (tx, tz) => {
      const key = keyOf(tx, tz);
      if (this.tileSet.has(key)) wanted.set(key, { key, tx, tz, dist: this.tilePriority(tx, tz) });
    };
    for (const key of this.drivingRequired ?? []) {
      const [tx, tz] = key.split('_').map(Number);
      add(tx, tz);
    }
    const radius = this.nearOnly ? 1 : this.ios ? Math.ceil(this.drawDistance / TILE) : this.loadRadius;
    for (let tx = ftx - radius; tx <= ftx + radius; tx++) {
      for (let tz = ftz - radius; tz <= ftz + radius; tz++) {
        const near = Math.abs(tx - ftx) <= 1 && Math.abs(tz - ftz) <= 1;
        if (near || distance(tx, tz, fx, fz) <= this.drawDistance) add(tx, tz);
      }
    }
    const lead = Math.hypot(aheadX, aheadZ);
    if (!this.nearOnly && lead > 0) {
      const candidates = [], reach = Math.ceil(lead / TILE) + 1;
      for (let tx = ftx - reach; tx <= ftx + reach; tx++) {
        for (let tz = ftz - reach; tz <= ftz + reach; tz++) {
          const key = keyOf(tx, tz);
          if (wanted.has(key) || !this.tileSet.has(key)) continue;
          const dx = (tx + 0.5) * TILE - fx, dz = (tz + 0.5) * TILE - fz;
          const forward = (dx * aheadX + dz * aheadZ) / lead;
          const sideways = Math.abs(dx * aheadZ - dz * aheadX) / lead;
          if (forward <= 0 || sideways > TILE || distance(tx, tz, fx, fz) > lead) continue;
          const entry = routeEntry(tx, tz, fx, fz, aheadX / lead, aheadZ / lead);
          if (mobile && entry > lead) continue;
          candidates.push({ key, tx, tz, dist: this.tilePriority(tx, tz), entry });
        }
      }
      candidates.sort((a, b) => a.dist - b.dist);
      for (const p of candidates.slice(0, this.ios ? 1 : mobile ? 3 : 10)) wanted.set(p.key, p);
    }
    // Leave room for retained tiles and one replacement. Density must not let
    // Android accumulate an unbounded ring of geometry and physics either.
    if(mobile) wanted=new Map([...wanted].sort((a,b)=>a[1].dist-b[1].dist)
      .slice(0,residentLimit-(this.ios?2:4)));
    // Keep one recently used tile on iOS, up to three on other phones.
    // A brief turn or boundary crossing should reuse its scene and colliders.
    for (const key of wanted.keys()) lastWanted.set(key, now);
    const retained = mobile ? new Set([...this.tiles.values()]
      .filter(tile => !wanted.has(tile.key) && now - (lastWanted.get(tile.key) ?? -Infinity) < 6
        && distance(tile.tx, tile.tz, fx, fz) <= Math.max(this.drawDistance + TILE, Math.hypot(aheadX, aheadZ)))
      .sort((a, b) => distance(a.tx, a.tz, fx, fz) - distance(b.tx, b.tz, fx, fz))
      .slice(0, this.ios ? 1 : 3).map(tile => tile.key)) : new Set();
    retiring = [];
    for (const [key, tile] of this.tiles) {
      if (wanted.has(key) || retained.has(key)) continue;
      if (mobile || distance(tile.tx, tile.tz, fx, fz) > this.drawDistance + 2 * TILE) retiring.push(key);
    }
    for (const key of lastWanted.keys()) if (!wanted.has(key) && !this.tiles.has(key)) lastWanted.delete(key);
    this.queue = [...wanted.values()].filter(p => {
      const failedAt = this.failed.get(p.key);
      return !this.tiles.has(p.key) && !this.inFlight.has(p.key) && (failedAt === undefined || now - failedAt >= 10);
    }).sort((a, b) => a.dist - b.dist);
    this.ready = this.index !== null || this.indexError !== null;
    for (let tx = ftx - 1; tx <= ftx + 1 && this.ready; tx++) {
      for (let tz = ftz - 1; tz <= ftz + 1; tz++) {
        const key = keyOf(tx, tz);
        if (this.tileSet.has(key) && !this.tiles.has(key)) { this.ready = false; break; }
      }
    }
  };

  function discardObsolete() {
    cancelObsoleteRequests(wanted);
    // Releasing decoded data does not create scene jobs. It must work even
    // while publication is blocked, or stale replies monopolize the request slots.
    for (let i = world.landed.length - 1; i >= 0; i--) {
      const { p, id } = world.landed[i];
      if (wanted.has(p.key)) continue;
      world.landed.splice(i, 1);
      if (world.inFlight.get(p.key) === id) world.inFlight.delete(p.key);
    }
  }

  world.commitLanded = function () {
    discardObsolete();
    if (!this.landed.length) return;
    this.landed.sort((a, b) => this.tilePriority(a.p.tx, a.p.tz) - this.tilePriority(b.p.tx, b.p.tz));
    const { p, id, tile } = this.landed.shift();
    if (this.inFlight.get(p.key) !== id) return;
    this.inFlight.delete(p.key);
    if (this.tiles.has(p.key)) return;
    this.tiles.set(p.key, tile);
    this.stats.fetched++;
    this.failed.delete(p.key);
    this.indexTile(tile);
    this.events.emit('tileLoaded', tile);
    this.lastPlan = -Infinity;
  };

  world.pump = function (now) {
    // A single mobile decoder can overlap network waits. Landed tiles retain
    // their slots, bounding decoded memory when scene builders apply backpressure.
    const limit = mobile ? mobileRequestLimit : this.initialBurst ? 6 : 2;
    while (this.inFlight.size < limit && this.queue.length) {
      const p = this.queue.shift();
      if (!this.tiles.has(p.key) && !this.inFlight.has(p.key)) this.startLoad(p, now);
    }
  };
  world.unloadAll = function () {
    sample = null;
    vx = vz = aheadX = aheadZ = 0;
    wanted.clear();
    lastWanted.clear();
    retiring = [];
    nextSceneChange = 0;
    retiredLast = false;
    this.stats.fastTravel = false;
    this.drivingRequired = undefined;
    this.stats.drivingWaiting = false;
    this.stats.drivingSpeed = 0;
    originalUnloadAll.call(this);
  };
  return world;
}
