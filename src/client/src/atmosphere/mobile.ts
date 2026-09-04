/** iOS emergency atmosphere: direct tone-mapped rendering, no render targets. */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import type { AtmosphereModule } from './index';
export function createAtmosphere(ctx: GameContext): AtmosphereModule {
  const sun = new THREE.DirectionalLight(0xffeddb, 2);
  const fill = new THREE.HemisphereLight(0xaacbff, 0x5d5145, 2);
  sun.position.set(100, 200, 80);
  sun.castShadow = false;
  ctx.scene.add(sun, fill);
  ctx.renderer.shadowMap.enabled = false;
  ctx.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  ctx.renderer.toneMappingExposure = 1;
  ctx.composer = null;
  const sky = new THREE.Color(0x8097b0), night = new THREE.Color(0x101827);
  const fogColor = sky.clone();
  ctx.scene.background = fogColor;
  ctx.scene.fog = new THREE.Fog(fogColor, 180, 700);
  const uniforms = {
    uSSRMaxRoughness: { value: 0 }, uSSRIntensity: { value: 0 }, uWetness: { value: 0 }, uRain: { value: 0 },
    uSunDir: { value: sun.position.clone().normalize() }, uSunColor: { value: sun.color },
    uSkyColor: { value: sky }, uHorizonColor: { value: fogColor }, uFogColor: { value: fogColor },
    uFogDensity: { value: 0.002 }, uNight: { value: 0 }, uTime: { value: 0 },
  };
  return { name: 'atmosphere', sun, uniforms, envMap: null,
    setupMaterial() {}, async prepareObjects() {},
    render() { ctx.renderer.render(ctx.scene, ctx.camera); },
    update(_dt, t) {
      const day = ctx.time.daylight;
      uniforms.uTime.value = t; uniforms.uNight.value = 1 - day;
      uniforms.uWetness.value = ctx.state.weather.wetness || 0;
      sun.intensity = 0.15 + 2 * day; fill.intensity = 0.6 + 1.4 * day;
      fogColor.copy(night).lerp(sky, day);
      (ctx.scene.fog as THREE.Fog).color.copy(fogColor);
    },
    dispose() { ctx.scene.remove(sun, fill); sun.dispose(); fill.dispose(); },
  };
}
