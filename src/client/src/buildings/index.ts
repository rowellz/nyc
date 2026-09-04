/**
 * Buildings module: every real footprint extruded at its real height and dressed by style (see builder.ts for
 * the geometry, shader.ts for the facades). Near tiles are built in a worker pool and committed under the shared frame budget;
 * a far layer (far.ts) keeps the whole skyline resident. Colliders: worker-bounded Rapier trimesh pieces.
 */
import * as THREE from 'three';
import { isIOS } from '@/core/quality';
import { buildScope, type BuildJob, type BuildSteps } from './loading';
import type { Building, Tile } from '@shared/world';
import { TILE_SIZE, tileKey } from '@shared/geo';
import type { GameContext, GameModule } from '@/core/context';
import { LANDMARK_BINS } from '@/landmarks/list';
import { shopSplit, type BuildInput, type BuiltTile } from './builder';
import { hash4 } from './hash';
import type { BuildRequest, BuildResponse } from './builder.worker';
import { createFacadeMaterial, createFacadeUniforms, type AtmosphereLike } from './material';
import { createSignAtlas } from './signs';
import { createFarLayer, type FarLayer } from './far';
import { pointInPolygon } from './polygon';
import { loadFacadeTextures } from './textures';
import { applyLandmarkVisibility, reportedLandmarks } from './landmarks';
import { updateLitRamp, KIND_WALL, FLAG_STREET, FLAG_COMMERCIAL, FLAG_SETBACK_TIER, FLAG_RESIDENTIAL_DOOR, FLAG_WALL_SHIFT } from './styles';

export interface Storefront {
  readonly x: number; readonly z: number; readonly nx: number; readonly nz: number;
  readonly width: number; readonly lit: number; readonly color: readonly [number, number, number];
}

export interface BuildingsModule extends GameModule {
  /** true if the point (x,z) is inside a loaded building footprint (for spawn/pickup checks, ped avoidance) */
  isInside(x: number, z: number): boolean;
  /** building under/near a point */
  buildingAt(x: number, z: number): Building | null;
  /** Cached, read-only shop segments; undefined until the tile's facade is committed. */
  storefronts(key: string): readonly Storefront[] | undefined;
  /** debug/perf info */
  stats: { tiles: number; verts: number; tris: number; buildMs: number; lastBuildMs: number; commitMs: number; far: FarLayer['stats'] };
}

interface TileRec {
  key: string;
  tile: Tile;
  mesh: THREE.Mesh | null;
  built: BuiltTile | null;
  /** coarse 16x16 grid over the tile: building indices whose bbox touches the cell */
  grid: Int32Array[] | null;
  colliderDone: boolean;
  job?: BuildJob;
  pendingId: number; // worker request id (0 = none)
  storefronts?: readonly Storefront[];
}

const WORKERS = 2;
const GRID = 16;

