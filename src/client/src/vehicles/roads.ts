/** Shared road records are reference-counted: OSM polylines occur in multiple tiles. */
import { isIOS } from '@/core/quality';
import type { GameContext } from '@/core/context';
import type { RoadSegment, Tile } from '@shared/world';
import { TILE_SIZE } from '@shared/geo';
import { hash01, KINDS, pickKind } from './kinds';
import { makeCar, ground, poseMatrix, removeBody, type Car } from './model';

export interface Lane {
  key: string;
  road: RoadSegment;
  ax: number; az: number; bx: number; bz: number;
  dx: number; dz: number; length: number;
  start: string; end: string;
  speed: number;
}

const node = (x: number, z: number, layer: number) => `${Math.round(x * 2)},${Math.round(z * 2)},${layer}`;
const roadKey = (r: RoadSegment) => `${r.id}:${r.pts.map(p => p.join(',')).join(';')}`;
const driveable = (r: RoadSegment) => !r.tunnel && !['pedestrian', 'footway', 'cycleway', 'steps'].includes(r.cls);

export const PARKING_INSET = 2.4; // car centre from curb, not from a through-lane centre
const LANE_WIDTH = 3.3;
const TRAFFIC_HALF_WIDTH = Math.max(...Object.values(KINDS).map(s => s.width / 2));
const PARKED_HALF_WIDTH = Math.max(...Object.values(KINDS).filter(s => s.parkedWeight > 0).map(s => s.width / 2));

/** Reserve parking before dividing a one-way carriageway, including odd lane counts. */
export function laneOffsets(r: RoadSegment): number[] {
  if (!r.oneway) return [Math.min(1.65, r.width / 4)];
  if (r.lanes < 3) return [r.lanes === 2 ? LANE_WIDTH / 2 : 0];
  const half = Math.max(0, r.width / 2 - PARKING_INSET - PARKED_HALF_WIDTH - TRAFFIC_HALF_WIDTH - 0.3);
  const count = Math.max(1, Math.min(r.lanes, 1 + Math.floor(2 * half / LANE_WIDTH)));
  return Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * LANE_WIDTH);
}

export const isAvenue = (r: RoadSegment): boolean => r.lanes >= 3 && ['primary', 'secondary'].includes(r.cls)
  && /avenue|broadway|boulevard/i.test(r.name ?? '');

export class Roads {
  tiles = new Map<string, { roads: string[]; parked: Car[]; parkingSlots: number }>();
  lanes = new Map<string, Lane>();
  outgoing = new Map<string, Lane[]>();
  private refs = new Map<string, { count: number; lanes: Lane[] }>();
  constructor(private ctx: GameContext) {}

