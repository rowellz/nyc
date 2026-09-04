/**
 * Tenement fire escape, instanced per landing module. Local frame: the wall is the plane z = 0, the
 * escape projects toward -z (out from the facade), x along the facade, origin at the landing floor.
 *   - landing 2.6 m wide x 0.95 m deep, open steel grating floor, 0.95 m railings with vertical balusters
 *     and a cast finial on every corner post; angle-iron wall brackets bolted flush to the facade
 *   - stair from this landing down to the next one (slope, along +x direction, drops 3.2 m: one floor)
 *   - a drop ladder module (buildFireEscapeLadder) hangs from the lowest landing
 * Everything black wrought iron with rust (vertex grime). The lowest landing sits at FE_BASE above the
 * sidewalk (NYC ground floors are tall); landings repeat every FLOOR_H above it.
 */
import * as THREE from 'three';
import { MeshBuilder } from '../builder';

export const FE_W = 2.6;
export const FE_D = 0.95;
export const FLOOR_H = 3.2;
export const FE_BASE = 4.5;

// Painted iron reads as very dark grey in daylight, not as a mirror; keep metalness moderate.
const IRON = { color: 0x1e1f21, rough: 0.6, metal: 0.45 };
const IRON_RUST = { color: 0x3a2b20, rough: 0.8, metal: 0.3 };
const GRATE = { color: 0x232426, rough: 0.7, metal: 0.4 };

