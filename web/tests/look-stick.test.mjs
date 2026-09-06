/** Drives the injected look stick through jsdom and checks what it feeds the client. */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = fs.readFileSync(new URL('../static/world-addons/look-stick.js', import.meta.url), 'utf8');

let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function boot({ search = '', touch = true } = {}) {
  // The client builds #touch-controls hidden and only un-hides it for real touch.
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="nyc"><div id="touch-controls" hidden><style>x{}</style>' +
      '<div class="stick"></div><div class="look"></div><div class="actions"></div></div></div>' +
      '<canvas></canvas></body></html>',
    { url: 'http://localhost:3000/world/' + search, runScripts: 'outside-only' },
  );
  const w = dom.window;
  const looks = [];
  const keys = new Set();
  const mouse = [];
  w.__game = { ctx: { input: {
    touch,
    keys,
    addTouchLook(dx, dy) { looks.push({ dx, dy }); },
  } } };
  for (const type of ['mousedown', 'mousemove', 'mouseup']) {
    w.addEventListener(type, (e) => mouse.push({ type, x: e.clientX, y: e.clientY }));
  }
  const frames = [];
  w.requestAnimationFrame = (cb) => frames.push(cb);
  w.setInterval = () => 0;
  w.HTMLElement.prototype.setPointerCapture = function () {};
  const container = w.document.getElementById('touch-controls');
  // ui/index.ts:408 — touchActive requires real touch AND not screenshot mode,
  // so the client only ever un-hides its overlay in play mode.
  const screenshotMode = /[?&](spot|fly)=/.test(search);
  if (touch && !screenshotMode) container.hidden = false;
  w.eval(SRC);

  const overlay = w.document.querySelector('.ls-overlay');
  const stick = (overlay || container).querySelector('.ls-look');
  const moveStick = (overlay || container).querySelector('.ls-move');
  const rect = (el) => {
    if (el) el.getBoundingClientRect = () => ({ left: 100, top: 100, width: 116, height: 116, right: 216, bottom: 216 });
  };
  rect(stick);
  rect(moveStick);
  const at = (el, type, clientX, clientY, pointerId = 1) => {
    const e = new w.Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { clientX, clientY, pointerId });
    el.dispatchEvent(e);
  };
  const fire = (type, clientX, clientY, pointerId = 1) => at(stick, type, clientX, clientY, pointerId);
  const fireMove = (type, clientX, clientY, pointerId = 2) => at(moveStick, type, clientX, clientY, pointerId);
  // run one animation frame of `dt` seconds
  let t = 0;
  const step = (dt) => { t += dt * 1000; const q = frames.splice(0, frames.length); for (const cb of q) cb(t); };
  step(0); // the script schedules its loop at load; prime `last`
  return { w, container, overlay, stick, moveStick, looks, keys, mouse, fire, fireMove, step };
}

