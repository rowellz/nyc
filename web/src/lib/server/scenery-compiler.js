import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { encodeScenery, CHUNK_TILES, CHUNK_SIZE, SCENERY_VERSION } from '../../../static/world/assets/scenery-format.js';
import { landmarkShell } from '../../../static/world/assets/landmark-shells.js';

export async function sceneryTools(publicDir) {
  const polygon = await import(pathToFileURL(path.join(publicDir, 'world/assets/polygon-BtfRVykj.js')).href);
  const { buildingFoundation } = await import(pathToFileURL(path.join(publicDir, 'world/assets/foundations.js')).href);
  const styles = await import(pathToFileURL(path.join(publicDir, 'world/assets/styles-CD9VAM0e.js')).href);
  const roofs = await import(pathToFileURL(path.join(publicDir, 'world/assets/builder-Ct8y1lc-.js')).href);
  return { buildingParams: styles.i, seedOf: styles.p, roofMaterial: roofs.r, roofPalette: roofs.i, normalize: polygon.i, simplify: polygon.l, triangulate: polygon.u, inside: polygon.o, foundation: buildingFoundation };
}

export function sceneryChunks(keys) {
  const chunks = new Map();
  for (const key of keys) {
    const [tx, tz] = key.split('_').map(Number);
    const ck = `${Math.floor(tx / CHUNK_TILES)}_${Math.floor(tz / CHUNK_TILES)}`;
    if (!chunks.has(ck)) chunks.set(ck, []);
    chunks.get(ck).push(key);
  }
  return chunks;
}

// Same scan-band land subtraction as the collision land mesh. In particular,
// far ground never covers rivers, coastal water or holes in water polygons.
export function landFaces(tile, inside, classifyParks = false) {
  const x0 = tile.tx * 256, x1 = x0 + 256, z0 = tile.tz * 256, z1 = z0 + 256;
  const cuts = new Set([z0, z1]);
  const edges = [{ x: () => x0, lo: z0, hi: z1 }, { x: () => x1, lo: z0, hi: z1 }];
  const boundaries = [...(tile.water ?? []), ...(classifyParks ? tile.parks ?? [] : [])];
  for (const poly of boundaries) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (a[1] === b[1]) continue;
    const lo = Math.max(z0, Math.min(a[1], b[1])), hi = Math.min(z1, Math.max(a[1], b[1]));
    if (lo >= hi) continue;
    edges.push({ lo, hi, x: z => a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1]) });
    cuts.add(lo); cuts.add(hi);
  }
  for (let i = 0; i < edges.length; i++) for (let j = 0; j < i; j++) {
    const a = edges[i], b = edges[j], lo = Math.max(a.lo, b.lo), hi = Math.min(a.hi, b.hi);
    if (lo >= hi) continue;
    const d0 = a.x(lo) - b.x(lo), d1 = a.x(hi) - b.x(hi);
    if (d0 * d1 < 0) cuts.add(lo + (hi - lo) * d0 / (d0 - d1));
  }
  const bands = [...cuts].sort((a, b) => a - b), faces = [];
  const clamp = x => Math.max(x0, Math.min(x1, x));
  let previous = new Map();
  for (let i = 1; i < bands.length; i++) {
    const lo = bands[i - 1], hi = bands[i], mid = (lo + hi) / 2;
    const active = edges.filter(e => e.lo <= mid && e.hi >= mid).sort((a, b) => a.x(mid) - b.x(mid));
    const runs = [];
    for (let j = 1; j < active.length; j++) {
      const a = active[j - 1], b = active[j], x = (a.x(mid) + b.x(mid)) / 2;
      if (x <= x0 || x >= x1 || b.x(mid) - a.x(mid) < 1e-7 || (tile.water ?? []).some(p => inside(x, mid, p))) continue;
      const face = [[clamp(a.x(lo)), lo], [clamp(b.x(lo)), lo], [clamp(b.x(hi)), hi], [clamp(a.x(hi)), hi]];
      if (classifyParks) face.grass = (tile.parks ?? []).some(p => inside(x, mid, p));
      const last = runs.at(-1);
      if (classifyParks && last && last.grass === face.grass && Math.abs(last[1][0]-face[0][0])<1e-7 && Math.abs(last[2][0]-face[3][0])<1e-7) {
        last[1]=face[1];last[2]=face[2];
      } else runs.push(face);
    }
    // Merge scan bands with collinear sides; distant parks need their outline,
    // not the internal subdivisions introduced by every edge elsewhere in a tile.
    const next = new Map();
    const edgeKey = (a,b,grass) => `${a[0].toFixed(6)},${b[0].toFixed(6)},${grass}`;
    const straight = (a,b,c) => Math.abs((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))<1e-6;
    for (const face of runs) {
      const prior = classifyParks && previous.get(edgeKey(face[0],face[1],face.grass));
      let merged = face;
      if(prior && straight(prior[0],prior[3],face[3]) && straight(prior[1],prior[2],face[2])) {
        prior[3]=face[3];prior[2]=face[2];merged=prior;
      } else faces.push(face);
      next.set(edgeKey(merged[3],merged[2],merged.grass),merged);
    }
    previous=next;
  }
  return faces;
}

