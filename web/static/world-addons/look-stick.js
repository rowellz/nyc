/**
 * Thumbsticks for touch devices, in both of the client's modes.
 *
 * Injected into /world/index.html by the SvelteKit service only
 * (web/src/lib/server/client-addons.js), so public/ stays byte-for-byte as
 * mirrored and the original `nyc` container is untouched. Everything here goes
 * through the client's own input paths, reached from `window.__game` — the
 * handle main.ts already exposes for playtesting.
 *
 * PLAY MODE — the client (src/client/src/ui/touch.ts) ships a movement stick
 * bottom-left and a drag-anywhere look zone, but no camera stick. This adds one
 * to its overlay and feeds `input.addTouchLook()`.
 *
 * CAMERA MODE (?spot= / ?fly=) — nothing worked here on a phone. The client
 * builds InputManager with `enabled: false`, so addTouchLook() and
 * setTouchMove() are both no-ops; ui/index.ts never un-hides the touch overlay;
 * the free camera looks by *mouse* drag (mousedown/mousemove on the canvas, so a
 * touch drag never reaches it) and moves by reading `input.keys` directly. So in
 * camera mode this puts up its own overlay with both sticks and drives those two
 * paths: the left stick sets WASD in `input.keys`, and the right stick
 * synthesises the mouse drag the free camera is listening for.
 *
 * Rates come from the client, not from taste. core/input.ts drives the gamepad's
 * right stick at "720 px/s at full deflection" past a 0.15 dead zone, so the
 * look stick uses those numbers. The two modes turn a pixel into a different
 * angle — character/camera.ts uses 0.0022 rad/px, screenshot.ts uses 0.0035 —
 * so camera mode is scaled by their ratio and both feel the same on the thumb.
 *
 *   ?lookstick=0    off in both modes
 *   ?lookstick=1    force on with a mouse, for testing on a desktop. In play mode
 *                   TouchControls keeps its overlay hidden without real touch
 *                   hardware, so this also reveals it; the client's own stick and
 *                   buttons stay inert because their handlers check its private
 *                   `visible` flag.
 *   ?looksens=480   pixels per second at full deflection (default 720)
 *
 * Once running, `__lookStick.rate = 480` retunes it live.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var flag = params.get('lookstick');
  if (flag === '0' || flag === 'false') return;

  /** params.ts: a spot or a fly target is what puts the client in camera mode. */
  var CAMERA_MODE = params.has('spot') || params.has('fly');

  /** core/input.ts: the gamepad look axes ignore anything under this. */
  var DEAD_ZONE = 0.15;
  /** ui/touch.ts: pixels from the centre that count as full deflection. */
  var RADIUS = 42;
  /** ui/touch.ts: how far the knob itself is allowed to slide. */
  var KNOB_TRAVEL = 36;
  /** How far the movement stick must lean before a WASD key counts as held. */
  var MOVE_THRESHOLD = 0.35;
  /** ...and how far before it also holds Shift, which the free camera reads as "fast". */
  var FAST_THRESHOLD = 0.85;
  /** character/camera.ts SENS over screenshot.ts's own factor: same angle per thumb. */
  var CAMERA_LOOK_SCALE = 0.0022 / 0.0035;

  var rate = number(params.get('looksens'), 720, 30, 5000);

  function number(raw, fallback, min, max) {
    var n = raw === null ? NaN : parseFloat(raw);
    return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  // In play mode the knob reuses the client's own `.knob` rule and only the stick
  // needs placing; the action buttons live in that corner upstream, so they move
  // above it. Camera mode owns its overlay outright and styles both sticks.
  var CSS = [
    '.ls-stick{position:absolute;bottom:max(25px,env(safe-area-inset-bottom));width:116px;height:116px;',
    'border-radius:50%;background:#11202e99;border:2px solid #ffffff77;touch-action:none;pointer-events:auto}',
    '.ls-stick.ls-move{left:22px}',
    '.ls-stick.ls-look{right:22px}',
    '.ls-knob{position:absolute;left:36px;top:36px;width:40px;height:40px;border-radius:50%;',
    'background:#ffffffaa;pointer-events:none}',
    '#touch-controls .actions{bottom:calc(max(24px,env(safe-area-inset-bottom)) + 128px)}',
    // Keep the drag-to-look zone clear of the stick on short (landscape) screens.
    '#touch-controls .look{height:min(56%,calc(82% - 149px))}',
    '@media (max-height:420px){',
    '.ls-stick{width:96px;height:96px}',
    '.ls-stick.ls-move{left:16px}',
    '.ls-stick.ls-look{right:16px}',
    '.ls-knob{left:28px;top:28px}',
    '#touch-controls .actions{bottom:calc(max(20px,env(safe-area-inset-bottom)) + 108px)}}',
  ].join('');

  var OVERLAY_CSS = '.ls-overlay{position:fixed;inset:0;pointer-events:none;z-index:30;user-select:none}';

  var installed = null;  // element that must stay in the page for us to be live
  var input = null;
  var move = { x: 0, y: 0 };   // camera mode only
  var look = { x: 0, y: 0 };
  var held = [];               // key codes we are holding down in input.keys
  var drag = null;             // synthetic mouse cursor driving the free camera

  /** One stick: pointer plumbing, knob, and a normalised vector. */
  function makeStick(host, extraClass, label, out, onGrab, onRelease) {
    var el = document.createElement('div');
    el.className = 'ls-stick ' + extraClass;
    el.setAttribute('aria-label', label);
    var knob = document.createElement('div');
    knob.className = 'ls-knob';
    el.appendChild(knob);
    host.appendChild(el);

    var pointerId = null;

    function track(e) {
      var r = el.getBoundingClientRect();
      var x = (e.clientX - r.left - r.width / 2) / RADIUS;
      var y = (e.clientY - r.top - r.height / 2) / RADIUS;
      var length = Math.max(1, Math.sqrt(x * x + y * y));
      out.x = x / length;
      out.y = y / length;
      knob.style.transform = 'translate(' + out.x * KNOB_TRAVEL + 'px,' + out.y * KNOB_TRAVEL + 'px)';
    }

    function release() {
      pointerId = null;
      out.x = out.y = 0;
      knob.style.transform = '';
      if (onRelease) onRelease();
    }

    el.addEventListener('pointerdown', function (e) {
      if (pointerId !== null || host.hidden) return;
      e.preventDefault();
      pointerId = e.pointerId;
      if (el.setPointerCapture) el.setPointerCapture(pointerId);
      if (onGrab) onGrab();
      track(e);
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      track(e);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (type) {
      el.addEventListener(type, function (e) { if (e.pointerId === pointerId) release(); });
    });
    window.addEventListener('blur', release);
    return el;
  }

  function style(host, css) {
    var el = document.createElement('style');
    el.textContent = css;
    host.appendChild(el);
  }

  /** Play mode: one extra stick inside the client's own overlay. */
  function installPlay(container) {
    // TouchControls.update() only ever un-hides its overlay for real touch
    // hardware, so a forced stick would otherwise land in a hidden container. It
    // re-hides nothing afterwards: update() bails early while its own visibility
    // flag already matches.
    if (!input.touch) container.hidden = false;
    // Appended after the client's own <style>, so equal-specificity rules win.
    style(container, CSS);
    // Last child of the container, so it takes the pointer where it overlaps the
    // drag-to-look zone rather than fighting it.
    return makeStick(container, 'ls-look', 'Look joystick', look);
  }

  /**
   * Camera mode: our own overlay, because the client's stays hidden here and its
   * sticks would be inert anyway (their handlers check a `visible` flag that
   * ui/index.ts never sets in screenshot mode).
   */
  function installCamera() {
    var canvas = document.querySelector('canvas');
    if (!canvas) return null;

    var overlay = document.createElement('div');
    overlay.className = 'ls-overlay';
    style(overlay, OVERLAY_CSS + CSS);
    document.body.appendChild(overlay);

    makeStick(overlay, 'ls-move', 'Move camera joystick', move, null, releaseKeys);
    makeStick(overlay, 'ls-look', 'Look joystick', look, function () {
      // screenshot.ts's FreeCamera looks by mouse drag: mousedown on the canvas,
      // then mousemove on window. A touch drag never produces those, so hold a
      // synthetic one for as long as the thumb is down.
      drag = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      canvas.dispatchEvent(new MouseEvent('mousedown', {
        button: 0, buttons: 1, clientX: drag.x, clientY: drag.y, bubbles: true,
      }));
    }, function () {
      if (!drag) return;
      drag = null;
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    });
    return overlay;
  }

  function releaseKeys() {
    if (input && input.keys) for (var i = 0; i < held.length; i++) input.keys.delete(held[i]);
    held.length = 0;
  }

  /** The free camera reads input.keys straight off the manager, disabled or not. */
  function driveKeys() {
    var want = [];
    if (-move.y > MOVE_THRESHOLD) want.push('KeyW');
    else if (-move.y < -MOVE_THRESHOLD) want.push('KeyS');
    if (move.x > MOVE_THRESHOLD) want.push('KeyD');
    else if (move.x < -MOVE_THRESHOLD) want.push('KeyA');
    // An analog stick against binary keys: lean all the way to go fast.
    if (want.length && Math.sqrt(move.x * move.x + move.y * move.y) > FAST_THRESHOLD) want.push('ShiftLeft');

    for (var i = 0; i < held.length; i++) {
      if (want.indexOf(held[i]) === -1) input.keys.delete(held[i]);
    }
    for (var j = 0; j < want.length; j++) input.keys.add(want[j]);
    held = want;
  }

  /** Deflection past the dead zone, ramped 0..1, or 0 inside it. */
  function ramp(m) {
    return m <= DEAD_ZONE ? 0 : (m - DEAD_ZONE) / (1 - DEAD_ZONE);
  }

  var last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!installed || !input || !dt) return;

    if (CAMERA_MODE && input.keys) driveKeys();

    var m = Math.sqrt(look.x * look.x + look.y * look.y);
    var r = ramp(m);
    if (!r) return;
    // Along the direction the thumb is pushing. Positive y looks down, matching
    // the drag gesture this sits next to.
    var speed = (r / m) * rate * dt;
    if (!CAMERA_MODE) {
      input.addTouchLook(look.x * speed, look.y * speed);
    } else if (drag) {
      drag.x += look.x * speed * CAMERA_LOOK_SCALE;
      drag.y += look.y * speed * CAMERA_LOOK_SCALE;
      window.dispatchEvent(new MouseEvent('mousemove', {
        buttons: 1, clientX: drag.x, clientY: drag.y, bubbles: true,
      }));
    }
  }
  requestAnimationFrame(frame);

  function install() {
    if (installed && installed.isConnected) return;
    var game = window.__game;
    var ctx = (game && game.ctx) || window.__ctx;
    input = ctx && ctx.input;
    if (!input || typeof input.addTouchLook !== 'function') return;
    // Same gate as the client: real touch hardware, unless forced on for testing.
    if (!input.touch && flag !== '1') return;

    if (CAMERA_MODE) {
      installed = installCamera();
    } else {
      var container = document.getElementById('touch-controls');
      installed = container ? installPlay(container) : null;
    }
    if (!installed) return;

    window.__lookStick = {
      el: installed,
      cameraMode: CAMERA_MODE,
      get rate() { return rate; },
      set rate(v) { rate = number(String(v), rate, 30, 5000); },
      vector: function () { return { look: { x: look.x, y: look.y }, move: { x: move.x, y: move.y } }; },
    };
  }

  // #touch-controls is built during boot and torn down with the UI module, the
  // canvas appears only once the renderer exists, and __game arrives when the
  // loop starts. Polling covers all three, and re-installs if any of them is
  // replaced.
  install();
  setInterval(install, 500);
})();
