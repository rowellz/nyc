/** Placement glue for the author's paint/utility atlas. One merged mesh per tile. */
import type { Crossing, Pt, Tile } from '@shared/world';
import { TILE_SIZE } from '@shared/geo';
import { MarkBuilder, type TileEnv } from './builders';
import { clipPolylineToRect, hash2, pointAlong, polylineLength, yawToDir } from './geom2d';
import { ROAD_Y } from './roadbed';
import { WALK_Y, type SidewalkResult } from './sidewalk';
import type { SurfaceGrid } from './surface';
import { ATLAS } from './textures';

/** Crossings have one data owner, but their paint can span two rendered tiles. */
export function crossingsInTile(tile: Tile, neighbors: Iterable<Tile>): Crossing[] {
  const found = new Map<string, Crossing>();
  const ox = tile.tx * TILE_SIZE, oz = tile.tz * TILE_SIZE;
  for (const other of neighbors) for (const c of other.crossings) {
    const reach = c.width / 2 + 5;
    if (c.x + reach < ox || c.x - reach > ox + TILE_SIZE || c.z + reach < oz || c.z - reach > oz + TILE_SIZE) continue;
    found.set(`${c.x}:${c.z}:${c.yaw}`, c);
  }
  return [...found.values()];
}

export function buildMarkings(env: TileEnv, marks: MarkBuilder, grid: SurfaceGrid, walks: SidewalkResult, paintHeightAt = env.deckAt): void {
  const owned = (x: number, z: number) => x >= grid.ox && x < grid.ox + TILE_SIZE && z >= grid.oz && z < grid.oz + TILE_SIZE;
  const clip = { minX: grid.ox, minZ: grid.oz, maxX: grid.ox + TILE_SIZE, maxZ: grid.oz + TILE_SIZE };
  /** road frame for the wear shader: (rx, rz, c, laneCode) with lane offset = dot(p, (rx, rz)) - c */
  const frameAt = (x: number, z: number): number[] => {
    const near = env.roadsV.nearest(x, z, 30);
    if (!near) return [0, 0, 0, 0];
    const rx = -near.dz, rz = near.dx;
    const lanes = Math.max(1, Math.min(10, near.seg.lanes || 1));
    return [rx, rz, x * rx + z * rz - near.side, Math.min(3.3, near.seg.width / lanes) + (lanes % 2 === 0 ? 100 : 0)];
  };
  const paint = (x: number, z: number, dx: number, dz: number, len: number, width: number, region: readonly number[] = ATLAS.white, stretch = false) => {
    // A bar can straddle a curb: corner-only samples interpolate below the plaza
    // at its centre. Retain that paving clearance without flattening bridge ramps.
    const paving = Math.max(0, paintHeightAt(x, z) - env.deckAt(x, z));
    const heightAt = (px: number, pz: number) => Math.max(paintHeightAt(px, pz), env.deckAt(px, pz) + paving);
    marks.quad(x, z, ROAD_Y + 0.012, dx, dz, len, width, region, stretch ? 1 : 0, 0.66 + hash2(x, z) * 0.3, 0, 0, 1, heightAt, frameAt(x, z), clip);
    grid.paint.push({ cx: x, cz: z, dx, dz, hl: len / 2, hw: width / 2 });
  };
  /** oil drips where cars idle at a signal: a few lane-centre stains just behind the stop line */
  const oil = (x: number, z: number, dx: number, dz: number, seed: number) => {
    if (!owned(x, z)) return;
    const h = hash2(seed, x + z);
    if (h > 0.3) return;
    marks.quad(x, z, ROAD_Y + 0.010, dx, dz, 0.45 + 0.55 * h, 0.2 + 0.2 * hash2(seed + 1, z), ATLAS.oil, 1, 0.55 + 0.3 * h, 0, 0, 1, env.deckAt);
  };
  for (const { seg: r } of env.roadsV.segs) {
    if (r.tunnel || r.lanes < 1 || r.cls === 'service') continue;
    const lanes = Math.max(1, Math.min(10, r.lanes));
    const laneW = Math.min(3.3, r.width / lanes);
    const total = polylineLength(r.pts);
    const line = (offset: number, dashed: boolean, region: readonly number[]) => {
      let along = 0;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 0.01) continue;
        const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
        const pts: Pt[] = [[a[0] - dz * offset, a[1] + dx * offset], [b[0] - dz * offset, b[1] + dx * offset]];
        for (const piece of clipPolylineToRect(pts, env.rect)) {
          const start = Math.max(along + piece.s0, 7);
          const end = Math.min(along + piece.s0 + polylineLength(piece.pts), total - 7);
          // Dash phase comes from the uncut source road, including across tile boundaries.
          for (let s = dashed ? Math.floor(start / 12) * 12 : start; s < end; s += dashed ? 12 : 3) {
            const lo = Math.max(start, s), hi = Math.min(end, s + 3);
            if (hi <= lo) continue;
            const d = (lo + hi) / 2 - along;
            const x = pts[0][0] + dx * d, z = pts[0][1] + dz * d;
            if (env.tile.crossings.some(c => Math.hypot(c.x - x, c.z - z) < 4)) continue;
            paint(x, z, dx, dz, hi - lo, 0.12, region);
          }
        }
        along += len;
      }
    };
    for (let lane = 1; lane < lanes; lane++) {
      if (!r.oneway && lane === Math.floor(lanes / 2)) continue;
      line((lane - lanes / 2) * laneW, true, ATLAS.white);
    }
    if (!r.oneway && lanes >= 2) {
      line(-0.13, false, ATLAS.yellow);
      line(0.13, false, ATLAS.yellow);
    }
    if (r.width > lanes * laneW + 2 || r.cls === 'motorway' || r.cls === 'trunk') {
      line(-lanes * laneW / 2, false, ATLAS.white);
      line(lanes * laneW / 2, false, ATLAS.white);
    }
    if (r.oneway && lanes > 1 && total > 32 && env.ctx.quality.level !== 'low') {
      const q = pointAlong(r.pts, total - 20);
      for (let lane = 0; lane < lanes; lane++) {
        const offset = (lane + 0.5 - lanes / 2) * laneW;
        const x = q.x - q.dz * offset, z = q.z + q.dx * offset;
        if (owned(x, z)) paint(x, z, q.dx, q.dz, 4, 1.4, lane === 0 ? ATLAS.arrowLeft : lane === lanes - 1 ? ATLAS.arrowRight : ATLAS.arrowStraight, true);
      }
    }
  }
  for (const c of env.tile.crossings) {
    const [dx, dz] = yawToDir(c.yaw);
    const rx = -dz, rz = dx;
    for (let s = -c.width / 2 + 0.5; s < c.width / 2; s += 1) paint(c.x + dx * s, c.z + dz * s, rx, rz, 3, 0.4);
    for (const side of [-1, 1]) paint(c.x + rx * 1.65 * side, c.z + rz * 1.65 * side, dx, dz, c.width, 0.12);
    const near = env.roadsV.nearest(c.x, c.z, 30);
    if (near) {
      const directions = near.seg.oneway ? [1] : [-1, 1];
      for (const side of directions) {
        const shift = near.seg.oneway ? 0 : near.seg.width / 4;
        paint(c.x - near.dx * side * 3.6 - near.dz * side * shift, c.z - near.dz * side * 3.6 + near.dx * side * shift,
          -near.dz, near.dx, near.seg.width / (near.seg.oneway ? 1 : 2), 0.6);
      }
      if (c.signal && near.seg.oneway && env.ctx.quality.level !== 'low') {
        const lanes = Math.max(1, Math.min(10, near.seg.lanes)), laneW = Math.min(3.3, near.seg.width / lanes);
        for (let lane = 0; lane < lanes; lane++) {
          const h = hash2(c.x + lane * 13.7, c.z);
          if (h > 0.6) continue;
          const offset = (lane + 0.5 - lanes / 2) * laneW, back = 5.5 + 4 * hash2(c.z + lane, c.x);
          oil(c.x - near.dx * back - near.dz * offset, c.z - near.dz * back + near.dx * offset, near.dx, near.dz, lane + 1);
        }
      }
    } else {
      // A Crossing is authoritative even when its centerline is plaza-adjacent
      // or not streamed yet. Its yaw supplies the across-road stop-bar axis.
      for (const side of [-1, 1]) paint(c.x + rx * 3.6 * side, c.z + rz * 3.6 * side, dx, dz, c.width, 0.6);
    }
  }
  const metal = (x: number, z: number, dx: number, dz: number, len: number, width: number, y: number, region: readonly number[], tiled = false) => {
    marks.quad(x, z, y, dx, dz, len, width, region, tiled ? 0 : 1, 1, 1, 0, 1, env.deckAt);
    grid.metal.push({ cx: x, cz: z, dx, dz, hl: len / 2, hw: width / 2 });
  };
  for (const p of env.tile.props) {
    const [dx, dz] = yawToDir(p.yaw);
    if (p.kind === 'manhole') metal(p.x, p.z, dx, dz, 0.8, 0.8, ROAD_Y + 0.016, ATLAS.manhole);
    if (p.kind === 'trash_can' && env.ctx.quality.level !== 'low' && owned(p.x, p.z)) {
      // drips and spills around the base of a litter basket
      const h = hash2(p.x, p.z), h2 = hash2(p.z, p.x + 3);
      marks.quad(p.x + dx * 0.15, p.z + dz * 0.15, WALK_Y + 0.012, dx, dz, 1.2 + 0.7 * h, 0.9 + 0.5 * h2, ATLAS.oil, 1, 0.5 + 0.3 * h, 0, 0, 1, env.deckAt);
    }
    if (p.kind === 'sewer_grate') metal(p.x, p.z, dx, dz, 0.9, 0.55, ROAD_Y + 0.012, ATLAS.sewerGrate);
    if (p.kind === 'subway_grate') metal(p.x, p.z, dx, dz, p.len ?? 6, 1.2, WALK_Y + 0.012, ATLAS.subwayGrate, true);
  }
  // The current dataset has no sewer_grate props: place one by each distinct nearby crosswalk curb.
  const used = new Set<number>();
  for (const c of env.tile.crossings) {
    for (const side of [-1, 1]) {
      const [dx, dz] = yawToDir(c.yaw);
      const x = c.x + dx * c.width * side / 2, z = c.z + dz * c.width * side / 2;
      let best = -1, distance = 5, fraction = 0;
      walks.curbs.forEach((edge, i) => {
        const ex = edge.bx - edge.ax, ez = edge.bz - edge.az, l2 = ex * ex + ez * ez;
        if (l2 < 4 || used.has(i)) return;
        const t = Math.max(0.1, Math.min(0.9, ((x - edge.ax) * ex + (z - edge.az) * ez) / l2));
        const d = Math.hypot(x - edge.ax - ex * t, z - edge.az - ez * t);
        if (d < distance) { best = i; distance = d; fraction = t; }
      });
      if (best < 0) continue;
      used.add(best);
      const e = walks.curbs[best], len = Math.hypot(e.bx - e.ax, e.bz - e.az);
      const tx = (e.bx - e.ax) / len, tz = (e.bz - e.az) / len;
      const cx = e.ax + (e.bx - e.ax) * fraction, cz = e.az + (e.bz - e.az) * fraction;
      metal(cx + e.nx * 0.35, cz + e.nz * 0.35, tx, tz, 0.9, 0.5, ROAD_Y + 0.012, ATLAS.sewerGrate);
      marks.wallQuad(cx + e.nx * 0.008, 0.07, cz + e.nz * 0.008, tx, tz, e.nx, e.nz, 1, 0.12, ATLAS.curbInlet, 1, 1);
    }
  }
}
