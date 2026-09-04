import type { GameContext, GameModule } from './context';
import { basePath } from './basePath';

/** No UA, names, emails or fingerprint identifiers leave the browser. Token is authentication only. */
export function createTelemetry(ctx: GameContext): GameModule {
  const device = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  const endpoint = basePath('/api/telemetry');
  const frames = new Uint32Array(501); // FPS histogram: constant memory, no frame log
  let last = 0, count = 0, readyMs: number | null = null, readySent = false, disconnects = 0, welcomed = false;
  let tier = ctx.quality.level;
  const quantile = (q: number): number | null => {
    if (!count) return null;
    const target = Math.max(1, Math.ceil(q * count)); let n = 0;
    for (let i = 0; i < frames.length; i++) if ((n += frames[i]) >= target) return i;
    return null;
  };
  function send(unload = false): void {
    if (!ctx.state.local.token) return;
    const reportReadyMs = readySent ? null : readyMs;
    // The live 0.2.5 telemetry protocol accepts the four legacy quality names.
    const body = JSON.stringify({ token: ctx.state.local.token, quality: tier === 'mobile' ? 'low' : tier, device, fpsP50: quantile(0.5), fpsP5: quantile(0.05), viewport: [Math.min(10000, innerWidth), Math.min(10000, innerHeight)], readyMs: reportReadyMs, disconnects });
    frames.fill(0); count = 0; disconnects = 0;
    if (unload) {
      // Hand pagehide delivery to the browser, not a document-owned fetch/timer.
      try {
        if (navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'application/json' }))) return;
      } catch { /* A full/disabled beacon queue still gets a best-effort keepalive fallback. */ }
    }
    // Periodic reports can also be in flight at navigation. Keep them alive too;
    // the unload fallback must not inherit an AbortSignal owned by the dying page.
    void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'same-origin', ...(unload ? {} : { signal: AbortSignal.timeout(10_000) }) }).then(r => { if (r.ok && reportReadyMs !== null) readySent = true; }).catch(() => {});
  }
  // pagehide works with bfcache and mobile; visibilitychange is not an unload and must not duplicate reports.
  const hide = () => { last = 0; };
  const unload = () => send(true);
  const timer = setInterval(() => send(), 60_000);
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('pagehide', unload);
  return {
    name: 'telemetry',
    update() {
      const now = performance.now(), isWelcomed = !!ctx.state.welcomed;
      if (welcomed && !isWelcomed) disconnects++;
      welcomed = isWelcomed;
      const ready = (window as Window & { __ready?: boolean }).__ready === true;
      if (ready && readyMs === null) readyMs = Math.round(now);
      if (ctx.quality.level !== tier) { frames.fill(0); count = 0; tier = ctx.quality.level; }
      if (ready && isWelcomed && !document.hidden && last && now > last) { frames[Math.min(500, Math.round(1000 / (now - last)))]++; count++; }
      last = !document.hidden && ready ? now : 0;
    },
    dispose() { clearInterval(timer); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', unload); },
  };
}
