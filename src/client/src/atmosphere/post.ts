/**
 * Post-processing stack: RenderPass -> N8AO (quality gated) -> aerial perspective -> SSR (high/ultra) -> auto exposure (log-average
 * luminance, clamped, keyed by daylight) + HDR pivot contrast -> bloom + tone mapping (AgX) + film grade +
 * vignette + grain -> SMAA. HDR half-float buffers; the renderer's own tone mapping/exposure are off (1.0).
 */
import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  Pass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  EdgeDetectionMode,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { DirectN8AOPostPass } from './directAO';
import type { GameContext } from '@/core/context';
import type { AerialPerspectiveEffect } from './fog';
import { compileMaterial } from './init';
import type { BuildSteps } from '@/buildings/loading';
import { ScreenSpaceReflectionPass } from './ssr';

/** Screen-space AO fades out over this range (metres) so it never turns distant pavement to mud. */
const AO_FADE_NEAR = 45;
const AO_FADE_FAR = 150;

const GRADE_FRAG = /* glsl */ `
uniform vec3 uSlope;
uniform vec3 uOffset;
uniform vec3 uPower;
uniform float uSat;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = max(inputColor.rgb, vec3(0.0));
  c = pow(max(c * uSlope + uOffset, vec3(0.0)), uPower);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  outputColor = vec4(c, inputColor.a);
}
`;

/** ASC-CDL style grade applied after tone mapping (display-linear): cool shadows, warm highlights. */
export class GradeEffect extends Effect {
  constructor() {
    super('NycGrade', GRADE_FRAG, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uSlope', new THREE.Uniform(new THREE.Vector3(1.03, 1.0, 0.975))],
        ['uOffset', new THREE.Uniform(new THREE.Vector3(-0.004, -0.002, 0.006))],
        ['uPower', new THREE.Uniform(new THREE.Vector3(1.02, 1.0, 0.99))],
        ['uSat', new THREE.Uniform(1.06)],
      ]),
    });
  }
  /** display-space saturation (1 = none). AgX desaturates: a high sun wants a touch more than night. */
  setSaturation(s: number): void {
    this.uniforms.get('uSat')!.value = s;
  }
}

