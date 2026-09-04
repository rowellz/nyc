/**
 * Network protocol (THE contract between server/ and client/src/core/net.ts).
 *
 * Transport: one WebSocket at `/ws`.
 *   - TEXT frames are JSON control messages: { t: '<type>', ...payload } (types below).
 *   - BINARY frames are high-frequency state, first byte = BinaryKind.
 *
 * Authority:
 *   - Movement is client-authoritative with server sanity checks (speed caps, teleport detection).
 *   - Hits, damage, death, score, pickups, vehicle ownership, time, weather are SERVER-authoritative.
 */
import { WeaponId } from './weapons';

/** Bump for EVERY edit to this wire contract; append its SHA-256 to tests/protocol.snapshot.json. */
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------------------------
// Binary player state (34 bytes). Used both client->server (own state) and server->client (snapshot).
// ---------------------------------------------------------------------------------------------
export const enum BinaryKind {
  Snapshot = 1, // server -> client: [kind u8][serverTime f64][count u16][PlayerState * count]
  State = 2, // client -> server: [kind u8][clientTime f64][PlayerState] (id is ignored)
}

export const enum StateFlag {
  Aiming = 1 << 0,
  Crouch = 1 << 1,
  Sprint = 1 << 2,
  InVehicle = 1 << 3,
  Firing = 1 << 4,
  Dead = 1 << 5,
  Protected = 1 << 6, // spawn protection active (server sets; client value ignored)
  Airborne = 1 << 7,
}

/** Animation ids for the character. Client-defined meaning; wire is u8. */
export const enum AnimId {
  Idle = 0,
  Walk = 1,
  Run = 2,
  Sprint = 3,
  Jump = 4,
  Fall = 5,
  CrouchIdle = 6,
  CrouchWalk = 7,
  AimIdle = 8,
  AimWalk = 9,
  Fire = 10,
  Reload = 11,
  Death = 12,
  DriveIdle = 13,
  Punch = 14,
}

export interface PlayerState {
  id: number; // u16 server-assigned
  x: number;
  y: number;
  z: number;
  yaw: number; // radians, body/vehicle heading (see geo.ts)
  pitch: number; // radians, aim pitch (or vehicle pitch when InVehicle)
  roll: number; // radians, vehicle roll when InVehicle, else 0
  vx: number;
  vy: number;
  vz: number; // m/s
  flags: number; // StateFlag bits
  anim: number; // AnimId
  health: number; // 0..100 (server-authoritative; client value ignored)
  weapon: number; // WeaponId
  vehicleId: number; // u16, 0 = none
  steer: number; // -1..1 (vehicle visual replication)
  throttle: number; // -1..1
}

export const PLAYER_STATE_BYTES = 34;

export function writePlayerState(view: DataView, o: number, s: PlayerState): number {
  view.setUint16(o, s.id & 0xffff, true); o += 2;
  view.setFloat32(o, s.x, true); o += 4;
  view.setFloat32(o, s.y, true); o += 4;
  view.setFloat32(o, s.z, true); o += 4;
  view.setInt16(o, clampI16(Math.round(wrapPi(s.yaw) * 10000)), true); o += 2;
  view.setInt16(o, clampI16(Math.round(wrapPi(s.pitch) * 10000)), true); o += 2;
  view.setInt16(o, clampI16(Math.round(wrapPi(s.roll) * 10000)), true); o += 2;
  view.setInt16(o, clampI16(Math.round(s.vx * 100)), true); o += 2;
  view.setInt16(o, clampI16(Math.round(s.vy * 100)), true); o += 2;
  view.setInt16(o, clampI16(Math.round(s.vz * 100)), true); o += 2;
  view.setUint8(o, s.flags & 0xff); o += 1;
  view.setUint8(o, s.anim & 0xff); o += 1;
  view.setUint8(o, Math.max(0, Math.min(255, Math.round(s.health)))); o += 1;
  view.setUint8(o, s.weapon & 0xff); o += 1;
  view.setUint16(o, s.vehicleId & 0xffff, true); o += 2;
  view.setInt8(o, Math.round(Math.max(-1, Math.min(1, s.steer)) * 127)); o += 1;
  view.setInt8(o, Math.round(Math.max(-1, Math.min(1, s.throttle)) * 127)); o += 1;
  return o;
}

