/**
 * The small-scale litter layer: what every NYC block face carries and no OSM tag records.
 * ART_DIRECTION §1 cue 5 / §4 (gutter line) / §6: a frame without bagged trash at the curb, a
 * cluster of news racks at the avenue corner, a locked bike on a hoop rack and iron guards round
 * the tree pits reads as a game long before the masonry does.
 * Real dimensions. Local frame: origin on the paving, +x along the curb, -z toward the roadway.
 */
import * as THREE from 'three';
import { MeshBuilder, type PartStyle } from '../builder';

/** DSNY bags are 3 mil black polyethylene: near-specular highlights are the whole tell at 20 m. */
const BAG_BLACK: PartStyle = { color: 0x0a0a0c, rough: 0.26, metal: 0 };
const BAG_BLACK2: PartStyle = { color: 0x121316, rough: 0.3, metal: 0 };
/** clear recycling sacks: pale grey-blue, glossier still, the cans inside breaking the silhouette */
const BAG_CLEAR: PartStyle = { color: 0xa8b2ae, rough: 0.16, metal: 0 };
const IRON: PartStyle = { color: 0x121412, rough: 0.55, metal: 0.65, grimeBand: [0, 0.2, 0.3] };

/** one sagging sack: a squashed ellipsoid with a gathered, twisted neck leaning off the vertical */
function bag(b: MeshBuilder, style: PartStyle, x: number, y: number, z: number, r: number,
  squash: number, lean: number, yaw: number): void {
  b.sphere(r, 7, style, { x, y: y + r * squash * 0.94, z, sx: 1.12, sy: squash, sz: 0.92, ry: yaw, rz: lean });
  // the gathered neck: a short cone whose tip is the knot, tipped the way the bag slumps
  const neck = new THREE.ConeGeometry(r * 0.42, r * 0.6, 6, 1, true);
  b.add(neck, style, { x: x - Math.sin(lean) * r * 1.2, y: y + r * squash * 1.75, z, ry: yaw, rz: lean });
  b.sphere(r * 0.16, 5, style, { x: x - Math.sin(lean) * r * 1.5, y: y + r * squash * 2.0, z });
}

/**
 * A curbside set-out: five or six black bags heaped against the tree-pit/curb line with two clear
 * recycling sacks on the outside. ~1.9 m along the curb, 0.85 m deep, tallest bag 0.72 m.
 * Ref: refs/_sheets/west-village.png 3, fifth-42nd 5 (the gutter line at collection hours).
 */
export function buildTrashPile(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  // back row leans on the wall/pit side (+z), front row spills toward the roadway
  bag(b, BAG_BLACK, -0.62, 0, 0.10, 0.30, 0.86, 0.12, 0.7);
  bag(b, BAG_BLACK2, -0.18, 0, 0.16, 0.33, 0.9, -0.08, 2.1);
  bag(b, BAG_BLACK, 0.28, 0, 0.12, 0.29, 0.84, 0.16, 4.0);
  bag(b, BAG_BLACK2, 0.70, 0, 0.06, 0.26, 0.8, -0.14, 5.2);
  // a second course tipped on top of the first: the heap, not a row
  bag(b, BAG_BLACK, -0.36, 0.42, -0.02, 0.26, 0.74, 0.34, 1.4);
  bag(b, BAG_BLACK2, 0.12, 0.40, -0.06, 0.24, 0.7, -0.3, 3.3);
  // clear sacks of cans and bottles at the ends, lower and flatter
  bag(b, BAG_CLEAR, -0.95, 0, -0.16, 0.25, 0.72, -0.2, 2.6);
  bag(b, BAG_CLEAR, 0.98, 0, -0.10, 0.23, 0.68, 0.22, 0.4);
  return b.build();
}

/**
 * A free-paper news rack: 0.44 x 0.42 x 1.02 m sheet-steel box on short legs, sloping hooded top
 * with the dark display window, pull door and coin plate. Placed in rows of three or four.
 */
export function buildNewsRack(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const shell = { color: 0x1e3f6b, rough: 0.42, metal: 0.25, grimeBand: [0, 0.3, 0.32] as [number, number, number] };
  const dark = { color: 0x101214, rough: 0.35, metal: 0.2 };
  const glass = { color: 0x171a1d, rough: 0.12, metal: 0.1 };
  const steel = { color: 0x53565a, rough: 0.5, metal: 0.7 };
  const W = 0.44, D = 0.42;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(0.03, 0.2, 0.03, steel, { x: sx * (W / 2 - 0.03), y: 0.1, z: sz * (D / 2 - 0.03) });
  }
  b.box(W, 0.62, D, shell, { y: 0.51 });
  b.box(W + 0.01, 0.03, D + 0.01, dark, { y: 0.2 });
  // hood: a sloping lid over the display window, the window itself recessed and facing -z
  b.box(W, 0.30, D, shell, { y: 0.94, rx: 0.24 });
  b.box(W - 0.05, 0.24, 0.02, glass, { y: 0.945, z: -D / 2 - 0.028, rx: 0.24 });
  b.box(W + 0.02, 0.025, D * 0.7, dark, { y: 1.045, z: 0.04, rx: 0.24 });
  // pull handle, coin plate and the price panel on the door
  b.box(0.2, 0.03, 0.025, steel, { y: 0.74, z: -D / 2 - 0.012 });
  b.box(0.09, 0.13, 0.02, dark, { x: W / 2 - 0.1, y: 0.55, z: -D / 2 - 0.008 });
  b.box(W - 0.08, 0.12, 0.006, { color: 0xd8d4c8, rough: 0.8, metal: 0 }, { y: 0.34, z: -D / 2 - 0.004 });
  return b.build();
}

