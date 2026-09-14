/** Junction-based signals. Opposing approaches share a phase; distinct axes
 * receive separate greens. Ordinary four-way junctions retain the 90 s cycle.
 * Complex junctions include an exclusive pedestrian interval. All timing uses
 * server time and geometry, independent of tile/pole insertion order. */
import { hash01 } from './builder';
import type { SignalApproach, SignalArm } from './signalPlacement';

export const CYCLE = 90;
export const GREEN = 40;
export const YELLOW = 3;
export const ALL_RED = 2;
const HALF = GREEN + YELLOW + ALL_RED; // 45
const AXIS_DOT = Math.cos(Math.PI / 12); // 15 degrees, pairwise (no chained groups)
const PED_WALK = 7;
const PED_CLEAR = 20;
export const WALK = 20;

export type SignalState = 0 | 1 | 2; // red, yellow, green

export interface SignalPole {
  x: number;
  z: number;
  /** unit vector the heads face (toward the oncoming traffic) */
  fx: number;
  fz: number;
  cluster: Cluster;
  /** Index into the junction's mutually exclusive approach groups. */
  phase: number;
  approach?: SignalApproach;
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
  junction?: string;
  phaseCount: number;
  cycle: number;
  allRed: number;
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
  private junctions = new Map<string, Cluster>();
  private approaches = new Map<string, (SignalApproach & { owner: string })[]>();

  /** One mast per incoming node/direction, shared across overlapping tiles. */
  claimApproach(a: SignalApproach, owner: string): boolean {
    if (!a.incoming) return false;
    const key = `${Math.round(a.x * 10)}:${Math.round(a.z * 10)}:${a.layer ?? 0}`;
    const entries = this.approaches.get(key) ?? [];
    if (entries.some(b => a.fx * b.fx + a.fz * b.fz > 0.999)) return false;
    entries.push({ ...a, owner });
    this.approaches.set(key, entries);
    return true;
  }

