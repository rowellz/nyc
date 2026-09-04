/**
 * WorldStreamer: keeps tiles loaded around a focus point (local player, or the free camera).
 *  - fetches <world>/index.json (missing keys == open water)
 *  - loads tiles within quality.drawDistance of the focus, unloads beyond drawDistance + 2 tiles
 *  - decodes gzip JSON in a small Web Worker pool (DecompressionStream + JSON.parse), initially 6 in flight,
 *    then 2 after the near tiles decode;
 *    nearest first; decoded tiles are committed at most ONE PER FRAME so two decodes never share a frame
 *  - emits tileLoaded / tileUnloaded on ctx.events
 *  - spatial queries: tileAt, buildingsNear, roadsNear, nearestRoad, isWater. Buildings and roads are kept in
 *    an overlap index keyed by every tile their bounding box touches (the tool stores each feature in a
 *    single tile, but footprints overhang tile edges by up to ~120 m and road polylines by up to ~670 m)
 */
import * as THREE from 'three';
import { isIOS } from './quality';
import { TILE_SIZE, tileIndex, tileKey } from '@shared/geo';
import { basePath } from './basePath';
import type { Building, RoadSegment, Tile, WorldIndex } from '@shared/world';
import type { EventBus, Quality, WorldStreamer } from './context';
import type { DecodeRequest, DecodeResponse } from './streamer.worker';
import { pointInPolygon } from './physics';
import { fetchAndDecode } from './streamer.worker';

const MAX_IN_FLIGHT = 2;
const INITIAL_IN_FLIGHT = 6;
const UNLOAD_HYSTERESIS_TILES = 2;
const WORKER_POOL = 2;

interface Pending {
  key: string;
  tx: number;
  tz: number;
  dist: number;
}

interface BuildingBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class WorldStreamerImpl implements WorldStreamer {
  tiles = new Map<string, Tile>();
  index: WorldIndex | null = null;
  indexError: string | null = null;
  loadRadius: number;
  farRadius: number;
  ready = false;
  focus = new THREE.Vector3(0, 0, 0);
  /** bytes fetched, decode time (debug) */
  stats = { fetched: 0, bytes: 0, decodeMs: 0, failed: 0, inFlight: 0, queued: 0 };
  /** tile keys that failed to load (retried after a delay) */
  private failed = new Map<string, number>();
  private inFlight = new Map<string, number>(); // key -> request id
  private queue: Pending[] = [];
  private workers: Worker[] = [];
  // A worker can await several fetches concurrently; JSON.parse stays off the main thread.
  private workerLoads: number[] = [];
  private reqSeq = 0;
  private reqCallbacks = new Map<number, { key: string; resolve: (t: Tile) => void; reject: (e: Error) => void }>();
  private tileSet = new Set<string>();
  private buildingBounds = new WeakMap<Building, BuildingBounds>();
  private roadBounds = new WeakMap<RoadSegment, BuildingBounds>();
  /** overlap index: every loaded building / road under EVERY tile key its bounding box touches */
  private buildingBuckets = new Map<string, Set<Building>>();
  private roadBuckets = new Map<string, Set<RoadSegment>>();
  /** decoded tiles waiting to be committed by update() (one per frame, nearest first) */
  private landed: { p: Pending; id: number; tile: Tile }[] = [];
  private lastFocusTx = NaN;
  private lastFocusTz = NaN;
  private lastPlan = -Infinity;
  private disposed = false;
  private initialBurst = true;
  private nearOnly = false;
  private drawDistance: number;
  readonly baseUrl: string;
  private mobile: boolean;
  private ios = isIOS();

  constructor(private events: EventBus, quality: Quality, baseUrl = basePath('/world')) {
    this.mobile = quality.level === 'mobile';
    this.baseUrl = baseUrl;
    this.drawDistance = quality.drawDistance;
    this.loadRadius = this.ios ? 1 : Math.max(1, Math.ceil(quality.drawDistance / TILE_SIZE));
    this.farRadius = this.ios ? 1 : Math.max(this.loadRadius, Math.ceil(quality.farDistance / TILE_SIZE));
    this.spawnWorkers();
  }

  setDrawDistance(m: number): void {
    this.drawDistance = m;
    this.loadRadius = this.ios ? 1 : Math.max(1, Math.ceil(m / TILE_SIZE));
    this.lastPlan = -Infinity;
  }

