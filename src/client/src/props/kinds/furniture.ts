/**
 * Larger sidewalk furniture: MTA bus shelter, Citi Bike dock + bike, LinkNYC kiosk, newsstand,
 * food cart, Con Ed steam stack. Real dimensions. Local -z faces the street unless noted.
 */
import * as THREE from 'three';
import { MeshBuilder, EMIT, type PartStyle } from '../builder';
import { BUS_SIGN_FRAC, BUS_SIGN_LAYOUT, newsstandUv } from '../atlas';

const STEEL_DARK = { color: 0x2b2d30, rough: 0.45, metal: 0.85 };
const STAINLESS = { color: 0xb9bcbf, rough: 0.3, metal: 0.95 };
const ATLAS_WHITE = { color: 0xffffff, rough: 0.4, metal: 0.1, atlas: true, keepUv: true };

/** uv-rect quad helper (fraction of the atlas slot, y from the top) */
function slotQuad(b: MeshBuilder, w: number, h: number, style: { color: number; rough: number; metal: number; emit?: number; emitStrength?: number }, t: { x?: number; y?: number; z?: number; ry?: number; rx?: number; rz?: number }, frac: [number, number, number, number]): void {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, frac[0] + uv.getX(i) * frac[2], 1 - frac[1] - frac[3] + uv.getY(i) * frac[3]);
  // Front panels sit on -z; PlaneGeometry faces +z unless explicitly turned outward.
  b.add(g, { ...style, atlas: true, keepUv: true }, { ry: Math.PI, ...t });
}

// Shelter-only selectors: -10 unprinted metal (w=1 seat skin), -11 glazing, +5 backlit print.
// Never let the shared sign atlas paint the frame (or change another prop's finish).
function finishShelter(b: MeshBuilder, glass = false): THREE.BufferGeometry {
  const g = b.build(), mat = g.getAttribute('aMat');
  for (let i = 0; i < mat.count; i++) mat.setZ(i, glass ? -11 : mat.getZ(i) > 0.5 ? 5 : -10);
  return g;
}

// Neutral/cool galvanized steel, not the warm painted-metal palette of nearby street furniture.
// Satin reflections use the existing -10 PBR finish, not painted highlights or extra wear.
const SHELTER_STEEL: PartStyle = { color: 0xa6afb7, rough: 0.30, metal: 0.78 };
const SHELTER_TRIM: PartStyle = { color: 0x525c65, rough: 0.36, metal: 0.76 };
// Matches placement.ts's busSign offset exactly; do not compensate for a particular camera/yaw.
const SHELTER_SIGN = { x: -2.75, z: -0.55, top: 3.62, center: 3.15 };
const SHELTER_PANES = [-1.378, 0, 1.378];

/**
 * Ref: fifth-42nd is context; halal-cart-1's distant shelter supports the thin canopy,
 * not resolved joinery. Hardware/bench/print are requirement-led, not traced photo detail.
 * Keep the 4.3 x 1.5 m frame, +/-2.1 post centres, open -z street face and catalogue split.
 * Feet start at the rendered +0.15 m sidewalk; the original instance origin/yaw are unchanged.
 */
export function buildBusShelter(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const frame = SHELTER_STEEL, trim = SHELTER_TRIM;
  // Keep the existing foot scuffs/fasteners, but avoid near-black plates against the paving.
  const basePlate: PartStyle = { color: 0x858d93, rough: 0.48, metal: 0.72 };
  const fastener: PartStyle = { color: 0xbcc4cc, rough: 0.29, metal: 0.86 };
  const rubber: PartStyle = { color: 0x303a39, rough: 0.83, metal: 0 };
  const edge: PartStyle = { color: 0x688a80, rough: 0.23, metal: 0.18 };
  // Small bevels catch real light on the slender rectangular steel uprights.
  const postRing: [number, number][] = [[-0.027, -0.041], [0.027, -0.041], [0.035, -0.033], [0.035, 0.033],
    [0.027, 0.041], [-0.027, 0.041], [-0.035, 0.033], [-0.035, -0.033]];
  for (const x of [-2.1, 2.1]) for (const z of [-0.7, 0.7]) {
    b.prism(postRing, 2.42, frame, { x, y: 0.185, z });
    b.box(0.185, 0.023, 0.17, basePlate, { x, y: 0.1615, z });
    b.box(0.093, 0.085, 0.104, frame, { x, y: 0.215, z });
    for (const s of [-1, 1]) b.cyl(0.011, 0.011, 0.008, 6, fastener, { x: x + s * 0.064, y: 0.173, z });
    // The collar is the same satin steel as the post, not a charcoal patch at the joint.
    b.box(0.092, 0.062, 0.098, frame, { x, y: 2.581, z });
  }
  // refs/_sheets/fifth-42nd.png / halal-cart-1: only the shallow canopy silhouette is resolved.
  // A 28 mm folded roof edge; supports sit inboard, not stacked on the fascia.
  // Keep the existing top height/footprint and a non-emissive metal soffit.
  // No full-canopy emitter: only the two recessed strips below are luminous at night.
  b.box(4.6, 0.008, 1.8, { color: 0x7c858e, rough: 0.58, metal: 0.60 }, { y: 2.672 });
  b.box(4.46, 0.008, 1.65, { color: 0x919ba4, rough: 0.36, metal: 0.76 }, { y: 2.652 });
  for (const z of [-0.888, 0.888]) {
    b.box(4.6, 0.020, 0.024, frame, { y: 2.658, z });
    b.box(4.6, 0.005, 0.028, fastener, { y: 2.670, z: z * (0.886 / 0.888) });
  }
  for (const x of [-2.288, 2.288]) b.box(0.024, 0.020, 1.752, frame, { x, y: 2.658 });
  // Raise only the inboard crossmembers to meet the shallower soffit and post collars.
  for (const x of [-2.1, 2.1]) b.box(0.073, 0.040, 1.50, trim, { x, y: 2.632 });
  for (const z of [-0.7, 0.7]) b.box(4.2, 0.036, 0.064, frame, { y: 2.611, z });
  for (const x of [-0.91, 0.91]) {
    b.box(1.46, 0.018, 0.054, trim, { x, y: 2.584, z: 0.684 });
    b.quad(1.40, 0.027, { color: 0xe0e4d6, rough: 0.42, metal: 0, emit: EMIT.nightGlow, emitStrength: 0.72 },
      { x, y: 2.574, z: 0.684, rx: Math.PI / 2 });
  }
  // Three separate rear panes with green cut edges, narrow channels and actual clamps.
  for (const y of [0.342, 2.502]) b.box(4.19, 0.028, 0.038, frame, { y, z: 0.7 });
  for (const x of SHELTER_PANES) {
    for (const s of [-1, 1]) {
      b.box(0.008, 2.13, 0.012, edge, { x: x + s * 0.676, y: 1.425, z: 0.7 });
      for (const y of [0.395, 2.463]) {
        const cx = x + s * 0.568;
        b.box(0.066, 0.041, 0.030, rubber, { x: cx, y, z: 0.7 });
        b.box(0.048, 0.048, 0.037, frame, { x: cx, y, z: 0.7 });
        b.cylC(0.007, 0.007, 0.008, 6, fastener, { x: cx, y, z: 0.676, rx: Math.PI / 2 });
      }
    }
  }
  // The open-end windscreen shares the existing x=-2.1 plane, not a new enclosure.
  for (const y of [0.342, 2.502]) b.box(0.038, 0.028, 1.32, frame, { x: -2.1, y });
  for (const z of [-0.642, 0.642]) {
    b.box(0.012, 2.13, 0.008, edge, { x: -2.1, y: 1.425, z });
    for (const y of [0.395, 2.463]) b.box(0.044, 0.050, 0.052, frame, { x: -2.1, y, z: z * 0.84 });
  }
  // A continuous 2.2 m folded seat, 0.45 m above paving, with the existing open supports.
  // The reference cannot resolve seating. Keep shallow lengthwise drainage grooves in
  // the filtered -10/w=1 shader instead of five thin strips and aliasing through-gaps.
  // Here textured marks only the seat subtype; finishShelter's -10 bypasses the atlas.
  const seat: PartStyle = { color: 0xa6afb7, rough: 0.32, metal: 0.80, textured: true };
  const seatRing: [number, number][] = [[-0.013, -0.1985], [-0.013, 0.1985], [-0.006, 0.2075],
    [0.013, 0.2075], [0.018, 0.2015], [0.018, -0.1985], [0.011, -0.2075], [-0.006, -0.2075]];
  // Prism height becomes the seat's x axis; keep the 415 mm depth and meet the support tops at y=.574.
  b.prism(seatRing, 2.2, seat, { x: -1.7, y: 0.592, z: 0.362, rz: -Math.PI / 2 });
  for (const x of [-1.48, 0.28]) {
    b.box(0.052, 0.046, 0.45, trim, { x, y: 0.551, z: 0.364 });
    b.box(0.052, 0.36, 0.065, frame, { x, y: 0.373, z: 0.44 });
    b.box(0.21, 0.025, 0.24, basePlate, { x, y: 0.1625, z: 0.44 });
    b.tube([x, 0.25, 0.44], [x, 0.54, 0.19], 0.013, 6, frame);
    for (const s of [-1, 1]) b.cyl(0.010, 0.010, 0.008, 6, fastener, { x: x + s * 0.072, y: 0.175, z: 0.44 });
  }
  // Discrete grab/divider rails leave the seat and its drainage gaps readable.
  for (const x of [-1.69, -0.60, 0.49]) {
    b.tube([x, 0.61, 0.52], [x, 0.79, 0.49], 0.013, 6, frame);
    b.tube([x, 0.79, 0.49], [x, 0.79, 0.22], 0.013, 6, frame);
    b.tube([x, 0.79, 0.22], [x, 0.61, 0.19], 0.013, 6, frame);
  }
  // Closed +x end: recessed double-sided advertising case, gasket, service hinges and sill.
  b.box(0.136, 1.96, 1.30, trim, { x: 2.1, y: 1.30 });
  for (const s of [-1, 1]) {
    const x = 2.1 + s * 0.073;
    b.box(0.012, 1.768, 1.168, rubber, { x, y: 1.30 });
    for (const z of [-0.616, 0.616]) b.box(0.031, 1.94, 0.063, frame, { x, y: 1.30, z });
    for (const y of [0.363, 2.237]) b.box(0.033, 0.086, 1.26, frame, { x, y });
    slotQuad(b, 1.1, 1.7, { color: 0xffffff, rough: 0.39, metal: 0, emit: EMIT.mapGlowNight, emitStrength: 0.95 },
      { x: 2.1 + s * 0.081, y: 1.30, ry: s * Math.PI / 2 }, [0, 0, 1, 1]);
  }
  for (const y of [0.58, 2.02]) b.cyl(0.012, 0.012, 0.07, 6, fastener, { x: 2.19, y, z: 0.615 });
  b.box(0.018, 0.040, 0.021, trim, { x: 2.195, y: 1.24, z: -0.604 });
  b.box(0.16, 0.040, 1.34, frame, { x: 2.1, y: 0.318 });
  // Independent dynamic sign geometry uses this very same anchor and height.
  b.cyl(0.036, 0.041, SHELTER_SIGN.top - 0.15, 12, frame, { x: SHELTER_SIGN.x, y: 0.15, z: SHELTER_SIGN.z });
  b.cyl(0.073, 0.080, 0.11, 8, basePlate, { x: SHELTER_SIGN.x, y: 0.15, z: SHELTER_SIGN.z });
  b.cyl(0.040, 0.040, 0.016, 12, fastener, { x: SHELTER_SIGN.x, y: SHELTER_SIGN.top, z: SHELTER_SIGN.z });
  return finishShelter(b);
}

