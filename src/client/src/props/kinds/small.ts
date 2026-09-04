/**
 * Small street furniture: trash bags, hydrant, litter baskets, bollard, bike rack, bench, mailbox, planter.
 * All at real NYC dimensions, origin at the ground, local -z facing the road where it matters.
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBuilder, EMIT, rng, hash01, type PartStyle } from '../builder';
import { BASKET_SURFACE } from '../textures';

/**
 * Curbside collection, refs/_general/steam-stack-1.jpg / ART_DIRECTION §4–5.
 * The distant reference resolves a LOW, irregular black pile, not its ties/contents.
 * trash-basket-1.jpg informs only the crumpled clear film, not basket or snow geometry.
 * Eight authored black slots + one recycling sack, selected per building in the shader.
 * aMat.z -14 plastic, -15 clear film, -16 cardboard, -17 contents; w = bag slot.
 * No spheres: flattened soles, uneven load-bearing bellies and gathered, leaning necks.
 * 4,296 submitted triangles, 428 per black sack; bounds 2.428 x 0.805 x 0.834 m.
 */
export function buildTrashBags(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const contentsParts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, tag: number, slot: number, style: PartStyle) => {
    b.add(g, { ...style, keepUv: true });
    const mat = g.getAttribute('aMat');
    for (let i = 0; i < mat.count; i++) { mat.setZ(i, tag); mat.setW(i, slot); }
  };
  // Positions are in the pile frame: +x along curb, +z toward wall. Slots 0..2
  // support every optional upper bag, so a three-bag pile never has floating bags.
  const bags = [
    [-0.38, 0, -0.10, 0.34, 0.25, 0.47, 0.07],
    [0.18, 0, -0.12, 0.33, 0.26, 0.52, -0.05],
    [-0.04, 0.025, 0.15, 0.32, 0.24, 0.61, -0.09],
    [-0.76, 0, 0.07, 0.29, 0.22, 0.41, 0.07],
    [0.51, 0, 0.15, 0.29, 0.23, 0.43, 0.06],
    [-0.34, 0.28, 0.09, 0.29, 0.23, 0.39, -0.04],
    [0.24, 0.31, 0.03, 0.27, 0.23, 0.40, 0.06],
    [-0.68, 0, -0.16, 0.25, 0.22, 0.34, -0.05],
    [0.84, 0, -0.06, 0.26, 0.25, 0.50, -0.05],
  ];
  for (let slot = 0; slot < bags.length; slot++) {
    const [cx, cy, cz, rx, rz, height, lean] = bags[slot];
    const clear = slot === 8, phase = hash01(slot, 813) * Math.PI * 2;
    const plastic = { color: clear ? 0xaab5af : slot % 3 === 0 ? 0x191c1e : 0x1f2123, rough: clear ? 0.21 : 0.27, metal: 0 };
    const tag = clear ? -15 : -14;
    const profile = [[0, 0.67], [0.045, 0.97], [0.20, 1.03], [0.40, 1],
      [0.61, 0.86], [0.79, 0.66], [0.91, 0.34], [0.975, 0.09], [1.02, 0.08]];
    const segments = 20, stride = segments + 1;
    const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
    for (const [v, radius] of profile) for (let j = 0; j <= segments; j++) {
      const a = j / segments * Math.PI * 2;
      // Angular lobes describe the uneven contents; creases gather into the neck.
      // A broad pressed-in side and compressed bottom avoid an inflated-ball silhouette.
      const lobe = 1 + 0.10 * Math.sin(a * 3 + phase) + 0.055 * Math.cos(a * 5 - v * 4 + phase);
      const pleat = (0.023 + 0.055 * v) * Math.sin(a * 10 + Math.sin(v * 5 + phase));
      const dent = 0.13 * Math.pow(Math.max(0, Math.cos(a - phase)), 6) * Math.sin(Math.min(v, 1) * Math.PI);
      const r = radius * (lobe + pleat - dent);
      const sag = v > 0 && v < 0.95 ? 0.033 * Math.sin(a * 2 + phase) * Math.sin(v * Math.PI) : 0;
      positions.push(cx + Math.cos(a) * rx * r + lean * v * v,
        cy + v * height + sag, cz + Math.sin(a) * rz * r + 0.032 * Math.sin(phase) * v * v);
      uvs.push(j / segments, v);
    }
    for (let k = 0; k < profile.length - 1; k++) for (let j = 0; j < segments; j++) {
      const a = k * stride + j, c = a + stride;
      indices.push(a, c, a + 1, a + 1, c, c + 1);
    }
    for (const top of [false, true]) {
      const row = top ? (profile.length - 1) * stride : 0, v = top ? 1.02 : 0;
      const center = positions.length / 3;
      positions.push(cx + lean * v * v, cy + v * height, cz + 0.032 * Math.sin(phase) * v * v);
      uvs.push(0.5, v);
      for (let j = 0; j < segments; j++) {
        if (top) indices.push(center, row + j + 1, row + j);
        else indices.push(center, row + j, row + j + 1);
      }
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    shell.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    shell.setIndex(indices); shell.computeVertexNormals();
    // Average the duplicated UV seam; keep radial folds but no spurious hard meridian.
    const normals = shell.getAttribute('normal');
    for (let k = 0; k < profile.length; k++) {
      const a = k * stride, c = a + segments;
      const n = new THREE.Vector3(normals.getX(a) + normals.getX(c), normals.getY(a) + normals.getY(c), normals.getZ(a) + normals.getZ(c)).normalize();
      normals.setXYZ(a, n.x, n.y, n.z); normals.setXYZ(c, n.x, n.y, n.z);
    }
    add(shell, tag, slot, plastic);
    const colors = shell.getAttribute('color');
    for (let i = 0; i < colors.count; i++) {
      const v = uvs[i * 2 + 1], shade = 0.56 + 0.44 * Math.min(1, v * 3.3);
      colors.setXYZ(i, colors.getX(i) * shade, colors.getY(i) * shade, colors.getZ(i) * shade);
    }
    const neckX = cx + lean * 1.04, neckY = cy + height * 1.02, neckZ = cz + 0.033 * Math.sin(phase);
    const knot = new THREE.TorusGeometry(0.023, 0.014, 4, 7);
    knot.scale(1.3, 0.65, 0.75); knot.rotateX(0.7); knot.rotateY(phase);
    knot.translate(neckX, neckY + 0.006, neckZ);
    add(knot, tag, slot, plastic);
    // Two loose folded tie-ends, each with a ridge and an irregular, drooping tip.
    for (const side of [-1, 1]) {
      const tail = new THREE.BufferGeometry();
      tail.setAttribute('position', new THREE.Float32BufferAttribute([
        neckX, neckY, neckZ - 0.014,
        neckX + side * 0.045, neckY + 0.070, neckZ - 0.01,
        neckX + side * 0.027, neckY + 0.087, neckZ + 0.013,
        neckX + side * 0.072, neckY + 0.073, neckZ + 0.032,
        neckX + side * 0.014, neckY + 0.015, neckZ + 0.02,
      ], 3));
      tail.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0.7, 0.4, 1, 1, 0.8, 1, 0], 2));
      tail.setIndex([0, 1, 2, 0, 2, 4, 2, 3, 4, 2, 1, 0, 4, 2, 0, 4, 3, 2]);
      const foldedTail = tail.toNonIndexed(); tail.dispose();
      foldedTail.computeVertexNormals(); add(foldedTail, tag, slot, plastic);
    }
    if (clear) {
      // Real contents behind the dither-translucent shell, not marks painted on a white ball.
      const contents = new MeshBuilder();
      const paper = { color: 0xaaa896, rough: 0.93, metal: 0 };
      contents.box(0.24, 0.17, 0.15, { ...paper, color: 0x94816b }, { x: cx - 0.025, y: 0.12, z: cz + 0.045, rz: -0.16, ry: 0.25 });
      for (let j = 0; j < 4; j++) {
        const x = cx - 0.12 + j * 0.073, z = cz - 0.06 + (j % 2) * 0.045;
        const bottle = { color: j % 2 ? 0x698778 : 0xaab5b0, rough: 0.32, metal: 0 };
        contents.cyl(0.042, 0.043, 0.18, 7, bottle, { x, y: 0.13, z, rz: (j - 1.5) * 0.21 });
        contents.cyl(0.018, 0.037, 0.045, 7, bottle, { x: x - (j - 1.5) * 0.037, y: 0.302, z });
        contents.cyl(0.02, 0.02, 0.02, 7, { ...paper, color: j % 2 ? 0x385d62 : 0xc7c6b9 }, { x: x - (j - 1.5) * 0.037, y: 0.347, z });
        contents.box(0.075, 0.055, 0.015, { ...paper, color: j % 2 ? 0xb5b5a1 : 0x647984 }, { x, y: 0.24, z: z - 0.042 });
      }
      const g = contents.build();
      // Preserve authored PBR/colour when tagging the merged contents.
      const mat = g.getAttribute('aMat');
      for (let i = 0; i < mat.count; i++) { mat.setZ(i, -17); mat.setW(i, slot); }
      contentsParts.push(g);
    }
  }
  // A crushed corrugated carton: connected flattened panels, bent flaps, exposed
  // 5 mm sandwich edges. Not an intact rigid box and not a floating brown cube.
  const panels = [
    [[-1.17, 0.014, -0.36], [-0.53, 0.014, -0.36], [-0.53, 0.025, 0.25], [-1.17, 0.032, 0.25]],
    [[-1.17, 0.032, 0.25], [-0.53, 0.025, 0.25], [-0.60, 0.14, 0.39], [-1.13, 0.16, 0.36]],
    [[-1.17, 0.014, -0.36], [-1.17, 0.032, 0.25], [-1.32, 0.075, 0.19], [-1.30, 0.044, -0.30]],
    [[-1.17, 0.014, -0.36], [-1.30, 0.044, -0.30], [-1.20, 0.12, -0.43], [-0.63, 0.085, -0.40]],
  ];
  for (let p = 0; p < panels.length; p++) {
    const panel = panels[p], pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let face = 0; face < 2; face++) for (let j = 0; j < 4; j++) {
      pos.push(panel[j][0], panel[j][1] + face * 0.005, panel[j][2]);
      uv.push(j === 1 || j === 2 ? 1 : 0, j >= 2 ? 1 : 0);
    }
    idx.push(0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6);
    for (let j = 0; j < 4; j++) { const k = (j + 1) % 4; idx.push(j, j + 4, k, k, j + 4, k + 4); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    add(g, -16, 9, { color: p % 2 ? 0x806343 : 0x97754c, rough: 0.96, metal: 0 });
  }
  const parts = [b.build(), ...contentsParts];
  const geometry = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/**
 * 0.75 m NYC hydrant, local -z toward the road. Ref: refs/_general/hydrant-1.jpg,
 * ART_DIRECTION.md §5 / refs/_sheets/_general-1.png: narrow black casting, shallow
 * silver bonnet, projecting foot flange. The distant photo cannot resolve the
 * hidden outlets/chain links; the three capped outlets implement the asset brief.
 * The legacy red slot is an older black repaint with rusty-red undercoat showing.
 * aMat.z -2/-3 opts ONLY this geometry into local PBR wear; -1 belongs to bench slats.
 * aMat.w identifies paint / silver coating / exposed iron / paper. Still one draw.
 */