  private spawnWorkers(): void {
    if (typeof Worker === 'undefined') return;
    for (let i = 0; i < (this.mobile ? 1 : WORKER_POOL); i++) {
      try {
        const w = new Worker(new URL('./streamer.worker.ts', import.meta.url), { type: 'module', name: `tile-decoder-${i}` });
        w.onmessage = (e: MessageEvent<DecodeResponse>) => this.onWorkerMessage(i, e.data);
        w.onerror = (e) => {
          console.warn('[streamer] worker error; falling back to main-thread decode', e.message);
          this.killWorkers();
        };
        this.workers.push(w);
        this.workerLoads.push(0);
      } catch (err) {
        console.warn('[streamer] no workers available; decoding on the main thread', err);
        this.killWorkers();
        break;
      }
    }
  }

  private killWorkers(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.workerLoads = [];
    // fail every outstanding request so it gets retried on the main thread
    for (const [id, cb] of this.reqCallbacks) {
      this.reqCallbacks.delete(id);
      cb.reject(new Error('worker terminated'));
    }
  }

  private onWorkerMessage(i: number, msg: DecodeResponse): void {
    const cb = this.reqCallbacks.get(msg.id);
    if (!cb) return;
    this.workerLoads[i]--;
    this.reqCallbacks.delete(msg.id);
    if (msg.error || !msg.tile) cb.reject(new Error(msg.error ?? 'empty tile'));
    else {
      this.stats.bytes += msg.bytes ?? 0;
      this.stats.decodeMs += msg.ms ?? 0;
      cb.resolve(msg.tile as Tile);
    }
  }

  /** Multiplex fetches over the worker pool; saturation must NOT fall back to main-thread JSON.parse. */
  private decode(key: string, url: string): Promise<Tile> {
    if (this.workers.length) {
      let slot = 0;
      for (let i = 1; i < this.workerLoads.length; i++)
        if (this.workerLoads[i] < this.workerLoads[slot]) slot = i;
      const id = ++this.reqSeq;
      this.workerLoads[slot]++;
      return new Promise<Tile>((resolve, reject) => {
        this.reqCallbacks.set(id, { key, resolve, reject });
        try {
          this.workers[slot].postMessage({ id, url } satisfies DecodeRequest);
        } catch (err) {
          this.workerLoads[slot]--;
          this.reqCallbacks.delete(id);
          reject(err);
        }
      });
    }
    const t0 = performance.now();
    return fetchAndDecode(url).then((r) => {
      this.stats.bytes += r.bytes;
      this.stats.decodeMs += performance.now() - t0;
      return r.tile as Tile;
    });
  }

