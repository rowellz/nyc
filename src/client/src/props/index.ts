import { basePath as __launchBasePath, mountedFetch as __launchFetch } from '@/core/basePath';
import * as THREE from 'three';
import type { GameContext, GameModule } from '@/core/context';
import type { AtmosphereModule } from '@/atmosphere';
import type { Tile } from '@shared/world';
import { SignAtlas } from './atlas';
import { bindAtmosphere, createPropMaterial, PROP_UNIFORMS } from './material';
import { KindRenderer, STRIDE, type InstanceCounts, type KindOpts } from './renderer';
import { SignalNetwork, type SignalPole } from './signals';
import { LightPool, PoolDecals, type LightSource } from './lights';
import { SteamSystem, type SteamEmitter } from './steam';
import { createTileStore, placeTileSteps, type PropTile } from './placement';
import { makeStairwellMaterial } from './kinds/subway';
import type { PropKind } from './catalogue';
import { PropColliders } from './colliders';
import { buildScope, type BuildJob, type BuildSteps } from '../buildings/loading';
import { bitmapTexture, unpackMesh, unpackTexture, type PackedTexture } from '../buildings/transfer';

export interface PropsModule extends GameModule {
  /** Explicit probe only: no per-tile diagnostics allocation in the frame loop. */
  debugCounts(): {
    atlas: SignAtlas['stats'];
    tiles: Record<string, { source: Record<string, number>; kinds: Record<string, InstanceCounts & {
      zeroScale: number; invalid: number; minY: number; maxY: number;
    }>; unmapped: string[] }>;
  };
  /** Nearest facing signal within 25 m; distance is along the approach to its stop line. */
  signalFor(x: number, z: number, dirX: number, dirZ: number): {
    state: 'red' | 'yellow' | 'green'; stopX: number; stopZ: number; dist: number;
  } | null;
}

