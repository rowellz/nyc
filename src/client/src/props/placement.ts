/** Tile-owned instance records; geometry and materials are shared by the city-wide renderers. */
import type { GameContext } from '@/core/context';
import type { Building, Prop, RoadSegment, Tile } from '@shared/world';
import { TILE_SIZE } from '@shared/geo';
import { SignAtlas, type Rect } from './atlas';
import { hash01 } from './builder';
import { InstanceList, type TileStore } from './renderer';
import { SignalNetwork, type SignalPole } from './signals';
import { signalApproach } from './signalPlacement';
import type { LightSource } from './lights';
import type { SteamEmitter } from './steam';
import { signName } from './streetNames';
import { LAMP_HEAD_LOCAL } from './kinds/lamp';
import { BLADE_X0, BLADE_W } from './kinds/signs';
import { BAY, SHED_DEPTH, SHED_H } from './kinds/scaffolding';
import { FLOOR_H, FE_W, FE_BASE } from './kinds/fireEscape';
import { SUB_L, SUB_W } from './kinds/subway';
import { subwayLines } from './kinds/subwayLines';
import { dressTileSteps, WALK_Y } from './dressing';
import { hash2, pointInPolygon } from '../environment/geom';
import { pointInPolygon as trashPointInPolygon, ringCentroid } from '../buildings/polygon';

export interface PropTile extends TileStore {
  signs: string[];
  signals: number[];
  lights: LightSource[];
  steam: SteamEmitter[];
}

/** road classes that carry an avenue's furniture density (news racks, bagged set-outs) */
const AVENUE_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary']);
/** Runtime-only kind: deliberately does not extend the persisted world/data contract. */
export interface TrashBagPlacement {
  kind: 'trash_bags'; ref: number; x: number; z: number; yaw: number;
  clearance: number; bags: number; dayBags: number; seed: number;
}
const TRASH_ROADS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified']);

/** The city-wide anchoring rule. Keep raw exterior edges (normalizing/merging them
 * would move their midpoints). Closest point is on each actual polyline segment. */
export function trashBagPlacement(building: Building, roads: readonly RoadSegment[]): TrashBagPlacement | null {
  if (hash01(building.id, 817) >= 0.15) return null;
  const ring = building.footprint[0];
  if (!ring || ring.length < 3) return null;
  let best: TrashBagPlacement | null = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (!Number.isFinite(length) || length < 3) continue;
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    for (const road of roads) {
      if (road.tunnel || road.bridge || !TRASH_ROADS.has(road.cls) || !Number.isFinite(road.width) || road.width <= 0) continue;
      let distance = Infinity, px = 0, pz = 0;
      for (let j = 1; j < road.pts.length; j++) {
        const c = road.pts[j - 1], d = road.pts[j];
        const sx = d[0] - c[0], sz = d[1] - c[1], l2 = sx * sx + sz * sz;
        if (!l2) continue;
        const t = Math.max(0, Math.min(1, ((mx - c[0]) * sx + (mz - c[1]) * sz) / l2));
        const x = c[0] + sx * t, z = c[1] + sz * t, dist = Math.hypot(mx - x, mz - z);
        if (dist < distance) { distance = dist; px = x; pz = z; }
      }
      const clearance = distance - road.width / 2;
      if (clearance < 1.5 || clearance > 12 || (best && clearance >= best.clearance)) continue;
      const nx = (mx - px) / distance, nz = (mz - pz) / distance;
      if (Math.abs((dx * nx + dz * nz) / length) > 0.35) continue;
      const x = px + nx * (road.width / 2 + 0.65), z = pz + nz * (road.width / 2 + 0.65);
      if (![x, z, nx, nz].every(Number.isFinite) || trashPointInPolygon(x, z, building.footprint)) continue;
      best = { kind: 'trash_bags', ref: building.id, x, z, yaw: Math.atan2(nx, nz), clearance,
        bags: 3 + Math.floor(hash01(building.id, 818) * 6),
        dayBags: hash01(building.id, 819) < 0.24 ? 1 + Math.floor(hash01(building.id, 820) * 2) : 0,
        seed: hash01(building.id, 821) };
    }
  }
  return best;
}

