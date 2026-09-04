/** Census trees, shared prototypes and compact near/far instance batches. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext } from '@/core/context';
import type { Tile, Tree } from '@shared/world';
import { TILE_SIZE, tileKey } from '@shared/geo';
import { hash2, pointInPolygon, rng } from './geom';
import { ARCHS, type Arch, type BarkKind, type PbrSet, type TexSet } from './textures';
import { chainCompile, type SharedUniforms } from './patch';

/**
 * Per-species silhouette, in units of tree height (y) and crown width (x/z):
 *  plane   the hero: London plane, tall rounded crown on a straight tapered trunk, limbs rise then spread,
 *          leaves in loose layered clusters hung on the twig ends (street / park form)
 *  allee   the same species pleached into the flat-topped ceiling of the Bryant Park allees
 *  locust  fine feathery crown, airy (fewer, smaller cards)
 *  pear    compact dense oval
 *  ginkgo  narrow upright
 *  oak     broad rounded
 */
export type Form = Arch | 'allee';
const FORMS: Form[] = [...ARCHS, 'allee'];
const archOf = (form: Form): Arch => (form === 'allee' ? 'plane' : form);
/** `clusters` counts cross-planed triplets; each is 3 cards, so cards = 3 x clusters (3.8-4x the old flat-card count). */
interface Spec { width: number; bot: number; top: number; clusters: number; card: number; shell: number; bark: BarkKind; branches: number }
const SPECS: Record<Form, Spec> = {
  plane: { width: 0.74, bot: 0.30, top: 1.02, clusters: 158, card: 0.132, shell: 0.20, bark: 'plane', branches: 5 },
  allee: { width: 0.98, bot: 0.44, top: 1.0, clusters: 140, card: 0.146, shell: 0.20, bark: 'plane', branches: 4 },
  locust: { width: 0.60, bot: 0.42, top: 1.0, clusters: 84, card: 0.142, shell: 0.24, bark: 'dark', branches: 8 },
  pear: { width: 0.46, bot: 0.30, top: 1.0, clusters: 100, card: 0.122, shell: 0.18, bark: 'grey', branches: 7 },
  ginkgo: { width: 0.38, bot: 0.34, top: 1.02, clusters: 80, card: 0.128, shell: 0.22, bark: 'grey', branches: 7 },
  oak: { width: 0.70, bot: 0.38, top: 1.0, clusters: 118, card: 0.152, shell: 0.20, bark: 'dark', branches: 9 },
};

function archetype(species: string): Arch {
  const name = species.toLowerCase();
  if (/plane|sycamore|platanus/.test(name)) return 'plane';
  if (/locust|gleditsia|robinia/.test(name)) return 'locust';
  if (/pear|pyrus/.test(name)) return 'pear';
  if (/ginkgo/.test(name)) return 'ginkgo';
  return 'oak';
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const result = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  return result;
}

function branch(a: THREE.Vector3, b: THREE.Vector3, radius: number, taper = 0.55, segments = 7): THREE.BufferGeometry {
  const delta = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(radius * taper, radius, delta.length(), segments);
  // bark repeats ~0.6 m: stretch v along the length so the texture is not smeared vertically
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.6, uv.getY(i) * delta.length() * 14);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/**
 * One leaf cluster: THREE cross-planed cards through a common centre, mutually perpendicular and spun by a
 * random per-cluster rotation. Any view direction meets at least one card at >= 35 deg, so a cluster can never
 * be seen as a flat sliver; three overlapping cards also give the cluster interior volume.
 *
 * Per-card normals are bent most of the way to the crown normal (the ellipsoid normal at the cluster, tilted up
 * because skylight dominates a crown), keeping only a fifth of the card's own facing: the triplet then shades
 * as one lump of leaf mass rather than as three independent quads.
 *
 * aLeaf    = (depth: 0 crown centre .. 1 outer shell, under: 0 canopy bottom .. 1 top, phase: per-cluster wind seed)
 * aCardOff = vertex offset from the cluster centre, so the vertex shader can scale cards per tree instance.
 */
function leafCluster(out: THREE.BufferGeometry[], size: number, pos: THREE.Vector3, cy: number, rx: number, ry: number, depth: number, under: number, random: () => number): void {
  const crown = new THREE.Vector3(pos.x / (rx * rx), (pos.y - cy) / (ry * ry), pos.z / (rx * rx));
  if (crown.lengthSq() < 1e-9) crown.set(0, 1, 0);
  crown.normalize();
  crown.y += 0.32;
  crown.normalize();
  const phase = random();
  const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI));
  const own = new THREE.Vector3();
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(size * (0.82 + random() * 0.42), size * (0.82 + random() * 0.42));
    if (k === 1) g.rotateY(Math.PI / 2);
    else if (k === 2) g.rotateX(Math.PI / 2);
    g.applyQuaternion(spin);
    const local = g.getAttribute('position') as THREE.BufferAttribute;
    const off = new Float32Array(local.array as ArrayLike<number>);
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    own.set(nrm.getX(0), nrm.getY(0), nrm.getZ(0));
    if (own.dot(crown) < 0) own.negate();
    const n = crown.clone().addScaledVector(own, 0.24).normalize();
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, n.x, n.y, n.z);
    const d = new Float32Array(nrm.count * 3);
    for (let i = 0; i < nrm.count; i++) { d[i * 3] = depth; d[i * 3 + 1] = under; d[i * 3 + 2] = phase; }
    g.setAttribute('aLeaf', new THREE.BufferAttribute(d, 3));
    g.setAttribute('aCardOff', new THREE.BufferAttribute(off, 3));
    g.translate(pos.x, pos.y, pos.z);
    out.push(g);
  }
}

