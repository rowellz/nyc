import { basePath as __launchBasePath, mountedFetch as __launchFetch } from '@/core/basePath';
/** Shared CC0 mesh templates. Network/validation failure leaves the procedural path intact. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { RetargetRig, canonicalBone } from './retarget';
import { RIG_HEIGHT, type Palette } from './rig';
import type { Appearance } from './animator';
import { createImportedMaterial } from './materials';

const templates = new Map<string, THREE.Group>();
let loading: Promise<void> | undefined;
export const characterAssetStatus = { loaded: [] as string[], errors: [] as string[] };
const hairNames = ['simpleparted', 'buzzed', 'buzzedfemale', 'long', 'buns', 'beard'];
export async function loadCharacterAssets(): Promise<void> {
  if (new URLSearchParams(location.search).get('characterMesh') === 'procedural') return;
  return loading ??= (async () => {
    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager);
    const timeout = setTimeout(() => manager.abort(), 10000);
    await Promise.all(['civilian-male', 'civilian-female', ...hairNames.map(n => 'hair-' + n)].map(async id => {
      try {
        const gltf = await loader.loadAsync(`${__launchBasePath('/assets')}/characters/${id}.glb`);
        const scene = gltf.scene;
        scene.name = id;
        templates.set(id, scene);
        characterAssetStatus.loaded.push(id);
      } catch (error) { characterAssetStatus.errors.push(`${id}: ${String(error)}`); console.warn('[character] procedural fallback:', id, error); }
    }));
    clearTimeout(timeout);
  })();
}

/** A handful of shared garment cuts, not a geometry allocation per pedestrian. */
const cuts = new Map<string, THREE.BufferGeometry>();
function garmentGeometry(mesh: THREE.SkinnedMesh, appearance: Appearance): THREE.BufferGeometry {
  const key = mesh.geometry.uuid + ':' + appearance.body.sleeves + ':' + appearance.body.legs + ':' + appearance.body.jacket;
  let geometry = cuts.get(key);
  if (geometry) return geometry;
  geometry = mesh.geometry.clone();
  const pos = geometry.getAttribute('position');
  const index = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
  const rest = new Float32Array(pos.count * 3), parts = new Float32Array(pos.count * 4);
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  // rest-pose joints per side for the "t along the arm" parameter (0 shoulder, 1 elbow, 2 wrist)
  const joint = (name: string) => { const b = mesh.skeleton.bones.find(b => canonicalBone(b.name) === name); return b ? new THREE.Vector3().setFromMatrixPosition(b.matrixWorld) : null; };
  const arms = { Left: [joint('LeftArm'), joint('LeftForeArm'), joint('LeftHand')], Right: [joint('RightArm'), joint('RightForeArm'), joint('RightHand')] };
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); p.toArray(rest, i * 3);
    let hand = 0, arm = 0, forearm = 0;
    for (let k = 0; k < 4; k++) {
      const bone = mesh.skeleton.bones[index.getComponent(i, k)];
      const name = canonicalBone(bone?.name ?? '') ?? bone?.name ?? '';
      const weight = weights.getComponent(i, k);
      if (/Hand|thumb|index|middle|ring|pinky/i.test(name)) hand += weight;
      if (/Arm|Shoulder/.test(name)) arm += weight;
      if (/ForeArm/.test(name)) forearm += weight;
    }
    let armT = 0;
    if (arm + hand > 0.3) {
      const [S, E, Wr] = arms[p.x < 0 ? 'Left' : 'Right'];
      if (S && E && Wr) {
        const t1 = d.copy(p).sub(S).dot(E.clone().sub(S)) / E.distanceToSquared(S);
        armT = t1 < 1 ? Math.max(0, t1) : 1 + Math.min(1.3, Math.max(0, d.copy(p).sub(E).dot(Wr.clone().sub(E)) / Wr.distanceToSquared(E)));
      }
    }
    parts.set([hand, arm, forearm, armT], i * 4);
  }
  // Drop fully covered triangles at load time. The fragment cut handles boundary
  // triangles; this saves vertex/shadow work for the hidden anatomical torso/legs.
  const exposed = (i: number) => {
    const y = rest[i * 3 + 1], hand = parts[i * 4], arm = parts[i * 4 + 1], armT = parts[i * 4 + 3];
    if (hand > 0.3 || y > 1.48) return true;
    if (arm > 0.3) return appearance.body.sleeves === 'none' || (appearance.body.sleeves === 'short' && armT > 0.44) || (appearance.body.sleeves === 'long' && armT > 1.8);
    return appearance.body.legs === 'short' && y > 0.10 && y < 0.65; // skirts wear tights, which the wardrobe draws
  };
  const kept: number[] = [], triangles = geometry.index!;
  for (let i = 0; i < triangles.count; i += 3) {
    const a = triangles.getX(i), b = triangles.getX(i + 1), c = triangles.getX(i + 2);
    if (exposed(a) || exposed(b) || exposed(c)) kept.push(a, b, c);
  }
  geometry.setIndex(kept);
  geometry.setAttribute('humanRest', new THREE.BufferAttribute(rest, 3));
  geometry.setAttribute('humanParts', new THREE.BufferAttribute(parts, 4));
  // Only the primary UV set is consumed by our material; avoid uploading artist workspace channels.
  for (const attribute of Object.keys(geometry.attributes)) if (/^(uv[1-9]|color)/.test(attribute)) geometry.deleteAttribute(attribute);
  geometry.computeBoundingSphere(); cuts.set(key, geometry);
  return geometry;
}

