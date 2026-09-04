/**
 * Character module: local player (controller + third-person camera + model), remote players, pedestrians,
 * weapon attachment, footsteps. See docs/MODULE_APIS.md (CharacterModule).
 */
import * as THREE from 'three';
import type { GameContext, GameModule } from '@/core/context';
import type { AtmosphereLike, VehiclesLike, StreetsLike, EnvironmentLike } from './contracts';
import { CharacterInstance, disposeAllGeometry, viewPoint } from './animator';
import type { CombatModule } from '@/combat';
import { LocalController } from './controller';
import { ThirdPersonCamera } from './camera';
import { RemoteManager, weaponKind } from './remotes';
import { PedManager } from './peds';
import { localAppearance, setCrowdConditions } from './appearance';
import { getClips } from './clips';
import { loadCharacterAssets, characterAssetStatus, disposeCharacterAssets } from './assets';

export interface CharacterModule extends GameModule {
  /** world-space hand bone matrix of the local player (for weapon attachment); null while loading */
  rightHandMatrix(): THREE.Matrix4 | null;
  /** world position of a player's head (local id or remote id) */
  headPosition(id: number, out: THREE.Vector3): THREE.Vector3 | null;
  /** attach/detach a weapon mesh to the local or remote player's hand (combat module builds the mesh) */
  setWeaponMesh(playerId: number, mesh: THREE.Object3D | null): void;
  /** trigger the fire/reload/punch animation on a player */
  playAction(playerId: number, action: 'fire' | 'reload' | 'punch' | 'hitReact'): void;
  /** the local player's model root (for spawn-protection shader, hiding in vehicles) */
  localModel(): THREE.Object3D | null;
  remoteModel(id: number): THREE.Object3D | null;
}