/** Far LOD: three crossed crown cards keep the seeded yaw; normals face out so they shade like a volume. */
function farCards(s: Spec): THREE.BufferGeometry {
  const cy = (s.top + s.bot) / 2, ry = (s.top - s.bot) / 2, rx = s.width / 2;
  const far: THREE.BufferGeometry[] = [];
  for (const [x, k, yaw] of [[0, 1.0, 0], [-rx * 0.12, 0.92, Math.PI / 3], [rx * 0.12, 0.92, -Math.PI / 3]]) {
    const g = new THREE.PlaneGeometry(s.width * k * 1.08, (s.top - s.bot) * k * 1.12);
    g.rotateY(yaw);
    g.translate(x, cy + 0.02, 0);
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const leaf = new Float32Array(nrm.count * 3);
    for (let i = 0; i < nrm.count; i++) {
      const n = new THREE.Vector3(pos.getX(i) / rx, (pos.getY(i) - cy) / ry + 0.3, pos.getZ(i) / rx).normalize();
      nrm.setXYZ(i, n.x, n.y, n.z);
      leaf[i * 3] = 1; leaf[i * 3 + 1] = THREE.MathUtils.clamp((pos.getY(i) - s.bot) / (s.top - s.bot), 0, 1); leaf[i * 3 + 2] = 0;
    }
    g.setAttribute('aLeaf', new THREE.BufferAttribute(leaf, 3));
    // the far LOD has no per-card scaling: zeros keep the attribute layout identical to the near batches
    g.setAttribute('aCardOff', new THREE.BufferAttribute(new Float32Array(nrm.count * 3), 3));
    far.push(g);
  }
  return merge(far);
}

interface Proto { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry; far: THREE.BufferGeometry; seeds: THREE.BufferGeometry | null }

/** Generic species: straight trunk, a whorl of forking scaffold limbs, leaf cards on the crown shell. */
function genericPrototype(arch: Arch): Proto {
  const s = SPECS[arch], random = rng(arch.charCodeAt(0) * 31 + arch.length);
  const trunkR = arch === 'pear' || arch === 'ginkgo' ? 0.016 : 0.02;
  const wood = [
    branch(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0, 0.05, 0), trunkR * 1.45, 0.72), // root flare
    branch(new THREE.Vector3(0, 0.045, 0), new THREE.Vector3(0, s.bot + 0.12, 0), trunkR, 0.62),
  ];
  const leaves: THREE.BufferGeometry[] = [];
  const cy = (s.top + s.bot) / 2, ry = (s.top - s.bot) / 2, rx = s.width / 2;
  // scaffold limbs from the upper trunk into the crown, each forking twice
  for (let i = 0; i < s.branches; i++) {
    const angle = i * 2.399 + random() * 0.4;
    const y0 = s.bot - 0.06 + (i / s.branches) * 0.22;
    const a = new THREE.Vector3(0, y0, 0);
    const reach = 0.3 + random() * 0.35;
    const b = new THREE.Vector3(Math.sin(angle) * rx * reach, y0 + 0.16 + random() * 0.2, Math.cos(angle) * rx * reach);
    wood.push(branch(a, b, trunkR * 0.42));
    for (let j = 0; j < 2; j++) {
      const c = b.clone().add(new THREE.Vector3((random() - 0.5) * rx * 0.6, 0.06 + random() * 0.12, (random() - 0.5) * rx * 0.6));
      wood.push(branch(b, c, trunkR * 0.2));
      // only a third of the outermost twigs get geometry, and short: the rest live inside the leaf mass
      for (let k = 0; k < 2; k++) {
        if (random() > 0.34) continue;
        const d = c.clone().add(new THREE.Vector3((random() - 0.5) * rx * 0.26, 0.02 + random() * 0.05, (random() - 0.5) * rx * 0.26));
        wood.push(branch(c, d, trunkR * 0.07, 0.55, 5));
      }
    }
  }
  // leaf clusters through the whole crown volume, densest at the shell (r ~ u^0.35), biased upward
  for (let i = 0; i < s.clusters; i++) {
    const u = random() * 2 - 1, phi = random() * Math.PI * 2;
    const y = Math.sign(u) * Math.pow(Math.abs(u), 0.8);
    const r = Math.sqrt(1 - y * y);
    const shell = s.shell + (1 - s.shell) * Math.pow(random(), 0.35);
    const pos = new THREE.Vector3(Math.cos(phi) * r * rx * shell, cy + y * ry * shell, Math.sin(phi) * r * rx * shell);
    leafCluster(leaves, s.card * (0.85 + random() * 0.4), pos, cy, rx, ry, shell, (y + 1) / 2, random);
  }
  return { wood: merge(wood), leaves: merge(leaves), far: farCards(s), seeds: null };
}

