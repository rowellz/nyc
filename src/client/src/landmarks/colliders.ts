/**
 * Static colliders for landmark massing (the buildings module skips our BINs, so we provide the walls players
 * and bullets collide with). Trimesh of the extruded footprint (walls + top), one fixed rigid body per landmark.
 */
import * as THREE from 'three';
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import type { GameContext } from '@/core/context';
import type { Ring } from '@shared/world';

export function prismTrimesh(ring: Ring, y0: number, y1: number): { vertices: Float32Array; indices: Uint32Array } | null {
  const n = ring.length;
  if (n < 3) return null;
  const verts: number[] = [];
  const idx: number[] = [];
  for (const [x, z] of ring) verts.push(x, y0, z);
  for (const [x, z] of ring) verts.push(x, y1, z);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + j, i, n + j, n + i);
  }
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  try {
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const t of tris) idx.push(n + t[0], n + t[1], n + t[2]);
  } catch {
    /* no cap */
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

export class LandmarkColliders {
  private keys = new Set<string>();
  constructor(private ctx: GameContext) {}

  /** add extruded footprints as one static body under `key` */
  addPrisms(key: string, prisms: { ring: Ring; y0: number; y1: number }[], surface = 'building'): void {
    const ph = this.ctx.physics;
    if (!ph?.world || !ph.RAPIER) return;
    this.remove(key);
    const R = ph.RAPIER;
    let body: RigidBody | null = null;
    try {
      body = ph.world.createRigidBody(R.RigidBodyDesc.fixed().setUserData({ surface, key }));
      const cols: Collider[] = [];
      for (const p of prisms) {
        const tm = prismTrimesh(p.ring, p.y0, p.y1);
        if (!tm) continue;
        cols.push(ph.world.createCollider(R.ColliderDesc.trimesh(tm.vertices, tm.indices).setFriction(0.8), body));
      }
      if (!cols.length) {
        ph.world.removeRigidBody(body);
        return;
      }
      ph.addTileColliders(key, cols, surface);
      this.keys.add(key);
    } catch (err) {
      if (body) {
        try { ph.world.removeRigidBody(body); } catch { /* Physics may already be gone. */ }
      }
      console.warn('[landmarks] collider failed', key, err);
    }
  }

  remove(key: string): void {
    if (!this.keys.has(key)) return;
    this.keys.delete(key);
    try {
      this.ctx.physics.removeTileColliders(key);
    } catch {
      /* gone */
    }
  }

  dispose(): void {
    for (const k of Array.from(this.keys)) this.remove(k);
  }
}
