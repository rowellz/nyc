/**
 * Atmosphere module: physically based sky + sun/moon lighting with cascaded shadows, environment map,
 * aerial perspective, weather (rain/snow/fog/lightning), and the post-processing stack.
 * Owns renderer.toneMapping/exposure and scene.environment. See docs/MODULE_APIS.md (AtmosphereModule).
 */
import * as THREE from 'three';
import type { GameContext, GameModule } from '@/core/context';
import type { WeatherState } from '@shared/protocol';
import { SUN_IRRADIANCE, skyRadiance, smoothstep, sunTransmittance, warmLowSun } from './scattering';
import { SkySystem } from './sky';
import { Lighting } from './lighting';
import { AerialPerspectiveEffect } from './fog';
import { PostStack } from './post';
import { isIOS } from '@/core/quality';
import { isNameFormUp } from '@/core/crashGuard';
import { AtmosphereInit, compileObjects, compileSample } from './init';
import type { BuildSteps } from '@/buildings/loading';
import { Precipitation } from './weather';

export interface AtmosphereModule extends GameModule {
  /** Register lit materials after their shader hook, before first render (tiles and non-tiles). Binds live PMREM for Standard/Physical; preserves custom envMaps. */
  setupMaterial(m: THREE.Material): void;
  /** Prepare owned geometry before it enters the render loop. */
  prepareObjects(root: THREE.Object3D): Promise<void>;
  /** shared uniforms other materials may reference by object identity (do not replace the objects) */
  uniforms: {
    /** SSR reads existing material roughnessFactor; below this cutoff is reflective (high/ultra only). */
    uSSRMaxRoughness: { value: number };
    /** Fresnel-weighted local reflection intensity; zero disables all SSR work. */
    uSSRIntensity: { value: number };
    uWetness: { value: number };
    uRain: { value: number };
    uSunDir: { value: THREE.Vector3 };
    uSunColor: { value: THREE.Color };
    uSkyColor: { value: THREE.Color };
    uHorizonColor: { value: THREE.Color };
    uFogColor: { value: THREE.Color };
    uFogDensity: { value: number };
    uNight: { value: number };
    uTime: { value: number };
  };
  /** current environment map (PMREM) for reflections */
  envMap: THREE.Texture | null;
  /** renders the frame through the post stack. Core calls this instead of renderer.render when present */
  render(): void;
  /** the sun DirectionalLight (for anyone needing shadow camera info) */
  sun: THREE.DirectionalLight;
}

interface WxParams {
  haze: number;
  visibility: number;
  fogSigma: number;
  fogH: number;
  sunScatter: number;
  tintMix: number;
  mieG: number;
  cloudHeight: number;
}

const WX: Record<WeatherState['condition'], WxParams> = {
  // visibility: Koschmieder range. METAR "10 SM" is a floor, real clear-air visibility over the Hudson is 30-50 km;
  // 12-16 km washed 2.5 km-distant towers with 50% haze.
  clear: { haze: 1.0, visibility: 38000, fogSigma: 0, fogH: 90, sunScatter: 0.12, tintMix: 0.0, mieG: 0.76, cloudHeight: 1900 },
  partly_cloudy: { haze: 1.4, visibility: 26000, fogSigma: 0, fogH: 90, sunScatter: 0.14, tintMix: 0.05, mieG: 0.76, cloudHeight: 1500 },
  cloudy: { haze: 2.2, visibility: 18000, fogSigma: 0, fogH: 90, sunScatter: 0.15, tintMix: 0.2, mieG: 0.78, cloudHeight: 1000 },
  fog: { haze: 5.0, visibility: 4000, fogSigma: 3.912 / 300, fogH: 90, sunScatter: 0.28, tintMix: 0.85, mieG: 0.8, cloudHeight: 500 },
  rain: { haze: 5.0, visibility: 3000, fogSigma: 0, fogH: 90, sunScatter: 0.3, tintMix: 0.35, mieG: 0.78, cloudHeight: 800 },
  heavy_rain: { haze: 7.0, visibility: 1500, fogSigma: 3.912 / 8000, fogH: 120, sunScatter: 0.3, tintMix: 0.45, mieG: 0.78, cloudHeight: 600 },
  snow: { haze: 4.0, visibility: 2000, fogSigma: 3.912 / 6000, fogH: 120, sunScatter: 0.25, tintMix: 0.5, mieG: 0.78, cloudHeight: 700 },
  thunder: { haze: 5.0, visibility: 2500, fogSigma: 0, fogH: 90, sunScatter: 0.3, tintMix: 0.4, mieG: 0.78, cloudHeight: 700 },
};

