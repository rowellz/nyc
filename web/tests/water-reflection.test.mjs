/**
 * The water addon, driven against the real client.
 *
 * The shader patch anchors are verbatim strings from the mirrored bundle, so
 * this feeds it the actual shipped shader source rather than a mock: if
 * tools/mirror.sh ever pulls a client whose water shader changed, this fails
 * instead of the river quietly staying glossy.
 */
import fs from 'node:fs';
import { globSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = fs.readFileSync(new URL('../static/world-addons/water-reflection.js', import.meta.url), 'utf8');
const [BUNDLE] = globSync(new URL('../../public/world/assets/environment-*.js', import.meta.url).pathname);
const SHADER = fs.readFileSync(BUNDLE, 'utf8');

let failures = 0;
const check = (ok, label, extra = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures++;
};
const near = (a, b) => Math.abs(a - b) < 1e-9;

/** Enough of three.js and the client for the addon to find the water. */
function boot({ search = '', envMapIntensity = 0.8, specularIntensity = 1, water = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:3000/world/' + search,
    runScripts: 'outside-only',
  });
  const w = dom.window;
  const warnings = [];
  w.console.warn = (...a) => warnings.push(a.join(' '));

  let compileHook = null;
  const material = {
    envMapIntensity,
    specularIntensity,
    userData: {},
    needsUpdate: false,
    // environment/patch.ts chainCompile: assignment stores an extra hook to run
    // after the client's own, and flags a recompile.
    set onBeforeCompile(fn) { compileHook = fn; this.needsUpdate = true; },
    get onBeforeCompile() { return compileHook; },
  };
  const mesh = { name: 'env-water', material };
  w.__game = { ctx: { scene: { getObjectByName: (n) => (water && n === 'env-water' ? mesh : null) } } };

  const timers = [];
  w.setInterval = (fn) => { timers.push(fn); return timers.length; };
  w.clearInterval = () => {};
  w.eval(SRC);

  /** What three.js would hand onBeforeCompile, using the real shipped shader. */
  const compile = () => {
    const shader = { uniforms: {}, fragmentShader: SHADER, vertexShader: '' };
    if (compileHook) compileHook.call(material, shader);
    return shader;
  };
  return { w, material, compile, warnings, poll: () => timers.forEach((fn) => fn()), hooked: () => !!compileHook };
}

console.log('=== the shader anchors still match the shipped client ===');
{
  const both = [
    'uniform float uWaterFogDensity, uWaterPostFog, uMirrorOn;',
    'clamp(mC.a, 0.0, 1.0) * mIn * envF * (1.0 - cap));',
    'outgoingLight += directionalLights[0].color * (pow(envMu, 26.0) * 0.13 + pow(envMu, 6.0) * 0.030) * envF * (1.0 - cap);',
  ];
  for (const a of both) {
    const n = SHADER.split(a).length - 1;
    check(n === 1, `exactly one "${a.slice(0, 42)}…" in ${BUNDLE.split('/').pop()}`, `found ${n}`);
  }
}

console.log('\n=== off by default: all four terms ===');
{
  const { material, compile } = boot();
  check(near(material.envMapIntensity, 0), 'the sky reflection is gone', String(material.envMapIntensity));
  check(near(material.specularIntensity, 0), 'and the sun/lamp specular with it', String(material.specularIntensity));
  const shader = compile();
  check(shader.uniforms.uWaterReflect.value === 0, 'the skyline mirror is scaled to nothing');
  check(shader.uniforms.uWaterGlitter.value === 0, 'so are the two extra sun lobes');
  check(material.userData.waterEnvBase === 0.8 && material.userData.waterSpecularBase === 1,
    'upstream values remembered, so retuning never compounds');
}

