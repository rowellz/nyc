/** Small presentation helpers shared by the pages. */

/** The world clock: dayFraction 0..1 over a 2-hour day, rendered as HH:MM. */
export function cityClock(dayFraction) {
  const minutes = Math.floor((dayFraction ?? 0) * 24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Which part of the 2-hour day cycle the city is in. */
export function phaseOfDay(dayFraction) {
  const h = (dayFraction ?? 0) * 24;
  if (h < 5) return 'night';
  if (h < 7) return 'dawn';
  if (h < 17) return 'day';
  if (h < 20) return 'dusk';
  return 'night';
}

export function duration(seconds) {
  const s = Math.max(0, Math.round(seconds ?? 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const WEATHER_LABELS = {
  clear: 'Clear', partly_cloudy: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog',
  rain: 'Rain', heavy_rain: 'Heavy rain', snow: 'Snow', thunder: 'Thunder',
};
export const weatherLabel = (c) => WEATHER_LABELS[c] ?? c ?? 'unknown';

/** Compass point for a heading in degrees, for the viewpoint cards. */
export function compass(deg) {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
