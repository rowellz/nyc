/** Rapier fixed-step world. Streamed ground exists only on decoded land, with water polygons
 * subtracted. groundHeight uses the same water classification, so character safety clamps cannot
 * put an invisible floor back over rivers. Independent elevated decks still support bridges.
 */
import * as THREE from 'three';
import * as RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import { TILE_SIZE, tileIndex, tileKey, lonLatToXZ, WORLD_BBOX } from '@shared/geo';
import type { Polygon, Tile, WorldIndex } from '@shared/world';
import type { PhysicsWorld } from './context';
import { landMesh } from './land';

export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

interface Deck {
  key: string;
  polygon: Polygon;
  height: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  body: RigidBody | null;
}

export class PhysicsWorldImpl implements PhysicsWorld {
  world!: RAPIER.World;
  RAPIER = RAPIER;
  ready = false;
  groundBody!: RigidBody;
  /** First loaded land collider; absent until the first land tile is decoded. */
  groundCollider!: Collider;
  groundColliders: Collider[] = [];
  /** world bounds in meters (from WORLD_BBOX), plus margin */
  bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  private tileColliders = new Map<string, Collider[]>();
  private surfaces = new Map<number, string>(); // collider handle -> surface
  private decks = new Map<string, Deck>();
  private deckSeq = 0;
  private landIndex: Set<string> | null = null;
  private landTiles = new Map<string, Tile>();
  private landColliders = new Map<string, Collider>();
  private buildingRevision = 0;
  private ray!: RAPIER.Ray;
  private tmpP = new THREE.Vector3();
  private tmpN = new THREE.Vector3();
  private cameraSphere = new RAPIER.Ball(0.22);
  private identity = { x: 0, y: 0, z: 0, w: 1 };
  private cameraObstacle = (c: Collider) => this.surfaceOf(c) !== 'player';
  stepCount = 0;

  static async create(): Promise<PhysicsWorldImpl> {
    await RAPIER.init();
    const p = new PhysicsWorldImpl();
    p.init();
    return p;
  }

