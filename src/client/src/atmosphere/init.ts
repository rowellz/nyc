import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { buildScope, type BuildSteps } from '@/buildings/loading';

/** Use the builders' shared budget/upload queue, including its busy lifetime.
 * Each yielded compile promise resumes on a later RAF, even when already cached. */
export class AtmosphereInit {
  private scope;
  private tail: Promise<void> = Promise.resolve();
  readonly shadowMaterials = new Set<THREE.Material>();
  constructor(private ctx: GameContext) { this.scope = buildScope(ctx); }
  job(label: string) { return this.scope.job(label); }
  async run(label: string, steps: BuildSteps): Promise<void> {
    const job = this.scope.job(label);
    const previous = this.tail;
    // Count queued work immediately, but never start two shader jobs in one RAF.
    this.tail = job.done;
    await previous;
    let completed = false;
    job.run((function* (): BuildSteps { yield* steps; completed = true; })());
    await job.done;
    if (!completed) throw new Error(`${label} cancelled or failed`);
  }
  dispose(): void {
    this.scope.dispose();
    for (const material of this.shadowMaterials) material.dispose();
    this.shadowMaterials.clear();
  }
}

/** A compile-only view: Object3D.clone serializes userData and InstancedMesh.clone
 * copies every instance buffer. Neither is needed by renderer.compileAsync. */
export function compileSample(object: THREE.Mesh): THREE.Mesh {
  const sample = Object.create(object) as THREE.Mesh;
  sample.children = [];
  sample.parent = null;
  return sample;
}

/** Geometry switches that participate in Three's program key, not mesh identity. */
export function geometryVariant(object: THREE.Mesh): string {
  const instanced = object as THREE.InstancedMesh;
  const batched = object as THREE.BatchedMesh;
  const geometry = object.geometry;
  const morph = geometry.morphAttributes;
  return [!!instanced.isInstancedMesh, !!instanced.instanceColor, !!instanced.morphTexture,
    !!batched.isBatchedMesh, !!(batched as unknown as { _colorsTexture?: unknown })._colorsTexture,
    !!(object as THREE.SkinnedMesh).isSkinnedMesh, geometry.getAttribute('color')?.itemSize ?? 0,
    !!geometry.getAttribute('tangent'), morph.position?.length ?? 0, morph.normal?.length ?? 0,
    morph.color?.length ?? 0].join('|');
}

/** Compile with the actual output color space/light/instancing variant. Restore
 * render state synchronously: never leave an offscreen target bound across await. */
export function compileMaterial(renderer: THREE.WebGLRenderer, material: THREE.Material,
  camera: THREE.Camera, scene: THREE.Scene, target: THREE.WebGLRenderTarget | null,
  object?: THREE.Mesh): Promise<unknown> {
  const sample = object ? compileSample(object) : new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  sample.material = material;
  const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
  try {
    renderer.setRenderTarget(target);
    const ready = renderer.compileAsync(sample, camera, scene);
    // r185 defers shader diagnostics and uniform/attribute discovery to
    // WebGLProgram.onFirstUse, even after compileAsync resolves. Complete that
    // native work here, one material at a time, instead of batching it on the
    // first composer draw. Snapshot the programs before another render changes
    // currentProgram; transparent double-sided materials can compile two.
    const properties = renderer.properties.get(material) as { programs: Map<string, {
      program: WebGLProgram | undefined; getUniforms(): unknown;
    }> };
    const programs = [...properties.programs.values()];
    return ready.then(result => {
      for (const program of programs) if (program.program !== undefined) program.getUniforms();
      return result;
    });
  } finally {
    renderer.setRenderTarget(previous, face, mip);
    // compileAsync consumes geometry synchronously; its promise only polls programs.
    if (!object) sample.geometry.dispose();
  }
}

export function* compileObjects(renderer: THREE.WebGLRenderer, root: THREE.Object3D,
  camera: THREE.Camera, scene: THREE.Scene, target: THREE.WebGLRenderTarget | null,
  retainedShadows?: Set<THREE.Material>): BuildSteps {
  const objects: THREE.Mesh[] = [];
  root.traverse(object => { if ((object as THREE.Mesh).isMesh) objects.push(object as THREE.Mesh); });
  const seen = new Map<THREE.Material, Set<string>>();
  for (const object of objects) {
    const variant = geometryVariant(object);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      let variants = seen.get(material);
      if (!variants) seen.set(material, variants = new Set());
      if (!variants.has(variant)) {
        variants.add(variant);
        yield compileMaterial(renderer, material, camera, scene, target, object);
      }
      const shadowVariant = `shadow|${variant}|${object.customDepthMaterial?.uuid ?? ''}`;
      if (object.castShadow && !variants.has(shadowVariant)) {
        variants.add(shadowVariant);
        const original = material as THREE.MeshStandardMaterial;
        const depth = object.customDepthMaterial ?? new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking,
          map: original.map ?? null, alphaMap: original.alphaMap ?? null, alphaTest: material.alphaToCoverage ? 0.5 : material.alphaTest,
          displacementMap: original.displacementMap ?? null, displacementScale: original.displacementScale ?? 1,
          displacementBias: original.displacementBias ?? 0, clippingPlanes: material.clippingPlanes,
          clipShadows: material.clipShadows, clipIntersection: material.clipIntersection,
          side: material.shadowSide ?? (material.side === THREE.FrontSide ? THREE.BackSide : material.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide) });
        // Keep a reference until module disposal: disposing the only warmup
        // material would evict its program before Three's shadow renderer uses it.
        if (!object.customDepthMaterial && retainedShadows) {
          retainedShadows.add(depth);
          const detach = () => {
            material.removeEventListener('dispose', release);
            depth.removeEventListener('dispose', detach);
            retainedShadows.delete(depth);
          };
          const release = () => { detach(); depth.dispose(); };
          material.addEventListener('dispose', release);
          depth.addEventListener('dispose', detach);
        }
        // Shadow rendering keeps the world's light state even for depth materials.
        try { yield compileMaterial(renderer, depth, camera, scene, target, object); }
        finally { if (!object.customDepthMaterial && !retainedShadows) depth.dispose(); }
      }
    }
  }
}