const LUM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uInput;
uniform vec2 uTexel;
varying vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  // 2x2 box of bilinear taps: 16 source texels per cell of the 64x64 grid
  vec3 c = texture2D(uInput, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(uInput, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(uInput, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(uInput, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  float l = lum(c) * 0.25;
  gl_FragColor = vec4(log2(clamp(l, 1e-4, 64.0)), 0.0, 0.0, 1.0);
}
`;
const ADAPT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uLum;
uniform sampler2D uPrev;
uniform float uBlend;
void main() {
  float s = 0.0;
  for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) s += texture2D(uLum, (vec2(float(x), float(y)) + 0.5) / 8.0).r;
  float cur = s / 64.0;
  float prev = texture2D(uPrev, vec2(0.5)).r;
  gl_FragColor = vec4(mix(prev, cur, uBlend), 0.0, 0.0, 1.0);
}
`;
const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Scene log-average luminance: the HDR frame is reduced to a 64x64 grid of log2 luminance (each cell a 2x2
 * box of bilinear taps, i.e. 16 pixels of the 8x8-pixel area it covers), averaged to 1x1 with temporal
 * adaptation. Does not write the output buffer.
 */
export class AutoExposurePass extends Pass {
  readonly lumRT: THREE.WebGLRenderTarget;
  private adaptRT: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private cur = 0;
  private lumMat: THREE.ShaderMaterial;
  private adaptMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** adaptation time constant (s); set to ~0 for instant (screenshots, first frames) */
  tau = 1.2;

  constructor() {
    super('AutoExposurePass');
    this.needsSwap = false;
    const opts: THREE.RenderTargetOptions = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false };
    this.lumRT = new THREE.WebGLRenderTarget(64, 64, opts);
    this.lumRT.texture.name = 'autoExposure.lum';
    this.adaptRT = [new THREE.WebGLRenderTarget(1, 1, opts), new THREE.WebGLRenderTarget(1, 1, opts)];
    this.lumMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: LUM_FRAG, uniforms: { uInput: { value: null }, uTexel: { value: new THREE.Vector2(1 / 256, 1 / 256) } }, depthTest: false, depthWrite: false });
    this.adaptMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: ADAPT_FRAG, uniforms: { uLum: { value: this.lumRT.texture }, uPrev: { value: null }, uBlend: { value: 1 } }, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lumMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  *warmup(renderer: THREE.WebGLRenderer): BuildSteps {
    yield compileMaterial(renderer, this.lumMat, this.quadCam, this.quadScene, this.lumRT);
    yield compileMaterial(renderer, this.adaptMat, this.quadCam, this.quadScene, this.adaptRT[0]);
  }

  /** 1x1 texture, R = adapted log2 average luminance */
  get texture(): THREE.Texture {
    return this.adaptRT[this.cur].texture;
  }

  /** the 1x1 target behind `texture` (for an async CPU readback of the adapted luminance) */
  get target(): THREE.WebGLRenderTarget {
    return this.adaptRT[this.cur];
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, _outputBuffer: THREE.WebGLRenderTarget, deltaTime?: number): void {
    const prevRT = renderer.getRenderTarget();
    this.lumMat.uniforms.uInput.value = inputBuffer.texture;
    (this.lumMat.uniforms.uTexel.value as THREE.Vector2).set(1 / inputBuffer.width, 1 / inputBuffer.height);
    this.quad.material = this.lumMat;
    renderer.setRenderTarget(this.lumRT);
    renderer.render(this.quadScene, this.quadCam);
    const next = 1 - this.cur;
    this.adaptMat.uniforms.uPrev.value = this.adaptRT[this.cur].texture;
    const dt = deltaTime ?? 1 / 60;
    this.adaptMat.uniforms.uBlend.value = this.tau <= 0.001 ? 1 : 1 - Math.exp(-dt / this.tau);
    this.quad.material = this.adaptMat;
    renderer.setRenderTarget(this.adaptRT[next]);
    renderer.render(this.quadScene, this.quadCam);
    this.cur = next;
    renderer.setRenderTarget(prevRT);
  }

  override setSize(): void {
    /* fixed-size targets */
  }

  override dispose(): void {
    this.lumRT.dispose();
    this.adaptRT[0].dispose();
    this.adaptRT[1].dispose();
    this.lumMat.dispose();
    this.adaptMat.dispose();
    this.quad.geometry.dispose();
  }
}

const EXPOSURE_FRAG = /* glsl */ `
uniform sampler2D uAdapted;
uniform vec4 uExp;      // key, min, max, contrast
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float avg = exp2(texture2D(uAdapted, vec2(0.5)).r);
  float ex = clamp(uExp.x / max(avg, 1e-4), uExp.y, uExp.z);
  vec3 c = max(inputColor.rgb, vec3(0.0)) * ex;
  // scene-linear contrast pivoted on middle grey (AgX base alone is flat)
  c = 0.18 * pow(c / 0.18, vec3(uExp.w));
  outputColor = vec4(c, inputColor.a);
}
`;

/** applies the auto exposure (camera-like: key / log-average, clamped) and HDR pivot contrast before bloom/tone mapping */
export class ExposureEffect extends Effect {
  constructor(adapted: THREE.Texture) {
    super('AutoExposure', EXPOSURE_FRAG, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, THREE.Uniform>([
        ['uAdapted', new THREE.Uniform(adapted)],
        ['uExp', new THREE.Uniform(new THREE.Vector4(0.14, 0.6, 2.2, 1.1))],
      ]),
    });
  }
  set(key: number, min: number, max: number, contrast: number): void {
    (this.uniforms.get('uExp')!.value as THREE.Vector4).set(key, min, max, contrast);
  }
}

/** ADD bloom with zero opacity contributes nothing, including its blur pyramid.
 * Keep the texture/shader bound so dusk resumes without a compile or stale frame. */
export class GatedBloomEffect extends BloomEffect {
  override update(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, deltaTime?: number): void {
    if (this.blendMode.opacity.value === 0) return;
    super.update(renderer, inputBuffer, deltaTime);
  }
}

