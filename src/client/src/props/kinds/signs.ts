/**
 * Sign geometries (atlas material, PROP_ATLAS): parts marked atlas:true take the instance's uv rect.
 *  - streetBlade: one 36" x 8" blade + bracket, mounted on a pole at the blade center height. Instances
 *    are placed per blade (two per corner, crossed), the pole is a separate instance (signPost).
 *  - regSign: a portrait 12" x 18" regulation sign (NO STANDING...) -- atlas rect rotated: the slot's
 *    x axis is the sign's vertical, so the quad uvs are swapped.
 *  - oneWay: 36" x 12" black/white
 *  - stopSign: 30" octagon
 *  - signPost: 3.2 m galvanized pole (solid-grey slot)
 */
import * as THREE from 'three';
import { MeshBuilder } from '../builder';
import { SLOT_W, SLOT_H, ONE_WAY_FRAC } from '../atlas';

const GALV = { color: 0x8a8d90, rough: 0.5, metal: 0.85, atlas: true, keepUv: true };

export const BLADE_W = 0.914; // 36"
export const BLADE_H = 0.2; // 8"
const BLADE_T = 0.004;
/** the blade's inner end sits this far from the pole center (clears the 0.1 m signal pole) */
export const BLADE_X0 = 0.13;

/** uv helpers: a quad whose uv covers the atlas rect fraction (fx, fy, fw, fh) - y from the top */
function atlasQuad(b: MeshBuilder, w: number, h: number, style: { color: number; rough: number; metal: number; emit?: number; emitStrength?: number }, t: { x?: number; y?: number; z?: number; ry?: number; rx?: number; rz?: number }, frac: [number, number, number, number], rotated = false, backFace = false): void {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i), v = uv.getY(i);
    if (rotated) {
      // portrait sign drawn rotated -90 in the slot: sign top is at slot's left (u=0), sign left at slot bottom (v=0)
      const nu = 1 - v, nv = u; // sign (u,v) -> slot (1-v... ) mapping: sign top (v=1) -> slot u=0
      u = 1 - nu; v = nv;
      // resolve: sign u (left->right) maps to slot v (bottom->top), sign v (bottom->top) maps to slot u (right->left)
      u = 1 - uv.getY(i);
      v = uv.getX(i);
    }
    // fraction of the slot (frac.y measured from the TOP of the slot)
    const fu = frac[0] + u * frac[2];
    const fv = 1 - frac[1] - frac[3] + v * frac[3];
    uv.setXY(i, fu, fv);
  }
  if (backFace) g.rotateY(Math.PI);
  b.add(g, { ...style, atlas: true, keepUv: true }, t);
}

export function buildStreetBlade(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  // the plate (thin box, edges in blank green from the rect itself): front face + back face both atlas-mapped
  // origin at the pole: the clamp band sits on the pole, the blade extends along +x from it
  // (retro-reflective sheeting: low roughness, no metalness)
  const plate = { color: 0xffffff, rough: 0.32, metal: 0.0 };
  const cx = BLADE_X0 + BLADE_W / 2;
  atlasQuad(b, BLADE_W, BLADE_H, plate, { x: cx, z: BLADE_T / 2 }, [0, 0, 1, 1]);
  atlasQuad(b, BLADE_W, BLADE_H, plate, { x: cx, z: -BLADE_T / 2 }, [0, 0, 1, 1], false, true);
  // edge strip (thin, uses the rect's corner pixel: fine)
  b.box(BLADE_W, BLADE_T, BLADE_T, { color: 0x0f6b3c, rough: 0.5, metal: 0.1 }, { x: cx, y: BLADE_H / 2 });
  b.box(BLADE_W, BLADE_T, BLADE_T, { color: 0x0f6b3c, rough: 0.5, metal: 0.1 }, { x: cx, y: -BLADE_H / 2 });
  // bracket: the cast clamp band around the pole plus the short arm out to the blade's inner end
  const cast = { color: 0x6c6f70, rough: 0.55, metal: 0.8 };
  b.cyl(0.055, 0.055, 0.11, 8, cast, { y: -0.055 });
  b.box(BLADE_X0, 0.03, 0.03, cast, { x: BLADE_X0 / 2, y: 0.04 });
  b.box(BLADE_X0, 0.03, 0.03, cast, { x: BLADE_X0 / 2, y: -0.04 });
  b.box(0.03, 0.14, 0.03, cast, { x: BLADE_X0 + 0.015, z: 0.012 });
  return b.build();
}

