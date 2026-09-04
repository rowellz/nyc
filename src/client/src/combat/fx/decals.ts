/**
 * Instanced surface decals (bullet holes on masonry/asphalt, blood on the ground, paint scuffs on metal, torn
 * wood): one InstancedMesh of unit
 * quads with a MeshStandardMaterial (so they take light, shadow and fog) and a per-instance atlas cell + birth
 * time; oldest are recycled. Polygon offset keeps them off the surface without z-fighting.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { makeDecalAtlas } from '../textures';
import { chainOnBeforeCompile } from '../materials';

export const DecalKind = { bulletHole: 0, blood: 1, paint: 2, wood: 3 } as const;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();

export class Decals {
  mesh: THREE.InstancedMesh;
  private aInfo: THREE.InstancedBufferAttribute;
  private head = 0;
  private uTime = { value: 0 };
  private atlas: THREE.Texture;
  private lifetime: number;

  constructor(ctx: GameContext, readonly cap = 256, lifetime = 90) {
    this.lifetime = lifetime;
    this.atlas = makeDecalAtlas();
    const geo = new THREE.PlaneGeometry(1, 1);
    this.aInfo = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.aInfo.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) this.aInfo.setXYZW(i, 0, -1e6, 0, 0);
    geo.setAttribute('aInfo', this.aInfo);
    const mat = new THREE.MeshStandardMaterial({
      map: this.atlas,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      roughness: 0.85,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    mat.name = 'decals';
    const uTime = this.uTime;
    const life = this.lifetime;
    chainOnBeforeCompile(
      mat,
      (shader) => {
        shader.uniforms.uTime = uTime;
        shader.uniforms.uLife = { value: life };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute vec4 aInfo; varying vec4 vInfo;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInfo = aInfo;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec4 vInfo; uniform float uTime; uniform float uLife;')
          .replace(
            '#include <map_fragment>',
            `vec2 duv = vec2(vMapUv.x * 0.25 + vInfo.x * 0.25, vMapUv.y);
vec4 sampledDiffuseColor = texture2D(map, duv);
diffuseColor *= sampledDiffuseColor;
float dage = uTime - vInfo.y;
diffuseColor.a *= (1.0 - smoothstep(uLife * 0.7, uLife, dage)) * vInfo.z;
if (dage < 0.0) diffuseColor.a = 0.0;`,
          );
      },
      'decals',
    );
    const atm = ctx.modules.get('atmosphere') as { setupMaterial?: (m: THREE.Material) => void } | undefined;
    atm?.setupMaterial?.(mat);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.name = 'combat-decals';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = 5;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < cap; i++) {
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** place a decal of `size` meters at `point`, facing `normal`, at time `now` (seconds) */
  add(kind: number, point: THREE.Vector3, normal: THREE.Vector3, size: number, now: number, tint: THREE.ColorRepresentation = 0xffffff, opacity = 1): void {
    const i = this.head;
    this.head = (i + 1) % this.cap;
    _q.setFromUnitVectors(_z, normal);
    _qr.setFromAxisAngle(_z, Math.random() * Math.PI * 2);
    _q.multiply(_qr);
    _p.copy(point).addScaledVector(normal, 0.006);
    _s.set(size, size, 1);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.setColorAt(i, _c.set(tint));
    this.aInfo.setXYZW(i, kind, now, opacity, 0);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.aInfo.needsUpdate = true;
  }

  update(t: number): void {
    this.uTime.value = t;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.atlas.dispose();
    this.mesh.removeFromParent();
  }
}
