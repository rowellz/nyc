/**
 * CharacterInstance = rig (bones + skinned body) + AnimationMixer state machine + procedural layers.
 *
 * Layers, in order, every frame:
 *   1. mixer: one locomotion state at a time (crossfaded); gait clips are speed-matched (timeScale) so the
 *      feet do not slide; one-shot states (jumpStart, land, death) clamp on their last frame.
 *   2. aim layer: arms + chest slerp toward a weapon-specific two-handed pose; aim pitch bends Spine1/Spine2.
 *   3. action overlays: fire recoil, reload, punch, hit reaction (timed additive deltas).
 *   4. head look: neck + head turn toward a target direction (smoothed, clamped).
 *   5. mannerism (pedestrians: hands in pockets, holding a bag strap, arms crossed, stoop) + phone pose.
 */
import * as THREE from 'three';
import { BONES, BODY_REGIONS, RIG_HEIGHT, buildBody, createBones, makePalette, type BodyParams, type Palette, type PaletteColors } from './rig';
import { CLIP_DEFS, getClips, type ClipName } from './clips';
import { createBodyMaterial, createProtectionMaterial, type BodyMaterial, type CharacterUniforms } from './materials';
import { createImportedCharacter, type ImportedCharacter } from './assets';

const DEG = Math.PI / 180;

export type WeaponKind = 'none' | 'pistol' | 'rifle';
export type ActionName = 'fire' | 'reload' | 'punch' | 'hitReact';

export interface Appearance {
  /** Stable modular selection seed, independent of instance creation order. */
  variant?: number;
  body: Partial<BodyParams>;
  colors: PaletteColors;
  /** meters */
  height: number;
  /** lateral build multiplier on the whole instance (0.94 slight .. 1.08 heavy) */
  width?: number;
  /** shader detail flags (see createBodyMaterial) */
  style?: [number, number, number, number];
  /** fabric families (see materials.ts FABRIC): outer layer, shirt, trousers, quilted */
  fabric?: [number, number, number, number];
}

/**
 * Camera position published by the character module every frame. Anyone this close renders the good
 * (high) rig whatever the animation budget decided: at 20 m a walker is still ~80 px tall and the
 * 12-segment far body shows its facets.
 */
export const viewPoint = new THREE.Vector3(NaN, 0, NaN);
export const NEAR_RIG_R = 25;

export type Mannerism = 'none' | 'pockets' | 'pocketOne' | 'bagHold' | 'armsCrossed' | 'stoop';

// ---- geometry cache (shared between instances with the same body params) --------------------------
const geoCache = new Map<string, { high: THREE.BufferGeometry; low: THREE.BufferGeometry; refs: number }>();
const accessoryCache = new Map<string, THREE.BufferGeometry>();

function bodyKey(p: Partial<BodyParams>): string {
  return JSON.stringify(p);
}

const lowCache = new Map<string, THREE.BufferGeometry>();
function acquireGeometry(p: Partial<BodyParams>): { high: THREE.BufferGeometry; low: THREE.BufferGeometry } {
  const k = bodyKey(p);
  let e = geoCache.get(k);
  if (!e) {
    // Detail that is a handful of pixels past 25 m does not deserve its own crowd draw call: far walkers
    // share one low geometry per silhouette, with eyewear, earbuds, a tie and a coffee cup merged away.
    const lowKey = bodyKey({ ...p, glasses: undefined, headphones: undefined, earbuds: undefined, tie: undefined, watch: undefined, carry: p.carry === 'coffee' ? undefined : p.carry });
    let low = lowCache.get(lowKey);
    if (!low) { low = buildBody(p, 'low').geometry; lowCache.set(lowKey, low); }
    e = { high: buildBody(p, 'high').geometry, low, refs: 0 };
    geoCache.set(k, e);
  }
  e.refs++;
  return e;
}

function releaseGeometry(p: Partial<BodyParams>): void {
  const k = bodyKey(p);
  const e = geoCache.get(k);
  if (!e) return;
  e.refs--;
  // keep cached: geometries are small and rebuilding costs a few ms; disposed in disposeAllGeometry()
}

export function disposeAllGeometry(): void {
  for (const e of geoCache.values()) e.high.dispose();
  for (const g of lowCache.values()) g.dispose();
  geoCache.clear();
  lowCache.clear();
  for (const g of accessoryCache.values()) g.dispose();
  accessoryCache.clear();
  hiddenMaterial?.dispose(); hiddenMaterial = null;
  phoneGeo?.dispose();
  phoneMat?.dispose();
  phoneGeo = null;
  phoneMat = null;
}

// ---- phone prop (shared geometry + material; one mesh per instance that uses it) ------------------
let phoneGeo: THREE.BoxGeometry | null = null;
let phoneMat: THREE.MeshStandardMaterial | null = null;
function phoneAssets(): { geo: THREE.BoxGeometry; mat: THREE.MeshStandardMaterial } {
  if (!phoneGeo) {
    // the hand is flat in the Y/Z plane (palm along X); the slab lies along the fingers (-Y)
    phoneGeo = new THREE.BoxGeometry(0.008, 0.145, 0.07);
    phoneMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.35, metalness: 0.3 });
  }
  return { geo: phoneGeo, mat: phoneMat! };
}

