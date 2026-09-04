/**
 * NYC sidewalk shed (Local Law 11 scaffolding). Built per 2.4 m bay and instanced per bay:
 *   - two rows of 2" steel pipe posts (at the building line and 0.5 m inside the curb), 4.3 m tall
 *   - diagonal cross bracing between posts along the curb row, horizontal ledgers, clamp couplers
 *   - plank deck at 4.3 m, 3.9 m deep (the sidewalk), on timber joists, corrugated sheet on top
 *   - hunter-green plywood parapet 1.07 m high on the curb side + the fluorescent tube under the deck
 *   - yellow/black reflective tape on the curb posts, a plywood toe board at the curb
 * Local frame: bay origin at the building wall, the bay runs along +x (2.4 m), the sidewalk toward -z.
 * Per instance aData = the plywood sheet uv offset (x = 0 or 0.5 picks the POST NO BILLS / permit sheet).
 * The plywood material is selective: only parts tagged `textured` sample the green plywood map.
 */
import * as THREE from 'three';
import { MeshBuilder, EMIT } from '../builder';

export const BAY = 2.4;
export const SHED_H = 4.3;
export const SHED_DEPTH = 3.9;
export const PARAPET_H = 1.07;

const PIPE = { color: 0x6a6d70, rough: 0.55, metal: 0.8, grimeBand: [0, 1.0, 0.3] as [number, number, number] };
const PIPE_RUST = { color: 0x6b5a4a, rough: 0.7, metal: 0.6 };
const CLAMP = { color: 0x3c3e40, rough: 0.6, metal: 0.8 };
const PLY = { color: 0xffffff, rough: 0.8, metal: 0.0, keepUv: true, atlas: true, textured: true };
const PLY_EDGE = { color: 0x21492e, rough: 0.8, metal: 0.0 };
const DECK = { color: 0x8f9296, rough: 0.6, metal: 0.8 };
const PLANK = { color: 0x7a6a52, rough: 0.9, metal: 0, grimeBand: [SHED_H - 0.3, SHED_H + 0.1, 0.35] as [number, number, number] };
const TIMBER = { color: 0x9a7b56, rough: 0.9, metal: 0 };
const TUBE = { color: 0xf6f3e6, rough: 0.5, metal: 0, emit: EMIT.nightGlow, emitStrength: 3.5 };
const FIXTURE = { color: 0xd7d7d7, rough: 0.6, metal: 0.5 };
const TAPE_Y = { color: 0xe6c11c, rough: 0.5, metal: 0 };
const TAPE_K = { color: 0x111111, rough: 0.6, metal: 0 };

/** plywood box whose front/back faces map `wSheets` x `hSheets` of the texture (keepUv, instance offset added) */
function plySheet(w: number, h: number, sheetsW: number, sheetsH: number): THREE.BoxGeometry {
  const ply = new THREE.BoxGeometry(w, h, 0.02);
  const uv = ply.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sheetsW * 0.5, uv.getY(i) * sheetsH);
  return ply;
}

