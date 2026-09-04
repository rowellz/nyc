import * as THREE from 'three';
import { headingToYaw, yawToHeading, xzToLonLat } from '@shared/geo';
import { StateFlag } from '@shared/protocol';
import type { GameContext, GameModule } from './context';
import type { InputManager } from './input';
import type { PhysicsWorldImpl } from './physics';
import { FreeCamera, type ScreenshotHooks } from './screenshot';
import type { NetClientImpl } from './net';

export interface AdminTools extends GameModule {
  toggleFly(): void;
  teleport(x: number, z: number, heading?: number): void;
  setTime(value: string): void;
  setWeather(value: string): boolean;
  resetEnvironment(): void;
  copyLocation(): Promise<string>;
}

/** Camera ownership stays in core. Character/combat use their existing screenshot branches in the loop. */
export function createAdminTools(ctx: GameContext, shots: ScreenshotHooks): AdminTools {
  const st = ctx.state, input = ctx.input as InputManager;
  const physics = ctx.physics as PhysicsWorldImpl;
  let cam: FreeCamera | null = null;
  let disabledBodies: import('@dimforge/rapier3d-compat').RigidBody[] = [];
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  function finishFlight(): void {
    if (!cam) return;
    const p = ctx.camera.position, s = st.local.state;
    s.x = p.x; s.z = p.z; s.y = physics.groundHeight(p.x, p.z); s.yaw = cam.yaw;
    s.vx = s.vy = s.vz = 0;
    s.flags &= ~(StateFlag.Airborne | StateFlag.Firing | StateFlag.Aiming);
    // Place on ground server-side before the ordinary movement speed cap resumes.
    if (st.admin) ctx.net.send({ t: 'adminTeleport', x: s.x, y: s.y, z: s.z, yaw: s.yaw });
    for (const body of disabledBodies) if (body.isValid()) body.setEnabled(true);
    disabledBodies = [];
    cam.dispose(); cam = null;
    input.flying = false;
    ctx.events.emit('localRespawn');
  }
  const mod: AdminTools = {
    name: 'adminTools',
    toggleFly() {
      if (!st.admin || !st.welcomed || st.local.dead || st.screenshotMode) return;
      ctx.net.send({ t: 'adminFly', enabled: !st.adminFlying });
    },
    teleport(x, z, heading) {
      if (!st.admin || !st.welcomed) return;
      if (![x, z].every(Number.isFinite) || x < -7000 || x > 9000 || z < -17000 || z > 11000) throw new Error('That location is outside the city.');
      const s = st.local.state;
      s.x = x; s.z = z; s.y = cam ? ctx.camera.position.y : physics.groundHeight(x, z);
      if (heading !== undefined) s.yaw = headingToYaw(heading);
      s.vx = s.vy = s.vz = 0;
      if (cam) cam.place(x, s.y, z, heading ?? yawToHeading(cam.yaw), THREE.MathUtils.radToDeg(cam.pitch));
      ctx.net.send({ t: 'adminTeleport', x, y: s.y, z, yaw: s.yaw });
      ctx.world.focus?.set(x, s.y, z);
      ctx.events.emit('localRespawn');
    },
    setTime(value) { if (st.admin) shots.setTime(value); },
    setWeather(value) { return !!st.admin && shots.setWeather(value); },
    resetEnvironment() {
      if (!st.admin) return;
      ctx.time.frozen = false;
      const net = ctx.net as NetClientImpl;
      net.weatherLocked = false;
      if (net.latestWeather) { st.weather = net.latestWeather; ctx.events.emit('weather', st.weather); }
      if (net.latestDayFraction !== null) ctx.time.setFraction?.(net.latestDayFraction);
    },
    async copyLocation() {
      if (!st.admin) throw new Error('Admin login required');
      const p = ctx.camera.position, ll = xzToLonLat(p.x, p.z);
      euler.setFromQuaternion(ctx.camera.quaternion, 'YXZ');
      const text = `${ll.lat.toFixed(6)}, ${ll.lon.toFixed(6)}, heading ${yawToHeading(euler.y).toFixed(1)}°`;
      await navigator.clipboard.writeText(text);
      return text;
    },
    update(dt) {
      if (st.local.dead && st.adminFlying) {
        st.adminFlying = false;
        ctx.net.send({ t: 'adminFly', enabled: false });
      }
      if (!st.admin || !st.adminFlying || st.local.dead || !st.welcomed) { finishFlight(); return; }
      if (!cam) {
        cam = new FreeCamera(ctx.camera, input, ctx.canvas!, { pointerLock: true, heightSpeed: true, active: () => !st.menuOpen });
        input.flying = true;
        st.local.vehicleKey = null;
        st.local.state.vehicleId = 0;
        // The local capsule is tagged by the existing controller; no character internals needed.
        physics.world.forEachRigidBody(body => {
          if ((body.userData as { local?: boolean } | undefined)?.local && body.isEnabled()) { body.setEnabled(false); disabledBodies.push(body); }
        });
      }
      if (!st.menuOpen) cam.update(dt);
      const p = ctx.camera.position, s = st.local.state;
      p.x = THREE.MathUtils.clamp(p.x, -7000, 9000);
      p.z = THREE.MathUtils.clamp(p.z, -17000, 11000);
      p.y = THREE.MathUtils.clamp(p.y, -20, 700);
      s.x = p.x; s.y = p.y; s.z = p.z; s.yaw = cam.yaw; s.pitch = cam.pitch;
      s.vx = s.vy = s.vz = 0;
      s.flags = (s.flags & StateFlag.Protected) | StateFlag.Airborne;
      st.local.eye.copy(p);
      ctx.camera.getWorldDirection(st.local.aimDir);
      ctx.world.focus?.copy(p);
    },
    dispose() { finishFlight(); },
  };
  return mod;
}