  private init(): void {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = PHYSICS_DT;
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

    const a = lonLatToXZ(WORLD_BBOX.west, WORLD_BBOX.north);
    const b = lonLatToXZ(WORLD_BBOX.east, WORLD_BBOX.south);
    const margin = 6000; // rivers, harbor, and a stretch beyond
    this.bounds = { minX: Math.min(a.x, b.x) - margin, maxX: Math.max(a.x, b.x) + margin, minZ: Math.min(a.z, b.z) - margin, maxZ: Math.max(a.z, b.z) + margin };
    this.groundBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setUserData({ surface: 'ground' }));
    this.ready = true;
  }

  setLandIndex(index: WorldIndex | null): void {
    this.landIndex = index ? new Set(index.tiles) : null;
  }

  loadLand(tile: Tile): void {
    this.unloadLand(tile.key);
    this.landTiles.set(tile.key, tile);
    this.buildingRevision++;
    let desc: RAPIER.ColliderDesc;
    if (!tile.water.length) desc = RAPIER.ColliderDesc.cuboid(TILE_SIZE / 2, 1, TILE_SIZE / 2)
      .setTranslation((tile.tx + 0.5) * TILE_SIZE, -1, (tile.tz + 0.5) * TILE_SIZE);
    else {
      const mesh = landMesh(tile);
      if (!mesh.indices.length) return; // all water, no invisible support
      desc = RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices);
    }
    const c = this.world.createCollider(desc.setFriction(0.9), this.groundBody);
    this.landColliders.set(tile.key, c);
    this.surfaces.set(c.handle, 'ground');
    this.groundColliders.push(c);
    this.groundCollider = this.groundColliders[0];
  }

  unloadLand(key: string): void {
    this.landTiles.delete(key);
    const c = this.landColliders.get(key);
    if (!c) return;
    this.landColliders.delete(key);
    this.surfaces.delete(c.handle);
    this.groundColliders.splice(this.groundColliders.indexOf(c), 1);
    this.world.removeCollider(c, false);
    this.groundCollider = this.groundColliders[0];
  }

  groundHeight(x: number, z: number): number {
    const key = tileKey(tileIndex(x), tileIndex(z));
    const tile = this.landTiles.get(key);
    // Pending indexed land retains the safety clamp until decoded; missing tiles and decoded water do not.
    const water = (this.landIndex !== null && !this.landIndex.has(key)) || tile?.water.some(p => pointInPolygon(x, z, p));
    let h = water ? -100 : 0;
    if (this.decks.size) {
      for (const d of this.decks.values()) {
        if (x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
        if (pointInPolygon(x, z, d.polygon) && d.height > h) h = d.height;
      }
    }
    return h;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { point: THREE.Vector3; normal: THREE.Vector3; dist: number; surface: string } | null {
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    const len = dir.length() || 1;
    this.ray.dir.x = dir.x / len;
    this.ray.dir.y = dir.y / len;
    this.ray.dir.z = dir.z / len;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    const point = this.tmpP.set(origin.x + this.ray.dir.x * t, origin.y + this.ray.dir.y * t, origin.z + this.ray.dir.z * t).clone();
    const normal = this.tmpN.set(hit.normal.x, hit.normal.y, hit.normal.z).clone();
    return { point, normal, dist: t, surface: this.surfaceOf(hit.collider) };
  }

  /** same as raycast but excludes a rigid body (e.g. the local player's own capsule / vehicle) */
  raycastExcluding(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude: RigidBody | null, excludeCollider: Collider | null = null) {
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    const len = dir.length() || 1;
    this.ray.dir.x = dir.x / len;
    this.ray.dir.y = dir.y / len;
    this.ray.dir.z = dir.z / len;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, undefined, excludeCollider ?? undefined, exclude ?? undefined);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      point: new THREE.Vector3(origin.x + this.ray.dir.x * t, origin.y + this.ray.dir.y * t, origin.z + this.ray.dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      dist: t,
      surface: this.surfaceOf(hit.collider),
    };
  }

  surfaceOf(c: Collider): string {
    const s = this.surfaces.get(c.handle);
    if (s) return s;
    const ud = c.parent()?.userData as { surface?: string } | undefined;
    return ud?.surface ?? 'unknown';
  }

  /** Sweep the whole camera volume, not just its centre; distance is in metres (unit direction). */
  sphereCast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude: RigidBody | null): number | null {
    const hit = this.world.castShape(origin, this.identity, dir, this.cameraSphere, 0.02, maxDist, true,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, exclude ?? undefined, this.cameraObstacle);
    return hit ? hit.time_of_impact : null;
  }

  tagCollider(collider: Collider, surface: string): void {
    this.surfaces.set(collider.handle, surface);
  }

  addTileColliders(key: string, colliders: Collider[], surface = 'building'): void {
    if (surface === 'building') this.buildingRevision++;
    const list = this.tileColliders.get(key);
    if (list) list.push(...colliders);
    else this.tileColliders.set(key, colliders.slice());
    for (const c of colliders) if (!this.surfaces.has(c.handle)) this.surfaces.set(c.handle, surface);
  }

  removeTileColliders(key: string): void {
    const list = this.tileColliders.get(key);
    if (!list) return;
    this.tileColliders.delete(key);
    const bodies = new Set<RigidBody>();
    for (const c of list) {
      this.surfaces.delete(c.handle);
      try {
        const parent = c.parent();
        if (parent && parent.handle !== this.groundBody.handle) bodies.add(parent);
        else this.world.removeCollider(c, false);
      } catch {
        /* already removed */
      }
    }
    for (const b of bodies) {
      try {
        this.world.removeRigidBody(b);
      } catch {
        /* already removed */
      }
    }
  }

  hasTileColliders(key: string): boolean {
    return this.tileColliders.has(key);
  }

  get colliderCount(): number {
    return this.world.colliders.len();
  }

  registerDeck(polygon: Polygon, height: number, key?: string): string {
    const k = key ?? `deck_${++this.deckSeq}`;
    if (this.decks.has(k)) this.unregisterDeck(k);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of polygon[0]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    let body: RigidBody | null = null;
    const mesh = triangulatePolygon(polygon, height);
    if (mesh) {
      body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setUserData({ surface: 'deck', key: k }));
      const col = this.world.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices).setFriction(0.9), body);
      this.surfaces.set(col.handle, 'deck');
    }
    this.decks.set(k, { key: k, polygon, height, minX, maxX, minZ, maxZ, body });
    return k;
  }

  unregisterDeck(key: string): void {
    const d = this.decks.get(key);
    if (!d) return;
    this.decks.delete(key);
    if (d.body) {
      try {
        this.world.removeRigidBody(d.body);
      } catch {
        /* gone */
      }
    }
  }

  createCharacterController(offset = 0.05): KinematicCharacterController {
    const cc = this.world.createCharacterController(offset);
    cc.setUp({ x: 0, y: 1, z: 0 });
    cc.enableAutostep(0.4, 0.2, true);
    cc.setMaxSlopeClimbAngle(50 * (Math.PI / 180));
    cc.setMinSlopeSlideAngle(55 * (Math.PI / 180));
    cc.enableSnapToGround(0.35);
    cc.setSlideEnabled(true);
    cc.setApplyImpulsesToDynamicBodies(true);
    cc.setCharacterMass(80);
    // Respawns/teleports can land inside a streamed building. Its back-facing
    // render walls are invisible from there, but its two-sided Rapier shell
    // traps the player. Correct the invalid placement, never delete the wall.
    const compute = cc.computeColliderMovement.bind(cc);
    let last: { x: number; y: number; z: number } | undefined, revision = -1, checkedAt = -Infinity;
    cc.computeColliderMovement = (collider, desired, flags, groups, predicate) => {
      const p = collider.translation();
      const data = collider.parent()?.userData as { surface?: string; local?: boolean } | undefined;
      if (data?.surface === 'player' && data.local && (!last || revision !== this.buildingRevision
        || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 2 || this.stepCount - checkedAt >= 30)) {
        // A small server correction/teleport can put a recovered capsule back
        // inside the same shell. Also retry when a temporary exterior obstacle
        // prevented recovery during loading. Otherwise audit twice per second.
        this.recoverCharacterSpawn(collider, offset);
        checkedAt = this.stepCount;
      }
      // Traffic is kinematic too: it can move over a stationary/spawning capsule.
      // Rapier's movement sweep stops at toi=0 but does not depenetrate that pose.
      if (data?.surface === 'player' && data.local) this.recoverCharacterVehicleOverlap(collider, offset);
      last = collider.translation();
      revision = this.buildingRevision;
      compute(collider, desired, flags, groups, predicate);
    };
    return cc;
  }

  private recoverCharacterVehicleOverlap(collider: Collider, offset: number): void {
    const body = collider.parent();
    if (!body || collider.shapeType() !== RAPIER.ShapeType.Capsule) return;
    const start = body.translation(), rotation = collider.rotation(), shape = collider.shape;
    const overlapping = new Set<number>();
    let correction: { x: number; z: number; depth: number } | undefined;
    this.world.intersectionsWithShape(start, rotation, shape, obstacle => {
      const contact = obstacle.contactCollider(collider, 0);
      if (!contact || contact.distance >= -0.001) return true;
      overlapping.add(obstacle.handle);
      const n = contact.normal1, horizontal = Math.hypot(n.x, n.z);
      // Push out through a side, never underneath a car or up onto its roof.
      if (horizontal > 0.9 && (!correction || -contact.distance > correction.depth)) {
        correction = { x: n.x / horizontal, z: n.z / horizontal, depth: -contact.distance };
      }
      return true;
    }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, collider, body,
    obstacle => this.surfaceOf(obstacle) === 'vehicle');
    if (!correction) return;
    const push = correction as { x: number; z: number; depth: number };
    const length = push.depth + offset + 0.01;
    if (length > 2) return; // bounded local correction, not a teleport through traffic
    const delta = { x: push.x * length, y: 0, z: push.z * length };
    const destination = { x: start.x + delta.x, y: start.y, z: start.z + delta.z };
    // Ignore only the cars already intersecting us during the escape sweep.
    // A wall/car beside them must still block recovery, even if the endpoint is clear.
    const blocked = this.world.castShape(start, rotation, delta, shape, 0, 1, false,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, collider, body,
      obstacle => !overlapping.has(obstacle.handle));
    if (blocked && blocked.time_of_impact < 1) return;
    if (this.world.intersectionWithShape(destination, rotation, shape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, collider, body)) return;
    body.setTranslation(destination, true);
    body.setNextKinematicTranslation(destination);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  private recoverCharacterSpawn(collider: Collider, offset: number): void {
    const body = collider.parent();
    if (!body || collider.shapeType() !== RAPIER.ShapeType.Capsule) return;
    const p = body.translation(), half = collider.halfHeight() + collider.radius();
    const buildings = new Map<number, Tile['buildings'][number]>();
    const tx = tileIndex(p.x), tz = tileIndex(p.z);
    for (let x = tx - 1; x <= tx + 1; x++) for (let z = tz - 1; z <= tz + 1; z++) {
      for (const b of this.landTiles.get(tileKey(x, z))?.buildings ?? []) buildings.set(b.id, b);
    }
    const nearby = [...buildings.values()];
    const containing = nearby.filter(b => p.y - half < b.height && pointInPolygon(p.x, p.z, b.footprint));
    if (!containing.length) return;
    const clearance = collider.radius() + offset + 0.1;
    let best: { x: number; y: number; z: number } | undefined, bestDist = Infinity;
    for (const b of containing) for (const ring of b.footprint) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], q = ring[(i + 1) % ring.length];
      const dx = q[0] - a[0], dz = q[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const t = Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[1]) * dz) / (len * len)));
      for (const sign of [-1, 1]) {
        const x = a[0] + t * dx + sign * dz / len * clearance;
        const z = a[1] + t * dz - sign * dx / len * clearance;
        const d = (x - p.x) ** 2 + (z - p.z) ** 2;
        if (d >= bestDist || nearby.some(other => pointInPolygon(x, z, other.footprint))) continue;
        const ground = this.groundHeight(x, z);
        if (ground < -10) continue;
        const candidate = { x, y: Math.max(p.y, ground + half + offset + 0.01), z };
        if (this.world.intersectionWithShape(candidate, collider.rotation(), collider.shape,
          RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, collider, body)) continue;
        best = candidate; bestDist = d;
      }
    }
    if (!best) return;
    body.setTranslation(best, true);
    body.setNextKinematicTranslation(best);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  step(dt: number): void {
    if (!this.ready) return;
    if (Math.abs(this.world.timestep - dt) > 1e-6) this.world.timestep = dt;
    this.world.step();
    this.stepCount++;
  }
}

