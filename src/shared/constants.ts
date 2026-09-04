import { lonLatToXZ } from './geo';

/** Safe zone: nobody can shoot or be hit inside. Bryant Park. */
export const SAFE_ZONE = { x: 0, z: 0, radius: 115 } as const;

/** New players are invulnerable for this long after (re)spawning, or until they fire a weapon. */
export const SPAWN_PROTECTION_SECONDS = 120;

/** Spawn points ring the safe zone. World meters. */
export const SPAWN_POINTS: { x: number; z: number; yawDeg: number; name: string }[] = [
  { ...lonLatToXZ(-73.98380, 40.75335), yawDeg: 30, name: 'Bryant Park, 6th Ave side' },
  { ...lonLatToXZ(-73.98213, 40.75416), yawDeg: 210, name: 'Bryant Park, 42nd St side' },
  { ...lonLatToXZ(-73.98285, 40.75305), yawDeg: 300, name: 'Bryant Park, 40th St side' },
  { ...lonLatToXZ(-73.98169, 40.75326), yawDeg: 120, name: 'NYPL steps' },
  { ...lonLatToXZ(-73.98422, 40.75468), yawDeg: 200, name: '6th Ave & 43rd' },
];

/** In-game day length in real seconds. Server owns the clock. 2 real hours = 1 in-game day. */
export const DAY_LENGTH_SECONDS = 7200;

/** Networking rates. */
export const CLIENT_STATE_HZ = 20;
export const SERVER_SNAPSHOT_HZ = 15;
export const AOI_RADIUS_M = 350; // players within this radius are streamed to you
export const MAX_PLAYERS = 4000;

/** Player. */
export const PLAYER_MAX_HEALTH = 100;
export const PLAYER_WALK_SPEED = 2.2; // m/s
export const PLAYER_RUN_SPEED = 6.0; // m/s
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.35;

/** Score. Server is the only thing that writes score. */
export const SCORE = {
  KILL: 100,
  ASSIST: 25,
  SURVIVE_PER_MINUTE: 2,
  DISTANCE_DRIVEN_PER_KM: 5,
  DISTANCE_WALKED_PER_KM: 3,
  NEIGHBORHOOD_DISCOVERED: 25,
  LANDMARK_DISCOVERED: 50,
  LANDMARK_FIRST_FINDER: 250,
  WEAPON_FIRST_PICKUP: 10,
} as const;

/** Landmarks: discovery bonus + "first to find" bonus. World meters computed from real coordinates. */
export const LANDMARKS: { id: string; name: string; x: number; z: number; radius: number }[] = [
  { id: 'times-square', name: 'Times Square', ...lonLatToXZ(-73.98565, 40.75797), radius: 90 },
  { id: 'empire-state', name: 'Empire State Building', ...lonLatToXZ(-73.98566, 40.74844), radius: 90 },
  { id: 'flatiron', name: 'Flatiron Building', ...lonLatToXZ(-73.98964, 40.74106), radius: 70 },
  { id: 'grand-central', name: 'Grand Central Terminal', ...lonLatToXZ(-73.97727, 40.75273), radius: 90 },
  { id: 'chrysler', name: 'Chrysler Building', ...lonLatToXZ(-73.97557, 40.75174), radius: 70 },
  { id: 'rockefeller', name: 'Rockefeller Center', ...lonLatToXZ(-73.97869, 40.75874), radius: 90 },
  { id: 'columbus-circle', name: 'Columbus Circle', ...lonLatToXZ(-73.98197, 40.76807), radius: 70 },
  { id: 'washington-square', name: 'Washington Square Arch', ...lonLatToXZ(-73.99741, 40.73129), radius: 70 },
  { id: 'union-square', name: 'Union Square', ...lonLatToXZ(-73.99060, 40.73580), radius: 90 },
  { id: 'wall-street', name: 'Wall Street', ...lonLatToXZ(-74.01072, 40.70666), radius: 70 },
  { id: 'one-wtc', name: 'One World Trade Center', ...lonLatToXZ(-74.01337, 40.71298), radius: 110 },
  { id: 'brooklyn-bridge', name: 'Brooklyn Bridge', ...lonLatToXZ(-73.99944, 40.70603), radius: 120 },
  { id: 'chinatown', name: 'Canal Street, Chinatown', ...lonLatToXZ(-73.99805, 40.71781), radius: 90 },
  { id: 'soho', name: 'SoHo cast-iron district', ...lonLatToXZ(-73.99893, 40.72422), radius: 120 },
  { id: 'st-marks', name: 'St. Marks Place', ...lonLatToXZ(-73.98849, 40.72864), radius: 80 },
  { id: 'high-line', name: 'The High Line', ...lonLatToXZ(-74.00494, 40.74532), radius: 90 },
  { id: 'hudson-yards', name: 'Hudson Yards', ...lonLatToXZ(-74.00212, 40.75387), radius: 110 },
  { id: 'central-park-south', name: 'Central Park South', ...lonLatToXZ(-73.97600, 40.76550), radius: 110 },
  { id: 'lincoln-center', name: 'Lincoln Center', ...lonLatToXZ(-73.98346, 40.77250), radius: 90 },
  { id: 'apollo', name: 'Apollo Theater, 125th St', ...lonLatToXZ(-73.95004, 40.81005), radius: 80 },
  { id: 'battery', name: 'The Battery', ...lonLatToXZ(-74.01631, 40.70338), radius: 130 },
  { id: 'un', name: 'United Nations', ...lonLatToXZ(-73.96821, 40.74898), radius: 110 },
  { id: 'katz', name: "Katz's Delicatessen", ...lonLatToXZ(-73.98722, 40.72232), radius: 50 },
  { id: 'stuytown', name: 'Stuyvesant Town', ...lonLatToXZ(-73.97800, 40.73180), radius: 150 },
  { id: 'columbia', name: 'Columbia University', ...lonLatToXZ(-73.96257, 40.80754), radius: 150 },
  { id: 'yankee-view', name: 'Harlem River, 155th', ...lonLatToXZ(-73.93520, 40.82780), radius: 120 },
  { id: 'roosevelt-tram', name: 'Roosevelt Island Tramway', ...lonLatToXZ(-73.96435, 40.76132), radius: 70 },
];