  /** Placement generators keep this network by identity while tiles interleave. */
  resetPoles(): void {
    this.clusters = [];
    this.poles = [];
    this.grid.clear();
    this.junctions.clear();
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
          if (c.junction) continue;
          const d = (c.cx - x) ** 2 + (c.cz - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    return best;
  }

  addPole(x: number, z: number, yaw: number, tileKey: string, approach?: SignalApproach | null): SignalPole {
    // yaw convention: local -z faces (sin(-yaw)?)... geo.ts: yaw = -heading; forward = (sin(heading), -cos(heading))
    const heading = -yaw;
    const fx = approach?.fx ?? Math.sin(heading), fz = approach?.fz ?? -Math.cos(heading);
    const junction = approach ? `${Math.round(approach.x * 10)}:${Math.round(approach.z * 10)}:${approach.layer ?? 0}` : undefined;
    let c = junction ? this.junctions.get(junction) : this.findCluster(x, z);
    if (!c) {
      c = { id: this.seq++, cx: approach?.x ?? x, cz: approach?.z ?? z, poles: [], offset: 0, ax: fx, az: fz, junction, phaseCount: 2, cycle: CYCLE, allRed: ALL_RED };
      if (junction) this.junctions.set(junction, c);
      const k = this.gridKey(x, z);
      const list = this.grid.get(k);
      if (list) list.push(c);
      else this.grid.set(k, [c]);
      c.offset = this.offsetFor(c);
    }
    const pole: SignalPole = { x, z, fx, fz, cluster: c, phase: 0, tileKey, approach: approach ?? undefined };
    c.poles.push(pole);
    this.poles.push(pole);
    const stop = this.stopFor(pole);
    const gx = Math.floor(stop.x / 32), gz = Math.floor(stop.z / 32);
    let column = this.poleGrid.get(gx);
    if (!column) { column = new Map(); this.poleGrid.set(gx, column); }
    let bucket = column.get(gz);
    if (!bucket) { bucket = []; column.set(gz, bucket); }
    bucket.push(pole);
    this.poleOrder.set(pole, this.poleSeq++);
    this.plan(c);
    if (!this.clusters.includes(c)) this.clusters.push(c);
    return pole;
  }

  private plan(c: Cluster): void {
    // Full road arms keep phases stable even if only one corner is loaded or
    // selected for mobile rendering. Sort axes so reversing tile order is harmless.
    const arms: Pick<SignalArm, 'fx' | 'fz'>[] = c.poles.flatMap(p => p.approach?.arms.filter(a => a.incoming) ?? [p]);
    const angle = (a: { fx: number; fz: number }) => ((Math.atan2(a.fz, a.fx) % Math.PI) + Math.PI) % Math.PI;
    arms.sort((a, b) => angle(a) - angle(b));
    const groups: typeof arms[] = [];
    for (const arm of arms) {
      let group = groups.find(g => g.every(a => Math.abs(a.fx * arm.fx + a.fz * arm.fz) >= AXIS_DOT));
      if (!group) groups.push(group = []);
      group.push(arm);
    }
    // Put the avenue axis first, retaining the existing green-wave convention.
    groups.sort((a, b) => Math.abs(b[0].fx * UPTOWN_X + b[0].fz * UPTOWN_Z)
      - Math.abs(a[0].fx * UPTOWN_X + a[0].fz * UPTOWN_Z) || angle(a[0]) - angle(b[0]));
    c.phaseCount = Math.max(2, groups.length);
    for (const p of c.poles) {
      p.phase = groups.findIndex(g => g.every(a => Math.abs(a.fx * p.fx + a.fz * p.fz) >= AXIS_DOT));
      // Authored head yaw can differ a few degrees from the road tangent.
      if (p.phase < 0) p.phase = groups.reduce((best, g, i) => Math.abs(g[0].fx * p.fx + g[0].fz * p.fz)
        > Math.abs(groups[best][0].fx * p.fx + groups[best][0].fz * p.fz) ? i : best, 0);
    }
    c.ax = groups[0]?.[0].fx ?? c.ax; c.az = groups[0]?.[0].fz ?? c.az;
    let span = 0;
    for (const p of c.poles) if (p.approach) {
      for (const a of p.approach.arms) for (const b of p.approach.arms) {
        const cross = Math.abs(a.fx * b.fz - a.fz * b.fx);
        if (cross > 0.25) span = Math.max(span, b.width / cross + 4);
      }
    }
    c.allRed = Math.max(ALL_RED, Math.min(6, Math.ceil(span / 10) - 1));
    c.cycle = CYCLE + (c.phaseCount > 2 ? PED_WALK + PED_CLEAR : 0);
    c.offset = this.offsetFor(c);
  }

  private stopFor(p: SignalPole): { x: number; z: number } {
    const a = p.approach;
    if (a) return { x: a.x + p.fx * a.setback, z: a.z + p.fz * a.setback };
    const c = p.cluster;
    const d = Math.max(4, (c.cx - p.x) * p.fx + (c.cz - p.z) * p.fz) + 1;
    return { x: c.cx + p.fx * d, z: c.cz + p.fz * d };
  }

  private offsetFor(c: Cluster): number {
    // is the phase-A axis the avenue axis? then the wave applies to the projection along uptown
    const along = c.cx * UPTOWN_X + c.cz * UPTOWN_Z;
    const wave = (along / WAVE_SPEED) % c.cycle;
    const jitter = (hash01(Math.round(c.cx), Math.round(c.cz)) - 0.5) * 6;
    // avenues (phase A parallel to uptown) get the wave; cross streets get the wave plus half a cycle
    const avenueLike = Math.abs(c.ax * UPTOWN_X + c.az * UPTOWN_Z) > 0.7;
    return ((avenueLike ? wave : wave + HALF) + jitter + c.cycle * 10000) % c.cycle;
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
        const stop = this.stopFor(p);
        const gx = Math.floor(stop.x / 32), gz = Math.floor(stop.z / 32);
        const column = this.poleGrid.get(gx)!, bucket = column.get(gz)!;
        bucket.splice(bucket.indexOf(p), 1);
        if (!bucket.length) column.delete(gz);
        if (!column.size) this.poleGrid.delete(gx);
      } else keep.push(p);
    }
    this.poles = keep;
    for (const [key, c] of this.junctions) if (!c.poles.length) this.junctions.delete(key);
    for (const c of this.clusters) if (c.poles.length) this.plan(c);
    // drop empty clusters
    this.clusters = this.clusters.filter((c) => c.poles.length > 0);
    for (const [k, list] of this.grid) {
      const filtered = list.filter((c) => c.poles.length > 0);
      if (filtered.length) this.grid.set(k, filtered);
      else this.grid.delete(k);
    }
  }

  static phaseTime(c: Cluster, serverTime: number): number {
    return (((serverTime + c.offset) % c.cycle) + c.cycle) % c.cycle;
  }

  static vehicleState(phase: number, t: number, c?: Cluster): SignalState {
    const slot = CYCLE / (c?.phaseCount ?? 2);
    const green = slot - YELLOW - (c?.allRed ?? ALL_RED);
    const local = t - phase * slot;
    if (local < 0 || local >= slot) return 0;
    if (local < green) return 2;
    if (local < green + YELLOW) return 1;
    return 0;
  }

  /** A perpendicular head is not necessarily the next vehicle phase. Complex
   * junctions use an exclusive WALK while every vehicle approach is red. */
  static pedestrianFrame(pole: SignalPole, perpendicular: boolean, t: number): number {
    const c = pole.cluster;
    if (c.phaseCount > 2) {
      if (t < CYCLE) return 1;
      if (t < CYCLE + PED_WALK) return 0;
      return 32 - Math.max(1, Math.min(29, Math.ceil(c.cycle - t)));
    }
    return SignalNetwork.pedFrame(perpendicular ? 1 - pole.phase : pole.phase, t, c);
  }

  static pedFrame(phase: number, t: number, c?: Cluster): number {
    const green = CYCLE / (c?.phaseCount ?? 2) - YELLOW - (c?.allRed ?? ALL_RED);
    const local = t - phase * (CYCLE / (c?.phaseCount ?? 2));
    if (local < 0 || local >= green) return 1;
    if (local < Math.min(WALK, green - 20)) return 0;
    return 32 - Math.max(1, Math.min(29, Math.ceil(green - local)));
  }

  /** signal for a vehicle at (x,z) heading (dx,dz): nearest approach stop line within 45 m ahead */
  signalFor(x: number, z: number, dx: number, dz: number, serverTime: number, layer = 0): { state: 'red' | 'yellow' | 'green'; stopX: number; stopZ: number; dist: number } | null {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(dx)
      || !Number.isFinite(dz) || !Number.isFinite(serverTime)) return null;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    dx /= len;
    dz /= len;
    let best: SignalPole | null = null;
    let bestAhead = Infinity;
    let bestOrder = Infinity;
    const x0 = Math.floor((x - 64) / 32), x1 = Math.floor((x + 64) / 32);
    const z0 = Math.floor((z - 64) / 32), z1 = Math.floor((z + 64) / 32);
    for (let gx = x0; gx <= x1; gx++) {
      const column = this.poleGrid.get(gx);
      if (!column) continue;
      for (let gz = z0; gz <= z1; gz++) {
        const bucket = column.get(gz);
        if (!bucket) continue;
        for (const p of bucket) {
          if ((p.approach?.layer ?? 0) !== layer) continue;
          const stop = this.stopFor(p);
          const ox = stop.x - x, oz = stop.z - z;
          // the pole faces the vehicle: its facing is opposite to the travel direction
          if (p.fx * dx + p.fz * dz > -AXIS_DOT) continue;
          const ahead = ox * dx + oz * dz; // distance along travel
          // Keep the current signal while clearing its junction. The driver
          // ignores a stop line behind it instead of treating the exit as a
          // fresh unsignaled junction and stopping again inside the crossing.
          if (ahead < -(p.approach?.setback ?? 2) || ahead > 45) continue;
          const lateral = Math.abs(ox * dz - oz * dx);
          if (lateral > (p.approach ? p.approach.width / 2 + 1 : 14)) continue;
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
    const s = SignalNetwork.vehicleState(best.phase, t, c);
    const { x: stopX, z: stopZ } = this.stopFor(best);
    const dist = (stopX - x) * dx + (stopZ - z) * dz;
    return { state: s === 2 ? 'green' : s === 1 ? 'yellow' : 'red', stopX, stopZ, dist };
  }
}
