import { streetLampPlacement } from './fixtures.js';

// Pavement outlines and lamp clearance are expensive geometry queries. Keep
// both their construction and their cache on a worker, outside the frame loop.
let world;
self.onmessage = ({ data }) => {
  try {
    if (data.tiles) {
      const buckets = new Map(), bounds = new Map();
      for (const road of data.tiles.flatMap(t => t.roads)) {
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (const [x, z] of road.pts) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
        const half = road.width / 2;
        x0 -= half; z0 -= half; x1 += half; z1 += half;
        bounds.set(road, { x0, z0, x1, z1 });
        for (let x = Math.floor(x0 / 256); x <= Math.floor(x1 / 256); x++) {
          for (let z = Math.floor(z0 / 256); z <= Math.floor(z1 / 256); z++) {
            const key = `${x}_${z}`;
            if (!buckets.has(key)) buckets.set(key, new Set());
            buckets.get(key).add(road);
          }
        }
      }
      world = { tiles: new Map(data.tiles.map(t => [t.key, t])),
        roadsNear(x, z, radius) {
          // Match the streamer's overlap index, including distinct pieces of
          // the same OSM road ID and the carriageway's width at tile edges.
          const seen = new Set(), out = [];
          for (let tx = Math.floor((x - radius) / 256); tx <= Math.floor((x + radius) / 256); tx++) {
            for (let tz = Math.floor((z - radius) / 256); tz <= Math.floor((z + radius) / 256); tz++) {
              for (const road of buckets.get(`${tx}_${tz}`) ?? []) {
                if (seen.has(road)) continue;
                seen.add(road);
                const b = bounds.get(road);
                if (b.x1 >= x - radius && b.x0 <= x + radius && b.z1 >= z - radius && b.z0 <= z + radius) out.push(road);
              }
            }
          }
          return out;
        } };
    }
    self.postMessage({ id: data.id, placements: data.props.map(prop => streetLampPlacement(world, undefined, prop)) });
  } catch (error) { self.postMessage({ id: data.id, error: String(error?.stack ?? error) }); }
};
