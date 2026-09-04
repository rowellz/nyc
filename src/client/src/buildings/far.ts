/**
 * Far skyline layer: every building in the world as a cheap merged box per 1 km chunk, permanently
 * resident, drawn underneath the near tiles (inset so the detailed geometry wins). Gives the Manhattan
 * skyline from the rivers and aerial spots at correct heights, with a window-grid emissive at night.
 *
 * Two draw calls per chunk: the merged facades/roofs/rooftop boxes, and one InstancedMesh of water towers.
 * Both are plain MeshStandardMaterials (depth written, env map bound by the atmosphere) so the aerial
 * perspective post pass fogs them by depth exactly like the near tiles.
 */
import * as THREE from 'three';
import { buildScope, type BuildJob, type BuildSteps } from './loading';
import type { GameContext } from '@/core/context';
import { LANDMARK_BINS } from '@/landmarks/list';
import type { FacadeUniforms } from './material';
import { FAR_TOWER_FLOATS, type FarChunkMsg, type FarProgress, type FarStart } from './far.worker';
import { HASH_GLSL } from './hash';
import { FACADE_EMISSIVE_GLSL } from './lighting';
import { STYLE_COUNT } from './styles';
import { FAR_WINDOW_LIGHT_GLSL, WINDOW_GRID_GLSL } from './windows';
import { LOD_FACADE_GLSL } from './shader';
import { applyLandmarkVisibility, type LandmarkRange } from './landmarks';

export interface FarLayer {
  update(): void;
  syncLandmarks(): void;
  dispose(): void;
  stats: { chunks: number; fetched: number; total: number; done: boolean; buildings: number; towers?: number };
  group: THREE.Group;
}

/** world position of the vertex (instance matrix applied) for the near-radius cut of rooftop props */
const FAR_WPOS_VERTEX = /* glsl */ `
{
  vec4 fwp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  fwp = instanceMatrix * fwp;
  #endif
  vWPosF = (modelMatrix * fwp).xyz;
}
`;
const FAR_NEAR_CUT_PARS = /* glsl */ `
uniform vec3 uFocus;
uniform float uNearR;
varying vec3 vWPosF;
`;

