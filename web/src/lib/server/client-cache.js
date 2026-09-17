// The mirror's hashed filenames stay unchanged when this service patches their
// contents. Version the import graph so an existing Safari cache cannot keep
// serving the old entry, worker or shared build queue after a deployment.
export const CLIENT_REVISION = 'ios-memory-43';
const assets = /((?:\.\/|\/world\/assets\/|assets\/|\/world-addons\/)(?:[\w.-]+-[\w-]{8}\.js|scenery\.js|scenery-stream\.js|scenery-format\.js|scenery-transport\.js|scenery\.worker\.js|texture-preflight\.js|geometry-residency\.js|mobile-build-policy\.js|mobile-frame-budget\.js|mobile-facade\.js|terrain-worker-input\.js|mobile-road-material\.js|mobile-props\.js|predictive-streaming\.js|tile-requests\.js|startup-policy\.js|traffic-distribution\.js|signal-placement\.js|mobile-map\.js|rail\/runtime\.js|rail\/cuts\.js))(?=["'`])/g;

export function versionClientImports(source) {
  return source.replace(assets, `$1?v=${CLIENT_REVISION}`);
}
