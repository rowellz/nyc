/**
 * Per-weapon-mesh pose layered on top of the character's hand transform. The animator only raises the arms into
 * the aim pose while aiming (RMB); a hip shot would otherwise leave the barrel pointing at the pavement while the
 * flash and tracer go forward. Around the grip (the mesh origin = the hand) we:
 *  - pivot the gun toward the shot direction for a short window after each shot ("hip raise"), and keep the
 *    barrel on the aim ray while aiming (a small IK-style correction, clamped so a bad pose is left alone)
 *  - add the weapon's own recoil kick: back along the bore + muzzle rise with a per-weapon rise/recovery curve
 *  - slide the magazine ('mag' child) out and back in during a reload, timed to the animator's 1.4 s clip
 * The base transform (what character.setWeaponMesh chose) is captured once at attach; nothing allocates per frame.
 */
import * as THREE from 'three';
import { smoothstep } from './util';

export interface WeaponKick {
  /** meters back along the bore at the peak */
  back: number;
  /** radians of muzzle rise at the peak */
  up: number;
  /** seconds to reach the peak */
  rise: number;
  /** exponential recovery rate (1/s) after the peak */
  recover: number;
}

const _pq = new THREE.Quaternion();
const _pqi = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _kq = new THREE.Quaternion();
const _actual = new THREE.Vector3();
const _off = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _ID = new THREE.Quaternion();
/** seconds the gun stays raised after the last shot */
const RAISE_WINDOW = 1.4;
/** the reload clip: keep the gun up so the magazine change is visible */
const RELOAD_WINDOW = 1.5;
/** hip raise gives up beyond this angle (the hand is somewhere we cannot reason about, e.g. holstered) */
const MAX_HIP_ANGLE = 1.95;
/** while aiming the animator's two-handed pose can still sit well off the camera ray (measured ~60°): correct up to this */
const MAX_AIM_ANGLE = 1.4;

export class WeaponPose {
  private baseQ = new THREE.Quaternion();
  private baseP = new THREE.Vector3();
  private raise = 0;
  private kickT = -1;
  private kick: WeaponKick = { back: 0.02, up: 0.06, rise: 0.03, recover: 10 };
  private mag: THREE.Object3D | null;
  private magP = new THREE.Vector3();

  constructor(readonly mesh: THREE.Object3D) {
    this.baseQ.copy(mesh.quaternion);
    this.baseP.copy(mesh.position);
    this.mag = mesh.getObjectByName('mag') ?? null;
    if (this.mag) this.magP.copy(this.mag.position);
  }

  /** a shot was fired from this weapon: snap the raise on and start the kick */
  fire(kick: WeaponKick): void {
    this.kick = kick;
    this.kickT = 0;
    this.raise = 1;
  }

  /**
   * dt in seconds; aimDir = world direction the shot goes (normalized) or null; sinceShot = seconds since the
   * last shot; reloadT = seconds into a reload (or -1).
   */
  update(dt: number, aimDir: THREE.Vector3 | null, aiming: boolean, sinceShot: number, reloadT: number): void {
    const mesh = this.mesh;
    const parent = mesh.parent;
    if (!parent) return;
    const target = aiming || sinceShot < RAISE_WINDOW || (reloadT >= 0 && reloadT < RELOAD_WINDOW) ? 1 : 0.65;
    this.raise += (target - this.raise) * (1 - Math.exp(-dt * (target > this.raise ? 28 : 5)));
    if (this.raise < 0.002) this.raise = 0;

    _q.copy(this.baseQ);
    if (this.raise > 0 && aimDir) {
      parent.getWorldQuaternion(_pq);
      // barrel direction the hand currently gives us (mesh -Z in world)
      _actual.set(0, 0, -1).applyQuaternion(_dq.copy(_pq).multiply(this.baseQ));
      _dq.setFromUnitVectors(_actual, aimDir);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(_dq.w)));
      let w = this.raise;
      // The character-owned socket is calibrated every frame, so it can safely
      // track the whole aim arc. Keep the old guard for third-party/fallback rigs.
      const max = parent.name === 'weapon-hand-socket' ? Math.PI : aiming ? MAX_AIM_ANGLE : MAX_HIP_ANGLE;
      if (angle > max) w *= aiming ? max / angle : 0;
      if (w > 0) {
        if (w < 1) _dq.slerp(_ID, 1 - w);
        // world-space correction expressed in the parent's (hand's) frame, on top of the base grip rotation
        _pqi.copy(_pq).invert();
        _q.copy(_pqi).multiply(_dq).multiply(_pq).multiply(this.baseQ);
      }
    }

    _off.set(0, 0, 0);
    if (this.kickT >= 0) {
      this.kickT += dt;
      const k = this.kick;
      const tk = this.kickT;
      const e = tk < k.rise ? 0.5 + 0.5 * (tk / k.rise) : Math.exp(-(tk - k.rise) * k.recover);
      if (tk > k.rise && e < 0.01) this.kickT = -1;
      else {
        _kq.setFromAxisAngle(_X, k.up * e);
        _q.multiply(_kq);
        _off.set(0, 0, k.back * e).applyQuaternion(_q);
      }
    }
    mesh.quaternion.copy(_q);
    mesh.position.copy(this.baseP).add(_off);

    if (this.mag) {
      // out between 0.18 s and 0.45 s (left hand drops to the hip), back between 0.92 s and 1.12 s (the slap)
      const out = reloadT >= 0 ? smoothstep(0.18, 0.45, reloadT) * (1 - smoothstep(0.92, 1.12, reloadT)) : 0;
      this.mag.position.set(this.magP.x, this.magP.y - 0.17 * out, this.magP.z + 0.03 * out);
      this.mag.rotation.x = -0.35 * out;
      // fully out it is in the other hand, off the gun: hide rather than float
      this.mag.visible = out < 0.96;
    }
  }
}