export function buildShedBay(detail: 'near' | 'far'): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const near = detail === 'near';
  const seg = near ? 7 : 5;
  const r = 0.024;
  const zWall = -0.15, zCurb = -SHED_DEPTH + 0.05;
  // posts at x=0 (the bay start; the next bay provides the far post)
  for (const z of [zWall, zCurb]) {
    b.tube([0, 0, z], [0, SHED_H, z], r, seg, PIPE);
    // base plate on a timber sill (mud sill), screw jack collar
    b.box(0.15, 0.02, 0.15, CLAMP, { x: 0, y: 0.01, z });
    b.box(0.3, 0.04, 0.3, TIMBER, { x: 0, y: 0.02, z });
    if (near) {
      b.box(0.08, 0.06, 0.08, CLAMP, { x: 0, y: 1.9, z });
      b.box(0.08, 0.06, 0.08, CLAMP, { x: 0, y: SHED_H - 0.4, z });
      b.cyl(0.035, 0.035, 0.12, 6, CLAMP, { x: 0, y: 0.05, z });
    }
  }
  // reflective tape bands on the curb post (yellow/black), 0.5 - 1.4 m
  for (let i = 0; i < 6; i++) b.cyl(r + 0.004, r + 0.004, 0.15, near ? 7 : 5, i % 2 ? TAPE_K : TAPE_Y, { x: 0, y: 0.5 + i * 0.15, z: zCurb });
  // transverse header at the top and a knee brace toward the curb post
  b.tube([0, SHED_H - 0.15, zWall], [0, SHED_H - 0.15, zCurb], r, seg, PIPE);
  if (near) b.tube([0, SHED_H - 1.1, zCurb], [0, SHED_H - 0.2, zCurb + 0.9], r * 0.8, 5, PIPE_RUST);
  // longitudinal ledgers (curb row and wall row) at the top and at 1.9 m
  for (const z of [zWall, zCurb]) {
    b.tube([0, SHED_H - 0.25, z], [BAY, SHED_H - 0.25, z], r, seg, PIPE);
    if (near) b.tube([0, 1.9, z], [BAY, 1.9, z], r, seg, PIPE_RUST);
  }
  // diagonal cross-bracing on the curb row: the X in every bay, with clamps where the tubes cross
  b.tube([0, 0.3, zCurb + 0.05], [BAY, SHED_H - 0.5, zCurb + 0.05], r * 0.85, seg, PIPE);
  b.tube([0, SHED_H - 0.5, zCurb + 0.09], [BAY, 0.3, zCurb + 0.09], r * 0.85, seg, PIPE);
  if (near) {
    b.box(0.09, 0.09, 0.1, CLAMP, { x: BAY / 2, y: (SHED_H - 0.2) / 2, z: zCurb + 0.07 });
    b.box(0.07, 0.07, 0.1, CLAMP, { x: 0.02, y: 0.3, z: zCurb + 0.07 });
    b.box(0.07, 0.07, 0.1, CLAMP, { x: 0.02, y: SHED_H - 0.5, z: zCurb + 0.07 });
  }
  // deck: 2x10 planks (seen from below) on timber joists, corrugated sheet + gravel guard on top
  b.box(BAY, 0.04, SHED_DEPTH + 0.1, DECK, { x: BAY / 2, y: SHED_H + 0.02, z: -SHED_DEPTH / 2 });
  b.box(BAY, 0.05, SHED_DEPTH + 0.1, PLANK, { x: BAY / 2, y: SHED_H - 0.03, z: -SHED_DEPTH / 2 });
  if (near) {
    // plank seams: thin dark strips every 0.25 m across the bay
    for (let i = 1; i < 10; i++) b.box(0.012, 0.012, SHED_DEPTH + 0.1, { color: 0x2a2419, rough: 0.9, metal: 0 }, { x: i * 0.25, y: SHED_H - 0.055, z: -SHED_DEPTH / 2 });
    for (let i = 0; i < 3; i++) b.box(0.08, 0.24, SHED_DEPTH, TIMBER, { x: 0.4 + i * 0.8, y: SHED_H - 0.17, z: -SHED_DEPTH / 2 });
    // steel needle beam across the bay under the joists at the curb post
    b.box(0.1, 0.12, SHED_DEPTH - 0.3, CLAMP, { x: 0.05, y: SHED_H - 0.36, z: -SHED_DEPTH / 2 });
    // corrugation ridges on top of the deck (visible from above / from windows)
    for (let i = 0; i < 12; i++) b.box(BAY, 0.025, 0.03, DECK, { x: BAY / 2, y: SHED_H + 0.05, z: -0.2 - i * 0.32 });
  }
  // parapet: green plywood on the curb side, sitting on the deck; one bay = one sheet (instance picks which)
  b.add(plySheet(BAY, PARAPET_H, BAY / 2.44, PARAPET_H / 1.22), PLY, { x: BAY / 2, y: SHED_H + 0.04 + PARAPET_H / 2, z: zCurb - 0.05 });
  b.box(BAY, 0.05, 0.08, PLY_EDGE, { x: BAY / 2, y: SHED_H + PARAPET_H + 0.06, z: zCurb - 0.05 });
  // parapet posts (2x4) behind the plywood + a top rail
  b.box(0.05, PARAPET_H, 0.1, TIMBER, { x: 0.05, y: SHED_H + 0.04 + PARAPET_H / 2, z: zCurb + 0.03 });
  b.box(BAY, 0.04, 0.09, TIMBER, { x: BAY / 2, y: SHED_H + PARAPET_H - 0.1, z: zCurb + 0.03 });
  // the plywood toe board at the curb (0.3 m), grimy
  b.add(plySheet(BAY, 0.3, BAY / 2.44, 0.3 / 1.22), { ...PLY, grimeBand: [0, 0.3, 0.4] }, { x: BAY / 2, y: 0.17, z: zCurb - 0.04 });
  // the light: fluorescent fixture under the deck, centered in the bay, with its wire guard
  b.box(1.25, 0.06, 0.1, FIXTURE, { x: BAY / 2, y: SHED_H - 0.3, z: -SHED_DEPTH / 2 });
  b.cylC(0.02, 0.02, 1.2, 6, TUBE, { x: BAY / 2, y: SHED_H - 0.35, z: -SHED_DEPTH / 2, rz: Math.PI / 2 });
  if (near) {
    for (const dz of [-0.05, 0.05]) b.tube([BAY / 2 - 0.6, SHED_H - 0.4, -SHED_DEPTH / 2 + dz], [BAY / 2 + 0.6, SHED_H - 0.4, -SHED_DEPTH / 2 + dz], 0.004, 3, CLAMP);
    // the conduit feeding the fixture along the deck underside
    b.tube([BAY / 2, SHED_H - 0.08, -SHED_DEPTH / 2], [BAY / 2, SHED_H - 0.08, zWall], 0.01, 4, CLAMP);
  }
  return b.build();
}

