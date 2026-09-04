/** Six unshadowed low beams: real road/body illumination, no per-car shadow maps. */
import * as THREE from 'three';
import { isIOS } from '@/core/quality';
import type { GameContext } from '@/core/context';
import type { WeatherState } from '@shared/protocol';
import { KINDS } from './kinds';
import { distance2, ground, type Car } from './model';

export const HEADLIGHT_CAP = 6;
const RANGE = 34;
/** Candela. Street lamps are 140 cd from 9.1 m (props/lights.ts INTENSITY), so 350 cd at a 1.1 m mount
 * grazing the road put less light down than a cobra head and left no pool at all. 560 lands the hot spot
 * a little above a lamp pool; higher blows out crosswalk paint and near bodywork under AgX. */
const BEAM_CD = 560;
/** Half-angle: a lane-wide flat pool ~10 m ahead, not a torch spot under the bumper. */
const BEAM_HALF_ANGLE = 19;
/** Metres ahead of the bumper the hot spot lands; also what the beam lights on the car in front. */
const BEAM_THROW = 9.5;

/** Use the same daylight/weather gate for the lenses and their road illumination. */
export function headlightPower(night: number, condition: WeatherState['condition'] = 'clear', daylight = 1 - night): number {
  return daylight < 0.35 || condition === 'rain' || condition === 'heavy_rain' || condition === 'thunder' || condition === 'fog' ? 1 : 0;
}

export class Headlights {
  readonly lights: THREE.SpotLight[] = [];
  private candidates: { car: Car; distance: number; power: number }[] = [];
  private night = 0;

  constructor(private ctx: GameContext) {
    for (let i = 0; i < (isIOS() ? 0 : HEADLIGHT_CAP); i++) {
      // Candela (inverse-square falloff), not emissive/legacy intensity units.
      // SpotLight.angle is the half-angle: BEAM_HALF_ANGLE 19 is a 38-degree beam.
      const light = new THREE.SpotLight(0xfff4df, 0, RANGE, THREE.MathUtils.degToRad(BEAM_HALF_ANGLE), 0.45, 2);
      light.name = `veh-headlight-${i}`;
      light.castShadow = false;
      ctx.scene.add(light, light.target);
      this.lights.push(light);
    }
  }

  begin(night: number, condition: WeatherState['condition'] = 'clear', daylight = 1 - night): void {
    this.night = headlightPower(night, condition, daylight);
    this.candidates.length = 0;
  }

  /** Active local/remote/traffic cars only; stopped traffic keeps its beams on. */
  add(car: Car, power: number): void {
    if (!this.lights.length || this.night === 0 || power <= 0) return;
    const distance = distance2(car, this.ctx.camera.position);
    if (distance > 80 ** 2) return;
    const list = this.candidates;
    if (list.length === HEADLIGHT_CAP && distance >= list[list.length - 1].distance) return;
    list.push({ car, distance, power });
    list.sort((a, b) => a.distance - b.distance);
    if (list.length > HEADLIGHT_CAP) list.pop();
  }

  /** Runs in preRender even in screenshot mode, and also clears vacated pool slots. */
  end(): void {
    this.lights.forEach((light, i) => {
      const candidate = this.candidates[i];
      light.intensity = 0;
      delete light.userData.vehicleKey;
      if (!candidate) return;
      const { car, power } = candidate;
      const spec = KINDS[car.kind];
      const x = car.x - Math.sin(car.yaw) * (spec.front + BEAM_THROW);
      const z = car.z - Math.cos(car.yaw) * (spec.front + BEAM_THROW);
      const roadY = ground(this.ctx, x, z);
      // Do not aim down to another deck or illuminate the road from an airborne car.
      if (Math.abs(roadY - car.y) > 2) return;
      light.position.set(0, Math.min(1.1, spec.height * 0.48), -spec.front - 0.06).applyMatrix4(car.matrix);
      light.target.position.set(x, roadY + 0.02, z);
      light.intensity = BEAM_CD * this.night * Math.min(1, power);
      light.userData.vehicleKey = car.key;
    });
  }

  dispose(): void {
    for (const light of this.lights) { this.ctx.scene.remove(light, light.target); light.dispose(); }
    this.candidates.length = 0;
  }
}