  async loadIndex(): Promise<WorldIndex | null> {
    try {
      const res = await fetch(`${this.baseUrl}/index.json`, { cache: this.ios ? 'no-store' : 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const idx = (await res.json()) as WorldIndex;
      if (!idx || !Array.isArray(idx.tiles)) throw new Error('malformed index');
      this.index = idx;
      this.tileSet = new Set(idx.tiles);
      this.lastPlan = -Infinity;
      console.info(`[streamer] world index: ${idx.tiles.length} tiles, built ${idx.builtAt}, ${idx.counts?.buildings ?? '?'} buildings`);
      return idx;
    } catch (err) {
      this.indexError = String((err as Error)?.message ?? err);
      console.warn(`[streamer] no world index at ${this.baseUrl}/index.json (${this.indexError}); the city is empty`);
      this.index = null;
      this.tileSet = new Set();
      return null;
    }
  }

  /** Keep the lookup needed for travel; discard the parsed index's duplicate key array. */
  releaseIndexCache(): void {
    if (this.ios && this.index) this.index.tiles = [];
  }

  hasTile(tx: number, tz: number): boolean {
    return this.tileSet.has(tileKey(tx, tz));
  }

  isWater(x: number, z: number): boolean {
    if (!this.index) return false;
    return !this.tileSet.has(tileKey(tileIndex(x), tileIndex(z))) || !!this.tileAt(x, z)?.water.some(p => pointInPolygon(x, z, p));
  }

  tileAt(x: number, z: number): Tile | undefined {
    return this.tiles.get(tileKey(tileIndex(x), tileIndex(z)));
  }

  /** iterate the overlap buckets under the square of half-size r around (x, z) */
  private *bucketsInRange<T>(buckets: Map<string, Set<T>>, x: number, z: number, r: number): Generator<Set<T>> {
    const tx0 = tileIndex(x - r), tx1 = tileIndex(x + r), tz0 = tileIndex(z - r), tz1 = tileIndex(z + r);
    for (let tx = tx0; tx <= tx1; tx++)
      for (let tz = tz0; tz <= tz1; tz++) {
        const s = buckets.get(tileKey(tx, tz));
        if (s) yield s;
      }
  }

  private static forEachBucketKey(bb: BuildingBounds, fn: (key: string) => void): void {
    if (!(bb.minX <= bb.maxX && bb.minZ <= bb.maxZ)) return; // empty geometry
    const tx0 = tileIndex(bb.minX), tx1 = tileIndex(bb.maxX), tz0 = tileIndex(bb.minZ), tz1 = tileIndex(bb.maxZ);
    for (let tx = tx0; tx <= tx1; tx++) for (let tz = tz0; tz <= tz1; tz++) fn(tileKey(tx, tz));
  }

  private indexTile(tile: Tile): void {
    for (const b of tile.buildings)
      WorldStreamerImpl.forEachBucketKey(this.boundsOfBuilding(b), (k) => {
        let s = this.buildingBuckets.get(k);
        if (!s) this.buildingBuckets.set(k, (s = new Set()));
        s.add(b);
      });
    for (const r of tile.roads)
      WorldStreamerImpl.forEachBucketKey(this.boundsOfRoad(r), (k) => {
        let s = this.roadBuckets.get(k);
        if (!s) this.roadBuckets.set(k, (s = new Set()));
        s.add(r);
      });
  }

  private unindexTile(tile: Tile): void {
    for (const b of tile.buildings)
      WorldStreamerImpl.forEachBucketKey(this.boundsOfBuilding(b), (k) => {
        const s = this.buildingBuckets.get(k);
        if (s && s.delete(b) && s.size === 0) this.buildingBuckets.delete(k);
      });
    for (const r of tile.roads)
      WorldStreamerImpl.forEachBucketKey(this.boundsOfRoad(r), (k) => {
        const s = this.roadBuckets.get(k);
        if (s && s.delete(r) && s.size === 0) this.roadBuckets.delete(k);
      });
  }

  private boundsOfBuilding(b: Building): BuildingBounds {
    let bb = this.buildingBounds.get(b);
    if (!bb) {
      bb = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      const ring = b.footprint[0] ?? [];
      for (const [px, pz] of ring) {
        if (px < bb.minX) bb.minX = px;
        if (px > bb.maxX) bb.maxX = px;
        if (pz < bb.minZ) bb.minZ = pz;
        if (pz > bb.maxZ) bb.maxZ = pz;
      }
      this.buildingBounds.set(b, bb);
    }
    return bb;
  }

  private boundsOfRoad(r: RoadSegment): BuildingBounds {
    let bb = this.roadBounds.get(r);
    if (!bb) {
      bb = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const [px, pz] of r.pts) {
        if (px < bb.minX) bb.minX = px;
        if (px > bb.maxX) bb.maxX = px;
        if (pz < bb.minZ) bb.minZ = pz;
        if (pz > bb.maxZ) bb.maxZ = pz;
      }
      const hw = r.width / 2;
      bb.minX -= hw; bb.maxX += hw; bb.minZ -= hw; bb.maxZ += hw;
      this.roadBounds.set(r, bb);
    }
    return bb;
  }

  buildingsNear(x: number, z: number, r: number): Building[] {
    const out: Building[] = [];
    const seen = new Set<Building>();
    for (const bucket of this.bucketsInRange(this.buildingBuckets, x, z, r)) {
      for (const b of bucket) {
        if (seen.has(b)) continue;
        seen.add(b);
        const bb = this.boundsOfBuilding(b);
        if (bb.maxX < x - r || bb.minX > x + r || bb.maxZ < z - r || bb.minZ > z + r) continue;
        // distance from point to the AABB
        const dx = Math.max(bb.minX - x, 0, x - bb.maxX);
        const dz = Math.max(bb.minZ - z, 0, z - bb.maxZ);
        if (dx * dx + dz * dz <= r * r) out.push(b);
      }
    }
    return out;
  }

  roadsNear(x: number, z: number, r: number): RoadSegment[] {
    const out: RoadSegment[] = [];
    const seen = new Set<RoadSegment>();
    for (const bucket of this.bucketsInRange(this.roadBuckets, x, z, r)) {
      for (const road of bucket) {
        if (seen.has(road)) continue;
        seen.add(road);
        const bb = this.boundsOfRoad(road);
        if (bb.maxX < x - r || bb.minX > x + r || bb.maxZ < z - r || bb.minZ > z + r) continue;
        out.push(road);
      }
    }
    return out;
  }

  nearestRoad(x: number, z: number, maxDist = 60): { road: RoadSegment; x: number; z: number; t: number; dist: number; dirX: number; dirZ: number } | null {
    let best: { road: RoadSegment; x: number; z: number; t: number; dist: number; dirX: number; dirZ: number } | null = null;
    let bestD2 = maxDist * maxDist;
    const seen = new Set<RoadSegment>();
    for (const bucket of this.bucketsInRange(this.roadBuckets, x, z, maxDist)) {
      for (const road of bucket) {
        if (seen.has(road)) continue;
        seen.add(road);
        if (road.tunnel) continue;
        const bb = this.boundsOfRoad(road);
        if (bb.maxX < x - maxDist || bb.minX > x + maxDist || bb.maxZ < z - maxDist || bb.minZ > z + maxDist) continue;
        const pts = road.pts;
        for (let i = 0; i + 1 < pts.length; i++) {
          const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
          const ex = bx - ax, ez = bz - az;
          const len2 = ex * ex + ez * ez;
          let t = len2 > 0 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + ex * t, pz = az + ez * t;
          const dx = x - px, dz = z - pz;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2) {
            bestD2 = d2;
            const len = Math.sqrt(len2) || 1;
            best = { road, x: px, z: pz, t: i + t, dist: Math.sqrt(d2), dirX: ex / len, dirZ: ez / len };
          }
        }
      }
    }
    return best;
  }

