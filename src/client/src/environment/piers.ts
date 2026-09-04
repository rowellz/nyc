/**
 * Hudson River piers, W 36th - W 57th. The tiles carry the river as one water polygon with the piers NOT cut out
 * (pier buildings such as the Circle Line terminal float over open water), and there is no man_made=pier layer,
 * so the piers come from a fixed table of real positions: concrete decks on rows of timber fender piles, the
 * cruise-terminal sheds (88/90/92/94), timber dolphins at the pier heads, and rows of cut-off stumps beside the
 * older piers. Each element belongs to the tile that contains its centre; the deck root is snapped to the tile's
 * real shoreline so the deck meets the bulkhead wherever the OSM edge actually runs.
 */
import * as THREE from 'three';
import { TILE_SIZE } from '@shared/geo';
import type { Tile } from '@shared/world';
import { pointInPolygon, rng } from './geom';
import { chainCompile, GLSL_NOISE, type SharedUniforms } from './patch';
import { WATER_LEVEL } from './ground';

/** Manhattan grid: pier axis (grid west, heading 299) and grid north, world x/z. */
const AXIS = new THREE.Vector2(-0.875, -0.485);
const NORTH = new THREE.Vector2(0.485, -0.875);
/** W 44th St centreline at the Hudson bulkhead (from the -6_-5 tile shoreline) and the 80.5 m street pitch. */
const ROOT_44 = new THREE.Vector2(-1506.3, -1068.2);
const STREET_M = 80.5;
const DECK_TOP = -0.06; // just under the esplanade: the ground at y = 0 covers the deck over land without z-fighting at 500 m
const DECK_THICK = 0.9;
const PILE_R = 0.18;

interface PierDef { street: number; length: number; width: number; shed?: number; stumps?: boolean; carrier?: boolean }
const PIERS: PierDef[] = [
  { street: 36, length: 240, width: 60, stumps: true }, // Pier 76
  { street: 39, length: 150, width: 45, shed: 6 }, // Pier 79, NY Waterway
  { street: 41, length: 190, width: 26, stumps: true }, // Pier 81
  { street: 42.7, length: 170, width: 32 }, // Pier 83, Circle Line (its terminal building is in the tiles)
  { street: 44, length: 200, width: 60, stumps: true }, // Pier 84
  { street: 46, length: 265, width: 40, carrier: true }, // Pier 86, Intrepid
  { street: 48, length: 330, width: 62, shed: 13 }, // Pier 88
  { street: 50, length: 330, width: 62, shed: 13 }, // Pier 90
  { street: 52, length: 330, width: 62, shed: 13 }, // Pier 92
  { street: 54, length: 200, width: 62, shed: 12 }, // Pier 94
  { street: 57, length: 150, width: 60 }, // Pier 97, Clinton Cove
];

export interface PierSystem {
  build(tile: Tile): THREE.Group | null;
  /** true when the x/z point lies on a pier deck (bulkhead furniture stops there) */
  onDeck(x: number, z: number): boolean;
  dispose(): void;
}

function rootOf(p: PierDef): THREE.Vector2 {
  return ROOT_44.clone().addScaledVector(NORTH, (p.street - 44) * STREET_M);
}

const TIMBER_PARS = /* glsl */ `
varying float vPileY;
varying vec3 vPileW;
${GLSL_NOISE}
`;
const TIMBER_MAP = /* glsl */ `
{
  float grain = envNoise(vec2(vPileW.x * 7.0 + vPileW.z * 3.0, vPileY * 1.3)) * 0.35 + 0.82;
  diffuseColor.rgb *= grain;
  // tide band: black-green slime below the high-water line, dry grey timber above, a pale salt line between
  float tide = 1.0 - smoothstep(-1.2, -0.35, vPileY);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.055, 0.04), tide * 0.85);
  diffuseColor.rgb *= 1.0 + 0.35 * exp(-pow((vPileY + 0.25) / 0.12, 2.0));
}
`;

