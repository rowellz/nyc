import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';

const source = name => readFileSync(new URL(name, assets), 'utf8');
const between = (text, start, end) => {
  const a = text.indexOf(start), b = text.indexOf(end, a);
  assert(a >= 0 && b > a, `missing atlas boundary: ${start}`);
  return text.slice(a, b);
};
// Record allocations and drawing transforms while executing the served painters.
// No full-resolution temporary should be needed to produce a mobile atlas.
let canvases = [];
class Canvas {
  constructor(width = 300, height = 150) {
    this.width = width; this.height = height; this.scales = [];
    canvases.push(this);
    this.ctx = new Proxy({
      scale: (x, y) => this.scales.push([x, y]),
      measureText: text => ({ width: text.length * 10 }),
      getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      createLinearGradient: () => ({ addColorStop() {} }),
      createRadialGradient: () => ({ addColorStop() {} }),
    }, { get: (target, key) => target[key] ?? (() => {}) });
  }
  getContext() { return this.ctx; }
}
class Texture {
  constructor(image) { this.image = image; }
  dispose() { this.disposed = true; }
}
const document = { createElement: () => new Canvas() };
const cars = source('vehicles-_zJz3z3J.js');
const carScope = vm.createContext({ document, ee: Texture, m: 'srgb', _: 'mipmap' });
vm.runInContext(between(cars, 'var M=1024;', 'var z=e=>'), carScope);
const fleetOptions = between(cars, 'c=he(n,1+mt.indexOf(t)*.173,{', '}),l=wt').split('{')[1];
for (const level of ['mobile', 'high']) {
  const size = level === 'mobile' ? 256 : 1024;
  carScope.level = level;
  // Execute the caller's quality selection, then the real livery/emissive painter.
  const options = vm.runInContext(`(function(){return {${fleetOptions}}}).call({ctx:{quality:{level}}})`,
    vm.createContext({ level, a: { zB: 1, zDoorF: 0, zDoorR: 2 }, o: { z0: 0 }, s: 2 }));
  carScope.options = options;
  canvases = [];
  const atlas = vm.runInContext('he({id:"taxi",style:"taxi",livery:"taxi",colors:[[0xffcc00,1]]},1,options)', carScope);
  assert.equal(canvases.length, 2);
  for (const texture of [atlas.map, atlas.emissive]) {
    assert.equal(texture.image.width, size);
    assert.equal(texture.image.height, size);
    assert.deepEqual(texture.image.scales[0], [size / 1024, size / 1024]);
  }
  assert.equal(atlas.map.anisotropy, level === 'mobile' ? 1 : 8);
  atlas.dispose(); assert(atlas.map.disposed && atlas.emissive.disposed);
}

const landmarks = source('landmarks-KpQKy0CX.js');
for (const level of ['mobile', 'high']) {
  canvases = [];
  const cells = [];
  const atlasSize = Number(/var en=(\d+),/.exec(landmarks)[1]);
  const scope = vm.createContext({ document, en: atlasSize, O: Texture, d: 'srgb', n: 1, m: 2, v: 3,
    On: [(_g, size) => cells.push(size)], nn: Array.from({ length: 16 }, () => ({ setRGB() {} })),
    e: { quality: { level } },
  });
  vm.runInContext(between(landmarks, 'function kn(', 'var An=class'), scope);
  const atlas = vm.runInContext(between(landmarks, 'let s=kn(', 'let c=null;') + 's', scope);
  const size = level === 'mobile' ? 512 : 1920;
  assert.equal(atlas.image.width, size);
  assert.equal(atlas.image.height, size);
  assert.deepEqual(cells, Array(16).fill(size / 4), 'all ad cells use the same normalized layout');
  assert(canvases.every(c => c.width <= size && c.height <= size));
}

const props = source('props-coU--UuE.js');
for (const level of ['mobile', 'high']) {
  canvases = [];
  const scope = vm.createContext({ document, V: 4096, H: 4096, k: Texture, T() {}, h: 1, r: 2, _: 3, S: 4,
    n: { quality: { level } },
  });
  vm.runInContext(between(props, 'var ve=class', 'rectOf(e)') + 'drawFixed(){}};', scope);
  const scale = between(props, 'n.quality.level===`mobile`?', '),h=new he');
  const atlas = vm.runInContext(`new ve(null,()=>true,${scale})`, scope);
  assert.equal(atlas.canvas.width, level === 'mobile' ? 512 : 1920);
  assert.deepEqual(atlas.canvas.scales[0], level === 'mobile' ? [.125, .125] : [1920 / 4096, 1920 / 4096]);
}

// Run the real prop worker's texture generation and transfer, omitting only
// unrelated geometry construction. This covers the worker message's mobile flag.
const worker = source('builder.worker-CU7Og7am.js').replace('Ao(e.data.shadows)', '[]');
for (const mobile of [true, false]) {
  let reply;
  const self = { postMessage: message => { reply = message; } };
  const scope = vm.createContext({ self, console, OffscreenCanvas: Canvas,
    createImageBitmap: async image => ({ width: image.width, height: image.height, close() {} }),
  });
  vm.runInContext(worker, scope);
  await self.onmessage({ data: { mobile, shadows: false } });
  assert(!reply.error, reply.error);
  const { base, plywood } = reply.textures;
  assert.equal(base.image.width, mobile ? 128 : 512);
  assert.equal(base.image.height, mobile ? 128 : 512);
  assert.equal(plywood.image.width, mobile ? 256 : 512);
  assert.equal(plywood.image.height, mobile ? 64 : 128);
  assert.equal(plywood.image.data.byteLength, plywood.image.width * plywood.image.height * 4);
  assert.equal(reply.textures.ped.image.width, 1920);
  assert.equal(reply.textures.ped.image.height, 60);
  for (const texture of Object.values(reply.textures)) {
    assert(Math.max(texture.image.width, texture.image.height) <= 1920);
  }
}
console.log('PASS mobile vehicle, Times Square, sign and scaffolding texture allocations, layouts and worker transfers');
