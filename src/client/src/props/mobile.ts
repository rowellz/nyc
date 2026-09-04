/** iOS: only the nearest 200 authored source props, no catalogue worker, atlases,
 * per-tile placement expansion, lights, steam, colliders or far instance buffers. */
import * as THREE from 'three';
import type { GameContext, GameModule } from '@/core/context';
import type { Prop, PropKind } from '@shared/world';
import { tileIndex, tileKey } from '@shared/geo';
import { buildLamp } from './kinds/lamp';
import { buildSignal } from './kinds/signal';
import { buildHydrant, buildBench, buildSteelBasket, buildBollard, buildBikeRack, buildMailbox, buildPlanter } from './kinds/small';
import { SignalNetwork } from './signals';
import { nearestProps } from './nearest';

function geometryFor(kind: PropKind): THREE.BufferGeometry {
  switch (kind) {
    case 'street_lamp': return buildLamp('far');
    case 'traffic_signal': return buildSignal('far');
    case 'hydrant': return buildHydrant('black');
    case 'bench': return buildBench();
    case 'trash_can': return buildSteelBasket();
    case 'bollard': return buildBollard();
    case 'bike_rack': return buildBikeRack();
    case 'mailbox': return buildMailbox();
    case 'planter': return buildPlanter();
    default: {
      // Small untextured silhouettes for the remaining street furniture.
      const flat = /grate|manhole/.test(kind), pole = /sign|bus_stop/.test(kind);
      const width = flat ? 1 : pole ? 0.15 : 1.2, height = flat ? 0.02 : pole ? 3 : 1.5;
      const g = new THREE.BoxGeometry(width, height, flat ? 1 : pole ? 0.15 : 0.7).translate(0, height / 2, 0);
      const colors = new Float32Array(g.getAttribute('position').count * 3).fill(0.3);
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return g;
    }
  }
}

export function createProps(ctx: GameContext): GameModule & {
  stats: { instances: number; capacity: number };
  signalFor(x: number, z: number, dx: number, dz: number): ReturnType<SignalNetwork['signalFor']>;
} {
  const group = new THREE.Group(); group.name = 'props'; ctx.worldGroup.add(group);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const pools = new Map<PropKind, THREE.InstancedMesh>();
  const network = new SignalNetwork();
  const stats = { instances: 0, capacity: 200 };
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), position = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), scale = new THREE.Vector3(1, 1, 1);
  let dirty = true, lastX = Infinity, lastZ = Infinity, next = 0, disposed = false;
  let selection: Prop[] = [];
  const off = [ctx.events.on('tileLoaded', () => { dirty = true; }), ctx.events.on('tileUnloaded', () => { dirty = true; })];
  function refresh(): void {
    const p = ctx.camera.position;
    const nearest = nearestProps(ctx.world.tiles.values(), p.x, p.z);
    lastX = p.x; lastZ = p.z; dirty = false;
    if (nearest.length === selection.length && nearest.every((prop, i) => prop === selection[i])) return;
    selection = nearest;
    network.resetPoles();
    const kinds = new Map<PropKind, Prop[]>();
    for (const prop of selection) {
      let list = kinds.get(prop.kind); if (!list) kinds.set(prop.kind, list = []); list.push(prop);
      if (prop.kind === 'traffic_signal') network.addPole(prop.x, prop.z, prop.yaw, tileKey(tileIndex(prop.x), tileIndex(prop.z)));
    }
    // Free removed/shrinking buffers before replacements; never allocate a per-kind 200-slot pool.
    const geometry = new Map<PropKind, THREE.BufferGeometry>();
    for (const [kind, mesh] of pools) {
      if (kinds.get(kind)?.length === mesh.count) continue;
      group.remove(mesh); mesh.dispose(); pools.delete(kind);
      if (kinds.has(kind)) geometry.set(kind, mesh.geometry); else mesh.geometry.dispose();
    }
    for (const [kind, props] of kinds) {
      let mesh = pools.get(kind);
      if (!mesh) {
        mesh = new THREE.InstancedMesh(geometry.get(kind) ?? geometryFor(kind), material, props.length);
        mesh.name = `ios-props-${kind}`; mesh.castShadow = false; mesh.frustumCulled = false;
        group.add(mesh); pools.set(kind, mesh);
      }
      for (let i = 0; i < props.length; i++) {
        const prop = props[i];
        position.set(prop.x, ctx.physics.groundHeight(prop.x, prop.z), prop.z);
        quaternion.setFromAxisAngle(up, prop.yaw);
        mesh.setMatrixAt(i, matrix.compose(position, quaternion, scale));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    stats.instances = selection.length;
  }
  refresh();
  return { name: 'props', stats,
    signalFor: (x, z, dx, dz) => network.signalFor(x, z, dx, dz, ctx.state.serverTime()),
    update(_dt, t) {
      if (disposed || t < next) return;
      next = t + 0.5;
      if (dirty || (ctx.camera.position.x - lastX) ** 2 + (ctx.camera.position.z - lastZ) ** 2 > 4) refresh();
    },
    dispose() {
      disposed = true; off.forEach(f => f());
      for (const mesh of pools.values()) { mesh.dispose(); mesh.geometry.dispose(); }
      pools.clear(); selection = []; group.clear(); ctx.worldGroup.remove(group); material.dispose();
    },
  };
}