export function buildShelterGlass(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const glass: PartStyle = { color: 0xa5bab4, rough: 0.09, metal: 0 };
  // One double-sided surface per pane avoids two superimposed alpha layers/milky glass.
  // Normalized pane UVs drive only this shelter's edge dust, wipe marks and safety dots.
  for (const x of SHELTER_PANES) b.quad(1.352, 2.13, glass, { x, y: 1.425, z: 0.7, ry: Math.PI });
  b.quad(1.284, 2.13, glass, { x: -2.1, y: 1.425, ry: Math.PI / 2 });
  for (const s of [-1, 1]) b.quad(1.1, 1.7, { ...glass, textured: true },
    { x: 2.1 + s * 0.083, y: 1.30, ry: s * Math.PI / 2 });
  return finishShelter(b, true);
}

/** Round blue/red flag head, separate route sheets, same pole anchor and 2:1 dynamic slot.
 * The distant halal-cart-1 flag supports the outline and stacked colors, not precise hardware.
 * Route-sheet cutouts are atlas-driven so all route lists still share one instanced geometry.
 */
export function buildBusSignPlate(standalonePole: boolean): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const W = 0.42, H = 0.84, y = SHELTER_SIGN.center;
  const layout = BUS_SIGN_LAYOUT;
  const shape = new THREE.Shape();
  shape.absarc(0, H * (0.5 - layout.headHeight / 2), W / 2, 0, Math.PI * 2, false);
  // Project every route-sheet face through the existing rotated portrait rect.
  // Back faces reverse x, not the route text; sheet edges use the same alpha gaps.
  const flagUv = (g: THREE.BufferGeometry, offsetY = 0) => {
    const pos = g.getAttribute('position'), normal = g.getAttribute('normal'), uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      const u = (normal.getZ(i) < -0.5 ? -1 : 1) * pos.getX(i) / W + 0.5;
      const v = (pos.getY(i) + offsetY) / H + 0.5;
      uv.setXY(i, (1 - v) * BUS_SIGN_FRAC, u);
    }
  };
  for (const s of [-1, 1]) {
    const plate = new THREE.ExtrudeGeometry(shape, { depth: 0.009, bevelEnabled: false, curveSegments: 12, steps: 1 });
    plate.translate(0, 0, -0.0045);
    b.add(plate, SHELTER_STEEL, { y, z: s * 0.061 });
    const g = new THREE.ShapeGeometry(shape, 12);
    flagUv(g);
    // Create each face before MeshBuilder consumes/transforms it; no cloned double translation.
    b.add(g, { ...ATLAS_WHITE, rough: 0.48, metal: 0 }, { y, z: s * 0.067, ry: s < 0 ? Math.PI : 0 });
    const routeY = H * (0.5 - (layout.routeTop + layout.routeBottom) / 2);
    const sheet = new THREE.BoxGeometry(W * (1 - 2 * layout.routeInset), H * (layout.routeBottom - layout.routeTop), 0.009);
    flagUv(sheet, routeY);
    // +6 discards the unprinted gaps and unused rows, including these edges/back faces.
    // No continuous grey backing can bridge separate route panels or surround the head.
    b.add(sheet, { ...ATLAS_WHITE, rough: 0.48, metal: 0 }, { y: y + routeY, z: s * 0.061 });
  }
  // Both collars remain centered on the unchanged pole; the lower one meets the first
  // route sheet even on a four-route stack. No floating bracket under a single-route sign.
  for (const h of [y - 0.05, y + 0.21]) {
    b.cylC(0.044, 0.044, 0.026, 8, SHELTER_TRIM, { y: h });
    b.box(0.09, 0.032, 0.113, SHELTER_STEEL, { y: h });
    for (const s of [-1, 1]) b.cylC(0.0045, 0.0045, 0.007, 6, STAINLESS,
      { x: 0, y: h, z: s * 0.0685, rx: Math.PI / 2 });
  }
  if (standalonePole) b.cyl(0.036, 0.041, SHELTER_SIGN.top - 0.15, 12, SHELTER_STEEL, { y: 0.15 });
  const g = b.build(), mat = g.getAttribute('aMat');
  for (let i = 0; i < mat.count; i++) mat.setZ(i, mat.getZ(i) > 0.5 ? 6 : -10);
  return g;
}

// ART_DIRECTION §7 Citi enamel; dielectric paint, not exposed blue metal.
const CITI_BLUE = { color: 0x1f3f77, rough: 0.23, metal: 0.03, grimeBand: [0.12, 0.65, 0.10] } satisfies PartStyle;