export function buildHydrant(variant: 'black' | 'red'): THREE.BufferGeometry {
  const paint = new MeshBuilder(), coating = new MeshBuilder();
  const hardware = new MeshBuilder(), labels = new MeshBuilder();
  const barrel = { color: variant === 'black' ? 0x171716 : 0x1c1b19, rough: 0.44, metal: 0 };
  const silver = { color: 0xa7a7a5, rough: 0.38, metal: 0.7 };
  const iron = { color: 0x50504e, rough: 0.47, metal: 0.6 };

  // Ref: hydrant-1's projecting collar over a short, distinctly narrower socket.
  // Placement is physics-grounded, but this sidewalk is at local y=0.15. Extend
  // the actual narrow socket and MOVE the existing flange to y=0.216..0.255:
  // 66 mm of foot remains exposed, while the complete asset still spans 0..0.75.
  // Separate lip normals preserve the projecting step at 2 m; no extra collar.
  const collar = { ...barrel, color: 0x242423, rough: 0.51 };
  paint.cyl(0.062, 0.064, 0.221, 20, { ...barrel, color: 0x191918, rough: 0.68 });
  paint.lathe([[0.062, 0.216], [0.103, 0.216], [0.112, 0.223]], 20, barrel);
  paint.lathe([[0.112, 0.223], [0.112, 0.246]], 20, collar);
  paint.lathe([[0.112, 0.246], [0.102, 0.255], [0.074, 0.255]], 20, collar);
  paint.lathe([[0.074, 0.253], [0.078, 0.272], [0.075, 0.316], [0.075, 0.579], [0.076, 0.665], [0.077, 0.677]], 24, barrel);
  for (let i = 0; i < 6; i++) {
    const a = (i + 0.5) * Math.PI / 3;
    hardware.cyl(0.009, 0.01, 0.015, 6, iron, { x: Math.sin(a) * 0.096, y: 0.252, z: Math.cos(a) * 0.096 });
  }
  // Low, round cast bonnet instead of the old pointed dome; pentagonal operating nut.
  coating.lathe([[0.076, 0.675], [0.081, 0.675], [0.082, 0.691], [0.079, 0.695]], 24, silver);
  coating.lathe([[0.079, 0.694], [0.08, 0.701], [0.076, 0.708], [0.061, 0.713], [0.041, 0.715], [0.026, 0.716], [0, 0.716]], 24, silver);
  hardware.cyl(0.025, 0.026, 0.01, 8, iron, { y: 0.715 });
  hardware.cyl(0.017, 0.02, 0.025, 5, iron, { y: 0.725 });

  // Axial profiles keep necks, cap rims and wrench nuts concentric on all three outlets.
  const outlet = (origin: THREE.Vector3, direction: THREE.Vector3, radius: number, length: number, seg: number) => {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    const transform = (along: number) => new THREE.Matrix4().compose(
      origin.clone().addScaledVector(direction, along), q, new THREE.Vector3(1, 1, 1));
    const lathe = (builder: MeshBuilder, profile: [number, number][], along: number, style: typeof barrel) => {
      const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
      builder.add(g, style, transform(along));
    };
    // Sink the neck root into the curved barrel so the wider pumper has no open seam.
    lathe(paint, [[radius * 1.08, -0.02], [radius * 1.08, 0.02], [radius, length]], 0, barrel);
    // The visible reference outlet reads dark; its finish is not finely resolved.
    // Keep black cap faces and muted iron wrench nuts, with silver on the bonnet.
    lathe(paint, [[radius * 1.01, 0], [radius * 1.14, 0.004], [radius * 1.14, 0.018], [radius * 0.98, 0.03], [0, 0.033]], length - 0.003, barrel);
    const nut = new THREE.CylinderGeometry(radius * 0.31, radius * 0.36, 0.02, 5);
    nut.translate(0, 0.01, 0);
    hardware.add(nut, iron, transform(length + 0.03));
  };
  for (const s of [-1, 1]) outlet(new THREE.Vector3(s * 0.066, 0.572, 0), new THREE.Vector3(s, 0, 0), 0.032, 0.052, 14);
  outlet(new THREE.Vector3(0, 0.562, -0.065), new THREE.Vector3(0, 0, -1), 0.043, 0.057, 18);

  // Real open links, alternating planes along an arc-length-sampled hanging curve.
  // Three-sided wire is sub-pixel at 2 m; the six-sided holes retain the chain silhouette.
  const chain = (start: THREE.Vector3, sag: THREE.Vector3, end: THREE.Vector3) => {
    const curve = new THREE.QuadraticBezierCurve3(start, sag, end);
    for (let i = 0; i < 10; i++) {
      const t = i / 9, point = curve.getPointAt(t);
      const link = new THREE.TorusGeometry(0.0062, 0.0018, 3, 6);
      link.scale(1, 1.65, 1);
      link.rotateY(i % 2 ? Math.PI / 2 : 0);
      link.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(t)));
      hardware.add(link, iron, { x: point.x, y: point.y, z: point.z });
    }
  };
  for (const s of [-1, 1]) chain(new THREE.Vector3(s * 0.139, 0.541, -0.011),
    new THREE.Vector3(s * 0.113, 0.455, -0.049), new THREE.Vector3(s * 0.071, 0.6, -0.024));
  chain(new THREE.Vector3(0.022, 0.519, -0.142), new THREE.Vector3(0.058, 0.436, -0.117), new THREE.Vector3(0.071, 0.563, -0.024));

  // Ref: the small pale rectangle beside/below the visible outlet. Place it on
  // the front-right shoulder, not the hidden +z back. Its print is unresolved;
  // keep only subdued ink remnants, not invented lettering or extra hardware.
  const label = (angle: number, width: number, height: number, y: number, radius: number, color: number) => {
    const g = new THREE.CylinderGeometry(radius, radius, height, 4, 1, true, angle, width / radius);
    labels.add(g, { color, rough: 0.9, metal: 0 }, { y });
  };
  label(2.4, 0.024, 0.012, 0.523, 0.076, 0xb1b0aa);
  label(2.44, 0.015, 0.0013, 0.525, 0.0763, 0x666660);
  label(2.44, 0.011, 0.001, 0.5215, 0.0763, 0x73736c);
  label(2.6, 0.005, 0.0015, 0.518, 0.0763, 0x87867e);

  const parts = [paint, coating, hardware, labels].map((builder, role) => {
    const g = builder.build();
    const mat = g.getAttribute('aMat');
    for (let i = 0; i < mat.count; i++) {
      mat.setZ(i, variant === 'black' ? -2 : -3);
      mat.setW(i, role);
    }
    return g;
  });
  const geometry = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * NYC expanded-steel litter basket. User scale override: ground to rolled rim = 1.0 m.
 * Ref: refs/_general/trash-basket-1.jpg (ART_DIRECTION: _general-1); summer, no snow or insignia.
 * Keep below the original 808 triangles, in one instanced draw with the existing 180 m cutoff.
 * 796 triangles; nominal rolled-rim diameter 0.734 m, with a narrower 0.628 m foot.
 * The first 34 vertices remain the alpha-tested shell; the liner/frame/placard stay opaque.
 */
