/** Vehicle module entry: streaming, ownership, traffic, physics and the author's shared fleet renderer. */
import * as THREE from 'three';
import { isIOS } from '@/core/quality';
import type { GameContext, GameModule } from '@/core/context';
import type { GameLoop } from '@/core/loop';
import { AnimId, StateFlag, type VehicleInfo } from '@shared/protocol';
import { TILE_SIZE } from '@shared/geo';
import { Fleet, FAR_DIST, NEAR_DIST } from './fleet';
import { KINDS } from './kinds';
import { Driving, type DrivingState } from './driving';
import { TireEffects } from './effects';
import { Headlights, headlightPower } from './headlights';
import { ContactShadows } from './contacts';
import { Roads } from './roads';
import { Traffic } from './traffic';
import { installVehicleProbe } from './probe';
import { createObstacle, distance2, driverDoor, ground, makeCar, poseMatrix, removeBody, type Car } from './model';

export interface VehiclesModule extends GameModule {
  nearestEnterable(x: number, y: number, z: number, maxDist: number): { key: string; kind: string; label: string; x: number; z: number } | null;
  driving(): DrivingState | null;
  interact(): void;
  remoteSpeed(playerId: number): number;
  driverSeatMatrix(): THREE.Matrix4 | null;
  traffic(): { x: number; z: number; speed: number; kind: string; siren: boolean }[];
  /** Drop one vehicle at a pose (screenshot framing, playtests). Drawn as a parked car once its tile is loaded; returns its key. */
  place(kind: string, x: number, z: number, yaw: number, siren?: boolean): string;
  /** Module-only CPU and instanced draw counts (render passes can draw a pool more than once). */
  stats: { updateMs: number; fixedMs: number; renderMs: number; parked: number; parkingSlots: number; traffic: number; near: number; far: number; draws: number };
}

