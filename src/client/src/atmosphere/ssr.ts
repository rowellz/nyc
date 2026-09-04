/**
 * Deterministic SSR. A lighting-free MRT preserves the materials' own normal/roughness
 * patches (including weather/puddles), then traces the composer depth after fog.
 * No object names, surface IDs, or cross-module material contract are involved.
 */
import * as THREE from 'three';
import { compileMaterial, geometryVariant } from './init';
import type { BuildSteps } from '@/buildings/loading';
import { Pass } from 'postprocessing';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const COMMON = /* glsl */ `
uniform sampler2D uDepth;
uniform sampler2D uSurface;
uniform sampler2D uSurfaceDepth;
uniform sampler2D uSpecular;
uniform mat4 uInvProjection;
uniform mat4 uProjection;
uniform vec2 uSize;
uniform vec2 uNearFar;
varying vec2 vUv;
float linearDepth(float d) {
  return uNearFar.x * uNearFar.y / (uNearFar.y - d * (uNearFar.y - uNearFar.x));
}
float viewDepth(vec2 uv) { return linearDepth(texture2D(uDepth, uv).r); }
vec3 positionAt(vec2 uv, float z) {
  vec4 p = uInvProjection * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return p.xyz * (-z / p.z);
}
vec3 unpackNormal(vec2 e) {
  vec2 f = e * 2.0 - 1.0;
  vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
  n.xy += mix(vec2(1.0), vec2(-1.0), step(vec2(0.0), n.xy)) * max(-n.z, 0.0);
  return normalize(n);
}
vec2 projectPoint(vec3 p) {
  vec4 clip = uProjection * vec4(p, 1.0);
  return clip.xy / clip.w * 0.5 + 0.5;
}
float edgeFade(vec2 uv) {
  vec2 edge = min(uv, 1.0 - uv);
  return smoothstep(0.0, 0.06, min(edge.x, edge.y));
}
`;
const TRACE = /* glsl */ `
${COMMON}
uniform sampler2D uColor;
uniform float uMaxRoughness;
uniform float uMaxDistance;
void main() {
  gl_FragColor = vec4(0.0);
  vec4 surface = texture2D(uSurface, vUv);
  vec4 specular = texture2D(uSpecular, vUv);
  float roughness = surface.z;
  float z = specular.a;
  if (z <= 0.0 || roughness >= uMaxRoughness) return;
  // Reject non-depth-writing foreground objects and half-res silhouette disagreements.
  // Compare raster depths, not geometric z: river/puddle polygon offset can
  // shift depth by metres at grazing angles. Ray origins still use geometric z.
  float rasterZ = linearDepth(texture2D(uSurfaceDepth, vUv).r);
  if (abs(viewDepth(vUv) - rasterZ) > max(0.12, rasterZ * 0.003)) return;
  vec3 n = unpackNormal(surface.xy);
  vec3 p = positionAt(vUv, z);
  vec3 incident = normalize(p);
  float NoV = max(dot(n, -incident), 0.0);
  if (NoV <= 0.0) return;
  vec3 direction = normalize(reflect(incident, n));
  float bias = max(0.045, z * 0.0004);
  vec3 origin = p + n * bias;
  float maxDistance = uMaxDistance;
  if (direction.z > 0.0) maxDistance = min(maxDistance, (-uNearFar.x - origin.z) / direction.z);
  if (maxDistance <= bias) return;
  // Quadratically spaced VIEW-space steps resolve nearby lamps while reaching the skyline.
  // Fixed positions: no frame hash, jitter, temporal history or disocclusion trails.
  float previous = bias;
  float previousDelta = -bias;
  for (int i = 1; i <= 24; ++i) {
    float t = float(i) / 24.0;
    float distance = bias + maxDistance * t * t;
    vec3 ray = origin + direction * distance;
    vec2 hitUv = projectPoint(ray);
    if (any(lessThanEqual(hitUv, vec2(0.001))) || any(greaterThanEqual(hitUv, vec2(0.999)))) break;
    float sceneZ = viewDepth(hitUv);
    float delta = -ray.z - sceneZ;
    if (delta > 0.0 && previousDelta <= 0.0 && sceneZ < uNearFar.y * 0.995) {
      float lo = previous, hi = distance;
      // Refine the first front-to-back crossing; reject depth-discontinuity false hits.
      for (int j = 0; j < 7; ++j) {
        float mid = (lo + hi) * 0.5;
        vec3 q = origin + direction * mid;
        if (-q.z > viewDepth(projectPoint(q))) hi = mid; else lo = mid;
      }
      float hitDistance = (lo + hi) * 0.5;
      vec3 hit = origin + direction * hitDistance;
      hitUv = projectPoint(hit);
      sceneZ = viewDepth(hitUv);
      float thickness = 0.18 + sceneZ * 0.002;
      float error = abs(-hit.z - sceneZ);
      float confidence = (1.0 - smoothstep(thickness * 0.25, thickness, error));
      confidence *= edgeFade(hitUv) * edgeFade(vUv);
      confidence *= 1.0 - smoothstep(maxDistance * 0.75, maxDistance, hitDistance);
      confidence *= smoothstep(bias * 2.0, bias * 8.0, hitDistance);
      confidence *= 1.0 - smoothstep(uMaxRoughness * 0.72, uMaxRoughness, roughness);
      if (confidence > 0.0) {
        // A deterministic five-tap cone footprint approximates the rough GGX lobe.
        float cone = min(12.0, roughness * roughness * hitDistance / max(sceneZ, 1.0) * uSize.y * 0.35);
        vec2 radius = vec2(cone) / uSize;
        vec2 bounds = vec2(0.002);
        vec3 reflected = texture2D(uColor, hitUv).rgb * 0.4;
        reflected += texture2D(uColor, clamp(hitUv + vec2(radius.x, 0.0), bounds, 1.0 - bounds)).rgb * 0.15;
        reflected += texture2D(uColor, clamp(hitUv - vec2(radius.x, 0.0), bounds, 1.0 - bounds)).rgb * 0.15;
        reflected += texture2D(uColor, clamp(hitUv + vec2(0.0, radius.y), bounds, 1.0 - bounds)).rgb * 0.15;
        reflected += texture2D(uColor, clamp(hitUv - vec2(0.0, radius.y), bounds, 1.0 - bounds)).rgb * 0.15;
        vec3 fresnel = specular.rgb + (1.0 - specular.rgb) * pow(1.0 - NoV, 5.0);
        // Alpha carries the conservative Fresnel replacement weight, not opacity.
        gl_FragColor = vec4(reflected * fresnel * confidence, max(max(fresnel.r, fresnel.g), fresnel.b) * confidence);
        return;
      }
    }
    previous = distance;
    previousDelta = delta;
  }
}
`;
const COMPOSITE = /* glsl */ `
${COMMON}
uniform sampler2D uColor;
uniform sampler2D uReflection;
uniform float uIntensity;
void main() {
  vec4 color = texture2D(uColor, vUv);
  float z = viewDepth(vUv);
  vec2 cell = vUv * uSize - 0.5;
  vec2 base = floor(cell);
  vec2 f = fract(cell);
  vec4 reflected = vec4(0.0);
  float sum = 0.0;
  // Bilateral upsampling: foreground poles/curbs must never inherit water reflections.
  for (int y = 0; y < 2; ++y) for (int x = 0; x < 2; ++x) {
    vec2 uv = (base + vec2(float(x), float(y)) + 0.5) / uSize;
    float tapZ = linearDepth(texture2D(uSurfaceDepth, uv).r);
    vec2 w = mix(1.0 - f, f, vec2(float(x), float(y)));
    float weight = w.x * w.y * exp(-abs(tapZ - z) / max(0.06, z * 0.0015));
    reflected += texture2D(uReflection, uv) * weight;
    sum += weight;
  }
  // Replace, rather than double-add, the Fresnel-weighted part of the lit surface.
  // A deferred specular-only buffer would permit exact IBL subtraction; this bounded
  // blend is a conservative approximation and leaves PMREM untouched on ray misses.
  reflected *= clamp(uIntensity, 0.0, 1.0) / max(sum, 0.01);
  gl_FragColor = vec4(color.rgb * (1.0 - reflected.a) + reflected.rgb, color.a);
}
`;

