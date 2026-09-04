/**
 * Roadbed: planimetric asphalt polygons (exact geometry) with per-vertex lane offset / direction / traffic
 * from the nearest centerline; parking lots; service roads and cycleways outside any roadbed as ribbons;
 * full ribbon fallback when a tile has no planimetric roadbeds.
 */
import type { Pt, RoadSegment } from '@shared/world';
import { GroundBuilder, trafficFor, type TileEnv } from './builders';
import { GRID_DIR, VEHICULAR, clipPolylineToRect, dir2, hash2, pointInAny, triangulate, type NearestSample } from './geom2d';
import { KIND } from './materials';

export const ROAD_Y = 0.02;

export function kindForSurface(s: RoadSegment['surface'] | undefined): number {
  if (s === 'cobblestone') return KIND.cobble;
  if (s === 'concrete') return KIND.concreteRoad;
  return KIND.asphalt;
}

const tmpNear = {} as NearestSample;

/** flat polygon into the ground builder, attributes from the nearest vehicular road */
function emitPolygon(env: TileEnv, gb: GroundBuilder, poly: Pt[][], y: number, rand: number, opts: { kind?: number; traffic?: number; lanes?: boolean }): void {
  const tri = triangulate(poly);
  if (!tri) return;
  const base = gb.vertexCount;
  const n = tri.verts.length / 2;
  for (let i = 0; i < n; i++) {
    const x = tri.verts[i * 2], z = tri.verts[i * 2 + 1];
    let kind = opts.kind ?? KIND.asphalt;
    let lane = 0, traffic = opts.traffic ?? 0.3;
    let dc = 1, ds = 0;
    // aA.z carries the road half-width (gutter band, parking lane), aB.z the lane-width code:
    // laneW (+100 when the lane count is even, i.e. lane centres sit at +-laneW/2 from the centreline).
    let halfWidth = 0, laneCode = 0;
    const near = opts.lanes === false ? null : env.roadsV.nearest(x, z, 45, tmpNear);
    if (near) {
      lane = near.side;
      traffic = opts.traffic ?? trafficFor(near.seg) * (near.dist < near.seg.width * 0.6 + 2 ? 1 : 0.5);
      [dc, ds] = dir2(near.dx, near.dz);
      if (opts.kind === undefined) kind = kindForSurface(near.seg.surface);
      // bridge decks are separate geometry; the ground polygon under a viaduct is ordinary asphalt
      const lanes = Math.max(1, Math.min(10, near.seg.lanes || 1));
      const laneW = Math.min(3.3, near.seg.width / lanes);
      halfWidth = opts.traffic === undefined ? near.seg.width / 2 : 0;
      laneCode = laneW + (lanes % 2 === 0 ? 100 : 0);
    } else {
      [dc, ds] = dir2(GRID_DIR[0], GRID_DIR[1]);
    }
    gb.vertex(x, y, z, 0, 1, 0, kind, lane, halfWidth, rand, dc, ds, laneCode, traffic);
  }
  for (let i = 0; i < tri.tris.length; i += 3) gb.tri(base + tri.tris[i], base + tri.tris[i + 1], base + tri.tris[i + 2]);
}

/** mitered ribbon along a polyline; yAt(i) gives the height per input point */
export function ribbon(gb: GroundBuilder, pts: Pt[], hw: number, yAt: (i: number, x: number, z: number) => number, kind: number, traffic: number, rand: number, extraLane = 0): { left: number[]; right: number[] } {
  const n = pts.length;
  const left: number[] = [], right: number[] = [];
  if (n < 2) return { left, right };
  for (let i = 0; i < n; i++) {
    const [x, z] = pts[i];
    let dx = 0, dz = 0;
    if (i > 0) { dx += x - pts[i - 1][0]; dz += z - pts[i - 1][1]; }
    if (i < n - 1) { dx += pts[i + 1][0] - x; dz += pts[i + 1][1] - z; }
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    let scale = 1;
    if (i > 0 && i < n - 1) {
      const ax = x - pts[i - 1][0], az = z - pts[i - 1][1];
      const al = Math.hypot(ax, az) || 1;
      const cosHalf = Math.abs((ax / al) * dx + (az / al) * dz);
      scale = Math.min(1.6, 1 / Math.max(0.6, cosHalf));
    }
    // right of travel = (-dz, dx)
    const rx = -dz * hw * scale, rz = dx * hw * scale;
    const [dc, ds] = dir2(dx, dz);
    const y = yAt(i, x, z);
    left.push(gb.vertex(x - rx, y, z - rz, 0, 1, 0, kind, -hw + extraLane, 0, rand, dc, ds, 0, traffic));
    right.push(gb.vertex(x + rx, y, z + rz, 0, 1, 0, kind, hw + extraLane, 0, rand, dc, ds, 0, traffic));
  }
  for (let i = 0; i + 1 < n; i++) {
    // +y facing (x east, z south): (L_i, R_i+1, L_i+1) and (L_i, R_i, R_i+1)
    gb.tri(left[i], right[i + 1], left[i + 1]);
    gb.tri(left[i], right[i], right[i + 1]);
  }
  return { left, right };
}

export function buildRoadbed(env: TileEnv, gb: GroundBuilder): void {
  const { tile, rect } = env;
  const seed = env.seed;
  let k = 0;
  for (const poly of tile.roadbeds) emitPolygon(env, gb, poly, ROAD_Y, hash2(seed, k++), {});
  for (const poly of tile.parking) emitPolygon(env, gb, poly, ROAD_Y - 0.002, hash2(seed, k++), { traffic: 0.15 });

  const hasRoadbeds = tile.roadbeds.length > 0;
  const seen = new Set<number>();
  for (const r of tile.roads) {
    if (seen.has(r.id) || r.tunnel || r.bridge) continue;
    seen.add(r.id);
    const isCycle = r.cls === 'cycleway';
    const isService = r.cls === 'service';
    const vehicular = VEHICULAR.has(r.cls);
    if (!isCycle && !vehicular) continue;
    if (hasRoadbeds && !isCycle && !isService) continue; // planimetric polygons cover the streets
    const pieces = clipPolylineToRect(r.pts, rect);
    for (const piece of pieces) {
      if (hasRoadbeds) {
        // only where the planimetric roadbed does not already cover it
        const mid = piece.pts[Math.floor(piece.pts.length / 2)];
        const a = piece.pts[0], b = piece.pts[piece.pts.length - 1];
        const covered = pointInAny(mid[0], mid[1], env.roadbeds, 0.2) && pointInAny((a[0] + mid[0]) / 2, (a[1] + mid[1]) / 2, env.roadbeds, 0.2) && pointInAny((b[0] + mid[0]) / 2, (b[1] + mid[1]) / 2, env.roadbeds, 0.2);
        if (covered) continue;
      }
      const hw = isCycle ? 1.4 : Math.max(2.4, r.width / 2);
      ribbon(gb, piece.pts, hw, () => ROAD_Y - (isCycle ? 0.004 : 0.001), kindForSurface(r.surface), isCycle ? 0.1 : trafficFor(r), hash2(seed, r.id));
    }
  }
}
