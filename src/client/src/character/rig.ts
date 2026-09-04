/**
 * Humanoid rig: a fixed skeleton (22 bones, bind pose = relaxed standing, every bone's local axes aligned
 * with the model axes so procedural rotations are intuitive: +X = flexion/forward swing, +Y = twist,
 * +Z = abduction) and a procedural skinned body built by lofting cross-sections along the limbs.
 *
 * Model space: character faces -Z, right hand at +X, up +Y, feet at y = 0, 1.80 m tall.
 * Height variation is done by scaling the instance root so every rig shares the same clips.
 *
 * Regions (vertex attribute `region`, flat-interpolated) select a per-instance palette entry:
 *   0 skin, 1 shirt, 2 pants, 3 shoes, 4 hair, 5 eyes, 6 accent (belt), 7 sole, 8 jacket (outer layer),
 *   9 bag (shoulder bag / backpack + straps), 10 hat (cap)
 */
import * as THREE from 'three';

export const REGION = {
  skin: 0, shirt: 1, pants: 2, shoes: 3, hair: 4, eye: 5, accent: 6, sole: 7, jacket: 8, bag: 9, hat: 10, glasses: 11, sock: 12, watch: 13,
  /** hair *volume* (afro / bob / ponytail shells): not a BODY_REGION, so it survives onto the near-LOD wardrobe mesh */
  hairvol: 14,
  /** safety yellow-green: hi-vis vest, with retroreflective bands drawn in the shader */
  hivis: 15,
  /** carried objects: coffee cup, umbrella canopy, camera body, shopping bag, insulated delivery box */
  prop: 16,
  /** necktie */
  tie: 17,
} as const;
/** palette slots (vec4 per region: rgb + roughness) */
export const REGION_COUNT = 18;
/** regions that belong to the person, not the wardrobe (imported skin/hair/eyes replace them at the near LOD) */
export const BODY_REGIONS: ReadonlySet<number> = new Set([REGION.skin, REGION.hair, REGION.eye]);

export interface BoneDef {
  name: string;
  parent: string | null;
  /** model-space position at bind */
  pos: [number, number, number];
}

/**
 * Bind-pose joint positions for a 1.80 m adult. They follow the imported Quaternius bases (measured after the
 * 1.8 m normalisation: shoulder 1.449, elbow 1.204, wrist 0.957, hip 0.965, knee 0.55, ankle 0.09, neck 1.514,
 * head 1.588) so the wardrobe lofted on this skeleton and the imported skin rotate about the same pivots.
 */
export const BONES: BoneDef[] = [
  { name: 'Hips', parent: null, pos: [0, 0.955, 0.02] },
  { name: 'Spine', parent: 'Hips', pos: [0, 1.07, 0.01] },
  { name: 'Spine1', parent: 'Spine', pos: [0, 1.19, 0.0] },
  { name: 'Spine2', parent: 'Spine1', pos: [0, 1.32, 0.0] },
  { name: 'Neck', parent: 'Spine2', pos: [0, 1.514, 0.04] },
  { name: 'Head', parent: 'Neck', pos: [0, 1.588, 0.015] },
  { name: 'HeadTop', parent: 'Head', pos: [0, 1.8, 0.0] },
  { name: 'LeftShoulder', parent: 'Spine2', pos: [-0.03, 1.48, -0.02] },
  { name: 'LeftArm', parent: 'LeftShoulder', pos: [-0.185, 1.449, 0.03] },
  { name: 'LeftForeArm', parent: 'LeftArm', pos: [-0.215, 1.204, 0.035] },
  { name: 'LeftHand', parent: 'LeftForeArm', pos: [-0.235, 0.957, 0.03] },
  { name: 'LeftHandEnd', parent: 'LeftHand', pos: [-0.245, 0.77, 0.02] },
  { name: 'RightShoulder', parent: 'Spine2', pos: [0.03, 1.48, -0.02] },
  { name: 'RightArm', parent: 'RightShoulder', pos: [0.185, 1.449, 0.03] },
  { name: 'RightForeArm', parent: 'RightArm', pos: [0.215, 1.204, 0.035] },
  { name: 'RightHand', parent: 'RightForeArm', pos: [0.235, 0.957, 0.03] },
  { name: 'RightHandEnd', parent: 'RightHand', pos: [0.245, 0.77, 0.02] },
  { name: 'LeftUpLeg', parent: 'Hips', pos: [-0.11, 0.965, 0.03] },
  { name: 'LeftLeg', parent: 'LeftUpLeg', pos: [-0.11, 0.55, 0.03] },
  { name: 'LeftFoot', parent: 'LeftLeg', pos: [-0.11, 0.09, 0.075] },
  { name: 'LeftToeBase', parent: 'LeftFoot', pos: [-0.11, 0.024, -0.06] },
  { name: 'RightUpLeg', parent: 'Hips', pos: [0.11, 0.965, 0.03] },
  { name: 'RightLeg', parent: 'RightUpLeg', pos: [0.11, 0.55, 0.03] },
  { name: 'RightFoot', parent: 'RightLeg', pos: [0.11, 0.09, 0.075] },
  { name: 'RightToeBase', parent: 'RightFoot', pos: [0.11, 0.024, -0.06] },
];

/** Shoulder joint lateral offset: the imported male base is 0.21 m half-span, the female 0.155 m. */
export function shoulderX(p?: Partial<BodyParams>): number {
  return (p?.hips ?? 1) > 1.05 ? 0.156 : 0.208;
}
/** Per-instance bind positions: the shared skeleton with the arm chain moved to the body's shoulder width. */
export function bonePositions(p?: Partial<BodyParams>): [number, number, number][] {
  const sx = shoulderX(p);
  return BONES.map((b) => {
    const [x, y, z] = b.pos;
    if (/^(Left|Right)(Arm|ForeArm|Hand|HandEnd)$/.test(b.name)) return [Math.sign(x) * (sx + Math.abs(x) - 0.185), y, z];
    return [x, y, z];
  });
}

export const BONE_INDEX: Record<string, number> = {};
BONES.forEach((b, i) => (BONE_INDEX[b.name] = i));
export const RIG_HEIGHT = 1.8;

/** which bones the procedural upper-body layer touches */
export const UPPER_BONES = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'];

export interface BodyParams {
  /** 0 slim .. 1 heavy */
  build: number;
  /** shoulder width multiplier (1 = male average, ~0.9 female) */
  shoulders: number;
  /** hip width multiplier (1 = male average, ~1.12 female) */
  hips: number;
  /** chest depth (bust) multiplier */
  chest: number;
  sleeves: 'short' | 'long' | 'none';
  /** long trousers, shorts, or a skirt / dress hem at the knee (the legs then wear tights or bare skin) */
  legs: 'long' | 'short' | 'skirt' | 'dress';
  hair: 'short' | 'bald' | 'long' | 'bun' | 'cap' | 'afro' | 'bob' | 'ponytail' | 'fade';
  /**
   * Outer layer over the shirt.
   *  open      soft jacket with the shirt showing in a V down the front
   *  zip       zipped shell
   *  hoodie    zipped shell + a hood bulge behind the neck
   *  puffer    thick quilted down coat: 4 cm of loft and a collar up the neck
   *  overcoat  wool topcoat: lapels and a skirt falling to the knee
   *  blazer    tailored jacket with notch lapels (usually over a tie)
   *  vest      sleeveless hi-vis over the shirt (construction / delivery)
   */
  jacket: false | 'open' | 'zip' | 'hoodie' | 'puffer' | 'overcoat' | 'blazer' | 'vest';
  /** headwear built as geometry over whatever hair is chosen */
  headwear?: 'beanie' | 'hardhat' | 'peaked' | 'hijab';
  /** necktie down the front of the shirt (needs an open outer layer to read) */
  tie?: boolean;
  /** something in a hand or on the body: changes the arm pose in the animator as well as the geometry */
  carry?: 'tote' | 'shopping' | 'coffee' | 'umbrella' | 'camera' | 'delivery';
  /** wired earbuds */
  earbuds?: boolean;
  /** facial hair on the near mesh (imported beard module) */
  beard?: boolean;
  /** shoulder bag: strap across the chest + the bag at the right hip (bag region) */
  bag: boolean;
  /** backpack on the spine with two straps over the shoulders (bag region) */
  backpack: boolean;
  /** sunglasses across the eyes (glasses region) */
  glasses?: boolean;
  /** over-ear headphones: band over the crown + two cups (glasses region) */
  headphones?: boolean;
  /** wristwatch on the left wrist (accent strap + watch case) */
  watch?: boolean;
}

export const DEFAULT_BODY: BodyParams = { build: 0.35, shoulders: 1, hips: 1, chest: 1, sleeves: 'long', legs: 'long', hair: 'short', jacket: false, bag: false, backpack: false, glasses: false, headphones: false };

/** the skeleton as THREE.Bone objects (fresh per instance; arm chain at the body's shoulder width) */
export function createBones(p?: Partial<BodyParams>): { root: THREE.Bone; bones: THREE.Bone[]; byName: Map<string, THREE.Bone> } {
  const bones: THREE.Bone[] = [];
  const byName = new Map<string, THREE.Bone>();
  const pos = bonePositions(p);
  BONES.forEach((def, i) => {
    const b = new THREE.Bone();
    b.name = def.name;
    const par = def.parent ? pos[BONE_INDEX[def.parent]] : [0, 0, 0];
    b.position.set(pos[i][0] - par[0], pos[i][1] - par[1], pos[i][2] - par[2]);
    bones.push(b);
    byName.set(def.name, b);
    if (def.parent) byName.get(def.parent)!.add(b);
  });
  return { root: bones[0], bones, byName };
}

// ------------------------------------------------------------------------------------------------
// geometry builder
// ------------------------------------------------------------------------------------------------

interface Weights {
  /** up to 4 (boneIndex, weight) */
  idx: [number, number, number, number];
  w: [number, number, number, number];
}

class Builder {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  reg: number[] = [];
  sidx: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  vcount = 0;

  addVertex(x: number, y: number, z: number, u: number, v: number, region: number, w: Weights): number {
    this.pos.push(x, y, z);
    this.nrm.push(0, 0, 0);
    this.uv.push(u, v);
    this.reg.push(region);
    this.sidx.push(w.idx[0], w.idx[1], w.idx[2], w.idx[3]);
    this.sw.push(w.w[0], w.w[1], w.w[2], w.w[3]);
    return this.vcount++;
  }

