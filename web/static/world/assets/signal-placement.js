






/** Generated poles include every segment end, including exits of one-way roads.
 * Recover their common intersection node, not the corner/pole position. */
export function signalApproach(p      , roads                        )                        {
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let best                        = null, distance = 35 ** 2;
  for (const r of roads) {
    if (r.tunnel || r.lanes < 1 || r.pts.length < 2) continue;
    for (const atStart of [true, false]) {
      const node = r.pts[atStart ? 0 : r.pts.length - 1];
      const next = r.pts[atStart ? 1 : r.pts.length - 2];
      const dx = next[0] - node[0], dz = next[1] - node[1], len = Math.hypot(dx, dz);
      if (!len || (dx * fx + dz * fz) / len < 0.9) continue;
      const ax = dx / len, az = dz / len;
      const d = (p.x - node[0]) ** 2 + (p.z - node[1]) ** 2;
      if (d > distance) continue;
      // Do not treat a shape/continuation vertex as a separate intersection.
      const arms              = [];
      for (const other of roads) {
        if (other.tunnel || other.lanes < 1 || other.pts.length < 2 || (other.layer ?? 0) !== (r.layer ?? 0)) continue;
        for (const start of [true, false]) {
          const a = other.pts[start ? 0 : other.pts.length - 1], b = other.pts[start ? 1 : other.pts.length - 2];
          const ex = b[0] - a[0], ez = b[1] - a[1], length = Math.hypot(ex, ez);
          if (Math.hypot(a[0] - node[0], a[1] - node[1]) < 0.1 && length > 0) {
            arms.push({ fx: ex / length, fz: ez / length, width: other.width || 8, incoming: !other.oneway || !start });
          }
        }
      }
      // A shallow fork is also a junction; only almost-collinear continuations
      // can be ignored. Keep stacked roads out of the same signal plan.
      const crossing = arms.some(a => Math.abs(a.fx * ax + a.fz * az) < Math.cos(Math.PI / 12));
      if (!crossing) continue;
      const incoming = !r.oneway || !atStart;
      if (best && Math.abs(d - distance) < 1e-6) best.incoming ||= incoming;
      else {
        let setback = 4;
        for (const arm of arms) {
          const cross = Math.abs(arm.fx * az - arm.fz * ax);
          if (cross > 0.25) setback = Math.max(setback, arm.width / (2 * cross) + 2);
        }
        distance = d;
        best = { x: node[0], z: node[1], fx: ax, fz: az, incoming, layer: r.layer ?? 0, width: r.width || 8, setback, arms };
      }
    }
  }
  return best;
}
