/** Environment entry point. Tile data is owned by core; all GPU resources here are ours. */
import * as THREE from 'three';
import type { GameContext, GameModule } from '@/core/context';
import type { AtmosphereModule } from '@/atmosphere/index';
import type { Tile } from '@shared/world';
import { TILE_SIZE, tileKey } from '@shared/geo';
import { createGround, WATER_LEVEL, type GroundTile } from './ground';
import { createWater, FallbackSkyEnv } from './water';
import { createGrass } from './grass';
import { createTrees } from './trees';
import { createPiers } from './piers';
import { MaskPainter, MASK_RES, maskSample, type TileMask } from './mask';
import type { MaskJob, MaskResult } from './mask.worker';
import type { SharedUniforms } from './patch';
import { pointInPolygon } from './geom';
import { buildScope, type BuildJob, type BuildSteps } from '@/buildings/loading';
import { TextureLoading } from './texture-loading';
import { disposeTexSet, setAnisotropy, fetchManifest, findInManifest, loadPbrSet, loadNormalMap, ARCHS } from './textures';

export interface EnvironmentModule extends GameModule {
  /** Streets override these base surfaces with their own surfaceAt query. */
  surfaceAt(x: number, z: number): string | null;
  waterLevel: number;
}

interface TileRecord { tile: Tile; mask: TileMask | null; ground: GroundTile | null; piers: THREE.Group | null; revision: number; job: BuildJob | null }

