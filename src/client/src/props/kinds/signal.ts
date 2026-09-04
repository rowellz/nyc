/**
 * NYC traffic signal assembly. Local frame: the pole at the origin, local -z faces the oncoming
 * traffic (the approach), local +x points over the road (the mast arm side).
 *   - dark olive "NYC signal green" painted steel pole (0.15 m base dia, octagonal) on a cast base collar; the pole runs
 *     on above the mast arm (~7.2 m) with the diagonal tie strut down to the arm, the classic NYC look
 *   - tapered mast arm ~7.5 m over the road with two 3-aspect 12" heads hanging under it: yellow housings,
 *     dark green doors, long tunnel visors, facing the approach (-z)
 *   - one pole-mounted 3-aspect head at 3.4 m facing the approach
 *   - the pedestrian heads (separate kind, built by buildPedHead) hang on the pole at ~2.35 m
 * Per instance aData: x = mast length factor, y = signal state (0 red, 1 yellow, 2 green), z = -
 */
import * as THREE from 'three';
import { MeshBuilder, EMIT } from '../builder';

const GREEN = { color: 0x35422f, rough: 0.62, metal: 0.2, grimeBand: [0, 1.6, 0.3] as [number, number, number] };
const GREEN_DARK = { color: 0x222b1f, rough: 0.65, metal: 0.2 };
/** weathered federal-yellow housings of the mast-arm heads */
const YELLOW = { color: 0xc99d1e, rough: 0.62, metal: 0.05 };
const DOOR = { color: 0x2b382a, rough: 0.6, metal: 0.15 };
const HOUSING = { color: 0x1d2420, rough: 0.6, metal: 0.4 };
const HOOD = { color: 0x1c2419, rough: 0.72, metal: 0.1 };
const BEZEL = { color: 0x111411, rough: 0.7, metal: 0.1 };
const LENS_R = { color: 0x3a0a08, rough: 0.65, metal: 0, emit: EMIT.lensRed, emitStrength: 1.15 };
const LENS_Y = { color: 0x3a2a08, rough: 0.65, metal: 0, emit: EMIT.lensYellow, emitStrength: 1.15 };
const LENS_G = { color: 0x0a2a14, rough: 0.65, metal: 0, emit: EMIT.lensGreen, emitStrength: 1.15 };

export const SIGNAL_POLE_H = 6.1;
export const MAST_LEN = 7.5;

/** NYC backplate: black field with the 3-inch fluorescent yellow-green retroreflective border. */
const PLATE = { color: 0x0d0f0d, rough: 0.75, metal: 0.1 };
const PLATE_EDGE = { color: 0xa8bf1f, rough: 0.55, metal: 0 };

/**
 * One 3-section 12" head: housing 0.36 x 1.08 x 0.28, dark door, bezels, recessed lenses and visors
 * on the -z face, hung on a backplate. The backplate and the visors carry the head's silhouette, so
 * both survive into the far LOD (`detail` only drops the 250-degree tunnel visor for a boxed hood);
 * without them a head at 40 m is a plain yellow box (round-4 critic).
 */
