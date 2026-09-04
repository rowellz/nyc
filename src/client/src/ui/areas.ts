import { basePath as __launchBasePath, mountedFetch as __launchFetch } from '@/core/basePath';
/**
 * Neighborhood lookup: world/areas.json (NTA polygons in world meters), fetched once, point-in-polygon
 * with a bbox pre-check. ~100 polygons, a few hundred vertices each: one lookup is well under 0.1 ms.
 */
import type { Area, Polygon } from '@shared/world';

interface IndexedArea {
  name: string;
  polygon: Polygon;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class AreaIndex {
  private areas: IndexedArea[] = [];
  private loaded = false;
  private loading: Promise<void> | null = null;
  private lastName: string | null = null;
  private lastArea: IndexedArea | null = null;

  load(baseUrl: string): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = __launchFetch(`${baseUrl}/areas.json`, { cache: 'force-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<Area[]>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((list) => {
        if (!Array.isArray(list)) return;
        for (const a of list) {
          if (!a || !Array.isArray(a.polygon) || !a.polygon[0]?.length) continue;
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
          for (const [x, z] of a.polygon[0]) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
          }
          this.areas.push({ name: prettyName(a.name), polygon: a.polygon, minX, maxX, minZ, maxZ });
        }
        this.loaded = true;
      })
      .catch((err) => console.warn('[ui] areas.json unavailable', err));
    return this.loading;
  }

  get ready(): boolean {
    return this.loaded;
  }

  nameAt(x: number, z: number): string | null {
    if (!this.loaded) return null;
    // most lookups stay inside the previous polygon
    const last = this.lastArea;
    if (last && inBox(last, x, z) && inPolygon(last.polygon, x, z)) return this.lastName;
    for (const a of this.areas) {
      if (!inBox(a, x, z)) continue;
      if (inPolygon(a.polygon, x, z)) {
        this.lastArea = a;
        this.lastName = a.name;
        return a.name;
      }
    }
    this.lastArea = null;
    this.lastName = null;
    return null;
  }
}

function inBox(a: IndexedArea, x: number, z: number): boolean {
  return x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ;
}

function inRing(ring: [number, number][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(poly: Polygon, x: number, z: number): boolean {
  if (!inRing(poly[0], x, z)) return false;
  for (let i = 1; i < poly.length; i++) if (inRing(poly[i], x, z)) return false;
  return true;
}

/** NTA names come as "Midtown-Midtown South" / "SoHo-TriBeCa-Civic Center-Little Italy"; show the first part. */
function prettyName(n: string): string {
  if (n.length <= 26) return n;
  const first = n.split(/[-–]/)[0]?.trim();
  return first && first.length > 2 ? first : n;
}
