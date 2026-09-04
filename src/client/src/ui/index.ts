/**
 * ui module: HTML/CSS overlay in ctx.uiRoot + canvas minimap. Owns name entry, HUD, leaderboard, death
 * screen, update banner, full map, loading screen and the pause menu. Never depends on another module
 * existing: everything it reads from combat/vehicles is optional-chained with a ctx.state fallback.
 *
 * Overlay state machine: none | name | pause | map | death (loading runs alongside, before any of them).
 * Pointer lock: releasing it with Esc opens the pause menu; map/name/death release it themselves.
 */
import * as THREE from 'three';
import type { GameContext, GameModule } from '@/core/context';
import { parseParams } from '@/core/params';
import { isNewerVersion, type NetClientImpl } from '@/core/net';
import type { AdminTools } from '@/core/admin';
import { StateFlag, type LeaderboardEntry } from '@shared/protocol';
import { WEAPONS } from '@shared/weapons';
import { LANDMARKS } from '@shared/constants';
import { lonLatToXZ } from '@shared/geo';
import { SPOTS } from '@/core/spots';
import { TouchControls } from './touch';
import type { InputManager } from '@/core/input';
import { injectStyles } from './styles';
import { Hud, weaponGlyph, type ToastKind } from './hud';
import { Minimap } from './minimap';
import { AreaIndex } from './areas';
import { LeaderboardPanel } from './leaderboard';
import { FullMap } from './fullMap';
import { DeathScreen, LoadingScreen, NameEntry, PauseMenu, UpdateBanner, type JumpItem } from './screens';
import { headingOf } from './mapDraw';

export interface UiModule extends GameModule {
  toast(text: string, kind?: 'info' | 'score' | 'discover' | 'warn'): void;
  /** bottom-center interaction prompt; null hides */
  prompt(text: string | null): void;
  /** current street + neighborhood shown under the minimap */
  location(): { street: string | null; area: string | null };
}

interface CombatLike {
  spreadDeg?(): number;
  aiming?(): boolean;
  weaponStatus?(): { name: string; id: number; mag: number; ammo: number; reloading: boolean } | null;
}
interface VehiclesLike {
  driving?(): { speed: number } | null;
}

type Overlay = 'none' | 'name' | 'pause' | 'map' | 'death';

const MPH = 2.236936;
const MINOR = new Set(['footway', 'steps', 'cycleway', 'pedestrian', 'service']);

