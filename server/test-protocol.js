/** Headless protocol conformance test: mimics client/src/core/net.ts. */
const WebSocket = require('ws');
const P = require('./protocol');

const URL = `ws://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 8080}/world/ws`;
const clients = [];
const log = (...a) => console.log(...a);
let failures = 0;
const check = (ok, label, extra = '') => {
  log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};

function connect(name, token = null) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.binaryType = 'arraybuffer';
    const api = { ws, welcome: null, msgs: [], snapshots: [], name };
    ws.on('open', () => ws.send(JSON.stringify({
      t: 'hello', name, token, version: '0.2.8', protocol: 1, email: '', newsletter: false,
    })));
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Buffer.from(data);
        const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        if (v.getUint8(0) !== P.BinaryKind.Snapshot) return;
        const serverTime = v.getFloat64(1, true);
        const n = v.getUint16(9, true);
        const states = [];
        let o = 11;
        for (let i = 0; i < n; i++) { states.push(P.readPlayerState(v, o)); o += P.PLAYER_STATE_BYTES; }
        api.snapshots.push({ serverTime, states });
        return;
      }
      const msg = JSON.parse(data.toString());
      api.msgs.push(msg);
      if (msg.t === 'welcome') {
        api.welcome = msg;
        api.pos = { x: msg.spawn.x, z: msg.spawn.z };
        clients.push(api);
        resolve(api);
      }
      if (msg.t === 'registrationRequired' || msg.t === 'welcomeRefused') reject(new Error(msg.t + ': ' + msg.reason));
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('handshake timeout')), 8000);
  });
}

const sendState = (api, patch) => {
  const s = P.emptyState();
  Object.assign(s, { id: api.welcome.id }, patch);
  const buf = new ArrayBuffer(1 + 8 + P.PLAYER_STATE_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, P.BinaryKind.State);
  v.setFloat64(1, Date.now() / 1000, true);
  P.writePlayerState(v, 9, s);
  api.ws.send(Buffer.from(buf));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every connected client streams its state at CLIENT_STATE_HZ, as net.ts does.
setInterval(() => {
  for (const c of clients) {
    if (c.ws.readyState !== 1 || !c.welcome || c.paused) continue;
    sendState(c, { x: c.pos.x, y: 0, z: c.pos.z });
  }
}, 50).unref();

/** Walk a player to a target at <= 60 m/s; the heartbeat above does the sending. */
async function glide(api, tx, tz) {
  for (let i = 0; i < 600; i++) {
    const dx = tx - api.pos.x, dz = tz - api.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const step = Math.min(d, 3.0); // 3 m per 50 ms tick = 60 m/s
    api.pos = { x: api.pos.x + (dx / d) * step, z: api.pos.z + (dz / d) * step };
    await sleep(50);
  }
  await sleep(120); // let the server see the final position
  return api.pos;
}
const waitFor = async (api, t, ms = 3000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const m = api.msgs.find((x) => x.t === t);
    if (m) return m;
    await sleep(50);
  }
  return null;
};

