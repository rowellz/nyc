import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { correctStreetTile, keepStreetRoad } from './street-corrections.js';

const inflate = promisify(gunzip), deflate = promisify(gzip);
const TILE = 256, REACH = 512;
const keyOf = (x, z) => `${x}_${z}`;
const bounds = road => {
  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const [x, z] of road.pts) {
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
  }
  return b;
};

/** Index complete ways, including roads extending beyond their owner tile. */
export function createRoadIndex() {
  const roads = new Map(), buckets = new Map();
  return {
    add(road) {
      if (!keepStreetRoad(road) || roads.has(road.id) || road.pts.length < 2) return;
      const item = { road, ...bounds(road) }; roads.set(road.id, item);
      for (let x = Math.floor(item.minX / TILE); x <= Math.floor(item.maxX / TILE); x++) {
        for (let z = Math.floor(item.minZ / TILE); z <= Math.floor(item.maxZ / TILE); z++) {
          const key = keyOf(x, z), bucket = buckets.get(key) ?? [];
          bucket.push(item); buckets.set(key, bucket);
        }
      }
    },
    near(x, z, reach) {
      const found = new Map();
      for (let tx = Math.floor((x - reach) / TILE); tx <= Math.floor((x + reach) / TILE); tx++) {
        for (let tz = Math.floor((z - reach) / TILE); tz <= Math.floor((z + reach) / TILE); tz++) {
          for (const item of buckets.get(keyOf(tx, tz)) ?? []) {
            if (item.maxX < x - reach || item.minX > x + reach || item.maxZ < z - reach || item.minZ > z + reach) continue;
            found.set(item.road.id, item.road);
          }
        }
      }
      return [...found.values()];
    },
  };
}

export function streetContext(tile, index, neighbors) {
  const roads = new Map(index.near((tile.tx + .5) * TILE, (tile.tz + .5) * TILE, TILE / 2 + REACH)
    .map(road => [road.id, road]));
  for (const road of tile.roads) if (keepStreetRoad(road)) roads.set(road.id, road);
  // A complete way can end outside the planning halo. Include its endpoint
  // connections before assigning lanes or deciding where a bridge descends.
  for (const road of [...roads.values()]) if (road.bridge || road.tunnel || ['motorway', 'trunk'].includes(road.cls)) {
    for (const p of [road.pts[0], road.pts.at(-1)]) if (p) {
      for (const other of index.near(p[0], p[1], 3)) roads.set(other.id, other);
    }
  }
  const crossings = new Map(), x = tile.tx * TILE, z = tile.tz * TILE;
  for (const neighbor of neighbors) {
    if (Math.abs(neighbor.tx - tile.tx) > 1 || Math.abs(neighbor.tz - tile.tz) > 1) continue;
    for (const c of neighbor.crossings) {
      const pad = c.width / 2 + 5;
      if (c.x + pad < x || c.x - pad > x + TILE || c.z + pad < z || c.z - pad > z + TILE) continue;
      crossings.set(`${c.x}:${c.z}:${c.yaw}`, c);
    }
  }
  // Pedestrian data only constrains bridge clearance. Retain whole polygons
  // near those decks (including holes), avoiding a second copy of every city's
  // sidewalk in each resident tile's planning halo. The pad covers the mitered
  // half-width and the planner's extra 4 m sampling station at either end.
  const bridges = [...roads.values()].filter(r => r.bridge && !r.tunnel).map(road => {
    const b = bounds(road), pad = Math.max(3.2, road.width / 2) * 1.6 + 8;
    return { minX: b.minX - pad, minZ: b.minZ - pad, maxX: b.maxX + pad, maxZ: b.maxZ + pad };
  });
  const nearBridge = poly => {
    const b = bounds({ pts: poly[0] ?? [] });
    return bridges.some(a => a.maxX >= b.minX && a.minX <= b.maxX && a.maxZ >= b.minZ && a.minZ <= b.maxZ);
  };
  return {
    roads: [...roads.values()].sort((a, b) => a.id - b.id),
    pedestrianTiles: neighbors.map(({ tx, tz, sidewalks, medians, plazas, roadbeds, parking }) =>
      ({ tx, tz, sidewalks: sidewalks.filter(nearBridge), medians: medians.filter(nearBridge),
        plazas: plazas.filter(nearBridge), roadbeds: roadbeds.filter(nearBridge), parking: parking.filter(nearBridge) })),
    crossings: [...crossings.values()],
  };
}

/** Build once per release, keeping only roads rather than every tile's geometry. */
export async function buildStreetCatalog(directory) {
  const names = (await readdir(directory)).filter(name => /^-?\d+_-?\d+\.json\.gz$/.test(name)).sort();
  const roads = new Map();
  for (let i = 0; i < names.length; i += 8) {
    const tiles = await Promise.all(names.slice(i, i + 8).map(async name =>
      JSON.parse(await inflate(await readFile(path.join(directory, name))))));
    for (const tile of tiles) for (const road of tile.roads) {
      if (keepStreetRoad(road) && !roads.has(road.id) && road.pts.length >= 2) roads.set(road.id, road);
    }
  }
  return { version: 1, keys: names.map(name => name.slice(0, -8)), roads: [...roads.values()] };
}

/** Keep planning data separate from scene residency. The road index is shared
 * across requests; decoded neighborhoods and compressed responses are bounded. */
export function createStreetTileService(directory, { catalogPath } = {}) {
  let catalog;
  const decoded = new Map(), encoded = new Map();
  const cached = (cache, key, limit, build) => {
    if (cache.has(key)) {
      const value = cache.get(key); cache.delete(key); cache.set(key, value); return value;
    }
    const value = build().catch(error => { if (cache.get(key) === value) cache.delete(key); throw error; });
    cache.set(key, value);
    if (cache.size > limit) cache.delete(cache.keys().next().value);
    return value;
  };
  const read = async key => correctStreetTile(JSON.parse(await inflate(await readFile(path.join(directory, `${key}.json.gz`)))));
  const initialize = async () => {
    const data = catalogPath ? JSON.parse(await readFile(catalogPath, 'utf8')) : await buildStreetCatalog(directory);
    if (data.version !== 1) throw new Error('Unsupported street catalog version');
    const keys = new Set(data.keys), index = createRoadIndex();
    for (const road of data.roads) index.add(road);
    return { keys, index };
  };
  return key => cached(encoded, key, 64, async () => {
    if (!/^-?\d+_-?\d+$/.test(key)) throw new Error('Invalid street tile key');
    catalog ??= initialize().catch(error => { catalog = undefined; throw error; });
    const { keys, index } = await catalog;
    const tile = await cached(decoded, key, 128, () => read(key));
    const pending = [];
    for (let tx = tile.tx - 2; tx <= tile.tx + 2; tx++) for (let tz = tile.tz - 2; tz <= tile.tz + 2; tz++) {
      const neighbor = keyOf(tx, tz);
      if (keys.has(neighbor)) pending.push(cached(decoded, neighbor, 128, () => read(neighbor)));
    }
    const context = streetContext(tile, index, await Promise.all(pending));
    return deflate(JSON.stringify({ ...tile, streetContext: context }));
  });
}