export async function createCharacter(ctx: GameContext): Promise<CharacterModule> {
  const atmo = ctx.modules.get('atmosphere') as AtmosphereLike | undefined;
  // Sign spill / shop-window fill (rgb, strength). The crowd's own lighting floor after dark: without it a
  // Midtown pavement at 22:30 is a row of black cut-outs, because the only real lights are 9 m overhead and
  // every sign is an emissive surface rather than a light. See docs/ART_DIRECTION.md 2 (night).
  const uFill = { value: new THREE.Vector4(1.0, 0.8, 0.62, 0) };
  const shared = {
    uTime: atmo?.uniforms?.uTime ?? { value: 0 },
    uWetness: atmo?.uniforms?.uWetness ?? { value: 0 },
    uFill,
    setupMaterial: (m: THREE.Material) => atmo?.setupMaterial?.(m),
  };
  const ownTime = shared.uTime === (atmo?.uniforms?.uTime ?? null) ? null : shared.uTime;

  // clips are generated once (~2 ms)
  getClips();
  await loadCharacterAssets();

  const group = new THREE.Group();
  group.name = 'characters';
  ctx.worldGroup.add(group);

  const st = ctx.state;
  const local = new CharacterInstance(localAppearance(st.local.name), shared);
  local.root.name = 'localPlayer';
  group.add(local.root);
  const controller = new LocalController(ctx, local);
  const camera = new ThirdPersonCamera(ctx);
  camera.snapBehind(st.local.state.yaw);

  const surfaceAt = (x: number, z: number): string => {
    const streets = ctx.modules.get('streets') as StreetsLike | undefined;
    const s = streets?.surfaceAt?.(x, z);
    if (s) return s;
    const env = ctx.modules.get('environment') as EnvironmentLike | undefined;
    const e = env?.surfaceAt?.(x, z);
    if (e && e !== 'ground') return e;
    return 'concrete';
  };

  const remotes = new RemoteManager(ctx, group, shared, surfaceAt);
  const peds = new PedManager(ctx, group, shared);

  // ---- events ----
  const offs: (() => void)[] = [];
  let weaponKindLocal: 'none' | 'pistol' | 'rifle' = 'none';
  let seated = false;
  const seatOffset = new THREE.Matrix4().makeTranslation(0, -0.9, 0.06);
  const footPos = new THREE.Vector3();
  let lastLocalFoot = -1;

  local.onFootstep = () => {
    const now = ctx.now ?? 0;
    if (now - lastLocalFoot < 0.12) return;
    lastLocalFoot = now;
    const s = st.local.state;
    ctx.events.emit('footstep', footPos.set(s.x, s.y, s.z), surfaceAt(s.x, s.z), true);
  };

  offs.push(
    ctx.events.on('localRespawn', () => {
      controller.sync();
      local.play('idle', 0.05, true);
      local.aimTarget = 0;
      camera.snapBehind(st.local.state.yaw);
      camera.regain(false);
    }),
  );
  offs.push(
    ctx.events.on('localDeath', () => {
      local.play('death', 0.1, true);
      local.aimTarget = 0;
    }),
  );
  offs.push(
    ctx.events.on('death', (msg) => {
      if (msg.victimId !== st.local.id) remotes.get(msg.victimId)?.play('death', 0.12, true);
    }),
  );
  offs.push(
    ctx.events.on('hit', (msg) => {
      if (msg.damage <= 0) return;
      if (msg.victimId === st.local.id) local.action('hitReact');
      else remotes.action(msg.victimId, 'hitReact');
    }),
  );
  offs.push(ctx.events.on('localFire', () => local.action('fire')));
  offs.push(ctx.events.on('remoteFire', (id) => remotes.action(id, 'fire')));
  offs.push(
    ctx.events.on('exitedVehicle', () => {
      seated = false;
      local.root.matrixAutoUpdate = true;
      controller.sync();
      camera.regain(true);
    }),
  );
  offs.push(
    ctx.events.on('enteredVehicle', () => {
      seated = true;
    }),
  );

  // ---- debug hook for tests ----
  let benchmarkResult: unknown = null;
  let benchmarking = false;
  let autoBenchmarkStarted = false;
  const autoBenchmark = new URLSearchParams(location.search).get('characterBenchmark') === '1';
  async function benchmark() {
    if (benchmarking) return benchmarkResult;
    benchmarking = true;
    peds.benchmarking = true;
    const before: number[] = [], after: number[] = [], deltas: number[] = [];
    const gl = ctx.renderer.getContext();
    const sample = (imported: boolean) => {
      peds.setImported(imported); local.setImported(imported);
      gl.finish();
      const start = performance.now();
      peds.benchmarkAnimation(); local.update(1 / 60, true);
      if (ctx.composer) ctx.composer.render(1 / 60);
      else ctx.renderer.render(ctx.scene, ctx.camera);
      gl.finish(); // include GPU completion, not just command submission
      return performance.now() - start;
    };
    const median = (a: number[]) => [...a].sort((a,b) => a-b)[Math.floor(a.length/2)];
    try {
      for (let i = 0; i < 32; i++) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        let a: number, b: number;
        if (i % 2) { b = sample(true); a = sample(false); }
        else { a = sample(false); b = sample(true); }
        if (i >= 8) { before.push(a); after.push(b); deltas.push(b - a); }
      }
      benchmarkResult = { method: 'alternating same-scene animation + composer, GPU finish; 8 warmup pairs, 24 sample pairs',
        peds: peds.count(), beforeMs: +median(before).toFixed(3), afterMs: +median(after).toFixed(3), deltaMs: +median(deltas).toFixed(3),
        within2ms: median(deltas) <= 2, samples: { before, after } };
      return benchmarkResult;
    } finally { peds.setImported(true); local.setImported(true); peds.benchmarking = false; benchmarking = false; }
  }
  const debug = {
    orbit(dx: number, dy: number) {
      camera.injectLook.dx += dx;
      camera.injectLook.dy += dy;
    },
    forceAim: null as boolean | null,
    forceMove: null as { x: number; y: number } | null,
    forceSprint: null as boolean | null,
    stats() {
      return { peds: peds.count(), lanes: peds.laneCount(), ...peds.spawnStats(), remotes: remotes.debugStats(), anim: local.state, speed: controller.speed, grounded: controller.grounded, camYaw: camera.yaw, camPitch: camera.pitch, fov: ctx.camera.fov };
    },
    assets: characterAssetStatus,
    benchmark,
    crowd: () => peds.visualStats(),
    local: () => ({ mesh: local.imported?.id ?? 'procedural', state: local.state }),
  };
  (window as any).__character = debug;
  const originalStats = (window as any).__stats;
  (window as any).__stats = () => ({ ...originalStats?.(), character: debug.stats(), crowd: peds.visualStats(), characterBenchmark: benchmarkResult, characterAssets: characterAssetStatus });

  const headOut = new THREE.Vector3();
  const handMat = new THREE.Matrix4();
  const camDir = new THREE.Vector3();
  const seatMat = new THREE.Matrix4();

  const mod: CharacterModule = {
    name: 'character',
    update(dt) {
      if ((window as any).__game) (window as any).__game.character = debug;
      if (autoBenchmark && !autoBenchmarkStarted && (window as any).__ready && peds.count() >= peds.maxPeds) {
        autoBenchmarkStarted = true;
        void benchmark();
      }
      if (ownTime) ownTime.value += dt;
      const s = st.local.state;
      const inp = ctx.input;
      const screenshot = st.screenshotMode;
      const inVehicle = st.local.vehicleKey !== null;
      // a cool back light on the hero at night (street LED from behind the camera's shoulder) so the dark jacket
      // separates from a dark street; a faint trace by day
      const night = atmo?.uniforms?.uNight?.value ?? 0;
      local.rim.value.w = 0.02 + 0.2 * night;
      // near-LOD radius is measured from the camera, not the player
      viewPoint.copy(ctx.camera.position);
      uFill.value.w = 0.14 * night;
      const condition = st.weather?.condition ?? '';
      setCrowdConditions({ rain: /rain|thunder/.test(condition), night: night > 0.5 });

      // debug overrides (tests drive input without pointer lock)
      if (debug.forceMove && !screenshot) {
        inp.move.x = debug.forceMove.x;
        inp.move.y = debug.forceMove.y;
      }
      if (debug.forceSprint !== null && !screenshot) inp.sprint = debug.forceSprint;
      const aiming = !screenshot && !st.local.dead && !inVehicle && (debug.forceAim ?? inp.aim);

      if (inVehicle) {
        // sit on the driver seat; the vehicles module owns camera + state
        const veh = ctx.modules.get('vehicles') as VehiclesLike | undefined;
        const m = veh?.driverSeatMatrix?.();
        if (m) {
          seated = true;
          local.root.visible = true;
          local.root.matrixAutoUpdate = false;
          seatMat.copy(m).multiply(seatOffset);
          const sc = local.appearance.height / 1.8;
          seatMat.scale(new THREE.Vector3(sc, sc, sc));
          local.root.matrix.copy(seatMat);
          local.root.matrixWorldNeedsUpdate = true;
        } else local.root.visible = false;
        local.play('drive', 0.2);
        local.aimTarget = 0;
        local.lookWeight = 0;
        local.update(dt, true);
        if (inp.interact) ctx.events.emit('interact');
        // Ambient life and remote players must keep updating while we drive.
        remotes.update(dt);
        peds.update(dt);
        return;
      }
      if (seated) {
        seated = false;
        local.root.matrixAutoUpdate = true;
        local.root.visible = true;
      }

      // ---- movement ----
      controller.update(dt, { camYaw: camera.yaw, camPitch: camera.pitch, aiming, weapon: weaponKindLocal });
      local.root.position.set(s.x, s.y, s.z);
      local.root.rotation.y = s.yaw;

      // ---- animation ----
      local.speed = controller.speed;
      if (!st.local.dead) {
        const anim = controller.animState;
        if (anim === 'jumpStart' || anim === 'land') {
          // one-shots were started by the controller; do not restart them
          if (local.state !== anim) local.play(anim, 0.06, true);
        } else local.play(anim, anim === 'idle' && local.state === 'run' ? 0.28 : 0.16);
        weaponKindLocal = weaponKind(s.weapon);
        local.weapon = weaponKindLocal;
        // Combat holds the weapon up after hip fire; only RMB owns ADS movement/camera.
        const weaponRaised = !screenshot && (aiming || (ctx.modules.get('combat') as CombatModule | undefined)?.aiming());
        local.aimTarget = weaponRaised ? 1 : weaponKindLocal !== 'none' ? 0.65 : 0;
        local.aimPitch = camera.pitch;
        // subtle head look toward where the camera looks (relative to the body)
        if (!weaponRaised) {
          let rel = camera.yaw - s.yaw;
          while (rel > Math.PI) rel -= 2 * Math.PI;
          while (rel < -Math.PI) rel += 2 * Math.PI;
          local.lookYaw = THREE.MathUtils.clamp(rel, -1.0, 1.0);
          local.lookPitch = camera.pitch * 0.6;
          local.lookWeight = controller.speed > 6.5 ? 0.35 : 0.7;
        } else local.lookWeight = 0;
        if (inp.reload && !screenshot && s.weapon !== 0) local.action('reload');
        if (inp.firePressed && !screenshot && s.weapon === 0) local.action('punch');
      }
      local.update(dt, true);
      // bone matrices current for combat / audio queries this frame
      local.root.updateMatrixWorld(true);

      // ---- camera ----
      if (!screenshot) {
        camera.update(dt, {
          x: s.x,
          y: s.y,
          z: s.z,
          yaw: s.yaw,
          scale: local.appearance.height / 1.8,
          speed: controller.speed,
          sprinting: controller.sprinting,
          aiming,
          crouching: controller.crouching,
          dead: st.local.dead,
          exclude: controller.body,
        });
        st.local.eye.copy(ctx.camera.position);
        ctx.camera.getWorldDirection(camDir);
        st.local.aimDir.copy(camDir);
        local.root.visible = true;
      } else {
        // core owns the camera; hide the body when the free camera stands where the player is
        const d = Math.hypot(ctx.camera.position.x - s.x, ctx.camera.position.z - s.z);
        local.root.visible = d > 2.2;
      }

      if (inp.interact && !screenshot && !(ctx.modules.get('combat') as CombatModule | undefined)?.interactPickup()) ctx.events.emit('interact');

      // ---- others ----
      remotes.update(dt);
      peds.update(dt);
    },

    rightHandMatrix() {
      const b = local.weaponObject?.parent ?? (local.rendersImported ? local.imported?.handSocket : local.bones.get('RightHand'));
      if (!b) return null;
      return handMat.copy(b.matrixWorld);
    },
    headPosition(id, out) {
      if (id === st.local.id) {
        const s = st.local.state;
        return RemoteManager.localHead(local, out, s, controller.crouching);
      }
      return remotes.headPosition(id, out);
    },
    setWeaponMesh(playerId, mesh) {
      if (playerId === st.local.id) local.setWeaponMesh(mesh);
      else remotes.get(playerId)?.setWeaponMesh(mesh);
    },
    playAction(playerId, action) {
      if (playerId === st.local.id) local.action(action);
      else remotes.action(playerId, action);
    },
    localModel() {
      return local.root;
    },
    remoteModel(id) {
      return remotes.get(id)?.root ?? null;
    },
    dispose() {
      for (const o of offs) o();
      remotes.dispose();
      peds.dispose();
      controller.dispose();
      local.dispose();
      ctx.worldGroup.remove(group);
      disposeAllGeometry();
      disposeCharacterAssets();
      (window as any).__stats = originalStats;
      if ((window as any).__game) delete (window as any).__game.character;
      delete (window as any).__character;
    },
  };
  void headOut;
  return mod;
}
