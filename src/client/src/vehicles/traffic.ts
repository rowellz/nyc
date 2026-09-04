import type { GameContext } from '@/core/context';
import { hash01, KINDS, pickKind } from './kinds';
import { createObstacle, distance2, ground, makeCar, poseMatrix, removeBody, type Car } from './model';
import { Roads, isAvenue, type Lane } from './roads';

interface TrafficCar extends Car { lane: Lane; along: number; next: Lane | null; wait: number; turn: number; age: number }
interface Signals { signalFor?: (x: number, z: number, dx: number, dz: number) => { state: string; dist: number; stopX: number; stopZ: number } | null }

const AVENUE_RADIUS = 150;
const AVENUE_SHARE = 0.7;

function aheadRange(lane: Lane, range: [number, number], focus: { x: number; z: number }, fx: number, fz: number): [number, number] | null {
  const base = (lane.ax - focus.x) * fx + (lane.az - focus.z) * fz, slope = lane.dx * fx + lane.dz * fz;
  if (Math.abs(slope) < 0.01) return base > 8 ? range : null;
  const boundary = (8 - base) / slope;
  const lo = slope > 0 ? Math.max(range[0], boundary) : range[0];
  const hi = slope < 0 ? Math.min(range[1], boundary) : range[1];
  return hi > lo ? [lo, hi] : null;
}

/** Clip a lane to a focus disc, rather than rejecting long blocks by their midpoint. */
function spawnRange(lane: Lane, focus: { x: number; z: number }, radius: number): [number, number] | null {
  const dx = focus.x - lane.ax, dz = focus.z - lane.az;
  const along = dx * lane.dx + dz * lane.dz, cross = dx * lane.dz - dz * lane.dx;
  if (Math.abs(cross) >= radius) return null;
  const half = Math.sqrt(radius * radius - cross * cross);
  const lo = Math.max(8, along - half), hi = Math.min(lane.length - 10, along + half);
  return hi > lo ? [lo, hi] : null;
}

export class Traffic {
  cars: TrafficCar[] = [];
  private serial = 0;
  private spawnClock = 0;
  private buckets = new Map<number, Car[]>();
  private bucketPool: Car[][] = [];
  constructor(private ctx: GameContext, private roads: Roads) {}

  private choose(car: TrafficCar): Lane | null {
    const choices = (this.roads.outgoing.get(car.lane.end) ?? []).filter(l => l.dx * car.lane.dx + l.dz * car.lane.dz > -0.8);
    let best: Lane | null = null, score = -Infinity;
    for (let i = 0; i < choices.length; i++) {
      const l = choices[i], dot = l.dx * car.lane.dx + l.dz * car.lane.dz;
      const lateral = Math.abs((l.ax - car.lane.bx) * car.lane.dz - (l.az - car.lane.bz) * car.lane.dx);
      const s = hash01(this.serial + car.key.length, Math.floor(car.age * 10), i)
        + dot * (isAvenue(car.lane.road) ? 1.8 : 0.55) - (dot > 0.8 ? lateral * 0.7 : 0);
      if (s > score) { best = l; score = s; }
    }
    return best;
  }

