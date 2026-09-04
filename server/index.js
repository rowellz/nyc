/**
 * Reconstructed game server for the "New York" world client.
 *
 * The client half of this app was recovered from the published Vite source maps
 * (see ../src); the server was never shipped to browsers, so this is a fresh
 * implementation of the wire contract documented in ../src/shared/protocol.ts.
 *
 *   GET  /world/*              static client + world tiles
 *   GET  /world/api/admin/me   { admin: boolean }
 *   POST /world/api/telemetry  boot/crash beacons -> 204
 *   WS   /world/ws             JSON control + 34-byte binary player states
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const P = require('./protocol');
const C = require('./constants');

const PORT = Number(process.env.PORT || 8080);
const BASE = process.env.BASE_PATH || '/world';
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const ADMIN = process.env.ADMIN === '1';
const VERBOSE = process.env.VERBOSE === '1';

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.gz': 'application/gzip', '.wasm': 'application/wasm', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
};

function serveStatic(req, res, relPath) {
  // .json.gz tiles are raw gzip bytes served as application/gzip with NO
  // Content-Encoding, matching the origin: the client sniffs the gzip magic
  // bytes itself (src/client/src/core/streamer.worker.ts).
  const rel = decodeURIComponent(relPath).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': st.size,
      'x-content-type-options': 'nosniff',
      'cache-control': ext === '.html' ? 'no-cache'
        : rel.includes('/assets/') ? 'public, max-age=31536000, immutable'
        : 'public, max-age=14400',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (p === '/' || p === BASE) {
    res.writeHead(302, { location: `${BASE}/` });
    res.end();
    return;
  }
  if (p === `${BASE}/api/admin/me`) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ admin: ADMIN }));
    return;
  }
  // Live world state for the SvelteKit frontend to render server-side. Not part
  // of the original protocol - added for frontend/, which has no WebSocket of its own.
  if (p === `${BASE}/api/status`) {
    const online = new Set([...players.values()].map((x) => x.profile));
    const leaderboard = [...byToken.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((prof, i) => ({ rank: i + 1, name: prof.name, score: prof.score, kills: prof.kills, online: online.has(prof) }));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({
      version: P.GAME_VERSION,
      protocol: P.PROTOCOL_VERSION,
      playersOnline: players.size,
      profilesSeen: byToken.size,
      uptimeSeconds: Math.round((Date.now() - t0) / 1000),
      serverTime: serverTime(),
      dayFraction: dayFraction(),
      dayLength: C.DAY_LENGTH_SECONDS,
      weather,
      safeZone: C.SAFE_ZONE,
      landmarks: C.LANDMARKS.length,
      landmarksDiscovered: discoveredGlobally.size,
      players: [...players.values()].map((q) => ({
        id: q.id, name: q.name, score: q.profile.score, kills: q.profile.kills,
        dead: q.dead, x: Math.round(q.state.x), z: Math.round(q.state.z),
      })),
      leaderboard,
    }));
    return;
  }
  if (p === `${BASE}/api/telemetry`) {
    let body = '';
    req.on('data', (c) => { if (body.length < 8192) body += c; });
    req.on('end', () => {
      if (VERBOSE && body) {
        try {
          const b = JSON.parse(body);
          console.log(`[telemetry] ${b.stage}${b.detail ? ` - ${b.detail}` : ''}`);
        } catch { /* ignore malformed beacons */ }
      }
      res.writeHead(204);
      res.end();
    });
    return;
  }
  if (!p.startsWith(`${BASE}/`)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  // /world/foo -> public/world/foo ; /world/ -> public/world/index.html
  const rel = p === `${BASE}/` ? `${BASE.slice(1)}/index.html` : p.slice(1);
  serveStatic(req, res, rel);
});

// ---------------------------------------------------------------------------
// World clock + weather (server-authoritative, per protocol.ts)
// ---------------------------------------------------------------------------
const t0 = Date.now();
const serverTime = () => (Date.now() - t0) / 1000 + 1;
const dayFraction = () => ((Date.now() - t0) / 1000 / C.DAY_LENGTH_SECONDS + 0.35) % 1;