  /** a ring of n vertices; returns the first index. Cross-section in the plane perpendicular to `axis` ('y' or 'z'). */
  ring(cx: number, cy: number, cz: number, rx: number, ry: number, n: number, v: number, region: number, w: Weights, axis: 'y' | 'z' | 'x' = 'y', shape = 2.0, opts?: { flatBack?: number; flatFront?: number; yaw?: number; regionOf?: (i: number) => number; weightOf?: (i: number) => Weights }): number {
    const first = this.vcount;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // superellipse: |cos|^(2/shape) sign
      const c = Math.cos(a), s = Math.sin(a);
      let ex = Math.sign(c) * Math.pow(Math.abs(c), 2 / shape);
      let ey = Math.sign(s) * Math.pow(Math.abs(s), 2 / shape);
      if (opts?.flatBack !== undefined && ey > opts.flatBack) ey = opts.flatBack + (ey - opts.flatBack) * 0.35;
      if (opts?.flatFront !== undefined && ey < -opts.flatFront) ey = -opts.flatFront + (ey + opts.flatFront) * 0.35;
      let x: number, y: number, z: number;
      if (axis === 'y') {
        // ring in x/z plane; +z toward the back
        x = cx + ex * rx;
        y = cy;
        z = cz + ey * ry;
      } else if (axis === 'z') {
        // ring in x/y plane (feet): ex across, ey up
        x = cx + ex * rx;
        y = cy + ey * ry;
        z = cz;
      } else {
        // ring in the z/y plane (ear cups): ex along z, ey up
        x = cx;
        y = cy + ey * ry;
        z = cz + ex * rx;
      }
      this.addVertex(x, y, z, i / n, v, opts?.regionOf ? opts.regionOf(i) : region, opts?.weightOf ? opts.weightOf(i) : w);
    }
    return first;
  }

  /** connect two rings of the same vertex count with quads (a -> b) */
  bridge(a: number, b: number, n: number, flip = this.pos[b * 3 + 1] < this.pos[a * 3 + 1]): void {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a0 = a + i, a1 = a + j, b0 = b + i, b1 = b + j;
      if (!flip) this.idx.push(a0, b0, b1, a0, b1, a1);
      else this.idx.push(a0, b1, b0, a0, a1, b1);
    }
  }

  /** close a ring with a fan to a center vertex */
  cap(ring: number, n: number, cx: number, cy: number, cz: number, region: number, w: Weights, up: boolean, v: number): void {
    const c = this.addVertex(cx, cy, cz, 0.5, v, region, w);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (up) this.idx.push(c, ring + j, ring + i);
      else this.idx.push(c, ring + i, ring + j);
    }
  }

  /** a quad strip through rows of (left xyz, right xyz) pairs, wound so the faces point along `outward` */
  strip(rows: [number, number, number, number, number, number][], region: number, ws: Weights[], outwardHint: [number, number, number] | ((i: number) => [number, number, number]), vBase = 0): void {
    let last = -1;
    for (let i = 0; i < rows.length; i++) {
      const [x0, y0, z0, x1, y1, z1] = rows[i];
      const a = this.addVertex(x0, y0, z0, 0, vBase + i / (rows.length - 1), region, ws[i]);
      this.addVertex(x1, y1, z1, 1, vBase + i / (rows.length - 1), region, ws[i]);
      if (last >= 0) {
        const lx = this.pos[last * 3], ly = this.pos[last * 3 + 1], lz = this.pos[last * 3 + 2];
        const e1x = x0 - lx, e1y = y0 - ly, e1z = z0 - lz;
        const e2x = x1 - lx, e2y = y1 - ly, e2z = z1 - lz;
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const outward = typeof outwardHint === 'function' ? outwardHint(i) : outwardHint;
        const flip = nx * outward[0] + ny * outward[1] + nz * outward[2] < 0;
        if (!flip) this.idx.push(last, a, a + 1, last, a + 1, last + 1);
        else this.idx.push(last, a + 1, a, last, last + 1, a + 1);
      }
      last = a;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('region', new THREE.Float32BufferAttribute(this.reg, 1));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.sidx, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function W(a: string, wa = 1, b?: string, wb = 0, c?: string, wc = 0): Weights {
  const sum = wa + wb + wc || 1;
  return { idx: [BONE_INDEX[a], b ? BONE_INDEX[b] : 0, c ? BONE_INDEX[c] : 0, 0], w: [wa / sum, wb / sum, wc / sum, 0] };
}

/** weight blend between two bones along a limb: t in [0,1], blend zone around tJoint */
function blend(a: string, b: string, t: number, tJoint: number, zone: number): Weights {
  const k = THREE.MathUtils.smoothstep(t, tJoint - zone, tJoint + zone);
  return W(a, 1 - k, b, k);
}

const DEG_R = Math.PI / 180;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Catmull-Rom-ish smooth interpolation through (t, value) keys */
export function curve(keys: [number, number][], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[keys.length - 1][0]) return keys[keys.length - 1][1];
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
  const u = (t - t0) / (t1 - t0);
  const s = u * u * (3 - 2 * u);
  return lerp(v0, v1, s);
}

export interface BodyGeometry {
  geometry: THREE.BufferGeometry;
  params: BodyParams;
  detail: 'high' | 'low';
}

/**
 * Build the body. `detail` 'high' ~ 6k tris, 'low' ~ 1.6k tris (for the 60-150 m LOD).
 */
export function buildBody(params: Partial<BodyParams> = {}, detail: 'high' | 'low' = 'high'): BodyGeometry {
  const P: BodyParams = { ...DEFAULT_BODY, ...params };
  const b = new Builder();
  const hi = detail === 'high';
  const N = hi ? 24 : 12; // torso ring segments
  const NL = hi ? 16 : 8; // limb ring segments
  const NH = hi ? 28 : 14; // head ring segments
  const fat = P.build; // 0..1
  const cloth = 0.012; // cloth thickness added to body radius
  const J = P.jacket;
  const vest = J === 'vest';       // sleeveless: built as its own shell over an ordinary shirt torso
  const puffer = J === 'puffer';
  const overcoat = J === 'overcoat';
  const blazer = J === 'blazer';
  /** the outer layer replaces the shirt over the torso (everything except the hi-vis vest) */
  const bodyOuter = !!J && !vest;
  /** loft added by the outer layer: a shell is 1.3 cm, a topcoat 2.4, a down jacket 4.2 (that is the whole silhouette) */
  const jacket = puffer ? 0.042 : overcoat ? 0.024 : bodyOuter ? 0.013 : 0;
  const skirted = P.legs === 'skirt' || P.legs === 'dress';

  // ---- torso (Hips -> Neck), rings perpendicular to Y ---------------------------------------
  interface TR { y: number; rx: number; rz: number; region: number; w: Weights; shape?: number; cz?: number; flatBack?: number; vopen?: number; /** close the ring with a disc (the neck passes through it; hides the garment interior seen from above) */ capTop?: boolean }
  const hipW = 0.175 * P.hips * (1 + 0.35 * fat);
  const waistW = 0.15 * (1 + 0.55 * fat) * (P.hips > 1.05 ? 0.88 : 1);
  const chestW = 0.178 * P.shoulders * (1 + 0.3 * fat);
  const chestD = 0.12 * P.chest * (1 + 0.5 * fat);
  // the garment's shoulder follows the body's shoulder joint (deltoid 2.4 cm outside it), not a fixed male span
  const shoulderW = (shoulderX(P) + 0.024) * (1 + 0.15 * fat);
  const belt = 1.02;
  const outer = bodyOuter ? REGION.jacket : REGION.shirt;
  // an unbuttoned front: the shirt (and a tie) shows in a V. Topcoats and blazers hang open like a soft jacket.
  const open = J === 'open' || blazer || overcoat;
  const hipRz = 0.12 * (1 + 0.5 * fat);
  const lower: TR[] = [
    { y: 0.83, rx: hipW * 0.94, rz: 0.115 * (1 + 0.4 * fat), region: REGION.pants, w: W('Hips', 0.55, 'LeftUpLeg', 0.225, 'RightUpLeg', 0.225), shape: 2.4 },
    { y: 0.9, rx: hipW + cloth, rz: 0.125 * (1 + 0.45 * fat) + cloth, region: REGION.pants, w: W('Hips', 0.8, 'LeftUpLeg', 0.1, 'RightUpLeg', 0.1), shape: 2.4, cz: 0.01 },
    { y: 0.97, rx: hipW * 0.99 + cloth, rz: hipRz + cloth, region: REGION.pants, w: W('Hips'), shape: 2.4, cz: 0.01 },
  ];
  const mid: TR[] = bodyOuter
    ? [
        // jacket hem: steps out over the pants just below the belt line, then hangs straight up to the waist
        { y: 0.975, rx: hipW * 0.99 + cloth + jacket + 0.009, rz: hipRz + cloth + jacket + 0.009, region: outer, w: W('Hips'), shape: 2.2, cz: 0.01, vopen: open ? 0.05 : 0 },
        { y: 1.01, rx: hipW * 0.99 + cloth + jacket + 0.007, rz: hipRz + cloth + jacket + 0.007, region: outer, w: W('Hips', 0.75, 'Spine', 0.25), shape: 2.2, cz: 0.01, vopen: open ? 0.05 : 0 },
        { y: 1.05, rx: waistW * 1.06 + cloth + jacket + 0.005, rz: 0.11 * (1 + 0.6 * fat) + cloth + jacket + 0.005, region: outer, w: W('Hips', 0.4, 'Spine', 0.6), shape: 2.2, cz: 0.006, vopen: open ? 0.05 : 0 },
      ]
    : [
        { y: belt - 0.005, rx: waistW * 1.03 + cloth, rz: 0.108 * (1 + 0.6 * fat) + cloth, region: REGION.pants, w: W('Hips', 0.7, 'Spine', 0.3), shape: 2.2, cz: 0.008 },
        { y: belt, rx: waistW * 1.03 + cloth + 0.004, rz: 0.108 * (1 + 0.6 * fat) + cloth + 0.004, region: REGION.accent, w: W('Hips', 0.6, 'Spine', 0.4), shape: 2.2, cz: 0.008 },
        { y: belt + 0.03, rx: waistW * 1.03 + cloth + 0.004, rz: 0.108 * (1 + 0.6 * fat) + cloth + 0.004, region: REGION.accent, w: W('Hips', 0.4, 'Spine', 0.6), shape: 2.2, cz: 0.008 },
        // shirt hem hangs over the belt
        { y: belt + 0.032, rx: waistW * 1.06 + cloth, rz: 0.11 * (1 + 0.6 * fat) + cloth, region: REGION.shirt, w: W('Hips', 0.4, 'Spine', 0.6), shape: 2.2, cz: 0.006 },
      ];
  // The imported neck column (y 1.50-1.55) spans x +-0.095 and z -0.02..0.14, i.e. it is centred 5 cm behind the
  // chest centre line; collars are built around it, not around a slimmer procedural neck, so no skin pokes out.
  const NECK_Z = 0.05;
  const collarRx = 0.107, collarRz = 0.1;
  const upper: TR[] = [
    { y: 1.1, rx: waistW + cloth + jacket, rz: 0.104 * (1 + 0.7 * fat) + cloth + jacket, region: outer, w: W('Spine', 0.7, 'Spine1', 0.3), shape: 2.2, cz: 0.004, vopen: open ? 0.05 : 0 },
    { y: 1.2, rx: lerp(waistW, chestW, 0.55) + cloth + jacket, rz: lerp(0.11, chestD, 0.6) + cloth + jacket, region: outer, w: W('Spine1'), shape: 2.2, cz: 0.0, vopen: open ? 0.07 : 0 },
    { y: 1.3, rx: chestW + cloth + jacket, rz: chestD + cloth + jacket, region: outer, w: W('Spine1', 0.4, 'Spine2', 0.6), shape: 2.2, cz: -0.012, flatBack: 0.8, vopen: open ? 0.09 : 0 },
    { y: 1.38, rx: Math.max(chestW * 1.03, shoulderW * 0.9) + cloth + jacket, rz: chestD * 0.96 + cloth + jacket, region: outer, w: W('Spine2'), shape: 2.15, cz: -0.016, flatBack: 0.8, vopen: open ? 0.09 : 0 },
    // shoulders: elliptical (shape ~2.05) and sloping, not a square pad
    { y: 1.43, rx: shoulderW * 0.98 + cloth + jacket, rz: 0.105 + cloth + jacket, region: outer, w: W('Spine2', 0.6, 'LeftShoulder', 0.2, 'RightShoulder', 0.2), shape: 2.05, cz: -0.01, vopen: open ? 0.09 : 0 },
    { y: 1.455, rx: shoulderW * 0.86 + cloth + jacket, rz: 0.1 + cloth + jacket, region: outer, w: W('Spine2', 0.7, 'LeftShoulder', 0.15, 'RightShoulder', 0.15), shape: 2.05, cz: 0.0, vopen: open ? 0.07 : 0 },
    { y: 1.48, rx: 0.14 + jacket, rz: 0.1 + cloth + jacket, region: outer, w: W('Spine2', 0.6, 'Neck', 0.4), shape: 2.2, cz: 0.03, vopen: open ? 0.06 : 0 },
    { y: 1.5, rx: collarRx + jacket * 0.8, rz: collarRz + jacket * 0.6, region: outer, w: W('Spine2', 0.5, 'Neck', 0.5), shape: 2.1, cz: NECK_Z, vopen: open ? 0.05 : 0, capTop: !bodyOuter },
    // collar / neck: shells stand up 3.5 cm around the neck (open at the front), a down collar reaches the jaw,
    // shirts end at the collar bone
    ...(bodyOuter
      ? [
          { y: 1.515, rx: collarRx + jacket * 0.5, rz: collarRz + jacket * 0.4, region: outer, w: W('Neck'), cz: NECK_Z, vopen: open ? 0.06 : 0 } as TR,
          ...(puffer
            ? [
                { y: 1.538, rx: collarRx + 0.026, rz: collarRz + 0.022, region: outer, w: W('Neck'), cz: NECK_Z } as TR,
                { y: 1.556, rx: collarRx + 0.018, rz: collarRz + 0.014, region: outer, w: W('Neck'), cz: NECK_Z, capTop: true } as TR,
                { y: 1.561, rx: 0.07, rz: 0.07, region: REGION.skin, w: W('Neck'), cz: NECK_Z } as TR,
              ]
            : [
                { y: 1.535, rx: collarRx, rz: collarRz, region: outer, w: W('Neck'), cz: NECK_Z, vopen: open ? 0.06 : 0, capTop: true } as TR,
                { y: 1.54, rx: 0.07, rz: 0.07, region: REGION.skin, w: W('Neck'), cz: NECK_Z } as TR,
              ]),
        ]
      : [{ y: 1.515, rx: 0.07, rz: 0.07, region: REGION.skin, w: W('Neck'), cz: NECK_Z } as TR]),
    { y: 1.56, rx: 0.064, rz: 0.066, region: REGION.skin, w: W('Neck', 0.6, 'Head', 0.4), cz: 0.035 },
    { y: 1.6, rx: 0.064, rz: 0.07, region: REGION.skin, w: W('Head'), cz: 0.015 },
  ];
  const rings: TR[] = [...lower, ...mid, ...upper];
  let prev = -1;
  const torsoRings: number[] = [];
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    // `vopen` positions the lapels; the shirt showing in the V is painted analytically in the fragment
    // shader (materials.ts), because swapping the region per ring vertex quantised the opening into a sawtooth.
    const id = b.ring(0, r.y, r.cz ?? 0, r.rx, r.rz, N, r.y / RIG_HEIGHT, r.region, r.w, 'y', r.shape ?? 2.2, { flatBack: r.flatBack });
    torsoRings.push(id);
    if (prev >= 0) b.bridge(prev, id, N);
    if (r.capTop) b.cap(id, N, 0, r.y, r.cz ?? 0, r.region, r.w, true, r.y / RIG_HEIGHT);
    prev = id;
  }
  // bottom cap (crotch) closed by the leg tubes; add a small cap anyway to avoid holes when seen from below
  b.cap(torsoRings[0], N, 0, 0.82, 0.0, REGION.pants, W('Hips'), false, 0.45);

  type Row = [number, number, number, number, number, number];
  /** a point on a torso ring at parameter u (0..1 around; 0.75 = front centre), same superellipse as Builder.ring */
  const ringPoint = (r: TR, u: number): [number, number, number] => {
    const a = u * Math.PI * 2, shape = r.shape ?? 2.2;
    const c = Math.cos(a), sn = Math.sin(a);
    const ex = Math.sign(c) * Math.pow(Math.abs(c), 2 / shape);
    let ey = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / shape);
    if (r.flatBack !== undefined && ey > r.flatBack) ey = r.flatBack + (ey - r.flatBack) * 0.35;
    return [ex * r.rx, r.y, (r.cz ?? 0) + ey * r.rz];
  };
  const pushOut = (r: TR, x: number, z: number, d: number): [number, number] => {
    const nx = x / r.rx, nz = (z - (r.cz ?? 0)) / r.rz, l = Math.hypot(nx, nz) || 1;
    return [x + (nx / l) * d, z + (nz / l) * d];
  };
  /** cloth below the hip swings with the legs instead of being glued to the pelvis */
  const skirtWeights = (legK: number) => (i: number) => {
    const c = Math.cos((i / N) * Math.PI * 2);
    const right = 0.5 + 0.5 * Math.sign(c) * Math.pow(Math.abs(c), 0.6);
    return W('Hips', 1 - legK, 'RightUpLeg', legK * right, 'LeftUpLeg', legK * (1 - right));
  };
  if (bodyOuter) {
    // hanging hem: a shell drops 6 cm over the hip below the belt line; a topcoat falls to just below the knee,
    // which is the single strongest silhouette cue a winter sidewalk has
    const hem = mid[0];
    const skirt = overcoat
      ? [
          { y: hem.y + 0.003, rx: hem.rx + 0.001, rz: hem.rz + 0.001, legK: 0.05 },
          { y: 0.9, rx: hem.rx + 0.012, rz: hem.rz + 0.012, legK: 0.25 },
          { y: 0.8, rx: hem.rx + 0.026, rz: hem.rz + 0.024, legK: 0.45 },
          { y: 0.7, rx: hem.rx + 0.04, rz: hem.rz + 0.034, legK: 0.62 },
          { y: 0.615, rx: hem.rx + 0.05, rz: hem.rz + 0.042, legK: 0.72 },
          { y: 0.6, rx: hem.rx + 0.046, rz: hem.rz + 0.039, legK: 0.72 },
        ]
      : [
          { y: hem.y + 0.003, rx: hem.rx + 0.001, rz: hem.rz + 0.001, legK: 0.05 },
          { y: hem.y - 0.03, rx: hem.rx + 0.006, rz: hem.rz + 0.006, legK: 0.3 },
          { y: hem.y - 0.062, rx: hem.rx + 0.012, rz: hem.rz + 0.011, legK: 0.55 },
        ];
    let prevS = -1;
    for (const r of skirt) {
      const id = b.ring(0, r.y, hem.cz ?? 0, r.rx, r.rz, N, 3.0 + (hem.y - r.y) * 4, outer, W('Hips'), 'y', hem.shape ?? 2.2, { weightOf: skirtWeights(r.legK) });
      if (prevS >= 0) b.bridge(prevS, id, N);
      prevS = id;
    }
    if (overcoat) b.cap(prevS, N, 0, 0.598, hem.cz ?? 0, outer, skirtWeights(0.72)(0), false, 3.9);
  }
  if (skirted) {
    // skirt / dress: an A-line from the waist flaring to a hem just above the knee. Region follows the garment
    // it continues (a dress is one piece with the bodice), and the leg tubes below wear tights or bare skin.
    const sr = P.legs === 'dress' && !bodyOuter ? REGION.shirt : REGION.pants;
    const w0 = waistW * 1.04 + cloth, z0 = 0.008;
    const rows = [
      { y: 1.03, rx: w0, rz: 0.108 * (1 + 0.6 * fat) + cloth, legK: 0 },
      { y: 0.95, rx: hipW + cloth + 0.008, rz: hipRz + cloth + 0.006, legK: 0.12 },
      { y: 0.85, rx: hipW + 0.036, rz: hipRz + 0.03, legK: 0.35 },
      { y: 0.74, rx: hipW + 0.075, rz: hipRz + 0.062, legK: 0.6 },
      { y: 0.655, rx: hipW + 0.1, rz: hipRz + 0.084, legK: 0.75 },
      { y: 0.645, rx: hipW + 0.094, rz: hipRz + 0.079, legK: 0.75 },
    ];
    let prevS = -1;
    for (const r of rows) {
      const id = b.ring(0, r.y, z0, r.rx, r.rz, N, 3.0 + (1.03 - r.y) * 2, sr, W('Hips'), 'y', 2.3, { weightOf: skirtWeights(r.legK) });
      if (prevS >= 0) b.bridge(prevS, id, N);
      prevS = id;
    }
    b.cap(prevS, N, 0, 0.643, z0, sr, skirtWeights(0.75)(0), false, 3.9);
  }
  if (open) {
    // lapels: a folded facing along both edges of the front opening, from the hem to the top of the collar. It sits
    // 0.5-1.6 cm proud of the body so the opening reads as two cloth edges over the tee, not a painted V.
    const lapelRings = rings.filter((r) => (r.vopen ?? 0) > 0 && r.region === outer);
    for (const side of [-1, 1]) {
      const rows: Row[] = [];
      const ws: Weights[] = [];
      for (const r of lapelRings) {
        const k = Math.max(0, Math.ceil(r.vopen! * N - 1e-6) - 1); // shirt vertices per side beyond the centre line
        const uIn = 0.75 + (side * (k + 0.5)) / N, uOut = 0.75 + (side * Math.max(0.15, k * 0.65 - 0.3)) / N;
        const [xi, yi, zi] = ringPoint(r, uIn), [xo, yo, zo] = ringPoint(r, uOut);
        const [xi2, zi2] = pushOut(r, xi, zi, 0.005), [xo2, zo2] = pushOut(r, xo, zo, 0.016);
        rows.push([xi2, yi, zi2, xo2, yo, zo2]);
        ws.push(r.w);
      }
      if (rows.length > 1) b.strip(rows, REGION.jacket, ws, [0, 0, -1], 4);
    }
  }

  if (vest) {
    // hi-vis vest: a short sleeveless shell over the shirt, hem at the hip, armholes cut by ending it below the
    // deltoid. The two retroreflective bands are drawn by the shader on the hivis region.
    const vz = 0.008, t = 0.02;
    const vrows: { y: number; rx: number; rz: number; w: Weights }[] = [
      { y: 0.985, rx: waistW * 1.08 + cloth + t, rz: 0.112 * (1 + 0.6 * fat) + cloth + t, w: W('Hips', 0.8, 'Spine', 0.2) },
      { y: 1.06, rx: waistW * 1.05 + cloth + t, rz: 0.108 * (1 + 0.6 * fat) + cloth + t, w: W('Hips', 0.35, 'Spine', 0.65) },
      { y: 1.2, rx: lerp(waistW, chestW, 0.6) + cloth + t, rz: lerp(0.11, chestD, 0.6) + cloth + t, w: W('Spine1') },
      { y: 1.32, rx: chestW * 1.01 + cloth + t, rz: chestD + cloth + t, w: W('Spine1', 0.4, 'Spine2', 0.6) },
      { y: 1.4, rx: chestW * 0.99 + cloth + t, rz: chestD * 0.94 + cloth + t, w: W('Spine2') },
    ];
    let prevV = -1;
    for (let i = 0; i < vrows.length; i++) {
      const r = vrows[i];
      const id = b.ring(0, r.y, vz, r.rx, r.rz, N, 6 + i * 0.1, REGION.hivis, r.w, 'y', 2.2, { flatBack: 0.8 });
      if (prevV >= 0) b.bridge(prevV, id, N);
      else b.cap(id, N, 0, r.y - 0.002, vz, REGION.hivis, r.w, false, 6);
      prevV = id;
    }
    b.cap(prevV, N, 0, 1.402, vz, REGION.hivis, vrows[4].w, true, 6.4);
  }

  if (P.tie) {
    // necktie: a tapering blade down the front centre from the collar knot to the belt
    const rows: [number, number, number, number, number, number][] = [];
    const ws: Weights[] = [];
    const tie = [
      { y: 1.505, hw: 0.016, out: 0.004, w: W('Neck', 0.5, 'Spine2', 0.5) },
      { y: 1.475, hw: 0.021, out: 0.006, w: W('Spine2') },
      { y: 1.44, hw: 0.017, out: 0.006, w: W('Spine2') },
      { y: 1.33, hw: 0.026, out: 0.007, w: W('Spine1', 0.5, 'Spine2', 0.5) },
      { y: 1.18, hw: 0.032, out: 0.007, w: W('Spine1') },
      { y: 1.07, hw: 0.028, out: 0.006, w: W('Spine', 0.7, 'Spine1', 0.3) },
      { y: 1.045, hw: 0.006, out: 0.005, w: W('Spine', 0.8, 'Hips', 0.2) },
    ];
    for (const r of tie) {
      // follow the torso surface at the front centre line (u = 0.75)
      const near = rings.reduce((a, c) => (Math.abs(c.y - r.y) < Math.abs(a.y - r.y) ? c : a), rings[0]);
      const z = (near.cz ?? 0) - near.rz - r.out;
      rows.push([-r.hw, r.y, z, r.hw, r.y, z]);
      ws.push(r.w);
    }
    b.strip(rows, REGION.tie, ws, [0, 0, -1]);
  }

  // shoulder bag: strap across the chest (left shoulder -> right hip) and the bag hanging at the right hip
  if (P.bag) {
    const rows: Row[] = [];
    const ws: Weights[] = [];
    const segs = 8;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const y = lerp(1.46, 1.0, t);
      const x = lerp(-0.12, 0.17, t);
      const rz = curve([[0, 0.118], [0.35, chestD * 0.98], [1, hipRz + 0.008]], t) + cloth + jacket + 0.012;
      rows.push([x - 0.022, y, -rz, x + 0.022, y, -rz]);
      ws.push(t < 0.35 ? W('Spine2', 0.7, 'Spine1', 0.3) : t < 0.7 ? W('Spine1', 0.6, 'Spine', 0.4) : W('Spine', 0.4, 'Hips', 0.6));
    }
    b.strip(rows, REGION.bag, ws, [0, 0, -1]);
    const bx = hipW + cloth + 0.05, bz = 0.03;
    const wB = W('Hips');
    const r0 = b.ring(bx, 0.84, bz, 0.045, 0.1, 8, 0.47, REGION.bag, wB, 'y', 4);
    const r1 = b.ring(bx, 0.95, bz, 0.05, 0.11, 8, 0.53, REGION.bag, wB, 'y', 4);
    const r2 = b.ring(bx, 1.05, bz, 0.045, 0.1, 8, 0.58, REGION.bag, wB, 'y', 4);
    b.bridge(r0, r1, 8);
    b.bridge(r1, r2, 8);
    b.cap(r0, 8, bx, 0.835, bz, REGION.bag, wB, false, 0.47);
    b.cap(r2, 8, bx, 1.055, bz, REGION.bag, wB, true, 0.58);
  }

  // backpack: a rounded box on the back + two straps over the shoulders.
  // `carry: 'delivery'` swaps it for the insulated cube every food courier in the city wears.
  const delivery = P.carry === 'delivery';
  if (P.backpack || delivery) {
    const backZ = chestD + cloth + jacket;
    const cz0 = backZ * 0.85 + (delivery ? 0.155 : 0.075);
    const wLow = W('Spine', 0.6, 'Spine1', 0.4);
    const pk = delivery
      ? [
          b.ring(0, 0.99, cz0, 0.2, 0.155, 12, 0.58, REGION.prop, wLow, 'y', 7),
          b.ring(0, 1.18, cz0, 0.215, 0.165, 12, 0.66, REGION.prop, W('Spine1'), 'y', 7),
          b.ring(0, 1.4, cz0, 0.215, 0.165, 12, 0.75, REGION.prop, W('Spine1', 0.3, 'Spine2', 0.7), 'y', 7),
          b.ring(0, 1.44, cz0, 0.2, 0.152, 12, 0.8, REGION.prop, W('Spine2'), 'y', 7),
        ]
      : [
          b.ring(0, 1.05, cz0 - 0.005, 0.12, 0.06, 12, 0.58, REGION.bag, wLow, 'y', 4),
          b.ring(0, 1.2, cz0 + 0.005, 0.14, 0.075, 12, 0.66, REGION.bag, W('Spine1'), 'y', 4),
          b.ring(0, 1.36, cz0, 0.135, 0.07, 12, 0.75, REGION.bag, W('Spine1', 0.4, 'Spine2', 0.6), 'y', 4),
          b.ring(0, 1.45, cz0 - 0.02, 0.1, 0.045, 12, 0.8, REGION.bag, W('Spine2'), 'y', 3),
        ];
    const pkRegion = delivery ? REGION.prop : REGION.bag;
    for (let i = 1; i < pk.length; i++) b.bridge(pk[i - 1], pk[i], 12);
    b.cap(pk[0], 12, 0, delivery ? 0.985 : 1.045, cz0 - (delivery ? 0 : 0.005), pkRegion, wLow, false, 0.58);
    b.cap(pk[3], 12, 0, delivery ? 1.445 : 1.46, cz0 - (delivery ? 0 : 0.02), pkRegion, W('Spine2'), true, 0.8);
    for (const side of [-1, 1]) {
      const rows: Row[] = [];
      const ws: Weights[] = [];
      const segs = 6;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const y = lerp(1.47, 1.12, t);
        const x = side * lerp(0.085, 0.115, t);
        const rz = curve([[0, 0.118], [0.4, chestD * 0.98], [1, 0.108]], t) + cloth + jacket + 0.012;
        rows.push([x - 0.02, y, -rz, x + 0.02, y, -rz]);
        ws.push(t < 0.4 ? W('Spine2') : W('Spine1'));
      }
      b.strip(rows, REGION.bag, ws, [0, 0, -1]);
    }
  }

  // hood: a soft bulge behind the neck
  if (J === 'hoodie') {
    const h0 = b.ring(0, 1.46, 0.1, 0.105, 0.05, 12, 0.81, REGION.jacket, W('Spine2'), 'y', 2.4);
    const h1 = b.ring(0, 1.53, 0.125, 0.1, 0.055, 12, 0.85, REGION.jacket, W('Spine2', 0.5, 'Neck', 0.5), 'y', 2.4);
    const h2 = b.ring(0, 1.59, 0.13, 0.08, 0.045, 12, 0.88, REGION.jacket, W('Neck'), 'y', 2.4);
    b.bridge(h0, h1, 12);
    b.bridge(h1, h2, 12);
    b.cap(h0, 12, 0, 1.455, 0.1, REGION.jacket, W('Spine2'), false, 0.81);
    b.cap(h2, 12, 0, 1.6, 0.13, REGION.jacket, W('Neck'), true, 0.88);
  }

  // ---- head ---------------------------------------------------------------------------------
  {
    const cx = 0, cy = 1.69, cz = 0.0;
    const rxH = 0.078 * (1 + 0.1 * fat), ryH = 0.112, rzH = 0.098;
    const rows = hi ? 18 : 9;
    const H = P.hair;
    const hairVol = H === 'bald' ? 0 : H === 'fade' ? 0.005 : H === 'afro' ? 0.018 : H === 'long' || H === 'bun' || H === 'bob' ? 0.014 : 0.009;
    const cap = H === 'cap';
    const headRings: number[] = [];
    for (let j = 0; j <= rows; j++) {
      const phi = (j / rows) * Math.PI; // 0 top -> pi bottom
      const first = b.vcount;
      for (let i = 0; i < NH; i++) {
        const th = (i / NH) * Math.PI * 2;
        let nx = Math.sin(phi) * Math.cos(th);
        const ny = Math.cos(phi);
        let nz = Math.sin(phi) * Math.sin(th);
        // jaw: narrow the lower front
        const lower = Math.max(0, -ny);
        const front = Math.max(0, -nz);
        const jaw = 1 - 0.22 * lower * lower * (0.4 + 0.6 * front);
        const backFlat = 1 - 0.05 * Math.max(0, nz) * Math.max(0, ny);
        let x = cx + nx * rxH * jaw;
        let y = cy + ny * ryH * (ny < 0 ? 0.92 : 1);
        let z = cz + nz * rzH * backFlat;
        // nose
        const dn = Math.hypot(x - 0, y - 1.665, z - (cz - rzH));
        const nose = Math.exp(-(dn * dn) / (0.018 * 0.018));
        z -= nose * 0.016;
        y -= nose * 0.004;
        // brow ridge
        const db = Math.abs(y - 1.715) / 0.02;
        const brow = front * Math.exp(-db * db) * Math.max(0, 1 - Math.abs(x) / 0.06);
        z -= brow * 0.004;
        // region: hair / eye / skin
        let region: number = REGION.skin;
        // a fade keeps the hairline high and tight; long and bob carry hair down the back of the skull
        const hairline = H === 'bald' ? -2 : H === 'fade' ? 0.52 : 0.42;
        const nape = H === 'long' || H === 'bob' ? -0.9 : -0.15;
        const isHair = H !== 'bald' && (ny > hairline + (front > 0.6 ? 0.18 : 0) || (nz > 0.25 && ny > nape) || (Math.abs(nx) > 0.72 && ny > 0.05 && nz > -0.4));
        const isCap = cap && ny > 0.22;
        if (isHair || isCap) {
          const vol = isCap ? 0.022 : cap ? 0.004 : hairVol; // the cap also clears the imported head + buzzed hair
          region = isCap ? REGION.hat : REGION.hair;
          x += nx * vol;
          y += ny * vol * (ny > 0 ? 1 : 0.4);
          z += nz * vol;
        } else {
          const ex = Math.abs(x) - 0.031, ey = y - 1.7;
          if (front > 0.55 && ex * ex / (0.017 * 0.017) + ey * ey / (0.009 * 0.009) < 1) region = REGION.eye;
        }
        b.addVertex(x, y, z, i / NH, j / rows, region, W('Head'));
      }
      headRings.push(first);
      if (j > 0) b.bridge(headRings[j - 1], first, NH);
    }
    // ears
    if (hi) {
      for (const side of [-1, 1]) {
        const ex = side * (rxH * 0.98), ey = 1.68, ez = cz + 0.01;
        const ring = b.ring(ex, ey, ez, 0.006, 0.018, 8, 0.5, REGION.skin, W('Head'), 'y', 2);
        const ring2 = b.ring(ex + side * 0.012, ey + 0.004, ez + 0.002, 0.008, 0.02, 8, 0.5, REGION.skin, W('Head'), 'y', 2);
        b.bridge(ring, ring2, 8, side < 0);
        b.cap(ring2, 8, ex + side * 0.014, ey + 0.004, ez + 0.002, REGION.skin, W('Head'), side > 0, 0.5);
      }
    }
    // cap brim: a flat ellipse sticking out over the brow
    if (cap) {
      const by = cy + 0.22 * ryH, bcz = cz - 0.095;
      const r0 = b.ring(0, by, bcz, 0.072, 0.062, 10, 0.5, REGION.hat, W('Head'), 'y', 2);
      const r1 = b.ring(0, by + 0.006, bcz, 0.072, 0.062, 10, 0.5, REGION.hat, W('Head'), 'y', 2);
      b.bridge(r0, r1, 10);
      b.cap(r0, 10, 0, by, bcz, REGION.hat, W('Head'), false, 0.5);
      b.cap(r1, 10, 0, by + 0.006, bcz, REGION.hat, W('Head'), true, 0.5);
    }
    // sunglasses: a lens band following the head ellipse over the eyes, thin temples back to the ears
    if (P.glasses) {
      type Row = [number, number, number, number, number, number];
      const rows: Row[] = [];
      const ws: Weights[] = [];
      const ex = rxH + 0.006, ez = rzH + 0.012, ey = 1.69;
      for (let i = 0; i <= 10; i++) {
        const a = (-58 + (116 * i) / 10) * DEG_R;
        const x = cx + ex * Math.sin(a), z = cz - ez * Math.cos(a);
        rows.push([x, ey - 0.014, z, x, ey + 0.014, z]);
        ws.push(W('Head'));
      }
      b.strip(rows, REGION.glasses, ws, (i) => { const a = (-58 + (116 * i) / 10) * DEG_R; return [Math.sin(a), 0, -Math.cos(a)]; });
      for (const side of [-1, 1]) {
        const x = cx + side * (rxH + 0.005);
        const t: Row[] = [[x, ey - 0.003, cz - rzH * 0.42, x, ey + 0.003, cz - rzH * 0.42], [x, ey - 0.003, cz + 0.02, x, ey + 0.003, cz + 0.02], [x, ey - 0.003, cz + 0.055, x, ey + 0.003, cz + 0.055]];
        b.strip(t, REGION.glasses, [W('Head'), W('Head'), W('Head')], [side, 0, 0]);
      }
    }
    // over-ear headphones: a band over the crown and two cups
    if (P.headphones) {
      type Row = [number, number, number, number, number, number];
      const rows: Row[] = [];
      const ws: Weights[] = [];
      const bx = rxH + 0.022, by = ryH + 0.016, bz = cz + 0.012;
      for (let i = 0; i <= 12; i++) {
        const a = (-84 + (168 * i) / 12) * DEG_R;
        const x = cx + bx * Math.sin(a), y = cy + by * Math.cos(a);
        rows.push([x, y, bz - 0.009, x, y, bz + 0.009]);
        ws.push(W('Head'));
      }
      b.strip(rows, REGION.glasses, ws, (i) => { const a = (-84 + (168 * i) / 12) * DEG_R; return [Math.sin(a), Math.cos(a), 0]; });
      for (const side of [-1, 1]) {
        const x0 = cx + side * (rxH + 0.008), x1 = cx + side * (rxH + 0.03);
        const r0 = b.ring(x0, 1.685, bz, 0.036, 0.038, 12, 0.5, REGION.glasses, W('Head'), 'x', 2.2);
        const r1 = b.ring(x1, 1.685, bz, 0.03, 0.032, 12, 0.5, REGION.glasses, W('Head'), 'x', 2.2);
        b.bridge(r0, r1, 12, side < 0);
        b.cap(r1, 12, x1, 1.685, bz, REGION.glasses, W('Head'), side > 0, 0.5);
      }
    }
    // bun
    if (P.hair === 'bun') {
      const ring0 = b.ring(0, 1.74, 0.09, 0.03, 0.03, 10, 0.5, REGION.hair, W('Head'), 'y');
      const ring1 = b.ring(0, 1.78, 0.1, 0.038, 0.038, 10, 0.5, REGION.hair, W('Head'), 'y');
      const ring2 = b.ring(0, 1.815, 0.095, 0.024, 0.024, 10, 0.5, REGION.hair, W('Head'), 'y');
      b.bridge(ring0, ring1, 10);
      b.bridge(ring1, ring2, 10);
      b.cap(ring2, 10, 0, 1.825, 0.09, REGION.hair, W('Head'), true, 0.5);
    }
    if (P.hair === 'long') {
      // hair falling behind the neck to the shoulder blades
      const w0 = W('Head', 0.6, 'Neck', 0.4);
      const ringA = b.ring(0, 1.6, 0.045, 0.085, 0.045, 12, 0.5, REGION.hair, w0, 'y', 2.4);
      const ringB = b.ring(0, 1.5, 0.05, 0.095, 0.05, 12, 0.5, REGION.hair, W('Neck', 0.5, 'Spine2', 0.5), 'y', 2.4);
      const ringC = b.ring(0, 1.38, 0.06, 0.1, 0.045, 12, 0.5, REGION.hair, W('Spine2'), 'y', 2.4);
      b.bridge(ringA, ringB, 12);
      b.bridge(ringB, ringC, 12);
      b.cap(ringC, 12, 0, 1.36, 0.06, REGION.hair, W('Spine2'), false, 0.5);
    }

    // ---- hair with volume ---------------------------------------------------------------------
    // These are shells in the `hairvol` region rather than paint on the skull, so they survive onto the
    // near-LOD wardrobe mesh (which drops skin/hair/eye triangles in favour of the imported head).
    const NHV = hi ? 14 : 8;
    /** stack of (y, radius) rings around the skull, closed top and with the bottom lip tucked inside the head */
    const shell = (rows: [number, number][], zc: number, region: number, w: Weights, flatFront?: number, shape = 2.1): void => {
      let prev = -1;
      for (let i = 0; i < rows.length; i++) {
        const [y, r] = rows[i];
        const id = b.ring(0, y, zc, r, r * 0.94, NHV, 0.5, region, w, 'y', shape, { flatFront });
        if (prev >= 0) b.bridge(prev, id, NHV);
        else {
          // tuck a lip inward, below the head surface, so the open hem never shows its inside
          const lip = b.ring(0, y - 0.012, zc, r * 0.6, r * 0.56, NHV, 0.5, region, w, 'y', shape, { flatFront });
          b.bridge(lip, id, NHV);
        }
        prev = id;
      }
      b.cap(prev, NHV, 0, rows[rows.length - 1][0] + 0.004, zc, region, w, true, 0.5);
    };
    const wHead = W('Head');
    if (P.hair === 'afro') {
      shell([[1.638, 0.104], [1.668, 0.132], [1.705, 0.147], [1.75, 0.148], [1.792, 0.129], [1.828, 0.086], [1.848, 0.032]], cz + 0.03, REGION.hairvol, wHead, 0.5);
    } else if (P.hair === 'bob') {
      shell([[1.598, 0.104], [1.645, 0.113], [1.7, 0.108], [1.752, 0.098], [1.793, 0.081], [1.818, 0.036]], cz + 0.022, REGION.hairvol, wHead, 0.62, 2.2);
    } else if (P.hair === 'ponytail') {
      shell([[1.66, 0.086], [1.706, 0.096], [1.755, 0.09], [1.793, 0.073], [1.815, 0.03]], cz + 0.016, REGION.hairvol, wHead, 0.72, 2.2);
      // the tail itself, weighted off the head so it swings behind the neck
      const wT = W('Head', 0.55, 'Neck', 0.45);
      const t0 = b.ring(0, 1.72, cz + 0.115, 0.036, 0.036, 8, 0.5, REGION.hairvol, wHead, 'y', 2.2);
      const t1 = b.ring(0, 1.66, cz + 0.145, 0.042, 0.042, 8, 0.5, REGION.hairvol, wT, 'y', 2.2);
      const t2 = b.ring(0, 1.58, cz + 0.152, 0.036, 0.036, 8, 0.5, REGION.hairvol, W('Neck'), 'y', 2.2);
      const t3 = b.ring(0, 1.51, cz + 0.146, 0.021, 0.021, 8, 0.5, REGION.hairvol, W('Neck', 0.6, 'Spine2', 0.4), 'y', 2.2);
      b.bridge(t0, t1, 8); b.bridge(t1, t2, 8); b.bridge(t2, t3, 8);
      b.cap(t0, 8, 0, 1.726, cz + 0.115, REGION.hairvol, wHead, true, 0.5);
      b.cap(t3, 8, 0, 1.5, cz + 0.146, REGION.hairvol, W('Spine2'), false, 0.5);
    }

    // ---- headwear ------------------------------------------------------------------------------
    const hw = P.headwear;
    if (hw === 'beanie') {
      // knit cap pulled down over the ears, with a rolled brim
      shell([[1.652, 0.096], [1.7, 0.1], [1.75, 0.096], [1.79, 0.079], [1.812, 0.034]], cz + 0.006, REGION.hat, wHead, undefined, 2.2);
      const r0 = b.ring(0, 1.648, cz + 0.006, 0.101, 0.095, NHV, 0.5, REGION.hat, wHead, 'y', 2.2);
      const r1 = b.ring(0, 1.678, cz + 0.006, 0.103, 0.097, NHV, 0.5, REGION.hat, wHead, 'y', 2.2);
      b.bridge(r0, r1, NHV);
      b.cap(r0, NHV, 0, 1.646, cz + 0.006, REGION.hat, wHead, false, 0.5);
    } else if (hw === 'hardhat') {
      shell([[1.72, 0.101], [1.762, 0.1], [1.8, 0.085], [1.825, 0.055], [1.838, 0.02]], cz + 0.004, REGION.hat, wHead, undefined, 2.4);
      // brim: a flat ellipse all the way round, wider at the front
      const b0 = b.ring(0, 1.722, cz - 0.012, 0.118, 0.13, 12, 0.5, REGION.hat, wHead, 'y', 2.3);
      const b1 = b.ring(0, 1.731, cz - 0.012, 0.118, 0.13, 12, 0.5, REGION.hat, wHead, 'y', 2.3);
      b.bridge(b0, b1, 12);
      b.cap(b0, 12, 0, 1.72, cz - 0.012, REGION.hat, wHead, false, 0.5);
      b.cap(b1, 12, 0, 1.733, cz - 0.012, REGION.hat, wHead, true, 0.5);
    } else if (hw === 'peaked') {
      // doorman / officer cap: a straight band, a flat crown a little wider than it, and a short visor
      const c0 = b.ring(0, 1.716, cz + 0.004, 0.093, 0.093, 12, 0.5, REGION.accent, wHead, 'y', 2.4);
      const c1 = b.ring(0, 1.748, cz + 0.004, 0.096, 0.096, 12, 0.5, REGION.hat, wHead, 'y', 2.4);
      const c2 = b.ring(0, 1.775, cz + 0.004, 0.108, 0.106, 12, 0.5, REGION.hat, wHead, 'y', 2.4);
      b.bridge(c0, c1, 12); b.bridge(c1, c2, 12);
      b.cap(c2, 12, 0, 1.778, cz + 0.004, REGION.hat, wHead, true, 0.5);
      b.cap(c0, 12, 0, 1.714, cz + 0.004, REGION.hat, wHead, false, 0.5);
      const v0 = b.ring(0, 1.714, cz - 0.044, 0.088, 0.082, 10, 0.5, REGION.accent, wHead, 'y', 2.2);
      const v1 = b.ring(0, 1.72, cz - 0.044, 0.088, 0.082, 10, 0.5, REGION.accent, wHead, 'y', 2.2);
      b.bridge(v0, v1, 10);
      b.cap(v0, 10, 0, 1.712, cz - 0.044, REGION.accent, wHead, false, 0.5);
      b.cap(v1, 10, 0, 1.722, cz - 0.044, REGION.accent, wHead, true, 0.5);
    } else if (hw === 'hijab') {
      // a scarf over the crown and around the jaw, falling onto the shoulders; the face opening stays clear
      shell([[1.63, 0.108], [1.68, 0.114], [1.73, 0.112], [1.775, 0.098], [1.806, 0.072], [1.822, 0.03]], cz + 0.012, REGION.hat, wHead, 0.66, 2.2);
      const d0 = b.ring(0, 1.632, cz + 0.02, 0.107, 0.1, 12, 0.5, REGION.hat, W('Head', 0.7, 'Neck', 0.3), 'y', 2.2, { flatFront: 0.66 });
      const d1 = b.ring(0, 1.56, cz + 0.03, 0.104, 0.096, 12, 0.5, REGION.hat, W('Neck', 0.6, 'Head', 0.4), 'y', 2.2, { flatFront: 0.5 });
      const d2 = b.ring(0, 1.47, cz + 0.04, 0.115, 0.1, 12, 0.5, REGION.hat, W('Spine2'), 'y', 2.2);
      b.bridge(d0, d1, 12); b.bridge(d1, d2, 12);
      b.cap(d2, 12, 0, 1.462, cz + 0.04, REGION.hat, W('Spine2'), false, 0.5);
    }

    // wired earbuds: two small pale beads in the ears, visible from three or four metres
    if (P.earbuds && hi) {
      for (const side of [-1, 1]) {
        const ex = side * (rxH * 0.99 + 0.006);
        const e0 = b.ring(ex, 1.678, cz + 0.012, 0.012, 0.014, 8, 0.5, REGION.watch, wHead, 'x', 2.2);
        const e1 = b.ring(ex + side * 0.012, 1.674, cz + 0.012, 0.009, 0.011, 8, 0.5, REGION.watch, wHead, 'x', 2.2);
        b.bridge(e0, e1, 8, side < 0);
        b.cap(e1, 8, ex + side * 0.013, 1.674, cz + 0.012, REGION.watch, wHead, side > 0, 0.5);
      }
    }
  }

  // ---- arms ---------------------------------------------------------------------------------
  const POS = bonePositions(P);
  // imported upper arm radius: ~0.065 m male, ~0.05 m female (measured along the bone); sleeves add cloth on top
  const armR = 0.052 * (1 + 0.4 * fat) * (P.shoulders < 0.95 ? 0.88 : 1);
  for (const side of ['Left', 'Right'] as const) {
    const s = side === 'Left' ? -1 : 1;
    const sh = POS[BONE_INDEX[side + 'Arm']];
    const el = POS[BONE_INDEX[side + 'ForeArm']];
    const wr = POS[BONE_INDEX[side + 'Hand']];
    const fe = POS[BONE_INDEX[side + 'HandEnd']];
    const segU = hi ? 7 : 3, segF = hi ? 6 : 3;
    let last = -1;
    // deltoid start inside the torso
    const sleeveEnd = P.sleeves === 'long' ? 1.1 : P.sleeves === 'short' ? 0.52 : -1;
    const cuffEnd = 0.88; // long sleeves stop 3 cm above the wrist (the skeleton shares the imported wrist), closed by a disc
    for (let i = 0; i <= segU; i++) {
      const t = i / segU;
      const x = lerp(sh[0], el[0], t) + s * (t < 0.15 ? 0.012 : 0);
      const y = lerp(sh[1] + 0.035, el[1], t);
      const z = lerp(sh[2], el[2], t);
      let r = curve([[0, armR * 1.1], [0.25, armR * 1.02], [0.7, armR * 0.9], [1, armR * 0.82]], t);
      const onSleeve = t <= sleeveEnd;
      if (onSleeve) r += cloth + jacket * 0.6;
      const region = onSleeve ? (bodyOuter ? REGION.jacket : REGION.shirt) : REGION.skin;
      const w = blend(side + 'Arm', side + 'ForeArm', t, 1, 0.12);
      const w2 = t < 0.2 ? W(side + 'Shoulder', 0.35 * (1 - t / 0.2), side + 'Arm', 1 - 0.35 * (1 - t / 0.2)) : w;
      const id = b.ring(x, y, z, r, r * 0.92, NL, 2 + t * 0.5, region, w2);
      if (last >= 0) b.bridge(last, id, NL);
      last = id;
      // sleeve hem: duplicate ring with skin radius right below the sleeve end
      if (P.sleeves === 'short' && i < segU && (i + 1) / segU > sleeveEnd && t <= sleeveEnd) {
        const th = sleeveEnd;
        const hx = lerp(sh[0], el[0], th), hy = lerp(sh[1] + 0.035, el[1], th), hz = lerp(sh[2], el[2], th);
        const rh = curve([[0, armR * 1.1], [0.25, armR * 1.02], [0.7, armR * 0.9], [1, armR * 0.82]], th) + 0.008; // the imported upper arm is a little fuller than the tube
        const wh = blend(side + 'Arm', side + 'ForeArm', th, 1, 0.12);
        const a1 = b.ring(hx, hy, hz, rh + cloth, (rh + cloth) * 0.92, NL, 2 + th * 0.5, REGION.shirt, wh);
        // the hem is closed with a disc (the imported arm passes through it) so no sleeve interior ever shows
        b.cap(a1, NL, hx, hy - 0.002, hz, REGION.shirt, wh, false, 2 + th * 0.5);
        const a2 = b.ring(hx, hy - 0.004, hz, rh - 0.012, (rh - 0.012) * 0.92, NL, 2 + th * 0.5, REGION.skin, wh);
        b.bridge(a1, a2, NL);
        last = a2;
      }
    }
    for (let i = 1; i <= segF; i++) {
      const t = i / segF;
      const x = lerp(el[0], wr[0], t), y = lerp(el[1], wr[1], t), z = lerp(el[2], wr[2], t) - 0.004 * Math.sin(t * Math.PI);
      let r = curve([[0, armR * 0.82], [0.3, armR * 0.86], [1, armR * 0.6]], t);
      const onSleeve = P.sleeves === 'long' && t <= cuffEnd;
      if (onSleeve) r += cloth + 0.006 + jacket * 0.5;
      const region = onSleeve ? (bodyOuter ? REGION.jacket : REGION.shirt) : REGION.skin;
      const w = blend(side + 'ForeArm', side + 'Hand', t, 1, 0.1);
      const id = b.ring(x, y, z, r, r * 0.85, NL, 2.5 + t * 0.3, region, w);
      b.bridge(last, id, NL);
      last = id;
      if (P.sleeves === 'long' && i < segF && (i + 1) / segF > cuffEnd && t <= cuffEnd) {
        // cuff: the sleeve ends above the wrist and steps in to the skin radius
        const th = cuffEnd;
        const hx = lerp(el[0], wr[0], th), hy = lerp(el[1], wr[1], th), hz = lerp(el[2], wr[2], th) - 0.004 * Math.sin(th * Math.PI);
        const rh = curve([[0, armR * 0.82], [0.3, armR * 0.86], [1, armR * 0.6]], th);
        const wh = blend(side + 'ForeArm', side + 'Hand', th, 1, 0.1);
        const a1 = b.ring(hx, hy, hz, rh + cloth + 0.006 + jacket * 0.5, (rh + cloth + 0.006 + jacket * 0.5) * 0.85, NL, 2.5 + th * 0.3, region, wh);
        b.bridge(last, a1, NL);
        b.cap(a1, NL, hx, hy - 0.002, hz, region, wh, false, 2.5 + th * 0.3);
        const a2 = b.ring(hx, hy - 0.004, hz, rh, rh * 0.85, NL, 2.5 + th * 0.3, REGION.skin, wh);
        b.bridge(a1, a2, NL);
        last = a2;
      }
    }
    // hand: flattened, slightly cupped, fingers together
    const segH = hi ? 4 : 2;
    for (let i = 0; i <= segH; i++) {
      const t = i / segH;
      const x = lerp(wr[0], fe[0], t), y = lerp(wr[1], fe[1], t), z = lerp(wr[2], fe[2], t) - 0.01 * t;
      const rx = curve([[0, 0.028], [0.3, 0.044], [0.6, 0.046], [1, 0.03]], t);
      const rz = curve([[0, 0.02], [0.4, 0.018], [1, 0.012]], t);
      const w = t < 0.2 ? W(side + 'ForeArm', 0.3, side + 'Hand', 0.7) : W(side + 'Hand');
      // the hand is flat in the Y/Z plane at bind (palm faces the thigh): ring width along z, thin along x
      const id = b.ring(x, y, z, rz * 1.4, rx, NL, 2.8 + t * 0.2, REGION.skin, w, 'y', 2.4);
      b.bridge(last, id, NL);
      last = id;
    }
    b.cap(last, NL, fe[0], fe[1] - 0.01, fe[2] - 0.01, REGION.skin, W(side + 'Hand'), false, 1);
  }

  // ---- wristwatch (left wrist: strap ring + a case on the back of the wrist) --------------------
  if (P.watch) {
    const wr = POS[BONE_INDEX.LeftHand];
    const ww = W('LeftHand', 0.7, 'LeftForeArm', 0.3);
    const cy = wr[1] + 0.012, cz = wr[2] - 0.002;
    const s0 = b.ring(wr[0], cy + 0.011, cz, 0.037, 0.031, NL, 3.5, REGION.accent, ww, 'y', 2.4);
    const s1 = b.ring(wr[0], cy - 0.011, cz, 0.037, 0.031, NL, 3.5, REGION.accent, ww, 'y', 2.4);
    b.bridge(s0, s1, NL);
    const cx = wr[0] - 0.033;
    const c0 = b.ring(cx, cy, cz, 0.019, 0.02, 10, 3.5, REGION.watch, ww, 'x', 2.4);
    const c1 = b.ring(cx - 0.009, cy, cz, 0.019, 0.02, 10, 3.5, REGION.watch, ww, 'x', 2.4);
    b.bridge(c0, c1, 10, true);
    const f0 = b.ring(cx - 0.0092, cy, cz, 0.015, 0.016, 10, 3.5, REGION.eye, ww, 'x', 2.4);
    b.cap(f0, 10, cx - 0.0095, cy, cz, REGION.eye, ww, false, 3.5);
  }

  // ---- carried objects -------------------------------------------------------------------------
  // Bags hang from a hand at rest, so they need no pose. A cup or an umbrella is built along the hand's
  // local -Z: the animator's carry pose flexes that elbow ~100 deg, which swings -Z to within 10 deg of
  // world up, so the cup stands upright and the umbrella shaft rises over the shoulder.
  if (P.carry === 'tote' || P.carry === 'shopping') {
    const wr = POS[BONE_INDEX.LeftHand];
    const wB = W('LeftHand');
    const stiff = P.carry === 'shopping';
    const region = stiff ? REGION.prop : REGION.bag;
    const shape = stiff ? 6 : 2.6;
    const rows: [number, number, number][] = stiff
      ? [[0.78, 0.085, 0.05], [0.7, 0.095, 0.055], [0.56, 0.095, 0.055], [0.545, 0.09, 0.05]]
      : [[0.78, 0.07, 0.038], [0.7, 0.098, 0.05], [0.6, 0.096, 0.049], [0.55, 0.075, 0.04]];
    // hung straight under the fist, not offset to one side: the hand is already outside the hip
    const bx = wr[0], bz = wr[2] + 0.01;
    let prev = -1;
    for (let i = 0; i < rows.length; i++) {
      const [y, rx, rz] = rows[i];
      const id = b.ring(bx, y, bz, rx, rz, 10, 7 + i * 0.1, region, wB, 'y', shape);
      if (prev >= 0) b.bridge(prev, id, 10);
      else b.cap(id, 10, bx, y + 0.004, bz, region, wB, true, 7);
      prev = id;
    }
    b.cap(prev, 10, bx, rows[rows.length - 1][0] - 0.006, bz, region, wB, false, 7.4);
    // two handle straps arching from the bag mouth up through the fist
    for (const dz of [-0.03, 0.03]) {
      const hz = bz + dz, hw = 0.006;
      const arch: [number, number][] = [[bx - 0.052, 0.778], [bx - 0.024, 0.858], [bx + 0.024, 0.858], [bx + 0.052, 0.778]];
      b.strip(arch.map(([x, y]) => [x - hw, y, hz, x + hw, y, hz] as [number, number, number, number, number, number]), REGION.bag, arch.map(() => wB), [0, 0, -1], 7.6);
    }
  }
  if (P.carry === 'coffee' || P.carry === 'umbrella') {
    const wr = POS[BONE_INDEX.RightHand];
    const wB = W('RightHand');
    const gx = wr[0] - 0.008, gy = 0.865, gz = wr[2] + 0.02;
    if (P.carry === 'coffee') {
      const c0 = b.ring(gx, gy, gz, 0.033, 0.033, 10, 7, REGION.prop, wB, 'z', 2.4);
      const c1 = b.ring(gx, gy, gz - 0.055, 0.037, 0.037, 10, 7.1, REGION.prop, wB, 'z', 2.4);
      const c2 = b.ring(gx, gy, gz - 0.102, 0.04, 0.04, 10, 7.2, REGION.prop, wB, 'z', 2.4);
      const c3 = b.ring(gx, gy, gz - 0.112, 0.042, 0.042, 10, 7.3, REGION.accent, wB, 'z', 2.4);
      b.bridge(c0, c1, 10, false); b.bridge(c1, c2, 10, false); b.bridge(c2, c3, 10, false);
      b.cap(c0, 10, gx, gy, gz + 0.004, REGION.prop, wB, false, 7);
      b.cap(c3, 10, gx, gy, gz - 0.116, REGION.accent, wB, true, 7.3);
    } else {
      // shaft, then a shallow canopy about a metre along it
      const s0 = b.ring(gx, gy, gz + 0.09, 0.011, 0.011, 6, 7, REGION.accent, wB, 'z', 2.4);
      const s1 = b.ring(gx, gy, gz - 0.86, 0.011, 0.011, 6, 7.2, REGION.accent, wB, 'z', 2.4);
      b.bridge(s0, s1, 6, false);
      b.cap(s0, 6, gx, gy, gz + 0.095, REGION.accent, wB, false, 7);
      const k0 = b.ring(gx, gy, gz - 0.86, 0.05, 0.05, 12, 7.4, REGION.prop, wB, 'z', 2.2);
      const k1 = b.ring(gx, gy, gz - 0.79, 0.26, 0.26, 12, 7.5, REGION.prop, wB, 'z', 2.2);
      const k2 = b.ring(gx, gy, gz - 0.735, 0.43, 0.43, 12, 7.6, REGION.prop, wB, 'z', 2.2);
      b.bridge(k0, k1, 12, false); b.bridge(k1, k2, 12, false);
      b.cap(k0, 12, gx, gy, gz - 0.885, REGION.prop, wB, false, 7.4);
      b.cap(k2, 12, gx, gy, gz - 0.745, REGION.prop, wB, true, 7.6);
    }
  }
  if (P.carry === 'camera') {
    // a compact camera on a neck strap, riding on the sternum
    const cz0 = -(chestD + cloth + jacket) - 0.035;
    const wC = W('Spine1', 0.6, 'Spine2', 0.4);
    for (const side of [-1, 1]) {
      const rows: [number, number, number, number, number, number][] = [];
      const ws: Weights[] = [];
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        const y = lerp(1.47, 1.26, t);
        const x = side * lerp(0.075, 0.03, t);
        const zr = curve([[0, 0.11], [0.5, chestD * 0.99], [1, chestD * 0.9]], t) + cloth + jacket + 0.01;
        rows.push([x - 0.008, y, -zr, x + 0.008, y, -zr]);
        ws.push(t < 0.4 ? W('Spine2') : wC);
      }
      b.strip(rows, REGION.accent, ws, [0, 0, -1], 7.8);
    }
    const b0 = b.ring(0, 1.245, cz0, 0.055, 0.02, 8, 7.9, REGION.prop, wC, 'y', 6);
    const b1 = b.ring(0, 1.285, cz0, 0.058, 0.022, 8, 7.95, REGION.prop, wC, 'y', 6);
    b.bridge(b0, b1, 8);
    b.cap(b0, 8, 0, 1.243, cz0, REGION.prop, wC, false, 7.9);
    b.cap(b1, 8, 0, 1.287, cz0, REGION.prop, wC, true, 7.95);
    const l0 = b.ring(0, 1.265, cz0 - 0.02, 0.024, 0.024, 8, 7.96, REGION.accent, wC, 'z', 2.2);
    const l1 = b.ring(0, 1.265, cz0 - 0.045, 0.021, 0.021, 8, 7.97, REGION.accent, wC, 'z', 2.2);
    b.bridge(l0, l1, 8, false);
    b.cap(l1, 8, 0, 1.265, cz0 - 0.048, REGION.eye, wC, true, 7.97);
  }

  // ---- legs ---------------------------------------------------------------------------------
  const thighR = 0.083 * (1 + 0.45 * fat) * (P.hips > 1.05 ? 1.06 : 1);
  for (const side of ['Left', 'Right'] as const) {
    const hp = POS[BONE_INDEX[side + 'UpLeg']];
    const kn = POS[BONE_INDEX[side + 'Leg']];
    const an = POS[BONE_INDEX[side + 'Foot']];
    const segT = hi ? 7 : 3, segS = hi ? 7 : 3;
    let last = -1;
    const shortsEnd = 0.86; // fraction of the thigh: hem just above the knee (matches the skin cut in assets.ts)
    for (let i = 0; i <= segT; i++) {
      const t = i / segT;
      const x = lerp(hp[0], kn[0], t), y = lerp(hp[1] + 0.02, kn[1], t), z = lerp(hp[2], kn[2], t);
      let r = curve([[0, thighR * 1.02], [0.3, thighR * 0.98], [0.75, thighR * 0.8], [1, thighR * 0.7]], t);
      const onPants = P.legs === 'long' || (P.legs === 'short' && t <= shortsEnd);
      if (onPants) r += cloth + 0.006 + (P.legs === 'short' ? 0.006 + 0.01 * t : 0);
      // under a skirt the leg is a stocking, not bare skin: a thin tube in the sock region, opaque or sheer by palette
      else if (skirted) r += 0.003;
      const rzk = t > 0.75 ? 1.05 : 1; // knee cap
      const w = blend(side + 'UpLeg', side + 'Leg', t, 1, 0.12);
      const w2 = t < 0.15 ? W('Hips', 0.3 * (1 - t / 0.15), side + 'UpLeg', 1 - 0.3 * (1 - t / 0.15)) : w;
      const id = b.ring(x, y, z, r, r * 0.95 * rzk, NL, t * 0.5, onPants ? REGION.pants : skirted ? REGION.sock : REGION.skin, w2, 'y', 2.2);
      if (last >= 0) b.bridge(last, id, NL);
      last = id;
      if (P.legs === 'short' && i < segT && (i + 1) / segT > shortsEnd && t <= shortsEnd) {
        const th = shortsEnd;
        const hx = lerp(hp[0], kn[0], th), hy = lerp(hp[1] + 0.02, kn[1], th), hz = lerp(hp[2], kn[2], th);
        const rh = curve([[0, thighR * 1.02], [0.3, thighR * 0.98], [0.75, thighR * 0.8], [1, thighR * 0.7]], th);
        const wh = blend(side + 'UpLeg', side + 'Leg', th, 1, 0.12);
        // the imported thigh sits ~2 cm further out and ~3 cm further back than this rig's: a loose hem covers both
        const a1 = b.ring(hx, hy, hz + 0.01, rh + cloth + 0.016, (rh + cloth + 0.022) * 0.95, NL, th * 0.5, REGION.pants, wh);
        b.bridge(last, a1, NL);
        b.cap(a1, NL, hx, hy - 0.002, hz + 0.01, REGION.pants, wh, false, th * 0.5);
        const a2 = b.ring(hx, hy - 0.004, hz, rh, rh * 0.95, NL, th * 0.5, REGION.skin, wh);
        b.bridge(a1, a2, NL);
        last = a2;
      }
    }
    for (let i = 1; i <= segS; i++) {
      // long trousers end 2 cm above the ankle bone: the hem breaks over the shoe and the toe box / heel stay visible
      const t = P.legs === 'long' ? (i / segS) * (1 - 0.02 / (kn[1] - an[1])) : i / segS;
      const x = lerp(kn[0], an[0], t), y = lerp(kn[1], an[1], t), z = lerp(kn[2], an[2], t) + 0.012 * Math.sin(t * Math.PI);
      let r = curve([[0, thighR * 0.7], [0.3, thighR * 0.74], [0.6, thighR * 0.62], [1, thighR * 0.46]], t);
      const onPants = P.legs === 'long';
      if (onPants) r += cloth + 0.008 + 0.006 * t - (t > 0.9 ? (t - 0.9) * 0.09 : 0); // pants hang straighter than the leg, then the hem draws in on the shoe
      else if (skirted) r += 0.003;
      const region = onPants ? REGION.pants : skirted ? REGION.sock : REGION.skin;
      const w = blend(side + 'Leg', side + 'Foot', t, 1, 0.1);
      const id = b.ring(x, y, z, r, r * 0.98, NL, 0.5 + t * 0.4, region, w, 'y', 2.2);
      b.bridge(last, id, NL);
      last = id;
      if (P.legs === 'long' && i === segS) {
        // the hem sits on the shoe (ankle bone height): a closed disc so the tube never shows its inside
        b.cap(id, NL, x, y - 0.002, z, REGION.pants, w, false, 0.9);
      }
    }
    if (P.legs === 'short') {
      const sx = an[0], sz = an[2] + 0.03;
      const wk = W(side + 'Foot', 0.5, side + 'Leg', 0.5);
      const s0 = b.ring(sx, 0.068, sz, 0.05, 0.076, NL, 0.9, REGION.sock, W(side + 'Foot'), 'y', 2.2);
      const s1 = b.ring(sx, 0.1, sz, 0.048, 0.07, NL, 0.92, REGION.sock, wk, 'y', 2.2);
      const s2 = b.ring(sx, 0.125, sz - 0.004, 0.046, 0.065, NL, 0.94, REGION.sock, W(side + 'Leg'), 'y', 2.2);
      b.bridge(s0, s1, NL);
      b.bridge(s1, s2, NL);
    }
    // shoe: loft along -Z from heel to toe, cross-sections in X/Y
    const fx = an[0];
    const shoe: [number, number, number, number][] = [
      // z, rx, ry, cy
      [0.075, 0.03, 0.028, 0.045],
      [0.055, 0.042, 0.04, 0.05],
      [0.02, 0.047, 0.05, 0.058],
      [-0.03, 0.048, 0.045, 0.048],
      [-0.09, 0.05, 0.036, 0.038],
      [-0.15, 0.052, 0.028, 0.03],
      [-0.2, 0.046, 0.02, 0.024],
      [-0.235, 0.032, 0.012, 0.018],
    ];
    const shoeSegs = hi ? shoe : shoe.filter((_, i) => i % 2 === 0 || i === shoe.length - 1);
    let sLast = -1;
    let first = -1;
    for (let i = 0; i < shoeSegs.length; i++) {
      const [z, rx, ry, cy] = shoeSegs[i];
      const t = i / (shoeSegs.length - 1);
      const w = z < -0.1 ? W(side + 'Foot', 1 - (t - 0.6) * 1.2, side + 'ToeBase', (t - 0.6) * 1.2) : W(side + 'Foot');
      const id = b.ring(fx, cy, an[2] + z, rx, ry, NL, 0.9 + t * 0.1, REGION.shoes, w, 'z', 2.6, { flatFront: 0.55 });
      if (sLast >= 0) b.bridge(sLast, id, NL, false);
      else first = id;
      sLast = id;
    }
    b.cap(first, NL, fx, shoeSegs[0][3], an[2] + shoeSegs[0][0], REGION.shoes, W(side + 'Foot'), false, 0.9);
    b.cap(sLast, NL, fx, shoeSegs[shoeSegs.length - 1][3], an[2] + shoeSegs[shoeSegs.length - 1][0], REGION.shoes, W(side + 'ToeBase'), true, 1);
    // sole slab (region sole)
    const soleW = 0.052, y0 = 0.004, y1 = 0.014;
    const wS = W(side + 'Foot', 0.7, side + 'ToeBase', 0.3);
    const zs = [0.08, -0.05, -0.16, -0.24];
    let lastS = -1;
    for (let i = 0; i < zs.length; i++) {
      const z = an[2] + zs[i];
      const sw = i === zs.length - 1 ? soleW * 0.6 : i === 0 ? soleW * 0.75 : soleW;
      const id = b.ring(fx, (y0 + y1) / 2, z, sw, (y1 - y0) / 2, 8, 1, REGION.sole, wS, 'z', 3);
      if (lastS >= 0) b.bridge(lastS, id, 8, false);
      lastS = id;
    }
  }

  const geometry = b.build();
  return { geometry, params: P, detail };
}