// Claims are scoped to a world, not a camera. Tile identity invalidates a claim on
// unload/reload; pruning at the next placement avoids retaining streamed-out tiles.
const trashClaims = new WeakMap<GameContext['world'], Map<number, { tile: Tile; store: PropTile }>>();

/** Conservative pile + 1.25 m rear walking-lane test, including thin crossing walls. */
function trashIntersectsBuilding(p: TrashBagPlacement, building: Building): boolean {
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const local = ([x, z]: [number, number]) => [(x - p.x) * c - (z - p.z) * s, (x - p.x) * s + (z - p.z) * c];
  const inside = (x: number, z: number) => x >= -1.37 && x <= 1.18 && z >= -0.47 && z <= 1.72;
  for (const x of [-1.37, 0, 1.18]) for (const z of [-0.47, 0.62, 1.72]) {
    if (trashPointInPolygon(p.x + x * c + z * s, p.z - x * s + z * c, building.footprint)) return true;
  }
  for (const ring of building.footprint) for (let i = 0; i < ring.length; i++) {
    const a = local(ring[i]), b = local(ring[(i + 1) % ring.length]);
    if (inside(a[0], a[1])) return true;
    let lo = 0, hi = 1;
    for (const [axis, min, max] of [[0, -1.37, 1.18], [1, -0.47, 1.72]]) {
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-9) { if (a[axis] < min || a[axis] > max) hi = -1; }
      else {
        const t0 = (min - a[axis]) / delta, t1 = (max - a[axis]) / delta;
        lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      }
    }
    if (lo <= hi) return true;
  }
  return false;
}

/** One instanced record per selected building, never rescheduled when time changes. */
export function* placeTrashBagSteps(ctx: GameContext, tile: Tile, store: PropTile): Generator<void> {
  let claims = trashClaims.get(ctx.world);
  if (!claims) trashClaims.set(ctx.world, claims = new Map());
  for (const [id, owner] of claims) {
    if (ctx.world.tiles?.get(owner.tile.key) !== owner.tile || !owner.store.kinds.has('trash_bags')) claims.delete(id);
  }
  const seen = new Set<number>();
  for (const building of tile.buildings) {
    yield;
    if (seen.has(building.id) || claims.has(building.id)) continue;
    seen.add(building.id);
    if (hash01(building.id, 817) >= 0.15 || !building.footprint[0]?.length) continue;
    const center = ringCentroid(building.footprint[0]);
    const radius = Math.max(...building.footprint[0].map(p => Math.hypot(p[0] - center[0], p[1] - center[1]))) + 30;
    const roads = new Map(tile.roads.map(road => [road.id, road]));
    for (const road of ctx.world.roadsNear?.(center[0], center[1], radius) ?? []) roads.set(road.id, road);
    const p = trashBagPlacement(building, [...roads.values()].sort((a, b) => a.id - b.id));
    // 0.65 m curb inset + <=0.47 m bag depth + 1.25 m continuous walking lane.
    // Reject a tight site rather than shifting the specified midpoint anchor.
    if (!p || p.clearance < 2.37) continue;
    const neighbors = new Set([...tile.buildings, ...(ctx.world.buildingsNear?.(p.x, p.z, 3) ?? [])]);
    if ([...neighbors].some(b => trashIntersectsBuilding(p, b))) continue;
    // Keep crossing approaches and authored subway/station entrances free; poles,
    // hydrants and other solid furniture retain their existing positions.
    if (tile.crossings.some(c => Math.hypot(c.x - p.x, c.z - p.z) < 3 + c.width / 2)) continue;
    if (tile.props.some(o => !['manhole', 'sewer_grate', 'subway_grate', 'fire_escape', 'scaffolding'].includes(o.kind)
      && Math.hypot(o.x - p.x, o.z - p.z) < (o.kind === 'subway_entrance' ? 5 : o.kind === 'bus_stop' || o.kind === 'citibike_dock' ? 4 : 1.65))) continue;
    const ground = ctx.physics.groundHeight(p.x, p.z);
    const y = Math.max(0.15, Number.isFinite(ground) ? ground : 0);
    let list = store.kinds.get('trash_bags');
    if (!list) store.kinds.set('trash_bags', list = new InstanceList());
    list.push(p.x, y, p.z, p.yaw, 1, p.bags, p.dayBags, p.seed, 0);
    claims.set(building.id, { tile, store });
    // Soft bags intentionally never call solid(): hidden daytime bags cannot collide.
  }
}

