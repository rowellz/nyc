import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { mobileTextureSize, streetTextureUrl, buildingTextureUrl, MOBILE_BUILDING_BUDGET } from '../static/world/assets/mobile-build-policy.js';

const worker = fs.readFileSync(new URL('texture.worker-CaHoFbYF.js', assets), 'utf8').replace(/^import .*\n/gm, '');
const transfer = fs.readFileSync(new URL('transfer-CN3_6JL-.js', assets), 'utf8');
const quality = fs.readFileSync(new URL('quality-BuEwAkMy.js', assets), 'utf8');

for (const [mobile, width, height, expected, street = false, building = false] of [
  [true, 512, 512, [128, 128]],
  [true, 512, 256, [128, 64]],
  [true, 256, 512, [64, 128]],
  [true, 128, 64, [128, 64]],
  [false, 2048, 1024, [1920, 960]],
  [false, 1024, 4096, [480, 1920]],
  [false, 1920, 1080, [1920, 1080]],
  [true, 512, 512, [64, 64], true],
  [true, 512, 256, [64, 32], true],
  [true, 64, 32, [64, 32], true],
  [true, 512, 512, [64, 64], false, true],
  [true, 512, 256, [64, 32], false, true],
  [true, 256, 512, [32, 64], false, true],
  [true, 64, 32, [64, 32], false, true],
  [false, 2048, 1024, [1920, 960], false, true],
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
  assert.equal(texture.anisotropy, Math.min(mobile ? 1 : 8, maxAnisotropy));
  assert.equal(texture.colorSpace, srgb ? 'srgb' : '');
  assert.equal(prepared, texture, 'upload callback receives the configured texture');
}
console.log('Mobile texture worker and fallback checks passed.');

// Both the worker and the fallback must build small mobile terrain textures;
// changing only the decoder misses these procedurally generated GPU maps.
for (const [file, name] of [['environment-WQwLg8tn.js', 'gt'], ['textures.worker--LU96PcS.js', 'Wt']]) {
  const source = fs.readFileSync(new URL(file, assets), 'utf8');
  const from = source.indexOf(`async function ${name}(`);
  const to = source.indexOf('}}', source.indexOf('return{asphalt:', from)) + 2;
  assert(from > 0 && to > from);
  const generator = source.slice(from, to);
  const scope = {};
  for (const match of generator.matchAll(/await ([\w$]+)\(([\w$]+)\(/g)) {
    scope[match[1]] = async recipe => recipe;
    scope[match[2]] = (...args) => ({ size: args.at(-1) });
  }
  const leaves = /await ([\w$]+)\(n,null,t\)/.exec(generator)[1];
  scope[leaves] = async size => ({ size });
  const arches = /for\(let e of (\w+)\)/.exec(generator)[1];
  scope[arches] = ['test-tree'];
  vm.createContext(scope);
  vm.runInContext(generator, scope);
  for (const [quality, size] of [['mobile', 128], ['low', 256], ['high', 512]]) {
    const textures = await scope[name](quality);
    for (const key of ['asphalt', 'concrete', 'grass', 'gravel', 'soil', 'waterNormal', 'leaves']) {
      assert.equal(textures[key].size, size, `${file} / ${quality} / ${key}`);
    }
    assert.equal(textures.bark.plane.size, size);
    assert.equal(textures.crowns['test-tree'].size, size);
  }
}
{
  const source = fs.readFileSync(new URL('environment-WQwLg8tn.js', assets), 'utf8');
  const from = source.indexOf('generate(){let e=this.ctx.quality.level');
  const to = source.indexOf('dispose(){', from);
  assert(from > 0 && to > from);
  const loaders = vm.runInNewContext(`new (class {${source.slice(from, to)}})()`, { e: url => url });
  loaders.abort = {};
  loaders.load = (_label, make) => make();
  loaders.request = async request => request;
  for (const level of ['mobile', 'high']) {
    loaders.ctx = { quality: { level } };
    assert.equal((await loaders.generate()).quality, level, 'mobile is no longer mapped to desktop low');
    assert.equal((await loaders.leaves(512, 'color', 'opacity')).size, level === 'mobile' ? 128 : 512);
  }
  assert(source.includes('anisotropy:this.ctx.quality.level===`mobile`?1:'));
  assert(source.includes('Ve(e.quality.level===`mobile`?1:'));
}
console.log('PASS mobile terrain texture budgets: worker/fallback recipes, photo leaves, filtering and desktop preservation');
