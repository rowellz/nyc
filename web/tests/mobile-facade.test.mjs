import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import { mobileFacadeShader } from '../static/world/assets/mobile-facade.js';

const buildings = readFileSync(new URL('buildings-BDmduZ8y.js', assets), 'utf8');
const styles = await import(new URL('styles-CD9VAM0e.js', assets));
const windows = await import(new URL('windows-DHBrnuBG.js', assets));
const three = await import(new URL('textureRelease-2U-gT89r.js', assets));
const scope = vm.createContext({ D: styles.n, M: styles.u, U: windows.i, W: windows.n, G: windows.r,
  c: three.Pt, $mobileFacadeShader: mobileFacadeShader });
const start = buildings.indexOf('var ae='), end = buildings.indexOf('var de=', start);
assert(start > 0 && end > start);
vm.runInContext(buildings.slice(start, end), scope);
const shaders = [];
for (const mobile of [false, true]) {
  const material = scope.ue({ uNight: { value: .8 } }, { textures: false, mobile });
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <uv_vertex>',
    fragmentShader: '#include <common>\n#include <normal_fragment_maps>\n#include <lights_physical_fragment>\n#include <aomap_fragment>' };
  material.onBeforeCompile(shader, {});
  assert.equal(shader.uniforms.uNight.value, .8);
  shaders.push(shader.fragmentShader);
  assert.equal(shader.fragmentShader.includes('lodWindowLit('), !mobile);
  assert.equal(shader.fragmentShader.includes('mobileWindowLight('), mobile);
  for (const helper of ['windowLightColorLOD(', 'windowLightColor(', 'windowInterior(']) {
    assert.equal(shader.fragmentShader.includes(helper), !mobile, `${helper} is desktop-only`);
  }
  if (mobile) {
    assert(shader.fragmentShader.includes('distance(cameraPosition, position)'), 'surface LOD includes camera altitude');
    assert(shader.fragmentShader.includes('if (detail <= 0.0) return coarse;'), 'distant wall fragments skip detailed shading');
    assert(shader.fragmentShader.includes('S.alb = mix(coarse.alb, S.alb, detail)'), 'transition blends instead of popping');
    assert(shader.fragmentShader.includes('win > 0.001 && lightResolution > 0.001 && litFrac > 0.0'));
    const light = shader.fragmentShader.slice(shader.fragmentShader.indexOf('vec3 mobileWindowLight('), shader.fragmentShader.indexOf('Surf shadeWall('));
    assert.equal((light.match(/hash[234]\(/g) ?? []).length, 2, 'at most two occupancy samples per window');
    assert(!/texture2D|uTime|windowInterior/.test(light), 'stable lights need no texture, animation or interior samples');
  }
  assert(shader.fragmentShader.includes('Surf shadeSign('), 'sign atlas remains in use');
  assert.equal(shader.fragmentShader.includes('roomInterior('), !mobile);
  assert.equal(shader.fragmentShader.includes('shopInterior('), !mobile);
  assert.equal(shader.fragmentShader.includes('texture2D(uTexRoof'), !mobile);
  assert.equal(shader.fragmentShader.includes('if (fw > 0.16)'), !mobile);
  assert.equal(material.customProgramCacheKey().includes('mobile'), mobile);
  material.dispose();
}
assert(shaders[1].length < shaders[0].length * .4, 'mobile shader removes most of the desktop source');
assert(buildings.includes('m=ue(d,{textures:!1,mobile:t.quality.level===`mobile`})'));
// Run the actual texture-init guard: mobile never opens a photo/upload job.
const from = buildings.indexOf('async function U(){'), to = buildings.indexOf('for(let e of t.world.tiles.values())F(e)', from);
const photos = vm.createContext({ t: { quality: { level: 'mobile' } }, B: false, H: 0,
  i: { job() { throw Error('mobile must not allocate a facade photo job'); } } });
vm.runInContext(buildings.slice(from, to), photos);
await photos.U();
assert.equal(photos.B, true, 'disable future photo polling');
assert.equal(photos.H, 0);

// Optional external GLSL compile: node tests/mobile-facade.test.mjs --glsl=/tmp/mobile.frag
const output = process.argv.find(arg => arg.startsWith('--glsl='))?.slice(7);
if (output) writeFileSync(output, `#version 300 es
precision highp float;
precision highp int;
#define varying in
#define texture2D texture
uniform vec3 cameraPosition;
${mobileFacadeShader(scope.se)}
out vec4 result;
void main() {
  Surf wall = shadeWall(vec3(0.0, 0.0, 1.0), vec3(0.0, 0.0, 1.0), 1.0);
  Surf roof = shadeRoof(vec3(0.0, 1.0, 0.0));
  Surf trim = shadeTrim(vec3(0.0, 0.0, 1.0));
  Surf sign = shadeSign(vec3(0.0, 0.0, 1.0), true);
  result = vec4(wall.alb + wall.emis + roof.alb + trim.alb + sign.alb, 1.0);
}
`);
console.log(`PASS served mobile facade: ${shaders[0].length} -> ${shaders[1].length} shader characters, filtered windows/signs, no interiors or facade photo jobs`);

// Custom towers have an independent material and must opt into the same mobile
// lighting policy at their factory call, not only at a test-only entry point.
const landmarks = readFileSync(new URL('landmarks-KpQKy0CX.js', assets), 'utf8');
assert(landmarks.includes('et(n,e.quality.level===`mobile`)'));
writeFileSync(new URL('landmark-facade-fixture.js', assets), landmarks + '\nexport {et as facade,Ye as uniforms};');
const landmark = await import(new URL('landmark-facade-fixture.js', assets));
const sizes = [];
for (const mobile of [false, true]) {
  const material = landmark.facade(landmark.uniforms(), mobile);
  const shader = {uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',
    fragmentShader:'#include <common>\n#include <emissivemap_fragment>'};
  material.onBeforeCompile(shader);
  sizes.push(shader.fragmentShader.length);
  assert.equal(shader.fragmentShader.includes('mobileWindowLight('), mobile);
  assert.equal(shader.fragmentShader.includes('mobileLmDetail = mobileSurfaceDetail(vWPos, fwidth(vFuv))'), mobile);
  assert.equal(shader.fragmentShader.includes('if (mobileLmDetail <= 0.0) return 0.5;'), mobile, 'distant landmarks skip procedural noise');
  for (const fn of ['windowLit(', 'windowLightColorLOD(', 'farWindowLight(', 'windowInterior(']) {
    assert.equal(shader.fragmentShader.includes(fn), !mobile, `${fn} is excluded from mobile custom towers`);
  }
  assert.equal(material.customProgramCacheKey().includes('mobile'), mobile);
  material.dispose();
}
assert(sizes[1] < sizes[0]);
console.log(`PASS custom tower lighting: ${sizes[0]} -> ${sizes[1]} shader characters; mobile factory routing and desktop preservation`);
