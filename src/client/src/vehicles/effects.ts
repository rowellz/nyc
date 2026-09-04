/** Bounded skid/smoke pools: one draw each, only verified player-driven tire slip. */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import { StateFlag } from '@shared/protocol';
import { SKID_MIN_SPEED, SKID_SLIP, type Driving } from './driving';
import { KINDS } from './kinds';

const MARKS = 4096, PUFFS = 192, MARK_LEN = 0.7, STAMP = 0.45;
const MARK_LIFE = 90, MARKS_PER_SECOND = 40, WHEEL_INTERVAL = 0.1;
interface Trail { points: THREE.Vector3[]; active: boolean[]; times: number[]; seen: number }

export class TireEffects {
  private marks: THREE.InstancedMesh;
  private smoke: THREE.Points;
  private born = new Float32Array(MARKS).fill(-1000);
  private strength = new Float32Array(MARKS);
  private smokeBorn = new Float32Array(PUFFS).fill(-1000);
  private smokePos = new Float32Array(PUFFS * 3);
  private time = { value: 0 };
  private cursor = 0;
  private puff = 0;
  private last = -Infinity;
  private lastSmoke = -Infinity;
  private trails = new Map<string, Trail>();
  private stampWindow = -1;
  private stampCount = 0;
  private matrix = new THREE.Matrix4();
  private point = new THREE.Vector3();
  private mid = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private rot = new THREE.Quaternion();
  private axis = new THREE.Vector3(0, 1, 0);
  private remoteMatrix = new THREE.Matrix4();
  private remoteRotation = new THREE.Quaternion();
  private remoteEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private unit = new THREE.Vector3(1, 1, 1);
  constructor(private ctx: GameContext) {
    const g = new THREE.PlaneGeometry(0.24, MARK_LEN).rotateX(-Math.PI / 2);
    g.setAttribute('iBorn', new THREE.InstancedBufferAttribute(this.born, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iStrength', new THREE.InstancedBufferAttribute(this.strength, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.MeshBasicMaterial({ color: 0x202023, transparent: true, opacity: 0.18, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    m.onBeforeCompile = shader => {
      shader.uniforms.uTireTime = this.time;
      shader.vertexShader = 'attribute float iBorn; attribute float iStrength; varying float vBorn; varying float vStrength; varying vec2 vSkidUv;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBorn = iBorn; vStrength = iStrength; vSkidUv = uv;');
      shader.fragmentShader = 'uniform float uTireTime; varying float vBorn; varying float vStrength; varying vec2 vSkidUv;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>', `diffuseColor.a *= vStrength * clamp(1.0 - (uTireTime - vBorn) / ${MARK_LIFE.toFixed(1)}, 0.0, 1.0)
        * smoothstep(0.0, 0.18, vSkidUv.x) * (1.0 - smoothstep(0.82, 1.0, vSkidUv.x))
        * smoothstep(0.0, 0.08, vSkidUv.y) * (1.0 - smoothstep(0.92, 1.0, vSkidUv.y));\n#include <alphatest_fragment>`);
    };
    m.customProgramCacheKey = () => 'vehicle-skid-v3';
    this.marks = new THREE.InstancedMesh(g, m, MARKS);
    this.marks.name = 'veh-skidmarks'; this.marks.frustumCulled = false;
    this.marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.smokePos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aBorn', new THREE.BufferAttribute(this.smokeBorn, 1).setUsage(THREE.DynamicDrawUsage));
    const sm = new THREE.PointsMaterial({ color: 0xa3a6a8, size: 1.1, transparent: true, opacity: 0.22, depthWrite: false });
    sm.onBeforeCompile = shader => {
      shader.uniforms.uTireTime = this.time;
      shader.vertexShader = 'uniform float uTireTime; attribute float aBorn; varying float vAge;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvAge = uTireTime - aBorn; transformed.y += max(0.0, vAge) * 0.7;');
      shader.fragmentShader = 'varying float vAge;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.a *= max(0.0, 1.0 - vAge / 1.8) * (1.0 - smoothstep(0.1, 0.5, length(gl_PointCoord - vec2(0.5))));\n#include <alphatest_fragment>');
    };
    sm.customProgramCacheKey = () => 'vehicle-smoke-v2';
    this.smoke = new THREE.Points(sg, sm); this.smoke.name = 'veh-tire-smoke'; this.smoke.frustumCulled = false;
    ctx.worldGroup.add(this.marks, this.smoke);
  }
  update(t: number, drive: Driving | null): void {
    this.time.value = t;
    if (this.stampWindow !== Math.floor(t)) { this.stampWindow = Math.floor(t); this.stampCount = 0; }
    let dirty = false, puffed = false;
    const trailFor = (key: string): Trail => {
      let trail = this.trails.get(key);
      if (!trail) {
        trail = { points: Array.from({ length: 4 }, () => new THREE.Vector3()), active: [false, false, false, false], times: [-Infinity, -Infinity, -Infinity, -Infinity], seen: t };
        this.trails.set(key, trail);
      }
      trail.seen = t;
      return trail;
    };
    const stamp = (trail: Trail, i: number, kind: string, matrix: THREE.Matrix4, k: number) => {
      if (k <= 0) { trail.active[i] = false; return; }
      const spec = KINDS[kind];
      this.point.set((i % 2 ? 1 : -1) * spec.track / 2, 0, (i < 2 ? -1 : 1) * spec.wheelbase / 2).applyMatrix4(matrix);
      const ground = this.ctx.physics.groundHeight(this.point.x, this.point.z);
      if (Math.abs(this.point.y - ground) > 0.5) { trail.active[i] = false; return; }
      this.point.y = ground + 0.035;
      const last = trail.points[i];
      const d = Math.hypot(this.point.x - last.x, this.point.z - last.z);
      // Prime a new track without stamping a stationary patch. Never bridge
      // vehicles, lost contact, a teleport, or a discontinuous network sample.
      if (!trail.active[i] || d > 4) { last.copy(this.point); trail.active[i] = true; return; }
      if (d < STAMP || t - trail.times[i] < WHEEL_INTERVAL || this.stampCount >= MARKS_PER_SECOND) return;
      this.mid.copy(this.point).lerp(last, 0.5);
      const heading = Math.atan2(this.point.x - last.x, this.point.z - last.z);
      this.matrix.compose(this.mid, this.rot.setFromAxisAngle(this.axis, heading), this.scale.set(1, 1, d / MARK_LEN));
      this.marks.setMatrixAt(this.cursor, this.matrix);
      this.born[this.cursor] = t; this.strength[this.cursor] = Math.min(1, k); this.cursor = (this.cursor + 1) % MARKS;
      last.copy(this.point); trail.times[i] = t; this.stampCount++; dirty = true; this.last = t;
      if (k > 0.55) {
        this.smokePos.set([this.point.x, this.point.y + 0.15, this.point.z], this.puff * 3);
        this.smokeBorn[this.puff] = t; this.puff = (this.puff + 1) % PUFFS; puffed = true; this.lastSmoke = t;
      }
    };
    const local = this.ctx.state.local;
    if (drive && local.vehicleKey === drive.car.key && local.state.vehicleId === drive.id
      && !local.dead && drive.body.isValid()) {
      const trail = trailFor(`local:${drive.id}:${drive.car.key}`), vel = drive.body.linvel();
      const moving = Math.hypot(vel.x, vel.z) > SKID_MIN_SPEED;
      for (let i = 0; i < 4; i++) {
        const sliding = moving && drive.controller.wheelIsInContact(i) && (drive.lateralSlip[i] > SKID_SLIP || drive.wheelLocked[i]);
        stamp(trail, i, drive.car.kind, drive.car.matrix, sliding ? drive.skid[i] : 0);
      }
    }
    // Traffic and parked cars are deliberately not inputs. The wire has no
    // handbrake bit: only fresh, owned remote states with measured high slip
    // can emit; deceleration/brake lights alone are not evidence of wheel lock.
    for (const [id, remote] of this.ctx.state.remotes) {
      const s = remote.render, latest = remote.next, info = this.ctx.state.vehicles.get(s.vehicleId);
      if (!info || info.driverId !== id || id === local.id || !KINDS[info.kind]
        || latest.vehicleId !== s.vehicleId || !(s.flags & StateFlag.InVehicle) || !(latest.flags & StateFlag.InVehicle)
        || ((s.flags | latest.flags) & (StateFlag.Airborne | StateFlag.Dead))
        || performance.now() / 1000 - remote.lastSeen > 0.5
        || Math.hypot(s.x - this.ctx.camera.position.x, s.z - this.ctx.camera.position.z) > 150) continue;
      const slip = (v: typeof s) => Math.abs(v.vx * Math.cos(v.yaw) - v.vz * Math.sin(v.yaw))
        / Math.max(1, Math.abs(v.vx * Math.sin(v.yaw) + v.vz * Math.cos(v.yaw)));
      if (Math.hypot(s.vx, s.vz) <= SKID_MIN_SPEED || Math.hypot(latest.vx, latest.vz) <= SKID_MIN_SPEED
        || slip(s) <= SKID_SLIP || slip(latest) <= SKID_SLIP) continue;
      this.remoteMatrix.compose(this.mid.set(s.x, s.y, s.z), this.remoteRotation.setFromEuler(this.remoteEuler.set(s.pitch, s.yaw, s.roll)), this.unit);
      const trail = trailFor(`remote:${id}:${s.vehicleId}`);
      const strength = THREE.MathUtils.clamp((Math.min(slip(s), slip(latest)) - SKID_SLIP) / 0.65, 0.15, 1);
      for (let i = 0; i < 4; i++) stamp(trail, i, info.kind, this.remoteMatrix, strength);
    }
    for (const [key, trail] of this.trails) if (trail.seen !== t) this.trails.delete(key);
    if (dirty) {
      this.marks.instanceMatrix.needsUpdate = true;
      this.marks.geometry.getAttribute('iBorn').needsUpdate = true;
      this.marks.geometry.getAttribute('iStrength').needsUpdate = true;
    }
    if (puffed) {
      this.smoke.geometry.getAttribute('position').needsUpdate = true;
      this.smoke.geometry.getAttribute('aBorn').needsUpdate = true;
    }
    this.marks.visible = t - this.last < MARK_LIFE;
    this.smoke.visible = t - this.lastSmoke < 1.8;
  }
  unload(key: string): void {
    this.trails.clear();
    for (let i = 0; i < this.born.length; i++) {
      this.marks.getMatrixAt(i, this.matrix);
      const e = this.matrix.elements;
      if (`${Math.floor(e[12] / 256)}_${Math.floor(e[14] / 256)}` === key) this.born[i] = -1000;
    }
    for (let i = 0; i < this.smokeBorn.length; i++) {
      if (`${Math.floor(this.smokePos[i * 3] / 256)}_${Math.floor(this.smokePos[i * 3 + 2] / 256)}` === key) this.smokeBorn[i] = -1000;
    }
    this.marks.geometry.getAttribute('iBorn').needsUpdate = true;
    this.smoke.geometry.getAttribute('aBorn').needsUpdate = true;
  }
  dispose(): void {
    this.ctx.worldGroup.remove(this.marks, this.smoke);
    this.marks.geometry.dispose(); (this.marks.material as THREE.Material).dispose(); this.marks.dispose();
    this.smoke.geometry.dispose(); (this.smoke.material as THREE.Material).dispose();
  }
}