const CONDITIONS = ['clear', 'partly_cloudy', 'cloudy', 'fog', 'rain', 'heavy_rain', 'snow', 'thunder'];
const weather = {
  condition: 'partly_cloudy', cloudCover: 0.35, precip: 0, wind: 3.2,
  windDir: 1.1, temperatureC: 18, wetness: 0, source: 'fallback',
};
function stepWeather(dt) {
  if (Math.random() < dt / 600) {
    weather.condition = CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)];
    weather.cloudCover = Math.random();
    weather.precip = /rain|snow|thunder/.test(weather.condition) ? 0.3 + Math.random() * 0.7 : 0;
    weather.wind = 1 + Math.random() * 9;
    weather.windDir = Math.random() * Math.PI * 2 - Math.PI;
    weather.temperatureC = Math.round(4 + Math.random() * 24);
  }
  weather.wetness = Math.max(0, Math.min(1, weather.wetness + (weather.precip > 0 ? dt / 45 : -dt / 240)));
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------
const players = new Map();  // id -> player
const byToken = new Map();  // token -> persisted profile
const discoveredGlobally = new Set();
let nextId = 1;

function allocId() {
  for (let i = 0; i < 65534; i++) {
    const id = nextId;
    nextId = (nextId % 65534) + 1;
    if (!players.has(id)) return id;
  }
  return 0;
}

/** main.ts: "The server clamps movement to ~70 m/s, so other players see you slide there." */
const MAX_SPEED_MPS = 70;

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const inSafeZone = (s) => (s.x - C.SAFE_ZONE.x) ** 2 + (s.z - C.SAFE_ZONE.z) ** 2 <= C.SAFE_ZONE.radius ** 2;
const protectedNow = (p) => serverTime() < p.protectedUntil;

function startingInventory() {
  const def = C.WEAPONS[C.WeaponId.Pistol];
  return { weapons: [{ id: C.WeaponId.Pistol, ammo: def.startingAmmo, mag: def.magazine }], current: C.WeaponId.Pistol };
}

function pickSpawn() {
  const s = C.SPAWN_POINTS[Math.floor(Math.random() * C.SPAWN_POINTS.length)];
  return { x: s.x, y: 0, z: s.z, yaw: C.headingToYaw(s.yawDeg) };
}

const send = (p, msg) => { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg)); };
const broadcast = (msg, except) => {
  for (const p of players.values()) if (p !== except && p.welcomed) send(p, msg);
};

