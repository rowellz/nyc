/**
 * Ground: one 256 m quad per tile at y = 0 with a per-tile MeshStandardMaterial (shared program, per-tile mask
 * uniform) that blends asphalt / concrete / lawn / worn dirt / gravel from the coverage mask using world-space,
 * anti-tiled texturing with noise-broken edges; discards water texels (the water plane below shows through);
 * darkens and puddles with wetness. Also: the bulkhead along every water polygon edge (stained concrete face,
 * granite cap, instanced steel railing, a lapping foam strip on the water side) or the natural shore band of
 * park ponds, the multiply-blended ambient-occlusion contact ring under every tree trunk, and the flat distant
 * ground under every index tile beyond the streamed radius.
 */
import * as THREE from 'three';
import { TILE_SIZE } from '@shared/geo';
import type { Polygon, Tile, WorldIndex } from '@shared/world';
import { chainCompile, GLSL_NOISE, type SharedUniforms } from './patch';
import type { TexSet } from './textures';
import { maskSample, type TileMask } from './mask';
import { pointInPolygon, polygonInsideAny, signedArea, hash2 } from './geom';

export const WATER_LEVEL = -1.6;
const SEAWALL_TOP = WATER_LEVEL + 2;
const SEAWALL_BOTTOM = WATER_LEVEL - 1.2;
/** where a pier deck crosses the bulkhead the wall stops under the deck and carries no cap or railing */
const DECK_UNDERSIDE = -0.95;
const RAIL_H = 1.0; // steel pipe railing above the cap
const RAIL_POST_STEP = 2.4;
const FOAM_W = 1.1;

export interface GroundTile {
  key: string;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  seawall: THREE.Mesh | null;
  /** railing, foam: extra bulkhead furniture (patched and prepared with the seawall) */
  extras: THREE.Group | null;
  /** ambient-occlusion contact rings under the tile's tree trunks (unlit, multiply-blended) */
  contact: THREE.InstancedMesh | null;
}

export interface GroundOptions {
  /** bulkhead edges whose midpoint satisfies this get no cap/railing/foam (pier decks meet the wall there) */
  skipEdge?: (x: number, z: number) => boolean;
}

export interface GroundSystem {
  addTile(tile: Tile, mask: TileMask): GroundTile;
  removeTile(gt: GroundTile): void;
  setTextures(tex: TexSet): void;
  buildFar(index: WorldIndex | null): void;
  setTileLoaded(key: string, loaded: boolean): void;
  dispose(): void;
}

interface TexUniforms {
  uAsphalt: THREE.IUniform<THREE.Texture>;
  uAsphaltN: THREE.IUniform<THREE.Texture>;
  uConcrete: THREE.IUniform<THREE.Texture>;
  uGrass: THREE.IUniform<THREE.Texture>;
  uGrassN: THREE.IUniform<THREE.Texture>;
  uGravel: THREE.IUniform<THREE.Texture>;
  uGravelN: THREE.IUniform<THREE.Texture>;
  uSoil: THREE.IUniform<THREE.Texture>;
  uSoilN: THREE.IUniform<THREE.Texture>;
  uTexScale: THREE.IUniform<THREE.Vector4>; // 1/size: asphalt, concrete, grass, gravel
  uSoilScale: THREE.IUniform<number>;
}

const GROUND_FRAG_PARS = /* glsl */ `
uniform sampler2D uMask;
uniform vec2 uMaskOrigin;
// Leave room for four CSM shadow maps and the environment on 16-sampler GPUs.
uniform sampler2D uAsphalt, uAsphaltN, uConcrete, uGrass, uGrassN, uGravel, uGravelN, uSoil, uSoilN;
uniform vec4 uTexScale;
uniform float uSoilScale;
uniform float uWetness, uSeason;
uniform vec3 uSafe;
varying vec2 vWorldXZ;
${GLSL_NOISE}
`;

