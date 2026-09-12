/** Traffic follows available lane space, including short highway segments and bends. */
export function trafficRadius(ctx) {
  return Math.max(100, Math.min(620, ctx.quality.drawDistance - 30));
}

export function roadGroup(road) {
  if (['motorway', 'trunk'].includes(road.cls)) return 'highway';
  if (['motorway_link', 'trunk_link'].includes(road.cls)) return 'ramp';
  if (['primary', 'secondary'].includes(road.cls)) return 'arterial';
  return 'street';
}

// Clip each actual path segment to the spawn disc. Short OSM pieces are not
// intersections: an 18 m end exclusion used to rule out many highway lanes.
export function laneRanges(lane, focus, radius) {
  const points = lane.path?.length > 1 ? lane.path : [
    { x: lane.ax, z: lane.az, s: 0 }, { x: lane.bx, z: lane.bz, s: lane.length },
  ];
  const ranges = [], margin = Math.min(6, lane.length * .1);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b.x - a.x, dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length < .01) continue;
    const ux = dx / length, uz = dz / length;
    const along = (focus.x - a.x) * ux + (focus.z - a.z) * uz;
    const cross = (focus.x - a.x) * uz - (focus.z - a.z) * ux;
    if (Math.abs(cross) >= radius) continue;
    const half = Math.sqrt(radius * radius - cross * cross);
    const lo = Math.max(0, along - half), hi = Math.min(length, along + half);
    if (hi <= lo) continue;
    const start = Math.max(margin, a.s + lo / length * (b.s - a.s));
    const end = Math.min(lane.length - margin, a.s + hi / length * (b.s - a.s));
    if (end <= start) continue;
    const previous = ranges.at(-1);
    if (previous && Math.abs(previous[1] - start) < .01) previous[1] = end;
    else ranges.push([start, end]);
  }
  return ranges;
}

const MIX = {
  highway: { sedan: 34, suv: 24, blacksuv: 9, taxi: 8, borotaxi: 2, van: 9, boxtruck: 10, bus: 3, nypd: 1 },
  ramp: { sedan: 34, suv: 24, blacksuv: 9, taxi: 8, borotaxi: 2, van: 9, boxtruck: 10, bus: 3, nypd: 1 },
  arterial: { sedan: 26, suv: 20, blacksuv: 8, taxi: 22, borotaxi: 4, van: 7, boxtruck: 6, bus: 5, nypd: 1, garbage: 1 },
  street: { sedan: 34, suv: 25, blacksuv: 8, taxi: 12, borotaxi: 5, van: 8, boxtruck: 4, nypd: 2, garbage: 2 },
};

function weighted(items, weight, random) {
  const weights = items.map(weight), total = weights.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let pick = random * total;
  for (let i = 0; i < items.length; i++) { pick -= weights[i]; if (pick < 0) return items[i]; }
  return items.at(-1);
}

export function trafficKind(group, random) {
  const mix = MIX[group];
  return weighted(Object.keys(mix), kind => mix[kind], random);
}

export function spawnTraffic(traffic, obstacles, deps) {
  const { lanePoint, hash01, KINDS, ground, trafficHeight, makeCar } = deps;
  const ctx = traffic.ctx, focus = ctx.state.screenshotMode ? ctx.camera.position : ctx.state.local.state;
  const radius = trafficRadius(ctx), candidates = [], groups = new Map();
  const matrix = ctx.camera.matrixWorld.elements;
  const fx = -matrix[8], fz = -matrix[10];
  for (const lane of traffic.roads.lanes.values()) {
    const group = roadGroup(lane.road);
    for (const range of laneRanges(lane, focus, radius)) {
      const middle = lanePoint(lane, (range[0] + range[1]) / 2);
      const dx = middle.x - focus.x, dz = middle.z - focus.z;
      // Camera mode gives visible approaches more room without starving the
      // roads behind the viewer. Play mode stays independent of camera yaw.
      const forward = dx * fx + dz * fz, lateral = Math.abs(dx * fz - dz * fx);
      const inView = forward > -20 && lateral < Math.max(60, forward * 1.2);
      const weight = (range[1] - range[0]) * (ctx.state.screenshotMode && !inView ? .2 : 1);
      const entry = { lane, range, group, weight, count: 0 };
      candidates.push(entry);
      if (!groups.has(group)) groups.set(group, { entries: [], weight: 0, count: 0 });
      const bucket = groups.get(group);
      bucket.entries.push(entry); bucket.weight += weight;
    }
  }
  if (!candidates.length) return;
  const byLane = new Map();
  for (const entry of candidates) {
    if (!byLane.has(entry.lane.key)) byLane.set(entry.lane.key, []);
    byLane.get(entry.lane.key).push(entry);
  }
  for (const car of traffic.cars) {
    const entry = byLane.get(car.lane.key)?.find(e => car.along >= e.range[0] && car.along <= e.range[1]);
    if (entry) { entry.count++; groups.get(entry.group).count++; }
  }
  const buckets = [...groups.values()];
  for (let attempt = 0; attempt < 160 && traffic.cars.length < ctx.quality.maxTraffic; attempt++) {
    const id = ++traffic.serial;
    // Occupancy pressure keeps one road class or lane from consuming the cap.
    const group = weighted(buckets, b => b.weight / (1 + b.count * 14 / b.weight) ** 2, hash01(id, 71));
    const entry = weighted(group.entries, e => e.weight / (1 + e.count * 14 / e.weight) ** 2, hash01(id, 73));
    const { lane, range } = entry;
    const kind = trafficKind(entry.group, hash01(id, 23)), spec = KINDS[kind];
    const along = range[0] + hash01(id, 19) * (range[1] - range[0]);
    const spawn = lanePoint(lane, along), { x, z } = spawn;
    const y = trafficHeight(ctx.world, lane.road, x, z, ground(ctx, x, z, lane.road));
    // Use the tangent at the spawn, not the chord of a curved motorway lane.
    const blocked = other => {
      if (Math.abs(other.y - y) > 3) return false;
      const dx = other.x - x, dz = other.z - z, os = KINDS[other.kind];
      const dot = Math.min(1, Math.abs(-Math.sin(other.yaw) * spawn.dx - Math.cos(other.yaw) * spawn.dz));
      const cross = Math.sqrt(Math.max(0, 1 - dot * dot));
      return Math.abs(dx * spawn.dx + dz * spawn.dz) < spec.length / 2 + dot * os.length / 2 + cross * os.width / 2 + 4
        && Math.abs(dx * spawn.dz - dz * spawn.dx) < spec.width / 2 + cross * os.length / 2 + dot * os.width / 2 + .3;
    };
    if (traffic.cars.some(blocked) || obstacles.some(blocked)) continue;
    const car = { ...makeCar(`traffic:${id}`, kind, x, y, z, Math.atan2(-spawn.dx, -spawn.dz), id),
      lane, along, next: null, wait: 0, turn: 0, age: id * .1 };
    car.speed = lane.speed * .4;
    traffic.cars.push(car); entry.count++; group.count++;
  }
}