export async function createProps(ctx: GameContext): Promise<PropsModule> {
  const builds = buildScope(ctx);
  const initJob = builds.job('props catalogue');
  const placementJobs = new Map<string, BuildJob>();
  const group = new THREE.Group();
  group.name = 'props';
  const tiles = new Map<string, PropTile>();
  const colliders = new Map<string, PropColliders>();
  const atlas = new SignAtlas(builds, () => ctx.world.ready && placementJobs.size === 0, ctx.quality.level === 'mobile' ? 0.25 : 1);
  const network = new SignalNetwork();
  const poles = new Map<number, SignalPole>();
  const renderers: KindRenderer[] = [];
  const compiled = new Map<THREE.Material, Promise<unknown>>();
  const pendingRenderers = new Set<KindRenderer>();
  const materials = new Set<THREE.Material>();
  const ownedTextures = new Set<THREE.Texture>();
  let disposed = false, signalId = 0, now = 0, delta = 0, refreshAt = -Infinity;
  const level = ctx.quality.level;
  const rangeScale = (level === 'low' || level === 'mobile') ? 0.6 : level === 'medium' ? 0.8 : 1;
  bindAtmosphere(ctx);
  const atmosphere = ctx.modules.get('atmosphere') as AtmosphereModule | undefined;
  const own = <T extends THREE.Texture>(texture: T): T => { ownedTextures.add(texture); return texture; };
  const mat = (opts: Parameters<typeof createPropMaterial>[1] = {}) => {
    const m = createPropMaterial(ctx, opts); materials.add(m); return m;
  };
  const base = mat({ map: own(new THREE.Texture()), name: 'props-metal' });
  const mapped = mat({ map: atlas.texture, atlas: true, name: 'props-sign-atlas' });
  const plywood = mat({ map: own(new THREE.Texture()), atlas: true, selectiveMap: true, name: 'props-plywood' });
  const mesh = mat({ map: own(new THREE.Texture()), selectiveMap: true, alphaTest: 0.45, side: THREE.DoubleSide });
  const shrub = mat({ map: own(new THREE.Texture()), alphaTest: 0.4, side: THREE.DoubleSide });
  const ped = mat({ map: own(new THREE.Texture()), name: 'props-pedestrian' });
  const glass = mat({ transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const stairwell = makeStairwellMaterial(own(new THREE.Texture()), PROP_UNIFORMS);
  atmosphere?.setupMaterial?.(stairwell);
  materials.add(stairwell);

  const dynamic: KindOpts['dynamic'] = (rec, offset, out, oo, time) => {
    const pole = poles.get(rec[offset + 8]);
    if (!pole) return false;
    const phase = rec[offset + 5] ? (1 - pole.phase) as 0 | 1 : pole.phase;
    const t = SignalNetwork.phaseTime(pole.cluster, time);
    out[oo + 1] = SignalNetwork.vehicleState(phase, t);
    out[oo + 2] = SignalNetwork.pedFrame(phase, t);
    return true;
  };
  const register = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material = base,
    range = 180, far: THREE.BufferGeometry | null = null, opts: Partial<KindOpts> = {}) => {
    const renderer = new KindRenderer(name, geometry, far, material, material, {
      capacity: 2048, range: Math.min(ctx.quality.drawDistance, range * rangeScale),
      farRange: Math.min(ctx.quality.drawDistance, (far ? range * 2.5 : range) * rangeScale),
      radius: 4, castShadow: false, ...opts,
    });
    renderer.addTo(group); renderers.push(renderer); pendingRenderers.add(renderer);
    let warm = compiled.get(material);
    if (!warm) { warm = ctx.renderer.compileAsync(renderer.near, ctx.camera, ctx.scene); compiled.set(material, warm); }
    const job = builds.job(`props shader:${name}`);
    job.run((function* (): BuildSteps {
      try { yield warm; } finally { pendingRenderers.delete(renderer); }
    })());
  };
  const shadows = ctx.quality.shadows && level !== 'low';
  let worker: Worker | null = null;
  const propMaterials = { base, mapped, plywood, mesh, shrub, ped, glass, stairwell };
  try {
    worker = new Worker(new URL('./builder.worker.ts', import.meta.url), { type: 'module', name: 'props' });
    worker.onmessage = (event: MessageEvent<{ kinds?: PropKind[]; textures?: Record<string, PackedTexture>; error?: string }>) => {
      const data = event.data;
      if (disposed || !data.kinds || !data.textures) {
        initJob.cancel();
        if (data.error) console.warn('[props] catalogue failed', data.error);
        worker?.terminate(); worker = null; return;
      }
      const kinds = data.kinds, packed = data.textures;
      initJob.run((function* (): BuildSteps {
        atlas.update(now);
        yield;
        for (const key of ['base', 'plywood', 'mesh', 'shrub', 'ped', 'stairwell'] as const) {
          const texture = own(unpackTexture(packed[key]));
          yield texture;
          const material = propMaterials[key];
          if (material instanceof THREE.ShaderMaterial) {
            const previous = material.uniforms.uTiles.value as THREE.Texture;
            previous.dispose(); ownedTextures.delete(previous);
            material.uniforms.uTiles.value = texture;
          } else {
            const previous = material.map;
            previous?.dispose(); if (previous) ownedTextures.delete(previous);
            material.map = texture;
          }
          yield;
        }
        for (const kind of kinds) {
          const geometry = unpackMesh(kind.geometry); yield;
          const far = kind.far ? unpackMesh(kind.far) : null; yield;
          register(kind.name, geometry, propMaterials[kind.material], kind.range, far,
            { ...kind.opts, dynamic: kind.opts.dynamic ? dynamic : undefined });
          yield;
        }
      })());
      worker?.terminate(); worker = null;
    };
    const fail = () => { initJob.cancel(); worker?.terminate(); worker = null; console.warn('[props] catalogue worker failed'); };
    worker.onerror = e => { e.preventDefault(); fail(); }; worker.onmessageerror = fail;
    worker.postMessage({ shadows, mobile: ctx.quality.level === 'mobile' });
  } catch (error) { initJob.cancel(); console.warn('[props] catalogue worker unavailable', error); }

  const lights = new LightPool(ctx, (level === 'low' || level === 'mobile') ? 4 : level === 'medium' ? 6 : 12);
  const pools = new PoolDecals(ctx, PROP_UNIFORMS.uLamp, PROP_UNIFORMS.uWet);
  const steam = new SteamSystem(ctx, PROP_UNIFORMS.uLamp);
  group.add(pools.mesh, steam.points);
  ctx.worldGroup.add(group);
  const candidates: LightSource[] = [], emitters: SteamEmitter[] = [];
  const cameraPosition = new THREE.Vector3();
  const lastSelection = new THREE.Vector3(Infinity, Infinity, Infinity);
  const frustum = new THREE.Frustum(), matrix = new THREE.Matrix4();
  const distance2 = (p: { x: number; y: number; z: number }) => (p.x - cameraPosition.x) ** 2 + (p.y - cameraPosition.y) ** 2 + (p.z - cameraPosition.z) ** 2;
  function rebuildSignals(): void {
    // Worker completion order differs between clients. Give the existing clustering algorithm a
    // stable spatial order so identical loaded intersections have identical phases/seeded offsets.
    const entries = Array.from(poles).sort((a, b) => a[1].x - b[1].x || a[1].z - b[1].z || a[1].fx - b[1].fx || a[1].fz - b[1].fz);
    network.resetPoles();
    for (const [id, pole] of entries) poles.set(id, network.addPole(pole.x, pole.z, Math.atan2(-pole.fx, -pole.fz), pole.tileKey));
  }
  function unload(key: string): void {
    pools.removeTile(key);
    placementJobs.get(key)?.cancel(); placementJobs.delete(key);
    colliders.get(key)?.dispose(); colliders.delete(key);
    const tile = tiles.get(key);
    if (!tile) return;
    for (const text of tile.signs) atlas.release(text);
    for (const id of tile.signals) poles.delete(id);
    network.removeTile(key);
    lights.removeSources(tile.lights);
    tiles.delete(key);
    tile.kinds.clear(); tile.lights.length = tile.steam.length = 0;
    if (!disposed && tile.signals.length) rebuildSignals();
    refreshAt = -Infinity;
  }
  function load(tile: Tile): void {
    if (disposed) return;
    unload(tile.key);
    const store = createTileStore(tile);
    tiles.set(tile.key, store);
    pools.addTile(tile.key);
    const solids = new PropColliders(ctx, tile.key);
    colliders.set(tile.key, solids);
    const job = builds.job(`props:${tile.key}`);
    placementJobs.set(tile.key, job);
    job.run((function* (): BuildSteps {
      try {
        yield* placeTileSteps(ctx, tile, store, atlas, network, poles, () => ++signalId, solids.add);
        if (store.signals.length) rebuildSignals();
        refreshAt = -Infinity;
      } catch (error) { console.warn('[props] skipped invalid tile', tile.key, error); }
      finally { if (placementJobs.get(tile.key) === job) placementJobs.delete(tile.key); }
    })());
  }
  const off = [ctx.events.on('tileLoaded', load), ctx.events.on('tileUnloaded', unload)];
  for (const tile of ctx.world.tiles.values()) load(tile);

  // Optional CC0 surface detail; procedural color maps remain available if the manifest is absent.
  const abort = new AbortController();
  const normalJob = builds.job('props normal map');
  void (async () => {
    let committing = false;
    try {
      const response = await __launchFetch(__launchBasePath('/assets/textures/manifest.json'), { signal: abort.signal });
      if (!response.ok) return;
      const entries = await response.json() as { slug: string; path: string; files: { normal?: string }; physicalSizeM: number }[];
      const entry = entries.find(e => e.slug === 'metal-painted-white');
      if (!entry?.files.normal || disposed) return;
      const texture = await bitmapTexture(`/${entry.path}${entry.files.normal}`);
      if (disposed) { texture.dispose(); return; }
      own(texture); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.setScalar(1 / Math.max(0.1, entry.physicalSizeM || 1));
      committing = true;
      normalJob.run((function* (): BuildSteps { yield texture;
        if (disposed) { texture.dispose(); return; }
        base.normalMap = texture; base.normalScale.setScalar(0.2); base.needsUpdate = true;
      })());
    } catch { /* Optional assets must not prevent the module from running. */ }
    finally { if (!committing) normalJob.cancel(); }
  })();

  return {
    name: 'props',
    debugCounts() {
      const result: ReturnType<PropsModule['debugCounts']> = { atlas: atlas.stats, tiles: {} };
      const registered = new Set(renderers.map(r => r.name));
      for (const [key, tile] of tiles) {
        const source: Record<string, number> = {};
        for (const p of ctx.world.tiles.get(key)?.props ?? []) source[p.kind] = (source[p.kind] ?? 0) + 1;
        result.tiles[key] = { source, kinds: {}, unmapped: [...tile.kinds.keys()].filter(k => !registered.has(k)) };
      }
      ctx.camera.updateMatrixWorld();
      ctx.camera.getWorldPosition(cameraPosition);
      matrix.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix);
      for (const renderer of renderers) {
        const audit: Record<string, InstanceCounts> = {};
        renderer.gather(tiles.values(), cameraPosition, frustum, ctx.state.serverTime(), audit);
        for (const [key, counts] of Object.entries(audit)) {
          const list = tiles.get(key)!.kinds.get(renderer.name)!;
          let zeroScale = 0, invalid = 0, minY = Infinity, maxY = -Infinity;
          for (let i = 0; i < list.count; i++) {
            const o = i * STRIDE, d = list.data;
            if (d[o + 4] === 0) zeroScale++;
            if (![d[o], d[o + 1], d[o + 2], d[o + 3], d[o + 4]].every(Number.isFinite)) invalid++;
            minY = Math.min(minY, d[o + 1]); maxY = Math.max(maxY, d[o + 1]);
          }
          result.tiles[key].kinds[renderer.name] = { ...counts, zeroScale, invalid, minY, maxY };
        }
      }
      return result;
    },
    signalFor(x, z, dx, dz) { return disposed ? null : network.signalFor(x, z, dx, dz, ctx.state.serverTime()); },
    update(dt, t) {
      if (disposed) return;
      now = t; delta = dt;
      if (!atmosphere?.uniforms?.uNight) PROP_UNIFORMS.uLamp.value = 1 - ctx.time.daylight;
      if (!atmosphere?.uniforms?.uWetness) PROP_UNIFORMS.uWet.value = ctx.state.weather.wetness ?? 0;
      atlas.update(t);
      steam.update(t, { speed: ctx.state.weather.wind, dir: ctx.state.weather.windDir }, ctx.renderer.getPixelRatio());
    },
    preRender() {
      if (disposed) return;
      ctx.camera.updateMatrixWorld();
      ctx.camera.getWorldPosition(cameraPosition);
      matrix.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix);
      const time = ctx.state.serverTime();
      for (const renderer of renderers) if (!pendingRenderers.has(renderer)) renderer.gather(tiles.values(), cameraPosition, frustum, time);
      if (now >= refreshAt || cameraPosition.distanceToSquared(lastSelection) > 16) {
        candidates.length = emitters.length = 0;
        for (const tile of tiles.values()) {
          if ((tile.cx - cameraPosition.x) ** 2 + (tile.cz - cameraPosition.z) ** 2 > 520 ** 2) continue;
          for (const source of tile.lights) if (distance2(source) < (300 * rangeScale) ** 2) candidates.push(source);
          for (const emitter of tile.steam) if (distance2(emitter) < (180 * rangeScale) ** 2) emitters.push(emitter);
        }
        candidates.sort((a, b) => distance2(a) - distance2(b));
        emitters.sort((a, b) => distance2(a) - distance2(b));
        steam.setEmitters(emitters.slice(0, (level === 'low' || level === 'mobile') ? 12 : 48));
        pools.set(candidates, cameraPosition, 300 * rangeScale);
        refreshAt = now + 0.25; lastSelection.copy(cameraPosition);
      }
      lights.assign(candidates, PROP_UNIFORMS.uLamp.value, delta, ctx.state.screenshotMode);
      pools.mesh.visible = pools.mesh.count > 0 && PROP_UNIFORMS.uLamp.value > 0.001;
    },
    dispose() {
      builds.dispose();
      if (disposed) return;
      disposed = true; initJob.cancel(); worker?.terminate(); abort.abort(); off.forEach(f => f());
      for (const key of tiles.keys()) unload(key);
      candidates.length = emitters.length = 0;
      for (const renderer of renderers) renderer.dispose();
      lights.dispose(); pools.dispose(); steam.dispose(); atlas.dispose();
      for (const material of materials) material.dispose();
      for (const texture of ownedTextures) texture.dispose();
      renderers.length = 0; pendingRenderers.clear(); materials.clear(); ownedTextures.clear(); poles.clear();
      group.clear(); ctx.worldGroup.remove(group);
    },
  };
}
