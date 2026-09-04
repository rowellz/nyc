/**
 * Geometry accumulators. Plain number arrays while building (per tile, a few thousand vertices), converted
 * to typed BufferGeometry at the end. Attribute layouts are documented in materials.ts.
 */
import * as THREE from 'three';
import type { RoadSegment, Tile } from '@shared/world';
import type { GameContext } from '@/core/context';
import type { BBox, IndexedPolygon, RoadIndex } from './geom2d';
import { clipConvex } from './geom2d';

export interface TileEnv {
  // Only these services are needed by the builders, including in the geometry worker.
  ctx: Pick<GameContext, 'quality'> & { world: Pick<GameContext['world'], 'roadsNear'> };
  tile: Tile;
  rect: BBox; // tile rect (with the 0.05 clip overlap)
  roadsV: RoadIndex; // vehicular centerlines (for lane offsets, traffic)
  roadsS: RoadIndex; // streets (for sidewalk grid direction)
  roadbeds: IndexedPolygon[]; // asphalt polys (+ parking) for curb detection
  hydrants: { x: number; z: number }[];
  /** deck height at a world point (0 on the ground); valid after the bridge phase */
  deckAt: (x: number, z: number) => number;
  seed: number;
}

export function trafficFor(r: RoadSegment): number {
  switch (r.cls) {
    case 'motorway': return 1;
    case 'trunk': return 0.95;
    case 'primary': return 0.9;
    case 'secondary': return 0.8;
    case 'tertiary': return 0.65;
    case 'residential': return 0.5;
    case 'service': return 0.25;
    default: return 0.1;
  }
}

