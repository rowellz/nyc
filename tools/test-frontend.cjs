/**
 * Frontend smoke test: site routes render, and /play wires up the real client
 * bundle and boots it through the proxy.
 *
 *   npm i -g playwright && playwright install chromium
 *   BASE=http://localhost:3000 node tools/test-frontend.cjs
 *
 * Boots with ?modules=none so it checks the wiring without waiting for a full
 * city build - a complete render under software GL takes minutes.
 */
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('This test needs Playwright:\n  npm i -g playwright && playwright install chromium\n' +
    'Then run it with NODE_PATH pointing at the install, e.g.\n' +
    '  NODE_PATH=$(npm root -g) node tools/test-frontend.cjs');
  process.exit(2);
}
const BASE = process.env.BASE || 'http://127.0.0.1:3000';
let fails = 0;
const check = (ok, label, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) fails++;
};

(async () => {
  console.log(`\ntarget: ${BASE}\n`);

  // --- site routes -------------------------------------------------------
  for (const [path, needle] of [['/', 'New York'], ['/spots', 'viewpoints'], ['/status', 'Status']]) {
    const res = await fetch(`${BASE}${path}`);
    const body = await res.text();
    check(res.status === 200 && body.includes(needle), `${path} renders`, `status=${res.status}`);
  }
  const spotsHtml = await (await fetch(`${BASE}/spots`)).text();
  const cards = (spotsHtml.match(/class="spot card[^"]*"/g) || []).length;
  check(cards === 29, 'all 29 viewpoints listed', `${cards} cards`);

  // --- /play wiring ------------------------------------------------------
  // SSR: does /play reference the hashed bundle, and is it reachable through the proxy?
  const html = await (await fetch(`${BASE}/play?spot=flatiron`)).text();
  const mod = html.match(/\/world\/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[0];
  check(!!mod, 'SSR references the hashed client bundle', mod || '');
  check(/id="loading-bar"/.test(html) && /id="ui"/.test(html), 'SSR emits the DOM the bundle expects');
  const modRes = await fetch(`${BASE}${mod}`);
  check(modRes.status === 200, 'bundle is fetchable through the proxy', `status=${modRes.status}`);

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const failed = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${new URL(r.url()).pathname}`); });

  // ?modules=none keeps the boot cheap: core only, no city geometry to build.
  await page.goto(`${BASE}/play?spot=flatiron&q=low&nohud=1&modules=none`, { waitUntil: 'load', timeout: 90000 });

  let canvas = false;
  try {
    await page.waitForFunction(() => !!document.getElementById('game'), null, { timeout: 120000, polling: 1000 });
    canvas = true;
  } catch { /* reported */ }
  check(canvas, 'bundle created its <canvas> inside the Svelte route');

  let streamed = false;
  try {
    await page.waitForFunction(
      () => !!window.__game && window.__game.ctx.world.index !== null,
      null, { timeout: 180000, polling: 2000 },
    );
    streamed = true;
  } catch { /* reported */ }
  check(streamed, 'world index loaded through the proxy');

  const info = await page.evaluate(() => {
    const g = window.__game;
    return g ? { tiles: g.ctx.world.index?.tiles.length ?? 0, ver: g.ctx.state.version } : null;
  }).catch(() => null);
  check(!!info && info.tiles === 3697, 'client sees all 3,697 tiles', info ? `${info.tiles} tiles, v${info.ver}` : '');
  check(failed.length === 0, 'no failed requests through the proxy', failed.slice(0, 3).join(', '));
  check(errors.length === 0, 'no uncaught page errors', errors[0] || '');

  await browser.close();
  console.log(`\n${fails === 0 ? 'CONTAINERIZED /play OK' : fails + ' FAILED'}`);
  process.exit(fails ? 1 : 0);
})();