function head(b: MeshBuilder, x: number, y: number, z: number, ry: number, seg: number, detail: boolean,
  housing = YELLOW, plate = true): void {
  const cos = Math.cos(ry), sin = Math.sin(ry);
  const local = (lx: number, ly: number, lz: number): { x: number; y: number; z: number } => ({ x: x + lx * cos + lz * sin, y: y + ly, z: z - lx * sin + lz * cos });
  const H = 1.08, W = 0.36, D = 0.28;
  if (plate) {
    // 0.62 x 1.36 plate at the back of the housing; only its border shows past the head from the front.
    // The plate is black on BOTH faces: the 75 mm fluorescent yellow-green retroreflective strip is
    // applied to the approach face only, so the back of a head stays dark.
    b.box(0.62, 1.36, 0.016, PLATE, { ...local(0, 0, D / 2 + 0.008), ry });
    for (const sy of [-1, 1]) b.box(0.62, 0.075, 0.008, PLATE_EDGE, { ...local(0, sy * 0.6425, D / 2 - 0.002), ry });
    for (const sx of [-1, 1]) b.box(0.075, 1.21, 0.008, PLATE_EDGE, { ...local(sx * 0.2725, 0, D / 2 - 0.002), ry });
  }
  b.box(W, H, D, housing, { ...local(0, 0, 0), ry });
  // the door (the dark face plate the lenses sit in) and the hanger bracket on top
  b.box(W - 0.02, H - 0.02, 0.02, DOOR, { ...local(0, 0, -D / 2 - 0.01), ry });
  b.box(0.06, 0.14, 0.06, GREEN_DARK, { ...local(0, H / 2 + 0.07, 0), ry });
  const lensR = 0.145;
  const ys = [H / 2 - 0.19, 0, -H / 2 + 0.19];
  const styles = [LENS_R, LENS_Y, LENS_G];
  for (let i = 0; i < 3; i++) {
    // bezel ring behind the lens, then the lens disc, both facing -z
    {
      const bezel = new THREE.CircleGeometry(lensR + 0.02, seg);
      bezel.rotateY(Math.PI);
      b.add(bezel, BEZEL, { ...local(0, ys[i], -D / 2 - 0.022), ry });
    }
    // the lens sits 25 mm back inside its bezel ring: an open collar gives the aperture real depth,
    // which is what separates an unlit head from a painted-on dot at 40 m
    const collar = new THREE.CylinderGeometry(lensR + 0.018, lensR + 0.018, 0.05, Math.max(8, seg), 1, true);
    collar.rotateX(Math.PI / 2);
    b.add(collar, BEZEL, { ...local(0, ys[i], -D / 2 - 0.047), ry });
    const lens = new THREE.CircleGeometry(lensR - 0.009, Math.max(20, seg));
    lens.rotateY(Math.PI);
    b.add(lens, styles[i], { ...local(0, ys[i], -D / 2 - 0.027), ry });
    // tunnel visor: a 250-degree tube over the lens, open at the bottom, 0.27 m long
    if (detail) {
      const hood = new THREE.CylinderGeometry(lensR + 0.025, lensR + 0.025, 0.27, seg, 1, true, -0.2 * Math.PI, 1.4 * Math.PI);
      hood.rotateX(Math.PI / 2); // axis along z, opening downward
      hood.rotateZ(Math.PI / 2); // put the visor ABOVE the lens, not below it
      const hp = local(0, ys[i], -D / 2 - 0.02 - 0.135);
      b.add(hood, HOOD, { ...hp, ry });
    } else {
      // far LOD: the same shading mass in 3 boxes, so the visors do not vanish between LODs
      b.box(0.33, 0.02, 0.25, HOOD, { ...local(0, ys[i] + lensR + 0.02, -D / 2 - 0.145), ry, rx: 0.12 });
      for (const sx of [-1, 1]) b.box(0.02, 0.2, 0.25, HOOD, { ...local(sx * (lensR + 0.02), ys[i] + 0.05, -D / 2 - 0.145), ry });
    }
  }
}

export function buildSignal(detail: 'near' | 'far'): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const seg = detail === 'near' ? 10 : 6;
  const near = detail === 'near';
  const armY = SIGNAL_POLE_H - 0.1;
  const topY = armY + 1.1; // the pole continues above the arm for the tie strut
  // cast base: flange, collar, ring, then the tapered shaft
  b.cyl(0.2, 0.22, 0.06, seg, GREEN_DARK, { y: 0 });
  b.cyl(0.15, 0.17, 0.55, seg, GREEN, { y: 0.06 });
  b.cyl(0.16, 0.16, 0.04, seg, GREEN_DARK, { y: 0.6 });
  const shaft = new THREE.CylinderGeometry(0.055, 0.075, topY - 0.64, 8).toNonIndexed();
  shaft.computeVertexNormals();
  b.add(shaft, GREEN, { y: (topY + 0.64) / 2 });
  b.cyl(0.065, 0.065, 0.1, 8, GREEN_DARK, { y: topY - 0.1 });
  b.sphere(0.065, 8, GREEN_DARK, { y: topY + 0.03 });
  // mast arm: shoe at the root, tapered arm with a slight rise, end cap, tie strut from above
  b.box(0.24, 0.5, 0.24, GREEN_DARK, { x: 0.1, y: armY });
  b.tube([0.15, armY, 0], [MAST_LEN * 0.55, armY + 0.14, 0], 0.085, seg, GREEN);
  b.tube([MAST_LEN * 0.55, armY + 0.14, 0], [MAST_LEN, armY + 0.22, 0], 0.055, seg, GREEN);
  b.sphere(0.055, 6, GREEN_DARK, { x: MAST_LEN, y: armY + 0.22 });
  b.tube([0.055, topY - 0.15, 0], [MAST_LEN * 0.4, armY + 0.13, 0], 0.03, 6, GREEN);
  if (near) b.cyl(0.07, 0.07, 0.05, 8, GREEN_DARK, { y: armY + 0.3 });
  // heads over the road: two on the mast (for lanes), hanging under the arm, facing -z
  head(b, MAST_LEN * 0.5, armY - 0.72, 0, 0, seg, near);
  head(b, MAST_LEN * 0.92, armY - 0.66, 0, 0, seg, near);
  b.box(0.06, 0.3, 0.06, GREEN_DARK, { x: MAST_LEN * 0.5, y: armY - 0.05, z: 0 });
  b.box(0.06, 0.3, 0.06, GREEN_DARK, { x: MAST_LEN * 0.92, y: armY + 0.02, z: 0 });
  // pole-mounted near-side head at 3.4 m on a side bracket, facing the approach (dark green housing)
  b.box(0.36, 0.05, 0.05, GREEN_DARK, { x: -0.24, y: 3.9, z: 0 });
  b.box(0.05, 0.16, 0.05, GREEN_DARK, { x: -0.42, y: 3.98, z: 0 });
  head(b, -0.42, 3.4, 0, 0, seg, near, GREEN, false); // near-side pole heads carry no backplate
  if (near) {
    // hand-hole cover, clamp bands, the ped push-button box at 1.1 m
    b.box(0.08, 0.2, 0.02, GREEN_DARK, { x: 0, y: 0.9, z: -0.074 });
    b.cyl(0.08, 0.08, 0.04, 8, GREEN_DARK, { y: 2.9 });
    b.cyl(0.08, 0.08, 0.04, 8, GREEN_DARK, { y: 4.4 });
    b.box(0.09, 0.14, 0.05, HOUSING, { x: 0, y: 1.1, z: -0.096 });
  }
  return b.build();
}