/** portrait regulation sign 12" x 18" (0.3 x 0.46) with the atlas slot rotated */
export function buildRegSign(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const W = 0.305, H = 0.457;
  const plate = { color: 0xffffff, rough: 0.45, metal: 0.1 };
  // the portrait sign is drawn rotated: it occupies slot x in [0, SLOT_H/SLOT_W * (H/W)...]. Portrait w=64px? No:
  // drawRotated draws with portrait width = SLOT_H (64 px) and height = SLOT_W (384) -> 1:6 which is too tall;
  // the drawers use (w=64, h=384) but scale their content to w. We map the sign's 0.305 x 0.457 onto the
  // top 64 x 96 px of that portrait area (fraction of the slot: x 0..0.25, y 0..1).
  const fracW = (H / W) * (SLOT_H / SLOT_W); // sign height in slot-x fraction
  atlasQuad(b, W, H, plate, { z: 0.002 }, [0, 0, fracW, 1], true);
  atlasQuad(b, W, H, { color: 0xb8bbbe, rough: 0.5, metal: 0.7 }, { z: -0.002 }, [0, 0, fracW, 1], true, true);
  return b.build();
}

/** ONE WAY 36" x 12" plate (exact 3:1 atlas face with inset margins) */
export function buildOneWay(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const W = 0.914, H = 0.305;
  const plate = { color: 0xffffff, rough: 0.45, metal: 0.1 };
  atlasQuad(b, W, H, plate, { z: 0.002 }, [0, 0, ONE_WAY_FRAC, 1]);
  atlasQuad(b, W, H, { color: 0xb8bbbe, rough: 0.5, metal: 0.7 }, { z: -0.002 }, [0, 0, ONE_WAY_FRAC, 1], false, true);
  // Two short stand-off straps connect the plate's inner edge back to the pole.
  for (const y of [-0.09, 0.09]) b.box(BLADE_X0 + 0.04, 0.025, 0.025,
    { color: 0x6c6f70, rough: 0.55, metal: 0.8 }, { x: -W / 2 - BLADE_X0 / 2, y });
  return b.build();
}

/** STOP sign 30" (0.76 m) octagon on its own 2.1 m pole */
export function buildStopSign(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const S = 0.76;
  const plate = { color: 0xffffff, rough: 0.4, metal: 0.1 };
  const fracW = SLOT_H / SLOT_W; // square drawn in the left h x h of the slot
  atlasQuad(b, S, S, plate, { y: 2.2, z: 0.002 }, [0, 0, fracW, 1]);
  atlasQuad(b, S, S, { color: 0xb8bbbe, rough: 0.5, metal: 0.7 }, { y: 2.2, z: -0.002 }, [0, 0, fracW, 1], false, true);
  b.cyl(0.03, 0.03, 2.3, 8, GALV, { y: 0 });
  return b.build();
}

/** plain 3.2 m sign post (2" galvanized pipe) with a cap; solid-grey atlas slot */
export function buildSignPost(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  b.cyl(0.028, 0.03, 3.3, 8, GALV);
  b.sphere(0.034, 6, GALV, { y: 3.3 });
  return b.build();
}

/** Muni-Meter kiosk: 1.55 m grey pedestal with the pay panel (atlas 'muni' slot, rotated) */
export function buildMuniMeter(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const body = { color: 0x9a9da0, rough: 0.5, metal: 0.8, atlas: true, keepUv: true };
  b.box(0.3, 1.5, 0.28, { ...body, grimeBand: [0, 0.6, 0.3] }, { y: 0.75 });
  b.box(0.34, 0.06, 0.32, { color: 0x3a3d40, rough: 0.6, metal: 0.7, atlas: true, keepUv: true }, { y: 1.53 });
  b.box(0.36, 0.04, 0.34, { color: 0x3a3d40, rough: 0.6, metal: 0.7, atlas: true, keepUv: true }, { y: 0.02 });
  const fracW = (0.9 / 0.3) * (SLOT_H / SLOT_W);
  atlasQuad(b, 0.26, 0.78, { color: 0xffffff, rough: 0.4, metal: 0.2 }, { y: 1.0, z: -0.141 }, [0, 0, Math.min(1, fracW), 1], true, true);
  return b.build();
}
