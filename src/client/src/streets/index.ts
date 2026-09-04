/** Streaming/lifetime glue for the streets builders. World geometry stays static between tile changes. */
import * as THREE from 'three';
import type { GameContext, GameModule } from '@/core/context';
import type { AtmosphereModule } from '@/atmosphere';
import { TILE_SIZE, tileKey } from '@shared/geo';
import type { RoadSegment, Tile } from '@shared/world';
import { buildScope, type BuildJob, type BuildSteps } from '../buildings/loading';
import { unpackTexture, type PackedTexture } from '../buildings/transfer';
import { deckHeightIn } from './bridges';
import { walkHeightIn, type WalkCollision } from './collision';
import { ringBBox, type BBox } from './geom2d';
import { createMarkingsMaterial, createRoadMaterial, createSidewalkMaterial, createStructureMaterial, retarget, type SharedUniforms } from './materials';
import { SurfaceGrid } from './surface';
import { crossingsInTile } from './markings';
import { disposeTextures, loadManifestTextures, type StreetTextures } from './textures';
import type { BuildRequest, BuildResponse, BuiltStreetTile, TileInput } from './tile';

export interface StreetsModule extends GameModule {
  /** 'asphalt' | 'concrete' | 'cobblestone' | 'metal' | 'paint' | null */
  surfaceAt(x: number, z: number): string | null;
  /** Highest street support: elevated roadway, 0.15 m sidewalk, curb-cut slope, or zero on road/ground. */
  deckHeight(x: number, z: number): number;
}

interface TileRecord {
  tile: Tile;
  revision: number;
  group: THREE.Group | null;
  markings: THREE.Mesh | null;
  grid: SurfaceGrid | null;
  decks: BuiltStreetTile['decks'];
  walkCollision: WalkCollision | null;
  collider: boolean;
  job?: BuildJob;
}