/** palette entries: [r,g,b,roughness] per region (REGION_COUNT * 4) */
export type Palette = Float32Array;

export interface PaletteColors {
  skin: THREE.ColorRepresentation;
  shirt: THREE.ColorRepresentation;
  pants: THREE.ColorRepresentation;
  shoes: THREE.ColorRepresentation;
  hair: THREE.ColorRepresentation;
  accent?: THREE.ColorRepresentation;
  jacket?: THREE.ColorRepresentation;
  bag?: THREE.ColorRepresentation;
  hat?: THREE.ColorRepresentation;
  /** roughness of the outer layer (leather ~0.5, wool/cotton ~0.85) */
  jacketRough?: number;
  /** fabric roughness: denim/wool ~0.92, cotton ~0.88, chino ~0.8 */
  shirtRough?: number;
  pantsRough?: number;
  /** sole (white sneakers have white soles; dark shoes gum/black) */
  sole?: THREE.ColorRepresentation;
  /** socks, or tights under a skirt */
  sock?: THREE.ColorRepresentation;
  sockRough?: number;
  /** watch case (steel by default); also the earbuds */
  watch?: THREE.ColorRepresentation;
  /** hair volume shells (afro / bob / ponytail) - normally the hair colour */
  hairvol?: THREE.ColorRepresentation;
  /** safety vest; NYC hi-vis is a green-leaning yellow, not orange */
  hivis?: THREE.ColorRepresentation;
  /** carried object: cup, shopping bag, umbrella canopy, camera body, delivery cube */
  prop?: THREE.ColorRepresentation;
  propRough?: number;
  tie?: THREE.ColorRepresentation;
  /** eyewear: near-black for sunglasses, a thin metal or tortoiseshell frame for prescription glasses */
  glasses?: THREE.ColorRepresentation;
  hatRough?: number;
}