export function buildWireBasket(meshTex: boolean): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const paint = { color: 0xffffff, rough: 0.78, metal: 0 };
  // Tag only this asset. aMat.z > 1 is a basket-local surface selector, not an instance atlas rect.
  const add = (g: THREE.BufferGeometry, surface: number, style: PartStyle = paint) => {
    b.add(g, { ...style, keepUv: true, textured: surface === BASKET_SURFACE.wire });
    const mat = g.getAttribute('aMat');
    for (let i = 0; i < mat.count; i++) mat.setZ(i, surface);
  };
  // A shallow, fixed inward crease plus slight ovalization; no per-instance/random placement changes.
  const dent = (g: THREE.BufferGeometry) => {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
      const crease = Math.pow(Math.max(0, Math.cos(a - 0.55)), 18);
      const k = 1 - 0.024 * crease * (0.4 + 0.6 * y) + 0.006 * Math.sin(a * 3);
      p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const body = new THREE.CylinderGeometry(0.349, 0.303, 0.952, 16, 1, true);
  body.translate(0, 0.501, 0);
  add(dent(body), meshTex ? BASKET_SURFACE.wire : BASKET_SURFACE.frame);

  // Frame skin U is across a strap, V along it. Wrap edge chips around the rim/band,
  // instead of confining them to the cylinder's single circumference seam.
  const strapUv = (g: THREE.BufferGeometry) => {
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
    return g;
  };

  // Substantial rolled lip; its six-sided circular section includes the exact y=1 top point.
  const lip = new THREE.TorusGeometry(0.349, 0.018, 6, 20);
  lip.rotateX(Math.PI / 2);
  // Torus radial samples reach +/- sin(60deg), so normalize only the tube's vertical extent.
  lip.scale(1, 2 / Math.sqrt(3), 1);
  lip.translate(0, 0.982, 0);
  add(dent(strapUv(lip)), BASKET_SURFACE.frame);
  // Folded base strap, grounded at y=0; a simpler section funds the flat ribs and placard.
  const foot = new THREE.LatheGeometry([
    new THREE.Vector2(0.295, 0), new THREE.Vector2(0.314, 0),
    new THREE.Vector2(0.314, 0.035), new THREE.Vector2(0.295, 0.035),
    new THREE.Vector2(0.295, 0),
  ], 16);
  add(dent(foot), BASKET_SURFACE.frame);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const rib = new THREE.BoxGeometry(0.038, 0.954, 0.009);
    rib.rotateX(Math.atan2(0.046, 0.954));
    rib.translate(0, 0.508, 0.327);
    rib.rotateY(a);
    // Adjacent ribs sample different worn edges, without changing the shared material or seed.
    const uv = rib.getAttribute('uv');
    if (i % 2) for (let v = 0; v < uv.count; v++) uv.setY(v, 1 - uv.getY(v));
    add(dent(rib), BASKET_SURFACE.frame, { ...paint, color: i % 3 ? 0xffffff : 0xcbd2c8 });
  }
  const upperBand = new THREE.CylinderGeometry(0.347, 0.345, 0.044, 16, 1, true);
  upperBand.translate(0, 0.881, 0);
  add(dent(strapUv(upperBand)), BASKET_SURFACE.frame);
  const floor = new THREE.CircleGeometry(0.303, 16);
  floor.rotateX(-Math.PI / 2); floor.translate(0, 0.025, 0);
  b.add(floor, { color: 0x18231c, rough: 0.9, metal: 0 });

  // The open, slumped liner sits INBOARD of the mesh, with an empty reveal below the lip.
  // Do not cap its mouth: trash should sit in a dark cavity, not on a flat black disk.
  const bag = new THREE.CylinderGeometry(0.280, 0.258, 0.80, 12, 3, true);
  const pos = bag.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), a = Math.atan2(z, x);
    const k = 1 + 0.032 * Math.sin(a * 5 + y * 12) + 0.025 * Math.cos(a * 7);
    const sag = (y + 0.4) / 0.8 * (0.022 + 0.022 * Math.sin(a * 3 + 0.4));
    pos.setXYZ(i, x * k, y + 0.475 - sag, z * k);
  }
  bag.computeVertexNormals();
  b.add(bag, { color: 0x141619, rough: 0.44, metal: 0 });
  const bagFloor = new THREE.CircleGeometry(0.258, 12);
  bagFloor.rotateX(-Math.PI / 2); bagFloor.translate(0, 0.076, 0);
  b.add(bagFloor, { color: 0x090b0c, rough: 0.65, metal: 0 });
  // Uneven cuff follows the liner mouth, not the whole basket circumference at rim height.
  const cuff = new THREE.CylinderGeometry(0.287, 0.278, 0.043, 12, 1, true);
  const cp = cuff.getAttribute('position');
  for (let i = 0; i < cp.count; i++) {
    const a = Math.atan2(cp.getZ(i), cp.getX(i));
    cp.setY(i, cp.getY(i) + 0.85 - 0.022 * Math.sin(a * 3 + 0.4));
  }
  cuff.computeVertexNormals();
  b.add(cuff, { color: 0x212427, rough: 0.4, metal: 0 });
  // A low, irregular rubbish mound supports the loose items without closing the mouth at rim height.
  b.add(new THREE.IcosahedronGeometry(1, 0), { color: 0x1a1c1c, rough: 0.64, metal: 0 },
    { y: 0.824, sx: 0.261, sy: 0.078, sz: 0.238, ry: 0.3 });
  const paper = (x: number, y: number, z: number, turn: number) => {
    const g = new THREE.IcosahedronGeometry(0.085, 0);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
      const k = 1 + 0.19 * Math.sin(px * 61 + pz * 37 + py * 43);
      p.setXYZ(i, px * k, py * k * 0.48, pz * k * 0.75);
    }
    g.computeVertexNormals();
    b.add(g, { color: 0xc5bfa9, rough: 0.94, metal: 0 }, { x, y, z, ry: turn });
  };
  paper(0.07, 0.907, 0.03, 0.5);
  paper(-0.075, 0.88, 0.105, 1.7);
  b.box(0.115, 0.045, 0.085, { color: 0x9a7951, rough: 0.96, metal: 0 }, { x: -0.02, y: 0.864, z: -0.11, ry: 0.4, rz: 0.23 });
  b.cylC(0.038, 0.026, 0.11, 8, { color: 0xbeb9a5, rough: 0.83, metal: 0 }, { x: -0.10, y: 0.907, z: -0.035, rz: 0.7 });
  b.cylC(0.039, 0.039, 0.008, 8, { color: 0x782e25, rough: 0.7, metal: 0 }, { x: -0.138, y: 0.952, z: -0.035, rz: 0.7 });

  // Bowed, aged notice on the conventional local -z front. Generic lettering, no city seal/logo.
  const plate = new THREE.CylinderGeometry(0.356, 0.335, 0.416, 4, 1, true, Math.PI - 0.42, 0.84);
  plate.translate(0, 0.732, 0);
  add(plate, BASKET_SURFACE.placard, { color: 0xffffff, rough: 0.92, metal: 0 });
  return b.build();
}

/** newer grey/black steel litter basket with the domed lid opening (the "Bigbelly"-less DSNY steel basket) */
export function buildSteelBasket(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const steel = { color: 0x3c3f42, rough: 0.5, metal: 0.8, grimeBand: [0, 0.25, 0.35] as [number, number, number] };
  b.cyl(0.29, 0.27, 0.85, 14, steel, { y: 0.02 });
  // slotted vertical ribs
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    b.box(0.02, 0.7, 0.03, { color: 0x2b2e31, rough: 0.5, metal: 0.8 }, { x: Math.cos(a) * 0.29, y: 0.45, z: Math.sin(a) * 0.29, ry: -a });
  }
  b.lathe([[0.3, 0.0], [0.31, 0.06], [0.24, 0.16], [0.15, 0.2], [0.15, 0.26], [0.0, 0.26]], 14, steel, { y: 0.86 });
  b.cyl(0.3, 0.3, 0.03, 14, { color: 0x232629, rough: 0.6, metal: 0.7 }, { y: 0 });
  return b.build();
}

/**
 * Domed NYC painted-steel bollard, 0.92 m tall, local +z along the existing row.
 * Ref: fifth-42nd is street context; hardware is too distant to resolve. The steel
 * wear in pedestrians-1 informs the finish, NOT its striped hydraulic silhouette.
 * aMat.z=-9 is bollard-only; w=0 shell, 1 flange, 2 anchors, 3 eyes, 4 chain.
 * One indexed instanced mesh. The material enables complete chain spans only at
 * the two known Fifth Avenue starts; unused eyes/links collapse inside the shaft.
 * 2,236 triangles: 1,120 post/fittings + 1,116 optional links. Post bounds are
 * 0.318 x 0.920 x 0.326 m; conservative deployed bounds remain inside the 4 m cull sphere.
 */
export function buildBollard(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  // Neutral, weathered charcoal; sky light supplies the cool reflection, not blue pigment.
  const paint = { color: 0x30302e, rough: 0.70, metal: 0 };
  const hardware = { color: 0x343431, rough: 0.73, metal: 0 };
  const add = (g: THREE.BufferGeometry, role: number, style: PartStyle = paint) => {
    b.add(g, style);
    const mat = g.getAttribute('aMat');
    for (let i = 0; i < mat.count; i++) { mat.setZ(i, -9); mat.setW(i, role); }
  };
  const lathe = (profile: [number, number][], segments: number, role: number, style = paint) =>
    add(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments), role, style);

  // One continuous shell: no sphere/cylinder overlap or bright z-fighting equator.
  // Small foot shoulder and a tangent hemispherical crown keep the plain NYC form.
  const profile: [number, number][] = [[0.111, 0.034], [0.111, 0.063], [0.108, 0.096], [0.108, 0.805]];
  for (let i = 1; i <= 6; i++) {
    const a = i * Math.PI / 12;
    profile.push([i === 6 ? 0 : 0.108 * Math.cos(a), 0.805 + 0.115 * Math.sin(a)]);
  }
  lathe(profile, 24, 0);
  // Separate flat top / bevel / vertical normals let the substantial flange catch light.
  lathe([[0.151, 0], [0.159, 0.007]], 24, 1);
  lathe([[0.159, 0.007], [0.159, 0.029]], 24, 1);
  lathe([[0.159, 0.029], [0.151, 0.038], [0.109, 0.038]], 24, 1);
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + i * Math.PI / 2;
    const x = Math.sin(a) * 0.134, z = Math.cos(a) * 0.134;
    const washer = new THREE.CylinderGeometry(0.016, 0.016, 0.004, 8);
    washer.translate(x, 0.040, z); add(washer, 2, hardware);
    // A seated washer and bevelled hex head read separately at the fixed 3 m view.
    // Keep the anchor entirely on the existing flange; no new paving footprint.
    const nut = new THREE.LatheGeometry([
      [0.011, 0.042], [0.0125, 0.044], [0.0125, 0.053], [0.0105, 0.056], [0, 0.056],
    ].map(([r, y]) => new THREE.Vector2(r, y)), 6).toNonIndexed();
    nut.computeVertexNormals(); // Flat wrench faces, not cylinder-smoothed hex sides.
    nut.translate(x, 0, z); add(nut, 2, hardware);
  }
  // Required chain attachments, not a claim of photo-verified NYPL hardware.
  // The shader exposes each welded eye ONLY where a complete span connects to it.
  for (const side of [-1, 1]) {
    const root = new THREE.CylinderGeometry(0.01, 0.013, 0.031, 6);
    root.rotateX(Math.PI / 2); root.translate(0, 0.705, side * 0.118);
    add(root, 3, hardware);
    const eye = new THREE.TorusGeometry(0.023, 0.006, 4, 8);
    eye.rotateY(Math.PI / 2); eye.translate(0, 0.705, side * 0.134);
    add(eye, 3, hardware);
  }

  // Closed, interleaved oval links follow an arc-length sampled catenary.
  // Constant 11 mm wire, rather than stretching the tube when elongating a torus.
  // First/last links pass through the welded eyes; 0.22 m sag clears the paving.
  class ChainCurve extends THREE.Curve<THREE.Vector3> {
    constructor() { super(); }
    override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
      const z = 0.164 + 1.872 * t;
      return target.set(0, 0.705 + 2 * (Math.cosh((z - 1.1) / 2) - Math.cosh(0.936 / 2)), z);
    }
  }
  const curve = new ChainCurve();
  for (let i = 0; i < 31; i++) {
    const link = new THREE.TorusGeometry(0.017, 0.0055, 3, 6);
    const p = link.getAttribute('position'), n = link.getAttribute('normal'), uv = link.getAttribute('uv');
    for (let j = 0; j < p.count; j++) {
      const u = uv.getX(j) * Math.PI * 2 + Math.PI / 6, v = uv.getY(j) * Math.PI * 2;
      const outward = new THREE.Vector3(0.04 * Math.cos(u), 0.017 * Math.sin(u), 0).normalize();
      const normal = outward.multiplyScalar(Math.cos(v)); normal.z = Math.sin(v);
      p.setXYZ(j, 0.017 * Math.cos(u) + normal.x * 0.0055,
        0.04 * Math.sin(u) + normal.y * 0.0055, normal.z * 0.0055);
      n.setXYZ(j, normal.x, normal.y, normal.z);
    }
    // Eye plane is YZ; the first and last (even) links cross it at right angles.
    link.rotateY(i % 2 ? Math.PI / 2 : 0);
    const t = i / 30, point = curve.getPointAt(t);
    link.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(t)));
    link.translate(point.x, point.y, point.z);
    add(link, 4, { ...hardware, color: 0x2e2e2c, rough: 0.65 });
  }
  const geometry = b.build();
  // Bounds include the deployed span and centimetre-scale endpoint correction in
  // the shader. Default kind frustum radius (4 m) still contains the entire asset.
  geometry.boundingBox!.expandByScalar(0.016);
  geometry.boundingBox!.getBoundingSphere(geometry.boundingSphere!);
  return geometry;
}

