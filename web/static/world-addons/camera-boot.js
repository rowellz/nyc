/**
 * Stops camera mode from locking itself out of the city on iOS.
 *
 * The client keeps a crash guard in localStorage (core/crashGuard.ts): every
 * load pushes a timestamp, and a load is only forgiven once `markReady()` clears
 * the record. Two unforgiven loads inside five minutes and `beginBoot()` returns
 * true, so boot.ts shows safe mode before any game code runs — on iOS by
 * navigating to /world/safe.html, which drops the query string and lands you in
 * Bryant Park in play mode.
 *
 * The catch is what "forgiven" means. Off iOS, markFirstFrame() calls
 * markReady() as soon as one frame is drawn. On iOS it is called from exactly
 * one place (main.ts, when `shots.ready` flips), and that flag is the full
 * screenshot contract: every module constructed, the near tiles decoded, no
 * outstanding work, a frame drawn. On a phone in camera mode that is minutes
 * away — iOS builds the city one module per 1.5 s slot after the first frame —
 * so a visit you give up on is recorded as a crash. Two of those and every
 * later load, camera mode or not, opens in safe mode.
 *
 * So in camera mode this applies the rule every other platform gets: once the
 * page has drawn and stayed alive for a while, mark the start clean. A real
 * out-of-memory kill happens while the city is still being built, long before
 * that, and is still caught. It also remembers where you were headed, so
 * safe-return.js on /world/safe.html can offer the way back.
 *
 *   ?bootguard=0   leave the client's strict rule alone
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  // params.ts: a spot or a fly target is what puts the client in camera mode.
  if (!params.has('spot') && !params.has('fly')) return;

  /** Where safe.html looks for the viewpoint you were trying to reach. */
  var STASH_KEY = 'nyc.web.camera-return';
  /** crashGuard.ts CRASH_KEY. */
  var CRASH_KEY = 'nyc.unclean-starts.v2';
  /** How long the city has to stay up before the start counts as clean. */
  var HEALTHY_MS = 20000;

  try { sessionStorage.setItem(STASH_KEY, location.search); } catch (e) { /* storage disabled */ }

  if (params.get('bootguard') === '0') return;

  // Only ever clear the record this load wrote. crashGuard does the same check,
  // so a second tab mid-boot keeps its own guard.
  var bootId = null;
  try { bootId = JSON.parse(localStorage.getItem(CRASH_KEY) || '{}').bootId || null; } catch (e) { /* ignore */ }
  if (!bootId) return;

  var broke = false;
  window.addEventListener('error', function () { broke = true; });
  window.addEventListener('unhandledrejection', function () { broke = true; });

  var start = -1;
  function tick(now) {
    if (start < 0) start = now;   // rAF timestamps can be 0, so no falsy sentinel
    // Something already went wrong, or the client put up safe mode itself:
    // leave the record exactly where the guard wants it.
    if (broke || document.getElementById('safe-mode')) return;
    // The evidence the guard actually cares about: the renderer drew, and the
    // page is still here. finishReady() additionally waits on modules, tiles and
    // the work queue, which is the part camera mode cannot deliver on a phone.
    var game = window.__game;
    var drew = !!(game && game.ctx && game.ctx.stats && game.ctx.stats.drawCalls > 0);
    if (!drew || now - start < HEALTHY_MS) { requestAnimationFrame(tick); return; }
    try {
      var record = JSON.parse(localStorage.getItem(CRASH_KEY) || '{}');
      if (record.bootId === bootId) localStorage.removeItem(CRASH_KEY);
    } catch (e) { /* storage disabled */ }
  }
  requestAnimationFrame(tick);
})();