// The entry form tells players: "You'll appear in the city as a random name like
// amber-fox-42", and net.ts documents that the submitted name/email "live only in
// this short-lived request, never in localStorage or player state". So the public
// identity is server-assigned and the personal details are dropped on the floor.
const HANDLE_ADJECTIVES = [
  'amber', 'brisk', 'copper', 'dusty', 'eager', 'frosty', 'golden', 'hazy', 'ivory', 'jade',
  'keen', 'lucky', 'misty', 'noble', 'olive', 'plucky', 'quiet', 'rusty', 'silver', 'tidy',
  'umber', 'velvet', 'wry', 'zesty', 'crimson', 'slate', 'neon', 'bronze',
];
const HANDLE_ANIMALS = [
  'fox', 'heron', 'otter', 'lynx', 'raven', 'moth', 'shark', 'wren', 'bison', 'crane',
  'gecko', 'hawk', 'ibis', 'koi', 'lark', 'marten', 'newt', 'owl', 'puma', 'quail',
  'robin', 'stoat', 'tapir', 'viper', 'walrus', 'yak', 'pigeon', 'rat',
];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function publicHandle() {
  for (let i = 0; i < 50; i++) {
    const h = `${pick(HANDLE_ADJECTIVES)}-${pick(HANDLE_ANIMALS)}-${Math.floor(Math.random() * 90) + 10}`;
    if (![...byToken.values()].some((p) => p.name === h)) return h;
  }
  return `guest-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function addScore(p, delta, reason) {
  p.profile.score += delta;
  send(p, { t: 'score', score: p.profile.score, delta, reason });
}

// --- combat ---------------------------------------------------------------

/** Ray vs an upright player capsule, approximated by the feet->head segment. */
function rayCapsule(o, d, s, maxT) {
  const r = C.PLAYER_RADIUS + 0.15;
  const feetY = s.y;
  const headY = s.y + C.PLAYER_HEIGHT;
  const px = o.x - s.x;
  const pz = o.z - s.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (px * d.x + pz * d.z);
  const c = px * px + pz * pz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0.2 || t > maxT) return null;
  const y = o.y + d.y * t;
  if (y < feetY - 0.2 || y > headY + 0.25) return null;
  return { t, head: y > headY - 0.35 };
}

function applyDamage(shooter, victim, damage, headshot, at, seq, weapon) {
  const absorbed = Math.min(victim.armor, Math.floor(damage * 0.5));
  victim.armor -= absorbed;
  victim.health = Math.max(0, victim.health - (damage - absorbed));
  victim.state.health = victim.health;

  send(shooter, { t: 'hit', shooterId: shooter.id, victimId: victim.id, damage, headshot, x: at.x, y: at.y, z: at.z, seq });
  send(victim, { t: 'health', health: victim.health, armor: victim.armor });
  if (victim.health > 0) return;

  victim.dead = true;
  victim.state.flags |= P.StateFlag.Dead;
  broadcast({ t: 'death', victimId: victim.id, killerId: shooter.id, killerName: shooter.name, weapon });
  shooter.profile.kills++;
  addScore(shooter, C.SCORE.KILL, 'kill');
}

function shoot(p, msg) {
  if (p.dead || p.flying) return;
  const def = C.WEAPONS[msg.w];
  if (!def) return;
  p.protectedUntil = 0; // firing forfeits spawn protection (constants.ts)

  const mag = p.inventory.weapons.find((w) => w.id === msg.w);
  if (mag) {
    if (mag.mag <= 0) return;
    mag.mag--;
  }

  const o = { x: msg.ox, y: msg.oy, z: msg.oz };
  const len = Math.hypot(msg.dx, msg.dy, msg.dz) || 1;
  const d = { x: msg.dx / len, y: msg.dy / len, z: msg.dz / len };

  let best = null;
  let bestT = def.range;
  if (!inSafeZone(p.state)) {
    for (const q of players.values()) {
      if (q === p || q.dead || protectedNow(q) || inSafeZone(q.state)) continue;
      const hit = rayCapsule(o, d, q.state, bestT);
      if (hit && hit.t < bestT) { bestT = hit.t; best = { q, head: hit.head }; }
    }
  }

  const at = { x: o.x + d.x * bestT, y: o.y + d.y * bestT, z: o.z + d.z * bestT };
  if (!best) {
    send(p, { t: 'miss', shooterId: p.id, x: at.x, y: at.y, z: at.z, surface: 'none', seq: msg.seq });
    return;
  }
  const damage = Math.round(def.damage * def.pellets * (best.head ? def.headshotMultiplier : 1));
  applyDamage(p, best.q, damage, best.head, at, msg.seq, msg.w);
}

function melee(p, msg) {
  const q = players.get(msg.targetId);
  if (!q || p.dead || q.dead || protectedNow(q) || inSafeZone(q.state)) return;
  if (dist2(p.state, q.state) > 9) return;
  applyDamage(p, q, 25, false, { x: q.state.x, y: q.state.y + 1.2, z: q.state.z }, 0, C.WeaponId.None);
}

function respawn(p) {
  const spawn = pickSpawn();
  p.dead = false;
  p.health = C.PLAYER_MAX_HEALTH;
  p.armor = 0;
  p.inventory = startingInventory();
  p.protectedUntil = serverTime() + C.SPAWN_PROTECTION_SECONDS;
  Object.assign(p.state, {
    x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw,
    vx: 0, vy: 0, vz: 0, health: p.health, flags: 0, weapon: p.inventory.current,
  });
  send(p, { t: 'respawned', x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw, protectedUntil: p.protectedUntil, inventory: p.inventory });
}

function sendLeaderboard(p) {
  const online = new Set([...players.values()].map((x) => x.profile));
  const entries = [...byToken.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((prof, i) => ({ rank: i + 1, name: prof.name, score: prof.score, kills: prof.kills, online: online.has(prof) }));
  const you = entries.find((e) => e.name === p.name)
    || { rank: 0, name: p.name, score: p.profile.score, kills: p.profile.kills, online: true };
  send(p, { t: 'leaderboard', entries, you, online: players.size });
}

function checkDiscovery(p) {
  for (const l of C.LANDMARKS) {
    if (p.discovered.has(l.id)) continue;
    if (dist2(p.state, l) > l.radius * l.radius) continue;
    p.discovered.add(l.id);
    const first = !discoveredGlobally.has(l.id);
    discoveredGlobally.add(l.id);
    const delta = C.SCORE.LANDMARK_DISCOVERED + (first ? C.SCORE.LANDMARK_FIRST_FINDER : 0);
    addScore(p, delta, 'landmark');
    send(p, { t: 'discover', kind: 'landmark', name: l.name, first, delta });
  }
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server, path: `${BASE}/ws`, maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  let player = null;

  function hello(msg) {
    if (msg.protocol !== P.PROTOCOL_VERSION) {
      ws.send(JSON.stringify({ t: 'version', version: P.GAME_VERSION, protocol: P.PROTOCOL_VERSION, mustUpdate: true }));
      ws.close();
      return;
    }
    if (players.size >= C.MAX_PLAYERS) {
      ws.send(JSON.stringify({ t: 'welcomeRefused', reason: 'The city is full.', retryAfterS: 30 }));
      ws.close();
      return;
    }

    // A token identifies a returning player; without one the client shows the entry form.
    const restored = !!(msg.token && byToken.has(msg.token));
    let token = msg.token;
    let profile = restored ? byToken.get(token) : null;
    if (!profile) {
      if (!msg.name) {
        ws.send(JSON.stringify({ t: 'registrationRequired', reason: 'Tell the city your name.' }));
        return;
      }
      token = crypto.randomBytes(24).toString('base64url');
      // msg.name / msg.email / msg.newsletter are deliberately NOT stored.
      profile = { name: publicHandle(), score: 0, kills: 0 };
      byToken.set(token, profile);
    }

    if (player) players.delete(player.id);
    const id = allocId();
    if (!id) {
      ws.send(JSON.stringify({ t: 'welcomeRefused', reason: 'No player slots.', retryAfterS: 15 }));
      ws.close();
      return;
    }

    const spawn = pickSpawn();
    player = {
      id, ws, token, profile, name: profile.name, welcomed: true, dead: false,
      health: C.PLAYER_MAX_HEALTH, armor: 0, admin: ADMIN, flying: false, vehicle: null,
      inventory: startingInventory(), state: P.emptyState(),
      lastSeen: Date.now(), lastStateAt: Date.now(),
      protectedUntil: serverTime() + C.SPAWN_PROTECTION_SECONDS,
      known: new Set(), discovered: new Set(), scoreAcc: 0,
    };
    Object.assign(player.state, {
      id, x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw,
      health: player.health, weapon: player.inventory.current,
    });
    players.set(id, player);

    send(player, {
      t: 'welcome', id, token, name: player.name,
      version: P.GAME_VERSION, protocol: P.PROTOCOL_VERSION, restored,
      health: player.health, armor: player.armor, dead: false, vehicle: null,
      serverTime: serverTime(), dayFraction: dayFraction(), dayLength: C.DAY_LENGTH_SECONDS,
      weather, spawn, safeZone: C.SAFE_ZONE, protectedUntil: player.protectedUntil,
      score: profile.score, inventory: player.inventory, playersOnline: players.size, era: 'present',
    });
    if (ADMIN) send(player, { t: 'adminState', admin: true, flying: false });
    broadcast({ t: 'join', id, name: player.name, score: profile.score }, player);
    broadcast({ t: 'online', count: players.size });
    console.log(`[net] ${player.name} (#${id}) joined - ${players.size} online`);
  }

  function onBinary(buf) {
    if (!player || !player.welcomed) return;
    if (buf.length < 1 + 8 + P.PLAYER_STATE_BYTES) return;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (view.getUint8(0) !== P.BinaryKind.State) return;

    const { state } = P.decodeStateMessage(buf);
    const s = player.state;
    const now = Date.now();

    // Movement is client-authoritative with a server sanity check (protocol.ts).
    // main.ts documents the original behaviour: the server clamps movement to
    // ~70 m/s, so an over-fast client slides toward its claimed position rather
    // than being rejected outright (which would strand it after a network stall).
    const dt = Math.min(2, Math.max(0.05, (now - player.lastStateAt) / 1000));
    const jump = Math.hypot(state.x - s.x, state.y - s.y, state.z - s.z);
    const maxJump = MAX_SPEED_MPS * dt;
    if (player.flying || jump <= maxJump) {
      s.x = state.x; s.y = state.y; s.z = state.z;
    } else {
      const k = maxJump / jump;
      s.x += (state.x - s.x) * k;
      s.y += (state.y - s.y) * k;
      s.z += (state.z - s.z) * k;
    }
    s.yaw = state.yaw; s.pitch = state.pitch; s.roll = state.roll;
    s.vx = state.vx; s.vy = state.vy; s.vz = state.vz;
    s.anim = state.anim; s.steer = state.steer; s.throttle = state.throttle;
    s.vehicleId = state.vehicleId;
    // Server owns health, death and spawn protection; client values are ignored.
    const clientFlags = state.flags & ~(P.StateFlag.Dead | P.StateFlag.Protected);
    s.flags = clientFlags
      | (player.dead ? P.StateFlag.Dead : 0)
      | (protectedNow(player) ? P.StateFlag.Protected : 0);
    s.health = player.health;
    player.lastStateAt = now;
  }

  function onControl(msg) {
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'hello') { hello(msg); return; }
    if (msg.t === 'ping') { if (player) send(player, { t: 'pong', ct: msg.ct, st: serverTime() }); return; }
    if (!player || !player.welcomed) return;

    switch (msg.t) {
      case 'shoot': return shoot(player, msg);
      case 'melee': return melee(player, msg);
      case 'respawn': return respawn(player);
      case 'leaderboard': return sendLeaderboard(player);
      case 'switchWeapon': {
        if (player.inventory.weapons.some((w) => w.id === msg.w)) {
          player.inventory.current = msg.w;
          player.state.weapon = msg.w;
          send(player, { t: 'inventory', inventory: player.inventory });
        }
        return;
      }
      case 'reload': {
        const w = player.inventory.weapons.find((x) => x.id === player.inventory.current);
        const def = C.WEAPONS[player.inventory.current];
        if (w && def) {
          const take = Math.min(def.magazine - w.mag, w.ammo);
          w.mag += take;
          w.ammo -= take;
          send(player, { t: 'inventory', inventory: player.inventory });
        }
        return;
      }
      case 'enterVehicle': {
        const v = { id: player.id, key: msg.key, driverId: player.id, kind: msg.kind };
        player.vehicle = v;
        broadcast({ t: 'vehicle', v });
        return;
      }
      case 'exitVehicle': {
        if (player.vehicle) {
          const v = { ...player.vehicle, driverId: 0 };
          player.vehicle = null;
          broadcast({ t: 'vehicle', v });
        }
        return;
      }
      case 'adminFly': {
        if (!player.admin) return;
        player.flying = !!msg.enabled;
        send(player, { t: 'adminState', admin: true, flying: player.flying });
        return;
      }
      case 'adminTeleport': {
        if (!player.admin) return;
        Object.assign(player.state, { x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw ?? player.state.yaw });
        return;
      }
      // 'pickup' and 'setName' are accepted and ignored: this server spawns no
      // pickups, and net.ts setName() is already a no-op client-side.
      default: return;
    }
  }

  ws.on('message', (data, isBinary) => {
    // Any traffic counts as liveness. net.ts sendState() returns early while the
    // player is dead, so a dead client sends only pings - keying the idle reaper
    // on binary state alone would disconnect players on the death screen.
    if (player) player.lastSeen = Date.now();
    if (isBinary) { onBinary(data); return; }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    onControl(msg);
  });

  ws.on('close', () => {
    if (!player) return;
    players.delete(player.id);
    if (player.vehicle) broadcast({ t: 'vehicle', v: { ...player.vehicle, driverId: 0 } });
    broadcast({ t: 'leave', id: player.id });
    broadcast({ t: 'online', count: players.size });
    console.log(`[net] ${player.name} (#${player.id}) left - ${players.size} online`);
  });

  ws.on('error', () => { /* close follows */ });
});

