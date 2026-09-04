/** Far walkers share draw calls, but retain their own skinned pose, wardrobe and height. */
import * as THREE from 'three';
import { registerDynamicTexture } from '@/core/textureRelease';
import type { CharacterInstance } from './animator';
import { createBodyMaterial } from './materials';
import { BONES, makePalette, REGION_COUNT } from './rig';
import { InstanceUpdates } from '../buildings/instanceUpdates';

interface Batch { mesh: THREE.InstancedMesh; rows: InstanceUpdates; styles: InstanceUpdates; fabrics: InstanceUpdates; matrices: InstanceUpdates }
export class CrowdBatch {
  // Separate shadow casters so an extra far walker never enters the cascaded shadow passes.
  private batches = [new Map<THREE.BufferGeometry, Batch>(), new Map<THREE.BufferGeometry, Batch>()];
  private poses: THREE.DataTexture;
  private palettes: THREE.DataTexture;
  private poseData: Float32Array;
  private paletteData: Float32Array;
  private material: THREE.MeshStandardMaterial;
  private depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  private distanceMaterial = new THREE.MeshDistanceMaterial();
  private versions: { instance: CharacterInstance; version: number }[] = [];
  private inverse = new THREE.Matrix4();
  private bone = new THREE.Matrix4();
  private poseDirty = false;
  private paletteDirty = false;