export function readPlayerState(view: DataView, o: number, out: PlayerState = emptyState()): PlayerState {
  out.id = view.getUint16(o, true); o += 2;
  out.x = view.getFloat32(o, true); o += 4;
  out.y = view.getFloat32(o, true); o += 4;
  out.z = view.getFloat32(o, true); o += 4;
  out.yaw = view.getInt16(o, true) / 10000; o += 2;
  out.pitch = view.getInt16(o, true) / 10000; o += 2;
  out.roll = view.getInt16(o, true) / 10000; o += 2;
  out.vx = view.getInt16(o, true) / 100; o += 2;
  out.vy = view.getInt16(o, true) / 100; o += 2;
  out.vz = view.getInt16(o, true) / 100; o += 2;
  out.flags = view.getUint8(o); o += 1;
  out.anim = view.getUint8(o); o += 1;
  out.health = view.getUint8(o); o += 1;
  out.weapon = view.getUint8(o); o += 1;
  out.vehicleId = view.getUint16(o, true); o += 2;
  out.steer = view.getInt8(o) / 127; o += 1;
  out.throttle = view.getInt8(o) / 127; o += 1;
  return out;
}

export function emptyState(): PlayerState {
  return { id: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0, flags: 0, anim: 0, health: 100, weapon: 0, vehicleId: 0, steer: 0, throttle: 0 };
}

export function encodeStateMessage(clientTime: number, s: PlayerState): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 8 + PLAYER_STATE_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, BinaryKind.State);
  v.setFloat64(1, clientTime, true);
  writePlayerState(v, 9, s);
  return buf;
}

export function encodeSnapshot(serverTime: number, states: PlayerState[]): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 8 + 2 + PLAYER_STATE_BYTES * states.length);
  const v = new DataView(buf);
  v.setUint8(0, BinaryKind.Snapshot);
  v.setFloat64(1, serverTime, true);
  v.setUint16(9, states.length, true);
  let o = 11;
  for (const s of states) o = writePlayerState(v, o, s);
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer): { serverTime: number; states: PlayerState[] } {
  const v = new DataView(buf);
  const serverTime = v.getFloat64(1, true);
  const n = v.getUint16(9, true);
  const states: PlayerState[] = new Array(n);
  let o = 11;
  for (let i = 0; i < n; i++) { states[i] = readPlayerState(v, o); o += PLAYER_STATE_BYTES; }
  return { serverTime, states };
}

export function decodeStateMessage(buf: ArrayBuffer): { clientTime: number; state: PlayerState } {
  const v = new DataView(buf);
  return { clientTime: v.getFloat64(1, true), state: readPlayerState(v, 9) };
}

function clampI16(n: number): number { return Math.max(-32768, Math.min(32767, n)); }
function wrapPi(a: number): number { a = a % (2 * Math.PI); if (a > Math.PI) a -= 2 * Math.PI; if (a < -Math.PI) a += 2 * Math.PI; return a; }

// ---------------------------------------------------------------------------------------------
// JSON control messages
// ---------------------------------------------------------------------------------------------
export interface WeatherState {
  condition: 'clear' | 'partly_cloudy' | 'cloudy' | 'fog' | 'rain' | 'heavy_rain' | 'snow' | 'thunder';
  cloudCover: number; // 0..1
  precip: number; // 0..1 intensity
  wind: number; // m/s
  windDir: number; // radians, direction wind blows TOWARD (yaw convention)
  temperatureC: number;
  wetness: number; // 0..1, how wet the streets are (server integrates; decays after rain)
  source: string; // 'nws' or 'fallback'
}