/**
 * London plane (Platanus x acerifolia). Tapered trunk with a slight lean, 3 tiers of limbs: scaffolds that rise
 * steeply then spread, secondaries, and twigs that carry the leaf clusters (so foliage hangs on structure and the
 * limbs show through the crown). The allee form is pleached: shorter rise, limbs flattened into a level ceiling,
 * cards clipped to a flat top. Seed balls hang in pairs from a few twig ends.
 */
function planePrototype(form: 'plane' | 'allee'): Proto {
  const s = SPECS[form], allee = form === 'allee', random = rng(allee ? 1201 : 907);
  const r0 = allee ? 0.019 : 0.016;
  const cy = (s.top + s.bot) / 2, ry = (s.top - s.bot) / 2, rx = s.width / 2;
  const wood: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  const seeds: THREE.BufferGeometry[] = [];
  const clusters: THREE.Vector3[] = [];
  const tips: THREE.Vector3[] = [];
  // trunk: tapered, nodes drift a little so it is not a lathe column
  const tipY = s.bot + 0.12;
  const rT = (y: number) => r0 * THREE.MathUtils.lerp(1, 0.55, THREE.MathUtils.clamp(y / tipY, 0, 1));
  wood.push(branch(new THREE.Vector3(0, -0.02, 0), new THREE.Vector3(0, 0.05, 0), r0 * 1.55, 0.68, 9));
  const nodes = [0.045, 0.15, s.bot * 0.62, s.bot - 0.03, tipY];
  let prev = new THREE.Vector3(0, nodes[0], 0), lean = new THREE.Vector2((random() - 0.5) * 0.02, (random() - 0.5) * 0.02);
  const trunkAt = (y: number) => new THREE.Vector3(lean.x * y / tipY, y, lean.y * y / tipY);
  for (let i = 1; i < nodes.length; i++) {
    const next = trunkAt(nodes[i]).add(new THREE.Vector3((random() - 0.5) * 0.004, 0, (random() - 0.5) * 0.004));
    wood.push(branch(prev, next, rT(prev.y), rT(nodes[i]) / rT(prev.y), 9));
    prev = next;
  }
  const dirOf = (yaw: number, pitch: number) => new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
  // keep the crown inside its silhouette: pull a point toward the axis if it leaves the ellipsoid, clip the flat top
  const contain = (p: THREE.Vector3, limit = 0.86) => {
    if (allee && p.y > s.top - 0.04) p.y = s.top - 0.04 - random() * 0.03;
    const e = Math.sqrt((p.x / rx) ** 2 + ((p.y - cy) / ry) ** 2 + (p.z / rx) ** 2);
    if (e > limit) { p.x /= e / limit; p.z /= e / limit; p.y = cy + (p.y - cy) / (e / limit); }
    return p;
  };
  const limb = (a: THREE.Vector3, dir: THREE.Vector3, len: number, radius: number, taper: number, segs: number, limit = 0.86) => {
    const b = contain(a.clone().addScaledVector(dir, len), limit);
    wood.push(branch(a, b, radius, taper, segs));
    return b;
  };
  const N = s.branches;
  for (let i = 0; i < N; i++) {
    // tier 1: scaffold limb, rises steeply then spreads (pleached: rises short, then runs level)
    const yaw = i * (Math.PI * 2 / N) + (random() - 0.5) * 0.7;
    const y0 = THREE.MathUtils.lerp(s.bot - 0.04, s.bot + 0.1, i / Math.max(1, N - 1));
    const a = trunkAt(y0);
    const rise = dirOf(yaw, (allee ? 1.05 : 0.95) + (random() - 0.5) * 0.25);
    const b = limb(a, rise, (allee ? 0.1 : 0.15) + random() * 0.07, r0 * 0.5, 0.72, 7);
    const spread = dirOf(yaw + (random() - 0.5) * 0.5, (allee ? 0.05 : 0.38) + (random() - 0.5) * 0.2);
    const c = limb(b, spread, (allee ? 0.24 : 0.2) + random() * 0.1, r0 * 0.36, 0.62, 7);
    // tier 2: secondaries off the elbow and the end, alternating sides
    const seconds: { p: THREE.Vector3; yaw: number }[] = [];
    for (const [from, count] of [[b, 1], [c, 2]] as [THREE.Vector3, number][]) {
      for (let j = 0; j < count; j++) {
        const side = (i + j) % 2 === 0 ? 1 : -1;
        const yaw2 = yaw + side * (0.4 + random() * 0.6);
        const pitch2 = allee ? random() * 0.15 : 0.3 + random() * 0.45;
        const d = limb(from, dirOf(yaw2, pitch2), 0.1 + random() * 0.08, r0 * 0.17, 0.6, 6, 0.74);
        seconds.push({ p: d, yaw: yaw2 });
        clusters.push(from.clone().lerp(d, 0.55), d);
      }
    }
    // tier 3: twigs. Every end carries leaf clusters, but only a third are drawn as wood - inside a crown this
    // dense the twigs are buried, and the ones that stay are the ones that naturally emerge at the edge.
    for (const sec of seconds) {
      for (let k = 0; k < 3; k++) {
        const side = k === 1 ? -1 : 1;
        const pitch3 = allee ? (random() - 0.35) * 0.4 : 0.15 + random() * 0.55;
        const dir = dirOf(sec.yaw + side * (0.3 + random() * 0.6) + k * 0.35, pitch3);
        const len = 0.05 + random() * 0.05;
        const e = contain(sec.p.clone().addScaledVector(dir, len), 0.8);
        if (random() < 0.34) wood.push(branch(sec.p, e, r0 * 0.075, 0.5, 5));
        tips.push(e);
        clusters.push(e);
      }
    }
  }
  const under = (y: number) => THREE.MathUtils.clamp((y - s.bot) / (s.top - s.bot), 0, 1);
  const depthOf = (p: THREE.Vector3) => THREE.MathUtils.clamp(Math.sqrt((p.x / rx) ** 2 + ((p.y - cy) / ry) ** 2 + (p.z / rx) ** 2), 0.12, 1);
  const cluster = (pos: THREE.Vector3, k: number) => {
    leafCluster(leaves, s.card * k * (0.82 + random() * 0.42), pos, cy, rx, ry, depthOf(pos), under(pos.y), random);
  };
  // foliage hung on the structure: 2-3 clusters at each twig end, one at the secondaries' midpoints
  for (const p of clusters) {
    const n = tips.includes(p) ? 2 + (random() < 0.5 ? 1 : 0) : 1;
    for (let j = 0; j < n; j++) cluster(contain(p.clone().add(new THREE.Vector3((random() - 0.5) * 0.1, (random() - 0.6) * 0.05, (random() - 0.5) * 0.1)), 1.0), 1);
  }
  // volume fill up to the cluster budget, weighted to the sunlit upper half; the allee gets a level top layer
  for (let i = leaves.length / 3; i < s.clusters; i++) {
    const u = random() * 2 - 1, phi = random() * Math.PI * 2;
    let y = Math.sign(u) * Math.pow(Math.abs(u), allee ? 0.6 : 0.8);
    if (allee) y = Math.min(y, 0.85);
    const r = allee ? Math.sqrt(1 - Math.pow(Math.max(0, y), 4)) * (1 - 0.5 * Math.max(0, -y)) : Math.sqrt(1 - y * y);
    const shell = s.shell + (1 - s.shell) * Math.pow(random(), 0.35);
    const pos = new THREE.Vector3(Math.cos(phi) * r * rx * shell, cy + y * ry * shell, Math.sin(phi) * r * rx * shell);
    cluster(pos, 1);
  }
  // seed balls: pairs on a stalk below a few twig ends
  for (const p of tips) {
    if (random() > 0.45) continue;
    const g = new THREE.PlaneGeometry(0.014, 0.026);
    g.rotateY(random() * Math.PI * 2);
    g.translate(p.x + (random() - 0.5) * 0.01, p.y - 0.016, p.z + (random() - 0.5) * 0.01);
    seeds.push(g);
  }
  return { wood: merge(wood), leaves: merge(leaves), far: farCards(s), seeds: seeds.length ? merge(seeds) : null };
}