/**
 * Galvanized inverted-U, 0.90 m high, with one locked, full-size commuter bicycle.
 * Ref: steam-stack-1.jpg / ART_DIRECTION _general-1: the subway-side bicycle is
 * too distant to resolve its lock/hardware. Those are brief-led, not photo claims.
 * citibike-1.jpg informs open wheels/materials only; this is NOT a docking station.
 * One deterministic, indexed mesh using the existing placement/material/range.
 * Only this asset emits aMat.z=-8; w=0 zinc, 1 enamel, 2 hardware, 3 spokes, 4 foot contact.
 * 3,446 triangles; bounds 1.818 x 1.032 x 0.530 m. The two wheels use eight card triangles.
 */
export function buildBikeRack(): THREE.BufferGeometry {
  const rack = new MeshBuilder(), paint = new MeshBuilder();
  const hardware = new MeshBuilder(), spokes = new MeshBuilder(), lock = new MeshBuilder();
  const contact = new MeshBuilder();
  // Neutral zinc separates the hoop from the green enamel. Its broad highlights
  // come from the rack-only BRDF, not bright stripes or a shared material change.
  const zinc = { color: 0xb0b0b0, rough: 0.40, metal: 0.82 };
  const enamel = { color: 0x4d6966, rough: 0.42, metal: 0 };
  const alloy = { color: 0xa1aaa7, rough: 0.38, metal: 0.72 };
  const iron = { color: 0x555b58, rough: 0.53, metal: 0.58 };
  const rubber = { color: 0x252925, rough: 0.88, metal: 0 };
  const black = { color: 0x30332f, rough: 0.64, metal: 0 };
  type Point = [number, number, number];
  // Open-ended tubes meet at actual joints; avoid spending triangles on buried caps.
  const tube = (b: MeshBuilder, a: Point, c: Point, radius: number, style: PartStyle, sides = 6) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...c);
    const axis = end.clone().sub(start);
    const g = new THREE.CylinderGeometry(radius, radius, axis.length(), sides, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
    b.add(g, style, { x: (a[0] + c[0]) / 2, y: (a[1] + c[1]) / 2, z: (a[2] + c[2]) / 2 });
  };

  // One continuous sweep: shared rings/normals at the upright-to-crown tangencies.
  // A 32-step semicircle has <0.4 mm chord error; twelve radial samples keep the
  // 50 mm section consistent through the bend, without overlapping tube joints.
  const stations: [number, number, number, number][] = [[0.3, 0.012, 1, 0]];
  for (let i = 0; i <= 32; i++) {
    const a = i * Math.PI / 32, nx = Math.cos(a), ny = Math.sin(a);
    stations.push([0.3 * nx, 0.575 + 0.3 * ny, nx, ny]);
  }
  stations.push([-0.3, 0.012, -1, 0]);
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const sides = 12;
  for (const [x, y, nx, ny] of stations) for (let j = 0; j < sides; j++) {
    const a = j * Math.PI * 2 / sides;
    const dx = nx * Math.cos(a), dy = ny * Math.cos(a), dz = Math.sin(a);
    positions.push(x + 0.025 * dx, y + 0.025 * dy, 0.025 * dz);
    normals.push(dx, dy, dz);
  }
  for (let i = 0; i < stations.length - 1; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = (i + 1) * sides + j;
    const c = i * sides + (j + 1) % sides, d = (i + 1) * sides + (j + 1) % sides;
    indices.push(a, b, c, b, d, c);
  }
  const arch = new THREE.BufferGeometry();
  arch.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  arch.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  arch.setIndex(indices);
  rack.add(arch, zinc);

  // Keep the original +/-0.30 m leg locations, ground plane and bolt positions.
  for (const x of [-0.3, 0.3]) {
    rack.cyl(0.065, 0.065, 0.012, 16, zinc, { x });
    rack.lathe([[0.031, 0.012], [0.028, 0.017], [0.025, 0.020]], 12,
      { ...zinc, color: 0x898989, rough: 0.60 }, { x });
    for (const z of [-0.044, 0.044]) {
      rack.add(new THREE.RingGeometry(0.0065, 0.010, 8), { ...zinc, color: 0x808080 },
        { x, y: 0.013, z, rx: -Math.PI / 2 });
      rack.cyl(0.0065, 0.007, 0.007, 6, zinc, { x, y: 0.014, z });
    }
    // The -8/4 shader trims this existing card to a narrow, muted contact seam
    // at the plate edge. No dotted halo, opaque disc, texture or extra draw.
    contact.quad(0.19, 0.19, { color: 0x353535, rough: 1, metal: 0 },
      { x, y: 0.0008, rx: -Math.PI / 2 });
  }

  // 688 mm tires, 1.13 m wheelbase; both wheels stay on the ground after the lean.
  const rear: Point = [-0.61, 0.344, 0], front: Point = [0.52, 0.344, 0];
  const bb: Point = [-0.22, 0.31, 0], seat: Point = [-0.34, 0.81, 0];
  const headLow: Point = [0.342, 0.70, 0], headHigh: Point = [0.285, 0.865, 0];
  for (const hub of [rear, front]) {
    const [x, y] = hub;
    hardware.add(new THREE.TorusGeometry(0.326, 0.018, 6, 28), rubber, { x, y });
    // A shallow U-section rim, not a filled cylinder or thick wheel disc.
    const rim = new THREE.LatheGeometry([
      new THREE.Vector2(0.304, -0.009), new THREE.Vector2(0.315, -0.012),
      new THREE.Vector2(0.315, 0.012), new THREE.Vector2(0.304, 0.009),
    ], 28);
    rim.rotateX(Math.PI / 2);
    hardware.add(rim, alloy, { x, y });
    hardware.cylC(0.020, 0.020, 0.077, 8, alloy, { x, y, rx: Math.PI / 2 });
    for (const z of [-0.044, 0.044]) hardware.cylC(0.009, 0.009, 0.010, 6, iron, { x, y, z, rx: Math.PI / 2 });
    // Two back-to-back alpha cards = four triangles per wheel. The -8/3 shader
    // discards ALL space between its 32 crossed spokes, including the corners.
    // No new texture/material, no per-spoke cylinders and no opaque wheel disc.
    for (const side of [-1, 1]) spokes.quad(0.624, 0.624,
      { color: 0x929d98, rough: 0.47, metal: 0.65 }, { x, y, z: side * 0.002, ry: side < 0 ? Math.PI : 0 });
    // Small amber wheel reflector, suspended between spokes rather than filling them.
    hardware.box(0.041, 0.015, 0.014, { color: 0xa98439, rough: 0.48, metal: 0 }, { x: x + 0.16, y: y - 0.09, rz: -0.45 });
  }
  tube(paint, bb, seat, 0.014, enamel, 8);
  tube(paint, seat, headHigh, 0.013, enamel, 8);
  tube(paint, bb, headLow, 0.017, enamel, 8);
  tube(paint, headLow, headHigh, 0.019, enamel, 8);
  for (const side of [-1, 1]) {
    const axle: Point = [rear[0], rear[1], side * 0.039];
    tube(paint, [bb[0], bb[1], side * 0.026], axle, 0.008, enamel);
    tube(paint, [seat[0], seat[1] - 0.024, side * 0.016], axle, 0.0065, enamel);
    // Paired fork blades visibly straddle, and reach, the front axle.
    const bend: Point = [0.446, 0.405, side * 0.039];
    tube(hardware, [headLow[0], headLow[1], side * 0.024], bend, 0.010, alloy);
    tube(hardware, bend, [front[0], front[1], side * 0.041], 0.008, alloy);
  }
  tube(hardware, [-0.336, 0.79, 0], [-0.367, 0.929, 0], 0.0115, alloy, 8);
  hardware.cylC(0.018, 0.018, 0.014, 8, iron, { x: seat[0], y: 0.808 });
  // Low, tapered saddle: broad rear with a narrow forward nose, not a rectangular seat.
  hardware.prism([[-0.51, -0.056], [-0.48, -0.071], [-0.39, -0.060],
    [-0.255, -0.018], [-0.247, 0.018], [-0.39, 0.060], [-0.48, 0.071], [-0.51, 0.056]],
  0.027, black, { y: 0.926 });
  tube(hardware, [-0.43, 0.918, 0], [-0.30, 0.918, 0], 0.004, iron);
  tube(hardware, headHigh, [0.237, 1.005, 0], 0.011, alloy, 8);
  tube(hardware, [0.244, 0.984, 0], [0.287, 1.008, 0], 0.013, alloy);
  for (const side of [-1, 1]) {
    tube(hardware, [0.287, 1.008, 0], [0.274, 1.008, side * 0.16], 0.010, alloy);
    tube(hardware, [0.274, 1.008, side * 0.16], [0.214, 0.994, side * 0.26], 0.013, rubber, 8);
    // Brake lever and a restrained cable loop returning to its caliper.
    tube(hardware, [0.275, 0.994, side * 0.155], [0.316, 0.973, side * 0.221], 0.004, iron, 5);
  }
  const cable = new THREE.CubicBezierCurve3(new THREE.Vector3(0.278, 0.99, -0.16),
    new THREE.Vector3(0.43, 0.91, -0.10), new THREE.Vector3(0.42, 0.75, -0.06), new THREE.Vector3(0.38, 0.675, -0.025));
  hardware.add(new THREE.TubeGeometry(cable, 7, 0.0022, 3, false), black);
  tube(hardware, [0.349, 0.681, 0], [0.39, 0.662, -0.025], 0.006, iron);
  tube(hardware, [0.349, 0.681, 0], [0.39, 0.662, 0.025], 0.006, iron);
  tube(hardware, [-0.477, 0.927, 0], [-0.477, 0.884, 0], 0.004, iron);
  hardware.box(0.045, 0.023, 0.016, { color: 0x842e25, rough: 0.45, metal: 0 }, { x: -0.465, y: 0.884 });

  // Chainwheel, rear sprocket, two chain runs and opposed cranks with actual pedals.
  for (const [x, y, radius, z] of [[bb[0], bb[1], 0.083, -0.052], [rear[0], rear[1], 0.039, -0.051]]) {
    const ring = new THREE.TorusGeometry(radius, 0.006, 3, radius > 0.05 ? 20 : 16);
    hardware.add(ring, iron, { x, y, z });
  }
  hardware.cylC(0.035, 0.035, 0.004, 10, iron, { x: rear[0], y: rear[1], z: -0.051, rx: Math.PI / 2 });
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    tube(hardware, [bb[0], bb[1], -0.052], [bb[0] + Math.cos(a) * 0.078, bb[1] + Math.sin(a) * 0.078, -0.052], 0.006, iron, 4);
  }
  tube(hardware, [-0.224, 0.391, -0.053], [-0.613, 0.382, -0.053], 0.003, iron, 4);
  tube(hardware, [-0.224, 0.228, -0.053], [-0.613, 0.305, -0.053], 0.003, iron, 4);
  hardware.cylC(0.023, 0.023, 0.113, 8, iron, { x: bb[0], y: bb[1], rx: Math.PI / 2 });
  for (const side of [-1, 1]) {
    const pedal: Point = [bb[0] + side * 0.091, bb[1] + side * 0.119, side * 0.083];
    tube(hardware, [bb[0], bb[1], side * 0.066], pedal, 0.009, alloy);
    tube(hardware, pedal, [pedal[0], pedal[1], side * 0.122], 0.006, iron);
    hardware.box(0.074, 0.022, 0.063, black, { x: pedal[0], y: pedal[1], z: side * 0.125 });
    hardware.box(0.052, 0.007, 0.0015, { color: 0xaa8a40, rough: 0.55, metal: 0 },
      { x: pedal[0], y: pedal[1], z: side * 0.1575 });
  }

  // A closed horizontal D-lock encircles BOTH the sloping seat tube and left rack
  // upright at y=.57. Its crossbar is ahead of the bicycle, its crown behind the rack.
  // The right arm rests against the inclined seat tube (under 1 mm clearance).
  const lockSteel = { color: 0x686d65, rough: 0.43, metal: 0.66 };
  for (const x of [-0.37, -0.262]) tube(lock, [x, 0.57, -0.195], [x, 0.57, 0.015], 0.0065, lockSteel, 6);
  lock.add(new THREE.TorusGeometry(0.054, 0.0065, 4, 10, Math.PI), lockSteel, { x: -0.316, y: 0.57, z: 0.015, rx: Math.PI / 2 });
  lock.box(0.154, 0.036, 0.036, black, { x: -0.316, y: 0.57, z: -0.195 });
  lock.box(0.022, 0.037, 0.037, { color: 0xb29b50, rough: 0.59, metal: 0 }, { x: -0.380, y: 0.57, z: -0.195 });
  lock.cylC(0.006, 0.006, 0.002, 8, alloy, { x: -0.275, y: 0.57, z: -0.214, rx: Math.PI / 2 });

  const finish = (b: MeshBuilder, role: number) => {
    const g = b.build(), mat = g.getAttribute('aMat');
    for (let i = 0; i < mat.count; i++) { mat.setZ(i, -8); mat.setW(i, role); }
    return g;
  };
  const bicycle = [finish(paint, 1), finish(hardware, 2), finish(spokes, 3)];
  // Lean 6.3 degrees toward the rack. Ground from the actual tire vertices, not
  // an estimated radius: both contact patches remain at local y=0 for every instance.
  for (const g of bicycle) { g.rotateX(0.11); g.computeBoundingBox(); }
  const ground = Math.min(...bicycle.map(g => g.boundingBox!.min.y));
  for (const g of bicycle) g.translate(0, -ground, -0.17);
  const parts = [finish(rack, 0), ...bicycle, finish(lock, 2), finish(contact, 4)];
  const geometry = mergeGeometries(parts, false)!;
  for (const g of parts) g.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * World's Fair bench, 1.8 m overall; local -z = front, flat cast feet at y=0.
 * Ref: refs/_sheets/bryant-park.png is context only: neither joinery nor finish is resolved.
 * Curved castings, varnished slats and fasteners are authored goal requirements, not photo claims.
 * Budget unchanged: 488 triangles: two 148-triangle castings, nine 20-triangle slats,
 * one 12-triangle stretcher. Hardware/grain use bench-only UV tags, not extra draws/geometry.
 * Keep the catalogue's existing single instanced geometry / 180 m range (no separate far LOD).
 */
