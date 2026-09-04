/**
 * Vehicle kinds: real dimensions (meters), body style used by the procedural generator, paint distributions
 * (NYC mix), and physics tuning. Everything downstream (geometry, fleet, traffic, parked, physics) keys off `id`.
 *
 * Model space: forward = -z, right = +x, up = +y, origin at ground level under the wheelbase center.
 */
export type BodyStyle = 'sedan' | 'taxi' | 'suv' | 'police' | 'van' | 'cabover' | 'bus' | 'garbage';

export interface VehicleSpec {
  id: string;
  label: string;
  style: BodyStyle;
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  tireWidth: number;
  /** distance from the wheelbase center to the nose (positive) and to the tail (positive) */
  front: number;
  rear: number;
  /** extra axles for trucks/buses: rear dual wheels */
  dualRear?: boolean;
  /** paint colors [hex, weight]; fixed liveries have one entry */
  colors: [number, number][];
  /** livery decal set painted into the atlas */
  livery: 'none' | 'taxi' | 'borotaxi' | 'nypd' | 'mta' | 'boxtruck' | 'van' | 'dsny';
  /** roof light (taxi) / lightbar (nypd) */
  roof: 'none' | 'taxi' | 'lightbar';
  mass: number;
  enginePeak: number; // N
  topSpeed: number; // m/s
  brakeForce: number; // N per wheel
  /** traffic spawn weight in Midtown */
  trafficWeight: number;
  /** parked weight */
  parkedWeight: number;
  seatX: number; // driver seat x (negative = left)
  seatY: number;
  seatZ: number;
}

// NYC on-street color mix (roughly: white 24, black 22, gray 18, silver 14, blue 9, red 7, other 6)
const NYC_COLORS: [number, number][] = [
  [0xf2f2f0, 24], // white
  [0x0a0a0c, 22], // black
  [0x5c5e62, 10], // gray
  [0x3a3c40, 8], // dark gray
  [0xb9bcc0, 14], // silver
  [0x1c2a4a, 6], // dark blue
  [0x2c4a7a, 3], // blue
  [0x6b1016, 5], // dark red
  [0xa8201e, 2], // red
  [0x2c3a2a, 2], // dark green
  [0x7a6a58, 2], // beige/brown
  [0xd9d2c0, 2], // champagne
];

