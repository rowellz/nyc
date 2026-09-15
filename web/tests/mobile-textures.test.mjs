import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { mobileTextureSize, streetTextureUrl, buildingTextureUrl, MOBILE_BUILDING_BUDGET } from '../static/world/assets/mobile-build-policy.js';

const worker = fs.readFileSync(new URL('texture.worker-CaHoFbYF.js', assets), 'utf8').replace(/^import .*\n/gm, '');
const transfer = fs.readFileSync(new URL('transfer-CN3_6JL-.js', assets), 'utf8');
const quality = fs.readFileSync(new URL('quality-BuEwAkMy.js', assets), 'utf8');

for (const [mobile, width, height, expected, street = false, building = false] of [
  [true, 512, 512, [256, 256]],
  [true, 512, 256, [256, 128]],
  [true, 256, 512, [128, 256]],
  [true, 128, 64, [128, 64]],
  [false, 2048, 1024, [2048, 1024]],
  [true, 512, 512, [128, 128], true],
  [true, 512, 256, [128, 64], true],
  [true, 64, 32, [64, 32], true],
  [true, 512, 512, [128, 128], false, true],
  [true, 512, 256, [128, 64], false, true],
  [true, 256, 512, [64, 128], false, true],
  [true, 64, 32, [64, 32], false, true],
  [false, 2048, 1024, [2048, 1024], false, true],
]) {
  const originalUrl = `https://example.test/world/assets/${mobile ? 'textures-mobile' : 'textures'}/brick/color.jpg${street ? '?streetMobile=1' : ''}`;
  const url = building ? buildingTextureUrl(originalUrl) : originalUrl;
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
    URL, OffscreenCanvas: Canvas, $mobileTextureSize: mobileTextureSize,
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
  const loader = vm.createContext({ ...fallback, e: device.mobileUrl, $mobileTextureSize: mobileTextureSize });
  vm.runInContext(transfer.replace(/^import .*\n/gm, '').replace(/import\{[^}]+\}from"[^"]+";/g, '').replace(/export\{[^}]+\};/, '').replaceAll('import.meta.url', JSON.stringify(assets.href)), loader);
  const texture = await loader.f(url.replace('/textures-mobile/', '/textures/'));
  assert.equal(loadedUrl, url);
  assert.deepEqual([texture.image.width, texture.image.height], expected);
  assert.equal(texture.flipY, false);
  if (resizeOptions) assert.equal(resizeOptions.imageOrientation, 'none', 'do not flip twice');
  texture.dispose();
  assert.equal(closed, resizeOptions ? 2 : 1, 'fallback releases both bitmap allocations');
}
const roadUrl = '/world/assets/textures/asphalt/color.jpg?version=2#image';
assert.equal(streetTextureUrl(roadUrl, false), roadUrl);
assert.equal(streetTextureUrl(roadUrl, true), '/world/assets/textures-mobile/asphalt/color.jpg?version=2&streetMobile=1#image');
assert.equal(buildingTextureUrl(roadUrl), roadUrl);
assert.equal(buildingTextureUrl('/world/assets/textures-mobile/brick/color.jpg?version=2#image'),
  '/world/assets/textures-mobile/brick/color.jpg?version=2&buildingMobile=1#image');

// Exercise the served facade loader to verify routing and filtering for both
// color and normal maps, including devices with a lower anisotropy limit.
const buildings = fs.readFileSync(new URL('buildings-BDmduZ8y.js', assets), 'utf8');
const start = buildings.indexOf('async function Q('), end = buildings.indexOf('async function Pe(', start);
assert(start >= 0 && end > start);
for (const mobile of [true, false]) for (const maxAnisotropy of [1, 16]) for (const srgb of [true, false]) {
  const device = vm.createContext({ navigator: { userAgent: mobile ? 'Android' : 'Desktop', maxTouchPoints: 0 } });
  vm.runInContext(quality.replace(/export\{[^}]+\};/, '') + '\nglobalThis.mobileUrl = r;', device);
  let loadedUrl, prepared;
  const context = vm.createContext({
    $buildingTextureUrl: buildingTextureUrl, $mobileTextureUrl: device.mobileUrl,
    $buildingBudget: MOBILE_BUILDING_BUDGET, i: 'repeat', l: 'srgb',
    ne: async url => { loadedUrl = url; return {}; },
  });
  vm.runInContext(buildings.slice(start, end), context);
  const texture = await context.Q(`/world/assets/textures/brick/${srgb ? 'color' : 'normal'}.jpg`,
    { capabilities: { getMaxAnisotropy: () => maxAnisotropy } }, srgb, async t => { prepared = t; });
  assert(texture, 'facade texture loads successfully');
  assert.equal(loadedUrl.includes('/textures-mobile/'), mobile);
  assert.equal(new URL(loadedUrl, 'https://example.test').searchParams.get('buildingMobile'), mobile ? '1' : null);
  assert.equal(texture.anisotropy, Math.min(mobile ? 2 : 8, maxAnisotropy));
  assert.equal(texture.colorSpace, srgb ? 'srgb' : '');
  assert.equal(prepared, texture, 'upload callback receives the configured texture');
}
console.log('Mobile texture worker and fallback checks passed.');