export function buildBench(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  // Black paint is dielectric. The flared feet and seat/back webs are one connected casting.
  const iron = { color: 0x272c29, rough: 0.62, metal: 0, grimeBand: [0, 0.14, 0.18] as [number, number, number] };
  const L = 1.8;
  // Side elevation [z,y]: swept arm nose, gently reclining back web, splayed feet.
  // Nominal 40 mm web, 56 mm grip and 80 mm ground pads; authored, not photo-measured.
  // Back webs finish behind the top slat instead of projecting above it like square posts.
  // The eight-point opening leaves a continuous rail immediately beneath the seat slats.
  // Bow the front leg into that rail under the front slat's z=-.264 bolt line;
  // the former shoulder left the bolt above an unsupported overhang. Same contour budget.
  const outline: [number, number][] = [
    [-0.315, 0], [-0.315, 0.022], [-0.270, 0.049], [-0.244, 0.250],
    [-0.274, 0.465], [-0.279, 0.589], [-0.263, 0.652], [-0.221, 0.691],
    [-0.073, 0.710], [0.076, 0.699], [0.127, 0.680], [0.145, 0.777],
    [0.173, 0.902], [0.211, 0.902], [0.189, 0.766], [0.174, 0.553],
    [0.217, 0.312], [0.255, 0.040], [0.281, 0.021], [0.281, 0],
    [0.181, 0], [0.181, 0.024], [0.204, 0.048], [0.172, 0.260],
    [0.129, 0.410], [-0.192, 0.410], [-0.218, 0.220], [-0.235, 0.038], [-0.219, 0],
  ];
  const opening: [number, number][] = [
    [-0.222, 0.444], [-0.240, 0.563], [-0.229, 0.616], [-0.198, 0.652],
    [-0.071, 0.672], [0.070, 0.662], [0.124, 0.636], [0.115, 0.444],
  ];
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(-z, y)));
  shape.holes.push(new THREE.Path(opening.map(([z, y]) => new THREE.Vector2(-z, y))));
  for (const x of [-0.8, 0.8]) {
    const casting = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false, steps: 1 });
    casting.translate(0, 0, -0.02);
    casting.rotateY(Math.PI / 2);
    const p = casting.getAttribute('position'), n = casting.getAttribute('normal');
    // Swell the existing casting cross-section, spending no new triangles. Four flat
    // pads remain exactly at y=0; the web tapers into them instead of ending as a blade.
    const halfWidth = (y: number, z: number) => {
      const pad = 1 - THREE.MathUtils.smoothstep(y, 0, 0.065);
      const grip = THREE.MathUtils.smoothstep(y, 0.50, 0.65)
        * (1 - THREE.MathUtils.smoothstep(y, 0.71, 0.77))
        * (1 - THREE.MathUtils.smoothstep(z, 0.075, 0.15));
      return 0.020 + 0.020 * pad + 0.008 * grip;
    };
    const cheekNormal = new THREE.Vector3(), delta = 0.0001;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), z = p.getZ(i), side = Math.sign(p.getX(i));
      p.setX(i, side * halfWidth(y, z));
      if (Math.abs(n.getX(i)) > 0.5) {
        // Continuous cheek normals keep the shallow swell from revealing cap triangulation.
        const dy = (halfWidth(y + delta, z) - halfWidth(y - delta, z)) / (2 * delta);
        const dz = (halfWidth(y, z + delta) - halfWidth(y, z - delta)) / (2 * delta);
        cheekNormal.set(side, -dy, -dz).normalize();
        n.setXYZ(i, cheekNormal.x, cheekNormal.y, cheekNormal.z);
      }
    }
    // Smooth the cast leg / arm / back sweeps, retaining the seat ledges and flat feet.
    // Each contour edge contributes once: extrusion's duplicated triangle vertices
    // otherwise bias the highlight toward whichever edge has more copies.
    const rimNormals = new Map<string, THREE.Vector3[]>();
    const rimKey = (i: number) => `${p.getY(i).toFixed(6)},${p.getZ(i).toFixed(6)}`;
    const isSweptRim = (i: number) => Math.abs(n.getX(i)) < 1e-5 && p.getY(i) > 0.065;
    for (let i = 0; i < p.count; i++) if (isSweptRim(i)) {
      const key = rimKey(i), normals = rimNormals.get(key) ?? [];
      const faceNormal = new THREE.Vector3().fromBufferAttribute(n, i);
      if (!normals.some(other => other.dot(faceNormal) > 0.99999)) normals.push(faceNormal);
      rimNormals.set(key, normals);
    }
    const creaseCos = Math.cos(THREE.MathUtils.degToRad(50));
    for (let i = 0; i < p.count; i++) if (isSweptRim(i)) {
      const faceNormal = new THREE.Vector3().fromBufferAttribute(n, i), sum = new THREE.Vector3();
      for (const other of rimNormals.get(rimKey(i))!) if (other.dot(faceNormal) > creaseCos) sum.add(other);
      sum.normalize();
      n.setXYZ(i, sum.x, sum.y, sum.z);
    }
    b.add(casting, iron, { x });
  }
  // Longitudinal stretcher joins both castings below the seat; no dangling center legs.
  b.box(1.6, 0.035, 0.035, iron, { y: 0.414, z: 0.055 });

  const tones = [0x725237, 0x79583b, 0x705237, 0x75573c, 0x715138, 0x76563a, 0x705035, 0x795a3e, 0x74553a];
  const slat = (id: number, width: number, y: number, z: number, rx: number) => {
    const h = 0.016, d = width / 2, bevel = 0.004;
    // Hexagonal section: two eased exposed long edges, closed ends, square underside.
    const section = new THREE.Shape([
      new THREE.Vector2(-d, -h), new THREE.Vector2(d, -h),
      new THREE.Vector2(d, h - bevel), new THREE.Vector2(d - bevel, h),
      new THREE.Vector2(-d + bevel, h), new THREE.Vector2(-d, h - bevel),
    ]);
    const g = new THREE.ExtrudeGeometry(section, { depth: L, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, -L / 2);
    g.rotateY(Math.PI / 2);
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      // u = metres along the board. v = board ID + cross-board coordinate; +20 hides
      // fasteners on end grain/undersides. Mapping is authored before each board tilts.
      uv.setXY(i, p.getX(i), id * 2 + 0.5 + p.getZ(i) / width + (n.getY(i) > 0.5 ? 0 : 20));
    }
    b.add(g, { color: tones[id], rough: 0.52 + (id % 3) * 0.025, metal: 0, keepUv: true, textured: true }, { y, z, rx });
  };
  // 12 mm seat gaps, 20 mm back gaps. Seat underside meets the cast rail at y=.444.
  for (let i = 0; i < 5; i++) slat(i, 0.092, 0.46, -0.264 + i * 0.104, 0);
  const backZ = [0.112, 0.116, 0.127, 0.150];
  const lean = [0.08, 0.10, 0.18, 0.23];
  for (let i = 0; i < 4; i++) slat(5 + i, 0.086, 0.545 + i * 0.106, backZ[i], -Math.PI / 2 + lean[i]);

  const g = b.build(), mat = g.getAttribute('aMat');
  // Reserved negative uvMode is emitted only by this asset. Shared material/atlas users
  // retain their original nonnegative modes; the bus-shelter bench is not affected.
  for (let i = 0; i < mat.count; i++) if (mat.getW(i) === 1) {
    mat.setZ(i, -1);
    mat.setW(i, 0);
  }
  // ExtrudeGeometry starts non-indexed. Weld matching attributes, retaining the hard
  // cast edges / slat bevels without spending three unique vertices per triangle.
  const indexed = mergeVertices(g, 1e-6);
  g.dispose();
  return indexed;
}