const GROUND_MAP_FRAGMENT = /* glsl */ `
vec2 wp = vWorldXZ;
vec4 m = texture2D(uMask, (wp - uMaskOrigin) / ${TILE_SIZE.toFixed(1)});
if (m.r > 0.5) discard;
float camD = length(vViewPosition);
float n1 = envFbm(wp * 0.045);
float n2 = envNoise(wp * 0.5);
float n3 = envNoise(wp * 0.11 + 31.7);
// paved base: dark asphalt with concrete yards / lots
vec4 asA = envTexNoTile(uAsphalt, wp * uTexScale.x);
vec3 asN = envTexNoTile(uAsphaltN, wp * uTexScale.x).xyz;
float asR = 0.8 + n2 * 0.1;
vec4 coA = envTexNoTile(uConcrete, wp * uTexScale.y);
vec3 coN = mix(vec3(0.5, 0.5, 1.0), asN, 0.45);
float lot = smoothstep(0.44, 0.62, n1);
vec3 pavedC = mix(asA.rgb, coA.rgb, lot);
vec3 pavedN = mix(asN, coN, lot);
float pavedR = mix(asR, 0.74, lot);
// natural: lawn with dry patches, worn to dirt along paths and at the edges
vec4 grA = envTexNoTile(uGrass, wp * uTexScale.z);
vec3 grN = envTexNoTile(uGrassN, wp * uTexScale.z).xyz;
vec4 soA = envTexNoTile(uSoil, wp * uSoilScale);
vec3 soN = envTexNoTile(uSoilN, wp * uSoilScale).xyz;
vec4 gvA = envTexNoTile(uGravel, wp * uTexScale.w);
vec3 gvN = envTexNoTile(uGravelN, wp * uTexScale.w).xyz;
vec3 grassC = grA.rgb * mix(vec3(1.0), vec3(1.22, 1.04, 0.70), uSeason * smoothstep(0.52, 0.8, n3));
// The 1.4 m albedo repeat mips to its average across a lawn. Keep broad, world-fixed
// growth variation after that filtering, reusing the noise already sampled above.
grassC *= mix(0.78, 1.22, smoothstep(0.25, 0.75, n1));
// World-space size of this fragment. Procedural detail finer than the footprint has to be faded out
// rather than left to alias: unfiltered fract()/noise is exactly what flattened the lawn to one mat.
float envFp = max(fwidth(wp.x), fwidth(wp.y));
// 2-5 m patches of drier / darker turf. No mown lawn is one tone, and this is the scale that reads at 5-60 m.
float turf = envNoise(wp * 0.28 + 5.1) * 0.62 + n2 * 0.38;
grassC *= mix(vec3(1.0), mix(vec3(0.80, 0.85, 0.80), vec3(1.15, 1.11, 0.90), smoothstep(0.28, 0.74, turf)), 1.0 - smoothstep(1.1, 3.0, envFp));
// How close this fragment is to the edge of the grass polygon, from the mask 1.6 m out in each direction:
// gEdge ~1 hard against a kerb / lawn curb / path edge, gTramp the wider band people walk over.
float gEdge = 0.0, gTramp = 0.0;
if (m.g > 0.02) {
  vec2 mo = (wp - uMaskOrigin) / ${TILE_SIZE.toFixed(1)};
  float e = 1.6 / ${TILE_SIZE.toFixed(1)};
  float gMin = min(min(texture2D(uMask, mo + vec2(e, 0.0)).g, texture2D(uMask, mo - vec2(e, 0.0)).g), min(texture2D(uMask, mo + vec2(0.0, e)).g, texture2D(uMask, mo - vec2(0.0, e)).g));
  gEdge = (1.0 - smoothstep(0.0, 0.5, gMin)) * smoothstep(0.3, 0.7, m.g);
  gTramp = (1.0 - smoothstep(0.12, 0.9, gMin)) * smoothstep(0.4, 0.7, m.g);
}
float safeD = distance(wp, uSafe.xy);
if (safeD < uSafe.z) {
  // Bryant Park lawn: 1.8 m mowing bands along the lawn's long axis (bearing 119 deg), browner worn patches
  // where people sit, and a trampled band just inside the granite curb.
  vec2 dir = vec2(0.4848, -0.8746);
  float s = dot(wp, dir) / 3.6;
  float sw = fwidth(s);
  // Filtered square wave: soften the band edge to the pixel footprint, then drop the pattern once a whole
  // period is sub-pixel, so the stripes stay a stripe pattern at 40 m instead of averaging to flat green.
  float k = clamp(0.25 + sw * 1.5, 0.25, 0.5);
  float band = (smoothstep(0.5 - k, 0.5 + k, fract(s)) - 0.5) * 2.0 * (1.0 - smoothstep(0.30, 0.75, sw));
  float fade = 1.0 - smoothstep(uSafe.z * 0.85, uSafe.z, safeD);
  float patches = smoothstep(0.54, 0.82, envNoise(wp * 0.17 + 11.3) * 0.72 + 0.28 * envNoise(wp * 0.4 + 3.7));
  float worn = max(patches * 0.7 * (1.0 - smoothstep(1.0, 2.6, envFp)), gTramp * (0.35 + 0.5 * n2)) * fade;
  grassC *= 1.0 + band * 0.15 * fade * (1.0 - worn);
  grassC = mix(grassC, mix(grassC * vec3(1.45, 1.12, 0.55), soA.rgb * vec3(1.05, 0.95, 0.8), 0.45), worn * 0.65);
}
float gCov = smoothstep(0.30 + 0.25 * n2, 0.72 - 0.15 * n2, m.g);
float wear = clamp(m.a * 1.2 + (1.0 - gCov) * smoothstep(0.02, 0.35, m.g) * 0.8, 0.0, 1.0);
wear = smoothstep(0.15, 0.85, wear + 0.25 * (n2 - 0.5));
vec3 natC = mix(grassC, soA.rgb, wear);
vec3 natN = mix(grN, soN, wear);
float natR = mix(0.92, 0.95, wear);
float natAmt = smoothstep(0.03, 0.30, m.g);
vec3 col = mix(pavedC, natC, natAmt);
vec3 nrm = mix(pavedN, natN, natAmt);
float rough = mix(pavedR, natR, natAmt);
float gv = smoothstep(0.35, 0.65, m.b);
col = mix(col, gvA.rgb, gv);
nrm = mix(nrm, gvN, gv);
rough = mix(rough, 0.92, gv); // landmarks GRAVEL style roughness, so the promenade cap and the tile gravel match
// Ground contact: the strip right against a kerb, the lawn curb or a path edge sees almost no sky.
col *= 1.0 - 0.32 * gEdge;
// wetness: darker albedo, puddles in the low spots of paved ground
float pavedAmt = 1.0 - natAmt;
float puddle = smoothstep(0.50, 0.64, n2 * 0.5 + envNoise(wp * 0.23 + 7.3) * 0.5) * uWetness * pavedAmt;
col *= 1.0 - uWetness * mix(0.28, 0.55, pavedAmt);
rough = mix(rough, 0.10, max(puddle, uWetness * 0.6 * pavedAmt));
nrm = mix(nrm, vec3(0.5, 0.5, 1.0), puddle);
float nStr = 1.0 - smoothstep(25.0, 140.0, camD);
vec3 envNormalW = normalize(vec3((nrm.x * 2.0 - 1.0) * nStr, 1.0, -(nrm.y * 2.0 - 1.0) * nStr));
float envRough = rough;
diffuseColor.rgb *= col;
`;