const DEG = Math.PI / 180;
const SOLAR_COLOR = new THREE.Color(SUN_IRRADIANCE.x / 4, SUN_IRRADIANCE.y / 4, SUN_IRRADIANCE.z / 4);
// modern NYC skyglow is warm grey (LED + sodium mix), not sodium orange
const POLLUTION_COLOR = new THREE.Color(1.0, 0.74, 0.54);

function halfToFloat(h: number): number {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

function moonPhaseNow(): { phase: number; illum: number } {
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const synodic = 29.530588853;
  const age = ((((Date.now() - ref) / 86400000) % synodic) + synodic) % synodic;
  const f = age / synodic; // 0 new, 0.5 full
  const phase = Math.PI - f * Math.PI * 2; // 0 = full, +-pi = new
  const illum = (1 - Math.cos(f * Math.PI * 2)) / 2;
  return { phase, illum };
}

export async function createAtmosphere(ctx: GameContext): Promise<AtmosphereModule> {
  const { renderer, scene, camera } = ctx;
  const q = ctx.quality;
  const startup = new AtmosphereInit(ctx);
  // Later factories add lights. Compile owned world variants only once those
  // lights exist, then allow the first composer draw; the loop can still stream.
  const firstWorldJob = startup.job('atmosphere final-light shaders');
  let firstWorldStarted = false, firstWorldReady = false;
  const pendingWorld: THREE.Mesh[] = [];
  const warmHidden = new Map<THREE.Object3D, boolean>();
  function hideForWarmup(root: THREE.Object3D): void {
    if (!warmHidden.has(root)) warmHidden.set(root, root.visible);
    root.visible = false;
  }

  // renderer/scene ownership (core leaves these to us)
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  scene.background = null;
  scene.fog = null;
  renderer.setClearColor(0x000000, 1);

  const uniforms: AtmosphereModule['uniforms'] = {
    uSSRMaxRoughness: { value: 0.55 },
    uSSRIntensity: { value: 1 },
    uWetness: { value: 0 },
    uRain: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSkyColor: { value: new THREE.Color(0.2, 0.4, 0.8) },
    uHorizonColor: { value: new THREE.Color(0.6, 0.7, 0.85) },
    uFogColor: { value: new THREE.Color(0.6, 0.7, 0.85) },
    uFogDensity: { value: 3e-4 },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };

  const sky = new SkySystem(renderer, scene);
  const lighting = new Lighting(ctx);
  const fog = new AerialPerspectiveEffect(camera, sky.lut.texture);
  const post = new PostStack(ctx, fog);
  if (post.ssr) {
    uniforms.uSSRMaxRoughness = post.ssr.uniforms.uSSRMaxRoughness;
    uniforms.uSSRIntensity = post.ssr.uniforms.uSSRIntensity;
  }
  const dropCount = q.level === 'ultra' ? 7000 : q.level === 'high' ? 5000 : q.level === 'medium' ? 2500 : 1200;
  const precip = new Precipitation(ctx, dropCount, (q.level === 'low' || q.level === 'mobile') ? 120 : 260);

  // ---- weather smoothing ----
  const cur: WxParams & { cloud: number; precip: number; wet: number; wind: THREE.Vector3; snow: number } = {
    ...WX.clear,
    cloud: 0.15,
    precip: 0,
    wet: 0,
    wind: new THREE.Vector3(),
    snow: 0,
  };
  let firstFrame = true;
  let envDirty = true;
  let lastEnvFrame = -1000;
  let lastEnvTime = -1000;
  const lastEnvSun = new THREE.Vector3(0, 0, 0);
  let lastEnvCloud = -1;
  let frame = 0;
  const patchAt = new Set<number>();
  let exposure = 1;
  // Adapted log2 average luminance read back from the GPU (async, no stall), so the night fill can be set in
  // post-exposure terms: a sign-lit square exposes at the night floor, a side street at the ceiling (2x apart).
  let adaptedAvg = NaN;
  let readbackPending = false;
  const readbackBuf = new Uint16Array(4);
  let exposureNow = 1;
  const windPhase1 = new THREE.Vector2();
  const windPhase2 = new THREE.Vector2();

  // lightning
  let nextFlash = 0;
  let flash = 0;
  const pulses: { t: number; i: number }[] = [];

  const moon = moonPhaseNow();

  // scratch
  const sunT = new THREE.Color();
  const sunTCloud = new THREE.Color();
  const moonT = new THREE.Color();
  const sunLightColor = new THREE.Color();
  const sunRadiance = new THREE.Color();
  const sunColorCloud = new THREE.Color();
  const sunGround = new THREE.Color();
  const moonRadiance = new THREE.Color();
  const moonLight = new THREE.Color();
  const pollution = new THREE.Color();
  const fogTint = new THREE.Color();
  const lightColor = new THREE.Color();
  const tmpDir = new THREE.Vector3();
  const tmpCol = new THREE.Color();
  const rainColor = new THREE.Color();
  const windVec = new THREE.Vector3();
  const skyParams = {
    sunDir: new THREE.Vector3(),
    moonDir: new THREE.Vector3(),
    haze: 1,
    mieG: 0.76,
    camAlt: 2,
    camX: 0,
    camZ: 0,
    sunRadiance,
    sunColorCloud,
    sunGround,
    moonRadiance,
    moonLight,
    moonPhase: moon.phase,
    pollution,
    night: 0,
    cloudCover: 0.15,
    cloudHeight: 1500,
    wind1: windPhase1,
    wind2: windPhase2,
    starRot: 0,
    starVis: 0,
    flash: 0,
    hazeMix: 0,
    fogTint,
    sunAureole: 1,
    time: 0,
  };

  function targetFor(w: WeatherState): WxParams & { cloud: number; precip: number; wet: number; snow: number } {
    const base = WX[w.condition] ?? WX.clear;
    const t = { ...base, cloud: w.cloudCover, precip: w.precip, wet: w.wetness, snow: w.condition === 'snow' ? 1 : 0 };
    // humid summer haze
    if ((w.condition === 'clear' || w.condition === 'partly_cloudy') && w.temperatureC >= 25) {
      t.haze *= 2.2;
      t.visibility *= 0.6;
      t.mieG = 0.8;
    }
    if (w.condition === 'clear' && w.temperatureC <= 8) {
      t.haze *= 0.7;
      t.visibility *= 1.6;
    }
    return t;
  }

  function smoothWeather(dt: number): void {
    const w = ctx.state.weather;
    const tg = targetFor(w);
    const snap = firstFrame || ctx.state.screenshotMode;
    const k = snap ? 1 : 1 - Math.exp(-dt / 6);
    const lerp = (a: number, b: number) => a + (b - a) * k;
    cur.haze = lerp(cur.haze, tg.haze);
    cur.visibility = lerp(cur.visibility, tg.visibility);
    cur.fogSigma = lerp(cur.fogSigma, tg.fogSigma);
    cur.fogH = lerp(cur.fogH, tg.fogH);
    cur.sunScatter = lerp(cur.sunScatter, tg.sunScatter);
    cur.tintMix = lerp(cur.tintMix, tg.tintMix);
    cur.mieG = lerp(cur.mieG, tg.mieG);
    cur.cloudHeight = lerp(cur.cloudHeight, tg.cloudHeight);
    cur.cloud = lerp(cur.cloud, tg.cloud);
    cur.precip = lerp(cur.precip, tg.precip);
    cur.wet = lerp(cur.wet, tg.wet);
    cur.snow = snap ? tg.snow : lerp(cur.snow, tg.snow);
    windVec.set(Math.sin(w.windDir) * w.wind, 0, -Math.cos(w.windDir) * w.wind);
    cur.wind.lerp(windVec, snap ? 1 : k);
  }

  function updateLightning(dt: number, t: number): void {
    const thunder = ctx.state.weather.condition === 'thunder';
    if (thunder) {
      if (nextFlash === 0) nextFlash = t + 2 + Math.random() * 6;
      if (t >= nextFlash) {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) pulses.push({ t: t + i * (0.06 + Math.random() * 0.12), i: 0.5 + Math.random() * 0.8 });
        nextFlash = t + 4 + Math.random() * 12;
      }
    } else {
      nextFlash = 0;
    }
    let f = 0;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      const age = t - p.t;
      if (age > 1) {
        pulses.splice(i, 1);
        continue;
      }
      if (age >= 0) f += p.i * Math.exp(-age / 0.09);
    }
    flash = Math.min(1.5, f);
    void dt;
  }

  const module: AtmosphereModule = {
    name: 'atmosphere',
    uniforms,
    envMap: null,
    sun: lighting.sun,
    setupMaterial(m) {
      lighting.setupMaterial(m);
    },
    async prepareObjects(root) {
      if (!firstWorldReady) {
        if ((root as THREE.Group).isGroup) hideForWarmup(root);
        root.traverse(object => {
          if ((object as THREE.Mesh).isMesh) pendingWorld.push(compileSample(object as THREE.Mesh));
        });
        return; // The already-counted firstWorldJob owns these pending samples.
      }
      await startup.run('atmosphere material shaders', (function* (): BuildSteps {
        yield* compileObjects(renderer, root, camera, scene, post.composer.inputBuffer, startup.shadowMaterials);
        if (post.ssr) yield* post.ssr.warmupObjects(renderer, root);
      })());
    },
    update(dt, t) {
      frame++;
      uniforms.uTime.value = t;
      smoothWeather(dt);
      updateLightning(dt, t);

      const time = ctx.time;
      const sunDir = time.sunDir;
      const sunEl = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1));
      const elDeg = sunEl / DEG;
      const moonDir = time.moonDir;
      const moonEl = Math.asin(THREE.MathUtils.clamp(moonDir.y, -1, 1));

      // ---- sun / moon through the atmosphere ----
      sunTransmittance(sunEl, cur.haze, sunT, 30);
      sunTransmittance(sunEl + 1.4 * DEG, cur.haze, sunTCloud, cur.cloudHeight);
      sunTransmittance(moonEl, cur.haze, moonT, 30);
      const overcast = smoothstep(0.35, 1.0, cur.cloud);
      const directFactor = 1 - 0.94 * overcast;
      sunLightColor.copy(SOLAR_COLOR).multiply(sunT);
      warmLowSun(sunLightColor, elDeg);
      const sunIntensity = 4.0 * directFactor * smoothstep(-0.27, 0.27, elDeg);
      const sunLum = sunT.r * 0.2126 + sunT.g * 0.7152 + sunT.b * 0.0722;
      const night = 1 - smoothstep(-6, 1.5, elDeg);
      uniforms.uNight.value = night;

      // Moonlight is a separate, unshadowed fill; the sun must go out at night.
      const moonIll = moon.illum;
      const moonIntensity = 0.06 * moonIll * (1 - 0.9 * overcast) * Math.max(0, moonT.g);
      moonLight.setRGB(0.62, 0.72, 1.0).multiply(moonT).multiplyScalar(1.0);
      const useMoon = sunIntensity * sunLum < moonIntensity && moonDir.y > 0.02;
      lightColor.copy(useMoon ? moonLight : sunLightColor);
      lighting.setLight(sunDir, sunLightColor, sunIntensity);
      lighting.setShadows(sunIntensity * sunLum > 0.001 && sunDir.y > 0);
      lighting.setMoon(moonDir, moonLight, useMoon ? moonIntensity : 0);
      if (flash > 0.01) {
        // lightning: brief bluish key light from above
        tmpCol.setRGB(0.8, 0.86, 1.0);
        for (const l of lighting.csm.lights) {
          l.color.lerp(tmpCol, Math.min(1, flash));
          l.intensity += 3.0 * flash;
        }
      }
      uniforms.uSunDir.value.copy(useMoon ? moonDir : sunDir);
      uniforms.uSunColor.value.copy(lightColor).multiplyScalar(useMoon ? moonIntensity : sunIntensity);
      sunGround.copy(sunLightColor).multiplyScalar(sunIntensity);
      const glowNight = 1 - smoothstep(-9, -2, elDeg);
      // full night for the fill and the haze halo: blue hour still has a bright sky and its own exposure lift
      const deepNight = 1 - smoothstep(-11, -4, elDeg);
      // high sun (>~12 deg): ambient is cut so the sun:shade ratio reads sunny; golden and blue hour untouched
      const dayHigh = smoothstep(12, 28, elDeg) * (1 - overcast);

      // ---- sky parameters ----
      const p = skyParams;
      p.sunDir.copy(sunDir);
      p.moonDir.copy(moonDir);
      p.haze = cur.haze;
      p.mieG = cur.mieG;
      p.camAlt = camera.position.y;
      p.camX = camera.position.x;
      p.camZ = camera.position.z;
      sunRadiance.copy(SOLAR_COLOR).multiply(sunT).multiplyScalar(60);
      sunColorCloud.copy(SOLAR_COLOR).multiply(sunTCloud).multiplyScalar(4.0);
      const daylight = smoothstep(-4, 6, elDeg);
      moonRadiance.setRGB(1.0, 0.97, 0.9).multiply(moonT).multiplyScalar(THREE.MathUtils.lerp(1.4, 0.5, daylight));
      // Skyglow follows the twilight out (-2..-9 deg), later than `night`: at -3.5 deg the sky is still deep blue,
      // and a warm-grey horizon glow on top of it would read as murk. `night` itself is shared; leave it.
      pollution.copy(POLLUTION_COLOR).multiplyScalar(0.05 * glowNight);
      p.night = night;
      p.cloudCover = cur.cloud;
      p.cloudHeight = cur.cloudHeight;
      // clouds drift with the wind (accelerated so it reads)
      windPhase1.x += (cur.wind.x / 9000) * dt * 4;
      windPhase1.y += (cur.wind.z / 9000) * dt * 4;
      windPhase2.x += (cur.wind.x / 9000) * dt * 7 + dt * 0.0004;
      windPhase2.y += (cur.wind.z / 9000) * dt * 7;
      p.starRot = time.dayFraction * Math.PI * 2;
      p.starVis = smoothstep(-4, -14, elDeg);
      p.flash = flash;
      p.hazeMix = cur.tintMix * 0.9;
      p.sunAureole = 0.6 + 0.4 * Math.min(1, cur.haze / 3);
      p.time = t;

      // ---- CPU sky colours for other modules (zenith, horizon, fog) ----
      if (frame % 8 === 1 || firstFrame) {
        tmpDir.set(0, 1, 0);
        skyRadiance(tmpDir, sunDir, cur.haze, cur.mieG, uniforms.uSkyColor.value);
        tmpDir.set(-sunDir.x, 0.03, -sunDir.z).normalize();
        if (tmpDir.lengthSq() < 0.5) tmpDir.set(1, 0.03, 0).normalize();
        skyRadiance(tmpDir, sunDir, cur.haze, cur.mieG, uniforms.uHorizonColor.value);
        // Under a deck the fill is the deck's grey (ART 0.62/0.64/0.66), not the blue zenith behind it.
        for (const c of [uniforms.uSkyColor.value, uniforms.uHorizonColor.value]) {
          const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
          c.lerp(tmpCol.setRGB(0.968 * l, 0.999 * l, 1.03 * l), overcast * 0.85);
        }
        const h = uniforms.uHorizonColor.value;
        const lum = h.r * 0.2126 + h.g * 0.7152 + h.b * 0.0722;
        // Full-path horizon radiance is reddened at low sun even looking away
        // from it. Local aerial perspective is lit by the blue sky hemisphere;
        // reserve the warm, directional component for forward scattering.
        const skyC = uniforms.uSkyColor.value;
        const skyLum = skyC.r * 0.2126 + skyC.g * 0.7152 + skyC.b * 0.0722;
        tmpCol.copy(skyC).multiplyScalar(lum / Math.max(skyLum, 1e-5));
        fogTint.setRGB(lum, lum, lum).lerp(tmpCol, 0.4);
        uniforms.uFogColor.value.copy(fogTint);
        // Night in-scatter is the skyglow band itself (sky.ts: ~1.5x uPollution at 15 deg): the far end of an
        // avenue softens into the same dull orange-grey the sky above it has. The old 1+2*cloud put the fog above
        // the sky under rain and washed every facade past 100 m into murk.
        uniforms.uFogColor.value.r += pollution.r * (1.5 + 0.8 * cur.cloud);
        uniforms.uFogColor.value.g += pollution.g * (1.5 + 0.8 * cur.cloud);
        uniforms.uFogColor.value.b += pollution.b * (1.5 + 0.8 * cur.cloud);
        fogTint.copy(uniforms.uFogColor.value);
      }
      // City air at night is hazier than the daytime Koschmieder range (and lit from within): visibility x0.6.
      const hazeDensity = 3.912 / Math.max(300, cur.visibility * (1 - 0.4 * glowNight));
      uniforms.uFogDensity.value = hazeDensity + cur.fogSigma;
      sky.setParams(p);

      // ---- fog effect uniforms ----
      (fog.u('uSunDir').value as THREE.Vector3).copy(useMoon ? moonDir : sunDir);
      const fc = fog.u('uSunColor').value as THREE.Vector3;
      fc.set(uniforms.uSunColor.value.r, uniforms.uSunColor.value.g, uniforms.uSunColor.value.b);
      (fog.u('uPollution').value as THREE.Vector3).set(pollution.r, pollution.g, pollution.b);
      const fogColor = uniforms.uFogColor.value;
      (fog.u('uFogColor').value as THREE.Vector3).set(fogColor.r, fogColor.g, fogColor.b);
      fog.u('uHazeDensity').value = hazeDensity;
      fog.u('uHazeH').value = 1400;
      fog.u('uFogDensity').value = cur.fogSigma;
      fog.u('uFogH').value = cur.fogH;
      fog.u('uSunScatter').value = cur.sunScatter * (useMoon ? 0.3 : 1);
      fog.u('uMieG').value = 0.72;
      fog.u('uCloudCover').value = cur.cloud;
      (fog.u('uFogTint').value as THREE.Vector3).set(fogTint.r, fogTint.g, fogTint.b);
      fog.u('uFogTintMix').value = cur.tintMix;
      fog.u('uFlash').value = flash;

      // ---- hemisphere fill: the env map carries the sky; this adds a little blue top-up and the warm bounce
      // off sunlit facades, which scales with how much of the city floor the sun actually reaches ----
      const skyC = uniforms.uSkyColor.value;
      // Cut the sky chroma under a high sun (the env map is cut the same way): 3 pm shade is neutral-cool,
      // not cyan; below ~10 deg the cut is off and golden-hour shade keeps the sky's blue.
      const dayFill = smoothstep(8.6, 30, elDeg);
      const skyCLum = skyC.r * 0.2126 + skyC.g * 0.7152 + skyC.b * 0.0722;
      lighting.hemi.color.copy(skyC).lerp(tmpCol.setRGB(skyCLum, skyCLum, skyCLum), 0.65 * dayFill).multiplyScalar(0.55);
      lighting.hemi.color.r += pollution.r * 1.6;
      lighting.hemi.color.g += pollution.g * 1.6;
      lighting.hemi.color.b += pollution.b * 1.6;
      const bounce = (0.06 + 0.14 * smoothstep(8, 50, elDeg)) * (1 - 0.6 * overcast);
      lighting.hemi.groundColor.copy(lightColor).multiplyScalar(bounce * (useMoon ? moonIntensity : sunIntensity)).add(tmpCol.copy(skyC).multiplyScalar(0.15));
      // Night fill, in post-exposure terms (divided by the adapted exposure): skyglow from above (warm grey) and
      // lamp/sign-lit pavement bounce from below, so a person in the shade lands ~0.02-0.03 after exposure
      // (a dark, readable figure) instead of black, whether the square exposes at the floor or a side street
      // at the ceiling. The PMREM carries the directional part; this is the floor under it.
      const fillK = deepNight * (1 - 0.35 * overcast) / (0.45 * exposureNow);
      lighting.hemi.color.r += 0.24 * 1.0 * fillK;
      lighting.hemi.color.g += 0.24 * 0.84 * fillK;
      lighting.hemi.color.b += 0.24 * 0.72 * fillK;
      lighting.hemi.groundColor.r += 0.10 * 1.0 * fillK;
      lighting.hemi.groundColor.g += 0.10 * 0.86 * fillK;
      lighting.hemi.groundColor.b += 0.10 * 0.68 * fillK;
      lighting.hemi.intensity = 0.45 * (1 - 0.3 * dayHigh);
      scene.environmentIntensity = 1.0 - 0.3 * dayHigh;

      // ---- exposure: camera-like. Key over the scene log-average, clamped; night keys ~1.3 stops lower so it
      // stays night, with headroom for signage. Instant in screenshots / first seconds, ~1 s in play. ----
      const dayl = smoothstep(-4, 8, elDeg);
      // Blue hour (-2..-9 deg) is exposed like a photograph, not like night: the key and ceiling lift so the
      // twilight sky holds deep blue against the first lights; both fall back to the night values by -9 deg.
      const dusk = smoothstep(-9, -4, elDeg) * (1 - smoothstep(-2, 3, elDeg));
      const key = THREE.MathUtils.lerp(0.05, 0.14, dayl) + 0.03 * dusk;
      // Night floor 0.6: a sign-lit square may go darker than a side street (Times Square wants ~0.3).
      const eMin = THREE.MathUtils.lerp(0.6, 0.55, dayl);
      const eMax = THREE.MathUtils.lerp(1.25, 2.4, dayl) + 1.2 * dusk;
      const contrast = THREE.MathUtils.lerp(1.06, 1.12, dayl);
      const instant = firstFrame || frame < 90 || ctx.state.screenshotMode;
      post.setExposure(key, eMin, eMax, contrast, instant ? 0 : 1.2);
      // the multiplier the GPU is applying (last readback; 1 until the first one lands)
      exposureNow = Number.isFinite(adaptedAvg) ? THREE.MathUtils.clamp(key / Math.max(adaptedAvg, 1e-4), eMin, eMax) : 1;
      // wet air glows around emissives: wider, stronger bloom in rain/fog at night
      post.setNight(night, Math.min(1, cur.precip + cur.tintMix * 0.6), deepNight);
      // AgX flattens chroma; a high sun wants the extra 10 % back, night keeps its restraint
      post.grade.setSaturation(1.06 + 0.10 * dayHigh);
      exposure = key;
      renderer.toneMappingExposure = 1;

      // ---- weather -> shared uniforms + particles ----
      uniforms.uWetness.value = cur.wet;
      const raining = cur.snow < 0.5 ? cur.precip : 0;
      uniforms.uRain.value = raining;
      // Streak tint only (unit luminance): sky-grey by day, warm by night. The streak brightness is the frame's
      // adapted luminance (previous frame), so rain is lit by whatever lights the frame: signs in Times Square,
      // a lone lamp on a side street, the overcast sky by day. Exposure-invariant by construction.
      rainColor.setRGB(0.86, 0.91, 1.0).lerp(tmpCol.setRGB(1.0, 0.86, 0.72), night);
      precip.update(dt, t, cur.precip, cur.snow >= 0.5 ? 1 : 0, cur.wind, rainColor, cur.wet, post.autoExposure.texture);

      // ---- env map refresh policy ----
      const sunMoved = lastEnvSun.dot(sunDir) < Math.cos(0.5 * DEG);
      const cloudMoved = Math.abs(lastEnvCloud - cur.cloud) > 0.04;
      if (sunMoved || cloudMoved || t - lastEnvTime > 4) envDirty = true;

      // ---- material patch sweeps (other modules build geometry a few frames after tileLoaded) ----
      if (patchAt.has(frame) || frame % 90 === 0 || frame === 2) {
        patchAt.delete(frame);
        lighting.patchAll();
      }
      firstFrame = false;
    },
    preRender() {
      camera.updateMatrixWorld();
      sky.placeAt(camera.position);
      lighting.update();
    },
    render() {
      const dt = 1 / 60;
      renderFrame(dt);
    },
    dispose() {
      startup.dispose();
      pendingWorld.length = 0;
      offTile();
      offWeather();
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
      ctx.composer = null;
      scene.environment = null;
      precip.dispose();
      post.dispose();
      lighting.dispose();
      sky.dispose(scene);
      delete (window as any).__atmo;
    },
  };

  function renderFrame(dt: number): void {
    if (!firstWorldReady) {
      if (!firstWorldStarted) {
        firstWorldStarted = true;
        // The sky/precipitation share the final world light-count program key too.
        scene.traverse(object => {
          if ((object as THREE.Mesh).isMesh && (object === sky.dome || object.name === 'precipitation' || object.name === 'splashes')) {
            pendingWorld.push(compileSample(object as THREE.Mesh));
            hideForWarmup(object);
          }
        });
        firstWorldJob.run((function* (): BuildSteps {
          try {
            while (pendingWorld.length) {
              const samples = new THREE.Group();
              // Compile-only views must not dispatch real meshes' add/remove listeners.
              samples.children.push(...pendingWorld.splice(0));
              try {
                yield* compileObjects(renderer, samples, camera, scene, post.composer.inputBuffer, startup.shadowMaterials);
                if (post.ssr) yield* post.ssr.warmupObjects(renderer, samples);
              } finally {
                samples.children.length = 0;
              }
            }
          } finally {
            for (const [object, visible] of warmHidden) object.visible = visible;
            warmHidden.clear();
            firstWorldReady = true;
          }
        })());
      }
      // Other owners stream/prepare incrementally during the loading screen.
      // Keep their hidden loading renders running so their first-use work does
      // not accumulate into one giant draw when our warmup completes.
      for (const object of warmHidden.keys()) object.visible = false;
      post.render(dt);
      return;
    }
    // sky LUT every other frame (every frame while lightning flickers)
    if (frame % 2 === 0 || frame < 4 || flash > 0.01) sky.renderLut();
    if (envDirty && (frame - lastEnvFrame > 20 || lastEnvFrame < 0)) {
      envDirty = false;
      lastEnvFrame = frame;
      lastEnvTime = ctx.now ?? 0;
      lastEnvSun.copy(ctx.time.sunDir);
      lastEnvCloud = cur.cloud;
      const env = sky.renderEnv();
      scene.environment = env;
      module.envMap = env;
      lighting.setEnvironment(env);
    }
    if (post.ssr) post.ssr.enabled = uniforms.uSSRIntensity.value > 0;
    post.render(dt);
    readbackExposure();
  }

  /** async 1x1 readback of the adapted log2 luminance (PBO + fence: no pipeline stall), a few times a second */
  function readbackExposure(): void {
    if (readbackPending || (frame % 12 !== 0 && Number.isFinite(adaptedAvg))) return;
    readbackPending = true;
    renderer.readRenderTargetPixelsAsync(post.autoExposure.target, 0, 0, 1, 1, readbackBuf).then(() => {
      adaptedAvg = Math.pow(2, halfToFloat(readbackBuf[0]));
    }).catch(() => { /* context loss / unsupported: keep the last value */ }).finally(() => { readbackPending = false; });
  }

  // core calls ctx.composer.render(dt) when set
  ctx.composer = { render: (dt?: number) => renderFrame(dt ?? 1 / 60) };

  const offTile = ctx.events.on('tileLoaded', () => {
    for (const d of [1, 3, 8, 20, 60, 180]) patchAt.add(frame + d);
  });
  const offWeather = ctx.events.on('weather', () => {
    envDirty = true;
  });
  let resizeTimer: ReturnType<typeof setTimeout>;
  const resizePost = () => { if (!isIOS() || !isNameFormUp()) post.setSize(window.innerWidth, window.innerHeight); };
  const onResize = () => {
    if (!isIOS()) { resizePost(); return; }
    clearTimeout(resizeTimer); resizeTimer = setTimeout(resizePost, 500);
  };
  window.addEventListener('resize', onResize);
  post.setSize(window.innerWidth, window.innerHeight);

  // patch whatever already exists
  lighting.patchAll();

  // debug hooks
  (window as any).__atmo = {
    module,
    sky,
    lighting,
    post,
    cur,
    setTone: (m: 'agx' | 'aces' | 'neutral') => post.setToneMode(m),
    setAO: (on: boolean) => {
      if (post.n8ao) post.n8ao.enabled = on;
    },
    setSSR: (on: boolean) => { uniforms.uSSRIntensity.value = on ? 1 : 0; },
    setBloom: (on: boolean) => {
      post.bloom.blendMode.opacity.value = on ? 1 : 0;
    },
    setFog: (on: boolean) => {
      post.fogPass.enabled = on;
    },
    setSmaa: (on: boolean) => {
      post.smaaPass.enabled = on;
    },
    setPost: (on: boolean) => {
      ctx.composer = on ? { render: (dt?: number) => renderFrame(dt ?? 1 / 60) } : null;
    },
    /** debug: the exposure key (the multiplier itself lives on the GPU: key / log-average, clamped) */
    exposure: () => exposure,
    patched: () => lighting.patchedCount,
    /** debug: read the GPU sky LUT at a direction (linear rgb) */
    lut: (x: number, y: number, z: number) => {
      const d = new THREE.Vector3(x, y, z).normalize();
      const el = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
      const az = Math.atan2(d.x, -d.z);
      const v = 0.5 + 0.5 * Math.sign(el) * Math.sqrt(Math.abs(el) / (Math.PI / 2));
      const u = az / (2 * Math.PI) + 0.5;
      const px = Math.min(511, Math.max(0, Math.floor(u * 512)));
      const py = Math.min(255, Math.max(0, Math.floor(v * 256)));
      const buf = new Uint16Array(4);
      renderer.readRenderTargetPixels(sky.lut, px, py, 1, 1, buf);
      return [halfToFloat(buf[0]), halfToFloat(buf[1]), halfToFloat(buf[2])].map((n) => +n.toFixed(4));
    },
    /** debug: the exposure multiplier the GPU applied (from the async readback) and the adapted average */
    exposureNow: () => ({ ex: exposureNow, avg: adaptedAvg }),
  };

  // Core awaits factories before starting the loop. All compilation/upload work
  // stays counted and yields through the same RAF scheduler as scene builders.
  module.update(0, 0);
  module.preRender?.();
  await startup.run('atmosphere shaders and PMREM', (function* (): BuildSteps {
    yield* sky.warmup(scene, camera, post.composer.inputBuffer);
    yield* post.warmup();
    yield* lighting.warmup();
    sky.renderLut();
    yield new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    for (const size of [64, 256]) {
      yield* sky.warmupPMREM(size);
      const env = sky.renderEnv(size);
      scene.environment = env;
      module.envMap = env;
      lighting.setEnvironment(env);
      yield new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    yield* compileObjects(renderer, scene, camera, scene, post.composer.inputBuffer, startup.shadowMaterials);
  })()).catch(error => { module.dispose?.(); throw error; });
  envDirty = false;
  lastEnvFrame = frame;
  lastEnvTime = 0;
  lastEnvSun.copy(ctx.time.sunDir);
  lastEnvCloud = cur.cloud;

  console.info(`[atmosphere] cascades=${lighting.cascades} maxFar=${lighting.maxFar} shadowMap=${q.shadowMapSize} ssao=${q.ssao} bloom=${q.bloom} drops=${dropCount}`);
  return module;
}
