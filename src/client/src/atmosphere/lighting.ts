/**
 * Sun/moon directional light with cascaded shadow maps (three/examples CSM) plus a weak hemisphere fill.
 * CSM patches three's lights_fragment_begin chunk globally, so EVERY lit material must go through
 * setupMaterial() or it would be lit by every cascade light at once. patchAll() sweeps the scene for that.
 */
import * as THREE from 'three';
import { FILTERED_SHADOW_CHUNK } from './shadowFilter';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import type { GameContext } from '@/core/context';
import type { BuildSteps } from '@/buildings/loading';

type Lit = THREE.Material & { defines?: Record<string, unknown>; onBeforeCompile?: (shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void; customProgramCacheKey?: () => string };

const CASCADES: Record<string, number> = { mobile: 1, low: 2, medium: 3, high: 3, ultra: 4 };
const MAX_FAR: Record<string, number> = { mobile: 60, low: 150, medium: 250, high: 350, ultra: 500 };
const SPLITS: Record<number, number[]> = {
  1: [1],
  2: [0.2, 1],
  3: [0.07, 0.25, 1],
  4: [0.04, 0.13, 0.35, 1],
};

export class Lighting {
  readonly csm: CSM;
  readonly sun: THREE.DirectionalLight;
  readonly moon: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly maxFar: number;
  readonly cascades: number;
  private patched = new WeakSet<THREE.Material>();
  private environment: THREE.Texture | null = null;
  private environmentMaterials = new Map<THREE.MeshStandardMaterial, { texture: THREE.Texture | null; release: () => void }>();
  private camFov = NaN;
  private camAspect = NaN;
  private camNear = NaN;
  private camFar = NaN;
  private dirTmp = new THREE.Vector3();
  private moonDir = new THREE.Vector3();
  patchedCount = 0;

  constructor(private ctx: GameContext) {
    const q = ctx.quality;
    this.cascades = CASCADES[q.level] ?? 3;
    this.maxFar = MAX_FAR[q.level] ?? 350;
    const splits = SPLITS[this.cascades];
    this.csm = new CSM({
      camera: ctx.camera,
      parent: ctx.scene,
      cascades: this.cascades,
      maxFar: this.maxFar,
      mode: 'custom',
      customSplitsCallback: (_amount: number, _near: number, _far: number, target: number[]) => {
        target.length = 0;
        for (const s of splits) target.push(s);
      },
      shadowMapSize: q.shadowMapSize,
      shadowBias: -0.00001,
      lightDirection: new THREE.Vector3(0.3, -1, 0.3).normalize(),
      lightIntensity: 3,
      lightNear: 1,
      lightFar: 3200,
      lightMargin: 1000,
    });
    this.csm.fade = true;
    this.csm.lights.forEach((l, i) => {
      l.castShadow = q.shadows;
      l.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      // PCF radius in texels per cascade; the tent spreads its taps by radius/2 texels, and sub-texel
      // spread still filters (hardware PCF is bilinear). Penumbra is ~1 cm per metre of occluder
      // distance, so the near cascade wants a tight kernel: 3.0 was +/-4.3 cm at a 2.8 cm texel, wide
      // enough to dissolve a chair leg. 1.2 is +/-1.7 cm there and still grows to +/-45 cm on the far
      // cascade, where the texel itself is 45 cm and building shadows should be wide and soft.
      l.shadow.radius = [1.2, 1.6, 2.0, 2.4][i] ?? 2.0;
      l.name = 'csmSun';
    });
    this.csm.updateFrustums();
    this.fitFadeBounds();
    this.updateBiases();
    this.sun = this.csm.lights[0];

    // Moonlight is not the sun: keep the public sun and its shadow maps solar-only.
    this.moon = new THREE.DirectionalLight(0xffffff, 0);
    this.moon.name = 'moonFill';
    ctx.scene.add(this.moon, this.moon.target);

    this.hemi = new THREE.HemisphereLight(0xbcd0ff, 0x6a5f52, 0.25);
    this.hemi.name = 'skyFill';
    ctx.scene.add(this.hemi);
  }

  private fitFadeBounds(): void {
    // CSM r185 sizes the fade margin using max(camera.far, maxFar), but its
    // shader normalizes depth by min(...). With a 12 km camera this underfits
    // the overlap between our 150–500 m cascades.
    const cam = this.ctx.camera;
    const shaderRange = Math.min(cam.far, this.maxFar) - cam.near;
    const boundsRange = Math.max(cam.far, this.maxFar) - cam.near;
    this.csm.lights.forEach((light, i) => {
      const z = this.csm.frustums[i].vertices.far[0].z;
      const padding = 0.125 * z * z * (1 / shaderRange - 1 / boundsRange);
      const shadowCam = light.shadow.camera;
      shadowCam.left -= padding;
      shadowCam.right += padding;
      shadowCam.bottom -= padding;
      shadowCam.top += padding;
      shadowCam.updateProjectionMatrix();
    });
  }

  /** Allocate/clear one real cascade per frame using Three's own shadow path.
   * Shared LightShadow objects retain the exact PCF formats/settings. No world
   * geometry is drawn and the first real frame still populates every cascade. */
  *warmup(): BuildSteps {
    if (!this.ctx.quality.shadows) return;
    const renderer = this.ctx.renderer;
    const scratch = new THREE.Scene();
    const target = new THREE.WebGLRenderTarget(1, 1);
    try {
      for (const light of this.csm.lights) {
        const sample = new THREE.DirectionalLight();
        sample.copy(light);
        sample.shadow = light.shadow;
        sample.target = light.target;
        scratch.add(sample);
        const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
        const auto = light.shadow.autoUpdate, needs = light.shadow.needsUpdate;
        try {
          light.shadow.needsUpdate = true;
          renderer.setRenderTarget(target);
          renderer.render(scratch, this.ctx.camera);
        } finally {
          renderer.setRenderTarget(previous, face, mip);
          light.shadow.autoUpdate = auto;
          // Refill with actual geometry even on a night-time boot.
          light.shadow.needsUpdate = needs;
          scratch.remove(sample);
        }
        yield new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
    } finally { target.dispose(); }
  }

  /** Normal bias is the offset that detaches a shadow from its caster, so it buys acne prevention with
   * peter-panning. FILTERED_SHADOW_CHUNK's receiver-plane depth bias now covers the slope acne a filtered
   * lookup causes, so this only has to cover interpolated/normal-mapped normals: half a texel, capped at
   * 8 cm. At 1.6 texels uncapped it was 5.5 cm on the near cascade (chair legs, bollards and railings cast
   * nothing) and 72 cm on the far one (a visible band of daylight under every distant building). */
  private updateBiases(): void {
    const size = this.ctx.quality.shadowMapSize;
    for (const l of this.csm.lights) {
      const cam = l.shadow.camera;
      const extent = cam.right - cam.left;
      const texel = extent / size;
      l.shadow.normalBias = Math.min(texel * 0.5 + 0.004, 0.08);
      l.shadow.bias = -0.00002;
    }
  }

  /** wraps the CSM shader hook around whatever onBeforeCompile the material already had */
  setupMaterial(m: THREE.Material): void {
    // r185 uses scene.environmentIntensity, ignoring material.envMapIntensity,
    // when envMap is null. Bind our PMREM explicitly, including non-tile PBRs.
    const pbr = m as THREE.MeshStandardMaterial;
    if (pbr.isMeshStandardMaterial && !pbr.envMap && !this.environmentMaterials.has(pbr)) {
      const release = () => {
        pbr.removeEventListener('dispose', release);
        this.environmentMaterials.delete(pbr);
      };
      this.environmentMaterials.set(pbr, { texture: this.environment, release });
      pbr.addEventListener('dispose', release);
      pbr.envMap = this.environment;
      pbr.envMapRotation.copy(this.ctx.scene.environmentRotation);
      if (this.environment) pbr.needsUpdate = true;
    }
    if (this.patched.has(m)) return;
    const mat = m as Lit;
    const isLit = !!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial || !!(m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial || !!(m as THREE.MeshLambertMaterial).isMeshLambertMaterial || !!(m as THREE.MeshPhongMaterial).isMeshPhongMaterial || !!(m as THREE.MeshToonMaterial).isMeshToonMaterial || ((m as THREE.ShaderMaterial).isShaderMaterial && (m as THREE.ShaderMaterial).lights);
    this.patched.add(m);
    if (!isLit) return;
    const prev = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    this.csm.setupMaterial(m);
    const csmHook = mat.onBeforeCompile!;
    // The filtered PCF goes on EVERY lit material, not only the ones that already had a hook.
    // Materials without one kept r185's five-tap Vogel disk, whose per-pixel IGN rotation is the
    // stipple that showed up on shadowed pavement and under foliage: a third of the scene's
    // materials (44 of 128 at bryant-park) were still dithering.
    const chained = prev && prev !== csmHook ? prev : null;
    const chainedSrc = chained ? chained.toString() : '';
    // Three keys a program on onBeforeCompile.toString() by default, and every material now shares
    // the same wrapper source, so the chained hook's identity has to go into the key explicitly.
    const hookKey = `|csm|${chainedSrc.length}:${hashStr(chainedSrc)}|pcf-tent-v2`;
    const ownKey = prevKey && prevKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey : null;
    mat.onBeforeCompile = function (this: THREE.Material, shader, renderer) {
      chained?.call(this, shader, renderer);
      csmHook.call(this, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', FILTERED_SHADOW_CHUNK);
    };
    mat.customProgramCacheKey = () => `${ownKey ? ownKey.call(mat) : ''}${hookKey}`;
    m.needsUpdate = true;
    this.patchedCount++;
  }

  /** Atmosphere owns replacement/disposal; never leave materials holding an old PMREM. */
  setEnvironment(texture: THREE.Texture | null): void {
    this.environment = texture;
    for (const [material, entry] of this.environmentMaterials) {
      if (material.envMap !== entry.texture) {
        // A caller supplied a custom map after registration: leave it alone.
        entry.release();
        continue;
      }
      const changedLayout = !!entry.texture !== !!texture
        || entry.texture?.mapping !== texture?.mapping
        || (entry.texture?.image as { height?: number } | undefined)?.height
          !== (texture?.image as { height?: number } | undefined)?.height;
      material.envMap = texture;
      material.envMapRotation.copy(this.ctx.scene.environmentRotation);
      entry.texture = texture;
      if (changedLayout) material.needsUpdate = true;
    }
  }

  /** sweep the scene for un-patched lit materials (cheap; call a few frames after tiles load) */
  patchAll(root: THREE.Object3D = this.ctx.scene): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      if (Array.isArray(mat)) for (const mm of mat) this.setupMaterial(mm);
      else this.setupMaterial(mat);
    });
  }

  /** direction TOWARD the light; colour/intensity applied to every cascade light */
  setLight(dirToward: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.dirTmp.copy(dirToward).normalize().negate();
    this.csm.lightDirection.copy(this.dirTmp);
    for (const l of this.csm.lights) {
      l.color.copy(color);
      l.intensity = intensity;
    }
  }

  setShadows(on: boolean): void {
    for (const l of this.csm.lights) {
      // Keep castShadow stable: CSM uses the shadow-light count to select ONE
      // cascade. Removing it makes the shader sum all cascade lights instead.
      const enabled = on && this.ctx.quality.shadows;
      l.shadow.intensity = enabled ? 1 : 0;
      // Refresh once for this simulation frame, not for every world render
      // (SSR, warmups and other auxiliary renders share the same shadow maps).
      // Moving/skinned/shader-deformed casters still require every-frame updates
      // even when the sun is frozen: a sun-only cache would leave stale shadows.
      l.shadow.autoUpdate = false;
      // A PCF sampler still needs a valid depth texture when its intensity is
      // zero. Allocate once on a night-time boot, then stop refreshing it.
      l.shadow.needsUpdate = enabled || (this.ctx.quality.shadows && l.shadow.map === null);
    }
  }

  setMoon(dirToward: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.moonDir.copy(dirToward);
    this.moon.color.copy(color);
    this.moon.intensity = intensity;
  }

  /** call once per frame after the camera is final (preRender) */
  update(): void {
    const cam = this.ctx.camera;
    if (cam.fov !== this.camFov || cam.aspect !== this.camAspect || cam.near !== this.camNear || cam.far !== this.camFar) {
      this.camFov = cam.fov;
      this.camAspect = cam.aspect;
      this.camNear = cam.near;
      this.camFar = cam.far;
      this.csm.updateFrustums();
      this.fitFadeBounds();
      this.updateBiases();
    }
    this.csm.update();
    this.moon.position.copy(cam.position).addScaledVector(this.moonDir, 1000);
    this.moon.target.position.copy(cam.position);
  }

  dispose(): void {
    this.setEnvironment(null);
    for (const entry of this.environmentMaterials.values()) entry.release();
    this.csm.remove();
    this.csm.dispose();
    this.ctx.scene.remove(this.hemi);
    this.ctx.scene.remove(this.moon, this.moon.target);
  }
}

function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