export function compileScenery(key, tiles, tier, tools) {
  const [cx, cz] = key.split('_').map(Number), ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
  const layers = ['ground', 'roads', 'buildings'].map(kind => ({ kind, features: [], position: [], normal: [], color: [], owner: [], index: [] }));
  let owner = 0, buildings = 0;
  const face = (layer, points, tint) => {
    const base = layer.position.length / 3;
    const a = points[0], b = points[1], c = points[2];
    const u = b.map((v, i) => v - a[i]), v = c.map((n, i) => n - a[i]);
    const normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const length = Math.hypot(...normal) || 1;
    for (const p of points) {
      layer.position.push(p[0] - ox, p[1], p[2] - oz);
      layer.normal.push(...normal.map(n => Math.round(n / length * 127)));
      layer.color.push(...tint); layer.owner.push(owner);
    }
    for (let i = 1; i < points.length - 1; i++) layer.index.push(base, base + i, base + i + 1);
  };
  const cap = (layer, poly, y, color) => {
    const points = poly.flat(), idx = tools.triangulate(poly);
    for (let i = 0; i < idx.length; i += 3) {
      const tri = idx.slice(i, i + 3).map(n => [points[n][0], y, points[n][1]]);
      const [a,b,c] = tri;
      if ((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]) > 0) tri.reverse();
      face(layer, tri, color);
    }
  };
  const seenBuildings = new Set();
  for (const tile of tiles) {
    for (const quad of landFaces(tile, tools.inside, true)) face(layers[0], quad.slice().reverse().map(([x,z]) => [x, -0.15, z]), quad.grass ? [0, 255, 0] : [255, 0, 0]);
    for (const road of tile.roads ?? []) {
      if (road.tunnel || (tier === 'far' && !['motorway','trunk','primary','secondary'].includes(road.cls))) continue;
      if (['footway','steps','path','cycleway'].includes(road.cls)) continue;
      const y = road.bridge ? Math.max(7, (road.layer || 1) * 6) : -0.05;
      const width = Math.max(2, road.width || 6) / 2;
      for (let i = 1; i < road.pts.length; i++) {
        const a = road.pts[i-1], b = road.pts[i], d = Math.hypot(b[0]-a[0], b[1]-a[1]);
        if (d < .01) continue;
        const nx = -(b[1]-a[1])/d*width, nz = (b[0]-a[0])/d*width;
        face(layers[1], [[a[0]-nx,y,a[1]-nz],[a[0]+nx,y,a[1]+nz],[b[0]+nx,y,b[1]+nz],[b[0]-nx,y,b[1]-nz]], [49, 51, 53]);
      }
    }
    for (const b of tile.buildings ?? []) {
      if (seenBuildings.has(b.id)) continue;
      seenBuildings.add(b.id);
      const h = Math.max(3, b.height || 3);
      if (tier === 'far' && h < 12) continue;
      let poly = tools.normalize(b.footprint);
      if (!poly) continue;
      const shell = landmarkShell(b.id, poly[0]);
      if (!shell) poly = tools.normalize(poly.map(r => tools.simplify(r, tier === 'far' ? 4 : .8))) ?? poly;
      const y0 = tools.foundation(b);
      const start = layers[2].index.length;
      // Use the detailed baker's deterministic palettes, in linear vertex color space.
      const seed = tools.seedOf(b.id), params = tools.buildingParams(b, seed);
      const bytes = color => color.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255));
      const tint = bytes(params.tint);
      const roof = bytes(tools.roofPalette(seed, tools.roofMaterial(seed)));
      for (const part of shell ?? [{ring:poly[0], holes:poly.slice(1), base:0, top:h}]) {
        for (const ring of [part.ring, ...part.holes]) for (let i=0; i<ring.length; i++) {
          const a=ring[i], q=ring[(i+1)%ring.length];
          face(layers[2], [[a[0],y0+part.base,a[1]],[a[0],y0+part.top,a[1]],
            [q[0],y0+part.top,q[1]],[q[0],y0+part.base,q[1]]], tint);
        }
        cap(layers[2], [part.ring,...part.holes], y0+part.top, roof);
      }
      buildings++;
      layers[2].features.push({ id:b.id, start, count:layers[2].index.length-start });
    }
    owner++;
  }
  // Lightweight tree records travel with bounded scenery chunks, without loading
  // distant road/building tiles or allocating their collision and detail meshes.
  const treeTiles = tiles.map(tile => ({ key:tile.key, roads:[], parks:[], trees:(tile.trees ?? [])
    .filter(t => [t.x,t.z,t.height,t.dbh].every(Number.isFinite))
    .map(t => ({ x:t.x,z:t.z,height:t.height,dbh:t.dbh,species:t.species ?? 'tree',
      park:(tile.parks ?? []).some(p => tools.inside(t.x,t.z,p)) })) }));
  return { key, tier, ox, oz, tiles: tiles.map(t => t.key), treeTiles, buildings, layers: layers.filter(l => l.index.length) };
}

