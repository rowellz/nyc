/**
 * Sidewalk-cafe dressing and the small planted things that make a Village block read as lived in
 * (refs/_sheets/west-village.png 1-2: Via Carota's single row of two-tops against the wall behind a
 * low planter run, market umbrellas, a chalkboard by the door; ART_DIRECTION §1 cue 5, §6).
 * Real dimensions. Local frame: +x runs along the facade, -z toward the street, origin on the paving.
 */
import * as THREE from 'three';
import { MeshBuilder } from '../builder';

const STEEL_BLACK = { color: 0x1c1d1f, rough: 0.5, metal: 0.7 };
const STEEL_BLACK_G = { ...STEEL_BLACK, grimeBand: [0, 0.12, 0.3] as [number, number, number] };
const WOOD_DARK = { color: 0x3a2a1c, rough: 0.8, metal: 0 };
const SOIL = { color: 0x2b2117, rough: 1, metal: 0 };
const LEAF = { color: 0x2c4f27, rough: 0.95, metal: 0 };
const LEAF_LIGHT = { color: 0x4a7a3a, rough: 0.95, metal: 0 };
const TERRACOTTA = { color: 0x9c5a3c, rough: 0.9, metal: 0 };

/**
 * Parisian bistro two-top: 0.6 m round steel table on a pedestal base, two chairs across it along +/-x.
 * The chairs carry real slatted seats and backs with thickness (18 mm boards on a 36 mm tube frame): a
 * 12 mm stick frame with a flat seat plate read as bent wire at 10-30 m (round-4 critic).
 */
export function buildCafeTable(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const top = { color: 0x2a2b2d, rough: 0.45, metal: 0.4 };
  // table: cast base, column, round top with a rolled edge
  b.cyl(0.2, 0.24, 0.03, 12, STEEL_BLACK_G);
  b.cyl(0.032, 0.038, 0.68, 8, STEEL_BLACK, { y: 0.03 });
  b.cyl(0.3, 0.3, 0.02, 16, top, { y: 0.71 });
  b.cyl(0.31, 0.31, 0.012, 16, STEEL_BLACK, { y: 0.71 });
  // a cup, a folded menu: enough for the eye to read a set table at 8 m
  b.cyl(0.035, 0.03, 0.08, 8, { color: 0xf1ede4, rough: 0.5, metal: 0 }, { x: 0.1, y: 0.73, z: -0.06 });
  b.box(0.16, 0.004, 0.11, { color: 0xe9e2cf, rough: 0.8, metal: 0 }, { x: -0.1, y: 0.732, z: 0.07, ry: 0.4 });
  // chairs: seat 0.4 x 0.4 at 0.45 m on a 36 mm tube frame, slatted seat and back in warm rattan tones
  const rattan = { color: 0x8a5f34, rough: 0.85, metal: 0 };
  const rattan2 = { color: 0x5d3f24, rough: 0.85, metal: 0 };
  for (const s of [-1, 1]) {
    const cx = s * 0.58;
    const facing = s > 0 ? -Math.PI / 2 : Math.PI / 2; // seat faces the table
    const chair = new MeshBuilder();
    // seat: six 46 mm boards with 18 mm thickness and 20 mm gaps, on a tube rail frame
    for (let i = 0; i < 6; i++) chair.box(0.4, 0.018, 0.046, i % 2 ? rattan2 : rattan, { y: 0.452, z: -0.165 + i * 0.066 });
    for (const sz of [-0.19, 0.19]) chair.cylC(0.016, 0.016, 0.4, 6, STEEL_BLACK, { y: 0.432, z: sz, rz: Math.PI / 2 });
    for (const sx of [-0.19, 0.19]) chair.cylC(0.016, 0.016, 0.4, 6, STEEL_BLACK, { x: sx, y: 0.432, rx: Math.PI / 2 });
    for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) chair.tube([lx, 0, lz], [lx * 0.9, 0.44, lz * 0.9], 0.018, 6, STEEL_BLACK_G);
    // back: two uprights, a curved hoop and three slats with thickness
    chair.tube([-0.19, 0.44, 0.19], [-0.17, 0.9, 0.205], 0.017, 6, STEEL_BLACK);
    chair.tube([0.19, 0.44, 0.19], [0.17, 0.9, 0.205], 0.017, 6, STEEL_BLACK);
    const hoop = new THREE.TorusGeometry(0.17, 0.017, 6, 12, Math.PI);
    chair.add(hoop, STEEL_BLACK, { y: 0.9, z: 0.203 });
    for (let i = 0; i < 3; i++) chair.box(0.3, 0.05, 0.016, i % 2 ? rattan2 : rattan, { y: 0.63 + i * 0.1, z: 0.2 });
    b.merge(chair, { x: cx, ry: facing });
  }
  return b.build();
}

