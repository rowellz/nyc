import { basePath as __launchBasePath, mountedFetch as __launchFetch } from '@/core/basePath';
/** File decode and pixel orientation stay off the main thread. Transfer, never clone, the RGBA buffer. */
self.onmessage = async (event: MessageEvent<{ id: number; url: string }>) => {
  const { id, url } = event.data;
  let bitmap: ImageBitmap | undefined;
  try {
    const response = await __launchFetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    bitmap = await createImageBitmap(await response.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bitmap, 0, 0);
    const image = g.getImageData(0, 0, bitmap.width, bitmap.height);
    const sample = new OffscreenCanvas(32, 32).getContext('2d')!;
    sample.drawImage(bitmap, 0, 0, 32, 32);
    const pixels = sample.getImageData(0, 0, 32, 32).data, mean = [0, 0, 0];
    const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) mean[c] += linear(pixels[i + c] / 255) / 1024;
    self.postMessage({ id, width: bitmap.width, height: bitmap.height, data: image.data, mean }, { transfer: [image.data.buffer] });
  } catch (error) { self.postMessage({ id, error: String(error) }); }
  finally { bitmap?.close(); }
};
