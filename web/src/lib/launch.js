/**
 * Builds /world/ URLs from the client's own query parameters
 * (src/client/src/core/params.ts). A `spot` or `fly` puts the client into
 * screenshot mode, which skips the entry form entirely.
 */
export const QUALITIES = [
  { value: '', label: 'Auto-detect' },
  { value: 'ultra', label: 'Ultra' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'mobile', label: 'Mobile' },
];

export const WEATHERS = [
  { value: '', label: "Server's weather" },
  { value: 'clear', label: 'Clear' },
  { value: 'partly_cloudy', label: 'Partly cloudy' },
  { value: 'cloudy', label: 'Cloudy' },
  { value: 'fog', label: 'Fog' },
  { value: 'rain', label: 'Rain' },
  { value: 'heavy_rain', label: 'Heavy rain' },
  { value: 'snow', label: 'Snow' },
  { value: 'thunder', label: 'Thunder' },
];

export const TIMES = [
  { value: '', label: "Server's clock" },
  { value: '06:15', label: '06:15 dawn' },
  { value: '09:00', label: '09:00 morning' },
  { value: '13:30', label: '13:30 midday' },
  { value: '18:00', label: '18:00 golden hour' },
  { value: '20:30', label: '20:30 dusk' },
  { value: '23:30', label: '23:30 night' },
];

/** @param {{ spot?: string, time?: string, weather?: string, q?: string, nohud?: boolean, debug?: boolean }} o */
export function worldUrl(o = {}) {
  const p = new URLSearchParams();
  if (o.spot) p.set('spot', o.spot);
  if (o.time) p.set('time', o.time);
  if (o.weather) p.set('weather', o.weather);
  if (o.q) p.set('q', o.q);
  if (o.nohud) p.set('nohud', '1');
  if (o.debug) p.set('debug', '1');
  const qs = p.toString();
  return qs ? `/world/?${qs}` : '/world/';
}