export const KINDS: Record<string, VehicleSpec> = {
  // Accord/Camry-class sedan: 4.9 x 1.85 x 1.45 m, 2.8 m wheelbase, 235/45R18 tires
  sedan: {
    id: 'sedan', label: 'Sedan', style: 'sedan',
    length: 4.9, width: 1.85, height: 1.45, wheelbase: 2.8, track: 1.6, wheelRadius: 0.335, tireWidth: 0.225, front: 2.4, rear: 2.5,
    colors: NYC_COLORS, livery: 'none', roof: 'none',
    mass: 1550, enginePeak: 3600, topSpeed: 55, brakeForce: 2600, trafficWeight: 30, parkedWeight: 55, seatX: -0.38, seatY: 0.62, seatZ: 0.15,
  },
  // RAV4/CR-V-class crossover: 4.6 x 1.86 x 1.68 m, 2.7 m wheelbase, 225/60R18 tires
  suv: {
    id: 'suv', label: 'SUV', style: 'suv',
    length: 4.6, width: 1.86, height: 1.68, wheelbase: 2.7, track: 1.6, wheelRadius: 0.36, tireWidth: 0.225, front: 2.3, rear: 2.3,
    colors: NYC_COLORS, livery: 'none', roof: 'none',
    mass: 1700, enginePeak: 4200, topSpeed: 50, brakeForce: 3200, trafficWeight: 14, parkedWeight: 25, seatX: -0.42, seatY: 0.85, seatZ: 0.1,
  },
  blacksuv: {
    id: 'blacksuv', label: 'Black SUV', style: 'suv',
    length: 5.7, width: 2.06, height: 1.89, wheelbase: 3.4, track: 1.73, wheelRadius: 0.39, tireWidth: 0.275, front: 2.55, rear: 3.15,
    colors: [[0x050506, 1]], livery: 'none', roof: 'none',
    mass: 2600, enginePeak: 4800, topSpeed: 50, brakeForce: 3600, trafficWeight: 8, parkedWeight: 6, seatX: -0.44, seatY: 0.9, seatZ: 0.1,
  },
  // Toyota Camry hybrid (XV70) yellow cab: 4.89 x 1.84 x 1.445 m, 2.825 m wheelbase, 215/55R17 tires
  taxi: {
    id: 'taxi', label: 'Yellow Cab', style: 'taxi',
    length: 4.89, width: 1.84, height: 1.445, wheelbase: 2.825, track: 1.6, wheelRadius: 0.334, tireWidth: 0.215, front: 2.4, rear: 2.49,
    colors: [[0xf5b800, 1]], livery: 'taxi', roof: 'taxi',
    mass: 1600, enginePeak: 3600, topSpeed: 52, brakeForce: 2600, trafficWeight: 45, parkedWeight: 8, seatX: -0.38, seatY: 0.62, seatZ: 0.15,
  },
  borotaxi: {
    id: 'borotaxi', label: 'Boro Taxi', style: 'taxi',
    length: 4.89, width: 1.84, height: 1.445, wheelbase: 2.825, track: 1.6, wheelRadius: 0.334, tireWidth: 0.215, front: 2.4, rear: 2.49,
    colors: [[0x8dc63f, 1]], livery: 'borotaxi', roof: 'taxi',
    mass: 1600, enginePeak: 3600, topSpeed: 52, brakeForce: 2600, trafficWeight: 3, parkedWeight: 1, seatX: -0.38, seatY: 0.62, seatZ: 0.15,
  },
  // Ford Explorer Police Interceptor Utility: 5.05 x 2.0 x 1.78 m, 3.02 m wheelbase, 255/60R18 on black steel wheels
  nypd: {
    id: 'nypd', label: 'NYPD Cruiser', style: 'police',
    length: 5.05, width: 2.0, height: 1.78, wheelbase: 3.02, track: 1.68, wheelRadius: 0.375, tireWidth: 0.255, front: 2.45, rear: 2.6,
    colors: [[0xf4f4f2, 1]], livery: 'nypd', roof: 'lightbar',
    mass: 2200, enginePeak: 5200, topSpeed: 58, brakeForce: 3400, trafficWeight: 3, parkedWeight: 2, seatX: -0.42, seatY: 0.85, seatZ: 0.1,
  },
  van: {
    id: 'van', label: 'Delivery Van', style: 'van',
    length: 5.9, width: 2.05, height: 2.55, wheelbase: 3.6, track: 1.75, wheelRadius: 0.37, tireWidth: 0.235, front: 2.5, rear: 3.4,
    colors: [[0x4a3728, 1]], livery: 'van', roof: 'none',
    mass: 2800, enginePeak: 4600, topSpeed: 42, brakeForce: 3600, trafficWeight: 5, parkedWeight: 3, seatX: -0.5, seatY: 1.0, seatZ: -0.6,
  },
  // Isuzu NPR cab-over with a 16 ft (4.9 m) box: 7.0 x 2.3 x 3.4 m, 3.9 m wheelbase, front axle 1.05 m behind the bumper
  boxtruck: {
    id: 'boxtruck', label: 'Box Truck', style: 'cabover',
    length: 7.0, width: 2.3, height: 3.4, wheelbase: 3.9, track: 1.72, wheelRadius: 0.39, tireWidth: 0.215, front: 3.0, rear: 4.0, dualRear: true,
    colors: [[0xf2f2ee, 1]], livery: 'boxtruck', roof: 'none',
    mass: 5500, enginePeak: 6000, topSpeed: 36, brakeForce: 6000, trafficWeight: 4, parkedWeight: 2, seatX: -0.55, seatY: 1.15, seatZ: -1.65,
  },
  // New Flyer XD40: 12.2 x 2.6 x 3.3 m, 7.2 m wheelbase, 2.4 / 2.6 m overhangs, 305/70R22.5 (front single, rear dual)
  bus: {
    id: 'bus', label: 'MTA Bus', style: 'bus',
    length: 12.2, width: 2.6, height: 3.3, wheelbase: 7.2, track: 2.1, wheelRadius: 0.5, tireWidth: 0.3, front: 6.0, rear: 6.2, dualRear: true,
    colors: [[0xf4f6f8, 1]], livery: 'mta', roof: 'none',
    mass: 13000, enginePeak: 9000, topSpeed: 28, brakeForce: 9000, trafficWeight: 4, parkedWeight: 0, seatX: -0.65, seatY: 1.05, seatZ: -4.9,
  },
  garbage: {
    id: 'garbage', label: 'DSNY Truck', style: 'garbage',
    length: 8.6, width: 2.55, height: 3.6, wheelbase: 4.6, track: 2.0, wheelRadius: 0.5, tireWidth: 0.3, front: 2.8, rear: 5.8, dualRear: true,
    colors: [[0xf0f0ec, 1]], livery: 'dsny', roof: 'none',
    mass: 12000, enginePeak: 8000, topSpeed: 28, brakeForce: 8000, trafficWeight: 1, parkedWeight: 0.5, seatX: -0.6, seatY: 1.7, seatZ: -1.7,
  },
};

export const KIND_IDS = Object.keys(KINDS);

/** deterministic 0..1 from integer seeds */
export function hash01(a: number, b = 0, c = 0): number {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 100000) / 100000;
}

export function pickWeighted<T>(items: [T, number][], r: number): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let x = r * total;
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return items[items.length - 1][0];
}

export function pickColor(spec: VehicleSpec, r: number): number {
  return pickWeighted(spec.colors, r);
}

export function pickKind(weights: 'traffic' | 'parked', r: number): string {
  // 45 is the requested cab percentage, not 45 / the sum of all fleet weights.
  if (weights === 'traffic') {
    if (r < 0.45) return 'taxi';
    r = (r - 0.45) / 0.55;
  }
  let total = 0;
  for (const k of KIND_IDS) if (weights !== 'traffic' || k !== 'taxi') total += weights === 'traffic' ? KINDS[k].trafficWeight : KINDS[k].parkedWeight;
  let remaining = r * total;
  for (const k of KIND_IDS) {
    if (weights === 'traffic' && k === 'taxi') continue;
    remaining -= weights === 'traffic' ? KINDS[k].trafficWeight : KINDS[k].parkedWeight;
    if (remaining <= 0) return k;
  }
  return KIND_IDS[KIND_IDS.length - 1];
}