/** Citi-only map selectors: solids bypass the shared grime/atlas; bike markings use their own small skin. */
function finishCiti(b: MeshBuilder, bikeMarks = false): THREE.BufferGeometry {
  const g = b.build(), mat = g.getAttribute('aMat'), pos = g.getAttribute('position'), color = g.getAttribute('color');
  for (let i = 0; i < mat.count; i++) {
    // Only this asset's enamel signature, before the map selector is rewritten. Broad local
    // finish variation changes the real lit highlight, without baked light stripes or flake noise.
    if (bikeMarks && mat.getZ(i) < 0.5 && Math.abs(mat.getX(i) - CITI_BLUE.rough) < 1e-6 && Math.abs(mat.getY(i) - CITI_BLUE.metal) < 1e-6) {
      const py = pos.getY(i), pz = pos.getZ(i);
      const finish = 0.5 + 0.5 * Math.sin(pz * 5.3 + py * 3.1) * Math.sin(py * 4.7 - pz * 2.2);
      const lowWear = 1 - THREE.MathUtils.smoothstep(py, 0.24, 0.62);
      mat.setX(i, 0.20 + 0.055 * finish + 0.05 * lowWear);
      const tint = 0.978 + 0.035 * finish;
      color.setXYZ(i, color.getX(i) * tint, color.getY(i) * tint, color.getZ(i) * tint);
    }
    if (mat.getZ(i) < 0.5) mat.setZ(i, -4);
    else if (bikeMarks) mat.setZ(i, -5);
  }
  // Physics ground is zero here; the visible sidewalk is +0.15 m. Keep the feet exposed.
  g.translate(0, 0.15, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Citi Bike dock: unchanged instance origin, z wheel stations and longitudinal +z rear direction.
 * Reference: refs/_general/citibike-1.jpg — slim upright grey docks, low blue frame, open front carrier.
 * Small key/lock details are authored functional cues, not legible measurements from the photo.
 */
export function buildCitiDock(withBike: boolean): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const dock: PartStyle = { color: 0x999c98, rough: 0.68, metal: 0.24, grimeBand: [0.02, 0.32, 0.12] };
  const dark = { color: 0x303638, rough: 0.69, metal: 0.22 };
  const alloy = { color: 0xb7bab7, rough: 0.36, metal: 0.8 };
  const blue = CITI_BLUE;
  // The fixed view is from +x/-z. Keep the casting upright and narrow so it does not hide the
  // bicycle; retain its x centre, 0.75 m instance spacing and both wheel stations.
  // A 0.74 m shoe leaves a gap between adjacent docks, with its bottom on the visible paving.
  const postX = 0.424, postZ = -0.46;
  b.box(0.74, 0.035, 0.72, { color: 0x5b5d59, rough: 0.79, metal: 0.32 }, { x: 0.096, y: 0.0175, z: -0.40 });
  const shell = new THREE.Shape();
  shell.moveTo(-0.19, 0.045); shell.lineTo(0.145, 0.045);
  shell.lineTo(0.145, 0.954); shell.lineTo(0.105, 0.985);
  shell.lineTo(-0.16, 1.00); shell.lineTo(-0.19, 0.973); shell.closePath();
  const post = new THREE.ExtrudeGeometry(shell, { depth: 0.22, steps: 1, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.012, bevelThickness: 0.012 });
  // Shape x is longitudinal z; extrusion becomes transverse x. The bike stays at x=0.
  post.rotateY(-Math.PI / 2);
  // Metric shell UVs retain height on the bevels/cap. The Citi-only material mask adds grey wear,
  // not the shared metal texture; the rest of the bicycle and all other props keep their own finish.
  const postPos = post.getAttribute('position'), postUv = post.getAttribute('uv');
  for (let i = 0; i < postPos.count; i++) postUv.setXY(i, postPos.getZ(i) + postPos.getX(i) * 0.73, postPos.getY(i));
  b.add(post, { ...dock, textured: true, keepUv: true }, { x: postX, z: postZ });
  b.box(0.238, 0.014, 0.275, { ...alloy, rough: 0.46 }, { x: postX - 0.11, y: 1.002, z: postZ - 0.0275, rx: 0.057 });
  // Paired rubber-lined capture cheeks remain visible in empty docks and straddle, not fill, the tyre.
  b.box(0.23, 0.038, 0.12, dock, { x: -0.03, y: 0.07, z: -0.265 });
  for (const s of [-1, 1]) b.box(0.022, 0.22, 0.10, dark, { x: s * 0.062, y: 0.15, z: -0.255, rx: 0.34 });
  // Conservative key slot/status cues on the exposed flank, lock throat on the wheel-facing flank.
  b.box(0.016, 0.10, 0.09, dark, { x: postX + 0.015, y: 0.84, z: postZ - 0.095 });
  b.box(0.021, 0.009, 0.040, { color: 0x111718, rough: 0.8, metal: 0.1 }, { x: postX + 0.022, y: 0.863, z: postZ - 0.095 });
  b.box(0.035, 0.088, 0.12, dark, { x: 0.179, y: 0.69, z: -0.425 });
  b.box(0.038, 0.033, 0.074, { color: 0x101517, rough: 0.78, metal: 0.1 }, { x: 0.162, y: 0.694, z: -0.425 });
  for (const [z, color] of [[-0.119, 0x69976a], [-0.071, 0x9f4d42]]) {
    b.cylC(0.006, 0.006, 0.004, 6, { color, rough: 0.38, metal: 0 }, { x: postX + 0.025, y: 0.815, z: postZ + z, rz: Math.PI / 2 });
  }
  for (const z of [-0.68, -0.12]) b.cylC(0.012, 0.012, 0.006, 6, alloy, { x: 0.42, y: 0.038, z });
  // White/red vertical print with a cut-out background, 3 mm clear of the bevelled face.
  // The shell's grey finish and grime remain visible between letters; no rectangular badge.
  slotQuad(b, 0.10, 0.44, { ...ATLAS_WHITE, rough: 0.68, metal: 0.05 }, { x: postX + 0.015, y: 0.52, z: postZ - 0.015, ry: Math.PI / 2 }, [0.01, 0.51, 0.98, 0.48]);
  if (withBike) {
    const black = { color: 0x202326, rough: 0.88, metal: 0.02 };
    const tube = (points: [number, number, number][], radius: number, segments: number, sides: number, style: PartStyle) => {
      const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
      b.add(new THREE.TubeGeometry(curve, segments, radius, sides, false), style);
    };
    const rw = 0.327, wy = 0.351, zf = -0.55, zr = 0.55;
    const wheel = (z: number) => {
      // TorusGeometry is XY by default. Rotate BOTH tyre and rim into the frame's YZ plane.
      // Same 0.351 m outer radius. Spend segments on the silhouette, not hidden spoke end caps.
      b.add(new THREE.TorusGeometry(rw, 0.024, 6, 48), black, { y: wy, z, ry: Math.PI / 2 });
      const wheelMetal = { color: 0xb4bab9, rough: 0.32, metal: 0.86 };
      b.add(new THREE.TorusGeometry(rw - 0.025, 0.0024, 4, 40), wheelMetal, { y: wy, z, ry: Math.PI / 2 });
      b.cylC(0.026, 0.026, 0.094, 8, alloy, { y: wy, z, rz: Math.PI / 2 });
      // Six diametral spokes, slightly dished, give twelve visible spokes without a filled wheel disc.
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 6 + 0.08, dy = Math.sin(a) * 0.301, dz = Math.cos(a) * 0.301;
        const spoke = new THREE.CylinderGeometry(0.001, 0.001, Math.hypot(0.02, dy * 2, dz * 2), 3, 1, true);
        spoke.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.02, dy * 2, dz * 2).normalize()));
        b.add(spoke, wheelMetal, { y: wy, z });
      }
    };
    wheel(zf); wheel(zr);
    // Deep step-through curve and a lighter second rail; open space remains above the low crank.
    tube([[0, 0.89, -0.39], [0, 0.62, -0.24], [0, 0.36, 0.03], [0, 0.31, 0.15]], 0.057, 8, 8, blue);
    tube([[0, 0.72, -0.42], [0, 0.47, -0.28], [0, 0.29, -0.04], [0, 0.30, 0.15]], 0.037, 7, 8, blue);
    b.tube([0, 0.31, 0.15], [0, 0.85, 0.27], 0.040, 7, blue);
    b.tube([0, 0.67, -0.45], [0, 0.94, -0.385], 0.043, 7, blue);
    b.tube([0, 0.694, -0.425], [0.155, 0.694, -0.425], 0.016, 5, alloy); // short transverse tongue into the lock
    for (const s of [-1, 1]) {
      tube([[s * 0.045, wy, zf], [s * 0.054, 0.50, -0.54], [s * 0.042, 0.70, -0.445]], 0.021, 4, 5, blue);
      b.tube([s * 0.05, 0.31, 0.15], [s * 0.046, wy, zr], 0.016, 5, blue);
      b.tube([s * 0.036, 0.82, 0.265], [s * 0.046, wy, zr], 0.015, 5, blue);
    }
    // Thin mudguards, not oversized discs. Smooth arch ribbons follow the round tyre silhouette.
    for (const [z, front] of [[zf, true], [zr, false]] as const) {
      const fender = new THREE.CylinderGeometry(0.367, 0.367, 0.066, 24, 1, true, -Math.PI * 0.10, Math.PI * 1.20);
      fender.rotateZ(Math.PI / 2);
      b.add(fender, front ? { color: 0x88918f, rough: 0.52, metal: 0.65 } : blue, { y: wy, z });
    }
    // Rear blue skirt/advert panels sit beside the upper wheel only, preserving the spokes below.
    const skirt = new THREE.Shape();
    skirt.moveTo(0.30, 0.49); skirt.lineTo(0.31, 0.68); skirt.quadraticCurveTo(0.60, 0.82, 0.82, 0.63);
    skirt.lineTo(0.80, 0.49); skirt.closePath();
    for (const s of [-1, 1]) {
      const g = new THREE.ExtrudeGeometry(skirt, { depth: 0.004, steps: 1, curveSegments: 4, bevelEnabled: false });
      g.rotateY(-Math.PI / 2);
      b.add(g, blue, { x: s * 0.055 });
      slotQuad(b, 0.27, 0.084, ATLAS_WHITE, { x: s * 0.061, y: 0.617, z: 0.56, ry: s * Math.PI / 2 }, [0.01, 0.01, 0.98, 0.48]);
    }
    // Seatpost, tapered saddle, swept handlebar and rubber grips.
    b.tube([0, 0.82, 0.265], [0, 0.995, 0.303], 0.014, 6, alloy);
    b.prism([[-0.095, 0.37], [0.095, 0.37], [0.10, 0.28], [0.035, 0.13], [-0.035, 0.13], [-0.10, 0.28]], 0.049, black, { y: 0.98 });
    b.tube([0, 0.93, -0.386], [0, 1.09, -0.35], 0.017, 6, alloy);
    tube([[-0.29, 1.08, -0.25], [-0.20, 1.11, -0.33], [0, 1.10, -0.40], [0.20, 1.11, -0.33], [0.29, 1.08, -0.25]], 0.013, 8, 5, alloy);
    for (const s of [-1, 1]) {
      b.tube([s * 0.21, 1.105, -0.32], [s * 0.30, 1.077, -0.24], 0.021, 6, black);
      b.tube([s * 0.20, 1.07, -0.37], [s * 0.27, 1.042, -0.31], 0.006, 4, dark);
    }
    // Near-square blue face nested inside an open black carrier, not a broad, shallow signboard.
    b.box(0.30, 0.018, 0.27, dark, { y: 0.854, z: -0.56 });
    b.box(0.265, 0.25, 0.023, blue, { y: 0.982, z: -0.704 });
    slotQuad(b, 0.205, 0.064, ATLAS_WHITE, { y: 1.015, z: -0.717 }, [0.01, 0.01, 0.98, 0.48]);
    for (const s of [-1, 1]) {
      b.tube([s * 0.145, 0.86, -0.695], [s * 0.145, 1.11, -0.695], 0.009, 4, dark);
      b.tube([s * 0.145, 1.11, -0.695], [s * 0.14, 1.07, -0.43], 0.011, 5, dark);
      b.tube([s * 0.14, 1.07, -0.43], [s * 0.14, 0.86, -0.43], 0.009, 4, dark);
      b.tube([s * 0.08, 0.85, -0.63], [s * 0.035, 0.73, -0.43], 0.009, 4, alloy);
    }
    b.tube([-0.14, 1.07, -0.43], [0.14, 1.07, -0.43], 0.01, 5, dark);
    // A modest headlamp, chain enclosure, crank arms and opposed pedals.
    b.box(0.066, 0.029, 0.024, dark, { y: 0.837, z: -0.716 });
    b.quad(0.043, 0.017, { color: 0xd8ded5, rough: 0.26, metal: 0.1 }, { y: 0.839, z: -0.73, ry: Math.PI });
    b.cylC(0.112, 0.112, 0.025, 12, blue, { x: 0.067, y: 0.32, z: 0.15, rz: Math.PI / 2 });
    b.box(0.034, 0.10, 0.40, blue, { x: 0.063, y: 0.325, z: 0.34 });
    b.cylC(0.057, 0.057, 0.036, 8, dark, { x: 0.065, y: wy, z: zr, rz: Math.PI / 2 });
    for (const s of [-1, 1]) {
      b.tube([s * 0.093, 0.32, 0.15], [s * 0.093, 0.32 + s * 0.07, 0.15 + s * 0.12], 0.01, 5, alloy);
      b.box(0.095, 0.027, 0.074, black, { x: s * 0.13, y: 0.32 + s * 0.07, z: 0.15 + s * 0.12 });
    }
    // Small flush frame marks follow the inclined tube instead of floating across the step-through gap.
    for (const s of [-1, 1]) {
      const label = new THREE.PlaneGeometry(0.22, 0.045);
      const uv = label.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.01 + uv.getX(i) * 0.98, 0.51 + uv.getY(i) * 0.48);
      label.rotateZ(s * 0.91); label.rotateY(s * Math.PI / 2);
      b.add(label, ATLAS_WHITE, { x: s * 0.058, y: 0.665, z: -0.265 });
    }
  }
  return finishCiti(b, true);
}

