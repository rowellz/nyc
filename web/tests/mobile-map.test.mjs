/** Exercises the injected collapsible mobile minimap control in jsdom. */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { ADDONS } from '../src/lib/server/client-addons.js';

const SRC = fs.readFileSync(new URL('../static/world-addons/mobile-map.js', import.meta.url), 'utf8');

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}`);
  if (!ok) failures++;
};

function boot({ touch = true, search = '', admin = false, cap = 20 } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body><div id="nyc" data-touch="${touch ? 'active' : 'off'}">` +
      '<div class="hud bl"><div class="chips"></div><div class="minimap-slot">' +
      '<canvas class="minimap"></canvas></div><div class="bars"></div></div></div></body></html>',
    { url: `http://localhost:3000/world/${search}`, runScripts: 'outside-only' },
  );
  Object.defineProperty(dom.window.navigator, 'maxTouchPoints', { value: touch ? 1 : 0 });
  dom.window.matchMedia = () => ({ matches: false });
  dom.window.__game = { ctx: { state: { admin }, quality: { maxTraffic: cap } } };
  const intervals = [];
  dom.window.setInterval = (fn) => { intervals.push(fn); return intervals.length; };
  dom.window.eval(SRC);
  dom.runIntervals = () => intervals.forEach((fn) => fn());
  return dom;
}

console.log('=== installation and placement ===');
{
  const dom = boot();
  const { document } = dom.window;
  const slot = document.querySelector('.minimap-slot');
  const button = document.querySelector('.mobile-minimap-toggle');
  check(!!button, 'touch HUD gets a minimap toggle');
  check(button?.getAttribute('aria-expanded') === 'true', 'map starts expanded');
  check(button?.getAttribute('aria-label') === 'Collapse map', 'expanded control has an accessible label');
  check(document.getElementById('mobile-map-style')?.textContent.includes('order:-2'), 'map slot is placed before the status chips');
  check(document.getElementById('mobile-map-style')?.textContent.includes('.hud.bl{'), 'whole mobile HUD stack is explicitly anchored');
  check(document.getElementById('mobile-map-style')?.textContent.includes('safe-area-inset-top) + 12px'), 'upper-left anchor clears the device safe area');
  check(slot?.lastElementChild === button, 'toggle sits over the minimap');
  dom.window.close();
}

console.log('\n=== collapse and expand ===');
for (const touch of [false, true]) {
  const dom = boot({ touch, admin: true });
  const { document } = dom.window;
  const button = document.querySelector('.hud-toggle');
  const content = document.getElementById(button.getAttribute('aria-controls'));
  const bars = document.querySelector('.bars');
  const slider = document.querySelector('.traffic-density input');
  check(button.getAttribute('aria-expanded') === 'true' && !content.hidden, `${touch ? 'mobile' : 'desktop'} HUD starts expanded`);
  check(content.contains(bars) && content.contains(slider) && content.contains(document.querySelector('.minimap-slot')), 'toggle controls map, vitals, and admin controls together');
  let bubbled = false;
  document.addEventListener('click', () => { bubbled = true; });
  button.click();
  check(content.hidden && dom.window.getComputedStyle(content).display === 'none', 'collapse hides the entire HUD content');
  check(!content.contains(button) && button.getAttribute('aria-label') === 'Expand HUD', 'expand button remains outside hidden content');
  check(button.getAttribute('aria-expanded') === 'false' && !bubbled, 'collapse announces state without passing the click to the game');
  bars.textContent = '75 HP';
  slider.value = '40';
  slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  dom.runIntervals();
  check(content.hidden, 'admin refresh does not reopen the HUD');
  button.click();
  check(!content.hidden && button.getAttribute('aria-expanded') === 'true', 'second click restores the HUD');
  check(document.querySelector('.bars') === bars && bars.textContent === '75 HP' && slider.value === '40', 'expanding preserves live content and control state');
  dom.window.close();
}
{
  const dom = boot();
  const { document } = dom.window;
  const slot = document.querySelector('.minimap-slot');
  const button = document.querySelector('.mobile-minimap-toggle');
  button.click();
  check(slot.classList.contains('mobile-minimap-collapsed'), 'one tap collapses the map');
  check(button.getAttribute('aria-expanded') === 'false', 'collapsed state is announced');
  check(button.getAttribute('aria-label') === 'Expand map', 'collapsed control explains its action');
  button.click();
  check(!slot.classList.contains('mobile-minimap-collapsed'), 'second tap expands the map');
  check(button.getAttribute('aria-expanded') === 'true', 'expanded state is restored');
  dom.window.close();
}

