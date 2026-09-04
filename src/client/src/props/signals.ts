/**
 * Traffic signal state machine.
 *  - signal poles are clustered into intersections (within 20 m; clusters can span tile borders)
 *  - each cluster has two phases: A = approaches roughly parallel to the first pole's facing, B = the rest
 *  - NYC timing: 90 s cycle. A green 40 s, yellow 3 s, all-red 2 s, B green 40 s, yellow 3 s, all-red 2 s.
 *    Pedestrian: WALK for the first 20 s of the parallel green, then a flashing hand countdown (20..1)
 *    ending as the yellow starts, steady hand otherwise.
 *  - offset per intersection: a green wave along the Manhattan avenue axis (uptown heading 29 deg) at 25 mph
 *    (~11 m/s) plus a small seeded jitter, so avenues read as a wave and cross streets differ.
 *  - the clock is ctx.state.serverTime(), so every client shows the same state.
 */
import { hash01 } from './builder';
import type { SignalApproach } from './signalPlacement';

export const CYCLE = 90;
export const GREEN = 40;
export const YELLOW = 3;
export const ALL_RED = 2;
const HALF = GREEN + YELLOW + ALL_RED; // 45
export const WALK = 20;

export type SignalState = 0 | 1 | 2; // red, yellow, green

export interface SignalPole {
  x: number;
  z: number;
  /** unit vector the heads face (toward the oncoming traffic) */
  fx: number;
  fz: number;
  cluster: Cluster;
  /** 0 = phase A, 1 = phase B */
  phase: 0 | 1;
  tileKey: string;
}

export interface Cluster {
  id: number;
  cx: number;
  cz: number;
  poles: SignalPole[];
  offset: number;
  /** facing of the phase-A reference */
  ax: number;
  az: number;
}

const UPTOWN_X = Math.sin((29 * Math.PI) / 180);
const UPTOWN_Z = -Math.cos((29 * Math.PI) / 180);
const WAVE_SPEED = 11.2; // m/s

export class SignalNetwork {
  clusters: Cluster[] = [];
  poles: SignalPole[] = [];
  private grid = new Map<string, Cluster[]>();
  private poleGrid = new Map<number, Map<number, SignalPole[]>>();
  private poleOrder = new WeakMap<SignalPole, number>();
  private poleSeq = 0;
  private seq = 1;
  private approaches = new Map<string, (SignalApproach & { owner: string })[]>();

  /** One mast per incoming node/direction, shared across overlapping tiles. */
  claimApproach(a: SignalApproach, owner: string): boolean {
    if (!a.incoming) return false;
    const key = `${Math.round(a.x * 10)}:${Math.round(a.z * 10)}`;
    const entries = this.approaches.get(key) ?? [];
    if (entries.some(b => a.fx * b.fx + a.fz * b.fz > 0.95)) return false;
    entries.push({ ...a, owner });
    this.approaches.set(key, entries);
    return true;
  }

  /** Placement generators keep this network by identity while tiles interleave. */
  resetPoles(): void {
    this.clusters = [];
    this.poles = [];
    this.grid.clear();
    this.poleGrid.clear();
    this.poleOrder = new WeakMap();
    this.poleSeq = 0;
    this.seq = 1;
  }

  private gridKey(x: number, z: number): string {
    return `${Math.floor(x / 32)}_${Math.floor(z / 32)}`;
  }