/** the Citi Bike station kiosk: 1.9 m tall blue-grey pillar with the pay screen and a solar panel */
export function buildCitiKiosk(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const body: PartStyle = { color: 0x777d7d, rough: 0.57, metal: 0.48, grimeBand: [0, 0.4, 0.18] };
  const trim = { color: 0x363d41, rough: 0.52, metal: 0.45 };
  b.prism([[-0.25, -0.17], [-0.22, -0.20], [0.22, -0.20], [0.25, -0.17], [0.25, 0.17], [0.22, 0.20], [-0.22, 0.20], [-0.25, 0.17]], 1.85, body);
  b.box(0.54, 0.045, 0.44, trim, { y: 0.0225 });
  b.box(0.455, 1.26, 0.023, trim, { y: 1.06, z: -0.202 });
  slotQuad(b, 0.42, 1.2, { color: 0xffffff, rough: 0.51, metal: 0 }, { y: 1.06, z: -0.216 }, [0, 0, 1, 1]);
  // Projecting card reader and receipt slot are hardware; the printed face is not a glowing screen.
  b.box(0.105, 0.12, 0.024, trim, { x: 0.108, y: 1.01, z: -0.235 });
  b.box(0.068, 0.013, 0.007, { color: 0x101719, rough: 0.7, metal: 0 }, { x: 0.108, y: 1.031, z: -0.25 });
  b.box(0.16, 0.027, 0.012, trim, { x: -0.065, y: 0.82, z: -0.229 });
  // Silver perimeter and a restrained cell grid make the tilted solar canopy read as a panel.
  const solar = new MeshBuilder();
  solar.box(0.7, 0.029, 0.5, body);
  solar.box(0.654, 0.007, 0.451, { color: 0x172b3c, rough: 0.22, metal: 0.28 }, { y: 0.018 });
  for (let i = 1; i < 6; i++) solar.box(0.002, 0.002, 0.451, { color: 0x667985, rough: 0.4, metal: 0.4 }, { x: -0.327 + i * 0.109, y: 0.022 });
  for (let i = 1; i < 3; i++) solar.box(0.654, 0.002, 0.003, { color: 0x667985, rough: 0.4, metal: 0.4 }, { y: 0.022, z: -0.2255 + i * 0.1503 });
  b.merge(solar, { y: 2.05, rx: -0.35 });
  for (const x of [-0.16, 0.16]) b.box(0.045, 0.20, 0.045, trim, { x, y: 1.94 });
  // Existing outboard station board: reuse only this asset's lower map artwork, not the pay screen.
  b.box(0.9, 1.1, 0.04, body, { x: 0.7, y: 1.2 });
  for (const s of [-1, 1]) {
    slotQuad(b, 0.80, 0.79, { color: 0xffffff, rough: 0.72, metal: 0 }, { x: 0.7, y: 1.125, z: s * 0.022, ry: s > 0 ? 0 : Math.PI }, [0.04, 0.69, 0.92, 0.29]);
    slotQuad(b, 0.80, 0.14, { color: 0xffffff, rough: 0.55, metal: 0 }, { x: 0.7, y: 1.625, z: s * 0.022, ry: s > 0 ? 0 : Math.PI }, [0.02, 0.01, 0.96, 0.11]);
  }
  b.box(0.055, 1.8, 0.055, body, { x: 1.12, y: 0.9 });
  return finishCiti(b);
}

/** LinkNYC kiosk: 2.9 m tall, 0.29 m wide, 0.93 m deep slab; 55" screens on both long sides (atlas 'linknyc-screen'), tablet in the front */
export function buildLinkNYC(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const grey = { color: 0x3b3e41, rough: 0.4, metal: 0.8, atlas: true, keepUv: true };
  b.box(0.29, 2.9, 0.93, { ...grey, grimeBand: [0, 0.5, 0.25] }, { y: 1.45 });
  b.box(0.33, 0.06, 0.97, { color: 0x3a3d40, rough: 0.5, metal: 0.8, atlas: true, keepUv: true }, { y: 0.03 });
  // screens: 1.22 x 0.69 m portrait on each side (tall slot), in a black glass bezel
  b.box(0.30, 1.32, 0.79, { color: 0x0b0c0d, rough: 0.2, metal: 0.3, atlas: true, keepUv: true }, { y: 1.9 });
  slotQuad(b, 0.69, 1.22, { color: 0xffffff, rough: 0.2, metal: 0, emit: EMIT.mapGlow, emitStrength: 1.1 }, { x: 0.152, y: 1.9, ry: Math.PI / 2 }, [0, 0, 1, 1]);
  slotQuad(b, 0.69, 1.22, { color: 0xffffff, rough: 0.2, metal: 0, emit: EMIT.mapGlow, emitStrength: 1.1 }, { x: -0.152, y: 1.9, ry: -Math.PI / 2 }, [0, 0, 1, 1]);
  // tablet + speaker + the 'Link' logo strip near the top
  b.box(0.02, 0.28, 0.2, { color: 0x101214, rough: 0.3, metal: 0.4, emit: EMIT.alwaysGlow, emitStrength: 0.4, atlas: true, keepUv: true }, { y: 1.3, z: -0.475 });
  b.box(0.29, 0.06, 0.93, { color: 0x1e6fd6, rough: 0.4, metal: 0.2, emit: EMIT.alwaysGlow, emitStrength: 0.6, atlas: true, keepUv: true }, { y: 2.75 });
  return b.build();
}

/**
 * Green steel newsstand, including awning: 3.7 x 1.8 x 2.8 m. Street/front is -z.
 * Display density: refs/_general/newsstand-1.jpg (also the _general-1 art-direction sheet).
 * The cropped reference does not establish the enclosure: retain the required kiosk/open shutter.
 */
