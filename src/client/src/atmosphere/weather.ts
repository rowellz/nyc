/**
 * Precipitation: GPU-instanced rain streaks / snow flakes in a box around the camera (wrapped in the vertex
 * shader, wind offset, stretched by relative camera motion) and animated splash rings on the ground.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';

const DROP_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCamPos;
uniform vec3 uCamVel;
uniform float uTime;
uniform vec3 uWind;
uniform float uFall;
uniform vec3 uBox;
uniform float uLen;
uniform float uWidth;
uniform float uMode;
uniform float uIntensity;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  vec3 base = (aSeed.xyz * 2.0 - 1.0) * uBox;
  float sp = uFall * (0.75 + 0.5 * aSeed.w);
  vec3 vel = vec3(uWind.x, -sp, uWind.z);
  vec3 p = base + vel * uTime;
  if (uMode > 0.5) {
    p.x += sin(uTime * 1.3 + aSeed.w * 20.0) * 0.7;
    p.z += cos(uTime * 1.1 + aSeed.x * 20.0) * 0.7;
  }
  vec3 rel = mod(p - uCamPos + uBox, 2.0 * uBox) - uBox;
  p = uCamPos + rel;
  float alive = step(1.0 - uIntensity, aSeed.y);
  vec3 relVel = vel - uCamVel;
  vec3 wp;
  if (uMode > 0.5) {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float s = uWidth * (0.7 + 0.6 * aSeed.w);
    wp = p + right * (position.x * s) + up * (position.y * s);
  } else {
    vec3 sdir = normalize(relVel + vec3(0.0, -1e-3, 0.0));
    float stretch = uLen * clamp(length(relVel) / uFall, 0.6, 3.0);
    vec3 viewDir = normalize(p - cameraPosition);
    vec3 side = normalize(cross(viewDir, sdir));
    wp = p + sdir * (position.y * stretch) + side * (position.x * uWidth);
  }
  float dist = length(rel);
  vFade = alive * smoothstep(0.25, 1.2, dist) * (1.0 - smoothstep(uBox.x * 0.55, uBox.x * 0.95, dist));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

// Streak radiance = tint * (scene log-average luminance * gain): a drop is a lens on its surroundings, so it is
// as bright as the light around it. Additive: bright against dark facades and sky, lost against a lit screen,
// which is how backlit rain photographs. uAdapted is the previous frame's 1x1 adapted luminance (log2).
const LIT_GLSL = /* glsl */ `
uniform sampler2D uAdapted;
uniform float uGain;
uniform vec2 uLumClamp;
vec3 litColor(vec3 tint) {
  float avg = exp2(texture2D(uAdapted, vec2(0.5)).r);
  return tint * clamp(avg * uGain, uLumClamp.x, uLumClamp.y);
}
`;

