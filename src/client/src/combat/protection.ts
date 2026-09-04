import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { StateFlag } from '@shared/protocol';

/** Independent of character LOD/materials: protection must remain readable on imported rigs. */
export class ProtectionFx {
  readonly group = new THREE.Group();
  private geometry = new THREE.CapsuleGeometry(0.52, 1, 4, 12);
  private shields = new Map<number, { mesh: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshBasicMaterial>; flash: number }>();
  constructor(private ctx: GameContext) { this.group.name = 'protection-shields'; }
  flash(id: number): void { const shield = this.shields.get(id); if (shield) shield.flash = 0.35; }
  update(dt: number): void {
    const st = this.ctx.state;
    this.group.visible = !st.screenshotMode;
    for (const [id, remote] of st.remotes) {
      const s = remote.render, safe = st.safeZone;
      const protectedTarget = !(s.flags & StateFlag.Dead) && (!!(s.flags & StateFlag.Protected) || Math.hypot(s.x - safe.x, s.z - safe.z) <= safe.radius);
      let shield = this.shields.get(id);
      if (protectedTarget && !shield) {
        const mesh = new THREE.Mesh(this.geometry, new THREE.MeshBasicMaterial({ color: 0x69c8ff, transparent: true, opacity: 0.32, wireframe: true, depthWrite: false }));
        mesh.name = `protected-player-${id}`;
        this.group.add(mesh);
        shield = { mesh, flash: 0 };
        this.shields.set(id, shield);
      }
      if (!shield) continue;
      shield.mesh.visible = protectedTarget;
      shield.mesh.position.set(s.x, s.y + 1, s.z);
      shield.flash = Math.max(0, shield.flash - dt);
      shield.mesh.material.opacity = shield.flash > 0 ? 0.85 : 0.32;
    }
    for (const [id, shield] of this.shields) if (!st.remotes.has(id)) {
      shield.mesh.removeFromParent(); shield.mesh.material.dispose(); this.shields.delete(id);
    }
  }
  dispose(): void {
    for (const shield of this.shields.values()) shield.mesh.material.dispose();
    this.shields.clear(); this.geometry.dispose(); this.group.removeFromParent();
  }
}
