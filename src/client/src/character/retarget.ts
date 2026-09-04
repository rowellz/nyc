/** Local-bind-frame retargeting. The procedural rig is the sole animation source.
 * Its bind axes are model aligned, so concatenated source local rotations are
 * model-space deltas. For each destination joint we precompute a relaxed frame C:
 *   C = swing(destination bind direction -> source bind direction) * bindWorldQ
 * Then targetWorldQ = sourceWorldDelta * C, and targetLocalQ = parentWorldQ^-1 * targetWorldQ.
 * This is NOT a local quaternion copy: it handles A/T poses, rotated armatures,
 * and unmapped intermediate/finger joints without accumulating frame-to-frame drift.
 * Finger joints are unmapped; they get a per-side curl about their own hinge axis (found at
 * bind from the finger direction and the palm normal) so hands can relax, grip or hold a phone.
 */
import * as THREE from 'three';
import { BONES, BONE_INDEX } from './rig';

const aliases: Record<string, string> = { pelvis: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck_01: 'Neck', head: 'Head' };
for (const [suffix, side] of [['l', 'Left'], ['r', 'Right']]) {
  for (const [name, canonical] of Object.entries({ clavicle: 'Shoulder', upperarm: 'Arm', lowerarm: 'ForeArm', hand: 'Hand', thigh: 'UpLeg', calf: 'Leg', foot: 'Foot', ball: 'ToeBase' })) aliases[`${name}_${suffix}`] = side + canonical;
}
export function canonicalBone(name: string): string | undefined {
  const clean = name.replace(/^.*[|:]/, '').replace(/^mixamorig/i, '');
  return aliases[clean.toLowerCase()] ?? BONES.find(b => b.name.toLowerCase() === clean.toLowerCase())?.name;
}
const childNames: Record<string, string> = {};
for (const side of ['Left', 'Right']) Object.assign(childNames, {
  [side + 'Shoulder']: side + 'Arm', [side + 'Arm']: side + 'ForeArm', [side + 'ForeArm']: side + 'Hand',
  [side + 'UpLeg']: side + 'Leg', [side + 'Leg']: side + 'Foot', [side + 'Foot']: side + 'ToeBase',
});
export type Side = 'Left' | 'Right';
interface Joint { node: THREE.Object3D; parent: number; source: number; rest: THREE.Quaternion; frame: THREE.Quaternion; world: THREE.Quaternion; curl?: { side: Side; axis: THREE.Vector3; scale: number } }
export class RetargetRig {
  readonly mapped = new Map<string, THREE.Bone>();
  private joints: Joint[] = [];
  private sourceWorld = BONES.map(() => new THREE.Quaternion());
  private sourceBones: THREE.Bone[];
  private hipRest = new THREE.Vector3();
  private hipParentInverse = new THREE.Matrix4();
  private hip?: THREE.Bone;
  private scratch = new THREE.Vector3();
  private q = new THREE.Quaternion();
  /** current finger curl per side, radians at the proximal joint */
  readonly curl: Record<Side, number> = { Left: 0, Right: 0 };
  constructor(readonly root: THREE.Object3D, source: Map<string, THREE.Bone>) {
    this.sourceBones = BONES.map(b => source.get(b.name)!);
    root.updateMatrixWorld(true);
    root.traverse(n => { if ((n as THREE.Bone).isBone) { const name = canonicalBone(n.name); if (name) this.mapped.set(name, n as THREE.Bone); } });
    for (const name of ['Hips', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']) {
      if (!this.mapped.has(name)) throw new Error(`Incomplete humanoid: missing ${name}`);
    }
    const indices = new Map<THREE.Object3D, number>();
    const bindDirection = new THREE.Vector3(), sourceDirection = new THREE.Vector3();
    root.traverse(node => {
      const name = (node as THREE.Bone).isBone ? canonicalBone(node.name) : undefined;
      const frame = node.getWorldQuaternion(new THREE.Quaternion());
      const child = name && this.mapped.get(childNames[name]);
      if (name && child) {
        bindDirection.setFromMatrixPosition(child.matrixWorld).sub(this.scratch.setFromMatrixPosition(node.matrixWorld)).normalize();
        // the source skeleton's bind axes are model aligned: a child's local offset is its bind direction
        const sourceChild = source.get(childNames[name]);
        if (sourceChild) sourceDirection.copy(sourceChild.position).normalize();
        else { const a = BONES[BONE_INDEX[name]], b = BONES[BONE_INDEX[childNames[name]]]; sourceDirection.fromArray(b.pos).sub(this.scratch.fromArray(a.pos)).normalize(); }
        frame.premultiply(this.q.setFromUnitVectors(bindDirection, sourceDirection));
      }
      // Hands inherit the forearm's calibrated swing, preserving palm/finger roll.
      if (name?.endsWith('Hand')) {
        const parent = this.mapped.get(name.replace('Hand', 'ForeArm'))!;
        const parentJoint = this.joints[indices.get(parent)!];
        this.q.copy(parentJoint.frame).multiply(parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        frame.premultiply(this.q);
      }
      indices.set(node, this.joints.length);
      this.joints.push({ node, parent: indices.get(node.parent!) ?? -1, source: name ? BONE_INDEX[name] : -1, rest: node.quaternion.clone(), frame, world: new THREE.Quaternion() });
    });
    this.hip = this.mapped.get('Hips');
    this.hipRest.copy(this.hip!.position);
    this.hipParentInverse.copy(this.hip!.parent!.matrixWorld).invert();
    this.calibrateFingers(indices);
  }
  /** Hinge axis per finger joint from the bind pose: fingers curl from their direction toward the palm normal. */
  private calibrateFingers(indices: Map<THREE.Object3D, number>): void {
    const fingerDir = new THREE.Vector3(), thumbSide = new THREE.Vector3(), palm = new THREE.Vector3(), handPos = new THREE.Vector3(), tmp = new THREE.Vector3();
    for (const side of ['Left', 'Right'] as Side[]) {
      const hand = this.mapped.get(side + 'Hand');
      if (!hand) continue;
      const fingers: THREE.Object3D[] = [];
      hand.traverse(n => { if (n !== hand && (n as THREE.Bone).isBone) fingers.push(n); });
      const first = (re: RegExp) => fingers.find(f => re.test(f.name));
      const middle = first(/middle_?0?1/i) ?? first(/index_?0?1/i), thumb = first(/thumb_?0?1/i);
      if (!middle || !thumb) continue;
      handPos.setFromMatrixPosition(hand.matrixWorld);
      fingerDir.setFromMatrixPosition(middle.matrixWorld).sub(handPos).normalize();
      thumbSide.setFromMatrixPosition(thumb.matrixWorld).sub(handPos);
      thumbSide.addScaledVector(fingerDir, -thumbSide.dot(fingerDir)).normalize();
      // palm normal: perpendicular to the fingers and the thumb side of the hand (mirror-consistent per side)
      palm.crossVectors(fingerDir, thumbSide).multiplyScalar(side === 'Right' ? -1 : 1).normalize();
      for (const f of fingers) {
        const j = this.joints[indices.get(f)!];
        if (!j || /leaf|end|tip/i.test(f.name)) continue;
        const child = f.children.find(c => (c as THREE.Bone).isBone);
        if (!child) continue;
        const dir = tmp.setFromMatrixPosition(child.matrixWorld).sub(this.scratch.setFromMatrixPosition(f.matrixWorld)).normalize();
        const axisWorld = new THREE.Vector3().crossVectors(dir, palm).normalize();
        if (axisWorld.lengthSq() < 0.5) continue;
        const axis = axisWorld.applyQuaternion(f.getWorldQuaternion(this.q).invert()).normalize();
        const isThumb = /thumb/i.test(f.name);
        const segment = /_?0?([123])/.exec(f.name.replace(/^(index|middle|ring|pinky|thumb)/i, ''))?.[1];
        // proximal joints curl the most; the thumb wraps at about a third of the fingers
        const scale = (isThumb ? 0.35 : 1) * (segment === '1' ? 0.85 : segment === '2' ? 1.0 : 0.7);
        j.curl = { side, axis, scale };
      }
    }
  }
  /** curl both hands (0 flat .. ~1.4 fist), applied on the next update */
  setCurl(left: number, right: number): void { this.curl.Left = left; this.curl.Right = right; }
  update(): void {
    for (let i = 0; i < BONES.length; i++) {
      const parent = BONES[i].parent;
      this.sourceWorld[i].copy(this.sourceBones[i].quaternion);
      if (parent) this.sourceWorld[i].premultiply(this.sourceWorld[BONE_INDEX[parent]]);
    }
    for (const j of this.joints) {
      const parent = this.joints[j.parent];
      if (j.source >= 0) {
        j.world.copy(this.sourceWorld[j.source]).multiply(j.frame);
        j.node.quaternion.copy(parent ? this.q.copy(parent.world).invert().multiply(j.world) : j.world);
      } else {
        if (j.curl) {
          const amount = this.curl[j.curl.side] * j.curl.scale;
          j.node.quaternion.copy(j.rest).multiply(this.q.setFromAxisAngle(j.curl.axis, amount));
        } else j.node.quaternion.copy(j.rest);
        j.world.copy(j.node.quaternion);
        if (parent) j.world.premultiply(parent.world);
      }
    }
    // Transfer only the pelvis delta, in meters; never overwrite destination bone lengths.
    this.scratch.copy(this.sourceBones[0].position);
    this.scratch.x -= BONES[0].pos[0]; this.scratch.y -= BONES[0].pos[1]; this.scratch.z -= BONES[0].pos[2];
    const e = this.hipParentInverse.elements, x = this.scratch.x, y = this.scratch.y, z = this.scratch.z;
    this.hip!.position.copy(this.hipRest).add(this.scratch.set(e[0]*x+e[4]*y+e[8]*z, e[1]*x+e[5]*y+e[9]*z, e[2]*x+e[6]*y+e[10]*z));
  }
}
