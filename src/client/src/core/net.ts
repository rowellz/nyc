/**
 * NetClient: one WebSocket at /ws. Text = JSON control (shared/protocol.ts), binary = 34-byte states.
 *  - hello on open (name, token, GAME_VERSION); welcome spawns the local player and stores the token
 *  - remote players keep prev/next snapshot states; update() lerps them ~100 ms behind server time
 *  - own state sent as binary at CLIENT_STATE_HZ, ping every 2 s -> serverTimeOffset (average of last 5)
 *  - reconnect with exponential backoff (1 s .. 15 s, jitter) for up to 3 minutes; re-hello by token
 */
import * as THREE from 'three';
import {
  BinaryKind,
  PROTOCOL_VERSION,
  StateFlag,
  decodeSnapshot,
  encodeStateMessage,
  emptyState,
  type ClientMessage,
  type PlayerState,
  type ServerMessage,
  type WeatherState,
} from '@shared/protocol';
import { GAME_VERSION } from '@shared/version';
import { CLIENT_STATE_HZ, PLAYER_MAX_HEALTH } from '@shared/constants';
import type { ClientState, EventBus, NetClient, RemotePlayer, TimeOfDay } from './context';
import { LS_NAME, LS_TOKEN, lsSet } from './state';
import { basePath } from './basePath';

const INTERP_DELAY = 0.1; // seconds behind server time we render remotes
const PING_INTERVAL = 2;
const OFFSET_SAMPLES = 5;
const REMOTE_TIMEOUT = 6; // seconds without a snapshot -> out of AOI, drop
const BACKOFF_MIN = 1000;
const BACKOFF_MAX = 15000;
export const RECONNECT_WINDOW_MS = 3 * 60_000;

/** Semver precedence, not string ordering (and an older server is not an update). */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v);
  const a = parse(candidate), b = parse(current);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) if (+a[i] !== +b[i]) return +a[i] > +b[i];
  if (a[4] === b[4]) return false;
  if (!a[4] || !b[4]) return !a[4];
  const ap = a[4].split('.'), bp = b[4].split('.');
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === bp[i]) continue;
    if (ap[i] === undefined || bp[i] === undefined) return bp[i] === undefined;
    const an = /^\d+$/.test(ap[i]), bn = /^\d+$/.test(bp[i]);
    if (an && bn) return +ap[i] > +bp[i];
    if (an !== bn) return !an;
    return ap[i] > bp[i];
  }
  return false;
}

export type NetStatus = 'idle' | 'connecting' | 'open' | 'welcomed' | 'closed' | 'kicked';

export class NetClientImpl implements NetClient {
  connected = false;
  registrationNeeded = false;
  registrationError = '';
  admissionRefusal: { reason: string; retryAt: number } | null = null;
  private registration: { name: string; email: string; newsletter: boolean } | null = null;
  status: NetStatus = 'idle';
  url: string;
  /** rtt in seconds of the last pong */
  rtt = 0;
  reconnectAttempt = 0;
  interrupted = false;
  updating = false;
  mustUpdate = false;
  private reconnectDeadline = 0;
  private retryExpired = false;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityAt = Date.now();
  private readonly noteActivity = () => { this.lastActivityAt = Date.now(); };
  get reloadRequired(): boolean { return this.status === 'kicked' || this.retryExpired; }

  /** Required updates never interrupt active play outside a safe zone. */
  get safeToReload(): boolean {
    const { local, safeZone } = this.state;
    return local.dead || Math.hypot(local.state.x - safeZone.x, local.state.z - safeZone.z) <= safeZone.radius
      || Date.now() - this.lastActivityAt > 20_000;
  }