  private findCluster(x: number, z: number): Cluster | null {
    const gx = Math.floor(x / 32), gz = Math.floor(z / 32);
    let best: Cluster | null = null;
    let bestD = 20 * 20;
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const list = this.grid.get(`${gx + i}_${gz + j}`);
        if (!list) continue;
        for (const c of list) {
          const d = (c.cx - x) ** 2 + (c.cz - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    return best;
  }

  addPole(x: number, z: number, yaw: number, tileKey: string): SignalPole {
    // yaw convention: local -z faces (sin(-yaw)?)... geo.ts: yaw = -heading; forward = (sin(heading), -cos(heading))
    const heading = -yaw;
    const fx = Math.sin(heading), fz = -Math.cos(heading);
    let c = this.findCluster(x, z);
    if (!c) {
      c = { id: this.seq++, cx: x, cz: z, poles: [], offset: 0, ax: fx, az: fz };
      const k = this.gridKey(x, z);
      const list = this.grid.get(k);
      if (list) list.push(c);
      else this.grid.set(k, [c]);
      c.offset = this.offsetFor(c);
    }
    const dot = fx * c.ax + fz * c.az;
    const phase: 0 | 1 = Math.abs(dot) > 0.5 ? 0 : 1;
    const pole: SignalPole = { x, z, fx, fz, cluster: c, phase, tileKey };
    c.poles.push(pole);
    this.poles.push(pole);
    const gx = Math.floor(x / 32), gz = Math.floor(z / 32);
    let column = this.poleGrid.get(gx);
    if (!column) { column = new Map(); this.poleGrid.set(gx, column); }
    let bucket = column.get(gz);
    if (!bucket) { bucket = []; column.set(gz, bucket); }
    bucket.push(pole);
    this.poleOrder.set(pole, this.poleSeq++);
    // keep the centroid current (the grid key stays where it was created; fine within 20 m)
    let sx = 0, sz = 0;
    for (const p of c.poles) {
      sx += p.x;
      sz += p.z;
    }
    c.cx = sx / c.poles.length;
    c.cz = sz / c.poles.length;
    if (!this.clusters.includes(c)) this.clusters.push(c);
    return pole;
  }

  private offsetFor(c: Cluster): number {
    // is the phase-A axis the avenue axis? then the wave applies to the projection along uptown
    const along = c.cx * UPTOWN_X + c.cz * UPTOWN_Z;
    const wave = (along / WAVE_SPEED) % CYCLE;
    const jitter = (hash01(Math.round(c.cx), Math.round(c.cz)) - 0.5) * 6;
    // avenues (phase A parallel to uptown) get the wave; cross streets get the wave plus half a cycle
    const avenueLike = Math.abs(c.ax * UPTOWN_X + c.az * UPTOWN_Z) > 0.7;
    return ((avenueLike ? wave : wave + HALF) + jitter + CYCLE * 4) % CYCLE;
  }

  removeTile(tileKey: string): void {
    for (const [key, entries] of this.approaches) {
      const keep = entries.filter(a => a.owner !== tileKey);
      if (keep.length) this.approaches.set(key, keep);
      else this.approaches.delete(key);
    }
    const keep: SignalPole[] = [];
    for (const p of this.poles) {
      if (p.tileKey === tileKey) {
        const i = p.cluster.poles.indexOf(p);
        if (i >= 0) p.cluster.poles.splice(i, 1);
        const gx = Math.floor(p.x / 32), gz = Math.floor(p.z / 32);
        const column = this.poleGrid.get(gx)!, bucket = column.get(gz)!;
        bucket.splice(bucket.indexOf(p), 1);
        if (!bucket.length) column.delete(gz);
        if (!column.size) this.poleGrid.delete(gx);
      } else keep.push(p);
    }
    this.poles = keep;
    // drop empty clusters
    this.clusters = this.clusters.filter((c) => c.poles.length > 0);
    for (const [k, list] of this.grid) {
      const filtered = list.filter((c) => c.poles.length > 0);
      if (filtered.length) this.grid.set(k, filtered);
      else this.grid.delete(k);
    }
  }

  /** phase time 0..90 for a cluster */
  static phaseTime(c: Cluster, serverTime: number): number {
    return (((serverTime + c.offset) % CYCLE) + CYCLE) % CYCLE;
  }

  /** vehicle state for a phase group at phase time t */
  static vehicleState(phase: 0 | 1, t: number): SignalState {
    const local = phase === 0 ? t : (t + HALF) % CYCLE;
    if (local < GREEN) return 2;
    if (local < GREEN + YELLOW) return 1;
    return 0;
  }

  /**
   * pedestrian frame for the crossing PARALLEL to `phase` traffic (walk when that phase is green):
   * 0 walk, 1 steady hand, 2 blank (flash off), 3.. countdown (frame = 32 - n)
   */
  static pedFrame(phase: 0 | 1, t: number): number {
    const local = phase === 0 ? t : (t + HALF) % CYCLE;
    if (local < WALK) return 0;
    if (local < GREEN) {
      const remaining = Math.ceil(GREEN - local); // 20..1
      const n = Math.max(1, Math.min(29, remaining));
      // flash the hand at 1 Hz: on for the first half of each second
      const flashOff = local - Math.floor(local) > 0.5;
      return flashOff ? 32 - n : 32 - n; // digits stay; hand flashes via the frame table (kept steady for legibility)
    }
    return 1;
  }

  /** signal for a vehicle at (x,z) heading (dx,dz): nearest pole facing it within 25 m ahead */
  signalFor(x: number, z: number, dx: number, dz: number, serverTime: number): { state: 'red' | 'yellow' | 'green'; stopX: number; stopZ: number; dist: number } | null {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(dx)
      || !Number.isFinite(dz) || !Number.isFinite(serverTime)) return null;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    dx /= len;
    dz /= len;
    let best: SignalPole | null = null;
    let bestAhead = Infinity;
    let bestOrder = Infinity;
    const x0 = Math.floor((x - 25) / 32), x1 = Math.floor((x + 25) / 32);
    const z0 = Math.floor((z - 25) / 32), z1 = Math.floor((z + 25) / 32);
    for (let ix = 0; ix < 3; ix++) {
      const gx = x0 + ix;
      if (gx > x1) break;
      const column = this.poleGrid.get(gx);
      if (!column) continue;
      for (let iz = 0; iz < 3; iz++) {
        const gz = z0 + iz;
        if (gz > z1) break;
        const bucket = column.get(gz);
        if (!bucket) continue;
        for (const p of bucket) {
          const ox = p.x - x, oz = p.z - z;
          const d2 = ox * ox + oz * oz;
          if (d2 > 25 * 25) continue;
          // the pole faces the vehicle: its facing is opposite to the travel direction
          if (p.fx * dx + p.fz * dz > -0.7) continue;
          const ahead = ox * dx + oz * dz; // distance along travel
          if (ahead < -2) continue;
          const lateral = Math.abs(ox * dz - oz * dx);
          if (lateral > 14) continue;
          // Grid traversal must retain the original insertion-order tie break.
          const order = this.poleOrder.get(p)!;
          if (ahead < bestAhead || (ahead === bestAhead && order < bestOrder)) {
            bestAhead = ahead;
            bestOrder = order;
            best = p;
          }
        }
      }
    }
    if (!best) return null;
    const c = best.cluster;
    const t = SignalNetwork.phaseTime(c, serverTime);
    const s = SignalNetwork.vehicleState(best.phase, t);
    // stop line: mirror the pole across the intersection center along its facing, 1 m before the crossing
    const D = Math.max(4, (c.cx - best.x) * best.fx + (c.cz - best.z) * best.fz);
    const stopX = c.cx + best.fx * (D + 1.0), stopZ = c.cz + best.fz * (D + 1.0);
    const dist = (stopX - x) * dx + (stopZ - z) * dz;
    if (dist > 25) return null;
    return { state: s === 2 ? 'green' : s === 1 ? 'yellow' : 'red', stopX, stopZ, dist };
  }
}