/** Market umbrella: 1.9 m octagonal canopy, 2.15 m to the finial, cast-iron base plate. Two canvas colours as kinds. */
export function buildCafeUmbrella(canvas: 'cream' | 'green'): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const cloth = canvas === 'cream' ? { color: 0xe4d8bc, rough: 0.9, metal: 0 } : { color: 0x1f5132, rough: 0.9, metal: 0 };
  const wood = { color: 0x7a5a38, rough: 0.7, metal: 0 };
  b.cyl(0.24, 0.26, 0.04, 12, STEEL_BLACK_G);
  b.cyl(0.022, 0.022, 2.05, 8, wood, { y: 0.04 });
  // canopy: an 8-panel cone open below, its rim scalloped by a short valance
  const cone = new THREE.ConeGeometry(0.95, 0.32, 8, 1, true);
  b.add(cone, cloth, { y: 1.98 });
  const under = new THREE.ConeGeometry(0.94, 0.32, 8, 1, true);
  under.scale(1, 1, 1);
  under.index!.array.reverse(); // inside faces: the underside is what a sitter and a low camera see
  b.add(under, { ...cloth, color: canvas === 'cream' ? 0xcfc3a6 : 0x17402a }, { y: 1.975 });
  const valance = new THREE.CylinderGeometry(0.95, 0.95, 0.12, 8, 1, true);
  b.add(valance, cloth, { y: 1.76 });
  // ribs under the canopy and the finial
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    b.tube([0, 2.1, 0], [Math.cos(a) * 0.9, 1.84, Math.sin(a) * 0.9], 0.008, 4, wood);
  }
  b.cyl(0.03, 0.02, 0.08, 6, wood, { y: 2.12 });
  return b.build();
}

/** Planter run module: 0.9 m black steel box with dark stained slats and mulch; boxwood is the 'shrub' kind on top. */
export function buildCafePlanter(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const L = 0.9, D = 0.34, H = 0.46;
  b.box(L, H, D, WOOD_DARK, { y: H / 2 });
  // slat grooves as thin darker bands; steel corner angles and cap rail
  for (let i = 1; i < 4; i++) b.box(L + 0.004, 0.012, D + 0.004, { color: 0x221810, rough: 0.9, metal: 0 }, { y: (H / 4) * i });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(0.03, H, 0.03, STEEL_BLACK_G, { x: sx * (L / 2 - 0.015), y: H / 2, z: sz * (D / 2 - 0.015) });
  b.box(L + 0.02, 0.025, D + 0.02, STEEL_BLACK, { y: H - 0.0125 });
  b.box(L - 0.06, 0.02, D - 0.06, SOIL, { y: H - 0.03 });
  // clipped boxwood body: a rounded green mass the alpha shrub cards sit around
  b.box(L - 0.14, 0.34, D - 0.1, LEAF, { y: H + 0.15 });
  b.box(L - 0.3, 0.12, D - 0.2, LEAF_LIGHT, { y: H + 0.36 });
  return b.build();
}