const FAR_VERTEX_PARS = /* glsl */ `
attribute vec4 aData;
attribute vec4 aInfo;
attribute vec2 aWall;
flat varying vec4 vData;
flat varying vec4 vInfo;
flat varying vec2 vWall;
varying vec2 vUvM;
varying vec3 vWPosF;
`;
const FAR_VERTEX_MAIN = /* glsl */ `
vData = aData;
vInfo = aInfo;
vWall = aWall;
vUvM = uv;
`;
const FAR_FRAGMENT_PARS = /* glsl */ `
uniform float uNight;
uniform float uTime;
uniform float uEmissive;
uniform vec4 uStyle[${STYLE_COUNT * 3}];
flat varying vec4 vData;
flat varying vec4 vInfo;
flat varying vec2 vWall;
varying vec2 vUvM;
${FAR_NEAR_CUT_PARS}
${HASH_GLSL}
${WINDOW_GRID_GLSL}
${FAR_WINDOW_LIGHT_GLSL}
${FACADE_EMISSIVE_GLSL}
${LOD_FACADE_GLSL}
float hashfF(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoiseF(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashfF(i), hashfF(i + vec2(1, 0)), f.x), mix(hashfF(i + vec2(0, 1)), hashfF(i + vec2(1, 1)), f.x), f.y);
}
float fbmF(vec2 p) { return vnoiseF(p) * 0.5 + vnoiseF(p * 2.03) * 0.3 + vnoiseF(p * 4.1) * 0.2; }
`;
/** replaces <normal_fragment_maps> (flat normal already computed) */
const FAR_FRAGMENT_MAIN = /* glsl */ `
{
  int style = int(vData.a * 255.0 + 0.5);
  vec3 tint = vData.rgb;
  float H = vInfo.x;
  uint seed = uint(vInfo.y + 0.5);
  vec3 alb = tint;
  float rough = 0.85, metal = 0.0;
  vec3 emis = vec3(0.0);
  farSpec = vec3(0.04); farSpecMix = 0.0;
  float u = vUvM.x, v = vUvM.y;
  // rooftop boxes and parapet lips exist in the near tiles too: ours stop where those are resident
  if (style >= 253 && style < 255 && distance(vWPosF.xz, uFocus.xz) < uNearR) discard;
  if (style == 255) {
    // Roof membrane, matched term for term to buildings/shader.ts shadeRoof so nothing shifts across the
    // LOD line: 10 m recoat patches, 3 m batch variation, ponding stains with a chalky dried rim, and the
    // silver coat's dulling. Distance keeps all of it - this is what stops a roof reading as a pale slab.
    vec2 rp = vWPosF.xz;
    float rmat = hash2(seed, 40u);
    float rbig = fbmF(rp * 0.09 + 11.0);
    float rpond = fbmF(rp * 0.16 - 7.0);
    vec3 rc = tint * (0.82 + 0.40 * rbig) * (0.90 + 0.20 * fbmF(rp * 0.33 + 4.0));
    rc = mix(rc, rc * 0.62, smoothstep(0.52, 0.70, rpond) * 0.85);
    rc = mix(rc, rc * 0.9 + vec3(0.055, 0.053, 0.048), smoothstep(0.46, 0.54, rpond) * (1.0 - smoothstep(0.56, 0.64, rpond)));
    if (rmat < 0.28) { // silver aluminium coat
      rc = mix(rc, rc * 0.72 + vec3(0.03), smoothstep(0.55, 0.85, rbig));
      rough = 0.6; metal = 0.12;
    } else if (rmat < 0.86) rough = 0.94;
    else rough = 0.72;
    alb = rc;
  } else if (style == 254) {
    // stair bulkheads and louvred mechanical screens: painted metal, horizontal slats
    float slat = 0.5 + 0.5 * sin(v * 6.2831853 / 0.15);
    float fade = smoothstep(0.05, 0.3, fwidth(v));
    alb = tint * mix(0.72 + 0.28 * slat, 0.86, fade);
    rough = 0.55; metal = 0.25;
  } else if (style == 253) {
    alb = tint * 0.9;
  } else {
    vec4 P0 = uStyle[style * 3], P1 = uStyle[style * 3 + 1];
    float floorH = vInfo.z, gfH = vInfo.w;
    // Baked face-local coordinates are stable even on distant, oblique walls.
    float fl, fb, fh;
    if (style == 1) {
      fl = v < 1.7 ? 0.0 : v < 5.5 ? 1.0 : 2.0 + floor((v - 5.5) / floorH);
      fb = fl < 1.0 ? 0.0 : fl < 2.0 ? 1.7 : 5.5 + (fl - 2.0) * floorH;
      fh = fl < 1.0 ? 1.7 : fl < 2.0 ? 3.8 : floorH;
    } else {
      fl = v < gfH ? 0.0 : 1.0 + floor((v - gfH) / floorH);
      fb = fl < 1.0 ? 0.0 : gfH + (fl - 1.0) * floorH;
      fh = fl < 1.0 ? gfH : floorH;
    }
    float sp = P0.w, wl = vWall.x;
    float nCols = max(0.0, floor((wl - (style == 5 ? 0.0 : 1.4)) / sp));
    float cu = (u - (wl - nCols * sp) * 0.5) / sp;
    float ww = style == 5 ? sp - 0.09 : P0.y;
    float sill = style == 5 ? 0.9 : P1.x;
    float head = min(sill + P0.z, fh - 0.12);
    if (style == 1 && fl == 1.0) { sill = 0.6; head = 3.35; ww = 1.15; }
    if (style == 5) head = fh - 0.25;
    float fwU = fwidth(u) / sp, fwV = fwidth(v) / fh;
    float win = windowCoverage(cu, 0.5 - ww / sp * 0.5, 0.5 + ww / sp * 0.5, fwU)
      * windowCoverage((v - fb) / fh, sill / fh, head / fh, fwV);
    win *= step(0.0, cu) * (1.0 - step(nCols, cu)) * step(fb + head, H - 0.35);
    uint column = uint(vWall.y + 0.5) * 256u + uint(max(0.0, floor(cu)));
    // masonry: limestone / brick at its real tone, the prewar brick shaft over a stone base, the base
    // reading darker under a light belt course (fifth-42nd 1)
    vec3 wall = tint;
    bool stoneStyle = style == 2 || style == 4 || style == 9;
    bool brickShaft = style == 4 && hash2(seed, 14u) < 0.55;
    if (brickShaft && fl >= 3.0) wall = lodShaftTint(seed, tint);
    if (stoneStyle) {
      float baseFloors = brickShaft ? 3.0 : P1.w;
      float baseTop = gfH + (baseFloors - 1.0) * floorH;
      wall *= 1.0 - 0.12 * step(v, baseTop - 0.45);
      wall *= 1.0 + 0.12 * step(abs(v - (baseTop - 0.22)), max(0.22, fwidth(v)));
    }
    if (style == 5) {
      // curtain wall at bay resolution (same families as the near shader): dark tinted vision glass over a
      // darker spandrel band, or an anodised panel band; the coated glass reflects the sky at 20-35 %
      float cwK = hash2(seed, 4u);
      float ph = hash3(seed, column, uint(fl)), p2 = hash3(seed, column, uint(fl) + 977u);
      vec3 vision = tint * 0.06 * (0.85 + 0.3 * hash3(seed, column, uint(fl) + 906u));
      bool panelSp = cwK >= 0.35 && cwK < 0.7 && hash2(seed, 903u) >= 0.5;
      vec3 spandrel = panelSp ? vec3(0.13, 0.13, 0.14) : tint * (cwK < 0.35 ? 0.05 : cwK < 0.7 ? 0.055 : 0.045);
      alb = mix(spandrel, vision, win);
      metal = panelSp ? 0.6 * (1.0 - win) : 0.0;
      rough = mix(panelSp ? 0.5 : 0.3, 0.05 + 0.1 * ph, win);
      farSpec = lodGlassF0(tint) * mix(0.85, 1.0, win); farSpecMix = panelSp ? win : 1.0;
      // per-panel bow so the sky reflection breaks up floor to floor and bay to bay
      float panel = 1.0 - smoothstep(0.35, 0.9, max(fwU, fwV));
      vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      vec3 tV = normalize(cross(upV, normal));
      normal = normalize(normal + (tV * (ph - 0.5) * 0.09 + upV * (p2 - 0.5) * 0.07) * panel);
      if (lodCrownBand(v, H, fh) > 0.5) {
        alb = lodLouvre(vec3(0.3, 0.31, 0.32), v, fwidth(v));
        rough = 0.55; metal = 0.3; farSpecMix = 0.0; win = 0.0;
      }
    } else {
      alb = mix(wall, vec3(0.05, 0.06, 0.07), win);
      // Once a 2.6 m bay is sub-pixel, win is a coverage fraction, but a surface that is part mirror and
      // part matte keeps the SHARP lobe: averaging roughness linearly turned every masonry tower at 1 km
      // into a dull rough-0.7 slab with no sky sheen and no face-to-face contrast. sqrt gives the glass
      // the weight it has in the highlight while the albedo still averages linearly.
      rough = mix(0.85, 0.22, sqrt(win));
    }
    if (uNight > 0.15) {
      float litFrac = P1.y * uStyle[style * 3 + 2].z;
      vec3 light = farWindowLight(style, seed, fl + (v - fb) / fh, litFrac, fwV);
      // Unresolved bays contribute their area, never a random on/off window multiplied by coverage.
      float band = (ww / sp) * windowCoverage((v - fb) / fh, sill / fh, head / fh, fwV);
      band *= step(0.0, cu) * (1.0 - step(nCols, cu)) * step(fb + head, H - 0.35);
      if (style == 5) band *= 1.0 - lodCrownBand(v, H, fh);
      emis = light * band * smoothstep(0.15, 0.6, uNight) * uEmissive * 0.55;
      // Hue-preserving HDR ceiling, before exposure/bloom; near and mid emission keep their own limit.
      emis *= min(1.0, 1.5 / max(max(emis.r, max(emis.g, emis.b)), 0.0001));
    }
    // Retain the cornice shadow band after its sub-metre geometry stops resolving.
    float cornice = step(0.5, uStyle[style * 3 + 2].x);
    alb *= 1.0 - cornice * 0.25 * smoothstep(H - 1.25, H - 0.5, v);
    alb *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, 2.0, v));
  }
  diffuseColor.rgb = alb;
  roughnessFactor = rough;
  metalnessFactor = metal;
  totalEmissiveRadiance += limitFacadeEmission(emis);
}
`;

