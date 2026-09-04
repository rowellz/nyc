import { buildCatalogue } from './catalogue';
import * as textures from './textures';
import { packTexture, transfers } from '../buildings/transfer';

self.onmessage = async (event: MessageEvent<{ shadows: boolean; mobile?: boolean }>) => {
  try {
    const kinds = buildCatalogue(event.data.shadows);
    const packed = {
      base: await packTexture(textures.makeGrimeTexture()),
      plywood: await packTexture(textures.makePlywoodTexture(event.data.mobile ? 1024 : 2048)),
      mesh: await packTexture(textures.makeMeshTexture()),
      shrub: await packTexture(textures.makeShrubTexture()),
      ped: await packTexture(textures.makePedTexture()),
      stairwell: await packTexture(textures.makeSubwayTileTexture()),
    };
    const result = { kinds, textures: packed };
    self.postMessage(result, { transfer: transfers(result) });
  } catch (error) { self.postMessage({ error: String(error) }); }
};
