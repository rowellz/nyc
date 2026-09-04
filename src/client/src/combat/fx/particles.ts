/**
 * GPU-simulated billboard particles (one instanced quad geometry per blend mode = 2 draw calls total).
 * Position, velocity, drag, gravity, size and alpha curves are evaluated in the vertex shader from the
 * per-instance attributes + uTime, so emitting is a few attribute writes and the per-frame CPU cost is nil.
 * Kinds: 0 dust puff, 1 chip, 2 spark (stretched along velocity, additive), 3 blood, 4 smoke (puff cell, slow).
 * Built on MeshBasicMaterial + onBeforeCompile so the atmosphere's fog applies; dust/smoke are tinted by the
 * atmosphere's sun/sky uniforms (by identity) so they read correctly at any time of day.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { makeParticleAtlas } from '../textures';
import { chainOnBeforeCompile } from '../materials';

export const PKind = { dust: 0, chip: 1, spark: 2, blood: 3, smoke: 4 } as const;

export interface EmitOpts {
  life: number;
  size: number;
  sizeEnd?: number;
  color?: THREE.Color | number;
  alpha?: number;
  gravity?: number; // m/s^2 (positive = down)
  drag?: number; // 1/s
  rot?: number;
}

const _c = new THREE.Color();

class Layer {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  aPos: THREE.InstancedBufferAttribute;
  aVel: THREE.InstancedBufferAttribute;
  aTime: THREE.InstancedBufferAttribute;
  aSize: THREE.InstancedBufferAttribute;
  aColor: THREE.InstancedBufferAttribute;
  aMisc: THREE.InstancedBufferAttribute;
  head = 0;
  dirtyMin = Infinity;
  dirtyMax = -Infinity;
  uniforms: { uTime: { value: number }; uSunColor: { value: THREE.Color }; uSkyColor: { value: THREE.Color }; uNight: { value: number } };

  constructor(ctx: GameContext, atlas: THREE.Texture, additive: boolean, readonly cap: number) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    geo.setAttribute('normal', base.attributes.normal);
    geo.instanceCount = cap;
    const mk = (n: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aPos = mk(3);
    this.aVel = mk(3);
    this.aTime = mk(2);
    this.aSize = mk(2);
    this.aColor = mk(4);
    this.aMisc = mk(4);
    // all dead: birth far in the past
    for (let i = 0; i < cap; i++) this.aTime.setXY(i, -1e6, 1);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aTime', this.aTime);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aColor', this.aColor);
    geo.setAttribute('aMisc', this.aMisc);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;

    const atm = ctx.modules.get('atmosphere') as { uniforms?: Record<string, { value: unknown }> } | undefined;
    const au = atm?.uniforms;
    this.uniforms = {
      uTime: { value: 0 },
      uSunColor: (au?.uSunColor as { value: THREE.Color } | undefined) ?? { value: new THREE.Color(1.8, 1.7, 1.55) },
      uSkyColor: (au?.uSkyColor as { value: THREE.Color } | undefined) ?? { value: new THREE.Color(0.45, 0.6, 0.9) },
      uNight: (au?.uNight as { value: number } | undefined) ?? { value: 0 },
    };
    const mat = new THREE.MeshBasicMaterial({
      map: atlas,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    mat.name = additive ? 'particlesAdditive' : 'particles';
    const u = this.uniforms;
    chainOnBeforeCompile(
      mat,
      (shader) => {
        shader.uniforms.uTime = u.uTime;
        shader.uniforms.uSunColor = u.uSunColor;
        shader.uniforms.uSkyColor = u.uSkyColor;
        shader.uniforms.uNight = u.uNight;
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <common>',
            `#include <common>
attribute vec3 aPos; attribute vec3 aVel; attribute vec2 aTime; attribute vec2 aSize; attribute vec4 aColor; attribute vec4 aMisc;
uniform float uTime; uniform vec3 uSunColor; uniform vec3 uSkyColor; uniform float uNight;
varying vec4 vTint; varying float vCell;`,
          )
          .replace(
            '#include <project_vertex>',
            `float age = uTime - aTime.x;
float lifeT = clamp(age / aTime.y, 0.0, 1.0);
bool dead = age < 0.0 || age > aTime.y;
float kind = aMisc.x; float grav = aMisc.y; float drag = aMisc.z;
vec3 disp = drag > 0.001 ? aVel * (1.0 - exp(-drag * age)) / drag : aVel * age;
disp.y -= 0.5 * grav * age * age;
vec3 center = aPos + disp;
// puffs (dust / blood / smoke) do most of their expansion in the first ~150 ms so a hit reads immediately;
// chips and sparks scale linearly
float grow = (kind < 0.5 || kind > 2.5) ? 1.0 - pow(1.0 - lifeT, 3.0) : lifeT;
float size = mix(aSize.x, aSize.y, grow);
vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
vec2 corner = position.xy;
if (kind > 1.5 && kind < 2.5) {
  vec3 velNow = aVel * exp(-drag * age); velNow.y -= grav * age;
  vec3 velV = (viewMatrix * vec4(velNow, 0.0)).xyz;
  vec2 d = length(velV.xy) > 1e-4 ? normalize(velV.xy) : vec2(1.0, 0.0);
  float len = clamp(length(velV) * 0.06, 1.0, 5.0);
  corner = mat2(d.x, d.y, -d.y, d.x) * vec2(corner.x * len, corner.y);
} else {
  float r = aMisc.w + age * (kind < 0.5 || kind > 3.5 ? 0.6 : 5.0) * sign(aMisc.w + 0.01);
  float cr = cos(r), sr = sin(r);
  corner = mat2(cr, sr, -sr, cr) * corner;
}
mvPosition.xy += corner * size;
gl_Position = projectionMatrix * mvPosition;
if (dead) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
// alpha curve by kind
float a;
if (kind < 0.5) a = smoothstep(0.0, 0.05, lifeT) * pow(1.0 - lifeT, 1.3);
else if (kind < 1.5) a = lifeT < 0.75 ? 1.0 : (1.0 - lifeT) / 0.25;
else if (kind < 2.5) a = pow(1.0 - lifeT, 0.7);
else if (kind < 3.5) a = pow(1.0 - lifeT, 1.4);
else a = smoothstep(0.0, 0.2, lifeT) * pow(1.0 - lifeT, 2.0);
// lighting: dust/smoke/chips/blood take the ambient (sky) + a share of sun; sparks are emissive
vec3 lit = kind > 1.5 && kind < 2.5 ? vec3(1.0) : clamp(uSkyColor * 0.55 + uSunColor * 0.22 + 0.02, 0.0, 2.5);
vTint = vec4(aColor.rgb * lit, a * aColor.a);
vCell = kind > 3.5 ? 0.0 : kind;`,
          );
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec4 vTint; varying float vCell;')
          .replace(
            '#include <map_fragment>',
            `vec2 puv = vec2(vMapUv.x * 0.25 + vCell * 0.25, vMapUv.y);
vec4 sampledDiffuseColor = texture2D(map, puv);
diffuseColor *= sampledDiffuseColor;
diffuseColor.rgb *= vTint.rgb;
diffuseColor.a *= vTint.a;`,
          );
      },
      additive ? 'particlesAdd' : 'particlesNorm',
    );
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 21 : 20;
    this.mesh.name = mat.name;
  }

  emit(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, now: number, o: EmitOpts): void {
    const i = this.head;
    this.head = (i + 1) % this.cap;
    this.aPos.setXYZ(i, x, y, z);
    this.aVel.setXYZ(i, vx, vy, vz);
    this.aTime.setXY(i, now, Math.max(0.01, o.life));
    this.aSize.setXY(i, o.size, o.sizeEnd ?? o.size);
    if (o.color !== undefined) _c.set(o.color as THREE.ColorRepresentation);
    else _c.setRGB(1, 1, 1);
    this.aColor.setXYZW(i, _c.r, _c.g, _c.b, o.alpha ?? 1);
    this.aMisc.setXYZW(i, kind, o.gravity ?? 0, o.drag ?? 0, o.rot ?? (Math.random() - 0.5) * 6.28);
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  flush(): void {
    if (this.dirtyMax < 0) return;
    const push = (a: THREE.InstancedBufferAttribute) => {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirtyMin * a.itemSize, (this.dirtyMax - this.dirtyMin + 1) * a.itemSize);
      a.needsUpdate = true;
    };
    push(this.aPos);
    push(this.aVel);
    push(this.aTime);
    push(this.aSize);
    push(this.aColor);
    push(this.aMisc);
    this.dirtyMin = Infinity;
    this.dirtyMax = -Infinity;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export class ParticleSystem {
  private atlas: THREE.Texture;
  private normal: Layer;
  private additive: Layer;
  private t = 0;
  group = new THREE.Group();

  constructor(ctx: GameContext, cap = 2048) {
    this.atlas = makeParticleAtlas();
    this.normal = new Layer(ctx, this.atlas, false, cap);
    this.additive = new Layer(ctx, this.atlas, true, Math.max(256, cap >> 2));
    this.group.name = 'combat-particles';
    this.group.add(this.normal.mesh, this.additive.mesh);
  }

  /** emit one particle; sparks go to the additive layer */
  emit(kind: number, pos: THREE.Vector3, vel: THREE.Vector3, o: EmitOpts): void {
    (kind === PKind.spark ? this.additive : this.normal).emit(kind, pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, this.t, o);
  }
  emitXYZ(kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, o: EmitOpts): void {
    (kind === PKind.spark ? this.additive : this.normal).emit(kind, x, y, z, vx, vy, vz, this.t, o);
  }

  update(t: number): void {
    this.t = t;
    this.normal.uniforms.uTime.value = t;
    this.additive.uniforms.uTime.value = t;
    this.normal.flush();
    this.additive.flush();
  }

  dispose(): void {
    this.normal.dispose();
    this.additive.dispose();
    this.atlas.dispose();
    this.group.removeFromParent();
  }
}
