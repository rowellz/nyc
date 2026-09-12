/** Keep repeated thumbstick touches from becoming Safari page zoom gestures.
 * Injected by SvelteKit only; menus and links outside the game stay unchanged. */
(function () {
  'use strict';

  if (!navigator.maxTouchPoints) return;

  var style = document.createElement('style');
  style.textContent = [
    '#game,#touch-controls,#touch-controls *,.ls-overlay,.ls-overlay *{',
    'touch-action:none!important;-webkit-user-select:none;user-select:none}',
  ].join('');
  document.head.appendChild(style);

  function isGameControl(target) {
    return target instanceof Element && !!target.closest('#game,#touch-controls,.ls-overlay');
  }

  // WebKit exposes pinch gestures separately from Pointer Events.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, function (event) {
      if (isGameControl(event.target)) event.preventDefault();
    }, { passive: false });
  });

  document.addEventListener('dblclick', function (event) {
    if (isGameControl(event.target)) event.preventDefault();
  }, { passive: false });

  // Cancel only the second nearby tap. Pointer-up handlers have already applied
  // the game action, while Safari no longer receives a double-tap to magnify.
  var previous = null;
  document.addEventListener('touchend', function (event) {
    if (!isGameControl(event.target) || event.changedTouches.length !== 1) {
      previous = null;
      return;
    }
    var touch = event.changedTouches[0];
    var current = { time: performance.now(), x: touch.clientX, y: touch.clientY };
    if (previous && current.time - previous.time < 350
      && Math.hypot(current.x - previous.x, current.y - previous.y) < 44) {
      event.preventDefault();
      previous = null;
    } else {
      previous = current;
    }
  }, { passive: false });
})();