export function buildNewsstand(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const L = 3.7, D = 1.8, H = 2.8;
  const green = { color: 0x294d39, rough: 0.63, metal: 0.08, grimeBand: [0.15, 0.55, 0.25] as [number, number, number] };
  const inset = { color: 0x234232, rough: 0.71, metal: 0.06 };
  const trim = { color: 0xa1aaa7, rough: 0.46, metal: 0.72 };
  const shelf = { color: 0xc3c7c5, rough: 0.38, metal: 0.82 };
  const dark = { color: 0x202c28, rough: 0.86, metal: 0 };
  const paper = { color: 0xc9c6b8, rough: 0.87, metal: 0 };
  const print = { color: 0xffffff, rough: 0.64, metal: 0 };
  // Ground may resolve to 0 before the sidewalk collider (top 0.15). Keep a substantial
  // plinth, with all display shelves above 0.32; no delicate feet hidden below the paving.
  b.box(L - 0.08, 0.30, 1.44, inset, { y: 0.15, z: 0.18 });
  b.box(3.46, 0.90, 1.39, green, { y: 0.75, z: 0.175 });
  b.box(3.48, 2.42, 0.065, inset, { y: 1.49, z: 0.86 });
  b.box(0.065, 2.42, 1.40, green, { x: -1.79, y: 1.49, z: 0.17 });
  for (const x of [-1.79, 1.79]) for (const z of [-0.52, 0.84]) {
    b.box(0.12, 2.66, 0.12, green, { x, y: 1.33, z });
  }
  // Recessed side panels, not a solid cube across the service opening on +x.
  b.box(0.055, 0.79, 1.24, inset, { x: 1.758, y: 0.74, z: 0.17 });
  b.box(0.07, 0.34, 1.36, green, { x: 1.79, y: 2.43, z: 0.17 });
  b.box(0.39, 0.055, 1.25, trim, { x: 1.655, y: 1.22, z: 0.14 });
  for (const z of [-0.36, 0.22, 0.69]) b.box(0.012, 0.67, 0.018, green, { x: 1.792, y: 0.75, z });
  // A real shadowed interior behind the front and side serving openings.
  b.box(3.38, 1.08, 0.06, dark, { y: 1.77, z: 0.61 });
  // Stop the interior divider behind the stock shelves, not through the right-hand cartons.
  b.box(0.055, 1.08, 0.86, dark, { x: 1.04, y: 1.77, z: 0.235 });
  b.box(L, 0.08, D, green, { y: H - 0.04 });
  b.box(3.54, 0.09, 1.48, inset, { y: 2.675, z: 0.14 });
  // Rolled shutter in its head box; the short hanging ribbed curtain leaves the front open.
  b.box(3.48, 0.22, 0.23, green, { y: 2.51, z: -0.49 });
  b.cylC(0.095, 0.095, 3.30, 10, trim, { y: 2.415, z: -0.52, rz: Math.PI / 2 });
  for (let i = 0; i < 3; i++) b.box(3.30, 0.025, 0.026, trim, { y: 2.295 + i * 0.031, z: -0.577 });
  for (const x of [-1.69, 1.69]) b.box(0.035, 1.16, 0.05, trim, { x, y: 1.745, z: -0.58 });
  // Sloping green fabric awning and a readable valance, wholly inside the 1.8 m depth.
  const canvas = { color: 0x365d42, rough: 0.96, metal: 0 };
  b.box(3.56, 0.026, 0.41, canvas, { y: 2.50, z: -0.685, rx: -0.37 });
  b.box(3.56, 0.17, 0.025, canvas, { y: 2.343, z: -0.88 });
  slotQuad(b, 2.96, 0.13, print, { y: 2.345, z: -0.894 }, newsstandUv('awning'));
  for (const x of [-1.62, 1.62]) b.tube([x, 2.29, -0.56], [x, 2.42, -0.85], 0.013, 4, trim);
  b.box(2.88, 0.025, 0.055, { color: 0xe4e2cf, rough: 0.6, metal: 0, emit: EMIT.nightGlow, emitStrength: 1.2 }, { y: 2.39, z: -0.68 });

  // One prominent 3.24 x 0.24 m rack: ten oversized 32–33 x 43–47 cm issues.
  // The page blocks, varying lean and individual cover artwork are real separate volumes.
  const rackBase = 0.665, rackFront = -0.846;
  b.box(3.24, 0.043, 0.24, shelf, { y: rackBase, z: -0.735 });
  b.box(3.20, 0.46, 0.027, dark, { y: 0.91, z: -0.603 });
  const coverOrder = [0, 6, 1, 10, 4, 13, 15, 3, 11, 8];
  for (let col = 0; col < 10; col++) {
    const x = -1.4265 + col * 0.317;
    const w = 0.316 + (col % 3) * 0.007, h = 0.426 + (col % 4) * 0.015;
    const d = 0.013 + (col % 3) * 0.003, tilt = 0.10 + (col % 3) * 0.025;
    // Small overlaps at the edges, with staggered depths rather than coplanar sheets.
    const y = rackBase + 0.028 + h / 2, z = -0.754 - (col % 3) * 0.021;
    b.box(w, h, d, paper, { x, y, z, rx: tilt });
    slotQuad(b, w - 0.003, h - 0.004, print,
      { x, y: y + Math.sin(tilt) * (d / 2 + 0.001), z: z - Math.cos(tilt) * (d / 2 + 0.001), rx: tilt },
      newsstandUv('cover', coverOrder[col]));
  }
  b.box(3.24, 0.066, 0.028, shelf, { y: rackBase + 0.045, z: rackFront });
  b.box(3.22, 0.010, 0.014, trim, { y: rackBase + 0.154, z: rackFront - 0.004 });
  for (const x of [-1.62, 0, 1.62]) b.box(0.013, 0.20, 0.018, trim, { x, y: rackBase + 0.105, z: rackFront });
  // Folded newspapers replace the bottom magazine row. The shelf starts at 0.33 m,
  // safely above the 0.15 m paving even when the prop ground is initially zero.
  b.box(3.24, 0.046, 0.40, shelf, { y: 0.367, z: -0.66 });
  b.box(3.24, 0.075, 0.032, shelf, { y: 0.367, z: -0.855 });
  for (const x of [-1.62, 1.62]) b.box(0.028, 0.26, 0.38, trim, { x, y: 0.518, z: -0.66 });
  const piles = [
    { x: -1.272, w: 0.590, d: 0.320, h: 0.212, layers: 4, angle: -0.027 },
    { x: -0.625, w: 0.620, d: 0.328, h: 0.245, layers: 5, angle: 0.026 },
    { x: -0.021, w: 0.550, d: 0.326, h: 0.191, layers: 4, angle: -0.018 },
    { x: 0.584, w: 0.650, d: 0.332, h: 0.230, layers: 5, angle: 0.020 },
    { x: 1.230, w: 0.590, d: 0.322, h: 0.207, layers: 4, angle: -0.024 },
  ];
  for (const [i, pile] of piles.entries()) {
    const { layers, angle } = pile;
    const weights = Array.from({ length: layers }, (_, n) => 0.8 + ((i * 2 + n * 3) % 5) * 0.1);
    const weightSum = weights.reduce((sum, n) => sum + n, 0);
    let bottom = 0.391;
    for (let layer = 0; layer < layers; layer++) {
      const h = pile.h * weights[layer] / weightSum, w = pile.w - (layer % 3) * 0.008;
      const d = pile.d - (layer % 2) * 0.009, fold = 0.010;
      const x = pile.x + (layer % 3 - 1) * 0.009 + (i % 2 ? 1 : -1) * layer * 0.002;
      const z = -0.711 + (layer % 4 - 1.5) * 0.005, y = bottom + h / 2;
      // Six-point section: a convex folded spine, not another rectangular magazine tile.
      // Each 20-triangle section groups several folded copies; ruled edges supply pages.
      const profile = new THREE.Shape([
        new THREE.Vector2(-d / 2, -h / 2), new THREE.Vector2(d / 2 - fold, -h / 2),
        new THREE.Vector2(d / 2, -h * 0.22), new THREE.Vector2(d / 2, h * 0.22),
        new THREE.Vector2(d / 2 - fold, h / 2), new THREE.Vector2(-d / 2, h / 2),
      ]);
      const folded = new THREE.ExtrudeGeometry(profile, { depth: w, bevelEnabled: false, steps: 1, curveSegments: 1 });
      folded.rotateY(Math.PI / 2); folded.translate(-w / 2, 0, 0);
      b.add(folded, { ...paper, color: [0xd5d0c0, 0xc4bfae, 0xe1dccb][(i + layer) % 3] }, { x, y, z, ry: angle });
      // Fine ruled page edges live on the actual folded spines, never across the open bay.
      slotQuad(b, w - 0.003, h * 0.43, { ...print, color: 0xf1eddf },
        { x: x - Math.sin(angle) * (d / 2 + 0.0005), y, z: z - Math.cos(angle) * (d / 2 + 0.0005), ry: Math.PI + angle },
        newsstandUv('paperEdge'));
      bottom += h;
      // Print every exposed signature, including the offsets and broad folded shoulder.
      slotQuad(b, w - 0.004, d - fold - 0.004, print,
        { x: x + Math.sin(angle) * fold / 2, y: bottom + 0.0006, z: z + Math.cos(angle) * fold / 2,
          rx: -Math.PI / 2, ry: 0, rz: angle }, newsstandUv('paper', (i + layer) % 2));
      const shoulder = Math.hypot(fold, h * 0.28), slope = Math.atan2(h * 0.28, fold);
      const foldedPrint = new THREE.PlaneGeometry(w - 0.004, shoulder);
      const faceUv = foldedPrint.getAttribute('uv'), art = newsstandUv('paper', (i + layer) % 2);
      for (let v = 0; v < faceUv.count; v++) faceUv.setXY(v,
        art[0] + faceUv.getX(v) * art[2], 1 - art[1] - art[3] + faceUv.getY(v) * art[3] * 0.15);
      foldedPrint.rotateX(-Math.PI / 2 - slope);
      foldedPrint.translate(0, h * 0.36 + 0.0006, -d / 2 + fold / 2 - 0.0004);
      b.add(foldedPrint, { ...print, atlas: true, keepUv: true }, { x, y, z, ry: angle });
    }
  }
  // A deeper stainless deck supports all four steps; the exposed folded lip stays thin.
  b.box(3.36, 0.055, 0.64, shelf, { y: 1.215, z: -0.56 });
  b.box(3.36, 0.050, 0.018, shelf, { y: 1.210, z: -0.871 });
  // All merchandise stays in the same merged/instanced mesh, with deterministic variation.
  const packet = (x: number, y: number, z: number, w: number, h: number, id: number, depth = 0.085, bar = false, yaw = 0) => {
    const wrapper = { color: [0xa82f24, 0xb99a31, 0x356c83, 0x527843, 0x85567e, 0xc17632, 0x8b352b, 0xb3ad90][id % 8], rough: 0.58, metal: 0.03 };
    b.box(w, h, depth, wrapper, { x, y, z, ry: yaw });
    const art = newsstandUv(bar ? 'bar' : 'snack', id % 8);
    slotQuad(b, w, h, { ...print, rough: 0.40 },
      { x: x - Math.sin(yaw) * (depth / 2 + 0.001), y, z: z - Math.cos(yaw) * (depth / 2 + 0.001), ry: Math.PI + yaw }, art);
    if (bar) slotQuad(b, w, depth, { ...print, rough: 0.40 }, { x, y: y + h / 2 + 0.001, z, rx: -Math.PI / 2, ry: 0, rz: yaw }, art);
  };
  // A pinched foil pouch has three four-corner rings: just 20 triangles including its
  // printed, gently bulging front. No coplanar cover sheet or separate crimp geometry.
  const pouch = (x: number, bottom: number, z: number, w: number, h: number, id: number, depth: number, yaw: number) => {
    const rows = [
      { y: -h / 2, halfW: w * 0.44, halfD: depth * 0.14 },
      { y: -h * 0.06, halfW: w / 2, halfD: depth / 2 },
      { y: h / 2, halfW: w * (0.43 + (id % 3) * 0.02), halfD: depth * 0.10 },
    ];
    const positions: number[] = [], uv: number[] = [], front: number[] = [], back: number[] = [];
    for (const [row, ring] of rows.entries()) {
      for (const [side, sx, sz] of [[0, -1, -1], [1, 1, -1], [2, 1, 1], [3, -1, 1]]) {
        positions.push(sx * ring.halfW, ring.y + (row === 2 ? sx * h * ((id % 3) - 1) * 0.025 : 0), sz * ring.halfD);
        // Local front is -z; +x is artwork-left when seen from the street.
        uv.push(side === 0 || side === 3 ? 1 : 0, row === 0 ? 0 : row === 1 ? 0.44 : 1);
      }
    }
    for (let row = 0; row < 2; row++) for (let side = 0; side < 4; side++) {
      const a = row * 4 + side, c = row * 4 + (side + 1) % 4;
      (side === 0 ? front : back).push(a, a + 4, c, c, a + 4, c + 4);
    }
    back.push(0, 1, 2, 0, 2, 3, 8, 10, 9, 8, 11, 10);
    const skin = (indices: number[], printed: boolean) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(indices);
      // Separate triangle normals retain the foil shoulder without rounding the crimp.
      const flat = g.toNonIndexed(); g.dispose(); flat.computeVertexNormals();
      if (printed) {
        const tex = flat.getAttribute('uv'), art = newsstandUv('snack', id % 8);
        for (let i = 0; i < tex.count; i++) tex.setXY(i, art[0] + tex.getX(i) * art[2], 1 - art[1] - art[3] + tex.getY(i) * art[3]);
      }
      b.add(flat, printed ? { ...print, rough: 0.43, atlas: true, keepUv: true }
        : { color: [0xa82f24, 0xb99a31, 0x356c83, 0x527843, 0x85567e, 0xc17632, 0x8b352b, 0xb3ad90][id % 8], rough: 0.48, metal: 0.03 },
      { x, y: bottom + h / 2, z, ry: yaw });
    };
    skin(back, false); skin(front, true);
  };
  // Low gum/bar piles lead into overlapping upright candy packets, then taller bags.
  // The tall third row stays in front of the stock shelves; their rear corners stay low.
  for (let tier = 0; tier < 4; tier++) {
    const trayTop = [1.269, 1.340, 1.414, 1.485][tier], z = [-0.796, -0.665, -0.550, -0.379][tier];
    const trayDepth = [0.15, 0.13, 0.10, 0.19][tier];
    const deckTop = 1.2425;
    b.box(3.22, trayTop - deckTop, trayDepth, shelf, { y: (trayTop + deckTop) / 2, z });
    const count = tier === 0 ? 13 : tier === 1 ? 16 : 15, pitch = 3.12 / count;
    for (let i = 0; i < count; i++) {
      const x = -1.56 + (i + 0.5) * pitch;
      const behindShelf = tier === 3 && (x < -0.56 || x > 0.82);
      const bag = tier > 0 && !behindShelf && (tier > 1 || i % 3 !== 0);
      const h = bag ? [0, 0.125, 0.194, 0.229][tier] + ((i * 5 + tier) % 4) * 0.017
        : (behindShelf ? 0.061 : 0.050 + tier * 0.015) + (i % 3) * 0.008;
      const w = pitch * (bag ? 1.035 : 0.94) + ((i * 3 + tier) % 3) * 0.004;
      const yaw = (((i * 5 + tier * 3) % 7) - 3) * 0.028;
      const pz = z + (i % 2 ? 0.010 : -0.010), id = (i * 3 + tier * 2) % 8;
      if (bag) pouch(x, trayTop, pz, w, h, id, tier === 2 ? 0.045 : 0.065, yaw);
      else packet(x, trayTop + h / 2, pz, w, h, id, tier === 0 ? 0.112 : 0.079, true, yaw);
      if (tier === 0 && i % 3 === 1) {
        const upperH = 0.029 + (i % 2) * 0.005;
        packet(x + (i % 2 ? 0.013 : -0.013), trayTop + h + upperH / 2, pz + 0.011,
          w * 0.90, upperH, (id + 1) % 8, 0.073, true, -yaw * 0.8);
      }
    }
    b.box(3.22, 0.016, 0.012, trim, { y: trayTop + 0.004, z: z - trayDepth / 2 + 0.006 });
  }
  // Stocked edges retain a usable central service opening. Broad shelf returns give
  // bottles, snack tubes and cartons depth/silhouettes instead of an empty black box.
  for (const bay of [{ x: -1.17, w: 0.99, n: 6 }, { x: 1.29, w: 0.66, n: 4 }]) {
    for (const y of [1.612, 1.988]) {
      b.box(bay.w + 0.04, 0.03, 0.27, shelf, { x: bay.x, y, z: -0.359 });
      b.box(bay.w + 0.04, 0.045, 0.024, shelf, { x: bay.x, y: y + 0.010, z: -0.488 });
      if (y > 1.9) for (let i = 0; i < bay.n; i++) {
        const h = 0.215 + (i % 3) * 0.014;
        packet(bay.x - bay.w / 2 + (i + 0.5) * bay.w / bay.n, y + 0.015 + h / 2,
          -0.382 + (i % 2) * 0.012, bay.w / bay.n - 0.012, h, i + (bay.x > 0 ? 3 : 0), 0.16);
      }
    }
  }
  const curvedLabel = (x: number, y: number, z: number, radius: number, h: number, art: [number, number, number, number]) => {
    // Two 60-degree faces line up exactly with the six-sided bodies, avoiding floating skins.
    const g = new THREE.CylinderGeometry(radius, radius, h, 2, 1, true, Math.PI * 2 / 3, Math.PI * 2 / 3);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, art[0] + uv.getX(i) * art[2], 1 - art[1] - art[3] + uv.getY(i) * art[3]);
    b.add(g, { ...print, rough: 0.38, atlas: true, keepUv: true }, { x, y, z });
  };
  for (let i = 0; i < 4; i++) {
    const x = -1.52 + i * 0.158, y = 1.628, z = -0.391 + (i % 2) * 0.012;
    // Six-sided bottles: foot, tapered body, shoulder, neck and a separate cap.
    b.lathe([[0, 0], [0.050, 0], [0.055, 0.025], [0.050, 0.233], [0.021, 0.270], [0.021, 0.299], [0, 0.299]],
      6, { color: i % 3 === 0 ? 0x779493 : 0xb1c5bd, rough: 0.26, metal: 0.03 }, { x, y, z });
    b.cylC(0.023, 0.023, 0.024, 6, { color: i % 3 === 0 ? 0x36603b : 0xe0dfd2, rough: 0.5, metal: 0 }, { x, y: y + 0.299, z });
    curvedLabel(x, y + 0.139, z, 0.0535, 0.098, newsstandUv('drink', i % 2));
  }
  packet(-0.783, 1.771, -0.385, 0.17, 0.286, 5, 0.16);
  for (let i = 0; i < 3; i++) {
    const x = 1.087 + i * 0.198, h = 0.307 + (i % 2) * 0.020, y = 1.628 + h / 2;
    b.cylC(0.075, 0.075, h, 6, { color: [0xac3729, 0xd4a644, 0x538142][i], rough: 0.46, metal: 0.04 }, { x, y, z: -0.368 });
    b.cylC(0.077, 0.077, 0.014, 6, shelf, { x, y: y + h / 2, z: -0.368 });
    curvedLabel(x, y, -0.368, 0.076, h - 0.033, newsstandUv('snack', i));
  }
  // Requirement-led lottery sign; generic artwork, no real lottery or magazine branding.
  b.box(0.80, 0.30, 0.035, inset, { x: 0.27, y: 2.095, z: -0.515 });
  slotQuad(b, 0.755, 0.267, print, { x: 0.27, y: 2.095, z: -0.534 }, newsstandUv('lottery'));
  // Unprinted surfaces opt out of the shared atlas only on this asset. -7 is newsstand-only;
  // bench (-1), hydrant (-2/-3), subway and all existing atlas users retain their paths.
  const geometry = b.build(), mat = geometry.getAttribute('aMat');
  for (let i = 0; i < mat.count; i++) if (mat.getZ(i) === 0) mat.setZ(i, -7);
  return geometry;
}