console.log('\n=== the shader patch, against the real shipped chunk ===');
{
  const { compile, material, warnings } = boot();
  check(material.needsUpdate === true, 'assigning the hook flags a recompile');
  const f = compile().fragmentShader;
  check(f.includes('uniform float uWaterReflect, uWaterGlitter;'), 'both uniforms are declared');
  check(f.includes('(1.0 - cap) * uWaterReflect);'), 'the mirror blend is scaled');
  check(f.includes('pow(envMu, 6.0) * 0.030) * envF * (1.0 - cap) * uWaterGlitter;'), 'the sun lobes are scaled');
  check(warnings.length === 0, 'no warning against the real shader');
}
{
  // A future client whose shader moved on: degrade, do not fail silently.
  const { w, material } = boot();
  const shader = { uniforms: {}, fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' };
  const warn = [];
  w.console.warn = (...a) => warn.push(a.join(' '));
  material.onBeforeCompile.call(material, shader);
  check(shader.fragmentShader === 'void main() { gl_FragColor = vec4(1.0); }', 'an unrecognised shader is left untouched');
  check(warn.length === 1 && /anchors not found/.test(warn[0]), 'and it says so', warn[0]);
}

console.log('\n=== bringing it back ===');
{
  const { material, hooked } = boot({ search: '?water=1&waterglitter=1' });
  check(near(material.envMapIntensity, 0.8) && near(material.specularIntensity, 1) && !hooked(),
    'both at 1 leaves the material completely alone');
}
{
  const { material, hooked } = boot({ search: '?water=1' });
  check(near(material.envMapIntensity, 0.8) && near(material.specularIntensity, 1) && !hooked(),
    '?water=1 alone is also untouched — the glitter follows it when not given its own value');
}
{
  const { material, compile } = boot({ search: '?water=1&waterglitter=0' });
  check(near(material.envMapIntensity, 0.8), 'the sky and mirror can come back on their own');
  check(near(material.specularIntensity, 0), 'with the sun left off');
  const u = compile().uniforms;
  check(u.uWaterReflect.value === 1 && u.uWaterGlitter.value === 0, 'and the shader terms agree');
}
{
  const { material, compile } = boot({ search: '?waterglitter=1' });
  check(near(material.specularIntensity, 1), 'sparkle on its own over dead-flat water');
  check(near(material.envMapIntensity, 0), 'without the sky coming with it');
  check(compile().uniforms.uWaterGlitter.value === 1, 'and the sun lobes with it');
}
{
  const { material, compile } = boot({ search: '?water=0.35' });
  check(near(material.envMapIntensity, 0.8 * 0.35), 'a partial scale still works', String(material.envMapIntensity));
  check(compile().uniforms.uWaterReflect.value === 0.35, 'through to the mirror');
}
{
  const { material } = boot({ search: '?water=7' });
  check(near(material.envMapIntensity, 0.8), 'out-of-range clamps to the ends: 7 means upstream', String(material.envMapIntensity));
}
{
  const { material } = boot({ search: '?water=-2' });
  check(near(material.envMapIntensity, 0), 'and -2 means none', String(material.envMapIntensity));
}

console.log('\n=== live retuning ===');
{
  const { w, material, compile } = boot();
  const shader = compile();
  w.__water.scale = 0.4;
  check(near(material.envMapIntensity, 0.32), 'the sky follows immediately', String(material.envMapIntensity));
  check(shader.uniforms.uWaterReflect.value === 0.4, 'and so does the live uniform, with no recompile');
  w.__water.glitter = 0.9;
  check(near(material.specularIntensity, 0.9) && shader.uniforms.uWaterGlitter.value === 0.9,
    'the glitter is independent once set');
  check(near(material.envMapIntensity, 0.32), 'and setting it does not disturb the sky');
  w.__water.scale = 'nonsense';
  check(w.__water.scale === 0.4, 'garbage is ignored');
  w.__water.scale = -3;
  check(w.__water.scale === 0, 'and out-of-range is clamped');
}

console.log('\n=== waiting for the environment module ===');
{
  const { material, poll, hooked } = boot({ water: false });
  check(!hooked() && material.envMapIntensity === 0.8, 'nothing to patch before the water exists');
  const late = boot();
  poll();
  check(late.hooked(), 'the poll picks it up once the module lands');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
