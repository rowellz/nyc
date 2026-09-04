import * as THREE from 'three';
import type { GameContext, GameModule } from '@/core/context';
import type { AtmosphereModule } from '@/atmosphere';
import type { Ring, Tile } from '@shared/world';
import { TILE_SIZE, tileIndex, tileKey } from '@shared/geo';
import { buildEmpireState } from './build/esb';
import { buildChrysler } from './build/chrysler';
import { buildFlatiron } from './build/flatiron';
import { buildOneWTC } from './build/wtc';
import { buildBridge } from './build/bridges';
import { buildLiberty, buildWashingtonArch } from './build/monuments';
import { buildNasdaq, buildOneTimesSquare, buildParamount, buildTkts } from './build/times-square';
import { buildNypl } from './build/nypl';
import { buildBryantPark, type ParkSeat } from './build/bryant-park';
import { build432Park, buildBankOfAmerica, buildCitigroup, buildHelmsley, buildMetLife, buildNYTimes, buildOneVanderbilt, buildUnSecretariat } from './build/midtown';
import { build10HudsonYards, build30HudsonYards, build35HudsonYards, build55HudsonYards } from './build/hudson-yards';
import { buildGrandCentral } from './build/grand-central';
import { buildViaduct } from './build/viaduct';
import { LandmarkColliders } from './colliders';
import { BOFA, BROOKLYN_BRIDGE, BRYANT_PARK, CHRYSLER, CITIGROUP, ESB, FLATIRON, FOUR32_PARK, GRAND_CENTRAL, HELMSLEY, HY10, HY30, HY35, HY55, LANDMARK_CULL_DISTANCE, LIBERTY, MANHATTAN_BRIDGE, METLIFE, NASDAQ, NYPL, NYT, ONE_TIMES_SQUARE, ONE_VANDERBILT, ONE_WTC, PARAMOUNT, TIMES_SQUARE_TILES, TKTS, UN, VIADUCT, WASHINGTON_ARCH, WILLIAMSBURG_BRIDGE } from './data';
import { Frame, centroid, disposeObject, type GeoBuilder, type LineBuilder } from './geom';
import { LANDMARK_BINS } from './list';
import { createFacadeMaterial, createLineMaterial, createScreenMaterial, createSharedUniforms } from './materials';
import { ATLAS_CELLS, LED_PITCH, ScreenBuilder, TICKER_CELL, composeBuildingScreens, createScreenAtlas } from './screens';
import { ScreenSpill } from './spill';

export { LANDMARK_BINS } from './list';
export type { ParkSeat } from './build/bryant-park';

/** World seat surface; yaw uses furniture's +Z forward, groundY supports stepped seating. */
export interface LandmarkSeat extends ParkSeat { groundY?: number }
export interface SeatSourceModule { readonly seatSources: ReadonlyMap<string, readonly LandmarkSeat[]> }

/** The landmarks contract is GameModule only; stats are diagnostic, not a dependency for other modules. */
export interface LandmarksModule extends GameModule, SeatSourceModule {
  readonly stats: { landmarks: number; tiles: number; pending: number; updateMs: number; maxUpdateMs: number; buildMs: number };
  /** BINs whose hand-built model is currently in the scene; the buildings module hides its extrusion for these only */
  readonly builtBins: ReadonlySet<number>;
  /**
   * Bryant Park's bistro chairs for the character module to seat people on: world seat-surface positions and the
   * facing yaw. Empty until the park is built (the camera within range) and again once it is released.
   */
  readonly bryantPark: { readonly seats: readonly ParkSeat[] };
  readonly nypl: { readonly seats: readonly LandmarkSeat[] };
}

interface Parts {
  body: GeoBuilder;
  center: [number, number];
  colliders: { ring: Ring; y0: number; y1: number }[];
  screens?: ScreenBuilder;
  lines?: LineBuilder;
  decks?: { ring: Ring; height: number }[];
  /** repeated small parts (park chairs, tables, benches): one InstancedMesh per entry, sharing the facade material */
  instances?: { body: GeoBuilder; matrices: THREE.Matrix4[]; name?: string; castShadow?: boolean }[];
  /** Published only while this landmark is in the scene. */
  seats?: LandmarkSeat[];
}
interface Landmark {
  id: string;
  center: [number, number];
  radius: number;
  bins: number[];
  build: () => Generator<void, Parts>;
  owners: Set<string>;
  root: THREE.Group | null;
  parts: Pick<Parts, 'colliders' | 'decks'> | null;
  job: Generator<void, Parts> | null;
  failed: boolean;
  colliding: boolean;
  deckKeys: string[];
}
interface TileRecord {
  tile: Tile;
  root: THREE.Group;
  job: Generator<void> | null;
  screenIds: number[];
}