/** Closest segment, not the road's end-to-end chord (curved roads and duplicate ways are common). */
function roadNear(roads: RoadSegment[], p: Prop, name?: string) {
  let best: { road: RoadSegment; x: number; z: number; dx: number; dz: number } | null = null;
  let distance = 45 * 45;
  for (const road of roads) {
    if (road.tunnel || (name && signName(road.name) !== name)) continue;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i];
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / l2));
      const x = a[0] + t * dx, z = a[1] + t * dz;
      const d = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d < distance) { distance = d; best = { road, x, z, dx: dx / Math.sqrt(l2), dz: dz / Math.sqrt(l2) }; }
    }
  }
  return best;
}

/** Resolve the referenced wall instead of trusting rounded data yaw or inventing a fallback building. */
export function fireEscapeFacade(p: Prop, candidates: Iterable<Building>) {
  let best: { x: number; z: number; yaw: number; length: number; height: number } | null = null;
  let bestDistance = 1; // source positions are rounded to centimetres; reject stale/unrelated edges
  for (const building of candidates) {
    if (building.id !== p.ref || !Number.isFinite(building.height)) continue;
    const ring = building.footprint[0];
    if (!ring || ring.length < 3) continue;
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (!Number.isFinite(area) || Math.abs(area) < 1e-8) continue;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (!Number.isFinite(length) || length < FE_W + 0.2) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / (length * length)));
      const x = a[0] + dx * t, z = a[1] + dz * t;
      const distance = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (distance >= bestDistance) continue;
      const margin = (FE_W / 2 + 0.1) / length;
      const along = Math.max(margin, Math.min(1 - margin, t));
      const sign = area < 0 ? -1 : 1;
      bestDistance = distance;
      best = { x: a[0] + dx * along, z: a[1] + dz * along,
        yaw: Math.atan2(-sign * dz, sign * dx),
        length: 2 * Math.min(along, 1 - along) * length, height: building.height };
    }
  }
  return best;
}

export function createTileStore(tile: Tile): PropTile {
  return { key: tile.key, cx: (tile.tx + 0.5) * TILE_SIZE, cz: (tile.tz + 0.5) * TILE_SIZE,
    kinds: new Map(), signs: [], signals: [], lights: [], steam: [] };
}