function distToPolyline(x: number, z: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0], az = pts[i - 1][1], bx = pts[i][0], bz = pts[i][1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const px = ax + dx * t - x, pz = az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
const _dir = new THREE.Vector3();

export async function createUi(ctx: GameContext): Promise<UiModule> {
  injectStyles();
  const params = parseParams();
  const st = ctx.state;
  const canvas = ctx.canvas ?? (document.getElementById('game') as HTMLCanvasElement | null);
  const baseUrl = (ctx.world as { baseUrl?: string }).baseUrl ?? params.world;

  const root = document.createElement('div');
  root.id = 'nyc';
  if (params.nohud && st.screenshotMode) root.dataset.hud = 'off';
  ctx.uiRoot.appendChild(root);

  // ---- pieces ---------------------------------------------------------------------------------
  const input = ctx.input as InputManager;
  const touch = new TouchControls(root, input);
  const hud = new Hud(root);
  const minimap = new Minimap(ctx);
  hud.minimapSlot.appendChild(minimap.canvas);
  const areas = new AreaIndex();
  void areas.load(baseUrl);
  const lb = new LeaderboardPanel();
  root.appendChild(lb.el);
  const fullMap = new FullMap(ctx, baseUrl);
  root.appendChild(fullMap.el);
  const banner = new UpdateBanner(root, !st.screenshotMode);
  const loading = new LoadingScreen(root);
  const nameEntry = new NameEntry(root, onNameSubmit);
  const death = new DeathScreen(root, onRespawnClick);
  const admin = ctx.modules.get('adminTools') as AdminTools | undefined;
  const net = ctx.net as NetClientImpl;
  banner.show(st.latestVersion, net.mustUpdate); // welcome can arrive before UI modules finish loading
  const pause = new PauseMenu(root, ctx.quality.level, resume, jumpTo, admin);
  const adminChip = document.createElement('span');
  adminChip.className = 'admin-chip'; adminChip.textContent = 'ADMIN'; adminChip.hidden = !st.admin;
  hud.tc.appendChild(adminChip);

  // ---- state ----------------------------------------------------------------------------------
  let overlay: Overlay = 'none';
  let loadingActive = false;
  let needName = !st.screenshotMode && !st.local.token;
  let gameplayLock = false;
  let statsVisible = true;
  let lbPinned = false;
  let lbDirty = true;
  let lastYou: LeaderboardEntry | null = null;
  let lastLbRequest = -Infinity;
  let locAcc = 0.4;
  let statsAcc = 0;
  let street: string | null = null;
  let area: string | null = null;
  let promptText: string | null = null;
  let lastDeathWeapon = 0;
  let welcomeShown = false;
  let everWelcomed = false;
  const combatHudPresent = () => !!document.getElementById('combat-hud');

  // Core owns the full scene-ready gate, including outstanding mesh/collider builds.
  // Do not hide its recovery controls or replace it with a decoded-tiles-only gate.
  const coreLoading = document.getElementById('loading');
  if (coreLoading ? !coreLoading.hidden : !ctx.world.ready) {
    loadingActive = true;
    if (!coreLoading) loading.show();
  }
  if (st.latestVersion && isNewerVersion(st.latestVersion, st.version)) banner.show(st.latestVersion);

  // ---- pointer lock + overlays ------------------------------------------------------------------
  function locked(): boolean {
    return !!canvas && document.pointerLockElement === canvas;
  }
  function requestLock(direct = false): void {
    if (st.screenshotMode || input.touch || !canvas || locked()) return;
    input.requestLock(direct);
  }
  function releaseLock(): void {
    // Disarm BEFORE exitPointerLock: its event may arrive after a respawn or a Resume click.
    gameplayLock = false;
    input.releaseLock();
  }
  function go(o: Overlay): void {
    if (overlay === o && o !== 'name') return;
    overlay = o;
    st.menuOpen = o !== 'none';
    (ctx.input as { enabled?: boolean }).enabled = o === 'none' && !st.screenshotMode;
    if (o !== 'none') input.releaseAll();
    if (o !== 'name') nameEntry.hide();
    if (o !== 'pause') pause.hide();
    if (o !== 'map') fullMap.hide();
    if (o !== 'death') {
      death.hide();
      if (lb.el.parentElement !== root) root.appendChild(lb.el);
      lb.setHint('Hold TAB');
      lb.setMode('full');
    }
    switch (o) {
      case 'name':
        releaseLock();
        nameEntry.show();
        nameEntry.setError(net.registrationError);
        break;
      case 'pause':
        releaseLock();
        if (st.admin && !st.screenshotMode) pause.setJump(jumpItems());
        pause.setAdminAllowed(!!st.admin, !!st.adminFlying);
        pause.show();
        break;
      case 'map':
        releaseLock();
        fullMap.show();
        break;
      case 'death':
        releaseLock();
        break;
      case 'none':
        break;
    }
  }
  fullMap.onClose = () => {
    if (overlay === 'map') go('none');
  };
  function resume(): void {
    // A teleport/respawn may already have closed pause in this same click handler.
    if (overlay !== 'pause' && overlay !== 'none') return;
    go('none');
    requestLock(true);
  }
  function onNameSubmit(name: string, email: string, newsletter: boolean): void {
    net.register(name, email, newsletter);
    needName = false;
    nameEntry.clear();
    go('none');
    // The next canvas click enters pointer lock after the server has welcomed us.
  }
  function showDeath(killer: string, weapon = 0, pending = false): void {
    go('death');
    const wname = weapon ? WEAPONS[weapon]?.name ?? null : null;
    const where = street ? `on ${street}${area ? ` · ${area}` : ''}` : area ? `in ${area}` : null;
    death.show(killer, st.local.score, { weapon: wname, glyph: wname ? weaponGlyph(weapon) : null, where }, pending);
    death.slot.appendChild(lb.el);
    lb.setHint('Your score is still on the board');
    lb.setMode('death');
    lbDirty = true;
    requestLeaderboard(true);
  }
  /** teleport (pause menu "Jump to"): face the spot's heading, land on the ground, back into the game */
  function jumpTo(it: JumpItem): void {
    if (!st.admin || !admin) return;
    admin.teleport(it.x, it.z, it.heading);
    resume();
  }
  let jumpCache: JumpItem[] | null = null;
  let jumpCacheAreas = false;
  function jumpItems(): JumpItem[] {
    if (jumpCache && jumpCacheAreas) return jumpCache;
    const items: JumpItem[] = [];
    const seen = new Set<string>();
    let anyArea = false;
    const sub = (x: number, z: number) => {
      const a = areas.nameAt(x, z);
      if (a) anyArea = true;
      return a ?? 'Manhattan';
    };
    for (const sp of SPOTS) {
      if (/^(aerial|skyline)-/.test(sp.id)) continue; // camera-only vantage points: mid-air or on the river
      const name = sp.name.split(/,| looking | from /)[0].trim();
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const { x, z } = lonLatToXZ(sp.lon, sp.lat);
      items.push({ name, sub: sub(x, z), x, z, heading: sp.heading });
    }
    for (const lm of LANDMARKS) {
      if (seen.has(lm.name.toLowerCase())) continue;
      seen.add(lm.name.toLowerCase());
      items.push({ name: lm.name, sub: sub(lm.x, lm.z), x: lm.x, z: lm.z });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    jumpCache = items;
    jumpCacheAreas = anyArea;
    return items;
  }
  function onRespawnClick(): void {
    ctx.net.send({ t: 'respawn' });
    if (!st.local.dead) go('none'); // test path (window.__ui.showDeath) or a stale screen
    requestLock(true);
  }
  function requestLeaderboard(force = false): void {
    const now = performance.now() / 1000;
    if (!force && now - lastLbRequest < 1) return;
    lastLbRequest = now;
    ctx.net.send({ t: 'leaderboard' });
  }

  const onLockChange = () => {
    const isLocked = locked();
    const lostGameplayLock = gameplayLock && !isLocked;
    gameplayLock = isLocked;
    if (lostGameplayLock && !input.touch && overlay === 'none' && !st.local.dead && !st.screenshotMode && !loadingActive && !needName) go('pause');
  };
  document.addEventListener('pointerlockchange', onLockChange);
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && (e.target.matches('input,textarea,select') || e.target.isContentEditable)) return;
    if (e.code === 'F5' && st.admin) {
      e.preventDefault();
      if (!e.repeat) admin?.toggleFly();
      return;
    }
    if (e.code === 'F3') {
      statsVisible = !statsVisible;
      e.preventDefault();
      return;
    }
    // Gameplay input is intentionally disabled while the map is open. Handle its close
    // shortcut at the overlay boundary, and consume the edge so it cannot reopen next frame.
    if (e.code === 'KeyM' && overlay === 'map' && !e.repeat) {
      e.preventDefault();
      input.releaseAll();
      go('none');
      requestLock();
      return;
    }
    if (e.code === 'Escape') {
      if (overlay === 'map') {
        go('none');
        requestLock();
      } else if (overlay === 'none' && !locked() && !st.local.dead && !needName && !loadingActive && !st.screenshotMode) go('pause');
      else if (overlay === 'name' && !needName) go('none');
    }
    // T: pause menu straight onto "Jump to" (play mode only)
    if (st.admin && e.code === 'KeyT' && overlay === 'none' && !st.screenshotMode && !needName && !loadingActive && !st.local.dead) {
      go('pause');
      pause.focusJump();
    }
  };
  window.addEventListener('keydown', onKey);

  // ---- events ---------------------------------------------------------------------------------
  const off: (() => void)[] = [
    ctx.events.on('score', (m) => {
      hud.setScore(m.score);
      hud.popScore(m.delta, m.reason);
    }),
    // 'death' fires just before its 'feed' line: remember the weapon so the feed row can show its glyph
    ctx.events.on('death', (m) => {
      lastDeathWeapon = m.weapon;
    }),
    ctx.events.on('feed', (text, kind) => {
      hud.feed(text, kind, kind === 'kill' ? lastDeathWeapon : undefined);
      lastDeathWeapon = 0;
    }),
    ctx.events.on('discover', (m) => hud.toast(m.name, 'discover', m.first ? `First to find · +${m.delta}` : `${m.kind === 'landmark' ? 'Landmark' : 'Neighborhood'} · +${m.delta}`)),
    ctx.events.on('hit', (m) => {
      if (m.damage <= 0) return;
      if (combatHudPresent()) return; // combat draws its own marker + arcs
      if (m.shooterId === st.local.id && m.victimId !== st.local.id) hud.hitMarker(m.headshot);
      if (m.victimId === st.local.id) {
        const shooter = st.remotes.get(m.shooterId)?.render;
        const p = st.local.state;
        const sx = shooter ? shooter.x : m.x, sz = shooter ? shooter.z : m.z;
        ctx.camera.getWorldDirection(_dir);
        const rel = headingOf(sx - p.x, sz - p.z) - headingOf(_dir.x, _dir.z);
        hud.damageFrom(rel);
      }
    }),
    ctx.events.on('localDeath', (killer, weapon) => showDeath(killer, weapon)),
    ctx.events.on('localRespawn', () => {
      hud.setScore(st.local.score, true);
      if (overlay === 'death' || overlay === 'pause') {
        go('none');
        // Never request lock from this network callback. The Respawn click already requested it;
        // hook/server respawns without a gesture still resume, with a click-to-lock hint.
      }
    }),
    ctx.events.on('leaderboard', (m) => {
      lastYou = m.you;
      lbDirty = true;
    }),
    ctx.events.on('versionAvailable', (v, required) => banner.show(v, required)),
  ];

  // ---- per-frame helpers ------------------------------------------------------------------------
  function weaponFallback(): { name: string; mag: number; ammo: number; reloading: boolean } | null {
    const inv = st.local.inventory;
    const id = inv?.current ?? st.local.state.weapon;
    if (!id) return null;
    const def = WEAPONS[id];
    const slot = inv?.weapons?.find((w) => w.id === id);
    return { name: def?.name ?? `Weapon ${id}`, mag: slot?.mag ?? 0, ammo: slot?.ammo ?? 0, reloading: false };
  }

  function updateLocation(): void {
    const p = st.screenshotMode ? ctx.camera.position : st.local.state;
    const s = nearestStreetName(p.x, p.z);
    const a = areas.nameAt(p.x, p.z);
    if (s !== street || a !== area) {
      street = s;
      area = a;
      hud.setLocation(street, area);
    }
  }

  function updateLoading(): void {
    if (!loadingActive) return;
    if (coreLoading ? coreLoading.hidden : ctx.world.ready && !(ctx.busy ?? 0)) {
      loadingActive = false;
      loading.hide();
      if (needName) go('name');
      return;
    }
    const n = ctx.world.tiles.size;
    const idx = ctx.world.index;
    const text = idx ? `streaming the city · ${n} tile${n === 1 ? '' : 's'}` : (ctx.world as { indexError?: string | null }).indexError ? 'no world data' : 'fetching the city index';
    loading.setProgress(0.15 + 0.85 * Math.min(1, n / 9), text);
  }

  /** nearest NAMED street (footways, steps and service lanes do not count as "where you are") */
  function nearestStreetName(x: number, z: number): string | null {
    const nr = ctx.world.nearestRoad(x, z, 150);
    if (nr?.road?.name && !MINOR.has(nr.road.cls)) return nr.road.name;
    let best: string | null = null;
    let bestD = 150;
    for (const r of ctx.world.roadsNear(x, z, 150)) {
      if (!r.name || MINOR.has(r.cls) || r.tunnel) continue;
      const d = distToPolyline(x, z, r.pts);
      if (d < bestD) {
        bestD = d;
        best = r.name;
      }
    }
    return best;
  }

  // ---- module -----------------------------------------------------------------------------------
  const mod: UiModule = {
    name: 'ui',
    preRender() {
      // Core predicts fatal altitude after character update; cover this very frame, before
      // network confirmation. The real localDeath event supplies the authoritative details.
      if (st.local.fallPending && !st.local.dead && overlay !== 'death') showDeath('You drowned', 0, true);
    },
    update(dt, t) {
      const L = st.local;
      if (!st.welcomed) welcomeShown = false;
      const touchActive = !!(input.touch && overlay === 'none' && !loadingActive && st.welcomed && !net.interrupted && !L.dead && !st.screenshotMode);
      touch.update(touchActive);
      minimap.setCompact(touchActive);
      needName = !st.screenshotMode && net.registrationNeeded;
      adminChip.hidden = !st.admin;
      adminChip.textContent = st.adminFlying ? 'ADMIN · FLY' : 'ADMIN';
      pause.setAdminAllowed(!!st.admin, !!st.adminFlying);
      if (overlay === 'name') nameEntry.setError(net.registrationError);
      hud.update(dt);
      updateLoading();
      if (loadingActive) return;
      if (st.welcomed && !welcomeShown && !st.screenshotMode) {
        hud.toast(everWelcomed ? `Reconnected as ${L.name}` : `Welcome to New York, ${L.name}`, 'info');
        welcomeShown = everWelcomed = true;
      }
      if (needName && overlay === 'none') go('name');

      // toggles
      if (ctx.input.map && !L.dead) {
        if (overlay === 'none') go('map');
        else if (overlay === 'map') {
          go('none');
          requestLock();
        }
      }
      const wantLb = overlay === 'death' || lbPinned || (overlay === 'none' && ctx.input.leaderboard);
      if (wantLb && !lb.isVisible) {
        lb.show();
        lbDirty = true;
        requestLeaderboard();
      } else if (!wantLb && lb.isVisible) lb.hide();
      if (lb.isVisible && lbDirty) {
        lbDirty = false;
        let you = lastYou;
        if (!you && L.name) you = st.leaderboard.find((e) => e.name === L.name) ?? null;
        lb.render(st.leaderboard, you, st.online, L.name, L.score, st.era);
      }

      const hudOn = overlay === 'none';
      hud.setVisible(hudOn);
      if (!hudOn) {
        hud.setCrosshair(false, 0);
        return;
      }

      // vitals
      hud.setHealth(L.state.health, L.armor);
      hud.setScore(L.score);
      hud.setOnline(st.online);
      const prot = (L.state.flags & StateFlag.Protected) !== 0 && !L.dead;
      const protLeft = prot ? Math.max(0, L.protectedUntil - st.serverTime()) : null;
      const sz = st.safeZone;
      const inSafe = Math.hypot(L.state.x - sz.x, L.state.z - sz.z) <= sz.radius;
      hud.setChips(protLeft, inSafe);

      // weapon / vehicle
      const combat = ctx.modules.get('combat') as CombatLike | undefined;
      const vehicles = ctx.modules.get('vehicles') as VehiclesLike | undefined;
      const drv = vehicles?.driving?.() ?? null;
      const driving = drv ? true : !!L.vehicleKey;
      let groundSpeed = 0;
      if (driving) {
        const sp = drv ? drv.speed : Math.hypot(L.state.vx, L.state.vz);
        groundSpeed = Math.abs(sp);
        hud.setSpeed(groundSpeed * MPH);
      } else {
        hud.setSpeed(null);
        hud.setWeapon(L.dead ? null : combat?.weaponStatus?.() ?? weaponFallback());
      }

      // crosshair
      const armed = L.inventory.current !== 0;
      if (armed && !driving && !L.dead && !st.screenshotMode) {
        const spread = combat?.spreadDeg?.() ?? 2;
        const fov = (ctx.camera.fov * Math.PI) / 180;
        const gap = 5 + (Math.tan((spread * Math.PI) / 180) / Math.tan(fov / 2)) * (window.innerHeight / 2);
        hud.setCrosshair(true, gap);
      } else hud.setCrosshair(false, 0);

      // location (2.5 Hz) + stats (2 Hz)
      locAcc += dt;
      if (locAcc >= 0.4) {
        locAcc = 0;
        updateLocation();
      }
      statsAcc += dt;
      if (statsAcc >= 0.5) {
        statsAcc = 0;
        hud.setStats(statsVisible ? `${st.ping} ms · ${Math.round(ctx.stats.fps)} fps` : null);
      }
      hud.showClickHint(!input.touch && !net.interrupted && !st.screenshotMode && !locked() && !L.dead && !lb.isVisible);
      minimap.update(dt, t, groundSpeed);
    },
    toast(text, kind: ToastKind = 'info') {
      hud.toast(text, kind);
    },
    prompt(text) {
      promptText = text;
      hud.prompt(text);
    },
    location() {
      return { street, area };
    },
    dispose() {
      for (const f of off) f();
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('keydown', onKey);
      touch.dispose();
      minimap.dispose();
      fullMap.dispose();
      banner.dispose();
      root.remove();
      delete (window as unknown as { __ui?: unknown }).__ui;
    },
  };

  // test hooks
  (window as unknown as { __ui: unknown }).__ui = {
    openLeaderboard(open = true) {
      lbPinned = open;
    },
    openMap() {
      if (overlay === 'map') return;
      go('map');
    },
    closeMap() {
      if (overlay === 'map') go('none');
    },
    showDeath(name: string, weapon = 0) {
      showDeath(name || '', weapon);
    },
    hideDeath() {
      if (overlay === 'death') go('none');
    },
    showNameEntry() {
      go('name');
    },
    pause() {
      go('pause');
    },
    resume,
    toast(t: string, kind: ToastKind = 'info') {
      hud.toast(t, kind);
    },
    prompt(t: string | null) {
      mod.prompt(t);
    },
    feed(t: string, kind: 'kill' | 'system' | 'discover' = 'kill', weapon?: number) {
      hud.feed(t, kind, weapon);
    },
    jump(name: string) {
      if (!st.admin) return false;
      const it = jumpItems().find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (it) jumpTo(it);
      return !!it;
    },
    state: () => ({ overlay, loadingActive, needName, prompt: promptText, street, area, leaderboard: lb.isVisible }),
  };

  return mod;
}
