/** Keep a shareable debug viewpoint in the address bar. ?urlsync=0 disables it. */
(function () {
  'use strict';

  var initial = new URLSearchParams(location.search);
  if (initial.get('urlsync') === '0') return;

  // fly heights are ground-relative. Keep absolute Y too so bridges, water,
  // and tiles arriving at different times cannot change a restored viewpoint.
  var fly = (initial.get('fly') || '').split(',').map(function (value) {
    return value.trim() === '' ? NaN : Number(value);
  });
  var absoluteY = initial.get('camy');
  var restoreY = !initial.has('spot') && fly.length >= 2 &&
    fly.every(Number.isFinite) && absoluteY !== null && absoluteY.trim() !== '' &&
    Number.isFinite(Number(absoluteY)) ? Number(absoluteY) : null;
  var restored = false;
  var rotation;
  var lastUpdate = -Infinity;

  function round(value, digits) { return Number(value.toFixed(digits)); }

  function sync() {
    var ctx = window.__game && window.__game.ctx;
    if (!ctx || !ctx.camera) return;
    var camera = ctx.camera;
    if (!restored) {
      restored = true;
      if (restoreY !== null && ctx.state.screenshotMode) camera.position.y = restoreY;
    }
    // Do not replace a requested viewpoint with the renderer's boot position.
    if (!ctx.stats || ctx.stats.drawCalls <= 0) return;
    if (!rotation) rotation = camera.rotation.clone();
    rotation.setFromQuaternion(camera.quaternion, 'YXZ');
    var p = camera.position;
    var heading = ((-rotation.y * 180 / Math.PI) % 360 + 360) % 360;
    var pitch = rotation.x * 180 / Math.PI;
    var ground = ctx.physics.groundHeight(p.x, p.z);
    if (![p.x, p.y, p.z, heading, pitch, ground, camera.fov].every(Number.isFinite)) return;

    var url = new URL(location.href);
    // Named spots take precedence over fly in the client parser.
    url.searchParams.delete('spot');
    url.searchParams.set('fly', [round(p.x, 2), round(p.z, 2), round(p.y - ground, 2),
      round(heading, 2) % 360, round(pitch, 2)].join(','));
    url.searchParams.set('camy', String(round(p.y, 2)));
    url.searchParams.set('fov', String(round(camera.fov, 2)));
    if (url.href === location.href) return;
    try {
      // Preserve router state and the Back button; never navigate or reload.
      history.replaceState(history.state, '', url);
    } catch (e) { /* History can be restricted by the browser. Retry next tick. */ }
  }

  function tick(now) {
    if (now - lastUpdate >= 500) {
      lastUpdate = now;
      sync();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  window.addEventListener('pagehide', sync);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sync();
  });
})();
