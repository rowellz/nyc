import { createProceduralTextures, loadDecalImages } from './textures';
import { packTexture, transfers } from '../buildings/transfer';
import { buildStreetTile, type BuildRequest, type BuildResponse } from './tile';

self.onmessage = async (event: MessageEvent<BuildRequest | { type: 'textures'; aniso: number; quality: string; skip?: Parameters<typeof createProceduralTextures>[2] }>) => {
  if ('type' in event.data) {
    try {
      const decals = await loadDecalImages();
      let textures;
      try {
        textures = createProceduralTextures(event.data.aniso, event.data.quality, event.data.skip, decals);
      } finally {
        decals.manhole?.close(); // the atlas owns a copy after drawImage
      }
      const packed: Record<string, unknown> = { ...textures };
      for (const key of ['asphalt', 'concrete', 'granite', 'cobble'] as const) {
        const set = textures[key];
        packed[key] = { scale: set.scale, albedo: await packTexture(set.albedo), normal: await packTexture(set.normal), rough: set.rough ? await packTexture(set.rough) : null };
      }
      for (const key of ['asphalt2', 'noise', 'atlas'] as const) packed[key] = await packTexture(textures[key]);
      self.postMessage({ type: 'textures', textures: packed }, { transfer: transfers(packed) });
    } catch (error) { self.postMessage({ type: 'textures', error: String(error) }); }
    return;
  }
  const { id, input } = event.data;
  try {
    const built = buildStreetTile(input);
    self.postMessage({ id, built } satisfies BuildResponse, { transfer: transfers(built) });
  } catch (error) {
    self.postMessage({ id, error: String(error) } satisfies BuildResponse);
  }
};
