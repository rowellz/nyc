/**
 * NYC cobra-head street light ("Type M" octagonal tapered aluminum pole with the single upswept arm).
 * Real dimensions: pole 30 ft (9.1 m) to the arm, base 0.15 m octagon tapering to 0.09 m,
 * square transformer base cover 12" x 24" (0.3 x 0.6 m), arm ~8 ft (2.4 m) rising ~1 m, cobra head
 * luminaire ~0.75 x 0.38 x 0.2 m: narrow slipfitter neck at the arm, the wide "cobra" head with the
 * refractor bowl at the far end. Local: pole at origin, the arm points to -z (the road).
 * aData.x per instance: 0 = HPS warm (2100 K), 1 = LED (3000-4000 K).
 */
import * as THREE from 'three';
import { MeshBuilder, EMIT } from '../builder';

/** weathered grey-green aluminum: matte, low metalness so it does not go black in the shade */
const ALU = { color: 0x5f6664, rough: 0.62, metal: 0.55, grimeBand: [0, 2.4, 0.4] as [number, number, number] };
const ALU_DARK = { color: 0x404644, rough: 0.65, metal: 0.5 };
const HEAD = { color: 0x4b5250, rough: 0.55, metal: 0.6 };
const LENS = { color: 0xd8d2b8, rough: 0.35, metal: 0.0, emit: EMIT.lamp, emitStrength: 1.6 };

export const LAMP_HEIGHT = 9.1;
export const LAMP_ARM = 2.4;

export function buildLamp(detail: 'near' | 'far', led = false): THREE.BufferGeometry {
  const b = new MeshBuilder();
  // transformer base cover (the boxy pedestal every NYC pole has) with an anchor plate and a door seam
  b.box(0.4, 0.05, 0.4, ALU_DARK, { y: 0.025 });
  b.box(0.32, 0.62, 0.32, { ...ALU, grimeBand: [0, 0.6, 0.5] }, { y: 0.31 + 0.05 });
  b.box(0.36, 0.03, 0.36, ALU_DARK, { y: 0.68 });
  if (detail === 'near') b.box(0.2, 0.42, 0.01, ALU_DARK, { y: 0.36, z: 0.16 });
  // Split face normals keep all eight tapered shaft facets flat in both LODs.
  const shaft = new THREE.CylinderGeometry(0.045, 0.075, LAMP_HEIGHT - 0.7, 8).toNonIndexed();
  shaft.computeVertexNormals();
  b.add(shaft, ALU, { y: (LAMP_HEIGHT + 0.7) / 2 });
  // One continuous sweep: vertical tangent at the shaft, horizontal at the slipfitter.
  const hy = LAMP_HEIGHT + 1.0, hz = -LAMP_ARM + 0.08;
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(0, LAMP_HEIGHT, 0), new THREE.Vector3(0, hy, 0),
    new THREE.Vector3(0, hy, -1.2), new THREE.Vector3(0, hy, -LAMP_ARM),
  );
  const steps = detail === 'near' ? 32 : 16;
  const arm = new THREE.TubeGeometry(curve, steps, 1, 8, false);
  const pos = arm.getAttribute('position');
  for (let i = 0; i <= steps; i++) {
    const center = curve.getPointAt(i / steps), radius = THREE.MathUtils.lerp(0.045, 0.032, i / steps);
    for (let j = 0; j <= 8; j++) {
      const k = i * 9 + j;
      pos.setXYZ(k, center.x + (pos.getX(k) - center.x) * radius,
        center.y + (pos.getY(k) - center.y) * radius, center.z + (pos.getZ(k) - center.z) * radius);
    }
  }
  arm.computeVertexNormals();
  b.add(arm, ALU);
  if (led) {
    // Shallow rectangular LED casting, with emission confined to its downward-facing panel.
    b.box(0.12, 0.08, 0.18, HEAD, { y: hy, z: hz - 0.04 });
    b.box(0.4, 0.10, 0.74, HEAD, { y: hy - 0.01, z: hz - 0.37 });
    b.quad(0.33, 0.52, { ...LENS, color: 0xe7ebed }, { y: hy - 0.061, z: hz - 0.43, rx: Math.PI / 2 });
  } else {
    // 0.74 m cobra casting, widening into a broad drooping refractor at its far end.
    const profile: [number, number][] = [
      [0, 0], [0.065, 0], [0.10, 0.13], [0.19, 0.30],
      [0.23, 0.46], [0.22, 0.60], [0.13, 0.70], [0, 0.74],
    ];
    const hood = new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), detail === 'near' ? 16 : 10);
    hood.scale(1, 1, 0.48);
    hood.rotateX(-Math.PI / 2);
    b.add(hood, HEAD, { y: hy, z: hz });
    const bowl = new THREE.SphereGeometry(1, detail === 'near' ? 16 : 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    bowl.scale(0.21, 0.15, 0.24);
    b.add(bowl, LENS, { y: hy - 0.045, z: hz - 0.46 });
  }
  if (detail === 'near') {
    b.cyl(0.03, 0.03, 0.04, 6, { color: 0x333638, rough: 0.7, metal: 0.3 }, { y: hy + 0.10, z: hz - 0.4 });
    // eye-level stickers / paint patches on the shaft
    b.quad(0.09, 0.07, { color: 0xe8e2d0, rough: 0.8, metal: 0 }, { x: 0.0, y: 1.65, z: 0.073, keepUv: false } as never);
    b.quad(0.06, 0.06, { color: 0xc94b3c, rough: 0.8, metal: 0 }, { x: 0.038, y: 1.45, z: 0.062, ry: 0.55 });
    b.quad(0.07, 0.04, { color: 0x2b6cb0, rough: 0.8, metal: 0 }, { x: -0.047, y: 1.3, z: 0.056, ry: -0.7 });
    // base bolts
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      b.cyl(0.014, 0.014, 0.05, 6, ALU_DARK, { x: Math.cos(a) * 0.16, y: 0.05, z: Math.sin(a) * 0.16 });
    }
  }
  return b.build();
}

/** the bowl position in local space (for the point light and the ground pool) */
export const LAMP_HEAD_LOCAL = new THREE.Vector3(0, LAMP_HEIGHT + 0.9, -LAMP_ARM + 0.08 - 0.46);