export async function createEnvironment(ctx: GameContext): Promise<EnvironmentModule> {
  const atmosphere = () => ctx.modules.get('atmosphere') as AtmosphereModule | undefined;
  const au = atmosphere()?.uniforms;
  const sh: SharedUniforms = {
    uTime: au?.uTime ?? { value: 0 }, uWetness: au?.uWetness ?? { value: 0 },
    uRain: au?.uRain ?? { value: 0 }, uNight: au?.uNight ?? { value: 0 },
    uWind: { value: new THREE.Vector2() }, uSeason: { value: 0.18 },
    uSafe: { value: new THREE.Vector3(ctx.state.safeZone.x, ctx.state.safeZone.z, ctx.state.safeZone.radius) },
  };
  setAnisotropy(ctx.renderer.capabilities.getMaxAnisotropy());
  const textureLoading = new TextureLoading(ctx);
  const textures = await textureLoading.generate().catch(error => { textureLoading.dispose(); throw error; });
  const maskScope = buildScope(ctx);
  const group = new THREE.Group();
  group.name = 'environment';
  ctx.worldGroup.add(group);
  const setup = (mat: THREE.Material) => atmosphere()?.setupMaterial?.(mat);
  const piers = createPiers(group, sh, ctx.quality.shadows);
  const ground = createGround(ctx, group, textures, sh, { skipEdge: piers.onDeck });
  const water = createWater(group, textures.waterNormal, sh, ctx.quality.level !== 'mobile');
  const grass = ctx.quality.level === 'mobile' ? null : createGrass(group, ctx.quality.level, sh);
  const trees = createTrees(ctx, group, textures, sh, setup);
  let index = ctx.world.index;
  let indexKeys = new Set(index?.tiles ?? []);
  ground.buildFar(index ?? null);
  const patch = (root: THREE.Object3D) => root.traverse(o => {
    const material = (o as THREE.Mesh).material;
    if (Array.isArray(material)) material.forEach(setup);
    else if (material) setup(material);
  });
  patch(group);

  const tiles = new Map<string, TileRecord>();
  const pending = new Set<string>();
  let revision = 0, disposed = false;
  let worker: Worker | null = null;
  let active: { record: TileRecord; revision: number; id: number; job: BuildJob } | null = null;
  let result: MaskResult | null = null;
  let painter: MaskPainter | null = null;
  let jobId = 0;
  let fallbackSky: FallbackSkyEnv | null = null;
  const fallbackHorizon = new THREE.Color();

  function stopWorker(): void {
    worker?.terminate(); worker = null;
    if (!disposed && active && tiles.get(active.record.tile.key) === active.record) pending.add(active.record.tile.key);
    active = null; result = null;
  }
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      worker = new Worker(new URL('./mask.worker.ts', import.meta.url), { type: 'module', name: 'environment-masks' });
      worker.onmessage = (event: MessageEvent<MaskResult>) => { result = event.data; };
      worker.onerror = (event) => { event.preventDefault(); stopWorker(); };
    } catch { stopWorker(); }
  }

  function dirtyNeighbours(tx: number, tz: number): void {
    // Roads and buildings are stored in their owner tile but can cross its boundary.
    for (let x = tx - 1; x <= tx + 1; x++) for (let z = tz - 1; z <= tz + 1; z++) {
      const key = tileKey(x, z), rec = tiles.get(key);
      if (rec) {
        rec.revision = ++revision;
        rec.job?.cancel();
        rec.job = maskScope.job(`environment mask ${key}`);
        pending.add(key);
      }
    }
  }
  function removeTile(key: string): void {
    pending.delete(key);
    const rec = tiles.get(key);
    if (!rec) return;
    rec.job?.cancel();
    tiles.delete(key);
    if (rec.ground) ground.removeTile(rec.ground);
    if (rec.piers) {
      group.remove(rec.piers);
      rec.piers.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh) m.geometry.dispose(); if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose(); });
      rec.piers = null;
    }
    rec.mask?.tex.dispose();
    trees.removeTile(key);
    ground.setTileLoaded(key, false);
    if (!disposed) dirtyNeighbours(rec.tile.tx, rec.tile.tz);
  }
  function addTile(tile: Tile): void {
    if (disposed) return;
    if (tiles.get(tile.key)?.tile === tile) return;
    removeTile(tile.key);
    tiles.set(tile.key, { tile, mask: null, ground: null, piers: null, revision: ++revision, job: null });
    trees.addTile(tile);
    dirtyNeighbours(tile.tx, tile.tz);
  }

  function commit(rec: TileRecord, data: Uint8ClampedArray, job: BuildJob): void {
    if (!job.pending) return;
    job.run((function* (): BuildSteps {
      if (rec.mask) {
        const mask = rec.mask;
        yield { texture: mask.tex, prepare: () => { mask.tex.image.data = data; mask.tex.needsUpdate = true; } };
        mask.data = data;
        return;
      }
      const tex = new THREE.DataTexture(data, MASK_RES, MASK_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
      let committed = false;
      try {
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false; tex.needsUpdate = true;
        yield tex;
        rec.mask = { key: rec.tile.key, ox: rec.tile.tx * TILE_SIZE, oz: rec.tile.tz * TILE_SIZE, data, tex };
        rec.ground = ground.addTile(rec.tile, rec.mask);
        setup(rec.ground.mat);
        if (rec.ground.seawall) patch(rec.ground.seawall);
        if (rec.ground.extras) patch(rec.ground.extras);
        rec.piers = piers.build(rec.tile);
        if (rec.piers) { group.add(rec.piers); patch(rec.piers); }
        ground.setTileLoaded(rec.tile.key, true);
        committed = true;
        // Hold newly streamed ground out of drawing until its CSM/SSR variants
        // are ready. On initial boot the composer's busy-gated warmup owns it.
        const mesh = rec.ground.mesh;
        const roots: THREE.Object3D[] = [], held: THREE.Object3D[] = [];
        for (const o of [rec.ground.seawall, rec.ground.extras, rec.piers]) {
          if (!o) continue;
          roots.push(o);
          // The atmosphere's boot warmup records a Group's own visible flag and restores it
          // afterwards, so gate a group's children, never the group itself.
          if ((o as THREE.Group).isGroup) held.push(...o.children); else held.push(o);
        }
        mesh.visible = false;
        for (const o of held) o.visible = false;
        try {
          yield atmosphere()?.prepareObjects?.(mesh);
          for (const o of roots) yield atmosphere()?.prepareObjects?.(o);
        } finally { mesh.visible = true; for (const o of held) o.visible = true; }
      } finally { if (!committed) tex.dispose(); }
    })());
  }

  function pumpMasks(): void {
    if (result && active) {
      const done = result, job = active;
      result = null; active = null;
      if (done.error) { pending.add(job.record.tile.key); stopWorker(); }
      else if (done.id === job.id && done.data && tiles.get(done.key) === job.record && job.revision === job.record.revision) commit(job.record, done.data, job.job);
    }
    if (active || !pending.size) return;
    // Prioritise the nearest unfinished tile, then repaint neighbours as streaming settles.
    let rec: TileRecord | undefined, best = Infinity;
    for (const key of pending) {
      const candidate = tiles.get(key);
      if (!candidate) { pending.delete(key); continue; }
      const tile = candidate.tile;
      const d = (tile.tx * TILE_SIZE + TILE_SIZE / 2 - ctx.camera.position.x) ** 2 + (tile.tz * TILE_SIZE + TILE_SIZE / 2 - ctx.camera.position.z) ** 2 + (candidate.mask ? 1e8 : 0);
      if (d < best) { best = d; rec = candidate; }
    }
    if (!rec) return;
    pending.delete(rec.tile.key);
    if (worker) {
      const cx = (rec.tile.tx + 0.5) * TILE_SIZE, cz = (rec.tile.tz + 0.5) * TILE_SIZE;
      active = { record: rec, revision: rec.revision, id: ++jobId, job: rec.job! };
      worker.postMessage({ id: jobId, tile: rec.tile, roads: ctx.world.roadsNear(cx, cz, TILE_SIZE * 0.72), buildings: ctx.world.buildingsNear(cx, cz, TILE_SIZE * 0.72) } satisfies MaskJob);
    } else {
      painter ??= new MaskPainter(ctx);
      const mask = painter.paint(rec.tile);
      commit(rec, mask.data, rec.job!);
      mask.tex.dispose();
    }
  }

  const off = [ctx.events.on('tileLoaded', addTile), ctx.events.on('tileUnloaded', removeTile)];
  for (const tile of ctx.world.tiles.values()) addTile(tile);

  // The existing loader has procedural fallbacks; failed/absent assets never block boot.
  let retainedSoil: typeof textures.soil | null = null;
  const extra: THREE.Texture[] = [];
  const manifestJob = textureLoading.hold('environment manifest');
  void (async () => {
    const manifest = await fetchManifest();
    if (!manifest || disposed) return;
    // River: the shipped tileable water normal (20 m) replaces the small procedural one.
    const waterMatch = findInManifest(manifest, ['water-normal', 'waternormals'], [], true);
    if (waterMatch) {
      const n = await textureLoading.load('water normal', () => loadNormalMap(waterMatch));
      if (n && !disposed) { extra.push(n); water.setNormalMap(n); }
      else n?.dispose();
    }
    // Trees: real bark (Poly Haven platanus for the London plane, furrowed brown for the dark-bark species),
    // real leaf sprites for the cluster cards.
    for (const [kind, slug] of [['plane', 'bark-plane'], ['dark', 'bark-oak']] as const) {
      if (disposed) break;
      const barkMatch = findInManifest(manifest, [slug]);
      if (!barkMatch) continue;
      const set = await textureLoading.load(`bark ${kind}`, () => loadPbrSet(barkMatch, textures.bark[kind].size));
      if (set && !disposed) { extra.push(set.map, set.normal); if (set.rough) extra.push(set.rough); trees.setBark(kind, set); }
      else if (set) { set.map.dispose(); set.normal.dispose(); set.rough?.dispose(); }
    }
    const leafMatch = findInManifest(manifest, ['leaf-atlas', 'leaf']);
    if (leafMatch?.albedo && leafMatch.opacity) {
      const cards = await textureLoading.leaves(ctx.quality.level === 'low' ? 256 : 512, leafMatch.albedo, leafMatch.opacity);
      if (cards && !disposed) {
        for (const a of ARCHS) extra.push(cards[a]);
        trees.setLeafCards(cards);
      } else if (cards) for (const a of ARCHS) cards[a].dispose();
    }
    if (disposed) return;
    for (const [slot, keywords] of [
      ['asphalt', ['asphalt-worn']], ['concrete', ['plaza-concrete']], ['grass', ['grass-lawn']], ['soil', ['dirt-mulch']],
    ] as const) {
      if (disposed) break;
      const match = findInManifest(manifest, [...keywords]);
      if (!match) continue;
      const next = await textureLoading.load(slot, () => loadPbrSet(match, textures[slot].size));
      if (!next) continue;
      if (disposed) { next.map.dispose(); next.normal.dispose(); next.rough?.dispose(); break; }
      const old = textures[slot]; textures[slot] = next;
      ground.setTextures(textures);
      // Soil also belongs to the tree-pit material: retain that original set until disposal.
      if (slot === 'soil') retainedSoil = old;
      else { old.map.dispose(); old.normal.dispose(); old.rough?.dispose(); }
    }
  })().catch(error => { if (!disposed) console.warn('[environment] using procedural textures', error); })
    .finally(() => manifestJob.cancel());

  const atmo = atmosphere();
  if (atmo?.prepareObjects) {
    await atmo.prepareObjects(group);
    await trees.prepare(root => atmo.prepareObjects(root));
  }

  return {
    name: 'environment', waterLevel: WATER_LEVEL,
    update(_dt, t) {
      if (disposed) return;
      if (!au?.uTime) sh.uTime.value = t;
      if (!au?.uNight) sh.uNight.value = 1 - ctx.time.daylight;
      if (!au?.uWetness) sh.uWetness.value = ctx.state.weather.wetness ?? 0;
      if (!au?.uRain) sh.uRain.value = ctx.state.weather.condition === 'snow' ? 0 : ctx.state.weather.precip ?? 0;
      const wx = ctx.state.weather;
      sh.uWind.value.set(Math.sin(wx.windDir) * wx.wind, -Math.cos(wx.windDir) * wx.wind);
      const safe = ctx.state.safeZone;
      sh.uSafe.value.set(safe.x, safe.z, safe.radius);
      if (index !== ctx.world.index) {
        index = ctx.world.index; indexKeys = new Set(index?.tiles ?? []);
        ground.buildFar(index ?? null); patch(group);
      }
      pumpMasks();
      // Inherit scene.environment at draw time: atmosphere can replace/dispose its
      // PMREM in composer.render(), after this update. An explicit map lags a frame.
      const env = ctx.scene.environment ?? atmosphere()?.envMap;
      if (env) { water.setEnvMap(ctx.scene.environment ? null : env); fallbackSky?.dispose(); fallbackSky = null; }
      else if (!atmosphere()) {
        fallbackSky ??= new FallbackSkyEnv(ctx.renderer);
        fallbackSky.update(ctx.time.sunDir, ctx.time.daylight, t);
        water.setEnvMap(fallbackSky.texture);
        const day = ctx.time.daylight;
        // Match FallbackSkyEnv's linear horizon, including its night colour.
        fallbackHorizon.setRGB(0.03 + 0.57 * day, 0.03 + 0.65 * day, 0.045 + 0.755 * day);
        water.setHaze(fallbackHorizon, 0.00024, false);
      }
      if (au) water.setHaze(au.uHorizonColor.value, au.uFogDensity.value, !!ctx.composer);
    },
    preRender() {
      if (disposed) return;
      water.update(ctx.camera);
      grass?.update(ctx.camera, (tx, tz) => tiles.get(tileKey(tx, tz))?.mask ?? null);
      trees.update(sh.uTime.value);
    },
    surfaceAt(x, z) {
      if (disposed || !Number.isFinite(x) || !Number.isFinite(z)) return null;
      const key = tileKey(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE));
      const rec = tiles.get(key), tile = rec?.tile ?? ctx.world.tileAt(x, z);
      if (tile?.water.some(p => pointInPolygon(x, z, p)) || (!tile && (ctx.world.isWater?.(x, z) ?? (index ? !indexKeys.has(key) : false)))) return 'water';
      if (trees.inPit(x, z)) return 'dirt';
      if (rec?.mask) {
        if (maskSample(rec.mask, x, z, 0) > 127) return 'water';
        if (maskSample(rec.mask, x, z, 2) > 127 || maskSample(rec.mask, x, z, 3) > 127) return 'dirt';
        if (maskSample(rec.mask, x, z, 1) > 127) return 'grass';
      } else if (tile?.parks.some(p => pointInPolygon(x, z, p)) && !tile.plazas.some(p => pointInPolygon(x, z, p))) return 'grass';
      return 'ground';
    },
    dispose() {
      if (disposed) return;
      disposed = true; textureLoading.dispose(); maskScope.dispose(); off.forEach(f => f()); stopWorker(); pending.clear();
      for (const key of tiles.keys()) removeTile(key);
      trees.dispose(); grass?.dispose(); water.dispose(); ground.dispose(); piers.dispose(); fallbackSky?.dispose();
      disposeTexSet(textures);
      retainedSoil?.map.dispose(); retainedSoil?.normal.dispose(); retainedSoil?.rough?.dispose();
      for (const t of extra) t.dispose();
      ctx.worldGroup.remove(group); group.clear();
    },
  };
}