const SEAWALL_PARS = /* glsl */ `
varying float vWY;
varying vec2 vWXZ;
uniform float uWetness, uTime;
${GLSL_NOISE}
`;
const SEAWALL_MAP = /* glsl */ `
float along = vWXZ.x + vWXZ.y;
float n = envFbm(vec2(along, vWY) * 1.7);
// streaks running down the face from the cap, bulkhead sections every ~6 m, rust bleeding from the tie rods
float streak = envNoise(vec2(along * 0.8, vWY * 0.15)) * (1.0 - smoothstep(-0.4, 0.4, vWY));
float joint = smoothstep(0.05, 0.0, abs(fract(along / 6.0) - 0.5) * 6.0 - 2.85);
float rust = smoothstep(0.78, 0.92, envNoise(vec2(along * 1.5, 0.0))) * (1.0 - smoothstep(-0.8, 0.2, vWY));
diffuseColor.rgb *= (0.85 + 0.3 * n) * (1.0 - 0.25 * streak) * (1.0 - 0.35 * joint);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.07, 0.03), rust * 0.6);
// high-water tide band (wet, dark) and the black-green slime below the mean waterline
float wl = 1.0 - smoothstep(-1.05, -0.35, vWY);
diffuseColor.rgb *= mix(1.0, 0.45, wl);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.065, 0.04), (1.0 - smoothstep(-1.55, -0.95, vWY)) * 0.75);
// pale salt/dry line just above the highest water
diffuseColor.rgb *= 1.0 + 0.25 * exp(-pow((vWY + 0.3) / 0.1, 2.0));
diffuseColor.rgb *= 1.0 - 0.35 * uWetness;
`;

const FOAM_PARS = /* glsl */ `
varying vec2 vFoamUv;
uniform float uTime, uWind2;
${GLSL_NOISE}
`;
const FOAM_MAP = /* glsl */ `
{
  float a = vFoamUv.x, x = vFoamUv.y; // metres along the wall, metres out from it
  float t = uTime;
  // waves slap the wall and wash back: a bright line hugging the face that surges outward every few seconds
  float surge = 0.5 + 0.5 * sin(a * 0.9 - t * 1.7 + envNoise(vec2(a * 0.25, t * 0.3)) * 4.0);
  float reach = 0.25 + 0.55 * surge;
  float edge = smoothstep(reach, reach - 0.35, x);
  float lace = envNoise(vec2(a * 3.0 + t * 0.4, x * 6.0 - t * 1.1)) * 0.6 + envNoise(vec2(a * 9.0 - t * 0.7, x * 14.0)) * 0.4;
  float foam = edge * smoothstep(0.35, 0.75, lace + 0.25 * surge) * (0.35 + 0.65 * surge);
  diffuseColor.a = clamp(foam, 0.0, 1.0) * 0.85;
}
`;