export async function createLandmarks(ctx: GameContext): Promise<LandmarksModule> {
  const group = new THREE.Group();
  group.name = 'landmarks';
  ctx.worldGroup.add(group);
  const uniforms = createSharedUniforms();
  const atmosphere = () => ctx.modules.get('atmosphere') as Partial<AtmosphereModule> | undefined;
  // Keep the atmosphere's uniform OBJECTS, not snapshots of their values.
  const au = atmosphere()?.uniforms;
  uniforms.uNight = au?.uNight ?? uniforms.uNight;
  uniforms.uTime = au?.uTime ?? uniforms.uTime;
  uniforms.uWet = au?.uWetness ?? uniforms.uWet;
  const facade = createFacadeMaterial(uniforms);
  const lines = createLineMaterial(0x48535b);
  atmosphere()?.setupMaterial?.(facade);
  // Rasterize the shared atlas during module creation, before core starts its frame loop.
  // Building it on the first streamed screen otherwise puts canvas/font work in update().
  const atlas = createScreenAtlas(ctx.quality.level === 'mobile' ? 1024 : undefined);
  atlas.anisotropy = ctx.quality.level === 'low' ? 1 : 4;
  let screens: THREE.MeshStandardMaterial | null = null;
  function screenMaterial(): THREE.MeshStandardMaterial {
    if (!screens) {
      screens = createScreenMaterial(uniforms, atlas, ATLAS_CELLS, LED_PITCH, TICKER_CELL);
      atmosphere()?.setupMaterial?.(screens);
    }
    return screens;
  }
  // Point lights + ground glow in front of the biggest screens near the camera (created now so light counts are fixed).
  const spill = new ScreenSpill(ctx, uniforms);
  const colliders = new LandmarkColliders(ctx);
  const footprints = new Map<number, Ring>();
  const tiles = new Map<string, TileRecord>();
  // A building can occur in several tiles. Only one of them owns its screen geometry.
  const screenOwners = new Map<number, TileRecord>();
  const detailed = ctx.quality.level === 'high' || ctx.quality.level === 'ultra';
  const landmarks: Landmark[] = [];
  const builtBins = new Set<number>();
  const parkSeats: LandmarkSeat[] = [], librarySeats: LandmarkSeat[] = [];
  const seatSources = new Map<string, LandmarkSeat[]>([['bryant-park', parkSeats], ['nypl', librarySeats]]);
  let disposed = false;
  const stats: LandmarksModule['stats'] = { landmarks: 0, tiles: 0, pending: 0, updateMs: 0, maxUpdateMs: 0, buildMs: 0 };
  const once = (fn: () => Parts) => function* (): Generator<void, Parts> {
    const parts = fn();
    yield; // Separate procedural construction from typed-array conversion / mesh commit.
    return parts;
  };
  function define(id: string, center: [number, number], bins: number[], build: () => Generator<void, Parts>, radius = 80): void {
    landmarks.push({ id, center, bins, build, radius, owners: new Set(), root: null, parts: null, job: null, failed: false, colliding: false, deckKeys: [] });
  }
  const ef = Frame.fromBearing(ESB.cornerNE.x, ESB.cornerNE.z, ESB.bearingU);
  define('empire-state', ef.toWorld(ESB.lotU / 2, 55), [ESB.bin], once(() => buildEmpireState(footprints.get(ESB.bin))));
  define('chrysler', centroid(CHRYSLER.footprint), [CHRYSLER.bin], once(() => buildChrysler(footprints.get(CHRYSLER.bin))));
  define('flatiron', centroid(FLATIRON.footprint), [FLATIRON.bin], once(() => buildFlatiron(footprints.get(FLATIRON.bin))));
  define('one-wtc', [ONE_WTC.cx, ONE_WTC.cz], ONE_WTC.bins, once(buildOneWTC));
  define('one-times-square', centroid(ONE_TIMES_SQUARE.footprint), [ONE_TIMES_SQUARE.bin], once(() => buildOneTimesSquare(footprints.get(ONE_TIMES_SQUARE.bin))));
  define('nasdaq', [NASDAQ.cx, NASDAQ.cz], [], once(buildNasdaq));
  define('paramount', [PARAMOUNT.ox, PARAMOUNT.oz], [PARAMOUNT.bin], once(() => buildParamount(footprints.get(PARAMOUNT.bin))));
  define('tkts', centroid(TKTS.footprint), TKTS.bins, once(() => buildTkts(footprints.get(TKTS.bins[0]))));
  define('nypl', [NYPL.ox, NYPL.oz], [NYPL.bin], once(() => buildNypl(footprints.get(NYPL.bin))));
  define('bryant-park', BRYANT_PARK.center, BRYANT_PARK.bins, once(buildBryantPark));
  // Grand Central's 42nd St front and the Park Avenue Viaduct wrapping it (the streets module owns the decks)
  define('grand-central', centroid(GRAND_CENTRAL.footprint), [GRAND_CENTRAL.bin], once(() => buildGrandCentral(footprints.get(GRAND_CENTRAL.bin))));
  define('park-ave-viaduct', VIADUCT.center, [], once(buildViaduct), 220);
  // Midtown skyline towers (real footprints in data.ts; the tiles' own footprint wins once its tile streams in)
  define('one-vanderbilt', centroid(ONE_VANDERBILT.footprint), [ONE_VANDERBILT.bin], once(() => buildOneVanderbilt(footprints.get(ONE_VANDERBILT.bin))));
  define('432-park', centroid(FOUR32_PARK.footprint), FOUR32_PARK.bins, once(() => build432Park(footprints.get(FOUR32_PARK.bins[0]))));
  define('citigroup-center', centroid(CITIGROUP.footprint), [CITIGROUP.bin], once(() => buildCitigroup(footprints.get(CITIGROUP.bin))));
  define('bank-of-america', centroid(BOFA.footprint), [BOFA.bin], once(() => buildBankOfAmerica(footprints.get(BOFA.bin))));
  define('new-york-times', centroid(NYT.footprint), [NYT.bin], once(() => buildNYTimes(footprints.get(NYT.bin))));
  define('metlife', centroid(METLIFE.footprint), [METLIFE.bin], once(() => buildMetLife(footprints.get(METLIFE.bin))));
  define('helmsley', centroid(HELMSLEY.footprint), [HELMSLEY.bin], once(() => buildHelmsley(footprints.get(HELMSLEY.bin))));
  define('un-secretariat', centroid(UN.footprint), [UN.bin], once(() => buildUnSecretariat(footprints.get(UN.bin))));
  define('30-hudson-yards', centroid(HY30.footprint), [HY30.bin], once(() => build30HudsonYards(footprints.get(HY30.bin))));
  define('35-hudson-yards', centroid(HY35.footprint), [HY35.bin], once(() => build35HudsonYards(footprints.get(HY35.bin))));
  define('10-hudson-yards', centroid(HY10.footprint), [HY10.bin], once(() => build10HudsonYards(footprints.get(HY10.bin))));
  define('55-hudson-yards', centroid(HY55.footprint), [HY55.bin], once(() => build55HudsonYards(footprints.get(HY55.bin))));
  define('brooklyn-bridge', [BROOKLYN_BRIDGE.cx, BROOKLYN_BRIDGE.cz], [], () => buildBridge('brooklyn', detailed), 750);
  define('manhattan-bridge', [MANHATTAN_BRIDGE.cx, MANHATTAN_BRIDGE.cz], [], () => buildBridge('manhattan', detailed), 650);
  define('williamsburg-bridge', [WILLIAMSBURG_BRIDGE.cx, WILLIAMSBURG_BRIDGE.cz], [], () => buildBridge('williamsburg', detailed), 650);
  define('washington-arch', [WASHINGTON_ARCH.cx, WASHINGTON_ARCH.cz], [], once(buildWashingtonArch));
  define('liberty', [LIBERTY.cx, LIBERTY.cz], [], once(buildLiberty));

  function removeCollision(l: Landmark): void {
    colliders.remove(`landmark:${l.id}`);
    for (const key of l.deckKeys) {
      try { ctx.physics?.unregisterDeck?.(key); } catch { /* Physics may already have been disposed. */ }
    }
    l.deckKeys.length = 0;
    l.colliding = false;
  }
  function removeLandmark(l: Landmark): void {
    removeCollision(l);
    spill.remove(`landmark:${l.id}`);
    if (l.root) {
      l.root.removeFromParent();
      disposeObject(l.root);
    }
    l.root = null;
    l.parts = null;
    l.job = null;
    for (const bin of l.bins) builtBins.delete(bin);
    const seats = seatSources.get(l.id);
    if (seats) seats.length = 0;
  }
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Group, shadow: boolean): void {
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = shadow && ctx.quality.shadows;
    m.receiveShadow = ctx.quality.shadows;
    parent.add(m);
  }
  function commit(l: Landmark, parts: Parts): void {
    const root = new THREE.Group();
    root.name = l.id;
    // Assign before allocating GPU resources, so a failed build is cleaned up too.
    l.root = root;
    l.parts = parts;
    if (parts.body.vertexCount) mesh(parts.body.build(), facade, root, true);
    if (parts.screens?.count) {
      const material = screenMaterial();
      mesh(parts.screens.build(), material, root, false);
      spill.add(`landmark:${l.id}`, parts.screens.sources);
    }
    if (parts.lines?.count) root.add(new THREE.LineSegments(parts.lines.build(), lines));
    for (const inst of parts.instances ?? []) {
      if (!inst.matrices.length || !inst.body.vertexCount) continue;
      const im = new THREE.InstancedMesh(inst.body.build(), facade, inst.matrices.length);
      im.name = `${l.id}-${inst.name ?? 'instances'}`;
      inst.matrices.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false; // instances spread over the whole park; the root's distance test culls them
      im.castShadow = ctx.quality.shadows && (inst.castShadow ?? true);
      im.receiveShadow = ctx.quality.shadows;
      root.add(im);
    }
    group.add(root);
    for (const bin of l.bins) builtBins.add(bin);
    if (parts.seats) {
      let seats = seatSources.get(l.id);
      if (!seats) { seats = []; seatSources.set(l.id, seats); }
      seats.length = 0;
      seats.push(...parts.seats);
    }
    // CPU geometry arrays are only needed during construction. Retain just collision/deck descriptions.
    l.parts = { colliders: parts.colliders, decks: parts.decks };
  }
  function addCollision(l: Landmark): void {
    if (!l.parts || l.colliding || ctx.physics?.ready === false) return;
    try {
      colliders.addPrisms(`landmark:${l.id}`, l.parts.colliders);
      for (const [i, deck] of (l.parts.decks ?? []).entries()) {
        const key = ctx.physics?.registerDeck?.([deck.ring], deck.height, `landmark:${l.id}:deck:${i}`);
        if (key) l.deckKeys.push(key);
      }
    } catch (err) {
      removeCollision(l);
      console.warn(`[landmarks] could not register ${l.id} collision`, err);
    }
    l.colliding = true;
  }
  function owns(tile: Tile, l: Landmark): boolean {
    if (tile.buildings.some(b => l.bins.includes(b.id))) return true;
    // Coordinate-only landmarks and missing BINs still activate when their ground tiles arrive.
    if (l.radius <= 80) return tile.key === tileKey(tileIndex(l.center[0]), tileIndex(l.center[1]));
    const x = Math.max(tile.tx * TILE_SIZE, Math.min((tile.tx + 1) * TILE_SIZE, l.center[0]));
    const z = Math.max(tile.tz * TILE_SIZE, Math.min((tile.tz + 1) * TILE_SIZE, l.center[1]));
    return (x - l.center[0]) ** 2 + (z - l.center[1]) ** 2 < l.radius ** 2;
  }
  function* buildTile(rec: TileRecord): Generator<void> {
    spill.remove(`tile:${rec.tile.key}`);
    const out = new ScreenBuilder();
    for (const b of rec.tile.buildings) {
      if (!screenOwners.has(b.id) && !LANDMARK_BINS.has(b.id)) {
        const before = out.count;
        composeBuildingScreens(b, out, LANDMARK_BINS);
        if (out.count > before) {
          screenOwners.set(b.id, rec);
          rec.screenIds.push(b.id);
        }
      }
      yield;
    }
    if (out.count) {
      const material = screenMaterial();
      mesh(out.build(), material, rec.root, false);
      spill.add(`tile:${rec.tile.key}`, out.sources);
    }
  }
  function onTileUnloaded(key: string): void {
    const rec = tiles.get(key);
    if (!rec) return;
    tiles.delete(key);
    spill.remove(`tile:${key}`);
    rec.job = null;
    rec.root.removeFromParent();
    disposeObject(rec.root);
    for (const id of rec.screenIds) screenOwners.delete(id);
    // A neighbouring loaded tile may contain the same complete footprint. Rebuild its merged screens.
    for (const other of tiles.values()) {
      if (!TIMES_SQUARE_TILES.has(other.tile.key) || !other.tile.buildings.some(b => rec.screenIds.includes(b.id))) continue;
      for (const id of other.screenIds) screenOwners.delete(id);
      other.screenIds.length = 0;
      disposeObject(other.root);
      other.root.clear();
      other.job = buildTile(other);
    }
    for (const l of landmarks) {
      if (l.owners.delete(key) && !l.owners.size) removeCollision(l);
    }
    stats.tiles = tiles.size;
  }
  function onTileLoaded(tile: Tile): void {
    if (disposed) return;
    onTileUnloaded(tile.key);
    const root = new THREE.Group();
    root.name = `landmark-tile:${tile.key}`;
    group.add(root);
    const rec: TileRecord = { tile, root, job: null, screenIds: [] };
    tiles.set(tile.key, rec);
    for (const b of tile.buildings) if (LANDMARK_BINS.has(b.id) && !footprints.has(b.id) && b.footprint[0]?.length >= 3) {
      footprints.set(b.id, b.footprint[0]);
      // Replace the coordinate fallback with the actual footprint once it becomes available.
      for (const l of landmarks) if (l.bins.includes(b.id)) removeLandmark(l);
    }
    for (const l of landmarks) if (owns(tile, l)) l.owners.add(tile.key);
    if (TIMES_SQUARE_TILES.has(tile.key)) rec.job = buildTile(rec);
    stats.tiles = tiles.size;
  }
  const off = [ctx.events.on('tileLoaded', onTileLoaded), ctx.events.on('tileUnloaded', onTileUnloaded)];
  for (const tile of ctx.world.tiles.values()) onTileLoaded(tile);

  function distanceSq(l: Landmark): number {
    return (ctx.camera.position.x - l.center[0]) ** 2 + (ctx.camera.position.z - l.center[1]) ** 2;
  }
  // Skyline replacements have their own range; quality controls the ordinary tile LODs.
  const farDistance = LANDMARK_CULL_DISTANCE;
  const farSq = farDistance ** 2;
  const releaseSq = (farDistance + TILE_SIZE) ** 2;
  const mod: LandmarksModule = {
    name: 'landmarks',
    stats,
    builtBins,
    bryantPark: { seats: parkSeats },
    nypl: { seats: librarySeats },
    seatSources,
    update(dt, t) {
      if (disposed) return;
      const start = performance.now();
      if (!au?.uNight) uniforms.uNight.value = 1 - ctx.time.daylight;
      if (!au?.uTime) uniforms.uTime.value = t;
      if (!au?.uWetness) uniforms.uWet.value = ctx.state.weather.wetness ?? 0;
      spill.update(dt, ctx.state.screenshotMode === true);
      let worked = false;
      stats.landmarks = stats.pending = 0;
      for (const l of landmarks) {
        const d = distanceSq(l);
        if (d > releaseSq && !l.owners.size) removeLandmark(l);
        if (d <= farSq && !l.root && !l.failed) {
          stats.pending++;
          if (!worked) {
            worked = true;
            try {
              l.job ??= l.build();
              const result = l.job.next();
              if (result.done) { commit(l, result.value); l.job = null; }
            } catch (err) {
              removeLandmark(l);
              l.failed = true;
              console.warn(`[landmarks] could not build ${l.id}`, err);
            }
          }
        }
        if (l.root) {
          stats.landmarks++;
          const outsideTiles = ctx.world.hasTile?.(tileIndex(l.center[0]), tileIndex(l.center[1])) === false;
          const needsCollision = l.owners.size > 0 || (outsideTiles && d < (ctx.quality.drawDistance + l.radius) ** 2);
          if (needsCollision && !l.colliding && !worked) { addCollision(l); worked = true; }
          else if (!needsCollision && l.colliding) removeCollision(l);
        }
      }
      // Spend at most 2 ms on tile composition; each yield is just one building facade.
      if (!worked) for (const rec of tiles.values()) {
        if (!rec.job) continue;
        do {
          try { if (rec.job.next().done) rec.job = null; }
          catch (err) { rec.job = null; console.warn('[landmarks] screen build failed', rec.tile.key, err); }
        } while (rec.job && performance.now() - start < 2);
        if (performance.now() - start >= 2) break;
      }
      for (const rec of tiles.values()) if (rec.job) stats.pending++;
      stats.updateMs = performance.now() - start;
      stats.maxUpdateMs = Math.max(stats.maxUpdateMs, stats.updateMs);
      if (worked) stats.buildMs += stats.updateMs;
    },
    preRender() {
      if (disposed) return;
      for (const l of landmarks) if (l.root) l.root.visible = distanceSq(l) <= farSq;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      off.forEach(fn => fn());
      // Avoid transferring screen ownership during whole-module teardown.
      for (const rec of tiles.values()) { rec.job = null; disposeObject(rec.root); }
      tiles.clear();
      screenOwners.clear();
      footprints.clear();
      for (const l of landmarks) removeLandmark(l);
      builtBins.clear();
      spill.dispose();
      colliders.dispose();
      facade.dispose();
      lines.dispose();
      screens?.dispose();
      atlas?.dispose();
      group.clear();
      group.removeFromParent();
      stats.landmarks = stats.tiles = stats.pending = 0;
    },
  };
  return mod;
}
