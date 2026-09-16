/** Keep the existing filtered windows, shopfronts and night lights at all
 * distances. Remove the near-wall parallax/interior branch from mobile GLSL.
 * Smaller photo maps alone cannot reduce that procedural shader's arithmetic.
 */
export function mobileFacadeShader(source) {
  const near = source.indexOf('  // ---- parallax recess');
  const roof = source.indexOf('Surf shadeRoof(vec3 N) {');
  const trim = source.indexOf('Surf shadeTrim(vec3 N) {');
  if (near < 0 || roof < near || trim < roof || !source.includes('if (fw > 0.16) {')) {
    throw Error('Mobile facade shader anchors changed');
  }
  source = source.slice(0, near).replace('if (fw > 0.16) {', '{') + '}\n' + `
Surf shadeRoof(vec3 N) {
  Surf S;
  S.alb = vTint * (1.0 - 0.18 * uWet);
  S.rough = mix(0.88, 0.65, uWet);
  S.n = N;
  S.emis = vec3(0.0); S.ao = 1.0; S.metal = 0.0;
  S.spec = vec3(0.04); S.specMix = 0.0;
  return S;
}
` + source.slice(trim);
  // Strip now-unused ray-box interior helpers as well, keeping them out of
  // shader compilation on WebKit. Remove comments before matching braces.
  source = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const name of ['roomInterior', 'shopInterior']) {
    const start = source.indexOf(`vec3 ${name}(`);
    if (start < 0) throw Error(`Missing facade helper: ${name}`);
    let end = source.indexOf('{', start), depth = 1;
    while (depth && ++end < source.length) {
      if (source[end] === '{') depth++;
      else if (source[end] === '}') depth--;
    }
    if (depth) throw Error(`Unbalanced facade helper: ${name}`);
    source = source.slice(0, start) + source.slice(end + 1);
  }
  return source;
}
