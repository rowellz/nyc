/**
 * Takes the reflections off the river.
 *
 * The water (src/client/src/environment/water.ts) reflects in four ways, and
 * they are four different knobs:
 *
 *   1. The environment map — the sky, through a Fresnel term at ior 1.33. This
 *      is `envMapIntensity` on the material, 0.8 upstream: the broad sheen you
 *      see on the Hudson from the shore.
 *   2. A planar skyline mirror — a half-res render of the far-LOD layer through
 *      a camera reflected about the water plane, mixed in by Fresnel. This is
 *      the one that puts towers in the river. It is off on the `mobile` preset
 *      upstream (`createWater(..., quality.level !== 'mobile')`), so phones
 *      never had it.
 *   3. Two extra sun lobes the client's shader patch adds by hand: a tight GGX
 *      glitter at pow(envMu, 26) and a broad one at pow(envMu, 6).
 *   4. The ordinary PBR specular highlight, which answers the sun and every
 *      street lamp. `specularIntensity` is 1 upstream, and this is the term that
 *      keeps a bright streak on the water after the other three are gone.
 *
 * Both scales default to 0 here, so all four are off and the river reads as flat
 * water colour. `envMapIntensity` and `specularIntensity` are ordinary material
 * properties; the two shader terms have no uniform to turn, so we chain a second
 * compile hook and add them. That is safe because environment/patch.ts
 * `chainCompile` was written for it: assigning `onBeforeCompile` stores our hook
 * to run *after* the material's own patch and flags a recompile, rather than
 * replacing it.
 *
 *   ?water=1              upstream reflections, untouched
 *   ?water=0              none — the default here
 *   ?water=0.35           a dulled river, still reflecting a little
 *   ?waterglitter=0.6     sun and lamp specular on its own scale; without it,
 *                         the glitter follows ?water
 *
 * Once running, `__water.scale` and `__water.glitter` retune both live, with no
 * recompile.
 */
(function () {
  'use strict';

  /** No reflections at all unless asked. */
  var DEFAULT_SCALE = 0;

  // Every anchor is verbatim from the client's shader patch in water.ts, and
  // each appears exactly once in the shipped bundle. GLSL lives in template
  // literals, so the bundler leaves it byte-for-byte.
  var DECL = 'uniform float uWaterFogDensity, uWaterPostFog, uMirrorOn;';
  var DECL_PATCHED = DECL + '\nuniform float uWaterReflect, uWaterGlitter;';
  var MIRROR = 'clamp(mC.a, 0.0, 1.0) * mIn * envF * (1.0 - cap));';
  var MIRROR_PATCHED = 'clamp(mC.a, 0.0, 1.0) * mIn * envF * (1.0 - cap) * uWaterReflect);';
  var SUN = 'outgoingLight += directionalLights[0].color * (pow(envMu, 26.0) * 0.13 + pow(envMu, 6.0) * 0.030) * envF * (1.0 - cap);';
  var SUN_PATCHED = 'outgoingLight += directionalLights[0].color * (pow(envMu, 26.0) * 0.13 + pow(envMu, 6.0) * 0.030) * envF * (1.0 - cap) * uWaterGlitter;';

  function clamp01(n, fallback) {
    return isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
  }

  var params = new URLSearchParams(location.search);
  var scale = clamp01(parseFloat(params.get('water')), DEFAULT_SCALE);
  // The sun lobes follow the main scale unless given their own: asking for a
  // dull river usually means dulling the glitter with it, but wanting the
  // sparkle back over dead-flat water is the one exception worth a knob.
  var glitter = clamp01(parseFloat(params.get('waterglitter')), scale);
  if (scale === 1 && glitter === 1) return;   // upstream: touch nothing at all

  // Uniform objects are reused across recompiles, so changing `.value` retunes
  // the shader on the next frame without rebuilding the program.
  var uReflect = { value: scale };
  var uGlitter = { value: glitter };
  var material = null;
  var timer = 0;

  function applyMaterialTerms() {
    if (!material) return;
    var data = material.userData || {};
    var envBase = data.waterEnvBase;
    var specBase = data.waterSpecularBase;
    material.envMapIntensity = (envBase === undefined ? 0.8 : envBase) * scale;
    material.specularIntensity = (specBase === undefined ? 1 : specBase) * glitter;
  }

  function apply() {
    var game = window.__game;
    var ctx = (game && game.ctx) || window.__ctx;
    var scene = ctx && ctx.scene;
    if (!scene || !scene.getObjectByName) return;

    var mesh = scene.getObjectByName('env-water');
    var mat = mesh && mesh.material;
    if (!mat || mat === material) return;
    material = mat;

    // Remember what upstream asked for, so retuning never compounds.
    if (mat.userData) {
      if (mat.userData.waterEnvBase === undefined) mat.userData.waterEnvBase = mat.envMapIntensity;
      if (mat.userData.waterSpecularBase === undefined) mat.userData.waterSpecularBase = mat.specularIntensity;
    }
    applyMaterialTerms();

    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uWaterReflect = uReflect;
      shader.uniforms.uWaterGlitter = uGlitter;
      var source = shader.fragmentShader;
      var patched = source.replace(DECL, DECL_PATCHED).replace(MIRROR, MIRROR_PATCHED).replace(SUN, SUN_PATCHED);
      if (patched === source) {
        // A newer client build. The material properties still took, so the sky
        // and the lamp specular are handled; say what was missed rather than
        // failing quietly.
        console.warn('[water] shader anchors not found; the skyline mirror and sun lobes were left alone');
        return;
      }
      shader.fragmentShader = patched;
    };

    if (timer) { clearInterval(timer); timer = 0; }
  }

  window.__water = {
    get scale() { return scale; },
    set scale(v) {
      scale = clamp01(parseFloat(v), scale);
      uReflect.value = scale;
      applyMaterialTerms();
    },
    get glitter() { return glitter; },
    set glitter(v) {
      glitter = clamp01(parseFloat(v), glitter);
      uGlitter.value = glitter;
      applyMaterialTerms();
    },
  };

  // The environment module is built a few seconds into boot — later still on
  // iOS, which constructs one module per 1.5 s slot after the first frame.
  apply();
  timer = setInterval(apply, 500);
})();
