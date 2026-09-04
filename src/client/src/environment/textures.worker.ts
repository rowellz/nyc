/** The seeded recipes and Canvas2D draw order are identical on both threads. */
import { generateTextures, generateLeafCardsAsync, loadLeafSprites, setAnisotropy } from './textures';
import { packTextures } from './texture-transfer';

export type TextureRequest = { id: number; anisotropy: number } & (
  { kind: 'base'; quality: 'low' | 'medium' | 'high' | 'ultra' }
  | { kind: 'leaves'; size: number; color: string; opacity: string }
);
self.onmessage = async (event: MessageEvent<TextureRequest>) => {
  const request = event.data;
  try {
    setAnisotropy(request.anisotropy);
    const sprites = request.kind === 'leaves' ? await loadLeafSprites(request.color, request.opacity) : null;
    const value = request.kind === 'base' ? await generateTextures(request.quality)
      : sprites ? await generateLeafCardsAsync(request.size, sprites) : null;
    const transfers: Transferable[] = [];
    const packed = await packTextures(value, transfers);
    self.postMessage({ id: request.id, value: packed }, { transfer: transfers });
  } catch (error) {
    self.postMessage({ id: request.id, error: String(error) });
  }
};
