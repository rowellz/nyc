import { highwayLayout } from './lane-layout.js';
/** Shared, whole-way edges: stable through OSM splits and tile clipping. */
const unit = (x, z) => { const d = Math.hypot(x, z) || 1; return [x / d, z / d]; };
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const width = r => Math.max(3.2, r.width / 2);
const highway = r => r.cls === 'motorway' || r.cls === 'trunk';

export function deckEdges(road, roads, hw, extension = () => [0, 0]) {
  const pts = road.pts, last = pts.length - 1;
  const layout = highwayLayout(road, roads);
  const endInfo = (r, end) => {
    const p = end ? r.pts.at(-1) : r.pts[0], q = end ? r.pts.at(-2) : r.pts[1];
    return { p, outward: unit(p[0] - q[0], p[1] - q[1]) };
  };
  const continuation = (self, end) => {
    const own = endInfo(self, end); let best = null, score = 0.85;
    if (!highway(self)) return null;
    for (const other of roads) {
      if (other.id === self.id || other.tunnel || !highway(other) || other.pts.length < 2) continue;
      for (const otherEnd of [false, true]) {
        if (self.oneway && other.oneway && end === otherEnd) continue;
        const next = endInfo(other, otherEnd);
        if (Math.hypot(own.p[0] - next.p[0], own.p[1] - next.p[1]) > 0.1) continue;
        const dot = -own.outward[0] * next.outward[0] - own.outward[1] * next.outward[1];
        if (dot > score || dot === score && other.id < best?.road.id) {
          score = dot; best = { road: other, end: otherEnd, direction: next.outward };
        }
      }
    }
    return best;
  };
  const joins = [false, true].map(end => {
    const next = continuation(road, end);
    // Pair only reciprocal continuations; a branch must not pull the main road
    // sideways or give the two sides of a seam different target widths.
    if (!next || continuation(next.road, next.end)?.road.id !== road.id) return null;
    return { hw: (hw + width(next.road)) / 2, direction: next.direction, roadId: next.road.id };
  });
  const cumulative = [0];
  for (let i = 1; i < pts.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = cumulative[last];
  const frames = pts.map((p, i) => {
    const before = i > 0 ? unit(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : null;
    const after = i < last ? unit(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]) : null;
    let incoming = before ?? after, outgoing = after ?? before;
    if (i === 0 && joins[0]) incoming = joins[0].direction;
    if (i === last && joins[1]) outgoing = joins[1].direction.map(v => -v);
    if (i === 0 && layout?.ends[0]) incoming = outgoing = layout.ends[0].direction;
    if (i === last && layout?.ends[1]) incoming = outgoing = layout.ends[1].direction;
    const tangent = unit(incoming[0] + outgoing[0], incoming[1] + outgoing[1]);
    const scale = Math.min(1.6, 1 / Math.max(0.6, incoming[0] * tangent[0] + incoming[1] * tangent[1]));
    return { rx: -tangent[1] * scale, rz: tangent[0] * scale };
  });
  const samples = [];
  for (let i = 1; i < pts.length; i++) {
    const size = cumulative[i] - cumulative[i - 1], count = Math.max(1, Math.ceil(size / 4));
    for (let j = i === 1 ? 0 : 1; j <= count; j++) {
      const t = j / count, s = cumulative[i - 1] + size * t;
      let halfWidth = hw;
      for (let end = 0; end < 2; end++) if (joins[end]) {
        const run = Math.min(length / 2, Math.max(24, Math.abs(joins[end].hw - hw) / 0.08));
        halfWidth += (joins[end].hw - hw) * (1 - smooth((end ? length - s : s) / (run || 1)));
      }
      const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
      const rx = frames[i - 1].rx + (frames[i].rx - frames[i - 1].rx) * t, rz = frames[i - 1].rz + (frames[i].rz - frames[i - 1].rz) * t;
      const normal = unit(rx, rz);
      const l = layout ? layout.edge(s,0) : -halfWidth, r = layout ? layout.edge(s,1) : halfWidth;
      const left = [x + rx * l, z + rz * l], right = [x + rx * r, z + rz * r];
      const extra = extension({ s, x, z, left, right, dx: normal[1], dz: -normal[0], continuations: joins.filter(Boolean).map(j => j.roadId) });
      samples.push({ s, x, z, rx, rz, left, right, normal, extra: extra.map(v => Math.max(0, Math.min(1.6, v))) });
    }
  }
  // Preserve the gap coverage while tapering the added width in and out at 1:10.
  // Whole-way passes make this independent of the tile's clipped sample phase.
  for (let side = 0; side < 2; side++) {
    for (let i = 1; i < samples.length; i++) samples[i].extra[side] = Math.max(samples[i].extra[side], samples[i - 1].extra[side] - (samples[i].s - samples[i - 1].s) * 0.1);
    for (let i = samples.length - 2; i >= 0; i--) samples[i].extra[side] = Math.max(samples[i].extra[side], samples[i + 1].extra[side] - (samples[i + 1].s - samples[i].s) * 0.1);
  }
  for (const p of samples) for (let side = 0; side < 2; side++) {
    // Both halves of a paired seam keep the same agreed width.
    if (joins[0]) p.extra[side] = Math.min(p.extra[side], p.s * 0.1);
    if (joins[1]) p.extra[side] = Math.min(p.extra[side], (length - p.s) * 0.1);
    const edge = side ? p.right : p.left, sign = side ? 1 : -1;
    edge[0] += sign * p.normal[0] * p.extra[side]; edge[1] += sign * p.normal[1] * p.extra[side];
  }
  const interval = s => {
    let lo = 0, hi = samples.length - 1;
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (samples[mid].s < s) lo = mid; else hi = mid; }
    const a = samples[lo], b = samples[hi], t = Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s || 1)));
    return { a, b, t };
  };
  const at = s => {
    const { a, b, t } = interval(s);
    return [a.left.map((v, i) => v + (b.left[i] - v) * t), a.right.map((v, i) => v + (b.right[i] - v) * t)];
  };
  // Paint shares the deck's miter and continuation direction, but keeps lane
  // widths in metres: widening a shoulder must not spread the lane lines apart.
  at.line = (s, offset) => {
    const { a, b, t } = interval(s);
    if (layout) offset = layout.offset(s, offset / layout.width + layout.count / 2);
    return [a.x + (b.x - a.x) * t + (a.rx + (b.rx - a.rx) * t) * offset,
      a.z + (b.z - a.z) * t + (a.rz + (b.rz - a.rz) * t) * offset];
  };
  at.layout = layout;
  return at;
}

export function barrierRuns(a, b, open) {
  const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]))), runs = [];
  for (let i = 0; i < count; i++) {
    if (open(a.map((v, k) => v + (b[k] - v) * (i + 0.5) / count))) continue;
    if (runs.length && runs.at(-1)[1] === i) runs.at(-1)[1] = i + 1;
    else runs.push([i, i + 1]);
  }
  return runs.map(([start, end]) => [a.map((v, k) => v + (b[k] - v) * start / count), a.map((v, k) => v + (b[k] - v) * end / count)]);
}
