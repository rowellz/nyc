/**
 * World coordinate system (THE contract every module uses).
 *
 * Local tangent-plane projection in METERS, true scale.
 *   x = east  (meters from origin)
 *   y = up    (meters above mean street level; y=0 is ground in the present-day city)
 *   z = SOUTH (meters from origin)  -- three.js +z points toward the viewer, so north is -z.
 *
 * Origin: the center of Bryant Park lawn, Manhattan (the safe zone).
 * Manhattan's street grid is rotated ~29° east of true north; that rotation is preserved
 * automatically because we project real coordinates.
 */
export const ORIGIN = { lat: 40.75362, lon: -73.98322 } as const;

const R_LAT = 110574.0; // meters per degree latitude at ~40.75N
const R_LON = 111320.0 * Math.cos((ORIGIN.lat * Math.PI) / 180); // meters per degree longitude

/** lon/lat (degrees) -> { x (east), z (south) } in meters. */
export function lonLatToXZ(lon: number, lat: number): { x: number; z: number } {
  return { x: (lon - ORIGIN.lon) * R_LON, z: -(lat - ORIGIN.lat) * R_LAT };
}

/** { x, z } meters -> { lon, lat } degrees. */
export function xzToLonLat(x: number, z: number): { lon: number; lat: number } {
  return { lon: ORIGIN.lon + x / R_LON, lat: ORIGIN.lat - z / R_LAT };
}

/** Compass heading in degrees (0 = north, 90 = east) -> three.js yaw in radians about +y.
 *  A yaw of 0 faces -z (north). Positive yaw rotates counter-clockwise seen from above. */
export function headingToYaw(headingDeg: number): number {
  return -(headingDeg * Math.PI) / 180;
}
export function yawToHeading(yaw: number): number {
  let h = (-yaw * 180) / Math.PI;
  h %= 360;
  if (h < 0) h += 360;
  return h;
}

export const FEET_TO_M = 0.3048;

/** World tiling. Tiles are squares of TILE_SIZE meters keyed by integer indices. */
export const TILE_SIZE = 256;
export function tileIndex(v: number): number {
  return Math.floor(v / TILE_SIZE);
}
export function tileKey(tx: number, tz: number): string {
  return `${tx}_${tz}`;
}
export function tileOrigin(tx: number, tz: number): { ox: number; oz: number } {
  return { ox: tx * TILE_SIZE, oz: tz * TILE_SIZE };
}

/** Bounding box of the built world, WGS84. Everything outside is water / nothing. */
export const WORLD_BBOX = { south: 40.68, west: -74.035, north: 40.885, east: -73.9 } as const;