  update(dt: number, t: number, obstacles: readonly Car[]): void {
    const ctx = this.ctx, focus = ctx.state.screenshotMode ? ctx.camera.position : ctx.state.local.state;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (!this.roads.lanes.has(c.lane.key) || distance2(c, focus) > 450 ** 2 || this.cars.length > ctx.quality.maxTraffic) {
        removeBody(ctx, c); this.cars.splice(i, 1);
      }
    }
    this.spawnClock -= dt;
    if (this.spawnClock <= 0 && ctx.quality.maxTraffic > 0) {
      this.spawnClock = 0.25;
      const cameraMatrix = ctx.camera.matrixWorld.elements;
      const fx = ctx.state.screenshotMode ? -cameraMatrix[8] : -Math.sin(ctx.state.local.state.yaw);
      const fz = ctx.state.screenshotMode ? -cameraMatrix[10] : -Math.cos(ctx.state.local.state.yaw);
      const ahead = (c: Car) => (c.x - focus.x) * fx + (c.z - focus.z) * fz > 8;
      const lanes = [...this.roads.lanes.values()].flatMap(lane => {
        const range = spawnRange(lane, focus, 350);
        const near = isAvenue(lane.road) ? spawnRange(lane, focus, AVENUE_RADIUS) : null;
        return range ? [{ lane, range, near, ahead: near ? aheadRange(lane, near, focus, fx, fz) : null }] : [];
      });
      const avenues = lanes.filter(l => l.near);
      // Framing reservations belong to shots only. In play, looking behind you
      // must not drain the player's upstream traffic supply.
      const approaches = ctx.state.screenshotMode ? avenues.filter(l => l.ahead) : [];
      const avenueNames = new Set(avenues.map(l => l.lane.road.name));
      // One bus starts on the upstream approach, not all buses in the local queue.
      // This also keeps a real transit silhouette in the avenue's distant stream.
      const transitFeeds = lanes.flatMap(l => {
        if (!isAvenue(l.lane.road) || !avenueNames.has(l.lane.road.name)) return [];
        const outer = aheadRange(l.lane, l.range, focus, fx, fz);
        if (!outer) return [];
        const inner = spawnRange(l.lane, focus, 260);
        const ranges: [number, number][] = inner
          ? [[outer[0], Math.min(outer[1], inner[0])], [Math.max(outer[0], inner[1]), outer[1]]]
          : [outer];
        return ranges.filter(r => r[1] > r[0]).map(range => ({ ...l, range }));
      });
      let nearCount = this.cars.filter(c => isAvenue(c.lane.road) && distance2(c, focus) < AVENUE_RADIUS ** 2).length;
      let aheadCount = this.cars.filter(c => isAvenue(c.lane.road) && distance2(c, focus) < AVENUE_RADIUS ** 2 && ahead(c)).length;
      let needsTransitFeed = ctx.quality.maxTraffic >= 25 && transitFeeds.length > 0 && !this.cars.some(c =>
        c.kind === 'bus' && avenueNames.has(c.lane.road.name) && ahead(c) && distance2(c, focus) > 180 ** 2);
      const target = avenues.length ? Math.ceil(ctx.quality.maxTraffic * (ctx.state.screenshotMode ? AVENUE_SHARE : 0.9)) : 0;
      const approachTarget = approaches.length ? Math.ceil(target * 0.55) : 0;
      // Reserve the existing cap for the focus avenue at every hour. Retire at most
      // two distant cars per tick as the focus moves; never delete the queue in view.
      for (let retired = 0; (nearCount < target || aheadCount < approachTarget || needsTransitFeed) && this.cars.length >= ctx.quality.maxTraffic && retired < 2; retired++) {
        let index = -1, farthest = (ctx.state.screenshotMode ? 180 : AVENUE_RADIUS + 15) ** 2;
        for (let i = 0; i < this.cars.length; i++) {
          if (this.cars[i].kind === 'bus') continue; // preserve sparse transit routes during local rebalancing
          const d = distance2(this.cars[i], focus);
          if (d > farthest) { index = i; farthest = d; }
        }
        if (index < 0) break;
        removeBody(ctx, this.cars[index]); this.cars.splice(index, 1);
      }
      let taxis = this.cars.reduce((n, c) => n + (c.kind === 'taxi' ? 1 : 0), 0);
      let buses = this.cars.reduce((n, c) => n + (c.kind === 'bus' ? 1 : 0), 0);
      for (let attempt = 0; lanes.length && attempt < 48 && this.cars.length < ctx.quality.maxTraffic; attempt++) {
        const id = ++this.serial;
        // Most attempts fill the local reservation; spare attempts still feed cross streets
        // when an avenue is saturated. Length weighting avoids overfilling tiny OSM segments.
        const forward = aheadCount < approachTarget && approaches.length > 0 && attempt % 3 !== 2;
        const transitFeed = needsTransitFeed;
        const local = !transitFeed && (nearCount < target || forward) && avenues.length > 0 && attempt % 6 !== 5;
        const candidates = transitFeed ? transitFeeds : local ? forward ? approaches : avenues : lanes;
        let weightTotal = 0;
        const weights = candidates.map(l => { const r = local ? forward ? l.ahead! : l.near! : l.range; return weightTotal += r[1] - r[0]; });
        const pick = hash01(id, 71) * weightTotal;
        const selected = candidates[weights.findIndex(w => w > pick)], lane = selected.lane;
        const range = local ? forward ? selected.ahead! : selected.near! : selected.range;
        let kind = pickKind('traffic', hash01(id, 23));
        if (kind === 'bus' && !['primary', 'secondary'].includes(lane.road.cls)) kind = 'sedan';
        // Rejected spawns/short-lived routes must not bias a small local fleet
        // far away from its 45% cab mix. Keep a little random variation.
        if (taxis - this.cars.length * 0.45 > 2 && kind === 'taxi') kind = 'sedan';
        else if (taxis - this.cars.length * 0.45 < -2) kind = 'taxi';
        // Maintain a small transit share on arterial routes; rejection of long footprints
        // otherwise removes every bus from a dense all-car local reservation.
        if (transitFeed || isAvenue(lane.road) && buses < Math.floor(ctx.quality.maxTraffic / 25)) kind = 'bus';
        const along = range[0] + hash01(id, 19) * (range[1] - range[0]);
        const x = lane.ax + lane.dx * along, z = lane.az + lane.dz * along;
        const y = ground(ctx, x, z), spec = KINDS[kind];
        // A radial exclusion around curbside cars sealed off every nearby through lane.
        // Project the other footprint into this lane: queue clearance is longitudinal,
        // not a ten-metre lateral exclusion from parking and adjacent traffic.
        const blocked = (other: Car) => {
          if (Math.abs(other.y - y) > 3) return false;
          const dx = other.x - x, dz = other.z - z, os = KINDS[other.kind];
          const dot = Math.abs(-Math.sin(other.yaw) * lane.dx - Math.cos(other.yaw) * lane.dz);
          const cross = Math.sqrt(Math.max(0, 1 - dot * dot));
          return Math.abs(dx * lane.dx + dz * lane.dz) < spec.length / 2 + dot * os.length / 2 + cross * os.width / 2 + (local ? 4 : 7)
            && Math.abs(dx * lane.dz - dz * lane.dx) < spec.width / 2 + cross * os.length / 2 + dot * os.width / 2 + 0.3;
        };
        if (this.cars.some(blocked) || obstacles.some(blocked)) continue;
        const c: TrafficCar = { ...makeCar(`traffic:${id}`, kind, x, y, z, Math.atan2(-lane.dx, -lane.dz), id),
          lane, along, next: null, wait: 0, turn: 0, age: id * 0.1 };
        c.speed = lane.speed * 0.4;
        this.cars.push(c);
        if (isAvenue(lane.road) && distance2(c, focus) < AVENUE_RADIUS ** 2) nearCount++;
        if (isAvenue(lane.road) && distance2(c, focus) < AVENUE_RADIUS ** 2 && ahead(c)) aheadCount++;
        if (kind === 'taxi') taxis++;
        if (kind === 'bus') buses++;
        if (transitFeed) needsTransitFeed = false;
      }
    }
    // Spatial broad phase for queues. A full scan of every parked car for every AI driver gets
    // expensive in dense Midtown tiles, even though only a narrow strip ahead can affect the car.
    for (const bucket of this.buckets.values()) { bucket.length = 0; this.bucketPool.push(bucket); }
    this.buckets.clear();
    const insert = (c: Car) => {
      const key = Math.floor(c.x / 20) + Math.floor(c.z / 20) * 65536;
      let bucket = this.buckets.get(key);
      if (!bucket) { bucket = this.bucketPool.pop() ?? []; this.buckets.set(key, bucket); }
      bucket.push(c);
    };
    for (const c of this.cars) insert(c);
    for (const c of obstacles) insert(c);
    const signals = ctx.modules.get('props') as Signals | undefined;
    for (const c of this.cars) {
      const lane = c.lane, spec = KINDS[c.kind];
      c.age += dt;
      const remain = lane.length - c.along;
      if (remain < 30 && (!c.next || !this.roads.lanes.has(c.next.key))) c.next = this.choose(c);
      c.turn = c.next ? lane.dx * c.next.dz - lane.dz * c.next.dx : 0;
      let desired = lane.speed * (Math.abs(c.turn) > 0.3 && remain < 16 ? 0.45 : 1);
      let gap = Infinity;
      const signal = signals?.signalFor?.(c.x, c.z, lane.dx, lane.dz);
      if (signal && signal.state !== 'green' && (signal.state === 'red' || signal.dist > c.speed * 0.8 + spec.front)) {
        const ahead = (signal.stopX - c.x) * lane.dx + (signal.stopZ - c.z) * lane.dz;
        if (ahead > 0) gap = Math.max(0, ahead - spec.front - 1);
      }
      // Queue across lane boundaries as well as within a lane; no passing through stopped cars.
      const avoid = (other: Car) => {
        if (other === c || Math.abs(other.y - c.y) > 3) return;
        const dx = other.x - c.x, dz = other.z - c.z;
        const ahead = dx * lane.dx + dz * lane.dz;
        if (ahead <= 0 || ahead > 60 || Math.abs(dx * lane.dz - dz * lane.dx) > (spec.width + KINDS[other.kind].width) / 2 + 0.3) return;
        gap = Math.min(gap, Math.max(0, ahead - spec.front - KINDS[other.kind].rear - 2.5));
      };
      const endX = c.x + lane.dx * 60, endZ = c.z + lane.dz * 60;
      const x0 = Math.floor((Math.min(c.x, endX) - 4) / 20), x1 = Math.floor((Math.max(c.x, endX) + 4) / 20);
      const z0 = Math.floor((Math.min(c.z, endZ) - 4) / 20), z1 = Math.floor((Math.max(c.z, endZ) + 4) / 20);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const bucket = this.buckets.get(x + z * 65536);
        if (bucket) for (const other of bucket) avoid(other);
      }
      // At unsignaled junctions, stop briefly, then yield to vehicles already in the junction.
      // Parallel continuations of the same avenue aren't intersections.
      const junction = this.roads.outgoing.get(lane.end)?.some(l => l.dx * lane.dx + l.dz * lane.dz < 0.8) ?? false;
      if (!signal && junction && remain < spec.front + 7) {
        c.wait += dt;
        const occupied = this.cars.some(o => o !== c && o.lane !== lane && Math.hypot(o.x - lane.bx, o.z - lane.bz) < 5 && o.speed > 0.5);
        if (c.wait < 0.65 || occupied) gap = Math.min(gap, Math.max(0, remain - spec.front - 2));
      }
      if (!c.next && remain < 12) desired = Math.min(desired, Math.max(0, remain - 1));
      desired = Math.min(desired, Math.sqrt(2 * 3.5 * gap));
      const old = c.speed;
      c.speed += Math.max(-6 * dt, Math.min(2.5 * dt, desired - c.speed));
      c.speed = Math.max(0, c.speed);
      c.brake = old > c.speed + 0.01 || c.speed < 0.2 ? 1 : 0;
      c.along += Math.min(c.speed * dt, gap);
      if (c.along >= lane.length - 0.8) {
        if (c.next && this.roads.lanes.has(c.next.key)) { c.along = Math.max(0, c.along - lane.length); c.lane = c.next; c.next = null; c.wait = 0; }
        else { c.age += 1; if (c.speed < 0.5) { removeBody(ctx, c); c.along = -1000; } }
      }
      const targetYaw = Math.atan2(-c.lane.dx, -c.lane.dz);
      const delta = Math.atan2(Math.sin(targetYaw - c.yaw), Math.cos(targetYaw - c.yaw));
      c.yaw += delta * Math.min(1, dt * 7);
      c.steer = Math.max(-0.5, Math.min(0.5, delta));
      const follow = Math.min(1, dt * 15);
      c.x += (c.lane.ax + c.lane.dx * c.along - c.x) * follow;
      c.z += (c.lane.az + c.lane.dz * c.along - c.z) * follow;
      c.y = c.lane.road.bridge ? ground(ctx, c.x, c.z) : 0;
      c.spin -= c.speed * dt / spec.wheelRadius;
      c.siren = c.kind === 'nypd' && Math.sin(t * 0.035 + c.age * 0.01) > 0.985;
      poseMatrix(c);
      if (!ctx.state.screenshotMode && distance2(c, ctx.state.local.state) < 100 ** 2) {
        createObstacle(ctx, c, true);
        c.body?.setNextKinematicTranslation(c);
        c.body?.setNextKinematicRotation({ x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) });
      } else removeBody(ctx, c);
    }
    for (let i = this.cars.length - 1; i >= 0; i--) if (this.cars[i].along < 0) this.cars.splice(i, 1);
  }

  unload(): void {
    for (let i = this.cars.length - 1; i >= 0; i--) if (!this.roads.lanes.has(this.cars[i].lane.key)) {
      removeBody(this.ctx, this.cars[i]); this.cars.splice(i, 1);
    }
  }
  dispose(): void { for (const c of this.cars) removeBody(this.ctx, c); this.cars.length = 0; this.buckets.clear(); this.bucketPool.length = 0; }
}
