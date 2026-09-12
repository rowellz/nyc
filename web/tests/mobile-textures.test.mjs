import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const assets = new URL('../../public/world/assets/', import.meta.url);
const worker = fs.readFileSync(new URL('texture.worker-CaHoFbYF.js', assets), 'utf8');
const transfer = fs.readFileSync(new URL('transfer-CN3_6JL-.js', assets), 'utf8');
const quality = fs.readFileSync(new URL('quality-BuEwAkMy.js', assets), 'utf8');

for (const [mobile, width, height, expected] of [
  [true, 512, 512, [256, 256]],
  [true, 512, 256, [256, 128]],
  [true, 256, 512, [128, 256]],
  [true, 128, 64, [128, 64]],
  [false, 2048, 1024, [2048, 1024]],
]) {
  const url = `https://example.test/world/assets/${mobile ? 'textures-mobile' : 'textures'}/brick/color.jpg`;
  let result, closed = 0;
  const draws = [];
  const bitmap = { width, height, close() { closed++; } };
  class Canvas {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() {
      return {
        drawImage(...args) { draws.push(args.slice(1)); },
        getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      };
    }
  }
  const context = vm.createContext({
    URL, OffscreenCanvas: Canvas,
    fetch: async () => ({ ok: true, blob: async () => ({}) }),
    createImageBitmap: async () => bitmap,
    self: { postMessage: message => { result = message; } },
  });
  vm.runInContext(worker, context);
  await context.self.onmessage({ data: { id: 1, url } });
  assert.equal(result.error, undefined);
  assert.deepEqual([result.width, result.height], expected);
  assert.equal(result.data.byteLength, expected[0] * expected[1] * 4);
  assert.deepEqual(draws[0], [0, 0, ...expected]);
  assert.equal(closed, 1, 'worker releases the decoded bitmap');

  // Exercise the shipped loader without Worker support, including mobile URL routing.
  closed = 0;
  let loadedUrl, resizeOptions;
  const fallback = vm.createContext({
    navigator: { userAgent: mobile ? 'Android' : 'Desktop', maxTouchPoints: 0 },
    o: class {
      setOptions() { return this; }
      async loadAsync(value) { loadedUrl = value; return bitmap; }
    },
    a: class {
      constructor(image) { this.image = image; }
      addEventListener(type, callback) { this.dispose = callback; }
    },
    createImageBitmap: async (image, options) => {
      resizeOptions = options;
      return { width: options.resizeWidth, height: options.resizeHeight, close() { closed++; } };
    },
  });
  const device = vm.createContext({ navigator: fallback.navigator });
  vm.runInContext(quality.replace(/export\{[^}]+\};/, '') + '\nglobalThis.mobileUrl = r;', device);
  // Use a separate context to avoid minified local names colliding between modules.
  const loader = vm.createContext({ ...fallback, e: device.mobileUrl });
  vm.runInContext(transfer.replace(/import\{[^}]+\}from"[^"]+";/g, '').replace(/export\{[^}]+\};/, '').replaceAll('import.meta.url', JSON.stringify(assets.href)), loader);
  const texture = await loader.f(url.replace('/textures-mobile/', '/textures/'));
  assert.equal(loadedUrl, url);
  assert.deepEqual([texture.image.width, texture.image.height], expected);
  assert.equal(texture.flipY, false);
  if (resizeOptions) assert.equal(resizeOptions.imageOrientation, 'none', 'do not flip twice');
  texture.dispose();
  assert.equal(closed, resizeOptions ? 2 : 1, 'fallback releases both bitmap allocations');
}
console.log('Mobile texture worker and fallback checks passed.');