/** A-frame chalkboard by the door: 0.6 x 0.95 m, oak frame, black boards with a few chalk lines. */
export function buildSandwichBoard(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const oak = { color: 0x8a6a42, rough: 0.75, metal: 0 };
  const board = { color: 0x101211, rough: 0.7, metal: 0 };
  const chalk = { color: 0xe8e4d6, rough: 0.9, metal: 0 };
  const chalkPink = { color: 0xe6a0b0, rough: 0.9, metal: 0 };
  const tilt = 0.18;
  for (const s of [-1, 1]) {
    const leaf = new MeshBuilder();
    leaf.box(0.6, 0.95, 0.025, oak, { y: 0.475 });
    leaf.box(0.5, 0.78, 0.004, board, { y: 0.5, z: -0.015 });
    // chalk: a title line and four menu lines, slightly ragged lengths
    leaf.box(0.3, 0.035, 0.002, chalkPink, { y: 0.8, z: -0.018 });
    for (let i = 0; i < 4; i++) leaf.box(0.24 + (i % 2) * 0.1, 0.014, 0.002, chalk, { x: -0.06 + (i % 3) * 0.02, y: 0.66 - i * 0.11, z: -0.018 });
    leaf.box(0.16, 0.03, 0.002, chalk, { y: 0.2, z: -0.018 });
    b.merge(leaf, { z: s * 0.09, rx: -s * tilt, ry: s > 0 ? 0 : Math.PI });
  }
  b.box(0.06, 0.03, 0.06, oak, { y: 0.93 });
  return b.build();
}

/** Windowsill flower box: 1.1 m painted timber box on the stone sill, geraniums and trailing ivy. */
export function buildFlowerBox(variant: 0 | 1): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const paint = variant === 0 ? { color: 0x1f4a2c, rough: 0.7, metal: 0 } : { color: 0x4a2f22, rough: 0.8, metal: 0 };
  const W = 1.1, D = 0.22, H = 0.2;
  // the box projects over the sill nose: back face on the wall plane (z = 0), body toward -z
  b.box(W, H, D, paint, { y: H / 2, z: -D / 2 });
  b.box(W + 0.03, 0.02, D + 0.03, { ...paint, color: variant === 0 ? 0x2a5e3a : 0x5e3d2c }, { y: H - 0.01, z: -D / 2 });
  b.box(W - 0.04, 0.02, D - 0.04, SOIL, { y: H - 0.02, z: -D / 2 });
  // foliage mound with blooms: red / pink / white in a seeded pattern so instances differ by variant only
  const blooms = variant === 0 ? [0xc8232a, 0xe04c5a, 0xf0e8e0] : [0xf2f0ea, 0xe86aa0, 0xd8b030];
  for (let i = 0; i < 9; i++) {
    const x = -W / 2 + 0.08 + (i + 0.5) * ((W - 0.16) / 9);
    const z = -D / 2 + ((i % 3) - 1) * 0.05;
    b.sphere(0.075 + (i % 2) * 0.02, 6, i % 4 === 1 ? LEAF_LIGHT : LEAF, { x, y: H + 0.05, z });
    b.sphere(0.035, 5, { color: blooms[i % 3], rough: 0.8, metal: 0 }, { x: x + 0.02, y: H + 0.13 + (i % 2) * 0.03, z: z - 0.03 });
  }
  // trailing ivy strands over the front lip
  for (let i = 0; i < 4; i++) {
    const x = -W / 2 + 0.15 + i * (W - 0.3) / 3;
    b.box(0.06, 0.28, 0.02, LEAF, { x, y: H - 0.1, z: -D - 0.005, rz: (i % 2 ? 1 : -1) * 0.15 });
  }
  return b.build();
}