// ---- aim poses (deg, euler XYZ per bone) ------------------------------------------------------------
type PoseDef = Record<string, [number, number, number]>;

const AIM_POSES: Record<WeaponKind, PoseDef> = {
  pistol: {
    Spine1: [0, -4, 0],
    Spine2: [2, -8, 0],
    Neck: [0, 6, 0],
    Head: [0, 4, -3],
    RightShoulder: [0, 0, -4],
    RightArm: [80, -4, -20],
    RightForeArm: [10, -18, 0],
    RightHand: [-4, 0, 4],
    LeftShoulder: [0, 0, 4],
    LeftArm: [64, 6, 34],
    LeftForeArm: [52, 30, 6],
    LeftHand: [-6, 10, -6],
  },
  rifle: {
    Spine1: [0, -10, 0],
    Spine2: [2, -16, 0],
    Neck: [0, 12, 0],
    Head: [-2, 8, -8],
    RightShoulder: [0, 0, -4],
    RightArm: [58, -10, -22],
    RightForeArm: [88, -24, 0],
    RightHand: [-8, 0, 6],
    LeftShoulder: [0, 0, 4],
    LeftArm: [78, 10, 36],
    LeftForeArm: [26, 34, 8],
    LeftHand: [-8, 14, -8],
  },
  none: {
    Spine1: [0, -6, 0],
    Spine2: [-2, -10, 0],
    Neck: [0, 8, 0],
    Head: [0, 6, 0],
    RightShoulder: [0, 0, -2],
    RightArm: [44, -6, -14],
    RightForeArm: [102, -26, 0],
    RightHand: [-20, 0, 0],
    LeftShoulder: [0, 0, 2],
    LeftArm: [50, 6, 24],
    LeftForeArm: [98, 24, 0],
    LeftHand: [-20, 0, 0],
  },
};

const PHONE_POSE: PoseDef = {
  // Flex at the elbow, not the shoulder: wrist beside the jaw, phone rising to
  // the ear, elbow below the shoulder. The other arm keeps its relaxed gait.
  RightArm: [48, 0, 0],
  RightForeArm: [148, 0, -25],
  RightHand: [-10, 0, 15],
  Neck: [0, -3, -2],
  Head: [0, -4, -3],
};

/** pedestrian mannerisms (arm bones absolute, spine bones additive); Z toward the body = -sign(side) */
const MANNERISM_POSES: Record<Exclude<Mannerism, 'none'>, PoseDef> = {
  pockets: { RightArm: [6, -4, -5], RightForeArm: [20, -8, 0], RightHand: [5, 0, 0], LeftArm: [6, 4, 5], LeftForeArm: [20, 8, 0], LeftHand: [5, 0, 0] },
  pocketOne: { RightArm: [6, -4, -5], RightForeArm: [20, -8, 0], RightHand: [5, 0, 0] },
  bagHold: { LeftArm: [10, 0, 6], LeftForeArm: [110, 0, 25], LeftHand: [-10, 0, 0] },
  // forearms cross the chest: abduct about Z (applied first in XYZ order) so the forearm points across the body, then a little flexion
  armsCrossed: { RightArm: [30, 0, -10], RightForeArm: [12, 0, -80], RightHand: [0, 0, -10], LeftArm: [30, 0, 10], LeftForeArm: [22, 0, 80], LeftHand: [0, 0, 10], Spine2: [-2, 0, 0] },
  stoop: { Spine: [-5, 0, 0], Spine1: [-4, 0, 0], Neck: [5, 0, 0], Head: [3, 0, 0] },
};
/**
 * Arm poses for carried objects. rig.ts builds a cup or an umbrella along the hand's local -Z, so a ~100 deg
 * elbow flex stands the cup upright and lifts the canopy over the shoulder. A bag just hangs, but the elbow
 * still breaks a little so it clears the thigh.
 */
const CARRY_POSES: Record<string, PoseDef> = {
  coffee: { RightArm: [22, 0, -12], RightForeArm: [102, 0, -16], RightHand: [-6, 0, 8] },
  umbrella: { RightArm: [14, 0, -9], RightForeArm: [100, 0, -5], RightHand: [0, 0, 0] },
  tote: { LeftArm: [3, 0, 7], LeftForeArm: [15, 0, 6], LeftHand: [2, 0, 0] },
  shopping: { LeftArm: [3, 0, 7], LeftForeArm: [15, 0, 6], LeftHand: [2, 0, 0] },
};
const ADDITIVE_BONES = new Set(['Spine', 'Spine1', 'Spine2', 'Neck', 'Head']);

const poseQuatCache = new Map<PoseDef, Map<string, THREE.Quaternion>>();
function poseQuats(def: PoseDef): Map<string, THREE.Quaternion> {
  let m = poseQuatCache.get(def);
  if (!m) {
    m = new Map();
    const e = new THREE.Euler();
    for (const [bone, [x, y, z]] of Object.entries(def)) m.set(bone, new THREE.Quaternion().setFromEuler(e.set(x * DEG, y * DEG, z * DEG, 'XYZ')));
    poseQuatCache.set(def, m);
  }
  return m;
}

const AIM_ARM_BONES = ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'];
const AIM_SPINE_BONES = ['Spine1', 'Spine2', 'Neck', 'Head'];

