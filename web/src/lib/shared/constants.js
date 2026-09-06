/**
 * Ported from the recovered src/shared/geo.ts and src/shared/constants.ts.
 * ESM for the SvelteKit service; values are identical to server/constants.js.
 */
export const ORIGIN = { lat: 40.75362, lon: -73.98322 };
export const R_LAT = 110574.0;
export const R_LON = 111320.0 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const lonLatToXZ = (lon, lat) => ({ x: (lon - ORIGIN.lon) * R_LON, z: -(lat - ORIGIN.lat) * R_LAT });
export const headingToYaw = (deg) => -(deg * Math.PI) / 180;

export const TILE_SIZE = 256;
export const SAFE_ZONE = { x: 0, z: 0, radius: 115 };
export const SPAWN_PROTECTION_SECONDS = 120;
export const DAY_LENGTH_SECONDS = 7200;
export const CLIENT_STATE_HZ = 20;
export const SERVER_SNAPSHOT_HZ = 15;
export const AOI_RADIUS_M = 350;
export const MAX_PLAYERS = 4000;
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.35;

export const SCORE = {
  KILL: 100, ASSIST: 25, SURVIVE_PER_MINUTE: 2,
  DISTANCE_DRIVEN_PER_KM: 5, DISTANCE_WALKED_PER_KM: 3,
  NEIGHBORHOOD_DISCOVERED: 25, LANDMARK_DISCOVERED: 50,
  LANDMARK_FIRST_FINDER: 250, WEAPON_FIRST_PICKUP: 10,
};

export const SPAWN_POINTS = [
  { ...lonLatToXZ(-73.98380, 40.75335), yawDeg: 30,  name: 'Bryant Park, 6th Ave side' },
  { ...lonLatToXZ(-73.98213, 40.75416), yawDeg: 210, name: 'Bryant Park, 42nd St side' },
  { ...lonLatToXZ(-73.98285, 40.75305), yawDeg: 300, name: 'Bryant Park, 40th St side' },
  { ...lonLatToXZ(-73.98169, 40.75326), yawDeg: 120, name: 'NYPL steps' },
  { ...lonLatToXZ(-73.98422, 40.75468), yawDeg: 200, name: '6th Ave & 43rd' },
];

export const LANDMARKS = [
  ['times-square','Times Square',-73.98565,40.75797,90], ['empire-state','Empire State Building',-73.98566,40.74844,90],
  ['flatiron','Flatiron Building',-73.98964,40.74106,70], ['grand-central','Grand Central Terminal',-73.97727,40.75273,90],
  ['chrysler','Chrysler Building',-73.97557,40.75174,70], ['rockefeller','Rockefeller Center',-73.97869,40.75874,90],
  ['columbus-circle','Columbus Circle',-73.98197,40.76807,70], ['washington-square','Washington Square Arch',-73.99741,40.73129,70],
  ['union-square','Union Square',-73.99060,40.73580,90], ['wall-street','Wall Street',-74.01072,40.70666,70],
  ['one-wtc','One World Trade Center',-74.01337,40.71298,110], ['brooklyn-bridge','Brooklyn Bridge',-73.99944,40.70603,120],
  ['chinatown','Canal Street, Chinatown',-73.99805,40.71781,90], ['soho','SoHo cast-iron district',-73.99893,40.72422,120],
  ['st-marks','St. Marks Place',-73.98849,40.72864,80], ['high-line','The High Line',-74.00494,40.74532,90],
  ['hudson-yards','Hudson Yards',-74.00212,40.75387,110], ['central-park-south','Central Park South',-73.97600,40.76550,110],
  ['lincoln-center','Lincoln Center',-73.98346,40.77250,90], ['apollo','Apollo Theater, 125th St',-73.95004,40.81005,80],
  ['battery','The Battery',-74.01631,40.70338,130], ['un','United Nations',-73.96821,40.74898,110],
  ["katz","Katz's Delicatessen",-73.98722,40.72232,50], ['stuytown','Stuyvesant Town',-73.97800,40.73180,150],
  ['columbia','Columbia University',-73.96257,40.80754,150], ['yankee-view','Harlem River, 155th',-73.93520,40.82780,120],
  ['roosevelt-tram','Roosevelt Island Tramway',-73.96435,40.76132,70],
].map(([id, name, lon, lat, radius]) => ({ id, name, ...lonLatToXZ(lon, lat), radius }));

/** From the recovered src/shared/weapons.ts. */
export const WeaponId = { None: 0, Pistol: 1, SMG: 2, Shotgun: 3, Rifle: 4 };
export const WEAPONS = {
  1: { id: 1, name: 'Pistol',  damage: 22, headshotMultiplier: 2.0, range: 120, roundsPerMinute: 320, spreadDeg: 1.8, aimSpreadDeg: 0.6, pellets: 1, magazine: 15, reloadSeconds: 1.4, automatic: false, startingAmmo: 60 },
  2: { id: 2, name: 'SMG',     damage: 14, headshotMultiplier: 1.8, range: 90,  roundsPerMinute: 780, spreadDeg: 3.0, aimSpreadDeg: 1.4, pellets: 1, magazine: 30, reloadSeconds: 1.9, automatic: true,  startingAmmo: 120 },
  3: { id: 3, name: 'Shotgun', damage: 11, headshotMultiplier: 1.5, range: 32,  roundsPerMinute: 70,  spreadDeg: 5.5, aimSpreadDeg: 4.0, pellets: 8, magazine: 6,  reloadSeconds: 2.6, automatic: false, startingAmmo: 30 },
  4: { id: 4, name: 'Rifle',   damage: 30, headshotMultiplier: 2.2, range: 260, roundsPerMinute: 520, spreadDeg: 2.2, aimSpreadDeg: 0.5, pellets: 1, magazine: 30, reloadSeconds: 2.3, automatic: true,  startingAmmo: 90 },
};