export class GroundBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  aA: number[] = [];
  aB: number[] = [];
  idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: number, lane: number, along: number, rand: number, dc: number, ds: number, paint: number, traffic: number): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.aA.push(kind, lane, along, rand);
    this.aB.push(dc, ds, paint, traffic);
    return i;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /** vertical/inclined quad from edge (ax,az)->(bx,bz) between heights, normal given; returns nothing */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, ny: number, nz: number, kind: number, along0: number, along1: number, rand: number, paint: number, inset = 0, dc = 0, ds = 0): void {
    const a0 = this.vertex(ax, y0, az, nx, ny, nz, kind, 0, along0, rand, dc, ds, paint, 0);
    const b0 = this.vertex(bx, y0, bz, nx, ny, nz, kind, 0, along1, rand, dc, ds, paint, 0);
    const b1 = this.vertex(bx - nx * inset, y1, bz - nz * inset, nx, ny, nz, kind, 0, along1, rand, dc, ds, paint, 0);
    const a1 = this.vertex(ax - nx * inset, y1, az - nz * inset, nx, ny, nz, kind, 0, along0, rand, dc, ds, paint, 0);
    // winding so the face normal is (nx, ny, nz): outward side sees CCW
    const cx = (bx - ax), cz = (bz - az);
    // (b0 - a0) x (a1 - a0) = (cx,0,cz) x (0, y1-y0, 0) = (-cz*(y1-y0), 0, cx*(y1-y0)); compare with n
    const dot = -cz * nx + cx * nz;
    if (dot > 0) this.idx.push(a0, b0, b1, a0, b1, a1);
    else this.idx.push(a0, b1, b0, a0, a1, b1);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aA', new THREE.Float32BufferAttribute(this.aA, 4));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(this.aB, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const NO_FRAME = [0, 0, 0, 0] as const;

/** markings/decals: quads in the atlas */
export class MarkBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  local: number[] = [];
  region: number[] = [];
  m: number[] = [];
  t: number[] = [];
  idx: number[] = [];

  /**
   * flat quad centred at (cx, cz) with long axis d (unit), size len x width. mode 0 = tile (repeat every `tileM` m), 1 = stretch.
   * frame = (rx, rz, c, laneCode): road frame so paint can wear in the wheel tracks; lane offset = dot(p, (rx, rz)) - c.
   */
  quad(cx: number, cz: number, y: number, dx: number, dz: number, len: number, width: number, region: readonly number[], mode: number, health: number, metal: number, darken: number, tileM = 1, heightAt?: (x: number, z: number) => number, frame: readonly number[] = NO_FRAME, clip?: BBox): void {
    const rx = -dz, rz = dx; // right of travel
    const hl = len / 2, hw = width / 2;
    const base = this.pos.length / 3;
    const corners: [number, number, number, number][] = [
      [-hl, -hw, 0, 0],
      [hl, -hw, 1, 0],
      [hl, hw, 1, 1],
      [-hl, hw, 0, 1],
    ];
    let points: [number, number][] = corners.map(([a, b]) => [cx + dx * a + rx * b, cz + dz * a + rz * b]);
    if (clip) points = clipConvex(points, [[clip.minX, clip.minZ], [clip.maxX, clip.minZ], [clip.maxX, clip.maxZ], [clip.minX, clip.maxZ]]);
    if (points.length < 3) return;
    for (const [x, z] of points) {
      const a = (x - cx) * dx + (z - cz) * dz, b = (x - cx) * rx + (z - cz) * rz;
      const u = (a + hl) / len, v = (b + hw) / width;
      const yy = y + (heightAt ? heightAt(x, z) : 0);
      this.pos.push(x, yy, z);
      this.nrm.push(0, 1, 0);
      if (mode === 1) this.local.push(u, v);
      else this.local.push((a + hl) / tileM, (b + hw) / tileM);
      this.region.push(region[0], region[1], region[2], region[3]);
      this.m.push(health, mode, metal, darken);
      this.t.push(frame[0], frame[1], frame[2], frame[3]);
    }
    // +y facing: points ordered (-hl,-hw) (hl,-hw) (hl,hw) (-hl,hw); with right = (-dz,dx) the y-normal of
    // (p1-p0)x(p2-p0) is d x r (in xz) = dx*rz - dz*rx = dx*dx + dz*dz > 0 -> flip to keep CCW from above
    for (let i = 1; i + 1 < points.length; i++) this.idx.push(base, base + i + 1, base + i);
  }

  /** vertical quad (curb inlets): centre (cx, y, cz), along d, facing normal n (unit, horizontal) */
  wallQuad(cx: number, cy: number, cz: number, dx: number, dz: number, nx: number, nz: number, len: number, height: number, region: readonly number[], health: number, metal: number): void {
    const hl = len / 2, hh = height / 2;
    const base = this.pos.length / 3;
    const pts: [number, number, number, number, number][] = [
      [cx - dx * hl, cy - hh, cz - dz * hl, 0, 0],
      [cx + dx * hl, cy - hh, cz + dz * hl, 1, 0],
      [cx + dx * hl, cy + hh, cz + dz * hl, 1, 1],
      [cx - dx * hl, cy + hh, cz - dz * hl, 0, 1],
    ];
    for (const [x, y, z, u, v] of pts) {
      this.pos.push(x, y, z);
      this.nrm.push(nx, 0, nz);
      this.local.push(u, v);
      this.region.push(region[0], region[1], region[2], region[3]);
      this.m.push(health, 1, metal, 0);
      this.t.push(0, 0, 0, 0);
    }
    // (p1-p0) x (p2-p0) points along (-dz, 0, dx); choose the winding whose normal matches n
    const dot = -dz * nx + dx * nz;
    if (dot > 0) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aLocal', new THREE.Float32BufferAttribute(this.local, 2));
    g.setAttribute('aRegion', new THREE.Float32BufferAttribute(this.region, 4));
    g.setAttribute('aM', new THREE.Float32BufferAttribute(this.m, 4));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(this.t, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** bridge structure: position, normal, color, aA (material id), aB unused */
export class StructBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  aA: number[] = [];
  aB: number[] = [];
  idx: number[] = [];
  /** collider triangles (subset) */
  cpos: number[] = [];
  cidx: number[] = [];

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number, mat: number): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.nrm.push(nx, ny, nz);
    this.col.push(r, g, b);
    this.aA.push(mat, 0, 0, 0);
    this.aB.push(0, 0, 0, 0);
    return i;
  }

  /** axis-free box from 8 corners: bottom quad b0..b3 (CCW from above), top quad t0..t3 */
  box(b: number[][], t: number[][], color: [number, number, number], mat: number, collide = false): void {
    const faces: [number[], number[], number[], number[]][] = [
      [t[0], t[1], t[2], t[3]], // top
      [b[3], b[2], b[1], b[0]], // bottom
      [b[0], b[1], t[1], t[0]],
      [b[1], b[2], t[2], t[1]],
      [b[2], b[3], t[3], t[2]],
      [b[3], b[0], t[0], t[3]],
    ];
    for (const f of faces) this.face(f, color, mat, collide);
  }

  /** planar quad (4 points, CCW seen from the outside) */
  face(p: number[][], color: [number, number, number], mat: number, collide = false): void {
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
    const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = this.pos.length / 3;
    for (const q of p) this.vertex(q[0], q[1], q[2], nx, ny, nz, color[0], color[1], color[2], mat);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    if (collide) {
      const cb = this.cpos.length / 3;
      for (const q of p) this.cpos.push(q[0], q[1], q[2]);
      this.cidx.push(cb, cb + 1, cb + 2, cb, cb + 2, cb + 3);
    }
  }

  build(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aA', new THREE.Float32BufferAttribute(this.aA, 4));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(this.aB, 4));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
