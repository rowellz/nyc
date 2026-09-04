import type { Prop, RoadSegment } from '@shared/world';

export interface SignalApproach { x: number; z: number; fx: number; fz: number; incoming: boolean }

/** Generated poles include every segment end, including exits of one-way roads.
 * Recover their common intersection node, not the corner/pole position. */
export function signalApproach(p: Prop, roads: readonly RoadSegment[]): SignalApproach | null {
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let best: SignalApproach | null = null, distance = 35 ** 2;
  for (const r of roads) {
    if (r.tunnel || r.lanes < 1 || r.pts.length < 2) continue;
    for (const atStart of [true, false]) {
      const node = r.pts[atStart ? 0 : r.pts.length - 1];
      const next = r.pts[atStart ? 1 : r.pts.length - 2];
      const dx = next[0] - node[0], dz = next[1] - node[1], len = Math.hypot(dx, dz);
      if (!len || (dx * fx + dz * fz) / len < 0.9) continue;
      const d = (p.x - node[0]) ** 2 + (p.z - node[1]) ** 2;
      if (d > distance) continue;
      // Do not treat a shape/continuation vertex as a separate intersection.
      const crossing = roads.some(other => other !== r && !other.tunnel && other.lanes >= 1 && other.pts.length >= 2
        && [true, false].some(start => {
          const a = other.pts[start ? 0 : other.pts.length - 1], b = other.pts[start ? 1 : other.pts.length - 2];
          const ex = b[0] - a[0], ez = b[1] - a[1], length = Math.hypot(ex, ez);
          return Math.hypot(a[0] - node[0], a[1] - node[1]) < 1 && length > 0 && Math.abs((ex * fx + ez * fz) / length) < 0.8;
        }));
      if (!crossing) continue;
      const incoming = !r.oneway || !atStart;
      if (best && Math.abs(d - distance) < 1e-6) best.incoming ||= incoming;
      else { distance = d; best = { x: node[0], z: node[1], fx, fz, incoming }; }
    }
  }
  return best;
}
