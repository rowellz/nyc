/**
 * Instance store + renderers.
 *  - Every tile keeps, per kind, a packed Float32Array of instance records (stride 9):
 *      x, y, z, yaw, scale, d0, d1, d2, d3   (d* = the per-instance aData)
 *  - A KindRenderer owns one InstancedMesh per LOD (near/far) for a kind. On gather() it walks the loaded
 *    tiles within range, culls each instance by distance + frustum sphere, writes the instance matrices and
 *    aData, and sets the draw count. That keeps the draw calls at ~1-2 per kind for the whole city while the
 *    triangle count follows the camera.
 *  - `dynamic` lets a kind override d0..d3 at gather time (traffic-signal state from the network clock).
 */
import * as THREE from 'three';
import { InstanceUpdates } from '../buildings/instanceUpdates';

export const STRIDE = 9;

export class InstanceList {
  data: Float32Array;
  count = 0;
  constructor(cap = 64) {
    this.data = new Float32Array(cap * STRIDE);
  }
  push(x: number, y: number, z: number, yaw: number, scale = 1, d0 = 0, d1 = 0, d2 = 0, d3 = 0): number {
    if ((this.count + 1) * STRIDE > this.data.length) {
      const n = new Float32Array(this.data.length * 2);
      n.set(this.data);
      this.data = n;
    }
    const o = this.count * STRIDE;
    const d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw; d[o + 4] = scale;
    d[o + 5] = d0; d[o + 6] = d1; d[o + 7] = d2; d[o + 8] = d3;
    return this.count++;
  }
}

export interface TileStore {
  key: string;
  cx: number;
  cz: number;
  kinds: Map<string, InstanceList>;
}

/** On-demand visibility audit; counts partition every placed record, including off-camera tiles. */
export interface InstanceCounts {
  placed: number;
  near: number;
  far: number;
  tileRange: number;
  distance: number;
  frustum: number;
  dynamic: number;
  capacity: number;
}

export interface KindOpts {
  /** max instances drawn at once (near + far each) */
  capacity: number;
  /** draw distance for the near LOD; the far LOD (if any) draws from `range` to `farRange` */
  range: number;
  farRange?: number;
  /** bounding radius of one instance (frustum test) */
  radius: number;
  castShadow?: boolean;
  /** Only the near-LOD prefix inside this camera distance enters the shadow pass. */
  castShadowDistance?: number;
  receiveShadow?: boolean;
  /** override the per-instance data at gather time (signals). Return false to skip the instance. */
  dynamic?: (rec: Float32Array, o: number, out: Float32Array, oo: number, now: number) => boolean;
  /** optional custom depth material (alpha-tested shadows) */
  customDepthMaterial?: THREE.Material;
  renderOrder?: number;
  /** instances are never frustum culled individually (e.g. very large ones) */
  noFrustum?: boolean;
}

const tmpSphere = new THREE.Sphere();

function writeInstance(im: InstanceUpdates, data: InstanceUpdates, slot: number,
  rec: Float32Array, p: number, values: Float32Array, offset = 0): void {
  const yaw = rec[p + 3], s = rec[p + 4];
  const c = Math.cos(yaw) * s, sn = Math.sin(yaw) * s, q = slot * 16;
  im.set(q, c); im.set(q + 1, 0); im.set(q + 2, -sn); im.set(q + 3, 0);
  im.set(q + 4, 0); im.set(q + 5, s); im.set(q + 6, 0); im.set(q + 7, 0);
  im.set(q + 8, sn); im.set(q + 9, 0); im.set(q + 10, c); im.set(q + 11, 0);
  im.set(q + 12, rec[p]); im.set(q + 13, rec[p + 1]); im.set(q + 14, rec[p + 2]); im.set(q + 15, 1);
  for (let i = 0; i < 4; i++) data.set(slot * 4 + i, values[offset + i]);
}

export class KindRenderer {
  readonly name: string;
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh | null = null;
  private nearData: THREE.InstancedBufferAttribute;
  private farData: THREE.InstancedBufferAttribute | null = null;
  opts: KindOpts;
  drawn = 0;
  drawnFar = 0;
  shadowDrawn = 0;
  /** total instance records across loaded tiles (stats) */
  total = 0;
  private scratchData = new Float32Array(4);
  private nearMatrixUpdates: InstanceUpdates;
  private nearDataUpdates: InstanceUpdates;
  private farMatrixUpdates: InstanceUpdates | null = null;
  private farDataUpdates: InstanceUpdates | null = null;
  private nonCasters: Float32Array | null;

