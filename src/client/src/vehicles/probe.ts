/** Opt-in, read-only fleet audit for tools/shot.mjs: ?vehicleProbe=1 adds its result to __stats(). */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { R, type Rect } from './atlas';
import { Fleet } from './fleet';
import { KINDS } from './kinds';
import { isAvenue } from './roads';
import { Traffic } from './traffic';
import type { ContactShadows } from './contacts';

function mappedTriangles(g: THREE.BufferGeometry, rect: Rect): number {
  const uv = g.getAttribute('uv'), index = g.index!;
  let count = 0;
  for (let i = 0; i < index.count; i += 3) {
    if ([0, 1, 2].every(j => {
      const id = index.getX(i + j), u = uv.getX(id), v = uv.getY(id);
      return u >= rect.u0 - 1e-6 && u <= rect.u1 + 1e-6 && v >= rect.v0 - 1e-6 && v <= rect.v1 + 1e-6;
    })) count++;
  }
  return count;
}

/** A/B the actual visible scene, not a painted test swatch. Only glass env intensity changes. */
function windshieldPixels(ctx: GameContext, fleet: Fleet) {
  const pool = fleet.pools.get('sedan');
  if (!pool?.nearCount) return { status: 'no mid-distance sedan' };
  const renderer = ctx.renderer, camera = ctx.camera;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const width = size.x, height = size.y;
  const candidates: { x: number; y: number; instance: number; distance: number }[] = [];
  const g = pool.geo.glass, pos = g.getAttribute('position'), normal = g.getAttribute('normal');
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3(), n = new THREE.Vector3(), eye = new THREE.Vector3();
  for (let instance = 0; instance < pool.nearCount; instance++) {
    pool.near.getMatrixAt(instance, matrix);
    const distance = new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(camera.position);
    if (distance < 10 || distance > 40) continue;
    for (let i = 0; i < g.index!.count; i += 3) {
      const ids = [0, 1, 2].map(j => g.index!.getX(i + j));
      n.fromBufferAttribute(normal, ids[0]);
      if (n.z > -0.25 || n.y < 0.1 || Math.abs(n.x) > 0.35) continue;
      point.set(0, 0, 0);
      for (const id of ids) point.add(new THREE.Vector3().fromBufferAttribute(pos, id));
      point.divideScalar(3);
      // Exclude the sedan's bowed lamp-cover glass: this audit is specifically a windshield.
      if (point.y < KINDS.sedan.height * 0.6 || point.z >= 0) continue;
      point.applyMatrix4(matrix);
      n.transformDirection(matrix); eye.copy(camera.position).sub(point);
      if (n.dot(eye) <= 0) continue;
      point.project(camera);
      if (Math.abs(point.x) > 0.97 || Math.abs(point.y) > 0.97 || point.z > 1) continue;
      candidates.push({ x: Math.floor((point.x + 1) * 0.5 * width), y: Math.floor((point.y + 1) * 0.5 * height), instance, distance });
    }
  }
  if (!candidates.length) return { status: 'no front-facing 10–40 m sedan windshield in frame' };
  const previous = renderer.getRenderTarget(), autoClear = renderer.autoClear;
  const shadowAuto = renderer.shadowMap.autoUpdate, intensity = fleet.glassMat.envMapIntensity;
  const gl = renderer.getContext();
  const render = () => {
    if (ctx.composer) ctx.composer.render(0);
    else { renderer.setRenderTarget(null); renderer.render(ctx.scene, camera); }
    renderer.setRenderTarget(null);
  };
  const sample = () => candidates.map(c => {
    const rgba = new Uint8Array(4);
    gl.readPixels(c.x, c.y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return [...rgba.slice(0, 3)];
  });
  try {
    renderer.shadowMap.autoUpdate = false;
    renderer.autoClear = true;
    render();
    const live = sample();
    fleet.glassMat.envMapIntensity = 0;
    render();
    const noEnvironment = sample();
    let best = 0, delta = -1;
    for (let i = 0; i < live.length; i++) {
      const d = live[i].reduce((sum, v, c) => sum + Math.abs(v - noEnvironment[i][c]), 0);
      if (d > delta) { best = i; delta = d; }
    }
    const c = candidates[best];
    return { status: delta > 6 ? 'live sky reflection verified' : 'occluded or no measurable environment reflection',
      source: 'full scene, postprocessed framebuffer, glass env intensity A/B', lod: 'near (10–40 m mid-distance)',
      instance: c.instance, distance: +c.distance.toFixed(2), pixel: [c.x, height - 1 - c.y],
      rgb: live[best], withoutEnvironment: noEnvironment[best], channelDelta: delta,
      envMap: fleet.glassMat.envMap?.uuid ?? null, sceneEnvironmentMatches: fleet.glassMat.envMap === ctx.scene.environment };
  } finally {
    fleet.glassMat.envMapIntensity = intensity;
    render();
    renderer.setRenderTarget(previous); renderer.autoClear = autoClear; renderer.shadowMap.autoUpdate = shadowAuto;
  }
}

export function installVehicleProbe(ctx: GameContext, fleet: Fleet, traffic: Traffic, contacts: ContactShadows): () => void {
  let pixels: ReturnType<typeof windshieldPixels> | undefined;
  let pixelAttemptAt = -Infinity;
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4(), sphere = new THREE.Sphere();
  Object.defineProperty(ctx.stats, 'vehicleProbe', { configurable: true, enumerable: true, get: () => {
    if (!(window as unknown as { __ready: boolean }).__ready) return { status: 'waiting for ready' };
    view.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse); frustum.setFromProjectionMatrix(view);
    const visible = traffic.cars.filter(c => {
      const s = KINDS[c.kind]; sphere.set(new THREE.Vector3(c.x, c.y + s.height / 2, c.z), s.length * 0.6);
      return frustum.intersectsSphere(sphere);
    });
    const avenues: Record<string, { total: number; moving: number; queued: number; within150: number }> = {};
    for (const c of visible) if (isAvenue(c.lane.road)) {
      const row = avenues[c.lane.road.name!] ??= { total: 0, moving: 0, queued: 0, within150: 0 };
      row.total++; if (c.speed > 0.5) row.moving++; else row.queued++;
      if (Math.hypot(c.x - ctx.camera.position.x, c.z - ctx.camera.position.z) < 150) row.within150++;
    }
    const liveries = ['taxi', 'nypd', 'bus', 'boxtruck'].map(kind => {
      const p = fleet.pools.get(kind)!, material = p.far.material as THREE.MeshPhysicalMaterial;
      const rect = kind === 'boxtruck' || kind === 'bus' ? R.boxSide : R.decalL;
      const image = material.map?.image as HTMLCanvasElement | undefined;
      const data = image?.getContext('2d')?.getImageData(rect.x, rect.y, rect.w, rect.h).data;
      const colors = new Set<number>();
      if (data) for (let i = 0; i < data.length; i += 64) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      return { kind, midInstances: p.nearCount, farInstances: p.farCount, map: material.map?.name,
        boundToKindAtlas: material.map === p.atlas.map, sharedMidFarMaterial: p.near.material === p.far.material,
        mapUploaded: material.map ? (rendererTextureVersion(ctx.renderer, material.map) !== undefined) : false,
        liveryTriangles: { mid: mappedTriangles(p.geo.opaque, rect), far: mappedTriangles(p.geo.far, rect) }, sampledColors: colors.size };
    });
    // Cache the expensive two-pass pixel audit; traffic/material counts remain live at capture time.
    if (!pixels || pixels.status !== 'live sky reflection verified' && performance.now() - pixelAttemptAt > 2000) {
      pixelAttemptAt = performance.now();
      pixels = windshieldPixels(ctx, fleet);
    }
    return { cap: ctx.quality.maxTraffic, totalTraffic: traffic.cars.length, inFrustum: visible.length,
      movingInFrustum: visible.filter(c => c.speed > 0.5).length, avenues,
      nearAvenueTraffic: traffic.cars.filter(c => isAvenue(c.lane.road) && Math.hypot(c.x - ctx.camera.position.x, c.z - ctx.camera.position.z) < 150).length,
      contacts: { count: contacts.mesh.count, multiply: (contacts.mesh.material as THREE.Material).blending === THREE.MultiplyBlending },
      wheels: [...fleet.pools.values()].map(p => ({ kind: p.spec.id, mid: mappedTriangles(p.geo.opaque, R.wheelHub), far: mappedTriangles(p.geo.far, R.wheelHub) })),
      liveries, windshield: pixels };
  } });
  return () => { delete (ctx.stats as unknown as Record<string, unknown>).vehicleProbe; };
}

function rendererTextureVersion(renderer: THREE.WebGLRenderer, texture: THREE.Texture): unknown {
  // Three's GPU upload state is diagnostic only; never mutate it.
  return (renderer.properties.get(texture) as { __version?: number }).__version;
}