export async function createVehicles(ctx: GameContext): Promise<VehiclesModule> {
  const ios = isIOS();
  const fleet = new Fleet(ctx);
  // Finish shared assets before returning so core's ready gate also means every kind can be drawn.
  // Yield between kinds; never put procedural geometry or canvas atlas work in the gameplay update.
  while (!fleet.buildNext()) await new Promise<void>(resolve => setTimeout(resolve, 0));
  for (const pool of fleet.pools.values()) pool.far.castShadow = false;
  const roads = new Roads(ctx), traffic = new Traffic(ctx, roads);
  const effects = new TireEffects(ctx);
  const headlights = new Headlights(ctx);
  const contacts = new ContactShadows(ctx);
  const removeProbe = ctx.state.screenshotMode && typeof location !== 'undefined' && new URLSearchParams(location.search).has('vehicleProbe')
    ? installVehicleProbe(ctx, fleet, traffic, contacts) : undefined;
  const moved = new Map<string, Car>(); // session positions survive tile reloads
  const remotes = new Map<number, { car: Car; vehicleId: number }>();
  const owners = new Map<string, number>();
  const parked: Car[] = [], obstacles: Car[] = [];
  const drawParked: Car[] = [], nearParked: Car[] = [];
  const parkingFocus = new THREE.Vector3(Infinity, 0, Infinity);
  const stats: VehiclesModule['stats'] = { updateMs: 0, fixedMs: 0, renderMs: 0, parked: 0, parkingSlots: 0, traffic: 0, near: 0, far: 0, draws: 0 };
  const frustum = new THREE.Frustum(), view = new THREE.Matrix4(), sphere = new THREE.Sphere();
  const quaternion = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ'), position = new THREE.Vector3(), unit = new THREE.Vector3(1, 1, 1);
  let local: Driving | null = null;
  let pending: { car: Car; until: number } | null = null;
  let exitPending = 0;
  let offFixed: (() => void) | undefined;
  let dirty = true, refreshAt = 0, disposed = false;
  let lastInteract = -Infinity;
  const disabledCapsules: import('@dimforge/rapier3d-compat').Collider[] = [];
  function disableDriverCapsule(): void {
    ctx.physics.world.colliders.forEach(c => {
      const data = c.parent()?.userData as { surface?: string; local?: boolean } | undefined;
      if (data?.surface === 'player' && data.local && c.isEnabled()) { c.setEnabled(false); disabledCapsules.push(c); }
    });
  }

  function loaded(car: Car): boolean {
    return roads.tiles.has(`${Math.floor(car.x / TILE_SIZE)}_${Math.floor(car.z / TILE_SIZE)}`);
  }

  function refresh(): void {
    // Rebuild deterministic parking only when the local 80 m window moves.
    if (ios && distance2(parkingFocus, ctx.camera.position) > 8 ** 2) {
      for (const tile of ctx.world.tiles.values()) roads.load(tile);
    }
    parked.length = 0;
    stats.parkingSlots = 0;
    for (const tile of roads.tiles.values()) stats.parkingSlots += tile.parkingSlots;
    for (const tile of roads.tiles.values()) for (const car of tile.parked) {
      if ((ios && distance2(car, ctx.camera.position) > 80 ** 2) || moved.has(car.key) || owners.has(car.key)) { removeBody(ctx, car); continue; }
      parked.push(car);
    }
    for (const car of moved.values()) {
      if (loaded(car) && !owners.has(car.key) && (!ios || distance2(car, ctx.camera.position) <= 80 ** 2)) parked.push(car);
      else removeBody(ctx, car);
    }
    for (const car of parked) {
      if (!ctx.state.screenshotMode && distance2(car, ctx.state.local.state) < 90 ** 2) createObstacle(ctx, car, false);
      else removeBody(ctx, car);
    }
    stats.parked = parked.length;
    // Static parking doesn't need two full-world scans every frame. Keep a
    // padded local set; the normal per-car cull still decides the exact LOD.
    parkingFocus.copy(ctx.camera.position);
    drawParked.length = nearParked.length = 0;
    for (const car of parked) {
      const d = distance2(car, parkingFocus);
      if (d < (FAR_DIST + 60) ** 2) drawParked.push(car);
      if (distance2(car, ctx.state.screenshotMode ? parkingFocus : ctx.state.local.state) < 210 ** 2) nearParked.push(car);
    }
    dirty = false;
  }

  function nearest(x: number, y: number, z: number, maxDist: number): Car | null {
    if (disposed || !Number.isFinite(maxDist) || maxDist < 0) return null;
    if (dirty) refresh();
    let result: Car | null = null, best = maxDist ** 2;
    for (const c of parked) {
      if (owners.has(c.key) || Math.abs(c.y - y) > 2.5) continue;
      // Distance to the driver door makes wide vehicles enterable without standing inside the chassis.
      const spec = KINDS[c.kind], centerDist = (x - c.x) ** 2 + (z - c.z) ** 2;
      if (centerDist > (maxDist + spec.length) ** 2) continue;
      const side = -spec.width / 2 - 0.85, cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
      const doorX = c.x + cos * side + sin * spec.seatZ, doorZ = c.z - sin * side + cos * spec.seatZ;
      const d = Math.min(centerDist, (x - doorX) ** 2 + (z - doorZ) ** 2);
      if (d < best) { result = c; best = d; }
    }
    return result;
  }

  function finishDriving(placePlayer: boolean): void {
    const drive = local;
    if (!drive) return;
    const car = drive.car, wire = ctx.state.local.state;
    local = null; exitPending = 0;
    drive.dispose();
    for (const c of disabledCapsules.splice(0)) if (c.isValid()) c.setEnabled(true);
    if (owners.get(car.key) === ctx.state.local.id) owners.delete(car.key);
    car.y = ground(ctx, car.x, car.z);
    car.speed = 0; car.steer = 0; car.brake = 0; car.siren = false;
    poseMatrix(car);
    moved.set(car.key, car);
    ctx.state.local.vehicleKey = null;
    wire.vehicleId = 0; wire.flags &= ~(StateFlag.InVehicle | StateFlag.Airborne);
    wire.steer = wire.throttle = 0; wire.anim = AnimId.Idle;
    if (placePlayer) {
      const buildings = ctx.modules.get('buildings') as { isInside?: (x: number, z: number) => boolean } | undefined;
      let door = driverDoor(car, KINDS[car.kind]);
      if (buildings?.isInside?.(door.x, door.z)) door = driverDoor(car, KINDS[car.kind], 1);
      wire.x = door.x; wire.z = door.z; wire.y = ground(ctx, door.x, door.z) + 0.05;
      wire.vx = wire.vy = wire.vz = 0;
    }
    dirty = true;
    ctx.events.emit('exitedVehicle');
  }

  function applyOwnership(v: VehicleInfo): void {
    if (!v.key) return;
    if (v.driverId) owners.set(v.key, v.driverId);
    else owners.delete(v.key);
    if (local?.car.key === v.key && v.driverId !== ctx.state.local.id) finishDriving(!ctx.state.local.dead);
    if (pending?.car.key === v.key) {
      const request = pending;
      pending = null;
      if (v.driverId === ctx.state.local.id && ctx.state.local.id !== 0 && !ctx.state.local.dead && !ctx.state.screenshotMode) {
        const source = request.car;
        removeBody(ctx, source);
        const car = makeCar(source.key, source.kind, source.x, source.y, source.z, source.yaw, 1);
        car.color.copy(source.color);
        poseMatrix(car);
        disableDriverCapsule();
        local = new Driving(ctx, car, v.id);
        ctx.state.local.vehicleKey = v.key;
        local.update(0);
        ctx.events.emit('enteredVehicle', v.key);
      } else if (v.driverId === ctx.state.local.id) ctx.net.send({ t: 'exitVehicle' });
    } else if (v.driverId === ctx.state.local.id && !local) ctx.net.send({ t: 'exitVehicle' });
    dirty = true;
  }

  function interact(): void {
    const now = ctx.now ?? 0;
    if (disposed || !ctx.state.welcomed || !ctx.net.connected || ctx.state.screenshotMode || ctx.state.local.dead || now - lastInteract < 0.25) return;
    lastInteract = now;
    if (local) {
      if (!exitPending) { ctx.net.sendState(); ctx.net.send({ t: 'exitVehicle' }); exitPending = now + 3; }
      return;
    }
    if (pending || !ctx.net.connected || !ctx.state.local.id) return;
    const s = ctx.state.local.state, car = nearest(s.x, s.y, s.z, 3);
    if (!car) return;
    pending = { car, until: now + 5 };
    ctx.net.sendState();
    ctx.net.send({ t: 'enterVehicle', key: car.key, kind: car.kind, x: car.x, y: car.y, z: car.z, yaw: car.yaw });
  }

  function updateRemotes(dt: number): void {
    for (const [id, record] of remotes) {
      const s = ctx.state.remotes.get(id)?.render;
      if (!s || !(s.flags & StateFlag.InVehicle) || s.vehicleId !== record.vehicleId || ctx.state.vehicles.get(record.vehicleId)?.driverId !== id) {
        removeBody(ctx, record.car);
        // VehicleInfo has no pose: preserve the last interpolated transform on release.
        if (!owners.has(record.car.key)) { record.car.speed = 0; record.car.brake = 0; moved.set(record.car.key, record.car); dirty = true; }
        remotes.delete(id);
      }
    }
    for (const [id, remote] of ctx.state.remotes) {
      const s = remote.render;
      if (!(s.flags & StateFlag.InVehicle) || !s.vehicleId) continue;
      const info = ctx.state.vehicles.get(s.vehicleId);
      if (!info || info.driverId !== id) continue;
      let record = remotes.get(id);
      if (!record) { record = { car: makeCar(info.key, info.kind, s.x, s.y, s.z, s.yaw, s.vehicleId), vehicleId: s.vehicleId }; remotes.set(id, record); }
      const c = record.car, speed = Math.hypot(s.vx, s.vz);
      c.brake = speed < c.speed - dt * 0.8 ? 1 : 0;
      c.speed = speed; c.x = s.x; c.y = s.y; c.z = s.z; c.yaw = s.yaw; c.steer = -s.steer * 0.4;
      c.spin -= speed * dt / KINDS[c.kind].wheelRadius;
      quaternion.setFromEuler(euler.set(s.pitch, s.yaw, s.roll, 'YXZ'));
      c.matrix.compose(position.set(s.x, s.y, s.z), quaternion, unit);
      if (!ctx.state.screenshotMode && distance2(c, ctx.state.local.state) < 100 ** 2) {
        createObstacle(ctx, c, true);
        c.body?.setNextKinematicTranslation(c); c.body?.setNextKinematicRotation(quaternion);
      } else removeBody(ctx, c);
    }
  }

  function restoreDriving(v: VehicleInfo, pose: { x: number; y: number; z: number; yaw: number }): void {
    if (ctx.state.local.dead || ctx.state.screenshotMode) return;
    const car = makeCar(v.key, KINDS[v.kind] ? v.kind : 'sedan', pose.x, pose.y, pose.z, pose.yaw, 1);
    pending = { car, until: (ctx.now ?? 0) + 5 };
    applyOwnership(v);
  }

  const off = [
    ctx.events.on('tileLoaded', tile => { roads.load(tile); dirty = true; }),
    ctx.events.on('tileUnloaded', key => {
      roads.unload(key); traffic.unload(); effects.unload(key);
      for (const car of moved.values()) if (!loaded(car)) removeBody(ctx, car);
      dirty = true;
    }),
    ctx.events.on('interact', interact),
    ctx.events.on('localDeath', () => { pending = null; if (local) ctx.net.send({ t: 'exitVehicle' }); finishDriving(false); }),
    ctx.events.on('localRespawn', () => { pending = null; finishDriving(false); }),
    ctx.net.onMessage(msg => {
      if (msg.t === 'welcome' && msg.vehicle && !msg.dead && !ctx.state.screenshotMode) {
        // A restart may assign a new wire id. Rebuild driving from the authoritative saved pose/key.
        restoreDriving(msg.vehicle, msg.spawn);
      } else if (msg.t === 'vehicle') {
        if (!msg.v.key) { owners.clear(); for (const v of ctx.state.vehicles.values()) if (v.driverId) owners.set(v.key, v.driverId); dirty = true; }
        else applyOwnership(msg.v);
      } else if (msg.t === 'vehicles') {
        owners.clear(); for (const v of msg.list) applyOwnership(v); dirty = true;
      }
    }),
  ];
  for (const v of ctx.state.vehicles.values()) {
    if (v.driverId === ctx.state.local.id && v.key === ctx.state.local.vehicleKey) restoreDriving(v, ctx.state.local.state);
    else applyOwnership(v);
  }
  for (const tile of ctx.world.tiles.values()) roads.load(tile);

  function place(kind: string, x: number, z: number, yaw: number, siren = false): string {
    kind = KINDS[kind] ? kind : 'sedan';
    const key = `placed:${kind}:${moved.size}`;
    const car = makeCar(key, kind, x, ground(ctx, x, z), z, yaw, 7);
    car.siren = siren;
    poseMatrix(car);
    moved.set(key, car);
    dirty = true;
    return key;
  }
  // ?place=kind,x,z,headingDeg[,siren][;...]: fixed vehicles for the screenshot tool (screenshot mode only)
  if (ctx.state.screenshotMode && typeof location !== 'undefined') {
    for (const entry of (new URLSearchParams(location.search).get('place') ?? '').split(';')) {
      const [kind, x, z, heading, siren] = entry.split(',');
      if (KINDS[kind] && Number.isFinite(+x) && Number.isFinite(+z)) place(kind, +x, +z, -((+heading || 0) * Math.PI) / 180, siren === '1');
    }
  }

  function draw(car: Car, headlights: number, roof: number, turn = 0): void {
    const spec = KINDS[car.kind], dist2 = distance2(car, ctx.camera.position);
    if (dist2 > Math.min(FAR_DIST, ctx.quality.drawDistance) ** 2) return;
    sphere.center.set(car.x, car.y + spec.height / 2, car.z); sphere.radius = spec.length * 0.6;
    if (!frustum.intersectsSphere(sphere)) return;
    const w = fleet.scratch();
    w.matrix.copy(car.matrix); w.color.copy(car.color); w.spin = car.spin; w.steer = car.steer;
    w.lightA[0] = headlights; w.lightA[1] = car.brake;
    w.lightA[2] = turn < -0.25 ? 1 : 0; w.lightA[3] = turn > 0.25 ? 1 : 0;
    w.lightB[0] = car.siren ? 1 : 0; w.lightB[2] = roof;
    if (local?.car === car) {
      w.susp[0] = local.suspension[0]; w.susp[1] = local.suspension[1]; w.susp[2] = local.suspension[2]; w.susp[3] = local.suspension[3];
      w.lightB[1] = local.state.gear < 0 ? 1 : 0;
    }
    const near = (ctx.quality.level === 'low' || ctx.quality.level === 'mobile') ? 55 : ctx.quality.level === 'medium' ? 85 : NEAR_DIST;
    fleet.write(car.kind, w, ios || dist2 < near * near ? 0 : NEAR_DIST);
    contacts.add(car, Math.sqrt(dist2));
  }

  if (typeof window !== 'undefined') (window as unknown as { __vehicles?: unknown }).__vehicles = {
    local: () => local,
    place: (x: number, z: number, yaw: number, speed = 0) => local?.place(x, z, yaw, speed),
    parked: () => { if (dirty) refresh(); return parked.map(c => ({ key: c.key, x: c.x, y: c.y, z: c.z, yaw: c.yaw, kind: c.kind })); },
  };
  return {
    name: 'vehicles', stats, interact,
    nearestEnterable(x, y, z, maxDist) {
      const c = nearest(x, y, z, maxDist);
      return c ? { key: c.key, kind: c.kind, label: KINDS[c.kind].label, x: c.x, z: c.z } : null;
    },
    driving: () => local?.state ?? null,
    remoteSpeed: id => remotes.get(id)?.car.speed ?? 0,
    driverSeatMatrix: () => local?.driverSeatMatrix() ?? null,
    traffic: () => traffic.cars,
    place,
    update(dt, t) {
      if (disposed) return;
      const start = performance.now();
      if (!offFixed && typeof window !== 'undefined') {
        const loop = (window as unknown as { __loop?: GameLoop }).__loop;
        offFixed = loop?.onFixedStep(step => {
          const start = performance.now(); local?.fixed(step); stats.fixedMs = performance.now() - start;
        });
      }
      if (pending && pending.until < t) pending = null;
      if (exitPending && exitPending < t) exitPending = 0;
      if (local && (!ctx.net.connected || ctx.state.local.vehicleKey !== local.car.key)) finishDriving(!ctx.state.local.dead);
      if (local && !offFixed) local.fixed(Math.min(dt, 1 / 30)); // contexts without core's loop (tests/embeds)
      local?.update(dt);
      updateRemotes(dt);
      if (dirty || distance2(parkingFocus, ctx.camera.position) > 50 ** 2 || (!ctx.state.screenshotMode && t >= refreshAt)) { refresh(); refreshAt = t + 0.5; }
      obstacles.length = 0;
      if (local) obstacles.push(local.car);
      for (const r of remotes.values()) obstacles.push(r.car);
      // Only nearby parked cars can obstruct a lane. The geometry normally keeps them at the curb.
      for (const car of nearParked) if (distance2(car, ctx.state.screenshotMode ? ctx.camera.position : ctx.state.local.state) < 150 ** 2) obstacles.push(car);
      traffic.update(dt, t, obstacles);
      effects.update(t, local);
      stats.traffic = traffic.cars.length;
      if (!ctx.modules.has('atmosphere')) {
        fleet.uniforms.uTime.value = t; fleet.uniforms.uNight.value = 1 - ctx.time.daylight;
        fleet.uniforms.uWet.value = ctx.state.weather.wetness;
      }
      stats.updateMs = performance.now() - start;
    },
    preRender() {
      if (disposed) return;
      const start = performance.now();
      ctx.camera.updateMatrixWorld();
      view.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(view);
      fleet.begin();
      contacts.begin();
      const night = headlightPower(fleet.uniforms.uNight.value, ctx.state.weather.condition, ctx.time.daylight);
      headlights.begin(fleet.uniforms.uNight.value, ctx.state.weather.condition, ctx.time.daylight);
      if (local) {
        draw(local.car, local.headlights ? night : 0, 0);
        headlights.add(local.car, local.headlights ? night : 0);
      }
      for (const r of remotes.values()) { draw(r.car, night, 0); headlights.add(r.car, night); }
      for (const car of traffic.cars) { draw(car, night, 1, car.turn); headlights.add(car, night); }
      for (const car of drawParked) if (!owners.has(car.key) && (!ios || distance2(car, ctx.camera.position) <= 80 ** 2)) draw(car, 0, 0);
      fleet.end();
      contacts.end();
      headlights.end();
      Object.assign(stats, fleet.stats());
      if (contacts.mesh.visible) stats.draws++;
      stats.renderMs = performance.now() - start;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      removeProbe?.();
      if (typeof window !== 'undefined') delete (window as unknown as { __vehicles?: unknown }).__vehicles;
      off.forEach(fn => fn()); offFixed?.();
      pending = null;
      if (local) ctx.net.send({ t: 'exitVehicle' });
      finishDriving(false);
      roads.dispose(); traffic.dispose();
      for (const car of moved.values()) removeBody(ctx, car);
      for (const r of remotes.values()) removeBody(ctx, r.car);
      moved.clear(); remotes.clear(); owners.clear(); parked.length = 0; obstacles.length = 0;
      drawParked.length = nearParked.length = 0;
      contacts.dispose(); headlights.dispose(); effects.dispose(); fleet.dispose();
    },
  };
}