  /** called every frame by the loop with the focus position; plans loads ~4x per second or on tile change */
  update(focus: THREE.Vector3, _now: number, nearOnly = false, commitAllowed = true): void {
    // Use a wall clock for retries/planning: loop.t clamps long frames and can lag by many seconds.
    const now = performance.now() / 1000;
    if (this.nearOnly !== nearOnly) {
      this.nearOnly = nearOnly;
      this.lastPlan = -Infinity;
    }
    this.focus.copy(focus);
    if (commitAllowed) this.commitLanded();
    const ftx = tileIndex(focus.x), ftz = tileIndex(focus.z);
    const tileChanged = ftx !== this.lastFocusTx || ftz !== this.lastFocusTz;
    if (tileChanged || now - this.lastPlan > 0.25) {
      this.lastFocusTx = ftx;
      this.lastFocusTz = ftz;
      this.lastPlan = now;
      this.plan(focus.x, focus.z, ftx, ftz, now);
    }
    if (this.ready) this.initialBurst = false;
    this.pump(now);
    this.stats.inFlight = this.inFlight.size;
    this.stats.queued = this.queue.length;
  }

  private plan(fx: number, fz: number, ftx: number, ftz: number, now: number): void {
    // unload far tiles
    const unloadDist = this.drawDistance + (this.mobile ? 1 : UNLOAD_HYSTERESIS_TILES) * TILE_SIZE;
    for (const [key, tile] of this.tiles) {
      if (this.ios ? Math.abs(tile.tx - ftx) > 1 || Math.abs(tile.tz - ftz) > 1 : tileCenterDist(tile.tx, tile.tz, fx, fz) > unloadDist) this.unload(key);
    }
    // wanted tiles by distance
    this.queue.length = 0;
    const R = this.ios ? 1 : this.loadRadius;
    for (let tx = ftx - R; tx <= ftx + R; tx++) {
      for (let tz = ftz - R; tz <= ftz + R; tz++) {
        // Let the near builders drain before adding distant work to their shared busy count.
        if (this.nearOnly && (Math.abs(tx - ftx) > 1 || Math.abs(tz - ftz) > 1)) continue;
        const key = tileKey(tx, tz);
        if (!this.tileSet.has(key) || this.tiles.has(key) || this.inFlight.has(key)) continue;
        const failedAt = this.failed.get(key);
        if (failedAt !== undefined && now - failedAt < 10) continue;
        const dist = tileCenterDist(tx, tz, fx, fz);
        if (dist > this.drawDistance + TILE_SIZE * 0.5) continue;
        this.queue.push({ key, tx, tz, dist });
      }
    }
    this.queue.sort((a, b) => a.dist - b.dist);
    // ready: every existing tile within one tile of the focus is loaded
    let ready = this.index !== null || this.indexError !== null;
    if (ready) {
      for (let tx = ftx - 1; tx <= ftx + 1 && ready; tx++)
        for (let tz = ftz - 1; tz <= ftz + 1; tz++) {
          const key = tileKey(tx, tz);
          if (this.tileSet.has(key) && !this.tiles.has(key)) {
            ready = false;
            break;
          }
        }
    }
    this.ready = ready;
  }

