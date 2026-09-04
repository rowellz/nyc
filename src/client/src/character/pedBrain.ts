/** Behaviour-only crowd helpers. Distances are metres, speeds metres/second. */
import { xzToLonLat } from '@shared/geo';
import type { RoadSegment } from '@shared/world';

export const PARK_SEAT_RADIUS = 60;
/** Extra batched slots, not extra full-animation rigs. Leaves room for offscreen retirement. */
export const PARK_SEAT_CAPACITY = 612;
export interface SittingSeat { x: number; z: number; yaw: number }

/** Character convention: forward is -Z. Prefer a companion across the same small table. */
export function facingSeat<T extends SittingSeat>(seat: T, seats: readonly T[]): T | undefined {
  let best: T | undefined, nearest = 2.6;
  for (const other of seats) {
    const dx = other.x - seat.x, dz = other.z - seat.z, d = Math.hypot(dx, dz);
    if (d < 1.05 || d >= nearest) continue;
    if ((-Math.sin(seat.yaw) * dx - Math.cos(seat.yaw) * dz) / d < 0.78
      || (Math.sin(other.yaw) * dx + Math.cos(other.yaw) * dz) / d < 0.78) continue;
    best = other; nearest = d;
  }
  return best;
}

/** Stable, spatially mixed fill order, with facing pairs adjacent instead of a solid occupied strip. */
export function seatFillOrder<T extends SittingSeat>(seats: readonly T[]): T[] {
  const hash = (s: T) => {
    let h = Math.imul(Math.round(s.x * 100), 73856093) ^ Math.imul(Math.round(s.z * 100), 19349663);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    return (h ^ (h >>> 13)) >>> 0;
  };
  const sorted = [...seats].sort((a, b) => hash(a) - hash(b));
  const pending = new Set(sorted), result: T[] = [];
  for (const seat of sorted) {
    if (!pending.delete(seat)) continue;
    result.push(seat);
    const pair = facingSeat(seat, sorted);
    if (pair && pending.delete(pair)) result.push(pair);
  }
  return result;
}

/** ART_DIRECTION §6: people per metre of sidewalk, before the renderer's global cap. */
export function sidewalkDensity(road: RoadSegment, x: number, z: number, hour: number, park: boolean): number {
  const { lat, lon } = xzToLonLat(x, z);
  const night = hour < 7 || hour >= 20;
  const late = hour < 6 ? 0.45 : 1;
  if (park) return night ? 0.05 : 0.6;
  const timesSquare = lat > 40.755 && lat < 40.761 && lon > -73.989 && lon < -73.981;
  if (timesSquare) return (night ? 1.5 : 1.25) * late;
  if (road.cls === 'footway' || road.cls === 'pedestrian') return (night ? 0.3 : 0.6) * late;
  const midtown = lat > 40.74 && lat < 40.77;
  const avenue = /avenue|\bave?\b|broadway/i.test(road.name ?? '') || (!road.name && road.cls === 'primary');
  if (midtown) return (avenue ? (night ? 0.7 : 1.1) : (night ? 0.4 : 0.6)) * late;
  return (night ? 0.25 : 0.4) * late;
}

export interface Neighbour { x: number; z: number }
/** A reused 2 m grid replaces all-pairs avoidance; no rig work and no per-ped tree allocations. */
export class PedGrid<T extends Neighbour> {
  private cells = new Map<number, T[]>();
  private pool: T[][] = [];
  private result: T[] = [];
  private key(x: number, z: number): number { return x * 65536 + z; }
  rebuild(items: T[]): void {
    for (const bucket of this.cells.values()) { bucket.length = 0; this.pool.push(bucket); }
    this.cells.clear();
    for (const item of items) this.add(item);
  }
  add(item: T): void {
    const key = this.key(Math.floor(item.x / 2), Math.floor(item.z / 2));
    let bucket = this.cells.get(key);
    if (!bucket) { bucket = this.pool.pop() ?? []; this.cells.set(key, bucket); }
    bucket.push(item);
  }
  move(item: T, oldX: number, oldZ: number): void {
    const old = this.key(Math.floor(oldX / 2), Math.floor(oldZ / 2));
    if (old === this.key(Math.floor(item.x / 2), Math.floor(item.z / 2))) return;
    const bucket = this.cells.get(old);
    if (bucket) { const i = bucket.indexOf(item); if (i >= 0) bucket.splice(i, 1); }
    this.add(item);
  }
  near(x: number, z: number, radius = 2): T[] {
    const out = this.result; out.length = 0;
    for (let ix = Math.floor((x - radius) / 2); ix <= Math.floor((x + radius) / 2); ix++)
      for (let iz = Math.floor((z - radius) / 2); iz <= Math.floor((z + radius) / 2); iz++) {
        const bucket = this.cells.get(this.key(ix, iz));
        if (bucket) for (const p of bucket) out.push(p);
      }
    return out;
  }
}
