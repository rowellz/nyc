import * as THREE from 'three';
import type { GameContext } from './context';

/** Presentation guard only: never move the body or fabricate server health/death. */
export class DeathCameraGuard {
  private frozen = false;
  private position = new THREE.Vector3();
  private rotation = new THREE.Quaternion();

  update(ctx: GameContext): void {
    const { camera, state } = ctx;
    const local = state.local;
    const playing = !state.screenshotMode && !state.adminFlying;
    if (playing && state.welcomed && local.state.y < -3 && !local.dead && !local.fallPending) {
      local.fallPending = true;
      // Report the fatal altitude now, rather than waiting for the next state interval.
      ctx.net.sendState();
    }
    const falling = playing && (local.fallPending || (local.dead && local.state.y < -1));
    if (!falling) this.frozen = false;
    if (falling && this.frozen) {
      camera.position.copy(this.position);
      camera.quaternion.copy(this.rotation);
    }
    // All camera owners (including bridge hooks/free camera) share the hard lower bound.
    let floor = -1;
    if (playing) floor = 0.6;
    if (falling) floor = Math.max(floor, ctx.physics.groundHeight(camera.position.x, camera.position.z) + camera.near + 0.1);
    camera.position.y = Math.max(floor, camera.position.y);
    if (falling && !this.frozen) {
      this.position.copy(camera.position);
      this.rotation.copy(camera.quaternion);
      this.frozen = true;
    }
    camera.updateMatrixWorld();
  }
}
