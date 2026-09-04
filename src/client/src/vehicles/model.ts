import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { KINDS, hash01, pickColor, type VehicleSpec } from './kinds';

export interface Car {
  key: string;
  kind: string;
  x: number; y: number; z: number; yaw: number;
  matrix: THREE.Matrix4;
  color: THREE.Color;
  speed: number;
  spin: number;
  steer: number;
  brake: number;
  siren: boolean;
  body: RigidBody | null;
}

export function makeCar(key: string, kind: string, x: number, y: number, z: number, yaw: number, seed: number): Car {
  kind = KINDS[kind] ? kind : 'sedan';
  return { key, kind, x, y, z, yaw, matrix: new THREE.Matrix4(), color: new THREE.Color(pickColor(KINDS[kind], hash01(seed, 91))), speed: 0, spin: 0, steer: 0, brake: 0, siren: false, body: null };
}

export function poseMatrix(car: Car): void {
  car.matrix.makeRotationY(car.yaw).setPosition(car.x, car.y, car.z);
}

export function ground(ctx: GameContext, x: number, z: number): number {
  // Streets is optional (its entry point may not have been built yet).
  const streets = ctx.modules.get('streets') as { deckHeight?: (x: number, z: number) => number } | undefined;
  return streets?.deckHeight?.(x, z) ?? ctx.physics.groundHeight(x, z);
}

export function removeBody(ctx: GameContext, car: Car): void {
  if (car.body?.isValid()) ctx.physics.world.removeRigidBody(car.body);
  car.body = null;
}

export function createObstacle(ctx: GameContext, car: Car, moving: boolean): void {
  if (car.body || ctx.physics.ready === false) return;
  const R = ctx.physics.RAPIER, s = KINDS[car.kind];
  car.body = ctx.physics.world.createRigidBody((moving ? R.RigidBodyDesc.kinematicPositionBased() : R.RigidBodyDesc.fixed())
    .setTranslation(car.x, car.y, car.z).setRotation({ x: 0, y: Math.sin(car.yaw / 2), z: 0, w: Math.cos(car.yaw / 2) })
    .setUserData({ surface: 'vehicle', key: car.key }));
  ctx.physics.world.createCollider(R.ColliderDesc.cuboid(s.width / 2, (s.height - 0.25) / 2, s.length / 2)
    .setTranslation(0, (s.height + 0.25) / 2, (s.rear - s.front) / 2).setFriction(0.6), car.body);
}

export function distance2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

export function driverDoor(car: Car, s: VehicleSpec, side = -1): THREE.Vector3 {
  return new THREE.Vector3(side * (s.width / 2 + 0.85), 0, s.seatZ).applyMatrix4(car.matrix);
}