export function* placeTileSteps(ctx: GameContext, tile: Tile, store: PropTile, atlas: SignAtlas,
  network: SignalNetwork, poles: Map<number, SignalPole>, nextId: () => number,
  solid?: (kind: string, x: number, y: number, z: number, yaw: number) => void): Generator<void> {
  const seen = new Set<string>();
  for (const p of tile.props) {
    yield;
    if (![p.x, p.z, p.yaw].every(Number.isFinite)) continue;
    const key = `${p.kind}:${p.x}:${p.z}:${p.yaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const seed = hash01(Math.round(p.x * 100), Math.round(p.z * 100));
    let yaw = p.yaw, originX = p.x, originZ = p.z;
    const ground = ctx.physics.groundHeight(p.x, p.z);
    const y = Number.isFinite(ground) ? ground : 0;
    const point = (x: number, z: number) => ({ x: originX + x * Math.cos(yaw) + z * Math.sin(yaw), z: originZ - x * Math.sin(yaw) + z * Math.cos(yaw) });
    const add = (kind: string, x = 0, h = 0, z = 0, rotation = yaw, data: Rect = [0, 0, 0, 0], scale = 1) => {
      let list = store.kinds.get(kind);
      if (!list) store.kinds.set(kind, list = new InstanceList());
      const pos = point(x, z);
      list.push(pos.x, y + h, pos.z, rotation, scale, ...data);
      solid?.(kind, pos.x, y + h, pos.z, rotation);
    };
    const light = (x: number, h: number, z: number, kind: LightSource['kind'], poolX: number, poolZ: number) => {
      store.lights.push({ ...point(x, z), y: y + h, groundY: y, kind, poolX, poolZ, yaw, seed });
    };
    const steam = (kind: SteamEmitter['kind'], h: number) => store.steam.push({ x: p.x, y: y + h, z: p.z, kind, seed: seed * 1e6 });
    switch (p.kind) {
      case 'street_lamp':
        add(seed < 0.5 ? 'lampLED' : 'lamp', 0, 0, 0, yaw, [seed < 0.5 ? 1 : 0, 0, 0, 0]);
        light(LAMP_HEAD_LOCAL.x, LAMP_HEAD_LOCAL.y, LAMP_HEAD_LOCAL.z, seed < 0.5 ? 1 : 0, 7, 9);
        if (seed < 0.3) add('regSign', 0, 2.2, 0.12, yaw, atlas.fixed(seed < 0.15 ? 'no-standing' : 'alt-side'));
        if (seed > 0.9) add('muni', 2, 0, 0, yaw, atlas.fixed('muni'));
        // Parking regulation posts stand between the lamps on every block face (west-village 1, 3):
        // a third of the lamps get one 6 m down the curb on its own post, facing the roadway like the lamp.
        if (seed >= 0.3 && seed < 0.62) {
          const road = roadNear(tile.roads, p);
          if (road) {
            const c = Math.cos(yaw), s = Math.sin(yaw), ox = road.dx * 6, oz = road.dz * 6;
            const lx = ox * c - oz * s, lz = ox * s + oz * c;
            add('signPost', lx, 0, lz, yaw, atlas.fixed('solid-white'));
            add('regSign', lx, 2.0, lz + 0.06, yaw, atlas.fixed(seed < 0.46 ? 'alt-side' : 'no-standing'));
          }
        }
        break;
      case 'traffic_signal': {
        const roads = ctx.world.roadsNear?.(p.x, p.z, 45) ?? tile.roads;
        const approach = signalApproach(p, roads);
        if (approach && !network.claimApproach(approach, tile.key)) break;
        // Coordinate duplicates without a resolved junction still need only one pole.
        if (network.poles.some(s => Math.hypot(s.x - p.x, s.z - p.z) < 0.5 && s.fx * -Math.sin(yaw) + s.fz * -Math.cos(yaw) > 0.95)) break;
        const pole = network.addPole(p.x, p.z, yaw, tile.key), id = nextId();
        poles.set(id, pole); store.signals.push(id);
        add('signal', 0, 0, 0, yaw, [0, 0, 0, id]);
        // pedestrian heads: bottom at ~2.1 m (7 ft), one per crosswalk, clear of the sign plates above
        add('pedHead', -0.2, 2.35, -0.15, yaw, [0, 0, 0, id]);
        add('pedHead', 0.15, 2.35, 0.2, yaw + Math.PI / 2, [1, 0, 0, id]);
        if (seed < 0.25) add('signalCabinet', -1, 0, 0.5);
        break;
      }
      case 'street_sign': {
        const names = (p.text ?? '').split('|').map(signName).filter(Boolean).slice(0, 2);
        // signs within 0.5 m of a signal clamp onto the signal pole itself (no separate post); the mount
        // point and the plate stand-off (pole radius + clamp) are expressed in this prop's local frame
        const signal = tile.props.find(s => s.kind === 'traffic_signal' && Math.hypot(s.x - p.x, s.z - p.z) < 0.5
          && signalApproach(s, ctx.world.roadsNear?.(s.x, s.z, 45) ?? tile.roads)?.incoming !== false);
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const mx = signal ? (signal.x - p.x) * c - (signal.z - p.z) * s : 0;
        const mz = signal ? (signal.x - p.x) * s + (signal.z - p.z) * c : 0;
        const standoff = signal ? 0.14 : 0.06;
        /** an offset (lx, lz) given in the `rotation` frame, converted to this prop's local frame */
        const along = (rotation: number, lx: number, lz: number) => {
          const dx = lx * Math.cos(rotation) + lz * Math.sin(rotation), dz = -lx * Math.sin(rotation) + lz * Math.cos(rotation);
          return { x: dx * c - dz * s, z: dx * s + dz * c };
        };
        if (!signal) add('signPost', 0, 0, 0, yaw, atlas.fixed('solid-white'));
        names.forEach((name, i) => {
          const road = roadNear(tile.roads, p, name);
          const rotation = road ? Math.atan2(-road.dz, road.dx) : yaw + i * Math.PI / 2;
          store.signs.push(`blade:${name}`);
          // blades stack at ~3.05 m (bottom 9.5 ft) and extend out from the pole along their street
          add('streetBlade', mx, 3.05 + i * 0.24, mz, rotation, atlas.streetBlade(name));
          if (road?.road.oneway) {
            // ONE WAY plate directly under the blades, on the pole face toward its street
            // Keep the full plate beside the pole: its rear face must not lose letters behind the shaft.
            const o = along(rotation, BLADE_X0 + BLADE_W / 2, standoff);
            add('oneWay', mx + o.x, 2.72, mz + o.z, rotation, atlas.fixed('one-way-right'));
          }
        });
        if (seed < 0.3) add('regSign', mx, 2.0, mz + standoff, yaw, atlas.fixed('no-standing'));
        const road = roadNear(tile.roads, p);
        if (road?.road.cls === 'residential' && !tile.props.some(s => s.kind === 'traffic_signal' && Math.hypot(s.x - p.x, s.z - p.z) < 35)) {
          add('stopSign', 1, 0, 0, Math.atan2(-road.dx, -road.dz), atlas.fixed('stop'));
        }
        // ART_DIRECTION §6: one litter basket per corner. Corners the data leaves without one get a wire
        // basket 1.4 m down the block from the sign post (away from the signal), half a metre in from the curb.
        if (road && !tile.props.some(o => o.kind === 'trash_can' && Math.hypot(o.x - p.x, o.z - p.z) < 16)) {
          const signalNear = tile.props.find(o => o.kind === 'traffic_signal' && Math.hypot(o.x - p.x, o.z - p.z) < 10);
          const dir = signalNear && (signalNear.x - p.x) * road.dx + (signalNear.z - p.z) * road.dz > 0 ? -1 : 1;
          const ix = p.x - road.x, iz = p.z - road.z, il = Math.hypot(ix, iz) || 1;
          const ox = road.dx * 1.4 * dir + (ix / il) * 0.5, oz = road.dz * 1.4 * dir + (iz / il) * 0.5;
          add('wireBasket', ox * c - oz * s, 0, ox * s + oz * c, Math.atan2(-ix, -iz));
        }
        // ART_DIRECTION §1 cue 5: a row of free-paper racks stands on most Midtown/avenue corners.
        // Three or four in a line 2.6 m down the block from the sign, backs to the curb.
        if (road && AVENUE_CLASSES.has(road.road.cls) && seed < 0.5) {
          const ix = p.x - road.x, iz = p.z - road.z, il = Math.hypot(ix, iz) || 1;
          const dir = seed < 0.25 ? 1 : -1;
          const count = 3 + (seed > 0.38 ? 1 : 0);
          for (let k = 0; k < count; k++) {
            const along = dir * (2.6 + k * 0.52);
            const ox = road.dx * along + (ix / il) * 0.55, oz = road.dz * along + (iz / il) * 0.55;
            const jitter = (hash01(k, Math.round(p.x * 100), Math.round(p.z * 100)) - 0.5) * 0.22;
            add('newsRack', ox * c - oz * s, 0, ox * s + oz * c, Math.atan2(-ix, -iz) + jitter);
          }
        }
        break;
      }
      case 'hydrant': add(seed < 0.18 ? 'hydrantRed' : 'hydrant'); break;
      case 'trash_can': add(seed < 0.2 ? 'steelBasket' : 'wireBasket'); break;
      case 'bench': add('bench'); break;
      case 'mailbox': add('mailbox'); break;
      case 'bike_rack': add(seed < 0.4 ? 'bikeLocked' : 'bikeRack'); break;
      // Initial placement can precede the sidewalk collider commit (groundHeight == 0).
      // The 3 cm foot must sit on the rendered 15 cm paving, not below it.
      // Own yaw and a 4 % height spread per bollard: the chipped face lands somewhere different on
      // each one, which is the only thing that breaks a curb run of identical cylinders.
      case 'bollard': add('bollard', 0, Math.max(0, 0.15 - y), 0, seed * Math.PI * 2, [0, 0, 0, 0], 0.97 + seed * 0.06); break;
      case 'planter': add('planter'); add('shrub'); break;
      case 'phone_booth': add('link', 0, 0, 0, yaw, atlas.fixed('linknyc-screen')); break;
      case 'newsstand': add('newsstand', 0, 0, 0, yaw, atlas.fixed('newsstand-front')); break;
      case 'food_cart': add('foodCart', 0, 0, 0, yaw, atlas.fixed('food-cart-menu')); break;
      case 'con_ed_stack': add('stack'); steam(2, 4.4); break;
      case 'manhole': if (seed < 0.12) steam(0, 0.08); break;
      case 'sewer_grate': if (seed < 0.06) steam(0, 0.08); break;
      case 'subway_grate': steam(1, 0.08); break;
      case 'bus_stop': {
        const near = roadNear(tile.roads, p);
        if (near) yaw = Math.atan2(p.x - near.x, p.z - near.z);
        const routes = (p.text ?? '').split(/[;,\s]+/).filter(Boolean).slice(0, 4);
        store.signs.push(`bus:${routes.join(' ')}`);
        add('busShelter', 0, 0, 0, yaw, atlas.fixed('bus-shelter-ad'));
        add('shelterGlass');
        add('busSign', -2.75, 0, -0.55, yaw, atlas.busSign(routes));
        break;
      }
      case 'citibike_dock': {
        const near = roadNear(tile.roads, p);
        yaw = near ? Math.atan2(p.x - near.x, p.z - near.z) : yaw + Math.PI / 2;
        const count = Math.max(10, Math.min(20, Math.round((p.len ?? 12) / 0.75)));
        for (let i = 0; i < count; i++) add(hash01(i, Math.round(seed * 1e6)) < 0.75 ? 'citiBike' : 'citiEmpty', (i - count / 2) * 0.75);
        add('citiKiosk', count * 0.375 + 1, 0, 0, yaw, atlas.fixed('citibike-panel'));
        break;
      }
      case 'subway_entrance': {
        const near = roadNear(tile.roads, p);
        if (near) yaw = Math.atan2(-near.dz, near.dx);
        const lines = p.text?.trim() && /^[A-Z0-9 ]+$/.test(p.text.trim()) && p.text.trim().length <= 12
          ? p.text.trim() : subwayLines(p.x, p.z, near?.road.name, seed);
        store.signs.push(`subway:${lines}`);
        add('subway', 0, 0, 0, yaw, atlas.subwaySign(lines));
        add('stairwell', 0, 0.025);
        for (const side of [-1, 1]) {
          add('globe', -SUB_L / 2, 0, side * (SUB_W / 2 + 0.12));
          light(-SUB_L / 2, 1.98, side * (SUB_W / 2 + 0.12), 3, 1.2, 1.2);
        }
        break;
      }
      case 'scaffolding':
      case 'fire_escape': {
        // Data yaw follows the facade tangent with local -z; these authored models run along +x.
        yaw += Math.PI / 2;
        const length = Number.isFinite(p.len) ? Math.max(2.4, Math.min(160, p.len!)) : 7.2;
        if (p.kind === 'scaffolding') {
          const count = Math.max(1, Math.round(length / BAY));
          for (let i = 0; i < count; i++) {
            const x = (i - count / 2) * BAY;
            // every bay picks one of the two plywood sheets (POST NO BILLS / permit), most are the stencil
            const sheet = hash01(i, Math.round(seed * 1e6)) < 0.7 ? 0 : 0.5;
            add('shed', x, 0, 0, yaw, [sheet, 0, 1, 1]);
            if (seed < 0.3) add('shedNet', x);
            light(x + BAY / 2, SHED_H - 0.35, -SHED_DEPTH / 2, 2, BAY * 0.7, 2);
          }
          add('shedEnd', -count * BAY / 2, 0, 0, yaw, [0.5, 0, 1, 1]);
          add('shedEnd', count * BAY / 2, 0, 0, yaw, [0, 0, 1, 1]);
          add('shedPost', count * BAY / 2);
        } else {
          const wall = fireEscapeFacade(p, tile.buildings) ?? fireEscapeFacade(p, ctx.world.buildingsNear(p.x, p.z, 5));
          if (!wall) break;
          originX = wall.x; originZ = wall.z; yaw = wall.yaw;
          const floors = Math.max(0, Math.min(20, Math.floor((wall.height - 1.2 - FE_BASE) / FLOOR_H) + 1));
          const columns = Math.max(1, Math.min(4, Math.floor(length / 6), Math.floor((wall.length - FE_W - 0.2) / 5) + 1));
          // Wall-side frame/struts end 15 mm inside the wall so no visible stand-off gap remains.
          for (let col = 0; col < columns; col++) {
            const x = (col - (columns - 1) / 2) * 5;
            for (let floor = 1; floor <= floors; floor++) add(floor === 1 ? 'escapeBase' : floor % 2 ? 'escapeStair' : 'escapeReverse', x, FE_BASE + (floor - 1) * FLOOR_H, 0.015);
            if (floors > 0) add('escapeLadder', x, FE_BASE, 0.015);
            // tenants' pots on a third of the upper landings (west-village 1: planted fire escapes)
            for (let floor = 2; floor <= floors; floor++) {
              if (hash01(col * 31 + floor, Math.round(seed * 1e6), 7) < 0.3) add('escapePlants', x, FE_BASE + (floor - 1) * FLOOR_H, 0.015);
            }
          }
        }
        break;
      }
    }
  }
  yield* placeTreeGuards(ctx, tile, store, solid);
  yield* placeTrashBagSteps(ctx, tile, store);
  yield* dressTileSteps(ctx, tile, store, solid);
}

/**
 * Iron guards on the tree pits. environment/trees.ts draws a pit (2.4 x 1.5 m along the curb) under
 * every street tree and its own guard on the half where hash2(x, z, 3) < 0.5; this places one on the
 * other half, off the same tree list, the same park test and the same pit yaw, so every street pit is
 * fenced and none is fenced twice. Zero litter and bare pits were the round-4 critic's note.
 */
function* placeTreeGuards(ctx: GameContext, tile: Tile, store: PropTile,
  solid?: (kind: string, x: number, y: number, z: number, yaw: number) => void): Generator<void> {
  let list = store.kinds.get('treeGuard');
  let n = 0;
  const parks = tile.parks ?? [];
  for (const tree of tile.trees ?? []) {
    if (![tree.x, tree.z].every(Number.isFinite)) continue;
    if (hash2(tree.x, tree.z, 3) < 0.5) continue;             // environment/trees.ts already guards this one
    if (parks.some(park => pointInPolygon(tree.x, tree.z, park))) continue; // park trees have no pit
    if ((n++ & 31) === 0) yield;
    const yaw = pitYawFor(tile, tree.x, tree.z);
    const ground = ctx.physics.groundHeight(tree.x, tree.z);
    const y = Math.max(WALK_Y, Number.isFinite(ground) ? ground : WALK_Y) + 0.004;
    if (!list) store.kinds.set('treeGuard', list = new InstanceList());
    list.push(tree.x, y, tree.z, yaw, 1, 0, 0, 0, 0);
    solid?.('treeGuard', tree.x, y, tree.z, yaw);
  }
}

/** environment/trees.ts pitYawFor: the pit (and so its guard) lines up with the nearest street. */
function pitYawFor(tile: Tile, x: number, z: number): number {
  let best = 12 * 12, yaw = 0;
  for (const road of tile.roads) {
    if (road.tunnel) continue;
    const pts = road.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const d = (a[0] + t * dx - x) ** 2 + (a[1] + t * dz - z) ** 2;
      if (d < best) { best = d; yaw = Math.atan2(-dz, dx); }
    }
  }
  return yaw;
}

/** Synchronous reference entry point for tests/tools; streaming uses placeTileSteps. */
export function placeTile(...args: Parameters<typeof placeTileSteps>): void {
  for (const _ of placeTileSteps(...args)) { /* consume the same placement rules */ }
}
