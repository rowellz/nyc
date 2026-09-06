/**
 * Wire protocol — reconstructed verbatim from the client's shared/protocol.ts
 * (recovered from the published source maps). See src/shared/protocol.ts.
 *
 * Ported to ESM for the SvelteKit service; the byte layout is unchanged, so a
 * client cannot tell which implementation it is talking to.
 *
 * Transport: one WebSocket at /world/ws.
 *   TEXT   frames = JSON control messages { t: '<type>', ... }
 *   BINARY frames = high-frequency state, first byte = BinaryKind.
 */
export const PROTOCOL_VERSION = 1;
export const GAME_VERSION = '0.2.8';

export const BinaryKind = { Snapshot: 1, State: 2 };

export const StateFlag = {
  Aiming: 1 << 0,
  Crouch: 1 << 1,
  Sprint: 1 << 2,
  InVehicle: 1 << 3,
  Firing: 1 << 4,
  Dead: 1 << 5,
  Protected: 1 << 6,
  Airborne: 1 << 7,
};

export const PLAYER_STATE_BYTES = 34;

const clampI16 = (n) => Math.max(-32768, Math.min(32767, n));
function wrapPi(a) {
  a = a % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function emptyState() {
  return { id: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vx: 0, vy: 0, vz: 0,
           flags: 0, anim: 0, health: 100, weapon: 0, vehicleId: 0, steer: 0, throttle: 0 };
}

export function writePlayerState(view, o, s) {
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

export function readPlayerState(view, o, out = emptyState()) {
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

export function encodeSnapshot(serverTime, states) {
  const buf = new ArrayBuffer(1 + 8 + 2 + PLAYER_STATE_BYTES * states.length);
  const v = new DataView(buf);
  v.setUint8(0, BinaryKind.Snapshot);
  v.setFloat64(1, serverTime, true);
  v.setUint16(9, states.length, true);
  let o = 11;
  for (const s of states) o = writePlayerState(v, o, s);
  return Buffer.from(buf);
}

export function decodeStateMessage(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { clientTime: v.getFloat64(1, true), state: readPlayerState(v, 9) };
}
