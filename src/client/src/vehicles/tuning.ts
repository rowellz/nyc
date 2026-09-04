/**
 * Driving feel per kind. Dimensions and mass live in kinds.ts; this is the physics-side tuning only.
 * Targets (GTA V as the reference): sedan 0-60 mph in ~8 s with a ~120 mph top end, taxi close behind,
 * SUV/NYPD heavier, van/box truck/bus/garbage slow and softly sprung.
 */
export interface DriveTuning {
  /** peak longitudinal acceleration at low speed, m/s^2 (drag and rolling resistance come off this) */
  accel: number;
  /** speed where the engine curve runs out, m/s */
  top: number;
  /** service-brake deceleration, m/s^2 */
  brake: number;
  /** friction-circle cap per wheel (Rapier frictionSlip); with load transfer ~1.3 g of usable lateral grip at 1.6 */
  grip: number;
  /** share of drive on the rear axle, 0..1 (rear-heavy drive loosens the rear under power in a corner) */
  rearBias: number;
  /** suspension spring rate per unit mass per wheel (Bullet/Rapier convention); lower = softer, more roll */
  stiffness: number;
  /** steering lock at rest, rad */
  lock: number;
  /** gears for the rpm/gear display and the shift torque cut */
  gears: number;
}

const SEDAN: DriveTuning = { accel: 4.1, top: 54, brake: 9.5, grip: 1.6, rearBias: 0.65, stiffness: 30, lock: 0.62, gears: 6 };

export const TUNING: Record<string, DriveTuning> = {
  sedan: SEDAN,
  taxi: { accel: 3.8, top: 52, brake: 9.0, grip: 1.5, rearBias: 0.35, stiffness: 28, lock: 0.62, gears: 6 },
  borotaxi: { accel: 3.8, top: 52, brake: 9.0, grip: 1.5, rearBias: 0.35, stiffness: 28, lock: 0.62, gears: 6 },
  suv: { accel: 3.3, top: 50, brake: 8.5, grip: 1.45, rearBias: 0.5, stiffness: 26, lock: 0.6, gears: 6 },
  blacksuv: { accel: 3.5, top: 52, brake: 8.5, grip: 1.45, rearBias: 0.5, stiffness: 26, lock: 0.58, gears: 6 },
  nypd: { accel: 4.7, top: 60, brake: 10, grip: 1.7, rearBias: 0.6, stiffness: 32, lock: 0.62, gears: 6 },
  van: { accel: 2.4, top: 42, brake: 7.5, grip: 1.3, rearBias: 0.9, stiffness: 24, lock: 0.58, gears: 5 },
  boxtruck: { accel: 1.7, top: 36, brake: 6.5, grip: 1.2, rearBias: 1, stiffness: 22, lock: 0.55, gears: 6 },
  bus: { accel: 1.2, top: 28, brake: 6, grip: 1.15, rearBias: 1, stiffness: 20, lock: 0.5, gears: 4 },
  garbage: { accel: 1.3, top: 28, brake: 6, grip: 1.15, rearBias: 1, stiffness: 20, lock: 0.5, gears: 5 },
};

export function tuningFor(kind: string): DriveTuning {
  return TUNING[kind] ?? SEDAN;
}

/** Engine acceleration available at forward speed v (m/s): a torque curve that fades out just past `top`. */
export function engineAccel(t: DriveTuning, v: number, reverse: boolean): number {
  const top = reverse ? 12 : t.top;
  return t.accel * (reverse ? 0.6 : 1) * Math.max(0, 1 - (Math.abs(v) / (top * 1.08)) ** 2);
}

/** Speed-sensitive steering lock (rad): full lock when parking, a few degrees at highway speed. */
export function steeringLock(t: DriveTuning, speed: number): number {
  return t.lock / (1 + Math.pow(Math.max(0, speed) / 10, 1.2));
}