  constructor(private group: THREE.Group, private capacity: number,
    shared: { uWetness?: { value: number }; uFill?: { value: THREE.Vector4 }; setupMaterial?: (m: THREE.Material) => void }) {
    this.poseData = new Float32Array(BONES.length * 16 * capacity);
    this.paletteData = new Float32Array(REGION_COUNT * 4 * capacity);
    this.poses = new THREE.DataTexture(this.poseData, BONES.length * 4, capacity, THREE.RGBAFormat, THREE.FloatType);
    this.palettes = new THREE.DataTexture(this.paletteData, REGION_COUNT, capacity, THREE.RGBAFormat, THREE.FloatType);
    registerDynamicTexture(this.poses, () => ({ data: this.poseData, width: BONES.length * 4, height: capacity }));
    registerDynamicTexture(this.palettes, () => ({ data: this.paletteData, width: REGION_COUNT, height: capacity }));
    for (const t of [this.poses, this.palettes]) { t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    const m = createBodyMaterial(makePalette({ skin: 0xffffff, shirt: 0xffffff, pants: 0xffffff, shoes: 0xffffff, hair: 0xffffff }), shared);
    this.material = m;
    // Shadow passes must use the same texture-skinned pose, not the geometry's bind pose.
    const poseShader = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uCrowdPoses = { value: this.poses };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute float crowdRow;
attribute vec4 skinIndex; attribute vec4 skinWeight;
uniform sampler2D uCrowdPoses;
mat4 crowdBone(float index) {
  ivec2 p = ivec2(int(index) * 4, int(crowdRow));
  return mat4(texelFetch(uCrowdPoses, p, 0), texelFetch(uCrowdPoses, p + ivec2(1,0), 0),
    texelFetch(uCrowdPoses, p + ivec2(2,0), 0), texelFetch(uCrowdPoses, p + ivec2(3,0), 0));
}
mat4 crowdSkin() {
  return skinWeight.x * crowdBone(skinIndex.x) + skinWeight.y * crowdBone(skinIndex.y)
    + skinWeight.z * crowdBone(skinIndex.z) + skinWeight.w * crowdBone(skinIndex.w);
}`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = mat3(crowdSkin()) * objectNormal;')
        .replace('#include <begin_vertex>', 'vec3 transformed = (crowdSkin() * vec4(position, 1.0)).xyz;');
    };
    for (const shadow of [this.depthMaterial, this.distanceMaterial]) {
      shadow.onBeforeCompile = poseShader;
      shadow.customProgramCacheKey = () => 'nyc-crowd-shadow-v1';
    }
    const compile = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      compile.call(m, shader, renderer);
      poseShader(shader);
      shader.uniforms.uCrowdPalette = { value: this.palettes };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 crowdStyle; attribute vec4 crowdFabric;
flat varying float vCrowdRow; flat varying vec4 vCrowdStyle; flat varying vec4 vCrowdFabric;
`)
        .replace('vec3 transformed = (crowdSkin() * vec4(position, 1.0)).xyz;', `vec3 transformed = (crowdSkin() * vec4(position, 1.0)).xyz;
vCrowdRow = crowdRow; vCrowdStyle = crowdStyle; vCrowdFabric = crowdFabric;`);
      // Every uPalette[] read becomes a row lookup in the shared palette texture. Rewriting the declaration
      // first and then every remaining subscript keeps this working when materials.ts adds another read.
      const source = shader.fragmentShader
        .replace('uniform vec4 uStyle;', 'flat varying vec4 vCrowdStyle;\nflat varying float vCrowdRow;')
        .replace('uniform vec4 uFabric;', 'flat varying vec4 vCrowdFabric;')
        .replace(`uniform vec4 uPalette[${REGION_COUNT}];`, 'uniform sampler2D uCrowdPalette;')
        .replaceAll('uStyle.', 'vCrowdStyle.')
        .replaceAll('uFabric.', 'vCrowdFabric.')
        .replace(/uPalette\[([^\]]+)\]/g, 'texelFetch(uCrowdPalette, ivec2($1, int(vCrowdRow)), 0)');
      if (source.includes('uPalette')) console.warn('[crowd] palette rewrite missed a read; batch colours would be white');
      shader.fragmentShader = source;
    };
    m.customProgramCacheKey = () => 'nyc-crowd-batch-v5';
    shared.setupMaterial?.(m);
  }

  begin(): void { for (const batches of this.batches) for (const b of batches.values()) b.mesh.count = 0; }

  add(inst: CharacterInstance, row: number, shadows = true): void {
    const geometry = inst.mesh.geometry;
    const batches = this.batches[Number(shadows)];
    let b = batches.get(geometry);
    if (!b) {
      const g = geometry.clone();
      const rows = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1).setUsage(THREE.DynamicDrawUsage);
      const styles = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const fabrics = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('crowdRow', rows); g.setAttribute('crowdStyle', styles); g.setAttribute('crowdFabric', fabrics);
      const mesh = new THREE.InstancedMesh(g, this.material, this.capacity);
      mesh.name = 'ped-crowd-batch'; mesh.count = 0; mesh.castShadow = shadows; mesh.receiveShadow = true;
      mesh.customDepthMaterial = this.depthMaterial;
      mesh.customDistanceMaterial = this.distanceMaterial;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Manager already frustum-culls each walker; no per-frame aggregate bounds walk.
      mesh.frustumCulled = false;
      this.group.add(mesh);
      b = { mesh, rows: new InstanceUpdates(rows), styles: new InstanceUpdates(styles), fabrics: new InstanceUpdates(fabrics), matrices: new InstanceUpdates(mesh.instanceMatrix) };
      batches.set(geometry, b);
    }
    const index = b.mesh.count++;
    inst.root.updateMatrix();
    b.matrices.write(index * 16, inst.root.matrix.elements);
    b.rows.set(index, row);
    const style = inst.appearance.style, fabric = inst.appearance.fabric;
    for (let i = 0; i < 4; i++) { b.styles.set(index * 4 + i, style?.[i] ?? 0); b.fabrics.set(index * 4 + i, fabric?.[i] ?? 0); }
    const cached = this.versions[row];
    if (!cached || cached.instance !== inst) {
      this.paletteData.set(inst.palette, row * REGION_COUNT * 4);
      this.paletteDirty = true;
    }
    if (!cached || cached.instance !== inst || cached.version !== inst.poseVersion) {
      // Bone matrices are stored relative to the actor, not to its moving world transform.
      inst.root.updateMatrixWorld(true); inst.skeleton.update();
      this.inverse.copy(inst.mesh.matrixWorld).invert();
      for (let i = 0; i < BONES.length; i++) {
        this.bone.fromArray(inst.skeleton.boneMatrices!, i * 16).premultiply(this.inverse);
        this.bone.toArray(this.poseData, (row * BONES.length + i) * 16);
      }
      if (cached) { cached.instance = inst; cached.version = inst.poseVersion; }
      else this.versions[row] = { instance: inst, version: inst.poseVersion };
      this.poseDirty = true;
    }
  }

  end(): void {
    for (const batches of this.batches) for (const b of batches.values()) {
      b.mesh.visible = b.mesh.count > 0;
      if (b.mesh.count) { b.matrices.flush(); b.rows.flush(); b.styles.flush(); b.fabrics.flush(); }
    }
    if (this.poseDirty) this.poses.needsUpdate = true;
    if (this.paletteDirty) this.palettes.needsUpdate = true;
    this.poseDirty = this.paletteDirty = false;
  }

  dispose(): void {
    for (const batches of this.batches) {
      for (const b of batches.values()) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); b.mesh.dispose(); }
      batches.clear();
    }
    this.versions.length = 0; this.poses.dispose(); this.palettes.dispose(); this.material.dispose();
    this.depthMaterial.dispose(); this.distanceMaterial.dispose();
  }
}
