import type { ColliderDesc, RigidBody } from '@dimforge/rapier3d-compat';
import type { GameContext } from '@/core/context';

/** One fixed body per tile; one primitive per solid prop (two for a bench / station kiosk).
 * Owned separately from building colliders so async placement/unload cannot remove another module.
 * Dimensions follow kinds/small.ts, furniture.ts and signs.ts; foliage is not a solid box.
 */
export class PropColliders {
  private body: RigidBody | null = null;
  readonly key: string;
  count = 0;
  constructor(private ctx: GameContext, tileKey: string) { this.key = `props:${tileKey}`; }

  add = (kind: string, x: number, y: number, z: number, yaw: number): void => {
    const { physics: p } = this.ctx, R = p.RAPIER;
    const box = (w: number, h: number, d: number, cy = h / 2, lx = 0, lz = 0) => {
      this.addShape(R.ColliderDesc.cuboid(w / 2, h / 2, d / 2),
        x + lx * Math.cos(yaw) + lz * Math.sin(yaw), y + cy,
        z - lx * Math.sin(yaw) + lz * Math.cos(yaw), yaw);
    };
    const cylinder = (radius: number, h: number) => this.addShape(R.ColliderDesc.cylinder(h / 2, radius), x, y + h / 2, z, yaw);
    switch (kind) {
      case 'planter': box(1.2, 0.6, 1.2); break;
      case 'bollard': cylinder(0.11, 0.96); break;
      case 'wireBasket': cylinder(0.30, 0.78); break;
      case 'steelBasket': cylinder(0.30, 1.1); break;
      case 'cafeTable':
        cylinder(0.31, 0.73);
        box(0.95, 0.9, 0.42, 0.45, 0, 0.53);
        break;
      case 'cafePlanter': box(0.9, 0.95, 0.34); break;
      case 'sandwichBoard': box(0.6, 0.95, 0.42); break;
      case 'umbrellaCream': case 'umbrellaGreen': cylinder(0.26, 0.06); break;
      case 'bench':
        box(1.8, 0.48, 0.56, 0.24, 0, -0.035);
        box(1.8, 0.44, 0.12, 0.7, 0, 0.16);
        break;
      case 'newsstand': box(3.7, 2.8, 1.8); break;
      case 'link': box(0.30, 2.9, 0.93); break;
      case 'muni': box(0.3, 1.56, 0.28); break;
      case 'citiKiosk':
        box(0.5, 1.85, 0.4);
        box(0.9, 1.1, 0.06, 1.2, 0.7);
        break;
    }
  };

  private addShape(desc: ColliderDesc, x: number, y: number, z: number, yaw: number): void {
    const p = this.ctx.physics;
    this.body ??= p.world.createRigidBody(p.RAPIER.RigidBodyDesc.fixed().setUserData({ surface: 'prop', tile: this.key }));
    const c = p.world.createCollider(desc.setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }).setFriction(0.8), this.body);
    p.addTileColliders(this.key, [c], 'prop');
    this.count++;
  }

  dispose(): void {
    this.ctx.physics.removeTileColliders(this.key);
    this.body = null; this.count = 0;
  }
}
