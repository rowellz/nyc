/**
 * Subway street stair, +x downhill, open threshold at x=-3; footprint remains 6 x 2.5 m.
 * Reference: refs/_general/subway-entrance-2.jpg (42 St–PABT), ART_DIRECTION §§3–7.
 * Profiled green iron, cast feet/capitals, station fascia and steel returns are one instanced mesh.
 * Budget: do not exceed the original measured 3,554 near / 530 far triangles; opening stays 2 tris.
 * This revision: 3,508 near / 522 far; all three remain within the existing 5 m culling radius.
 * The separate globe geometry, light sources, instance placement and LOD ranges are unchanged.
 */
import * as THREE from 'three';
import { MeshBuilder, EMIT, hash01, type PartStyle } from '../builder';
import { SUBWAY_SIGN_FRAC, SUBWAY_PLATE_U } from '../atlas';

export const SUB_L = 6.0;
export const SUB_W = 2.5;
// Placement uses groundHeight (road datum), not the 15 cm sidewalk surface. This is asset geometry,
// not a placement override. The stairwell instance already has a +0.025 m offset in placement.ts.
const PAVING = 0.15;
const OPENING_Y = PAVING + 0.005;
const QUAD_Y = OPENING_Y - 0.025;
// Reference's almost-black green enamel; chips belong to contact edges, not broad cast faces.
const GREEN: PartStyle = { color: 0x18352b, rough: 0.56, metal: 0, grimeBand: [PAVING, 0.6, 0.25] };
const GREEN_DARK: PartStyle = { color: 0x132b23, rough: 0.6, metal: 0 };
const CONCRETE: PartStyle = { color: 0x8f8c84, rough: 0.9, metal: 0 };
const STEEL: PartStyle = { color: 0xa5aaa8, rough: 0.34, metal: 0.8 };

