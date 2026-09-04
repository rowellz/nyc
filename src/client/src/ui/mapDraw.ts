/**
 * Shared 2D map rendering of world tiles (minimap layer + full map). Everything in world meters -> px via
 * one scale and an origin; no per-call allocations beyond the canvas paths.
 */
import type { Polygon, RoadClass, Tile } from '@shared/world';
import { TILE_SIZE } from '@shared/geo';

export const MAP_COLORS = {
  water: '#172c44',
  land: '#1c1f24',
  park: '#25422e',
  plaza: '#26292f',
  parking: '#22252a',
  building: '#383c43',
  buildingEdge: '#2b2e34',
  roadMajor: '#c9b171',
  roadPrimary: '#9ea3ab',
  roadSecondary: '#7d828a',
  roadMinor: '#5f646c',
  roadService: '#474b52',
  roadPath: '#3e4248',
  roadOutline: '#141619',
} as const;

const ROAD_STYLE: Record<RoadClass, { color: string; min: number; layer: number }> = {
  motorway: { color: MAP_COLORS.roadMajor, min: 3, layer: 5 },
  trunk: { color: MAP_COLORS.roadMajor, min: 2.6, layer: 5 },
  primary: { color: MAP_COLORS.roadPrimary, min: 2.4, layer: 4 },
  secondary: { color: MAP_COLORS.roadSecondary, min: 2, layer: 3 },
  tertiary: { color: MAP_COLORS.roadMinor, min: 1.6, layer: 2 },
  residential: { color: MAP_COLORS.roadMinor, min: 1.4, layer: 2 },
  service: { color: MAP_COLORS.roadService, min: 0.8, layer: 1 },
  pedestrian: { color: MAP_COLORS.roadPath, min: 0.8, layer: 1 },
  footway: { color: MAP_COLORS.roadPath, min: 0.5, layer: 0 },
  cycleway: { color: MAP_COLORS.roadPath, min: 0.5, layer: 0 },
  steps: { color: MAP_COLORS.roadPath, min: 0.5, layer: 0 },
};

function pathPolygon(g: CanvasRenderingContext2D, poly: Polygon, s: number, ox: number, oz: number): void {
  for (const ring of poly) {
    if (!ring || ring.length < 3) continue;
    g.moveTo((ring[0][0] - ox) * s, (ring[0][1] - oz) * s);
    for (let i = 1; i < ring.length; i++) g.lineTo((ring[i][0] - ox) * s, (ring[i][1] - oz) * s);
    g.closePath();
  }
}

function fillPolygons(g: CanvasRenderingContext2D, polys: Polygon[] | undefined, color: string, s: number, ox: number, oz: number): void {
  if (!polys || polys.length === 0) return;
  g.fillStyle = color;
  g.beginPath();
  for (const p of polys) pathPolygon(g, p, s, ox, oz);
  g.fill('evenodd');
}

/**
 * Draw one tile. `s` = px per meter, (ox, oz) = world coords of canvas (0,0).
 * `detail` adds road outlines and minor paths (full map at zoom); the minimap layer skips them.
 */
export function drawTile(g: CanvasRenderingContext2D, tile: Tile, s: number, ox: number, oz: number, detail: boolean, skipLand = false): void {
  if (!skipLand) {
    const x0 = (tile.tx * TILE_SIZE - ox) * s;
    const z0 = (tile.tz * TILE_SIZE - oz) * s;
    const size = TILE_SIZE * s;
    g.fillStyle = MAP_COLORS.land;
    g.fillRect(x0, z0, size + 0.6, size + 0.6);
  }

  fillPolygons(g, tile.water, MAP_COLORS.water, s, ox, oz);
  fillPolygons(g, tile.parks, MAP_COLORS.park, s, ox, oz);
  if (detail) {
    fillPolygons(g, tile.plazas, MAP_COLORS.plaza, s, ox, oz);
    fillPolygons(g, tile.parking, MAP_COLORS.parking, s, ox, oz);
  }

  // buildings
  const bl = tile.buildings;
  if (bl && bl.length) {
    g.fillStyle = MAP_COLORS.building;
    g.beginPath();
    for (const b of bl) pathPolygon(g, b.footprint, s, ox, oz);
    g.fill('evenodd');
  }

  // roads, minor first so the avenues sit on top
  const roads = tile.roads;
  if (!roads || roads.length === 0) return;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const minorCut = detail ? 0 : 1; // minimap skips footways/steps
  for (let layer = minorCut; layer <= 5; layer++) {
    let any = false;
    for (const r of roads) {
      if (r.tunnel) continue;
      const st = ROAD_STYLE[r.cls] ?? ROAD_STYLE.residential;
      if (st.layer !== layer) continue;
      if (!any) {
        any = true;
        g.strokeStyle = st.color;
      }
      // minimap: fixed width per class (reads like a street map); full map: real width, clamped so
      // avenues do not swallow the blocks until you zoom in
      const w = detail ? Math.max(st.min, Math.min(r.width * s * 0.6, st.min * 2.4 + s * 6)) : st.min * 1.5;
      if (detail && layer >= 2) {
        g.lineWidth = w + 1.5;
        g.strokeStyle = MAP_COLORS.roadOutline;
        strokeLine(g, r.pts, s, ox, oz);
        g.strokeStyle = st.color;
      }
      g.lineWidth = w;
      strokeLine(g, r.pts, s, ox, oz);
    }
  }
}

function strokeLine(g: CanvasRenderingContext2D, pts: [number, number][], s: number, ox: number, oz: number): void {
  if (!pts || pts.length < 2) return;
  g.beginPath();
  g.moveTo((pts[0][0] - ox) * s, (pts[0][1] - oz) * s);
  for (let i = 1; i < pts.length; i++) g.lineTo((pts[i][0] - ox) * s, (pts[i][1] - oz) * s);
  g.stroke();
}

/** a filled arrow (player marker) pointing up, centred at 0,0; caller rotates */
export function drawArrow(g: CanvasRenderingContext2D, size: number, fill: string, stroke = 'rgba(0,0,0,0.85)'): void {
  g.beginPath();
  g.moveTo(0, -size);
  g.lineTo(size * 0.7, size * 0.75);
  g.lineTo(0, size * 0.35);
  g.lineTo(-size * 0.7, size * 0.75);
  g.closePath();
  g.fillStyle = fill;
  g.strokeStyle = stroke;
  g.lineWidth = 1.5;
  g.lineJoin = 'round';
  g.fill();
  g.stroke();
}

export function drawDot(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke = 'rgba(0,0,0,0.8)'): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = stroke;
  g.stroke();
}

/** camera heading in radians (0 = north, clockwise positive) from a forward vector */
export function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, -dz);
}