const prototype = (form: Form): Proto => (form === 'plane' || form === 'allee' ? planePrototype(form) : genericPrototype(form));

/** small Canvas2D textures for the seed balls and the litter decal; null when there is no DOM (tests) */
function canvasTexture(size: number, draw: (c: CanvasRenderingContext2D, S: number) => void): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
  if (!c) return null;
  draw(c, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

function seedTexture(): THREE.Texture | null {
  return canvasTexture(64, (c, S) => {
    c.clearRect(0, 0, S, S);
    c.strokeStyle = 'rgb(84,66,40)';
    c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(S * 0.5, 0); c.lineTo(S * 0.48, S * 0.34); c.lineTo(S * 0.6, S * 0.72); c.stroke();
    for (const [x, y, r] of [[0.48, 0.42, 0.17], [0.6, 0.8, 0.15]]) {
      const g = c.createRadialGradient(S * (x - r * 0.3), S * (y - r * 0.3), S * r * 0.1, S * x, S * y, S * r);
      g.addColorStop(0, 'rgb(150,132,84)');
      g.addColorStop(1, 'rgb(74,60,36)');
      c.fillStyle = g;
      c.beginPath(); c.arc(S * x, S * y, S * r, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(40,30,18,0.5)';
      for (let i = 0; i < 10; i++) { const a = i * 0.63, rr = r * (0.3 + 0.55 * ((i * 7) % 5) / 5); c.beginPath(); c.arc(S * (x + Math.cos(a) * rr), S * (y + Math.sin(a) * rr), 1.1, 0, Math.PI * 2); c.fill(); }
    }
  });
}

/** Fixed-size, separated leaves on a world grid: adjacent tree decals cannot form ochre clumps. */
export function litterLeaves(x: number, z: number, crownWidth: number, form: Form) {
  const leaves: { key: string; x: number; z: number; size: number; yaw: number }[] = [];
  if (form !== 'plane' && form !== 'allee' && form !== 'oak') return leaves;
  const radius = crownWidth * 0.2, step = 0.28;
  for (let ix = Math.ceil((x - radius) / step); ix <= Math.floor((x + radius) / step); ix++) {
    for (let iz = Math.ceil((z - radius) / step); iz <= Math.floor((z + radius) / step); iz++) {
      if (hash2(ix, iz, 42) > 0.12) continue;
      const lx = ix * step + (hash2(ix, iz, 43) - 0.5) * 0.04;
      const lz = iz * step + (hash2(ix, iz, 44) - 0.5) * 0.04;
      const size = 0.05 + hash2(ix, iz, 45) * 0.04;
      const distance = Math.hypot(lx - x, lz - z);
      // The entire rotated card stays within a patch <= 0.4 times the crown width.
      if (distance < 0.3 || distance + size / Math.SQRT2 > radius) continue;
      leaves.push({ key: `${ix}:${iz}`, x: lx, z: lz, size, yaw: hash2(ix, iz, 46) * Math.PI * 2 });
    }
  }
  return leaves;
}

function litterTexture(): THREE.Texture | null {
  return canvasTexture(128, (c, S) => {
    c.clearRect(0, 0, S, S);
    // One lobed leaf, normalized to the card bounds; scale comes from metres, never crown size.
    const points = Array.from({ length: 40 }, (_, k) => {
      const th = k / 40 * Math.PI * 2;
      const r = 0.58 + 0.42 * Math.pow(Math.abs(Math.cos(2.5 * th)), 0.55);
      return [Math.sin(th) * r, -Math.cos(th) * r];
    });
    const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
    c.fillStyle = 'rgb(138,105,57)';
    c.beginPath();
    points.forEach(([x, y], i) => {
      const px = 1 + (x - minX) / (maxX - minX) * (S - 2);
      const py = 1 + (y - minY) / (maxY - minY) * (S - 2);
      if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    });
    c.closePath(); c.fill();
  });
}

/** A batch owns its instance buffer, but not the shared prototype or material. */
class Batch {
  mesh: THREE.InstancedMesh | null = null;
  count = 0;
  private baseBounds = new THREE.Sphere();
  private maxScale = 0;
  private windRadius = 0;
  private windUnitRadius = 0;
  private cardUnitPad = 0;
  constructor(private parent: THREE.Group, private geo: THREE.BufferGeometry, public mat: THREE.Material, private name: string, private shadows: boolean) {
    const leaves = geo.getAttribute('aLeaf');
    if (leaves) {
      geo.computeBoundingBox();
      const box = geo.boundingBox!, height = Math.max(Math.abs(box.min.y), Math.abs(box.max.y));
      let maxLeaf = 0;
      for (let i = 0; i < leaves.count; i++) maxLeaf = Math.max(maxLeaf, Math.abs(leaves.getX(i)));
      // |lean + sway + .45 flutter| <= 2.40. Wind is applied in prototype space,
      // before the instance transform. Sum the horizontal and vertical bounds.
      this.windUnitRadius = 2.4 * 0.0015 * height * height + 0.0025 * maxLeaf * height;
      // the per-tree card scale pushes a vertex out by at most 0.17 of its offset from the cluster centre
      const off = geo.getAttribute('aCardOff');
      let maxOff = 0;
      if (off) for (let i = 0; i < off.count; i++) maxOff = Math.max(maxOff, Math.hypot(off.getX(i), off.getY(i), off.getZ(i)));
      this.cardUnitPad = maxOff * 0.17;
    }
  }
  add(matrix: THREE.Matrix4, color: THREE.Color): void {
    if (this.count === 0) this.maxScale = 0;
    this.maxScale = Math.max(this.maxScale, matrix.getMaxScaleOnAxis());
    if (!this.mesh || this.count >= this.mesh.instanceMatrix.count) {
      const old = this.mesh;
      const mesh = new THREE.InstancedMesh(this.geo, this.mat, old ? old.instanceMatrix.count * 2 : 128);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.name = this.name;
      mesh.castShadow = this.shadows;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      if (old) {
        mesh.instanceMatrix.array.set(old.instanceMatrix.array);
        mesh.setColorAt(0, color);
        if (old.instanceColor) mesh.instanceColor!.array.set(old.instanceColor.array);
        this.parent.remove(old);
        old.dispose();
      }
      this.parent.add(mesh);
      this.mesh = mesh;
    }
    this.mesh.setMatrixAt(this.count, matrix);
    this.mesh.setColorAt(this.count++, color);
  }
  /** Compile the same instancing/color/shadow variant before any tiles arrive. */
  sample(): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, 1);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.castShadow = this.shadows;
    mesh.receiveShadow = true;
    return mesh;
  }
  finish(): void {
    if (!this.mesh) return;
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.boundingSphere!.radius += this.maxScale * this.cardUnitPad;
    this.baseBounds.copy(this.mesh.boundingSphere!);
    this.windRadius = this.maxScale * this.windUnitRadius;
  }
  windBounds(speed: number): void {
    if (!this.mesh || !this.count) return;
    this.mesh.boundingSphere!.radius = this.baseBounds.radius + this.windRadius * speed;
  }
  dispose(): void {
    if (this.mesh) { this.parent.remove(this.mesh); this.mesh.dispose(); }
    this.geo.dispose();
    this.mat.dispose();
  }
}

