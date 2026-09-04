/** One bounded instanced draw for soft chassis and tire contact shadows. */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { KINDS } from './kinds';
import { ground, type Car } from './model';
import { FAR_CAP, FAR_DIST, NEAR_CAP } from './fleet';
import { KIND_IDS } from './kinds';

// One quad per rendered car, including all four tire lobes: never run out before the fleet.
export const CONTACT_CAP = (NEAR_CAP + FAR_CAP) * KIND_IDS.length;
export const CONTACT_DIST = FAR_DIST;

export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private shape = new THREE.InstancedBufferAttribute(new Float32Array(CONTACT_CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private fadeOffset = new THREE.InstancedBufferAttribute(new Float32Array(CONTACT_CAP * 2), 2).setUsage(THREE.DynamicDrawUsage);
  private matrix = new THREE.Matrix4();
  private scale = new THREE.Vector3();
  private count = 0;

  constructor(private ctx: GameContext) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geo.setAttribute('iContactShape', this.shape);
    geo.setAttribute('iContactFadeOffset', this.fadeOffset);
    const mat = new THREE.MeshBasicMaterial({ color: 0, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.MultiplyBlending, premultipliedAlpha: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    mat.name = 'vehicle-contact-shadow';
    mat.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute vec4 iContactShape; attribute vec2 iContactFadeOffset; varying vec4 vContactShape; varying vec2 vContactFadeOffset; varying vec2 vContactUv;\n' + shader.vertexShader
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvContactShape = iContactShape; vContactFadeOffset = iContactFadeOffset; vContactUv = uv;');
      shader.fragmentShader = 'varying vec4 vContactShape; varying vec2 vContactFadeOffset; varying vec2 vContactUv;\n' + shader.fragmentShader
        .replace('#include <alphatest_fragment>', /* glsl */ `
          vec2 p = (vContactUv - 0.5) * vContactShape.xy;
          // Plane UV v runs opposite local z after rotating onto the road.
          p.y = -p.y + vContactFadeOffset.y;
          vec2 tire = (abs(p) - vContactShape.zw) / vec2(0.32, 0.48);
          float contact = (1.0 - smoothstep(0.15, 1.0, length(tire))) * 0.65;
          float chassis = (1.0 - smoothstep(0.22, 0.52, length((vContactUv - 0.5) * vec2(1.0, 0.9)))) * 0.28;
          diffuseColor.a *= max(contact, chassis) * vContactFadeOffset.x;
          #include <alphatest_fragment>
        `);
    };
    mat.customProgramCacheKey = () => 'vehicle-contact-v2';
    this.mesh = new THREE.InstancedMesh(geo, mat, CONTACT_CAP);
    this.mesh.name = 'veh-contact-shadows';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ctx.worldGroup.add(this.mesh);
  }

  begin(): void { this.count = 0; }

  /** Called only for visible vehicles; distant cars fade out before the cap. */
  add(car: Car, distance: number): void {
    if (distance >= CONTACT_DIST || this.count >= CONTACT_CAP) return;
    const y = ground(this.ctx, car.x, car.z);
    const fade = (1 - THREE.MathUtils.smoothstep(distance, CONTACT_DIST * 0.85, CONTACT_DIST))
      * (1 - THREE.MathUtils.smoothstep(Math.abs(car.y - y), 0.15, 0.8));
    if (fade <= 0) return;
    const s = KINDS[car.kind], center = (s.rear - s.front) / 2;
    this.matrix.makeRotationY(car.yaw).scale(this.scale.set(s.width + 0.8, 1, s.length + 0.8));
    this.matrix.setPosition(car.x + Math.sin(car.yaw) * center, y + 0.045, car.z + Math.cos(car.yaw) * center);
    const i = this.count++;
    this.mesh.setMatrixAt(i, this.matrix);
    this.shape.setXYZW(i, s.width + 0.8, s.length + 0.8, s.track / 2, s.wheelbase / 2);
    this.fadeOffset.setXY(i, fade, center);
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    for (const attr of [this.mesh.instanceMatrix, this.shape, this.fadeOffset]) {
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  dispose(): void {
    this.ctx.worldGroup.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