export async function createBuildings(ctx: GameContext): Promise<BuildingsModule> {
  const group = new THREE.Group();
  group.name = 'buildings';
  ctx.worldGroup.add(group);

  const builds = buildScope(ctx);
  let disposed = false;
  const facadeTextures = new Set<THREE.Texture>();
  const signAtlas = createSignAtlas();
  const signJob = builds.job('building signs');
  signJob.run((function* (): BuildSteps { yield signAtlas; })());
  const uniforms = createFacadeUniforms(ctx, signAtlas);
  let material = createFacadeMaterial(uniforms, { textures: false });
  const atm = ctx.modules.get('atmosphere') as AtmosphereLike | undefined;
  atm?.setupMaterial?.(material);

  const tiles = new Map<string, TileRec>();
  const builtLandmarks = new Set<number>();
  const stats: BuildingsModule['stats'] = { tiles: 0, verts: 0, tris: 0, buildMs: 0, lastBuildMs: 0, commitMs: 0, far: { chunks: 0, fetched: 0, total: 0, done: false, buildings: 0 } };
  const far = ctx.quality.farDistance > ctx.quality.drawDistance ? createFarLayer(ctx, uniforms, builtLandmarks) : null;
  if (far) stats.far = far.stats;

  // ---- worker pool ------------------------------------------------------------------------------------------
  const workers: { w: Worker; busy: boolean; id: number }[] = [];
  const queue: TileRec[] = [];

  let reqSeq = 0;
  const reqOwner = new Map<number, TileRec>();
  if (typeof Worker !== 'undefined') {
    for (let i = 0; i < WORKERS; i++) {
      try {
        const w = new Worker(new URL('./builder.worker.ts', import.meta.url), { type: 'module', name: `buildings-${i}` });
        const slot = { w, busy: false, id: 0 };
        w.onmessage = (e: MessageEvent<BuildResponse>) => {
          slot.busy = false;
          const rec = reqOwner.get(e.data.id);
          reqOwner.delete(e.data.id);
          if (e.data.error) console.warn(`[buildings] build failed for ${e.data.key}: ${e.data.error}`);
          if (rec && tiles.get(rec.key) === rec && rec.pendingId === e.data.id) {
            rec.pendingId = 0;
            if (e.data.tile) rec.job?.run(commit(rec, e.data.tile));
            else rec.job?.cancel();
          }
          pump();
        };
        const fail = () => {
          w.terminate();
          const rec = reqOwner.get(slot.id);
          rec?.job?.cancel(); reqOwner.delete(slot.id);
          workers.splice(workers.indexOf(slot), 1);
          if (!workers.length) { for (const queued of queue) queued.job?.cancel(); queue.length = 0; }
          else pump();
          console.warn('[buildings] worker failed; pending job cancelled');
        };
        w.onerror = e => { e.preventDefault(); fail(); };
        w.onmessageerror = fail;
        workers.push(slot);
      } catch (err) {
        console.warn('[buildings] worker unavailable', err);
        break;
      }
    }
  }

  function neighbourBuildings(tile: Tile): Building[] {
    const out: Building[] = [];
    const minX = tile.tx * TILE_SIZE - 3, maxX = (tile.tx + 1) * TILE_SIZE + 3, minZ = tile.tz * TILE_SIZE - 3, maxZ = (tile.tz + 1) * TILE_SIZE + 3;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const t = ctx.world.tiles.get(tileKey(tile.tx + dx, tile.tz + dz));
        if (!t) continue;
        for (const b of t.buildings) {
          const r = b.footprint[0];
          if (!r) continue;
          let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
          for (const [x, z] of r) {
            if (x < bx0) bx0 = x;
            if (x > bx1) bx1 = x;
            if (z < bz0) bz0 = z;
            if (z > bz1) bz1 = z;
          }
          if (bx1 < minX || bx0 > maxX || bz1 < minZ || bz0 > maxZ) continue;
          out.push(b);
        }
      }
    return out;
  }

  function makeInput(rec: TileRec): BuildInput {
    const t = rec.tile;
    return { key: t.key, tx: t.tx, tz: t.tz, buildings: t.buildings, roads: t.roads, landmarkBins: Array.from(LANDMARK_BINS), neighbours: neighbourBuildings(t), quality: ctx.quality.level === 'mobile' ? 'low' : ctx.quality.level };
  }

  function pump(): void {
    while (queue.length) {
      const slot = workers.find((s) => !s.busy);
      if (!slot) return;
      const rec = queue.shift()!;
      if (tiles.get(rec.key) !== rec || !rec.job?.pending) continue;
      const id = ++reqSeq;
      rec.pendingId = id;
      reqOwner.set(id, rec);
      slot.busy = true; slot.id = id;
      try { slot.w.postMessage({ id, input: makeInput(rec) } satisfies BuildRequest); }
      catch (error) { slot.busy = false; reqOwner.delete(id); rec.job?.cancel(); console.warn('[buildings] dispatch failed', error); }
    }
  }

  function onTileLoaded(tile: Tile): void {
    if (tiles.has(tile.key)) onTileUnloaded(tile.key);
    const rec: TileRec = { key: tile.key, tile, mesh: null, built: null, grid: null, colliderDone: false, pendingId: 0 };
    tiles.set(tile.key, rec);
    if (!tile.buildings.length || disposed) return;
    rec.job = builds.job(`buildings:${tile.key}`);
    if (workers.length) {
      queue.push(rec);
      pump();
    } else {
      rec.job.cancel();
      console.warn('[buildings] tile skipped: no geometry worker', tile.key);
    }
  }

  function onTileUnloaded(key: string): void {
    const rec = tiles.get(key);
    if (!rec) return;
    tiles.delete(key);
    reqOwner.delete(rec.pendingId);
    rec.pendingId = 0;
    rec.job?.cancel();
    const qi = queue.indexOf(rec);
    if (qi >= 0) queue.splice(qi, 1);

    if (rec.mesh) {
      group.remove(rec.mesh);
      rec.mesh.geometry.dispose();
      stats.verts -= rec.mesh.geometry.getAttribute('position')?.count ?? 0;
      stats.tris -= rec.mesh.geometry.drawRange.count / 3;
      rec.mesh = null;
    }
    ctx.physics.removeTileColliders(`bld:${key}`);
    rec.built = null;
    rec.grid = null;
    stats.tiles = tiles.size;
  }

  function* commit(rec: TileRec, b: BuiltTile): BuildSteps {
    if (tiles.get(b.key) !== rec) return;
    const t0 = performance.now();
    const g = new THREE.BufferGeometry();
    try {
      g.setAttribute('position', new THREE.BufferAttribute(b.position, 3)); yield;
      g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3)); yield;
      g.setAttribute('uv', new THREE.BufferAttribute(b.uv, 2)); yield;
      g.setAttribute('color', new THREE.BufferAttribute(b.color, 3)); yield;
      g.setAttribute('aInfo', new THREE.BufferAttribute(b.info, 4)); yield;
      g.setAttribute('aWall', new THREE.BufferAttribute(b.wall, 4)); yield;
      g.setIndex(new THREE.BufferAttribute(b.renderIndex, 1));
      applyLandmarkVisibility(g, b.index, b.landmarkRanges, builtLandmarks);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(b.bounds.cx, b.bounds.cy, b.bounds.cz), b.bounds.r);
      g.boundingBox = null;
      const mesh = new THREE.Mesh(g, material);
      mesh.position.set(b.ox, 0, b.oz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.name = `bld-${b.key}`;
      // The iOS stagger can replace the facade material while the driver's async
      // compiler still polls it. Compile at first draw there, after publication.
      if (!isIOS()) yield ctx.renderer.compileAsync(mesh, ctx.camera, ctx.scene);
      // Landmarks can complete while compileAsync yields. syncLandmarks cannot
      // visit this mesh until it is committed, and will not repeat an unchanged set.
      applyLandmarkVisibility(g, b.index, b.landmarkRanges, reportedLandmarks(ctx) ?? builtLandmarks);
      group.add(mesh);
      rec.mesh = mesh;
      rec.built = b;
      rec.grid = b.grid;
      stats.verts += b.position.length / 3;
      stats.tris += g.drawRange.count / 3;
      stats.buildMs += b.stats.ms;
      stats.lastBuildMs = b.stats.ms;
      stats.tiles = tiles.size;
      stats.commitMs = performance.now() - t0;
      if (ctx.state.debug) console.info(`[buildings] ${b.key}: ${b.stats.buildings} buildings, ${(b.position.length / 3) | 0} verts, build ${b.stats.ms.toFixed(1)} ms, commit ${stats.commitMs.toFixed(2)} ms`);
      yield;
      yield* makeColliders(rec);
    } finally { if (rec.mesh?.geometry !== g) g.dispose(); }
  }

  function* makeColliders(rec: TileRec): BuildSteps {
    const b = rec.built;
    if (!b) return;
    ctx.physics.removeTileColliders(`bld:${rec.key}`);
    for (const chunk of b.colliders) {
      if (chunk.bin !== undefined && builtLandmarks.has(chunk.bin)) continue;
      while (ctx.physics.ready === false) yield;
      const R = ctx.physics.RAPIER;
      const desc = R.ColliderDesc.trimesh(chunk.position, chunk.index).setTranslation(b.ox, 0, b.oz).setFriction(0.6);
      const col = ctx.physics.world.createCollider(desc);
      ctx.physics.addTileColliders(`bld:${rec.key}`, [col], 'building');
      yield;
    }
    rec.colliderDone = true;
  }

  function syncLandmarks(): void {
    const reported = reportedLandmarks(ctx);
    let changed = false;
    for (const bin of LANDMARK_BINS) {
      const built = reported?.has(bin) ?? false;
      if (built === builtLandmarks.has(bin)) continue;
      changed = true;
      if (built) builtLandmarks.add(bin); else builtLandmarks.delete(bin);
    }
    if (!changed) return;
    for (const rec of tiles.values()) {
      const b = rec.built;
      if (!b?.landmarkRanges.length || !rec.mesh) continue;
      const g = rec.mesh.geometry;
      stats.tris -= g.drawRange.count / 3;
      applyLandmarkVisibility(g, b.index, b.landmarkRanges, builtLandmarks);
      rec.storefronts = undefined;
      stats.tris += g.drawRange.count / 3;
      ctx.physics.removeTileColliders(`bld:${rec.key}`);
      rec.colliderDone = false;
      rec.job?.cancel();
      rec.job = builds.job(`building landmark colliders:${rec.key}`);
      rec.job.run(makeColliders(rec));
    }
    far?.syncLandmarks();
  }

  // ---- queries --------------------------------------------------------------------------------------------
  function storefronts(key: string): readonly Storefront[] | undefined {
    const rec = tiles.get(key), b = rec?.built, g = rec?.mesh?.geometry;
    if (!rec || !b || !g) return undefined;
    if (rec.storefronts) return rec.storefronts;
    const shops: Storefront[] = [], seen = new Set<number>();
    // Coupled to Baker.wallQuad and shader.ts storefront/shopLitState/shopGateDown/shopLampColor.
    // Read only rendered base-wall origins, so party walls, setbacks and replaced landmarks cannot glow.
    for (let j = 0; j < g.drawRange.count; j += 3) {
      const i = g.index!.getX(j), o = i * 4;
      if (b.wall[o + 3] !== KIND_WALL || b.uv[i * 2] !== 0 || b.uv[i * 2 + 1] !== 0 || seen.has(i)) continue;
      seen.add(i);
      const flags = b.wall[o + 1], len = b.wall[o], gfH = b.wall[o + 2];
      const style = Math.floor(b.info[o + 2] / 65536), seed = b.info[o + 2] % 65536;
      if (!(flags & FLAG_STREET) || !(flags & FLAG_COMMERCIAL) || (flags & FLAG_SETBACK_TIER) || b.info[o + 3] > 0.05 ||
        style === 9 || style === 10 || gfH < 3.5 || (style === 5 && (flags & FLAG_RESIDENTIAL_DOOR) && gfH >= 4.5 && len > 8)) continue;
      const wall = Math.floor(flags / FLAG_WALL_SHIFT), { n, w } = shopSplit(len, seed, wall);
      const nx = b.normal[i * 3], nz = b.normal[i * 3 + 2];
      for (let sid = 0; sid < n; sid++) {
        const u = (sid + 0.5) * w, on = hash4(seed, 28, wall, sid), gate = hash4(seed, 22, wall, sid), lamp = hash4(seed, 41, wall, sid);
        shops.push({ x: b.ox + b.position[i * 3] - nz * u, z: b.oz + b.position[i * 3 + 2] + nx * u, nx, nz, width: w,
          color: lamp < 0.42 ? [1, 0.76, 0.50] : lamp < 0.78 ? [1, 0.88, 0.70] : [0.80, 0.90, 1],
          get lit() {
            const night = uniforms.uNight.value, t = THREE.MathUtils.smoothstep(night, 0.1, 0.5);
            if (gate <= 0.06 + 0.34 * THREE.MathUtils.smoothstep(night, 0.2, 0.8)) return 0;
            return (on <= 0.85 ? 0.35 : 0) * (1 - t) + (on <= 0.82 ? 1 : 0) * t;
          } });
      }
    }
    return rec.storefronts = shops;
  }

  function lookup(x: number, z: number): Building | null {
    const tx = Math.floor(x / TILE_SIZE), tz = Math.floor(z / TILE_SIZE);
    const rec = tiles.get(tileKey(tx, tz));
    if (!rec?.grid || !rec.built) return null;
    const cx = Math.min(GRID - 1, Math.max(0, Math.floor((x - tx * TILE_SIZE) / (TILE_SIZE / GRID))));
    const cz = Math.min(GRID - 1, Math.max(0, Math.floor((z - tz * TILE_SIZE) / (TILE_SIZE / GRID))));
    const cell = rec.grid[cz * GRID + cx];
    for (let i = 0; i < cell.length; i++) {
      const b = rec.tile.buildings[cell[i]];
      if (b && pointInPolygon(x, z, b.footprint)) return b;
    }
    return null;
  }

  // ---- textures (CC0 PBR overlays appear progressively; poll the manifest) -----------------------------------
  let texturesEnabled = false;
  let texPoll = 0;
  let texTries = 0;
  async function tryTextures(): Promise<void> {
    texTries++;
    const job = builds.job('facade textures');
    let found = false;
    try {
      found = await loadFacadeTextures(ctx.renderer, uniforms, texture => {
        if (disposed) { texture.dispose(); return Promise.resolve(); }
        facadeTextures.add(texture);
        const upload = builds.job('facade upload');
        upload.run((function* (): BuildSteps { yield texture; })());
        return upload.done;
      });
    } finally { job.cancel(); }
    if (disposed) return;
    if (found && !texturesEnabled) {
      texturesEnabled = true;
      const old = material;
      material = createFacadeMaterial(uniforms, { textures: true });
      atm?.setupMaterial?.(material);
      for (const rec of tiles.values()) if (rec.mesh) rec.mesh.material = material;
      old.dispose();
      console.info('[buildings] facade textures enabled');
    }
  }

  // ---- events ---------------------------------------------------------------------------------------------
  for (const t of ctx.world.tiles.values()) onTileLoaded(t);
  const offLoad = ctx.events.on('tileLoaded', onTileLoaded);
  const offUnload = ctx.events.on('tileUnloaded', onTileUnloaded);
  void tryTextures();

  const mod: BuildingsModule = {
    name: 'buildings',
    stats,
    storefronts,
    update(dt, t) {
      syncLandmarks();
      // window-light hour ramp (docs/ART_DIRECTION.md §2): per-style multiplier in the shared style table
      updateLitRamp(uniforms.uStyle.value, ctx.time.dayFraction * 24);
      if (!uniforms.shared) {
        uniforms.uTime.value = t;
        uniforms.uNight.value = 1 - ctx.time.daylight;
        uniforms.uWet.value = ctx.state.weather.wetness ?? 0;
      }
      far?.update();
      if (!texturesEnabled && texTries < 40) {
        texPoll += dt;
        if (texPoll > 30) {
          texPoll = 0;
          void tryTextures();
        }
      }
    },
    isInside(x, z) {
      return lookup(x, z) !== null;
    },
    buildingAt(x, z) {
      const b = lookup(x, z);
      if (b) return b;
      // nearest building within 3 m (doorways / sidewalk edge)
      const near = ctx.world.buildingsNear(x, z, 3);
      return near.length ? near[0] : null;
    },
    dispose() {
      builds.dispose();
      disposed = true; signJob.cancel();
      offLoad();
      offUnload();
      for (const k of Array.from(tiles.keys())) onTileUnloaded(k);
      for (const s of workers) s.w.terminate();
      far?.dispose();
      material.dispose();
      for (const texture of facadeTextures) texture.dispose(); facadeTextures.clear();
      signAtlas.dispose();
      ctx.worldGroup.remove(group);
    },
  };
  return mod;
}
