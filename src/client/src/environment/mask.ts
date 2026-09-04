/**
 * Per-tile coverage mask: an RGBA8 texture (MASK_RES^2 over the 256 m tile, 50 cm/texel) painted with Canvas2D.
 *   R = water (ground fragments are discarded -> the water plane below shows)
 *   G = grass (park polygons minus paved features / buildings / roads)
 *   B = gravel (plazas inside parks, e.g. the Bryant Park gravel around the lawn)
 *   A = worn dirt (bands along footways in parks)
 * The CPU copy backs surfaceAt(); the GPU copy drives the ground shader and the grass placement.
 */
import * as THREE from 'three';
import { TILE_SIZE } from '@shared/geo';
import type { Polygon, RoadSegment, Tile } from '@shared/world';
import type { GameContext } from '@/core/context';
import { polygonInsideAny, pointInPolygon } from './geom';

export const MASK_RES = 512;

export interface TileMask {
  key: string;
  ox: number;
  oz: number;
  data: Uint8ClampedArray;
  tex: THREE.DataTexture;
}

export class MaskPainter {
  private cv: HTMLCanvasElement | OffscreenCanvas;
  private c2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private pxPerM = MASK_RES / TILE_SIZE;

  constructor(private ctx: { world: Pick<GameContext['world'], 'roadsNear' | 'buildingsNear'> }) {
    let cv: HTMLCanvasElement | OffscreenCanvas;
    let c2: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      cv = new OffscreenCanvas(MASK_RES, MASK_RES);
      c2 = cv.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
    } else {
      cv = document.createElement('canvas');
      cv.width = cv.height = MASK_RES;
      c2 = cv.getContext('2d', { willReadFrequently: true });
    }
    if (!c2) {
      cv = document.createElement('canvas');
      (cv as HTMLCanvasElement).width = (cv as HTMLCanvasElement).height = MASK_RES;
      c2 = (cv as HTMLCanvasElement).getContext('2d', { willReadFrequently: true })!;
    }
    this.cv = cv;
    this.c2 = c2;
  }

  /** paint (or repaint into `existing`) the mask for a tile */
  paint(tile: Tile, existing?: TileMask): TileMask {
    const ox = tile.tx * TILE_SIZE, oz = tile.tz * TILE_SIZE;
    const out = existing?.data ?? new Uint8ClampedArray(MASK_RES * MASK_RES * 4);
    if (existing) out.fill(0);
    const c = this.c2;
    const world = this.ctx.world;
    const cx = ox + TILE_SIZE / 2, cz = oz + TILE_SIZE / 2;
    // roads live in ONE tile each but cross into neighbours: gather everything overlapping this tile
    const roads: RoadSegment[] = world.roadsNear(cx, cz, TILE_SIZE * 0.72);
    const buildings = world.buildingsNear(cx, cz, TILE_SIZE * 0.72);
    const parks = tile.parks;

    const layer = (draw: () => void): Uint8ClampedArray => {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, MASK_RES, MASK_RES);
      c.setTransform(this.pxPerM, 0, 0, this.pxPerM, -ox * this.pxPerM, -oz * this.pxPerM);
      draw();
      return c.getImageData(0, 0, MASK_RES, MASK_RES).data;
    };
    const fillPolys = (polys: Polygon[], color: string): void => {
      if (!polys.length) return;
      c.fillStyle = color;
      for (const p of polys) {
        if (!p.length || p[0].length < 3) continue;
        c.beginPath();
        for (const ring of p) {
          if (ring.length < 3) continue;
          c.moveTo(ring[0][0], ring[0][1]);
          for (let i = 1; i < ring.length; i++) c.lineTo(ring[i][0], ring[i][1]);
          c.closePath();
        }
        c.fill('evenodd');
      }
    };
    const strokeRoads = (list: RoadSegment[], color: string, widthOf: (r: RoadSegment) => number): void => {
      c.strokeStyle = color;
      c.lineCap = 'round';
      c.lineJoin = 'round';
      for (const r of list) {
        if (r.tunnel || r.bridge || r.pts.length < 2) continue;
        const w = widthOf(r);
        if (w <= 0) continue;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(r.pts[0][0], r.pts[0][1]);
        for (let i = 1; i < r.pts.length; i++) c.lineTo(r.pts[i][0], r.pts[i][1]);
        c.stroke();
      }
    };
    const isFoot = (r: RoadSegment) => r.cls === 'footway' || r.cls === 'steps' || r.cls === 'pedestrian' || r.cls === 'cycleway';
    const inPark = (x: number, z: number): boolean => {
      for (const p of parks) if (pointInPolygon(x, z, p)) return true;
      return false;
    };
    const footInParks = roads.filter((r) => isFoot(r) && r.pts.length >= 2 && inPark(r.pts[Math.floor(r.pts.length / 2)][0], r.pts[Math.floor(r.pts.length / 2)][1]));

    const copyChannel = (src: Uint8ClampedArray, ch: number): void => {
      for (let i = 0, j = ch; i < src.length; i += 4, j += 4) out[j] = src[i];
    };

    // R: water
    if (tile.water.length) copyChannel(layer(() => fillPolys(tile.water, '#fff')), 0);
    // G: grass
    if (parks.length) {
      copyChannel(
        layer(() => {
          fillPolys(parks, '#fff');
          fillPolys(tile.plazas, '#000');
          fillPolys(tile.roadbeds, '#000');
          fillPolys(tile.sidewalks, '#000');
          fillPolys(tile.parking, '#000');
          fillPolys(buildings.map((b) => b.footprint), '#000');
          strokeRoads(roads, '#000', (r) => (isFoot(r) ? Math.max(0.8, (r.width || 2.5) - 0.4) : Math.max(3, r.width || 6) + 1.0));
        }),
        1,
      );
      // B: gravel (plazas that sit inside a park)
      const gravel = tile.plazas.filter((p) => polygonInsideAny(p, parks));
      if (gravel.length) copyChannel(layer(() => fillPolys(gravel, '#fff')), 2);
      // A: worn dirt along park footways
      if (footInParks.length) copyChannel(layer(() => strokeRoads(footInParks, '#fff', (r) => (r.width || 2.5) + 1.6)), 3);
    }

    if (existing) {
      existing.tex.needsUpdate = true;
      return existing;
    }
    const tex = new THREE.DataTexture(out, MASK_RES, MASK_RES, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return { key: tile.key, ox, oz, data: out, tex };
  }
}

/** nearest-texel sample of one channel (0 R,1 G,2 B,3 A) at a world position, 0..255 */
export function maskSample(m: TileMask, x: number, z: number, ch: number): number {
  const u = Math.min(MASK_RES - 1, Math.max(0, Math.floor(((x - m.ox) / TILE_SIZE) * MASK_RES)));
  const v = Math.min(MASK_RES - 1, Math.max(0, Math.floor(((z - m.oz) / TILE_SIZE) * MASK_RES)));
  return m.data[(v * MASK_RES + u) * 4 + ch];
}
