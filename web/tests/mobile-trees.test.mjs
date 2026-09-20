import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { assets } from './sveltekit-assets.mjs';
import {treeBudget,treeRecords,syncSceneryTrees} from '../../src/client/src/environment/tree-lod.js';

const source = readFileSync(new URL('environment-WQwLg8tn.js', assets), 'utf8');
const factory = source.indexOf('function qt(e,t,n,r,i){');
const flagStart = factory + 'function qt(e,t,n,r,i){'.length;
const flagEnd = source.indexOf('let o=new Map', flagStart);
const start = source.indexOf('h=(e,t)=>{', factory), end = source.indexOf(',g=zt()', start);
const updateStart = source.indexOf('update(t){', end), updateEnd = source.indexOf(',async prepare(', updateStart);
assert(factory > 0 && flagEnd > flagStart && end > start && updateEnd > updateStart);
const shaders = [];
for (const level of ['mobile', 'high']) {
  const bounds = [], counts = [];
  const batch = { count: 0, add() { this.count++; }, finish() { counts.push(this.count); }, windBounds: n => bounds.push(n) };
  const shared = { uTime: { value: 10 }, uWind: { value: { length: () => 20 } }, uWetness: { value: .5 } };
  const scope = vm.createContext({ e: { quality: { level }, world:{},worldGroup:{userData:{}},camera: { position: { x: 0, z: 0 } } },
    $getTreeBudget:treeBudget,$treeRecords:treeRecords,$syncSceneryTrees:syncSceneryTrees,D:{},
    r: shared, d: { value: {} }, _: class Material { constructor(options) { Object.assign(this, options); } },
    G: (mat, key, hook) => { mat.onBeforeCompile = hook; mat.customProgramCacheKey = () => key; },
    s: [batch], O: false, k: 0, A: { distanceToSquared: () => 0, copy() {} },
    o: new Map([['0_0', [{ tree: { x: 100, z: 0 }, form: 'oak', matrix: {}, tint: {} }]]]),
    u: new Map([['oak', { far: batch,middle:batch,farWood:{add(){}} }]]), N: 512, j: 65,
  });
  vm.runInContext(source.slice(flagStart, flagEnd) + 'const ' + source.slice(start, end) + ';', scope);
  for (const far of [false, true]) {
    const mat = vm.runInContext(`h(null,${far})`, scope);
    const shader = { uniforms: {},
      vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\ngl_Position=vec4(transformed,1.0);\n}',
      fragmentShader: '#include <common>\n#include <normal_fragment_begin>\n#include <map_fragment>\n#include <aomap_fragment>\n#include <emissivemap_fragment>',
    };
    mat.onBeforeCompile(shader);
    const animated = level !== 'mobile';
    for (const name of ['treeLean', 'treeSway', 'treeFlutter', 'uTime', 'uWind']) {
      assert.equal(shader.vertexShader.includes(name), animated, `${level}: ${name}`);
    }
    assert.equal('uTime' in shader.uniforms, animated);
    assert.equal('uWind' in shader.uniforms, animated);
    assert.equal(shader.uniforms.uWetness, shared.uWetness);
    assert(shader.vertexShader.includes('treeCardK'), 'seeded canopy variation remains');
    assert(shader.fragmentShader.includes('treeOcc'), 'leaf lighting remains');
    assert.equal(mat.customProgramCacheKey().startsWith('static-'), !animated);
    assert.equal(mat.alphaTest, far ? .45 : .4);
    if (!far) shaders.push(shader.vertexShader);
  }
  vm.runInContext('const trees={' + source.slice(updateStart, updateEnd) + '};', scope);
  vm.runInContext('trees.update(.01)', scope);
  assert.equal(bounds.length, level === 'mobile' ? 0 : 1, 'static trees skip per-frame wind bounds');
  scope.O = true;
  vm.runInContext('trees.update(1)', scope);
  assert.deepEqual(counts, [1], 'tile arrivals still populate tree instances');
  assert.equal(bounds.at(-1), level === 'mobile' ? 0 : 20);
  scope.o.clear(); scope.O = true;
  vm.runInContext('trees.update(2)', scope);
  assert.deepEqual(counts, [1, 0], 'unloaded trees leave the batch');
}
const output = process.argv.find(arg => arg.startsWith('--glsl='))?.slice(7);
if (output) for (const [i, shader] of shaders.entries()) {
  writeFileSync(`${output}-${i}.vert`, '#version 300 es\nprecision highp float;\n#define attribute in\n#define varying out\n'
    + shader.replace('#include <common>', 'uniform mat4 modelMatrix; in mat4 instanceMatrix; in vec3 position;')
      .replace('#include <begin_vertex>', 'vec3 transformed = position;'));
}
console.log('PASS static mobile trees: wind shader removal, desktop animation, leaf lighting, bounds and tile lifecycle');