(async () => {
  log('\n=== 1. handshake ===');
  const a = await connect('Ada');
  const w = a.welcome;
  check(w.protocol === 1, 'protocol version is 1', `got ${w.protocol}`);
  check(w.version === '0.2.8', 'game version matches client GAME_VERSION', w.version);
  check(typeof w.token === 'string' && w.token.length > 10, 'issued a token');
  check(/^[a-z]+-[a-z]+-\d{2}$/.test(w.name), 'server assigned a public handle (adjective-animal-NN)', w.name);
  check(w.name !== 'Ada', 'submitted name is NOT used as the public identity');
  check(w.id >= 1 && w.id <= 65535, 'u16 player id', String(w.id));
  check(Number.isFinite(w.serverTime), 'serverTime is finite');
  check(w.dayFraction >= 0 && w.dayFraction < 1, 'dayFraction in [0,1)', w.dayFraction.toFixed(3));
  check(w.dayLength === 7200, 'dayLength = DAY_LENGTH_SECONDS');
  check(w.safeZone && w.safeZone.radius === 115, 'safeZone matches constants.ts');
  check(!!w.weather && typeof w.weather.condition === 'string', 'weather present', w.weather.condition);
  check(!!w.inventory && w.inventory.current === 1, 'starts with the Pistol');
  check(Math.hypot(w.spawn.x, w.spawn.z) < 200, 'spawn is near Bryant Park',
    `x=${w.spawn.x.toFixed(1)} z=${w.spawn.z.toFixed(1)}`);
  check(w.protectedUntil > w.serverTime, 'spawn protection active');
  check(w.era === 'present', 'era field present');

  log('\n=== 2. ping/pong ===');
  a.ws.send(JSON.stringify({ t: 'ping', ct: 12.5 }));
  const pong = await waitFor(a, 'pong');
  check(!!pong && pong.ct === 12.5, 'pong echoes client time');
  check(!!pong && Number.isFinite(pong.st), 'pong carries server time');

  log('\n=== 3. binary state -> snapshot echo ===');
  await glide(a, 10, -5);
  await sleep(300);
  check(a.snapshots.length > 0, 'receiving snapshots', `${a.snapshots.length} in 400ms`);
  const self = a.snapshots.at(-1).states.find((s) => s.id === w.id);
  check(!!self, 'own state echoed in snapshot');
  check(self && Math.abs(self.x - 10) < 0.01 && Math.abs(self.z + 5) < 0.01, 'position round-tripped',
    self ? `x=${self.x} z=${self.z}` : '');
  check(!!(self.flags & P.StateFlag.Protected), 'server set the Protected flag');

  log('\n=== 4. second player: join / names / AOI ===');
  const b = await connect('Grace');
  await glide(b, 13, -5);
  await sleep(400);
  const join = await waitFor(a, 'join');
  check(!!join && join.id === b.welcome.id, 'first player got join for the second');
  const names = await waitFor(a, 'names');
  check(!!names && names.players.some((p) => p.id === b.welcome.id), 'names delivered for AOI player');
  const two = a.snapshots.at(-1).states.length;
  check(two === 2, 'snapshot carries both players', `count=${two}`);

  log('\n=== 5. speed clamp (~70 m/s) ===');
  a.paused = true; // stop the 20 Hz heartbeat so it cannot pull us back
  await sleep(120);
  const before = { ...a.snapshots.at(-1).states.find((s) => s.id === w.id) };
  sendState(a, { x: 5000, y: 0, z: 5000 }); // an impossible jump
  await sleep(200);
  const after = a.snapshots.at(-1).states.find((s) => s.id === w.id);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check(moved > 0.5 && moved < 200, 'impossible jump is clamped, not rejected', `slid ${moved.toFixed(1)} m`);
  check(Math.hypot(after.x - 5000, after.z - 5000) > 4000, 'player did not reach the claimed position');
  a.pos = { x: after.x, z: after.z };
  a.paused = false;

  log('\n=== 6. AOI culling at 350 m ===');
  await glide(a, 20, -5);
  await glide(b, 600, 0); // > 350 m away
  await sleep(400);
  check(a.snapshots.at(-1).states.length === 1, 'far player culled from snapshot',
    `count=${a.snapshots.at(-1).states.length}`);
  await glide(b, 30, -5);
  await sleep(300);
  check(a.snapshots.at(-1).states.length === 2, 'player re-enters AOI');

  log('\n=== 7. safe zone blocks damage ===');
  await glide(a, 10, -5);
  await glide(b, 13, -5); // both inside the 115 m safe zone
  await sleep(200);
  b.msgs.length = 0;
  a.ws.send(JSON.stringify({ t: 'shoot', w: 4, ox: 10, oy: 1.2, oz: -5, dx: 1, dy: 0, dz: 0, ct: 0, seq: 1 }));
  await sleep(300);
  check(!b.msgs.some((m) => m.t === 'health'), 'no damage inside the safe zone');

  log('\n=== 8. damage + death outside the safe zone ===');
  const FIGHT = { x: 300, z: 0 }; // 300 m from origin: outside the 115 m safe zone
  await glide(a, FIGHT.x, FIGHT.z);
  await glide(b, FIGHT.x + 3, FIGHT.z);
  // firing forfeits spawn protection for both
  b.ws.send(JSON.stringify({ t: 'shoot', w: 1, ox: FIGHT.x + 3, oy: 1.5, oz: FIGHT.z, dx: 0, dy: 1, dz: 0, ct: 0, seq: 1 }));
  a.ws.send(JSON.stringify({ t: 'shoot', w: 1, ox: FIGHT.x, oy: 1.5, oz: FIGHT.z, dx: 0, dy: 1, dz: 0, ct: 0, seq: 2 }));
  await sleep(200);

  for (let i = 0; i < 12; i++) {
    a.ws.send(JSON.stringify({ t: 'shoot', w: 4, ox: FIGHT.x, oy: 1.2, oz: FIGHT.z, dx: 1, dy: 0, dz: 0, ct: 0, seq: 10 + i }));
    await sleep(90);
  }
  const hits = a.msgs.filter((m) => m.t === 'hit').length;
  check(hits > 0, 'hitscan registered hits outside the safe zone', `${hits} hits`);
  const health = b.msgs.filter((m) => m.t === 'health').pop();
  check(!!health, 'victim received health updates', health ? `hp=${health.health}` : '');
  const death = a.msgs.find((m) => m.t === 'death');
  check(!!death, 'death broadcast', death ? `${death.killerName} killed #${death.victimId}` : '');
  const score = a.msgs.filter((m) => m.t === 'score').pop();
  check(!!score && score.score >= 100, 'kill scored 100', score ? `score=${score.score}` : '');

  log('\n=== 9. respawn ===');
  b.ws.send(JSON.stringify({ t: 'respawn' }));
  const resp = await waitFor(b, 'respawned');
  check(!!resp, 'respawned message');
  check(!!resp && Math.hypot(resp.x, resp.z) < 200, 'respawn at a Bryant Park spawn point');

  log('\n=== 10. leaderboard ===');
  a.ws.send(JSON.stringify({ t: 'leaderboard' }));
  const lb = await waitFor(a, 'leaderboard');
  check(!!lb && Array.isArray(lb.entries) && lb.entries.length >= 2, 'leaderboard entries');
  check(!!lb && lb.online === 2, 'online count', lb ? String(lb.online) : '');

  log('\n=== 11. token reconnect ===');
  b.ws.close();
  await sleep(300);
  const b2 = await connect('ignored', b.welcome.token);
  b2.pos = { x: b2.welcome.spawn.x, z: b2.welcome.spawn.z };
  check(b2.welcome.restored === true, 'token restored the profile');
  check(b2.welcome.name === b.welcome.name, 'handle persisted across reconnect', b2.welcome.name);
  const leave = await waitFor(a, 'leave');
  check(!!leave, 'leave broadcast on disconnect');

  log('\n=== 12. reload / switchWeapon ===');
  a.ws.send(JSON.stringify({ t: 'reload' }));
  const inv = await waitFor(a, 'inventory');
  check(!!inv, 'inventory after reload');

  a.ws.close(); b2.ws.close();
  await sleep(200);
  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('TEST ERROR:', e.message); process.exit(1); });
