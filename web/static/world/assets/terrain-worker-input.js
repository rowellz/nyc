const MASK_SIZE = 512;
let emptyPixels;

/** CPU surface sampling retains the original grid; all empty masks can share
 * this read-only array while each GPU texture contains just one zero texel. */
export function emptyTerrainPixels() {
  return emptyPixels ??= new Uint8ClampedArray(MASK_SIZE * MASK_SIZE * 4);
}

export function terrainTexturePixels(data) {
  return data === emptyPixels
    ? { data: data.subarray(0, 4), size: 1 }
    : { data, size: MASK_SIZE };
}

export function updateTerrainTexture(texture, data) {
  const pixels = terrainTexturePixels(data);
  // Release the old GPU allocation before changing its dimensions. Keep the
  // Texture object so ground/grass material references remain valid.
  if (texture.image.width !== pixels.size || texture.image.height !== pixels.size) texture.dispose();
  texture.image = { data: pixels.data, width: pixels.size, height: pixels.size };
  texture.needsUpdate = true;
}

/** postMessage clones on the sending thread too. Pass only what MaskPainter
 * reads, excluding the tile's large streetContext, trees, props and metadata. */
export function terrainWorkerInput(id, tile, world) {
  const parks = tile.parks.length > 0;
  const x = (tile.tx + .5) * 256, z = (tile.tz + .5) * 256;
  return {
    id,
    tile: {
      key: tile.key, tx: tile.tx, tz: tile.tz, water: tile.water, parks: tile.parks,
      plazas: parks ? tile.plazas : [], roadbeds: parks ? tile.roadbeds : [],
      sidewalks: parks ? tile.sidewalks : [], parking: parks ? tile.parking : [],
    },
    roads: parks ? world.roadsNear(x, z, 184.32).map(({ pts, cls, width, bridge, tunnel }) =>
      ({ pts, cls, width, bridge, tunnel })) : [],
    buildings: parks ? world.buildingsNear(x, z, 184.32).map(({ footprint }) => ({ footprint })) : [],
  };
}