export function createGround(ctx: { worldGroup: THREE.Group; quality: { shadows: boolean } }, parent: THREE.Group, tex: TexSet, sh: SharedUniforms, opts: GroundOptions = {}): GroundSystem {
  const texU: TexUniforms = {
    uAsphalt: { value: tex.asphalt.map },
    uAsphaltN: { value: tex.asphalt.normal },
    uConcrete: { value: tex.concrete.map },
    uGrass: { value: tex.grass.map },
    uGrassN: { value: tex.grass.normal },
    uGravel: { value: tex.gravel.map },
    uGravelN: { value: tex.gravel.normal },
    uSoil: { value: tex.soil.map },
    uSoilN: { value: tex.soil.normal },
    uTexScale: { value: new THREE.Vector4(1 / tex.asphalt.size, 1 / tex.concrete.size, 1 / tex.grass.size, 1 / tex.gravel.size) },
    uSoilScale: { value: 1 / tex.soil.size },
  };

  function makeGroundMaterial(mask: TileMask): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const uMask = { value: mask.tex };
    const uMaskOrigin = { value: new THREE.Vector2(mask.ox, mask.oz) };
    chainCompile(m, 'env-ground-v6', (shader) => {
      Object.assign(shader.uniforms, texU, { uMask, uMaskOrigin, uWetness: sh.uWetness, uSeason: sh.uSeason, uSafe: sh.uSafe });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWorldXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GROUND_FRAG_PARS)
        .replace('#include <map_fragment>', GROUND_MAP_FRAGMENT)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = envRough;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(envNormalW, 0.0)).xyz);');
    });
    return m;
  }

  // Per-edge colour keeps mixed pond/bulkhead tiles in one draw, without voting
  // an entire tile (including concrete walls) into the brown natural-shore material.
  const seawallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  {
    const mat = seawallMat;
    chainCompile(mat, 'env-seawall-v3', (shader) => {
      shader.uniforms.uWetness = sh.uWetness;
      shader.uniforms.uTime = sh.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWY; varying vec2 vWXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 envWP = modelMatrix * vec4(transformed, 1.0); vWY = envWP.y; vWXZ = envWP.xz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + SEAWALL_PARS).replace('#include <map_fragment>', SEAWALL_MAP);
    });
  }
  // Painted steel pipe railing (Hudson River Park / Gantry Plaza): posts instanced, rails merged per tile.
  const railMat = new THREE.MeshStandardMaterial({ color: 0x33373a, roughness: 0.5, metalness: 0.55 });
  const postGeo = new THREE.BoxGeometry(0.06, RAIL_H, 0.06);
  postGeo.translate(0, RAIL_H / 2, 0);
  // Foam: a transparent strip on the water side of the wall, lit like everything else so it darkens in shade.
  const foamMat = new THREE.MeshStandardMaterial({ color: 0xd8dcd6, roughness: 0.9, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  chainCompile(foamMat, 'env-foam-v1', (shader) => {
    shader.uniforms.uTime = sh.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFoamUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoamUv = uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + FOAM_PARS).replace('#include <map_fragment>', FOAM_MAP);
  });

  // Contact occlusion under tree trunks: a soft dark ellipse multiplied over whatever ground is already
  // drawn there. Unlit and untonemapped so it is a straight albedo multiply on the linear buffer; the
  // real AO pass never resolves the few centimetres where a trunk meets the paving.
  const contactGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // dst *= src, spelled out: three's MultiplyBlending preset only exists on the premultiplied-alpha path and
  // logs an error per draw call otherwise, which costs far more than the decal.
  const contactMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, toneMapped: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  chainCompile(contactMat, 'env-contact-v1', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAoXZ; varying float vAoD;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAoXZ = position.xz;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvAoD = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vAoXZ; varying float vAoD;')
      .replace('#include <map_fragment>', 'float aoR = length(vAoXZ) * 2.0;\nfloat ao = 0.34 * (1.0 - smoothstep(0.18, 1.0, aoR)) * (1.0 - smoothstep(45.0, 90.0, vAoD));\ndiffuseColor.rgb = vec3(1.0 - ao);');
  });

  const farMat = new THREE.MeshStandardMaterial({ color: 0x35332f, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 3 });
  chainCompile(farMat, 'env-far-v1', (shader) => {
    shader.uniforms.uWetness = sh.uWetness;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWetness;').replace('#include <map_fragment>', 'diffuseColor.rgb *= 1.0 - 0.45 * uWetness;');
  });
  let farMesh: THREE.Mesh | null = null;
  const farSlots = new Map<string, number>();
  const loadedKeys = new Set<string>();

  function setTileLoaded(key: string, loaded: boolean): void {
    if (loaded) loadedKeys.add(key);
    else loadedKeys.delete(key);
    const slot = farSlots.get(key);
    if (slot === undefined || !farMesh) return;
    const pos = farMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    // The detailed ground discards water pixels. The far layer must not plug those holes.
    for (let j = 0; j < 4; j++) pos.setY(slot * 4 + j, loaded ? WATER_LEVEL - 2 : -0.25);
    pos.addUpdateRange(slot * 12, 12);
    pos.needsUpdate = true;
  }

  function tileQuad(tx: number, tz: number): THREE.BufferGeometry {
    const ox = tx * TILE_SIZE, oz = tz * TILE_SIZE;
    const g = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 4, 4);
    g.rotateX(-Math.PI / 2);
    g.translate(ox + TILE_SIZE / 2, 0, oz + TILE_SIZE / 2);
    g.computeBoundingSphere();
    return g;
  }

  /** one soft dark ellipse per tree trunk, sitting on whichever surface the mask says the tree stands on */
  function buildContact(tile: Tile, mask: TileMask): THREE.InstancedMesh | null {
    if (!tile.trees.length) return null;
    const inst = new THREE.InstancedMesh(contactGeo, contactMat, tile.trees.length);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < tile.trees.length; i++) {
      const t = tile.trees[i];
      // Grass sits on our own quad at 0; a park plaza carries the landmarks gravel cap at 0.19; everything
      // else is the streets module's paving (WALK_Y 0.15) with the tree pit a few mm above it.
      const y = maskSample(mask, t.x, t.z, 2) > 127 ? 0.205 : maskSample(mask, t.x, t.z, 1) > 127 ? 0.02 : 0.168;
      // roughly four trunk radii of shadowed ground around the flare
      const r = Math.min(2.4, Math.max(0.8, 0.5 + Math.max(0, t.dbh) * 0.0254 * 2));
      m4.makeScale(r * 2, 1, r * 2);
      m4.setPosition(t.x, y, t.z);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.name = `env-contact-${tile.key}`;
    inst.castShadow = inst.receiveShadow = false;
    inst.matrixAutoUpdate = false;
    inst.renderOrder = 2; // after the opaque ground, before the bulkhead foam
    return inst;
  }

  function addTile(tile: Tile, mask: TileMask): GroundTile {
    const mat = makeGroundMaterial(mask);
    const mesh = new THREE.Mesh(tileQuad(tile.tx, tile.tz), mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = `env-ground-${tile.key}`;
    mesh.matrixAutoUpdate = false;
    parent.add(mesh);
    let seawall: THREE.Mesh | null = null;
    let extras: THREE.Group | null = null;
    if (tile.water.length) {
      const built = buildSeawalls(tile, opts.skipEdge);
      if (built.wall) {
        seawall = new THREE.Mesh(built.wall, seawallMat);
        seawall.receiveShadow = true;
        seawall.castShadow = ctx.quality.shadows;
        seawall.name = `env-seawall-${tile.key}`;
        seawall.matrixAutoUpdate = false;
        parent.add(seawall);
      }
      if (built.rails || built.posts.length || built.foam) {
        extras = new THREE.Group();
        extras.name = `env-bulkhead-${tile.key}`;
        extras.matrixAutoUpdate = false;
        if (built.rails) {
          const m = new THREE.Mesh(built.rails, railMat);
          m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false; // pipe shadows are sub-pixel; save the cascade draws
          extras.add(m);
        }
        if (built.posts.length) {
          const inst = new THREE.InstancedMesh(postGeo, railMat, built.posts.length);
          const m4 = new THREE.Matrix4();
          built.posts.forEach((p, i) => { m4.makeRotationY(p.yaw); m4.setPosition(p.x, p.y, p.z); inst.setMatrixAt(i, m4); });
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingSphere();
          inst.castShadow = false; inst.receiveShadow = true; inst.matrixAutoUpdate = false;
          extras.add(inst);
        }
        if (built.foam) {
          const m = new THREE.Mesh(built.foam, foamMat);
          m.receiveShadow = true; m.matrixAutoUpdate = false; m.renderOrder = 3; // after the water plane
          extras.add(m);
        }
        parent.add(extras);
      }
    }
    const contact = buildContact(tile, mask);
    if (contact) parent.add(contact);
    return { key: tile.key, mesh, mat, seawall, extras, contact };
  }

  function removeTile(gt: GroundTile): void {
    parent.remove(gt.mesh);
    gt.mesh.geometry.dispose();
    gt.mat.dispose();
    if (gt.seawall) {
      parent.remove(gt.seawall);
      gt.seawall.geometry.dispose();
    }
    if (gt.extras) {
      parent.remove(gt.extras);
      for (const o of gt.extras.children) {
        const g = (o as THREE.Mesh).geometry;
        if (g && g !== postGeo) g.dispose();
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
      }
    }
    if (gt.contact) {
      parent.remove(gt.contact);
      gt.contact.dispose(); // shared geometry and material are owned by the system
    }
  }

  function setTextures(t: TexSet): void {
    texU.uAsphalt.value = t.asphalt.map;
    texU.uAsphaltN.value = t.asphalt.normal;
    texU.uConcrete.value = t.concrete.map;
    texU.uGrass.value = t.grass.map;
    texU.uGrassN.value = t.grass.normal;
    texU.uGravel.value = t.gravel.map;
    texU.uGravelN.value = t.gravel.normal;
    texU.uSoil.value = t.soil.map;
    texU.uSoilN.value = t.soil.normal;
    texU.uTexScale.value.set(1 / t.asphalt.size, 1 / t.concrete.size, 1 / t.grass.size, 1 / t.gravel.size);
    texU.uSoilScale.value = 1 / t.soil.size;
  }

  function buildFar(index: WorldIndex | null): void {
    farSlots.clear();
    if (farMesh) {
      parent.remove(farMesh);
      farMesh.geometry.dispose();
      farMesh = null;
    }
    if (!index || !index.tiles.length) return;
    const n = index.tiles.length;
    const pos = new Float32Array(n * 12);
    const nrm = new Float32Array(n * 12);
    const idx = new Uint32Array(n * 6);
    let i = 0;
    for (const key of index.tiles) {
      const [tx, tz] = key.split('_').map(Number);
      if (!Number.isFinite(tx) || !Number.isFinite(tz)) continue;
      farSlots.set(key, i);
      const ox = tx * TILE_SIZE, oz = tz * TILE_SIZE, y = loadedKeys.has(key) ? WATER_LEVEL - 2 : -0.25;
      const b = i * 12;
      pos.set([ox, y, oz, ox + TILE_SIZE, y, oz, ox + TILE_SIZE, y, oz + TILE_SIZE, ox, y, oz + TILE_SIZE], b);
      nrm.set([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], b);
      const v = i * 4;
      idx.set([v, v + 2, v + 1, v, v + 3, v + 2], i * 6);
      i++;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, i * 12), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm.subarray(0, i * 12), 3));
    g.setIndex(new THREE.BufferAttribute(idx.subarray(0, i * 6), 1));
    g.computeBoundingSphere();
    farMesh = new THREE.Mesh(g, farMat);
    farMesh.name = 'env-far-ground';
    farMesh.receiveShadow = true;
    farMesh.matrixAutoUpdate = false;
    farMesh.frustumCulled = false;
    parent.add(farMesh);
  }

  return {
    addTile,
    removeTile,
    setTextures,
    buildFar,
    setTileLoaded,
    dispose() {
      seawallMat.dispose();
      railMat.dispose();
      foamMat.dispose();
      postGeo.dispose();
      contactGeo.dispose();
      contactMat.dispose();
      farMat.dispose();
      if (farMesh) {
        parent.remove(farMesh);
        farMesh.geometry.dispose();
      }
    },
  };
}