export function pointInPolygon(x: number, z: number, poly: Polygon): boolean {
  let inside = false;
  for (let r = 0; r < poly.length; r++) {
    const ring = poly[r];
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
    }
    if (r === 0) inside = hit;
    else if (hit) return false; // inside a hole
  }
  return inside;
}

/** flat trimesh (y = height) for a polygon with holes, using three's earcut */
export function triangulatePolygon(polygon: Polygon, height: number): { vertices: Float32Array; indices: Uint32Array } | null {
  const outer = polygon[0];
  if (!outer || outer.length < 3) return null;
  const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
  const holes = polygon.slice(1).map((r) => r.map(([x, z]) => new THREE.Vector2(x, z)));
  const tris = THREE.ShapeUtils.triangulateShape(contour, holes);
  if (!tris.length) return null;
  const all = [...contour, ...holes.flat()];
  const vertices = new Float32Array(all.length * 3);
  for (let i = 0; i < all.length; i++) {
    vertices[i * 3] = all[i].x;
    vertices[i * 3 + 1] = height;
    vertices[i * 3 + 2] = all[i].y;
  }
  const indices = new Uint32Array(tris.length * 3);
  for (let i = 0; i < tris.length; i++) {
    indices[i * 3] = tris[i][0];
    indices[i * 3 + 1] = tris[i][1];
    indices[i * 3 + 2] = tris[i][2];
  }
  return { vertices, indices };
}