export async function readSceneryTiles(publicDir, keys) {
  const { alignStreetTrees } = await import('../../../static/world/assets/curb-placement.js');
  // Use the same one-tile halo as the detailed tile service, including at LOD
  // chunk boundaries, so trunks do not jump when their detailed pits load.
  const wanted = new Set(keys), halo = new Set(keys);
  for (const key of keys) {
    const [tx,tz] = key.split('_').map(Number);
    for(let x=tx-1;x<=tx+1;x++)for(let z=tz-1;z<=tz+1;z++)halo.add(`${x}_${z}`);
  }
  const tiles = (await Promise.all([...halo].map(async key => {
    try { return JSON.parse(gunzipSync(await readFile(path.join(publicDir, `world/world/tiles/${key}.json.gz`)))); }
    catch(error) { if(error.code==='ENOENT'&&!wanted.has(key))return null;throw error; }
  }))).filter(Boolean);
  return keys.map(key => {
    const tile=tiles.find(t=>t.key===key);
    return alignStreetTrees(tile,tiles.filter(t=>Math.abs(t.tx-tile.tx)<=1&&Math.abs(t.tz-tile.tz)<=1));
  });
}

export async function prepareScenery(publicDir, output) {
  const index = JSON.parse(await readFile(path.join(publicDir, 'world/world/index.json'), 'utf8'));
  const tools = await sceneryTools(publicDir), chunks = sceneryChunks(index.tiles);
  const directory = path.join(output, 'scenery'); await mkdir(directory, { recursive: true });
  const hash = createHash('sha256'), entries = [];
  let bytes = 0, triangles = 0;
  for (const [key, keys] of chunks) {
    const tiles = await readSceneryTiles(publicDir, keys);
    const entry = { key, tiers: {} };
    for (const tier of ['mid', 'far']) {
      const chunk = compileScenery(key, tiles, tier, tools), binary = encodeScenery(chunk);
      const body = gzipSync(new Uint8Array(binary), { level: 6 });
      hash.update(body); bytes += body.length;
      const tris = chunk.layers.reduce((n,l) => n + l.index.length/3, 0); triangles += tris;
      await writeFile(path.join(directory, `${key}.${tier}.bin.gz`), body);
      entry.tiers[tier] = { bytes: body.length, decodedBytes: binary.byteLength, triangles: tris };
    }
    entries.push(entry);
  }
  const manifest = { version: SCENERY_VERSION, chunkSize: CHUNK_SIZE, revision: hash.digest('hex').slice(0,16), chunks: entries };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  return { chunks: entries.length, bytes, triangles };
}