interface SeawallBuild {
  wall: THREE.BufferGeometry | null;
  rails: THREE.BufferGeometry | null;
  posts: { x: number; y: number; z: number; yaw: number }[];
  foam: THREE.BufferGeometry | null;
}

/** axis-aligned-in-local box along an edge: centre c, unit direction d (x/z), length, width across (nx,nz), height */
function pushRailBox(pos: number[], nrm: number[], idx: number[], ax: number, az: number, bx: number, bz: number, nx: number, nz: number, y0: number, y1: number, w: number): void {
  const base = pos.length / 3;
  const hx = nx * w / 2, hz = nz * w / 2;
  const corners = [
    [ax - hx, az - hz], [bx - hx, bz - hz], [bx + hx, bz + hz], [ax + hx, az + hz],
  ];
  // 4 side faces + top; bottom omitted (never seen)
  const faces: [number, number, number, number, number, number, number][] = [
    // ia, ib (corner indices), y0, y1 -> quad; normal
    [0, 1, y0, y1, -nx, 0, -nz],
    [2, 3, y0, y1, nx, 0, nz],
    [1, 2, y0, y1, bx - ax, 0, bz - az],
    [3, 0, y0, y1, ax - bx, 0, az - bz],
  ];
  let v = base;
  for (const [ia, ib, ya, yb, fx, fy, fz] of faces) {
    const l = Math.hypot(fx, fz) || 1;
    const [x0, z0] = corners[ia], [x1, z1] = corners[ib];
    pos.push(x0, ya, z0, x1, ya, z1, x1, yb, z1, x0, yb, z0);
    for (let k = 0; k < 4; k++) nrm.push(fx / l, fy, fz / l);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3, v, v + 2, v + 1, v, v + 3, v + 2); // both windings: thin rails, no culling worries
    v += 4;
  }
  for (const [x, z] of corners) { pos.push(x, y1, z); nrm.push(0, 1, 0); }
  idx.push(v, v + 1, v + 2, v, v + 2, v + 3, v, v + 2, v + 1, v, v + 3, v + 2);
}

