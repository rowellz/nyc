/**
 * Close-range grass blades: one InstancedMesh of tufts (3 crossed tapered strips, 18 verts) whose placement is
 * computed ENTIRELY in the vertex shader from a deterministic hash grid of cells around the camera, gated by the
 * grass channel of the 2x2 tile coverage masks around the camera. Zero CPU work per frame, no popping (positions
 * are fixed in world space), density and height fall off with distance, wind sway from the weather, per-blade hue
 * (yellow-green to blue-green) over a blue-green shaded base, mowing stripes inside the safe zone and short mowed
 * blades throughout the park mask. Receives shadows, casts none.
 */
import * as THREE from 'three';
import { TILE_SIZE } from '@shared/geo';
import { chainCompile, GLSL_NOISE_VS, type SharedUniforms } from './patch';
import type { TileMask } from './mask';

export interface GrassSystem {
  mesh: THREE.InstancedMesh;
  update(camera: THREE.Camera, maskAt: (tx: number, tz: number) => TileMask | null): void;
  dispose(): void;
}

const CELL = 4; // m

function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], tip: number[] = [], idx: number[] = [];
  const rows = 3;
  const widths = [1.0, 0.72, 0.08];
  for (let s = 0; s < 3; s++) {
    const a = (s * Math.PI) / 3;
    const cx = Math.cos(a), sz = Math.sin(a);
    const base = pos.length / 3;
    for (let r = 0; r < rows; r++) {
      const y = r / (rows - 1);
      const w = widths[r] * 0.5;
      pos.push(-w * cx, y, -w * sz, w * cx, y, w * sz);
      nrm.push(0, 1, 0, 0, 1, 0);
      tip.push(y, y);
    }
    for (let r = 0; r + 1 < rows; r++) {
      const i0 = base + r * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 1, i0 + 3, i0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export function createGrass(parent: THREE.Group, quality: 'low' | 'medium' | 'high' | 'ultra', sh: SharedUniforms): GrassSystem {
  // At lawn height, distant blades are subpixel, so the budget stays near the camera. Placed density is
  // n / (2r + CELL)^2 and the cost is the instance count alone, so reach is bought with density, not frame
  // time: the same tufts now spread to 12 m, where the old 10 m ring ended in a line across the lawn.
  const table = { low: { n: 6000, r: 7 }, medium: { n: 18000, r: 9 }, high: { n: 40000, r: 12 }, ultra: { n: 60000, r: 13 } }[quality];
  const radius = table.r;
  const side = Math.ceil((radius * 2) / CELL) + 1; // cells per side
  const cells = side * side;
  const perCell = Math.max(1, Math.floor(table.n / cells));
  const count = perCell * cells;

  const black = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  black.needsUpdate = true;
  const u = {
    uCamCell: { value: new THREE.Vector2() },
    uCell: { value: CELL },
    uRadius: { value: radius },
    uPerCell: { value: perCell },
    uSide: { value: side },
    uBladeHeight: { value: new THREE.Vector2(0.05, 0.08) },
    // Linear colours: the previous constants were sRGB-looking values used as
    // linear light, making shaded blades much brighter than the lawn texture.
    // The base of a tuft only ever sees sky light through the blades above it, so it reads blue-green;
    // the tip catches the sun and stays yellow-green. That gradient is what makes shaded turf look cool.
    uBladeBase: { value: new THREE.Color(0.038, 0.098, 0.048) },
    uBladeTip: { value: new THREE.Color(0.18, 0.30, 0.055) },
    uMask0: { value: black as THREE.Texture },
    uMask1: { value: black as THREE.Texture },
    uMask2: { value: black as THREE.Texture },
    uMask3: { value: black as THREE.Texture },
    uMaskO: { value: new THREE.Vector2() },
  };

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  chainCompile(mat, 'env-grass-v5', (shader) => {
    Object.assign(shader.uniforms, u, { uTime: sh.uTime, uWind: sh.uWind, uSafe: sh.uSafe, uSeason: sh.uSeason, uWetness: sh.uWetness });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform vec2 uCamCell; uniform float uCell, uRadius, uPerCell, uSide;
uniform vec2 uBladeHeight;
uniform sampler2D uMask0, uMask1, uMask2, uMask3; uniform vec2 uMaskO;
uniform float uTime, uSeason; uniform vec2 uWind; uniform vec3 uSafe;
attribute float aTip;
varying float vTip; varying vec3 vTint;
${GLSL_NOISE_VS}
float envMaskGrass(vec2 p) {
  vec2 rel = (p - uMaskO) / ${TILE_SIZE.toFixed(1)};
  vec2 sel = step(1.0, rel);
  vec2 uv = clamp(rel - sel, 0.0, 1.0);
  if (sel.x < 0.5) { return sel.y < 0.5 ? texture2D(uMask0, uv).g : texture2D(uMask2, uv).g; }
  return sel.y < 0.5 ? texture2D(uMask1, uv).g : texture2D(uMask3, uv).g;
}`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
float envId = float(gl_InstanceID);
float envCellI = floor(envId / uPerCell);
float envK = envId - envCellI * uPerCell;
vec2 envCellOff = vec2(mod(envCellI, uSide), floor(envCellI / uSide)) - (uSide - 1.0) * 0.5;
vec2 envCell = uCamCell + envCellOff;
vec2 envH = envHash22(envCell * 7.31 + envK * 0.173);
vec2 envH2 = envHash22(envCell * 3.17 + envK * 0.611 + 5.0);
vec2 envP = (envCell + envH) * uCell;
float envD = distance(envP, cameraPosition.xz);
float envG = envMaskGrass(envP);
float envDens = 1.0 - smoothstep(uRadius * 0.25, uRadius, envD) * 0.85;
float envKeep = step(envH2.x, envDens) * step(0.5, envG) * step(envD, uRadius);
float envSafeD = distance(envP, uSafe.xy);
float envMowed = 1.0 - smoothstep(uSafe.z * 0.9, uSafe.z * 1.15, envSafeD);
// Bryant Park lawn: worn patches (same noise as the ground shader) carry shorter, sparser, browner blades
float envWorn = 0.7 * smoothstep(0.54, 0.82, envNoise(envP * 0.17 + 11.3) * 0.72 + 0.28 * envNoise(envP * 0.4 + 3.7)) * (1.0 - smoothstep(uSafe.z * 0.85, uSafe.z, envSafeD));
float envHgt = mix(uBladeHeight.x, uBladeHeight.y, envH2.y);
float envSc = envKeep * envHgt * (1.0 - smoothstep(uRadius * 0.55, uRadius, envD)) * (1.0 - 0.6 * envWorn);
float envYaw = envH.x * 6.2832;
float envCy = cos(envYaw), envSy = sin(envYaw);
vec3 transformed = vec3(position.x * envCy - position.z * envSy, position.y, position.x * envSy + position.z * envCy);
transformed.xz *= envSc * 0.16 * mix(1.0, 1.3, envMowed);
transformed.y *= envSc;
transformed.xz += vec2(envH2.x - 0.5, envH.y - 0.5) * 0.5 * position.y * position.y * envSc;
float envWl = length(uWind);
vec2 envWd = envWl > 0.01 ? uWind / envWl : vec2(1.0, 0.0);
float envGust = envNoise(envP * 0.12 - envWd * uTime * 0.9) * 0.7 + 0.3 * sin(uTime * 2.3 + envP.x * 0.8 + envP.y * 0.6 + envH.y * 6.28);
float envBend = position.y * position.y * (0.15 + 0.85 * min(envWl, 9.0) / 9.0) * envGust * 0.55;
transformed.xz += envWd * envBend * envSc;
vec3 envWpos = vec3(envP.x, 0.0, envP.y) + transformed;
vTip = aTip;
float envDry = smoothstep(0.52, 0.8, envNoise(envP * 0.11 + 31.7)) * uSeason;
// broad growth variation matching the ground shader's macro noise: darker damp patches, paler worn ones
float envMacro = envNoise(envP * 0.045);
vec3 envTint = mix(vec3(1.0), vec3(1.3, 1.1, 0.6), envDry) * (0.8 + 0.4 * envH2.y) * mix(0.8, 1.2, smoothstep(0.25, 0.75, envMacro));
// per-blade hue: turf is a mix of yellow-green and blue-green blades, never one flat colour
envTint *= mix(vec3(1.07, 1.0, 0.84), vec3(0.90, 1.0, 1.16), envHash12(envCell * 2.11 + envK * 0.37 + 17.0));
if (envSafeD < uSafe.z) {
  // mowing stripes along the streets (the lawn's long axis), matching ground.ts
  vec2 sdir = vec2(0.4848, -0.8746);
  float s = dot(envP, sdir) / 3.6;
  envTint *= 1.0 + (smoothstep(0.35, 0.65, fract(s)) - 0.5) * 2.0 * 0.13 * (1.0 - smoothstep(uSafe.z * 0.85, uSafe.z, envSafeD)) * (1.0 - envWorn);
  envTint = mix(envTint, envTint * vec3(1.45, 1.12, 0.55), envWorn * 0.85);
}
vTint = envTint;`,
      )
      .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(envWpos, 1.0);\ngl_Position = projectionMatrix * mvPosition;')
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(envWpos, 1.0);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTip; varying vec3 vTint; uniform float uWetness; uniform vec3 uBladeBase, uBladeTip;')
      .replace('#include <map_fragment>', 'vec3 envBase = mix(uBladeBase, uBladeTip, vTip);\ndiffuseColor.rgb *= envBase * vTint * (1.0 - 0.25 * uWetness);')
      .replace('#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;');
  });

  const geo = tuftGeometry();
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.count = count;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'env-grass';
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  parent.add(mesh);

  return {
    mesh,
    update(camera, maskAt) {
      const cx = camera.position.x, cz = camera.position.z;
      u.uCamCell.value.set(Math.floor(cx / CELL), Math.floor(cz / CELL));
      const tx0 = Math.floor((cx - TILE_SIZE / 2) / TILE_SIZE), tz0 = Math.floor((cz - TILE_SIZE / 2) / TILE_SIZE);
      u.uMaskO.value.set(tx0 * TILE_SIZE, tz0 * TILE_SIZE);
      const m0 = maskAt(tx0, tz0), m1 = maskAt(tx0 + 1, tz0), m2 = maskAt(tx0, tz0 + 1), m3 = maskAt(tx0 + 1, tz0 + 1);
      u.uMask0.value = m0 ? m0.tex : black;
      u.uMask1.value = m1 ? m1.tex : black;
      u.uMask2.value = m2 ? m2.tex : black;
      u.uMask3.value = m3 ? m3.tex : black;
      // nothing green around: skip the draw entirely
      let any = false;
      for (const m of [m0, m1, m2, m3]) {
        if (!m) continue;
        const d = m.data;
        // coarse check: sample a 16x16 grid of the mask within the radius
        const R = radius + CELL;
        for (let z = cz - R; z <= cz + R && !any; z += R / 4)
          for (let x = cx - R; x <= cx + R; x += R / 4) {
            if (x < m.ox || x >= m.ox + TILE_SIZE || z < m.oz || z >= m.oz + TILE_SIZE) continue;
            const ui = Math.floor(((x - m.ox) / TILE_SIZE) * 512), vi = Math.floor(((z - m.oz) / TILE_SIZE) * 512);
            if (d[(vi * 512 + ui) * 4 + 1] > 60) {
              any = true;
              break;
            }
          }
        if (any) break;
      }
      mesh.visible = any;
    },
    dispose() {
      parent.remove(mesh);
      mesh.dispose();
      geo.dispose();
      mat.dispose();
      black.dispose();
    },
  };
}