export function buildSubwayRailing(detail: 'near' | 'far'): THREE.BufferGeometry {
  const b = new MeshBuilder(), near = detail === 'near';
  const seg = near ? 8 : 5, hx = SUB_L / 2, hz = SUB_W / 2;
  const H = PAVING + 0.95;
  // Low weathered coping seated in the sidewalk, with a clear open threshold.
  b.box(SUB_L + 0.4, 0.11, 0.2, CONCRETE, { y: 0.195, z: -hz - 0.1 });
  b.box(SUB_L + 0.4, 0.11, 0.2, CONCRETE, { y: 0.195, z: hz + 0.1 });
  b.box(0.2, 0.11, SUB_W + 0.4, CONCRETE, { x: hx + 0.1, y: 0.195 });
  const runs: [[number, number], [number, number]][] = [
    [[-hx, -hz], [hx, -hz]], [[-hx, hz], [hx, hz]], [[hx, -hz], [hx, hz]],
  ];
  const posts = new Map<string, [number, number]>();
  for (const [[ax, az], [bx, bz]] of runs) {
    const len = Math.hypot(bx - ax, bz - az), alongX = bx !== ax;
    const n = Math.max(2, Math.round(len / 1.5) + 1);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      posts.set(`${x}:${z}`, [x, z]); // Shared corners are cast once, not coincident duplicated posts.
    }
    if (near) {
      // Wide flat cap, recessed underside and narrow vertical web, not a round garden-fence rail.
      const profile = new THREE.Shape([
        [-0.046, 0.014], [0.046, 0.014], [0.046, -0.014], [0.018, -0.014],
        [0.018, -0.062], [-0.018, -0.062], [-0.018, -0.014], [-0.046, -0.014],
      ].map(([x, y]) => new THREE.Vector2(x, y)));
      const cap = new THREE.ExtrudeGeometry(profile, { depth: len, steps: 1, bevelEnabled: false });
      b.add(cap, GREEN, { x: ax, y: H, z: az, ry: alongX ? Math.PI / 2 : 0 });
      // A continuous square picket costs half the triangles of the previous two-piece picket.
      const m = Math.round(len / 0.14);
      for (let i = 1; i < m; i++) {
        const t = i / m, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if ([...posts.values()].some(([px, pz]) => Math.hypot(x - px, z - pz) < 0.06)) continue;
        b.box(0.021, 0.72, 0.021, GREEN, { x, y: H - 0.38, z });
      }
      // Flat under-cap band and canted iron links form the shallow decorative header.
      b.box(alongX ? len : 0.035, 0.025, alongX ? 0.035 : len, GREEN, { x: (ax + bx) / 2, y: H - 0.16, z: (az + bz) / 2 });
      for (let i = 0; i < Math.floor(len / 0.28); i++) {
        const t = (i + 0.5) * 0.28 / len;
        b.box(0.018, 0.15, 0.018, GREEN, { x: ax + (bx - ax) * t, y: H - 0.09, z: az + (bz - az) * t,
          rz: alongX ? -0.55 : 0, rx: alongX ? 0 : 0.55 });
      }
    } else {
      b.box(alongX ? len : 0.092, 0.055, alongX ? 0.092 : len, GREEN, { x: (ax + bx) / 2, y: H - 0.0135, z: (az + bz) / 2 });
      // Preserve the low-cost far panel, but align its long axis with the actual run.
      b.box(alongX ? len : 0.012, 0.65, alongX ? 0.012 : len, GREEN_DARK, { x: (ax + bx) / 2, y: 0.70, z: (az + bz) / 2 });
    }
    b.box(alongX ? len : 0.055, 0.14, alongX ? 0.055 : len, GREEN_DARK, { x: (ax + bx) / 2, y: 0.32, z: (az + bz) / 2 });
  }
  for (const [x, z] of posts.values()) {
    // The open-end corners terminate in the globe castings below, not duplicate little finials.
    if (x === -hx) continue;
    const end = Math.abs(x) === hx;
    b.box(end ? 0.105 : 0.065, H - 0.16, end ? 0.105 : 0.065, GREEN, { x, y: (H + 0.16) / 2, z });
    if (near || end) b.box(end ? 0.17 : 0.105, 0.20, end ? 0.17 : 0.105, GREEN_DARK, { x, y: 0.35, z });
    if (near) {
      b.box(0.12, 0.035, 0.12, GREEN, { x, y: H + 0.015, z });
      b.add(new THREE.OctahedronGeometry(0.051), GREEN, { x, y: H + 0.071, z, sy: 1.25 });
      // A rectangular anchor flange and two small bolt heads at each cast foot.
      b.box(end ? 0.195 : 0.13, 0.018, end ? 0.195 : 0.13, GREEN_DARK, { x, y: 0.259, z });
      if (end) for (const dz of [-0.075, 0.075]) b.cyl(0.009, 0.009, 0.012, 5, STEEL, { x, y: 0.268, z: z + dz });
    }
  }
  // Sleeves surround the existing, separately instanced globe shafts at their authored offsets.
  // Reuse the omitted front posts' budget. Do not move or replace the original lamp/light sources.
  for (const side of [-1, 1]) {
    const x = -hx, z = side * (hz + 0.12);
    b.box(0.32, 0.10, 0.31, CONCRETE, { x, y: 0.195, z });
    const profile: [number, number][] = near ? [
      [0.153, 0.245], [0.153, 0.28], [0.126, 0.28], [0.126, 0.60],
      [0.110, 0.64], [0.104, 1.485], [0.130, 1.54], [0.147, 1.59],
    ] : [[0.145, 0.245], [0.145, 0.60], [0.110, 0.66], [0.120, 1.60]];
    const casting = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 4).toNonIndexed();
    casting.computeVertexNormals(); // Four planar cast faces, not a smoothly shaded circular stick.
    b.add(casting, GREEN, { x, z, ry: Math.PI / 4 });
    if (near) {
      b.box(0.28, 0.018, 0.28, GREEN_DARK, { x, y: 0.254, z });
      for (const dz of [-0.121, 0.121]) b.cyl(0.012, 0.012, 0.014, 4, STEEL, { x: x - 0.121, y: 0.264, z: z + dz });
      // PABT reference: the square shaft ends BELOW the opal bowl. A waisted neck,
      // flared collar and projecting cast shoulders make the lantern a distinct fitting.
      // Wrap the fixed black lamp stem; do not cover/recolour its emitting globe.
      b.lathe([[0.100, 1.58], [0.112, 1.615], [0.065, 1.66], [0.076, 1.765], [0.095, 1.833]],
        8, GREEN_DARK, { x, z });
      b.box(0.10, 0.04, 0.36, GREEN, { x, y: 1.60, z });
      for (const direction of [-1, 1]) {
        // Simple solid brackets: only the broad silhouette is verifiable in the photo.
        // Positive-determinant rotation mirrors the pair without reversing its winding.
        const shoulder = new THREE.Shape([
          [0.070, 1.49], [0.115, 1.55], [0.174, 1.56], [0.174, 1.58], [0.070, 1.58],
        ].map(([px, py]) => new THREE.Vector2(px, py)));
        const bracket = new THREE.ExtrudeGeometry(shoulder, { depth: 0.07, steps: 1, bevelEnabled: false });
        bracket.translate(0, 0, -0.035);
        b.add(bracket, GREEN, { x, z, ry: direction * Math.PI / 2 });
      }
      b.lathe([[0.162, 1.962], [0.180, 1.974], [0.162, 2.002]], 12, GREEN_DARK, { x, z });
    } else {
      // Far LOD keeps the same separated shaft/neck silhouette using ten triangles per neck.
      b.cyl(0.095, 0.080, 0.235, 5, GREEN_DARK, { x, y: 1.598, z }, true);
      b.cylC(0.178, 0.178, 0.030, 8, GREEN_DARK, { x, y: 1.98, z }, true);
    }
  }
  // Black fascia attached inside the end railing, correctly facing the open (-x) end.
  const signW = 2.16, signH = 0.54, signY = H - signH / 2 - 0.065;
  b.box(0.065, signH + 0.035, signW + 0.035, GREEN_DARK, { x: hx - 0.025, y: signY });
  b.quad(signW, signH, { color: 0xffffff, rough: 0.48, metal: 0, atlas: true,
    emit: EMIT.mapGlowNight, emitStrength: 1.4 }, { x: hx - 0.06, y: signY, ry: -Math.PI / 2 }, [0, 0, SUBWAY_SIGN_FRAC, 1]);
  // Threshold/nosing sit just above paving; the 2-triangle parallax opening handles the descent.
  // Reference: broad grey landing tread with yellow END patches, not a painted full-width stripe.
  b.box(0.30, 0.020, SUB_W - 0.10, CONCRETE, { x: -hx + 0.15, y: PAVING + 0.009 });
  for (const side of [-1, 1]) b.box(0.30, 0.004, 0.17, { color: 0xc5a746, rough: 0.72, metal: 0 },
    { x: -hx + 0.15, y: PAVING + 0.021, z: side * (hz - 0.135) });
  // Existing centre rail, with a short level return before the sloping run. No floating rail ends.
  const railX = -hx + 0.17, railY = PAVING + 0.95, railEnd = railX + 0.95 / (4.2 / SUB_L);
  b.tube([railX, OPENING_Y, 0], [railX, railY, 0], 0.024, seg, STEEL);
  b.tube([railX, railY, 0], [railEnd, OPENING_Y, 0], 0.024, seg, STEEL);
  b.tube([railX, PAVING + 0.59, 0], [railX + 0.59 / (4.2 / SUB_L), OPENING_Y, 0], 0.016, seg, STEEL);
  if (near) {
    b.cyl(0.055, 0.055, 0.012, 8, STEEL, { x: railX, y: OPENING_Y });
    for (const side of [-1, 1]) {
      const z = side * (hz - 0.16);
      b.tube([-hx + 0.06, 0.92, z + side * 0.10], [-hx + 0.23, 0.92, z], 0.022, 8, STEEL);
      b.tube([-hx + 0.23, 0.92, z], [-hx + 1.33, OPENING_Y, z], 0.022, 8, STEEL);
    }
    // Blue/black MTA plate is readable from the threshold, not an unlabelled pair of boxes.
    const plateZ = -hz - 0.035;
    b.box(0.023, 0.25, 0.51, GREEN_DARK, { x: -hx + 0.025, y: 0.90, z: plateZ });
    b.quad(0.5, 0.245, { color: 0xffffff, rough: 0.55, metal: 0, atlas: true },
      { x: -hx + 0.010, y: 0.90, z: plateZ, ry: -Math.PI / 2 }, [SUBWAY_PLATE_U, 0, 1 - SUBWAY_PLATE_U, 1]);
    // Fixed 2–4 cm gum on the coping; no random spawn changes and no decals outside the asset.
    for (let i = 0; i < 12; i++) {
      const x = -hx + 0.25 + hash01(i, 41) * (SUB_L - 0.5);
      const z = (i % 2 ? -1 : 1) * (hz + 0.04 + hash01(i, 19) * 0.10);
      const gum = new THREE.CircleGeometry(0.010 + hash01(i, 23) * 0.008, 7);
      b.add(gum, { color: 0x55564f, rough: 0.98, metal: 0 }, { x, y: 0.251, z, rx: -Math.PI / 2, sx: 1.15 });
    }
  }
  const g = b.build();
  // Reserved subway-only material tag. Untextured iron/stone must not sample arbitrary sign slots.
  const mat = g.getAttribute('aMat') as THREE.BufferAttribute;
  for (let i = 0; i < mat.count; i++) mat.setW(i, 2);
  return g;
}

