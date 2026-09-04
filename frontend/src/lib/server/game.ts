import { env } from '$env/dynamic/private';

/** Where the game service lives on the internal network (compose: http://nyc:8080). */
export const GAME_ORIGIN = env.GAME_ORIGIN ?? 'http://127.0.0.1:8080';
export const BASE_PATH = env.GAME_BASE_PATH ?? '/world';

export interface WeatherState {
  condition: string;
  cloudCover: number;
  precip: number;
  wind: number;
  windDir: number;
  temperatureC: number;
  wetness: number;
  source: string;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  kills: number;
  online: boolean;
}

export interface GameStatus {
  version: string;
  protocol: number;
  playersOnline: number;
  profilesSeen: number;
  uptimeSeconds: number;
  serverTime: number;
  dayFraction: number;
  dayLength: number;
  weather: WeatherState;
  safeZone: { x: number; z: number; radius: number };
  landmarks: number;
  landmarksDiscovered: number;
  players: { id: number; name: string; score: number; kills: number; dead: boolean; x: number; z: number }[];
  leaderboard: LeaderboardEntry[];
}

/** Reads /world/api/status. Returns null when the game service is unreachable. */
export async function fetchStatus(fetcher: typeof fetch = fetch): Promise<GameStatus | null> {
  try {
    const res = await fetcher(`${GAME_ORIGIN}${BASE_PATH}/api/status`, {
      signal: AbortSignal.timeout(4000),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as GameStatus;
  } catch {
    return null;
  }
}

/**
 * The game client is a compiled Vite bundle with hashed filenames. Rather than
 * pinning a hash that changes on every re-mirror, read the tags out of the
 * served index.html and hand them to the page that mounts the game.
 */
export interface ClientBundle {
  module: string;
  css: string[];
  modulepreload: string[];
}

export async function fetchClientBundle(fetcher: typeof fetch = fetch): Promise<ClientBundle | null> {
  try {
    const res = await fetcher(`${GAME_ORIGIN}${BASE_PATH}/`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const html = await res.text();
    const module = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/)?.[1];
    if (!module) return null;
    return {
      module,
      css: [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
      modulepreload: [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) => m[1]),
    };
  } catch {
    return null;
  }
}