  load(tile: Tile): void {
    if (this.tiles.has(tile.key)) this.unload(tile.key);
    const record = { roads: [] as string[], parked: [] as Car[], parkingSlots: 0 };
    this.tiles.set(tile.key, record);
    for (const r of tile.roads) {
      if (!driveable(r) || r.pts.length < 2) continue;
      const key = roadKey(r);
      if (record.roads.includes(key)) continue;
      record.roads.push(key);
      const ref = this.refs.get(key);
      if (ref) ref.count++;
      else {
        const lanes: Lane[] = [];
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1];
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (length < 0.5) continue;
          for (const sign of r.oneway ? [1] : [1, -1]) {
            const p = sign === 1 ? a : b, q = sign === 1 ? b : a;
            const dx = (q[0] - p[0]) / length, dz = (q[1] - p[1]) / length;
            const offsets = laneOffsets(r);
            for (const offset of offsets) {
              const lane: Lane = { key: `${key}:${i}:${sign}:${offset}`, road: r, ax: p[0] - dz * offset, az: p[1] + dx * offset,
                bx: q[0] - dz * offset, bz: q[1] + dx * offset, dx, dz, length,
                start: node(p[0], p[1], r.layer), end: node(q[0], q[1], r.layer),
                speed: Math.min(r.maxspeed ?? (r.cls === 'primary' ? 30 : 25), 35) * 0.44704 };
              lanes.push(lane);
              this.lanes.set(lane.key, lane);
              const out = this.outgoing.get(lane.start) ?? [];
              out.push(lane);
              this.outgoing.set(lane.start, out);
            }
          }
        }
        this.refs.set(key, { count: 1, lanes });
      }
      if (!['primary', 'secondary', 'tertiary', 'residential'].includes(r.cls) || r.bridge || r.width < 7) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
        const seed = r.id ^ Math.round(a[0] * 100) ^ Math.imul(Math.round(a[1] * 100), 31);
        let slot = 0;
        for (let d = 9; d < length - 8; slot++) {
          const kind = pickKind('parked', hash01(seed, slot, 1)), spec = KINDS[kind];
          const space = Math.max(6.5, spec.length + 1.5);
          for (const side of r.cls === 'primary' ? [1] : [1, -1]) {
            if (d + spec.length / 2 > length - 6) continue;
            const offset = (r.width / 2 - PARKING_INSET) * side;
            // A narrow two-way street may have no room for curb parking. Never
            // squeeze a parked truck into a live lane merely to fill the fleet.
            const through = r.oneway ? laneOffsets(r) : [-laneOffsets(r)[0], laneOffsets(r)[0]];
            if (through.some(o => Math.abs(offset - o) < spec.width / 2 + TRAFFIC_HALF_WIDTH + 0.3)) continue;
            const x = a[0] + dx * d - dz * offset, z = a[1] + dz * d + dx * offset;
            if (Math.floor(x / TILE_SIZE) !== tile.tx || Math.floor(z / TILE_SIZE) !== tile.tz) continue;
            if (tile.props.some(p => p.kind === 'hydrant' && Math.hypot(p.x - x, p.z - z) < 5 + spec.length / 2)) continue;
            const buildings = this.ctx.modules.get('buildings') as { isInside?: (x: number, z: number) => boolean } | undefined;
            if (buildings?.isInside?.(x, z)) continue;
            // Segment endpoints aren't necessarily intersections (OSM splits a
            // block into short pieces). Also reserve crossing streets' lanes.
            if (tile.roads.some(other => driveable(other) && other.id !== r.id && other.pts.some((p, j) => {
              const q = other.pts[j + 1];
              if (!q || other.layer !== r.layer) return false;
              const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
              if (len < 0.5) return false;
              const ux = (q[0] - p[0]) / len, uz = (q[1] - p[1]) / len;
              const dot = Math.abs(dx * ux + dz * uz), cross = Math.abs(dx * uz - dz * ux);
              if (dot > 0.95) return false;
              const along = (x - p[0]) * ux + (z - p[1]) * uz;
              const end = dot * spec.length / 2 + cross * spec.width / 2;
              if (along < -end || along > len + end) return false;
              const lateral = (x - p[0]) * -uz + (z - p[1]) * ux;
              const offsets = other.oneway ? laneOffsets(other) : [-laneOffsets(other)[0], laneOffsets(other)[0]];
              return offsets.some(o => Math.abs(lateral - o) < cross * spec.length / 2 + dot * spec.width / 2 + TRAFFIC_HALF_WIDTH + 0.5);
            }))) continue;
            if (isIOS() && (x - this.ctx.camera.position.x) ** 2 + (z - this.ctx.camera.position.z) ** 2 > 80 ** 2) continue;
            record.parkingSlots++;
            if (hash01(seed, slot, side * 23) > 0.7) continue;
            const direction = r.oneway ? 1 : side;
            const car = makeCar(`p:${r.id}:${seed}:${slot * 2 + (side === 1 ? 0 : 1)}`, kind, x, ground(this.ctx, x, z), z,
              Math.atan2(-dx * direction, -dz * direction), seed + slot * 7 + side);
            poseMatrix(car);
            record.parked.push(car);
          }
          d += space;
        }
      }
    }
  }

  unload(key: string): void {
    const tile = this.tiles.get(key);
    if (!tile) return;
    for (const car of tile.parked) removeBody(this.ctx, car);
    for (const key of tile.roads) {
      const ref = this.refs.get(key);
      if (!ref || --ref.count > 0) continue;
      for (const lane of ref.lanes) {
        this.lanes.delete(lane.key);
        const out = this.outgoing.get(lane.start)?.filter(l => l !== lane) ?? [];
        if (out.length) this.outgoing.set(lane.start, out);
        else this.outgoing.delete(lane.start);
      }
      this.refs.delete(key);
    }
    this.tiles.delete(key);
  }

  dispose(): void { for (const key of this.tiles.keys()) this.unload(key); }
}
