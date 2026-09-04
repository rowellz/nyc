/** Local sidewalk crowds. Behaviour and scheduling only; appearance/rigs stay in CharacterInstance. */
import * as THREE from 'three';
import { isIOS } from '@/core/quality';
import type { RoadSegment, Tile, Crossing, Building } from '@shared/world';
import type { GameContext } from '@/core/context';
import type { SeatSourceModule } from '@/landmarks';
import { LANDMARK_BINS } from '@/landmarks/list';
import { hash4, seedOf } from '@/buildings/hash';
import { buildingParams } from '@/buildings/styles';
import { normalizePolygon, distToPolyline } from '@/buildings/polygon';
import type { PropsLike, BuildingsLike, VehiclesLike, StreetsLike } from './contracts';
import { CharacterInstance, type Mannerism } from './animator';
import { randomAppearance, mulberry } from './appearance';
import { pointInPolygon } from '@/core/physics';
import { CrowdBatch } from './crowdBatch';
import { PedGrid, sidewalkDensity, PARK_SEAT_RADIUS, PARK_SEAT_CAPACITY, facingSeat, seatFillOrder } from './pedBrain';

const SPAWN_R = 110;
const DESPAWN_R = 140;
const NEAR_SPAWN_R = 3;
const IN_VIEW_SPAWN_R = 45;
const PED_FULL = 42;
const PED_MID = 55;
const PED_SHADOW = 16;
const CROWD_SHADOW = 60;
// More people may be near, but only the closest budgeted rigs run full animation.
const fullCap = (maxPeds: number, level?: string) => isIOS() ? Math.min(2, maxPeds) : Math.max(6, Math.round(Math.min(maxPeds, level === 'ultra' ? 150 : 100) * 0.08));
const SIDEWALK_OFFSET = 2.3;
const BODY_SPACE = 0.62; // hard centre separation; 0.6 m personal-radius steering starts at 1.2 m

interface LaneCrossing {
  s0: number;
  s1: number;
  x: number;
  z: number;
  signal: boolean;
  seed: number;
  dx: number; dz: number; half: number;
}

interface Lane {
  road: RoadSegment;
  side: -1 | 1;
  pts: Float64Array; // x,z pairs
  cum: Float64Array;
  len: number;
  crossings: LaneCrossing[];
  weight: number;
  path: boolean;
  widths: Map<number, { lo: number; hi: number }>;
}

interface WalkPolygon { poly: Tile['sidewalks'][number]; minX: number; maxX: number; minZ: number; maxZ: number }

interface SpawnSpan { lane: Lane; s0: number; s1: number; weight: number; ingress: boolean }
interface Egress { x: number; z: number; gate?: number }

interface Route { x: number; z: number; lane: Lane; s: number; dir: -1 | 1; lat: number }
interface Seat { x: number; z: number; yaw: number; height: number; y?: number; groundY?: number; source?: string; availableAt?: number }
type PedState = 'walk' | 'approach' | 'wait' | 'stand' | 'window' | 'sit' | 'sitDown' | 'standUp' | 'flinch' | 'flee' | 'cross' | 'stepBack';

interface Ped {
  inst: CharacterInstance;
  lane: Lane;
  dir: -1 | 1;
  s: number;
  lat: number; // desired lateral offset (m, + = away from the road)
  latCur: number;
  speed: number;
  baseSpeed: number;
  state: PedState;
  timer: number;
  phone: boolean;
  jaywalker: boolean;
  x: number;
  z: number;
  yaw: number;
  crossing: LaneCrossing | null;
  visible: boolean;
  fleeFrom: { x: number; z: number } | null;
  seed: number;
  /** Group leader: match pace/formation, but make independent collision/signal decisions. */
  follow: Ped | null;
  followOff: number;
  mannerism: Mannerism;
  /** cached ground height (physics query staggered over frames) */
  gy: number;
  preference: number;
  phase: number;
  stopIn: number;
  stopKind: 'window' | 'stand' | 'sit' | null;
  seat: Seat | null;
  route: Route | null;
  entry: { x: number; z: number } | null;
  lastCrossing: LaneCrossing | null;
  crossingCooldown: number;
  blocked: number;
  talkIn: number;
  talkFor: number;
  animDt: number;
  thinkIn: number;
  green: boolean;
  carCooldown: number;
  recoilX: number; recoilZ: number;
  unseen: number;
  seatIn: number;
  seatWeight: number;
  parkGuest: boolean;
}

export class PedManager {
  private lanes = new Map<string, Lane>(); // key road.id:side
  private roadTiles = new Map<number, Set<string>>();
  private tileRoads = new Map<string, RoadSegment[]>();
  private tileCrossings = new Map<string, Crossing[]>();
  private tileSidewalks = new Map<string, WalkPolygon[]>();
  private tileEgresses = new Map<string, Egress[]>();
  private egresses: Egress[] = [];
  private spawnRay = new THREE.Vector3();
  private peds: Ped[] = [];
  private laneList: SpawnSpan[] = [];
  private laneListDirty = true;
  private laneFocus = new THREE.Vector3(Infinity, 0, Infinity);
  private spawnWeight = 0;
  private ingressWeight = 0;
  private spawnLen = 0;
  private spawnDayLen = 0;
  private busyDistrict = false;
  private populationPending = true;
  private populationTime = 0;
  private laneDirection = new THREE.Vector3();
  private camDirection = new THREE.Vector3();
  private rnd = mulberry(4242);
  private spawnAcc = 0;
  private focus = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private frustum = new THREE.Frustum();
  private view = new THREE.Matrix4();
  private nearPeds: Ped[] = [];
  private fullPeds = new Set<Ped>();
  private crowdBatch: CrowdBatch;
  private sphere = new THREE.Sphere(new THREE.Vector3(), 1.8);
  private offs: (() => void)[] = [];
  private grid = new PedGrid<Ped>();
  private cars: NonNullable<ReturnType<NonNullable<VehiclesLike['traffic']>>> = [];
  private carTime = 0;
  private densityHour = -1;
  private seats = new Map<string, Seat[]>();
  private parkSeats = new Map<string, Seat>();
  private parkNearby: Seat[] = [];
  private seatOwners = new Map<Seat, Ped>();
  private parkReserved = 0;
  private parkTarget = 0;
  private seatSyncIn = 0;
  private seatClock = 0;
  private seatPopulationPending = false;
  private seatPopulationDone = false;
  private seatPopulationTime = 0;
  private seatEvents = { satDown: 0, stoodUp: 0, spawned: 0, despawned: 0 };
  private exits = new Map<LaneCrossing, Map<number, Route | null>>();
  readonly maxPeds: number;
  private get totalCapacity(): number { return this.maxPeds + (this.ctx.quality.level === 'mobile' ? 0 : PARK_SEAT_CAPACITY); }
  private slot = 0;
  /** debug: scales the target count (?peds=0.5) */
  densityScale = 1;
  benchmarking = false;

  constructor(
    private ctx: GameContext,
    private group: THREE.Group,
    private shared: { uTime: { value: number }; uWetness?: { value: number }; setupMaterial?: (m: THREE.Material) => void },
  ) {
    const requested = typeof location === 'undefined' ? 0 : Number(new URLSearchParams(location.search).get('pedLimit'));
    this.maxPeds = requested > 0 ? Math.min(ctx.quality.maxPeds, Math.floor(requested)) : ctx.quality.maxPeds;
    this.crowdBatch = new CrowdBatch(group, this.totalCapacity, shared);
    if (typeof location !== 'undefined') {
      const q = parseFloat(new URLSearchParams(location.search).get('peds') ?? '');
      if (Number.isFinite(q) && q >= 0) this.densityScale = q;
    }
    ctx.busy = (ctx.busy ?? 0) + 1;
    this.offs.push(ctx.events.on('tileLoaded', (t) => this.addTile(t)));
    this.offs.push(ctx.events.on('tileUnloaded', (k) => this.removeTile(k)));
    this.offs.push(ctx.events.on('localFire', (_w, origin) => this.gunfire(origin.x, origin.z)));
    this.offs.push(ctx.events.on('remoteFire', (_id, _w, origin) => this.gunfire(origin.x, origin.z)));
    for (const t of ctx.world.tiles.values()) this.addTile(t);
  }

  // ---- lanes -------------------------------------------------------------------------------------