/**
 * Pedestrian signal head: 0.42 x 0.46 x 0.24 black housing with the face on -z and the louvered visor.
 * Per instance aData.z = frame (walk / hand / countdown). Local origin at the face center, mounted by
 * the caller on the pole.
 */
export function buildPedHead(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const W = 0.42, H = 0.46, D = 0.24;
  // backplate first: the same black field with the yellow-green border on the approach face only, and
  // the only thing that keeps a ped head from reading as a dark smudge across an intersection
  b.box(W + 0.24, H + 0.24, 0.016, PLATE, { z: D + 0.008 });
  for (const sy of [-1, 1]) b.box(W + 0.24, 0.07, 0.008, PLATE_EDGE, { y: sy * (H / 2 + 0.085), z: D - 0.005 });
  for (const sx of [-1, 1]) b.box(0.07, H + 0.10, 0.008, PLATE_EDGE, { x: sx * (W / 2 + 0.085), z: D - 0.005 });
  b.box(W, H, D, HOUSING, { z: D / 2 });
  // visor (louvered hood) around the face: top, sides, plus two louver slats
  b.box(W + 0.04, 0.03, 0.18, HOOD, { y: H / 2 + 0.005, z: -0.07 });
  b.box(0.03, H, 0.18, HOOD, { x: W / 2 + 0.005, z: -0.07 });
  b.box(0.03, H, 0.18, HOOD, { x: -W / 2 - 0.005, z: -0.07 });
  b.box(W, 0.012, 0.1, HOOD, { y: H * 0.18, z: -0.05 });
  b.box(W, 0.012, 0.1, HOOD, { y: -H * 0.18, z: -0.05 });
  // face: pedFace channel, uv frame from aData.z
  const face = new THREE.PlaneGeometry(W - 0.05, H - 0.07);
  face.rotateY(Math.PI);
  b.add(face, { color: 0xffffff, rough: 0.3, metal: 0, emit: EMIT.pedFace, emitStrength: 2.2, keepUv: true }, { z: -0.005 });
  // mounting bracket to the pole (behind the housing)
  b.box(0.06, 0.2, 0.06, GREEN_DARK, { y: 0, z: D + 0.03 });
  return b.build();
}

/** the small traffic-signal controller cabinet that stands next to ~1 in 4 signal poles */
export function buildSignalCabinet(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.box(0.66, 1.4, 0.44, { color: 0x8c8f92, rough: 0.5, metal: 0.8, grimeBand: [0, 0.8, 0.3] }, { y: 0.75 });
  b.box(0.7, 0.1, 0.48, { color: 0x6f7275, rough: 0.6, metal: 0.7 }, { y: 0.05 });
  b.box(0.7, 0.03, 0.48, { color: 0x6f7275, rough: 0.6, metal: 0.7 }, { y: 1.45 });
  b.box(0.02, 0.5, 0.02, { color: 0x3a3a3a, rough: 0.6, metal: 0.7 }, { x: 0.25, y: 0.8, z: -0.23 });
  return b.build();
}