/**
 * DOT hoop rack with a bike U-locked to it: the commonest object on a Village corner and the one
 * that makes a rack read as a rack. Local +x along the hoop, the bike parked on the -z side.
 */
export function buildLockedBike(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const hoop = { color: 0x1a1b1d, rough: 0.45, metal: 0.8 };
  const frame = { color: 0x224a6e, rough: 0.35, metal: 0.35 };
  const tyre = { color: 0x141416, rough: 0.9, metal: 0 };
  const rim = { color: 0x9a9da0, rough: 0.35, metal: 0.85 };
  const r = 0.024;
  b.tube([-0.3, 0, 0], [-0.3, 0.7, 0], r, 8, hoop);
  b.tube([0.3, 0, 0], [0.3, 0.7, 0], r, 8, hoop);
  b.add(new THREE.TorusGeometry(0.3, r, 6, 12, Math.PI), hoop, { y: 0.7 });
  for (const x of [-0.3, 0.3]) b.cyl(0.05, 0.05, 0.01, 8, { color: 0x3a3d40, rough: 0.5, metal: 0.8 }, { x });
  // bike: leant against the hoop, wheels in the xz plane at z = -0.16, wheelbase 1.02 m
  const bz = -0.17, lean = 0.13;
  const wheel = (x: number) => {
    const t = new THREE.TorusGeometry(0.335, 0.019, 5, 14);
    b.add(t, tyre, { x, y: 0.345, z: bz, ry: Math.PI / 2, rz: lean });
    const hub = new THREE.TorusGeometry(0.29, 0.005, 4, 12);
    b.add(hub, rim, { x, y: 0.345, z: bz, ry: Math.PI / 2, rz: lean });
    b.cylC(0.022, 0.022, 0.08, 6, rim, { x, y: 0.345, z: bz, rx: Math.PI / 2, ry: Math.PI / 2 });
  };
  wheel(-0.51); wheel(0.51);
  // diamond frame: down tube, seat tube, top tube, chain stay, fork
  b.tube([-0.5, 0.35, bz], [0.16, 0.30, bz], 0.021, 5, frame);   // down tube
  b.tube([0.16, 0.30, bz], [0.14, 0.78, bz], 0.021, 5, frame);   // seat tube
  b.tube([-0.5, 0.35, bz], [-0.28, 0.86, bz], 0.021, 5, frame);  // head/fork line
  b.tube([-0.28, 0.86, bz], [0.14, 0.80, bz], 0.019, 5, frame);  // top tube
  b.tube([0.16, 0.30, bz], [0.51, 0.345, bz], 0.017, 5, frame);  // chain stay
  b.tube([0.14, 0.78, bz], [0.51, 0.345, bz], 0.015, 5, frame);  // seat stay
  b.box(0.24, 0.03, 0.06, { color: 0x141416, rough: 0.5, metal: 0 }, { x: 0.13, y: 0.84, z: bz, rz: -0.1 }); // saddle
  b.cylC(0.014, 0.014, 0.44, 6, { color: 0x2a2c2e, rough: 0.4, metal: 0.7 }, { x: -0.3, y: 0.9, z: bz, rx: Math.PI / 2 }); // bars
  b.cylC(0.06, 0.06, 0.012, 8, { color: 0x2a2c2e, rough: 0.5, metal: 0.6 }, { x: 0.16, y: 0.25, z: bz }); // chainring
  // the U-lock through the rear wheel and the hoop
  b.add(new THREE.TorusGeometry(0.09, 0.014, 5, 10, Math.PI), { color: 0x35383b, rough: 0.4, metal: 0.7 }, { x: 0.3, y: 0.42, z: bz / 2, ry: Math.PI / 2 });
  b.box(0.035, 0.05, 0.19, { color: 0x35383b, rough: 0.4, metal: 0.7 }, { x: 0.3, y: 0.42, z: bz / 2 - 0.005 });
  return b.build();
}

/**
 * Cast-iron tree-pit guard, 2.4 x 1.5 m to match the environment module's pit (environment/trees.ts
 * PIT_L / PIT_W); this fills the half of the street trees that module leaves bare so every pit has one.
 * Corner posts with ball finials, a top and a bottom rail and 16 mm pickets between them.
 */
export function buildTreeGuard(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const L = 2.4, W = 1.5, hl = L / 2, hw = W / 2;
  const H = 0.50;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.box(0.05, H + 0.04, 0.05, IRON, { x: sx * hl, y: (H + 0.04) / 2, z: sz * hw });
    b.sphere(0.036, 6, IRON, { x: sx * hl, y: H + 0.06, z: sz * hw });
  }
  for (const y of [0.14, H - 0.03]) {
    for (const sz of [-1, 1]) b.box(L, 0.03, 0.03, IRON, { y, z: sz * hw });
    for (const sx of [-1, 1]) b.box(0.03, 0.03, W, IRON, { x: sx * hl, y });
  }
  // pickets: 0.22 m pitch on the long sides, 0.24 on the short ones, stopping short of the posts
  for (let i = -5; i <= 5; i++) for (const sz of [-1, 1]) {
    b.box(0.016, H - 0.13, 0.016, IRON, { x: i * 0.216, y: 0.135 + (H - 0.13) / 2, z: sz * hw });
  }
  for (let i = -2; i <= 2; i++) for (const sx of [-1, 1]) {
    b.box(0.016, H - 0.13, 0.016, IRON, { x: sx * hl, y: 0.135 + (H - 0.13) / 2, z: i * 0.27 });
  }
  return b.build();
}