/** vertical band + top cap along every water-polygon edge that is not a tile boundary or a seam between water polygons */
function buildSeawalls(tile: Tile, skipEdge?: (x: number, z: number) => boolean): SeawallBuild {
  const ox = tile.tx * TILE_SIZE, oz = tile.tz * TILE_SIZE;
  const rp: number[] = [], rn: number[] = [], ri: number[] = [];
  const posts: SeawallBuild['posts'] = [];
  const fp: number[] = [], fn: number[] = [], fu: number[] = [], fi: number[] = [];
  const eps = 0.15;
  const onBoundary = (ax: number, az: number, bx: number, bz: number): boolean =>
    (Math.abs(ax - ox) < eps && Math.abs(bx - ox) < eps) ||
    (Math.abs(ax - ox - TILE_SIZE) < eps && Math.abs(bx - ox - TILE_SIZE) < eps) ||
    (Math.abs(az - oz) < eps && Math.abs(bz - oz) < eps) ||
    (Math.abs(az - oz - TILE_SIZE) < eps && Math.abs(bz - oz - TILE_SIZE) < eps);
  const water: Polygon[] = tile.water;
  const inOtherWater = (x: number, z: number, self: Polygon): boolean => {
    for (const w of water) if (w !== self && pointInPolygon(x, z, w)) return true;
    return false;
  };
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [], uv: number[] = [], colors: number[] = [];
  // grimy poured concrete face; granite cap stone; brown natural bank
  const concrete = new THREE.Color(0x585a55), granite = new THREE.Color(0x7d7a75), shore = new THREE.Color(0x4d4234);
  for (const poly of water) {
    if (!poly.length) continue;
    // A clipped river sliver in a waterfront park is still an urban bulkhead,
    // not a pond. Only enclosed park water qualifies for the natural band.
    const clipped = poly[0].some(([x, z]) => Math.abs(x - ox) < eps || Math.abs(x - ox - TILE_SIZE) < eps || Math.abs(z - oz) < eps || Math.abs(z - oz - TILE_SIZE) < eps);
    const natural = !clipped && polygonInsideAny(poly, tile.parks);
    const color = natural ? shore : concrete;
    const capColor = natural ? shore : granite;
    for (let r = 0; r < poly.length; r++) {
      const ring = poly[r];
      if (ring.length < 3) continue;
      // signedArea uses the x/z (viewed from above) convention: negative area
      // has its interior to the algebraic left (-ez, ex) used below.
      const ccw = signedArea(ring) < 0;
      const hole = r > 0;
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i];
        const [bx, bz] = ring[(i + 1) % ring.length];
        if (onBoundary(ax, az, bx, bz)) continue;
        const ex = bx - ax, ez = bz - az;
        const len = Math.hypot(ex, ez);
        if (len < 0.05) continue;
        // normal pointing INTO the water (toward the polygon interior; away from a hole's interior)
        let nx = -ez / len, nz = ex / len;
        if (!ccw) { nx = -nx; nz = -nz; }
        if (hole) { nx = -nx; nz = -nz; }
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (inOtherWater(mx - nx * 0.4, mz - nz * 0.4, poly)) continue; // seam between two water polygons
        const underDeck = !natural && !!skipEdge && skipEdge(mx, mz);
        const top = natural ? 0.12 : underDeck ? DECK_UNDERSIDE : SEAWALL_TOP;
        const base = pos.length / 3;
        pos.push(ax, SEAWALL_BOTTOM, az, bx, SEAWALL_BOTTOM, bz, bx, top, bz, ax, top, az);
        for (let k = 0; k < 4; k++) nrm.push(nx, 0, nz);
        uv.push(0, 0, len, 0, len, 1, 0, 1);
        // winding: (b-a) x (top-a) = (-ez*h, 0, ex*h); flip when it points away from the water
        const fwd = -ez * nx + ex * nz > 0;
        if (fwd) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        for (let k = 0; k < 4; k++) colors.push(color.r, color.g, color.b);
        if (underDeck) continue;
        // top cap: 0.45 m wide strip toward the land side
        const cap = natural ? 1.2 : 0.45;
        const cb = pos.length / 3;
        const capY = natural ? 0.04 : top;
        pos.push(ax, top, az, bx, top, bz, bx - nx * cap, capY, bz - nz * cap, ax - nx * cap, capY, az - nz * cap);
        for (let k = 0; k < 4; k++) nrm.push(0, 1, 0);
        uv.push(0, 0, len, 0, len, cap, 0, cap);
        // face up: winding from (a, b, b') should give +y: (b-a) x (b'-b) = (ex,0,ez) x (-nx*cap, 0, -nz*cap) -> y = ez*(-nx*cap) - ex*(-nz*cap)
        const upOk = -ez * nx * cap + ex * nz * cap > 0;
        if (upOk) idx.push(cb, cb + 1, cb + 2, cb, cb + 2, cb + 3);
        else idx.push(cb, cb + 2, cb + 1, cb, cb + 3, cb + 2);
        for (let k = 0; k < 4; k++) colors.push(capColor.r, capColor.g, capColor.b);
        if (natural) continue;
        // railing 0.2 m in from the cap edge: top rail, mid rail, kick rail; posts every 2.4 m
        const inx = -nx * 0.2, inz = -nz * 0.2;
        const rax = ax + inx, raz = az + inz, rbx = bx + inx, rbz = bz + inz;
        const dx = ex / len, dz = ez / len;
        for (const [y0, y1, w] of [[top + RAIL_H - 0.06, top + RAIL_H, 0.06], [top + RAIL_H * 0.55, top + RAIL_H * 0.55 + 0.035, 0.035], [top + 0.1, top + 0.135, 0.035]] as const)
          pushRailBox(rp, rn, ri, rax, raz, rbx, rbz, nx, nz, y0, y1, w);
        const nPosts = Math.max(1, Math.ceil(len / RAIL_POST_STEP));
        const yaw = Math.atan2(dx, dz);
        for (let k = 0; k <= nPosts; k++) {
          if (k === nPosts && len > 0.6 && i + 1 < ring.length) continue; // next edge starts here
          const t = Math.min(len, k * (len / nPosts));
          posts.push({ x: rax + dx * t, y: top, z: raz + dz * t, yaw });
        }
        // foam strip on the water side, UV = (metres along, metres out)
        const fb = fp.length / 3, fy = WATER_LEVEL + 0.03;
        const jitter = 0.7 + 0.6 * hash2(ax, az);
        fp.push(ax, fy, az, bx, fy, bz, bx + nx * FOAM_W * jitter, fy, bz + nz * FOAM_W * jitter, ax + nx * FOAM_W * jitter, fy, az + nz * FOAM_W * jitter);
        for (let k = 0; k < 4; k++) fn.push(0, 1, 0);
        fu.push(0, 0, len, 0, len, FOAM_W * jitter, 0, FOAM_W * jitter);
        const foamUp = ez * nx - ex * nz > 0; // (b-a) x (b'-b) must point +y for a front face seen from above
        if (foamUp) fi.push(fb, fb + 1, fb + 2, fb, fb + 2, fb + 3);
        else fi.push(fb, fb + 2, fb + 1, fb, fb + 3, fb + 2);
      }
    }
  }
  const make = (p: number[], n: number[], ix: number[], u?: number[], c?: number[]): THREE.BufferGeometry | null => {
    if (!p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    if (u) g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
    if (c) g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.setIndex(ix);
    g.computeBoundingSphere();
    return g;
  };
  return { wall: make(pos, nrm, idx, uv, colors), rails: make(rp, rn, ri), posts, foam: make(fp, fn, fi, fu) };
}