export function createPiers(parent: THREE.Group, sh: SharedUniforms, shadows: boolean): PierSystem {
  void parent;
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x77776f, roughness: 0.92, metalness: 0, vertexColors: true });
  const shedMat = new THREE.MeshStandardMaterial({ color: 0x9d9e98, roughness: 0.75, metalness: 0.1, vertexColors: true });
  const timberMat = new THREE.MeshStandardMaterial({ color: 0x5a4d3f, roughness: 0.95, metalness: 0 });
  chainCompile(timberMat, 'env-timber-v1', (shader) => {
    shader.uniforms.uTime = sh.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vPileY; varying vec3 vPileW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nvec4 envPW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);\n#else\nvec4 envPW = modelMatrix * vec4(transformed, 1.0);\n#endif\nvPileY = envPW.y; vPileW = envPW.xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + TIMBER_PARS).replace('#include <map_fragment>', TIMBER_MAP);
  });
  // unit pile: y 0..1, radius PILE_R; instances scale y to the pile height
  const pileGeo = new THREE.CylinderGeometry(PILE_R * 0.9, PILE_R, 1, 7, 1, false);
  pileGeo.translate(0, 0.5, 0);
  const box = new THREE.BoxGeometry(1, 1, 1);

  function inTile(tile: Tile, x: number, z: number): boolean {
    const ox = tile.tx * TILE_SIZE, oz = tile.tz * TILE_SIZE;
    return x >= ox && x < ox + TILE_SIZE && z >= oz && z < oz + TILE_SIZE;
  }
  function inWater(tile: Tile, x: number, z: number): boolean {
    for (const w of tile.water) if (pointInPolygon(x, z, w)) return true;
    return false;
  }
  /** deck root snapped to the tile's shoreline along the pier axis (falls back to the table estimate) */
  function snapRoot(tile: Tile, est: THREE.Vector2): THREE.Vector2 {
    if (!inTile(tile, est.x, est.y) || !tile.water.length) return est;
    for (let t = -60; t <= 60; t += 1.5) {
      const x = est.x + AXIS.x * t, z = est.y + AXIS.y * t;
      if (inTile(tile, x, z) && inWater(tile, x, z)) return new THREE.Vector2(x, z);
    }
    return est;
  }
  function pushBox(into: { pos: number[]; nrm: number[]; col: number[]; idx: number[] }, cx: number, cy: number, cz: number, len: number, wid: number, h: number, top: THREE.Color, side: THREE.Color): void {
    const g = box.clone();
    g.scale(len, h, wid);
    g.rotateY(Math.atan2(-AXIS.y, AXIS.x));
    g.translate(cx, cy, cz);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const base = into.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      into.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      into.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      const c = n.getY(i) > 0.5 ? top : side;
      into.col.push(c.r, c.g, c.b);
    }
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) into.idx.push(base + ix.getX(i));
    g.dispose();
  }
  function toGeometry(b: { pos: number[]; nrm: number[]; col: number[]; idx: number[] }): THREE.BufferGeometry | null {
    if (!b.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
    g.setIndex(b.idx);
    g.computeBoundingSphere();
    return g;
  }

  function build(tile: Tile): THREE.Group | null {
    if (!tile.water.length) return null;
    const ox = tile.tx * TILE_SIZE, oz = tile.tz * TILE_SIZE;
    const near = (p: THREE.Vector2, r: number) => p.x > ox - r && p.x < ox + TILE_SIZE + r && p.y > oz - r && p.y < oz + TILE_SIZE + r;
    const decks = { pos: [] as number[], nrm: [] as number[], col: [] as number[], idx: [] as number[] };
    const sheds = { pos: [] as number[], nrm: [] as number[], col: [] as number[], idx: [] as number[] };
    const piles: { x: number; z: number; h: number; tilt: number; yaw: number }[] = [];
    const deckTop = new THREE.Color(0x83837b), deckSide = new THREE.Color(0x4a4a45);
    const shedTop = new THREE.Color(0x8c8d88), shedSide = new THREE.Color(0xb3b4ae);
    const hullTop = new THREE.Color(0x5e6166), hullSide = new THREE.Color(0x4c5055);
    for (const p of PIERS) {
      const est = rootOf(p);
      if (!near(est, p.length + 80)) continue;
      const root = snapRoot(tile, est);
      const seed = rng(Math.round(p.street * 10));
      const at = (along: number, across: number) => new THREE.Vector2(root.x + AXIS.x * along + NORTH.x * across, root.y + AXIS.y * along + NORTH.y * across);
      // deck: 25 m into the land (hidden under the ground) to the pier head
      const deckC = at((p.length - 25) / 2, 0);
      if (inTile(tile, deckC.x, deckC.y)) pushBox(decks, deckC.x, DECK_TOP - DECK_THICK / 2, deckC.y, p.length + 25, p.width, DECK_THICK, deckTop, deckSide);
      if (p.shed) {
        const c = at((p.length + 10) / 2 - 8, 0);
        if (inTile(tile, c.x, c.y)) {
          pushBox(sheds, c.x, DECK_TOP + p.shed / 2, c.y, p.length - 30, p.width - 8, p.shed, shedTop, shedSide);
          // clerestory / roof monitor
          pushBox(sheds, c.x, DECK_TOP + p.shed + 1.2, c.y, p.length - 60, p.width * 0.35, 2.4, shedTop, shedSide);
        }
      }
      if (p.carrier) {
        // USS Intrepid along the north side: hull to the waterline, flight deck overhang, island
        const c = at(p.length / 2 + 15, p.width / 2 + 20);
        if (inTile(tile, c.x, c.y)) {
          pushBox(decks, c.x, WATER_LEVEL + 9, c.y, 250, 28, 18.5, hullTop, hullSide);
          pushBox(decks, c.x, WATER_LEVEL + 19.5, c.y, 262, 42, 3, hullTop, hullSide);
          const isl = at(p.length / 2 + 45, p.width / 2 + 20 + 16);
          pushBox(decks, isl.x, WATER_LEVEL + 29, isl.y, 34, 8, 16, hullTop, hullSide);
        }
      }
      // pile heights are measured from the common base 1.2 m below the water surface
      const base = WATER_LEVEL - 1.2;
      const fenderH = DECK_TOP + 0.5 - base, dolphinH = DECK_TOP + 1.8 - base;
      const addPile = (q: THREE.Vector2, h: number, tilt: number) => {
        if (inTile(tile, q.x, q.y) && inWater(tile, q.x, q.y)) piles.push({ x: q.x, z: q.y, h, tilt, yaw: seed() * Math.PI * 2 });
      };
      // timber fender piles along both long faces and the head, in bents every 2.6 m, tops just above the deck edge
      for (let s = 8; s <= p.length; s += 2.6) {
        addPile(at(s, p.width / 2 + 0.3), fenderH + seed() * 0.15, seed() * 0.04);
        addPile(at(s, -p.width / 2 - 0.3), fenderH + seed() * 0.15, seed() * 0.04);
      }
      for (let w = -p.width / 2 + 1.3; w < p.width / 2; w += 2.6) addPile(at(p.length + 0.3, w), fenderH + seed() * 0.15, seed() * 0.04);
      // dolphins: clusters of 5 piles off each head corner, taller than the deck, leaning in
      for (const side of [1, -1]) {
        const c = at(p.length + 7, side * (p.width / 2 + 3));
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          addPile(new THREE.Vector2(c.x + Math.cos(a) * 0.55, c.y + Math.sin(a) * 0.55), dolphinH + seed() * 0.3, 0.06);
        }
      }
      // old cut-off stumps in rows 7 m off the south face: uneven, some barely above the water
      if (p.stumps) {
        for (let s = 14; s <= p.length - 10; s += 2.2 + seed() * 0.8) {
          const q = at(s + seed() * 0.6, -p.width / 2 - 7 - seed() * 0.8);
          addPile(q, 1.2 + 0.15 + seed() * 0.9, 0.02 + seed() * 0.1);
        }
      }
    }
    const group = new THREE.Group();
    group.name = `env-piers-${tile.key}`;
    const dg = toGeometry(decks);
    if (dg) {
      const m = new THREE.Mesh(dg, deckMat);
      m.castShadow = shadows; m.receiveShadow = true; m.matrixAutoUpdate = false;
      group.add(m);
    }
    const sg = toGeometry(sheds);
    if (sg) {
      const m = new THREE.Mesh(sg, shedMat);
      m.castShadow = shadows; m.receiveShadow = true; m.matrixAutoUpdate = false;
      group.add(m);
    }
    if (piles.length) {
      const inst = new THREE.InstancedMesh(pileGeo, timberMat, piles.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), pos = new THREE.Vector3();
      const base = WATER_LEVEL - 1.2;
      piles.forEach((p, i) => {
        e.set(p.tilt, p.yaw, 0);
        q.setFromEuler(e);
        pos.set(p.x, base, p.z);
        s.set(1, p.h, 1);
        m4.compose(pos, q, s);
        inst.setMatrixAt(i, m4);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = shadows; inst.receiveShadow = true; inst.matrixAutoUpdate = false;
      inst.frustumCulled = true;
      inst.computeBoundingSphere();
      group.add(inst);
    }
    if (!group.children.length) return null;
    group.matrixAutoUpdate = false;
    return group;
  }

  function onDeck(x: number, z: number): boolean {
    for (const p of PIERS) {
      const root = rootOf(p);
      const dx = x - root.x, dz = z - root.y;
      const along = dx * AXIS.x + dz * AXIS.y, across = dx * NORTH.x + dz * NORTH.y;
      if (along > -40 && along < p.length + 3 && Math.abs(across) < p.width / 2 + 1.5) return true;
    }
    return false;
  }

  return {
    build,
    onDeck,
    dispose() {
      deckMat.dispose(); shedMat.dispose(); timberMat.dispose(); pileGeo.dispose(); box.dispose();
    },
  };
}
