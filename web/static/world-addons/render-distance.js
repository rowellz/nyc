/** Live render distance, available to every player on desktop and touch devices. */
(function () {
  'use strict';
  function install() {
    var slot = document.querySelector('#nyc .minimap-slot');
    var setting = window.__game?.ctx?.world?.renderDistance;
    if (!slot || !setting) return false;
    if (document.getElementById('render-distance')) return true;
    var style = document.createElement('style');
    style.textContent = `
      #nyc .render-distance{display:flex;flex-direction:column;gap:4px;width:284px;
        padding:6px 8px;border:1px solid #ffffff24;border-radius:7px;background:#090b0fb8;
        color:#fff;pointer-events:auto;font:12px/1.3 var(--head);order:-1}
      #nyc .render-distance label{display:flex;justify-content:space-between;gap:4px}
      #nyc .render-distance input{width:100%;min-height:28px;margin:0;accent-color:#ffbe3d}
      #nyc .render-distance small{font-size:10px;color:#ddd}
      #nyc .render-distance button{align-self:flex-start;min-height:28px;padding:3px 6px;
        border:1px solid #ffffff55;border-radius:4px;background:#090b0f;color:#fff;cursor:pointer}
      #nyc[data-touch="active"] .render-distance{width:140px;padding:5px 7px}
      #nyc[data-touch="active"] .render-distance button{min-height:36px}
    `;
    document.head.appendChild(style);
    var control = document.createElement('div');
    control.className = 'render-distance ia';
    control.innerHTML = '<label for="render-distance">Render distance <output for="render-distance"></output></label>'
      + '<input id="render-distance" type="range" min="50" max="200" step="25" aria-describedby="render-distance-help render-distance-range">'
      + '<small id="render-distance-range"></small>'
      + '<small id="render-distance-help">Higher uses more memory and may lower FPS.</small>'
      + '<button type="button">Reset to default</button>';
    var slider = control.querySelector('input');
    function sync() {
      slider.value = String(setting.value);
      control.querySelector('output').textContent = setting.value + '%';
      var description = setting.near + ' m detail · ' + (setting.far / 1000).toFixed(1) + ' km skyline';
      control.querySelector('#render-distance-range').textContent = description;
      slider.setAttribute('aria-valuetext', setting.value + ' percent, ' + description);
    }
    slider.addEventListener('input', function () { setting.set(slider.value); sync(); });
    control.querySelector('button').addEventListener('click', function () { setting.set(100); sync(); });
    // Keep HUD interactions from moving the player or capturing the pointer.
    ['pointerdown', 'pointerup', 'click', 'dblclick', 'keydown', 'keyup'].forEach(function (name) {
      control.addEventListener(name, function (event) { event.stopPropagation(); });
    });
    slot.insertAdjacentElement('afterend', control);
    sync();
    return true;
  }
  if (install()) return;
  var timer = window.setInterval(function () {
    if (install()) window.clearInterval(timer);
  }, 500);
})();
