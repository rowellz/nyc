import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { parse } from 'acorn';
import { JSDOM } from 'jsdom';
import { createWorld } from '../src/lib/server/world.js';
import { LANDMARKS } from '../src/lib/shared/constants.js';
import { GAME_VERSION, PROTOCOL_VERSION } from '../src/lib/shared/protocol.js';
import { serveStatic } from '../src/lib/server/static.js';
import { scoreFreeAssetPaths } from '../src/lib/server/score-free-assets.js';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(data) { if (typeof data === 'string') this.messages.push(JSON.parse(data)); }
  control(msg) { this.emit('message', Buffer.from(JSON.stringify(msg)), false); }
  close() { this.readyState = 3; this.emit('close'); }
  terminate() { this.close(); }
}
function noScores(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['score', 'kills', 'leaderboard', 'delta'].includes(key), `Unexpected ${key}`);
    if (key === 't') assert.ok(!['score', 'leaderboard'].includes(child));
    noScores(child);
  }
}

test('discovery, survival, combat and reconnect work without accumulating scores', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000000 });
  const world = createWorld({ admin: true, log() {} }).start();
  t.after(() => world.stop());
  const connect = (token) => {
    const ws = new Socket();
    world.addConnection(ws);
    ws.control({ t: 'hello', name: 'Test', token, protocol: PROTOCOL_VERSION, version: GAME_VERSION });
    return ws;
  };
  const a = connect(), b = connect();
  const welcome = a.messages.find((m) => m.t === 'welcome');
  const victim = b.messages.find((m) => m.t === 'welcome');
  const landmark = LANDMARKS.find((l) => l.id === 'times-square');
  a.control({ t: 'adminTeleport', x: landmark.x, y: 0, z: landmark.z });
  t.mock.timers.tick(100);
  const discovery = a.messages.find((m) => m.t === 'discover' && m.name === landmark.name);
  assert.equal(discovery?.first, true);
  b.control({ t: 'adminTeleport', x: landmark.x, y: 0, z: landmark.z });
  t.mock.timers.tick(100);
  assert.equal(b.messages.find((m) => m.t === 'discover' && m.name === landmark.name)?.first, false);
  for (let i = 0; i < 7; i++) {
    for (const ws of [a, b]) ws.control({ t: 'ping', ct: i });
    t.mock.timers.tick(10000);
  }
  assert.equal(a.messages.filter((m) => m.t === 'discover' && m.name === landmark.name).length, 1);
  assert.ok(a.messages.some((m) => m.t === 'names'));
  a.control({ t: 'adminTeleport', x: 300, y: 0, z: 0 });
  b.control({ t: 'adminTeleport', x: 303, y: 0, z: 0 });
  b.control({ t: 'shoot', w: 1, ox: 303, oy: 1.2, oz: 0, dx: 0, dy: 1, dz: 0, seq: 0 });
  for (let i = 0; i < 6; i++) a.control({ t: 'shoot', w: 1, ox: 300, oy: 1.2, oz: 0, dx: 1, dy: 0, dz: 0, seq: i });
  assert.ok(a.messages.some((m) => m.t === 'death' && m.victimId === victim.id));
  b.control({ t: 'respawn' });
  assert.ok(b.messages.some((m) => m.t === 'respawned'));
  a.control({ t: 'leaderboard' }); // Old clients cannot reactivate the retired feature.
  noScores(a.messages);
  noScores(b.messages);
  noScores(world.status());
  a.close();
  const returning = connect(welcome.token);
  const restored = returning.messages.find((m) => m.t === 'welcome');
  assert.equal(restored.restored, true);
  assert.equal(restored.name, welcome.name);
  noScores(restored);
});

const served = new Map();
for (const path of scoreFreeAssetPaths) {
  const response = await serveStatic(path);
  assert.equal(response.status, 200);
  served.set(path, await response.text());
}
test('served client bundles parse and contain no gameplay scores or leaderboard', () => {
  for (const [path, source] of served) {
    parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const withoutImports = source.replace(/import[^;]+;/g, '');
    assert.doesNotMatch(withoutImports, /leaderboard|\bscore\b|scoreVal|scoreTick|scoreTarget|lastScore/i, path);
  }
});

function declaration(source, name) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration' && node.id.name === name) return source.slice(node.start, node.end);
    for (const d of node.declarations ?? []) {
      if (d.id.name === name) return `var ${source.slice(d.start, d.end)};`;
    }
  }
  throw new Error(`Missing declaration ${name}`);
}