const DROP_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vFade;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uMode;
${LIT_GLSL}
void main() {
  float a;
  if (uMode > 0.5) {
    a = smoothstep(0.5, 0.12, length(vUv - 0.5));
  } else {
    float x = abs(vUv.x - 0.5) * 2.0;
    a = (1.0 - x * x) * smoothstep(0.0, 0.2, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
  }
  gl_FragColor = vec4(litColor(uColor), a * uAlpha * vFade);
}
`;

const SPLASH_VERT = /* glsl */ `
attribute vec3 aPos;
attribute float aPhase;
uniform float uTime;
uniform float uSize;
varying vec2 vUv;
varying float vT;
void main() {
  vUv = uv;
  float t = fract(uTime * 1.6 + aPhase);
  vT = t;
  float s = uSize * (0.25 + 0.75 * t);
  vec3 wp = aPos + vec3(position.x * s, 0.015, position.y * s);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const SPLASH_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vT;
uniform vec3 uColor;
uniform float uAlpha;
${LIT_GLSL}
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.16, 0.0, abs(r - (0.25 + 0.7 * vT))) ;
  float a = ring * (1.0 - vT) * (1.0 - vT) * uAlpha;
  gl_FragColor = vec4(litColor(uColor), a);
}
`;

export class Precipitation {
  readonly drops: THREE.Mesh;
  readonly splashes: THREE.Mesh;
  private dropMat: THREE.ShaderMaterial;
  private splashMat: THREE.ShaderMaterial;
  private splashPos: THREE.InstancedBufferAttribute;
  private splashSeedCenter = new THREE.Vector3(1e9, 0, 1e9);
  private splashCount: number;
  private prevCam = new THREE.Vector3();
  private camVel = new THREE.Vector3();
  private first = true;

  constructor(private ctx: GameContext, count: number, splashCount: number) {
    this.splashCount = splashCount;
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.attributes.position);
    geo.setAttribute('uv', plane.attributes.uv);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    this.dropMat = new THREE.ShaderMaterial({
      vertexShader: DROP_VERT,
      fragmentShader: DROP_FRAG,
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uCamVel: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector3() },
        uFall: { value: 9 },
        uBox: { value: new THREE.Vector3(14, 11, 14) },
        uLen: { value: 0.4 },
        uWidth: { value: 0.012 },
        uMode: { value: 0 },
        uIntensity: { value: 0 },
        uColor: { value: new THREE.Color(0.6, 0.65, 0.7) },
        uAlpha: { value: 0.35 },
        uAdapted: { value: null },
        uGain: { value: 3.5 },
        uLumClamp: { value: new THREE.Vector2(0.002, 4.0) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.drops = new THREE.Mesh(geo, this.dropMat);
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 5000;
    this.drops.visible = false;
    this.drops.name = 'precipitation';
    ctx.scene.add(this.drops);

    const sgeo = new THREE.InstancedBufferGeometry();
    sgeo.index = plane.index;
    sgeo.setAttribute('position', plane.attributes.position);
    sgeo.setAttribute('uv', plane.attributes.uv);
    this.splashPos = new THREE.InstancedBufferAttribute(new Float32Array(splashCount * 3), 3);
    this.splashPos.setUsage(THREE.DynamicDrawUsage);
    const phases = new Float32Array(splashCount);
    for (let i = 0; i < splashCount; i++) phases[i] = Math.random();
    sgeo.setAttribute('aPos', this.splashPos);
    sgeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    sgeo.instanceCount = splashCount;
    this.splashMat = new THREE.ShaderMaterial({
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: 0.16 },
        uColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
        uAlpha: { value: 0.3 },
        uAdapted: { value: null },
        uGain: { value: 2.5 },
        uLumClamp: { value: new THREE.Vector2(0.002, 3.0) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.splashes = new THREE.Mesh(sgeo, this.splashMat);
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 4999;
    this.splashes.visible = false;
    this.splashes.name = 'splashes';
    ctx.scene.add(this.splashes);
  }

  private reseedSplashes(cx: number, cz: number): void {
    const arr = this.splashPos.array as Float32Array;
    const R = 11;
    for (let i = 0; i < this.splashCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * R;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      let y = 0;
      try {
        y = this.ctx.physics.groundHeight(x, z);
      } catch {
        y = 0;
      }
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }
    this.splashPos.needsUpdate = true;
    this.splashSeedCenter.set(cx, 0, cz);
  }

  /**
   * @param intensity 0..1 precipitation
   * @param mode 0 rain, 1 snow
   * @param wind m/s vector (direction wind blows toward)
   * @param color streak tint (unit luminance); brightness comes from `adapted`
   * @param adapted 1x1 log2 scene luminance (AutoExposurePass.texture, previous frame)
   */
  update(dt: number, t: number, intensity: number, mode: 0 | 1, wind: THREE.Vector3, color: THREE.Color, wet: number, adapted: THREE.Texture | null = null): void {
    const cam = this.ctx.camera;
    const p = cam.position;
    if (this.first) {
      this.prevCam.copy(p);
      this.first = false;
    }
    if (dt > 0) {
      this.camVel.subVectors(p, this.prevCam).divideScalar(dt);
      // smooth + clamp: the free camera can teleport
      if (this.camVel.length() > 60) this.camVel.set(0, 0, 0);
    }
    this.prevCam.copy(p);

    const on = intensity > 0.01;
    this.drops.visible = on;
    const u = this.dropMat.uniforms;
    if (on) {
      (u.uCamPos.value as THREE.Vector3).copy(p);
      (u.uCamVel.value as THREE.Vector3).lerp(this.camVel, 0.3);
      u.uTime.value = t;
      u.uMode.value = mode;
      u.uIntensity.value = THREE.MathUtils.clamp(intensity, 0, 1);
      u.uAdapted.value = adapted;
      // flakes are opaque diffusers (normal blend, lit like a white card); streaks are additive lenses
      this.dropMat.blending = mode === 1 ? THREE.NormalBlending : THREE.AdditiveBlending;
      if (mode === 1) {
        (u.uWind.value as THREE.Vector3).set(wind.x * 0.6, 0, wind.z * 0.6);
        u.uFall.value = 1.3;
        u.uWidth.value = 0.035;
        (u.uBox.value as THREE.Vector3).set(16, 10, 16);
        u.uAlpha.value = 0.85;
        u.uGain.value = 4.0;
        (u.uColor.value as THREE.Color).copy(color);
      } else {
        (u.uWind.value as THREE.Vector3).set(wind.x * 0.9, 0, wind.z * 0.9);
        u.uFall.value = 9;
        // heavy rain: longer, slightly wider streaks so they resolve at 720p against dark facades
        u.uWidth.value = 0.013 + 0.005 * intensity;
        u.uLen.value = 0.5 + 0.45 * intensity;
        (u.uBox.value as THREE.Vector3).set(14, 11, 14);
        u.uAlpha.value = 0.24 + 0.2 * intensity;
        u.uGain.value = 3.0;
        (u.uColor.value as THREE.Color).copy(color);
      }
    }
    const splashOn = mode === 0 && on && wet > 0.05;
    this.splashes.visible = splashOn;
    if (splashOn) {
      if (this.splashSeedCenter.distanceTo(new THREE.Vector3(p.x, 0, p.z)) > 4) this.reseedSplashes(p.x, p.z);
      const s = this.splashMat.uniforms;
      s.uTime.value = t;
      s.uAdapted.value = adapted;
      s.uAlpha.value = 0.22 * Math.min(1, intensity * 1.5) * wet;
      (s.uColor.value as THREE.Color).copy(color);
    }
  }

  dispose(): void {
    this.ctx.scene.remove(this.drops);
    this.ctx.scene.remove(this.splashes);
    this.drops.geometry.dispose();
    this.splashes.geometry.dispose();
    this.dropMat.dispose();
    this.splashMat.dispose();
  }
}