// ---------------------------------------------------------------------------
// Tick: AOI snapshots at SERVER_SNAPSHOT_HZ
// ---------------------------------------------------------------------------
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - lastTick) / 1000;
  lastTick = now;
  stepWeather(dt);

  const st = serverTime();
  const list = [...players.values()];

  for (const p of list) {
    if (now - p.lastSeen > 30000) { p.ws.terminate(); continue; }
    if (p.dead) continue;
    checkDiscovery(p);
    p.scoreAcc += dt;
    if (p.scoreAcc >= 60) {
      p.scoreAcc -= 60;
      addScore(p, C.SCORE.SURVIVE_PER_MINUTE, 'survival');
    }
  }

  // Area-of-interest snapshots + lazily-sent names, per protocol.ts.
  const aoi2 = C.AOI_RADIUS_M * C.AOI_RADIUS_M;
  for (const p of list) {
    if (!p.welcomed || p.ws.readyState !== 1) continue;
    const near = [];
    const unknown = [];
    for (const q of list) {
      if (q !== p && dist2(p.state, q.state) > aoi2) continue;
      near.push(q.state);
      if (q !== p && !p.known.has(q.id)) {
        p.known.add(q.id);
        unknown.push({ id: q.id, name: q.name, score: q.profile.score });
      }
    }
    if (unknown.length) send(p, { t: 'names', players: unknown });
    if (p.ws.bufferedAmount < 256 * 1024) p.ws.send(P.encodeSnapshot(st, near));
  }
}, 1000 / C.SERVER_SNAPSHOT_HZ);

// World clock broadcast.
setInterval(() => {
  broadcast({ t: 'time', serverTime: serverTime(), dayFraction: dayFraction(), weather });
}, 10000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] New York listening on http://localhost:${PORT}${BASE}/`);
  console.log(`[server] static=${PUBLIC_DIR} ws=${BASE}/ws protocol=v${P.PROTOCOL_VERSION} game=v${P.GAME_VERSION}`);
});