  private addTile(t: Tile): void {
    this.exits.clear();
    this.tileRoads.set(t.key, t.roads);
    this.seats.set(t.key, t.props.filter(p => p.kind === 'bench').map(p => ({ x: p.x, z: p.z, yaw: p.yaw, height: 0.46 })));
    for (const lane of this.lanes.values()) lane.widths.clear();
    this.tileCrossings.set(t.key, t.crossings);
    // Walking queries vastly outnumber tile loads. Reject distant polygons by
    // their outer-ring bounds before doing the hole-aware point test.
    this.tileSidewalks.set(t.key, [...(t.sidewalks ?? []), ...t.plazas].map(poly => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of poly[0] ?? []) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
      return { poly, minX, maxX, minZ, maxZ };
    }));
    for (const r of t.roads) {
      let set = this.roadTiles.get(r.id);
      if (!set) {
        set = new Set();
        this.roadTiles.set(r.id, set);
        this.buildLanes(r);
      }
      set.add(t.key);
    }
    // crossings may belong to roads from other tiles: attach to every lane nearby
    for (const c of t.crossings) this.attachCrossing(c);
    this.tileEgresses.set(t.key, this.buildEgresses(t));
    this.laneListDirty = true;
  }

  private removeTile(key: string): void {
    this.exits.clear();
    const roads = this.tileRoads.get(key);
    this.tileRoads.delete(key);
    this.seats.delete(key);
    this.tileCrossings.delete(key);
    this.tileSidewalks.delete(key);
    this.tileEgresses.delete(key);
    if (!roads) return;
    for (const r of roads) {
      const set = this.roadTiles.get(r.id);
      if (!set) continue;
      set.delete(key);
      if (set.size === 0) {
        this.roadTiles.delete(r.id);
        for (const side of [-1, 1]) {
          const lk = `${r.id}:${side}`;
          const lane = this.lanes.get(lk);
          if (!lane) continue;
          this.lanes.delete(lk);
          // Keep visible walkers until they leave the frustum, even if their tile is unloaded.
        }
      }
    }
    this.laneListDirty = true;
  }

  private buildLanes(r: RoadSegment): void {
    if (r.tunnel || r.cls === 'motorway' || r.cls === 'trunk' || r.cls === 'steps' || r.cls === 'cycleway') return;
    if (r.bridge) return;
    if (r.pts.length < 2) return;
    const path = r.cls === 'footway' || r.cls === 'pedestrian';
    const weight = r.cls === 'primary' ? 3.2 : r.cls === 'secondary' ? 2.6 : r.cls === 'tertiary' ? 1.8 : r.cls === 'residential' ? 1.4 : r.cls === 'pedestrian' ? 2.2 : r.cls === 'footway' ? 0.8 : 0.35;
    const sides: (-1 | 1)[] = path ? [1] : [-1, 1];
    for (const side of sides) {
      const off = path ? 0 : r.width / 2 + SIDEWALK_OFFSET;
      const n = r.pts.length;
      const pts = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        // average direction at the vertex
        const p = r.pts[i];
        const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(n - 1, i + 1)];
        let dx = b[0] - a[0], dz = b[1] - a[1];
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        // normal to the right of travel (x east, z south): right = (-dz, dx)
        const nx = -dz * side, nz = dx * side;
        pts[i * 2] = p[0] + nx * off;
        pts[i * 2 + 1] = p[1] + nz * off;
      }
      const cum = new Float64Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[(i - 1) * 2], pts[i * 2 + 1] - pts[(i - 1) * 2 + 1]);
      const lane: Lane = { road: r, side, pts, cum, len: cum[n - 1], crossings: [], weight, path, widths: new Map() };
      if (lane.len < 6) continue;
      this.lanes.set(`${r.id}:${side}`, lane);
      // crossings already known from loaded tiles
      for (const cs of this.tileCrossings.values()) for (const c of cs) this.attachCrossingToLane(c, lane);
    }
  }

  private attachCrossing(c: Crossing): void {
    for (const lane of this.lanes.values()) this.attachCrossingToLane(c, lane);
  }

  private attachCrossingToLane(c: Crossing, lane: Lane): void {
    if (lane.path) return;
    // project the crossing center onto the lane; accept if the crossing direction is parallel to the lane
    const proj = this.project(lane, c.x, c.z);
    if (!proj || proj.dist > 12) return;
    const cdx = -Math.sin(c.yaw), cdz = -Math.cos(c.yaw);
    const alignment = cdx * proj.dirX + cdz * proj.dirZ;
    // Only crossings parallel to this sidewalk. The old max(dot, perpendicularDot)
    // accepted both axes and put waiting pedestrians in unrelated intersections.
    if (Math.abs(alignment) < 0.85) return;
    for (const ex of lane.crossings) if (Math.hypot(ex.x - c.x, ex.z - c.z) < 4) return;
    const half = c.width / 2 + 0.8;
    const dx = cdx * Math.sign(alignment), dz = cdz * Math.sign(alignment);
    // Do not clamp the projection to an OSM segment endpoint: the crossing centre
    // can lie just beyond it, while its near curb is still on this segment.
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    this.sample(lane, proj.s, 0, o);
    const centerS = proj.s + (c.x - o.x) * dx + (c.z - o.z) * dz;
    lane.crossings.push({ s0: centerS - half, s1: centerS + half, x: c.x, z: c.z,
      signal: c.signal, seed: Math.floor(Math.abs(c.x * 3 + c.z * 7)) % 1000, dx, dz, half });
    lane.crossings.sort((a, b) => a.s0 - b.s0);
  }

  private project(lane: Lane, x: number, z: number): { s: number; dist: number; dirX: number; dirZ: number } | null {
    const n = lane.cum.length;
    let best: { s: number; dist: number; dirX: number; dirZ: number } | null = null;
    for (let i = 0; i + 1 < n; i++) {
      const ax = lane.pts[i * 2], az = lane.pts[i * 2 + 1], bx = lane.pts[(i + 1) * 2], bz = lane.pts[(i + 1) * 2 + 1];
      const ex = bx - ax, ez = bz - az;
      const l2 = ex * ex + ez * ez;
      if (l2 < 1e-6) continue;
      let t = ((x - ax) * ex + (z - az) * ez) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + ex * t, pz = az + ez * t;
      const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.dist) {
        const l = Math.sqrt(l2);
        best = { s: lane.cum[i] + l * t, dist: d, dirX: ex / l, dirZ: ez / l };
      }
    }
    return best;
  }

  /** position + direction at distance s along the lane, with lateral offset (+ = away from the road) */
  private sample(lane: Lane, s: number, lat: number, out: { x: number; z: number; dx: number; dz: number }): void {
    const n = lane.cum.length;
    let i = 0;
    while (i < n - 2 && lane.cum[i + 1] < s) i++;
    const s0 = lane.cum[i], s1 = lane.cum[i + 1];
    const t = s1 > s0 ? THREE.MathUtils.clamp((s - s0) / (s1 - s0), 0, 1) : 0;
    const ax = lane.pts[i * 2], az = lane.pts[i * 2 + 1], bx = lane.pts[(i + 1) * 2], bz = lane.pts[(i + 1) * 2 + 1];
    let dx = bx - ax, dz = bz - az;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const nx = -dz * lane.side, nz = dx * lane.side;
    out.x = ax + (bx - ax) * t + nx * lat;
    out.z = az + (bz - az) * t + nz * lat;
    out.dx = dx;
    out.dz = dz;
  }

  // ---- spawning ------------------------------------------------------------------------------------

  private buildEgresses(t: Tile): Egress[] {
    // Subway geometry's open threshold is local -X, not the centre of its stairwell.
    const result: Egress[] = t.props.filter(p => p.kind === 'subway_entrance')
      .map(p => ({ x: p.x - Math.cos(p.yaw) * 3.3, z: p.z + Math.sin(p.yaw) * 3.3 }));
    const roads = t.roads.filter(r => !r.tunnel && !['motorway', 'trunk', 'steps', 'cycleway'].includes(r.cls));
    for (const b of t.buildings) {
      if (LANDMARK_BINS.has(b.id)) continue;
      const ring = normalizePolygon(b.footprint)?.[0]; if (!ring) continue;
      const seed = seedOf(b.id), params = buildingParams(b, seed);
      const edges = ring.flatMap((a, i) => {
        const c = ring[(i + 1) % ring.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 2.5) return [];
        const dx = (c[0] - a[0]) / len, dz = (c[1] - a[1]) / len;
        const x = (a[0] + c[0]) / 2 + dz * 2.5, z = (a[1] + c[1]) / 2 - dx * 2.5;
        if (!roads.some(r => distToPolyline(x, z, r.pts) <= r.width / 2 + 7.5)) return [];
        return [{ a, len, dx, dz, wall: i + 1 }];
      });
      const front = edges.reduce<typeof edges[number] | undefined>((best, e) => !best || e.len > best.len ? e : best, undefined);
      for (const e of edges) {
        // Match the facade shader's hashed shop/lobby door positions, never an arbitrary wall point.
        const lobby = params.style === 5 && e === front && e.len > 8 && params.gfH >= 4.5;
        const shop = params.commercial && params.style !== 9 && params.style !== 10 && params.gfH >= 3.5 && !lobby;
        if (!shop && (e !== front || params.style === 9 || params.style === 10)) continue;
        const n = shop ? Math.max(1, Math.floor(e.len / (7 + hash4(seed, 20, e.wall) * 5) + 0.5)) : 1;
        const w = e.len / n;
        for (let i = 0; i < n; i++) {
          const u = shop ? w * (i + 0.15 + 0.7 * hash4(seed, 23, e.wall, i))
            : 1.3 + hash4(seed, 30, e.wall) * Math.max(0, e.len - 2.6);
          result.push({ x: e.a[0] + e.dx * u + e.dz * 0.45, z: e.a[1] + e.dz * u - e.dx * 0.45,
            gate: shop ? hash4(seed, 22, e.wall, i) : undefined });
        }
      }
    }
    return result;
  }

  private canSpawn(x: number, z: number): boolean {
    if (this.populationCovered() || !this.inView(x, z)) return true;
    if ((x - this.camPos.x) ** 2 + (z - this.camPos.z) ** 2 <= IN_VIEW_SPAWN_R ** 2) return false;
    const night = 1 - (this.ctx.time?.daylight ?? 1);
    const gate = 0.06 + 0.34 * THREE.MathUtils.smoothstep(night, 0.2, 0.8);
    for (const e of this.egresses) {
      if ((e.gate === undefined || e.gate > gate) && (e.x - x) ** 2 + (e.z - z) ** 2 < 0.65 ** 2) return true;
    }
    // Both torso and head must be hidden; neither a curb nor an overhead sign suffices.
    const ground = this.ctx.physics.groundHeight(x, z);
    for (const height of [0.6, 1.9]) {
      this.spawnRay.set(x, ground + height, z).sub(this.camPos);
      const distance = this.spawnRay.length();
      const hit = this.ctx.physics.raycast?.(this.camPos, this.spawnRay, distance - 1);
      if (!hit || hit.dist <= 0.5 || hit.dist >= distance - 1) return false;
    }
    return true;
  }

  private rebuildLaneList(): void {
    this.laneList.length = 0;
    this.spawnWeight = 0;
    this.ingressWeight = 0;
    this.spawnLen = 0;
    this.spawnDayLen = 0;
    this.busyDistrict = false;
    this.egresses = [...this.tileEgresses.values()].flat().filter(e => (e.x - this.focus.x) ** 2 + (e.z - this.focus.z) ** 2 <= SPAWN_R ** 2);
    this.laneFocus.copy(this.focus);
    this.laneDirection.copy(this.camDirection);
    // Clip each segment to the local spawn disk. Sampling every loaded OSM road
    // made acceptance shrink as the streaming radius/world data grew.
    for (const lane of this.lanes.values()) for (let i = 0; i < lane.cum.length - 1; i++) {
      const ax = lane.pts[i * 2], az = lane.pts[i * 2 + 1];
      const length = lane.cum[i + 1] - lane.cum[i];
      if (length < 0.01) continue;
      const dx = (lane.pts[i * 2 + 2] - ax) / length, dz = (lane.pts[i * 2 + 3] - az) / length;
      const fx = this.focus.x - ax, fz = this.focus.z - az;
      const along = fx * dx + fz * dz, across = fx * dz - fz * dx;
      const reach2 = SPAWN_R ** 2 - across * across;
      if (reach2 <= 0) continue;
      const reach = Math.sqrt(reach2);
      const s0 = Math.max(0, along - reach), s1 = Math.min(length, along + reach);
      if (s1 - s0 < 1) continue;
      // Short spans let a long road straddling the camera put its budget ahead,
      // instead of allocating most walkers to the unseen half of the block.
      for (let start = s0; start < s1; start += 12) {
        const end = Math.min(s1, start + 12);
        const mx = ax + dx * (start + end) / 2, mz = az + dz * (start + end) / 2;
        const hour = (this.ctx.time?.dayFraction ?? 15 / 24) * 24;
        const tile = this.ctx.world.tileAt(mx, mz);
        const park = lane.path && !!tile?.parks.some(poly => pointInPolygon(mx, mz, poly));
        const base = (end - start) * sidewalkDensity(lane.road, mx, mz, hour, park);
        this.spawnDayLen += (end - start) * sidewalkDensity(lane.road, mx, mz, 15, park);
        const dm = Math.hypot(mx - this.focus.x, mz - this.focus.z);
        const near = Math.max(0, 1 - dm / SPAWN_R);
        if (dm < 65 && lane.weight >= 2.6) this.busyDistrict = true;
        const inView = this.inView(mx, mz);
        const midS = lane.cum[i] + (start + end) / 2;
        const corner = lane.crossings.some(c => midS >= c.s0 - 10 && midS <= c.s1 + 10);
        // Reserve a share for corner approaches even at the far end of the block;
        // otherwise proximity weighting spends every slot before pedestrians can
        // reach the signal (the named Fifth/42nd camera is actually near 41st).
        const weight = base * Math.max(corner ? 0.3 : 0.03, 0.03 + 0.97 * near * near * near) * (inView ? 18 : 1);
        this.spawnLen += base;
        this.spawnWeight += weight;
        // Include distant visible spans in refill sampling; canSpawn validates the actual point.
        const ingress = !inView || dm > IN_VIEW_SPAWN_R - 12;
        if (ingress) this.ingressWeight += weight;
        this.laneList.push({ lane, s0: lane.cum[i] + start, s1: lane.cum[i] + end, weight, ingress });
      }
    }
    this.laneListDirty = false;
  }

  private targetCount(): number {
    const hourScale = Math.min(1, this.spawnLen / Math.max(1, this.spawnDayLen));
    return Math.min(Math.round(this.maxPeds * hourScale), Math.round(this.spawnLen * this.densityScale));
  }

  private inView(x: number, z: number): boolean {
    this.sphere.center.set(x, 0.9, z);
    this.sphere.radius = 1.0;
    const v = this.frustum.intersectsSphere(this.sphere);
    this.sphere.radius = 1.8;
    return v;
  }

  private walkable(x: number, z: number, lane: Lane): boolean {
    if (this.isInsideBuilding(x, z)) return false;
    const sw = this.onSidewalk(x, z);
    if (sw === false && !lane.path) return false;
    // Planimetric sidewalk polygons already exclude the road. SurfaceAt is the
    // fallback for missing polygons/paths, not a second city-wide query per step.
    if (sw === true) return true;
    const surface = (this.ctx.modules.get('streets') as StreetsLike | undefined)?.surfaceAt?.(x, z);
    return surface !== 'asphalt' && surface !== 'paint';
  }

  private isInsideBuilding(x: number, z: number): boolean {
    const b = this.ctx.modules.get('buildings') as BuildingsLike | undefined;
    if (b && typeof b.isInside === 'function') {
      if (b.isInside(x, z)) return true;
      if (!this.populationPending) return false;
    }
    // During the initial fill a decoded footprint can precede the module's grid.
    const near = this.ctx.world.buildingsNear?.(x, z, 1) ?? [];
    for (const bd of near as Building[]) if (pointInPolygon(x, z, bd.footprint)) return true;
    return false;
  }

  private onSidewalk(x: number, z: number): boolean | null {
    const tile = this.ctx.world.tileAt(x, z);
    if (!tile) return null;
    const sw = tile.sidewalks;
    if (!sw || sw.length === 0) return null;
    for (const b of this.tileSidewalks.get(tile.key) ?? []) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && pointInPolygon(x, z, b.poly)) return true;
    }
    return false;
  }

  /** Measure the actual curb-to-building corridor, not a fixed centre line. */
  private bounds(lane: Lane, s: number): { lo: number; hi: number } {
    const key = Math.floor(s / 4), cached = lane.widths.get(key);
    if (cached) return cached;
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    let lo = Infinity, hi = -Infinity;
    const min = lane.path ? -Math.max(0.7, lane.road.width / 2 - 0.35) : -1.9;
    // Broad avenues often have 8–12 m sidewalks; keep scanning to the actual
    // building edge instead of treating 6 m as an artificial wall.
    const max = lane.path ? -min : 13.7;
    for (let lat = min; lat <= max + 0.001; lat += 0.25) {
      this.sample(lane, s, lat, o);
      if (this.walkable(o.x, o.z, lane)) { lo = Math.min(lo, lat); hi = lat; }
      else if (hi > -Infinity) break; // never bridge a road/building hole in the corridor
    }
    const result = lo <= hi ? { lo, hi } : { lo: -1.4, hi: -1.4 };
    lane.widths.set(key, result);
    return result;
  }

  private walkingLat(lane: Lane, s: number, dir: number, preference: number): number {
    const b = this.bounds(lane, s);
    // Positive lateral points away from traffic; right depends on lane side AND travel direction.
    // A stable full-width preference, gently skewed to the right rather than two disjoint bands.
    const bias = 0.65 * preference * (1 - preference);
    const t = preference + (dir * lane.side > 0 ? bias : -bias);
    const margin = Math.min(0.3, (b.hi - b.lo) * 0.1);
    return b.lo + margin + (b.hi - b.lo - margin * 2) * t;
  }

  private freeAt(x: number, z: number, ignore: Ped | null = null, radius = BODY_SPACE): boolean {
    for (const p of this.grid.near(x, z, radius + 0.1)) {
      if (p !== ignore && (p.x - x) ** 2 + (p.z - z) ** 2 < radius * radius) return false;
    }
    const local = this.ctx.state.local;
    return this.ctx.state.screenshotMode || local.vehicleKey !== null
      || Math.hypot(x - local.state.x, z - local.state.z) >= 0.9;
  }

  private trySpawn(): boolean {
    if (this.walkerCount() >= this.maxPeds || this.peds.length >= this.totalCapacity) return false;
    if (this.laneListDirty) this.rebuildLaneList();
    if (!this.laneList.length) return false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const covered = this.populationCovered();
      if (!covered && this.ingressWeight <= 0) return false;
      let pick = this.rnd() * (covered ? this.spawnWeight : this.ingressWeight), span = this.laneList[this.laneList.length - 1];
      for (const candidate of this.laneList) {
        if (!covered && !candidate.ingress) continue;
        pick -= candidate.weight; if (pick <= 0) { span = candidate; break; }
      }
      const lane = span.lane, s = span.s0 + this.rnd() * (span.s1 - span.s0);
      let dir: -1 | 1 = this.rnd() < 0.5 ? -1 : 1;
      const preference = this.rnd();
      const o = { x: 0, z: 0, dx: 0, dz: 0 };
      if (!this.populationPending) {
        this.sample(lane, s, 0, o);
        const towardView = o.dx * this.camDirection.x + o.dz * this.camDirection.z;
        if (Math.abs(towardView) > 0.4) dir = towardView > 0 ? 1 : -1;
      }
      const lat = this.walkingLat(lane, s, dir, preference);
      this.sample(lane, s, lat, o);
      if (Math.hypot(o.x - this.focus.x, o.z - this.focus.z) < NEAR_SPAWN_R) continue;
      if (this.ctx.world.isWater?.(o.x, o.z) || !this.walkable(o.x, o.z, lane) || !this.freeAt(o.x, o.z, null, 0.8)) continue;
      if (!this.canSpawn(o.x, o.z)) continue;
      // Do not initially place someone half-way through a crossing.
      if (lane.crossings.some(c => s > c.s0 - 0.6 && s < c.s1 + 0.6)) continue;
      this.spawnAt(lane, s, lat, o, dir, preference);
      return true;
    }
    return false;
  }

  private spawnAt(lane: Lane, s: number, lat: number, o: { x: number; z: number; dx: number; dz: number },
    dir: -1 | 1, preference: number, leader: Ped | null = null, seated = false): Ped {
    const seed = Math.floor(this.rnd() * 1e9);
    const inst = new CharacterInstance(randomAppearance(seed), this.shared, true);
    inst.setDetail('low'); inst.root.name = 'ped'; this.group.add(inst.root);
    const phone = !leader && this.rnd() < 0.18;
    const baseSpeed = leader ? leader.baseSpeed : (1.1 + this.rnd() * 0.6) * (phone ? 0.78 : 1);
    const mannerism: Mannerism = phone ? 'none' : this.rnd() < 0.3 ? 'pocketOne' : this.rnd() < 0.2 ? 'bagHold' : 'none';
    const ped: Ped = {
      inst, lane, dir, s, lat, latCur: lat, speed: baseSpeed, baseSpeed, state: 'walk', timer: 0,
      phone, jaywalker: this.rnd() < 0.16, x: o.x, z: o.z, yaw: Math.atan2(-o.dx * dir, -o.dz * dir),
      crossing: null, visible: true, fleeFrom: null, seed, follow: leader, followOff: leader ? lat - leader.lat : 0,
      mannerism, gy: this.ctx.physics.groundHeight(o.x, o.z), preference, phase: leader ? (leader.phase + 0.31 + this.rnd() * 0.25) % 1 : this.rnd(),
      // Mean 6.5 s dwell / (75 s walk + 6.5 s dwell) ≈ 8% stopping at eligible storefronts.
      stopIn: -Math.log(Math.max(0.001, this.rnd())) * 75, stopKind: null, seat: null, route: null, entry: null,
      lastCrossing: null, crossingCooldown: 0, blocked: 0, talkIn: 4 + this.rnd() * 10, talkFor: 0,
      animDt: this.rnd() * 0.05, thinkIn: this.rnd() * 0.2, green: false, carCooldown: 0, recoilX: 0, recoilZ: 0,
      unseen: 0,
      seatIn: 4 + this.rnd() * 16, seatWeight: 0, parkGuest: seated,
    };
    inst.root.position.set(o.x, ped.gy, o.z); inst.root.rotation.y = ped.yaw;
    inst.phone = phone ? 1 : 0; inst.mannerism = mannerism; inst.speed = baseSpeed;
    inst.play('walk', 0.01, true);
    inst.actions[inst.state].time = ped.phase * inst.actions[inst.state].getClip().duration;
    this.peds.push(ped); this.grid.add(ped);
    // Pairs/trios keep independent collision and signal decisions, never copy a partner's position/state.
    if (!seated && !leader && this.rnd() < 0.28) {
      const count = this.rnd() < 0.28 ? 2 : 1;
      for (let j = 0; j < count && this.walkerCount() < this.maxPeds && this.peds.length < this.totalCapacity; j++) {
        const b = this.bounds(lane, s), lat2 = lat + (j === 0 ? 0.85 : -0.85);
        if (lat2 < b.lo || lat2 > b.hi) continue;
        const o2 = { x: 0, z: 0, dx: 0, dz: 0 };
        this.sample(lane, s, lat2, o2);
        if (!this.walkable(o2.x, o2.z, lane) || !this.freeAt(o2.x, o2.z, null, 0.8) || !this.canSpawn(o2.x, o2.z)) continue;
        this.spawnAt(lane, s, lat2, o2, dir, preference, ped);
      }
    } else if (!seated && !leader && this.rnd() < 0.13) {
      // Initial standers also walk to an edge first; no mid-stream phone statues.
      this.planStop(ped, this.rnd() < 0.62 ? 'window' : 'stand');
    }
    return ped;
  }

  private walkerCount(): number { return this.peds.length - this.parkReserved; }

  private syncParkSeats(): void {
    const next = new Map<string, Seat>();
    for (const [module, value] of this.ctx.modules) for (const [id, seats] of (value as Partial<SeatSourceModule>).seatSources ?? []) {
      for (const s of seats) {
        if (![s.x, s.y, s.z, s.yaw].every(Number.isFinite)) continue;
        const key = `${s.x.toFixed(3)}:${s.y.toFixed(3)}:${s.z.toFixed(3)}`;
        // Furniture uses +Z forward, rigs -Z. Published y is an absolute seat surface.
        next.set(key, this.parkSeats.get(key) ?? { x: s.x, y: s.y, z: s.z, yaw: s.yaw + Math.PI, height: 0.46,
          groundY: Number.isFinite(s.groundY) ? s.groundY : undefined, source: `${module}:${id}` });
      }
    }
    const live = new Set(next.values());
    for (const [seat, p] of this.seatOwners) if (seat.y !== undefined && !live.has(seat)) {
      if (p.seatWeight > 0) this.standUp(p); else this.resume(p);
    }
    this.parkSeats = next;
    this.parkNearby = seatFillOrder([...next.values()].filter(s => Math.hypot(s.x - this.camPos.x, s.z - this.camPos.z) <= PARK_SEAT_RADIUS));
    this.parkTarget = Math.min(PARK_SEAT_CAPACITY, Math.round(this.parkNearby.length * 0.5 * Math.min(1, this.densityScale)));
    // Landmark jobs can publish seats after the ordinary sidewalk fill finished.
    // Keep that first chair fill behind the same loading screen, with a timeout
    // for incomplete world/path data, instead of depending on shader-job timing.
    if (this.parkTarget > 0 && this.populationCovered() && !this.seatPopulationDone && !this.seatPopulationPending) {
      this.seatPopulationPending = true; this.ctx.busy = (this.ctx.busy ?? 0) + 1;
    }
  }

  private populationCovered(): boolean {
    return this.populationPending || (typeof window !== 'undefined' && (window as unknown as { __ready?: boolean }).__ready === false);
  }

  private finishSeatPopulation(): void {
    if (!this.seatPopulationPending) return;
    this.seatPopulationPending = false; this.seatPopulationDone = true;
    this.ctx.busy = Math.max(0, (this.ctx.busy ?? 1) - 1);
  }

  private parkOccupied(): number { return this.parkNearby.reduce((n, s) => n + Number(this.seatOwners.has(s)), 0); }

  private seatFront(s: Seat): { x: number; z: number } {
    return { x: s.x - Math.sin(s.yaw) * 0.4, z: s.z - Math.cos(s.yaw) * 0.4 };
  }

  private parkWalkable(x: number, z: number, lane: Lane): boolean {
    return this.walkable(x, z, lane) || (!this.isInsideBuilding(x, z)
      && !!this.ctx.world.tileAt(x, z)?.parks.some(poly => pointInPolygon(x, z, poly)));
  }

  private seatRoute(seat: Seat): Route | null {
    const front = this.seatFront(seat);
    let best: Route | null = null, score = Infinity;
    for (const lane of this.lanes.values()) {
      const proj = this.project(lane, front.x, front.z);
      if (!proj || proj.dist > 30 || proj.dist + (lane.path ? 0 : 8) >= score) continue;
      const dir: -1 | 1 = this.rnd() < 0.5 ? -1 : 1;
      const lat = this.walkingLat(lane, proj.s, dir, 0.5);
      const o = { x: 0, z: 0, dx: 0, dz: 0 }; this.sample(lane, proj.s, lat, o);
      if (!this.parkWalkable(front.x, front.z, lane)) continue;
      best = { x: o.x, z: o.z, lane, s: proj.s, dir, lat }; score = proj.dist + (lane.path ? 0 : 8);
    }
    return best;
  }

  private populateSeats(): void {
    if (this.parkOccupied() >= this.parkTarget || this.peds.length >= this.totalCapacity) return;
    // __ready is the existing loading-screen gate (also reset by --spot). Never
    // pop a chair occupant into the live view, even when the landmark arrives late.
    const covered = this.populationCovered();
    const deadline = performance.now() + (covered ? 4 : 0.4);
    for (const seat of this.parkNearby) {
      if (this.parkOccupied() >= this.parkTarget || this.peds.length >= this.totalCapacity || performance.now() > deadline) break;
      if (this.seatOwners.has(seat) || (seat.availableAt ?? 0) > this.seatClock
        || (!covered && this.inView(seat.x, seat.z)) || !this.freeAt(seat.x, seat.z, null, BODY_SPACE)) continue;
      const route = this.seatRoute(seat); if (!route) continue;
      const p = this.spawnAt(route.lane, route.s, route.lat, { x: seat.x, z: seat.z, dx: -Math.sin(seat.yaw), dz: -Math.cos(seat.yaw) }, route.dir, this.rnd(), null, true);
      this.seatOwners.set(seat, p); this.parkReserved++; p.seat = seat;
      p.gy = seat.groundY ?? this.ctx.physics.groundHeight(this.seatFront(seat).x, this.seatFront(seat).z);
      this.sit(p, true); this.seatEvents.spawned++;
    }
  }

  private trySit(p: Ped): boolean {
    if (p.state !== 'walk' || p.crossing || p.seat || this.parkOccupied() >= this.parkTarget) return false;
    const seat = this.parkNearby.filter(s => !this.seatOwners.has(s) && (s.availableAt ?? 0) <= this.seatClock)
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))
      .find(s => {
        const f = this.seatFront(s), d = Math.hypot(f.x - p.x, f.z - p.z);
        if (d > 4 || !this.freeAt(s.x, s.z, p) || !this.freeAt(f.x, f.z, p)) return false;
        for (let t = 0.25; t <= 1; t += 0.25) if (!this.parkWalkable(p.x + (f.x - p.x) * t, p.z + (f.z - p.z) * t, p.lane)) return false;
        return true;
      });
    if (!seat) return false;
    this.seatOwners.set(seat, p); this.parkReserved++; p.seat = seat; p.parkGuest = true;
    p.state = 'approach'; p.stopKind = 'sit'; p.timer = 12; p.follow = null;
    return true;
  }

  private sit(p: Ped, immediate = false): void {
    if (p.seat?.groundY !== undefined) p.gy = p.seat.groundY;
    p.state = immediate ? 'sit' : 'sitDown'; p.timer = immediate ? 35 + this.rnd() * 85 : 1;
    p.stopKind = 'sit'; p.speed = 0; p.inst.speed = 0; p.yaw = p.seat!.yaw;
    p.phone = this.rnd() < 0.35; p.inst.mannerism = 'none'; p.seatWeight = immediate ? 1 : 0;
    if (immediate) { p.inst.play('sit', 0, true); p.inst.actions.sit.time = p.phase * 7; }
    const other = facingSeat(p.seat!, this.parkNearby), partner = other && this.seatOwners.get(other);
    if (partner && partner !== p) { p.follow = partner; partner.follow = p; }
  }

  private standUp(p: Ped): void {
    if (p.state === 'standUp') return;
    p.state = 'standUp'; p.timer = Math.max(0.01, p.seatWeight); p.speed = 0;
    p.phone = false; p.follow = null;
  }

  private releaseSeat(p: Ped): void {
    if (p.seat && this.seatOwners.get(p.seat) === p) {
      if (p.seat.y !== undefined) this.parkReserved--;
      this.seatOwners.delete(p.seat); p.seat.availableAt = this.seatClock + 8 + this.rnd() * 12;
    }
    p.seat = null; p.seatWeight = 0; p.inst.seating = null;
  }

  private despawn(i: number): void {
    const p = this.peds[i]; this.peds.splice(i, 1);
    if (p.seat?.y !== undefined) this.seatEvents.despawned++;
    this.releaseSeat(p);
    for (const q of this.peds) if (q.follow === p) q.follow = null;
    p.inst.dispose();
  }

  private planStop(p: Ped, kind: 'window' | 'stand'): void {
    if (this.trySit(p)) return;
    if (p.crossing || p.lane.crossings.some(c => p.s > c.s0 - 5 && p.s < c.s1 + 5)) return;
    const b = this.bounds(p.lane, p.s);
    if (b.hi - b.lo < 1.2) return; // no safe standing strip on a narrow sidewalk
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    this.sample(p.lane, p.s, b.hi, o);
    const nx = -o.dz * p.lane.side, nz = o.dx * p.lane.side;
    // A window stop needs an actual building, not merely the outside edge of a park path.
    const building = [0.5, 1.2, 2.5].some(d => this.isInsideBuilding(o.x + nx * d, o.z + nz * d));
    if (kind === 'window' && !building) kind = 'stand';
    p.lat = kind === 'window' || this.rnd() < 0.7 ? b.hi : b.lo;
    p.stopKind = kind; p.state = 'approach'; p.timer = 12; p.follow = null;
    p.phone = kind === 'stand' && this.rnd() < 0.7;
    if (this.rnd() < 0.2) for (const seats of this.seats.values()) {
      const seat = seats.find(s => !this.seatOwners.has(s) && Math.hypot(s.x - p.x, s.z - p.z) < 2.5 && this.freeAt(s.x, s.z, p, 0.85));
      if (seat && !this.isInsideBuilding(seat.x, seat.z)) { this.seatOwners.set(seat, p); p.seat = seat; p.stopKind = 'sit'; break; }
    }
  }

  private resume(p: Ped): void {
    this.releaseSeat(p);
    p.state = 'walk'; p.stopKind = null; p.timer = 0; p.seatWeight = 0;
    p.lat = this.walkingLat(p.lane, p.s, p.dir, p.preference);
    p.stopIn = -Math.log(Math.max(0.001, this.rnd())) * 75;
    p.inst.mannerism = p.mannerism;
    p.follow = null; p.seatIn = 18 + this.rnd() * 25;
  }

  private gunfire(x: number, z: number): void {
    for (const p of this.peds) {
      if (Math.hypot(p.x - x, p.z - z) > 30) continue;
      p.inst.action('hitReact');
      const seated = p.seat && p.seatWeight > 0;
      if (seated) this.standUp(p);
      else { this.releaseSeat(p); p.state = 'flinch'; p.timer = 0.3 + this.rnd() * 0.18; }
      p.fleeFrom = { x, z }; p.follow = null; p.stopKind = seated ? 'sit' : null;
      p.phone = false; p.inst.phone = 0; p.inst.mannerism = 'none';
      const o = { x: 0, z: 0, dx: 0, dz: 0 }; this.sample(p.lane, p.s, p.latCur, o);
      if (p.entry) { p.route = null; p.crossing = null; p.entry = null; }
      if (p.route && p.crossing) {
        const towardShot = (p.route.x - p.x) * (x - p.x) + (p.route.z - p.z) * (z - p.z) > 0;
        if (towardShot) {
          p.dir = p.dir > 0 ? -1 : 1;
          p.route = this.crossingExit(p, p.crossing) ?? p.route;
        }
      } else p.dir = (p.x - x) * o.dx + (p.z - z) * o.dz >= 0 ? 1 : -1;
      p.lat = this.walkingLat(p.lane, p.s, p.dir, p.preference);
    }
  }

  private signalGreen(c: LaneCrossing, dir: number): boolean {
    const props = this.ctx.modules.get('props') as PropsLike | undefined;
    const dx = c.dx * dir, dz = c.dz * dir;
    // API is parallel vehicle green, which also permits the parallel pedestrian crossing.
    // Query from its approach, not from the middle after the facing signal has been passed.
    const sig = props?.signalFor?.(c.x - dx * (c.half + 2), c.z - dz * (c.half + 2), dx, dz)
      ?? props?.signalFor?.(c.x + dx * (c.half + 2), c.z + dz * (c.half + 2), -dx, -dz);
    if (sig) return sig.state === 'green';
    return !c.signal; // missing signal information is not permission to invent a green
  }

  private carsApproaching(c: LaneCrossing): boolean {
    return this.cars.some(car => Math.hypot(car.x - c.x, car.z - c.z) < 15);
  }

  /** Find the sidewalk beyond a painted crossing, including split OSM road segments. */
  private crossingExit(p: Ped, c: LaneCrossing): Route | null {
    let cached = this.exits.get(c);
    if (cached?.has(p.dir)) return cached.get(p.dir)!;
    if (!cached) { cached = new Map(); this.exits.set(c, cached); }
    const dx = c.dx * p.dir, dz = c.dz * p.dir;
    let best: Route | null = null, bestScore = Infinity;
    // Rendered/planimetric curb lines can be a few metres beyond the OSM width.
    // Find the first real sidewalk on the far side, rather than rejecting the crossing.
    for (const extension of [0.6, 2, 4]) {
    for (const lane of this.lanes.values()) {
      if (lane.path) continue;
      const x = c.x + dx * (c.half + extension), z = c.z + dz * (c.half + extension);
      const proj = this.project(lane, x, z);
      if (!proj || proj.dist > 5 || Math.abs(proj.dirX * dx + proj.dirZ * dz) < 0.85) continue;
      const dir: -1 | 1 = proj.dirX * dx + proj.dirZ * dz > 0 ? 1 : -1;
      if ((dir > 0 && lane.len - proj.s < 1) || (dir < 0 && proj.s < 1)) continue;
      const o = { x: 0, z: 0, dx: 0, dz: 0 };
      this.sample(lane, proj.s, 0, o);
      const b = this.bounds(lane, proj.s);
      const lat = THREE.MathUtils.clamp((x - o.x) * (-o.dz * lane.side) + (z - o.z) * o.dx * lane.side, b.lo, b.hi);
      this.sample(lane, proj.s, lat, o);
      const lateral = Math.abs((o.x - c.x) * -dz + (o.z - c.z) * dx);
      const score = Math.hypot(o.x - x, o.z - z);
      if (lateral > 1.45 || score >= bestScore || !this.walkable(o.x, o.z, lane)) continue;
      bestScore = score; best = { x: o.x, z: o.z, lane, s: proj.s, dir, lat };
    }
    if (best) break;
    }
    cached.set(p.dir, best);
    return best;
  }

  private beginCrossing(p: Ped, c: LaneCrossing): boolean {
    const route = this.crossingExit(p, c);
    if (!route) return false;
    const dx = c.dx * p.dir, dz = c.dz * p.dir;
    const spread = (p.preference - 0.5) * 1.5;
    p.entry = null;
    for (const extension of [0.25, 1.5, 3, 4.5]) {
      const entry = { x: c.x - dx * (c.half + extension) - dz * spread, z: c.z - dz * (c.half + extension) + dx * spread };
      if (this.walkable(entry.x, entry.z, p.lane)) { p.entry = entry; break; }
    }
    if (!p.entry) return false;
    p.route = route; p.crossing = c; p.state = 'approach'; p.stopKind = null; p.timer = 0;
    return true;
  }

  /** Only turn onto geometrically connected walkable sidewalk. No 12 m endpoint teleport. */
  private nextLane(p: Ped): void {
    const lane = p.lane, atEnd = p.dir > 0;
    const end = lane.road.pts[atEnd ? lane.road.pts.length - 1 : 0];
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    this.sample(lane, p.s, p.latCur, o);
    const fx = o.dx * p.dir, fz = o.dz * p.dir;
    let best: Route | null = null, score = -Infinity;
    for (const r of this.ctx.world.roadsNear(end[0], end[1], 10)) for (const side of [-1, 1]) {
      const l = this.lanes.get(`${r.id}:${side}`); if (!l || l === lane) continue;
      const proj = this.project(l, p.x, p.z); if (!proj || proj.dist > 5) continue;
      const dir: -1 | 1 = proj.s < l.len / 2 ? 1 : -1;
      const s = THREE.MathUtils.clamp(proj.s + dir * 0.7, 0, l.len);
      const lat = this.walkingLat(l, s, dir, p.preference);
      this.sample(l, s, lat, o);
      if (Math.hypot(o.x - p.x, o.z - p.z) > 2.5 || !this.walkable(o.x, o.z, l)
        || !this.walkable((o.x + p.x) / 2, (o.z + p.z) / 2, l)) continue;
      const rank = o.dx * dir * fx + o.dz * dir * fz + this.rnd() * 0.3;
      if (rank > score) { score = rank; best = { x: o.x, z: o.z, lane: l, s, dir, lat }; }
    }
    if (best) { p.lane = best.lane; p.s = best.s; p.dir = best.dir; p.lat = best.lat; }
    else { p.dir = p.dir > 0 ? -1 : 1; p.s = THREE.MathUtils.clamp(p.s, 0.05, lane.len - 0.05); p.lat = this.walkingLat(lane, p.s, p.dir, p.preference); }
  }
  private think(p: Ped, dt: number): void {
    p.timer -= dt; p.crossingCooldown -= dt; p.carCooldown -= dt;
    p.talkIn -= dt; p.talkFor = Math.max(0, p.talkFor - dt);
    if (p.follow && Math.hypot(p.follow.x - p.x, p.follow.z - p.z) > 10) p.follow = null;
    if (p.follow && p.talkIn <= 0) { p.talkFor = 1.5 + this.rnd(); p.talkIn = 6 + this.rnd() * 12; }
    p.thinkIn -= dt;
    if (p.thinkIn <= 0) {
      p.thinkIn = 0.15 + (p.seed % 7) * 0.01;
      if (p.crossing) p.green = this.signalGreen(p.crossing, p.dir)
        || (p.jaywalker && p.timer < -2 && !this.carsApproaching(p.crossing));
      if (p.carCooldown <= 0 && p.state !== 'flinch' && p.state !== 'flee' && !p.seat) {
        for (const car of this.cars) if (Math.abs(car.speed) > 2 && Math.hypot(car.x - p.x, car.z - p.z) < 2) {
          const d = Math.hypot(p.x - car.x, p.z - car.z) || 1;
          p.recoilX = (p.x - car.x) / d; p.recoilZ = (p.z - car.z) / d;
          p.state = 'stepBack'; p.timer = 0.65; p.carCooldown = 2; p.inst.action('hitReact'); break;
        }
      }
    }
    if (p.state === 'flinch') {
      p.speed = 0;
      if (p.timer <= 0) { p.state = 'flee'; p.timer = 5; }
      return;
    }
    if (p.state === 'flee') {
      p.speed = 4.2 + (p.seed % 9) * 0.1;
      if (p.timer <= 0) { p.fleeFrom = null; if (p.route) p.state = 'cross'; else this.resume(p); }
      return;
    }
    if (p.state === 'stepBack') {
      p.speed = 1.3;
      if (p.timer <= 0) { if (p.route) p.state = p.entry ? 'approach' : 'cross'; else this.resume(p); }
      return;
    }
    if (p.state === 'sitDown' || p.state === 'standUp') {
      p.speed = 0;
      const rising = p.state === 'standUp';
      p.seatWeight = THREE.MathUtils.smoothstep(rising ? p.timer : 1 - p.timer, 0, 1);
      if (p.timer <= 0) {
        if (rising) {
          this.seatEvents.stoodUp++;
          const fleeing = p.fleeFrom; this.resume(p);
          if (fleeing) { p.state = 'flee'; p.timer = 5; }
        } else { p.state = 'sit'; p.timer = 35 + this.rnd() * 85; p.seatWeight = 1; this.seatEvents.satDown++; }
      }
      return;
    }
    if (p.state === 'sit') {
      p.speed = 0;
      if (p.timer <= 0) this.standUp(p);
      return;
    }
    if (p.state === 'stand' || p.state === 'window') {
      p.speed = 0;
      if (p.timer <= 0) this.resume(p);
      return;
    }
    if (p.state === 'wait') {
      p.speed = 0;
      if (p.green) p.state = 'approach';
      return;
    }
    if (p.state === 'cross') { p.speed = p.baseSpeed; return; }
    if (p.state === 'approach') {
      p.speed = Math.min(1.2, p.baseSpeed);
      if (p.crossing && p.entry) {
        const d = Math.hypot(p.entry.x - p.x, p.entry.z - p.z);
        if ((d < 2.5 || p.blocked > 0.5) && !p.green) { p.state = 'wait'; p.speed = 0; }
        else if (d < 0.3) { p.state = 'cross'; p.entry = null; }
      } else if (p.stopKind) {
        const o = { x: 0, z: 0, dx: 0, dz: 0 }; this.sample(p.lane, p.s, p.lat, o);
        const target = p.seat ? this.seatFront(p.seat) : o;
        if (Math.hypot(target.x - p.x, target.z - p.z) < 0.16) {
          if (p.seat) { this.sit(p); return; }
          p.state = p.stopKind; p.timer = 3 + this.rnd() * 7; p.speed = 0;
          // Face the facade; curb standers face back toward the sidewalk.
          const nx = -o.dz * p.lane.side, nz = o.dx * p.lane.side;
          p.yaw = Math.atan2(-nx, -nz);
          p.inst.mannerism = p.phone ? 'none' : this.rnd() < 0.5 ? 'pockets' : 'armsCrossed';
        } else if (p.timer <= 0) this.resume(p);
      }
      return;
    }
    p.speed = p.baseSpeed;
    p.seatIn -= dt;
    if (p.seatIn <= 0 && !p.follow) {
      p.seatIn = 8 + this.rnd() * 12;
      if (this.trySit(p)) return;
    }
    p.stopIn -= dt;
    if (p.stopIn <= 0 && !p.follow) { this.planStop(p, 'window'); p.stopIn = 50 + this.rnd() * 50; }
    if (p.state !== 'walk') return;
    const L = p.follow;
    if (L && L.lane === p.lane && L.dir === p.dir && L.state === 'walk') {
      const gap = (L.s - p.s) * p.dir;
      p.speed = p.baseSpeed * THREE.MathUtils.clamp(1 + gap * 0.1, 0.88, 1.12);
      const b = this.bounds(p.lane, p.s); p.lat = THREE.MathUtils.clamp(L.lat + p.followOff, b.lo, b.hi);
    } else p.lat = this.walkingLat(p.lane, p.s, p.dir, p.preference);
    for (const c of p.lane.crossings) {
      if (c === p.lastCrossing && p.crossingCooldown > 0) continue;
      const ahead = p.dir > 0 ? c.s0 - p.s : p.s - c.s1;
      if (ahead >= -0.5 && ahead < 6 && this.beginCrossing(p, c)) break;
    }
  }

  private move(p: Ped, dt: number, px: number, pz: number, player: boolean): void {
    // The chair owns the pelvis throughout the transition. Player avoidance may
    // make a sitter get up, but cannot push the seated pose off its seat.
    if (p.seat && (p.state === 'sit' || p.state === 'sitDown' || p.state === 'standUp')) {
      if (player && Math.hypot(p.x - px, p.z - pz) < 0.85) this.standUp(p);
      const oldX = p.x, oldZ = p.z, front = this.seatFront(p.seat);
      p.x = p.seat.x * p.seatWeight + front.x * (1 - p.seatWeight);
      p.z = p.seat.z * p.seatWeight + front.z * (1 - p.seatWeight);
      p.yaw = p.seat.yaw; p.inst.speed = 0; this.grid.move(p, oldX, oldZ);
      return;
    }
    // The player is not simulated by this manager. Resolve an externally imposed
    // contact even for a phone-stander or a red-light waiter, then resume yielding.
    if (player && Math.hypot(p.x - px, p.z - pz) < 0.9) {
      const angle = Math.atan2(p.z - pz, p.x - px);
      for (const turn of [0, 0.5, -0.5, 1, -1]) {
        const x = px + Math.cos(angle + turn) * 0.92, z = pz + Math.sin(angle + turn) * 0.92;
        if (!this.freeAt(x, z, p) || !this.walkable(x, z, p.lane)) continue;
        const oldX = p.x, oldZ = p.z; p.x = x; p.z = z; this.grid.move(p, oldX, oldZ);
        break;
      }
    }
    if (p.speed <= 0) { p.inst.speed = 0; return; }
    const oldS = p.s, oldX = p.x, oldZ = p.z, oldLane = p.lane, oldDir = p.dir, oldLat = p.lat;
    const o = { x: 0, z: 0, dx: 0, dz: 0 };
    let tx: number, tz: number;
    const routed = p.route && (p.state === 'cross' || p.state === 'flee');
    if (routed) { tx = p.route!.x; tz = p.route!.z; }
    else if (p.state === 'stepBack') { tx = p.x + p.recoilX; tz = p.z + p.recoilZ; }
    else if (p.crossing && p.entry) { tx = p.entry.x; tz = p.entry.z; }
    else if (p.stopKind) {
      this.sample(p.lane, p.s, p.lat, o); const target = p.seat ? this.seatFront(p.seat) : o; tx = target.x; tz = target.z;
    } else {
      p.latCur += (p.lat - p.latCur) * (1 - Math.exp(-dt * 2.5));
      this.sample(p.lane, p.s, p.latCur, o);
      if (Math.hypot(o.x - p.x, o.z - p.z) < 0.7) p.s += p.speed * dt * p.dir;
      if (p.s < 0 || p.s > p.lane.len) this.nextLane(p);
      this.sample(p.lane, p.s, p.latCur, o); tx = o.x; tz = o.z;
    }
    const d = Math.hypot(tx - p.x, tz - p.z);
    if (d < 0.015) { p.inst.speed = 0; return; }
    let dx = (tx - p.x) / d, dz = (tz - p.z) / d, speed = p.speed;
    let steer = 0;
    const rx = -dz, rz = dx;
    for (const q of this.grid.near(p.x, p.z, 2)) {
      if (q === p) continue;
      const qx = q.x - p.x, qz = q.z - p.z, distance = Math.hypot(qx, qz);
      const along = qx * dx + qz * dz, across = qx * rx + qz * rz;
      if (distance > 1.6 || along < -0.25) continue;
      if (Math.abs(across) < 0.7 && along > 0) {
        const clearance = Math.max(0, along - BODY_SPACE);
        speed = Math.min(speed, Math.max(0, clearance * 2));
      }
      if (distance < 1.2) steer += (across > 0.15 ? -1 : 1) * (1.2 - distance) * 2;
    }
    if (player) {
      const qx = px - p.x, qz = pz - p.z, distance = Math.hypot(qx, qz);
      if (distance < 1.8 && qx * dx + qz * dz > -0.3) {
        steer += (qx * rx + qz * rz > 0 ? -1 : 1) * (1.8 - distance) * 2;
        speed = Math.min(speed, Math.max(0, (distance - 0.9) * 2));
      }
    }
    const clamp = THREE.MathUtils.clamp;
    steer = clamp(steer, -1, 1);
    const step = Math.min(d, speed * dt), sideStep = steer * dt * Math.min(p.speed, 1.1);
    const valid = (x: number, z: number): boolean => {
      if (!this.freeAt(x, z, p)) return false;
      if (routed && p.crossing) {
        if (this.isInsideBuilding(x, z)) return false;
        const c = p.crossing;
        const across = Math.abs((x - c.x) * -c.dz + (z - c.z) * c.dx);
        const end = p.route!;
        const reach = Math.max(c.half + 3, Math.abs((end.x - c.x) * c.dx + (end.z - c.z) * c.dz) + 0.5);
        if (across <= 1.6 && Math.abs((x - c.x) * c.dx + (z - c.z) * c.dz) <= reach) return true;
      }
      return p.parkGuest ? this.parkWalkable(x, z, p.lane) : this.walkable(x, z, p.lane);
    };
    let nx = p.x + dx * step + rx * sideStep, nz = p.z + dz * step + rz * sideStep;
    if (!valid(nx, nz)) {
      // Try a right-side yield, then the other side. Never push another actor through a wall.
      const lateral = Math.min(0.8, p.speed) * dt;
      nx = p.x + rx * lateral; nz = p.z + rz * lateral;
      if (!valid(nx, nz)) {
        nx = p.x - rx * lateral; nz = p.z - rz * lateral;
        if (!valid(nx, nz)) { nx = p.x; nz = p.z; }
      }
    }
    const moved = Math.hypot(nx - p.x, nz - p.z);
    if (moved < p.speed * dt * 0.2) {
      p.blocked += dt; p.s = oldS;
      // A blocked lane handoff must restore the old coordinate frame as well as
      // its distance. An old 300 m distance is meaningless on a new 40 m lane.
      if (p.lane !== oldLane) { p.lane = oldLane; p.dir = oldDir; p.lat = oldLat; }
    }
    else p.blocked = Math.max(0, p.blocked - dt * 2);
    if (p.blocked > 3 && !p.crossing && !p.stopKind && p.state === 'walk') {
      p.dir = p.dir > 0 ? -1 : 1; p.follow = null; p.blocked = 0;
    }
    // A stationary queue must not keep marching its animation at the desired speed.
    p.inst.speed = moved / Math.max(dt, 0.001);
    if (moved > 0.001 && p.state !== 'stepBack') p.yaw = lerpAngle(p.yaw, Math.atan2(-(nx - p.x), -(nz - p.z)), 1 - Math.exp(-dt * 7));
    p.x = nx; p.z = nz; this.grid.move(p, oldX, oldZ);
    if (routed && p.route && Math.hypot(p.x - p.route.x, p.z - p.route.z) < 0.22) {
      const route = p.route;
      p.lane = route.lane; p.s = route.s; p.dir = route.dir; p.latCur = route.lat;
      p.lastCrossing = p.crossing; p.crossingCooldown = 8; p.crossing = null; p.route = null; p.entry = null;
      if (p.state !== 'flee') this.resume(p);
    }
  }

  update(dt: number): void {
    if (this.benchmarking) return;
    dt = Math.min(dt, 0.05); // keep collision steps short even after a stalled render
    const ctx = this.ctx, screenshot = ctx.state.screenshotMode;
    const f = screenshot ? ctx.camera.position : ctx.state.local.state;
    this.focus.set(f.x, 0, f.z); this.camPos.copy(ctx.camera.position);
    ctx.camera.getWorldDirection(this.camDirection); ctx.camera.updateMatrixWorld();
    this.view.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.view);
    this.seatClock += dt; this.seatSyncIn -= dt;
    if (this.seatSyncIn <= 0) { this.seatSyncIn = 0.5; this.syncParkSeats(); }
    const hour = Math.floor((ctx.time?.dayFraction ?? 15 / 24) * 48);
    if (hour !== this.densityHour) { this.densityHour = hour; this.laneListDirty = true; }
    if (this.laneListDirty || this.laneFocus.distanceToSquared(this.focus) > 12 ** 2 || this.laneDirection.dot(this.camDirection) < 0.94) this.rebuildLaneList();
    const target = this.targetCount();
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const inView = this.inView(p.x, p.z);
      p.unseen = inView ? 0 : p.unseen + dt;
      const stale = !this.lanes.has(`${p.lane.road.id}:${p.lane.side}`);
      const distance = Math.hypot(p.x - f.x, p.z - f.z);
      // An unseen pedestrian need not reach the far radius before freeing an
      // ingress slot. Otherwise all 150 actors drift away and the foreground empties.
      const parked = p.seat?.y !== undefined;
      const recycle = !parked && p.unseen > 8 && distance > 15 && !p.crossing;
      const retire = parked ? Math.hypot(p.x - this.camPos.x, p.z - this.camPos.z) > PARK_SEAT_RADIUS + 10
        || this.densityScale === 0 : this.walkerCount() > target;
      if ((stale || distance > DESPAWN_R || retire || recycle) && !inView) this.despawn(i);
    }
    this.grid.rebuild(this.peds);
    this.populateSeats();
    if (this.seatPopulationPending) {
      this.seatPopulationTime += dt;
      if (this.parkOccupied() >= this.parkTarget || this.seatPopulationTime >= 4) this.finishSeatPopulation();
    }
    if (this.walkerCount() < target) {
      this.spawnAcc = Math.min(12, this.spawnAcc + dt * (this.populationPending ? 200 : 20));
      const deadline = performance.now() + (this.populationPending ? 4 : 0.35);
      while (this.spawnAcc >= 1 && this.walkerCount() < target && performance.now() < deadline) { this.spawnAcc--; this.trySpawn(); }
    }
    if (this.populationPending) {
      this.populationTime += dt;
      if ((target > 0 && this.walkerCount() >= target && this.parkOccupied() >= this.parkTarget) || this.populationTime >= 4 || this.densityScale === 0) this.finishPopulation();
    }
    this.carTime -= dt;
    if (this.carTime <= 0) { this.carTime = 0.1; this.cars = (ctx.modules.get('vehicles') as VehiclesLike | undefined)?.traffic?.() ?? []; }
    const local = ctx.state.local.state, player = !screenshot && ctx.state.local.vehicleKey === null;
    // Rank the poses we will render, not their positions before movement. A distance
    // cutoff from the previous pose dropped the Nth rig and could admit a farther one.
    this.nearPeds.length = 0;
    for (const p of this.peds) {
      this.think(p, dt); this.move(p, dt, local.x, local.z, player);
      if (this.inView(p.x, p.z)) {
        const distance = (p.x - this.camPos.x) ** 2 + (p.z - this.camPos.z) ** 2;
        if (distance < PED_FULL ** 2) this.nearPeds.push(p);
      }
    }
    const distanceSq = (p: Ped) => (p.x - this.camPos.x) ** 2 + (p.z - this.camPos.z) ** 2;
    this.nearPeds.sort((a, b) => distanceSq(a) - distanceSq(b));
    this.fullPeds.clear();
    for (let i = 0; i < Math.min(this.nearPeds.length, fullCap(this.maxPeds, ctx.quality.level)); i++) this.fullPeds.add(this.nearPeds[i]);
    this.crowdBatch.begin();
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i], inst = p.inst;
      if (!p.seat && (i + this.slot) % 12 === 0) p.gy = ctx.physics.groundHeight(p.x, p.z);
      const seated = p.seat && (p.state === 'sit' || p.state === 'sitDown' || p.state === 'standUp');
      const seatY = seated ? (p.seat!.y ?? p.gy + p.seat!.height) - p.gy : 0;
      inst.seating = seated ? { height: seatY / inst.root.scale.y, weight: p.seatWeight, lean: -9 + (p.seed % 17) } : null;
      inst.root.position.set(p.x, p.gy + (seatY + (0.075 - 0.955) * inst.root.scale.y) * p.seatWeight, p.z); inst.root.rotation.y = p.yaw;
      const d2 = (p.x - this.camPos.x) ** 2 + (p.z - this.camPos.z) ** 2;
      const visible = this.inView(p.x, p.z);
      const full = this.fullPeds.has(p);
      if (visible !== p.visible) { p.visible = visible; inst.setVisible(visible); }
      if (!visible) { inst.root.removeFromParent(); continue; }
      const detailChanged = inst.detail !== (full ? 'high' : 'low');
      inst.setDetail(full ? 'high' : 'low');
      if (full) { if (!inst.root.parent) this.group.add(inst.root); inst.mesh.visible = true; }
      else { inst.root.removeFromParent(); inst.mesh.visible = false; }
      const shadows = full && d2 < PED_SHADOW ** 2;
      if (detailChanged || inst.mesh.castShadow !== shadows) inst.setShadows(shadows);
      inst.phone = p.phone && p.state !== 'cross' && p.state !== 'flee' ? 1 : 0;
      const clip = seated ? 'sit' : inst.speed > 3 ? 'run' : inst.speed > 0.18 ? 'walk' : 'idle';
      const prev = inst.state; inst.play(clip, 0.2);
      // play() resets newly entered actions (including auto-selected stroll); phase AFTER that reset.
      if (prev !== inst.state) inst.actions[inst.state].time = p.phase * inst.actions[inst.state].getClip().duration;
      inst.lookWeight = 0;
      if (d2 < PED_MID ** 2 && p.follow && p.talkFor > 0 && !p.phone) {
        inst.lookYaw = THREE.MathUtils.clamp(lerpAngle(0, Math.atan2(-(p.follow.x - p.x), -(p.follow.z - p.z)) - p.yaw, 1), -0.85, 0.85);
        inst.lookWeight = 0.8;
      } else if (full && player && !p.phone && Math.hypot(local.x - p.x, local.z - p.z) < 5) {
        const angle = lerpAngle(0, Math.atan2(-(local.x - p.x), -(local.z - p.z)) - p.yaw, 1);
        if (Math.abs(angle) < 1.1) { inst.lookYaw = angle; inst.lookWeight = 0.5; }
      }
      // Mid poses stay at 20 Hz; far/batched poses use 10 Hz, staggered between people.
      p.animDt += dt;
      const reaction = p.state === 'flinch' || p.state === 'stepBack';
      if (full || reaction || p.animDt >= (d2 < PED_MID ** 2 ? 0.05 : 0.1)) { inst.update(p.animDt, full || reaction); p.animDt = 0; }
      if (!full) this.crowdBatch.add(inst, i, d2 <= CROWD_SHADOW ** 2);
    }
    this.crowdBatch.end(); this.slot++;
  }

  count(): number { return this.peds.length; }
  visualStats() {
    return { count: this.peds.length, visible: this.peds.filter(p => p.visible).length,
      glbInstances: this.peds.filter(p => p.inst.imported).length,
      glbRendered: this.peds.filter(p => p.inst.rendersImported).length,
      proceduralRendered: this.peds.filter(p => p.visible && (p.inst.detail === 'low' || !p.inst.imported)).length,
      high: this.peds.filter(p => p.visible && p.inst.detail === 'high').length,
      waiting: this.peds.filter(p => p.state === 'wait').length,
      states: this.peds.reduce((out, p) => { out[p.state] = (out[p.state] ?? 0) + 1; return out; }, {} as Record<string, number>),
      fullBudget: fullCap(this.maxPeds, this.ctx.quality.level),
      seating: this.seatingStats(),
      nearest: this.peds.filter(p => p.visible).map(p => ({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), distance: +Math.hypot(p.x - this.camPos.x, p.z - this.camPos.z).toFixed(2), detail: p.inst.detail, imported: p.inst.rendersImported })).sort((a, b) => a.distance - b.distance).slice(0, fullCap(this.maxPeds, this.ctx.quality.level) + 1) };
  }
  /** Available through the existing __character.crowd().seating / __stats hook. */
  seatingStats() {
    const near = new Set(this.parkNearby), sitters = this.peds.filter(p => p.state === 'sit' && p.seat && near.has(p.seat));
    const occupied = new Set(sitters.map(p => p.seat));
    const paired = sitters.filter(p => { const other = facingSeat(p.seat!, this.parkNearby); return other && occupied.has(other); });
    return { seats: this.parkSeats.size, within60m: near.size, target: this.parkTarget,
      seated: sitters.length, reserved: this.parkOccupied(), visible: sitters.filter(p => p.visible).length,
      occupancy: near.size ? sitters.length / near.size : 0, pairedSitters: paired.length,
      duplicateSeats: sitters.length - occupied.size,
      sources: sitters.reduce((out, p) => { const id = p.seat!.source!; out[id] = (out[id] ?? 0) + 1; return out; }, {} as Record<string, number>),
      ...this.seatEvents };
  }
  setImported(enabled: boolean): void { for (const p of this.peds) p.inst.setImported(enabled); }
  benchmarkAnimation(): void {
    this.crowdBatch.begin();
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i]; if (!p.visible) continue;
      p.inst.update(1 / 60, p.inst.detail === 'high');
      if (p.inst.detail === 'low') this.crowdBatch.add(p.inst, i, (p.x - this.camPos.x) ** 2 + (p.z - this.camPos.z) ** 2 <= CROWD_SHADOW ** 2);
    }
    this.crowdBatch.end();
  }
  laneCount(): number { return this.lanes.size; }
  spawnStats(): { candidates: number; target: number } { return { candidates: this.laneList.length, target: this.targetCount() }; }
  private finishPopulation(): void {
    if (!this.populationPending) return; this.populationPending = false; this.ctx.busy = Math.max(0, (this.ctx.busy ?? 1) - 1);
  }
  dispose(): void {
    this.finishPopulation(); this.finishSeatPopulation(); for (const off of this.offs) off();
    for (let i = this.peds.length - 1; i >= 0; i--) this.despawn(i);
    this.lanes.clear(); this.seats.clear(); this.parkSeats.clear(); this.parkNearby = []; this.seatOwners.clear(); this.exits.clear();
    this.tileEgresses.clear(); this.egresses.length = 0; this.grid.rebuild([]); this.crowdBatch.dispose();
  }
}
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
