/** CPU-only boot diagnostics: this module must never import the game or Three. */
import { basePath } from './basePath';
import { isIOS, isMobileDevice, isQualityLevel } from './quality';
import { GAME_VERSION } from '@shared/version';

export const CRASH_KEY = 'nyc.unclean-starts.v2';
const WINDOW_MS = 5 * 60_000;
const bootId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
let starts: number[] = [];
let sequence = 0;
let quality = isMobileDevice() ? 'mobile' : 'auto';
let lastStage = 'script_start';
let errorText = '';
let cleanTimer: ReturnType<typeof setTimeout> | undefined;
let failed = false;
let formUp = false;
let begun = false;
let gameStarted = false;
export function markGameStarted(): void { gameStarted = true; }
export function hasGameStarted(): boolean { return gameStarted; }
export let uncleanStartCount = 0;
export let firstFrameAt = 0;
function read(): { starts?: number[]; bootId?: string } {
  try { return JSON.parse(localStorage.getItem(CRASH_KEY) || '{}'); } catch { return {}; }
}
export function beginBoot(): boolean {
  if (begun) return false;
  begun = true;
  const now = Date.now();
  const previous = read().starts;
  starts = Array.isArray(previous) ? previous.filter(t => Number.isFinite(t) && t <= now && now - t < WINDOW_MS).slice(-20) : [];
  starts.push(now);
  uncleanStartCount = starts.length;
  try { localStorage.setItem(CRASH_KEY, JSON.stringify({ starts, bootId })); } catch { /* storage disabled */ }
  const url = new URL(location.href);
  const retry = url.searchParams.get('safe') === '1';
  // Consume the manual override BEFORE importing game code. A Safari crash reload
  // must see the guard again, never a persistent bypass in the address bar.
  if (retry) { url.searchParams.delete('safe'); history.replaceState(null, '', url.href); }
  const requested = url.searchParams.get('q');
  if (!isMobileDevice() && isQualityLevel(requested)) quality = requested;
  window.addEventListener('error', e => reportStartupError('window_error', e.error || e.message));
  window.addEventListener('unhandledrejection', e => reportStartupError('unhandledrejection', e.reason));
  stageBeacon('script_start');
  return uncleanStartCount >= 2 && !retry;
}
export function setStageQuality(tier: string): void { quality = tier; }
export function setNameFormUp(value: boolean): void { formUp = value; }
export function isNameFormUp(): boolean { return formUp; }
export function stageBeacon(stage: string, detail = ''): void {
  if (!begun) return;
  lastStage = stage;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const body = JSON.stringify({ stage, bootId, seq: ++sequence, elapsedMs: Math.round(performance.now()),
    version: GAME_VERSION, ua: navigator.userAgent.slice(0, 512), viewport: [innerWidth, innerHeight],
    deviceMemory: nav.deviceMemory ?? null, hardwareConcurrency: nav.hardwareConcurrency ?? null,
    quality, uncleanStartCount, error: errorText, detail: detail.slice(0, 160) });
  try {
    if (navigator.sendBeacon(basePath('/api/telemetry'), new Blob([body], { type: 'application/json' }))) return;
    void fetch(basePath('/api/telemetry'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* Diagnostics must not break startup. */ }
}
export function reportStartupError(stage: string, error: unknown): void {
  errorText = (error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error)).slice(0, 600);
  stageBeacon(stage, `after ${lastStage}`);
}
export function markFirstFrame(): void {
  if (firstFrameAt) return;
  firstFrameAt = performance.now();
  stageBeacon('first_frame');
  if (!isIOS()) markReady();
}
/** Clear the crash marker only after a sustained, fully constructed city on iOS. */
export function markReady(): void {
  clearTimeout(cleanTimer);
  cleanTimer = setTimeout(() => {
    if (!failed && read().bootId === bootId) {
      try { localStorage.removeItem(CRASH_KEY); } catch { /* storage disabled */ }
    }
  }, 10_000);
}
export function showSafeMode(): void {
  failed = true;
  clearTimeout(cleanTimer);
  formUp = true;
  (window as any).__ready = false;
  if (isIOS()) {
    stageBeacon('safe_mode');
    // Navigation releases the entire failed document: contexts, workers, WASM and timers.
    location.replace(basePath('/safe.html'));
    return;
  }
  document.getElementById('game')?.setAttribute('hidden', '');
  document.getElementById('loading')?.setAttribute('hidden', '');
  const fatal = document.getElementById('fatal');
  if (fatal) fatal.style.display = 'none';
  const root = document.getElementById('ui')!;
  root.replaceChildren();
  const panel = document.createElement('main');
  panel.id = 'safe-mode';
  panel.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:20px;padding:28px;background:#0b0e14;color:#e8ecf1;font:17px/1.5 system-ui;text-align:center;pointer-events:auto';
  const title = document.createElement('h1'); title.textContent = 'Safe mode';
  const message = document.createElement('p'); message.style.maxWidth = '520px';
  message.textContent = "Your phone couldn't run the full city. We're fixing mobile — try on a computer for now, or tap to retry in a lighter mode";
  const input = document.createElement('input'); input.disabled = true; input.placeholder = 'Your name'; input.setAttribute('aria-label', 'Your name');
  const retry = document.createElement('button'); retry.textContent = 'Retry in a lighter mode';
  retry.style.cssText = 'padding:14px 22px;border:0;border-radius:8px;font:inherit;cursor:pointer';
  retry.onclick = () => { const url = new URL(location.href); url.searchParams.set('q', 'mobile'); url.searchParams.set('safe', '1'); location.assign(url.href); };
  panel.append(title, message, input, retry); root.append(panel);
  stageBeacon('safe_mode');
}
export function handleContextLoss(): void {
  failed = true;
  clearTimeout(cleanTimer);
  stageBeacon('context_lost');
  if (isIOS()) { showSafeMode(); return; }
  const url = new URL(location.href);
  let reloaded = url.searchParams.get('contextRetry') === '1';
  try { reloaded ||= sessionStorage.getItem('nyc.context-reloaded') === '1'; } catch { /* URL remains the fallback */ }
  showSafeMode();
  if (reloaded) return;
  try { sessionStorage.setItem('nyc.context-reloaded', '1'); } catch { /* URL fallback */ }
  url.searchParams.set('contextRetry', '1');
  url.searchParams.set('q', isIOS() ? 'mobile' : 'low');
  url.searchParams.delete('safe');
  // One automatic recovery per tab, even after a clean start or disabled storage.
  setTimeout(() => location.replace(url.href), 250);
}
