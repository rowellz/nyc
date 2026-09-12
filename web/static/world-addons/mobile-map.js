/**
 * Anchors a collapsible play-mode HUD upper-left, makes its mobile minimap collapsible, and
 * puts a live traffic-density slider beside it for admins.
 *
 * The mirrored client already shrinks its map for touch, but its status chips
 * come first in DOM order and there is no way to reclaim that part of the
 * screen. This addon moves the map slot ahead of those chips and adds a button
 * that collapses only the map; health, location and status stay visible.
 * A separate HUD toggle on every device collapses the entire upper-left stack.
 *
 *   ?mobilemap=1   force the control on for desktop testing
 *   ?mobilemap=0   leave the upstream touch HUD untouched
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  if (params.get('mobilemap') === '0') return;
  var ADMIN_TRAFFIC_CAP = 400;

  var forced = params.get('mobilemap') === '1';
  var touchDevice = forced || navigator.maxTouchPoints > 0
    || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  var style = document.createElement('style');
  style.id = 'mobile-map-style';
  style.textContent = [
    '#nyc .hud.bl{top:calc(env(safe-area-inset-top) + 22px);bottom:auto;',
    'left:calc(env(safe-area-inset-left) + 22px)}',
    '#nyc:not([data-touch="active"]) .hud.tl{top:auto;',
    'bottom:calc(env(safe-area-inset-bottom) + 22px)}',
    '#nyc[data-touch="active"] .hud.bl{',
    'top:calc(env(safe-area-inset-top) + 12px);right:auto;bottom:auto;',
    'left:calc(env(safe-area-inset-left) + 12px);width:140px;',
    'display:flex;flex-direction:column;align-items:stretch;transform:none}',
    '#nyc .hud-content{display:flex;flex-direction:column;gap:inherit}',
    '#nyc .hud-content[hidden]{display:none}',
    '#nyc .hud-toggle{display:flex;align-self:flex-start;align-items:center;justify-content:center;',
    'min-width:72px;min-height:44px;gap:8px;padding:8px 12px;',
    'border:1px solid rgba(255,255,255,.42);border-radius:8px;',
    'background:rgba(9,11,15,.78);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.4);',
    'font:700 12px/1 var(--head);letter-spacing:.1em;text-shadow:var(--shadow);touch-action:manipulation}',
    '#nyc .hud-toggle:focus-visible{outline:2px solid var(--amber);outline-offset:3px}',
    '#nyc[data-touch="active"] .minimap-slot{',
    'position:relative;order:-2;width:140px;height:90px;overflow:hidden;',
    'transition:width .18s ease,height .18s ease}',
    '#nyc[data-touch="active"] .minimap-slot .minimap{',
    'transform-origin:top left;transition:opacity .14s ease,transform .18s ease}',
    '#nyc .mobile-minimap-toggle{display:none}',
    '#nyc[data-touch="active"] .mobile-minimap-toggle{',
    'display:flex;position:absolute;z-index:2;top:5px;right:5px;',
    'align-items:center;justify-content:center;width:30px;height:30px;padding:0;',
    'border:1px solid rgba(255,255,255,.42);border-radius:8px;',
    'background:rgba(9,11,15,.78);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.4);',
    'font:700 18px/1 var(--head);text-shadow:var(--shadow);touch-action:manipulation}',
    '#nyc[data-touch="active"] .mobile-minimap-toggle .label{display:none}',
    '#nyc[data-touch="active"] .mobile-minimap-toggle .mark::before{content:"-"}',
    '#nyc[data-touch="active"] .minimap-slot.mobile-minimap-collapsed{width:62px;height:36px}',
    '#nyc[data-touch="active"] .mobile-minimap-collapsed .minimap{',
    'opacity:0;transform:scale(.44);pointer-events:none}',
    '#nyc[data-touch="active"] .mobile-minimap-collapsed .mobile-minimap-toggle{',
    'inset:0;width:62px;height:36px;gap:5px;border-radius:9px;font-size:16px}',
    '#nyc[data-touch="active"] .mobile-minimap-collapsed .mobile-minimap-toggle .label{',
    'display:inline;font-size:11px;letter-spacing:.1em;text-transform:uppercase}',
    '#nyc[data-touch="active"] .mobile-minimap-collapsed .mobile-minimap-toggle .mark::before{content:"+"}',
    '#nyc .traffic-density{',
    'display:flex;width:284px;padding:6px 8px 7px;flex-direction:column;gap:4px;',
    'border:1px solid rgba(255,255,255,.14);border-radius:7px;',
    'background:rgba(9,11,15,.72);box-shadow:0 3px 12px rgba(0,0,0,.32);',
    'pointer-events:auto;text-shadow:var(--shadow)}',
    '#nyc .traffic-density[hidden]{display:none}',
    '#nyc .traffic-density label{display:flex;align-items:center;justify-content:space-between;',
    'font:600 10px/1 var(--head);letter-spacing:.1em;text-transform:uppercase;color:rgba(244,246,248,.72)}',
    '#nyc .traffic-density output{color:#fff;font-variant-numeric:tabular-nums}',
    '#nyc .traffic-density input{width:100%;height:16px;margin:0;padding:0;accent-color:#ffbe3d;touch-action:pan-x}',
    '#nyc[data-touch="active"] .traffic-density{order:-1;width:140px;padding:5px 7px 6px}',
    '@media (prefers-reduced-motion:reduce){',
    '#nyc[data-touch="active"] .minimap-slot,#nyc[data-touch="active"] .minimap{transition:none!important}}',
  ].join('');
  document.head.appendChild(style);

  function install() {
    var root = document.getElementById('nyc');
    var slot = root && root.querySelector('.minimap-slot');
    var map = slot && slot.querySelector('.minimap');
    if (!slot || !map) return false;
    if (slot.parentElement.querySelector('.traffic-density')) return true;

    var hud = slot.parentElement;
    var content = document.createElement('div');
    content.className = 'hud-content';
    content.id = 'nyc-hud-content';
    while (hud.firstChild) content.appendChild(hud.firstChild);
    var hudButton = document.createElement('button');
    hudButton.type = 'button';
    hudButton.className = 'hud-toggle ia';
    hudButton.setAttribute('aria-controls', content.id);
    hudButton.innerHTML = '<span>HUD</span><span class="mark" aria-hidden="true"></span>';
    function setHudCollapsed(collapsed) {
      content.hidden = collapsed;
      hudButton.setAttribute('aria-expanded', String(!collapsed));
      hudButton.setAttribute('aria-label', collapsed ? 'Expand HUD' : 'Collapse HUD');
      hudButton.querySelector('.mark').textContent = collapsed ? '+' : '\u2212';
    }
    hudButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setHudCollapsed(!content.hidden);
    });
    hudButton.addEventListener('keydown', function (event) { event.stopPropagation(); });
    hudButton.addEventListener('keyup', function (event) { event.stopPropagation(); });
    hud.append(hudButton, content);
    setHudCollapsed(false);

    if (touchDevice) {
      if (!map.id) map.id = 'mobile-minimap-canvas';
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'mobile-minimap-toggle ia';
      button.setAttribute('aria-controls', map.id);
      button.innerHTML = '<span class="label">Map</span><span class="mark" aria-hidden="true"></span>';

      function setCollapsed(collapsed) {
        slot.classList.toggle('mobile-minimap-collapsed', collapsed);
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', collapsed ? 'Expand map' : 'Collapse map');
      }

      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        setCollapsed(!slot.classList.contains('mobile-minimap-collapsed'));
      });
      slot.appendChild(button);
      setCollapsed(false);
    }

    var control = document.createElement('div');
    control.className = 'traffic-density ia';
    control.hidden = true;
    var label = document.createElement('label');
    label.htmlFor = 'admin-traffic-density';
    label.innerHTML = '<span>Traffic density</span>';
    var value = document.createElement('output');
    value.htmlFor = 'admin-traffic-density';
    value.textContent = '100%';
    label.appendChild(value);
    var slider = document.createElement('input');
    slider.id = 'admin-traffic-density';
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '10';
    slider.value = '100';
    slider.setAttribute('aria-label', 'Traffic density');
    control.append(label, slider);
    slot.insertAdjacentElement('afterend', control);

    var baseCap = null;
    var adminCap = null;
    var wasAdmin = false;
    function context() {
      return window.__game && window.__game.ctx;
    }
    function syncAdmin() {
      var ctx = context();
      var admin = !!(ctx && ctx.state && ctx.state.admin);
      control.hidden = !admin;
      if (!ctx || !ctx.quality) return;
      if (admin && baseCap === null) {
        baseCap = Math.max(0, Math.round(ctx.quality.maxTraffic));
        adminCap = Math.max(ADMIN_TRAFFIC_CAP, baseCap);
      }
      if (admin && !wasAdmin && adminCap !== null) {
        slider.value = '100';
        value.textContent = '100%';
        ctx.quality.maxTraffic = adminCap;
      }
      if (!admin && wasAdmin && baseCap !== null) {
        ctx.quality.maxTraffic = baseCap;
        slider.value = '100';
        value.textContent = '100%';
      }
      wasAdmin = admin;
    }
    slider.addEventListener('input', function () {
      var ctx = context();
      if (!ctx || !ctx.state.admin || !ctx.quality || adminCap === null) return;
      var percent = Math.max(0, Math.min(100, Number(slider.value)));
      ctx.quality.maxTraffic = Math.round(adminCap * percent / 100);
      value.textContent = percent + '%';
    });
    syncAdmin();
    window.setInterval(syncAdmin, 500);
    return true;
  }

  if (install()) return;
  var observer = new MutationObserver(function () {
    if (install()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