/** flat quad covering the opening; shaded by the interior-mapping stairwell shader */
export function buildStairwellQuad(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(SUB_L, SUB_W);
  g.rotateX(-Math.PI / 2);
  g.translate(0, QUAD_Y, 0); // + existing 0.025 instance offset = 5 mm above the sidewalk
  return g;
}

/**
 * Interior mapping: the fragment computes the view ray in the quad's local space and intersects it with
 * the stairwell box below (depth D = 4 m at the far end): 2 side walls (tiled), the far wall, and a
 * 21 treads/risers (286 mm going, 200 mm rise). Still a two-triangle, instanced surface;
 * no sidewalk cuts, scene/placement changes or extra draws. Lighting below is deliberately unchanged.
 */
export function makeStairwellMaterial(tiles: THREE.Texture, uniforms: { uLamp: { value: number } }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'props-stairwell',
    uniforms: {
      uTiles: { value: tiles },
      uLamp: uniforms.uLamp,
      uL: { value: SUB_L },
      uW: { value: SUB_W },
      uD: { value: 4.2 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocalPos;
      varying vec3 vLocalCam;
      void main() {
        vec3 openingOrigin = vec3(0.0, ${QUAD_Y.toFixed(3)}, 0.0);
        vLocalPos = position - openingOrigin;
        #ifdef USE_INSTANCING
          mat4 im = instanceMatrix;
        #else
          mat4 im = mat4(1.0);
        #endif
        mat4 mw = modelMatrix * im;
        // camera position in the instance's local space (rigid transforms: inverse = transpose of rotation)
        mat4 inv = inverse(mw);
        vLocalCam = (inv * vec4(cameraPosition, 1.0)).xyz - openingOrigin;
        gl_Position = projectionMatrix * viewMatrix * mw * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uTiles;
      uniform float uLamp, uL, uW, uD;
      varying vec3 vLocalPos;
      varying vec3 vLocalCam;
      // Finite cylinder intersection: continues the real handrails below the virtual opening.
      float railHit(vec3 ro, vec3 rd, vec3 a, vec3 b, float radius) {
        vec3 ba = b - a, oa = ro - a;
        float bb = dot(ba, ba), br = dot(ba, rd), bo = dot(ba, oa);
        float aa = bb - br * br, ab = bb * dot(rd, oa) - bo * br;
        float ac = bb * dot(oa, oa) - bo * bo - radius * radius * bb;
        float disc = ab * ab - aa * ac;
        if (disc < 0.0 || aa < 0.00001) return 1e9;
        float t = (-ab - sqrt(disc)) / aa, y = bo + t * br;
        return t > 0.0 && y > 0.0 && y < bb ? t : 1e9;
      }
      void main() {
        vec3 ro = vLocalPos;               // on the quad (y = 0)
        vec3 rd = normalize(vLocalPos - vLocalCam);
        if (rd.y >= -0.001) { discard; }
        float hx = uL * 0.5, hz = uW * 0.5;
        float t = 1e9; int face = 2;
        float going = uL / 21.0, rise = uD / 21.0;
        // Actual horizontal treads and vertical risers, instead of stripes on an inclined plane.
        for (int i = 0; i < 21; i++) {
          float x0 = -hx + float(i) * going, y0 = -float(i) * rise;
          float tt = (y0 - rise - ro.y) / rd.y;
          float tx = ro.x + rd.x * tt;
          if (tt > 0.0 && tt < t && tx >= x0 && tx <= x0 + going) { t = tt; face = 0; }
          if (abs(rd.x) > 0.00001) {
            float tr = (x0 - ro.x) / rd.x, ty = ro.y + rd.y * tr;
            if (tr > 0.0 && tr < t && ty <= y0 && ty >= y0 - rise) { t = tr; face = 3; }
          }
        }
        if (abs(rd.z) > 0.00001) {
          float tw = ((rd.z < 0.0 ? -hz : hz) - ro.z) / rd.z;
          if (tw > 0.0 && tw < t) { t = tw; face = 1; }
        }
        if (rd.x > 0.00001) {
          float tf = (hx - ro.x) / rd.x;
          if (tf > 0.0 && tf < t) { t = tf; face = 2; }
        }
        // Match the three above-ground steel returns without adding geometry below an opaque street.
        for (int i = 0; i < 3; i++) {
          float z = float(i - 1) * (hz - 0.16);
          vec3 a = vec3(-hx + (i == 1 ? 0.17 : 0.23), i == 1 ? 0.945 : 0.765, z);
          float slope = i == 1 ? (uD / uL) * (0.945 / 0.95) : 0.765 / 1.10;
          vec3 b = vec3(hx - 0.15, a.y - (hx - 0.15 - a.x) * slope, z);
          float tr = railHit(ro, rd, a, b, i == 1 ? 0.024 : 0.022);
          if (tr < t) { t = tr; face = 4; }
        }
        vec3 p = ro + rd * t;
        // depth below ground where we hit (0..uD)
        float depth = clamp(-p.y / uD, 0.0, 1.0);
        vec3 col;
        if (face == 0 || face == 3) {
          float edge = fract((p.x + hx) / going) * going;
          float grain = sin(p.x * 193.0 + sin(p.z * 147.0)) * sin(p.z * 237.0) * 0.018;
          col = vec3(0.42, 0.41, 0.38) * (face == 0 ? 1.0 : 0.58) + grain;
          // Worn 3 cm nosing, never a broad luminous yellow tread.
          float aa = max(fwidth(edge), 0.001);
          float yellow = face == 0 ? 1.0 - smoothstep(0.028 - aa, 0.028 + aa, edge) : 0.0;
          // Continue the landing's end markings on the first exposed step; deeper nosings remain.
          if (p.x < -hx + going * 2.0) yellow *= smoothstep(hz - 0.23, hz - 0.20, abs(p.z));
          col = mix(col, vec3(0.57, 0.43, 0.12), yellow * 0.86);
        } else if (face == 4) {
          col = vec3(0.46, 0.49, 0.48);
        } else if (face == 2) {
          // Recessed throat below the far fascia, not a bright tiled wall sealing the stair shut.
          // This is dark surface albedo; retain the existing fluorescent/daylight response below.
          col = vec3(0.055, 0.059, 0.055);
        } else {
          // Stacked six-inch wall tiles, with 2 mm grout. Sample only cream rows of
          // the existing subway tile map, avoiding its repeated green bands and baked brick joints.
          vec2 wall = vec2(p.x, -p.y) / 0.1524;
          vec2 cell = floor(wall), f = fract(wall);
          float row = 2.0 + mod(cell.y, 9.0);
          // Texture v runs bottom-up; these are canvas rows 5–13, clear of the green band.
          float stagger = mod(row + 1.0, 2.0) * 0.5;
          vec2 tuv = vec2((mod(cell.x, 8.0) + stagger + 0.2 + f.x * 0.6) / 8.0,
                          (row + 0.2 + f.y * 0.6) / 16.0);
          col = texture2D(uTiles, tuv).rgb;
          vec2 border = min(f, 1.0 - f), aa = max(fwidth(wall), vec2(0.002));
          vec2 tile = smoothstep(vec2(0.0065), vec2(0.0065) + aa, border);
          col *= mix(0.48, 1.0, tile.x * tile.y);
        }
        // light: daylight falls off with depth; a fluorescent tube at the bottom glows warm-white
        float day = (1.0 - uLamp);
        float ambient = mix(0.05, 0.9, pow(1.0 - depth, 1.6)) * day + 0.04;
        float tube = 0.9 * smoothstep(0.25, 1.0, depth) * (0.35 + 0.65 * uLamp);
        col *= ambient + tube * vec3(1.0, 0.97, 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.FrontSide,
    depthWrite: true,
  });
}