  /** insert at most one decoded tile per frame (nearest to the focus first) */
  private commitLanded(): void {
    // A spot change can leave old decoded tiles occupying every slot. Drop them, don't deadlock
    // the new near scene behind results deliberately held outside its radius.
    if (this.ios || this.nearOnly) {
      for (let i = this.landed.length - 1; i >= 0; i--) {
        const { p, id } = this.landed[i];
        if (this.isNear(p)) continue;
        this.landed.splice(i, 1);
        if (this.inFlight.get(p.key) === id) this.inFlight.delete(p.key);
      }
    }
    if (!this.landed.length) return;
    let bi = 0;
    if (this.landed.length > 1) {
      let bd = Infinity;
      for (let i = 0; i < this.landed.length; i++) {
        const d = tileCenterDist(this.landed[i].p.tx, this.landed[i].p.tz, this.focus.x, this.focus.z);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
    }
    const { p, id, tile } = this.landed.splice(bi, 1)[0];
    if (this.inFlight.get(p.key) !== id) return; // superseded
    this.inFlight.delete(p.key);
    if (this.tiles.has(p.key) || (this.ios && !this.isNear(p))) return;
    // the focus may have moved far away while this was loading
    if (tileCenterDist(p.tx, p.tz, this.focus.x, this.focus.z) > this.drawDistance + (this.mobile ? 1 : UNLOAD_HYSTERESIS_TILES) * TILE_SIZE) return;
    this.tiles.set(p.key, tile);
    this.stats.fetched++;
    this.failed.delete(p.key);
    this.indexTile(tile);
    this.events.emit('tileLoaded', tile);
    this.lastPlan = -Infinity; // recompute ready
  }

  private pump(now: number): void {
    const limit = this.mobile ? 1 : this.initialBurst ? INITIAL_IN_FLIGHT : MAX_IN_FLIGHT;
    while (this.inFlight.size < limit && this.queue.length) {
      const p = this.queue.shift()!;
      if (this.tiles.has(p.key) || this.inFlight.has(p.key)) continue;
      this.startLoad(p, now);
    }
  }

  private isNear(p: Pending): boolean {
    return Math.abs(p.tx - tileIndex(this.focus.x)) <= 1 && Math.abs(p.tz - tileIndex(this.focus.z)) <= 1;
  }

  private startLoad(p: Pending, _now: number): void {
    const id = ++this.reqSeq;
    this.inFlight.set(p.key, id);
    const url = `${this.baseUrl}/tiles/${p.key}.json.gz`;
    this.decode(p.key, url).then(
      (tile) => {
        if (this.disposed || this.inFlight.get(p.key) !== id) return;
        if (!tile || typeof tile !== 'object') {
          this.inFlight.delete(p.key);
          this.failed.set(p.key, performance.now() / 1000);
          this.stats.failed++;
          return;
        }
        if (tile.key !== p.key) {
          tile.key = p.key;
          tile.tx = p.tx;
          tile.tz = p.tz;
        }
        // committed by update(): one tile per frame, nearest first (keeps its in-flight slot until then)
        this.landed.push({ p, id, tile });
      },
      (err: Error) => {
        if (this.disposed || this.inFlight.get(p.key) !== id) return;
        this.inFlight.delete(p.key);
        this.failed.set(p.key, performance.now() / 1000);
        this.stats.failed++;
        console.warn(`[streamer] tile ${p.key} failed: ${err.message}`);
      },
    );
  }

  private unload(key: string): void {
    const t = this.tiles.get(key);
    if (!t) return;
    this.tiles.delete(key);
    this.unindexTile(t);
    this.events.emit('tileUnloaded', key);
  }

  /** drop everything (used when switching world base url) */
  unloadAll(): void {
    for (const key of Array.from(this.tiles.keys())) this.unload(key);
    this.queue.length = 0;
    this.landed.length = 0;
    // Discarded landed results still own request slots. Invalidate fetches as well so late
    // replies cannot commit old tiles or fail a newer request with the same key.
    this.inFlight.clear();
    this.failed.clear();
    this.stats.inFlight = this.stats.queued = 0;
    this.lastPlan = -Infinity;
    this.initialBurst = true;
    this.ready = false;
  }

  dispose(): void {
    this.disposed = true;
    this.unloadAll();
    this.killWorkers();
  }
}

function tileCenterDist(tx: number, tz: number, x: number, z: number): number {
  const cx = (tx + 0.5) * TILE_SIZE, cz = (tz + 0.5) * TILE_SIZE;
  // distance from the point to the tile square (0 when inside)
  const dx = Math.max(Math.abs(x - cx) - TILE_SIZE / 2, 0);
  const dz = Math.max(Math.abs(z - cz) - TILE_SIZE / 2, 0);
  return Math.hypot(dx, dz);
}