test('served HUD and death screen show vitals and support respawn without a score', () => {
  const dom = new JSDOM('<div id="nyc"></div>', { runScripts: 'outside-only' });
  try {
    const source = served.get('world/assets/ui-BQvfutKN.js');
    const w = dom.window, root = w.document.getElementById('nyc');
    let tick;
    w.setInterval = (fn) => { tick = fn; return 1; };
    const code = ['w', 'ee', 'Q', '$', 'pe'].map((n) => declaration(source, n)).join('\n');
    w.eval(code + '\nwindow.Hud=ee;window.DeathScreen=pe;');
    const hud = new w.Hud(root);
    hud.setHealth(75, 0);
    hud.setOnline(2);
    assert.equal(root.querySelector('.health-value').textContent, '75 HP');
    assert.match(root.querySelector('.online').textContent, /2 in the city/);
    assert.equal(root.querySelector('.score-val, .score-label, .pops, .lb'), null);
    let respawned = false;
    const death = new w.DeathScreen(root, () => { respawned = true; });
    death.show('Other player', { weapon: 'Pistol', where: 'on Broadway' });
    assert.match(root.querySelector('.death .by').textContent, /Other player.*Pistol/);
    assert.equal(root.querySelector('.death .where').textContent, 'on Broadway');
    assert.equal(root.querySelector('.kept, .lb-slot'), null);
    assert.ok(root.querySelector('.death button').disabled);
    tick(); tick(); tick();
    root.querySelector('.death button').click();
    assert.equal(respawned, true);
    death.hide();
    death.show('You drowned', {}, true);
    assert.ok(root.querySelector('.death button').disabled);
    assert.equal(root.querySelector('.death .cd').textContent, '…');
  } finally { dom.window.close(); }
});

test('served UI runs gameplay, discovery, death and respawn without leaderboard requests', async () => {
  const dom = new JSDOM('<canvas id="game"></canvas><div id="root"></div>', { runScripts: 'outside-only' });
  try {
    const w = dom.window, source = served.get('world/assets/ui-BQvfutKN.js');
    // Keep the actual HUD, death screen and coordinator. Stub the map/rendering
    // modules so this exercises the game UI without requiring WebGL.
    w.eval(`class Piece {
      el=document.createElement('div'); canvas=document.createElement('canvas');
      load(){} show(){} hide(){} clear(){} dispose(){} update(){} setError(){}
      setAdminAllowed(){} setCompact(){} nameAt(){return null;}
    }
    var _=Piece,ie=Piece,ae=Piece,ue=Piece,ge=Piece,he=Piece,g=Piece,me=Piece;
    var p=()=>{},l=()=>({}),u=()=>false,a={},b=3,ve=new Set(),_e=2.236936,i={Protected:2};
    ` + ['w', 'ee', 'Q', '$', 'pe', 'xe'].map((n) => declaration(source, n)).join('\n') + '\nwindow.createUi=xe;');
    const listeners = new Map(), sent = [];
    const ctx = {
      state: {
        local: { name: 'Test', token: 'token', state: { x: 0, z: 0, health: 100, flags: 0, weapon: 0 }, armor: 0, inventory: { current: 0, weapons: [] } },
        online: 1, welcomed: true, safeZone: { x: 0, z: 0, radius: 115 }, serverTime: () => 0, ping: 0,
      },
      uiRoot: w.document.getElementById('root'), canvas: w.document.getElementById('game'),
      world: { ready: true, nearestRoad: () => null, roadsNear: () => [] },
      input: { releaseAll() {}, releaseLock() {}, requestLock() {} },
      net: { send: (msg) => sent.push(msg) }, modules: new Map(), quality: { level: 'low' }, stats: { fps: 60 },
      events: { on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name); } },
    };
    const ui = await w.createUi(ctx);
    ui.update(0.016, 1);
    w.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'Tab' }));
    ui.update(0.016, 2);
    listeners.get('discover')({ name: 'Times Square', kind: 'landmark', first: true });
    assert.match(ctx.uiRoot.textContent, /Times SquareFirst to find/);
    listeners.get('localDeath')('Other player', 0);
    ui.update(0.016, 3);
    assert.equal(w.__ui.state().overlay, 'death');
    listeners.get('localRespawn')();
    ui.update(0.016, 4);
    assert.equal(w.__ui.state().overlay, 'none');
    assert.deepEqual(sent, []);
    assert.equal(listeners.has('score'), false);
    assert.equal(listeners.has('leaderboard'), false);
    assert.doesNotMatch(ctx.uiRoot.textContent, /score|leaderboard|undefined|NaN/i);
    ui.dispose();
  } finally { dom.window.close(); }
});