/**
 * Standard USPS pull-down collection box, authored height 1.20 m, front = -z.
 * Ref: refs/_general/mailbox-2.jpg, Elliott R. Plack (2013, CC0), and
 * ART_DIRECTION.md §4 / refs/_sheets/_general-1.png for restrained street wear.
 * The roof's cylinder axis runs ACROSS x; the arched end plates face +/-x.
 * Small reference print / hidden rear hardware cannot be resolved. Labels are
 * indicative, with no invented collection times. aMat.z=-6 is mailbox-only (-4/-5 belong to Citi Bike).
 * 696 triangles; bounds x +/-0.275, y 0..1.20, z -0.303..0.264 m.
 */
export function buildMailbox(): THREE.BufferGeometry {
  const paint = new MeshBuilder(), recess = new MeshBuilder();
  const hardware = new MeshBuilder(), labels = new MeshBuilder();
  const blue = { color: 0x254c7e, rough: 0.59, metal: 0 };
  const rimBlue = { color: 0x2b527f, rough: 0.53, metal: 0 };
  const dark = { color: 0x101e32, rough: 0.78, metal: 0 };
  const iron = { color: 0x535653, rough: 0.57, metal: 0.65 };

  // Placement can commit at physics y=0 before the 0.15 m sidewalk collider.
  // Keep the anchoring legs down to zero, but expose the foot plates at 0.155.
  // No placement offset and no increase to the required 1.20 m authored height.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * 0.242, z = sz * 0.228;
    // Both ends are buried in the paving/cabinet. Spend those hidden cap
    // triangles on the continuous bent pull handle, not extra prop geometry.
    for (const [w, d, px, pz] of [[0.036, 0.008, x, z + sz * 0.012],
      [0.008, 0.036, x + sx * 0.014, z]]) {
      const leg = new THREE.BoxGeometry(w, 0.40, d);
      const indices = Array.from(leg.getIndex()!.array);
      leg.setIndex([...indices.slice(0, 12), ...indices.slice(24)]);
      leg.clearGroups();
      paint.add(leg, blue, { x: px, y: 0.20, z: pz });
    }
    paint.box(0.066, 0.012, 0.072, rimBlue, { x, y: 0.161, z });
    // One visible, rusted anchor on each projecting toe. Omit its buried bottom
    // cap: eighteen triangles per head, entirely inside the existing foot bounds.
    const anchor = new THREE.CylinderGeometry(0.009, 0.0095, 0.015, 6);
    anchor.setIndex(Array.from(anchor.getIndex()!.array).slice(0, 54));
    anchor.clearGroups();
    const facetedAnchor = anchor.toNonIndexed();
    facetedAnchor.computeVertexNormals();
    anchor.dispose();
    hardware.add(facetedAnchor, { color: 0x886046, rough: 0.86, metal: 0 },
      { x: x - sx * 0.010, y: 0.1745, z: z + sz * 0.026 });
  }
  // End the solid cabinet below the open tray: a full-height block here would
  // fill the intake even after removing the old near-vertical flap.
  paint.box(0.528, 0.549, 0.50, blue, { y: 0.6345 });
  paint.quad(0.528, 0.041, blue, { y: 0.9295, z: 0.25 });

  // Thin D-shaped end panels, with a 24 mm rolled perimeter projecting 9 mm.
  // Three cross-section bands catch a broad enamel highlight, not a flat stripe.
  // Sixteen arc segments retain the original roof silhouette and 1.20 m height.
  const arcSegments = 16;
  for (const side of [-1, 1]) {
    const outline = new THREE.Shape();
    outline.moveTo(-0.25, 0.909);
    outline.lineTo(-0.25, 0.95);
    for (let i = 1; i <= arcSegments; i++) {
      const a = i * Math.PI / arcSegments;
      outline.lineTo(-0.25 * Math.cos(a), 0.95 + 0.25 * Math.sin(a));
    }
    outline.lineTo(0.25, 0.909);
    outline.closePath();
    // The body already supplies the rectangular part of each side. Cap only
    // the arch, avoiding hidden back faces / extrusion walls inside the box.
    paint.add(new THREE.ShapeGeometry(outline), blue, { x: side * 0.264, ry: side * Math.PI / 2 });

    const positions: number[] = [], normals: number[] = [], indices: number[] = [];
    // [radius in the end-panel plane, projection along x]. The ends tuck into
    // the shell; the rounded crown stays inside the existing mounting-tab bounds.
    const profile = [[0.250, 0.264], [0.245, 0.272], [0.233, 0.273], [0.226, 0.265]];
    const ringPoint = (baseY: number, radialY: number, radialZ: number) => {
      profile.forEach(([radius, x], j) => {
        positions.push(side * x, baseY + radius * radialY, radius * radialZ);
        const prev = profile[Math.max(0, j - 1)], next = profile[Math.min(profile.length - 1, j + 1)];
        const outward = prev[0] - next[0], radial = next[1] - prev[1];
        const length = Math.hypot(outward, radial);
        normals.push(side * outward / length, radialY * radial / length, radialZ * radial / length);
      });
    };
    ringPoint(0.17, 0, -1);
    for (let i = 0; i <= arcSegments; i++) {
      const a = i * Math.PI / arcSegments;
      ringPoint(0.95, Math.sin(a), -Math.cos(a));
    }
    ringPoint(0.17, 0, 1);
    const stride = profile.length;
    for (let i = 0; i < positions.length / (stride * 3) - 1; i++) {
      for (let j = 0; j < stride - 1; j++) {
        const k = i * stride + j, next = k + stride;
        if (side > 0) indices.push(k, next, k + 1, k + 1, next, next + 1);
        else indices.push(k, k + 1, next, k + 1, next + 1, next);
      }
    }
    const rim = new THREE.BufferGeometry();
    rim.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    rim.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    rim.setIndex(indices);
    paint.add(rim, rimBlue);
  }

  // Roof sheet is open over the hopper, not a solid barrel occluding its mouth.
  const roofPositions: number[] = [], roofNormals: number[] = [], roofIndices: number[] = [];
  const hoodStart = 4;
  for (let i = hoodStart; i <= arcSegments; i++) {
    const a = i * Math.PI / arcSegments;
    for (const x of [-0.264, 0.264]) {
      roofPositions.push(x, 0.95 + 0.25 * Math.sin(a), -0.25 * Math.cos(a));
      roofNormals.push(0, Math.sin(a), -Math.cos(a));
    }
    if (i < arcSegments) {
      const k = (i - hoodStart) * 2;
      roofIndices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(roofPositions, 3));
  roof.setAttribute('normal', new THREE.Float32BufferAttribute(roofNormals, 3));
  roof.setIndex(roofIndices);
  paint.add(roof, blue);
  // Ref: the opened pull-down drum exposes a sloping tray, with its handle
  // recessed beneath the hood. The back is 0.35 m behind the projecting lip,
  // not a dark plane just behind a closed flap. Inner cheeks face the cavity.
  // Taller mouth and a 14-degree tray show the drum's depth without turning
  // the dark intake into a pale, nearly flush rectangle.
  recess.quad(0.488, 0.185, { ...dark, color: 0x1b314e },
    { y: 1.0965, z: 0.059, ry: Math.PI });
  for (const side of [-1, 1]) {
    const cheek = new THREE.BufferGeometry();
    cheek.setAttribute('position', new THREE.Float32BufferAttribute([
      side * 0.244, 0.916, -0.292, side * 0.244, 1.005, 0.059,
      side * 0.244, 1.189, 0.059, side * 0.244, 1.127, -0.177,
    ], 3));
    cheek.setIndex(side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    recess.add(cheek, { ...dark, color: 0x203c5e });
  }
  const trayAngle = -Math.atan2(0.089, 0.351);
  const tray = new THREE.BoxGeometry(0.478, 0.008, Math.hypot(0.089, 0.351));
  const trayIndices = Array.from(tray.getIndex()!.array);
  tray.setIndex([...trayIndices.slice(0, 18), ...trayIndices.slice(24)]); // hidden underside
  tray.clearGroups();
  paint.add(tray, { ...blue, color: 0x2b4b72, rough: 0.67 },
    { y: 0.9605, z: -0.1165, rx: trayAngle });
  // Folded sheet-metal lip: flat top, chamfered nose and a substantial return,
  // rather than a thin rectangular strip or a round pipe across the opening.
  const lipProfile = new THREE.Shape([
    new THREE.Vector2(-0.012, -0.008), new THREE.Vector2(0.012, -0.008),
    new THREE.Vector2(0.015, 0.001), new THREE.Vector2(0.011, 0.009),
    new THREE.Vector2(-0.011, 0.009), new THREE.Vector2(-0.015, 0.001),
  ]);
  const lip = new THREE.ExtrudeGeometry(lipProfile, { depth: 0.478, bevelEnabled: false, steps: 1 });
  lip.translate(0, 0, -0.239);
  paint.add(lip, rimBlue, { y: 0.919, z: -0.288, ry: Math.PI / 2 });
  paint.quad(0.488, 0.008, rimBlue, { y: 1.125, z: -0.178, ry: Math.PI });
  hardware.cylC(0.004, 0.004, 0.464, 6, iron,
    { y: 1.011, z: 0.050, rz: Math.PI / 2 }, true);
  // Continuous round painted rod with bent returns, projecting 18 cm from
  // the rear drum. Its open ends terminate behind the back panel.
  const handleCurve = new THREE.CatmullRomCurve3([
    [-0.102, 1.075, 0.068], [-0.102, 1.075, -0.068], [-0.077, 1.075, -0.108],
    [0.077, 1.075, -0.108], [0.102, 1.075, -0.068], [0.102, 1.075, 0.068],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  paint.add(new THREE.TubeGeometry(handleCurve, 7, 0.0115, 6, false),
    { ...rimBlue, color: 0x34567d, rough: 0.43 });

  // Lower collection-access panel, proud folded top edge and shallow lock.
  recess.box(0.457, 0.392, 0.006, dark, { y: 0.56, z: -0.253 });
  paint.box(0.441, 0.379, 0.008, blue, { y: 0.5595, z: -0.257 });
  paint.box(0.464, 0.027, 0.026, rimBlue, { y: 0.754, z: -0.267 });
  hardware.cylC(0.011, 0.011, 0.004, 6, iron, { y: 0.712, z: -0.264, rx: Math.PI / 2 });
  recess.quad(0.0025, 0.008, dark, { y: 0.712, z: -0.2665, ry: Math.PI });
  paint.box(0.433, 0.142, 0.010, rimBlue, { y: 0.838, z: -0.254 });

  // Dedicated 512px mailbox label sheet; these UVs never address SignAtlas.
  // Transparent label margins retain the backing's paint roughness; the
  // mailbox shader applies paper roughness only where the label has ink/paper.
  const labelStyle = { ...blue, keepUv: true };
  const rect = (x: number, y: number, w: number, h: number): [number, number, number, number] =>
    [x / 512, 1 - (y + h) / 512, w / 512, h / 512];
  for (const side of [-1, 1]) labels.quad(0.214, 0.225, labelStyle,
    { x: side * 0.265, y: 0.626, z: 0.005, ry: side * Math.PI / 2 }, rect(4, 4, 248, 248));
  labels.quad(0.414, 0.124, { ...labelStyle, ...rimBlue }, { y: 0.838, z: -0.260, ry: Math.PI }, rect(264, 8, 240, 120));
  // Keep the brief-led stencil small and on the sides; the reference's large
  // front access door is plain blue. Existing eagle decals remain above it.
  for (const side of [-1, 1]) labels.quad(0.127, 0.030, labelStyle,
    { x: side * 0.265, y: 0.465, z: 0.005, ry: side * Math.PI / 2 }, rect(264, 156, 240, 64));
  // Worn instruction-paper remnant on the tray, not invented schedule text.
  labels.quad(0.262, 0.099, { ...labelStyle, color: 0x2b4b72, rough: 0.67 },
    { x: -0.016, y: 0.9430, z: -0.204, rx: -Math.PI / 2 + trayAngle, rz: Math.PI }, rect(264, 348, 240, 88));
  labels.quad(0.047, 0.034, labelStyle,
    { x: -0.154, y: 0.418, z: -0.2616, ry: Math.PI, rz: -0.08 }, rect(264, 244, 112, 80));
  labels.quad(0.043, 0.027, labelStyle,
    { x: 0.265, y: 0.792, z: -0.134, ry: Math.PI / 2, rx: 0.06 }, rect(384, 244, 104, 80));

  const parts = [paint, recess, hardware, labels].map((builder, role) => {
    const g = builder.build(), mat = g.getAttribute('aMat');
    for (let i = 0; i < mat.count; i++) { mat.setZ(i, -6); mat.setW(i, role); }
    return g;
  });
  const merged = mergeGeometries(parts, false)!;
  const geometry = mergeVertices(merged, 1e-6);
  for (const part of parts) part.dispose();
  merged.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Hollow ~1.2 m square, ~0.6 m high exposed-aggregate planter. Ref: _general/hydrant-1.jpg
 * and _sheets/_general-1.png, ART_DIRECTION §3–4. The distant planting establishes
 * muted neutral stone, not the hidden rim/soil construction; those follow the brief.
 * -12 is planter-only: w = exterior stone / interior / soil / bark. No atlas remap.
 * 374 triangles, one existing instanced draw; bounds [-0.55, 0, -0.55]..[0.55, 0.70, 0.55].
 */
export function buildPlanter(): THREE.BufferGeometry {
  const b = new MeshBuilder(), random = rng(127473);
  const stone: PartStyle = { color: 0xa4a19b, rough: 0.83, metal: 0 };
  const add = (g: THREE.BufferGeometry, role: number, style = stone) => {
    b.add(g, style);
    const mat = g.getAttribute('aMat');
    for (let i = 0; i < mat.count; i++) { mat.setZ(i, -12); mat.setW(i, role); }
  };
  const ring = (half: number, y: number, chamfer: number): THREE.Vector3[] => [
    [-half + chamfer, -half], [half - chamfer, -half], [half, -half + chamfer],
    [half, half - chamfer], [half - chamfer, half], [-half + chamfer, half],
    [-half, half - chamfer], [-half, -half + chamfer],
  ].map(([x, z]) => new THREE.Vector3(x, y, z));
  // Slim the casting to 1.10 m square, retaining the 0.70 m top and root anchor.
  // The bearing pad returns UP inside the underside; the outer skirt descends
  // to 2 mm above ground, hiding the support instead of resting on a visible step.
  // Retain the 9 cm wall, 6.8 cm flat rim and inward return; planting masks parts.
  // Nothing spans the opening at rim height; mounting detail is brief-led.
  const profiles = [
    ring(0.310, 0, 0.025), ring(0.310, 0.014, 0.025),
    ring(0.429, 0.002, 0.029), ring(0.438, 0.018, 0.030),
    ring(0.550, 0.678, 0.034), ring(0.540, 0.700, 0.032),
    ring(0.472, 0.700, 0.027), ring(0.460, 0.685, 0.025),
    ring(0.426, 0.490, 0.025),
  ];
  for (let band = 0; band < profiles.length - 1; band++) {
    const positions: number[] = [], indices: number[] = [];
    for (let i = 0; i < 8; i++) {
      const j = (i + 1) % 8, k = positions.length / 3;
      for (const p of [profiles[band][i], profiles[band + 1][i], profiles[band + 1][j], profiles[band][j]])
        positions.push(...p.toArray());
      indices.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices);
    // The lip is the same casting, not a pale applied cap. Lighting describes
    // its thickness; only the inner return receives a modest occlusion tint.
    add(g, band >= 6 ? 1 : 0, band >= 6 ? { ...stone, color: 0x98948c } : stone);
  }
  // Closed underside, flush with the existing ground origin (no floating feet).
  const underside = new THREE.BufferGeometry();
  underside.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, ...profiles[0].flatMap(p => p.toArray())], 3));
  underside.setIndex(Array.from({ length: 8 }, (_, i) => [0, i + 1, (i + 1) % 8 + 1]).flat());
  add(underside, 0);

  // A gently uneven bed, 18–20 cm below the lip, with sidewall occlusion in its
  // vertex colours. Three rings keep the depression volumetric at grazing angles.
  const innerBottom = profiles[profiles.length - 1];
  const perimeter = innerBottom.flatMap((p, i) => [p, p.clone().lerp(innerBottom[(i + 1) % 8], 0.5)]);
  const soilPositions = [0, 0.505, 0], soilIndices: number[] = [];
  for (const radius of [0.34, 0.68, 1]) for (const p of perimeter) {
    // Bury the bed's perimeter a few mm into the tapered return; its uneven
    // heights must not leave a bright crack between the soil and the stone.
    soilPositions.push(p.x * radius * 1.02, 0.505 + radius * 0.008 + (random() - 0.5) * 0.012, p.z * radius * 1.02);
  }
  for (let i = 0; i < 16; i++) {
    const j = (i + 1) % 16;
    soilIndices.push(0, 1 + j, 1 + i);
    for (let r = 0; r < 2; r++) {
      const a = 1 + r * 16 + i, c = 1 + r * 16 + j;
      soilIndices.push(a, c, c + 16, a, c + 16, a + 16);
    }
  }
  const soil = new THREE.BufferGeometry();
  soil.setAttribute('position', new THREE.Float32BufferAttribute(soilPositions, 3));
  soil.setIndex(soilIndices);
  add(soil, 2, { color: 0x51402b, rough: 1 });
  const soilColor = soil.getAttribute('color');
  for (let i = 0; i < soilColor.count; i++) {
    const p = soil.getAttribute('position'), edge = Math.max(Math.abs(p.getX(i)), Math.abs(p.getZ(i)));
    const shade = 1 - 0.28 * Math.pow(edge / (0.426 * 1.02), 5);
    soilColor.setXYZ(i, soilColor.getX(i) * shade, soilColor.getY(i) * shade, soilColor.getZ(i) * shade);
  }
  // Small raised bark chips break the soil plane; four triangles each, no hidden boxes.
  for (let i = 0; i < 32; i++) {
    const x = (random() - 0.5) * 0.77, z = (random() - 0.5) * 0.77;
    const w = 0.009 + random() * 0.009, l = 0.017 + random() * 0.023;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      -w, 0, 0, 0, 0.001, -l, w, 0, 0, 0, 0.002, l, 0, 0.005 + random() * 0.006, 0,
    ], 3));
    g.setIndex([0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0]);
    g.rotateY(random() * Math.PI).translate(x, 0.517, z);
    add(g, 3, { color: [0x66503a, 0x493627, 0x766049, 0x3d3023][i % 4], rough: 0.97 });
  }
  // Root collars bridge recessed mulch to the shrub's unchanged y=0.55 anchor.
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(0.008, 0.016, 0.08, 5, 1, true);
    g.rotateZ((i - 1) * 0.18).translate((i - 1) * 0.034, 0.54, i % 2 * 0.025);
    add(g, 3, { color: 0x514533, rough: 0.95 });
  }
  return b.build();
}