/**
 * Halal cart: 2.6 x 1.5 m cabinet footprint; service faces -z. Reference:
 * refs/_general/halal-cart-1.jpg (counter, folded stainless rails, food panels).
 * The umbrella / rear gas bottle are requirement-led: those details are hidden in the photo.
 * 1,968 triangles, one merged instanced geometry; existing 200 m range / no extra LOD.
 */
export function buildFoodCart(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const L = 2.6, D = 1.5;
  const ss = { color: 0xa8b0ad, rough: 0.38, metal: 0.94 };
  const trim = { color: 0xc8cfca, rough: 0.26, metal: 0.96 };
  const dark = { color: 0x353a3b, rough: 0.58, metal: 0.72 };
  const rubber = { color: 0x202120, rough: 0.91, metal: 0 };
  const print = { color: 0xffffff, rough: 0.67, metal: 0 };
  // Narrow connected braces/ribs need no buried end discs. Reuse their original
  // dimensions and segment counts, freeing triangles for the hood and door layers.
  const openTube = (a: [number, number, number], c: [number, number, number], r: number, segments: number, style: typeof ss) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...c);
    const direction = to.clone().sub(from);
    const tube = new THREE.CylinderGeometry(r, r, direction.length(), segments, 1, true);
    tube.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    const midpoint = from.add(to).multiplyScalar(0.5);
    b.add(tube, style, { x: midpoint.x, y: midpoint.y, z: midpoint.z });
  };

  // Lower cabinet only: no opaque box or black quad across the serving aperture.
  // The skirt ends at 0.24 m: still 9 cm above the known 0.15 m sidewalk.
  // A notched underside leaves the wheel faces exposed rather than hiding them in the skirt.
  const cabinetProfile = new THREE.Shape();
  const skirt: [number, number][] = [[-0.75, 0.24], [-0.13, 0.24], [-0.13, 0.60],
    [0.49, 0.60], [0.49, 0.24], [0.75, 0.24], [0.75, 1.10], [-0.75, 1.10]];
  skirt.forEach(([z, y], i) => i ? cabinetProfile.lineTo(-z, y) : cabinetProfile.moveTo(-z, y));
  cabinetProfile.closePath();
  b.add(new THREE.ExtrudeGeometry(cabinetProfile, { depth: L, bevelEnabled: false, steps: 1 }), ss,
    { x: -L / 2, ry: Math.PI / 2 });
  b.box(L - 0.08, 0.065, D - 0.08, dark, { y: 0.5 });
  b.box(L - 0.1, 0.035, D - 0.03, trim, { y: 1.1175 });
  // Wheels remain readable above the 0.15 m paving even if placement groundHeight is zero.
  for (const x of [-1.24, 1.24]) {
    b.cylC(0.28, 0.28, 0.12, 12, rubber, { x, y: 0.3, z: 0.18, rz: Math.PI / 2 });
    b.cylC(0.12, 0.12, 0.126, 10, ss, { x, y: 0.3, z: 0.18, rz: Math.PI / 2 });
  }
  // Short A-frame drawbar, 0.62 m projection, with a real socket-sized coupler.
  for (const z of [-0.31, 0.31]) b.tube([1.22, 0.45, z], [1.81, 0.41, 0], 0.027, 5, dark);
  b.box(0.22, 0.075, 0.09, ss, { x: 1.81, y: 0.42 });
  b.box(0.095, 0.025, 0.045, dark, { x: 1.82, y: 0.482, rz: -0.18 });

  // Thin end returns, rear wall and roof enclose 1.45 m of actual interior depth.
  for (const x of [-1.245, 1.245]) {
    b.box(0.11, 1.10, D, ss, { x, y: 1.65 });
    b.box(0.045, 1.09, 0.045, trim, { x: Math.sign(x) * 1.19, y: 1.65, z: -0.748 });
  }
  b.box(L - 0.14, 1.08, 0.045, { ...ss, color: 0x626e6b, rough: 0.48 }, { y: 1.66, z: 0.7275 });
  b.box(L, 0.045, D, ss, { y: 2.2225 });
  b.box(L, 0.34, 0.07, ss, { y: 2.02, z: -0.715 });
  // Metal backing front = -0.75; artwork = -0.761, never buried behind the fascia.
  const foodRegion: [number, number, number, number] = [0, 20 / 64, 1, 30 / 64];
  // The wide overhead panel crops the middle of the three taller cabinet prints.
  slotQuad(b, 2.43, 0.232, print, { y: 2.05, z: -0.761 }, [0, 25 / 64, 1, 20 / 64]);
  slotQuad(b, 2.43, 0.052, print, { y: 1.905, z: -0.761 }, [0, 46 / 64, 1, 4 / 64]);
  for (const y of [1.847, 2.193]) b.box(L, 0.025, 0.035, trim, { y, z: -0.761 });
  // Continuous under-fascia fixture: the opal lens projects out of its housing,
  // below the menu's lower fold. Real front/underside depth, not a buried bright line.
  b.box(2.28, 0.06, 0.114, dark, { y: 1.803, z: -0.704 });
  b.box(2.20, 0.032, 0.048,
    { color: 0xf2ead8, rough: 0.38, metal: 0, emit: EMIT.alwaysGlow, emitStrength: 0.8 },
    { y: 1.785, z: -0.759 });
  // A rigid 23 cm-deep roof-mounted LED box, independent of the required umbrella.
  // Real black bezel / folded perimeter; only the inset diode face emits light.
  for (const x of [-1.08, 1.08]) b.box(0.075, 0.09, 0.18, ss, { x, y: 2.27, z: -0.65 });
  b.box(L, 0.405, 0.23, { color: 0x101614, rough: 0.42, metal: 0.35 }, { y: 2.495, z: -0.69 });
  slotQuad(b, 2.44, 0.335, { ...print, rough: 0.4, emit: EMIT.mapGlow, emitStrength: 0.9 },
    { y: 2.495, z: -0.816 }, [0, 0, 1, 19 / 64]);
  for (const y of [2.297, 2.693]) b.box(L, 0.014, 0.032, trim, { y, z: -0.814 });
  for (const x of [-1.29, 1.29]) b.box(0.018, 0.39, 0.032, ss, { x, y: 2.495, z: -0.814 });

  // Fold-out service counter, rolled edge and two small diagonal shelf brackets.
  b.box(2.4, 0.032, 0.34, trim, { y: 1.119, z: -0.88 });
  b.box(2.42, 0.037, 0.025, ss, { y: 1.12, z: -1.04 });
  for (const x of [-0.94, 0.94]) openTube([x, 0.92, -0.752], [x, 1.098, -0.995], 0.011, 4, dark);
  // The reference's large HALAL FOOD counter fascia, with a metal downstand behind it.
  b.box(2.43, 0.185, 0.025, ss, { y: 1.008, z: -1.0485 });
  slotQuad(b, 2.36, 0.152, print, { y: 1.008, z: -1.073 }, [0, 51 / 64, 1, 13 / 64]);
  // Three separate shallow doors below the stock shelf. Exposed folded-metal
  // borders sit forward of dark gasket reveals; each keeps a complete food print.
  // Exact door proportions are authored: the reference's lower body is cropped.
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * (2.44 / 3);
    b.box(0.812, 0.575, 0.026, dark, { x, y: 0.5475, z: -0.764 });
    b.box(0.786, 0.55, 0.030, { ...ss, rough: 0.40 + i * 0.025 }, { x, y: 0.5475, z: -0.788 });
    // Metal front = -0.803; ink = -0.814 (11 mm clearance, never behind the backing).
    slotQuad(b, 0.750, 0.508, print, { x, y: 0.5475, z: -0.814 },
      [i / 3, foodRegion[1], 1 / 3, foodRegion[3]]);
    b.box(0.10, 0.012, 0.022, trim, { x: x + 0.20, y: 0.81, z: -0.817 });
  }
  for (const x of [-1.285, 1.285]) b.box(0.028, 0.83, 0.028, trim, { x, y: 0.67, z: -0.76 });
  b.box(2.50, 0.027, 0.028, trim, { y: 0.2535, z: -0.785 });
  // Reference-led projecting stock shelf, entirely above the cabinet prints.
  // It stays inside the existing service-counter projection and keeps cans on its top.
  b.box(2.40, 0.026, 0.282, ss, { y: 0.84, z: -0.91 });
  b.box(2.42, 0.030, 0.025, trim, { y: 0.865, z: -1.050 });
  for (const x of [-1.188, 1.188]) b.box(0.024, 0.042, 0.282, ss, { x, y: 0.867, z: -0.91 });
  for (let i = 0; i < 3; i++) {
    const x = -0.99 + i * 0.115;
    const can = { color: i < 2 ? 0x98281c : 0xa56e20, rough: 0.4, metal: 0.35 };
    b.cyl(0.035, 0.035, 0.135, 6, can, { x, y: 0.853, z: -0.905 });
    b.cyl(0.0356, 0.0356, 0.026, 6, { color: 0xded4b8, rough: 0.5, metal: 0.05 }, { x, y: 0.909, z: -0.905 }, true);
  }
  // Food-print doors on the short ends, framed by exposed stainless folds and pulls.
  for (const x of [-1.302, 1.302]) {
    // The laminate shares the wheel cutout; a rectangular decal would hide the tire again.
    const outline = new THREE.Shape();
    const edge: [number, number][] = [[-0.65, 0.265], [-0.13, 0.265], [-0.13, 0.60],
      [0.49, 0.60], [0.49, 0.265], [0.65, 0.265], [0.65, 1.04], [-0.65, 1.04]];
    edge.forEach(([z, y], i) => i ? outline.lineTo(-Math.sign(x) * z, y) : outline.moveTo(-Math.sign(x) * z, y));
    outline.closePath();
    const panel = new THREE.ShapeGeometry(outline);
    const pos = panel.getAttribute('position'), uv = panel.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i,
      (x < 0 ? 0 : 1 / 3) + (pos.getX(i) + 0.65) / 1.30 * (2 / 3),
      14 / 64 + (pos.getY(i) - 0.265) / 0.775 * (30 / 64));
    b.add(panel, { ...print, atlas: true, keepUv: true }, { x: Math.sign(x) * 1.312, ry: Math.sign(x) * Math.PI / 2 });
    b.box(0.034, 0.425, 0.018, trim, { x, y: 0.8225 });
    b.box(0.012, 0.028, 0.13, dark, { x: Math.sign(x) * 1.324, y: 0.965, z: -0.18 });
    b.box(0.025, 0.014, 0.09, trim, { x: Math.sign(x) * 1.324, y: 0.965, z: -0.18 });
  }

  // A real open service bay: folded reflective backsplash and two recessed pan wells.
  // Slightly angled sheet returns catch the existing environment, not painted highlights.
  b.box(1.26, 0.59, 0.022, { ...ss, color: 0x939e98, rough: 0.36 }, { x: 0.46, y: 1.49, z: 0.676 });
  b.box(0.15, 0.57, 0.018, trim, { x: 1.12, y: 1.48, z: 0.617, ry: -0.52 });
  for (const x of [0.18, 0.65]) {
    const pan = new THREE.PlaneGeometry(0.39, 0.42);
    b.add(pan, { ...ss, color: 0x737970, rough: 0.29 }, { x, y: 1.141, z: -0.41, rx: -Math.PI / 2 });
    for (const dz of [-0.22, 0.22]) b.box(0.42, 0.035, 0.015, trim, { x, y: 1.16, z: -0.41 + dz });
    for (const dx of [-0.2025, 0.2025]) b.box(0.015, 0.035, 0.425, trim, { x: x + dx, y: 1.16, z: -0.41 });
  }
  b.box(0.72, 0.10, 0.48, dark, { x: 0.49, y: 1.185, z: 0.05 });
  b.box(0.76, 0.055, 0.04, ss, { x: 0.49, y: 1.25, z: 0.28 });
  // Sloped extractor above the cooking bay, not a small box hidden by the menu.
  // An open lower mouth, recessed dark filters and folded lip give the hood depth.
  // The lower lip clears the griddle while the rotisserie stays outside its left return.
  const hood = new THREE.BoxGeometry(1.54, 0.53, 0.98);
  const hoodPos = hood.getAttribute('position');
  for (let i = 0; i < hoodPos.count; i++) {
    if (hoodPos.getY(i) > 0 && hoodPos.getZ(i) < 0) hoodPos.setZ(i, 0.02);
  }
  // BoxGeometry's fourth face is -y: remove it to leave a real open underside.
  const hoodIndex = Array.from(hood.index!.array);
  hood.setIndex([...hoodIndex.slice(0, 18), ...hoodIndex.slice(24)]);
  hood.computeVertexNormals();
  b.add(hood, { ...ss, color: 0x8b9690, rough: 0.47 }, { x: 0.30, y: 1.905, z: 0.16 });
  b.quad(1.45, 0.83, dark, { x: 0.30, y: 1.685, z: 0.15, rx: Math.PI / 2 });
  b.box(1.56, 0.043, 0.048, trim, { x: 0.30, y: 1.653, z: -0.327 });
  for (let i = 0; i < 5; i++) {
    b.quad(1.44, 0.027, { ...ss, color: 0x69736c, rough: 0.56 },
      { x: 0.30, y: 1.677, z: -0.18 + i * 0.155, rx: Math.PI / 2 - 0.38 });
  }
  b.box(0.36, 0.39, 0.30, ss, { x: 0.49, y: 2.28, z: 0.31 });
  // Visible vertical rotisserie, as in the reference: browned meat, spit and drip tray.
  // The eight-sided layered profile is intentional, not a stack of separate meat meshes.
  b.box(0.50, 0.57, 0.025, { ...ss, color: 0x71776d, rough: 0.29 }, { x: -0.68, y: 1.49, z: 0.43 });
  b.box(0.10, 0.54, 0.02, trim, { x: -0.94, y: 1.48, z: 0.39, ry: 0.62 });
  b.cyl(0.008, 0.008, 0.65, 5, trim, { x: -0.67, y: 1.165, z: 0.16 });
  b.lathe([[0.07, 0], [0.13, 0.04], [0.151, 0.17], [0.174, 0.37], [0.154, 0.46], [0.05, 0.50]], 8,
    { color: 0x8c562c, rough: 0.76, metal: 0 }, { x: -0.67, y: 1.235, z: 0.16 });
  b.box(0.45, 0.027, 0.40, trim, { x: -0.67, y: 1.162, z: 0.12 });
  // Three 23 cm squeeze bottles sit ON the sill; no menu texture on their plastic.
  for (let i = 0; i < 3; i++) {
    const x = -0.96 + i * 0.145;
    b.cyl(0.032, 0.037, 0.16, 6, { color: [0xa32e1f, 0xe5d6ad, 0xc39527][i], rough: 0.46, metal: 0 }, { x, y: 1.135, z: -0.80 });
    b.cyl(0.007, 0.024, 0.067, 6, { color: i === 1 ? 0xe6dfc9 : 0x752b1d, rough: 0.6, metal: 0 }, { x, y: 1.295, z: -0.80 });
  }

  // A quieter 2.40 m umbrella remains above the rigid sign, on its own pole/ribs.
  // Opposite winding on the same shell keeps the underside visible without extra materials.
  const ux = -0.08, uz = 0.20;
  b.cyl(0.018, 0.022, 2.02, 8, trim, { x: ux, y: 1.1175, z: uz });
  b.cyl(0.038, 0.038, 0.075, 6, dark, { x: ux, y: 2.82, z: uz });
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, c = (i + 1) * Math.PI / 6;
    const point = (r: number, y: number, angle: number) => [ux + Math.cos(angle) * r, y, uz + Math.sin(angle) * r];
    const positions = [
      [ux, 3.15, uz], point(0.70, 3.025, a), point(0.70, 3.025, c),
      point(1.20, 2.83, a), point(1.20, 2.83, c),
      point(1.20, 2.74, a), point(1.20, 2.74, c),
    ].flat();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const faces = [0, 2, 1, 1, 2, 4, 1, 4, 3, 3, 4, 6, 3, 6, 5];
    g.setIndex([...faces, ...faces.slice().reverse()]);
    g.computeVertexNormals();
    // Separate reverse faces so averaging their normals cannot cancel the cloth lighting.
    const cloth = g.toNonIndexed();
    cloth.computeVertexNormals();
    g.dispose();
    b.add(cloth, { color: i % 2 ? 0xbeb39a : 0x813a2b, rough: 0.91, metal: 0 });
    if (i % 2 === 0) {
      const rib: [number, number, number] = [ux + Math.cos(a) * 0.70, 3.01, uz + Math.sin(a) * 0.70];
      openTube([ux, 2.86, uz], rib, 0.007, 4, dark);
      openTube(rib, [ux + Math.cos(a) * 1.18, 2.815, uz + Math.sin(a) * 1.18], 0.007, 4, dark);
    }
  }
  b.cyl(0.023, 0.032, 0.055, 6, dark, { x: ux, y: 3.145, z: uz });

  // Rear 0.32 m diameter propane bottle: rounded shoulder, foot ring, valve cage, strap/hose.
  b.box(0.37, 0.035, 0.37, dark, { x: -0.91, y: 0.525, z: 0.95 });
  const gas = { color: 0xd2cfc1, rough: 0.6, metal: 0.12 };
  b.lathe([[0, 0.02], [0.11, 0.02], [0.16, 0.08], [0.16, 0.37], [0.12, 0.44], [0.045, 0.465]], 10, gas, { x: -0.91, y: 0.535, z: 0.95 });
  b.cyl(0.12, 0.12, 0.035, 10, dark, { x: -0.91, y: 0.543, z: 0.95 }, true);
  b.cyl(0.078, 0.078, 0.085, 8, gas, { x: -0.91, y: 0.985, z: 0.95 }, true);
  b.box(0.044, 0.048, 0.038, { color: 0x907341, rough: 0.46, metal: 0.68 }, { x: -0.91, y: 1.022, z: 0.95 });
  b.box(0.32, 0.026, 0.02, dark, { x: -0.91, y: 0.80, z: 1.108 });
  for (const x of [-1.068, -0.752]) b.box(0.018, 0.026, 0.37, dark, { x, y: 0.80, z: 0.925 });
  openTube([-0.89, 1.045, 0.95], [-0.66, 0.97, 1.02], 0.009, 5, rubber);
  openTube([-0.66, 0.97, 1.02], [-0.60, 0.72, 0.745], 0.009, 5, rubber);
  b.box(0.50, 0.35, 0.37, { color: 0x843d32, rough: 0.73, metal: 0 }, { x: 0.32, y: 0.73, z: 0.94 });
  b.box(0.52, 0.045, 0.39, gas, { x: 0.32, y: 0.9275, z: 0.94 });

  const geometry = b.build();
  // Cart-exclusive uvMode -4 bypasses the atlas on every non-print part. No builder,
  // catalogue, extra draw call, atlas allocation or unrelated material signature changes.
  const mat = geometry.getAttribute('aMat');
  for (let i = 0; i < mat.count; i++) if (mat.getZ(i) === 0) mat.setZ(i, -4);
  return geometry;
}