export class PostStack {
  private disposed = false;
  readonly composer: EffectComposer;
  readonly renderPass: RenderPass;
  readonly n8ao: N8AOPostPass | null = null;
  readonly fogPass: EffectPass;
  readonly ssr: ScreenSpaceReflectionPass | null;
  readonly autoExposure: AutoExposurePass;
  readonly exposure: ExposureEffect;
  readonly exposurePass: EffectPass;
  readonly mainPass: EffectPass;
  readonly smaaPass: EffectPass;
  readonly bloom: BloomEffect;
  /** night haze: a second, much wider and dimmer kernel over the same emissives (the air glowing around the signs) */
  readonly haze: BloomEffect | null;
  readonly tone: ToneMappingEffect;
  readonly grade: GradeEffect;
  readonly vignette: VignetteEffect;
  readonly noise: NoiseEffect;
  readonly smaa: SMAAEffect;

  constructor(private ctx: GameContext, fog: AerialPerspectiveEffect) {
    const q = ctx.quality;
    const r = ctx.renderer;
    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0, depthBuffer: true, stencilBuffer: false });
    this.renderPass = new RenderPass(ctx.scene, ctx.camera);
    this.composer.addPass(this.renderPass);

    if (q.ssao) {
      const size = r.getDrawingBufferSize(new THREE.Vector2());
      const ao = new DirectN8AOPostPass(ctx.scene, ctx.camera, size.x, size.y);
      // n8ao 2.0.1 only disables auto-detection when transparencyAware CHANGES.
      // Setting its default false is a no-op: the first transparent decal then
      // enables masking of the ground AO (and two extra world renders).
      ao.autoDetectTransparency = false;
      const c = ao.configuration;
      c.aoRadius = 1.5;
      // n8ao attenuates each sample over aoRadius * distanceFalloff * 0.2 metres, so the vendor
      // default of 1.0 only counted occluders within 30 cm of the surface. A chair seat 45 cm above
      // the pavement, a car floor, a curb reveal and a portal recess all fell outside that window,
      // which is why the AO buffer came back nearly blank (median occlusion 0.94, nothing at any
      // ground contact) while still costing 3.3 ms. 2.5 gives a 75 cm attenuation range.
      c.distanceFalloff = 2.5;
      // Response curve on the occlusion term. With real occlusion in the buffer, squaring it would
      // have doubled the mid-tone veil as well as the contacts; 1.8 holds mid-tones where they were.
      c.intensity = 1.8;
      c.aoSamples = q.level === 'ultra' ? 16 : 8;
      c.denoiseSamples = 8;
      // A 12-texel two-pass poisson blur at half res spreads a contact over ~48 full-res pixels: the
      // darkening survives as a haze over the whole frame but the contact itself does not.
      c.denoiseRadius = 6;
      c.denoiseIterations = 1;
      // The vendor default (0, 0) switches its self-occlusion bias heuristic off entirely, which
      // leaves false occlusion on every grazing surface. Keep the heuristic, add no constant.
      c.biasOffset = 0;
      c.biasMultiplier = 1;
      c.halfRes = true;
      c.depthAwareUpsampling = true;
      c.screenSpaceRadius = false;
      c.gammaCorrection = false;
      c.transparencyAware = false;
      c.accumulate = false;
      c.color = new THREE.Color(0, 0, 0);
      // AO must not survive to the horizon. A 1.5 m world radius is a couple of half-res pixels at
      // 150 m, so what reaches the frame out there is sampling noise, and it reads as mud on distant
      // pavement. n8ao only exposes a distance fade through scene.fog, which we cannot set (every
      // material in the scene would recompile with USE_FOG), so stamp the compositer's own fog
      // uniforms straight onto it. It re-reads them from scene.fog every frame and rebuilds the
      // material on resize, so this has to run per draw rather than once at construction.
      const compositer = ao.effectCompositerQuad;
      const drawCompositer = compositer.render.bind(compositer);
      compositer.render = (renderer: THREE.WebGLRenderer) => {
        const u = compositer.material.uniforms;
        u.fog.value = true;
        u.fogExp.value = false;
        u.fogNear.value = AO_FADE_NEAR;
        u.fogFar.value = AO_FADE_FAR;
        drawCompositer(renderer);
      };
      this.composer.addPass(ao);
      (this as { n8ao: N8AOPostPass | null }).n8ao = ao;
    }

    this.fogPass = new EffectPass(ctx.camera, fog);
    this.composer.addPass(this.fogPass);

    this.ssr = q.level === 'high' || q.level === 'ultra'
      ? new ScreenSpaceReflectionPass(ctx.scene, ctx.camera, q.level === 'high' ? 0.5 : 1)
      : null;
    if (this.ssr) this.composer.addPass(this.ssr);

    // exposure is its own pass so bloom (which reads its pass input) sees exposed values
    this.autoExposure = new AutoExposurePass();
    this.composer.addPass(this.autoExposure);
    this.exposure = new ExposureEffect(this.autoExposure.texture);
    this.exposurePass = new EffectPass(ctx.camera, this.exposure);
    this.composer.addPass(this.exposurePass);

    // threshold is driven per frame (setNight): above sunlit surfaces by day, emissives only at night
    this.bloom = new GatedBloomEffect({
      blendFunction: BlendFunction.ADD,
      mipmapBlur: true,
      luminanceThreshold: 2.4,
      luminanceSmoothing: 0.4,
      intensity: 0.8,
      radius: 0.6,
      levels: 6,
    });
    // Screen-space in-scatter: the same emissives (threshold 1.0, well above any lit surface at night) blurred
    // through a deeper mip chain at low gain, so a sign owns a soft wide halo instead of a hard-edged bloom.
    // Opacity 0 by day (setNight); high/ultra only: it is another luminance + 8-level blur chain.
    this.haze = q.bloom && (q.level === 'high' || q.level === 'ultra')
      ? new GatedBloomEffect({ blendFunction: BlendFunction.ADD, mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.3, intensity: 0.22, radius: 1.0, levels: 8 })
      : null;
    if (this.haze) this.haze.blendMode.opacity.value = 0;
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.24 });
    // premultiplied grain: proportional to brightness, never lifts blacks
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.SCREEN, premultiply: true });
    this.noise.blendMode.opacity.value = 0.035;
    const effects: Effect[] = [];
    if (q.bloom) effects.push(this.bloom);
    if (this.haze) effects.push(this.haze);
    effects.push(this.tone, this.grade, this.vignette, this.noise);
    this.mainPass = new EffectPass(ctx.camera, ...effects);
    this.composer.addPass(this.mainPass);

    this.smaa = new SMAAEffect({ preset: (q.level === 'low' || q.level === 'mobile') ? SMAAPreset.MEDIUM : SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR });
    this.smaaPass = new EffectPass(ctx.camera, this.smaa);
    this.composer.addPass(this.smaaPass);

    // Only RenderPass writes scene depth, always into composer.inputBuffer.
    // The post passes sample the composer's separate stable depth texture and
    // never depth-test against outputBuffer. Do not allocate its unused 32-bit
    // depth attachment (7.9 MiB at 1080p). Keep input/stable depth unchanged.
    const output = this.composer.outputBuffer;
    output.dispose();
    output.depthTexture?.dispose();
    output.depthTexture = null;
    output.depthBuffer = false;
  }

  *warmup(): BuildSteps {
    const renderer = this.ctx.renderer, scene = new THREE.Scene(), camera = new THREE.OrthographicCamera();
    const target = this.composer.inputBuffer;
    // These two nested materials are public at runtime in postprocessing 6.39,
    // but omitted from its declarations. Keep the version-specific adapter local.
    const blur = this.bloom.mipmapBlurPass as unknown as { downsamplingMaterial: THREE.Material; upsamplingMaterial: THREE.Material };
    const hazeBlur = this.haze ? this.haze.mipmapBlurPass as unknown as { downsamplingMaterial: THREE.Material; upsamplingMaterial: THREE.Material } : null;
    // Explicit list: do not traverse the world or vendor object graph (cycles/unused effects).
    const materials: (THREE.Material | null)[] = [
      this.fogPass.fullscreenMaterial, this.exposurePass.fullscreenMaterial, this.mainPass.fullscreenMaterial,
      ...(this.ctx.quality.bloom ? [this.bloom.luminanceMaterial,
        blur.downsamplingMaterial, blur.upsamplingMaterial] : []),
      ...(this.haze && hazeBlur ? [this.haze.luminanceMaterial, hazeBlur.downsamplingMaterial, hazeBlur.upsamplingMaterial] : []),
      this.smaa.edgeDetectionMaterial, this.smaa.weightsMaterial,
    ];
    if (this.n8ao) {
      const ao = this.n8ao;
      yield ao.bluenoise;
      materials.push(ao.effectShaderQuad.material, ao.poissonBlurQuad.material,
        ao.effectCompositerQuad.material, ao.copyQuad.material, ao.accumulationQuad.material);
      if (ao.depthDownsampleQuad) materials.push(ao.depthDownsampleQuad.material);
    }
    for (const material of materials) if (material) yield compileMaterial(renderer, material, camera, scene, target);
    yield* this.autoExposure.warmup(renderer);
    if (this.ssr) yield* this.ssr.warmup(renderer);
    yield compileMaterial(renderer, this.smaaPass.fullscreenMaterial!, camera, scene, null);
    // SMAA's bundled images finish loading independently of shader compilation.
    if (!this.smaa.weightsMaterial.searchTexture || !this.smaa.weightsMaterial.areaTexture) {
      yield new Promise<void>(resolve => {
        // SMAA also emits load (missing from the vendor's Effect event typing).
        const events = this.smaa as unknown as THREE.EventDispatcher<{ load: object }>;
        const loaded = () => { events.removeEventListener('load', loaded); resolve(); };
        events.addEventListener('load', loaded);
      });
    }
    for (const texture of [this.smaa.weightsMaterial.searchTexture, this.smaa.weightsMaterial.areaTexture]) {
      if (!texture) continue;
      const image = texture.image as HTMLImageElement;
      const bitmap = yieldBitmap(image, texture.flipY);
      yield bitmap.then(value => {
        const isBitmap = typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap;
        if (this.disposed) { if (isBitmap) value.close(); return; }
        texture.image = value;
        if (isBitmap) {
          texture.flipY = false;
          const release = () => { value.close(); texture.removeEventListener('dispose', release); };
          texture.addEventListener('dispose', release);
        }
        texture.needsUpdate = true;
      });
      yield texture;
    }
  }

  render(dt: number): void {
    this.composer.render(dt);
  }

  /** auto-exposure parameters: key (target log-average), clamp range, HDR pivot contrast, adaptation time */
  setExposure(key: number, min: number, max: number, contrast: number, tau: number): void {
    this.exposure.set(key, min, max, contrast);
    this.autoExposure.tau = tau;
  }

  /** 0 day .. 1 night: bloom only from real emissives (sunlit surfaces sit around 1-2 after exposure).
   * `glow` 0..1 (rain/fog): wet air scatters around lights at night, so the bloom widens and strengthens.
   * `deep` 0..1: full night (past astronomical dusk), gates the wide haze halo. */
  setNight(night: number, glow = 0, deep = night): void {
    const g = glow * night;
    // Night threshold 1.25: sign caps are 2.5 post-exposure and lit facades sit below 0.5, so only real emissives
    // (lenses, screens, lit windows) pass; the soft knee (0.55) keeps the halo from popping at the cut.
    this.bloom.luminanceMaterial.threshold = THREE.MathUtils.lerp(2.4, 1.25, night) * (1 - 0.2 * g);
    this.bloom.luminanceMaterial.smoothing = THREE.MathUtils.lerp(0.4, 0.55, night) + 0.2 * g;
    this.bloom.intensity = THREE.MathUtils.lerp(0.8, 0.65, night) + 0.6 * g;
    // The wide halo and the wider kernel are deep-night only (`deep`): at blue hour every office window is lit
    // and the twilight exposure sits high, so a wide blur over that sea of emissives stacks into a veil.
    (this.bloom.mipmapBlurPass as unknown as { radius: number }).radius = THREE.MathUtils.lerp(0.6, 0.8, deep) + 0.2 * g;
    if (this.haze) {
      this.haze.blendMode.opacity.value = deep;
      this.haze.intensity = 0.22 + 0.5 * g;
    }
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h, false);
  }

  setToneMode(mode: 'agx' | 'aces' | 'neutral'): void {
    this.tone.mode = mode === 'aces' ? ToneMappingMode.ACES_FILMIC : mode === 'neutral' ? ToneMappingMode.NEUTRAL : ToneMappingMode.AGX;
  }

  dispose(): void {
    this.disposed = true;
    this.autoExposure.dispose();
    this.composer.dispose();
  }
}

async function yieldBitmap(image: HTMLImageElement, flipY: boolean): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(image, { imageOrientation: flipY ? 'flipY' : 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch { /* Older browsers can reject orientation/options; retain original pixels. */ }
  }
  await image.decode();
  return image;
}