export function makePalette(colors: PaletteColors): Palette {
  const p = new Float32Array(REGION_COUNT * 4);
  const c = new THREE.Color();
  const set = (i: number, col: THREE.ColorRepresentation, rough: number) => {
    c.set(col);
    p[i * 4] = c.r;
    p[i * 4 + 1] = c.g;
    p[i * 4 + 2] = c.b;
    p[i * 4 + 3] = rough;
  };
  set(REGION.skin, colors.skin, 0.62);
  set(REGION.shirt, colors.shirt, colors.shirtRough ?? 0.9);
  set(REGION.pants, colors.pants, colors.pantsRough ?? 0.88);
  set(REGION.shoes, colors.shoes, 0.55);
  set(REGION.hair, colors.hair, 0.75);
  set(REGION.eye, 0x120c0a, 0.3);
  set(REGION.accent, colors.accent ?? 0x1a1612, 0.6);
  set(REGION.sole, colors.sole ?? 0x2a2622, 0.8);
  set(REGION.jacket, colors.jacket ?? colors.shirt, colors.jacketRough ?? 0.82);
  set(REGION.bag, colors.bag ?? 0x1a1816, 0.72);
  set(REGION.hat, colors.hat ?? 0x1a1a1a, colors.hatRough ?? 0.85);
  set(REGION.glasses, colors.glasses ?? 0x0b0b0d, 0.28);
  set(REGION.sock, colors.sock ?? 0xe6e4de, colors.sockRough ?? 0.9);
  set(REGION.watch, colors.watch ?? 0xb9bcc0, 0.3);
  set(REGION.hairvol, colors.hairvol ?? colors.hair, 0.62);
  set(REGION.hivis, colors.hivis ?? 0xc8e630, 0.72);
  set(REGION.prop, colors.prop ?? 0xd8d3c8, colors.propRough ?? 0.7);
  set(REGION.tie, colors.tie ?? 0x2a3550, 0.5);
  return p;
}

/**
 * Height at which bare neck/head skin starts on the imported body, i.e. the top of whatever collar the
 * wardrobe builds. The fragment cut in materials.ts starts a few millimetres inside it so the two overlap.
 */
export function collarCut(p?: Partial<BodyParams>): number {
  if (p?.headwear === 'hijab') return 1.60;
  if (p?.jacket === 'puffer') return 1.559;
  return p?.jacket ? 1.518 : 1.496;
}