  constructor(name: string, nearGeom: THREE.BufferGeometry, farGeom: THREE.BufferGeometry | null, material: THREE.Material, farMaterial: THREE.Material | null, opts: KindOpts) {
    this.name = name;
    this.opts = opts;
    this.nonCasters = opts.castShadowDistance !== undefined && (opts.castShadow ?? true)
      ? new Float32Array(opts.capacity * STRIDE) : null;
    const make = (g: THREE.BufferGeometry, m: THREE.Material, suffix: string) => {
      const geom = g;
      const data = new THREE.InstancedBufferAttribute(new Float32Array(opts.capacity * 4), 4);
      data.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('aData', data);
      const mesh = new THREE.InstancedMesh(geom, m, opts.capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = opts.castShadow ?? true;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      mesh.name = `props-${name}${suffix}`;
      if (opts.customDepthMaterial) mesh.customDepthMaterial = opts.customDepthMaterial;
      if (opts.renderOrder !== undefined) mesh.renderOrder = opts.renderOrder;
      mesh.visible = false;
      return { mesh, data };
    };
    const n = make(nearGeom, material, '');
    this.near = n.mesh;
    this.nearData = n.data;
    this.nearMatrixUpdates = new InstanceUpdates(n.mesh.instanceMatrix);
    this.nearDataUpdates = new InstanceUpdates(n.data);
    if (this.nonCasters) {
      let colorCount = 0;
      this.near.onBeforeShadow = () => {
        colorCount = this.near.count;
        this.near.count = Math.min(colorCount, this.shadowDrawn);
      };
      this.near.onAfterShadow = () => { this.near.count = colorCount; };
    }
    if (farGeom) {
      const f = make(farGeom, farMaterial ?? material, '-far');
      this.far = f.mesh;
      this.farData = f.data;
      this.farMatrixUpdates = new InstanceUpdates(f.mesh.instanceMatrix);
      this.farDataUpdates = new InstanceUpdates(f.data);
      this.far.castShadow = false;
    }
  }

  addTo(group: THREE.Object3D): void {
    group.add(this.near);
    if (this.far) group.add(this.far);
  }

  /**
   * Fill the instance buffers from the tiles. `tiles` are the loaded tile stores; camera position + frustum
   * decide what is drawn.
   */
  gather(tiles: Iterable<TileStore>, cam: THREE.Vector3, frustum: THREE.Frustum, now: number,
    audit?: Record<string, InstanceCounts>): void {
    const o = this.opts;
    const range = o.range, farRange = o.farRange ?? range;
    const maxR = Math.max(range, farRange);
    const hasFar = this.far !== null;
    const cap = o.capacity;
    let nNear = 0, nFar = 0, total = 0;
    let nShadow = 0, nNonCasters = 0;
    const shadowR2 = (o.castShadowDistance ?? Infinity) ** 2;
    const r2 = range * range, fr2 = farRange * farRange;
    const rad = o.radius;
    const tmp = this.scratchData;
    const tileReach = maxR + 190; // half diagonal of a 256 m tile
    for (const t of tiles) {
      const list = t.kinds.get(this.name);
      if (!list || list.count === 0) continue;
      total += list.count;
      const counts = audit ? (audit[t.key] = { placed: list.count, near: 0, far: 0, tileRange: 0,
        distance: 0, frustum: 0, dynamic: 0, capacity: 0 }) : undefined;
      const dx = t.cx - cam.x, dz = t.cz - cam.z;
      if (dx * dx + dz * dz > tileReach * tileReach) {
        if (counts) counts.tileRange = list.count;
        continue;
      }
      const d = list.data;
      for (let i = 0; i < list.count; i++) {
        const p = i * STRIDE;
        const x = d[p], y = d[p + 1], z = d[p + 2];
        const ex = x - cam.x, ey = y - cam.y, ez = z - cam.z;
        const dist2 = ex * ex + ey * ey + ez * ez;
        if (dist2 > fr2) { if (counts) counts.distance++; continue; }
        const isNear = dist2 <= r2;
        if (!isNear && !hasFar) { if (counts) counts.distance++; continue; }
        if (!o.noFrustum) {
          tmpSphere.center.set(x, y + rad * 0.5, z);
          tmpSphere.radius = rad * d[p + 4];
          if (!frustum.intersectsSphere(tmpSphere)) { if (counts) counts.frustum++; continue; }
        }
        tmp[0] = d[p + 5]; tmp[1] = d[p + 6]; tmp[2] = d[p + 7]; tmp[3] = d[p + 8];
        if (o.dynamic && !o.dynamic(d, p, tmp, 0, now)) { if (counts) counts.dynamic++; continue; }
        if ((isNear ? nNear : nFar) >= cap) { if (counts) counts.capacity++; continue; }
        if (isNear && this.nonCasters && dist2 > shadowR2) {
          // Defer non-casters so the shadow draw can use a prefix of the SAME instance buffer.
          // Write each final slot only once: a static gather must not trigger another GPU upload.
          const dst = nNonCasters++ * STRIDE;
          for (let j = 0; j < 5; j++) this.nonCasters[dst + j] = d[p + j];
          for (let j = 0; j < 4; j++) this.nonCasters[dst + 5 + j] = tmp[j];
          nNear++; if (counts) counts.near++;
          continue;
        }
        const slot = isNear ? nShadow++ : nFar;
        const im = isNear ? this.nearMatrixUpdates : this.farMatrixUpdates!;
        const data = isNear ? this.nearDataUpdates : this.farDataUpdates!;
        writeInstance(im, data, slot, d, p, tmp);
        if (isNear) { nNear++; if (counts) counts.near++; }
        else { nFar++; if (counts) counts.far++; }
      }
    }
    for (let i = 0; i < nNonCasters; i++) {
      const p = i * STRIDE;
      writeInstance(this.nearMatrixUpdates, this.nearDataUpdates, nShadow + i, this.nonCasters!, p, this.nonCasters!, p + 5);
    }
    this.shadowDrawn = nShadow;
    this.total = total;
    this.drawn = nNear;
    this.drawnFar = nFar;
    this.near.count = nNear;
    this.near.visible = nNear > 0;
    if (nNear > 0) {
      this.nearMatrixUpdates.flush();
      this.nearDataUpdates.flush();
    }
    if (this.far) {
      this.far.count = nFar;
      this.far.visible = nFar > 0;
      if (nFar > 0) {
        this.farMatrixUpdates!.flush();
        this.farDataUpdates!.flush();
      }
    }
  }

  dispose(): void {
    this.near.geometry.dispose();
    this.near.dispose();
    if (this.far) {
      this.far.geometry.dispose();
      this.far.dispose();
    }
  }
}