/** water tower: 4 legs (y 0..1, stretched to the stand height per instance) under a stave tank with a conical roof */
function waterTowerGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], part: number[] = [], nrm: number[] = [], idx: number[] = [];
  const wood = [0.36, 0.26, 0.18], woodDark = [0.28, 0.2, 0.14], steel = [0.2, 0.2, 0.21];
  const push = (x: number, y: number, z: number, n: [number, number, number], c: number[], p: number): number => {
    pos.push(x, y, z); nrm.push(...n); col.push(...c); part.push(p);
    return pos.length / 3 - 1;
  };
  const tri = (a: number, b: number, c: number) => idx.push(a, b, c);
  // legs: thin boxes 0.16 m, unit height (stretched in the vertex shader)
  const pr = 1.55;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = sx * pr, cz = sz * pr, r = 0.08;
    const faces: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (const n of faces) {
      const tx = n[2], tz = -n[0];
      const bx = cx + n[0] * r, bz = cz + n[2] * r;
      const a = push(bx - tx * r, 0, bz - tz * r, n, steel, 1), b = push(bx + tx * r, 0, bz + tz * r, n, steel, 1);
      const c = push(bx + tx * r, 1, bz + tz * r, n, steel, 1), d = push(bx - tx * r, 1, bz - tz * r, n, steel, 1);
      tri(a, c, b); tri(a, d, c);
    }
  }
  // cross-braces: two thin horizontal rails per side at 0.45 and 0.9 of the stand
  for (const [sx, sz, ux, uz] of [[0, -1, 1, 0], [0, 1, 1, 0], [-1, 0, 0, 1], [1, 0, 0, 1]]) {
    for (const yy of [0.45, 0.9]) {
      const n: [number, number, number] = [sz, 0, sx];
      const cx = sx * pr + n[0] * 0.04, cz = sz * pr + n[2] * 0.04;
      const a = push(cx - ux * pr, yy, cz - uz * pr, n, steel, 1), b = push(cx + ux * pr, yy, cz + uz * pr, n, steel, 1);
      const c = push(cx + ux * pr, yy, cz + uz * pr, n, steel, 1), d = push(cx - ux * pr, yy, cz - uz * pr, n, steel, 1);
      // a 6 cm rail as a quad standing off the face (flat, double-sided is not needed at skyline range)
      pos[c * 3 + 1] += 0.06; pos[d * 3 + 1] += 0.06;
      tri(a, c, b); tri(a, d, c);
    }
  }
  const seg = 12, tankR = 1.85, tankH = 4.0, roofH = 1.3, bottomH = 0.6;
  const ring = (y: number, r: number, c: number[], ny: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, cx = Math.cos(a), sz = Math.sin(a);
      const nl = Math.hypot(1, ny);
      out.push(push(cx * r, y, sz * r, [cx / nl, ny / nl, sz / nl], c, 0));
    }
    return out;
  };
  const band = (lo: number[], hi: number[]) => {
    for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; tri(lo[i], hi[j], lo[j]); tri(lo[i], hi[i], hi[j]); }
  };
  band(ring(-bottomH, 0.9, woodDark, -1.2), ring(0, tankR, woodDark, -1.2)); // conical bottom
  band(ring(0, tankR, wood, 0), ring(tankH, tankR, wood, 0)); // staves
  band(ring(tankH, tankR + 0.15, woodDark, 1.2), ring(tankH + roofH, 0.25, woodDark, 1.2)); // roof cone
  const apex = push(0, tankH + roofH + 0.1, 0, [0, 1, 0], woodDark, 0);
  const capRing = ring(tankH + roofH, 0.25, woodDark, 1.2);
  for (let i = 0; i < seg; i++) tri(capRing[i], apex, capRing[(i + 1) % seg]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export function createFarLayer(ctx: GameContext, uniforms: FacadeUniforms, builtLandmarks: ReadonlySet<number>): FarLayer {
  const group = new THREE.Group();
  group.name = 'buildings-far';
  ctx.worldGroup.add(group);
  const stats = { chunks: 0, fetched: 0, total: 0, done: false, buildings: 0, towers: 0 };
  const chunks = new Map<string, THREE.Mesh>();
  const towerMeshes = new Map<string, THREE.InstancedMesh>();
  const landmarkChunks = new Map<string, { index: Uint32Array; ranges: LandmarkRange[] }>();
  let worker: Worker | null = null;
  let started = false, disposed = false, startFrame = 0;
  const builds = buildScope(ctx);
  let requestJob: BuildJob | undefined;
  const commits = new Set<BuildJob>();
  // rooftop props are cut inside the radius where near tiles are resident (streamer: drawDistance + half a tile)
  const nearCut = { uFocus: { value: new THREE.Vector3() }, uNearR: { value: Math.max(0, ctx.quality.drawDistance - 200) } };
  const atm = ctx.modules.get('atmosphere') as { setupMaterial?(m: THREE.Material): void } | undefined;

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, flatShading: true, depthFunc: THREE.LessDepth, depthWrite: true, transparent: false });
  mat.name = 'facade-far';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uStyle = uniforms.uStyle;
    shader.uniforms.uNight = uniforms.uNight;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uEmissive = uniforms.uEmissive;
    shader.uniforms.uFocus = nearCut.uFocus;
    shader.uniforms.uNearR = nearCut.uNearR;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + FAR_VERTEX_PARS)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + FAR_VERTEX_MAIN)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + FAR_WPOS_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FAR_FRAGMENT_PARS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nvec3 farSpec = vec3(0.04);\nfloat farSpecMix = 0.0;\n' + FAR_FRAGMENT_MAIN)
      // specularColorBlended feeds BRDF_GGX (the sun lobe) but RE_IndirectSpecular_Physical reflects the env
      // map through material.specularColor: patching only the blended one left every far curtain wall
      // mirroring the sky at F0 0.04 instead of the 20-35 % of coated glass, so no west face lit at 18:00.
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor = mix(material.specularColor, farSpec, farSpecMix);\nmaterial.specularColorBlended = mix(material.specularColorBlended, farSpec, farSpecMix);');
  };
  mat.customProgramCacheKey = () => 'facade-far-grid-v7';
  atm?.setupMaterial?.(mat);

  // water towers: vertex-coloured wood and steel, legs stretched to the per-instance stand height
  const towerGeom = waterTowerGeometry();
  const towerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, depthFunc: THREE.LessDepth, depthWrite: true });
  towerMat.name = 'facade-far-towers';
  towerMat.onBeforeCompile = (shader) => {
    shader.uniforms.uFocus = nearCut.uFocus;
    shader.uniforms.uNearR = nearCut.uNearR;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nattribute float aStand;\nvarying vec3 vWPosF;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y = aPart > 0.5 ? transformed.y * aStand : transformed.y + aStand;\n' + FAR_WPOS_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FAR_NEAR_CUT_PARS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (distance(vWPosF.xz, uFocus.xz) < uNearR) discard;');
  };
  towerMat.customProgramCacheKey = () => 'facade-far-towers-v1';
  atm?.setupMaterial?.(towerMat);

  function* onChunk(m: FarChunkMsg): BuildSteps {
    if (chunks.has(m.key)) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.position, 3)); yield;
    g.setAttribute('aData', new THREE.BufferAttribute(m.data, 4, true)); yield;
    g.setAttribute('aInfo', new THREE.BufferAttribute(m.info, 4));
    g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
    g.setAttribute('aWall', new THREE.BufferAttribute(m.wall, 2));
    g.setIndex(new THREE.BufferAttribute(m.renderIndex, 1));
    applyLandmarkVisibility(g, m.index, m.landmarkRanges, builtLandmarks);
    if (m.landmarkRanges.length) landmarkChunks.set(m.key, { index: m.index, ranges: m.landmarkRanges });
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(m.bounds.cx, m.bounds.cy, m.bounds.cz), m.bounds.r);
    g.boundingBox = null;
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(m.ox, 0, m.oz);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.name = `far-${m.key}`;
    // Let opaque near geometry populate depth first, avoiding a second facade shade
    // under every loaded building. Strict depth also keeps near faces on quantized ties.
    mesh.renderOrder = 1;
    group.add(mesh);
    chunks.set(m.key, mesh);
    stats.chunks++;
    stats.buildings += m.buildings;
    const n = m.towers.length / FAR_TOWER_FLOATS;
    if (n > 0) {
      yield;
      const inst = new THREE.InstancedMesh(towerGeom, towerMat, n);
      const stand = new Float32Array(n);
      const M = new THREE.Matrix4();
      for (let i = 0; i < n; i++) {
        const o = i * FAR_TOWER_FLOATS;
        M.makeTranslation(m.towers[o], m.towers[o + 1], m.towers[o + 2]);
        inst.setMatrixAt(i, M);
        stand[i] = m.towers[o + 3];
      }
      // the stand height is an instanced attribute, so each chunk carries its own (small) copy of the geometry
      const withStand = towerGeom.clone();
      withStand.setAttribute('aStand', new THREE.InstancedBufferAttribute(stand, 1));
      inst.geometry = withStand;
      inst.instanceMatrix.needsUpdate = true;
      inst.position.set(m.ox, 0, m.oz);
      inst.castShadow = false;
      inst.receiveShadow = false;
      inst.frustumCulled = true;
      inst.computeBoundingSphere();
      if (inst.boundingSphere) inst.boundingSphere.radius += 12;
      inst.renderOrder = 1;
      inst.name = `far-towers-${m.key}`;
      group.add(inst);
      towerMeshes.set(m.key, inst);
      stats.towers += n;
    }
  }

  function start(): void {
    const idx = ctx.world.index;
    if (!idx || started || disposed) return;
    started = true;
    stats.total = idx.tiles.length;
    if (typeof Worker === 'undefined') return;
    try {
      worker = new Worker(new URL('./far.worker.ts', import.meta.url), { type: 'module', name: 'buildings-far' });
    } catch (err) {
      console.warn('[buildings] far worker unavailable', err);
      return;
    }
    requestJob = builds.job('far skyline request');
    worker.onmessage = (e: MessageEvent<FarChunkMsg | FarProgress>) => {
      const m = e.data;
      if (m.type === 'chunk') {
        const job = builds.job(`far:${m.key}`); commits.add(job);
        job.run((function* (): BuildSteps { try { yield* onChunk(m); } finally { commits.delete(job); } })());
      }
      else {
        stats.fetched = m.fetched;
        if (m.done) requestJob?.cancel();
        stats.done = m.done && !commits.size;
        if (m.done) console.info(`[buildings] far skyline: ${stats.chunks} chunks, ${stats.buildings} buildings, ${stats.towers} water towers from ${m.total} tiles`);
      }
    };
    worker.onerror = e => { requestJob?.cancel(); worker?.terminate(); console.warn('[buildings] far worker error', e.message); };
    worker.onmessageerror = () => { requestJob?.cancel(); worker?.terminate(); };
    const f = ctx.world.focus ?? ctx.camera.position;
    const baseUrl = (ctx.world as { baseUrl?: string }).baseUrl ?? '/world';
    const mobileTiles = ctx.quality.level === 'mobile' ? Array.from(ctx.world.tiles.values()) : undefined;
    const msg: FarStart = { type: 'start', baseUrl, keys: mobileTiles ? mobileTiles.map(t => t.key) : idx.tiles.slice(), tiles: mobileTiles, focusX: f.x, focusZ: f.z, landmarkBins: Array.from(LANDMARK_BINS), minHeight: ctx.quality.level === 'low' ? 8 : 0 };
    worker.postMessage(msg);
  }

  return {
    group,
    stats,
    update() {
      nearCut.uFocus.value.copy(ctx.world.focus ?? ctx.camera.position);
      // Start distant work only AFTER core has rendered the completed near scene and opened its gate.
      // Read the existing core gate: another module can enqueue work after our update,
      // so busy===0 here alone is not proof that afterFrame has opened it.
      if (!started && !startFrame && (globalThis as { __ready?: boolean }).__ready) {
        startFrame = requestAnimationFrame(() => { startFrame = 0; start(); });
      }
      if (started && requestJob && !requestJob.pending && !commits.size) stats.done = true;
    },
    syncLandmarks() {
      for (const [key, data] of landmarkChunks) {
        applyLandmarkVisibility(chunks.get(key)!.geometry, data.index, data.ranges, builtLandmarks);
      }
    },
    dispose() {
      builds.dispose();
      disposed = true; cancelAnimationFrame(startFrame); requestJob?.cancel();
      for (const job of commits) job.cancel(); commits.clear();
      worker?.terminate();
      worker = null;
      for (const m of chunks.values()) {
        group.remove(m);
        m.geometry.dispose();
      }
      for (const t of towerMeshes.values()) {
        group.remove(t);
        t.geometry.dispose();
        t.dispose();
      }
      chunks.clear();
      towerMeshes.clear();
      landmarkChunks.clear();
      towerGeom.dispose();
      mat.dispose();
      towerMat.dispose();
      ctx.worldGroup.remove(group);
    },
  };
}
