// The mirror's hashed filenames stay unchanged when this service patches their
// contents. Version the import graph so an existing Safari cache cannot keep
// serving the old entry, worker or shared build queue after a deployment.
export const CLIENT_REVISION = 'mobile-trees-vehicles-72';
const assets = /((?:\.\/|\/world\/assets\/|assets\/|\/world-addons\/)(?:[\w.-]+-[\w-]{8}\.js|edges\.js|ramps\.js|road-collision\.js|lane-layout\.js|fixtures\.js|tunnels\.js|tree-lod\.js|scenery\.js|scenery-stream\.js|scenery-format\.js|scenery-transport\.js|scenery\.worker\.js|texture-preflight\.js|geometry-residency\.js|mobile-build-policy\.js|mobile-building-lod\.js|mobile-frame-budget\.js|mobile-facade\.js|renderer-diagnostics\.js|terrain-worker-input\.js|mobile-road-material\.js|mobile-props\.js|predictive-streaming\.js|driving-streaming\.js|tile-requests\.js|startup-policy\.js|traffic-distribution\.js|signal-placement\.js|mobile-map\.js|render-distance\.js|rail\/runtime\.js|rail\/cuts\.js))(?=["'`])/g;

export function versionClientImports(source) {
  return source.replace(assets, `$1?v=${CLIENT_REVISION}`);
}