/** Con Ed steam stack: orange-and-white striped 3.6 m chimney (0.55 m dia) on a striped cone base + barricades */
export function buildConEdStack(): THREE.BufferGeometry {
  const b = new MeshBuilder();
  const orange = { color: 0xe8611a, rough: 0.7, metal: 0.1 };
  const white = { color: 0xf1efe8, rough: 0.7, metal: 0.1 };
  const H = 3.6;
  const bands = 8;
  for (let i = 0; i < bands; i++) b.cyl(0.27, 0.27, H / bands + 0.003, 14, i % 2 ? white : orange, { y: 0.8 + (i * H) / bands });
  // cone base with 4 stripes
  for (let i = 0; i < 4; i++) {
    const y0 = i * 0.2;
    b.cyl(0.55 - (i + 1) * 0.07, 0.55 - i * 0.07, 0.2, 14, i % 2 ? orange : white, { y: y0 });
  }
  b.cyl(0.32, 0.32, 0.12, 14, { color: 0x333638, rough: 0.6, metal: 0.6 }, { y: H + 0.72 });
  // wooden police-style barricade legs around it (two A-frames)
  const wood = { color: 0x9a8a6a, rough: 0.9, metal: 0 };
  for (const s of [-1, 1]) {
    b.box(0.08, 1.05, 0.08, wood, { x: s * 0.9, y: 0.52, z: 0.7, rz: s * 0.25 });
    b.box(0.08, 1.05, 0.08, wood, { x: s * 0.9, y: 0.52, z: -0.7, rz: s * 0.25 });
    b.box(0.2, 0.06, 1.6, { color: 0xd8d0b8, rough: 0.9, metal: 0 }, { x: s * 0.82, y: 0.85, z: 0 });
    b.box(0.2, 0.06, 1.6, { color: 0xe07a2f, rough: 0.9, metal: 0 }, { x: s * 0.86, y: 0.55, z: 0 });
  }
  return b.build();
}