console.log('\n=== admin traffic density ===');
{
  const dom = boot({ admin: true, cap: 20 });
  const { document } = dom.window;
  const control = document.querySelector('.traffic-density');
  const slider = control.querySelector('input');
  check(control.hidden === false, 'traffic slider is visible to admins');
  check(slider.value === '20', 'slider starts at the device budget');
  check(slider.max === '400' && dom.window.__game.ctx.quality.maxTraffic === 20, 'admin ceiling is available without automatically increasing traffic');
  slider.value = '40';
  slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  check(dom.window.__game.ctx.quality.maxTraffic === 40, 'admins explicitly choose an increased traffic budget');
  check(control.querySelector('output').textContent === '40 cars', 'selected car budget is shown');

  dom.window.__game.ctx.state.admin = false;
  dom.runIntervals();
  check(control.hidden === false && slider.max === '20', 'control keeps the standard range on admin logout');
  check(dom.window.__game.ctx.quality.maxTraffic === 20, 'normal traffic budget is restored on admin logout');
  dom.window.close();
}
{
  const dom = boot({ admin: true, cap: 480 });
  check(dom.window.__game.ctx.quality.maxTraffic === 480, 'the control preserves a larger native traffic budget');
  dom.window.close();
}
{
  const dom = boot({ admin: false, cap: 6 });
  const control = dom.window.document.querySelector('.traffic-density');
  const slider = control.querySelector('input');
  check(!control.hidden, 'non-admin players on port 3000 see the slider');
  check(slider.value === '6' && slider.max === '6', 'iPhone retains its six-car default');
  slider.value = '2';
  slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  check(dom.window.__game.ctx.quality.maxTraffic === 2, 'regular players can lower traffic density');
  dom.window.__game.ctx.state.admin = true;
  dom.runIntervals();
  check(slider.max === '400' && slider.value === '2', 'admin status expands the range without changing the selection');
  dom.window.__game.ctx.state.admin = false;
  dom.runIntervals();
  check(slider.max === '6' && slider.value === '2', 'lower user selection survives admin logout');
  slider.value = '0';
  slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  dom.runIntervals();
  check(dom.window.__game.ctx.quality.maxTraffic === 0, 'zero traffic remains zero after refresh');
  dom.window.close();
}

console.log('\n=== gating and delivery ===');
{
  const desktop = boot({ touch: false });
  check(!desktop.window.document.querySelector('.mobile-minimap-toggle'), 'desktop map is not made collapsible');
  desktop.window.close();

  const forced = boot({ touch: false, search: '?mobilemap=1' });
  check(!!forced.window.document.querySelector('.mobile-minimap-toggle'), 'query flag enables desktop testing');
  forced.window.close();

  const disabled = boot({ search: '?mobilemap=0' });
  check(!disabled.window.document.querySelector('.mobile-minimap-toggle'), 'query flag can disable the addon');
  check(!disabled.window.document.querySelector('.hud-toggle'), 'disabled addon leaves the HUD untouched');
  disabled.window.close();

  check(ADDONS['world/index.html'].includes('/world-addons/mobile-map.js'), 'play page injects the addon');
  check(!ADDONS['world/safe.html'].includes('/world-addons/mobile-map.js'), 'safe page is unchanged');
}

if (failures) {
  console.error(`\n${failures} mobile minimap test(s) failed`);
  process.exit(1);
}
console.log('\nAll mobile minimap tests passed.');