console.log('=== installation ===');
{
  const { container, stick } = boot();
  check(!!stick, 'a look stick is added to #touch-controls');
  check(container.lastElementChild === stick, 'it is the last child, so it wins where it overlaps the drag zone');
  check(stick.querySelector('.ls-knob') !== null, 'it carries a knob');
  const css = [...container.querySelectorAll('style')].map((s) => s.textContent).join('');
  check(css.includes('.ls-stick'), 'its stylesheet is appended after the client’s');
  check(/\.actions\{bottom:calc/.test(css), 'the action buttons are moved above it');
}

console.log('\n=== gating ===');
{
  const { stick } = boot({ touch: false });
  check(stick === null, 'not installed on a device without touch');
}
{
  const { container, stick } = boot({ touch: false, search: '?lookstick=1' });
  check(stick !== null, '?lookstick=1 forces it on for desktop testing');
  check(container.hidden === false, 'and reveals the overlay the client leaves hidden without touch');
}
{
  const { stick } = boot({ search: '?lookstick=0' });
  check(stick === null, '?lookstick=0 turns it off');
}

console.log('\n=== look deltas (720 px/s at full deflection, 0.15 dead zone) ===');
{
  const { container, stick, looks, fire, step } = boot();
  check(container.hidden === false, 'the overlay is visible on a touch device');
  step(0.1);
  check(looks.length === 0, 'idle stick sends nothing');

  fire('pointerdown', 158, 158);           // dead centre
  step(0.1);
  check(looks.length === 0, 'centre is inside the dead zone');

  fire('pointermove', 158 + 200, 158);     // far right: clamps to full deflection
  step(0.1);
  check(looks.length === 1 && near(looks[0].dx, 72) && near(looks[0].dy, 0),
    'full right = +72 px in 100 ms (720 px/s)', looks[0] && `dx=${looks[0].dx.toFixed(2)} dy=${looks[0].dy.toFixed(2)}`);

  const knob = stick.querySelector('.ls-knob');
  check(knob.style.transform === 'translate(36px,0px)', 'knob is pinned at the rim', knob.style.transform);

  looks.length = 0;
  fire('pointermove', 158, 158 - 200);     // straight up
  step(0.05);
  check(looks.length === 1 && near(looks[0].dy, -36) && near(looks[0].dx, 0),
    'pushing up looks up, and the rate scales with frame time', looks[0] && `dy=${looks[0].dy.toFixed(2)}`);

  looks.length = 0;
  fire('pointermove', 158 + 4, 158);       // |v| = 4/42 = 0.095, under the dead zone
  step(0.1);
  check(looks.length === 0, 'small deflections are ignored');

  looks.length = 0;
  fire('pointermove', 158 + 21, 158);      // |v| = 0.5 -> ramped to (0.5-0.15)/0.85
  step(0.1);
  const want = ((0.5 - 0.15) / 0.85) * 720 * 0.1;
  check(looks.length === 1 && near(looks[0].dx, want, 1e-6),
    'half deflection ramps from the dead zone, not from zero', looks[0] && `dx=${looks[0].dx.toFixed(2)} want=${want.toFixed(2)}`);

  looks.length = 0;
  fire('pointerup', 158 + 21, 158);
  step(0.1);
  check(looks.length === 0, 'releasing stops the camera');
  check(knob.style.transform === '', 'knob recentres on release');
}

console.log('\n=== diagonal + tuning ===');
{
  const { w, looks, fire, step } = boot();
  fire('pointerdown', 158 + 300, 158 + 300);
  step(0.1);
  const m = Math.hypot(looks[0].dx, looks[0].dy);
  check(near(m, 72, 1e-6), 'diagonal is clamped to the same 720 px/s, not 1.41x', `|v|=${m.toFixed(2)}`);

  looks.length = 0;
  w.__lookStick.rate = 360;
  step(0.1);
  check(near(Math.hypot(looks[0].dx, looks[0].dy), 36, 1e-6), '__lookStick.rate retunes it live');
}
{
  const { looks, fire, step } = boot({ search: '?looksens=360' });
  fire('pointerdown', 158 + 300, 158);
  step(0.1);
  check(near(looks[0].dx, 36, 1e-6), '?looksens=360 halves the rate', `dx=${looks[0].dx.toFixed(2)}`);
}


console.log('\n=== camera mode (?spot=): the client disables input entirely ===');
{
  const { container, overlay, stick, moveStick } = boot({ search: '?spot=times-square' });
  check(overlay !== null, 'it puts up its own overlay, not the client’s hidden one');
  check(container.hidden === true, 'and leaves the client’s overlay hidden');
  check(!!stick && !!moveStick, 'with both sticks: move and look');
}

console.log('\n--- left stick -> input.keys, which the free camera reads directly ---');
{
  const { keys, fireMove, step } = boot({ search: '?spot=times-square' });
  fireMove('pointerdown', 158, 158 - 30);        // forward, 0.71 deflection
  step(0.05);
  check(keys.has('KeyW') && keys.size === 1, 'forward holds KeyW alone', [...keys].join(','));

  fireMove('pointermove', 158 + 30, 158 + 30);   // back-right, past the fast threshold
  step(0.05);
  check(keys.has('KeyS') && keys.has('KeyD'), 'diagonal holds two keys', [...keys].join(','));
  check(keys.has('ShiftLeft'), 'and leaning to the rim asks the free camera for fast');
  check(!keys.has('KeyW'), 'the stale key is released');

  fireMove('pointermove', 158 + 8, 158);         // inside the move threshold
  step(0.05);
  check(keys.size === 0, 'a gentle lean holds nothing');

  fireMove('pointermove', 158 - 30, 158);
  step(0.05);
  check(keys.has('KeyA'), 'left holds KeyA');
  fireMove('pointerup', 158 - 30, 158);
  step(0.05);
  check(keys.size === 0, 'releasing lets every key go');
}

console.log('\n--- right stick -> the mouse drag the free camera listens for ---');
{
  const { mouse, looks, fire, step } = boot({ search: '?spot=times-square' });
  fire('pointerdown', 158 + 200, 158);
  check(mouse.length === 1 && mouse[0].type === 'mousedown', 'grabbing starts a synthetic drag');
  const origin = mouse[0].x;

  step(0.1);
  const moved = mouse.filter((m) => m.type === 'mousemove');
  check(moved.length === 1, 'one mousemove per frame while held');
  // 720 px/s * 0.1 s, scaled by 0.0022/0.0035 so the angle matches play mode
  const want = 72 * (0.0022 / 0.0035);
  check(near(moved[0].x - origin, want, 1e-6),
    'scaled so a full lean turns at the same rate as in play mode',
    `dx=${(moved[0].x - origin).toFixed(2)} want=${want.toFixed(2)}`);
  check(looks.length === 0, 'and addTouchLook is not used — it is a no-op while input is disabled');

  fire('pointerup', 158 + 200, 158);
  check(mouse[mouse.length - 1].type === 'mouseup', 'releasing ends the drag');
  const before = mouse.length;
  step(0.1);
  check(mouse.length === before, 'nothing moves once the thumb is off');
}

console.log('\n--- play mode is unchanged by any of this ---');
{
  const { overlay, keys, looks, fire, step } = boot();
  check(overlay === null, 'no extra overlay in play mode');
  fire('pointerdown', 158 + 200, 158);
  step(0.1);
  check(looks.length === 1 && near(looks[0].dx, 72), 'still feeds addTouchLook at the unscaled rate');
  check(keys.size === 0, 'and never touches input.keys');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