  private offerUpdate(version: string, protocol: number, required: boolean): void {
    this.state.latestVersion = version;
    if (!required && !isNewerVersion(version, GAME_VERSION)) return;
    this.mustUpdate ||= required;
    this.events.emit('versionAvailable', version, required);
    if (!required || this.updateTimer || typeof window === 'undefined') return;
    // Once per advertised build avoids a reload loop while assets reach the edge.
    const key = `nyc.autoUpdated:${version}:${protocol}`;
    this.updateTimer = setInterval(() => {
      if (!this.safeToReload) return;
      try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* optional */ }
      if (this.updateTimer) clearInterval(this.updateTimer);
      this.updateTimer = null;
      location.reload();
    }, 1000);
  }
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  kickReason: string | null = null;
  lastError: string | null = null;
  /** counters for the debug overlay */
  counters = { sent: 0, recv: 0, snapshots: 0, bytesIn: 0, bytesOut: 0, reconnects: 0 };
  private ws: WebSocket | null = null;
  private handlers = new Set<(msg: ServerMessage) => void>();
  private offsets: number[] = [];
  private sendAcc = 0;
  private pingAcc = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private names = new Map<number, { name: string; score: number }>();
  private disposed = false;
  private loggedFailure = false;
  private tmpO = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private time: TimeOfDay | null = null;
  latestWeather: WeatherState | null = null;
  latestDayFraction: number | null = null;

  constructor(private state: ClientState, private events: EventBus, url?: string) {
    this.url = url ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${basePath('/ws')}`;
    if (typeof window !== 'undefined') for (const event of ['keydown', 'pointerdown', 'pointermove', 'touchstart', 'touchmove', 'wheel']) window.addEventListener(event, this.noteActivity, { passive: true });
  }

  /** give net the clock so 'time' messages don't fight a frozen ?time= */
  attachTime(t: TimeOfDay): void {
    this.time = t;
  }

  connect(retry = false): void {
    if (this.admissionRefusal) return;
    if (this.disposed || this.mustUpdate || this.status === 'kicked' || this.reloadRequired) return;
    if (!this.state.local.token && !this.registration) { this.registrationNeeded = true; return; }
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.status = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.lastError = String(err);
      this.status = 'closed';
      this.interrupted = true;
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.handshakeTimer = setTimeout(() => {
      if (this.ws === ws && this.status !== 'welcomed') ws.close();
    }, 8000);
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.connected = true;
      this.status = 'open';
      this.loggedFailure = false;
      if (this.reconnectAttempt > 0) {
        this.counters.reconnects++;
        console.info('[net] reconnected');
      }
      this.hello();
      this.pingAcc = PING_INTERVAL; // ping right away
    };
    ws.onmessage = (e) => {
      if (ws !== this.ws || this.status === 'kicked') return;
      this.counters.recv++;
      if (typeof e.data === 'string') {
        this.counters.bytesIn += e.data.length;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(e.data) as ServerMessage;
        } catch {
          return;
        }
        this.handleMessage(msg);
      } else if (e.data instanceof ArrayBuffer) {
        this.counters.bytesIn += e.data.byteLength;
        this.handleBinary(e.data);
      }
    };
    ws.onerror = () => {
      // onclose follows; keep quiet here
    };
    ws.onclose = (e) => {
      if (ws !== this.ws) return;
      const wasWelcomed = this.status === 'welcomed';
      this.connected = false;
      this.interrupted = true;
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
      this.ws = null;
      this.state.welcomed = false;
      this.state.adminFlying = false;
      if (this.status !== 'kicked') this.status = 'closed';
      if (wasWelcomed) console.info(`[net] disconnected (${e.code})`);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.mustUpdate || this.status === 'kicked' || this.reconnectTimer || this.retryExpired) return;
    if (!this.reconnectDeadline) {
      this.reconnectDeadline = Date.now() + RECONNECT_WINDOW_MS;
      this.deadlineTimer = setTimeout(() => {
        this.retryExpired = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.ws?.close();
      }, RECONNECT_WINDOW_MS);
    }
    if (Date.now() >= this.reconnectDeadline) { this.retryExpired = true; return; }
    const base = Math.min(BACKOFF_MAX, BACKOFF_MIN * Math.pow(2, this.reconnectAttempt));
    const delay = Math.min(base * (0.75 + Math.random() * 0.5), this.reconnectDeadline - Date.now());
    if (!this.loggedFailure) {
      console.info(`[net] server unavailable at ${this.url}; retrying with backoff (first retry in ${(delay / 1000).toFixed(1)} s)`);
      this.loggedFailure = true;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt++;
      this.connect(true);
    }, delay);
  }

  private hello(): void {
    const local = this.state.local;
    this.send({ t: 'hello', name: this.registration?.name || '', email: this.registration?.email, newsletter: this.registration?.newsletter, token: local.token || null, version: GAME_VERSION, protocol: PROTOCOL_VERSION });
  }

  send(msg: ClientMessage): void {
    const ws = this.ws;
    if (msg.t !== 'hello' && msg.t !== 'ping' && this.status !== 'welcomed') return;
    if (this.state.adminFlying && (msg.t === 'shoot' || msg.t === 'melee')) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const s = JSON.stringify(msg);
      ws.send(s);
      this.counters.sent++;
      this.counters.bytesOut += s.length;
    } catch (err) {
      this.lastError = String(err);
    }
  }

  sendState(): void {
    const ws = this.ws;
    // The server already owns a confirmed death. Continuing to send the sinking body's
    // altitude can arrive after a respawn request and immediately drown the new spawn.
    if (this.state.local.dead) return;
    if (!ws || ws.readyState !== WebSocket.OPEN || this.status !== 'welcomed') return;
    if (ws.bufferedAmount > 64 * 1024) return; // backpressure: skip this tick
    const s = this.state.local.state;
    s.id = this.state.local.id;
    const buf = encodeStateMessage(performance.now() / 1000, s);
    ws.send(buf);
    this.counters.sent++;
    this.counters.bytesOut += buf.byteLength;
  }

  onMessage(fn: (msg: ServerMessage) => void): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  /** Personal details live only in this short-lived request, never in localStorage or player state. */
  register(name: string, email: string, newsletter = false): void {
    if (this.admissionRefusal) return;
    this.registration = { name, email, newsletter };
    this.registrationNeeded = false;
    this.registrationError = '';
    if (this.status === 'kicked') this.status = 'idle';
    if (this.connected) this.hello();
    else this.connect();
  }

  /** Retry deliberately after the capacity cooldown; keep identity and unacknowledged signup private. */
  retryAdmission(): void {
    if (!this.admissionRefusal || Date.now() < this.admissionRefusal.retryAt) return;
    this.admissionRefusal = null;
    this.status = 'idle';
    this.interrupted = false;
    this.reconnectAttempt = 0;
    this.reconnectDeadline = 0;
    this.retryExpired = false;
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    this.connect();
  }

  /** Legacy callers cannot change the server-assigned public identity. */
  setName(_name: string): void {}

  /** per-frame: interpolation, state send, ping */
  update(dt: number): void {
    const st = this.state;
    const s = st.local.state;
    if (!this.interrupted && (Math.hypot(s.vx, s.vy, s.vz) > 0.2 || s.throttle || (s.flags & StateFlag.Firing))) this.noteActivity();
    if (this.connected) {
      this.sendAcc += dt;
      const period = 1 / CLIENT_STATE_HZ;
      if (this.sendAcc >= period) {
        this.sendAcc = Math.min(this.sendAcc - period, period);
        this.sendState();
      }
      this.pingAcc += dt;
      if (this.pingAcc >= PING_INTERVAL) {
        this.pingAcc = 0;
        this.send({ t: 'ping', ct: performance.now() / 1000 });
      }
    }
    // interpolate remotes
    const renderTime = st.serverTime() - INTERP_DELAY;
    const now = performance.now() / 1000;
    for (const [id, r] of st.remotes) {
      if (!this.interrupted && now - r.lastSeen > REMOTE_TIMEOUT) {
        st.remotes.delete(id);
        continue;
      }
      interpolate(r, renderTime);
    }
  }

  private handleBinary(buf: ArrayBuffer): void {
    if (this.status !== 'welcomed' || buf.byteLength < 11) return;
    const kind = new DataView(buf).getUint8(0);
    if (kind !== BinaryKind.Snapshot) return;
    const { serverTime, states } = decodeSnapshot(buf);
    this.counters.snapshots++;
    const st = this.state;
    const now = performance.now() / 1000;
    for (const s of states) {
      if (s.id === st.local.id) {
        // server echo of our own state: only server-authoritative bits
        st.local.state.health = s.health;
        if (s.flags & StateFlag.Protected) st.local.state.flags |= StateFlag.Protected;
        else {
          st.local.state.flags &= ~StateFlag.Protected;
          st.local.protectedUntil = Math.min(st.local.protectedUntil, serverTime);
        }
        if (s.flags & StateFlag.Dead && !st.local.dead) {
          st.local.dead = true;
          st.local.state.flags |= StateFlag.Dead;
          this.events.emit('localDeath', '', 0);
        }
        continue;
      }
      let r = st.remotes.get(s.id);
      if (!r) {
        const meta = this.names.get(s.id);
        r = {
          id: s.id,
          name: meta?.name ?? `Player ${s.id}`,
          score: meta?.score ?? 0,
          prev: { ...s },
          next: { ...s },
          prevTime: serverTime - 1 / 15,
          nextTime: serverTime,
          render: { ...s },
          lastSeen: now,
        };
        st.remotes.set(s.id, r);
        continue;
      }
      // firing edge -> remoteFire event
      const wasFiring = (r.next.flags & StateFlag.Firing) !== 0;
      const isFiring = (s.flags & StateFlag.Firing) !== 0;
      if (serverTime > r.nextTime) {
        const tmp = r.prev;
        r.prev = r.next;
        r.prevTime = r.nextTime;
        r.next = tmp;
        Object.assign(r.next, s);
        r.nextTime = serverTime;
      } else {
        Object.assign(r.next, s);
      }
      r.lastSeen = now;
      if (isFiring && !wasFiring) {
        this.tmpO.set(s.x, s.y + 1.5, s.z);
        const cp = Math.cos(s.pitch);
        this.tmpD.set(-Math.sin(s.yaw) * cp, Math.sin(s.pitch), -Math.cos(s.yaw) * cp);
        this.events.emit('remoteFire', s.id, s.weapon, this.tmpO.clone(), this.tmpD.clone());
      }
    }
  }

  private handleMessage(msg: ServerMessage): void {
    const st = this.state;
    const ev = this.events;
    switch (msg.t) {
      case 'registrationRequired':
        this.registration = null;
        this.registrationNeeded = true;
        this.registrationError = msg.reason;
        st.local.token = '';
        lsSet(LS_TOKEN, '');
        break;
      case 'adminState':
        st.admin = msg.admin;
        st.adminFlying = msg.flying;
        break;
      case 'welcome': {
        if (msg.protocol !== PROTOCOL_VERSION) {
          this.offerUpdate(msg.version, msg.protocol, true);
          this.ws?.close();
          break;
        }
        const reconnecting = this.interrupted && !!st.local.token;
        st.remotes.clear();
        st.pickups.clear();
        this.names.clear();
        this.latestDayFraction = msg.dayFraction;
        this.registration = null;
        this.registrationNeeded = false;
        const local = st.local;
        local.id = msg.id;
        local.token = msg.token;
        lsSet(LS_TOKEN, msg.token);
        if (msg.name) {
          local.name = msg.name;
          if (msg.name !== 'Guest' && !/^Guest\b/i.test(msg.name)) lsSet(LS_NAME, msg.name);
        }
        st.version = GAME_VERSION;
        st.latestVersion = msg.version;
        st.dayLength = msg.dayLength || st.dayLength;
        st.safeZone = { ...msg.safeZone };
        st.era = msg.era;
        st.online = msg.playersOnline;
        local.score = msg.score;
        local.inventory = msg.inventory;
        local.protectedUntil = msg.protectedUntil;
        local.dead = msg.dead;
        local.armor = msg.armor;
        local.fallPending = false;
        local.vehicleKey = null;
        const now = performance.now() / 1000;
        this.offsets.length = 0;
        st.serverTimeOffset = msg.serverTime - now;
        if (!this.time?.frozen) {
          st.dayFraction = msg.dayFraction;
          this.time?.setFraction?.(msg.dayFraction);
        }
        this.applyWeather(msg.weather);
        // spawn (unless the screenshot camera already placed us at a spot)
        if (!st.screenshotMode) {
          const s = local.state;
          s.x = msg.spawn.x;
          s.y = msg.spawn.y;
          s.z = msg.spawn.z;
          s.yaw = msg.spawn.yaw;
          s.vx = s.vy = s.vz = 0;
          s.flags = msg.dead ? StateFlag.Dead : 0;
          s.health = msg.health;
          s.weapon = msg.inventory.current;
          s.vehicleId = 0;
        }
        st.welcomed = true;
        this.status = 'welcomed';
        this.interrupted = false;
        this.updating = false;
        this.reconnectDeadline = 0;
        this.retryExpired = false;
        if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.deadlineTimer = this.reconnectTimer = null;
        this.reconnectAttempt = 0;
        this.kickReason = null;
        if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
        this.handshakeTimer = null;
        ev.emit('localRespawn');
        if (msg.dead) ev.emit('localDeath', '', 0);
        if (msg.vehicle && !msg.dead) {
          local.vehicleKey = msg.vehicle.key;
          local.state.vehicleId = msg.vehicle.id;
          local.state.flags |= StateFlag.InVehicle;
          st.vehicles.set(msg.vehicle.id, msg.vehicle);
        }
        this.offerUpdate(msg.version, msg.protocol, false);
        ev.emit('feed', reconnecting ? `Reconnected as ${local.name} — back in the city.` : `Welcome to New York, ${local.name || 'stranger'}. ${msg.playersOnline} in the city.`, 'system');
        break;
      }
      case 'join':
        this.names.set(msg.id, { name: msg.name, score: msg.score });
        if (msg.id !== st.local.id) {
          const r = st.remotes.get(msg.id);
          if (r) {
            r.name = msg.name;
            r.score = msg.score;
          }
          ev.emit('playerJoined', msg.id, msg.name);
        }
        break;
      case 'leave':
        this.names.delete(msg.id);
        st.remotes.delete(msg.id);
        ev.emit('playerLeft', msg.id);
        break;
      case 'names':
        for (const p of msg.players) {
          this.names.set(p.id, { name: p.name, score: p.score });
          const r = st.remotes.get(p.id);
          if (r) {
            r.name = p.name;
            r.score = p.score;
          }
        }
        break;
      case 'hit':
        ev.emit('hit', msg);
        break;
      case 'miss':
        ev.emit('miss', msg);
        break;
      case 'health':
        st.local.state.health = msg.health;
        st.local.armor = msg.armor;
        break;
      case 'death': {
        ev.emit('death', msg);
        if (msg.victimId === st.local.id) {
          st.local.dead = true;
          st.local.state.flags |= StateFlag.Dead;
          st.local.state.health = 0;
          ev.emit('localDeath', msg.killerName, msg.weapon);
        }
        const victim = msg.victimId === st.local.id ? st.local.name : st.remotes.get(msg.victimId)?.name ?? this.names.get(msg.victimId)?.name ?? `Player ${msg.victimId}`;
        if (msg.killerId && msg.killerId !== msg.victimId) ev.emit('feed', `${msg.killerName} killed ${victim}`, 'kill');
        else ev.emit('feed', `${victim} died`, 'kill');
        break;
      }
      case 'respawned': {
        const s = st.local.state;
        s.x = msg.x;
        s.y = msg.y;
        s.z = msg.z;
        s.yaw = msg.yaw;
        s.vx = s.vy = s.vz = 0;
        s.flags = 0;
        s.health = PLAYER_MAX_HEALTH;
        s.vehicleId = 0;
        s.weapon = msg.inventory.current;
        st.local.dead = false;
        st.local.fallPending = false;
        st.local.vehicleKey = null;
        st.local.armor = 0;
        st.local.inventory = msg.inventory;
        st.local.protectedUntil = msg.protectedUntil;
        ev.emit('localRespawn');
        break;
      }
      case 'score':
        if (this.status !== 'welcomed') break;
        st.local.score = msg.score;
        ev.emit('score', msg);
        break;
      case 'leaderboard':
        st.leaderboard = msg.entries;
        st.online = msg.online;
        ev.emit('leaderboard', msg);
        break;
      case 'pickups':
        for (const id of msg.remove) {
          const p = st.pickups.get(id);
          st.pickups.delete(id);
          if (p) ev.emit('pickupTaken', p);
        }
        for (const p of msg.add) st.pickups.set(p.id, p);
        break;
      case 'inventory':
        st.local.inventory = msg.inventory;
        st.local.state.weapon = msg.inventory.current;
        break;
      case 'vehicle':
        if (msg.v.driverId === 0 && !msg.v.key) st.vehicles.delete(msg.v.id);
        else st.vehicles.set(msg.v.id, msg.v);
        break;
      case 'vehicles':
        st.vehicles.clear();
        for (const v of msg.list) st.vehicles.set(v.id, v);
        break;
      case 'time': {
        this.latestDayFraction = msg.dayFraction;
        const now = performance.now() / 1000;
        // a snapshot of the server clock: use as a low-weight offset sample
        if (this.offsets.length === 0) st.serverTimeOffset = msg.serverTime - now;
        if (!this.time?.frozen) {
          st.dayFraction = msg.dayFraction;
          this.time?.setFraction?.(msg.dayFraction);
        }
        this.applyWeather(msg.weather);
        break;
      }
      case 'pong': {
        const now = performance.now() / 1000;
        const rtt = Math.max(0, now - msg.ct);
        this.rtt = rtt;
        st.ping = Math.round(rtt * 1000);
        const offset = msg.st + rtt / 2 - now;
        this.offsets.push(offset);
        if (this.offsets.length > OFFSET_SAMPLES) this.offsets.shift();
        st.serverTimeOffset = this.offsets.reduce((a, b) => a + b, 0) / this.offsets.length;
        break;
      }
      case 'version':
        this.offerUpdate(msg.version, msg.protocol, msg.mustUpdate || msg.protocol !== PROTOCOL_VERSION);
        break;
      case 'restart':
        this.updating = this.interrupted = true;
        st.welcomed = false;
        st.adminFlying = false;
        this.status = 'open'; // stop gameplay sends until a new welcome
        break;
      case 'discover':
        ev.emit('discover', msg);
        ev.emit('feed', msg.first ? `You are the first to find ${msg.name} (+${msg.delta})` : `Discovered ${msg.name} (+${msg.delta})`, 'discover');
        break;
      case 'welcomeRefused':
        this.admissionRefusal = { reason: msg.reason, retryAt: Date.now() + Math.max(60, Math.min(300, Number(msg.retryAfterS) || 60)) * 1000 };
        this.connected = false;
        this.interrupted = true;
        this.status = 'kicked'; // terminal until an explicit, cooldown-gated retry
        st.welcomed = false;
        st.adminFlying = false;
        if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
        this.handshakeTimer = null;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
        this.deadlineTimer = null;
        this.ws?.close();
        break;
      case 'kick':
        // A busy renderer can delay the WS open callback past the server's short hello deadline.
        // Keep the unacknowledged registration in memory and retry; never strand the entry form.
        if (msg.reason === 'hello timeout' && !st.welcomed) {
          this.status = 'closed';
          this.ws?.close();
          this.scheduleReconnect();
          break;
        }
        if (!st.welcomed) { this.registrationNeeded = true; this.registrationError = msg.reason; }
        this.interrupted = true;
        this.connected = false;
        st.welcomed = false;
        st.adminFlying = false;
        this.kickReason = msg.reason;
        this.status = 'kicked';
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        console.warn('[net] kicked:', msg.reason);
        ev.emit('feed', `Disconnected: ${msg.reason}`, 'system');
        this.ws?.close();
        break;
      case 'online':
        st.online = msg.count;
        break;
      default:
        // unknown message type: ignore (forward compatible)
        break;
    }
    for (const fn of this.handlers) {
      try {
        fn(msg);
      } catch (err) {
        console.error('[net] message handler threw', err);
      }
    }
  }

  private applyWeather(w: WeatherState): void {
    this.latestWeather = w;
    if (this.weatherLocked) return;
    this.state.weather = w;
    this.events.emit('weather', w);
  }

  /** ?weather= forces a condition; the server's weather is ignored while locked */
  weatherLocked = false;

  dispose(): void {
    this.disposed = true;
    if (this.deadlineTimer) clearTimeout(this.deadlineTimer);
    if (this.updateTimer) clearInterval(this.updateTimer);
    if (typeof window !== 'undefined') for (const event of ['keydown', 'pointerdown', 'pointermove', 'touchstart', 'touchmove', 'wheel']) window.removeEventListener(event, this.noteActivity);
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export function interpolate(r: RemotePlayer, renderTime: number): void {
  const span = r.nextTime - r.prevTime;
  let a = span > 1e-4 ? (renderTime - r.prevTime) / span : 1;
  // allow slight extrapolation (≤ 1.25) so a late snapshot doesn't freeze the figure, never rewind past prev
  a = a < 0 ? 0 : a > 1.25 ? 1.25 : a;
  const p = r.prev, n = r.next, o = r.render;
  o.id = n.id;
  o.x = p.x + (n.x - p.x) * a;
  o.y = p.y + (n.y - p.y) * a;
  o.z = p.z + (n.z - p.z) * a;
  o.yaw = lerpAngle(p.yaw, n.yaw, Math.min(a, 1));
  o.pitch = lerpAngle(p.pitch, n.pitch, Math.min(a, 1));
  o.roll = lerpAngle(p.roll, n.roll, Math.min(a, 1));
  o.vx = n.vx;
  o.vy = n.vy;
  o.vz = n.vz;
  o.flags = n.flags;
  o.anim = n.anim;
  o.health = n.health;
  o.weapon = n.weapon;
  o.vehicleId = n.vehicleId;
  o.steer = p.steer + (n.steer - p.steer) * Math.min(a, 1);
  o.throttle = p.throttle + (n.throttle - p.throttle) * Math.min(a, 1);
}

export function makeRemote(id: number, name: string, s: PlayerState = emptyState()): RemotePlayer {
  const now = performance.now() / 1000;
  return { id, name, score: 0, prev: { ...s }, next: { ...s }, prevTime: now, nextTime: now, render: { ...s }, lastSeen: now };
}
