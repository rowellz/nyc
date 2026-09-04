import * as THREE from 'three';

interface PackedTexture {
  texturePacket: true;
  image: ImageBitmap | { data: Uint8Array; width: number; height: number };
  wrapS: THREE.Wrapping; wrapT: THREE.Wrapping;
  minFilter: THREE.MinificationTextureFilter; magFilter: THREE.MagnificationTextureFilter;
  colorSpace: string; anisotropy: number; generateMipmaps: boolean;
}

/** Canvas textures originally use flipY=true; bake it into the bitmap since
 * WebGL ignores UNPACK_FLIP_Y_WEBGL and premultiplication for ImageBitmap. */
export async function packTextures(value: unknown, transfers: Transferable[]): Promise<unknown> {
  if (value instanceof THREE.Texture) {
    const image = (value as THREE.DataTexture).isDataTexture ? value.image : await createImageBitmap(value.image as OffscreenCanvas,
      { imageOrientation: value.flipY ? 'flipY' : 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    transfers.push((value as THREE.DataTexture).isDataTexture ? image.data.buffer : image);
    return { texturePacket: true, image, wrapS: value.wrapS, wrapT: value.wrapT,
      minFilter: value.minFilter, magFilter: value.magFilter, colorSpace: value.colorSpace,
      anisotropy: value.anisotropy, generateMipmaps: value.generateMipmaps } satisfies PackedTexture;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) result[key] = await packTextures(child, transfers);
    return result;
  }
  return value;
}

export function unpackTextures(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if ('texturePacket' in value) {
    const packet = value as PackedTexture, image = packet.image;
    const texture = 'data' in image ? new THREE.DataTexture(image.data, image.width, image.height) : new THREE.Texture(image);
    texture.flipY = false;
    texture.wrapS = packet.wrapS; texture.wrapT = packet.wrapT;
    texture.minFilter = packet.minFilter; texture.magFilter = packet.magFilter;
    texture.colorSpace = packet.colorSpace; texture.anisotropy = packet.anisotropy;
    texture.generateMipmaps = packet.generateMipmaps;
    if (!('data' in image)) {
      const close = () => { image.close(); texture.removeEventListener('dispose', close); };
      texture.addEventListener('dispose', close);
    }
    texture.needsUpdate = true;
    return texture;
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unpackTextures(child)]));
}

export function* textureList(value: unknown): Generator<THREE.Texture> {
  if (value instanceof THREE.Texture) yield value;
  else if (value && typeof value === 'object') for (const child of Object.values(value)) yield* textureList(child);
}
