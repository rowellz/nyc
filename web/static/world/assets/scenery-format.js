// Versioned binary meshes: a small JSON directory followed by aligned buffers.
// No triangulation, normals generation or collider construction in the browser.
export const SCENERY_VERSION = 1;
export const CHUNK_TILES = 4;
export const CHUNK_SIZE = 256 * CHUNK_TILES;
const types = { position: Float32Array, normal: Int8Array, color: Uint8Array, owner: Uint8Array, index: Uint32Array };

export function encodeScenery(chunk) {
  let length = 0;
  const layers = chunk.layers.map(layer => {
    const attributes = {};
    for (const [name, Type] of Object.entries(types)) {
      const data = new Type(layer[name]);
      length = (length + 3) & ~3;
      attributes[name] = { offset: length, count: data.length };
      length += data.byteLength;
    }
    return { kind: layer.kind, features: layer.features, attributes };
  });
  const header = new TextEncoder().encode(JSON.stringify({ ...chunk, version: SCENERY_VERSION, layers }));
  const start = (4 + header.length + 3) & ~3;
  const buffer = new ArrayBuffer(start + length);
  new DataView(buffer).setUint32(0, header.length, true);
  new Uint8Array(buffer, 4, header.length).set(header);
  chunk.layers.forEach((layer, i) => {
    for (const [name, Type] of Object.entries(types)) new Type(buffer, start + layers[i].attributes[name].offset, layer[name].length).set(layer[name]);
  });
  return buffer;
}

export function decodeScenery(buffer) {
  if (buffer.byteLength < 4 || buffer.byteLength > 32 * 1024 * 1024) throw Error('Invalid scenery size');
  const size = new DataView(buffer).getUint32(0, true);
  if (size > 1048576 || size + 4 > buffer.byteLength) throw Error('Invalid scenery header');
  const chunk = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, size)));
  if (chunk.version !== SCENERY_VERSION || chunk.tiles.length > 16) throw Error('Unsupported scenery');
  const start = (4 + size + 3) & ~3;
  chunk.layers = chunk.layers.map(layer => {
    if (!['buildings', 'roads', 'ground'].includes(layer.kind)) throw Error('Invalid scenery layer');
    const result = { kind: layer.kind, features: layer.features ?? [] };
    for (const [name, Type] of Object.entries(types)) {
      const { offset, count } = layer.attributes[name];
      if (!Number.isInteger(offset) || !Number.isInteger(count) || offset < 0 || count < 0 || offset % 4
        || start + offset + count * Type.BYTES_PER_ELEMENT > buffer.byteLength) throw Error('Invalid scenery buffer');
      result[name] = new Type(buffer, start + offset, count);
    }
    const n = result.position.length / 3;
    if (!Number.isInteger(n) || result.normal.length !== n * 3 || result.color.length !== n * 3 || result.owner.length !== n
      || result.index.length % 3 || result.index.some(i => i >= n) || result.owner.some(i => i >= chunk.tiles.length)) throw Error('Invalid scenery mesh');
    if(result.features.some(f=>!Number.isInteger(f.start)||!Number.isInteger(f.count)||f.start<0||f.count<0||f.start%3||f.count%3||f.start+f.count>result.index.length))throw Error('Invalid scenery feature');
    return result;
  });
  return chunk;
}

/** Run in the decoder worker. Keep Three's tight sphere for frustum culling;
 * publication attaches prepared buffers without scanning all vertices. */
export function prepareSceneryGeometry(chunk) {
  const buffers = new Set();
  chunk.triangles = 0;
  for (const layer of chunk.layers) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < layer.position.length; i++) {
      const value = layer.position[i], axis = i % 3;
      if (!Number.isFinite(value)) throw Error('Invalid scenery position');
      lo[axis] = Math.min(lo[axis], value); hi[axis] = Math.max(hi[axis], value);
    }
    const center = lo.map((n, i) => (n + hi[i]) / 2);
    let radiusSquared = 0;
    for (let i = 0; i < layer.position.length; i += 3) {
      radiusSquared = Math.max(radiusSquared, (layer.position[i]-center[0])**2
        + (layer.position[i+1]-center[1])**2 + (layer.position[i+2]-center[2])**2);
    }
    layer.bounds = layer.position.length ? { center, radius: Math.sqrt(radiusSquared) } : { center: [0,0,0], radius: 0 };
    layer.renderIndex = layer.features.length ? layer.index.slice() : layer.index;
    for (const value of Object.values(layer)) if (ArrayBuffer.isView(value)) buffers.add(value.buffer);
    chunk.triangles += layer.index.length / 3;
  }
  chunk.byteLength = [...buffers].reduce((n, b) => n + b.byteLength, 0);
  return chunk;
}