interface TreeRecord { tree: Tree; form: Form; matrix: THREE.Matrix4; tint: THREE.Color; street: boolean; guard: boolean; pitYaw: number; litter: ReturnType<typeof litterLeaves> }

/** Tree pits run along the curb: the yaw of the nearest street segment within 12 m (0 when none: square-ish park edge). */
function pitYawFor(tile: Tile, x: number, z: number): number {
  let best = 12 * 12, yaw = 0;
  for (const road of tile.roads) {
    if (road.tunnel) continue;
    const pts = road.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const d = (a[0] + t * dx - x) ** 2 + (a[1] + t * dz - z) ** 2;
      if (d < best) { best = d; yaw = Math.atan2(-dz, dx); }
    }
  }
  return yaw;
}
const PIT_L = 2.4, PIT_W = 1.5;
/** sidewalk paving height (streets/sidewalk.ts WALK_Y) plus a hair: a pit below the flags is invisible */
const PIT_Y = 0.15 + 0.006;

export function createTrees(ctx: GameContext, parent: THREE.Group, tex: TexSet, sh: SharedUniforms, setup: (m: THREE.Material) => void) {
  const tiles = new Map<string, TreeRecord[]>();
  const allBatches: Batch[] = [];
  const batches = new Map<Form, { wood: Batch; leaves: Batch; far: Batch; seeds: Batch | null }>();
  const sun = { value: ctx.time.sunDir };
  const ownedTextures: THREE.Texture[] = [];
  const makeBatch = (g: THREE.BufferGeometry, m: THREE.Material, name: string, shadows = false) => {
    setup(m);
    const b = new Batch(parent, g, m, name, shadows && ctx.quality.shadows);
    allBatches.push(b);
    return b;
  };
  const makeLeaves = (map: THREE.Texture, far: boolean) => {
    const mat = new THREE.MeshStandardMaterial({ map, alphaTest: far ? 0.45 : 0.4, side: THREE.DoubleSide, roughness: 0.85 });
    chainCompile(mat, far ? 'env-tree-crown-v4' : 'env-tree-leaves-v4', (shader) => {
      Object.assign(shader.uniforms, { uTime: sh.uTime, uWind: sh.uWind, uWetness: sh.uWetness, uTreeSun: sun });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec2 uWind; attribute vec3 aLeaf; attribute vec3 aCardOff; varying vec3 vLeaf;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vLeaf = aLeaf;
          vec3 treeOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          // per-tree card scale: the same prototype reads as a coarser or finer canopy tree to tree
          float treeCardK = 0.87 + 0.30 * fract(sin(dot(treeOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);
          transformed += aCardOff * (treeCardK - 1.0);
          // three tiers: the whole crown leans slowly, the limbs sway, each cluster flutters on its own phase
          float treeLean = sin(uTime * 0.55 + treeOrigin.x * 0.05 + treeOrigin.z * 0.07);
          float treeSway = 0.62 * sin(uTime * 1.9 + treeOrigin.x * 0.31 + position.y * 3.2) + 0.33 * sin(uTime * 3.1 + treeOrigin.z * 0.27 + position.y * 6.0);
          float treeFlutter = sin(uTime * 4.6 + aLeaf.z * 6.2832);
          float treeWind = length(uWind);
          transformed.xz += (treeLean + treeSway + 0.45 * treeFlutter) * uWind * 0.0015 * position.y * position.y;
          transformed.y += treeFlutter * treeWind * 0.0025 * aLeaf.x * position.y;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWetness; uniform vec3 uTreeSun; varying vec3 vLeaf;')
        // crown-volume normals: never flip for back faces, the card is a proxy for the leaf mass around it
        .replace('#include <normal_fragment_begin>', 'vec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          // canopy self-shadow: leaf mass blocks sky and sun toward the crown centre and under the crown
          float treeOcc = mix(0.30, 1.0, smoothstep(0.05, 0.95, vLeaf.x)) * mix(0.48, 1.0, smoothstep(0.0, 0.78, vLeaf.y));
          // the sun reaches the interior even less than the sky does; a card seen from its back is the dull underside
          diffuseColor.rgb *= mix(1.0, treeOcc, 0.45) * (1.0 - 0.22 * uWetness);
          if (!gl_FrontFacing) diffuseColor.rgb *= vec3(0.82, 0.84, 0.78);`)
        // AO on the indirect term only, so the crown keeps a lit shell over a dark interior instead of going flat
        .replace('#include <aomap_fragment>', `reflectedLight.indirectDiffuse *= treeOcc;
          reflectedLight.indirectSpecular *= mix(1.0, treeOcc, 0.7);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // sun through the leaf: strongest when the leaf is between the eye and the sun (backlit), yellow-green
          vec3 treeLight = normalize((viewMatrix * vec4(uTreeSun, 0.0)).xyz);
          float treeBack = max(0.0, dot(-normalize(vViewPosition), treeLight));
          float treeUnder = 1.0 - 0.55 * max(0.0, dot(normal, treeLight));
          float treeThin = mix(0.72, 1.0, vLeaf.y) * (gl_FrontFacing ? 0.85 : 1.0) * vLeaf.x;
          // the far crown card already averages a whole canopy's worth of leaves, so it transmits far less than a shell card
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.5, 1.34, 0.42) * (0.06 + ${far ? '0.24' : '0.85'} * treeBack * treeBack * treeBack) * treeUnder * treeThin * clamp(uTreeSun.y * 3.0, 0.0, 1.0);`);
    });
    return mat;
  };
  const seedMap = seedTexture(), litterMap = litterTexture();
  if (seedMap) ownedTextures.push(seedMap);
  if (litterMap) ownedTextures.push(litterMap);
  for (const form of FORMS) {
    const proto = prototype(form), arch = archOf(form), bark = tex.bark[SPECS[form].bark];
    batches.set(form, {
      wood: makeBatch(proto.wood, new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normal, roughnessMap: bark.rough ?? null, roughness: 0.95 }), `env-tree-${form}-wood`, true),
      leaves: makeBatch(proto.leaves, makeLeaves(tex.leaves[arch], false), `env-tree-${form}-leaves`, true),
      far: makeBatch(proto.far, makeLeaves(tex.crowns[arch], true), `env-tree-${form}-far`),
      seeds: proto.seeds ? makeBatch(proto.seeds, new THREE.MeshStandardMaterial({ map: seedMap ?? undefined, color: seedMap ? 0xffffff : 0x5a4a2c, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), `env-tree-${form}-seeds`) : null,
    });
  }
  // NYC tree pit: 5 x 8 ft of mulch along the curb (ART_DIRECTION §5), half of them with a black iron guard
  const pitGeo = new THREE.PlaneGeometry(PIT_L, PIT_W).rotateX(-Math.PI / 2);
  const pits = makeBatch(pitGeo, new THREE.MeshStandardMaterial({ map: tex.soil.map, normalMap: tex.soil.normal, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'env-tree-pits');
  // Individual 5–9 cm leaf decals; one shared draw, sparse under planes/oaks only.
  const litter = litterMap ? makeBatch(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: litterMap, transparent: true, opacity: 0.8, alphaTest: 0.12, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), 'env-tree-litter') : null;
  const rails: THREE.BufferGeometry[] = [];
  const hl = PIT_L / 2, hw = PIT_W / 2;
  for (const side of [-1, 1]) {
    for (const h of [0.16, 0.46]) {
      rails.push(new THREE.BoxGeometry(PIT_L, 0.028, 0.028).translate(0, h, side * hw));
      rails.push(new THREE.BoxGeometry(0.028, 0.028, PIT_W).translate(side * hl, h, 0));
    }
    for (const side2 of [-1, 1]) rails.push(new THREE.BoxGeometry(0.04, 0.52, 0.04).translate(side * hl, 0.26, side2 * hw));
    // pickets between the rails
    for (let i = -3; i <= 3; i++) rails.push(new THREE.BoxGeometry(0.014, 0.3, 0.014).translate(i * 0.32, 0.31, side * hw));
    for (let i = -2; i <= 2; i++) rails.push(new THREE.BoxGeometry(0.014, 0.3, 0.014).translate(side * hl, 0.31, i * 0.3));
  }
  const guards = makeBatch(merge(rails), new THREE.MeshStandardMaterial({ color: 0x141614, roughness: 0.55, metalness: 0.75 }), 'env-tree-guards');
  const obj = new THREE.Object3D(), white = new THREE.Color(1, 1, 1);
  let dirty = true, lastAt = -Infinity;
  const lastCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  const near = (ctx.quality.level === 'low' || ctx.quality.level === 'mobile') ? 65 : ctx.quality.level === 'medium' ? 90 : 120;
  const detail = Math.min(near, 70); // seed balls and litter: the close band only
  const far = Math.min(800, ctx.quality.drawDistance);
  /** species form: OSM park trees carry no species; Bryant Park's are the pleached plane allees, elsewhere half are planes */
  const formFor = (tree: Tree, park: boolean): Form => {
    const arch = archetype(tree.species);
    if (tree.species.toLowerCase() !== 'tree' || !park) return arch;
    const safe = sh.uSafe.value;
    if (Math.hypot(tree.x - safe.x, tree.z - safe.z) < safe.z + 90) return 'allee';
    return hash2(tree.x, tree.z, 8) < 0.5 ? 'plane' : 'oak';
  };
  return {
    addTile(tile: Tile) {
      const records: TreeRecord[] = [];
      for (const tree of tile.trees) {
        if (![tree.x, tree.z, tree.dbh, tree.height].every(Number.isFinite)) continue;
        const park = tile.parks.some(p => pointInPolygon(tree.x, tree.z, p));
        const form = formFor(tree, park);
        // DBH is inches. Continuous crown growth avoids three repeated size classes;
        // seeded variation also covers OSM park trees whose DBH/height are both 10.
        const size = THREE.MathUtils.clamp(0.75 + Math.max(0, tree.dbh) * 0.02, 0.8, 1.35);
        const height = THREE.MathUtils.clamp(tree.height * (0.94 + hash2(tree.x, tree.z, 4) * 0.12), 3, 32);
        const width = height * size * (0.9 + hash2(tree.x, tree.z, 5) * 0.2);
        obj.position.set(tree.x, 0, tree.z);
        obj.rotation.set(0, hash2(tree.x, tree.z) * Math.PI * 2, 0);
        obj.scale.set(width, height, width * (0.92 + hash2(tree.x, tree.z, 6) * 0.16));
        obj.updateMatrix();
        // per-tree hue: most a touch different, some yellow-green stressed street trees (planes stay deep green)
        const plane = form === 'plane' || form === 'allee';
        const tint = new THREE.Color().setHSL(0.21 + hash2(tree.x, tree.z, 7) * 0.05, 0.25, (plane ? 0.62 : 0.68) + hash2(tree.x, tree.z, 1) * (plane ? 0.14 : 0.2));
        if (!plane && hash2(tree.x, tree.z, 2) < 0.08) tint.setRGB(1.12, 0.95, 0.65);
        records.push({ tree, form, matrix: obj.matrix.clone(), tint, street: !park, guard: hash2(tree.x, tree.z, 3) < 0.5,
          pitYaw: park ? 0 : pitYawFor(tile, tree.x, tree.z), litter: litterLeaves(tree.x, tree.z, width * SPECS[form].width, form) });
      }
      tiles.set(tile.key, records);
      dirty = true;
    },
    removeTile(key: string) { tiles.delete(key); dirty = true; },
    update(t: number) {
      const camera = ctx.camera.position;
      // Wind can change without a distance/LOD rebuild. Keep all views and
      // shadow cascades conservative even on those frames.
      const wind = sh.uWind.value.length();
      for (const batch of allBatches) batch.windBounds(wind);
      if (!dirty && (t - lastAt < 0.15 || lastCamera.distanceToSquared(camera) < 0.25)) return;
      dirty = false; lastAt = t; lastCamera.copy(camera);
      for (const batch of allBatches) batch.count = 0;
      const drawnLeaves = new Set<string>();
      for (const records of tiles.values()) for (const r of records) {
        const d2 = (r.tree.x - camera.x) ** 2 + (r.tree.z - camera.z) ** 2;
        if (d2 > far * far) continue;
        const b = batches.get(r.form)!;
        if (d2 <= near * near) {
          b.wood.add(r.matrix, white);
          b.leaves.add(r.matrix, r.tint);
          if (d2 <= detail * detail) {
            b.seeds?.add(r.matrix, white);
            if (litter) for (const leaf of r.litter) {
              if (drawnLeaves.has(leaf.key)) continue;
              drawnLeaves.add(leaf.key);
              obj.position.set(leaf.x, 0.034, leaf.z);
              obj.rotation.set(0, leaf.yaw, 0);
              obj.scale.set(leaf.size, 1, leaf.size); obj.updateMatrix();
              litter.add(obj.matrix, white);
            }
          }
          if (r.street) {
            // On the paving (streets/sidewalk.ts WALK_Y = 0.15), a few mm up with polygon offset against z-fighting.
            obj.position.set(r.tree.x, PIT_Y, r.tree.z);
            obj.rotation.set(0, r.pitYaw, 0); obj.scale.set(1, 1, 1); obj.updateMatrix();
            pits.add(obj.matrix, white);
            if (r.guard) guards.add(obj.matrix, white);
          }
        } else {
          b.far.add(r.matrix, r.tint);
        }
      }
      for (const batch of allBatches) { batch.finish(); batch.windBounds(wind); }
    },
    async prepare(compile: (root: THREE.Object3D) => Promise<void>): Promise<void> {
      const samples = new THREE.Group();
      for (const batch of allBatches) samples.add(batch.sample());
      try { await compile(samples); }
      finally { for (const mesh of samples.children) (mesh as THREE.InstancedMesh).dispose(); samples.clear(); }
    },
    /** swap the near leaf-cluster cards (e.g. once the real leaf atlas has loaded) */
    setLeafCards(cards: Record<Arch, THREE.Texture>) {
      for (const form of FORMS) {
        const mat = batches.get(form)!.leaves.mat as THREE.MeshStandardMaterial;
        mat.map = cards[archOf(form)];
        mat.needsUpdate = true;
      }
    },
    /** swap a bark set (loaded CC0 texture) for every species using that bark kind */
    setBark(kind: BarkKind, set: PbrSet) {
      for (const form of FORMS) {
        if (SPECS[form].bark !== kind) continue;
        const mat = batches.get(form)!.wood.mat as THREE.MeshStandardMaterial;
        mat.map = set.map; mat.normalMap = set.normal; mat.roughnessMap = set.rough;
        mat.needsUpdate = true;
      }
    },
    inPit(x: number, z: number): boolean {
      // Include neighbouring tiles when the query straddles a pit at a tile boundary.
      const hl = PIT_L / 2, hw = PIT_W / 2;
      for (let tx = Math.floor((x - hl) / TILE_SIZE); tx <= Math.floor((x + hl) / TILE_SIZE); tx++)
        for (let tz = Math.floor((z - hl) / TILE_SIZE); tz <= Math.floor((z + hl) / TILE_SIZE); tz++)
          for (const r of tiles.get(tileKey(tx, tz)) ?? []) {
            if (!r.street) continue;
            const dx = x - r.tree.x, dz = z - r.tree.z;
            if (dx * dx + dz * dz > hl * hl) continue;
            // into the pit's frame (rotation about y by pitYaw): local x runs along the curb
            const c = Math.cos(r.pitYaw), s = Math.sin(r.pitYaw);
            if (Math.abs(dx * c - dz * s) <= hl && Math.abs(dx * s + dz * c) <= hw) return true;
          }
      return false;
    },
    dispose() { tiles.clear(); for (const batch of allBatches) batch.dispose(); for (const t of ownedTextures) t.dispose(); },
  };
}