export async function createStreets(ctx: GameContext): Promise<StreetsModule> {
  const root = new THREE.Group();
  root.name = 'streets';
  ctx.worldGroup.add(root);
  const atmosphere = ctx.modules.get('atmosphere') as AtmosphereModule | undefined;
  const shared: SharedUniforms = {
    uWetness: atmosphere?.uniforms?.uWetness ?? { value: ctx.state.weather.wetness ?? 0 },
    uRain: atmosphere?.uniforms?.uRain ?? { value: ctx.state.weather.precip ?? 0 },
    uTime: atmosphere?.uniforms?.uTime ?? { value: 0 },
    uNight: atmosphere?.uniforms?.uNight ?? { value: 1 - ctx.time.daylight },
  };
  const builds = buildScope(ctx);
  const placeholder = () => new THREE.Texture();
  const set = () => ({ albedo: placeholder(), normal: placeholder(), rough: null, scale: 1 });
  const textures: StreetTextures = { asphalt: set(), concrete: set(), granite: set(), cobble: set(),
    asphalt2: placeholder(), asphalt2Scale: 3, noise: placeholder(), atlas: placeholder(), procedural: true };
  const textureJob = builds.job('streets textures');
  const manifest = loadManifestTextures().catch(() => null);
  const road = createRoadMaterial(textures, shared), walk = createSidewalkMaterial(textures, shared);
  const materials = [road.material, walk.material, createMarkingsMaterial(textures, shared), createStructureMaterial(textures, shared)];
  for (const material of materials) atmosphere?.setupMaterial?.(material);

  let disposed = false, sequence = 0;
  const tiles = new Map<string, TileRecord>();
  function deckHeight(x: number, z: number): number {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    const rec = tiles.get(tileKey(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)));
    if (!rec) return 0;
    return Math.max(deckHeightIn(rec.decks, x, z), rec.walkCollision
      ? walkHeightIn(rec.walkCollision, x, z, rec.tile.tx * TILE_SIZE, rec.tile.tz * TILE_SIZE) : 0);
  }
  // Character safety clamps, pedestrian roots and vehicle placement all use this
  // existing API. Preserve core land/water and landmark decks; own only this overlay.
  const baseGroundHeight = ctx.physics.groundHeight;
  const groundHeight = (x: number, z: number) => {
    const base = baseGroundHeight.call(ctx.physics, x, z), street = deckHeight(x, z);
    return street > 0 ? Math.max(base, street) : base;
  };
  ctx.physics.groundHeight = groundHeight;
  const dirty = new Set<TileRecord>();
  // Paint and utility decals are sub-pixel at this range; keep the road/walk/deck geometry resident.
  const detailDistanceSq = Math.pow(Math.min(400, ctx.quality.drawDistance * 0.3), 2);
  let worker: Worker | null = null;
  const workers: Worker[] = [];
  const active = new Map<number, { rec: TileRecord; revision: number; job: BuildJob; worker: Worker }>();

  const compiled = new Map<THREE.Material, Promise<unknown>>();
  const isCurrent = (rec: TileRecord) => tiles.get(rec.tile.key) === rec;

  function release(rec: TileRecord): void {
    rec.group?.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    rec.group?.removeFromParent();
    if (rec.collider) ctx.physics.removeTileColliders(`streets:${rec.tile.key}`);
    rec.group = null;
    rec.markings = null;
    rec.grid = null;
    rec.decks = [];
    rec.walkCollision = null;
    rec.collider = false;
  }

  function accept(message: BuildResponse): void {
    const request = active.get(message.id);
    if (!request || disposed) return;
    const { rec, revision, job } = request;
    active.delete(message.id);
    if (message.error) console.warn(`[streets] tile ${rec.tile.key}: ${message.error}`);
    if (message.built && isCurrent(rec) && rec.revision === revision && job.pending) job.run(commit(rec, message.built));
    else job.cancel();
    pump();
  }

  function workerFailed(): void {
    for (const w of workers) w.terminate(); workers.length = 0; worker = null;
    for (const request of active.values()) request.job.cancel(); active.clear();
    textureJob.cancel();
    for (const rec of dirty) rec.job?.cancel();
    dirty.clear();
    console.warn('[streets] worker unavailable; pending builds cancelled');
  }
  try {
    worker = new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module', name: 'streets' });
    workers.push(worker);
    worker.onmessage = async (event: MessageEvent<BuildResponse | { type: 'textures'; textures?: Record<string, unknown>; error?: string }>) => {
      const data = event.data;
      if (!('type' in data)) { accept(data); return; }
      if (!data.textures || disposed) {
        if (data.error) console.warn('[streets] textures failed', data.error);
        textureJob.cancel(); return;
      }
      const packed = data.textures;
      const loaded = await manifest;
      if (disposed) {
        for (const set of Object.values(loaded ?? {})) if (set && typeof set === 'object' && 'albedo' in set) {
          set.albedo.dispose(); set.normal?.dispose(); set.rough?.dispose();
        }
        loaded?.asphalt2?.dispose();
        return;
      }
      textureJob.run((function* (): BuildSteps {
        for (const key of ['asphalt', 'concrete', 'granite', 'cobble'] as const) {
          const p = packed[key] as { albedo: PackedTexture; normal: PackedTexture; rough: PackedTexture | null; scale: number };
          for (const map of ['albedo', 'normal', 'rough'] as const) {
            const replacementSet = loaded?.[key];
            const replacement = replacementSet?.[map];
            if (map === 'rough' && replacementSet && !replacement) continue;
            // Do not upload procedural pixels that the manifest replaces before the first ready frame.
            if (!replacement && !p[map]) continue;
            const t = replacement ?? unpackTexture(p[map]!);
            yield t;
            if (disposed) { t.dispose(); return; }
            textures[key][map]?.dispose(); textures[key][map] = t;
          }
          textures[key].scale = loaded?.[key]?.scale ?? p.scale;
        }
        for (const key of ['asphalt2', 'noise', 'atlas'] as const) {
          const t = key === 'asphalt2' && loaded?.asphalt2 ? loaded.asphalt2 : unpackTexture(packed[key] as PackedTexture);
          yield t;
          if (disposed) { t.dispose(); return; }
          textures[key].dispose(); textures[key] = t;
        }
        textures.asphalt2Scale = loaded?.asphalt2Scale ?? 3;
        textures.procedural = !loaded;
        // Materials retain references to atlas/noise too; retarget every sampler in place.
        retarget(road.uniforms, textures); retarget(walk.uniforms, textures);
        for (const m of materials) {
          const u = m.userData.streetUniforms as Record<string, { value: unknown }> | undefined;
          if (u) retarget(u, textures);
        }

      })());
    };
    worker.onerror = event => { event.preventDefault(); workerFailed(); };
    worker.onmessageerror = workerFailed;
    const second = new Worker(new URL('./tile.worker.ts', import.meta.url), { type: 'module', name: 'streets-1' });
    second.onmessage = (event: MessageEvent<BuildResponse>) => accept(event.data);
    second.onerror = event => { event.preventDefault(); workerFailed(); };
    second.onmessageerror = workerFailed; workers.push(second);
    void manifest.then(loaded => {
      if (disposed || !worker) return;
      const skip: Record<string, boolean> = {};
      for (const key of ['asphalt', 'concrete', 'granite', 'cobble'] as const) skip[key] = !!(loaded?.[key]?.albedo && loaded[key]?.normal);
      skip.asphalt2 = !!loaded?.asphalt2;
      worker.postMessage({ type: 'textures', aniso: Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()), quality: ctx.quality.level, skip });
    });
  } catch { workerFailed(); }

  function invalidate(changed: Tile): void {
    // Roads are single-owner and can extend beyond their owner square. Include their whole bounds.
    const bounds: BBox[] = [{ minX: changed.tx * TILE_SIZE, minZ: changed.tz * TILE_SIZE, maxX: (changed.tx + 1) * TILE_SIZE, maxZ: (changed.tz + 1) * TILE_SIZE }];
    for (const r of changed.roads) if (r.pts.length > 1) bounds.push(ringBBox(r.pts));
    for (const rec of tiles.values()) {
      const x = rec.tile.tx * TILE_SIZE, z = rec.tile.tz * TILE_SIZE;
      if (!bounds.some(b => b.maxX >= x - 80 && b.minX <= x + TILE_SIZE + 80 && b.maxZ >= z - 80 && b.minZ <= z + TILE_SIZE + 80)) continue;
      rec.revision++;
      rec.job?.cancel();
      if (worker) { rec.job = builds.job(`streets:${rec.tile.key}`); dirty.add(rec); }
    }
  }

  function onLoad(tile: Tile): void {
    if (disposed || tiles.get(tile.key)?.tile === tile) return;
    const previous = tiles.get(tile.key);
    if (previous) { invalidate(previous.tile); dirty.delete(previous); previous.job?.cancel(); release(previous); }
    tiles.set(tile.key, { tile, revision: 0, group: null, markings: null, grid: null, decks: [], walkCollision: null, collider: false });
    invalidate(tile);
  }
  function onUnload(key: string): void {
    const rec = tiles.get(key);
    if (!rec) return;
    dirty.delete(rec);
    rec.job?.cancel();
    tiles.delete(key);
    release(rec);
    if (!disposed) invalidate(rec.tile);
  }

  function inputFor(rec: TileRecord): TileInput {
    const t = rec.tile;
    const roads = new Map<number, RoadSegment>();
    for (const r of ctx.world.roadsNear((t.tx + 0.5) * TILE_SIZE, (t.tz + 0.5) * TILE_SIZE, TILE_SIZE / 2 + 80)) roads.set(r.id, r);
    for (const r of t.roads) roads.set(r.id, r);
    // Bridge ramp decisions also need roads at endpoints outside this tile.
    for (const r of Array.from(roads.values())) if (r.bridge || r.tunnel) {
      for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) if (p) {
        for (const other of ctx.world.roadsNear(p[0], p[1], 3)) roads.set(other.id, other);
      }
    }
    const neighbors: Tile[] = [];
    for (let z = t.tz - 1; z <= t.tz + 1; z++) for (let x = t.tx - 1; x <= t.tx + 1; x++) {
      const other = ctx.world.tiles.get(tileKey(x, z));
      if (other) neighbors.push(other);
    }
    return { tile: { ...t, crossings: crossingsInTile(t, neighbors) }, roads: Array.from(roads.values()), quality: ctx.quality };
  }

  function pump(): void {
    if (!worker) return;
    while (dirty.size && active.size < workers.length) {
      const slot = workers.find(w => ![...active.values()].some(request => request.worker === w));
      if (!slot) return;
      let next: TileRecord | null = null, nearest = Infinity;
      for (const rec of dirty) {
        const dx = (rec.tile.tx + 0.5) * TILE_SIZE - ctx.camera.position.x, dz = (rec.tile.tz + 0.5) * TILE_SIZE - ctx.camera.position.z;
        const distance = dx * dx + dz * dz;
        if (distance < nearest) { next = rec; nearest = distance; }
      }
      if (!next) return;
      dirty.delete(next);
      const id = ++sequence;
      active.set(id, { rec: next, revision: next.revision, job: next.job!, worker: slot });
      try {
        slot.postMessage({ id, input: inputFor(next) } satisfies BuildRequest);
      } catch (error) { accept({ id, error: String(error) }); }
    }
  }

  function* commit(rec: TileRecord, built: BuiltStreetTile): BuildSteps {
    const group = new THREE.Group();
    group.name = `streets:${rec.tile.key}`;
    try {
      for (let i = 0; i < built.meshes.length; i++) {
        const packed = built.meshes[i];
        if (!packed) continue;
        const geometry = new THREE.BufferGeometry();
        const mesh = new THREE.Mesh(geometry, materials[i]);
        group.add(mesh);
        for (const [name, attr] of Object.entries(packed.attributes)) { geometry.setAttribute(name, new THREE.BufferAttribute(attr.data, attr.size)); yield; }
        geometry.setIndex(new THREE.BufferAttribute(packed.index, 1));
        const [x, y, z, radius] = packed.bounds;
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y, z), radius);
        mesh.name = `${group.name}:${['road', 'walk', 'markings', 'structure'][i]}`;
        mesh.receiveShadow = true;
        mesh.castShadow = i === 3 && ctx.quality.shadows;
        if (i === 2) mesh.renderOrder = 2;
        let warm = compiled.get(materials[i]);
        if (!warm) { warm = ctx.renderer.compileAsync(mesh, ctx.camera, ctx.scene); compiled.set(materials[i], warm); }
        yield warm;
      }
      release(rec);
      rec.group = group;
      rec.markings = group.children.find(o => o.name.endsWith(':markings')) as THREE.Mesh | undefined ?? null;
      root.add(group);
      const grid = new SurfaceGrid(rec.tile.tx * TILE_SIZE, rec.tile.tz * TILE_SIZE);
      grid.data = built.surface;
      grid.paint = built.paint;
      grid.metal = built.metal;
      rec.grid = grid;
      rec.decks = built.decks;
      yield;
      if (built.walkCollision.index.length) {
        while (ctx.physics.ready === false) yield;
        const physics = ctx.physics, walk = built.walkCollision;
        const col = physics.world.createCollider(physics.RAPIER.ColliderDesc.trimesh(walk.position, walk.index, physics.RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
          .setFriction(0.85).setRestitution(0));
        physics.addTileColliders(`streets:${rec.tile.key}`, [col], 'concrete');
        rec.collider = true;
        rec.walkCollision = walk;
        yield;
      }
      for (const chunk of built.colliders) {
        while (ctx.physics.ready === false) yield;
        const physics = ctx.physics;
        const col = physics.world.createCollider(physics.RAPIER.ColliderDesc.trimesh(chunk.position, chunk.index).setFriction(0.85));
        physics.addTileColliders(`streets:${rec.tile.key}`, [col], 'deck');
        rec.collider = true;
        yield;
      }
    } catch (error) {
      console.warn(`[streets] could not commit ${rec.tile.key}`, error);
    } finally {
      if (rec.group !== group) group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
  }

  const off = [ctx.events.on('tileLoaded', onLoad), ctx.events.on('tileUnloaded', onUnload)];
  for (const tile of ctx.world.tiles.values()) onLoad(tile);

  return {
    name: 'streets',
    update(_dt, t) {
      if (disposed) return;
      if (!atmosphere?.uniforms?.uTime) shared.uTime.value = t;
      if (!atmosphere?.uniforms?.uWetness) shared.uWetness.value = ctx.state.weather.wetness ?? 0;
      if (!atmosphere?.uniforms?.uRain) shared.uRain.value = ctx.state.weather.condition === 'snow' ? 0 : ctx.state.weather.precip ?? 0;
      if (!atmosphere?.uniforms?.uNight) shared.uNight.value = 1 - ctx.time.daylight;
      pump();
    },
    preRender() {
      for (const rec of tiles.values()) if (rec.markings) {
        const x = rec.tile.tx * TILE_SIZE, z = rec.tile.tz * TILE_SIZE;
        const dx = Math.max(x - ctx.camera.position.x, 0, ctx.camera.position.x - x - TILE_SIZE);
        const dz = Math.max(z - ctx.camera.position.z, 0, ctx.camera.position.z - z - TILE_SIZE);
        rec.markings.visible = dx * dx + dz * dz <= detailDistanceSq;
      }
    },
    surfaceAt(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
      return tiles.get(tileKey(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)))?.grid?.query(x, z) ?? null;
    },
    deckHeight,
    dispose() {
      builds.dispose();
      if (disposed) return;
      disposed = true;
      off.forEach(unsubscribe => unsubscribe());
      for (const w of workers) w.terminate(); workers.length = 0;
      active.clear();
      textureJob.cancel();
      dirty.clear();
      for (const rec of tiles.values()) { rec.job?.cancel(); release(rec); }
      tiles.clear();
      if (ctx.physics.groundHeight === groundHeight) ctx.physics.groundHeight = baseGroundHeight;
      root.removeFromParent();
      materials.forEach(material => material.dispose());
      disposeTextures(textures);
    },
  };
}
