/** Worker-safe orchestration of the existing geometry builders. */
import type * as THREE from 'three';
import { splitCollider, type ColliderChunk } from '../buildings/transfer';
import type { Quality } from '@/core/context';
import { TILE_SIZE } from '@shared/geo';
import type { RoadSegment, Tile } from '@shared/world';
import { buildBridges, buildPortals, deckHeightIn, type BridgeOut } from './bridges';
import { GroundBuilder, MarkBuilder, StructBuilder, type TileEnv } from './builders';
import { RoadIndex, STREET, VEHICULAR, clipPolylineToRect, hash2, indexPolygons, pointInAny } from './geom2d';
import { KIND } from './materials';
import { buildMarkings } from './markings';
import { ROAD_Y, buildRoadbed, ribbon } from './roadbed';
import { WALK_Y, buildSidewalks, type SidewalkResult } from './sidewalk';
import { SurfaceGrid, type DecalRect } from './surface';
import { buildWalkCollision, walkHeightIn, type WalkCollision } from './collision';

export interface TileInput { tile: Tile; roads: RoadSegment[]; quality: Quality }
export interface PackedGeometry {
  attributes: Record<string, { data: Float32Array; size: number }>;
  index: Uint16Array | Uint32Array;
  bounds: [number, number, number, number];
}
export interface BuiltStreetTile {
  meshes: (PackedGeometry | null)[];
  surface: Uint8Array;
  paint: DecalRect[];
  metal: DecalRect[];
  decks: BridgeOut['decks'];
  colliderPos: Float32Array;
  colliderIdx: Uint32Array;
  colliders: ColliderChunk[];
  walkCollision: WalkCollision;
  ms: number;
}

function pack(g: THREE.BufferGeometry | null): PackedGeometry | null {
  if (!g) return null;
  const attributes: PackedGeometry['attributes'] = {};
  for (const [name, attr] of Object.entries(g.attributes)) attributes[name] = { data: attr.array as Float32Array, size: attr.itemSize };
  const b = g.boundingSphere!;
  return { attributes, index: g.index!.array as Uint16Array | Uint32Array, bounds: [b.center.x, b.center.y, b.center.z, b.radius] };
}

export function buildStreetTile(input: TileInput): BuiltStreetTile {
  const start = performance.now();
  const { tile, roads, quality } = input;
  const ox = tile.tx * TILE_SIZE, oz = tile.tz * TILE_SIZE;
  const bridge: BridgeOut = { decks: [], cpos: [], cidx: [] };
  const road = new GroundBuilder(), walk = new GroundBuilder(), marks = new MarkBuilder(), structure = new StructBuilder();
  const grid = new SurfaceGrid(ox, oz);
  const env: TileEnv = {
    ctx: { quality, world: { roadsNear: () => roads } },
    tile: { ...tile, roads },
    rect: { minX: ox - 0.05, minZ: oz - 0.05, maxX: ox + TILE_SIZE + 0.05, maxZ: oz + TILE_SIZE + 0.05 },
    roadsV: new RoadIndex(roads, r => VEHICULAR.has(r.cls) && !r.tunnel),
    roadsS: new RoadIndex(roads, r => STREET.has(r.cls) && !r.tunnel && !r.bridge),
    roadbeds: indexPolygons([...tile.roadbeds, ...tile.parking]),
    hydrants: tile.props.filter(p => p.kind === 'hydrant'),
    deckAt: (x, z) => deckHeightIn(bridge.decks, x, z),
    seed: hash2(tile.tx, tile.tz) * 10000,
  };
  buildRoadbed(env, road);
  const walks: SidewalkResult = { ramps: [], curbs: [] };
  for (const _ of buildSidewalks(env, walk, walks)) { /* Worker owns the whole job. */ }
  const paved = indexPolygons([...tile.sidewalks, ...tile.plazas, ...tile.roadbeds]);
  const seen = new Set<number>();
  for (const r of roads) {
    if (seen.has(r.id) || r.bridge || r.tunnel || (r.cls !== 'footway' && r.cls !== 'pedestrian')) continue;
    seen.add(r.id);
    // Short pieces let paths stop where an existing paved polygon begins.
    for (const piece of clipPolylineToRect(r.pts, env.rect)) {
      for (let i = 1; i < piece.pts.length; i++) {
        const a = piece.pts[i - 1], b = piece.pts[i];
        const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
        for (let j = 0; j < count; j++) {
          const t = (j + 0.5) / count;
          if (pointInAny(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, paved)) continue;
          const pts: [number, number][] = [j / count, (j + 1) / count].map(s => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]);
          const isRoad = r.surface === 'asphalt' || r.surface === 'cobblestone';
          const kind = r.surface === 'cobblestone' ? KIND.cobble : r.surface === 'asphalt' ? KIND.asphalt : r.surface === 'paving_stones' ? KIND.pavers : KIND.plainConcrete;
          ribbon(isRoad ? road : walk, pts, Math.max(0.6, r.width / 2), () => isRoad ? ROAD_Y : WALK_Y, kind, 0, hash2(r.id, 0));
        }
      }
    }
  }
  grid.rasterize(road.pos, road.idx, road.aA);
  grid.rasterize(walk.pos, walk.idx, walk.aA);
  const groundEnd = road.idx.length;
  buildBridges(env, road, structure, bridge);
  buildPortals(env, structure, bridge);
  grid.rasterize(road.pos, road.idx.slice(groundEnd), road.aA, Infinity);
  const walkCollision = buildWalkCollision(walk, walks.curbs, ox, oz);
  buildMarkings(env, marks, grid, walks, (x, z) => Math.max(env.deckAt(x, z),
    walkHeightIn(walkCollision, Math.max(ox, Math.min(ox + TILE_SIZE - 1e-4, x)),
      Math.max(oz, Math.min(oz + TILE_SIZE - 1e-4, z)), ox, oz) - ROAD_Y));
  return {
    meshes: [pack(road.build()), pack(walk.build()), pack(marks.build()), pack(structure.build())],
    surface: grid.data, paint: grid.paint, metal: grid.metal, decks: bridge.decks,
    colliders: splitCollider(new Float32Array(bridge.cpos), new Uint32Array(bridge.cidx)),
    walkCollision,
    colliderPos: new Float32Array(bridge.cpos), colliderIdx: new Uint32Array(bridge.cidx), ms: performance.now() - start,
  };
}

export interface BuildRequest { id: number; input: TileInput }
export interface BuildResponse { id: number; built?: BuiltStreetTile; error?: string }
