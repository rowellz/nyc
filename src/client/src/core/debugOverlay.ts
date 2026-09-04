/**
 * Tiny debug overlay used when the ui module is missing or ?debug=1: fps, frame ms, draw calls,
 * tiles, players, position, lat/lon, time, quality, net status.
 */
import { xzToLonLat, yawToHeading } from '@shared/geo';
import type { GameContext, GameModule } from './context';
import { formatTimeOfDay } from './params';
import type { NetClientImpl } from './net';
import type { WorldStreamerImpl } from './streamer';

export function createDebugOverlay(ctx: GameContext, deps: { net: NetClientImpl; streamer: WorldStreamerImpl; device: string; autoLevel: string }): GameModule {
  const el = document.createElement('pre');
  el.id = 'core-debug';
  el.style.cssText =
    'position:absolute;left:10px;top:10px;margin:0;padding:8px 10px;font:12px/1.35 ui-monospace,Menlo,monospace;color:#e8ecf1;background:rgba(6,8,12,.62);border:1px solid rgba(255,255,255,.08);border-radius:6px;pointer-events:none;white-space:pre;z-index:50;max-width:46ch';
  ctx.uiRoot.appendChild(el);
  let acc = 0;
  const hint = ctx.state.screenshotMode ? 'free cam: drag mouse to look, WASD move, Space/Ctrl up/down, Shift fast' : 'click to capture the mouse · WASD move · Shift run · Space jump · Esc release';
  return {
    name: 'debugOverlay',
    update(dt) {
      acc += dt;
      if (acc < 0.25) return;
      acc = 0;
      const s = ctx.state.local.state;
      const cam = ctx.camera.position;
      const ll = xzToLonLat(s.x, s.z);
      const cll = xzToLonLat(cam.x, cam.z);
      const w = deps.streamer;
      const n = deps.net;
      const lines = [
        `${ctx.stats.fps} fps  ${ctx.stats.frameMs.toFixed(1)} ms  ${ctx.stats.drawCalls} draws  ${(ctx.stats.triangles / 1000).toFixed(0)}k tris`,
        `quality ${ctx.quality.level}${deps.autoLevel !== ctx.quality.level ? ` (auto ${deps.autoLevel})` : ''}  dpr ${ctx.quality.pixelRatio}  ${deps.device.slice(0, 40)}`,
        `tiles ${w.tiles.size} loaded  ${w.stats.inFlight} in flight  ${w.stats.queued} queued  ${w.stats.failed ? w.stats.failed + ' failed  ' : ''}${w.index ? w.index.tiles.length + ' in index' : 'no index'}  ready ${w.ready}`,
        `physics ${ctx.physics.world.colliders.len()} colliders`,
        `player ${s.x.toFixed(1)}, ${s.y.toFixed(2)}, ${s.z.toFixed(1)}  hdg ${yawToHeading(s.yaw).toFixed(0)}°  ${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`,
        `camera ${cam.x.toFixed(1)}, ${cam.y.toFixed(1)}, ${cam.z.toFixed(1)}  ${cll.lat.toFixed(5)}, ${cll.lon.toFixed(5)}`,
        `time ${formatTimeOfDay(ctx.time.dayFraction)}${ctx.time.frozen ? ' (frozen)' : ''}  sun ${((ctx.time.sunElevation * 180) / Math.PI).toFixed(1)}°  daylight ${ctx.time.daylight.toFixed(2)}  ${ctx.state.weather.condition}`,
        `net ${n.status}${n.status === 'welcomed' ? `  id ${ctx.state.local.id}  ping ${ctx.state.ping} ms` : n.reconnectAttempt ? `  retry #${n.reconnectAttempt}` : ''}  online ${ctx.state.online}  nearby ${ctx.state.remotes.size}  score ${ctx.state.local.score}`,
        `modules ${Array.from(ctx.modules.keys()).join(' ')}`,
        hint,
      ];
      el.textContent = lines.join('\n');
    },
    dispose() {
      el.remove();
    },
  };
}