/**
 * Boxwood / broad-leaf sprays, not whole-bush crossed billboards. Ref: planting
 * at the right of _general/citibike-1.jpg; species is brief-led, not photo-verified.
 * The original root y≈0.55, crown y<=1.35 and <=1.2 m spread remain cafe-compatible
 * at the existing 0.42 scale. -13 selects only these alpha leaves / opaque twigs.
 * 1,376 triangles (240 curled sprays + 96 individual leaves + 28 tapered twigs),
 * one existing instanced draw, with the same texture size and no opaque foliage core.
 */
export function buildShrub(): THREE.BufferGeometry {
  const b = new MeshBuilder(), random = rng(71338);
  const add = (g: THREE.BufferGeometry, role: number, style: PartStyle) => {
    b.add(g, { ...style, keepUv: true });
    const mat = g.getAttribute('aMat');
    for (let i = 0; i < mat.count; i++) { mat.setZ(i, -13); mat.setW(i, role); }
  };
  const twig = (start: THREE.Vector3, end: THREE.Vector3, radius: number) => {
    const delta = end.clone().sub(start);
    const g = new THREE.CylinderGeometry(radius * 0.42, radius, delta.length(), 4, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    g.translate(...start.clone().add(end).multiplyScalar(0.5).toArray());
    add(g, 1, { color: 0x665b40, rough: 0.95 });
  };
  // Overlapping growth zones share one woody root, but not a spherical envelope:
  // a high off-centre leader, uneven shoulders and a low, overlapping leafy skirt.
  // Give the low shoulders vertical depth, not pancake-shaped foliage clusters.
  // Trade 48 four-triangle sprays for 96 independently turned two-triangle leaves
  // on the silhouette: the same budget, with varied leaf normals at the tips.
  // Cafe scaling still uses the original root anchor, not the stone rim height.
  const growth = [
    { centre: new THREE.Vector3(-0.14, 1.11, -0.10), radii: new THREE.Vector3(0.23, 0.165, 0.22), count: 42, leaves: 16 },
    { centre: new THREE.Vector3(0.20, 0.985, 0.07), radii: new THREE.Vector3(0.24, 0.155, 0.24), count: 36, leaves: 14 },
    { centre: new THREE.Vector3(-0.06, 1.01, 0.27), radii: new THREE.Vector3(0.24, 0.15, 0.17), count: 34, leaves: 12 },
    { centre: new THREE.Vector3(0.06, 0.91, -0.28), radii: new THREE.Vector3(0.29, 0.14, 0.185), count: 30, leaves: 12 },
    { centre: new THREE.Vector3(-0.31, 0.780, 0.05), radii: new THREE.Vector3(0.17, 0.14, 0.27), count: 24, leaves: 10 },
    { centre: new THREE.Vector3(0.31, 0.805, 0.04), radii: new THREE.Vector3(0.18, 0.14, 0.25), count: 24, leaves: 10 },
    { centre: new THREE.Vector3(0.02, 0.790, -0.385), radii: new THREE.Vector3(0.32, 0.135, 0.12), count: 32, leaves: 12 },
    { centre: new THREE.Vector3(0.02, 0.815, 0.34), radii: new THREE.Vector3(0.28, 0.14, 0.17), count: 18, leaves: 10 },
  ];
  for (let i = 0; i < 14; i++) {
    const angle = i * 2.39996323, shoot = growth[i % growth.length];
    const root = new THREE.Vector3(Math.cos(angle) * 0.023, 0.56, Math.sin(angle) * 0.023);
    const tip = shoot.centre.clone().add(new THREE.Vector3(Math.cos(angle) * 0.07, random() * 0.05, Math.sin(angle) * 0.07));
    const fork = root.clone().lerp(tip, 0.48);
    fork.y += 0.025 + random() * 0.025;
    twig(root, fork, 0.007);
    twig(fork, tip, 0.004);
  }
  // Stratify each zone, with interior sprays supplying depth through the alpha
  // gaps. Uneven radial reach breaks the small clusters' outlines as well.
  for (let zone = 0; zone < growth.length; zone++) for (let i = 0; i < growth[zone].count; i++) {
    const shoot = growth[zone];
    const v = 1 - 2 * (i + 0.5) / shoot.count, angle = i * 2.39996323 + zone * 1.7 + random() * 0.4;
    const belt = Math.sqrt(1 - v * v), radius = i % 3 === 0 ? 0.35 + random() * 0.4 : 0.75 + random() * 0.25;
    const reach = radius * (0.90 + 0.10 * Math.sin(angle * 3 + v * 5));
    const centre = new THREE.Vector3(Math.cos(angle) * belt, v, Math.sin(angle) * belt)
      .multiply(shoot.radii).multiplyScalar(reach).add(shoot.centre);
    const w = 0.145 + random() * 0.055, h = 0.16 + random() * 0.062;
    const g = new THREE.PlaneGeometry(w, h, 2, 1), p = g.getAttribute('position');
    // The middle ridge and tips curl independently; a whole spray no longer
    // shares two flat planes or a straight top-to-bottom crease.
    const curl = 0.012 + random() * 0.014, twist = (random() - 0.5) * 0.030;
    for (let j = 0; j < p.count; j++) {
      const x = p.getX(j) / w, y = p.getY(j) / h;
      p.setZ(j, (1 - Math.abs(x) * 2) * curl * (0.8 + y * 0.5) + x * y * twist * 4);
    }
    g.computeVertexNormals();
    const direction = new THREE.Vector3(Math.cos(angle) * belt + (random() - 0.5) * 0.8,
      0.25 + Math.abs(v) * 0.6 + (random() - 0.5) * 1.1, Math.sin(angle) * belt + (random() - 0.5) * 0.8).normalize();
    g.rotateZ(random() * Math.PI * 2);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction));
    g.translate(centre.x, centre.y, centre.z);
    const uv = g.getAttribute('uv'), tile = (i + zone) % 2;
    for (let j = 0; j < uv.count; j++) uv.setXY(j,
      (tile % 2 + 0.012 + uv.getX(j) * 0.976) * 0.5,
      (Math.floor(tile / 2) + 0.012 + uv.getY(j) * 0.976) * 0.5);
    const light = 0.8 + random() * 0.2 + Math.max(0, v) * 0.05;
    add(g, 0, { color: [light * 0.97, light, light * 0.93], rough: 0.83 });
  }
  // Separate 3–8 cm blades provide parallax and small gaps beyond the sprays.
  // Keep them around the existing growth envelope, not a new spherical shell.
  for (let zone = 0; zone < growth.length; zone++) for (let i = 0; i < growth[zone].leaves; i++) {
    const shoot = growth[zone], v = 1 - 2 * (i + 0.5) / shoot.leaves;
    const angle = i * 2.39996323 + zone * 2.1, belt = Math.sqrt(1 - v * v);
    const outward = new THREE.Vector3(Math.cos(angle) * belt, v, Math.sin(angle) * belt);
    const centre = outward.clone().multiply(shoot.radii).multiplyScalar(0.92 + random() * 0.18).add(shoot.centre);
    const broad = (i + zone) % 3 === 0;
    const h = (broad ? 0.066 : 0.040) + random() * 0.014, w = h * (broad ? 0.69 : 0.55);
    const g = new THREE.PlaneGeometry(w, h), p = g.getAttribute('position');
    // Twist the quad slightly instead of sending every leaf through the same plane.
    p.setZ(0, h * 0.10); p.setZ(3, -h * 0.07); g.computeVertexNormals();
    const direction = outward.clone().multiplyScalar(0.65).add(new THREE.Vector3(
      (random() - 0.5) * 1.3, 0.45 + random() * 0.5, (random() - 0.5) * 1.3)).normalize();
    g.rotateZ(random() * Math.PI * 2);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction));
    g.translate(centre.x, centre.y, centre.z);
    const uv = g.getAttribute('uv'), tile = broad ? 3 : 2;
    for (let j = 0; j < uv.count; j++) uv.setXY(j,
      (tile % 2 + 0.012 + uv.getX(j) * 0.976) * 0.5,
      (1 + 0.012 + uv.getY(j) * 0.976) * 0.5);
    const light = 0.88 + random() * 0.15;
    add(g, 0, { color: [light * 0.97, light, light * 0.94], rough: broad ? 0.8 : 0.83 });
  }
  return b.build();
}

/** the green globe lamp that marks subway entrances, on a black post (1.9 m) */
export function buildGlobeLamp(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const post = { color: 0x111214, rough: 0.5, metal: 0.6 };
  b.cyl(0.05, 0.06, 1.75, 8, post);
  b.cyl(0.09, 0.07, 0.08, 8, post, { y: 1.75 });
  b.sphere(0.17, 12, { color: 0x2f9a4a, rough: 0.35, metal: 0, emit: EMIT.nightGlow, emitStrength: 1.6 }, { y: 1.98 });
  b.cyl(0.03, 0.05, 0.05, 8, post, { y: 2.12 });
  return b.build();
}
