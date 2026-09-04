/**
 * Time of day + sun/moon position for Manhattan (lat 40.75, lon -73.98).
 *
 * Solar position: NOAA General Solar Position Calculations (Spencer fractional-year series for
 * declination and equation of time). Day of year comes from today's real date; the hour angle
 * comes from dayFraction treated as New York LOCAL CLOCK TIME (0.5 == 12:00), corrected
 * for longitude, the equation of time, and the date's EST/EDT offset.
 *
 * World vector convention (shared/geo.ts): x east, y up, z south.
 *   dir = (cos(el)*sin(az), sin(el), -cos(el)*cos(az)), az = compass azimuth from north, clockwise.
 */
import * as THREE from 'three';
import { DAY_LENGTH_SECONDS } from '@shared/constants';
import type { ClientState, TimeOfDay } from './context';

export const NYC_LAT = 40.75;
export const NYC_LON = -73.98;
const DEG = Math.PI / 180;
const nycDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
});
const nycHourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23',
});

function nycCalendarDate(d: Date): { year: number; month: number; day: number } {
  const parts = nycDateFormat.formatToParts(d);
  const part = (type: string) => Number(parts.find(p => p.type === type)!.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

/** UTC offset for the New York calendar day, sampled at noon UTC (after DST transitions). */
function nycUtcOffset(doy: number, year = nycCalendarDate(new Date()).year): number {
  const date = new Date(Date.UTC(year, 0, doy, 12));
  return Number(nycHourFormat.formatToParts(date).find(p => p.type === 'hour')!.value) - 12;
}

export interface SolarPosition {
  elevation: number; // radians
  azimuth: number; // radians, compass from north, clockwise
  declination: number; // radians
  hourAngle: number; // radians
}

export function dayOfYear(d: Date = new Date()): number {
  const { year, month, day } = nycCalendarDate(d);
  const start = Date.UTC(year, 0, 1);
  const now = Date.UTC(year, month - 1, day);
  return Math.floor((now - start) / 86400000) + 1;
}

/** Solar declination + equation of time (minutes) from the fractional year (Spencer 1971 / NOAA). */
export function solarConstants(doy: number, hourLocal = 12): { declination: number; eqTimeMin: number } {
  const g = ((2 * Math.PI) / 365) * (doy - 1 + (hourLocal - 12) / 24);
  const eqTimeMin = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const declination =
    0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  return { declination, eqTimeMin };
}

/**
 * Sun position for a fraction of the local clock day.
 * @param dayFraction 0..1, 0 = midnight, 0.5 = 12:00 local clock time
 * @param lonDeg Longitude, positive east of Greenwich
 * @param utcOffsetHours Hours east of UTC (EDT = -4, EST = -5); defaults to New York
 * on doy in the current year. Supply explicitly for another year/location.
 */
export function solarPosition(dayFraction: number, doy: number, latDeg = NYC_LAT, lonDeg = NYC_LON, utcOffsetHours = nycUtcOffset(doy)): SolarPosition {
  const lat = latDeg * DEG;
  const hours = ((dayFraction % 1) + 1) % 1 * 24;
  const { declination, eqTimeMin } = solarConstants(doy, hours);
  const timeOffsetMin = eqTimeMin + 4 * lonDeg - 60 * utcOffsetHours;
  const solarMinutes = ((hours * 60 + timeOffsetMin) % 1440 + 1440) % 1440;
  const hourAngle = (solarMinutes / 4 - 180) * DEG; // negative before solar noon
  const sinEl = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(THREE.MathUtils.clamp(sinEl, -1, 1));
  const cosEl = Math.cos(elevation);
  let azimuth: number;
  if (Math.abs(cosEl) < 1e-6) {
    azimuth = Math.PI; // zenith: arbitrary
  } else {
    const cosAz = THREE.MathUtils.clamp((Math.sin(declination) - sinEl * Math.sin(lat)) / (cosEl * Math.cos(lat)), -1, 1);
    azimuth = Math.acos(cosAz); // 0..pi measured from north toward east
    if (hourAngle > 0) azimuth = 2 * Math.PI - azimuth; // afternoon: sun in the west
  }
  return { elevation, azimuth, declination, hourAngle };
}

/** compass azimuth/elevation -> world direction (x east, y up, z south) */
export function azElToDir(az: number, el: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(el);
  return out.set(c * Math.sin(az), Math.sin(el), -c * Math.cos(az)).normalize();
}

/** Atmospheric refraction correction near the horizon (NOAA), radians in/out. Applied to the rendered sun. */
export function refractionCorrection(elevation: number): number {
  const elDeg = elevation / DEG;
  if (elDeg > 85) return 0;
  const te = Math.tan(elevation);
  let corr: number;
  if (elDeg > 5) corr = 58.1 / te - 0.07 / Math.pow(te, 3) + 0.000086 / Math.pow(te, 5);
  else if (elDeg > -0.575) corr = 1735 + elDeg * (-518.2 + elDeg * (103.4 + elDeg * (-12.79 + elDeg * 0.711)));
  else corr = -20.774 / te;
  return (corr / 3600) * DEG;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Moon: roughly opposite the sun (near full-moon geometry) with a fixed offset so the two never line up exactly. */
const MOON_HOUR_OFFSET = 12.8; // hours behind the sun
const MOON_DECL_SCALE = -0.85; // moon runs the opposite side of the equator relative to the sun, within ±28°

export class TimeOfDayImpl implements TimeOfDay {
  dayFraction: number;
  sunDir = new THREE.Vector3(0, 1, 0);
  moonDir = new THREE.Vector3(0, -1, 0);
  sunElevation = 0;
  daylight = 1;
  frozen: boolean;
  sunAzimuth = 0;
  moonElevation = 0;
  doy: number;
  /** Fixed date, like doy: the accelerated clock does not advance the calendar. */
  private utcOffsetHours: number;
  private state: ClientState;

  constructor(state: ClientState, opts: { frozen?: boolean; fraction?: number; date?: Date } = {}) {
    this.state = state;
    const date = opts.date ?? new Date();
    this.doy = dayOfYear(date);
    this.utcOffsetHours = nycUtcOffset(this.doy, nycCalendarDate(date).year);
    this.frozen = !!opts.frozen;
    if (opts.fraction !== undefined) state.dayFraction = ((opts.fraction % 1) + 1) % 1;
    this.dayFraction = state.dayFraction;
    this.recompute();
  }

  setFraction(f: number): void {
    this.state.dayFraction = ((f % 1) + 1) % 1;
    this.dayFraction = this.state.dayFraction;
    this.recompute();
  }

  /** advance the clock (unless frozen) and refresh sun/moon */
  update(dt: number): void {
    if (!this.frozen) {
      const len = this.state.dayLength || DAY_LENGTH_SECONDS;
      this.state.dayFraction = (this.state.dayFraction + dt / len) % 1;
    }
    this.dayFraction = this.state.dayFraction;
    this.recompute();
  }

  recompute(): void {
    const sun = solarPosition(this.dayFraction, this.doy, NYC_LAT, NYC_LON, this.utcOffsetHours);
    this.sunElevation = sun.elevation;
    this.sunAzimuth = sun.azimuth;
    // render the sun where you'd see it (refraction lifts it ~0.5° at the horizon)
    azElToDir(sun.azimuth, sun.elevation + refractionCorrection(sun.elevation), this.sunDir);
    this.daylight = smoothstep(-6 * DEG, 4 * DEG, sun.elevation);

    const moonFrac = this.dayFraction - MOON_HOUR_OFFSET / 24;
    const moon = solarPosition(moonFrac, this.doy, NYC_LAT, NYC_LON, this.utcOffsetHours);
    // moon declination: mirror the sun's, scaled, so its arc is different from the sun's
    const lat = NYC_LAT * DEG;
    const decl = sun.declination * MOON_DECL_SCALE;
    const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(moon.hourAngle);
    const el = Math.asin(THREE.MathUtils.clamp(sinEl, -1, 1));
    const cosEl = Math.cos(el);
    let az = Math.PI;
    if (Math.abs(cosEl) > 1e-6) {
      az = Math.acos(THREE.MathUtils.clamp((Math.sin(decl) - sinEl * Math.sin(lat)) / (cosEl * Math.cos(lat)), -1, 1));
      if (moon.hourAngle > 0) az = 2 * Math.PI - az;
    }
    this.moonElevation = el;
    azElToDir(az, el, this.moonDir);
  }
}