// ---- instance ----------------------------------------------------------------------------------------

export interface FootstepListener {
  (side: 'left' | 'right'): void;
}

let instanceSeq = 0;
let hiddenMaterial: THREE.MeshBasicMaterial | null = null;
function hiddenBodyMaterial(): THREE.MeshBasicMaterial {
  return hiddenMaterial ??= new THREE.MeshBasicMaterial({ visible: false });
}

export class CharacterInstance {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: Map<string, THREE.Bone>;
  readonly skeleton: THREE.Skeleton;
  readonly material: BodyMaterial;
  readonly mixer: THREE.AnimationMixer;
  readonly actions: Record<ClipName, THREE.AnimationAction>;
  readonly appearance: Appearance;
  readonly palette: Palette;
  readonly id = ++instanceSeq;
  private geos: { high: THREE.BufferGeometry; low: THREE.BufferGeometry };
  private protection: THREE.SkinnedMesh | null = null;
  private protectionMat: THREE.ShaderMaterial | null = null;
  private uTime: { value: number };

  // animation state
  state: ClipName = 'idle';
  private prevAction: THREE.AnimationAction | null = null;
  /** locomotion speed in m/s (for gait time scale) */
  speed = 0;
  /** 0..1 aim layer weight */
  aimBlend = 0;
  aimTarget = 0;
  private fireAimLeft = 0;
  weapon: WeaponKind = 'none';
  aimPitch = 0; // radians, + up
  private aimPitchSmooth = 0;
  /** head look target in body space: yaw (+left), pitch (+up), radians; weight 0..1 */
  lookYaw = 0;
  lookPitch = 0;
  lookWeight = 0;
  private lookYawS = 0;
  private lookPitchS = 0;
  private lookWeightS = 0;
  phone = 0;
  /** Seat surface above ground in unscaled rig metres; weight also drives sit/stand transitions. */
  seating: { height: number; weight: number; lean: number } | null = null;
  private phoneS = 0;
  private phoneMesh: THREE.Mesh | null = null;
  mannerism: Mannerism = 'none';
  private mannerismS = 0;
  private mannerismActive: Exclude<Mannerism, 'none'> | null = null;
  private actionTimers: Record<ActionName, number> = { fire: -1, reload: -1, punch: -1, hitReact: -1 };
  private hitSide = 1;
  private liteAcc = 0;
  poseVersion = 0;
  onFootstep: FootstepListener | null = null;
  private lastPhase = 0;
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private weaponMesh: THREE.Object3D | null = null;
  private weaponSocket = new THREE.Group();
  private weaponParentQ = new THREE.Quaternion();
  private weaponDriverQ = new THREE.Quaternion();
  private weaponParentScale = new THREE.Vector3();
  private weaponRootScale = new THREE.Vector3();
  imported: ImportedCharacter | null = null;
  private importedAttempted = false;
  private sharedUniforms: CharacterUniforms;
  private accessories: THREE.SkinnedMesh | null = null;
  private importedEnabled = true;
  /** the mixer's own output for every bone (see update): procedural layers are applied on top of this each frame */
  private basePose: Float32Array;
  private basePoseValid = false;
  detail: 'high' | 'low' = 'high';
  private nearGeometry = true;
  /** rim/back light (rgb, strength) on this instance's skin and clothes; the local player gets it at night */
  readonly rim = { value: new THREE.Vector4(0.62, 0.74, 1.0, 0) };

  constructor(appearance: Appearance, sharedUniforms: CharacterUniforms, deferImported = false) {
    this.sharedUniforms = sharedUniforms;
    this.appearance = appearance;
    this.uTime = sharedUniforms.uTime;
    this.geos = acquireGeometry(appearance.body);
    this.palette = makePalette(appearance.colors);
    this.material = createBodyMaterial(this.palette, sharedUniforms, appearance.style, this.rim, appearance.fabric);
    const { root, bones, byName } = createBones(appearance.body);
    this.bones = byName;
    this.basePose = new Float32Array(bones.length * 4);
    this.mesh = new THREE.SkinnedMesh(this.geos.high, this.material);
    this.mesh.name = 'characterBody';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;
    this.mesh.add(root);
    root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(bones);
    this.mesh.bind(this.skeleton);
    // bounding sphere covering any pose (the geometry's is for the bind pose only)
    this.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.35);
    this.geos.low.boundingSphere = this.mesh.geometry.boundingSphere;
    this.root.add(this.mesh);
    const s = appearance.height / RIG_HEIGHT, w = appearance.width ?? 1;
    this.root.scale.set(s * w, s, s * w);
    // Height is a whole-body scale, which on its own gives a 1.95 m walker a 26 % oversized head and a
    // heavy walker a 8 % wider one. An adult head is ~23 cm whatever the stature, so counter-scale the head
    // bone: k restores most of the height scaling and all of the lateral build.
    const headK = (0.9 + 0.1 * s) / s;
    byName.get('Head')!.scale.set(headK / w, headK, headK / w);
    this.root.matrixAutoUpdate = true;
    sharedUniforms.setupMaterial?.(this.material);
    if (!deferImported) this.loadImported();

