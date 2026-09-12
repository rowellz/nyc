import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { createMobileRoadMaterial } from '../static/world/assets/mobile-road-material.js';
import { streetTextureUrl, MOBILE_STREET_BUDGET } from '../static/world/assets/mobile-build-policy.js';
import { CLIENT_REVISION } from '../src/lib/server/client-cache.js';

const streets = readFileSync(new URL('streets-CfYSUqyW.js', assets), 'utf8');
const { Pt: Material } = await import(new URL('textureRelease-2U-gT89r.js', assets));
const sandbox = vm.createContext({ i: Material, $mobileRoadMaterial: createMobileRoadMaterial });
vm.runInContext(streets.slice(streets.indexOf('function y('), streets.indexOf('function z(')), sandbox);
const map = () => ({ albedo: {}, normal: {}, rough: {}, scale: 3 });
const textures = { asphalt: map(), asphalt2: {}, concrete: map(), granite: map(), cobble: map(), noise: {}, atlas: {} };
const shared = { uWetness: { value: 0 }, uRain: { value: 0 }, uTime: { value: 0 }, uNight: { value: 0 } };
const shader = () => ({ uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>',
  fragmentShader: '#include <common>\n#include <map_fragment>\n#include <normal_fragment_maps>\n#include <roughnessmap_fragment>\n#include <lights_fragment_begin>\n#include <fog_fragment>' });
for (const mobile of [true, false]) {
  const { material } = sandbox.w(textures, shared, mobile);
  let externalCalls = 0;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (s, r) => { previous(s, r); externalCalls++; };
  const s = shader();
  material.onBeforeCompile(s, {});
  assert.equal(externalCalls, 1, 'atmosphere hooks compose without recursion');
  assert(s.fragmentShader.includes('#include <lights_fragment_begin>'));
  assert(s.fragmentShader.includes('#include <fog_fragment>'));
  assert.equal(material.name, 'streets-road');
  if (mobile) {
    assert(material.userData.mobileRoadColors);
    assert(!/sampler2D|texture2D|rainRings|perturbN/.test(s.fragmentShader), 'phone surface has no texture sampling or detailed surface effects');
    assert(s.fragmentShader.includes('#include <normal_fragment_maps>'), 'standard geometry normals remain');
    assert.equal(s.uniforms.uMobileRoadWetness, shared.uWetness, 'rain darkening follows live atmosphere uniform');
    assert.equal(material.map, null);
    assert.equal(material.normalMap, null);
    assert(material.customProgramCacheKey().includes('mobile-colors'));
  } else {
    assert(s.fragmentShader.includes('texture2D(tAsphalt,'), 'desktop retains detailed asphalt');
    assert(s.fragmentShader.includes('rainRings'));
    assert(!material.userData.mobileRoadColors);
  }
  material.dispose();
}
assert(streets.includes('x=w(v,i,$mobile)'), 'live scene selects the quality-specific road material');
assert(streets.includes(`mobile-road-material.js?v=${CLIENT_REVISION}`));

// Run the real manifest loader: mobile must never fetch road-only images,
// while the other street materials and the desktop loader still receive maps.
for (const mobile of [true, false]) {
  const requests = [];
  const entries = ['asphalt', 'concrete', 'granite', 'cobble'].map(id => ({
    id, path: id, maps: { albedo: 'color.jpg', normal: 'normal.jpg', rough: 'rough.jpg' },
  }));
  const ctx = vm.createContext({
    e: path => path, t: async () => ({ ok: true, json: async () => entries }),
    h: async url => { requests.push(url); return { dispose() {} }; },
    n: 1000, a: 'srgb', $streetTextureUrl: streetTextureUrl, $streetBudget: MOBILE_STREET_BUDGET,
  });
  vm.runInContext(streets.slice(streets.indexOf('function z('), streets.indexOf('function U(')), ctx);
  const loaded = await ctx.H('/world/assets/textures/', mobile);
  assert(loaded?.concrete && loaded?.granite, 'shared sidewalk/structure textures still load');
  assert.equal(Boolean(loaded.asphalt), !mobile);
  assert.equal(Boolean(loaded.cobble), !mobile);
  assert.equal(requests.length, mobile ? 6 : 12);
  if (mobile) assert(requests.every(url => url.includes('textures-mobile/') && !/asphalt|cobble/.test(url)));
}

// Exercise the shipped upload generator, including its retargeting stage.
for (const mobile of [true, false]) {
  const uploaded = [], retargeted = [];
  const packed = Object.fromEntries(['asphalt', 'concrete', 'granite', 'cobble'].map(name => [name,
    Object.fromEntries(['albedo', 'normal', 'rough'].map(kind => [kind, { name: `${name}:${kind}` }]))]));
  Object.assign(packed, Object.fromEntries(['asphalt2', 'noise', 'atlas'].map(name => [name, { name }])));
  const target = { asphalt: {}, concrete: {}, granite: {}, cobble: {},
    asphalt2: { dispose() {} }, noise: { dispose() {} }, atlas: { dispose() {} } };
  const ctx = vm.createContext({ $mobile: mobile, n: packed, r: null, A: false, v: target,
    x: { uniforms: {} }, S: { uniforms: {} }, C: [], m: t => t, O: (_u, t) => retargeted.push(t) });
  const start = streets.indexOf('y.run((function*(){') + 'y.run(('.length;
  const end = streets.indexOf(')())},V.onerror', start);
  assert(start > 0 && end > start);
  const generator = vm.runInContext(`(${streets.slice(start, end)})()`, ctx);
  for (const texture of generator) uploaded.push(texture.name);
  assert.equal(uploaded.length, mobile ? 8 : 15, 'mobile skips seven unused road map uploads');
  if (mobile) assert(uploaded.every(name => !/asphalt|cobble/.test(name)));
  assert.equal(retargeted.length, 2);
}
console.log('PASS mobile gray road shader, desktop material, manifest fetches and texture uploads');
