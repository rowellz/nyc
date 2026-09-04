/**
 * ClientState + LocalPlayer initial values.
 * Name comes from localStorage 'nyc.name' (the ui module prompts for it), token from 'nyc.token'.
 */
import * as THREE from 'three';
import { emptyState, type WeatherState } from '@shared/protocol';
import { GAME_VERSION } from '@shared/version';
import { SAFE_ZONE, DAY_LENGTH_SECONDS, PLAYER_MAX_HEALTH } from '@shared/constants';
import type { ClientState, LocalPlayer } from './context';

export const LS_NAME = 'nyc.name';
export const LS_TOKEN = 'nyc.token';

export function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / disabled */
  }
}

export function defaultWeather(): WeatherState {
  return { condition: 'clear', cloudCover: 0.15, precip: 0, wind: 3, windDir: Math.PI * 0.75, temperatureC: 18, wetness: 0, source: 'fallback' };
}

export function createLocalPlayer(nameOverride?: string | null): LocalPlayer {
  const state = emptyState();
  state.health = PLAYER_MAX_HEALTH;
  return {
    id: 0,
    name: lsGet(LS_TOKEN) ? lsGet(LS_NAME) || '' : '',
    token: lsGet(LS_TOKEN) || '',
    state,
    armor: 0,
    score: 0,
    inventory: { weapons: [], current: 0 },
    protectedUntil: 0,
    dead: false,
    vehicleKey: null,
    eye: new THREE.Vector3(0, 1.6, 0),
    aimDir: new THREE.Vector3(0, 0, -1),
  };
}

export function createClientState(opts: { screenshotMode: boolean; debug: boolean; name?: string | null }): ClientState {
  const st: ClientState = {
    local: createLocalPlayer(opts.name),
    remotes: new Map(),
    serverTimeOffset: 0,
    serverTime() {
      return performance.now() / 1000 + st.serverTimeOffset;
    },
    dayFraction: localClockFraction(),
    weather: defaultWeather(),
    version: GAME_VERSION,
    latestVersion: GAME_VERSION,
    online: 0,
    leaderboard: [],
    pickups: new Map(),
    vehicles: new Map(),
    safeZone: { ...SAFE_ZONE },
    era: 'present',
    ping: 0,
    screenshotMode: opts.screenshotMode,
    dayLength: DAY_LENGTH_SECONDS,
    welcomed: false,
    debug: opts.debug,
  };
  return st;
}

/** Until the server syncs us, use the real local wall clock so the light looks right immediately. */
function localClockFraction(): number {
  const d = new Date();
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
}