    this.mixer = new THREE.AnimationMixer(this.mesh);
    const clips = getClips();
    const actions = {} as Record<ClipName, THREE.AnimationAction>;
    for (const name of Object.keys(CLIP_DEFS) as ClipName[]) {
      const g = clips.byName[name];
      const a = this.mixer.clipAction(g.clip);
      if (!g.def.loop) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      actions[name] = a;
    }
    this.actions = actions;
    actions.idle.play();
    this.prevAction = actions.idle;
    // random phase so a crowd is not in lockstep
    actions.idle.time = Math.random() * CLIP_DEFS.idle.duration;
    actions.walk.time = Math.random() * CLIP_DEFS.walk.duration;
  }

  /** Crowd instances only clone the GLB when they first enter the near LOD. */
  private loadImported(): void {
    if (this.importedAttempted) return;
    this.importedAttempted = true;
    this.imported = createImportedCharacter(this.appearance, this.palette, this.bones, this.sharedUniforms.uWetness, this.rim, this.sharedUniforms.uFill);
    // the imported head follows the same head-size rule as the procedural one
    const importedHead = this.imported?.retarget.mapped.get('Head');
    if (importedHead) importedHead.scale.copy(this.bones.get('Head')!.scale);
    if (this.imported) {
      this.root.add(this.imported.root);
      // Keep the driver skeleton updating (and its attachments visible), hide only its surface.
      this.mesh.material = hiddenBodyMaterial();
      { // The existing modular wardrobe fits the procedural driver; imported skin supplies head/hands.
        const key = bodyKey(this.appearance.body);
        let geometry = accessoryCache.get(key);
        if (!geometry) {
          geometry = this.geos.high.clone();
          const index = geometry.index!, region = geometry.getAttribute('region'), kept: number[] = [];
          for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
            // hems end on a clean garment ring: a triangle touching skin/hair/eyes would flat-shade half skin-coloured
            if (!BODY_REGIONS.has(region.getX(a)) && !BODY_REGIONS.has(region.getX(b)) && !BODY_REGIONS.has(region.getX(c))) kept.push(a, b, c);
          }
          geometry.setIndex(kept); accessoryCache.set(key, geometry);
        }
        this.accessories = new THREE.SkinnedMesh(geometry, this.material);
        this.accessories.bind(this.skeleton, this.mesh.bindMatrix);
        this.accessories.castShadow = true;
        this.root.add(this.accessories);
      }
    }

    this.imported?.root.traverse(o => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const material of Array.isArray(m) ? m : [m]) this.sharedUniforms.setupMaterial?.(material);
    });
  }

  /** switch the locomotion state with a crossfade */
  play(state: ClipName, fade = 0.2, restart = false): void {
    if (state === 'death' || state === 'drive' || (restart && state === 'idle')) this.fireAimLeft = 0;
    // slow walkers stroll (shorter stride, lower cadence) instead of playing the walk at 0.6x; hysteresis avoids flicker
    if (state === 'walk' || state === 'stroll') state = this.speed < (this.state === 'stroll' ? 1.5 : 1.38) ? 'stroll' : 'walk';
    if (state === this.state && !restart) return;
    const next = this.actions[state];
    const prev = this.prevAction;
    this.state = state;
    if (restart || !next.isRunning() || !CLIP_DEFS[state].loop) next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    if (prev && prev !== next) {
      next.crossFadeFrom(prev, fade, true);
    } else {
      next.fadeIn(fade);
    }
    next.play();
    this.prevAction = next;
    this.lastPhase = 0;
  }

  /** has a one-shot state finished (clamped at its end)? */
  finished(): boolean {
    const a = this.actions[this.state];
    const def = CLIP_DEFS[this.state];
    return !def.loop && a.time >= def.duration - 1e-3;
  }

  action(name: ActionName): void {
    this.actionTimers[name] = 0;
    if (name === 'fire' && this.weapon !== 'none') this.fireAimLeft = 1.4;
    if (name === 'hitReact') this.hitSide = Math.random() < 0.5 ? -1 : 1;
  }

  actionActive(name: ActionName): boolean {
    return this.actionTimers[name] >= 0;
  }

  setDetail(level: 'high' | 'low'): void {
    // The animation/GLB budget stays where the pedestrian manager put it, but geometry does not: anyone
    // inside NEAR_RIG_R keeps the good body whether or not they won a full-animation slot. Batched walkers
    // pay one extra draw call per body cut for it, not one per person.
    const near = this.nearViewer();
    if (level === this.detail && near === this.nearGeometry) return;
    this.detail = level;
    this.nearGeometry = near;
    this.mesh.geometry = level === 'high' || near ? this.geos.high : this.geos.low;
    this.syncVisual();
    if (this.protection) this.protection.geometry = this.accessories && this.rendersImported ? this.accessories.geometry : this.mesh.geometry;
  }

  private nearViewer(): boolean {
    if (Number.isNaN(viewPoint.x)) return false;
    const p = this.root.position, dx = p.x - viewPoint.x, dz = p.z - viewPoint.z;
    return dx * dx + dz * dz < NEAR_RIG_R * NEAR_RIG_R;
  }

  /** Detach inactive imported trees so distant/culled 65-joint rigs incur no scene matrix walk. */
  setVisible(visible: boolean): void { this.root.visible = visible; this.syncVisual(); }
  setImported(enabled: boolean): void { this.importedEnabled = enabled; this.syncVisual(); }
  get rendersImported(): boolean { return !!this.imported && this.importedEnabled && this.detail === 'high' && this.root.visible; }
  private syncVisual(): void {
    const high = this.importedEnabled && this.detail === 'high';
    if (high && this.root.visible) this.loadImported();
    if (!this.imported) return;
    if (high && this.root.visible) {
      if (!this.imported.root.parent) this.root.add(this.imported.root);
    } else this.imported.root.removeFromParent();
    this.mesh.material = high ? hiddenBodyMaterial() : this.material;
    if (this.accessories) this.accessories.visible = high;
    const hand = high ? this.imported.handSocket : this.bones.get('RightHand')!;
    this.syncWeaponAttachment();
    if (this.phoneMesh && this.phoneMesh.parent !== hand) hand.add(this.phoneMesh);
  }

  setShadows(on: boolean): void {
    this.mesh.castShadow = on;
    if (this.accessories) this.accessories.castShadow = on;
    this.imported?.shadows(on);
  }

  setProtected(on: boolean): void {
    if (on && !this.protection) {
      this.protectionMat = createProtectionMaterial(this.uTime);
      const m = new THREE.SkinnedMesh(this.accessories && this.rendersImported ? this.accessories.geometry : this.mesh.geometry, this.protectionMat);
      m.bind(this.skeleton, this.mesh.bindMatrix);
      m.frustumCulled = false;
      m.renderOrder = 5;
      m.name = 'protection';
      this.mesh.add(m);
      this.protection = m;
    } else if (!on && this.protection) {
      this.mesh.remove(this.protection);
      this.protectionMat?.dispose();
      this.protection = null;
      this.protectionMat = null;
    }
  }

  get protectionMaterial(): THREE.ShaderMaterial | null {
    return this.protectionMat;
  }

  setWeaponMesh(mesh: THREE.Object3D | null): void {
    if (this.weaponMesh && this.weaponMesh.parent) this.weaponMesh.parent.remove(this.weaponMesh);
    this.weaponMesh = mesh;
    if (!mesh) return;
    const ud = mesh.userData as { gripOffset?: THREE.Vector3; gripRotation?: THREE.Euler };
    // default grip: barrel along the fingers (-Y of the hand), grip toward the palm (+Z of the hand);
    // a weapon mesh authored with barrel -Z and grip -Y needs a -90° X rotation.
    if (ud.gripRotation) mesh.rotation.copy(ud.gripRotation);
    else mesh.rotation.set(-Math.PI / 2, 0, 0);
    if (ud.gripOffset) mesh.position.copy(ud.gripOffset);
    else mesh.position.set(0.0, -0.075, 0.02);
    // undo the root scale so weapons keep their authored size
    const s = RIG_HEIGHT / this.appearance.height;
    mesh.scale.setScalar(s);
    this.syncWeaponAttachment();
  }

  /** Follow the imported hand's position but retain the procedural grip-axis contract.
   * The imported socket's bind-time world correction can include a posed arm/yaw;
   * copying it once leaves long guns rolled, undersized or buried in the wrist.
   */
  private syncWeaponAttachment(): void {
    if (!this.weaponMesh) return;
    const driver = this.bones.get('RightHand')!;
    const hand = this.rendersImported ? this.imported!.retarget.mapped.get('RightHand') ?? driver : driver;
    this.weaponSocket.name = 'weapon-hand-socket';
    if (this.weaponSocket.parent !== hand) hand.add(this.weaponSocket);
    hand.getWorldQuaternion(this.weaponParentQ).invert();
    driver.getWorldQuaternion(this.weaponDriverQ);
    this.weaponSocket.quaternion.copy(this.weaponParentQ).multiply(this.weaponDriverQ);
    hand.getWorldScale(this.weaponParentScale);
    this.root.getWorldScale(this.weaponRootScale);
    this.weaponSocket.scale.copy(this.weaponRootScale).divide(this.weaponParentScale);
    if (this.weaponMesh.parent !== this.weaponSocket) this.weaponSocket.add(this.weaponMesh);
  }

  get weaponObject(): THREE.Object3D | null {
    return this.weaponMesh;
  }

  /**
   * @param dt seconds
   * @param full run all procedural layers; false = sampled mixer, seating and head yaw only
   */
  update(dt: number, full: boolean): void {
    // An unarmed civilian (or a player who holstered) cannot retain a shot hold
    // and reactivate it by equipping again before the old timer expires.
    this.fireAimLeft = this.weapon === 'none' || this.state === 'death' || this.state === 'drive'
      ? 0 : Math.max(0, this.fireAimLeft - dt);
    if (!full) {
      this.liteAcc += dt;
      // Time-based sampling: every-third-frame fell to 5–10 Hz on busy streets.
      const steps = Math.floor((this.liteAcc + 1e-8) / 0.05);
      if (!steps) return;
      dt = steps * 0.05;
      this.liteAcc = Math.max(0, this.liteAcc - dt);
    } else {
      dt += this.liteAcc;
      this.liteAcc = 0;
    }
    // speed matching
    const def = CLIP_DEFS[this.state];
    const act = this.actions[this.state];
    if (def.speed > 0) {
      const ts = THREE.MathUtils.clamp(this.speed / def.speed, 0.55, 1.7);
      act.setEffectiveTimeScale(ts);
    }
    // The mixer only writes a bone when its blended value changed since the last frame (PropertyMixer.apply), so a
    // constant track (idle Neck, drive spine, crouch head) would keep whatever the procedural layers multiplied in
    // last frame and the rotations would accumulate (heads folding into torsos, arms winding up while aiming).
    // Restore the pure mixer output first, then let the mixer overwrite what moved, then save it again.
    const bones = this.skeleton.bones, base = this.basePose;
    if (this.basePoseValid) for (let i = 0; i < bones.length; i++) bones[i].quaternion.fromArray(base, i * 4);
    this.mixer.update(dt);
    for (let i = 0; i < bones.length; i++) bones[i].quaternion.toArray(base, i * 4);
    this.basePoseValid = true;
    this.poseVersion++;

    // Run before the lite-LOD return: every batched sitter must keep bent knees,
    // planted shoes and its own lean, not just the handful of near GLB rigs.
    if (this.seating && this.state === 'sit') {
      const { height, weight: w, lean } = this.seating;
      for (const b of bones) b.quaternion.slerp(this.tmpQ.identity(), 1 - w);
      this.rotX(this.bones.get('Spine')!, lean * DEG * w);
      this.rotX(this.bones.get('Spine1')!, lean * 0.4 * DEG * w);
      // Two-link sagittal IK. The ankle remains above the ground while the hips
      // rise and move forward off the chair; account for the shin's bind Z offset.
      const hipY = 0.965 + (height + 0.075 - 0.955) * w;
      const forward = 0.45 / this.root.scale.z - 0.4 / this.root.scale.z * (1 - w) + 0.03;
      const down = hipY - 0.09, thigh = 0.415, shin = Math.hypot(0.46, 0.045);
      const d = THREE.MathUtils.clamp(Math.hypot(forward, down), 0.05, thigh + shin - 0.001);
      const hip = Math.atan2(forward, down) + Math.acos(THREE.MathUtils.clamp((thigh * thigh + d * d - shin * shin) / (2 * thigh * d), -1, 1));
      const knee = -Math.acos(THREE.MathUtils.clamp((d * d - thigh * thigh - shin * shin) / (2 * thigh * shin), -1, 1)) + Math.atan2(0.045, 0.46);
      for (const side of ['Left', 'Right']) {
        this.bones.get(side + 'UpLeg')!.quaternion.setFromEuler(this.tmpE.set(hip, 0, 0));
        this.bones.get(side + 'Leg')!.quaternion.setFromEuler(this.tmpE.set(knee, 0, 0));
        this.bones.get(side + 'Foot')!.quaternion.setFromEuler(this.tmpE.set(-hip - knee, 0, 0));
      }
    }

    // footsteps from gait phase
    if ('footfalls' in def && this.onFootstep && full) {
      const phase = (act.time % def.duration) / def.duration;
      const [lf, rf] = def.footfalls;
      if (crossed(this.lastPhase, phase, lf)) this.onFootstep('left');
      if (crossed(this.lastPhase, phase, rf)) this.onFootstep('right');
      this.lastPhase = phase;
    }

    if (!full) {
      // Mid crowd LOD: preserve conversational turns without spine/neck/pitch work.
      // This is after base-pose restoration, so a constant head track cannot accumulate yaw.
      const k = 1 - Math.exp(-dt * 6);
      this.lookWeightS += (this.lookWeight - this.lookWeightS) * k;
      this.lookYawS += (THREE.MathUtils.clamp(this.lookYaw, -1.1, 1.1) - this.lookYawS) * k;
      if (this.lookWeightS > 0.002) this.rotY(this.bones.get('Head')!, this.lookYawS * this.lookWeightS);
      return;
    }

    // ---- aim layer ----
    const k = 1 - Math.exp(-dt * 12);
    const aimTarget = this.state === 'death' || this.state === 'drive' ? 0
      : Math.max(this.aimTarget, this.weapon !== 'none' && this.fireAimLeft > 0 ? 1 : 0);
    this.aimBlend += (aimTarget - this.aimBlend) * k;
    this.aimPitchSmooth += (this.aimPitch - this.aimPitchSmooth) * (1 - Math.exp(-dt * 18));
    if (this.aimBlend > 0.002) {
      const pose = poseQuats(AIM_POSES[this.weapon]);
      for (const name of AIM_ARM_BONES) {
        const q = pose.get(name);
        if (!q) continue;
        this.bones.get(name)!.quaternion.slerp(q, this.aimBlend);
      }
      for (const name of AIM_SPINE_BONES) {
        const q = pose.get(name);
        if (!q) continue;
        const b = this.bones.get(name)!;
        // additive on the spine so the walk motion stays underneath
        this.tmpQ.copy(b.quaternion).slerp(this.tmpQ2.copy(b.quaternion).multiply(q), this.aimBlend);
        b.quaternion.copy(this.tmpQ);
      }
      // pitch: bend the upper spine so the arms follow the camera
      const pitch = this.aimPitchSmooth * this.aimBlend;
      this.rotX(this.bones.get('Spine1')!, pitch * 0.35);
      this.rotX(this.bones.get('Spine2')!, pitch * 0.65);
      this.rotX(this.bones.get('Head')!, -pitch * 0.35);
    }

    // ---- action overlays ----
    const T = this.actionTimers;
    for (const name of Object.keys(T) as ActionName[]) {
      if (T[name] < 0) continue;
      T[name] += dt;
      const t = T[name];
      switch (name) {
        case 'fire': {
          const d = this.weapon === 'rifle' ? 0.1 : 0.14;
          if (t > d) {
            T[name] = -1;
            break;
          }
          const kck = Math.sin((t / d) * Math.PI);
          const two = this.weapon !== 'none';
          this.rotX(this.bones.get('RightArm')!, -7 * DEG * kck);
          this.rotX(this.bones.get('RightForeArm')!, 9 * DEG * kck);
          if (two) {
            this.rotX(this.bones.get('LeftArm')!, -5 * DEG * kck);
            this.rotX(this.bones.get('LeftForeArm')!, 6 * DEG * kck);
          }
          this.rotX(this.bones.get('Spine2')!, 1.8 * DEG * kck);
          this.rotX(this.bones.get('Head')!, 2 * DEG * kck);
          break;
        }
        case 'reload': {
          const d = 1.4;
          if (t > d) {
            T[name] = -1;
            break;
          }
          const w = THREE.MathUtils.smoothstep(t, 0, 0.25) * (1 - THREE.MathUtils.smoothstep(t, d - 0.3, d));
          // left hand drops toward the hip (magazine) and comes back; a small tilt of the gun
          const l = this.bones.get('LeftArm')!;
          const lf = this.bones.get('LeftForeArm')!;
          this.rotX(l, -55 * DEG * w);
          this.rotZ(l, -20 * DEG * w);
          this.rotX(lf, 30 * DEG * w);
          this.rotZ(this.bones.get('RightForeArm')!, 25 * DEG * w);
          this.rotZ(this.bones.get('RightArm')!, 8 * DEG * w);
          const slap = Math.max(0, Math.sin(((t - 0.9) / 0.2) * Math.PI)) * (t > 0.9 && t < 1.1 ? 1 : 0);
          this.rotX(lf, -10 * DEG * slap);
          this.rotX(this.bones.get('Head')!, -12 * DEG * w);
          break;
        }
        case 'punch': {
          const d = 0.45;
          if (t > d) {
            T[name] = -1;
            break;
          }
          const u = t / d;
          const ext = Math.sin(u * Math.PI); // 0..1..0
          const wind = Math.max(0, Math.sin(u * Math.PI * 2)) * (u < 0.5 ? 1 : 0);
          const ra = this.bones.get('RightArm')!;
          const rf = this.bones.get('RightForeArm')!;
          this.rotX(ra, (85 * ext - 10 * wind) * DEG);
          this.rotZ(ra, -22 * ext * DEG);
          this.rotX(rf, (95 * (1 - ext) * 0.6 + 10) * DEG);
          this.rotY(this.bones.get('Spine2')!, -22 * ext * DEG);
          this.rotY(this.bones.get('Spine1')!, -10 * ext * DEG);
          this.rotX(this.bones.get('LeftArm')!, 30 * ext * DEG);
          this.rotX(this.bones.get('LeftForeArm')!, 90 * ext * DEG);
          this.rotZ(this.bones.get('LeftArm')!, 15 * ext * DEG);
          break;
        }
        case 'hitReact': {
          const d = 0.38;
          if (t > d) {
            T[name] = -1;
            break;
          }
          const u = Math.sin((t / d) * Math.PI);
          this.rotX(this.bones.get('Spine1')!, 6 * DEG * u);
          this.rotX(this.bones.get('Spine2')!, 10 * DEG * u);
          this.rotZ(this.bones.get('Spine2')!, this.hitSide * 8 * DEG * u);
          this.rotX(this.bones.get('Head')!, 18 * DEG * u);
          this.rotY(this.bones.get('Head')!, this.hitSide * 14 * DEG * u);
          this.rotZ(this.bones.get('LeftArm')!, -20 * DEG * u);
          this.rotZ(this.bones.get('RightArm')!, 20 * DEG * u);
          break;
        }
      }
    }

    // ---- head look ----
    const kl = 1 - Math.exp(-dt * 6);
    this.lookWeightS += (this.lookWeight - this.lookWeightS) * kl;
    this.lookYawS += (THREE.MathUtils.clamp(this.lookYaw, -1.1, 1.1) - this.lookYawS) * kl;
    this.lookPitchS += (THREE.MathUtils.clamp(this.lookPitch, -0.6, 0.5) - this.lookPitchS) * kl;
    if (this.lookWeightS > 0.002) {
      const w = this.lookWeightS * (1 - this.aimBlend * 0.7);
      const yaw = this.lookYawS * w, pitch = this.lookPitchS * w;
      this.rotY(this.bones.get('Spine2')!, yaw * 0.15);
      this.rotY(this.bones.get('Neck')!, yaw * 0.35);
      this.rotY(this.bones.get('Head')!, yaw * 0.5);
      this.rotX(this.bones.get('Neck')!, pitch * 0.4);
      this.rotX(this.bones.get('Head')!, pitch * 0.6);
    }

    // ---- carried object ----
    // Runs before the mannerism so that a stander who folds their arms or pockets their hands still does,
    // and the cup or bag simply follows the hand it is welded to.
    const carry = this.appearance.body.carry;
    if (carry && CARRY_POSES[carry] && !this.seating) {
      for (const [name, q] of poseQuats(CARRY_POSES[carry])) this.bones.get(name)!.quaternion.copy(q);
    }

    // ---- mannerism ----
    if (this.mannerism !== 'none') this.mannerismActive = this.mannerism;
    // Phone standers can retain their walking bag/crossed-arm mannerism. Blend
    // it out on BOTH arms, otherwise the free hand stays raised beside the face.
    const mTarget = this.mannerism === 'none' || this.phone > 0 ? 0 : 1;
    this.mannerismS += (mTarget - this.mannerismS) * (1 - Math.exp(-dt * 4));
    if (this.mannerismS > 0.002 && this.mannerismActive && !this.seating) {
      const pose = poseQuats(MANNERISM_POSES[this.mannerismActive]);
      for (const [name, q] of pose) {
        const b = this.bones.get(name)!;
        if (ADDITIVE_BONES.has(name)) this.tmpQ.copy(b.quaternion).slerp(this.tmpQ2.copy(b.quaternion).multiply(q), this.mannerismS);
        else this.tmpQ.copy(b.quaternion).slerp(q, this.mannerismS);
        b.quaternion.copy(this.tmpQ);
      }
    }

    // ---- phone ----
    this.phoneS += (this.phone - this.phoneS) * (1 - Math.exp(-dt * 4));
    if (this.phoneS > 0.5) {
      if (!this.phoneMesh) {
        const { geo, mat } = phoneAssets();
        const m = new THREE.Mesh(geo, mat);
        m.name = 'phone';
        m.position.set(-0.012, -0.1, 0.005);
        (this.imported && this.detail === 'high' ? this.imported.handSocket : this.bones.get('RightHand')!).add(m);
        this.phoneMesh = m;
      }
      this.phoneMesh.visible = true;
    } else if (this.phoneMesh) this.phoneMesh.visible = false;
    if (this.phoneS > 0.002 && !this.seating) {
      const pose = poseQuats(PHONE_POSE);
      for (const [name, q] of pose) {
        const b = this.bones.get(name)!;
        if (name === 'Neck' || name === 'Head' || name === 'Spine2') this.tmpQ.copy(b.quaternion).slerp(this.tmpQ2.copy(b.quaternion).multiply(q), this.phoneS);
        else this.tmpQ.copy(b.quaternion).slerp(q, this.phoneS);
        b.quaternion.copy(this.tmpQ);
      }
    }
    if (this.detail === 'high' && this.importedEnabled && this.imported) {
      // hands: relaxed curl by default, loose fists when running, a grip on the weapon / phone side, a looser support hand on long guns
      const grip = this.weapon !== 'none' ? 1.15 : 0;
      const runCurl = THREE.MathUtils.clamp((this.speed - 2.6) / 3.4, 0, 1) * 0.6;
      const right = Math.max(0.32, runCurl, grip * Math.max(this.aimBlend, 0.6), this.phoneS * 0.95, this.appearance.body.carry === 'coffee' ? 0.95 : this.appearance.body.carry === 'umbrella' ? 1.15 : 0);
      const held = this.appearance.body.carry;
      const left = Math.max(0.32, runCurl, this.weapon !== 'none' && this.aimBlend > 0.1 ? 0.85 * this.aimBlend : 0, this.mannerismActive === 'bagHold' ? 0.9 * this.mannerismS : 0, held === 'tote' || held === 'shopping' ? 1.05 : 0);
      this.imported.retarget.setCurl(left, right);
      this.imported.update();
      this.syncWeaponAttachment();
    }
  }

  private rotX(b: THREE.Bone, rad: number): void {
    if (rad === 0) return;
    this.tmpE.set(rad, 0, 0);
    b.quaternion.multiply(this.tmpQ2.setFromEuler(this.tmpE));
  }
  private rotY(b: THREE.Bone, rad: number): void {
    if (rad === 0) return;
    this.tmpE.set(0, rad, 0);
    b.quaternion.multiply(this.tmpQ2.setFromEuler(this.tmpE));
  }
  private rotZ(b: THREE.Bone, rad: number): void {
    if (rad === 0) return;
    this.tmpE.set(0, 0, rad);
    b.quaternion.multiply(this.tmpQ2.setFromEuler(this.tmpE));
  }

  /** world position of a bone (root matrices must be current) */
  bonePosition(name: string, out: THREE.Vector3): THREE.Vector3 {
    const b = this.imported && this.detail === 'high' ? this.imported.retarget.mapped.get(name) ?? this.bones.get(name) : this.bones.get(name);
    if (!b) return out.set(0, 0, 0);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mesh);
    this.setProtected(false);
    if (this.weaponMesh?.parent) this.weaponMesh.parent.remove(this.weaponMesh);
    this.phoneMesh?.removeFromParent();
    this.material.dispose();
    this.skeleton.dispose();
    this.imported?.dispose();
    releaseGeometry(this.appearance.body);
    this.root.removeFromParent();
  }
}

function crossed(prev: number, cur: number, mark: number): boolean {
  if (cur >= prev) return prev < mark && cur >= mark;
  // wrapped
  return prev < mark || cur >= mark;
}

export const BONE_NAMES = BONES.map((b) => b.name);