const BUFFER_OUTPUT = /* glsl */ `
  vec3 ssrN = normalize(normal);
  ssrN /= abs(ssrN.x) + abs(ssrN.y) + abs(ssrN.z);
  vec2 ssrOct = ssrN.xy;
  if (ssrN.z < 0.0) ssrOct = (1.0 - abs(ssrOct.yx)) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), ssrOct));
  gl_FragColor = vec4(ssrOct * 0.5 + 0.5, clamp(roughnessFactor, 0.02, 1.0), clamp(metalnessFactor, 0.0, 1.0));
  vec3 ssrF0 = vec3(0.04);
  #ifdef IOR
    ssrF0 = vec3(pow((ior - 1.0) / (ior + 1.0), 2.0));
  #endif
  #ifdef USE_SPECULAR
    ssrF0 *= specularColor * specularIntensity;
  #endif
  ssrSpecular = vec4(mix(ssrF0, diffuseColor.rgb, metalnessFactor), vViewPosition.z);
}
`;

export class ScreenSpaceReflectionPass extends Pass {
  /** Shared scalar hooks. Set the existing material roughness / roughnessFactor to opt in. */
  readonly uniforms = {
    uSSRIntensity: new THREE.Uniform(1),
    uSSRMaxRoughness: new THREE.Uniform(0.55),
    uSSRMaxDistance: new THREE.Uniform(1600),
  };
  readonly gBuffer: THREE.WebGLRenderTarget;
  readonly reflection: THREE.WebGLRenderTarget;
  private readonly trace: THREE.ShaderMaterial;
  private readonly composite: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.Camera();
  private readonly invisible = new THREE.MeshBasicMaterial({ visible: false });
  private readonly materials = new Map<THREE.Material, { version: number; buffer: THREE.MeshStandardMaterial; varyingRoughness?: boolean; release: () => void }>();
  private readonly savedMeshes: THREE.Mesh[] = [];
  private readonly savedMaterials: (THREE.Material | THREE.Material[])[] = [];
  private readonly materialArrays = new WeakMap<THREE.Material[], THREE.Material[]>();
  private readonly swapMaterials = (object: THREE.Object3D): void => {
    const mesh = object as THREE.Mesh;
    const material = mesh.material;
    if (!material) return;
    this.savedMeshes.push(mesh);
    this.savedMaterials.push(material);
    if (Array.isArray(material)) {
      let buffers = this.materialArrays.get(material);
      if (!buffers) this.materialArrays.set(material, buffers = []);
      buffers.length = material.length;
      for (let i = 0; i < material.length; i++) buffers[i] = this.bufferMaterial(material[i]);
      mesh.material = buffers;
    } else mesh.material = this.bufferMaterial(material);
  };
  private readonly clearColor = new THREE.Color();