/** the end wall of a shed: the plywood return panel over the deck plus the diagonal raker to the wall */
export function buildShedEnd(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const ply = plySheet(SHED_DEPTH - 0.2, PARAPET_H, SHED_DEPTH / 2.44, PARAPET_H / 1.22);
  ply.rotateY(Math.PI / 2);
  b.add(ply, PLY, { x: 0, y: SHED_H + 0.04 + PARAPET_H / 2, z: -SHED_DEPTH / 2 });
  b.box(0.08, 0.05, SHED_DEPTH - 0.2, PLY_EDGE, { x: 0, y: SHED_H + PARAPET_H + 0.06, z: -SHED_DEPTH / 2 });
  b.tube([0, 0.3, -0.15], [0, SHED_H - 0.5, -SHED_DEPTH + 0.05], 0.02, 6, PIPE);
  b.tube([0, 1.9, -0.15], [0, 1.9, -SHED_DEPTH + 0.05], 0.024, 6, PIPE_RUST);
  return b.build();
}

/** the closing post pair at the far end of a shed (every bay only carries the post at its start) */
export function buildShedPost(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const r = 0.024;
  const zWall = -0.15, zCurb = -SHED_DEPTH + 0.05;
  for (const z of [zWall, zCurb]) {
    b.tube([0, 0, z], [0, SHED_H, z], r, 7, PIPE);
    b.box(0.15, 0.02, 0.15, CLAMP, { y: 0.01, z });
    b.box(0.3, 0.04, 0.3, TIMBER, { y: 0.02, z });
    b.box(0.08, 0.06, 0.08, CLAMP, { y: 1.9, z });
    b.box(0.08, 0.06, 0.08, CLAMP, { y: SHED_H - 0.4, z });
  }
  b.tube([0, SHED_H - 0.15, zWall], [0, SHED_H - 0.15, zCurb], r, 7, PIPE);
  for (let i = 0; i < 6; i++) b.cyl(r + 0.004, r + 0.004, 0.15, 7, i % 2 ? TAPE_K : TAPE_Y, { y: 0.5 + i * 0.15, z: zCurb });
  return b.build();
}

/** debris netting hung from the parapet to ~2.2 m (a dark green translucent sheet, alphaTest material) */
export function buildShedNet(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const net = new THREE.PlaneGeometry(BAY, SHED_H - 2.2);
  const uv = net.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i) * 10);
  b.add(net, { color: 0x1d4a2a, rough: 0.9, metal: 0, keepUv: true, textured: true }, { x: BAY / 2, y: 2.2 + (SHED_H - 2.2) / 2, z: -SHED_DEPTH + 0.02 });
  return b.build();
}

