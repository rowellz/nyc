/**
 * URL parameters, parsed once. Shared by screenshot/quality/streamer/debug.
 *   ?spot=<id>          named camera spot (core/spots.ts) -> screenshot mode
 *   ?fly=x,z,h,heading,pitch   custom camera spot in world meters -> screenshot mode
 *   ?time=HH:MM         freeze the clock
 *   ?weather=<cond>     force a weather condition (WeatherState.condition)
 *   ?nohud=1            hide #ui
 *   ?q=low|medium|high|ultra
 *   ?fov=<deg>
 *   ?debug=1            debug world rendering + overlay
 *   ?world=<url>        alternate world base url (default /world)
 *   ?server=<ws url>    alternate websocket url
 *   ?name=<name>        player name for this session (not persisted)
 *   ?modules=a,b | none only create these modules (core fallbacks fill the gaps): isolate one module, or measure core alone
 */
import { basePath } from './basePath';

export interface UrlParams {
  spot: string | null;
  fly: { x: number; z: number; h: number; heading: number; pitch: number } | null;
  time: string | null;
  weather: string | null;
  nohud: boolean;
  q: string | null;
  fov: number | null;
  debug: boolean;
  world: string;
  server: string | null;
  name: string | null;
  /** null = all modules; [] (from "none") = core only */
  modules: string[] | null;
  screenshotMode: boolean;
  raw: URLSearchParams;
}

function flag(p: URLSearchParams, k: string): boolean {
  const v = p.get(k);
  return v !== null && v !== '0' && v !== 'false';
}

export function parseParams(search: string = typeof location !== 'undefined' ? location.search : ''): UrlParams {
  const p = new URLSearchParams(search);
  let fly: UrlParams['fly'] = null;
  const flyRaw = p.get('fly');
  if (flyRaw) {
    const n = flyRaw.split(',').map((s) => parseFloat(s));
    if (n.length >= 2 && n.every((v, i) => i >= 2 || Number.isFinite(v))) {
      fly = { x: n[0], z: n[1], h: Number.isFinite(n[2]) ? n[2] : 1.7, heading: Number.isFinite(n[3]) ? n[3] : 0, pitch: Number.isFinite(n[4]) ? n[4] : 0 };
    }
  }
  const fovRaw = p.get('fov');
  const fov = fovRaw ? parseFloat(fovRaw) : NaN;
  let world = p.get('world') || basePath('/world');
  if (world.endsWith('/')) world = world.slice(0, -1);
  const spot = p.get('spot');
  const modsRaw = p.get('modules');
  const modules = modsRaw === null ? null : modsRaw.trim().toLowerCase() === 'none' ? [] : modsRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return {
    spot,
    fly,
    time: p.get('time'),
    weather: p.get('weather'),
    nohud: flag(p, 'nohud'),
    q: p.get('q'),
    fov: Number.isFinite(fov) && fov > 10 && fov < 150 ? fov : null,
    debug: flag(p, 'debug'),
    world,
    server: p.get('server'),
    name: p.get('name'),
    modules,
    screenshotMode: !!spot || !!fly,
    raw: p,
  };
}

/** "18:00" | "18" | "6:30pm" -> 0..1 fraction of the day, or null */
export function parseTimeOfDay(s: string): number | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/);
  if (!m) {
    const f = parseFloat(s);
    return Number.isFinite(f) && f >= 0 && f <= 1 ? f : null;
  }
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h < 0 || h > 24 || min < 0 || min >= 60) return null;
  return ((h * 60 + min) / 1440) % 1;
}

export function formatTimeOfDay(f: number): string {
  const mins = Math.floor(((f % 1) + 1) % 1 * 1440);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