export interface LeaderboardEntry { rank: number; name: string; score: number; kills: number; online: boolean; }

export interface Pickup { id: number; kind: 'weapon' | 'health' | 'armor'; weapon?: WeaponId; x: number; y: number; z: number; }

export interface VehicleInfo { id: number; key: string; driverId: number; kind: string; }

export interface InventoryState { weapons: { id: WeaponId; ammo: number; mag: number }[]; current: WeaponId; }

/** client -> server */
export type ClientMessage =
  | { t: 'hello'; name: string; token: string | null; version: string; protocol: number; email?: string; newsletter?: boolean } // omitted consent is false
  | { t: 'adminFly'; enabled: boolean }
  | { t: 'adminTeleport'; x: number; y: number; z: number; yaw?: number }
  | { t: 'respawn' }
  | { t: 'shoot'; w: WeaponId; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number; ct: number; seq: number }
  | { t: 'melee'; targetId: number; ct: number }
  | { t: 'pickup'; id: number }
  | { t: 'enterVehicle'; key: string; kind: string; x: number; y: number; z: number; yaw: number }
  | { t: 'exitVehicle' }
  | { t: 'switchWeapon'; w: WeaponId }
  | { t: 'reload' }
  | { t: 'ping'; ct: number }
  | { t: 'leaderboard' }
  | { t: 'setName'; name: string };

/** server -> client */
export type ServerMessage =
  | { t: 'registrationRequired'; reason: string }
  | { t: 'welcomeRefused'; reason: string; retryAfterS: number }
  | { t: 'adminState'; admin: boolean; flying: boolean }
  | { t: 'welcome'; id: number; token: string; name: string; version: string; protocol: number; restored: boolean; health: number; armor: number; dead: boolean; vehicle: VehicleInfo | null; serverTime: number; dayFraction: number; dayLength: number; weather: WeatherState; spawn: { x: number; y: number; z: number; yaw: number }; safeZone: { x: number; z: number; radius: number }; protectedUntil: number; score: number; inventory: InventoryState; playersOnline: number; era: string }
  | { t: 'join'; id: number; name: string; score: number }
  | { t: 'leave'; id: number }
  | { t: 'names'; players: { id: number; name: string; score: number }[] } // names for ids in AOI you haven't seen
  | { t: 'hit'; shooterId: number; victimId: number; damage: number; headshot: boolean; x: number; y: number; z: number; seq: number }
  | { t: 'miss'; shooterId: number; x: number; y: number; z: number; surface: 'building' | 'ground' | 'none'; seq: number }
  | { t: 'health'; health: number; armor: number }
  | { t: 'death'; victimId: number; killerId: number; killerName: string; weapon: WeaponId }
  | { t: 'respawned'; x: number; y: number; z: number; yaw: number; protectedUntil: number; inventory: InventoryState }
  | { t: 'score'; score: number; delta: number; reason: string }
  | { t: 'leaderboard'; entries: LeaderboardEntry[]; you: LeaderboardEntry | null; online: number }
  | { t: 'pickups'; add: Pickup[]; remove: number[] }
  | { t: 'inventory'; inventory: InventoryState }
  | { t: 'vehicle'; v: VehicleInfo } // ownership change (driverId 0 = released)
  | { t: 'vehicles'; list: VehicleInfo[] } // vehicles in AOI
  | { t: 'time'; serverTime: number; dayFraction: number; weather: WeatherState }
  | { t: 'pong'; ct: number; st: number }
  | { t: 'version'; version: string; protocol: number; mustUpdate: boolean }
  | { t: 'restart'; inSeconds: number } // freeze input, retain the rendered world, reconnect by token
  | { t: 'discover'; kind: 'landmark' | 'neighborhood'; name: string; first: boolean; delta: number }
  | { t: 'kick'; reason: string }
  | { t: 'online'; count: number };

export type ClientMessageType = ClientMessage['t'];
export type ServerMessageType = ServerMessage['t'];