export class ImportedCharacter {
  readonly root = new THREE.Group();
  readonly retarget: RetargetRig;
  readonly handSocket = new THREE.Group();
  readonly meshes: THREE.SkinnedMesh[] = [];
  private materials = new Set<THREE.Material>();
  private skeletons = new Set<THREE.Skeleton>();
  constructor(readonly id: string, template: THREE.Group, appearance: Appearance, palette: Palette, driver: Map<string, THREE.Bone>, wetness?: { value: number }, rim?: { value: THREE.Vector4 }, fill?: { value: THREE.Vector4 }) {
    const model = clone(template) as THREE.Group;
    this.root.name = 'imported:' + id;
    // Source faces +Z; the game and all procedural clips face -Z.
    model.rotation.y = Math.PI;
    this.root.add(model);
    this.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const scale = RIG_HEIGHT / (bounds.max.y - bounds.min.y);
    model.scale.multiplyScalar(scale);
    model.position.y = -bounds.min.y * scale;
    this.root.updateMatrixWorld(true);
    model.traverse(n => {
      if (!(n as THREE.SkinnedMesh).isSkinnedMesh) return;
      const mesh = n as THREE.SkinnedMesh;
      const source = mesh.material as THREE.MeshStandardMaterial;
      const body = /Superhero/.test(source.name);
      if (body) {
        mesh.geometry = garmentGeometry(mesh, appearance);
        mesh.material = createImportedMaterial(source, palette, appearance.body, wetness, rim, fill);
      } else {
        const m = source.clone();
        mesh.material = m;
        if (/Hair/.test(source.name)) m.color.set(appearance.colors.hair ?? 0x221810); // eyebrows
        // eyes: wet, so they take a catchlight from the sky / lamps
        if (/Eye/.test(source.name)) { m.roughness = 0.18; m.envMapIntensity = 1.2; }
      }
      this.materials.add(mesh.material);
      this.skeletons.add(mesh.skeleton);
      // A fixed pose-independent envelope avoids per-frame CPU skinning for bounds.
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95 / scale, 0), 2.1 / scale);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.meshes.push(mesh);
    });
    this.retarget = new RetargetRig(this.root, driver);
    const head = this.retarget.mapped.get('Head')!;
    const style = appearance.body.hair;
    const hat = appearance.body.headwear;
    const v = appearance.variant ?? 0;
    // afro / bob / ponytail and a hijab are built as wardrobe shells in rig.ts; the imported hair would poke
    // through them, so those styles wear a buzzed scalp underneath (or nothing at all).
    const shelled = style === 'afro' || style === 'bob' || style === 'ponytail';
    let h: string | null = style === 'long' ? (v % 4 === 0 ? 'buns' : 'long')
      : style === 'bun' ? (v % 5 === 0 ? 'long' : 'buns')
      : style === 'bald' ? (v % 3 === 0 ? 'buzzed' : null)
      : style === 'fade' ? 'buzzed'
      : v % 3 === 0 ? 'buzzed' : 'simpleparted';
    if (shelled || hat === 'hijab') h = 'buzzed';
    if (hat === 'beanie' || hat === 'hardhat' || hat === 'peaked' || style === 'cap') h = 'buzzed';
    if (h === 'buzzed' && id === 'civilian-female') h = 'buzzedfemale';
    if (h) this.addHair(h, head, appearance, model);
    // facial hair: about a third of the men on a Midtown sidewalk have a beard or heavy stubble
    if (id === 'civilian-male' && appearance.body.beard) this.addHair('beard', head, appearance, model);
    const hand = this.retarget.mapped.get('RightHand')!;
    hand.add(this.handSocket);
    this.retarget.update();
    this.root.updateMatrixWorld(true);
    // Socket axes match the procedural hand contract, irrespective of imported roll.
    hand.getWorldQuaternion(this.handSocket.quaternion).invert();
    this.handSocket.scale.setScalar(1 / scale);
  }
  private addHair(name: string, head: THREE.Bone, appearance: Appearance, model: THREE.Object3D): void {
    const template = templates.get('hair-' + name);
    if (!template) return;
    const hair = template.clone(true);
    hair.traverse(n => {
      if (!(n as THREE.Mesh).isMesh) return;
      const mesh = n as THREE.Mesh;
      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      material.color.set(appearance.colors.hair ?? 0x221810);
      // hair is glossier than cloth: the strand normal map plus a tighter lobe gives it a highlight band instead of a matte cap
      material.roughness = 0.52; material.envMapIntensity = 0.9;
      if (material.normalMap) material.normalScale.setScalar(1.25);
      mesh.material = material; this.materials.add(material);
      mesh.castShadow = true;
    });
    // These files have their OBJECT origin at zero but vertices at head height.
    // Preserve the full bind transform when attaching, not just the head rotation.
    const socket = new THREE.Group();
    socket.matrix.copy(head.matrixWorld).invert().multiply(model.matrixWorld);
    socket.matrix.decompose(socket.position, socket.quaternion, socket.scale);
    socket.add(hair); head.add(socket);
  }
  update(): void { this.retarget.update(); }
  shadows(on: boolean): void { for (const mesh of this.meshes) mesh.castShadow = on; }
  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
    for (const s of this.skeletons) s.dispose();
  }
}
export function createImportedCharacter(appearance: Appearance, palette: Palette, driver: Map<string, THREE.Bone>, wetness?: { value: number }, rim?: { value: THREE.Vector4 }, fill?: { value: THREE.Vector4 }): ImportedCharacter | null {
  const id = (appearance.body.hips ?? 1) > 1.05 ? 'civilian-female' : 'civilian-male';
  const template = templates.get(id);
  if (!template) return null;
  try { return new ImportedCharacter(id, template, appearance, palette, driver, wetness, rim, fill); }
  catch (error) { console.warn('[character] invalid rig; procedural fallback', error); return null; }
}
export function disposeCharacterAssets(): void {
  for (const g of cuts.values()) g.dispose(); cuts.clear();
  const textures = new Set<THREE.Texture>();
  for (const root of templates.values()) root.traverse(n => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const material of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      material.dispose();
    }
  });
  for (const t of textures) t.dispose();
  templates.clear(); loading = undefined;
  characterAssetStatus.loaded.length = 0; characterAssetStatus.errors.length = 0;
}