/** What tenants put on a fire-escape landing: two terracotta pots with a tomato cage and a spider plant, a watering can. */
export function buildEscapePlants(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const z = -0.45;
  // pots on the grating, toward the -x end (the stair lands at +x)
  b.cyl(0.13, 0.1, 0.24, 10, TERRACOTTA, { x: -0.95, z });
  b.cyl(0.12, 0.12, 0.02, 10, SOIL, { x: -0.95, y: 0.23, z });
  b.cyl(0.11, 0.085, 0.2, 10, { ...TERRACOTTA, color: 0x7d4a30 }, { x: -0.62, z: z - 0.15 });
  b.cyl(0.1, 0.1, 0.02, 10, SOIL, { x: -0.62, y: 0.19, z: z - 0.15 });
  // tomato cage + leafy mass
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.tube([-0.95 + Math.cos(a) * 0.1, 0.24, z + Math.sin(a) * 0.1], [-0.95 + Math.cos(a) * 0.12, 1.1, z + Math.sin(a) * 0.12], 0.005, 4, { color: 0x6b6f72, rough: 0.6, metal: 0.7 });
  }
  b.sphere(0.2, 7, LEAF, { x: -0.95, y: 0.62, z });
  b.sphere(0.16, 6, LEAF_LIGHT, { x: -0.9, y: 0.88, z: z + 0.03 });
  b.sphere(0.03, 5, { color: 0xd8341e, rough: 0.6, metal: 0 }, { x: -0.8, y: 0.7, z: z - 0.12 });
  // spider plant: splayed blades
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.box(0.03, 0.3, 0.008, i % 2 ? LEAF_LIGHT : { color: 0x9fbf6a, rough: 0.9, metal: 0 }, { x: -0.62 + Math.cos(a) * 0.1, y: 0.32, z: z - 0.15 + Math.sin(a) * 0.1, rz: Math.cos(a) * 0.7, rx: -Math.sin(a) * 0.7 });
  }
  // galvanised watering can
  b.cyl(0.09, 0.1, 0.2, 8, { color: 0x9a9d9f, rough: 0.45, metal: 0.8 }, { x: -0.3, z: z + 0.1 });
  b.tube([-0.22, 0.08, z + 0.1], [-0.05, 0.22, z + 0.1], 0.012, 5, { color: 0x9a9d9f, rough: 0.45, metal: 0.8 });
  return b.build();
}

/**
 * Storefront-awning hardware. The buildings module bakes the canvas itself (buildings/builder.ts
 * storefronts(): yTop = gfH - 0.8 at the fascia, front edge 1.6 m out and 0.8 m lower, a 0.32 m
 * valance); baked alone it reads as one unsupported plane (round-4 critic). These two instanced
 * kinds add what a real awning has: a scalloped hem below the valance and the rafter/knee-brace
 * frame carrying it back into the facade, both shadow-casting.
 *
 * Local frame for both: the wall plane at x = 0, z = 0, origin at the awning's FRONT-EDGE height
 * (absolute gfH - 1.6); +x runs along the wall, -z out over the sidewalk. The canvas therefore runs
 * from (z = -0.02, y = +0.80) at the fascia to (z = -1.60, y = 0) at the front bar.
 */
const AWN_HEM = { color: 0x191b19, rough: 0.9, metal: 0 };   // reads as the valance's own shadowed hem on every AWNING_COLORS canvas
const AWN_ROD = { color: 0x2b2d2f, rough: 0.45, metal: 0.7 };

/** 1.04 m of scalloped hem: four half-round dips proud of the baked valance, on a valance rod. */
export function buildAwningHem(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  for (let i = 0; i < 4; i++) b.cylC(0.12, 0.12, 0.014, 8, AWN_HEM, { x: -0.39 + i * 0.26, y: -0.32, z: -1.607, rx: Math.PI / 2 });
  b.cylC(0.014, 0.014, 1.06, 6, AWN_ROD, { y: -0.325, z: -1.623, rz: Math.PI / 2 });
  return b.build();
}

/** One awning rafter: wall bracket, the rafter under the slope, a knee brace and the valance return. */
export function buildAwningRig(): THREE.BufferGeometry {
  const steel = { color: 0x26282a, rough: 0.5, metal: 0.65 };
  const b = new MeshBuilder();
  b.box(0.10, 0.20, 0.05, steel, { y: 0.72, z: -0.025 });          // wall bracket plate
  b.tube([0, 0.765, -0.03], [0, -0.03, -1.585], 0.019, 6, steel);  // rafter under the canvas
  b.tube([0, -0.50, -0.05], [0, -0.05, -1.50], 0.014, 5, steel);   // knee brace back into the wall
  b.box(0.09, 0.55, 0.05, steel, { y: -0.53, z: -0.03 });          // lower wall plate the brace lands on
  b.cylC(0.012, 0.012, 0.36, 5, steel, { y: -0.17, z: -1.592 });   // valance return rod at the front bar
  b.box(0.018, 0.09, 1.58, steel, { y: 0.38, z: -0.81, rx: -0.463 }); // gusset cheek along the slope
  return b.build();
}