export function buildFireEscapeLanding(detail: 'near' | 'far', withStair: boolean): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const near = detail === 'near';
  const seg = near ? 6 : 4;
  const rail = 0.018;
  const zOut = -FE_D;
  // floor: frame angle irons + grating slats
  b.box(FE_W, 0.06, 0.06, IRON_RUST, { y: 0.0, z: -0.03 });
  b.box(FE_W, 0.06, 0.06, IRON_RUST, { y: 0.0, z: zOut + 0.03 });
  b.box(0.06, 0.06, FE_D, IRON_RUST, { x: -FE_W / 2 + 0.03, y: 0, z: zOut / 2 });
  b.box(0.06, 0.06, FE_D, IRON_RUST, { x: FE_W / 2 - 0.03, y: 0, z: zOut / 2 });
  const slats = near ? 22 : 8;
  for (let i = 0; i < slats; i++) {
    const x = -FE_W / 2 + 0.1 + (i + 0.5) * ((FE_W - 0.2) / slats);
    b.box(near ? 0.025 : 0.06, 0.035, FE_D - 0.1, GRATE, { x, y: 0.0, z: zOut / 2 });
  }
  // wall brackets: angle irons bolted to the facade with the diagonal strut under the landing
  for (const x of [-FE_W / 2 + 0.1, FE_W / 2 - 0.1]) {
    b.box(0.08, 0.9, 0.05, IRON_RUST, { x, y: -0.4, z: -0.02 });
    b.tube([x, -0.75, -0.01], [x, -0.03, zOut + 0.08], 0.02, seg, IRON_RUST);
    b.box(0.08, 0.05, FE_D - 0.05, IRON_RUST, { x, y: -0.045, z: zOut / 2 });
  }
  // railings: top rail, mid rail, corner posts with finials, balusters (outer side + both ends except the stair gap)
  const H = 0.95;
  const posts: [number, number][] = [[-FE_W / 2, zOut], [FE_W / 2, zOut], [-FE_W / 2, 0], [FE_W / 2, 0]];
  for (const [x, z] of posts) {
    b.tube([x, 0, z], [x, H + 0.08, z], 0.02, seg, IRON);
    if (near) b.sphere(0.035, 6, IRON, { x, y: H + 0.1, z });
  }
  b.tube([-FE_W / 2, H, zOut], [FE_W / 2, H, zOut], rail, seg, IRON);
  b.tube([-FE_W / 2, H * 0.5, zOut], [FE_W / 2, H * 0.5, zOut], rail * 0.8, seg, IRON);
  // end rails: the stair side (+x end) is open where the stair lands; the -x end is closed
  b.tube([-FE_W / 2, H, zOut], [-FE_W / 2, H, 0], rail, seg, IRON);
  b.tube([-FE_W / 2, H * 0.5, zOut], [-FE_W / 2, H * 0.5, 0], rail * 0.8, seg, IRON);
  b.tube([FE_W / 2, H, zOut], [FE_W / 2, H, zOut + 0.45], rail, seg, IRON);
  if (near) {
    const n = 16;
    for (let i = 1; i < n; i++) {
      const x = -FE_W / 2 + (i / n) * FE_W;
      b.tube([x, 0.02, zOut], [x, H, zOut], 0.009, 4, IRON);
    }
    for (let i = 1; i < 6; i++) {
      const z = zOut + (i / 6) * FE_D;
      b.tube([-FE_W / 2, 0.02, z], [-FE_W / 2, H, z], 0.009, 4, IRON);
    }
  } else {
    // far: a few heavier balusters keep the railing an open lattice at distance, not a solid panel
    for (let i = 1; i < 6; i++) {
      const x = -FE_W / 2 + (i / 6) * FE_W;
      b.tube([x, 0.02, zOut], [x, H, zOut], 0.014, 3, IRON);
    }
  }
  if (withStair) {
    // stair: from the +x end of this landing (x = FE_W/2 - 0.35, y=0) down one floor to the landing below,
    // running along -x, in the outer half of the depth. Stringers + treads + a handrail.
    const x0 = FE_W / 2 - 0.3, x1 = -FE_W / 2 + 0.3;
    const y0 = 0, y1 = -FLOOR_H;
    const zc = zOut + 0.35;
    const w = 0.6;
    b.tube([x0, y0, zc - w / 2], [x1, y1, zc - w / 2], 0.024, seg, IRON_RUST);
    b.tube([x0, y0, zc + w / 2], [x1, y1, zc + w / 2], 0.024, seg, IRON_RUST);
    const steps = near ? 12 : 6;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      b.box(0.22, 0.035, w, GRATE, { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t + 0.02, z: zc });
    }
    // handrail on the outer side, with newel posts top and bottom
    b.tube([x0, y0 + 0.9, zc - w / 2 - 0.02], [x1, y1 + 0.9, zc - w / 2 - 0.02], 0.016, seg, IRON);
    b.tube([x0, y0, zc - w / 2 - 0.02], [x0, y0 + 0.95, zc - w / 2 - 0.02], 0.02, seg, IRON);
    b.tube([x1, y1, zc - w / 2 - 0.02], [x1, y1 + 0.95, zc - w / 2 - 0.02], 0.02, seg, IRON);
    if (near) {
      for (let i = 0; i < 5; i++) {
        const t = (i + 0.5) / 5;
        const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        b.tube([x, y, zc - w / 2 - 0.02], [x, y + 0.9, zc - w / 2 - 0.02], 0.01, 4, IRON);
      }
    }
  }
  return b.build();
}

/** the counterweighted drop ladder below the lowest landing: hangs from y=0 down 2.7 m, on the outer edge */
export function buildFireEscapeLadder(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const z = -FE_D + 0.3;
  const L = 2.7;
  b.tube([-0.25, 0.9, z], [-0.25, -L, z], 0.018, 6, IRON_RUST);
  b.tube([0.25, 0.9, z], [0.25, -L, z], 0.018, 6, IRON_RUST);
  for (let i = 0; i < 9; i++) b.tube([-0.25, -0.15 - i * 0.3, z], [0.25, -0.15 - i * 0.3, z], 0.013, 5, IRON);
  // counterweight + guide rails
  b.box(0.12, 0.35, 0.12, IRON, { x: 0.45, y: 0.55, z: z + 0.1 });
  b.tube([0.45, 0.9, z + 0.1], [0.45, -0.4, z + 0.1], 0.01, 5, IRON);
  return b.build();
}