  constructor(private readonly worldScene: THREE.Scene, private readonly viewCamera: THREE.PerspectiveCamera, readonly resolutionScale: number) {
    super('ScreenSpaceReflections');
    this.needsDepthTexture = true;
    const options: THREE.RenderTargetOptions = { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
    this.gBuffer = new THREE.WebGLRenderTarget(1, 1, { ...options, count: 2, depthBuffer: true });
    this.gBuffer.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);
    this.gBuffer.textures[0].name = 'SSR.normal-roughness-metalness';
    this.gBuffer.textures[1].name = 'SSR.f0-viewDepth';
    this.reflection = new THREE.WebGLRenderTarget(1, 1, options);
    this.reflection.texture.name = 'SSR.radiance';
    const shared = {
      uDepth: new THREE.Uniform<THREE.Texture | null>(null),
      uSurface: new THREE.Uniform(this.gBuffer.textures[0]),
      uSurfaceDepth: new THREE.Uniform(this.gBuffer.depthTexture),
      uSpecular: new THREE.Uniform(this.gBuffer.textures[1]),
      uInvProjection: new THREE.Uniform(viewCamera.projectionMatrixInverse),
      uProjection: new THREE.Uniform(viewCamera.projectionMatrix),
      uSize: new THREE.Uniform(new THREE.Vector2(1, 1)),
      uNearFar: new THREE.Uniform(new THREE.Vector2(viewCamera.near, viewCamera.far)),
      uColor: new THREE.Uniform<THREE.Texture | null>(null),
    };
    this.trace = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: TRACE, depthTest: false, depthWrite: false, uniforms: { ...shared, uMaxRoughness: this.uniforms.uSSRMaxRoughness, uMaxDistance: this.uniforms.uSSRMaxDistance } });
    this.composite = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false, uniforms: { ...shared, uReflection: new THREE.Uniform(this.reflection.texture), uIntensity: this.uniforms.uSSRIntensity } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.trace);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  private bufferMaterial(source: THREE.Material): THREE.Material {
    if (!(source as THREE.MeshStandardMaterial).isMeshStandardMaterial || !source.visible || !source.depthWrite) return this.invisible;
    const original = source as THREE.MeshStandardMaterial;
    let entry = this.materials.get(source);
    if (entry?.version !== source.version) {
      entry?.release();
      // Material.copy JSON-serializes userData. Shader/debug metadata can hold
      // live textures there, forcing canvas readback + PNG encoding during render.
      // The G-buffer never consumes metadata and calls the hook on original below.
      // Use a view so copying all Standard/Physical fields does not mutate source.
      const copySource = Object.create(original) as THREE.MeshStandardMaterial;
      copySource.userData = {};
      const buffer = copySource.clone();
      // MeshStandardMaterial.copy resets defines; retain custom UV/instancing/CSM switches.
      buffer.defines = { ...original.defines };
      buffer.blending = THREE.NoBlending;
      buffer.transparent = false;
      buffer.depthWrite = true;
      buffer.envMap = null;
      buffer.fog = false;
      buffer.onBeforeCompile = (shader, renderer) => {
        // Run the original hook on the original material, preserving shared uniform identities.
        original.onBeforeCompile(shader, renderer);
        // Plain matte meshes cannot receive SSR. Keep patched/textured roughness
        // conservative; composer depth still rejects occluders omitted from this MRT.
        const cached = this.materials.get(original);
        if (cached) cached.varyingRoughness = !shader.fragmentShader.includes('#include <roughnessmap_fragment>')
          || /\broughnessFactor\b/.test(shader.fragmentShader);
        const end = shader.fragmentShader.indexOf('#include <lights_physical_fragment>');
        if (end < 0) throw new Error(`SSR: unsupported standard shader ${original.name}`);
        shader.fragmentShader = 'layout(location = 1) out highp vec4 ssrSpecular;\n' + shader.fragmentShader.slice(0, end) + BUFFER_OUTPUT;
      };
      buffer.customProgramCacheKey = () => `${original.customProgramCacheKey()}|ssr-gbuffer-v1`;
      const release = () => {
        buffer.dispose();
        source.removeEventListener('dispose', release);
        this.materials.delete(source);
      };
      source.addEventListener('dispose', release);
      entry = { version: source.version, buffer, release };
      this.materials.set(source, entry);
    }
    entry.buffer.visible = entry.varyingRoughness !== false || !!original.roughnessMap
      || original.roughness < this.uniforms.uSSRMaxRoughness.value;
    // Polygon offset uses screen derivatives, which double at half resolution.
    entry.buffer.polygonOffsetFactor = original.polygonOffsetFactor * this.resolutionScale;
    entry.buffer.polygonOffsetUnits = original.polygonOffsetUnits;
    entry.buffer.roughness = original.roughness;
    entry.buffer.metalness = original.metalness;
    entry.buffer.opacity = original.opacity;
    entry.buffer.color.copy(original.color);
    return entry.buffer;
  }

  *warmup(renderer: THREE.WebGLRenderer): BuildSteps {
    yield compileMaterial(renderer, this.trace, this.quadCamera, this.quadScene, this.reflection);
    yield compileMaterial(renderer, this.composite, this.quadCamera, this.quadScene, this.reflection);
  }

  *warmupObjects(renderer: THREE.WebGLRenderer, root: THREE.Object3D): BuildSteps {
    const meshes: THREE.Mesh[] = [];
    root.traverse(object => { if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh); });
    const seen = new Map<THREE.Material, Set<string>>();
    for (const mesh of meshes) for (const source of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const variant = geometryVariant(mesh);
      let variants = seen.get(source);
      if (!variants) seen.set(source, variants = new Set());
      if (variants.has(variant)) continue;
      variants.add(variant);
      const material = this.bufferMaterial(source);
      if (material !== this.invisible) yield compileMaterial(renderer, material, this.viewCamera, this.worldScene, this.gBuffer, mesh);
    }
  }

  override setDepthTexture(texture: THREE.Texture): void {
    this.trace.uniforms.uDepth.value = texture;
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.ceil(width * this.resolutionScale));
    const h = Math.max(1, Math.ceil(height * this.resolutionScale));
    this.gBuffer.setSize(w, h);
    this.reflection.setSize(w, h);
    this.trace.uniforms.uSize.value.set(w, h);
  }

  override render(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget): void {
    const target = renderer.getRenderTarget();
    const background = this.worldScene.background;
    const override = this.worldScene.overrideMaterial;
    const shadowUpdate = renderer.shadowMap.autoUpdate;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    try {
      this.worldScene.traverseVisible(this.swapMaterials);
      this.worldScene.background = null;
      this.worldScene.overrideMaterial = null;
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(this.gBuffer);
      renderer.setClearColor(0, 0);
      renderer.clear();
      renderer.render(this.worldScene, this.viewCamera);
    } finally {
      for (let i = 0; i < this.savedMeshes.length; i++) this.savedMeshes[i].material = this.savedMaterials[i];
      this.savedMeshes.length = 0;
      this.savedMaterials.length = 0;
      this.worldScene.background = background;
      this.worldScene.overrideMaterial = override;
      renderer.shadowMap.autoUpdate = shadowUpdate;
      renderer.setClearColor(this.clearColor, clearAlpha);
      renderer.setRenderTarget(target);
    }
    this.trace.uniforms.uColor.value = input.texture;
    this.trace.uniforms.uNearFar.value.set(this.viewCamera.near, this.viewCamera.far);
    try {
      this.quad.material = this.trace;
      renderer.setRenderTarget(this.reflection);
      renderer.render(this.quadScene, this.quadCamera);
      this.quad.material = this.composite;
      renderer.setRenderTarget(this.renderToScreen ? null : output);
      renderer.render(this.quadScene, this.quadCamera);
    } finally {
      renderer.setRenderTarget(target);
    }
  }

  override dispose(): void {
    for (const entry of Array.from(this.materials.values())) entry.release();
    this.invisible.dispose();
    this.gBuffer.dispose();
    this.reflection.dispose();
    this.trace.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
