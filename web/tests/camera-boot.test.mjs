/**
 * The iOS crash guard, and the two addons that keep camera mode out of it.
 *
 * Models core/crashGuard.ts: every load pushes a start into localStorage under
 * CRASH_KEY, and only markReady() clears it. Two unforgiven starts in five
 * minutes and beginBoot() sends boot.ts to safe mode.
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const CAMERA_BOOT = fs.readFileSync(new URL('../static/world-addons/camera-boot.js', import.meta.url), 'utf8');
const SAFE_RETURN = fs.readFileSync(new URL('../static/world-addons/safe-return.js', import.meta.url), 'utf8');
const CRASH_KEY = 'nyc.unclean-starts.v2';
const STASH_KEY = 'nyc.web.camera-return';

let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

/** One page load, with the crash record beginBoot() would have written. */
function boot({ search = '?spot=times-square', record = { starts: [Date.now()], bootId: 'boot-1' }, drawCalls = 4, safeMode = false } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body><div id="ui">${safeMode ? '<main id="safe-mode"></main>' : ''}</div></body></html>`,
    { url: 'http://localhost:3000/world/' + search, runScripts: 'outside-only' },
  );
  const w = dom.window;
  if (record) w.localStorage.setItem(CRASH_KEY, JSON.stringify(record));
  w.__game = { ctx: { stats: { drawCalls } } };
  const frames = [];
  w.requestAnimationFrame = (cb) => frames.push(cb);
  w.eval(CAMERA_BOOT);
  let t = 0;
  const step = (seconds) => { t += seconds * 1000; const q = frames.splice(0, frames.length); for (const cb of q) cb(t); };
  return { w, step, guard: () => w.localStorage.getItem(CRASH_KEY) };
}

console.log('=== camera mode marks a healthy start clean, the way every other platform does ===');
{
  const { step, guard } = boot();
  step(0);
  step(5);
  check(guard() !== null, 'five seconds in, the guard record still stands');
  step(16);
  check(guard() === null, 'past twenty seconds of a drawing page, the start is forgiven');
}
{
  // Two unforgiven starts is what boot.ts turns into safe mode.
  const { step, guard } = boot({ record: { starts: [Date.now() - 60_000, Date.now()], bootId: 'boot-2' } });
  step(0); step(25);
  check(guard() === null, 'an earlier bad start is cleared too, so the next load is not locked out');
}

console.log('\n=== but it never covers for a real failure ===');
{
  const { w, step, guard } = boot();
  step(0);
  w.dispatchEvent(Object.assign(new w.Event('error'), { error: new Error('OOM') }));
  step(30);
  check(guard() !== null, 'a page error leaves the guard record alone');
}
{
  const { step, guard } = boot({ safeMode: true });
  step(0); step(30);
  check(guard() !== null, 'the client’s own safe-mode panel leaves it alone');
}
{
  const { step, guard } = boot({ drawCalls: 0 });
  step(0); step(30);
  check(guard() !== null, 'a page that never drew is not evidence of anything');
}
{
  const { w, step, guard } = boot({ record: { starts: [Date.now()], bootId: 'boot-1' } });
  step(0);
  // Another tab boots and takes ownership of the record.
  w.localStorage.setItem(CRASH_KEY, JSON.stringify({ starts: [Date.now()], bootId: 'other-tab' }));
  step(30);
  check(guard() !== null, 'another tab’s record is never cleared');
}

console.log('\n=== scope ===');
{
  const { step, guard } = boot({ search: '' });
  step(0); step(30);
  check(guard() !== null, 'play mode is untouched — the client’s rule stands');
}
{
  const { w } = boot({ search: '' });
  check(w.sessionStorage.getItem(STASH_KEY) === null, 'and nothing is stashed for it');
}
{
  const { step, guard } = boot({ search: '?spot=soho&bootguard=0' });
  step(0); step(30);
  check(guard() !== null, '?bootguard=0 keeps the client’s strict rule');
}
{
  const { w } = boot({ search: '?spot=soho' });
  check(w.sessionStorage.getItem(STASH_KEY) === '?spot=soho', 'the viewpoint is stashed for safe.html');
}

console.log('\n=== safe.html offers the viewpoint back ===');
function safePage(stash) {
  const dom = new JSDOM(
    '<!doctype html><html><body><main id="safe-mode"><h1>Safe mode</h1><p>msg</p>' +
      '<button onclick="location.replace(\'./?q=mobile&safe=1\')">Retry in a lighter mode</button>' +
      '</main></body></html>',
    { url: 'http://localhost:3000/world/safe.html', runScripts: 'outside-only' },
  );
  if (stash !== null) dom.window.sessionStorage.setItem(STASH_KEY, stash);
  dom.window.eval(SAFE_RETURN);
  const panel = dom.window.document.getElementById('safe-mode');
  return {
    w: dom.window,
    link: panel.querySelector('a'),
    buttons: [...panel.querySelectorAll('button')],
  };
}
{
  const { link, buttons } = safePage('?spot=brooklyn-bridge&time=18%3A00');
  check(!!link, 'a way back is offered');
  check(link.textContent === 'Retry at brooklyn-bridge', 'named after the viewpoint', link && link.textContent);
  check(buttons.length === 1 && buttons[0].textContent === 'Retry in a lighter mode',
    'the client’s own button is left alone');
  check(link.compareDocumentPosition(buttons[0]) & 4, 'and ours comes first');

  const url = new URL(link.getAttribute('href'), 'http://localhost:3000/world/safe.html');
  check(url.searchParams.get('spot') === 'brooklyn-bridge', 'it goes back to the viewpoint');
  check(url.searchParams.get('time') === '18:00', 'keeping the rest of the parameters', url.search);
  check(url.searchParams.get('safe') === '1', 'with safe=1, which beginBoot() consumes to let one load through');
  check(url.searchParams.get('q') === 'mobile', 'and the lighter preset it promised');
  check(url.pathname === '/world/', 'landing on the client, not back on safe.html', url.pathname);
}
{
  const { link } = safePage(null);
  check(link === null, 'no stash, nothing added');
}
{
  const { link } = safePage('?q=low');
  check(link === null, 'a stash with no viewpoint adds nothing');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
